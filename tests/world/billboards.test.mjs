import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PerformanceObserver, constants } from 'node:perf_hooks';
import * as THREE from 'three';
import { Billboards, ORDER, AFTER_ORDER, MAP_HIDDEN_LAYER } from '../../public/archipelago/preview/portfolio/world2/interactions/Billboards.js';
import { Prompts, fitPrompt as fitJob, fitState, liftClear, liftJob, keepOut } from '../../public/archipelago/preview/portfolio/world2/interactions/Prompts.js';
import { Tweens } from '../../public/archipelago/preview/portfolio/world/core/Tween.js';
import { Events } from '../../public/archipelago/preview/runtime/Events.js';

// /world's floating labels (prompts, plates, career stops) turn to the gameplay camera through one shared system.
// These tests run the real module against the numbers of the real world: the Social frame (yaw -60, scale 0.7, moved
// ~60 m) and the whole camera range a player can reach by drag-orbiting (any yaw, elevation 12.6..82.8 deg).

const deg = Math.PI / 180;
const PREVIEW = 'public/archipelago/preview';

const newTicker = () => ({ events: new Events() });
/** Same rotation to float precision (Quaternion.angleTo amplifies rounding near 0, so never compare it to ~1e-12). */
const same = (a, b) => a.angleTo(b) < 1e-6;
const tick = (ticker) => ticker.events.trigger('tick');

/** The Social area's frame as the seed places it: group(yaw -60) x asset(scale 0.7) x T(-anchor). */
function socialFrame() {
  const group = new THREE.Matrix4().compose(new THREE.Vector3(25.476, 0.15, 42.436), new THREE.Quaternion(0, -0.5, 0, 0.8660254), new THREE.Vector3(1, 1, 1));
  const asset = new THREE.Matrix4().compose(new THREE.Vector3(2.39, 0.025, -3.16), new THREE.Quaternion(), new THREE.Vector3(0.7, 0.7, 0.7));
  const matrix = group.multiply(asset).multiply(new THREE.Matrix4().makeTranslation(-28.9, 0, 21.82));
  const scene = new THREE.Scene();
  const frame = new THREE.Group();
  matrix.decompose(frame.position, frame.quaternion, frame.scale);
  scene.add(frame);
  return { scene, frame };
}

const TARGET = new THREE.Vector3(26, 1.3, 42);
/** The gameplay camera: FOV 25, 21 m from the car, at `yaw`/`elevation` degrees. */
function aim(camera, yaw, elevation, radius = 21) {
  camera.position.copy(TARGET).add(new THREE.Vector3().setFromSphericalCoords(radius, (90 - elevation) * deg, yaw * deg));
  camera.lookAt(TARGET);
  camera.updateMatrixWorld();
}

/** What a reader sees: how parallel the plate is to the screen, whether its text is mirrored or rotated. */
function reading(object, camera) {
  const q = object.getWorldQuaternion(new THREE.Quaternion());
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const position = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
  const toCamera = camera.position.clone().sub(position).normalize();
  return { parallel: -normal.dot(forward), facing: normal.dot(toCamera), right: right.dot(camRight), up: up.dot(camUp) };
}

const ELEVATIONS = [13, 25, 41.4, 60, 70, 83];
function sweep(each) {
  for (let yaw = 0; yaw < 360; yaw += 5) for (const elevation of ELEVATIONS) each(yaw, elevation);
}

test('a spherical label is legible over the whole reachable camera range, in a rotated and scaled frame', () => {
  const { scene, frame } = socialFrame();
  const ticker = newTicker();
  const camera = new THREE.PerspectiveCamera(25, 16 / 9, 0.1, 800);
  const system = Billboards.for(ticker).useCamera(() => camera);
  const labels = [[21, 2.9, -24], [18.8, 2.9, -21.5], [27.7, 2.4, -25.2], [24.2, 2.8, -25.8]].map(([x, y, z]) => {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.59));
    plate.position.set(x, y, z);
    frame.add(plate);
    system.add(plate, { mode: 'spherical' });
    return plate;
  });
  scene.updateMatrixWorld(true);
  let legible = 0, total = 0;
  const worst = { parallel: 1, right: 1, up: 1, facing: 1 };
  sweep((yaw, elevation) => {
    aim(camera, yaw, elevation);
    tick(ticker);
    scene.updateMatrixWorld(true);
    for (const plate of labels) {
      const r = reading(plate, camera);
      total++;
      if (r.facing > 0.6 && r.right > 0.7) legible++;
      for (const key of Object.keys(worst)) worst[key] = Math.min(worst[key], r[key]);
    }
  });
  assert.equal(total, 72 * 6 * 4);
  assert.equal(legible, total, `legible ${legible}/${total}`);
  // Exactly parallel to the screen: never mirrored, never rotated, never foreshortened by the frame.
  assert.ok(worst.parallel > 0.99999 && worst.right > 0.99999 && worst.up > 0.99999, JSON.stringify(worst));
  assert.ok(worst.facing > 0.95, `worst facing toward the camera ${worst.facing}`);
});

test('a cylindrical label breaks only near the top-down limit, which is why text never uses it', () => {
  const { scene, frame } = socialFrame();
  const ticker = newTicker();
  const camera = new THREE.PerspectiveCamera(25, 16 / 9, 0.1, 800);
  const system = Billboards.for(ticker).useCamera(() => camera);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.59));
  plate.position.set(21, 2.9, -24);
  frame.add(plate);
  system.add(plate, { mode: 'cylindrical', lean: 0.15 * Math.PI });
  scene.updateMatrixWorld(true);
  const failedAt = new Set();
  let legible = 0, total = 0;
  sweep((yaw, elevation) => {
    aim(camera, yaw, elevation);
    tick(ticker);
    scene.updateMatrixWorld(true);
    const r = reading(plate, camera);
    total++;
    if (r.facing > 0.6 && r.right > 0.7) legible++; else failedAt.add(elevation);
  });
  assert.ok(legible < total, 'cylindrical text must break somewhere in the camera range');
  assert.ok(failedAt.size > 0 && [...failedAt].every((elevation) => elevation >= 70), `cylindrical failed at elevations ${[...failedAt]}`);
});

test('the orientation is correct under a rotated parent, and a sprite is left unrotated', () => {
  const scene = new THREE.Scene();
  const outer = new THREE.Group(); outer.rotation.set(0.4, -1.1, 0.2); outer.position.set(5, 1, -3); scene.add(outer);
  const inner = new THREE.Group(); inner.rotation.y = 2.2; inner.position.set(1, 0, 2); outer.add(inner);
  const label = new THREE.Group(); label.position.set(0.5, 1, 0); inner.add(label);
  const sprite = new THREE.Group(); sprite.position.set(-0.5, 1, 0); sprite.rotation.set(0.3, 0.2, 0.1); inner.add(sprite);
  const before = sprite.quaternion.clone();
  const ticker = newTicker();
  const camera = new THREE.PerspectiveCamera(25, 1.5, 0.1, 800);
  const system = Billboards.for(ticker).useCamera(() => camera);
  system.add(label); system.add(sprite, { mode: 'sprite' });
  scene.updateMatrixWorld(true);
  for (const [yaw, elevation] of [[45, 41], [200, 12], [300, 83]]) {
    aim(camera, yaw, elevation);
    tick(ticker);
    scene.updateMatrixWorld(true);
    const q = label.getWorldQuaternion(new THREE.Quaternion());
    assert.ok(q.angleTo(camera.quaternion) < 1e-5, `world quaternion off by ${q.angleTo(camera.quaternion)}`);
  }
  assert.ok(sprite.quaternion.equals(before), 'sprite mode never rotates');
});

