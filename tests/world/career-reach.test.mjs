import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { plaqueReach, plaqueFit, plaqueFactor, plaqueCap, defaultDepth, plateFloorPx } from '../../public/archipelago/preview/portfolio/world2/interactions/Career.js';

const source = fs.readFileSync(new URL('../../public/archipelago/preview/portfolio/world2/interactions/Career.js', import.meta.url), 'utf8');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);
const constant = (name) => Number(new RegExp(`const ${name} = ([-0-9.e]+);`).exec(source)?.[1]);
const SLACK = constant('DESIGN_SLACK'), ZOOM = constant('DEFAULT_ZOOM');
const RADIUS = constant('REVEAL_RADIUS'), HOLD = constant('REVEAL_HOLD'), MARGIN = constant('VIEW_MARGIN'), VIEW_HOLD = constant('VIEW_HOLD'), CUT = constant('NEAR_CUT'), SHARE = constant('NEAR_SHARE');
const WIDE = constant('WIDTH_SHARE'), GAP = constant('GAP_SHARE'), ENTER = constant('GAP_ENTER'), GIVE_UP = constant('GIVE_UP_AFTER'), REVIVE = constant('REVIVE_AFTER');

/* ---- where a plaque speaks at all: the car within reach of its stone, the stone in the picture ---- */

test('the constants are there to be judged (a missing one would make every number below NaN)', () => {
  for (const value of [RADIUS, HOLD, MARGIN, VIEW_HOLD, CUT, SHARE]) assert.ok(Number.isFinite(value) && value > 0, `${value}`);
  assert.ok(RADIUS <= 20, 'the reach is the lane group (6 m across) and a margin, not the road');
});

test('a car on the lanes with the stone in the picture is within reach', () => {
  assert.equal(plaqueReach(false, 2, 0.3, 0.5, 20), true);
  assert.equal(plaqueReach(false, 0, -0.9, 0.9, 20), true);
});

test('a car further from the stone across the lanes than the reach is not, wherever the stone is on the screen', () => {
  assert.equal(plaqueReach(false, RADIUS + 0.01, 0, 0, 20), false);
  assert.equal(plaqueReach(false, 40, 0, 0, 20), false);
  assert.equal(plaqueReach(false, 28, 0.1, 0.1, 20), false, 'the car was 28 m west of the lanes when the plaques filled the screen');
});

test('a stone off the screen by more than the margin has no plaque, in any direction', () => {
  const edge = 1 + MARGIN;
  assert.equal(plaqueReach(false, 3, edge - 0.01, 0, 20), true);
  assert.equal(plaqueReach(false, 3, edge + 0.01, 0, 20), false);
  assert.equal(plaqueReach(false, 3, -edge - 0.01, 0, 20), false);
  assert.equal(plaqueReach(false, 3, 0, edge + 0.01, 20), false);
  assert.equal(plaqueReach(false, 3, 0, -edge - 0.01, 20), false);
  assert.equal(plaqueReach(false, 3, 1e6, 1e6, 20), false, 'a stone far outside, as the car 20 m to the side sees it');
});

test('a stone at the lens, or behind it, has no plaque however it projects', () => {
  assert.equal(plaqueReach(false, 3, 0, 0, CUT - 0.01), false);
  assert.equal(plaqueReach(false, 3, 0, 0, 0), false);
  assert.equal(plaqueReach(false, 3, 0.1, 0.1, -5), false);
  assert.equal(plaqueReach(true, 3, 0.1, 0.1, -5), false);
  assert.equal(plaqueReach(false, 3, 0, 0, NaN), false);
  assert.equal(plaqueReach(false, NaN, 0, 0, 20), false);
  assert.equal(plaqueReach(false, 3, NaN, 0, 20), false);
});

