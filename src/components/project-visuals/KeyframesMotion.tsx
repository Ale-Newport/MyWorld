'use client'

/**
 * KeyframesMotion — the motion graphic for the "Keyframes" platform.
 *
 * A contact sheet whose tiles are not images but tiny procedural motion
 * graphics: kinetic type bars, spinning wireframe extrusions, cross-fading
 * mixes and rotating sweeps. The grid literally is the thing the platform
 * catalogues. Beneath it runs a keyframe timeline with a draggable playhead —
 * every tile is phase-locked to that single clock, and a leader line links the
 * playhead to whichever tile is currently selected so the relationship is
 * legible without reading a word.
 *
 * Timeline (clock 0..1):
 *   0.00  empty sheet — registration marks only, playhead parked at 00:00:00
 *   0.24  all tiles have landed, staggered; the selection walks with the head
 *   0.56  a filter engages: two kinds drop out and the sheet re-packs physically
 *   0.82  filter releases, the grid re-flows back to full
 *   1.00  full sheet running, playhead at the tail of the reel
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useCanvas2D } from '@/hooks/useCanvas2D'
import { clamp, damp, easeOutCubic, lerp, range, seeded } from '@/lib/math'
import type { Project } from '@/content/types'
import { readPalette, type ProjectVisualProps, type VisualPalette } from './types'
import styles from './visual.module.css'

/* ---------------------------------------------------------------- constants */

const TAU = Math.PI * 2
const MAX_TILES = 32
const FPS = 24

const KIND_TYPE = 0
const KIND_WIRE = 1
const KIND_MIX = 2
const KIND_SWEEP = 3
const KIND_LABELS = ['TYPE', 'WIRE', 'MIX', 'SWEEP']

/** Cue points on the reel — where the sheet changes state. */
const CUES = [0.06, 0.24, 0.42, 0.58, 0.74, 0.9]

const FILTER_IN = 0.56
const FILTER_OUT = 0.82
/** The frame drawn when motion is reduced: full sheet, mid-reel, one tile live. */
const STATIC_CLOCK = 0.52

/** Extruded slab used by the wireframe tiles: 8 vertices, 12 edges. */
const BOX_V = new Float32Array([
  -1.25, -0.55, -0.55, 1.25, -0.55, -0.55, 1.25, 0.55, -0.55, -1.25, 0.55, -0.55,
  -1.25, -0.55, 0.55, 1.25, -0.55, 0.55, 1.25, 0.55, 0.55, -1.25, 0.55, 0.55,
])
const BOX_E = new Uint8Array([0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7])
/** Module-scope scratch for projected vertices — reused, never reallocated. */
const BOX_P = new Float32Array(16)
/** Scratch list of currently-unfiltered tile indices. Written once per frame. */
const VIS_IDX = new Int16Array(MAX_TILES)

/* ------------------------------------------------------------------- types */

interface Tile {
  kind: number
  /** Catalogue number shown when the tile is selected. */
  work: number
  phase: number
  rate: number
  /** Bar-width seeds for the kinetic-type tiles. */
  w0: number
  w1: number
  w2: number
  w3: number
  /** Live position, damped toward its packed slot. */
  x: number
  y: number
  vis: number
}

interface Layout {
  w: number
  h: number
  chrome: boolean
  gx: number
  gy: number
  cols: number
  rows: number
  total: number
  cw: number
  ch: number
  gut: number
  tlX0: number
  tlX1: number
  tlY: number
  detail: boolean
  fontMicro: string
  fontNano: string
}

/* --------------------------------------------------------------- utilities */

