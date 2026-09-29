import * as THREE from 'three';
/* ============================================================
   GEOMETRY HELPERS

   Everything in this world is generated in code. No GLB, no
   textures to download, no asset pipeline to keep in sync with
   the content layer — and nothing whose licence has to be
   checked. The cost is that shapes have to be described rather
   than modelled, so these helpers exist to make that bearable.
   ============================================================ */
/**
 * A box with its edges cut back. Low-poly, but the chamfer catches
 * the light along every edge, which is what stops procedural boxes
 * from reading as programmer art.
 */
export function chamferedBox(width, height, depth, chamfer = 0.08) {
    const c = Math.min(chamfer, width / 2.05, height / 2.05, depth / 2.05);
    const hw = width / 2;
    const hh = height / 2;
    const hd = depth / 2;
    // Eight corner points pulled in by `c` on each axis, expanded into
    // the 24 vertices of a chamfered cuboid (6 faces + 12 bevels + 8
    // corner triangles), built as a convex hull of the inset points.
    const points = [];
    for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
            for (const sz of [-1, 1]) {
                points.push(new THREE.Vector3(sx * (hw - c), sy * hh, sz * (hd - c)));
                points.push(new THREE.Vector3(sx * hw, sy * (hh - c), sz * (hd - c)));
                points.push(new THREE.Vector3(sx * (hw - c), sy * (hh - c), sz * hd));
            }
        }
    }
    return convexHull(points);
}
/**
 * Convex hull via an incremental gift-wrap. three.js ships one in
 * `examples/jsm`, but pulling an example module into the bundle for
 * a handful of boxes is not worth it, and this runs once at build
 * time for each shape.
 */
