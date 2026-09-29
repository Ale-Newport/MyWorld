import * as THREE from 'three';
/* ============================================================
   PAINTING ONTO A BLENDER SURFACE

   Binding a canvas to a mesh that came out of the glTF is not as
   simple as `material.map = texture`. Two conventions disagree:

   1. Blender's UVs put v = 0 at the TOP of the quad, three.js's
      canvas textures put it at the bottom. Left alone, every
      board renders upside down. `flipY = false` settles it.

   2. Some of these authored quads are UV-mirrored, and some are
      wound so the reader stands behind the face the normal points
      at. Either one alone flips the text left-to-right; both
      together cancel out. Guessing per mesh is how you end up
      with half a board readable, so it is derived instead: the
      UV triangle's winding against the face's own winding tells
      you whether the front face is mirrored, and which side the
      reader is on tells you whether that is the face they see.
   ============================================================ */
/** True when the visible face would show the texture back-to-front. */
export function readsMirrored(mesh, reader) {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    if (!position || !uv || position.count < 3)
        return false;
    const index = geometry.index;
    const [a, b, c] = index ? [index.getX(0), index.getX(1), index.getX(2)] : [0, 1, 2];
    const p0 = new THREE.Vector3().fromBufferAttribute(position, a);
    const p1 = new THREE.Vector3().fromBufferAttribute(position, b);
    const p2 = new THREE.Vector3().fromBufferAttribute(position, c);
    // The front normal, by the winding three.js itself would use.
    const normal = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p2, p0));
    if (normal.lengthSq() === 0)
        return false;
    const at = (index) => new THREE.Vector2(uv.getX(index), uv.getY(index));
    const u0 = at(a), u1 = at(b), u2 = at(c);
    // Signed area of the UV triangle. A correctly-mapped front face winds the
    // same way in UV space as it does in space; a negative area is a mirror.
    const uvArea = (u1.x - u0.x) * (u2.y - u0.y) - (u2.x - u0.x) * (u1.y - u0.y);
    const mirroredOnFront = uvArea > 0;
    mesh.updateWorldMatrix(true, false);
    const toReader = mesh.worldToLocal(reader.clone()).sub(p0);
    const seesFront = toReader.dot(normal) > 0;
    return seesFront ? mirroredOnFront : !mirroredOnFront;
}
/**
 * Some authored surfaces carry no usable mapping: everything painted with the
 * `palette` atlas has every vertex on one texel, because the material is a
 * flat colour lookup. Sampling a canvas through that gives one flat colour.
 * Where that is the case the mesh gets planar UVs across its own two widest
 * local axes — safe, because the material is being replaced anyway.
 */
function ensureMapping(mesh) {
    const geometry = mesh.geometry;
    const uv = geometry.getAttribute('uv');
    const position = geometry.getAttribute('position');
    if (!position)
        return;
    if (uv) {
        let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
        for (let i = 0; i < uv.count; i++) {
            uMin = Math.min(uMin, uv.getX(i));
            uMax = Math.max(uMax, uv.getX(i));
            vMin = Math.min(vMin, uv.getY(i));
            vMax = Math.max(vMax, uv.getY(i));
        }
        if (uMax - uMin > 0.05 && vMax - vMin > 0.05)
            return;
    }
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box)
        return;
    const size = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
    // Drop the thinnest axis; the other two are the face. Whichever of them is
    // world-up becomes V, so text runs across the panel rather than down it.
    const thinnest = size.indexOf(Math.min(...size));
    const axes = [0, 1, 2].filter(axis => axis !== thinnest).sort((a, b) => (a === 1 ? 1 : 0) - (b === 1 ? 1 : 0));
    const min = [box.min.x, box.min.y, box.min.z];
    const span = axes.map(axis => Math.max(size[axis], 1e-4));
    const generated = new Float32Array(position.count * 2);
    for (let i = 0; i < position.count; i++) {
        const point = [position.getX(i), position.getY(i), position.getZ(i)];
        generated[i * 2] = (point[axes[0]] - min[axes[0]]) / span[0];
        // Y runs up the face; the canvas runs down it.
        generated[i * 2 + 1] = 1 - (point[axes[1]] - min[axes[1]]) / span[1];
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(generated, 2));
}
/**
 * Puts `texture` on `mesh` the right way up and the right way round for
 * someone standing at `reader`.
 */
export function orientForMesh(texture, mesh, reader) {
    ensureMapping(mesh);
    texture.flipY = false;
    texture.wrapS = THREE.RepeatWrapping;
    if (readsMirrored(mesh, reader)) {
        texture.repeat.x = -1;
        texture.offset.x = 1;
    }
    else {
        texture.repeat.x = 1;
        texture.offset.x = 0;
    }
    texture.needsUpdate = true;
}
/**
 * Whether `object`'s own +Z — the side a Blender-authored plane reads from —
 * points at `reader`. Used for surfaces whose text is GEOMETRY rather than a
 * texture, where a mirrored view cannot be corrected with a texture matrix:
 * a seven-segment 2 read from behind is not a 2.
 */
export function facesReader(object, reader) {
    object.updateWorldMatrix(true, false);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(object.getWorldQuaternion(new THREE.Quaternion()));
    const toReader = reader.clone().sub(object.getWorldPosition(new THREE.Vector3()));
    forward.y = 0;
    toReader.y = 0;
    if (forward.lengthSq() === 0 || toReader.lengthSq() === 0)
        return true;
    return forward.normalize().dot(toReader.normalize()) > 0;
}
