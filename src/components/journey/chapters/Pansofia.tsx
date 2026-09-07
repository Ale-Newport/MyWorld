'use client'

import { useRef, useState } from 'react'
import { Chapter } from '@/components/journey/Chapter'
import { Reveal } from '@/components/typography/Reveal'
import { TagRow, MetricBlock } from '@/components/journey/parts'
import { Counter } from '@/components/typography/Counter'
import { experienceById } from '@/content/experience'
import { clientProjects } from '@/content/projects/client'
import { useChapterFrame } from '@/hooks/useChapterProgress'
import { useJourney } from '@/state/journey'
import { clamp, range, easeOutCubic } from '@/lib/math'
import shared from './chapters.module.css'
import styles from './Pansofia.module.css'

/* ============================================================
   31 – 40%  CHAPTER II — FROM PROJECTS TO PRODUCTS
   The Core unfolds into a browser, one becomes many, and the
   count resolves to 14. Then a horizontal gallery of the real
   sites — the one place on this site where screenshots are the
   honest answer, because the deliverable WAS the interface.
   ============================================================ */

export function Pansofia() {
  const role = experienceById.pansofia
  const reducedMotion = useJourney((s) => s.reducedMotion)
  const railRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const countRef = useRef<HTMLDivElement>(null)
  const stackRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<string | null>(null)
  const setActiveProject = useJourney((s) => s.setActiveProject)

  useChapterFrame('pansofia', (t) => {
    if (reducedMotion) return

    const head = headRef.current
    if (head) {
      const a = clamp(range(t, 0.0, 0.1)) * (1 - clamp(range(t, 0.26, 0.36)))
      head.style.opacity = String(a)
      head.style.transform = `translate3d(0, ${(1 - a) * 1.6}rem, 0)`
    }

    // Fourteen browser panes fan out, then collapse behind the count.
    const stack = stackRef.current
    if (stack) {
      const fan = clamp(range(t, 0.05, 0.3))
      const collapse = clamp(range(t, 0.3, 0.42))
      const a = clamp(range(t, 0.02, 0.12)) * (1 - clamp(range(t, 0.34, 0.44)))
      stack.style.opacity = String(a)
      const panes = stack.children
      for (let i = 0; i < panes.length; i++) {
        const el = panes[i] as HTMLElement
        const k = i / Math.max(1, panes.length - 1)
        const spread = easeOutCubic(fan) * (1 - collapse)
        const x = (k - 0.5) * spread * 62
        const y = (k - 0.5) * spread * 16 + Math.sin(k * 6) * spread * 5
        const rot = (k - 0.5) * spread * 13
        el.style.transform = `translate3d(${x}vw, ${y}vh, 0) rotate(${rot}deg) scale(${0.9 + spread * 0.1})`
      }
    }

    const count = countRef.current
    if (count) {
      const a = clamp(range(t, 0.40, 0.48)) * (1 - clamp(range(t, 0.56, 0.63)))
      count.style.opacity = String(a)
      count.style.transform = `scale(${0.9 + a * 0.1})`
    }

    // Horizontal gallery scrubs with vertical scroll — no scroll-jack,
    // the page still moves at its own pace.
    const rail = railRef.current
    if (rail) {
      const a = clamp(range(t, 0.6, 0.68))
      rail.style.opacity = String(a)
      const travel = rail.scrollWidth - rail.clientWidth
      const p = clamp(range(t, 0.62, 0.98))
      rail.scrollLeft = travel * p
    }
  })

  return (
    <Chapter id="pansofia" labelledBy="pansofia-title">
      <div className={`${shared.stage} ${styles.stage}`}>
        <div className={`${styles.head} ${shared.driven}`} ref={headRef}>
          <TagRow items={['05', 'FROM PROJECTS TO PRODUCTS', role.dates]} />
          <Reveal as="h2" mode="mask" className={styles.title} id="pansofia-title">
            {'Pansofia /\nGrupo Newport'}
          </Reveal>
          <p className={styles.role}>{role.role}</p>
          <p className={shared.lead}>{role.summary}</p>
          <div className={styles.metrics}>
            {role.metrics.map((m) => (
              <MetricBlock key={m.label} value={m.value} label={m.label} size="sm" />
            ))}
          </div>
        </div>

        {/* Fourteen panes fanning out of one. */}
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
            {clientProjects.map((p) => (
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

        <div className={`${shared.corner} ${shared.cornerTR}`}>
          DRAG OR SCROLL
          <br />
          14 SITES · 2025
        </div>
      </div>
    </Chapter>
  )
}
