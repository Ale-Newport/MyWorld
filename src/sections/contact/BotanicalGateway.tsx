'use client'

import type { ContactAnimationProps } from '../types'
import { TAU, cellAt, clamp01, css, easeInOut, easeOut, field, lerp, mix, resample, rng, routeFrom, sd, useContactCanvas, type Painter, type RGB, type Stage } from './shared'

/* ============================================================
   BOTANICAL GATEWAY — the section's default

   Foliage grows in from both sides of the stage and frames an
   opening around the closing words. Climbing vines rise up the
   sides and arch over the top; fern fronds uncurl from fiddleheads
   and fan out from the edges; a few broad blades stand nearest the
   eye. Three depths — pale and fine at the back, darker and larger
   in front, the front leaves casting a faint shadow on the wall.
   The sides climb first and the arch closes over the words as the
   answer arrives; after that it only breathes.

   It is the prelude to the garden that takes over when the visitor
   keeps pushing, not that garden: it frames and never covers, and
   it steps back the moment the portal starts to charge.

   Every plant is planned in full before anything is drawn. Fronds
   and blades steer out from the edge through the free space; vines
   take the cheapest route up the side and over the opening. The
   finished plant — leaves at full size, swayed to either extreme,
   its fiddlehead still rolled, with its shadow — is then checked
   against the safe rectangles and shortened wherever it would reach
   one. Growing and swaying only ever draw part of that envelope, so
   no frame can do otherwise.

   intensity → density of the foliage · speed → the sway's clock
   ============================================================ */

const FROND = 0, SPRAY = 1, BLADE = 2, VINE = 3
/** Toward the light: the hall is lit from the upper left. */
const LX = -0.45, LY = -0.89
/** Outline samples of the blade shape (see `blade`), as fractions of its length and of its width parameter. */
const OUTLINE = [0.146, 0.458, 0.42, 0.6, 0.636, 0.487, 0.819, 0.246]
/** Clearance beyond the safe rectangles, for antialiasing. */
const PAD = 2.5
/** Sway amplitude (radians) by layer; vines are tied to the wall and barely move. */
const AMP = [0.02, 0.014, 0.01]
const VINE_AMP = 0.004

interface Leaf { s: number; side: number; ang: number; len: number; wid: number; bend: number; ph: number }
interface Curl { s: number; side: number; r: number }
interface Stem { px: Float32Array; py: Float32Array; pa: Float32Array; step: number; L: number }

interface Plant extends Stem {
  x: number; y: number
  unfold: number
  leaves: Leaf[]
  curls: Curl[]
  buds: Curl[]
  kind: number
  tint: number
  amp: number; freq: number; ph: number
  g0: number; g1: number
  curl: number; turn: number
}

interface Ink { lit: string[]; shade: string[]; stem: string; width: number; vein: string | null; edge: string | null; shadow: string | null; petal?: [string, string, string] }
interface Scene { layers: Plant[][]; inks: Ink[]; sx: number; sy: number }

interface Spec {
  kind: number; layer: number; side: number
  x: number; y: number; th0: number; L: number
  /** Turning toward its arch, radians per px. */
  bend: number
  seed: number
}

