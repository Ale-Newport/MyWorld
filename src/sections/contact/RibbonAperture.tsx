'use client'

import type { ContactAnimationProps } from '../types'
import { TAU, clamp01, css, easeInOut, lerp, mix, sd, smooth, useContactCanvas, type Painter, type RGB } from './shared'

/* ============================================================
   RIBBON APERTURE

   Three long ribbons — teal, sand and paper, each with a lit face and
   a deeper back — wind around the closing words, weaving across one
   another, and twist as they go: where a ribbon turns edge-on its two
   edges cross and the other face comes round, darker, until it turns
   back to the light. They sweep in along their courses as the section
   scrolls; as the answer arrives they step back and their twists
   loosen, and the words stand in a clean aperture. After that the
   ribbons only roll, slowly, the twists travelling along them.

   Every course is laid on a superellipse around the words and kept,
   along its whole length, only where the ribbon at full width, with
   its shadow, clears every safe rectangle at every stage of the
   opening; it tapers away at either end of what is kept. Twisting and
   rolling only ever narrow a ribbon, so nothing it does can bring it
   nearer a word.

   intensity → width of the ribbons · speed → the rolling
   ============================================================ */

const PAD = 2.5
const SAMPLES = 360
const SHADES = 10
/** The shape of the courses: between an ellipse and the words' own box. */
const EXP = 3.2
const CORNER = 2 ** (1 / EXP)

interface Ribbon {
  /** Course samples for the closed and the open aperture, the kept stretch, and arc length per sample. */
  cx0: Float32Array; cy0: Float32Array
  cx1: Float32Array; cy1: Float32Array
  i0: number; i1: number
  ds: number
  phase: number
  g0: number; g1: number
  front: string[]; back: string[]
}

interface Scene { ribbons: Ribbon[]; hw: number; wave: number; sx: number; sy: number; edge: string; shadow: string }

/** A point of the superellipse of exponent n around (hx, hy) with radii (ax, ay), at angle a. */
function superellipse(hx: number, hy: number, ax: number, ay: number, n: number, a: number): [number, number] {
  const c = Math.cos(a), s = Math.sin(a)
  return [hx + ax * Math.sign(c) * Math.abs(c) ** (2 / n), hy + ay * Math.sign(s) * Math.abs(s) ** (2 / n)]
}

