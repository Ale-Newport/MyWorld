import * as THREE from 'three'
import { PROJECT_GROUPS, projectPlinths, roads } from '@/content/world'
import { palette } from '../../core/palette'
import type { PropOptions } from '../Props'
import { chamferedBox, strutGeometry, wheelGeometry } from '../geometry'
import { mergeParts } from '../decorGeometry'
import { textPlane, type Dressing } from './kit'

/* ============================================================
   PROJECTS — THE ARCHIVE YARD

   The one district you are meant to READ from the car. The terminal
   in its middle opens the whole archive as an overlay and eight
   generated plinths carry the featured pieces — but a screen and a
   ring of discs is a menu with grass around it. This is the place
   the menu is kept: an avenue of exhibition boards on the way in,
   and behind the terminal a working yard — racks, a dish, a cable
   tray, a plotter still printing, crates half unpacked — so the
   archive reads as work being unpacked rather than as a gallery of
   screenshots.

   EVERYTHING IS IN THE ARRIVAL FRAME. `arrivalBearing` averages the
   bearings of the roads that reach PROJECTS — `landing-projects`
   from the hub and `bowling-projects` from the west, about 55
   degrees apart — and every piece below is placed at (along,
   across) metres on that axis. Not one world coordinate is typed
   here: the island was rescaled 30% this morning and the roads
   moved with it.

   SIX LABELS AGAINST A GUIDANCE OF FOUR, and this is the district
   that gets to spend them, because its exhibit IS the list of
   names. The six boards carry the six largest collections and
   nothing else in the district carries text — no banner legend, no
   table caption — so PROJECTS costs six canvases and the rest of
   the island keeps to four.

   WHAT IT COSTS. Six merged buckets (concreteDark, metal, paper,
   ink, graphite, timber), one hand-merged mesh for the district's
   slate blue — which is not a named material, because an accent
   belongs to two objects and not to a palette — one dish, one
   four-instance chase and six labels: fifteen draw calls of the
   hundred the runtime budget has spare (156 measured at HIGH
   against a 260 ceiling). One ticker callback drives both moving
   things.

   COLLIDERS ARE KERBS. Against a 2.5 kg chassis anything static is
   a wall, so only the board bases (0.55 m), the rack row (a wall
   you can see is a wall), the plotter, the table, the drum and the
   dish mast below 1.8 m have one. The board faces stand at 1.75 m
   on thin legs and you can drive underneath them; the cable tray is
   2.9 m up and has no collider at all.
   ============================================================ */

/** Boards in the avenue, and therefore collections named in the world. */
const BOARDS = 6
/** Slot planes per rack, and the seconds one lit slot holds. */
const SLOTS = 12
const SLOT_SECONDS = 0.22
const RACKS = 4
/** Boards lean back by this much, the way trade-fair signage does —
 *  the face catches the sun instead of the sky and stays legible. */
const LEAN = -0.12
/** A plinth's prompt circle is 8 m (`existingPrompts` in
 *  `content/attractions.ts`) and a board is 5.6 m wide, so nothing
 *  stands closer than this or the dressing parks itself on a prompt. */
const PLINTH_CLEAR = 9.5

interface Point { x: number; z: number }

/**
 * The bearing the visitor arrives on, averaged over every road that
 * reaches the district.
 *
 * Unit vectors, not angles: the mean of 350° and 10° is 0°, and the
 * mean of the numbers is 180°, which would have aimed the whole
 * avenue at the back of the terminal.
 */
function arrivalBearing(centre: Point): number {
  let x = 0
  let z = 0
  for (const road of roads) {
    if (!road.id.includes('projects')) continue
    // The vertex nearest 26 m out: far enough to still be the road
    // rather than the forecourt it dissolves into, near enough that
    // it points at this district and not at the one it came from.
    let best: [number, number] | null = null
    let error = Infinity
    for (const [px, pz] of road.points) {
      const e = Math.abs(Math.hypot(px - centre.x, pz - centre.z) - 26)
      if (e < error) { error = e; best = [px, pz] }
    }
    if (!best) continue
    const angle = Math.atan2(best[1] - centre.z, best[0] - centre.x)
    x += Math.cos(angle)
    z += Math.sin(angle)
  }
  return Math.hypot(x, z) < 1e-3 ? 0 : Math.atan2(z, x)
}

