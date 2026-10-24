import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  PLAZA, ARRIVAL, DEG, slots, plazaToLocal, lensDirection, lensYaw, yawOf, towardLens, splitPieces, selectKeepers, authoredYaw, pieceMatrix, arrivalSpots, yawToward,
} from '../../public/archipelago/preview/portfolio/world2/interactions/socialLayout.js';
import { arrivalFor } from '../../public/archipelago/preview/runtime/placement.js';
import { STATIONS, STATION_ICONS, isPending, hasStation, interactiveContacts, shortValue } from '../../public/archipelago/preview/portfolio/world2/content/social.js';
import { contact } from '../../public/archipelago/preview/portfolio/content/profile.js';
import { WORLD2_ACHIEVEMENT_BY_ID } from '../../public/archipelago/preview/portfolio/world2/content/achievements.js';

// The Social plaza is re-seated for the fixed gameplay camera. The maths below is pure (no level, no browser); the real
// level and the real camera are checked by scripts/qa/world-social-shots.mjs. The numbers are the live ones: the instance
// is rotated -60 deg by the world document, the camera's azimuth is 45 deg, so psi = 105 deg.

const THETA = Math.PI / 4;
const FRAME = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -60 * DEG);
const PSI = lensYaw(THETA, FRAME);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('psi turns the frame onto the lens: camera azimuth minus frame yaw (105 deg here)', () => {
  assert.ok(near(PSI, 105 * DEG, 1e-9));
  assert.ok(near(yawOf(FRAME), -60 * DEG, 1e-9));
  assert.equal(lensYaw(THETA, null), THETA, 'no rotation: the frame already is the world');
  // pitch and roll of a frame do not change which way its +z points seen from above
  const tilted = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -60 * DEG, 0.1, 'YXZ'));
  assert.ok(near(yawOf(tilted), -60 * DEG, 1e-6));
});

test('an object whose front is +z and whose rotation.y is psi faces the camera exactly, in the real frame', () => {
  // camera offset direction in the world: (sin theta, cos theta); the frame rotates local vectors by its quaternion
  const toLens = new THREE.Vector3(Math.sin(THETA), 0, Math.cos(THETA));
  const front = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), PSI).applyQuaternion(FRAME);
  assert.ok(front.dot(toLens) > 1 - 1e-12, `front.lens = ${front.dot(toLens)}`);
  const d = lensDirection(PSI);
  const local = new THREE.Vector3(d.x, 0, d.z).applyQuaternion(FRAME);
  assert.ok(local.dot(toLens) > 1 - 1e-12, 'lensDirection(psi) is the lens direction in the frame');
});

test('four stations: a smile toward the lens, symmetric about the lens axis, all the same distance from the dais', () => {
  const s = slots();
  assert.equal(s.length, STATIONS.length);
  for (const slot of s) assert.ok(near(Math.hypot(slot.x, slot.z), PLAZA.radius, 1e-9));
  assert.ok(near(s[0].x, -s[3].x) && near(s[0].z, s[3].z) && near(s[1].x, -s[2].x) && near(s[1].z, s[2].z), 'mirror symmetry');
  assert.ok(s.every((slot) => slot.z > 0), 'every station is on the camera side of the dais');
  assert.ok(s[1].z > s[0].z, 'the inner stations are nearer the lens than the outer ones: the arc bows toward the camera');
  assert.deepEqual(s.map((slot) => Math.sign(slot.x)), [-1, -1, 1, 1], 'order left to right on the screen');
});

test('plazaToLocal keeps distances, puts x on the screen-right axis and z toward the lens', () => {
  const origin = { x: 25.95, z: -18.09 };
  for (const slot of slots()) {
    const at = plazaToLocal(slot, PSI, origin);
    assert.ok(near(Math.hypot(at.x - origin.x, at.z - origin.z), PLAZA.radius, 1e-9));
  }
  const toward = plazaToLocal({ x: 0, z: 3 }, PSI, origin);
  const d = lensDirection(PSI);
  assert.ok(near(toward.x, origin.x + 3 * d.x, 1e-12) && near(toward.z, origin.z + 3 * d.z, 1e-12), '+z of P is the lens direction');
  // screen-right: in the WORLD the camera's right is (cos theta, -sin theta); rotate P's +x into the world through the frame
  const right = plazaToLocal({ x: 1, z: 0 }, PSI, { x: 0, z: 0 });
  const world = new THREE.Vector3(right.x, 0, right.z).applyQuaternion(FRAME);
  assert.ok(near(world.x, Math.cos(THETA), 1e-9) && near(world.z, -Math.sin(THETA), 1e-9), `P +x is screen-right in the world (${world.x}, ${world.z})`);
});

test('a board 1.75 g behind a pad is on the far side of it from the lens, on the lens axis through the pad', () => {
  const pad = { x: 3, z: -4 };
  const behind = towardLens(pad, PSI, -1.75);
  const d = lensDirection(PSI);
  assert.ok(near(Math.hypot(behind.x - pad.x, behind.z - pad.z), 1.75, 1e-12));
  assert.ok(near((behind.x - pad.x) * d.x + (behind.z - pad.z) * d.z, -1.75, 1e-12));
});

test('the layout has no sideways drift when the camera or the frame turns: only psi matters', () => {
  const a = slots();
  for (const theta of [0.2, 1.1, 2.7]) for (const yaw of [-1.3, 0, 0.9]) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const psi = lensYaw(theta, q);
    const frameToWorld = (p) => new THREE.Vector3(p.x, 0, p.z).applyQuaternion(q);
    // the same plaza seen in the world: every station's distance to the lens axis is unchanged
    const lens = new THREE.Vector3(Math.sin(theta), 0, Math.cos(theta));
    a.forEach((slot) => {
      const local = plazaToLocal(slot, psi, { x: 0, z: 0 });
      const w = frameToWorld(local);
      assert.ok(near(w.dot(lens), slot.z, 1e-9), 'depth along the lens axis is P z');
    });
  }
});

