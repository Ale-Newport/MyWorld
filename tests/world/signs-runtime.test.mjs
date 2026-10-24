import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SignRuntime } from '../../public/archipelago/preview/portfolio/world2/signs/Sign.js';
import { STATIC_TIME } from '../../public/archipelago/preview/portfolio/world2/signs/emblems.js';

/** A ticker that only moves when a test says so. */
function fakeTicker() {
  const listeners = new Set();
  return {
    elapsed: 0,
    events: { on: (_n, fn) => listeners.add(fn), off: (_n, fn) => listeners.delete(fn) },
    listeners,
    advance(seconds) { this.elapsed += seconds; for (const fn of [...listeners]) fn(); },
  };
}
function fakeLayer(options = {}) {
  const layer = {
    dirty: true, hold: false, live: false, paintedAt: -Infinity, priority: 0, times: [],
    hz: (tier, focused) => ({ high: 10, medium: 8, low: 5 }[tier] * (focused ? 1.5 : 1)),
    paint(time, at = time) { this.times.push(time); this.dirty = false; this.paintedAt = at; },
    ...options,
  };
  return layer;
}
const fakeSign = (layers, state = { visible: true, near: true, distance: 10 }) => ({ layers, focused: false, state: { ...state }, bounds: null, animate: null });
function setup(env = {}) {
  const ticker = fakeTicker();
  const states = new Map();
  const runtime = new SignRuntime({
    ticker, quality: () => 'high', reduced: () => false, hidden: () => false,
    probe: sign => states.get(sign) ?? sign.state, ...env,
  });
  return { ticker, runtime, states };
}
const run = (ticker, seconds, step = 1 / 60) => { for (let t = 0; t < seconds - 1e-9; t += step) ticker.advance(step); };

test('the runtime owns exactly one tick listener and removes it on dispose', () => {
  const { ticker, runtime } = setup();
  assert.equal(ticker.listeners.size, 1);
  runtime.dispose();
  assert.equal(ticker.listeners.size, 0);
});

test('a sign out of sight is warmed once, one layer a tick, as its still frame, and then left alone', () => {
  const { ticker, runtime, states } = setup();
  const face = fakeLayer(), emblem = fakeLayer({ live: true }), plate = fakeLayer();
  const sign = fakeSign([face, emblem, plate]);
  runtime.add(sign);
  states.set(sign, { visible: false, near: false, distance: 90 });
  let last = 0;
  for (let i = 0; i < 5; i++) {
    ticker.advance(1 / 60);
    const total = face.times.length + emblem.times.length + plate.times.length;
    assert.ok(total - last <= 1, `tick ${i} painted ${total - last}`);
    last = total;
  }
  run(ticker, 3);
  assert.deepEqual([face.times.length, emblem.times.length, plate.times.length], [1, 1, 1], 'each layer painted exactly once');
  assert.equal(emblem.times[0], STATIC_TIME, 'the picture waits as its designated still frame, not a random moment');
  assert.equal(runtime.stats.warm, 3);
  assert.equal(runtime.stats.catchUps, 0);
  // Near but not in the frustum: still no timer, and nothing more to paint.
  states.set(sign, { visible: false, near: true, distance: 20 });
  run(ticker, 1);
  assert.equal(runtime.stats.paints, 3);
  // Content that changes while nobody looks is brought up to date behind the scenes, once.
  face.dirty = true;
  run(ticker, 0.2);
  assert.equal(face.times.length, 2);
  assert.equal(runtime.stats.paints, 4);
});

