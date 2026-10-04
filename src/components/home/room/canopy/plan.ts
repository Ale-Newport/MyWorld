import * as THREE from 'three'
import { ROOM_CONFIG } from '../config'
import { catmull, clamp, random, TAU } from '../lib/random'
import type { Botany } from '../nature/botany'
import type { RoomView } from '../view'

/* ============================================================
   THE CANOPY
   What closes over the page when the visitor pushes past the end:
   the room's own ivy, come loose of the wall and grown out towards
   the lens — the same leaves (the same painted atlas), the same
   light, seen through the same fitted lens as the hall behind it.

   It grows in LAYERS of depth, each one a ring further in from the
   edges of the screen and a step nearer the lens: first a curtain
   just in front of the wall, continuous with the vines on it; then
   ivy hanging and climbing in nearer, larger and later; last, the
   leaves nearest the eye, which meet in the middle. So the last
   push is something closing in, and what it closes with is big,
   lit, near leaves over the dark of the leaves behind them.

   Everything is planned in SCREEN terms — a stem enters at an edge
   of the frame and reaches a given fraction of the way in — and
   placed at its layer's depth through the lens, so the composition
   is the same on every screen shape. Growth runs on the portal's
   charge instead of the story's: a stem's start, a leaf's birth,
   all in 0..1 of the push.
   ============================================================ */

interface LayerSpec {
  /** Leaf length as a fraction of the screen's short side (0: the
      layer stands just in front of the wall, at the wall's scale). */
  frac: number
  /** How far in from the edge its stems reach (0 edge … 1 centre). */
  reach: number
  /** The stretch of the charge it grows over. */
  from: number
  to: number
  stems: number
  /** How dark it falls once the layers in front have closed over it. */
  dark: number
  /** Which of the three depth bands it parts with (0 deep … 2 near). */
  band: number
  /** Leaf spacing along a stem, in leaf lengths. The deep layers are
      many small leaves on screen; spaced wider they read the same at a
      fraction of the drawing. */
  spacing: number
}

const LAYERS: LayerSpec[] = [
  { frac: 0, reach: 0.32, from: 0.02, to: 0.48, stems: 34, dark: 0.72, band: 0, spacing: 0.66 },
  { frac: 0.034, reach: 0.5, from: 0.14, to: 0.6, stems: 30, dark: 0.58, band: 0, spacing: 0.54 },
  { frac: 0.058, reach: 0.7, from: 0.28, to: 0.74, stems: 28, dark: 0.42, band: 1, spacing: 0.46 },
  { frac: 0.095, reach: 0.9, from: 0.44, to: 0.88, stems: 20, dark: 0.34, band: 1, spacing: 0.42 },
  { frac: 0.16, reach: 1.12, from: 0.6, to: 0.99, stems: 12, dark: 0, band: 2, spacing: 0.42 },
]

export interface CanopyLayer {
  /** The layer's plants, split by the side of the screen their stems
      enter from: the canopy parts down the middle (see CanopyCover). */
  sides: [Botany, Botany]
  band: number
  dark: number
}

/** A lens to plan through when the room has published none. */
export function defaultView(aspect: number): RoomView {
  const ty = Math.tan(THREE.MathUtils.degToRad(17))
  return { lens: { ty, tx: ty * aspect, shift: 0, position: new THREE.Vector3(0, 1.7, 10) }, aspect, distance: 10, foliage: 1 }
}

/** Plans the canopy for a view: the same view and seed, the same canopy. */
export function planCanopy(view: RoomView, seed: number): CanopyLayer[] {
  const next = canopyPlanner(view, seed)
  const out: CanopyLayer[] = []
  for (let layer = next(); layer; layer = next()) out.push(layer)
  return out
}

/**
 * The same plan, a layer per call (null when done), so it can be laid
 * out in slices of idle time; the layers share one random stream, so
 * the result is the same either way.
 */