/** A merged mesh of `n` separate unit squares (each its own quad, vertices duplicated per face like the export does). */
function squares(centres) {
  const positions = [], index = [];
  centres.forEach(([cx, cz]) => {
    const o = positions.length / 3;
    for (const [dx, dz] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) positions.push(cx + dx, 0.47, cz + dz);
    index.push(o, o + 1, o + 2, o, o + 2, o + 3);
    // a second quad on the same corners with duplicated vertices: a "side face" of the same piece
    const p = positions.length / 3;
    for (const [dx, dz] of [[-0.5, -0.5], [0.5, -0.5]]) positions.push(cx + dx, 0.47, cz + dz, cx + dx, 0, cz + dz);
    index.push(p, p + 2, p + 3, p, p + 3, p + 1);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  return g;
}

test('splitPieces cuts a merged mesh by connectivity, welding vertices the export duplicated', () => {
  const g = squares([[0, 0], [5, 0], [0, 7]]);
  const pieces = splitPieces(g);
  assert.equal(pieces.length, 3);
  assert.deepEqual(pieces.map((p) => p.triangles.length).sort(), [4, 4, 4]);
  const centres = pieces.map((p) => p.box.getCenter(new THREE.Vector3())).map((c) => [Math.round(c.x), Math.round(c.z)]).sort();
  assert.deepEqual(centres, [[0, 0], [0, 7], [5, 0]]);
  // every triangle belongs to exactly one piece, every vertex index to exactly one piece
  const seen = new Set();
  for (const piece of pieces) for (const v of piece.vertices) { assert.ok(!seen.has(v), `vertex ${v} in two pieces`); seen.add(v); }
  assert.equal(pieces.reduce((n, p) => n + p.triangles.length, 0), g.index.count / 3);
});

test('splitPieces joins two squares that share an edge', () => {
  const g = squares([[0, 0], [1, 0]]);
  assert.equal(splitPieces(g).length, 1);
  assert.deepEqual(splitPieces(new THREE.BufferGeometry()), []);
});

test('selectKeepers: the dais and the pad nearest each contact stay; every other pad falls out by elimination', () => {
  // the authored level: eight pads on a half circle round the dais (7.85 g), one far away by the fan
  const dais = { x: 0, z: 0 };
  const ring = Array.from({ length: 8 }, (_, i) => { const a = (i * 25.7 + 0) * DEG; return { x: 7.85 * Math.cos(a), z: -7.85 * Math.sin(a) }; });
  const far = { x: 13.5, z: -15.1 };
  const centres = [dais, ...ring, far];
  const anchors = { github: ring[5], linkedin: ring[6], email: ring[3], cv: ring[4] };
  const keep = selectKeepers(centres, dais, { github: { x: ring[5].x + 0.02, z: ring[5].z }, linkedin: { x: ring[6].x, z: ring[6].z + 0.03 }, email: { x: ring[3].x, z: ring[3].z + 0.56 }, cv: anchors.cv });
  assert.ok(keep, 'the authored level is recognised');
  assert.equal(keep.length, 5);
  assert.deepEqual(keep.map((k) => k.id).sort(), ['cv', 'dais', 'email', 'github', 'linkedin']);
  assert.equal(keep.find((k) => k.id === 'dais').index, 0);
  assert.equal(keep.find((k) => k.id === 'github').index, 1 + 5);
  assert.ok(!keep.some((k) => k.index === centres.length - 1), 'the pad by the fan is dropped');
});

test('selectKeepers refuses a level it was not written for, so nothing is half-edited', () => {
  const dais = { x: 0, z: 0 };
  const centres = [dais, { x: 5, z: 0 }, { x: -5, z: 0 }];
  assert.equal(selectKeepers(centres, dais, { github: { x: 5, z: 0 }, linkedin: { x: -5, z: 0 }, email: { x: 0, z: 9 }, cv: { x: 9, z: 9 } }), null, 'a contact with no pad');
  assert.equal(selectKeepers([dais, { x: 5, z: 0 }], dais, { github: { x: 5, z: 0.5 }, linkedin: { x: 5.2, z: 0 } }), null, 'two contacts claiming one pad');
  assert.equal(selectKeepers([{ x: 9, z: 9 }], dais, {}), null, 'no dais');
});

test('pieceMatrix: turned square to the lens and grown in XZ only; the curb height is untouched', () => {
  const centre = { x: 4, z: -2 }, target = { x: 10, z: 7 };
  const turn = 0.8, scale = 1.3;
  const m = pieceMatrix(centre, target, turn, scale);
  const at = new THREE.Vector3(centre.x, 0.47, centre.z).applyMatrix4(m);
  assert.ok(near(at.x, target.x, 1e-9) && near(at.z, target.z, 1e-9) && near(at.y, 0.47, 1e-12), 'the centre lands on the target at the same height');
  const corner = new THREE.Vector3(centre.x + 0.5, 0.47, centre.z + 0.5).applyMatrix4(m);
  assert.ok(near(Math.hypot(corner.x - target.x, corner.z - target.z), Math.SQRT1_2 * scale, 1e-9), 'grown by the scale in XZ');
  assert.ok(near(new THREE.Vector3(centre.x, 1, centre.z).applyMatrix4(m).y, 1, 1e-12), 'height is not scaled');
});

test('authoredYaw is the angle of a pad round the dais (pads sit tangent to the arc)', () => {
  const dais = { x: 1, z: 2 };
  const c = { x: dais.x + 7.85 * Math.cos(50 * DEG), z: dais.z - 7.85 * Math.sin(50 * DEG) };
  assert.ok(near(authoredYaw(c, dais), 50 * DEG, 1e-9));
  assert.ok(near(Math.abs(authoredYaw({ x: dais.x, z: dais.z - 3 }, dais)), Math.PI / 2, 1e-9));
});

/* -------------------------------------------------------------- which contacts are links -- */

test('the plaza follows the website: the CV is "On request" while it is a placeholder, every other contact is a link', () => {
  const byId = Object.fromEntries(contact.map((c) => [c.id, c]));
  assert.equal(isPending(byId.cv), byId.cv.dataStatus === 'placeholder');
  assert.equal(isPending({ id: 'cv', dataStatus: 'verified' }), false, 'a verified CV becomes a link by itself');
  assert.equal(isPending({ id: 'cv', dataStatus: 'placeholder' }), true);
  assert.equal(isPending({ id: 'email', dataStatus: 'placeholder' }), false, 'a placeholder email or LinkedIn is still shown and linked, as on the website');
  assert.deepEqual(interactiveContacts().map((c) => c.id).sort(), contact.filter((c) => c.id !== 'cv' || c.dataStatus !== 'placeholder').map((c) => c.id).sort());
});

test('every contact in the data has a station, so none gets an orphan or a missing board', () => {
  for (const c of contact) assert.ok(hasStation(c), `${c.id} has a station`);
  assert.deepEqual([...STATIONS], ['github', 'linkedin', 'email', 'cv']);
  assert.equal(slots().length, STATIONS.length);
  // an entry the plaza has no seat for is never counted by the achievement, which could never be completed otherwise
  assert.equal(interactiveContacts([{ id: 'twitch', dataStatus: 'verified' }, ...contact]).length, interactiveContacts().length);
  for (const id of Object.keys(STATION_ICONS)) assert.ok(STATIONS.includes(id));
});

test('Say hello needs one mark for every contact that opens something', () => {
  assert.equal(WORLD2_ACHIEVEMENT_BY_ID.social.target, interactiveContacts().length);
  assert.ok(WORLD2_ACHIEVEMENT_BY_ID.social.unique);
});

test('board values are the handle without the host the logo says; a pending entry says "On request"', () => {
  assert.equal(shortValue({ id: 'github', value: 'github.com/Ale-Newport', dataStatus: 'verified' }), 'Ale-Newport');
  assert.equal(shortValue({ id: 'linkedin', value: 'linkedin.com/in/alejandro-newport', dataStatus: 'placeholder' }), 'in/alejandro-newport');
  assert.equal(shortValue({ id: 'email', value: 'hello@alejandronewport.com', dataStatus: 'placeholder' }), 'hello@alejandronewport.com');
  assert.equal(shortValue({ id: 'cv', value: 'PDF · 2026', dataStatus: 'placeholder' }), 'On request');
  assert.equal(shortValue({ id: 'cv', value: 'PDF · 2026', dataStatus: 'verified' }), 'PDF · 2026');
});

/* -------------------------------------------------------------- the real level (golden) -- */

// The surgery was written against the authored world.glb. If a re-export changes the level (a renamed node, another number of
// pads), `arrange` returns null and the plaza silently falls back to the old arc; this is where that is noticed instead.
import fs from 'node:fs';
import { RETIRED, REPLACED } from '../../public/archipelago/preview/portfolio/world2/interactions/Social.js';

const GLB = 'public/archipelago/assets/environment/portfolio/models/world.glb';
const hasGlb = fs.existsSync(GLB) && fs.statSync(GLB).size > 1e6;

/** Just enough of a .glb reader: the node tree with world matrices, and the geometry of a mesh node. */
function readGlb(file) {
  const data = fs.readFileSync(file);
  const jsonLength = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8'));
  const binStart = 20 + jsonLength + 8;
  const bin = data.subarray(binStart, binStart + data.readUInt32LE(20 + jsonLength));
  const world = new Map(), parent = new Map();
  json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
  const local = (n) => new THREE.Matrix4().compose(
    new THREE.Vector3(...(n.translation ?? [0, 0, 0])), new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])), new THREE.Vector3(...(n.scale ?? [1, 1, 1])));
  const matrixOf = (i) => {
    if (!world.has(i)) world.set(i, parent.has(i) ? matrixOf(parent.get(i)).clone().multiply(local(json.nodes[i])) : local(json.nodes[i]));
    return world.get(i);
  };
  const byName = new Map();
  json.nodes.forEach((n, i) => byName.set(n.extras?.w2Source ?? n.name, i));
  const accessor = (index) => {
    const a = json.accessors[index], view = json.bufferViews[a.bufferView];
    const Type = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }[a.componentType];
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type];
    const offset = binStart - binStart + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const copy = new Uint8Array(a.count * size * Type.BYTES_PER_ELEMENT);
    copy.set(bin.subarray(offset, offset + copy.length));
    return new Type(copy.buffer);
  };
  const geometryOf = (name) => {
    const node = json.nodes[byName.get(name)];
    const primitive = json.meshes[node.mesh].primitives[0];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(accessor(primitive.attributes.POSITION), 3));
    g.setIndex(new THREE.BufferAttribute(accessor(primitive.indices), 1));
    return g;
  };
  return { json, byName, position: (name) => new THREE.Vector3().setFromMatrixPosition(matrixOf(byName.get(name))), matrix: (name) => matrixOf(byName.get(name)), geometryOf };
}

