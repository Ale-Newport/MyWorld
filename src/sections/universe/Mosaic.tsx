'use client'

import { memo, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'
import type { SiteProject, UniverseAnimationProps } from '../types'
import { CATEGORY_LABEL, accentOf, approach, clamp01, labelOf, smooth, tierOf, toneOf, useBoxSize, useFinePointer, useHot, useTicker, type Tier } from './shared'
import { Shot, hasShot } from './Shot'
import styles from './Mosaic.module.css'

/* ============================================================
   MAGNETIC MOSAIC

   Every project is a tile on one tidy grid that fills the box:
   the headline work takes four cells, featured work two, the
   archive one, and the grid is chosen per box so the tiles stay
   legible — fewer, larger cells on a phone, the headline tiles
   spread across the width rather than stacked in a corner.
   Client sites show their real capture, a little faded until
   the pointer reaches them; every other tile is set in type.

   The tiles assemble as the section arrives. After that the
   mosaic only moves where it is touched: the tiles near the
   pointer lean towards it and lift a little, falling off with
   distance, so the effect stays local and the grid is never
   disturbed; with the keyboard the focused tile plays the
   pointer's part. A filter dims the tiles it leaves out, where
   they are.

   Intensity: the strength of the pull. Speed: how quickly the
   tiles answer it.
   ============================================================ */

interface Tile {
  p: SiteProject
  tier: Tier
  /** Grid placement, in cells. */
  col: number
  row: number
  cs: number
  rs: number
  /** Box pixels. */
  x: number
  y: number
  w: number
  h: number
  delay: number
}

interface Board {
  tiles: Tile[]
  cols: number
  rows: number
  cell: number
  /** Cells only one line of type tall. */
  line: boolean
  pictures: boolean
}

type Spans = [number, number][]

/** The largest a cell is ever drawn. */
const CELL_W = 160
const CELL_H = 120

/** First-fit placement on a grid `cols` wide, anchors (if any) first. */
function pack(spans: Spans, cols: number, anchors: Map<number, [number, number]>) {
  const grid: boolean[][] = []
  const free = (c: number, r: number, cs: number, rs: number) => {
    if (c + cs > cols) return false
    for (let y = r; y < r + rs; y++) for (let x = c; x < c + cs; x++) if (grid[y]?.[x]) return false
    return true
  }
  const take = (c: number, r: number, cs: number, rs: number) => {
    for (let y = r; y < r + rs; y++) {
      grid[y] ??= new Array(cols).fill(false)
      for (let x = c; x < c + cs; x++) grid[y][x] = true
    }
  }
  const at: [number, number][] = new Array(spans.length)
  anchors.forEach(([c, r], i) => {
    if (free(c, r, spans[i][0], spans[i][1])) {
      take(c, r, spans[i][0], spans[i][1])
      at[i] = [c, r]
    }
  })
  spans.forEach(([cs, rs], i) => {
    if (at[i]) return
    for (let r = 0; ; r++) {
      let placed = false
      for (let c = 0; c + cs <= cols; c++) {
        if (free(c, r, cs, rs)) {
          take(c, r, cs, rs)
          at[i] = [c, r]
          placed = true
          break
        }
      }
      if (placed) break
    }
  })
  const rows = grid.length
  let holes = 0
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (!grid[y]?.[x]) holes++
  return { at, rows, holes }
}

function board(projects: SiteProject[], w: number, h: number): Board | null {
  const n = projects.length
  if (!n || w < 40 || h < 40) return null
  const gap = w < 560 ? 6 : w < 1000 ? 10 : 12
  const tiers = projects.map(tierOf)
  // Three schemes, richest first; the richest whose cells stay legible wins.
  const schemes: [number, number][][] = [
    [[2, 2], [2, 1], [1, 1]],
    [[2, 2], [1, 1], [1, 1]],
    [[2, 1], [1, 1], [1, 1]],
  ]
  let best: { score: number; spans: Spans; cols: number; at: [number, number][]; rows: number } | null = null
  for (let si = 0; si < schemes.length; si++) {
    const scheme = schemes[si]
    for (let cols = 2; cols <= 24; cols++) {
      const spans: Spans = tiers.map((t) => [Math.min(cols, scheme[t][0]), scheme[t][1]] as [number, number])
      const cells = spans.reduce((a, [cs, rs]) => a + cs * rs, 0)
      const rowsGuess = Math.max(1, Math.ceil(cells / cols))
      // The headline tiles are spread across the width, alternately high and low.
      const heroes = tiers.map((t, i) => (t === 0 ? i : -1)).filter((i) => i >= 0)
      const anchors = new Map<number, [number, number]>()
      if (spans[heroes[0]]?.[1] === 2 && rowsGuess >= 3) {
        heroes.forEach((i, k) => {
          const c = Math.round(((k + 0.5) / heroes.length) * cols - spans[i][0] / 2)
          anchors.set(i, [Math.max(0, Math.min(cols - spans[i][0], c)), k % 2 ? rowsGuess - spans[i][1] : 0])
        })
      }
      let { at, rows, holes } = pack(spans, cols, anchors)
      // Absorb the last row's holes by widening featured tiles, so the grid closes square.
      for (let pass = 0; holes > 0 && pass < 3; pass++) {
        const wide = spans.map((s, i) => (tiers[i] === 1 && s[0] < 3 && s[0] < cols ? i : -1)).filter((i) => i >= 0).slice(0, holes)
        if (!wide.length) break
        wide.forEach((i) => (spans[i] = [spans[i][0] + 1, spans[i][1]]))
        ;({ at, rows, holes } = pack(spans, cols, anchors))
      }
      // Cells stop growing at a size (see below), so they are scored at the size they will be drawn.
      const cw = Math.min(CELL_W, (w - gap * (cols - 1)) / cols)
      const ch = Math.min(CELL_H, (h - gap * (rows - 1)) / rows)
      if (cw < 30 || ch < 22) continue
      // Legible cells: wide enough for a name and, where the box allows, tall enough for two
      // lines of it under the year. Past that, size matters less than hierarchy, so a plainer
      // scheme has to earn its place.
      const legible = Math.min(cw, ch * 1.6)
      const short = (Math.min(cw, ch) >= 50 ? Math.max(0, 62 - ch) * 3 : ch < 26 ? 40 : 0) + Math.max(0, 58 - cw) * 2
      const score = (legible > 80 ? 80 + (legible - 80) * 0.25 : legible) * (1 - si * 0.25) - holes * 6 - Math.abs(cw / ch - 1.15) * 6 - short
      if (!best || score > best.score) best = { score, spans: spans.map((s) => [...s] as [number, number]), cols, at, rows }
    }
  }
  if (!best) return null
  const { spans, cols, at, rows } = best
  // On a very large box the cells stop growing and the mosaic is centred, so it stays a mosaic and never a wall of plates.
  const cw = Math.min(CELL_W, (w - gap * (cols - 1)) / cols)
  const ch = Math.min(CELL_H, (h - gap * (rows - 1)) / rows)
  const ox = (w - (cols * cw + (cols - 1) * gap)) / 2
  const oy = (h - (rows * ch + (rows - 1) * gap)) / 2
  const tiles = projects.map((p, i) => {
    const [c, r] = at[i]
    const [cs, rs] = spans[i]
    const x = ox + c * (cw + gap)
    const y = oy + r * (ch + gap)
    return { p, tier: tiers[i], col: c, row: r, cs, rs, x, y, w: cs * cw + (cs - 1) * gap, h: rs * ch + (rs - 1) * gap, delay: 0 }
  })
  // The assembly runs outward from the middle of the box.
  const far = Math.hypot(w, h) / 2
  tiles.forEach((t) => (t.delay = Math.hypot(t.x + t.w / 2 - w / 2, t.y + t.h / 2 - h / 2) / far))
  return { tiles, cols, rows, cell: Math.min(cw, ch), line: ch < 46, pictures: Math.min(cw, ch) >= 56 }
}

function Mosaic({ projects, visible, progress, active, reducedMotion, intensity, speed, onOpen, onHover }: UniverseAnimationProps) {
  const root = useRef<HTMLDivElement>(null)
  const { w, h } = useBoxSize(root)
  const fine = useFinePointer()
  const model = useMemo(() => (w > 0 && h > 0 ? board(projects, w, h) : null), [projects, w, h])
  const { hot, bind } = useHot(onHover)

  const els = useRef<(HTMLButtonElement | null)[]>([])
  const sim = useRef({
    px: 0,
    py: 0,
    on: 0,
    target: 0,
    rect: null as DOMRect | null,
    focus: -1,
    lean: [] as number[][],
    settled: false,
  })
  const hotIndex = model ? model.tiles.findIndex((t) => t.p.slug === hot) : -1
  useEffect(() => {
    sim.current.focus = hotIndex
    sim.current.settled = false
  }, [hotIndex])

  /** The pull: where the pointer (or the focused tile) is, and how strongly every tile answers it. */
  const step = (dt: number, still: boolean) => {
    if (!model) return
    const s = sim.current
    const t = still ? 1 : clamp01((progress.current + 0.06) / 0.28)
    const pointer = s.target > 0
    const f = !pointer && s.focus >= 0 ? model.tiles[s.focus] : null
    const gx = pointer ? s.px : f ? f.x + f.w / 2 : s.px
    const gy = pointer ? s.py : f ? f.y + f.h / 2 : s.py
    s.on = still ? 0 : approach(s.on, pointer || f ? 1 : 0, 6 * speed, dt)
    const reach = model.cell * 2.4
    const pull = 0.35 + 0.65 * intensity
    let moving = false
    model.tiles.forEach((tile, i) => {
      const el = els.current[i]
      if (!el) return
      const cx = tile.x + tile.w / 2
      const cy = tile.y + tile.h / 2
      const dx = gx - cx
      const dy = gy - cy
      const d = Math.hypot(dx, dy)
      const size = Math.max(tile.w, tile.h) / 2
      // Strongest inside and around the tile under the pull, gone two or three cells away.
      const k = s.on * Math.exp(-Math.pow(Math.max(0, d - size * 0.5) / reach, 2)) * pull
      const inside = d < size
      const goal = still
        ? [0, 0, 0, 0, 0]
        : [
            inside ? 0 : (dx / (d || 1)) * k * 7,
            inside ? 0 : (dy / (d || 1)) * k * 7,
            Math.max(-1, Math.min(1, dx / reach)) * k * 7,
            -Math.max(-1, Math.min(1, dy / reach)) * k * 7,
            k * (inside ? 0.045 : 0.018),
          ]
      const cur = (s.lean[i] ??= [0, 0, 0, 0, 0])
      for (let j = 0; j < 5; j++) {
        cur[j] = still ? goal[j] : approach(cur[j], goal[j], 9 * speed, dt)
        if (Math.abs(cur[j] - goal[j]) > 0.002) moving = true
      }
      const come = still ? 1 : smooth(tile.delay * 0.6, tile.delay * 0.6 + 0.4, t)
      if (come < 1) moving = true
      el.style.transform = `translate3d(${(tile.x + cur[0]).toFixed(2)}px, ${(tile.y + cur[1] + (1 - come) * 14).toFixed(2)}px, 0) perspective(900px) rotateY(${cur[2].toFixed(2)}deg) rotateX(${cur[3].toFixed(2)}deg) scale(${(1 + cur[4]).toFixed(4)})`
      el.style.opacity = come.toFixed(3)
    })
    s.settled = !moving && s.on < 0.001
  }

  useLayoutEffect(() => {
    sim.current.settled = false
    step(0, reducedMotion)
  })

  useTicker(active && !reducedMotion && !!model, (dt) => {
    const s = sim.current
    if (s.settled && s.target === 0 && s.focus < 0 && progress.current > 0.3) return
    step(dt, false)
  })

  // The pointer's place in the box. Read on entering (and after a scroll), never per frame.
  useEffect(() => {
    const el = root.current
    if (!el || !fine || reducedMotion) return
    const s = sim.current
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      if (!s.rect) s.rect = el.getBoundingClientRect()
      s.px = e.clientX - s.rect.left
      s.py = e.clientY - s.rect.top
      s.target = 1
      s.settled = false
    }
    const leave = () => {
      s.target = 0
      s.rect = null
      s.settled = false
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
    <div
      ref={root}
      className={styles.root}
      role="group"
      aria-label="Project archive"
      data-small={(model && model.cell < 50) || undefined}
      data-line={model?.line || undefined}
      data-tiny={(model && model.tiles.some((t) => t.cs === 1 && t.w < 48)) || undefined}
      style={model ? ({ '--cell': `${model.cell.toFixed(1)}px` } as CSSProperties) : undefined}
    >
      {model?.tiles.map((t, i) => {
        const dim = !visible.has(t.p.id)
        const size = t.tier === 0 && t.rs > 1 ? 'l' : t.cs > 1 ? 'm' : 's'
        // Captures go in the larger tiles only, beside the type: a mosaic of busy screenshots stops being tidy.
        const picture = model.pictures && size !== 's' && hasShot(t.p)
        const shown = size !== 'l' && t.w < 110 ? (t.p.shortTitle ?? t.p.title) : t.p.title
        return (
          <button
            key={t.p.id}
            ref={(el) => {
              els.current[i] = el
            }}
            type="button"
            className={styles.tile}
            data-size={size}
            data-tier={t.tier}
            data-dim={dim || undefined}
            data-hot={hot === t.p.slug || undefined}
            data-picture={picture || undefined}
            aria-hidden={dim || undefined}
            tabIndex={dim ? -1 : 0}
            aria-label={labelOf(t.p, shown)}
            data-cursor="view"
            onClick={() => onOpen(t.p.slug)}
            style={{ width: t.w, height: t.h, '--tone': toneOf(t.p), '--accent-p': accentOf(t.p) } as CSSProperties}
            {...bind(t.p.slug)}
          >
            <span className={styles.plate}>
              {picture && (
                <span className={styles.pane}>
                  <Shot p={t.p} narrow={t.h < 150} className={styles.shot} width={t.h} height={t.h} />
                </span>
              )}
              <span className={styles.type}>
                <span className={styles.meta}>
                  <span className={styles.mark} />
                  <span className={styles.cat}>{CATEGORY_LABEL[t.p.category] ?? t.p.category}</span>
                  <span className={styles.year}>{t.p.year}</span>
                </span>
                <span className={styles.title}>{shown}</span>
                {size === 'l' && t.p.shortDescription && <span className={styles.desc}>{t.p.shortDescription}</span>}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

export default memo(Mosaic)
