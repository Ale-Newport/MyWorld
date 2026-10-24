import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeParts, place, plankGeometry, postGeometry, pegGeometry, nailGeometry, bracketGeometry, ropeGeometry, vineGeometry, charmGeometry, CHARM_KINDS, Facets, addBox, triangleCount, mulberry32, hashSeed } from '../../public/archipelago/preview/portfolio/world2/signs/geometry.js';
import { SWATCH, swatchOf } from '../../public/archipelago/preview/portfolio/world2/signs/palette.js';

const boxTriangles = (bevel) => { const f = new Facets(); addBox(f, [0, 0, 0], [1, 1, 1], SWATCH.tan, bevel); return f.triangles; };

test('a plain box is 12 triangles and a chamfered one 44', () => {
  assert.equal(boxTriangles(0), 12);
  assert.equal(boxTriangles(0.1), 44);
});

function assertValid(geometry, label) {
  const p = geometry.getAttribute('position'), n = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv');
  assert.ok(p.count > 0 && p.count % 3 === 0, `${label}: whole triangles`);
  assert.equal(n.count, p.count); assert.equal(uv.count, p.count);
  assert.equal(geometry.index, null, `${label}: non-indexed (flat shaded)`);
  for (let i = 0; i < p.count; i++) {
    assert.ok(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i)), `${label}: finite position ${i}`);
    assert.ok(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 1e-4, `${label}: unit normal ${i}`);
    assert.ok(swatchOf(uv.getX(i)) >= 0 && uv.getY(i) === 0.5, `${label}: uv on the atlas row`);
  }
  // Flat shading: the three vertices of a facet share one normal and it agrees with the winding.
  for (let t = 0; t < p.count; t += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(p, t), b = new THREE.Vector3().fromBufferAttribute(p, t + 1), c = new THREE.Vector3().fromBufferAttribute(p, t + 2);
    const face = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    for (let k = 0; k < 3; k++) assert.ok(face.dot(new THREE.Vector3().fromBufferAttribute(n, t + k)) > 0.999, `${label}: normal follows winding at facet ${t / 3}`);
  }
}

test('every part the kit builds is finite, flat shaded and sampled from the atlas', () => {
  assertValid(plankGeometry({ width: 1, height: 0.3, depth: 0.07 }), 'plank');
  assertValid(postGeometry({ width: 0.14, height: 1.2, cap: 'pyramid' }), 'post pyramid');
  assertValid(postGeometry({ width: 0.14, height: 1.2, cap: 'ball' }), 'post ball');
  assertValid(postGeometry({ width: 0.14, height: 1.2, cap: 'flat' }), 'post flat');
  assertValid(pegGeometry(), 'peg');
  assertValid(nailGeometry(), 'nail');
  assertValid(bracketGeometry(), 'bracket');
  assertValid(ropeGeometry([0, 0, 0], [1, 0.4, 0]), 'rope');
  assertValid(vineGeometry([[0, 0, 0], [0.1, 0.5, 0], [0, 1, 0.05], [0.1, 1.5, 0]]), 'vine');
  for (const kind of CHARM_KINDS) assertValid(charmGeometry(kind, 0.3), `charm ${kind}`);
});

test('mergeParts concatenates triangles and uvs and transforms positions and normals', () => {
  const a = plankGeometry({ width: 1, height: 1, depth: 1, bevel: 0 });
  const b = plankGeometry({ width: 1, height: 1, depth: 1, bevel: 0, swatch: SWATCH.gold });
  const merged = mergeParts([a, place(b, [10, 0, 0], [0, Math.PI / 2, 0], 2)]);
  assert.equal(triangleCount(merged), 24);
  assert.equal(merged.getAttribute('uv').count, 72);
  const p = merged.getAttribute('position');
  let maxX = -Infinity, minX = Infinity;
  for (let i = 36; i < 72; i++) { maxX = Math.max(maxX, p.getX(i)); minX = Math.min(minX, p.getX(i)); }
  assert.ok(Math.abs(minX - 9) < 1e-5 && Math.abs(maxX - 11) < 1e-5, `second part is scaled x2 around x=10 (${minX}, ${maxX})`);
  const n = merged.getAttribute('normal');
  for (let i = 0; i < n.count; i++) assert.ok(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 1e-4);
  assert.equal(swatchOf(merged.getAttribute('uv').getX(0)), SWATCH.lightOrange);
  assert.equal(swatchOf(merged.getAttribute('uv').getX(40)), SWATCH.gold);
  // A non-uniform scale still lights right (inverse transpose).
  const squashed = mergeParts([place(a, [0, 0, 0], [0, 0, 0], [4, 1, 1])]);
  for (let i = 0; i < squashed.getAttribute('normal').count; i++) assert.ok(Math.abs(Math.hypot(squashed.getAttribute('normal').getX(i), squashed.getAttribute('normal').getY(i), squashed.getAttribute('normal').getZ(i)) - 1) < 1e-4);
  assert.equal(mergeParts([]).getAttribute('position').count, 0);
});

test('mergeParts accepts indexed geometry', () => {
  const indexed = new THREE.PlaneGeometry(1, 1);
  const merged = mergeParts([indexed]);
  assert.equal(triangleCount(merged), 2);
  assert.equal(indexed.index.count, 6, 'the source geometry is left intact');
});

test('a whole board of hardware stays within the triangle budget', () => {
  const parts = [];
  for (const s of [-1, 1]) parts.push(place(postGeometry({ width: 0.14, height: 1.6 }), [s, 0, 0]));
  for (let i = 0; i < 4; i++) parts.push(place(plankGeometry({ width: 2, height: 0.09, depth: 0.1 }), [0, i, 0]));
  for (let i = 0; i < 14; i++) parts.push(place(nailGeometry(), [i * 0.1, 0, 0]));
  for (let i = 0; i < 4; i++) parts.push(place(bracketGeometry(), [i, 0, 0]));
  parts.push(vineGeometry([[0, 0, 0], [0.1, 0.6, 0], [0, 1.2, 0.05], [0.1, 1.8, 0]], { leaves: 9 }));
  parts.push(charmGeometry('planet', 0.26), ropeGeometry([0, 0, 0], [0, -0.14, 0], { sides: 4, segments: 2 }));
  const merged = mergeParts(parts);
  assert.ok(triangleCount(merged) < 1500, `${triangleCount(merged)} triangles`);
});

test('seeds are deterministic', () => {
  const a = mulberry32(hashSeed('projects')), b = mulberry32(hashSeed('projects')), c = mulberry32(hashSeed('lab'));
  const first = [a(), a(), a()];
  assert.deepEqual(first, [b(), b(), b()]);
  assert.notDeepEqual(first, [c(), c(), c()]);
  assert.ok(first.every(v => v >= 0 && v < 1));
});
