'use client'

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { SiteProject, UniverseAnimationProps } from '../types'
import { CATEGORY_LABEL, accentOf, approach, labelOf, metaOf, smooth, tierOf, toneOf, useBoxSize, useHot, useTicker } from './shared'
import { Shot, hasShot } from './Shot'
import styles from './Gallery.module.css'

/* ============================================================
   DIMENSIONAL GALLERY

   The projects hang in a small rotunda: one row of frames on a
   shallow curved wall, seen from inside, so the frames towards
   the edges of the box turn to face the visitor and come a
   little nearer. They hang from a picture rail on fine wires,
   their centres on one eye line, the headline work in the
   largest frames. A project with a real capture of its site
   shows it; every other project is a typographic print — its
   own one-line description set as the work, its year and its
   category — and never a picture made up for it.

   Scrolling turns the room past every frame the filter keeps;
   focusing a frame (Tab, or the arrow keys, which step through
   the frames) turns the room to it, and the frame under the
   pointer or the focus comes forward off the wall.

   Reduced motion hangs the whole collection flat, as a still
   salon wall, every frame in view.

   Intensity: the depth of the room (how tightly the wall
   curves). Speed: how quickly the room turns to follow.
   ============================================================ */

interface Frame {
  p: SiteProject
  /** Centre along the wall, px. */
  s: number
  fw: number
  fh: number
  /** Flat wall position (reduced motion). */
  x: number
  y: number
  /** From the frame's top edge up to the picture rail, and down to the dado line. */
  drop: number
  dado: number
}

interface Hang {
  frames: Frame[]
  flat: boolean
  /** Wall radius and the camera's distance. */
  radius: number
  perspective: number
  eye: number
  compact: boolean
  caption: boolean
  cols: number
  gap: number
}

const TIER_SCALE = [1, 0.86, 0.74]

function hang(projects: SiteProject[], w: number, h: number, intensity: number, flat: boolean): Hang {
  const compact = w < 560 || h < 300
  if (flat) {
    // A salon wall: every frame in view at once, rows as even as the box allows.
    const n = Math.max(1, projects.length)
    const label = compact ? 0 : 20
    let best = { cols: 1, rows: 1, fw: 0 }
    for (let rows = 1; rows <= n; rows++) {
      const cols = Math.ceil(n / rows)
      const fw = Math.min(((w - 16) / cols) * 0.84, ((h - 16) / rows - label - 8) * 0.78)
      if (fw > best.fw) best = { cols, rows, fw }
    }
    const fh = best.fw / 0.78
    const cw = (w - 16) / best.cols
    const ch = (h - 16) / best.rows
    const caption = label > 0 && best.fw >= 64
    const frames = projects.map((p, i) => ({
      p,
      s: 0,
      fw: best.fw,
      fh,
      x: 8 + (i % best.cols) * cw + cw / 2,
      y: 8 + Math.floor(i / best.cols) * ch + (ch - (caption ? label : 0)) / 2,
      drop: 0,
      dado: 0,
    }))
    return { frames, flat, radius: 0, perspective: 0, eye: h / 2, compact, caption, cols: best.cols, gap: cw - best.fw }
  }
  const caption = h >= (compact ? 300 : 260)
  const rail = compact ? 18 : 30
  const cap = caption ? (compact ? 34 : 40) : 0
  // About five frames across a desktop box, fewer and larger on a tablet, one and a half on a phone.
  const across = Math.min(6, Math.max(2.4, w / 265))
  const fh0 = Math.max(70, Math.min((h - rail - cap - 14) * 0.92, compact ? w * 0.62 : w / (across * 0.94), 460))
  const fw0 = fh0 * 0.78
  const gap = fw0 * (compact ? 0.14 : 0.2)
  let s = 0
  const frames = projects.map((p, i) => {
    const k = TIER_SCALE[tierOf(p)]
    const fw = fw0 * k
    const fh = fh0 * k
    if (i > 0) s += gap + fw / 2
    const f = { p, s, fw, fh, x: 0, y: 0, drop: (fh0 - fh) / 2 + rail * 0.8, dado: (fh + fh0) / 2 + cap + 6 }
    s += fw / 2
    return f
  })
  // A shallow wall at no intensity, a tight rotunda at full.
  const radius = w * (0.7 + 2.2 * (1 - intensity) ** 1.5)
  const eye = rail + fh0 / 2 + Math.max(0, (h - rail - cap - fh0) / 2 - 4)
  return { frames, flat, radius, perspective: Math.max(w * 1.15, 900), eye, compact, caption, cols: 0, gap }
}

