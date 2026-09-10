import {
  districts, districtById, landmarks, ramps, respawns, roads, timelinePlates,
} from './world'
import {
  BRIDGES, CIRCUIT, CIRCUIT_TRACK, LAKES, PLAY_SPOTS, RIVER,
  VEGETATION_EXCLUSIONS, VEGETATION_ZONES, coastInset, inlandWater, lineDistance,
} from './world-environment'
import { ZONES, pointInPolygon, polygonEdgeDistance, type Poly } from './world-map'

/* ============================================================
   WHAT IS WHERE

   The island's geography is authored in two files — `world.ts`
   for the built environment and `world-environment.ts` for the
   natural one — and until this module existed, THREE separate
   copies of "may something be placed here?" were written against
   them, with three different sets of numbers:

     Ecology.ts          coast −10, track +5,  play spot +clearance
     SceneryDetails.ts   coast −6,  track +0,  play spot +0
     world.ts            play spots only, and half-broken

   They disagreed, so a rule fixed in one place stayed broken in
   the others. The visible results were a client tower standing in
   four metres of Mirror Lake, two monuments 1.8 m apart, grass
   growing down the racing line and a respawn point inside a wall.

   This module is the one answer. Every feature on the island
   declares a FOOTPRINT here — the ground it actually occupies,
   as opposed to the radius it is discoverable from — and
   everything that places something asks `occupancy` whether the
   ground is free.

   It is deliberately data, not rendering: it imports from
   `content/`, is imported by the world builders, and holds no
   THREE.js. That is what lets `validateLayout()` run the same
   checks in a test, in a script and at dev-time boot.
   ============================================================ */

/** What a footprint belongs to. Placement rules are written per kind. */
export type ZoneKind =
  /** A district's built plate: paving, a board, a slab of asphalt. */
  | 'plate'
  /** A district's discovery disc. Soft: things may stand inside it. */
  | 'district'
  /** A road corridor, including its shoulder. */
  | 'road'
  /** The racing surface and its kerbs. */
  | 'circuit'
  /** A lake, the river, or the sea. */
  | 'water'
  /** A bridge deck and its approaches. */
  | 'bridge'
  /** A ramp, plus the run-up a car needs to use it. */
  | 'ramp'
  /** A built landmark's physical extent — not its trigger radius. */
  | 'landmark'
  /** A mini-game venue that owns its ground. */
  | 'play'
  /** Where the car is put down. Must stay clear. */
  | 'respawn'
  /** The physical letters at the hub. */
  | 'letters'
  /** Woodland. Soft: this is where vegetation is WANTED. */
  | 'forest'
  /**
   * Built ground nothing may GROW on: the landing forecourt, the
   * bowling precinct, the maze floor.
   *
   * Soft, and it has to be. It deliberately covers roads, venues and
   * respawns — that is the point of it — so a hard `noveg` zone
   * reported every one of them as a collision and told
   * `validateRespawns` that the spawn point was inside something. It
   * suppresses vegetation and nothing else: `Ecology` asks for it by
   * name through `vegetationSuppressed`, and the GPU lawn reads the
   * same polygons out of the terrain mask.
   */
  | 'noveg'

export interface Zone {
  id: string
  kind: ZoneKind
  /** Centre, for circles and for reporting. */
  x: number
  z: number
  /**
   * Occupied radius in metres for a circular footprint, or the
   * half-width of the corridor for a `points` footprint.
   */
  radius: number
  /** A corridor footprint: distance is measured to this polyline. */
  points?: readonly (readonly number[])[]
  /** Elliptical footprints (lakes, woodland). Overrides `radius`. */
  rx?: number
  rz?: number
  /** A CLOSED filled area: inside is blocked, outside measures to the
   *  edge. `points` is a corridor; this is a region. */
  polygon?: Poly
  /**
   * Soft zones overlap freely and are excluded from
   * `validateLayout`'s conflict report. A district disc is soft; the
   * plate inside it is not.
   */
  soft?: boolean
  /** Human label for warnings. */
  label?: string
}

/* ------------------------------------------------------------
   FOOTPRINTS
   Sizes here are the ground a thing OCCUPIES. Where the data
   already carries a footprint (a district's `plate`, a play
   spot's `flat`) it is used directly; where it carries only a
   trigger radius, the physical extent is estimated from the
   builder that draws it — see `landmarkFootprint`.
   ------------------------------------------------------------ */

/**
 * How much ground a landmark's geometry stands on, in metres.
 * `Landmark.radius` is the distance from which ENTER works, which
 * on a monument is 7 m and on the thing itself is about 2 — using
 * the trigger radius as a footprint sterilised the ground around
 * every landmark in the world and still let two of them be built
 * on top of each other.
 */
