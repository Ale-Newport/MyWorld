/* ============================================================
   FLORA — THE BOTANICAL VOCABULARY

   Line art, not illustration. Every sprig is a handful of open
   stroke paths on a 0–100 box anchored at (50, 100) and growing
   upward, so a plant can be dropped anywhere, scaled by its own
   transform, and drawn on by sweeping a dash.

   Paths come back ordered base → tip. Give each `<path>` the
   attribute `pathLength="1"` and the whole sprig animates from
   nothing to grown with a single normalised offset — no
   getTotalLength(), no layout read, no per-plant measurement.

   Shapes are generated from a seed rather than drawn by hand:
   fifty hand-drawn ferns would be fifty files, and fifty copies
   of one fern would read as wallpaper. The seed is the drawing.
   ============================================================ */

export type FloraKind = 'fern' | 'frond' | 'grass' | 'sprout' | 'tendril' | 'seedhead'

export interface FloraSprig {
  kind: FloraKind
  /** Open stroke paths, base → tip. */
  paths: string[]
  /** Filled marks — seeds and buds, the only solid ink here. */
  dots: { x: number; y: number; r: number }[]
  /** Rough visual weight, 0..1. Used to keep dense plants rarer. */
  mass: number
}

/* ------------------------------------------------------------
   Deterministic randomness. A plant must look the same on every
   render of the same seed — React will re-run this, and a fern
   that reshuffles itself mid-scroll is a bug, not a breeze.
   ------------------------------------------------------------ */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Two decimals is well under a pixel at any size these draw at. */
const n = (v: number) => Math.round(v * 100) / 100
const between = (r: () => number, lo: number, hi: number) => lo + r() * (hi - lo)

type Pt = [number, number]

/** Point on a quadratic Bézier. */
function qPoint(p0: Pt, c: Pt, p1: Pt, t: number): Pt {
  const u = 1 - t
  return [
    u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0],
    u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1],
  ]
}

/** Tangent angle of a quadratic, in radians. */
function qAngle(p0: Pt, c: Pt, p1: Pt, t: number): number {
  const u = 1 - t
  return Math.atan2(
    2 * u * (c[1] - p0[1]) + 2 * t * (p1[1] - c[1]),
    2 * u * (c[0] - p0[0]) + 2 * t * (p1[0] - c[0]),
  )
}

const curve = (p0: Pt, c: Pt, p1: Pt) =>
  `M${n(p0[0])} ${n(p0[1])}Q${n(c[0])} ${n(c[1])} ${n(p1[0])} ${n(p1[1])}`

/* ------------------------------------------------------------
   THE PLANTS
   ------------------------------------------------------------ */

/** A stem with paired pinnae, shortening toward the tip. */
function fern(r: () => number): FloraSprig {
  const h = between(r, 60, 92)
  const lean = between(r, -20, 20)
  const base: Pt = [50, 100]
  const tip: Pt = [50 + lean, 100 - h]
  const ctrl: Pt = [50 + lean * 0.2, 100 - h * 0.55]

  const paths = [curve(base, ctrl, tip)]
  const pairs = Math.round(between(r, 5, 8))
  const spread = between(r, 0.9, 1.25)

  for (let i = 0; i < pairs; i++) {
    const t = 0.2 + (i / pairs) * 0.72
    const at = qPoint(base, ctrl, tip, t)
    const along = qAngle(base, ctrl, tip, t)
    // Pinnae shrink toward the tip, which is what makes a fern
    // read as a fern rather than as a comb.
    const len = between(r, 13, 19) * (1 - t * 0.72)
    for (const side of [-1, 1] as const) {
      const a = along + side * spread
      const end: Pt = [at[0] + Math.cos(a) * len, at[1] + Math.sin(a) * len]
      // The control point sits short and swept toward the tip, so
      // each pinna lifts rather than sticking out square.
      const c: Pt = [
        at[0] + Math.cos(a - side * 0.5) * len * 0.6,
        at[1] + Math.sin(a - side * 0.5) * len * 0.6,
      ]
      paths.push(curve(at, c, end))
    }
  }
  return { kind: 'fern', paths, dots: [], mass: 0.85 }
}

/** One broad leaf: a midrib, an outline in two halves, a few veins. */
function frond(r: () => number): FloraSprig {
  const h = between(r, 52, 80)
  const lean = between(r, -16, 16)
  const w = between(r, 11, 19)
  const base: Pt = [50, 100]
  const tip: Pt = [50 + lean, 100 - h]
  const mid: Pt = [50 + lean * 0.4, 100 - h * 0.5]

  const paths = [curve(base, [50 + lean * 0.2, 100 - h * 0.55], tip)]
  for (const side of [-1, 1] as const) {
    paths.push(
      `M${n(base[0])} ${n(base[1])}Q${n(mid[0] + side * w)} ${n(mid[1] + h * 0.12)} ${n(tip[0])} ${n(tip[1])}`,
    )
  }

  const veins = Math.round(between(r, 3, 6))
  for (let i = 1; i <= veins; i++) {
    const t = i / (veins + 1)
    const on = qPoint(base, [50 + lean * 0.2, 100 - h * 0.55], tip, t)
    const reach = w * Math.sin(t * Math.PI) * 0.92
    for (const side of [-1, 1] as const) {
      paths.push(
        `M${n(on[0])} ${n(on[1])}Q${n(on[0] + side * reach * 0.6)} ${n(on[1] - 1)} ${n(on[0] + side * reach)} ${n(on[1] - h * 0.07)}`,
      )
    }
  }
  return { kind: 'frond', paths, dots: [], mass: 0.7 }
}

