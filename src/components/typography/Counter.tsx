'use client'

import { useEffect, useRef } from 'react'
import { useJourney } from '@/state/journey'
import { easeOutCubic } from '@/lib/math'

interface CounterProps {
  to: number
  /** Rendered before/after the number. */
  prefix?: string
  suffix?: string
  duration?: number
  className?: string
  /** Formats the in-flight value. Default: locale integer. */
  format?: (v: number) => string
  /** Start the count when scrolled into view. */
  immediate?: boolean
}

/**
 * Scroll-triggered count-up. Writes straight to textContent so
 * a 500,000-step animation costs zero React renders.
 */
export function Counter({ to, prefix = '', suffix = '', duration = 1.8, className, format, immediate }: CounterProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const reducedMotion = useJourney((s) => s.reducedMotion)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const fmt = format ?? ((v: number) => Math.round(v).toLocaleString('en-GB'))

    if (reducedMotion) { el.textContent = `${prefix}${fmt(to)}${suffix}`; return }

    let raf = 0
    const run = () => {
      const start = performance.now()
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / (duration * 1000))
        el.textContent = `${prefix}${fmt(easeOutCubic(t) * to)}${suffix}`
        if (t < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }

    el.textContent = `${prefix}${fmt(0)}${suffix}`
    if (immediate) { run(); return () => cancelAnimationFrame(raf) }

    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { run(); io.disconnect() }
    }, { threshold: 0.4 })
    io.observe(el)
    return () => { io.disconnect(); cancelAnimationFrame(raf) }
  }, [to, prefix, suffix, duration, format, immediate, reducedMotion])

  return <span ref={ref} className={className} aria-label={`${prefix}${to.toLocaleString('en-GB')}${suffix}`} />
}
