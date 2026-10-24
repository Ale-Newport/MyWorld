import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitText, clearFitCache, ellipsize } from '../../public/archipelago/preview/portfolio/world2/signs/paint.js';
import { BOARD_DEFAULTS } from '../../public/archipelago/preview/portfolio/world2/content/boards.js';
import { projectLinkLabel, FACE_W, PLATE_H } from '../../public/archipelago/preview/portfolio/world2/interactions/screenMotion.js';

/* fitText used to walk the size grid one step at a time (up to 57 wraps of the whole text, 1,300-1,700 measureText calls
   for a long address). It now halves the grid and remembers what it found. These tests hold it to the old answer, size
   for size and line for line, on every shipped project and on a few thousand generated cases, and count the work. */

/** The algorithm as it was before the search: the reference every result is compared with. */
function referenceWrap(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  let broke = false;
  const push = () => { if (line) { lines.push(line); line = ''; } };
  for (const word of text.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) { line = candidate; continue; }
    push();
    if (ctx.measureText(word).width <= maxWidth) { line = word; continue; }
    broke = true;
    for (const char of word) {
      const next = line + char;
      if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = char; } else line = next;
    }
  }
  push();
  return { lines, broke };
}
function referenceFit(ctx, text, o) {
  const fontFor = (weight, px, family) => `${weight} ${px}px ${family}`;
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  const maxLines = Math.max(1, o.maxLines ?? 1);
  const lineHeight = o.lineHeight ?? 1.2;
  const weight = o.weight ?? 600;
  const step = Math.max(0.5, o.step ?? 2);
  const budget = o.maxHeight ?? Infinity;
  if (!clean) { ctx.font = fontFor(weight, o.minPx, o.family); return { lines: [], px: o.minPx, lineHeight, font: ctx.font, height: 0, truncated: false }; }
  for (let px = o.maxPx; px >= o.minPx; px -= step) {
    ctx.font = fontFor(weight, px, o.family);
    const { lines, broke } = referenceWrap(ctx, clean, o.maxWidth);
    if (!broke && lines.length <= maxLines && lines.length * px * lineHeight <= budget) {
      return { lines, px, lineHeight, font: ctx.font, height: lines.length * px * lineHeight, truncated: false };
    }
  }
  const px = o.minPx;
  ctx.font = fontFor(weight, px, o.family);
  const { lines } = referenceWrap(ctx, clean, o.maxWidth);
  const room = Math.max(1, Math.min(maxLines, Math.floor(budget / (px * lineHeight))));
  if (lines.length <= room) return { lines, px, lineHeight, font: ctx.font, height: lines.length * px * lineHeight, truncated: false };
  const kept = lines.slice(0, room);
  kept[room - 1] = ellipsize(ctx, lines.slice(room - 1).join(' '), o.maxWidth, o.ellipsis);
  return { lines: kept, px, lineHeight, font: ctx.font, height: kept.length * px * lineHeight, truncated: true };
}

/**
 * A measurer whose glyphs have different widths (by character code, with a kerning pair or two) and scale exactly with
 * the size in the font string, as text does on a canvas with subpixel positioning. `calls` counts the measureText calls.
 */
function measurer(round = 0) {
  const ctx = {
    font: '', calls: 0,
    measureText(text) {
      ctx.calls++;
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 10);
      let em = 0;
      for (const ch of String(text)) {
        const code = ch.codePointAt(0);
        em += ch === ' ' ? 0.27 : code > 0x2e80 ? 1 : 0.3 + (code % 7) * 0.07;
      }
      em -= (String(text).match(/AV|To|r\./g)?.length ?? 0) * 0.05;
      const width = em * px;
      return { width: round ? Math.round(width / round) * round : width };
    },
  };
  return ctx;
}

/** Seeded generator, so a failure names a case that can be run again. */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const trimmed = (t) => String(t ?? '').trim();
const all = [...BOARD_DEFAULTS.projects, ...BOARD_DEFAULTS.experiments];
const compactLink = (label) => { const parts = label.split('/').filter(Boolean); return parts.length > 2 ? `${parts[0]}/…/${parts[parts.length - 1]}` : label; };
const sans = '"Geist", system-ui, sans-serif', mono = '"Geist Mono", monospace';

