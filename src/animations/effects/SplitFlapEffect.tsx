'use client'

import { num, pick, str, type EffectProps } from '../types'
import { useRunClock } from './kit'
import s from './css/splitflap.module.css'

const CHARSET = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:.-/'

/** A departure board: every cell flips through the alphabet until it reaches its letter. */
export default function SplitFlapEffect({ params, active, reducedMotion }: EffectProps) {
  const text = str(params.text, 'NEXT: LONDON 09:41', 40).toUpperCase()
  const flip = num(params.flipMs, 70, 30, 400) / 1000
  const stagger = num(params.stagger, 0.04, 0, 0.3)
  const theme = pick(params.theme, ['dark', 'light'] as const, 'dark')
  const cells = [...text].map((c) => (CHARSET.includes(c) ? c : ' '))
  const longest = Math.max(...cells.map((c, i) => i * stagger + CHARSET.indexOf(c) * flip))
  const t = useRunClock(active && !reducedMotion, longest + flip)
  return (
    <div className={s.wrap} data-theme={theme} role="img" aria-label={text}>
      <div className={s.board} aria-hidden="true">
        {cells.map((target, i) => {
          const goal = CHARSET.indexOf(target)
          const steps = reducedMotion ? goal : active ? Math.min(goal, Math.max(0, Math.floor((t - i * stagger) / flip))) : 0
          const ch = CHARSET[steps]
          const flipping = !reducedMotion && active && steps < goal
          return <span key={i} className={s.cell} data-flip={flipping || undefined} style={{ animationDuration: `${flip}s` }}><span>{ch}</span></span>
        })}
      </div>
    </div>
  )
}
