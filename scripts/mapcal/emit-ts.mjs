/**
 * scripts/mapcal/emit-ts.mjs — the hand-drawn map, compiled.
 *
 *   node scripts/mapcal/emit-ts.mjs
 *
 * Reads the digitised plan (`plan.json`, normalized 0..1 drawing space,
 * verified against the photograph by `overlay.mjs`) and writes
 * `src/content/world-map.ts`. Nothing downstream reads plan.json — the
 * generated file is what ships. Re-run this after editing the plan.
 */
import fs from 'node:fs'
import path from 'node:path'

const P = JSON.parse(fs.readFileSync(new URL('./plan.json', import.meta.url)))

/*
  THE ISLAND IS 266 x 199.5, NOT 380 x 285.

  Thirty per cent off every dimension, which is half the area: the
  brief asked for the same map, drawn smaller, with everything closer
  together. The drawing is normalized, so this one pair of numbers
  moves every zone, every path, every lake and the coastline itself,
  and the distribution is preserved exactly.

  What it must NOT move is anything the CAR touches, because the car
  did not shrink. `HOLD` below is that list.
*/
const MAP_WIDTH = 266
const MAP_DEPTH = 199.5

/*
  BUILT DIMENSIONS, IN ABSOLUTE METRES.

  `W()` and `D()` turn a fraction of the drawing into metres, which is
  right for a lake, a wood or a district's catchment and wrong for
  anything with a wheel on it. A ramp scaled to 28.7 x 6.8 is a ramp
  the car falls off the side of; a bridge deck at 6.4 m is narrower
  than the road that crosses it; a 8.4 m black hole no longer contains
  its own crater rim.

  So these seven zones publish measured metres instead. They are the
  same numbers the world shipped at 380 x 285 — which is the point:
  the island got smaller and the things you drive on did not.
*/
const HOLD = {
  // 30, not 41. The ramp is a held size, so at 0.7 it became the
  // largest single footprint on the island: its 26.5 m registry disc
  // (length/2 + the run-up) reached the road-ramp respawn, the WELCOME
  // billboard and the projects respawn all at once. Thirty metres of
  // deck at 5.6 m of rise is a 10.6 degree launch — steeper, and still
  // a ramp you drive up rather than hit.
  ramp: { length: 30, width: 9.7 },
  bridge: { width: 9.1 },
  bowlingLane: { width: 11.4 },
  nameLetters: { width: 49.4, depth: 12 },
  timeMachine: { radius: 10.6 },
  blackHole: { radius: 12 },
  landing: { rx: 36, rz: 26 },
  // The labyrinth is 7 x 7 cells of 4.6 m between 1.2 m walls; the
  // generator in `Labyrinth.ts` computes the same 41.8 and the
  // occupancy registry copies it. Three files, one number.
  maze: { size: 41.8 },
}

const X = (u) => round((u - 0.5) * MAP_WIDTH)
const Z = (v) => round((v - 0.5) * MAP_DEPTH)
const W = (n) => round(n * MAP_WIDTH)
const D = (n) => round(n * MAP_DEPTH)
function round(n) { return Math.round(n * 10) / 10 }

const pt = ([u, v]) => [X(u), Z(v)]
const list = (pts, per = 6, indent = '  ') =>
  chunk(pts.map(([a, b]) => `[${a},${b}]`), per).map((r) => indent + r.join(', ')).join(',\n')
function chunk(a, n) { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o }

/**
 * RELAX THE TIGHT CORNERS.
 *
 * The drawn track band is about twenty-five metres wide and its corners
 * are drawn with a crayon, so tracing the centre of it produces radii
 * the band itself could never contain: the west hairpin came out at
 * 4.6 m on a fourteen-metre track, which is a centreline whose inner
 * kerb has NEGATIVE radius. The autopilot in
 * `scripts/world-race-drive.mjs` ran twenty-four metres wide there,
 * missed the next checkpoint, and — because gate detection is strictly
 * sequential, as it must be — could not complete a lap.
 *
 * So: Laplacian smoothing applied ONLY where the local radius is under
 * one track width, with every point pinned within `LIMIT` metres of
 * where it was digitised. That keeps the trace honest — the shape is
 * still the drawing's — while making every corner one a car can take.
 */
