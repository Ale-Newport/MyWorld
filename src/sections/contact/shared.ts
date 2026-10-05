import { useEffect, useRef, useState } from 'react'
import { subscribe } from '@/lib/ticker'
import { portal } from '@/state/portal'
import type { ContactAnimationProps, Rect } from '../types'

/* ============================================================
   END OF JOURNEY — WHAT THE FIVE OPTIONS SHARE

   Every option draws on one canvas that fills the whole stage,
   under the closing words. This module holds what they have in
   common:

     · THE STAGE they compose for: the text-safe rectangles the
       chapter hands over, the bands the HUD and the portal's
       readout hold at the top and foot of the screen, and the
       closing words themselves (the "head"), found among the
       rectangles rather than assumed;
     · SIGNED DISTANCE to all of that, so geometry is laid out
       clear of the words at every point of its motion — it is
       never drawn over them and erased;
     · THE CANVAS: sized by a ResizeObserver at a capped pixel
       ratio, composed when the box, the words or the intensity
       change, painted from the shared ticker only while the stage
       is on screen, painted once and still under reduced motion,
       and faded out the moment the portal starts to charge — the
       garden's own leaves take over from there, and the words
       begin to lift past the margins they were measured with;
     · THE PALETTE, read from the tokens once per composition;
     · A QA HOOK. With `?qa-safe` in the address the composition
       is published on `window.__contactQA` and the last-resort
       guard below is switched off, so a check that samples the
       canvas inside the safe rectangles sees the geometry itself.
   ============================================================ */

export type { Rect }

