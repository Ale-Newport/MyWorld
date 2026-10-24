import * as THREE from 'three'

/* ============================================================
   FOCUS CAMERA — A POSE THAT SEES THE SCREEN

   A board that takes the camera over (the Projects board) picks a pose from its own geometry: a fixed line from the screen,
   a distance that makes the screen fill the window. That pose knows nothing about the island around it, and on a phone in
   portrait it stands 18 m away from the board on a line that, in the Ice Rink's corner, ends inside a pine: every pixel
   was needle green and the board could not be seen.

   clearFocusPose() takes the pose the board asked for and asks the world whether the screen can be SEEN from it: rays
   from the camera to a set of points on the screen (its middle, its edges, a ring just outside its corners), and four
   rays through the corners of the picture that must not meet anything within a couple of metres of the lens (a trunk
   beside the camera fills the frame as surely as one in front of it). If the pose is clear it is returned untouched.
   If not, poses on the same sphere around the screen are tried nearest first (a little higher, a little to one side, a
   little closer), and the first that sees every point wins. Nothing in the scene is hidden, faded or moved: the camera
   goes round the tree, which is what a person holding a phone up to a sign would do.

   Cost: the meshes near the sight lines are collected once (collectOccluders, about a millisecond for a 15,000-node
   world) and a ray costs about 0.2 ms against them, so a focus that finds the first pose blocked spends a few
   milliseconds, once, when it opens. The worst case is bounded by a COUNT of poses (maxTests), never by the clock: the
   answer must not depend on how fast the device is, and a slow phone is exactly where a blocked pose (a screen of
   pine green) matters most. When nothing is clear (a screen walled in by foliage) the pose that was asked for is kept,
   as before.
   ============================================================ */

export interface Occluder { mesh: THREE.Mesh; sphere: THREE.Sphere }

/** More triangles than this is the ground or the sea (135,000 here), which the camera floats above; the trees are 40. */
const MAX_TRIANGLES = 20000
/** The camera never looks down steeper than this (radians) however far it is raised: a screen is read from the side, not from a drone. */
const MAX_ELEVATION = (68 * Math.PI) / 180

const RAY = new THREE.Raycaster()
const HITS: THREE.Intersection[] = []
const A = new THREE.Vector3()
const B = new THREE.Vector3()
const C = new THREE.Vector3()

const materialsOf = (mesh: THREE.Mesh): THREE.Material[] => (Array.isArray(mesh.material) ? mesh.material : [mesh.material])

/** A mesh the player can see, as a thing that stands in the way: drawn, solid, not the ground and not the water. */
function counts(mesh: THREE.Mesh): boolean {
  const geometry = mesh.geometry
  const position = geometry?.attributes?.position
  if (!position || !mesh.layers.isEnabled(0)) return false
  const triangles = geometry.index ? geometry.index.count / 3 : position.count / 3
  if (triangles > MAX_TRIANGLES) return false
  const data = mesh.userData
  if (data.waterSurface || data.sea) return false
  return materialsOf(mesh).some(m => m && m.visible !== false && !(m.transparent && m.opacity < 0.35) && m.colorWrite !== false)
}

/**
 * The meshes within `reach` metres of `around` that could stand between a camera and what it looks at: visible, drawn,
 * not under `ignore` (the board itself, the car), neither ground nor water. Their world bounding spheres are taken now,
 * which is right for a world that does not move around a focused board.
 */
export function collectOccluders(root: THREE.Object3D, around: THREE.Vector3, reach: number, ignore: ReadonlyArray<THREE.Object3D | null | undefined> = []): Occluder[] {
  const found: Occluder[] = []
  const walk = (node: THREE.Object3D): void => {
    if (!node.visible || ignore.includes(node)) return
    const mesh = node as THREE.Mesh
    if (mesh.isMesh && counts(mesh)) {
      let sphere: THREE.Sphere | null
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
        const instanced = mesh as THREE.InstancedMesh
        if (!instanced.boundingSphere) instanced.computeBoundingSphere()
        sphere = instanced.boundingSphere
      } else {
        if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere()
        sphere = mesh.geometry.boundingSphere
      }
      if (sphere) {
        const world = sphere.clone().applyMatrix4(mesh.matrixWorld)
        if (world.distanceToPoint(around) <= reach) found.push({ mesh, sphere: world })
      }
    }
    for (let i = 0; i < node.children.length; i++) walk(node.children[i])
  }
  walk(root)
  return found
}

