import {
  createElement,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactElement,
} from 'react'
import { mulberry32 } from './flora'

/* ============================================================
   CANOPY — THE LARGE-LEAF VOCABULARY

   `flora.ts` draws sprigs: small, open, stroke-only things that
   live in a margin and are revealed by sweeping a dash. This
   module draws the other half of the journey — blades big enough
   to have an inside. A monstera is not a bigger fern; it is a
   filled silhouette with a midrib, arching secondaries, tertiary
   cross-veins between them, torn margins and holes. None of that
   is expressible as one open stroke, so none of flora's
   machinery transfers.

   WHAT A LEAF IS HERE
   A blade is built from an AXIS (the midrib), a WIDTH PROFILE
   (half-width as a function of distance along that axis) and a
   MARGIN (the profile sampled, roughened and smoothed into a
   closed outline). Veins are generated from the same axis, so
   they curve with the leaf rather than being drawn on top of a
   shape that has forgotten them. That single shared axis is what
   stops these reading as clip art: in real foliage every line on
   a leaf is a consequence of the same growth.

   THE LOCAL FRAME
   Origin (0, 0) is the PETIOLE BASE — where the leaf meets its
   stem — and the blade extends along +X, with the two margins in
   ±Y. A placement rotates and scales from that origin, which is
   the point a real leaf actually pivots about when it bends. The
   0-100 box flora.ts uses would put the pivot in the wrong place
   for anything that hangs.

   HOW THESE ARE REVEALED
   A dash sweep cannot reveal a fill. So a blade grows by a
   CLIP WIPE — a rect in the leaf's own local frame whose width
   runs 0 → length as `--grow` climbs — while its veins ride the
   ordinary `pathLength="1"` dash a fraction behind, so the ink
   arrives just after the surface it sits on. Base-to-tip
   ordering is therefore as load-bearing here as it is in
   flora.ts, and every generator honours it.

   Nothing in this module is reachable from flora's `pickKind`:
   the procedural margin layer must never spontaneously plant a
   banana leaf.
   ============================================================ */

export type CanopyKind =
  | 'monsteraShadow' | 'monsteraJuvenile' | 'monsteraLarge'
  | 'palmFrondArc' | 'palmFrondLow'
  | 'bananaBlade'
  | 'philodendronHeart' | 'philodendronPinnate'
  | 'vinePrimary' | 'vineTrailing' | 'ivyClimber'

/** Depth band. Decides ink strength, line work and stroke weight. */
export type Band = 'shadow' | 'back' | 'mid' | 'front' | 'close'

/** How much line work a band pays for. Drawn from HOME_NATURE_SYSTEM.md §2.3. */
export const BAND_DETAIL: Record<Band, {
  midrib: boolean; secondary: boolean; tertiary: boolean; edge: boolean; gradient: boolean
}> = {
  shadow: { midrib: false, secondary: false, tertiary: false, edge: false, gradient: false },
  back:   { midrib: true,  secondary: false, tertiary: false, edge: false, gradient: false },
  mid:    { midrib: true,  secondary: true,  tertiary: false, edge: false, gradient: true  },
  front:  { midrib: true,  secondary: true,  tertiary: true,  edge: true,  gradient: true  },
  close:  { midrib: false, secondary: false, tertiary: false, edge: true,  gradient: true  },
}

export type Pt = [number, number]

const n = (v: number) => Math.round(v * 100) / 100
export const rand = mulberry32

/* ------------------------------------------------------------
   PATHS
   ------------------------------------------------------------ */

/**
 * Catmull-Rom through the given points, emitted as cubic Béziers.
 * Sampling a profile and joining it with straight lines gives a
 * faceted margin that reads as a polygon; this is what makes the
 * same samples read as a leaf.
 */
export function smooth(points: Pt[], closed = false): string {
  if (points.length < 2) return ''
  const p = points
  const last = p.length - 1
  const at = (i: number): Pt =>
    closed ? p[(i + p.length) % p.length] : p[Math.min(last, Math.max(0, i))]

  let d = `M${n(p[0][0])} ${n(p[0][1])}`
  const end = closed ? p.length : last
  for (let i = 0; i < end; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2)
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += `C${n(c1[0])} ${n(c1[1])} ${n(c2[0])} ${n(c2[1])} ${n(p2[0])} ${n(p2[1])}`
  }
  return closed ? `${d}Z` : d
}

/* ------------------------------------------------------------
   THE AXIS
   ------------------------------------------------------------ */

export interface AxisSpec {
  /** Distance from petiole base to tip. */
  length: number
  /** Perpendicular displacement of the tip — the leaf's droop. */
  droop?: number
  /** Where along the axis the droop is most pronounced, 0..1. */
  bias?: number
}

/** The midrib, as a function of t in 0..1. */
export function axisPoint(spec: AxisSpec, t: number): Pt {
  const { length, droop = 0, bias = 0.6 } = spec
  // Bend accelerates toward the tip the way a cantilever does —
  // a leaf is stiff where it meets the stem and slack at the end.
  const k = Math.pow(t, 1 + bias)
  return [t * length, k * droop]
}

/** Tangent angle of the midrib at t, in radians. */
export function axisAngle(spec: AxisSpec, t: number): number {
  const a = axisPoint(spec, Math.max(0, t - 0.01))
  const b = axisPoint(spec, Math.min(1, t + 0.01))
  return Math.atan2(b[1] - a[1], b[0] - a[0])
}

/**
 * The midrib as a drawable path, base → tip, stopped a little
 * short of the apex.
 *
 * `to` is the fraction of the axis the rib is actually drawn
 * along, and it defaults to short of 1 for a reason that cost
 * two families a rendering each to find. Every width profile in
 * this module reaches EXACTLY zero at t = 1, so the last stretch
 * of the axis runs through tissue narrower than the rib's own
 * stroke; a round line cap then hangs a visible spur out past the
 * point of the blade. That is the "midrib outliving its leaf"
 * tell, and it is the one thing a viewer notices without being
 * able to name it.
 *
 * In the plant the rib does not end either — it thins into the
 * drip tip and is lost. Stopping the stroke a few per cent short
 * is the honest version of being lost, and it is why both the
 * monstera and the banana had independently written this same
 * function locally before it was folded back here.
 */
