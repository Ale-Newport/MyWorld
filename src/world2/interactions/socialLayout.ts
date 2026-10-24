import * as THREE from 'three'

/* ============================================================
   THE PLAZA'S MATHS, WITHOUT THE LEVEL

   /world has ONE gameplay camera with a fixed azimuth (45°, from
   the south-east, whatever the car does), and the Social instance
   sits in a frame the world document rotated (−60° here) and
   scaled (0.7). The level was authored for a different camera, so
   the icons' fronts, the monogram and the arc of pads all face the
   wrong way. Everything below answers one question — "where does a
   thing go so it reads from THAT lens?" — in plain numbers, so it
   can be tested without a browser and without the 17 MB level.

   Two frames:
     L  the frame-local one the level is built in ("g" units; the
        instance is scaled, so a world metre is 0.7 g here).
     P  the plaza frame, aligned to the lens: x runs to the RIGHT of
        the screen, z runs TOWARD the camera, origin on the dais.

   psi turns L's +z onto the lens: psi = camera azimuth − frame yaw.
   An object whose front is +z and whose rotation.y is psi faces
   the camera exactly.
   ============================================================ */

export const DEG = Math.PI / 180

export const PLAZA = Object.freeze({
  /** Distance of every station from the dais, in g (4.9 m). A smile: the arc bows toward the lens. */
  radius: 7.0,
  /** Degrees off the camera-facing axis, left to right on the screen. Wider arcs push an inner board over the next icon. */
  angles: [-68, -24, 24, 68] as readonly number[],
  /** XZ growth of an authored 1.69 g pad. The curb height stays what it was, so driving over it feels the same. */
  padScale: 1.3,
  /** Growth of the icons that stand on them. */
  iconScale: 1.3,
  /** Height of an authored pad's top surface, in g. */
  padTop: 0.47,
  /** A piece of the pad mesh belongs to an icon when its centre is within this many g of it. */
  ownerReach: 2,
  /** A piece is the dais when its centre is within this many g of refCenter. */
  daisReach: 0.3,
})

export interface Slot { x: number; z: number; angle: number }
export interface Spot { x: number; z: number }

/**
 * Where a car arriving from the M map is put down (runtime/placement.js reads these as the plaza's own declared arrival).
 *
 * The four stations read best from the lens when the car stands on the line from the dais to the lens, between the two
 * inner pads and facing the dais: all four boards, the monogram and the car are then in one frame on a laptop, and the two
 * inner stations and the monogram are on a portrait phone. 5.5 m is as close as it goes (at 5 m the car is inside the 0.8 m
 * the pads are cleared by) and the boards then sit lowest in the frame, clear of the HUD's pills; the others are the same line
 * further out, for the day something has been pushed into the first (7 m already cuts the outer boards on a laptop). Distances
 * are in world metres from the dais.
 *
 * `dynamicMargin` is the clearance from bodies that move, and it has to leave room for them to settle: the first arrival wakes the
 * props, and the LinkedIn icon's thin collider then sinks 2-3 cm. The 5.5 m and 6 m poses clear the icons by 0.50 m at rest, so a
 * margin of 0.5 passed at rest and failed after one arrival (and every later arrival landed 1 m further out). 0.3 m keeps 0.17 m of
 * slack; the car, which is put down 0.5 m or more from the icons' colliders at rest and 0.47 m after they settled, stays as far.
 *
 * `swings` are what is tried when something has been pushed onto the axis (a mailbox is the prop that gets there): the same
 * kind of spot, a little to one side of the line, farther out, so the arrival is still on the plaza's lens side and never falls
 * back to the path west of it. `[metres from the dais, degrees from the lens axis]`, nearest first.
 */
export const ARRIVAL = Object.freeze({
  distances: [5.5, 6, 6.5, 7, 8] as readonly number[],
  swings: [[7.5, -14], [7.5, 12], [8, -12], [8, 12], [9, -12], [9, 12], [10, -18], [10, 18]] as readonly (readonly [number, number])[],
  /** Clearance (m) the car keeps from anything that moves: the icons' pads are 2.4 m apart and the car is 1.8 m wide. */
  dynamicMargin: 0.3,
  /** A target (the Contact place, or the GitHub, LinkedIn and Email prompts) this many metres from the first spot is served by it. */
  reach: 14,
})

