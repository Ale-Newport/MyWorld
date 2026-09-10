import * as THREE from 'three'
import { palette } from '../core/palette'
import type { Bin } from '../core/Disposal'
import type { Physics } from '../physics/Physics'
import type { Quality } from '../core/Quality'
import type { Materials } from './materials'
import { textTexture } from './materials'
import { chamferedBox, extrudeOutline, hullPoints } from './geometry'
import { standingText } from './Type3D'
import type { Landmark, LandmarkVisual } from '@/content/world'

/* ============================================================
   LANDMARKS

   One builder per `LandmarkVisual`. Each returns a group, adds
   its own static colliders and registers everything it allocated
   with the bin.

   These are the buildings of the world, so they follow one rule:
   a landmark must be legible from the driving camera — which
   looks down at about 50° from twenty metres — WITHOUT reading
   its label. A database is a stack of discs, a maze is a maze, a
   phone is a phone. The text on it confirms what the shape has
   already said.

   Colliders are boxes and hulls, never trimeshes: a trimesh
   collider on a decorative building is both slower and worse at
   stopping a car at 40 m/s than the three boxes that describe its
   actual footprint.
   ============================================================ */

export interface BuiltLandmark {
  group: THREE.Group
  /** Where the interact prompt should be anchored, in local space. */
  anchor: THREE.Vector3
  /** Radius the interact zone should use if the landmark has none. */
  radius: number
}

/**
 * What the three shared builders below need, and nothing more.
 *
 * `solidBox`, `textPlane` and `markerRing` are the vocabulary the whole
 * world is written in — a chamfered box with a collider that honours
 * the parent's yaw, a line of text on a plane, a ring on the ground —
 * and until now they were private to this file. The per-district set
 * dressing needs all three, and the alternatives were to re-implement
 * them (three more copies of the collider-in-world-space maths, which
 * is the exact class of bug the header of this file warns about) or to
 * grow Landmarks.ts into the dressing layer.
 *
 * So they are exported, and they take THIS rather than a full
 * `LandmarkContext`: a caller that is not building a landmark has no
 * landmark to hand them.
 */
export interface BuildContext {
  materials: Materials
  physics: Physics
  quality: Quality
  bin: Bin
  /** Where the group this builds into stands. */
  at: THREE.Vector3
  /** Its Y rotation. Colliders must honour it or they will not
      line up with the mesh the visitor can see. */
  rotation: number
}

export interface LandmarkContext extends BuildContext {
  /** Elevation of the terrain under the landmark. */
  groundY: number
}

/* ---- placing colliders in world space -------------------- */

const _local = new THREE.Vector3()
const _yAxis = new THREE.Vector3(0, 1, 0)

/** Local landmark space → world space, honouring the Y rotation. */
function toWorld(ctx: BuildContext, x: number, y: number, z: number) {
  _local.set(x, y, z).applyAxisAngle(_yAxis, ctx.rotation).add(ctx.at)
  return { x: _local.x, y: _local.y, z: _local.z }
}

/** Local Y rotation → world quaternion. */
function toWorldRotation(ctx: BuildContext, extra = 0): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ctx.rotation + extra, 0))
}

/* ---- shared helpers -------------------------------------- */

/** A solid, static box that both draws and collides. */
export function solidBox(
  ctx: BuildContext,
  parent: THREE.Object3D,
  width: number,
  height: number,
  depth: number,
  position: [number, number, number],
  material: THREE.Material,
  options: { rotation?: number; chamfer?: number; collide?: boolean } = {},
): THREE.Mesh {
  const geometry = chamferedBox(width, height, depth, options.chamfer ?? 0.06)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(...position)
  if (options.rotation) mesh.rotation.y = options.rotation
  mesh.castShadow = ctx.quality.settings.shadows
  mesh.receiveShadow = ctx.quality.settings.shadows
  parent.add(mesh)
  ctx.bin.add(() => geometry.dispose())

  if (options.collide !== false) {
    ctx.physics.add({
      type: 'fixed',
      category: 'floor',
      position: toWorld(ctx, position[0], position[1], position[2]),
      rotation: toWorldRotation(ctx, options.rotation ?? 0),
      friction: 0.7,
      restitution: 0.12,
      colliders: [{ shape: 'cuboid', parameters: [width / 2, height / 2, depth / 2] }],
    })
  }
  return mesh
}