test('the edge is a band: a plaque that is speaking holds on past where one that is not would start', () => {
  const edge = 1 + MARGIN;
  assert.equal(plaqueReach(false, 3, edge + VIEW_HOLD / 2, 0, 20), false);
  assert.equal(plaqueReach(true, 3, edge + VIEW_HOLD / 2, 0, 20), true);
  assert.equal(plaqueReach(true, 3, edge + VIEW_HOLD + 0.01, 0, 20), false, 'but not for ever');
  assert.equal(plaqueReach(false, RADIUS + HOLD / 2, 0, 0, 20), false);
  assert.equal(plaqueReach(true, RADIUS + HOLD / 2, 0, 0, 20), true);
  assert.equal(plaqueReach(true, RADIUS + HOLD + 0.01, 0, 0, 20), false);
  assert.equal(plaqueReach(false, 3, 0, 0, CUT + 0.5), true);
  assert.equal(plaqueReach(true, 3, 0, 0, CUT - 0.5), true, 'depth holds on too');
});

test('a car shaken a few centimetres on the edge turns a plaque on once, and never off', () => {
  // a stone's anchor moves about 0.002 clip units per centimetre of car: +-6 cm about the entry is +-0.012 either side of it
  const entry = 1 + MARGIN;
  const shake = (hold) => {
    let on = false, flips = 0;
    for (let i = 0; i < 200; i++) {
      const ax = entry + (i % 2 ? 0.012 : -0.012);
      const next = hold ? plaqueReach(on, 3, ax, 0, 20) : plaqueReach(false, 3, ax, 0, 20);
      if (next !== on) flips++;
      on = next;
    }
    return flips;
  };
  assert.equal(shake(true), 1);
  // control: a gate with no memory (every frame judged as a plaque that was not speaking) turns on and off every step
  assert.ok(shake(false) > 100, `${shake(false)}`);
});

test('every combination of position stays inside what it was designed for: a plaque speaks only where its stone is on the screen', () => {
  let speaks = 0;
  for (let lateral = 0; lateral <= 40; lateral += 2) for (let ax = -3; ax <= 3; ax += 0.1) for (let ay = -3; ay <= 3; ay += 0.1) for (const depth of [1, 3, 5, 12, 21, 40]) {
    if (!plaqueReach(false, lateral, ax, ay, depth)) continue;
    speaks++;
    assert.ok(lateral <= RADIUS && Math.abs(ax) <= 1 + MARGIN + 1e-9 && Math.abs(ay) <= 1 + MARGIN + 1e-9 && depth > CUT);
  }
  assert.ok(speaks > 1000);
});

/* ---- how big a plaque is drawn: never bigger than at the car's depth by more than the design allows ---- */

test('a plaque on a screen with room, no nearer than the share of the car\'s depth, is its own size', () => {
  assert.equal(plaqueFit(20, 21, 21), 1, 'a desktop at its default camera: subtitle 20 px');
  assert.equal(plaqueFit(20, 17, 21), 1, 'a stone 4 m nearer the lens than the car on the lanes');
  assert.equal(plaqueFit(20, 21 * SHARE, 21), 1);
});

test('a plaque on a short screen is grown until its subtitle is 12 px, and no more than the cap', () => {
  assert.ok(Math.abs(plaqueFit(8, 21, 21) - 1.5) < 1e-9);
  assert.equal(plaqueFit(1, 21, 21), 2.2, 'FIT_MAX');
  assert.equal(plaqueFit(0, 21, 21), 2.2);
});

test('a plaque nearer the lens than that is shrunk in proportion, so it is never drawn bigger than the design allows', () => {
  const floor = 21 * SHARE;
  // a subtitle that is huge when it is near: nothing but the cap shrinks it. On the screen its width goes with fit / depth, and that is held at its value at the floor.
  for (const depth of [floor - 1, floor / 2, 5, 2.5, 1]) {
    const fit = plaqueFit(1000, depth, 21);
    assert.ok(fit < 1 && fit > 0);
    near((fit / depth) * floor, 1);
  }
  // at 2.3 m from the lens (the slab that filled the screen) the plaque is a fraction of its size
  assert.ok(plaqueFit(1000, 2.3, 21) < 0.2);
  // it never reads under 12 px: the subtitle at 12 px is the least it shrinks to
  assert.ok(Math.abs(plaqueFit(13, 3, 21) - 12 / 13) < 1e-9, 'a small subtitle is kept at 12 px, not shrunk further');
});

