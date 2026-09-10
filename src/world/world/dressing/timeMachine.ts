import * as THREE from 'three'
import type { Dressing } from '../kit'
import { palette } from '../../core/palette'
import { chamferedBox, convexHull, wheelGeometry } from '../geometry'
import { textGeometry } from '../Type3D'
import { mergeParts } from '../decorGeometry'
import { timelineYears } from '@/content/chapters'
import { isFree } from '@/content/world-layout'
import type { MaterialName } from '../materials'

/* ============================================================
   TIME MACHINE — CLOCKWORK

   Three brass rings floating over a disc is a lovely object and a
   terrible landmark: from the road it is a smudge the same size and
   the same colour as the trophy. So the district is read from the
   GROUND UP. A twenty-metre dial is painted round the machine with
   twelve numerals lying flat on it, and from thirty metres the
   place says CLOCK before you can see a single ring.

   AND THE CLOCK IS NOT DECORATION. `Lighting` swings a real sun
   round a real azimuth — `Math.PI * 0.35 + phase * Math.PI * 2` —
   so a gnomon standing at the dial's centre casts a shadow that
   genuinely tells the island's time, and the painted hour hand is
   moved every tick to lie exactly where that shadow falls. That
   matters more than it sounds: shadows are switched off entirely at
   the low quality tier, and without the painted hand a phone would
   be looking at a sundial that does not work.

   THE PENDULUM HAS NO COLLIDER, ANYWHERE. A swinging fixed body is
   a trap that scoops a car up and holds it; a swinging KINEMATIC
   body is the same trap with better physics. The arm is a mesh and
   nothing else, and its bob hangs at 1.95 m at rest — over the roof
   of anything that can drive here — so it never wants one.

   THE COST. Five merge buckets (ink, metal, concrete, glass,
   emissiveAmber), the dial, the hour hand, three gears, the
   pendulum arm and the calendar face: twelve draw calls. The three
   gears are three meshes rather than three instances of one,
   because they carry 18, 14 and 10 teeth — one geometry scaled
   three ways gives three gears whose teeth cannot mesh, and the
   whole joke of a gear train is that it does.
   ============================================================ */

/** Three.js yaws the other way round from a compass bearing: a Y
 *  rotation of θ sends local +X to (cos θ, 0, −sin θ). Authoring in
 *  bearings and converting here once is what keeps the dial's twelve
 *  numerals from running anticlockwise. */
const yaw = (bearing: number): number => -bearing

/** Turns a run of solid letters face-up on the ground, reading from
 *  the given bearing. Used by the numerals and the year plinths. */
function layFlat(geometry: THREE.BufferGeometry, bearing: number): void {
  geometry.rotateX(-Math.PI / 2)
  geometry.rotateY(yaw(bearing) - Math.PI / 2)
}

