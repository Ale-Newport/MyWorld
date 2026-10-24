import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_DEFAULTS } from '../../public/archipelago/preview/portfolio/world2/content/boards.js';
import {
  BOARD_H, FACE_H, FACE_W, LINK_PLANE, PLATE_H, cleanTechs, fitLinkStrip, paintProjectBoard, paintProjectFace, paintTitlePlate,
} from '../../public/archipelago/preview/portfolio/world2/interactions/screenMotion.js';

/**
 * A 2D context that records the text it is asked to draw (in canvas pixels: translate and scale are tracked, rotation is
 * ignored) and measures every glyph as half an em: no canvas, no fonts.
 */
function fakeContext() {
  const texts = [];
  const state = { font: '10px Test', fillStyle: '', textAlign: 'left' };
  let m = { sx: 1, sy: 1, tx: 0, ty: 0 };
  const stack = [];
  const noop = () => {};
  const target = {
    texts,
    save() { stack.push({ ...m }); },
    restore() { m = stack.pop() ?? m; },
    translate(x, y) { m = { ...m, tx: m.tx + x * m.sx, ty: m.ty + y * m.sy }; },
    scale(x, y) { m = { ...m, sx: m.sx * x, sy: m.sy * y }; },
    setTransform(a, _b, _c, d, e, f) { m = { sx: a, sy: d, tx: e, ty: f }; },
    measureText(text) { const px = Number(/(\d+(?:\.\d+)?)px/.exec(state.font)?.[1] ?? 10); return { width: String(text).length * px * 0.5 }; },
    fillText(text, x, y) { texts.push({ text: String(text), x: m.tx + x * m.sx, y: m.ty + y * m.sy, font: state.font, scale: m.sy }); },
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => ({}),
  };
  return new Proxy(target, {
    get(t, prop) { if (prop in t) return t[prop]; if (prop in state) return state[prop]; return noop; },
    set(t, prop, value) { state[prop] = value; return true; },
  });
}

const chess = BOARD_DEFAULTS.projects[2];
const project = (patch = {}) => ({ ...chess, ...patch });
const said = (context) => context.texts.map(t => t.text);

test('blank fields draw nothing: no medal for a whitespace metric, no pills for empty technologies, no ribbon for a blank field', () => {
  const full = fakeContext();
  paintProjectFace(full, FACE_W, FACE_H, project({ metric: '1,000 users', technologies: ['A', 'B'] }));
  assert.ok(said(full).includes('★'), 'a real metric stamps the medal');
  assert.ok(said(full).includes('A') && said(full).includes('B'));

  const blank = fakeContext();
  paintProjectFace(blank, FACE_W, FACE_H, project({ metric: '   ', technologies: ['', '  ', '\t'], category: ' ', year: '' }));
  assert.ok(!said(blank).includes('★'), 'whitespace is not a figure');
  assert.ok(!said(blank).some(t => /^\s*$/.test(t)), 'no blank text is drawn');
  assert.ok(!said(blank).some(t => t.includes('·') && t.trim() === '·'), 'no bare ribbon dot');
  assert.ok(said(blank).includes('OPEN TO VISIT  ↗') || said(blank).includes('PRIVATE SOURCE'), 'the status tag stays');
});

test('cleanTechs trims and drops blanks', () => {
  assert.deepEqual(cleanTechs({ technologies: [' TypeScript ', '', '  ', 'Redis'] }), ['TypeScript', 'Redis']);
});

test('the figure sits above the description, which starts below it', () => {
  const context = fakeContext();
  paintProjectFace(context, FACE_W, FACE_H, project({ metric: 'A figure' }));
  const metric = context.texts.find(t => t.text.startsWith('A figure'));
  const description = context.texts.find(t => chess.description.startsWith(t.text.slice(0, 8)));
  assert.ok(metric && description);
  assert.ok(metric.y < description.y, `metric ${metric.y} above description ${description.y}`);
  assert.ok(metric.y < FACE_H * 0.4, 'the figure stays out of the lower third, where the car parks in the reading pose');
});

test('short copy is set larger than long copy, and neither overflows the column', () => {
  const sizeOf = (description) => {
    const context = fakeContext();
    paintProjectFace(context, FACE_W, FACE_H, project({ description, metric: null }));
    const first = context.texts.find(t => description.startsWith(t.text.slice(0, 4)));
    return Number(/(\d+(?:\.\d+)?)px/.exec(first.font)[1]);
  };
  const short = sizeOf('Vocational training.');
  const long = sizeOf('Detailed description of everything this project does. '.repeat(9));
  assert.ok(short > long, `${short} > ${long}`);
  assert.ok(short <= 48 && long >= 22);
});

test('the title plate leaves the nails their margin and uses the rest of the width', () => {
  const context = fakeContext();
  const fit = paintTitlePlate(context, FACE_W, PLATE_H, project({ title: 'Stock Market Simulator' }));
  context.font = fit.font;
  const width = context.measureText(fit.lines[0]).width;
  assert.ok(width <= FACE_W * 0.92 + 1, `${width} <= ${FACE_W * 0.92}`);
  assert.ok(width > FACE_W * 0.7, 'a 22-character name fills most of the plate');
});

