'use client'

import { useEffect, useRef } from 'react'

export interface CanvasContext {
  ctx: CanvasRenderingContext2D
  /** CSS pixel width/height — already DPR-corrected via transform. */
  w: number
  h: number
  /** Seconds since the canvas became visible. */
  t: number
  /** Delta seconds, clamped. */
  dt: number
  dpr: number
}

export interface UseCanvas2DOptions {
  /** Called once per frame while visible. */
  draw: (c: CanvasContext) => void
  /** Called on mount and on every resize, before the next draw. */
  setup?: (c: Omit<CanvasContext, 't' | 'dt'>) => void
  /** Pause when scrolled out of view. Default true. */
  pauseWhenHidden?: boolean
  /** Cap the device pixel ratio. Default 2. */
  maxDpr?: number
  /** Stop after this many seconds (0 = never). */
  runFor?: number
}

/**
 * Canvas2D harness used by every project motion graphic.
 * Handles DPR, resize, IntersectionObserver pausing, reduced
 * motion and teardown, so each visual only writes its draw call.
 */
export function useCanvas2D<T extends HTMLCanvasElement = HTMLCanvasElement>(
  opts: UseCanvas2DOptions,
) {
  const ref = useRef<T>(null)
  const optsRef = useRef(opts)

  // Keep the latest draw closure without mutating a ref during
  // render — the loop reads optsRef on the next frame either way.
  useEffect(() => { optsRef.current = opts })

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    const maxDpr = optsRef.current.maxDpr ?? 2
    let w = 0
    let h = 0
    let dpr = 1
    let visible = optsRef.current.pauseWhenHidden === false
    let raf = 0
    let start = 0
    let last = 0

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      dpr = Math.min(maxDpr, window.devicePixelRatio || 1)
      w = Math.max(1, Math.round(rect.width))
      h = Math.max(1, Math.round(rect.height))
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      optsRef.current.setup?.({ ctx, w, h, dpr })
    }

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()

    let io: IntersectionObserver | null = null
    if (optsRef.current.pauseWhenHidden !== false) {
      io = new IntersectionObserver(
        ([e]) => { visible = e.isIntersecting },
        { rootMargin: '120px' },
      )
      io.observe(canvas)
    }

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (!visible) { last = now; return }
      if (!start) { start = now; last = now }
      const t = (now - start) / 1000
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const runFor = optsRef.current.runFor ?? 0
      if (runFor && t > runFor) return
      optsRef.current.draw({ ctx, w, h, t, dt, dpr })
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io?.disconnect()
    }
  }, [])

  return ref
}