export const TAU = Math.PI * 2
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** 0 → 1 across [a, b], eased at both ends. */
export function smooth(a: number, b: number, v: number) {
  const t = clamp01((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}
export const easeOut = (t: number) => 1 - (1 - t) * (1 - t) * (1 - t)
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/** A deterministic random stream (mulberry32): the same stage, the same drawing. */
export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ---------------------------------------------------------------
   THE STAGE
   --------------------------------------------------------------- */

export interface Stage {
  w: number
  h: number
  /** The text-safe rectangles, exactly as the chapter measured them. */
  safe: Rect[]
  /** Everything to stay clear of: `safe` plus the HUD's band above `top` and the foot below `foot`. */
  keep: Rect[]
  top: number
  foot: number
  /** The closing words (question and answer together), or null when there are none. */
  head: Rect | null
  /** The drawing's unit: 1 on a 900 px short side, from 0.42 on a phone to 1.6 on an ultrawide. */
  u: number
}

const area = (r: Rect) => r.w * r.h
function overlapArea(a: Rect, b: Rect) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}
export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

export function makeStage(w: number, h: number, given: Rect[]): Stage {
  const safe = given.filter((r) => r.w > 0 && r.h > 0 && Number.isFinite(r.x + r.y + r.w + r.h))
  const biggest = safe.reduce((m, r) => Math.max(m, area(r)), 0)
  const mid = (r: Rect) => r.y + r.h / 2
  /* The HUD sits above the corner labels, and the portal's readout
     and the HUD's foot below the lowest line of the chapter: neither
     is in `safe`, both are words. */
  const corners = safe.filter((r) => area(r) < biggest * 0.2 && mid(r) < h * 0.3)
  const top = Math.min(h * 0.22, corners.length ? Math.min(...corners.map((r) => r.y)) : Math.max(48, h * 0.08))
  const low = safe.filter((r) => mid(r) > h * 0.5)
  const foot = Math.max(h * 0.55, low.length ? Math.max(...low.map((r) => r.y + r.h)) : h - Math.max(80, h * 0.12))
  /* The closing words are the highest of the large boxes, together
     with whatever shares their place (the question and the answer
     are set in the same cell, one after the other) — not with the
     links, which only graze the answer's margin. */
  const large = safe.filter((r) => area(r) >= biggest * 0.2 && mid(r) > h * 0.12).sort((a, b) => mid(a) - mid(b))
  let head: Rect | null = large[0] ?? null
  if (head) {
    for (const r of large.slice(1)) {
      if (overlapArea(head, r) > Math.min(area(head), area(r)) * 0.6) head = union(head, r)
    }
  }
  const far = 1e5
  const keep = [...safe, { x: -far, y: -far, w: 2 * far + w, h: far + top }, { x: -far, y: foot, w: 2 * far + w, h: far }]
  return { w, h, safe, keep, top, foot, head, u: Math.min(1.6, Math.max(0.42, Math.min(w, h) / 900)) }
}

/** Signed distance from (x, y) to a rectangle: negative inside. */
export function sdRect(r: Rect, x: number, y: number) {
  const dx = Math.abs(x - r.x - r.w / 2) - r.w / 2
  const dy = Math.abs(y - r.y - r.h / 2) - r.h / 2
  const ox = dx > 0 ? dx : 0, oy = dy > 0 ? dy : 0
  return Math.sqrt(ox * ox + oy * oy) + Math.min(dx > dy ? dx : dy, 0)
}

/** Signed distance from (x, y) to the union of `rects`. */
export function sd(rects: Rect[], x: number, y: number) {
  let d = Infinity
  for (let i = 0; i < rects.length; i++) {
    const v = sdRect(rects[i], x, y)
    if (v < d) d = v
  }
  return d
}

/** A band of free ground across the stage: every point from (x0, y0) to (x1, y1) is at least the asked clearance from every rectangle. */
export interface Band { x0: number; x1: number; y0: number; y1: number }

/**
 * The largest band of free ground between the HUD and the foot: rows
 * whose longest clear run (at `clear` from every rectangle) spans at
 * least `minRun` of the width, taken together while their runs keep
 * overlapping by that much. Null when there is none — on a phone the
 * words can leave no room at all.
 */
export function freeBand(stage: Stage, clear: number, minRun = 0.55): Band | null {
  const { w, keep, top, foot } = stage
  const dx = 3, dy = 2
  let best: Band | null = null, bestArea = 0, cur: Band | null = null
  for (let y = top; y <= foot; y += dy) {
    let rx0 = 0, rx1 = -1, start = -1
    for (let x = 0; x <= w + dx; x += dx) {
      const ok = x <= w && sd(keep, x, y) >= clear
      if (ok && start < 0) start = x
      if (!ok && start >= 0) {
        if (x - dx - start > rx1 - rx0) { rx0 = start; rx1 = x - dx }
        start = -1
      }
    }
    const wide = rx1 - rx0 >= w * minRun
    cur = wide && cur && Math.min(cur.x1, rx1) - Math.max(cur.x0, rx0) >= w * minRun
      ? { x0: Math.max(cur.x0, rx0), x1: Math.min(cur.x1, rx1), y0: cur.y0, y1: y }
      : wide ? { x0: rx0, x1: rx1, y0: y, y1: y } : null
    if (cur && (cur.x1 - cur.x0) * (cur.y1 - cur.y0 + dy) > bestArea) {
      bestArea = (cur.x1 - cur.x0) * (cur.y1 - cur.y0 + dy)
      best = { ...cur }
    }
  }
  return best
}

/* ---------------------------------------------------------------
   ROUTES
   Cheapest paths over a grid of `cell` px, for anything that has to
   find its way through the free space: Dijkstra outward from the
   `from` points, so every cell learns its distance to them and the
   step that leads back. One field serves as many routes as end there.
   --------------------------------------------------------------- */

export interface Field {
  cols: number
  rows: number
  cell: number
  dist: Float64Array
  prev: Int32Array
}

export function field(w: number, h: number, cell: number, price: (x: number, y: number) => number, from: [number, number][]): Field {
  const cols = Math.ceil(w / cell) + 1, rows = Math.ceil(h / cell) + 1
  const n = cols * rows
  const cost = new Float32Array(n)
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) cost[j * cols + i] = price(i * cell, j * cell)
  // Doubles: a key rounded on its way into the array would read as stale on its way out of the heap.
  const dist = new Float64Array(n).fill(Infinity)
  const prev = new Int32Array(n).fill(-1)
  // A binary heap of (distance, cell), stale entries skipped on the way out.
  let keys = new Float64Array(1024), vals = new Int32Array(1024), size = 0
  const push = (k: number, v: number) => {
    if (size === keys.length) {
      const k2 = new Float64Array(size * 2), v2 = new Int32Array(size * 2)
      k2.set(keys); v2.set(vals); keys = k2; vals = v2
    }
    let i = size++
    while (i > 0) {
      const p = (i - 1) >> 1
      if (keys[p] <= k) break
      keys[i] = keys[p]; vals[i] = vals[p]; i = p
    }
    keys[i] = k; vals[i] = v
  }
  const pop = () => {
    const v = vals[0]
    const k = keys[--size], x = vals[size]
    let i = 0
    for (;;) {
      let c = 2 * i + 1
      if (c >= size) break
      if (c + 1 < size && keys[c + 1] < keys[c]) c++
      if (keys[c] >= k) break
      keys[i] = keys[c]; vals[i] = vals[c]; i = c
    }
    keys[i] = k; vals[i] = x
    return v
  }
  for (const [x, y] of from) {
    const i = Math.max(0, Math.min(cols - 1, Math.round(x / cell))), j = Math.max(0, Math.min(rows - 1, Math.round(y / cell)))
    const id = j * cols + i
    if (!Number.isFinite(cost[id])) continue
    dist[id] = 0
    push(0, id)
  }
  // (di, dj, length) for the eight neighbours.
  const D = [1, 0, 1, -1, 0, 1, 0, 1, 1, 0, -1, 1, 1, 1, Math.SQRT2, 1, -1, Math.SQRT2, -1, 1, Math.SQRT2, -1, -1, Math.SQRT2]
  while (size > 0) {
    const d0 = keys[0]
    const id = pop()
    if (d0 > dist[id]) continue
    const i = id % cols, j = (id - i) / cols
    for (let k = 0; k < D.length; k += 3) {
      const di = D[k], dj = D[k + 1]
      const ii = i + di, jj = j + dj
      if (ii < 0 || jj < 0 || ii >= cols || jj >= rows) continue
      const nid = jj * cols + ii
      const c = cost[nid]
      if (!Number.isFinite(c)) continue
      const nd = d0 + D[k + 2] * (c + cost[id]) * 0.5
      if (nd < dist[nid]) {
        dist[nid] = nd
        prev[nid] = id
        push(nd, nid)
      }
    }
  }
  return { cols, rows, cell, dist, prev }
}

