'use client'

import { useRef } from 'react'
import { Chapter } from '@/components/journey/Chapter'
import { Reveal } from '@/components/typography/Reveal'
import { TagRow } from '@/components/journey/parts'
import { credentials, educationById, type Education as School } from '@/content/education'
import { chapterById } from '@/content/chapters'
import { useChapterFrame } from '@/hooks/useChapterProgress'
import { useJourney } from '@/state/journey'
import { clamp, range } from '@/lib/math'
import { ModuleGlyph } from '@/components/motion/ModuleGlyph'
import shared from './chapters.module.css'
import styles from './Education.module.css'

/* ============================================================
   HOME · EDUCATION
   Both universities on one stage, in one format, arriving
   together. They were two chapters with two different visual
   languages — a ruled list for King's and a scattered
   constellation for UCL — which read as two different kinds of
   fact. They are the same kind of fact: a degree, its dates, its
   standing, and the five modules that matter. So they are two
   identical cards side by side, and every row of one lands on the
   same frame as the same row of the other.
   ============================================================ */

/** The order the story reads in: where it started, where it is going. */
const ORDER = ['kcl', 'ucl'] as const

/** Taken from the dates rather than written down, so it never goes stale. */
function standing(school: School, now = new Date()): string {
  const [sy, sm] = school.start.split('-').map(Number)
  const [ey, em] = school.end.split('-').map(Number)
  const start = new Date(sy, sm - 1, 1)
  const end = new Date(ey, em - 1, 28)
  if (now > end) return school.result ?? 'Completed'
  if (now >= start) return 'In progress'
  return `Starting ${start.toLocaleString('en-GB', { month: 'short' })} ${sy}`
}

export function Education() {
  const reducedMotion = useJourney((s) => s.reducedMotion)
  const headRef = useRef<HTMLDivElement>(null)
  const cardsRef = useRef<HTMLDivElement>(null)
  const footRef = useRef<HTMLDivElement>(null)

  useChapterFrame('education', (t) => {
    if (reducedMotion) return
    const head = headRef.current
    if (head) {
      const a = clamp(range(t, 0.0, 0.12))
      head.style.opacity = String(a)
      head.style.transform = `translate3d(0, ${(1 - a) * 1.4}rem, 0)`
    }
    const cards = cardsRef.current
    if (!cards) return
    /* Both cards on the same curve, and row i of each on the same
       curve as row i of the other. */
    const c = clamp(range(t, 0.06, 0.2))
    for (const card of Array.from(cards.children) as HTMLElement[]) {
      card.style.opacity = String(c)
      card.style.transform = `translate3d(0, ${(1 - c) * 2.2}rem, 0)`
      const rows = card.querySelectorAll<HTMLElement>('[data-module-row]')
      rows.forEach((row, i) => {
        const from = 0.16 + i * 0.07
        const a = clamp(range(t, from, from + 0.12))
        row.style.opacity = String(a)
        row.style.transform = `translate3d(0, ${(1 - a) * 0.9}rem, 0)`
        row.dataset.on = a > 0.65 ? 'true' : 'false'
      })
    }
    const foot = footRef.current
    if (foot) {
      const a = clamp(range(t, 0.52, 0.64))
      foot.style.opacity = String(a)
    }
  })

  return (
    <Chapter id="education" labelledBy="education-title">
      <div className={`${shared.stage} ${styles.stage}`}>
        <div className={`${styles.head} ${shared.driven}`} ref={headRef}>
          <TagRow items={[chapterById['education'].number, 'EDUCATION', 'LONDON · 2023 — 2027']} />
          <Reveal as="h2" mode="mask" className={styles.title} id="education-title">
            {'Two universities,\none direction.'}
          </Reveal>
        </div>

        <div className={styles.cards} ref={cardsRef}>
          {ORDER.map((id) => {
            const school = educationById[id]
            return (
              <article key={id} className={`${styles.card} ${shared.driven}`} aria-labelledby={`edu-${id}`}>
                <header className={styles.cardHead}>
                  <span className={styles.short}>{school.shortName}</span>
                  <span className={styles.dates}>{school.dates}</span>
                </header>
                <h3 className={styles.institution} id={`edu-${id}`}>{school.institution}</h3>
                <p className={styles.degree}>{school.degree}</p>
                <p className={styles.standing}>
                  <span className={styles.standingDot} aria-hidden="true" />
                  {standing(school)}
                  <span className={styles.location}>{school.location}</span>
                </p>
                <ul className={styles.modules} aria-label={`${school.shortName} modules`}>
                  {school.modules.map((m) => (
                    <li key={m.name} className={styles.module} data-module-row="" data-on="false">
                      <span className={styles.glyph} aria-hidden="true">
                        <ModuleGlyph kind={m.visual} />
                      </span>
                      <span className={styles.moduleName}>{m.name}</span>
                      <span className={styles.moduleBlurb}>{m.blurb}</span>
                    </li>
                  ))}
                </ul>
              </article>
            )
          })}
        </div>

        <div className={`${styles.foot} ${shared.driven}`} ref={footRef}>
          <span className={styles.footLabel}>Also</span>
          <ul className={styles.credentials} aria-label="Additional credentials">
            {credentials.map((c) => (
              <li key={c.id}>
                <span>{c.title}</span>
                <span>{c.issuer}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Chapter>
  )
}
