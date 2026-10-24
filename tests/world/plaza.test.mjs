import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { PLAZA, U, THETA, RIGHT, FORWARD, at, daisHeight, plazaArrival } from '../../public/archipelago/preview/portfolio/world2/interactions/PlazaLayout.js';
import { PROPS, groupStats } from '../../public/archipelago/preview/portfolio/world2/interactions/AchievementsPlaza.js';
import { Achievements, medalLayout } from '../../public/archipelago/preview/portfolio/world2/interactions/Achievements.js';
import { WORLD2_ACHIEVEMENTS } from '../../public/archipelago/preview/portfolio/world2/content/achievements.js';

// The Achievement plaza of /world. The layout is a table of numbers composed for ONE camera (azimuth 45 degrees, 41 degrees up,
// 21 m away), so the rules that make it work are checked here, on the numbers: nothing in the way of the car, everything inside the
// frame, the stage reachable, the doc's props kept off the drivable disc. The browser checks live in scripts/qa/world-plaza.mjs.

const deg = Math.PI / 180;
const CAR = { length: 2.9, width: 1.8 };
const POND_CORNER = [3.4, 7.4];       // the pond's front-east rim corner, from the asset's colliders
const POND_CENTRE = [-1.1, 3.1];
const dist = ([ax, az], [bx, bz]) => Math.hypot(ax - bx, az - bz);

/** The footprint of a sign in plan, as four corners (plaza metres), for a board of `width` at (x, z) facing the camera. */
function footprint([x, z], width, depth = 0.4) {
  const half = width / 2 + 0.2;
  return [[-half, -depth / 2], [half, -depth / 2], [half, depth / 2], [-half, depth / 2]].map(([r, f]) => [x + RIGHT[0] * r + FORWARD[0] * f, z + RIGHT[1] * r + FORWARD[1] * f]);
}
/** Smallest distance between two convex quads (sampled along their edges). */
function gap(a, b) {
  const edge = (poly) => poly.flatMap((p, i) => { const q = poly[(i + 1) % poly.length]; return Array.from({ length: 21 }, (_, k) => [p[0] + (q[0] - p[0]) * k / 20, p[1] + (q[1] - p[1]) * k / 20]); });
  let best = Infinity;
  for (const p of edge(a)) for (const q of edge(b)) best = Math.min(best, dist(p, q));
  return best;
}

test('the camera frame the layout is written in is the gameplay camera: 45 degrees, +x to the right of the screen', () => {
  assert.ok(Math.abs(THETA - Math.PI / 4) < 1e-12);
  // Screen-right on the ground is north-east, up the screen is north-west.
  assert.ok(Math.abs(RIGHT[0] - Math.SQRT1_2) < 1e-9 && Math.abs(RIGHT[1] + Math.SQRT1_2) < 1e-9);
  assert.ok(Math.abs(FORWARD[0] + Math.SQRT1_2) < 1e-9 && Math.abs(FORWARD[1] + Math.SQRT1_2) < 1e-9);
  assert.ok(Math.abs(U - 0.8) < 1e-12);
});

test('the dais is a ramp the car can climb: gentle skirts, nested tiers, no step anywhere', () => {
  const tiers = PLAZA.tiers;
  for (let i = 0; i < tiers.length; i++) {
    const [top, foot, height] = tiers[i];
    const below = i === 0 ? 0 : tiers[i - 1][2];
    // 0.12 m over 1.6 m is 4 degrees, 0.16 over 1.0 is 9: nothing steeper than a driveway.
    const slope = Math.atan((height - below) / (foot - top)) / deg;
    assert.ok(slope < 10, `tier ${i} skirt is ${slope.toFixed(1)} degrees`);
    assert.ok(foot > top && height > below);
    if (i > 0) assert.ok(foot <= tiers[i - 1][0] + 1e-9, 'a tier stands inside the flat top of the one below it');
  }
  // The profile is continuous: no jump bigger than the slope allows between two centimetres.
  let previous = daisHeight(0);
  for (let r = 0.01; r < tiers[0][1] + 0.5; r += 0.01) {
    const h = daisHeight(r);
    assert.ok(Math.abs(h - previous) < 0.01 * Math.tan(10 * deg) + 1e-9, `step at r = ${r.toFixed(2)}`);
    previous = h;
  }
  assert.equal(daisHeight(0), tiers[1][2]);
  assert.equal(daisHeight(tiers[0][1] + 1), 0);
  // The parked car fits on the top tier.
  assert.ok(tiers[1][0] * 2 >= CAR.length + 0.8, 'top tier is wide enough to park on');
});

test('the signs are in the frame the camera gives, in the order they read, with a way through', () => {
  const { boards, title } = PLAZA;
  const centres = boards.at.map((r) => at(r, boards.f));
  const quads = centres.map((c) => footprint(c, boards.w));
  // Four boards, left to right on the screen, none touching its neighbour.
  assert.equal(boards.at.length, 4);
  assert.deepEqual([...boards.at].sort((a, b) => a - b), boards.at);
  for (let i = 0; i < 3; i++) assert.ok(gap(quads[i], quads[i + 1]) > 0, `boards ${i} and ${i + 1} overlap`);
  // The gate between the middle two is wide enough for the car with room to spare (2.4 m is the layout's clearance rule).
  const opening = gap(quads[1], quads[2]);
  assert.ok(opening >= 2.4, `the gate is ${opening.toFixed(2)} m`);
  // The title stands clear of the dais skirt and of the first board, and to the left of everything on the screen.
  const titleAt = at(title.r, title.f);
  const titleQuad = footprint(titleAt, title.w);
  assert.ok(gap(titleQuad, quads[0]) >= 2.4, `the title and the first board leave ${gap(titleQuad, quads[0]).toFixed(2)} m: room for the car`);
  assert.ok(gap(titleQuad, quads[1]) >= 2.4, 'and the second');
  // It may stand at the foot of the outer skirt (a few centimetres of slope there), never on the flat top or the inner ramp.
  assert.ok(Math.min(...titleQuad.map((p) => dist(p, [PLAZA.dais.x, PLAZA.dais.z]))) >= PLAZA.tiers[0][0] + 0.4, 'the title does not stand on the dais');
  assert.ok(title.r < boards.at[0]);
  // The east end of the row keeps the pond's corner at a car's distance.
  assert.ok(gap(quads[3], [POND_CORNER, POND_CORNER, POND_CORNER, POND_CORNER]) >= 2.4, 'the last board and the pond corner');
});