/** The cell nearest (x, y). */
export const cellAt = (f: Field, x: number, y: number) =>
  Math.max(0, Math.min(f.rows - 1, Math.round(y / f.cell))) * f.cols + Math.max(0, Math.min(f.cols - 1, Math.round(x / f.cell)))

/** The route from cell `id` back to where the field started, as points; smoothed by `smoothing` rounds of corner cutting. */
export function routeFrom(f: Field, id: number, smoothing = 3): [number, number][] {
  const pts: [number, number][] = []
  for (let k = id, guard = 0; k >= 0 && guard < f.cols * f.rows; k = f.prev[k], guard++) {
    const i = k % f.cols
    pts.push([i * f.cell, ((k - i) / f.cols) * f.cell])
  }
  let p = pts
  for (let r = 0; r < smoothing && p.length > 2; r++) {
    const q: [number, number][] = [p[0]]
    for (let k = 0; k < p.length - 1; k++) {
      const [x0, y0] = p[k], [x1, y1] = p[k + 1]
      q.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25], [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75])
    }
    q.push(p[p.length - 1])
    p = q
  }
  return p
}

/** Resamples a polyline every `step` px: positions, and headings taken across each point's neighbours. */
export function resample(pts: [number, number][], step: number) {
  const xs: number[] = [], ys: number[] = [], as: number[] = []
  if (pts.length < 2) return { xs, ys, as }
  const cum = [0]
  for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]))
  const total = cum[cum.length - 1]
  for (let s = 0, k = 0; s <= total + 1e-6; s += step) {
    while (k < pts.length - 2 && cum[k + 1] < s) k++
    const f = Math.min(1, Math.max(0, (s - cum[k]) / (cum[k + 1] - cum[k] || 1)))
    xs.push(lerp(pts[k][0], pts[k + 1][0], f))
    ys.push(lerp(pts[k][1], pts[k + 1][1], f))
  }
  // And the end itself, however short the last step.
  const [ex, ey] = pts[pts.length - 1]
  if (Math.hypot(ex - xs[xs.length - 1], ey - ys[ys.length - 1]) > 0.5) { xs.push(ex); ys.push(ey) }
  for (let i = 0; i < xs.length; i++) {
    const a = Math.max(0, i - 1), b = Math.min(xs.length - 1, i + 1)
    as.push(Math.atan2(ys[b] - ys[a], xs[b] - xs[a]))
  }
  return { xs, ys, as }
}

