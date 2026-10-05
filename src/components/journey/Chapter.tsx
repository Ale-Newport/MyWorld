'use client'

import { useRef } from 'react'
import { useJourney } from '@/state/journey'
import type { ChapterId } from '@/content/types'
import { useSite } from '@/cms/context'
import { useCms } from '@/cms/editable'
import { useStageFit } from './stageFit'
import styles from './Chapter.module.css'

interface ChapterProps {
  id: ChapterId
  children: React.ReactNode
  /** Rendered outside the sticky stage, in normal flow. */
  flow?: React.ReactNode
  className?: string
  /** Disables the sticky stage (for chapters that scroll naturally). */
  noPin?: boolean
  /** Lets content taller than the section's scroll length extend it (content sections). */
  grow?: boolean
  labelledBy?: string
}

/**
 * A chapter occupies `vh × 100vh` of real document scroll and pins a
 * single full-viewport stage inside it. Native scroll semantics are
 * preserved throughout — nothing is hijacked. A stage whose words do
 * not fit the screen lets them travel through it (stageFit.ts).
 */
export function Chapter({ id, children, flow, className, noPin, grow, labelledBy }: ChapterProps) {
  const quickView = useJourney((s) => s.quickView)
  const meta = useSite().chapterById[id]
  const cms = useCms(`section.${id}`, { kind: 'section', label: meta?.title })
  const sectionRef = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  useStageFit(id, sectionRef, stageRef, !noPin && !!meta)
  if (!meta) return null
  const vh = quickView ? meta.quickVh : meta.vh

  return (
    <section
      {...cms}
      ref={sectionRef}
      id={`chapter-${id}`}
      data-chapter={id}
      aria-labelledby={labelledBy}
      /* The index links across journeys as `/projects#chapter-focus`,
         and Next resolves that fragment by calling focus() on the
         element it names. A bare <section> is not focusable, so the
         call did nothing and the screen reader was left at the head
         of a document parked halfway through chapter three. -1 makes
         the target reachable by script without adding it to the tab
         order, and does the same for the skip link. */
      tabIndex={-1}
      className={`${styles.chapter} ${className ?? ''}`}
      style={grow ? { minHeight: `${vh * 100}vh` } : { height: `${vh * 100}vh` }}
    >
      {noPin ? children : <div className={styles.stage} ref={stageRef}>{children}</div>}
      {flow}
    </section>
  )
}
