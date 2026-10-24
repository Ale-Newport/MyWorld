'use client'

import { useEffect, useRef } from 'react'
import { useJourney, frame } from '@/state/journey'
import type { ChapterId } from '@/content/types'
import { clamp } from '@/lib/math'
import { IDLE, subscribe, wake } from '@/lib/ticker'

/**
 * Reads chapter-local progress every frame WITHOUT re-rendering
 * React. The callback receives (t, active, dt) where t is 0..1
 * within the chapter, extended slightly past both boundaries so
 * transitions can overlap.
 *
 * Chapters far outside their range are skipped entirely, and one
 * settling frame is issued on the way out so a chapter never
 * freezes mid-transform.
 *
 * The callback is a function of `t`: it is called when `t` has moved,
 * when the component has rendered a new closure (new state, new refs),
 * when the window or the layout has changed size, and not otherwise —
 * a chapter standing still on screen costs nothing, and the shared
 * ticker is free to sleep (see lib/ticker). A callback that also
 * follows something other than the scroll says so with one of:
 *   · `signal` — a number read every frame; the callback runs when it changes
 *     (the last chapter follows the portal's pull this way);
 *   · `continuous` — it is called every frame (a clock, not a position).
 */
export function useChapterFrame(
  id: ChapterId,
  cb: (t: number, active: boolean, dt: number) => void,
  opts: { lead?: number; trail?: number; signal?: () => number; continuous?: boolean } = {},
) {
  const cbRef = useRef(cb)
  // A new closure means the component rendered (new state, perhaps new nodes): draw it, even if the page is still.
  useEffect(() => {
    cbRef.current = cb
    wake()
  })
  const signalRef = useRef(opts.signal)
  useEffect(() => { signalRef.current = opts.signal })

  useEffect(() => {
    const lead = opts.lead ?? 0.06
    const trail = opts.trail ?? 0.06
    const continuous = opts.continuous ?? false
    let wasActive = false
    let dirty = true
    let lastRaw = Number.NaN
    let lastCb: typeof cb | null = null
    let lastSignal = Number.NaN

    // What the callback read from the layout (a width, a scroll extent) is stale after a resize.
    const invalidate = () => { dirty = true }
    window.addEventListener('resize', invalidate)
    window.addEventListener('journey:layout', invalidate)
    window.addEventListener('cms:content', invalidate)
    document.fonts?.addEventListener('loadingdone', invalidate)

    const stop = subscribe((dt) => {
      const r = useJourney.getState().ranges.find((x) => x.id === id)
      if (!r || r.end <= r.start) return IDLE

      const span = r.end - r.start
      const raw = (frame.progress - r.start) / span
      const active = raw > -lead && raw < 1 + trail

      if (!active) {
        // One final frame pinned to the nearest edge, then silence.
        if (wasActive) {
          wasActive = false
          dirty = true
          cbRef.current(raw < 0 ? -lead : 1 + trail, false, dt)
          return
        }
        return IDLE
      }
      const signal = signalRef.current?.() ?? 0
      const current = cbRef.current
      if (!continuous && !dirty && raw === lastRaw && current === lastCb && signal === lastSignal) return IDLE
      dirty = false
      lastRaw = raw
      lastCb = current
      lastSignal = signal
      wasActive = true
      current(clamp(raw, -lead, 1 + trail), true, dt)
    }, `chapter:${id}`)

    return () => {
      stop()
      window.removeEventListener('resize', invalidate)
      window.removeEventListener('journey:layout', invalidate)
      window.removeEventListener('cms:content', invalidate)
      document.fonts?.removeEventListener('loadingdone', invalidate)
    }
  }, [id, opts.lead, opts.trail, opts.continuous])
}

/** Non-reactive read of a chapter's local progress. */
export function readChapterProgress(id: ChapterId): number {
  const r = useJourney.getState().ranges.find((x) => x.id === id)
  if (!r || r.end <= r.start) return 0
  return clamp((frame.progress - r.start) / (r.end - r.start))
}
