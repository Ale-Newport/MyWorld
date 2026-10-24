import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { Career, Hud, SAFE, settlePlaques, plaqueGap, plaquePrice } from '../../public/archipelago/preview/portfolio/world2/interactions/Career.js';

const source = fs.readFileSync(new URL('../../public/archipelago/preview/portfolio/world2/interactions/Career.js', import.meta.url), 'utf8');
const constant = (name) => Number(new RegExp(`const ${name} = ([-0-9.e]+);`).exec(source)?.[1]);
const GAP_ENTER = constant('GAP_ENTER'), REVIVE = constant('REVIVE_AFTER'), WINDOW = constant('LATCH_WINDOW'), EPS = constant('LATCH_EPS'), SLIDE = constant('SLIDE_MAX_PX'), SNAP = constant('REVIVE_SNAP');
const SETTLE_FAR = constant('SETTLE_FAR'), SETTLE_AFTER = constant('SETTLE_AFTER'), HIDDEN = constant('RELOCATE_HIDDEN'), CROSS = constant('CROSS_LENGTH'), STANDS_MIN = constant('STANDS_MIN');

/* ---- the layout as asked: the rectangles are the ones the browser measured (clip space) ---- */

const nn = (v) => (v === null || v === undefined ? NaN : v);
const rects = (slots, mod) => slots.map((s) => { const r = { id: s.id, x0: s.r[0], y0: s.r[1], x1: s.r[2], y1: s.r[3], dx: 0, dy: 0, pdx: nn(s.pd?.[0]), pdy: nn(s.pd?.[1]), ax: s.a[0], ay: s.a[1], reach: s.reach, rank: s.rank, out: false }; mod?.(r); return r; });
const by = (list, id) => list.find((r) => r.id === id);
const keeps = (list) => list.map((k) => ({ ...k }));

// A phone on its side (844x390) with the car driven down the work lane at 2 m/s: the education plaque (KCL) is speaking at the top, the projects plaque below it,
// and the work lane's stop changes: the new stop (kcl-gta) starts to look for a place. Measured in the browser, the frame the stop changes.
const SWAP = {
  safe: { x: 0.94, top: 0.641025641025641, bottom: 0.9, spacing: 0.02, aspect: 2.164102564102564 },
  keeps: [{ x0: -0.4891, y0: 0.147, x1: -0.1751, y1: 0.3956 }, { x0: -0.1575, y0: -0.389, x1: 0.1607, y1: 0.3438 }, { x0: 0.763, y0: -0.5282, x1: 0.9858, y1: 0.4461, hard: true }, { x0: -0.9834, y0: -0.9128, x1: -0.7496, y1: -0.5692, hard: true }],
  speaking: [
    { id: 'kcl', r: [-0.0907, 0.7018, 0.4014, 0.979], a: [-0.1283, 0.8404], reach: 0.52, rank: 19.5436, pd: [0, -0.3385] },
    { id: 'project-gym-app', r: [0.1689, 0.0451, 0.6553, 0.3223], a: [0.1272, 0.1837], reach: 0.52, rank: 19.3904, pd: [0, -0.266] },
  ],
  trying: { id: 'kcl-gta', r: [0.033, 0.4357, 0.5715, 0.713], a: [-0.0068, 0.5744], reach: 0.52, rank: 19.9234 },
};

/** What `keptAll` asks of the second asking against the first, on plain slots (their rectangles and where each was put): the plaques that speak are `speaking`, the one that is trying the last. */
function kept(c, speaking, trying, mod, scene = SWAP) {
  const alone = rects(speaking);
  settlePlaques(alone, scene.safe, keeps(scene.keeps));
  const all = [...rects(speaking), ...rects([trying], mod)];
  settlePlaques(all, scene.safe, keeps(scene.keeps));
  c.keepOuts = keeps(scene.keeps);
  const slots = [...speaking, trying].map((s, k) => { const r = by(all, s.id); return { trial: k === speaking.length, line: { index: k }, out: r.out, dx: r.dx, dy: r.dy, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 }; });
  speaking.forEach((s, k) => { const a = by(alone, s.id); c.answer[2 * k] = a.dx; c.answer[2 * k + 1] = a.dy; c.answerOut[k] = a.out ? 1 : 0; });
  return { all, alone, ok: c.keptAll(slots) };
}

/** The plaques that are trying, asked where they can stand among the plaques that speak, which stand where the first asking put them (what `admit` asks: the speakers are `plaque` keep-outs). */
function among(speaking, trying, scene = SWAP, mod) {
  const alone = rects(speaking);
  settlePlaques(alone, scene.safe, keeps(scene.keeps));
  const pins = alone.filter((r) => !r.out).map((r) => ({ x0: r.x0 + r.dx, y0: r.y0 + r.dy, x1: r.x1 + r.dx, y1: r.y1 + r.dy, hard: true, plaque: true }));
  const newcomers = rects(trying, mod);
  settlePlaques(newcomers, scene.safe, [...keeps(scene.keeps), ...pins]);
  return { alone, newcomers, pins };
}

test('a plaque that is trying is not let in by moving one that speaks: the layout keeps the plaque that stands where it stands, and the new stop finds room among them or none', () => {
  const c = rig();
  // asked about the way the controller does (within GAP_ENTER of the reach), the new stop has no place beside the car but the one the education plaque stands in. The layout used to
  // move that plaque 200 px sideways, onto the year plate, for it; the next frame, with the whole reach, it put it back (the kick of a lane that changes its stop)
  const asked = kept(c, SWAP.speaking, SWAP.trying, (r) => { r.reach *= GAP_ENTER; });
  const sent = Math.hypot((by(asked.all, 'kcl').dx - by(asked.alone, 'kcl').dx) * SWAP.safe.aspect, by(asked.all, 'kcl').dy - by(asked.alone, 'kcl').dy);
  assert.ok(sent < 1e-9, `the education plaque is sent ${sent.toFixed(3)} clip units, even though the new stop is in the layout`);
  assert.equal(asked.ok, true, 'the plaques that speak are as the first asking left them');
  // the plaques that speak are laid out alone: the answer to the first asking is the same with or without the plaque that is trying
  assert.ok(asked.alone.every((r) => !r.out));
  // asked among the plaques that speak (they stand where they are), the new stop has no place: it stays silent, and nobody moved
  const room = among(SWAP.speaking, [SWAP.trying], SWAP, (r) => { r.reach *= GAP_ENTER; });
  assert.ok(room.newcomers[0].out, 'there is no room for it among them');
  // the control: with no history, as for a plaque that has not stood yet, the layout makes the arrangement it likes, and the plaque is sent across
  const fresh = kept(c, SWAP.speaking.map((s) => ({ ...s, pd: undefined })), SWAP.trying, (r) => { r.reach *= GAP_ENTER; });
  const moved = Math.hypot((by(fresh.all, 'kcl').dx - by(fresh.alone, 'kcl').dx) * SWAP.safe.aspect, by(fresh.all, 'kcl').dy - by(fresh.alone, 'kcl').dy);
  assert.ok(moved > 0, `control: ${moved.toFixed(2)}`);
});