/** A tuft of blades from one point. The cheapest plant here. */
function grass(r: () => number): FloraSprig {
  const blades = Math.round(between(r, 4, 7))
  const paths: string[] = []
  for (let i = 0; i < blades; i++) {
    const h = between(r, 28, 72)
    const lean = between(r, -30, 30)
    paths.push(
      curve([50, 100], [50 + lean * 0.3, 100 - h * 0.6], [50 + lean, 100 - h]),
    )
  }
  return { kind: 'grass', paths, dots: [], mass: 0.35 }
}

/** Two leaves and a shoot — the first thing that comes up. */
function sprout(r: () => number): FloraSprig {
  const h = between(r, 16, 30)
  const lean = between(r, -6, 6)
  const top: Pt = [50 + lean, 100 - h]
  const paths = [curve([50, 100], [50, 100 - h * 0.6], top)]
  const leaf = between(r, 10, 16)
  for (const side of [-1, 1] as const) {
    const end: Pt = [top[0] + side * leaf, top[1] - leaf * 0.42]
    paths.push(
      curve(top, [top[0] + side * leaf * 0.45, top[1] - leaf * 0.75], end),
      curve(top, [top[0] + side * leaf * 0.75, top[1] + leaf * 0.14], end),
    )
  }
  return { kind: 'sprout', paths, dots: [], mass: 0.28 }
}

/** A climber: a stem that gives up on being straight and coils. */
function tendril(r: () => number): FloraSprig {
  const h = between(r, 46, 78)
  const lean = between(r, -22, 22)
  const base: Pt = [50, 100]
  const tip: Pt = [50 + lean, 100 - h]
  const ctrl: Pt = [50 + lean * 1.9, 100 - h * 0.5]
  const paths = [curve(base, ctrl, tip)]

  // The coil is sampled rather than curved: an involute drawn with
  // Béziers needs more control points than it needs samples.
  const turns = between(r, 1.4, 2.3)
  const dir = r() < 0.5 ? -1 : 1
  const r0 = between(r, 7, 12)
  const steps = 26
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const a = dir * t * turns * Math.PI * 2 - Math.PI / 2
    const rad = r0 * (1 - t * 0.82)
    const x = tip[0] + dir * r0 + Math.cos(a) * rad
    const y = tip[1] + Math.sin(a) * rad
    d += `${i === 0 ? 'M' : 'L'}${n(x)} ${n(y)}`
  }
  paths.push(d)
  return { kind: 'tendril', paths, dots: [], mass: 0.45 }
}

/** A stem carrying seeds. The only sprig that puts down solid ink. */
function seedhead(r: () => number): FloraSprig {
  const h = between(r, 44, 74)
  const lean = between(r, -14, 14)
  const base: Pt = [50, 100]
  const tip: Pt = [50 + lean, 100 - h]
  const ctrl: Pt = [50 + lean * 0.3, 100 - h * 0.55]
  const paths = [curve(base, ctrl, tip)]

  const count = Math.round(between(r, 6, 11))
  const dots: FloraSprig['dots'] = []
  const spread = between(r, 6, 10)
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + r() * 0.5
    const rad = spread * (0.45 + r() * 0.55)
    const x = tip[0] + Math.cos(a) * rad
    const y = tip[1] + Math.sin(a) * rad * 0.85
    paths.push(`M${n(tip[0])} ${n(tip[1])}L${n(x)} ${n(y)}`)
    dots.push({ x: n(x), y: n(y), r: n(between(r, 0.9, 1.7)) })
  }
  return { kind: 'seedhead', paths, dots, mass: 0.55 }
}

const BUILDERS: Record<FloraKind, (r: () => number) => FloraSprig> = {
  fern, frond, grass, sprout, tendril, seedhead,
}

export const floraKinds = Object.keys(BUILDERS) as FloraKind[]

/** The one plant a seed grows. */
export function sprig(kind: FloraKind, seed: number): FloraSprig {
  return BUILDERS[kind](mulberry32(seed))
}

/**
 * Weighted pick. Sprouts and grass are common because they are
 * quiet; ferns and fronds are rare because two of them next to
 * each other stop being an accent and start being a border.
 */
const WEIGHTS: [FloraKind, number][] = [
  ['sprout', 0.26], ['grass', 0.24], ['seedhead', 0.17],
  ['tendril', 0.15], ['frond', 0.11], ['fern', 0.07],
]

export function pickKind(rand: () => number): FloraKind {
  let x = rand()
  for (const [kind, w] of WEIGHTS) {
    if (x < w) return kind
    x -= w
  }
  return 'grass'
}
