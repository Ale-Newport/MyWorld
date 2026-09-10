import {
  ISLAND, ISLET, LANDMASSES, LAKE_SOUTH, LAKE_WEST, MAP_DEPTH, MAP_WIDTH,
  PATHS, RACE_LINE, RIVER_LINE, RIVER_WIDTH, VEGETATION, ZONES,
  pointInPolygon, polygonEdgeDistance, type Poly,
} from './world-map'

/** Shared geography for terrain, map, ecology and games.
 *
 * Everything here is DERIVED from `world-map.ts`, which is the
 * hand-drawn plan compiled to metres. Nothing in this file invents a
 * position: it turns the plan's shapes into the specific tables the
 * terrain, the water, the ecology and the occupancy registry expect.
 *
 * The island is 380 × 285 m — compact on purpose. Half of it is the
 * race circuit, so the other half has to be dense: from the LANDING
 * every activity is between seven and sixteen seconds away. */

/* ============================================================
   THE COASTLINE

   Was a radius-varies-with-bearing harmonic, which can only draw a
   star-shaped island. The plan has a bay carved into the north-east
   and a separate islet inside it, so the coast is now a polygon —
   two, in fact — and the shore is a signed distance to them.

   `coastRadius` keeps its old signature because seven call sites
   spell the same idea as `coastRadius(x, z, R) - hypot(x, z)`. That
   expression still means "metres inside the coast", which is all any
   of them wanted.
   ============================================================ */

/**
 * Nominal island scale, kept only as the fallback for a bearing that
 * misses the coastline entirely — which cannot happen for a closed
 * polygon, but `coastRayDistance` returns a number and a number it
 * must return.
 *
 * NOTHING ELSE SHOULD USE IT. The island is 380 by 285 and its shape is
 * `LANDMASSES`; every question about where the coast is has a better
 * answer in `coastInset` or `coastRayDistance`, and every question
 * about how big the world is has one in `MAP_WIDTH`/`MAP_DEPTH`. It
 * used to be the radius of a disc, and half the island's systems
 * measured themselves against it.
 */
export const WORLD_RADIUS = 122.5

/** Half-extent of the baked coast-inset grid. 300 was FIELD_HALF + 50
 *  at the old scale; 210 is the same margin at the new one. */
const FIELD = 210
const GRID = 384
const CELL = (FIELD * 2) / GRID
let insetGrid: Float32Array | null = null

function insetExact(x: number, z: number): number {
  let best = -Infinity
  for (const poly of LANDMASSES) {
    const edge = polygonEdgeDistance(x, z, poly)
    const signed = pointInPolygon(x, z, poly) ? edge : -edge
    if (signed > best) best = signed
  }
  return best
}

/**
 * Metres inside the coastline; negative at sea.
 *
 * Baked into a 384² grid over ±300 m and sampled bilinearly. The exact
 * form is 68 segment-distance tests, and `Terrain` asks for it about
 * 800 000 times while it builds the heightfield and the mask — that is
 * a second of load time for a quantity that is smooth everywhere
 * except within a metre of a vertex. The grid is 1.56 m; the drawn
 * coastline is hand-wobbly to about five.
 */
export function coastInset(x: number, z: number): number {
  if (!insetGrid) {
    insetGrid = new Float32Array(GRID * GRID)
    for (let j = 0; j < GRID; j++) {
      const gz = -FIELD + j * CELL
      for (let i = 0; i < GRID; i++) insetGrid[j * GRID + i] = insetExact(-FIELD + i * CELL, gz)
    }
  }
  const fx = (x + FIELD) / CELL
  const fz = (z + FIELD) / CELL
  if (fx < 0 || fz < 0 || fx > GRID - 1 || fz > GRID - 1) return insetExact(x, z)
  const i = Math.floor(fx)
  const j = Math.floor(fz)
  const tx = fx - i
  const tz = fz - j
  const i1 = Math.min(GRID - 1, i + 1)
  const j1 = Math.min(GRID - 1, j + 1)
  const a = insetGrid[j * GRID + i]
  const b = insetGrid[j * GRID + i1]
  const c = insetGrid[j1 * GRID + i]
  const d = insetGrid[j1 * GRID + i1]
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz
}