test('a plaque that is trying takes the room that is there: the one that speaks does not step down for it', () => {
  const c = rig();
  const speaking = [{ id: 'a', r: [-0.3, 0.3, 0.3, 0.45], a: [-0.35, 0.4], reach: 0.5, rank: 40, pd: [0, 0] }];
  const trying = { id: 'b', r: [-0.3, 0.38, 0.3, 0.53], a: [-0.35, 0.45], reach: 0.5, rank: 40 };
  const open = { safe: { x: 0.94, top: 0.9, bottom: 0.9, spacing: 0.02, aspect: 2 }, keeps: [] };
  const asked = kept(c, speaking, trying, undefined, open);
  assert.equal(asked.ok, true);
  assert.ok(Math.abs(by(asked.all, 'a').dy - by(asked.alone, 'a').dy) < 1e-9, 'the plaque that speaks stays');
  const room = among(speaking, [trying], open);
  const a = room.alone[0], b = room.newcomers[0];
  assert.ok(!b.out && b.y0 + b.dy >= a.y1 + a.dy + open.safe.spacing - 1e-9, 'the new one stands over it, clear by the spacing');
  // what it is not asked to do: give a plaque that speaks up for it, or put one on a place kept off
  c.keepOuts = [{ x0: -0.2, y0: 0, x1: 0.2, y1: 0.2 }];
  const slot = (index, o) => ({ trial: false, line: { index }, out: false, dx: 0, dy: 0, x0: -0.3, y0: 0.3, x1: 0.3, y1: 0.45, ...o });
  c.answer.fill(0);
  c.answerOut.fill(0);
  assert.equal(c.keptAll([slot(0, {}), slot(1, { trial: true })]), true, 'nothing moved');
  assert.equal(c.keptAll([slot(0, { out: true }), slot(1, { trial: true })]), false, 'a plaque that speaks is given up for it');
  c.answerOut[0] = 1;
  assert.equal(c.keptAll([slot(0, { out: true }), slot(1, { trial: true })]), true, 'one that was given up already is not a reason');
  c.answerOut[0] = 0;
  assert.equal(c.keptAll([slot(0, { dx: 0.5, dy: 0 })]), true, 'moved aside, clear of the place kept off');
  assert.equal(c.keptAll([slot(0, { dx: 0, dy: -0.2 })]), false, 'put on it (a hand of the plaque over it by more than a few px each way)');
  assert.equal(c.keptAll([slot(0, { dx: 0, dy: -0.105 })]), true, 'a sliver is not');
  c.answer[0] = 0; c.answer[1] = -0.2;
  assert.equal(c.keptAll([slot(0, { dx: 0, dy: -0.2 })]), true, 'one that stood on it already is not put on it by this');
});

// A phone on its side pinched in and orbited to a low rear view, the car on the projects lane: three plaques, room beside the car for two. Measured in the browser.
const CRAMPED = {
  safe: { x: 0.94, top: 0.641025641025641, bottom: 0.9, spacing: 0.02, aspect: 2.164102564102564 },
  keeps: [{ x0: 2, y0: 2, x1: -2, y1: -2 }, { x0: -0.21649, y0: -0.40993, x1: 0.21649, y1: 0.29112 }, { x0: 0.76303, y0: -0.52821, x1: 0.98578, y1: 0.44615, hard: true }, { x0: -0.98341, y0: -0.91282, x1: -0.7236, y1: -0.55385, hard: true }],
  kcl: { id: 'kcl', r: [0.6715, 0.7561, 1.1833, 1.0472], a: [0.6168, 0.9017], reach: 0.52, rank: 18.9556 },
  focus: { id: 'focus', r: [0.3458, 0.6834, 0.8361, 0.9729], a: [0.2929, 0.8282], reach: 0.52, rank: 20.1995, pd: [-0.0731, -0.643] },
  chess: { id: 'project-chess-assistant', r: [0.0434, 0.6188, 0.6542, 0.8995], a: [-0.0079, 0.7591], reach: 0.52, rank: 25.515, pd: [-0.767, -0.3076] },
};

test('a plaque that is let back stands where it was tried, and a place it stood at is not the reason to give it up', () => {
  const asked = (pd) => rects([{ ...CRAMPED.kcl, pd }, CRAMPED.focus, CRAMPED.chess]);
  // tried with no history: it finds its place, the others stay
  const tried = asked(undefined);
  settlePlaques(tried, CRAMPED.safe, keeps(CRAMPED.keeps));
  assert.ok(tried.every((r) => !r.out), 'there is a place for all three');
  const place = by(tried, 'kcl');
  // asked again as one that speaks, standing where it was tried: the same place, the same answer for everybody
  const kept = asked([place.dx, place.dy]);
  settlePlaques(kept, CRAMPED.safe, keeps(CRAMPED.keeps));
  for (const r of tried) {
    const k = by(kept, r.id);
    assert.ok(!k.out && Math.abs(k.dx - r.dx) < 1e-9 && Math.abs(k.dy - r.dy) < 1e-9, `${r.id} is where it was tried`);
  }
  // The place it had before it was given up is a candidate too: where it stands is not moved for the places the others leave it (it was given up at once, speaking, silent, speaking...)
  const stale = asked([0.01915, -0.42574]);
  settlePlaques(stale, CRAMPED.safe, keeps(CRAMPED.keeps));
  assert.ok(!by(stale, 'kcl').out, 'a stale place is not a reason to give it up');
});

// The car driven through the lanes on a phone on its side: the education plaque that the work plaque was stacked under has gone, the car's edge is a hair (0.4 mm of clip) onto the
// place the work plaque stands at, and the only place at the height it stood at is the one it stood at. Measured in the browser: it was sent 0.84 across the screen, to the far side of the car, and back ten frames later.
const LEFT = {
  safe: { x: 0.94, top: 0.641025641025641, bottom: 0.9, spacing: 0.02, aspect: 2.164102564102564 },
  keeps: [{ x0: -0.4968, y0: 0.1407, x1: -0.182, y1: 0.39 }, { x0: -0.1592, y0: -0.3876, x1: 0.1593, y1: 0.346 }, { x0: 0.763, y0: -0.5282, x1: 0.9858, y1: 0.4461, hard: true }, { x0: -0.9834, y0: -0.9128, x1: -0.7496, y1: -0.5692, hard: true }],
  slots: [
    { id: 'metaview', r: [0.0241, 0.3444, 0.5424, 0.6217], a: [-0.0152, 0.483], reach: 0.52, rank: 22.2376, pd: [0.1348, -0.4914] },
    { id: 'project-cinquillo-fair', r: [0.1586, -0.0632, 0.7036, 0.214], a: [0.1176, 0.0754], reach: 0.52, rank: 21.1221, pd: [0, -0.3702] },
  ],
};

test('a plaque stays where it stands while that is nearly clear: it does not cross the car for the places the others leave it', () => {
  const list = rects(LEFT.slots);
  settlePlaques(list, LEFT.safe, keeps(LEFT.keeps));
  assert.ok(list.every((r) => !r.out));
  assert.ok(Math.abs(by(list, 'metaview').dx - 0.1348) < 0.02 && Math.abs(by(list, 'metaview').dy + 0.4914) < 0.02, `metaview stays: (${by(list, 'metaview').dx.toFixed(3)}, ${by(list, 'metaview').dy.toFixed(3)})`);
  assert.ok(Math.abs(by(list, 'project-cinquillo-fair').dx) < 0.02, 'and so does the plaque under it');
});