test('at the lens there is still an answer, and it is small; with no number for the car there is no cap', () => {
  assert.ok(plaqueFit(Infinity, 0, 21) <= 0.1);
  assert.ok(plaqueFit(Infinity, -3, 21) <= 0.1);
  assert.equal(plaqueFit(20, 17, NaN), 1);
});

/* ---- how big a plaque is drawn when the camera is zoomed: never bigger than the default camera's size ---- */

const P5 = 1 / Math.tan((12.5 * Math.PI) / 180); // the chase camera's FOV is 25 degrees
const SUB = 0.24 * (0.91 - 2 * Math.min(0.02, 0.91 * 0.12)); // the subtitle's metres at size 1 (see NOMINAL_SUB)
// the screens' default camera distance by the View's own formula (edges 15 and 30, 9 m per unit of overflow), and its radius at a zoom
const VIEWS = { desk: [1440, 900], phone: [390, 844], tablet: [834, 1112], land: [844, 390], wide: [2560, 1080] };
const overflowOf = ([w, h]) => Math.max(1, 16 / 9 / (w / h)) - 1;
const designOf = (screen) => defaultDepth(15, 30, 9, overflowOf(screen));
const radiusAt = (screen, zoom) => 15 + (30 + overflowOf(screen) * 9 - 15) * (1 - zoom);
/** what the layout does for a plaque `off` metres nearer the lens than the car, on `screen`, with the camera at `radius`: its fit, and its width on the screen (in clip units per metre of plaque) */
const drawn = (screen, radius, off, metres = 0) => {
  const depth = radius + off, dist = depth * 1.02, car = radius, height = screen[1];
  const k = plaqueFactor(dist);
  const subPx = (SUB * k * height * 0.5 * P5) / depth;
  // how wide it is at size 1 over the canvas's width (0: not known), as the layout works it out
  const share = (metres * P5 * (height / screen[0]) * k) / (2 * depth);
  const fit = Math.min(plaqueFit(subPx, depth, car, share), plaqueCap(SUB, height, P5, depth, dist, car, designOf(screen), share));
  return { fit, width: (fit * k) / depth, share: fit * share, sub: subPx * fit };
};

test('the billboard factor is the distance over 31 m, held between 1 and 1.8', () => {
  assert.equal(plaqueFactor(15), 1);
  assert.equal(plaqueFactor(31), 1);
  near(plaqueFactor(40), 40 / 31);
  assert.equal(plaqueFactor(100), 1.8);
});

test('the camera\'s default distance is the View\'s: 21 m at 16:9, 31 m on a phone held upright, and 21 m where there is no number', () => {
  assert.ok(Math.abs(ZOOM - 0.6) < 1e-9);
  near(defaultDepth(15, 30, 9, 0), 21);
  assert.ok(Math.abs(designOf(VIEWS.phone) - 31.3) < 0.1, `${designOf(VIEWS.phone)}`);
  assert.ok(Math.abs(designOf(VIEWS.desk) - 21.4) < 0.1, `${designOf(VIEWS.desk)}`);
  assert.equal(defaultDepth(NaN, 30, 9, 0), 21);
  assert.equal(defaultDepth(15, 30, 9, NaN), 21);
  assert.equal(defaultDepth(undefined, undefined, undefined, undefined), 21);
});

test('at the default camera the cap changes nothing: a plaque is its own size, level with the car or nearer or further', () => {
  for (const screen of Object.values(VIEWS)) for (const off of [-4, -3, 0, 2, 5]) {
    const radius = designOf(screen), depth = radius + off, dist = depth * 1.02;
    const natural = plaqueFit((SUB * plaqueFactor(dist) * screen[1] * 0.5 * P5) / depth, depth, radius);
    assert.ok(plaqueCap(SUB, screen[1], P5, depth, dist, radius, radius) >= natural - 1e-9, `${screen} ${off}`);
  }
});

