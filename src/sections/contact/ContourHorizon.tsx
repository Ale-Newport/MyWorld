'use client'

import type { ContactAnimationProps } from '../types'
import { css, lerp, mix, rng, sd, smooth, useContactCanvas, type Painter } from './shared'

/* ============================================================
   CONTOUR HORIZON

   A topographic relief laid around the closing words: the words sit
   on a level floor and the land rises away from them, so the contour
   lines ring them at a respectful distance and turn into hills and
   valleys further out, gathering toward the foot of the free ground
   like a horizon below the words. Every fourth line is an index
   contour, a little heavier, as on a survey map; all are drawn in the
   brown of the garden's stems.

   As the section scrolls the relief forms from the edges of the stage
   inward, deepening toward the words, and once it is whole the land
   drifts — slowly, sideways — while the levels themselves creep
   outward, so lines are always being born near the words and moving
   off toward the edges.

   The lines are isolines of a height field that is below the lowest
   drawn level wherever a word is near, and the grid cells within
   reach of a safe rectangle are never traced at all.

   intensity → number of contours · speed → the drift
   ============================================================ */

const PAD = 2.5

interface Scene {
  cols: number; rows: number; cell: number
  /** Static part of the height at each grid point, and how much the terrain may move it there. */
  base: Float32Array
  weight: Float32Array
  /** Cells that may be traced (far enough from every safe rectangle). */
  open: Uint8Array
  /** Grid coordinates of the noise lattice (two octaves). */
  lattice: Float32Array
  freq: number
  levels: number
  spacing: number
  top: number
  amp: number
  /** Where the map fades toward the HUD and the foot (y from, y to, at each), and the mask made of it on the first paint. */
  band: [number, number, number, number]
  fade: CanvasGradient | null
  ink: { line: string; index: string }
}