/** A double-sided text plane. Used for every label in the world. */
export function textPlane(
  ctx: BuildContext,
  parent: THREE.Object3D,
  text: string,
  height: number,
  position: [number, number, number],
  options: {
    color?: string
    sublines?: string[]
    rotation?: number
    letterSpacing?: number
    weight?: number
    align?: CanvasTextAlign
  } = {},
): THREE.Mesh {
  const { texture, aspect } = textTexture({
    text,
    sublines: options.sublines,
    color: options.color ?? palette.ink,
    letterSpacing: options.letterSpacing ?? 0.12,
    weight: options.weight ?? 600,
    size: 96,
    align: options.align ?? 'center',
  })
  const geometry = new THREE.PlaneGeometry(height * aspect, height)
  const material = ctx.materials.own(
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    }),
  )
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(...position)
  if (options.rotation) mesh.rotation.y = options.rotation
  parent.add(mesh)
  ctx.bin.add(() => {
    geometry.dispose()
    texture.dispose()
  })
  return mesh
}

/** The vermilion ring every interactive landmark stands inside. */
export function markerRing(ctx: BuildContext, parent: THREE.Object3D, radius: number): void {
  const geometry = new THREE.RingGeometry(radius, radius + 0.22, 64)
  geometry.rotateX(-Math.PI / 2)
  const material = ctx.materials.own(
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.accent),
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    }),
  )
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.y = 0.06
  mesh.renderOrder = 2
  parent.add(mesh)
  ctx.bin.add(() => geometry.dispose())
}

/* ============================================================
   BUILDERS
   ============================================================ */

type Builder = (ctx: LandmarkContext, landmark: Landmark) => BuiltLandmark

/** A roadside signpost: a post, an arrow blade, a label. */
const buildSign: Builder = (ctx, landmark) => {
  const group = new THREE.Group()
  const metal = ctx.materials.get('metal')
  const ink = ctx.materials.get('ink')

  /*
    NO COLLIDER ON THE POST.

    `solidBox` collides by default, so each of the nine signposts on the
    island stood a 0.16 m box in the ground that stopped a 2.5 kg car
    dead — an invisible wall the width of a wrist, four of them on the
    landing forecourt alone. The blade above it already passes
    `collide: false`, and `buildBillboard` argues the same case for its
    own legs. A signpost is something you knock, not something you hit.
  */
  solidBox(ctx, group, 0.16, 3.4, 0.16, [0, 1.7, 0], metal, { chamfer: 0.03, collide: false })

  const blade = solidBox(ctx, group, 3.6, 0.86, 0.14, [1.5, 3.1, 0], ink, {
    chamfer: 0.05, collide: false,
  })
  blade.castShadow = ctx.quality.settings.shadows

  textPlane(ctx, group, landmark.label, 0.34, [1.5, 3.18, 0.09], {
    color: palette.paper,
    letterSpacing: 0.16,
  })
  if (landmark.sublabel) {
    textPlane(ctx, group, landmark.sublabel, 0.19, [1.5, 2.86, 0.09], {
      color: palette.chalk3,
      letterSpacing: 0.14,
      weight: 500,
    })
  }

  // An arrow on the far end so the blade points somewhere.
  const arrowGeometry = new THREE.ConeGeometry(0.32, 0.6, 3)
  arrowGeometry.rotateZ(-Math.PI / 2)
  const arrow = new THREE.Mesh(arrowGeometry, ctx.materials.get('accent'))
  arrow.position.set(3.5, 3.1, 0)
  group.add(arrow)
  ctx.bin.add(() => arrowGeometry.dispose())

  return { group, anchor: new THREE.Vector3(0, 4, 0), radius: 8 }
}

/**
 * A LECTERN, not a billboard.
 *
 * The panelled landmarks — the welcome, the profile card, the place
 * signs — used to be 10 m wide, 5.6 m tall, solid, and standing in the
 * landscape on two solid posts. Approach one obliquely, or land on one off a ramp, and it
 * was a wall. The brief is explicit that portfolio information must
 * not be a road obstacle, and the reference does not build them at
 * all: what a visitor needs to know when they are near something is a
 * small popup, which is now what they get (see `InteractivePoints`).
 *
 * What is left is furniture. A waist-high plinth with an angled
 * plate, the name cut into it, and NO COLLIDER — you drive over it.
 * It marks the spot without owning the view or the road.
 */