export function canopyPlanner(view: RoomView, seed: number): () => CanopyLayer | null {
  const { lens, aspect } = view
  const cam = lens.position
  const r = random(seed ^ 0x6c0e)
  const V = ROOM_CONFIG.vines
  // A leaf's length in metres, as the room draws it at this layout.
  const leafWorld = V.leafScale * view.foliage * 1.15
  /** The point at screen position (x, y) in NDC, `d` metres in front of the lens. */
  const at = (x: number, y: number, d: number) =>
    new THREE.Vector3(cam.x + x * lens.tx * d, cam.y + (y + lens.shift) * lens.ty * d, cam.z - d)
  // The frustum's short side per metre of depth.
  const shortPerM = 2 * lens.ty * Math.min(aspect, 1)

  let index = 0
  return () => {
    const L = LAYERS[index++]
    if (!L) return null
    const d = L.frac > 0 ? clamp(leafWorld / (L.frac * shortPerM), 0.55, view.distance - 0.5) : view.distance - 0.32
    const sides: [Botany, Botany] = [{ stems: [], leaves: [] }, { stems: [], leaves: [] }]
    const toCamera = new THREE.Vector3(0, 0, 1)

    const addStem = (
      side: Botany, path: Array<[number, number]>, start: number, duration: number, radius: number,
      leafEvery: number, leafSize: number, main: boolean, parent: number, at0: number, wave: number,
    ) => {
      const { stems, leaves } = side
      // The path in NDC, sampled densely, then placed at the layer's
      // depth — swaying a little in and out of it so the curtain is
      // not a pane.
      const n = 28
      const points: THREE.Vector3[] = []
      for (let i = 0; i <= n; i++) {
        const p = catmull(path, i / n)
        const dd = d * (1 + 0.06 * Math.sin(i * 0.45 + wave))
        points.push(at(p.u, p.v, dd))
      }
      const normals = points.map((p) => cam.clone().sub(p).normalize())
      const s: number[] = [0]
      let acc = 0
      for (let i = 1; i < points.length; i++) {
        acc += points[i].distanceTo(points[i - 1])
        s.push(acc)
      }
      for (let i = 0; i < s.length; i++) s[i] = acc > 0 ? s[i] / acc : 0
      const index = stems.length
      stems.push({ points, normals, s, start, duration, radius, main, parent, at: at0, wild: -1 })
      const count = Math.max(2, Math.floor(acc / leafEvery))
      const down = new THREE.Vector3(0, -1, 0)
      for (let i = 0; i < count; i++) {
        // To the very tip: a growing shoot carries its youngest leaves
        // with it, it does not run on bare.
        const t = Math.min(0.985, (i + 0.55 + r() * 0.45) / count)
        const q = pointOn(points, s, t)
        const ahead = pointOn(points, s, Math.min(1, t + 0.02))
        // Facing the lens, loosely: hanging ivy turns its blades to
        // the light and the room, never all one way.
        const nrm = toCamera.clone().add(new THREE.Vector3((r() - 0.5) * 1.4, (r() - 0.35) * 1.1, 0)).normalize()
        const tangent = ahead.sub(q)
        tangent.addScaledVector(nrm, -tangent.dot(nrm))
        if (tangent.lengthSq() < 1e-10) tangent.set(0, -1, 0)
        tangent.normalize()
        const side = i % 2 ? 1 : -1
        const dir = tangent.clone().applyAxisAngle(nrm, side * (0.7 + r() * 0.8))
        const hang = down.clone().addScaledVector(nrm, -down.dot(nrm)).normalize()
        dir.lerp(hang, 0.35).normalize()
        leaves.push({
          position: q,
          normal: nrm,
          direction: dir,
          size: leafSize * (0.7 + r() * 0.6),
          aspect: 0.73 + r() * 0.3,
          sprite: Math.floor(r() * 32),
          // Just behind the tip, unfurling fast: a growing shoot carries
          // its youngest leaves with it.
          birth: start + duration * t + 0.005,
          unfurl: 0.02 + r() * 0.015,
          lift: r() * 0.85,
          roll: (r() - 0.5) * 0.7,
          phase: r() * TAU,
          sway: r() < 0.25 ? 0.6 + r() * 0.6 : 0,
          stem: index,
          s: t,
          shade: 0.62 + r() * 0.42,
          anchor: radius + 0.002,
        })
      }
      return index
    }

    // Stems enter all round the frame, spaced by screen length (the
    // long edges get more), each reaching its own way in.
    const perimeter = 4 * aspect + 4
    for (let k = 0; k < L.stems; k++) {
      const p = ((k + r() * 0.85) / L.stems) * perimeter
      const { x, y, ix, iy } = onFrame(p, aspect)
      const reach = L.reach * (0.62 + r() * 0.55)
      const steps = 4
      const path: Array<[number, number]> = [[x * 1.08, y * 1.08]]
      let px = x
      let py = y
      const sway = (r() - 0.5) * 0.5
      for (let i = 1; i <= steps; i++) {
        // In from the edge, wandering across it in a long curve, and
        // pulled down: ivy that has nothing to hold falls.
        const across = sway * Math.sin((i / steps) * Math.PI) + (r() - 0.5) * 0.12
        px += (ix * reach) / steps + (iy !== 0 ? across : across * 0.4) / steps * 2
        py += (iy * reach) / steps + (ix !== 0 ? across : across * 0.4) / steps * 2 - (iy > 0 ? 0 : 0.035 * i)
        path.push([px, py])
      }
      // The layer's window of the charge: the outer ends of the frame
      // first, a few stragglers late.
      const span = L.to - L.from
      const start = L.from + r() * span * 0.32
      const duration = Math.max(0.12, (L.to - 0.05 - start) * (0.75 + r() * 0.25))
      // Wiry: near the lens a wall-thick stem would read as a stick.
      const radius = V.stemRadius * (0.55 + 0.45 * view.foliage) * (0.7 + r() * 0.35) * (L.frac >= 0.09 ? 0.55 : L.frac > 0 ? 0.8 : 1)
      // Left or right of the middle, by where the stem comes in.
      const half = sides[x < 0 || (x === 0 && r() < 0.5) ? 0 : 1]
      const main = addStem(half, path, start, duration, radius, leafWorld * L.spacing, leafWorld, true, -1, 0, r() * TAU)
      // Branches, out to either side.
      const branches = 2 + Math.floor(r() * 3)
      for (let b = 0; b < branches; b++) {
        const sAt = 0.2 + (b / Math.max(1, branches - 1)) * 0.6 + (r() - 0.5) * 0.1
        const root = catmull(path, sAt)
        const side = b % 2 ? 1 : -1
        const len = reach * (0.25 + r() * 0.3)
        // Across the main stem's line of travel.
        const bx = root.u + (-iy * side * len) + ix * len * 0.3
        const by = root.v + (ix * side * len) + iy * len * 0.3 - 0.03
        const mid: [number, number] = [(root.u + bx) / 2 + (r() - 0.5) * 0.08, (root.v + by) / 2 + (r() - 0.5) * 0.08]
        addStem(
          half, [[root.u, root.v], mid, [bx, by]],
          start + duration * sAt + 0.01, Math.max(0.08, duration * 0.45), radius * 0.45,
          leafWorld * L.spacing * 0.95, leafWorld * 0.9, false, main, sAt, r() * TAU,
        )
      }
    }
    return { sides, band: L.band, dark: L.dark }
  }
}

/**
 * A point at distance `p` along the frame's perimeter (NDC), and the
 * inward direction there. The perimeter is measured in screen terms:
 * the long edges are `2 * aspect`, the short ones 2.
 */
function onFrame(p: number, aspect: number) {
  const top = 2 * aspect
  const side = 2
  if (p < top) return { x: -1 + p / aspect, y: 1, ix: 0, iy: -1 }
  p -= top
  if (p < side) return { x: 1, y: 1 - p, ix: -1, iy: 0 }
  p -= side
  if (p < top) return { x: 1 - p / aspect, y: -1, ix: 0, iy: 1 }
  p -= top
  return { x: -1, y: -1 + p, ix: 1, iy: 0 }
}

function pointOn(points: THREE.Vector3[], s: number[], t: number) {
  const tt = clamp(t)
  let i = 1
  while (i < s.length - 1 && s[i] < tt) i++
  const a = s[i - 1]
  const b = s[i]
  const f = b > a ? (tt - a) / (b - a) : 0
  return points[i - 1].clone().lerp(points[i], f)
}

