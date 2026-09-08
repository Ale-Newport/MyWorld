import {
  districts, districtById, landmarks, ramps, respawns, roads,
  timelinePlates, WORLD_RADIUS,
} from './world'
import {
  BRIDGES, CIRCUIT, CIRCUIT_TRACK, FOREST_POCKETS, LAKES, PLAY_SPOTS,
  RELAY_POINTS, RIVER, WATERFALL, coastRadius, inlandWater, lineDistance,
} from './world-environment'

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
  /** Elliptical footprints (lakes). Overrides `radius` when present. */
  rx?: number
  rz?: number
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
    monument: 2.6, sign: 1.2, billboard: 5.4, browserTower: 4.6,
    device: 6.5, idCard: 5.2, graphSculpture: 7, processBlocks: 6,
    cipherWall: 7.4, databaseTower: 4, moduleStack: 4.4,
    // The corpus is 24 m of instanced pillars with NO colliders — you
    // drive through it. Its footprint is what it stands on, not what
    // it covers, or it would sterilise a third of the AI Lab.
    researchShell: 7, dataField: 5, chessboard: 9, orderBook: 8,
    station: 5, gate: 9.5, island: 9, terminal: 2.4, duck: 1.6,
    bracket: 4,
  }
  return (base[visual] ?? 4) * scale
}

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
  out.push({ id: 'water-waterfall', kind: 'water', x: WATERFALL.x, z: WATERFALL.z, radius: 15, label: 'the waterfall' })

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
    // A ramp needs its run-up kept clear as well as its lip.
    out.push({ id: `ramp-${r.id}`, kind: 'ramp', x: r.x, z: r.z, radius: r.length * 0.5 + 6, label: r.id })
  }

  for (const l of landmarks) {
    out.push({ id: `landmark-${l.id}`, kind: 'landmark', x: l.x, z: l.z, radius: landmarkFootprint(l.visual, l.scale ?? 1), label: l.label })
  }

  for (const p of PLAY_SPOTS) {
    // `flat` is the ground it levels; `radius` is where its game
    // starts. Whichever is larger is the ground it owns.
    out.push({ id: `play-${p.id}`, kind: 'play', x: p.x, z: p.z, radius: Math.max(p.radius, 'flat' in p ? p.flat : 0), label: p.label })
  }

  for (const r of respawns) {
    out.push({ id: `respawn-${r.id}`, kind: 'respawn', x: r.x, z: r.z, radius: 7, label: r.id })
  }
  for (const [x, z] of RELAY_POINTS) {
    out.push({ id: `relay-${x}-${z}`, kind: 'play', x, z, radius: 8, label: 'relay point' })
  }
  for (const p of timelinePlates) {
    out.push({ id: `timeline-${p.year}`, kind: 'landmark', x: p.x, z: p.z, radius: 4, label: `${p.year} plate` })
  }

  // The physical name. Two rows of letters at the hub; the extent is
  // read from LETTERS so shrinking them shrinks the reserved ground.
  const letters = lettersOrigin()
  out.push({
    id: 'letters', kind: 'letters',
    x: letters.x, z: letters.z,
    radius: Math.max(LETTERS.widthAlejandro, LETTERS.widthNewport) * 0.5 + 4,
    label: 'ALEJANDRO NEWPORT',
  })

  for (const [x, z, r] of FOREST_POCKETS) {
    out.push({ id: `forest-${x}-${z}`, kind: 'forest', x, z, radius: r, soft: true, label: 'woodland' })
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

const LETTER_SIZE = 3.9
const GLYPH_PITCH = 0.72

export const LETTERS = {
  /** Height of a capital, metres. Was 5.2; the brief asks for 70–80%. */
  size: LETTER_SIZE,
  /** Vertical gap between the two rows, metres. */
  rowPitch: LETTER_SIZE * 1.44,
  /** How far north of the hub centre the two rows are set. */
  offsetZ: -5.7,
  widthAlejandro: 9 * LETTER_SIZE * GLYPH_PITCH * 1.2,
  widthNewport: 7 * LETTER_SIZE * GLYPH_PITCH * 1.2,
} as const

/** Where the letters actually stand. Resolved lazily — `world.ts`
 *  imports this module, so nothing here may read its exports at
 *  module-evaluation time. */
export function lettersOrigin(): { x: number; z: number } {
  return { x: districtById.hub.x, z: districtById.hub.z + LETTERS.offsetZ }
}

/* ------------------------------------------------------------
   QUERIES
   ------------------------------------------------------------ */

function distanceToZone(zone: Zone, x: number, z: number): number {
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
   * Footprints that are not in the registry yet. A generator placing
   * fifteen towers one after another passes the ones it has already
   * placed, or they all find the same piece of free ground.
   */
  extra?: readonly Zone[]
}

const SOFT: ZoneKind[] = ['district', 'forest']

/**
 * The zone blocking this point, or null if the ground is free.
 * One function, used by the ecology scatter, the scenery details,
 * the tower and island generators and the layout validator — so a
 * rule fixed here is fixed everywhere.
 */
export function blockedBy(x: number, z: number, rules: PlacementRules = {}): Zone | null {
  const clearance = rules.clearance ?? 0
  const allow = new Set<ZoneKind>([...SOFT, ...(rules.allow ?? [])])

  if (Math.hypot(x, z) > coastRadius(x, z, WORLD_RADIUS) - (rules.coastMargin ?? 8)) {
    return { id: 'coast', kind: 'water', x, z, radius: 0, label: 'the sea' }
  }
  if (rules.dry !== false) {
    const water = inlandWater(x, z)
    if (water && water.edge > -clearance - 1) {
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
    if (Math.hypot(px, pz) > coastRadius(px, pz, WORLD_RADIUS) - 12) {
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
    // The waterfall is the head of the river; RIVER RUN is played in it.
    if (a.kind === 'water' && b.kind === 'water') return true
    if (both.has('water') && both.has('play')) return true
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
      if (a.points && b.points) {
        gap = Infinity
        for (const [x, z] of a.points) gap = Math.min(gap, distanceToZone(b, x, z) - a.radius)
      } else if (a.points) {
        gap = distanceToZone(a, b.x, b.z) - b.radius
      } else if (b.points) {
        gap = distanceToZone(b, a.x, a.z) - a.radius
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
    if (Math.hypot(r.x, r.z) > coastRadius(r.x, r.z, WORLD_RADIUS) - 6) {
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