test('property: asked again with its own answer as its history, a plaque is never given up and none is let out', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  let scenes = 0, flips = 0;
  for (let i = 0; i < 4000; i++) {
    const aspect = [0.46, 0.8, 1.6, 2.16][i % 4];
    const safe = { x: 0.94, top: 0.6 + rnd() * 0.3, bottom: 0.9, spacing: 0.02, aspect };
    const list = [];
    const n = 2 + Math.floor(rnd() * 2);
    for (let k = 0; k < n; k++) {
      const w = 0.3 + rnd() * 0.5, h = 0.2 + rnd() * 0.12, x0 = -0.9 + rnd() * 1.6, y0 = -0.5 + rnd() * 1.3;
      list.push({ id: k, x0, y0, x1: x0 + w, y1: y0 + h, dx: 0, dy: 0, pdx: NaN, pdy: NaN, ax: x0 - 0.05, ay: y0 + h / 2, reach: 0.3 + rnd() * 0.3, rank: plaquePrice(w * h, 0.1), out: false });
    }
    const car = { x0: -0.25 + rnd() * 0.2, y0: -0.4 + rnd() * 0.2, x1: 0.1 + rnd() * 0.3, y1: rnd() * 0.4 };
    const ks = [car, { x0: 0.76, y0: -0.5, x1: 0.99, y1: 0.45, hard: true }];
    settlePlaques(list, safe, ks);
    const first = list.map((r) => ({ id: r.id, out: r.out, dx: r.dx, dy: r.dy }));
    if (first.every((r) => r.out)) continue;
    scenes++;
    for (const r of list) { const f = first.find((q) => q.id === r.id); r.pdx = f.out ? NaN : f.dx; r.pdy = f.out ? NaN : f.dy; }
    settlePlaques(list, safe, ks);
    for (const r of list) if (r.out !== first.find((q) => q.id === r.id).out) flips++;
  }
  assert.ok(scenes > 3000, `${scenes} scenes`);
  assert.equal(flips, 0, 'a plaque that was placed is not given up by being asked again where it stands');
});

test('plaqueGap is the distance the layout limits with the reach', () => {
  const r = { x0: 0.2, y0: 0.1, x1: 0.6, y1: 0.3, dx: 0, dy: 0, ax: -0.1, ay: 0.6 };
  const aspect = 2;
  assert.ok(Math.abs(plaqueGap(r, aspect) - Math.hypot(0.3 * aspect, 0.3)) < 1e-12, 'diagonal from the nearest corner, a unit across being `aspect` times a unit up');
  assert.equal(plaqueGap({ ...r, ax: 0.3, ay: 0.2 }, aspect), 0, 'inside the plaque');
  assert.ok(Math.abs(plaqueGap({ ...r, dx: 0.1, dy: 0.2, ax: 0.4, ay: 0.6 }, aspect) - 0.1) < 1e-12, 'moved by its dx and dy');
  // the solver never puts a plaque further than its reach, and the gap says so
  const placed = [{ id: 'a', x0: 0.2, y0: 0.4, x1: 0.8, y1: 0.55, dx: 0, dy: 0, ax: 0.3, ay: 0.5, reach: 0.4, rank: 50 }];
  settlePlaques(placed, SAFE, [{ x0: 0.1, y0: 0.3, x1: 0.9, y1: 0.7 }]);
  assert.ok(placed[0].out || plaqueGap(placed[0], 1) <= 0.4 + 1e-9);
});

/* ---- the controller's own verdicts, with the real layout and a real camera (a controller built round plain data, no scene, no page) ---- */

function rig({ width = 844, height = 390, stops = 3, solve = null, car = [27, 0.5, 0] } = {}) {
  const c = Object.create(Career.prototype);
  const hud = new Hud();
  hud.measure = () => {};
  hud.width = width;
  hud.height = height;
  hud.top = 0;
  Object.assign(c, {
    slots: [], shown: [], work: [], answer: new Float64Array(64), answerOut: new Uint8Array(32), spare: new Float64Array(128), spareOut: new Uint8Array(32), asked: new Float64Array(0), clock: 0,
    hud, safe: { ...SAFE }, keepPlate: { x0: 2, y0: 2, x1: -2, y1: -2 }, keepCar: { x0: 2, y0: 2, x1: -2, y1: -2 },
    plateRect: { value: new THREE.Vector4(2, 2, -2, -2) }, carRect: { value: new THREE.Vector4(2, 2, -2, -2) },
    group: new THREE.Group(), where: new THREE.Vector3(), subMin: 0.209, motion: null, game: { player: { position: new THREE.Vector3(...car) } },
  });
  c.keepOuts = [c.keepPlate, c.keepCar, hud.touch, hud.speed];
  c.pins = Array.from({ length: 4 }, () => ({ x0: 2, y0: 2, x1: -2, y1: -2, hard: true, plaque: true }));
  Object.defineProperty(c, 'keepPinned', { get() { return [...this.keepOuts, ...this.pins]; } });
  c.lines = [];
  for (let i = 0; i < stops; i++) {
    const group = new THREE.Group();
    const line = {
      stop: { id: `stop-${i}` }, origin: new THREE.Vector3(25 + i * 2, 0, 0), pivot: { position: new THREE.Vector3(25 + i * 2, 3.4 + i * 0.2, -i), visible: false },
      sign: { group }, label: {}, width: 3.4, fit: 1, shiftX: 0, shiftY: 0, lastDx: NaN, lastDy: NaN, placed: false, near: false, wants: false, crowded: false, held: 0,
      revivedAt: -Infinity, pending: 0, pendingDx: 0, pendingDy: 0, relocating: false, crossing: 0, latched: false, wary: false, wiped: 0, latchSig: null, reveal: 0, index: i,
    };
    c.lines.push(line);
    c.slots.push({ line, x0: 0, y0: 0, x1: 0, y1: 0, dx: 0, dy: 0, pdx: NaN, pdy: NaN, kx: 1, ky: 1, ax: 0, ay: 0, reach: 0, rank: 0, out: false, trial: false, ask: false, enter: 1, fits: false, revive: false });
  }
  if (solve) c.solve = solve;
  const camera = new THREE.PerspectiveCamera(25, width / height, 0.1, 500);
  const at = new THREE.Vector3(...car);
  camera.position.set(at.x + 11.2, at.y + 13.8, at.z + 11.2);
  camera.lookAt(at);
  camera.updateMatrixWorld(true);
  c.camera = camera;
  /** One frame: the plaques that want to speak, as `update` leaves them (the first time, crowded: they have to find a place), then the layout and its verdicts. */
  c.frame = (wanting, delta = 1 / 30) => {
    for (const line of c.lines) {
      const was = line.wants;
      line.wants = wanting.includes(line.index);
      if (!line.wants) { line.crowded = false; line.held = 0; line.latched = false; line.relocating = false; line.crossing = 0; line.near = false; line.reveal = 0; line.pivot.visible = false; continue; }
      if (!was) { line.crowded = true; line.held = REVIVE; line.latched = false; line.relocating = false; line.crossing = 0; }
      line.near = !line.crowded;
      line.reveal += ((line.near && !line.relocating ? 1 : 0) - line.reveal) * Math.min(1, delta * 3);
      line.pivot.visible = line.reveal > 0.01;
    }
    c.layoutPlaques(camera, delta, 21);
  };
  return c;
}

const state = (c) => c.lines.map((l) => (l.wants ? 1 : 0) | (l.near ? 2 : 0) | (l.crowded ? 4 : 0));
/** Runs `frames` frames and returns how many times any line's (wants, near, crowded) changed in the last `window` of them. */
function changes(c, wanting, frames, window) {
  let last = null, n = 0;
  for (let i = 0; i < frames; i++) {
    c.frame(wanting);
    const now = state(c).join();
    if (i >= frames - window && last !== null && now !== last) n++;
    last = now;
  }
  return n;
}

