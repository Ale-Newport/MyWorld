import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

/**
 * A 2D context with no canvas behind it: it records the text drawn and every colour set, measures a glyph as half an em, and
 * accepts everything else. Canvases made through `document` are the same thing, so whole controllers can be built in node.
 */
function fakeContext(canvas) {
  const state = { font: '10px sans-serif', fillStyle: '#000', strokeStyle: '#000' };
  const colours = new Set();
  const texts = [];
  const gradient = { addColorStop(_at, colour) { colours.add(String(colour)); } };
  return new Proxy(state, {
    get(target, key) {
      if (key === 'canvas') return canvas;
      if (key === 'colours') return colours;
      if (key === 'texts') return texts;
      if (key === 'measureText') return (text) => ({ width: String(text).length * Number(/(\d+(?:\.\d+)?)px/.exec(target.font)?.[1] ?? 10) * 0.5 });
      if (key === 'fillText') return (text, x, y) => texts.push({ text: String(text), x, y, font: target.font });
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
      if (key in target) return target[key];
      return () => undefined;
    },
    set(target, key, value) {
      target[key] = value;
      if (key === 'fillStyle' || key === 'strokeStyle') colours.add(String(value).toLowerCase());
      return true;
    },
  });
}

let canvasesMade = 0;
const makeCanvas = () => {
  const canvas = { width: 1, height: 1 };
  const context = fakeContext(canvas);
  canvas.getContext = () => context;
  canvasesMade++;
  return canvas;
};
globalThis.document = { createElement: makeCanvas, hidden: false, body: { dataset: {} } };

const places = await import('../../public/archipelago/preview/portfolio/world2/interactions/Places.js');
const { Screen } = await import('../../public/archipelago/preview/portfolio/world2/interactions/Screen.js');
const { Billboards } = await import('../../public/archipelago/preview/portfolio/world2/interactions/Billboards.js');
const { BOARD_DEFAULTS } = await import('../../public/archipelago/preview/portfolio/world2/content/boards.js');
const { swatchHistogram, SWATCH } = await import('../../public/archipelago/preview/portfolio/world2/signs/palette.js');

/** Every dark-blue / violet / mint constant the old painters used. None may come back. */
const OLD_SCREEN_COLOURS = ['#16131f', '#1b1420', '#241a12', '#14111c', '#12141b', '#32ffc1', '#8f8aa0', '#f4f1e8', '#5390ff', '#ff544d', '#e8b071'];
const fresh = (width, height) => { const canvas = makeCanvas(); canvas.width = width; canvas.height = height; return canvas.getContext('2d'); };
/** The distinct words drawn, in order (a carved figure is drawn twice: its shadow and its face). */
const said = (context) => context.texts.map(t => t.text).filter((t, i, all) => t !== all[i - 1]);
const experiment = BOARD_DEFAULTS.experiments[0];

/* ---------------------------------------------------------------- the notice board -- */

test('the notice board is laid out for reading from the chase camera: every note fits at a large size, none is cut, the credit stays', () => {
  const context = fresh(1024, 640);
  const metrics = places.paintNotice(context, 1024, 640, { sans: 'Test', mono: 'TestMono' });
  assert.equal(metrics.truncated, false, 'no note is cut');
  // 36 px of a 640 px board is what puts the body's cap height over 12 px at the default desktop camera (see the labels QA).
  assert.ok(metrics.bodyPx >= 34, `body text is ${metrics.bodyPx}px`);
  const text = said(context).join(' ');
  for (const note of places.NOTICE_NOTES) assert.ok(text.includes(note.label), `${note.label} is on the board`);
  assert.ok(text.includes('Bruno Simon') && text.includes('MIT'), 'the level credit is kept');
  assert.ok(text.includes('UNDER THE HOOD'));
  assert.ok(text.includes('World 02'));
});

test('the notice board scales to any canvas without changing its layout', () => {
  const big = places.paintNotice(fresh(1024, 640), 1024, 640, { sans: 'Test', mono: 'Test' });
  const small = places.paintNotice(fresh(512, 320), 512, 320, { sans: 'Test', mono: 'Test' });
  assert.ok(Math.abs(small.bodyPx * 2 - big.bodyPx) <= 4, `${small.bodyPx} x2 ~ ${big.bodyPx}`);
  assert.equal(small.truncated, false);
});

