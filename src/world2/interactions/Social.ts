import * as THREE from 'three'
import type { Bin } from '@/world/core/Disposal'
import type { World2Game } from '../World2Game'
import type { World2Environment } from '../World2Environment'
import type { References } from './references'
import type { Prompts } from './Prompts'
import { contact } from '@/content/profile'
import { cutGlyph, paintUv } from './glyphs'
import {
  SIGN_THEMES, SWATCH, Sign, SignRuntime, mergeParts, onSignFontsLoaded, place, plankGeometry, signMaterials,
  type MergePart, type Rect, type SignMaterials, type SignTheme, type PaintTools,
} from '../signs'
import {
  ARRIVAL, PLAZA, arrivalSpots, authoredYaw, lensDirection, lensYaw, pieceMatrix, plazaToLocal, selectKeepers, slots, splitPieces, standingLevel,
  towardLens, yawToward, type Spot,
} from './socialLayout'
import { STATIONS, STATION_ICONS, isPending, shortValue, type StationId } from '../content/social'

/* ============================================================
   PORTED FROM: sources/Game/World/Areas/SocialArea.js
   folio-2025 — Copyright (c) 2025 Bruno Simon — MIT
   See THIRD_PARTY_NOTICES.md.

   Upstream lays eight interactive points on a half-circle of
   radius 6 around `refCenter`, one per entry of data/social.js,
   and leaves the nine icon meshes as knockable props.

   Three deliberate differences. First, the points sit ON the icons
   that already exist in the level — `gitHubPhysicalDynamic`,
   `linkedInPhysicalDynamic`, `mailPhysicalDynamic` — rather than
   on a synthetic ring, because the .blend already drew the right
   pictures and a visitor should be able to see which is which
   before pressing anything.

   Second, the icons with no Alejandro equivalent — X, YouTube,
   Discord, Twitch, Bluesky and OnlyFans — are GONE. They were
   kept for a while as unlabelled scenery on the argument that a
   logo with no link claims nothing. That argument is wrong in a
   plaza: a plinth with the Twitch mark on it in the middle of
   somebody's contact page reads as an account, whatever the code
   intends. See `RETIRED` below, which the physics layer reads
   too, so the removed props leave no invisible collider behind.
   What they stood on went with them (see THE PLAZA).

   Third, the centrepiece. The .blend stands Bruno, his dog, his
   cat and an FWA trophy on the dais — his life, his award. In
   their place stands the monogram this portfolio already signs
   itself with: the same AN the HUD wears and the same AN painted
   on the car door, cut from the same typeface as the name on the
   beach, sized to the volume the authored statue occupied.

   THE PLAZA. The level was authored for another camera. /world
   has one gameplay camera with a fixed azimuth (it never turns with
   the car) and the instance sits in a frame the world document
   rotated, so as authored the icons face 105° away from the lens,
   the arc of pads runs along the view's depth axis and hugs the
   right edge of the screen, and the name plates are mirrored half
   the time. `arrange` runs BEFORE the physics exist and re-seats
   everything for that lens: it keeps the dais and the pads of the
   contacts this portfolio has (the pad mesh is one merged mesh of
   ten pieces, so it is cut apart by connectivity), turns them and
   the three icons square to the camera and stands them on a shallow
   smile of stations toward it. An icon travels with ITS PAD, not
   with its own origin (the mailbox's origin is half a pad in front of
   its pad's centre, and its post stands at the pad's rear edge), and
   a prop that a wake-up would tip off its pad gets a foot (`steady`).
   The controller then builds what
   needs the bodies — a wooden board behind every station, the
   prompts, the monogram — in the same camera-aligned frame. The
   boards are PHYSICAL signs (two posts in the ground, a collider you
   drive under or bump), so they are not billboards: they face the
   default camera, lean back a few degrees to read from the camera's
   41° above the ground, and a drag-orbit walks round them like any
   board. What floats — the four prompts — turns to the camera
   through ./Billboards. All of it is code, not data: it follows the
   instance wherever the world document puts it, and it leaves alone
   any part the studio moved by hand. The studio runs it too: Simulate
   exactly as the player does, the Edit preview (which has no instance
   rotation to read) for an unrotated one, so the world document's own
   rotation turns it there, as it turns every asset.

   /world2 (the React route) never calls `arrange`, and a Social
   without a layout is the plaza as it always was.

   Every URL comes from `contact` in src/content/profile.ts.
   ============================================================ */

interface Link {
  id: string
  label: string
  /** Where it goes; null while the entry has no destination yet (the CV, until its file exists). */
  href: string | null
  /** The icon (or document) standing on the station. */
  node: THREE.Object3D
  /** What the reader reads: the plate, or the board that replaced it. */
  sign: THREE.Object3D
}

/** A place's own arrival (see `Social.declareArrival`), in the world's coordinates: what runtime/placement.js's `Placement.arrivalPoints` holds. */
interface ArrivalPoint {
  name: string
  /** Where the car may be put down, preferred first; heading is the one `moveTo` takes. */
  poses: { x: number; z: number; heading: number }[]
  /** Clearance (m) kept from bodies that move. */
  dynamicMargin: number
  /** Metres around the first pose within which a map target is served by this arrival. */
  reach: number
}
/** The part of the player runtime's Placement this reads. */
interface ArrivalHost { arrivalPoints?: Set<ArrivalPoint> }

/** Which authored icon carries which contact entry. */
const ICONS = STATION_ICONS as Record<string, string>

/**
 * Authored props this portfolio does not stand behind: service marks for
 * accounts Alejandro has none of, and the .blend's personal statuary.
 *
 * `Interactions.reservedNames` feeds this list to the environment BEFORE it
 * builds physics, which is the only moment that works. Disabling a body after
 * the fact is not enough — the island reset re-enables every dynamic body it
 * can see — and the environment's second pass would give any leftover mesh a
 * trimesh collider of its own, so hiding alone leaves a wall you can hit.
 */
export const RETIRED = [
  'twitchPhysicalDynamic',
  'youtubePhysicalDynamic',
  'discordPhysicalDynamic',
  'blueskyPhysicalDynamic.001',
  'xPhysicalDynamic',
  'onlyfansPhysicalDynamic',
  // The dais: Bruno, his cat, his dog and its wings.
  'refStatuePhysicalDynamic',
  'boyMesh',
  'baguiraMesh.001',
  'sudoMesh.003',
  'wings',
]