test('the authored level is the one the plaza surgery expects', { skip: !hasGlb && 'world.glb is not in this checkout' }, () => {
  const glb = readGlb(GLB);
  for (const name of [...RETIRED, ...REPLACED, 'gitHubPhysicalDynamic', 'linkedInPhysicalDynamic', 'mailPhysicalDynamic', 'refCenter', 'Cube.133', 'twitchPhysicalDynamic']) {
    assert.ok(glb.byName.has(name), `the level has a node called ${name}`);
  }
  const pads = glb.geometryOf('Cube.133');
  const pieces = splitPieces(pads);
  assert.equal(pieces.length, 10, 'dais + nine pads in one merged mesh');
  assert.deepEqual(pieces.map((p) => p.triangles.length).sort((a, b) => a - b), [...Array(9).fill(42), 118]);
  assert.equal(pads.index.count / 3, 496);

  const world = glb.matrix('Cube.133');
  const dais = glb.position('refCenter');
  const centres = pieces.map((p) => p.box.getCenter(new THREE.Vector3()).applyMatrix4(world));
  const at = (name) => { const p = glb.position(name); return { x: p.x, z: p.z }; };
  const anchors = { github: at('gitHubPhysicalDynamic'), linkedin: at('linkedInPhysicalDynamic'), email: at('mailPhysicalDynamic'), cv: at('twitchPhysicalDynamic') };
  const keep = selectKeepers(centres, { x: dais.x, z: dais.z }, anchors);
  assert.ok(keep, 'the dais and one pad per contact are found');
  assert.deepEqual(keep.map((k) => k.id).sort(), ['cv', 'dais', 'email', 'github', 'linkedin']);
  const kept = keep.reduce((n, k) => n + pieces[k.index].triangles.length, 0);
  assert.equal(kept, 118 + 4 * 42, 'the pad mesh keeps 286 of its 496 triangles');
  // every kept pad is the authored 0.47 g curb (the AABB of a pad turned tangent to the arc is wider than its 1.69 g side, so only the height is exact)
  for (const k of keep.filter((k) => k.id !== 'dais')) {
    const size = pieces[k.index].box.getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.y - PLAZA.padTop) < 0.02 && size.x >= 1.65 && size.z >= 1.65 && size.x < 2.45 && size.z < 2.45, `${k.id} pad is ${size.toArray().map((v) => v.toFixed(2))}`);
  }
  // the dropped pads are the ones the retired platforms and the fan stood on: none is within reach of a kept contact
  for (const [index, c] of centres.entries()) {
    if (keep.some((k) => k.index === index)) continue;
    for (const [id, a] of Object.entries(anchors)) assert.ok(Math.hypot(a.x - c.x, a.z - c.z) >= PLAZA.ownerReach, `a dropped pad is ${id}'s neighbour`);
  }
});

/* -------------------------------------------------------------- pieces of the controller that need no level -- */

import { standingLevel } from '../../public/archipelago/preview/portfolio/world2/interactions/socialLayout.js';
import { reachFloor, steady, arrange, documentGeometry, BOARD, PROMPT } from '../../public/archipelago/preview/portfolio/world2/interactions/Social.js';