test('the distance scale gives base x clamp(distance / ref, min, max), and compensates a scaled frame', () => {
  const { scene, frame } = socialFrame();
  const ticker = newTicker();
  const camera = new THREE.PerspectiveCamera(25, 16 / 9, 0.1, 800);
  const system = Billboards.for(ticker).useCamera(() => camera);
  const make = (x, base, scale) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
    m.position.set(x, 2.9, -24); m.scale.setScalar(base); frame.add(m);
    system.add(m, { scale });
    return m;
  };
  const compensated = make(21, 0.85, { ref: 21, min: 1, max: 1.8 });
  const raw = make(22, 1, { ref: 21, min: 1, max: 1.8, compensateParent: false });
  const unscaled = make(23, 1.3, undefined);
  scene.updateMatrixWorld(true);
  const world = (o) => o.getWorldScale(new THREE.Vector3()).x;
  const distance = (o) => camera.position.distanceTo(new THREE.Vector3().setFromMatrixPosition(o.matrixWorld));
  for (const radius of [15, 21, 27, 31, 40, 56]) {
    aim(camera, 45, 41.4, radius);
    tick(ticker);
    scene.updateMatrixWorld(true);
    const k = (o) => Math.min(1.8, Math.max(1, distance(o) / 21));
    assert.ok(Math.abs(world(compensated) - 0.85 * k(compensated)) < 1e-6, `compensated at ${radius} m: ${world(compensated)}`);
    assert.ok(Math.abs(world(raw) - 0.7 * k(raw)) < 1e-6, `uncompensated keeps the frame's 0.7 at ${radius} m: ${world(raw)}`);
    assert.ok(Math.abs(world(unscaled) - 1.3 * 0.7) < 1e-6, 'without a scale option the object keeps its size');
  }
  // The base is read once, at the first update: later (animated) changes to the base are not compounded.
  aim(camera, 45, 41.4, 40);
  tick(ticker);
  const settled = compensated.scale.x;
  tick(ticker); tick(ticker);
  assert.equal(compensated.scale.x, settled);
});

test('hidden, far, off-screen and unchanged items are skipped, and re-oriented on re-entry', () => {
  const scene = new THREE.Scene();
  const ticker = newTicker();
  const camera = new THREE.PerspectiveCamera(25, 16 / 9, 0.1, 800);
  const system = Billboards.for(ticker).useCamera(() => camera);
  const make = (x, z, options) => { const g = new THREE.Group(); g.position.set(x, 1, z); scene.add(g); const h = system.add(g, options); return { g, h }; };
  const look = (position, target) => { camera.position.copy(position); camera.lookAt(target); camera.updateMatrixWorld(); };
  const near = make(0, 0, { cull: 3 });
  const hidden = make(1, 0, { cull: 3 });
  const far = make(0, 40, { radius: 25 });
  const aside = make(500, 0, { cull: 3, radius: 2000 });
  hidden.g.visible = false;
  scene.updateMatrixWorld(true);
  const rest = near.g.quaternion.clone();
  look(new THREE.Vector3(0, 20, 0.5), new THREE.Vector3(0, 0, 0));
  tick(ticker);
  assert.ok(same(near.g.quaternion, camera.quaternion), 'the visible, near item turned');
  assert.ok(hidden.g.quaternion.equals(rest), 'a hidden item is left alone');
  assert.ok(far.g.quaternion.equals(rest), 'an item beyond its radius is left alone');
  assert.ok(aside.g.quaternion.equals(rest), 'an item outside the frustum is left alone');
  // Re-entry: it turns on the very next tick, before it can be drawn.
  hidden.g.visible = true;
  tick(ticker);
  assert.ok(same(hidden.g.quaternion, camera.quaternion), 'a re-shown item turns on the next tick');
  look(new THREE.Vector3(0, 20, 30), new THREE.Vector3(0, 0, 40));
  tick(ticker);
  assert.ok(same(far.g.quaternion, camera.quaternion), 'an item that came within its radius turns');
  look(new THREE.Vector3(500, 20, 0.5), new THREE.Vector3(500, 0, 0));
  tick(ticker);
  assert.ok(same(aside.g.quaternion, camera.quaternion), 'an item that entered the frustum turns');
  // Nothing moved: the pass is skipped entirely, an external write survives until refresh().
  const mark = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.7);
  aside.g.quaternion.copy(mark);
  tick(ticker);
  assert.ok(aside.g.quaternion.equals(mark), 'a static camera and a static item cost nothing');
  aside.h.refresh();
  tick(ticker);
  assert.ok(same(aside.g.quaternion, camera.quaternion), 'refresh() re-orients on the next tick');
  // moves: the item is followed although the camera is still.
  const mover = make(500, 0, { cull: 3, radius: 2000, moves: true });
  tick(ticker);
  mover.g.quaternion.copy(mark);
  tick(ticker);
  assert.ok(same(mover.g.quaternion, camera.quaternion), 'moves:true is processed every tick');
  // enabled=false pauses, enabled=true re-orients.
  look(new THREE.Vector3(500, 22, 3), new THREE.Vector3(500, 0, 0));
  mover.h.enabled = false;
  mover.g.quaternion.copy(mark);
  tick(ticker);
  assert.ok(mover.g.quaternion.equals(mark), 'a disabled item is left alone');
  mover.h.enabled = true;
  tick(ticker);
  assert.ok(same(mover.g.quaternion, camera.quaternion), 'a re-enabled item turns');
});

test('a moves:true label follows a parent that moved this very tick; a static one needs refresh()', () => {
  const scene = new THREE.Scene();
  const ticker = newTicker();
  const camera = new THREE.PerspectiveCamera(25, 16 / 9, 0.1, 800);
  const system = Billboards.for(ticker).useCamera(() => camera);
  const rig = new THREE.Group(); scene.add(rig);
  const follow = new THREE.Group(); follow.position.set(3, 1, 0); rig.add(follow);
  const fixed = new THREE.Group(); fixed.position.set(-3, 1, 0); rig.add(fixed);
  const options = { scale: { ref: 21, min: 1, max: 1.8 } };
  system.add(follow, { ...options, moves: true });
  const stay = system.add(fixed, options);
  scene.updateMatrixWorld(true);
  camera.position.set(0, 20, 0.1); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  tick(ticker);
  scene.updateMatrixWorld(true);
  // A controller (order < 21) scales and spins the frame; the renderer has not updated matrixWorld yet.
  rig.scale.setScalar(2); rig.rotation.y = 1.1;
  tick(ticker);
  scene.updateMatrixWorld(true);
  const worldScale = (o) => o.getWorldScale(new THREE.Vector3()).x;
  const distance = (o) => camera.position.distanceTo(new THREE.Vector3().setFromMatrixPosition(o.matrixWorld));
  assert.ok(same(follow.getWorldQuaternion(new THREE.Quaternion()), camera.quaternion), 'the moving label faces the camera under the rotated frame');
  assert.ok(Math.abs(worldScale(follow) - Math.min(1.8, Math.max(1, distance(follow) / 21))) < 1e-6, `the moving label's size ignores the new frame scale: ${worldScale(follow)}`);
  assert.ok(!same(fixed.getWorldQuaternion(new THREE.Quaternion()), camera.quaternion), 'a static label keeps its last pose until told');
  stay.refresh();
  camera.position.x += 0.01; camera.updateMatrixWorld();
  tick(ticker);
  scene.updateMatrixWorld(true);
  assert.ok(same(fixed.getWorldQuaternion(new THREE.Quaternion()), camera.quaternion), 'refresh() brings it back');
});

test('with no camera the authored pose is the fallback and nothing throws', () => {
  const scene = new THREE.Scene();
  const ticker = newTicker();
  const system = Billboards.for(ticker);
  const g = new THREE.Group(); g.rotation.order = 'YXZ'; g.rotation.set(-Math.PI * 0.15, Math.PI * 0.25, 0); g.scale.setScalar(0.85); scene.add(g);
  const authored = g.quaternion.clone();
  system.add(g, { scale: { ref: 21, min: 1, max: 1.8 } });
  tick(ticker); tick(ticker);
  assert.ok(g.quaternion.equals(authored));
  assert.equal(g.scale.x, 0.85);
  system.useCamera(() => null);
  tick(ticker);
  assert.ok(g.quaternion.equals(authored));
});

test('there is ONE subscriber per ticker, after the camera and every controller, and it goes away with the last label', () => {
  const calls = [];
  const events = new Events();
  const ticker = { events: { on: (name, fn, order) => { calls.push(['on', name, order]); return events.on(name, fn, order); }, off: (name, fn) => { calls.push(['off', name]); return events.off(name, fn); } } };
  const system = Billboards.for(ticker);
  assert.equal(Billboards.for(ticker), system, 'one system per ticker');
  const handles = Array.from({ length: 12 }, () => system.add(new THREE.Group()));
  assert.deepEqual(calls, [['on', 'tick', ORDER]]);
  assert.equal(ORDER, 21);
  assert.equal(system.items.length, 12);
  // `handle.remove` is passed to a Bin as a bare function.
  const detached = handles.map((h) => h.remove);
  detached.slice(0, 11).forEach((remove) => remove());
  assert.equal(system.items.length, 1);
  assert.equal(calls.length, 1, 'still subscribed while a label is left');
  detached[11](); detached[11](); detached[0]();
  assert.equal(system.items.length, 0);
  assert.deepEqual(calls.slice(1), [['off', 'tick']], 'unsubscribed once, double remove is a no-op');
  system.add(new THREE.Group());
  assert.equal(calls.length, 3, 'subscribes again when a label is added later');
});