/** Distance to whatever a plant may not reach: the words, the HUD, the opening around the words. */
type Room = (x: number, y: number) => number

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/** The plant's leaves for its kind and length; one random stream, so a shortened plant keeps its character. */
function leavesFor(kind: number, L: number, u: number, seed: number): { leaves: Leaf[]; curls: Curl[]; buds: Curl[]; unfold: number; reach: (s: number) => number } {
  const r = rng(seed)
  const leaves: Leaf[] = []
  const curls: Curl[] = []
  const buds: Curl[] = []
  if (kind === FROND) {
    const lp = L * (0.17 + r() * 0.05)
    const n = Math.max(8, Math.min(30, Math.round(L / (lp * 0.27))))
    const prof = (v: number) => Math.sin(Math.PI * clamp01((v - 0.03) / 0.99) ** 0.7) * (1 - 0.32 * v)
    for (let k = 0; k < n; k++) {
      const v = 0.07 + (0.9 * k) / (n - 1)
      const len = Math.max(2.4 * u, lp * prof(v) * (0.93 + r() * 0.14))
      for (const side of [1, -1]) {
        leaves.push({ s: L * Math.min(0.985, v + (side < 0 ? 0.45 / n : 0)), side, ang: 1.2 - 0.55 * v, len, wid: len * 0.27, bend: 0.1, ph: r() * TAU })
      }
    }
    leaves.push({ s: L * 0.995, side: 1, ang: 0.04, len: lp * 0.2, wid: lp * 0.06, bend: 0, ph: r() * TAU })
    return { leaves, curls, buds, unfold: L * 0.24, reach: (s) => lp * prof(s / L) * 1.08 + 2 }
  }
  if (kind === SPRAY) {
    const ls = L * (0.22 + r() * 0.06)
    const n = 6 + Math.floor(r() * 4)
    for (let k = 0; k < n; k++) {
      const v = 0.14 + (0.8 * k) / (n - 1)
      const len = ls * (0.72 + 0.28 * Math.sin(Math.PI * v)) * (0.9 + r() * 0.2)
      leaves.push({ s: L * v, side: k % 2 ? 1 : -1, ang: 0.55 + r() * 0.25, len, wid: len * 0.36, bend: 0.06, ph: r() * TAU })
    }
    leaves.push({ s: L, side: 1, ang: 0, len: ls * 0.85, wid: ls * 0.3, bend: 0, ph: r() * TAU })
    return { leaves, curls, buds, unfold: L * 0.28, reach: () => ls * 1.05 + 2 }
  }
  if (kind === VINE) {
    // Opposite pairs at the nodes, a tendril now and then, the youngest leaves at the tip.
    const node = (34 + r() * 10) * u
    const lv = 27 * u
    for (let s = node * 0.6, k = 0; s < L - 4; s += node * (0.8 + r() * 0.4), k++) {
      const young = clamp01((L - s) / (node * 3.5))
      const len = lv * (0.5 + 0.5 * young) * (0.75 + r() * 0.5)
      // Mostly pairs; now and then one of the pair has dropped.
      const lone = r() < 0.22 ? (r() < 0.5 ? 1 : -1) : 0
      for (const side of [1, -1]) {
        if (side === lone) continue
        leaves.push({ s: s + side * r() * 3 * u, side, ang: 0.7 + r() * 0.5, len: len * (side > 0 ? 1 : 0.8 + r() * 0.2), wid: len * (0.38 + r() * 0.1), bend: 0.08 + r() * 0.1, ph: r() * TAU })
      }
      if (k % 3 === 1) curls.push({ s: s + node * 0.4, side: k % 2 ? 1 : -1, r: (4 + r() * 3) * u })
      // A few small flowers along the older growth: the gateway blooms as the answer arrives.
      else if (k > 1 && s < L - node * 2 && r() < 0.3) buds.push({ s: s + node * 0.5, side: r() < 0.5 ? 1 : -1, r: (5.5 + r() * 2.5) * u })
    }
    leaves.push({ s: L, side: 1, ang: 0, len: lv * 0.5, wid: lv * 0.2, bend: 0, ph: r() * TAU })
    return { leaves, curls, buds, unfold: node * 2.2, reach: () => lv * 1.08 + 2 }
  }
  // A broad blade on a petiole, sometimes with a younger one beside it.
  const lb = L * (1.5 + r() * 0.4)
  leaves.push({ s: L, side: 1, ang: 0, len: lb, wid: lb * (0.3 + r() * 0.05), bend: (r() - 0.5) * 0.12, ph: r() * TAU })
  if (r() < 0.55) leaves.push({ s: L * 0.5, side: r() < 0.5 ? 1 : -1, ang: 0.5, len: lb * 0.6, wid: lb * 0.18, bend: 0.08, ph: r() * TAU })
  return { leaves, curls, buds, unfold: lb * 0.85, reach: (s) => (s > L * 0.45 ? lb * 0.45 : 4) + 2 }
}

/** The stem point and direction at arc length s. */
function at(pl: Stem, s: number): [number, number, number] {
  const f = Math.min(pl.px.length - 1.001, Math.max(0, s / pl.step))
  const i = Math.floor(f), t = f - i
  return [lerp(pl.px[i], pl.px[i + 1], t), lerp(pl.py[i], pl.py[i + 1], t), pl.pa[i] + wrap(pl.pa[i + 1] - pl.pa[i]) * t]
}