test('the controller rig lays out and lets plaques back: three plaques on a phone on its side speak, and stand', () => {
  const c = rig();
  for (let i = 0; i < 30; i++) c.frame([0, 1, 2]);
  assert.ok(c.lines.every((l) => l.wants && !l.crowded), `all three speak: ${state(c)}`);
  assert.ok(c.lines.every((l) => Number.isFinite(l.lastDx) && Number.isFinite(l.lastDy)), 'and each stands where the layout tried it');
});

test('with the car parked and the camera still, the verdicts do not change (a canvas too small for three plaques, every phone width)', () => {
  for (const [width, height] of [[844, 390], [390, 844], [360, 640], [667, 375], [320, 568]]) {
    const c = rig({ width, height });
    assert.equal(changes(c, [0, 1, 2], 180, 90), 0, `${width}x${height}: ${state(c)}`);
    assert.ok(c.lines.every((l) => Number.isFinite(l.shiftX) && Number.isFinite(l.shiftY)));
  }
});

/** The plaques one asking is about, as `solve(safe, speakers)` takes them (the ones that speak, if `speakers`, and the ones that are trying and marked), and whether it is the first asking (no plaque that is trying is asked about). */
function asking(c, speakers) {
  const work = c.work;
  let n = 0;
  for (const slot of c.shown) if (slot.trial ? slot.ask : speakers) work[n++] = slot;
  return { n, first: speakers && !c.shown.some((slot) => slot.trial && slot.ask) };
}

/** A layout that disagrees with itself the way the old one did: asked about a plaque that speaks (the first asking) it has no place for the first stop, asked as if it were trying it has. */
const disagreeing = function (safe, speakers) {
  const { n, first } = asking(this, speakers);
  for (let i = 0; i < n; i++) { const slot = this.work[i]; slot.dx = 0; slot.dy = 0; slot.out = first && slot.line.index === 0; }
};

test('a verdict that cannot hold is held: the layout that has no place for a speaking plaque but a place for one that is trying lets it back once', () => {
  const c = rig({ solve: disagreeing });
  let revived = 0, was = false;
  for (let i = 0; i < 600; i++) {
    c.frame([0, 1]);
    const now = c.lines[0].near;
    if (now && !was) revived++;
    was = now;
  }
  assert.ok(revived <= 2, `it was let back ${revived} times in 20 s`);
  assert.equal(c.lines[0].latched, true, 'and it is held silent now');
  assert.equal(changes(c, [0, 1], 90, 90), 0, 'nothing changes while the pose does not');
  // Control: a latch that never holds (what a layout would be without it) lets it back again and again.
  const loose = rig({ solve: disagreeing });
  loose.changed = () => true;
  let again = 0;
  was = false;
  for (let i = 0; i < 600; i++) {
    loose.frame([0, 1]);
    const now = loose.lines[0].near;
    if (now && !was) again++;
    was = now;
  }
  assert.ok(again >= 10, `control: ${again} times without it`);
});

/** A layout whose first plaque has no place with a history and has one without it (what a stale history did): mode 0 and mode 1 and 2 alike. */
const historical = function (safe, speakers) {
  const { n } = asking(this, speakers);
  for (let i = 0; i < n; i++) { const slot = this.work[i]; slot.dx = 0; slot.dy = 0; slot.out = slot.line.index === 0 && slot.pdx === slot.pdx; }
};

test('a plaque that speaks is not given up for what it stood at: asked again with no history, the layout has a place for it', () => {
  const c = rig({ solve: historical });
  let given = 0, was = true;
  for (let i = 0; i < 400; i++) {
    c.frame([0, 1]);
    if (i > 5) { if (was && c.lines[0].crowded) given++; was = !c.lines[0].crowded; }
  }
  assert.equal(given, 0, 'it was never given up');
  assert.equal(c.lines[0].latched, false);
  assert.ok(c.lines[0].near && c.lines[1].near);
  // Control: without the second asking, the history is a reason to give it up, and it goes (and comes back, and goes...)
  const without = rig({ solve: historical });
  without.recover = () => {};
  let gone = 0;
  was = true;
  for (let i = 0; i < 400; i++) {
    without.frame([0, 1]);
    if (i > 5) { if (was && without.lines[0].crowded) gone++; was = !without.lines[0].crowded; }
  }
  assert.ok(gone >= 1, `control: given up ${gone} times`);
});

test('a plaque that has no place stands for a moment, and is kept inside the box meanwhile (the stone it stands beside goes on moving)', () => {
  let none = false;
  const c = rig({ solve(safe, speakers) {
    const { n, first } = asking(this, speakers);
    for (let i = 0; i < n; i++) { this.work[i].dx = 0; this.work[i].dy = 0; this.work[i].out = none && first && this.work[i].line.index === 0; }
  } });
  for (let i = 0; i < 30; i++) c.frame([0, 1]);
  const line = c.lines[0], slot = c.slots[0];
  assert.ok(line.placed && !line.crowded && line.reveal > 0.9, 'it speaks');
  none = true;
  // the stone has carried it 40 px over the edge of the box
  const over = (shift) => (slot.x1 + shift * slot.kx - c.safe.x) * 0.5 * c.hud.width;
  line.shiftX = (c.safe.x - slot.x1) / slot.kx + 40 / (0.5 * c.hud.width) / slot.kx;
  const before = over(line.shiftX);
  assert.ok(before > 30, `${before.toFixed(1)} px over the box`);
  const seen = [];
  for (let i = 0; i < 5; i++) { c.frame([0, 1]); seen.push(over(line.shiftX)); }
  assert.ok(c.slots[0].out && !line.crowded, 'it has no place and has not been given up yet');
  assert.ok(seen[0] < before - 1 && seen[0] > before - SLIDE / 30 - 1, `it came in at the speed limit: ${seen.map((v) => v.toFixed(1)).join(', ')} px over`);
  assert.ok(seen[4] <= 0.5, `and is inside the box a few frames later (${seen[4].toFixed(2)} px over)`);
});

test('a held plaque is tried again as soon as the layout is asked something else: the camera moves, the car moves, a button shows', () => {
  const c = rig({ solve: disagreeing });
  for (let i = 0; i < 120; i++) c.frame([0, 1]);
  assert.equal(c.lines[0].latched, true);
  // a hair of motion (under the epsilon) does not free it
  c.camera.position.x += 0.0005;
  c.camera.updateMatrixWorld(true);
  c.frame([0, 1]);
  assert.equal(c.lines[0].latched, true, 'a hair of motion is the same question');
  // the car moves a metre: a different question
  c.game.player.position.x += 1;
  c.camera.position.x += 1;
  c.camera.lookAt(c.game.player.position);
  c.camera.updateMatrixWorld(true);
  c.frame([0, 1]);
  assert.equal(c.lines[0].latched, false, 'the camera moved');
  // and a button that shows is a different question too
  for (let i = 0; i < 120; i++) c.frame([0, 1]);
  assert.equal(c.lines[0].latched, true);
  c.hud.touch.x0 = 0.8; c.hud.touch.x1 = 0.95; c.hud.touch.y0 = -0.5; c.hud.touch.y1 = 0.4;
  c.frame([0, 1]);
  assert.equal(c.lines[0].latched, false, 'the touch buttons showed');
  assert.ok(EPS > 0 && EPS <= 0.01, 'the epsilon is a few px of a canvas');
});

test('a plaque given up after a long time speaking is held only if it comes back and fails again within the window', () => {
  assert.ok(WINDOW >= 1 && WINDOW <= 6, 'a second or two of the layout\'s clock, which runs at twice real time');
  assert.ok(/this\.clock - line\.revivedAt < LATCH_WINDOW/.test(source) && /line\.revivedAt = this\.clock/.test(source), 'the window is measured from the moment it was let back');
});

