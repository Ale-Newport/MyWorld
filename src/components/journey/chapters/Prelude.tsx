'use client'

import { useEffect, useRef, useState } from 'react'
import { Chapter } from '@/components/journey/Chapter'
import { TagRow, ScrollHint } from '@/components/journey/parts'
import { profile } from '@/content/profile'
import { chapters } from '@/content/chapters'
import { useChapterFrame } from '@/hooks/useChapterProgress'
import { useJourney } from '@/state/journey'
import { clamp, range } from '@/lib/math'
import shared from './chapters.module.css'
import styles from './Prelude.module.css'

/* ============================================================
   00 – 04%  PRELUDE
   No loader, no splash. The name is on screen immediately; the
   roles cycle; scrolling collapses them into a single thesis
   and the letterforms begin to disperse.
   ============================================================ */

export function Prelude() {
  const reducedMotion = useJourney((s) => s.reducedMotion)
  const [role, setRole] = useState(0)
  const nameRef = useRef<HTMLHeadingElement>(null)
  const rolesRef = useRef<HTMLDivElement>(null)
  const thesisRef = useRef<HTMLParagraphElement>(null)
  const hintRef = useRef<HTMLDivElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)

  /* Role rotation — stops once the visitor starts scrolling. */
  useEffect(() => {
    if (reducedMotion) return
    const id = window.setInterval(() => {
      setRole((r) => (r + 1) % profile.roles.length)
    }, 1500)
    return () => window.clearInterval(id)
  }, [reducedMotion])

  useChapterFrame('prelude', (t) => {
    const shell = shellRef.current
    if (!shell || reducedMotion) return

    // The name lifts and loosens as the visitor scrolls away.
    const away = range(t, 0.08, 0.75)
    const n = nameRef.current
    if (n) {
      n.style.transform = `translate3d(0, ${-away * 14}vh, 0) scale(${1 - away * 0.14})`
      n.style.letterSpacing = `${-0.045 + away * 0.09}em`
      n.style.opacity = String(1 - clamp(range(t, 0.5, 0.9)))
    }

    // Roles fade out and the thesis takes their place.
    const r = rolesRef.current
    if (r) r.style.opacity = String(1 - clamp(range(t, 0.05, 0.3)))

    const th = thesisRef.current
    if (th) {
      const a = clamp(range(t, 0.22, 0.5)) * (1 - clamp(range(t, 0.72, 0.95)))
      th.style.opacity = String(a)
      th.style.transform = `translate3d(0, ${(1 - a) * 1.6}rem, 0)`
    }

    const h = hintRef.current
    if (h) h.style.opacity = String(1 - clamp(range(t, 0.02, 0.18)))
  })

  return (
    <Chapter id="prelude" labelledBy="prelude-title">
      <div className={`${shared.stage} ${styles.stage}`} ref={shellRef}>
        <div className={`${shared.corner} ${shared.cornerTL}`}>
          <TagRow items={['PORTFOLIO', profile.year]} />
        </div>
        <div className={`${shared.corner} ${shared.cornerTR}`}>
          {profile.location}
          <br />
          51.5072° N
        </div>

        <div className={styles.center}>
          {/* The document's single <h1> is the profile summary that ships
              in the SSR HTML; this is the visible chapter heading. */}
          <h2 id="prelude-title" className={`${styles.name} ${shared.driven}`} ref={nameRef}>
            <span className={styles.nameLine}>Alejandro</span>
            <span className={styles.nameLine}>Newport</span>
          </h2>

          {/* Every role is always in the DOM: the cycle lights one at a
              time, and the reduced-motion stylesheet stands the whole set
              up at once. One element per role is what lets it be set as a
              rule of type on a desk and a stacked list on a phone. */}
          <div className={styles.rolesWrap} ref={rolesRef} aria-hidden="true">
            {profile.roles.map((r, i) => (
              <span key={r} className={styles.role} data-on={i === role}>{r}</span>
            ))}
          </div>
          <p className="sr-only">
            {profile.roles.join(', ')}. {profile.summary}
          </p>

          <p className={`${styles.thesis} ${shared.driven}`} ref={thesisRef}>
            {profile.thesis}
          </p>
        </div>

        <div className={`${shared.corner} ${shared.cornerBL} ${shared.driven}`} ref={hintRef}>
          <ScrollHint />
        </div>
        {/* Derived, not typed: a hardcoded count is a promise the
            content file can break silently. */}
        <div className={`${shared.corner} ${shared.cornerBR}`}>
          {chapters.length} CHAPTERS
          <br />
          ~9 MINUTES
        </div>
      </div>
    </Chapter>
  )
}
