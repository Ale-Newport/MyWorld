import * as THREE from 'three'
import { SWATCH, paletteUV } from './palette'

/* ============================================================
   WOOD, ROPE, IRON AND LEAVES — BUILT IN CODE

   Every part is flat-shaded (one normal per facet, nothing
   shared between facets) and carries UVs that point at ONE
   swatch of the world's palette atlas. A sign's hardware is a
   dozen of these merged into a single BufferGeometry and drawn
   with the level's own palette material, so it reads as
   authored geometry and costs one draw call and no new shader.

   Parts are modelled at the origin. Where they have a front it
   is +Z; posts and charms stand on / hang from the origin's Y.
   `mergeParts` is local on purpose: three/addons would need the
   import map and the generated-module build knows only 'three'.
   ============================================================ */

export type Vec3 = [number, number, number]

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2])
const normalize = (a: Vec3): Vec3 => { const l = length(a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
const centroid = (points: Vec3[]): Vec3 => {
  const sum: Vec3 = [0, 0, 0]
  for (const p of points) { sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2] }
  return mul(sum, 1 / points.length)
}

/** Deterministic 0..1 sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A stable 32-bit seed from a string (sign ids, project ids). */
export function hashSeed(text: string | number): number {
  const value = String(text)
  let h = 2166136261
  for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

/** Collects flat-shaded facets. `swizzle` re-aims a part built around Y so it can stand on another axis. */
export class Facets {
  readonly position: number[] = []
  readonly normal: number[] = []
  readonly uv: number[] = []
  swizzle: ((v: Vec3) => Vec3) | null = null

  /** One triangle, wound counter-clockwise when seen from the front. */
  tri(a: Vec3, b: Vec3, c: Vec3, swatch: number): void {
    const n = normalize(cross(sub(b, a), sub(c, a)))
    if (!Number.isFinite(n[0] + n[1] + n[2]) || length(cross(sub(b, a), sub(c, a))) < 1e-12) return
    const [u, v] = paletteUV(swatch)
    for (const p of [a, b, c]) {
      this.position.push(p[0], p[1], p[2])
      this.normal.push(n[0], n[1], n[2])
      this.uv.push(u, v)
    }
  }

  /**
   * A convex planar polygon as a fan. When `away` is given the facet faces away from that point
   * whatever order the points came in, which is what lets the builders below stay short.
   */
  poly(points: Vec3[], swatch: number, away?: Vec3): void {
    let pts = points
    let ref = away
    if (this.swizzle) { pts = points.map(this.swizzle); ref = away ? this.swizzle(away) : undefined }
    if (ref) {
      const n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]))
      if (dot(n, sub(centroid(pts), ref)) < 0) pts = [...pts].reverse()
    }
    for (let i = 1; i < pts.length - 1; i++) this.tri(pts[0], pts[i], pts[i + 1], swatch)
  }

  /** A convex polygon whose normal points along `direction` whatever order the points came in. */
  facing(points: Vec3[], swatch: number, direction: Vec3): void {
    const pts = this.swizzle ? points.map(this.swizzle) : points
    const want = this.swizzle ? this.swizzle(direction) : direction
    const n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]))
    const ordered = dot(n, want) < 0 ? [...pts].reverse() : pts
    for (let i = 1; i < ordered.length - 1; i++) this.tri(ordered[0], ordered[i], ordered[i + 1], swatch)
  }

  geometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    geometry.computeBoundingSphere()
    geometry.computeBoundingBox()
    return geometry
  }

  get triangles(): number { return this.position.length / 9 }
}

/* ---------------------------------------------------------------- primitives -- */

export interface BoxSwatches { front?: number; back?: number; top?: number; bottom?: number; left?: number; right?: number; edge?: number }

