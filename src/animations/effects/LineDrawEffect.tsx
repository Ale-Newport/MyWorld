'use client'

import { useMemo } from 'react'
import { bool, num, pick, type EffectProps } from '../types'
import { mulberry32, useLiveProgress } from './kit'
import s from './css/linedraw.module.css'

const SHAPES = ['wave', 'spiral', 'signature', 'circuit', 'ridge'] as const
type Shape = (typeof SHAPES)[number]

function shapePath(shape: Shape, seed: number): string {
  const rnd = mulberry32(seed)
  if (shape === 'wave') { let d = 'M0,50'; for (let x = 0; x <= 200; x += 2) d += ` L${x},${50 + Math.sin(x / 14) * 22 * Math.sin(x / 70 + 0.4)}`; return d }
  if (shape === 'spiral') { let d = ''; for (let i = 0; i <= 420; i++) { const a = i / 18, r = 1 + a * 1.9; d += `${i ? ' L' : 'M'}${(100 + Math.cos(a) * r * 1.9).toFixed(2)},${(50 + Math.sin(a) * r).toFixed(2)}` } return d }
  if (shape === 'circuit') {
    let d = '', x = 6, y = 50
    d = `M${x},${y}`
    while (x < 194) { const horizontal = rnd() > 0.35; if (horizontal) x = Math.min(194, x + 10 + rnd() * 26); else y = Math.max(10, Math.min(90, y + (rnd() > 0.5 ? 1 : -1) * (8 + rnd() * 22))); d += ` L${x.toFixed(1)},${y.toFixed(1)}` }
    return d
  }
  if (shape === 'ridge') { let d = 'M0,80', y = 70; for (let x = 0; x <= 200; x += 5) { y = Math.max(18, Math.min(88, y + (rnd() - 0.52) * 16)); d += ` L${x},${y.toFixed(1)}` } return d }
  // signature: a looping hand-drawn stroke
  let d = 'M8,62', x = 8
  while (x < 186) { const loop = 10 + rnd() * 16, up = 20 + rnd() * 26; d += ` C${x + loop * 0.2},${62 - up} ${x + loop},${62 - up} ${x + loop * 0.7},${60} S${x + loop * 1.6},${70 + rnd() * 8} ${x + loop * 1.4},${58}`; x += loop * 1.1 }
  return d
}

/** A single stroke drawing itself — when triggered, or with the scroll. */
export default function LineDrawEffect({ params, active, reducedMotion, progress }: EffectProps) {
  const shape = pick(params.shape, SHAPES, 'signature')
  const width = num(params.strokeWidth, 2, 0.3, 8)
  const mode = pick(params.mode, ['trigger', 'scroll'] as const, 'trigger')
  const duration = num(params.duration, 2.4, 0.2, 12)
  const loop = bool(params.loop, false)
  const seed = Math.round(num(params.seed, 3, 1, 9999))
  const d = useMemo(() => shapePath(shape, seed), [shape, seed])
  const p = useLiveProgress(progress, mode === 'scroll' && !reducedMotion)
  const offset = reducedMotion ? 0 : mode === 'scroll' ? 1 - Math.min(1, p * 1.25) : active ? 0 : 1
  return (
    <svg viewBox="0 0 200 100" preserveAspectRatio="xMidYMid meet" className={s.svg} aria-hidden="true" data-mode={mode} data-loop={loop && active && !reducedMotion && mode === 'trigger' ? '' : undefined} style={{ ['--dur' as string]: `${duration}s` }}>
      <path d={d} pathLength={1} className={s.path} strokeWidth={width} style={{ strokeDashoffset: offset }} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
