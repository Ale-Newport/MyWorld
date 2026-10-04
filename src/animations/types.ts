import type { MutableRefObject } from 'react'

/** What every library effect receives from its frame. */
export interface EffectProps {
  /** Validated and defaulted by the effect itself; unknown keys are ignored. */
  params: Record<string, unknown>
  /** 0..1 across the effect's scroll range, updated every frame without re-rendering. */
  progress: MutableRefObject<number>
  /** The trigger state: in view, hovered, clicked or timed, per the effect's settings. */
  active: boolean
  reducedMotion: boolean
}

export const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}
export const str = (v: unknown, fallback: string, max = 2000) => (typeof v === 'string' && v.length ? v.slice(0, max) : fallback)
export const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
export const pick = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback)
export const color = (v: unknown, fallback: string) => (typeof v === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|var\(--[a-z0-9-]+\))$/i.test(v) ? v : fallback)