export function midribPath(spec: AxisSpec, samples = 14, to = 0.94): string {
  const pts: Pt[] = []
  for (let i = 0; i <= samples; i++) pts.push(axisPoint(spec, (to * i) / samples))
  return smooth(pts)
}

/* ------------------------------------------------------------
   THE BLADE
   ------------------------------------------------------------ */

/** Half-width of the blade at t — this is what gives a family its silhouette. */
export type WidthProfile = (t: number) => number

/**
 * One profile generator, three families. `peak` is where the leaf
 * is widest and `power` is how square its shoulders are — a low
 * power holds the width almost to both ends (a strap), a high one
 * comes to a point (a blade).
 *
 * Both halves are sine quadrants, so the width reaches EXACTLY
 * zero at t = 1. That is not tidiness: the midrib is drawn along
 * the same axis, and a profile that still has width at the tip
 * leaves the rib sticking out past the leaf it belongs to.
 */
function shaped(w: number, peak: number, power: number): WidthProfile {
  return (t) => {
    const c = Math.min(1, Math.max(0, t))
    const tt = c < peak ? 0.5 * (c / peak) : 0.5 + 0.5 * ((c - peak) / (1 - peak))
    return w * Math.pow(Math.sin(Math.PI * tt), power)
  }
}

/** Widest at two-fifths, long taper to a drip tip. Monstera. */
export const profileBroad = (w: number): WidthProfile => shaped(w, 0.42, 0.82)

/** Near-parallel margins that close late. Banana, strelitzia. */
export const profileStrap = (w: number): WidthProfile => shaped(w, 0.5, 0.26)

/** Widest close to the base, then a long fall. Heart-leaf philodendron. */
export const profileHeart = (w: number): WidthProfile => shaped(w, 0.26, 0.9)

export interface BladeSpec {
  axis: AxisSpec
  width: WidthProfile
  /** Margin roughness in local units. Zero is a printed leaf; nothing is zero. */
  jitter?: number
  /** Multiplies the +Y side only. Real leaves are not symmetric about the midrib. */
  asymmetry?: number
  /**
   * A basal sinus — the notch a heart-shaped leaf has where the
   * petiole enters. Fraction of length; 0 for leaves without one.
   */
  sinus?: number
  samples?: number
}

/**
 * The closed outline, emitted base → one margin → tip → the
 * other margin → base, so a clip wipe travelling along +X
 * uncovers it in the order it grew.
 */
export function bladePath(spec: BladeSpec, r: () => number): string {
  const { axis, width, jitter = 0, asymmetry = 1, sinus = 0, samples = 26 } = spec

  /* A cordate base is the one thing this sampling loop cannot
     produce, and for a while it pretended otherwise: it moved the
     first sample of each margin out to `(-d, ±width(0.14))` and
     closed the outline through a vertex at the origin. That gives
     each basal lobe exactly ONE point, one point is a corner, and
     two corners either side of a wide V is a fish tail. See
     `cordateBlade` below — that is what a heart base actually
     needs, and it is now what `sinus` means. The delegation
     happens before a single random number is drawn so the two
     entry points stay the same plant. */
  if (sinus > 0) {
    return cordateBlade({ axis, width, jitter, asymmetry, lobe: sinus, samples }, r).d
  }

  const up: Pt[] = []
  const down: Pt[] = []

  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const [x, y] = axisPoint(axis, t)
    const a = axisAngle(axis, t)
    // Perpendicular to the midrib, not to the page: the width of a
    // curved leaf is measured across its own spine.
    const nx = -Math.sin(a), ny = Math.cos(a)
    const base = width(t)
    // Roughness dies at the tip, where a leaf comes to a point
    // however ragged its sides are.
    const rough = jitter * (1 - t) * (r() - 0.5)
    const wUp = (base + rough) * asymmetry
    const wDn = base + jitter * (1 - t) * (r() - 0.5)
    up.push([x + nx * wUp, y + ny * wUp])
    down.push([x - nx * wDn, y - ny * wDn])
  }

  const outline = [...up, ...down.reverse()]
  return smooth(outline, true)
}

/* ------------------------------------------------------------
   THE CORDATE BASE

   The single thing that decided whether this library read as
   botany or as clip art, and it took a proof sheet of every
   family side by side to see why.

   Once the eye has been given a tail it goes looking for a body
   and an eye to put with it: at the shadow band, where there is
   no vein work to argue with, `MonsteraShadow` was a fish with a
   gill slit — and it is the FIRST botanical mark the visitor ever
   sees on the site. No width profile can fix that, because no
   width profile can add points to an outline.

   So the base is built here, out of the same primitives the
   sampling loop uses. Two things make it a heart rather than a
   tail:

   - the lobes are ARCS, five points each, so the curve closes
     round them instead of turning a corner;
   - the sinus is a narrow SLOT rather than a wide V. A real
     cordate base has its lobes very nearly touching, and a wide
     opening is exactly what the eye reads as a fork.

   The tip is finished here too, for the opposite reason: the
   margin stops short of the apex and the apex is added as a
   single point with a shoulder either side of it, so the blade is
   drawn OUT to an acuminate drip tip rather than rounded off by
   the last two samples meeting each other.

   This arrived in the library as a local correction inside
   `Monstera.tsx`, where the first family to need it wrote it.
   Three other families then imported it across a module boundary
   that made no sense, which is the usual sign that something is
   vocabulary rather than a family's own business.
   ------------------------------------------------------------ */

export interface CordateSpec {
  axis: AxisSpec
  width: WidthProfile
  jitter?: number
  asymmetry?: number
  /** How far the lobes reach BEHIND the petiole, as a fraction of length. */
  lobe: number
  /** Where the lobes hand over to the blade's own margin, in t. */
  hold?: number
  /** Half-width of the sinus slot, as a fraction of the blade at `hold`. */
  slot?: number
  /** Where the margin stops and the drawn-out apex takes over. */
  apex?: number
  samples?: number
}

export interface CordateBlade {
  d: string
  /** The outline's own points, so bounds are measured rather than estimated. */
  points: Pt[]
}