export function landmarkFootprint(visual: string, scale = 1): number {
  const base: Record<string, number> = {
    monument: 2.6, sign: 1.2, billboard: 5.4, idCard: 5.2,
    island: 9, terminal: 2.4, bracket: 4,
    /*
      A GATE IS A HOLE. It stands on two 1.1 m posts sixteen metres
      apart and the middle of it is the thing you drive through — which
      is the whole point of a start line and a maze mouth. As a 9.5 m
      disc every road that arrived at one was reported as running into
      it, and the fix would have been to stop the roads short of the
      gates they exist to reach.
    */
    gate: 3.2,
    // The camera is a head on a tripod: three legs on a 4.4 m spread.
    camera: 4.4,
    // A star on a plinth, and the plinth is what stands on the ground.
    trophy: 4.6,
    // The event horizon ring, not the pull radius.
    singularity: 7,
  }
  return (base[visual] ?? 4) * scale
}

/**
 * The labyrinth's real extent, kept in step with `Labyrinth.ts` by
 * hand — there is no way to import it without pulling THREE.js into
 * the content layer. `CELLS * CORRIDOR + (CELLS + 1) * WALL`.
 *
 * The drawing puts a SQUARE maze in the south-east corner, so it is
 * five by five cells of 7 m corridor now rather than five by three of
 * 9.4 — 42.2 m on a side, against 54 x 33.
 */
/*
  THE LABYRINTH'S FOOTPRINT, and the second of three places this number
  is written down.

  `Labyrinth.ts` computes it from CELLS x CORRIDOR + (CELLS + 1) x WALL
  and `ZONES.maze.size` carries it through the map emitter's hold-list.
  All three must say 46. This copy is what keeps roads from being
  routed through the maze, and it has been wrong before: the registry
  reported the labyrinth as a 30 m disc, the road network was authored
  straight through it, and the only symptom was a car stopping dead
  against a wall nobody had modelled.
*/
export const MAZE = { width: 7 * 4.6 + 8 * 1.2, depth: 7 * 4.6 + 8 * 1.2 }

let cache: Zone[] | null = null

