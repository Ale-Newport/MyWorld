'use client'

import { useEffect, useRef } from 'react'
import { useMotionTuning } from '../tuning'
import { bool, num, pick, type EffectProps } from '../types'
import { makeNoise } from './kit'
import s from './effects.module.css'

/** An organic shape that breathes and leans towards the pointer. */
export default function BlobEffect({ params, active, reducedMotion }: EffectProps) {
  const points = Math.round(num(params.points, 8, 4, 18))
  const wobble = num(params.wobble, 0.22, 0, 0.6)
  const fill = pick(params.fill, ['accent', 'ink', 'outline'] as const, 'accent')
  const follow = bool(params.followPointer, true)
  const path = useRef<SVGPathElement>(null)
  const { timeScale } = useMotionTuning()

  useEffect(() => {
    const el = path.current
    if (!el) return
    const noise = makeNoise(7)
    const target = { x: 0, y: 0 }, lean = { x: 0, y: 0 }
    const svg = el.ownerSVGElement!
    const onMove = (e: PointerEvent) => {
      const r = svg.getBoundingClientRect()
      target.x = ((e.clientX - r.left) / r.width - 0.5) * 2
      target.y = ((e.clientY - r.top) / r.height - 0.5) * 2
    }
    const onLeave = () => { target.x = 0; target.y = 0 }
    const shape = (t: number) => {
      const pts: [number, number][] = []
      for (let i = 0; i < points; i++) {
        const a = (i / points) * Math.PI * 2
        const n = noise(Math.cos(a) * 0.9 + 3, Math.sin(a) * 0.9 + 3, t * 0.35)
        const facing = Math.cos(a) * lean.x + Math.sin(a) * lean.y
        const r = 34 * (1 + n * wobble + facing * 0.12)
        pts.push([50 + Math.cos(a) * r + lean.x * 3, 50 + Math.sin(a) * r + lean.y * 3])
      }
      let d = ''
      for (let i = 0; i < points; i++) {
        const p0 = pts[(i - 1 + points) % points], p1 = pts[i], p2 = pts[(i + 1) % points], p3 = pts[(i + 2) % points]
        if (i === 0) d += `M${p1[0].toFixed(2)},${p1[1].toFixed(2)}`
        d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(2)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(2)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(2)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`
      }
      el.setAttribute('d', `${d}Z`)
    }
    if (reducedMotion) { shape(2.4); return }
    if (follow) { svg.addEventListener('pointermove', onMove); svg.addEventListener('pointerleave', onLeave) }
    let raf = 0, last = performance.now(), t = 0, visible = true
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting })
    io.observe(svg)
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (!visible) return
      if (active) t += dt * timeScale
      lean.x += (target.x - lean.x) * Math.min(1, dt * 4)
      lean.y += (target.y - lean.y) * Math.min(1, dt * 4)
      shape(t)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); io.disconnect(); svg.removeEventListener('pointermove', onMove); svg.removeEventListener('pointerleave', onLeave) }
  }, [points, wobble, follow, active, reducedMotion, timeScale])

  return (
    <svg viewBox="0 0 100 100" className={s.fill} aria-hidden="true" style={{ overflow: 'visible' }}>
      <path ref={path} fill={fill === 'outline' ? 'none' : fill === 'ink' ? 'var(--fx-ink)' : 'var(--fx-accent)'} stroke={fill === 'outline' ? 'var(--fx-accent)' : 'none'} strokeWidth={fill === 'outline' ? 0.8 : 0} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
