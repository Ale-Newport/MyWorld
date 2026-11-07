'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useJourney, frame } from '@/state/journey'
import { useActiveChapter, useJourneyRoute } from '@/components/journey/JourneyProvider'
import { useSite } from '@/cms/context'
import { scrollToProgress } from '@/hooks/useLenisScroll'
import { clamp } from '@/lib/math'
import { IDLE, subscribe } from '@/lib/ticker'
import { SiteNav } from './SiteNav'
import { ThemeToggle } from '@/components/site/ThemeToggle'
import styles from './Hud.module.css'

/** Persistent chrome: identity, the pages (a desktop's top bar, a phone's index), sound, scrub. */
export function Hud({ onOpenIndex }: { onOpenIndex: () => void }) {
  const soundEnabled = useJourney((s) => s.soundEnabled)
  const toggleSound = useJourney((s) => s.toggleSound)
  const indexOpen = useJourney((s) => s.indexOpen)
  /* The route, not the store. This chrome is the first thing the
     HTML says about which story the visitor has opened, and it has
     to be right in the markup the server sends. */
  const { id: journeyId, chapters, ranges } = useJourneyRoute()
  const { profile } = useSite()
  const current = useActiveChapter()
  const widestTitle = chapters.reduce((w, c) => (c.title.length > w.length ? c.title : w), '')
  const router = useRouter()

  const barRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const pctRef = useRef<HTMLSpanElement>(null)
  const [dragging, setDragging] = useState(false)

  /* Progress is written directly to the DOM as it moves — the HUD
     never re-renders on scroll, and a page standing still writes nothing. */
  useEffect(() => {
    let lastP = -1
    let lastPct = -1
    return subscribe(() => {
      const p = frame.progress
      if (p === lastP) return IDLE
      lastP = p
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${p})`
      const pct = Math.round(p * 100)
      if (pct !== lastPct) {
        lastPct = pct
        if (pctRef.current) pctRef.current.textContent = String(pct).padStart(2, '0')
      }
    }, 'hud')
  }, [])

  const seekFromEvent = useCallback((clientX: number) => {
    const el = barRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    scrollToProgress(clamp((clientX - r.left) / r.width), { duration: 0.8 })
  }, [])

  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) => seekFromEvent(e.clientX)
    const up = () => setDragging(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [dragging, seekFromEvent])

  /* Position within the MOUNTED journey. `ranges` is the only
     honest source for it: the chapter's own index belongs to its
     journey, and the slider is measuring this one. */
  const position = Math.max(0, ranges.findIndex((r) => r.id === current.id))

  const home = journeyId === 'home'

  return (
    <div className={styles.hud} data-hud="" data-journey={journeyId} data-hidden={indexOpen ? 'true' : 'false'}>
      <header className={styles.top}>
        {/* The mark and the name are the way home (the pages list has no Home): on the homepage, its top. */}
        {home ? (
          <a href={`#chapter-${chapters[0].id}`} className={styles.brand} data-cursor="link" data-cursor-text="TOP">
            <span className={styles.mark} aria-hidden="true">{profile.initials}</span>
            <span className={styles.brandName}>{profile.name}</span>
          </a>
        ) : (
          <Link href="/" prefetch={false} onPointerEnter={() => router.prefetch('/')} className={styles.brand} aria-label={`${profile.name} — home`} data-cursor="link" data-cursor-text="HOME">
            <span className={styles.mark} aria-hidden="true">{profile.initials}</span>
            <span className={styles.brandName}>{profile.name}</span>
          </Link>
        )}

        <div className={styles.topRight}>
          {/* A desktop names every page here and keeps sound and the theme beside them; a phone has only the
              mark and INDEX, and the index holds the pages, sound and the theme. */}
          <SiteNav current={journeyId} className={styles.pages} />

          <button
            type="button"
            className={`${styles.hudBtn} ${styles.soundBtn}`}
            onClick={toggleSound}
            aria-pressed={soundEnabled}
            data-cursor="link"
          >
            <span className={styles.soundBars} data-on={soundEnabled} aria-hidden="true">
              <i /><i /><i /><i />
            </span>
            <span className={styles.btnLabel}>{soundEnabled ? 'SOUND ON' : 'SOUND OFF'}</span>
          </button>
          <ThemeToggle className={`${styles.hudBtn} ${styles.themeBtn}`} labelClassName={styles.btnLabel} />
          <button
            type="button"
            className={`${styles.hudBtn} ${styles.indexBtn}`}
            onClick={onOpenIndex}
            data-cursor="link"
          >
            <span className={styles.indexLines} aria-hidden="true"><i /><i /><i /></span>
            <span className={styles.btnLabel}>INDEX</span>
          </button>
        </div>
      </header>

      <footer className={styles.bottom}>
        <div className={styles.chapterTag}>
          <span className={styles.chapterNo}>{current.number}</span>
          {/* The home room keeps this label's ground clear for its
              longest title, not just the one it shows now — and the
              column is as wide as that title too (the unseen copy under
              it), so no chapter's name is ever cut to an ellipsis. */}
          <span className={styles.chapterStack}>
            <span className={styles.chapterName} data-room-reserve-text={widestTitle}>{current.title}</span>
            <span className={styles.chapterGhost} aria-hidden="true" data-room-ignore="">{widestTitle}</span>
          </span>
        </div>

        {/* ============================================================
            THE SCRUB
            This was a timeline, with year markers and an arrow into
            the future. The journeys are ordered thematically now, so
            a chronology drawn under them was a claim the page no
            longer makes. What survives is the control: drag it,
            arrow-key it, read the percentage off it.
            ============================================================ */}
        <div
          className={styles.scrub}
          ref={barRef}
          role="slider"
          tabIndex={0}
          aria-label="Journey progress. Use arrow keys to move between chapters."
          aria-valuemin={0}
          aria-valuemax={Math.max(0, ranges.length - 1)}
          aria-valuenow={position}
          aria-valuetext={current.title}
          onPointerDown={(e) => { setDragging(true); seekFromEvent(e.clientX) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
              e.preventDefault()
              const n = ranges[Math.min(ranges.length - 1, position + 1)]
              if (n) scrollToProgress(n.start + 0.002)
            }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
              e.preventDefault()
              const n = ranges[Math.max(0, position - 1)]
              if (n) scrollToProgress(n.start + 0.002)
            }
          }}
          data-cursor="drag"
          data-cursor-text="DRAG"
        >
          <div className={styles.track} />
          <div className={styles.fill} ref={fillRef} />
        </div>

        <div className={styles.pct}>
          <span ref={pctRef}>00</span>
          <span className={styles.pctSign}>%</span>
        </div>
      </footer>
    </div>
  )
}
