'use client'

import type { ContactAnimationProps } from '../types'
import { TAU, clamp01, css, easeOut, lerp, mix, sd, smooth, useContactCanvas, type Painter, type Rect } from './shared'

/* ============================================================
   STEPPING PATH

   A short run of floating stone platforms climbs toward an arched
   doorway on a landing, drawn in isometric with the hall's own light:
   lit tops, a pale face toward the light, a shaded face away from it,
   hairline edges and a faint shadow on the wall. The doorway stands
   open on the world the journey ends in — the pale sky and warm sand
   of the island — and its threshold is the one stroke of accent.

   The platforms rise into place one after another as the section
   scrolls, the landing settles, the arch goes up and the light comes
   on as the answer arrives. Then the stones only bob, each a little
   out of step, and a few motes drift up in the door's light.

   The vignette is fitted, whole — every stone at the lowest point of
   its rise and the top of its bob, the arch above its posts, the
   shadows — inside the largest free rectangle the words leave: as a
   climb where the room is tall, as a gentle run where it is wide and
   low (a phone's band above the words), always rising toward the
   words.

   intensity → height of the steps · speed → the bob and the motes
   ============================================================ */

const PAD = 3
const C30 = Math.cos(Math.PI / 6), S30 = 0.5
const STONES = 5

type Pt = [number, number]
interface Box { x: number; y: number; z: number; a: number; d: number; t: number; w0: number; w1: number; bob: number }
interface Door { x: number; y: number; z: number; w: number; h: number; frame: number; depth: number }
interface Layout { boxes: Box[]; door: Door }
interface Scene {
  ok: boolean
  ox: number; oy: number; s: number; flip: number
  lay: Layout
  drop: number
  shadow: number
  ink: Record<'top' | 'lit' | 'dark' | 'edge' | 'shadow' | 'sky' | 'sand' | 'spill' | 'accent' | 'mote', string>
}

/** Iso → screen at unit scale. */
const iso = (x: number, y: number, z: number): Pt => [(x - y) * C30, (x + y) * S30 - z]

/**
 * The vignette in iso units. A climb runs straight back (−y), so on
 * screen it rises steeply; a run goes back and across (x − y), so on
 * screen it rises only by the steps themselves.
 */
function build(steep: number, run: boolean): Layout {
  const boxes: Box[] = []
  // A run is for low bands: its steps are gentler, its door a little shorter.
  const rise = run ? steep * 0.6 : steep
  const [ux, uy] = run ? [Math.SQRT1_2, -Math.SQRT1_2] : [0, -1]
  const a = run ? 0.72 : 1, d = run ? 0.72 : 0.56, pitch = run ? 0.9 : 0.68
  for (let k = 0; k < STONES; k++) {
    const sc = 1 - k * 0.03
    boxes.push({ x: k * pitch * ux + ((1 - sc) * a) / 2, y: k * pitch * uy - d, z: k * rise, a: a * sc, d: d * sc, t: 0.2, w0: 0.2 + 0.055 * k, w1: 0.36 + 0.055 * k, bob: k })
  }
  const lx = STONES * pitch * ux - 0.1, ly = STONES * pitch * uy - 1.05
  boxes.push({ x: lx, y: ly, z: STONES * rise, a: 1.2, d: 1.05, t: 0.28, w0: 0.48, w1: 0.62, bob: -1 })
  return { boxes, door: { x: lx + 0.17, y: ly + 0.18, z: STONES * rise, w: 0.86, h: run ? 1.32 : 1.5, frame: 0.13, depth: 0.18 } }
}

/** Unit-scale screen extent, with each stone at the bottom of its rise and the top of its bob. */
function extent(L: Layout, drop: number) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const add = (x: number, y: number, z: number) => {
    const [sx, sy] = iso(x, y, z)
    x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy)
  }
  for (const b of L.boxes) {
    for (const dz of [-drop - 0.06, 0.06]) {
      for (const [x, y] of [[b.x, b.y], [b.x + b.a, b.y], [b.x, b.y + b.d], [b.x + b.a, b.y + b.d]]) {
        add(x, y, b.z + dz)
        add(x, y, b.z - b.t + dz)
      }
    }
  }
  const D = L.door
  for (const x of [D.x, D.x + D.w]) for (const y of [D.y - D.depth, D.y]) add(x, y, D.z + D.h + 0.02)
  return { x0, y0, x1, y1 }
}