test('standingLevel finds the recessed tile an icon stands on, not the rim round it', () => {
  // a 2 x 2 pad: a rim 0.473 high (an annulus of area 4 - 1.5^2) and a recessed tile 0.427 high (1.5 x 1.5), both facing up
  const g = new THREE.BufferGeometry();
  const p = [], i = [];
  const quad = (x0, z0, x1, z1, y) => { const o = p.length / 3; p.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1); i.push(o, o + 2, o + 1, o, o + 3, o + 2); };
  quad(-0.75, -0.75, 0.75, 0.75, 0.427);                                     // tile
  quad(-1, -1, 1, -0.75, 0.473); quad(-1, 0.75, 1, 1, 0.473); quad(-1, -0.75, -0.75, 0.75, 0.473); quad(0.75, -0.75, 1, 0.75, 0.473);   // rim
  // the four walls of the recess join the tile to the rim (so it is one piece, as a pad is); they face inward, not up
  const wall = (ax, az, bx, bz) => { const o = p.length / 3; p.push(ax, 0.427, az, bx, 0.427, bz, bx, 0.473, bz, ax, 0.473, az); i.push(o, o + 1, o + 2, o, o + 2, o + 3); };
  wall(-0.75, -0.75, 0.75, -0.75); wall(0.75, -0.75, 0.75, 0.75); wall(0.75, 0.75, -0.75, 0.75); wall(-0.75, 0.75, -0.75, -0.75);
  quad(-0.5, -0.5, 0.5, 0.5, 0.01);                                          // a small separate quad facing up: not part of the pad
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(i);
  const pieces = splitPieces(g).sort((a, b) => b.triangles.length - a.triangles.length);
  assert.equal(pieces.length, 2, 'the pad (tile + walls + rim) and the stray quad');
  const [piece] = pieces;
  assert.ok(Math.abs(standingLevel(g, piece) - 0.427) < 1e-6, `got ${standingLevel(g, piece)}`);
  const rim = new THREE.BufferGeometry();
  rim.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.2, 0, 0, 0.2, 1, 1, 0.2, 0], 3));
  rim.setIndex([0, 1, 2]);
  assert.ok(Math.abs(standingLevel(rim, splitPieces(rim)[0]) - 0.2) < 1e-6, 'a single surface is its own level');
  const down = new THREE.BufferGeometry();
  down.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.2, 0, 1, 0.2, 0, 0, 0.2, 1], 3));
  down.setIndex([0, 1, 2]);
  assert.ok(Math.abs(standingLevel(down, splitPieces(down)[0]) - 0.2) < 1e-6, 'with nothing facing up it falls back to the top of the piece');
});

/** An icon like the authored ones: a root (scaled, turned) with a collider child whose bottom is above the root's feet. */
function icon({ scale = 1.3, yaw = 1.8, bottom = 1.0, half = 0.9 } = {}) {
  const parent = new THREE.Group();
  const root = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1));
  root.scale.setScalar(scale);
  root.rotation.y = yaw;
  root.position.y = 2;
  parent.add(root);
  const collider = new THREE.Object3D();
  collider.userData = { w2Role: 'collider', w2Shape: 'tube', w2DisplaySize: 0.5 };
  collider.scale.set(1.2 / scale, 2 * half / scale, 1.2 / scale);     // world size 1.2 x 2*half x 1.2 once the root's scale is applied
  collider.position.y = (bottom + half - 2) / scale;                  // root-local: the root stands at y = 2, the collider's world centre is bottom + half
  root.add(collider);
  parent.updateMatrixWorld(true);
  const world = () => { collider.updateWorldMatrix(true, false); const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); collider.matrixWorld.decompose(p, q, s); return { bottom: p.y - s.y * 0.5, top: p.y + s.y * 0.5, sx: s.x, sz: s.z }; };
  return { root, collider, world };
}

test('reachFloor grows the lowest collider down to the floor and nowhere else', () => {
  const { root, world } = icon({ bottom: 1.0, half: 0.9 });
  const before = world();
  assert.ok(Math.abs(before.bottom - 1.0) < 1e-9);
  reachFloor(root, 0.427);
  const after = world();
  assert.ok(Math.abs(after.bottom - 0.427) < 1e-9, `bottom ${after.bottom}`);
  assert.ok(Math.abs(after.top - before.top) < 1e-9, 'the top stays where it was');
  assert.ok(Math.abs(after.sx - before.sx) < 1e-12 && Math.abs(after.sz - before.sz) < 1e-12, 'width and depth are untouched');
});

test('reachFloor never grows a collider below the floor, and leaves one that already reaches it', () => {
  const low = icon({ bottom: 0.3, half: 0.4 });
  const before = low.world();
  reachFloor(low.root, 0.427);
  assert.deepEqual(low.world(), before, 'a collider already under the floor is not touched');
  const near = icon({ bottom: 0.43, half: 0.5 });
  reachFloor(near.root, 0.427);
  assert.ok(near.world().bottom > 0.42 && near.world().bottom < 0.431, 'within a few millimetres is left alone');
});

test('reachFloor leaves tilted colliders and non-colliders alone', () => {
  const tilted = icon();
  tilted.collider.rotation.x = 0.6;
  tilted.root.updateMatrixWorld(true);
  const before = tilted.collider.scale.clone();
  reachFloor(tilted.root, 0.2);
  assert.ok(tilted.collider.scale.equals(before), 'a tilted collider is not stretched along the wrong axis');
  const plain = new THREE.Group();
  plain.add(new THREE.Object3D());
  reachFloor(plain, 0);                                                    // no colliders at all: no throw
});

test('the CV document is one small mesh on the level palette that fits the pad', () => {
  const g = documentGeometry();
  const triangles = g.getAttribute('position').count / 3;
  assert.ok(triangles > 100 && triangles < 400, `${triangles} triangles`);
  for (const name of ['position', 'normal', 'uv']) assert.ok(g.getAttribute(name), name);
  assert.ok(Array.from(g.getAttribute('position').array).every(Number.isFinite));
  g.computeBoundingBox();
  const size = g.boundingBox.getSize(new THREE.Vector3());
  assert.ok(size.y > 1.6 && size.y < 2.1 && size.x < 1.3 && size.z < 0.8, `size ${size.toArray().map((v) => v.toFixed(2))}`);
  assert.ok(Math.abs(g.boundingBox.min.y) < 1e-6, 'it stands on y = 0');
  // every uv lands on a palette swatch: a texel centre in 32 swatches of the atlas
  const uv = g.getAttribute('uv');
  for (let k = 0; k < uv.count; k++) { const u = uv.getX(k) * 32 - 0.5; assert.ok(Math.abs(u - Math.round(u)) < 1e-6, `uv ${uv.getX(k)}`); }
});

test('a board stands clear of the ground, leans back, and is wide enough to read', () => {
  assert.ok(BOARD.bottom * 0.7 * Math.cos(BOARD.lean) > 1.5, 'a car (1.3 m) drives under the face, between its posts');
  assert.ok(BOARD.lean > 0 && BOARD.lean < 0.35, 'a slant, not a ramp');
  assert.ok(BOARD.width * 0.7 >= 2.2, 'at least the 2.2 m the audit measured the plates against');
});

/* ---- what stops a prop tipping off its pad ------------------------------------------------------------------------------ */

/** A prop root with upright collider children: `[centre, size]` in the root's own frame (size is the full extent, as the level authors it). */
function prop(parts, { scale = 1.3, yaw = 0 } = {}) {
  const root = new THREE.Group();
  root.scale.setScalar(scale);
  root.rotation.y = yaw;
  parts.forEach(([at, size, shape = 'cuboid'], i) => {
    const c = new THREE.Object3D();
    c.name = `part${i}`;
    c.userData = { w2Role: 'collider', w2Shape: shape, w2DisplaySize: 0.5 };
    c.position.set(...at);
    c.scale.set(...size);
    root.add(c);
  });
  root.updateMatrixWorld(true);
  return root;
}
/** What the physics layer makes of a body's colliders: equal shares of the mass, so the centre of mass is the mean of the centres. */
function centreOfMass(root) {
  const cs = root.children.filter((c) => c.userData.w2Role === 'collider');
  return new THREE.Vector3(...[0, 1, 2].map((k) => cs.reduce((sum, c) => sum + c.position.toArray()[k], 0) / cs.length));
}
/** The authored mailbox, in its own frame: a narrow post at the back and a box that overhangs it by a box length. */
const mailbox = (options) => prop([[[0, -0.299, -1.012], [0.405, 0.666, 0.428]], [[0, 0.509, -0.513], [1.06, 1.003, 2.174]]], options);