test('a long note is ellipsized, never squeezed, and reported', () => {
  const context = fresh(1024, 640);
  const notes = [{ label: 'LEVEL', body: 'word '.repeat(80) }, ...places.NOTICE_NOTES.slice(1)];
  const metrics = places.paintNotice(context, 1024, 640, { sans: 'Test', mono: 'Test' }, notes);
  assert.equal(metrics.truncated, true);
  assert.ok(said(context).some(t => t.endsWith('…')), 'the cut line ends in an ellipsis');
});

test('no painter of the places draws in the old dark-blue, violet or mint', () => {
  const contexts = [];
  const track = (paint) => { const context = fresh(1024, 640); paint(context); contexts.push(context); };
  track(c => places.paintNotice(c, 1024, 640, { sans: 'Test', mono: 'Test' }));
  track(c => places.paintLabPlate(c, 1024, 154));
  track(c => places.paintLabChip(c, 704, 64, experiment));
  track(c => places.paintLabPicture(c, 384, 206, experiment));
  track(c => places.paintLabCaption(c, 640, 87, experiment));
  track(c => places.paintAltarCounter(c, 7));
  track(c => places.paintCookieCounter(c, 12));
  for (const context of contexts) for (const colour of OLD_SCREEN_COLOURS) assert.ok(!context.colours.has(colour), `${colour} is gone`);
});

/* ---------------------------------------------------------------- the lab's small plates -- */

test('the lab plate, chip, picture caption and counters say what they should', () => {
  const plate = fresh(1024, 154);
  places.paintLabPlate(plate, 1024, 154);
  assert.ok(said(plate).includes('THE LAB'));

  const chip = fresh(704, 64);
  const width = places.paintLabChip(chip, 704, 64, { ...experiment, category: 'University' });
  assert.deepEqual(said(chip), ['UNIVERSITY']);
  assert.ok(width > 0 && width < 704, 'the chip is told how wide its text is');
  const blank = fresh(704, 64);
  places.paintLabChip(blank, 704, 64, { ...experiment, category: '  ' });
  assert.deepEqual(said(blank), ['EXPERIMENT'], 'a blank category does not leave an empty chip');

  const caption = fresh(640, 87);
  places.paintLabCaption(caption, 640, 87, { ...experiment, short: 'CINQUILLO 2.0' });
  assert.deepEqual(said(caption), ['UP NEXT', 'CINQUILLO 2.0']);

  const altar = fresh(512, 256);
  places.paintAltarCounter(altar, 7);
  assert.deepEqual(said(altar), ['OFFERINGS', '007', 'this browser']);
  const cookies = fresh(512, 200);
  places.paintCookieCounter(cookies, 12);
  assert.deepEqual(said(cookies), ['COOKIES TAKEN', '12']);
});

/* ---------------------------------------------------------------- Screen -- */

test('a screen for an authored mesh builds no plane; asking for `mesh` builds it once', () => {
  const authored = new Screen({ width: 64, height: 32, worldWidth: 1, authored: true });
  assert.equal(authored.group.children.length, 0, 'no plane hangs in the world');
  assert.ok(authored.material.map === authored.texture && authored.material.emissiveMap === authored.texture);
  const mesh = authored.mesh;
  assert.equal(authored.group.children.length, 1);
  assert.equal(authored.mesh, mesh, 'built once');
  assert.equal(mesh.material, authored.material);
  assert.ok(Math.abs(mesh.geometry.parameters.height - 0.5) < 1e-9, 'height follows the canvas aspect');

  const plain = new Screen({ width: 64, height: 32, worldWidth: 2 });
  assert.equal(plain.group.children.length, 1, 'a screen that lives in the world still gets its plane');
  assert.equal(plain.mesh.material, plain.material);

  let disposed = 0;
  const geometry = plain.mesh.geometry;
  geometry.addEventListener('dispose', () => disposed++);
  plain.destroy();
  assert.equal(disposed, 1);
  authored.destroy();
});

/* ---------------------------------------------------------------- the controller, with fakes -- */

/** A ticker, the way the runtime has one: `events.on('tick', fn, order)`, stepped by hand. */
function fakeTicker() {
  const listeners = [];
  const ticker = {
    elapsed: 0, delta: 1 / 60, scale: 1, alpha: 0,
    events: { on: (_n, fn, order = 0) => { listeners.push({ fn, order }); listeners.sort((a, b) => a.order - b.order); }, off: (_n, fn) => { const i = listeners.findIndex(l => l.fn === fn); if (i >= 0) listeners.splice(i, 1); } },
    step(n = 1) { for (let i = 0; i < n; i++) { ticker.elapsed += ticker.delta; for (const l of [...listeners]) l.fn(); } },
    get listeners() { return listeners.length; },
  };
  return ticker;
}