test('everything on the camera-side half of the dais is low; tall things are only on the far half', () => {
  // The far half is north-west of the line through the pond's centre, perpendicular to the camera's axis.
  const far = ([x, z]) => (x - POND_CENTRE[0]) * FORWARD[0] * -1 + (z - POND_CENTRE[1]) * FORWARD[1] * -1 < 0;
  for (const [x, z] of PLAZA.poles) assert.ok(far([x, z]), `banner pole at (${x}, ${z}) is on the near half`);
  // Lamps along the lane are 1 m or less: they may stand anywhere.
  assert.ok(PLAZA.lamps.every(([x]) => x < 12.6), 'lamps stand on the land');
  // The signs are tall (2 m) but stand beside the car, never between it and the lens: the camera looks from the south-east, and
  // the signs are on the north-west half of the dais.
  for (const r of PLAZA.boards.at) {
    const [x, z] = at(r, PLAZA.boards.f);
    assert.ok((x - PLAZA.dais.x) * FORWARD[0] + (z - PLAZA.dais.z) * FORWARD[1] > 1, 'a board is up the screen from the dais');
  }
});

test('the map arrival and the prompt are on the dais, and the prompt is open the moment the car lands', () => {
  const { spawn, prompt, dais } = PLAZA;
  const [sx, sz] = at(spawn.r, spawn.f);
  const [px, pz] = at(prompt.r, prompt.f);
  assert.ok(dist([sx, sz], [dais.x, dais.z]) < PLAZA.tiers[1][0] - CAR.length / 2 + 1.1, 'the car lands on the top tier');
  assert.ok(dist([sx, sz], [px, pz]) < 2.5, 'inside the prompt radius (Prompts.js RADIUS)');
  assert.ok(dist([dais.x, dais.z], [px, pz]) < 2.5);
  // Nose to the far corner of the screen: north-west, heading 3 pi / 4 in the level's own (Blender) angle.
  assert.ok(Math.abs(spawn.rotation - Math.PI * 0.75) < 1e-9);
  const anchor = [70.5515, 0, 9.9389];
  const arrival = plazaArrival(anchor, 0.6);
  assert.ok(Math.abs(arrival.position[0] - (anchor[0] + sx * U)) < 1e-9 && Math.abs(arrival.position[2] - (anchor[2] + sz * U)) < 1e-9);
  assert.equal(arrival.position[1], 0.6);
});

test("the document's props are re-seated off the drivable disc, apart from each other, clear of the stage", () => {
  const ids = PROPS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'every prop once');
  const stage = [PLAZA.dais.x, PLAZA.dais.z];
  for (const p of PROPS) {
    assert.ok(p.id.startsWith('user:') && p.from.length === 2 && p.to.length === 2, p.name);
    assert.ok(dist(p.from, p.to) > 0.5, `${p.name} stays where it is`);
    assert.ok(dist(p.to, stage) >= PLAZA.tiers[0][1] + 1.2, `${p.name} stands on the dais`);
    if (/tree|palm/.test(p.name)) assert.ok(Math.hypot(...p.to) >= 13.4, `${p.name} has its crown over the drivable disc`);
  }
  const moved = PROPS.map((p) => p.to);
  // A planter and its lamp stand side by side in the document (1.7 m); nothing else is closer than 2 m.
  const pair = (a, b) => /planter|lamp/.test(a.name) && /planter|lamp/.test(b.name) && a.name.split(' ')[0] === b.name.split(' ')[0];
  for (let i = 0; i < moved.length; i++) for (let j = i + 1; j < moved.length; j++) {
    const least = pair(PROPS[i], PROPS[j]) ? 1.6 : 2.0;
    assert.ok(dist(moved[i], moved[j]) >= least, `${PROPS[i].name} and ${PROPS[j].name} are ${dist(moved[i], moved[j]).toFixed(1)} m apart`);
  }
  // The trophy keeps the document's own proportions: it shrinks, it does not move into the pond's corner.
  const trophy = PROPS.find((p) => p.name === 'golden trophy');
  assert.equal(trophy.scale, 1.2);
  assert.ok(trophy.to[1] <= -11 && dist(trophy.to, POND_CORNER) > 10);
});

test('the boards count what the controller counts', () => {
  const groups = new Map(WORLD2_ACHIEVEMENTS.map((d) => [d.id, { unlocked: d.id === 'lab' || d.id === 'tnt' }]));
  const stats = groupStats(groups);
  assert.equal([...stats.values()].reduce((n, g) => n + g.total, 0), WORLD2_ACHIEVEMENTS.length);
  assert.equal(stats.get('places').unlocked, 1);
  assert.equal(stats.get('mischief').unlocked, 1);
  assert.equal(stats.get('driving').unlocked, 0);
  for (const [id, entry] of stats) assert.equal(entry.total, WORLD2_ACHIEVEMENTS.filter((d) => d.group === id).length);
});

/* ---------------------------------------------------------------- the controller -- */

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const STORAGE = 'helloworld-world2-achievements-v1';

