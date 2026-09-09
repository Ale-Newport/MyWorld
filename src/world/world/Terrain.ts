import * as THREE from 'three'
import { palette } from '../core/palette'
import { clamp, seeded, smoothstep } from '../core/maths'
import type { Bin } from '../core/Disposal'
import type { Quality } from '../core/Quality'
import type { Physics } from '../physics/Physics'
import type { Materials } from './materials'
import { districts, ramps, roads, WORLD_RADIUS, type District } from '@/content/world'
import { inlandWater, coastRadius, circuitElevation, CIRCUIT, CIRCUIT_TRACK, FOREST_POCKETS, BRIDGES, PLAY_SPOTS, OCEAN_LEVEL, BANK_WIDTH, LAKES } from '@/content/world-environment'

/* ============================================================
   TERRAIN

   Approach adapted from sources/Game/Terrain.js + World/Floor.js
   (folio-2025, MIT — Copyright (c) 2025 Bruno Simon), which
   drives a Rapier heightfield from a texture. Here the height
   comes from a pure function instead, which has one large
   advantage: `heightAt(x, z)` is available to every other system
   — landmark placement, prop scattering, the map, the minimap
   marker — so nothing has to raycast just to find the ground.

   THE RULE: the collider and the visible mesh are generated from
   the same function at the same resolution. If they ever diverge,
   the car drives through the floor in one place and floats in
   another, and that is the single worst bug this route can have.
   Visual detail is reduced by quality; the COLLIDER NEVER IS.

   Layout, top-down (+X east, +Z south):
     - a compact island, ~320 m across, sized so the next thing
       worth driving to is always close
     - macro landform — a wooded ridge north, a valley, coastal
       dunes — over gentle rolling noise for the suspension
     - only districts with a BUILT footprint flattened to a plate
     - roads cut flat corridors between them
     - past `WORLD_RADIUS` the ground falls away into the void,
       which is both the map edge and the OUT OF BOUNDS achievement
   ============================================================ */

/** Collider resolution. Identical at every quality level. With
 *  `FIELD_HALF` at 290 this is a 1.51 m cell — the same order as the
 *  reference's 1.5 m heightfield, and finer than the 2.5 m it was. */
const COLLIDER_SEGMENTS = 384
/** Half-width of the heightfield, metres. It has to reach past
 *  `WORLD_RADIUS` far enough to carry the void island, or the island
 *  renders with no collider under it and the jump lands in nothing. */
const FIELD_HALF = 290

const rand = seeded(20260908)
/** Four octaves of value noise, precomputed offsets. */
const OCTAVES = Array.from({ length: 4 }, () => ({
  ox: rand() * 1000,
  oz: rand() * 1000,
}))

function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123
  return s - Math.floor(s)
}