test('the layer option moves the whole subtree off the atlas photograph layer', () => {
  const ticker = newTicker();
  const system = Billboards.for(ticker);
  const root = new THREE.Group();
  const child = new THREE.Mesh(new THREE.PlaneGeometry(1, 1)); root.add(child);
  assert.equal(MAP_HIDDEN_LAYER, 2);
  system.add(root, { layer: MAP_HIDDEN_LAYER });
  const atlas = new THREE.Layers(); atlas.set(0);
  const gameplay = new THREE.Layers(); gameplay.set(0); gameplay.enable(MAP_HIDDEN_LAYER);
  for (const node of [root, child]) {
    assert.equal(atlas.test(node.layers), false, 'the atlas camera (layer 0) must not see it');
    assert.equal(gameplay.test(node.layers), true, 'the gameplay camera (layers 0 and 2) sees it');
  }
});

test('a mirrored parent is reported once', () => {
  const scene = new THREE.Scene();
  const ticker = newTicker();
  const camera = new THREE.PerspectiveCamera(25, 16 / 9, 0.1, 800);
  const system = Billboards.for(ticker).useCamera(() => camera);
  const mirror = new THREE.Group(); mirror.scale.set(-1, 1, 1); scene.add(mirror);
  const a = new THREE.Group(); a.name = 'mirrored plate'; mirror.add(a);
  const fine = new THREE.Group(); scene.add(fine);
  const b = new THREE.Group(); fine.add(b);
  system.add(a); system.add(b);
  aim(camera, 45, 41.4);
  scene.updateMatrixWorld(true);
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    for (let i = 0; i < 5; i++) { camera.position.x += 0.1; camera.updateMatrixWorld(); tick(ticker); }
  } finally { console.warn = original; }
  assert.equal(warnings.length, 1, warnings.join('\n'));
  assert.match(warnings[0], /mirrored/);
  assert.match(warnings[0], /mirrored plate/);
});

test('a tick allocates nothing (60 labels, moving camera, 300k ticks)', async () => {
  const { scene, frame } = socialFrame();
  const ticker = newTicker();
  const camera = new THREE.PerspectiveCamera(25, 16 / 9, 0.1, 800);
  const system = Billboards.for(ticker).useCamera(() => camera);
  for (let i = 0; i < 60; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.59));
    m.position.set(20 + (i % 10), 2.5, -25 + Math.floor(i / 10));
    frame.add(m);
    system.add(m, { mode: i % 3 === 0 ? 'cylindrical' : 'spherical', lean: 0.2, cull: 3, scale: { ref: 21, min: 1, max: 1.8 } });
  }
  scene.updateMatrixWorld(true);
  aim(camera, 45, 41.4);
  // Count the scavenges (young-generation collections) a run provokes: an allocation per tick fills the nursery,
  // a clean tick never does. Entries are delivered a turn of the event loop after the collection, so flush first.
  const minor = [];
  const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (entry.detail?.kind === constants.NODE_PERFORMANCE_GC_MINOR) minor.push(entry); });
  observer.observe({ entryTypes: ['gc'] });
  const settle = async () => { await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve)); };
  const run = async (step, ticks = 300_000) => {
    await settle();
    minor.length = 0;
    for (let i = 0; i < ticks; i++) step(i);
    await settle();
    return minor.length;
  };
  const jitter = (i) => { camera.position.x += i % 2 ? 1e-4 : -1e-4; camera.updateMatrixWorld(); };
  // Warm up the JIT first: compilation allocates, steady state must not.
  for (let i = 0; i < 30_000; i++) { jitter(i); system.update(); }
  // Best of three: an allocation per tick provokes scavenges in EVERY attempt, a busy machine's stray collection does not.
  let moving = Infinity, still = Infinity;
  for (let attempt = 0; attempt < 3 && (moving > 1 || still > 1); attempt++) {
    moving = Math.min(moving, await run((i) => { jitter(i); system.update(); }));
    still = Math.min(still, await run(() => system.update()));
  }
  // Control: the detector must see an allocating tick, or "zero" proves nothing.
  const control = await run((i) => { jitter(i); system.update(); new Float64Array(64 + (i & 1)); }, 100_000);
  observer.disconnect();
  assert.ok(control >= 5, `the allocation detector saw only ${control} scavenges for a ~100 MB control`);
  // One stray scavenge (the runner's own bookkeeping) is tolerated; a single boxed number per tick already costs ~4, an object per tick dozens.
  assert.ok(moving <= 1, `${moving} scavenges while the camera moved`);
  assert.ok(still <= 1, `${still} scavenges while nothing moved`);
});

test('a pass over 60 labels costs a few microseconds, far inside the per-frame budget', () => {
  const { scene, frame } = socialFrame();
  const ticker = newTicker();
  const camera = new THREE.PerspectiveCamera(25, 16 / 9, 0.1, 800);
  const system = Billboards.for(ticker).useCamera(() => camera);
  for (let i = 0; i < 60; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.59));
    m.position.set(20 + (i % 10), 2.5, -25 + Math.floor(i / 10));
    frame.add(m);
    system.add(m, { cull: 3, scale: { ref: 21, min: 1, max: 1.8 } });
  }
  scene.updateMatrixWorld(true);
  aim(camera, 45, 41.4);
  const N = 20_000;
  // CPU time of this process, best of three runs: a machine under heavy load deschedules a wall-clock timer, not the CPU time.
  const cpuMs = (step) => { let best = Infinity; for (let run = 0; run < 3; run++) { const t0 = process.cpuUsage(); for (let i = 0; i < N; i++) step(i); const t = process.cpuUsage(t0); best = Math.min(best, (t.user + t.system) / 1e3 / N); } return best; };
  for (let i = 0; i < 2000; i++) { camera.position.x += i % 2 ? 1e-4 : -1e-4; camera.updateMatrixWorld(); system.update(); }
  const movingMs = cpuMs((i) => { camera.position.x += i % 2 ? 1e-4 : -1e-4; camera.updateMatrixWorld(); system.update(); });
  const stillMs = cpuMs(() => system.update());
  // The acceptance budget is 0.05 ms per frame for everything; leave generous headroom for a loaded CI machine.
  assert.ok(movingMs < 0.05, `moving camera: ${(movingMs * 1000).toFixed(1)} us per tick`);
  assert.ok(stillMs < movingMs, `static camera is cheaper: ${(stillMs * 1000).toFixed(2)} us vs ${(movingMs * 1000).toFixed(2)} us`);
});

test('the system runs after the camera and every controller that can move a label', () => {
  // View moves the camera; the controllers and the Tweens move labels. All must tick BEFORE the billboards (order 21).
  const orders = (file) => [...fs.readFileSync(path.join(PREVIEW, file), 'utf8').matchAll(/events\.on\(\s*'tick'\s*,\s*[\w.]+\s*,\s*(\d+(?:\.\d+)?)\s*\)/g)].map((m) => Number(m[1]));
  const controllers = fs.readdirSync(path.join(PREVIEW, 'portfolio/world2/interactions')).filter((f) => f.endsWith('.js') && f !== 'Billboards.js').map((f) => `portfolio/world2/interactions/${f}`);
  const required = ['portfolio/world/view/View.js', 'portfolio/world/core/Tween.js', 'activities.js', 'track-gameplay.js', ...controllers];
  const seen = {};
  for (const file of required) for (const order of orders(file)) seen[file] = Math.max(seen[file] ?? 0, order);
  assert.ok(seen['portfolio/world/view/View.js'] < ORDER, 'View (the camera) ticks before the billboards');
  assert.ok(seen['portfolio/world/core/Tween.js'] < ORDER, 'Tweens tick before the billboards');
  for (const [file, order] of Object.entries(seen)) assert.ok(order < ORDER, `${file} ticks at ${order}: it must run before the billboards (${ORDER}) or its moves lag a frame`);
  assert.ok(Object.keys(seen).length >= 10, `found the tick subscribers of ${Object.keys(seen).length} files`);
});

