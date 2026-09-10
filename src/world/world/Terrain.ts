import * as THREE from 'three'
import { palette } from '../core/palette'
import { clamp, seeded, smoothstep } from '../core/maths'
import type { Bin } from '../core/Disposal'
import type { Quality } from '../core/Quality'
import type { Physics } from '../physics/Physics'
import type { Materials } from './materials'
import { districts, ramps, roads, type Ramp } from '@/content/world'
import { inlandWater, coastInset, CIRCUIT, CIRCUIT_TRACK, VEGETATION_ZONES, VEGETATION_EXCLUSIONS, BRIDGES, PLAY_SPOTS, OCEAN_LEVEL, BANK_WIDTH, LAKES, RIVER, lineDistance, polylineOverrun } from '@/content/world-environment'
import { ISLAND, ISLET, pointInPolygon } from '@/content/world-map'

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
     - the hand-drawn island: 266 m east-west by 199.5 m north-south,
       a traced polygon rather than a disc, with a bay cut into the
       north-east and a vegetated islet inside it
     - macro landform — a ridge behind the north loop, a shoulder
       under PROJECTS, a basin the two lakes sit in — over gentle
       rolling noise for the suspension
     - only districts with a BUILT footprint flattened to a plate
     - the circuit and the dirt paths cut flat corridors
     - past the coastline the ground shelves and then falls away,
       which is both the map edge and the OUT OF BOUNDS achievement
   ============================================================ */

/** Collider resolution. Identical at every quality level. With
 *  `FIELD_HALF` at 175 this is a 0.91 m cell: the segment count did not
 *  change when the island shrank to 70%, so the shrink bought a third
 *  more resolution for nothing. Anything that walks the ground in
 *  world metres — `Roads.ts` in particular — should step by `this.step`
 *  rather than assume a number. */
const COLLIDER_SEGMENTS = 384
/** Half-width of the heightfield, metres. 175 = 122.5 (the island's own
 *  reach on a 266 x 199.5 plan) + the 52 m the east ramp's landing shoal
 *  runs out to. It was 250 on the 380 x 285 island. */
const FIELD_HALF = 175

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
  /*
    Re-authored against the drawing. Every one of these is placed
    against something the plan actually has, because the version this
    replaces was authored for a different island and its comments named
    features — "the eastern shoulder the circuit is cut into" — that had
    not been true for two rebuilds.

    Nothing here exceeds 9 m. The mask's height channel clips outside
    -24..+32 m, and more to the point the brief asks for the TOP-DOWN
    silhouette to stay the thing you recognise: hills that read from the
    car and disappear from the map.
  */
  /*
    The rise the BLACK HOLE sits on, INSIDE the circuit's north loop.

    It was 8 m at (-110, -104) with a 62 m radius, which put its summit
    under the track: the loop climbed to 10 m at one checkpoint and
    dropped 8 m to the next, a seventeen-degree ramp into a corner that
    the autopilot could not hold and that the drawing has no trace of.
    Moved into the loop's interior and halved, it gives the black hole
    something to sit on and leaves the racing line a metre of relief.
  */
  h += 5 * bump(x, z, -70, -61.6, 30.8)
  // The shoulder PROJECTS stands on, which is why the north-east coast
  // is a headland with a bay bitten out of it rather than a beach.
  h += 5.5 * bump(x, z, 75.6, -58.8, 37.8)
  // A long low rise down the eastern side, under the ramp and the
  // east grove: the ramp wants to launch off high ground towards the sea.
  h += 4 * bump(x, z, 96.6, 4.2, 42)
  // The basin the two lakes sit in. Without a dip they are puddles on
  // a plain and their banks are the only relief for a hundred metres.
  h -= 3 * bump(x, z, -42, 40.6, 54.6)
  // A shallow saddle under the LANDING, so the forecourt is the low
  // point everything else is visible from.
  h -= 1.5 * bump(x, z, 43.4, -7, 32.2)
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

/** Where the coastal dune rises, peaks and fades, as metres INLAND of
 *  the coastline. It runs from 43.4 m in, peaks at 23.8 and is back to
 *  nothing by 8.4, which is before the sand starts. All three were
 *  multiplied by 0.7 with the island: a dune that kept its old reach on
 *  a 266 m plan would have been a ridge down the middle of it. */
const DUNE = { from: 43.4, peak: 23.8, fade: 8.4, height: 3.4 }

/** How far a ramp's pad reaches past its own footprint, along the
 *  slope and across it, and therefore how long the blend back to the
 *  natural ground is. */
/**
 * The ramps whose pad may override a ROAD, which is all of them except
 * the one standing on the racing line.
 *
 * A road is flattened after a ramp, so a carriageway that merely passes
 * NEAR a pad drags it down: `landing-projects` runs seven metres from
 * the east ramp's foot and pulled it from 4.70 m to 3.69, leaving a
 * metre of step where the deck starts. `world-qa` measured 2.7 m of air
 * off a 5.6 m ramp and the tour wedged the car against the lip.
 *
 * So the pad is re-asserted after the roads — but not for a ramp that
 * stands on the circuit. `ramp-circuit-jump` sits on the racing surface,
 * whose corridor is deliberately levelled to CIRCUIT_LEVEL, and a pad
 * re-asserted over that puts a bump in the middle of a straight.
 */
const ROAD_PROOF_RAMPS = ramps.filter(
  (ramp) => closestOnPolyline(ramp.x, ramp.z, CIRCUIT_TRACK).distance > CIRCUIT.width * 1.5 + 10,
)

/** How far past the river's drawn ends its apron survives. See the
 *  RIVER APRON block, and `polylineOverrun` for why it must end. */
const APRON_END_FADE = 12

const RAMP_PAD_SHOULDER = 16
const RAMP_PAD_SIDE = 8
/**
 * The beach, as three stages measured from the mapped coastline.
 * `sand` is dry beach; `wade` is the run from the top of the sand down
 * to the waterline; `shelf` is the long shallow shelf beyond it, and
 * `shelfDepth` is how deep the water gets before the bottom falls
 * away. A car floats out of its depth at about 1.1 m, so a shelf of
 * 0.6 is comfortably drivable and the drop past it is not.
 *
 * TWENTY-FOUR METRES OF SHELF, not fifteen. Fifteen is less than the
 * run-out of a car that drives into the sea at any speed at all:
 * `world-water-drive.mjs` entered the open coast in a third of a
 * metre of water on both derived bearings and was over the lip and
 * sliding before it could reverse, so the only way back was the
 * drowning rule. The drop past the shelf is unchanged — going FURTHER
 * is still a decision — it just starts where a car that meant to
 * paddle has already stopped.
 */
const BEACH = { sand: 15, wade: 8, shelf: 24, shelfDepth: 0.6 }

