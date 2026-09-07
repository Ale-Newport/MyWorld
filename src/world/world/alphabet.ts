/* ============================================================
   A MONOLINE ALPHABET

   The hub needs letters you can drive between, which means real
   geometry with real colliders — not text on a plane. Loading a
   typeface for that would mean shipping a font file, converting
   it to outlines and checking its licence, for eleven letters.

   So the display face is described here instead: every glyph is a
   set of polylines in a 0..1 box, baseline at y=0, cap height at
   y=1. `Type3D` sweeps a rounded profile along each stroke and
   extrudes it, which gives a geometric monoline sans — square
   proportions, single stroke weight, generous apertures. It is
   deliberately not Geist: this is signage, and it belongs to the
   world rather than to the page. The site's own typeface does the
   talking everywhere text is actually read.

   Curves are polylines. At the size these letters are built, and
   with a chamfered sweep, twelve segments on an O is more than
   the silhouette can show.
   ============================================================ */

export type Stroke = [number, number][]

/** Advance width per glyph, in the same units as the 0..1 box. */
export const GLYPH_WIDTH = 0.72
export const GLYPH_SPACING = 0.24
export const SPACE_WIDTH = 0.5

const W = GLYPH_WIDTH

/** Polyline approximation of an arc, in the glyph box. */
function arc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  from: number,
  to: number,
  segments = 10,
): Stroke {
  const out: Stroke = []
  for (let i = 0; i <= segments; i++) {
    const a = from + ((to - from) * i) / segments
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry])
  }
  return out
}

const TAU = Math.PI * 2
const half = W / 2

/** Full-height oval, used by O / Q / 0. */
const oval = (rx = half, ry = 0.5, cy = 0.5): Stroke => arc(half, cy, rx, ry, 0, TAU, 16)

