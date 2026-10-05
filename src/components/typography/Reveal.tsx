'use client'

import { Fragment, useEffect, useMemo, useRef } from 'react'
import { useJourney } from '@/state/journey'
import styles from './typography.module.css'

type RevealMode = 'mask' | 'chars' | 'words' | 'scramble' | 'perspective' | 'clip'

interface RevealProps {
  children: string
  as?: 'h1' | 'h2' | 'h3' | 'p' | 'span' | 'div'
  mode?: RevealMode
  className?: string
  /** Seconds of stagger between units. */
  stagger?: number
  delay?: number
  /** Reveal on scroll into view (default) or immediately. */
  immediate?: boolean
  id?: string
  /** Extra attributes for the host element (the editor's data-cms-* markers). */
  attrs?: Record<string, string>
}

const SCRAMBLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/\\<>[]{}*#%'

/**
 * Text reveal with six distinct behaviours, so no two headings
 * on the site animate the same way. All of them degrade to a
 * plain visible string under prefers-reduced-motion, and the
 * text is always present in the DOM for assistive tech.
 */
export function Reveal({
  children, as: Tag = 'span', mode = 'mask', className, stagger = 0.028, delay = 0, immediate, id, attrs,
}: RevealProps) {
  const host = useRef<HTMLElement>(null)
  const reducedMotion = useJourney((s) => s.reducedMotion)

  const units = useMemo(() => {
    if (mode === 'chars' || mode === 'scramble') return children.split('')
    if (mode === 'words' || mode === 'perspective') return children.split(/(\s+)/)
    return children.split('\n')
  }, [children, mode])

  useEffect(() => {
    const el = host.current
    if (!el || reducedMotion) return
    el.setAttribute('data-state', 'hidden')

    const run = () => {
      el.setAttribute('data-state', 'shown')
      if (mode !== 'scramble') return
      // Scramble: settle each character through noise into place.
      const spans = Array.from(el.querySelectorAll<HTMLElement>('[data-unit]'))
      const finals = spans.map((s) => s.dataset.final ?? '')
      let f = 0
      const total = 26 + spans.length * 1.4
      const id = window.setInterval(() => {
        f++
        spans.forEach((s, i) => {
          const settleAt = 10 + i * 1.4
          if (f > settleAt) { s.textContent = finals[i]; return }
          if (finals[i].trim() === '') return
          s.textContent = SCRAMBLE[Math.floor(((f * 31 + i * 17) % SCRAMBLE.length))]
        })
        if (f > total) window.clearInterval(id)
      }, 26)
    }

    if (immediate) {
      const t = window.setTimeout(run, delay * 1000)
      return () => window.clearTimeout(t)
    }

    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) { window.setTimeout(run, delay * 1000); io.disconnect() }
      },
      { threshold: 0.12, rootMargin: '-6% 0px -12% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [mode, delay, immediate, reducedMotion])

  if (reducedMotion) {
    return <Tag id={id} className={className} {...attrs}>{children}</Tag>
  }

  const byWord = mode === 'words' || mode === 'perspective'

  return (
    <Tag
      id={id}
      {...attrs}
      ref={host as React.Ref<never>}
      className={`${styles.reveal} ${className ?? ''}`}
      data-mode={mode}
      data-state="hidden"
    >
      {units.map((u, i) => {
        /* Between words the space stays a space, so a line that wraps
           does not start on one, and a written line break breaks the
           line — boxed as a unit, it did neither. */
        if (byWord && /^\s+$/.test(u)) {
          return <Fragment key={i}>{u.includes('\n') ? <br /> : ' '}</Fragment>
        }
        // The animated units are presentation (scrambling shows random glyphs); assistive tech reads the copy below.
        return (
        <span className={styles.unitWrap} key={i} aria-hidden="true">
          <span
            className={styles.unit}
            data-unit=""
            data-final={u}
            style={{ transitionDelay: `${i * stagger}s`, animationDelay: `${i * stagger}s` }}
          >
            {u === ' ' ? ' ' : u}
          </span>
        </span>
        )
      })}
      <span className="sr-only">{children}</span>
    </Tag>
  )
}
