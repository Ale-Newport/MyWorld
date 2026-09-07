'use client'

import { useRef } from 'react'
import { Chapter } from '@/components/journey/Chapter'
import { Reveal } from '@/components/typography/Reveal'
import { TagRow } from '@/components/journey/parts'
import { profile, contact } from '@/content/profile'
import { projects } from '@/content/projects'
import { techNodes } from '@/content/skills'
import { useChapterFrame } from '@/hooks/useChapterProgress'
import { useJourney } from '@/state/journey'
import { clamp, range } from '@/lib/math'
import shared from './chapters.module.css'
import styles from './Contact.module.css'

/* ============================================================
   98 – 100%  WHAT'S NEXT?
   The camera pulls all the way back and everything the visitor
   passed reassembles around the Core. The ending mirrors the
   opening: one object, now surrounded by what it built.
   ============================================================ */

export function Contact() {
  const reducedMotion = useJourney((s) => s.reducedMotion)
  const questionRef = useRef<HTMLParagraphElement>(null)
  const answerRef = useRef<HTMLParagraphElement>(null)
  const linksRef = useRef<HTMLUListElement>(null)

  useChapterFrame('contact', (t) => {
    if (reducedMotion) return

    const q = questionRef.current
    if (q) {
      const a = clamp(range(t, 0.12, 0.3)) * (1 - clamp(range(t, 0.42, 0.55)))
      q.style.opacity = String(a)
      q.style.transform = `translate3d(0, ${(1 - a) * 2.4}rem, 0) scale(${0.96 + a * 0.04})`
    }

    const ans = answerRef.current
    if (ans) {
      const a = clamp(range(t, 0.5, 0.66))
      ans.style.opacity = String(a)
      ans.style.transform = `translate3d(0, ${(1 - a) * 2.4}rem, 0)`
    }

    const links = linksRef.current
    if (links) {
      for (let i = 0; i < links.children.length; i++) {
        const el = links.children[i] as HTMLElement
        const from = 0.66 + i * 0.045
        const a = clamp(range(t, from, from + 0.1))
        el.style.opacity = String(a)
        el.style.transform = `translate3d(0, ${(1 - a) * 1.4}rem, 0)`
      }
    }
  })

  return (
    <Chapter id="contact" labelledBy="contact-title">
      <div className={`${shared.stage} ${styles.stage}`}>
        <div className={`${shared.corner} ${shared.cornerTL}`}>
          <TagRow items={['15', 'END OF JOURNEY']} />
        </div>
        <div className={`${shared.corner} ${shared.cornerTR}`}>
          {projects.length} PROJECTS
          <br />
          {techNodes.length} TECHNOLOGIES
          <br />
          MOVE YOUR POINTER
        </div>

        <div className={styles.center}>
          <p className={`${styles.question} ${shared.driven}`} ref={questionRef} aria-hidden="true">
            {profile.closing.question}
          </p>
          <p className={`${styles.answer} ${shared.driven}`} ref={answerRef}>
            <Reveal as="span" mode="chars" className={styles.answerText} id="contact-title">
              {profile.closing.answer}
            </Reveal>
          </p>
        </div>

        <ul className={styles.links} ref={linksRef}>
          {contact.map((c) => {
            const pending = c.id === 'cv' && c.dataStatus === 'placeholder'
            const external = c.href.startsWith('http')
            return (
              <li key={c.id} className={shared.driven}>
                {pending ? (
                  <span className={styles.link} data-pending="true">
                    <span className={styles.linkLabel}>{c.label}</span>
                    <span className={styles.linkValue}>On request</span>
                  </span>
                ) : (
                  <a
                    href={c.href}
                    className={styles.link}
                    target={external ? '_blank' : undefined}
                    rel={external ? 'noreferrer noopener' : undefined}
                    data-cursor="link"
                    data-cursor-text={c.label.toUpperCase()}
                  >
                    <span className={styles.linkLabel}>{c.label}</span>
                    <span className={styles.linkValue}>{c.value}</span>
                    <span className={styles.linkArrow} aria-hidden="true">↗</span>
                  </a>
                )}
              </li>
            )
          })}
        </ul>

        <footer className={styles.colophon}>
          <span>{profile.name} · Portfolio {profile.year}</span>
          <span>Built with Next.js, React Three Fiber and a lot of scroll maths.</span>
        </footer>
      </div>
    </Chapter>
  )
}