/**
 * A static box that stops a car and draws nothing.
 *
 * `solidBox` draws AND collides in one call, which is right for a
 * landmark and wrong here: the eleven colliding pieces below would be
 * eleven meshes outside the merge, and the buckets exist so a district
 * costs six draw calls instead of twenty-six. Every call sits beside
 * the geometry it matches, which is the half of that rule that matters.
 */
function blocker(
  kit: Dressing, x: number, y: number, z: number,
  half: [number, number, number], yaw: number,
): void {
  kit.game.physics.add({
    type: 'fixed',
    category: 'floor',
    position: { x, y, z },
    rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
    friction: 0.7,
    restitution: 0.12,
    colliders: [{ shape: 'cuboid', parameters: half }],
  })
}

export function dressProjects(kit: Dressing): void {
  const centre = kit.district('projects')
  const arrival = arrivalBearing(centre)
  const cosA = Math.cos(arrival)
  const sinA = Math.sin(arrival)

  /** `along` runs out towards the arriving roads, `across` to its left. */
  const at = (along: number, across: number): Point => ({
    x: centre.x + cosA * along - sinA * across,
    z: centre.z + sinA * along + cosA * across,
  })
  /** A yaw whose local +Z faces back up the arrival axis, so a board
   *  built facing +Z faces the car that is still driving towards it. */
  const facing = Math.PI / 2 - arrival
  /** Local (x, z) in a stand's own frame → world. */
  const world = (spot: Point, yaw: number, lx: number, lz: number): Point => ({
    x: spot.x + Math.cos(yaw) * lx + Math.sin(yaw) * lz,
    z: spot.z - Math.sin(yaw) * lx + Math.cos(yaw) * lz,
  })

  /*
    The eight featured plinths are GENERATED, and `projectPlinths()`
    keeps its own placement list rather than declaring zones — so
    `kit.free` cannot see them and every stand has to be tested
    against them by hand.
  */
  const plinths = projectPlinths()
  let dropped = 0
  const clear = (p: Point, need: number): boolean =>
    kit.free(p.x, p.z, need)
    && kit.groundAt(p.x, p.z) > 0.4
    && plinths.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > PLINTH_CLEAR)

  /** The nearest free stand to (along, across), searched OUTWARDS
   *  across the axis — the roads run along it, so out is where the
   *  room is. Null rather than a blocked spot; a board in a road is
   *  worse than a missing board. */
  const stand = (along: number, across: number, need: number): Point | null => {
    const side = across < 0 ? -1 : 1
    for (const nudge of [0, 3, -3, 6, 9, 13]) {
      const p = at(along, across + side * nudge)
      if (clear(p, need)) return p
    }
    dropped++
    return null
  }

  /** A builder bound to one stand: local geometry in, world-placed
   *  geometry out, leaned about the stand's base like the board is. */
  const frameAt = (spot: Point, yaw: number) => {
    const ground = kit.groundAt(spot.x, spot.z)
    return (g: THREE.BufferGeometry, local: [number, number, number], lean = 0) => {
      g.translate(local[0], local[1], local[2])
      if (lean) g.rotateX(lean)
      g.rotateY(yaw)
      g.translate(spot.x, ground, spot.z)
      return g
    }
  }

  // The district's slate blue. Merged by hand because `kit.add`'s
  // buckets are keyed by material NAME and this colour has none.
  const blue: THREE.BufferGeometry[] = []
  /* Both moving things, driven from ONE ticker callback registered at
     the end. Two callbacks for two objects is two `Events` walks a
     frame to save nothing. */
  const moving: ((elapsed: number) => void)[] = []

  /* ---- THE AVENUE ------------------------------------------
     Six boards, staggered either side of the arrival axis so the
     visitor drives BETWEEN them, each toed 0.32 rad in towards the
     axis. The six largest collections, in the archive's own order,
     so FEATURED is the first board you pass and the eight plinths
     it names are the next thing you meet.
     ---------------------------------------------------------- */
  const collections = [...PROJECT_GROUPS]
    .sort((a, b) => b.slugs.length - a.slugs.length)
    .slice(0, BOARDS)
    .sort((a, b) => PROJECT_GROUPS.indexOf(a) - PROJECT_GROUPS.indexOf(b))

  collections.forEach((group, i) => {
    const side = i % 2 === 0 ? -1 : 1
    const spot = stand(33 - i * 3.6, side * 10.5, 3.5)
    if (!spot) return
    const yaw = facing + side * 0.32
    const put = frameAt(spot, yaw)
    const ground = kit.groundAt(spot.x, spot.z)

    kit.add('concreteDark', put(chamferedBox(5.6, 0.55, 1.3, 0.08), [0, 0.27, 0]))
    blocker(kit, spot.x, ground + 0.27, spot.z, [2.8, 0.28, 0.65], yaw)
    for (const dx of [-2.3, 2.3]) {
      kit.add('metal', put(chamferedBox(0.26, 1.3, 0.26, 0.03), [dx, 1.2, 0], LEAN))
    }
    kit.add('metal', put(chamferedBox(0.2, 3.6, 0.2, 0.03), [0, 1.8, -0.85], LEAN + 0.3))
    kit.add('paper', put(chamferedBox(5.2, 3.0, 0.18, 0.06), [0, 3.25, 0], LEAN))
    blue.push(put(new THREE.BoxGeometry(5.2, 0.5, 0.22), [0, 4.5, 0.03], LEAN))

    // The graphic: one tile per project in the collection, capped at
    // fourteen. A count you can read at 15 m/s without a number on it.
    const tiles = Math.min(group.slugs.length, 14)
    for (let t = 0; t < tiles; t++) {
      const col = t % 7
      const row = Math.floor(t / 7)
      kit.add('ink', put(
        new THREE.BoxGeometry(0.44, 0.44, 0.07),
        [-1.74 + col * 0.58, 2.5 - row * 0.62, 0.12],
        LEAN,
      ))
    }

    // The label rides on the leaned face, so its anchor is leaned too
    // — `textPlane` only takes a yaw, and a plane left upright on a
    // tilted board floats a hand's width off it at the top.
    const site = kit.site(spot.x, spot.z, yaw)
    const holder = new THREE.Group()
    holder.position.copy(site.at)
    holder.rotation.y = yaw
    kit.group.add(holder)
    const ly = 3.86
    const lz = 0.15
    const label = textPlane(site, holder, group.label, 0.5, [
      0,
      ly * Math.cos(LEAN) - lz * Math.sin(LEAN),
      ly * Math.sin(LEAN) + lz * Math.cos(LEAN),
    ])
    label.rotation.x = LEAN
  })

  /* ---- THE YARD: RACKS -------------------------------------
     Behind the terminal, fronts towards it, so the boards and the
     racks bracket the screen instead of competing with it.
     ---------------------------------------------------------- */
  const slotY = (s: number) => 0.62 + s * 0.225
  const yard = stand(-21, -7, 7)
  if (yard) {
    const put = frameAt(yard, facing)
    const ground = kit.groundAt(yard.x, yard.z)
    for (let i = 0; i < RACKS; i++) {
      const dx = (i - (RACKS - 1) / 2) * 1.55
      kit.add('metal', put(chamferedBox(1.44, 0.18, 1.14, 0.04), [dx, 0.09, 0]))
      kit.add('ink', put(chamferedBox(1.3, 3.3, 1.0, 0.06), [dx, 1.83, 0]))
      for (let s = 0; s < SLOTS; s++) {
        kit.add('graphite', put(new THREE.BoxGeometry(0.96, 0.15, 0.05), [dx, slotY(s), 0.52]))
      }
    }
    // ONE collider for the row. The racks stand 0.25 m apart and the
    // gaps are narrower than the car, so four boxes would only be
    // three more things for a wheel to catch on.
    blocker(kit, yard.x, ground + 1.75, yard.z, [RACKS * 0.78, 1.75, 0.6], facing)

    /*
      THE CHASE. Four lit slots, one per rack, moving down the
      cabinets a slot every 0.22 s at a phase three slots apart.
      One InstancedMesh sharing the world's own `emissiveSignal`, so
      the whole animation is one draw call and no new material — the
      alternative, a lit plane per slot, is 48 meshes to make one
      idea read.
    */
    const chaseGeometry = new THREE.PlaneGeometry(0.98, 0.13)
    const chase = new THREE.InstancedMesh(
      chaseGeometry, kit.game.materials.get('emissiveSignal'), RACKS,
    )
    chase.frustumCulled = false
    kit.group.add(chase)
    kit.bin.add(() => { chaseGeometry.dispose(); chase.dispose() })

    const lit = new Int8Array(RACKS).fill(-1)
    const matrix = new THREE.Matrix4()
    const chaseTick = (elapsed: number) => {
      let moved = false
      for (let i = 0; i < RACKS; i++) {
        const slot = Math.floor(elapsed / SLOT_SECONDS + i * 3) % SLOTS
        if (slot === lit[i]) continue
        lit[i] = slot
        const dx = (i - (RACKS - 1) / 2) * 1.55
        const p = world(yard, facing, dx, 0.57)
        matrix.makeRotationY(facing)
        matrix.setPosition(p.x, ground + slotY(slot), p.z)
        chase.setMatrixAt(i, matrix)
        moved = true
      }
      // Only when a slot actually changes. A slot holds 0.22 s of
      // world time, which at scale 2 is about seven frames, so the
      // guard skips six buffer uploads in every seven.
      if (moved) chase.instanceMatrix.needsUpdate = true
    }
    chaseTick(0)
    moving.push(chaseTick)

    /* ---- THE CABLE TRAY ------------------------------------
       Racks to terminal, at 2.9 m and with no collider anywhere on
       it: it crosses the yard you drive in. It stops 13 m short of
       the centre, one metre outside the paved plate, because the
       plate is the terminal's own ground and a stanchion in it is a
       bollard nobody asked for.
       -------------------------------------------------------- */
    const runX = centre.x - yard.x
    const runZ = centre.z - yard.z
    const runLength = Math.hypot(runX, runZ)
    const ux = runX / runLength
    const uz = runZ / runLength
    const runYaw = Math.atan2(ux, uz)
    const deck = ground + 2.9
    const end = runLength - 13
    for (let d = 2.2; d < end; d += 1.3) {
      const g = chamferedBox(0.66, 0.12, 1.24, 0.03)
      g.rotateY(runYaw)
      g.translate(yard.x + ux * d, deck, yard.z + uz * d)
      kit.add('metal', g)
    }
    for (let d = 3; d < end; d += 4.4) {
      const x = yard.x + ux * d
      const z = yard.z + uz * d
      const height = deck - 0.1 - kit.groundAt(x, z)
      if (height < 0.6) continue
      const post = strutGeometry(0.11, 8)
      post.scale(1, height, 1)
      post.translate(x, deck - 0.1 - height, z)
      kit.add('metal', post)
      // A cable sagging 0.42 m over the 4.4 m to the next stanchion:
      // a 6 m circle cut to 0.75 rad is that chord and that sag.
      if (d + 4.4 >= end) continue
      const cable = new THREE.TorusGeometry(6, 0.05, 4, 10, 0.75)
      cable.rotateZ(-Math.PI / 2 - 0.375)
      cable.translate(0, 6, 0)
      cable.rotateY(runYaw + Math.PI / 2)
      cable.translate(x + ux * 2.2, deck - 0.6, z + uz * 2.2)
      kit.add('graphite', cable)
    }

    /* ---- CRATES, MID-UNPACK --------------------------------
       Real props, not merged geometry: the archive should come
       apart when you drive into it. `reserve` grows a kind rather
       than replacing it (Props.ts 357), which is how `Decor` adds
       to the base capacities, so this is 14 more crates and no new
       draw call.
       -------------------------------------------------------- */
    const props = kit.game.world.props
    props.reserve('crate', props.countOf('crate') + 14)
    const crates: { x: number; y: number; z: number; options: PropOptions }[] = []
    const tint = ['#e2dfd8', '#c8b06a', '#9f875f', '#b9ad86']
    const piles: [number, number, number][] = [[-5.4, 2.6, 5], [-4.2, 5.4, 5], [-6.6, 4.4, 4]]
    for (const [lx, lz, count] of piles) {
      for (let n = 0; n < count; n++) {
        // Three to a course, then a second course sitting 0.12 m
        // proud of it: a stack half taken down, not a wall built on
        // purpose. ASLEEP, because fourteen 6 kg bodies settling a
        // centimetre each is a boot spent simulating tidiness, and
        // the first thing that touches them wakes them anyway.
        const course = Math.floor(n / 3)
        const p = world(yard, facing, lx + (n % 3) * 1.06, lz + course * 0.12)
        crates.push({
          x: p.x,
          y: kit.groundAt(p.x, p.z) + 0.5 + course * 1.02,
          z: p.z,
          options: {
            tag: 'archive',
            scale: 0.9,
            sleeping: true,
            rotation: facing + (kit.rand() - 0.5) * 0.5,
            colour: tint[Math.floor(kit.rand() * tint.length)] ?? tint[0],
          },
        })
      }
    }
    props.addMany('crate', crates)

    /* ---- THE CABLE DRUM ------------------------------------ */
    const drum = world(yard, facing, 6.4, 3.2)
    if (clear(drum, 2)) {
      const drumGround = kit.groundAt(drum.x, drum.z)
      for (const dz of [-0.62, 0.62]) {
        const flange = wheelGeometry(1.15, 0.14, 12)
        flange.rotateY(facing)
        flange.translate(drum.x + Math.sin(facing) * dz, drumGround + 1.15, drum.z + Math.cos(facing) * dz)
        kit.add('timber', flange)
      }
      const spool = wheelGeometry(0.78, 1.1, 12)
      spool.rotateY(facing)
      spool.translate(drum.x, drumGround + 1.15, drum.z)
      kit.add('graphite', spool)
      blocker(kit, drum.x, drumGround + 1.0, drum.z, [1.1, 1.0, 0.7], facing)
    }
  }

  /* ---- THE SATELLITE DISH ----------------------------------
     The yard's one tall silhouette, and the only thing here that
     moves without being hit: it scans, slowly, ±0.8 rad. A dish
     that spins is a fan; a dish that sweeps is listening.
     ---------------------------------------------------------- */
  const dishSpot = stand(-13, 17, 6)
  if (dishSpot) {
    const put = frameAt(dishSpot, facing)
    const ground = kit.groundAt(dishSpot.x, dishSpot.z)
    kit.add('concreteDark', put(chamferedBox(1.9, 0.34, 1.9, 0.05), [0, 0.17, 0]))
    const mast = strutGeometry(0.32, 10)
    mast.scale(1, 3.2, 1)
    kit.add('metal', put(mast, [0, 0.3, 0]))
    for (const dx of [-1.15, 1.15]) {
      kit.add('metal', put(chamferedBox(0.2, 1.7, 0.55, 0.04), [dx, 3.85, 0]))
    }
    // Only the first 1.8 m collides. The yoke and the 6.4 m dish
    // above it are things you drive under, not a wall.
    blocker(kit, dishSpot.x, ground + 0.9, dishSpot.z, [0.55, 0.9, 0.55], facing)

    // A shell of revolution from twelve profile points: the front
    // face out to 3.2 m, a 0.14 m lip, and the back returning to the
    // hub. DoubleSide, and it is the only such material in the
    // district — whichever way the lathe winds, a single-sided dish
    // is culled from half the roads that look at it.
    const profile: THREE.Vector2[] = []
    for (let i = 0; i < 6; i++) {
      const r = (i / 5) * 3.2
      profile.push(new THREE.Vector2(r, (r * r) / 8.4))
    }
    for (let i = 5; i >= 0; i--) {
      const r = (i / 5) * 3.2
      profile.push(new THREE.Vector2(r, (r * r) / 8.4 - 0.14))
    }
    const dishGeometry = new THREE.LatheGeometry(profile, 16)
    const dishMaterial = kit.game.materials.own(new THREE.MeshStandardMaterial({
      color: palette.paper, roughness: 0.9, flatShading: true, side: THREE.DoubleSide,
    }))
    const dish = new THREE.Mesh(dishGeometry, dishMaterial)
    // +Y out of the lathe becomes +Z out of the yoke, tilted 0.61 rad
    // (35°) skyward — the angle a dish at this latitude would sit at,
    // and the angle that shows the visitor the dish rather than its rim.
    dish.rotation.x = Math.PI / 2 - 0.61
    dish.castShadow = kit.game.quality.settings.shadows
    const yoke = new THREE.Group()
    // 4.4 m to the hub. Tilted 35° a 3.2 m dish hangs 2.6 m below its
    // own hub, and at the 3.6 m the yoke wanted the rim came down to
    // 0.98 m — through the roof of a car that has no collider to stop
    // it there.
    yoke.position.set(dishSpot.x, ground + 4.4, dishSpot.z)
    yoke.add(dish)
    kit.group.add(yoke)
    kit.bin.add(() => dishGeometry.dispose())

    // A blue collar on the plinth, so the district's colour is on the
    // one piece of it visible from the far side of the island.
    const collar = new THREE.TorusGeometry(1.05, 0.13, 4, 14)
    collar.rotateX(Math.PI / 2)
    blue.push(put(collar, [0, 0.36, 0]))

    moving.push((t) => { yoke.rotation.y = facing + Math.sin(t * 0.11) * 0.8 })
  }

  /* ---- THE PLOTTER ----------------------------------------
     Still printing, and the print is on the ground: twelve slabs
     stepping from 1.35 rad below the lip to flat, which is a curl
     of paper rather than a ramp of it.
     ---------------------------------------------------------- */
  const plotter = stand(-4, -18, 4)
  if (plotter) {
    const yaw = facing + 1.1
    const put = frameAt(plotter, yaw)
    const ground = kit.groundAt(plotter.x, plotter.z)
    kit.add('concreteDark', put(chamferedBox(3.0, 1.05, 0.85, 0.06), [0, 1.0, 0]))
    blue.push(put(new THREE.BoxGeometry(3.02, 0.28, 0.87), [0, 1.36, 0]))
    for (const dx of [-1.3, 1.3]) {
      kit.add('metal', put(chamferedBox(0.16, 0.5, 0.7, 0.03), [dx, 0.25, 0]))
    }
    kit.add('metal', put(chamferedBox(2.9, 0.12, 0.2, 0.03), [0, 1.5, 0.44]))
    blocker(kit, plotter.x, ground + 0.9, plotter.z, [1.5, 0.9, 0.45], yaw)

    /*
      THE BANNER. Twelve slabs walked out of the feed lip 0.7 m at a
      time, the fall angle stepping 0.5 rad → 0 over the first seven.
      THAT number is the whole trick: the lip is 1.44 m up, so the
      curl has 1.4 m of height to spend, and 0.7·Σsin over those
      seven spends 1.32 of it. Authored steeper — the 1.35 rad a
      sheet leaving a roller actually starts at — it hits the ground
      on the second slab and piles the other ten into the grass.

      Slabs and not planes, because a bucket mesh is single-sided and
      half the yard would be looking at the back of an eight-metre
      sheet of nothing.
    */
    let py = 1.44
    let pz = 0.5
    for (let k = 0; k < 12; k++) {
      const fall = Math.max(0, 0.5 - k * 0.075)
      const slab = new THREE.BoxGeometry(1.2, 0.05, 0.74)
      slab.rotateX(fall)
      kit.add('paper', put(slab, [0, py, pz]))
      py = Math.max(0.06, py - Math.sin(fall) * 0.7)
      pz += Math.cos(fall) * 0.7
      // Print, on the part that has landed flat: bars a plan wide,
      // which is what a plot reads as from a car.
      if (fall > 0.02 || k % 2) continue
      kit.add('ink', put(new THREE.BoxGeometry(0.9, 0.02, 0.14), [0, py + 0.05, pz - 0.35]))
    }
  }

  /* ---- THE BLUEPRINT TABLE --------------------------------- */
  const table = stand(2, 15, 4)
  if (table) {
    const yaw = facing - 0.6
    const put = frameAt(table, yaw)
    const ground = kit.groundAt(table.x, table.z)
    for (const dx of [-1.3, 1.3]) {
      kit.add('metal', put(chamferedBox(0.18, 0.86, 1.5, 0.03), [dx, 0.43, 0]))
    }
    blue.push(put(new THREE.BoxGeometry(3.2, 0.14, 1.8), [0, 0.93, 0]))
    // The drawing on it: an outline and two dividers in white, 2 cm
    // proud of the blue. Line work reads at distance; a texture of it
    // would be a seventh canvas in a district that already has six.
    const lines: [number, number, number, number][] = [
      [2.6, 0.06, 0, 0.62], [2.6, 0.06, 0, -0.62],
      [0.06, 1.3, -1.3, 0], [0.06, 1.3, 1.3, 0], [0.06, 1.3, 0.2, 0],
    ]
    for (const [w, d, x, z] of lines) {
      kit.add('paper', put(new THREE.BoxGeometry(w, 0.03, d), [x, 1.01, z]))
    }
    for (const [dx, dz] of [[-0.9, -0.5], [0.75, 0.35]]) {
      const roll = new THREE.CylinderGeometry(0.11, 0.11, 1.5, 8)
      roll.rotateZ(Math.PI / 2)
      kit.add('paper', put(roll, [dx, 1.11, dz]))
    }
    blocker(kit, table.x, ground + 0.5, table.z, [1.6, 0.5, 0.9], yaw)
  }

  if (moving.length) {
    const tick = () => {
      const t = kit.game.ticker.elapsedScaled
      for (const update of moving) update(t)
    }
    // Order 12, with the other world systems: after the physics and
    // the cameras, and it reads the clock rather than a delta, so a
    // dropped frame moves it on rather than out of step.
    kit.game.ticker.events.on('tick', tick, 12)
    kit.bin.add(() => kit.game.ticker.events.off('tick', tick))
  }

  if (blue.length) {
    const geometry = mergeParts(blue)
    const mesh = new THREE.Mesh(geometry, kit.game.materials.tinted(centre.accent, 0.72))
    mesh.castShadow = kit.game.quality.settings.shadows
    mesh.receiveShadow = kit.game.quality.settings.shadows
    kit.group.add(mesh)
    kit.bin.add(() => geometry.dispose())
  }

  if (dropped && process.env.NODE_ENV === 'development') {
    console.warn(`[dressing] projects: ${dropped} stand(s) found no free ground`)
  }
}