const LAT = 64

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
    const { w, h, keep, safe, top, foot, head, u } = stage
    const cell = Math.max(8, Math.sqrt((w * h) / 14000))
    const cols = Math.ceil(w / cell) + 1, rows = Math.ceil(h / cell) + 1
    const base = new Float32Array(cols * rows), weight = new Float32Array(cols * rows)
    const corner = new Float32Array(cols * rows)
    // The floor the words stand on, then land rising away from it.
    const clear = PAD + 10 * Math.max(0.6, u)
    const S = Math.max(60, Math.min(w, h) * 0.15)
    const hy = head ? head.y + head.h : (top + foot) / 2
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = i * cell, y = j * cell
        const k = j * cols + i
        const sText = safe.length ? sd(safe, x, y) : Math.hypot(x - w / 2, y - h / 2) - Math.min(w, h) * 0.2
        corner[k] = sd(keep, x, y)
        // Gathering toward the foot of the free ground: a horizon below the words.
        const low = smooth(hy - S * 0.5, foot, y)
        base[k] = (sText - clear) / S + 1.1 * low * low
        // The terrain is felt even on the first ring, a little; fully further out.
        weight[k] = 0.4 + 0.6 * smooth(0, S * 1.6, sText - clear)
      }
    }
    // A cell is traced only if every point of it is clear of the safe rectangles and the HUD.
    const open = new Uint8Array(cols * rows)
    const need = PAD + 1.2 + cell * 0.72
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const k = j * cols + i
        open[k] = Math.min(corner[k], corner[k + 1], corner[k + cols], corner[k + cols + 1]) >= need ? 1 : 0
      }
    }
    const r = rng(0x70b0)
    const lattice = new Float32Array(LAT * LAT * 2)
    for (let i = 0; i < lattice.length; i++) lattice[i] = r() * 2 - 1
    return {
      cols, rows, cell, base, weight, open, lattice,
      freq: 1 / Math.max(160, Math.min(w, h) * 0.38),
      levels: Math.round(lerp(9, 22, intensity)),
      spacing: 1 / lerp(2.6, 5.2, intensity),
      top,
      amp: 0.55,
      band: [top, top + 70 * Math.max(0.6, u), foot - 50 * Math.max(0.6, u), foot],
      fade: null,
      ink: { line: css(mix(pal.stem, pal.ink3, 0.35), 0.38), index: css(mix(pal.stem, pal.ink2, 0.4), 0.55) },
    }
  },

  draw(ctx, sc, f) {
    const { cols, rows, cell, base, weight, open, lattice, freq, levels, spacing } = sc
    // The land drifts sideways; the levels creep outward.
    const drift = f.still ? 0 : f.t * 0.018
    const creep = f.still ? 0 : (f.t * 0.035) % 1
    const F = new Float32Array(cols * rows)
    const lat2 = lattice.subarray(LAT * LAT)
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i
        const x = i * cell * freq, y = j * cell * freq
        // Stretched across: strata, as land seen toward a horizon.
        const n = noise(lattice, x + drift, y * 1.7) * 0.66 + noise(lat2, x * 2.3 - drift * 1.4, y * 3.6 + 7) * 0.28 + noise(lattice, x * 4.7 + 13, y * 6 - drift * 2) * 0.06
        F[k] = base[k] + n * sc.amp * weight[k]
      }
    }
    // Forming from the edges inward as the section scrolls: the highest levels first.
    const reveal = lerp(levels + 2, 0, smooth(0.1, 0.72, f.p))
    const ex = [0, 0, 0, 0], ey = [0, 0, 0, 0]
    ctx.lineCap = 'round'
    for (let l = 0; l < levels; l++) {
      const lv = l + 1 - creep
      // Born faint near the words, gone at the edges, and not yet there before the reveal reaches them.
      const alpha = smooth(0, 1, lv) * smooth(levels, levels - 2, lv) * smooth(reveal, reveal + 2, lv)
      if (alpha <= 0.02) continue
      // Levels start above the most the terrain can lower the first ring, so no line reaches the floor around the words.
      const L = 0.4 * sc.amp + lv * spacing
      // Every fourth level is an index contour; the count follows the levels as they creep, so a line keeps its weight.
      const isIndex = (l + (f.still ? 0 : Math.floor(f.t * 0.035))) % 4 === 0
      const path = new Path2D()
      for (let j = 0; j < rows - 1; j++) {
        for (let i = 0; i < cols - 1; i++) {
          const k = j * cols + i
          if (!open[k]) continue
          const a = F[k], b = F[k + 1], c = F[k + cols + 1], d = F[k + cols]
          const idx = (a > L ? 1 : 0) | (b > L ? 2 : 0) | (c > L ? 4 : 0) | (d > L ? 8 : 0)
          if (idx === 0 || idx === 15) continue
          const x0 = i * cell, y0 = j * cell
          // Crossing points on the four edges: top, right, bottom, left.
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
      // One stroke per level, so each carries its own fade.
      ctx.globalAlpha = alpha
      ctx.strokeStyle = isIndex ? sc.ink.index : sc.ink.line
      ctx.lineWidth = isIndex ? 1.15 : 0.75
      ctx.stroke(path)
    }
    ctx.globalAlpha = 1
    // The map fades out toward the HUD above and the foot below, rather than stopping at a line nobody can see.
    if (!sc.fade) {
      const H = rows * cell
      const g = ctx.createLinearGradient(0, 0, 0, H)
      const [a, b, c, d] = sc.band.map((v) => Math.min(1, Math.max(0, v / H)))
      g.addColorStop(0, 'rgba(0,0,0,0)')
      g.addColorStop(a, 'rgba(0,0,0,0)')
      g.addColorStop(Math.max(a, b), 'rgba(0,0,0,1)')
      g.addColorStop(Math.max(b, c), 'rgba(0,0,0,1)')
      g.addColorStop(Math.max(c, d), 'rgba(0,0,0,0)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      sc.fade = g
    }
    ctx.globalCompositeOperation = 'destination-in'
    ctx.fillStyle = sc.fade
    ctx.fillRect(0, 0, cols * cell, rows * cell)
    ctx.globalCompositeOperation = 'source-over'
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
