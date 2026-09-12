import * as THREE from 'three'
import { ROOM_CONFIG } from '../config'
import type { RoomPlan } from '../scene/compositions'
import { catmull, clamp, lerp, random, TAU, type Rng } from '../lib/random'
import type { WallRelief } from './relief'

/* ============================================================
   BOTANY
   The prototype's `buildBotany`, moved off the screen and onto
   the stone. Its structure is kept exactly:

   · a main stem is a Catmull–Rom curve through a handful of knots
     with a START and a DURATION on the growth timeline; its tip
     travels along the curve as growth advances;
   · leaves sit at stations along the stem, alternating sides, at
     the prototype's angles and size spread, each with its own
     BIRTH (when the tip passes its node) and UNFURL time;
   · branches leave the main stem at evenly spaced nodes, start
     only once the main stem has reached them, and carry their own
     leaves;
   · a reproducible order and seeded randomness throughout.

   What is new is where the knots come from. They are not screen
   fractions but metres on the hall: stems climb the re-entrant
   corners beside the pilasters, wrap the shafts, run along the
   frieze under the cornice and creep along the skirting — the
   places ivy really finds purchase — and every knot is laid onto
   the wall's relief, so a stem follows the stone it grows on.

   The plan is independent of the viewport and of the copy. The
   reading field only ever prunes it (see `prune`).
   ============================================================ */

export interface Stem {
  /** Centreline in world space, lifted off the stone by its radius. */
  points: THREE.Vector3[]
  /** Surface normal at each point. */
  normals: THREE.Vector3[]
  /** Cumulative arc length fraction (0..1) of each point. */
  s: number[]
  start: number
  duration: number
  radius: number
  main: boolean
  /** Index of the parent stem, or -1. */
  parent: number
  /** Arc fraction along the parent where this branch leaves it. */
  at: number
  /** -1 for the story's own ivy; 0..1 for the takeover's (see
      `wildSpecs`): the order it comes in, from the frame inward. */
  wild: number
}

export interface Leaf {
  /** Attachment point on the stem, world space. */
  position: THREE.Vector3
  /** Surface normal at the attachment. */
  normal: THREE.Vector3
  /** In-plane growth direction (unit, tangent to the surface). */
  direction: THREE.Vector3
  size: number
  aspect: number
  sprite: number
  birth: number
  unfurl: number
  lift: number
  roll: number
  phase: number
  sway: number
  stem: number
  /** Arc fraction along its stem. */
  s: number
  shade: number
  /** Height of the attachment above the stone, metres. */
  anchor: number
}

export interface Botany {
  stems: Stem[]
  leaves: Leaf[]
}

interface Spec {
  knots: Array<[number, number]>
  start: number
  duration: number
  strength: number
  wild?: number
}

/**
 * Guides along the hall's architecture, in wall metres (x, y).
 *
 * Deliberately more than the room will keep: candidates are laid
 * wherever ivy could plausibly take hold — every re-entrant corner,
 * every shaft, the whole run of the frieze, the skirting — and the
 * reading field then decides which of them a given layout can
 * afford. The candidates themselves never depend on the layout.
 */
