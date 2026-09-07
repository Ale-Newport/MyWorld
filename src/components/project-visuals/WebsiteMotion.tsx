'use client'

/**
 * WebsiteMotion — the motion graphic for the Fuerteventura 2000 Vue
 * prototype, and the stand-in visual for the client-site programme.
 *
 * A browser wireframe drawn to scale on a pixel rail. The nav carries one
 * pill per registered route; picking one traces the routed path from the
 * pill down into <router-view/>, slides the mounted view out to the left
 * and draws the new one in from the right. The URL in the chrome bar swaps
 * without a reload and the history stack gains an entry — which is the
 * whole of what createWebHistory buys you.
 *
 * The second axis is width. The frame's right edge rides a ruler marked
 * with Tailwind's own min-width breakpoints (md 768, lg 1024). Drag it and
 * the grid reflows underneath: three columns above lg, two above md, one
 * below. The nav concertinas into a burger, the page gets longer, and the
 * scroll gauge inside the right edge shortens to say so. The reflow is
 * damped rather than switched, so it lags the edge slightly and settles —
 * the reflow is the point, so it is given weight.
 *
 * Timeline (0..1):
 *   0.00  /        mounted at 1280px — pills out, three columns
 *   0.33  /COURSES the frame crossing lg — three columns folding to two
 *   0.66  /GALLERY at 390px — nav collapsed to a burger, one column,
 *         the page twice as long and the gauge saying so
 *   1.00  /CONTACT expanded back to 1280px, pills unfolded, form beside list
 *
 * Reduced motion holds /COURSES at 820px: the two-column layout solid, the
 * three-column slots it reflowed out of ghosted behind it, the routed path
 * traced from the pill, the gauge and the breakpoint ruler read.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useCanvas2D } from '@/hooks/useCanvas2D'
import { clamp, damp, easeInOutCubic, easeOutCubic, lerp, range, seeded } from '@/lib/math'
import type { Project } from '@/content/types'
import { readPalette, type ProjectVisualProps, type VisualPalette } from './types'
import styles from './visual.module.css'

/* ---------------------------------------------------------------- device rail */

/** The ruler runs 0…DEV_MAX CSS pixels; the frame's width is drawn to scale. */
const DEV_MAX = 1440
const DEV_MIN = 330
const DESK = 1280
const TAB = 820
const MOB = 390
const SNAPS: number[] = [MOB, TAB, DESK]

/** The three widths the drag settles onto, and what each one costs you. */
const BREAKPOINTS: { label: string; dev: number; cols: number }[] = [
  { label: 'DESKTOP', dev: DESK, cols: 3 },
  { label: 'TABLET', dev: TAB, cols: 2 },
  { label: 'MOBILE', dev: MOB, cols: 1 },
]

/** Tailwind's own min-width breakpoints — this prototype was built on it. */
const BP_MD = 768
const BP_LG = 1024

const colsFor = (dev: number): number => (dev >= BP_LG ? 3 : dev >= BP_MD ? 2 : 1)

/* -------------------------------------------------------------------- routes */

type Kind = 'hero' | 'media' | 'text' | 'form' | 'list' | 'stat'

interface Block {
  /** Column span on the three-column desktop grid. */
  span: number
  /** Height, in row units. */
  h: number
  kind: Kind
}

interface RouteDef {
  path: string
  label: string
  blocks: Block[]
}

const blk = (span: number, h: number, kind: Kind): Block => ({ span, h, kind })

/** Six routes, eighteen blocks — one block per single-file component. */
const ROUTES: RouteDef[] = [
  { path: '/', label: 'HOME', blocks: [
    blk(3, 1.5, 'hero'), blk(1, 1.05, 'text'), blk(1, 1.05, 'text'), blk(1, 1.05, 'text'),
  ] },
  { path: '/ABOUT', label: 'ABOUT', blocks: [
    blk(2, 1.4, 'media'), blk(1, 1.4, 'text'), blk(3, 0.9, 'text'),
  ] },
  { path: '/COURSES', label: 'COURSES', blocks: [
    blk(3, 0.6, 'stat'), blk(1, 1.5, 'media'), blk(1, 1.5, 'media'), blk(1, 1.5, 'media'),
  ] },
  { path: '/TEAM', label: 'TEAM', blocks: [
    blk(1, 2.1, 'media'), blk(1, 2.1, 'media'), blk(1, 2.1, 'media'),
  ] },
  { path: '/GALLERY', label: 'GALLERY', blocks: [
    blk(2, 2.3, 'media'), blk(1, 2.3, 'media'),
  ] },
  { path: '/CONTACT', label: 'CONTACT', blocks: [
    blk(2, 2.4, 'form'), blk(1, 2.4, 'list'),
  ] },
]

/* ------------------------------------------------------------------ packing */

/** Gutter between rows, in row units. */
const GAP_ROW = 0.17

interface Slot {
  /** Fraction of the content width. */
  x: number
  w: number
  /** Row units from the top of the page. */
  y: number
  h: number
}

interface Packed {
  slots: Slot[]
  height: number
}

/** Shelf-pack a route into `cols` columns. Spans clamp, exactly as utility
 *  classes do: a three-wide block is full width at every breakpoint. */
function pack(blocks: Block[], cols: number): Packed {
  const slots: Slot[] = []
  let cx = 0
  let cy = 0
  let rowH = 0
  for (let i = 0; i < blocks.length; i += 1) {
    const b = blocks[i]
    const span = Math.min(b.span, cols)
    if (cx + span > cols) {
      cy += rowH + GAP_ROW
      cx = 0
      rowH = 0
    }
    slots.push({ x: cx / cols, w: span / cols, y: cy, h: b.h })
    if (b.h > rowH) rowH = b.h
    cx += span
  }
  return { slots, height: cy + rowH }
}

/** [route][0=3col, 1=2col, 2=1col] — built once, never in the loop. */
const PACKED: Packed[][] = ROUTES.map((r) => [pack(r.blocks, 3), pack(r.blocks, 2), pack(r.blocks, 1)])

const MAX_DESK_H = PACKED.reduce((m, p) => Math.max(m, p[0].height), 0)

