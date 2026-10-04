'use client'

import { useEffect, useMemo, useRef } from 'react'
import { num, pick, type EffectProps } from '../types'
import { mulberry32 } from './kit'
import s from './effects.module.css'

const PALETTES = { accent: ['var(--fx-accent)', 'var(--fx-ink)'], ink: ['var(--fx-ink)', 'var(--fx-ink)'], dusk: ['#3b3a5a', '#d4491f'] } as const

/** Paper-cut ridgelines that slide past each other at different rates as the page scrolls. */
export default function ParallaxLayersEffect({ params, progress, reducedMotion }: EffectProps) {
  const layers = Math.round(num(params.layers, 5, 2, 8))
  const depth = num(params.depth, 0.8, 0, 2)
  const palette = pick(params.palette, ['accent', 'ink', 'dusk'] as const, 'accent')
  const horizon = num(params.horizon, 0.45, 0.2, 0.8)
  const seed = Math.round(num(params.seed, 9, 1, 9999))
  const groups = useRef<(SVGGElement | null)[]>([])
  const paths = useMemo(() => {
    const r = mulberry32(seed)
    return Array.from({ length: layers }, (_, i) => {
      const base = 100 * horizon + (i / layers) * 100 * (1 - horizon) * 0.8
      let y = base, d = `M-20,140 L-20,${y.toFixed(1)}`
      for (let x = -20; x <= 220; x += 6) { y = Math.max(base - 26, Math.min(base + 12, y + (r() - 0.5) * (10 - i))); d += ` L${x},${y.toFixed(1)}` }
      return `${d} L220,140 Z`
    })
  }, [layers, horizon, seed])
  useEffect(() => {
    if (reducedMotion) return
    let raf = 0, last = -1
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const p = progress.current
      if (Math.abs(p - last) < 0.0005) return
      last = p
      groups.current.forEach((g, i) => { if (g) g.setAttribute('transform', `translate(0 ${((p - 0.5) * depth * 40 * (layers - i)) / layers})`) })
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [progress, depth, layers, reducedMotion])
  const [far, near] = PALETTES[palette]
  return (
    <svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMax slice" className={s.fill} aria-hidden="true">
      {paths.map((d, i) => (
        <g key={i} ref={(el) => { groups.current[i] = el }}>
          <path d={d} fill={i === layers - 1 ? near : far} fillOpacity={0.12 + (i / layers) * 0.6} />
        </g>
      ))}
    </svg>
  )
}