/** A box (optionally with every edge chamfered). 12 triangles plain, 44 chamfered. */
export function addBox(f: Facets, centre: Vec3, half: Vec3, swatch: number, bevel = 0, swatches: BoxSwatches = {}): void {
  const [cx, cy, cz] = centre
  const [hx, hy, hz] = half
  const sw = {
    px: swatches.right ?? swatch, nx: swatches.left ?? swatch, py: swatches.top ?? swatch,
    ny: swatches.bottom ?? swatch, pz: swatches.front ?? swatch, nz: swatches.back ?? swatch,
  }
  const edge = swatches.edge ?? swatch
  const b = Math.min(bevel, hx * 0.95, hy * 0.95, hz * 0.95)
  if (b <= 0) {
    const c = (sx: number, sy: number, sz: number): Vec3 => [cx + sx * hx, cy + sy * hy, cz + sz * hz]
    f.poly([c(1, -1, -1), c(1, 1, -1), c(1, 1, 1), c(1, -1, 1)], sw.px, centre)
    f.poly([c(-1, -1, -1), c(-1, 1, -1), c(-1, 1, 1), c(-1, -1, 1)], sw.nx, centre)
    f.poly([c(-1, 1, -1), c(1, 1, -1), c(1, 1, 1), c(-1, 1, 1)], sw.py, centre)
    f.poly([c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1), c(-1, -1, 1)], sw.ny, centre)
    f.poly([c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1)], sw.pz, centre)
    f.poly([c(-1, -1, -1), c(1, -1, -1), c(1, 1, -1), c(-1, 1, -1)], sw.nz, centre)
    return
  }
  const cp = (sx: number, sy: number, sz: number, axis: 'x' | 'y' | 'z'): Vec3 => axis === 'x'
    ? [cx + sx * hx, cy + sy * (hy - b), cz + sz * (hz - b)]
    : axis === 'y' ? [cx + sx * (hx - b), cy + sy * hy, cz + sz * (hz - b)]
      : [cx + sx * (hx - b), cy + sy * (hy - b), cz + sz * hz]
  for (const s of [1, -1]) {
    f.poly([cp(s, -1, -1, 'x'), cp(s, 1, -1, 'x'), cp(s, 1, 1, 'x'), cp(s, -1, 1, 'x')], s > 0 ? sw.px : sw.nx, centre)
    f.poly([cp(-1, s, -1, 'y'), cp(1, s, -1, 'y'), cp(1, s, 1, 'y'), cp(-1, s, 1, 'y')], s > 0 ? sw.py : sw.ny, centre)
    f.poly([cp(-1, -1, s, 'z'), cp(1, -1, s, 'z'), cp(1, 1, s, 'z'), cp(-1, 1, s, 'z')], s > 0 ? sw.pz : sw.nz, centre)
  }
  for (const a of [1, -1]) for (const c of [1, -1]) {
    f.poly([cp(a, c, -1, 'x'), cp(a, c, 1, 'x'), cp(a, c, 1, 'y'), cp(a, c, -1, 'y')], edge, centre)
    f.poly([cp(a, -1, c, 'x'), cp(a, 1, c, 'x'), cp(a, 1, c, 'z'), cp(a, -1, c, 'z')], edge, centre)
    f.poly([cp(-1, a, c, 'y'), cp(1, a, c, 'y'), cp(1, a, c, 'z'), cp(-1, a, c, 'z')], edge, centre)
  }
  for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) {
    f.poly([cp(sx, sy, sz, 'x'), cp(sx, sy, sz, 'y'), cp(sx, sy, sz, 'z')], edge, centre)
  }
}

/**
 * Surface of revolution around Y. `profile` runs as [radius, y] from the bottom axis point outwards, up the
 * side and back in to the top axis point (the outward side is on the right of the direction of travel).
 */