const fakeGame = () => {
  const handlers = [];
  return {
    ticker: { elapsed: 0, delta: 1 / 60, scale: 1, events: { on: (name, fn) => handlers.push(fn), off() {} } },
    audio: { play() {} }, publishGameplay() {}, player: { position: new THREE.Vector3(1000, 0, 1000) },
    handlers,
  };
};
const fakeBin = () => ({ items: [], add(fn) { this.items.push(fn); }, object3D() {} });
const emptyReferences = { node: () => null };
const withPillar = (at = [70, 0, 12]) => {
  const pillar = new THREE.Mesh();
  pillar.position.set(...at);
  pillar.updateMatrixWorld(true);
  return { node: (name) => (name === 'refPillar' ? pillar : null) };
};

test('the plaza controller hears about every unlock the manager records, and nothing else about the awards changes', () => {
  store.clear();
  const manager = new Achievements(fakeGame(), emptyReferences, fakeBin());
  const game = fakeGame();
  const plaza = new Achievements(game, withPillar(), fakeBin());
  plaza.groups = manager.groups;
  const heard = [];
  plaza.follow(manager);
  const original = plaza.changed.bind(plaza);
  plaza.changed = (id) => { heard.push(id); original(id); };
  // The same call as before: the audit's snippet, in node. The medal colours must move, and only that medal's.
  const before = [...plaza.glyphs.instanceColor.array];
  manager.unlock('lab');
  const after = [...plaza.glyphs.instanceColor.array];
  assert.deepEqual(heard, ['lab']);
  const changed = [...new Set(before.map((v, i) => (v === after[i] ? -1 : Math.floor(i / 3))).filter((v) => v >= 0))];
  assert.deepEqual(changed, [WORLD2_ACHIEVEMENTS.findIndex((d) => d.id === 'lab')]);
  // The save is what it always was: one entry per award, a number or an id list.
  const payload = JSON.parse(store.get(STORAGE));
  assert.deepEqual(Object.keys(payload).sort(), WORLD2_ACHIEVEMENTS.map((d) => d.id).sort());
  assert.equal(payload.lab, 1);
  assert.ok(Array.isArray(payload.explorer) && typeof payload.firstDrive === 'number');
  // A second flip, a repeat (silent) and a reset (heard once, everything locked again).
  manager.unlock('lab');
  manager.unlock('tnt');
  assert.deepEqual(heard, ['lab', 'tnt']);
  manager.reset();
  assert.deepEqual(heard, ['lab', 'tnt', null]);
  assert.deepEqual([...plaza.glyphs.instanceColor.array], before);
});

test('a listener that throws does not stop the unlock, the save or the other listeners', () => {
  store.clear();
  const manager = new Achievements(fakeGame(), emptyReferences, fakeBin());
  const seen = [];
  manager.onChange(() => { throw new Error('boom'); });
  manager.onChange((id) => seen.push(id));
  const log = console.error;
  console.error = () => {};
  try { manager.unlock('altar'); } finally { console.error = log; }
  assert.deepEqual(seen, ['altar']);
  assert.equal(manager.has('altar'), true);
  assert.equal(JSON.parse(store.get(STORAGE)).altar, 1);
});

test('the medal that was just won pops for 0.6 s and settles; with reduced motion it does not pop', () => {
  store.clear();
  for (const reduced of [false, true]) {
    const manager = new Achievements(fakeGame(), emptyReferences, fakeBin());
    const game = fakeGame();
    game.view = { reducedMotion: reduced };
    const plaza = new Achievements(game, withPillar(), fakeBin());
    plaza.groups = manager.groups;
    plaza.follow(manager);
    manager.unlock('strike');
    const index = WORLD2_ACHIEVEMENTS.findIndex((d) => d.id === 'strike');
    assert.equal(plaza.pops.has(index), !reduced);
    if (reduced) continue;
    // Player is far away (1000 m): the controller still finishes the pop (it is brief and visible to nobody).
    game.player.position.set(70, 0, 12);
    const scales = [];
    for (let frame = 0; frame < 50; frame++) {
      plaza.update();
      const m = new THREE.Matrix4(), s = new THREE.Vector3();
      plaza.glyphs.getMatrixAt(index, m);
      s.setFromMatrixScale(m);
      scales.push(s.x);
    }
    assert.equal(plaza.pops.size, 0, 'the pop is over after 0.6 s');
    assert.ok(Math.max(...scales) > 1.2, 'it grew');
    assert.ok(Math.abs(scales.at(-1) - 1) < 1e-6, 'and came back to its size');
    store.clear();
  }
});

test('thirty-one medals hang in four tiers around the pillar, apart from each other, facing the camera side', () => {
  const centre = new THREE.Vector3(69.66, 0, 12.41);
  const at31 = medalLayout(centre, U);
  assert.equal(at31.length, WORLD2_ACHIEVEMENTS.length);
  assert.ok(at31.every(Boolean));
  // Two medals never touch: at least 0.6 m between centres (they are 0.56 m across).
  for (let i = 0; i < at31.length; i++) for (let j = i + 1; j < at31.length; j++) {
    assert.ok(at31[i].distanceTo(at31[j]) / U > 0.6, `medals ${i} and ${j} are ${(at31[i].distanceTo(at31[j]) / U).toFixed(2)} m apart`);
  }
  // Heights: low enough to see over the rim, high enough to clear the water; radius: clear of the pillar, inside the pond.
  for (const p of at31) {
    const h = p.y / U, r = Math.hypot(p.x - centre.x, p.z - centre.z) / U;
    assert.ok(h >= 1 && h <= 3.8, `height ${h.toFixed(2)}`);
    assert.ok(r >= 2.3 && r <= 3.7, `radius ${r.toFixed(2)}`);
    // On the side the car arrives on: toward the camera (south-east), within 100 degrees of it.
    const bearing = Math.atan2(p.z - centre.z, p.x - centre.x);
    assert.ok(Math.abs(bearing - Math.PI / 4) < 100 * deg, 'in the arc facing the camera');
  }
  // One tier per group, each its own height.
  const tier = new Map();
  WORLD2_ACHIEVEMENTS.forEach((d, i) => { const set = tier.get(d.group) ?? new Set(); set.add(+(at31[i].y / U).toFixed(2)); tier.set(d.group, set); });
  assert.ok([...tier.values()].every((set) => set.size === 1), 'a group hangs at one height');
  assert.equal(new Set([...tier.values()].map((s) => [...s][0])).size, tier.size, 'and no two groups share one');
});

