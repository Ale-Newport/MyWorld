import * as THREE from 'three'
import { chamferedBox, strutGeometry, wheelGeometry } from './geometry'
import { DECOR_KINDS, type DecorKind, type DecorShape } from '@/content/world-decor'

/* ============================================================
   DECORATION GEOMETRY

   Fourteen procedural shapes, and each one is authored TOGETHER
   WITH ITS COLLIDER, in the same function, in the same frame.
   `rampGeometry` already sets that precedent for exactly this
   reason: the wedge and the convex hull Rapier is given are the
   same eight points, so a change to one cannot leave the other
   behind. Every collider below is a box, a cylinder or a ball
   chosen to match what the mesh looks like from a car — never a
   trimesh, which is the house rule in `Landmarks.ts`.

   TWO CONVENTIONS, AND BOTH MATTER.

   The origin of every geometry is the middle of its BASE, y = 0
   at the ground. `Props.add(kind, x, y, z)` treats `y` as the
   elevation of that base and the collider's own offset lifts the
   body's centre; get it wrong and a prop is buried or floating,
   and neither is visible until someone drives at it.

   And the collider on a tall thin thing is deliberately WIDER
   than the thing. A 0.1 m pole with a 0.1 m collider falls over
   the instant it is set down on ground with any slope at all, and
   the whole island has slope. The parasol's collider is the width
   of its visible foot, the marker's is the width of its base
   plate: what the car hits is what it can see standing there.
   ============================================================ */

/** A Rapier collider in the geometry's own frame. Matches
 *  `ColliderDescription` in `physics/Physics.ts`. */
export interface DecorCollider {
  shape: 'cuboid' | 'ball' | 'cylinder' | 'cone'
  parameters: number[]
  position?: { x: number; y: number; z: number }
  quaternion?: { x: number; y: number; z: number; w: number }
}

export interface DecorBuild {
  geometry: THREE.BufferGeometry
  collider: DecorCollider
}

/**
 * Position and normal only, from any mixture of sources.
 *
 * `three/addons` has `mergeGeometries`, and it returns null with a
 * console error the moment two inputs disagree about their
 * attributes — which they always do here, because `chamferedBox`
 * produces position + normal and every THREE primitive also
 * produces uv. A whole set of decoration silently disappearing
 * because a bucket held one cylinder is not a failure mode worth
 * having; dropping uv is, since nothing here is textured.
 */
export function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  for (const part of parts) {
    const source = part.index ? part.toNonIndexed() : part
    const p = source.getAttribute('position')
    const n = source.getAttribute('normal')
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i))
      normals.push(n.getX(i), n.getY(i), n.getZ(i))
    }
    if (source !== part) source.dispose()
    part.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  return out
}

/** Rotates a collider's local +Y axis onto +X: anything lying down. */
const LYING_X = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }
/** …and onto +Z: the wheels and the gears, which stand on their rims. */
const LYING_Z = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }

function at(geometry: THREE.BufferGeometry, x: number, y: number, z: number) {
  geometry.translate(x, y, z)
  return geometry
}

/* ------------------------------------------------------------
   THE SHAPES
   `size` is the kind's authored envelope [width, height, depth],
   so every dimension below is a fraction of a number that lives
   in the manifest rather than a second opinion about it.
   ------------------------------------------------------------ */

