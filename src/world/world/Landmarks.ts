import * as THREE from 'three'
import { palette } from '../core/palette'
import { seeded } from '../core/maths'
import type { Bin } from '../core/Disposal'
import type { Physics } from '../physics/Physics'
import type { Quality } from '../core/Quality'
import type { Materials } from './materials'
import { textTexture } from './materials'
import { chamferedBox, hullPoints } from './geometry'
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

export interface LandmarkContext {
  materials: Materials
  physics: Physics
  quality: Quality
  bin: Bin
  /** Elevation of the terrain under the landmark. */
  groundY: number
  /** Where this landmark stands. Set by `buildLandmark`. */
  at: THREE.Vector3
  /** Its Y rotation. Colliders must honour it or they will not
      line up with the mesh the visitor can see. */
  rotation: number
}

/* ---- placing colliders in world space -------------------- */

const _local = new THREE.Vector3()
const _yAxis = new THREE.Vector3(0, 1, 0)

/** Local landmark space → world space, honouring the Y rotation. */
function toWorld(ctx: LandmarkContext, x: number, y: number, z: number) {
  _local.set(x, y, z).applyAxisAngle(_yAxis, ctx.rotation).add(ctx.at)
  return { x: _local.x, y: _local.y, z: _local.z }
}

/** Local Y rotation → world quaternion. */
function toWorldRotation(ctx: LandmarkContext, extra = 0): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ctx.rotation + extra, 0))
}

/*
  Reseeded per landmark by `buildLandmark`, not shared across the
  build. A module-level stream keeps its position between mounts, so
  the second time the world was built in a tab every landmark's
  random details came out different — and it also made a landmark's
  appearance depend on how many landmarks happened to be built before
  it. Seeding from the landmark's own id makes each one identical
  every time, and independent of the order they are built in.
*/
let rand = seeded(31337)

/** FNV-1a. A stable 32-bit seed from a landmark id. */
function seedFor(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h || 1
}

/* ---- shared helpers -------------------------------------- */