test('warming goes nearest first and never before something in sight', () => {
  const { ticker, runtime, states } = setup();
  const far = fakeLayer(), near = fakeLayer(), seen = fakeLayer({ paintedAt: 0 });
  const farSign = fakeSign([far]), nearSign = fakeSign([near]), seenSign = fakeSign([seen]);
  for (const s of [farSign, nearSign, seenSign]) runtime.add(s);
  states.set(farSign, { visible: false, near: false, distance: 200 });
  states.set(nearSign, { visible: false, near: true, distance: 30 });
  states.set(seenSign, { visible: true, near: true, distance: 10 });
  ticker.advance(1 / 60);
  assert.equal(seen.times.length, 1, 'what is in sight goes first');
  ticker.advance(1 / 60);
  assert.equal(near.times.length, 1, 'then the nearest out of sight');
  assert.equal(far.times.length, 0);
  ticker.advance(1 / 60);
  assert.equal(far.times.length, 1);
});

test('a static layer paints once when its sign is seen, and again only after invalidation', () => {
  const { ticker, runtime, states } = setup();
  const face = fakeLayer();
  const sign = fakeSign([face]);
  runtime.add(sign);
  states.set(sign, { visible: true, near: false, distance: 60 });
  run(ticker, 2);
  assert.equal(face.times.length, 1, 'painted once');
  face.dirty = true;
  run(ticker, 0.1);
  assert.equal(face.times.length, 2);
});

test('a live layer repaints at the tier rate while near and visible, and stops when it is not', () => {
  const { ticker, runtime, states } = setup();
  const emblem = fakeLayer({ live: true });
  const sign = fakeSign([emblem]);
  runtime.add(sign);
  run(ticker, 2);
  assert.ok(emblem.times.length >= 19 && emblem.times.length <= 21, `~10 Hz for 2 s, got ${emblem.times.length}`);
  states.set(sign, { visible: true, near: false, distance: 80 });
  run(ticker, 0.3); // visibility is re-probed five times a second
  const before = emblem.times.length;
  run(ticker, 2);
  assert.equal(emblem.times.length, before, 'far: static, no timer');
  states.set(sign, { visible: false, near: true, distance: 10 });
  run(ticker, 0.3);
  const offscreen = emblem.times.length;
  run(ticker, 2);
  assert.equal(emblem.times.length, offscreen, 'off screen: no timer');
});

test('the rate follows body.dataset.quality and focus raises it', () => {
  for (const [tier, hz] of [['high', 10], ['medium', 8], ['low', 5]]) {
    const { ticker, runtime } = setup({ quality: () => tier });
    const emblem = fakeLayer({ live: true });
    runtime.add(fakeSign([emblem]));
    run(ticker, 4);
    assert.ok(Math.abs(emblem.times.length / 4 - hz) < 0.8, `${tier}: ${emblem.times.length / 4} Hz`);
  }
  const { ticker, runtime } = setup();
  const emblem = fakeLayer({ live: true });
  const sign = fakeSign([emblem]);
  runtime.add(sign);
  runtime.focus(sign);
  run(ticker, 4);
  assert.ok(emblem.times.length / 4 > 13 && emblem.times.length / 4 < 16, `focused ${emblem.times.length / 4} Hz`);
});

test('never more than one layer is painted per tick, however many signs and layers are due', () => {
  const { ticker, runtime } = setup({ catchUpMs: 0 });
  const layers = [];
  for (let s = 0; s < 4; s++) {
    const faces = [fakeLayer(), fakeLayer(), fakeLayer({ live: true })];
    layers.push(...faces);
    runtime.add(fakeSign(faces));
  }
  let last = 0;
  for (let i = 0; i < 90; i++) {
    ticker.advance(1 / 60);
    const total = layers.reduce((n, l) => n + l.times.length, 0);
    assert.ok(total - last <= 1, `tick ${i} painted ${total - last}`);
    last = total;
  }
  assert.ok(layers.every(l => l.times.length >= 1), 'every layer got its turn');
});

