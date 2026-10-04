import * as THREE from 'three'
import type { GeometryBuilder } from './builder'

/* ============================================================
   MOULDING PROFILES
   A profile is a section through a moulding: `d` is how far the
   surface stands proud of the wall it is fixed to, `h` is the
   position across the moulding (up, for a cornice; inwards, for a
   panel frame). It is written as a pen that starts on the wall
   and walks the outline back to the wall, so a cornice, a base or
   a picture-frame bolection is one short list of strokes.

   Exposed arrises are never infinitely sharp: every step can be
   eased with a small round, which is what lets a lit edge catch a
   highlight instead of reading as a drawn line.
   ============================================================ */

export interface ProfilePoint {
  d: number
  h: number
  /** A crease: normals are not averaged across this point. */
  sharp: boolean
}

export class Profile {
  readonly points: ProfilePoint[] = []
  private d = 0
  private h = 0

  constructor(d = 0, h = 0) {
    this.d = d
    this.h = h
    this.points.push({ d, h, sharp: true })
  }

  get cursor() {
    return { d: this.d, h: this.h }
  }

  private push(d: number, h: number, sharp: boolean) {
    this.d = d
    this.h = h
    this.points.push({ d, h, sharp })
  }

  /** Straight stroke by (dd, dh). */
  line(dd: number, dh: number, sharp = true) {
    this.push(this.d + dd, this.h + dh, sharp)
    return this
  }

  /** Straight stroke to an absolute point. */
  to(d: number, h: number, sharp = true) {
    this.push(d, h, sharp)
    return this
  }

  /** Quarter or half ellipse from the cursor, centred so that the
      arc starts tangent to `from` and ends tangent to `to`. A
      general arc helper: centre (cd, ch), radii, angle range. */
  arc(cd: number, ch: number, rd: number, rh: number, a0: number, a1: number, steps = 6) {
    for (let i = 1; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps
      this.push(cd + Math.cos(a) * rd, ch + Math.sin(a) * rh, i === steps)
    }
    // The point where the arc began is smooth into it.
    const start = this.points[this.points.length - steps - 1]
    if (start) start.sharp = false
    return this
  }

  /** Convex quarter round going outward then up (an ovolo) of
      radius r: from the cursor, ends r further out and r higher. */
  ovolo(r: number, steps = 7) {
    const { d, h } = this
    return this.arc(d, h + r, r, r, -Math.PI / 2, 0, steps)
  }

  /** Concave quarter round going up then out (a cavetto). */
  cavetto(r: number, steps = 7) {
    const { d, h } = this
    return this.arc(d + r, h, r, r, Math.PI, Math.PI / 2, steps)
  }

  /** A torus: a convex half round standing proud by r, height 2r. */
  torus(r: number, steps = 10) {
    const { d, h } = this
    return this.arc(d, h + r, r, r, -Math.PI / 2, Math.PI / 2, steps)
  }

  /** A scotia: a concave half hollow cut back by r, height 2r. */
  scotia(r: number, depth = r, steps = 10) {
    const { d, h } = this
    return this.arc(d, h + r, depth, r, -Math.PI / 2, -Math.PI * 1.5, steps)
  }

  /** Cyma recta: concave below, convex above (the classic crown). */
  cymaRecta(w: number, ht: number, steps = 6) {
    const { d, h } = this
    this.arc(d + w / 2, h, w / 2, ht / 2, Math.PI, Math.PI / 2, steps)
    this.arc(d + w / 2, h + ht, w / 2, ht / 2, -Math.PI / 2, 0, steps)
    return this
  }

  /** Cyma reversa: convex below, concave above (an ogee bed mould). */
  cymaReversa(w: number, ht: number, steps = 6) {
    const { d, h } = this
    this.arc(d, h + ht / 2, w / 2, ht / 2, -Math.PI / 2, 0, steps)
    this.arc(d + w, h + ht / 2, w / 2, ht / 2, Math.PI, Math.PI / 2, steps)
    return this
  }

