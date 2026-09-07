import * as THREE from 'three'
import { ALPHABET, GLYPH_SPACING, GLYPH_WIDTH, SPACE_WIDTH, measure, type Stroke } from './alphabet'

/* ============================================================
   PHYSICAL TYPOGRAPHY

   Sweeps a rectangular profile along each stroke of a glyph and
   extrudes it in Z, producing solid letters that stand on the
   ground, cast shadows and can carry colliders.

   Joins are mitred where the turn is gentle and bevelled where
   it is sharp, which is what stops the M and the W from growing
   spikes at their vertices. Caps are square: this is signage cut
   from sheet, not a brush stroke.

   The output is ONE geometry per string, so a word is one draw
   call rather than nine.
   ============================================================ */

export interface TextGeometryOptions {
  /** Cap height in metres. Everything else scales from it. */
  size?: number
  /** Stroke weight as a fraction of cap height. */
  weight?: number
  /** Extrusion depth in metres. */
  depth?: number
  /** 'left' puts the origin at the start; 'center' centres the run. */
  align?: 'left' | 'center'
}

/** Per-letter geometry plus the box it occupies, for colliders. */
export interface LetterLayout {
  char: string
  /** Offset of the letter's left edge from the run's origin. */
  x: number
  width: number
}

/**
 * Builds one merged geometry for `text`, standing on the XY plane
 * with the baseline at y = 0 and extruded along +Z.
 */
export function textGeometry(
  text: string,
  options: TextGeometryOptions = {},
): { geometry: THREE.BufferGeometry; width: number; letters: LetterLayout[] } {
  const size = options.size ?? 1
  const weight = (options.weight ?? 0.15) * size
  const depth = options.depth ?? size * 0.28
  const align = options.align ?? 'center'

  const upper = text.toUpperCase()
  const runWidth = measure(upper) * size
  const startX = align === 'center' ? -runWidth / 2 : 0

  const positions: number[] = []
  const normals: number[] = []
  const letters: LetterLayout[] = []

  let cursor = startX
  for (const char of upper) {
    if (char === ' ') {
      cursor += (SPACE_WIDTH + GLYPH_SPACING) * size
      continue
    }
    const strokes = ALPHABET[char]
    if (!strokes) continue

    letters.push({ char, x: cursor, width: GLYPH_WIDTH * size })

    for (const stroke of strokes) {
      emitStroke(stroke, cursor, size, weight, depth, positions, normals)
    }

    cursor += (GLYPH_WIDTH + GLYPH_SPACING) * size
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  return { geometry, width: runWidth, letters }
}

/* ---------------------------------------------------------- */

function emitStroke(
  stroke: Stroke,
  offsetX: number,
  size: number,
  weight: number,
  depth: number,
  positions: number[],
  normals: number[],
): void {
  // Scale into world units, dropping any zero-length repeats which
  // would otherwise produce a NaN normal.
  const points: [number, number][] = []
  for (const [x, y] of stroke) {
    const px = offsetX + x * size
    const py = y * size
    const last = points[points.length - 1]
    if (last && Math.hypot(last[0] - px, last[1] - py) < 1e-6) continue
    points.push([px, py])
  }
  if (points.length < 2) {
    // A degenerate stroke is a dot — a full stop, or a colon.
    if (points.length === 1) emitDot(points[0], weight, depth, positions, normals)
    return
  }

  const closed =
    points.length > 2 &&
    Math.hypot(points[0][0] - points[points.length - 1][0], points[0][1] - points[points.length - 1][1]) < 1e-6

  const half = weight / 2
  // Left and right offsets of the sweep, per point.
  const left: [number, number][] = []
  const right: [number, number][] = []

  const count = closed ? points.length - 1 : points.length
  for (let i = 0; i < count; i++) {
    const previous = points[(i - 1 + count) % count]
    const current = points[i]
    const next = points[(i + 1) % count]

    const hasPrevious = closed || i > 0
    const hasNext = closed || i < count - 1

    const inDir = hasPrevious ? normalise(current[0] - previous[0], current[1] - previous[1]) : null
    const outDir = hasNext ? normalise(next[0] - current[0], next[1] - current[1]) : null

    let nx: number
    let ny: number

    if (inDir && outDir) {
      // Mitre. Clamped so a hairpin does not throw the joint to
      // infinity — past the limit it degrades to a bevel.
      const mx = inDir[0] + outDir[0]
      const my = inDir[1] + outDir[1]
      const length = Math.hypot(mx, my)
      if (length < 1e-4) {
        nx = -inDir[1]
        ny = inDir[0]
      } else {
        const mnx = -my / length
        const mny = mx / length
        const cos = mnx * -inDir[1] + mny * inDir[0]
        const scale = Math.min(3, 1 / Math.max(0.28, Math.abs(cos)))
        nx = mnx * scale
        ny = mny * scale
      }
    } else {
      const dir = (inDir ?? outDir)!
      nx = -dir[1]
      ny = dir[0]
    }

    left.push([current[0] + nx * half, current[1] + ny * half])
    right.push([current[0] - nx * half, current[1] - ny * half])
  }

  if (closed) {
    left.push(left[0])
    right.push(right[0])
  }

  const front = depth / 2
  const back = -depth / 2

  const quad = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
  ) => {
    const normal = faceNormal(a, b, c)
    for (const v of [a, b, c, a, c, d]) {
      positions.push(v[0], v[1], v[2])
      normals.push(normal[0], normal[1], normal[2])
    }
  }

  for (let i = 0; i < left.length - 1; i++) {
    const l0 = left[i]
    const l1 = left[i + 1]
    const r0 = right[i]
    const r1 = right[i + 1]

    // Front and back faces.
    quad([l0[0], l0[1], front], [r0[0], r0[1], front], [r1[0], r1[1], front], [l1[0], l1[1], front])
    quad([l1[0], l1[1], back], [r1[0], r1[1], back], [r0[0], r0[1], back], [l0[0], l0[1], back])
    // The two sides.
    quad([l0[0], l0[1], back], [l0[0], l0[1], front], [l1[0], l1[1], front], [l1[0], l1[1], back])
    quad([r1[0], r1[1], back], [r1[0], r1[1], front], [r0[0], r0[1], front], [r0[0], r0[1], back])
  }

  if (!closed) {
    // Square end caps.
    const s = 0
    const e = left.length - 1
    quad(
      [left[s][0], left[s][1], back], [right[s][0], right[s][1], back],
      [right[s][0], right[s][1], front], [left[s][0], left[s][1], front],
    )
    quad(
      [left[e][0], left[e][1], front], [right[e][0], right[e][1], front],
      [right[e][0], right[e][1], back], [left[e][0], left[e][1], back],
    )
  }
}