/**
 * The arrival spots in L (g), nearest the dais first: on the dais's line toward the lens, then the swings to either side of it.
 * `scale` is the instance's metres per g.
 */
export function arrivalSpots(psi: number, dais: Spot, scale: number, distances: readonly number[] = ARRIVAL.distances, swings: readonly (readonly [number, number])[] = ARRIVAL.swings): Spot[] {
  const along = distances.map(metres => towardLens(dais, psi, metres / (scale || 1)))
  const aside = swings.map(([metres, degrees]) => towardLens(dais, psi + degrees * DEG, metres / (scale || 1)))
  return [...along, ...aside]
}

/** The yaw about the vertical that points a plate's +z from `from` at `to`: what Object3D.lookAt makes of a target at the plate's own height. */
export const yawToward = (from: Spot, to: Spot): number => Math.atan2(to.x - from.x, to.z - from.z)

/** Where each station stands in P, relative to the dais. */
export function slots(options: { radius?: number; angles?: readonly number[] } = {}): Slot[] {
  const radius = options.radius ?? PLAZA.radius
  const angles = options.angles ?? PLAZA.angles
  return angles.map(angle => ({ x: radius * Math.sin(angle * DEG), z: radius * Math.cos(angle * DEG), angle }))
}

/** P (x right, z toward the camera) to frame-local XZ. */
export function plazaToLocal(p: Spot, psi: number, origin: Spot): Spot {
  const c = Math.cos(psi), s = Math.sin(psi)
  return { x: origin.x + p.x * c + p.z * s, z: origin.z - p.x * s + p.z * c }
}

/** The horizontal direction from the plaza to the lens, in L. */
export const lensDirection = (psi: number): Spot => ({ x: Math.sin(psi), z: Math.cos(psi) })

/** The yaw of a frame: where its +z points, seen from above. Pitch and roll are ignored. */
export function yawOf(rotation: THREE.Quaternion): number {
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation)
  return Math.atan2(forward.x, forward.z)
}

/** psi: the yaw that turns the frame's +z onto a camera at `theta` (the View's azimuth). */
export const lensYaw = (theta: number, rotation: THREE.Quaternion | null | undefined): number => theta - (rotation ? yawOf(rotation) : 0)

/** A point `distance` g from `spot`, toward the lens (positive) or away from it (negative). */
export function towardLens(spot: Spot, psi: number, distance: number): Spot {
  const d = lensDirection(psi)
  return { x: spot.x + d.x * distance, z: spot.z + d.z * distance }
}

/* ---------------------------------------------------------------- the merged pad mesh -- */

export interface Piece {
  /** Index of the first vertex of each triangle, into the index buffer. */
  triangles: number[]
  vertices: Set<number>
  box: THREE.Box3
}

/**
 * The connected pieces of one indexed mesh. The export duplicates vertices per face, so connectivity is by POSITION
 * (welded to a thousandth), which is what makes ten separate pads in one merged mesh come apart again.
 */
export function splitPieces(geometry: THREE.BufferGeometry): Piece[] {
  const position = geometry.getAttribute('position')
  const index = geometry.index?.array
  if (!index) return []
  const key = (i: number): string => `${position.getX(i).toFixed(3)},${position.getY(i).toFixed(3)},${position.getZ(i).toFixed(3)}`
  const parent = new Map<string, string>()
  const find = (a: string): string => {
    while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a)!)!); a = parent.get(a)! }
    return a
  }
  for (let i = 0; i < position.count; i++) { const k = key(i); if (!parent.has(k)) parent.set(k, k) }
  for (let t = 0; t < index.length; t += 3) {
    const a = find(key(index[t]))
    for (let j = 1; j < 3; j++) { const b = find(key(index[t + j])); if (a !== b) parent.set(b, a) }
  }
  const pieces = new Map<string, Piece>()
  for (let t = 0; t < index.length; t += 3) {
    const root = find(key(index[t]))
    let piece = pieces.get(root)
    if (!piece) pieces.set(root, piece = { triangles: [], vertices: new Set(), box: new THREE.Box3() })
    piece.triangles.push(t)
    for (let j = 0; j < 3; j++) {
      const v = index[t + j]
      piece.vertices.add(v)
      piece.box.expandByPoint(new THREE.Vector3(position.getX(v), position.getY(v), position.getZ(v)))
    }
  }
  return [...pieces.values()]
}