function fakeBin() {
  const disposers = [];
  return { add(fn) { disposers.push(fn); return fn; }, object3D() {}, dispose() { while (disposers.length) disposers.pop()(); } };
}

function fakeWorld({ nodes = {}, positions = {}, palette = {} } = {}) {
  const ticker = fakeTicker();
  const environment = { group: new THREE.Group(), nodes: new Map(Object.entries(palette)), suppressed: [], suppress(node) { this.suppressed.push(node.name); node.visible = false; }, dynamic: [] };
  const references = {
    environment,
    node: (name) => nodes[name] ?? null,
    position: (name) => positions[name]?.clone() ?? null,
    transform: () => null,
    physical: () => null,
    series: (prefix) => Object.entries(nodes).filter(([key]) => key === prefix || key.startsWith(`${prefix}.`)).map(([, node]) => node),
    suppress(name) { const node = nodes[name] ?? null; if (node) environment.suppress(node); return node; },
  };
  const prompts = { created: [], create(options) { this.created.push(options); return { show() {}, hide() {} }; } };
  const unlocked = [];
  const game = {
    ticker, worldBoards: undefined, view: undefined,
    player: { position: new THREE.Vector3(5, 0, 5), respawn() {} },
    audio: { play() {}, impact() {} }, tweens: { delay() {} },
    physics: { add() { return {}; }, remove() {} }, lighting: { phase: 0.4 },
    interactions: { achievements: { unlock: id => unlocked.push(id), mark() {}, set() {} } },
  };
  return { ticker, environment, references, prompts, game, unlocked, bin: fakeBin() };
}

const plane = (name, w, h, at = [0, 0, 0]) => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ metalness: 1, roughness: 1 }));
  mesh.name = name;
  mesh.position.set(...at);
  mesh.updateMatrixWorld(true);
  return mesh;
};

test('the behind-the-scenes board costs nothing until it is first shown: no canvas, no texture, no sign', () => {
  const world = fakeWorld({ positions: { 'refCenter.001': new THREE.Vector3(10, 0, 4), 'refInteractivePoint.004': new THREE.Vector3(10, 0, 8) } });
  const before = canvasesMade;
  const controller = new places.Places(world.game, world.references, world.prompts, world.bin);
  assert.equal(canvasesMade, before, 'building the place makes no canvas');
  const board = controller.sceneBoard;
  assert.ok(board && board.screen.group, 'the QA still finds sceneBoard.screen.group');
  assert.equal(board.screen.sign, null);
  assert.equal(board.screen.group.visible, false);
  assert.equal(board.screen.group.children.length, 0, 'no geometry');
  const prompt = world.prompts.created.find(p => p.label === 'Behind the scenes');
  assert.ok(prompt, 'the prompt exists');

  prompt.onInteract();
  assert.equal(canvasesMade - before, 1, 'one canvas, made by the first press');
  assert.ok(board.screen.sign && board.screen.group.visible && board.shown);
  assert.equal(board.screen.group.children[0], board.screen.sign.group);
  assert.deepEqual(world.unlocked, ['behindTheScene']);
  assert.ok(board.metrics && board.metrics.bodyPx >= 34, 'it painted its first frame at once');
  assert.equal(board.screen.sign.layers[0].canvas.width, 1024, 'the canvas is the plaque: 1024 px across');
  const layers = [];
  board.screen.sign.group.traverse(o => layers.push(o.layers.mask));
  assert.ok(layers.every(mask => mask === 1), 'with no camera that sees MAP_HIDDEN the board stays on the default layer');
  assert.equal(board.screen.sign.group.userData.signMount, 'billboard');

  // The second press makes nothing new; the third (hide) neither.
  prompt.onInteract(); prompt.onInteract();
  assert.equal(canvasesMade - before, 1);
  world.bin.dispose();
});