/** Every footprint on the island. Built once, then reused. */
export function zones(): Zone[] {
  if (cache) return cache
  const out: Zone[] = []

  for (const d of districts) {
    out.push({ id: `district-${d.id}`, kind: 'district', x: d.x, z: d.z, radius: d.radius, soft: true, label: d.label })
    if (d.plate) {
      // The plate is paved out to `plate * 1.55` in the ground mask
      // (Terrain.buildMask), so that is the ground it actually owns.
      out.push({ id: `plate-${d.id}`, kind: 'plate', x: d.x, z: d.z, radius: d.plate * 1.25, label: `${d.label} plate` })
    }
  }

  for (const r of roads) {
    out.push({ id: `road-${r.id}`, kind: 'road', x: r.points[0][0], z: r.points[0][1], radius: r.width * 0.5 + 1.6, points: r.points, label: r.id })
  }

  out.push({
    id: 'circuit-track', kind: 'circuit',
    x: CIRCUIT.x, z: CIRCUIT.z,
    radius: CIRCUIT.width * 0.5 + 3.4,
    points: CIRCUIT_TRACK, label: 'race circuit',
  })

  for (const lake of LAKES) {
    out.push({ id: `water-${lake.id}`, kind: 'water', x: lake.x, z: lake.z, radius: Math.max(lake.rx, lake.rz), rx: lake.rx, rz: lake.rz, label: lake.id })
  }
  out.push({ id: 'water-river', kind: 'water', x: RIVER.points[0][0], z: RIVER.points[0][1], radius: RIVER.width * 0.5, points: RIVER.points, label: 'the river' })

  for (const b of BRIDGES) {
    // A corridor, not a disc. A forty-metre deck modelled as a
    // twenty-five-metre circle claims a thousand square metres of
    // ground it does not stand on, and reported every venue within
    // reach of its middle as a collision.
    const dx = Math.cos(b.rotation) * b.length * 0.5
    const dz = Math.sin(b.rotation) * b.length * 0.5
    out.push({
      id: `bridge-${b.road}`, kind: 'bridge', x: b.x, z: b.z,
      radius: b.width * 0.5 + 2,
      points: [[b.x - dx, b.z - dz], [b.x + dx, b.z + dz]],
      label: `${b.kind} bridge`,
    })
  }

  for (const r of ramps) {
    /*
      A RAMP NEEDS ITS RUN-UP KEPT CLEAR AS WELL AS ITS LIP, and a run-up
      is a corridor rather than a disc.

      As a disc of `length/2 + 6` this reserved 21 m around the east
      ramp — which is its own deck and nothing else. The twenty-two
      metres of approach in front of it, the only ground from which the
      jump can be taken at speed, was open to everything: the
      decoration pass put crates and bales across it and `world-qa`
      measured anything between 2.5 m and 5.5 m of air off the same
      5.6 m ramp depending on what the car had hit on the way in.

      A capsule from 11 m before the foot to the lip, as wide as the
      deck plus a margin, is what the sentence above always meant.
      Eleven and not more because the east ramp's approach crosses
      the LANDING: at 24 the corridor reached the physical name, the
      projects terminal and the river, and a reservation that has to
      move a district is a reservation that is wrong.
    */
    const cos = Math.cos(r.rotation)
    const sin = Math.sin(r.rotation)
    const lip = [r.x + cos * (r.length / 2), r.z - sin * (r.length / 2)] as [number, number]
    /*
       ELEVEN METRES, AND IT IS ALL THERE IS.

       Twenty is what the car needs to reach this deck at speed from a
       standing start — measured, 11 m of run-up rises 2.5 m off the
       east ramp and 20 m rises 4.8 — but twenty does not fit: the
       capsule then reaches the PROJECTS terminal by 3.1 m and the
       river by 2.4. A player arrives along `landing-ramp` already
       moving, so eleven metres of RESERVED ground is enough to keep
       the decoration pass off the approach; it is not enough to
       accelerate from rest, which is a fact about the harness's
       starting conditions rather than about the ramp.
    */
    const RUN_UP = 11
    const start = [r.x - cos * (r.length / 2 + RUN_UP), r.z + sin * (r.length / 2 + RUN_UP)] as [number, number]
    out.push({
      id: `ramp-${r.id}`, kind: 'ramp', x: r.x, z: r.z,
      radius: r.width / 2 + 4, points: [start, lip], label: r.id,
    })
  }

  for (const l of landmarks) {
    out.push({
      id: `landmark-${l.id}`, kind: 'landmark', x: l.x, z: l.z,
      radius: landmarkFootprint(l.visual, l.scale ?? 1),
      // A gate is soft: it is two posts with a hole between them, and
      // the road that reaches it is meant to go through it.
      soft: l.visual === 'gate',
      label: l.label,
    })
  }

  /*
    THE MAZE. Declared here rather than left to the district's plate,
    because it is far bigger than that plate: five by three cells of
    9.4 m corridor separated by 1.2 m walls is 54 x 33 m of solid
    static geometry, and the plate is 24. Without this the registry
    reported the LABYRINTH as a thirty-metre disc, the road network was
    authored straight through it, and the only thing that ever noticed
    was a car stopping dead against a wall nobody had modelled.
  */
  /*
    THE LABYRINTH REGISTERS ITSELF THROUGH ITS PLAY SPOT NOW.

    This stood a second footprint on the maze, hand-built from `MAZE`,
    because the spot's own pad was invisible: `lineDistance` returned
    NaN for the degenerate capsule a SQUARE pad produces, so every
    check quietly skipped it. With that fixed the pad is the footprint,
    and two overlapping copies of the same 42 m square is not a
    conflict worth reporting forty-four metres of. `MAZE` stays
    exported: the generator and the map emitter still have to agree
    with it.
  */

  for (const p of PLAY_SPOTS) {
    if ('pad' in p && p.pad) {
      // A RECTANGLE, because the bowling venue is one: 62 m of lane and
      // apron in a 12 m corridor. Registered as a disc it claimed a
      // 44 m circle centred on a point 15 m from its own middle — so
      // the apron sat outside every clearance in the world, and the
      // prop scatter dropped crates on it.
      const cos = Math.cos(p.pad.rotation)
      const sin = Math.sin(p.pad.rotation)
      const hx = (p.pad.length / 2 - p.pad.width / 2) * cos
      const hz = (p.pad.length / 2 - p.pad.width / 2) * sin
      /*
        THE FOOTPRINT IS WHAT STANDS THERE, NOT WHAT IS LEVELLED.

        This took the capsule's radius from the levelling pad, and a pad
        is deliberately larger than its venue: the bowling alley is 12 m
        wide and its pad is 30, so the registry claimed a 15 m capsule
        down the whole 74 m of it. That single disc is what deleted all
        seventeen of SOCIAL's scattered props — the neighbouring
        district, forty metres away — and forced the SOCIAL dressing to
        carry a negative play margin to build anything at all.

        A spot may state its own `footprint`; otherwise the pad's half
        width stands, which is right for the venues whose structures
        fill their pad (the labyrinth's walls do).
      */
      /*
        A SQUARE PAD IS A SQUARE, NOT THE DISC INSIDE IT.

        `hx` and `hz` are both identically zero when length equals
        width, so the capsule collapses to a point and the footprint
        becomes a bare disc of `radius`. The labyrinth is a 47.8 m
        square: registered that way it claimed a 23.9 m circle, leaving
        9.9 m of every corner unreserved — 490 m2 of ground the world
        believed was empty and which is in fact full of hedge.

        Everything that consults the registry then placed things there.
        Four crates and two barrels ended up standing inside maze
        corridors, and the WEATHER LEVER's fixed 2.4 x 1.8 m plinth
        landed in the west corridor on the only route to the centre —
        which made the labyrinth impossible to finish. An autopilot
        driving the solution stopped dead against it and never got past
        waypoint 14 of 84.

        So a pad whose sides are within a metre of each other is
        emitted as its four rotated corners, and `distanceToZone`'s
        polygon branch — which already exists for the vegetation
        exclusions — measures to the region rather than to a circle.
      */
      const square = Math.abs(p.pad.length - p.pad.width) < 1
      const corner = (a: number, b: number): [number, number] => [
        p.pad.x + a * cos - b * sin,
        p.pad.z + a * sin + b * cos,
      ]
      /* And the square is the VENUE, not the levelling pad — the same
         distinction the capsule branch above makes. The labyrinth's pad
         is its 41.8 m of walls plus a 3 m levelling margin either side;
         reserving the margin as if it were hedge pushes everything that
         has to stand near the maze three metres further out for no
         reason. A spot that states a `footprint` states the half-extent
         of what actually stands there. */
      const stated: number | undefined = 'footprint' in p ? p.footprint : undefined
      const pad = p.pad
      const hl = square && stated !== undefined ? stated : pad.length / 2
      const hw = square && stated !== undefined ? stated : pad.width / 2
      out.push({
        id: `play-${p.id}`, kind: 'play', x: p.pad.x, z: p.pad.z,
        // A polygon IS the footprint, so it carries no radius of its
        // own: `distanceToZone` subtracts `radius` from the polygon's
        // edge distance, and a square that also declared 23.9 m would
        // be a square inflated by 23.9 m in every direction.
        radius: square ? 0 : stated !== undefined ? stated : pad.width / 2,
        ...(square
          ? { polygon: [corner(-hl, -hw), corner(hl, -hw), corner(hl, hw), corner(-hl, hw)] as Poly }
          : { points: [[p.pad.x - hx, p.pad.z - hz], [p.pad.x + hx, p.pad.z + hz]] as [number, number][] }),
        label: p.label,
      })
      continue
    }
    // `flat` is the ground it levels; `radius` is where its game
    // starts. Whichever is larger is the ground it owns.
    out.push({ id: `play-${p.id}`, kind: 'play', x: p.x, z: p.z, radius: Math.max(p.radius, 'flat' in p ? p.flat : 0), label: p.label })
  }

  for (const r of respawns) {
    out.push({ id: `respawn-${r.id}`, kind: 'respawn', x: r.x, z: r.z, radius: 7, label: r.id })
  }
  /*
    THE YEAR PLATES ARE PAINT, AND PAINT IS SOFT.

    `World.buildTimeline` draws each one as a 6 m PlaneGeometry lying on
    the ground at y + 0.05 with `depthWrite: false` and no collider at
    all — you drive over them, and driving over them in order is what
    unlocks TIME TRAVELLER. Registering them hard meant the registry
    reported a road running over a decal as a defect and the only
    available fix was to move the decal off the road the visitor is
    supposed to be driving when they hit it.
  */
  for (const p of timelinePlates) {
    out.push({ id: `timeline-${p.year}`, kind: 'landmark', soft: true, x: p.x, z: p.z, radius: 4, label: `${p.year} plate` })
  }

  // The physical name. Two rows of letters at the hub; the extent is
  // read from LETTERS so shrinking them shrinks the reserved ground.
  const letters = lettersOrigin()
  out.push({
    id: 'letters', kind: 'letters',
    x: letters.x, z: letters.z,
    radius: Math.max(LETTERS.widthAlejandro, LETTERS.widthNewport) * 0.5 + 3,
    // An ELLIPSE. Two rows of capitals are 30 m across and 12 deep; as
    // a disc the name claimed a nineteen-metre circle and reported the
    // bridge road, which passes eight metres north of the top row, as
    // standing inside it.
    rx: Math.max(LETTERS.widthAlejandro, LETTERS.widthNewport) * 0.5 + 3,
    rz: LETTERS.rowPitch + LETTERS.size * 0.5 + 3,
    label: 'ALEJANDRO NEWPORT',
  })

  // The drawing's green masses, as ellipses. Soft: this is where
  // vegetation is WANTED, so nothing is kept out of them.
  for (const v of VEGETATION_ZONES) {
    out.push({
      id: `forest-${v.id}`, kind: 'forest', x: v.x, z: v.z,
      radius: Math.max(v.rx, v.rz), rx: v.rx, rz: v.rz,
      soft: true, label: 'woodland',
    })
  }

  // …and the built ground the drawing leaves white, which nothing may
  // grow on. These are regions, not corridors: a polygon traced with
  // `points` would only exclude a ribbon along its outline.
  for (const zone of VEGETATION_EXCLUSIONS) {
    out.push({
      id: `noveg-${zone.id}`, kind: 'noveg', soft: true,
      x: zone.polygon.reduce((t, p) => t + p[0], 0) / zone.polygon.length,
      z: zone.polygon.reduce((t, p) => t + p[1], 0) / zone.polygon.length,
      radius: 0, polygon: zone.polygon, label: `${zone.id} (no planting)`,
    })
  }

  cache = out
  return out
}