/**
 * What `arrange` takes over. Reserved (no body is built from it) once the plaza has been recomposed, and only then, so
 * a Social that was not arranged keeps every authored collider:
 *   physicalFixed.002  nine pad cuboids and the dais hull, all of them for pads that moved or are gone. The pad mesh's
 *                      own trimesh (the environment fits one to any big mesh without a body) collides with exactly
 *                      what is left, so nothing else is needed.
 *   refFan             the OnlyFans fan with its own plinth: a prop 14 g from anything, with a "Give it a spin"
 *                      prompt that could never act.
 */
export const REPLACED = ['physicalFixed.002', 'refFan']

/** Flagged on a node by `arrange`; `Interactions.reservedNames` reserves REPLACED names carrying it. */
export const REPLACED_FLAG = 'w2Replaced'

/** The monogram in the middle, in reading order, top line first. */
const MONOGRAM = ['A', 'N']

/** The arranged plaza's monogram, as a share of the authored statue's volume. See `buildMonogram`. */
const PLAZA_MONOGRAM = 0.8

/** The retired Twitch plinth is the pad the CV takes: the four real contacts then sit in one unbroken run. */
const CV_SEAT = 'twitchPhysicalDynamic'

/**
 * The texel a palette-shaded mesh spends most of its surface on — its colour,
 * in other words. The statue is three: a plinth, a body and a highlight; the
 * one the most vertices point at is the stone.
 */
function modalUv(mesh: THREE.Mesh | undefined): THREE.Vector2 | null {
  const attribute = mesh?.geometry.getAttribute('uv')
  if (!attribute) return null
  const tally = new Map<string, { uv: THREE.Vector2; count: number }>()
  for (let i = 0; i < attribute.count; i++) {
    const x = attribute.getX(i), y = attribute.getY(i)
    const key = `${x.toFixed(4)},${y.toFixed(4)}`
    const seen = tally.get(key)
    if (seen) seen.count++
    else tally.set(key, { uv: new THREE.Vector2(x, y), count: 1 })
  }
  let best: { uv: THREE.Vector2; count: number } | null = null
  for (const entry of tally.values()) if (!best || entry.count > best.count) best = entry
  return best?.uv ?? null
}

/* ============================================================
   THE PLAZA, BEFORE THE PHYSICS EXISTS
   ============================================================ */

export interface Seat extends Spot {
  id: StationId
  /** Degrees off the lens axis (left negative). */
  angle: number
  /** The icon, or the CV's document. */
  node: THREE.Object3D | null
}

export interface SocialLayout {
  /** The yaw that turns the frame's +z onto the lens: camera azimuth − frame yaw. */
  psi: number
  /** The dais, in the level's own (frame-local) coordinates. */
  dais: THREE.Vector3
  seats: Partial<Record<StationId, Seat>>
  /** Height of what an icon stands on: the pads' recessed tile, not their rim. */
  padTop: number
}

/** What `arrange` found, for the controller that is built afterwards. Keyed by the environment, so nothing is global. */
const layouts = new WeakMap<object, SocialLayout>()

/** The layout `arrange` made for this environment, if it did. */
export const layoutOf = (environment: object): SocialLayout | undefined => layouts.get(environment)

/** Everything drawn under a node except the invisible collider helpers, as one world box. */
function visualBox(node: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3()
  node.updateWorldMatrix(true, true)
  node.traverse(child => {
    if (!(child instanceof THREE.Mesh) || child.userData.w2Role === 'collider') return
    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox()
    box.union(child.geometry.boundingBox!.clone().applyMatrix4(child.matrixWorld))
  })
  return box
}

const WORLD_UP = new THREE.Vector3(0, 1, 0)

/**
 * The authored icons' colliders end above the icons' own feet. The legacy plaza shows what that does: the first time
 * anything touches an icon (and every time the island is reset) it drops 0.3 to 0.6 g onto its pad, and what is drawn
 * sinks into the pad with it. So the lowest collider of each icon is grown downward until it reaches the surface the icon
 * stands on, and the pose a body starts in is the pose it rests in. Only colliders that stay upright are touched, and
 * nothing is ever grown below `floor` (a collider inside the pad's trimesh would be thrown out of it).
 */
export function reachFloor(root: THREE.Object3D, floor: number): void {
  root.updateWorldMatrix(true, true)
  const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3()
  const up = new THREE.Vector3()
  let lowest: { node: THREE.Object3D; bottom: number; half: number } | null = null
  for (const node of root.children) {
    if (node.userData.w2Role !== 'collider' || (node as THREE.Mesh).isMesh) continue
    if (node.userData.w2Shape !== 'cuboid' && node.userData.w2Shape !== 'tube') continue
    node.matrixWorld.decompose(position, quaternion, scale)
    if (Math.abs(up.set(0, 1, 0).applyQuaternion(quaternion).y) < 0.99) continue
    const half = Math.abs(scale.y) * (node.userData.w2DisplaySize ?? 0.5)
    if (half > 1e-6 && (!lowest || position.y - half < lowest.bottom)) lowest = { node, bottom: position.y - half, half }
  }
  if (!lowest) return
  const reach = lowest.bottom - floor
  if (reach <= 0.005) return
  // Grow by `reach` downward: the half-height gains reach / 2 and the centre moves down by as much. The child lives in the
  // root's own (scaled) space, so its offsets are the world ones divided by the root's scale.
  const k = root.getWorldScale(new THREE.Vector3()).y
  lowest.node.scale.y *= (lowest.half + reach / 2) / lowest.half
  lowest.node.position.y -= reach / 2 / k
  lowest.node.updateMatrixWorld(true)
}

/** How far a prop must be able to lean before its centre of mass leaves its foot: 30 degrees. */
const LEAN = Math.tan(30 * Math.PI / 180)

/**
 * The physics layer gives every collider of a body the same share of its mass, wherever it is and however big (`mass / colliders`),
 * so a prop's centre of mass is the mean of its colliders' centres. The authored mailbox is two colliders: a narrow post at the back
 * and a box that overhangs it by most of its own length, which puts the centre of mass outside the post's footprint. Left alone it
 * is balanced on a knife edge; the first thing that wakes it (a bump, or the island reset waking every prop) tips it 25 degrees over
 * and slides it 0.3 m off the pad, 0.5 m down onto the sand, and the reset never gets it back to stay.
 *
 * `steady` gives such a prop a foot: one flat slab at the floor under its lowest collider, wide enough that the centre of mass of
 * everything (the foot is one more equal share) stays over it even with the prop leaned 30 degrees. It is invisible, five centimetres
 * thick, and it hides under what overhangs it. A prop whose centre of mass is already over the middle of its lowest collider (the CV's
 * document, a single icon) is left exactly as it is. Only upright cuboids and tubes are understood; anything else is left alone.
 * Works in the root's own frame, so it follows the root's scale and turn. Returns the collider it added.
 */