/** Where each route's blocks start in the component ledger. */
const LEDGER_BASE: number[] = []
{
  let acc = 0
  for (let i = 0; i < ROUTES.length; i += 1) {
    LEDGER_BASE.push(acc)
    acc += ROUTES[i].blocks.length
  }
}
/** Deterministic skeleton line lengths. Seeded once; SSR and client agree. */
const RW = new Float32Array(96)
{
  const rnd = seeded(0x77a3f1)
  for (let i = 0; i < RW.length; i += 1) RW[i] = 0.4 + rnd() * 0.52
}
const rw = (si: number, k: number): number => RW[(si * 4 + k) % RW.length]

/* ------------------------------------------------------------------- beats */

interface Beat {
  route: number
  from: number
  dev: number
  prevDev: number
  drawer: boolean
  /** Where in the beat the route swap begins. */
  transStart: number
  depth: number
  weight: number
  t0: number
  t1: number
}

const TRANS_SPAN = 0.5
const TRANS_SECS = 0.78

const BEATS: Beat[] = (() => {
  const raw: { r: number; dev: number; drawer?: boolean; w: number }[] = [
    { r: 0, dev: DESK, w: 1.0 },
    { r: 2, dev: DESK, w: 1.15 },
    { r: 2, dev: TAB, w: 1.0 },
    { r: 4, dev: TAB, w: 1.0 },
    { r: 4, dev: MOB, w: 1.1 },
    { r: 5, dev: MOB, drawer: true, w: 1.35 },
    { r: 5, dev: DESK, w: 1.05 },
  ]
  const out: Beat[] = []
  let depth = 1
  let total = 0
  for (let i = 0; i < raw.length; i += 1) {
    const prev = raw[(i - 1 + raw.length) % raw.length]
    const drawer = raw[i].drawer === true
    if (raw[i].r !== prev.r) depth += 1
    out.push({
      route: raw[i].r,
      from: prev.r,
      dev: raw[i].dev,
      prevDev: prev.dev,
      drawer,
      transStart: drawer ? 0.4 : 0.02,
      depth: Math.min(depth, 9),
      weight: raw[i].w,
      t0: 0,
      t1: 0,
    })
    total += raw[i].w
  }
  let acc = 0
  for (let i = 0; i < out.length; i += 1) {
    out[i].t0 = acc / total
    acc += out[i].weight
    out[i].t1 = acc / total
  }
  return out
})()

const TOTAL_W = BEATS.reduce((s, b) => s + b.weight, 0)
const LAST_BEAT = BEATS.length - 1

function beatAt(clock: number): number {
  let i = 0
  while (i < LAST_BEAT && clock >= BEATS[i].t1) i += 1
  return i
}

/** The frame reduced motion freezes on: /COURSES at 820px, reflow settled. */
const STATIC_CLOCK = BEATS[2].t0 + (BEATS[2].t1 - BEATS[2].t0) * 0.82

/* ------------------------------------------------------------------ layout */

interface Layout {
  w: number
  h: number
  hud: boolean
  ledger: boolean
  detail: boolean
  /** The device rail: x0…x1 spans 0…DEV_MAX device pixels. */
  x0: number
  x1: number
  rail: number
  frameY: number
  frameH: number
  chromeH: number
  navH: number
  /** The channel between the nav row and the content, where routes travel. */
  chan: number
  padIn: number
  rowUnit: number
  showRuler: boolean
  rulerY: number
  ledgerY: number
  fontMicro: string
  fontNano: string
}

function computeLayout(w: number, h: number, hud: boolean, ledger: boolean): Layout {
  const padX = clamp(w * 0.055, 10, 40)
  const padTop = clamp(h * 0.055, 8, 20) + (hud ? 16 : 0)
  const padBot = clamp(h * 0.045, 6, 16) + (hud ? 26 : 0)
  const x0 = padX
  const x1 = Math.max(padX + 40, w - padX)
  const avail = Math.max(56, h - padTop - padBot)
  const detail = w >= 330 && h >= 190
  const showRuler = avail > 118
  const showLedger = ledger && avail > 188 && w >= 300
  const rulerH = showRuler ? 24 : 0
  const ledgerH = showLedger ? 17 : 0
  const frameH = Math.max(54, avail - rulerH - ledgerH)
  const frameY = padTop

  const micro = clamp(Math.round(Math.min(w, h) * 0.028), 8, 11)
  const nano = Math.max(7, micro - 1)
  const chromeH = clamp(frameH * 0.13, 13, 22)
  const navH = clamp(frameH * 0.12, 12, 20)
  const chan = clamp(frameH * 0.032, 4, 12)
  const padIn = clamp(frameH * 0.032, 4, 9)
  const contentH = Math.max(20, frameH - chromeH - navH - chan - padIn)

  return {
    w, h, hud, detail, x0, x1, frameY, frameH, chromeH, navH, chan, padIn, showRuler,
    ledger: showLedger,
    rail: (x1 - x0) / DEV_MAX,
    // The tallest desktop page fills the frame; every other page is measured
    // against it, so a one-column reflow visibly runs off the bottom.
    rowUnit: (contentH * 0.94) / MAX_DESK_H,
    rulerY: frameY + frameH + 15,
    ledgerY: frameY + frameH + rulerH + 11,
    fontMicro: `${micro}px ui-monospace, monospace`,
    fontNano: `${nano}px ui-monospace, monospace`,
  }
}

/* --------------------------------------------------------------- utilities */

const DASH: number[] = [2, 3]
const DASH_FINE: number[] = [1.5, 2.5]
const NODASH: number[] = []

function metricValue(project: Project | undefined, label: string, fallback: number): number {
  const found = project?.metrics.find((m) => m.label === label)
  return typeof found?.numeric === 'number' ? found.numeric : fallback
}

function samePalette(a: VisualPalette, b: VisualPalette): boolean {
  return (
    a.ink === b.ink &&
    a.inkSoft === b.inkSoft &&
    a.inkFaint === b.inkFaint &&
    a.bg === b.bg &&
    a.accent === b.accent &&
    a.signal === b.signal
  )
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  if (w <= 0.3) return
  ctx.fillRect(x, y, w, Math.max(0.75, h))
}

/** Stroke and fill state in one call — this file changes pen constantly. */
function pen(ctx: CanvasRenderingContext2D, colour: string, alpha: number, width = 0.75): void {
  ctx.globalAlpha = alpha
  ctx.strokeStyle = colour
  ctx.lineWidth = width
}

function nib(ctx: CanvasRenderingContext2D, colour: string, alpha: number, font?: string): void {
  ctx.globalAlpha = alpha
  ctx.fillStyle = colour
  if (font) ctx.font = font
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
  ctx.stroke()
}