export const ALPHABET: Record<string, Stroke[]> = {
  A: [
    [[0, 0], [half, 1], [W, 0]],
    [[W * 0.16, 0.34], [W * 0.84, 0.34]],
  ],
  B: [
    [[0, 0], [0, 1]],
    [[0, 1], [W * 0.55, 1]],
    ...[arc(W * 0.55, 0.75, W * 0.45, 0.25, Math.PI * 0.5, -Math.PI * 0.5, 8)],
    [[W * 0.55, 0.5], [0, 0.5]],
    [[0, 0.5], [W * 0.6, 0.5]],
    ...[arc(W * 0.6, 0.25, W * 0.4, 0.25, Math.PI * 0.5, -Math.PI * 0.5, 8)],
    [[W * 0.6, 0], [0, 0]],
  ],
  C: [arc(half, 0.5, half, 0.5, Math.PI * 0.32, Math.PI * 1.68, 14)],
  D: [
    [[0, 0], [0, 1]],
    [[0, 1], [W * 0.4, 1]],
    ...[arc(W * 0.4, 0.5, W * 0.6, 0.5, Math.PI * 0.5, -Math.PI * 0.5, 12)],
    [[W * 0.4, 0], [0, 0]],
  ],
  E: [
    [[W, 1], [0, 1], [0, 0], [W, 0]],
    [[0, 0.5], [W * 0.82, 0.5]],
  ],
  F: [
    [[W, 1], [0, 1], [0, 0]],
    [[0, 0.52], [W * 0.78, 0.52]],
  ],
  G: [
    ...[arc(half, 0.5, half, 0.5, Math.PI * 0.32, Math.PI * 1.68, 14)],
    [[W, 0.42], [W, 0.14]],
    [[W * 0.52, 0.42], [W, 0.42]],
  ],
  H: [
    [[0, 0], [0, 1]],
    [[W, 0], [W, 1]],
    [[0, 0.5], [W, 0.5]],
  ],
  I: [[[half, 0], [half, 1]]],
  J: [
    [[W, 1], [W, 0.28]],
    ...[arc(W * 0.5, 0.28, W * 0.5, 0.28, 0, Math.PI, 8)],
  ],
  K: [
    [[0, 0], [0, 1]],
    [[W, 1], [0, 0.46]],
    [[W * 0.28, 0.62], [W, 0]],
  ],
  L: [[[0, 1], [0, 0], [W, 0]]],
  M: [[[0, 0], [0, 1], [half, 0.4], [W, 1], [W, 0]]],
  N: [[[0, 0], [0, 1], [W, 0], [W, 1]]],
  O: [oval()],
  P: [
    [[0, 0], [0, 1]],
    [[0, 1], [W * 0.5, 1]],
    ...[arc(W * 0.5, 0.74, W * 0.5, 0.26, Math.PI * 0.5, -Math.PI * 0.5, 9)],
    [[W * 0.5, 0.48], [0, 0.48]],
  ],
  Q: [
    oval(),
    [[W * 0.6, 0.28], [W * 1.02, -0.06]],
  ],
  R: [
    [[0, 0], [0, 1]],
    [[0, 1], [W * 0.5, 1]],
    ...[arc(W * 0.5, 0.74, W * 0.5, 0.26, Math.PI * 0.5, -Math.PI * 0.5, 9)],
    [[W * 0.5, 0.48], [0, 0.48]],
    [[W * 0.4, 0.48], [W, 0]],
  ],
  S: [
    ...[arc(W * 0.5, 0.76, W * 0.5, 0.24, Math.PI * 0.36, Math.PI * 1.6, 10)],
    ...[arc(W * 0.5, 0.26, W * 0.5, 0.26, Math.PI * 1.36, Math.PI * 2.62, 10)],
  ],
  T: [
    [[0, 1], [W, 1]],
    [[half, 1], [half, 0]],
  ],
  U: [
    [[0, 1], [0, 0.3]],
    ...[arc(half, 0.3, half, 0.3, Math.PI, TAU, 10)],
    [[W, 0.3], [W, 1]],
  ],
  V: [[[0, 1], [half, 0], [W, 1]]],
  W: [[[0, 1], [W * 0.24, 0], [half, 0.62], [W * 0.76, 0], [W, 1]]],
  X: [
    [[0, 1], [W, 0]],
    [[0, 0], [W, 1]],
  ],
  Y: [
    [[0, 1], [half, 0.5]],
    [[W, 1], [half, 0.5]],
    [[half, 0.5], [half, 0]],
  ],
  Z: [[[0, 1], [W, 1], [0, 0], [W, 0]]],

  '0': [oval(), [[W * 0.18, 0.2], [W * 0.82, 0.8]]],
  '1': [
    [[W * 0.2, 0.78], [half, 1], [half, 0]],
    [[W * 0.16, 0], [W * 0.84, 0]],
  ],
  '2': [
    ...[arc(half, 0.72, half, 0.28, Math.PI, -Math.PI * 0.1, 10)],
    [[W, 0.6], [0, 0]],
    [[0, 0], [W, 0]],
  ],
  '3': [
    ...[arc(W * 0.5, 0.75, W * 0.46, 0.25, Math.PI * 0.9, -Math.PI * 0.45, 10)],
    ...[arc(W * 0.5, 0.26, W * 0.5, 0.26, Math.PI * 0.42, Math.PI * 1.1, 10)],
    [[W * 0.3, 0.5], [W * 0.62, 0.5]],
  ],
  '4': [
    [[W * 0.72, 0], [W * 0.72, 1], [0, 0.3], [W, 0.3]],
  ],
  '5': [
    [[W, 1], [W * 0.12, 1], [W * 0.06, 0.56]],
    ...[arc(W * 0.5, 0.3, W * 0.5, 0.3, Math.PI * 0.62, -Math.PI * 0.75, 12)],
  ],
  '6': [
    ...[arc(half, 0.3, half, 0.3, 0, TAU, 12)],
    ...[arc(half, 0.56, W * 0.52, 0.44, Math.PI * 0.98, Math.PI * 0.42, 8)],
  ],
  '7': [[[0, 1], [W, 1], [W * 0.3, 0]]],
  '8': [
    ...[arc(half, 0.75, W * 0.42, 0.25, 0, TAU, 12)],
    ...[arc(half, 0.27, half, 0.27, 0, TAU, 12)],
  ],
  '9': [
    ...[arc(half, 0.7, half, 0.3, 0, TAU, 12)],
    ...[arc(half, 0.44, W * 0.52, 0.44, Math.PI * 1.98, Math.PI * 1.42, 8)],
  ],

  '.': [[[half - 0.02, 0], [half + 0.02, 0]]],
  ',': [[[half, 0.08], [half - 0.1, -0.16]]],
  '-': [[[W * 0.12, 0.5], [W * 0.88, 0.5]]],
  '/': [[[0, 0], [W, 1]]],
  '&': [
    ...[arc(W * 0.4, 0.8, W * 0.28, 0.2, 0, TAU, 10)],
    ...[arc(W * 0.38, 0.26, W * 0.38, 0.26, Math.PI * 0.4, Math.PI * 1.7, 10)],
    [[W * 0.62, 0.44], [W, 0]],
  ],
  '+': [
    [[W * 0.16, 0.5], [W * 0.84, 0.5]],
    [[half, 0.16], [half, 0.84]],
  ],
  '{': [
    [[W * 0.78, 1], [W * 0.42, 1], [W * 0.42, 0.58], [W * 0.1, 0.5], [W * 0.42, 0.42], [W * 0.42, 0], [W * 0.78, 0]],
  ],
  '}': [
    [[W * 0.22, 1], [W * 0.58, 1], [W * 0.58, 0.58], [W * 0.9, 0.5], [W * 0.58, 0.42], [W * 0.58, 0], [W * 0.22, 0]],
  ],
  '?': [
    ...[arc(half, 0.76, W * 0.44, 0.24, Math.PI * 1.05, -Math.PI * 0.35, 10)],
    [[half, 0.52], [half, 0.3]],
    [[half - 0.02, 0.1], [half + 0.02, 0.1]],
  ],
  '!': [
    [[half, 1], [half, 0.28]],
    [[half - 0.02, 0.08], [half + 0.02, 0.08]],
  ],
  '·': [[[half - 0.02, 0.44], [half + 0.02, 0.44]]],
}

/** Total advance width of a string in glyph units. */
export function measure(text: string): number {
  let width = 0
  for (const char of text.toUpperCase()) {
    if (char === ' ') {
      width += SPACE_WIDTH + GLYPH_SPACING
      continue
    }
    if (!ALPHABET[char]) continue
    width += GLYPH_WIDTH + GLYPH_SPACING
  }
  return Math.max(0, width - GLYPH_SPACING)
}

/** True when every character can be drawn. Used by a dev-time check. */
export function canRender(text: string): boolean {
  for (const char of text.toUpperCase()) {
    if (char === ' ') continue
    if (!ALPHABET[char]) return false
  }
  return true
}
