'use client'

import { Counter } from '@/components/typography/Counter'
import { num, str, type EffectProps } from '../types'
import styles from './effects.module.css'

/** The site's count-up metric, as a placeable block. */
export default function CounterEffect({ params, active }: EffectProps) {
  const to = num(params.to, 500000, 0, 1e12)
  const label = str(params.label, 'Documents processed', 120)
  return (
    <div className={styles.metric}>
      <span className={styles.metricValue}>
        {active ? <Counter key={String(active)} to={to} prefix={str(params.prefix, '', 8)} suffix={str(params.suffix, '+', 8)} duration={num(params.duration, 1.8, 0.2, 10)} immediate /> : <span>{str(params.prefix, '', 8)}0{str(params.suffix, '+', 8)}</span>}
      </span>
      <span className={styles.metricLabel}>{label}</span>
    </div>
  )
}