function relax(points, minRadius, limit, passes) {
  const n = points.length
  const out = points.map(([x, z]) => [x, z])
  const radiusAt = (list, i) => {
    const a = list[(i - 2 + n) % n]
    const b = list[i]
    const c = list[(i + 2) % n]
    const A = Math.hypot(b[0] - a[0], b[1] - a[1])
    const B = Math.hypot(c[0] - b[0], c[1] - b[1])
    const C = Math.hypot(c[0] - a[0], c[1] - a[1])
    const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
    return area < 1e-9 ? Infinity : (A * B * C) / (4 * area)
  }
  for (let pass = 0; pass < passes; pass++) {
    const next = out.map(([x, z]) => [x, z])
    for (let i = 0; i < n; i++) {
      const r = radiusAt(out, i)
      if (r >= minRadius) continue
      // How hard to pull, from a touch at the threshold to half-way to
      // the neighbours' midpoint at a fold.
      const pull = Math.min(0.5, 0.5 * (1 - r / minRadius))
      const a = out[(i - 1 + n) % n]
      const c = out[(i + 1) % n]
      let x = out[i][0] + ((a[0] + c[0]) / 2 - out[i][0]) * pull
      let z = out[i][1] + ((a[1] + c[1]) / 2 - out[i][1]) * pull
      const dx = x - points[i][0]
      const dz = z - points[i][1]
      const drift = Math.hypot(dx, dz)
      if (drift > limit) {
        x = points[i][0] + (dx / drift) * limit
        z = points[i][1] + (dz / drift) * limit
      }
      next[i] = [x, z]
    }
    for (let i = 0; i < n; i++) out[i] = next[i]
  }
  return { line: out.map(([x, z]) => [round(x), round(z)]), radiusAt }
}

const coast = P.coast.map(pt)
const islet = P.islet.map(pt)
const drawnRace = P.race.centreline.map(pt)

/*
  THE THREE NUMBERS THAT DECIDE WHETHER THE CIRCUIT CAN BE DRIVEN.

  `MIN_CORNER_RADIUS` is in METRES and is not the track width — it is
  the tightest corner the car can take, and the car did not shrink, so
  it stays at 14 even though everything around it is now 70% of what
  it was. It used to be passed `TRACK_WIDTH` as a mnemonic and the two
  quantities drifted apart the moment the map did.

  `DRIFT_LIMIT` is the leash: how far a control point may end up from
  where it was digitised. At 380 x 285 it was slack — the relaxer
  never needed more than 1.9 m — and at 266 x 199.5 it is the ONLY
  thing that binds. Measured over a sweep of minRadius 10..25 against
  limit 5..16:

      limit  7  ->  tightest corner  8.8 m
      limit  9  ->                   9.2 m
      limit 10  ->                  11.4 m     <- this
      limit 12  ->                  11.4 m

  Raising MIN_CORNER_RADIUS instead makes it WORSE, because a point
  freezes the instant its own radius clears the threshold while its
  neighbours are still being pulled, which folds new kinks in: at 15
  the tightest corner is 7.5 m and at 16 it is 6.8 m.

  `PASSES` is 240 and is also load-bearing: at 600 the same settings
  over-smooth into a new pinch and give 8.1 m. Do not raise it.
*/
const MIN_CORNER_RADIUS = 14
const DRIFT_LIMIT = 10
const PASSES = 240
/** Reported only. The racing surface is `CIRCUIT.width`. */
const TRACK_WIDTH = 10
const { line: race, radiusAt } = relax(drawnRace, MIN_CORNER_RADIUS, DRIFT_LIMIT, PASSES)
const tightest = race.reduce((worst, _, i) => Math.min(worst, radiusAt(race, i)), Infinity)
const drift = race.reduce((worst, p, i) => Math.max(worst, Math.hypot(p[0] - drawnRace[i][0], p[1] - drawnRace[i][1])), 0)
const lapLength = race.reduce((s, a, i) => {
  const b = race[(i + 1) % race.length]
  return s + Math.hypot(b[0] - a[0], b[1] - a[1])
}, 0)

