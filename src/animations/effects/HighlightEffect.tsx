'use client'

import { color, num, pick, str, type EffectProps } from '../types'
import { useLiveProgress, clamp01 } from './kit'
import s from './css/highlight.module.css'

/** A highlighter pen sweeping under chosen words — when triggered, or as the page scrolls past. */
export default function HighlightEffect({ params, active, reducedMotion, progress }: EffectProps) {
  const text = str(params.text, 'Ship the boring parts so the interesting ones get the time.', 400)
  const marks = str(params.words, 'boring, interesting', 300).split(',').map((w) => w.trim().toLowerCase()).filter(Boolean)
  const mode = pick(params.mode, ['sweep', 'scroll'] as const, 'sweep')
  // A chosen marker is used as is; the default is the accent, translucent, so the word stays legible.
  const ink = color(params.marker, '') || 'color-mix(in srgb, var(--fx-accent) 34%, transparent)'
  const thickness = num(params.thickness, 0.42, 0.1, 1.2)
  const duration = num(params.duration, 0.8, 0.1, 4)
  const size = num(params.size, 2.6, 1, 8)
  const p = useLiveProgress(progress, mode === 'scroll' && !reducedMotion)
  const words = text.split(/(\s+)/)
  let k = -1
  const total = words.filter((w) => marks.includes(w.replace(/[^\p{L}\p{N}'-]/gu, '').toLowerCase())).length || 1
  return (
    <div className={s.wrap} style={{ fontSize: `clamp(1.1rem, ${size}vw, ${size * 1.5}rem)`, ['--mark' as string]: ink, ['--thick' as string]: `${thickness}em`, ['--dur' as string]: `${duration}s` }}>
      <p className={s.text}>
        {words.map((w, i) => {
          const marked = marks.includes(w.replace(/[^\p{L}\p{N}'-]/gu, '').toLowerCase())
          if (!marked) return <span key={i}>{w}</span>
          k++
          const fill = reducedMotion ? 1 : mode === 'scroll' ? clamp01(p * total * 1.4 - k) : active ? 1 : 0
          return <mark key={i} className={s.mark} data-mode={mode} style={{ ['--fill' as string]: fill, transitionDelay: mode === 'sweep' && active ? `${k * duration * 0.6}s` : '0s' }}>{w}</mark>
        })}
      </p>
    </div>
  )
}