/* ---------------------------------------------------------------- the document's props -- */

const { AchievementsPlaza } = await import('../../public/archipelago/preview/portfolio/world2/interactions/AchievementsPlaza.js');

/** A plaza with only what adjustWorld reads: its group (plaza metres) inside the instance's frame (scale 1.25), and a timing record. */
function bareCourt(at = new THREE.Vector3(78.1207, 0.15, 117.39)) {
  const court = Object.create(AchievementsPlaza.prototype);
  court.group = new THREE.Group();
  court.group.scale.setScalar(U);
  const frame = new THREE.Group();
  frame.scale.setScalar(1.25);
  frame.position.copy(at);
  frame.add(court.group);
  frame.updateMatrixWorld(true);
  court.timing = { build: 0, adjust: 0 };
  court.adjusted = false;
  return court;
}
/** A scene with the document's own props where the document has them: the plaza group sits at (78, 0.15, 117) as in the world. */
function documentScene() {
  const root = new THREE.Group();
  const plazaGroup = new THREE.Group();
  plazaGroup.position.set(78.1207, 0.15, 117.39);
  root.add(plazaGroup);
  const nodes = {};
  for (const prop of PROPS) {
    const node = new THREE.Group();
    node.name = prop.name;
    node.userData = { aw_id: prop.id, collision: true };
    node.position.set(prop.from[0], 0, prop.from[1]);
    if (prop.scale) node.scale.setScalar(1.5);
    plazaGroup.add(node);
    nodes[prop.name] = node;
  }
  root.updateMatrixWorld(true);
  return { root, plazaGroup, nodes };
}
function fakePhysics(nodes) {
  const colliders = new Map();
  const physicals = [];
  let handle = 0;
  for (const node of Object.values(nodes)) {
    const body = { at: { x: 0, y: 0, z: 0 }, enabled: true, translation() { return this.at; }, setTranslation(v) { this.at = { x: v.x, y: v.y, z: v.z }; }, setEnabled(on) { this.enabled = on; } };
    const physical = { static: true, colliders: [{ handle: ++handle }], node, body };
    colliders.set(handle, node.userData);
    physicals.push(physical);
  }
  const rebuilt = [];
  // No remove(): the plaza never takes a body out of the physics world.
  return { physicals, colliders, rebuilt, mesh(owner) { rebuilt.push(owner.name); }, refreshQueries() { this.refreshed = true; } };
}

test('adjustWorld seats the props where the layout wants them, and only the props that are where the document has them', () => {
  globalThis.document = { body: { dataset: { player: 'true' } } };
  try {
    const { root, plazaGroup, nodes } = documentScene();
    const court = bareCourt(plazaGroup.position);
    // Somebody has already moved the east palm in the document: it must be left alone.
    nodes['east palm'].position.x += 3;
    root.updateMatrixWorld(true);
    const physics = fakePhysics(nodes);
    const old = { list: [{ name: 'tree south', minX: 0, maxX: 1, minZ: 0, maxZ: 1 }, { name: 'untouched', minX: 5, maxX: 6, minZ: 5, maxZ: 6 }], near: () => [{ name: 'tree south' }, { name: 'untouched' }] };
    const driving = { placement: { soft: old } };
    const moved = court.adjustWorld(root, physics, driving);
    assert.equal(moved, PROPS.length - 1);
    for (const prop of PROPS) {
      const node = nodes[prop.name];
      if (prop.name === 'east palm') { assert.ok(Math.abs(node.position.x - (prop.from[0] + 3)) < 1e-9, 'a prop somebody moved stays'); continue; }
      assert.ok(Math.abs(node.position.x - prop.to[0]) < 1e-6 && Math.abs(node.position.z - prop.to[1]) < 1e-6, `${prop.name} stands at ${prop.to}`);
    }
    assert.ok(Math.abs(nodes['golden trophy'].scale.x - 1.2) < 1e-9, 'the trophy comes down to 1.2');
    assert.ok(Math.abs(nodes['golden trophy'].position.y) < 1e-9, 'and stays on its ground');
    // A prop that only moved takes its solid bodies along by the same step (they are built in world space around an origin body);
    // the trophy, which also shrank, has new bodies built where it stands and its old ones switched off. None is ever removed.
    for (const prop of PROPS) {
      const body = physics.physicals.find((p) => p.node === nodes[prop.name]).body;
      if (prop.name === 'east palm') { assert.deepEqual(body.at, { x: 0, y: 0, z: 0 }, 'a prop that stayed keeps its body'); continue; }
      if (prop.scale) { assert.equal(body.enabled, false, 'the old trophy bodies are off'); continue; }
      assert.ok(Math.abs(body.at.x - (prop.to[0] - prop.from[0])) < 1e-6 && Math.abs(body.at.z - (prop.to[1] - prop.from[1])) < 1e-6, `${prop.name}'s body moved by the step`);
      assert.equal(body.enabled, true);
    }
    assert.deepEqual(physics.rebuilt, ['golden trophy'], 'and only the trophy is built again');
    assert.equal(physics.physicals.length, PROPS.length, 'nothing left the physics world');
    assert.ok(physics.refreshed, 'the physics queries are refreshed');
    assert.notEqual(driving.placement.soft, old, 'placement takes its list of scenery again');
    assert.deepEqual(driving.placement.soft.list.map((b) => b.name), ['untouched'], 'the moved props leave it (their new boxes come from their meshes) and the rest stays');
    assert.deepEqual(driving.placement.soft.near(0, 0, 3).map((b) => b.name), ['untouched']);
    // A second call does nothing.
    assert.equal(court.adjustWorld(root, physics, driving), 0);
  } finally {
    delete globalThis.document;
  }
});

