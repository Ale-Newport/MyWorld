'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { useCanvas2D } from '@/hooks/useCanvas2D'
import { readPalette } from '@/components/project-visuals/types'
import { seeded } from '@/lib/math'
import styles from './not-found.module.css'

/* ============================================================
   404 — LOST IN SPACE
   The visitor becomes a small object adrift among the debris
   of the site's own structure. Under reduced motion it is one
   still frame of the same scene.
   ============================================================ */

export default function NotFound() {
  const still = useRef({ reduced: false, drawn: false })
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => { still.current = { reduced: mq.matches, drawn: false } }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  const ref = useCanvas2D<HTMLCanvasElement>({
    pauseWhenHidden: false,
    setup: () => { still.current.drawn = false },
    draw: ({ ctx, w, h, t: clock }) => {
      if (still.current.reduced && still.current.drawn) return
      const t = still.current.reduced ? 6 : clock
      still.current.drawn = true
      const p = readPalette(ctx.canvas)
      ctx.clearRect(0, 0, w, h)

      const rand = seeded(404404)
      const cx = w / 2
      const cy = h / 2

      // Debris field, drifting outward from centre.
      ctx.lineWidth = 1
      for (let i = 0; i < 120; i++) {
        const a = rand() * Math.PI * 2
        const speed = 0.06 + rand() * 0.5
        const seedR = 30 + rand() * 240
        const r = (seedR + t * speed * 60) % (Math.max(w, h) * 0.75)
        const x = cx + Math.cos(a) * r * 1.5
        const y = cy + Math.sin(a) * r
        const s = 1 + rand() * 3.4
        ctx.globalAlpha = Math.max(0, 0.5 - r / (Math.max(w, h) * 0.75) * 0.5)
        ctx.fillStyle = p.inkFaint
        ctx.fillRect(x, y, s, s)
      }
      ctx.globalAlpha = 1

      // The lost object, tumbling.
      const bob = Math.sin(t * 0.9) * 6
      ctx.save()
      ctx.translate(cx, cy + bob)
      ctx.rotate(t * 0.35)
      ctx.strokeStyle = p.ink
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.roundRect(-9, -15, 18, 30, 9)
      ctx.stroke()
      ctx.strokeStyle = p.accent
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.ellipse(0, 0, 20, 7, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()

      // Signal ring, pulsing outward — a distress beacon.
      const pulse = (t % 3) / 3
      ctx.strokeStyle = p.accent
      ctx.globalAlpha = (1 - pulse) * 0.4
      ctx.beginPath()
      ctx.arc(cx, cy + bob, 24 + pulse * 180, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
    },
  })

  return (
    <div className={styles.page}>
      <canvas ref={ref} className={styles.canvas} aria-hidden="true" />
      <div className={styles.content}>
        <p className={styles.code}>404</p>
        <h1 className={styles.title}>Signal lost</h1>
        <p className={styles.body}>
          Nothing at this coordinate. Something drifted somewhere it wasn’t supposed to.
        </p>
        <div className={styles.actions}>
          <Link href="/" className={styles.link} data-cursor="link" data-cursor-text="HOME">
            Return to the journey →
          </Link>
          {/* A 404 should not silently boot a 3D world — but it can
              offer one. The void is a real district out past the edge
              of the map, and this is the only signpost to it. */}
          <Link href="/world" className={styles.link} data-cursor="link" data-cursor-text="DRIVE">
            Enter the void →
          </Link>
        </div>
      </div>
    </div>
  )
}