test('zoomed in, a plaque is never bigger on the screen than it is at the default camera, by more than the slack', () => {
  for (const [name, screen] of Object.entries(VIEWS)) for (const off of [-3, 0, 2]) {
    const at = drawn(screen, designOf(screen), off);
    for (const zoom of [0.7, 0.8, 0.9, 1]) {
      const now = drawn(screen, radiusAt(screen, zoom), off);
      assert.ok(now.width <= at.width * SLACK + 1e-9, `${name} zoom ${zoom} off ${off}: ${now.width} against ${at.width}`);
    }
  }
});

test('the phone pinched all the way in (the 15 m camera) draws its plaque at the width it has at 31 m, not at twice it', () => {
  const screen = VIEWS.phone;
  const far = drawn(screen, designOf(screen), 0), close = drawn(screen, 15, 0);
  // without the cap the plaque's width goes with 1 / depth: 31.3 / 15 = 2.1 times
  const uncapped = (plaqueFit((SUB * plaqueFactor(15) * screen[1] * 0.5 * P5) / 15, 15, 15) * plaqueFactor(15)) / 15;
  assert.ok(uncapped / far.width > 1.5, 'the control: without the cap it is much wider');
  assert.ok(close.width / far.width <= SLACK + 1e-9 && close.width / far.width > 0.9, `${close.width / far.width}`);
});

test('the cap never takes a subtitle under what the default camera gives it', () => {
  for (const screen of Object.values(VIEWS)) {
    const design = designOf(screen), at = drawn(screen, design, 0);
    const subAt = (SUB * at.fit * plaqueFactor(design) * screen[1] * 0.5 * P5) / design;
    for (const zoom of [0.7, 0.8, 0.9, 1]) {
      const radius = radiusAt(screen, zoom), now = drawn(screen, radius, 0);
      const sub = (SUB * now.fit * plaqueFactor(radius) * screen[1] * 0.5 * P5) / radius;
      assert.ok(sub >= subAt * 0.99, `${screen} zoom ${zoom}: ${sub} px against ${subAt} at the default`);
    }
  }
});

test('further out than the default camera nothing is capped (the plaque is as small as the distance makes it)', () => {
  for (const screen of Object.values(VIEWS)) {
    const design = designOf(screen);
    for (const out of [design + 3, design + 10, 56]) {
      const depth = out, dist = out * 1.02;
      const natural = plaqueFit((SUB * plaqueFactor(dist) * screen[1] * 0.5 * P5) / depth, depth, out);
      assert.ok(plaqueCap(SUB, screen[1], P5, depth, dist, out, design) >= natural - 1e-9, `${screen} ${out}`);
    }
  }
});

test('a cap with no number to judge by is no cap, and is never a number that would swallow the plaque', () => {
  assert.equal(plaqueCap(SUB, NaN, P5, 20, 20, 21, 21) > 0, true, 'a canvas with no height: the plaque is not asked to grow, and the cap is a number or none');
  assert.equal(plaqueCap(SUB, 900, P5, 20, NaN, 21, 21), Infinity);
  assert.equal(plaqueCap(SUB, 900, P5, 20, 20, 21, NaN), Infinity);
  for (const design of [0, 1, 5]) assert.ok(plaqueCap(SUB, 900, P5, 12, 12, 15, design) > 0);
});

/* ---- the plate's floor on a narrow screen ---- */