test('dirty static layers go before live repaints, focused signs before the rest, and held layers wait', () => {
  const { ticker, runtime } = setup();
  const emblem = fakeLayer({ live: true, dirty: false, paintedAt: -100 });
  const face = fakeLayer();
  runtime.add(fakeSign([emblem, face]));
  ticker.advance(1 / 60);
  assert.equal(face.times.length, 1, 'the content change wins over a timer repaint');
  assert.equal(emblem.times.length, 0);
  ticker.advance(1 / 60);
  assert.equal(emblem.times.length, 1);

  const a = fakeLayer({ priority: 0, paintedAt: 0 }), b = fakeLayer({ priority: 0, paintedAt: 0 });
  const sa = fakeSign([a]), sb = fakeSign([b]);
  const rt = setup();
  rt.runtime.add(sa); rt.runtime.add(sb); rt.runtime.focus(sb);
  rt.ticker.advance(1 / 60);
  assert.equal(b.times.length, 1, 'the focused sign paints first');
  assert.equal(a.times.length, 0);

  const held = fakeLayer({ hold: true });
  const rt2 = setup();
  rt2.runtime.add(fakeSign([held]));
  run(rt2.ticker, 1);
  assert.equal(held.times.length, 0, 'a layer on hold is skipped');
  held.hold = false;
  run(rt2.ticker, 0.1);
  assert.equal(held.times.length, 1);
});

test('higher priority paints first among dirty layers', () => {
  const { ticker, runtime } = setup();
  const low = fakeLayer({ priority: 1, paintedAt: 0 }), high = fakeLayer({ priority: 10, paintedAt: 0 });
  runtime.add(fakeSign([low, high]));
  ticker.advance(1 / 60);
  assert.equal(high.times.length, 1);
  assert.equal(low.times.length, 0);
});

test('reduced motion: one still frame per layer, no timer, no transform animation', () => {
  const { ticker, runtime } = setup({ reduced: () => true });
  const emblem = fakeLayer({ live: true });
  let animated = 0;
  const sign = fakeSign([emblem]);
  sign.animate = () => { animated++; };
  runtime.add(sign);
  run(ticker, 3);
  assert.equal(emblem.times.length, 1);
  assert.equal(emblem.times[0], STATIC_TIME, 'the still frame is the designated one');
  assert.equal(animated, 0);
});

test('a hidden tab does nothing at all', () => {
  let hidden = true;
  const { ticker, runtime } = setup({ hidden: () => hidden });
  const emblem = fakeLayer({ live: true });
  runtime.add(fakeSign([emblem]));
  run(ticker, 2);
  assert.equal(emblem.times.length, 0);
  hidden = false;
  run(ticker, 0.2);
  assert.ok(emblem.times.length >= 1);
});

test('transform animation runs only while near and visible, or focused', () => {
  const { ticker, runtime, states } = setup();
  let animated = 0;
  const sign = fakeSign([]);
  sign.animate = () => { animated++; };
  runtime.add(sign);
  run(ticker, 0.5);
  const near = animated;
  assert.ok(near > 20);
  states.set(sign, { visible: true, near: false, distance: 90 });
  run(ticker, 0.3); // the runtime re-probes five times a second
  const settled = animated;
  run(ticker, 0.5);
  assert.equal(animated, settled);
  runtime.focus(sign);
  run(ticker, 0.5);
  assert.ok(animated > settled);
});

test('removing a sign stops its layers from being scheduled', () => {
  const { ticker, runtime } = setup();
  const emblem = fakeLayer({ live: true });
  const sign = fakeSign([emblem]);
  runtime.add(sign);
  run(ticker, 0.5);
  const n = emblem.times.length;
  runtime.remove(sign);
  run(ticker, 0.5);
  assert.equal(emblem.times.length, n);
});

/* ---- the first time a sign is seen ---- */