test('a link that does not fit is shortened in the middle, keeping the name of the repository', () => {
  const context = fakeContext();
  const strip = { w: LINK_PLANE * (FACE_W / 4), h: 0.2 * (FACE_W / 4) };
  const name = 'Designing-and-Analysing-Sorting-Algorithms-Demo';
  const long = fitLinkStrip(context, strip.w, strip.h, project({ link: `https://github.com/an-owner-with-a-long-name/${name}` }));
  assert.equal(long.fit.truncated, false);
  assert.equal(long.fit.lines[0], `github.com/…/${name}`);
  // When even the shortened form is too long, the cut falls inside the name, not before it.
  const huge = fitLinkStrip(context, strip.w, strip.h, project({ link: `https://github.com/owner/${'Designing-and-Analysing-'.repeat(5)}Algorithms` }));
  assert.equal(huge.fit.truncated, true);
  assert.ok(huge.fit.lines[0].startsWith('github.com/…/Designing-and-Analysing-'), huge.fit.lines[0]);
  // What fits whole is left whole, on the 2.2 m strip.
  const whole = fitLinkStrip(context, strip.w, strip.h, project({ link: 'https://github.com/Ale-Newport/Designing-and-Analysing-Algorithms' }));
  assert.equal(whole.fit.lines[0], 'github.com/Ale-Newport/Designing-and-Analysing-Algorithms');
  const short = fitLinkStrip(context, strip.w, strip.h, project({ link: 'https://example.com/app' }));
  assert.equal(short.fit.lines[0], 'example.com/app');
  const none = fitLinkStrip(context, strip.w, strip.h, project({ link: null }));
  assert.equal(none.fit.lines[0], 'Private source');
});

test('the admin preview is the whole board: the title above the sheet, nothing outside the canvas', () => {
  const context = fakeContext();
  paintProjectBoard(context, FACE_W, BOARD_H, project({ title: 'A Title The Editor Is Typing' }), 2, undefined, { index: 2, total: 42 });
  const title = context.texts.find(t => t.text.includes('Title'));
  assert.ok(title, 'the title is drawn');
  assert.ok(title.y < PLATE_H, `title baseline ${title.y} is on the plate`);
  assert.ok(context.texts.some(t => t.text.startsWith('github.com') || t.text === 'Private source'), 'the link chip is drawn');
  const sheet = context.texts.find(t => t.text === 'OPEN TO VISIT  ↗' || t.text === 'PRIVATE SOURCE');
  assert.ok(sheet && sheet.y > PLATE_H, 'the sheet is below the plate');
  for (const t of context.texts) assert.ok(t.y >= 0 && t.y <= BOARD_H, `"${t.text}" at y ${t.y} is inside the ${BOARD_H}px canvas`);
});

test('the neighbour signs switch from the ground, near their footprint, and not from a stretch away or far overhead', async () => {
  const { inSwitchZone } = await import('../../public/archipelago/preview/portfolio/world2/interactions/Projects.js');
  // The signs' bounds in the running world (authored units): they hang 1.9 to 3.6 above the ground, on the board's posts. A car on the
  // ground rides 0.7 to 2.1, and steering one at each sign from twelve sides gets it no nearer than 1.1 (previous) and 1.9 (next)
  // from these footprints (scripts/qa/world-focus-exit.mjs --suite=hit).
  const previous = { min: { x: 30.34, y: 1.88, z: 11.14 }, max: { x: 31.64, y: 3.57, z: 12.02 } };
  const next = { min: { x: 34.95, y: 1.88, z: 7.32 }, max: { x: 36.24, y: 3.55, z: 8.15 } };
  assert.ok(inSwitchZone({ x: 31.0, y: 0.8, z: 11.5 }, previous), 'beneath the previous sign');
  assert.ok(inSwitchZone({ x: 29.25, y: 0.8, z: 11.5 }, previous), 'where a driven car stops short of the previous sign (1.1 from it)');
  assert.ok(inSwitchZone({ x: 38.16, y: 0.8, z: 7.7 }, next), 'where a driven car stops short of the next sign (1.9 from it): the old 2.2 m ring around its origin never reached it');
  assert.ok(inSwitchZone({ x: 35.5, y: 1.9, z: 7.8 }, next), 'beneath the next sign');
  assert.ok(!inSwitchZone({ x: 39.8, y: 0.8, z: 7.7 }, next), 'three and a half units across does not');
  assert.ok(!inSwitchZone({ x: 35.5, y: 7.5, z: 7.8 }, next), 'a car far overhead does not');
  assert.ok(!inSwitchZone({ x: 37.25, y: 1.55, z: 14.44 }, next) && !inSwitchZone({ x: 37.25, y: 1.55, z: 14.44 }, previous), 'parked at the reading spot it switches neither');
});