/** Crozier radius while a frond's front is at s. */
const curlAt = (pl: Plant, s: number) => (pl.curl > 0 && s < pl.L ? pl.curl * (1 - s / pl.L) ** 0.7 : 0)

/**
 * Grows a stem of up to `L` px from the spec's base, bending toward its
 * arch and steering away from whatever is near, and stopping where it
 * would run out of room for its own leaves and sway.
 */
function steer(sp: Spec, u: number, room: Room, reach: (s: number) => number, amp: number, curl: number, shadow: number, gate: (x: number) => boolean): Stem {
  const step = Math.max(3, 4.5 * u)
  const xs = [0], ys = [0], as = [sp.th0]
  let x = sp.x, y = sp.y, th = sp.th0
  const need = (s: number, d: number) => PAD + reach(s) + d * amp * 1.1 + shadow + 2 * (curl > 0 ? curl * (1 - s / sp.L) ** 0.7 : 0)
  for (let s = 0; s + step <= sp.L; s += step) {
    let want = sp.th0 + sp.bend * s
    let turn = 0.008
    // Look ahead; if that way runs out of room, take the nearest heading that does not.
    const d = Math.hypot(x - sp.x, y - sp.y)
    const look = Math.max(step * 7, reach(s) * 1.4)
    const n = need(s, d + look)
    const ahead = (a: number) => room(x + Math.cos(a) * look, y + Math.sin(a) * look)
    if (ahead(th) < n) {
      let bestA = th, bestRoom = -Infinity
      for (const o of [0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4]) {
        const v = ahead(th + o) - Math.abs(wrap(th + o - want)) * 4
        if (v > bestRoom) { bestRoom = v; bestA = th + o }
      }
      want = bestA
      turn = 0.016
    }
    th += Math.max(-turn * step, Math.min(turn * step, wrap(want - th)))
    const nx = x + Math.cos(th) * step, ny = y + Math.sin(th) * step
    if (room(nx, ny) < need(s + step, Math.hypot(nx - sp.x, ny - sp.y)) || gate(nx)) break
    x = nx; y = ny
    xs.push(x - sp.x); ys.push(y - sp.y); as.push(th)
  }
  return { px: Float32Array.from(xs), py: Float32Array.from(ys), pa: Float32Array.from(as), step, L: (xs.length - 1) * step }
}

/** The first stretch of the stem to its arc length L. */
const cutStem = (st: Stem, L: number): Stem => {
  const n = Math.max(2, Math.min(st.px.length, Math.floor(L / st.step) + 1))
  return { px: st.px.subarray(0, n), py: st.py.subarray(0, n), pa: st.pa.subarray(0, n), step: st.step, L: (n - 1) * st.step }
}

/** The first arc length at which the finished plant would come too close to a word (Infinity when it never does). */
function firstClash(pl: Plant, stage: Stage, shadow: number) {
  const { keep } = stage
  let cut = Infinity
  const test = (x: number, y: number, need: number, s: number) => {
    if (sd(keep, pl.x + x, pl.y + y) < need + Math.hypot(x, y) * pl.amp * 1.1 + shadow) cut = Math.min(cut, s)
  }
  for (let i = 0; i < pl.px.length; i++) {
    const s = i * pl.step
    if (s >= cut) break
    test(pl.px[i], pl.py[i], PAD + 2 + 2 * curlAt(pl, s), s)
  }
  for (const c of pl.curls) {
    const [bx, by] = at(pl, c.s)
    test(bx, by, PAD + 2 * c.r + 1, c.s)
  }
  for (const b of pl.buds) {
    const [bx, by] = at(pl, b.s)
    test(bx, by, PAD + 2.8 * b.r + 1, b.s)
  }
  for (const lf of pl.leaves) {
    if (lf.s >= cut) continue
    const [bx, by, ba] = at(pl, lf.s)
    const need = PAD + lf.len * (0.1 + Math.abs(lf.bend))
    // Young, the leaf is smaller and folded toward the stem.
    for (const sc of [0.45, 0.75]) {
      const ya = ba + lf.side * lf.ang * (0.35 + 0.65 * sc)
      test(bx + Math.cos(ya) * lf.len * sc, by + Math.sin(ya) * lf.len * sc, need, lf.s)
    }
    const a = ba + lf.side * lf.ang
    const c = Math.cos(a), sn = Math.sin(a)
    test(bx + c * lf.len, by + sn * lf.len, need, lf.s)
    for (let k = 0; k < OUTLINE.length; k += 2) {
      const ox = OUTLINE[k] * lf.len, oy = OUTLINE[k + 1] * lf.wid
      test(bx + c * ox - sn * oy, by + sn * ox + c * oy, need, lf.s)
      test(bx + c * ox + sn * oy, by + sn * ox - c * oy, need, lf.s)
    }
  }
  return cut
}