/** The option sets the boards, plates and labels pass (screenMotion.ts, Sign.ts, Places.ts), at the canvas sizes they are painted at. */
function profiles(project) {
  const link = projectLinkLabel(project);
  const stripW = 2.2 * (FACE_W / 4), stripH = 0.2 * (FACE_W / 4), worldH = 154, worldW = 1408;
  const link2 = (width, height, text) => ({ text, o: { maxWidth: width * 0.9, minPx: height * 0.3, maxPx: height * 0.62, weight: 600, family: mono, lineHeight: 1 } });
  const out = [
    { text: [project.category, project.year].map(trimmed).filter(Boolean).join(' · ').toUpperCase(), o: { maxWidth: 456, minPx: 20, maxPx: 26, weight: 600, family: mono, lineHeight: 1 } },
    { text: project.description, o: { maxWidth: 536, maxLines: 10, maxHeight: 268, minPx: 22, maxPx: 48, weight: 500, family: sans, lineHeight: 1.28 } },
    { text: project.description, o: { maxWidth: 536, maxLines: 10, maxHeight: 348, minPx: 22, maxPx: 48, weight: 500, family: sans, lineHeight: 1.28 } },
    { text: trimmed(project.metric), o: { maxWidth: 432, maxLines: 2, maxHeight: 54, minPx: 20, maxPx: 34, weight: 700, family: sans, lineHeight: 1.12 } },
    { text: trimmed(project.title), o: { maxWidth: 1024 * 0.92, maxLines: 2, maxHeight: PLATE_H * 0.96, minPx: PLATE_H * 0.2, maxPx: PLATE_H * 0.94, weight: 700, family: sans, lineHeight: 1.02 } },
    { text: project.title, o: { maxWidth: 536, maxLines: 2, maxHeight: 140, minPx: 34, maxPx: 62, weight: 700, family: sans, lineHeight: 1.06 } },
    { text: project.title, o: { maxWidth: 470, maxLines: 2, maxHeight: 176, minPx: 46, maxPx: 80, weight: 700, family: sans, lineHeight: 1.04 } },
    link2(stripW, stripH, link), link2(stripW, stripH, compactLink(link)),
    link2(worldW, worldH * 0.5, link), link2(worldW, worldH * 0.5, compactLink(link)),
    { text: project.short, o: { maxWidth: 512 * 0.82, maxLines: 3, maxHeight: 512 * 0.45 * 0.9 - 40, minPx: 512 * 0.45 * 0.11, maxPx: 512 * 0.45 * 0.27, weight: 700, family: sans, lineHeight: 1.08 } },
    { text: trimmed(project.category), o: { maxWidth: 512 * 0.86, maxLines: 1, maxHeight: 130, minPx: 512 * 0.45 * 0.14, maxPx: 512 * 0.45 * 0.4, weight: 700, family: sans, lineHeight: 1.1 } },
    { text: project.technologies.slice(0, 3).join(' · '), o: { maxWidth: 512 * 0.86, maxLines: 2, maxHeight: 130, minPx: 512 * 0.45 * 0.14, maxPx: 512 * 0.45 * 0.4, weight: 700, family: sans, lineHeight: 1.1 } },
    { text: project.description, o: { maxWidth: 936, maxLines: 4, maxHeight: 188, minPx: 38, maxPx: 56, weight: 500, family: sans, lineHeight: 1.18 } },
  ];
  return out.filter(p => trimmed(p.text));
}

const same = (a, b, label) => {
  assert.deepEqual(a.lines, b.lines, `${label}: lines`);
  assert.equal(a.px, b.px, `${label}: px`);
  assert.equal(a.height, b.height, `${label}: height`);
  assert.equal(a.truncated, b.truncated, `${label}: truncated`);
  assert.equal(a.font, b.font, `${label}: font`);
};

test('every shipped project and experiment gets the size and the lines the linear scan gave', () => {
  assert.ok(all.length >= 40, `the corpus is the whole shipped run (${all.length})`);
  let cases = 0;
  for (const project of all) {
    for (const [i, { text, o }] of profiles(project).entries()) {
      const a = measurer(), b = measurer();
      const old = referenceFit(a, text, o);
      const now = fitText(b, text, o);
      same(now, old, `${project.id} profile ${i}`);
      assert.equal(b.font, a.font, `${project.id} profile ${i}: ctx.font is left at the chosen size`);
      cases++;
    }
  }
  assert.ok(cases > 400, `${cases} cases`);
});

