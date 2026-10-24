import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PerformanceObserver, constants } from 'node:perf_hooks';
import { SAFE, settlePlaques, plaquePrice, plaqueWidth, paintPlaque, Hud } from '../../public/archipelago/preview/portfolio/world2/interactions/Career.js';
import { CAREER_TRACKS } from '../../public/archipelago/preview/portfolio/world2/content/career.js';
import { contrastRatio, TOKENS } from '../../public/archipelago/preview/portfolio/world2/signs/index.js';

/* ---- the layout of the plaques on the screen (clip space: -1..1) ---- */

const rect = (id, x0, y0, x1, y1) => ({ id, x0, y0, x1, y1, dx: 0, dy: 0 });
const by = (rows, id) => rows.find((r) => r.id === id);
const place = (r) => ({ id: r.id, x0: r.x0 + r.dx, y0: r.y0 + r.dy, x1: r.x1 + r.dx, y1: r.y1 + r.dy });
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-9, message ?? `${a} is not ${b}`);
const lapped = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 1e-9 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 1e-9;

test('a plaque that is inside the box stays where it is', () => {
  const [r] = settlePlaques([rect('a', -0.2, 0.1, 0.4, 0.3)]);
  assert.equal(r.dx, 0);
  assert.equal(r.dy, 0);
});

test('a plaque past the right edge slides back until its right edge is on the limit', () => {
  const [r] = settlePlaques([rect('a', 0.5, 0, 1.2, 0.2)]);
  near(place(r).x1, SAFE.x);
  assert.equal(r.dy, 0);
});

test('a plaque above the box comes down to the top limit, one below it comes up to the bottom limit', () => {
  const [up] = settlePlaques([rect('a', 0, 0.9, 0.4, 1.1)]);
  near(place(up).y1, SAFE.top);
  const [down] = settlePlaques([rect('b', 0, -1.3, 0.4, -1.0)]);
  near(place(down).y0, -SAFE.bottom);
});

test('a plaque wider than the box keeps its left edge, where the words begin', () => {
  const [r] = settlePlaques([rect('a', -0.5, 0, 1.9, 0.2)]);
  near(place(r).x0, -SAFE.x);
  assert.ok(place(r).x1 > SAFE.x);
});

test('two plaques that would overlap are stacked, the higher one first, with the spacing between', () => {
  const rows = settlePlaques([rect('low', 0, 0.28, 0.5, 0.48), rect('high', 0.1, 0.3, 0.6, 0.5)]);
  assert.deepEqual(rows.map((r) => r.id), ['high', 'low']);
  const [high, low] = rows.map(place);
  assert.ok(!lapped(high, low));
  near(high.y0 - low.y1, SAFE.spacing);
  assert.equal(rows[0].dy, 0, 'the one that is already highest does not move');
});

test('plaques that are not across the same stretch of the screen are left alone', () => {
  const rows = settlePlaques([rect('a', -0.9, 0.2, -0.5, 0.4), rect('b', 0.2, 0.2, 0.6, 0.4)]);
  assert.ok(rows.every((r) => r.dx === 0 && r.dy === 0));
});

test('three plaques at the same height become a staircase down, and the bottom of the box wins last', () => {
  const rows = settlePlaques([rect('a', 0, 0.2, 0.5, 0.4), rect('b', 0.05, 0.2, 0.55, 0.4), rect('c', 0.1, 0.2, 0.6, 0.4)]);
  const placed = rows.map(place);
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) assert.ok(!lapped(placed[i], placed[j]));
  // pushed to the floor of the box, the last one stays inside it
  const crowded = settlePlaques([rect('a', 0, -0.8, 0.5, -0.6), rect('b', 0, -0.8, 0.5, -0.6)]);
  assert.ok(Math.min(...crowded.map((r) => place(r).y0)) >= -SAFE.bottom - 1e-9);
});

test('the answer does not depend on the order the plaques are given in', () => {
  const make = () => [rect('a', 0, 0.5, 0.5, 0.7), rect('b', 0.1, 0.45, 0.6, 0.65), rect('c', 0.2, 0.4, 0.7, 0.6), rect('d', 0.5, 0.9, 1.4, 1.1)];
  const key = (rows) => Object.fromEntries(rows.map((r) => [r.id, [r.dx, r.dy].map((v) => +v.toFixed(9))]));
  const base = key(settlePlaques(make()));
  for (const order of [[3, 2, 1, 0], [1, 3, 0, 2], [2, 0, 3, 1]]) {
    const rows = make();
    assert.deepEqual(key(settlePlaques(order.map((i) => rows[i]))), base);
  }
});

test('settling twice moves nothing more', () => {
  const rows = settlePlaques([rect('a', 0.3, 0.7, 1.2, 0.95), rect('b', 0.5, 0.65, 1.3, 0.9)]);
  const once = rows.map((r) => [r.id, r.dx, r.dy]);
  // the caller hands in rectangles where they WOULD stand, not where they went: the same answer
  for (const r of rows) { r.dx = 0; r.dy = 0; }
  assert.deepEqual(settlePlaques(rows).map((r) => [r.id, r.dx, r.dy]), once);
});

const onKeepOut = (r, k) => Math.min(r.x1, k.x1) - Math.max(r.x0, k.x0) > 1e-9 && Math.min(r.y1, k.y1) - Math.max(r.y0, k.y0) > 1e-9;

test('a plaque on the year plate goes up off it when its middle is above the plate, down off it when below', () => {
  const plate = { x0: -0.8, y0: 0.1, x1: 0.0, y1: 0.3 };
  const [above] = settlePlaques([rect('a', -0.2, 0.25, 0.7, 0.4)], SAFE, plate);
  assert.ok(!onKeepOut(place(above), plate));
  near(place(above).y0, plate.y1 + SAFE.spacing);
  const [below] = settlePlaques([rect('b', -0.2, 0.05, 0.7, 0.2)], SAFE, plate);
  assert.ok(!onKeepOut(place(below), plate));
  near(place(below).y1, plate.y0 - SAFE.spacing);
});

test('the plate moves nothing that is not across it, and no plate at all (left > right) moves nothing', () => {
  const plate = { x0: -0.8, y0: 0.1, x1: 0.0, y1: 0.3 };
  const [far] = settlePlaques([rect('a', 0.2, 0.15, 0.9, 0.3)], SAFE, plate);
  assert.equal(far.dx, 0); assert.equal(far.dy, 0);
  const [none] = settlePlaques([rect('b', -0.2, 0.15, 0.7, 0.3)], SAFE, { x0: 2, y0: 2, x1: -2, y1: -2 });
  assert.equal(none.dy, 0);
});

