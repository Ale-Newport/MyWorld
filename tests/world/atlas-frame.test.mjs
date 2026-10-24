import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldAtlas, frameFootprint, flipRows, rankPlaces, readingOrder, placeLabels, hitMargins, dotClearance } from '../../public/archipelago/preview/atlas.js';
import { landFootprint, authoredWorldBounds } from '../../public/archipelago/preview/world-bounds.js';

// The /world map frames the island itself (landFootprint + frameFootprint), and every transform derives from photo.bounds,
// so a click maps back to exactly the world point under it. These run the real modules on a synthetic island.

/** A flat sea floor at -4 with a hill (an island) at x 20..60, z -10..50, as a terrain-flagged mesh. */
function terrain({ visible = true, offset = [0, 0, 0] } = {}) {
  const geometry = new THREE.PlaneGeometry(400, 300, 200, 150);
  geometry.rotateX(-Math.PI / 2);
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const inside = x >= 20 && x <= 60 && z >= -10 && z <= 50;
    p.setY(i, inside ? 1.5 : -4);
  }
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.userData.terrain = true;
  mesh.visible = visible;
  mesh.position.set(...offset);
  return mesh;
}
const rootWith = (...nodes) => { const root = new THREE.Group(); root.add(...nodes); root.updateMatrixWorld(true); return root; };

test('landFootprint is the terrain that rises above the flat sea floor, and nothing else', () => {
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());   // a huge sea plane is not terrain
  const f = landFootprint(rootWith(terrain(), sea));
  assert.deepEqual([f.minX, f.maxX, f.minZ, f.maxZ].map(Math.round), [20, 60, -10, 50]);
});

test('landFootprint follows the terrain node transform, ignores hidden terrain and honours an explicit floor', () => {
  const moved = landFootprint(rootWith(terrain({ offset: [100, 0, -30] })));
  assert.deepEqual([moved.minX, moved.maxX, moved.minZ, moved.maxZ].map(Math.round), [120, 160, -40, 20]);
  assert.equal(landFootprint(rootWith(terrain({ visible: false }))), null, 'a world with no visible terrain has no footprint');
  assert.equal(landFootprint(null), null);
  // Above y = 2 there is nothing: no footprint at all.
  assert.equal(landFootprint(rootWith(terrain()), { minY: 2 }), null);
});

test('frameFootprint: padded all round (thinner east and west), the island a hair above the middle, never clipped', () => {
  const land = { minX: -161, maxX: 142, minZ: -87, maxZ: 167 };
  const b = frameFootprint(land);
  const w = land.maxX - land.minX, d = land.maxZ - land.minZ, long = Math.max(w, d), padZ = long * 0.034, padX = long * 0.01;
  assert.ok(Math.abs((land.minX - b.minX) - padX) < 1e-9 && Math.abs((b.maxX - land.maxX) - padX) < 1e-9, 'sea margin of 1 % of the longer side east and west: a portrait stage is limited by the width, where sea is island lost');
  assert.ok(Math.abs((land.minZ - b.minZ) - padZ) < 1e-9, '3.4 % to the north');
  const planeCentreZ = (b.minZ + b.maxZ) / 2, landCentreZ = (land.minZ + land.maxZ) / 2, planeHeight = b.maxZ - b.minZ;
  const lift = (planeCentreZ - landCentreZ) / planeHeight;   // positive: the plane's middle is south of the island's, so the island is above it
  assert.ok(lift > 0.012 && lift < 0.02, `the island sits ${(lift * 100).toFixed(2)} % of the plane's height above its middle`);
  assert.ok(Math.abs((b.minX + b.maxX) / 2 - (land.minX + land.maxX) / 2) < 1e-9, 'and exactly centred east-west');
  assert.ok(land.maxZ < b.maxZ - padZ, 'the south has the margin and the lift');
  // The island's share of a width-limited stage: the pad no longer costs a phone its size.
  assert.ok(w / (b.maxX - b.minX) > 0.975, `on a portrait stage the island spans ${(w / (b.maxX - b.minX) * 100).toFixed(1)} % of the width`);
});

test('WorldAtlas.bounds frames the terrain, caches it and falls back to the legacy world when there is none', () => {
  const root = rootWith(terrain());
  const fake = { root, frameBounds: null };
  const a = WorldAtlas.prototype.bounds.call(fake);
  assert.equal(WorldAtlas.prototype.bounds.call(fake), a, 'computed once per invalidation');
  assert.ok(a.minX < 20 && a.maxX > 60 && a.minZ < -10 && a.maxZ > 50);
  assert.ok((a.maxX - a.minX) < 120, 'the frame is the island plus a margin, not the 400 m terrain tile or the 290 m legacy world');
  const empty = { root: rootWith(new THREE.Group()), frameBounds: null };
  const legacy = authoredWorldBounds(empty.root);
  assert.deepEqual(WorldAtlas.prototype.bounds.call(empty), { minX: legacy.minX - 6, maxX: legacy.maxX + 6, minZ: legacy.minZ - 6, maxZ: legacy.maxZ + 6 });
});