export function cordateBlade(spec: CordateSpec, r: () => number): CordateBlade {
  const {
    axis, width, jitter = 0, asymmetry = 1,
    lobe, hold = 0.18, slot = 0.16, apex = 0.94, samples = 26,
  } = spec
  const back = lobe * axis.length
  const wHold = width(hold)
  const slotHalf = wHold * slot

  /** A point on one margin at t, with the roughness that side carries. */
  const margin = (t: number, side: 1 | -1): Pt => {
    const [x, y] = axisPoint(axis, t)
    const a = axisAngle(axis, t)
    const nx = -Math.sin(a), ny = Math.cos(a)
    const rough = jitter * (1 - t) * (r() - 0.5)
    const w = (width(t) + rough) * (side === 1 ? asymmetry : 1)
    return [x + side * nx * w, y + side * ny * w]
  }

  /**
   * One lobe, from the mouth of the slot round to the shoulder
   * where the blade's own margin takes over. The radii are
   * fractions of the blade at `hold`, so a lobe is always in
   * proportion to the leaf it belongs to, and the arc is walked
   * backwards first and then forwards — that reversal is what
   * makes it a lobe and not a spur.
   */
  const lobeArc = (side: 1 | -1): Pt[] => {
    const full = wHold * (1 - slot) * 0.97
    const w = (f: number) => side * (slotHalf + full * f)
    return [
      [-back * 0.30, w(0.04)],
      [-back * 0.78, w(0.24)],
      [-back * 0.99, w(0.55)],
      [-back * 0.84, w(0.84)],
      [-back * 0.36, w(0.99)],
    ]
  }

  const up: Pt[] = []
  const down: Pt[] = []
  for (let i = 0; i <= samples; i++) {
    const t = hold + ((apex - hold) * i) / samples
    up.push(margin(t, 1))
    down.push(margin(t, -1))
  }

  /* The apex needs a shoulder on each side or the smoothing
     overshoots it: a curve arriving from one margin's full width
     and leaving for the other's swings past the point and cuts a
     notch back into the blade, which on the heart-leaf read as a
     second, smaller tail. Two points at a third of the remaining
     width draw the apex OUT instead, which is also what an
     acuminate drip tip actually does. */
  const drawOut = (side: 1 | -1): Pt => {
    const t = apex + (1 - apex) * 0.55
    const [x, y] = axisPoint(axis, t)
    const a = axisAngle(axis, t)
    const nx = -Math.sin(a), ny = Math.cos(a)
    const w = width(t) * 0.34 * (side === 1 ? asymmetry : 1)
    return [x + side * nx * w, y + side * ny * w]
  }
  up.push(drawOut(1))
  down.push(drawOut(-1))

  /* The notch sits slightly FORWARD of the petiole, which is what
     gives the slot its depth. At the origin the two lobes would
     merely meet, and a base that merely meets is a fork again. */
  const notch: Pt = [back * 0.26, 0]
  const tip = axisPoint(axis, 1)

  const points: Pt[] = [
    notch,
    ...lobeArc(1),
    ...up,
    tip,
    ...down.reverse(),
    ...lobeArc(-1).reverse(),
  ]
  return { d: smooth(points, true), points }
}

/**
 * The width profile a cordate blade ACTUALLY has, apex included.
 *
 * `cordateBlade` stops sampling the margin at `apex` and finishes
 * the leaf with two shoulders at a third of the remaining width
 * and a single point at the tip, because that is what an
 * acuminate drip tip is and because closing the last two margin
 * samples into each other cuts a notch back into the blade. The
 * consequence is that past `apex` the real leaf is a great deal
 * narrower than the profile it was built from — and everything
 * that asks the profile where the margin is, which is now every
 * vein and every fenestration, believes the wider answer.
 *
 * On the heart-leaf that showed as a small fan of lines radiating
 * out past the drip tip: the last secondaries leave the midrib at
 * barely thirty degrees, so they spend almost all of their length
 * travelling into exactly the stretch the profile is wrong about.
 *
 * This is not a correction for a broken generator — the two
 * wrappers that were are gone. It is a statement of what the
 * outline is, interpolated through the three points the apex is
 * actually built from, so that the blade and the marks on it are
 * finally reading the same leaf.
 */
export function cordateWidth(width: WidthProfile, apex = 0.94): WidthProfile {
  const shoulderAt = apex + (1 - apex) * 0.55
  return (t) => {
    if (t <= apex) return width(t)
    const u = (t - apex) / (1 - apex)
    const full = width(apex)
    const shoulder = width(shoulderAt) * 0.34
    // Piecewise between (0, full), (0.55, shoulder) and (1, 0).
    if (u <= 0.55) return full + (shoulder - full) * (u / 0.55)
    return shoulder * (1 - (u - 0.55) / 0.45)
  }
}

/** A local box, in the plant's own frame. */
export interface LeafBounds { x: number; y: number; width: number; height: number }

/**
 * Bounds of an outline this module built, padded for the
 * overshoot a closed Catmull-Rom rides outside its own samples.
 * The wipe is a clip rect, so a rect short by a hair crops the
 * finished leaf forever — invisible while it grows and permanent
 * once it has.
 */
export function outlineBounds(points: readonly Pt[], length: number): LeafBounds {
  let minX = 0, maxX = 0, minY = 0, maxY = 0
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const pad = length * 0.05
  return {
    x: n(minX - pad),
    y: n(minY - pad),
    width: n(maxX - minX + pad * 2),
    height: n(maxY - minY + pad * 2),
  }
}

/* ------------------------------------------------------------
   WHERE THE BLADE ENDS

   Every generator below launches something from the midrib at an
   angle — a secondary, a tertiary rung, a fenestration slot — and
   every one of them needs the same answer: how far can this
   travel before it leaves the leaf?

   For a long time each one guessed, and each one guessed the same
   way, by taking a fraction of the HALF-WIDTH AT ITS OWN ORIGIN.
   That is only correct for a vein leaving at ninety degrees on a
   blade of constant width, and this vocabulary has neither. The
   spread runs from 78° at the base to 32° at the tip, so most of
   a vein's length is spent travelling ALONG the blade rather than
   across it, into tissue that is a different width from the
   tissue it started in. Two opposite failures came out of the one
   mistake: on a tapering blade the outer secondaries finished
   outside the margin, which is the whiskery tip that gives a
   drawn-from-memory leaf away; and on a widening one a
   fenestration asking to reach the margin fell short of it, so
   every split closed into a punched hole and the library came
   back with entire margins and two neat rows of slots inside
   them — the icon of a monstera rather than a monstera.

   Three tracks each wrote a private correction for one half of
   this. Neither correction was wrong; both were the same missing
   function, which is this one.

   It walks the ray out and asks the real margin, because the
   margin is a sampled profile along a curved axis and there is no
   closed form worth the algebra. A coarse scan finds the segment
   where the ray crosses, then a bisection inside that segment
   pins it. Exactness is cheap here: this runs once, at build
   time, and never again.
   ------------------------------------------------------------ */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * The distance from `axisPoint(axis, t)` to the margin, along the
 * absolute local direction `angle`.
 *
 * The test is a genuine projection onto the midrib rather than a
 * comparison of vertical offsets: on a blade that droops by a
 * quarter of its own length the axis leans twenty degrees, and
 * measuring width up the page instead of across the spine is a
 * six per cent error in the one place six per cent shows.
 */