export function steady(root: THREE.Object3D): THREE.Object3D | null {
  root.updateWorldMatrix(true, true)
  const parts: { x: number; y: number; z: number; hx: number; hy: number; hz: number }[] = []
  const up = new THREE.Vector3()
  for (const node of root.children) {
    if (node.userData.w2Role !== 'collider' || (node as THREE.Mesh).isMesh) continue
    const shape = node.userData.w2Shape
    if (shape !== 'cuboid' && shape !== 'tube') return null
    if (Math.abs(up.set(0, 1, 0).applyQuaternion(node.quaternion).y) < 0.99) return null
    const half = node.userData.w2DisplaySize ?? 0.5
    const sx = Math.abs(node.scale.x) * half, sy = Math.abs(node.scale.y) * half, sz = Math.abs(node.scale.z) * half
    // Footprint in the root's axes: a cuboid turned about the vertical by `yaw` covers |cos| a + |sin| b across.
    const yaw = 2 * Math.atan2(node.quaternion.y, node.quaternion.w), c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw))
    const radius = Math.max(sx, sz)
    parts.push(shape === 'tube'
      ? { x: node.position.x, y: node.position.y, z: node.position.z, hx: radius, hy: sy, hz: radius }
      : { x: node.position.x, y: node.position.y, z: node.position.z, hx: c * sx + s * sz, hy: sy, hz: s * sx + c * sz })
  }
  if (parts.length < 2) return null

  const lowest = parts.reduce((a, b) => (b.y - b.hy < a.y - a.hy ? b : a))
  const bottom = lowest.y - lowest.hy
  const mean = (axis: 'x' | 'y' | 'z', extra: number[] = []) => (parts.reduce((sum, p) => sum + p[axis], 0) + extra.reduce((sum, v) => sum + v, 0)) / (parts.length + extra.length)
  // Steady already: the centre of mass is over the middle of what the prop stands on.
  if (Math.abs(mean('x') - lowest.x) <= lowest.hx * 0.6 && Math.abs(mean('z') - lowest.z) <= lowest.hz * 0.6) return null

  const k = root.getWorldScale(new THREE.Vector3()).y || 1
  const thick = Math.min(0.05 / k, lowest.hy)
  const own = { x0: lowest.x - lowest.hx, x1: lowest.x + lowest.hx, z0: lowest.z - lowest.hz, z1: lowest.z + lowest.hz }
  let rect = own
  for (let pass = 0; pass < 8; pass++) {
    const at = { x: (rect.x0 + rect.x1) / 2, y: bottom + thick / 2, z: (rect.z0 + rect.z1) / 2 }
    const com = { x: mean('x', [at.x]), y: mean('y', [at.y]), z: mean('z', [at.z]) }
    const reach = Math.max(0, com.y - bottom) * LEAN
    const next = { x0: Math.min(own.x0, com.x - reach), x1: Math.max(own.x1, com.x + reach), z0: Math.min(own.z0, com.z - reach), z1: Math.max(own.z1, com.z + reach) }
    const same = Math.abs(next.x0 - rect.x0) + Math.abs(next.x1 - rect.x1) + Math.abs(next.z0 - rect.z0) + Math.abs(next.z1 - rect.z1) < 1e-5
    rect = next
    if (same) break
  }
  const foot = colliderBox('cuboid.foot', [rect.x1 - rect.x0, thick, rect.z1 - rect.z0], [(rect.x0 + rect.x1) / 2, bottom + thick / 2, (rect.z0 + rect.z1) / 2])
  root.add(foot)
  foot.updateMatrixWorld(true)
  return foot
}

/**
 * The CV's stand-in: a clipboard of the same cream paper the sheets of the homepage use, on a small timber foot. One
 * merged mesh sampling the level's palette (216 triangles). The CV has no authored icon, and a pad with only a plaque
 * on it reads as an empty pad.
 */
export function documentGeometry(): THREE.BufferGeometry {
  const bar = (width: number, y: number, x = 0, swatch: number = SWATCH.dark): MergePart =>
    place(plankGeometry({ width, height: 0.075, depth: 0.02, swatch, bevel: 0 }), [x, y, 0.082])
  return mergeParts([
    place(plankGeometry({ width: 1.1, height: 0.12, depth: 0.62, swatch: SWATCH.copper, edge: SWATCH.woodDark, bevel: 0.025 }), [0, 0.06, 0.02]),
    place(plankGeometry({ width: 0.16, height: 0.62, depth: 0.12, swatch: SWATCH.tan, edge: SWATCH.woodDark, bevel: 0.02 }), [0, 0.43, -0.1]),
    place(plankGeometry({ width: 1.0, height: 1.34, depth: 0.09, swatch: SWATCH.white, edge: SWATCH.silver, bevel: 0.025 }), [0, 1.2, 0.0]),
    // The name, then the lines under it, then the corner turned down.
    bar(0.56, 1.72, -0.12, SWATCH.copper),
    bar(0.72, 1.5, -0.04), bar(0.72, 1.36, -0.04), bar(0.6, 1.22, -0.1), bar(0.72, 1.08, -0.04), bar(0.5, 0.94, -0.15),
    place(plankGeometry({ width: 0.2, height: 0.2, depth: 0.025, swatch: SWATCH.silver, bevel: 0 }), [0.4, 0.62, 0.082], [0, 0, Math.PI / 4]),
  ])
}

/** An empty with a collider's description; the environment turns it into a cuboid of `size` centred on `at`. */
function colliderBox(name: string, size: [number, number, number], at: [number, number, number]): THREE.Object3D {
  const node = new THREE.Object3D()
  node.name = name
  node.userData = { w2Role: 'collider', w2Shape: 'cuboid', w2DisplaySize: 0.5 }
  node.position.set(...at)
  node.scale.set(...size)
  node.visible = false
  return node
}

/**
 * Re-seats the plaza for the fixed gameplay camera. Call it once, BEFORE `environment.addPhysics` (and before
 * `Interactions.reservedNames` is read, because it marks what it replaces):
 *   1. the pad mesh keeps the dais and the pad of every contact, each turned square to the lens;
 *   2. GitHub, LinkedIn and the mailbox stand on their stations facing the lens, a little larger;
 *   3. the CV gets a document to stand on its pad, built as a pushable prop so the island reset puts it back.
 * The bodies are then built from this new pose, so each prop's initial state — what the reset returns it to — is the
 * station, and the pads' trimesh matches the pads that are drawn.
 *
 * `rotation` is the instance's rotation in the world (LocalPhysics.rotation) and `theta` the camera's azimuth, which
 * the View calls baseTheta. Returns null, having touched nothing, when the level is not the one this was written for:
 * a re-export that renames a node leaves the arc as authored (minus the retired marks) instead of throwing.
 * Parts the studio moved by hand (userData.assetPartEdited) stay where the author put them.
 */