/**
 * A project with no capture hangs as a print. On a frame with room
 * the work is its own one-line description, set large; on a small
 * one it is its year. Its category heads the sheet and one rule of
 * its accent signs it. The wall label beneath names it either way.
 */
function Print({ p, fw, mode }: { p: SiteProject; fw: number; mode: 'words' | 'year' | 'title' }) {
  const m = mode === 'words' && !p.shortDescription ? 'title' : mode
  const size = m === 'words' ? 0.07 : m === 'year' ? 0.27 : 0.15
  return (
    <span className={styles.print} data-tier={tierOf(p)} data-mode={m} style={{ '--pf': `${(fw * size).toFixed(1)}px` } as CSSProperties}>
      {fw >= 72 && (
        <span className={styles.printHead}>
          <span>{CATEGORY_LABEL[p.category] ?? p.category}</span>
          {m !== 'year' && <span>{p.year}</span>}
        </span>
      )}
      <span className={styles.printBody}>{m === 'words' ? p.shortDescription : m === 'year' ? p.year : p.title}</span>
      <span className={styles.printRule} />
    </span>
  )
}

function Gallery({ projects, visible, progress, active, reducedMotion, intensity, speed, onOpen, onHover }: UniverseAnimationProps) {
  const root = useRef<HTMLDivElement>(null)
  const { w, h } = useBoxSize(root)
  const model = useMemo(() => (w > 0 && h > 0 ? hang(projects, w, h, intensity, reducedMotion) : null), [projects, w, h, intensity, reducedMotion])
  const { hot, bind } = useHot(onHover)
  const [focused, setFocused] = useState(-1)

  const slots = useRef<(HTMLDivElement | null)[]>([])
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const sim = useRef({ c: NaN, t: 0, focus: -1, shown: [] as boolean[], kept: [] as Frame[] })
  // The frames the filter keeps (all of them when it keeps none): what scrolling turns the room through.
  const kept = useMemo(() => {
    const all = model?.frames ?? []
    const some = all.filter((f) => visible.has(f.p.id))
    return some.length ? some : all
  }, [model, visible])
  useEffect(() => {
    sim.current.kept = kept
    sim.current.focus = focused
  }, [kept, focused])

  /** Where along the wall the room faces: the focused frame, else the scroll's share of the frames the filter keeps. */
  const target = () => {
    if (!model) return 0
    const f = model.frames
    const s = sim.current
    if (s.focus >= 0 && f[s.focus]) return f[s.focus].s
    const list = s.kept
    if (!list.length) return 0
    // The room comes to rest on each frame in turn, then moves on to the next.
    const at = (list.length - 1) * smooth(0.04, 0.96, progress.current)
    const i0 = Math.floor(at)
    const i1 = Math.min(list.length - 1, i0 + 1)
    return list[i0].s + (list[i1].s - list[i0].s) * smooth(0.2, 0.8, at - i0)
  }

  const turn = (dt: number, still: boolean) => {
    if (!model || model.flat) return
    const s = sim.current
    const goal = target()
    s.t += dt * speed
    s.c = Number.isNaN(s.c) || still ? goal : approach(s.c, goal, 2.6 * speed, dt)
    const sway = still ? 0 : Math.sin(s.t * 0.32) * (model.frames[0]?.fw ?? 0) * 0.04
    const c = s.c + sway
    const R = model.radius
    const reach = w / 2 + (model.frames[0]?.fw ?? 0) * 1.2
    model.frames.forEach((f, i) => {
      const el = slots.current[i]
      if (!el) return
      const d = f.s - c
      const inView = Math.abs(d) < reach
      if (!inView && s.shown[i] === false) return
      // Out of view, a frame waits just past the edge of the box (still focusable: focus turns the room to it).
      const dd = inView ? d : Math.sign(d) * reach
      const phi = dd / R
      const x = R * Math.sin(phi)
      const z = R * (1 - Math.cos(phi))
      el.style.transform = `translate3d(${x.toFixed(1)}px, 0, ${z.toFixed(1)}px) rotateY(${(-phi).toFixed(4)}rad)`
      el.style.opacity = inView ? smooth(reach, reach - f.fw * 0.9, Math.abs(d)).toFixed(3) : '0'
      // Transparent, never hidden: a hidden frame would drop out of the tab order and refuse focus.
      el.style.pointerEvents = inView ? '' : 'none'
      s.shown[i] = inView
    })
  }

  useLayoutEffect(() => {
    sim.current.shown = []
    turn(0, reducedMotion || Number.isNaN(sim.current.c))
  })

  useTicker(active && !reducedMotion && !!model && !model.flat, (dt) => turn(dt, false))

  /* Arrow keys step the focus through the frames the filter keeps. */
  const onKeyDown = (e: KeyboardEvent) => {
    if (!model) return
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
    const order = model.frames.map((f, i) => (visible.has(f.p.id) ? i : -1)).filter((i) => i >= 0)
    if (!order.length) return
    const at = order.indexOf(focused)
    let next = -1
    if (e.key === 'Home') next = order[0]
    else if (e.key === 'End') next = order[order.length - 1]
    else if (keys[e.key] !== undefined) {
      const step = model.flat && (e.key === 'ArrowDown' || e.key === 'ArrowUp') ? model.cols : 1
      const pos = at < 0 ? 0 : Math.min(order.length - 1, Math.max(0, at + keys[e.key] * step))
      next = order[pos]
    } else return
    e.preventDefault()
    buttons.current[next]?.focus({ preventScroll: true })
  }

  const frameStyle = (f: Frame): CSSProperties =>
    ({
      '--fw': `${f.fw.toFixed(1)}px`,
      '--fh': `${f.fh.toFixed(1)}px`,
      '--drop': `${f.drop.toFixed(1)}px`,
      '--dado': `${f.dado.toFixed(1)}px`,
      '--accent-p': accentOf(f.p),
      '--tone': toneOf(f.p),
      ...(model?.flat ? { transform: `translate3d(${f.x.toFixed(1)}px, ${f.y.toFixed(1)}px, 0)` } : null),
    }) as CSSProperties

  return (
    <div
      ref={root}
      className={styles.root}
      role="group"
      aria-label="Project archive"
      data-flat={model?.flat || undefined}
      data-compact={model?.compact || undefined}
      onKeyDown={onKeyDown}
      style={model && !model.flat ? ({ perspective: `${model.perspective}px`, '--eye': `${model.eye}px`, '--gap': `${model.gap.toFixed(1)}px` } as CSSProperties) : undefined}
    >
      {model?.frames.map((f, i) => {
        const dim = !visible.has(f.p.id)
        const shot = hasShot(f.p)
        return (
          <div
            key={f.p.id}
            ref={(el) => {
              slots.current[i] = el
            }}
            className={styles.slot}
            data-dim={dim || undefined}
            data-hot={hot === f.p.slug || undefined}
            style={frameStyle(f)}
          >
            {!model.flat && model.caption && <span className={styles.dado} aria-hidden="true" />}
            {!model.flat && (
              <span className={styles.hang} aria-hidden="true">
                <span className={styles.rail} />
                <svg className={styles.wire} viewBox="0 0 100 100" preserveAspectRatio="none">
                  <path d="M6 100 L50 0 L94 100" />
                </svg>
              </span>
            )}
            <button
              ref={(el) => {
                buttons.current[i] = el
              }}
              type="button"
              className={styles.frame}
              aria-hidden={dim || undefined}
              tabIndex={dim ? -1 : 0}
              aria-label={labelOf(f.p)}
              data-cursor="view"
              data-tier={tierOf(f.p)}
              onClick={() => onOpen(f.p.slug)}
              {...bind(f.p.slug)}
              onFocus={(e) => {
                bind(f.p.slug).onFocus(e)
                // Only the keyboard turns the room: a frame pressed with the mouse must not slide away mid-click.
                if (e.currentTarget.matches(':focus-visible')) setFocused(i)
              }}
              onBlur={() => {
                bind(f.p.slug).onBlur()
                setFocused((v) => (v === i ? -1 : v))
              }}
            >
              <span className={styles.mat}>
                <Print p={f.p} fw={f.fw} mode={f.fw >= 150 && !model.compact ? 'words' : model.caption ? 'year' : 'title'} />
                {shot && <Shot p={f.p} narrow={f.fw < 150} className={styles.shot} width={f.fw} height={f.fh} />}
              </span>
              {model.caption && (
                <span className={styles.caption}>
                  <span className={styles.captionTitle}>{f.p.title}</span>
                  <span className={styles.captionMeta}>{metaOf(f.p)}</span>
                </span>
              )}
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default memo(Gallery)