function valueNoise(x: number, z: number): number {
  const xi = Math.floor(x)
  const zi = Math.floor(z)
  const xf = x - xi
  const zf = z - zi
  const u = xf * xf * (3 - 2 * xf)
  const v = zf * zf * (3 - 2 * zf)

  const a = hash2(xi, zi)
  const b = hash2(xi + 1, zi)
  const c = hash2(xi, zi + 1)
  const d = hash2(xi + 1, zi + 1)

  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

function fbm(x: number, z: number): number {
  let amplitude = 1
  let frequency = 1
  let sum = 0
  let norm = 0
  for (const octave of OCTAVES) {
    sum += valueNoise(x * frequency + octave.ox, z * frequency + octave.oz) * amplitude
    norm += amplitude
    amplitude *= 0.5
    frequency *= 2.1
  }
  return sum / norm
}

/** A smooth, finite bump: 1 at the centre, 0 at `r`, flat at both ends. */
function bump(x: number, z: number, cx: number, cz: number, r: number): number {
  const t = Math.min(1, Math.hypot(x - cx, z - cz) / r)
  const s = 1 - t * t
  return s * s
}

/**
 * Authored landform — the shape of the island as opposed to its
 * texture. Summed BEFORE anything flattens, so district plates, ramp
 * pads and road corridors still cut cleanly into it.
 *
 * Without this the island is a 0.5% grade in every direction, which
 * is the "terrain has little macro variation" complaint: there is
 * nowhere for a forest to climb, nowhere for a river to fall from,
 * and no horizon that changes as you drive.
 */
function landform(x: number, z: number): number {
  let h = 0
  // The north-west highland. The island's high ground and the head of
  // the river: the waterfall needs something real to fall off.
  h += 12 * bump(x, z, -46, -128, 52)
  // A long rise north of the lab, so the northern half is not a plain.
  h += 5 * bump(x, z, 20, -104, 48)
  // The eastern shoulder the circuit is cut into.
  h += 4 * bump(x, z, 116, -50, 52)
  // A shallow basin under the southern ring, so the road has a dip
  // and the lakes have somewhere to sit.
  h -= 2.5 * bump(x, z, 48, 40, 52)
  return h
}

/* ============================================================
   THE SHORE

   The island used to end in a wall. Inland of the coastline the
   ground was lifted 3.2 m by a rim term; one metre further out it
   dropped to -0.5 by a separate formula that knew nothing about
   the rim — so the "beach" was a 3.7 m step at every bearing, and
   at the high north-west it was fifteen. You could not drive onto
   the sand, let alone into the sea.

   These two functions are now the only description of the coast,
   and they meet. `coastalRim` is a DUNE: it rises inland and
   falls back to nothing before the sand starts, which is what
   gives the island a horizon without giving it a parapet.
   `shoreHeight` then takes over and runs, continuously, from dry
   sand through the waterline to the shelf and the drop-off.

   The numbers are chosen so the car can drive it. Dry sand is
   about four degrees, wet sand and the shallows about eleven; the
   shelf sits 0.9 m under the surface, which is wading depth, and
   the bottom does not fall away properly until sixteen metres
   past the waterline. Driving into the sea is meant to be
   something you do on purpose and can reverse out of.
   ============================================================ */

/** Metres inland the coastal dune peaks, and how high. */
const DUNE = { from: 78, peak: 40, fade: 13, height: 3.4 }
/**
 * The beach, as three stages measured from the mapped coastline.
 * `sand` is dry beach; `wade` is the run from the top of the sand down
 * to the waterline; `shelf` is the long shallow shelf beyond it, and
 * `shelfDepth` is how deep the water gets before the bottom falls
 * away. A car floats out of its depth at about 1.1 m, so a shelf of
 * 0.6 is comfortably drivable and the drop past it is not.
 */
const BEACH = { sand: 15, wade: 8, shelf: 15, shelfDepth: 0.6 }

/**
 * The coastal dune, as a function of position. Extracted because
 * SEVEN places in this file re-derived it inline to work out what
 * height a district, a play spot or a ramp should flatten to, and
 * every one of them had to be kept in step by hand.
 */
function coastalRim(x: number, z: number): number {
  const radius = Math.hypot(x, z)
  const coast = coastRadius(x, z, WORLD_RADIUS)
  const rise = smoothstep(radius, coast - DUNE.from, coast - DUNE.peak)
  const fall = 1 - smoothstep(radius, coast - DUNE.peak, coast - DUNE.fade)
  return rise * fall * DUNE.height
}

/**
 * Ground height as a function of distance PAST the coastline —
 * negative inland. Continuous everywhere, including at zero.
 */
function shoreHeight(over: number): number {
  if (over <= 0) {
    // Dry sand, rising gently back towards the land it joins.
    return 0.3 + 1.0 * smoothstep(-over, 0, BEACH.sand)
  }
  const shelf = OCEAN_LEVEL - BEACH.shelfDepth
  if (over < BEACH.wade) {
    // Down to the waterline: 2.8 m over 8, about 19 degrees.
    return 0.3 + (OCEAN_LEVEL - 0.3) * smoothstep(over, 0, BEACH.wade)
  }
  const past = over - BEACH.wade
  if (past < BEACH.shelf) {
    // The shelf. Barely a slope — 0.6 m over fifteen metres — so
    // driving INTO the sea is something you do, and can reverse out of.
    return OCEAN_LEVEL - BEACH.shelfDepth * smoothstep(past, 0, BEACH.shelf)
  }
  // Then away, and quickly enough that going further is a decision.
  return shelf - Math.pow((past - BEACH.shelf) * 0.17, 1.8)
}

/**
 * Nearest point on a polyline, not just the distance to it. A road has
 * to be level ACROSS its width — a corridor that follows the terrain's
 * cross-slope is a camber the car slides down, which is how a straight
 * run-up quietly steers itself off a ramp.
 */
function closestOnPolyline(
  x: number, z: number, points: [number, number][],
  /** Cumulative length to the START of each segment, for `along`. */
  lengths?: { at: number[]; total: number },
): { distance: number; px: number; pz: number; along: number } {
  let best = Infinity
  let bx = points[0][0]
  let bz = points[0][1]
  let along = 0
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i]
    const [cx, cz] = points[i + 1]
    const dx = cx - ax
    const dz = cz - az
    const lengthSq = dx * dx + dz * dz || 1e-6
    const t = clamp(((x - ax) * dx + (z - az) * dz) / lengthSq, 0, 1)
    const px = ax + dx * t
    const pz = az + dz * t
    const distance = Math.hypot(x - px, z - pz)
    if (distance < best) {
      best = distance
      bx = px
      bz = pz
      // Position ALONG the line, 0..1. The circuit's elevation profile
      // is authored against it, so the terrain needs it here and not
      // only the nearest point.
      if (lengths) along = (lengths.at[i] + Math.sqrt(lengthSq) * t) / lengths.total
    }
  }
  return { distance: best, px: bx, pz: bz, along }
}

/** Cumulative arc lengths of a polyline, for `closestOnPolyline`. */
function arcLengths(points: [number, number][]): { at: number[]; total: number } {
  const at = [0]
  let total = 0
  for (let i = 0; i < points.length - 1; i++) {
    total += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1])
    at.push(total)
  }
  return { at, total: total || 1 }
}

const CIRCUIT_LENGTHS = arcLengths(CIRCUIT_TRACK)

/** Distance from a point to a polyline, and the segment parameter. */
function distanceToPolyline(x: number, z: number, points: [number, number][]): number {
  let best = Infinity
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i]
    const [bx, bz] = points[i + 1]
    const dx = bx - ax
    const dz = bz - az
    const lengthSq = dx * dx + dz * dz || 1e-6
    const t = clamp(((x - ax) * dx + (z - az) * dz) / lengthSq, 0, 1)
    const px = ax + dx * t
    const pz = az + dz * t
    const distance = Math.hypot(x - px, z - pz)
    if (distance < best) best = distance
  }
  return best
}

/**
 * The void island itself. It sits PAST `WORLD_RADIUS`, so the edge
 * falloff has to be told to leave it alone — otherwise its far half
 * is shaved off by the drop and a jump that lands two metres long
 * lands in the sea. Being outside the world is the point of it.
 */
const VOID_ISLAND = { x: 20, z: -233, radius: 40 }

/** Elevation of each district's plate. Most sit at zero. */
const DISTRICT_ELEVATION: Partial<Record<string, number>> = {
  lab: -1.4,
  ucl: 1.8,
  kcl: 0.6,
  circuit: 0,
  voxel: 0.9,
  labyrinth: 0.4,
  network: -0.8,
  archive: -0.4,
}

export interface TerrainSample {
  height: number
  /** Nearest district, if the point is inside one. */
  district: District | null
  /** 0..1, how strongly the point sits on a road. */
  road: number
}

/** Resolution of the ground mask. One texel is ~1.1 m at FIELD_HALF 290. */
const MASK_SIZE = 512

