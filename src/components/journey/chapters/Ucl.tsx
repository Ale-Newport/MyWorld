'use client'

import { useRef } from 'react'
import { Chapter } from '@/components/journey/Chapter'
import { Reveal } from '@/components/typography/Reveal'
import { TagRow } from '@/components/journey/parts'
import { educationById, credentials } from '@/content/education'
import { chapterById } from '@/content/chapters'
import { profile } from '@/content/profile'
import { useChapterFrame } from '@/hooks/useChapterProgress'
import { useJourney } from '@/state/journey'
import { clamp, range } from '@/lib/math'
import shared from './chapters.module.css'
import styles from './Ucl.module.css'

/* ============================================================
   94 – 98%  UNIVERSITY COLLEGE LONDON
   Everything goes quiet. Modules are placed as coordinates in
   space rather than listed, and the timeline runs past the
   present into empty room.
   ============================================================ */

/** Deliberate, hand-placed positions — a constellation, not a grid. */
const COORDS: [number, number][] = [
  [56, 4], [78, 24], [6, 44], [74, 56], [14, 76],
]

export function Ucl() {
  const ucl = educationById.ucl
  const reducedMotion = useJourney((s) => s.reducedMotion)
  const modulesRef = useRef<HTMLUListElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const messageRef = useRef<HTMLParagraphElement>(null)
  const headRef = useRef<HTMLDivElement>(null)

  useChapterFrame('ucl', (t) => {
    if (reducedMotion) return

    const head = headRef.current
    if (head) {
      const a = clamp(range(t, 0.02, 0.14)) * (1 - clamp(range(t, 0.7, 0.84)))
      head.style.opacity = String(a)
      head.style.transform = `translate3d(0, ${(1 - a) * 1.6}rem, 0)`
    }

    const list = modulesRef.current
    if (list) {
      const fade = 1 - clamp(range(t, 0.66, 0.8))
      for (let i = 0; i < list.children.length; i++) {
        const el = list.children[i] as HTMLElement
        const from = 0.2 + i * 0.07
        const a = clamp(range(t, from, from + 0.12)) * fade
        el.style.opacity = String(a)
        el.style.transform = `translate3d(0, ${(1 - a) * 1.2}rem, 0)`
      }
    }

    const tl = timelineRef.current
    if (tl) {
      const a = clamp(range(t, 0.56, 0.7))
      tl.style.opacity = String(a)
      const bar = tl.querySelector<HTMLElement>('[data-progress]')
      if (bar) bar.style.transform = `scaleX(${clamp(range(t, 0.58, 0.9))})`
    }

    const msg = messageRef.current
    if (msg) {
      const a = clamp(range(t, 0.78, 0.92))
      msg.style.opacity = String(a)
      msg.style.transform = `translate3d(0, ${(1 - a) * 2.4}rem, 0)`
    }
  })

  return (
    <Chapter id="ucl" labelledBy="ucl-title">
      <div className={`${shared.stage} ${styles.stage}`}>
        <div className={`${styles.head} ${shared.driven}`} ref={headRef}>
          <TagRow items={[chapterById['ucl'].number, 'UNIVERSITY COLLEGE LONDON', ucl.dates]} />
          <Reveal as="h2" mode="mask" className={styles.title} id="ucl-title">
            {'MSc\nArtificial Intelligence\n& Data Engineering'}
          </Reveal>
        </div>

        <ul className={styles.modules} ref={modulesRef} aria-label="Relevant modules">
          {ucl.modules.map((m, i) => (
            <li
              key={m.name}
              className={styles.module}
              style={{ left: `${COORDS[i]?.[0] ?? 50}%`, top: `${COORDS[i]?.[1] ?? 50}%` }}
            >
              <span className={styles.moduleMark} aria-hidden="true">×</span>
              <span className={styles.moduleName}>{m.name}</span>
            </li>
          ))}
        </ul>

        <div className={`${styles.timeline} ${shared.driven}`} ref={timelineRef}>
          <div className={styles.timelineTrack}>
            <span className={styles.timelineFill} data-progress="" />
          </div>
          <div className={styles.timelineYears}>
            {['2023', '2024', '2025', '2026', '2027'].map((y) => (
              <span key={y}>{y}</span>
            ))}
            <span className={styles.timelineFuture}>?</span>
          </div>
        </div>

        <p className={`${styles.message} ${shared.driven}`} ref={messageRef}>
          {profile.closing.ucl.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </p>

        <ul className={styles.credentials} aria-label="Additional credentials">
          {credentials.map((c) => (
            <li key={c.id}>
              <span>{c.title}</span>
              <span>{c.issuer}</span>
            </li>
          ))}
        </ul>
      </div>
    </Chapter>
  )
}