/** How far past a seaward ramp's lip its landing stays wadeable, how
 *  far the far end takes to fade back into the sea bed, and how deep
 *  the water is allowed to be inside it. A full-boost launch off the
 *  east ramp's 5.6 m flies seventy-eight metres, so the shoal is flat
 *  to eighty-five and fades over the thirty after that — a landing
 *  short of the fade is water you drive out of, and one past it is a
 *  decision. 0.85 m is under the 1.1 m at which the car floats. */
const LANDING_REACH = 115
const LANDING_FADE = 30
const LANDING_DEPTH = 0.85

/** The ramps whose landing is water: the seaward ones. Read off the
 *  ramp table rather than listed, so a ramp that is turned round in
 *  the plan stops carrying a shoal with it. */
const LANDING_SHOALS = ramps.filter((ramp) => {
  const lip = {
    x: ramp.x + Math.cos(ramp.rotation) * ramp.length / 2,
    z: ramp.z + Math.sin(ramp.rotation) * ramp.length / 2,
  }
  // Aimed at the sea if the ground 30 m beyond the lip is past the
  // coastline. `ramp-circuit-jump` and `ramp-landing` are inland and
  // fail this; the east ramp is the only one that passes.
  return coastInset(lip.x + Math.cos(ramp.rotation) * 30, lip.z + Math.sin(ramp.rotation) * 30) < 0
})

/**
 * The coastal dune, as a function of position. Extracted because
 * SEVEN places in this file re-derived it inline to work out what
 * height a district, a play spot or a ramp should flatten to, and
 * every one of them had to be kept in step by hand.
 */
function coastalRim(x: number, z: number): number {
  // Measured as metres INLAND of the traced coastline, not as a radius
  // from the origin: the island has a bay cut into its north-east
  // corner, and a radial dune drew a ridge straight across the mouth
  // of it.
  const inland = coastInset(x, z)
  const rise = smoothstep(inland, DUNE.from, DUNE.peak)
  const fall = 1 - smoothstep(inland, DUNE.peak, DUNE.fade)
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
  /*
    Then away, and quickly enough that going further is a decision.

    The coefficient was tried at 0.12 to give a car that drifts off
    the shelf room to reverse back onto it. It made things worse, not
    better: a gentler drop widens the band of water shallow enough to
    keep driving through, so the car simply wades further out before
    it notices, and `world-water-drive.mjs` went from one failed
    open-coast bearing to two. Past the shelf, the sea is the sea.
  */
  return shelf - Math.pow((past - BEACH.shelf) * 0.17, 1.8)
}

/**
 * THE NATURAL GROUND, without the fine noise.
 *
 * This expression — landform, the coarse fbm octave, and the dune —
 * is what every flatten target in `heightAt` blends towards: a plate,
 * a play spot, a ramp pad, the circuit corridor, a road. It used to be
 * written out inline in SIX places, and the file's own comments record
 * three shipped bugs from one copy drifting out of step with the
 * others: a ramp that sat in a step, a road that carried a camber, and
 * a bridge that punched two plateaus into a lake.
 *
 * It is one function now. Anything that flattens ground calls it.
 */
function smoothGround(x: number, z: number): number {
  return landform(x, z) + (fbm(x * 0.0042, z * 0.0042) - 0.5) * 2.8 + coastalRim(x, z)
}

/**
 * How strongly a ramp's own pad claims this point, and the height it
 * claims it at.
 *
 * A ramp is a wedge built on flat ground — `World.buildRamps` puts its
 * mesh and its hull at `colliderHeightAt(ramp.x, ramp.z)` and assumes
 * that is the height of the whole footprint — so the pad is what makes
 * that assumption true.
 *
 * It is a function rather than a loop inside `heightAt` because the
 * ROADS need it too. The east ramp stands on the coastal dune, 3.5 m
 * above the ground either side of it, and `landing_ramp` ends ten
 * metres inside its footprint: the road's corridor is applied after
 * the pad, so it cut the pad back down to road level and left the
 * ramp's low end three and a half metres in the air. The car met a
 * wall where it should have started climbing — `world-qa.mjs` measured
 * 1.7 m of air off a 5.6 m ramp — and the same road is the only way to
 * approach it. A road that runs into a ramp climbs the ramp's pad, the
 * same way a road that runs into a district climbs its plate.
 *
 * THE SHOULDER IS SIXTEEN METRES, not seven. Seven turned that 3.5 m
 * rise into a 26° bank, which is a wall with a slope drawn on it.
 */
function rampPadAt(
  x: number,
  z: number,
  list: readonly Ramp[] = ramps,
): { inside: number; height: number } {
  let inside = 0
  let height = 0
  for (const ramp of list) {
    const dx = x - ramp.x
    const dz = z - ramp.z
    // Into the ramp's own frame: +X runs up the slope.
    const cos = Math.cos(ramp.rotation)
    const sin = Math.sin(ramp.rotation)
    const localX = dx * cos - dz * sin
    const localZ = dx * sin + dz * cos

    const halfLength = ramp.length / 2 + RAMP_PAD_SHOULDER
    const halfWidth = ramp.width / 2 + RAMP_PAD_SIDE
    if (Math.abs(localX) > halfLength || Math.abs(localZ) > halfWidth) continue

    const claim =
      (1 - smoothstep(Math.abs(localX), halfLength - RAMP_PAD_SHOULDER, halfLength)) *
      (1 - smoothstep(Math.abs(localZ), halfWidth - RAMP_PAD_SIDE, halfWidth))
    if (claim <= inside) continue
    inside = claim
    /*
      LEVELLED TO THE RAMP'S MIDDLE, and tried at its foot.

      `World.buildRamps` puts the wedge's base plane on the ground at
      the foot, so a pad levelled to the foot instead of the middle
      sounds like the tidier pairing. Measured, it is not: it lowers
      the ground under the whole approach with the deck, and the air
      off the lip fell from 4.1 m to 3.3. The middle is what the mesh
      was always built against and what the rim needs.
    */
    height = smoothGround(ramp.x, ramp.z)
  }
  return { inside, height }
}

/**
 * Nearest point on a polyline, not just the distance to it. A road has
 * to be level ACROSS its width — a corridor that follows the terrain's
 * cross-slope is a camber the car slides down, which is how a straight
 * run-up quietly steers itself off a ramp.
 */
function closestOnPolyline(
  x: number, z: number, points: [number, number][],
): { distance: number; px: number; pz: number } {
  let best = Infinity
  let bx = points[0][0]
  let bz = points[0][1]
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
    }
  }
  return { distance: best, px: bx, pz: bz }
}

/* The `along` parameter this used to return, and the `arcLengths` table
   that fed it, existed only so the circuit corridor could look up
   `circuitElevation`. The lap is level now (see CIRCUIT_LEVEL), so both
   were carrying a position nobody asked for. */