export class Terrain {
  readonly group = new THREE.Group()
  mesh!: THREE.Mesh

  /**
   * The ground, as data a shader can read. Adapted from the R/G/B mask
   * `folio-2025` samples in `Terrain.js` (MIT), except that here it is
   * baked from this project's own height/road/water functions rather
   * than authored in an image:
   *
   *   R — paving: roads and built plates
   *   G — grass coverage, which is what the grass field grows from
   *   B — water depth, 0 on land
   *   A — ground height, normalised through `maskHeightBias/Scale`
   *
   * Anything that needs to know what it is standing on reads this
   * instead of re-deriving it.
   */
  readonly mask: THREE.DataTexture
  /** World half-extent the mask covers, metres. */
  readonly maskExtent = FIELD_HALF
  /** `height = mask.a * maskHeightScale + maskHeightBias`. */
  readonly maskHeightBias = -24
  readonly maskHeightScale = 56

  private colliderHeights!: Float32Array
  private step = (FIELD_HALF * 2) / COLLIDER_SEGMENTS

  constructor(
    private physics: Physics,
    private quality: Quality,
    private materials: Materials,
    bin: Bin,
  ) {
    this.mask = this.buildMask()
    bin.add(() => this.mask.dispose())
    this.buildCollider()
    this.buildMesh(bin)
    bin.object3D(this.group)
  }

  /* ========================================================
     HEIGHT FIELD
     ======================================================== */