test('plaques stacked over the plate end up clear of it and of each other, or as clear as the box allows', () => {
  const plate = { x0: -0.83, y0: 0.147, x1: 0.01, y1: 0.289 };
  // a phone's three plaques at the default camera, as measured: one just above the plate, two crossing it
  const rows = settlePlaques([rect('edu', -0.4, 0.42, 0.94, 0.53), rect('work', -0.13, 0.23, 0.94, 0.36), rect('proj', -0.51, 0.016, 0.94, 0.17)], SAFE, plate);
  const placed = rows.map(place);
  for (let i = 0; i < placed.length; i++) {
    assert.ok(!onKeepOut(placed[i], plate), `${placed[i].id} is on the plate`);
    assert.ok(placed[i].y1 <= SAFE.top + 1e-9 && placed[i].y0 >= -SAFE.bottom - 1e-9, `${placed[i].id} left the box`);
    for (let j = i + 1; j < placed.length; j++) assert.ok(!lapped(placed[i], placed[j]), `${placed[i].id} over ${placed[j].id}`);
  }
});

test('with no room at all it still ends: plaques never leave the box and never overlap each other', () => {
  const plate = { x0: -0.9, y0: -0.9, x1: 0.9, y1: 0.8 };
  const rows = settlePlaques([rect('a', -0.5, 0.2, 0.5, 0.5), rect('b', -0.4, 0.1, 0.6, 0.4), rect('c', -0.3, 0.0, 0.7, 0.3)], SAFE, plate);
  const placed = rows.map(place);
  for (let i = 0; i < placed.length; i++) {
    assert.ok(placed[i].y1 <= SAFE.top + 1e-9 && placed[i].y0 >= -SAFE.bottom - 1e-9);
    for (let j = i + 1; j < placed.length; j++) assert.ok(!lapped(placed[i], placed[j]));
  }
});

test('settling three plaques around the plate allocates nothing (a pass runs every frame)', async () => {
  const rows = [rect('a', 0, 0.42, 0.9, 0.53), rect('b', -0.13, 0.2, 0.94, 0.36), rect('c', -0.5, 0.0, 0.94, 0.17)];
  const plate = { x0: -0.83, y0: 0.147, x1: 0.01, y1: 0.289 };
  const minor = [];
  const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (entry.detail?.kind === constants.NODE_PERFORMANCE_GC_MINOR) minor.push(entry); });
  observer.observe({ entryTypes: ['gc'] });
  const settle = async () => { await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve)); };
  const run = async (step, ticks = 300_000) => { await settle(); minor.length = 0; for (let i = 0; i < ticks; i++) step(i); await settle(); return minor.length; };
  for (let i = 0; i < 30_000; i++) settlePlaques(rows, SAFE, plate);
  const clean = await run(() => settlePlaques(rows, SAFE, plate));
  // control: the detector must see an allocating step, or "zero" proves nothing
  const control = await run((i) => { settlePlaques(rows, SAFE, plate); new Array(256 + (i & 1)).fill(0); }, 100_000);
  observer.disconnect();
  assert.ok(control >= 5, `the allocation detector saw only ${control} scavenges for a ~200 MB control`);
  assert.ok(clean <= 1, `${clean} scavenges over 300k settles`);
});

/* ---- the car, the touch buttons and the other places no plaque stands ---- */

const keep = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
const clear = (r, k) => !onKeepOut(place(r), k);
const inside = (p, safe = SAFE) => p.x0 >= -safe.x - 1e-9 && p.y0 >= -safe.bottom - 1e-9 && p.y1 <= safe.top + 1e-9;

test('the car is a place plaques keep off: one over it goes up off it or down off it, whichever is nearer', () => {
  const car = keep(-0.2, -0.2, 0.2, 0.2);
  const [high] = settlePlaques([rect('a', -0.5, 0.1, 0.5, 0.25)], SAFE, car);
  assert.ok(clear(high, car));
  near(place(high).y0, car.y1 + SAFE.spacing);
  assert.equal(high.dx, 0, 'a wide plaque climbs over the car: stepping aside would be a metre');
  const [low] = settlePlaques([rect('b', -0.5, -0.25, 0.5, -0.1)], SAFE, car);
  assert.ok(clear(low, car));
  near(place(low).y1, car.y0 - SAFE.spacing);
});

test('a keep-out can be given as a list, and every one of them is kept off', () => {
  const list = [keep(-0.9, 0.0, -0.3, 0.2), keep(-0.2, -0.2, 0.2, 0.2), keep(0.5, -0.4, 0.95, 0.4)];
  const rows = settlePlaques([rect('edu', -0.6, 0.3, 0.6, 0.42), rect('work', -0.5, 0.05, 0.7, 0.17), rect('proj', -0.4, -0.2, 0.8, -0.08)], SAFE, list);
  const placed = rows.map(place);
  for (let i = 0; i < placed.length; i++) {
    for (const k of list) assert.ok(!onKeepOut(placed[i], k), `${placed[i].id} is on a keep-out`);
    assert.ok(inside(placed[i]), `${placed[i].id} left the box`);
    for (let j = i + 1; j < placed.length; j++) assert.ok(!lapped(placed[i], placed[j]), `${placed[i].id} over ${placed[j].id}`);
  }
});

test('a column of buttons at the screen edge is stepped away from sideways when that is the short way', () => {
  const buttons = keep(0.6, -0.4, 0.95, 0.4);
  const [r] = settlePlaques([rect('a', -0.2, 0.0, 0.9, 0.15)], SAFE, [buttons]);
  assert.ok(clear(r, buttons));
  assert.equal(r.dy, 0, 'it did not move up or down');
  near(place(r).x1, buttons.x0, 'its right edge is on the buttons\' left edge');
});

test('a plaque that is only just on the car steps aside sideways, on a wide screen and on a square one alike', () => {
  const car = keep(0.0, -0.3, 0.3, 0.3);
  const narrow = () => rect('a', 0.25, -0.1, 0.45, 0.0);
  const [wide] = settlePlaques([narrow()], { ...SAFE, aspect: 2 }, car);
  assert.ok(clear(wide, car)); assert.equal(wide.dy, 0); near(place(wide).x0, car.x1);
  // the same rectangle on a screen as tall as it is wide: 5 cm sideways is still cheaper than 40 up
  const [square] = settlePlaques([narrow()], { ...SAFE, aspect: 1 }, car);
  assert.ok(clear(square, car)); assert.equal(square.dy, 0);
});