function specs(plan: RoomPlan, relief: WallRelief, r: Rng): Spec[] {
  const out: Spec[] = []
  const S = relief.soffit
  const W = plan.width
  const bay = plan.bay
  const pw = plan.pilasters[0]?.width ?? 0.5
  const hw = pw / 2
  const wob = (a: number) => (r() - 0.5) * a

  /** Up from the stone's foot (a plinth top, a joint) to `top`. */
  const ascend = (x: number, top: number, start: number, strength: number, from = 0.05, meander = 0.07) => {
    const knots: Array<[number, number]> = [[x + wob(0.04), from]]
    const n = Math.max(3, Math.round((top - from) / 0.7))
    for (let i = 1; i <= n; i++) knots.push([x + wob(meander * 2), from + ((top - from) * i) / n])
    out.push({ knots, start, duration: 0.42 + (top - from) * 0.035, strength })
  }
  /** Down from the frieze: ivy that has crossed the cornice and now
      hangs, holding to the face below as it goes. */
  const descend = (x: number, bottom: number, start: number, strength: number, meander = 0.08) => {
    const knots: Array<[number, number]> = [[x + wob(0.06), S + 0.14], [x + wob(0.05), S - 0.05]]
    const n = Math.max(2, Math.round((S - bottom) / 0.7))
    for (let i = 1; i <= n; i++) knots.push([x + wob(meander * 2), S - 0.05 - ((S - 0.05 - bottom) * i) / n])
    out.push({ knots, start, duration: 0.3 + (S - bottom) * 0.03, strength })
  }

  // Where the frame's edge falls at the class's typical shape (the
  // lens pins the plinths' inner edge 3% in from the side).
  const edge = (bay - hw - 0.08) / 0.94
  for (const side of [-1, 1]) {
    const px = side * bay
    const outer = px + side * (hw + 0.09)
    const inner = px - side * (hw + 0.09)
    // Vertical guides: the pilaster's two re-entrant corners, its
    // shaft, the stretch of side bay just past it (the frame's edge
    // on most screens), further out, and the hall's corner.
    const guides = [
      { x: outer, a: 1.25, d: 0.9 },
      // Across the pilaster's face: on most screens only its inner part
      // is in frame, and this is the ivy that frames the page.
      { x: px - side * (hw - 0.06), a: 1.1, d: 0.85 },
      { x: px - side * (hw - 0.17), a: 1.15, d: 0.85 },
      // At the frame's edge itself, and just past it: ivy entering the
      // picture from outside, as foliage does at a photograph's edge.
      { x: side * (edge - 0.015), a: 1.05, d: 0.8 },
      { x: side * (edge + 0.07), a: 1.1, d: 0.8 },
      { x: inner, a: 1.0, d: 0.85 },
      { x: px + side * 0.05, a: 0.8, d: 0.8 },
      // Out past the pilaster, the stretch of side bay at the frame's
      // edge: ivy entering the picture from outside.
      { x: side * (bay + hw + 0.35), a: 1.15, d: 0.9 },
      { x: side * (bay + hw + 0.8), a: 1.05, d: 0.8 },
      { x: side * (W / 2 - 0.08), a: 1.1, d: 0.0 },
    ]
    guides.forEach((g, gi) => {
      // Climbers start from the plinth or skirting top: rooted in the
      // soil that has gathered on the ledge. The ones on and beyond the
      // pilaster were there before the story starts (a negative start:
      // already half grown at G = 0) — the hall has been empty a while.
      const established = gi <= 2 || gi >= 4
      const start = established ? -0.32 - r() * 0.12 : 0.04 + gi * 0.03 + r() * 0.06
      ascend(g.x, S - 0.25 - r() * 0.6, start, g.a, gi < 3 ? 0.34 : 0.28)
      if (g.d > 0) descend(g.x + wob(0.1), 0.4 + r() * 1.6, 0.38 + r() * 0.34, g.d)
    })
    // Up the face of the shaft, crossing its arrises.
    out.push({
      knots: [
        [px - side * 0.05, 0.34], [px + side * 0.2, 1.0], [px - side * 0.22, 1.8],
        [px + side * 0.18, 2.6], [px - side * 0.12, 3.4], [px + side * 0.05, S - 0.2],
      ],
      start: 0.18 + r() * 0.08,
      duration: 0.55,
      strength: 0.8,
    })
    // Along the skirting, from the plinth both ways.
    for (const dir of [-1, 1]) {
      const x0 = px + dir * (hw + 0.12)
      out.push({
        knots: [[x0, 0.12], [x0 + dir * 0.6, 0.22 + wob(0.05)], [x0 + dir * 1.3, 0.14], [x0 + dir * 2.0, 0.24 + wob(0.06)]],
        start: 0.3 + r() * 0.15,
        duration: 0.4,
        strength: 0.75,
      })
    }
  }

  // The frieze, end to end. Runs are rooted above each capital (the
  // climbers' way over the cornice) and all along the frieze, early
  // near the pilasters and later towards the middle, so the garland
  // closes across the top of the hall as the story goes on. Pendants
  // fall from it later still, onto the wall below.
  const span = W / 2 - 0.3
  for (let x = -span; x <= span; x += 0.8) {
    const dir = x < 0 ? (r() < 0.75 ? 1 : -1) : r() < 0.75 ? -1 : 1
    const fromPil = Math.min(Math.abs(Math.abs(x) - bay) / bay, 1)
    // Ivy comes over the cornice first in the middle of the hall,
    // above where the name stands but clear of it, and spreads out
    // along the frieze; its pendants come later, and the long ones
    // only once the name has scrolled away.
    const start = 0.02 + (1 - fromPil) * 0.3 + r() * 0.08
    const len = 1.1 + r() * 1.3
    out.push({
      knots: [[x, S + 0.16 + wob(0.06)], [x + dir * len * 0.35, S + 0.1 + wob(0.05)], [x + dir * len * 0.7, S + 0.2 + wob(0.05)], [x + dir * len, S + 0.13]],
      start,
      duration: 0.3,
      strength: 0.9,
    })
    for (let k = 0; k < 3; k++) {
      if (r() < 0.3) continue
      const hx = x + dir * len * (0.2 + r() * 0.7)
      const drop = k === 0 ? 0.18 + r() * 0.3 : 0.3 + r() * (0.5 + k * 0.5)
      out.push({
        knots: [[hx, S + 0.08], [hx + wob(0.12), S - drop * 0.45], [hx + wob(0.2), S - drop]],
        start: start + 0.08 + (k === 0 ? 0 : 0.18 + k * 0.12) + r() * 0.08,
        duration: 0.2,
        strength: 0.5 + r() * 0.2,
      })
    }
  }
  return out
}

