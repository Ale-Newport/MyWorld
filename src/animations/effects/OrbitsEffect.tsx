'use client'

import { useEffect, useRef } from 'react'
import { useCanvas2D } from '@/hooks/useCanvas2D'
import { bool, num, type EffectProps } from '../types'
import { alpha, resolveFx, type FxColors } from './kit'
import s from './effects.module.css'

/** Bodies on tilted concentric orbits, inner ones faster (Kepler's third law), passing behind and in front of a centre. */
export default function OrbitsEffect({ params, active, reducedMotion }: EffectProps) {
  const rings = Math.round(num(params.rings, 4, 1, 8))
  const bodies = Math.round(num(params.bodies, 3, 1, 12))
  const speed = num(params.orbitSpeed, 1, 0.05, 4)
  const tilt = (num(params.tilt, 62, 0, 85) * Math.PI) / 180
  const trails = bool(params.trails, true)
  const colors = useRef<FxColors | null>(null)
  const still = useRef(false)
  const ref = useCanvas2D({
    setup: ({ ctx }) => { colors.current = resolveFx(ctx.canvas); still.current = false },
    draw: ({ ctx, w, h, t }) => {
      if (reducedMotion && still.current) return
      if (!active && !reducedMotion && t > 0.1) return
      const c = colors.current ?? resolveFx(ctx.canvas)
      const time = reducedMotion ? 7.3 : t
      ctx.clearRect(0, 0, w, h)
      const cx = w / 2, cy = h / 2, R = Math.min(w, h / Math.max(0.25, Math.cos(tilt))) * 0.46
      const sy = Math.cos(tilt)
      const items: { x: number; y: number; z: number; r: number; ring: number }[] = []
      for (let i = 1; i <= rings; i++) {
        const r = (R * i) / rings
        ctx.strokeStyle = alpha(c.ink, 0.12)
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.ellipse(cx, cy, r, r * sy, 0, 0, Math.PI * 2); ctx.stroke()
        const w0 = (speed * 1.2) / Math.pow(i / rings + 0.2, 1.5)
        for (let b = 0; b < bodies; b++) {
          const a = time * w0 * 0.35 + (b / bodies) * Math.PI * 2 + i * 1.3
          items.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * sy, z: Math.sin(a), r: 2.2 + (rings - i) * 0.5, ring: i })
          if (trails && !reducedMotion) {
            ctx.strokeStyle = alpha(i === 1 ? c.accent : c.ink, 0.35)
            ctx.lineWidth = 1.4
            ctx.beginPath(); ctx.ellipse(cx, cy, r, r * sy, 0, a - 0.5, a); ctx.stroke()
          }
        }
      }
      const drawBody = (o: (typeof items)[number]) => {
        const k = 0.75 + o.z * 0.25
        ctx.fillStyle = o.ring === 1 ? c.accent : alpha(c.ink, 0.55 + o.z * 0.35)
        ctx.beginPath(); ctx.arc(o.x, o.y, o.r * k, 0, Math.PI * 2); ctx.fill()
      }
      items.filter((o) => o.z < 0).forEach(drawBody)
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.16)
      g.addColorStop(0, c.accent); g.addColorStop(1, alpha(c.accent, 0))
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 0.16, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = c.accent; ctx.beginPath(); ctx.arc(cx, cy, Math.max(3, R * 0.045), 0, Math.PI * 2); ctx.fill()
      items.filter((o) => o.z >= 0).forEach(drawBody)
      if (reducedMotion) still.current = true
    },
  })
  useEffect(() => { colors.current = null; still.current = false }, [params.accent, params.ink, rings, bodies, tilt, trails, reducedMotion])
  return <canvas ref={ref} className={s.fill} role="img" aria-label={`${rings} orbits with ${bodies} bodies each`} />
}
