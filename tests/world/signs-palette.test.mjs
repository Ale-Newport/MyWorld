import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SWATCH, PALETTE_HEX, TOKENS, paletteU, paletteUV, swatchOf, recolorPalette, swatchHistogram, contrastRatio } from '../../public/archipelago/preview/portfolio/world2/signs/palette.js';
import { SIGN_THEMES, themeForProject, themeById, DEFAULT_THEME, MOTION_THEME } from '../../public/archipelago/preview/portfolio/world2/signs/themes.js';

test('paletteUV addresses the middle of a 4 px swatch of the 32 swatch atlas', () => {
  assert.deepEqual(paletteUV(0), [0.5 / 32, 0.5]);
  assert.deepEqual(paletteUV(14), [14.5 / 32, 0.5]);
  assert.equal(paletteU(31), 31.5 / 32);
  // Out-of-range indices clamp instead of sampling outside the atlas.
  assert.equal(paletteU(-3), 0.5 / 32);
  assert.equal(paletteU(99), 31.5 / 32);
  for (let i = 0; i < 32; i++) assert.equal(swatchOf(paletteU(i)), i, `swatchOf inverts paletteU at ${i}`);
  assert.equal(swatchOf(1), 31, 'u = 1 stays inside the last swatch');
});

test('the swatch table matches the colours the level ships', () => {
  assert.equal(PALETTE_HEX.length, 24);
  assert.equal(PALETTE_HEX[SWATCH.grey], '#7c7691');
  assert.equal(PALETTE_HEX[SWATCH.purple], '#c365ef');
  assert.equal(PALETTE_HEX[SWATCH.pink], '#ed72a0');
  assert.equal(PALETTE_HEX[SWATCH.lightOrange], '#f8a658');
  assert.equal(PALETTE_HEX[SWATCH.copper], '#b36d45');
});

function quad(swatches) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(swatches.length * 3), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(swatches.flatMap(s => [paletteU(s), 0.5]), 2));
  return geometry;
}

test('recolorPalette moves only the listed swatches, leaves v alone and never mutates a shared attribute', () => {
  const geometry = quad([0, 0, 18, 21, 14, 0]);
  const before = geometry.getAttribute('uv');
  const mesh = new THREE.Mesh(geometry);
  const changed = recolorPalette(mesh, { [SWATCH.grey]: SWATCH.woodDark, [SWATCH.pink]: SWATCH.dark, [SWATCH.orange]: SWATCH.gold });
  assert.equal(changed, 4);
  assert.deepEqual(swatchHistogram(mesh), { [SWATCH.woodDark]: 3, [SWATCH.lightOrange]: 1, [SWATCH.dark]: 1, [SWATCH.copper]: 1 });
  for (let i = 0; i < geometry.getAttribute('uv').count; i++) assert.equal(geometry.getAttribute('uv').getY(i), 0.5);
  assert.notEqual(geometry.getAttribute('uv'), before, 'a fresh attribute replaces the old one');
  assert.equal(before.getX(0), paletteU(0), 'the original attribute is untouched');
  assert.equal(recolorPalette(mesh, { [SWATCH.grey]: SWATCH.woodDark }), 0, 'nothing left to move is a no-op');
  assert.equal(recolorPalette(mesh, { [SWATCH.dark]: SWATCH.dark }), 0, 'mapping a swatch onto itself changes nothing');
});

test('every text and background pair the kit paints is legible', () => {
  const pairs = [
    ['ink on paper', TOKENS.ink, TOKENS.paper, 12],
    ['ink on paperHi', TOKENS.ink, TOKENS.paperHi, 13],
    ['ink2 on paper (descriptions)', TOKENS.ink2, TOKENS.paper, 7],
    ['cream on woodDeep (plank, label)', TOKENS.cream, TOKENS.woodDeep, 8],
    ['cream on woodDark (title plate, url tag)', TOKENS.cream, TOKENS.woodDark, 7],
    ['chalk on woodDeep (sublines)', TOKENS.chalk, TOKENS.woodDeep, 5.5],
    ['chalk on woodDark', TOKENS.chalk, TOKENS.woodDark, 5.5],
    ['ink on timber (attribute tags on orange rails)', TOKENS.ink, TOKENS.timber, 7],
    ['ink on gold', TOKENS.ink, TOKENS.gold, 7],
  ];
  for (const [name, fg, bg, min] of pairs) assert.ok(contrastRatio(fg, bg) >= min, `${name}: ${contrastRatio(fg, bg).toFixed(2)} < ${min}`);
  for (const theme of Object.values(SIGN_THEMES)) {
    assert.ok(contrastRatio(theme.ribbonInk, theme.ribbon) >= 4.5, `${theme.id} ribbon lettering ${contrastRatio(theme.ribbonInk, theme.ribbon).toFixed(2)}`);
  }
});

test('themes: every project motion resolves, category is the fallback, unknown ids get the default', () => {
  for (const [motion, id] of Object.entries(MOTION_THEME)) {
    assert.ok(SIGN_THEMES[id], `${motion} -> ${id} exists`);
    assert.equal(themeForProject({ motion }).id, id);
  }
  assert.equal(themeForProject({ motion: 'NoSuchMotion', category: 'Web' }).id, 'browser');
  assert.equal(themeForProject({ motion: null, category: null }), DEFAULT_THEME);
  assert.equal(themeById('nope'), DEFAULT_THEME);
  assert.equal(themeById('plain').emblem, null);
});