test('the controller asks the layout about a plaque that is trying as if it spoke, and hands on the place it was tried at', () => {
  const layout = /layoutPlaques\(camera, delta, design\) \{[\s\S]*?\n    \}\n/.exec(source)?.[0] ?? '';
  assert.ok(layout.length > 800);
  assert.ok(/slot\.reach = trial \? reach \* GAP_ENTER : reach;/.test(layout) && /plaquePrice\(area, \(trial \? 0 : HIDE_KEPT\) \+ hide\)/.test(layout), 'a plaque that is trying is asked about within GAP_ENTER of the reach, at the price of one that speaks less HIDE_KEPT');
  assert.ok(/line\.lastDx = slot\.dx;\s*line\.lastDy = slot\.dy;\s*line\.pending = 0;\s*if \(line\.reveal < REVIVE_SNAP\)\s*line\.placed = false/.test(layout), 'a plaque that is let back stands where it was tried, and a stub of one is put there at once');
  assert.ok(/this\.solve\(safe, true\)/.test(layout) && /this\.admit\(shown, safe, delta\)/.test(layout), 'the plaques that speak are laid out alone, then the plaques that are trying are asked about');
  assert.ok(/this\.latch\(line\)/.test(source), 'a verdict that does not hold is held');
});

test('a plaque that is well placed slides no faster than SLIDE_MAX_PX against its stone, however far the others send it; one that is cut by the canvas, or that is on a button, is not held to it', () => {
  assert.ok(SLIDE >= 200 && SLIDE <= 500, `${SLIDE}: under the 25 px a person sees as a kick in 20 ms of real time (a frame of the game's clock is two of the screen's), with room for the size changing too`);
  assert.ok(SNAP > 0.1 && SNAP < 0.6, `${SNAP}`);
  const settled = (blockade) => {
    const c = rig();
    c.clearCar = () => {};
    for (let i = 0; i < 30; i++) c.frame([0, 1, 2]);
    const slot = c.slots[1];
    if (blockade) {
      // a keep-out stands over the plaque's place: it moves out of the way, and settles there
      Object.assign(c.hud.touch, { x0: slot.x0 - 0.1, x1: slot.x1 + 0.1, y0: slot.y0 - 0.05, y1: slot.y1 + 0.05 });
      for (let i = 0; i < 120; i++) c.frame([0, 1, 2]);
    }
    return c;
  };
  const px = (c, before) => Math.hypot((c.lines[1].shiftX - before[0]) * c.slots[1].kx * 0.5 * c.hud.width, (c.lines[1].shiftY - before[1]) * c.slots[1].ky * 0.5 * c.hud.height);
  // the keep-out goes: the plaque is sent back to its place, a long way, from a place that is clear (after the moment the layout has to go on sending it: SETTLE_AFTER)
  const c = settled(true);
  const line = c.lines[1];
  const away = Math.hypot(line.shiftX, line.shiftY);
  assert.ok(away > 0.1, `it had been moved ${away.toFixed(2)} m off`);
  Object.assign(c.hud.touch, { x0: 2, x1: -2, y0: 2, y1: -2 });
  let most = 0, frames = 0;
  for (let i = 0; i < 90; i++) {
    const before = [line.shiftX, line.shiftY];
    c.frame([0, 1, 2]);
    const moved = px(c, before);
    most = Math.max(most, moved);
    if (moved > 0.5) frames++;
  }
  assert.ok(most > 1 && most <= SLIDE * (1 / 30) + 1e-6, `a plaque that is well placed moved at most ${most.toFixed(1)} px in a frame, at most ${(SLIDE / 30).toFixed(1)}`);
  assert.ok(Math.hypot(line.shiftX, line.shiftY) < 0.02, 'and it is back beside its stone');
  assert.ok(frames >= 3, `over ${frames} frames, not in a step`);
  // cut by the canvas: the plaque stands where the canvas no longer reaches (the cap is not for it)
  const e = settled(false);
  const slot = e.slots[1], line0 = e.lines[1];
  assert.equal(e.astray(slot), false, 'a plaque that is inside the canvas is not astray');
  const right = slot.x1 + line0.shiftX * slot.kx;
  line0.shiftX += (1 + 0.005 - right) / slot.kx;
  assert.equal(e.astray(slot), false, 'a few px over the edge of the canvas is not');
  line0.shiftX += 0.1 / slot.kx;
  assert.equal(e.astray(slot), true, 'a twentieth of the screen over the edge is');
  assert.equal(e.astray(slot), true);
  const box = e.safe.x;
  e.safe.x = 0.2;
  line0.shiftX = 0;
  assert.equal(e.astray(slot), false, 'the box of the page (the top bar, the margins) is not the canvas: a plaque past the box is not cut by anything');
  e.safe.x = box;
  // on a button (the car, the plate, any place kept off) by more than STANDS_MIN each way: it is let off at once, not at the speed limit
  e.keepOuts = [{ x0: slot.x0 + 0.01, y0: slot.y0 - 1, x1: slot.x1 + 1, y1: slot.y1 + 1 }];
  line0.shiftX = 0;
  assert.equal(e.stands(slot, 0, 0, STANDS_MIN), true);
  e.keepOuts = [{ x0: slot.x1 - 0.5 * STANDS_MIN, y0: slot.y0 - 1, x1: slot.x1 + 1, y1: slot.y1 + 1 }];
  assert.equal(e.stands(slot, 0, 0, STANDS_MIN), false, 'a sliver of one is not');
  assert.ok(/!this\.astray\(slot\)/.test(source) && /!this\.stands\(slot, line\.shiftX \* slot\.kx, line\.shiftY \* slot\.ky, STANDS_MIN\)/.test(source), 'the cap is not applied to either');
});

/** A layout that answers for the plaques that speak as a script says (frame by frame), and for the ones that are trying as the first asking left them. */
const scripted = (script) => function (safe, speakers) {
  const { n } = asking(this, speakers);
  for (let i = 0; i < n; i++) {
    const slot = this.work[i];
    const [dx, dy] = slot.trial ? [0, 0] : script(this.frameNo, slot.line.index);
    slot.dx = dx; slot.dy = dy; slot.out = false;
  }
};

/** Frames of a rig whose layout says `script`; `frameNo` counts them. */
function scripted_frames(c, script, wanting, from, to, onFrame) {
  for (let i = from; i < to; i++) {
    c.frameNo = i;
    c.frame(wanting);
    onFrame?.(i);
  }
}

