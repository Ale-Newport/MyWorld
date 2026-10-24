import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

/** A 2D context that records nothing and accepts everything, with text measured at half an em per glyph. */
function fakeContext(canvas) {
  const state = { font: '10px sans-serif' };
  const gradient = { addColorStop() {} };
  return new Proxy(state, {
    get(target, key) {
      if (key === 'canvas') return canvas;
      if (key === 'measureText') return (text) => ({ width: String(text).length * Number(/(\d+(?:\.\d+)?)px/.exec(target.font)?.[1] ?? 10) * 0.5 });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
      if (key in target) return target[key];
      return () => undefined;
    },
    set(target, key, value) { target[key] = value; return true; },
  });
}
globalThis.document = {
  createElement() {
    const canvas = { width: 1, height: 1 };
    const context = fakeContext(canvas);
    canvas.getContext = () => context;
    return canvas;
  },
  hidden: false,
  body: { dataset: {} },
};

const { Sign, SignLayer, SignRuntime } = await import('../../public/archipelago/preview/portfolio/world2/signs/Sign.js');
const { signMaterials } = await import('../../public/archipelago/preview/portfolio/world2/signs/materials.js');
const { triangleCount } = await import('../../public/archipelago/preview/portfolio/world2/signs/geometry.js');

const meshes = (sign) => { const found = []; sign.group.traverse(o => { if (o.isMesh) found.push(o); }); return found; };
const triangles = (sign) => meshes(sign).reduce((n, m) => n + triangleCount(m.geometry), 0);

test('the three built variants stay inside their draw-call and triangle budgets', () => {
  const materials = signMaterials();
  const board = new Sign({ id: 'b', variant: 'board', width: 2.6, height: 1.45, title: 'Chess Assistant', subtitle: 'Reads a board.', kicker: 'AI / ML · 2025', theme: 'chess', materials });
  const plank = new Sign({ id: 'p', variant: 'plank', width: 1.5, height: 0.5, title: 'GitHub', hang: 'rope', materials });
  const label = new Sign({ id: 'l', variant: 'label', width: 2.6, height: 0.7, title: 'Engineer', subtitle: 'Newport Media', materials });
  assert.equal(meshes(board).length, 3, 'board: wood + face + emblem');
  assert.equal(meshes(plank).length, 2, 'plank: wood + face');
  assert.equal(meshes(label).length, 1, 'label: one mesh');
  assert.ok(triangles(board) < 1500, `board ${triangles(board)} triangles`);
  assert.ok(triangles(plank) < 400, `plank ${triangles(plank)} triangles`);
  assert.ok(triangles(label) <= 50, `label ${triangles(label)} triangles`);
  for (const sign of [board, plank, label]) assert.equal(sign.group.userData.signMount, 'fixed', 'physical signs are never billboarded');
  assert.equal(board.layers.filter(l => l.live).length, 1, 'only the emblem is live');
  assert.equal(plank.layers.filter(l => l.live).length, 0);
  assert.equal(new Sign({ id: 'b2', variant: 'board', width: 2, height: 1, title: 'x', emblem: null, materials }).layers.length, 1, 'emblem: null leaves a single static layer');
});

test('board hardware samples the shared wood material and faces use the lit face material', () => {
  const materials = signMaterials();
  const board = new Sign({ id: 'b', variant: 'board', width: 2.6, height: 1.45, title: 'T', materials });
  assert.equal(board.hardware.material, materials.wood);
  assert.ok(board.face.material.map && board.face.material.emissiveMap === board.face.material.map);
  assert.ok(board.face.material.emissiveIntensity > 0.3 && board.face.material.side === THREE.DoubleSide);
});

test('a label reads from +Z: its front facet spans the whole canvas, everything else samples the dark border', () => {
  const label = new Sign({ id: 'l', variant: 'label', width: 2, height: 0.5, title: 'Stop', materials: signMaterials() });
  const g = label.face.geometry;
  const p = g.getAttribute('position'), n = g.getAttribute('normal'), uv = g.getAttribute('uv');
  let front = 0;
  for (let i = 0; i < p.count; i++) {
    if (n.getZ(i) > 0.99) {
      front++;
      assert.ok(p.getZ(i) > 0, 'the front facet is on the +Z side');
      assert.ok(uv.getX(i) >= -1e-6 && uv.getX(i) <= 1 + 1e-6 && uv.getY(i) >= -1e-6 && uv.getY(i) <= 1 + 1e-6, 'front uv inside the canvas');
    } else assert.ok(Math.abs(uv.getX(i) - 0.003) < 1e-6, 'sides sample the canvas border');
  }
  assert.equal(front, 6, 'two triangles for the front facet... plus none elsewhere facing +Z');
});

test('every default layout paints without throwing, and a custom painter replaces it', () => {
  const materials = signMaterials();
  const signs = [
    new Sign({ id: 'b', variant: 'board', width: 2.6, height: 1.45, title: 'A very long title that will need to wrap over a couple of lines', subtitle: 'x '.repeat(200), kicker: 'Kicker', materials }),
    new Sign({ id: 'p1', variant: 'plank', width: 1.5, height: 0.5, title: 'GitHub', subtitle: '@alejandro', materials }),
    new Sign({ id: 'p2', variant: 'plank', width: 1.1, height: 0.8, title: 'Visited', value: 42, accent: '#5390ff', materials }),
    new Sign({ id: 'l', variant: 'label', width: 2.6, height: 0.7, title: 'Engineer', subtitle: 'Newport Media', materials }),
  ];
  for (const sign of signs) { sign.paintNow(); assert.ok(sign.layers.every(l => l.paints === 1 && !l.dirty), `${sign.id} painted every layer once`); }
  let called = 0;
  signs[1].paint(() => { called++; });
  signs[1].paintNow();
  assert.equal(called, 1);
  signs[1].setText({ title: 'Other' });
  assert.equal(signs[1].main.dirty, true, 'changing text marks the face for repaint');
});