/** Free rectangles on a grid: the largest clear rectangle ending at each cell (histogram method). */
function freeRects(keep: Rect[], w: number, top: number, foot: number, g: number, clear: number, edge: number): Rect[] {
  const cols = Math.floor(w / g), rows = Math.floor((foot - top) / g)
  const hgt = new Int32Array(cols)
  const out: Rect[] = []
  for (let j = 0; j < rows; j++) {
    const y = top + (j + 0.5) * g
    for (let i = 0; i < cols; i++) {
      const x = (i + 0.5) * g
      // Clear of the words, and off the very edge of the frame: a vignette, not a cut-out.
      hgt[i] = x > edge && x < w - edge && sd(keep, x, y) >= clear + g * 0.71 ? hgt[i] + 1 : 0
    }
    const stack: number[] = []
    for (let i = 0; i <= cols; i++) {
      const hh = i < cols ? hgt[i] : 0
      while (stack.length && hgt[stack[stack.length - 1]] >= hh) {
        const k = stack.pop() as number
        const left = stack.length ? stack[stack.length - 1] + 1 : 0
        if (hgt[k] > 2 && i - left > 2) out.push({ x: left * g, y: top + (j + 1 - hgt[k]) * g, w: (i - left) * g, h: hgt[k] * g })
      }
      if (i < cols) stack.push(i)
    }
  }
  return out
}

