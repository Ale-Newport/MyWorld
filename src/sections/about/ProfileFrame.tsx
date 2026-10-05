'use client'

import { useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'
import type { SiteContent } from '@/cms/derive'
import { clamp, lerp, range } from '@/lib/math'
import { frame as pointer } from '@/state/journey'
import type { SectionAnimationProps } from '../types'
import { expo, present, smooth, textWidth, useBoxSize, useFinePointer, useTicker, type Size } from './shared'
import styles from './ProfileFrame.module.css'

/* ============================================================
   LAYERED PROFILE FRAME

   There is no portrait on this site, and this option does not
   pretend there is one. The initials are the picture: set solid
   at the back of a stack of nested paper mats, and again in
   outline on the front plane. Each mat carries one fact of the
   profile on its edge — the name, where he lives, where he is
   from, what he does, what he builds.

   Scrolling opens the stack in depth: the mats separate, step
   off-centre and the whole frame turns a few degrees, so the two
   sets of initials part and the facts fan out layer by layer. On
   a mouse the frame leans quietly toward the pointer. Intensity
   sets how deep the frames open; speed, the slow drift once open.
   ============================================================ */

interface Mat {
  key: string
  x: number
  y: number
  w: number
  h: number
  caption: string
  corner: 'tl' | 'tr' | 'bl' | 'br'
}

interface Layout {
  w: number
  h: number
  mats: Mat[]
  /** The innermost window, where the initials sit. */
  win: { x: number; y: number; w: number; h: number }
  initials: string
  type: number
  band: number
  step: number
  depth: number
  /** How far each mat steps off-centre as the stack opens (intensity). */
  spread: number
  caption: number
}

/** The facts the mats carry, outermost first: real profile fields only. */
function facts(site: SiteContent): string[] {
  const p = site.profile
  const roles = present(p.roles)
  return present([p.name, p.location, p.origin, roles[0] ?? '', p.thesis, roles[1] ?? ''])
}

function compose(size: Size, site: SiteContent, intensity: number): Layout | null {
  const { w, h } = size
  if (w < 80 || h < 80) return null
  const initials = (site.profile.initials || '').trim() || present(site.profile.name.split(/\s+/)).map((s) => s[0]).join('').slice(0, 3)
  const pad = clamp(Math.min(w, h) * 0.11, 12, 80)
  const maxW = w - pad * 2
  const maxH = h - pad * 2
  // A frame, not a strip: its proportions stay between a portrait and a landscape print.
  const aspect = clamp(maxW / maxH, 0.74, 1.5)
  let fw = maxW
  let fh = fw / aspect
  if (fh > maxH) {
    fh = maxH
    fw = fh * aspect
  }
  const m = Math.min(fw, fh)
  const all = facts(site)
  const count = clamp(m >= 420 ? 5 : m >= 250 ? 4 : m >= 150 ? 3 : 2, 2, Math.max(2, all.length))
  const caption = m >= 300 ? 10.5 : 9.5
  const band = clamp(m * 0.032, 5, 16)
  const step = (m * 0.25) / Math.max(1, count - 1)
  const x0 = (w - fw) / 2
  const y0 = (h - fh) / 2
  const corners: Mat['corner'][] = ['tl', 'br', 'bl', 'tr', 'tl', 'br']
  const mats: Mat[] = Array.from({ length: count }, (_, i) => ({
    key: `m${i}`,
    x: x0 + i * step,
    y: y0 + i * step,
    w: fw - i * step * 2,
    h: fh - i * step * 2,
    caption: all[i] ?? '',
    corner: corners[i % corners.length],
  }))
  /* A fact too long for its mat trades places with a shorter one further out. */
  const capW = (t: string) => textWidth(t.toUpperCase(), caption, { mono: true, tracking: 0.18 })
  for (let i = mats.length - 1; i > 0; i--) {
    if (capW(mats[i].caption) <= mats[i].w - 12) continue
    for (let j = i - 1; j >= 0; j--) {
      if (capW(mats[j].caption) <= mats[i].w - 12 && capW(mats[i].caption) <= mats[j].w - 12) {
        ;[mats[i].caption, mats[j].caption] = [mats[j].caption, mats[i].caption]
        break
      }
    }
  }
  const inner = mats[mats.length - 1]
  const win = { x: inner.x + band, y: inner.y + band, w: inner.w - band * 2, h: inner.h - band * 2 }
  const at100 = Math.max(1, textWidth(initials, 100, { weight: 500, tracking: -0.04 }))
  const type = Math.max(12, Math.min((win.w * 0.8 * 100) / at100, win.h * 0.72))
  const depth = lerp(8, 46, clamp(intensity)) * clamp(m / 480, 0.5, 1.25)
  const spread = lerp(0.45, 1.35, clamp(intensity))
  return { w, h, mats, win, initials, type, band, step, depth, spread, caption }
}

interface Els {
  stage: HTMLDivElement | null
  mats: (HTMLDivElement | null)[]
  solid: HTMLDivElement | null
  outline: HTMLDivElement | null
}

/** One moment of the frame: `p` progress, `t` the drift clock, `px/py` the pointer lean (−1…1). */
function render(L: Layout, els: Els, p: number, t: number, px: number, py: number) {
  const open = smooth(range(p, 0.1, 0.6))
  const n = L.mats.length
  if (els.stage) {
    const ry = -10 * open + Math.sin(t * 0.35) * 1.2 * open + px * 5 * open
    // The side under the pointer recedes a little, on both axes (pointer y is +1 at the top).
    const rx = 6 * open + Math.cos(t * 0.27) * 0.8 * open + py * 4 * open
    els.stage.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`
  }
  L.mats.forEach((_, i) => {
    const el = els.mats[i]
    if (!el) return
    const a = expo(range(p, 0.02 + i * 0.04, 0.2 + i * 0.04))
    const z = -i * L.depth * open
    // Offset as they open: each mat steps a little up and to the right of the one in front.
    const dx = i * L.step * 0.14 * L.spread * open
    const dy = -i * L.step * 0.1 * L.spread * open
    // …and turns a degree or so, as a stack of real mats would never sit square.
    const rz = (i % 2 ? 1 : -1) * Math.min(i, 2) * 0.7 * open
    el.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, ${z.toFixed(1)}px) rotateZ(${rz.toFixed(2)}deg)`
    el.style.opacity = a.toFixed(3)
    el.style.setProperty('--cap', expo(range(open, 0.15 + (i / n) * 0.55, 0.45 + (i / n) * 0.55)).toFixed(3))
  })
  const back = -(n - 1) * L.depth * open
  if (els.solid) {
    const a = expo(range(p, 0.24, 0.5))
    els.solid.style.transform = `translate3d(${((n - 1) * L.step * 0.14 * L.spread * open).toFixed(1)}px, ${(-(n - 1) * L.step * 0.1 * L.spread * open + (1 - a) * 18).toFixed(1)}px, ${back.toFixed(1)}px)`
    els.solid.style.opacity = a.toFixed(3)
  }
  if (els.outline) {
    const a = expo(range(p, 0.34, 0.6))
    els.outline.style.transform = `translate3d(0, 0, ${(L.depth * 0.5 * open).toFixed(1)}px)`
    els.outline.style.opacity = (a * 0.9).toFixed(3)
  }
}