/**
 * Distance from the origin to the first shoreline on a bearing.
 *
 * The ground painter and the coastal benches walk bearings rather than
 * points, and for a non-convex island "the shore that way" is the FIRST
 * crossing, not the furthest — which is what puts the north-east bay on
 * the painted map instead of a headland straight across it.
 */
export function coastRayDistance(angle: number): number {
  const dx = Math.cos(angle)
  const dz = Math.sin(angle)
  let best = Infinity
  for (let i = 0, j = ISLAND.length - 1; i < ISLAND.length; j = i++) {
    const [ax, az] = ISLAND[j]
    const [bx, bz] = ISLAND[i]
    const ex = bx - ax
    const ez = bz - az
    const denominator = dx * ez - dz * ex
    if (Math.abs(denominator) < 1e-9) continue
    const t = (ax * ez - az * ex) / denominator
    if (t <= 0) continue
    const u = (ax * dz - az * dx) / denominator
    if (u < 0 || u > 1) continue
    if (t < best) best = t
  }
  return Number.isFinite(best) ? best : WORLD_RADIUS
}

/** Kept for the callers that spell `coastRadius(x, z, R) - hypot(x, z)`.
 *  `nominal` is ignored: the coast is a traced polygon now. */
export function coastRadius(x: number, z: number, _nominal?: number): number {
  return Math.hypot(x, z) + coastInset(x, z)
}

/* ============================================================
   THE CIRCUIT

   NEWPORT CIRCUIT, traced from the drawing. Ninety-two control
   points, one lap of 954 m, run in the direction the drawing's
   arrows give:

     START/FINISH  the pit straight, running west-north-west, with
                   the gantry where the drawing puts it
     THE CLIMB     north out of the infield
     THE TOP LOOP  anticlockwise around the BLACK HOLE, which sits
                   in the middle of it and is meant to be seen at
                   speed rather than visited during a lap
     THE DESCENT   back down the loop's west side
     WEST HAIRPIN  the slowest corner on the lap
     THE WEST RUN  190 m of near-straight past the TNT stack — the
                   fastest part, and the only place the coastline is
                   close enough to matter
     SOUTH CORNER  long and open
     THE SOUTH RUN 200 m east along the bottom of the island
     THE SWEEPER   climbing north-west, fast
     THE ESSES     an arc, a very tight hairpin, a run back west
     LAST CORNER   north onto the line

   Points are WORLD coordinates: the drawing is the frame of
   reference now, so there is nothing to offset them by.
   ============================================================ */

export const CIRCUIT = {
  x: 0,
  z: 0,
  /**
   * 10 m of racing surface, down from 14 — and this one is forced, not
   * a preference.
   *
   * On a 266 m island the closest two stretches of the lap that are
   * not the same stretch (172 m of arc apart: the south run and the
   * return west out of the esses) are 12.6 m apart centre to centre.
   * A 14 m track therefore OVERLAPS ITSELF by 1.4 m there. Eleven and
   * a half is the widest that leaves any gap at all; ten leaves 2.6 m
   * of grass between the kerbs.
   *
   * It is not a narrower track in the way that matters, either. The
   * tightest corner on the relaxed centreline is 11.4 m, so the inner
   * kerb runs at 6.4 m — WIDER than the 5.9 m the 14 m track had at
   * 380 x 285 — and 10 m is 5.9 car widths, which is what a real
   * circuit gives a car this size.
   */
  width: 10,
  /** One lap. The old track was 546 m and asked for two; this one is
   *  633 m with twenty-four corners, and two laps of it is a
   *  commitment nobody asked for. */
  laps: 1,
  /**
   * What a good lap looks like, in seconds — the SPEED DEMON bar.
   *
   * MEASURED, not guessed, and re-measured twice: once after the island
   * shrank to 70% and again after the TNT crates and the timber chicane
   * went onto the racing surface. `scripts/world-race-drive.mjs` drives
   * the lap at three paces and got 52.3 s careful, 47.6 s normal and
   * 37.3 s on the boost. Forty-six is inside a normal lap and outside a
   * careful one: a driver who uses the straights, threads the crates
   * and does not run wide at the esses gets it, and a cruise does not.
   */
  targetLapSeconds: 46,
  /** Checkpoints per lap. Twenty-four is one every 40 m — the old
   *  twelve were 45 m apart on a track with a third of the corners,
   *  and on this one they would leave the esses uncovered. */
  gates: 24,
  points: RACE_LINE.map(([x, z]) => [x, z] as [number, number]),
  /**
   * Elevation along the lap, as [position 0..1, metres above the
   * natural ground]. Kept under 2.5 m: the top-down silhouette has to
   * stay the thing you recognise, and the corridor carries the ground
   * around it up as well — at 3.4 the shoulder met a bank at
   * thirty-four degrees and `world-shore-check.mjs` called it a wall.
   *
   * The crest is on the north loop, so the descent out of it runs
   * downhill into the west run; the dip is in the middle of that run,
   * which makes its far end a blind entry.
   */
  elevation: [
    [0.00, 0.0], [0.10, 0.5], [0.20, 1.2], [0.30, 1.5], [0.40, 0.9],
    [0.52, -0.5], [0.64, -0.8], [0.76, 0.2], [0.88, 0.7], [1.00, 0.0],
  ] as [number, number][],
  /** The jump, as a position along the lap. On the south run. */
  jumpAt: 0.60,
}

