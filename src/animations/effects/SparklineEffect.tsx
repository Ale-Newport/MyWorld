'use client'

import { useEffect, useRef, useState } from 'react'
import { bool, num, str, type EffectProps } from '../types'
import { parseNumbers } from './kit'
import s from './css/sparkline.module.css'

const PAD = 8

/** A line chart that draws itself from a list of numbers, ending on a marked last value. */
export default function SparklineEffect({ params, active, reducedMotion }: EffectProps) {
  const raw = parseNumbers(str(params.values, '3, 5, 4, 8, 6, 9, 12, 10, 14, 13, 17', 2000))
  const values = raw.length >= 2 ? raw : [0, 1]
  const smooth = bool(params.smooth, true)
  const area = bool(params.area, true)
  const label = str(params.label, 'Example series', 80)
  const duration = num(params.duration, 1.8, 0.1, 10)
  /* Drawn in the plot's own pixels: no scaling, so the dash that draws the line measures true. */
  const plot = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 300, h: 120 })
  useEffect(() => {
    const el = plot.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setBox({ w: Math.max(40, e.contentRect.width), h: Math.max(30, e.contentRect.height) }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const { w: W, h: H } = box
  const min = Math.min(...values), max = Math.max(...values)
  const pts = values.map((v, i) => [PAD + (i / (values.length - 1)) * (W - PAD * 2), H - PAD - ((v - min) / (max - min || 1)) * (H - PAD * 2)] as const)
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 1; i < pts.length; i++) {
    if (!smooth) { d += ` L${pts[i][0]},${pts[i][1]}`; continue }
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]
    const [xp, yp] = pts[i - 2] ?? pts[i - 1], [xn, yn] = pts[i + 1] ?? pts[i]
    d += ` C${x0 + (x1 - xp) / 6},${y0 + (y1 - yp) / 6} ${x1 - (xn - x0) / 6},${y1 - (yn - y0) / 6} ${x1},${y1}`
  }
  const last = pts[pts.length - 1]
  const drawn = reducedMotion || active
  return (
    <figure className={s.wrap} style={{ ['--dur' as string]: reducedMotion ? '0s' : `${duration}s` }} data-on={drawn || undefined}>
      <div ref={plot} className={s.plot}>
        <svg viewBox={`0 0 ${W} ${H}`} className={s.svg} role="img" aria-label={`${label}: from ${values[0]} to ${values[values.length - 1]}, ${values.length} points`}>
          {area && <path d={`${d} L${last[0]},${H} L${pts[0][0]},${H} Z`} className={s.area} />}
          <path d={d} className={s.line} pathLength={1} />
        </svg>
        <span className={s.dot} style={{ left: last[0], top: last[1] }} aria-hidden="true" />
      </div>
      <figcaption className={s.caption}><span>{label}</span><b>{values[values.length - 1].toLocaleString('en-GB')}</b></figcaption>
    </figure>
  )
}
