'use client'

import { useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'
import type { SiteContent } from '@/cms/derive'
import { clamp, lerp, range } from '@/lib/math'
import type { SectionAnimationProps } from '../types'
import { expo, present, smooth, textWidth, useBoxSize, useTicker, type Size } from './shared'
import styles from './TypeMotion.module.css'

/* ============================================================
   TYPOGRAPHIC IDENTITY

   The name, set as large as the box allows, is the whole
   composition. Its two lines enter from opposite margins and
   cross on the way in; the second arrives as an outline and is
   filled by a wipe. Under a hairline, the roles roll through a
   one-line window and come to rest on the first; under them every
   through-line resolves the same way — the "from" word and the
   "to" word slide in from opposite sides, cross, and the arrow is
   drawn between them. Behind it all, the initials in outline, cut
   by the box's edge.

   All of it follows the scroll. Intensity is the scale of the
   type (how much of the box the name fills); speed, the slow
   drift of the initials behind.
   ============================================================ */

interface Layout {
  w: number
  h: number
  pad: number
  name: string[]
  nameSize: number
  nameTop: number
  lineH: number
  roles: string[]
  roleSize: number
  roleTop: number
  ruleTop: number
  markers: { from: string; to: string }[]
  markerSize: number
  markerTop: number
  markerCols: number
  markerRowH: number
  initials: string
  initialsSize: number
}

const NAME = { weight: 500, tracking: -0.045 }

/** The name on two lines where it breaks most evenly (one line if it is one word). */
function nameLines(name: string): string[] {
  const words = present(name.toUpperCase().split(/\s+/))
  if (words.length < 2) return words
  let best = [words.join(' ')]
  let bestW = Infinity
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ')
    const b = words.slice(i).join(' ')
    const wMax = Math.max(textWidth(a, 100, NAME), textWidth(b, 100, NAME))
    if (wMax < bestW) {
      bestW = wMax
      best = [a, b]
    }
  }
  return best
}

function compose(size: Size, site: SiteContent, intensity: number): Layout | null {
  const { w, h } = size
  if (w < 80 || h < 60) return null
  const p = site.profile
  const pad = clamp(Math.min(w, h) * 0.05, 8, 32)
  const iw = w - pad * 2
  const ih = h - pad * 2
  const name = nameLines(p.name || p.initials || '')
  if (!name.length) return null
  const widest = Math.max(...name.map((l) => textWidth(l, 100, NAME)))
  const fill = lerp(0.6, 1, clamp(intensity))
  let nameSize = Math.max(12, Math.min((iw / widest) * 100 * fill, ih * (name.length > 1 ? 0.3 : 0.45)))
  const roles = present(p.roles).map((r) => r.toUpperCase())
  const allMarkers = p.markers.map((m) => ({ from: (m.from ?? '').trim().toUpperCase(), to: (m.to ?? '').trim().toUpperCase() })).filter((m) => m.from && m.to)
  const markerSize = iw >= 480 ? 11 : 10
  const markerCols = iw >= 460 ? 2 : 1
  const markerRowH = markerSize * 2.1

  // Fit the stack: the name first, then the roles, then as many through-lines as there is room for.
  let roleSize = 0
  let markers = allMarkers
  let total = 0
  for (let pass = 0; pass < 12; pass++) {
    const lineH = nameSize * 0.9
    roleSize = roles.length ? clamp(nameSize * 0.3, 12, 30) : 0
    const nameH = lineH * name.length
    const roleH = roleSize ? roleSize * 1.25 + nameSize * 0.32 : 0
    const room = ih - nameH - roleH - (roleSize ? 14 : 0)
    const rows = Math.max(0, Math.min(Math.ceil(allMarkers.length / markerCols), Math.floor((room - 12) / markerRowH)))
    markers = allMarkers.slice(0, rows * markerCols)
    total = nameH + roleH + (markers.length ? 12 + rows * markerRowH : 0)
    if (total <= ih || nameSize <= 12) break
    nameSize = Math.max(12, nameSize * 0.9)
  }
  const lineH = nameSize * 0.9
  const top = pad + Math.max(0, (ih - total) / 2)
  const nameTop = top
  const ruleTop = nameTop + lineH * name.length + nameSize * 0.16
  const roleTop = ruleTop + nameSize * 0.16
  const markerTop = roleTop + (roleSize ? roleSize * 1.25 + 12 : 0)
  const initials = (p.initials || '').trim().toUpperCase() || name.map((l) => l[0]).join('')
  const initialsSize = Math.max(w, h) * 0.62
  return { w, h, pad, name, nameSize, nameTop, lineH, roles, roleSize, roleTop, ruleTop, markers, markerSize, markerTop, markerCols, markerRowH, initials, initialsSize }
}

interface Els {
  lines: (HTMLDivElement | null)[]
  fill: HTMLDivElement | null
  rule: HTMLDivElement | null
  roll: HTMLDivElement | null
  markers: (HTMLDivElement | null)[]
  initials: HTMLDivElement | null
}

/** The roll through the roles: a tick per role, coming to rest on the first. */
function rollAt(p: number, n: number) {
  if (n < 2) return 0
  const x = range(p, 0.26, 0.62) * n
  const k = Math.floor(x)
  return Math.min(n, k + smooth(clamp((x - k) * 1.6)))
}