test('every prompt is registered with the billboards, and Driving hands them the camera that is rendered', () => {
  for (const file of ['src/world2/interactions/Prompts.ts', `${PREVIEW}/portfolio/world2/interactions/Prompts.js`]) {
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /Billboards\.for\(this\.ticker\)\.add\(group/, `${file} registers each prompt group`);
    assert.match(text, /item\.billboard\.remove\(\)/, `${file} releases the handle with the prompt`);
    assert.doesNotMatch(text, /\.lookAt\(\s*(player|this\.game\.player)/, `${file} never aims a label at the car`);
  }
  // Without this one line every billboard is a no-op (it has no camera): other agents edit driving.js, so guard it.
  const driving = fs.readFileSync(`${PREVIEW}/runtime/driving.js`, 'utf8');
  assert.match(driving, /import\s*\{\s*Billboards\s*\}\s*from\s*'\.\.\/portfolio\/world2\/interactions\/Billboards\.js'/);
  assert.match(driving, /this\.view\.camera\s*=\s*camera;\s*Billboards\.for\(this\.ticker\)\.useCamera\(\(\)\s*=>\s*camera\)/);
});

/* ------------------------------------------------------------------------------------------------------------------
   The screen fit of an open prompt: its label stays inside the picture (a phone held upright is ~6 m wide at the chase
   camera), where the screen has no problem with it nothing moves, and none of it allocates.
   ------------------------------------------------------------------------------------------------------------------ */

const SAFE = 0.95;
const fresh = () => fitState();
/** `fitPrompt` takes its question in the fields of the object it fills (see PromptFit): written one by one here too, so the call itself allocates nothing. */
const fitPrompt = (out, anchor, k, body, ownLeft, lo, hi, floor, swap) => {
  out.anchor = anchor; out.k = k; out.body = body; out.ownLeft = ownLeft; out.lo = lo; out.hi = hi; out.floor = floor; out.swap = swap;
  return fitJob(out);
};
/** What a decision says (its answer fields). */
const decided = ({ shift, own, other, scale, flipped }) => ({ shift, own, other, scale, flipped });
/** The prompt's rectangle in clip space for a decision: label body + diamond tip, `k` clip units per local unit, the label `body` units wide. */
function extent(fit, anchor, k, body, ownLeft, reach = 0.75) {
  const left = ownLeft !== fit.flipped;
  const w = body * k * fit.scale, d = reach * k * fit.scale, at = anchor + fit.shift * k;
  return left ? [at - w, at + d] : [at - d, at + w];
}

test('fitPrompt: a prompt that fits is left exactly as authored', () => {
  for (const ownLeft of [true, false]) {
    const fit = fitPrompt(fresh(), 0, 0.2, 4, ownLeft, -SAFE, SAFE, 0.6, 0.04);
    assert.deepEqual(decided(fit), { shift: 0, own: 0, other: 0, scale: 1, flipped: false });
  }
});

test('fitPrompt: a label running off the screen swaps to the side that has room, then slides the least that brings it in', () => {
  // The Behind-the-scenes case on a 390 px phone: anchor at -0.35, the label 1.4 wide hangs left of it (authored) and is cut.
  const k = 0.25, body = 5.6;
  const fit = fitPrompt(fresh(), -0.35, k, body, true, -SAFE, SAFE, 0.6, 0.04);
  assert.equal(fit.flipped, true, 'the other side has room');
  const [lo, hi] = extent(fit, -0.35, k, body, true);
  assert.ok(lo >= -SAFE - 1e-9 && hi <= SAFE + 1e-9, `inside the screen: ${lo.toFixed(3)}..${hi.toFixed(3)}`);
  assert.ok(Math.abs(fit.shift * k) < 0.2, `a short slide (${(fit.shift * k).toFixed(3)} clip units), not the 0.8 the authored side needed`);
  // Where both sides ask the same slide (a label as wide as the screen, anchor in the middle) the authored side stays and it slides.
  const stays = fitPrompt(fresh(), 0, 0.25, 7, true, -SAFE, SAFE, 0.6, 0.04);
  assert.equal(stays.flipped, false);
  assert.ok(stays.shift > 0, 'slid right, into the picture');
});

test('fitPrompt: a prompt wider than the room is shrunk to it, never below the floor, and then slid inside', () => {
  const k = 0.3, body = 7.3;                       // 2.2 + 0.2 wide: more than the 1.9 the screen offers
  const fit = fitPrompt(fresh(), 0, k, body, false, -SAFE, SAFE, 0.5, 0.04);
  assert.ok(fit.scale < 1 && fit.scale > 0.7, `shrunk to the room (${fit.scale.toFixed(3)})`);
  const [lo, hi] = extent(fit, 0, k, body, false);
  assert.ok(lo >= -SAFE - 1e-9 && hi <= SAFE + 1e-9, `inside the screen: ${lo.toFixed(3)}..${hi.toFixed(3)}`);
  const floored = fitPrompt(fresh(), 0, k, body, false, -SAFE, SAFE, 0.95, 0.04);
  assert.ok(Math.abs(floored.scale - 0.95) < 1e-9, 'the floor (a share of full size) is the least it shrinks to');
  const never = fitPrompt(fresh(), 0, 0.05, 5, false, -SAFE, SAFE, 3, 0.04);
  assert.equal(never.scale, 1, 'it never GROWS: a floor above 1 means the type is already small, the fit leaves it');
});

test('fitPrompt: keeps off a keep-out by narrowing the room, and never flickers between two near-equal sides', () => {
  // The touch column on the right: room -0.95..0.4. A label at anchor 0 hanging right (1.2 wide) would run under it.
  const fit = fitPrompt(fresh(), 0, 0.2, 6, false, -SAFE, 0.4, 0.6, 0.04);
  const [lo, hi] = extent(fit, 0, 0.2, 6, false);
  assert.ok(hi <= 0.4 + 1e-9 && lo >= -SAFE - 1e-9, `kept off the column: ${lo.toFixed(3)}..${hi.toFixed(3)}`);
  // Hysteresis: at a spot where both sides ask the same slide, the side it already has is the side it keeps...
  for (const start of [false, true]) {
    const state = { ...fresh(), flipped: start };
    fitPrompt(state, 0, 0.3, 7, true, -SAFE, SAFE, 0.5, 0.04);
    assert.equal(state.flipped, start, `kept its side (${start})`);
  }
  // ...but a prompt whose authored side fits is on it, whatever side an earlier camera put it on (the orbit must not leave it flipped).
  const back = { ...fresh(), flipped: true };
  fitPrompt(back, 0, 0.2, 4, true, -SAFE, SAFE, 0.6, 0.04);
  assert.equal(back.flipped, false);
  assert.equal(back.shift, 0);
});

test('fitPrompt: over a sweep of anchors and sizes the prompt is always inside the screen when it can be, and continuous in the anchor', () => {
  let checked = 0, worst = 0;
  for (const k of [0.12, 0.2, 0.25, 0.3]) for (const body of [2.4, 4.4, 5.6, 7.3]) for (const own of [true, false]) {
    const state = fresh();
    let last = null;
    for (let anchor = -0.9; anchor <= 0.9; anchor += 0.01) {
      fitPrompt(state, anchor, k, body, own, -SAFE, SAFE, 0.6, 0.04);
      const [lo, hi] = extent(state, anchor, k, body, own);
      const room = (body + 0.75) * k * state.scale;
      if (room <= 2 * SAFE) { checked++; assert.ok(lo >= -SAFE - 1e-9 && hi <= SAFE + 1e-9, `k ${k} body ${body} anchor ${anchor.toFixed(2)}: ${lo.toFixed(3)}..${hi.toFixed(3)}`); }
      // Continuity: moving the anchor by 0.01 may swap the side (a jump of up to a label) but never otherwise jumps the prompt.
      if (last && last.flipped === state.flipped) worst = Math.max(worst, Math.abs(extent(state, anchor, k, body, own)[1] - last.hi - 0.01));
      last = { flipped: state.flipped, hi };
    }
  }
  assert.ok(checked > 1000, `${checked} poses checked`);
  assert.ok(worst < 0.025, `without a swap the prompt follows the anchor within ${worst.toFixed(4)} clip units`);
});

/** The interact button's keep-out, in clip space: x 0.2..0.9, y -0.1..0.1 (its air included). */
const BUTTON = keepOut(0.2, -0.1, 0.9, 0.1);
const NONE = keepOut(2, 2, -2, -2);
/** What liftClear is asked, as the job object it takes (the prompt's label across x0..x1 and centre +- half up, its head, the ceiling, how many keep-outs count, the slack). */
const job = (x0, x1, centre, half, head, ceiling, count, slack) => Object.assign(liftJob(), { x0, x1, centre, half, head, ceiling, count, slack, rise: 0 });
const lift = (x0, x1, centre, half = 0.05, head = 0.1, button = BUTTON, ceiling = 0.9) => liftClear(job(x0, x1, centre, half, head, ceiling, 1, 0.01), [button]).rise;
/** The touch column's keep-out (x 0.5..0.9, y -0.9..-0.15, its air included), which stands below the button of BUTTON. */
const COLUMN = keepOut(0.5, -0.9, 0.9, -0.15);
const liftAll = (x0, x1, centre, keepOuts, count = keepOuts.length, slack = 0.01, half = 0.05, head = 0.1, ceiling = 0.9) => liftClear(job(x0, x1, centre, half, head, ceiling, count, slack), keepOuts).rise;

test('liftClear: a label over the button is lifted until its bottom edge stands on the button; a clear one, or no button, is left alone', () => {
  // The label spans x -0.3..0.5 (it runs under the button's 0.2..0.9) and is centred in the button's band, 0.05 tall either side.
  const rise = lift(-0.3, 0.5, 0.0);
  assert.ok(Math.abs(rise - (0.1 - (0 - 0.05))) < 1e-12, `its bottom (-0.05) goes up to the button's top (0.1): rise ${rise}`);
  // Clear sideways, above, below, and with the button not there: 0.
  assert.equal(lift(-0.9, 0.1, 0.0), 0, 'ends short of the button');
  assert.equal(lift(0.95, 1.2, 0.0), 0, 'starts past it');
  assert.equal(lift(-0.3, 0.5, 0.2), 0, 'stands above it');
  assert.equal(lift(-0.3, 0.5, -0.2), 0, 'stands below it');
  assert.equal(lift(-0.3, 0.5, 0.0, 0.05, 0.1, NONE), 0, 'no button on the page');
  // Just touching its air is a lift of that much, and no more: the rise is the overlap, so it is continuous in the label's height.
  let last = null;
  for (let centre = 0.249; centre >= -0.249; centre -= 0.001) {
    const r = lift(-0.3, 0.5, centre);
    if (last !== null) assert.ok(Math.abs(r - last) < 0.0011 || (last === 0 && r > 0 && r < 0.0011) || r === 0, `continuous while the label sinks into the button (${last} -> ${r} at ${centre})`);
    last = r;
  }
});

test('liftClear: never lifts the prompt past the ceiling (the top bar), and never pushes it down', () => {
  // Room above the prompt's head: 0.9 - (0.0 + 0.1) = 0.8 > the 0.15 it takes.
  assert.ok(Math.abs(lift(-0.3, 0.5, 0.0) - 0.15) < 1e-12);
  // Ceiling at 0.12: only 0.02 of room, so that is how far it goes (it is as clear of the button as the screen leaves it).
  assert.ok(Math.abs(lift(-0.3, 0.5, 0.0, 0.05, 0.1, BUTTON, 0.12) - 0.02) < 1e-12);
  // A prompt already at or above the ceiling is not pushed down, whatever the button asks.
  assert.equal(lift(-0.3, 0.5, 0.0, 0.05, 0.1, BUTTON, 0.05), 0);
  assert.equal(lift(-0.3, 0.5, 0.0, 0.05, 0.1, BUTTON, -0.5), 0);
});

test('liftClear: a label over the touch column is lifted above it and then above the button it stands under; slack, count and the ceiling', () => {
  const both = [BUTTON, COLUMN];
  // On the column (y -0.35 +- 0.05): up to the column's top (-0.15), which is under the button's bottom (-0.1) by less than the label's
  // height (0.1), so that on the column's top the label is over the button: and up again, to the button's top, 0.1.
  const rise = liftAll(0.3, 0.8, -0.35, both);
  assert.ok(Math.abs(rise - (0.1 - (-0.35 - 0.05))) < 1e-12, `its bottom (-0.4) ends on the button's top (0.1): rise ${rise}`);
  // Count 1 is the button alone (entry 0): a label under it, on the column, is left alone then.
  assert.equal(liftAll(0.3, 0.8, -0.35, both, 1), 0, 'with only the button counted a label under it is left alone');
  const column = liftAll(0.3, 0.8, -0.5, both);
  assert.ok(Math.abs(column - (0.1 - (-0.5 - 0.05))) < 1e-12, `from lower down it is lifted over both: ${column}`);
  // A label that does not reach the column's x range is not lifted by it, wherever it stands in y.
  assert.equal(liftAll(-0.9, 0.4, -0.5, both), 0, 'stops short of the column');
  // Standing against the column to the pixel (x1 == its left edge, or a hair past it) is not an overlap; a pixel or two into its air is not either (the slack).
  assert.equal(liftAll(-0.6, 0.5, -0.5, both), 0, 'touching');
  assert.equal(liftAll(-0.6, 0.5 + 1e-7, -0.5, both), 0, 'a float past it');
  assert.equal(liftAll(-0.6, 0.5 + 0.009, -0.5, both), 0, 'inside the slack');
  assert.ok(liftAll(-0.6, 0.5 + 0.02, -0.5, both) > 0.5, 'beyond the slack it is lifted, to the top of everything it stands over');
  // The button has no slack: its air is its margin.
  assert.ok(liftAll(-0.3, 0.2 + 0.001, 0.0, [BUTTON]) > 0, 'a hair into the button is lifted');
  // A button that is not there, a column that is not there: the other one still counts.
  assert.ok(Math.abs(liftAll(0.3, 0.8, -0.5, [NONE, COLUMN]) - (-0.15 - (-0.5 - 0.05))) < 1e-12, 'the column alone: up to its top');
  assert.ok(Math.abs(liftAll(0.3, 0.8, -0.5, [BUTTON, NONE]) ) < 1e-12, 'the button alone: nothing');
  // The ceiling still rules: only 0.05 of room above the head, so it goes no further.
  const capped = liftAll(0.3, 0.8, -0.35, both, 2, 0.01, 0.05, 0.1, 0.0);
  assert.ok(Math.abs(capped - (0.0 - (-0.35 + 0.1))) < 1e-12, `capped at the ceiling: ${capped}`);
  // And never down.
  assert.equal(liftAll(0.3, 0.8, -0.35, both, 2, 0.01, 0.05, 0.1, -0.9), 0);
});

test('fitPrompt allocates nothing (1.5 million calls)', async () => {
  const state = fresh();
  const minor = [];
  const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (entry.detail?.kind === constants.NODE_PERFORMANCE_GC_MINOR) minor.push(entry); });
  observer.observe({ entryTypes: ['gc'] });
  const settle = async () => { await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve)); };
  const run = async (step, calls = 1_500_000) => { await settle(); minor.length = 0; for (let i = 0; i < calls; i++) step(i); await settle(); return minor.length; };
  const rising = job(0, 0, 0, 0.05, 0.1, 0.9, 2, 0.01);
  const KEEP_OUTS = [BUTTON, COLUMN];
  const call = (i) => {
    fitPrompt(state, ((i % 190) - 95) / 100, 0.25, 5.6 + (i & 3), (i & 1) === 0, -SAFE, SAFE, 0.6, 0.04);
    rising.x0 = ((i % 190) - 95) / 100; rising.x1 = 0.4; rising.centre = ((i % 37) - 18) / 100; rising.count = 2 - (i & 1);
    liftClear(rising, KEEP_OUTS);
  };
  for (let i = 0; i < 100_000; i++) call(i);
  let scavenges = Infinity;
  for (let attempt = 0; attempt < 3 && scavenges > 1; attempt++) scavenges = Math.min(scavenges, await run(call));
  // The control allocates ~200 MB (more than a dozen scavenges at the usual young generation); where the young generation has grown (a loaded machine, a
  // test run before this one) it allocates more until the detector sees it: the detector's own sensitivity is what is checked, not a fixed volume.
  let control = 0;
  for (let n = 200_000; control < 5 && n <= 3_200_000; n *= 2) control = await run((i) => { call(i); new Float64Array(128 + (i & 1)); }, n);
  observer.disconnect();
  assert.ok(control >= 5, `the allocation detector saw only ${control} scavenges for a control`);
  assert.ok(scavenges <= 1, `${scavenges} scavenges over 1.5 million fits`);
});

