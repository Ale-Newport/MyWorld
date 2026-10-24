import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitText, ellipsize } from '../../public/archipelago/preview/portfolio/world2/signs/paint.js';

/** Every glyph is half an em wide: a stand-in for a canvas that needs no fonts. */
const measurer = () => ({
  font: '',
  measureText(text) { const px = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10); return { width: text.length * px * 0.5 }; },
});
const base = { family: 'Test', weight: 700 };

test('text that fits at the largest size is left alone', () => {
  const ctx = measurer();
  const fit = fitText(ctx, 'Chess', { ...base, maxWidth: 1000, minPx: 20, maxPx: 100 });
  assert.deepEqual(fit.lines, ['Chess']);
  assert.equal(fit.px, 100);
  assert.equal(fit.truncated, false);
  assert.match(ctx.font, /^700 100px Test$/);
});

test('it shrinks before it wraps and wraps before it cuts', () => {
  const ctx = measurer();
  // 22 glyphs * 0.5 em: 1100 px at 100 px type, so a 600 px line needs <= 54 px.
  const one = fitText(ctx, 'Stock Market Simulator', { ...base, maxWidth: 600, minPx: 20, maxPx: 100, maxLines: 1 });
  assert.equal(one.lines.length, 1);
  assert.ok(one.px <= 54 && one.px >= 52, `one line at ${one.px}`);
  // With two lines allowed the largest size that fits is bigger than the one-line size would be.
  const two = fitText(ctx, 'Stock Market Simulator', { ...base, maxWidth: 600, minPx: 20, maxPx: 100, maxLines: 2 });
  assert.equal(two.lines.length, 2);
  assert.ok(two.px > one.px);
  for (const line of two.lines) assert.ok(ctx.measureText(line).width <= 600);
});

test('a block budget (maxHeight) limits the size as well as the width', () => {
  const ctx = measurer();
  const fit = fitText(ctx, 'one two three four five six seven eight', { ...base, maxWidth: 200, maxLines: 6, maxHeight: 90, minPx: 10, maxPx: 60, lineHeight: 1.2 });
  assert.ok(fit.height <= 90 + 1e-6, `block ${fit.height}`);
  assert.equal(fit.truncated, false);
});

test('what cannot fit is ellipsized, never squeezed and never silently dropped', () => {
  const ctx = measurer();
  const text = 'a '.repeat(200).trim();
  const fit = fitText(ctx, text, { ...base, maxWidth: 300, maxLines: 3, minPx: 20, maxPx: 40 });
  assert.equal(fit.px, 20, 'bottoms out at the minimum size');
  assert.equal(fit.lines.length, 3);
  assert.equal(fit.truncated, true);
  assert.ok(fit.lines[2].endsWith('…'), 'the last line says it was cut');
  for (const line of fit.lines) assert.ok(ctx.measureText(line).width <= 300 + 1e-6, 'no line is wider than the box');
  // The same words that did fit are not marked as cut.
  assert.equal(fitText(ctx, 'a b c', { ...base, maxWidth: 300, maxLines: 3, minPx: 20, maxPx: 40 }).truncated, false);
});

test('a single word wider than the box is broken by characters', () => {
  const ctx = measurer();
  const fit = fitText(ctx, 'Supercalifragilisticexpialidocious', { ...base, maxWidth: 100, maxLines: 5, minPx: 20, maxPx: 20 });
  assert.ok(fit.lines.length > 1);
  assert.equal(fit.lines.join(''), 'Supercalifragilisticexpialidocious');
  for (const line of fit.lines) assert.ok(ctx.measureText(line).width <= 100 + 1e-6);
});

test('a long word shrinks the type before it is ever broken in half', () => {
  const ctx = measurer();
  // 9 glyphs: 100 px wide at 22 px type, so a 100 px box needs <= 22 px to keep KEYFRAMES whole.
  const fit = fitText(ctx, 'KEYFRAMES', { ...base, maxWidth: 100, maxLines: 3, minPx: 10, maxPx: 60 });
  assert.deepEqual(fit.lines, ['KEYFRAMES']);
  assert.ok(fit.px <= 22 && fit.px >= 20, `shrunk to ${fit.px}`);
  // Two words that fit on their own lines at one size are wrapped between the words.
  assert.deepEqual(fitText(ctx, 'STOCK MARKET', { ...base, maxWidth: 120, maxLines: 2, minPx: 10, maxPx: 22 }).lines, ['STOCK', 'MARKET']);
});

test('empty and whitespace-only text yields no lines; whitespace is normalised', () => {
  const ctx = measurer();
  assert.deepEqual(fitText(ctx, '   ', { ...base, maxWidth: 100, minPx: 10, maxPx: 20 }).lines, []);
  assert.deepEqual(fitText(ctx, 'a\n\n b\t c', { ...base, maxWidth: 1000, minPx: 10, maxPx: 20 }).lines, ['a b c']);
});

test('ellipsize keeps the longest prefix that fits with the ellipsis', () => {
  const ctx = measurer(); ctx.font = '10px Test';
  assert.equal(ellipsize(ctx, 'short', 100), 'short');
  const cut = ellipsize(ctx, 'abcdefghijklmnopqrstuvwxyz', 60);
  assert.ok(cut.endsWith('…') && ctx.measureText(cut).width <= 60);
  assert.ok(ctx.measureText(cut.slice(0, -1) + 'x…').width > 60, 'one more character would not fit');
});
