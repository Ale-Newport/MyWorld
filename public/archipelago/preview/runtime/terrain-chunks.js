import * as THREE from 'three';

/* A big static mesh drawn in pieces, so the camera only pays for the pieces it sees.
 *
 * The coastal terrain is one mesh of 135,000 triangles whose bounding sphere (radius 204 m) is in view from every place in the world, so frustum culling never took any of
 * it away: a third of the main pass's triangles at the start view, all of them drawn from a chase camera that sees 40 m of ground. Split into pieces of a few thousand
 * triangles, each with the bounds of what it holds, the view takes the dozen it needs.
 *
 * The pieces share the mesh's own attribute buffers (positions, normals, colours, uvs are uploaded once, as before); each has an index buffer of its own with just its triangles,
 * and the bounding sphere and box of the vertices those triangles use (three's own would be those of every vertex of the shared buffer). The triangles are dealt by their centroid
 * into a grid over the mesh's two longest axes, and a triangle a cell border cuts belongs to one cell, so nothing is drawn twice and no seam opens.
 *
 * The source mesh stays exactly where it is, visible, with all its data and flags for every query that reads it (the terrain height query, the physics colliders, the map): it is only
 * told to draw nothing (a draw range of zero), and put back by restore(). A ray cast at it still sees all its triangles (its raycast lifts the draw range for the cast). The pieces are
 * meshes of their own (flagged `terrainChunk`, with none of the source's terrain flags). */

/** The grid cell for `triangles` over a `width` x `depth` footprint, giving about `target` triangles a cell. */
export function cellSize(width, depth, triangles, target = 2500, min = 8, max = 128) {
  const cells = Math.max(1, triangles / target);
  return Math.min(max, Math.max(min, Math.sqrt(width * depth / cells)));
}

/** Splits an indexed geometry's triangles into groups of `{index, triangles}`: `index` a typed array of the group's vertex indices. Pure: no three objects but the geometry's data. */
export function partitionTriangles(geometry, { target = 2500 } = {}) {
  const position = geometry.attributes.position, source = geometry.index.array, count = source.length / 3;
  geometry.boundingBox ?? geometry.computeBoundingBox();
  const b = geometry.boundingBox, size = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z], min = [b.min.x, b.min.y, b.min.z];
  // The two longest axes make the grid (the third is the height of a terrain).
  const axes = [0, 1, 2].sort((p, q) => size[q] - size[p]).slice(0, 2).sort();
  const [u, v] = axes, cell = cellSize(Math.max(size[u], 1e-3), Math.max(size[v], 1e-3), count, target);
  const nu = Math.floor(size[u] / cell) + 1, nv = Math.floor(size[v] / cell) + 1;
  const cellOf = new Int32Array(count), counts = new Uint32Array(nu * nv);
  const flat = !position.isInterleavedBufferAttribute && position.itemSize === 3 ? position.array : null;
  const at = flat ? (i, a) => flat[i * 3 + a] : (i, a) => position.getComponent(i, a);
  for (let t = 0; t < count; t++) {
    let cu = 0, cv = 0;
    for (let k = 0; k < 3; k++) {
      const i = source[t * 3 + k];
      cu += at(i, u); cv += at(i, v);
    }
    const id = Math.min(nv - 1, Math.max(0, Math.floor((cv / 3 - min[v]) / cell))) * nu + Math.min(nu - 1, Math.max(0, Math.floor((cu / 3 - min[u]) / cell)));
    cellOf[t] = id; counts[id]++;
  }
  const starts = new Uint32Array(nu * nv + 1);
  for (let c = 0; c < nu * nv; c++) starts[c + 1] = starts[c] + counts[c];
  const filled = new Uint32Array(nu * nv), Type = source.constructor;
  const groups = [];
  const arrays = new Map();
  for (let c = 0; c < nu * nv; c++) if (counts[c]) arrays.set(c, new Type(counts[c] * 3));
  for (let t = 0; t < count; t++) {
    const id = cellOf[t], out = arrays.get(id), at = filled[id]++ * 3;
    out[at] = source[t * 3]; out[at + 1] = source[t * 3 + 1]; out[at + 2] = source[t * 3 + 2];
  }
  for (const [id, index] of arrays) groups.push({ id, index, triangles: index.length / 3 });
  return { groups, cell, grid: [nu, nv], axes };
}