/** A solid, static box that both draws and collides. */
function solidBox(
  ctx: LandmarkContext,
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
function textPlane(
  ctx: LandmarkContext,
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
function markerRing(ctx: LandmarkContext, parent: THREE.Object3D, radius: number): void {
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

  solidBox(ctx, group, 0.16, 3.4, 0.16, [0, 1.7, 0], metal, { chamfer: 0.03 })

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

/** A slab with a headline and a rule — the world's editorial voice. */
const buildBillboard: Builder = (ctx, landmark) => {
  const group = new THREE.Group()
  const scale = landmark.scale ?? 1
  const width = 10 * scale
  const height = 5.6 * scale

  const metal = ctx.materials.get('metal')
  for (const x of [-width * 0.36, width * 0.36]) {
    solidBox(ctx, group, 0.2, 2.4 * scale, 0.2, [x, 1.2 * scale, 0], metal, {})
  }

  solidBox(
    ctx, group, width, height, 0.34 * scale,
    [0, 2.4 * scale + height / 2, 0],
    ctx.materials.get('paper'),
    { chamfer: 0.1 },
  )

  const faceY = 2.4 * scale + height / 2
  textPlane(ctx, group, landmark.label, 0.8 * scale, [0, faceY + height * 0.16, 0.19 * scale], {
    letterSpacing: 0.1,
  })
  if (landmark.sublabel) {
    textPlane(ctx, group, landmark.sublabel, 0.38 * scale, [0, faceY - height * 0.06, 0.19 * scale], {
      color: palette.ink3,
      letterSpacing: 0.16,
      weight: 500,
    })
  }

  // A vermilion rule under the headline: the site's own device.
  const rule = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 0.72, 0.06 * scale),
    ctx.materials.get('emissiveAccent'),
  )
  rule.position.set(0, faceY - height * 0.2, 0.19 * scale)
  group.add(rule)
  ctx.bin.add(() => rule.geometry.dispose())

  markerRing(ctx, group, (landmark.radius ?? 12) - 1)
  return { group, anchor: new THREE.Vector3(0, faceY + height * 0.62, 0), radius: 12 }
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
  const width = 9
  const height = 5.6

  const card = new THREE.Group()
  card.rotation.x = -0.16
  card.position.y = height / 2 + 0.5
  group.add(card)

  solidBox(ctx, card, width, height, 0.34, [0, 0, 0], ctx.materials.get('paper'), {
    chamfer: 0.14, collide: false,
  })
  ctx.physics.add({
    type: 'fixed',
    category: 'floor',
    position: toWorld(ctx, 0, height / 2 + 0.5, 0),
    rotation: new THREE.Quaternion().setFromEuler(
      new THREE.Euler(-0.16, ctx.rotation, 0, 'YXZ'),
    ),
    friction: 0.6,
    colliders: [{ shape: 'cuboid', parameters: [width / 2, height / 2, 0.17] }],
  })

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

/** Nodes and edges, standing up. The Data Structures monument. */
const buildGraphSculpture: Builder = (ctx, landmark) => {
  const group = new THREE.Group()
  const nodeMaterial = ctx.materials.get('ink')
  const edgeMaterial = ctx.materials.get('accent')

  const nodes: THREE.Vector3[] = []
  const count = 9
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + rand() * 0.3
    const radius = 3 + rand() * 4
    nodes.push(new THREE.Vector3(Math.cos(angle) * radius, 1.4 + rand() * 5.4, Math.sin(angle) * radius))
  }
  nodes.push(new THREE.Vector3(0, 4.6, 0))

  const sphere = new THREE.IcosahedronGeometry(0.62, 1)
  ctx.bin.add(() => sphere.dispose())
  for (const node of nodes) {
    const mesh = new THREE.Mesh(sphere, nodeMaterial)
    mesh.position.copy(node)
    mesh.castShadow = ctx.quality.settings.shadows
    group.add(mesh)

    ctx.physics.add({
      type: 'fixed', category: 'floor',
      position: toWorld(ctx, node.x, node.y, node.z),
      colliders: [{ shape: 'ball', parameters: [0.62] }],
    })

    // A leg, so nodes are held up rather than floating.
    const legHeight = node.y
    const leg = new THREE.CylinderGeometry(0.07, 0.07, legHeight, 6)
    const legMesh = new THREE.Mesh(leg, ctx.materials.get('metal'))
    legMesh.position.set(node.x, legHeight / 2, node.z)
    group.add(legMesh)
    ctx.bin.add(() => leg.dispose())
  }

  // Edges: thin boxes between selected pairs, each a real collider.
  const edges: [number, number][] = [
    [0, 9], [1, 9], [2, 9], [3, 9], [4, 9],
    [0, 1], [2, 3], [4, 5], [5, 6], [6, 7], [7, 8], [8, 0],
  ]
  for (const [a, b] of edges) {
    const from = nodes[a]
    const to = nodes[b]
    const mid = from.clone().lerp(to, 0.5)
    const length = from.distanceTo(to)
    const geometry = new THREE.CylinderGeometry(0.075, 0.075, length, 6)
    geometry.rotateX(Math.PI / 2)
    const mesh = new THREE.Mesh(geometry, edgeMaterial)
    mesh.position.copy(mid)
    mesh.lookAt(to)
    group.add(mesh)
    ctx.bin.add(() => geometry.dispose())
  }

  textPlane(ctx, group, landmark.label, 0.42, [0, 9.4, 0], { letterSpacing: 0.14 })
  markerRing(ctx, group, 8)
  return { group, anchor: new THREE.Vector3(0, 10.4, 0), radius: 10 }
}

/** Scheduled blocks in lanes. Operating Systems, and the debug yard. */
const buildProcessBlocks: Builder = (ctx, landmark) => {
  const group = new THREE.Group()
  const scale = landmark.scale ?? 1
  const lanes = 4
  const perLane = 5

  for (let lane = 0; lane < lanes; lane++) {
    const z = (lane - (lanes - 1) / 2) * 2.6 * scale

    // The lane itself: a rail the blocks sit on.
    solidBox(ctx, group, 15 * scale, 0.16, 1.9 * scale, [0, 0.08, z], ctx.materials.get('concrete'), { chamfer: 0.03,
    })

    for (let i = 0; i < perLane; i++) {
      const x = (i - (perLane - 1) / 2) * 2.9 * scale
      const height = (1 + rand() * 1.9) * scale
      // In the debug yard the reds are the failing tests, and they
      // are the ones that fall over.
      const failing = landmark.id === 'teaching-bugs' && (lane + i) % 3 === 0
      const material = failing
        ? ctx.materials.get('accent')
        : ctx.materials.tinted(lane % 2 ? palette.ink2 : palette.signal, 0.6, 0.05)

      if (failing) {
        // Left dynamic on purpose — knocking them over is the point.
        const geometry = chamferedBox(1.9 * scale, height, 1.5 * scale, 0.05)
        const mesh = new THREE.Mesh(geometry, material)
        mesh.position.set(x, 0.16 + height / 2, z)
        mesh.castShadow = ctx.quality.settings.shadows
        mesh.userData.dynamicBlock = true
        group.add(mesh)
        ctx.bin.add(() => geometry.dispose())
      } else {
        solidBox(ctx, group, 1.9 * scale, height, 1.5 * scale, [x, 0.16 + height / 2, z], material, { chamfer: 0.05,
        })
      }
    }
  }

  textPlane(ctx, group, landmark.label, 0.5 * scale, [0, 5.4 * scale, 0], { letterSpacing: 0.14 })
  markerRing(ctx, group, 9 * scale)
  return { group, anchor: new THREE.Vector3(0, 6 * scale, 0), radius: 11 * scale }
}

/** A wall of shifting cipher blocks. */
const buildCipherWall: Builder = (ctx, landmark) => {
  const group = new THREE.Group()
  const cols = 12
  const rows = 6
  const cell = 1.05

  solidBox(ctx, group, cols * cell + 0.6, rows * cell + 0.6, 0.5, [0, (rows * cell) / 2 + 0.3, 0],
    ctx.materials.get('graphite'), { chamfer: 0.08 })

  // Tiles in front of the wall, each a slightly different depth, so
  // the surface reads as encrypted rather than tiled.
  const tile = chamferedBox(cell * 0.82, cell * 0.82, 0.16, 0.02)
  ctx.bin.add(() => tile.dispose())
  const light = ctx.materials.get('chalk')
  const dark = ctx.materials.tinted(palette.ink, 0.7, 0.05)
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const on = rand() > 0.42
      const mesh = new THREE.Mesh(tile, on ? light : dark)
      mesh.position.set(
        (col - (cols - 1) / 2) * cell,
        0.3 + (row + 0.5) * cell,
        0.26 + rand() * 0.1,
      )
      group.add(mesh)
    }
  }

  textPlane(ctx, group, landmark.label, 0.42, [0, rows * cell + 1.4, 0], { letterSpacing: 0.14 })
  markerRing(ctx, group, 8)
  return { group, anchor: new THREE.Vector3(0, rows * cell + 2.2, 0), radius: 10 }
}

