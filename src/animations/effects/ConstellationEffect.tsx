'use client'

import { useEffect, useRef } from 'react'
import { useCanvas2D } from '@/hooks/useCanvas2D'
import { num, pick, type EffectProps } from '../types'
import { alpha, mulberry32, resolveFx, type FxColors } from './kit'
import s from './effects.module.css'

interface P { x: number; y: number; vx: number; vy: number }

/** Drifting points joined by lines when close; the pointer pulls them in or pushes them away. */
function Constellation({ params, active, reducedMotion }: EffectProps) {
  const density = num(params.density, 1, 0.1, 4)
  const link = num(params.link, 120, 30, 260)
  const drift = num(params.drift, 1, 0, 4)
  const pointer = pick(params.pointer, ['attract', 'repel', 'none'] as const, 'attract')
  const st = useRef<{ pts: P[]; colors: FxColors | null; mx: number; my: number; still: boolean }>({ pts: [], colors: null, mx: -1e4, my: -1e4, still: false })
  const ref = useCanvas2D({
    setup: ({ ctx, w, h }) => {
      const r = mulberry32(5)
      const n = Math.min(420, Math.round(((w * h) / 9000) * density))
      st.current.pts = Array.from({ length: n }, () => ({ x: r() * w, y: r() * h, vx: (r() - 0.5) * 18, vy: (r() - 0.5) * 18 }))
      st.current.colors = resolveFx(ctx.canvas)
      st.current.still = false
    },
    draw: ({ ctx, w, h, dt }) => {
      const S = st.current
      if (reducedMotion && S.still) return
      if (!active && !reducedMotion) return
      const c = S.colors ?? (S.colors = resolveFx(ctx.canvas))
      ctx.clearRect(0, 0, w, h)
      const cell = link, cols = Math.ceil(w / cell) + 1
      const grid = new Map<number, number[]>()
      S.pts.forEach((p, i) => {
        if (!reducedMotion) {
          const dx = S.mx - p.x, dy = S.my - p.y, d2 = dx * dx + dy * dy
          if (pointer !== 'none' && d2 < 160 * 160) { const f = (pointer === 'attract' ? 1 : -1) * 900 / Math.max(400, d2) * 60; p.vx += (dx / Math.sqrt(d2 + 1)) * f * dt; p.vy += (dy / Math.sqrt(d2 + 1)) * f * dt }
          p.vx *= 1 - 0.6 * dt; p.vy *= 1 - 0.6 * dt
          const sp = Math.hypot(p.vx, p.vy), min = 6 * drift
          if (sp < min && sp > 0) { p.vx *= min / sp; p.vy *= min / sp }
          p.x += p.vx * dt * drift; p.y += p.vy * dt * drift
          if (p.x < 0 || p.x > w) p.vx *= -1
          if (p.y < 0 || p.y > h) p.vy *= -1
          p.x = Math.max(0, Math.min(w, p.x)); p.y = Math.max(0, Math.min(h, p.y))
        }
        const key = Math.floor(p.x / cell) + Math.floor(p.y / cell) * cols
        const list = grid.get(key); if (list) list.push(i); else grid.set(key, [i])
      })
      ctx.lineWidth = 1
      S.pts.forEach((p, i) => {
        const gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell)
        for (let ox = 0; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
          if (ox === 0 && oy < 0) continue
          for (const j of grid.get(gx + ox + (gy + oy) * cols) ?? []) {
            if (j <= i && ox === 0 && oy === 0) continue
            const q = S.pts[j], d = Math.hypot(p.x - q.x, p.y - q.y)
            if (d > link) continue
            ctx.strokeStyle = alpha(c.ink, (1 - d / link) * 0.35)
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke()
          }
        }
      })
      S.pts.forEach((p, i) => { ctx.fillStyle = i % 7 === 0 ? c.accent : alpha(c.ink, 0.7); ctx.beginPath(); ctx.arc(p.x, p.y, i % 7 === 0 ? 2.4 : 1.5, 0, Math.PI * 2); ctx.fill() })
      if (reducedMotion) S.still = true
    },
  })
  useEffect(() => {
    const el = ref.current
    if (!el || pointer === 'none' || reducedMotion) return
    const move = (e: PointerEvent) => { const r = el.getBoundingClientRect(); st.current.mx = e.clientX - r.left; st.current.my = e.clientY - r.top }
    const leave = () => { st.current.mx = -1e4; st.current.my = -1e4 }
    el.addEventListener('pointermove', move); el.addEventListener('pointerleave', leave)
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave) }
  }, [ref, pointer, reducedMotion])
  // Any change redraws the still frame too.
  useEffect(() => { st.current.colors = null; st.current.still = false }, [params.accent, params.ink, reducedMotion, link, drift, pointer])
  return <canvas ref={ref} className={s.fill} aria-hidden="true" />
}

/* The particle set is built once per canvas; a new count or seed starts a fresh one. */
export default function ConstellationEffect(props: EffectProps) {
  return <Constellation key={String(num(props.params.density, 1, 0.1, 4))} {...props} />
}