export function marginReach(
  axis: AxisSpec,
  width: WidthProfile,
  t: number,
  angle: number,
): number {
  const [x0, y0] = axisPoint(axis, t)
  const ux = Math.cos(angle), uy = Math.sin(angle)

  /** True while the point `d` along the ray is still on the blade. */
  const inside = (d: number): boolean => {
    const px = x0 + ux * d, py = y0 + uy * d
    // `axisPoint` puts x at exactly t * length, so the foot of the
    // perpendicular can be found from x and then walked in.
    let u = clamp01(px / axis.length)
    for (let k = 0; k < 3; k++) {
      const [ax, ay] = axisPoint(axis, u)
      const a = axisAngle(axis, u)
      const along = (px - ax) * Math.cos(a) + (py - ay) * Math.sin(a)
      u = clamp01(u + (along * Math.cos(a)) / axis.length)
    }
    const [ax, ay] = axisPoint(axis, u)
    const a = axisAngle(axis, u)
    const across = Math.abs(-(px - ax) * Math.sin(a) + (py - ay) * Math.cos(a))
    return across <= width(u)
  }

  /* The ceiling is the whole axis. A vein never wants that much,
     but a split leaving the base at 78° on a blade that is still
     widening genuinely travels further than twice its local
     half-width, which is the ceiling one of the private versions
     of this used and the reason its sinuses all came back shut. */
  const limit = axis.length
  const steps = 40
  let lo = 0
  let hi = limit
  let found = false
  for (let i = 1; i <= steps; i++) {
    const d = (limit * i) / steps
    if (!inside(d)) { lo = (limit * (i - 1)) / steps; hi = d; found = true; break }
  }
  // A ray that never leaves — a strap profile sampled along its
  // own length — is capped rather than left unbounded.
  if (!found) return limit
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2
    if (inside(mid)) lo = mid
    else hi = mid
  }
  return lo
}

/** The vocabulary's own spread: 78° off the midrib at the base, 32° at the tip. */
export const veinSpread = (t: number): number => (78 - t * 46) * (Math.PI / 180)

/* ------------------------------------------------------------
   VEINS
   ------------------------------------------------------------ */

export interface VeinSpec {
  axis: AxisSpec
  width: WidthProfile
  /** Pairs of secondaries. Six to nine reads as a leaf; three reads as a logo. */
  pairs: number
  /** Where the first pair leaves the midrib, 0..1. */
  from?: number
  /** Where the last pair leaves it. */
  to?: number
  /**
   * How far toward the margin a vein reaches, as a fraction of
   * the distance the margin actually is in the direction the vein
   * leaves in. Never 1 — a secondary that lands exactly on the
   * margin pokes through it wherever the jitter has pulled the
   * margin in, and real secondaries arch and fade before they get
   * there.
   */
  reach?: number
  asymmetry?: number
}

/**
 * Secondaries, ordered base → tip. Each springs from the midrib
 * and sweeps toward the tip, and the angle closes as it goes:
 * a vein near the base leaves almost square, one near the tip
 * leaves almost parallel. Getting that progression wrong is the
 * single clearest tell of a drawn-from-memory leaf.
 *
 * The length is measured against `marginReach` and never against
 * the local half-width, so a vein terminates inside the blade it
 * belongs to whatever that blade is doing around it.
 */
export function secondaryPaths(spec: VeinSpec, r: () => number): string[] {
  const { axis, width, pairs, from = 0.12, to = 0.88, reach = 0.84, asymmetry = 1 } = spec
  const out: string[] = []
  for (let i = 0; i < pairs; i++) {
    const t = from + (i / Math.max(1, pairs - 1)) * (to - from)
    const [x, y] = axisPoint(axis, t)
    const a = axisAngle(axis, t)
    const spread = veinSpread(t)
    for (const side of [1, -1] as const) {
      const ang = a + side * spread
      const len =
        marginReach(axis, width, t, ang) * reach * (0.94 + r() * 0.12) *
        (side > 0 ? asymmetry : 1)
      const tip: Pt = [x + Math.cos(ang) * len, y + Math.sin(ang) * len]
      // The control point is swept toward the leaf tip, which is
      // what makes the vein arch instead of radiating.
      const ctrlAng = a + side * spread * 0.55
      const c: Pt = [x + Math.cos(ctrlAng) * len * 0.62, y + Math.sin(ctrlAng) * len * 0.62]
      out.push(`M${n(x)} ${n(y)}Q${n(c[0])} ${n(c[1])} ${n(tip[0])} ${n(tip[1])}`)
    }
  }
  return out
}

/**
 * Tertiaries: short cross-links between neighbouring secondaries,
 * at the scale you only see up close. They are the reason a front
 * band leaf survives being looked at.
 *
 * Their two ends are fractions of the SAME margin reach the
 * secondaries are laid against — a rung is a chord between two
 * veins, so a rung measured against anything else is a rung that
 * misses both of them and finishes outside the blade.
 */