/**
 * Plans one plant on a stem the caller lays (steered, or a vine's
 * route), shortening it until all of it keeps clear; null when too
 * little would be left.
 */
function plan(sp: Spec, stage: Stage, shadow: number, lay: (L: number, reach: (s: number) => number, amp: number, curl: number) => Stem): Plant | null {
  const { u } = stage
  const r = rng(sp.seed ^ 0x9e37)
  const amp = sp.kind === VINE ? VINE_AMP : AMP[sp.layer]
  const freq = TAU / (6.5 + r() * 4)
  const ph = r() * TAU
  const tint = r()
  const minL = (sp.kind === BLADE ? 26 : sp.kind === VINE ? 90 : 40) * u
  let L = sp.L
  for (let tries = 0; tries < 6 && L >= minL; tries++) {
    const curl = sp.kind === FROND ? Math.min(L * 0.07, 12 * u) : 0
    const probe = leavesFor(sp.kind, L, u, sp.seed)
    const st = lay(L, probe.reach, amp, curl)
    if (st.L < minL) return null
    // The stem may have stopped short: its leaves are planned for the length it reached.
    const { leaves, curls, buds, unfold } = st.L < L * 0.98 ? leavesFor(sp.kind, st.L, u, sp.seed) : probe
    const pl: Plant = {
      x: sp.x, y: sp.y, ...st, unfold, leaves, curls, buds, kind: sp.kind, tint, amp, freq, ph, g0: 0, g1: 1,
      curl: sp.kind === FROND ? Math.min(st.L * 0.07, 12 * u) : 0, turn: sp.side,
    }
    const cut = firstClash(pl, stage, shadow)
    if (cut === Infinity) return pl
    L = Math.min(cut * 0.92, st.L * 0.85)
  }
  return null
}

/** Draws one blade into the lit and shaded paths (and its shadow, edge and veins). */
function blade(
  lit: Path2D, shade: Path2D, shadow: Path2D | null, edge: Path2D | null, veins: Path2D | null,
  x0: number, y0: number, a: number, len: number, wid: number, bend: number, sx: number, sy: number, ribs: boolean,
) {
  const c = Math.cos(a), s = Math.sin(a)
  const b = wid * 0.6
  // A little curve along the midrib: the tip turns by `bend` of the length.
  const P = (fx: number, fy: number): [number, number] => {
    const off = bend * len * fx * fx
    return [x0 + c * fx * len - s * (fy * b + off), y0 + s * fx * len + c * (fy * b + off)]
  }
  const tip = P(1, 0), mid = P(0.5, 0)
  const upLit = s * LX - c * LY > 0
  /* Each half: rounding out from the base to its widest, just before
     the middle, then drawn in to a fine point — and back along the
     midrib. */
  const half = (path: Path2D, q: [number, number][], ox: number, oy: number, close: boolean) => {
    path.moveTo(x0 + ox, y0 + oy)
    path.bezierCurveTo(q[0][0] + ox, q[0][1] + oy, q[1][0] + ox, q[1][1] + oy, q[2][0] + ox, q[2][1] + oy)
    path.bezierCurveTo(q[3][0] + ox, q[3][1] + oy, q[4][0] + ox, q[4][1] + oy, tip[0] + ox, tip[1] + oy)
    if (close) path.quadraticCurveTo(mid[0] + ox, mid[1] + oy, x0 + ox, y0 + oy)
  }
  for (const sign of [1, -1]) {
    const q: [number, number][] = [P(0.05, 0.7 * sign), P(0.2, sign), P(0.42, sign), P(0.66, sign), P(0.82, 0.32 * sign)]
    half((sign < 0) === upLit ? lit : shade, q, 0, 0, true)
    if (shadow) half(shadow, q, sx, sy, true)
    if (edge) half(edge, q, 0, 0, false)
  }
  if (veins && len > 10) {
    const e = P(0.93, 0)
    veins.moveTo(x0, y0)
    veins.quadraticCurveTo(mid[0], mid[1], e[0], e[1])
    if (ribs && len > 36) {
      // Lateral veins, curving out toward the tip and stopping short of the edge.
      for (let v = 1; v <= 7; v++) {
        const t = v / 8.6
        const out = 0.78 * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95))
        const o = P(t, 0)
        for (const sign of [1, -1]) {
          const q = P(t + 0.06, out * 0.5 * sign), e2 = P(t + 0.14, out * sign)
          veins.moveTo(o[0], o[1])
          veins.quadraticCurveTo(q[0], q[1], e2[0], e2[1])
        }
      }
    }
  }
}