/** A real Prompts with the thinnest stand-ins for what it draws on: a canvas whose text is 24 px a letter, no page, no GPU. */
function promptsWorld({ aspect, radius, width, height, frame = null, withCamera = true, elements = {} }) {
  const had = { document: globalThis.document, innerWidth: globalThis.innerWidth, innerHeight: globalThis.innerHeight };
  // `elements`: the page's controls by id, as the CSS px boxes {left, top, right, bottom} a browser would give; a test may change them.
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({ measureText: (text) => ({ width: text.length * 24 }) }, { get: (target, key) => (key in target ? target[key] : () => {}), set: () => true }) }),
    getElementById: (id) => (elements[id] ? { getBoundingClientRect: () => ({ ...elements[id], width: elements[id].right - elements[id].left, height: elements[id].bottom - elements[id].top }) } : null),
  };
  globalThis.innerWidth = width; globalThis.innerHeight = height;
  const restore = () => { for (const [key, value] of Object.entries(had)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } };
  const ticker = { events: new Events(), delta: 1 / 60, elapsed: 0 };
  const disposers = [];
  const bin = { add: (fn) => disposers.push(fn), object3D: () => {} };
  const tweens = new Tweens(ticker, bin);
  const car = new THREE.Vector3();
  const prompts = new Prompts(ticker, tweens, { mode: 'touch' }, bin, () => car);
  const scene = new THREE.Scene();
  (frame ?? scene).add(prompts.group);
  if (frame) scene.add(frame);
  const camera = new THREE.PerspectiveCamera(25, aspect, 0.1, 800);
  Billboards.for(ticker).useCamera(() => (withCamera ? camera : null));
  const look = (yaw = 45, elevation = 41.4) => {
    const target = car.clone().applyMatrix4(prompts.group.matrixWorld).add(new THREE.Vector3(0, 1.3, 0));
    camera.position.copy(target).add(new THREE.Vector3().setFromSphericalCoords(radius, (90 - elevation) * deg, yaw * deg));
    camera.lookAt(target); camera.updateMatrixWorld();
  };
  /** Frames the prompt needs to open, orient, fit and settle its swap. */
  const run = (frames = 30) => { for (let i = 0; i < frames; i++) { ticker.elapsed += 1 / 60; look(); ticker.events.trigger('tick'); scene.updateMatrixWorld(true); } };
  /** The label's rectangle in CSS px of the screen. */
  const rect = (item) => {
    const points = [[0, -0.5], [1, -0.5], [0, 0.5], [1, 0.5]].map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(item.labelMesh.matrixWorld).project(camera));
    const xs = points.map((p) => (p.x * 0.5 + 0.5) * width), ys = points.map((p) => (-p.y * 0.5 + 0.5) * height);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  };
  return { prompts, car, camera, scene, ticker, look, run, rect, restore, disposers, elements };
}
/** The share of the label's rectangle that is inside the screen. */
const insideShare = (r, width, height) => Math.max(0, Math.min(r.x1, width) - Math.max(r.x0, 0)) * Math.max(0, Math.min(r.y1, height) - Math.max(r.y0, 0)) / ((r.x1 - r.x0) * (r.y1 - r.y0));
const RING = Array.from({ length: 8 }, (_, i) => [Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)]);

