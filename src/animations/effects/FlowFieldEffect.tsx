'use client'

import { useEffect, useRef } from 'react'
import { useCanvas2D } from '@/hooks/useCanvas2D'
import { num, pick, type EffectProps } from '../types'
import { alpha, makeNoise, mulberry32, resolveFx, type FxColors } from './kit'
import s from './effects.module.css'

/** Particles drifting along a slowly changing noise field, leaving fading trails. */
function Field({ params, active, reducedMotion }: EffectProps) {
  const count = Math.round(num(params.count, 900, 50, 4000))
  const flow = num(params.flowSpeed, 1, 0.1, 4)
  const scale = num(params.scale, 2, 0.3, 8)
  const fade = num(params.fade, 0.06, 0.005, 0.4)
  const mode = pick(params.colorMode, ['accent', 'ink', 'mixed'] as const, 'mixed')
  const seed = Math.round(num(params.seed, 11, 1, 9999))
  const st = useRef<{ x: Float32Array; y: Float32Array; age: Float32Array; colors: FxColors | null; still: boolean; noise: (x: number, y: number, z?: number) => number }>({ x: new Float32Array(0), y: new Float32Array(0), age: new Float32Array(0), colors: null, still: false, noise: makeNoise(seed) })
  const ref = useCanvas2D({
    setup: ({ ctx, w, h }) => {
      const r = mulberry32(seed)
      const S = st.current
      S.noise = makeNoise(seed)
      S.x = new Float32Array(count); S.y = new Float32Array(count); S.age = new Float32Array(count)
      for (let i = 0; i < count; i++) { S.x[i] = r() * w; S.y[i] = r() * h; S.age[i] = r() * 200 }
      S.colors = resolveFx(ctx.canvas)
      S.still = false
      ctx.clearRect(0, 0, w, h)
    },
    draw: ({ ctx, w, h, t, dt }) => {
      const S = st.current
      const c = S.colors ?? (S.colors = resolveFx(ctx.canvas))
      const k = scale / Math.max(w, h)
      const angle = (x: number, y: number, z: number) => S.noise(x * k * 3, y * k * 3, z) * Math.PI * 2.2
      if (reducedMotion) {
        if (S.still) return
        ctx.clearRect(0, 0, w, h)
        ctx.lineWidth = 1
        for (let i = 0; i < Math.min(count, 600); i++) {
          let x = S.x[i], y = S.y[i]
          ctx.strokeStyle = alpha(mode === 'ink' || (mode === 'mixed' && i % 3) ? c.ink : c.accent, 0.35)
          ctx.beginPath(); ctx.moveTo(x, y)
          for (let j = 0; j < 30; j++) { const a = angle(x, y, 0.5); x += Math.cos(a) * 2.2; y += Math.sin(a) * 2.2; ctx.lineTo(x, y) }
          ctx.stroke()
        }
        S.still = true
        return
      }
      if (!active) return
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = `rgba(0,0,0,${fade})`
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'source-over'
      ctx.lineWidth = 1.1
      const z = t * 0.06 * flow
      const step = 60 * dt * flow
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = alpha(pass === 0 ? c.ink : c.accent, pass === 0 ? 0.32 : 0.6)
        if (pass === 0 && mode === 'accent') continue
        if (pass === 1 && mode === 'ink') continue
        ctx.beginPath()
        for (let i = pass; i < count; i += mode === 'mixed' ? 2 : 1) {
          const x = S.x[i], y = S.y[i]
          const a = angle(x, y, z)
          const nx = x + Math.cos(a) * step, ny = y + Math.sin(a) * step
          S.age[i] += dt * 60
          if (nx < 0 || ny < 0 || nx > w || ny > h || S.age[i] > 240) { S.x[i] = Math.random() * w; S.y[i] = Math.random() * h; S.age[i] = 0; continue }
          ctx.moveTo(x, y); ctx.lineTo(nx, ny)
          S.x[i] = nx; S.y[i] = ny
        }
        ctx.stroke()
      }
    },
  })
  useEffect(() => { st.current.colors = null; st.current.still = false }, [params.accent, params.ink, mode, reducedMotion, scale, fade, flow])
  return <canvas ref={ref} className={s.fill} aria-hidden="true" />
}

/* The particle set is built once per canvas; a new count or seed starts a fresh one. */
export default function FlowFieldEffect(props: EffectProps) {
  return <Field key={`${Math.round(num(props.params.count, 900, 50, 4000))}-${Math.round(num(props.params.seed, 11, 1, 9999))}`} {...props} />
}
