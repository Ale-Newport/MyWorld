'use client'

import { bool, num, pick, str, type EffectProps } from '../types'
import { parsePairs } from './kit'
import s from './css/bars.module.css'

/** A small bar chart from "Label: value" pairs; the bars grow in one after another. */
export default function BarsEffect({ params, active, reducedMotion }: EffectProps) {
  const data = parsePairs(str(params.data, 'Retrieval: 92; Vision: 81; Product: 88; Systems: 76', 800))
  const unit = str(params.unit, '%', 8)
  const vertical = pick(params.orientation, ['horizontal', 'vertical'] as const, 'horizontal') === 'vertical'
  const max = num(params.max, 0, 0, 1e12) || Math.max(1, ...data.map((d) => d.value))
  const stagger = num(params.stagger, 0.08, 0, 1)
  const duration = num(params.duration, 1.1, 0.1, 6)
  const values = bool(params.showValues, true)
  const on = reducedMotion || active
  return (
    <div className={s.wrap} data-vertical={vertical || undefined} style={{ ['--dur' as string]: reducedMotion ? '0s' : `${duration}s` }}>
      <ul className={s.list}>
        {data.map((d, i) => (
          <li key={i} className={s.row} style={{ ['--v' as string]: on ? Math.max(0, d.value) / max : 0, transitionDelay: on && !reducedMotion ? `${i * stagger}s` : '0s' }}>
            <span className={s.label}>{d.label}</span>
            <span className={s.track} aria-hidden="true"><span className={s.bar} style={{ transitionDelay: on && !reducedMotion ? `${i * stagger}s` : '0s' }} /></span>
            {values && <span className={s.value}>{d.value.toLocaleString('en-GB')}{unit}</span>}
            {!values && <span className="sr-only">{d.value}{unit}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