function computeLayout(w: number, h: number, chrome: boolean): Layout {
  const padX = clamp(w * 0.055, 10, 44)
  // The readout is one ~11px line at a 1rem inset — reserve the whole band so
  // it can never sit on top of the first row of tiles.
  const padTop = clamp(h * 0.07, 10, 24) + (chrome ? 36 : 0)
  const padBottom = clamp(h * 0.05, 6, 16)
  const hudH = chrome ? 36 : 0
  const tlH = h > 210 ? 32 : 24

  const gridTop = padTop
  const gridBottom = Math.max(gridTop + 24, h - padBottom - hudH - tlH)
  const gridW = Math.max(40, w - padX * 2)
  const gridH = gridBottom - gridTop

  const cols = Math.round(clamp(gridW / 130, 2, 7))
  const gut = clamp(gridW * 0.022, 4, 12)
  const cw = (gridW - gut * (cols - 1)) / cols
  const rows = Math.max(1, Math.min(5, Math.floor((gridH + gut) / (cw * 0.5625 + gut))))
  // 16:9 frames, but never taller than the space left above the timeline —
  // a squat tile beats a grid that overruns the playhead.
  const ch = Math.min(cw * 0.5625, (gridH - gut * (rows - 1)) / rows)
  const total = Math.min(MAX_TILES, cols * rows)
  const contentH = rows * ch + (rows - 1) * gut

  const micro = clamp(Math.round(Math.min(w, h) * 0.028), 8, 10)

  return {
    w,
    h,
    chrome,
    gx: padX,
    gy: gridTop + Math.max(0, (gridH - contentH) * 0.5),
    cols,
    rows,
    total,
    cw,
    ch,
    gut,
    tlX0: padX,
    tlX1: w - padX,
    tlY: h - padBottom - hudH - tlH * 0.5,
    detail: cw > 54,
    fontMicro: `${micro}px ui-monospace, monospace`,
    fontNano: `${Math.max(7, micro - 1)}px ui-monospace, monospace`,
  }
}

