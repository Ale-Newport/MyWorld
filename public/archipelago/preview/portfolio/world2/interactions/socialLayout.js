import * as THREE from 'three';
export const DEG = Math.PI / 180;
export const PLAZA = Object.freeze({
    radius: 7.0,
    angles: [-68, -24, 24, 68],
    padScale: 1.3,
    iconScale: 1.3,
    padTop: 0.47,
    ownerReach: 2,
    daisReach: 0.3,
});
export const ARRIVAL = Object.freeze({
    distances: [5.5, 6, 6.5, 7, 8],
    swings: [[7.5, -14], [7.5, 12], [8, -12], [8, 12], [9, -12], [9, 12], [10, -18], [10, 18]],
    dynamicMargin: 0.3,
    reach: 14,
});
export function arrivalSpots(psi, dais, scale, distances = ARRIVAL.distances, swings = ARRIVAL.swings) {
    const along = distances.map(metres => towardLens(dais, psi, metres / (scale || 1)));
    const aside = swings.map(([metres, degrees]) => towardLens(dais, psi + degrees * DEG, metres / (scale || 1)));
    return [...along, ...aside];
}
export const yawToward = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
export function slots(options = {}) {
    const radius = options.radius ?? PLAZA.radius;
    const angles = options.angles ?? PLAZA.angles;
    return angles.map(angle => ({ x: radius * Math.sin(angle * DEG), z: radius * Math.cos(angle * DEG), angle }));
}
export function plazaToLocal(p, psi, origin) {
    const c = Math.cos(psi), s = Math.sin(psi);
    return { x: origin.x + p.x * c + p.z * s, z: origin.z - p.x * s + p.z * c };
}
export const lensDirection = (psi) => ({ x: Math.sin(psi), z: Math.cos(psi) });
export function yawOf(rotation) {
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation);
    return Math.atan2(forward.x, forward.z);
}
export const lensYaw = (theta, rotation) => theta - (rotation ? yawOf(rotation) : 0);
export function towardLens(spot, psi, distance) {
    const d = lensDirection(psi);
    return { x: spot.x + d.x * distance, z: spot.z + d.z * distance };
}
export function splitPieces(geometry) {
    const position = geometry.getAttribute('position');
    const index = geometry.index?.array;
    if (!index)
        return [];
    const key = (i) => `${position.getX(i).toFixed(3)},${position.getY(i).toFixed(3)},${position.getZ(i).toFixed(3)}`;
    const parent = new Map();
    const find = (a) => {
        while (parent.get(a) !== a) {
            parent.set(a, parent.get(parent.get(a)));
            a = parent.get(a);
        }
        return a;
    };
    for (let i = 0; i < position.count; i++) {
        const k = key(i);
        if (!parent.has(k))
            parent.set(k, k);
    }
    for (let t = 0; t < index.length; t += 3) {
        const a = find(key(index[t]));
        for (let j = 1; j < 3; j++) {
            const b = find(key(index[t + j]));
            if (a !== b)
                parent.set(b, a);
        }
    }
    const pieces = new Map();
    for (let t = 0; t < index.length; t += 3) {
        const root = find(key(index[t]));
        let piece = pieces.get(root);
        if (!piece)
            pieces.set(root, piece = { triangles: [], vertices: new Set(), box: new THREE.Box3() });
        piece.triangles.push(t);
        for (let j = 0; j < 3; j++) {
            const v = index[t + j];
            piece.vertices.add(v);
            piece.box.expandByPoint(new THREE.Vector3(position.getX(v), position.getY(v), position.getZ(v)));
        }
    }
    return [...pieces.values()];
}
export function selectKeepers(centres, dais, anchors, { daisReach = PLAZA.daisReach, ownerReach = PLAZA.ownerReach } = {}) {
    const keep = [];
    const taken = new Set();
    centres.forEach((c, index) => {
        if (Math.hypot(c.x - dais.x, c.z - dais.z) < daisReach) {
            keep.push({ index, id: 'dais' });
            return;
        }
        let best = null;
        let bestDistance = ownerReach;
        for (const [id, p] of Object.entries(anchors)) {
            const d = Math.hypot(p.x - c.x, p.z - c.z);
            if (d < bestDistance) {
                bestDistance = d;
                best = id;
            }
        }
        if (best)
            keep.push({ index, id: best });
    });
    for (const keeper of keep)
        taken.add(keeper.id);
    if (keep.length !== 1 + Object.keys(anchors).length || taken.size !== keep.length)
        return null;
    return keep;
}
export function standingLevel(geometry, piece, bin = 0.005) {
    const position = geometry.getAttribute('position');
    const index = geometry.index.array;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3();
    const levels = new Map();
    for (const t of piece.triangles) {
        a.fromBufferAttribute(position, index[t]);
        b.fromBufferAttribute(position, index[t + 1]);
        c.fromBufferAttribute(position, index[t + 2]);
        const mean = (a.y + b.y + c.y) / 3;
        normal.crossVectors(b.sub(a), c.sub(a));
        const area = normal.length() / 2;
        if (area <= 0 || normal.y / (2 * area) < 0.9)
            continue;
        const key = Math.round(mean / bin);
        const level = levels.get(key) ?? { area: 0, weighted: 0 };
        level.area += area;
        level.weighted += area * mean;
        levels.set(key, level);
    }
    let best = null;
    for (const level of levels.values())
        if (!best || level.area > best.area)
            best = level;
    return best ? best.weighted / best.area : piece.box.max.y;
}
export const authoredYaw = (centre, dais) => Math.atan2(-(centre.z - dais.z), centre.x - dais.x);
export function pieceMatrix(centre, target, turn, scale) {
    return new THREE.Matrix4().makeTranslation(target.x, 0, target.z)
        .multiply(new THREE.Matrix4().makeRotationY(turn))
        .multiply(new THREE.Matrix4().makeScale(scale, 1, scale))
        .multiply(new THREE.Matrix4().makeTranslation(-centre.x, 0, -centre.z));
}