  /**
   * The ground elevation anywhere in the world. Pure, cheap, and
   * the single source of truth for both the collider and the mesh.
   */
  heightAt(x: number, z: number): number {
    const radius = Math.hypot(x, z)
    const coast = coastRadius(x, z, WORLD_RADIUS)

    const voidDistance = Math.hypot(x - VOID_ISLAND.x, z - VOID_ISLAND.z)
    const onVoidIsland = voidDistance < VOID_ISLAND.radius * 1.2

    if (onVoidIsland) {
      // Flat on top, then a cliff. The cliff IS the moat: there is no
      // walkable slope from the mainland onto this, which is the only
      // reason it stays a secret.
      const edge = 1 - smoothstep(voidDistance, VOID_ISLAND.radius * 0.92, VOID_ISLAND.radius * 1.15)
      return 5 * edge - (1 - edge) * 26
    }

    // Rolling base. Deliberately gentle — the suspension should have
    // something to do, but nothing should launch the car unbidden.
    let height = landform(x, z)
    height += (fbm(x * 0.0042, z * 0.0042) - 0.5) * 2.8
    height += (fbm(x * 0.017, z * 0.017) - 0.5) * 0.55

    // A dune inland of the sand, so the world reads as an island
    // rather than as a rectangle that stops.
    height += coastalRim(x, z)

    // The shore takes over near the edge, and the two are blended
    // across twenty metres so the join is a slope and not a step.
    const over = radius - coast
    const onShore = smoothstep(over, -BEACH.sand - 12, -BEACH.sand + 4)
    if (onShore > 0) height = height * (1 - onShore) + shoreHeight(over) * onShore

    // District plates. Each flattens its BUILT footprint towards its
    // own elevation, with a shoulder so the transition is drivable.
    // Districts without a `plate` are not flattened at all: they sit
    // on the natural ground, which is what stops the map reading as a
    // field of discs.
    for (const district of districts) {
      if (!district.plate) continue
      const distance = Math.hypot(x - district.x, z - district.z)
      const shoulder = district.plate * 0.8 + 22
      if (distance > shoulder) continue
      const inside = 1 - smoothstep(distance, district.plate * 0.8, shoulder)
      // Flatten to the ground the district actually stands on, not to
      // an absolute height. A plate pinned to zero beside raised
      // landform is a cliff, and the car slides off it.
      const target =
        landform(district.x, district.z) +
        (fbm(district.x * 0.0042, district.z * 0.0042) - 0.5) * 2.8 +
        coastalRim(district.x, district.z) +
        (DISTRICT_ELEVATION[district.id] ?? 0)
      height = height * (1 - inside) + target * inside
    }

    // Play spots that build one continuous surface level their own
    // ground, the same way a district plate does.
    for (const spot of PLAY_SPOTS) {
      if (!('flat' in spot) || !spot.flat) continue
      const distance = Math.hypot(x - spot.x, z - spot.z)
      if (distance > spot.flat * 2.2) continue
      const inside = 1 - smoothstep(distance, spot.flat * 0.85, spot.flat * 2.1)
      if (inside <= 0) continue
      const target =
        landform(spot.x, spot.z) +
        (fbm(spot.x * 0.0042, spot.z * 0.0042) - 0.5) * 2.8 +
        coastalRim(spot.x, spot.z)
      height = height * (1 - inside) + target * inside
    }

    // Ramps flatten their own footprint. A forty-metre ramp laid on
    // rolling ground has its low end buried and its lip in the air,
    // and the car hits a step instead of a slope — which is exactly
    // how the jump to the void island failed the first time.
    for (const ramp of ramps) {
      const dx = x - ramp.x
      const dz = z - ramp.z
      // Into the ramp's own frame: +X runs up the slope.
      const cos = Math.cos(ramp.rotation)
      const sin = Math.sin(ramp.rotation)
      const localX = dx * cos - dz * sin
      const localZ = dx * sin + dz * cos

      const halfLength = ramp.length / 2 + 6
      const halfWidth = ramp.width / 2 + 4
      if (Math.abs(localX) > halfLength || Math.abs(localZ) > halfWidth) continue

      const inside =
        (1 - smoothstep(Math.abs(localX), halfLength - 7, halfLength)) *
        (1 - smoothstep(Math.abs(localZ), halfWidth - 4, halfWidth))
      if (inside <= 0) continue

      // The pad sits at the height of the ramp's own centre, which is
      // what its mesh and collider were built against.
      // The pad has to match what the ground around it actually is,
      // rim included. Leave the rim out and the ramp sits in a step:
      // the car hits a wall where it should start climbing.
      const pad =
        landform(ramp.x, ramp.z) +
        (fbm(ramp.x * 0.0042, ramp.z * 0.0042) - 0.5) * 2.8 +
        coastalRim(ramp.x, ramp.z)
      height = height * (1 - inside) + pad * inside
    }

    // The circuit gets the same treatment as a road: a corridor of its
    // own, flattened to the ground it runs over minus the small noise.
    // A racing line that climbs a hill mid-corner is not a racing line.
    {
      const near = closestOnPolyline(x, z, CIRCUIT_TRACK, CIRCUIT_LENGTHS)
      const half = CIRCUIT.width * 0.5
      // Wider than the racing surface, because the elevation profile
      // has to carry the RUN-OFF up with the track — a track raised
      // three metres out of ground that stayed flat is a track on a
      // plinth, with a drop off both kerbs.
      if (near.distance < half * 6) {
        const on = 1 - smoothstep(near.distance, half * 1.15, half * 3)
        const shoulder = 1 - smoothstep(near.distance, half * 2.6, half * 6)
        if (shoulder > 0) {
          // Sampled on the centreline, so the track is flat across.
          const smooth = landform(near.px, near.pz) + (fbm(near.px * 0.0042, near.pz * 0.0042) - 0.5) * 2.8
          // The island's west side is nearly level, so the circuit's
          // gradients are authored rather than found: a crest before
          // the esses, a dip on the west run.
          const profile = circuitElevation(near.along)
          const base = smooth + coastalRim(near.px, near.pz)
          height = height * (1 - shoulder) + (base + profile) * shoulder
          height = height * (1 - on) + (base + profile) * on
        }
      }
    }

    // Roads flatten a corridor between whatever they connect.
    for (const road of roads) {
      const near = closestOnPolyline(x, z, road.points)
      const half = road.width * 0.5
      if (near.distance > half * 3) continue
      const on = 1 - smoothstep(near.distance, half, half * 2.6)
      if (on <= 0) continue
      // The road surface follows the terrain it was flattened onto,
      // just without the small noise, so hills stay but ruts do not.
      // Sampled on the centreline: the surface follows the land along
      // the road but stays level across it.
      const smooth = landform(near.px, near.pz) + (fbm(near.px * 0.0042, near.pz * 0.0042) - 0.5) * 2.8
      let roadHeight = smooth + coastalRim(near.px, near.pz)
      for (const district of districts) {
        if (!district.plate) continue
        const dd = Math.hypot(near.px - district.x, near.pz - district.z)
        const shoulder = district.plate * 0.8 + 22
        if (dd > shoulder) continue
        const inside = 1 - smoothstep(dd, district.plate * 0.8, shoulder)
        const target =
          landform(district.x, district.z) +
          (fbm(district.x * 0.0042, district.z * 0.0042) - 0.5) * 2.8 +
          coastalRim(district.x, district.z) +
          (DISTRICT_ELEVATION[district.id] ?? 0)
        roadHeight = roadHeight * (1 - inside) + target * inside
      }
      height = height * (1 - on) + roadHeight * on
    }

    // Banks are part of the same heightfield as the rest of the island.
    /*
      LAKE APRONS. A lake carved straight into a hillside gets a bank
      that is as steep as the hill: Cold Tarn sits in the north-west
      highland and every one of its four approaches was between 43 and
      65 degrees, which is a bowl the car falls into and cannot climb
      out of. Each lake now eases the ground around itself down towards
      its own waterline over twelve metres before the bank starts, so
      it reads as a tarn in a hollow rather than a hole in a slope.
    */
    for (const lake of LAKES) {
      const normalised = Math.hypot((x - lake.x) / lake.rx, (z - lake.z) / lake.rz)
      const scale = Math.min(lake.rx, lake.rz)
      const reach = 1 + BANK_WIDTH / scale
      const apron = reach + 13 / scale
      if (normalised > apron) continue
      const inside = 1 - smoothstep(normalised, reach, apron)
      height = height * (1 - inside) + (lake.level + 1.5) * inside
    }

    const water = inlandWater(x, z)
    const waterHere = water
    if (water) {
      // The bank runs a full BANK_WIDTH — the same distance
      // `inlandWater` reaches — so it finishes instead of being cut
      // off a third of the way down, which is what left every lake
      // wearing a ring cliff.
      const bank = smoothstep(water.edge, -BANK_WIDTH, 0)
      // Then a WADEABLE SHELF: the depth curve is raised to a power,
      // so the first few metres of water are ankle-deep and only the
      // middle is anything to worry about. At 4 m in a lake is 0.4 m
      // deep; the car drives in and drives out again.
      const reach = water.flow > .9 ? 6 : 11
      const t = smoothstep(water.edge, 0, reach)
      const depth = water.depth * Math.pow(t, 1.9)
      height = height * (1 - bank) + (water.level - depth) * bank
    }
    // A dry, gently joined grotto behind the waterfall curtain.
    if (z < -119 && z > -132 && Math.abs(x + 40) < 8) {
      const dry=(1-smoothstep(Math.abs(x+40),4,8))*(1-smoothstep(Math.abs(z+125.5),3,7))
      height=height*(1-dry)+.2*dry
    }
    // Gradual bridge approaches; the deck is a separate physical surface.
    /*
      BRIDGE APPROACHES.

      Two things were wrong here. The test was written in world X and Z
      — `Math.abs(x - bridge.x)` — so a bridge on any bearing other
      than due east had its approach pads at ninety degrees to itself;
      and the pads blended toward an absolute y = 0.5 wherever they
      landed, INCLUDING inside the water, which is how the modern
      bridge came to punch two sheer 2.93 m plateaus into the middle of
      Mirror Lake.

      Now: measured along the deck's own axis, and faded out over
      water, so an approach ramps the LAND up to the deck and stops at
      the shore.
    */
    for (const bridge of BRIDGES) {
      const cos = Math.cos(bridge.rotation)
      const sin = Math.sin(bridge.rotation)
      const dx = x - bridge.x
      const dz = z - bridge.z
      const along = Math.abs(dx * cos + dz * sin) - bridge.length / 2
      const across = Math.abs(-dx * sin + dz * cos)
      if (along <= -3 || along >= 20 || across >= bridge.width / 2 + 3) continue
      const dry = 1 - smoothstep(waterHere ? waterHere.edge : -99, -BANK_WIDTH, 0)
      if (dry <= 0) continue
      const blend = (1 - smoothstep(along, 0, 20))
        * (1 - smoothstep(across, bridge.width / 2, bridge.width / 2 + 3))
        * dry
      height = height * (1 - blend) + bridge.level * blend
    }
    return height
  }