/* ============================================================
   LAKES CLEAR THE RACING LINE

   The drawing puts water and the racing line in the same place. It is
   not a tracing error — at map scale a pond edge and a track edge are
   two pencil strokes a millimetre apart — but in metres it means the
   lake's BANK reaches the racing surface, and the bank is carved by
   the one terrain stage that is deliberately allowed to beat built
   ground. Measured before this rule: lake-south-0's water began 1 m
   from the centreline at (8.3, 40.2) and took the outer half of the
   track down to 0.11 m against a racing floor of 0.73; lake-west-2 did
   the same at (-55.6, 42).

   Neither moving the racing line nor accepting the drop is available.
   The line has 1.00 m of budget at the pinch, and a level track with
   the bank starting at its kerb is the "abrupt terrain wall beside the
   asphalt" this pass exists to remove.

   So the lake gives way, by the smallest amount that works: it is
   shrunk about its own centre until its mapped edge is a track
   half-width, a bank width and a margin clear of the line. Shrinking
   rather than moving keeps the blob's centre where it was drawn, so
   the union of ellipses that makes each lake keeps its shape.
   ============================================================ */
/* Must match `VALVE_FREE` in Terrain.ts: the distance outside a lake
   at which built ground stops being carved. Beyond it a track is safe
   whatever the bank is doing. */
const VALVE_FREE = 5
const LAKE_MARGIN = 1
const LAKE_CLEAR = TRACK_WIDTH / 2 + VALVE_FREE + LAKE_MARGIN
/** How far a lake may be pushed before it starts losing size instead. */
const LAKE_NUDGE = 8

/** Metres from a point to an ellipse's edge; negative inside. */
function metresToEllipse([px, pz], e) {
  const ux = (px - e.x) / e.rx
  const uz = (pz - e.z) / e.rz
  const n = Math.hypot(ux, uz)
  if (n <= 0) return -Math.min(e.rx, e.rz)
  const gradient = Math.hypot(ux / e.rx, uz / e.rz) / n
  return (n - 1) / gradient
}

const lakeShrinks = []
function clearRacingLine(planEllipse, id) {
  const world = { x: X(planEllipse.u), z: Z(planEllipse.v), rx: W(planEllipse.ru), rz: D(planEllipse.rv) }
  const nearest = (e) => race.reduce((best, pt) => Math.min(best, metresToEllipse(pt, e)), Infinity)
  const before = nearest(world)
  if (before >= LAKE_CLEAR) return planEllipse
  /*
     NUDGE FIRST, SHRINK ONLY IF THAT IS NOT ENOUGH.

     A pond moved four metres still reads as the pond that was drawn; a
     pond at half its diameter does not. So the ellipse is pushed
     directly away from the nearest point of the racing line — up to
     `LAKE_NUDGE` — and only then, if it still overlaps, does it lose
     size. Both are reported, because both are departures from the
     drawing and neither should be discoverable only by looking.
  */
  const closest = race.reduce(
    (best, pt) => (metresToEllipse(pt, world) < best.d ? { d: metresToEllipse(pt, world), pt } : best),
    { d: Infinity, pt: race[0] },
  )
  let vx = world.x - closest.pt[0]
  let vz = world.z - closest.pt[1]
  const len = Math.hypot(vx, vz) || 1
  vx /= len
  vz /= len

  const moved = { ...world }
  let nudge = 0
  while (nudge < LAKE_NUDGE && nearest(moved) < LAKE_CLEAR) {
    nudge += 0.25
    moved.x = world.x + vx * nudge
    moved.z = world.z + vz * nudge
  }

  let scale = 1
  while (scale > 0.5 && nearest({ ...moved, rx: moved.rx * scale, rz: moved.rz * scale }) < LAKE_CLEAR) {
    scale -= 0.02
  }
  const final = { ...moved, rx: moved.rx * scale, rz: moved.rz * scale }
  if (nearest(final) < LAKE_CLEAR) {
    throw new Error(
      `[emit] ${id} cannot clear the racing line: its edge is ${before.toFixed(1)} m from the line and needs `
      + `${LAKE_CLEAR} m. ${LAKE_NUDGE} m of nudge and half its radius are not enough. `
      + `Move the line or the lake in plan.json.`,
    )
  }
  lakeShrinks.push({ id, nudge, scale, before, after: nearest(final), rx: world.rx, rz: world.rz })
  return {
    ...planEllipse,
    u: final.x / MAP_WIDTH + 0.5,
    v: final.z / MAP_DEPTH + 0.5,
    ru: planEllipse.ru * scale,
    rv: planEllipse.rv * scale,
  }
}