const BUILDERS: Record<DecorShape, (size: readonly [number, number, number]) => DecorBuild> = {
  tyre: ([w, h]) => {
    const radius = w / 2
    const tube = h / 2
    // Six radial segments, not sixteen: a tyre is read as a black
    // ring from ten metres up and never as a smooth torus, and these
    // come in stacks of three.
    const ring = new THREE.TorusGeometry(radius - tube, tube, 6, 14)
    ring.rotateX(Math.PI / 2)
    return {
      geometry: at(ring, 0, tube, 0),
      collider: { shape: 'cylinder', parameters: [tube, radius], position: { x: 0, y: tube, z: 0 } },
    }
  },

  bale: ([w, h]) => {
    const radius = h / 2
    const body = new THREE.CylinderGeometry(radius, radius, w, 10, 1)
    body.rotateZ(Math.PI / 2)
    // Two bands, so a rolled bale reads as rolled rather than as a
    // plain cylinder — and so a log reads as bark.
    const bands = [-w * 0.22, w * 0.22].map((dx) => {
      const band = new THREE.CylinderGeometry(radius * 1.05, radius * 1.05, w * 0.08, 10, 1)
      band.rotateZ(Math.PI / 2)
      return at(band, dx, 0, 0)
    })
    return {
      geometry: at(mergeParts([body, ...bands]), 0, radius, 0),
      collider: {
        shape: 'cylinder', parameters: [w / 2, radius],
        position: { x: 0, y: radius, z: 0 }, quaternion: LYING_X,
      },
    }
  },

  pallet: ([w, h, d]) => {
    const parts: THREE.BufferGeometry[] = []
    for (const dz of [-d * 0.38, d * 0.38]) {
      parts.push(at(chamferedBox(w, h * 0.5, d * 0.14, 0.02), 0, h * 0.25, dz))
    }
    for (let i = 0; i < 4; i++) {
      const dx = (i / 3 - 0.5) * w * 0.78
      parts.push(at(chamferedBox(w * 0.15, h * 0.4, d, 0.02), dx, h * 0.7, 0))
    }
    return {
      geometry: mergeParts(parts),
      collider: { shape: 'cuboid', parameters: [w / 2, h / 2, d / 2], position: { x: 0, y: h / 2, z: 0 } },
    }
  },

  sack: ([w, h, d]) => {
    // One subdivision: a sandbag wants to look creased, and a smooth
    // ball at this size reads as a boulder.
    const body = new THREE.IcosahedronGeometry(0.5, 1)
    body.scale(w, h, d)
    return {
      geometry: at(body, 0, h / 2, 0),
      collider: {
        shape: 'cuboid', parameters: [w * 0.42, h * 0.46, d * 0.42],
        position: { x: 0, y: h / 2, z: 0 },
      },
    }
  },

  bollard: ([w, h]) => {
    const r = w / 2
    const foot = at(new THREE.CylinderGeometry(r, r, h * 0.1, 10, 1), 0, h * 0.05, 0)
    const post = strutGeometry(r * 0.55, 10)
    post.scale(1, h * 0.85, 1)
    const cap = at(new THREE.CylinderGeometry(r * 0.62, r * 0.5, h * 0.08, 10, 1), 0, h * 0.96, 0)
    return {
      geometry: mergeParts([foot, at(post, 0, h * 0.1, 0), cap]),
      collider: { shape: 'cylinder', parameters: [h / 2, r * 0.86], position: { x: 0, y: h / 2, z: 0 } },
    }
  },

  pin: ([w, h]) => {
    // The skittle profile, lathed. Ten segments and eleven profile
    // points is 200 triangles, which is what a silhouette this
    // recognisable is worth.
    const profile: [number, number][] = [
      [0, 0], [0.32, 0], [0.39, 0.08], [0.47, 0.23], [0.42, 0.41],
      [0.27, 0.59], [0.21, 0.70], [0.25, 0.81], [0.23, 0.93], [0.14, 1.0], [0, 1.0],
    ]
    const body = new THREE.LatheGeometry(
      profile.map(([r, y]) => new THREE.Vector2(r * w, y * h)), 10,
    )
    return {
      geometry: body,
      collider: {
        shape: 'cylinder', parameters: [h / 2, w * 0.38],
        position: { x: 0, y: h / 2, z: 0 },
      },
    }
  },

  pot: ([w, h]) => {
    const r = w * 0.43
    const body = at(new THREE.CylinderGeometry(r, r * 0.72, h * 0.44, 10, 1), 0, h * 0.22, 0)
    const rim = at(new THREE.CylinderGeometry(r * 1.12, r * 1.12, h * 0.08, 10, 1), 0, h * 0.44, 0)
    const crown = new THREE.IcosahedronGeometry(w * 0.34, 1)
    crown.scale(1.32, 1.0, 1.32)
    return {
      geometry: mergeParts([body, rim, at(crown, 0, h * 0.7, 0)]),
      collider: { shape: 'cylinder', parameters: [h / 2, r * 1.12], position: { x: 0, y: h / 2, z: 0 } },
    }
  },

  parasol: ([w, h]) => {
    const footR = w * 0.18
    const foot = at(new THREE.CylinderGeometry(footR, footR * 1.1, h * 0.05, 10, 1), 0, h * 0.025, 0)
    const pole = strutGeometry(w * 0.022, 8)
    pole.scale(1, h * 0.86, 1)
    // Open on purpose: a closed cone reads as a party hat, and the
    // underside of a parasol is most of what you see from a car.
    const canopy = new THREE.ConeGeometry(w / 2, h * 0.22, 8, 1, true)
    return {
      geometry: mergeParts([foot, at(pole, 0, h * 0.05, 0), at(canopy, 0, h * 0.89, 0)]),
      // As wide as the visible foot. A collider the width of the pole
      // topples on the first centimetre of camber it is set down on.
      collider: {
        shape: 'cuboid', parameters: [footR, h / 2, footR],
        position: { x: 0, y: h / 2, z: 0 },
      },
    }
  },

  deckchair: ([w, h, d]) => {
    const parts: THREE.BufferGeometry[] = []
    const seat = chamferedBox(w * 0.9, h * 0.08, d * 0.48, 0.03)
    seat.rotateX(-0.14)
    parts.push(at(seat, 0, h * 0.45, d * 0.16))
    const back = chamferedBox(w * 0.9, h * 0.66, d * 0.07, 0.03)
    back.rotateX(0.42)
    parts.push(at(back, 0, h * 0.66, -d * 0.24))
    for (const dx of [-w * 0.42, w * 0.42]) {
      for (const dz of [-d * 0.24, d * 0.32]) {
        parts.push(at(chamferedBox(w * 0.07, h * 0.46, d * 0.06, 0.02), dx, h * 0.23, dz))
      }
    }
    return {
      geometry: mergeParts(parts),
      collider: {
        shape: 'cuboid', parameters: [w * 0.47, h * 0.42, d * 0.42],
        position: { x: 0, y: h * 0.42, z: 0 },
      },
    }
  },

  cog: ([w, , d]) => {
    const r = w / 2
    const parts: THREE.BufferGeometry[] = [
      wheelGeometry(r * 0.78, d, 14),
      wheelGeometry(r * 0.24, d * 1.25, 8),
    ]
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      const tooth = chamferedBox(r * 0.28, r * 0.3, d, 0.03)
      tooth.rotateZ(a)
      parts.push(at(tooth, Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86, 0))
    }
    return {
      geometry: at(mergeParts(parts), 0, r, 0),
      collider: {
        shape: 'cylinder', parameters: [d / 2, r],
        position: { x: 0, y: r, z: 0 }, quaternion: LYING_Z,
      },
    }
  },

  rubble: ([w, h, d]) => {
    // A jittered icosahedron. The offsets come from a fixed hash
    // rather than Math.random, so the shape is the same every boot
    // and a screenshot comparison stays meaningful.
    const chunk = new THREE.IcosahedronGeometry(0.5, 0)
    const position = chunk.getAttribute('position')
    for (let i = 0; i < position.count; i++) {
      const hash = Math.sin(i * 127.1) * 43758.5453
      const jitter = 0.82 + (hash - Math.floor(hash)) * 0.36
      position.setXYZ(i, position.getX(i) * jitter, position.getY(i) * jitter, position.getZ(i) * jitter)
    }
    chunk.computeVertexNormals()
    chunk.scale(w, h, d)
    return {
      geometry: at(chunk, 0, h * 0.48, 0),
      collider: {
        shape: 'cuboid', parameters: [w * 0.36, h * 0.36, d * 0.36],
        position: { x: 0, y: h * 0.4, z: 0 },
      },
    }
  },

  marker: ([w, h, d]) => {
    const base = at(chamferedBox(w * 0.44, h * 0.06, w * 0.44, 0.02), 0, h * 0.03, 0)
    const post = strutGeometry(w * 0.06, 8)
    post.scale(1, h * 0.86, 1)
    const plate = at(chamferedBox(w, h * 0.26, d * 0.12, 0.03), 0, h * 0.84, 0)
    return {
      geometry: mergeParts([base, at(post, 0, h * 0.06, 0), plate]),
      collider: {
        shape: 'cuboid', parameters: [w * 0.25, h / 2, w * 0.25],
        position: { x: 0, y: h / 2, z: 0 },
      },
    }
  },

  table: ([w, h, d]) => {
    const parts: THREE.BufferGeometry[] = [
      at(chamferedBox(w * 0.96, h * 0.12, d * 0.45, 0.03), 0, h * 0.92, 0),
    ]
    for (const dz of [-d * 0.36, d * 0.36]) {
      parts.push(at(chamferedBox(w * 0.96, h * 0.09, d * 0.18, 0.03), 0, h * 0.54, dz))
    }
    for (const dx of [-w * 0.38, w * 0.38]) {
      parts.push(at(chamferedBox(w * 0.05, h * 0.86, d * 0.92, 0.03), dx, h * 0.43, 0))
    }
    return {
      geometry: mergeParts(parts),
      collider: {
        shape: 'cuboid', parameters: [w * 0.5, h * 0.5, d * 0.5],
        position: { x: 0, y: h * 0.5, z: 0 },
      },
    }
  },

  lantern: ([w, h]) => {
    const base = at(chamferedBox(w * 0.86, h * 0.05, w * 0.86, 0.03), 0, h * 0.025, 0)
    const post = strutGeometry(w * 0.14, 8)
    post.scale(1, h * 0.83, 1)
    const head = at(chamferedBox(w * 0.62, h * 0.14, w * 0.62, 0.03), 0, h * 0.88, 0)
    const cap = at(chamferedBox(w * 0.74, h * 0.03, w * 0.74, 0.02), 0, h * 0.98, 0)
    return {
      geometry: mergeParts([base, at(post, 0, h * 0.05, 0), head, cap]),
      collider: {
        shape: 'cuboid', parameters: [w * 0.37, h / 2, w * 0.37],
        position: { x: 0, y: h / 2, z: 0 },
      },
    }
  },
}

/** Builds one kind's shared geometry and its matching collider. */
export function buildDecorShape(kind: DecorKind): DecorBuild {
  return BUILDERS[kind.shape](kind.size)
}

/** Re-exported so `Props.ts` reaches the manifest through the module
 *  that knows how to draw it, rather than through two imports that
 *  can drift apart. */
export { DECOR_KINDS }
