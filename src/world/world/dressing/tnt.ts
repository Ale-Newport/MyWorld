import * as THREE from 'three'
import { CIRCUIT_TRACK, PLAY_SPOTS, lineDistance } from '@/content/world-environment'
import { palette } from '../../core/palette'
import { chamferedBox, strutGeometry, wheelGeometry } from '../geometry'
import type { MaterialName } from '../materials'
import type { Dressing } from '../kit'

/* ============================================================
   THE DEMOLITION YARD

   Playground already stacks eighteen crates here and hangs a
   RESTOCK prompt off the north end of them. What it does not do is
   say WHY there is a pile of dynamite on a racing circuit, so this
   layer builds the quarry around it: the plunger, the fuse, the
   blast wall, the watchtower, and the hole a previous stack left.

   THE VERGE IS TWELVE METRES WIDE, and that number is the whole
   design. Measured out from the yard's centre: the circuit's
   footprint ends 8.3 m from the racing centreline and the west
   lake's bank begins 5 m the other way, so the play spot's pad is
   24 m long and only 12 across — and the crate stack, laid three
   abreast at 3.8 m, is already 9.7 m of that. There is no room
   BESIDE the crates. Everything here is therefore either on the
   pad's own west edge (the blast wall, which is what that edge is
   for) or on the aprons north and south of the stack, where the
   RESTOCK prompt already stands.

   `kit.free` REFUSES THE PAD, and that is the right answer rather
   than a nuisance: the pad is a `play` zone, so the registry says
   "occupied" for every point the crates stand on. `apron()` below
   walks away from the stack until the registry agrees, which is
   also what keeps a piece out of the lake and off the kerb.

   COLLIDERS: the plunger's plinth, the blast wall, the tower's four
   feet, the barrel rack and the tipped wheelbarrow — six things you
   can see are solid, none of them over 1.2 m. Nothing else has one.
   The signs stand on thin masts, the tower's cabin is 6.4 m up, the
   crater lip is 0.35 m of scenery and the fuse is 11 cm of cable
   lying on the grass; a 2.5 kg car goes through all four without
   noticing, which is the point of listing them here.
   ============================================================ */

/** How far off the pad's west edge the blast wall's face sits. Two
 *  bag-depths, so the wall shields the crates rather than joining
 *  them, and it lands 9.2 to 9.5 m from the racing centreline —
 *  outside the circuit's own 8.3 m footprint, and a full car width of
 *  grass past the edge of a 10 m surface. */
const WALL_INSET = 0.6