test('a real prompt on a 390x844 phone: the label is inside the screen in every pose, in front of the car; with the fit off it is cut', () => {
  const world = promptsWorld({ aspect: 390 / 844, radius: 31.3, width: 390, height: 844 });
  try {
    const { prompts } = world;
    const handles = ['Behind the scenes', 'Next experiment', 'Take a cookie', 'Achievements', 'Start the penguin round-up'].map((label, i) => (
      prompts.create({ label, position: new THREE.Vector3(i * 100, 2.4, 0), align: i % 2 ? 'left' : 'right', onInteract() {} })));
    let poses = 0, clipped = 0, bare = 0, pulled = 0;
    for (const [i, handle] of handles.entries()) {
      const item = prompts.items[i];
      for (const [dx, dz] of RING) for (const r of [0.4, 1.3]) {
        world.car.set(i * 100 + dx * r, 0, dz * r);
        prompts.fitting = true;
        world.run();
        assert.equal(prompts.activeLabel, handle.label, `${handle.label} opened from (${dx.toFixed(2)}, ${dz.toFixed(2)}) x ${r}`);
        const share = insideShare(world.rect(item), 390, 844);
        poses++;
        if (share < 0.999) clipped++;
        if (item.pull > 0.99) pulled++;
        prompts.fitting = false;
        world.run(3);
        if (insideShare(world.rect(item), 390, 844) < 0.99) bare++;
      }
    }
    assert.equal(clipped, 0, `${clipped} of ${poses} poses cut the label`);
    assert.ok(bare >= poses * 0.15, `control: with the fit off the label is cut in ${bare} of ${poses} poses`);
    assert.ok(pulled > 0, 'a moved prompt is drawn nearer the lens');
  } finally { world.restore(); }
});

/** The page's controls on a 360x640 phone as the real page lays them out (measured in Chromium: the button for 'Take a cookie'). */
const PHONE_360 = {
  'interact-action': { left: 216.8, top: 300, right: 346, bottom: 340 },
  'touch-controls': { left: 268, top: 352, right: 346, bottom: 540 },
  'player-nav': { left: 10, top: 10, right: 350, bottom: 54 },
};
/** The share of a rectangle {x0,y0,x1,y1} that a box {left,top,right,bottom} covers. */
const coverShare = (r, b) => {
  const w = Math.min(r.x1, b.right) - Math.max(r.x0, b.left), h = Math.min(r.y1, b.bottom) - Math.max(r.y0, b.top);
  return w > 0 && h > 0 ? w * h / ((r.x1 - r.x0) * (r.y1 - r.y0)) : 0;
};

test('a real prompt on a short phone stands above the interact button instead of under it; without the button nothing is lifted', () => {
  const LABELS = ['Take a cookie', 'Behind the scenes', 'Next experiment', 'Start the infield slalom', 'Clear best laps'];
  const poses = [];
  for (const [dx, dz] of RING) for (const r of [0.4, 1.3]) poses.push([dx * r, dz * r]);
  const run = (elements) => {
    const world = promptsWorld({ aspect: 360 / 640, radius: 31.3, width: 360, height: 640, elements });
    try {
      const { prompts } = world;
      const rows = [];
      for (const [i, label] of LABELS.entries()) {
        prompts.create({ label, position: new THREE.Vector3(i * 100, 1.6, 0), align: i % 2 ? 'left' : 'right', onInteract() {} });   // 1.6 m: where the real world's anchors stand against the car, on the screen
        const item = prompts.items[i];
        for (const [dx, dz] of poses) {
          world.car.set(i * 100 + dx, 0, dz);
          world.run();
          assert.equal(prompts.activeLabel, label);
          const r = world.rect(item);
          rows.push({ label, under: coverShare(r, PHONE_360['interact-action']), inside: insideShare(r, 360, 640), top: r.y0, lift: item.lift });
        }
      }
      return rows;
    } finally { world.restore(); }
  };
  const bare = run({});
  const lifted = run(PHONE_360);
  assert.ok(bare.every((r) => r.lift === 0), 'with no button on the page, nothing is lifted');
  assert.ok(bare.filter((r) => r.under > 0.3).length >= 10, `control: without the lift the label is under the button in ${bare.filter((r) => r.under > 0.3).length} of ${bare.length} poses`);
  const worst = lifted.reduce((m, r) => Math.max(m, r.under), 0);
  assert.ok(worst <= 0.05, `with the lift no label has more than 5 % under the button (worst ${(worst * 100).toFixed(1)} %)`);
  assert.ok(lifted.every((r) => r.inside > 0.999), 'and every label stays inside the screen');
  assert.ok(lifted.every((r) => r.top >= 54 - 1), 'and under the top bar');
  assert.ok(lifted.filter((r) => r.lift > 0.05).length >= 10, 'the lift is what did it');
});

/** The page of a 360x640 phone with the interact button of 'Start the penguin round-up' (as wide as its text) and the speed readout. */
const PHONE_360_PENGUIN = {
  ...PHONE_360,
  'interact-action': { left: 120.7, top: 300, right: 345.7, bottom: 340 },
  'drive-hud': { left: 14, top: 562, right: 104, bottom: 612 },
};

