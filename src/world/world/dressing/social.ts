import * as THREE from 'three'
import { chamferedBox, strutGeometry } from '../geometry'
import { monogramTexture, type MaterialName } from '../materials'
import { textPlane, type Dressing } from '../kit'
import { landmarkById } from '@/content/world'
import { isFree, type Zone } from '@/content/world-layout'

/* ============================================================
   SOCIAL — THE BROADCAST SET

   The district is already a nine-metre camera on a tripod with four
   link posts round it. That is a subject with nothing pointed at
   it, so this dresses the rest of the shoot: softboxes angled back
   at the lens, a boom reaching in over the plate, a clapperboard
   and film reels on the deck, cable drums, a director's chair, a
   step-and-repeat backdrop for the camera to look at, and an ON AIR
   sign that comes up when you drive in.

   THE SOFTBOXES ARE THE POINT. This world has exactly two lights
   and will never have a third — a `PointLight` here would recompile
   every lit shader on the island and, at a permanent noon with
   `nightFactor` pinned to 0, would not be visible anyway. So studio
   lighting is FAKED as geometry: three 1.6 m `emissiveWhite` panels
   on stands, unlit and tone-mapping-exempt, aimed at the camera.
   They read as lights from thirty metres because they are the only
   pure white in the frame, not because they emit anything.

   WHERE IT ALL STANDS IS SEARCHED, NOT TYPED. The plate is 11 m,
   the four sign posts eat its west side and — the real constraint —
   the bowling venue registers a 15 m capsule round a lane that is
   only 11.4 m wide, and the whole of SOCIAL lies inside it. That
   single footprint is what deletes all seventeen of the district's
   scattered props today. So the set finds its own stage: it scores
   the bearings round the camera for free ground and builds along
   the best one, which on the live layout comes out west-north-west,
   across the open side away from the lane.

   COST. Seven merge buckets, plus the ON AIR face (its opacity is
   animated, so it cannot be shared), its label, and the backdrop's
   repeated monogram. Ten draw calls.
   ============================================================ */

/**
 * `play: -8` is the honest reading of a footprint that over-claims.
 * The bowling capsule is 15 m round the lane's centreline and the
 * lane itself is 5.7 m half-width; −8 keeps this set 7 m off that
 * centreline — 1.3 m clear of the actual bed — instead of pretending
 * the venue owns the whole of the next district.
 */
const MARGIN = { play: -8, road: -1, water: 1.5, landmark: 0.4, respawn: 0.5 } as const

/** A yaw that points a shape's local +X down (dx, dz). */
function yawTo(dx: number, dz: number): number {
  return Math.atan2(-dz, dx)
}

/** A yaw that points a shape's local +Z — a face's normal — down (dx, dz).
 *  Every piece on this set is built facing the lens, so this is the
 *  angle nearly everything below is rotated by. */
function faceTo(dx: number, dz: number): number {
  return Math.atan2(dx, dz)
}

/** The same direction, for a shape whose LENGTH is its local +X — the
 *  boom arm. `rotateY` sends +X a quarter turn ahead of +Z. */
function alongFacing(facing: number): number {
  return facing - Math.PI / 2
}

