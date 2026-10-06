'use client'

import { useRef, type CSSProperties } from 'react'
import { Chapter } from '@/components/journey/Chapter'
import { Reveal } from '@/components/typography/Reveal'
import { widestWordEm } from '@/components/typography/capitals'
import { TagRow } from '@/components/journey/parts'
import { WorldPortal, portal } from '@/components/journey/WorldPortal'
import { useSite } from '@/cms/context'
import { E, useCms, useCmsText } from '@/cms/editable'
import { useChapterFrame } from '@/hooks/useChapterProgress'
import { useJourney } from '@/state/journey'
import { clamp, easeOutCubic, range } from '@/lib/math'
import shared from './chapters.module.css'
import styles from './Contact.module.css'

/* ============================================================
   HOME · 86 – 100%  WHAT'S NEXT?
   The closing words in the middle of the stage, the links and the
   colophon below them. The leaf transition into /world is the
   garden cover (home/botanical, home/room/canopy), driven by
   <WorldPortal/> at the foot.
   ============================================================ */

export function Contact() {
  const { profile, contact, chapterById, projects, techNodes } = useSite()
  const answerCms = useCms('contact.answer', { kind: 'heading', label: 'Closing answer', bind: 'profile.closing.answer' })
  const tag = useCmsText('contact.tag', 'END OF JOURNEY')
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
        <E cms="contact.tag" as="div" kind="container" label="Chapter tag" className={`${shared.corner} ${shared.cornerTL} ${styles.chrome}`}>
          <TagRow items={[chapterById['contact'].number, tag]} />
        </E>
        <E cms="contact.stats" as="div" label="Totals" className={`${shared.corner} ${shared.cornerTR} ${styles.chrome}`}>
          {projects.length} PROJECTS
          <br />
          {techNodes.length} TECHNOLOGIES
        </E>

        {/* The closing words are set as large as their longest word allows
            (capitals.ts), so a long answer wraps between words, never inside one. */}
        <div className={styles.center} style={{ '--word-em': (Math.max(widestWordEm(profile.closing.question, -0.052), widestWordEm(profile.closing.answer, -0.052)) + 0.1).toFixed(3) } as CSSProperties}>
          <E cms="contact.question" as="p" kind="heading" label="Closing question" bind="profile.closing.question" className={`${styles.question} ${shared.driven}`} ref={questionRef} aria-hidden="true" data-room-travel="3.2rem 2.4rem">
            {profile.closing.question}
          </E>
          <p className={`${styles.answer} ${shared.driven}`} ref={answerRef} data-room-travel="3.2rem 2.4rem">
            <Reveal as="span" mode="chars" className={styles.answerText} id="contact-title" attrs={answerCms}>
              {profile.closing.answer}
            </Reveal>
          </p>
        </div>

        <E cms="contact.links" as="ul" kind="list" label="Contact links" className={styles.links} ref={linksRef} data-room-travel="3.2rem 1.4rem" data-room-reserve="0">
          {contact.map((c, i) => {
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
                    <E cms={`contact.link.${c.id}.label`} label={`${c.label} — label`} bind={`contact.${i}.label`} className={styles.linkLabel}>{c.label}</E>
                    <E cms={`contact.link.${c.id}.value`} label={`${c.label} — value`} bind={`contact.${i}.value`} className={styles.linkValue}>{c.value}</E>
                    <span className={styles.linkArrow} aria-hidden="true">↗</span>
                  </a>
                )}
              </li>
            )
          })}
        </E>

        <E cms="contact.colophon" as="footer" kind="container" label="Colophon" className={`${styles.colophon} ${styles.chrome}`}>
          <E cms="contact.colophon.name" label="Colophon — name">{profile.name} · Portfolio {profile.year}</E>
          <E cms="contact.colophon.built" label="Colophon — credits">Built with Next.js, React Three Fiber and a lot of scroll maths.</E>
        </E>

        {/* The world is an optional second way through the same
            material, so it waits at the foot of the page: one more
            scroll past the end and it takes over. */}
        <WorldPortal />
      </div>
    </Chapter>
  )
}