test('a label too long to stand beside the touch column even at its smallest type is lifted above it, and the button, instead of left under it', () => {
  const POSES = [];
  for (const [dx, dz] of RING) for (const r of [0.4, 1.3, 2.2]) POSES.push([dx * r, dz * r]);
  const run = (elements, radius) => {
    const world = promptsWorld({ aspect: 360 / 640, radius, width: 360, height: 640, elements });
    try {
      const { prompts } = world;
      prompts.create({ label: 'Start the penguin round-up', position: new THREE.Vector3(0, 1.6, 0), align: 'left', onInteract() {} });
      const item = prompts.items[0];
      const rows = [];
      for (const [dx, dz] of POSES) {
        world.car.set(dx, 0, dz);
        world.run(40);
        assert.equal(prompts.activeLabel, 'Start the penguin round-up');
        const r = world.rect(item);
        const under = {};
        for (const [id, box] of Object.entries(PHONE_360_PENGUIN)) under[id] = coverShare(r, box);
        rows.push({ dx, dz, under, worst: Math.max(...Object.values(under)), inside: insideShare(r, 360, 640), top: r.y0, lift: item.lift, capPx: ((r.y1 - r.y0) * 0.37) / 0.75 });
      }
      return rows;
    } finally { world.restore(); }
  };
  for (const radius of [31.3, 21]) {
    const bare = run({}, radius);
    const clear = run(PHONE_360_PENGUIN, radius);
    const column = (rows) => rows.filter((r) => r.under['touch-controls'] > 0.05).length;
    assert.ok(column(bare) >= 4, `${radius} m: control: with no controls known the label IS under the touch column in ${column(bare)} of ${bare.length} poses`);
    const worst = clear.reduce((m, r) => (r.worst > m.worst ? r : m), clear[0]);
    assert.ok(worst.worst <= 0.05, `${radius} m: no label has more than 5 % under the column, the button, the readout or the top bar (worst ${(worst.worst * 100).toFixed(1)} % at car (${worst.dx.toFixed(2)}, ${worst.dz.toFixed(2)}): ${JSON.stringify(worst.under)})`);
    assert.ok(clear.every((r) => r.inside > 0.999), `${radius} m: and every label stays inside the screen`);
    assert.ok(clear.every((r) => r.capPx >= 12.4), `${radius} m: at 12.5 px of type or more (smallest ${Math.min(...clear.map((r) => r.capPx)).toFixed(1)})`);
    assert.ok(clear.filter((r) => r.lift > 0.05 && bare.find((b) => b.dx === r.dx && b.dz === r.dz).under['touch-controls'] > 0.05).length >= 4, `${radius} m: the lift is what cleared the column`);
  }
});

test('a label that does fit beside the touch column is slid or shrunk to it, never lifted over it', () => {
  const POSES = [];
  for (const [dx, dz] of RING) for (const r of [0.4, 1.3, 2.2]) POSES.push([dx * r, dz * r]);
  let poses = 0;
  for (const label of ['Take a cookie', 'Behind the scenes', 'Next experiment', 'Clear best laps', 'Projects', 'Jukebox']) for (const align of ['left', 'right']) {
    const world = promptsWorld({ aspect: 360 / 640, radius: 31.3, width: 360, height: 640, elements: { 'touch-controls': PHONE_360['touch-controls'], 'player-nav': PHONE_360['player-nav'] } });
    try {
      const { prompts } = world;
      prompts.create({ label, position: new THREE.Vector3(0, 1.6, 0), align, onInteract() {} });
      const item = prompts.items[0];
      for (const [dx, dz] of POSES) {
        world.car.set(dx, 0, dz);
        world.run(40);
        if (prompts.activeLabel !== label) continue;
        poses++;
        const r = world.rect(item);
        assert.equal(item.lift, 0, `${label} (${align}) from (${dx.toFixed(2)}, ${dz.toFixed(2)}) is not lifted`);
        assert.ok(coverShare(r, PHONE_360['touch-controls']) <= 0.01 && insideShare(r, 360, 640) > 0.999, `${label} (${align}) beside the column, inside the screen`);
      }
    } finally { world.restore(); }
  }
  assert.ok(poses >= 100, `${poses} poses`);
});

test('a prompt that opens before the interact button shows is lifted at once, one that is under a button that appears later glides up', () => {
  const elements = {};
  const world = promptsWorld({ aspect: 360 / 640, radius: 31.3, width: 360, height: 640, elements });
  try {
    const { prompts } = world;
    prompts.create({ label: 'Take a cookie', position: new THREE.Vector3(0, 1.6, 0), align: 'right', onInteract() {} });
    const item = prompts.items[0];
    const pill = PHONE_360['interact-action'];
    world.car.set(0.4, 0, 0);
    world.run(1);                                       // the frame the prompt opens: the page has no button yet
    assert.equal(prompts.activeLabel, 'Take a cookie');
    Object.assign(elements, PHONE_360);                 // the HUD writes it on the frame after
    world.run(2);
    assert.ok(coverShare(world.rect(item), pill) <= 0.05, 'clear of the button within the frames of the opening, without a glide');
    // Now a button that appears under an open prompt (its label changed, say): the lift eases in, a few frames, never a jump.
    for (const key of Object.keys(elements)) delete elements[key];
    world.run(60);                                      // the next read of the page, then the glide down
    assert.equal(item.lift, 0, 'the lift goes when the button does');
    Object.assign(elements, PHONE_360);
    const start = world.rect(item).y0;
    let last = start, worst = 0, moving = 0;
    for (let i = 0; i < 40; i++) {                      // the page is read every quarter second; the next read sees the button
      world.run(1);
      const y = world.rect(item).y0;
      worst = Math.max(worst, Math.abs(y - last));
      if (Math.abs(y - last) > 0.5) moving++;
      last = y;
    }
    assert.ok(coverShare(world.rect(item), pill) <= 0.05, 'and ends clear of it');
    assert.ok(start - last > 20, `lifted by ${(start - last).toFixed(0)} px`);
    assert.ok(moving >= 4 && worst < 40, `in ${moving} frames, at most ${worst.toFixed(0)} px in one: a glide, not a jump`);
  } finally { world.restore(); }
});

test('on a phone held upright every open prompt is drawn nearer the lens, in the same place and size; on a tablet, a desktop or a phone on its side none is', () => {
  const place = (width, height, aspect, radius) => {
    const world = promptsWorld({ aspect, radius, width, height });
    world.prompts.create({ label: 'Jukebox', position: new THREE.Vector3(0, 2.4, 0), align: 'right', onInteract() {} });
    world.car.set(0.4, 0, 0);
    return world;
  };
  const centre = (world) => new THREE.Vector3().setFromMatrixPosition(world.prompts.items[0].labelMesh.matrixWorld);
  for (const [name, width, height, radius, pulled] of [['phone 390x844', 390, 844, 31.3, true], ['phone 360x640', 360, 640, 31.3, true], ['tablet 834x1112', 834, 1112, 26, false], ['desktop 1440x900', 1440, 900, 21, false], ['phone on its side 667x375', 667, 375, 21, false]]) {
    const world = place(width, height, width / height, radius);
    try {
      const item = world.prompts.items[0];
      world.run();
      assert.equal(world.prompts.activeLabel, 'Jukebox', name);
      const near = world.rect(item), nearCentre = centre(world);
      if (pulled) assert.ok(item.pull > 0.99 && item.fit.scale.x < 0.95, `${name}: drawn nearer (pull ${item.pull.toFixed(2)}, scale ${item.fit.scale.x.toFixed(3)})`);
      else assert.ok(item.pull === 0 && item.fit.scale.x === 1, `${name}: left as authored (pull ${item.pull})`);
      world.prompts.fitPull = 0;
      world.run(40);
      const flat = world.rect(item), flatCentre = centre(world);
      for (const key of ['x0', 'x1', 'y0', 'y1']) assert.ok(Math.abs(near[key] - flat[key]) < 0.5, `${name}: the same picture with and without the pull (${key} ${near[key].toFixed(2)} vs ${flat[key].toFixed(2)})`);
      const gap = world.camera.position.distanceTo(flatCentre) - world.camera.position.distanceTo(nearCentre);
      if (pulled) assert.ok(gap > 10 && gap < 12, `${name}: ${gap.toFixed(2)} m nearer the lens (FIT_PULL is 11 m: past the trees that stand between the lens and a label)`);
      else assert.ok(Math.abs(gap) < 1e-6, `${name}: at its own depth`);
    } finally { world.restore(); }
  }
});

test('a real prompt on a desktop screen: the fit leaves every pose exactly as authored', () => {
  const world = promptsWorld({ aspect: 16 / 9, radius: 21, width: 1440, height: 900 });
  try {
    const { prompts } = world;
    for (const [i, label] of ['Behind the scenes', 'Next experiment', 'Achievements'].entries()) {
      prompts.create({ label, position: new THREE.Vector3(i * 100, 2.4, 0), align: i % 2 ? 'left' : 'right', onInteract() {} });
      const item = prompts.items[i];
      for (const [dx, dz] of RING) {
        world.car.set(i * 100 + dx, 0, dz);
        world.run();
        assert.equal(prompts.activeLabel, label);
        assert.equal(item.fit.position.length(), 0, `${label}: not slid`);
        assert.equal(item.fit.scale.x, 1, `${label}: not scaled`);
        assert.equal(item.left, item.align === 'right' ? 1 : 0, `${label}: on its authored side`);
        assert.equal(item.labelMesh.material.uniforms.labelShift.value, 0, `${label}: its type is where it was painted`);
        assert.ok(insideShare(world.rect(item), 1440, 900) > 0.999);
      }
    }
  } finally { world.restore(); }
});

