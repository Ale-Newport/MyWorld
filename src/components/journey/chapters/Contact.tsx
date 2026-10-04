'use client'

import { useRef } from 'react'
import { Chapter } from '@/components/journey/Chapter'
import { Reveal } from '@/components/typography/Reveal'
import { TagRow } from '@/components/journey/parts'
import { WorldPortal, portal } from '@/components/journey/WorldPortal'
import { profile, contact } from '@/content/profile'
import { chapterById } from '@/content/chapters'
import { projects } from '@/content/projects'
import { techNodes } from '@/content/skills'
import { useChapterFrame } from '@/hooks/useChapterProgress'
import { useJourney } from '@/state/journey'
import { clamp, easeOutCubic, range } from '@/lib/math'
import shared from './chapters.module.css'
import styles from './Contact.module.css'

/* ============================================================
   HOME · 86 – 100%  WHAT'S NEXT?
   The camera pulls all the way back and everything the visitor
   passed reassembles into one body. The ending mirrors the
   opening: open space, now full of what was built in it.
   ============================================================ */

export function Contact() {
  const reducedMotion = useJourney((s) => s.reducedMotion)
  const stageRef = useRef<HTMLDivElement>(null)
  const questionRef = useRef<HTMLParagraphElement>(null)
  const answerRef = useRef<HTMLParagraphElement>(null)
  const linksRef = useRef<HTMLUListElement>(null)

  useChapterFrame('contact', (t) => {
    if (reducedMotion) return

    /* Everything the visitor has been reading retreats ahead of the
       portal's veil, so the last chapter clears the stage itself
       rather than being painted over mid-sentence. */
    const rise = easeOutCubic(portal.pull)
    const dim = 1 - rise * 0.82
    const lift = rise * 3.2

    /* And the whole stage is held back by whatever the portal is
       currently refusing to hand over. The page is already at its
       foot, so this is the only place the resistance can be seen:
       scroll spent against the portal moves the last chapter a
       fraction of what it asked for, and lets it spring back the
       moment the pushing stops. One number, two chapters' worth of
       loops — the portal computes it, this one spends it. */
    const stage = stageRef.current
    if (stage) {
      stage.style.setProperty('--portal-dim', String(rise))
      // Tenths of a pixel. Anything finer is a longer string for a
      // difference no screen has.
      stage.style.setProperty('--portal-drag', (Math.round(portal.drag * 10) / 10).toFixed(1))
    }

    const q = questionRef.current
    if (q) {
      const a = clamp(range(t, 0.12, 0.3)) * (1 - clamp(range(t, 0.42, 0.55)))
      q.style.opacity = String(a * dim)
      q.style.transform = `translate3d(0, ${(1 - a) * 2.4 - lift}rem, 0) scale(${0.96 + a * 0.04})`
    }

    const ans = answerRef.current
    if (ans) {
      const a = clamp(range(t, 0.5, 0.66))
      ans.style.opacity = String(a * dim)
      ans.style.transform = `translate3d(0, ${(1 - a) * 2.4 - lift}rem, 0)`
    }

    const links = linksRef.current
    if (links) {
      for (let i = 0; i < links.children.length; i++) {
        const el = links.children[i] as HTMLElement
        const from = 0.66 + i * 0.045
        const a = clamp(range(t, from, from + 0.1))
        el.style.opacity = String(a * dim)
        el.style.transform = `translate3d(0, ${(1 - a) * 1.4 - lift}rem, 0)`
      }
    }
  })

  return (
    <Chapter id="contact" labelledBy="contact-title">
      <div className={`${shared.stage} ${styles.stage}`} ref={stageRef}>
        <div className={`${shared.corner} ${shared.cornerTL} ${styles.chrome}`}>
          <TagRow items={[chapterById['contact'].number, 'END OF JOURNEY']} />
        </div>
        <div className={`${shared.corner} ${shared.cornerTR} ${styles.chrome}`}>
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

        <footer className={`${styles.colophon} ${styles.chrome}`}>
          <span>{profile.name} · Portfolio {profile.year}</span>
          <span>Built with Next.js, React Three Fiber and a lot of scroll maths.</span>
        </footer>

        {/* The world is an optional second way through the same
            material, so it waits at the foot of the page: one more
            scroll past the end and it takes over. */}
        <WorldPortal />
      </div>
    </Chapter>
  )
}
