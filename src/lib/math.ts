export const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v))

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Frame-rate independent damping. */
export const damp = (a: number, b: number, lambda: number, dt: number) =>
  lerp(a, b, 1 - Math.exp(-lambda * dt))

/** Remap x from [a,b] to 0..1, clamped. */
export const range = (x: number, a: number, b: number) => clamp((x - a) / (b - a || 1e-6))

/** Remap x from [a,b] to [c,d], clamped. */
export const remap = (x: number, a: number, b: number, c: number, d: number) =>
  c + range(x, a, b) * (d - c)

/** 0 → 1 → 0 across [a,b]. */
export const bell = (x: number, a: number, b: number) => {
  const t = range(x, a, b)
  return Math.sin(t * Math.PI)
}

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
export const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t))
export const easeInOutQuint = (t: number) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2)

/** Deterministic hash-based PRNG — stable across renders and SSR. */
export function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Fibonacci sphere point — even distribution, no clumping. */
export function fibonacciSphere(i: number, n: number, radius = 1): [number, number, number] {
  const k = i + 0.5
  const phi = Math.acos(1 - (2 * k) / n)
  const theta = Math.PI * (1 + Math.sqrt(5)) * k
  return [
    radius * Math.cos(theta) * Math.sin(phi),
    radius * Math.sin(theta) * Math.sin(phi),
    radius * Math.cos(phi),
  ]
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`
  return String(Math.round(n))
}