export function arrange(
  environment: World2Environment,
  { rotation = null, theta = Math.PI / 4 }: { rotation?: THREE.Quaternion | null; theta?: number } = {},
): SocialLayout | null {
  const nodes = environment.nodes
  const centre = nodes.get('refCenter'), pads = nodes.get('Cube.133')
  if (!centre || !(pads instanceof THREE.Mesh) || !pads.geometry.index || pads.geometry.groups.length || Array.isArray(pads.material)) return null
  environment.group.updateMatrixWorld(true)

  // The pad mesh is only ever moved by a translation; anything else and the maths below would be answering another question.
  const world = pads.matrixWorld
  const worldRotation = new THREE.Quaternion(), worldScale = new THREE.Vector3()
  world.decompose(new THREE.Vector3(), worldRotation, worldScale)
  if (worldRotation.angleTo(new THREE.Quaternion()) > 1e-4 || Math.abs(worldScale.x - 1) > 1e-4 || Math.abs(worldScale.y - 1) > 1e-4 || Math.abs(worldScale.z - 1) > 1e-4) return null

  const psi = lensYaw(theta, rotation)
  const dais = centre.getWorldPosition(new THREE.Vector3())
  const placed = slots().map(slot => ({ ...slot, ...plazaToLocal(slot, psi, dais) }))
  const target = Object.fromEntries(STATIONS.map((id, index) => [id, placed[index]])) as Record<StationId, Spot & { angle: number }>

  // Where the authored icons stand: the CV takes the pad the Twitch mark left.
  const iconNode = (id: StationId): THREE.Object3D | null => nodes.get(ICONS[id] ?? CV_SEAT) ?? null
  const anchors: Record<string, Spot> = {}
  for (const id of STATIONS) {
    const node = iconNode(id)
    if (!node) return null
    const at = node.getWorldPosition(new THREE.Vector3())
    anchors[id] = { x: at.x, z: at.z }
  }

  const geometry = pads.geometry
  const indexArray = pads.geometry.index.array
  const pieces = splitPieces(geometry)
  const centres = pieces.map(piece => piece.box.getCenter(new THREE.Vector3()).applyMatrix4(world))
  const keepers = selectKeepers(centres, { x: dais.x, z: dais.z }, anchors)
  if (!keepers) return null

  /* ---- 1. the pad mesh ---------------------------------------------------------------- */
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal')
  const inverse = world.clone().invert()
  const point = new THREE.Vector3(), n = new THREE.Vector3()
  const kept: number[] = []
  let padTop = 0
  for (const { index, id } of keepers) {
    const piece = pieces[index], c = centres[index]
    const to: Spot = id === 'dais' ? { x: dais.x, z: dais.z } : target[id as StationId]
    // Authored pads are tangent to the arc: their yaw is their angle round the dais. The dais was authored square to the level.
    const turn = psi - (id === 'dais' ? 0 : authoredYaw(c, dais))
    const scale = id === 'dais' ? 1 : PLAZA.padScale
    const matrix = pieceMatrix(c, to, turn, scale)
    const normals = new THREE.Matrix3().getNormalMatrix(new THREE.Matrix4().makeRotationY(turn).multiply(new THREE.Matrix4().makeScale(scale, 1, scale)))
    for (const v of piece.vertices) {
      point.set(position.getX(v), position.getY(v), position.getZ(v)).applyMatrix4(world).applyMatrix4(matrix).applyMatrix4(inverse)
      position.setXYZ(v, point.x, point.y, point.z)
      if (normal) {
        n.set(normal.getX(v), normal.getY(v), normal.getZ(v)).applyMatrix3(normals).normalize()
        normal.setXYZ(v, n.x, n.y, n.z)
      }
    }
    for (const t of piece.triangles) kept.push(indexArray[t], indexArray[t + 1], indexArray[t + 2])
    // What an icon stands on is the pad's recessed tile (0.427 g), not its rim (0.473 g).
    if (id !== 'dais') padTop = Math.max(padTop, standingLevel(geometry, piece) + world.elements[13])
  }
  compactGeometry(geometry, kept)

  /* ---- 2. the icons -------------------------------------------------------------------- */
  const seats: SocialLayout['seats'] = {}
  const yaw = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, psi)
  for (const id of STATIONS) {
    const slot = target[id]
    const seat: Seat = { id, x: slot.x, z: slot.z, angle: slot.angle, node: null }
    seats[id] = seat
    const node = id === 'cv' ? null : iconNode(id)
    if (!node || node.userData.assetPartEdited) { seat.node = node; continue }
    seat.node = node
    // The world document saves every part's position and the studio puts them back over its Edit preview (editor.apply),
    // which would walk the icons off the pads the plaza has just put them on. A part the editor does not index keeps its pose.
    node.userData.proceduralDerived = true
    const parent = node.parent!
    const before = visualBox(node)
    const origin = node.getWorldPosition(new THREE.Vector3())
    // The authored icons hover above their pads (the cat by 0.19 g): they stand on them here. A post sunk in the pad stays sunk.
    const gap = Math.min(before.min.y - padTop, 0.02)
    // Where the icon stood on ITS PAD (not on the icon's own origin: the mailbox's origin is 0.57 g in front of its pad's centre and
    // its post stands at the pad's rear edge, so seating the origin on the seat put the post 0.5 g off the pad, in the air), carried
    // through the same turn as the icon: it was squared to the level's own axes (yaw `authored`) and is now squared to the lens.
    const pad = centres[keepers.find(keeper => keeper.id === id)!.index]
    const authored = node.getWorldQuaternion(new THREE.Quaternion())
    const offset = new THREE.Vector3(origin.x - pad.x, 0, origin.z - pad.z)
      .applyQuaternion(new THREE.Quaternion().setFromAxisAngle(WORLD_UP, psi - 2 * Math.atan2(authored.y, authored.w)))
    node.scale.multiplyScalar(PLAZA.iconScale)
    parent.updateWorldMatrix(true, false)
    const parentRotation = parent.getWorldQuaternion(new THREE.Quaternion())
    node.quaternion.copy(parentRotation.clone().invert().multiply(yaw))
    const next = new THREE.Vector3(slot.x, 0, slot.z).addScaledVector(offset, PLAZA.iconScale)
    next.y = origin.y
    node.position.copy(parent.worldToLocal(next.clone()))
    node.updateMatrixWorld(true)
    const after = visualBox(node)
    // Stand on the pad as it stood on its own, scaled with it: a sunk post stays sunk.
    next.y += padTop + gap * PLAZA.iconScale - after.min.y
    node.position.copy(parent.worldToLocal(next.clone()))
    node.updateMatrixWorld(true)
    reachFloor(node, Math.max(padTop + gap * PLAZA.iconScale, padTop))
    steady(node)
  }

  /* ---- 3. the CV's document ------------------------------------------------------------- */
  const cv = seats.cv!
  const material = pads.material
  const prop = new THREE.Mesh(documentGeometry(), material)
  prop.name = 'cvPhysicalDynamic'
  prop.userData = { name: prop.name, w2Source: prop.name, w2Category: 'scenery', w2Role: 'physical', w2Body: 'dynamic', mass: 1, proceduralDerived: true }
  prop.castShadow = true
  prop.receiveShadow = true
  // Two cuboids, each one the size of what it stands in for. The root's own scale (below) is applied by the body builder.
  prop.add(colliderBox('cuboid.cvSheet', [1.0, 1.34, 0.09], [0, 1.2, 0]), colliderBox('cuboid.cvFoot', [1.1, 0.12, 0.62], [0, 0.06, 0.02]))
  prop.scale.setScalar(PLAZA.iconScale)
  prop.quaternion.copy(yaw)
  prop.position.set(cv.x, padTop + 0.005, cv.z)
  environment.group.add(prop)
  environment.nodes.set(prop.name, prop)
  environment.meshes.push(prop)
  cv.node = prop

  // What the plaza replaced: no body is built from it (see REPLACED).
  for (const name of REPLACED) { const node = nodes.get(name); if (node) node.userData[REPLACED_FLAG] = true }

  const layout: SocialLayout = { psi, dais, seats, padTop }
  layouts.set(environment, layout)
  return layout
}

