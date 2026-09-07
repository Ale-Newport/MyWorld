/* ============================================================
   PORTED FROM: sources/Game/utilities/maths.js
   folio-2025 — Copyright (c) 2025 Bruno Simon — MIT
   https://github.com/brunosimon/folio-2025
   See THIRD_PARTY_NOTICES.md and ../vendor/LICENSE-folio-2025.md

   Translated to TypeScript. Behaviour unchanged; a few helpers
   the port does not use were dropped, and a few were added at
   the bottom.
   ============================================================ */

export function clamp(input: number, min: number, max: number): number {
  return Math.max(min, Math.min(input, max))
}

export function remap(
  input: number,
  inLow: number,
  inHigh: number,
  outLow: number,
  outHigh: number,
): number {
  return ((input - inLow) * (outHigh - outLow)) / (inHigh - inLow) + outLow
}

export function remapClamp(
  input: number,
  inLow: number,
  inHigh: number,
  outLow: number,
  outHigh: number,
): number {
  return clamp(
    ((input - inLow) * (outHigh - outLow)) / (inHigh - inLow) + outLow,
    outLow < outHigh ? outLow : outHigh,
    outLow > outHigh ? outLow : outHigh,
  )
}

export function lerp(start: number, end: number, ratio: number): number {
  return (1 - ratio) * start + ratio * end
}

export function smoothstep(value: number, min: number, max: number): number {
  const x = clamp((value - min) / (max - min), 0, 1)
  return x * x * (3 - 2 * x)
}

export function safeMod(n: number, m: number): number {
  return ((n % m) + m) % m
}

const TAU = Math.PI * 2
const equivalent = (a: number) => safeMod(a + Math.PI, TAU) - Math.PI

/** Shortest signed angle from `current` to `target`, in [-π, +π]. */
export function smallestAngle(current: number, target: number): number {
  return equivalent(target - current)
}

export function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

export function lineIntersectsCircle(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  center: { x: number; y: number },
  radius: number,
): boolean {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  const fx = center.x - p1.x
  const fy = center.y - p1.y
  const t = (fx * dx + fy * dy) / (dx * dx + dy * dy)

  let closest: { x: number; y: number }
  if (t < 0) closest = p1
  else if (t > 1) closest = p2
  else closest = { x: p1.x + t * dx, y: p1.y + t * dy }

  return dist(closest, center) <= radius
}

export function pointInPolygon(
  point: { x: number; y: number },
  poly: { x: number; y: number }[],
): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x
    const yi = poly[i].y
    const xj = poly[j].x
    const yj = poly[j].y
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/* ---- additions for this project ------------------------- */

/** Frame-rate independent exponential approach. */
export function damp(a: number, b: number, lambda: number, dt: number): number {
  return lerp(a, b, 1 - Math.exp(-lambda * dt))
}

/** Deterministic PRNG. Same seed, same world, every reload. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Squared 2D distance — for the many "is the player near X" tests. */
export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx
  const dz = az - bz
  return dx * dx + dz * dz
}

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

/** mm:ss.mmm — lap and best times. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--.---'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 1000)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}