/** The atlas's view maths on a stage of sw x sh px showing a photograph of `bounds` (no DOM). */
function view(bounds, sw, sh, zoom = 1, cx = null, cy = null) {
  const photo = { bounds, width: 3000, height: Math.round(3000 * (bounds.maxZ - bounds.minZ) / (bounds.maxX - bounds.minX)) };
  const fit = Math.min(sw / photo.width, sh / photo.height), fw = photo.width * fit, fh = photo.height * fit;
  const a = { photo, sw, sh, fw, fh, view: { zoom, cx: cx ?? fw / 2, cy: cy ?? fh / 2 } };
  for (const m of ['toPlane', 'toScreen', 'toWorld', 'clampView']) a[m] = WorldAtlas.prototype[m].bind(a);
  return a;
}

test('toWorld is the exact inverse of toScreen at any zoom, pan and stage size (a click travels where it points)', () => {
  const bounds = frameFootprint({ minX: -161, maxX: 142, minZ: -87, maxZ: 167 });
  for (const [sw, sh] of [[874, 675], [338, 641], [534, 201], [458, 675]]) {
    for (const zoom of [1, 2.5, 7]) {
      const a = view(bounds, sw, sh, zoom, undefined, undefined);
      a.view.cx = a.fw * 0.4; a.view.cy = a.fh * 0.6; a.clampView();
      for (const [x, z] of [[0, 0], [-100, 40], [120, 150], [bounds.minX - 30, bounds.maxZ + 10]]) {
        const [px, py] = a.toScreen(x, z), p = a.toWorld(px, py);
        assert.ok(Math.hypot(p.x - x, p.z - z) < 1e-9, `${sw}x${sh} zoom ${zoom}: (${x}, ${z}) -> (${px.toFixed(1)}, ${py.toFixed(1)}) -> (${p.x}, ${p.z})`);
      }
    }
  }
});

test('at zoom 1 the island is centred in a stage of any aspect ratio, a hair above the middle', () => {
  const land = { minX: -161, maxX: 142, minZ: -87, maxZ: 167 }, bounds = frameFootprint(land);
  for (const [sw, sh] of [[874, 675], [874, 531], [714, 579], [458, 675], [338, 641], [534, 201]]) {
    const a = view(bounds, sw, sh);
    const [x0, y0] = a.toScreen(land.minX, land.minZ), [x1, y1] = a.toScreen(land.maxX, land.maxZ);
    const dx = ((x0 + x1) / 2 - sw / 2) / sw * 100, dy = ((y0 + y1) / 2 - sh / 2) / sh * 100, small = Math.min(sw, sh);
    assert.ok(Math.abs(dx) < 0.1, `${sw}x${sh}: centred east-west (${dx.toFixed(3)} %)`);
    assert.ok(dy < -0.5 && dy > -2.5, `${sw}x${sh}: ${dy.toFixed(2)} % of the stage height above the middle`);
    // North and south keep a comfortable margin; east and west only the thin one, which is where a portrait stage is short of room.
    assert.ok(Math.min(y0, sh - y1) / small > 0.025, `${sw}x${sh}: north and south margins of at least 2.5 % of the smaller side`);
    assert.ok(Math.min(x0, sw - x1) / small > 0.008, `${sw}x${sh}: east and west margins of at least 0.8 % of the smaller side (not clipped)`);
    if (sw / sh < 1) assert.ok((x1 - x0) / sw > 0.97, `${sw}x${sh}: a portrait stage is filled by the island's width (${((x1 - x0) / sw * 100).toFixed(1)} %)`);
  }
});

test('flipRows turns a bottom-up image upright in place, for any number of rows', () => {
  for (const rows of [1, 2, 3, 8]) {
    const width = 3, row = width * 4, u8 = new Uint8Array(row * rows), want = new Uint8Array(row * rows);
    for (let y = 0; y < rows; y++) { u8.fill(y + 1, y * row, (y + 1) * row); want.fill(rows - y, y * row, (y + 1) * row); }
    const before = u8.buffer;
    flipRows(u8, width, rows, new Uint8Array(row));
    assert.deepEqual([...u8], [...want]);
    assert.equal(u8.buffer, before, 'no new buffer');
  }
});

