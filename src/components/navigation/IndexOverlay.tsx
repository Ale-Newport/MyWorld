'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { chapters } from '@/content/chapters'
import { profile, contact } from '@/content/profile'
import { useJourney } from '@/state/journey'
import { scrollToProgress } from '@/hooks/useLenisScroll'
import styles from './IndexOverlay.module.css'

/** Full-screen chapter index, plus Quick View and contact shortcuts. */
export function IndexOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ranges = useJourney((s) => s.ranges)
  const chapter = useJourney((s) => s.chapter)
  const quickView = useJourney((s) => s.quickView)
  const setQuickView = useJourney((s) => s.setQuickView)
  const panel = useRef<HTMLDivElement>(null)
  const firstItem = useRef<HTMLButtonElement>(null)

  /* Focus trap + escape. */
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    firstItem.current?.focus()
    document.body.style.overflow = 'hidden'

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return
      const nodes = panel.current?.querySelectorAll<HTMLElement>(
        'button, a[href], [tabindex]:not([tabindex="-1"])',
      )
      if (!nodes?.length) return
      const list = Array.from(nodes)
      const first = list[0]
      const last = list[list.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      prev?.focus()
    }
  }, [open, onClose])

  const go = (id: string) => {
    const r = ranges.find((x) => x.id === id)
    onClose()
    if (r) requestAnimationFrame(() => scrollToProgress(r.start + 0.0015, { duration: 1.1 }))
  }

  return (
    <div
      className={styles.overlay}
      data-open={open}
      role="dialog"
      aria-modal="true"
      aria-label="Chapter index"
      aria-hidden={!open}
      inert={!open}
    >
      <div className={styles.scrim} onClick={onClose} />
      <div className={styles.panel} ref={panel}>
        <header className={styles.head}>
          <div>
            <p className="label">Index</p>
            <p className={styles.headName}>{profile.name}</p>
          </div>
          <button type="button" className={styles.close} onClick={onClose} data-cursor="link" data-cursor-text="CLOSE">
            <span className={styles.closeX} aria-hidden="true"><i /><i /></span>
            <span className="sr-only">Close index</span>
          </button>
        </header>

        <nav className={styles.list} aria-label="Chapters">
          {chapters.map((c, i) => (
              <button
                key={c.id}
                type="button"
                ref={i === 0 ? firstItem : undefined}
                className={styles.item}
                data-current={c.id === chapter}
                onClick={() => go(c.id)}
                data-cursor="link"
              >
                <span className={styles.itemNo}>{c.number}</span>
                <span className={styles.itemTitle}>{c.title}</span>
                <span className={styles.itemLabel}>{c.label}</span>
                {c.year && <span className={styles.itemYear}>{c.year}</span>}
              </button>
          ))}
        </nav>

        <footer className={styles.foot}>
          <div className={styles.modeRow}>
            <button
              type="button"
              className={styles.modeBtn}
              data-on={quickView}
              onClick={() => setQuickView(!quickView)}
              aria-pressed={quickView}
              data-cursor="link"
            >
              <span className={styles.modeDot} />
              <span>Quick View</span>
            </button>
            <p className={styles.modeNote}>
              {quickView
                ? 'Cinematic pauses shortened and the longer scenes trimmed. Everything a recruiter needs, in about 90 seconds.'
                : 'Short on time? Quick View condenses the journey to roughly 90 seconds.'}
            </p>
          </div>

          <Link href="/world" className={styles.worldLink} data-cursor="link" data-cursor-text="DRIVE">
            <span>Enter my world</span>
            <span className={styles.worldLinkNote}>An interactive version · WASD</span>
          </Link>

          <ul className={styles.links}>
            {contact.map((c) => {
              const pending = c.id === 'cv' && c.dataStatus === 'placeholder'
              return (
                <li key={c.id}>
                  {pending ? (
                    <span className={styles.link}>
                      <span>{c.label}</span>
                      <span className={styles.linkValue}>On request</span>
                    </span>
                  ) : (
                    <a
                      href={c.href}
                      className={styles.link}
                      target={c.href.startsWith('http') ? '_blank' : undefined}
                      rel={c.href.startsWith('http') ? 'noreferrer noopener' : undefined}
                      data-cursor="link"
                    >
                      <span>{c.label}</span>
                      <span className={styles.linkValue}>{c.value}</span>
                    </a>
                  )}
                </li>
              )
            })}
          </ul>
        </footer>
      </div>
    </div>
  )
}