/** Height the circuit is raised above the natural ground at `t` (0..1). */
export function circuitElevation(t: number): number {
  const keys = CIRCUIT.elevation
  const u = ((t % 1) + 1) % 1
  for (let i = 1; i < keys.length; i++) {
    if (u > keys[i][0]) continue
    const [a, ha] = keys[i - 1]
    const [b, hb] = keys[i]
    const k = (u - a) / Math.max(1e-6, b - a)
    return ha + (hb - ha) * k * k * (3 - 2 * k)
  }
  return 0
}

/** The circuit spline in world coordinates, closed. Terrain flattens a
 *  corridor along it and the ecology keeps off it; both need the same
 *  line, so it lives here with the rest of the geography. */
export const CIRCUIT_TRACK: [number, number][] = [
  ...CIRCUIT.points.map(([x, z]) => [x, z] as [number, number]),
  [CIRCUIT.points[0][0], CIRCUIT.points[0][1]],
]

/* ============================================================
   WATER
   ============================================================ */

/**
 * Sea level. The ground falls away past the coast as -(over*0.12)^1.7,
 * so this number decides how wide the beach is: at -6 the waterline sat
 * twenty-four metres out and the island wore a dead sandy ring. At -2.5
 * the shore is about ten metres, which is a beach rather than a margin.
 */
export const OCEAN_LEVEL = -2.5

/**
 * The two lakes the drawing puts inside and beside the circuit, each
 * built from overlapping ellipses because the drawn shapes are blobby
 * and every consumer here — the terrain carve, the water surfaces, the
 * river's lake-discard shader — wants ellipses.
 *
 * Shallow on purpose (§17): 2.6 m at the deepest with a wadeable
 * shelf, so a car that goes in can come back out.
 */
export const LAKE_BODIES = [
  { id: 'lake-west', label: 'the west lake', level: -0.7, depth: 2.6, ellipses: LAKE_WEST },
  { id: 'lake-south', label: 'the south lake', level: -0.65, depth: 2.4, ellipses: LAKE_SOUTH },
] as const

/** Flat list, for the carve and the occupancy registry. `Water.ts`
 *  builds one surface per BODY, not one per ellipse — five overlapping
 *  transparent planes at the same level is five times the z-fighting. */
export const LAKES = LAKE_BODIES.flatMap((body) =>
  body.ellipses.map((e, i) => ({ id: `${body.id}-${i}`, body: body.id, ...e, level: body.level, depth: body.depth })),
)

/**
 * How wide a bank is, in metres, on every piece of inland water.
 *
 * This is also the distance the water's influence REACHES past its
 * mapped edge, and the two have to be the same number. They were not:
 * the blend ran over 3.5 m but `inlandWater` stopped answering at
 * 1.18 lake radii — about 2 m out — so the bank was truncated a third
 * of the way down and every lake wore a ring cliff up to 5.7 m high.
 */
export const BANK_WIDTH = 8

/** The landing river: the drawing's central water, running west-south-west
 *  to east-north-east across the top of the LANDING, with the bridge over
 *  it.
 *
 *  FORDABLE, which is a claim with a number behind it. It said "fordable
 *  at 1.5 m" and it was not: the car floats off its wheels at about
 *  1.1 m, so anything that stopped in the middle of the river had
 *  nothing to push against and could only be fished out by the
 *  drowning rule — `world-water-drive.mjs` failed the eastern ford on
 *  every run. At 0.95 m the wheels are still on the bed the whole way
 *  across, which is what the brief asks of every piece of water on
 *  this island: drive in, drive through, drive out. The bridge stays
 *  the sensible crossing because fording is slow, not because the
 *  alternative is drowning. */