/** A stack of discs: pages, indexes, a root at the top. */
const buildDatabaseTower: Builder = (ctx, landmark) => {
  const group = new THREE.Group()
  const layers = 7

  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1)
    const radius = 4.2 - t * 2.8
    const height = 0.9
    const y = 0.4 + i * (height + 0.24)
    const geometry = new THREE.CylinderGeometry(radius, radius, height, 20, 1)
    const mesh = new THREE.Mesh(
      geometry,
      i === layers - 1 ? ctx.materials.get('accent') : ctx.materials.tinted(
        i % 2 ? palette.paper2 : palette.paper3, 0.85, 0,
      ),
    )
    mesh.position.y = y
    mesh.castShadow = ctx.quality.settings.shadows
    group.add(mesh)
    ctx.bin.add(() => geometry.dispose())

    ctx.physics.add({
      type: 'fixed', category: 'floor',
      position: toWorld(ctx, 0, y, 0),
      friction: 0.6,
      colliders: [{ shape: 'cylinder', parameters: [height / 2, radius] }],
    })
  }

  textPlane(ctx, group, landmark.label, 0.42, [0, layers * 1.14 + 1.4, 0], { letterSpacing: 0.14 })
  markerRing(ctx, group, 6)
  return { group, anchor: new THREE.Vector3(0, layers * 1.14 + 2.2, 0), radius: 9 }
}