/* ------------------------------------------------------------
   THE PHYSICAL NAME
   Its size used to be a `5.2` written twice inside Playground.ts,
   with the `scale` on its own landmark ignored. It lives here now
   because the terrain flattens under it, the ecology keeps off it
   and the map draws it — three files that all need the same
   number.
   ------------------------------------------------------------ */

/*
  3.1 m, down from 3.9.

  The name is 9 characters on the top row: at 3.9 it reserves a 33 m
  ellipse, which on a 266 m island reaches the river's near bank, the
  bridge deck, the landing respawn AND the road-ramp respawn all at
  once. Everything else on the island lost 30%; the letters lose 20%,
  which is enough to fit and still leaves each capital taller than the
  car is long.
*/
/** How far beyond a ramp's deck nothing else may stand. It is a
 *  clearance, not a structure — see the `play+ramp` rule below. */
const RAMP_CLEARANCE = 4

const LETTER_SIZE = 3.1
const GLYPH_PITCH = 0.72

export const LETTERS = {
  /** Height of a capital, metres. Was 5.2; the brief asks for 70–80%. */
  size: LETTER_SIZE,
  /** Vertical gap between the two rows, metres. */
  rowPitch: LETTER_SIZE * 1.44,
  /** Where the two rows stand, straight out of the plan. */
  x: ZONES.nameLetters.x,
  z: ZONES.nameLetters.z,
  widthAlejandro: 9 * LETTER_SIZE * GLYPH_PITCH * 1.2,
  widthNewport: 7 * LETTER_SIZE * GLYPH_PITCH * 1.2,
} as const

