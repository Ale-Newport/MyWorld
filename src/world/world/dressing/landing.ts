import * as THREE from 'three'
import { chamferedBox, strutGeometry } from '../geometry'
import { monogramTexture, type MaterialName } from '../materials'
import { textPlane, type Dressing } from '../kit'
import { roads } from '@/content/world'
import { isFree, type Zone } from '@/content/world-layout'

/* ============================================================
   LANDING — THE ARRIVALS FORECOURT

   This is the plate you are put down on, and it already carries
   the loudest object on the island: sixteen physical letters
   spelling ALEJANDRO NEWPORT across a 30 x 18 m ellipse. So the
   dressing does not compete with them. It does what an airfield
   apron or a village fair does — an arch you drive under, bunting
   on masts, planters marking the edge of the paving, a luggage
   trolley, a tyre stack, a monogram on a post and a wind sock —
   and leaves the middle to the name.

   IT IS THE MOST CROWDED GROUND ON THE ISLAND AND THE NUMBERS SAY
   SO. Probing the registry on a 2 m grid over the whole district,
   every single sample inside the plate is refused: the letters own
   the centre and the east, four carriageways leave the junction at
   (43.4, 1.4) in four directions, and the plate itself is a HARD
   footprint. So nothing here is placed at a bearing and hoped for.
   Every piece asks `free()` and walks OUTWARD until it is allowed,
   and the ones that never find room are simply not built — which
   is why this file draws a variable number of masts and planters
   and never assumes it got them all.

   COST. Seven merge buckets (metal, ink, concrete, timber,
   foliageLight and the two emissives), plus three meshes that cannot
   be merged: the WELCOME label, the monogram face, and the wind sock,
   which turns with `game.weather`. Ten draw calls for a forecourt of
   about twenty pieces.
   ============================================================ */

/**
 * The margins this forecourt places against.
 *
 * `road: -2` is the same trick the scenery lanterns use: a road's
 * footprint is width/2 + 1.6, and street furniture belongs on the
 * verge just outside the carriageway, not three metres back in the
 * grass. With the plain rules every mast and planter on this plate
 * was refused. What the test still catches is a piece standing in a
 * DIFFERENT road, which on a four-way junction is the real risk.
 *
 * `letters` is deliberately absent from `allow`: the name's own
 * footprint is what keeps this dressing out of the A of ALEJANDRO.
 */
const MARGIN = { road: -2, water: 1.5, ramp: 4, landmark: 0.4, respawn: 0.5 } as const

/** A yaw that points a shape's local +X down (dx, dz).
 *  `rotateY(t)` sends +X to (cos t, 0, −sin t), which is the sign
 *  error every hand-written yaw in this world has made once. */
function yawTo(dx: number, dz: number): number {
  return Math.atan2(-dz, dx)
}