/**
 * The takeover's ivy. When the visitor pushes past the end of the
 * story (the portal), there is no copy left to keep clear, and the
 * central bay — empty all the way through — is taken too: climbers
 * up from the skirting, long pendants down from the frieze, runners
 * in from the pilasters. None of it ever grows with the story (the
 * reading field prunes it to nothing); the takeover alone admits it,
 * in the order `wild` gives, from the frame inward.
 */
function wildSpecs(plan: RoomPlan, relief: WallRelief, r: Rng): Spec[] {
  const out: Spec[] = []
  const S = relief.soffit
  const inner = plan.bay - (plan.pilasters[0]?.width ?? 0.5) / 2 - 0.08
  const wob = (a: number) => (r() - 0.5) * a
  // 0 at the frame's edge, 1 in the middle, with some scatter.
  const order = (x: number, bias = 0) => clamp((1 - Math.abs(x) / inner) * 0.82 + r() * 0.12 + bias)
  // Up from the skirting, wandering more than the guided climbers.
  for (let x = -inner + 0.3 + r() * 0.3; x <= inner - 0.3; x += 0.7 + r() * 0.35) {
    const top = 1.3 + r() * (S - 1.7)
    const knots: Array<[number, number]> = [[x, 0.26]]
    const n = Math.max(3, Math.round(top / 0.6))
    let cx = x
    for (let i = 1; i <= n; i++) {
      cx += wob(0.5)
      knots.push([cx, 0.26 + ((top - 0.26) * i) / n])
    }
    out.push({ knots, start: -0.6, duration: 0.5, strength: 0.8 + r() * 0.35, wild: order(x, 0.04) })
  }
  // Long pendants from the frieze.
  for (let x = -inner + 0.15 + r() * 0.3; x <= inner - 0.15; x += 0.55 + r() * 0.3) {
    const drop = 0.7 + r() * S * 0.55
    const knots: Array<[number, number]> = [[x, S + 0.12], [x + wob(0.1), S - 0.05]]
    const n = Math.max(2, Math.round(drop / 0.6))
    let cx = x
    for (let i = 1; i <= n; i++) {
      cx += wob(0.3)
      knots.push([cx, S - 0.05 - (drop * i) / n])
    }
    out.push({ knots, start: -0.6, duration: 0.5, strength: 0.6 + r() * 0.3, wild: order(x) * 0.9 })
  }
  // In from each pilaster, across the plaster.
  for (const side of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const y0 = 0.7 + k * (S - 1.2) / 3 + wob(0.4)
      const len = 1.4 + r() * Math.min(2.6, inner * 0.7)
      const x0 = side * (inner - 0.04)
      const knots: Array<[number, number]> = [[x0, y0]]
      for (let i = 1; i <= 4; i++) knots.push([x0 - side * (len * i) / 4, y0 + wob(0.6) + (i * (r() - 0.45) * 0.35)])
      out.push({ knots, start: -0.6, duration: 0.5, strength: 0.75 + r() * 0.3, wild: 0.06 + k * 0.05 + r() * 0.08 })
    }
  }
  return out
}

