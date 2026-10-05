'use client'

import { memo, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'
import type { SiteProject, UniverseAnimationProps } from '../types'
import { CATEGORY_LABEL, accentOf, approach, clamp01, hash01, labelOf, smooth, tierOf, toneOf, useBoxSize, useFinePointer, useHot, useTicker, type Tier } from './shared'
import styles from './LayeredField.module.css'

/* ============================================================
   LAYERED FIELD

   The archive as one composed field of cards, centred on the
   headline work: the headline cards hold the middle of the box,
   the featured ones ring them, the archive's smaller cards make
   the outer edge — a field that is sharpest and largest where
   the eye lands, like a photograph's plane of focus.

   Each tier is a depth plane. As the section arrives the planes
   come from different distances — the archive from far behind,
   small and pale, the headline cards from close in front, large
   — and as the scroll goes on they close on one another until
   they lie in register as the composed field. Near the end of
   the section they part again, a little, as it leaves. On a
   mouse or trackpad the planes shift a few pixels against one
   another with the pointer, nearest most.

   Reduced motion shows the field composed and still.

   Intensity: how far apart the planes start (the depth of the
   parallax). Speed: the pointer parallax's response.
   ============================================================ */

interface Card {
  p: SiteProject
  tier: Tier
  /** Centre and size in the composed field, box pixels. */
  x: number
  y: number
  w: number
  h: number
  /** 0 far … 1 near. */
  depth: number
  /** Arrival stagger, 0..1. */
  lag: number
}

interface Field {
  cards: Card[]
  cell: { w: number; h: number }
  small: boolean
}

/** How much of its cell a card fills, across and down: the archive's cards are low, like tags. */
const FILL = [
  [0.94, 0.94],
  [0.8, 0.78],
  [0.72, 0.54],
]
const FILL_SMALL = [
  [0.95, 0.92],
  [0.9, 0.82],
  [0.86, 0.72],
]

function compose(projects: SiteProject[], w: number, h: number): Field | null {
  const n = projects.length
  if (!n || w < 40 || h < 40) return null
  const small = w < 560 || h < 300
  const pad = small ? 4 : 10
  // Cells wider than tall: names need width, and on a phone more of it.
  const aspect = small ? 2.5 : 1.55
  let rows = Math.max(1, Math.round(Math.sqrt((n * (h - pad * 2) * aspect) / (w - pad * 2))))
  let cols = Math.ceil(n / rows)
  // A single row or column reads as a list, not a field: square it up a little.
  if (rows === 1 && n > 3) {
    rows = 2
    cols = Math.ceil(n / 2)
  }
  // A few projects make a few cards, not a few giant ones: cells stop growing, and the field is centred.
  const cw = Math.min(260, (w - pad * 2) / cols)
  const ch = Math.min(170, (h - pad * 2) / rows)
  const cx = w / 2
  const cy = h / 2
  const ox = cx - (cols * cw) / 2
  const oy = cy - (rows * ch) / 2
  // Cells nearest the middle of the box first (measured in the box's own proportions).
  const cells: { x: number; y: number; d: number }[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = ox + (c + 0.5) * cw
      const y = oy + (r + 0.5) * ch
      cells.push({ x, y, d: Math.hypot((x - cx) / w, ((y - cy) / h) * 0.82) + c * 1e-6 + r * 1e-7 })
    }
  }
  cells.sort((a, b) => a.d - b.d)
  const ordered = projects.map((p, i) => ({ p, i, t: tierOf(p) })).sort((a, b) => a.t - b.t || a.i - b.i)
  const cards = ordered.map(({ p, t }, k) => {
    const cell = cells[k]
    const [fx, fy] = (small ? FILL_SMALL : FILL)[t]
    return {
      p,
      tier: t,
      x: cell.x,
      y: cell.y,
      w: cw * fx,
      h: ch * fy,
      depth: [1, 0.55, 0.18][t] + (hash01(p.id, 7) - 0.5) * 0.14,
      lag: hash01(p.id, 8) * 0.35 + cell.d * 0.25,
    }
  })
  return { cards, cell: { w: cw, h: ch }, small }
}

