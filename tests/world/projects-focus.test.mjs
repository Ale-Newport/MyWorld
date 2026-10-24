import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusFraming } from '../../public/archipelago/preview/portfolio/world2/interactions/Projects.js';

/** The camera the View used before: upstream's offset (12.4 authored units) plus 10 world metres of pull-back per unit of narrowness, 0.768 world metres to a unit. */
const legacyDistance = (ratio, scale = 0.768) => 12.4 + Math.max(0, 16 / 9 / ratio - 1) * 10 / scale;
const FOV = 25;
const visibleWidth = (distance, ratio) => 2 * distance * Math.tan(FOV * Math.PI / 360) * ratio;

test('a wide window keeps the whole-board framing untouched (null: the View pulls back as it always did)', () => {
  for (const ratio of [16 / 9, 1.6, 1.5, 1.35, 21 / 9, 2.16]) assert.equal(focusFraming(ratio, FOV), null, `ratio ${ratio}`);
});

test('nothing sensible to frame for a degenerate window', () => {
  for (const ratio of [0, -1, NaN, undefined]) assert.equal(focusFraming(ratio, FOV), null);
});

test('a phone in portrait frames the 4-unit screen across at least 300 of 390 px', () => {
  const ratio = 390 / 844;
  const { distance, centred } = focusFraming(ratio, FOV);
  const screenPx = 4 / visibleWidth(distance, ratio) * 390;
  assert.ok(screenPx >= 300 && screenPx <= 360, `the screen is ${screenPx.toFixed(0)} px wide`);
  assert.equal(centred, 1, 'the camera aims at the screen itself');
  // Before: the pull-back put the camera 3.9 times as far away and the screen at ~40% of the width.
  const before = 4 / visibleWidth(legacyDistance(ratio), ratio) * 390;
  assert.ok(before < 170, `it was ${before.toFixed(0)} px`);
  assert.ok(screenPx > 1.8 * before);
});

test('a portrait tablet is framed to the screen too, and never nearer than the upstream pose', () => {
  const ratio = 834 / 1112;
  const { distance } = focusFraming(ratio, FOV);
  assert.ok(distance >= 12.4 && distance < legacyDistance(ratio));
  assert.ok(4 / visibleWidth(distance, ratio) <= 0.9, 'the screen leaves a margin');
});

test('the blend is continuous with the whole-board framing at its wide end and never moves closer as the window widens', () => {
  const edge = focusFraming(1.3499, FOV);
  assert.ok(Math.abs(edge.distance - legacyDistance(1.3499)) / legacyDistance(1.3499) < 0.03, `${edge.distance} vs ${legacyDistance(1.3499)}`);
  assert.ok(edge.centred < 0.01);
  let last = 0, centred = 1;
  for (let ratio = 0.3; ratio < 1.35; ratio += 0.01) {
    const f = focusFraming(ratio, FOV);
    assert.ok(f.distance > 0 && Number.isFinite(f.distance));
    assert.ok(f.centred <= centred + 1e-9, 'aim moves from the screen toward the board as the window widens');
    centred = f.centred;
    // Visible width across the target grows with the ratio: more of the board is shown in a wider window.
    const width = visibleWidth(f.distance, ratio);
    assert.ok(width >= last - 1e-9, `visible width ${width} at ratio ${ratio.toFixed(2)}`);
    last = width;
  }
});

test('the field of view is honoured: a narrower lens stands further back for the same frame', () => {
  assert.ok(focusFraming(0.5, 20).distance > focusFraming(0.5, 25).distance);
});