test('detailWanted: nothing while the view is settling or covered, a rectangle beyond the view when it is not, capped on small budgets', () => {
  const bounds = frameFootprint({ minX: -161, maxX: 142, minZ: -87, maxZ: 167 });
  globalThis.devicePixelRatio = 2;   // a browser global the module reads
  const make = (zoom, covered) => {
    const a = view(bounds, 874, 675, zoom);
    Object.assign(a, { detailInfo: null, viewChanged: performance.now() - 1000 });
    a.photo.state = 'sharp';
    a.detailWanted = WorldAtlas.prototype.detailWanted.bind(a);
    if (covered) a.detailInfo = { x0: 0, x1: a.fw, y0: 0, y1: a.fh, density: 100 };
    return a;
  };
  assert.equal(make(1, false).detailWanted(), null, 'not zoomed in');
  assert.equal(make(4, true).detailWanted(), null, 'an existing detail covering the view is kept: no re-photograph');
  const settling = make(4, false); settling.viewChanged = performance.now();
  assert.equal(settling.detailWanted(), null, 'still moving');
  const unsharp = make(4, false); unsharp.photo.state = 'preview';
  assert.equal(unsharp.detailWanted(), null, 'the full photograph comes first');
  const a = make(4, false), d = a.detailWanted();
  assert.ok(d && d.width <= 2048 && d.height <= 2048 && d.x1 > d.x0 && d.y1 > d.y0);
  const visibleW = a.sw / 4;
  assert.ok(d.x1 - d.x0 >= visibleW - 1e-6, 'covers the visible width');
  assert.ok(d.x0 >= 0 && d.x1 <= a.fw && d.y0 >= 0 && d.y1 <= a.fh, 'stays on the plane');
  delete globalThis.devicePixelRatio;
});

// Pins compete for a label in rank order. Tab order (reading order, north to south) must never leak into that ranking:
// when two places of the same kind and priority collide, the one the world lists first keeps its label, as it always has.
const place = (name, kind, x, z, priority) => ({ name, kind, x, z, priority });

test('rankPlaces: activities, then areas, then the rest, higher priority first, and ties keep the order the world lists them in', () => {
  const places = [
    place('Ice Rink', 'place', 0, 0),
    place('Time machine', 'activity', 10, 90),        // listed first, furthest south
    place('Projects', 'experience', 5, 5, 1),
    place('Behind the scenes', 'activity', 20, -40),  // listed second, further north
    place('Career', 'experience', 30, 30, 5),
    place('Email', 'activity', -5, 10, 2),
    place('Unknown', 'mystery', 0, 0),
  ];
  assert.deepEqual(rankPlaces(places).map((p) => p.name), ['Email', 'Time machine', 'Behind the scenes', 'Career', 'Projects', 'Ice Rink', 'Unknown']);
  assert.deepEqual(places.map((p) => p.name).slice(0, 2), ['Ice Rink', 'Time machine'], 'the caller\'s list is not reordered');
  // The regression: sorting the list north to south first would put Behind the scenes (z -40) ahead of Time machine (z 90).
  assert.deepEqual(rankPlaces(readingOrder(places)).filter((p) => p.kind === 'activity' && !p.priority).map((p) => p.name), ['Behind the scenes', 'Time machine']);
  assert.deepEqual(rankPlaces(places).filter((p) => p.kind === 'activity' && !p.priority).map((p) => p.name), ['Time machine', 'Behind the scenes']);
});

test('readingOrder: north to south, then west to east, on a copy', () => {
  const places = [place('c', 'place', 5, 10), place('a', 'place', 9, -3), place('b', 'place', 1, 10), place('d', 'place', 0, 20)];
  assert.deepEqual(readingOrder(places).map((p) => p.name), ['a', 'b', 'c', 'd']);
  assert.deepEqual(places.map((p) => p.name), ['c', 'a', 'b', 'd']);
});