const buildBillboard: Builder = (ctx, landmark) => {
  const group = new THREE.Group()
  const scale = landmark.scale ?? 1
  const width = 3.2 * scale
  const height = 1.5 * scale

  // A low kerb, so the lectern has somewhere to stand. Flat enough to
  // drive over at any speed without the suspension noticing.
  solidBox(ctx, group, width + 1.4, 0.16, 2.4, [0, 0.08, 0], ctx.materials.get('concrete'),
    { chamfer: 0.05, collide: false })

  const plate = new THREE.Group()
  plate.position.set(0, 0.16 + height * 0.5, 0)
  plate.rotation.x = -0.42
  group.add(plate)
  solidBox(ctx, plate, width, height, 0.16, [0, 0, 0], ctx.materials.get('paper'),
    { chamfer: 0.05, collide: false })

  textPlane(ctx, plate, landmark.label, 0.3 * scale, [0, height * 0.2, 0.1], {
    letterSpacing: 0.1,
  })
  if (landmark.sublabel) {
    textPlane(ctx, plate, landmark.sublabel, 0.17 * scale, [0, -height * 0.06, 0.1], {
      color: palette.ink3,
      letterSpacing: 0.16,
      weight: 500,
    })
  }
  const rule = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 0.7, 0.045),
    ctx.materials.get('emissiveAccent'),
  )
  rule.position.set(0, -height * 0.22, 0.1)
  plate.add(rule)
  ctx.bin.add(() => rule.geometry.dispose())

  // A slim post either side, purely so it reads as a made thing.
  // Non-colliding: the posts were most of what the car actually hit.
  for (const x of [-width * 0.5 - 0.35, width * 0.5 + 0.35]) {
    solidBox(ctx, group, 0.14, 1.5 * scale, 0.14, [x, 0.75 * scale, 0],
      ctx.materials.get('metal'), { collide: false })
  }

  markerRing(ctx, group, (landmark.radius ?? 12) - 1)
  return { group, anchor: new THREE.Vector3(0, 2.4, 0), radius: landmark.radius ?? 10 }
}

/** The hub's name, in physical letters you can drive between. */
const buildMonumentName: Builder = () => {
  // Individual dynamic glyphs are owned by Playground after the vehicle exists.
  return { group: new THREE.Group(), anchor: new THREE.Vector3(0, 7.2, 0), radius: 20 }
}

/** A generic project marker: a plinth, a form, a label, a ring. */
const buildMonument: Builder = (ctx, landmark) => {
  const group = new THREE.Group()
  const scale = landmark.scale ?? 1
  const height = 4.4 * scale

  solidBox(ctx, group, 3.4 * scale, 0.5, 3.4 * scale, [0, 0.25, 0], ctx.materials.get('concrete'), { chamfer: 0.1,
  })

  // A leaning slab reads as an object rather than a pillar, and the
  // lean makes a field of them look composed rather than planted.
  const slab = chamferedBox(2.1 * scale, height, 0.62 * scale, 0.09)
  const mesh = new THREE.Mesh(slab, ctx.materials.get('ink'))
  mesh.position.set(0, 0.5 + height / 2, 0)
  mesh.rotation.z = 0.045
  mesh.castShadow = ctx.quality.settings.shadows
  group.add(mesh)
  ctx.bin.add(() => slab.dispose())

  ctx.physics.add({
    type: 'fixed',
    category: 'floor',
    position: toWorld(ctx, 0, 0.5 + height / 2, 0),
    rotation: toWorldRotation(ctx),
    friction: 0.6,
    restitution: 0.15,
    colliders: [{ shape: 'cuboid', parameters: [1.05 * scale, height / 2, 0.31 * scale] }],
  })

  textPlane(ctx, group, landmark.label, 0.42 * scale, [0, 0.5 + height * 0.66, 0.33 * scale], {
    color: palette.paper,
    letterSpacing: 0.1,
  })
  if (landmark.sublabel) {
    textPlane(ctx, group, landmark.sublabel, 0.22 * scale, [0, 0.5 + height * 0.46, 0.33 * scale], {
      color: palette.chalk3,
      letterSpacing: 0.14,
      weight: 500,
    })
  }

  const light = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5 * scale, 0.05),
    ctx.materials.get('emissiveAccent'),
  )
  light.position.set(0, 0.5 + height * 0.24, 0.33 * scale)
  group.add(light)
  ctx.bin.add(() => light.geometry.dispose())

  markerRing(ctx, group, 3.4 * scale)
  return { group, anchor: new THREE.Vector3(0, height + 1.4, 0), radius: 9 * scale }
}