test('the board is a spherical billboard that follows its own rise, and no lookAt remains', async () => {
  const world = fakeWorld({ positions: { 'refCenter.001': new THREE.Vector3(10, 0, 4), 'refInteractivePoint.004': new THREE.Vector3(10, 0, 8) } });
  const controller = new places.Places(world.game, world.references, world.prompts, world.bin);
  const items = Billboards.for(world.ticker).items;
  const item = items.find(i => i.object === controller.sceneBoard.screen.group);
  assert.ok(item, 'registered with the shared billboard system');
  assert.equal(item.mode, 'spherical');
  assert.equal(item.moves, true);
  assert.ok(item.scale && item.scale.compensate && item.scale.min >= 1.4, 'it takes the camera distance and cancels its frame');

  const board = controller.sceneBoard;
  world.prompts.created.find(p => p.label === 'Behind the scenes').onInteract();
  const sunk = board.screen.group.position.y;
  world.ticker.step(180);
  assert.ok(board.screen.group.position.y > sunk + 1, `it rose (${sunk.toFixed(2)} -> ${board.screen.group.position.y.toFixed(2)})`);
  assert.ok(board.screen.group.position.y > board.home.y, 'and stands above its home');
  world.prompts.created.find(p => p.label === 'Behind the scenes').onInteract();
  world.ticker.step(400);
  assert.equal(board.screen.group.visible, false, 'hidden again once it has sunk');
  world.bin.dispose();
  assert.equal(items.find(i => i.object === board.screen.group), undefined, 'unregistered with the place');

  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../../public/archipelago/preview/portfolio/world2/interactions/Places.js', import.meta.url), 'utf8');
  assert.ok(!/\.lookAt\(/.test(source), 'nothing aims anything at the car');
});

test('a short viewport gets a bigger board (a phone held sideways is 390 px tall), and a tall one does not', () => {
  const sizeAt = (height) => {
    const world = fakeWorld({ positions: { 'refCenter.001': new THREE.Vector3(10, 0, 4), 'refInteractivePoint.004': new THREE.Vector3(10, 0, 8) } });
    world.game.view = height === undefined ? undefined : { viewport: { height } };
    const controller = new places.Places(world.game, world.references, world.prompts, world.bin);
    world.prompts.created.find(p => p.label === 'Behind the scenes').onInteract();
    world.ticker.step(3);
    const scale = controller.sceneBoard.screen.sign.group.scale.x;
    world.bin.dispose();
    return scale;
  };
  assert.equal(sizeAt(undefined), 1, 'no view, no change');
  assert.equal(sizeAt(1080), 1, 'a tall viewport is the size it was tuned on');
  assert.equal(sizeAt(900), 1);
  assert.ok(Math.abs(sizeAt(600) - 1.5) < 1e-9);
  assert.equal(sizeAt(390), 1.6, 'capped, so it never swallows the screen');
});

test('the lab board is painted, themed and dressed through the kit, and its leftovers are no longer black', async () => {
  const lab = (name, w, h, at) => plane(name, w, h, at);
  const palette = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
  const cold = (name, indices) => {
    const mesh = palette.clone();
    mesh.geometry = new THREE.BufferGeometry();
    mesh.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(indices.length * 3), 3));
    mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from(indices.flatMap(i => [(i + 0.5) / 32, 0.5])), 2));
    mesh.name = name;
    return mesh;
  };
  const frame = cold('Cube.003', [SWATCH.grey, SWATCH.grey, SWATCH.purple, SWATCH.lightOrange]);
  const arrow = cold('refArrowNext', [SWATCH.paleRose, SWATCH.paleRose, SWATCH.paleRose]);
  const nodes = {
    'refImages.001': lab('refImages.001', 4, 2.25),
    'text.009': lab('text.009', 4, 0.6, [0, 1.6, 0.03]),
    'text.007': lab('text.007', 4, 0.2, [0, 1.2, 0.08]),
    'panel.002': lab('panel.002', 1, 0.24, [0, 1.2, 0.05]),
    image: lab('image', 1.2, 0.64, [3.4, 1.5, 0.1]),
    'text.008': lab('text.008', 1.6, 0.2, [3.4, 1.1, 0.13]),
    intersect: lab('intersect', 2, 1.27, [3.4, 1.4, 0.07]),
    'refHeat.001': lab('refHeat.001', 2, 1.3, [1, 0.7, 1]),
    refOvenHeat: lab('refOvenHeat', 1, 1, [8, 0.7, 1]),
  };
  const world = fakeWorld({ nodes, positions: { 'refInteractivePoint.001': new THREE.Vector3(0, 0, 6) }, palette: { 'Cube.003': frame, refArrowNext: arrow } });
  const controller = new places.Places(world.game, world.references, world.prompts, world.bin);
  const board = controller.labBoard;
  assert.ok(board, 'the lab found its authored board');

  // Colour: the frame's grey and purple moved onto the island's timber and gold.
  const swatches = swatchHistogram(frame);
  assert.equal(swatches[SWATCH.grey] ?? 0, 0);
  assert.equal(swatches[SWATCH.purple] ?? 0, 0);
  assert.equal(swatches[SWATCH.woodDark], 2);
  assert.equal(swatches[SWATCH.gold], 1);
  assert.equal(swatchHistogram(arrow)[SWATCH.ink], 3, 'the arrow glyph is ink');

  // Every unpainted leftover has a lit face now, sized to its plane; the backing slab is hidden for good.
  const defaultMaterial = (m) => m.metalness === 1 && m.roughness === 1 && !m.map;
  for (const name of ['refImages.001', 'text.009', 'text.007', 'image', 'text.008']) {
    assert.ok(nodes[name].material.map?.image && !defaultMaterial(nodes[name].material), `${name} is painted`);
    assert.equal(nodes[name].visible, true);
  }
  for (const name of ['intersect', 'refHeat.001', 'refOvenHeat']) assert.ok(world.environment.suppressed.includes(name) && nodes[name].visible === false, `${name} is hidden for good`);
  const aspect = (mesh) => { const c = mesh.material.map.image; return +(c.width / c.height).toFixed(2); };
  assert.ok(Math.abs(aspect(nodes['refImages.001']) - 4 / 2.25) < 0.01, 'the sheet is not stretched');
  assert.ok(Math.abs(aspect(nodes['text.009']) - 4 / 0.6) < 0.03, 'the plate is not stretched');
  assert.ok(Math.abs(aspect(nodes.image) - 1.2 / 0.64) < 0.03);
  assert.ok(Math.abs(nodes['text.007'].scale.x - 0.55) < 1e-9, 'the chip plane is 2.2 m, not the authored 4 m');
  assert.equal(nodes['refImages.001'].material.emissiveIntensity, 0.4, 'a lit, emissive-lifted face (the kit\'s)');

  // The scheduler paints everything once and the experiment's theme dresses the board.
  world.ticker.step(60);
  for (const layer of board.sign.layers) assert.ok(layer.paints >= 1, `${layer.name} was painted`);
  const first = board.sign.layers.find(l => l.name === 'face').paints;
  assert.ok(board.woodNow && board.woodNow.visible, 'hardware for the first experiment is shown');
  assert.ok(board.charmNow === null || board.charmNow.visible);
  const shownBefore = board.woodNow;

  // The QA contract: bump the index, call paintLab(), and the face repaints; stepping through all of them builds each kind once.
  const kinds = new Set();
  for (let i = 0; i < controller.labProjects.length * 2; i++) {
    controller.labBoard.index = (controller.labBoard.index + 1) % controller.labProjects.length;
    controller.paintLab();
    world.ticker.step(3);
    kinds.add(board.woodNow);
    assert.equal(board.sign.layers.find(l => l.name === 'face').dirty, false, 'the face repaints after a step');
    assert.equal([...board.woods.values()].filter(m => m.visible).length, 1, 'one hardware kind at a time');
    assert.ok([...board.charms.values()].filter(m => m.visible).length <= 1, 'one charm at a time');
  }
  assert.ok(board.sign.layers.find(l => l.name === 'face').paints > first);
  assert.ok(kinds.size >= 1 && shownBefore, 'themes dressed the board');
  const meshesBefore = board.woods.size;
  for (let i = 0; i < controller.labProjects.length; i++) { controller.labBoard.index = i; controller.paintLab(); }
  assert.equal(board.woods.size, meshesBefore, 'a second lap builds nothing new');

  // The prompt advances the experiment and counts the visit.
  const index = board.index;
  world.prompts.created.find(p => p.label === 'Next experiment').onInteract();
  assert.equal(board.index, (index + 1) % controller.labProjects.length);
  assert.ok(world.unlocked.includes('lab'));
  world.bin.dispose();
});