test('a plaque that speaks is not sent across the screen for a few frames and back: a far move waits until the layout goes on sending it there', () => {
  assert.ok(SETTLE_AFTER >= 0.15 && SETTLE_AFTER <= 0.6, `${SETTLE_AFTER} s of the game's clock`);
  const run = (flipFrames) => {
    const script = (frame, index) => [index === 1 && frame >= 30 && frame < 30 + flipFrames ? 0.5 : 0, 0];
    const c = rig({ solve: scripted(script) });
    const lastDx = [];
    scripted_frames(c, script, [1], 0, 80, () => lastDx.push(c.lines[1].lastDx));
    return { c, lastDx };
  };
  // three frames (0.1 s of the game's clock, which is 0.05 s of the screen's): a lane that changes its stop
  const brief = run(3);
  assert.ok(brief.lastDx.every((v) => Math.abs(v) < 1e-9), 'the plaque stood where it stood');
  assert.ok(Math.abs(brief.c.lines[1].shiftX) < 0.05, 'and was not moved a hair');
  // a layout that goes on sending it (twenty frames): it goes, after the moment
  const lasting = run(20);
  const first = lasting.lastDx.findIndex((v, i) => i >= 30 && Math.abs(v - 0.5) < 1e-9);
  assert.ok(first >= 30 + Math.floor(SETTLE_AFTER * 30) - 1 && first <= 30 + Math.ceil(SETTLE_AFTER * 30) + 1, `it went ${first - 30} frames after (${(SETTLE_AFTER * 30).toFixed(1)})`);
  // a move of a few px (under SETTLE_FAR on the screen, whose width is `aspect` heights) is followed at once
  const aspect = 844 / 390;
  const small = (frame, index) => [index === 1 && frame >= 30 ? (0.8 * SETTLE_FAR) / aspect : 0, 0];
  const near = rig({ solve: scripted(small) });
  scripted_frames(near, small, [1], 0, 31);
  assert.ok(Math.abs(near.lines[1].lastDx - (0.8 * SETTLE_FAR) / aspect) < 1e-9, 'a small move is followed at once');
  // and when the layout changes its mind to somewhere else meanwhile, the moment starts again
  const script = (frame, index) => [index === 1 && frame >= 30 && frame < 60 ? 0.3 * (1 + 1.5 * Math.floor((frame - 30) / 4)) : 0, 0];
  const c = rig({ solve: scripted(script) });
  let went = false;
  scripted_frames(c, script, [1], 0, 60, () => { if (Math.abs(c.lines[1].lastDx) > 0.1) went = true; });
  assert.equal(went, false, 'a target that keeps running away is not a place to go');
});

test('a plaque whose place has stopped being one goes at once: a button is on it, the box has left it, it is out of reach of its stone', () => {
  const script = (frame, index) => [index === 1 && frame >= 30 ? 0.5 : 0, 0];
  const make = () => { const c = rig({ solve: scripted(script) }); scripted_frames(c, script, [1], 0, 30); return c; };
  // control: nothing is wrong with where it stands, and it waits
  const base = make();
  scripted_frames(base, script, [1], 30, 33);
  assert.ok(Math.abs(base.lines[1].lastDx) < 1e-9, 'it waits');
  // a button on the place it stands at
  const blocked = make();
  const slot = blocked.slots[1];
  Object.assign(blocked.hud.touch, { x0: slot.x0 - 0.1, x1: slot.x1 + 0.1, y0: slot.y0 - 0.1, y1: slot.y1 + 0.1 });
  scripted_frames(blocked, script, [1], 30, 31);
  assert.ok(Math.abs(blocked.lines[1].lastDx - 0.5) < 1e-9, 'it goes at once');
  // another plaque stands where it stands (the layout made that room for it): it is not held on that one either
  const shared = rig({ solve: scripted(script) });
  scripted_frames(shared, script, [1, 2], 0, 31);
  assert.ok(Math.abs(shared.lines[1].lastDx - 0.5) < 1e-9, 'it goes at once');
  assert.ok(Math.abs(shared.lines[2].lastDx) < 1e-9, 'and the other, which was not asked to move, did not');
  // the box has left it
  const boxed = make();
  const was = boxed.safe.x;
  assert.equal(boxed.beyond(boxed.slots[1], 0, 0, boxed.safe, 2), false);
  boxed.safe.x = boxed.slots[1].x1 - 0.1;
  assert.equal(boxed.beyond(boxed.slots[1], 0, 0, boxed.safe, 2), true, 'out of the box by more than a few px');
  boxed.safe.x = was;
  // out of reach of its stone
  const s1 = boxed.slots[1];
  const keep = { ax: s1.ax, ay: s1.ay, reach: s1.reach };
  Object.assign(s1, { ax: s1.x0 - 1, ay: s1.y0, reach: 0.2 });
  assert.equal(boxed.beyond(s1, 0, 0, boxed.safe, 2), true, 'further from its stone than its reach');
  Object.assign(s1, { ax: s1.x0 - 0.1, ay: s1.y0, reach: 0.5 });
  assert.equal(boxed.beyond(s1, 0, 0, boxed.safe, 2), false);
  Object.assign(s1, keep);
});

test('a way over the car, the plate or a button is not slid: only the length of the way that is on one counts, and a plaque the car has driven onto a little goes off it at once', () => {
  const c = rig();
  // the plaque stands at the car's upper right corner; it is on the car for offsets between (-1.188, -0.838) and (-0.012, -0.012) (a sliver less than the car)
  const slot = { x0: 0.3, y0: 0.3, x1: 0.9, y1: 0.45 };
  c.keepOuts = [{ x0: -0.3, y0: -0.4, x1: 0.3, y1: 0.3 }];
  assert.equal(c.crosses(slot, 0, 0, -0.9, -0.9), true, 'diagonally across the car');
  assert.equal(c.crosses(slot, 0, -0.5, -0.8, -0.5), true, 'sideways through it');
  assert.equal(c.crosses(slot, 0, 0, 0.1, 0.1), false, 'a short way, away from it');
  assert.equal(c.crosses(slot, 0, 0, 0.6, 0), false, 'sideways, clear of it');
  assert.equal(c.crosses(slot, 0, 0.5, -0.8, 0.5), false, 'a long way over the top of it');
  // on the car already by a little (its edge has driven onto the plaque): the way off it is not a crossing
  assert.equal(c.crosses(slot, -0.03, -0.03, 0.6, 0.05), false, 'driven onto a little, and let go off it');
  // a way that clips a corner of it for less than CROSS_LENGTH is not one either
  assert.equal(c.crosses(slot, -1.3, -0.25, -1.1, -0.15), false, 'a corner of the way');
  assert.equal(c.crosses(slot, -1.3, -0.25, -0.6, 0.05), true, 'and the same way, a good deal further into it');
  assert.ok(CROSS >= 0.05 && CROSS <= 0.3, `${CROSS} clip units`);
  // any of the places kept off: the list is every one of them, unused ones (left > right) are not
  c.keepOuts = [{ x0: 2, y0: 2, x1: -2, y1: -2 }, { x0: -0.3, y0: -0.4, x1: 0.3, y1: 0.3 }];
  assert.equal(c.crosses(slot, 0, 0, -0.9, -0.9), true);
  c.keepOuts = [{ x0: 2, y0: 2, x1: -2, y1: -2 }];
  assert.equal(c.crosses(slot, 0, 0, -0.9, -0.9), false);
});

