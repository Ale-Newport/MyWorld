'use client'

import { useJourney } from '@/state/journey'
import type { ChapterId } from '@/content/types'
import { useSite } from '@/cms/context'
import { useCms } from '@/cms/editable'
import { CmsSlot } from '@/cms/blocks'
import styles from './Chapter.module.css'

interface ChapterProps {
  id: ChapterId
  children: React.ReactNode
  /** Rendered outside the sticky stage, in normal flow. */
  flow?: React.ReactNode
  className?: string
  /** Disables the sticky stage (for chapters that scroll naturally). */
  noPin?: boolean
  labelledBy?: string
}

/**
 * A chapter occupies `vh × 100vh` of real document scroll and pins a
 * single full-viewport stage inside it. Native scroll semantics are
 * preserved throughout — nothing is hijacked.
 */
export function Chapter({ id, children, flow, className, noPin, labelledBy }: ChapterProps) {
  const quickView = useJourney((s) => s.quickView)
  const meta = useSite().chapterById[id]
  const cms = useCms(`section.${id}`, { kind: 'section', label: meta?.title })
  if (!meta) return null
  const vh = quickView ? meta.quickVh : meta.vh

  return (
    <section
      {...cms}
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
      style={{ height: `${vh * 100}vh` }}
    >
      {noPin ? (
        <>{children}<CmsSlot section={id} /></>
      ) : (
        <div className={styles.stage}>{children}<CmsSlot section={id} /></div>
      )}
      {flow}
    </section>
  )
}
