'use client'

import { useEffect, useRef } from 'react'
import type { ChapterId } from '@/content/types'
import { readStageShift, writeSceneRegion } from '@/experience/camera/regions'

/**
 * The box a chapter's 3D subject is drawn into.
 *
 * It renders nothing visible: the chapter's own CSS places and
 * sizes it in the stage grid like any other region, and the
 * camera fits the scene into it (see experience/camera/regions).
 * It is measured whenever it, its stage, its section, the journey
 * or any of its neighbours change size — a heading that wraps to
 * another line moves the box without resizing it — and never per
 * frame.
 */
export function SceneRegion({ chapter, className }: { chapter: ChapterId; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    const section = el?.closest('section')
    const stage = section?.firstElementChild as HTMLElement | null | undefined
    if (!el || !section || !stage) return

    let frame = 0
    const measure = () => {
      frame = 0
      const s = stage.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      const top = section.getBoundingClientRect().top + window.scrollY
      if (r.width < 1 || r.height < 1) {
        writeSceneRegion(chapter, null)
        return
      }
      writeSceneRegion(chapter, {
        chapter,
        x: r.left - s.left,
        // Where layout put it: the stage's travel, if any, is added back per frame.
        y: r.top - s.top - readStageShift(chapter),
        w: r.width,
        h: r.height,
        sectionTop: top,
        sectionHeight: section.offsetHeight,
        stageHeight: stage.offsetHeight,
      })
    }
    // Several observers can fire for one change; measure once, after layout.
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }

    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    ro.observe(stage)
    ro.observe(section)
    // The journey as a whole: a chapter above this one changing length
    // moves this section without resizing anything observed here.
    if (section.parentElement) ro.observe(section.parentElement)
    const parent = el.parentElement
    if (parent) for (const sibling of parent.children) if (sibling !== el) ro.observe(sibling)
    window.addEventListener('resize', schedule)
    document.fonts?.ready.then(schedule).catch(() => {})
    schedule()

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', schedule)
      if (frame) cancelAnimationFrame(frame)
      writeSceneRegion(chapter, null)
    }
  }, [chapter])

  return <div ref={ref} className={className} data-scene-region={chapter} aria-hidden="true" />
}