test('adjustWorld does nothing in the studio, and nothing for props that are not in the world', () => {
  globalThis.document = { body: { dataset: {} } };
  try {
    const { root, nodes } = documentScene();
    const court = bareCourt();
    const physics = fakePhysics(nodes);
    assert.equal(court.adjustWorld(root, physics, { placement: {} }), 0, 'the studio never moves the props it would then save');
    assert.equal(physics.rebuilt.length, 0);
    assert.ok(physics.physicals.every((p) => p.body.enabled && p.body.at.x === 0), 'no body was touched');
    for (const prop of PROPS) assert.ok(Math.abs(nodes[prop.name].position.x - prop.from[0]) < 1e-9);
  } finally {
    delete globalThis.document;
  }
  globalThis.document = { body: { dataset: { player: 'true' } } };
  try {
    const court = bareCourt();
    assert.equal(court.adjustWorld(new THREE.Group(), fakePhysics({}), { placement: {} }), 0, 'a world without the props is a no-op');
  } finally {
    delete globalThis.document;
  }
});

/* ---------------------------------------------------------------- the see-through arch -- */

const { CUT, cutFraction, liteBoardParts } = await import('../../public/archipelago/preview/portfolio/world2/interactions/AchievementsPlaza.js');
const { SIGN_THEMES, mergeParts, triangleCount } = await import('../../public/archipelago/preview/portfolio/world2/signs/index.js');

test('the cut: only what is nearer than the car, in a cone round the line of sight, above the car, is cut', () => {
  // The gameplay camera 21 m away at 41 degrees, the car on the ground below its sight line.
  const car = { x: 0, y: 0.6, z: 0 };
  const eye = { x: 21 * Math.cos(0.716) * Math.SQRT1_2, y: 21 * Math.sin(0.716) + 0.6, z: 21 * Math.cos(0.716) * Math.SQRT1_2 };
  const L = Math.hypot(eye.x, eye.y - car.y, eye.z);
  // A point `t` metres from the eye along the sight line, `lateral` metres to the side of it (horizontally, perpendicular), `lift` up.
  const dir = new THREE.Vector3(car.x - eye.x, car.y - eye.y, car.z - eye.z).divideScalar(L);
  const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
  const along = (t, lateral = 0, lift = 0) => ({ x: eye.x + dir.x * t + side.x * lateral, y: eye.y + dir.y * t + side.y * lateral + lift, z: eye.z + dir.z * t + side.z * lateral });
  assert.equal(cutFraction(along(L * 0.6), eye, car), 1, 'stone on the line of sight, well in front of the car: gone');
  assert.equal(cutFraction(along(L * 0.6, CUT.inner * 0.5 * 0.6), eye, car), 1, 'inside the inner cone at its own depth: gone');
  assert.equal(cutFraction(along(L * 0.6, CUT.outer * 1.05 * 0.6), eye, car), 0, 'outside the outer cone: whole');
  const middle = cutFraction(along(L * 0.6, (CUT.inner + CUT.outer) / 2 * 0.6), eye, car);
  assert.ok(middle > 0.2 && middle < 0.8, `between the two it thins out (${middle.toFixed(2)})`);
  // The cone, not a cylinder: the hole is as wide on the screen at any depth (lateral grows with depth).
  assert.equal(cutFraction(along(L * 0.3, CUT.inner * 0.9 * 0.3), eye, car), 1);
  assert.equal(cutFraction(along(L * 0.3, CUT.outer * 1.05 * 0.3), eye, car), 0);
  assert.equal(cutFraction(along(L - CUT.margin * 0.5), eye, car), 0, 'right at the car (inside the margin) stays');
  assert.equal(cutFraction(along(L + 3), eye, car), 0, 'behind the car stays');
  assert.equal(cutFraction(along(L * 0.6, 0, -50), eye, car), 0, 'below the car stays (the ground, a kerb)');
  assert.equal(cutFraction({ x: eye.x + 5, y: eye.y, z: eye.z + 5 }, eye, car), 0, 'behind the camera is nothing');
  assert.equal(cutFraction(along(L * 0.6), eye, eye), 0, 'a car at the eye cuts nothing');
});

test('the cut hole is a car-sized window: it fully clears the car and leaves the stone beyond a car and a half whole', () => {
  // The car is about 3.6 x 1.8 x 1.4 m: seen from the gameplay camera its farthest corner is about 2 m from its centre on the screen.
  assert.ok(CUT.inner >= 1.5 && CUT.outer - CUT.inner >= 1 && CUT.outer <= 3.5, JSON.stringify(CUT));
  assert.ok(CUT.margin >= 0.5 && CUT.drop >= 0 && CUT.range >= 40);
});