export function tertiaryPaths(spec: VeinSpec, r: () => number): string[] {
  const { axis, width, pairs, from = 0.12, to = 0.88, reach = 0.84 } = spec
  const out: string[] = []
  for (let i = 0; i < pairs - 1; i++) {
    const t0 = from + (i / Math.max(1, pairs - 1)) * (to - from)
    const t1 = from + ((i + 1) / Math.max(1, pairs - 1)) * (to - from)
    const rungs = 2 + Math.floor(r() * 2)
    for (let j = 1; j <= rungs; j++) {
      const f = j / (rungs + 1)
      for (const side of [1, -1] as const) {
        const ta = t0 + (t1 - t0) * f * 0.2
        const [xa, ya] = axisPoint(axis, ta)
        const aa = axisAngle(axis, ta)
        const angA = aa + side * veinSpread(ta)
        const la = marginReach(axis, width, ta, angA) * reach * (0.34 + f * 0.48)
        const pa: Pt = [xa + Math.cos(angA) * la, ya + Math.sin(angA) * la]

        const tb = t1 - (t1 - t0) * (1 - f) * 0.2
        const [xb, yb] = axisPoint(axis, tb)
        const ab = axisAngle(axis, tb)
        const angB = ab + side * veinSpread(tb)
        const lb = marginReach(axis, width, tb, angB) * reach * (0.27 + f * 0.41)
        const pb: Pt = [xb + Math.cos(angB) * lb, yb + Math.sin(angB) * lb]

        out.push(`M${n(pa[0])} ${n(pa[1])}L${n(pb[0])} ${n(pb[1])}`)
      }
    }
  }
  return out
}

/* ------------------------------------------------------------
   DAMAGE AND HOLES
   ------------------------------------------------------------ */

export interface TearSpec {
  axis: AxisSpec
  width: WidthProfile
  /** Position along the axis, 0..1. */
  at: number
  side: 1 | -1
  /** How far in toward the midrib, 0..1. Never 1 — a tear stops AT the midrib. */
  depth: number
  /** Opening width along the margin, in local units. */
  mouth: number
}

/**
 * A wind tear: cut back toward the midrib and stopping at it.
 * Subtracted from the blade through a mask, so the margin left
 * behind is the torn edge rather than a drawn line.
 */
export function tearPath(spec: TearSpec, r: () => number): string {
  const { axis, width, at, side, depth, mouth } = spec
  const [x, y] = axisPoint(axis, at)
  const a = axisAngle(axis, at)
  const nx = -Math.sin(a) * side, ny = Math.cos(a) * side
  const w = width(at)
  const inner = w * (1 - Math.min(0.92, depth))
  const half = mouth / 2

  // Two ragged lips meeting at a point. A tear that is a clean
  // triangle reads as a notch someone cut on purpose.
  const lipA: Pt = [x + Math.cos(a) * -half + nx * w, y + Math.sin(a) * -half + ny * w]
  const lipB: Pt = [x + Math.cos(a) * half + nx * w, y + Math.sin(a) * half + ny * w]
  const floor: Pt = [x + nx * inner, y + ny * inner]
  const wobbleA: Pt = [
    lipA[0] + (floor[0] - lipA[0]) * 0.55 + (r() - 0.5) * mouth * 0.4,
    lipA[1] + (floor[1] - lipA[1]) * 0.55 + (r() - 0.5) * mouth * 0.4,
  ]
  const wobbleB: Pt = [
    lipB[0] + (floor[0] - lipB[0]) * 0.5 + (r() - 0.5) * mouth * 0.4,
    lipB[1] + (floor[1] - lipB[1]) * 0.5 + (r() - 0.5) * mouth * 0.4,
  ]
  return smooth([lipA, wobbleA, floor, wobbleB, lipB], true)
}

export interface FenestrationSpec {
  axis: AxisSpec
  width: WidthProfile
  at: number
  side: 1 | -1
  /** Fraction of the half-width the hole spans. */
  span: number
  /** Extent along the midrib, in local units. */
  run: number
  /** True if the hole has opened all the way to the margin. */
  split?: boolean
}

/**
 * A monstera hole.
 *
 * THE THING THAT IS EASY TO GET WRONG. A fenestration is not a
 * blob sitting on the blade. It is a SLOT that runs outward from
 * near the midrib toward the margin, lying in the channel between
 * two secondaries — so its long axis is roughly perpendicular to
 * the spine, not parallel to it. Drawn the other way round it
 * reads as damage, and a leaf covered in damage reads as chewed.
 *
 * It is pointed at the inner end, where the blade is still
 * closing, and wider and torn at the outer end, where it is still
 * opening. One hole per leaf has usually reached the margin and
 * become a split; a leaf where every hole is closed looks
 * printed.
 */
export function fenestrationPath(spec: FenestrationSpec, r: () => number): string {
  const { axis, width, at, side, span, run, split = false } = spec
  const [x, y] = axisPoint(axis, at)
  const a = axisAngle(axis, at)
  const w = width(at)

  // The slot leans toward the tip with the secondary it sits
  // between, so it never crosses a vein it should be parallel to.
  const lean = veinSpread(at)
  const ang = a + side * lean
  const ux = Math.cos(ang), uy = Math.sin(ang)          // outward, along the slot
  const px = -Math.sin(ang), py = Math.cos(ang)          // across it

  /* THE DISTANCE THAT MATTERS IS ALONG THE SLOT, NOT ACROSS THE
     BLADE. `split: true` means "this one has opened all the way
     out", and for a long time it asked for 1.14 half-widths and
     got a closed hole: only sin(lean) of that length is spent
     crossing the blade, and the rest is spent travelling toward
     the tip — so on the basal half, where the blade is still
     widening, the margin the slot eventually has to cross is
     further out than the margin it set off from. Asking the real
     margin how far away it is in the direction the slot actually
     runs settles both effects at once. */
  const reach = marginReach(axis, width, at, ang)
  const inner = w * 0.3
  // A closed fenestration stops short of the margin, with tissue
  // still bridging it; a split goes through and keeps going, so
  // the mask has something to subtract beyond the outline.
  const outer = split ? reach * 1.14 : inner + (reach - inner) * (0.42 + span * 0.45)

  const halfAt = (f: number) => {
    // Nearly closed at the inner end, widest two-thirds out.
    const bell = Math.pow(Math.sin(Math.pow(f, 0.7) * Math.PI), 0.55)
    return (run / 2) * (0.12 + 0.88 * bell)
  }

  const steps = 8
  const sideA: Pt[] = []
  const sideB: Pt[] = []
  for (let i = 0; i <= steps; i++) {
    const f = i / steps
    const d = inner + (outer - inner) * f
    const h = halfAt(f)
    // Torn rather than radiused: the margin of a hole is ragged at
    // the scale of a few units, and that roughness grows outward
    // where the tissue is thinnest.
    const j = (r() - 0.5) * run * 0.16 * f
    sideA.push([x + ux * d + px * (h + j), y + uy * d + py * (h + j)])
    sideB.push([x + ux * d - px * (h - j), y + uy * d - py * (h - j)])
  }
  return smooth([...sideA, ...sideB.reverse()], true)
}