test('a layer that was never painted is painted the moment its sign is in sight, all of them, in one tick', () => {
  const { ticker, runtime } = setup();
  const layers = [fakeLayer(), fakeLayer(), fakeLayer({ live: true }), fakeLayer()];
  const held = fakeLayer({ hold: true });
  runtime.add(fakeSign([...layers, held]));
  ticker.advance(1 / 60);
  assert.ok(layers.every(l => l.times.length === 1), 'no layer in sight is left unpainted');
  assert.equal(held.times.length, 0, 'a layer waiting for its content is not painted');
  assert.equal(runtime.stats.catchUps, 4);
  run(ticker, 0.1);
  assert.ok(layers.filter(l => !l.live).every(l => l.times.length === 1), 'and the catch-up does not repeat');
});

test('the catch-up has a time budget and always makes progress', () => {
  const { ticker, runtime } = setup({ catchUpMs: 0 });
  const layers = Array.from({ length: 6 }, () => fakeLayer());
  runtime.add(fakeSign(layers));
  ticker.advance(1 / 60);
  assert.equal(layers.filter(l => l.times.length).length, 1, 'one layer per tick under a zero budget');
  run(ticker, 0.2);
  assert.ok(layers.every(l => l.times.length >= 1), 'and the rest follow');
});

test('the focused sign is caught up before the others', () => {
  const { ticker, runtime } = setup({ catchUpMs: 0 });
  const a = fakeLayer(), b = fakeLayer();
  const sa = fakeSign([a]), sb = fakeSign([b]);
  runtime.add(sa); runtime.add(sb); runtime.focus(sb);
  ticker.advance(1 / 60);
  assert.equal(b.times.length, 1);
  assert.equal(a.times.length, 0);
});

/** A sign with a real bound in a real frustum, so the camera tests exercise the runtime's own visibility test. */
function sceneSign(layers, at) {
  const object = new THREE.Group();
  object.position.set(...at);
  object.updateMatrixWorld(true);
  const sign = fakeSign(layers);
  sign.bounds = { object, centre: new THREE.Vector3(), radius: 2.5 };
  sign.state.visible = false; sign.state.near = false; sign.state.distance = Infinity;
  return sign;
}
function camera(position, look) {
  const c = new THREE.PerspectiveCamera(25, 16 / 9, 0.5, 400);
  c.position.set(...position);
  c.lookAt(...look);
  c.updateMatrixWorld(true);
  return c;
}

test('a camera jump onto a sign that was never painted shows it painted on the very next tick, without waiting for the probe timer', () => {
  const view = camera([-110, 20, 0], [-120, 15, 0]);
  const { ticker, runtime } = setup({ probe: undefined, camera: () => view });
  const layers = Array.from({ length: 9 }, () => fakeLayer());
  const sign = sceneSign(layers, [60, 2, 0]);
  runtime.add(sign);
  ticker.advance(1 / 60);
  assert.equal(sign.state.visible, false, 'behind the camera and far away');
  assert.equal(layers.filter(l => l.times.length).length, 1, 'one layer warmed this tick');
  // 30 ms later (well inside the 200 ms probe timer) the camera is somewhere else, looking at the sign.
  view.position.set(80, 12, 18);
  view.lookAt(60, 2, 0);
  view.updateMatrixWorld(true);
  ticker.advance(0.03);
  assert.equal(sign.state.visible, true, 'the jump forced a probe');
  assert.ok(layers.every(l => l.times.length >= 1), `every layer is painted on the first tick it is in sight (${layers.map(l => l.times.length)})`);
  assert.equal(runtime.stats.probes, 2);
});

test('a camera that has not moved is not probed again before the timer, a turned one is', () => {
  const view = camera([0, 20, 40], [0, 0, 0]);
  const { ticker, runtime } = setup({ probe: undefined, camera: () => view });
  runtime.add(sceneSign([fakeLayer()], [0, 0, 0]));
  ticker.advance(1 / 60);
  const probes = runtime.stats.probes;
  run(ticker, 0.15);
  assert.equal(runtime.stats.probes, probes, 'nothing moved: the timer decides');
  view.position.x += 1; view.updateMatrixWorld(true);
  run(ticker, 0.05);
  assert.equal(runtime.stats.probes, probes, 'a metre is not a jump');
  view.lookAt(40, 0, 40); view.updateMatrixWorld(true);
  ticker.advance(1 / 60);
  assert.equal(runtime.stats.probes, probes + 1, 'swinging the view about is');
});

