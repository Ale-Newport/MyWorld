'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useJourney, frame } from '@/state/journey'
import { chapters, timelineYears } from '@/content/chapters'
import { profile } from '@/content/profile'
import { scrollToProgress } from '@/hooks/useLenisScroll'
import { clamp } from '@/lib/math'
import { subscribe } from '@/lib/ticker'
import styles from './Hud.module.css'

/** Persistent chrome: identity, index, sound, progress timeline. */
export function Hud({ onOpenIndex }: { onOpenIndex: () => void }) {
  const soundEnabled = useJourney((s) => s.soundEnabled)
  const toggleSound = useJourney((s) => s.toggleSound)
  const quickView = useJourney((s) => s.quickView)
  const chapter = useJourney((s) => s.chapter)
  const ranges = useJourney((s) => s.ranges)
  const indexOpen = useJourney((s) => s.indexOpen)

  const barRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)
  const pctRef = useRef<HTMLSpanElement>(null)
  const [dragging, setDragging] = useState(false)

  /* Progress is written directly to the DOM every frame — the HUD
     never re-renders on scroll. */
  useEffect(() => {
    let lastPct = -1
    return subscribe(() => {
      const p = frame.progress
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${p})`
      const pct = Math.round(p * 100)
      if (pct !== lastPct) {
        lastPct = pct
        if (pctRef.current) pctRef.current.textContent = String(pct).padStart(2, '0')
      }
    })
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

  const current = chapters.find((c) => c.id === chapter)

  return (
    <div className={styles.hud} data-hidden={indexOpen ? 'true' : 'false'}>
      <header className={styles.top}>
        <a href="#chapter-prelude" className={styles.brand} data-cursor="link" data-cursor-text="TOP">
          <span className={styles.mark} aria-hidden="true">{profile.initials}</span>
          <span className={styles.brandName}>{profile.name}</span>
        </a>

        <div className={styles.topRight}>
          {quickView && <span className={styles.mode}>QUICK VIEW</span>}
          <button
            type="button"
            className={styles.hudBtn}
            onClick={toggleSound}
            aria-pressed={soundEnabled}
            data-cursor="link"
          >
            <span className={styles.soundBars} data-on={soundEnabled} aria-hidden="true">
              <i /><i /><i /><i />
            </span>
            <span className={styles.btnLabel}>{soundEnabled ? 'SOUND ON' : 'SOUND OFF'}</span>
          </button>
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
          <span className={styles.chapterNo}>{current?.number}</span>
          <span className={styles.chapterName}>{current?.title}</span>
        </div>

        <div
          className={styles.timeline}
          ref={barRef}
          role="slider"
          tabIndex={0}
          aria-label="Journey progress. Use arrow keys to move between chapters."
          aria-valuemin={0}
          aria-valuemax={chapters.length - 1}
          aria-valuenow={current?.index ?? 0}
          aria-valuetext={current?.title}
          onPointerDown={(e) => { setDragging(true); seekFromEvent(e.clientX) }}
          onKeyDown={(e) => {
            const i = current?.index ?? 0
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
              e.preventDefault()
              const n = ranges[Math.min(ranges.length - 1, i + 1)]
              if (n) scrollToProgress(n.start + 0.002)
            }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
              e.preventDefault()
              const n = ranges[Math.max(0, i - 1)]
              if (n) scrollToProgress(n.start + 0.002)
            }
          }}
          data-cursor="drag"
          data-cursor-text="DRAG"
        >
          <div className={styles.track} />
          <div className={styles.fill} ref={fillRef} />
          {timelineYears.map((y) => {
            const r = ranges.find((x) => x.id === y.chapter)
            if (!r || r.end <= r.start) return null
            return (
              <button
                key={y.year}
                type="button"
                className={styles.marker}
                style={{ left: `${r.start * 100}%` }}
                onClick={(e) => { e.stopPropagation(); scrollToProgress(r.start + 0.002) }}
                aria-label={`Jump to ${y.year}`}
                data-cursor="link"
              >
                <span className={styles.dot} />
                <span className={styles.year}>{y.year}</span>
              </button>
            )
          })}
          <span className={styles.future} aria-hidden="true">→</span>
        </div>

        <div className={styles.pct}>
          <span ref={pctRef}>00</span>
          <span className={styles.pctSign}>%</span>
        </div>
      </footer>
    </div>
  )
}
