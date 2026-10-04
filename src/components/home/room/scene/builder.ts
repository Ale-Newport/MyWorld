import * as THREE from 'three'

/* ============================================================
   GEOMETRY BUILDER
   The room is assembled from a few hundred carved pieces, all
   merged into one buffer. Every vertex carries, besides its
   position and normal, the material it is cut from and a per-
   piece random value that the shaders use to vary one slab or
   one block of stone from its neighbour.
   ============================================================ */

export const MAT = {
  plaster: 0,
  stone: 1,
  floor: 2,
  ceiling: 3,
  niche: 4,
} as const
export type MaterialId = (typeof MAT)[keyof typeof MAT]

const V = new THREE.Vector3()
const E = new THREE.Vector3()

export class GeometryBuilder {
  private pos: number[] = []
  private nor: number[] = []
  private mat: number[] = []
  private rnd: number[] = []
  material: MaterialId = MAT.plaster
  random = 0

  get vertexCount() {
    return this.pos.length / 3
  }

  private vertex(p: THREE.Vector3, n: THREE.Vector3) {
    this.pos.push(p.x, p.y, p.z)
    this.nor.push(n.x, n.y, n.z)
    this.mat.push(this.material)
    this.rnd.push(this.random)
  }

  /** One triangle with per-vertex normals. Winding is counter-
      clockwise seen from the side the normals point to. */
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, na: THREE.Vector3, nb = na, nc = na) {
    // Winding follows the normals we were given, whatever order the
    // caller listed the corners in: every triangle faces out of the
    // stone, so back-face culling and the shadow passes agree.
    V.subVectors(b, a).cross(E.subVectors(c, a))
    const s = V.x * (na.x + nb.x + nc.x) + V.y * (na.y + nb.y + nc.y) + V.z * (na.z + nb.z + nc.z)
    this.vertex(a, na)
    if (s < 0) {
      this.vertex(c, nc)
      this.vertex(b, nb)
    } else {
      this.vertex(b, nb)
      this.vertex(c, nc)
    }
  }

  /** Quad a-b-c-d (counter-clockwise from the normal side). */
  quad(
    a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3,
    na: THREE.Vector3, nb = na, nc = na, nd = na,
  ) {
    this.tri(a, b, c, na, nb, nc)
    this.tri(a, c, d, na, nc, nd)
  }

  /** A flat quad whose winding is fixed up to face `n`. */
  face(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, n: THREE.Vector3) {
    V.subVectors(b, a).cross(V.clone().subVectors(c, a))
    if (V.dot(n) < 0) this.quad(a, d, c, b, n)
    else this.quad(a, b, c, d, n)
  }

  /** Triangulated planar polygon (with optional holes) in a local
      2D frame: p = origin + x * ax + y * ay, facing `n`. */
  polygon(
    contour: THREE.Vector2[], holes: THREE.Vector2[][],
    origin: THREE.Vector3, ax: THREE.Vector3, ay: THREE.Vector3, n: THREE.Vector3,
  ) {
    const tris = THREE.ShapeUtils.triangulateShape(contour, holes)
    const all = contour.concat(...holes)
    const to3 = (q: THREE.Vector2) => origin.clone().addScaledVector(ax, q.x).addScaledVector(ay, q.y)
    const flip = V.copy(ax).cross(ay).dot(n) < 0
    for (const [i, j, k] of tris) {
      const a = to3(all[i])
      const b = to3(all[j])
      const c = to3(all[k])
      // triangulateShape returns triangles in the contour's own
      // winding; make every one face `n`.
      const cw = THREE.ShapeUtils.isClockWise([all[i], all[j], all[k]])
      if (cw !== flip) this.tri(a, c, b, n)
      else this.tri(a, b, c, n)
    }
  }

  append(other: GeometryBuilder) {
    this.pos.push(...other.pos)
    this.nor.push(...other.nor)
    this.mat.push(...other.mat)
    this.rnd.push(...other.rnd)
  }

  toGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 1))
    g.setAttribute('aRand', new THREE.Float32BufferAttribute(this.rnd, 1))
    g.computeBoundingBox()
    g.computeBoundingSphere()
    return g
  }
}