export function addLathe(f: Facets, profile: [number, number][], sides: number, swatch: number, capSwatch = swatch): void {
  const ring = (r: number, y: number, i: number): Vec3 => {
    const a = (i / sides) * Math.PI * 2
    return [Math.cos(a) * r, y, Math.sin(a) * r]
  }
  for (let p = 0; p < profile.length - 1; p++) {
    const [r0, y0] = profile[p]
    const [r1, y1] = profile[p + 1]
    if (r0 === 0 && r1 === 0) continue
    const tr = r1 - r0, ty = y1 - y0
    const color = ty === 0 ? capSwatch : swatch
    for (let i = 0; i < sides; i++) {
      const a = ring(r0, y0, i), b = ring(r0, y0, i + 1), c = ring(r1, y1, i + 1), d = ring(r1, y1, i)
      const phi = ((i + 0.5) / sides) * Math.PI * 2
      // The outward normal in the (r, y) plane is (ty, -tr); spin it to this facet's bearing.
      const direction: Vec3 = [Math.cos(phi) * ty, -tr, Math.sin(phi) * ty]
      if (r0 === 0) f.facing([a, c, d], color, direction)
      else if (r1 === 0) f.facing([a, b, d], color, direction)
      else f.facing([a, b, c, d], color, direction)
    }
  }
}

/** A prism around Y, flat caps. `topRadius` tapers it. */
export function addPrism(f: Facets, radius: number, y0: number, y1: number, sides: number, swatch: number, capSwatch = swatch, topRadius = radius): void {
  addLathe(f, [[0, y0], [radius, y0], [topRadius, y1], [0, y1]], sides, swatch, capSwatch)
}

/** A solid sphere as a low-poly lathe. */
export function addSphere(f: Facets, centre: Vec3, radius: number, swatch: number, sides = 6, rings = 4): void {
  const profile: [number, number][] = []
  for (let i = 0; i <= rings; i++) {
    const a = -Math.PI / 2 + (i / rings) * Math.PI
    profile.push([i === 0 || i === rings ? 0 : Math.cos(a) * radius, Math.sin(a) * radius])
  }
  const swizzle = f.swizzle
  const before = f.position.length
  addLathe(f, profile, sides, swatch)
  const move = swizzle ? swizzle(centre) : centre
  for (let i = before; i < f.position.length; i += 3) {
    f.position[i] += move[0]; f.position[i + 1] += move[1]; f.position[i + 2] += move[2]
  }
}

/** A flat outline (x, y) pulled out along Z, front at +depth/2. Star-shaped outlines only (gears, leaves, pennants). */
export function addExtrude(f: Facets, outline: [number, number][], depth: number, swatch: number, rim = swatch): void {
  const h = depth / 2
  const cx = outline.reduce((sum, p) => sum + p[0], 0) / outline.length
  const cy = outline.reduce((sum, p) => sum + p[1], 0) / outline.length
  let area = 0
  outline.forEach((p, i) => { const q = outline[(i + 1) % outline.length]; area += p[0] * q[1] - q[0] * p[1] })
  const winding = area >= 0 ? 1 : -1
  outline.forEach((p, i) => {
    const q = outline[(i + 1) % outline.length]
    f.facing([[cx, cy, h], [p[0], p[1], h], [q[0], q[1], h]], swatch, [0, 0, 1])
    f.facing([[cx, cy, -h], [p[0], p[1], -h], [q[0], q[1], -h]], swatch, [0, 0, -1])
    const out: Vec3 = [(q[1] - p[1]) * winding, -(q[0] - p[0]) * winding, 0]
    f.facing([[p[0], p[1], h], [q[0], q[1], h], [q[0], q[1], -h], [p[0], p[1], -h]], rim, out)
  })
}