test('a plaque that is sent across the car wipes away where it stands, and wipes in at the place it is sent to: it is never slid, and never lost', () => {
  assert.ok(HIDDEN > 0.02 && HIDDEN < 0.3);
  // the car (a band) stands between the plaque and the place the layout has for it, from frame 40 on
  const script = (frame, index) => [0, index === 1 && frame >= 40 ? 0.8 : 0];
  const c = rig({ solve: scripted(script) });
  c.clearCar = () => {};
  scripted_frames(c, script, [1], 0, 39);
  const slot = c.slots[1], line = c.lines[1];
  // (the band stands on the top of the plaque's own place, so that place is no place: a plaque is not sent across the car for a better one, only off it)
  Object.assign(c.keepCar, { x0: slot.x0 - 0.2, x1: slot.x1 + 0.2, y0: slot.y1 - 0.03, y1: slot.y1 + 0.3 });
  const log = [];
  for (let i = 39; i < 140; i++) {
    c.frameNo = i;
    c.frame([1]);
    log.push({ i, reveal: line.reveal, relocating: line.relocating, shiftY: line.shiftY, near: line.near, crowded: line.crowded, lastDy: line.lastDy, placed: line.placed });
  }
  const start = log.findIndex((r) => r.relocating);
  assert.ok(start >= 0, 'it started to relocate');
  const during = log.slice(start).findIndex((r) => !r.relocating);
  assert.ok(during > 3, `${during} frames`);
  const moved = log.slice(start, start + during).map((r) => r.shiftY);
  assert.ok(moved.every((v) => Math.abs(v - moved[0]) < 1e-9), 'it wiped away where it stood, without moving');
  assert.ok(log.slice(start, start + during).every((r) => r.near && !r.crowded), 'it did not give up: it is the plaque of the stop, and has a place');
  assert.ok(log[start + during - 1].reveal >= HIDDEN, 'it was put once it was hidden');
  const after = log[start + during];
  assert.ok(after.reveal < HIDDEN && Math.abs(after.lastDy - 0.8) < 1e-9, `hidden (${after.reveal.toFixed(2)}) and the place is the layout's`);
  const there = log.slice(start + during).find((r) => r.shiftY > moved[0] + 0.5);
  assert.ok(there, 'and put at the place the layout has for it, in one step while it is hidden');
  assert.ok(log[log.length - 1].reveal > 0.95, 'and wipes in');
  // a plaque that stands somewhere that is still a place is not sent across the car for a better one, however long the layout goes on sending it
  const calm = rig({ solve: scripted(script) });
  calm.clearCar = () => {};
  scripted_frames(calm, script, [1], 0, 39);
  const quiet = calm.slots[1], still = calm.lines[1];
  Object.assign(calm.keepCar, { x0: quiet.x0 - 0.2, x1: quiet.x1 + 0.2, y0: quiet.y1 + 0.1, y1: quiet.y1 + 0.3 });
  let wiped2 = false;
  scripted_frames(calm, script, [1], 39, 400, () => { wiped2 ||= still.relocating; });
  assert.equal(wiped2, false, 'it did not wipe away');
  assert.ok(Math.abs(still.shiftY) < 0.05 && still.reveal > 0.95, 'and it stands where it stood, whole');
  // a band that is on its place for fewer frames than CROSS_AFTER is not a reason to wipe it away
  const brief = rig({ solve: scripted(script) });
  brief.clearCar = () => {};
  scripted_frames(brief, script, [1], 0, 39);
  const mine = brief.slots[1], shortly = brief.lines[1];
  let wiped3 = false;
  for (let i = 39; i < 120; i++) {
    if (i === 40) Object.assign(brief.keepCar, { x0: mine.x0 - 0.2, x1: mine.x1 + 0.2, y0: mine.y1 - 0.03, y1: mine.y1 + 0.3 });
    if (i === 41) Object.assign(brief.keepCar, { x0: 2, x1: -2, y0: 2, y1: -2 });
    brief.frameNo = i;
    brief.frame([1]);
    wiped3 ||= shortly.relocating;
  }
  assert.equal(wiped3, false, 'a frame or two of the car on it is not a reason to wipe it away');
  // the control: no band, and the plaque slides (a long way, at the speed limit) as before
  const open = rig({ solve: scripted(script) });
  open.clearCar = () => {};
  let wiped = false;
  scripted_frames(open, script, [1], 0, 100, () => { wiped ||= open.lines[1].relocating; });
  assert.equal(wiped, false, 'it never wiped away');
  assert.ok(open.lines[1].reveal > 0.99);
});

/* ---- a plaque that arrives takes the room that is there; the plaques that speak do not move for it ---- */

test('a plaque that arrives (a lane changes its stop) takes the room that is there, and the plaques that speak do not move: not a pixel, not a frame', () => {
  const c = rig();
  for (let i = 0; i < 60; i++) c.frame([0, 1]);
  const before = c.lines.slice(0, 2).map((l) => [l.lastDx, l.lastDy, l.shiftX, l.shiftY]);
  assert.ok(before.every((row) => row.every(Number.isFinite)) && c.lines[0].near && c.lines[1].near);
  let most = 0;
  for (let i = 0; i < 90; i++) {
    c.frame([0, 1, 2]);
    for (const [k, l] of c.lines.slice(0, 2).entries()) most = Math.max(most, Math.abs(l.lastDx - before[k][0]), Math.abs(l.lastDy - before[k][1]), Math.abs(l.shiftX - before[k][2]), Math.abs(l.shiftY - before[k][3]));
  }
  assert.ok(most < 1e-9, `the two that spoke moved by ${most}`);
  // the one that arrived stands somewhere (or none: the room is for two on this canvas), and where it does it is clear of the others
  const slots = c.slots.filter((s) => c.lines[s.line.index].near);
  for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
    const a = slots[i], b = slots[j];
    const lap = Math.min(a.x1 + a.dx, b.x1 + b.dx) - Math.max(a.x0 + a.dx, b.x0 + b.dx) > 0.011 && Math.min(a.y1 + a.dy, b.y1 + b.dy) - Math.max(a.y0 + a.dy, b.y0 + b.dy) > 0.011;
    assert.equal(lap, false, 'no two plaques that speak are on each other');
  }
});

test('a plaque that is let back stands where it was tried: the layout does not send it somewhere else in the frames after (the lane changed its stop, and the arrangement tipped for three frames)', () => {
  const script = (frame, index) => [index === 1 && frame >= 1 && frame < 4 ? 0.5 : 0, 0];
  const run = (hold) => {
    const c = rig({ solve: scripted(script) });
    c.clearCar = () => {};
    if (!hold) c.settle = () => {};
    const seen = [];
    for (let i = 0; i < 20; i++) { c.frameNo = i; c.frame([1]); seen.push(c.lines[1].lastDx); }
    return { c, seen };
  };
  const held = run(true);
  assert.ok(held.seen.every((v) => Math.abs(v) < 1e-9), `it stayed: ${held.seen.map((v) => v.toFixed(2)).join(' ')}`);
  assert.ok(held.c.lines[1].near && Math.abs(held.c.lines[1].shiftX) < 0.05, 'and speaks where it was let back');
  // control: with no hold it follows the three frames, a plaque that is not yet showing included
  const loose = run(false);
  assert.ok(loose.seen.some((v) => Math.abs(v - 0.5) < 1e-9), `control: ${loose.seen.map((v) => v.toFixed(2)).join(' ')}`);
});

test('a plaque that is wiping away to be put elsewhere wipes back in where it stands when the layout goes back to its place', () => {
  const band = (c, on) => {
    const slot = c.slots[1];
    if (on) Object.assign(c.keepCar, { x0: slot.x0 - 0.2, x1: slot.x1 + 0.2, y0: slot.y1 - 0.03, y1: slot.y1 + 0.3 });
    else Object.assign(c.keepCar, { x0: 2, y0: 2, x1: -2, y1: -2 });
  };
  const run = (backAt) => {
    const script = (frame, index) => [0, index === 1 && frame >= 40 && frame < backAt ? 0.8 : 0];
    const c = rig({ solve: scripted(script) });
    c.clearCar = () => {};
    scripted_frames(c, script, [1], 0, 39);
    const line = c.lines[1], shift0 = line.shiftY;
    const log = [];
    for (let i = 39; i < 120; i++) {
      if (i === 40) band(c, true);
      if (i === backAt) band(c, false);
      c.frameNo = i;
      c.frame([1]);
      log.push({ i, relocating: line.relocating, reveal: line.reveal, placed: line.placed });
    }
    return { log, line, shift0 };
  };
  // the layout goes back after 6 frames of the wipe (the plaque is still more than half shown): it never leaves
  const back = run(40 + 8);
  const started = back.log.findIndex((r) => r.relocating);
  assert.ok(started >= 0, 'it started to wipe away');
  assert.ok(back.log.slice(started + 1).some((r) => !r.relocating) && back.log.slice(started).every((r) => r.placed), 'and stopped, and was never put away');
  assert.ok(back.log[back.log.length - 1].reveal > 0.95 && Math.abs(back.line.shiftY - back.shift0) < 1e-9, 'it speaks again where it stood');
  // the layout keeps its mind: it wipes away, is put there and wipes in
  const kept = run(1000);
  assert.ok(kept.log.some((r) => r.relocating) && kept.line.shiftY > kept.shift0 + 0.5, 'control: it was put at the other place');
});