/** Whether anything in `occluders` is on the segment from `from` towards `to`, within `length` of `from`. */
function meets(from: THREE.Vector3, direction: THREE.Vector3, length: number, occluders: ReadonlyArray<Occluder>): boolean {
  RAY.ray.origin.copy(from)
  RAY.ray.direction.copy(direction)
  RAY.near = 0
  RAY.far = length
  for (let i = 0; i < occluders.length; i++) {
    const { mesh, sphere } = occluders[i]
    if (!RAY.ray.intersectsSphere(sphere)) continue
    HITS.length = 0
    mesh.raycast(RAY, HITS)
    if (HITS.length) { HITS.length = 0; return true }
  }
  return false
}

export interface ClearPoseOptions {
  /** Where the camera looks (the middle of the screen), world coordinates. */
  target: THREE.Vector3
  /** The pose the board asked for. */
  position: THREE.Vector3
  /** Points of the screen that must be seen, the middle first, then its edges and a ring just outside its corners. */
  samples: ReadonlyArray<THREE.Vector3>
  occluders: ReadonlyArray<Occluder>
  /**
   * Things that can hide the screen but are not the world's: the player's own car, parked in front of the board. The rays to the screen
   * count them, so the camera rises or swings to see over or past the car; the lens clearance does not (the car is never at the lens).
   */
  vehicle?: ReadonlyArray<Occluder>
  /** Vertical field of view in degrees, and width / height: the picture's corners are the clearance rays. */
  fov: number
  ratio: number
  /** Metres in front of a sample that do not count as in the way: the board's own frame, ropes, a car at its foot. */
  tolerance?: number
  /** Metres around the lens that must be free along the picture's corners. */
  clearance?: number
  /** The most the camera may swing round the screen (degrees of azimuth) and rise above the pose asked for. */
  maxYaw?: number
  maxPitch?: number
  /**
   * The most poses the search may examine, the asked-for one included. A count, not a time: the pose chosen is the same on every device,
   * however slow (the whole candidate list is 154 poses; the first dozen cover every raise and swing worth making, and a typical blocked pine is cleared by the second or third).
   */
  maxTests?: number
}

export interface ClearPose {
  position: THREE.Vector3
  /** The pose sees every sample and has the lens free. False when nothing did and the asked-for pose is returned. */
  clear: boolean
  moved: boolean
  /** Degrees swung round the screen and raised, and the factor on the distance, of the pose chosen. */
  yaw: number
  pitch: number
  scale: number
  /** Poses examined (the asked-for one included). */
  tested: number
}

interface Candidate { yaw: number; pitch: number; scale: number; cost: number }

/** Nearest first: raising the camera costs the screen next to nothing on a phone (it is tall and the screen is wide and short), swinging it
 * foreshortens the screen and so costs more, coming closer fills more of the width and is allowed only a little. */
const YAW = 6
const PITCH = 5
const CLOSER = 0.94
const PITCH_COST = 0.5
const CLOSER_COST = 7
/** Poses examined at most (the asked-for one included): a count so the answer never depends on the clock. Of the 154 candidates the nearest 60 reach 30 degrees up, 18 to either side and include 23 of the closer ones; they are all examined at about 0.2 ms a ray when the first pose is blocked. */
const MAX_TESTS = 60

function candidates(maxYaw: number, maxPitch: number): Candidate[] {
  const list: Candidate[] = []
  for (const scale of [1, CLOSER]) {
    for (let pitch = 0; pitch <= maxPitch + 1e-6; pitch += PITCH) {
      for (let yaw = 0; yaw <= maxYaw + 1e-6; yaw += YAW) {
        for (const side of yaw === 0 ? [1] : [1, -1]) {
          const cost = yaw + pitch * PITCH_COST + (scale < 1 ? CLOSER_COST : 0)
          list.push({ yaw: yaw * side, pitch, scale, cost })
        }
      }
    }
  }
  // Stable for equal costs: the smaller swing first, then the positive side, so the choice never depends on iteration order.
  return list.sort((a, b) => a.cost - b.cost || Math.abs(a.yaw) - Math.abs(b.yaw) || b.yaw - a.yaw)
}

