import * as THREE from 'three';
const MAX_TRIANGLES = 20000;
const MAX_ELEVATION = (68 * Math.PI) / 180;
const RAY = new THREE.Raycaster();
const HITS = [];
const A = new THREE.Vector3();
const B = new THREE.Vector3();
const C = new THREE.Vector3();
const materialsOf = (mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]);
function counts(mesh) {
    const geometry = mesh.geometry;
    const position = geometry?.attributes?.position;
    if (!position || !mesh.layers.isEnabled(0))
        return false;
    const triangles = geometry.index ? geometry.index.count / 3 : position.count / 3;
    if (triangles > MAX_TRIANGLES)
        return false;
    const data = mesh.userData;
    if (data.waterSurface || data.sea)
        return false;
    return materialsOf(mesh).some(m => m && m.visible !== false && !(m.transparent && m.opacity < 0.35) && m.colorWrite !== false);
}
export function collectOccluders(root, around, reach, ignore = []) {
    const found = [];
    const walk = (node) => {
        if (!node.visible || ignore.includes(node))
            return;
        const mesh = node;
        if (mesh.isMesh && counts(mesh)) {
            let sphere;
            if (mesh.isInstancedMesh) {
                const instanced = mesh;
                if (!instanced.boundingSphere)
                    instanced.computeBoundingSphere();
                sphere = instanced.boundingSphere;
            }
            else {
                if (!mesh.geometry.boundingSphere)
                    mesh.geometry.computeBoundingSphere();
                sphere = mesh.geometry.boundingSphere;
            }
            if (sphere) {
                const world = sphere.clone().applyMatrix4(mesh.matrixWorld);
                if (world.distanceToPoint(around) <= reach)
                    found.push({ mesh, sphere: world });
            }
        }
        for (let i = 0; i < node.children.length; i++)
            walk(node.children[i]);
    };
    walk(root);
    return found;
}
function meets(from, direction, length, occluders) {
    RAY.ray.origin.copy(from);
    RAY.ray.direction.copy(direction);
    RAY.near = 0;
    RAY.far = length;
    for (let i = 0; i < occluders.length; i++) {
        const { mesh, sphere } = occluders[i];
        if (!RAY.ray.intersectsSphere(sphere))
            continue;
        HITS.length = 0;
        mesh.raycast(RAY, HITS);
        if (HITS.length) {
            HITS.length = 0;
            return true;
        }
    }
    return false;
}
const YAW = 6;
const PITCH = 5;
const CLOSER = 0.94;
const PITCH_COST = 0.5;
const CLOSER_COST = 7;
const MAX_TESTS = 60;
function candidates(maxYaw, maxPitch) {
    const list = [];
    for (const scale of [1, CLOSER]) {
        for (let pitch = 0; pitch <= maxPitch + 1e-6; pitch += PITCH) {
            for (let yaw = 0; yaw <= maxYaw + 1e-6; yaw += YAW) {
                for (const side of yaw === 0 ? [1] : [1, -1]) {
                    const cost = yaw + pitch * PITCH_COST + (scale < 1 ? CLOSER_COST : 0);
                    list.push({ yaw: yaw * side, pitch, scale, cost });
                }
            }
        }
    }
    return list.sort((a, b) => a.cost - b.cost || Math.abs(a.yaw) - Math.abs(b.yaw) || b.yaw - a.yaw);
}
export function clearFocusPose(options) {
    const { target, position, samples, occluders } = options;
    const vehicle = options.vehicle ?? [];
    const tolerance = options.tolerance ?? 0.5;
    const clearance = options.clearance ?? 2;
    const maxYaw = options.maxYaw ?? 30;
    const maxPitch = options.maxPitch ?? 30;
    const maxTests = options.maxTests ?? MAX_TESTS;
    const tanV = Math.tan((options.fov * Math.PI) / 360), tanH = tanV * options.ratio;
    const offset = position.clone().sub(target);
    const distance = offset.length();
    const yaw0 = Math.atan2(offset.x, offset.z);
    const pitch0 = Math.asin(THREE.MathUtils.clamp(offset.y / distance, -1, 1));
    const where = new THREE.Vector3();
    const forward = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
    const UP = new THREE.Vector3(0, 1, 0);
    const probe = (at) => {
        let clear = 0;
        for (let i = 0; i < samples.length; i++) {
            A.copy(samples[i]).sub(at);
            const length = A.length();
            if (length > tolerance) {
                A.multiplyScalar(1 / length);
                if (meets(at, A, length - tolerance, occluders) || (vehicle.length > 0 && meets(at, A, length - tolerance, vehicle)))
                    return clear;
            }
            clear++;
        }
        forward.copy(target).sub(at).normalize();
        right.crossVectors(forward, UP);
        if (right.lengthSq() < 1e-8)
            right.set(1, 0, 0);
        right.normalize();
        up.crossVectors(right, forward);
        for (let corner = 0; corner < 4; corner++) {
            const x = corner & 1 ? 0.9 : -0.9, y = corner & 2 ? 0.9 : -0.9;
            B.copy(forward).addScaledVector(right, x * tanH).addScaledVector(up, y * tanV).normalize();
            if (meets(at, B, clearance, occluders))
                return clear;
            clear++;
        }
        return clear;
    };
    const total = samples.length + 4;
    const first = probe(position);
    let tested = 1;
    if (first === total)
        return { position: position.clone(), clear: true, moved: false, yaw: 0, pitch: 0, scale: 1, tested };
    let best = null;
    for (const candidate of candidates(maxYaw, maxPitch)) {
        if (candidate.cost === 0)
            continue;
        if (tested >= maxTests)
            break;
        const yaw = yaw0 + (candidate.yaw * Math.PI) / 180;
        const pitch = Math.min(pitch0 + (candidate.pitch * Math.PI) / 180, MAX_ELEVATION);
        const cosPitch = Math.cos(pitch);
        C.set(Math.sin(yaw) * cosPitch, Math.sin(pitch), Math.cos(yaw) * cosPitch);
        where.copy(target).addScaledVector(C, distance * candidate.scale);
        const score = probe(where);
        tested++;
        if (score === total)
            return { position: where.clone(), clear: true, moved: true, yaw: candidate.yaw, pitch: candidate.pitch, scale: candidate.scale, tested };
        if (score > first && (!best || score > best.score))
            best = { score, where: where.clone(), candidate };
    }
    if (best)
        return { position: best.where, clear: false, moved: true, yaw: best.candidate.yaw, pitch: best.candidate.pitch, scale: best.candidate.scale, tested };
    return { position: position.clone(), clear: false, moved: false, yaw: 0, pitch: 0, scale: 1, tested };
}
