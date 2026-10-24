import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerformanceObserver, constants } from 'node:perf_hooks';
import { SAFE, settlePlaques } from '../../public/archipelago/preview/portfolio/world2/interactions/Career.js';

/*
  The layout runs every frame, and in the controller every plaque it is given is the same shape (a stone's anchor, a reach and a price
  on each). A call is allocation-free for rectangles of that shape. (It is its own file, a process of its own: a pass that is also given
  rectangles without those fields has seen two shapes, and boxes the numbers it reads from them, which is no pass of the controller's.)
*/
const stoned = (id, x0, y0, x1, y1, ax, ay, reach, rank) => ({ id, x0, y0, x1, y1, dx: 0, dy: 0, pdx: NaN, pdy: NaN, ax, ay, reach, rank, out: false });
const CAR = { x0: -0.4, y0: -0.3, x1: 0.4, y1: 0.3 };

test('settling plaques with a reach and a price allocates nothing (a pass runs every frame)', async () => {
  const rows = [stoned('a', 0, 0.42, 0.9, 0.53, -0.05, 0.47, 0.5, 40), stoned('b', -0.13, 0.2, 0.94, 0.36, -0.2, 0.28, 0.5, 30), stoned('c', -0.5, 0.0, 0.94, 0.17, 0.8, 0.1, 0.5, 20)];
  const plate = { x0: -0.83, y0: 0.147, x1: 0.01, y1: 0.289 };
  const keeps = [plate, CAR];
  const minor = [];
  const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (entry.detail?.kind === constants.NODE_PERFORMANCE_GC_MINOR) minor.push(entry); });
  observer.observe({ entryTypes: ['gc'] });
  const settle = async () => { await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve)); };
  const run = async (step, ticks = 300_000) => { await settle(); minor.length = 0; for (let i = 0; i < ticks; i++) step(i); await settle(); return minor.length; };
  for (let i = 0; i < 30_000; i++) settlePlaques(rows, SAFE, keeps);
  const clean = await run(() => settlePlaques(rows, SAFE, keeps));
  // control: the detector must see an allocating step, or "zero" proves nothing
  const control = await run((i) => { settlePlaques(rows, SAFE, keeps); new Array(256 + (i & 1)).fill(0); }, 100_000);
  observer.disconnect();
  assert.ok(control >= 5, `the allocation detector saw only ${control} scavenges for a ~200 MB control`);
  assert.ok(clean <= 1, `${clean} scavenges over 300k settles`);
});

test('and one that gives plaques up allocates nothing either', async () => {
  // the car fills the box and the stones are under it: all three have no place within reach, each pass
  const car = { x0: -0.94, y0: -0.9, x1: 0.94, y1: 0.8 };
  const rows = [stoned('a', 0, 0.0, 0.9, 0.1, 0, 0.05, 0.2, 10), stoned('b', -0.3, -0.1, 0.6, 0.0, -0.2, -0.05, 0.2, 10), stoned('c', -0.5, -0.2, 0.4, -0.1, 0.3, -0.15, 0.2, 10)];
  const keeps = [car];
  const minor = [];
  const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (entry.detail?.kind === constants.NODE_PERFORMANCE_GC_MINOR) minor.push(entry); });
  observer.observe({ entryTypes: ['gc'] });
  const settle = async () => { await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve)); };
  for (let i = 0; i < 30_000; i++) settlePlaques(rows, SAFE, keeps);
  await settle(); minor.length = 0;
  for (let i = 0; i < 300_000; i++) settlePlaques(rows, SAFE, keeps);
  await settle();
  observer.disconnect();
  assert.ok(rows.every((r) => r.out === true), 'all three are given up');
  assert.ok(minor.length <= 1, `${minor.length} scavenges over 300k settles`);
});