export function clearFocusPose(options: ClearPoseOptions): ClearPose {
  const { target, position, samples, occluders } = options
  const vehicle = options.vehicle ?? []
  const tolerance = options.tolerance ?? 0.5
  const clearance = options.clearance ?? 2
  const maxYaw = options.maxYaw ?? 30
  const maxPitch = options.maxPitch ?? 30
  const maxTests = options.maxTests ?? MAX_TESTS
  const tanV = Math.tan((options.fov * Math.PI) / 360), tanH = tanV * options.ratio

  const offset = position.clone().sub(target)
  const distance = offset.length()
  const yaw0 = Math.atan2(offset.x, offset.z)
  const pitch0 = Math.asin(THREE.MathUtils.clamp(offset.y / distance, -1, 1))
  const where = new THREE.Vector3()
  const forward = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3()
  const UP = new THREE.Vector3(0, 1, 0)

  /** How many of the rays are clear before the first one that is not (the full count means the pose is clear). */
  const probe = (at: THREE.Vector3): number => {
    let clear = 0
    for (let i = 0; i < samples.length; i++) {
      A.copy(samples[i]).sub(at)
      const length = A.length()
      if (length > tolerance) {
        A.multiplyScalar(1 / length)
        if (meets(at, A, length - tolerance, occluders) || (vehicle.length > 0 && meets(at, A, length - tolerance, vehicle))) return clear
      }
      clear++
    }
    // The lens: the picture's four corners, nothing within `clearance` of the camera.
    forward.copy(target).sub(at).normalize()
    right.crossVectors(forward, UP)
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0)
    right.normalize()
    up.crossVectors(right, forward)
    for (let corner = 0; corner < 4; corner++) {
      const x = corner & 1 ? 0.9 : -0.9, y = corner & 2 ? 0.9 : -0.9
      B.copy(forward).addScaledVector(right, x * tanH).addScaledVector(up, y * tanV).normalize()
      if (meets(at, B, clearance, occluders)) return clear
      clear++
    }
    return clear
  }
  const total = samples.length + 4

  const first = probe(position)
  let tested = 1
  if (first === total) return { position: position.clone(), clear: true, moved: false, yaw: 0, pitch: 0, scale: 1, tested }

  // Nothing clear yet: the pose that got furthest is remembered for a world where nothing is clear (a screen walled in by foliage).
  let best: { score: number; where: THREE.Vector3; candidate: Candidate } | null = null
  for (const candidate of candidates(maxYaw, maxPitch)) {
    if (candidate.cost === 0) continue
    if (tested >= maxTests) break
    const yaw = yaw0 + (candidate.yaw * Math.PI) / 180
    const pitch = Math.min(pitch0 + (candidate.pitch * Math.PI) / 180, MAX_ELEVATION)
    const cosPitch = Math.cos(pitch)
    C.set(Math.sin(yaw) * cosPitch, Math.sin(pitch), Math.cos(yaw) * cosPitch)
    where.copy(target).addScaledVector(C, distance * candidate.scale)
    const score = probe(where)
    tested++
    if (score === total) return { position: where.clone(), clear: true, moved: true, yaw: candidate.yaw, pitch: candidate.pitch, scale: candidate.scale, tested }
    if (score > first && (!best || score > best.score)) best = { score, where: where.clone(), candidate }
  }
  // Only a real improvement over the asked-for pose moves the camera.
  if (best) return { position: best.where, clear: false, moved: true, yaw: best.candidate.yaw, pitch: best.candidate.pitch, scale: best.candidate.scale, tested }
  return { position: position.clone(), clear: false, moved: false, yaw: 0, pitch: 0, scale: 1, tested }
}
