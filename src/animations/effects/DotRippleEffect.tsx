'use client'

import { useEffect, useRef } from 'react'
import { useCanvas2D } from '@/hooks/useCanvas2D'
import { num, type EffectProps } from '../types'
import { alpha, resolveFx, type FxColors } from './kit'
import s from './effects.module.css'

interface Ripple { x: number; y: number; t0: number }

/** A field of dots that rings like water where it is touched, and now and then on its own. */
function Ripples({ params, active, reducedMotion }: EffectProps) {
  const spacing = num(params.spacing, 18, 6, 60)
  const size = num(params.dotSize, 1.4, 0.4, 5)
  const speed = num(params.waveSpeed, 420, 50, 1500)
  const decay = num(params.decay, 1.6, 0.3, 6)
  const auto = num(params.auto, 2.5, 0, 20)
  const st = useRef<{ ripples: Ripple[]; colors: FxColors | null; clock: number; nextAuto: number; still: boolean }>({ ripples: [], colors: null, clock: 0, nextAuto: 0.6, still: false })
  const ref = useCanvas2D({
    setup: ({ ctx }) => { st.current.colors = resolveFx(ctx.canvas); st.current.still = false },
    draw: ({ ctx, w, h, t }) => {
      const S = st.current
      if (reducedMotion && S.still) return
      const c = S.colors ?? (S.colors = resolveFx(ctx.canvas))
      S.clock = t
      if (!reducedMotion && active && auto > 0 && t > S.nextAuto) { S.ripples.push({ x: Math.random() * w, y: Math.random() * h, t0: t }); S.nextAuto = t + auto }
      S.ripples = S.ripples.filter((r) => t - r.t0 < decay * 3)
      ctx.clearRect(0, 0, w, h)
      const cols = Math.ceil(w / spacing), rows = Math.ceil(h / spacing)
      const ox = (w - (cols - 1) * spacing) / 2, oy = (h - (rows - 1) * spacing) / 2
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const x = ox + i * spacing, y = oy + j * spacing
        let lift = 0
        for (const r of S.ripples) {
          const age = t - r.t0, d = Math.hypot(x - r.x, y - r.y), front = age * speed
          const band = Math.exp(-((d - front) ** 2) / (2 * (spacing * 1.6) ** 2))
          lift += band * Math.exp(-age / decay)
        }
        const k = Math.min(1, lift)
        ctx.fillStyle = k > 0.05 ? alpha(c.accent, 0.35 + k * 0.65) : alpha(c.ink, 0.22)
        ctx.beginPath(); ctx.arc(x, y - k * spacing * 0.35, size * (1 + k * 1.6), 0, Math.PI * 2); ctx.fill()
      }
      if (reducedMotion) S.still = true
    },
  })
  useEffect(() => {
    const el = ref.current
    if (!el || reducedMotion) return
    let lastMove = 0
    const add = (e: PointerEvent, force: boolean) => {
      const now = performance.now()
      if (!force && now - lastMove < 140) return
      lastMove = now
      const r = el.getBoundingClientRect()
      st.current.ripples.push({ x: e.clientX - r.left, y: e.clientY - r.top, t0: st.current.clock })
      if (st.current.ripples.length > 24) st.current.ripples.shift()
    }
    const down = (e: PointerEvent) => add(e, true), move = (e: PointerEvent) => add(e, false)
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move)
    return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move) }
  }, [ref, reducedMotion])
  useEffect(() => { st.current.colors = null; st.current.still = false }, [params.accent, params.ink, reducedMotion, spacing, size])
  return <canvas ref={ref} className={s.fill} aria-hidden="true" />
}

export default function DotRippleEffect(props: EffectProps) {
  return <Ripples {...props} />
}