export interface Keeper { index: number; id: string }

/**
 * Which pieces of the pad mesh the plaza keeps: the dais, and for each contact the pad nearest its icon (within
 * `reach`). Everything else — the pads of accounts this portfolio does not have, and the one by the fan — falls out by
 * elimination, so a different number of pads in a re-exported level cannot keep a ghost. `centres` and `anchors` share
 * one space. Returns null when the level is not the one this was written for (the caller then leaves the arc alone).
 */
export function selectKeepers(
  centres: readonly Spot[], dais: Spot, anchors: Record<string, Spot>,
  { daisReach = PLAZA.daisReach, ownerReach = PLAZA.ownerReach }: { daisReach?: number; ownerReach?: number } = {},
): Keeper[] | null {
  const keep: Keeper[] = []
  const taken = new Set<string>()
  centres.forEach((c, index) => {
    if (Math.hypot(c.x - dais.x, c.z - dais.z) < daisReach) { keep.push({ index, id: 'dais' }); return }
    let best: string | null = null
    let bestDistance = ownerReach
    for (const [id, p] of Object.entries(anchors)) {
      const d = Math.hypot(p.x - c.x, p.z - c.z)
      if (d < bestDistance) { bestDistance = d; best = id }
    }
    if (best) keep.push({ index, id: best })
  })
  for (const keeper of keep) taken.add(keeper.id)
  // Exactly one dais and one pad per anchor, or this is not the level the surgery was written for.
  if (keep.length !== 1 + Object.keys(anchors).length || taken.size !== keep.length) return null
  return keep
}

/**
 * The height things stand on in one piece of the pad mesh: where most of its upward-facing area is. A pad is a raised
 * rim round a recessed tile (0.473 and 0.427 g in the level), and an icon stands on the tile, not on the rim.
 * Heights are in the mesh's own space; `bin` is how close two heights must be to count as one surface.
 */
export function standingLevel(geometry: THREE.BufferGeometry, piece: Piece, bin = 0.005): number {
  const position = geometry.getAttribute('position')
  const index = geometry.index!.array
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), normal = new THREE.Vector3()
  const levels = new Map<number, { area: number; weighted: number }>()
  for (const t of piece.triangles) {
    a.fromBufferAttribute(position, index[t]); b.fromBufferAttribute(position, index[t + 1]); c.fromBufferAttribute(position, index[t + 2])
    const mean = (a.y + b.y + c.y) / 3
    normal.crossVectors(b.sub(a), c.sub(a))
    const area = normal.length() / 2
    if (area <= 0 || normal.y / (2 * area) < 0.9) continue
    const key = Math.round(mean / bin)
    const level = levels.get(key) ?? { area: 0, weighted: 0 }
    level.area += area
    level.weighted += area * mean
    levels.set(key, level)
  }
  let best: { area: number; weighted: number } | null = null
  for (const level of levels.values()) if (!best || level.area > best.area) best = level
  return best ? best.weighted / best.area : piece.box.max.y
}

/**
 * The yaw an authored pad was built at: pads sit tangent to the arc, so it is the angle of the pad round the dais,
 * in three's Ry convention (positive turns +z toward +x).
 */
export const authoredYaw = (centre: Spot, dais: Spot): number => Math.atan2(-(centre.z - dais.z), centre.x - dais.x)

/** Moves a piece centred on `centre` to `target`, turned by `turn` about its own centre and grown `scale` in XZ. */
export function pieceMatrix(centre: Spot, target: Spot, turn: number, scale: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeTranslation(target.x, 0, target.z)
    .multiply(new THREE.Matrix4().makeRotationY(turn))
    .multiply(new THREE.Matrix4().makeScale(scale, 1, scale))
    .multiply(new THREE.Matrix4().makeTranslation(-centre.x, 0, -centre.z))
}