/** Where the letters actually stand. Resolved lazily — `world.ts`
 *  imports this module, so nothing here may read its exports at
 *  module-evaluation time. */
export function lettersOrigin(): { x: number; z: number } {
  return { x: LETTERS.x, z: LETTERS.z }
}

/* ------------------------------------------------------------
   QUERIES
   ------------------------------------------------------------ */

function distanceToZone(zone: Zone, x: number, z: number): number {
  if (zone.polygon) {
    const edge = polygonEdgeDistance(x, z, zone.polygon)
    return (pointInPolygon(x, z, zone.polygon) ? -edge : edge) - zone.radius
  }
  if (zone.points) return lineDistance(x, z, zone.points) - zone.radius
  if (zone.rx && zone.rz) {
    // Distance to an ellipse, approximated by scaling to a circle.
    const nx = (x - zone.x) / zone.rx
    const nz = (z - zone.z) / zone.rz
    const n = Math.hypot(nx, nz)
    return (n - 1) * Math.min(zone.rx, zone.rz)
  }
  return Math.hypot(x - zone.x, z - zone.z) - zone.radius
}

export interface PlacementRules {
  /** Extra metres of space the thing being placed needs. */
  clearance?: number
  /** Kinds to ignore entirely. */
  allow?: readonly ZoneKind[]
  /** Per-kind extra margin on top of `clearance`. */
  margin?: Partial<Record<ZoneKind, number>>
  /** Keep this far inside the coastline. Defaults to 8 m. */
  coastMargin?: number
  /** Reject anywhere the ground is under water. Defaults true. */
  dry?: boolean
  /**
   * How far back from a waterline `dry` reaches, in metres. Small on
   * purpose: reeds and willows belong ON the bank, and scaling this
   * with `clearance` — which is what it used to do — pushed the whole
   * ecology four metres inland of every lake and river on the island.
   */
  shore?: number
  /**
   * Footprints that are not in the registry yet. A generator placing
   * fifteen towers one after another passes the ones it has already
   * placed, or they all find the same piece of free ground.
   */
  extra?: readonly Zone[]
}