/* ------------------------------------------------------------
   PINNATE FRONDS — palm
   ------------------------------------------------------------ */

export interface LeafletSpec {
  /** The rachis. Drawn first so a dash reveal runs down the spine. */
  axis: AxisSpec
  pairs: number
  from?: number
  to?: number
  /** Longest leaflet, at the widest point of the frond. */
  length: number
  /** Half-width of one leaflet at its base. */
  thickness: number
  /** Indices whose leaflet is torn short. Damage belongs to a few, not all. */
  torn?: readonly number[]
}

/**
 * Palm leaflets, ordered base → tip along the rachis. Each is a
 * narrow blade in its own right, so they carry a midrib of their
 * own at the front band. Length peaks around two-fifths along and
 * falls away at both ends; spacing is deliberately uneven,
 * because evenly spaced leaflets are the thing that makes a palm
 * read as a feather icon.
 *
 * THE ATTACHMENT, WHICH IS WHY THIS NO LONGER USES `smooth`.
 *
 * A leaflet used to be five points closed by a Catmull-Rom:
 * `edgeA → belly → tip → backA → edgeB`, four long segments out
 * to the tip and back, and then a closing chord from `edgeB` round
 * to `edgeA` barely two thicknesses long. A closed Catmull-Rom
 * takes its tangent at a point from the points either SIDE of it,
 * so at `edgeB` the tangent is set by `backA`, which is halfway to
 * the tip — and the curve leaving for `edgeA` shoots off at a
 * length scaled to that, right past the base it was meant to close
 * across. The overshoot goes round. Every leaflet base came out as
 * a small RING sitting on the rachis, and at the front band, where
 * the margin is stroked as well as filled, a palm crown was strung
 * with what looked like the links of a chain.
 *
 * A heel point behind the attachment was the first answer and it
 * is not enough: a sixth point in the same closed spline is still
 * a short segment between two long ones, and the ring merely
 * became a bow tie. No arrangement of sample points fixes this,
 * because the fault is in the interpolation and not in the
 * samples.
 *
 * So the outline is written as three explicit quadratics instead —
 * out along the belly to the tip, back down the other margin
 * through `backA`, and across the base through a heel — with each
 * control point placed so the curve passes exactly THROUGH the
 * point the old sampling passed through. The silhouette is the one
 * already judged; the base is now the narrow attachment a pinna
 * actually has.
 */
export function leafletPaths(spec: LeafletSpec, r: () => number): { blade: string; rib: string }[] {
  const { axis, pairs, from = 0.08, to = 0.97, length, thickness, torn = [] } = spec
  const out: { blade: string; rib: string }[] = []
  let acc = 0
  const gaps: number[] = []
  for (let i = 0; i < pairs; i++) { const g = 0.72 + r() * 0.56; gaps.push(g); acc += g }

  let walked = 0
  for (let i = 0; i < pairs; i++) {
    walked += gaps[i]
    const t = from + (walked / acc) * (to - from)
    const [x, y] = axisPoint(axis, t)
    const a = axisAngle(axis, t)
    // Leaflets sweep back toward the base near the rachis end.
    const spread = (72 - t * 34) * (Math.PI / 180)
    const bell = Math.sin(Math.pow(t, 0.8) * Math.PI)
    for (const side of [1, -1] as const) {
      const isTorn = torn.includes(i * 2 + (side > 0 ? 0 : 1))
      const len = length * (0.46 + bell * 0.54) * (0.9 + r() * 0.2) * (isTorn ? 0.58 : 1)
      const ang = a + side * spread
      const tipDroop = side * (0.1 + r() * 0.12)
      const ux = Math.cos(ang), uy = Math.sin(ang)
      const tip: Pt = [x + ux * len, y + uy * len + tipDroop * len * 0.2]
      const c1: Pt = [x + Math.cos(ang - side * 0.16) * len * 0.5, y + Math.sin(ang - side * 0.16) * len * 0.5]
      const th = thickness * (0.7 + bell * 0.5)
      const pnx = -Math.sin(ang), pny = Math.cos(ang)
      const edgeA: Pt = [x + pnx * th, y + pny * th]
      const edgeB: Pt = [x - pnx * th, y - pny * th]
      const belly: Pt = [c1[0] + pnx * th * 0.72, c1[1] + pny * th * 0.72]
      const backA: Pt = [c1[0] - pnx * th * 0.55, c1[1] - pny * th * 0.55]
      const heel: Pt = [x - ux * th * 0.3, y - uy * th * 0.3]
      /* A quadratic passes through a given midpoint when its
         control is `2m - (p0 + p1) / 2`, so each of these three
         arcs still runs through the sample the old spline ran
         through — and through nothing else. */
      const via = (p0: Pt, m: Pt, p1: Pt): Pt => [
        2 * m[0] - (p0[0] + p1[0]) / 2,
        2 * m[1] - (p0[1] + p1[1]) / 2,
      ]
      const q = (c: Pt, p: Pt) => `Q${n(c[0])} ${n(c[1])} ${n(p[0])} ${n(p[1])}`
      out.push({
        blade:
          `M${n(edgeA[0])} ${n(edgeA[1])}` +
          q(via(edgeA, belly, tip), tip) +
          q(via(tip, backA, edgeB), edgeB) +
          q(via(edgeB, heel, edgeA), edgeA) +
          'Z',
        rib: `M${n(x)} ${n(y)}Q${n(c1[0])} ${n(c1[1])} ${n(tip[0])} ${n(tip[1])}`,
      })
    }
  }
  return out
}

/* ------------------------------------------------------------
   VINES
   ------------------------------------------------------------ */

export interface VineSpec {
  /** Waypoints the stem must pass through, in the host's own frame. */
  through: Pt[]
  /** Lateral wander between waypoints, in local units. */
  wander?: number
  /** How many leaves to hang off it. */
  leaves: number
  /** Internodes shorten toward the tip, so growth reads as recent. */
  taper?: number
}

export interface VineNode {
  at: Pt
  /** Outward normal of the stem — which way the leaf faces. */
  angle: number
  /** Alternating sides, as real vines alternate. */
  side: 1 | -1
  /** 0..1 along the stem, so a leaf can unfurl after the stem reaches it. */
  t: number
  /** Blade scale — smaller toward the growing tip. */
  scale: number
}