export const RIVER = {
  width: RIVER_WIDTH,
  level: -0.7,
  depth: 0.95,
  points: RIVER_LINE.map(([x, z]) => [x, z] as [number, number]),
}

/**
 * CROSSINGS, not decorations.
 *
 * One bridge, where the drawing draws one: a brown ladder across the
 * river on the road between the LANDING and SOCIAL. `road` is the id in
 * `world.ts`; `rotation` is the yaw of the deck's long axis, which is
 * the road's own tangent at the water.
 */
const BRIDGE_ROAD = 'landing_bridge_social'

/**
 * Where a road meets the middle of the river, and which way it is
 * pointing when it does.
 *
 * The bridge used to stand on the drawing's own `bridge` zone with the
 * drawing's own rotation, four metres and seven degrees off the road
 * it carries. The deck is 9.1 m wide, so the road's centreline ran
 * 0.35 m inside the downstream edge: a car following it crossed with
 * one set of wheels over the water and every tour of the island put it
 * in the river at least once. A bridge is not a decoration that
 * happens to be near a road — it IS the road, over the water.
 */
function riverCrossing(road: readonly (readonly [number, number])[]): { x: number; z: number; rotation: number } {
  let best = { x: road[0][0], z: road[0][1], rotation: 0, distance: Infinity }
  for (let i = 1; i < road.length; i++) {
    const [ax, az] = road[i - 1]
    const [bx, bz] = road[i]
    const steps = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5))
    for (let step = 0; step <= steps; step++) {
      const t = step / steps
      const x = ax + (bx - ax) * t
      const z = az + (bz - az) * t
      const distance = lineDistance(x, z, RIVER.points)
      if (distance >= best.distance) continue
      best = { x, z, rotation: Math.atan2(bz - az, bx - ax), distance }
    }
  }
  // The deck is symmetric, so the tangent's SENSE does not matter — but
  // the plan drew the bridge one way round and the map legend and the
  // planking both follow `rotation`, so keep it on the plan's side.
  let rotation = best.rotation
  while (rotation - ZONES.bridge.rotation > Math.PI / 2) rotation -= Math.PI
  while (ZONES.bridge.rotation - rotation > Math.PI / 2) rotation += Math.PI
  return { x: best.x, z: best.z, rotation }
}

const BRIDGE_AT = riverCrossing(PATHS.find((p) => p.id === BRIDGE_ROAD)!.points)

export const BRIDGES = [
  {
    x: BRIDGE_AT.x, z: BRIDGE_AT.z,
    // Twenty-two metres. The river is 12.8 m wide on a 266 m island and
    // the road crosses it at 67°, so the span needed is 13.9; the deck
    // used to be thirty and reached into the physical name's ground by
    // six metres once everything moved closer together.
    length: 22, width: ZONES.bridge.width,
    kind: 'wood' as const,
    rotation: BRIDGE_AT.rotation,
    road: BRIDGE_ROAD.replace(/_/g, '-'),
    level: 1.0,
  },
] as const

/* ============================================================
   VENUES
   ============================================================ */

/** `flat` is the radius of ground a spot levels under itself, for the
 *  venues that build one continuous surface — a bowling lane laid over
 *  rolling ground has its pins underground at one end. */