export function dressTnt(kit: Dressing): void {
  const spot = kit.spot('tnt') ?? kit.district('tnt')
  const entry = PLAY_SPOTS.find((p) => p.id === 'tnt')
  const pad = entry && 'pad' in entry ? entry.pad : null
  if (!pad) return
  const halfLong = pad.length / 2
  const halfWide = pad.width / 2

  /* The yard's own axes, taken from the RACING LINE rather than from
     the pad's authored rotation. Everything here is either parallel
     to the track (the wall) or measured away from it (the aprons),
     and the track through this verge is about two degrees off the
     pad's north — enough that a wall built on the pad's axis would
     drift a metre into the run-off over 24 m. */
  const near = nearestOnTrack(spot.x, spot.z)
  const outX = (spot.x - near.x) / near.distance
  const outZ = (spot.z - near.z) / near.distance
  const at = (along: number, out: number) => ({
    x: spot.x - outZ * along + outX * out,
    z: spot.z + outX * along + outZ * out,
  })
  /** The yaw that lines a mesh's +X up with the track. */
  const alongYaw = Math.atan2(outX, -outZ)

  const xAxis = new THREE.Vector3(1, 0, 0)

  /** File a geometry into a merge bucket, already in world space. */
  const put = (
    material: MaterialName,
    geometry: THREE.BufferGeometry,
    x: number, y: number, z: number,
    yaw = 0,
  ): void => {
    if (yaw) geometry.rotateY(yaw)
    geometry.translate(x, y, z)
    kit.add(material, geometry)
  }

  /** A box stretched between two points: braces, handles, fuse. */
  const beam = (material: MaterialName, a: THREE.Vector3, b: THREE.Vector3, thick: number): void => {
    const geometry = chamferedBox(a.distanceTo(b), thick, thick, thick * 0.3)
    geometry.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(xAxis, b.clone().sub(a).normalize()),
    )
    put(material, geometry, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
  }

  /** A fixed cuboid in world space, for the three things that earn one. */
  const block = (x: number, y: number, z: number, w: number, h: number, d: number, yaw: number) => {
    kit.game.physics.add({
      type: 'fixed',
      category: 'floor',
      position: { x, y, z },
      rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
      friction: 0.7,
      restitution: 0.12,
      colliders: [{ shape: 'cuboid', parameters: [w / 2, h / 2, d / 2] }],
    })
  }

  /**
   * Ground on the apron the registry will actually give us, seeded at
   * `(along, out)` and walked STRAIGHT AWAY FROM THE RACING LINE a
   * metre at a time until it is free.
   *
   * `out` is the only axis with anything to give on a verge this
   * narrow. Walking further north or south — the obvious move — makes
   * things worse: the track curves back east at both ends of the
   * yard, so a sign seeded 13 m north of the stack was still 9.9 m
   * off the centreline after fourteen steps and inside the circuit's
   * own footprint. Twelve steps out, then give up and use the seed,
   * because past that is the lake.
   */
  const apron = (along: number, out: number, clear: number) => {
    for (let i = 0; i < 12; i++) {
      const point = at(along, out + i)
      if (kit.free(point.x, point.z, clear)) return point
    }
    return at(along, out)
  }

  /* ---- the blast wall ---------------------------------------
     Three courses of staggered bags along the pad's west edge, on
     the racing-line side of the stack. 0.96 m tall on purpose: high
     enough to read as a shield from the track, low enough that what
     a car meets is a kerb rather than a building. Three colliders
     for eighty bags: a cuboid per bag would be eighty more contact
     pairs for a wall nobody is supposed to touch. */
  const BAG = { w: 0.86, h: 0.32, d: 0.46 }
  const courses = 3
  const bags = Math.floor(pad.length / BAG.w)
  const wallOut = -halfWide + WALL_INSET
  for (let course = 0; course < courses; course++) {
    const stagger = (course % 2) * BAG.w * 0.5
    for (let i = 0; i < bags - course; i++) {
      const along = -halfLong + stagger + (i + 0.5) * BAG.w
      const point = at(along, wallOut + (kit.rand() - 0.5) * 0.09)
      const bag = chamferedBox(BAG.w * 0.94, BAG.h, BAG.d, 0.1)
      put(
        'sandbag', bag,
        point.x, kit.groundAt(point.x, point.z) + BAG.h * (course + 0.5),
        point.z, alongYaw + (kit.rand() - 0.5) * 0.12,
      )
    }
  }
  // THREE colliders, not one: the verge falls away over 24 m and a
  // single flat cuboid would leave the wall's south end buried and
  // its north end standing on air.
  for (let i = 0; i < 3; i++) {
    const span = pad.length / 3
    const mid = at(-halfLong + span * (i + 0.5), wallOut)
    block(
      mid.x, kit.groundAt(mid.x, mid.z) + (courses * BAG.h) / 2, mid.z,
      span, courses * BAG.h, BAG.d, alongYaw,
    )
  }

  /* ---- the plunger ------------------------------------------
     On the north apron, where the RESTOCK prompt already stands, so
     the two read as one control point. The plinth is the only thing
     here with a collider: 1.0 m tall and 1.3 m square, which is a
     lectern rather than a wall. */
  const plunger = apron(halfLong + 3.5, 3.5, 3)
  const plungerY = kit.groundAt(plunger.x, plunger.z)
  const plungerYaw = alongYaw + Math.PI / 2
  const plinth = chamferedBox(1.3, 1, 1.3, 0.09)
  put('timber', plinth, plunger.x, plungerY + 0.5, plunger.z, plungerYaw)
  block(plunger.x, plungerY + 0.5, plunger.z, 1.3, 1, 1.3, plungerYaw)
  const cap = chamferedBox(1.45, 0.1, 1.45, 0.04)
  put('hazard', cap, plunger.x, plungerY + 1.05, plunger.z, plungerYaw)
  const box = chamferedBox(0.9, 0.7, 0.7, 0.07)
  put('ink', box, plunger.x, plungerY + 1.45, plunger.z, plungerYaw)
  const shaft = strutGeometry(0.05)
  shaft.scale(1, 0.85, 1)
  put('metal', shaft, plunger.x, plungerY + 1.7, plunger.z)
  const handle = chamferedBox(0.72, 0.1, 0.1, 0.03)
  put('accent', handle, plunger.x, plungerY + 2.55, plunger.z, plungerYaw)

  /* ---- the fuse ---------------------------------------------
     From the plunger's box down to the stack's north face, snaking
     across the grass. It BURNS CONTINUOUSLY: wiring the plunger to
     Playground's fuse machinery is a content-layer change (see the
     handoff), and a fuse that is always lit is the funnier read
     anyway — the yard has been about to go up all afternoon. */
  // Interpolated between the plunger the registry ACTUALLY gave us
  // and the stack's north face — not between the two offsets they
  // were seeded at. `apron` is allowed to walk, and a fuse drawn from
  // the seed would leave the detonator trailing a cable to nothing.
  const face = at(halfLong - 1, 0)
  const path: THREE.Vector3[] = []
  const runs = 14
  for (let i = 0; i <= runs; i++) {
    const t = i / runs
    // The wiggle is across the run, so the cable snakes instead of
    // ruling a straight line over ten metres of grass.
    const sway = Math.sin(t * Math.PI * 2.5) * 1.2
    const x = plunger.x * (1 - t) + face.x * t + outX * sway
    const z = plunger.z * (1 - t) + face.z * t + outZ * sway
    path.push(new THREE.Vector3(x, kit.groundAt(x, z) + 0.09, z))
  }
  path[0].set(plunger.x, plungerY + 1.45, plunger.z)
  for (let i = 1; i < path.length; i++) beam('ink', path[i - 1], path[i], 0.11)

  const sparkGeometry = new THREE.IcosahedronGeometry(0.19, 0)
  const spark = new THREE.Mesh(sparkGeometry, kit.game.materials.get('emissiveAmber'))
  kit.group.add(spark)
  kit.bin.add(() => sparkGeometry.dispose())

  /* ---- the watchtower ---------------------------------------
     The yard's silhouette, and the only thing here taller than the
     crates. Legs splay from a 3.2 m base to a 2.2 m top, which is
     what makes a four-post tower read as a tower rather than as a
     table; the cabin floor is 5.4 m up and carries no collider,
     because the only way to reach it is over. */
  const tower = apron(halfLong + 7, 4, 2.5)
  const towerY = kit.groundAt(tower.x, tower.z)
  const HEIGHT = 5.4
  const feet: THREE.Vector3[] = []
  const heads: THREE.Vector3[] = []
  for (let i = 0; i < 4; i++) {
    const angle = alongYaw + Math.PI / 4 + (i * Math.PI) / 2
    const foot = new THREE.Vector3(
      tower.x + Math.cos(angle) * 2.26, towerY, tower.z + Math.sin(angle) * 2.26,
    )
    const head = new THREE.Vector3(
      tower.x + Math.cos(angle) * 1.55, towerY + HEIGHT, tower.z + Math.sin(angle) * 1.55,
    )
    feet.push(foot)
    heads.push(head)
    beam('metal', foot, head, 0.2)
    // A 0.34 m box at each foot: narrow enough to drive between,
    // solid enough that the tower is not a hologram.
    block(foot.x, towerY + 0.6, foot.z, 0.34, 1.2, 0.34, angle)
  }
  for (let i = 0; i < 4; i++) {
    const a = feet[i].clone().lerp(heads[i], 0.55)
    const b = feet[(i + 1) % 4].clone().lerp(heads[(i + 1) % 4], 0.55)
    beam('metal', a, b, 0.12)
    beam('metal', feet[i].clone().lerp(heads[i], 0.02), b, 0.09)
  }
  const deck = chamferedBox(3.4, 0.18, 3.4, 0.05)
  put('metal', deck, tower.x, towerY + HEIGHT, tower.z, alongYaw)
  const cabin = chamferedBox(2.4, 1.9, 2.4, 0.12)
  put('timber', cabin, tower.x, towerY + HEIGHT + 1.05, tower.z, alongYaw)
  const roof = chamferedBox(2.9, 0.16, 2.9, 0.05)
  put('hazard', roof, tower.x, towerY + HEIGHT + 2.08, tower.z, alongYaw)

  const beaconGeometry = chamferedBox(0.62, 0.36, 0.2, 0.05)
  const beacon = new THREE.Mesh(beaconGeometry, kit.game.materials.get('emissiveAccent'))
  beacon.position.set(tower.x, towerY + HEIGHT + 2.36, tower.z)
  kit.group.add(beacon)
  kit.bin.add(() => beaconGeometry.dispose())

  /* ---- warning diamonds -------------------------------------
     One at each corner of the pad, turned to face the middle of the
     yard. The bang is drawn in `ink` geometry rather than as a
     `textPlane`: a label is a canvas, a texture, a material and a
     transparent draw call each, and four of them for one glyph is
     four draw calls this district cannot spare. */
  for (let i = 0; i < 4; i++) {
    const along = (i < 2 ? 1 : -1) * (halfLong + 1.5)
    const out = (i % 2 ? 1 : -1) * (halfWide - 2.5)
    const sign = apron(along, out, 2)
    const y = kit.groundAt(sign.x, sign.z)
    const yaw = Math.atan2(spot.x - sign.x, spot.z - sign.z)
    const mast = strutGeometry(0.07)
    mast.scale(1, 1.55, 1)
    put('metal', mast, sign.x, y, sign.z)
    const plate = chamferedBox(0.95, 0.95, 0.09, 0.04)
    plate.rotateZ(Math.PI / 4)
    put('hazard', plate, sign.x, y + 1.95, sign.z, yaw)
    // 0.07 m forward along the plate's own normal, or the glyph is
    // inside the 0.09 m plate and invisible from every angle.
    const bar = chamferedBox(0.14, 0.42, 0.05, 0.02)
    bar.translate(0, 0, 0.07)
    put('ink', bar, sign.x, y + 2.08, sign.z, yaw)
    const dot = chamferedBox(0.14, 0.14, 0.05, 0.02)
    dot.translate(0, 0, 0.07)
    put('ink', dot, sign.x, y + 1.74, sign.z, yaw)
  }

  /* ---- the last hole ----------------------------------------
     A scorched crater on the south apron: this is where the stack
     stood before somebody hit it. It has no collider — the lip is
     0.35 m proud and a rim you trip over on the approach to a race
     start would be a bug, not a story. */
  const crater = apron(-halfLong - 6, 0, 5)
  const craterY = kit.groundAt(crater.x, crater.z)
  const lip = new THREE.TorusGeometry(4.2, 0.65, 5, 26)
  lip.rotateX(Math.PI / 2)
  put('concreteDark', lip, crater.x, craterY - 0.3, crater.z)
  const scorchGeometry = new THREE.CircleGeometry(4.2, 26)
  scorchGeometry.rotateX(-Math.PI / 2)
  scorchGeometry.translate(crater.x, craterY + 0.06, crater.z)
  const scorch = new THREE.Mesh(scorchGeometry, kit.game.materials.flat(palette.ink2, 0.45))
  scorch.renderOrder = 2
  kit.group.add(scorch)
  kit.bin.add(() => scorchGeometry.dispose())
  // Spoil thrown clear of it, so the ground reads as disturbed.
  for (let i = 0; i < 9; i++) {
    const angle = kit.rand() * Math.PI * 2
    const radius = 4.6 + kit.rand() * 3.4
    const x = crater.x + Math.cos(angle) * radius
    const z = crater.z + Math.sin(angle) * radius
    const size = 0.35 + kit.rand() * 0.5
    const lump = chamferedBox(size, size * 0.6, size * 0.85, 0.08)
    put('concreteDark', lump, x, kit.groundAt(x, z) + size * 0.22, z, kit.rand() * Math.PI)
  }

  /* ---- the barrel rack --------------------------------------
     Two tiers of six drums lying on their sides. They are static:
     knockable kinds belong to `Decor`, and a rack whose barrels
     roll is a change to `Props.SPECS` (see the handoff). */
  const rack = apron(-halfLong - 2.5, halfWide - 2.5, 3)
  const rackY = kit.groundAt(rack.x, rack.z)
  const rackYaw = alongYaw
  for (const level of [0.55, 1.5]) {
    const shelf = chamferedBox(4.4, 0.18, 1.3, 0.05)
    put('metal', shelf, rack.x, rackY + level, rack.z, rackYaw)
    for (let i = 0; i < 3; i++) {
      // `wheelGeometry` lies on Z, which is the rack's 1.3 m DEPTH:
      // three barrels side by side across a 4.4 m shelf, not three
      // laid nose to tail down it.
      const offset = (i - 1) * 1.4
      const drum = wheelGeometry(0.44, 0.92, 12)
      drum.translate(offset, 0, 0)
      put('accent', drum, rack.x, rackY + level + 0.53, rack.z, rackYaw)
      // Two hoops per drum, so a red cylinder reads as a barrel.
      for (const band of [-0.3, 0.3]) {
        const hoop = wheelGeometry(0.47, 0.09, 12)
        hoop.translate(offset, 0, band)
        put('ink', hoop, rack.x, rackY + level + 0.53, rack.z, rackYaw)
      }
    }
  }
  for (const end of [-2.1, 2.1]) {
    const post = chamferedBox(0.16, 1.7, 1.3, 0.04)
    post.translate(end, 0, 0)
    put('metal', post, rack.x, rackY + 0.85, rack.z, rackYaw)
  }
  block(rack.x, rackY + 0.5, rack.z, 4.4, 1, 1.3, rackYaw)

  /* ---- the wheelbarrow --------------------------------------
     Tipped over in the spoil on the south apron, well behind the
     crater. It gets a 0.6 m collider rather than none: it is a solid
     object a visitor can see, and driving THROUGH a wheelbarrow
     reads as a missing collider, not as a joke. */
  const barrow = apron(-halfLong - 8, -halfWide + 4, 2)
  const barrowY = kit.groundAt(barrow.x, barrow.z)
  const barrowYaw = alongYaw + 0.6
  const tub = chamferedBox(1.25, 0.52, 0.8, 0.1)
  tub.rotateZ(1.15)
  put('accent', tub, barrow.x, barrowY + 0.42, barrow.z, barrowYaw)
  const barrowWheel = wheelGeometry(0.32, 0.16, 10)
  barrowWheel.translate(0.85, 0, 0)
  put('ink', barrowWheel, barrow.x, barrowY + 0.36, barrow.z, barrowYaw)
  for (const side of [-0.28, 0.28]) {
    const handleBar = chamferedBox(1.5, 0.09, 0.09, 0.03)
    handleBar.rotateZ(0.22)
    handleBar.translate(-0.55, 0, side)
    put('timber', handleBar, barrow.x, barrowY + 0.55, barrow.z, barrowYaw)
  }
  block(barrow.x, barrowY + 0.3, barrow.z, 1.4, 0.6, 1, barrowYaw)

  /* ---- the two things that move -----------------------------
     A spark walking the fuse on a 2.2 s loop and a beacon turning
     at 1 rad/s. Two meshes and one ticker for the whole district;
     everything else above is in a merge bucket. */
  const tick = (): void => {
    const t = kit.game.ticker.elapsed
    const travel = ((t % 2.2) / 2.2) * (path.length - 1)
    const index = Math.min(path.length - 2, Math.floor(travel))
    spark.position.lerpVectors(path[index], path[index + 1], travel - index)
    spark.scale.setScalar(0.8 + Math.sin(t * 22) * 0.2)
    beacon.rotation.y = t
  }
  tick()
  kit.game.ticker.events.on('tick', tick, 12)
  kit.bin.add(() => kit.game.ticker.events.off('tick', tick))
}

/** Nearest point on the racing line, and how far away it is. The
 *  yard's axes come from this rather than from an authored bearing,
 *  so they follow the track through the next rescale. */
function nearestOnTrack(x: number, z: number): { x: number; z: number; distance: number } {
  let best = { x, z: z + 1, distance: Infinity }
  for (let i = 0; i < CIRCUIT_TRACK.length - 1; i++) {
    const [ax, az] = CIRCUIT_TRACK[i]
    const [bx, bz] = CIRCUIT_TRACK[i + 1]
    const dx = bx - ax
    const dz = bz - az
    const lengthSq = dx * dx + dz * dz || 1
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSq))
    const px = ax + dx * t
    const pz = az + dz * t
    const distance = Math.hypot(x - px, z - pz)
    if (distance < best.distance) best = { x: px, z: pz, distance }
  }
  // `lineDistance` is the number every other placement rule in the
  // world quotes; assert the two agree rather than shipping a second
  // opinion about where the track is.
  best.distance = lineDistance(x, z, CIRCUIT_TRACK)
  return best
}
