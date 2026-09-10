import * as THREE from 'three'
import { CIRCUIT, CIRCUIT_TRACK, lineDistance } from '@/content/world-environment'
import { palette } from '../../core/palette'
import { mergeParts } from '../decorGeometry'
import { chamferedBox, extrudeOutline, strutGeometry, wheelGeometry } from '../geometry'
import type { MaterialName } from '../materials'
import type { Dressing } from '../kit'

/* ============================================================
   THE VOID

   Playground builds the black hole itself — the event horizon, the
   three accretion rings, the crater lip — and it is the one thing on
   the island you go round every lap and never touch. So this layer
   has exactly one job: make the ground around it agree that the
   physics is wrong here, from a car doing seventy on the far side of
   the ring.

   IT IS MUCH CLOSER TO THE TRACK THAN IT LOOKS. Measured against
   CIRCUIT_TRACK, the crater's centre is 20.3 m from the racing
   centreline, not the ~29 the brief assumed, and a plain 14 m ring
   of monoliths would put a stone 6.3 m off the centreline on the
   south-west bearing — 1.3 m outside the kerb of a 10 m track. So
   NO RADIUS IS AUTHORED HERE. Every ring is solved per bearing
   against the track polyline (`reach`), which both fixes that and is
   the only version that survives the next rescale.

   AND NOTHING PULLS. The pull is an interaction with a four-second
   life, deliberately, because a force field that reached the racing
   surface would be a physics bug wearing a costume. Everything below
   is static geometry or a ticker that writes matrices.

   COLLIDERS ARE ALMOST ABSENT, and where they exist they are the
   footing rather than the thing. A monolith leans 15-30 degrees and
   `solidBox`'s collider carries a Y rotation only, so a leaning slab
   would get an upright box a metre away from where it looks: the
   stones stand on visible 0.8 m concrete footings, and those are
   what a 2.5 kg car hits. The fence has no colliders at all, which
   is the joke — you drive straight through it.
   ============================================================ */

/**
 * Metres of grass a piece must leave between itself and the racing
 * centreline. Half the surface, plus 5.5 for run-off — and that
 * second number is measured, not chosen: `world-layout` gives the
 * circuit a footprint 8.3 m wide from the centreline, so 10.5 is the
 * nearest a monolith can stand and still be two metres clear of the
 * ground the layout validator says belongs to the track.
 */
const CLEAR = CIRCUIT.width / 2 + 5.5