const painter: Painter<Scene> = {
  compose(stage, intensity, pal) {
    const { w, h, keep, head, top, foot, u } = stage
    const rise = lerp(0.2, 0.46, intensity)
    const drop = 0.55 * Math.max(rise, 0.3)
    const shadow = 8 * Math.max(0.6, u)
    const hx = head ? head.x + head.w / 2 : w / 2, hy = head ? head.y + head.h / 2 : (top + foot) / 2
    const variants = [false, true].map((run) => {
      const lay = build(rise, run)
      const ext = extent(lay, drop)
      return { lay, ext, ew: ext.x1 - ext.x0, eh: ext.y1 - ext.y0 }
    })
    // The largest vignette any free rectangle holds, compact however much room there is; a little preference for the right of the words, where reading ends.
    const cap = Math.min(w, h) * 0.075
    let best: { s: number; score: number; r: Rect; v: (typeof variants)[number]; side: number } | null = null
    for (const r of freeRects(keep, w, top, foot, Math.max(6, 8 * u), PAD + shadow, 14 * u)) {
      for (const [vi, v] of variants.entries()) {
        const s = Math.min(r.w / v.ew, r.h / v.eh, cap)
        const side = r.x + r.w / 2 >= hx ? -1 : 1
        // Size first; then the right of the words, the climb over the run, and a place level with the words.
        const level = Math.max(0, Math.min(r.y + r.h, hy + (v.eh * s) / 2) - Math.max(r.y, hy - (v.eh * s) / 2)) / Math.max(1, v.eh * s)
        const score = s * (side < 0 ? 1.06 : 1) * (vi === 0 ? 1.04 : 1) * (0.6 + 0.4 * level)
        if (!best || score > best.score) best = { s, score, r, v, side }
      }
    }
    const ink: Scene['ink'] = {
      top: css(mix(pal.bg, [255, 255, 255], 0.5)),
      lit: css(mix(pal.bg, pal.bg3, 0.92)),
      dark: css(mix(pal.bg3, pal.ink4, 0.4)),
      edge: css(pal.ink, 0.2),
      shadow: css(pal.ink, 0.055),
      sky: css(mix(pal.world, pal.signal, 0.2)),
      sand: css(mix(pal.bloom, pal.bg, 0.2)),
      spill: css(mix(pal.bloom, pal.bg, 0.15), 0.5),
      accent: css(pal.accent),
      mote: css(mix(pal.bloom, [255, 255, 255], 0.5), 0.95),
    }
    // Too small to read as stones and a door: the margins stay empty.
    if (!best || best.s * best.v.lay.door.h < 16) return { ok: false, ox: 0, oy: 0, s: 1, flip: 1, lay: variants[0].lay, drop, shadow, ink }
    const { s, r, v, side } = best
    const flip = side > 0 ? 1 : -1
    // Close to the words across, level with them if the rectangle allows.
    const vx = side > 0 ? r.x + r.w - v.ew * s : r.x
    const vy = Math.min(r.y + r.h - v.eh * s, Math.max(r.y, hy - (v.eh * s) / 2))
    const ox = flip > 0 ? vx - v.ext.x0 * s : vx + v.ext.x1 * s
    return { ok: true, ox, oy: vy - v.ext.y0 * s, s, flip, lay: v.lay, drop, shadow, ink }
  },

  draw(ctx, sc, f) {
    if (!sc.ok) return
    const { ox, oy, s, flip, ink, lay } = sc
    const P = (x: number, y: number, z: number): Pt => {
      const [ix, iy] = iso(x, y, z)
      return [ox + ix * s * flip, oy + iy * s]
    }
    const trace = (pts: Pt[]) => {
      ctx.moveTo(pts[0][0], pts[0][1])
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
      ctx.closePath()
    }
    const poly = (pts: Pt[], fill: string | CanvasGradient, stroke = true) => {
      ctx.beginPath()
      trace(pts)
      ctx.fillStyle = fill
      ctx.fill()
      if (stroke) ctx.stroke()
    }
    ctx.lineJoin = 'round'
    ctx.lineWidth = 0.8
    ctx.strokeStyle = ink.edge
    /** Is the face at +y the one on the left of the screen (toward the light)? Depends on the mirror. */
    const yLeft = flip > 0
    const block = (x: number, y: number, z: number, a: number, d: number, t: number, alpha: number, shadow: boolean) => {
      if (alpha <= 0.01) return
      ctx.globalAlpha = alpha
      const T = [P(x, y, z), P(x + a, y, z), P(x + a, y + d, z), P(x, y + d, z)]
      const B = [P(x, y, z - t), P(x + a, y, z - t), P(x + a, y + d, z - t), P(x, y + d, z - t)]
      if (shadow) {
        const sx = sc.shadow * 0.5 * flip, sy = sc.shadow * 0.85
        poly([T[0], T[1], B[1], B[2], B[3], T[3]].map(([px, py]): Pt => [px + sx, py + sy]), ink.shadow, false)
      }
      poly([T[1], T[2], B[2], B[1]], yLeft ? ink.dark : ink.lit)
      poly([T[3], T[2], B[2], B[3]], yLeft ? ink.lit : ink.dark)
      poly(T, ink.top)
      ctx.globalAlpha = 1
    }
    const k = (a: number, b: number) => easeOut(clamp01((f.p - a) / (b - a)))
    const n = lay.boxes.length
    const land = lay.boxes[n - 1]
    // Back to front: the landing and its doorway first, then the stones from the top one down.
    const lz = k(land.w0, land.w1)
    block(land.x, land.y, land.z - (1 - lz) * sc.drop, land.a, land.d, land.t, lz, true)
    const D = lay.door
    const up = k(0.56, 0.68), light = k(0.64, 0.8)
    if (up > 0) {
      // The doorway grows up from the landing; its opening is arched.
      const inner = D.w - 2 * D.frame, r = inner / 2
      const H = D.h * up
      const spring = Math.max(0, H - D.frame - r)
      const yb = D.y - D.depth
      const arch = (y: number): Pt[] => {
        const pts: Pt[] = [P(D.x + D.frame, y, D.z), P(D.x + D.frame, y, D.z + spring)]
        for (let i = 1; i < 16; i++) {
          const a = Math.PI - (i / 16) * Math.PI
          pts.push(P(D.x + D.w / 2 + Math.cos(a) * r, y, D.z + spring + Math.sin(a) * Math.min(r, Math.max(0, H - D.frame - spring))))
        }
        pts.push(P(D.x + D.w - D.frame, y, D.z + spring), P(D.x + D.w - D.frame, y, D.z))
        return pts
      }
      ctx.globalAlpha = up
      // The side away from the stair and the top, then the world through the opening, then the face with the opening cut out of it.
      poly([P(D.x + D.w, yb, D.z + H), P(D.x + D.w, D.y, D.z + H), P(D.x + D.w, D.y, D.z), P(D.x + D.w, yb, D.z)], yLeft ? ink.dark : ink.lit)
      poly([P(D.x, yb, D.z + H), P(D.x + D.w, yb, D.z + H), P(D.x + D.w, D.y, D.z + H), P(D.x, D.y, D.z + H)], ink.top)
      if (light > 0) {
        const g0 = P(D.x, yb, D.z + H), g1 = P(D.x, yb, D.z)
        const grad = ctx.createLinearGradient(g0[0], g0[1], g1[0], g1[1])
        grad.addColorStop(0, ink.sky)
        grad.addColorStop(1, ink.sand)
        ctx.globalAlpha = up * light * (f.still ? 1 : 0.92 + 0.08 * Math.sin(f.t * 1.2))
        poly(arch(yb), grad, false)
        ctx.globalAlpha = up
      }
      ctx.beginPath()
      trace([P(D.x, D.y, D.z + H), P(D.x + D.w, D.y, D.z + H), P(D.x + D.w, D.y, D.z), P(D.x, D.y, D.z)])
      trace(arch(D.y))
      ctx.fillStyle = yLeft ? ink.lit : ink.dark
      ctx.fill('evenodd')
      ctx.stroke()
      // Its light falling forward onto the landing.
      if (light > 0) {
        ctx.globalAlpha = up * light
        poly([P(D.x + D.frame, D.y, D.z), P(D.x + D.w - D.frame, D.y, D.z), P(D.x + D.w - D.frame + 0.16, D.y + 0.8, D.z), P(D.x + D.frame - 0.16, D.y + 0.8, D.z)], ink.spill, false)
      }
      ctx.globalAlpha = 1
      // The threshold: the one stroke of accent.
      const th = k(0.74, 0.84)
      if (th > 0) {
        const a = P(D.x + D.frame, D.y + 0.015, D.z), b = P(D.x + D.frame + inner * th, D.y + 0.015, D.z)
        ctx.strokeStyle = ink.accent
        ctx.lineWidth = Math.max(1.2, s * 0.012)
        ctx.beginPath()
        ctx.moveTo(a[0], a[1])
        ctx.lineTo(b[0], b[1])
        ctx.stroke()
        ctx.lineWidth = 0.8
        ctx.strokeStyle = ink.edge
      }
      // Motes drifting up through the light.
      if (light > 0.5 && !f.still) {
        ctx.fillStyle = ink.mote
        for (let m = 0; m < 5; m++) {
          const c = (f.t * 0.07 + m * 0.21) % 1
          const [mx, my] = P(D.x + D.frame + inner * (0.15 + 0.7 * ((m * 0.37) % 1)) + 0.04 * Math.sin(f.t * 0.6 + m), D.y + 0.05, D.z + (spring + r * 0.6) * (0.06 + 0.88 * c))
          ctx.globalAlpha = (light - 0.5) * 2 * Math.sin(Math.PI * c)
          ctx.beginPath()
          ctx.arc(mx, my, Math.max(0.8, s * 0.011), 0, TAU)
          ctx.fill()
        }
        ctx.globalAlpha = 1
      }
    }
    for (let i = n - 2; i >= 0; i--) {
      const b = lay.boxes[i]
      const g = k(b.w0, b.w1)
      const bob = f.still ? 0 : 0.05 * Math.sin(f.t * 1.1 + b.bob * 0.9) * smooth(0, 1, g)
      // Rising into place from below as the section scrolls.
      block(b.x, b.y, b.z - (1 - g) * sc.drop + bob, b.a, b.d, b.t, g, true)
    }
  },
}

export default function SteppingPath(props: ContactAnimationProps) {
  const { rootRef, canvasRef, rootStyle, canvasStyle } = useContactCanvas('contact.stepping-path', props, painter)
  return (
    <div ref={rootRef} style={rootStyle}>
      <canvas ref={canvasRef} style={canvasStyle} />
    </div>
  )
}