test('steady gives the overhanging mailbox a foot: its centre of mass sits over the post only by chance, and a wake-up tips it off the pad', () => {
  const root = mailbox();
  const post = root.children[0], before = centreOfMass(root);
  assert.ok(before.z > post.position.z + post.scale.z * 0.5, 'as authored the centre of mass is OUTSIDE the post\'s footprint (the physics layer weighs every collider the same)');
  const foot = steady(root);
  assert.ok(foot, 'a foot was added');
  assert.equal(foot.userData.w2Role, 'collider');
  assert.equal(foot.visible, false, 'invisible');
  const half = foot.scale.clone().multiplyScalar(0.5);
  const lowest = post.position.y - post.scale.y * 0.5;
  assert.ok(near(foot.position.y - half.y, lowest, 1e-9), 'it stands at the floor the post stands on');
  assert.ok(half.y * 2 * 1.3 <= 0.05 + 1e-9, `five centimetres thick at most (${half.y * 2 * 1.3} m in the root\'s scale)`);
  // the foot covers the post
  assert.ok(foot.position.x - half.x <= -post.scale.x * 0.5 + 1e-9 && foot.position.x + half.x >= post.scale.x * 0.5 - 1e-9);
  assert.ok(foot.position.z - half.z <= post.position.z - post.scale.z * 0.5 + 1e-9 && foot.position.z + half.z >= post.position.z + post.scale.z * 0.5 - 1e-9);
  // ...and the new centre of mass (the foot is one more equal share) is over it by 30 degrees of lean in every direction
  const com = centreOfMass(root), lean = Math.tan(30 * DEG) * (com.y - (foot.position.y - half.y));
  assert.ok(com.x - lean >= foot.position.x - half.x - 1e-6 && com.x + lean <= foot.position.x + half.x + 1e-6, 'steady sideways');
  assert.ok(com.z - lean >= foot.position.z - half.z - 1e-6 && com.z + lean <= foot.position.z + half.z + 1e-6, `steady back and forth (com z ${com.z.toFixed(3)} over ${(foot.position.z - half.z).toFixed(3)}..${(foot.position.z + half.z).toFixed(3)} with ${lean.toFixed(3)} of lean)`);
  assert.equal(root.children.length, 3);
});

test('steady leaves a prop whose centre of mass is over the middle of its lowest collider exactly as it was', () => {
  // the CV's document: a sheet on a wide foot
  const cv = prop([[[0, 1.2, 0], [1.0, 1.34, 0.09]], [[0, 0.06, 0.02], [1.1, 0.12, 0.62]]]);
  assert.equal(steady(cv), null);
  assert.equal(cv.children.length, 2);
  // a single icon is its own centre of mass
  const single = prop([[[0, 0, 0], [1.2, 1.6, 1.2], 'tube']]);
  assert.equal(steady(single), null);
  assert.equal(steady(new THREE.Group()), null);
});

test('steady understands upright cuboids and tubes only: a tilted or round part leaves the prop alone', () => {
  const tilted = mailbox();
  tilted.children[1].rotation.x = 0.5;
  tilted.updateMatrixWorld(true);
  assert.equal(steady(tilted), null);
  const ball = mailbox();
  ball.children[1].userData.w2Shape = 'ball';
  assert.equal(steady(ball), null);
});

test('steady follows a part turned about the vertical: a body turned 90 degrees swaps its footprint\'s axes', () => {
  const turned = mailbox();
  const body = turned.children[1];
  body.rotation.y = Math.PI / 2;           // the box now runs along x, so it overhangs sideways
  body.position.set(0.5, 0.509, -1.012);
  turned.updateMatrixWorld(true);
  const foot = steady(turned);
  assert.ok(foot, 'the centre of mass is off the post sideways now');
  const post = turned.children[0];
  assert.ok(foot.scale.x > post.scale.x * 1.3, 'so the foot grows along x');
});

/* ---- the plaza, arranged, on a stand-in for the level ------------------------------------------------------------------- */

/**
 * The level's pad mesh, dais and four icons at the numbers the real level has (frame coordinates, g): eight pads on a 7.85 g half circle round the
 * dais, one far away by the fan, and the mailbox's origin 0.57 g in front of its pad's centre with the post at the pad's rear edge.
 */
function level() {
  const group = new THREE.Group(), nodes = new Map(), meshes = [];
  const dais = { x: 25.95, z: -18.09 };
  const material = new THREE.MeshBasicMaterial();
  const add = (name, object, at) => { object.name = name; object.userData.w2Source = name; object.position.set(...at); group.add(object); nodes.set(name, object); return object; };
  add('refCenter', new THREE.Object3D(), [dais.x, 1.54, dais.z]);
  const padCentres = { github: [21.06, -24.23], linkedin: [18.88, -21.5], email: [27.7, -25.745], twitch: [24.2, -25.75] };
  const positions = [], index = [];
  const quad = (cx, cz, yaw, half) => {
    const o = positions.length / 3;
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) positions.push(cx + (x * Math.cos(yaw) + z * Math.sin(yaw)) * half, 0.427, cz + (-x * Math.sin(yaw) + z * Math.cos(yaw)) * half);
    index.push(o, o + 2, o + 1, o, o + 3, o + 2);
  };
  quad(dais.x, dais.z, 0, 1.3);
  for (const [cx, cz] of Object.values(padCentres)) quad(cx, cz, authoredYaw({ x: cx, z: cz }, dais), 0.8436);
  quad(38.7, -33.18, 0, 0.8436);                                                       // the pad by the fan: no contact has it
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(positions.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geometry.setIndex(index);
  const pads = add('Cube.133', new THREE.Mesh(geometry, material), [0, 0, 0]);
  pads.userData.w2Role = 'visual';
  const icon = (name, origin, colliders, visual) => {
    const root = new THREE.Group();
    root.userData = { w2Role: 'physical', w2Body: 'dynamic', mass: 1 };
    for (const [at, size, shape = 'cuboid'] of colliders) { const c = new THREE.Object3D(); c.userData = { w2Role: 'collider', w2Shape: shape, w2DisplaySize: 0.5 }; c.position.set(...at); c.scale.set(...size); root.add(c); }
    for (const [at, size] of visual) { const m = new THREE.Mesh(new THREE.BoxGeometry(...size), material); m.position.set(...at); root.add(m); }
    return add(name, root, origin);
  };
  icon('gitHubPhysicalDynamic', [21.05, 1.51, -24.23], [[[0, -0.047, 0], [1, 1.617, 1], 'tube']], [[[0, 0.05, 0], [1.2, 1.8, 1]]]);
  icon('linkedInPhysicalDynamic', [18.85, 1.54, -21.5], [[[0, -0.01, 0], [1.358, 1.305, 0.195]]], [[[0, 0, 0], [1.5, 1.33, 0.1]]]);
  icon('mailPhysicalDynamic', [27.68, 1.06, -25.18], [[[0, -0.299, -1.012], [0.405, 0.666, 0.428]], [[0, 0.509, -0.513], [1.06, 1.003, 2.174]]], [[[0, -0.299, -1.012], [0.4, 0.66, 0.43]], [[0, 0.509, -0.513], [1.06, 1.0, 2.17]]]);
  icon('twitchPhysicalDynamic', [24.21, 1.46, -25.81], [[[0, 0.17, 0.02], [1, 1.2, 0.2]]], [[[0, 0.17, 0], [1.6, 1.7, 0.1]]]);
  add('physicalFixed.002', new THREE.Group(), [0, 0, 0]);
  add('refFan', new THREE.Group(), [38.7, 1, -33.18]);
  return { environment: { nodes, group, meshes }, pads, padCentres, dais };
}