export const PLAY_SPOTS = [
  /*
    The lane runs east→west with the pins at the west end, as drawn.
    `rotation` is the venue's yaw: local −Z (down-lane) becomes world
    −X. The spot is the venue's ORIGIN — the pin deck is 3.6 m west of
    it and the mark 34 m east — not its middle, because everything in
    Bowling.ts is an offset from this point.

    `pad` is the ground it levels, and it is a RECTANGLE. The venue is
    62 m long and 12 wide; a disc big enough to contain it levels
    fourteen thousand square metres of the north coast, and a disc
    small enough not to leaves the apron hanging off the end of the
    flattening. That was a real defect: the venue's drive-up sat
    outside every clearance the rest of the world respected.
  */
  {
    /*
      MOVED, NOT JUST SCALED. At 0.7 the naively scaled origin puts the
      pad's two north corners 1.7 m and 2.4 m OUT TO SEA and its
      south-west corner 4.4 m from the racing line, because the pad is
      a built dimension and did not shrink with the coast that has to
      contain it. Twelve metres east and eight south buys 12 m of coast
      at every corner and 20 m of clearance from the track.

      The radius is 26, not 44. Forty-four was a disc that reached the
      SOCIAL plate and silently deleted all seventeen of its props at
      placement time — the single largest cause of the island reading
      as empty. The venue is 12 m wide; 26 covers it and its forecourt
      and nothing else.
    */
    id: 'bowling', label: 'BOWLING', x: -6.2, z: -71, radius: 26, rotation: Math.PI / 2,
    pad: { x: 8.8, z: -71, length: 74, width: 30, rotation: 0 },
    /* What stands here is 12 m wide; the pad is 30 because the skirt
       and the forecourt have to be levelled too. Nine metres is the
       venue plus its apron — see the note in `world-layout.ts`. */
    footprint: 9,
  },
  /* Beside the circuit's west run, on the infield verge. One venue,
     two things to do in it: the stack is the place and TNT DOMINO is
     the challenge played there. */
    /*
    On the verge between the west straight and the west lake, which is
    twenty metres wide. The stack has to be beside the racing line
    without being in it and without being in the water, so it runs
    ALONG the verge rather than across it — eighteen crates laid three
    abreast and six deep, on a pad that is 15 m across and 26 long.

    Laid out the other way round, as nine abreast, the row was thirty
    metres wide: its west end stood on the racing surface and its east
    end was three metres under the lake.
  */
  {
    /*
      +6, AND NARROWER. The verge between the west straight and the
      west lake is 15 m wide on a 266 m island: the racing line runs at
      x -117.6 and lake-west-0's west edge is at -96.3. A 15 m pad
      does not fit between them at any offset — at +8 its west edge is
      on the racing surface and at +17 its east end is three metres
      under the lake.

      Twelve across and twenty-four along, centred at -104.1: 2.6 m of
      grass to the kerb and 1.7 m to the water. The crate stack is laid
      along it, not across it.
    */
    /*
      +1.7 AND SIX WIDE, MEASURED AGAINST THE VERGE THAT EXISTS.

      At +7.5 the pad's east edge was 0.2 m from lake-west-0's mapped
      water and sat inside its bank, which the carve is allowed to win
      — so 1.63 m of the quarry's floor was a lake bank, and no
      ordering could have saved it. Walked at two-metre intervals, the
      gap between the circuit's inner kerb and that water now runs
      8.4 m at its narrowest (z 22) and 13.8 m at its widest.

      Where in that gap is set by the occupancy registry rather than by
      the middle of it: the circuit reserves `width/2 + 3.4` = 8.4 m
      either side of the racing line, so the venue's own footprint has
      to start beyond that. At the midpoint it overlapped by 2.6 m.
      +3.6 puts the stack 11.1 m from the centreline, clear of the
      reservation, and still 0.8 m short of the water at the pinch.
    */
    id: 'tnt', label: 'TNT', x: ZONES.tnt.x + 3.6, z: ZONES.tnt.z, radius: 7, footprint: 2,
    pad: { x: ZONES.tnt.x + 3.6, z: ZONES.tnt.z, length: 24, width: 6, rotation: Math.PI / 2 },
    game: 'domino' as const,
  },
  /*
    MOVED 2.8 m AND SHRUNK, BETWEEN A LAKE AND A LABYRINTH.

    At (46, 62) the venue had 3.0 m of ground before lake-south-1's
    bank, so a `flat` of 11 reached 8.8 m into water the carve is
    allowed to win — that is the whole of its 2.08 m of relief. There
    is more room to the east and it runs out quickly: the labyrinth's
    pad is a 47.8 m square whose west edge is x 55.1, and a venue
    centred at (52, 64) put its core inside it, which simply traded a
    lake for a maze floor. (48, 64) has 5.8 m of clear ground before
    the lake and 7.1 m before the maze pad, so a 6.5 m disc — core
    5.5 m — is the largest that touches neither.
  */
  { id: 'timeMachine', label: 'TIME MACHINE', x: ZONES.timeMachine.x, z: ZONES.timeMachine.z, radius: 6.5, flat: 6.5 },
  /* Inside the circuit's north loop. The pull is an interaction, not a
     force field over the racing surface. */
  { id: 'blackHole', label: 'BLACK HOLE', x: ZONES.blackHole.x, z: ZONES.blackHole.z, radius: 11 },
  /*
    THE LABYRINTH LEVELS ITS OWN FLOOR, and it does it with a RECTANGLE
    rather than the district plate it used to rely on.

    A plate is a disc: to hold a 46 m square dead flat to its corners
    it would have to be 41 across, which then ramps for a further 22 m
    and paves out to 63 — a bald circle a quarter of the island wide.
    A pad is the square itself plus a margin, and it is applied after
    the roads, which is what stops the approach cutting a step into it.

    This is the brief's "el suelo del laberinto debe ser recto": inside
    the walls the ground does not move at all.
  */
  {
    id: 'maze', label: 'LABYRINTH', x: ZONES.maze.x, z: ZONES.maze.z, radius: 21,
    /* The walls plus a metre. The pad levels three metres more than
       that on each side so the ground outside the hedge is flat too,
       and reserving the levelling as if it were structure pushed the
       east ramp's safety margin — not its deck — into a conflict. */
    footprint: ZONES.maze.size / 2 + 1,
    pad: { x: ZONES.maze.x, z: ZONES.maze.z, length: ZONES.maze.size + 6, width: ZONES.maze.size + 6, rotation: 0 },
  },
  /*
    THE APPROACH, as a venue of its own.

    The strip in front of the mouth is the one piece of ground a
    visitor MUST cross to use the labyrinth, and it was outside every
    footprint the registry knew about: the decoration pass laid a
    lantern, a rack and a run of pennants across it, and
    `world-polish-qa` — which drops the car fourteen metres out, as it
    always has — landed on the pile and could not move.

    A second entry rather than a taller maze pad, because a rectangle
    is centred: growing the square northwards by the twelve metres the
    approach needs also pulls its south edge two metres inside the
    maze's own back wall. Both roads end inside this one, which is the
    pairing the registry expects of a road arriving at a venue.
  */
  {
    id: 'mazeApproach', label: 'LABYRINTH APPROACH',
    x: ZONES.maze.x, z: ZONES.maze.z - ZONES.maze.size / 2 - 10,
    radius: 11, footprint: 10,
    pad: {
      x: ZONES.maze.x, z: ZONES.maze.z - ZONES.maze.size / 2 - 10,
      length: 24, width: 24, rotation: 0,
      /* Levelled to the LABYRINTH'S floor, not to its own centre. The
         ground rises 3.4 m over the twelve metres in front of the
         mouth, and a pad that holds that height puts a step across the
         threshold: measured, the mouth zone sat 3.39 m above the maze's
         centre and the entrance prompt floated 4.9 m up. */
      level: [ZONES.maze.x, ZONES.maze.z] as const,
    },
  },
] as const

