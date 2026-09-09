'use client'

import { useRef } from 'react'
import { Chapter } from '@/components/journey/Chapter'
import { Reveal } from '@/components/typography/Reveal'
import { TagRow } from '@/components/journey/parts'
import { educationById } from '@/content/education'
import { chapterById } from '@/content/chapters'
import { useChapterFrame } from '@/hooks/useChapterProgress'
import { useJourney } from '@/state/journey'
import { clamp, range } from '@/lib/math'
import { ModuleGlyph } from '@/components/motion/ModuleGlyph'
import shared from './chapters.module.css'
import styles from './Kcl.module.css'

/* ============================================================
   10 – 22%  CHAPTER I — FOUNDATIONS
   Five modules, each drawn as the structure it actually
   teaches, assembling one at a time as the visitor travels the
   timeline. The classification stays with the degree line, at
   credential scale — it is a fact about the course, not a
   headline of its own.
   ============================================================ */

export function Kcl() {
  const kcl = educationById.kcl
  const reducedMotion = useJourney((s) => s.reducedMotion)
  const modulesRef = useRef<HTMLUListElement>(null)
  const headRef = useRef<HTMLDivElement>(null)

  useChapterFrame('kcl', (t) => {
    if (reducedMotion) return

    // Nothing is faded out on the way through. The sticky stage
    // un-pins for the last fifth of the chapter and carries the
    // scene off by itself, so an early exit would only leave a
    // viewport of empty room behind it.
    const head = headRef.current
    if (head) {
      const a = clamp(range(t, 0.0, 0.12))
      head.style.opacity = String(a)
      head.style.transform = `translate3d(0, ${(1 - a) * 1.4}rem, 0)`
    }

    const list = modulesRef.current
    if (list) {
      const n = list.children.length
      for (let i = 0; i < n; i++) {
        const el = list.children[i] as HTMLElement
        const from = 0.13 + (i / n) * 0.44
        const a = clamp(range(t, from, from + 0.14))
        el.style.opacity = String(a)
        el.style.transform = `translate3d(0, ${(1 - a) * 2.6}rem, 0)`
        el.dataset.on = a > 0.65 ? 'true' : 'false'
      }
    }
  })

  return (
    <Chapter id="kcl" labelledBy="kcl-title">
      <div className={`${shared.stage} ${styles.stage}`}>
        <div className={`${styles.head} ${shared.driven}`} ref={headRef}>
          <TagRow items={[chapterById['kcl'].number, 'FOUNDATIONS', '2023 — 2026']} />
          <Reveal as="h2" mode="mask" className={styles.title} id="kcl-title">
            {"King's College\nLondon"}
          </Reveal>
          <p className={styles.degree}>
            {kcl.degree}
            {/* Hidden from the reading order: the sentence at the end of
                the stage already states the result once. */}
            {kcl.result && (
              <span className={styles.degreeResult} aria-hidden="true">{kcl.result}</span>
            )}
            <span className={styles.degreeDates}>{kcl.dates}</span>
          </p>
        </div>

        <ul className={styles.modules} ref={modulesRef} aria-label="Relevant modules">
          {kcl.modules.map((m) => (
            <li key={m.name} className={styles.module} data-on="false">
              <span className={styles.moduleGlyph} aria-hidden="true">
                <ModuleGlyph kind={m.visual} />
              </span>
              <span className={styles.moduleName}>{m.name}</span>
              <span className={styles.moduleBlurb}>{m.blurb}</span>
            </li>
          ))}
        </ul>

        <p className="sr-only">{kcl.result}, {kcl.degree}, {kcl.institution}, {kcl.dates}.</p>
      </div>
    </Chapter>
  )
}