/** The sphere and box of the vertices `index` uses. */
export function boundsOf(position, index, sphere = new THREE.Sphere(), box = new THREE.Box3()) {
  const flat = !position.isInterleavedBufferAttribute && position.itemSize === 3 ? position.array : null;
  const x = flat ? i => flat[i * 3] : i => position.getX(i), y = flat ? i => flat[i * 3 + 1] : i => position.getY(i), z = flat ? i => flat[i * 3 + 2] : i => position.getZ(i);
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let k = 0; k < index.length; k++) {
    const i = index[k], px = x(i), py = y(i), pz = z(i);
    if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; if (pz < z0) z0 = pz; if (pz > z1) z1 = pz;
  }
  box.min.set(x0, y0, z0); box.max.set(x1, y1, z1);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  let r2 = 0;
  for (let k = 0; k < index.length; k++) {
    const i = index[k], dx = x(i) - cx, dy = y(i) - cy, dz = z(i) - cz;
    r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
  }
  sphere.center.set(cx, cy, cz); sphere.radius = Math.sqrt(r2);
  return { sphere, box };
}

/** Whether a mesh is worth splitting: static, indexed, one material, a lot of triangles, a lot of ground. */
export function chunkable(o, { minTriangles = 24000, minRadius = 40 } = {}) {
  const g = o.geometry;
  if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !g?.index || !g.attributes.position || Array.isArray(o.material) || g.groups.length > 1 || o.userData.terrainChunk) return false;
  if (g.index.count / 3 < minTriangles) return false;
  g.boundingSphere ?? g.computeBoundingSphere();
  const e = o.matrixWorld.elements;
  return g.boundingSphere.radius * Math.sqrt(Math.max(e[0] * e[0] + e[1] * e[1] + e[2] * e[2], e[4] * e[4] + e[5] * e[5] + e[6] * e[6], e[8] * e[8] + e[9] * e[9] + e[10] * e[10])) >= minRadius;
}

/** Builds the pieces of `source` (not added to any scene) and tells the source to draw nothing. Each piece's matrix is the source's world matrix: add them to the scene. */
export function chunkMesh(source, options = {}) {
  const g = source.geometry, { groups, cell } = partitionTriangles(g, options), meshes = [];
  const saved = { start: g.drawRange.start, count: g.drawRange.count };
  groups.forEach(({ index, triangles }, n) => {
    const piece = new THREE.BufferGeometry();
    for (const name of Object.keys(g.attributes)) piece.setAttribute(name, g.attributes[name]);
    piece.setIndex(new THREE.BufferAttribute(index, 1));
    const { sphere, box } = boundsOf(g.attributes.position, index);
    piece.boundingSphere = sphere; piece.boundingBox = box;
    const mesh = new THREE.Mesh(piece, source.material);
    mesh.name = (source.name || 'Terrain') + ' · piece ' + (n + 1);
    mesh.castShadow = source.castShadow; mesh.receiveShadow = source.receiveShadow; mesh.renderOrder = source.renderOrder; mesh.layers.mask = source.layers.mask;
    mesh.matrix.copy(source.matrixWorld).decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.matrixWorld.copy(source.matrixWorld);
    mesh.userData = { terrainChunk: true, triangles };
    meshes.push(mesh);
  });
  g.setDrawRange(0, 0);
  // Mesh.raycast reads the draw range too, so a ray cast at the source (the ground under a gate, a pick) would see no triangles and fall through to the sea: it sees them all again for the length of the cast.
  source.raycast = function (raycaster, intersects) {
    const { start, count } = g.drawRange;
    g.drawRange.start = saved.start; g.drawRange.count = saved.count;
    try { THREE.Mesh.prototype.raycast.call(this, raycaster, intersects); } finally { g.drawRange.start = start; g.drawRange.count = count; }
  };
  return { source, meshes, cell, restore() { delete source.raycast; g.setDrawRange(saved.start, saved.count); } };
}

/** Frees the index buffers of a piece and nothing else: its attributes are the source's. */
export function disposeChunk(mesh) {
  const g = mesh.geometry, attributes = g.attributes;
  g.attributes = {};
  g.dispose();
  g.attributes = attributes;
  mesh.removeFromParent();
}
