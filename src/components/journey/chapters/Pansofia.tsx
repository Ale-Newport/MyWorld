'use client'

import { useEffect, useRef, useState } from 'react'
import { Chapter } from '@/components/journey/Chapter'
import { useSite } from '@/cms/context'
import { E, useCms, useCmsText } from '@/cms/editable'
import { Reveal } from '@/components/typography/Reveal'
import { TagRow, MetricBlock } from '@/components/journey/parts'
import { Counter } from '@/components/typography/Counter'
import { useJourneyRoute } from '@/components/journey/JourneyProvider'
import { useChapterFrame } from '@/hooks/useChapterProgress'
import { useJourney } from '@/state/journey'
import { clamp, range, easeOutCubic } from '@/lib/math'
import shared from './chapters.module.css'
import styles from './Pansofia.module.css'

/* ============================================================
   PROJECTS · 00 – 15%  FROM PROJECTS TO PRODUCTS
   One browser pane becomes many and the count resolves to 14.
   Then a horizontal gallery of the real
   sites — the one place on this site where screenshots are the
   honest answer, because the deliverable WAS the interface.

   The fan and the counter speak for the ROLE: the whole portfolio,
   fourteen sites shipped. The rail speaks for the gallery, and the
   gallery is an edit — eight sites, larger, at a readable pace.
   ============================================================ */

