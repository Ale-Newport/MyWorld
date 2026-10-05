'use client'

import { useRef } from 'react'
import { Chapter } from '@/components/journey/Chapter'
import { Reveal } from '@/components/typography/Reveal'
import { TagRow } from '@/components/journey/parts'
import { useSite } from '@/cms/context'
import { E, useCms, useCmsText } from '@/cms/editable'
import { useChapterFrame } from '@/hooks/useChapterProgress'
import { useJourney } from '@/state/journey'
import { clamp, range } from '@/lib/math'
import { SectionAnimation } from '@/sections/SectionAnimation'
import shared from './chapters.module.css'
import styles from './About.module.css'

/* ============================================================
   HOME · 12 – 25%  A LITTLE ABOUT ME
   The introduction on one side, the section's animation on the
   other (stacked below it on narrow and tall screens). The two
   never share pixels: the layout gives each its own region, so
   the summary stays readable whatever the animation does and
   however long the summary becomes.

   The through-lines (Spain → London, KCL → UCL…) are content:
   the animations draw them, and a list below names them for
   anyone who cannot see the drawing.
   ============================================================ */

/** Long summaries step the type down rather than spill out of the stage. */
const lengthClass = (text: string) => (text.length > 260 ? 'long' : text.length > 150 ? 'medium' : 'short')

export function About() {
  const { profile, chapterById } = useSite()
  const summaryCms = useCms('about.summary', { kind: 'heading', label: 'Summary', bind: 'profile.summary' })
  const tag = useCmsText('about.tag', 'A LITTLE ABOUT ME')
  const reducedMotion = useJourney((s) => s.reducedMotion)
  const introRef = useRef<HTMLDivElement>(null)

  useChapterFrame('about', (t) => {
    if (reducedMotion) return
    const intro = introRef.current
    if (!intro) return
    const a = clamp(range(t, 0.02, 0.2)) * (1 - clamp(range(t, 0.7, 0.9)))
    intro.style.opacity = String(a)
    intro.style.transform = `translate3d(0, ${(1 - a) * 2}rem, 0)`
  })

  return (
    <Chapter id="about" labelledBy="about-title">
      <div className={`${shared.stage} ${styles.stage}`}>
        <E cms="about.tag" as="div" kind="container" label="Chapter tag" className={`${shared.corner} ${shared.cornerTL}`}>
          <TagRow items={[chapterById['about'].number, tag]} />
        </E>

        <div className={`${styles.intro} ${shared.driven}`} ref={introRef} data-about-intro="">
          <Reveal as="h2" mode="mask" className={styles.summary} id="about-title" attrs={{ ...summaryCms, 'data-length': lengthClass(profile.summary) }}>
            {profile.summary}
          </Reveal>
          <ul className="sr-only" aria-label="Career through-lines">
            {profile.markers.map((m, i) => (
              <li key={`${m.from}-${i}`}>
                {m.from} to {m.to}
              </li>
            ))}
          </ul>
        </div>

        <SectionAnimation section="about" className={styles.visual} reserve />

        <E cms="about.corner" as="div" kind="text" label="Corner note" className={`${shared.corner} ${shared.cornerBR} ${styles.corner}`}>
          THE PATH BELOW
          <br />
          IS THE TIMELINE
        </E>
      </div>
    </Chapter>
  )
}
