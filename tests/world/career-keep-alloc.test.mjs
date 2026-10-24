import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerformanceObserver, constants } from 'node:perf_hooks';
import { SAFE, settlePlaques } from '../../public/archipelago/preview/portfolio/world2/interactions/Career.js';

/*
  The same for a pass in which the plaques have a history: each stands where the last pass put it, so the pass keeps it there and then looks for a better place for it among the others.
  (Its own file, a process of its own: see career-settle-alloc.test.mjs.)
*/
test('and so does a pass in which every plaque stands where the last one put it (keeping, then looking for a better place), and one in which they are moved by what is asked of them', async () => {
  // the controller's own shape, with a history: each plaque is asked again with its answer as its history, and a second scene in which the car moves across the plaques each frame
  const history = (id, x0, y0, x1, y1, ax, ay, reach, rank) => ({ id, x0, y0, x1, y1, dx: 0, dy: 0, pdx: 0, pdy: 0, ax, ay, reach, rank, out: false });
  const rows = [history('a', 0, 0.42, 0.9, 0.53, -0.05, 0.47, 0.5, 40), history('b', -0.13, 0.2, 0.94, 0.36, -0.2, 0.28, 0.5, 30), history('c', -0.5, 0.0, 0.94, 0.17, 0.8, 0.1, 0.5, 20)];
  const car = { x0: -0.4, y0: -0.3, x1: 0.4, y1: 0.3 };
  const keeps = [{ x0: -0.83, y0: 0.147, x1: 0.01, y1: 0.289 }, car, { x0: 0.6, y0: -0.4, x1: 0.95, y1: 0.1, hard: true }];
  const safe = { ...SAFE, aspect: 1.9 };
  const minor = [];
  const observer = new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.detail?.kind === constants.NODE_PERFORMANCE_GC_MINOR) minor.push(e); });
  observer.observe({ entryTypes: ['gc'] });
  const settle = async () => { await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve)); };
  const frame = (i) => {
    // the car sweeps to and fro across the scene, so plaques are kept, moved off it, and sent back
    const sweep = 0.9 * Math.sin(i * 0.01);
    car.x0 = -0.4 + sweep; car.x1 = 0.4 + sweep;
    settlePlaques(rows, safe, keeps);
    for (const r of rows) { r.pdx = r.out ? NaN : r.dx; r.pdy = r.out ? NaN : r.dy; }
  };
  for (let i = 0; i < 30_000; i++) frame(i);
  await settle(); minor.length = 0;
  for (let i = 0; i < 300_000; i++) frame(i);
  await settle();
  observer.disconnect();
  assert.ok(minor.length <= 1, `${minor.length} scavenges over 300k settles with a history`);
});