export function dressBlackHole(kit: Dressing): void {
  const core = kit.spot('blackHole') ?? kit.district('blackhole')
  const zone = kit.district('blackhole')
  const ground = kit.groundAt(core.x, core.z)
  /** Playground draws the crater lip at `radius - 2`; everything here
   *  is measured from that edge rather than from a second opinion
   *  about how big the hole is. */
  const RIM = zone.radius - 2

  const xAxis = new THREE.Vector3(1, 0, 0)

  /** File a geometry into a merge bucket, already in world space. */
  const put = (
    material: MaterialName,
    geometry: THREE.BufferGeometry,
    x: number, y: number, z: number,
    turn?: THREE.Quaternion,
  ): void => {
    if (turn) geometry.applyQuaternion(turn)
    geometry.translate(x, y, z)
    kit.add(material, geometry)
  }

  /** Tip something's +Y toward the core by `angle`, on the bearing it
   *  stands on. The axis is up × outward, so +angle falls inward. */
  const fall = (bearing: number, angle: number): THREE.Quaternion =>
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(Math.sin(bearing), 0, -Math.cos(bearing)),
      -angle,
    )

  /** A box stretched between two points: fence rails, roll bars. */
  const beam = (material: MaterialName, a: THREE.Vector3, b: THREE.Vector3, thick: number): void => {
    const length = a.distanceTo(b)
    const geometry = chamferedBox(length, thick, thick, thick * 0.3)
    const turn = new THREE.Quaternion().setFromUnitVectors(xAxis, b.clone().sub(a).normalize())
    put(material, geometry, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, turn)
  }

  /**
   * The furthest point on `bearing` that still leaves the track
   * alone, walking in from `wanted` half a metre at a time. Returns
   * the 5 m ring if even that fails, which cannot happen at 20.3 m
   * from the centreline but would keep a rescale inside the crater
   * rather than on the racing line.
   */
  const reach = (bearing: number, wanted: number) => {
    for (let r = wanted; r > 6; r -= 0.5) {
      const x = core.x + Math.cos(bearing) * r
      const z = core.z + Math.sin(bearing) * r
      if (lineDistance(x, z, CIRCUIT_TRACK) >= CLEAR) return { x, z, r }
    }
    return { x: core.x + Math.cos(bearing) * 6, z: core.z + Math.sin(bearing) * 6, r: 6 }
  }

  /** The tightest bearing on the whole ring — where the track comes
   *  nearest — and therefore the widest anything may be. */
  let tight = Infinity
  for (let i = 0; i < 24; i++) tight = Math.min(tight, reach((i / 24) * Math.PI * 2, RIM + 6).r)

  /**
   * A visible concrete footing, and the only collider a stone gets.
   *
   * THE COLLIDER IS TALLER THAN THE BLOCK, and that is the point. A
   * 0.8 m box with a chamfered lip is the worst obstacle there is for
   * a 2.5 kg car: it does not stop it, it launches it. `world-qa`
   * reported BLACK HOLE as "rolled on open ground" on two runs in
   * three, which is the district full of leaning stones being read as
   * a terrain fault. Two and a half metres of collider over the same
   * footprint is a thing the car stops against, and the monolith it
   * belongs to is five and a half metres tall and leaning over it, so
   * nothing invisible is being added — the stone is already there.
   */
  const footing = (x: number, z: number, w: number, d: number, yaw: number): void => {
    const height = 0.8
    const solid = 2.5
    const y = kit.groundAt(x, z)
    const block = chamferedBox(w, height, d, 0.1)
    block.rotateY(yaw)
    put('concreteDark', block, x, y + height / 2, z)
    kit.game.physics.add({
      type: 'fixed',
      category: 'floor',
      position: { x, y: y + solid / 2, z },
      rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
      friction: 0.7,
      restitution: 0.12,
      colliders: [{ shape: 'cuboid', parameters: [w / 2, solid / 2, d / 2] }],
    })
  }

  /* ---- seven stones falling inward --------------------------
     The whole read from the track is this: a ring of dark slabs
     that are not upright. Nothing else here is legible at 60 m. */
  const STONES = 7
  for (let i = 0; i < STONES; i++) {
    const bearing = (i / STONES) * Math.PI * 2 + 0.4
    const spot = reach(bearing, RIM + 2 + kit.rand() * 3)
    const height = 4.6 + kit.rand() * 1.8
    const lean = 0.26 + kit.rand() * 0.26
    const yaw = bearing + Math.PI / 2
    const y = kit.groundAt(spot.x, spot.z)

    const slab = chamferedBox(1.2, height, 0.9, 0.1)
    slab.translate(0, height / 2, 0)
    slab.rotateY(yaw)
    put('ink', slab, spot.x, y + 0.55, spot.z, fall(bearing, lean))
    footing(spot.x, spot.z, 1.9, 1.5, yaw)
  }

  /* ---- the fence you drive through --------------------------
     Fourteen posts leaning inward with two rails that follow the
     lean, and NOT ONE COLLIDER. A warped fence that stopped a car
     would just be a wall; one you pass through says the boundary
     stopped meaning anything. */
  const POSTS = 14
  const ring: { top: THREE.Vector3; mid: THREE.Vector3 }[] = []
  for (let i = 0; i < POSTS; i++) {
    const bearing = (i / POSTS) * Math.PI * 2
    const spot = reach(bearing, RIM + 4)
    const y = kit.groundAt(spot.x, spot.z)
    // The lean grows with the bearing's own noise, so the ring reads
    // as pulled rather than as a decoration with a tilt applied.
    const lean = 0.18 + kit.rand() * 0.34
    const turn = fall(bearing, lean)
    const post = chamferedBox(0.14, 1.9, 0.14, 0.03)
    post.translate(0, 0.95, 0)
    put('metal', post, spot.x, y, spot.z, turn.clone())
    const tip = new THREE.Vector3(0, 1.75, 0).applyQuaternion(turn)
    ring.push({
      top: new THREE.Vector3(spot.x + tip.x, y + tip.y, spot.z + tip.z),
      mid: new THREE.Vector3(spot.x + tip.x * 0.55, y + tip.y * 0.55, spot.z + tip.z * 0.55),
    })
  }
  for (let i = 0; i < POSTS; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % POSTS]
    beam('metal', a.top, b.top, 0.09)
    beam('metal', a.mid, b.mid, 0.07)
  }

  /* ---- the road that stops ----------------------------------
     Laid on the bearing with the most room, found by sampling
     rather than authored: the free ground here is a crescent on
     the north-east side and the track is everywhere else. */
  let best = { bearing: 0, r: 0 }
  for (let i = 0; i < 24; i++) {
    const bearing = (i / 24) * Math.PI * 2
    const spot = reach(bearing, RIM + 16)
    if (spot.r > best.r) best = { bearing, r: spot.r }
  }
  // Half the deck's own width comes off the run: `reach` solves a
  // point on the bearing, and a 6 m slab's outer corners stand 3 m
  // either side of it.
  const ROAD_WIDTH = 6
  const roadLength = Math.max(6, best.r - ROAD_WIDTH / 2 - RIM)
  const roadMid = RIM + roadLength / 2
  const rx = core.x + Math.cos(best.bearing) * roadMid
  const rz = core.z + Math.sin(best.bearing) * roadMid
  const deck = chamferedBox(roadLength, 0.3, ROAD_WIDTH, 0.05)
  deck.rotateY(-best.bearing)
  // No collider: 0.3 m of asphalt lying ON the ground, and a cuboid
  // under it would be a step across the crater mouth that a car
  // arriving at speed would trip over.
  put('asphalt', deck, rx, kit.groundAt(rx, rz) + 0.15, rz)

  // …and its inner end coming apart into six tilted slabs.
  for (let i = 0; i < 6; i++) {
    const spread = (i % 3 - 1) * 2.4
    const back = RIM - 1.2 - Math.floor(i / 3) * 2.6
    const x = core.x + Math.cos(best.bearing) * back - Math.sin(best.bearing) * spread
    const z = core.z + Math.sin(best.bearing) * back + Math.cos(best.bearing) * spread
    const chunk = chamferedBox(2.2, 0.3, 2.4, 0.05)
    chunk.rotateY(-best.bearing + (kit.rand() - 0.5) * 0.7)
    const tilt = new THREE.Quaternion().setFromEuler(
      new THREE.Euler((kit.rand() - 0.5) * 0.5, 0, (kit.rand() - 0.5) * 0.5),
    )
    put('asphalt', chunk, x, kit.groundAt(x, z) + 0.15 - kit.rand() * 1.4, z, tilt)
  }

  /* ---- the lamppost that gave up ----------------------------
     SceneryDetails' road lantern, in three segments of increasing
     lean, with its head stretched along the radius. One joke object
     that states the local rule out loud. */
  const lampBearing = best.bearing + Math.PI * 0.35
  const lamp = reach(lampBearing, RIM + 1.5)
  let px = lamp.x
  let py = kit.groundAt(lamp.x, lamp.z)
  let pz = lamp.z
  let bend = 0.1
  for (let i = 0; i < 3; i++) {
    bend += 0.2 * (i + 1)
    const length = 1.4 - i * 0.15
    const turn = fall(lampBearing, bend)
    const segment = strutGeometry(0.13 - i * 0.02)
    segment.scale(1, length, 1)
    put('metal', segment, px, py, pz, turn.clone())
    const step = new THREE.Vector3(0, length, 0).applyQuaternion(turn)
    px += step.x
    py += step.y
    pz += step.z
  }
  const head = new THREE.SphereGeometry(0.34, 10, 7)
  head.scale(2.1, 0.7, 0.9)
  head.rotateY(lampBearing)
  put('emissiveCool', head, px, py, pz)
  footing(lamp.x, lamp.z, 0.9, 0.9, lampBearing)

  /* ---- the husk ---------------------------------------------
     Somebody parked. Nose-down at forty degrees inside the rim, no
     collider — half of it is under the ground and the half that is
     not is 4 m from an accretion ring nobody drives through. */
  const huskBearing = best.bearing + Math.PI
  const hx = core.x + Math.cos(huskBearing) * (RIM - 3)
  const hz = core.z + Math.sin(huskBearing) * (RIM - 3)
  const hy = kit.groundAt(hx, hz)
  const dive = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(Math.sin(huskBearing), 0, -Math.cos(huskBearing)),
    0.7,
  )
  const body = chamferedBox(2.6, 0.7, 1.4, 0.12)
  body.rotateY(-huskBearing)
  put('graphite', body, hx, hy + 0.15, hz, dive.clone())
  for (const [dx, dz] of [[0.85, 0.72], [0.85, -0.72], [-0.85, 0.72], [-0.85, -0.72]]) {
    // `wheelGeometry` already lies on Z, which is across a body
    // whose 2.6 m length runs along X: no extra turn, or the husk
    // gets four wheels facing the way it is trying to go.
    const wheel = wheelGeometry(0.42, 0.3, 10)
    wheel.translate(dx, 0, dz)
    wheel.rotateY(-huskBearing)
    put('ink', wheel, hx, hy + 0.15, hz, dive.clone())
  }

  /* ---- gravity arrows ---------------------------------------
     Twelve chevrons laid flat pointing inward, shrinking as they
     go. Unlit and 40 % opaque, so they read as paint on the dark
     ground rather than as objects standing on it — which is also
     why they are one mesh with one material instead of twelve. */
  const chevron: [number, number][] = [
    [-0.7, 0], [0, 0.9], [0.7, 0], [0.7, -0.4], [0, 0.5], [-0.7, -0.4],
  ]
  const arrows: THREE.BufferGeometry[] = []
  for (let i = 0; i < 12; i++) {
    const bearing = (i / 12) * Math.PI * 2 + 0.26
    const step = RIM - 1 - (i % 3) * 2.2
    const scale = 0.7 + (i % 3) * 0.25
    const x = core.x + Math.cos(bearing) * step
    const z = core.z + Math.sin(bearing) * step
    const mark = extrudeOutline(chevron, 0.06)
    mark.scale(scale, scale, 1)
    mark.rotateX(-Math.PI / 2)
    // The outline points at +Y, which lands on −Z once it is laid
    // flat. π/2 − bearing turns that onto the inward radius, so every
    // chevron points at the core rather than around it.
    mark.rotateY(Math.PI / 2 - bearing)
    mark.translate(x, kit.groundAt(x, z) + 0.07, z)
    arrows.push(mark)
  }
  const arrowMesh = new THREE.Mesh(
    mergeParts(arrows),
    kit.game.materials.flat(palette.chalk3, 0.4),
  )
  arrowMesh.renderOrder = 2
  kit.group.add(arrowMesh)
  kit.bin.add(() => arrowMesh.geometry.dispose())

  /* ---- the only dark sky on the island ----------------------
     A dome of specks over the crater. `Lighting` keeps the clock
     inside DAYLIGHT_RANGE forever, so this is the one place a
     visitor sees stars, and it costs one InstancedMesh.

     Its radius is not chosen, it is solved: the dome starts at 43
     degrees of elevation and is sized so that its widest ring lands
     exactly on `tight`, the nearest the track comes to the crater on
     any bearing. So the lowest speck is about 8 m up and no part of
     the dome hangs over the racing surface — which is the rule for
     this whole district, applied to the one piece of it that is
     supposed to look infinite. */
  const HORIZON = 0.75
  const domeRadius = tight / Math.cos(HORIZON)
  const starCount = kit.game.quality.count(180, 60)
  const speck = new THREE.IcosahedronGeometry(0.17, 0)
  const stars = new THREE.InstancedMesh(
    speck,
    kit.game.materials.flat('#c8d4e8', 0.55),
    starCount,
  )
  const matrix = new THREE.Matrix4()
  for (let i = 0; i < starCount; i++) {
    const bearing = kit.rand() * Math.PI * 2
    const elevation = HORIZON + kit.rand() * (Math.PI / 2 - HORIZON)
    const r = domeRadius * (0.85 + kit.rand() * 0.15)
    matrix.makeTranslation(
      core.x + Math.cos(bearing) * Math.cos(elevation) * r,
      ground + Math.sin(elevation) * r,
      core.z + Math.sin(bearing) * Math.cos(elevation) * r,
    )
    stars.setMatrixAt(i, matrix)
  }
  stars.instanceMatrix.needsUpdate = true
  stars.castShadow = false
  stars.receiveShadow = false
  kit.group.add(stars)
  kit.bin.add(() => speck.dispose())

  /* ---- the debris ring --------------------------------------
     Forty chunks orbiting between the horizon and the outer
     accretion ring, each at its own rate so the ring shears instead
     of turning as a plate. One InstancedMesh, one ticker, and no
     colliders — the lowest orbit is 4 m up. */
  const chunkCount = kit.game.quality.count(40, 16)
  const chunkGeometry = new THREE.IcosahedronGeometry(0.5, 0)
  const debris = new THREE.InstancedMesh(chunkGeometry, kit.game.materials.get('graphite'), chunkCount)
  debris.castShadow = false
  // `Frustum.intersectsObject` reads an InstancedMesh's own bounding
  // sphere and computes it ONCE, lazily. The stars can live with that
  // because they never move; these chunks would be culled against the
  // sphere they happened to fill on the first frame they were tested,
  // and the ring would pop out of view mid-orbit.
  debris.frustumCulled = false
  kit.group.add(debris)
  kit.bin.add(() => chunkGeometry.dispose())

  const orbits = Array.from({ length: chunkCount }, () => ({
    radius: 6.5 + kit.rand() * 3,
    height: 4 + kit.rand() * 4.5,
    phase: kit.rand() * Math.PI * 2,
    rate: 0.28 + kit.rand() * 0.5,
    tumble: 0.4 + kit.rand() * 1.4,
    scale: 0.6 + kit.rand() * 1.2,
  }))
  const spin = new THREE.Quaternion()
  const at = new THREE.Vector3()
  const size = new THREE.Vector3()
  const tick = (): void => {
    const t = kit.game.ticker.elapsed
    for (let i = 0; i < chunkCount; i++) {
      const o = orbits[i]
      const angle = o.phase + t * o.rate
      at.set(
        core.x + Math.cos(angle) * o.radius,
        ground + o.height,
        core.z + Math.sin(angle) * o.radius,
      )
      spin.setFromEuler(new THREE.Euler(t * o.tumble, angle, t * o.tumble * 0.6))
      size.setScalar(o.scale)
      matrix.compose(at, spin, size)
      debris.setMatrixAt(i, matrix)
    }
    debris.instanceMatrix.needsUpdate = true
  }
  tick()
  kit.game.ticker.events.on('tick', tick, 12)
  kit.bin.add(() => kit.game.ticker.events.off('tick', tick))
}