export function buildBotany(plan: RoomPlan, relief: WallRelief, seed: number): Botany {
  const V = ROOM_CONFIG.vines
  const r = random(seed)
  // The stream the plants being grown draw on: the story's own, then
  // (for the takeover's ivy) a separate one, so adding that changed
  // nothing the story grows.
  let g: Rng = r
  const stems: Stem[] = []
  const leaves: Leaf[] = []
  const down = new THREE.Vector3(0, -1, 0)

  const addStem = (
    knots: Array<[number, number]>, start: number, duration: number, radius: number,
    leafCount: number, leafSize: number, main: boolean, parent: number, at: number, wild = -1,
  ) => {
    // Sample the curve every ≈3.5 cm: enough to follow the relief.
    let len = 0
    for (let i = 1; i < knots.length; i++) len += Math.hypot(knots[i][0] - knots[i - 1][0], knots[i][1] - knots[i - 1][1])
    const n = Math.max(10, Math.ceil(len / 0.035))
    const path: Array<{ x: number; y: number }> = []
    for (let i = 0; i <= n; i++) {
      const p = catmull(knots, i / n)
      // Nothing crosses a niche's opening without support: a stem that
      // reaches one ends at its edge.
      if (relief.hole(p.u, p.v)) break
      path.push({ x: p.u, y: p.v })
    }
    if (path.length < 3) return -1
    const points = relief.lay(path, radius + 0.0015)
    const normals = points.map((p) => relief.sample(p.x, p.y).normal)
    const s: number[] = [0]
    let acc = 0
    for (let i = 1; i < points.length; i++) {
      acc += points[i].distanceTo(points[i - 1])
      s.push(acc)
    }
    for (let i = 0; i < s.length; i++) s[i] = acc > 0 ? s[i] / acc : 0
    const index = stems.length
    stems.push({ points, normals, s, start, duration, radius, main, parent, at, wild })

    // Leaves, as the prototype placed them.
    // The anchor's height above the stone, for the leaves' shadows.
    const anchor = radius + 0.0015
    for (let i = 0; i < leafCount; i++) {
      const t = (i + 0.5 + g() * 0.4) / (leafCount + 0.3)
      const q = pointAt(stems[index], t)
      const ahead = pointAt(stems[index], Math.min(1, t + 0.012))
      const tangent = ahead.p.clone().sub(q.p)
      const nrm = q.n.clone()
      tangent.addScaledVector(nrm, -tangent.dot(nrm))
      if (tangent.lengthSq() < 1e-10) tangent.set(0, 1, 0)
      tangent.normalize()
      const side = i % 2 ? 1 : -1
      const angle = side * (0.75 + g() * 0.82)
      const dir = tangent.clone().applyAxisAngle(nrm, angle)
      // Ivy on a wall turns its blades out and lets them hang.
      const hang = down.clone().addScaledVector(nrm, -down.dot(nrm)).normalize()
      dir.lerp(hang, 0.28).normalize()
      const lifted = g() < V.liftedShare
      leaves.push({
        position: q.p.clone(),
        normal: nrm,
        direction: dir,
        size: leafSize * (0.69 + g() * 0.65),
        aspect: 0.73 + g() * 0.3,
        sprite: Math.floor(g() * 32),
        birth: start + duration * t + 0.009,
        unfurl: 0.05 + g() * 0.05,
        lift: lifted ? 0.18 + g() * (V.maxLift - 0.18) : g() * 0.12,
        roll: (g() - 0.5) * 0.5,
        phase: g() * TAU,
        sway: 0,
        stem: index,
        s: t,
        shade: 0.78 + g() * 0.22,
        anchor,
      })
    }
    return index
  }

  const F = plan.foliage
  const grow = (list: Spec[]) => {
    for (const sp of list) {
      const leafCount = Math.ceil(32 * sp.strength * V.leafDensity)
      const mainIndex = addStem(sp.knots, sp.start, sp.duration, V.stemRadius * sp.strength * (0.5 + 0.5 * F), leafCount, V.leafScale * sp.strength * F, true, -1, 0, sp.wild ?? -1)
      if (mainIndex < 0) continue
      const main = stems[mainIndex]
      const branches = Math.ceil(13 * sp.strength * V.branchDensity)
      for (let j = 0; j < branches; j++) {
        const s = 0.055 + (j / Math.max(1, branches - 1)) * 0.86
        const root = pointAt(main, s)
        const ahead = pointAt(main, Math.min(1, s + 0.02))
        const tx = ahead.p.x - root.p.x
        const ty = ahead.p.y - root.p.y
        const tangent = Math.atan2(ty, tx)
        const side = j % 2 ? 1 : -1
        const dir = tangent + side * (0.7 + g() * 0.78)
        const length = (0.32 + g() * 0.42) * sp.strength * (1 - s * 0.35)
        const end = { u: root.p.x + Math.cos(dir) * length, v: root.p.y + Math.sin(dir) * length }
        const mid = {
          u: lerp(root.p.x, end.u, 0.53) + Math.cos(dir + 1.57) * 0.1,
          v: lerp(root.p.y, end.v, 0.53) + Math.sin(dir + 1.57) * 0.1,
        }
        const bd = 0.13 + g() * 0.12
        addStem(
          [[root.p.x, root.p.y], [mid.u, mid.v], [end.u, end.v]],
          sp.start + sp.duration * s + 0.012, bd, V.stemRadius * 0.4 * sp.strength * (0.5 + 0.5 * F),
          6 + Math.floor(g() * 4), V.leafScale * 0.88 * sp.strength * F, false, mainIndex, s, sp.wild ?? -1,
        )
      }
    }
  }

  // The story's ivy, and the prototype's "free" leaves among it: the
  // ones that move with the air.
  grow(specs(plan, relief, r))
  const every = Math.max(2, Math.round(1 / V.swayShare))
  leaves.forEach((l, i) => {
    l.sway = i % every === 0 ? 0.65 + r() * 0.65 : 0
  })
  // Then the takeover's, from its own stream.
  const story = leaves.length
  g = random(seed ^ 0x3a17)
  grow(wildSpecs(plan, relief, g))
  for (let i = story; i < leaves.length; i++) leaves[i].sway = i % every === 0 ? 0.65 + g() * 0.65 : 0
  return { stems, leaves }
}