export function dressLanding(kit: Dressing): void {
  const here = kit.district('landing')

  /* The paved apron ends at the plate's own radius x 1.25 (that is
     what `zones()` registers), and the district radius is twice the
     plate. 0.62 of the radius is therefore the paving edge to within
     a few centimetres — the ring furniture belongs ON, not beyond. */
  const APRON = here.radius * 0.62

  /* Pieces already standing, fed back to `isFree` as `extra` so the
     set spaces itself instead of finding the same gap eight times. */
  const placed: Zone[] = []

  /** Free ground at (x, z), by the same oracle the ecology uses. */
  const free = (x: number, z: number, clearance: number): boolean =>
    isFree(x, z, { clearance, allow: ['plate'], margin: MARGIN, extra: placed })

  /**
   * A site near a bearing, spiralling out until the registry allows it.
   *
   * WALKING STRAIGHT OUT IS NOT ENOUGH HERE. Measured on the live
   * layout: of 576 samples round this apron only 44 are free, and
   * they are in pockets BETWEEN the carriageways, not along them —
   * a search that only steps radially found four sites out of
   * twenty-one and the forecourt came out empty. Swinging ±0.5 rad
   * as well as stepping 10 m out finds twenty of the twenty-one,
   * and every one of them is within a few metres of where the set
   * was drawn.
   */
  const SWING = [0, 0.12, -0.12, 0.24, -0.24, 0.36, -0.36, 0.5, -0.5]
  const stand = (bearing: number, radius: number, clearance: number) => {
    for (let ring = 0; ring < 5; ring++) {
      for (const swing of SWING) {
        const r = radius + ring * 2.6
        const x = here.x + Math.cos(bearing + swing) * r
        const z = here.z + Math.sin(bearing + swing) * r
        if (!free(x, z, clearance)) continue
        placed.push({ id: `landing-dressing-${placed.length}`, kind: 'landmark', x, z, radius: clearance })
        return { x, z, y: kit.groundAt(x, z) }
      }
    }
    return null
  }

  /** A chamfered box straight into a bucket, pre-positioned in world
   *  space. `solidBox` would be a draw call each; this is a sixth of one. */
  const box = (
    material: MaterialName,
    w: number, h: number, d: number,
    x: number, y: number, z: number,
    yaw = 0, chamfer = 0.06,
  ) => {
    const g = chamferedBox(w, h, d, chamfer)
    if (yaw) g.rotateY(yaw)
    g.translate(x, y, z)
    kit.add(material, g)
  }

  /** A tapered mast, origin at its foot. */
  const mast = (
    material: MaterialName,
    radius: number, height: number, x: number, y: number, z: number,
  ) => {
    const g = strutGeometry(radius, 8)
    g.scale(1, height, 1)
    g.translate(x, y, z)
    kit.add(material, g)
  }

  /** A static collider with no mesh of its own — the shape it stands
   *  for is already in a merge bucket. Same parameters `solidBox`
   *  uses, so dressing and landmarks feel the same to a bumper. */
  const blockAt = (
    x: number, y: number, z: number,
    hw: number, hh: number, hd: number, yaw = 0,
  ) => {
    kit.game.physics.add({
      type: 'fixed', category: 'floor',
      position: { x, y, z },
      rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
      friction: 0.7, restitution: 0.12,
      colliders: [{ shape: 'cuboid', parameters: [hw, hh, hd] }],
    })
  }

  /* ---- the arrivals arch -----------------------------------
     Over the road you actually leave on, at the apron edge, so the
     first thing the car does is drive under something.

     The road is FOUND, not named: four carriageways leave the
     junction and any of them is a fair arrival. We take the first
     whose crossing of the apron ring has room for both posts —
     which also means that if a road is re-routed the arch follows
     it instead of standing in a field.

     COLLIDERS ON THE POSTS ONLY. The lintel is 6.4 m up and 17 m
     wide; giving it the collider its silhouette suggests would put
     an invisible wall across a carriageway, and `world:clearance`
     would be right to fail it. */
  let arched = false
  for (const road of roads) {
    if (arched) break
    const start = road.points[0]
    if (Math.hypot(start[0] - here.x, start[1] - here.z) > APRON) continue
    // Four rings, because the junction end of every one of these
    // roads is inside another one's corridor and inside a respawn:
    // on the live layout the arch only fits three metres INSIDE the
    // apron, on the westbound carriageway.
    for (const ring of [APRON, APRON - 3, APRON + 3, APRON + 6]) {
      let crossing: { x: number; z: number; angle: number } | null = null
      for (let i = 0; i < road.points.length - 1 && !crossing; i++) {
        const [ax, az] = road.points[i]
        const [bx, bz] = road.points[i + 1]
        const near = Math.hypot(ax - here.x, az - here.z)
        const far = Math.hypot(bx - here.x, bz - here.z)
        if (near > ring || far < ring) continue
        const t = (ring - near) / Math.max(0.001, far - near)
        crossing = { x: ax + (bx - ax) * t, z: az + (bz - az) * t, angle: Math.atan2(bz - az, bx - ax) }
      }
      if (!crossing) continue

      // The perpendicular, and 2.2 m of verge outside the shoulder.
      const nx = Math.sin(crossing.angle)
      const nz = -Math.cos(crossing.angle)
      const reach = road.width / 2 + 2.2
      const feet = [1, -1].map((side) => ({
        x: crossing.x + nx * reach * side,
        z: crossing.z + nz * reach * side,
      }))
      if (!feet.every((f) => free(f.x, f.z, 1.2))) continue

      const yaw = yawTo(nx, nz)
      const head = Math.max(...feet.map((f) => kit.groundAt(f.x, f.z))) + 6.4
      for (const foot of feet) {
        const y = kit.groundAt(foot.x, foot.z)
        box('metal', 0.55, head - y + 0.2, 0.55, foot.x, (head + y) / 2, foot.z, yaw)
        blockAt(foot.x, y + 1.5, foot.z, 0.34, 1.5, 0.34, yaw)
        placed.push({ id: `landing-arch-${placed.length}`, kind: 'landmark', x: foot.x, z: foot.z, radius: 1.4 })
      }
      box('ink', reach * 2 + 0.9, 1.1, 0.7, crossing.x, head + 0.55, crossing.z, yaw)
      /* `textPlane` reads its position in the PARENT's space and its
         context only for a material and a bin, so a world position on
         `kit.group` is right and `kit.site` here is only the ctx. It is
         double-sided, so both approaches read it. */
      textPlane(kit.site(crossing.x, crossing.z, yaw), kit.group, 'WELCOME', 0.78,
        [
          crossing.x + Math.cos(crossing.angle) * 0.38,
          head + 0.55,
          crossing.z + Math.sin(crossing.angle) * 0.38,
        ],
        { color: '#f2f1ee', rotation: yaw, letterSpacing: 0.3 })
      arched = true
      break
    }
  }

  /* ---- the monogram disc -----------------------------------
     A 4.8 m disc on a post, facing the middle of the plate: the
     mark that says whose forecourt this is, at the one scale a
     driving camera reads. The face is the only textured thing in
     the set — one canvas, one material, one draw call — and it is
     on the front only. A double-sided monogram is a mirrored one. */
  const badge = stand(-2.35, APRON * 0.95, 2.4)
  if (badge) {
    const { x, y, z } = badge
    const facing = yawTo(here.x - x, here.z - z)
    box('metal', 0.35, 3.2, 0.35, x, y + 1.6, z, facing)
    const disc = new THREE.CylinderGeometry(2.4, 2.4, 0.35, 24)
    // rotateX stands the cylinder on its rim with its axis on +Z; the
    // extra quarter turn is what swings that axis round to the bearing
    // `facing` points along, so the FACE looks at the plate.
    disc.rotateX(Math.PI / 2)
    disc.rotateY(facing + Math.PI / 2)
    disc.translate(x, y + 4.5, z)
    kit.add('concrete', disc)

    const face = new THREE.CircleGeometry(2.15, 28)
    const texture = monogramTexture('#0c0c0d', '#f4f2ee')
    const material = kit.game.materials.own(
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
    )
    const plate = new THREE.Mesh(face, material)
    plate.position.set(x + Math.cos(facing) * 0.19, y + 4.5, z - Math.sin(facing) * 0.19)
    plate.rotation.y = facing + Math.PI / 2
    kit.group.add(plate)
    kit.bin.add(() => { face.dispose(); texture.dispose() })
    // The post, not the disc: the disc is four metres up.
    blockAt(x, y + 1.5, z, 0.3, 1.5, 0.3, facing)
  }

  /* ---- the wind sock ---------------------------------------
     The one moving thing on the forecourt, and the only piece here
     that cannot live in a bucket. It reads `game.weather`, so the
     apron tells you which way the wind is blowing before the trees
     do — and in a world with a permanent noon and no night, weather
     is the only ambient state a visitor can actually watch change.

     Open cone, apex downwind: it hangs at rest and lifts towards
     horizontal as `windStrength` rises, which is what a real sock
     does and what makes it legible as an instrument. */
  const sock = stand(0.55, APRON * 1.02, 1.6)
  if (sock) {
    mast('metal', 0.09, 5.0, sock.x, sock.y, sock.z)
    blockAt(sock.x, sock.y + 1.5, sock.z, 0.22, 1.5, 0.22)

    const pivot = new THREE.Group()
    pivot.position.set(sock.x, sock.y + 4.85, sock.z)
    kit.group.add(pivot)
    const cone = new THREE.ConeGeometry(0.55, 2.4, 8, 1, true)
    // Lay the cone along +X with its mouth at the mast.
    cone.rotateZ(-Math.PI / 2)
    cone.translate(1.2, 0, 0)
    const sleeve = new THREE.Mesh(cone, kit.game.materials.get('accent'))
    sleeve.castShadow = kit.game.quality.settings.shadows
    pivot.add(sleeve)
    kit.bin.add(() => cone.dispose())

    const tick = () => {
      const wind = kit.game.weather.windDirection
      pivot.rotation.y = yawTo(wind.x, wind.y)
      // Calm hangs at −0.75 rad, a storm (windStrength 1) sits flat.
      sleeve.rotation.z = -0.75 * (1 - Math.min(1, kit.game.weather.windStrength))
    }
    kit.game.ticker.events.on('tick', tick, 12)
    kit.bin.add(() => kit.game.ticker.events.off('tick', tick))
  }

  /* ---- the luggage trolley ---------------------------------
     An airport flat-bed with three cases still on it. Low, wide,
     and one collider for the whole thing so a car shunts it as one
     object rather than catching a wheel. */
  const trolley = stand(-1.15, APRON * 0.92, 2.2)
  if (trolley) {
    const yaw = yawTo(here.x - trolley.x, here.z - trolley.z)
    const { x, y, z } = trolley
    box('metal', 2.6, 0.18, 1.4, x, y + 0.62, z, yaw)
    for (const [dx, dz] of [[-1.1, -0.5], [1.1, -0.5], [-1.1, 0.5], [1.1, 0.5]]) {
      // A torus is born in XY with its axle on +Z, which is already a
      // wheel; yawing it puts that axle across the trolley. The tyre
      // stacks below take the extra rotateX because a tyre on the
      // ground lies down and a wheel does not.
      const g = new THREE.TorusGeometry(0.24, 0.09, 5, 10)
      g.rotateY(yaw)
      g.translate(x + Math.cos(yaw) * dx + Math.sin(yaw) * dz, y + 0.26, z - Math.sin(yaw) * dx + Math.cos(yaw) * dz)
      kit.add('ink', g)
    }
    // The push handle, at the end nearest the middle of the plate.
    for (const side of [-0.55, 0.55]) {
      mast('metal', 0.05, 1.0, x + Math.cos(yaw) * 1.2 + Math.sin(yaw) * side, y + 0.7, z - Math.sin(yaw) * 1.2 + Math.cos(yaw) * side)
    }
    box('metal', 0.08, 0.08, 1.2, x + Math.cos(yaw) * 1.2, y + 1.68, z - Math.sin(yaw) * 1.2, yaw)
    // Three cases, stacked the way luggage actually is: badly.
    const cases: [number, number, number, number][] = [[-0.6, 0.9, 1.16, 0.2], [0.35, 0.75, 1.09, -0.35], [0.2, 0.6, 1.77, 0.6]]
    for (const [along, size, lift, tilt] of cases) {
      box('timber', size * 1.5, size, size * 0.9,
        x + Math.cos(yaw) * along, y + lift, z - Math.sin(yaw) * along, yaw + tilt, 0.05)
    }
    blockAt(x, y + 0.45, z, 1.35, 0.45, 0.75, yaw)
  }

  /* ---- tyre stacks -----------------------------------------
     Three of them, near the arch. Tori rather than cylinders: the
     hole is the whole difference between a tyre and a bollard at
     thirty metres. One cylinder collider per stack, 1.1 m tall —
     the height of the rubber, so what you see is what you hit. */
  for (let i = 0; i < 3; i++) {
    const at = stand(2.1 + i * 0.55, APRON * 0.8, 1.4)
    if (!at) continue
    for (let t = 0; t < 3; t++) {
      const g = new THREE.TorusGeometry(0.62, 0.24, 6, 12)
      g.rotateX(Math.PI / 2)
      g.rotateY(kit.rand() * Math.PI)
      g.translate(at.x, at.y + 0.26 + t * 0.44, at.z)
      kit.add('ink', g)
    }
    kit.game.physics.add({
      type: 'fixed', category: 'floor',
      position: { x: at.x, y: at.y + 0.55, z: at.z },
      friction: 0.7, restitution: 0.12,
      colliders: [{ shape: 'cylinder', parameters: [0.55, 0.86] }],
    })
  }

  /* ---- planters --------------------------------------------
     Six of them, on the bearings between the masts, to give the
     paving an edge that is not just where the texture stops. The
     collider is the tub and nothing else: 0.9 m of concrete is a
     kerb you can see, and the crown above it is foliage. */
  for (let i = 0; i < 6; i++) {
    const at = stand((i / 6) * Math.PI * 2 + 0.9, APRON * 0.88, 1.5)
    if (!at) continue
    box('concrete', 1.6, 0.9, 1.6, at.x, at.y + 0.45, at.z, kit.rand() * 0.6, 0.1)
    const crown = new THREE.IcosahedronGeometry(0.86, 1)
    crown.scale(1, 0.82, 1)
    crown.translate(at.x, at.y + 1.32, at.z)
    kit.add('foliageLight', crown)
    blockAt(at.x, at.y + 0.45, at.z, 0.8, 0.45, 0.8)
  }

  /* ---- bunting ---------------------------------------------
     The cheapest "this is a place" signal there is, and it goes in
     LAST: twelve 4 m masts round the apron and a garland of pennants
     between any two that both found ground and ended up within 18 m
     of each other. Nine of the twelve fit on the live layout and
     they make six runs; where the letters or a carriageway eat a
     mast the garland simply stops, which reads as bunting rather
     than as a fault. Thin things go last on purpose — a 0.07 m mast
     will fit in a gap the monogram disc needs, and the disc is the
     piece you see from the road.

     No colliders. A 0.07 m mast is invisible from the driving
     camera and stopping a car on one is a bug, not a feature. */
  const posts: { x: number; y: number; z: number }[] = []
  for (let i = 0; i < 12; i++) {
    const at = stand((i / 12) * Math.PI * 2 + 0.35, APRON, 1.1)
    if (at) {
      mast('metal', 0.07, 4.0, at.x, at.y, at.z)
      posts.push(at)
    }
  }
  for (let i = 0; i + 1 < posts.length; i++) {
    const a = posts[i]
    const b = posts[i + 1]
    const gap = Math.hypot(b.x - a.x, b.z - a.z)
    if (gap > 18) continue
    const yaw = yawTo(b.x - a.x, b.z - a.z)
    const count = Math.max(4, Math.round(gap / 1.6))
    for (let p = 1; p < count; p++) {
      const t = p / count
      const g = chamferedBox(0.5, 0.72, 0.04, 0.02)
      g.rotateZ((p % 2 ? 1 : -1) * 0.42)
      g.rotateY(yaw)
      // A rope sags; a straight line between two masts reads as a
      // wire. sin() at 0.14 of the span is about a metre at 7 m.
      g.translate(
        a.x + (b.x - a.x) * t,
        a.y + 3.4 + (b.y - a.y) * t - Math.sin(Math.PI * t) * gap * 0.14,
        a.z + (b.z - a.z) * t,
      )
      kit.add(p % 2 ? 'emissiveAccent' : 'emissiveSignal', g)
    }
  }
}
