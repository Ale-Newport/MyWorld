'use client'

import { useEffect } from 'react'
import Lenis from 'lenis'
import { useJourney, frame } from '@/state/journey'
import { clamp, damp } from '@/lib/math'
import { IDLE, subscribe, wake } from '@/lib/ticker'

let lenisInstance: Lenis | null = null

export function getLenis() { return lenisInstance }

/** Programmatic scroll to a normalised 0..1 position on the journey. */
export function scrollToProgress(p: number, opts?: { immediate?: boolean; duration?: number }) {
  if (typeof document === 'undefined') return
  const max = document.documentElement.scrollHeight - window.innerHeight
  const target = clamp(p) * max
  if (lenisInstance) lenisInstance.scrollTo(target, { immediate: opts?.immediate, duration: opts?.duration ?? 1.5 })
  else window.scrollTo({ top: target, behavior: opts?.immediate ? 'auto' : 'smooth' })
  // The shared loop may be asleep, and Lenis travels only when it ticks.
  wake('scrollToProgress')
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

    /* While the leaves cover the screen for the world (the machine writes
       `html[data-world-phase]` and announces it) nothing scrolls: Lenis would
       otherwise turn the wheel into a programmatic scroll of the page under the
       leaves, which CSS `overflow` does not stop. The machine does not import
       Lenis, so the /world bundle does not carry it. */
    const syncLock = () => {
      const phase = document.documentElement.dataset.worldPhase
      if (phase && phase !== 'HOME' && phase !== 'IN_WORLD') lenis.stop()
      else lenis.start()
    }
    syncLock()
    window.addEventListener('world:phase', syncLock)

    let last = performance.now()
    let lastProgress = 0
    let storeProgress = -1
    let smoothedVel = 0

    /* One of the shared ticker's subscribers (lib/ticker), which sleeps when every one of them
       is at rest: a page left alone asks for no frames at all. This one is at rest when Lenis
       has nothing left to travel and the values it keeps (velocity, the smoothed pointer) have
       settled; a wheel, a touch, a key, a scroll or a pointer move wakes the loop again. */
    const tick = (_dt: number, now: number) => {
      // The first pass after a sleep is one ordinary frame, not one long one.
      const gap = (now - last) / 1000
      const slept = gap > 0.1
      const dt = slept ? 1 / 60 : Math.min(0.05, gap)
      last = now
      // Lenis measures a frame from its own previous call, which was seconds ago: handed that, it carries
      // the first notch of the wheel to its target in one frame. It is told this is an ordinary one.
      if (slept) lenis.time = now - 1000 / 60
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

      // The tails of the damped values are smaller than anything they drive can show.
      if (rawVel === 0 && Math.abs(smoothedVel) < 1e-4) { smoothedVel = 0; frame.velocity = 0 }
      if (Math.abs(frame.pointerX - frame.pointerTargetX) < 1e-4) frame.pointerX = frame.pointerTargetX
      if (Math.abs(frame.pointerY - frame.pointerTargetY) < 1e-4) frame.pointerY = frame.pointerTargetY
      const atRest = !lenis.isScrolling && rawVel === 0 && smoothedVel === 0
        && frame.pointerX === frame.pointerTargetX && frame.pointerY === frame.pointerTargetY
      return atRest ? IDLE : undefined
    }
    const stop = subscribe(tick, 'lenis')

    const onPointer = (e: PointerEvent) => {
      frame.pointerTargetX = (e.clientX / window.innerWidth) * 2 - 1
      frame.pointerTargetY = -((e.clientY / window.innerHeight) * 2 - 1)
    }
    window.addEventListener('pointermove', onPointer, { passive: true })

    return () => {
      stop()
      window.removeEventListener('world:phase', syncLock)
      window.removeEventListener('pointermove', onPointer)
      lenis.destroy()
      lenisInstance = null
    }
  }, [enabled, setScroll])
}