/** Point and normal at arc fraction t along a stem. */
export function pointAt(stem: Stem, t: number) {
  const s = stem.s
  const tt = clamp(t)
  let i = 1
  while (i < s.length - 1 && s[i] < tt) i++
  const a = s[i - 1]
  const b = s[i]
  const f = b > a ? (tt - a) / (b - a) : 0
  return {
    p: stem.points[i - 1].clone().lerp(stem.points[i], f),
    n: stem.normals[i - 1].clone().lerp(stem.normals[i], f).normalize(),
  }
}

/* ============================================================
   PRUNING BY THE READING FIELD
   The copy never cuts a plant. The plan above is fixed; here each
   stem is followed from its root and stopped at the last node it
   can reach while staying clear of the reading field — with the
   whole envelope of its leaves (their length, their lift, their
   sway, their shadow) taken into account, not just the stem line:
   SWAY_REACH covers the widest a leaf swings in the air, and
   SHADOW_REACH the furthest a leaf's cast shadow falls from it on
   the wall, so neither ever reaches the copy either.
   What lies beyond is never grown: its leaves, its branches, its
   later life. A stem stopped this way ends as stems do, in a
   tapering tip with its youngest leaves, so nothing looks
   clipped. Stems left too short to read as plants are dropped.
   ============================================================ */

