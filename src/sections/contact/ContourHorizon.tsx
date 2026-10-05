'use client'

import type { ContactAnimationProps } from '../types'
import { css, lerp, mix, rng, sd, smooth, useContactCanvas, type Painter } from './shared'

/* ============================================================
   CONTOUR HORIZON

   A survey map of open country laid around the closing words: hills
   and valleys drawn as contour lines, layered more and more closely
   toward the foot of the free ground, so the land reads as deepening
   into a horizon below the words. Around the words themselves the
   map opens into a clearing, and it thins away as it nears every
   other line of text. Every fourth line is an index contour, a little
   heavier, as on a survey sheet; all are in the brown of the garden's
   stems.

   As the section scrolls the map is drawn from the top down, the
   close-packed lines toward the horizon last. Once it is whole the
   land drifts slowly sideways and the levels flow down toward the
   horizon, so lines are always rising out of the top of the map and
   settling into the distance.

   The lines are isolines of a height field, traced only in grid cells
   that are clear of every safe rectangle (and of the HUD) by more
   than a cell's reach; the map's own edge — the clearing and its
   thinning toward text — is a mask that is zero well before that.

   intensity → number of contours · speed → the drift
   ============================================================ */

const PAD = 2.5
const LAT = 64

interface Scene {
  cols: number; rows: number; cell: number
  /** The strata at each grid point (the horizon term), before the terrain. */
  base: Float32Array
  /** Cells that may be traced at all. */
  open: Uint8Array
  lattice: Float32Array
  freq: number
  amp: number
  levels: number
  spacing: number
  /** The map's edge: opaque where it may be seen, clear around the words. */
  mask: HTMLCanvasElement | null
  w: number; h: number
  ink: { line: string; index: string }
}

/** Smooth value noise on a wrapping lattice. */
function noise(lat: Float32Array, x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const fx = x - xi, fy = y - yi
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy)
  const i0 = ((xi % LAT) + LAT) % LAT, j0 = ((yi % LAT) + LAT) % LAT
  const i1 = (i0 + 1) % LAT, j1 = (j0 + 1) % LAT
  const a = lat[j0 * LAT + i0], b = lat[j0 * LAT + i1], c = lat[j1 * LAT + i0], d = lat[j1 * LAT + i1]
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy)
}

