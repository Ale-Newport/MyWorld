'use client'

import { useEffect, useRef } from 'react'
import { useMotionTuning } from '../tuning'
import { num, pick, str, type EffectProps } from '../types'
import s from './css/marquee.module.css'

/** An endless ticker of phrases; scrolling the page pushes it faster. */
export default function MarqueeEffect({ params, active, reducedMotion }: EffectProps) {
  const items = str(params.items, 'Machine learning, Product engineering, Computer vision, Retrieval, WebGL', 600).split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20)
  const speed = num(params.pace, 60, 5, 400)
  const dir = pick(params.direction, ['left', 'right'] as const, 'left') === 'left' ? -1 : 1
  const sep = pick(params.separator, ['·', '—', '/', '✦'] as const, '✦')
  const boost = num(params.scrollBoost, 1, 0, 6)
  const size = num(params.size, 3.4, 1, 9)
  const track = useRef<HTMLDivElement>(null)
  const { timeScale } = useMotionTuning()

  useEffect(() => {
    const el = track.current
    if (!el || reducedMotion) return
    let raf = 0, last = performance.now(), x = 0, lastY = window.scrollY, extra = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const dy = Math.abs(window.scrollY - lastY)
      lastY = window.scrollY
      extra = Math.max(extra * Math.pow(0.04, dt), dy * boost * 6)
      if (!active) return
      const half = el.scrollWidth / 2 || 1
      x = (x + dir * (speed + extra) * timeScale * dt) % half
      el.style.transform = `translate3d(${dir < 0 ? x : x - half}px,0,0)`
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); el.style.transform = '' }
  }, [active, reducedMotion, speed, dir, boost, timeScale])

  const run = items.map((t, i) => <span key={i} className={s.item}>{t}<span className={s.sep} aria-hidden="true">{sep}</span></span>)
  return (
    <div className={s.wrap} style={{ fontSize: `clamp(1.1rem, ${size}vw, ${size * 1.4}rem)` }} data-still={reducedMotion || undefined}>
      <ul className="sr-only">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
      <div ref={track} className={s.track} aria-hidden="true">{run}{!reducedMotion && run}</div>
    </div>
  )
}