export function convexHull(points) {
    if (points.length < 4)
        return new THREE.BufferGeometry();
    const makeFace = (a, b, c) => {
        const normal = new THREE.Vector3()
            .subVectors(points[b], points[a])
            .cross(new THREE.Vector3().subVectors(points[c], points[a]))
            .normalize();
        return { a, b, c, normal, constant: normal.dot(points[a]) };
    };
    // Seed tetrahedron from four points that are not coplanar.
    let seed = null;
    outer: for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            for (let k = j + 1; k < points.length; k++) {
                const n = new THREE.Vector3()
                    .subVectors(points[j], points[i])
                    .cross(new THREE.Vector3().subVectors(points[k], points[i]));
                if (n.lengthSq() < 1e-10)
                    continue;
                n.normalize();
                for (let l = k + 1; l < points.length; l++) {
                    if (Math.abs(n.dot(new THREE.Vector3().subVectors(points[l], points[i]))) > 1e-6) {
                        seed = [i, j, k, l];
                        break outer;
                    }
                }
            }
        }
    }
    if (!seed)
        return new THREE.BufferGeometry();
    const [i0, i1, i2, i3] = seed;
    let faces = [makeFace(i0, i1, i2), makeFace(i0, i2, i3), makeFace(i0, i3, i1), makeFace(i1, i3, i2)];
    // Orient every seed face outward from the centroid.
    const centroid = new THREE.Vector3()
        .add(points[i0]).add(points[i1]).add(points[i2]).add(points[i3])
        .multiplyScalar(0.25);
    faces = faces.map((f) => f.normal.dot(centroid) - f.constant > 0 ? makeFace(f.a, f.c, f.b) : f);
    const used = new Set(seed);
    for (let p = 0; p < points.length; p++) {
        if (used.has(p))
            continue;
        const point = points[p];
        const visible = faces.filter((f) => f.normal.dot(point) - f.constant > 1e-7);
        if (visible.length === 0)
            continue;
        // Horizon edges: those belonging to exactly one visible face.
        const edgeCount = new Map();
        const bump = (a, b) => {
            const forward = `${a}_${b}`;
            const back = `${b}_${a}`;
            if (edgeCount.has(back))
                edgeCount.delete(back);
            else
                edgeCount.set(forward, [a, b]);
        };
        for (const f of visible) {
            bump(f.a, f.b);
            bump(f.b, f.c);
            bump(f.c, f.a);
        }
        faces = faces.filter((f) => !visible.includes(f));
        for (const [a, b] of edgeCount.values())
            faces.push(makeFace(a, b, p));
        used.add(p);
    }
    const positions = [];
    const normals = [];
    for (const face of faces) {
        for (const index of [face.a, face.b, face.c]) {
            positions.push(points[index].x, points[index].y, points[index].z);
            normals.push(face.normal.x, face.normal.y, face.normal.z);
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    return geometry;
}
/**
 * A wheel: a low-segment cylinder lying on the Z axis with a raised
 * hub on each face, so it reads as a wheel from either side and
 * never needs mirroring.
 */
export function wheelGeometry(radius, width, segments = 14) {
    const tyre = new THREE.CylinderGeometry(radius, radius, width, segments, 1, false);
    tyre.rotateX(Math.PI / 2);
    return tyre;
}
/** A unit-height cylinder whose origin sits at its BOTTOM face. */
export function strutGeometry(radius, segments = 8) {
    const geometry = new THREE.CylinderGeometry(radius, radius * 0.85, 1, segments, 1, true);
    geometry.translate(0, 0.5, 0);
    return geometry;
}
/**
 * A wedge ramp lying along +X, rising from y=0 at x=-length/2 to
 * y=height at x=+length/2. Returned in a form Rapier can take as a
 * convex hull, so the visual and the collider are the same shape.
 */
export function rampGeometry(length, width, height) {
    const hl = length / 2;
    const hw = width / 2;
    const points = [
        new THREE.Vector3(-hl, 0, -hw),
        new THREE.Vector3(-hl, 0, hw),
        new THREE.Vector3(hl, 0, -hw),
        new THREE.Vector3(hl, 0, hw),
        new THREE.Vector3(hl, height, -hw),
        new THREE.Vector3(hl, height, hw),
        // A short flat lip at the top; a knife edge launches unpredictably.
        new THREE.Vector3(hl - height * 0.5, height * 0.86, -hw),
        new THREE.Vector3(hl - height * 0.5, height * 0.86, hw),
    ];
    return {
        geometry: convexHull(points),
        /** Flat Float32Array of the hull points, for `ColliderDesc.convexHull`. */
        hull: new Float32Array(points.flatMap((p) => [p.x, p.y, p.z])),
    };
}
/** Extracts a Rapier-ready vertex array from any geometry. */
export function hullPoints(geometry) {
    const position = geometry.getAttribute('position');
    return new Float32Array(position.array);
}
/** Extracts indexed vertices + indices for a Rapier trimesh collider. */
export function trimeshData(geometry) {
    const merged = geometry.index ? geometry : mergeVerticesLite(geometry);
    const position = merged.getAttribute('position');
    const vertices = new Float32Array(position.array);
    const index = merged.index;
    const indices = index
        ? new Uint32Array(index.array)
        : new Uint32Array(Array.from({ length: position.count }, (_, i) => i));
    return [vertices, indices];
}
/** Minimal vertex weld — enough to give an unindexed geometry an index. */
function mergeVerticesLite(geometry) {
    const position = geometry.getAttribute('position');
    const map = new Map();
    const vertices = [];
    const indices = [];
    for (let i = 0; i < position.count; i++) {
        const x = position.getX(i);
        const y = position.getY(i);
        const z = position.getZ(i);
        const key = `${x.toFixed(4)}_${y.toFixed(4)}_${z.toFixed(4)}`;
        let index = map.get(key);
        if (index === undefined) {
            index = vertices.length / 3;
            map.set(key, index);
            vertices.push(x, y, z);
        }
        indices.push(index);
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    out.setIndex(indices);
    out.computeVertexNormals();
    return out;
}
/**
 * Extrudes a closed 2D outline into a slab standing on the XZ
 * plane. Used for the world's 3D typography and district plates.
 */
export function extrudeOutline(outline, depth, bevel = 0) {
    const shape = new THREE.Shape();
    shape.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < outline.length; i++)
        shape.lineTo(outline[i][0], outline[i][1]);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: bevel > 0,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 1,
        curveSegments: 4,
    });
    geometry.center();
    return geometry;
}
/** Signed area of a polygon; negative means clockwise. */
export function polygonArea(points) {
    let area = 0;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        area += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
    }
    return area / 2;
}