/**
 * A stem through given waypoints plus the nodes to hang leaves
 * on. The waypoints are the point of this: on the toolbox wall
 * the vine has to travel the grid's real gutters, which are only
 * known once the tile field has been measured, so geometry that
 * cannot take a measured path is no use there.
 */
export function vinePath(spec: VineSpec, r: () => number): { stem: string; nodes: VineNode[] } {
  const { through, wander = 0, leaves, taper = 0.55 } = spec
  if (through.length < 2) return { stem: '', nodes: [] }

  const pts: Pt[] = [through[0]]
  for (let i = 0; i < through.length - 1; i++) {
    const a = through[i], b = through[i + 1]
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len, ny = dx / len
    const mid = 0.35 + r() * 0.3
    const off = (r() - 0.5) * 2 * wander
    pts.push([a[0] + dx * mid + nx * off, a[1] + dy * mid + ny * off])
    pts.push(b)
  }
  const stem = smooth(pts)

  // Walk the polyline to place nodes by arc length rather than by
  // index, so leaves are evenly spread over a path whose segments
  // are not.
  const seg: number[] = []
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
    seg.push(d); total += d
  }

  const nodes: VineNode[] = []
  for (let i = 0; i < leaves; i++) {
    // Internodes shorten toward the tip.
    const f = Math.pow((i + 0.6) / leaves, 1 - taper * 0.45)
    let want = f * total * 0.96
    let idx = 0
    while (idx < seg.length - 1 && want > seg[idx]) { want -= seg[idx]; idx++ }
    const u = seg[idx] ? want / seg[idx] : 0
    const a = pts[idx], b = pts[idx + 1] ?? pts[idx]
    const at: Pt = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0])
    const side: 1 | -1 = i % 2 === 0 ? 1 : -1
    nodes.push({
      at: [n(at[0]), n(at[1])],
      angle: ang + side * (1.1 + r() * 0.45),
      side,
      t: f,
      scale: (1 - f * taper) * (0.85 + r() * 0.3),
    })
  }
  return { stem, nodes }
}

/* ------------------------------------------------------------
   PLACEMENT
   ------------------------------------------------------------ */

export interface Placement {
  /** Stable name — the debug overlay and the audit both use it. */
  name: string
  kind: CanopyKind
  band: Band
  /** Anchor in viewport fractions, 0..1. Never pixels. */
  x: number
  y: number
  /** Local units per viewport-min unit, so a blade scales with the page. */
  scale: number
  /** Degrees. The petiole base is the pivot. */
  rotate: number
  flip?: boolean
  seed: number
  /** Global natureProgress at which this begins to grow. */
  t0: number
  /** How much progress it takes to finish growing. */
  ramp: number
  /** Dropped below this viewport width. */
  minWidth?: number
  /** How strongly it answers wind, scroll velocity and the pointer. */
  sway?: number
  parallax?: number
}

/** The transform a placement resolves to, given a viewport. */
export function placementTransform(p: Placement, w: number, h: number): string {
  const unit = Math.min(w, h) / 100
  const s = p.scale * unit * (p.flip ? -1 : 1)
  return `translate(${n(p.x * w)} ${n(p.y * h)}) rotate(${n(p.rotate)}) scale(${n(s)} ${n(p.scale * unit)})`
}

/**
 * Growth for one placement at a given natureProgress. Reversible
 * by construction — scrolling back up ungrows a plant, because
 * this is a pure function of progress and never an accumulator.
 */
export function growthAt(p: Placement, progress: number): number {
  if (p.ramp <= 0) return progress >= p.t0 ? 1 : 0
  const v = (progress - p.t0) / p.ramp
  return v <= 0 ? 0 : v >= 1 ? 1 : v
}

/* ------------------------------------------------------------
   PAINT
   ------------------------------------------------------------ */

export interface BandPaint {
  fill: string
  vein: string
  vein2: string
  edge: string
  stem: string
  /** Stroke width multiplier — far plants carry thinner line work. */
  hair: number
}

/**
 * Which ink a band paints in. Centralised here rather than in a
 * stylesheet so a family component needs no CSS of its own: it
 * reads these straight into `fill` and `stroke` attributes, and
 * the tokens behind them stay the single source of truth.
 *
 * Fills mix toward the PAGE rather than toward transparency. Two
 * overlapping translucent leaves accumulate into a grey that
 * belongs to neither; two opaque ones stay the colour they were
 * mixed to be, which is what keeps a dense canopy from silting up.
 */
export function bandPaint(band: Band): BandPaint {
  switch (band) {
    case 'shadow':
      return { fill: 'var(--leaf-shadow)', vein: 'none', vein2: 'none', edge: 'none', stem: 'none', hair: 0 }
    case 'back':
      return { fill: 'var(--leaf-far)', vein: 'var(--leaf-vein-2)', vein2: 'none', edge: 'none', stem: 'var(--leaf-vein-2)', hair: 0.8 }
    case 'mid':
      return { fill: 'var(--leaf-mid)', vein: 'var(--leaf-vein)', vein2: 'var(--leaf-vein-2)', edge: 'none', stem: 'var(--leaf-stem)', hair: 1 }
    case 'front':
      return { fill: 'var(--leaf-front)', vein: 'var(--leaf-vein)', vein2: 'var(--leaf-vein-2)', edge: 'var(--leaf-edge)', stem: 'var(--leaf-stem)', hair: 1.15 }
    case 'close':
      return { fill: 'var(--leaf-close)', vein: 'none', vein2: 'none', edge: 'var(--leaf-edge)', stem: 'var(--leaf-stem)', hair: 1.3 }
  }
}

/**
 * Stable, collision-proof id for a mask, clip or gradient. SVG
 * ids are document-global — two monstera instances sharing a mask
 * id means the second one silently wears the first one's holes.
 */
export function defId(name: string, seed: number, part: string): string {
  return `n-${name}-${seed.toString(36)}-${part}`
}

