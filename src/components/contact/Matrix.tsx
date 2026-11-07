'use client'

import { useEffect, useRef } from 'react'
import styles from './Terminal.module.css'

/* ============================================================
   `matrix` — A FEW SECONDS OF GREEN RAIN
   Drawn over the terminal's screen only, never the page. Any key
   pressed in the terminal, or a click on the rain, stops it (that
   key is swallowed, so it does not end up on the prompt); so does
   the clock. The command never mounts this under reduced motion.
   ============================================================ */

const GLYPHS = '01ABCDEFGHIJKLMNOPQRSTUVWXYZ<>/\\|=+*#$%&@{}[]'
/** Rows drawn per second: the rain's speed, independent of the display's refresh rate. */
const STEPS_PER_SECOND = 18

export function Matrix({ onDone, duration = 9000 }: { onDone: () => void; duration?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const done = useRef(onDone)
  useEffect(() => { done.current = onDone })

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.scale(dpr, dpr)

    const size = 14
    const family = getComputedStyle(canvas).fontFamily
    const columns = Math.ceil(w / size)
    const drops = Array.from({ length: columns }, () => -Math.random() * (h / size))
    const scope = canvas.closest('section')
    let raf = 0
    let last = 0
    let leaving = false
    let alive = true
    const started = performance.now()

    canvas.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 350, easing: 'ease-out', fill: 'forwards' })

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (now - last < 1000 / STEPS_PER_SECOND) return
      last = now
      // The trail: each step lays a translucent dark film over the last.
      ctx.fillStyle = 'rgba(4, 12, 7, 0.18)'
      ctx.fillRect(0, 0, w, h)
      ctx.font = `${size}px ${family}`
      for (let i = 0; i < columns; i++) {
        const y = drops[i] * size
        ctx.fillStyle = Math.random() > 0.94 ? '#e6ffe9' : '#3fdc72'
        ctx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], i * size, y)
        if (y > h && Math.random() > 0.97) drops[i] = 0
        drops[i] += 1
      }
      if (now - started > duration) stop()
    }

    const stop = () => {
      if (leaving) return
      leaving = true
      const fade = canvas.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: 'ease-in', fill: 'forwards' })
      fade.finished.then(() => { if (alive) done.current() }, () => {})
    }
    const onKey = (e: KeyboardEvent) => {
      // Only a key meant for the terminal is swallowed: Tab elsewhere on the page still moves on.
      if (scope?.contains(e.target as Node)) { e.preventDefault(); e.stopPropagation() }
      stop()
    }

    window.addEventListener('keydown', onKey, true)
    canvas.addEventListener('pointerdown', stop)
    raf = requestAnimationFrame(frame)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey, true)
      canvas.removeEventListener('pointerdown', stop)
    }
  }, [duration])

  return <canvas ref={ref} className={styles.matrix} aria-hidden="true" />
}