/*
  Kinds nothing is ever kept out of. `noveg` belongs here: it is a
  planting mask that deliberately covers the forecourt, the bowling
  precinct and the maze floor, so treating it as an obstacle reported
  every road, venue and spawn point inside it as a collision — and told
  `validateRespawns` the LANDING spawn was standing in something.
  `Ecology` asks for it by name instead, through `vegetationSuppressed`.
*/
const SOFT: ZoneKind[] = ['district', 'forest', 'noveg']

/**
 * The zone blocking this point, or null if the ground is free.
 * One function, used by the ecology scatter, the scenery details,
 * the tower and island generators and the layout validator — so a
 * rule fixed here is fixed everywhere.
 */
export function blockedBy(x: number, z: number, rules: PlacementRules = {}): Zone | null {
  const clearance = rules.clearance ?? 0
  const allow = new Set<ZoneKind>([...SOFT, ...(rules.allow ?? [])])

  if (coastInset(x, z) < (rules.coastMargin ?? 8)) {
    return { id: 'coast', kind: 'water', x, z, radius: 0, label: 'the sea' }
  }
  if (rules.dry !== false) {
    const water = inlandWater(x, z)
    if (water && water.edge > -(rules.shore ?? 0.8)) {
      return { id: 'inland-water', kind: 'water', x, z, radius: 0, label: 'inland water' }
    }
  }

  for (const zone of zones()) {
    if (allow.has(zone.kind)) continue
    const margin = rules.margin?.[zone.kind] ?? 0
    if (distanceToZone(zone, x, z) < clearance + margin) return zone
  }
  for (const zone of rules.extra ?? []) {
    const margin = rules.margin?.[zone.kind] ?? 0
    if (distanceToZone(zone, x, z) < clearance + margin) return zone
  }
  return null
}

/** Convenience wrapper: is this ground free? */
export function isFree(x: number, z: number, rules?: PlacementRules): boolean {
  return blockedBy(x, z, rules) === null
}

/**
 * Push a point out of whatever it is standing in, radially away
 * from `fromX, fromZ`. Deterministic, and it reports failure rather
 * than returning a point that is still blocked — the generator it
 * replaces silently gave up after twelve passes and shipped the
 * result anyway, which is how a client tower ended up in a lake.
 */
export function pushClear(
  x: number, z: number, fromX: number, fromZ: number,
  rules: PlacementRules = {}, step = 5, passes = 40,
): { x: number; z: number; clear: boolean } {
  let px = x
  let pz = z
  for (let pass = 0; pass < passes; pass++) {
    if (!blockedBy(px, pz, rules)) return { x: px, z: pz, clear: true }
    const dx = px - fromX
    const dz = pz - fromZ
    const length = Math.hypot(dx, dz) || 1
    px += (dx / length) * step
    pz += (dz / length) * step
    // Past the coast, walk back INWARDS instead: there is nothing
    // further out to find.
    if (coastInset(px, pz) < 12) {
      px = x
      pz = z
      step = -Math.abs(step)
    }
  }
  return { x: px, z: pz, clear: false }
}

/**
 * Walk a ring around `fromX, fromZ` looking for free ground at
 * roughly `radius`. Used by the generated towers and islands, which
 * need a spot near their district rather than a spot pushed to the
 * far side of the island.
 */
export function findNear(
  fromX: number, fromZ: number, radius: number, preferredAngle: number,
  rules: PlacementRules = {},
): { x: number; z: number; clear: boolean } {
  // Sweep either side of the authored bearing first, then in and out
  // by a few metres at a time. A generated tower should end up as near
  // to where it was authored as the ground allows — pushed to the far
  // side of the island it stops belonging to its district, which is
  // the failure this replaces.
  let best: { x: number; z: number; depth: number } | null = null
  for (const growth of [0, 5, -5, 10, -10, 16, 22]) {
    const r = radius + growth
    if (r < 10) continue
    for (let step = 0; step < 32; step++) {
      const sweep = (Math.ceil(step / 2) * (step % 2 ? 1 : -1) * Math.PI * 2) / 32
      const angle = preferredAngle + sweep
      const x = fromX + Math.cos(angle) * r
      const z = fromZ + Math.sin(angle) * r
      const blocker = blockedBy(x, z, rules)
      if (!blocker) return { x, z, clear: true }
      // Remember the shallowest intrusion, so a crowded district gets
      // a tower squeezed into the tightest gap rather than exiled.
      const depth = Math.max(0, (rules.clearance ?? 0) - distanceToZone(blocker, x, z))
      if (!best || depth < best.depth) best = { x, z, depth }
    }
  }
  return best
    ? { x: best.x, z: best.z, clear: false }
    : { x: fromX + Math.cos(preferredAngle) * radius, z: fromZ + Math.sin(preferredAngle) * radius, clear: false }
}