test('dressArch gives the tall stone, the crest and the water the cut, writes it per camera, and only for the gameplay camera', () => {
  const court = Object.create(AchievementsPlaza.prototype);
  const camera = new THREE.PerspectiveCamera(25, 1.6, 0.5, 400);
  camera.position.set(14, 15, 14);
  camera.lookAt(0, 0.6, 0);
  camera.updateMatrixWorld(true);
  const palette = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, map: Object.assign(new THREE.DataTexture(new Uint8Array(4), 1, 1), { name: 'palette' }) });
  const tall = new THREE.Mesh(new THREE.BoxGeometry(10, 9, 10), palette);
  const pillar = new THREE.Mesh(new THREE.BoxGeometry(2, 3.8, 2), palette);
  const area = new THREE.Group();
  area.add(tall, pillar);
  const crest = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), palette);
  const water = new THREE.Mesh(new THREE.BoxGeometry(3, 6, 3), new THREE.MeshStandardMaterial());
  water.material.onBeforeCompile = (shader) => { shader.fragmentShader += '/*water*/'; };
  water.material.customProgramCacheKey = () => 'water';
  const disposed = [];
  Object.assign(court, { game: { view: { camera } }, references: { node: (name) => (name === 'achievements' ? area : null) }, group: new THREE.Group(), finial: crest, water: { meshes: [water] }, bin: { add: (fn) => disposed.push(fn) }, cut: null });
  const vehicle = { position: new THREE.Vector3(0, 0.6, 0) };
  court.dressArch({ vehicle });
  assert.ok(court.cut, 'dressed');
  assert.equal(court.cut.meshes.length, 3, 'the stone, the crest and the water');
  assert.ok(court.cut.meshes.includes(tall) && court.cut.meshes.includes(crest) && court.cut.meshes.includes(water));
  assert.ok(!court.cut.meshes.includes(pillar), 'the 3.8 m pillar is not cut');
  assert.equal(tall.material, crest.material, 'the stone and the crest share one material (one program)');
  assert.notEqual(tall.material, palette, 'the level\'s own palette material is never touched');
  assert.equal(pillar.material, palette);
  assert.equal(typeof tall.onBeforeRender, 'function');
  // The shader: the palette's own program plus the cut, and the water's own program plus the cut.
  const fake = () => ({ uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>\n', fragmentShader: '#include <common>\nvoid main() {\n#include <clipping_planes_fragment>\n}' });
  for (const material of [tall.material, water.material]) {
    const shader = fake();
    material.onBeforeCompile(shader, null);
    assert.ok(shader.uniforms.uCut && shader.uniforms.uCutDir && shader.uniforms.uCutFloor, 'the three uniforms');
    assert.ok(shader.fragmentShader.includes('discard') && shader.fragmentShader.includes('vViewPosition') && shader.vertexShader.includes('vCutY'));
  }
  const shader = fake();
  water.material.onBeforeCompile(shader, null);
  assert.ok(shader.fragmentShader.includes('/*water*/'), 'the water keeps its own shader');
  assert.notEqual(tall.material.customProgramCacheKey(), water.material.customProgramCacheKey());
  assert.ok(water.material.customProgramCacheKey().endsWith('+cut'));
  // Drawn by the gameplay camera: the car in view space, the cone in tangents at the car's own distance.
  tall.onBeforeRender(null, null, camera);
  const p = court.cut.params, here = vehicle.position.clone().applyMatrix4(camera.matrixWorldInverse);
  assert.ok(Math.abs(p.x - here.length()) < 1e-9, 'the distance to the car');
  assert.ok(Math.abs(p.y - CUT.inner / p.x) < 1e-9 && Math.abs(p.z - CUT.outer / p.x) < 1e-9 && p.w === CUT.margin);
  assert.ok(Math.abs(court.cut.dir.length() - 1) < 1e-9 && court.cut.dir.dot(here.clone().normalize()) > 1 - 1e-9, 'and the unit direction to it');
  // Another camera (a map render) sees no hole; neither does a car far from the plaza, nor a switched-off cut.
  tall.onBeforeRender(null, null, new THREE.PerspectiveCamera());
  assert.equal(court.cut.params.x, 0, 'only the gameplay camera');
  tall.onBeforeRender(null, null, camera);
  assert.ok(court.cut.params.x > 0);
  vehicle.position.set(500, 0, 0);
  tall.onBeforeRender(null, null, camera);
  assert.equal(court.cut.params.x, 0, 'a car 500 m away');
  vehicle.position.set(0, 0.6, 0);
  court.cut.enabled = false;
  tall.onBeforeRender(null, null, camera);
  assert.equal(court.cut.params.x, 0, 'switched off');
  assert.equal(court.cutFraction({ x: 0, y: 3, z: 0 }, camera.position, vehicle.position), 0);
  // A second call, a world without the stone and a studio preview (no car) all leave things alone.
  const same = court.cut;
  court.dressArch({ vehicle });
  assert.equal(court.cut, same);
  const bare = Object.assign(Object.create(AchievementsPlaza.prototype), { game: { view: { camera } }, references: { node: () => null }, group: new THREE.Group(), finial: null, cut: null });
  bare.dressArch({ vehicle });
  assert.equal(bare.cut, null, 'no stone, no cut');
  const studio = Object.assign(Object.create(AchievementsPlaza.prototype), { game: { view: {} }, references: { node: () => area }, group: new THREE.Group(), cut: null });
  studio.dressArch({ vehicle });
  assert.equal(studio.cut, null, 'no camera, no cut');
  disposed.forEach((fn) => fn());
});

/** A court that has been through dressArch (it has a car and a camera), with the document's trophy and east palm as the world has them. */
function cutCourt() {
  const court = Object.create(AchievementsPlaza.prototype);
  const camera = new THREE.PerspectiveCamera(25, 1.6, 0.5, 400);
  camera.position.set(14, 15, 14);
  camera.lookAt(0, 0.6, 0);
  camera.updateMatrixWorld(true);
  const palette = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, map: Object.assign(new THREE.DataTexture(new Uint8Array(4), 1, 1), { name: 'palette' }) });
  const area = new THREE.Group();
  area.add(new THREE.Mesh(new THREE.BoxGeometry(10, 9, 10), palette));
  const disposed = [];
  Object.assign(court, { game: { view: { camera } }, references: { node: (name) => (name === 'achievements' ? area : null) }, group: new THREE.Group(), finial: null, water: { meshes: [] }, bin: { add: (fn) => disposed.push(fn) }, cut: null });
  const vehicle = { position: new THREE.Vector3(0, 0.6, 0) };
  court.dressArch({ vehicle });
  const yellow = new THREE.MeshStandardMaterial({ color: '#f8ca4b', side: THREE.DoubleSide, name: 'AW Yellow' });
  const cream = new THREE.MeshStandardMaterial({ color: '#efe6cd', name: 'AW Cream' });
  const green = new THREE.MeshStandardMaterial({ color: '#78a553', name: 'green' });
  const brown = new THREE.MeshStandardMaterial({ color: '#885a38', name: 'brown' });
  const box = (material, name) => Object.assign(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material), { name });
  const trophy = new THREE.Group();
  trophy.add(box(yellow, 'Trophy_cup'), box(yellow, 'Trophy_handle'), box(yellow, 'Trophy_stem'), box(cream, 'Trophy_pedestal'));
  const palm = new THREE.Group();
  palm.add(box(brown, 'Trunk'), box(green, 'Palm stem 0'), box(green, 'Palm frond 0-1'), box(green, 'Palm frond 0-2'), box(brown, 'Coconut 0'));
  return { court, camera, vehicle, trophy, palm, materials: { yellow, cream, green, brown }, disposed };
}
const nameOf = (id) => PROPS.find((p) => p.name === id);