/* ============================================================
   VEGETATION

   The drawing's green masses, and the places nothing may grow.
   ============================================================ */

export interface VegetationZone {
  id: string
  x: number
  z: number
  rx: number
  rz: number
  /** Relative to 1. The drawing's darker greens are denser. */
  density: number
  /** A mass big enough for `SceneryDetails` to furnish a clearing in. */
  clearing: boolean
}

export const VEGETATION_ZONES: VegetationZone[] = VEGETATION.map((v) => ({
  ...v,
  clearing: Math.min(v.rx, v.rz) >= 20,
}))

/**
 * Where procedural planting is forbidden, over and above the occupancy
 * registry's own rules. These are AREAS, not corridors: a polygon here
 * suppresses trees, scatter AND the GPU lawn inside it.
 *
 * The track, the paths, the bridge and the water are handled by their
 * own zones; what needs saying explicitly is the built ground the
 * drawing leaves white — the landing forecourt, the bowling precinct,
 * the projects terrace, the maze floor.
 */
export const VEGETATION_EXCLUSIONS: { id: string; polygon: Poly }[] = [
  { id: 'landing', polygon: ellipse(ZONES.landing.x, ZONES.landing.z, ZONES.landing.rx, ZONES.landing.rz) },
  /* Follows the venue's own pad. It was left at (-11, -112.6) when the
     island shrank and the alley moved, which put the grass suppression
     forty-two metres north of the precinct: the lanes grew turf and an
     empty stretch of coast was scrubbed bare. */
  { id: 'bowling', polygon: rectangle(8.8, -71, 80, 34, 0) },
  { id: 'projects', polygon: ellipse(ZONES.projects.x, ZONES.projects.z, ZONES.projects.rx + 4, ZONES.projects.rz + 4) },
  { id: 'social', polygon: ellipse(ZONES.social.x, ZONES.social.z, ZONES.social.rx, ZONES.social.rz) },
  { id: 'maze', polygon: rectangle(ZONES.maze.x, ZONES.maze.z, ZONES.maze.size + 8, ZONES.maze.size + 8, ZONES.maze.rotation) },
  { id: 'achievements', polygon: ellipse(ZONES.achievements.x, ZONES.achievements.z, ZONES.achievements.rx + 3, ZONES.achievements.rz + 3) },
  { id: 'ramp', polygon: rectangle(ZONES.ramp.x, ZONES.ramp.z, ZONES.ramp.length + 40, ZONES.ramp.width + 14, ZONES.ramp.rotation) },
  { id: 'timeMachine', polygon: ellipse(ZONES.timeMachine.x, ZONES.timeMachine.z, 15, 15) },
  { id: 'blackHole', polygon: ellipse(ZONES.blackHole.x, ZONES.blackHole.z, 14, 14) },
]