/** Footprint of a prop's lowest colliders in the plaza's own axes, g from a seat: right on the screen, toward the lens. */
function stood(root, seat, psi) {
  root.updateWorldMatrix(true, true);
  const right = [Math.cos(psi), -Math.sin(psi)], lens = [Math.sin(psi), Math.cos(psi)];
  const boxes = [];
  root.traverse((c) => {
    if (c.userData.w2Role !== 'collider' || c.isMesh) return;
    const b = { r: [Infinity, -Infinity], l: [Infinity, -Infinity], bottom: Infinity };
    for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
      const p = new THREE.Vector3(sx, sy, sz).applyMatrix4(c.matrixWorld), dx = p.x - seat.x, dz = p.z - seat.z;
      const r = dx * right[0] + dz * right[1], l = dx * lens[0] + dz * lens[1];
      b.r = [Math.min(b.r[0], r), Math.max(b.r[1], r)]; b.l = [Math.min(b.l[0], l), Math.max(b.l[1], l)]; b.bottom = Math.min(b.bottom, p.y);
    }
    boxes.push(b);
  });
  const low = Math.min(...boxes.map((b) => b.bottom)), on = boxes.filter((b) => b.bottom < low + 0.05);
  return { right: [Math.min(...on.map((b) => b.r[0])), Math.max(...on.map((b) => b.r[1]))], lens: [Math.min(...on.map((b) => b.l[0])), Math.max(...on.map((b) => b.l[1]))], bottom: low };
}

test('arrange puts every icon ON its pad, the mailbox included (its post stands at the rear edge of its pad, 0.6 g behind the icon\'s own origin)', () => {
  const { environment } = level();
  const layout = arrange(environment, { rotation: FRAME, theta: THETA });
  assert.ok(layout, 'the stand-in level is recognised');
  assert.ok(near(layout.psi, PSI, 1e-9));
  const half = 0.8436 * PLAZA.padScale;
  for (const [id, name] of [['github', 'gitHubPhysicalDynamic'], ['linkedin', 'linkedInPhysicalDynamic'], ['email', 'mailPhysicalDynamic']]) {
    const on = stood(environment.nodes.get(name), layout.seats[id], layout.psi);
    assert.ok(on.right[0] > -half && on.right[1] < half && on.lens[0] > -half && on.lens[1] < half,
      `${id}: footprint right ${on.right.map((v) => v.toFixed(2))} lens ${on.lens.map((v) => v.toFixed(2))} must lie inside the pad (+-${half.toFixed(2)})`);
    assert.ok(Math.abs(on.bottom - layout.padTop) < 0.06, `${id}: rests on the tile (${on.bottom.toFixed(3)} vs ${layout.padTop.toFixed(3)})`);
  }
  // the one that stood in the air before: its post was 1.3 g behind the seat, past the pad's rear edge (-1.10)
  const mail = stood(environment.nodes.get('mailPhysicalDynamic'), layout.seats.email, layout.psi);
  assert.ok(mail.lens[0] > -0.9, `the post's rear edge is at the pad's (${mail.lens[0].toFixed(2)})`);
  // icons are squared to the lens and a little larger
  for (const name of ['gitHubPhysicalDynamic', 'linkedInPhysicalDynamic', 'mailPhysicalDynamic']) {
    const node = environment.nodes.get(name);
    assert.ok(near(node.getWorldScale(new THREE.Vector3()).x, PLAZA.iconScale, 1e-9), `${name} is ${PLAZA.iconScale}x`);
    assert.ok(near(yawOf(node.getWorldQuaternion(new THREE.Quaternion())), layout.psi, 1e-6), `${name} faces the lens`);
  }
});

test('arrange steadies the mailbox and nothing else, and what it replaced is flagged so the physics layer builds no body from it', () => {
  const { environment } = level();
  arrange(environment, { rotation: FRAME, theta: THETA });
  const feet = (name) => environment.nodes.get(name).children.filter((c) => c.name === 'cuboid.foot').length;
  assert.equal(feet('mailPhysicalDynamic'), 1);
  for (const name of ['gitHubPhysicalDynamic', 'linkedInPhysicalDynamic']) assert.equal(feet(name), 0, name);
  const cv = environment.nodes.get('cvPhysicalDynamic');
  assert.ok(cv && cv.children.filter((c) => c.userData.w2Role === 'collider').length === 2, 'the CV document has its two colliders and no foot');
  for (const name of REPLACED) assert.equal(environment.nodes.get(name).userData.w2Replaced, true, name);
  // the pad mesh keeps the dais and the four pads: 5 quads of 2 triangles, bounds a plaza wide, not the level wide
  assert.equal(environment.nodes.get('Cube.133').geometry.index.count / 3, 10);
  const box = new THREE.Box3().setFromBufferAttribute(environment.nodes.get('Cube.133').geometry.getAttribute('position'));
  assert.ok(box.getSize(new THREE.Vector3()).length() < 20, `bounds ${box.getSize(new THREE.Vector3()).toArray().map((v) => v.toFixed(1))}`);
});

test('arrange gives the same stations whatever the pad centres were: the icon travels with its pad, not with its own origin', () => {
  const a = level(), b = level();
  // move the mailbox's origin 0.5 g further forward of its pad: the post, being at the pad's centre, would have to stay on the tile
  b.environment.nodes.get('mailPhysicalDynamic').position.z += 0.4;
  const first = arrange(a.environment, { rotation: FRAME, theta: THETA }), second = arrange(b.environment, { rotation: FRAME, theta: THETA });
  assert.deepEqual(Object.keys(first.seats), Object.keys(second.seats));
  for (const id of STATIONS) { assert.ok(near(first.seats[id].x, second.seats[id].x, 1e-9) && near(first.seats[id].z, second.seats[id].z, 1e-9), `${id} seat is the pad's, not the icon's`); }
});

test('a prompt floats above a car\'s roof and toward the lens, where a stopped car cannot cover it', () => {
  assert.ok(PROMPT.height * 0.7 > 1.6, 'higher than a 1.6 m roof');
  assert.ok(PROMPT.toward > 0, 'a solid icon would hide a prompt placed inside it');
  assert.ok(PROMPT.toward > 0.8 * PLAZA.padScale && PROMPT.toward < 2, 'in front of the pad\'s edge (a car need not climb its curb to be in reach, 2.5 g), not far from it');
});