/* ------------------------------------------------------- skeleton contents */

/** The inside of one block. `p` wipes it in from the left. */
function drawSkeleton(
  ctx: CanvasRenderingContext2D, pal: VisualPalette, kind: Kind, si: number,
  x: number, y: number, w: number, h: number, p: number, a: number,
): void {
  if (w < 8 || h < 8 || a <= 0.012 || p <= 0.02) return
  const soft = pal.inkSoft
  const faint = pal.inkFaint
  const pad = Math.min(w * 0.1, h * 0.15, 9)
  const ix = x + pad
  const iy = y + pad
  const iw = Math.max(2, w - pad * 2)
  const ih = Math.max(2, h - pad * 2)
  const lh = clamp(ih * 0.055, 1, 2)
  ctx.fillStyle = soft

  switch (kind) {
    case 'hero': {
      ctx.globalAlpha = a * 0.8
      bar(ctx, ix, iy, iw * 0.58 * p, lh * 2.3)
      ctx.globalAlpha = a * 0.42
      bar(ctx, ix, iy + ih * 0.36, iw * rw(si, 0) * p, lh)
      bar(ctx, ix, iy + ih * 0.36 + lh * 3.4, iw * rw(si, 1) * 0.86 * p, lh)
      ctx.globalAlpha = a * 0.55 * range(p, 0.55, 0.95)
      ctx.strokeStyle = soft
      ctx.lineWidth = 0.75
      ctx.strokeRect(ix, iy + ih * 0.76, Math.max(6, iw * 0.19), Math.max(4, ih * 0.18))
      break
    }
    case 'text': {
      ctx.globalAlpha = a * 0.68
      bar(ctx, ix, iy, iw * 0.44 * p, lh * 1.7)
      ctx.globalAlpha = a * 0.38
      const step = Math.min(lh * 3.1, ih * 0.2)
      for (let k = 0; k < 3; k += 1) {
        bar(ctx, ix, iy + ih * 0.34 + k * step, iw * rw(si, k) * p, lh)
      }
      break
    }
    case 'stat': {
      ctx.globalAlpha = a * 0.6
      bar(ctx, ix + iw * 0.5 - iw * 0.17 * p, iy + ih * 0.24, iw * 0.34 * p, lh * 1.6)
      ctx.globalAlpha = a * 0.3
      bar(ctx, ix + iw * 0.5 - iw * 0.3 * p, iy + ih * 0.66, iw * 0.6 * p, lh * 0.8)
      break
    }
    case 'media': {
      ctx.globalAlpha = a * 0.34
      ctx.strokeStyle = faint
      ctx.lineWidth = 0.75
      const my = iy
      const mh = Math.max(4, ih * 0.68)
      line(ctx, ix, my + mh, lerp(ix, ix + iw, p), lerp(my + mh, my, p))
      line(ctx, ix, my, lerp(ix, ix + iw, p), lerp(my, my + mh, p))
      ctx.globalAlpha = a * 0.45
      ctx.fillStyle = soft
      bar(ctx, ix, my + mh + Math.max(4, ih * 0.14), iw * rw(si, 2) * 0.8 * p, lh)
      break
    }
    case 'form': {
      ctx.globalAlpha = a * 0.6
      bar(ctx, ix, iy, iw * 0.36 * p, lh * 1.7)
      ctx.strokeStyle = faint
      ctx.lineWidth = 0.75
      const fh = Math.max(4, ih * 0.15)
      for (let k = 0; k < 3; k += 1) {
        ctx.globalAlpha = a * 0.42 * clamp(p * 3 - k * 0.7)
        ctx.strokeRect(ix, iy + ih * 0.3 + k * (fh + Math.max(3, ih * 0.06)), iw * 0.92, fh)
      }
      ctx.globalAlpha = a * 0.7 * range(p, 0.6, 1)
      ctx.fillStyle = soft
      bar(ctx, ix, iy + ih - fh, Math.max(6, iw * 0.3), fh)
      break
    }
    case 'list': {
      const step = ih / 4.4
      for (let k = 0; k < 4; k += 1) {
        const ly = iy + step * (k + 0.35)
        ctx.globalAlpha = a * 0.45 * clamp(p * 2.2 - k * 0.3)
        ctx.fillStyle = soft
        ctx.beginPath()
        ctx.arc(ix + 2, ly, 1.4, 0, Math.PI * 2)
        ctx.fill()
        bar(ctx, ix + 7, ly - lh * 0.5, (iw - 9) * rw(si, k) * p, lh)
      }
      break
    }
  }
}

/* --------------------------------------------------------------- one view */

/** The content rectangle, mutated in place each frame — never reallocated. */
interface View {
  vx: number
  vy: number
  vw: number
  vh: number
  gut: number
  rowUnit: number
}

/** Draw a route's grid. `reveal` wipes blocks in, `exit` slides them out —
 *  one code path, both directions, staggered so the grid moves as a body. */
function drawView(
  ctx: CanvasRenderingContext2D, V: View, pal: VisualPalette,
  route: number, i0: number, i1: number, f: number,
  reveal: number, exit: number, alpha: number,
): void {
  const { vx, vy, vw, vh, gut, rowUnit } = V
  const blocks = ROUTES[route].blocks
  const n = blocks.length
  const stag = Math.min(0.1, 0.45 / Math.max(1, n - 1))
  const spanF = stag * (n - 1)
  const shift = vw * 0.32
  const a0 = PACKED[route][i0].slots
  const a1 = PACKED[route][i1].slots

  for (let i = 0; i < n; i += 1) {
    const pin = clamp(reveal * (1 + spanF) - i * stag)
    const pout = clamp(exit * (1 + spanF) - i * stag)
    const a = alpha * pin * (1 - pout)
    if (a <= 0.012) continue

    const sx = lerp(a0[i].x, a1[i].x, f)
    const sw = lerp(a0[i].w, a1[i].w, f)
    const sy = lerp(a0[i].y, a1[i].y, f)
    const sh = lerp(a0[i].h, a1[i].h, f)

    const ox = -shift * easeInOutCubic(pout) + shift * 0.85 * (1 - easeOutCubic(pin))
    const bx = vx + sx * vw + gut * 0.5 + ox
    const by = vy + sy * rowUnit
    const bw = Math.max(3, sw * vw - gut)
    const bh = Math.max(3, sh * rowUnit)
    if (by > vy + vh) continue

    // Below the fold, the page keeps going — it just stops being lit.
    const fade = 1 - 0.78 * range(by, vy + vh * 0.8, vy + vh)
    const av = a * fade
    if (av <= 0.012) continue

    pen(ctx, pal.inkFaint, av * 0.62)
    ctx.strokeRect(bx, by, bw, bh)

    // The drawing head: the leading edge of a block still being drawn in.
    if (pin < 0.999) {
      pen(ctx, pal.accent, av * (1 - pin) * 0.9, 1.2)
      line(ctx, bx, by, bx, by + bh)
    }

    drawSkeleton(ctx, pal, blocks[i].kind, LEDGER_BASE[route] + i, bx, by, bw, bh, pin, av)
  }
}