/** A tube along a polyline, parallel-transported so it does not twist. */
export function addTube(f: Facets, points: Vec3[], radius: number, swatch: number, sides = 5, closed = false): void {
  if (points.length < 2) return
  const n = points.length
  const tangents: Vec3[] = points.map((_, i) => {
    const prev = points[closed ? (i - 1 + n) % n : Math.max(0, i - 1)]
    const next = points[closed ? (i + 1) % n : Math.min(n - 1, i + 1)]
    return normalize(sub(next, prev))
  })
  const seed: Vec3 = Math.abs(tangents[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  let normal = normalize(cross(cross(tangents[0], seed), tangents[0]))
  const rings: Vec3[][] = []
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const axis = cross(tangents[i - 1], tangents[i])
      const s = length(axis)
      if (s > 1e-6) {
        const angle = Math.asin(Math.min(1, s))
        const k = normalize(axis)
        // Rodrigues: carry the normal around the bend between tangents.
        normal = normalize(add(add(mul(normal, Math.cos(angle)), mul(cross(k, normal), Math.sin(angle))), mul(k, dot(k, normal) * (1 - Math.cos(angle)))))
      }
    }
    const binormal = cross(tangents[i], normal)
    const ring: Vec3[] = []
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2
      ring.push(add(points[i], add(mul(normal, Math.cos(a) * radius), mul(binormal, Math.sin(a) * radius))))
    }
    rings.push(ring)
  }
  const segments = closed ? n : n - 1
  for (let i = 0; i < segments; i++) {
    const a = rings[i], b = rings[(i + 1) % n]
    const centre = centroid([points[i], points[(i + 1) % n]])
    for (let s = 0; s < sides; s++) f.poly([a[s], a[(s + 1) % sides], b[(s + 1) % sides], b[s]], swatch, centre)
  }
  if (!closed) {
    f.facing(rings[0], swatch, mul(tangents[0], -1))
    f.facing(rings[n - 1], swatch, tangents[n - 1])
  }
}

/* ---------------------------------------------------------------- parts -- */

const fromFacets = (build: (f: Facets) => void): THREE.BufferGeometry => {
  const f = new Facets()
  build(f)
  return f.geometry()
}

export interface PlankOptions { width: number; height: number; depth: number; swatch?: number; edge?: number; bevel?: number }
/** A hewn board, chamfered all round. Centred on the origin. */
export function plankGeometry({ width, height, depth, swatch = SWATCH.lightOrange, edge = SWATCH.tan, bevel = 0.02 }: PlankOptions): THREE.BufferGeometry {
  return fromFacets(f => addBox(f, [0, 0, 0], [width / 2, height / 2, depth / 2], swatch, bevel, { edge }))
}

export interface PostOptions { width: number; height: number; depth?: number; swatch?: number; cap?: 'pyramid' | 'ball' | 'flat' | 'none'; capSwatch?: number; edge?: number }
/** A square post standing on y = 0, with an optional cap. */
export function postGeometry({ width, height, depth = width, swatch = SWATCH.lightOrange, cap = 'pyramid', capSwatch = SWATCH.woodDark, edge = SWATCH.tan }: PostOptions): THREE.BufferGeometry {
  return fromFacets(f => {
    addBox(f, [0, height / 2, 0], [width / 2, height / 2, depth / 2], swatch, Math.min(width, depth) * 0.12, { edge })
    const top = height
    if (cap === 'pyramid') {
      const w = width * 0.62, d = depth * 0.62
      const slab = width * 0.16
      addBox(f, [0, top + slab / 2, 0], [w, slab / 2, d], capSwatch, 0)
      const base = top + slab
      const tip: Vec3 = [0, base + width * 0.5, 0]
      const corners: Vec3[] = [[-w, base, -d], [w, base, -d], [w, base, d], [-w, base, d]]
      for (let i = 0; i < 4; i++) f.poly([corners[i], corners[(i + 1) % 4], tip], capSwatch, [0, base - 1, 0])
    } else if (cap === 'ball') {
      addSphere(f, [0, top + width * 0.28, 0], width * 0.34, capSwatch, 6, 4)
    } else if (cap === 'flat') {
      addBox(f, [0, top + width * 0.08, 0], [width * 0.62, width * 0.08, depth * 0.62], capSwatch, width * 0.03)
    }
  })
}