/* ---------------------------------------------------------------- which layer the board is on -- */

test('the board goes on the map-hidden layer only where the camera that draws it sees that layer', () => {
  const layersWith = (camera) => {
    const world = fakeWorld({ positions: { 'refCenter.001': new THREE.Vector3(10, 0, 4), 'refInteractivePoint.004': new THREE.Vector3(10, 0, 8) } });
    world.game.view = camera === undefined ? undefined : { camera, viewport: { width: 1440, height: 900 } };
    const controller = new places.Places(world.game, world.references, world.prompts, world.bin);
    world.prompts.created.find(p => p.label === 'Behind the scenes').onInteract();
    const masks = new Set();
    controller.sceneBoard.screen.sign.group.traverse(o => masks.add(o.layers.mask));
    world.bin.dispose();
    return [...masks];
  };
  // /world's gameplay camera enables layer 2 (the atlas camera does not), /world2's camera does not: a board put on layer 2 there is never drawn.
  const world2Camera = new THREE.PerspectiveCamera(25, 1.6, 0.1, 800);
  assert.deepEqual(layersWith(world2Camera), [1], '/world2: the board stays on the camera\'s own layer, so it is drawn');
  const worldCamera = new THREE.PerspectiveCamera(25, 1.6, 0.1, 800);
  worldCamera.layers.enable(2);
  assert.deepEqual(layersWith(worldCamera), [1 << 2], '/world: out of the map photograph');
  assert.deepEqual(layersWith(undefined), [1], 'no view at all: default layer');
  for (const camera of [world2Camera, worldCamera]) {
    const masks = layersWith(camera);
    assert.ok(masks.every(mask => (mask & camera.layers.mask) !== 0), 'every part of the board shares a bit with the camera that draws it');
  }
});