test('dressProps: the trophy and the palm crown are cut like the arch, on copies of their own materials, and nothing else of the world is touched', () => {
  const { court, camera, vehicle, trophy, palm, materials, disposed } = cutCourt();
  const parts = (group) => Object.fromEntries(group.children.map((m) => [m.name, m]));
  const t = parts(trophy), p = parts(palm);
  const sources = Object.fromEntries(Object.entries({ ...t, ...p }).map(([name, m]) => [name, m.material]));
  const taken = court.dressProps([[trophy, nameOf('golden trophy').cut], [palm, nameOf('east palm').cut]]);
  assert.equal(taken, 4 + 3, 'the four parts of the trophy; the stem and the two fronds of the palm');
  // One copy per original material: the trophy's gold parts share one (one batch, one program), the pedestal has its own.
  assert.equal(t.Trophy_cup.material, t.Trophy_handle.material);
  assert.equal(t.Trophy_cup.material, t.Trophy_stem.material);
  assert.notEqual(t.Trophy_cup.material, materials.yellow, 'the level\'s own gold is never touched');
  assert.notEqual(t.Trophy_pedestal.material, t.Trophy_cup.material);
  assert.notEqual(t.Trophy_pedestal.material, materials.cream);
  assert.equal(p['Palm frond 0-1'].material, p['Palm stem 0'].material);
  assert.notEqual(p['Palm frond 0-1'].material, materials.green);
  assert.equal(p.Trunk.material, materials.brown, 'the trunk and the coconuts are no crown: they stay on the shared material (and in the shared batches)');
  assert.equal(p['Coconut 0'].material, materials.brown);
  // The copy is the original with the cut on top: same look, own program key, the hook that writes the cut is on the material.
  const copy = t.Trophy_cup.material;
  assert.equal(copy.color.getHexString(), materials.yellow.color.getHexString());
  assert.equal(copy.side, THREE.DoubleSide);
  assert.ok(copy.customProgramCacheKey().includes('cut'));
  assert.equal(copy.onBeforeRender, court.cut.before);
  // A batch made of those parts (main.js batch() makes a Mesh or an InstancedMesh with the first part's material) is cut too.
  const batch = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), copy);
  const frond = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), p['Palm frond 0-1'].material, 27);
  assert.ok(court.isCut(batch) && court.isCut(frond) && court.isCut(t.Trophy_pedestal));
  assert.ok(!court.isCut(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), materials.yellow)) && !court.isCut(p.Trunk));
  // The shader: the cut in the prop's own lit program; an instanced mesh carries its place in its instance matrices.
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>\n', fragmentShader: '#include <common>\nvoid main() {\n#include <clipping_planes_fragment>\n}' };
  copy.onBeforeCompile(shader, null);
  assert.ok(shader.uniforms.uCut === court.cut.uniforms.uCut && shader.uniforms.uCutDir && shader.uniforms.uCutFloor, 'the plaza\'s one set of uniforms');
  assert.ok(shader.fragmentShader.includes('discard') && shader.vertexShader.includes('vCutY'));
  assert.match(shader.vertexShader, /#ifdef USE_INSTANCING\s+cutLocal = instanceMatrix \* cutLocal;\s+#endif/);
  // Drawn with the gameplay camera it writes the cut; with any other, none.
  const draw = (mesh, view) => mesh.material.onBeforeRender(null, null, view, mesh.geometry, mesh, null);
  draw(batch, camera);
  assert.ok(court.cut.params.x > 0 && Math.abs(court.cut.params.x - vehicle.position.clone().applyMatrix4(camera.matrixWorldInverse).length()) < 1e-9);
  draw(frond, new THREE.PerspectiveCamera());
  assert.equal(court.cut.params.x, 0, 'the map\'s own camera sees the props whole');
  draw(frond, camera);
  assert.ok(court.cut.params.x > 0);
  // The arch's own list is the arch's: the props are on theirs.
  assert.equal(court.cut.meshes.length, 1);
  assert.equal(court.cut.props.length, 7);
  // Twice does nothing more.
  assert.equal(court.dressProps([[trophy, nameOf('golden trophy').cut]]), 0);
  // The studio's world and a world without a car have no cut: props are left exactly as they are.
  const bare = Object.assign(Object.create(AchievementsPlaza.prototype), { cut: null });
  assert.equal(bare.dressProps([[trophy, /./]]), 0);
  // Everything goes back as it was when the controller is disposed.
  disposed.forEach((fn) => fn());
  for (const [name, mesh] of Object.entries({ ...t, ...p })) assert.equal(mesh.material, sources[name], `${name} has its own material back`);
});

