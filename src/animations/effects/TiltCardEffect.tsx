'use client'

import { useRef, type PointerEvent } from 'react'
import { num, str, type EffectProps } from '../types'
import s from './css/tilt.module.css'

/** A card that tilts towards the pointer with a moving sheen; its layers sit at different depths. */
export default function TiltCardEffect({ params, reducedMotion }: EffectProps) {
  const title = str(params.title, 'Retrieval at scale', 120)
  const eyebrow = str(params.eyebrow, 'Case study', 60)
  const body = str(params.body, 'Hybrid search over half a million documents, answered in under a second.', 300)
  const max = num(params.maxTilt, 12, 0, 30)
  const glare = num(params.glare, 0.35, 0, 1)
  const depth = num(params.depth, 24, 0, 80)
  const card = useRef<HTMLDivElement>(null)
  const set = (x: number, y: number, on: boolean) => {
    const el = card.current
    if (!el || reducedMotion) return
    el.style.setProperty('--rx', `${(-y * max).toFixed(2)}deg`)
    el.style.setProperty('--ry', `${(x * max).toFixed(2)}deg`)
    el.style.setProperty('--gx', `${(x * 50 + 50).toFixed(1)}%`)
    el.style.setProperty('--gy', `${(y * 50 + 50).toFixed(1)}%`)
    el.dataset.on = on ? 'true' : 'false'
  }
  const move = (e: PointerEvent) => { const r = e.currentTarget.getBoundingClientRect(); set((e.clientX - r.left) / r.width * 2 - 1, (e.clientY - r.top) / r.height * 2 - 1, true) }
  return (
    <div className={s.stage} onPointerMove={move} onPointerLeave={() => set(0, 0, false)}>
      <div ref={card} className={s.card} data-still={reducedMotion || undefined} tabIndex={0} onFocus={() => set(0.25, -0.35, true)} onBlur={() => set(0, 0, false)} style={{ ['--glare' as string]: glare, ['--depth' as string]: `${depth}px` }}>
        <p className={s.eyebrow}>{eyebrow}</p>
        <h3 className={s.title}>{title}</h3>
        <p className={s.body}>{body}</p>
        <span className={s.sheen} aria-hidden="true" />
      </div>
    </div>
  )
}