/* ------------------------------------------------------------
   VALIDATION
   ------------------------------------------------------------ */

export interface LayoutConflict {
  a: string
  b: string
  overlap: number
  message: string
}

/**
 * Every pair of hard footprints that overlap. Run at dev-time boot
 * and by `scripts/world-layout-check.mjs`; a conflict here is a
 * thing you can see from the car.
 */
export function validateLayout(): LayoutConflict[] {
  const conflicts: LayoutConflict[] = []
  const hard = zones().filter((z) => !z.soft)

  /**
   * Pairs that are SUPPOSED to touch. A district's plate exists so
   * that a road can arrive on it and a ramp can stand on it; a
   * bridge exists to be on the water and on the road at once. What
   * is left after these are removed is the list of things that are
   * standing on each other by accident.
   */
  const expected = (a: Zone, b: Zone): boolean => {
    const kinds = [a.kind, b.kind].sort().join('+')
    const both = new Set([a.kind, b.kind])
    // Everything a district's own paving is paved FOR.
    if (both.has('plate') && !both.has('water')) return true
    // Two water zones are one body of water where they meet.
    if (a.kind === 'water' && b.kind === 'water') return true
    // A bridge is the crossing: it is on the water and on the road.
    if (both.has('bridge') && (both.has('water') || both.has('road') || both.has('ramp'))) return true
    // …and a road may cross water WHERE A BRIDGE CARRIES IT. Anywhere
    // else, a road in the water is exactly the defect this reports.
    if (both.has('road') && both.has('water')) {
      const road = a.kind === 'road' ? a : b
      const id = road.id.replace(/^road-/, '')
      return BRIDGES.some((br) => br.road === id)
    }
    // Roads meet roads, carry ramps, and cross the circuit at the link.
    if (kinds === 'road+road' || kinds === 'ramp+road' || kinds === 'circuit+road') return true
    // The circuit's own ramp and kerb furniture stand on it.
    if (kinds === 'circuit+ramp' || kinds === 'circuit+landmark') return true
    // A respawn is deliberately put on the road into its district.
    if (kinds === 'respawn+road' || kinds === 'circuit+respawn') return true
    // A venue contains its own entrance landmark and its own respawn.
    if (kinds === 'landmark+play' || kinds === 'play+respawn') return true
    /*
      ONE VENUE MAY BE TWO RECTANGLES. The labyrinth levels its square
      and, separately, the twelve metres of approach in front of its
      mouth, because a rectangle is centred and growing the square
      northwards pulls its south edge inside the back wall. They touch
      by construction; `mazeApproach` names its parent.
    */
    if (a.kind === 'play' && b.kind === 'play') {
      const ids = [a.id.replace(/^play-/, ''), b.id.replace(/^play-/, '')]
      if (ids[0].startsWith(ids[1]) || ids[1].startsWith(ids[0])) return true
    }
    /*
      A ROAD MAY ARRIVE AT A VENUE, and only arrive.

      A venue you cannot drive to is not a venue: the spur to the maze
      ends at its mouth, which is six metres outside a forty-two-metre
      square of solid wall, and the bowling road ends on the apron. But
      a road that crosses a venue in the MIDDLE is the defect this
      check exists for — a carriageway down the bowling lane — so the
      exemption is exactly "one of the road's ends is in there".
    */
    /*
      A RAMP'S SAFETY MARGIN MAY TOUCH A VENUE; ITS DECK MAY NOT.

      A ramp registers as a capsule of `width / 2 + 4` — the deck plus
      four metres of "do not put anything here", which is a clearance,
      not a structure. Measured, `ramp-landing`'s deck clears the
      labyrinth's hedge by 2.2 m and only its margin reaches inside, and
      there is nowhere else on the island for it: every alternative site
      walked at three-metre spacing either drops the run-up below six
      metres of coast inset or lands it in something already built.

      So an overlap no deeper than that margin passes, and an overlap
      deeper than it — a deck actually inside a venue — still fails.
    */
    if (kinds === 'play+ramp') {
      const ramp = a.kind === 'ramp' ? a : b
      const venue = a.kind === 'ramp' ? b : a
      const deck = ramp.radius - RAMP_CLEARANCE
      const ends = ramp.points ? ramp.points : [[ramp.x, ramp.z] as [number, number]]
      return ends.every(([x, z]) => distanceToZone(venue, x, z) > deck)
    }
    if (kinds === 'play+road') {
      const road = a.kind === 'road' ? a : b
      const venue = a.kind === 'road' ? b : a
      const ends = road.points ? [road.points[0], road.points[road.points.length - 1]] : []
      return ends.some(([x, z]) => distanceToZone(venue, x, z) < road.radius)
    }
    /*
      A ROAD MAY ARRIVE AT A LANDMARK, and only arrive.

      The same rule as `play+road` above and for the same reason: the
      road to PROJECTS ends at the PROJECTS terminal, the road out of
      SOCIAL starts at the camera, and reporting those as defects means
      the fix is to stop every road short of the thing it exists to
      reach. A road that passes a landmark in the MIDDLE is still a
      road running through a signpost, and is still reported.
    */
    if (kinds === 'landmark+road') {
      const road = a.kind === 'road' ? a : b
      const mark = a.kind === 'road' ? b : a
      const ends = road.points ? [road.points[0], road.points[road.points.length - 1]] : []
      return ends.some(([x, z]) => distanceToZone(mark, x, z) < road.radius)
    }
    // The name is a playground: roads run to it and it is meant to be hit.
    if (both.has('letters') && (both.has('road') || both.has('ramp') || both.has('landmark'))) return true
    return false
  }

  /** Below this, two footprints are touching rather than colliding. */
  const TOLERANCE = 0.75

  for (let i = 0; i < hard.length; i++) {
    for (let j = i + 1; j < hard.length; j++) {
      const a = hard[i]
      const b = hard[j]
      if (expected(a, b)) continue
      // Corridor-to-corridor needs a sampled test; centre distance
      // means nothing for two polylines.
      let gap: number
      const aPath = a.points ?? a.polygon
      const bPath = b.points ?? b.polygon
      if (aPath && bPath) {
        gap = Infinity
        for (const [x, z] of aPath) gap = Math.min(gap, distanceToZone(b, x, z) - a.radius)
      } else if (a.points) {
        gap = distanceToZone(a, b.x, b.z) - b.radius
      } else if (b.points) {
        gap = distanceToZone(b, a.x, a.z) - a.radius
      } else if (a.rx || b.rx) {
        // One of them is an ELLIPSE. Centre distance minus two radii is
        // wrong for a shape whose radius depends on the bearing: the
        // physical name is 36 m across and 21 deep, and as a 21 m disc
        // it reported the bridge road — which passes ten metres north
        // of the top row — as standing inside it.
        const [oval, other] = a.rx ? [a, b] : [b, a]
        gap = distanceToZone(oval, other.x, other.z) - other.radius
      } else {
        gap = Math.hypot(a.x - b.x, a.z - b.z) - a.radius - b.radius
      }
      if (gap < -TOLERANCE) {
        conflicts.push({
          a: a.id, b: b.id, overlap: -gap,
          message: `${a.label ?? a.id} (${a.kind}) intersects ${b.label ?? b.id} (${b.kind}) by ${(-gap).toFixed(1)} m`,
        })
      }
    }
  }
  return conflicts.sort((p, q) => q.overlap - p.overlap)
}