test('a plaque that was held silent is let back only after REVIVE_WARY of room, and is trusted again after WARY_RESET of speaking', () => {
  const WARY = constant('REVIVE_WARY'), RESET = constant('WARY_RESET');
  assert.ok(WARY >= 0.6 && WARY <= 2 && RESET > WINDOW, `${WARY} s and ${RESET} s of the layout's clock`);
  // room for the first plaque in the frames the schedule says
  const schedule = [[0, 200, true], [200, 220, false], [220, 240, true], [240, 260, false]];
  const roomAt = (frame) => (schedule.find(([a, b]) => frame >= a && frame < b)?.[2]) ?? true;
  const layout = function (safe, speakers) {
    const { n } = asking(this, speakers);
    for (let i = 0; i < n; i++) { const slot = this.work[i]; slot.dx = 0; slot.dy = 0; slot.out = slot.line.index === 0 && !roomAt(this.frameNo); }
  };
  const c = rig({ solve: layout });
  const line = c.lines[0];
  let revivedAt = null, latchedAt = null, waryThen = null;
  for (let i = 0; i < 600; i++) {
    c.frameNo = i;
    if (i === 260) { c.camera.position.x += 1; c.camera.lookAt(c.game.player.position); c.camera.updateMatrixWorld(true); }
    const was = line.near;
    c.frame([0, 1]);
    if (line.latched && latchedAt === null) latchedAt = i;
    if (i > 260 && line.near && !was && revivedAt === null) { revivedAt = i; waryThen = line.wary }
  }
  assert.ok(latchedAt !== null && latchedAt >= 240, `given up twice within the window: held at frame ${latchedAt}`);
  assert.ok(revivedAt !== null, 'and let back');
  const waited = (revivedAt - 260) / 30;
  assert.ok(waited >= WARY - 0.1 && waited <= WARY + 0.4, `let back ${waited.toFixed(2)} s after it was released (${WARY} s of room)`);
  assert.equal(waryThen, true, 'and wary still');
  // after WARY_RESET of speaking it is trusted again
  for (let i = 0; i < Math.ceil(RESET * 30) + 30; i++) { c.frameNo = 600 + i; c.frame([0, 1]); }
  assert.equal(line.wary, false);
});

/* ---- a plaque is not given up for want of a rearrangement ---- */

test('keeping first leaves a plaque with no room that a rearrangement has: the layout as it was before (every plaque by cost) is taken for it if the others only make way a little', () => {
  const RESCUE = constant('RESCUE_MOVE');
  assert.ok(RESCUE > 0.05 && RESCUE < 0.6, `${RESCUE}`);
  const box = { ...SAFE, top: 0.45, aspect: 2 };
  const car = { x0: -0.2, y0: -0.2, x1: 0.2, y1: 0.2 };
  // a stack of two over the car, with room for one more above it: the plaque that came last has none among those that stand, and has when they make way by a plaque's height
  const stood = (id, y0, extra) => ({ id, x0: -0.5, y0, x1: 0.5, y1: y0 + 0.1, ax: 0, ay: y0 + 0.05, reach: 0.5, rank: 40, dx: 0, dy: 0, ...extra });
  const rows = () => [stood('top', 0.34, { pdx: 0, pdy: 0 }), stood('mid', 0.21, { pdx: 0, pdy: 0 }), stood('last', 0.28, { pdx: NaN, pdy: NaN })];
  const kept = settlePlaques(rows(), box, car);
  const free = settlePlaques(rows(), box, car, undefined, false);
  assert.ok(free.every((r) => !r.out), 'the layout without keeping has room for all three');
  assert.ok(kept.some((r) => r.out) || kept.every((r) => !r.out), 'and the one with keeping, either');
  // the controller: a layout that, from frame 40 on, has no room for the first plaque when it keeps, and room for it when it does not, the other making way by `move`
  const make = (move) => {
    const c = rig({ solve(safe, speakers, keeping = true) {
      const { n } = asking(this, speakers);
      for (let i = 0; i < n; i++) { const slot = this.work[i]; slot.dx = !keeping && slot.line.index === 1 ? move : 0; slot.dy = 0; slot.out = keeping && this.frameNo >= 40 && slot.line.index === 0; }
    } });
    const seen = [];
    for (let i = 0; i < 160; i++) { c.frameNo = i; c.frame([0, 1]); if (i >= 40 && i < 50) seen.push(c.lines[1].lastDx); }
    return { c, seen };
  };
  const aspect = 844 / 390;
  const small = make((RESCUE * 0.5) / aspect);
  assert.ok(small.c.lines[0].near && !small.c.lines[0].crowded, 'a plaque that has none is let keep the one it had, the other making way a little');
  assert.ok(Math.abs(small.seen[0] - (RESCUE * 0.5) / aspect) < 1e-9, 'at once');
  // a rearrangement across the screen waits until the plaque has had no place for half as long as it takes to give it up, and is then made: the plaque is not given up for want of one
  const large = make((RESCUE * 3) / aspect);
  assert.ok(Math.abs(large.seen[0]) < 1e-9 && Math.abs(large.seen[1]) < 1e-9, 'not in the first frame');
  assert.ok(large.c.lines[0].near && !large.c.lines[0].crowded, 'but made, and the plaque speaks');
  assert.ok(Math.abs(large.c.lines[1].lastDx - (RESCUE * 3) / aspect) < 1e-9, 'the other made way as far as it had to');
});

test('the plaques are not held wary while the car has only just come within reach: the camera is still catching up and the stones are still rising, nobody has seen them stand', () => {
  const SETTLING = constant('SETTLING');
  assert.ok(SETTLING >= 1 && SETTLING <= 6, `${SETTLING} s of the layout's clock`);
  const schedule = [[0, 20, true], [20, 40, false], [40, 60, true], [60, 90, false]];
  const roomAt = (frame) => (schedule.find(([a, b]) => frame >= a && frame < b)?.[2]) ?? true;
  const layout = function (safe, speakers) {
    const { n } = asking(this, speakers);
    for (let i = 0; i < n; i++) { const slot = this.work[i]; slot.dx = 0; slot.dy = 0; slot.out = slot.line.index === 0 && !roomAt(this.frameNo); }
  };
  const run = (arrivedAt) => {
    const c = rig({ solve: layout });
    c.arrivedAt = arrivedAt;
    for (let i = 0; i < 90; i++) { c.frameNo = i; c.frame([0, 1]); }
    return c;
  };
  const arriving = run(0);
  assert.equal(arriving.lines[0].latched, true, 'a verdict that does not hold is held all the same');
  assert.equal(arriving.lines[0].wary, false, 'but the plaque is not wary: it is let back as soon as there is room');
  const settled = run(-Infinity);
  assert.equal(settled.lines[0].wary, true, 'control: once the car has been there a while it is');
});