test('stress strings: one long address, one unbroken word, CJK, emoji, a single glyph, a paragraph, nothing but spaces', () => {
  const words = 'Detailed description of everything this project does, from the first prototype to the production release, with many sentences. ';
  const strings = [
    'github.com/alejandro-newport/Designing-and-Analysing-a-Fair-Variant-of-Cinquillo-and-its-Strategies',
    'github.com/…/Designing-and-Analysing-a-Fair-Variant-of-Cinquillo',
    'Supercalifragilisticexpialidocious'.repeat(3),
    '日本語のとても長いプロジェクト名前がここにありますそしてさらに続きます',
    '🚀🚀🚀 launch day 🚀🚀🚀 and then some more words to make it wrap onto a second line',
    'A', 'AV To r. AV To r.', words.repeat(4).slice(0, 500), words.repeat(5).slice(0, 700), '   ', 'x'.repeat(2000), 'a '.repeat(300).trim(),
  ];
  const options = [
    { maxWidth: 942, maxLines: 2, maxHeight: 148, minPx: 31, maxPx: 145, weight: 700, family: sans, lineHeight: 1.02 },
    { maxWidth: 1267, minPx: 38, maxPx: 79, weight: 600, family: mono, lineHeight: 1 },
    { maxWidth: 536, maxLines: 10, maxHeight: 360, minPx: 22, maxPx: 48, weight: 500, family: sans, lineHeight: 1.28 },
    { maxWidth: 120, maxLines: 3, minPx: 10, maxPx: 60, ellipsis: '...' },
    { maxWidth: 300, maxLines: 1, minPx: 20, maxPx: 20 },
    { maxWidth: 300, maxLines: 4, minPx: 30, maxPx: 12 },
    { maxWidth: 200, maxLines: 5, minPx: 8, maxPx: 90, step: 0.5, lineHeight: 1 },
    { maxWidth: 200, maxLines: 5, minPx: 8, maxPx: 90, step: 3 },
  ];
  for (const text of strings) for (const [i, o] of options.entries()) {
    const label = `${text.slice(0, 24)}… option ${i}`;
    same(fitText(measurer(), text, o), referenceFit(measurer(), text, o), label);
  }
});

test('three thousand generated cases agree with the linear scan', () => {
  const random = rng(20261015);
  const vocabulary = ['a', 'of', 'the', 'Stock', 'Market', 'Simulator', 'TypeScript', 'WebGL', 'github.com/user/repo', 'Supercalifragilisticexpialidocious', '日本語', '🚀', 'AV', 'To', 'r.', 'x'.repeat(40), '1,000,000+'];
  const pick = (list) => list[Math.floor(random() * list.length)];
  for (let n = 0; n < 3000; n++) {
    const count = 1 + Math.floor(random() * (random() < 0.2 ? 90 : 14));
    const text = Array.from({ length: count }, () => pick(vocabulary)).join(random() < 0.1 ? '  ' : ' ');
    const minPx = 6 + Math.floor(random() * 50);
    const o = {
      maxWidth: 20 + random() * 1480,
      maxLines: random() < 0.3 ? undefined : 1 + Math.floor(random() * 12),
      maxHeight: random() < 0.5 ? undefined : 15 + random() * 600,
      minPx, maxPx: random() < 0.05 ? minPx - 5 : minPx + random() * 150,
      weight: pick([400, 500, 600, 700, 800]), family: pick([sans, mono]),
      lineHeight: random() < 0.3 ? undefined : 0.9 + random() * 0.5,
      step: pick([undefined, undefined, 1, 0.5, 3, 2.5]),
      ellipsis: pick([undefined, undefined, '...']),
    };
    same(fitText(measurer(), text, o), referenceFit(measurer(), text, o), `case ${n} (${JSON.stringify(o)} ${JSON.stringify(text.slice(0, 40))})`);
  }
});

test('the size it picks always fits and the next size up never does, even when the font measures a little unevenly', () => {
  const random = rng(7);
  for (let n = 0; n < 600; n++) {
    const text = Array.from({ length: 2 + Math.floor(random() * 30) }, () => ['Stock', 'Market', 'a', 'github.com/x/y', 'Simulator'][Math.floor(random() * 5)]).join(' ');
    // Widths rounded to a quarter pixel: not strictly proportional to the size, like a hinted face.
    const ctx = measurer(0.25);
    const o = { maxWidth: 80 + random() * 500, maxLines: 1 + Math.floor(random() * 6), minPx: 10, maxPx: 90, weight: 600, family: sans, lineHeight: 1.1 };
    const fit = fitText(ctx, text, o);
    if (fit.truncated) continue;
    for (const line of fit.lines) { ctx.font = fit.font; assert.ok(ctx.measureText(line).width <= o.maxWidth + 1e-9, `${line} fits at ${fit.px}`); }
    assert.ok(fit.lines.length <= o.maxLines);
    const up = fit.px + 2;
    if (up <= o.maxPx) {
      ctx.font = `${o.weight} ${up}px ${o.family}`;
      const wrapped = referenceWrap(ctx, text, o.maxWidth);
      assert.ok(wrapped.broke || wrapped.lines.length > o.maxLines, `${up} px would have fit, so ${fit.px} px was not the largest`);
    }
  }
});