/* ------------------------------------------------------------- interaction */

interface Hit {
  /** route*4 → x, y, w, h of each pill, drawer row etc. as last drawn. */
  pill: Float32Array
  drawer: Float32Array
  burger: Float32Array
  /** Four points of the routed path, as x,y pairs. */
  trace: Float32Array
  handleX: number
  frameTop: number
  frameBot: number
  collapsed: number
  drawerOpen: number
  /** Canvas px per device px, and the rail origin — pointer x → device width. */
  rail: number
  x0: number
  rulerY: number
}

type Zone = 'none' | 'handle' | 'pill' | 'burger' | 'drawer'

function hitPill(arr: Float32Array, n: number, x: number, y: number): number {
  for (let i = 0; i < n; i += 1) {
    const px = arr[i * 4]
    const pw = arr[i * 4 + 2]
    if (pw <= 0.5) continue
    const py = arr[i * 4 + 1]
    const ph = arr[i * 4 + 3]
    if (x >= px - 3 && x <= px + pw + 3 && y >= py - 3 && y <= py + ph + 3) return i
  }
  return -1
}

/* ------------------------------------------------------------- the component */

export function WebsiteMotion(props: ProjectVisualProps) {
  const { project, progress, reducedMotion = false, interactive = true, className } = props
  const hud = interactive !== false

  const nRoutes = useMemo(
    () => clamp(Math.round(metricValue(project, 'Routes', ROUTES.length)), 3, ROUTES.length),
    [project],
  )
  const compCount = useMemo(() => Math.round(metricValue(project, 'Components', 0)), [project])
  /** Ledger ticks: one per block of every route actually in the nav. */
  const ledgerTicks = useMemo(
    () => LEDGER_BASE[nRoutes - 1] + ROUTES[nRoutes - 1].blocks.length,
    [nRoutes],
  )
  const period = useMemo(
    () => TOTAL_W * clamp((project?.presentation.duration ?? 12) / BEATS.length, 1.15, 2.2),
    [project],
  )

  const [bpIdx, setBpIdx] = useState(2)
  const readoutRef = useRef<HTMLDivElement>(null)

  const layoutRef = useRef<Layout | null>(null)
  const paletteRef = useRef<VisualPalette | null>(null)
  const paletteAtRef = useRef(-1)
  const clockRef = useRef(reducedMotion ? STATIC_CLOCK : 0)
  const firstRef = useRef(true)
  const dirtyRef = useRef(true)

  // Continuous, damped state — this is what gives the reflow its weight.
  const devRef = useRef(DESK)
  const devTargetRef = useRef(DESK)
  const mixRef = useRef(0)
  const navMixRef = useRef(0)
  const drawerRef = useRef(0)

  // Manual (clicked / dragged) state.
  const manualRef = useRef(false)
  const routeRef = useRef(0)
  const fromRouteRef = useRef(0)
  const transRef = useRef(1)
  const drawerOpenRef = useRef(false)
  const histRef = useRef(1)
  const dragRef = useRef(false)
  const zoneRef = useRef<Zone>('none')
  const bpShownRef = useRef(2)
  const pathShownRef = useRef('')

  const viewRef = useRef<View>({ vx: 0, vy: 0, vw: 0, vh: 0, gut: 0, rowUnit: 1 })
  const hitRef = useRef<Hit>({
    pill: new Float32Array(ROUTES.length * 4),
    drawer: new Float32Array(ROUTES.length * 4),
    burger: new Float32Array(4),
    trace: new Float32Array(8),
    handleX: 0, frameTop: 0, frameBot: 0, collapsed: 0, drawerOpen: 0,
    rail: 1, x0: 0, rulerY: 0,
  })

  const ref = useCanvas2D<HTMLCanvasElement>({
    setup: ({ ctx, w, h }) => {
      layoutRef.current = computeLayout(w, h, hud, compCount > 0)
      paletteRef.current = readPalette(ctx.canvas)
      paletteAtRef.current = -1
      firstRef.current = true
      dirtyRef.current = true
    },

    draw: ({ ctx, w, h, t, dt }) => {
      let L = layoutRef.current
      if (!L || L.w !== w || L.h !== h || L.hud !== hud) {
        L = computeLayout(w, h, hud, compCount > 0)
        layoutRef.current = L
        firstRef.current = true
        dirtyRef.current = true
      }

      // getComputedStyle is not free — poll rather than read every frame.
      let palette = paletteRef.current
      if (!palette || t - paletteAtRef.current > 0.5) {
        const next = readPalette(ctx.canvas)
        if (!palette || !samePalette(palette, next)) {
          dirtyRef.current = true
          palette = next
          paletteRef.current = next
        }
        paletteAtRef.current = t
      }
      const { ink, inkSoft, inkFaint, bg, accent, signal } = palette

      /* ---- clock, route and width ---------------------------------------- */

      let route = routeRef.current
      let from = fromRouteRef.current
      let trans = transRef.current
      let drawerTarget = drawerOpenRef.current ? 1 : 0
      let depth = histRef.current

      if (manualRef.current) {
        if (!reducedMotion && trans < 1) {
          trans = Math.min(1, trans + dt / TRANS_SECS)
          transRef.current = trans
          dirtyRef.current = true
        }
        if (reducedMotion) {
          trans = 1
          transRef.current = 1
        }
        const target = clamp(devTargetRef.current, DEV_MIN, DEV_MAX)
        devRef.current = reducedMotion ? target : damp(devRef.current, target, dragRef.current ? 26 : 11, dt)
        if (Math.abs(devRef.current - target) > 0.4) dirtyRef.current = true
      } else {
        let clock: number
        if (reducedMotion) {
          clock = STATIC_CLOCK
        } else if (typeof progress === 'number') {
          const p = clamp(progress) * 0.99999
          clock = firstRef.current ? p : damp(clockRef.current, p, 13, dt)
        } else {
          clock = (clockRef.current + dt / period) % 1
        }
        clockRef.current = clock

        const b = BEATS[beatAt(clock)]
        const u = clamp((clock - b.t0) / (b.t1 - b.t0))
        route = Math.min(b.route, nRoutes - 1)
        from = Math.min(b.from, nRoutes - 1)
        trans = route === from ? 1 : clamp((u - b.transStart) / TRANS_SPAN)
        depth = b.depth
        drawerTarget = b.drawer
          ? Math.min(easeOutCubic(range(u, 0.05, 0.26)), 1 - easeInOutCubic(range(u, 0.44, 0.62)))
          : 0
        devRef.current = lerp(b.prevDev, b.dev, easeInOutCubic(range(u, 0.03, 0.55)))
        routeRef.current = route
        fromRouteRef.current = from
        transRef.current = trans
        histRef.current = depth
      }

      const dev = devRef.current
      const cols = colsFor(dev)
      const layoutTarget = 3 - cols

      if (reducedMotion) {
        mixRef.current = layoutTarget
        navMixRef.current = cols === 1 ? 1 : 0
        drawerRef.current = 0
      } else {
        // The grid lags the frame edge, then settles — a reflow with weight.
        const mNext = damp(mixRef.current, layoutTarget, 8.5, dt)
        const nNext = damp(navMixRef.current, cols === 1 ? 1 : 0, 9, dt)
        const dNext = manualRef.current ? damp(drawerRef.current, drawerTarget, 13, dt) : drawerTarget
        if (
          Math.abs(mNext - mixRef.current) > 0.0008 ||
          Math.abs(nNext - navMixRef.current) > 0.0008 ||
          Math.abs(dNext - drawerRef.current) > 0.0008
        ) {
          dirtyRef.current = true
        }
        mixRef.current = mNext
        navMixRef.current = nNext
        drawerRef.current = dNext
      }

      if (reducedMotion && !dirtyRef.current) return

      const mix = mixRef.current
      const collapsed = navMixRef.current
      const drawer = drawerRef.current
      const i0 = Math.min(2, Math.floor(mix))
      const i1 = Math.min(2, i0 + 1)
      const f = clamp(mix - i0)
      const eTrans = easeInOutCubic(trans)

      /* ---- frame geometry ------------------------------------------------- */

      const fx0 = L.x0
      const fw = Math.max(46, dev * L.rail)
      const fx1 = fx0 + fw
      const fy0 = L.frameY
      const fy1 = fy0 + L.frameH
      const navY = fy0 + L.chromeH
      const gauge = clamp(fw * 0.012, 3, 6)
      const vx = fx0 + L.padIn
      const vy = navY + L.navH + L.chan
      const vw = Math.max(20, fw - L.padIn * 2 - gauge - 2)
      const vh = Math.max(16, fy1 - L.padIn - vy)
      const gut = clamp(vw * 0.03, 3, 11)

      const V = viewRef.current
      V.vx = vx
      V.vy = vy
      V.vw = vw
      V.vh = vh
      V.gut = gut
      V.rowUnit = L.rowUnit

      ctx.clearRect(0, 0, w, h)
      ctx.lineJoin = 'miter'
      ctx.lineCap = 'butt'
      ctx.setLineDash(NODASH)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'

      /* ---- breakpoint ruler ----------------------------------------------- */

      if (L.showRuler) {
        const ry = L.rulerY
        pen(ctx, inkFaint, 0.3)
        line(ctx, L.x0, ry, L.x1, ry)
        for (let s = 0; s < SNAPS.length; s += 1) {
          const sx = L.x0 + SNAPS[s] * L.rail
          pen(ctx, inkFaint, 0.28)
          line(ctx, sx, ry - 2.5, sx, ry + 2.5)
        }

        // Min-width breakpoints: lit once the frame is wide enough to match.
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        for (let k = 0; k < 2; k += 1) {
          const bpv = k === 0 ? BP_MD : BP_LG
          const bx = L.x0 + bpv * L.rail
          const on = dev >= bpv
          pen(ctx, on ? signal : inkFaint, on ? 0.85 : 0.32, on ? 1 : 0.75)
          line(ctx, bx, ry - 6, bx, ry + 4)
          if (!L.detail) continue
          nib(ctx, on ? signal : inkFaint, on ? 0.75 : 0.3, L.fontNano)
          ctx.fillText(k === 0 ? `MD ${BP_MD}` : `LG ${BP_LG}`, bx, ry + 6)
        }

        // The frame edge, dropped onto the scale.
        pen(ctx, dragRef.current ? accent : inkFaint, 0.42)
        ctx.setLineDash(DASH_FINE)
        line(ctx, fx1, fy1 + 2, fx1, ry - 3)
        ctx.setLineDash(NODASH)

        nib(ctx, dragRef.current ? accent : inkSoft, dragRef.current ? 0.95 : 0.55, L.fontNano)
        ctx.textAlign = 'right'
        ctx.textBaseline = 'bottom'
        ctx.fillText(`${Math.round(dev)}PX · ${cols}COL`, Math.max(fx0 + 58, fx1 - 4), ry - 5)
      }

      /* ---- frame + chrome bar --------------------------------------------- */

      ctx.textAlign = 'left'
      pen(ctx, inkFaint, 0.75, 1)
      ctx.strokeRect(fx0, fy0, fw, L.frameH)
      pen(ctx, inkFaint, 0.4)
      line(ctx, fx0, navY, fx1, navY)

      // Back / forward, then the history stack createWebHistory keeps.
      const cbY = fy0 + L.chromeH * 0.5
      let urlX = fx0 + L.padIn
      if (fw > 130) {
        pen(ctx, inkSoft, 0.45, 0.9)
        ctx.lineCap = 'round'
        line(ctx, urlX + 3.5, cbY - 3, urlX, cbY)
        line(ctx, urlX, cbY, urlX + 3.5, cbY + 3)
        ctx.globalAlpha = 0.2
        line(ctx, urlX + 9, cbY - 3, urlX + 12.5, cbY)
        line(ctx, urlX + 12.5, cbY, urlX + 9, cbY + 3)
        ctx.lineCap = 'butt'
        urlX += 20
      }
      if (fw > 250) {
        for (let k = 0; k < depth; k += 1) {
          const on = k === depth - 1
          pen(ctx, on ? accent : inkFaint, on ? 0.85 : 0.3)
          line(ctx, urlX + k * 3, cbY - 3.5, urlX + k * 3, cbY + 3.5)
        }
        urlX += depth * 3 + 8
      }

      // The URL swaps under the router, not over a reload.
      const urlW = Math.max(8, fx1 - L.padIn - urlX)
      if (urlW > 18) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(urlX, fy0 + 1, urlW, L.chromeH - 2)
        ctx.clip()
        ctx.textBaseline = 'middle'
        const rise = L.chromeH * 0.8
        if (from !== route && trans < 1) {
          nib(ctx, inkSoft, (1 - trans) * 0.6, L.fontMicro)
          ctx.fillText(ROUTES[from].path, urlX, cbY - rise * eTrans)
        }
        nib(ctx, ink, from !== route ? clamp(trans * 1.6) : 1, L.fontMicro)
        ctx.fillText(ROUTES[route].path, urlX, cbY + rise * (1 - eTrans))
        ctx.restore()
      }

      /* ---- nav: pills folding into a burger -------------------------------- */

      const hit = hitRef.current
      hit.pill.fill(0)
      hit.drawer.fill(0)
      hit.handleX = fx1
      hit.frameTop = fy0
      hit.frameBot = fy1
      hit.collapsed = collapsed
      hit.drawerOpen = drawer
      hit.rail = L.rail
      hit.x0 = L.x0
      // Off-canvas when there is no ruler, so its drag band can never fire.
      hit.rulerY = L.showRuler ? L.rulerY : -1e4

      const pillH = Math.max(6, L.navH * 0.56)
      const pillY = navY + (L.navH - pillH) * 0.5
      const brandX = fx0 + L.padIn
      const brandW = clamp(fw * 0.05, 7, 16)
      const burgerX = fx1 - L.padIn - 6

      nib(ctx, inkSoft, 0.7)
      ctx.fillRect(brandX, navY + L.navH * 0.5 - 2, 4, 4)
      ctx.globalAlpha = 0.35
      bar(ctx, brandX + 6, navY + L.navH * 0.5 - 1, brandW, 2)

      const pillsX0 = brandX + brandW + 12
      const pillsX1 = fx1 - L.padIn - 16
      const availPills = Math.max(8, pillsX1 - pillsX0)
      const pillGap = clamp(availPills * 0.018, 2, 6)
      const pillW = Math.max(5, Math.min(70, availPills / nRoutes - pillGap))
      const labels = pillW > 34 && L.detail
      const cStag = Math.min(0.09, 0.4 / Math.max(1, nRoutes - 1))
      const cSpan = cStag * (nRoutes - 1)

      ctx.font = L.fontNano
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'
      for (let i = 0; i < nRoutes; i += 1) {
        // The rightmost pill folds first, like a concertina.
        const c = easeInOutCubic(clamp(collapsed * (1 + cSpan) - (nRoutes - 1 - i) * cStag))
        const homeX = pillsX0 + i * (pillW + pillGap)
        const px = lerp(homeX, burgerX - pillW * 0.5, c)
        const pw = lerp(pillW, 2, c)
        const a = 1 - c
        if (a > 0.02) {
          const on = i === route
          pen(ctx, on ? accent : inkFaint, a * (on ? 0.9 : 0.45), on ? 1 : 0.75)
          ctx.strokeRect(px, pillY, pw, pillH)
          if (labels) {
            nib(ctx, on ? accent : inkSoft, a * (on ? 1 : 0.6))
            ctx.fillText(ROUTES[i].label, px + pw * 0.5, pillY + pillH * 0.5 + 0.5)
          }
        }
        hit.pill[i * 4] = px
        hit.pill[i * 4 + 1] = pillY
        hit.pill[i * 4 + 2] = pw
        hit.pill[i * 4 + 3] = pillH
      }

      // The active marker slides between pills rather than jumping.
      if (collapsed < 0.98 && nRoutes > 1) {
        const fx = hit.pill[from * 4] + hit.pill[from * 4 + 2] * 0.5
        const tx = hit.pill[route * 4] + hit.pill[route * 4 + 2] * 0.5
        const mxc = lerp(fx, tx, eTrans)
        const mw = pillW * 0.62
        pen(ctx, accent, (1 - collapsed) * 0.9, 1.3)
        line(ctx, mxc - mw * 0.5, pillY + pillH + 2.5, mxc + mw * 0.5, pillY + pillH + 2.5)
      }

      // Burger: the pills' destination, drawn as they arrive.
      const burgerY = navY + L.navH * 0.5
      hit.burger[0] = burgerX - 7
      hit.burger[1] = burgerY - 6
      hit.burger[2] = 14
      hit.burger[3] = 12
      if (collapsed > 0.02) {
        const bw2 = 5 * collapsed
        pen(ctx, drawer > 0.5 ? accent : inkSoft, collapsed * (drawer > 0.5 ? 0.95 : 0.7), 1)
        for (let k = 0; k < 3; k += 1) {
          line(ctx, burgerX - bw2, burgerY + (k - 1) * 3.6, burgerX + bw2, burgerY + (k - 1) * 3.6)
        }
      }

      /* ---- <router-view/> --------------------------------------------------- */

      pen(ctx, inkFaint, 0.3)
      ctx.setLineDash(DASH)
      ctx.strokeRect(vx, vy, vw, vh)
      ctx.setLineDash(NODASH)

      if (L.detail && fw > 220) {
        nib(ctx, inkFaint, 0.38, L.fontNano)
        ctx.textAlign = 'left'
        ctx.textBaseline = 'bottom'
        ctx.fillText('<ROUTER-VIEW/>', vx, vy - 2)
      }

      ctx.save()
      ctx.beginPath()
      ctx.rect(vx - 1, vy, vw + 2, vh)
      ctx.clip()

      // Reduced motion shows where the blocks reflowed out of.
      if (reducedMotion && i0 > 0) {
        const ghost = PACKED[route][0].slots
        pen(ctx, inkFaint, 0.22)
        ctx.setLineDash(DASH_FINE)
        for (let i = 0; i < ghost.length; i += 1) {
          ctx.strokeRect(
            vx + ghost[i].x * vw + gut * 0.5,
            vy + ghost[i].y * L.rowUnit,
            Math.max(3, ghost[i].w * vw - gut),
            Math.max(3, ghost[i].h * L.rowUnit),
          )
        }
        ctx.setLineDash(NODASH)
      }

      // Out to the left, staggered; in from the right behind the routed path.
      if (from !== route && trans < 1) drawView(ctx, V, palette, from, i0, i1, f, 1, trans, 1)
      drawView(ctx, V, palette, route, i0, i1, f, from === route ? 1 : clamp((trans - 0.28) / 0.72), 0, 1)
      ctx.restore()

      /* ---- page-length gauge ------------------------------------------------ */

      const pageH = lerp(PACKED[route][i0].height, PACKED[route][i1].height, f) * L.rowUnit
      const seen = clamp(vh / Math.max(vh, pageH), 0.12, 1)
      const gx = fx1 - L.padIn * 0.5 - gauge * 0.5
      pen(ctx, inkFaint, 0.22)
      line(ctx, gx, vy, gx, vy + vh)
      pen(ctx, inkSoft, seen < 0.999 ? 0.7 : 0.35, 1.6)
      line(ctx, gx, vy, gx, vy + vh * seen)

      // One column is the same page, twice as long — the gauge says so, this
      // puts a number on it.
      if (L.detail && L.showRuler && seen < 0.995 && fw > 130) {
        nib(ctx, inkFaint, 0.4, L.fontNano)
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(`PAGE ×${(pageH / vh).toFixed(1)}`, fx0, fy1 + 3)
      }

      /* ---- the routed path -------------------------------------------------- */

      // Held complete in reduced motion: pill → channel → view, the route
      // resolved rather than resolving.
      if (reducedMotion || (from !== route && trans < 1)) {
        const originCollapsed = collapsed > 0.5
        const sx = originCollapsed ? burgerX : hit.pill[route * 4] + hit.pill[route * 4 + 2] * 0.5
        const sy = originCollapsed ? navY + L.navH * 0.5 + 6 : pillY + pillH + 3
        const chanY = vy - L.chan * 0.5
        const inX = vx + Math.min(14, vw * 0.12)
        const tr = hit.trace
        // Down out of the pill, left along the channel, into the view corner.
        tr[0] = sx; tr[1] = sy
        tr[2] = sx; tr[3] = chanY
        tr[4] = inX; tr[5] = chanY
        tr[6] = inX; tr[7] = vy + 1

        const reveal = reducedMotion ? 1 : easeOutCubic(clamp(trans / 0.42))
        const fade = reducedMotion ? 0.7 : 1 - range(trans, 0.72, 1)
        let total = 0
        for (let k = 0; k < 3; k += 1) {
          total += Math.abs(tr[k * 2 + 2] - tr[k * 2]) + Math.abs(tr[k * 2 + 3] - tr[k * 2 + 1])
        }
        let want = total * reveal
        pen(ctx, accent, 0.9 * fade, 1.1)
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(tr[0], tr[1])
        let hx = tr[0]
        let hy = tr[1]
        for (let k = 0; k < 3 && want > 0; k += 1) {
          const ax = tr[k * 2]
          const ay = tr[k * 2 + 1]
          const len = Math.abs(tr[k * 2 + 2] - ax) + Math.abs(tr[k * 2 + 3] - ay)
          const q = len > 0 ? Math.min(1, want / len) : 1
          hx = lerp(ax, tr[k * 2 + 2], q)
          hy = lerp(ay, tr[k * 2 + 3], q)
          ctx.lineTo(hx, hy)
          want -= len
        }
        ctx.stroke()
        ctx.lineCap = 'butt'

        nib(ctx, accent, fade * (reveal < 1 ? 1 : 0.5))
        ctx.beginPath()
        ctx.arc(hx, hy, 1.9, 0, Math.PI * 2)
        ctx.fill()
      }

      /* ---- the mobile drawer ------------------------------------------------- */

      if (drawer > 0.01) {
        const rowH = Math.min(22, vh / (nRoutes + 0.8))
        const dh = rowH * nRoutes + 6
        const dy = vy + (dh + 4) * (drawer - 1)
        ctx.save()
        ctx.beginPath()
        ctx.rect(vx - 1, vy, vw + 2, vh)
        ctx.clip()
        nib(ctx, bg, 0.93 * drawer, L.fontNano)
        ctx.fillRect(vx, dy, vw, dh)
        pen(ctx, inkFaint, 0.4 * drawer)
        line(ctx, vx, dy + dh, vx + vw, dy + dh)

        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        for (let i = 0; i < nRoutes; i += 1) {
          const ry2 = dy + 3 + i * rowH
          // Before the pick, the mounted route is the marked one; after it,
          // the chosen row takes the accent.
          const picked = i === route && trans > 0.02
          const cur = i === from && !picked
          nib(ctx, picked ? accent : cur ? ink : inkSoft, drawer * (picked ? 1 : cur ? 0.8 : 0.42))
          ctx.fillText(ROUTES[i].label, vx + 8, ry2 + rowH * 0.5)
          if (picked || cur) {
            pen(ctx, picked ? accent : inkFaint, drawer * (picked ? 0.9 : 0.4), picked ? 1.2 : 0.75)
            line(ctx, vx + 3, ry2 + 2, vx + 3, ry2 + rowH - 2)
          }
          if (i < nRoutes - 1) {
            pen(ctx, inkFaint, drawer * 0.18)
            line(ctx, vx + 8, ry2 + rowH, vx + vw - 8, ry2 + rowH)
          }
          hit.drawer[i * 4] = vx
          hit.drawer[i * 4 + 1] = ry2
          hit.drawer[i * 4 + 2] = drawer > 0.6 ? vw : 0
          hit.drawer[i * 4 + 3] = rowH
        }
        ctx.restore()
      }

      /* ---- the resize handle -------------------------------------------------- */

      const hy2 = fy0 + L.frameH * 0.5
      const hot = zoneRef.current === 'handle' || dragRef.current
      pen(ctx, hot ? accent : inkSoft, hot ? 0.95 : 0.5, hot ? 1.2 : 1)
      line(ctx, fx1 - 2, hy2 - 6, fx1 - 2, hy2 + 6)
      line(ctx, fx1 + 2, hy2 - 6, fx1 + 2, hy2 + 6)

      /* ---- component ledger ---------------------------------------------------- */

      if (L.ledger) {
        const ly = L.ledgerY
        const span = Math.min(L.x1 - L.x0 - 62, ledgerTicks * 9 + (nRoutes - 1) * 6)
        const step = span / Math.max(1, ledgerTicks + (nRoutes - 1) * 0.66)
        let cx2 = L.x0
        for (let r = 0; r < nRoutes; r += 1) {
          const n = ROUTES[r].blocks.length
          const on = r === route ? clamp(trans * 2) : r === from ? 1 - clamp(trans * 2) : 0
          const lit = on > 0.5
          pen(ctx, lit ? accent : inkFaint, 0.3 + on * 0.6, lit ? 1 : 0.75)
          for (let k = 0; k < n; k += 1) {
            line(ctx, cx2, ly - (lit ? 5 : 3), cx2, ly + (lit ? 2 : 1))
            cx2 += step
          }
          cx2 += step * 0.66
        }
        if (L.detail) {
          nib(ctx, inkFaint, 0.4, L.fontNano)
          ctx.textAlign = 'right'
          ctx.textBaseline = 'middle'
          ctx.fillText(`${compCount} COMPONENTS`, L.x1, ly - 1)
        }
      }

      ctx.globalAlpha = 1

      /* ---- readouts ------------------------------------------------------------ */

      const el = readoutRef.current
      const label = `${ROUTES[route].path} · ${cols} COL`
      if (el && pathShownRef.current !== label) {
        pathShownRef.current = label
        el.textContent = label
      }
      const bi = cols - 1
      if (bpShownRef.current !== bi) {
        bpShownRef.current = bi
        setBpIdx(bi)
      }

      firstRef.current = false
      dirtyRef.current = false
    },
  })

  /* ---- interaction --------------------------------------------------------- */

  /** Take the timeline over without teleporting: whatever the clock had
   *  reached becomes the manual starting state. */
  const seizeManual = useMemo(
    () => () => {
      if (!manualRef.current) {
        manualRef.current = true
        devTargetRef.current = devRef.current
      }
    },
    [],
  )

  const goTo = useMemo(
    () => (i: number) => {
      seizeManual()
      drawerOpenRef.current = false
      dirtyRef.current = true
      if (i < 0 || i === routeRef.current) return
      fromRouteRef.current = routeRef.current
      routeRef.current = i
      transRef.current = 0
      histRef.current = Math.min(9, histRef.current + 1)
    },
    [seizeManual],
  )

  const setWidth = useMemo(
    () => (dev: number) => {
      seizeManual()
      devTargetRef.current = clamp(dev, DEV_MIN, DEV_MAX)
      dirtyRef.current = true
    },
    [seizeManual],
  )

  useEffect(() => {
    if (!hud) return
    const canvas = ref.current
    if (!canvas) return

    const at = (e: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect()
      return [e.clientX - r.left, e.clientY - r.top]
    }

    const zoneAt = (x: number, y: number): Zone => {
      const hit = hitRef.current
      if (Math.abs(x - hit.handleX) < 9 && y > hit.frameTop && y < hit.frameBot) return 'handle'
      if (hit.drawerOpen > 0.6 && hitPill(hit.drawer, ROUTES.length, x, y) >= 0) return 'drawer'
      if (hit.collapsed > 0.5) {
        const b = hit.burger
        if (x >= b[0] - 4 && x <= b[0] + b[2] + 4 && y >= b[1] - 4 && y <= b[1] + b[3] + 4) return 'burger'
        return 'none'
      }
      if (hitPill(hit.pill, ROUTES.length, x, y) >= 0) return 'pill'
      return 'none'
    }

    const onMove = (e: PointerEvent) => {
      const [x, y] = at(e)
      if (dragRef.current) {
        setWidth((x - hitRef.current.x0) / Math.max(1e-4, hitRef.current.rail))
        return
      }
      const z = zoneAt(x, y)
      if (z !== zoneRef.current) {
        zoneRef.current = z
        dirtyRef.current = true
        canvas.style.cursor = z === 'handle' ? 'ew-resize' : z === 'none' ? 'default' : 'pointer'
      }
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const [x, y] = at(e)
      const hit = hitRef.current
      const z = zoneAt(x, y)
      if (z === 'handle' || (y > hit.rulerY - 10 && y < hit.rulerY + 10)) {
        dragRef.current = true
        canvas.setPointerCapture(e.pointerId)
        setWidth((x - hit.x0) / Math.max(1e-4, hit.rail))
        return
      }
      if (z === 'drawer') {
        goTo(hitPill(hit.drawer, ROUTES.length, x, y))
        return
      }
      if (z === 'burger') {
        seizeManual()
        drawerOpenRef.current = !drawerOpenRef.current
        dirtyRef.current = true
        return
      }
      if (z === 'pill') {
        goTo(hitPill(hit.pill, ROUTES.length, x, y))
      }
    }

    const onUp = (e: PointerEvent) => {
      if (!dragRef.current) return
      dragRef.current = false
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
      // Settle onto the nearest real device rather than any old width.
      let best = SNAPS[0]
      for (let i = 1; i < SNAPS.length; i += 1) {
        if (Math.abs(SNAPS[i] - devTargetRef.current) < Math.abs(best - devTargetRef.current)) best = SNAPS[i]
      }
      setWidth(best)
    }

    const onLeave = () => {
      if (zoneRef.current !== 'none') {
        zoneRef.current = 'none'
        canvas.style.cursor = 'default'
        dirtyRef.current = true
      }
    }

    // No touch-action override: the page must still scroll under a finger.
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('pointerleave', onLeave)

    return () => {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.style.cursor = 'default'
    }
  }, [ref, hud, goTo, setWidth, seizeManual])

  return (
    <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
      <canvas ref={ref} className={styles.canvas} />
      {hud && <div ref={readoutRef} className={styles.readout} aria-hidden="true" />}
      {hud && (
        <div className={styles.hud}>
          {BREAKPOINTS.map((b) => (
            <button
              key={b.label}
              type="button"
              className={styles.chip}
              data-on={bpIdx === b.cols - 1}
              style={{ cursor: 'pointer' }}
              onClick={() => setWidth(b.dev)}
            >
              {b.label}
            </button>
          ))}
          <span className={styles.chip}>{nRoutes} ROUTES</span>
          {compCount > 0 && <span className={styles.chip}>{compCount} COMPONENTS</span>}
        </div>
      )}
    </div>
  )
}