export interface PegOptions { radius?: number; length?: number; swatch?: number; tip?: number }
/** A wooden peg poking out of a face along +Z. */
export function pegGeometry({ radius = 0.035, length = 0.08, swatch = SWATCH.woodDark, tip = SWATCH.tan }: PegOptions = {}): THREE.BufferGeometry {
  return fromFacets(f => {
    f.swizzle = ([x, y, z]) => [x, z, y]
    addLathe(f, [[0, 0], [radius, 0], [radius, length * 0.7], [radius * 0.82, length], [0, length * 1.02]], 6, swatch, tip)
  })
}

export interface NailOptions { radius?: number; height?: number; swatch?: number }
/** A nail head: a squat dome facing +Z. 6 sides, about 12 triangles. */
export function nailGeometry({ radius = 0.026, height = 0.022, swatch = SWATCH.dark }: NailOptions = {}): THREE.BufferGeometry {
  return fromFacets(f => {
    f.swizzle = ([x, y, z]) => [x, z, y]
    addLathe(f, [[radius, 0], [radius, height * 0.4], [radius * 0.62, height], [0, height * 1.05]], 6, swatch)
  })
}

export interface BracketOptions { arm?: number; thickness?: number; depth?: number; swatch?: number }
/** An L-shaped iron corner brace. The corner is at the origin and the arms run +X and +Y. */
export function bracketGeometry({ arm = 0.3, thickness = 0.05, depth = 0.035, swatch = SWATCH.dark }: BracketOptions = {}): THREE.BufferGeometry {
  return fromFacets(f => {
    addBox(f, [arm / 2, thickness / 2, 0], [arm / 2, thickness / 2, depth / 2], swatch, thickness * 0.15)
    addBox(f, [thickness / 2, arm / 2, 0], [thickness / 2, arm / 2, depth / 2], swatch, thickness * 0.15)
    addBox(f, [thickness * 1.4, thickness * 1.4, 0], [thickness * 0.35, thickness * 0.35, depth * 0.62], SWATCH.silver, 0)
  })
}

export interface RopeOptions { sag?: number; radius?: number; sides?: number; segments?: number; swatch?: number }
/** A rope from a to b that hangs a little between them. */
export function ropeGeometry(a: Vec3, b: Vec3, { sag = 0.08, radius = 0.016, sides = 5, segments = 8, swatch = SWATCH.khaki }: RopeOptions = {}): THREE.BufferGeometry {
  const points: Vec3[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const drop = Math.sin(t * Math.PI) * sag
    points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - drop, a[2] + (b[2] - a[2]) * t])
  }
  return fromFacets(f => addTube(f, points, radius, swatch, sides))
}

export interface VineOptions { radius?: number; leaves?: number; leafSize?: number; seed?: number; swatch?: number; leafSwatches?: number[]; sides?: number }
/** A creeper that follows `path`, with leaves on alternate sides. */
export function vineGeometry(path: Vec3[], { radius = 0.014, leaves = 8, leafSize = 0.09, seed = 1, swatch = SWATCH.olive, leafSwatches = [SWATCH.sage, SWATCH.olive], sides = 4 }: VineOptions = {}): THREE.BufferGeometry {
  const rand = mulberry32(seed)
  return fromFacets(f => {
    addTube(f, path, radius, swatch, sides)
    const segs = path.length - 1
    for (let i = 0; i < leaves; i++) {
      const t = (i + 0.5) / leaves * segs
      const k = Math.min(segs - 1, Math.floor(t))
      const u = t - k
      const p = add(mul(path[k], 1 - u), mul(path[k + 1], u))
      const dir = normalize(sub(path[k + 1], path[k]))
      const side: Vec3 = normalize(cross(dir, [0, 0, 1]))
      const sign = i % 2 ? 1 : -1
      const size = leafSize * (0.75 + rand() * 0.5)
      const tip = add(add(p, mul(side, sign * size)), mul(dir, size * 0.5))
      const mid = add(add(p, mul(side, sign * size * 0.5)), [0, 0, size * 0.28])
      const left = add(mid, mul(dir, -size * 0.28))
      const right = add(mid, mul(dir, size * 0.34))
      const color = leafSwatches[i % leafSwatches.length]
      f.tri(p, left, tip, color); f.tri(p, tip, left, color)
      f.tri(p, tip, right, color); f.tri(p, right, tip, color)
    }
  })
}