/* ---------------------------------------------------------------- the board stays on the screen -- */

/** The board's top and bottom edge in px, by the same geometry the fit solves (an independent restatement of it). */
const edges = (i, fit) => {
  const k = i.perUnit * i.up;
  return {
    top: i.ground - fit.lift * k - fit.boost * i.boardHeight * (1 + i.up) / 2,
    bottom: i.ground - fit.lift * k + fit.boost * i.boardHeight * (1 - i.up) / 2,
    left: i.centreX - fit.boost * i.boardWidth / 2 + fit.slide,
    right: i.centreX + fit.boost * i.boardWidth / 2 + fit.slide,
  };
};
/** What the QA measured in a real browser at 844 x 390 (a phone held sideways), with the camera at its default pose. */
const SIDEWAYS = { wanted: 1.6, width: 844, height: 390, boardHeight: 135.9, boardWidth: 217.4, perUnit: 29.16, up: 0.75, ground: 225.2, roof: 183.3, centreX: 425.6, carOffset: 0 };
/** The same board on a 1440 x 900 desktop: nothing to fix. */
const DESKTOP = { wanted: 1, width: 1440, height: 900, boardHeight: 215, boardWidth: 344, perUnit: 46.6, up: 0.75, ground: 520, roof: 470, centreX: 720, carOffset: 0 };

test('fitNotice leaves a board that fits exactly where it was, and keeps one that does not on the screen', () => {
  const fits = places.fitNotice(DESKTOP);
  assert.deepEqual({ boost: fits.boost, lift: fits.lift, slide: fits.slide }, { boost: 1, lift: 1.6, slide: 0 }, 'a desktop board is untouched');

  const fit = places.fitNotice(SIDEWAYS);
  const e = edges(SIDEWAYS, fit);
  assert.ok(e.top >= 68 - 0.5, `its top edge clears the HUD row (${e.top.toFixed(1)} px)`);
  assert.ok(e.bottom <= SIDEWAYS.roof + 0.08 * SIDEWAYS.height + 0.5, `its footer, not its notes, goes behind the car (${e.bottom.toFixed(1)} px)`);
  assert.ok((e.bottom - e.top) <= 0.46 * SIDEWAYS.height + 0.5, 'it is at most 46% of the height');
  assert.ok(fit.boost >= 0.55 && fit.boost <= 1.6 && fit.lift >= 0.25 && fit.lift <= 1.6);
  assert.ok(e.left >= 8 && e.right <= SIDEWAYS.width - 8, 'and inside the width');
  // Taller screens give it more.
  const taller = places.fitNotice({ ...SIDEWAYS, height: 600, wanted: 1.5, ground: 345, roof: 300 });
  assert.ok(taller.boost * 1 >= fit.boost * 0.9);
});