test('probeNow asks for a fresh visibility test on the next tick', () => {
  const { ticker, runtime } = setup();
  runtime.add(fakeSign([fakeLayer()]));
  ticker.advance(1 / 60);
  const before = runtime.stats.probes;
  runtime.probeNow();
  ticker.advance(1 / 60);
  assert.equal(runtime.stats.probes, before + 1);
});

/* ---- a tick with nothing to do ---- */

test('a layer added to a sign that is already registered is caught up the moment it is in sight, and not before it is asked for', () => {
  const { ticker, runtime } = setup();
  const painted = fakeLayer();
  const sign = fakeSign([painted]);
  runtime.add(sign);
  run(ticker, 0.5);
  assert.equal(painted.times.length, 1);
  assert.equal(runtime.stats.catchUps, 1, 'the first layer was caught up');
  // Everything has been painted once: the catch-up has nothing left to do, so a layer slipped in without a word is painted
  // by the ordinary schedule, one a tick.
  const quiet = [fakeLayer(), fakeLayer(), fakeLayer()];
  sign.layers.push(...quiet);
  ticker.advance(1 / 60);
  assert.equal(quiet.filter(l => l.times.length).length, 1, 'one layer this tick');
  run(ticker, 0.2);
  assert.ok(quiet.every(l => l.times.length === 1), 'and the rest follow');
  // Sign.addLayer says so (wake), and then all of them are painted in sight in the very next tick.
  const loud = [fakeLayer(), fakeLayer(), fakeLayer()];
  sign.layers.push(...loud);
  runtime.wake();
  ticker.advance(1 / 60);
  assert.ok(loud.every(l => l.times.length === 1), 'woken: every new layer is painted at once');
  assert.equal(runtime.stats.catchUps, 4);
});

test('two runtimes that watch one camera both see it jump, and agree on when it has not', () => {
  const view = camera([0, 20, 40], [0, 0, 0]);
  const ticker = fakeTicker();
  const make = () => new SignRuntime({ ticker, quality: () => 'high', reduced: () => false, hidden: () => false, camera: () => view });
  const a = make(), b = make();
  for (const runtime of [a, b]) runtime.add(sceneSign([fakeLayer()], [0, 0, 0]));
  ticker.advance(1 / 60);
  const probes = [a.stats.probes, b.stats.probes];
  for (let i = 0; i < 6; i++) ticker.advance(1 / 60);
  assert.deepEqual([a.stats.probes, b.stats.probes], probes, 'nothing moved, so neither probes before its timer');
  view.position.set(60, 8, -30); view.lookAt(0, 0, 0); view.updateMatrixWorld(true);
  ticker.advance(1 / 60);
  assert.deepEqual([a.stats.probes, b.stats.probes], [probes[0] + 1, probes[1] + 1], 'one jump, one probe each, in the tick it happened');
  ticker.advance(1 / 60);
  assert.deepEqual([a.stats.probes, b.stats.probes], [probes[0] + 1, probes[1] + 1], 'and not again');
  a.dispose(); b.dispose();
});

test('a runtime that is told nothing is a sleeping one: a tick with every layer painted and nothing due changes nothing', () => {
  const { ticker, runtime } = setup();
  const layers = [fakeLayer(), fakeLayer({ live: true })];
  const sign = fakeSign(layers, { visible: false, near: false, distance: 90 });
  runtime.add(sign);
  run(ticker, 1);
  const paints = runtime.stats.paints, catchUps = runtime.stats.catchUps;
  run(ticker, 2);
  assert.equal(runtime.stats.paints, paints, 'no paint');
  assert.equal(runtime.stats.catchUps, catchUps);
});
