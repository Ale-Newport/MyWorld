'use client'

import { useEffect, useRef } from 'react'
import { useJourney, frame } from '@/state/journey'
import type { ChapterId } from '@/content/types'
import { clamp } from '@/lib/math'
import { subscribe } from '@/lib/ticker'

/**
 * Reads chapter-local progress every frame WITHOUT re-rendering
 * React. The callback receives (t, active, dt) where t is 0..1
 * within the chapter, extended slightly past both boundaries so
 * transitions can overlap.
 *
 * Chapters far outside their range are skipped entirely, and one
 * settling frame is issued on the way out so a chapter never
 * freezes mid-transform.
 */
export function useChapterFrame(
  id: ChapterId,
  cb: (t: number, active: boolean, dt: number) => void,
  opts: { lead?: number; trail?: number } = {},
) {
  const cbRef = useRef(cb)
  useEffect(() => { cbRef.current = cb })

  useEffect(() => {
    const lead = opts.lead ?? 0.06
    const trail = opts.trail ?? 0.06
    let wasActive = false

    return subscribe((dt) => {
      const r = useJourney.getState().ranges.find((x) => x.id === id)
      if (!r || r.end <= r.start) return

      const span = r.end - r.start
      const raw = (frame.progress - r.start) / span
      const active = raw > -lead && raw < 1 + trail

      if (!active) {
        // One final frame pinned to the nearest edge, then silence.
        if (wasActive) {
          wasActive = false
          cbRef.current(raw < 0 ? -lead : 1 + trail, false, dt)
        }
        return
      }
      wasActive = true
      cbRef.current(clamp(raw, -lead, 1 + trail), true, dt)
    })
  }, [id, opts.lead, opts.trail])
}

/** Non-reactive read of a chapter's local progress. */
export function readChapterProgress(id: ChapterId): number {
  const r = useJourney.getState().ranges.find((x) => x.id === id)
  if (!r || r.end <= r.start) return 0
  return clamp((frame.progress - r.start) / (r.end - r.start))
}