test('buildPins ranks labels in the world\'s list order and puts the DOM (Tab) in reading order', () => {
  const made = [];
  globalThis.document = { createElement: (tag) => { const e = { tag, style: { setProperty() {} }, dataset: {}, setAttribute() {}, append() {}, addEventListener() {}, className: '', textContent: '' }; made.push(e); return e; } };
  try {
    const places = [place('south', 'activity', 0, 90), place('north', 'activity', 0, -40), place('area', 'experience', 0, 0, 3), place('west', 'activity', -50, 90)];
    const a = Object.create(WorldAtlas.prototype);
    Object.assign(a, { travelling: true, markers: { places, player: null }, pins: { replaceChildren(...c) { this.children = c; } } });
    a.buildPins();
    // (Ranked from the reading-order copy it would be north, west, south, area: the bug this guards against.)
    assert.deepEqual(a.ranked.map((r) => r.m.name), ['south', 'north', 'west', 'area'], 'activities in the order the world lists them, then the area');
    assert.deepEqual(a.pinEls.map((r) => r.m.name), ['north', 'area', 'west', 'south'], 'Tab goes north to south, west to east');
    assert.deepEqual(a.pins.children, a.pinEls.map((r) => r.pin), 'the DOM holds the pins in Tab order');
    assert.equal(new Set(a.ranked).size, 4);
    assert.ok(a.ranked.every((r) => a.pinEls.includes(r)), 'one record per place, shared by both orders');
  } finally { delete globalThis.document; }
});

// ---- label placement ------------------------------------------------------------------------------------------------------------
// Independent of atlas.js: the box a label of width w occupies on a side of a dot at (x, y), as atlas.css lays it out
// (6 px beside the dot, 4 px above or below it, 18.3 px tall; a corner label starts or ends 4 px past the dot's centre).
function box(side, x, y, w) {
  const h = 18.3;
  if (side === 'right') return [x + 13, y - h / 2, x + 13 + w, y + h / 2];
  if (side === 'left') return [x - 13 - w, y - h / 2, x - 13, y + h / 2];
  const [x0, x1] = side.endsWith('right') ? [x - 4, x - 4 + w] : side.endsWith('left') ? [x + 4 - w, x + 4] : [x - w / 2, x + w / 2];
  return side.startsWith('above') ? [x0, y - 11 - h, x1, y - 11] : [x0, y + 11, x1, y + 11 + h];
}
const meet = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const dotBox = (r) => [r.x - 7, r.y - 7, r.x + 7, r.y + 7];
const pin = (name, x, y, { lw = 60, kind = 'place', off = false } = {}) => ({ m: { name, kind }, x, y, off, lw, r: dotClearance(kind), side: undefined, hit: 9 });
const STAGE = { width: 600, height: 400 };

test('placeLabels: a lone place has its label on its right, and rank decides who gets a contested side', () => {
  const lone = [pin('A', 100, 100)];
  placeLabels(lone, STAGE);
  assert.equal(lone[0].side, 'right');
  // B's dot lies in A's right-hand box. A, ranked first, has the right; B's dot is not moved or ignored, so A must go elsewhere.
  const rec = [pin('A', 100, 100), pin('B', 130, 100)];
  placeLabels(rec, STAGE);
  assert.equal(rec[0].side, 'left', 'a label that would lie over another place\'s dot (one ranked after it) takes the other side');
  assert.equal(rec[1].side, 'right', 'B has its right side free');
});

test('placeLabels: another side before no label at all, in the order right, left, above, below, then the corners', () => {
  // A at (300, 200), label 60 px wide: right 313-373, left 227-287, above and below 270-330, corners 296-356 (-right) and 244-304 (-left).
  // Each blocker is a lone dot placed to cover the candidate named, and as few others as the geometry allows.
  const blockers = { right: [368, 200], left: [232, 200], above: [282, 180], below: [282, 220], aboveRight: [345, 180], belowRight: [345, 220], aboveLeft: [250, 180], aboveMirror: [318, 180], belowMirror: [318, 220] };
  const sideWith = (...names) => { const recs = [pin('A', 300, 200), ...names.map((n, i) => pin('o' + i, ...blockers[n]))]; placeLabels(recs, STAGE); return recs[0].side; };
  assert.equal(sideWith(), 'right');
  assert.equal(sideWith('right'), 'left');
  assert.equal(sideWith('right', 'left'), 'above');
  assert.equal(sideWith('right', 'left', 'above'), 'below');
  assert.equal(sideWith('right', 'left', 'above', 'below'), 'above-right', 'the corners come last');
  assert.equal(sideWith('right', 'left', 'above', 'below', 'aboveRight'), 'below-right');
  assert.equal(sideWith('right', 'left', 'aboveMirror', 'belowMirror'), 'above-left');
  assert.equal(sideWith('right', 'left', 'aboveMirror', 'belowMirror', 'aboveLeft'), 'below-left');
  assert.equal(sideWith('right', 'left', 'above', 'below', 'aboveRight', 'belowRight'), null, 'boxed in: no label (it shows on hover and focus)');
});