export type CharmKind = 'none' | 'coin' | 'gear' | 'planet' | 'dumbbell' | 'leaf' | 'padlock' | 'diamond' | 'compass' | 'acorn' | 'pennant' | 'pawn' | 'books' | 'cards'
export const CHARM_KINDS: CharmKind[] = ['coin', 'gear', 'planet', 'dumbbell', 'leaf', 'padlock', 'diamond', 'compass', 'acorn', 'pennant', 'pawn', 'books', 'cards']

/**
 * A little hanging ornament about `size` tall, facing +Z, whose top (the point a rope ties to) is at the origin.
 * Each is a handful of facets in the world's own gold, iron, wood and leaf swatches.
 */
export function charmGeometry(kind: CharmKind, size = 0.3): THREE.BufferGeometry {
  const s = size
  return fromFacets(f => {
    const y = (v: number) => -v * s
    switch (kind) {
      case 'coin': {
        f.swizzle = ([x, yy, z]) => [x, z - s * 0.5, yy]
        addLathe(f, [[0, -0.05 * s], [s * 0.46, -0.05 * s], [s * 0.46, 0.05 * s], [0, 0.05 * s]], 12, SWATCH.gold, SWATCH.gold)
        f.swizzle = null
        addBox(f, [0, y(0.5), 0.056 * s], [s * 0.05, s * 0.2, s * 0.012], SWATCH.woodDark, 0)
        addBox(f, [0, y(0.5), 0.056 * s], [s * 0.2, s * 0.05, s * 0.012], SWATCH.woodDark, 0)
        break
      }
      case 'gear': {
        const outline: [number, number][] = []
        const teeth = 8
        for (let i = 0; i < teeth * 4; i++) {
          const a = (i / (teeth * 4)) * Math.PI * 2
          const r = [0.5, 0.5, 0.36, 0.36][i % 4] * s
          outline.push([Math.cos(a) * r, Math.sin(a) * r + y(0.5)])
        }
        addExtrude(f, outline, s * 0.14, SWATCH.dark, SWATCH.slate)
        addBox(f, [0, y(0.5), s * 0.075], [s * 0.1, s * 0.1, s * 0.01], SWATCH.gold, 0)
        break
      }
      case 'planet': {
        addSphere(f, [0, y(0.5), 0], s * 0.3, SWATCH.orange, 7, 5)
        const ring: Vec3[] = []
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2
          ring.push([Math.cos(a) * s * 0.5, y(0.5) + Math.sin(a) * s * 0.12, Math.sin(a) * s * 0.18])
        }
        addTube(f, ring, s * 0.035, SWATCH.gold, 4, true)
        break
      }
      case 'dumbbell': {
        f.swizzle = ([x, yy, z]) => [yy - 0, x, z]
        addPrism(f, s * 0.05, -s * 0.42, s * 0.42, 6, SWATCH.silver)
        for (const sx of [-1, 1]) addPrism(f, s * 0.2, sx * s * 0.3 - s * 0.05, sx * s * 0.3 + s * 0.05, 8, SWATCH.dark)
        f.swizzle = null
        break
      }
      case 'leaf': {
        addExtrude(f, [[0, y(0.05)], [s * 0.3, y(0.45)], [0, y(0.95)], [-s * 0.3, y(0.45)]], s * 0.05, SWATCH.sage, SWATCH.olive)
        addBox(f, [0, y(0.5), s * 0.03], [s * 0.012, s * 0.4, s * 0.008], SWATCH.olive, 0)
        break
      }
      case 'padlock': {
        const arc: Vec3[] = []
        for (let i = 0; i <= 8; i++) {
          const a = Math.PI * (i / 8)
          arc.push([Math.cos(a) * s * 0.2, y(0.34) + Math.sin(a) * s * 0.22, 0])
        }
        addTube(f, arc, s * 0.04, SWATCH.silver, 4)
        addBox(f, [0, y(0.62), 0], [s * 0.3, s * 0.24, s * 0.1], SWATCH.gold, s * 0.03)
        addBox(f, [0, y(0.62), s * 0.105], [s * 0.04, s * 0.09, s * 0.008], SWATCH.dark, 0)
        break
      }
      case 'diamond': {
        const top: Vec3 = [0, y(0.08), 0], bottom: Vec3 = [0, y(0.92), 0]
        const mid = (a: number): Vec3 => [Math.cos(a) * s * 0.3, y(0.38), Math.sin(a) * s * 0.18]
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4
          const b = ((i + 1) / 4) * Math.PI * 2 + Math.PI / 4
          f.poly([top, mid(a), mid(b)], SWATCH.sky, [0, y(0.4), 0])
          f.poly([bottom, mid(a), mid(b)], SWATCH.sky, [0, y(0.4), 0])
        }
        break
      }
      case 'compass': {
        f.swizzle = ([x, yy, z]) => [x, z + y(0.5), yy]
        addLathe(f, [[0, -0.06 * s], [s * 0.42, -0.06 * s], [s * 0.42, 0.06 * s], [0, 0.06 * s]], 10, SWATCH.copper, SWATCH.paleRose)
        f.swizzle = null
        addExtrude(f, [[0, y(0.5) + s * 0.34], [s * 0.07, y(0.5)], [0, y(0.5) - s * 0.34], [-s * 0.07, y(0.5)]], s * 0.02, SWATCH.crimson)
        break
      }
      case 'acorn': {
        addLathe(f, [[0, y(0.95)], [s * 0.1, y(0.88)], [s * 0.26, y(0.62)], [s * 0.3, y(0.4)], [0, y(0.4)]], 7, SWATCH.tan)
        addLathe(f, [[0, y(0.42)], [s * 0.32, y(0.42)], [s * 0.32, y(0.3)], [0, y(0.1)]], 7, SWATCH.woodDark)
        break
      }
      case 'pennant': {
        addBox(f, [0, y(0.5), 0], [s * 0.015, s * 0.5, s * 0.015], SWATCH.woodDark, 0)
        addExtrude(f, [[s * 0.015, y(0.08)], [s * 0.5, y(0.24)], [s * 0.015, y(0.4)]], s * 0.02, SWATCH.orange)
        break
      }
      case 'pawn': {
        addLathe(f, [[0, y(0.98)], [s * 0.2, y(0.98)], [s * 0.1, y(0.78)], [s * 0.09, y(0.5)], [s * 0.14, y(0.4)], [s * 0.1, y(0.32)], [0, y(0.3)]], 7, SWATCH.woodDark)
        addSphere(f, [0, y(0.18), 0], s * 0.14, SWATCH.woodDark, 7, 4)
        break
      }
      case 'books': {
        addBox(f, [0, y(0.84), 0], [s * 0.36, s * 0.1, s * 0.16], SWATCH.crimson, s * 0.012, { right: SWATCH.paleRose })
        addBox(f, [s * 0.02, y(0.62), 0], [s * 0.32, s * 0.1, s * 0.15], SWATCH.sky, s * 0.012, { right: SWATCH.paleRose })
        addBox(f, [-s * 0.03, y(0.4), 0], [s * 0.34, s * 0.1, s * 0.16], SWATCH.gold, s * 0.012, { right: SWATCH.paleRose })
        break
      }
      case 'cards': {
        for (const [i, angle] of [-0.3, 0, 0.3].entries()) {
          const c = Math.cos(angle), n = Math.sin(angle)
          const pts = ([[-0.2, -0.3], [0.2, -0.3], [0.2, 0.3], [-0.2, 0.3]] as [number, number][]).map(([px, py]): [number, number] => [(px * c - py * n) * s, y(0.55) + (px * n + py * c) * s])
          addExtrude(f, pts, s * 0.012, [SWATCH.paleRose, SWATCH.white, SWATCH.peach][i], SWATCH.silver)
        }
        break
      }
      default: break
    }
  })
}