/** Keeps only the triangles in `index` and drops every vertex nothing refers to, so the bounds and the trimesh are tight. */
function compactGeometry(geometry: THREE.BufferGeometry, index: number[]): void {
  const count = geometry.getAttribute('position').count
  const remap = new Int32Array(count).fill(-1)
  let next = 0
  for (const v of index) if (remap[v] < 0) remap[v] = next++
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const size = attribute.itemSize
    const array = new (attribute.array.constructor as new (length: number) => THREE.TypedArray)(next * size)
    for (let v = 0; v < count; v++) {
      const to = remap[v]
      if (to < 0) continue
      for (let k = 0; k < size; k++) array[to * size + k] = attribute.array[v * size + k]
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(array, size, attribute.normalized))
  }
  geometry.setIndex(index.map(v => remap[v]))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
}

/* ============================================================
   THE BOARDS
   ============================================================ */

/**
 * Each station's board: the same island timber as the project boards, with a hardware of its own (the kit's
 * themes are data). Ribbons are the kit's own pairs, so the lettering on them keeps its contrast.
 */
const BOARD_THEMES: Record<StationId, SignTheme> = {
  github: { ...SIGN_THEMES.voxel, id: 'social-github', emblem: null, charm: 'gear', hardware: 'oak' },
  linkedin: { ...SIGN_THEMES.jobs, id: 'social-linkedin', emblem: null, charm: 'cards', hardware: 'rope' },
  email: { ...SIGN_THEMES.chess, id: 'social-email', emblem: null, charm: 'pennant', hardware: 'oak' },
  cv: { ...SIGN_THEMES.timeline, id: 'social-cv', emblem: null, charm: 'books', hardware: 'chain' },
}

/** The small line over the name: what the station is for. */
const KICKER: Record<StationId, string> = { github: 'The code', linkedin: 'The career', email: 'Say hello', cv: 'The document' }

/**
 * Frame units (g; the instance is scaled 0.7, so a world metre is 0.7 g). A board's face is 2.4 x 0.97 m in the world, starts
 * `bottom` g off the ground, stands `behind` g behind its pad as the lens sees it, and leans back `lean` radians like a sign
 * planted at a slant: from the camera's 41 degrees above the ground a vertical board shows 75% of its height, a leaning one
 * 87%, and from the sides and from above (a camera that is nearly overhead when the car is behind the plaza) it stays
 * readable where a vertical one goes edge-on.
 */
export const BOARD = { width: 3.42, height: 1.38, bottom: 2.55, behind: 1.9, lean: 12 * Math.PI / 180, dpm: 176 }

/**
 * Where a station's prompt floats: just above the icon's head, a little toward the lens (the icon is solid, so a prompt inside it is
 * hidden by it), and read outward-in: the label hangs toward the middle of the plaza, away from the screen's edge, so on a narrow
 * screen the outer stations still read in full. The car that stops to use it is under the prompt, never in front of it: a prompt
 * at the car's own height is half hidden by its roof (`GitHu`), one above its roof (the car's is 1.6 m, 2.3 g) cannot be, from any
 * camera that looks down at it.
 */
export const PROMPT = { toward: 1.5, height: 2.7 }

/**
 * The face of a board: the name large, the handle under it fitted to the width (never cut with an ellipsis),
 * and a ribbon with what it is for. Painted on the parchment the project boards use.
 */
function paintBoard(station: StationId, title: string, value: string, pending: boolean) {
  return (ctx: CanvasRenderingContext2D, r: Rect, t: PaintTools): void => {
    const { w, h } = r
    t.paintParchment(ctx, r, { seed: station, radius: h * 0.035 })
    const pad = h * 0.1
    const theme = t.theme
    const ribbon = { x: pad, y: pad * 0.8, w: 0, h: h * 0.13 }
    const kicker = t.fitText(ctx, KICKER[station].toUpperCase(), { maxWidth: w * 0.5, minPx: h * 0.06, maxPx: h * 0.085, weight: 600, family: t.fonts.mono, lineHeight: 1 })
    ribbon.w = Math.min(w - pad * 2, ctx.measureText(kicker.lines[0] ?? '').width + h * 0.22)
    t.paintRibbon(ctx, ribbon, theme.ribbon, theme.ribbonDeep)
    ctx.fillStyle = theme.ribbonInk
    t.drawFit(ctx, kicker, pad + h * 0.11, ribbon.y + ribbon.h / 2 - kicker.px * 0.5, 'left')
    const top = ribbon.y + ribbon.h + pad * 0.35
    const room = h - pad - top
    const name = t.fitText(ctx, title, { maxWidth: w - pad * 2, maxLines: 1, minPx: h * 0.14, maxPx: h * 0.4, weight: 700, family: t.fonts.sans, lineHeight: 1 })
    ctx.fillStyle = t.tokens.ink
    t.drawFit(ctx, name, pad, top, 'left')
    const sub = t.fitText(ctx, value, { maxWidth: w - pad * 2, maxLines: 1, minPx: h * 0.07, maxPx: h * 0.2, weight: pending ? 600 : 500, family: t.fonts.sans, lineHeight: 1 })
    ctx.fillStyle = pending ? t.tokens.terracottaDeep : t.tokens.ink2
    t.drawFit(ctx, sub, pad, top + Math.min(room - sub.height, name.height + h * 0.05), 'left')
  }
}