function timecode(seconds: number): string {
  const total = Math.max(0, seconds)
  const m = Math.floor(total / 60)
  const s = Math.floor(total % 60)
  const f = Math.floor((total % 1) * FPS)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`
}

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

/* ------------------------------------------------------------- tile motions */

function drawTypeTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  p: number,
  tile: Tile,
  col: string,
  accent: string,
  sel: boolean,
): void {
  const left = x + w * 0.14
  const span = w * 0.72
  const gap = h * 0.155
  const top = y + h * 0.5 - gap * 1.5
  const bh = Math.max(1.1, h * 0.055)
  for (let i = 0; i < 4; i += 1) {
    const seed = i === 0 ? tile.w0 : i === 1 ? tile.w1 : i === 2 ? tile.w2 : tile.w3
    const enter = easeOutCubic(range(p, i * 0.06, i * 0.06 + 0.42))
    const exit = 1 - easeOutCubic(range(p, 0.66 + i * 0.05, 0.94 + i * 0.05))
    // Bars never collapse to nothing — a tile that empties out reads as a
    // failed render rather than a beat of the animation.
    const bw = span * (0.28 + 0.72 * seed) * (0.22 + 0.78 * enter * exit)
    if (bw < 0.8) continue
    ctx.fillStyle = sel && i === 1 ? accent : col
    ctx.fillRect(left, top + i * gap - bh * 0.5, bw, bh)
  }
}

function drawWireTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  p: number,
  col: string,
  accent: string,
  sel: boolean,
): void {
  const cx = x + w * 0.5
  const cy = y + h * 0.5
  const s = Math.min(w * 0.28, h * 0.5)
  const a = p * TAU
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const ct = Math.cos(0.5)
  const st = Math.sin(0.5)
  for (let i = 0; i < 8; i += 1) {
    const vx = BOX_V[i * 3]
    const vy = BOX_V[i * 3 + 1]
    const vz = BOX_V[i * 3 + 2]
    const rx = vx * ca + vz * sa
    const rz = vz * ca - vx * sa
    const ry = vy * ct - rz * st
    const rzz = vy * st + rz * ct
    const q = 1 / (1 + rzz * 0.16)
    BOX_P[i * 2] = cx + rx * s * q
    BOX_P[i * 2 + 1] = cy + ry * s * q
  }
  ctx.beginPath()
  for (let e = 0; e < BOX_E.length; e += 2) {
    const ai = BOX_E[e] * 2
    const bi = BOX_E[e + 1] * 2
    ctx.moveTo(BOX_P[ai], BOX_P[ai + 1])
    ctx.lineTo(BOX_P[bi], BOX_P[bi + 1])
  }
  ctx.strokeStyle = sel ? accent : col
  ctx.lineWidth = sel ? 1.15 : 0.85
  ctx.stroke()
}

function drawMixTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  p: number,
  col: string,
  accent: string,
  sel: boolean,
): void {
  const cx = x + w * 0.5
  const cy = y + h * 0.5
  const r = Math.min(w * 0.24, h * 0.34)
  // The two takes must have clearly different silhouettes — a circle and a
  // square of equal bounding box read as one malformed glyph mid-wipe.
  const d = r * 1.24
  const wipe = 0.5 - 0.5 * Math.cos(p * TAU)
  const cut = x + w * (0.08 + 0.84 * wipe)

  ctx.strokeStyle = col
  ctx.lineWidth = 0.85

  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, cut - x, h)
  ctx.clip()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, TAU)
  ctx.stroke()
  ctx.restore()

  ctx.save()
  ctx.beginPath()
  ctx.rect(cut, y, x + w - cut, h)
  ctx.clip()
  ctx.beginPath()
  ctx.moveTo(cx, cy - d)
  ctx.lineTo(cx + d, cy)
  ctx.lineTo(cx, cy + d)
  ctx.lineTo(cx - d, cy)
  ctx.closePath()
  ctx.stroke()
  ctx.restore()

  // The wipe marker is only meaningful between the two takes — parked against
  // an edge it is just a stray line.
  if (wipe > 0.08 && wipe < 0.92) {
    ctx.beginPath()
    ctx.moveTo(cut, y + h * 0.16)
    ctx.lineTo(cut, y + h * 0.84)
    ctx.strokeStyle = sel ? accent : col
    ctx.lineWidth = sel ? 1.15 : 0.75
    ctx.stroke()
  }
}

function drawSweepTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  p: number,
  col: string,
  faint: string,
  accent: string,
  sel: boolean,
): void {
  const cx = x + w * 0.5
  const cy = y + h * 0.5
  const r = Math.min(w * 0.24, h * 0.36)
  ctx.strokeStyle = faint
  ctx.lineWidth = 0.75
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, TAU)
  ctx.stroke()

  const a0 = -Math.PI * 0.5
  const a1 = a0 + p * TAU
  ctx.strokeStyle = sel ? accent : col
  ctx.lineWidth = sel ? 1.25 : 1
  ctx.beginPath()
  ctx.arc(cx, cy, r, a0, a1)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r)
  ctx.stroke()
}

/* ------------------------------------------------------------- the component */

export function KeyframesMotion(props: ProjectVisualProps) {
  const { project, progress, reducedMotion = false, interactive = true, className } = props
  const chrome = interactive !== false

  const works = metricValue(project, 'Seeded works', 66)
  const countries = metricValue(project, 'Countries in seed data', 28)
  const reelSeconds = clamp(project?.presentation.duration ?? 35, 12, 45)

  const [kinds, setKinds] = useState<boolean[]>(() => [true, true, true, true])
  const [autoFiltered, setAutoFiltered] = useState(false)
  const [shown, setShown] = useState(0)
  const [slots, setSlots] = useState(0)

  const tiles = useMemo<Tile[]>(() => {
    const rnd = seeded(0x4b455946)
    const out: Tile[] = []
    for (let i = 0; i < MAX_TILES; i += 1) {
      out.push({
        kind: i < 4 ? i : Math.floor(rnd() * 4) % 4,
        work: 1 + ((i * 7 + 3) % 66),
        phase: rnd(),
        rate: 0.65 + rnd() * 0.85,
        w0: rnd(),
        w1: rnd(),
        w2: rnd(),
        w3: rnd(),
        x: 0,
        y: 0,
        vis: 0,
      })
    }
    return out
  }, [])

  const layoutRef = useRef<Layout | null>(null)
  const paletteRef = useRef<VisualPalette | null>(null)
  const paletteAtRef = useRef(-1)
  const pointerRef = useRef({ x: -1, y: -1, inside: false })
  const dragRef = useRef(false)
  const scrubRef = useRef(STATIC_CLOCK)
  const manualRef = useRef(false)
  const pinRef = useRef(-1)
  const hoverRef = useRef(-1)
  const runRef = useRef(0)
  const clockRef = useRef(0)
  const firstRef = useRef(true)
  const dirtyRef = useRef(true)
  const userFilteredRef = useRef(false)
  const countsRef = useRef({ shown: -1, total: -1 })
  const autoRef = useRef(false)

  const ref = useCanvas2D<HTMLCanvasElement>({
    setup: ({ ctx, w, h }) => {
      layoutRef.current = computeLayout(w, h, chrome)
      paletteRef.current = readPalette(ctx.canvas)
      paletteAtRef.current = -1
      firstRef.current = true
      dirtyRef.current = true
    },

    draw: ({ ctx, w, h, t, dt }) => {
      let layout = layoutRef.current
      if (!layout || layout.w !== w || layout.h !== h || layout.chrome !== chrome) {
        layout = computeLayout(w, h, chrome)
        layoutRef.current = layout
        firstRef.current = true
        dirtyRef.current = true
      }

      // Palette is polled rather than read every frame — getComputedStyle is
      // not free, and a theme swap only needs to land within half a second.
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

      /* ---- master clock -------------------------------------------------- */

      let target: number
      if (dragRef.current) {
        target = scrubRef.current
      } else if (reducedMotion) {
        target = manualRef.current ? scrubRef.current : STATIC_CLOCK
      } else if (typeof progress === 'number') {
        target = clamp(progress)
      } else {
        runRef.current = (runRef.current + dt / reelSeconds) % 1
        target = runRef.current
      }

      let clock: number
      if (dragRef.current || reducedMotion || firstRef.current) {
        clock = target
      } else if (typeof progress === 'number') {
        clock = damp(clockRef.current, target, 16, dt)
      } else {
        clock = target
      }
      clockRef.current = clock
      if (dragRef.current) runRef.current = clock

      if (reducedMotion && !dirtyRef.current) return
      const snap = firstRef.current || reducedMotion

      /* ---- filter state -------------------------------------------------- */

      const auto = !userFilteredRef.current && !reducedMotion && clock > FILTER_IN && clock < FILTER_OUT
      if (auto !== autoRef.current) {
        autoRef.current = auto
        setAutoFiltered(auto)
      }

      const total = layout.total
      let live = 0
      for (let i = 0; i < total; i += 1) {
        const k = tiles[i].kind
        const on = kinds[k] && !(auto && k !== KIND_WIRE && k !== KIND_TYPE)
        if (on) {
          VIS_IDX[live] = i
          live += 1
        }
      }
      if (countsRef.current.shown !== live || countsRef.current.total !== total) {
        countsRef.current.shown = live
        countsRef.current.total = total
        setShown(live)
        setSlots(total)
      }

      /* ---- pointer resolution -------------------------------------------- */

      const { cw, ch, gut, gx, gy, cols, tlX0, tlX1, tlY } = layout
      const px = pointerRef.current.x
      const py = pointerRef.current.y
      let hover = -1
      if (chrome && pointerRef.current.inside && py < tlY - 12) {
        for (let i = 0; i < total; i += 1) {
          const tile = tiles[i]
          if (tile.vis < 0.4) continue
          if (px >= tile.x && px <= tile.x + cw && py >= tile.y && py <= tile.y + ch) {
            hover = i
            break
          }
        }
      }
      hoverRef.current = hover

      // With no pointer input the selection walks the sheet in reading order,
      // in step with the playhead — the head literally scans the catalogue.
      // It only ever lands on a tile the filter has left standing.
      const walk = live > 0
        ? VIS_IDX[Math.min(live - 1, Math.floor(range(clock, 0.08, 0.97) * live))]
        : -1
      const selected = pinRef.current >= 0 && pinRef.current < total
        ? pinRef.current
        : hover >= 0
          ? hover
          : walk

      ctx.clearRect(0, 0, w, h)
      ctx.lineJoin = 'round'
      ctx.lineCap = 'butt'

      /* ---- contact-sheet registration marks ------------------------------ */

      const mark = Math.min(5, cw * 0.09)
      ctx.beginPath()
      for (let i = 0; i < total; i += 1) {
        const sx = gx + (i % cols) * (cw + gut)
        const sy = gy + Math.floor(i / cols) * (ch + gut)
        ctx.moveTo(sx, sy + mark)
        ctx.lineTo(sx, sy)
        ctx.lineTo(sx + mark, sy)
        ctx.moveTo(sx + cw - mark, sy)
        ctx.lineTo(sx + cw, sy)
        ctx.lineTo(sx + cw, sy + mark)
        ctx.moveTo(sx + cw, sy + ch - mark)
        ctx.lineTo(sx + cw, sy + ch)
        ctx.lineTo(sx + cw - mark, sy + ch)
        ctx.moveTo(sx + mark, sy + ch)
        ctx.lineTo(sx, sy + ch)
        ctx.lineTo(sx, sy + ch - mark)
      }
      ctx.strokeStyle = inkFaint
      ctx.lineWidth = 0.75
      ctx.globalAlpha = 0.4
      ctx.stroke()
      ctx.globalAlpha = 1

      /* ---- tiles ---------------------------------------------------------- */

      let selX = 0
      let selY = 0
      let selW = 0
      let selH = 0
      let selOn = false
      let slot = 0

      for (let i = 0; i < total; i += 1) {
        const tile = tiles[i]
        const k = tile.kind
        const on = kinds[k] && !(auto && k !== KIND_WIRE && k !== KIND_TYPE)

        // Visible tiles re-pack into the leading slots; hidden ones stay put
        // and fade, so a filter reads as a physical re-flow.
        const at = on ? slot : i
        if (on) slot += 1
        const tx = gx + (at % cols) * (cw + gut)
        const ty = gy + Math.floor(at / cols) * (ch + gut)

        if (snap) {
          tile.x = tx
          tile.y = ty
          tile.vis = on ? 1 : 0
        } else {
          tile.x = damp(tile.x, tx, 9, dt)
          tile.y = damp(tile.y, ty, 9, dt)
          tile.vis = damp(tile.vis, on ? 1 : 0, 7, dt)
        }

        const born = i * (0.2 / Math.max(1, total))
        const enter = easeOutCubic(range(clock, 0.02 + born, 0.02 + born + 0.1))
        const alpha = enter * clamp(tile.vis * 1.05)
        if (alpha < 0.015) continue

        const k2 = lerp(0.86, 1, enter) * lerp(0.7, 1, clamp(tile.vis))
        const dw = cw * k2
        const dh = ch * k2
        const dx = tile.x + (cw - dw) * 0.5
        const dy = tile.y + (ch - dh) * 0.5 + (1 - enter) * ch * 0.14
        const sel = i === selected && on && enter > 0.6

        const local = (tile.phase + clock * 6 * tile.rate) % 1

        ctx.globalAlpha = alpha
        ctx.strokeStyle = sel ? accent : inkFaint
        ctx.lineWidth = sel ? 1.2 : 0.75
        ctx.strokeRect(dx + 0.25, dy + 0.25, dw - 0.5, dh - 0.5)

        ctx.save()
        ctx.beginPath()
        ctx.rect(dx, dy, dw, dh)
        ctx.clip()
        const body = sel ? ink : inkSoft
        if (k === KIND_TYPE) drawTypeTile(ctx, dx, dy, dw, dh, local, tile, body, accent, sel)
        else if (k === KIND_WIRE) drawWireTile(ctx, dx, dy, dw, dh, local, body, accent, sel)
        else if (k === KIND_MIX) drawMixTile(ctx, dx, dy, dw, dh, local, body, accent, sel)
        else if (k === KIND_SWEEP) drawSweepTile(ctx, dx, dy, dw, dh, local, body, inkFaint, accent, sel)

        if (sel && layout.detail) {
          ctx.font = layout.fontNano
          ctx.textAlign = 'left'
          ctx.textBaseline = 'alphabetic'
          const label = `${String(tile.work).padStart(2, '0')} ${KIND_LABELS[k]}`
          const tw = ctx.measureText(label).width
          ctx.fillStyle = bg
          ctx.globalAlpha = alpha * 0.85
          ctx.fillRect(dx + 4, dy + 4, tw + 6, 11)
          ctx.globalAlpha = alpha
          ctx.fillStyle = accent
          ctx.fillText(label, dx + 7, dy + 12.5)
        }
        ctx.restore()

        if (sel) {
          selX = dx
          selY = dy
          selW = dw
          selH = dh
          selOn = true
        }
      }
      ctx.globalAlpha = 1

      /* ---- playhead ------------------------------------------------------- */

      const headX = tlX0 + (tlX1 - tlX0) * clamp(clock)

      // The leader: one clock, one selected frame. The single accent idea.
      if (selOn && selY + selH < tlY - 8) {
        const y0 = selY + selH
        const y1 = tlY - 7
        const mid = (y0 + y1) * 0.5
        ctx.globalAlpha = 0.55
        ctx.strokeStyle = accent
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(selX + selW * 0.5, y0)
        ctx.bezierCurveTo(selX + selW * 0.5, mid, headX, mid, headX, y1)
        ctx.stroke()
        ctx.globalAlpha = 1
      }

      /* ---- timeline -------------------------------------------------------- */

      ctx.strokeStyle = inkFaint
      ctx.lineWidth = 0.75
      ctx.beginPath()
      ctx.moveTo(tlX0, tlY)
      ctx.lineTo(tlX1, tlY)
      ctx.stroke()

      const ticks = 24
      ctx.beginPath()
      for (let i = 0; i <= ticks; i += 1) {
        const x = tlX0 + ((tlX1 - tlX0) * i) / ticks
        ctx.moveTo(x, tlY)
        ctx.lineTo(x, tlY + (i % 6 === 0 ? 5 : 2.5))
      }
      ctx.globalAlpha = 0.55
      ctx.stroke()
      ctx.globalAlpha = 1

      ctx.strokeStyle = inkSoft
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(tlX0, tlY)
      ctx.lineTo(headX, tlY)
      ctx.stroke()

      for (let i = 0; i < CUES.length; i += 1) {
        const cue = CUES[i]
        const x = tlX0 + (tlX1 - tlX0) * cue
        const r = 3
        ctx.beginPath()
        ctx.moveTo(x, tlY - r)
        ctx.lineTo(x + r, tlY)
        ctx.lineTo(x, tlY + r)
        ctx.lineTo(x - r, tlY)
        ctx.closePath()
        ctx.fillStyle = cue <= clock ? signal : bg
        ctx.globalAlpha = cue <= clock ? 0.8 : 1
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.strokeStyle = cue <= clock ? signal : inkFaint
        ctx.lineWidth = 0.75
        ctx.stroke()
      }

      ctx.strokeStyle = accent
      ctx.lineWidth = 1.25
      ctx.beginPath()
      ctx.moveTo(headX, tlY - 13)
      ctx.lineTo(headX, tlY + 7)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(headX - 3.5, tlY - 13)
      ctx.lineTo(headX + 3.5, tlY - 13)
      ctx.lineTo(headX, tlY - 7)
      ctx.closePath()
      ctx.fillStyle = accent
      ctx.fill()

      if (layout.detail) {
        ctx.font = layout.fontMicro
        ctx.textBaseline = 'top'
        ctx.textAlign = 'left'
        ctx.fillStyle = ink
        ctx.fillText(timecode(clock * reelSeconds), tlX0, tlY + 9)
        ctx.textAlign = 'right'
        ctx.fillStyle = inkFaint
        ctx.fillText(timecode(reelSeconds), tlX1, tlY + 9)
      }

      firstRef.current = false
      dirtyRef.current = false
    },
  })

  /* ---- interaction ------------------------------------------------------- */

  useEffect(() => {
    if (!chrome) return
    const canvas = ref.current
    if (!canvas) return

    const bandY = () => layoutRef.current?.tlY ?? -1

    const track = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      pointerRef.current.x = e.clientX - rect.left
      pointerRef.current.y = e.clientY - rect.top
      pointerRef.current.inside = true
    }

    const onMove = (e: PointerEvent) => {
      track(e)
      const layout = layoutRef.current
      if (layout && dragRef.current) {
        scrubRef.current = clamp((pointerRef.current.x - layout.tlX0) / Math.max(1, layout.tlX1 - layout.tlX0))
      }
      const overBand = Math.abs(pointerRef.current.y - bandY()) < 18
      const want = dragRef.current || overBand ? 'ew-resize' : hoverRef.current >= 0 ? 'pointer' : 'default'
      if (canvas.style.cursor !== want) canvas.style.cursor = want
      dirtyRef.current = true
    }

    const onDown = (e: PointerEvent) => {
      track(e)
      const layout = layoutRef.current
      if (!layout) return
      if (Math.abs(pointerRef.current.y - layout.tlY) < 18) {
        dragRef.current = true
        manualRef.current = true
        scrubRef.current = clamp((pointerRef.current.x - layout.tlX0) / Math.max(1, layout.tlX1 - layout.tlX0))
        // Capture is an optimisation, not a requirement — a stale pointer id
        // throws, and the scrub still tracks fine without it.
        try {
          canvas.setPointerCapture(e.pointerId)
        } catch {
          /* no capture available for this pointer */
        }
      } else {
        pinRef.current = hoverRef.current >= 0 && hoverRef.current !== pinRef.current ? hoverRef.current : -1
      }
      dirtyRef.current = true
    }

    const onUp = (e: PointerEvent) => {
      try {
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
      } catch {
        /* capture already gone */
      }
      dragRef.current = false
      dirtyRef.current = true
    }

    const onLeave = () => {
      pointerRef.current.inside = false
      pointerRef.current.x = -1
      pointerRef.current.y = -1
      canvas.style.cursor = 'default'
      dirtyRef.current = true
    }

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
  }, [ref, chrome])

  const toggleKind = (i: number) => {
    userFilteredRef.current = true
    autoRef.current = false
    setAutoFiltered(false)
    setKinds((prev) => prev.map((on, idx) => (idx === i ? !on : on)))
    dirtyRef.current = true
  }

  const chipOn = (i: number) =>
    kinds[i] && !(autoFiltered && i !== KIND_WIRE && i !== KIND_TYPE)

  return (
    <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
      <canvas ref={ref} className={styles.canvas} />
      {chrome && (
        <div className={styles.readout} style={{ whiteSpace: 'nowrap' }} aria-hidden="true">
          {shown}/{slots} · {works} WORKS · {countries} COUNTRIES
        </div>
      )}
      {chrome && (
        <div className={styles.hud}>
          {KIND_LABELS.map((label, i) => (
            <button
              key={label}
              type="button"
              className={styles.chip}
              style={{ cursor: 'pointer' }}
              data-on={chipOn(i) ? 'true' : 'false'}
              aria-pressed={chipOn(i)}
              onClick={() => toggleKind(i)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