  /** Full sample, for placement code that also wants context. */
  /** Bakes the R/G/B ground mask once, at construction. */
  private buildMask(): THREE.DataTexture {
    const data = new Uint8Array(MASK_SIZE * MASK_SIZE * 4)
    const span = FIELD_HALF * 2

    for (let j = 0; j < MASK_SIZE; j++) {
      const z = -FIELD_HALF + ((j + 0.5) / MASK_SIZE) * span
      for (let i = 0; i < MASK_SIZE; i++) {
        const x = -FIELD_HALF + ((i + 0.5) / MASK_SIZE) * span

        let paved = 0
        for (const road of roads) {
          const distance = distanceToPolyline(x, z, road.points)
          paved = Math.max(paved, 1 - smoothstep(distance, road.width * 0.42, road.width * 0.72))
        }
        // THE RACING SURFACE. It was missing from this mask entirely,
        // which is why grass grew down the middle of the circuit: the
        // terrain flattened a corridor for it (see `heightAt`) and the
        // ecology kept its scatter off it, but the GPU grass field —
        // the dense one, the one you actually see — had never been
        // told the track was there. Its shoulders are paved a little
        // wider than the tarmac so the kerbs are clear too.
        {
          const distance = distanceToPolyline(x, z, CIRCUIT_TRACK)
          const half = CIRCUIT.width * 0.5
          paved = Math.max(paved, 1 - smoothstep(distance, half + 1.4, half + 3.4))
        }
        for (const district of districts) {
          if (!district.plate) continue
          const distance = Math.hypot(x - district.x, z - district.z)
          // Paving covers the flattened plate, not a smaller disc inside
          // it. Otherwise grass grows across the landing apron and the
          // player spawns in a field instead of on a forecourt.
          paved = Math.max(paved, 1 - smoothstep(distance, district.plate * 1.0, district.plate * 1.55))
        }

        const water = inlandWater(x, z)
        // Normalised against a QUARTER of a metre, not five: grass was
        // surviving in water up to 1.25 m deep, which is where the
        // "lawn growing out of the lake" came from.
        const waterDepth = water && water.edge > 0
          ? water.depth * Math.pow(smoothstep(water.edge, 0, water.flow > .9 ? 6 : 11), 1.9)
          : 0
        const depth = Math.min(1, waterDepth / 0.25)

        // Nothing grows past the shore, on paving, or in water. The
        // taper at the coast keeps the beach clear of blades.
        const coast = coastRadius(x, z, WORLD_RADIUS)
        const land = 1 - smoothstep(Math.hypot(x, z), coast - 16, coast - 2)
        const grass = Math.max(0, (1 - paved) * (1 - Math.min(1, depth * 4)) * land)

        // Height rides in alpha so anything reading the mask on the
        // GPU can sit on the ground without a second texture.
        const height = this.heightAt(x, z)
        const normalised = Math.min(1, Math.max(0, (height - this.maskHeightBias) / this.maskHeightScale))

        const o = (j * MASK_SIZE + i) * 4
        data[o] = Math.round(paved * 255)
        data[o + 1] = Math.round(grass * 255)
        data[o + 2] = Math.round(depth * 255)
        data[o + 3] = Math.round(normalised * 255)
      }
    }

    const texture = new THREE.DataTexture(data, MASK_SIZE, MASK_SIZE, THREE.RGBAFormat)
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.needsUpdate = true
    return texture
  }

  sample(x: number, z: number): TerrainSample {
    let district: District | null = null
    let bestDistance = Infinity
    for (const item of districts) {
      const distance = Math.hypot(x - item.x, z - item.z)
      if (distance < item.radius && distance < bestDistance) {
        bestDistance = distance
        district = item
      }
    }

    let road = 0
    for (const item of roads) {
      const distance = distanceToPolyline(x, z, item.points)
      road = Math.max(road, 1 - smoothstep(distance, item.width * 0.42, item.width * 0.62))
    }

    return { height: this.heightAt(x, z), district, road }
  }

  /* ========================================================
     COLLIDER
     ======================================================== */

  private buildCollider(): void {
    const n = COLLIDER_SEGMENTS + 1
    const heights = new Float32Array(n * n)

    // Keep our readable row-Z grid for painting and sampling. Rapier consumes
    // column-major heights (the contiguous index runs along Z), so upload a
    // transpose. A small asymmetric raycast fixture verifies this convention.
    const rapierHeights = new Float32Array(n * n)
    for (let i = 0; i < n; i++) {
      const z = -FIELD_HALF + i * this.step
      for (let j = 0; j < n; j++) {
        const x = -FIELD_HALF + j * this.step
        heights[i * n + j] = this.heightAt(x, z)
        rapierHeights[j * n + i] = heights[i * n + j]
      }
    }

    this.colliderHeights = heights

    this.physics.add({
      type: 'fixed',
      category: 'floor',
      friction: 1,
      restitution: 0,
      colliders: [
        {
          shape: 'heightfield',
          parameters: [
            COLLIDER_SEGMENTS,
            COLLIDER_SEGMENTS,
            rapierHeights,
            { x: FIELD_HALF * 2, y: 1, z: FIELD_HALF * 2 },
          ],
        },
      ],
    })
  }