function ellipse(x: number, z: number, rx: number, rz: number, steps = 20): Poly {
  const out: [number, number][] = []
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    out.push([x + Math.cos(a) * rx, z + Math.sin(a) * rz])
  }
  return out
}

function rectangle(x: number, z: number, length: number, width: number, rotation: number): Poly {
  const c = Math.cos(rotation)
  const s = Math.sin(rotation)
  const hl = length / 2
  const hw = width / 2
  return ([[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]] as [number, number][])
    .map(([dx, dz]) => [x + dx * c - dz * s, z + dx * s + dz * c] as [number, number])
}

/** True inside any suppression polygon. */
export function vegetationSuppressed(x: number, z: number): boolean {
  for (const zone of VEGETATION_EXCLUSIONS) if (pointInPolygon(x, z, zone.polygon)) return true
  return false
}

/** Legacy tuple shape, for the four consumers that destructure
 *  `[x, z, radius]`. Elliptical masses collapse to their mean radius. */
export const FOREST_POCKETS: readonly (readonly [number, number, number])[] =
  VEGETATION_ZONES.map((v) => [v.x, v.z, (v.rx + v.rz) / 2] as const)

/* ============================================================
   HELPERS
   ============================================================ */

export function lineDistance(x: number, z: number, points: readonly (readonly number[])[]): number {
  /*
    A ZERO-LENGTH SEGMENT IS A POINT, NOT A DIVISION BY ZERO.

    `((x-a)·d) / (d·d)` is NaN when a segment has no length, `Math.min`
    with NaN is NaN, and the whole function then returns NaN for the
    rest of the polyline. That is not theoretical: the occupancy
    registry describes a venue's pad as a capsule between two points,
    and a SQUARE pad puts both of them in the same place. The
    labyrinth's pad and its approach were both invisible to `isFree`
    and to `validateLayout` — the decoration pass laid a run of pallets
    across the only way into the maze and every check reported clean.

    One point is also all a single-point list has, which is why the
    loop no longer starts at 1.
  */
  if (!points.length) return Infinity
  let best = Math.hypot(x - points[0][0], z - points[0][1])
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const lengthSq = dx * dx + dz * dz
    if (lengthSq <= 0) {
      best = Math.min(best, Math.hypot(x - a[0], z - a[1]))
      continue
    }
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / lengthSq))
    best = Math.min(best, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t))
  }
  return best
}

/**
 * How far PAST a polyline's ends a point lies, measured along the
 * terminal segments' own outward tangents. Zero anywhere beside the
 * line; positive only beyond the first or last vertex.
 *
 * `lineDistance` measures to a CAPSULE — the segments plus a round cap
 * at each end — and for a river that is wrong in a way that cost this
 * island four blockers. `RIVER_LINE` starts and finishes inland, so
 * both caps sit on dry ground, and every consumer that treated
 * "within N metres of the river" as "beside the river" was in fact
 * painting a half-disc of riverbank onto a hillside. The east cap
 * alone projected a 28.4 m disc of "flatten to 0.80 m" across the
 * PROJECTS plate and the three roads at its junction, and reached the
 * toe of the east ramp twenty metres further on.
 *
 * A capsule is still the right shape for asking "how close is the
 * water". This is the second question — "and am I actually alongside
 * it" — which the round cap cannot answer.
 */
