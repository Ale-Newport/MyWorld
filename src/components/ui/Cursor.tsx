'use client'

import { useEffect, useRef } from 'react'
import { useJourney } from '@/state/journey'
import { damp } from '@/lib/math'
import { IDLE, subscribe } from '@/lib/ticker'
import styles from './Cursor.module.css'

/* How quickly the ring grows or shrinks to the size of what it is over, per second (63 % in 1/GROW s). The ring
   TRAILS the pointer, slowly, by design (see the 13 below); what it is over is the pointer's own answer, so the
   size follows it within about 80 ms to 90 % rather than the 190 ms the trailing rate gave. */
const GROW = 30

/**
 * Custom cursor with magnetic snapping and contextual labels.
 * Elements opt in with `data-cursor="link|drag|explore|view"`
 * and optionally `data-cursor-text`. Disabled entirely on touch
 * devices and under reduced motion, and it never covers the
 * real pointer for native controls.
 */
export function Cursor() {
  const dot = useRef<HTMLDivElement>(null)
  const ring = useRef<HTMLDivElement>(null)
  const label = useRef<HTMLSpanElement>(null)
  const reducedMotion = useJourney((s) => s.reducedMotion)

  useEffect(() => {
    if (reducedMotion) return
    if (window.matchMedia('(pointer: coarse)').matches) return
    const d = dot.current, r = ring.current, l = label.current
    if (!d || !r || !l) return

    document.documentElement.setAttribute('data-cursor', 'custom')

    let tx = window.innerWidth / 2, ty = window.innerHeight / 2
    let dx = tx, dy = ty, rx = tx, ry = ty
    let scale = 1, targetScale = 1
    let magnetX = 0, magnetY = 0
    let current: HTMLElement | null = null
    d.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
    // The ring is at rest where it is, so the loop has nothing to write for it until the pointer moves: put it there now.
    r.style.transform = `translate3d(${rx}px, ${ry}px, 0) scale(1)`
    const onMove = (e: PointerEvent) => {
      tx = e.clientX
      ty = e.clientY
      /* The dot IS the pointer (the native one is hidden), so it is placed by the event itself:
         following it a frame behind through a spring made the pointer feel late, and any dropped
         frame made it stutter. The ring is the part that trails, by design. */
      dx = tx
      dy = ty
      d.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-cursor]') ?? null
      if (el !== current) {
        current = el
        const kind = el?.dataset.cursor ?? 'default'
        const text = el?.dataset.cursorText ?? ''
        r.dataset.kind = kind
        l.textContent = text
        r.dataset.hasText = text ? 'true' : 'false'
        targetScale = kind === 'default' ? 1 : text ? 3.4 : 2.1
      }
      // Magnetism: the ring is pulled toward the centre of small targets.
      if (current && current.dataset.cursor !== 'drag') {
        const b = current.getBoundingClientRect()
        if (b.width < 320 && b.height < 200) {
          magnetX = (b.left + b.width / 2 - tx) * 0.32
          magnetY = (b.top + b.height / 2 - ty) * 0.32
        } else { magnetX = 0; magnetY = 0 }
      } else { magnetX = 0; magnetY = 0 }
    }

    const onDown = () => { r.dataset.down = 'true' }
    const onUp = () => { r.dataset.down = 'false' }
    const onLeave = () => { d.style.opacity = '0'; r.style.opacity = '0' }
    const onEnter = () => { d.style.opacity = '1'; r.style.opacity = '1' }

    // The ring trails the pointer and settles on it; a ring that has arrived costs nothing until the pointer moves.
    const unsubscribe = subscribe((dt) => {
      const gx = tx + magnetX
      const gy = ty + magnetY
      if (rx === gx && ry === gy && scale === targetScale) return IDLE
      rx = damp(rx, gx, 13, dt)
      ry = damp(ry, gy, 13, dt)
      scale = damp(scale, targetScale, GROW, dt)
      // The tail of an exponential approach is smaller than anything a screen can draw.
      if (Math.abs(rx - gx) < 0.02) rx = gx
      if (Math.abs(ry - gy) < 0.02) ry = gy
      if (Math.abs(scale - targetScale) < 0.002) scale = targetScale
      r.style.transform = `translate3d(${rx}px, ${ry}px, 0) scale(${scale})`
    }, 'cursor')

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    document.addEventListener('mouseleave', onLeave)
    document.addEventListener('mouseenter', onEnter)

    return () => {
      unsubscribe()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      document.removeEventListener('mouseleave', onLeave)
      document.removeEventListener('mouseenter', onEnter)
      document.documentElement.removeAttribute('data-cursor')
    }
  }, [reducedMotion])

  if (reducedMotion) return null

  return (
    <div className={styles.host} aria-hidden="true">
      <div ref={dot} className={styles.dot} />
      <div ref={ring} className={styles.ring} data-kind="default" data-down="false">
        <span ref={label} className={styles.label} />
      </div>
    </div>
  )
}