/* ---------------------------------------------------------------- merging -- */

export interface MergePart {
  geometry: THREE.BufferGeometry
  position?: Vec3
  /** Euler XYZ, radians. */
  rotation?: Vec3
  scale?: number | Vec3
  matrix?: THREE.Matrix4
}

const scratchMatrix = new THREE.Matrix4()
const scratchQuaternion = new THREE.Quaternion()
const scratchEuler = new THREE.Euler()
const scratchPosition = new THREE.Vector3()
const scratchScale = new THREE.Vector3()
const scratchVector = new THREE.Vector3()
const scratchNormalMatrix = new THREE.Matrix3()

/** `geometry` placed at `position`, turned by `rotation` and scaled. For mergeParts. */
export function place(geometry: THREE.BufferGeometry, position: Vec3 = [0, 0, 0], rotation: Vec3 = [0, 0, 0], scale: number | Vec3 = 1): MergePart {
  return { geometry, position, rotation, scale }
}

/**
 * Concatenates parts into ONE non-indexed geometry with position, normal and uv. Every part must carry those
 * attributes (the builders above do). Normals are transformed by the inverse transpose, so a scaled part still lights right.
 */
export function mergeParts(parts: (THREE.BufferGeometry | MergePart)[]): THREE.BufferGeometry {
  const items = parts.map((part): MergePart => part instanceof THREE.BufferGeometry ? { geometry: part } : part)
  const sources = items.map(item => item.geometry.index ? item.geometry.toNonIndexed() : item.geometry)
  const total = sources.reduce((sum, g) => sum + g.getAttribute('position').count, 0)
  const position = new Float32Array(total * 3)
  const normal = new Float32Array(total * 3)
  const uv = new Float32Array(total * 2)
  let offset = 0
  items.forEach((item, index) => {
    const source = sources[index]
    const p = source.getAttribute('position')
    const n = source.getAttribute('normal')
    const t = source.getAttribute('uv')
    if (item.matrix) scratchMatrix.copy(item.matrix)
    else {
      scratchPosition.set(...(item.position ?? [0, 0, 0]))
      scratchEuler.set(...(item.rotation ?? [0, 0, 0]))
      scratchQuaternion.setFromEuler(scratchEuler)
      if (typeof item.scale === 'number') scratchScale.setScalar(item.scale)
      else scratchScale.set(...(item.scale ?? [1, 1, 1]))
      scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale)
    }
    scratchNormalMatrix.getNormalMatrix(scratchMatrix)
    for (let i = 0; i < p.count; i++) {
      scratchVector.fromBufferAttribute(p, i).applyMatrix4(scratchMatrix)
      position.set([scratchVector.x, scratchVector.y, scratchVector.z], (offset + i) * 3)
      if (n) {
        scratchVector.fromBufferAttribute(n, i).applyMatrix3(scratchNormalMatrix).normalize()
        normal.set([scratchVector.x, scratchVector.y, scratchVector.z], (offset + i) * 3)
      }
      if (t) uv.set([t.getX(i), t.getY(i)], (offset + i) * 2)
    }
    offset += p.count
  })
  sources.forEach((g, i) => { if (g !== items[i].geometry) g.dispose() })
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3))
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  merged.computeBoundingSphere()
  merged.computeBoundingBox()
  return merged
}

/** Triangles in a geometry, indexed or not. */
export const triangleCount = (geometry: THREE.BufferGeometry): number =>
  (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3