/* ------------------------------------------------------------
   ONE GRADIENT PER BAND, FOR THE WHOLE BAND

   Every family used to declare its own `<linearGradient>` with
   its own seeded id, so twenty-six large plants meant twenty-six
   gradient definitions on a page whose budget (§6.3) is eight at
   the top tier and three at medium. Each of those definitions
   also had to carry `gradientUnits="userSpaceOnUse"` with
   endpoints measured along its own midrib, which is a more
   precise answer to a question nobody was asking: the endpoints
   are a fraction of a degree apart from the bounding box's own
   long axis, because every blade in this vocabulary runs from a
   petiole at the origin out along +X.

   So the stops are declared once per BAND, in object-bounding-box
   units, and every blade in that band references them. A unit
   square resolves against the referencing element's own box, so
   one definition fits a leaf of any size — which is exactly the
   property §6.3 asks for and the reason it names those units.

   The band is the right key because the band is where the depth
   model lives: each one keeps its OWN fill as the base stop, and
   lifts toward the light at the tip. Giving every band the same
   pair would make a mid blade and a front blade the same colour,
   and the whole sense of depth is carried by that difference.
   ------------------------------------------------------------ */

export const BAND_GRADIENT: Record<Band, [string, string]> = {
  shadow: ['var(--leaf-shadow)', 'var(--leaf-shadow)'],
  back: ['var(--leaf-far)', 'var(--leaf-far)'],
  mid: ['var(--leaf-mid)', 'var(--leaf-grad-a)'],
  front: ['var(--leaf-front)', 'var(--leaf-grad-a)'],
  close: ['var(--leaf-close)', 'var(--leaf-grad-b)'],
}

/** The one gradient id a band's plants all point at. */
export function gradientId(band: Band): string {
  return `n-grad-${band}`
}

/**
 * What a blade in this band paints its surface with.
 *
 * The flat band fill is written after the reference as the
 * FALLBACK half of `fill: <url> <colour>`. That is not belt and
 * braces — it is what makes a shared definition safe to depend
 * on. The `<defs>` block lives at the head of the band's own
 * surface, which is composed somewhere else entirely; a surface
 * that has not mounted it yet resolves a missing paint server to
 * nothing at all and the leaf disappears. With the fallback the
 * worst case is a flat leaf, which is what the back and shadow
 * bands are anyway.
 */
export function bandFill(band: Band): string {
  return `url(#${gradientId(band)}) ${bandPaint(band).fill}`
}

/* ------------------------------------------------------------
   ONE DEFINITION, HOWEVER MANY SURFACES ASK FOR IT

   A gradient is referenced by id, and an id belongs to the
   DOCUMENT rather than to the SVG that happens to carry it. So
   two surfaces that both paint `mid` blades — the nature layer's
   band and the gateway's threshold, composed in different corners
   of the tree, neither able to see the other — each mounted the
   identical block and left `n-grad-mid` defined twice on the
   page. Nothing looked wrong, because both blocks are generated
   from the same tokens; it was invalid markup with a trap inside
   it, waiting for the day the two sets of stops stopped agreeing.

   Deduplicating by BAND rather than by host is only saying out
   loud what the paint model already assumes: the stops belong to
   the band, every blade in that band points at them, and which
   surface carries the block is an accident of composition. The
   first surface to ask for a band paints it; the rest reference
   it. Ownership MOVES rather than lapsing — a host that unmounts
   hands the band to whoever is left — and that is the property
   that lets the threshold be the only vegetation on a route and
   still get its gradients rather than a flat fallback.

   The claim is taken in a layout effect, before paint, so a
   duplicate never reaches a frame; and the first render READS the
   register rather than writing to it, so a surface mounting into
   a page that already has the band never renders the block at
   all. On the server nothing claims and every surface renders it,
   which is correct — a server render is one document with one
   surface in it — and the first client render agrees, which is
   what hydration needs.
   ------------------------------------------------------------ */

/** Who has asked for each band, in the order they asked. */
const claimed = new Map<Band, object[]>()
/** Every mounted block, so ownership can be handed on. */
const listeners = new Set<() => void>()

function owns(band: Band, token: object): boolean {
  const held = claimed.get(band)
  return held === undefined || held.length === 0 || held[0] === token
}

function claim(band: Band, token: object): () => void {
  const held = claimed.get(band) ?? []
  held.push(token)
  claimed.set(band, held)
  for (const listener of listeners) listener()
  return () => {
    const i = held.indexOf(token)
    if (i >= 0) held.splice(i, 1)
    for (const listener of listeners) listener()
  }
}

/** Before paint in a browser; not called at all on the server. */
const useClaim = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * The shared block, mounted once at the head of a band's surface —
 * or, when some other surface already carries that band, not
 * mounted at all and simply depended on.
 *
 * Written with `createElement` rather than as JSX because this
 * module is the vocabulary and is imported by node proof scripts
 * that have no JSX pipeline; five element calls is a small price
 * for keeping the geometry and the paint it is drawn with in the
 * same file.
 */
export function CanopyDefs({ band }: { band: Band }): ReactElement | null {
  /* An identity for this mount and nothing else. State rather than
     a ref because the register is read during the first render, and
     the thing doing the reading has to already exist. */
  const [token] = useState<object>(() => ({}))
  const [mine, setMine] = useState(() => owns(band, token))

  useClaim(() => {
    const settle = () => setMine(owns(band, token))
    listeners.add(settle)
    const release = claim(band, token)
    return () => {
      listeners.delete(settle)
      release()
    }
  }, [band, token])

  const [base, lit] = BAND_GRADIENT[band]
  if (!mine) return null
  return createElement(
    'defs',
    null,
    createElement(
      'linearGradient',
      {
        id: gradientId(band),
        gradientUnits: 'objectBoundingBox',
        x1: '0', y1: '0.5', x2: '1', y2: '0.5',
      },
      createElement('stop', { offset: '0', stopColor: base }),
      createElement('stop', { offset: '1', stopColor: lit }),
    ),
  )
}

/**
 * What every family component takes. Deliberately tiny: a plant
 * is STATIC markup, and everything that moves arrives through the
 * inherited custom properties in canopy.module.css. A family that
 * takes `grow` as a prop would re-render React sixty times a
 * second, which is the one thing this architecture forbids.
 */
export interface PlantProps {
  /** Drives every random choice. The same seed is the same plant, forever. */
  seed: number
  band: Band
  /** Family-specific silhouette selector, for when one family needs two shapes. */
  variant?: number
  /** Overall size in local units along the midrib. */
  length?: number
  className?: string
}