test('plaques give way to each other only up and down: the three lanes stay a stack', () => {
  const rows = settlePlaques([rect('a', 0, 0.2, 0.3, 0.3), rect('b', 0.05, 0.22, 0.35, 0.32), rect('c', 0.1, 0.24, 0.4, 0.34)], { ...SAFE, aspect: 3 });
  assert.ok(rows.every((r) => r.dx === 0), `moved sideways: ${rows.map((r) => r.dx).join(', ')}`);
  const placed = rows.map(place);
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) assert.ok(!lapped(placed[i], placed[j]));
});

test('lanes that are all above the top of the picture keep their order: the highest stone stays the highest plaque', () => {
  const rows = settlePlaques([rect('work', 0, 1.0, 0.8, 1.15), rect('edu', 0, 1.1, 0.8, 1.25), rect('proj', 0, 0.9, 0.8, 1.05)]);
  assert.deepEqual(rows.map((r) => r.id), ['edu', 'work', 'proj']);
  const [edu, work, proj] = rows.map(place);
  near(edu.y1, SAFE.top);
  assert.ok(work.y1 < edu.y0 && proj.y1 < work.y0);
});

test('an arrangement as good as the last frame\'s is kept: a plaque stays on the side of the car it was on, unless the other is much nearer', () => {
  const car = keep(-0.2, -0.2, 0.2, 0.2);
  const wide = () => ({ ...rect('a', -0.5, 0.0, 0.5, 0.1) });
  // nothing to go on: the nearer side, over the car (0.22 up against 0.32 down)
  const [fresh] = settlePlaques([wide()], SAFE, car);
  near(place(fresh).y0, car.y1 + SAFE.spacing);
  // it was sent below last frame: over would be 0.22 away from where it wants, but 0.54 away from where it was, and that is dearer
  const [kept] = settlePlaques([{ ...wide(), pdx: 0, pdy: -0.32 }], SAFE, car);
  near(place(kept).y1, car.y0 - SAFE.spacing);
  // NaN means no last frame at all
  const [none] = settlePlaques([{ ...wide(), pdx: NaN, pdy: NaN }], SAFE, car);
  near(place(none).y0, car.y1 + SAFE.spacing);
  // but when staying is far worse (the other side is a whole screen nearer) it moves
  const far = rect('b', -0.5, 0.15, 0.5, 0.25);
  const [moved] = settlePlaques([{ ...far, pdx: 0, pdy: -0.9 }], SAFE, car);
  near(place(moved).y0, car.y1 + SAFE.spacing);
});

test('at the very edge a plaque that was moved off the car does not swap back for a hair: it stays where it stands, and returns only when that is worth the move', () => {
  const car = keep(-0.2, -0.2, 0.2, 0.2);
  const edge = (y0) => rect('a', -0.5, y0, 0.5, y0 + 0.1);
  // 5 mm clear of the car (and its spacing): where it wants to stand is clear, so a fresh plaque stays
  const [fresh] = settlePlaques([edge(0.2 + SAFE.spacing + 0.005)], SAFE, car);
  assert.equal(fresh.dy, 0);
  // but one that was sent 0.3 away last frame stays where it stands (it is clear): the way back is not worth a change of mind for so little
  const [held] = settlePlaques([{ ...edge(0.2 + SAFE.spacing + 0.005), pdx: 0, pdy: 0.3 }], SAFE, car);
  near(held.dy, 0.3, 'it stays');
  // a place that is no longer clear is left, to the nearest that is: flush against the car
  const [pushed] = settlePlaques([{ ...edge(0.2 + SAFE.spacing + 0.005), pdx: 0, pdy: -0.2 }], SAFE, car);
  near(place(pushed).y0, car.y1 + SAFE.spacing, 'flush against the car, the nearest place that clears it by the spacing');
  // and 0.6 away is far enough for the way back to be worth it, with 5 cm to spare: it goes back
  const [back] = settlePlaques([{ ...edge(0.2 + SAFE.spacing + 0.05), pdx: 0, pdy: 0.6 }], SAFE, car);
  assert.ok(Math.abs(back.dy) < 0.03, `moved ${back.dy}`);
});

test('a place that only just fits is not swapped for the one beside it every frame: a change of mind needs the box to clear by a margin', () => {
  // as measured on a phone on its side: the plaque is pressed against the top of the box, and the room between the car and the top is
  // the plaque's own height to within a millimetre, so a hair of movement decides whether it fits over the car or must stand beside it
  const box = { x: 0.94, top: 0.641, bottom: 0.9, spacing: 0.02, aspect: 2.16 };
  const car = keep(-0.159, -0.391, 0.159, 0.342);
  const [h, y0] = [0.2778, 0.696];
  const plaque = (extra) => ({ ...rect('kcl', -0.09, y0, 0.402, y0 + h), ...extra });
  const [fresh] = settlePlaques([plaque({})], box, car);
  assert.equal(fresh.dx, 0, 'with nothing to go on it takes the nearest: over the car');
  // it was beside the car last frame: it stays there while over the car only just fits
  const [beside] = settlePlaques([plaque({ pdx: 0.249, pdy: -0.333 })], box, car);
  assert.ok(beside.dx > 0.2, `moved ${beside.dx} sideways: it should have stayed beside the car`);
  // it was over the car last frame: it stays there
  const [over] = settlePlaques([plaque({ pdx: 0, pdy: -0.334 })], box, car);
  assert.equal(over.dx, 0);
  // when the car is three centimetres lower there is room to spare (more than the margin), and it goes back over it
  const lower = keep(-0.159, -0.391, 0.159, 0.31);
  const [back] = settlePlaques([plaque({ pdx: 0.249, pdy: -0.333 })], box, lower);
  assert.equal(back.dx, 0);
});

/* ---- a plaque that stands somewhere that is still a place stays there (the layout keeps first, and moves nobody for a better place) ---- */