test("the north road's lanes are free: no banner pole and no pedestal stands in the way of a car coming down it", () => {
  const { road } = PLAZA;
  const [lo, hi] = road.lanes;
  assert.ok(hi - lo >= 5 && Math.abs((lo + hi) / 2 - PLAZA.finial.x) < 1.5, 'the lanes are the arch\'s own width, about its axis');
  // Poles are 0.14 m across: a car (1.8 m) driving a lane clears them by at least half a car's width less its own.
  const clear = CAR.width / 2 + 0.14 + 0.3;
  for (const [x, z, name] of PLAZA.poles) {
    if (z > road.north) continue;
    assert.ok(x < lo - clear || x > hi + clear, `the ${name} banner pole at (${x}, ${z}) stands in the road's lanes`);
  }
  // The trophy's pedestal (3 m at the document's scale, times its own) keeps its distance from the east lane too.
  const trophy = PROPS.find((p) => p.name === 'golden trophy');
  const half = 1.5 * trophy.scale;
  assert.ok(trophy.to[0] - half >= hi + CAR.width / 2 + 0.3, `the pedestal's west face is at ${(trophy.to[0] - half).toFixed(1)}, the east lane's car reaches ${(hi + CAR.width / 2).toFixed(1)}`);
});

test('the boards are built of lighter timber than the kit, in the same places, and cost a third of the triangles', () => {
  const specs = [
    ['title', { width: PLAZA.title.w, height: PLAZA.title.h, leg: PLAZA.title.leg, theme: SIGN_THEMES.plain }, 400],
    ['driving', { width: PLAZA.boards.w, height: PLAZA.boards.h, leg: PLAZA.boards.leg, theme: { ...SIGN_THEMES.chess, emblem: null, hardware: 'oak', charm: 'gear' } }, 650],
    ['places', { width: PLAZA.boards.w, height: PLAZA.boards.h, leg: PLAZA.boards.leg, theme: { ...SIGN_THEMES.maze, emblem: null, hardware: 'vine', charm: 'compass' } }, 650],
    ['games', { width: PLAZA.boards.w, height: PLAZA.boards.h, leg: PLAZA.boards.leg, theme: { ...SIGN_THEMES.stock, emblem: null, hardware: 'rope', charm: 'pawn' } }, 650],
    ['mischief', { width: PLAZA.boards.w, height: PLAZA.boards.h, leg: PLAZA.boards.leg, theme: { ...SIGN_THEMES.dots, emblem: null, hardware: 'oak', charm: 'acorn' } }, 650],
  ];
  let total = 0;
  for (const [name, spec, budget] of specs) {
    const geometry = mergeParts(liteBoardParts({ ...spec, seed: `plaza-${name}` }));
    const triangles = triangleCount(geometry);
    total += triangles;
    assert.ok(triangles > 150 && triangles <= budget, `${name}: ${triangles} triangles (budget ${budget})`);
    // The posts, the border and the back plank stand where the kit puts them: the box of the whole board is the kit's.
    geometry.computeBoundingBox();
    const { min, max } = geometry.boundingBox, px = spec.width / 2 + 0.07 + 0.04;
    assert.ok(Math.abs(min.x + px + 0.07) < 0.2 && Math.abs(max.x - px - 0.07) < 0.2, `${name}: the posts are ${px.toFixed(2)} m either side of the middle`);
    assert.ok(min.y > -0.1 && Math.abs(max.y - (spec.leg + spec.height + 0.2 + 0.14 * 0.16 + 0.07)) < 0.05, `${name}: from the ground (the charm dips a hand below it) to the top of the pyramid caps`);
    geometry.dispose();
  }
  assert.ok(total <= 2600, `the five boards cost ${total} triangles (the kit's own: 6 974)`);
});

test('the medals hang round the side of the pillar that faces the camera, wherever the frame is turned', () => {
  const centre = new THREE.Vector3(10, 0, 20);
  for (const turn of [0, 0.7, -1.2]) {
    const at = medalLayout(centre, U, Math.PI / 4 + turn);
    const mean = at.reduce((sum, p) => sum.add(new THREE.Vector3(p.x - centre.x, 0, p.z - centre.z).normalize()), new THREE.Vector3()).normalize();
    assert.ok(Math.abs(Math.atan2(mean.z, mean.x) - (Math.PI / 4 + turn)) < 0.05, `turned by ${turn}: the arc is centred on the camera's side`);
  }
  assert.deepEqual(medalLayout(centre, U).map((p) => p.toArray()), medalLayout(centre, U, Math.PI / 4).map((p) => p.toArray()), 'the default is the south-east');
});

test('a medal shows its relief to the camera: every triangle of it faces +Z, the way the medal faces', async () => {
  const { medalGeometry } = await import('../../public/archipelago/preview/portfolio/world2/interactions/Achievements.js');
  const geometry = medalGeometry(U);
  const position = geometry.getAttribute('position'), index = geometry.index;
  assert.equal(index.count / 3, 54, 'the face of a worked coin: 54 triangles');
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let facing = 0, away = 0, point = 0;
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(position, index.getX(i)); b.fromBufferAttribute(position, index.getX(i + 1)); c.fromBufferAttribute(position, index.getX(i + 2));
    const normal = b.clone().sub(a).cross(c.clone().sub(a));
    // The tip of the gem is one point: nine of the triangles there have no area and draw nothing.
    if (normal.lengthSq() < 1e-14) { point++; continue; }
    // Counter-clockwise seen from +Z is front-facing: a triangle whose normal points away from the camera is culled.
    if (normal.normalize().z > 0.05) facing++;
    else away++;
  }
  assert.equal(away, 0, 'none faces away: a profile that runs outward (not in toward the gem) draws nothing at all');
  assert.ok(facing >= 45 && facing + point === 54, `${facing} triangles face the camera (${point} are the gem's point)`);
  const radius = Math.max(...Array.from({ length: position.count }, (_, i) => Math.hypot(position.getX(i), position.getY(i))));
  assert.ok(Math.abs(radius - 0.28 * U) < 1e-6, 'a 0.56 m coin');
  const colour = geometry.getAttribute('color');
  assert.equal(colour.count, position.count, 'every vertex has its shade');
  geometry.dispose();
});
