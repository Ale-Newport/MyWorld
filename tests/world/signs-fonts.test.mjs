import { test } from 'node:test';
import assert from 'node:assert/strict';

// A page whose fonts finish loading when the test says so. Installed before the kit is imported: it keeps one document listener.
const loadingdone = new Set();
globalThis.document = { fonts: { addEventListener: (_name, fn) => loadingdone.add(fn), load: () => new Promise(() => {}) } };
const { SignRuntime } = await import('../../public/archipelago/preview/portfolio/world2/signs/Sign.js');
const { onSignFontsLoaded } = await import('../../public/archipelago/preview/portfolio/world2/signs/paint.js');

const fontsArrive = () => { for (const fn of [...loadingdone]) fn(); };
const ticker = () => ({ elapsed: 0, events: { on() {}, off() {} } });
const layer = () => ({ dirty: false, hold: false, live: false, paintedAt: 0, priority: 0, hz: () => 1, paint() {} });
const sign = (layers) => ({ layers, focused: false, state: { visible: true, near: true, distance: 1 }, bounds: null, animate: null });

test('fonts that arrive late repaint the signs that were painted without them', () => {
  const runtime = new SignRuntime({ ticker: ticker(), probe: s => s.state });
  const a = layer();
  runtime.add(sign([a]));
  fontsArrive();
  assert.equal(a.dirty, true);
  runtime.dispose();
});

test('a disposed runtime lets go of the document listener, so a preview that is done does not keep its canvases alive', () => {
  const runtime = new SignRuntime({ ticker: ticker(), probe: s => s.state });
  const a = layer();
  runtime.add(sign([a]));
  runtime.dispose();
  fontsArrive();
  assert.equal(a.dirty, false, 'nothing is marked after dispose');
});

test('onSignFontsLoaded is one document listener however many subscribers, and each can leave', () => {
  const before = loadingdone.size;
  const seen = [];
  const offs = [1, 2, 3].map(n => onSignFontsLoaded(() => seen.push(n)));
  assert.ok(loadingdone.size <= Math.max(before, 1), 'one listener on the document');
  fontsArrive();
  assert.deepEqual(seen.sort(), [1, 2, 3]);
  offs[1]();
  fontsArrive();
  assert.deepEqual(seen.slice(3).sort(), [1, 3]);
  offs[0](); offs[2]();
});