test('a plaque that stood somewhere clear is kept, and the plaque that comes after it goes round it: the arrangement that is showing is not swapped for another', () => {
  const car = keep(-0.2, -0.2, 0.2, 0.2);
  const box = { ...SAFE, top: 0.45, aspect: 2 };
  // two stones side by side, their natural places on top of each other. Last frame the higher plaque stood over the car, and the lower one beside it.
  const make = (high, low) => [{ ...rect('high', -0.45, 0.28, 0.45, 0.4), ...high }, { ...rect('low', -0.4, 0.22, 0.2, 0.34), ...low }];
  const kept = settlePlaques(make({ pdx: 0, pdy: 0 }, { pdx: 0.6, pdy: -0.1 }), box, car);
  near(by(kept, 'high').dx, 0); near(by(kept, 'high').dy, 0);
  near(by(kept, 'low').dx, 0.6); near(by(kept, 'low').dy, -0.1);
  // a plaque that came last frame (no history) goes round the ones that stand, and none of them is moved for it
  const arrived = settlePlaques(make({ pdx: 0, pdy: 0 }, { pdx: NaN, pdy: NaN }), box, car);
  near(by(arrived, 'high').dx, 0); near(by(arrived, 'high').dy, 0);
  assert.ok(!lapped(place(by(arrived, 'low')), place(by(arrived, 'high'))) && clear(by(arrived, 'low'), car), 'and the one that arrived stands clear of them');
  // the other way round: the lower one stood and the higher one arrived
  const other = settlePlaques(make({ pdx: NaN, pdy: NaN }, { pdx: 0.6, pdy: -0.1 }), box, car);
  near(by(other, 'low').dx, 0.6); near(by(other, 'low').dy, -0.1);
  assert.ok(!lapped(place(by(other, 'low')), place(by(other, 'high'))) && clear(by(other, 'high'), car));
});

test('a plaque that stands where it is worse off than it could be goes to the better place only if that place is clear of the others where they stand', () => {
  const car = keep(-0.2, -0.2, 0.2, 0.2);
  const box = { ...SAFE, aspect: 2 };
  const a = (extra = {}) => ({ ...rect('a', -0.5, 0.0, 0.5, 0.1), pdx: 0, pdy: 0.7, ...extra });
  // alone, and 0.7 above where it wants to be (over the car's top is a clear place much nearer): the way back is worth it
  const [alone] = settlePlaques([a()], box, car);
  assert.ok(alone.dy < 0.4, `${alone.dy.toFixed(3)}: it goes back towards its stone`);
  // with another plaque standing in the place it would go back to, it stays: nobody is moved for it
  const other = { ...rect('b', -0.5, 0.21, 0.5, 0.31), pdx: 0, pdy: 0 };
  const rows = settlePlaques([a(), other], box, car);
  near(by(rows, 'a').dy, 0.7); near(by(rows, 'b').dy, 0);
});

test('a place that is a few thousandths short of clear is still a place: the plaque moves by that much, and does not cross the screen', () => {
  // as measured on a phone on its side: the car on one side and the page's buttons on the other leave a plaque 6 thousandths of the screen less room than it is wide
  const box = { x: 0.94, top: 0.641, bottom: 0.9, spacing: 0.02, aspect: 2.164 };
  const car = keep(-0.1738, -0.3868, 0.1735, 0.3468);
  const buttons = { ...keep(0.763, -0.5282, 0.9858, 0.4462), hard: true };
  const plaque = (extra) => ({ ...rect('chess', 0.2593, 0.0017, 0.8542, 0.2789), ax: 0.2151, ay: 0.1403, reach: 0.52, rank: 22, ...extra });
  const [stood] = settlePlaques([plaque({ pdx: -0.0793, pdy: -0.592 })], box, [car, buttons]);
  assert.ok(Math.hypot((stood.dx + 0.0793) * box.aspect, stood.dy + 0.592) < 0.06, `it stayed below the car, beside the buttons: moved (${(stood.dx + 0.0793).toFixed(3)}, ${(stood.dy + 0.592).toFixed(3)})`);
  const [fresh] = settlePlaques([plaque({})], box, [car, buttons]);
  assert.ok(Math.abs(fresh.dy + 0.592) > 0.3, 'control: a plaque with no history, for whom it is not a place, goes over the car');
});

test('a plaque pressed against the top of the box stays against it while its stone rises, rather than being a hair over the limit and so no place at all', () => {
  const box = { x: 0.94, top: 0.641, bottom: 0.9, spacing: 0.02, aspect: 2 };
  const car = keep(-0.2, -0.4, 0.2, 0.3);
  const high = (y0) => ({ ...rect('kcl', -0.1, y0, 0.4, y0 + 0.28), ax: -0.12, ay: y0 + 0.14, reach: 0.52, rank: 20, pdx: 0, pdy: 0.641 - 0.28 - y0 })
  const [still] = settlePlaques([high(0.69)], box, car);
  near(place(still).y1, box.top);
  // its stone has risen 6 thousandths since the frame its offset was taken in
  const [rose] = settlePlaques([{ ...high(0.696), pdy: 0.641 - 0.28 - 0.69 }], box, car);
  near(place(rose).y1, box.top);
  near(rose.dy, 0.641 - 0.28 - 0.696);
});

test('what it did last frame never beats a clear place: a plaque that would now stand on something leaves', () => {
  const car = keep(-0.2, -0.2, 0.2, 0.2);
  const [r] = settlePlaques([{ ...rect('a', -0.5, -0.1, 0.5, 0.0), pdx: 0, pdy: 0 }], SAFE, car);
  assert.ok(clear(r, car));
});

test('the box is the limit: a plaque is never put outside it to get off a keep-out', () => {
  const box = { x: 0.9, top: 0.5, bottom: 0.5, spacing: 0.02, aspect: 1 };
  // a keep-out across the whole width and the middle of the box: above it and below it are the only ways round, and one of them is shut
  const rows = settlePlaques([rect('a', -0.3, -0.05, 0.3, 0.05)], box, [keep(-1, -0.45, 1, 0.1)]);
  const [r] = rows.map(place);
  assert.ok(inside(r, box), `${JSON.stringify(r)}`);
  assert.ok(r.y0 >= 0.1 + box.spacing - 1e-9, 'it went over the keep-out, the only way that is inside the box');
});

test('with keep-outs on every side and no room it still ends: inside the box, plaques apart, overlapping the keep-outs as little as it can', () => {
  const list = [keep(-0.95, -0.9, 0.95, 0.8), keep(-0.2, -0.2, 0.2, 0.2), keep(0.5, -0.4, 0.95, 0.4)];
  const rows = settlePlaques([rect('a', -0.5, 0.2, 0.5, 0.5), rect('b', -0.4, 0.1, 0.6, 0.4), rect('c', -0.3, 0.0, 0.7, 0.3)], { ...SAFE, aspect: 1.8 }, list);
  const placed = rows.map(place);
  for (let i = 0; i < placed.length; i++) {
    assert.ok(inside(placed[i]));
    for (let j = i + 1; j < placed.length; j++) assert.ok(!lapped(placed[i], placed[j]));
  }
});

