import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Game } from '../Game'
import type { Bin } from '../core/Disposal'
import { roads, districts } from '@/content/world'
import { isFree, type Zone, type ZoneKind } from '@/content/world-layout'
import {
  LAKES, RIVER, VEGETATION_ZONES, CIRCUIT, CIRCUIT_TRACK,
  coastRayDistance, inlandWater, lineDistance,
} from '@/content/world-environment'

/* ============================================================
   SCENERY DETAIL

   The layer between "there is ground here" and "someone made this
   place": lanterns down the roads, fences where the land ends,
   benches looking at the water, tables in the clearings, signs at
   the junctions.

   In the reference, this is most of what fills a frame. Its
   opening view carries two lit lanterns, two fences, a bench and a
   roofed kiosk before you count a single tree, and that furniture
   is what makes the ground read as a place rather than as terrain
   with objects standing on it.

   EVERYTHING HERE IS DERIVED — from the road network, the lakes,
   the river, the drawing's green masses and the coast. Nothing is a
   hand-typed coordinate. The previous version of this file was a
   list of literal positions, and when the island was rebuilt every
   one of them ended up in the sea.

   AND NONE OF IT IS A WALL ANY MORE. The lanterns, the benches and
   the picnic tables used to be static geometry with a fixed
   collider each: a 3.8 m post in a 0.16 m box, a 3.8 x 1.2 m slab
   on a beach, a table in a clearing. Against a 2.5 kg chassis
   every one of them stopped the car dead, which is the opposite of
   what furniture is for — you are meant to want to drive at it.
   They are `Props` instances now, dynamic and light, so they
   topple and lie there; the merged buckets keep the things that
   are genuinely part of the ground, like the cold fire rings.

   Four merged geometries and one instanced set, so the static half
   of the layer is still five draw calls and the knockable half
   costs nothing new — it rides on prop kinds `Decor` reserves
   anyway.
   ============================================================ */

/** Walk a polyline dropping a point every `spacing` metres. */
function alongPolyline(
  points: readonly (readonly number[])[],
  spacing: number,
  from = 0,
): { x: number; z: number; angle: number }[] {
  const out: { x: number; z: number; angle: number }[] = []
  let carry = from
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i]
    const [bx, bz] = points[i + 1]
    const length = Math.hypot(bx - ax, bz - az)
    if (length < 1e-3) continue
    const angle = Math.atan2(bz - az, bx - ax)
    for (let d = carry; d < length; d += spacing) {
      const t = d / length
      out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, angle })
    }
    carry = Math.max(0, carry + Math.ceil((length - carry) / spacing) * spacing - length)
  }
  return out
}