/**
 * THE HEIGHT OF THE RACING SURFACE — one number for the whole lap.
 *
 * The corridor was already level ACROSS, because its target is sampled
 * on the nearest centreline point rather than underfoot. It was not
 * level ALONG: it followed `smoothGround` down the line and added the
 * authored ±1.5 m `CIRCUIT.elevation` profile on top, and the measured
 * centreline ran −1.15 m to +4.37 m. That is 5.5 m of climb in a lap
 * the brief for this pass asks to be flat.
 *
 * So the target is a constant, and the constant is DERIVED: the
 * arc-length-weighted mean of the natural ground under the line, so the
 * lap sits at the average of the relief it replaces and stays right
 * when the drawing moves. An authored number would be a fourth copy of
 * the racing line's position, in metres, in the wrong file.
 *
 * WHAT IT COSTS, stated plainly, because it is not free: the corridor
 * carries its run-off out to `half * 6` — 30 m either side at
 * CIRCUIT.width 10 — so every metre the natural ground differs from
 * this constant becomes an embankment or a cutting thirty metres wide.
 * The north loop stands on a 5 m landform bump and is now cut into it;
 * the low ground on the south-west run is filled out to meet the line.
 * The shore's safety valve below is the only reason the filled sections
 * do not become a causeway over the sea.
 */
const CIRCUIT_LEVEL = (() => {
  let sum = 0
  let length = 0
  for (let i = 0; i < CIRCUIT_TRACK.length - 1; i++) {
    const [ax, az] = CIRCUIT_TRACK[i]
    const [bx, bz] = CIRCUIT_TRACK[i + 1]
    const run = Math.hypot(bx - ax, bz - az)
    sum += smoothGround((ax + bx) / 2, (az + bz) / 2) * run
    length += run
  }
  return sum / (length || 1)
})()

const CIRCUIT_HALF = CIRCUIT.width * 0.5

/**
 * The roads that come near enough to the racing surface to matter.
 *
 * Roads are flattened AFTER the circuit and therefore win over it, which
 * is deliberate everywhere except where they cross it. Measured on the
 * level lap: `bowling-west-spur` crosses at (-50.5, -69.8) with a
 * corridor weight of 1.00 and put a 4.33 m bump into a track that was
 * otherwise flat to a millimetre — the one place the flat floor was
 * still not flat.
 *
 * Precomputed as a set because the fix is a 93-segment polyline test,
 * and `heightAt` runs about half a million times at boot (the 385²
 * collider, the 512² mask and the visible mesh). Only the two roads that
 * actually touch the track pay for it.
 */
const ROADS_ON_CIRCUIT = new Set(
  roads
    .filter((road) => CIRCUIT_TRACK.some(([x, z]) =>
      distanceToPolyline(x, z, road.points) < CIRCUIT_HALF * 3 + road.width * 1.5 + 2))
    .map((road) => road.id),
)

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
 * Elevation of each district's plate, in metres above the natural
 * ground it stands on.
 *
 * Only PLATED districts are in here. The version this replaces carried
 * three entries — ucl, kcl and network — for districts that had no
 * plate at all, so the loop below skipped them and those numbers had
 * never done anything: a plausible-looking lie in the middle of the
 * one file where a wrong height is a car falling through the floor.
 */
const DISTRICT_ELEVATION: Partial<Record<string, number>> = {
  // The saddle under the forecourt puts it a metre under sea level
  // otherwise, which is a bowl the eye reads as a hole.
  landing: 1.6,
  projects: 1.2,
  social: 0.6,
  achievements: 0.8,
  timeMachine: 0.4,
}