/* ---- travelling here from the M map ----------------------------------------------------------------------------------- */

test('the arrival spots are on the line from the dais toward the lens, nearest first, in world metres whatever the instance scale', () => {
  const dais = { x: 3.2, z: -7.5 };
  for (const scale of [0.7, 1, 1.5]) {
    const spots = arrivalSpots(PSI, dais, scale);
    assert.equal(spots.length, ARRIVAL.distances.length + ARRIVAL.swings.length);
    const d = lensDirection(PSI);
    spots.slice(0, ARRIVAL.distances.length).forEach((s, i) => {
      const g = Math.hypot(s.x - dais.x, s.z - dais.z);
      assert.ok(near(g * scale, ARRIVAL.distances[i], 1e-9), `spot ${i} is ${ARRIVAL.distances[i]} m from the dais at scale ${scale} (${g * scale})`);
      assert.ok(near(((s.x - dais.x) * d.x + (s.z - dais.z) * d.z) / g, 1, 1e-12), `spot ${i} is on the lens axis`);
    });
    spots.slice(ARRIVAL.distances.length).forEach((s, i) => {
      const [metres, degrees] = ARRIVAL.swings[i];
      const g = Math.hypot(s.x - dais.x, s.z - dais.z);
      assert.ok(near(g * scale, metres, 1e-9), `swing ${i} is ${metres} m from the dais at scale ${scale} (${g * scale})`);
      const turned = Math.acos(((s.x - dais.x) * d.x + (s.z - dais.z) * d.z) / g) / DEG;
      assert.ok(near(turned, Math.abs(degrees), 1e-6), `swing ${i} is ${degrees} degrees off the lens axis (${turned})`);
    });
  }
  assert.ok(ARRIVAL.distances.every((m, i, all) => i === 0 || m > all[i - 1]), 'nearest first');
  assert.ok(ARRIVAL.distances[0] > PLAZA.radius * 0.7, 'the first spot is farther from the dais than the stations are (4.9 m): in front of the arc, not inside it');
  assert.ok(ARRIVAL.dynamicMargin > 0 && ARRIVAL.dynamicMargin <= 0.35, 'a clearance from the icons that leaves 15 cm for them to settle after the first arrival wakes them (they clear the 5.5 m pose by 0.50 m at rest, 0.47 m after)');
});

test('the swings are for a prop pushed onto the axis: on the lens side, off the line, past the first spot, and clear of every pad', () => {
  const stations = slots({ radius: PLAZA.radius * 0.7 });                       // P frame, in metres at the instance's 0.7
  for (const [metres, degrees] of ARRIVAL.swings) {
    assert.ok(Math.abs(degrees) >= 8 && Math.abs(degrees) <= 25, `${metres} m at ${degrees} degrees: beside the axis, still in front of the plaza`);
    assert.ok(metres >= ARRIVAL.distances[0] && metres <= 10, `${metres} m: no closer than the first spot, close enough to read the boards from`);
    const p = { x: metres * Math.sin(degrees * DEG), z: metres * Math.cos(degrees * DEG) };
    for (const s of stations) assert.ok(Math.hypot(p.x - s.x, p.z - s.z) > 2.3, `${metres} m at ${degrees} degrees is ${Math.hypot(p.x - s.x, p.z - s.z).toFixed(2)} m from the station at ${s.angle} degrees: a 2.7 m car does not stand on a pad`);
  }
  assert.ok(ARRIVAL.swings.some(([, d]) => d < 0) && ARRIVAL.swings.some(([, d]) => d > 0), 'to both sides');
  const all = [...ARRIVAL.distances, ...ARRIVAL.swings.map(([m]) => m)];
  assert.ok(Math.max(...all) <= 10, 'the farthest arrival still has the plaza in the first frame (the generic search, 11.9 m west, did not)');
});

test('yawToward is what Object3D.lookAt made of a level target: the /world2 plates face the car as they did before the plaza was arranged', () => {
  // The legacy plates are turned every tick toward the car; the /world2 route has no camera to hand to Billboards, and
  // world2-interaction-qa.mjs asks every plate's normal to point at the car (cos > 0.6).
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 200;
  for (let i = 0; i < 200; i++) {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.59), new THREE.MeshBasicMaterial());
    const group = new THREE.Group();
    group.add(plate);
    plate.position.set(random(), random() / 20, random());
    const car = { x: random(), z: random() };
    plate.lookAt(car.x, plate.position.y, car.z);
    const expected = plate.quaternion.clone();
    plate.rotation.set(0, 0, 0);
    plate.rotation.y = yawToward(plate.position, car);
    assert.ok(plate.quaternion.angleTo(expected) < 1e-6, `plate ${i}: ${plate.quaternion.angleTo(expected)} rad off lookAt`);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(plate.quaternion), to = new THREE.Vector3(car.x - plate.position.x, 0, car.z - plate.position.z).normalize();
    assert.ok(normal.dot(to) > 1 - 1e-9, 'the reading face points at the car');
  }
  assert.equal(yawToward({ x: 1, z: 1 }, { x: 1, z: 1 }), 0, 'a car exactly on the plate: no NaN');
});

/** A Placement with just what arrivalFor asks of it: every pose is valid unless `valid` says otherwise. */
function stub({ valid = () => true, clear = () => true, declared = [] } = {}) {
  const checks = [];
  return {
    checks, arrivalPoints: new Set(declared),
    cameraHeading: () => 3 * Math.PI / 4,
    check(x, z, heading, options) { checks.push({ x, z, heading, options }); return valid(x, z, heading, options) ? { ok: true, x, z, heading, y: 0, slope: 0, position: new THREE.Vector3(x, 1.1, z), rotation: heading } : { ok: false, reason: 'props', x, z }; },
    cameraClear: (x, y, z) => clear(x, y, z),
    heading: () => null, near: () => null, surface: () => null, inBounds: () => true,
  };
}
const spots = [{ x: 30, z: 46, heading: 1 }, { x: 31, z: 47, heading: 1 }, { x: 32, z: 48, heading: 1 }];
const CAMERA = 3 * Math.PI / 4;                                                  // the stub's chase camera: the car faces away from it
const declaration = (extra = {}) => ({ name: 'Contact', poses: spots, dynamicMargin: ARRIVAL.dynamicMargin, reach: 14, ...extra });
const contactGroup = (x = 23, z = 44) => {
  const group = new THREE.Group();
  group.name = 'Contact';
  group.userData.recommendedClearance = 3;
  const floor = new THREE.Mesh(new THREE.BoxGeometry(12, 0.1, 12), new THREE.MeshBasicMaterial());
  floor.position.set(x, 0, z);
  group.add(floor);
  return group;
};