test('the fit works in a scaled, rotated frame, and with no camera (/world2, the studio) it does nothing', () => {
  const frame = new THREE.Group();
  frame.position.set(25.4, 0.15, 42.4); frame.rotation.y = -60 * deg; frame.scale.setScalar(0.7);
  const world = promptsWorld({ aspect: 390 / 844, radius: 31.3, width: 390, height: 844, frame });
  try {
    const { prompts } = world;
    prompts.create({ label: 'Curriculum vitae', position: new THREE.Vector3(0, 2.4, 0), align: 'right', onInteract() {} });
    const item = prompts.items[0];
    let clipped = 0;
    for (const [dx, dz] of RING) {
      world.car.set(dx * 1.3, 0, dz * 1.3);
      world.run();
      assert.equal(prompts.activeLabel, 'Curriculum vitae');
      if (insideShare(world.rect(item), 390, 844) < 0.999) clipped++;
    }
    assert.equal(clipped, 0, `${clipped} of 8 poses cut the label in a 0.7-scaled frame`);
  } finally { world.restore(); }
  // No camera (/world2, the studio's Edit and Simulate): the authored attitude, untouched by the fit.
  const bare = promptsWorld({ aspect: 390 / 844, radius: 31.3, width: 390, height: 844, withCamera: false });
  try {
    bare.prompts.create({ label: 'Curriculum vitae', position: new THREE.Vector3(0, 2.4, 0), align: 'right', onInteract() {} });
    const item = bare.prompts.items[0];
    bare.car.set(0.3, 0, 0); bare.run(10);
    assert.equal(bare.prompts.activeLabel, 'Curriculum vitae');
    assert.equal(item.fit.position.length(), 0);
    assert.equal(item.fit.scale.x, 1);
    assert.equal(item.left, 1);
  } finally { bare.restore(); }
});

test('the fit runs after the billboards, once per frame, for the open prompt only, and goes away with the prompts', () => {
  assert.equal(AFTER_ORDER, ORDER + 1);
  const world = promptsWorld({ aspect: 390 / 844, radius: 31.3, width: 390, height: 844 });
  try {
    const orders = [...world.ticker.events.callbacks.get('tick').keys()];
    assert.ok(orders.includes(AFTER_ORDER), `a tick subscriber at ${AFTER_ORDER}`);
    assert.ok(orders.includes(9), 'the proximity test is still at 9');
    const before = world.ticker.events.callbacks.get('tick').get(AFTER_ORDER).size;
    for (const dispose of world.disposers) dispose();
    assert.ok(!world.ticker.events.callbacks.get('tick')?.get(AFTER_ORDER)?.size, `the fit subscriber (${before}) is released with the prompts`);
  } finally { world.restore(); }
  for (const file of ['src/world2/interactions/Prompts.ts', `${PREVIEW}/portfolio/world2/interactions/Prompts.js`]) {
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /events\.on\('tick',\s*fit,\s*AFTER_ORDER\)/, `${file} fits after the billboards`);
    assert.doesNotMatch(text, /getBoundingClientRect\(\)[^;]*\n[^\n]*\bupdate\(\)/, 'no layout read in the per-frame update');
  }
});

test('the per-frame fit of the open prompt allocates nothing and costs a few microseconds', async () => {
  // A 360x640 phone: the interact button under the label (slide, shrink, lift and pull all engaged), and a label too long to stand beside
  // the touch column (blocked: it takes the screen and is lifted over the column and the button).
  const CASES = [
    { label: 'Behind the scenes', align: 'right', elements: PHONE_360, car: [0.3, 0] },
    { label: 'Start the penguin round-up', align: 'left', elements: PHONE_360_PENGUIN, car: [0, -2.2] },
  ];
  for (const { label, align, elements, car } of CASES) {
    const world = promptsWorld({ aspect: 360 / 640, radius: 31.3, width: 360, height: 640, elements });
    try {
      world.prompts.create({ label, position: new THREE.Vector3(0, 1.6, 0), align, onInteract() {} });
      const item = world.prompts.items[0];
      world.car.set(car[0], 0, car[1]);
      world.run();
      assert.ok(item.fit.position.length() > 0 && item.pull > 0.9, `${label}: the fit is engaged on a phone`);
      assert.ok(item.lift > 0.1, `${label}: and the prompt is lifted clear of the controls (${item.lift.toFixed(2)})`);
      assert.ok(coverShare(world.rect(item), elements['touch-controls']) <= 0.05, `${label}: and the touch column`);
      const { camera, prompts } = world;
      const jitter = (i) => { camera.position.x += i % 2 ? 1e-4 : -1e-4; camera.updateMatrixWorld(); };
      const minor = [];
      const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (entry.detail?.kind === constants.NODE_PERFORMANCE_GC_MINOR) minor.push(entry); });
      observer.observe({ entryTypes: ['gc'] });
      const settle = async () => { await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve)); };
      const run = async (step, calls = 300_000) => { await settle(); minor.length = 0; for (let i = 0; i < calls; i++) step(i); await settle(); return minor.length; };
      const call = (i) => { jitter(i); prompts.fit(); };
      for (let i = 0; i < 30_000; i++) call(i);
      let scavenges = Infinity;
      for (let attempt = 0; attempt < 3 && scavenges > 1; attempt++) scavenges = Math.min(scavenges, await run(call));
      // ~200 MB: more than a dozen scavenges at the usual young generation, and more until the detector sees it where that has grown (the second case, a loaded machine).
      let control = 0;
      for (let n = 200_000; control < 5 && n <= 3_200_000; n *= 2) control = await run((i) => { call(i); new Float64Array(128 + (i & 1)); }, n);
      observer.disconnect();
      assert.ok(control >= 5, `the allocation detector saw only ${control} scavenges for a control`);
      assert.ok(scavenges <= 1, `${label}: ${scavenges} scavenges over 300k per-frame fits`);
      // CPU time, best of five: a machine under heavy load deschedules a wall-clock timer, not the CPU time.
      let ms = Infinity;
      for (let attempt = 0; attempt < 5; attempt++) { const t0 = process.cpuUsage(); for (let i = 0; i < 20_000; i++) call(i); const t = process.cpuUsage(t0); ms = Math.min(ms, (t.user + t.system) / 1e3 / 20_000); }
      assert.ok(ms < 0.02, `${label}: one fit costs ${(ms * 1000).toFixed(2)} us (budget 20 us)`);
    } finally { world.restore(); }
  }
});

test('a swap of the label\'s side slides the label and the prompt across: on the screen in every frame, the diamond never jumps', () => {
  const world = promptsWorld({ aspect: 390 / 844, radius: 31.3, width: 390, height: 844 });
  try {
    const { prompts, camera } = world;
    prompts.create({ label: 'Behind the scenes', position: new THREE.Vector3(0, 2.4, 0), align: 'right', onInteract() {} });
    const item = prompts.items[0];
    const diamondX = () => new THREE.Vector3().setFromMatrixPosition(item.diamond.matrixWorld).project(camera).x * 195 + 195;
    world.car.set(-1.2, 0, 0.4);
    world.run(40);
    assert.equal(prompts.activeLabel, 'Behind the scenes');
    let frames = 0, sliding = 0, flips = 0, worst = 1, jump = 0, was = item.flipped, last = diamondX();
    for (let x = -1.2; x <= 1.6; x += 0.012) {
      world.car.set(x, 0, 0.4);
      world.run(1);
      frames++;
      if (item.swap > 0 && item.swap < 1) sliding++;
      if (item.flipped !== was) { flips++; was = item.flipped; }
      worst = Math.min(worst, insideShare(world.rect(item), 390, 844));
      const now = diamondX();
      jump = Math.max(jump, Math.abs(now - last));
      last = now;
    }
    assert.ok(flips >= 1, `the label swapped sides as the car drove past (${flips})`);
    assert.ok(sliding >= 4, `and slid over ${sliding} frames, not in one`);
    assert.ok(worst >= 0.999, `on the screen in all ${frames} frames, the slide included (worst ${worst.toFixed(3)})`);
    assert.ok(jump < 60, `the diamond moved at most ${jump.toFixed(0)} px in a frame (it used to jump ~170 px)`);
  } finally { world.restore(); }
});