P.water.lakeWestEllipses = P.water.lakeWestEllipses.map((e, i) => clearRacingLine(e, `lake-west-${i}`))
P.water.lakeSouthEllipses = P.water.lakeSouthEllipses.map((e, i) => clearRacingLine(e, `lake-south-${i}`))

const ell = (e) => `{ x: ${X(e.u)}, z: ${Z(e.v)}, rx: ${W(e.ru)}, rz: ${D(e.rv)} }`
const zone = (k) => {
  const z = P.zones[k]
  const o = []
  // A held dimension is emitted as measured metres; everything else is
  // a fraction of the drawing and shrinks with it.
  const held = HOLD[k] ?? {}
  const w = (field, value) => round(held[field] ?? value)
  if (z.u != null) o.push(`x: ${X(z.u)}`, `z: ${Z(z.v)}`)
  if (z.rx != null) o.push(`rx: ${w('rx', W(z.rx))}`, `rz: ${w('rz', D(z.ry))}`)
  if (z.r != null) o.push(`radius: ${w('radius', W(z.r))}`)
  if (z.size != null) o.push(`size: ${w('size', W(z.size))}`)
  if (z.len != null) o.push(`length: ${w('length', W(z.len))}`, `width: ${w('width', D(z.width))}`)
  if (z.w != null) o.push(`width: ${w('width', W(z.w))}`, `depth: ${w('depth', D(z.h))}`)
  if (z.angleDeg != null) o.push(`rotation: ${round((z.angleDeg * Math.PI) / 180)}`)
  if (z.headingDeg != null) o.push(`rotation: ${round((z.headingDeg * Math.PI) / 180)}`)
  if (z.u0 != null) o.push(`from: [${X(z.u0)}, ${Z(z.v0)}]`, `to: [${X(z.u1)}, ${Z(z.v1)}]`, `width: ${w('width', D(z.width))}`)
  return `{ ${o.join(', ')} }`
}

const veg = P.vegetation.filter((v) => !v.ring)
  .map((v) => `  { id: '${v.id}', x: ${X(v.u)}, z: ${Z(v.v)}, rx: ${W(v.rx)}, rz: ${D(v.ry)}, density: ${v.density} },`)
  .join('\n')

const paths = P.paths
  .map((p) => `  { id: '${p.id}', points: [${p.pts.map(pt).map(([a, b]) => `[${a},${b}]`).join(', ')}] },`)
  .join('\n')