  /** Same two triangles per cell as Rapier and PlaneGeometry. */
  colliderHeightAt(x: number, z: number): number {
    const n = COLLIDER_SEGMENTS + 1
    const fx = (x + FIELD_HALF) / this.step
    const fz = (z + FIELD_HALF) / this.step
    const j = clamp(Math.floor(fx), 0, COLLIDER_SEGMENTS - 1)
    const i = clamp(Math.floor(fz), 0, COLLIDER_SEGMENTS - 1)
    const tx = clamp(fx - j, 0, 1)
    const tz = clamp(fz - i, 0, 1)

    const h00 = this.colliderHeights[i * n + j]
    const h10 = this.colliderHeights[i * n + j + 1]
    const h01 = this.colliderHeights[(i + 1) * n + j]
    const h11 = this.colliderHeights[(i + 1) * n + j + 1]

    return tx + tz <= 1
      ? h00 + tx * (h10 - h00) + tz * (h01 - h00)
      : h11 + (1 - tx) * (h01 - h11) + (1 - tz) * (h10 - h11)
  }

  /* ========================================================
     MESH
     ======================================================== */

  private buildMesh(bin: Bin): void {
    // Visual resolution follows quality; the collider above does not.
    const segments =
      this.quality.level === 'high' ? COLLIDER_SEGMENTS
        : this.quality.level === 'medium' ? 200
        : 128

    const geometry = new THREE.PlaneGeometry(FIELD_HALF * 2, FIELD_HALF * 2, segments, segments)
    geometry.rotateX(-Math.PI / 2)

    const position = geometry.getAttribute('position') as THREE.BufferAttribute
    const colors = new Float32Array(position.count * 3)

    const grass = new THREE.Color('#ffffff')
    const plate = new THREE.Color(palette.paper)
    const asphalt = new THREE.Color(palette.concrete)
    const deep = new THREE.Color(palette.paper4)
    const scratch = new THREE.Color()

    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i)
      const z = position.getZ(i)
      // Sample the collider grid, not `heightAt`, so a lower-detail
      // visual mesh still sits exactly on the surface the car drives
      // on rather than on its own smoother version of it.
      const height = this.colliderHeightAt(x, z)
      position.setY(i, height)

      // A whisper of tonal variation, so the huge flat plain does not
      // band. Everything else the ground says is said by the painted
      // texture below, which has 0.4 m resolution instead of 2.5 m.
      const grain = (hash2(x * 3.7, z * 3.7) - 0.5) * 0.02
      scratch.copy(grass)
      colors[i * 3] = clamp(scratch.r + grain, 0, 1)
      colors[i * 3 + 1] = clamp(scratch.g + grain, 0, 1)
      colors[i * 3 + 2] = clamp(scratch.b + grain, 0, 1)
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.computeVertexNormals()

    void plate
    void deep
    void asphalt

