'use client'

import { useEffect, useRef, useState } from 'react'
import { Chapter } from '@/components/journey/Chapter'
import { TagRow, ScrollHint } from '@/components/journey/parts'
import { useJourneyRoute } from '@/components/journey/JourneyProvider'
import { totalVh } from '@/content/chapters'
import { useSite } from '@/cms/context'
import { E, useCmsText } from '@/cms/editable'
import { useChapterFrame } from '@/hooks/useChapterProgress'
import { useJourney } from '@/state/journey'
import { clamp, range } from '@/lib/math'
import shared from './chapters.module.css'
import styles from './Prelude.module.css'

/* ============================================================
   HOME · 00 – 12%  PRELUDE
   No loader, no splash. The name is on screen immediately; the
   roles cycle; scrolling collapses them into a single thesis
   and the letterforms begin to disperse.
   ============================================================ */

/* ============================================================
   HOW LONG IS THIS?
   Minutes are read off the scroll length rather than typed, for
   the same reason the chapter count is: the two journeys are
   different lengths and either could gain a chapter. The rate is
   calibrated against the figure the single fourteen-chapter
   scroll used to quote — roughly nine minutes over sixty
   viewport heights — so nobody has to re-guess it.
   ============================================================ */
const MINUTES_PER_VH = 0.15

export function Prelude() {
  const { profile } = useSite()
  const tag = useCmsText('prelude.tag', 'PORTFOLIO')
  const [firstName, ...rest] = profile.name.split(' ')
  const reducedMotion = useJourney((s) => s.reducedMotion)
  /* The corner counts THIS journey, not the archive. The prelude
     stands at the head of one story, and telling its reader there
     are fourteen chapters ahead when there are seven is a promise
     the scrollbar breaks within a screen. Taken from the route
     rather than the store, so the figure is right in the server's
     HTML instead of being corrected a frame after paint. */
  const { chapters } = useJourneyRoute()
  const minutes = Math.max(1, Math.round(totalVh(false, chapters) * MINUTES_PER_VH))
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
      setRole((r) => (r + 1) % Math.max(1, profile.roles.length))
    }, 1500)
    return () => window.clearInterval(id)
  }, [reducedMotion, profile.roles.length])

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
        <E cms="prelude.tag" as="div" kind="container" label="Portfolio tag" className={`${shared.corner} ${shared.cornerTL}`}>
          <TagRow items={[tag, profile.year]} />
        </E>
        <E cms="prelude.location" as="div" label="Location" className={`${shared.corner} ${shared.cornerTR}`}>
          {profile.location}
          <br />
          51.5072° N
        </E>

        <div className={styles.center}>
          {/* The document's single <h1> is the profile summary that ships
              in the SSR HTML; this is the visible chapter heading. */}
          <E cms="prelude.name" as="h2" kind="container" label="Name" id="prelude-title" data-room-travel="10vh 0" className={`${styles.name} ${shared.driven}`} ref={nameRef}>
            <E cms="prelude.name.first" kind="heading" label="Name — first line" className={styles.nameLine}>{firstName}</E>
            <E cms="prelude.name.last" kind="heading" label="Name — second line" className={styles.nameLine}>{rest.join(' ')}</E>
          </E>

          {/* Every role is always in the DOM: the cycle lights one at a
              time, and the reduced-motion stylesheet stands the whole set
              up at once. One element per role is what lets it be set as a
              rule of type on a desk and a stacked list on a phone. */}
          <E cms="prelude.roles" as="div" kind="list" label="Rotating roles" className={styles.rolesWrap} ref={rolesRef} aria-hidden="true">
            {profile.roles.map((r, i) => (
              <E cms={`prelude.roles.${i}`} key={r} label={`Role ${i + 1}`} bind={`profile.roles.${i}`} className={styles.role} data-on={i === role}>{r}</E>
            ))}
          </E>
          <p className="sr-only">
            {profile.roles.join(', ')}. {profile.summary}
          </p>

          <E cms="prelude.thesis" as="p" label="Thesis" bind="profile.thesis" data-room-travel="0 1.6rem" className={`${styles.thesis} ${shared.driven}`} ref={thesisRef}>
            {profile.thesis}
          </E>
        </div>

        <div className={`${shared.corner} ${shared.cornerBL} ${shared.driven}`} ref={hintRef}>
          <ScrollHint />
        </div>
        {/* Derived, not typed: a hardcoded count is a promise the
            content file can break silently. */}
        <E cms="prelude.length" as="div" kind="container" label="Journey length" className={`${shared.corner} ${shared.cornerBR}`}>
          {chapters.length} CHAPTERS
          <br />
          ~{minutes} MINUTES
        </E>
      </div>
    </Chapter>
  )
}
