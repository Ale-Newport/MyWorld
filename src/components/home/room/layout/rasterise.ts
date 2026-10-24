/* ============================================================
   ONE CHAPTER'S COPY, RASTERISED

   The reading field's arithmetic, on its own: no imports, so a test
   can load it, and nothing here knows about the page. A box of copy
   becomes a soft rounded plateau of 1 with a Gaussian skirt, the
   plateaus of a chapter are merged by their maximum, and the result
   is blurred a little so the edge is organic and not a stencil of
   the type.

   Two things keep it cheap enough to run while a page is being
   scrolled (it used to be most of the cost of a read):

     · the skirt is separable — exp(-(dx² + dy²) / f²) is
       exp(-dx² / f²) · exp(-dy² / f²) — so a box evaluates its
       exponentials once per column and once per row and every cell
       costs a multiply, not a hypot and an exp;
     · the field is zero away from the copy, so the blur runs only
       over the part of the grid the boxes reach (plus the blur's
       own radius), which is exact: a window of zeros sums to zero.
   ============================================================ */

/** The part of a measured line this needs. */
export interface RasterBox {
  x: number
  y: number
  w: number
  h: number
  /** Font size in CSS px. */
  px: number
}

/** The clearances of `ROOM_CONFIG.clearance` that shape a box's skirt. */
export interface Clearance {
  displayEm: number
  displayMax: number
  bodyEm: number
  labelEm: number
  base: number
  blur: number
}

/** Cells a piece of work is allowed to touch before it offers the thread back (about a quarter of a millisecond). */
const PIECE = 24000

/**
 * @param boxes  lines of copy, in viewport px
 * @param vw     viewport size, px
 * @param gw     the grid the field is rasterised on
 * @returns      gw * gh values in 0..1, row 0 at the top
 */
export function rasteriseBoxes(boxes: readonly RasterBox[], vw: number, vh: number, gw: number, gh: number, C: Clearance): Float32Array {
  const steps = rasteriseSteps(boxes, vw, vh, gw, gh, C)
  for (;;) {
    const r = steps.next()
    if (r.done) return r.value
  }
}

/** The same, in pieces: it yields every so often, and returns the field. */
export function* rasteriseSteps(boxes: readonly RasterBox[], vw: number, vh: number, gw: number, gh: number, C: Clearance): Generator<void, Float32Array> {
  const cell = vw / gw
  const data = new Float32Array(gw * gh)
  const out = new Float32Array(gw * gh)
  if (!boxes.length) return out
  const short = Math.min(vw, vh)
  // The part of the grid any box reaches.
  let bx0 = gw
  let bx1 = -1
  let by0 = gh
  let by1 = -1
  const ex = new Float64Array(gw)
  let spent = 0
  for (const b of boxes) {
    if (spent >= PIECE) {
      spent = 0
      yield
    }
    const display = b.px >= 28
    // Line boxes of display type are taller than the glyphs.
    const trim = display ? b.h * 0.14 : 0
    const em = display ? Math.min(C.displayEm * b.px, C.displayMax) : b.px >= 16 ? C.bodyEm * b.px : C.labelEm * b.px
    const m = em + C.base * short
    const x0 = b.x - m
    const x1 = b.x + b.w + m
    const y0 = b.y + trim - m
    const y1 = b.y + b.h - trim + m
    const fall = m * 0.6 + cell
    const ff = fall * fall
    const gx0 = Math.max(0, Math.floor((x0 - fall * 2) / cell))
    const gx1 = Math.min(gw - 1, Math.ceil((x1 + fall * 2) / cell))
    const gy0 = Math.max(0, Math.floor((y0 - fall * 2) / cell))
    const gy1 = Math.min(gh - 1, Math.ceil((y1 + fall * 2) / cell))
    if (gx0 > gx1 || gy0 > gy1) continue
    if (gx0 < bx0) bx0 = gx0
    if (gx1 > bx1) bx1 = gx1
    if (gy0 < by0) by0 = gy0
    if (gy1 > by1) by1 = gy1
    for (let gx = gx0; gx <= gx1; gx++) {
      const px = (gx + 0.5) * cell
      const dx = Math.max(x0 - px, 0, px - x1)
      ex[gx] = dx > 0 ? Math.exp(-(dx * dx) / ff) : 1
    }
    spent += (gx1 - gx0 + 1) * (gy1 - gy0 + 1)
    for (let gy = gy0; gy <= gy1; gy++) {
      const py = (gy + 0.5) * cell
      const dy = Math.max(y0 - py, 0, py - y1)
      const ey = dy > 0 ? Math.exp(-(dy * dy) / ff) : 1
      const row = gy * gw
      for (let gx = gx0; gx <= gx1; gx++) {
        const v = ex[gx] * ey
        if (v > data[row + gx]) data[row + gx] = v
      }
    }
  }
  if (bx1 < 0) return out
  // A light blur: an organic edge, not a stencil of the text.
  const rad = Math.max(1, Math.round((C.blur * short) / cell))
  const kernel = new Float64Array(2 * rad + 1)
  let ks = 0
  for (let i = -rad; i <= rad; i++) {
    const w = Math.exp(-(i * i) / (2 * (rad / 2) * (rad / 2)))
    kernel[i + rad] = w
    ks += w
  }
  // Where the blurred field can be non-zero.
  const rx0 = Math.max(0, bx0 - rad)
  const rx1 = Math.min(gw - 1, bx1 + rad)
  const ry0 = Math.max(0, by0 - rad)
  const ry1 = Math.min(gh - 1, by1 + rad)
  const tmp = new Float32Array(gw * gh)
  // Rows between two offers of the thread (a pass costs rad * 2 + 1 taps a cell).
  const rows = Math.max(4, Math.ceil(PIECE / ((rx1 - rx0 + 1) * (2 * rad + 1))))
  // Horizontal: edge cells repeat, as the window runs off the grid.
  for (let y = ry0; y <= ry1; y++) {
    if ((y - ry0) % rows === rows - 1) yield
    const row = y * gw
    for (let x = rx0; x <= rx1; x++) {
      let s = 0
      if (x >= rad && x + rad < gw) {
        for (let i = -rad; i <= rad; i++) s += data[row + x + i] * kernel[i + rad]
      } else {
        for (let i = -rad; i <= rad; i++) s += data[row + Math.min(gw - 1, Math.max(0, x + i))] * kernel[i + rad]
      }
      tmp[row + x] = s / ks
    }
  }
  // Vertical, and the field keeps at least 90 % of the unblurred value.
  for (let y = ry0; y <= ry1; y++) {
    if ((y - ry0) % rows === rows - 1) yield
    const interior = y >= rad && y + rad < gh
    for (let x = rx0; x <= rx1; x++) {
      let s = 0
      if (interior) {
        for (let i = -rad; i <= rad; i++) s += tmp[(y + i) * gw + x] * kernel[i + rad]
      } else {
        for (let i = -rad; i <= rad; i++) s += tmp[Math.min(gh - 1, Math.max(0, y + i)) * gw + x] * kernel[i + rad]
      }
      out[y * gw + x] = Math.max(s / ks, data[y * gw + x] * 0.9)
    }
  }
  return out
}