/* ---------------------------------------------------------------
   THE PALETTE (src/styles/tokens.css)
   --------------------------------------------------------------- */

const TOKENS = {
  ink: ['--ink', '#1a1712'],
  ink2: ['--ink-2', '#443d31'],
  ink3: ['--ink-3', '#675e4f'],
  ink4: ['--ink-4', '#8b816f'],
  accent: ['--accent', '#bf4f27'],
  signal: ['--signal', '#2f6f5e'],
  bg: ['--bg-primary', '#f6f0e6'],
  bg2: ['--bg-secondary', '#efe7da'],
  bg3: ['--bg-tertiary', '#e6dccc'],
  deep: ['--nature-deep', '#22392e'],
  forest: ['--nature-forest', '#34513f'],
  palm: ['--nature-palm', '#47654a'],
  olive: ['--nature-olive', '#6a6f47'],
  fresh: ['--nature-fresh', '#7d9a58'],
  lime: ['--nature-lime', '#a2b06a'],
  stem: ['--nature-stem', '#6b5942'],
  stem2: ['--nature-stem-2', '#8d7659'],
  bloom: ['--ground-bloom', '#f0c090'],
  world: ['--world2-ground', '#dce3dc'],
} as const

export type RGB = [number, number, number]
export type Palette = Record<keyof typeof TOKENS, RGB>

function hex(v: string): RGB | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim())
  if (!m) return null
  const s = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
}

export function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement)
  const out = {} as Palette
  for (const [k, [name, fallback]] of Object.entries(TOKENS) as [keyof Palette, readonly [string, string]][]) {
    out[k] = hex(cs.getPropertyValue(name)) ?? (hex(fallback) as RGB)
  }
  return out
}

const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const gam = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function toLab([r, g, b]: RGB): RGB {
  const R = lin(r), G = lin(g), B = lin(b)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

function fromLab([L, A, B]: RGB): RGB {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, gam(v))))
  return [c(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), c(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), c(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)]
}

/** `color-mix(in oklab, b t, a)`: t of `b` into `a`, as the tokens mix. */
export function mix(a: RGB, b: RGB, t: number): RGB {
  const p = toLab(a), q = toLab(b)
  return fromLab([lerp(p[0], q[0], t), lerp(p[1], q[1], t), lerp(p[2], q[2], t)])
}