test('property: on any scene with room, plaques end up inside the box, apart, and (nearly always) off every keep-out; and the answer is the same twice', () => {
  let seed = 20261015;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const between = (a, b) => a + (b - a) * random();
  let scenes = 0, onSomething = 0, moved = 0;
  for (let n = 0; n < 4000; n++) {
    const aspect = between(0.4, 2.4);
    const safe = { x: 0.94, top: between(0.55, 0.8), bottom: 0.9, spacing: 0.02, aspect };
    const count = 2 + Math.floor(random() * 2);
    const rows = [];
    for (let i = 0; i < count; i++) {
      const w = between(0.3, 1.3), h = between(0.08, 0.2), x0 = between(-0.95, 0.8), y0 = between(-0.9, 0.7);
      rows.push(rect(`p${i}`, x0, y0, x0 + w, y0 + h));
    }
    const list = [];
    for (let i = 0; i < 3; i++) { const w = between(0.1, 0.5), h = between(0.1, 0.6), x0 = between(-0.9, 0.8), y0 = between(-0.8, 0.5); list.push(keep(x0, y0, x0 + w, y0 + h)); }
    scenes++;
    const out = settlePlaques(rows, safe, list);
    const placed = out.map(place);
    for (let i = 0; i < placed.length; i++) {
      assert.ok(placed[i].x0 >= -safe.x - 1e-9 && placed[i].y0 >= -safe.bottom - 1e-9 && placed[i].y1 <= safe.top + 1e-9, `scene ${n}: ${placed[i].id} left the box`);
      for (let j = i + 1; j < placed.length; j++) assert.ok(!lapped(placed[i], placed[j]), `scene ${n}: ${placed[i].id} over ${placed[j].id}`);
      if (list.some((k) => onKeepOut(placed[i], k))) onSomething++;
    }
    if (out.some((r) => r.dx !== 0 || r.dy !== 0)) moved++;
    const once = out.map((r) => [r.id, r.dx, r.dy]);
    for (const r of out) { r.dx = 0; r.dy = 0; }
    assert.deepEqual(settlePlaques(out, safe, list).map((r) => [r.id, r.dx, r.dy]), once, `scene ${n}: not the same twice`);
  }
  assert.ok(moved > scenes * 0.3, 'the scenes should make the solver work');
  assert.ok(onSomething < scenes * 0.04, `${onSomething} plaques of ${scenes * 2.5} were left on a keep-out although there was room`);
});

test('a phone held upright, as measured: the third plaque has no room last, so the others make it (every order is tried)', () => {
  // 390x844 at the default camera, the car on the work overlap: the nearest clear place for each, highest first, leaves the
  // projects plaque no place that is not on the touch buttons; with it placed first, the other two fit above the car.
  const wanted = [
    ['kcl', -0.0806, 0.4168, 1.0704, 0.5553], ['pansofia', 0.3169, 0.2246, 1.5374, 0.3688], ['project-chess-assistant', 0.7437, 0.018, 2.255, 0.1684],
  ];
  const keepOuts = [keep(-0.8569, 0.1229, 0.0469, 0.3054), keep(-0.4732, -0.2157, 0.4732, 0.2915), keep(0.4872, -0.782, 0.9692, -0.2986), keep(-0.9641, -0.9597, -0.4582, -0.8009)];
  const safe = { x: 0.94, top: 0.8483, bottom: 0.9, spacing: 0.02, aspect: 0.462 };
  const rows = settlePlaques(wanted.map(([id, x0, y0, x1, y1]) => rect(id, x0, y0, x1, y1)), safe, keepOuts);
  const placed = rows.map(place);
  for (let i = 0; i < placed.length; i++) {
    for (const k of keepOuts) assert.ok(!onKeepOut(placed[i], k), `${placed[i].id} is on a keep-out`);
    assert.ok(inside(placed[i], safe), `${placed[i].id} left the box`);
    for (let j = i + 1; j < placed.length; j++) assert.ok(!lapped(placed[i], placed[j]), `${placed[i].id} over ${placed[j].id}`);
  }
});

test('trying every order allocates nothing either, on a scene that has no clear place at all', async () => {
  const rows = [rect('a', -0.5, 0.2, 0.5, 0.5), rect('b', -0.4, 0.1, 0.6, 0.4), rect('c', -0.3, 0.0, 0.7, 0.3)];
  const list = [keep(-0.95, -0.9, 0.95, 0.8), keep(-0.2, -0.2, 0.2, 0.2)];
  const minor = [];
  const observer = new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.detail?.kind === constants.NODE_PERFORMANCE_GC_MINOR) minor.push(e); });
  observer.observe({ entryTypes: ['gc'] });
  const settle = async () => { await new Promise((resolve) => setImmediate(resolve)); await new Promise((resolve) => setImmediate(resolve)); };
  for (let i = 0; i < 20_000; i++) settlePlaques(rows, SAFE, list);
  await settle(); minor.length = 0;
  const t0 = performance.now();
  for (let i = 0; i < 100_000; i++) settlePlaques(rows, SAFE, list);
  const micro = ((performance.now() - t0) * 1000) / 100_000;
  await settle();
  observer.disconnect();
  assert.ok(minor.length <= 1, `${minor.length} scavenges over 100k settles`);
  assert.ok(micro < 150, `${micro.toFixed(1)} microseconds a settle`);
});

// (settling three plaques around three keep-outs, and with a history, allocates nothing either, and takes microseconds: career-settle-alloc.test.mjs, a process of its own,
// since this file has put the layout through every shape of rectangle and every scene by now, which is no pass of the controller's)

/* ---- the page's own controls, read about four times a second ---- */