test('a place that declared its arrival is where its map place AND the prompts around it put the car, facing away from the camera', () => {
  for (const target of [{ group: contactGroup(), name: 'Contact' }, { group: null, x: 25, z: 47.7, name: 'GitHub +2' }]) {
    const placement = stub({ declared: [declaration()] });
    const pose = arrivalFor(placement, target);
    assert.equal(pose.ok, true);
    assert.equal(pose.source, 'declared');
    assert.equal(pose.name, 'Contact');
    assert.ok(near(pose.x, 30) && near(pose.z, 46), 'the first pose');
    assert.ok(near(pose.heading, CAMERA), 'the camera behind the car, as it is now (not the declared heading, not turned toward the most open ground)');
    assert.equal(placement.checks.length, 1, 'and nothing else is searched');
    assert.deepEqual(placement.checks[0].options, { margin: 0.8, dynamicMargin: ARRIVAL.dynamicMargin, maxEdge: 4 }, 'validated like an arrival: 0.8 m from fixed colliders, the declared clearance from anything that moves');
  }
});

test('the car faces away from the chase camera wherever the player dragged it; the declared heading serves when there is no camera to ask', () => {
  const wrapped = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  for (const theta of [0, Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, -Math.PI / 4, 2 * Math.PI]) {
    // View.cameraDirection: from the camera toward the car, level
    const away = Math.atan2(Math.cos(theta), -Math.sin(theta));                  // headingOf(new Vector3(-sin t, 0, -cos t))
    const placement = stub({ declared: [declaration()] });
    placement.cameraHeading = () => away;
    const pose = arrivalFor(placement, { group: null, x: 25, z: 47, name: 'Email' });
    assert.equal(pose.source, 'declared');
    assert.ok(near(wrapped(pose.heading - away), 0, 1e-9), `camera at ${(theta / DEG).toFixed(0)} degrees: the car faces away from it (${pose.heading})`);
    assert.ok(near(wrapped(placement.checks[0].heading - away), 0, 1e-9), 'and that is the heading the pose was validated at');
    // behind the car means: camera-to-car dot car-forward is 1
    const forward = { x: Math.cos(pose.heading), z: -Math.sin(pose.heading) }, fromCamera = { x: -Math.sin(theta), z: -Math.cos(theta) };
    assert.ok(forward.x * fromCamera.x + forward.z * fromCamera.z > 1 - 1e-9, 'the camera is behind the car');
  }
  for (const heading of [null, undefined, NaN]) {
    const placement = stub({ declared: [declaration()] });
    placement.cameraHeading = () => heading;
    assert.ok(near(arrivalFor(placement, { group: null, x: 25, z: 47, name: 'Email' }).heading, 1), `no camera (${heading}): the declared heading`);
  }
});

test('a prop on the axis does not send the arrival to the path: a swing to one side serves (a mailbox is the prop that gets there)', () => {
  // The real geometry in an identity frame (1 g = 1 m), a 6.5 m mailbox with the clearance the car keeps from it, and everything else free.
  const dais = { x: 40, z: 10 };
  const poses = arrivalSpots(PSI, dais, 1).map((s) => ({ x: s.x, z: s.z, heading: 1 }));
  const mailbox = towardLens(dais, PSI, 6.5);
  const blocked = (x, z) => Math.hypot(x - mailbox.x, z - mailbox.z) < 2.3;           // body half-length 1.35 + margin 0.3 + the box's own half
  const placement = stub({ declared: [declaration({ poses })], valid: (x, z) => !blocked(x, z) });
  const pose = arrivalFor(placement, { group: null, x: 36, z: 12, name: 'Email' });
  assert.equal(pose.source, 'declared', 'still the plaza\'s own arrival');
  const distance = Math.hypot(pose.x - dais.x, pose.z - dais.z);
  assert.ok(distance <= 10.01, `${distance.toFixed(2)} m from the dais: in front of the plaza, not the generic search's 11.9 m west`);
  const d = lensDirection(PSI);
  assert.ok(((pose.x - dais.x) * d.x + (pose.z - dais.z) * d.z) / distance > Math.cos(25 * DEG), 'on the lens side');
  assert.ok(placement.checks.length > ARRIVAL.distances.length && placement.checks.length <= poses.length, 'the axis was tried first, then the swings, nearest first');
  // The mailbox on the axis at any of the axis distances: some pose serves every time.
  for (const metres of [5.5, 6, 6.5, 7, 8, 9]) {
    const box = towardLens(dais, PSI, metres);
    const there = stub({ declared: [declaration({ poses })], valid: (x, z) => Math.hypot(x - box.x, z - box.z) >= 2.3 });
    const out = arrivalFor(there, { group: null, x: 36, z: 12, name: 'Email' });
    assert.equal(out.source, 'declared', `prop at ${metres} m on the axis`);
  }
});

test('the next declared pose serves when the first is taken, and one the chase camera cannot see the car at is skipped', () => {
  const taken = stub({ declared: [declaration()], valid: (x) => x > 30.5 });
  assert.ok(near(arrivalFor(taken, { group: null, x: 25, z: 47, name: 'Email' }).x, 31), 'the second pose');
  const hidden = stub({ declared: [declaration()], clear: (x) => x > 31.5 });
  assert.ok(near(arrivalFor(hidden, { group: null, x: 25, z: 47, name: 'Email' }).x, 32), 'the third pose: the first two have something between the camera and the car');
  const none = stub({ declared: [declaration()], valid: () => false });
  const out = arrivalFor(none, { group: null, x: 25, z: 47, name: 'Email' });
  assert.equal(out.ok, false, 'nothing declared is valid: the generic search runs, and with no ground at all it says so');
  assert.notEqual(out.source, 'declared');
});

test('a declaration serves only what is within its reach: other places, a clicked point, and a Placement that never heard of it, are left alone', () => {
  const far = arrivalFor(stub({ declared: [declaration()] }), { group: null, x: -60, z: 20, name: 'Time machine' });
  assert.notEqual(far.source, 'declared');
  const farGroup = arrivalFor(stub({ declared: [declaration()] }), { group: contactGroup(-60, 20), name: 'Career' });
  assert.notEqual(farGroup.source, 'declared');
  const click = stub({ declared: [declaration()] });
  assert.notEqual(arrivalFor(click, { kind: 'point', x: 30, z: 46 }).source, 'declared', 'a clicked point goes exactly where it was clicked');
  const old = stub();
  delete old.arrivalPoints;
  assert.doesNotThrow(() => arrivalFor(old, { group: null, x: 25, z: 47, name: 'Email' }), 'a Placement without the registry');
});

test('a declared pose inside the group\'s landmark keep-out is skipped, as for every other arrival', () => {
  const group = contactGroup();
  const landmark = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 4), new THREE.MeshBasicMaterial());
  landmark.userData.landmark = true;
  landmark.position.set(30, 1.5, 46);
  group.add(landmark);
  const pose = arrivalFor(stub({ declared: [declaration({ poses: [{ x: 30, z: 46, heading: 2.356 }, { x: 45, z: 60, heading: 2.356 }] })] }), { group, name: 'Contact' });
  assert.equal(pose.source, 'declared');
  assert.ok(near(pose.x, 45), 'the pose in the landmark is skipped, the one clear of it is used');
});