export function dressSocial(kit: Dressing): void {
  const here = kit.district('social')
  // The camera is the set's origin, and it is not the district's
  // centre — it stands two metres off it, which is exactly the sort
  // of offset that ends up wrong when it is retyped as a literal.
  const camera = landmarkById['social-camera']
  if (!camera) return
  const eye = { x: camera.x, z: camera.z }

  const placed: Zone[] = []
  const free = (x: number, z: number, clearance: number): boolean =>
    isFree(x, z, { clearance, allow: ['plate'], margin: MARGIN, extra: placed })

  /**
   * A site at (bearing, distance) FROM THE CAMERA, moved as little as
   * possible to somewhere the registry allows.
   *
   * Fifty-four candidates — nine bearings either side of the wanted
   * one and six distances — are SORTED by how far they are from the
   * spot the set was drawn at, and the nearest legal one wins. A
   * search that just steps outward finds a legal spot on the far side
   * of the district and puts the clapperboard thirty metres from the
   * camera; this one moves the whole set by an average of two metres
   * and never breaks the composition.
   *
   * The footprint each piece leaves behind is 0.6 of its clearance.
   * Clearance is the room it wants from a carriageway or a lane; a
   * film set is meant to be cluttered, and spacing the pieces from
   * each other by the same number left it looking like a car park.
   */
  const SWING = [0, 0.2, -0.2, 0.4, -0.4, 0.6, -0.6, 0.8, -0.8]
  const RING = [0, 1.4, -1.4, 2.8, -2.8, 4.2]
  const mark = (bearing: number, distance: number, clearance: number) => {
    const x0 = eye.x + Math.cos(bearing) * distance
    const z0 = eye.z + Math.sin(bearing) * distance
    const tries: { away: number; x: number; z: number }[] = []
    for (const out of RING) {
      const r = distance + out
      // Inside 4.2 m is the tripod's own splay, and the registry
      // refuses it anyway — the reels are the only thing that belongs
      // in there and they are placed without asking.
      if (r < 4.2) continue
      for (const swing of SWING) {
        const x = eye.x + Math.cos(bearing + swing) * r
        const z = eye.z + Math.sin(bearing + swing) * r
        tries.push({ away: Math.hypot(x - x0, z - z0), x, z })
      }
    }
    tries.sort((a, b) => a.away - b.away)
    for (const { x, z } of tries) {
      // A set piece outside the discovery disc is a set piece in
      // somebody else's district.
      if (Math.hypot(x - here.x, z - here.z) > here.radius) continue
      if (!free(x, z, clearance)) continue
      placed.push({ id: `social-dressing-${placed.length}`, kind: 'landmark', x, z, radius: clearance * 0.6 })
      return { x, z, y: kit.groundAt(x, z), facing: faceTo(eye.x - x, eye.z - z) }
    }
    return null
  }

  /* ---- the stage bearing -----------------------------------
     Twenty-four bearings, scored by how much of the arc from 5 to
     12 m out is free ground. The set is then laid out in that
     frame, so if the bowling lane moves or a sign is re-sited the
     whole shoot rotates to the open side instead of ending up
     inside a wall. */
  let stage = 0
  let best = -1
  for (let i = 0; i < 24; i++) {
    const bearing = (i / 24) * Math.PI * 2
    let score = 0
    for (const r of [5, 7, 9, 11, 13]) {
      if (free(eye.x + Math.cos(bearing) * r, eye.z + Math.sin(bearing) * r, 1.6)) score++
    }
    if (score > best) { best = score; stage = bearing }
  }

  /* ---- helpers ---------------------------------------------- */

  const box = (
    material: MaterialName,
    w: number, h: number, d: number,
    x: number, y: number, z: number,
    yaw = 0, chamfer = 0.05,
  ) => {
    const g = chamferedBox(w, h, d, chamfer)
    if (yaw) g.rotateY(yaw)
    g.translate(x, y, z)
    kit.add(material, g)
  }

  /** A post, origin at its foot; `lean` radians tip its TOP towards the
   *  bearing `towards`.
   *
   *  The negated `rotateZ` is not a typo. `rotateZ(+t)` sends +Y towards
   *  −X, so passing the lean straight through splays the tops outward
   *  and meets the feet at a point: an upside-down tripod, which is the
   *  exact bug the camera landmark's own comment records having shipped. */
  const post = (
    material: MaterialName,
    radius: number, height: number,
    x: number, y: number, z: number,
    lean = 0, towards = 0,
  ) => {
    const g = strutGeometry(radius, 8)
    g.scale(1, height, 1)
    if (lean) { g.rotateZ(-lean); g.rotateY(towards) }
    g.translate(x, y, z)
    kit.add(material, g)
  }

  /** A collider with no mesh: the shape is already in a bucket, and
   *  `solidBox` would cost a draw call per stand. */
  const blockAt = (x: number, y: number, z: number, hw: number, hh: number, hd: number, yaw = 0) => {
    kit.game.physics.add({
      type: 'fixed', category: 'floor',
      position: { x, y, z },
      rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
      friction: 0.7, restitution: 0.12,
      colliders: [{ shape: 'cuboid', parameters: [hw, hh, hd] }],
    })
  }

  /* ---- softboxes -------------------------------------------
     Three of them across the front of the stage, each aimed at the
     lens and raked 16 degrees down, which is where a key light
     actually sits. The collider is the base and only the base: a
     0.35 m cylinder you clip and slide off, not a 3 m wall. */
  for (const swing of [-0.62, 0, 0.62]) {
    const at = mark(stage + swing, 9 - Math.abs(swing) * 1.6, 1.5)
    if (!at) continue
    const { x, y, z, facing } = at
    for (let leg = 0; leg < 3; leg++) {
      const bearing = (leg / 3) * Math.PI * 2 + facing
      post('metal', 0.055, 2.9,
        x + Math.cos(bearing) * 0.52, y, z + Math.sin(bearing) * 0.52,
        0.17, yawTo(-Math.cos(bearing), -Math.sin(bearing)))
    }
    const nx = Math.sin(facing)
    const nz = Math.cos(facing)
    const head = (w: number, h: number, d: number, out: number, material: MaterialName) => {
      const g = chamferedBox(w, h, d, 0.04)
      g.rotateX(0.28)
      g.rotateY(facing)
      g.translate(x + nx * out, y + 3.35, z + nz * out)
      kit.add(material, g)
    }
    head(1.9, 1.9, 0.28, 0, 'graphite')
    head(1.62, 1.62, 0.06, 0.19, 'emissiveWhite')
    kit.game.physics.add({
      type: 'fixed', category: 'floor',
      position: { x, y: y + 0.5, z },
      friction: 0.7, restitution: 0.12,
      colliders: [{ shape: 'cylinder', parameters: [0.5, 0.35] }],
    })
  }

  /* ---- the step-and-repeat backdrop -------------------------
     What the camera is pointed AT, so it goes on the far side of
     the stage: a 5.2 m board of repeated monograms. One canvas
     texture with `repeat` set does the whole wall, which is the
     difference between one draw call and twenty-four.

     This one collides at full height. It is a wall, it looks like a
     wall, and driving into it should stop you. */
  const wall = mark(stage - 0.3, 12.2, 2.6)
  if (wall) {
    const { x, y, z, facing } = wall
    for (const side of [-2.4, 2.4]) {
      // The board's own left and right: perpendicular to the way it looks.
      post('metal', 0.11, 3.0,
        x + Math.cos(facing) * side, y, z - Math.sin(facing) * side)
    }
    box('paperDark', 5.2, 2.6, 0.2, x, y + 1.55, z, facing)

    const texture = monogramTexture('#5f8490', '#f4f2ee')
    texture.wrapS = THREE.RepeatWrapping
    texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(5, 3)
    const skin = new THREE.PlaneGeometry(5.0, 2.44)
    const face = new THREE.Mesh(
      skin,
      kit.game.materials.own(new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })),
    )
    face.position.set(x + Math.sin(facing) * 0.12, y + 1.55, z + Math.cos(facing) * 0.12)
    face.rotation.y = facing
    kit.group.add(face)
    kit.bin.add(() => { skin.dispose(); texture.dispose() })
    blockAt(x, y + 1.3, z, 2.6, 1.3, 0.16, facing)
  }

  /* ---- ON AIR -----------------------------------------------
     The one piece of state in the district. Its face sits at 0.45
     opacity while nobody is here and ramps to full over about two
     seconds once the player is inside the discovery radius — which
     is the only "it turns on" this lighting model permits, since
     `nightFactor` is permanently 0 and an actual lamp would never be
     seen. The material is `own`ed rather than `flat`ed on purpose:
     `flat()` is CACHED, and animating a cached material's opacity
     would dim every other unlit surface that shares its colour. */
  const onAir = mark(stage + 0.45, 11.8, 1.8)
  if (onAir) {
    const { x, y, z, facing } = onAir
    for (const side of [-1.5, 1.5]) {
      const px = x + Math.cos(facing) * side
      const pz = z - Math.sin(facing) * side
      post('metal', 0.09, 2.6, px, y, pz)
      blockAt(px, y + 0.7, pz, 0.16, 0.7, 0.16)
    }
    const plate = chamferedBox(3.4, 0.92, 0.16, 0.05)
    plate.rotateY(facing)
    plate.translate(x, y + 2.9, z)
    const material = kit.game.materials.own(new THREE.MeshBasicMaterial({
      color: new THREE.Color('#d4491f'), transparent: true, opacity: 0.45, toneMapped: false,
    }))
    const lamp = new THREE.Mesh(plate, material)
    kit.group.add(lamp)
    kit.bin.add(() => plate.dispose())
    textPlane(kit.site(x, z, facing), kit.group, 'ON AIR', 0.44,
      [x + Math.sin(facing) * 0.11, y + 2.9, z + Math.cos(facing) * 0.11],
      { color: '#f4f2ee', rotation: facing, letterSpacing: 0.26 })

    const tick = () => {
      const player = kit.game.player.position
      const inside = Math.hypot(player.x - here.x, player.z - here.z) < here.radius
      const target = inside ? 1 : 0.45
      // 0.55 per second of the remaining gap is a two-second ramp,
      // slow enough to read as a sign warming up rather than a switch.
      material.opacity += (target - material.opacity) * Math.min(1, kit.game.ticker.delta * 0.55)
    }
    kit.game.ticker.events.on('tick', tick, 12)
    kit.bin.add(() => kit.game.ticker.events.off('tick', tick))
  }

  /* ---- the boom ---------------------------------------------
     A 5 m arm over the plate on a 2.4 m stand. Nothing above the
     stand collides: an overhead beam a car cannot see is the one
     shape this world is most careful never to build. */
  const boom = mark(stage + 1.0, 7.6, 1.4)
  if (boom) {
    const { x, y, z, facing } = boom
    const along = alongFacing(facing)
    post('metal', 0.075, 2.4, x, y, z)
    blockAt(x, y + 0.6, z, 0.2, 0.6, 0.2)
    const arm = chamferedBox(5.0, 0.13, 0.13, 0.03)
    arm.rotateZ(0.2)
    arm.rotateY(along)
    arm.translate(x + Math.sin(facing) * 2.3, y + 2.9, z + Math.cos(facing) * 2.3)
    kit.add('metal', arm)
    const mic = new THREE.CylinderGeometry(0.24, 0.24, 0.86, 10)
    mic.rotateZ(Math.PI / 2 + 0.2)
    mic.rotateY(along)
    mic.translate(x + Math.sin(facing) * 4.7, y + 3.4, z + Math.cos(facing) * 4.7)
    kit.add('chalk', mic)
  }

  /* ---- the clapperboard -------------------------------------
     Lying on the deck where it was dropped, clapper open. Six
     stripes alternating chalk and ink is the one piece of pattern
     in the set and it is what makes the object legible; no
     collider, because it is 0.2 m thick and you drive over it. */
  const slate = mark(stage - 0.2, 6.6, 1.1)
  if (slate) {
    const { x, y, z, facing } = slate
    const lay = (g: THREE.BufferGeometry, dx: number, dy: number, dz: number, hinge: number) => {
      g.rotateX(-Math.PI / 2 + hinge)
      g.rotateY(facing)
      g.translate(x + Math.sin(facing) * dz + Math.cos(facing) * dx, y + dy, z + Math.cos(facing) * dz - Math.sin(facing) * dx)
    }
    const body = chamferedBox(2.4, 1.5, 0.14, 0.04)
    lay(body, 0, 0.09, 0, 0.1)
    kit.add('ink', body)
    for (let i = 0; i < 6; i++) {
      const stripe = chamferedBox(0.38, 0.3, 0.14, 0.03)
      // The clapper stands open at 0.5 rad — a closed one is a plank.
      lay(stripe, (i / 5 - 0.5) * 2.05, 0.4, 0.72, 0.5)
      kit.add(i % 2 ? 'chalk' : 'ink', stripe)
    }
  }

  /* ---- the director's chair ---------------------------------
     Facing the lens, on the crossed X-frame that makes the shape
     recognisable at any distance. Canvas in `signal`, the world's
     green counterpoint, so the one seat is not another grey box. */
  const chair = mark(stage - 0.62, 6.4, 0.9)
  if (chair) {
    const { x, y, z, facing } = chair
    // Crossed: the front pair's tops go back, the back pair's forward.
    for (const side of [-0.42, 0.42]) {
      for (const tip of [-0.3, 0.3]) {
        post('graphite', 0.05, 1.02,
          x + Math.cos(facing) * side + Math.sin(facing) * tip, y,
          z - Math.sin(facing) * side + Math.cos(facing) * tip,
          0.28, alongFacing(facing) + (tip > 0 ? Math.PI : 0))
      }
    }
    box('signal', 1.0, 0.1, 0.82, x, y + 0.94, z, facing)
    const back = chamferedBox(1.0, 0.44, 0.1, 0.04)
    back.rotateY(facing)
    back.translate(x - Math.sin(facing) * 0.38, y + 1.42, z - Math.cos(facing) * 0.38)
    kit.add('signal', back)
  }

  /* ---- film reels -------------------------------------------
     Leaned against the tripod's own legs, which is the ONE place in
     this file that does not ask `isFree` — the camera's footprint
     is where they belong, and the registry is right to refuse
     anything else there. Thin, at ground level, no colliders. */
  for (let i = 0; i < 5; i++) {
    const bearing = (i / 5) * Math.PI * 2 + 0.4
    const rx = eye.x + Math.cos(bearing) * 2.5
    const rz = eye.z + Math.sin(bearing) * 2.5
    const y = kit.groundAt(rx, rz)
    const lean = yawTo(Math.cos(bearing), Math.sin(bearing))
    const disc = new THREE.CylinderGeometry(0.86, 0.86, 0.16, 16)
    disc.rotateZ(Math.PI / 2 - 0.28)
    disc.rotateY(lean)
    disc.translate(rx, y + 0.84, rz)
    kit.add('metal', disc)
    const hub = new THREE.CylinderGeometry(0.22, 0.22, 0.2, 10)
    hub.rotateZ(Math.PI / 2 - 0.28)
    hub.rotateY(lean)
    hub.translate(rx, y + 0.84, rz)
    kit.add('ink', hub)
  }

  /* ---- cable drums ------------------------------------------
     Standing on their rims, the way they are left in a yard. No
     colliders: a drum that a 2.5 kg car bounces off reads as
     scenery, and one it drives through reads as a drum. */
  for (const [swing, distance] of [[0.95, 9.6], [0.75, 11.6], [-0.9, 9.6]]) {
    const at = mark(stage + swing, distance, 0.9)
    if (!at) continue
    const { x, y, z, facing } = at
    for (const side of [-0.28, 0.28]) {
      const cheek = new THREE.CylinderGeometry(0.66, 0.66, 0.13, 14)
      cheek.rotateZ(Math.PI / 2)
      cheek.rotateY(facing)
      cheek.translate(x + Math.cos(facing) * side, y + 0.66, z - Math.sin(facing) * side)
      kit.add('metal', cheek)
    }
    const core = new THREE.CylinderGeometry(0.38, 0.38, 0.5, 12)
    core.rotateZ(Math.PI / 2)
    core.rotateY(facing)
    core.translate(x, y + 0.66, z)
    kit.add('ink', core)
  }
}
