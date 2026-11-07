'use client'

import type { CSSProperties } from 'react'
import { useSite } from '@/cms/context'
import { useCmsText } from '@/cms/editable'
import { widestWordEm } from '@/components/typography/capitals'
import { SiteHeader } from '@/components/site/SiteHeader'
import { Arrow } from '@/components/ui/Arrow'
import { Terminal } from './Terminal'
import styles from './ContactPage.module.css'

/* ============================================================
   CONTACT — THE LAST CHAPTER, STANDING STILL
   What the home page says at its foot (journey/chapters/Contact),
   said on a page that does not move: the closing question and
   its answer in the display type, the links, the colophon. The
   same data and the same words — the colophon even honours the
   admin's edits to the home chapter's lines — with none of the
   scroll: the type rises into place once, and under reduced
   motion it is simply there.

   The terminal floats to the right on a desktop (the column
   leaves it its width) and sits under the links on a phone.
   ============================================================ */

export function ContactPage() {
  const { profile, contact, projects, techNodes } = useSite()
  const signature = useCmsText('contact.colophon.name', `${profile.name} · Portfolio ${profile.year}`)
  const credits = useCmsText('contact.colophon.built', 'Built with Next.js, React Three Fiber and a lot of scroll maths.')
  const { question, answer } = profile.closing
  // As large as the column allows, and no larger than its longest word does (capitals.ts): lines break between words.
  const wordEm = (Math.max(widestWordEm(question, -0.052), widestWordEm(answer, -0.052)) + 0.1).toFixed(3)

  return (
    <>
      <SiteHeader current="contact" />
      <main className={styles.page}>
        <div className={styles.eyebrow} style={{ '--i': 0 } as CSSProperties}>
          <p className={styles.tags}>
            <span>Contact</span>
            <span>{profile.location}</span>
          </p>
          <p className={styles.stats}>
            {projects.length} projects
            <br />
            {techNodes.length} technologies
          </p>
        </div>

        <div className={styles.closing}>
          <h1 className={styles.title} style={{ '--word-em': wordEm } as CSSProperties}>
            <span className={styles.titleLine}>
              <span className={styles.titleText} style={{ '--i': 1 } as CSSProperties}>{question}</span>
            </span>{' '}
            <span className={`${styles.titleLine} ${styles.answer}`}>
              <span className={styles.titleText} style={{ '--i': 2 } as CSSProperties}>{answer}</span>
            </span>
          </h1>
        </div>

        <ul className={styles.links} aria-label="Contact links">
          {contact.map((c, i) => {
            const pending = c.id === 'cv' && c.dataStatus === 'placeholder'
            const external = c.href.startsWith('http')
            return (
              <li key={c.id} className={styles.item} style={{ '--i': 3 + i } as CSSProperties}>
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
                    <span className={styles.linkArrow}><Arrow dir="up-right" /></span>
                  </a>
                )}
              </li>
            )
          })}
        </ul>

        <div className={styles.terminal}>
          <Terminal />
        </div>

        <footer className={styles.colophon} style={{ '--i': 3 + contact.length } as CSSProperties}>
          <span>{signature}</span>
          <span>{credits}</span>
        </footer>
      </main>
    </>
  )
}