const painter: Painter<Scene> = {
  compose(stage, intensity, pal) {
    const { w, h, keep, head, top, foot, u } = stage
    const hx = head ? head.x + head.w / 2 : w / 2, hy = head ? head.y + head.h / 2 : (top + foot) / 2
    const bx = head ? head.w / 2 : w * 0.25, by = head ? head.h / 2 : h * 0.2
    /* The three lanes and the step back they take as the aperture opens
       must fit between the words and the edge of the stage (or the HUD):
       on a narrow one everything is drawn finer. */
    const side = Math.max(0, Math.min(hx - bx, w - hx - bx))
    const room = Math.max(side, hy - by - top)
    const k0 = Math.max(0.55, Math.min(1.3, u))
    const wish = lerp(7, 21, intensity) * k0
    const k = k0 * Math.min(1, Math.max(0.35, room / (8.4 * wish + 76 * k0)))
    const hw = lerp(7, 21, intensity) * k
    const sx = 4 * k, sy = 7 * k
    const need = hw + PAD + Math.hypot(sx, sy) + 1
    const lane = 2 * hw + 12 * k
    // With no room beside the words (a phone), the courses flatten into the band above them.
    const flat = clamp01(1 - side / (3 * lane))
    // A flattened course passes far wide of the corners; it need not be lifted for them.
    const corner = lerp(CORNER, 1, flat)
    const tones: [RGB, RGB, RGB, RGB][] = [
      // [face lit, face edge-on, back lit, back edge-on]
      [mix(pal.bg, pal.signal, 0.2), mix(pal.bg, pal.signal, 0.42), mix(pal.signal, pal.bg, 0.18), mix(pal.signal, pal.ink, 0.42)],
      [mix(pal.bg, pal.stem2, 0.26), mix(pal.bg, pal.stem2, 0.5), mix(pal.stem2, pal.ink2, 0.25), mix(pal.stem, pal.ink2, 0.5)],
      [mix(pal.bg, [255, 255, 255], 0.65), mix(pal.bg, pal.bg3, 0.85), mix(pal.bg3, pal.ink4, 0.42), mix(pal.bg3, pal.ink3, 0.62)],
    ]
    // How far the ribbons sway across one another, and step back as the aperture opens: less where there is little room.
    const sway = 0.35 * Math.min(1, room / 160)
    const expand = Math.min(1, room / 220)
    const course = (g0: number, r: number) => {
      // Up one side, over the words and down the other, mirror-symmetric about the top.
      const from = Math.PI * 0.6, to = Math.PI * 2.4
      const lay = (open: number) => {
        const cx = new Float32Array(SAMPLES), cy = new Float32Array(SAMPLES)
        for (let i = 0; i < SAMPLES; i++) {
          const t = i / (SAMPLES - 1)
          const g = g0 + lane * sway * (Math.sin(TAU * Math.abs(t - 0.5) * 1.6 + r * 2.1) + 1) + open * (14 + 10 * r) * k * expand
          // Radii that pass the corners of the words' box rather than cut them: through (bx, by) at 45 degrees.
          const [x, y] = superellipse(hx, hy, bx * corner + g + flat * w * 1.2, by * corner + g, EXP, from + t * (to - from))
          cx[i] = x
          cy[i] = y
        }
        return { cx, cy }
      }
      const closed = lay(0), opened = lay(1)
      const ok = new Uint8Array(SAMPLES)
      // Clear all the way through the opening: checked at eight steps of it, with half a step's travel to spare between them.
      for (let q = 0; q < SAMPLES; q++) {
        const spare = Math.hypot(opened.cx[q] - closed.cx[q], opened.cy[q] - closed.cy[q]) / 16
        let clear = true
        for (let o = 0; o <= 8 && clear; o++) clear = sd(keep, lerp(closed.cx[q], opened.cx[q], o / 8), lerp(closed.cy[q], opened.cy[q], o / 8)) >= need + spare
        ok[q] = clear ? 1 : 0
      }
      // Kept: the stretch through the top that is clear on both sides alike, so the frame is even.
      const apex = (SAMPLES - 1) / 2
      let half = 0
      while (half < apex && ok[Math.floor(apex - half - 1)] && ok[Math.ceil(apex + half + 1)]) half++
      if (!ok[Math.floor(apex)] || !ok[Math.ceil(apex)]) half = -1
      return { closed, opened, a: Math.floor(apex - half), b: Math.ceil(apex + half), len: 2 * half }
    }
    const ribbons: Ribbon[] = []
    let inner = need + 4 * k
    for (let r = 0; r < 3; r++) {
      // The innermost lane that gives this ribbon a generous stretch (the longest one, if none does).
      let best: ReturnType<typeof course> | null = null, bestG = inner
      for (let g0 = inner; g0 <= inner + lane * 3; g0 += Math.max(3, lane / 6)) {
        const c = course(g0, r)
        if (c.len > SAMPLES * 0.12 && (!best || c.len > best.len)) { best = c; bestG = g0 }
        if (best && best.len >= SAMPLES * 0.42) break
      }
      if (!best) continue
      inner = bestG + lane * (1 + sway)
      const { closed, opened, a, b } = best
      let len = 0
      for (let i = a + 1; i <= b; i++) len += Math.hypot(closed.cx[i] - closed.cx[i - 1], closed.cy[i] - closed.cy[i - 1])
      const t = tones[r]
      const ramp = (lit: RGB, edge: RGB) => Array.from({ length: SHADES }, (_, s) => css(mix(edge, lit, s / (SHADES - 1))))
      ribbons.push({
        cx0: closed.cx, cy0: closed.cy, cx1: opened.cx, cy1: opened.cy, i0: a, i1: b, ds: len / Math.max(1, b - a),
        phase: r * 1.9, g0: 0.08 + 0.07 * r, g1: 0.48 + 0.07 * r, front: ramp(t[0], t[1]), back: ramp(t[2], t[3]),
      })
    }
    return { ribbons, hw, wave: 250 * k, sx, sy, edge: css(pal.ink, 0.22), shadow: css(pal.ink, 0.05) }
  },

  draw(ctx, sc, f) {
    const open = easeInOut(smooth(0.48, 0.74, f.p))
    // A half twist every so often; looser once the aperture is open. Rolling sends the twists along.
    const wave = sc.wave * (1 + 0.6 * open)
    const roll = f.still ? 0 : f.t * 22
    ctx.lineJoin = 'round'
    for (const rb of sc.ribbons) {
      const g = easeInOut(clamp01((f.p - rb.g0) / (rb.g1 - rb.g0)))
      if (g <= 0) continue
      // Sweeping in along its course.
      const ia = rb.i0, ib = Math.round(rb.i0 + (rb.i1 - rb.i0) * g)
      const n = ib - ia + 1
      if (n < 4) continue
      const L = new Float32Array(n * 2), R = new Float32Array(n * 2), face = new Int8Array(n), shade = new Uint8Array(n)
      for (let q = 0; q < n; q++) {
        const i = ia + q
        const x = lerp(rb.cx0[i], rb.cx1[i], open), y = lerp(rb.cy0[i], rb.cy1[i], open)
        const j0 = Math.max(ia, i - 1), j1 = Math.min(ib, i + 1)
        const tx = lerp(rb.cx0[j1], rb.cx1[j1], open) - lerp(rb.cx0[j0], rb.cx1[j0], open)
        const ty = lerp(rb.cy0[j1], rb.cy1[j1], open) - lerp(rb.cy0[j0], rb.cy1[j0], open)
        const tl = Math.hypot(tx, ty) || 1
        const along = q / (n - 1)
        const taper = Math.min(1, along / 0.1, (1 - along) / 0.1) ** 0.7
        // The twist: the band's width across the eye is its width times cos φ; the sign is the face.
        const c = Math.cos(rb.phase + (Math.PI * ((i - rb.i0) * rb.ds - roll)) / wave)
        const half = sc.hw * taper * (Math.abs(c) < 0.04 ? 0.04 * Math.sign(c || 1) : c)
        L[q * 2] = x - (ty / tl) * half; L[q * 2 + 1] = y + (tx / tl) * half
        R[q * 2] = x + (ty / tl) * half; R[q * 2 + 1] = y - (tx / tl) * half
        face[q] = c >= 0 ? 1 : 0
        shade[q] = Math.min(SHADES - 1, Math.round(Math.abs(c) * (SHADES - 1)))
      }
      // Its shadow on the wall.
      const outline = new Path2D()
      outline.moveTo(L[0] + sc.sx, L[1] + sc.sy)
      for (let q = 1; q < n; q++) outline.lineTo(L[q * 2] + sc.sx, L[q * 2 + 1] + sc.sy)
      for (let q = n - 1; q >= 0; q--) outline.lineTo(R[q * 2] + sc.sx, R[q * 2 + 1] + sc.sy)
      outline.closePath()
      ctx.fillStyle = sc.shadow
      ctx.fill(outline, 'nonzero')
      // Runs of one face and one shade, each one polygon reaching a sample back so no seam shows.
      for (let q = 0; q < n - 1;) {
        let e = q + 1
        while (e < n - 1 && face[e] === face[q] && shade[e] === shade[q]) e++
        const run = new Path2D()
        const s0 = Math.max(0, q - 1)
        run.moveTo(L[s0 * 2], L[s0 * 2 + 1])
        for (let m = s0 + 1; m <= e; m++) run.lineTo(L[m * 2], L[m * 2 + 1])
        for (let m = e; m >= s0; m--) run.lineTo(R[m * 2], R[m * 2 + 1])
        run.closePath()
        ctx.fillStyle = (face[q] ? rb.front : rb.back)[shade[q]]
        ctx.fill(run)
        q = e
      }
      // A hairline along both edges keeps the band crisp against the plaster.
      const edges = new Path2D()
      edges.moveTo(L[0], L[1])
      for (let q = 1; q < n; q++) edges.lineTo(L[q * 2], L[q * 2 + 1])
      edges.moveTo(R[0], R[1])
      for (let q = 1; q < n; q++) edges.lineTo(R[q * 2], R[q * 2 + 1])
      ctx.strokeStyle = sc.edge
      ctx.lineWidth = 0.7
      ctx.stroke(edges)
    }
  },
}

export default function RibbonAperture(props: ContactAnimationProps) {
  const { rootRef, canvasRef, rootStyle, canvasStyle } = useContactCanvas('contact.ribbon-aperture', props, painter)
  return (
    <div ref={rootRef} style={rootStyle}>
      <canvas ref={canvasRef} style={canvasStyle} />
    </div>
  )
}