/** Modules assembling into one system. Offset slabs, interlocking. */
const buildModuleStack: Builder = (ctx, landmark) => {
  const group = new THREE.Group()
  const modules = 6

  for (let i = 0; i < modules; i++) {
    const width = 3.6 - i * 0.24
    const height = 0.92
    const y = 0.46 + i * (height + 0.16)
    const offset = Math.sin(i * 1.7) * 1.3
    solidBox(ctx, group, width, height, 3.0, [offset, y, Math.cos(i * 1.1) * 0.9],
      i === modules - 1 ? ctx.materials.get('accent') : ctx.materials.tinted(
        i % 2 ? palette.ink2 : palette.metal, 0.6, 0.1,
      ),
      { chamfer: 0.06, rotation: i * 0.13 })
  }

  textPlane(ctx, group, landmark.label, 0.4, [0, modules * 1.08 + 1.4, 0], { letterSpacing: 0.14 })
  markerRing(ctx, group, 6)
  return { group, anchor: new THREE.Vector3(0, modules * 1.08 + 2.2, 0), radius: 9 }
}

/** UCL's research building: a white shell over an open floor. */
const buildResearchShell: Builder = (ctx, landmark) => {
  const group = new THREE.Group()
  const chalk = ctx.materials.tinted(palette.chalk, 0.7, 0.02)

  // A drivable floor plate, raised on columns.
  const columns = 8
  for (let i = 0; i < columns; i++) {
    const angle = (i / columns) * Math.PI * 2
    solidBox(ctx, group, 0.7, 7.2, 0.7, [Math.cos(angle) * 10.5, 3.6, Math.sin(angle) * 10.5],
      chalk, { chamfer: 0.06 })
  }

  // The shell: a shallow dome made of concentric rings, open at the
  // sides so the car can drive underneath.
  for (let ring = 0; ring < 4; ring++) {
    const t = ring / 3
    const radius = 11.5 - t * 3.4
    const y = 7.4 + t * 2.9
    const geometry = new THREE.TorusGeometry(radius, 0.42 - t * 0.1, 8, 40)
    geometry.rotateX(Math.PI / 2)
    const mesh = new THREE.Mesh(geometry, chalk)
    mesh.position.y = y
    mesh.castShadow = ctx.quality.settings.shadows
    group.add(mesh)
    ctx.bin.add(() => geometry.dispose())
  }

  const cap = new THREE.SphereGeometry(3.2, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5)
  const capMesh = new THREE.Mesh(cap, ctx.materials.get('accent'))
  capMesh.position.y = 10.4
  capMesh.castShadow = ctx.quality.settings.shadows
  group.add(capMesh)
  ctx.bin.add(() => cap.dispose())

  textPlane(ctx, group, landmark.label, 0.62, [0, 15.4, 0], { letterSpacing: 0.12 })
  if (landmark.sublabel) {
    textPlane(ctx, group, landmark.sublabel, 0.3, [0, 14.6, 0], {
      color: palette.ink3, letterSpacing: 0.14, weight: 500,
    })
  }
  markerRing(ctx, group, 13)
  return { group, anchor: new THREE.Vector3(0, 16.4, 0), radius: 15 }
}