test('it asks the font a handful of times, not once per size', () => {
  const o = { maxWidth: 536, maxLines: 10, maxHeight: 360, minPx: 22, maxPx: 48, weight: 500, family: sans, lineHeight: 1.28 };
  const long = 'Detailed description of everything this project does, from the first prototype to the production release, with many sentences. '.repeat(6).slice(0, 500);
  const a = measurer(), b = measurer();
  referenceFit(a, long, o);
  fitText(b, long, o);
  assert.ok(b.calls * 2 < a.calls, `description: ${b.calls} measureText calls against ${a.calls}`);
  const url = 'github.com/…/Designing-and-Analysing-a-Fair-Variant-of-Cinquillo';
  const u = { maxWidth: 1267, minPx: 38, maxPx: 79, weight: 600, family: mono, lineHeight: 1 };
  const c = measurer(), d = measurer();
  referenceFit(c, url, u);
  fitText(d, url, u);
  assert.ok(d.calls * 10 < c.calls, `address: ${d.calls} measureText calls against ${c.calls}`);
  // Short copy that takes the biggest size is one wrap.
  const e = measurer();
  fitText(e, 'Chess', { maxWidth: 1000, minPx: 20, maxPx: 100, weight: 700, family: sans });
  assert.equal(e.calls, 1);
});

test('the same fit again costs nothing, a changed option or text measures again, and loading fonts forgets', () => {
  const ctx = measurer();
  const o = { maxWidth: 300, maxLines: 2, minPx: 12, maxPx: 60, weight: 700, family: sans };
  const first = fitText(ctx, 'Stock Market Simulator', o);
  const spent = ctx.calls;
  assert.ok(spent > 0);
  ctx.font = '12px Elsewhere';
  const again = fitText(ctx, 'Stock Market Simulator', o);
  assert.equal(ctx.calls, spent, 'no measuring for a repeat');
  same(again, first, 'repeat');
  assert.equal(ctx.font, first.font, 'ctx.font is left at the chosen size on a repeat too (callers measure the line next)');
  assert.notEqual(again.lines, first.lines, 'callers get their own copy: nobody can corrupt what is remembered');
  again.lines.push('mutated'); again.px = 1;
  same(fitText(ctx, 'Stock Market Simulator', o), first, 'a mutated copy does not leak into the memory');
  assert.equal(ctx.calls, spent);
  fitText(ctx, 'Stock Market Simulator ', { ...o, maxWidth: 301 });
  assert.ok(ctx.calls > spent, 'another width is another fit');
  const afterOther = ctx.calls;
  fitText(ctx, 'Stock  Market   Simulator', o);
  assert.equal(ctx.calls, afterOther, 'text is remembered as it reads once whitespace is normalised');
  clearFitCache();
  fitText(ctx, 'Stock Market Simulator', o);
  assert.ok(ctx.calls > afterOther, 'clearFitCache() makes it measure again');
});

test('what one canvas measured is not handed to another', () => {
  const o = { maxWidth: 300, maxLines: 1, minPx: 10, maxPx: 60, weight: 700, family: sans };
  const narrow = measurer();
  const wide = { ...measurer(), measureText(text) { return { width: narrow.measureText(text).width * 2 }; } };
  const a = fitText(narrow, 'Stock Market', o);
  const b = fitText(wide, 'Stock Market', o);
  assert.ok(b.px < a.px, `a wider face gets smaller type (${b.px} < ${a.px})`);
});

test('a fit that was cut is remembered as cut', () => {
  const ctx = measurer();
  const o = { maxWidth: 200, maxLines: 2, minPx: 20, maxPx: 40, weight: 700, family: sans };
  const text = 'word '.repeat(80).trim();
  const first = fitText(ctx, text, o);
  assert.equal(first.truncated, true);
  const spent = ctx.calls;
  const again = fitText(ctx, text, o);
  assert.equal(ctx.calls, spent);
  same(again, first, 'cut and remembered');
  assert.ok(again.lines[again.lines.length - 1].endsWith('…'));
});