export const css = (c: RGB, alpha = 1) => (alpha >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${+alpha.toFixed(3)})`)

/* ---------------------------------------------------------------
   THE CANVAS
   --------------------------------------------------------------- */

export interface Frame {
  /** The chapter's scroll progress (1 under reduced motion: the arrangement assembled). */
  p: number
  /** The option's own clock in seconds, already multiplied by `speed`. */
  t: number
  /** The one composed still frame of reduced motion: nothing sways, drifts or travels. */
  still: boolean
}

export interface Painter<S> {
  compose(stage: Stage, intensity: number, pal: Palette): S
  draw(ctx: CanvasRenderingContext2D, scene: S, frame: Frame): void
}

export interface ContactQA {
  id: string
  safe: Rect[]
  keep: Rect[]
  canvas: HTMLCanvasElement
  w: number
  h: number
  paints: number
  /** Milliseconds spent drawing, over all paints. */
  ms: number
  /** The progress of the last paint. */
  p: number
  /** Milliseconds the last composition took. */
  composeMs: number
  scene: unknown
}

/** The charge at which the drawing is gone: the canopy is only beginning, and the words have not yet lifted past their margins. */
const PULL_GONE = 0.12
/** Device pixels a canvas may hold before its ratio is lowered (a 2560 × 1440 box at 2× would be 14.7 M). */
const MAX_PIXELS = 8.5e6

function pixelRatio(w: number, h: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  return Math.max(0.75, Math.min(dpr, Math.sqrt(MAX_PIXELS / Math.max(1, w * h))))
}

type QAWindow = Window & { __contactQA?: ContactQA }
const qaMode = () => new URLSearchParams(window.location.search).has('qa-safe')
/** In QA mode only, `?qa-intensity=` and `?qa-speed=` stand in for the administrator's knobs, so a check can try their extremes. */
function qaKnob(name: string): number | null {
  const q = new URLSearchParams(window.location.search)
  const v = q.has('qa-safe') && q.has(name) ? Number(q.get(name)) : NaN
  return Number.isFinite(v) ? v : null
}

const rootStyle = { position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' } as const
const canvasStyle = { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' } as const

/**
 * Runs a painter on a canvas that fills the option's box: returns the
 * root's props. Composition happens when the box, the words or the
 * intensity change; painting happens on the shared ticker while
 * `active`, once otherwise.
 */
export function useContactCanvas<S>(id: string, props: ContactAnimationProps, painter: Painter<S>) {
  const { progress, active, reducedMotion, intensity, speed, safe, safeVersion } = props
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [box, setBox] = useState<{ w: number; h: number; dpr: number } | null>(null)
  const live = useRef({ t: 0, paint: () => {} })

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    let w = 0, h = 0
    const update = () => {
      const dpr = pixelRatio(w, h)
      setBox((b) => (b && b.w === w && b.h === h && b.dpr === dpr ? b : w > 0 && h > 0 ? { w, h, dpr } : null))
    }
    const ro = new ResizeObserver((entries) => {
      const r = entries[entries.length - 1].contentRect
      w = Math.round(r.width)
      h = Math.round(r.height)
      update()
    })
    ro.observe(el)
    // A window dragged to a screen of another density.
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    mq.addEventListener('change', update)
    return () => {
      ro.disconnect()
      mq.removeEventListener('change', update)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !box) return
    const lv = live.current
    canvas.width = Math.max(1, Math.round(box.w * box.dpr))
    canvas.height = Math.max(1, Math.round(box.h * box.dpr))
    const c0 = performance.now()
    const stage = makeStage(box.w, box.h, safe.current)
    const scene = painter.compose(stage, Math.min(1, Math.max(0, qaKnob('qa-intensity') ?? intensity)), readPalette())
    const win = window as QAWindow
    const record: ContactQA | null = qaMode() ? { id, safe: stage.safe, keep: stage.keep, canvas, w: box.w, h: box.h, paints: 0, ms: 0, p: 0, composeMs: performance.now() - c0, scene } : null
    if (record) win.__contactQA = record
    let shown = -1
    const paint = () => {
      const fade = reducedMotion ? 1 : 1 - smooth(0, PULL_GONE, portal.pull)
      if (fade !== shown) {
        shown = fade
        canvas.style.opacity = fade < 1 ? fade.toFixed(3) : ''
        canvas.style.visibility = fade > 0 ? '' : 'hidden'
      }
      if (fade <= 0) return
      const t0 = record ? performance.now() : 0
      ctx.setTransform(box.dpr, 0, 0, box.dpr, 0, 0)
      ctx.clearRect(0, 0, box.w, box.h)
      const p = reducedMotion ? 1 : progress.current
      painter.draw(ctx, scene, { p, t: lv.t, still: reducedMotion })
      // The geometry already keeps clear of the words; this only
      // guarantees it while a resize is still being measured.
      if (!record) for (const r of stage.safe) ctx.clearRect(r.x, r.y, r.w, r.h)
      else {
        record.paints++
        record.ms += performance.now() - t0
        record.p = p
      }
    }
    lv.paint = paint
    paint()
    return () => {
      lv.paint = () => {}
      if (record && win.__contactQA === record) delete win.__contactQA
    }
  }, [box, safe, safeVersion, intensity, reducedMotion, progress, painter, id])

  // The canvas's pixels go with it, rather than whenever it is collected.
  useEffect(() => {
    const canvas = canvasRef.current
    return () => {
      if (!canvas) return
      canvas.width = 0
      canvas.height = 0
    }
  }, [])

  useEffect(() => {
    if (!active || reducedMotion) return
    const lv = live.current
    const rate = qaKnob('qa-speed') ?? speed
    return subscribe((dt) => {
      lv.t += dt * rate
      lv.paint()
    })
  }, [active, reducedMotion, speed])

  return { rootRef, canvasRef, rootStyle, canvasStyle }
}
