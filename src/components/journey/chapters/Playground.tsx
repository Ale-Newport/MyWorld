'use client'

import { useEffect, useRef, useState } from 'react'
import { Chapter } from '@/components/journey/Chapter'
import { TagRow } from '@/components/journey/parts'
import { useJourney } from '@/state/journey'
import { scrollToProgress } from '@/hooks/useLenisScroll'
import { projectBySlug } from '@/content/projects'
import type { Installation } from '@/experience/scenes/PlaygroundScene'
import shared from './chapters.module.css'
import styles from './Playground.module.css'

/* ============================================================
   22 – 31%  UNIVERSITY PROJECT PLAYGROUND
   The one game-like chapter. Entirely optional: the page still
   scrolls normally, Quick View removes it, and CONTINUE JOURNEY
   is always visible.
   ============================================================ */

export function Playground() {
  const [near, setNear] = useState<Installation | null>(null)
  const setActiveProject = useJourney((s) => s.setActiveProject)
  const ranges = useJourney((s) => s.ranges)
  const isTouch = useRef(false)
  const stick = useRef<HTMLDivElement>(null)

  useEffect(() => {
    isTouch.current = window.matchMedia('(pointer: coarse)').matches
    const h = (e: Event) => setNear((e as CustomEvent<Installation | null>).detail)
    window.addEventListener('playground:near', h)
    return () => window.removeEventListener('playground:near', h)
  }, [])

  /* Touch joystick — the mobile equivalent of WASD. */
  useEffect(() => {
    const el = stick.current
    if (!el) return
    let active = false
    let cx = 0, cy = 0

    const send = (x: number, y: number) => {
      window.dispatchEvent(new CustomEvent('playground:touch', { detail: { x, y } }))
    }
    const down = (e: PointerEvent) => {
      active = true
      const r = el.getBoundingClientRect()
      cx = r.left + r.width / 2
      cy = r.top + r.height / 2
      el.setPointerCapture(e.pointerId)
      move(e)
    }
    const move = (e: PointerEvent) => {
      if (!active) return
      const dx = Math.max(-1, Math.min(1, (e.clientX - cx) / 48))
      const dy = Math.max(-1, Math.min(1, (e.clientY - cy) / 48))
      send(dx, dy)
      const knob = el.firstElementChild as HTMLElement | null
      if (knob) knob.style.transform = `translate(${dx * 20}px, ${dy * 20}px)`
    }
    const up = () => {
      active = false
      send(0, 0)
      const knob = el.firstElementChild as HTMLElement | null
      if (knob) knob.style.transform = ''
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
  }, [])

  const continueJourney = () => {
    const next = ranges.find((r) => r.id === 'pansofia')
    if (next) scrollToProgress(next.start + 0.002, { duration: 1.1 })
  }

  const project = near ? projectBySlug[near.slug] : undefined

  return (
    <Chapter id="playground" labelledBy="playground-title">
      <div className={`${shared.stage} ${styles.stage}`}>
        <div className={`${shared.corner} ${shared.cornerTL}`}>
          <TagRow items={['04', 'I STARTED BUILDING', '2024']} />
          <h2 id="playground-title" className={styles.title}>Project playground</h2>
        </div>

        <div className={styles.controls} aria-hidden="true">
          <span className={styles.keys}>
            <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>
          </span>
          <span className={styles.controlsLabel}>DRIVE</span>
          <span className={styles.keys}><kbd>E</kbd></span>
          <span className={styles.controlsLabel}>EXPLORE</span>
        </div>

        <div className={styles.stick} ref={stick} aria-hidden="true">
          <span className={styles.knob} />
        </div>

        <div className={styles.card} data-on={Boolean(near)} aria-live="polite">
          {near && (
            <>
              <p className={styles.cardName}>{near.label}</p>
              <p className={styles.cardType}>{near.type}</p>
              <p className={styles.cardStack}>{near.stack}</p>
              <button
                type="button"
                className={styles.explore}
                onClick={() => setActiveProject(near.slug)}
                data-cursor="explore"
                data-cursor-text="OPEN"
              >
                Explore →
              </button>
            </>
          )}
        </div>

        <div className={styles.skipRow}>
          <p className={styles.skipNote}>
            Seven early projects, laid out as installations. Drive between them — or don’t.
          </p>
          <button type="button" className={styles.skip} onClick={continueJourney} data-cursor="link">
            Continue journey →
          </button>
        </div>

        {/* Everything here also exists as plain, reachable content. */}
        <nav className="sr-only" aria-label="Projects in the playground">
          <ul>
            {(['labyrinth', 'three-body-problem', 'cinquillo-fair-variant', 'dots-and-boxes', 'stock-market-simulator', 'minecraft-seeds', 'chess-assistant'] as const).map((slug) => {
              const p = projectBySlug[slug]
              return p ? (
                <li key={slug}>
                  <button type="button" onClick={() => setActiveProject(slug)}>
                    {p.title} — {p.shortDescription}
                  </button>
                </li>
              ) : null
            })}
          </ul>
        </nav>
        <p className="sr-only">{project ? `Nearby: ${project.title}. ${project.shortDescription}` : ''}</p>
      </div>
    </Chapter>
  )
}
