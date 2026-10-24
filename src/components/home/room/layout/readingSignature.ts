/* ============================================================
   WHERE THE COPY STANDS, IN ONE NUMBER

   Measuring the page's copy is a walk over every line of text;
   rasterising the reading field from it is more. When a
   measurement finds every line where the last one left it
   there is nothing to plan again, and this is how that is
   told: a cheap hash of the boxes (quantised to 4 px, so a
   sub-pixel settle is not a change) and the grid they are
   rasterised on.

   No imports: the room's other layout code pulls in its config,
   and this is the part a test can load on its own.
   ============================================================ */

/** The part of a measured line this needs. */
export interface SignedBox {
  x: number
  y: number
  w: number
  /** Font size in CSS px. */
  px: number
}

/** The grid the field is rasterised on for a viewport (rows follow the aspect). */
export function readingGrid(vw: number, vh: number) {
  const gw = 192
  return { gw, gh: Math.max(16, Math.round((gw * vh) / vw)) }
}

export function readingSignature(boxes: readonly SignedBox[], gw: number, gh: number): number {
  let sig = gw * 31 + gh
  for (const b of boxes) sig = (sig * 33 + Math.round(b.x / 4) * 7 + Math.round(b.y / 4) * 13 + Math.round(b.w / 4) + Math.round(b.px)) | 0
  return sig
}

/**
 * The same idea at the precision a raster needs: half a pixel, and the line's height too (the field's skirt
 * follows it). A chapter whose boxes still sign the same has the raster it had.
 */
export function rasterSignature(boxes: readonly (SignedBox & { h: number })[]): number {
  let sig = boxes.length
  for (const b of boxes) sig = (sig * 33 + Math.round(b.x * 2) * 7 + Math.round(b.y * 2) * 13 + Math.round(b.w * 2) * 5 + Math.round(b.h * 2) * 3 + Math.round(b.px * 2)) | 0
  return sig
}