export default function ProfileFrame({ progress, active, reducedMotion, intensity, speed, site }: SectionAnimationProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const els = useRef<Els>({ stage: null, mats: [], solid: null, outline: null })
  const live = useRef({ t: 0 })
  const size = useBoxSize(rootRef)
  const fine = useFinePointer()
  const layout = useMemo(() => compose(size, site, intensity), [size, site, intensity])

  useLayoutEffect(() => {
    if (!layout) return
    render(layout, els.current, reducedMotion ? 1 : progress.current, 0, 0, 0)
  }, [layout, reducedMotion, progress])

  useTicker(active && !reducedMotion && !!layout, (dt) => {
    if (!layout) return
    const st = live.current
    st.t += dt * speed
    const lean = fine ? 1 : 0
    render(layout, els.current, progress.current, st.t, pointer.pointerX * lean, pointer.pointerY * lean)
  })

  const vars = layout
    ? ({
        '--band': `${layout.band.toFixed(1)}px`,
        '--cap-size': `${layout.caption}px`,
        '--type': `${layout.type.toFixed(1)}px`,
        perspective: `${Math.round(Math.max(layout.w, layout.h) * 1.7)}px`,
      } as CSSProperties)
    : undefined
  const win = layout?.win

  return (
    <div ref={rootRef} className={styles.root} style={vars} data-thin={layout && layout.band < layout.caption * 1.3 ? '' : undefined}>
      {layout && win && (
        <div
          ref={(el) => {
            els.current.stage = el
          }}
          className={styles.stage}
          style={{ transformOrigin: `${win.x + win.w / 2}px ${win.y + win.h / 2}px` }}
        >
          {layout.mats.map((m, i) => (
            <div
              key={m.key}
              ref={(el) => {
                els.current.mats[i] = el
              }}
              className={styles.mat}
              data-inner={i === layout.mats.length - 1 || undefined}
              style={{ left: m.x, top: m.y, width: m.w, height: m.h }}
            >
              {m.caption && (
                <span className={styles.caption} data-corner={m.corner}>
                  {m.caption}
                </span>
              )}
            </div>
          ))}
          <div
            ref={(el) => {
              els.current.solid = el
            }}
            className={styles.initials}
            style={{ left: win.x, top: win.y, width: win.w, height: win.h }}
          >
            {layout.initials}
          </div>
          <div
            ref={(el) => {
              els.current.outline = el
            }}
            className={`${styles.initials} ${styles.outline}`}
            style={{ left: win.x, top: win.y, width: win.w, height: win.h }}
          >
            {layout.initials}
          </div>
        </div>
      )}
    </div>
  )
}