function page({ canvas = { left: 0, top: 0, width: 844, height: 390 }, bar = { left: 413, top: 20, right: 820, bottom: 60, width: 407, height: 40 }, buttons = { left: 752, top: 116, right: 830, bottom: 290, width: 78, height: 174 }, speed = { left: 15, top: 314, right: 98, bottom: 365, width: 83, height: 51 } } = {}) {
  const calls = { n: 0 };
  const box = (r) => (r ? { ...r, right: r.right ?? r.left + r.width, bottom: r.bottom ?? r.top + r.height } : null);
  const els = { world: canvas, 'player-nav': bar, 'touch-controls': buttons, 'drive-hud': speed };
  const document = { createElement: globalThis.document.createElement, getElementById: (id) => (els[id] === undefined ? null : { getBoundingClientRect: () => { calls.n++; return box(els[id]) ?? { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; } }) };
  return { document, els, calls };
}
const withPage = (p, size, body) => {
  const keepDocument = globalThis.document, keepW = globalThis.innerWidth, keepH = globalThis.innerHeight;
  globalThis.document = p.document; globalThis.innerWidth = size[0]; globalThis.innerHeight = size[1];
  try { return body(); } finally { globalThis.document = keepDocument; globalThis.innerWidth = keepW; globalThis.innerHeight = keepH; }
};

test('the HUD reads the top bar and the touch buttons off the page, as a landscape phone shows them', () => {
  const p = page();
  withPage(p, [844, 390], () => {
    const hud = new Hud();
    hud.measure();
    assert.equal(hud.width, 844); assert.equal(hud.height, 390);
    assert.equal(hud.top, 60, 'down to the bottom of the top bar');
    // the column of buttons, 8 px of air, in clip space (x right, y up)
    near(hud.touch.x0, ((752 - 8) / 844) * 2 - 1); near(hud.touch.x1, ((830 + 8) / 844) * 2 - 1);
    near(hud.touch.y1, 1 - ((116 - 8) / 390) * 2); near(hud.touch.y0, 1 - ((290 + 8) / 390) * 2);
    assert.ok(hud.touch.x0 < hud.touch.x1 && hud.touch.y0 < hud.touch.y1);
    // and the speed readout in the corner
    near(hud.speed.x0, ((15 - 8) / 844) * 2 - 1); near(hud.speed.y0, 1 - ((365 + 8) / 390) * 2);
    assert.ok(hud.speed.x0 < hud.speed.x1 && hud.speed.y0 < hud.speed.y1);
  });
});

test('the HUD has no buttons to keep off while they are hidden, and no bar where the page has none (/world2)', () => {
  const hidden = page({ buttons: { left: 0, top: 0, width: 0, height: 0 } });
  withPage(hidden, [844, 390], () => { const hud = new Hud(); hud.measure(); assert.ok(!(hud.touch.x0 < hud.touch.x1), 'no keep-out'); });
  const bare = page();
  delete bare.els['player-nav']; delete bare.els['touch-controls']; delete bare.els['drive-hud']; delete bare.els.world;
  withPage(bare, [1280, 720], () => {
    const hud = new Hud(); hud.measure();
    assert.equal(hud.top, 0); assert.equal(hud.width, 1280); assert.equal(hud.height, 720);
    assert.ok(!(hud.touch.x0 < hud.touch.x1)); assert.ok(!(hud.speed.x0 < hud.speed.x1));
  });
});

test('the HUD reads the page four times a second at most, and at once when the window changes size', () => {
  const p = page();
  withPage(p, [844, 390], () => {
    const hud = new Hud();
    hud.measure();
    const first = p.calls.n;
    assert.ok(first >= 3 && first <= 4, `${first} reads for one measure`); // the canvas, the top bar, the buttons, the speed readout
    for (let i = 0; i < 1000; i++) hud.measure();
    assert.equal(p.calls.n, first, 'a frame that follows another reads nothing');
    globalThis.innerWidth = 932; globalThis.innerHeight = 430;
    p.els.world = { left: 0, top: 0, width: 932, height: 430 };
    hud.measure();
    assert.ok(p.calls.n > first, 'a resize is read at once');
    assert.equal(hud.width, 932);
  });
});

/* ---- the plaque itself, painted on a recording context ---- */

/** A 2D context that records the text it is asked to draw and measures it at a fixed fraction of the em. */
function fake() {
  const texts = [];
  const target = {
    font: '10px sans-serif',
    measureText(text) {
      const px = parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)[1]);
      return { width: text.length * px * (/^[789]00 /.test(this.font) ? 0.62 : 0.56) };
    },
    fillText(text, x, y) { texts.push({ text, x, y, font: this.font, align: this.textAlign }); },
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
  };
  const context = new Proxy(target, {
    get: (t, key) => (key in t ? t[key] : () => {}),
    set: (t, key, value) => { t[key] = value; return true; },
  });
  return { context, texts };
}
globalThis.document = { createElement: () => ({ getContext: () => fake().context }) };

const BEVEL = 0.02, DPM = 280, HEIGHT = 0.91;
const stops = CAREER_TRACKS.flatMap((track) => track.stops.map((stop) => ({ stop, track })));

test('there are nine real stops, and every plaque is between 1.9 and 4.4 m wide', () => {
  assert.equal(stops.length, 9);
  for (const { stop } of stops) {
    const width = plaqueWidth(stop);
    assert.ok(width >= 1.9 && width <= 4.4, `${stop.id}: ${width} m`);
  }
});

test('every stop is painted whole: both lines drawn inside the paper, nothing cut with an ellipsis', () => {
  for (const { stop, track } of stops) {
    const { context, texts } = fake();
    const width = Math.round((plaqueWidth(stop) - BEVEL * 2) * DPM), height = Math.round((HEIGHT - BEVEL * 2) * DPM);
    paintPlaque(context, { x: 0, y: 0, w: width, h: height }, 'sans-serif', stop, track);
    assert.equal(texts.length, 2, `${stop.id}: ${texts.length} lines`);
    assert.equal(texts[0].text, stop.headline.toUpperCase());
    assert.equal(texts[1].text, stop.subtitle);
    for (const line of texts) {
      assert.ok(!line.text.includes('…'), `${stop.id}: "${line.text}" was cut`);
      context.font = line.font;
      const end = line.x + context.measureText(line.text).width;
      assert.ok(line.x > height * 0.6, `${stop.id}: "${line.text}" starts over the lane band (${line.x})`);
      assert.ok(end < width - height * 0.075, `${stop.id}: "${line.text}" runs into the frame (${end} of ${width})`);
    }
    // the headline is the larger of the two
    const px = (line) => parseFloat(/(\d+(?:\.\d+)?)px/.exec(line.font)[1]);
    assert.ok(px(texts[0]) > px(texts[1]));
  }
});

test('ink is legible on every lane colour (4.5:1: the picture is a graphic, but the type sits on paper, which is 12:1)', () => {
  for (const track of CAREER_TRACKS) {
    const ratio = contrastRatio(TOKENS.ink, track.colour);
    assert.ok(ratio >= 4.5, `${track.id}: ink on ${track.colour} is ${ratio.toFixed(2)}:1`);
  }
  assert.ok(contrastRatio(TOKENS.ink, TOKENS.paper) >= 10);
  assert.ok(contrastRatio(TOKENS.ink2, TOKENS.paper) >= 7);
});

/* ---- what the controller must not do again ---- */