test('the plate\'s floor is 74 px on every screen from 390 px up, and in proportion to the width below it', () => {
  assert.equal(plateFloorPx(1440), 74);
  assert.equal(plateFloorPx(844), 74);
  assert.equal(plateFloorPx(390), 74);
  assert.ok(Math.abs(plateFloorPx(360) - (74 * 360) / 390) < 1e-9);
  assert.ok(plateFloorPx(360) < 70 && plateFloorPx(360) > 66, 'a 360 px phone: 70 px was enough to show it where 74 was not');
  assert.ok(plateFloorPx(320) < plateFloorPx(360));
  assert.equal(plateFloorPx(0), 74, 'no measured canvas: the number as it was');
  assert.equal(plateFloorPx(NaN), 74);
});

/* ---- the controller uses them ---- */

test('the controller reveals a plaque only when it can speak, builds it for the stops that can, and the layout lays out only those', () => {
  assert.ok(/line\.wants = line === speaking\.get\(line\.track\.id\) && this\.canSpeak\(line, player, camera\)/.test(source));
  assert.ok(/line\.near = line\.wants && !line\.crowded/.test(source), 'a plaque speaks while the layout has a place for it near its stone');
  assert.ok(/const revealTarget = line\.near && !line\.relocating \? 1 : 0/.test(source), 'a plaque that is being put somewhere else wipes away first');
  assert.ok(/if \(line\.wants\) \{/.test(source), 'the layout moves the plaques that may speak, and looks for a place for those that have none');
  assert.ok(/plaqueFit\(subPx, depth, carDepth, share\)/.test(source), 'the layout sizes by the same cap, and by the width it may have');
  assert.ok(/plateFloorPx\(canvas\)/.test(source), 'the plate\'s floor follows the screen');
  assert.ok(/Math\.min\(plaqueFit\(subPx, depth, carDepth, share\), plaqueCap\(/.test(source), 'the layout holds the size to the default camera\'s as well');
  assert.ok(/this\.layoutPlaques\(camera, delta, this\.designDepth\(view\)\)/.test(source), 'and is given the default camera\'s distance');
  // the car leaving the area resets the gate, so that a plaque does not hold on from a drive-by
  assert.ok(/line\.placed = false;\s*line\.lastDx = line\.lastDy = NaN;\s*line\.pending = 0;\s*line\.near = false;\s*line\.wants = false;\s*line\.crowded = false;\s*line\.held = 0;\s*line\.latched = false;\s*line\.wary = false;\s*line\.relocating = false/.test(source));
});


/* ---- how wide a plaque is: no more than WIDTH_SHARE of the canvas, as far as its subtitle allows ---- */

test('the constants of the width and of the distance from the stone are there to be judged', () => {
  assert.ok(WIDE > 0.3 && WIDE <= 0.4, `${WIDE}`);
  assert.ok(GAP > 0.1 && GAP < 0.3, 'a plaque stands within a third of the canvas\'s shorter side of its stone, with room for the layout\'s slide to lag');
  assert.ok(ENTER > 0.5 && ENTER < 1, 'a plaque that has given way needs more room than one that is speaking: the edge is a band');
  assert.ok(GIVE_UP > 0.1 && GIVE_UP <= 0.5 && REVIVE > 0 && REVIVE < GIVE_UP, 'a plaque waits a moment to give way, and less to be let back');
});

test('a plaque on a tablet held upright is shrunk to the width share, and no further than its subtitle at 12 px allows', () => {
  // 834 px wide, an 18 px subtitle at size 1: a plaque that is 62% of the width at size 1
  near(plaqueFit(18, 21, 21, 0.62), 12 / 18);
  // 50%: 0.4 / 0.5
  near(plaqueFit(18, 21, 21, 0.5), 0.8);
  assert.ok(plaqueFit(18, 21, 21, 0.62) * 0.62 < 0.42, 'under the floor the width is a little over the share: the floor wins');
});

test('a plaque that is narrow enough, or whose width is not known, is its own size', () => {
  assert.equal(plaqueFit(20, 21, 21, 0.35), 1, 'a desktop');
  assert.equal(plaqueFit(20, 21, 21, WIDE), 1);
  assert.equal(plaqueFit(20, 21, 21, 0), 1);
  assert.equal(plaqueFit(20, 21, 21, NaN), 1);
  assert.equal(plaqueFit(20, 21, 21), 1);
  assert.equal(plaqueFit(20, 21, 21, -1), 1);
});

test('on a phone the subtitle floor wins: the share is no reason for a type under 12 px', () => {
  for (const sub of [12.5, 13, 14, 16]) {
    const fit = plaqueFit(sub, 31, 31, 0.7);
    assert.ok(fit * sub >= 12 - 1e-9, `${sub}: ${fit * sub}`);
  }
});

test('the width share holds when the plaque is nearer the lens, and with the cap against the default camera', () => {
  const screen = VIEWS.tablet;
  for (const metres of [2.2, 3.4, 4.4]) for (const zoom of [0.6, 0.7, 0.8, 0.9, 1]) for (const off of [-3, 0, 2]) {
    const d = drawn(screen, radiusAt(screen, zoom), off, metres);
    assert.ok(d.share <= WIDE + 1e-6 || d.sub <= 12 + 1e-6, `${metres} m zoom ${zoom} off ${off}: ${(100 * d.share).toFixed(1)}% of the canvas at a ${d.sub.toFixed(1)} px subtitle`);
  }
});

test('the widest plaque on the tablets of 768 to 834 px is no wider than the share, at the default camera, where its subtitle is 12 px or more', () => {
  for (const screen of [[768, 1024], [820, 1180], [834, 1112], [1024, 1366]]) {
    const d = drawn(screen, designOf(screen), 0, 4.4);
    assert.ok(d.share <= WIDE * 1.02 || d.sub <= 12.2, `${screen}: ${(100 * d.share).toFixed(1)}% at ${d.sub.toFixed(1)} px`);
  }
});

test('a desktop, a laptop and a phone on its side are not changed by the share (their widest plaque is under it already)', () => {
  for (const screen of [VIEWS.desk, [1280, 800], VIEWS.wide]) for (const zoom of [0.6, 1]) {
    const radius = radiusAt(screen, zoom);
    const without = drawn(screen, radius, 0, 0), with4 = drawn(screen, radius, 0, 4.4);
    assert.ok(with4.share <= WIDE + 1e-6 || with4.sub <= 12 + 1e-6);
    assert.ok(with4.fit <= without.fit + 1e-9, 'never grows');
  }
  const land = drawn(VIEWS.land, designOf(VIEWS.land), 0, 4.4);
  assert.ok(land.sub >= 12 - 1e-6);
});

test('the layout gives up a plaque that has no place beside its stone (see GAP_SHARE), and tries it again every frame', () => {
  assert.ok(/slot\.reach = trial \? reach \* GAP_ENTER : reach/.test(source), 'a plaque that has given way needs more room to be let back: it is asked about as if it spoke, within GAP_ENTER of the reach');
  assert.ok(/const trial = line\.wants && line\.crowded/.test(source));
  assert.ok(/if \(slot\.out\) \{[\s\S]*?line\.held >= GIVE_UP_AFTER\)\s*\{[\s\S]*?line\.crowded = true/.test(source), 'a plaque with no place does not speak from the next frame on (after a moment, if it has stood)');
  assert.ok(/line\.held \+ delta >= \(slot\.line\.wary \? REVIVE_WARY : REVIVE_AFTER\)/.test(source) && /line\.crowded = false;\s*line\.relocating = false;\s*line\.held = 0;\s*line\.revivedAt = this\.clock;/.test(source) && /if \(line\.reveal < REVIVE_SNAP\)\s*line\.placed = false/.test(source), 'and one that has a place again does, once it has had it for a moment');
  assert.ok(/if \(line\.wants && !line\.sign\)\s*this\.buildPlaque\(line, true\)/.test(source), 'a plaque the layout has no room for is built all the same: its size is what the room is looked for with');
  assert.ok(/plaqueReach\(line\.wants,/.test(source), 'the edge of the reach has a memory of wanting to speak, not of being drawn: a plaque the layout has hidden does not lose it');
});