function render(L: Layout, els: Els, p: number, t: number) {
  const iw = L.w - L.pad * 2
  L.name.forEach((_, i) => {
    const el = els.lines[i]
    if (!el) return
    // The two lines enter from opposite margins and cross on the way in.
    const a = expo(range(p, 0.02 + i * 0.05, 0.3 + i * 0.05))
    const dir = i % 2 ? -1 : 1
    el.style.transform = `translate3d(${((1 - a) * dir * iw * 0.9).toFixed(1)}px, 0, 0)`
  })
  if (els.fill) {
    const a = expo(range(p, 0.2, 0.46))
    els.fill.style.clipPath = `inset(0 ${((1 - a) * 100).toFixed(2)}% 0 0)`
  }
  if (els.rule) els.rule.style.transform = `scaleX(${expo(range(p, 0.24, 0.5)).toFixed(4)})`
  if (els.roll) {
    const n = L.roles.length
    const pos = rollAt(p, n)
    const show = expo(range(p, 0.22, 0.34))
    els.roll.style.transform = `translate3d(0, ${(-pos * L.roleSize * 1.25 + (1 - show) * L.roleSize * 1.25).toFixed(2)}px, 0)`
  }
  const step = Math.min(0.03, 0.16 / Math.max(1, L.markers.length))
  L.markers.forEach((_, i) => {
    const el = els.markers[i]
    if (!el) return
    const a = expo(range(p, 0.34 + i * step, 0.56 + i * step))
    el.style.setProperty('--x', `${((1 - a) * 46).toFixed(1)}px`)
    el.style.setProperty('--a', a.toFixed(3))
  })
  if (els.initials) {
    const a = smooth(range(p, 0.0, 0.5))
    const drift = Math.sin(t * 0.18) * 10
    els.initials.style.transform = `translate3d(${((1 - a) * L.w * 0.12 + drift).toFixed(1)}px, ${((1 - a) * L.h * 0.06).toFixed(1)}px, 0) scale(${(1.18 - 0.18 * a).toFixed(4)})`
    els.initials.style.opacity = (0.15 + 0.85 * expo(range(p, 0, 0.3))).toFixed(3)
  }
}

export default function TypeMotion({ progress, active, reducedMotion, intensity, speed, site }: SectionAnimationProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const els = useRef<Els>({ lines: [], fill: null, rule: null, roll: null, markers: [], initials: null })
  const clock = useRef(0)
  const size = useBoxSize(rootRef)
  const layout = useMemo(() => compose(size, site, intensity), [size, site, intensity])

  useLayoutEffect(() => {
    if (!layout) return
    render(layout, els.current, reducedMotion ? 1 : progress.current, clock.current)
  }, [layout, reducedMotion, progress])

  useTicker(active && !reducedMotion && !!layout, (dt) => {
    if (!layout) return
    clock.current += dt * speed
    render(layout, els.current, progress.current, clock.current)
  })

  if (!layout) return <div ref={rootRef} className={styles.root} />
  const L = layout
  const vars = {
    '--name': `${L.nameSize.toFixed(2)}px`,
    '--line': `${L.lineH.toFixed(2)}px`,
    '--role': `${L.roleSize.toFixed(2)}px`,
    '--marker': `${L.markerSize}px`,
    '--pad': `${L.pad.toFixed(1)}px`,
  } as CSSProperties
  const last = L.name.length - 1

  return (
    <div ref={rootRef} className={styles.root} style={vars}>
      <div
        ref={(el) => {
          els.current.initials = el
        }}
        className={styles.initials}
        style={{ fontSize: L.initialsSize }}
      >
        {L.initials}
      </div>

      {L.name.map((line, i) => (
        <div key={i} className={styles.mask} style={{ top: L.nameTop + i * L.lineH, height: L.lineH }}>
          <div
            ref={(el) => {
              els.current.lines[i] = el
            }}
            className={styles.line}
            data-outline={i === last && L.name.length > 1 ? '' : undefined}
          >
            {line}
            {i === last && L.name.length > 1 && (
              <div
                ref={(el) => {
                  els.current.fill = el
                }}
                className={styles.fill}
                aria-hidden="true"
              >
                {line}
              </div>
            )}
          </div>
        </div>
      ))}

      {L.roles.length > 0 && (
        <>
          <div
            ref={(el) => {
              els.current.rule = el
            }}
            className={styles.rule}
            style={{ top: L.ruleTop }}
          />
          <div className={styles.window} style={{ top: L.roleTop, height: L.roleSize * 1.25 }}>
            <i className={styles.tick} />
            <div
              ref={(el) => {
                els.current.roll = el
              }}
              className={styles.roll}
            >
              {[...L.roles, L.roles[0]].map((r, i) => (
                <span key={i} className={styles.role}>
                  {r}
                </span>
              ))}
            </div>
          </div>
        </>
      )}

      {L.markers.length > 0 && (
        <div className={styles.markers} style={{ top: L.markerTop, gridTemplateColumns: `repeat(${L.markerCols}, minmax(0, 1fr))` }}>
          {L.markers.map((m, i) => (
            <div
              key={i}
              ref={(el) => {
                els.current.markers[i] = el
              }}
              className={styles.marker}
              style={{ height: L.markerRowH }}
            >
              <span className={styles.from}>{m.from}</span>
              <span className={styles.arrow} />
              <span className={styles.to}>{m.to}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