test('the controller builds its labels as billboards of the kit, not as flat planes aimed at a pose', () => {
  const source = fs.readFileSync(new URL('../../public/archipelago/preview/portfolio/world2/interactions/Career.js', import.meta.url), 'utf8');
  assert.ok(/from '\.\/Billboards\.js'/.test(source));
  assert.ok(/from '\.\.\/signs\/index\.js'/.test(source));
  assert.ok(!/\.lookAt\(/.test(source), 'lookAt aims at the car, in the wrong frame');
  assert.ok(!/rotateX\(/.test(source), 'a label lying flat reads sideways from any other yaw');
  // the authored label pose survives only as what a label does with no camera to turn it (the editor's previews, /world2)
  assert.ok(/pivot\.quaternion\.copy\(fallback\)/.test(source));
  assert.ok(/mode: 'spherical'/.test(source), 'text is only ever a spherical billboard');
  assert.ok(/LABEL_DPM = 280/.test(source) && /LABEL_ANISOTROPY = 4/.test(source));
});

test('the layout reads the page only through the throttled Hud, and sizes plaques for short screens and keeps off the car, the plate, the buttons and the speed readout', () => {
  const source = fs.readFileSync(new URL('../../public/archipelago/preview/portfolio/world2/interactions/Career.js', import.meta.url), 'utf8');
  const layout = /layoutPlaques\(camera, delta, design\) \{[\s\S]*?\n    \}\n/.exec(source)?.[0] ?? '';
  assert.ok(layout.length > 500, 'found layoutPlaques');
  assert.ok(!/getBoundingClientRect|getElementById|querySelector|innerWidth|innerHeight/.test(layout), 'layoutPlaques never reads the DOM itself');
  assert.ok(/MIN_SUB_PX = 12/.test(source) && /FIT_MAX = /.test(source), 'the subtitle floor');
  assert.ok(/this\.keepOuts = \[this\.keepPlate, this\.keepCar, this\.hud\.touch, this\.hud\.speed\]/.test(source), 'the plate, the car, the touch buttons and the speed readout are the keep-outs');
  assert.ok(/this\.clearCar\(/.test(layout) && /this\.solve\(safe, true\)/.test(layout) && /settlePlaques\(work, safe, speakers \? this\.keepOuts : this\.keepPinned, n, keeping\)/.test(source), 'the plaques that speak are laid out with the plate, the car and the buttons kept off');
  assert.ok(/if \(line\.wants\) \{/.test(layout) && /\}\s*else\s*this\.stand\(line\)/.test(layout), 'a plaque that is only wiping away is not laid out again (only one that wants to speak is: speaking, or looking for a place)');
  assert.ok(/HUD_POLL_MS = 250/.test(source));
  // the car and the plate are also holes in every plaque, for what the layout cannot move (a plaque that is wiping away)
  assert.ok(/uniform vec4 uCar;/.test(source) && /uCar: this\.carRect/.test(source) && /max\(across\.x \* across\.y, over\.x \* over\.y\)/.test(source), 'the car is a hole in the plaque shader, as the plate is');
});


/* ---- a plaque stands within reach of its stone, or gives way ---- */

// a stone's anchor, how far from it the plaque's nearest edge may stand (clip units of y; a unit of x is `aspect` times as far on the screen), and what giving it up costs
const stoned = (id, x0, y0, x1, y1, ax, ay, reach, rank) => ({ ...rect(id, x0, y0, x1, y1), ax, ay, reach, rank });
/** how far the plaque's nearest edge is from the anchor, on the screen, in clip units of y */
const gapOf = (r, aspect = 1) => { const p = place(r); return Math.hypot(Math.max(p.x0 - r.ax, 0, r.ax - p.x1) * aspect, Math.max(p.y0 - r.ay, 0, r.ay - p.y1)); };
const CAR = { x0: -0.4, y0: -0.3, x1: 0.4, y1: 0.3 };

test('a plaque with room beside its stone is where it wants to be, however far it is allowed to go', () => {
  const [r] = settlePlaques([stoned('a', 0.2, 0.5, 0.9, 0.6, 0.15, 0.55, 0.4, 50)], SAFE, CAR);
  assert.equal(r.out, false);
  assert.equal(r.dx, 0);
  assert.equal(r.dy, 0);
});

test('a plaque the car is on goes to the nearest clear place, and that place is within reach of its stone', () => {
  const [r] = settlePlaques([stoned('a', -0.3, -0.05, 0.4, 0.05, -0.35, 0, 0.5, 50)], SAFE, CAR);
  assert.equal(r.out, false);
  assert.ok(!onKeepOut(place(r), CAR), 'off the car');
  assert.ok(gapOf(r) <= 0.5 + 1e-9, `${gapOf(r)}`);
});

test('a plaque that has no clear place within reach of its stone does not stand in a far one: it is given up', () => {
  // the car fills the middle of the box, the stone is under it: the nearest clear place is 0.45 away and it may go 0.3
  const car = { x0: -0.94, y0: -0.4, x1: 0.94, y1: 0.4 };
  const [r] = settlePlaques([stoned('a', -0.3, -0.05, 0.4, 0.05, -0.35, 0, 0.3, 50)], SAFE, car);
  assert.equal(r.out, true);
  assert.equal(r.dx, 0);
  assert.equal(r.dy, 0);
  // control: the same plaque with no reach is put at that far place, as the layout always did
  const [far] = settlePlaques([rect('a', -0.3, -0.05, 0.4, 0.05)], SAFE, car);
  assert.notEqual(far.out, true);
  assert.ok(!onKeepOut(place(far), car));
  const [free] = settlePlaques([stoned('a', -0.3, -0.05, 0.4, 0.05, -0.35, 0, 0.3, undefined)], SAFE, car);
  assert.notEqual(free.out, true, 'with no price it is always placed');
});

test('the reach is measured on the screen: a unit across is `aspect` times a unit up', () => {
  // a wall fills the box to its right of the anchor's left, so the only clear place is just right of it, 0.25 across from the anchor
  const wall = { x0: -0.94, y0: -0.9, x1: 0.25, y1: 0.8 };
  const make = () => stoned('a', 0.02, -0.05, 0.3, 0.05, 0, 0, 0.3, plaquePrice(0.028, 0.02));
  const [one] = settlePlaques([make()], { ...SAFE, aspect: 1 }, wall);
  assert.equal(one.out, false, '0.25 across is within a reach of 0.3 on a screen as wide as high');
  near(gapOf(one, 1), 0.25);
  const [two] = settlePlaques([make()], { ...SAFE, aspect: 2 }, wall);
  assert.equal(two.out, true, 'but 0.5 on a screen twice as wide as it is high');
});

test('where two plaques would stand on each other the one with the lower price gives way, whatever the order they are given in', () => {
  // both want the same place; they are too wide to stand side by side, and the box has nothing else within reach of either stone (a floor and a ceiling)
  const make = () => [stoned('dear', -0.5, 0.3, 0.7, 0.4, -0.05, 0.35, 0.35, 90), stoned('cheap', -0.45, 0.31, 0.75, 0.41, -0.05, 0.36, 0.35, 40)];
  const floor = { x0: -0.94, y0: 0.0, x1: 0.94, y1: 0.26 };
  const ceiling = { x0: -0.94, y0: 0.5, x1: 0.94, y1: 0.8 };
  for (const order of [[0, 1], [1, 0]]) {
    const rows = make(); const list = order.map((i) => rows[i]);
    const out = settlePlaques(list, SAFE, [floor, ceiling]);
    const byId = Object.fromEntries(out.map((r) => [r.id, r]));
    assert.equal(byId.dear.out, false, 'the dearer plaque speaks');
    assert.equal(byId.cheap.out, true, 'the cheaper one gives way');
    assert.equal(byId.dear.dx, 0);
    assert.equal(byId.dear.dy, 0);
  }
  // control: with no prices both are placed, one on the other
  const [a, b] = settlePlaques([{ ...stoned('a', -0.5, 0.3, 0.7, 0.4, -0.05, 0.35, 0.35, undefined) }, { ...stoned('b', -0.45, 0.31, 0.75, 0.41, -0.05, 0.36, 0.35, undefined) }], SAFE, [floor, ceiling]);
  assert.ok(a.out !== true && b.out !== true);
});

test('a plaque that is given up is not in the way of the others', () => {
  const car = { x0: -0.94, y0: -0.4, x1: 0.94, y1: 0.4 };
  const rows = settlePlaques([stoned('lost', -0.3, -0.05, 0.4, 0.05, -0.35, 0, 0.2, 50), stoned('kept', -0.3, 0.5, 0.4, 0.6, -0.35, 0.55, 0.3, 50)], SAFE, car);
  const [lost, kept] = ['lost', 'kept'].map((id) => rows.find((r) => r.id === id));
  assert.equal(lost.out, true);
  assert.equal(kept.out, false);
  assert.equal(kept.dy, 0);
});

test('no place within reach is ever further than the reach, over every pose a plaque is put in', () => {
  const car = { x0: -0.35, y0: -0.2, x1: 0.35, y1: 0.2 };
  let placed = 0, given = 0;
  for (let ax = -1; ax <= 1; ax += 0.2) for (let ay = -1; ay <= 1; ay += 0.2) for (const reach of [0.2, 0.4, 0.6]) for (const aspect of [0.5, 1, 2]) {
    const [r] = settlePlaques([stoned('a', ax + 0.05, ay - 0.05, ax + 0.75, ay + 0.05, ax, ay, reach, 50)], { ...SAFE, aspect }, car);
    if (r.out) { given++; continue; }
    placed++;
    assert.ok(gapOf(r, aspect) <= reach + 1e-9, `${ax} ${ay} reach ${reach} aspect ${aspect}: ${gapOf(r, aspect)}`);
  }
  assert.ok(placed > 100 && given > 5, `${placed} placed, ${given} given up`);
});

test('what giving a plaque up costs is what standing on a keep-out costs when a share of the plaque is under it', () => {
  near(plaquePrice(0.1, 0), plaquePrice(0.2, 0));
  assert.ok(plaquePrice(0.1, 0.03) > plaquePrice(0.1, 0.02));
  assert.ok(plaquePrice(0.2, 0.03) > plaquePrice(0.1, 0.03), 'a bigger plaque may have as big a share under the car as a small one');
  assert.ok(plaquePrice(0.1, 0.02) > 5, 'more than the cheapest keep-out overlap, so that there is no sliver that is better than giving up');
});

test('a plaque is given up rather than put on the car when it is worth less than the overlap costs, and kept when it is worth more', () => {
  const car = { x0: -0.94, y0: -0.2, x1: 0.94, y1: 0.2 };
  // the stone is under the car and the plaque may go 0.1 from it, which is all car: 0.7 x 0.1 clip units under it
  const make = (rank) => stoned('a', -0.3, -0.05, 0.4, 0.05, -0.35, 0.0, 0.1, rank);
  const [dear] = settlePlaques([make(plaquePrice(0.07, 2))], SAFE, car);
  assert.equal(dear.out, false, 'a plaque that is worth a lot is kept, on the car');
  const [cheap] = settlePlaques([make(plaquePrice(0.07, 0.01))], SAFE, car);
  assert.equal(cheap.out, true, 'a plaque that is worth little is given up');
});

test('the page\'s own buttons are not stood on while a plaque can be given up, the car and the plate a little', () => {
  const car = { x0: -0.94, y0: -0.2, x1: 0.94, y1: 0.2 };
  // the stone is under the keep-out and the plaque may go 0.1 from it: all of it is under the keep-out, and it is worth 145
  const make = () => stoned('a', -0.3, -0.05, 0.4, 0.05, -0.35, 0.0, 0.1, plaquePrice(0.07, 2));
  const [soft] = settlePlaques([make()], SAFE, car);
  assert.equal(soft.out, false, 'on the car (or the plate) it is kept');
  const [hard] = settlePlaques([make()], SAFE, { ...car, hard: true });
  assert.equal(hard.out, true, 'on the buttons it is not');
  // and with no price it is placed on the buttons all the same, as the layout always did
  const [free] = settlePlaques([stoned('a', -0.3, -0.05, 0.4, 0.05, -0.35, 0.0, 0.1, undefined)], SAFE, { ...car, hard: true });
  assert.notEqual(free.out, true);
});

test('the page\'s buttons and speed readout are hard keep-outs, and the plate and the car (not the page\'s) are not', () => {
  const hud = new Hud();
  assert.equal(hud.touch.hard, true);
  assert.equal(hud.speed.hard, true);
  const source = fs.readFileSync(new URL('../../public/archipelago/preview/portfolio/world2/interactions/Career.js', import.meta.url), 'utf8');
  assert.ok(/this\.keepPlate = \{ x0: 2, y0: 2, x1: -2, y1: -2 \}/.test(source) || !/keepPlate[^;]*hard/.test(source), 'the plate is soft');
  assert.ok(!/keepCar[^;\n]*hard: true/.test(source), 'the car is soft');
});