test('placeLabels: stays on the stage, avoids the arrow and places nothing for places that are off the stage', () => {
  const edge = [pin('E', 560, 200, { lw: 80 })];   // 560 + 13 + 80 runs off a 600 px stage
  placeLabels(edge, STAGE);
  assert.equal(edge[0].side, 'left');
  const top = [pin('T', 300, 6, { lw: 60 })];
  placeLabels(top, STAGE);
  assert.ok(['below', 'below-left', 'below-right', 'right', 'left'].includes(top[0].side), 'not above a place at the top edge');
  const box2 = box(top[0].side, 300, 6, 60);
  assert.ok(box2[1] >= 2 && box2[3] <= STAGE.height - 2 && box2[0] >= 2 && box2[2] <= STAGE.width - 6, `inside the stage ${box2}`);
  const withArrow = [pin('A', 100, 100)];
  placeLabels(withArrow, { ...STAGE, arrow: { x: 140, y: 100 } });
  assert.equal(withArrow[0].side, 'left', 'the arrow is 28 px wide and is not covered');
  const gone = [pin('Gone', 100, 100, { off: true }), pin('A', 100, 100)];
  placeLabels(gone, STAGE);
  assert.equal(gone[0].side, null);
  assert.equal(gone[1].side, 'right', 'a place that is off the stage blocks nothing');
});

test('placeLabels: whatever the layout, no label covers a dot or another label (property test on 300 random layouts)', () => {
  let seed = 7;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  let placed = 0, total = 0;
  for (let round = 0; round < 300; round++) {
    const n = 6 + Math.floor(random() * 40), recs = [];
    for (let i = 0; i < n; i++) recs.push(pin('p' + i, 10 + random() * 580, 10 + random() * 380, { lw: 40 + Math.floor(random() * 90), kind: ['place', 'experience', 'activity'][Math.floor(random() * 3)], off: random() < 0.05 }));
    placeLabels(recs, STAGE);
    const labels = [];
    recs.forEach((r, i) => {
      total += r.off ? 0 : 1;
      if (r.off) { assert.equal(r.side, null); return; }
      if (r.side === null) return;
      placed++;
      const b = box(r.side, r.x, r.y, r.lw);
      assert.ok(b[0] >= 2 && b[2] <= STAGE.width - 6 && b[1] >= 2 && b[3] <= STAGE.height - 2, `round ${round}: label ${i} on the stage`);
      for (const [j, o] of recs.entries()) if (j !== i && !o.off) assert.ok(!meet(b, dotBox(o)), `round ${round}: label ${i} (${r.side}) covers the dot of ${j}`);
      for (const l of labels) assert.ok(!meet(b, l), `round ${round}: label ${i} overlaps another label`);
      labels.push(b);
    });
  }
  assert.ok(placed > total * 0.3, `and labels are still handed out (${placed} of ${total})`);
});

test('placeLabels allocates nothing once it has run', () => {
  const recs = Array.from({ length: 40 }, (_, i) => pin('p' + i, 20 + (i % 8) * 70, 20 + Math.floor(i / 8) * 70));
  placeLabels(recs, STAGE);
  if (typeof global.gc !== 'function') return;   // measured only when node runs with --expose-gc
  global.gc(); const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 2000; i++) placeLabels(recs, STAGE);
  assert.ok(process.memoryUsage().heapUsed - before < 1e6);
});

test('hitMargins: a touch margin never reaches the centre of a pin drawn beneath it, and stays 9 px where nothing is near', () => {
  const [a, b, c] = [pin('a', 100, 100), pin('b', 110, 100), pin('c', 300, 100)];
  hitMargins([a, b, c]);   // DOM order: a is drawn first, so b lies over it
  assert.equal(a.hit, 9, 'nothing is beneath the first pin');
  assert.equal(b.hit, 2, 'b\'s dot ends 3 px short of a\'s centre: the margin stops 1 px before it');
  assert.equal(c.hit, 9, 'far from everything');
  const [d, e] = [pin('d', 100, 100), pin('e', 104, 100)];
  hitMargins([d, e]);
  assert.equal(e.hit, 0, 'a centre under another dot cannot be saved by a margin');
  // A label belongs to the pin's box: f's label reaches over to where g's centre is.
  const f = pin('f', 300, 100, { lw: 60 }), g = pin('g', 372, 100);
  f.side = 'right';
  hitMargins([g, f]);   // g beneath f
  assert.equal(f.hit, 0, 'g\'s centre sits 1 px outside f\'s label: no room for a margin');
  g.x = 400; hitMargins([g, f]);
  assert.equal(f.hit, 9, 'and plenty once it is further away');
  const hidden = pin('h', 105, 100, { off: true }), k = pin('k', 110, 100);
  hitMargins([hidden, k]);
  assert.equal(k.hit, 9, 'a pin that is off the stage is not beneath anything');
});