const painter: Painter<Scene> = {
  compose(stage, intensity, pal) {
    const { w, h, head, top, foot, keep, u } = stage
    const hx = head ? head.x + head.w / 2 : w / 2
    const hy = head ? head.y + head.h / 2 : (top + foot) / 2
    /* The opening: an ellipse around the words that reaches up toward
       the HUD, so the frame arches over them. On a tall, narrow screen
       it stays low, leaving the band above the words to a garland. */
    const cell = Math.max(6, 9 * u)
    const vines = 1 + Math.round(intensity * 1.6)
    // What a vine's route keeps clear: its leaves, its sway, the smoothing of a grid path.
    const needV = PAD + 27 * u * 1.1 + 2 + VINE_AMP * (w + h) * 0.7 + cell * 0.8
    const ax = head ? head.w / 2 + w * 0.02 + 10 : w * 0.28
    const lift = Math.min(0.62, Math.max(0.22, 0.25 + (w / h - 0.6) * 0.4))
    const floorY = head ? head.h / 2 + 10 : h * 0.3
    // ...but never so high that the outermost vine's arch would run into the HUD.
    const ay = Math.max(floorY, Math.min(head ? floorY + Math.max(0, head.y - top) * lift : h * 0.3, (hy - top - needV * 1.1) / (1.12 + 0.17 * vines)))
    const gapHalf = Math.max(18, w * 0.05)
    const sx = 4 * u, sy = 7 * u
    const layers: Plant[][] = [[], [], []]
    const density = 0.45 + intensity
    const room: Room = (x, y) => Math.min(sd(keep, x, y), (Math.hypot((x - hx) / ax, (y - hy) / ay) - 1) * Math.min(ax, ay) * 0.9)

    for (const side of [1, -1]) {
      // Neither side crosses the middle: the arch stays open at its top.
      const gate = (x: number) => side * (x - hx) > -gapHalf
      const edgeX = (inset: number) => (side > 0 ? -inset : w + inset)
      const file = (pl: Plant | null, layer: number, g0: number, g1: number) => {
        if (!pl) return
        pl.g0 = g0
        pl.g1 = g1
        layers[layer].push(pl)
      }
      /** A steered plant, trying a few headings (when given) for the one that keeps most of itself. */
      const sprout = (sp: Spec, g0: number, g1: number, turns = [0]) => {
        let best: Plant | null = null, score = 0
        for (const d of turns) {
          const th0 = sp.th0 - side * d
          const pl = plan({ ...sp, th0 }, stage, sp.layer === 2 ? Math.hypot(sx, sy) : 0, (L, reach, amp, curl) => steer({ ...sp, th0, L }, u, room, reach, amp, curl, sp.layer === 2 ? Math.hypot(sx, sy) : 0, gate))
          const sc = pl ? pl.L / sp.L - Math.abs(d) * 0.2 : 0
          if (pl && sc > score) { best = pl; score = sc }
        }
        file(best, sp.layer, g0, g1)
      }
      // The stretches of this side's edge with room to grow from.
      const xe = side > 0 ? 10 * u : w - 10 * u
      const free: number[] = []
      for (let y = top + 4; y < foot; y += 4) if (room(xe, y) >= 12 * u) free.push(y)
      if (!free.length) continue
      const span = free.length * 4
      const pick = (q: number) => free[Math.round(clamp01(q) * (free.length - 1))]

      /* VINES take the cheapest way from low on the side up to the top
         of their own ellipse around the opening, near the middle. */
      for (let k = 0; k < vines; k++) {
        const orbit = 1.08 + 0.17 * k
        const goals: [number, number][] = []
        for (let c = 1; c <= 3; c++) for (let y = top; y < hy; y += cell) goals.push([hx - side * (gapHalf + c * cell), y])
        const f = field(w, h, cell, (x, y) => {
          if (side * (x - hx) > -gapHalf) return Infinity
          const rm = room(x, y)
          if (rm < needV) return Infinity
          const band = (Math.hypot((x - hx) / ax, (y - hy) / ay) - orbit) / 0.16
          return 1 + Math.min(9, 2.2 * band * band) + 20 / (rm - needV + 8)
        }, goals)
        const col = side > 0 ? 0 : f.cols - 1
        const starts: number[] = []
        for (let j = f.rows - 1; j >= 0; j--) if (Number.isFinite(f.dist[j * f.cols + col]) && j * cell < foot) starts.push(j)
        if (!starts.length) continue
        // The first vine from the lowest reach of the edge, each further one a little higher.
        const j = starts[Math.min(starts.length - 1, Math.round(starts.length * 0.22 * k))]
        const pts = routeFrom(f, cellAt(f, side > 0 ? 0 : w, j * cell), 3)
        const x0 = edgeX(4), y0 = pts[0][1]
        const rs = resample([[x0, y0], ...pts], Math.max(3, 4.5 * u))
        if (rs.xs.length < 4) continue
        const route: Stem = {
          px: Float32Array.from(rs.xs, (v) => v - x0), py: Float32Array.from(rs.ys, (v) => v - y0), pa: Float32Array.from(rs.as),
          step: Math.max(3, 4.5 * u), L: (rs.xs.length - 1) * Math.max(3, 4.5 * u),
        }
        const seed = (side > 0 ? 31 : 37) * 100 + k
        file(plan({ kind: VINE, layer: 1, side, x: x0, y: y0, th0: 0, L: route.L, bend: 0, seed }, stage, 0, (L) => cutStem(route, L)), 1, 0.14 + 0.05 * k, 0.68 + 0.03 * k)
      }

      /* FRONDS and SPRAYS fan out from the edges, at the back and in the middle. */
      for (let layer = 0; layer < 2; layer++) {
        const spacing = ((layer ? 128 : 96) * Math.max(0.65, u)) / density
        const n = Math.max(1, Math.round(span / spacing))
        for (let k = 0; k < n; k++) {
          const seed = (side > 0 ? 7 : 13) * 1000 + layer * 100 + k
          const r = rng(seed)
          const y = pick((k + 0.5 + (r() - 0.5) * 0.75) / n)
          const v = clamp01((y - top) / (foot - top))
          const kind = r() < (layer ? 0.55 : 0.72) ? FROND : SPRAY
          const L = (kind === FROND ? (layer ? 215 : 255) : 165) * u * (0.8 + r() * 0.45)
          // Low plants climb; high ones reach in along the top and droop.
          const up = lerp(0.05, 1.25, v) + (r() - 0.5) * 0.3
          sprout({ kind, layer, side, x: edgeX(2), y, th0: side > 0 ? -up : Math.PI + up, L, bend: side * lerp(0.6, 1.4, v) * (0.75 + r() * 0.5) / L, seed },
            [0.1, 0.16][layer] + 0.14 * (1 - v) + r() * 0.04, [0.42, 0.48][layer] + 0.14 * (1 - v) + r() * 0.04, [0, 0.3, -0.3])
        }
      }

      /* In FRONT, broad blades and a big frond near the corners, their bases outside the frame. */
      const fronts = Math.max(1, Math.round((span / (230 * Math.max(0.65, u))) * density))
      for (let k = 0; k < fronts; k++) {
        const seed = (side > 0 ? 17 : 19) * 1000 + k
        const r = rng(seed)
        const y = pick(fronts === 1 ? 0.15 + r() * 0.2 : (k + 0.25 + r() * 0.5) / fronts)
        const v = clamp01((y - top) / (foot - top))
        const kind = r() < 0.66 ? BLADE : FROND
        const L = (kind === BLADE ? 70 : 240) * u * (0.8 + r() * 0.4)
        const up = lerp(-0.15, 1.1, v) + (r() - 0.5) * 0.3
        sprout({ kind, layer: 2, side, x: edgeX(kind === BLADE ? L * 0.3 : 8), y, th0: side > 0 ? -up : Math.PI + up, L, bend: side * 0.8 / L, seed },
          0.26 + 0.12 * (1 - v) + r() * 0.04, 0.56 + 0.12 * (1 - v) + r() * 0.04, [0, 0.35, -0.35, 0.7])
      }
    }
    const bg = pal.bg
    const tints = (a: RGB, b: RGB, t: number, spread: number) => [-1, 0, 1].map((k) => css(mix(bg, mix(a, b, 0.5 + k * 0.5), t * (1 + k * spread))))
    const inks: Ink[] = [
      { lit: tints(pal.forest, pal.olive, 0.11, 0.18), shade: tints(pal.palm, pal.forest, 0.17, 0.18), stem: css(mix(bg, pal.stem2, 0.3)), width: 0.8, vein: null, edge: null, shadow: null },
      {
        lit: tints(pal.palm, pal.fresh, 0.27, 0.16), shade: tints(pal.forest, pal.palm, 0.37, 0.14), stem: css(mix(bg, pal.stem, 0.5)), width: 1.05, vein: css(pal.deep, 0.15), edge: null, shadow: null,
        petal: [css(mix(bg, [255, 255, 255], 0.75)), css(pal.ink3, 0.32), css(mix(pal.lime, pal.olive, 0.45))],
      },
      { lit: tints(pal.olive, pal.fresh, 0.42, 0.12), shade: tints(pal.forest, pal.deep, 0.58, 0.1), stem: css(mix(bg, pal.stem, 0.75)), width: 1.5, vein: css(pal.deep, 0.24), edge: css(pal.deep, 0.28), shadow: css(pal.deep, 0.075) },
    ]
    return { layers, inks, sx, sy }
  },

  draw(ctx, scene, f) {
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (let li = 0; li < 3; li++) {
      const ink = scene.inks[li]
      const lit = [new Path2D(), new Path2D(), new Path2D()], shade = [new Path2D(), new Path2D(), new Path2D()]
      const stems = new Path2D()
      const veins = ink.vein ? new Path2D() : null
      const edge = ink.edge ? new Path2D() : null
      const shadow = ink.shadow ? new Path2D() : null
      const petals = new Path2D(), hearts = new Path2D()
      let blooms = false
      let any = false
      for (const pl of scene.layers[li]) {
        const g = clamp01((f.p - pl.g0) / (pl.g1 - pl.g0))
        if (g <= 0) continue
        any = true
        const front = (pl.L + pl.unfold) * easeInOut(g)
        const sw = f.still ? 0 : (pl.amp * (Math.sin(pl.freq * f.t + pl.ph) + 0.35 * Math.sin(2.31 * pl.freq * f.t + 1.7 * pl.ph))) / 1.35
        const ca = Math.cos(sw), sa = Math.sin(sw)
        const X = (x: number, y: number) => pl.x + x * ca - y * sa
        const Y = (x: number, y: number) => pl.y + x * sa + y * ca
        // The stem as far as it has grown, and the fiddlehead still rolled at its tip.
        const end = Math.min(front, pl.L)
        const last = Math.min(pl.px.length - 1, Math.floor(end / pl.step))
        stems.moveTo(X(pl.px[0], pl.py[0]), Y(pl.px[0], pl.py[0]))
        for (let i = 1; i <= last; i++) stems.lineTo(X(pl.px[i], pl.py[i]), Y(pl.px[i], pl.py[i]))
        const [ex, ey, ea] = at(pl, end)
        stems.lineTo(X(ex, ey), Y(ex, ey))
        const R = curlAt(pl, front)
        if (R > 0.6) {
          const cx = ex - Math.sin(ea) * pl.turn * R, cy = ey + Math.cos(ea) * pl.turn * R
          const a0 = Math.atan2(ey - cy, ex - cx)
          for (let k = 1; k <= 20; k++) {
            const a = a0 + pl.turn * (k / 20) * 1.7 * Math.PI
            const rr = R * (1 - 0.8 * (k / 20))
            stems.lineTo(X(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr), Y(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr))
          }
        }
        // Tendrils, coiled as they appear.
        for (const c of pl.curls) {
          const k = (front - c.s) / (pl.unfold * 0.6)
          if (k <= 0) continue
          const [bx, by, ba] = at(pl, c.s)
          const rr = c.r * easeOut(clamp01(k))
          const cx = bx - Math.sin(ba) * c.side * rr, cy = by + Math.cos(ba) * c.side * rr
          const a0 = Math.atan2(by - cy, bx - cx)
          stems.moveTo(X(bx, by), Y(bx, by))
          for (let j = 1; j <= 16; j++) {
            const a = a0 + c.side * (j / 16) * 2.4 * Math.PI
            const q = rr * (1 - 0.7 * (j / 16))
            stems.lineTo(X(cx + Math.cos(a) * q, cy + Math.sin(a) * q), Y(cx + Math.cos(a) * q, cy + Math.sin(a) * q))
          }
        }
        // The leaves behind the front, each unfolding over the stretch after it.
        const tone = pl.tint < 0.33 ? 0 : pl.tint < 0.66 ? 1 : 2
        for (const lf of pl.leaves) {
          const k = (front - lf.s) / (pl.unfold * (pl.kind === BLADE ? 1 : 0.55))
          if (k <= 0) continue
          const sc = easeOut(clamp01(k))
          const len = lf.len * sc
          if (len < 0.8) continue
          const [bx, by, ba] = at(pl, lf.s)
          const flutter = f.still ? 0 : 0.04 * Math.sin(1.9 * pl.freq * f.t + lf.ph)
          // Folded along the stem while young, opening to its angle as it grows.
          const a = ba + lf.side * lf.ang * (0.35 + 0.65 * sc) + flutter + sw
          blade(lit[tone], shade[tone], shadow, edge, veins, X(bx, by), Y(bx, by), a, len, lf.wid * (0.3 + 0.7 * sc) * sc, lf.bend * lf.side, scene.sx, scene.sy, pl.kind === BLADE)
        }
        // Flowers open on the older growth once the leaves around them have.
        for (const b of pl.buds) {
          const k = ((front - b.s) / pl.unfold - 0.35) / 0.6
          if (k <= 0) continue
          const bloom = easeOut(clamp01(k))
          const [bx, by, ba] = at(pl, b.s)
          const cx = bx - Math.sin(ba) * b.side * b.r * 1.15, cy = by + Math.cos(ba) * b.side * b.r * 1.15
          stems.moveTo(X(bx, by), Y(bx, by))
          stems.lineTo(X(cx, cy), Y(cx, cy))
          const gx = X(cx, cy), gy = Y(cx, cy), r = b.r * bloom
          for (let q = 0; q < 5; q++) {
            const a = ba + b.s * 0.07 + (q * TAU) / 5
            const ex = gx + Math.cos(a) * r * 0.55, ey = gy + Math.sin(a) * r * 0.55
            petals.moveTo(ex + Math.cos(a) * r * 0.5, ey + Math.sin(a) * r * 0.5)
            petals.ellipse(ex, ey, r * 0.5, r * 0.3, a, 0, TAU)
          }
          hearts.moveTo(gx + r * 0.2, gy)
          hearts.arc(gx, gy, r * 0.2, 0, TAU)
          blooms = true
        }
      }
      if (!any) continue
      if (shadow) { ctx.fillStyle = ink.shadow as string; ctx.fill(shadow) }
      ctx.strokeStyle = ink.stem
      ctx.lineWidth = ink.width
      ctx.stroke(stems)
      for (let t = 0; t < 3; t++) {
        ctx.fillStyle = ink.shade[t]
        ctx.fill(shade[t])
        ctx.fillStyle = ink.lit[t]
        ctx.fill(lit[t])
      }
      if (edge) { ctx.strokeStyle = ink.edge as string; ctx.lineWidth = 0.6; ctx.stroke(edge) }
      if (veins) { ctx.strokeStyle = ink.vein as string; ctx.lineWidth = 0.6; ctx.stroke(veins) }
      if (blooms && ink.petal) {
        ctx.fillStyle = ink.petal[0]
        ctx.fill(petals)
        ctx.strokeStyle = ink.petal[1]
        ctx.lineWidth = 0.6
        ctx.stroke(petals)
        ctx.fillStyle = ink.petal[2]
        ctx.fill(hearts)
      }
    }
  },
}

export default function BotanicalGateway(props: ContactAnimationProps) {
  const { rootRef, canvasRef, rootStyle, canvasStyle } = useContactCanvas('contact.botanical-gateway', props, painter)
  return (
    <div ref={rootRef} style={rootStyle}>
      <canvas ref={canvasRef} style={canvasStyle} />
    </div>
  )
}