/** Half a million documents, standing up as light. */
const buildDataField: Builder = (ctx, landmark) => {
  const group = new THREE.Group()
  const scale = landmark.scale ?? 1
  const count = ctx.quality.count(900, 180)

  // Instanced thin pillars, arranged in clusters — the corpus, and a
  // field the car drives straight through.
  const geometry = new THREE.BoxGeometry(0.12, 1, 0.12)
  geometry.translate(0, 0.5, 0)
  const material = ctx.materials.own(
    new THREE.MeshBasicMaterial({ color: new THREE.Color(palette.accentSoft), toneMapped: false }),
  )
  const mesh = new THREE.InstancedMesh(geometry, material, count)
  mesh.frustumCulled = false
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const size = new THREE.Vector3()

  const clusters = 7
  for (let i = 0; i < count; i++) {
    const cluster = i % clusters
    const clusterAngle = (cluster / clusters) * Math.PI * 2
    const clusterRadius = 9 + (cluster % 3) * 7
    const spread = 5.5
    position.set(
      Math.cos(clusterAngle) * clusterRadius + (rand() - 0.5) * spread * 2,
      0,
      Math.sin(clusterAngle) * clusterRadius + (rand() - 0.5) * spread * 2,
    )
    size.set(1, 0.6 + rand() * 7.5, 1)
    matrix.compose(position, quaternion, size)
    mesh.setMatrixAt(i, matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.scale.multiplyScalar(scale)
  group.add(mesh)
  ctx.bin.add(() => geometry.dispose())

  textPlane(ctx, group, '500K+', 1.5 * scale, [0, 12 * scale, 0], { color: palette.accent, letterSpacing: 0.06 })
  textPlane(ctx, group, 'DOCUMENTS', 0.42 * scale, [0, 10.6 * scale, 0], {
    color: palette.chalk2, letterSpacing: 0.2, weight: 500,
  })
  void landmark
  return { group, anchor: new THREE.Vector3(0, 13 * scale, 0), radius: 22 * scale }
}

/** A drivable chessboard with real pieces. */
const buildChessboard: Builder = (ctx, landmark) => {
  const group = new THREE.Group()
  const cell = 3.2
  const size = 8

  // The board: one plate, with alternating tiles laid on it.
  solidBox(ctx, group, cell * size + 1.6, 0.5, cell * size + 1.6, [0, 0.25, 0],
    ctx.materials.get('graphite'), { chamfer: 0.1 })

  const tile = new THREE.BoxGeometry(cell * 0.96, 0.12, cell * 0.96)
  ctx.bin.add(() => tile.dispose())
  const lightTile = ctx.materials.tinted(palette.paper2, 0.9, 0)
  const darkTile = ctx.materials.tinted(palette.ink2, 0.8, 0)
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const mesh = new THREE.Mesh(tile, (row + col) % 2 ? darkTile : lightTile)
      mesh.position.set((col - 3.5) * cell, 0.56, (row - 3.5) * cell)
      mesh.receiveShadow = ctx.quality.settings.shadows
      group.add(mesh)
    }
  }

  // A few pieces. Abstract turned forms — nothing that needs a model.
  const piece = (x: number, z: number, height: number, radius: number, accent: boolean) => {
    const geometry = new THREE.CylinderGeometry(radius * 0.55, radius, height, 12, 1)
    geometry.translate(0, height / 2, 0)
    const mesh = new THREE.Mesh(geometry, accent ? ctx.materials.get('accent') : ctx.materials.get('chalk'))
    mesh.position.set(x, 0.62, z)
    mesh.castShadow = ctx.quality.settings.shadows
    group.add(mesh)
    ctx.bin.add(() => geometry.dispose())

    const head = new THREE.SphereGeometry(radius * 0.62, 10, 8)
    const headMesh = new THREE.Mesh(head, mesh.material as THREE.Material)
    headMesh.position.set(x, 0.62 + height + radius * 0.4, z)
    group.add(headMesh)
    ctx.bin.add(() => head.dispose())

    // Movable: hitting a piece should move it.
    ctx.physics.add({
      type: 'dynamic',
      position: toWorld(ctx, x, 0.62 + height / 2, z),
      mass: 12,
      friction: 0.7,
      restitution: 0.05,
      linearDamping: 0.4,
      angularDamping: 0.7,
      colliders: [{ shape: 'cylinder', parameters: [height / 2, radius] }],
    })
  }

  piece(-3.5 * cell, -3.5 * cell, 2.4, 0.9, false)
  piece(3.5 * cell, -3.5 * cell, 2.4, 0.9, false)
  piece(-0.5 * cell, -3.5 * cell, 3.6, 1.0, true)
  piece(1.5 * cell, 2.5 * cell, 2.0, 0.8, false)
  piece(-2.5 * cell, 1.5 * cell, 2.8, 0.85, true)

  textPlane(ctx, group, landmark.label, 0.62, [0, 7.4, -cell * 4.6], { color: palette.chalk, letterSpacing: 0.12 })
  if (landmark.sublabel) {
    textPlane(ctx, group, landmark.sublabel, 0.26, [0, 6.6, -cell * 4.6], {
      color: palette.chalk3, letterSpacing: 0.14, weight: 500,
    })
  }
  return { group, anchor: new THREE.Vector3(0, 8, 0), radius: 16 }
}