/** A giant ID card, leaning on its edge. The About landmark. */
const buildIdCard: Builder = (ctx, landmark) => {
  const group = new THREE.Group()
  // Two thirds of what it was. At 9 x 5.6 this stood 4.7 m off the
  // ring road as an unbroken wall from the ground up, and it is the
  // ABOUT panel — information, which the brief says must not be a
  // road obstacle. The card is now pass-through; only the plinth it
  // leans on collides, so a car can drive under the lean.
  const width = 6
  const height = 3.8

  const card = new THREE.Group()
  card.rotation.x = -0.16
  card.position.y = height / 2 + 0.5
  group.add(card)

  solidBox(ctx, card, width, height, 0.34, [0, 0, 0], ctx.materials.get('paper'), {
    chamfer: 0.14, collide: false,
  })
  // The plinth only. A low kerb the car bumps over, not a slab it
  // stops against.
  solidBox(ctx, group, width * 0.9, 0.5, 1.6, [0, 0.25, 0],
    ctx.materials.get('concrete'), { chamfer: 0.06 })

  // Portrait block, deliberately abstract.
  solidBox(ctx, card, 2.2, 2.8, 0.06, [-2.9, 0.5, 0.19], ctx.materials.get('graphite'), {
    chamfer: 0.04, collide: false,
  })
  textPlane(ctx, card, 'AN', 1.4, [-2.9, 0.5, 0.24], { color: palette.paper, letterSpacing: 0.02 })

  textPlane(ctx, card, 'ALEJANDRO', 0.66, [1.6, 1.72, 0.19], { letterSpacing: 0.08, align: 'center' })
  textPlane(ctx, card, 'NEWPORT', 0.66, [1.6, 0.96, 0.19], { letterSpacing: 0.08 })
  textPlane(ctx, card, 'SOFTWARE · AI · ML · PRODUCT', 0.24, [1.6, 0.2, 0.19], {
    color: palette.ink3, letterSpacing: 0.14, weight: 500,
  })
  textPlane(ctx, card, 'SPAIN → LONDON', 0.24, [1.6, -0.24, 0.19], {
    color: palette.ink3, letterSpacing: 0.14, weight: 500,
  })

  const stripe = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 0.92, 0.34),
    ctx.materials.get('emissiveAccent'),
  )
  stripe.position.set(0, -2.2, 0.19)
  card.add(stripe)
  ctx.bin.add(() => stripe.geometry.dispose())

  // Lanyard posts, so the card looks hung rather than balanced.
  for (const x of [-1.4, 1.4]) {
    solidBox(ctx, group, 0.12, 6.4, 0.12, [x, 3.2, -0.5], ctx.materials.get('metal'), { chamfer: 0.02,
    })
  }

  markerRing(ctx, group, 6)
  void landmark
  return { group, anchor: new THREE.Vector3(0, height + 2.4, 0), radius: 12 }
}

/** A gate you drive through. Start lines, checkpoints, circuits. */
const buildGate: Builder = (ctx, landmark) => {
  const group = new THREE.Group()
  const span = 16
  const height = 8

  for (const x of [-span / 2, span / 2]) {
    solidBox(ctx, group, 1.1, height, 1.1, [x, height / 2, 0], ctx.materials.get('ink'),
      { chamfer: 0.06 })
  }
  solidBox(ctx, group, span + 1.1, 1.5, 1.1, [0, height + 0.75, 0], ctx.materials.get('ink'),
    { chamfer: 0.06 })

  textPlane(ctx, group, landmark.label, 0.72, [0, height + 0.8, 0.6], {
    color: palette.paper, letterSpacing: 0.14,
  })
  if (landmark.sublabel) {
    textPlane(ctx, group, landmark.sublabel, 0.3, [0, height - 0.6, 0.6], {
      color: palette.accent, letterSpacing: 0.18, weight: 500,
    })
  }

  markerRing(ctx, group, 9)
  return { group, anchor: new THREE.Vector3(0, height + 2.6, 0), radius: 12 }
}

