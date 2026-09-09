'use client'

import { useRef, useState } from 'react'
import { Chapter } from '@/components/journey/Chapter'
import { Reveal } from '@/components/typography/Reveal'
import { TagRow } from '@/components/journey/parts'
import { ProjectVisual } from '@/components/project-visuals/ProjectVisual'
import { projectById } from '@/content/projects'
import { chapterById } from '@/content/chapters'
import { useChapterFrame } from '@/hooks/useChapterProgress'
import { useJourney } from '@/state/journey'
import { clamp, range } from '@/lib/math'
import shared from './chapters.module.css'
import styles from './Stock.module.css'

/* ============================================================
   81 – 85%  FORTY THOUSAND TRADES
   Short and fast. The count climbs with scroll velocity, so
   the visitor is the one accelerating the market.
   ============================================================ */

const LADDER = ['1', '10', '100', '1K', '10K', '40K+']

export function Stock() {
  const project = projectById['stock-market-simulator']
  const reducedMotion = useJourney((s) => s.reducedMotion)
  const [progress, setProgress] = useState(0)
  const ladderRef = useRef<HTMLOListElement>(null)

  useChapterFrame('stock', (t) => {
    setProgress((p) => (Math.abs(p - t) > 0.004 ? t : p))
    if (reducedMotion) return
    const l = ladderRef.current
    if (!l) return
    const n = l.children.length
    const local = clamp(range(t, 0.08, 0.86))
    for (let i = 0; i < n; i++) {
      const el = l.children[i] as HTMLElement
      const on = local > i / n
      el.dataset.on = on ? 'true' : 'false'
      el.style.opacity = String(on ? 1 : 0.14)
    }
  })

  return (
    <Chapter id="stock" labelledBy="stock-title">
      <div className={`${shared.stage} ${styles.stage}`}>
        <div className={styles.visual}>
          <ProjectVisual project={project} progress={progress} active reducedMotion={reducedMotion} />
        </div>

        <div className={styles.head}>
          <TagRow items={[chapterById['stock'].number, 'CONCURRENCY', '2025']} />
          <Reveal as="h2" mode="perspective" className={styles.title} id="stock-title">
            {'Order book'}
          </Reveal>
          <p className={shared.note}>{project.shortDescription}</p>
        </div>

        {/* Counting, the ladder explains itself: the rungs light one by
            one as the book fills. Standing still it is a row of bare
            numbers, so the static composition names what they count. */}
        <div className={styles.ladderWrap}>
          <p className={styles.ladderLabel} aria-hidden="true">Trades matched</p>
          <ol className={styles.ladder} ref={ladderRef} aria-label="Trades processed">
            {LADDER.map((v) => (
              <li key={v} className={styles.rung} data-on="false">{v}</li>
            ))}
          </ol>
        </div>

        <div className={styles.flow} aria-hidden="true">
          <span>BUY ORDERS</span>
          <span className={styles.flowArrow}>→</span>
          <span>ORDER BOOK</span>
          <span className={styles.flowArrow}>→</span>
          <span>MATCHING ENGINE</span>
          <span className={styles.flowArrow}>→</span>
          <span>SELL ORDERS</span>
        </div>

        <div className={`${shared.corner} ${shared.cornerBR}`}>
          JAVA · MAVEN
          <br />
          PRICE-TIME PRIORITY
          <br />
          4 TRADER THREADS
        </div>
      </div>
    </Chapter>
  )
}