    const material = this.materials.own(
      new THREE.MeshStandardMaterial({
        map: this.paintGround(bin),
        vertexColors: true,
        roughness: 0.96,
        metalness: 0,
        flatShading: false,
      }),
    )

    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.receiveShadow = this.quality.settings.shadows
    this.mesh.matrixAutoUpdate = false
    this.mesh.updateMatrix()
    this.group.add(this.mesh)
    bin.add(() => geometry.dispose())
  }

  /* ========================================================
     GROUND PAINT

     Districts, roads and markings are painted once into a single
     canvas covering the whole world, and used as the terrain's
     colour map.

     The obvious alternative — vertex colours on the terrain mesh —
     was the first attempt, and it does not work: the mesh has a
     vertex every 2.5 m, so an 11 m road becomes a four-vertex
     smear and a district boundary becomes a soft stain. At 2048
     px across 800 m this canvas has 0.4 m resolution, so a road
     edge is a road edge, and it costs one texture instead of
     200,000 extra triangles.
     ======================================================== */

  private paintGround(bin: Bin): THREE.CanvasTexture {
    const size = this.quality.level === 'low' ? 1024 : 2048
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('[world] 2D canvas unavailable')

    /** World metres → canvas pixels. */
    const toPx = (v: number) => ((v + FIELD_HALF) / (FIELD_HALF * 2)) * size
    const scale = size / (FIELD_HALF * 2)

    // Chippings, as a tileable stroke pattern. One 48 px tile of
    // two-tone noise at roughly a metre per 1.2 px, so a road carries
    // visible aggregate instead of a flat fill.
    const grit = document.createElement('canvas')
    grit.width = grit.height = 48
    const gritCtx = grit.getContext('2d')
    const aggregate = (() => {
      if (!gritCtx) return palette.roadDark
      const noise = seeded(9931)
      const image = gritCtx.createImageData(48, 48)
      for (let i = 0; i < image.data.length; i += 4) {
        const n = noise()
        const value = n < 0.42 ? 58 : n < 0.86 ? 78 : 104
        image.data[i] = value + 2
        image.data[i + 1] = value + 1
        image.data[i + 2] = value + 6
        image.data[i + 3] = 255
      }
      gritCtx.putImageData(image, 0, 0)
      return ctx.createPattern(grit, 'repeat') ?? palette.roadDark
    })()

    ctx.fillStyle = palette.paper2
    ctx.fillRect(0, 0, size, size)

    /* ---- the island and its beach ------------------------
       The clip used to stop exactly at the coastline, so every metre
       of sand and shallow water past it was painted in the off-map
       backdrop colour — which is why the beach read as the edge of
       the texture rather than as a beach. It now runs out to the
       shelf, with a band of sand either side of the waterline.
    */
    const coastPath = (grow: number) => {
      ctx.beginPath()
      for (let i = 0; i <= 360; i++) {
        const a = (i / 360) * Math.PI * 2
        const r = coastRadius(Math.cos(a), Math.sin(a), WORLD_RADIUS) + grow
        const px = toPx(Math.cos(a) * r)
        const py = toPx(Math.sin(a) * r)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
    }

    // Wet sand and the shallow shelf, out past the waterline.
    coastPath(26)
    ctx.fillStyle = '#a9a789'
    ctx.fill()
    coastPath(9)
    ctx.fillStyle = '#c9c2a0'
    ctx.fill()

    ctx.save()
    // The same coastline the heightfield uses, so the painted island
    // and the ground you can actually drive on are one shape.
    coastPath(0)
    ctx.clip()

    // Dry sand under the grass, so the beach shows through where the
    // grass mask tapers out along the shore.
    ctx.fillStyle = '#ded4ae'
    ctx.fillRect(0, 0, size, size)
    coastPath(-16)
    ctx.fillStyle = '#b6be88'
    ctx.fill()

    for (const [x, z, r] of FOREST_POCKETS) {
      const gradient = ctx.createRadialGradient(toPx(x), toPx(z), 0, toPx(x), toPx(z), r * scale * 1.4)
      gradient.addColorStop(0, z < -160 ? '#7b9569' : '#859b64')
      gradient.addColorStop(0.68, '#91a570')
      gradient.addColorStop(1, '#b6be8800')
      ctx.fillStyle = gradient
      ctx.fillRect(toPx(x - r * 1.4), toPx(z - r * 1.4), r * scale * 2.8, r * scale * 2.8)
    }

    /* ---- district ground -------------------------------- */
    // Only a district with a built footprint gets paving. The rest
    // are clearings: a soft tint that fades into the grass, so the
    // island reads as landscape rather than as discs on a lawn.
    for (const district of districts) {
      const x = toPx(district.x)
      const y = toPx(district.z)
      const dark = district.theme === 'dark'

      if (!district.plate) {
        const r = district.radius * scale
        const clearing = ctx.createRadialGradient(x, y, r * 0.15, x, y, r)
        clearing.addColorStop(0, dark ? '#3a3a3f' : '#c7cb9d')
        clearing.addColorStop(0.6, dark ? '#3a3a3f88' : '#c2c797aa')
        clearing.addColorStop(1, dark ? '#3a3a3f00' : '#b6be8800')
        ctx.fillStyle = clearing
        ctx.fillRect(x - r, y - r, r * 2, r * 2)
        continue
      }

      const r = district.plate * scale
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = dark ? palette.voidDark3 : '#dfdbcf'
      ctx.fill()

      // An inner plate, so the plate has an edge rather than a fade.
      ctx.beginPath()
      ctx.arc(x, y, r * 0.94, 0, Math.PI * 2)
      ctx.fillStyle = dark ? palette.voidDark2 : '#e9e5da'
      ctx.fill()

      ctx.beginPath()
      ctx.arc(x, y, r * 0.94, 0, Math.PI * 2)
      ctx.strokeStyle = dark ? palette.chalk3 : palette.ink4
      ctx.lineWidth = Math.max(1, 0.5 * scale)
      ctx.globalAlpha = 0.55
      ctx.stroke()
      ctx.globalAlpha = 1

      // Its name, set large and quiet, like a plan drawing.
      ctx.save()
      ctx.translate(x, y + r * 0.62)
      ctx.fillStyle = dark ? palette.chalk3 : palette.ink4
      ctx.globalAlpha = 0.5
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const fontSize = Math.max(10, r * 0.2)
      ctx.font = `500 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`
      const label = district.short
      let cursor = -(ctx.measureText(label).width + fontSize * 0.34 * (label.length - 1)) / 2
      for (const char of label) {
        ctx.fillText(char, cursor + ctx.measureText(char).width / 2, 0)
        cursor += ctx.measureText(char).width + fontSize * 0.34
      }
      ctx.restore()
    }

    /* ---- road shoulders ----------------------------------
       Before the district plates, and the rest of the road after them:
       a lane crossing a paved forecourt should not carry a gravel
       verge across it, and at the hub — where four roads meet on one
       plate — four sets of verges made the junction look like
       roadworks. On grass the shoulder still shows, because the
       plates are only their own discs.
    */
    const ROAD_PASSES = ['surface', 'aggregate', 'wear', 'edgeLine', 'centre'] as const

    const trace = (road: (typeof roads)[number]) => {
      ctx.beginPath()
      road.points.forEach(([x, z], i) => {
        const px = toPx(x)
        const py = toPx(z)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      })
    }
    const dirt = (road: (typeof roads)[number]) => road.id === 'void-run'

    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const road of roads) {
      trace(road)
      ctx.strokeStyle = palette.roadShoulder
      ctx.lineWidth = (road.width + 2.4) * scale
      ctx.globalAlpha = dirt(road) ? 0.55 : 0.9
      ctx.stroke()
      ctx.globalAlpha = 1
    }


    /* ---- the circuit -------------------------------------
       Painted BEFORE the roads, so the link road crosses it rather
       than being cut by it. The track had no painted surface at all:
       terrain flattened a corridor and the checkered flag stood at
       one end of it, but the racing line itself was the same
       yellow-green as the field around it. From the car you could
       not see where the track went.

       Run-off, then tarmac, then aggregate, then a racing line worn
       into it, then red-and-white kerbing on both edges. */
    {
      const traceTrack = (inset: number) => {
        ctx.beginPath()
        CIRCUIT_TRACK.forEach(([x, z], i) => {
          const a = CIRCUIT_TRACK[Math.max(0, i - 1)]
          const b = CIRCUIT_TRACK[Math.min(CIRCUIT_TRACK.length - 1, i + 1)]
          const dx = b[0] - a[0], dz = b[1] - a[1]
          const len = Math.hypot(dx, dz) || 1
          const px = toPx(x + (-dz / len) * inset)
          const py = toPx(z + (dx / len) * inset)
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        })
      }
      const W = CIRCUIT.width

      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      traceTrack(0)
      ctx.strokeStyle = '#b3a985'          // gravel run-off
      ctx.lineWidth = (W + 7) * scale
      ctx.stroke()

      traceTrack(0)
      ctx.strokeStyle = palette.roadDark
      ctx.lineWidth = W * scale
      ctx.stroke()

      traceTrack(0)
      ctx.strokeStyle = aggregate
      ctx.globalAlpha = 0.45
      ctx.lineWidth = W * scale
      ctx.stroke()
      ctx.globalAlpha = 1

      // The racing line: a polished band a little inside the middle.
      traceTrack(0)
      ctx.strokeStyle = palette.roadLight
      ctx.globalAlpha = 0.26
      ctx.lineWidth = W * 0.5 * scale
      ctx.stroke()
      ctx.globalAlpha = 1

      // Kerbs. Dashed twice with the phases offset gives the
      // red-white-red-white alternation without two more passes.
      for (const side of [-1, 1]) {
        for (const [colour, offset] of [['#c9412a', 0], ['#eeeae0', 2.6 * scale]] as const) {
          traceTrack(side * (W * 0.5 + 0.75))
          ctx.strokeStyle = colour
          ctx.lineWidth = 1.5 * scale
          ctx.setLineDash([2.6 * scale, 2.6 * scale])
          ctx.lineDashOffset = offset
          ctx.stroke()
        }
      }
      ctx.setLineDash([])
      ctx.lineDashOffset = 0
    }

    /* ---- roads ------------------------------------------
       Six passes, outside in. The road has to read as a surface from
       a thirty-metre camera, which means it needs an EDGE — the old
       two-tone concrete ribbon dissolved into the paving it crossed.
       Shoulder, then tarmac, then aggregate, then wear down the
       wheel tracks, then markings.

       `void-run` is unsurfaced on purpose: it is the dirt track out
       to the stunt ramp, and a lane-marked highway to a jump would
       be a worse joke than no road at all. */
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    for (const pass of ROAD_PASSES) {
      for (const road of roads) {
        if (dirt(road) && (pass === 'edgeLine' || pass === 'centre' || pass === 'wear')) continue
        trace(road)
        ctx.globalAlpha = 1

        if (pass === 'surface') {
          ctx.strokeStyle = dirt(road) ? palette.roadDirt : palette.road
          ctx.lineWidth = road.width * scale
        } else if (pass === 'aggregate') {
          // Coarse chippings, so tarmac is not a flat fill under a
          // directional light. The pattern is scaled to ~1 m.
          ctx.strokeStyle = aggregate
          ctx.lineWidth = road.width * scale
          ctx.globalAlpha = dirt(road) ? 0.18 : 0.5
        } else if (pass === 'wear') {
          // Two polished wheel tracks. Roads are lighter where they
          // are driven and darker in the middle, not the reverse.
          ctx.strokeStyle = palette.roadLight
          ctx.globalAlpha = 0.3
          ctx.lineWidth = road.width * 0.62 * scale
        } else if (pass === 'edgeLine') {
          ctx.strokeStyle = palette.roadLine
          ctx.globalAlpha = 0.34
          ctx.lineWidth = Math.max(1, 0.3 * scale)
          // Drawn twice, offset either side by half the carriageway.
          ctx.save()
          for (const side of [-1, 1]) {
            ctx.beginPath()
            road.points.forEach(([x, z], i) => {
              const a = road.points[Math.max(0, i - 1)]
              const b = road.points[Math.min(road.points.length - 1, i + 1)]
              const dx = b[0] - a[0], dz = b[1] - a[1]
              const len = Math.hypot(dx, dz) || 1
              const nx = (-dz / len) * road.width * 0.42 * side
              const nz = (dx / len) * road.width * 0.42 * side
              const px = toPx(x + nx), py = toPx(z + nz)
              if (i === 0) ctx.moveTo(px, py)
              else ctx.lineTo(px, py)
            })
            ctx.stroke()
          }
          ctx.restore()
          ctx.globalAlpha = 1
          continue
        } else {
          ctx.strokeStyle = palette.roadLine
          ctx.globalAlpha = 0.46
          ctx.lineWidth = Math.max(1, 0.36 * scale)
          ctx.setLineDash([3.5 * scale, 3.5 * scale])
        }
        ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = 1
      }
    }

    ctx.restore()

    /* ---- grain ------------------------------------------ */
    // Fine per-pixel noise. Without it the paper reads as a flat
    // fill under a directional light, which is the one thing that
    // makes a large ground plane look synthetic. Done as one
    // ImageData pass — a hundred thousand `fillRect` calls is
    // hundreds of milliseconds of load time for the same result.
    const image = ctx.getImageData(0, 0, size, size)
    const data = image.data
    const noise = seeded(4242)
    for (let i = 0; i < data.length; i += 4) {
      const delta = (noise() - 0.5) * 9
      data[i] = clamp(data[i] + delta, 0, 255)
      data[i + 1] = clamp(data[i + 1] + delta, 0, 255)
      data[i + 2] = clamp(data[i + 2] + delta, 0, 255)
    }
    ctx.putImageData(image, 0, 0)

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = this.quality.level === 'high' ? 8 : 4
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.needsUpdate = true
    bin.add(() => texture.dispose())
    return texture
  }

  /** Places an object on the ground, returning the surface height. */
  place(object: THREE.Object3D, x: number, z: number, offset = 0): number {
    const height = this.colliderHeightAt(x, z)
    object.position.set(x, height + offset, z)
    return height
  }
}