/** Resolution of the ground mask. One texel is 0.68 m at FIELD_HALF 175. */
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
  readonly maskHeightBias = -10
  readonly maskHeightScale = 30

  private colliderHeights!: Float32Array
  /** One collider cell, metres. Public because `Roads.ts` walks its
   *  ribbons at exactly this spacing: a station finer than the cell
   *  buys nothing, and one coarser chords across the flattened corridor
   *  and lifts the ribbon off the ground it is supposed to lie on. */
  readonly step = (FIELD_HALF * 2) / COLLIDER_SEGMENTS
  /** Resolution of the VISIBLE mesh. Follows quality, so it is written
   *  by `buildMesh` rather than initialised here, and read back by
   *  `surfaceHeightAt`. */
  private meshSegments!: number
  private meshStep!: number

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
    // Rolling base. Deliberately gentle — the suspension should have
    // something to do, but nothing should launch the car unbidden.
    // `smoothGround` is the landform, the coarse octave and the dune;
    // the fine octave is added here and nowhere else, because nothing
    // that flattens ground wants it.
    let height = smoothGround(x, z) + (fbm(x * 0.017, z * 0.017) - 0.5) * 0.55

    /*
      HOW MUCH OF THIS POINT IS BUILT GROUND, 0..1 — the running maximum
      of every flatten weight below.

      The SHORE runs after every built stage, and that ordering is the
      reason no mini-game floor on this island has ever been flat.
      Measured before this change, over each footprint's own core: the
      bowling deck carried 2.967 m of relief, the labyrinth's pad
      4.298 m, the projects plate 4.395 m. None of it is authored — it
      is the beach eating the buildings from twenty-seven metres inland,
      because `onShore` starts claiming ground that far in and nothing
      told it the ground was already spoken for. Weakened by this
      scalar, the same cores read 0.016 m, 0.000 m and 0.005 m over the
      part of them that is genuinely inland.

      A MAXIMUM, not a sum: the stages overlap, and a road across a plate
      is not twice as built as either of them.

      ONLY THE SHORE READS IT. The survey for this pass asked for the
      lake aprons to be weakened by it as well; four shapes of that were
      built and measured and all four were worse than leaving the aprons
      alone — see the LAKE APRONS block for the numbers.
    */
    let built = 0

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
      const target = smoothGround(district.x, district.z) + (DISTRICT_ELEVATION[district.id] ?? 0)
      height = height * (1 - inside) + target * inside
      built = Math.max(built, inside)
    }

    // Ramps flatten their own footprint. A forty-metre ramp laid on
    // rolling ground has its low end buried and its lip in the air,
    // and the car hits a step instead of a slope — which is exactly
    // how the jump to the void island failed the first time. The pad
    // sits at the height of the ramp's own centre, which is what its
    // mesh and collider were built against, rim included.
    {
      const pad = rampPadAt(x, z)
      if (pad.inside > 0) {
        height = height * (1 - pad.inside) + pad.height * pad.inside
        built = Math.max(built, pad.inside)
      }
    }

    // The circuit gets the same treatment as a road: a corridor of its
    // own, flattened to the ground it runs over minus the small noise.
    // A racing line that climbs a hill mid-corner is not a racing line.
    {
      const near = closestOnPolyline(x, z, CIRCUIT_TRACK)
      // Wider than the racing surface, because the corridor has to carry
      // the RUN-OFF with the track — a track raised three metres out of
      // ground that stayed flat is a track on a plinth, with a drop off
      // both kerbs. That matters more now than it did with the authored
      // profile, because a level lap differs from the natural ground by
      // more than the profile ever did.
      if (near.distance < CIRCUIT_HALF * 6) {
        const on = 1 - smoothstep(near.distance, CIRCUIT_HALF * 1.15, CIRCUIT_HALF * 3)
        const shoulder = 1 - smoothstep(near.distance, CIRCUIT_HALF * 2.6, CIRCUIT_HALF * 6)
        if (shoulder > 0) {
          // ONE HEIGHT FOR THE WHOLE LAP. The target used to be
          // `smoothGround` on the centreline plus the authored
          // `CIRCUIT.elevation` profile, faded out near the coast; a
          // racing floor that is not deformed by the terrain cannot
          // have either. See CIRCUIT_LEVEL for what the flat lap costs
          // the ground around it.
          height = height * (1 - shoulder) + CIRCUIT_LEVEL * shoulder
          height = height * (1 - on) + CIRCUIT_LEVEL * on
          // Only the racing surface is defended from the shore below —
          // not the run-off. A 30 m plateau held level all the way to
          // the waterline is a sea wall, and the west run is eighteen
          // metres from the beach.
          built = Math.max(built, on)
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
      let roadHeight = smoothGround(near.px, near.pz)
      for (const district of districts) {
        if (!district.plate) continue
        const dd = Math.hypot(near.px - district.x, near.pz - district.z)
        const shoulder = district.plate * 0.8 + 22
        if (dd > shoulder) continue
        const inside = 1 - smoothstep(dd, district.plate * 0.8, shoulder)
        const target = smoothGround(district.x, district.z) + (DISTRICT_ELEVATION[district.id] ?? 0)
        roadHeight = roadHeight * (1 - inside) + target * inside
      }
      // And a road that runs into a RAMP climbs its pad, for the same
      // reason and by the same arithmetic. Without this the corridor
      // is applied after the pad and cuts it back down: the approach
      // road ends ten metres inside the east ramp's footprint, so the
      // ramp's low end stood 3.5 m in the air and could not be driven
      // onto at all.
      const ramp = rampPadAt(near.px, near.pz)
      if (ramp.inside > 0) roadHeight = roadHeight * (1 - ramp.inside) + ramp.height * ramp.inside
      // And a road that CROSSES THE RACING SURFACE takes the track's own
      // level, by the same arithmetic again. Roads are flattened after
      // the circuit and so win over it, which is right everywhere except
      // here: see ROADS_ON_CIRCUIT for the 4.33 m bump it was leaving.
      if (ROADS_ON_CIRCUIT.has(road.id)) {
        const track = closestOnPolyline(near.px, near.pz, CIRCUIT_TRACK)
        const onTrack = 1 - smoothstep(track.distance, CIRCUIT_HALF * 1.15, CIRCUIT_HALF * 3)
        if (onTrack > 0) roadHeight = roadHeight * (1 - onTrack) + CIRCUIT_LEVEL * onTrack
      }
      height = height * (1 - on) + roadHeight * on
      built = Math.max(built, on)
    }

    // A road may CLIMB a ramp's pad; it may not cut one. See
    // ROAD_PROOF_RAMPS for the metre of step this repairs, and for why
    // the circuit's own jump is not in that list.
    {
      const pad = rampPadAt(x, z, ROAD_PROOF_RAMPS)
      if (pad.inside > 0) {
        height = height * (1 - pad.inside) + pad.height * pad.inside
        built = Math.max(built, pad.inside)
      }
    }

    /*
      Play spots that build one continuous surface level their own
      ground, the same way a district plate does — and they do it AFTER
      the circuit and the roads, because a venue is a building and a
      track's run-off shoulder is not.

      That ordering is not a preference, it is a bug fix. The circuit's
      corridor carries the ground with it out to six half-widths — 30 m
      at CIRCUIT.width 10, and it was 42 m at 14 — and the bowling
      precinct's west end is twenty metres from the
      top loop's exit. Flattened before the circuit, the venue's pad was
      overwritten by that shoulder and its own probe then set the deck
      SIX METRES above the lane: the car was put down inside the
      foundation and ejected through the floor on every throw.

      A spot may declare a `pad` — a RECTANGLE — instead of a `flat`
      radius. The bowling venue is 62 m long and 12 wide: a disc big
      enough to hold it levels fourteen thousand square metres of the
      north coast, and a disc small enough not to left the drive-up
      apron hanging off the end of the flattening, which is where the
      plinth used to become a wall.
    */
    for (const spot of PLAY_SPOTS) {
      if ('pad' in spot && spot.pad) {
        const pad = spot.pad
        const cos = Math.cos(pad.rotation)
        const sin = Math.sin(pad.rotation)
        const dx = x - pad.x
        const dz = z - pad.z
        const along = Math.abs(dx * cos + dz * sin)
        const across = Math.abs(-dx * sin + dz * cos)
        const half = pad.length / 2
        const wide = pad.width / 2
        if (along > half + 20 || across > wide + 20) continue
        const inside = (1 - smoothstep(along, half, half + 18)) * (1 - smoothstep(across, wide, wide + 18))
        if (inside <= 0) continue
        /*
          `pad.level` is the point whose ground the pad flattens TO,
          and it defaults to the pad's own centre.

          It exists because a venue can need two rectangles: the
          labyrinth levels its 41.8 m square and, separately, the
          twelve metres of approach in front of its mouth. Levelled to
          its own centre, that second pad held the approach at the
          natural ground there — 3.4 m above the maze's floor — and put
          a step across the only way in, with the mouth trigger and the
          start prompt floating above it.
        */
        const level = 'level' in pad && pad.level ? pad.level : [pad.x, pad.z]
        height = height * (1 - inside) + smoothGround(level[0], level[1]) * inside
        built = Math.max(built, inside)
        continue
      }
      if (!('flat' in spot) || !spot.flat) continue
      const distance = Math.hypot(x - spot.x, z - spot.z)
      if (distance > spot.flat * 2.2) continue
      const inside = 1 - smoothstep(distance, spot.flat * 0.85, spot.flat * 2.1)
      if (inside <= 0) continue
      const target = smoothGround(spot.x, spot.z)
      height = height * (1 - inside) + target * inside
      built = Math.max(built, inside)
    }

    /*
      THE SHORE WINS, and it has to be applied LAST.

      This used to run before the plates, the ramps, the circuit and
      the roads, so anything flattened near the water flattened THROUGH
      the beach: the circuit's west straight is eighteen metres inside
      the coastline and its corridor cut a 42° step into the sand on
      two bearings, which `world-shore-check.mjs` reported and which is
      exactly the "you cannot drive onto the beach" defect the shore
      profile exists to prevent.

      Applied here, the built world is carried down to the waterline
      instead of over it. Nothing inland is touched: `onShore` is zero
      more than twenty-seven metres in.

      BUT IT NO LONGER WINS OVER BUILT GROUND, except at the waterline.

      Twenty-seven metres inland is far enough to reach a pad nobody
      would call coastal, and running last meant the shore quietly undid
      every flatten stage above it — 2.97 m out of the bowling deck,
      4.30 m out of the labyrinth's pad, 4.40 m across the projects
      plate. Weakened by `built` it gives those floors back, and it
      touches nothing that was already natural.

      The second factor is the safety valve, and it is not optional. The
      labyrinth's plate already overhangs the coastline — its south-east
      corner measured 6.1 m out to sea — and built ground that wins
      unconditionally there is a plinth standing in the water with a step
      at its foot, which `world-shore-check.mjs` reports as a wall. From
      two metres out to eight metres in, the shore takes the ground back
      whatever is built on it.
    */
    const inset = coastInset(x, z)
    const over = -inset
    const onShore = smoothstep(over, -BEACH.sand - 12, -BEACH.sand + 4)
      * (1 - built * smoothstep(inset, -2, 8))
    if (onShore > 0) height = height * (1 - onShore) + shoreHeight(over) * onShore

    /*
      THE LANDING SHOAL, in front of a ramp that points at the sea.

      `world.ts` said of the east ramp that "the shelf there is 0.6 m
      deep, so you drive out again", and the general shelf is — for
      fifteen metres past the waterline. A full-boost launch off a
      5.6 m ramp covers seventy-eight, and the run that does NOT boost
      does not clear the lip at all: every use of the island's one big
      jump ended eleven metres under, recovered by the drowning rule.
      A jump whose only landing is a respawn is not a jump.

      So the shoal follows the ramp: a corridor along its own axis,
      out to LANDING_REACH past the lip and a little wider than the
      deck, in which the water may not be deeper than LANDING_DEPTH.
      It never RAISES the sea bed anywhere the sea bed is already
      shallower, and it only exists in front of the ramps that are
      aimed at the water, so the rest of the coast still drops away.
    */
    for (const ramp of LANDING_SHOALS) {
      const dx = x - ramp.x
      const dz = z - ramp.z
      const along = dx * Math.cos(ramp.rotation) + dz * Math.sin(ramp.rotation)
      const across = Math.abs(-dx * Math.sin(ramp.rotation) + dz * Math.cos(ramp.rotation))
      if (along < ramp.length / 2 || along > ramp.length / 2 + LANDING_REACH) continue
      const half = ramp.width / 2 + 12
      if (across > half + 12) continue
      // Fades out at the sides and at the far end, so the shoal joins
      // the sea bed instead of standing on it as a shelf with a wall.
      const sides = 1 - smoothstep(across, half, half + 12)
      const end = 1 - smoothstep(along - ramp.length / 2, LANDING_REACH - LANDING_FADE, LANDING_REACH)
      const inside = sides * end
      if (inside <= 0) continue
      const floor = OCEAN_LEVEL - LANDING_DEPTH
      if (height >= floor) continue
      height = height * (1 - inside) + Math.max(height, floor) * inside
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

      NOT weakened by `built`, and that is a reversal of what the survey
      for this pass asked for, so here are the four measurements that
      reversed it. Baseline, aprons left alone: worst lake approach
      23.9°, worst inland cross-track relief on the racing surface
      0.972 m. (a) `1 - built`: the approach to lake-west-0 goes to
      35.1°, because the TNT pad is authored with its east edge 0.3 m
      from that lake and a pad held level over a bank is a wall.
      (b) guarded by normalised ellipse radius: 28.2°, and MORE relief
      across the TNT pad, not less — a normalised radius is not a
      distance on a lake twice as long as it is wide, so the valve
      protected half the pad and tilted it worse. (c) guarded by
      `inlandWater`'s own reach: 55.0°. (d) weakened by the corridor
      weight alone, sparing the pads: 29.2°, and the track improved only
      to 0.854 m.
      All four bought a tenth of a metre and cost five to thirty degrees
      of bank, because what is actually under the racing line at
      (-56, 42) is not the apron — it is the WATER, three metres away,
      and the carve below is deliberately not weakened. Moving the
      racing line off Cold Tarn's edge is the fix, and it lives in
      `world-environment.ts`.
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

    /*
      AND THE RIVER GETS ONE TOO, for exactly the reason the lakes did.

      The apron above is keyed on a lake's normalised ellipse radius,
      so the river — a polyline, not an ellipse — was never in it. On a
      380 m island that did not matter: the ground either side of the
      landing river was within a metre of its level. At 0.7 the eastern
      landform rise sits thirty per cent closer, and the bank climbed
      from -0.7 m at x 55 to 6.9 m at x 64 — a 53 degree wall the whole
      length of the east bank. `world-tour.mjs` put the car on its roof
      against it three legs running and could not reach the two stops
      beyond.

      Fourteen metres of easing, the same as the lakes get, towards a
      metre and a half above the water: enough that the ford at the
      landing end is a slope rather than a step, and short enough that
      it does not flatten the rise the ramp launches off.
    */
    {
      const along = lineDistance(x, z, RIVER.points)
      const bankStart = RIVER.width / 2 + BANK_WIDTH
      const apron = bankStart + 14
      /*
        AND IT STOPS WHERE THE RIVER STOPS.

        `lineDistance` measures to a capsule, so past the last drawn
        vertex this apron was a 28.4 m DISC of "flatten to 0.80 m"
        standing on dry ground — and the river is drawn ending inland
        at both ends, so there were two of them. The east one sits on
        the hillside the PROJECTS district is built on. Four separate
        surveys measured it and gave it four different names: 4.50 m
        out of the projects plate; 4.03, 3.66 and 3.46 m of camber
        across the three roads at that junction; the projects respawn
        5.72 m below the terminal it is meant to serve; and, twenty
        metres further on, 1.13 m out of the east ramp's pad — which is
        where that ramp's unjumpable 0.83 m step came from.

        Twelve metres of fade rather than the carve's six: an apron is
        a shoulder, and a shoulder that ends abruptly is the thing the
        apron exists to prevent.
      */
      const past = polylineOverrun(x, z, RIVER.points)
      const span = 1 - smoothstep(past, 0, APRON_END_FADE)
      if (span > 0 && along < apron) {
        const inside = (1 - smoothstep(along, bankStart, apron)) * span
        height = height * (1 - inside) + (RIVER.level + 1.5) * inside
      }
    }

    const water = inlandWater(x, z)
    const waterHere = water
    if (water) {
      // NOT weakened by `built`, unlike the shore and the aprons above.
      // The river fords are road corridors crossing flowing water, and
      // they only exist because the carve beats the corridor: defend the
      // road here and the two fords become level causeways with the
      // river running under them.
      // The bank runs a full BANK_WIDTH — the same distance
      // `inlandWater` reaches — so it finishes instead of being cut
      // off a third of the way down, which is what left every lake
      // wearing a ring cliff.
      const bank = smoothstep(water.edge, -BANK_WIDTH, 0)
      // Then a WADEABLE SHELF: the depth curve is raised to a power,
      // so the first few metres of water are ankle-deep and only the
      // middle is anything to worry about. At 4 m in a lake is 0.4 m
      // deep; the car drives in and drives out again.
      // Nine metres for flowing water, not six. The river is 18 m wide
      // — twice what it was — and at a six-metre reach it hit its full
      // 1.5 m four metres from the bank, which `world-shore-check.mjs`
      // correctly called unwadeable: you could not drive in and out of
      // it anywhere, so the bridge stopped being a convenience and
      // became the only crossing.
      const reach = water.flow > .9 ? 9 : 11
      const t = smoothstep(water.edge, 0, reach)
      const depth = water.depth * Math.pow(t, 1.9)
      height = height * (1 - bank) + (water.level - depth) * bank
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

        /*
          SUPPRESSION, separate from paving.

          Nothing grows past the shore, on paving, in water — or on the
          built ground the plan leaves white: the landing forecourt, the
          bowling precinct, the projects terrace, the maze floor, the
          ramp's run-up. Those are the polygons in VEGETATION_EXCLUSIONS.

          They are NOT folded into `paved`, because `paved` is also the
          red channel the minimap paints as forecourt, and a bowling
          venue is not a road. This is a second factor that touches only
          the grass.
        */
        let suppress = 0
        for (const zone of VEGETATION_EXCLUSIONS) {
          if (pointInPolygon(x, z, zone.polygon)) { suppress = 1; break }
        }
        // A play spot with a `flat` builds one continuous surface. The
        // terrain already levels it (see `heightAt`); this is what stops
        // it being a lawn with pins standing in it.
        if (!suppress) {
          for (const spot of PLAY_SPOTS) {
            if ('pad' in spot && spot.pad) continue  // its polygon is in VEGETATION_EXCLUSIONS
            if (!('flat' in spot) || !spot.flat) continue
            const distance = Math.hypot(x - spot.x, z - spot.z)
            suppress = Math.max(suppress, 1 - smoothstep(distance, spot.flat * 0.8, spot.flat * 1.15))
          }
        }

        const land = smoothstep(coastInset(x, z), 2, 11)
        const grass = Math.max(0, (1 - paved) * (1 - suppress) * (1 - Math.min(1, depth * 4)) * land)

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

  /**
   * The height of the ground you SEE, which is not the height of the
   * ground you drive on.
   *
   * `buildMesh` draws the plane at 384 / 200 / 128 segments by quality
   * and samples `colliderHeightAt` at its lattice points, so between
   * those points the drawn surface is a flat triangle across a cell up
   * to 2.73 m wide while the collider is exact to 0.91 m. Measured
   * along the whole road network, the drawn ground stands as much as
   * 0.094 m above the collider surface at high, 0.146 m at medium and
   * 0.241 m at low — worst beside the bridge, where the approach ramp
   * puts a real step under a coarse triangle.
   *
   * Anything laid ON the ground as a decal has to follow this and not
   * the collider. `Roads.ts` learnt it the expensive way: a ribbon on
   * `colliderHeightAt` with a 3.5 cm lift spends stretches of every
   * road at low quality buried inside the hill it is painted on.
   * Physics still uses `colliderHeightAt`, and must: the car drives on
   * the collider, not on the picture of it.
   */
  surfaceHeightAt(x: number, z: number): number {
    const step = this.meshStep
    const fx = (x + FIELD_HALF) / step
    const fz = (z + FIELD_HALF) / step
    const j = clamp(Math.floor(fx), 0, this.meshSegments - 1)
    const i = clamp(Math.floor(fz), 0, this.meshSegments - 1)
    const tx = clamp(fx - j, 0, 1)
    const tz = clamp(fz - i, 0, 1)

    const gx = (a: number) => -FIELD_HALF + a * step
    const h00 = this.colliderHeightAt(gx(j), gx(i))
    const h10 = this.colliderHeightAt(gx(j + 1), gx(i))
    const h01 = this.colliderHeightAt(gx(j), gx(i + 1))
    const h11 = this.colliderHeightAt(gx(j + 1), gx(i + 1))

    // The same diagonal PlaneGeometry and Rapier both use, so the decal
    // sits on the triangle the renderer actually draws rather than on a
    // smooth surface that crosses it twice per cell.
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
    this.meshSegments = segments
    this.meshStep = (FIELD_HALF * 2) / segments

    const geometry = new THREE.PlaneGeometry(FIELD_HALF * 2, FIELD_HALF * 2, segments, segments)
    geometry.rotateX(-Math.PI / 2)

    const position = geometry.getAttribute('position') as THREE.BufferAttribute

    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i)
      const z = position.getZ(i)
      // Sample the collider grid, not `heightAt`, so a lower-detail
      // visual mesh still sits exactly on the surface the car drives
      // on rather than on its own smoother version of it.
      position.setY(i, this.colliderHeightAt(x, z))
    }

    geometry.computeVertexNormals()

    /* THE `color` ATTRIBUTE IS GONE. It carried white ±0.02 of hashed
       grain and nothing else — three of the four THREE.Colors that fed
       it had been `void`ed for two rebuilds — so it was 1.78 MB of
       buffer breaking up a flat plain one VERTEX at a time, which at
       high quality is one value per 0.91 m and at low one per 2.73 m.
       `groundDetail` does the same job per FRAGMENT. */

    const material = this.materials.own(
      new THREE.MeshStandardMaterial({
        map: this.paintGround(bin),
        roughness: 0.96,
        metalness: 0,
        flatShading: false,
      }),
    )
    this.groundDetail(material)

    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.receiveShadow = this.quality.settings.shadows
    this.mesh.matrixAutoUpdate = false
    this.mesh.updateMatrix()
    this.group.add(this.mesh)
    bin.add(() => geometry.dispose())
  }

  /**
   * SURFACE BREAK-UP FOR THE GROUND, injected into the standard
   * material rather than baked into the colour map.
   *
   * The painted canvas cannot do this. One of its texels is 0.23 m of
   * ground, and the driving camera — a 25° lens on a 21 m boom — puts
   * about 116 screen pixels on a world metre, so a texel is 26 screen
   * pixels wide and 39 at devicePixelRatio 2. Anything drawn one texel
   * across therefore arrives on screen as a flat square. That is what
   * the deleted `grain` pass and the deleted `aggregate` chippings
   * were, and it is what the brief means by pixelated. Evaluating the
   * noise per fragment instead makes its resolution the screen's.
   *
   * Follows `Ecology.ts:material()` for the mechanics: uniforms onto
   * `shader.uniforms`, declarations prepended, one `#include` replaced.
   * three is 0.185.1, so the map varying is `vMapUv` and the hook is
   * `<map_fragment>`.
   *
   * No second UV set is needed, and that is not luck: the ground is a
   * PlaneGeometry spanning the whole field, so its default uv IS world
   * position — u = (x + FIELD_HALF) / (FIELD_HALF * 2) exactly — and
   * the canvas texture leaves repeat at (1,1), so `mapTransform` is the
   * identity and `vMapUv` can be read straight back out as metres.
   *
   * Weighted by the mask's own channels so it does not speckle a
   * forecourt or the sea bed, and faded out past 105 m: procedural
   * noise has no mipmaps, so at grazing distance it would alias into a
   * shimmer — which is the same defect as the squares, one octave up.
   */
  private groundDetail(material: THREE.MeshStandardMaterial): void {
    const grMask = { value: this.mask }
    const grExtent = { value: FIELD_HALF }
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { grMask, grExtent })
      shader.fragmentShader = `
        uniform sampler2D grMask;
        uniform float grExtent;
        float grHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
        float grNoise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(grHash(i), grHash(i + vec2(1.0, 0.0)), f.x),
                     mix(grHash(i + vec2(0.0, 1.0)), grHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
      ` + shader.fragmentShader
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        {
          vec2 grWorld = (vMapUv - 0.5) * grExtent * 2.0;
          // The car is what the camera follows, so distance to the
          // camera is the right fade axis: detail where you are, clean
          // ground where you can only see it at a grazing angle.
          float grNear = 1.0 - smoothstep(30.0, 105.0, distance(grWorld, cameraPosition.xz));
          if (grNear > 0.0) {
            vec4 grM = texture2D(grMask, vMapUv);
            // Half a metre and three metres. Coarser than a blade and
            // finer than anything the colour map draws, so the two
            // never describe the same feature twice.
            float grFine = grNoise(grWorld * 1.9) - 0.5;
            float grCoarse = grNoise(grWorld * 0.34 + 41.0) - 0.5;
            // Grass takes it all; sand, paving and plates take under
            // half, because a forecourt that is mottled reads as dirty
            // rather than as concrete. Water takes none: the lake bed
            // is seen through a refracting surface already.
            float grWeight = mix(0.42, 1.0, grM.g) * (1.0 - grM.b);
            diffuseColor.rgb *= 1.0 + (grFine * 0.17 + grCoarse * 0.11) * grWeight * grNear;
          }
        }
      `)
    }
  }

  /* ========================================================
     GROUND PAINT

     Districts, roads and markings are painted once into a single
     canvas covering the whole world, and used as the terrain's
     colour map.

     The obvious alternative — vertex colours on the terrain mesh —
     was the first attempt, and it does not work: the mesh has a
     vertex every 0.91 m at high and 2.73 m at low, so an 8 m road
     becomes a four-vertex smear and a district boundary becomes a
     soft stain. At 1536 px across 350 m this canvas has 0.23 m
     resolution, so a road edge is a road edge, and it costs one
     texture instead of 200,000 extra triangles.

     WHAT IT IS NOT FOR: surface detail. Everything here is at least
     twenty-six screen pixels across at the driving camera, so anything
     smaller than a couple of metres reads as a flat square rather than
     as texture. Colour zones only — sand, grass, woodland tint, plates,
     the circuit's bands, road hue. Grain comes from `groundDetail`.
     ======================================================== */

  private paintGround(bin: Bin): THREE.CanvasTexture {
    /* 1536, down from 2048. The canvas no longer carries anything finer
       than a colour boundary, and 1536 across a 350 m field is still
       0.23 m per texel — the same resolution 2048 gave on the 500 m
       field this was tuned for. It saves 9.8 MB of VRAM with mips and
       a proportional slice of the load-time paint. */
    const size = this.quality.level === 'low' ? 1024 : 1536
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('[world] 2D canvas unavailable')

    /** World metres → canvas pixels. */
    const toPx = (v: number) => ((v + FIELD_HALF) / (FIELD_HALF * 2)) * size
    const scale = size / (FIELD_HALF * 2)

    /*
      THE `aggregate` CHIPPINGS PATTERN IS GONE, and so is the grain
      pass that used to close this function. Both drew ONE-TEXEL
      features — 0.23 m of ground each — and the driving camera is a 25°
      lens on a 21 m boom, which spans about 16.6 m of ground and puts
      roughly 116 screen pixels on every world metre. One texel of this
      canvas is therefore 26 screen pixels, 39 at devicePixelRatio 2, and
      per-texel noise magnifies into exactly that: flat squares. That is
      the pixelation the brief is about, and no canvas size fixes it —
      one texel per screen pixel would need a 58,000 px map.

      Surface detail now comes from two places that are resolution-
      independent: `Roads.ts`, which gives the dirt tracks their own
      geometry and a tiling material, and the terrain material's own
      `onBeforeCompile` break-up. This canvas keeps the one thing it is
      genuinely good at — large-scale colour zoning.
    */
    ctx.fillStyle = palette.paper2
    ctx.fillRect(0, 0, size, size)

    /* ---- the island and its beach ------------------------
       The clip used to stop exactly at the coastline, so every metre
       of sand and shallow water past it was painted in the off-map
       backdrop colour — which is why the beach read as the edge of
       the texture rather than as a beach. It now runs out to the
       shelf, with a band of sand either side of the waterline.
    */
    /*
      THE COAST, OFFSET ALONG ITS OWN NORMAL.

      This used to walk 360 bearings and push each one `grow` metres
      further from the ORIGIN, which is only the same thing as an
      offset on a star-shaped island. This one has a bay bitten out of
      its north-east corner, and a radial push moved the bay's inner
      shore twenty-six metres further inland — so the wet-sand band was
      painted straight across the headland east of it and the bay read
      as a white wedge in the middle of the land.

      Offsetting each vertex along the average of its two adjacent edge
      normals is exact on a straight run and close enough on a curve at
      the twenty-six metres this is ever asked for.
    */
    const shorePath = (poly: typeof ISLAND, grow: number) => {
      ctx.beginPath()
      for (let i = 0; i < poly.length; i++) {
        const [x, z] = poly[i]
        const [ax, az] = poly[(i - 1 + poly.length) % poly.length]
        const [bx, bz] = poly[(i + 1) % poly.length]
        // Outward normal of each adjacent edge. The polygon is wound so
        // that (dz, -dx) points out to sea.
        const nx1 = z - az
        const nz1 = ax - x
        const nx2 = bz - z
        const nz2 = x - bx
        const l1 = Math.hypot(nx1, nz1) || 1
        const l2 = Math.hypot(nx2, nz2) || 1
        let nx = nx1 / l1 + nx2 / l2
        let nz = nz1 / l1 + nz2 / l2
        const len = Math.hypot(nx, nz) || 1
        nx /= len
        nz /= len
        const px = toPx(x + nx * grow)
        const py = toPx(z + nz * grow)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
    }
    const coastPath = (grow: number) => shorePath(ISLAND, grow)

    // Wet sand and the shallow shelf, out past the waterline.
    coastPath(26)
    ctx.fillStyle = '#a9a789'
    ctx.fill()
    coastPath(9)
    ctx.fillStyle = '#c9c2a0'
    ctx.fill()

    /*
      THE ISLET, painted before the island is clipped.

      It is a separate landmass — `coastInset` is the max over both, so
      the heightfield lifts it out of the north-east bay — and clipping
      to the island's own outline would have left it as a bare white
      hole in the middle of the water it stands in.
    */
    shorePath(ISLET, 9)
    ctx.fillStyle = '#c9c2a0'
    ctx.fill()
    shorePath(ISLET, 0)
    ctx.fillStyle = '#ded4ae'
    ctx.fill()
    shorePath(ISLET, -7)
    ctx.fillStyle = '#8fa76c'
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

    /*
      Woodland tint, as ELLIPSES — the drawing's green masses are long
      and thin (the strip inside the circuit's west run is 23 by 44 m)
      and painting them as circles put a third of the tint on the
      racing line.

      The colour split used to be `z < -160`, which no forest on the
      island had ever reached; it is density now, which is a thing the
      data actually varies.
    */
    for (const zone of VEGETATION_ZONES) {
      const rx = zone.rx * scale * 1.35
      const rz = zone.rz * scale * 1.35
      ctx.save()
      ctx.translate(toPx(zone.x), toPx(zone.z))
      ctx.scale(1, rz / rx)
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
      gradient.addColorStop(0, zone.density > 0.8 ? '#7b9569' : '#859b64')
      gradient.addColorStop(0.68, '#91a570')
      gradient.addColorStop(1, '#b6be8800')
      ctx.fillStyle = gradient
      ctx.fillRect(-rx, -rx, rx * 2, rx * 2)
      ctx.restore()
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
       This comment used to claim the shoulders were drawn BEFORE the
       district plates and the carriageway after them, so that a lane
       crossing a paved forecourt would not carry a gravel verge across
       it. They were not and they are not: the district loop is above,
       this one is below, and every shoulder is painted on top of every
       plate. The claim was a description of an intention, and the
       junction-looks-like-roadworks defect it says it fixed is still
       live wherever four roads meet the landing plate.

       It is left in this order deliberately, because the shoulder no
       longer has to do much work: `Roads.ts` lays real geometry over the
       carriageway with a skirt that fades into the ground, and what is
       painted here is only the colour the skirt fades INTO.
    */
    const ROAD_PASSES = ['surface', 'wear', 'edgeLine', 'centre'] as const

    const trace = (road: (typeof roads)[number]) => {
      ctx.beginPath()
      road.points.forEach(([x, z], i) => {
        const px = toPx(x)
        const py = toPx(z)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      })
    }
    /*
      COMPACT EARTH, not tarmac.

      The plan draws every connector in brown, and only the circuit in
      grey — which is most of what makes the circuit read as a circuit
      from above. This used to be `road.id === 'void-run'`, a single
      hard-coded exception; the surface is declared per road now, and
      every path on this island declares dirt.
    */
    const dirt = (road: (typeof roads)[number]) => road.surface === 'dirt'

    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const road of roads) {
      trace(road)
      // A dirt track's shoulder is scuffed earth, not kerbstone: with
      // the paved shoulder under it every path on the island wore a
      // pale grey outline and read as tarmac from above anyway.
      ctx.strokeStyle = dirt(road) ? palette.roadDirtEdge : palette.roadShoulder
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

       Run-off, then tarmac, then a racing line worn into it, then
       red-and-white kerbing on both edges. The per-texel chippings pass
       that used to sit between the tarmac and the racing line is gone
       with the rest of the one-texel noise; `CircuitRace.buildTrack`
       lays its own ribbon over this anyway. */
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

      // The racing line: a polished band a little inside the middle.
      traceTrack(0)
      ctx.strokeStyle = palette.roadLight
      ctx.globalAlpha = 0.26
      ctx.lineWidth = W * 0.5 * scale
      ctx.stroke()
      ctx.globalAlpha = 1

      /*
        THE RED BORDER, then the kerbs on top of it.

        The plan draws the whole circuit outlined in dark red, and that
        outline is most of what makes it readable as a circuit from
        above. A dashed kerb alone does not do it: at map scale the
        dashes blur into the tarmac and the track loses its edge, which
        is the one thing the drawing is emphatic about.

        So: a continuous barrier stripe on both sides first, and the
        red-white kerbing dashed over it.
      */
      for (const side of [-1, 1]) {
        traceTrack(side * (W * 0.5 + 1.5))
        ctx.strokeStyle = '#8f2c1c'
        ctx.lineWidth = 2.6 * scale
        ctx.stroke()
      }
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
       Shoulder, then carriageway, then wear down the wheel tracks, then
       markings, outside in. The road has to read as a surface from a
       thirty-metre camera, which means it needs an EDGE — the old
       two-tone concrete ribbon dissolved into the paving it crossed.

       A road that declares `surface: 'dirt'` skips the edge lines,
       the centre line and the wheel-track wear: those are the marks
       of a made carriageway, and every connector on this island is a
       compact-earth track — so for now this whole loop paints one flat
       brown stroke per road and nothing else.

       That is on purpose. The dirt road you actually see is `Roads.ts`,
       geometry with a tiling material at 0.008 m per texel; this stroke
       is the colour underneath it, so the ribbon's fade skirt has
       something of the right hue to dissolve into and the minimap and
       the far field still read a road where the ribbon has thinned. */
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

    /* ---- grain, removed ---------------------------------
       A whole-canvas ImageData pass used to add ±4.5/255 of noise to
       every texel here, to stop the ground reading as a flat fill under
       a directional light. It was the right instinct at the wrong
       resolution: one texel of this canvas magnifies to 26 screen
       pixels at the default camera, so what it drew was a field of
       flat squares — half of the "pixelated" the brief is about, the
       roads being the other half. `groundDetail` does the same job per
       FRAGMENT — at the screen's resolution rather than at 0.23 m per
       texel — and it costs nothing at load, where this pass was
       4.19 M pixels of JavaScript before the first frame. */

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
