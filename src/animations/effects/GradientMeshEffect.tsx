'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useCanvas2D } from '@/hooks/useCanvas2D'
import { color, num, type EffectProps } from '../types'
import { makeNoise, resolveColor, resolveFx } from './kit'
import s from './effects.module.css'

/** Soft colour fields drifting past one another under a film grain. Drawn small and scaled up, so it stays cheap. */
function Mesh({ params, active, reducedMotion }: EffectProps) {
  const blur = num(params.blur, 60, 10, 160)
  const grain = num(params.grain, 0.12, 0, 0.5)
  const st = useRef<{ small: HTMLCanvasElement | null; noise: HTMLCanvasElement | null; colors: string[]; still: boolean }>({ small: null, noise: null, colors: [], still: false })
  const field = useMemo(() => makeNoise(31), [])
  const ref = useCanvas2D({
    maxDpr: 1.5,
    setup: ({ ctx }) => {
      const probe = ctx.canvas.parentElement
      const fx = resolveFx(probe)
      const pick = (k: string, fallback: string) => { const v = color(params[k], ''); return v ? resolveColor(probe, v) : fallback }
      st.current.colors = [pick('c1', fx.accent), pick('c2', '#2f6f5e'), pick('c3', '#e9c46a'), fx.surface === 'rgba(0, 0, 0, 0)' ? '#f4f2ee' : fx.surface]
      st.current.small = document.createElement('canvas')
      const n = document.createElement('canvas'); n.width = n.height = 128
      const nc = n.getContext('2d')!; const img = nc.createImageData(128, 128)
      for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255 }
      nc.putImageData(img, 0, 0)
      st.current.noise = n
      st.current.still = false
    },
    draw: ({ ctx, w, h, t }) => {
      const S = st.current
      if (reducedMotion && S.still) return
      if (!active && !reducedMotion && t > 0.1) return
      const small = S.small!, sw = Math.max(16, Math.round(w / 8)), sh = Math.max(16, Math.round(h / 8))
      if (small.width !== sw || small.height !== sh) { small.width = sw; small.height = sh }
      const sc = small.getContext('2d')!
      const time = reducedMotion ? 3.2 : t * 0.12
      sc.fillStyle = S.colors[3]; sc.fillRect(0, 0, sw, sh)
      S.colors.slice(0, 3).forEach((c, i) => {
        const x = (0.5 + field(i * 3.1, time, 1) * 0.6) * sw, y = (0.5 + field(time, i * 2.7, 2) * 0.6) * sh
        const r = Math.max(sw, sh) * (0.55 + 0.15 * field(i, time * 0.7, 3))
        const g = sc.createRadialGradient(x, y, 0, x, y, r)
        g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)')
        sc.globalAlpha = 0.85; sc.fillStyle = g; sc.fillRect(0, 0, sw, sh)
      })
      sc.globalAlpha = 1
      ctx.clearRect(0, 0, w, h)
      ctx.filter = `blur(${blur / 8}px)`
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(small, -blur / 2, -blur / 2, w + blur, h + blur)
      ctx.filter = 'none'
      if (grain > 0 && S.noise) {
        ctx.globalAlpha = grain; ctx.globalCompositeOperation = 'overlay'
        ctx.fillStyle = ctx.createPattern(S.noise, 'repeat')!; ctx.fillRect(0, 0, w, h)
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
      }
      if (reducedMotion) S.still = true
    },
  })
  useEffect(() => { st.current.still = false }, [reducedMotion, blur, grain])
  return <canvas ref={ref} className={s.fill} aria-hidden="true" />
}

export default function GradientMeshEffect(props: EffectProps) {
  const p = props.params
  return <Mesh key={`${String(p.c1)}|${String(p.c2)}|${String(p.c3)}|${String(p.surface)}|${String(p.accent)}`} {...props} />
}
