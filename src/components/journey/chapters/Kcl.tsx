'use client'

import { useRef } from 'react'
import { Chapter } from '@/components/journey/Chapter'
import { Reveal } from '@/components/typography/Reveal'
import { TagRow } from '@/components/journey/parts'
import { educationById } from '@/content/education'
import { useChapterFrame } from '@/hooks/useChapterProgress'
import { useJourney } from '@/state/journey'
import { clamp, range } from '@/lib/math'
import { ModuleGlyph } from '@/components/motion/ModuleGlyph'
import shared from './chapters.module.css'
import styles from './Kcl.module.css'

/* ============================================================
   10 – 22%  CHAPTER I — FOUNDATIONS
   Five modules, each drawn as the structure it actually
   teaches, assembling one at a time as the Core travels the
   timeline. They then collapse into the result.
   ============================================================ */

export function Kcl() {
  const kcl = educationById.kcl
  const reducedMotion = useJourney((s) => s.reducedMotion)
  const modulesRef = useRef<HTMLUListElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  useChapterFrame('kcl', (t) => {
    if (reducedMotion) return

    const head = headRef.current
    if (head) {
      const a = clamp(range(t, 0.0, 0.12)) * (1 - clamp(range(t, 0.66, 0.8)))
      head.style.opacity = String(a)
      head.style.transform = `translate3d(0, ${(1 - a) * 1.4}rem, 0)`
    }

    const list = modulesRef.current
    if (list) {
      const n = list.children.length
      const fade = 1 - clamp(range(t, 0.66, 0.78))
      for (let i = 0; i < n; i++) {
        const el = list.children[i] as HTMLElement
        const from = 0.13 + (i / n) * 0.44
        const a = clamp(range(t, from, from + 0.14)) * fade
        el.style.opacity = String(a)
        el.style.transform = `translate3d(0, ${(1 - a) * 2.6}rem, 0)`
        el.dataset.on = a > 0.65 ? 'true' : 'false'
      }
    }

    const res = resultRef.current
    if (res) {
      const a = clamp(range(t, 0.74, 0.88))
      res.style.opacity = String(a)
      res.style.transform = `translate3d(0, ${(1 - a) * 3}rem, 0) scale(${0.94 + a * 0.06})`
    }
  })

  return (
    <Chapter id="kcl" labelledBy="kcl-title">
      <div className={`${shared.stage} ${styles.stage}`}>
        <div className={`${styles.head} ${shared.driven}`} ref={headRef}>
          <TagRow items={['03', 'FOUNDATIONS', '2023 — 2026']} />
          <Reveal as="h2" mode="mask" className={styles.title} id="kcl-title">
            {"King's College\nLondon"}
          </Reveal>
          <p className={styles.degree}>
            {kcl.degree}
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

        <div className={`${styles.result} ${shared.driven}`} ref={resultRef} aria-hidden="true">
          <span className={styles.resultLine}>First</span>
          <span className={styles.resultLine}>Class</span>
          <span className={styles.resultTag}>HONOURS · {kcl.dates}</span>
        </div>
        <p className="sr-only">{kcl.result}, {kcl.degree}, {kcl.institution}, {kcl.dates}.</p>
      </div>
    </Chapter>
  )
}