export function buildSceneryDetails(game: Game, bin: Bin): void {
  const group = new THREE.Group()
  const wood: THREE.BufferGeometry[] = []
  const metal: THREE.BufferGeometry[] = []
  const stone: THREE.BufferGeometry[] = []
  const rand = (() => { let s = 0x9e3779b9; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) })()
  const density = game.quality.settings.density

  const box = (
    out: THREE.BufferGeometry[], x: number, y: number, z: number,
    w: number, h: number, d: number, angle = 0,
  ) => {
    const g = new THREE.BoxGeometry(w, h, d)
    if (angle) g.rotateY(angle)
    g.translate(x, y, z)
    out.push(g)
  }
  const ground = (x: number, z: number) => game.terrain.colliderHeightAt(x, z)
  /**
   * Is this a spot a player could actually stand and look at something?
   *
   * `allow` is for furniture that belongs ON something — lanterns light
   * paving, and rejecting them from it was leaving every plate in the
   * world unlit. `margin` is how far off a corridor a piece has to
   * stand, and it may be NEGATIVE: a lamp post is 2.2 m out from a
   * road's edge, which is 0.6 m outside that road's footprint and well
   * inside the 3 m of clearance the post asks for, so with the plain
   * rules every lantern on the island was rejected and the whole layer
   * built nothing. A road lantern is FOR its road; what it must not do
   * is stand in a DIFFERENT one, which the same test still catches.
   *
   * One call into `world-layout`, like the ecology scatter. The two used
   * to carry near-identical hand-written rules with different numbers
   * (coast margin 6 against 10, track clearance 0 against 5), which is
   * how a bench came to stand on the racing line while a tree three
   * metres away was correctly rejected.
   */
  const usable = (
    x: number, z: number, clear = 6,
    allow: ZoneKind[] = [], margin: Partial<Record<ZoneKind, number>> = {},
    coast = 8,
  ) => {
    if (ground(x, z) < 0.2) return false
    return isFree(x, z, {
      clearance: clear,
      coastMargin: coast,
      allow,
      margin: { circuit: 5, ramp: 6, water: 1.5, ...margin },
    })
  }

  /* ---- lanterns -------------------------------------------
     Down every road, alternating sides. The reference lights its
     paths this way and it is most of why its nights read.

     SIX OF THIRTY-FOUR CANDIDATES SURVIVED, which on 635 m of road
     is one lamp every hundred metres and reads as a road nobody
     finished. Two changes, both measured against the live layout:

     · 13 m between candidates instead of 21, and the spacing is a
       CONSTANT. It used to be `21 / density`, so a phone got a
       lantern every 42 m — which was fine while these were scenery
       and is not now they are props with colliders. `Quality.ts`'s
       rule is that a tier changes what the world LOOKS like and
       never what it COLLIDES with.
     · a rejected candidate steps 2.4 m further out and tries again,
       four times. Most rejections are the ramp run-up, a play spot
       or the waterline reaching the verge, and all three are things
       you get past by standing back rather than by giving up.

     Together: 14 lanterns of 48 candidates, up from 6, and the ones
     that were lost were lost to ground that is not there. */
  const lanterns: { x: number; z: number }[] = []
  let side = 1
  for (const road of roads) {
    for (const point of alongPolyline(road.points, 13, 8)) {
      side = -side
      for (let step = 0; step < 4; step++) {
        const offset = road.width * 0.5 + 2.2 + step * 2.4
        const x = point.x + Math.sin(point.angle) * offset * side
        const z = point.z - Math.cos(point.angle) * offset * side
        if (!usable(x, z, 3, ['plate'], { road: -2.5 })) continue
        lanterns.push({ x, z })
        break
      }
    }
  }
  // And down the pit straight, where the track meets the road network.
  // `slice(0, 6)` is points 0 to 5 of the ninety-two: the start/finish
  // line, the run out of the last corner and the 62 m of westward
  // straight that follows it. Point 6 is already turning north up the
  // climb, so a lantern there would be standing in a corner.
  for (const point of alongPolyline(CIRCUIT_TRACK.slice(0, 6), 34, 10)) {
    const x = point.x + Math.sin(point.angle) * (CIRCUIT.width * 0.5 + 4)
    const z = point.z - Math.cos(point.angle) * (CIRCUIT.width * 0.5 + 4)
    // Four metres outside the kerb, which is where a pit-lane light
    // stands; the 5 m trackside margin is for things a car must never
    // find on the exit of a corner.
    if (usable(x, z, 3, ['plate'], { circuit: -2.5 })) lanterns.push({ x, z })
  }
  /*
    A LAMP POST IS 3.8 m OF NOTHING AND IT STOPPED THE CAR DEAD.

    Fourteen of these stand on the verges, and each carried a fixed
    0.16 x 1.9 x 0.16 cuboid — invisible from a driving camera,
    immovable against a 2.5 kg chassis, and placed exactly where a
    car that has run wide ends up. They are `lantern` props now: 2.4
    kg, high angular damping, so a clipped one goes over and lies
    across the verge.

    What it costs is the warm emissive head. An InstancedMesh carries
    ONE material, and the head was 0.9 of emissive intensity on a
    0.44 m box in a world whose `nightFactor` is permanently zero
    (`Lighting.DAYLIGHT_RANGE` is 0.38-0.62 and the sun never sets),
    so it was decoration rather than light. A post that falls over is
    worth more than a glow nobody can see against noon.
  */
  const props = game.world.props
  props.reserve('lantern', props.countOf('lantern') + lanterns.length)
  props.addMany('lantern', lanterns.map(({ x, z }) => ({
    x, y: ground(x, z) + 0.03, z,
    options: { tag: 'scenery-lantern', rotation: rand() * Math.PI * 2 },
  })))

  /* ---- benches, looking at something -----------------------
     A bench facing nothing is furniture. Each of these faces the
     water it was placed for. */
  const seats: { x: number; z: number; facing: number }[] = []
  /*
    FIVE METRES OF CLEARANCE AND AN EIGHT METRE COAST INSET BOUGHT
    THIS ISLAND ONE BENCH.

    Measured: of five lake lobes and forty-eight coast bearings, one
    lobe and no bearings survived, so the whole waterfront had a
    single seat on it. Those numbers were written for a fixed 3.8 x
    1.2 m block that a car had to be kept away from; a 9 kg prop with
    a 1.5 m footprint does not need three metres of air round it, and
    a seat looking at the sea belongs six metres from the sea rather
    than eight. At 2.5 / 6 / 0.8 it is four lake benches and two coast
    ones, which is what the file always meant to build.
  */
  const BENCH = [2.5, [] as ZoneKind[], { water: 0.8 }, 6] as const
  // LAKES is five ellipses making TWO bodies of water, so the cap is
  // per BODY: a ring per ellipse would put three sets of benches round
  // the west lake, some of them thirty metres apart looking across the
  // same lobe at each other. Every lobe is still an anchor to try,
  // because the west lake's two larger ones are ringed entirely by the
  // circuit and by the rest of their own body — only its third lobe
  // has a bank with room on it.
  const perBody = new Map<string, number>()
  for (const lake of LAKES) {
    for (let i = 0; i < 8 && (perBody.get(lake.body) ?? 0) < 2; i++) {
      const bearing = (i / 8) * Math.PI * 2 + 0.6
      const r = Math.max(lake.rx, lake.rz) + 7
      const x = lake.x + Math.cos(bearing) * r
      const z = lake.z + Math.sin(bearing) * r
      if (!usable(x, z, ...BENCH)) continue
      perBody.set(lake.body, (perBody.get(lake.body) ?? 0) + 1)
      seats.push({ x, z, facing: bearing + Math.PI })
    }
  }
  // Two on the coast, looking out. The bearings are SEARCHED, because
  // most of this coastline is spoken for: the shore road has the south,
  // the circuit's west run and north loop have everything from the
  // south-west round to the bay, and of the pair of bearings written
  // here before, one landed in the road and the other on the racing
  // surface. `coastRayDistance` is the FIRST shoreline a bearing
  // crosses — in the north-east that is the bay, not the headland
  // beyond it — and eighteen metres back from it is off the beach with
  // the sea still the view.
  const shore: number[] = []
  for (let i = 0; i < 48; i++) {
    const bearing = (i / 48) * Math.PI * 2
    const r = coastRayDistance(bearing) - 18
    if (usable(Math.cos(bearing) * r, Math.sin(bearing) * r, ...BENCH)) shore.push(bearing)
  }
  // The first free bearing, and then the one furthest round the island
  // from it, so the two are two views rather than two seats on the same
  // beach. Taking the first two free bearings gave a pair 0.13 rad and
  // eight metres apart, both looking at the same water.
  const apart = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))
  const facing = shore.length
    ? [shore[0], shore.reduce((far, b) => (apart(b, shore[0]) > apart(far, shore[0]) ? b : far), shore[0])]
    : []
  for (const bearing of new Set(facing)) {
    const r = coastRayDistance(bearing) - 18
    seats.push({ x: Math.cos(bearing) * r, z: Math.sin(bearing) * r, facing: bearing })
  }
  /*
    The `bench` prop kind, not four merged boxes and a fixed 3.8 x
    1.2 m slab. It gained a backrest in `Props.SPECS` precisely so it
    could take this job — a bench facing the water still has to look
    like a bench from behind — and it dropped from 40 kg to 9, which
    is the difference between something you shunt along the beach and
    something you beach ON.

    `-facing` because the prop's own long axis is X and `facing` is
    the bearing the seat looks along.
  */
  props.reserve('bench', props.countOf('bench') + seats.length)
  props.addMany('bench', seats.map((seat) => ({
    x: seat.x, y: ground(seat.x, seat.z) + 0.03, z: seat.z,
    options: { tag: 'scenery-bench', rotation: -seat.facing },
  })))

  /* ---- fences ----------------------------------------------
     There are none, and that is the finding rather than an
     omission. Bridge railings are built by `Water.buildBridges`, in
     the deck's own rotated frame and at the deck's own height. This
     file used to build a SECOND set, planted at terrain height and
     world-X aligned, so every bridge wore two rails — one of them
     submerged mid-span and at ninety degrees to the crossing. What
     was left after that fix was an empty array and a loop over it,
     which read like an unfinished feature for long enough that it
     was worth deleting the machinery and keeping the reason. */

  /* ---- clearings -------------------------------------------
     A table and a ring of stones in the larger woods: a reason to
     drive into a forest rather than past it. */
  // `clearing` is the drawing's own answer: a mass at least 20 m across
  // its SHORTER axis, which is the test a table actually has to pass.
  // The mean of an ellipse's two radii — what the tuple filter here
  // measured — calls a 110 x 12 m ribbon a clearing. Four masses
  // qualify, so all four are furnished rather than every other one.
  /*
    EVERY clearing, not `4 * density` of them — a picnic table is a
    prop with a collider now, and a world where a phone has two tables
    and a desktop has four is two different worlds.

    And then a top-up, because `clearing` has quietly stopped meaning
    what it meant. It is "at least 20 m across the shorter axis", and
    20 m did not shrink when the island went to 70%: on the drawing as
    it stands exactly ONE mass of eleven still qualifies, where four
    did before, so the woods went from four furnished clearings to
    one. Fourteen metres is the same threshold in the island's own
    terms, and it brings back the three masses that lost the label
    rather than inventing new ones — v5, v7 and v11, all of which were
    clearings a rescale ago.
  */
  const CLEARING_RADIUS = 14
  const clearings = VEGETATION_ZONES
    .filter((v) => v.clearing || Math.min(v.rx, v.rz) >= CLEARING_RADIUS)
  const tables: { x: number; z: number }[] = []
  for (const zone of clearings) {
    // Sample the whole ellipse, and keep trying. The south infield's
    // mass is 112 m wide with the racing line through the middle of it,
    // so the ground a table fits on is all round the edges — drawing
    // once from the middle half, as this did, lost that mass its table
    // about half the time and the wood read as untouched.
    let spot: { x: number; z: number } | null = null
    for (let attempt = 0; attempt < 24 && !spot; attempt++) {
      const a = rand() * Math.PI * 2
      const d = Math.sqrt(rand())
      const px = zone.x + Math.cos(a) * zone.rx * d
      const pz = zone.z + Math.sin(a) * zone.rz * d
      if (usable(px, pz, 6)) spot = { x: px, z: pz }
    }
    if (!spot) continue
    const { x, z } = spot
    const y = ground(x, z)
    tables.push({ x, z })
    // A cold fire ring, so the clearing reads as used. STONES STAY
    // STATIC AND STAY COLLIDER-LESS: they are 0.36 m high and half
    // sunk, so the car drives over them, which is the one piece of
    // this file that was already right.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2
      box(stone, x + 3 + Math.cos(a) * 1.1, y + 0.18, z + Math.sin(a) * 1.1, 0.5, 0.36, 0.5, a)
    }
  }
  // The table itself is a 4 kg `table` prop. As a fixed 2.6 x 1.4 m
  // cuboid it was the reward for finding a clearing and also the wall
  // that ended the drive there.
  props.reserve('table', props.countOf('table') + tables.length)
  props.addMany('table', tables.map(({ x, z }) => ({
    x, y: ground(x, z) + 0.03, z,
    options: { tag: 'scenery-table', rotation: rand() * Math.PI * 2 },
  })))

  /* ---- junction signs --------------------------------------
     Named for where they actually point, read off the districts.

     ZERO OF FOUR OF THESE WERE EVER BUILT.

     Each was placed at plate + 16 m ON THE BEARING TO ITS TARGET —
     which is precisely where the road to that target runs, because
     that is what a road to a place is. `circuit` landed in
     road-landing-racestart, `projects` in road-landing-projects,
     `maze` in road-landing-maze-road and `social` in the river, so
     `usable` correctly rejected all four and the block had been dead
     machinery for as long as it had existed.

     The fix is a SWEEP, because one offset was never going to be
     enough: walk out along the bearing from plate + 8 m in three
     metre steps, and at each stop try three offsets either side of
     it, perpendicular, measured from the nearest road's own
     half-width so it survives a road being widened. Signs already
     placed are passed back in as `extra` footprints, because the
     first two bearings out of the landing are 0.13 rad apart and
     without that the CIRCUIT and SOCIAL posts landed 1.7 m from each
     other.

     Measured, that is three of four. PROJECTS finds nowhere: every
     stop on its bearing is road on one side and the river or the
     coast on the other, out to forty metres. It says so in dev
     rather than vanishing, which is the whole difference between
     this and what it replaces.

     And no collider, following `Landmarks.buildBillboard`, whose
     comment states the rule: information must never be a road
     obstacle. A signpost that stops the car is a signpost pointing
     at somewhere you can no longer get to. */
  const hub = districts.find((d) => d.id === 'landing')
  if (hub) {
    const targets = ['circuit', 'projects', 'social', 'maze'] as const
    const posts: Zone[] = []
    for (const id of targets) {
      const target = districts.find((d) => d.id === id)
      if (!target) continue
      const bearing = Math.atan2(target.z - hub.z, target.x - hub.x)
      let spot: { x: number; z: number } | null = null
      for (let out = 0; out < 10 && !spot; out++) {
        const r = (hub.plate ?? 24) + 8 + out * 3
        const along = { x: hub.x + Math.cos(bearing) * r, z: hub.z + Math.sin(bearing) * r }
        // The nearest road to this stop, which on this bearing is the
        // road to the target itself.
        const nearest = roads.reduce<{ road: typeof roads[number]; d: number } | null>((best, road) => {
          const d = lineDistance(along.x, along.z, road.points)
          return !best || d < best.d ? { road, d } : best
        }, null)
        const half = (nearest && nearest.d < 20 ? nearest.road.width : 8) * 0.5
        for (const clear of [3.5, 6, 9]) {
          for (const side of [1, -1]) {
            const x = along.x - Math.sin(bearing) * (half + clear) * side
            const z = along.z + Math.cos(bearing) * (half + clear) * side
            // 1.6 m of clearance, not 3: this is a 0.18 m post, and the
            // 3 m a bench asks for was rejecting verges wide enough to
            // park a car on. The water margin comes down with it — a
            // signpost on a riverbank is a signpost.
            if (!isFree(x, z, {
              clearance: 1.6, coastMargin: 8, allow: ['plate'],
              margin: { circuit: 5, ramp: 6, water: 0.6, road: 0 },
              extra: posts,
            })) continue
            if (ground(x, z) < 0.2) continue
            spot = { x, z }
            break
          }
          if (spot) break
        }
      }
      if (!spot) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(`[world] no free ground for the ${target.short} signpost`)
        }
        continue
      }
      posts.push({ id: `sign-${id}`, kind: 'landmark', x: spot.x, z: spot.z, radius: 4 })
      const y = ground(spot.x, spot.z)
      box(metal, spot.x, y + 2.1, spot.z, 0.18, 4.2, 0.18)
      game.playground.label(`${target.short} →`, group, new THREE.Vector3(spot.x, y + 4.4, spot.z), 7, 1.3)
    }
  }

  /* ---- reeds at the waterline ------------------------------ */
  const reedGeometry = new THREE.ConeGeometry(0.16, 1.7, 4)
  reedGeometry.translate(0, 0.85, 0)
  const reedMaterial = new THREE.MeshStandardMaterial({ color: '#7f8a4e', roughness: 0.95 })
  const reedCount = Math.round(1800 * Math.max(0.3, density))
  const reeds = new THREE.InstancedMesh(reedGeometry, reedMaterial, reedCount)
  const scratch = new THREE.Object3D()
  let placed = 0
  for (let attempt = 0; attempt < reedCount * 22 && placed < reedCount; attempt++) {
    const lake = LAKES[Math.floor(rand() * LAKES.length)]
    const onRiver = rand() < 0.4
    let x: number, z: number
    if (onRiver) {
      const i = Math.floor(rand() * (RIVER.points.length - 1))
      const t = rand()
      const [ax, az] = RIVER.points[i]
      const [bx, bz] = RIVER.points[i + 1]
      const side = rand() < 0.5 ? -1 : 1
      x = ax + (bx - ax) * t + side * (RIVER.width * 0.5 + rand() * 3)
      z = az + (bz - az) * t
    } else {
      const a = rand() * Math.PI * 2
      const r = 0.94 + rand() * 0.16
      x = lake.x + Math.cos(a) * lake.rx * r
      z = lake.z + Math.sin(a) * lake.rz * r
    }
    const water = inlandWater(x, z)
    // Only in the shallows: the fringe, not the middle of the lake.
    if (!water || water.edge < -2.4 || water.edge > 2.2) continue
    scratch.position.set(x, ground(x, z) + 0.1, z)
    scratch.rotation.set((rand() - 0.5) * 0.3, rand() * 6.28, (rand() - 0.5) * 0.3)
    scratch.scale.setScalar(0.7 + rand() * 0.8)
    scratch.updateMatrix()
    reeds.setMatrixAt(placed++, scratch.matrix)
  }
  reeds.count = placed
  reeds.castShadow = false
  reeds.receiveShadow = true
  reeds.instanceMatrix.needsUpdate = true
  group.add(reeds)
  bin.add(() => { reedGeometry.dispose(); reedMaterial.dispose() })

  /* Three buckets, not four. The fourth was `lights` at #e7cc83 with
     emissive 0.9, and the only thing in it was the lamp head that
     now rides on the `lantern` prop's single instanced material. An
     empty bucket merges to nothing and costs nothing, but it reads
     as a feature somebody forgot to finish. */
  for (const [pieces, color] of [
    [wood, '#9f875f'],
    [metal, '#536955'],
    [stone, '#8d8f86'],
  ] as const) {
    if (!pieces.length) continue
    const geometry = mergeGeometries([...pieces])
    pieces.forEach((g) => g.dispose())
    if (!geometry) continue
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.86 })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = game.quality.settings.shadows
    mesh.receiveShadow = true
    group.add(mesh)
    bin.add(() => { geometry.dispose(); material.dispose() })
  }

  game.renderer.scene.add(group)
  bin.object3D(group)
}