/** Two moving walls of orders meeting at a matching engine. */
const buildOrderBook: Builder = (ctx, landmark) => {
  const group = new THREE.Group()
  const levels = 14

  const buyMaterial = ctx.materials.tinted(palette.signal, 0.5, 0.1)
  const sellMaterial = ctx.materials.tinted(palette.accent, 0.5, 0.1)

  for (let i = 0; i < levels; i++) {
    const t = i / (levels - 1)
    const height = 1.2 + (1 - t) * 6.5
    const z = 3 + i * 1.5
    solidBox(ctx, group, 3.4, height, 1.15, [-6, height / 2, z - 12], buyMaterial,
      { chamfer: 0.04 })
    solidBox(ctx, group, 3.4, height, 1.15, [6, height / 2, z - 12], sellMaterial,
      { chamfer: 0.04 })
  }

  // The matching engine in the middle: a raised, drivable platform.
  solidBox(ctx, group, 5.4, 1.2, 22, [0, 0.6, 0], ctx.materials.get('graphite'),
    { chamfer: 0.1 })

  textPlane(ctx, group, 'BUY', 0.5, [-6, 9.2, -12], { color: palette.signalSoft, letterSpacing: 0.2 })
  textPlane(ctx, group, 'SELL', 0.5, [6, 9.2, -12], { color: palette.accentSoft, letterSpacing: 0.2 })
  textPlane(ctx, group, landmark.label, 0.52, [0, 8, 13], { color: palette.chalk, letterSpacing: 0.12 })
  if (landmark.sublabel) {
    textPlane(ctx, group, landmark.sublabel, 0.62, [0, 6.9, 13], { color: palette.accent, letterSpacing: 0.08 })
  }
  markerRing(ctx, group, 12)
  return { group, anchor: new THREE.Vector3(0, 9.5, 0), radius: 14 }
}

