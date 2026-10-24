import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerformanceObserver, constants } from 'node:perf_hooks';
import { SAFE, settlePlaques } from '../../public/archipelago/preview/portfolio/world2/interactions/Career.js';

/*
  Plain rectangles (no stone, no history): the layout around three keep-outs allocates nothing, and takes microseconds. (Its own file, a process of its own: see career-settle-alloc.test.mjs.)
*/
test('settling three plaques around three keep-outs allocates nothing either, and takes microseconds', async () => {
  const plain = (id, x0, y0, x1, y1) => ({ id, x0, y0, x1, y1, dx: 0, dy: 0 });
  const rows = [plain('a', 0, 0.42, 0.9, 0.53), plain('b', -0.13, 0.2, 0.94, 0.36), plain('c', -0.5, 0.0, 0.94, 0.17)];
  const list = [{ x0: -0.83, y0: 0.147, x1: 0.01, y1: 0.289 }, { x0: -0.2, y0: -0.2, x1: 0.2, y1: 0.2 }, { x0: 0.6, y0: -0.4, x1: 0.95, y1: 0.1 }];
  const safe = { ...SAFE, aspect: 1.9 };
  const minor = [];
  const observer = new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.detail?.kind === constants.NODE_PERFORMANCE_GC_MINOR) minor.push(e); });
  observer.observe({ entryTypes: ['gc'] });
  const settle = async () => { await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve)); };
  for (let i = 0; i < 30_000; i++) settlePlaques(rows, safe, list);
  await settle(); minor.length = 0;
  const t0 = performance.now();
  for (let i = 0; i < 200_000; i++) settlePlaques(rows, safe, list);
  const micro = ((performance.now() - t0) * 1000) / 200_000;
  await settle();
  observer.disconnect();
  assert.ok(minor.length <= 1, `${minor.length} scavenges over 200k settles`);
  assert.ok(micro < 60, `${micro.toFixed(1)} microseconds a settle`);
});