const out = `/* GENERATED by scripts/mapcal/emit-ts.mjs — do not edit by hand.
   Source: the hand-drawn map (scripts/mapcal/plan.json), digitised in
   normalized drawing space and verified against the photograph by
   scripts/mapcal/overlay.mjs. Re-run the emitter after editing the plan. */

/* ============================================================
   THE MAP

   One source of truth for where everything on the island is.
   \`world-environment.ts\` derives the natural geography from this;
   \`world.ts\` derives the built environment from it; the terrain,
   the ecology, the occupancy registry, the minimap and the race
   all read those.

   Coordinates are metres. The drawing is normalized u,v (0..1,
   left→right and top→bottom); world x = (u − 0.5)·MAP_WIDTH and
   world z = (v − 0.5)·MAP_DEPTH, so +x is east and +z is south and
   the top of the drawing is north.
   ============================================================ */

export const MAP_WIDTH = ${MAP_WIDTH}
export const MAP_DEPTH = ${MAP_DEPTH}

/** Drawing space → world. Kept so the plan can be re-read by hand. */
export function fromDrawing(u: number, v: number): [number, number] {
  return [(u - 0.5) * MAP_WIDTH, (v - 0.5) * MAP_DEPTH]
}
/** World → drawing space. Used by the dev calibration overlay. */
export function toDrawing(x: number, z: number): [number, number] {
  return [x / MAP_WIDTH + 0.5, z / MAP_DEPTH + 0.5]
}

export type Poly = readonly (readonly [number, number])[]

/* ---- the coastline ---------------------------------------- */

/** The island, traced from the drawing's sand/ocean boundary. */
export const ISLAND: Poly = [
${list(coast)},
]

/** The vegetated islet in the north-east bay. Its own landmass. */
export const ISLET: Poly = [
${list(islet)},
]

/** Every piece of land. \`coastInset\` is the max over these. */
export const LANDMASSES: readonly Poly[] = [ISLAND, ISLET]

/* ---- the circuit ------------------------------------------ */

/** The racing line, closed, in the direction the drawing's arrows give:
 *  north-west out of the pit straight, anticlockwise round the BLACK
 *  HOLE loop, down the west straight past TNT, east along the south
 *  straight, then the technical section back to the line.
 *  Lap length ${Math.round(lapLength)} m. */
export const RACE_LINE: Poly = [
${list(race)},
]

/* ---- water ------------------------------------------------ */

/** Lakes are unions of ellipses: the drawing's water is blobby and the
 *  terrain, the water surfaces and the river's lake-discard shader all
 *  want ellipses. Two named bodies, five ellipses. */
export const LAKE_WEST = [
${P.water.lakeWestEllipses.map((e) => '  ' + ell(e)).join(',\n')},
] as const
export const LAKE_SOUTH = [
${P.water.lakeSouthEllipses.map((e) => '  ' + ell(e)).join(',\n')},
] as const

/** The landing river, crossed by the bridge. */
export const RIVER_LINE: Poly = [
${list(P.water.landingRiver.path.map(pt), 5)},
]
export const RIVER_WIDTH = ${W(P.water.landingRiver.halfWidth * 2)}

/* ---- zones ------------------------------------------------ */

export const ZONES = {
  landing: ${zone('landing')},
  nameLetters: ${zone('nameLetters')},
  bridge: ${zone('bridge')},
  social: ${zone('social')},
  bowling: ${zone('bowling')},
  bowlingLane: ${zone('bowlingLane')},
  projects: ${zone('projects')},
  ramp: ${zone('ramp')},
  timeMachine: ${zone('timeMachine')},
  maze: ${zone('maze')},
  achievements: ${zone('achievements')},
  blackHole: ${zone('blackHole')},
  tnt: ${zone('tnt')},
  raceStart: ${zone('raceStart')},
} as const

/* ---- vegetation ------------------------------------------- */

export interface VegetationMass {
  id: string
  x: number
  z: number
  rx: number
  rz: number
  /** Relative to 1. The drawing's darker greens are denser. */
  density: number
}

/** The drawing's green masses. Trees and scatter come from these and
 *  nowhere else — there is no island-wide spray. */
export const VEGETATION: VegetationMass[] = [
${veg}
]

/* ---- paths ------------------------------------------------ */

/** The drawing's brown tracks. Compact earth, not asphalt. */
export const PATHS: { id: string; points: Poly }[] = [
${paths}
]

/* ---- geometry helpers ------------------------------------- */

export function pointInPolygon(x: number, z: number, poly: Poly): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

/** Distance to a polygon's edge, unsigned. */
export function polygonEdgeDistance(x: number, z: number, poly: Poly): number {
  let best = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j]
    const [bx, bz] = poly[i]
    const dx = bx - ax
    const dz = bz - az
    const len = dx * dx + dz * dz
    const t = len > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len)) : 0
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t)
    if (d < best) best = d
  }
  return best
}
`

const target = path.resolve('src/content/world-map.ts')
fs.writeFileSync(target, out)
console.log(
  `wrote ${target}\n  lap ${Math.round(lapLength)} m`
  + `\n  tightest corner ${tightest.toFixed(1)} m (track is ${TRACK_WIDTH} m wide)`
  + `\n  furthest a control point moved from the drawing: ${drift.toFixed(1)} m`
  + (lakeShrinks.length
    ? `\n  lakes shrunk to clear the racing line (needs ${LAKE_CLEAR} m):\n`
      + lakeShrinks.map((l) =>
        `    ${l.id} nudged ${l.nudge.toFixed(2)} m, scaled x${l.scale.toFixed(2)} — edge was ${l.before.toFixed(1)} m`
        + ` from the line, now ${l.after.toFixed(1)} m (${l.rx.toFixed(1)} x ${l.rz.toFixed(1)} m)`).join('\n')
    : '\n  every lake already clears the racing line'),
)