const painter: Painter<Scene> = {
  compose(stage, intensity, pal) {
    const { w, h, keep, top, foot, head, u } = stage
    const cell = Math.max(7, Math.sqrt((w * h) / 16000))
    const cols = Math.ceil(w / cell) + 1, rows = Math.ceil(h / cell) + 1
    const levels = Math.round(lerp(14, 34, intensity))
    const spacing = 1 / levels
    // The strata: level k at (k / levels) ^ (1 / 1.7) of the way down — closer and closer toward the foot.
    const base = new Float32Array(cols * rows)
    for (let j = 0; j < rows; j++) {
      const yr = Math.max(0, Math.min(1, (j * cell - top) / Math.max(1, foot - top)))
      const v = yr ** 1.7
      for (let i = 0; i < cols; i++) base[j * cols + i] = v
    }
    // Never traced: cells within a cell's reach of a safe rectangle or the HUD.
    const open = new Uint8Array(cols * rows)
    const need = PAD + 1.2 + cell * 0.72
    const corner = new Float32Array(cols * rows)
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) corner[j * cols + i] = sd(keep, i * cell, j * cell)
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const k = j * cols + i
        open[k] = Math.min(corner[k], corner[k + 1], corner[k + cols], corner[k + cols + 1]) >= need ? 1 : 0
      }
    }
    // The map's edge, at a quarter of the resolution: a clearing around the words, and a thinning toward any other text.
    let mask: HTMLCanvasElement | null = null
    if (typeof document !== 'undefined') {
      const q = 4
      const mw = Math.ceil(w / q), mh = Math.ceil(h / q)
      mask = document.createElement('canvas')
      mask.width = mw
      mask.height = mh
      const mctx = mask.getContext('2d')
      if (mctx) {
        const img = mctx.createImageData(mw, mh)
        const fade = 30 * Math.max(0.6, u)
        /* The clearing: a little room around the words, then the map comes
           in over a soft edge. On a phone the only free ground is a thin
           band above the words, so the clearing there is a hairline's. */
        const roomy = Math.min(1, Math.max(0.2, (u - 0.3) * 1.6))
        const c0 = (8 + 30 * u) * roomy, c1 = (30 + 70 * u) * roomy
        for (let j = 0; j < mh; j++) {
          for (let i = 0; i < mw; i++) {
            const x = (i + 0.5) * q, y = (j + 0.5) * q
            let a = smooth(need + 2, need + 2 + fade, sd(keep, x, y))
            if (head) a *= smooth(c0, c0 + c1, sd([head], x, y))
            img.data[(j * mw + i) * 4 + 3] = Math.round(a * 255)
          }
        }
        mctx.putImageData(img, 0, 0)
      }
    }
    const r = rng(0x70b0)
    const lattice = new Float32Array(LAT * LAT * 2)
    for (let i = 0; i < lattice.length; i++) lattice[i] = r() * 2 - 1
    return {
      cols, rows, cell, base, open, lattice, mask, w, h,
      freq: 1 / Math.max(150, Math.min(w, h) * 0.34),
      // Hills about four levels high: enough for closed rings on the tops, not enough to scramble the strata.
      amp: 4.2 * spacing,
      levels,
      spacing,
      ink: { line: css(mix(pal.stem, pal.ink3, 0.35), 0.52), index: css(mix(pal.stem, pal.ink2, 0.4), 0.72) },
    }
  },

  draw(ctx, sc, f) {
    const { cols, rows, cell, base, open, lattice, freq, levels, spacing } = sc
    const drift = f.still ? 0 : f.t * 0.016
    // The levels flow down toward the horizon, one spacing every so often.
    const flow = f.still ? 0 : (f.t * 0.04) % 1
    const lat2 = lattice.subarray(LAT * LAT)
    const F = new Float32Array(cols * rows)
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i
        const x = i * cell * freq, y = j * cell * freq
        F[k] = base[k] + sc.amp * (noise(lattice, x + drift, y * 1.5) * 0.7 + noise(lat2, x * 2.2 - drift * 1.3, y * 3 + 9) * 0.3)
      }
    }
    // Drawn from the top down as the section scrolls, the close lines at the horizon last.
    const reveal = lerp(-2, levels + 2, smooth(0.06, 0.64, f.p))
    const ex = [0, 0, 0, 0], ey = [0, 0, 0, 0]
    ctx.lineCap = 'round'
    for (let l = -2; l < levels + 2; l++) {
      const lv = l + flow
      const alpha = smooth(-2, 0.5, lv) * smooth(levels + 2, levels, lv) * smooth(reveal, reveal - 2, lv)
      if (alpha <= 0.02) continue
      const L = lv * spacing
      // Every fourth level is an index contour; the count travels with the flow, so a line keeps its weight.
      const isIndex = ((l + (f.still ? 0 : Math.floor(f.t * 0.04))) % 4 + 4) % 4 === 0
      const path = new Path2D()
      for (let j = 0; j < rows - 1; j++) {
        for (let i = 0; i < cols - 1; i++) {
          const k = j * cols + i
          if (!open[k]) continue
          const a = F[k], b = F[k + 1], c = F[k + cols + 1], d = F[k + cols]
          const idx = (a > L ? 1 : 0) | (b > L ? 2 : 0) | (c > L ? 4 : 0) | (d > L ? 8 : 0)
          if (idx === 0 || idx === 15) continue
          const x0 = i * cell, y0 = j * cell
          // Crossings on the four edges: top, right, bottom, left.
          ex[0] = x0 + ((L - a) / (b - a)) * cell; ey[0] = y0
          ex[1] = x0 + cell; ey[1] = y0 + ((L - b) / (c - b)) * cell
          ex[2] = x0 + ((L - d) / (c - d)) * cell; ey[2] = y0 + cell
          ex[3] = x0; ey[3] = y0 + ((L - a) / (d - a)) * cell
          const seg = (p: number, q: number) => {
            path.moveTo(ex[p], ey[p])
            path.lineTo(ex[q], ey[q])
          }
          switch (idx) {
            case 1: case 14: seg(0, 3); break
            case 2: case 13: seg(0, 1); break
            case 3: case 12: seg(3, 1); break
            case 4: case 11: seg(1, 2); break
            case 6: case 9: seg(0, 2); break
            case 7: case 8: seg(2, 3); break
            case 5: if ((a + b + c + d) / 4 > L) { seg(0, 1); seg(2, 3) } else { seg(0, 3); seg(1, 2) } break
            case 10: if ((a + b + c + d) / 4 > L) { seg(0, 3); seg(1, 2) } else { seg(0, 1); seg(2, 3) } break
          }
        }
      }
      ctx.globalAlpha = alpha
      ctx.strokeStyle = isIndex ? sc.ink.index : sc.ink.line
      ctx.lineWidth = isIndex ? 1.1 : 0.7
      ctx.stroke(path)
    }
    ctx.globalAlpha = 1
    // The map's edge: the clearing around the words, the thinning toward other text and the HUD.
    if (sc.mask) {
      ctx.globalCompositeOperation = 'destination-in'
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(sc.mask, 0, 0, sc.w, sc.h)
      ctx.globalCompositeOperation = 'source-over'
    }
  },
}

export default function ContourHorizon(props: ContactAnimationProps) {
  const { rootRef, canvasRef, rootStyle, canvasStyle } = useContactCanvas('contact.contour-horizon', props, painter)
  return (
    <div ref={rootRef} style={rootStyle}>
      <canvas ref={canvasRef} style={canvasStyle} />
    </div>
  )
}
