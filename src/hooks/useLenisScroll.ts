'use client'

import { useEffect } from 'react'
import Lenis from 'lenis'
import { useJourney, frame } from '@/state/journey'
import { clamp, damp } from '@/lib/math'

let lenisInstance: Lenis | null = null

export function getLenis() { return lenisInstance }

/** Programmatic scroll to a normalised 0..1 position on the journey. */
export function scrollToProgress(p: number, opts?: { immediate?: boolean; duration?: number }) {
  if (typeof document === 'undefined') return
  const max = document.documentElement.scrollHeight - window.innerHeight
  const target = clamp(p) * max
  if (lenisInstance) lenisInstance.scrollTo(target, { immediate: opts?.immediate, duration: opts?.duration ?? 1.5 })
  else window.scrollTo({ top: target, behavior: opts?.immediate ? 'auto' : 'smooth' })
}

/**
 * Single source of scroll truth.
 *  - Lenis smooths native scroll (never blocks it).
 *  - One rAF loop writes frame-rate values into `frame` and
 *    throttled values into the zustand store.
 */
export function useLenisScroll(enabled: boolean) {
  const setScroll = useJourney((s) => s.setScroll)

  useEffect(() => {
    if (!enabled) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const lenis = new Lenis({
      duration: reduced ? 0 : 1.05,
      lerp: reduced ? 1 : 0.085,
      smoothWheel: !reduced,
      syncTouch: false,
      touchMultiplier: 1.6,
      wheelMultiplier: 1,
      autoRaf: false,
    })
    lenisInstance = lenis

    let raf = 0
    let last = performance.now()
    let lastProgress = 0
    let storeProgress = -1
    let smoothedVel = 0

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      lenis.raf(now)

      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
      const p = clamp(lenis.scroll / max)

      const rawVel = (p - lastProgress) / (dt || 1 / 60)
      lastProgress = p
      smoothedVel = damp(smoothedVel, rawVel, 8, dt)

      frame.progress = p
      frame.velocity = smoothedVel
      frame.time = now / 1000
      frame.pointerX = damp(frame.pointerX, frame.pointerTargetX, 5, dt)
      frame.pointerY = damp(frame.pointerY, frame.pointerTargetY, 5, dt)

      // Store updates only when meaningfully changed — keeps React quiet.
      if (Math.abs(p - storeProgress) > 0.0004) {
        storeProgress = p
        setScroll({ progress: p, velocity: smoothedVel })
      }

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    const onPointer = (e: PointerEvent) => {
      frame.pointerTargetX = (e.clientX / window.innerWidth) * 2 - 1
      frame.pointerTargetY = -((e.clientY / window.innerHeight) * 2 - 1)
    }
    window.addEventListener('pointermove', onPointer, { passive: true })

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onPointer)
      lenis.destroy()
      lenisInstance = null
    }
  }, [enabled, setScroll])
}
