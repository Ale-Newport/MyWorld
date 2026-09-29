import * as THREE from 'three';
export class References {
    environment;
    interactions;
    /** Blender name → node. Populated from `w2Source`, not the glTF name. */
    bySource = new Map();
    /**
     * Every node the interaction layer has asked for. The environment's scenery
     * batching reads this and leaves those subtrees alone: if gameplay looked a
     * node up, something is going to move it, hide it or repaint it, and a
     * merged copy would not follow.
     */
    touched = new Set();
    constructor(environment, interactions) {
        this.environment = environment;
        this.interactions = interactions;
        environment.group.traverse(node => {
            const source = node.userData.w2Source;
            if (typeof source === 'string' && !this.bySource.has(source))
                this.bySource.set(source, node);
        });
    }
    /** The node authored in Blender under this exact name, or null. */
    node(name) {
        const found = this.bySource.get(name) ?? this.environment.nodes.get(name) ?? null;
        if (found)
            this.touched.add(found);
        return found;
    }
    /** Same, but a missing name is a level/runtime mismatch worth shouting about. */
    require(name) {
        const node = this.node(name);
        if (!node)
            throw new Error(`World2: "${name}" is not in the exported level. Re-run npm run world2:export.`);
        return node;
    }
    /** Every authored name matching `<prefix>` or `<prefix>.NNN`, in numeric order. */
    series(prefix) {
        const found = [];
        for (const [source, node] of this.bySource) {
            if (source === prefix) {
                found.push({ key: -1, node });
                continue;
            }
            if (!source.startsWith(`${prefix}.`))
                continue;
            const suffix = source.slice(prefix.length + 1);
            if (!/^\d+$/.test(suffix))
                continue;
            found.push({ key: Number(suffix), node });
        }
        const nodes = found.sort((a, b) => a.key - b.key).map(item => item.node);
        for (const node of nodes)
            this.touched.add(node);
        return nodes;
    }
    /** Every node in a Blender collection. */
    collection(name) {
        const nodes = this.environment.collection(name);
        for (const node of nodes)
            this.touched.add(node);
        return nodes;
    }
    /**
     * "We are drawing something else here." Hides an authored node for good —
     * and keeps the validation panel's category toggles from bringing it back.
     */
    suppress(name) {
        const node = this.node(name);
        if (node)
            this.environment.suppress(node);
        return node;
    }
    /** World position of an authored reference. */
    position(name) {
        const node = this.node(name);
        return node ? node.getWorldPosition(new THREE.Vector3()) : null;
    }
    /** World position, rotation and scale of an authored reference. */
    transform(name) {
        const node = this.node(name);
        if (!node)
            return null;
        node.updateWorldMatrix(true, false);
        const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
        node.matrixWorld.decompose(position, quaternion, scale);
        return { position, quaternion, scale };
    }
    /** The rigid body built for an authored root, if the level gave it one. */
    physical(name) {
        const node = this.node(name);
        return node ? this.environment.physicals.get(node) ?? null : null;
    }
    /** Reference transforms recovered from the .blend for objects the GLB omits. */
    authored(list) {
        return list.map(item => ({
            name: item.name,
            position: new THREE.Vector3(...item.position),
            quaternion: new THREE.Quaternion(...item.quaternion),
            scale: new THREE.Vector3(...item.scale),
            properties: item.properties,
        }));
    }
}
/** The authored zone an area uses for gameplay proximity, as a flat circle. */
export function boundingCircle(references, index) {
    const name = index === null ? 'refZoneBounding' : `refZoneBounding.${String(index).padStart(3, '0')}`;
    const transform = references.transform(name);
    if (!transform)
        return null;
    return { centre: new THREE.Vector2(transform.position.x, transform.position.z), radius: Math.abs(transform.scale.x) };
}