test('fitNotice keeps a board wider than a narrow screen inside it, sliding it along the camera\'s right', () => {
  const narrow = { wanted: 1.4, width: 360, height: 640, boardHeight: 155, boardWidth: 248, perUnit: 33.2, up: 0.75, ground: 400, roof: 330, centreX: 180, carOffset: 0 };
  const centred = places.fitNotice(narrow);
  assert.ok(Math.abs(centred.boost * narrow.boardWidth - (360 - 16)) < 0.5, 'as wide as the screen allows, not wider');
  assert.ok(Math.abs(centred.slide) < 1e-9, 'centred, nothing to slide');
  for (const centreX of [150, 205, 40, 330]) {
    const fit = places.fitNotice({ ...narrow, centreX });
    const e = edges({ ...narrow, centreX }, fit);
    assert.ok(e.left >= 8 - 0.5 && e.right <= 352 + 0.5, `centre ${centreX}: ${e.left.toFixed(1)}..${e.right.toFixed(1)}`);
  }
  // A board that is already far off the screen is let alone: nobody is reading it, and it must not follow the player around.
  assert.ok(Math.abs(places.fitNotice({ ...narrow, centreX: -900 }).slide) < 1e-9);
  assert.ok(Math.abs(places.fitNotice({ ...narrow, centreX: 2000 }).slide) < 1e-9);
  const leaving = places.fitNotice({ ...narrow, centreX: -60 });
  assert.ok(leaving.slide > 0 && Number.isFinite(leaving.slide));
  // A car far from the board does not squeeze it: the board is left as it is without anyone at it (its own size, its resting height).
  const alone = places.fitNotice({ ...SIDEWAYS, carOffset: SIDEWAYS.boardWidth * 3 });
  const natural = Math.min(1.6, 0.46 * SIDEWAYS.height / SIDEWAYS.boardHeight, (SIDEWAYS.width - 16) / SIDEWAYS.boardWidth);
  assert.ok(Math.abs(alone.boost - natural) < 1e-9 && alone.lift === 1.6 && Math.abs(alone.slide) < 1e-9, JSON.stringify(alone));
  // And it is eased in, not switched: halfway across, the fit is halfway applied.
  const between = places.fitNotice({ ...SIDEWAYS, carOffset: SIDEWAYS.boardWidth * 1.5 });
  const engaged = places.fitNotice(SIDEWAYS);
  assert.ok(between.lift > engaged.lift && between.lift < 1.6, `lift ${engaged.lift} < ${between.lift} < 1.6`);
});

test('fitNotice never returns NaN or an absurd size, whatever it is handed', () => {
  const odd = [
    { ...SIDEWAYS, up: 0 }, { ...SIDEWAYS, up: 1 }, { ...SIDEWAYS, perUnit: 0 }, { ...SIDEWAYS, boardHeight: 0, boardWidth: 0 },
    { ...SIDEWAYS, height: 100, ground: 60, roof: 40 }, { ...SIDEWAYS, ground: -400, roof: -420 }, { ...SIDEWAYS, wanted: 1 },
  ];
  for (const input of odd) {
    const fit = places.fitNotice(input);
    for (const [key, value] of Object.entries(fit)) assert.ok(Number.isFinite(value), `${key} is finite for ${JSON.stringify(input)}`);
    assert.ok(fit.boost >= 0.55 || input.boardWidth === 0, 'never under the floor');
    assert.ok(fit.lift >= 0.25 && fit.lift <= 1.6);
  }
});