export function dressTimeMachine(kit: Dressing): void {
  const place = kit.spot('timeMachine') ?? kit.district('timeMachine')
  const onward = kit.district('maze')
  const { materials, physics, quality, ticker, lighting } = kit.game
  const shadows = quality.settings.shadows

  /* The approach. The time machine sits on the spur to the labyrinth
     — that is where its own achievement hint puts it — so the year
     plinths line the way onward rather than a heading typed in here. */
  const axis = Math.atan2(onward.z - place.z, onward.x - place.x)
  const centreY = kit.groundAt(place.x, place.z)

  /* The island's meridian. `Lighting` puts the sun at azimuth
     PI*0.35 + phase*2PI and noon is phase 0.5, so the noon SHADOW —
     half a turn from the sun — falls along PI*0.35. The gnomon lies
     on it and twelve o'clock is painted under its tip, the way a real
     dial's style lies on the meridian. */
  const NOON_SHADOW = Math.PI * 0.35 + 0.5 * Math.PI * 2 + Math.PI

  const at = (bearing: number, distance: number) => ({
    x: place.x + Math.cos(bearing) * distance,
    z: place.z + Math.sin(bearing) * distance,
  })

  /** `kit.free` allows nothing, and a district PLATE and a play disc
   *  are both HARD zones — so it would reject the seven metres of
   *  paving and the eleven of levelled ground this machine stands on.
   *  Allow those and the landmark; keep the road margins, which is the
   *  only answer this needs. `SceneryDetails.usable` does the same. */
  const usable = (x: number, z: number, clearance: number): boolean =>
    isFree(x, z, {
      clearance,
      allow: ['plate', 'landmark', 'play'],
      margin: { circuit: 5, ramp: 6, water: 1.5 },
    })

  /** The first bearing near `preferred` whose ground is free. Every
   *  satellite here stands 8-11 m out, which is off the play spot's
   *  own disc and squarely in reach of the spur to the labyrinth; a
   *  fixture that cannot find a gap keeps its preferred bearing rather
   *  than vanishing, because a gear train in the verge is a smaller
   *  problem than a district with no gears. */
  const clearOf = (preferred: number, distance: number, clearance: number): number =>
    ([0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9] as const)
      .map((step) => preferred + step)
      .find((bearing) => {
        const p = at(bearing, distance)
        return usable(p.x, p.z, clearance)
      }) ?? preferred

  const piece = (
    material: MaterialName,
    p: { x: number; z: number }, y: number,
    w: number, h: number, d: number, bearing = axis, chamfer = 0.07,
  ): void => {
    const g = chamferedBox(w, h, d, chamfer)
    g.rotateY(yaw(bearing))
    g.translate(p.x, y, p.z)
    kit.add(material, g)
  }

  const blocker = (
    p: { x: number; z: number }, y: number,
    w: number, h: number, d: number, bearing = axis,
  ): void => {
    physics.add({
      type: 'fixed', category: 'floor',
      position: { x: p.x, y, z: p.z },
      rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw(bearing), 0)),
      friction: 0.7, restitution: 0.12,
      colliders: [{ shape: 'cuboid', parameters: [w / 2, h / 2, d / 2] }],
    })
  }

  /* ---- 1. THE DIAL -----------------------------------------
     One ring, not a hundred tiles: the play spot's `flat: 11` holds
     the terrain dead level out to 9.35 m (Terrain.ts smoothsteps from
     flat*0.85), and 9.2 is inside that, so a single flat disc cannot
     sink into a slope. The inner edge clears the machine's own 5 m
     base. */
  const dial = new THREE.RingGeometry(5.4, 9.2, 72, 1)
  dial.rotateX(-Math.PI / 2)
  dial.translate(place.x, centreY + 0.05, place.z)
  const dialMesh = new THREE.Mesh(dial, materials.flat(palette.paper, 0.62))
  dialMesh.renderOrder = 2
  kit.group.add(dialMesh)
  kit.bin.add(() => dial.dispose())

  for (let hour = 1; hour <= 12; hour++) {
    // Twelve o'clock on the noon-shadow line, so the numerals agree
    // with the gnomon instead of with an arbitrary north.
    const bearing = NOON_SHADOW + ((hour % 12) / 12) * Math.PI * 2
    const numeral = textGeometry(String(hour), { size: 0.85, weight: 0.19, depth: 0.09 })
    layFlat(numeral.geometry, bearing)
    const p = at(bearing, 7.5)
    numeral.geometry.translate(p.x, centreY + 0.07, p.z)
    kit.add('ink', numeral.geometry)

    // A pip on the rim. Unlit, so it still reads when the fog washes
    // the pale dial out at the far end of the plate.
    const pip = at(bearing, 8.9)
    piece('emissiveAmber', pip, centreY + 0.08, 0.5, 0.1, 0.24, bearing)
  }

  /* ---- 2. THE GNOMON ---------------------------------------
     A triangular blade on the machine's own base plate, whose top
     face is 0.25 m up (`Playground.buildTimeMachine` sinks a 0.5 m
     cylinder half into the ground). Six points through `convexHull`,
     which is what the blade is: 4 m at the style, running out to
     nothing 3.4 m along the meridian.

     Its collider is the lower box only — 3.4 x 2.0 — because the
     part above two metres is a knife edge nothing on this island can
     reach, and a collider that matches a wedge exactly is a collider
     that catches a wheel on the way past. */
  const styleY = centreY + 0.25
  const blade = convexHull([
    new THREE.Vector3(0, 0, -0.18), new THREE.Vector3(0, 0, 0.18),
    new THREE.Vector3(0, 4.0, -0.18), new THREE.Vector3(0, 4.0, 0.18),
    new THREE.Vector3(3.4, 0, -0.18), new THREE.Vector3(3.4, 0, 0.18),
  ])
  blade.rotateY(yaw(NOON_SHADOW))
  blade.translate(place.x, styleY, place.z)
  kit.add('ink', blade)
  blocker(at(NOON_SHADOW, 1.7), styleY + 1.0, 3.4, 2.0, 0.36, NOON_SHADOW)

  /* ---- 3. THE HOUR HAND ------------------------------------
     Where the blade's shadow lands, drawn. At the high tier the real
     shadow lies underneath it and the two agree; at the low tier
     there is no shadow map at all and this is the only thing on the
     island still telling the time. */
  const hand = new THREE.PlaneGeometry(8.6, 0.42)
  hand.rotateX(-Math.PI / 2)
  hand.translate(4.3, 0, 0)
  const handMesh = new THREE.Mesh(hand, materials.own(
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.ink),
      transparent: true, opacity: 0.34, depthWrite: false, toneMapped: false,
    }),
  ))
  handMesh.position.set(place.x, centreY + 0.07, place.z)
  handMesh.renderOrder = 3
  kit.group.add(handMesh)
  kit.bin.add(() => hand.dispose())

  /* ---- 4. THE GEAR TRAIN -----------------------------------
     Three wheels standing on their rims in a row along the dial's
     edge, axles pointing at the machine, teeth meshing. They alternate
     direction and their rates are in inverse proportion to their radii
     — which is the only way a gear train reads as a gear train rather
     than as three discs that happen to be turning. */
  const trainBearing = clearOf(axis + 2.2, 9.8, 4.2)
  const anchor = at(trainBearing, 9.8)
  const tangent = { x: -Math.sin(trainBearing), z: Math.cos(trainBearing) }
  const gears: { mesh: THREE.Mesh; rate: number }[] = []
  // Centred on the anchor: the train is 7.4 m long and hung off one
  // end it would put its last wheel 12.9 m out, past the district's
  // own 11 m edge and into whatever the ecology has planted there.
  let along = -3.7
  ;[
    { radius: 2.6, teeth: 18 },
    { radius: 1.8, teeth: 14 },
    { radius: 1.2, teeth: 10 },
  ].forEach((spec, index) => {
    if (index > 0) along += spec.radius
    const p = { x: anchor.x + tangent.x * along, z: anchor.z + tangent.z * along }
    along += spec.radius

    const parts: THREE.BufferGeometry[] = [wheelGeometry(spec.radius * 0.86, 0.42, 20)]
    for (let tooth = 0; tooth < spec.teeth; tooth++) {
      const angle = (tooth / spec.teeth) * Math.PI * 2
      const cog = chamferedBox(0.44, 0.5, 0.44, 0.06)
      cog.rotateZ(angle)
      cog.translate(Math.cos(angle) * spec.radius * 0.88, Math.sin(angle) * spec.radius * 0.88, 0)
      parts.push(cog)
    }
    const geometry = mergeParts(parts)
    const mesh = new THREE.Mesh(geometry, materials.get('brass'))
    mesh.castShadow = shadows
    mesh.position.set(p.x, kit.groundAt(p.x, p.z) + spec.radius, p.z)
    // Axle radial, so the wheels face along the row and their teeth
    // can meet. `rotation.z` then spins about that axle, because a
    // three.js XYZ Euler applies Z first.
    mesh.rotation.y = yaw(trainBearing) + Math.PI / 2
    kit.group.add(mesh)
    kit.bin.add(() => geometry.dispose())
    // Low and narrow: the car should feel the rim, not a wall the
    // height of the wheel it can see through.
    blocker(p, kit.groundAt(p.x, p.z) + 0.6, 0.36, 1.2, spec.radius * 1.7, trainBearing)
    gears.push({ mesh, rate: (index % 2 === 0 ? 0.5 : -0.5) * (2.6 / spec.radius) })
  })

  /* ---- 5. THE PENDULUM -------------------------------------
     Two posts and a lintel, and an arm hanging off it that is mesh
     only. Colliders live on the two post bases and stop 1.6 m up;
     nothing else here can be touched. */
  const pivotBearing = clearOf(axis - 2.2, 9.8, 2.6)
  const frame = at(pivotBearing, 9.8)
  const frameY = kit.groundAt(frame.x, frame.z)
  const across = { x: -Math.sin(pivotBearing), z: Math.cos(pivotBearing) }
  for (const side of [-1, 1]) {
    const post = { x: frame.x + across.x * side * 1.7, z: frame.z + across.z * side * 1.7 }
    piece('metal', post, frameY + 3.5, 0.26, 7.0, 0.26, pivotBearing)
    blocker(post, frameY + 0.8, 0.4, 1.6, 0.4, pivotBearing)
  }
  piece('metal', frame, frameY + 7.05, 0.3, 0.3, 3.9, pivotBearing)

  // Two nested groups: the outer one turns the swing plane to face
  // across the frame, the inner one swings inside it. One group doing
  // both would swing about the world X axis and throw the bob sideways
  // out of its own posts.
  const mount = new THREE.Group()
  mount.position.set(frame.x, frameY + 7.0, frame.z)
  mount.rotation.y = yaw(pivotBearing)
  const swing = new THREE.Group()
  mount.add(swing)
  kit.group.add(mount)

  const rod = chamferedBox(0.16, 4.2, 0.16, 0.04)
  rod.translate(0, -2.1, 0)
  const bob = new THREE.CylinderGeometry(0.85, 0.85, 0.3, 20)
  bob.rotateZ(Math.PI / 2)
  bob.translate(0, -4.2, 0)
  const armGeometry = mergeParts([rod, bob])
  const arm = new THREE.Mesh(armGeometry, materials.get('metal'))
  arm.castShadow = shadows
  swing.add(arm)
  kit.bin.add(() => armGeometry.dispose())

  /* ---- 6. THE HOURGLASS ------------------------------------ */
  const glassBearing = clearOf(axis + Math.PI, 8.8, 2.2)
  const glass = at(glassBearing, 8.8)
  const glassY = kit.groundAt(glass.x, glass.z)
  for (const corner of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const [dx, dz] = corner
    const leg = {
      x: glass.x + Math.cos(glassBearing) * dx * 1.05 - Math.sin(glassBearing) * dz * 1.05,
      z: glass.z + Math.sin(glassBearing) * dx * 1.05 + Math.cos(glassBearing) * dz * 1.05,
    }
    piece('metal', leg, glassY + 2.6, 0.16, 5.2, 0.16, glassBearing)
  }
  piece('metal', glass, glassY + 0.3, 2.5, 0.3, 2.5, glassBearing, 0.1)
  piece('metal', glass, glassY + 5.1, 2.5, 0.3, 2.5, glassBearing, 0.1)
  /*
    FOUR LEGS, NOT A PLINTH.

    A 2.5 m square blocker 0.9 m tall is the worst height there is: a
    2.5 kg car meets a chamfered face at that height, rides up it and
    goes over. `world-qa` reported the district as "rolled on open
    ground". The hourglass is a frame, so its collider is the frame —
    four uprights the car stops against, with the base plate left to be
    driven over.
  */
  for (const corner of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const [dx, dz] = corner
    blocker({
      x: glass.x + Math.cos(glassBearing) * dx * 1.05 - Math.sin(glassBearing) * dz * 1.05,
      z: glass.z + Math.sin(glassBearing) * dx * 1.05 + Math.cos(glassBearing) * dz * 1.05,
    }, glassY + 1.3, 0.34, 2.6, 0.34, glassBearing)
  }

  const lower = new THREE.ConeGeometry(1.3, 2.1, 14, 1, true)
  lower.translate(glass.x, glassY + 1.55, glass.z)
  kit.add('glass', lower)
  const upper = new THREE.ConeGeometry(1.3, 2.1, 14, 1, true)
  upper.rotateX(Math.PI)
  upper.translate(glass.x, glassY + 3.65, glass.z)
  kit.add('glass', upper)
  // The fall, and the heap it has already made. Emissive, because in
  // permanent noon a pale cone inside a translucent cone is invisible.
  const fall = new THREE.CylinderGeometry(0.07, 0.07, 1.4, 6)
  fall.translate(glass.x, glassY + 1.9, glass.z)
  kit.add('emissiveAmber', fall)
  const heap = new THREE.ConeGeometry(0.85, 0.7, 12)
  heap.translate(glass.x, glassY + 0.8, glass.z)
  kit.add('emissiveAmber', heap)

  /* ---- 7. THE YEAR PLINTHS ---------------------------------
     The CV's own years, from `timelineYears`, walking away down the
     spur. Each one is checked against the occupancy registry before
     it is placed, because the spur is a road and a plinth standing in
     it is what `world:clearance` exists to catch. */
  timelineYears.forEach((entry, index) => {
    const distance = 12.5 + index * 2.9
    // 6.5 m off the axis, and either side of it. The axis is the
    // BEARING to the labyrinth, not the road's centreline, so a plinth
    // three metres off it is a plinth in a carriageway on half the
    // seeds — and `isFree` would then reject all four and the timeline
    // would silently not exist.
    const p = [6.5, -6.5]
      .map((side) => ({
        x: place.x + Math.cos(axis) * distance - Math.sin(axis) * side,
        z: place.z + Math.sin(axis) * distance + Math.cos(axis) * side,
      }))
      .find((candidate) => usable(candidate.x, candidate.z, 1.8))
    if (!p) return
    const base = kit.groundAt(p.x, p.z)
    piece('concrete', p, base + 0.48, 1.3, 0.96, 1.3, axis, 0.1)
    /* A metre-tall plinth is in the band that launches a light car
       rather than stopping it, so the collider is the core of it: two
       thirds the width, and the chamfered shoulder is driven over. */
    blocker(p, base + 0.48, 0.86, 0.96, 0.86, axis)
    const year = textGeometry(entry.year, { size: 0.32, weight: 0.18, depth: 0.07 })
    layFlat(year.geometry, axis + Math.PI)
    year.geometry.translate(p.x, base + 0.96, p.z)
    kit.add('ink', year.geometry)
  })

  /* ---- 8. THE FLIP CALENDAR --------------------------------
     A 256 x 192 canvas checked twice a second and repainted only when
     the string has actually changed. `Lighting` sweeps 0.38 to 0.62
     of a day in 600 s, so the clock runs at about 35 island-minutes a
     real minute and the readout is 09:07 at one end of the sweep and
     14:52 at the other — a change worth an upload, but not every
     check, and an unconditional repaint is a texture upload twice a
     second for the life of the session. */
  const boardBearing = clearOf(axis + 1.15, 9.6, 1.6)
  const board = at(boardBearing, 9.6)
  const boardY = kit.groundAt(board.x, board.z)
  piece('metal', board, boardY + 1.3, 0.26, 2.6, 0.26, boardBearing)
  blocker(board, boardY + 0.7, 0.36, 1.4, 0.36, boardBearing)
  piece('ink', board, boardY + 3.4, 0.22, 1.9, 2.6, boardBearing, 0.08)

  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 192
  const context = canvas.getContext('2d')
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const faceGeometry = new THREE.PlaneGeometry(2.3, 1.6)
  faceGeometry.rotateY(yaw(boardBearing) - Math.PI / 2)
  faceGeometry.translate(
    board.x - Math.cos(boardBearing) * 0.13,
    boardY + 3.4,
    board.z - Math.sin(boardBearing) * 0.13,
  )
  const faceMesh = new THREE.Mesh(faceGeometry, materials.own(
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
  ))
  kit.group.add(faceMesh)
  kit.bin.add(() => {
    faceGeometry.dispose()
    texture.dispose()
  })

  let printed = ''
  const redraw = (): void => {
    if (!context) return
    const minutes = Math.round(lighting.phase * 24 * 60)
    const text = `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
    if (text === printed) return
    printed = text
    context.fillStyle = palette.paper
    context.fillRect(0, 0, 256, 192)
    context.fillStyle = palette.accent
    context.fillRect(0, 0, 256, 34)
    context.fillStyle = palette.paper
    context.font = '600 20px system-ui, sans-serif'
    context.textAlign = 'center'
    context.fillText('ISLAND TIME', 128, 24)
    context.fillStyle = palette.ink
    context.font = '700 74px system-ui, sans-serif'
    context.fillText(text, 128, 128)
    // The seam a flip calendar folds on. Two pixels of ink and the
    // board stops being a poster.
    context.fillStyle = palette.ink4
    context.fillRect(0, 112, 256, 2)
    texture.needsUpdate = true
  }
  redraw()
  kit.bin.interval(redraw, 500)

  /* ---- 9. THE ONE TICKER -----------------------------------
     Everything that moves here moves from `ticker.elapsed` and
     `lighting.phase`, so a single callback drives the lot: no
     per-object update, no accumulated state to drift, and a scrubbed
     clock (the machine's own five-second sweep) drags the hand with
     it for free. Order 14 is where the world's other idle animations
     run — `Labyrinth` and `CircuitRace` both sit there. */
  const animate = (): void => {
    const azimuth = Math.PI * 0.35 + lighting.phase * Math.PI * 2
    // Shadow points away from the sun, and a Y rotation of θ sends
    // +X to (cos θ, −sin θ) in the XZ plane: θ = PI − azimuth.
    handMesh.rotation.y = Math.PI - azimuth
    for (const gear of gears) gear.mesh.rotation.z = ticker.elapsed * gear.rate
    // 0.4 Hz, +/-0.5 rad. Off `elapsed` rather than integrated, so it
    // cannot drift and it survives a paused tab.
    swing.rotation.x = Math.sin(ticker.elapsed * Math.PI * 0.8) * 0.5
  }
  animate()
  ticker.events.on('tick', animate, 14)
  kit.bin.add(() => ticker.events.off('tick', animate))
}