/** Every respawn point that would put the car somewhere unusable. */
export function validateRespawns(): string[] {
  const problems: string[] = []
  for (const r of respawns) {
    const water = inlandWater(r.x, r.z)
    if (water && water.edge > -2) problems.push(`respawn ${r.id} is in the water`)
    if (coastInset(r.x, r.z) < 6) {
      problems.push(`respawn ${r.id} is past the coastline`)
    }
    const blocker = blockedBy(r.x, r.z, {
      clearance: 3,
      allow: ['respawn', 'road', 'plate', 'circuit', 'bridge', 'play', 'ramp', 'letters'],
      coastMargin: 6,
    })
    if (blocker) problems.push(`respawn ${r.id} is inside ${blocker.label ?? blocker.id}`)
    if (r.district) {
      const d = districtById[r.district]
      const distance = Math.hypot(r.x - d.x, r.z - d.z)
      // A respawn is deliberately put on the ROAD into a district, which
      // for a small district is a little way outside its disc. Twelve
      // metres is about a road's width plus a car; past that it is in
      // the wrong place.
      if (distance > d.radius + 12) {
        problems.push(`respawn ${r.id} is ${(distance - d.radius).toFixed(1)} m outside ${d.label}, which it claims to serve`)
      }
    }
  }
  return problems
}

/** Clears the memoised zone list. For tests that mutate the data. */
export function resetLayoutCache(): void {
  cache = null
}