/** A terminal: a screen on a stand, for reading and for secrets. */
const buildTerminal: Builder = (ctx, landmark) => {
  const group = new THREE.Group()
  solidBox(ctx, group, 2.4, 0.5, 2.0, [0, 0.25, 0], ctx.materials.get('graphite'),
    { chamfer: 0.06 })
  solidBox(ctx, group, 0.36, 2.4, 0.36, [0, 1.4, 0], ctx.materials.get('metal'),
    { chamfer: 0.04 })

  const screen = new THREE.Group()
  screen.position.set(0, 3.3, 0)
  screen.rotation.x = -0.22
  group.add(screen)
  solidBox(ctx, screen, 4.2, 2.6, 0.24, [0, 0, 0], ctx.materials.get('ink'), {
    chamfer: 0.06, collide: false,
  })
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.8, 2.2),
    ctx.materials.get('emissiveSignal'),
  )
  glow.position.z = 0.14
  screen.add(glow)
  ctx.bin.add(() => glow.geometry.dispose())

  textPlane(ctx, screen, landmark.label, 0.34, [0, 0.4, 0.16], {
    color: palette.voidDark, letterSpacing: 0.12,
  })
  if (landmark.sublabel) {
    textPlane(ctx, screen, landmark.sublabel, 0.18, [0, -0.2, 0.16], {
      color: palette.voidDark2, letterSpacing: 0.12, weight: 500,
    })
  }

  markerRing(ctx, group, 4)
  return { group, anchor: new THREE.Vector3(0, 5.2, 0), radius: 7 }
}

/* ------------------------------------------------------------
   SOCIAL — the camera

   The drawing puts a round head with a ring of lenses on a
   tripod at SOCIAL, so that is what this is: a body, a barrel,
   a ring of six apertures around the front, and three legs.
   Read from the driving camera it is unmistakably a camera, and
   nothing about it needs the label to explain it.
   ------------------------------------------------------------ */
const buildCamera: Builder = (ctx, landmark) => {
  const group = new THREE.Group()
  const graphite = ctx.materials.get('graphite')
  const metal = ctx.materials.get('metal')

  // Tripod: three legs on a 4.4 m spread, meeting under the head.
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 6
    const geometry = new THREE.CylinderGeometry(0.16, 0.22, 6.6, 8)
    const leg = new THREE.Mesh(geometry, metal)
    leg.position.set(Math.cos(angle) * 1.1, 3.2, Math.sin(angle) * 1.1)
    // The FEET splay, not the tops. With the signs the other way round
    // the legs met at a point on the ground and fanned out under the
    // body — an upside-down tripod, and it looked exactly like one.
    leg.rotation.z = Math.cos(angle) * 0.2
    leg.rotation.x = -Math.sin(angle) * 0.2
    leg.castShadow = ctx.quality.settings.shadows
    group.add(leg)
    ctx.bin.add(() => geometry.dispose())
    // One collider per leg: a car can knock about between them, which
    // is the difference between a sculpture and a bollard.
    ctx.physics.add({
      type: 'fixed', category: 'object',
      position: toWorld(ctx, Math.cos(angle) * 1.5, 3.1, Math.sin(angle) * 1.5),
      colliders: [{ shape: 'cylinder', parameters: [3.2, 0.3] }],
    })
  }

  // Body and lens barrel.
  solidBox(ctx, group, 3.4, 2.4, 2.6, [0, 7.4, 0], graphite, { chamfer: 0.14, collide: false })
  const barrelGeometry = new THREE.CylinderGeometry(1.05, 1.25, 1.5, 24)
  const barrel = new THREE.Mesh(barrelGeometry, graphite)
  barrel.rotation.x = Math.PI / 2
  barrel.position.set(0, 7.4, 1.9)
  barrel.castShadow = ctx.quality.settings.shadows
  group.add(barrel)
  ctx.bin.add(() => barrelGeometry.dispose())

  // The glass, and the ring of apertures the drawing draws around it.
  const glassGeometry = new THREE.CircleGeometry(0.92, 28)
  const glass = new THREE.Mesh(glassGeometry, ctx.materials.get('glass'))
  glass.position.set(0, 7.4, 2.67)
  group.add(glass)
  ctx.bin.add(() => glassGeometry.dispose())

  const apertureGeometry = new THREE.RingGeometry(0.24, 0.38, 6)
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2
    const ring = new THREE.Mesh(apertureGeometry, ctx.materials.get('emissiveAccent'))
    ring.position.set(Math.cos(angle) * 1.5, 7.4 + Math.sin(angle) * 1.5, 1.36)
    group.add(ring)
  }
  ctx.bin.add(() => apertureGeometry.dispose())

  // The body is one collider, not four: the head is 3.4 m across and
  // the car should bounce off it as one object.
  ctx.physics.add({
    type: 'fixed', category: 'object',
    position: toWorld(ctx, 0, 7.4, 0.4),
    rotation: toWorldRotation(ctx),
    colliders: [{ shape: 'cuboid', parameters: [1.7, 1.2, 1.9] }],
  })

  textPlane(ctx, group, landmark.label, 0.62, [0, 10.6, 0], { letterSpacing: 0.16 })
  if (landmark.sublabel) {
    textPlane(ctx, group, landmark.sublabel, 0.26, [0, 9.9, 0], {
      color: palette.ink3, letterSpacing: 0.12, weight: 500,
    })
  }
  markerRing(ctx, group, 7)
  return { group, anchor: new THREE.Vector3(0, 11.4, 0), radius: 12 }
}

