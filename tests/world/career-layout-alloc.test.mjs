import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerformanceObserver, constants } from 'node:perf_hooks';
import * as THREE from 'three';
import { Career, Hud, SAFE } from '../../public/archipelago/preview/portfolio/world2/interactions/Career.js';

/*
  The verdicts the controller takes every frame (the askings of the layout, what the layout was asked, the latch, the arrangement a plaque is let back into) are built
  here round plain data (no scene, no page) and run by themselves, with a plaque that is trying and has no place on a canvas too small for three: none of them allocates.
  (The rest of the layout reads numbers back from `plaqueFit` and `plaqueCap`, which box them; that is as it was, and is not judged here.) Its own file, a process of
  its own: see career-settle-alloc.test.mjs.
*/
function rig(width, height) {
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
    group: new THREE.Group(), where: new THREE.Vector3(), subMin: 0.209, motion: null, game: { player: { position: new THREE.Vector3(27, 0.5, 0) } },
  });
  c.keepOuts = [c.keepPlate, c.keepCar, hud.touch, hud.speed];
  c.pins = Array.from({ length: 4 }, () => ({ x0: 2, y0: 2, x1: -2, y1: -2, hard: true, plaque: true }));
  c.keepPinned = [...c.keepOuts, ...c.pins];
  c.lines = [];
  for (let i = 0; i < 3; i++) {
    const line = {
      stop: { id: `stop-${i}` }, origin: new THREE.Vector3(25 + i * 2, 0, 0), pivot: { position: new THREE.Vector3(25 + i * 2, 3.4 + i * 0.2, -i), visible: true },
      sign: { group: new THREE.Group() }, label: {}, width: 3.4, fit: 1, shiftX: 0, shiftY: 0, lastDx: NaN, lastDy: NaN, placed: false, near: false, wants: true, crowded: true, held: 0.15,
      revivedAt: -Infinity, relocating: false, crossing: 0, latched: false, wary: false, wiped: 0, latchSig: null, reveal: 1, index: i,
    };
    c.lines.push(line);
    c.slots.push({ line, x0: 0, y0: 0, x1: 0, y1: 0, dx: 0, dy: 0, pdx: NaN, pdy: NaN, kx: 1, ky: 1, ax: 0, ay: 0, reach: 0, rank: 0, out: false, trial: false, ask: false, enter: 1, fits: false, revive: false });
  }
  const camera = new THREE.PerspectiveCamera(25, width / height, 0.1, 500);
  camera.position.set(27 + 11.2, 0.5 + 13.8, 11.2);
  camera.lookAt(27, 0.5, 0);
  camera.updateMatrixWorld(true);
  c.camera = camera;
  return c;
}

const minor = [];
const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (entry.detail?.kind === constants.NODE_PERFORMANCE_GC_MINOR) minor.push(entry); });
observer.observe({ entryTypes: ['gc'] });
const settle = async () => { await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve)); };
const run = async (step, ticks) => { await settle(); minor.length = 0; for (let i = 0; i < ticks; i++) step(i); await settle(); return minor.length; };

test('the verdicts allocate nothing: asking, asking again without the history of a plaque, asking about the plaques that are trying, letting one back, holding one silent, and noticing it may ask again', async () => {
  const c = rig(360, 640);
  for (let i = 0; i < 60; i++) c.layoutPlaques(c.camera, 1 / 30, 21);
  const trying = c.lines.find((l) => l.crowded);
  assert.ok(trying, 'one has no place on this canvas and is trying');
  assert.ok(c.shown.length >= 2);
  const safe = c.safe;
  const speaker = c.shown.find((s) => !s.trial);
  assert.ok(speaker, 'one speaks');
  const step = () => {
    speaker.out = true;
    speaker.pdx = 0.01;
    speaker.pdy = 0.01;
    c.recover(c.shown, safe);
    c.ask(c.shown, safe);
    c.solve(safe, true);
    c.pin(c.shown);
    c.solve(safe, false);
    c.unpin();
    c.admit(c.shown, safe, 1 / 30);
    c.latch(trying);
    c.changed(trying);
    c.keptAll(c.shown);
    trying.latched = false;
  };
  for (let i = 0; i < 20_000; i++) step();
  const clean = await run(step, 100_000);
  // control: the detector must see an allocating step, or "zero" proves nothing
  const control = await run((i) => { step(); new Array(256 + (i & 1)).fill(0); }, 50_000);
  observer.disconnect();
  assert.ok(control >= 3, `the allocation detector saw only ${control} scavenges for a control`);
  assert.ok(clean <= 1, `${clean} scavenges over 100k rounds of verdicts`);
});