export interface FieldProbe {
  /** Field value at a world point, enlarged by a world radius, for
      growth that arrives at `birth` and stays. */
  at(p: THREE.Vector3, radius: number, birth: number): number
}

export interface Pruning {
  /** Arc fraction each stem is grown to (0 = not at all). */
  cuts: Float32Array
  /** Which leaves are kept. */
  leaves: Uint8Array
}

/** How far a leaf's tip swings with the air, as a share of its size (sway ±0.058 rad + flutter ±0.065 rad about the stem, with margin). */
const SWAY_REACH = 0.12
/** How far a cast shadow can fall from the plant that casts it, in metres on the wall. */
const SHADOW_REACH = 0.035

export function prune(b: Botany, probe: FieldProbe, limit: number, foliage = 1): Pruning {
  const cuts = new Float32Array(b.stems.length)
  // Main stems first, then branches (whose parents are earlier).
  for (let i = 0; i < b.stems.length; i++) {
    const st = b.stems[i]
    // The takeover's ivy never grows with the story.
    if (st.wild >= 0) {
      cuts[i] = 0
      continue
    }
    if (st.parent >= 0 && st.at > cuts[st.parent]) {
      cuts[i] = 0
      continue
    }
    const envelope = (st.main ? ROOM_CONFIG.vines.leafScale * 1.15 : ROOM_CONFIG.vines.leafScale * 0.95) * foliage * (1 + SWAY_REACH) + SHADOW_REACH
    let cut = 1
    for (let k = 0; k < st.points.length; k++) {
      const birth = st.start + st.duration * st.s[k]
      if (probe.at(st.points[k], envelope, birth) > limit) {
        // Back off a little so the tip's young leaves are clear too.
        cut = Math.max(0, st.s[k] - 0.04)
        break
      }
    }
    // Too short to read as a plant: drop it.
    let len = 0
    for (let k = 1; k < st.points.length; k++) {
      if (st.s[k] > cut) break
      len += st.points[k].distanceTo(st.points[k - 1])
    }
    cuts[i] = len < (st.main ? 0.35 : 0.12) ? 0 : cut
  }
  const leaves = new Uint8Array(b.leaves.length)
  const tip = new THREE.Vector3()
  b.leaves.forEach((l, i) => {
    if (l.stem >= 0 && l.s > cuts[l.stem]) return
    // The leaf itself, at its full size and lift.
    tip.copy(l.position).addScaledVector(l.direction, l.size * 0.6).addScaledVector(l.normal, l.size * Math.sin(l.lift) * 0.5)
    leaves[i] = probe.at(tip, l.size * (0.65 + SWAY_REACH) + SHADOW_REACH, l.birth) <= limit ? 1 : 0
  })
  return { cuts, leaves }
}