/* ============================================================
   THE CONTROLLER
   ============================================================ */

export class Social {
  readonly links: Link[] = []
  readonly group = new THREE.Group()
  /** The legacy plaza's fan prompt target. Unused once the plaza is arranged. */
  private fans: { node: THREE.Object3D; home: THREE.Vector3 } | null = null
  /** The letters standing where the .blend put somebody else's statue. */
  readonly monogram: THREE.Mesh[] = []
  /** The wooden boards, one per station (empty in a plaza that was not arranged). */
  readonly boards: Sign[] = []
  /** Where `arrange` put everything; null in a plaza that was not arranged. */
  readonly layout: SocialLayout | null

  constructor(private game: World2Game, private references: References, prompts: Prompts, bin: Bin) {
    this.group.name = 'World2 / social'
    const layout = this.layout = layoutOf(references.environment) ?? null
    if (layout) this.arranged(layout, prompts, bin)
    else this.legacy(prompts, bin)
    bin.object3D(this.group)
  }

  /* ---------------------------------------------------------------- the arranged plaza -- */

  private arranged(layout: SocialLayout, prompts: Prompts, bin: Bin): void {
    this.retire()
    this.references.suppress('refFan')
    const camera = () => (this.game.view as { camera?: THREE.Camera } | undefined)?.camera
    const materials: SignMaterials = signMaterials(this.references.environment.group)
    const runtime = new SignRuntime({ ticker: this.game.ticker as never, camera }, bin)
    bin.add(() => materials.dispose())

    for (const id of STATIONS) {
      const entry = contact.find(c => c.id === id)
      const seat = layout.seats[id]
      if (!entry || !seat?.node) continue
      const pending = isPending(entry)
      const href = pending ? null : entry.href.startsWith('/') ? new URL(entry.href, window.location.origin).toString() : entry.href

      // The board: behind the pad as the lens sees it, square to the lens. It is a physical sign (posts in the
      // ground), so it never turns to follow the camera; it faces the default one, and an orbit just walks round it.
      const sign = new Sign({
        id: `social-${id}`, variant: 'board', width: BOARD.width, height: BOARD.height, legHeight: BOARD.bottom, dpm: BOARD.dpm,
        title: entry.label, subtitle: shortValue(entry), kicker: KICKER[id], theme: BOARD_THEMES[id], emblem: null,
        materials, runtime, bin, paint: paintBoard(id, entry.label, shortValue(entry), pending),
      })
      // The kit points the group back at its Sign. That circle makes Object3D.clone() throw, and the Edit preview this
      // frame also serves as is cloned into an asset definition at startup; nothing reads it back.
      delete sign.group.userData.sign
      const at = towardLens(seat, layout.psi, -BOARD.behind)
      sign.group.position.set(at.x, 0, at.z)
      sign.group.rotation.order = 'YXZ'
      sign.group.rotation.set(-BOARD.lean, layout.psi, 0)
      this.group.add(sign.group)
      this.boards.push(sign)
      if (!camera()) this.paintPreview(sign, bin)
      this.boardBody(at, layout.psi, id)

      if (!pending && href) {
        const ahead = towardLens(seat, layout.psi, PROMPT.toward)
        prompts.create({
          label: entry.label, position: new THREE.Vector3(ahead.x, PROMPT.height, ahead.z), align: seat.angle < 0 ? 'left' : 'right',
          onInteract: () => this.open(entry.id, href),
        })
      }
      this.links.push({ id, label: entry.label, href, node: seat.node, sign: sign.group })
    }
    this.buildMonogram(layout.dais, layout.psi, PLAZA_MONOGRAM)
    this.declareArrival(layout, bin)
  }

  /**
   * Tells the map where a visitor who travels here is put down. Without it the nearest valid ground to the Contact place is the
   * path 7 m west of the plaza (the pads and boards, which stand where the authored respawn used to), and the first frame is an empty
   * road with one board at its edge. The poses are in world coordinates (the instance's frame turns and scales them): on the line from
   * the dais toward the lens, then a little to either side of it and farther out (`ARRIVAL.swings`, for a prop pushed onto the line).
   * The heading is the one that faces the dais from the lens; runtime/placement.js turns the car to face away from the chase camera
   * as it is at that moment (the two are the same until the player drags the camera round), takes the first pose that is valid then,
   * by the same rules as any arrival, and falls back to its own search when none is. Only the player runtime has a Placement on its
   * game: /world2 and the studio's previews have none, and nothing is declared there.
   */
  private declareArrival(layout: SocialLayout, bin: Bin): void {
    const points = (this.game as unknown as { placement?: ArrivalHost }).placement?.arrivalPoints
    const physics = this.game.physics as unknown as { point?(v: THREE.Vector3): THREE.Vector3; vector?(v: { x: number; y: number; z: number }): THREE.Vector3; scale?: number }
    if (!points || !physics.point || !physics.vector) return
    const lens = lensDirection(layout.psi)
    const away = physics.vector({ x: -lens.x, y: 0, z: -lens.z })
    const heading = Math.atan2(-away.z, away.x)
    const poses = arrivalSpots(layout.psi, layout.dais, physics.scale ?? 1).map(spot => {
      const at = physics.point!(new THREE.Vector3(spot.x, layout.dais.y, spot.z))
      return { x: at.x, z: at.z, heading }
    })
    const point: ArrivalPoint = { name: 'Contact', poses, dynamicMargin: ARRIVAL.dynamicMargin, reach: ARRIVAL.reach }
    points.add(point)
    bin.add(() => points.delete(point))
  }