test('a sign registered with a runtime is painted by it, once, and disposes cleanly', () => {
  const listeners = new Set();
  const ticker = { elapsed: 0, events: { on: (_n, f) => listeners.add(f), off: (_n, f) => listeners.delete(f) } };
  const runtime = new SignRuntime({ ticker, probe: () => ({ visible: true, near: true, distance: 5 }), quality: () => 'high', reduced: () => false, hidden: () => false });
  const disposers = [];
  const sign = new Sign({ id: 'b', variant: 'board', width: 2.6, height: 1.45, title: 'T', materials: signMaterials(), runtime, bin: { add: f => disposers.push(f) } });
  const step = (dt) => { ticker.elapsed += dt; for (const f of [...listeners]) f(); };
  step(1 / 60); step(1 / 60);
  assert.equal(sign.main.paints, 1);
  assert.equal(sign.emblem.paints, 1, 'both layers were unpainted and in sight, so neither waited a frame');
  const before = sign.emblem.paints;
  for (let i = 0; i < 60; i++) step(1 / 60);
  assert.ok(sign.emblem.paints - before >= 8 && sign.emblem.paints - before <= 11, `~10 Hz over a second (${sign.emblem.paints - before})`);
  assert.equal(sign.main.paints, 1, 'the static face never repaints by itself');
  disposers.forEach(f => f());
  assert.equal(runtime.signs.length, 0);
  runtime.dispose();
  assert.equal(listeners.size, 0);
});

test('a layer shows its ground colour until its first paint, so an unpainted face is paper or timber and never black', () => {
  const fills = [];
  const create = document.createElement;
  document.createElement = () => {
    const canvas = { width: 1, height: 1 };
    const inner = fakeContext(canvas);
    const context = new Proxy(inner, {
      get(target, key) { return key === 'fillRect' ? (...rect) => fills.push({ colour: target.fillStyle, rect }) : target[key]; },
      set(target, key, value) { target[key] = value; return true; },
    });
    canvas.getContext = () => context;
    return canvas;
  };
  try {
    const plain = new SignLayer({ name: 'plain', width: 64, height: 32, paint() {} });
    assert.equal(fills.length, 0, 'an overlay stays transparent');
    assert.equal(plain.unpainted, true);
    const grounded = new SignLayer({ name: 'face', width: 64, height: 32, paint() {}, base: '#f1d8a6' });
    assert.deepEqual(fills, [{ colour: '#f1d8a6', rect: [0, 0, 64, 32] }], 'the canvas is filled edge to edge');
    assert.equal(grounded.unpainted, true);
    grounded.paint(1);
    assert.equal(grounded.unpainted, false);
    assert.equal(grounded.paintedAt, 1);
    // A still frame is painted with its own clock but remembers when it happened.
    const still = new SignLayer({ name: 'e', width: 8, height: 8, paint() {}, live: true });
    still.paint(0.6, 12.5);
    assert.equal(still.paintedAt, 12.5);
    fills.length = 0;
    const materials = signMaterials();
    new Sign({ id: 'board', variant: 'board', width: 2, height: 1, title: 'x', materials });
    new Sign({ id: 'plank', variant: 'plank', width: 1, height: 0.5, title: 'x', materials });
    assert.deepEqual(fills.map(f => f.colour), ['#f1d8a6', '#574e37', '#574e37'], 'board paper, its emblem mat, plank timber');
  } finally { document.createElement = create; }
});

test('a tree that holds a sign can be cloned and serialised: the sign is on userData but not in what JSON copies', () => {
  const materials = signMaterials();
  const signs = [
    new Sign({ id: 'cb', variant: 'board', width: 2.6, height: 1.45, title: 'Clone me', materials }),
    new Sign({ id: 'cp', variant: 'plank', width: 1.5, height: 0.5, title: 'GitHub', hang: 'rope', materials }),
    new Sign({ id: 'cl', variant: 'label', width: 2.6, height: 0.7, title: 'Engineer', materials }),
    new Sign({ id: 'cc', variant: 'custom', width: 1, height: 1, materials }),
  ];
  for (const sign of signs) assert.equal(sign.group.userData.sign, sign, `${sign.id}: the sign is reachable from its group`);
  const tree = new THREE.Group();
  const branch = new THREE.Group();
  branch.add(...signs.map(s => s.group));
  tree.add(branch);
  // Object3D.clone() runs userData through JSON.parse(JSON.stringify(...)): this threw "Converting circular structure to JSON".
  let copy;
  assert.doesNotThrow(() => { copy = tree.clone(true); });
  assert.equal(copy.children[0].children.length, signs.length, 'the copy has every sign group');
  for (const group of copy.children[0].children) {
    assert.equal(group.userData.signMount, 'fixed', 'plain data is copied');
    assert.equal(group.userData.sign, undefined, 'the copy is not a Sign and does not pretend to be one');
  }
  assert.doesNotThrow(() => JSON.stringify(tree.children[0].children.map(g => g.userData)));
  assert.equal(signs[0].group.userData.sign, signs[0], 'cloning leaves the original alone');
  assert.deepEqual(Object.keys(signs[0].group.userData).sort(), ['signMount'], 'only plain data is enumerable');
  // The controllers that guarded against this by deleting the key keep working.
  delete signs[1].group.userData.sign;
  assert.equal(signs[1].group.userData.sign, undefined);
});