function emitDot(
  point: [number, number],
  weight: number,
  depth: number,
  positions: number[],
  normals: number[],
): void {
  const half = weight / 2
  const box = new THREE.BoxGeometry(weight, weight, depth)
  box.translate(point[0], point[1] + half, 0)
  const p = box.getAttribute('position')
  const n = box.getAttribute('normal')
  const index = box.getIndex()
  if (!index) return
  for (let i = 0; i < index.count; i++) {
    const v = index.getX(i)
    positions.push(p.getX(v), p.getY(v), p.getZ(v))
    normals.push(n.getX(v), n.getY(v), n.getZ(v))
  }
  box.dispose()
}

function normalise(x: number, y: number): [number, number] {
  const length = Math.hypot(x, y) || 1
  return [x / length, y / length]
}

function faceNormal(
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
): [number, number, number] {
  const ux = b[0] - a[0]
  const uy = b[1] - a[1]
  const uz = b[2] - a[2]
  const vx = c[0] - a[0]
  const vy = c[1] - a[1]
  const vz = c[2] - a[2]
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  const length = Math.hypot(nx, ny, nz) || 1
  return [nx / length, ny / length, nz / length]
}

/* ============================================================
   CONVENIENCE
   ============================================================ */

/**
 * A word standing upright on the ground, facing +Z, with its
 * baseline on the terrain. Returns per-letter boxes so the caller
 * can give each letter its own collider.
 */
export function standingText(
  text: string,
  options: TextGeometryOptions & { thickness?: number } = {},
): {
  geometry: THREE.BufferGeometry
  width: number
  /** Half-extents and centres for one box collider per letter. */
  colliders: { x: number; y: number; halfWidth: number; halfHeight: number; halfDepth: number }[]
} {
  const size = options.size ?? 1
  const { geometry, width, letters } = textGeometry(text, options)
  const depth = options.depth ?? size * 0.28

  const colliders = letters.map((letter) => ({
    x: letter.x + letter.width / 2,
    y: size / 2,
    halfWidth: letter.width / 2,
    halfHeight: size / 2,
    halfDepth: depth / 2,
  }))

  return { geometry, width, colliders }
}