  /**
   * No camera schedules a board's paint in an authoring preview (the studio's Edit preview, Simulate, the map's prefab). The world
   * builds this preview for every player too, at startup, and nobody there ever draws it: the player waits for the one frame, when
   * the face is first drawn. The studio does not wait: the preview it builds for the asset library is never drawn itself (the asset
   * definition is cloned from it, and Edit Source Asset from that), and a clone carries no draw hook, so the Source Asset scene would
   * show blank parchment. There the board is painted now (about half a millisecond each), and again when the fonts arrive.
   */
  private paintPreview(sign: Sign, bin: Bin): void {
    const face = sign.face
    if (!face) return
    if (document.body?.dataset.player === 'true') {
      face.onBeforeRender = () => { face.onBeforeRender = () => {}; sign.paintNow() }
      return
    }
    sign.paintNow()
    bin.add(onSignFontsLoaded(() => sign.paintNow()))
  }

  /**
   * The board is a sign in the ground: two posts and a face, leaning with the group. The face is 2.5 g off the ground, so
   * a car drives under it between the posts like a gate, and it does not drive through either of them.
   */
  private boardBody(at: Spot, psi: number, id: StationId): void {
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-BOARD.lean, psi, 0, 'YXZ'))
    // The kit's posts are 0.14 g square and stand 0.11 g outside the face's edge; they are as tall as leg + face + 0.2.
    const postX = BOARD.width / 2 + 0.11, postHalfHeight = (BOARD.bottom + BOARD.height + 0.2) / 2
    const post = (side: number) => ({ shape: 'cuboid' as const, parameters: [0.09, postHalfHeight, 0.09], position: new THREE.Vector3(side * postX, postHalfHeight, -0.01), category: 'object' as const })
    const face = { shape: 'cuboid' as const, parameters: [BOARD.width / 2 + 0.1, BOARD.height / 2 + 0.1, 0.08], position: new THREE.Vector3(0, BOARD.bottom + BOARD.height / 2, 0), category: 'object' as const }
    const physical = this.game.physics.add({
      type: 'fixed', position: new THREE.Vector3(at.x, 0, at.z), rotation, colliders: [post(-1), post(1), face],
      friction: 0.6, restitution: 0.1, owner: `social-board-${id}`,
    })
    this.references.environment.anchor(physical)
  }

  /* ---------------------------------------------------------------- the plaza as it always was -- */

  private legacy(prompts: Prompts, bin: Bin): void {
    const references = this.references
    const centre = references.position('refCenter')
    /*
      The CV has no icon in the .blend, so it takes a seat on the arc the
      authored icons describe. It used to take the NEXT one past the last owned
      icon, which put it 1.7 m from Bluesky's plinth — inside the 2.5 m a
      prompt answers from, so the "Curriculum Vitae" plate read as Bluesky's
      label. With Bluesky and the rest retired there is a better seat going:
      the plinth Twitch vacated, which puts the four real links in one
      unbroken run round the arc.
    */
    const spare = references.position('twitchPhysicalDynamic') ?? this.nextOnArc(centre)
    const plates: THREE.Mesh[] = []

    for (const entry of contact) {
      const iconName = ICONS[entry.id]
      const node = iconName ? references.node(iconName) : null
      const anchor = node?.getWorldPosition(new THREE.Vector3()) ?? spare
      if (!anchor) continue
      const href = entry.href.startsWith('/') ? new URL(entry.href, window.location.origin).toString() : entry.href

      const sign = this.buildSign(entry.label, entry.value)
      sign.position.copy(anchor).add(new THREE.Vector3(0, 1.35, 0))
      this.group.add(sign)
      plates.push(sign)

      prompts.create({
        label: entry.label, position: anchor.clone().setY(Math.max(1, anchor.y)), align: 'right',
        onInteract: () => this.open(entry.id, href),
      })
      this.links.push({ id: entry.id, label: entry.label, href, node: node ?? sign, sign })
    }

    this.retire()
    this.buildMonogram(centre)
    this.buildFans(prompts)

    // The plates turn to whoever is reading them. An icon you can drive round should not have a back you cannot read.
    // This is the /world2 route's plaza (its chase camera follows the car, and it has no gameplay camera to hand to
    // Billboards): the plates face the car exactly as they always did, as a yaw about the vertical, which is all
    // Object3D.lookAt made of a target at the plate's own height. /world gets here only with a level `arrange` does not
    // recognise (a re-export that renamed a node); its plaza is otherwise arranged for its camera, with physical boards.
    const reach = 34
    const tick = () => {
      const player = this.game.player.position
      for (const sign of plates) {
        const near = Math.hypot(player.x - sign.position.x, player.z - sign.position.z) <= reach
        sign.visible = near
        if (near) sign.rotation.y = yawToward(sign.position, player)
      }
    }
    this.game.ticker.events.on('tick', tick, 12)
    bin.add(() => this.game.ticker.events.off('tick', tick))

    bin.add(() => {
      for (const sign of plates) {
        sign.geometry.dispose()
        const material = sign.material as THREE.MeshBasicMaterial
        material.map?.dispose()
        material.dispose()
      }
    })
  }

  /**
   * Takes the retired props out of the picture. Their bodies were never built
   * — `reservedNames` saw to that — so all that is left is to stop drawing
   * them, which also keeps them out of the scenery merge: that pass runs after
   * this one and skips anything already invisible.
   */
  private retire(): void {
    for (const name of RETIRED) this.references.suppress(name)
  }

  /**
   * The monogram on the dais. Two letters stacked, cut from Geist Bold the
   * same way the name on the beach is, sized so the pair fills the volume the
   * authored statue stood in: 1.74 m wide, 1.78 m deep, 4.52 m tall.
   *
   * It is a FIXED body rather than a dynamic one. The name on the beach is
   * meant to be knocked over — that is its whole joke — but a monument you can
   * shove off its plinth is just litter, and the plaza is where the contact
   * details live.
   *
   * `facing` is the yaw of the letters' front. An arranged plaza passes the
   * one that turns them onto the lens; the legacy plaza turns them south.
   * `scale` shrinks the pair about its base: the arranged plaza stands them
   * at 80% (3.6 m), because the lens looks across the whole plaza at 41
   * degrees and at the full 4.52 m the top of the A is cut by the frame at
   * the plaza's mouth, on a laptop screen, with the car in front of the dais.
   */
  private buildMonogram(centre: THREE.Vector3 | null, facing = Math.PI, scale = 1): void {
    const statue = this.references.node('refStatuePhysicalDynamic')
    if (!centre || !statue) return
    statue.updateWorldMatrix(true, true)
    const volume = new THREE.Box3().setFromObject(statue)
    const size = volume.getSize(new THREE.Vector3()).multiplyScalar(scale)
    const base = volume.min.y

    // Two lines of one letter: the cap height is whatever divides the authored
    // height between them, leading included.
    const leading = 1.18
    const capHeight = size.y / (MONOGRAM.length * leading)
    const cut = MONOGRAM.map(char => cutGlyph(char, capHeight, Math.min(size.z, capHeight * 0.42)))
      .filter((glyph): glyph is NonNullable<typeof glyph> => !!glyph)
    if (cut.length !== MONOGRAM.length) return

    // The palette texture gives the level's props their flat colour through a
    // single texel, so the monogram is cut from the same stone the statue was:
    // its material, and the texel that statue used for most of its surface.
    const source = statue instanceof THREE.Mesh ? statue : statue.children.find(child => child instanceof THREE.Mesh) as THREE.Mesh | undefined
    const material = source
      ? (Array.isArray(source.material) ? source.material[0] : source.material)
      : new THREE.MeshStandardMaterial({ color: '#fff2e8' })
    const uv = modalUv(source) ?? new THREE.Vector2(0.73563, 0.5)

    cut.forEach((glyph, index) => {
      paintUv(glyph.geometry, uv)
      const mesh = new THREE.Mesh(glyph.geometry, material)
      mesh.name = glyph.char
      mesh.castShadow = true
      mesh.receiveShadow = true
      const row = MONOGRAM.length - 1 - index
      const height = glyph.box.max.y - glyph.box.min.y
      mesh.position.set(
        centre.x,
        base + row * capHeight * leading + height / 2 + capHeight * 0.09,
        centre.z,
      )
      mesh.rotation.y = facing
      this.group.add(mesh)
      this.monogram.push(mesh)

      // One cuboid per letter, on the letter's own box. A capital A is mostly
      // air, but a car that clips its serif and carries on looks broken.
      const half = new THREE.Vector3(
        (glyph.box.max.x - glyph.box.min.x) / 2,
        height / 2,
        (glyph.box.max.z - glyph.box.min.z) / 2,
      )
      const physical = this.game.physics.add({
        type: 'fixed', position: mesh.position.clone(),
        rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, facing, 0)),
        colliders: [{ shape: 'cuboid', parameters: [half.x, half.y, half.z], category: 'object' }],
        friction: 0.6, restitution: 0.1, owner: `monogram-${glyph.char}`,
      })
      // Immovable means immovable to the solver too. See World2Environment.
      this.references.environment.anchor(physical)
    })
  }

  /** The next free seat on the arc the authored icons already describe. */
  private nextOnArc(centre: THREE.Vector3 | null): THREE.Vector3 | null {
    if (!centre) return null
    const seats = Object.values(ICONS)
      .map(name => this.references.node(name)?.getWorldPosition(new THREE.Vector3()))
      .filter((p): p is THREE.Vector3 => !!p)
      .map(p => ({ angle: Math.atan2(p.z - centre.z, p.x - centre.x), radius: Math.hypot(p.x - centre.x, p.z - centre.z), y: p.y }))
      .sort((a, b) => a.angle - b.angle)
    if (!seats.length) return centre.clone().add(new THREE.Vector3(0, 1.6, 0))
    const radius = seats.reduce((sum, seat) => sum + seat.radius, 0) / seats.length
    const y = seats.reduce((sum, seat) => sum + seat.y, 0) / seats.length
    const gap = seats.length > 1 ? (seats[seats.length - 1].angle - seats[0].angle) / (seats.length - 1) : 0.5
    const angle = seats[seats.length - 1].angle + gap
    return new THREE.Vector3(centre.x + Math.cos(angle) * radius, y, centre.z + Math.sin(angle) * radius)
  }

  /** A small world-space plate so the icon says what it is without a modal. */
  private buildSign(label: string, value: string): THREE.Mesh {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 160
    const context = canvas.getContext('2d')!
    context.fillStyle = 'rgba(35,31,43,0.92)'
    context.beginPath()
    context.roundRect(6, 26, 500, 104, 26)
    context.fill()
    context.textAlign = 'center'
    context.fillStyle = '#f4f1e8'
    context.font = '700 44px ui-sans-serif, system-ui, sans-serif'
    context.fillText(label.toUpperCase(), 256, 76)
    context.fillStyle = '#9b94a8'
    context.font = '500 28px ui-monospace, SFMono-Regular, monospace'
    let text = value
    while (context.measureText(text).width > 460 && text.length > 8) text = `${text.slice(0, -4)}…`
    context.fillText(text, 256, 114)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.9, 0.59),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    )
    mesh.renderOrder = 4
    return mesh
  }

  private open(id: string, href: string): void {
    this.game.audio.play('interact')
    this.game.interactions?.achievements.mark('social', id)
    if (/^mailto:/i.test(href)) {
      // A new tab for a mail link leaves a blank one behind in some browsers; an anchor click hands it to the mail app.
      const anchor = document.createElement('a')
      anchor.href = href
      anchor.rel = 'noopener noreferrer'
      anchor.click()
      return
    }
    window.open(href, '_blank', 'noopener,noreferrer')
  }

  /**
   * The authored fan pad. Upstream pops a pooled rigid body out of it; the
   * joke was a pun on an account name, so what is kept here is the physical
   * toy — a prop that leaps when you press it — and not the caption.
   */
  private buildFans(prompts: Prompts): void {
    const pad = this.references.node('refFan')
    if (!pad) return
    const home = pad.getWorldPosition(new THREE.Vector3())
    // Upstream anchors this prompt on `refOnlyFans`, the empty beside the
    // logo, because the logo was the joke. With the logo gone the prompt would
    // float over bare grass, so it stands on the fan it actually works.
    this.fans = { node: pad, home }
    prompts.create({
      label: 'Give it a spin', position: home.clone().setY(Math.max(1, home.y)), align: 'left',
      onInteract: () => {
        // Everything loose on the pad gets a hop. Upstream popped a pooled
        // prop out of a spawn box; this uses the props the level already has.
        this.game.audio.play('blip', 0.8)
        const centre = this.fans!.home
        for (const { physical } of this.references.environment.dynamic) {
          const at = physical.body.translation()
          if (Math.hypot(at.x - centre.x, at.z - centre.z) > 5) continue
          physical.body.wakeUp()
          physical.body.applyImpulse({ x: (Math.random() - 0.5) * physical.body.mass(), y: 3.2 * physical.body.mass(), z: (Math.random() - 0.5) * physical.body.mass() }, true)
        }
      },
    })
  }

  get found(): number { return this.links.length }
}