  /** Round the corner just reached with radius r: replaces the last
      point by a short arc. Turns a crisp arris into a lit edge. */
  ease(r: number) {
    const n = this.points.length
    if (n < 3) return this
    const a = this.points[n - 3]
    const b = this.points[n - 2]
    const c = this.points[n - 1]
    const v1 = new THREE.Vector2(a.d - b.d, a.h - b.h)
    const v2 = new THREE.Vector2(c.d - b.d, c.h - b.h)
    const l1 = v1.length()
    const l2 = v2.length()
    if (l1 < 1e-6 || l2 < 1e-6) return this
    const rr = Math.min(r, l1 * 0.45, l2 * 0.45)
    v1.divideScalar(l1)
    v2.divideScalar(l2)
    const p1 = { d: b.d + v1.x * rr, h: b.h + v1.y * rr }
    const p2 = { d: b.d + v2.x * rr, h: b.h + v2.y * rr }
    const out: ProfilePoint[] = []
    const steps = 3
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      // Quadratic Bézier with b as the control point.
      const u = 1 - t
      out.push({
        d: u * u * p1.d + 2 * u * t * b.d + t * t * p2.d,
        h: u * u * p1.h + 2 * u * t * b.h + t * t * p2.h,
        sharp: false,
      })
    }
    out[0].sharp = false
    this.points.splice(n - 2, 1, ...out)
    return this
  }

  /** Total height and maximum projection. */
  bounds() {
    let dMax = 0
    let h0 = Infinity
    let h1 = -Infinity
    for (const p of this.points) {
      dMax = Math.max(dMax, p.d)
      h0 = Math.min(h0, p.h)
      h1 = Math.max(h1, p.h)
    }
    return { dMax, h0, h1 }
  }

  /** Projection at height h — the envelope a vine has to climb
      over (the outermost surface at that height). */
  envelope(h: number): number {
    let best = 0
    const pts = this.points
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const lo = Math.min(a.h, b.h)
      const hi = Math.max(a.h, b.h)
      if (h < lo || h > hi) continue
      const t = hi - lo < 1e-9 ? 0 : (h - a.h) / (b.h - a.h)
      best = Math.max(best, a.d + (b.d - a.d) * t, hi - lo < 1e-9 ? Math.max(a.d, b.d) : 0)
    }
    return best
  }
}

/* ------------------------------------------------------------
   SWEEP
   Runs a profile along a path. Each segment of the path carries
   its own frame: `dAxis`, the direction the profile stands proud
   in, and `hAxis`, the direction its height runs in. Corners are
   mitred by intersecting the offset lines of the two segments, so
   the same code turns a cornice round a pilaster and a bolection
   round a panel.
   ------------------------------------------------------------ */

export interface SweepSegment {
  a: THREE.Vector3
  b: THREE.Vector3
  dAxis: THREE.Vector3
  hAxis: THREE.Vector3
}

const tA = new THREE.Vector3()
const tB = new THREE.Vector3()
const w0 = new THREE.Vector3()

/** Intersection of p + s * u and q + r * v (coplanar lines). */
function meet(p: THREE.Vector3, u: THREE.Vector3, q: THREE.Vector3, v: THREE.Vector3, out: THREE.Vector3) {
  const a = u.dot(u)
  const b = u.dot(v)
  const c = v.dot(v)
  w0.subVectors(p, q)
  const d = u.dot(w0)
  const e = v.dot(w0)
  const den = a * c - b * b
  if (Math.abs(den) < 1e-9) return out.copy(p)
  const s = (b * e - c * d) / den
  return out.copy(p).addScaledVector(u, s)
}