export function polylineOverrun(x: number, z: number, points: readonly (readonly number[])[]): number {
  if (points.length < 2) return 0
  const beyond = (from: readonly number[], toward: readonly number[]) => {
    const dx = from[0] - toward[0]
    const dz = from[1] - toward[1]
    const length = Math.hypot(dx, dz)
    if (length <= 0) return 0
    // Positive when the point is further out than `from` along the
    // direction that leaves the line.
    return ((x - from[0]) * dx + (z - from[1]) * dz) / length
  }
  return Math.max(
    0,
    beyond(points[0], points[1]),
    beyond(points[points.length - 1], points[points.length - 2]),
  )
}

/** Cubic ease, clamped. The same curve `Terrain` blends every stage with. */
function ease(v: number, a: number, b: number): number {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * How much river there is at a point, 0..1, as a function of how far
 * past the drawn ends it lies. Six metres, because the carve is what
 * digs the bed: faded over any less and the bed ends in a step, over
 * any more and the dry trench at each terminus comes back.
 */
export const RIVER_END_FADE = 6

export function riverPresence(x: number, z: number): number {
  return 1 - ease(polylineOverrun(x, z, RIVER.points), 0, RIVER_END_FADE)
}

export function inlandWater(x: number, z: number): { level: number; depth: number; edge: number; flow: number } | null {
  let region: { level: number; depth: number; edge: number; flow: number } | null = null
  for (const lake of LAKES) {
    /*
      ONE BANK WIDTH PAST THE EDGE, IN METRES.

      This read `1 + BANK_WIDTH / min(rx, rz)` and compared it against
      a NORMALISED radius, which is not a distance: on lake-west-0
      (13.8 x 9.6) the eight-metre bank spanned 11.5 m of ground to the
      west, and on lake-west-2 (12.8 x 6.4) it spanned 16.0. The verge
      between the circuit's inner kerb and this lake is 4.8 m wide at
      its narrowest, so an over-long bank did not merely overhang the
      TNT quarry's pad — it covered it, and the carve is the one stage
      that is deliberately allowed to win.

      `edge` keeps its meaning: negative outside the water, and how far
      in once inside, both in metres.
    */
    const ux = (x - lake.x) / lake.rx
    const uz = (z - lake.z) / lake.rz
    const radius = Math.hypot(ux, uz)
    const gradient = radius > 0 ? Math.hypot(ux / lake.rx, uz / lake.rz) / radius : 1 / Math.min(lake.rx, lake.rz)
    const outward = gradient > 0 ? (radius - 1) / gradient : 0
    if (outward < BANK_WIDTH) {
      const candidate = { level: lake.level, depth: lake.depth, edge: -outward, flow: 0.16 }
      // Overlapping ellipses make one body: the deepest point wins, so
      // the seam between two of them is water, not a bar across it.
      if (!region || candidate.edge > region.edge) region = candidate
    }
  }
  const distance = lineDistance(x, z, RIVER.points)
  /*
    The river NARROWS AND SHALLOWS past its drawn ends rather than
    stopping at a round cap. `presence` is 1 along the whole drawn
    length and eases to 0 six metres beyond either terminus, so the bed
    finishes as a bed finishes instead of as a disc — see
    `polylineOverrun` for the four blockers the disc was causing.
  */
  const presence = riverPresence(x, z)
  const half = (RIVER.width / 2) * presence
  if (presence > 0 && distance < half + BANK_WIDTH) {
    const river = { level: RIVER.level, depth: RIVER.depth * presence, edge: half - distance, flow: 1 }
    // Unite the beds at confluences. A lake's outer bank must not dam a river
    // whose centreline continues through it.
    const depth = (w: typeof river) => {
      const t = Math.max(0, Math.min(1, w.edge / (w.flow > 0.9 ? 6 : 11)))
      return w.edge < 0 ? w.edge : w.depth * Math.pow(t * t * (3 - 2 * t), 1.9)
    }
    if (!region || depth(river) > depth(region)) region = river
  }
  return region
}

export { ISLAND, ISLET, LANDMASSES, MAP_DEPTH, MAP_WIDTH, PATHS, ZONES, pointInPolygon }