export function Pansofia() {
  const { experienceById, chapterById, clientProjects, featuredClientProjects } = useSite()
  const titleCms = useCms('pansofia.title', { kind: 'heading', label: 'Title' })
  const title = useCmsText('pansofia.title', 'Pansofia /\nGrupo Newport')
  const tag = useCmsText('pansofia.tag', 'FROM PROJECTS TO PRODUCTS')
  const role = experienceById.pansofia
  const reducedMotion = useJourney((s) => s.reducedMotion)
  const railRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const countRef = useRef<HTMLDivElement>(null)
  const stackRef = useRef<HTMLDivElement>(null)
  const hintRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<string | null>(null)
  const setActiveProject = useJourney((s) => s.setActiveProject)
  const { chapters } = useJourneyRoute()

  /* ============================================================
     THE FRONT DOOR OF A JOURNEY HAS NO RUN-UP

     Every chapter fades its head in over its first tenth, which
     is what carries the reader across the seam from the chapter
     before. Since the split this one OPENS `/projects`, where
     there is no chapter before: the same fade meets a visitor
     with an empty white screen and asks them to scroll half a
     viewport before the page says what it is. So when this
     chapter is first in its journey the entry is already
     finished at t = 0. The exit is untouched — there is still
     something after it to leave for.

     The running order comes from the route rather than the store,
     so the very first frame this chapter draws already knows it is
     the landing screen — read from a store corrected by an effect
     it would run the fade it is meant to skip and then cut.
     ============================================================ */
  const opensJourney = chapters[0]?.id === 'pansofia'
  const entry = (t: number, from: number, to: number) =>
    (opensJourney ? 1 : clamp(range(t, from, to)))

  /* How far the panes may travel from the middle of their region and
     still be wholly inside it, rotation included. Measured when the
     region or the panes change size, never per frame. */
  const fanRef = useRef({ x: 0, y: 0 })
  useEffect(() => {
    const stack = stackRef.current
    const pane = stack?.firstElementChild as HTMLElement | null | undefined
    if (!stack || !pane) return
    const measure = () => {
      const tilt = (6.5 * Math.PI) / 180
      const halfW = (pane.offsetWidth / 2) * Math.cos(tilt) + (pane.offsetHeight / 2) * Math.sin(tilt)
      const halfH = (pane.offsetHeight / 2) * Math.cos(tilt) + (pane.offsetWidth / 2) * Math.sin(tilt)
      fanRef.current.x = Math.max(0, stack.clientWidth / 2 - halfW - 4)
      fanRef.current.y = Math.max(0, stack.clientHeight / 2 - halfH - 4)
    }
    const ro = new ResizeObserver(measure)
    ro.observe(stack)
    ro.observe(pane)
    measure()
    return () => ro.disconnect()
  }, [])

  useChapterFrame('pansofia', (t) => {
    if (reducedMotion) return

    const head = headRef.current
    if (head) {
      const a = entry(t, 0.0, 0.1) * (1 - clamp(range(t, 0.26, 0.36)))
      head.style.opacity = String(a)
      head.style.transform = `translate3d(0, ${(1 - a) * 1.6}rem, 0)`
    }

    // The browser panes fan out of one, then collapse and clear the
    // stage for the count. The fan is measured from its own region, so
    // its outermost pane stops at that region's edge, never on the copy.
    const stack = stackRef.current
    if (stack) {
      const fan = clamp(range(t, 0.05, 0.28))
      const collapse = clamp(range(t, 0.28, 0.36))
      const a = entry(t, 0.02, 0.12) * (1 - clamp(range(t, 0.32, 0.4)))
      stack.style.opacity = String(a)
      const panes = stack.children
      const { x: tx, y: ty } = fanRef.current
      for (let i = 0; i < panes.length; i++) {
        const el = panes[i] as HTMLElement
        const k = i / Math.max(1, panes.length - 1)
        const spread = easeOutCubic(fan) * (1 - collapse)
        const x = (k - 0.5) * 2 * spread * tx
        const y = ((k - 0.5) * 1.2 + Math.sin(k * 6) * 0.4) * spread * ty
        const rot = (k - 0.5) * spread * 13
        el.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${rot}deg) scale(${0.9 + spread * 0.1})`
      }
    }

    // The count has the stage to itself: in once the panes have gone,
    // out before the gallery arrives.
    const count = countRef.current
    if (count) {
      const a = clamp(range(t, 0.40, 0.48)) * (1 - clamp(range(t, 0.53, 0.59)))
      count.style.opacity = String(a)
      count.style.transform = `scale(${0.9 + a * 0.1})`
    }

    // Horizontal gallery scrubs with vertical scroll — no scroll-jack,
    // the page still moves at its own pace. The travel is measured, not
    // assumed, so the rail lands on the last tile whatever the gallery
    // holds; the tiles are sized so eight of them still have somewhere
    // to go on a wide screen.
    const rail = railRef.current
    if (rail) {
      const a = clamp(range(t, 0.6, 0.68))
      rail.style.opacity = String(a)
      if (hintRef.current) hintRef.current.style.opacity = String(a)
      const travel = Math.max(0, rail.scrollWidth - rail.clientWidth)
      const p = clamp(range(t, 0.62, 0.98))
      rail.scrollLeft = travel * p
    }
  })

  return (
    <Chapter id="pansofia" labelledBy="pansofia-title">
      <div className={`${shared.stage} ${styles.stage}`}>
        <div className={`${styles.head} ${shared.driven}`} ref={headRef}>
          <E cms="pansofia.tag" kind="container" label="Chapter tag"><TagRow items={[chapterById['pansofia'].number, tag, role.dates]} /></E>
          <Reveal as="h2" mode="mask" className={styles.title} id="pansofia-title" attrs={titleCms}>
            {title}
          </Reveal>
          <p className={styles.role}>{role.role}</p>
          <p className={`${shared.lead} ${styles.lead}`}>{role.summary}</p>
          <div className={styles.metrics}>
            {role.metrics.map((m) => (
              <MetricBlock key={m.label} value={m.value} label={m.label} size="sm" />
            ))}
          </div>
        </div>

        {/* One pane per site in the engagement, not per tile in the
            gallery: this is the "one becomes many" beat that the count
            resolves, and eight panes would fan too thin to read. */}
        <div className={styles.stack} ref={stackRef} aria-hidden="true">
          {clientProjects.map((p) => (
            <span key={p.id} className={styles.pane} style={{ borderTopColor: p.accent }}>
              <span className={styles.paneBar}>
                <i /><i /><i />
              </span>
            </span>
          ))}
        </div>

        <div className={styles.count} ref={countRef} aria-hidden="true">
          <span className={styles.countNum}><Counter to={14} duration={1.1} /></span>
          <span className={styles.countLabel}>Websites shipped</span>
          <span className={styles.countSub}>Two weeks ahead of schedule · team of six</span>
        </div>

        <div className={styles.rail} ref={railRef}>
          <ul className={styles.railList}>
            {featuredClientProjects.map((p) => (
              <li
                key={p.id}
                className={styles.site}
                data-hover={hover === p.slug}
                onMouseEnter={() => setHover(p.slug)}
                onMouseLeave={() => setHover(null)}
                style={{ ['--site-accent' as string]: p.accent }}
              >
                <button
                  type="button"
                  className={styles.siteBtn}
                  onClick={() => setActiveProject(p.slug)}
                  data-cursor="view"
                  data-cursor-text="OPEN"
                >
                  <span className={styles.frame}>
                    <span className={styles.chrome} aria-hidden="true">
                      <i /><i /><i />
                      <span className={styles.chromeUrl}>{p.liveUrl?.replace(/^https?:\/\//, '')}</span>
                    </span>
                    <span className={styles.shotWrap}>
                      <picture>
                        <source srcSet={`/assets/client-work/${p.slug}-desktop.avif`} type="image/avif" />
                        <img
                          src={`/assets/client-work/${p.slug}-desktop.webp`}
                          alt={`${p.title} homepage`}
                          className={styles.shot}
                          loading="lazy"
                          decoding="async"
                          width={1200}
                          height={1833}
                        />
                      </picture>
                    </span>
                    <span className={styles.mobileWrap} aria-hidden="true">
                      <picture>
                        <source srcSet={`/assets/client-work/${p.slug}-mobile.avif`} type="image/avif" />
                        <img
                          src={`/assets/client-work/${p.slug}-mobile.webp`}
                          alt=""
                          className={styles.mobileShot}
                          loading="lazy"
                          decoding="async"
                          width={390}
                          height={1400}
                        />
                      </picture>
                    </span>
                  </span>
                  <span className={styles.meta}>
                    <span className={styles.siteName}>{p.title}</span>
                    <span className={styles.siteSector}>{p.subcategory}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className={`${shared.corner} ${shared.cornerTR} ${styles.hint}`} ref={hintRef}>
          DRAG OR SCROLL
          <br />
          SELECTED WORK · 2025
        </div>
      </div>
    </Chapter>
  )
}
