'use client'

import { num, str, type EffectProps } from '../types'
import { easeOutCubic, useRunClock } from './kit'
import s from './css/gauge.module.css'

/** A ring that fills to a value while the number counts up with it. */
export default function GaugeEffect({ params, active, reducedMotion }: EffectProps) {
  const value = num(params.value, 72, 0, 100)
  const label = str(params.label, 'Accuracy', 80)
  const suffix = str(params.suffix, '%', 6)
  const thickness = num(params.thickness, 10, 1, 30)
  const duration = num(params.duration, 1.6, 0.1, 8)
  const sweep = num(params.sweep, 270, 90, 360)
  const t = useRunClock(active && !reducedMotion, duration)
  const k = reducedMotion ? 1 : active ? easeOutCubic(t / duration) : 0
  const r = 50 - thickness / 2 - 1
  const c = 2 * Math.PI * r
  const arc = (sweep / 360) * c
  const shown = value * k
  return (
    <div className={s.wrap}>
      <svg viewBox="0 0 100 100" className={s.svg} role="img" aria-label={`${label}: ${value}${suffix}`}>
        <g transform={`rotate(${90 + (360 - sweep) / 2} 50 50)`}>
          <circle cx="50" cy="50" r={r} fill="none" className={s.track} strokeWidth={thickness} strokeDasharray={`${arc} ${c}`} strokeLinecap="round" />
          <circle cx="50" cy="50" r={r} fill="none" className={s.fill} strokeWidth={thickness} strokeDasharray={`${(arc * shown) / 100} ${c}`} strokeLinecap="round" />
        </g>
        <text x="50" y="50" className={s.value} textAnchor="middle" dominantBaseline="central">{Math.round(shown)}{suffix}</text>
        <text x="50" y={sweep < 300 ? 78 : 66} className={s.label} textAnchor="middle">{label.toUpperCase()}</text>
      </svg>
    </div>
  )
}