test('with a real camera the board is sized and placed by its projection, allocating nothing per frame', () => {
  const setup = (width, height) => {
    const world = fakeWorld({ positions: { 'refCenter.001': new THREE.Vector3(10, 0, 4), 'refInteractivePoint.004': new THREE.Vector3(10, 0, 8) } });
    const camera = new THREE.PerspectiveCamera(25, width / height, 0.1, 800);
    // The chase camera's default: 21 m out, 41 degrees up, looking at the car. The frame is scaled 0.7, as the world's is.
    const car = new THREE.Vector3(10, 0.4, 8).multiplyScalar(0.7);
    camera.position.set(car.x + 21 * Math.cos(0.7) * Math.cos(0.72), 21 * Math.sin(0.72), car.z + 21 * Math.sin(0.7) * Math.cos(0.72));
    camera.lookAt(car);
    camera.updateMatrixWorld(true);
    world.game.view = { camera, viewport: { width, height } };
    world.game.player.position.set(10, 0.4, 8);
    const controller = new places.Places(world.game, world.references, world.prompts, world.bin);
    controller.group.scale.setScalar(0.7);
    controller.group.updateMatrixWorld(true);
    world.prompts.created.find(p => p.label === 'Behind the scenes').onInteract();
    return { world, camera, controller };
  };
  for (const [width, height] of [[1440, 900], [844, 390], [360, 640]]) {
    const { world, controller } = setup(width, height);
    world.ticker.step(240);
    controller.group.updateMatrixWorld(true);
    const board = controller.sceneBoard;
    const boost = board.screen.sign.group.scale.x;
    assert.ok(boost >= 0.55 && boost <= 1.6 && Number.isFinite(board.screen.group.position.y), `${width}x${height}: boost ${boost.toFixed(2)}`);
    assert.ok(Number.isFinite(board.slide.x) && Number.isFinite(board.slide.z));
    if (height >= 900) assert.equal(boost, 1, 'a desktop board keeps its size');
    else assert.ok(boost > 1 && boost <= Math.min(1.6, 900 / height) + 1e-9, 'a short screen gets a bigger board, never more than it asked for');
    world.bin.dispose();
  }
  // No allocation in a steady frame once the board is up (heap-free is not testable here; the fit's objects are reused, which is).
  const { world, controller } = setup(844, 390);
  world.ticker.step(60);
  assert.ok(controller.fitIn && controller.fitOut, 'the fit reuses its input and output objects');
  const fitIn = controller.fitIn, fitOut = controller.fitOut;
  world.ticker.step(30);
  assert.equal(controller.fitIn, fitIn); assert.equal(controller.fitOut, fitOut);
  world.bin.dispose();
});

/* ---------------------------------------------------------------- the lab's face -- */

test('the lab face is built for the chase camera: big type, the whole description, the title, the number and the tags', () => {
  const context = fresh(1024, 576);
  const metrics = places.paintLabFace(context, experiment, 0, 11);
  const text = said(context).join(' | ');
  assert.ok(text.includes('EXPERIMENT 1 / 11'));
  assert.ok(text.includes(experiment.title.split(' ')[0]));
  assert.ok(experiment.description.split(/\s+/).every(word => text.includes(word)), 'every word of the description is on the face');
  assert.equal(metrics.truncated, false);
  // The old face (paintExperiment) set the description at 22-32 design px: on a 4 m sign read from 21 m that is about 8 px em.
  assert.ok(metrics.bodyPx >= 44, `description ${metrics.bodyPx}px`);
  assert.ok(metrics.titlePx >= 60, `title ${metrics.titlePx}px`);
  assert.ok(metrics.tagPx >= 32, `tags ${metrics.tagPx}px`);
  for (const colour of OLD_SCREEN_COLOURS) assert.ok(!context.colours.has(colour), `${colour} is gone`);

  // Every experiment the portfolio ships fits at a readable size, with no cut text.
  for (const [i, project] of BOARD_DEFAULTS.experiments.entries()) {
    const m = places.paintLabFace(fresh(1024, 576), project, i, BOARD_DEFAULTS.experiments.length);
    assert.equal(m.truncated, false, `${project.title} is shown whole`);
    assert.ok(m.bodyPx >= 44 && m.titlePx >= 46, `${project.title}: description ${m.bodyPx}px, title ${m.titlePx}px`);
  }
  // A CMS edit with a 120-character title and a 500-character description is cut, not squeezed, and says so.
  const long = places.paintLabFace(fresh(1024, 576), { ...experiment, title: 'T'.repeat(5) + ' word'.repeat(30), description: ('lots of words '.repeat(60)).slice(0, 500) }, 3, 11);
  assert.equal(long.truncated, true);
  assert.ok(long.bodyPx >= 38 && long.titlePx >= 46, 'type never goes below the face\'s own floor');
  // The face scales to any canvas without changing its layout.
  const half = places.paintLabFace(fresh(512, 288), experiment, 0, 11);
  assert.equal(half.bodyPx, metrics.bodyPx);
});

test('the picture quad sits exactly on the picture the face leaves for it', () => {
  const { LAB_PICTURE } = places;
  assert.ok(LAB_PICTURE.x + LAB_PICTURE.size + 14 <= 1024 - 40 && LAB_PICTURE.y - 14 >= 20, 'the picture and its mat are on the sheet');
  assert.ok(LAB_PICTURE.size >= 200);
});