/* ------------------------------------------------------------
   ACHIEVEMENTS — a star on a plinth

   The drawing marks this with a star inside a brown ellipse.
   The star is the landmark; the ring on the ground is the
   ellipse. It is deliberately small: the brief asks for a
   compact experience, not a district.
   ------------------------------------------------------------ */
const buildTrophy: Builder = (ctx, landmark) => {
  const group = new THREE.Group()
  solidBox(ctx, group, 4.6, 1.1, 4.6, [0, 0.55, 0], ctx.materials.get('concrete'), { chamfer: 0.16 })
  solidBox(ctx, group, 1.6, 3.2, 1.6, [0, 2.7, 0], ctx.materials.get('concreteDark'), { chamfer: 0.1 })

  // A five-pointed star, extruded. Ten points around two radii is the
  // whole shape, and `extrudeOutline` gives it a real thickness so it
  // catches the sun instead of reading as a decal.
  const outline: [number, number][] = []
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2 - Math.PI / 2
    const radius = i % 2 === 0 ? 2.6 : 1.12
    outline.push([Math.cos(angle) * radius, Math.sin(angle) * radius])
  }
  const starGeometry = extrudeOutline(outline, 0.5, 0.06)
  const star = new THREE.Mesh(starGeometry, ctx.materials.get('emissiveAmber'))
  // extrudeOutline builds in XY with depth along +Z; stand it up and
  // turn its face to the approach.
  star.rotation.x = Math.PI / 2
  star.rotation.y = Math.PI / 2
  star.position.set(0, 6.6, 0)
  star.castShadow = ctx.quality.settings.shadows
  group.add(star)
  ctx.bin.add(() => starGeometry.dispose())

  ctx.physics.add({
    type: 'fixed', category: 'object',
    position: toWorld(ctx, 0, 6.6, 0),
    rotation: toWorldRotation(ctx),
    colliders: [{ shape: 'cuboid', parameters: [2.6, 2.6, 0.3] }],
  })

  textPlane(ctx, group, landmark.label, 0.56, [0, 9.6, 0], { letterSpacing: 0.16 })
  if (landmark.sublabel) {
    textPlane(ctx, group, landmark.sublabel, 0.24, [0, 8.9, 0], {
      color: palette.ink3, letterSpacing: 0.12, weight: 500,
    })
  }
  markerRing(ctx, group, 6.5)
  return { group, anchor: new THREE.Vector3(0, 10.4, 0), radius: 11 }
}

/* ------------------------------------------------------------
   THE BLACK HOLE — the marker, not the pull

   `Playground` builds the core, the disc and the force. This is
   the plinth-less anchor the interaction system hangs the prompt
   on, plus the horizon ring on the ground so the thing has an
   edge you can see you are inside of.
   ------------------------------------------------------------ */