/** A phone the size of a building, that you drive into. */
const buildDevice: Builder = (ctx, landmark) => {
  const group = new THREE.Group()
  const width = 17
  const length = 34
  const wall = 1.4

  // Lying flat, screen up: a phone becomes an arena.
  solidBox(ctx, group, length, 0.9, width, [0, 0.45, 0], ctx.materials.get('graphite'),
    { chamfer: 0.2 })

  // The screen, slightly proud of the body.
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(length - wall * 2, width - wall * 2),
    ctx.materials.own(new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.paper), toneMapped: false,
    })),
  )
  screen.rotation.x = -Math.PI / 2
  screen.position.y = 0.92
  screen.receiveShadow = false
  group.add(screen)
  ctx.bin.add(() => screen.geometry.dispose())

  // Bezel walls, so driving in feels like entering something.
  for (const [x, z, w, d] of [
    [0, -width / 2 + wall / 2, length, wall],
    [0, width / 2 - wall / 2, length, wall],
    [-length / 2 + wall / 2, 0, wall, width],
    [length / 2 - wall / 2, 0, wall, width],
  ] as [number, number, number, number][]) {
    // A gap in the near bezel is the way in.
    if (x === length / 2 - wall / 2) {
      solidBox(ctx, group, wall, 1.9, width * 0.3, [x, 1.35, -width * 0.34], ctx.materials.get('ink'),
        { chamfer: 0.05 })
      solidBox(ctx, group, wall, 1.9, width * 0.3, [x, 1.35, width * 0.34], ctx.materials.get('ink'),
        { chamfer: 0.05 })
      continue
    }
    solidBox(ctx, group, w, 1.9, d, [x, 1.35, z], ctx.materials.get('ink'),
      { chamfer: 0.05 })
  }

  // Camera bump and a speaker slot, so it reads as a phone.
  const bump = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.5, 0.4, 16),
    ctx.materials.get('ink'),
  )
  bump.position.set(-length / 2 + 3.4, 1.1, -width / 2 + 3.4)
  group.add(bump)
  ctx.bin.add(() => bump.geometry.dispose())

  textPlane(ctx, group, landmark.label, 2.4, [-6, 1.0, 0], { letterSpacing: 0.06, rotation: 0 })
    .rotation.set(-Math.PI / 2, 0, Math.PI / 2)
  if (landmark.sublabel) {
    const sub = textPlane(ctx, group, landmark.sublabel, 0.6, [4, 1.0, 0], {
      color: palette.ink3, letterSpacing: 0.16, weight: 500,
    })
    sub.rotation.set(-Math.PI / 2, 0, Math.PI / 2)
  }

  markerRing(ctx, group, 20)
  return { group, anchor: new THREE.Vector3(0, 6, 0), radius: 20 }
}

/** A browser window standing on the ground. Client City's unit. */
const buildBrowserTower: Builder = (ctx, landmark) => {
  const group = new THREE.Group()
  const width = 8
  const height = (landmark.scale ?? 1) * 14
  const depth = 1.6

  solidBox(ctx, group, width, height, depth, [0, height / 2, 0], ctx.materials.get('paper'),
    { chamfer: 0.12 })

  // Chrome bar with three dots — instantly reads as a browser.
  solidBox(ctx, group, width, 1.1, depth + 0.06, [0, height - 0.55, 0],
    ctx.materials.get('graphite'), { chamfer: 0.06, collide: false })
  const dot = new THREE.CircleGeometry(0.16, 10)
  ctx.bin.add(() => dot.dispose())
  for (let i = 0; i < 3; i++) {
    const mesh = new THREE.Mesh(dot, ctx.materials.get(i === 0 ? 'emissiveAccent' : 'chalk'))
    mesh.position.set(-width / 2 + 0.7 + i * 0.5, height - 0.55, depth / 2 + 0.05)
    group.add(mesh)
  }

  textPlane(ctx, group, landmark.label, 0.5, [0, height - 2.4, depth / 2 + 0.05], {
    letterSpacing: 0.08,
  })
  if (landmark.sublabel) {
    textPlane(ctx, group, landmark.sublabel, 0.26, [0, height - 3.3, depth / 2 + 0.05], {
      color: palette.ink3, letterSpacing: 0.14, weight: 500,
    })
  }

  // Content bars: a wireframe of a page.
  const bar = new THREE.PlaneGeometry(1, 0.18)
  ctx.bin.add(() => bar.dispose())
  const barMaterial = ctx.materials.tinted(palette.paper4, 1, 0)
  for (let i = 0; i < 9; i++) {
    const mesh = new THREE.Mesh(bar, barMaterial)
    const w = width * (0.32 + rand() * 0.46)
    mesh.scale.x = w
    mesh.position.set(-width / 2 + w / 2 + 0.8, height - 4.6 - i * 0.9, depth / 2 + 0.04)
    group.add(mesh)
  }

  markerRing(ctx, group, 6)
  return { group, anchor: new THREE.Vector3(0, height + 1.6, 0), radius: 9 }
}

