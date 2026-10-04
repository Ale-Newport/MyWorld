'use client'

import { useRef } from 'react'
import { Chapter } from '@/components/journey/Chapter'
import { Reveal } from '@/components/typography/Reveal'
import { TagRow } from '@/components/journey/parts'
import { useSite } from '@/cms/context'
import { E, useCms } from '@/cms/editable'
import { useChapterFrame } from '@/hooks/useChapterProgress'
import { useJourney } from '@/state/journey'
import { clamp, range } from '@/lib/math'
import shared from './chapters.module.css'
import styles from './About.module.css'

/* ============================================================
   HOME · 12 – 25%  A LITTLE ABOUT ME
   The camera pulls back from the title into open space. Four
   transition markers establish the through-line of the whole
   story before any chapter starts.
   ============================================================ */

export function About() {
  const { profile, chapterById } = useSite()
  const summaryCms = useCms('about.summary', { kind: 'heading', label: 'Summary', bind: 'profile.summary' })
  const reducedMotion = useJourney((s) => s.reducedMotion)
  const markersRef = useRef<HTMLUListElement>(null)
  const introRef = useRef<HTMLDivElement>(null)

  useChapterFrame('about', (t) => {
    if (reducedMotion) return
    const intro = introRef.current
    if (intro) {
      const a = clamp(range(t, 0.02, 0.2)) * (1 - clamp(range(t, 0.62, 0.85)))
      intro.style.opacity = String(a)
      intro.style.transform = `translate3d(0, ${(1 - a) * 2}rem, 0)`
    }
    const m = markersRef.current
    if (!m) return
    const items = m.children
    for (let i = 0; i < items.length; i++) {
      const el = items[i] as HTMLElement
      const from = 0.3 + i * 0.09
      const a = clamp(range(t, from, from + 0.14))
      el.style.opacity = String(a)
      el.style.transform = `translate3d(${(1 - a) * -1.5}rem, 0, 0)`
      const bar = el.querySelector<HTMLElement>('[data-bar]')
      if (bar) bar.style.transform = `scaleX(${a})`
    }
  })

  return (
    <Chapter id="about" labelledBy="about-title">
      <div className={`${shared.stage} ${styles.stage}`}>
        <E cms="about.tag" as="div" kind="text" label="Chapter tag" className={`${shared.corner} ${shared.cornerTL}`}>
          <TagRow items={[chapterById['about'].number, 'A LITTLE ABOUT ME']} />
        </E>

        <div className={`${styles.intro} ${shared.driven}`} ref={introRef} data-about-intro="">
          <Reveal as="h2" mode="mask" className={styles.summary} id="about-title" attrs={summaryCms}>
            {profile.summary}
          </Reveal>
        </div>

        <E cms="about.markers" as="ul" kind="list" label="Through-lines" className={styles.markers} ref={markersRef} aria-label="Career through-lines">
          {profile.markers.map((m, i) => (
            <li key={m.from} className={styles.marker}>
              <E cms={`about.markers.${i}.from`} kind="text" label={`Marker ${i + 1} from`} bind={`profile.markers.${i}.from`} className={styles.markerFrom}>{m.from}</E>
              <span className={styles.markerBarWrap} aria-hidden="true">
                <span className={styles.markerBar} data-bar="" />
              </span>
              <E cms={`about.markers.${i}.to`} kind="text" label={`Marker ${i + 1} to`} bind={`profile.markers.${i}.to`} className={styles.markerTo}>{m.to}</E>
            </li>
          ))}
        </E>

        <E cms="about.corner" as="div" kind="text" label="Corner note" className={`${shared.corner} ${shared.cornerBR}`}>
          THE PATH BELOW
          <br />
          IS THE TIMELINE
        </E>
      </div>
    </Chapter>
  )
}
