'use client'

import { useEffect, useState, type MutableRefObject } from 'react'
import { useMotionTuning } from '../tuning'

/* ============================================================
   SHARED PIECES FOR LIBRARY EFFECTS

   A clock that runs only while an effect is active and honours
   the frame's Speed control; the frame's scroll progress as a
   value a DOM effect can render; the frame's colours resolved to
   real rgb() values for canvases; a seeded random generator and
   smooth 3D noise. Nothing here touches the network or evaluates
   anything: effects are code in this repository, configured only
   by validated data.
   ============================================================ */

/** Seconds since `run` became true, scaled by Speed; re-renders each frame until `until`. Zero while not running. */
export function useRunClock(run: boolean, until = Infinity): number {
  const { timeScale } = useMotionTuning()
  const [t, setT] = useState(0)
  useEffect(() => {
    if (!run) return
    let raf = 0
    let last = 0
    let clock = 0
    const tick = (now: number) => {
      clock += Math.min(0.1, (now - last) / 1000) * timeScale
      last = now
      setT(clock)
      if (clock < until) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame((now) => { last = now; setT(0); raf = requestAnimationFrame(tick) })
    return () => cancelAnimationFrame(raf)
  }, [run, until, timeScale])
  return run ? t : 0
}

/** The frame's scroll progress (written to a ref every frame) as state, updated when it moves. */
export function useLiveProgress(progress: MutableRefObject<number>, enabled: boolean): number {
  const [p, setP] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let raf = 0
    let last = -1
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const v = progress.current
      if (Math.abs(v - last) > 0.002) { last = v; setP(v) }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [progress, enabled])
  return p
}

export interface FxColors { accent: string; ink: string; surface: string; faint: string }

/** Resolves the frame's colour variables (which may themselves be var() references) to rgb() strings. */
export function resolveFx(el: Element | null): FxColors {
  const fallback = { accent: '#d4491f', ink: '#0c0c0d', surface: 'transparent', faint: 'rgba(12,12,13,.18)' }
  if (!el || typeof document === 'undefined') return fallback
  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden'
  el.appendChild(probe)
  const read = (v: string) => { probe.style.color = ''; probe.style.color = v; return getComputedStyle(probe).color }
  const out = {
    accent: read('var(--fx-accent, var(--accent, #d4491f))'),
    ink: read('var(--fx-ink, var(--text-primary, #0c0c0d))'),
    surface: read('var(--fx-surface, transparent)'),
    faint: read('var(--text-faint, #a6a6ad)'),
  }
  probe.remove()
  return out
}

/** Any colour the schema allows (hex, rgb(), hsl(), var(--token)) as the rgb() a canvas can use. */
export function resolveColor(el: Element | null, value: string): string {
  if (!el || typeof document === 'undefined') return value
  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden'
  probe.style.color = value
  el.appendChild(probe)
  const out = getComputedStyle(probe).color
  probe.remove()
  return out
}

/** `rgb(r, g, b)` / `rgba(...)` with a new alpha. */
export function alpha(color: string, a: number): string {
  const m = /rgba?\(([^)]+)\)/.exec(color)
  if (!m) return color
  const [r, g, b] = m[1].split(',').map((x) => x.trim())
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Smooth 3D gradient noise in [-1, 1], seeded. */
export function makeNoise(seed = 1) {
  const rand = mulberry32(seed)
  const perm = new Uint8Array(512)
  const p = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]] }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
  const lerp = (a: number, b: number, t: number) => a + t * (b - a)
  const grad = (h: number, x: number, y: number, z: number) => {
    const u = (h & 15) < 8 ? x : y
    const v = (h & 15) < 4 ? y : (h & 15) === 12 || (h & 15) === 14 ? x : z
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v)
  }
  return (x: number, y: number, z = 0) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z)
    const u = fade(x), v = fade(y), w = fade(z)
    const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z, B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z
    return lerp(
      lerp(lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u), lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u), v),
      lerp(lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u), lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u), v),
      w,
    )
  }
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3)
export const easeInOutCubic = (t: number) => { const x = clamp01(t); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2 }

/** "Label: 12; Other: 30" → [{label, value}]. Bad entries are skipped. */
export function parsePairs(text: string, max = 12): { label: string; value: number }[] {
  return text.split(/[;\n]/).map((p) => p.split(':')).filter((p) => p.length >= 2).map(([l, v]) => ({ label: l.trim().slice(0, 40), value: Number(v.trim()) })).filter((p) => p.label && Number.isFinite(p.value)).slice(0, max)
}

/** "3, 5, 8" → numbers. */
export function parseNumbers(text: string, max = 200): number[] {
  return text.split(/[,\s]+/).map(Number).filter(Number.isFinite).slice(0, max)
}