export function sweep(
  out: GeometryBuilder,
  profile: Profile,
  segments: SweepSegment[],
  options: { closed?: boolean; capStart?: boolean; capEnd?: boolean } = {},
) {
  const pts = profile.points
  const n = segments.length
  const closed = !!options.closed

  // Per-edge 2D normals of the profile (outward: (dh, -dd)).
  const edgeN: THREE.Vector2[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const dd = pts[i + 1].d - pts[i].d
    const dh = pts[i + 1].h - pts[i].h
    edgeN.push(new THREE.Vector2(dh, -dd).normalize())
  }
  const endNormal = (i: number, edge: number) => {
    // Normal at point i as seen from `edge`.
    const p = pts[i]
    if (p.sharp) return edgeN[edge]
    const other = i === edge ? edge - 1 : edge + 1
    if (other < 0 || other >= edgeN.length) return edgeN[edge]
    return edgeN[edge].clone().add(edgeN[other]).normalize()
  }

  // Positions of every profile point at every path vertex, per
  // adjoining segment (mitred).
  const ring = (vertex: number, seg: number, i: number, target: THREE.Vector3) => {
    const s = segments[seg]
    const p = pts[i]
    const off = new THREE.Vector3().copy(s.dAxis).multiplyScalar(p.d).addScaledVector(s.hAxis, p.h)
    const base = vertex === seg ? s.a : s.b
    const prevSeg = vertex === seg ? (seg > 0 ? seg - 1 : closed ? n - 1 : -1) : seg
    const nextSeg = vertex === seg ? seg : seg < n - 1 ? seg + 1 : closed ? 0 : -1
    if (prevSeg < 0 || nextSeg < 0 || prevSeg === nextSeg) return target.copy(base).add(off)
    const sp = segments[prevSeg]
    const sn = segments[nextSeg]
    const offP = new THREE.Vector3().copy(sp.dAxis).multiplyScalar(p.d).addScaledVector(sp.hAxis, p.h)
    const offN = new THREE.Vector3().copy(sn.dAxis).multiplyScalar(p.d).addScaledVector(sn.hAxis, p.h)
    tA.subVectors(sp.b, sp.a).normalize()
    tB.subVectors(sn.b, sn.a).normalize()
    if (Math.abs(tA.dot(tB)) > 0.9999) return target.copy(base).add(off)
    return meet(base.clone().add(offP), tA, base.clone().add(offN), tB, target)
  }

  const a0 = new THREE.Vector3()
  const a1 = new THREE.Vector3()
  const b0 = new THREE.Vector3()
  const b1 = new THREE.Vector3()
  for (let s = 0; s < n; s++) {
    const seg = segments[s]
    for (let e = 0; e < pts.length - 1; e++) {
      ring(s, s, e, a0)
      ring(s, s, e + 1, a1)
      ring(s + 1, s, e, b0)
      ring(s + 1, s, e + 1, b1)
      const n0 = endNormal(e, e)
      const n1 = endNormal(e + 1, e)
      const N0 = new THREE.Vector3().copy(seg.dAxis).multiplyScalar(n0.x).addScaledVector(seg.hAxis, n0.y).normalize()
      const N1 = new THREE.Vector3().copy(seg.dAxis).multiplyScalar(n1.x).addScaledVector(seg.hAxis, n1.y).normalize()
      // Orientation: the quad a0-b0-b1-a1 must face N.
      const fn = new THREE.Vector3().subVectors(b0, a0).cross(new THREE.Vector3().subVectors(a1, a0))
      const faceN = N0.clone().add(N1)
      if (fn.lengthSq() < 1e-14) continue
      if (fn.dot(faceN) >= 0) out.quad(a0, b0, b1, a1, N0, N0, N1, N1)
      else out.quad(a0, a1, b1, b0, N0, N1, N1, N0)
    }
  }

  // End caps: the profile's own outline closed against the wall.
  const cap = (seg: SweepSegment, at: THREE.Vector3, facing: THREE.Vector3) => {
    const contour = pts.map((p) => new THREE.Vector2(p.d, p.h))
    // Drop a duplicate closing point if the profile returns to its start.
    const first = contour[0]
    const last = contour[contour.length - 1]
    if (first.distanceTo(last) < 1e-6) contour.pop()
    if (contour.length < 3) return
    out.polygon(contour, [], at, seg.dAxis, seg.hAxis, facing)
  }
  if (!closed && options.capStart) {
    const s = segments[0]
    cap(s, s.a, new THREE.Vector3().subVectors(s.a, s.b).normalize())
  }
  if (!closed && options.capEnd) {
    const s = segments[n - 1]
    cap(s, s.b, new THREE.Vector3().subVectors(s.b, s.a).normalize())
  }
}

/** Segments along a horizontal plan polyline at height y, with the
    profile standing proud along each segment's room-side normal. */
export function planPath(points: Array<[number, number]>, y: number, normals: Array<[number, number]>): SweepSegment[] {
  const segs: SweepSegment[] = []
  for (let i = 0; i < points.length - 1; i++) {
    segs.push({
      a: new THREE.Vector3(points[i][0], y, points[i][1]),
      b: new THREE.Vector3(points[i + 1][0], y, points[i + 1][1]),
      dAxis: new THREE.Vector3(normals[i][0], 0, normals[i][1]).normalize(),
      hAxis: new THREE.Vector3(0, 1, 0),
    })
  }
  return segs
}