/** A production station: a plinth with a labelled block on it. */
const buildStation: Builder = (ctx, landmark) => {
  const group = new THREE.Group()
  solidBox(ctx, group, 4.4, 1.0, 4.4, [0, 0.5, 0], ctx.materials.get('concrete'),
    { chamfer: 0.1 })
  solidBox(ctx, group, 2.6, 2.6, 2.6, [0, 2.3, 0], ctx.materials.get('accent'),
    { chamfer: 0.1 })

  textPlane(ctx, group, landmark.label, 0.44, [0, 4.6, 0], { letterSpacing: 0.14 })
  if (landmark.sublabel) {
    textPlane(ctx, group, landmark.sublabel, 0.22, [0, 4.1, 0], {
      color: palette.ink3, letterSpacing: 0.12, weight: 500,
    })
  }
  markerRing(ctx, group, 5.5)
  return { group, anchor: new THREE.Vector3(0, 5.6, 0), radius: 10 }
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

/** A rubber duck. Every debugging area needs one. */
const buildDuck: Builder = (ctx, _landmark) => {
  const group = new THREE.Group()
  const yellow = ctx.materials.tinted('#e8b23d', 0.55, 0)

  const body = new THREE.SphereGeometry(1.5, 16, 12)
  body.scale(1.25, 1, 1)
  const bodyMesh = new THREE.Mesh(body, yellow)
  bodyMesh.position.y = 1.5
  bodyMesh.castShadow = ctx.quality.settings.shadows
  group.add(bodyMesh)
  ctx.bin.add(() => body.dispose())

  const head = new THREE.SphereGeometry(0.9, 14, 10)
  const headMesh = new THREE.Mesh(head, yellow)
  headMesh.position.set(1.1, 3.0, 0)
  headMesh.castShadow = ctx.quality.settings.shadows
  group.add(headMesh)
  ctx.bin.add(() => head.dispose())

  const beak = new THREE.ConeGeometry(0.34, 0.9, 8)
  beak.rotateZ(-Math.PI / 2)
  const beakMesh = new THREE.Mesh(beak, ctx.materials.get('accent'))
  beakMesh.position.set(2.1, 2.9, 0)
  group.add(beakMesh)
  ctx.bin.add(() => beak.dispose())

  for (const z of [-0.42, 0.42]) {
    const eye = new THREE.SphereGeometry(0.13, 8, 6)
    const eyeMesh = new THREE.Mesh(eye, ctx.materials.get('ink'))
    eyeMesh.position.set(1.6, 3.25, z)
    group.add(eyeMesh)
    ctx.bin.add(() => eye.dispose())
  }

  ctx.physics.add({
    type: 'fixed', category: 'floor',
    position: toWorld(ctx, 0, 1.5, 0),
    colliders: [{ shape: 'ball', parameters: [1.5] }],
  })

  return { group, anchor: new THREE.Vector3(0, 4.6, 0), radius: 7 }
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
  graphSculpture: buildGraphSculpture,
  processBlocks: buildProcessBlocks,
  cipherWall: buildCipherWall,
  databaseTower: buildDatabaseTower,
  moduleStack: buildModuleStack,
  researchShell: buildResearchShell,
  dataField: buildDataField,
  chessboard: buildChessboard,
  orderBook: buildOrderBook,
  device: buildDevice,
  browserTower: buildBrowserTower,
  station: buildStation,
  gate: buildGate,
  terminal: buildTerminal,
  island: buildIsland,
  duck: buildDuck,
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
  rand = seeded(seedFor(landmark.id))
  const ctx: LandmarkContext = { ...base, at, rotation: landmark.rotation ?? 0 }
  if (landmark.id === 'circuit-start' || landmark.id === 'teaching-bugs') {
    // CircuitRace owns the gantry and collision-free starting lane.
    const group = new THREE.Group(); group.position.copy(at)
    return { group, anchor: new THREE.Vector3(0, 4, 0), radius: 16 }
  }

  // The hub's name is the one landmark with a bespoke builder,
  // because it is the only one made of letters.
  const builder = landmark.id === 'hub-name' ? buildMonumentName : BUILDERS[landmark.visual]
  const built = builder(ctx, landmark)
  built.group.position.copy(at)
  built.group.rotation.y = ctx.rotation
  return built
}

export { hullPoints }
