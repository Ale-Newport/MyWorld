'use client'

import { color, num, pick, str, type EffectProps } from '../types'
import s from './css/wipe.module.css'

/** A block of colour sweeps across and away, leaving the words behind — every time it is triggered. */
export default function WipeEffect({ params, active, reducedMotion }: EffectProps) {
  const text = str(params.text, 'Selected work', 200)
  const direction = pick(params.direction, ['left', 'right', 'up', 'down'] as const, 'right')
  const fill = color(params.wipeColor, 'var(--fx-accent)')
  const duration = num(params.duration, 0.9, 0.2, 4)
  const size = num(params.size, 4, 1, 10)
  return (
    <div className={s.wrap} style={{ fontSize: `clamp(1.4rem, ${size}vw, ${size * 1.6}rem)`, ['--wipe' as string]: fill, ['--dur' as string]: `${duration}s` }}>
      <p className={s.text} data-dir={direction} data-state={reducedMotion ? 'still' : active ? 'run' : 'idle'} key={active ? 'on' : 'off'}>
        <span className={s.words}>{text}</span>
        <span className={s.block} aria-hidden="true" />
      </p>
    </div>
  )
}