const buildSingularity: Builder = (ctx, landmark) => {
  const group = new THREE.Group()
  const geometry = new THREE.RingGeometry(6.6, 7.2, 64)
  geometry.rotateX(-Math.PI / 2)
  const material = ctx.materials.own(
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.voidDark),
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    }),
  )
  const ring = new THREE.Mesh(geometry, material)
  ring.position.y = 0.09
  group.add(ring)
  ctx.bin.add(() => geometry.dispose())

  if (landmark.sublabel) {
    textPlane(ctx, group, landmark.sublabel, 0.26, [0, 2.4, 0], {
      color: palette.chalk, letterSpacing: 0.14, weight: 500,
    })
  }
  markerRing(ctx, group, 9)
  return { group, anchor: new THREE.Vector3(0, 6.4, 0), radius: 12 }
}

/** A small island, floating a little proud of the ground. */
const buildIsland: Builder = (ctx, landmark) => {
  const group = new THREE.Group()
  const radius = 9 * (landmark.scale ?? 1)

  const geometry = new THREE.CylinderGeometry(radius, radius * 0.72, 3.2, 16, 1)
  const mesh = new THREE.Mesh(geometry, ctx.materials.get('paperDark'))
  mesh.position.y = -1.2
  mesh.receiveShadow = ctx.quality.settings.shadows
  group.add(mesh)
  ctx.bin.add(() => geometry.dispose())

  ctx.physics.add({
    type: 'fixed', category: 'floor',
    position: toWorld(ctx, 0, -1.2, 0),
    friction: 1,
    colliders: [{ shape: 'cylinder', parameters: [1.6, radius] }],
  })

  textPlane(ctx, group, landmark.label, 0.5, [0, 3.4, 0], { letterSpacing: 0.14 })
  markerRing(ctx, group, radius - 0.6)
  return { group, anchor: new THREE.Vector3(0, 4.4, 0), radius: radius + 2 }
}

/** Two brackets to jump between. `{ }` — SHIP IT. */
const buildBracket: Builder = (ctx, _landmark) => {
  const group = new THREE.Group()
  const material = ctx.materials.tinted(palette.ink, 0.6, 0.1)

  ;[['{', -5.5], ['}', 5.5]].forEach(([glyph, z]) => {
    const { geometry, colliders } = standingText(String(glyph), {
      size: 9,
      weight: 0.13,
      depth: 1.8,
      align: 'center',
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(0, 0, Number(z))
    mesh.rotation.y = Math.PI / 2
    mesh.castShadow = ctx.quality.settings.shadows
    group.add(mesh)
    ctx.bin.add(() => geometry.dispose())

    for (const box of colliders) {
      ctx.physics.add({
        type: 'fixed', category: 'floor',
        position: toWorld(ctx, box.x, box.y, Number(z)),
        rotation: toWorldRotation(ctx, Math.PI / 2),
        colliders: [
          { shape: 'cuboid', parameters: [box.halfWidth, box.halfHeight, box.halfDepth] },
        ],
      })
    }
  })

  return { group, anchor: new THREE.Vector3(0, 11, 0), radius: 12 }
}

/* ============================================================
   REGISTRY
   ============================================================ */

const BUILDERS: Record<LandmarkVisual, Builder> = {
  sign: buildSign,
  billboard: buildBillboard,
  monument: buildMonument,
  idCard: buildIdCard,
  gate: buildGate,
  terminal: buildTerminal,
  island: buildIsland,
  camera: buildCamera,
  trophy: buildTrophy,
  singularity: buildSingularity,
  bracket: buildBracket,
}

/** Builds one landmark at a world position. */
export function buildLandmark(
  base: Omit<LandmarkContext, 'at' | 'rotation'>,
  landmark: Landmark,
  at: THREE.Vector3,
): BuiltLandmark {
  // Transform first: the builders place their colliders through
  // `toWorld`, so the context has to know where the landmark stands
  // before a single one is created. Building first and rotating the
  // group afterwards is how you get a sign whose post is three
  // metres from its collider.
  const ctx: LandmarkContext = { ...base, at, rotation: landmark.rotation ?? 0 }
  if (landmark.id === 'circuit-start') {
    // CircuitRace owns the gantry and collision-free starting lane.
    const group = new THREE.Group(); group.position.copy(at)
    return { group, anchor: new THREE.Vector3(0, 4, 0), radius: 16 }
  }

  // The hub's name is the one landmark with a bespoke builder,
  // because it is the only one made of letters.
  const builder = landmark.id === 'landing-name' ? buildMonumentName : BUILDERS[landmark.visual]
  const built = builder(ctx, landmark)
  built.group.position.copy(at)
  built.group.rotation.y = ctx.rotation
  return built
}

export { hullPoints }