function LayeredField({ projects, visible, progress, active, reducedMotion, intensity, speed, onOpen, onHover }: UniverseAnimationProps) {
  const root = useRef<HTMLDivElement>(null)
  const { w, h } = useBoxSize(root)
  const fine = useFinePointer()
  const model = useMemo(() => (w > 0 && h > 0 ? compose(projects, w, h) : null), [projects, w, h])
  const { hot, bind } = useHot(onHover)

  const els = useRef<(HTMLButtonElement | null)[]>([])
  const sim = useRef({ px: 0, py: 0, tx: 0, ty: 0, rect: null as DOMRect | null, stamp: '' })

  /** The planes for the current scroll and pointer: apart while arriving and leaving, in register between. */
  const place = (dt: number, still: boolean) => {
    if (!model) return
    const s = sim.current
    const t = still ? 0.5 : progress.current
    s.px = still ? 0 : approach(s.px, s.tx, 5 * speed, dt)
    s.py = still ? 0 : approach(s.py, s.ty, 5 * speed, dt)
    const stamp = `${t.toFixed(4)}|${s.px.toFixed(3)}|${s.py.toFixed(3)}|${w}x${h}`
    if (stamp === s.stamp) return
    s.stamp = stamp
    const depthGap = 0.35 + 0.65 * intensity
    const leave = smooth(0.8, 1.06, t)
    const cx = w / 2
    const cy = h / 2
    const amp = Math.min(12, w * 0.008)
    model.cards.forEach((c, i) => {
      const el = els.current[i]
      if (!el) return
      // Each card closes on the field in its own time: the nearest plane last.
      const come = still ? 1 : smooth(-0.06 + c.lag * 0.16, 0.24 + c.lag * 0.16, t)
      const apart = (1 - come) + leave * 0.3
      const scale = 1 + (c.depth - 0.42) * apart * 1.3 * depthGap
      const rise = ((1 - come) * 70 - leave * 46) * c.depth * depthGap
      const x = cx + (c.x - cx) * scale + s.px * amp * c.depth
      const y = cy + (c.y - cy) * scale + rise + s.py * amp * c.depth * 0.7
      const alpha = still ? 1 : clamp01(come * 1.6 - 0.15) * (1 - leave * (1 - c.depth) * 0.5)
      el.style.transform = `translate3d(${(x - c.w / 2).toFixed(2)}px, ${(y - c.h / 2).toFixed(2)}px, 0) scale(${scale.toFixed(4)})`
      el.style.opacity = alpha.toFixed(3)
    })
  }

  useLayoutEffect(() => {
    sim.current.stamp = ''
    place(0, reducedMotion)
  })

  useTicker(active && !reducedMotion && !!model, (dt) => place(dt, false))

  useEffect(() => {
    const el = root.current
    if (!el || !fine || reducedMotion) return
    const s = sim.current
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      if (!s.rect) s.rect = el.getBoundingClientRect()
      s.tx = clamp01((e.clientX - s.rect.left) / s.rect.width) * 2 - 1
      s.ty = clamp01((e.clientY - s.rect.top) / s.rect.height) * 2 - 1
    }
    const leave = () => {
      s.tx = 0
      s.ty = 0
      s.rect = null
    }
    const scrolled = () => {
      s.rect = null
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    window.addEventListener('scroll', scrolled, { passive: true })
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
      window.removeEventListener('scroll', scrolled)
    }
  }, [fine, reducedMotion])

  return (
    <div ref={root} className={styles.root} role="group" aria-label="Project archive" data-small={model?.small || undefined}>
      {model?.cards.map((c, i) => {
        const dim = !visible.has(c.p.id)
        const roomy = c.w >= 96 && c.h >= 52
        const shown = roomy ? c.p.title : (c.p.shortTitle ?? c.p.title)
        return (
          <button
            key={c.p.id}
            ref={(el) => {
              els.current[i] = el
            }}
            type="button"
            className={styles.card}
            data-tier={c.tier}
            data-dim={dim || undefined}
            data-hot={hot === c.p.slug || undefined}
            data-roomy={roomy || undefined}
            data-low={(roomy && c.tier === 0 && c.h < 76) || undefined}
            data-two={(!roomy && c.h >= 38) || undefined}
            aria-hidden={dim || undefined}
            tabIndex={dim ? -1 : 0}
            aria-label={labelOf(c.p, shown)}
            data-cursor="view"
            onClick={() => onOpen(c.p.slug)}
            style={{ width: c.w, height: c.h, zIndex: 4 - c.tier, '--tone': toneOf(c.p), '--accent-p': accentOf(c.p), '--cw': `${c.w.toFixed(1)}px` } as CSSProperties}
            {...bind(c.p.slug)}
          >
            <span className={styles.face}>
              <span className={styles.head}>
                <span className={styles.mark} />
                {roomy && c.w >= 150 && <span className={styles.cat}>{CATEGORY_LABEL[c.p.category] ?? c.p.category}</span>}
                <span className={styles.year}>{c.p.year}</span>
              </span>
              <span className={styles.title}>{shown}</span>
              {c.tier === 0 && roomy && c.h >= 110 && c.p.shortDescription && <span className={styles.desc}>{c.p.shortDescription}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export default memo(LayeredField)
