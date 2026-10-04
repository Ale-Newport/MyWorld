'use client'

import { num, pick, str, bool, type EffectProps } from '../types'
import { useRunClock } from './kit'
import s from './css/typewriter.module.css'

/** Types a line out character by character behind a caret; can erase and retype. */
export default function TypewriterEffect({ params, active, reducedMotion }: EffectProps) {
  const text = str(params.text, 'Designing systems that learn.', 300)
  const cps = num(params.cps, 18, 2, 80)
  const caret = pick(params.caret, ['bar', 'block', 'underscore'] as const, 'bar')
  const loop = bool(params.loop, false)
  const hold = num(params.hold, 2.5, 0.2, 12)
  const size = num(params.size, 3, 1, 9)
  const typeTime = text.length / cps
  const cycle = typeTime * 2 + hold * 2
  const t = useRunClock(active && !reducedMotion, loop ? Infinity : typeTime + 0.1)
  let shown = text.length
  if (!reducedMotion) {
    const u = loop ? t % cycle : t
    shown = u < typeTime ? Math.floor(u * cps) : u < typeTime + hold ? text.length : u < typeTime * 2 + hold ? Math.max(0, text.length - Math.floor((u - typeTime - hold) * cps * 1.6)) : 0
    if (!active) shown = 0
  }
  return (
    <div className={s.wrap} style={{ fontSize: `clamp(1.2rem, ${size}vw, ${size * 1.5}rem)` }}>
      <p className={s.line}>
        <span className="sr-only">{text}</span>
        <span aria-hidden="true">{text.slice(0, shown)}</span>
        <span aria-hidden="true" className={s.caret} data-kind={caret} data-still={reducedMotion || undefined} />
      </p>
    </div>
  )
}
