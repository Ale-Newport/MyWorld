/* ============================================================
   DETERMINISTIC RANDOMNESS
   Ported from the procedural-room prototype: the same seeded
   generator, integer hash and value noise, so a given seed grows
   the same plants on every visit, every resize and every scroll
   direction. Nothing in the room may call Math.random().
   ============================================================ */

export const TAU = Math.PI * 2

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smooth = (x: number) => {
  const t = clamp(x)
  return t * t * (3 - 2 * t)
}
export const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x), 3)

export type Rng = () => number

/** mulberry32 — the prototype's `random(seed)`. */
export function random(seed: number): Rng {
  let s = seed | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Integer lattice hash in [0, 1). */
export function hash(x: number, y: number): number {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

/** Smooth value noise in [0, 1). */
export function noise(x: number, y: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = smooth(x - ix)
  const fy = smooth(y - iy)
  return lerp(
    lerp(hash(ix, iy), hash(ix + 1, iy), fx),
    lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), fx),
    fy,
  )
}

/** Three octaves, the prototype's weighting. */
export const fbm = (x: number, y: number) =>
  0.55 * noise(x, y) + 0.28 * noise(x * 2.07 + 8, y * 2.07 + 3) + 0.17 * noise(x * 4.3, y * 4.3 + 17)

export interface UV {
  u: number
  v: number
}

/** Catmull–Rom through 2D knots, t in 0..1 — the prototype's `catmull`. */
export function catmull(knots: ReadonlyArray<readonly [number, number]>, t: number): UV {
  const z = clamp(t) * (knots.length - 1)
  const i = Math.min(knots.length - 2, Math.floor(z))
  const f = z - i
  const a = knots[Math.max(0, i - 1)]
  const b = knots[i]
  const c = knots[i + 1]
  const d = knots[Math.min(knots.length - 1, i + 2)]
  const calc = (k: 0 | 1) =>
    0.5 *
    (2 * b[k] +
      (-a[k] + c[k]) * f +
      (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * f * f +
      (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * f * f * f)
  return { u: calc(0), v: calc(1) }
}
