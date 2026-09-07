'use client'

/**
 * VoxelMotion — the motion graphic for "Minecraft Seed Finder".
 *
 * The search space, drawn to scale. A top-down grid of world regions fills the
 * stage; the stronghold spiral sits fixed at its centre, ringed by dashed
 * radii at 100 and 500 blocks. A scan cursor walks outward ring by ring — one
 * cell per region, at a constant cells-per-second, so the sweep slows in radius
 * exactly the way the C loops do — and the counter climbs toward 10,201. Cells
 * flash as they are visited; a region holding a required structure pops a glyph.
 *
 * Then the camera dives to the stronghold and the real test runs: a leader line
 * measures each found structure against the 500-block limit — a ring barely
 * wider than one region of that grid. Almost every seed loses here, so the seed
 * number is struck and the next one is scanned. That is the whole argument for
 * brute force, and it is why the last seed matters.
 *
 * Timeline (clock 0..1 walks five seeds):
 *   0.00  camera held on the stronghold, pulling back as the first cells flash
 *   0.33  seed 2 measured up close — one structure sits outside 500, struck
 *   0.66  seed 4's grid fully swept, camera diving in for the check
 *   1.00  seed 5 satisfies every structure inside 500 blocks — grid flash, lock
 *
 * Reduced motion holds the locked frame: the winning seed, its structures
 * inside the 500-block ring with their distances, every constraint ticked.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useCanvas2D } from '@/hooks/useCanvas2D'
import { clamp, damp, easeInOutCubic, easeOutCubic, lerp, seeded } from '@/lib/math'
import type { Project } from '@/content/types'
import { readPalette, type ProjectVisualProps, type VisualPalette } from './types'
import styles from './visual.module.css'

/* ---------------------------------------------------------------- constants */

/** Displayed grid: 31 × 31 cells standing in for the real 101 × 101 sweep. */
const GRID_R = 15
const GRID_D = GRID_R * 2 + 1
const TOTAL_CELLS = GRID_D * GRID_D

/** The 500-block limit, in grid units — a hair over one region wide. */
const R500 = 1.15
const R100 = R500 / 5

const ZOOM_IN = 4.4
const ZOOM_STILL = 3.6

/** Beat lengths per seed attempt: sweep, check, verdict. */
const WS = [1.9, 1.15, 0.85, 1.9, 1.25]
const WC = [1.0, 0.9, 0.8, 0.8, 1.2]
const WV = [0.5, 0.45, 0.45, 0.45, 1.6]
const ATTEMPTS = WS.length

/** Fraction of the sweep spent in the overworld when a fortress is required. */
const OW_SHARE = 0.62

const KIND_NAMES = ['VILLAGE', 'OUTPOST', 'MONUMENT', 'FORTRESS']
const FORTRESS = 3

const DASH: number[] = [2, 3]
const FINE: number[] = [1, 4]
const NODASH: number[] = []

/** The other two strongholds the query checks — context, drawn faint. */
const OTHER_HOLDS = [3.8, -2.5, -4.1, 3.1]

/* --------------------------------------------------------- the square spiral */

function buildSpiral(turns: number): Float32Array {
  const pts: number[] = [0, 0]
  let x = 0
  let y = 0
  let len = 1
  let dir = 0
  for (let k = 0; k < turns; k += 1) {
    x += (dir === 0 ? 1 : dir === 2 ? -1 : 0) * len
    y += (dir === 1 ? 1 : dir === 3 ? -1 : 0) * len
    pts.push(x, y)
    dir = (dir + 1) & 3
    if ((dir & 1) === 0) len += 1
  }
  let m = 0
  for (let i = 0; i < pts.length; i += 1) m = Math.max(m, Math.abs(pts[i]))
  const out = new Float32Array(pts.length)
  for (let i = 0; i < pts.length; i += 1) out[i] = pts[i] / (m || 1)
  return out
}

const SPIRAL = buildSpiral(9)
/** Same mark, four segments — what survives at a handful of pixels. */
const SPIRAL_S = buildSpiral(4)

/* ------------------------------------------------------------- the schedule */

interface Near {
  kind: number
  found: boolean
  ok: boolean
  /** Distance from the stronghold, in region-widths. */
  d: number
  ang: number
  text: string
}

interface Hit {
  x: number
  y: number
  ring: number
  kind: number
  nether: boolean
}

interface Attempt {
  /** Pre-built label — the draw loop never assembles strings. */
  label: string
  hits: Hit[]
  near: Near[]
  pass: boolean
  ws: number
  wc: number
  wv: number
  weight: number
  t0: number
  t1: number
}

interface Run {
  attempts: Attempt[]
}

/** Scratch cell — module scope so the ring walk allocates nothing. */
const CELL = { x: 0, y: 0 }

/** i-th cell of the square ring at radius r, walked clockwise from its corner. */
function ringCell(r: number, i: number): void {
  if (r <= 0) {
    CELL.x = 0
    CELL.y = 0
    return
  }
  const side = r * 2
  const k = ((i % (side * 4)) + side * 4) % (side * 4)
  if (k < side) {
    CELL.x = -r + k
    CELL.y = -r
  } else if (k < side * 2) {
    CELL.x = r
    CELL.y = -r + (k - side)
  } else if (k < side * 3) {
    CELL.x = r - (k - side * 2)
    CELL.y = r
  } else {
    CELL.x = -r
    CELL.y = r - (k - side * 3)
  }
}

function groupDigits(n: number): string {
  const s = String(Math.round(n))
  let out = ''
  for (let i = 0; i < s.length; i += 1) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ' '
    out += s[i]
  }
  return out
}

function buildRun(kinds: number[], salt: number): Run {
  const rnd = seeded(0x5eed01 + salt * 7919)
  const attempts: Attempt[] = []
  let total = 0

  for (let a = 0; a < ATTEMPTS; a += 1) {
    const pass = a === ATTEMPTS - 1

    const hits: Hit[] = []
    const count = 6 + Math.floor(rnd() * 6)
    for (let i = 0; i < count; i += 1) {
      const ring = 2 + Math.floor(rnd() * (GRID_R - 1))
      ringCell(ring, Math.floor(rnd() * ring * 8))
      const kind = kinds[Math.floor(rnd() * kinds.length)]
      hits.push({ x: CELL.x, y: CELL.y, ring, kind, nether: kind === FORTRESS })
    }

    const near: Near[] = []
    const failIdx = Math.floor(rnd() * kinds.length)
    for (let k = 0; k < kinds.length; k += 1) {
      const bad = !pass && k === failIdx
      const missing = bad && rnd() < 0.45
      const d = missing ? 0 : bad ? R500 * (1.18 + rnd() * 0.55) : R500 * (0.62 + rnd() * 0.28)
      // Fanned across the right half; the left stays clear for the ring labels.
      const ang = ((k + 0.32 + rnd() * 0.36) / kinds.length) * Math.PI - Math.PI * 0.5
      near.push({
        kind: kinds[k],
        found: !missing,
        ok: !missing && d <= R500,
        d,
        ang,
        text: missing ? 'NONE' : `${Math.round((d / R500) * 500)} B`,
      })
    }

    const weight = WS[a] + WC[a] + WV[a]
    attempts.push({
      label: `SEED ${groupDigits(1_000_000_000 + Math.floor(rnd() * 8_999_999_999))}`,
      hits,
      near,
      pass,
      ws: WS[a],
      wc: WC[a],
      wv: WV[a],
      weight,
      t0: 0,
      t1: 0,
    })
    total += weight
  }

  let acc = 0
  for (let i = 0; i < attempts.length; i += 1) {
    attempts[i].t0 = acc / total
    acc += attempts[i].weight
    attempts[i].t1 = acc / total
  }
  return { attempts }
}

function attemptAt(run: Run, clock: number): number {
  const last = run.attempts.length - 1
  let i = 0
  while (i < last && clock >= run.attempts[i].t1) i += 1
  return i
}

/** The clock at which an attempt is most legible: its verdict, settled. */
function holdClock(a: Attempt): number {
  return a.t0 + ((a.ws + a.wc + a.wv * 0.72) / a.weight) * (a.t1 - a.t0)
}

/* ------------------------------------------------------------------ layout */

interface Layout {
  w: number
  h: number
  chrome: boolean
  detail: boolean
  cx: number
  cy: number
  side: number
  cell: number
  headX: number
  headY: number
  panelX: number
  panelW: number
  rowH: number
  micro: number
  nano: number
  fontMicro: string
  fontNano: string
  fontSeed: string
}

function computeLayout(w: number, h: number, chrome: boolean): Layout {
  const padX = clamp(w * 0.055, 10, 40)
  const padTop = clamp(h * 0.06, 8, 18)
  // The chip row wraps to two lines once the canvas is narrower than its chips.
  const padBot = clamp(h * 0.05, 8, 16) + (chrome ? (w < 560 ? 58 : 32) : 0)
  const detail = w >= 300 && h >= 190

  const micro = clamp(Math.round(Math.min(w, h) * 0.028), 8, 11)
  const nano = Math.max(7, micro - 2)
  const headH = detail ? micro + nano + 12 : 0
  const top = padTop + headH

  const availH = Math.max(40, h - top - padBot)
  const wantPanel = detail && w >= 430 && h >= 230
  const panelW = wantPanel ? clamp(w * 0.19, 84, 126) : 0
  const gap = wantPanel ? clamp(w * 0.035, 12, 26) : 0
  const availW = Math.max(40, w - padX * 2 - panelW - gap)
  const side = Math.max(40, Math.min(availW, availH))
  // Grid and panel travel together, centred as one group.
  const startX = Math.max(padX, (w - (side + gap + panelW)) * 0.5)
  const cx = startX + side * 0.5
  const cy = top + availH * 0.5

  return {
    w,
    h,
    chrome,
    detail,
    cx,
    cy,
    side,
    cell: side / GRID_D,
    headX: padX,
    headY: padTop,
    panelX: panelW ? Math.min(startX + side + gap, w - padX - panelW) : 0,
    panelW,
    rowH: micro + 7,
    micro,
    nano,
    fontMicro: `${micro}px ui-monospace, monospace`,
    fontNano: `${nano}px ui-monospace, monospace`,
    fontSeed: `${micro + 1}px ui-monospace, monospace`,
  }
}

/* --------------------------------------------------------------- utilities */

function metricNumber(project: Project | undefined, label: string, fallback: number): number {
  const found = project?.metrics.find((m) => m.label === label)
  return typeof found?.numeric === 'number' ? found.numeric : fallback
}

function metricText(project: Project | undefined, label: string, fallback: string): string {
  const found = project?.metrics.find((m) => m.label === label)
  return found?.value ?? fallback
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

/** One structure glyph — thin, 4 strokes at most, readable at 5px. */
function glyph(ctx: CanvasRenderingContext2D, kind: number, x: number, y: number, r: number): void {
  if (r < 0.6) return
  ctx.beginPath()
  if (kind === 0) {
    ctx.moveTo(x - r, y + r)
    ctx.lineTo(x - r, y - r * 0.15)
    ctx.lineTo(x, y - r)
    ctx.lineTo(x + r, y - r * 0.15)
    ctx.lineTo(x + r, y + r)
    ctx.closePath()
  } else if (kind === 1) {
    ctx.moveTo(x - r * 0.55, y + r)
    ctx.lineTo(x - r * 0.55, y - r * 0.45)
    ctx.lineTo(x + r * 0.55, y - r * 0.45)
    ctx.lineTo(x + r * 0.55, y + r)
    ctx.moveTo(x - r, y - r * 0.45)
    ctx.lineTo(x + r, y - r * 0.45)
    ctx.moveTo(x, y - r * 0.45)
    ctx.lineTo(x, y - r)
  } else if (kind === 2) {
    ctx.moveTo(x, y - r)
    ctx.lineTo(x + r, y)
    ctx.lineTo(x, y + r)
    ctx.lineTo(x - r, y)
    ctx.closePath()
    ctx.moveTo(x - r * 0.32, y)
    ctx.lineTo(x + r * 0.32, y)
  } else {
    ctx.moveTo(x - r, y + r)
    ctx.lineTo(x - r, y - r * 0.25)
    ctx.lineTo(x + r, y - r * 0.25)
    ctx.lineTo(x + r, y + r)
    ctx.moveTo(x - r * 0.95, y - r)
    ctx.lineTo(x + r * 0.95, y - r)
  }
  ctx.stroke()
}

/** The stronghold: a square spiral, drawn from the cached unit path. */
function spiral(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  // Below a handful of pixels the full winding turns to mush — drop turns first.
  const p = r < 9 ? SPIRAL_S : SPIRAL
  ctx.beginPath()
  ctx.moveTo(x + p[0] * r, y + p[1] * r)
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(x + p[i] * r, y + p[i + 1] * r)
  ctx.stroke()
}

/* ------------------------------------------------------------ the component */

export function VoxelMotion(props: ProjectVisualProps) {
  const { project, progress, reducedMotion = false, interactive = true, className } = props
  const chrome = interactive !== false

  const regionsOW = metricNumber(project, 'Regions scanned per query', 10201)
  const regionsNether = metricNumber(project, 'Nether regions per fortress query', 90601)
  const version = metricText(project, 'Minecraft version', '1.21')
  const period = clamp(project?.presentation.duration ?? 24, 12, 32)

  const [mask, setMask] = useState<boolean[]>(() => [true, true, true, false])
  const [status, setStatus] = useState('SCANNING')
  const [shownSeed, setShownSeed] = useState(0)

  const kinds = useMemo(() => {
    const out: number[] = []
    for (let i = 0; i < KIND_NAMES.length; i += 1) if (mask[i]) out.push(i)
    return out.length ? out : [0]
  }, [mask])
  const salt = useMemo(
    () => kinds.reduce((acc, k) => acc | (1 << k), 0) * 31 + kinds.length,
    [kinds],
  )
  const run = useMemo(() => buildRun(kinds, salt), [kinds, salt])
  const netherOn = kinds.indexOf(FORTRESS) >= 0

  const layoutRef = useRef<Layout | null>(null)
  const paletteRef = useRef<VisualPalette | null>(null)
  const paletteAtRef = useRef(-1)
  const clockRef = useRef(0)
  const firstRef = useRef(true)
  const dirtyRef = useRef(true)
  const restartRef = useRef(false)
  const hoverRef = useRef(false)
  const hoverXRef = useRef(0)
  const hoverYRef = useRef(0)
  const countRef = useRef(-1)
  const countTextRef = useRef('')
  const hoverKeyRef = useRef(Number.NaN)
  const hoverTextRef = useRef('')
  const seedWKeyRef = useRef('')
  const seedWRef = useRef(0)
  const statusRef = useRef('')
  const seedRef = useRef(-1)

  const ref = useCanvas2D<HTMLCanvasElement>({
    setup: ({ ctx, w, h }) => {
      layoutRef.current = computeLayout(w, h, chrome)
      paletteRef.current = readPalette(ctx.canvas)
      paletteAtRef.current = -1
      firstRef.current = true
      dirtyRef.current = true
      // Cached text metrics are font-size dependent — a resize invalidates them.
      seedWKeyRef.current = ''
      countRef.current = -1
    },

    draw: ({ ctx, w, h, t, dt }) => {
      let layout = layoutRef.current
      if (!layout || layout.w !== w || layout.h !== h || layout.chrome !== chrome) {
        layout = computeLayout(w, h, chrome)
        layoutRef.current = layout
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

      /* ---- master clock -------------------------------------------------- */

      if (restartRef.current) {
        clockRef.current = 0
        restartRef.current = false
        firstRef.current = true
      }

      let clock: number
      if (reducedMotion) {
        clock = holdClock(run.attempts[run.attempts.length - 1])
        clockRef.current = clock
      } else if (typeof progress === 'number') {
        const target = clamp(Number.isFinite(progress) ? progress : 0) * 0.99999
        clock = firstRef.current ? target : damp(clockRef.current, target, 14, dt)
        clockRef.current = clock
      } else {
        clock = (clockRef.current + dt / period) % 1
        clockRef.current = clock
      }

      if (reducedMotion && !dirtyRef.current) return

      /* ---- where are we in the search ------------------------------------ */

      const ai = attemptAt(run, clock)
      const at = run.attempts[ai]
      const beats = ((clock - at.t0) / (at.t1 - at.t0)) * at.weight
      const scanP = clamp(beats / at.ws)
      const checkP = clamp((beats - at.ws) / at.wc)
      const verdP = clamp((beats - at.ws - at.wc) / at.wv)

      // Two passes when a fortress is required: overworld, then the nether.
      const netherPass = netherOn && scanP > OW_SHARE
      const np = netherPass ? (scanP - OW_SHARE) / (1 - OW_SHARE) : 0
      const sweepP = netherOn ? (netherPass ? np : scanP / OW_SHARE) : scanP
      const owFade = netherPass ? 1 - clamp((np - 0.02) / 0.12) : 1

      // Constant cells per second — so the ring slows as its perimeter grows.
      const cellsDone = sweepP * TOTAL_CELLS
      const ring = Math.min(GRID_R, Math.floor((Math.sqrt(cellsDone) + 1) / 2))
      const before = ring === 0 ? 0 : (2 * ring - 1) * (2 * ring - 1)
      const perim = ring === 0 ? 1 : ring * 8
      const idxF = clamp(cellsDone - before, 0, perim)
      const ringF = ring + idxF / perim

      const zoomOut = Math.min(0.5, at.ws * 0.4)
      let zoom: number
      if (reducedMotion) zoom = ZOOM_STILL
      else if (beats < zoomOut) zoom = lerp(ZOOM_IN, 1, easeInOutCubic(beats / zoomOut))
      else if (beats < at.ws) zoom = 1
      else zoom = lerp(1, ZOOM_IN, easeInOutCubic(clamp(checkP / 0.5)))

      const locked = at.pass && verdP > 0
      const flash = at.pass ? Math.sin(clamp(verdP / 0.5) * Math.PI) : 0
      const strike = at.pass ? 0 : easeOutCubic(clamp(verdP / 0.4))
      const closeUp = zoom > 1.3 ? clamp((zoom - 1.3) / 1.3) : 0
      const far = 1 - clamp((zoom - 1.35) / 1.5)

      /* ---- frame --------------------------------------------------------- */

      const s = layout.cell * zoom
      const half = layout.side * 0.5
      const cx = layout.cx
      const cy = layout.cy

      ctx.clearRect(0, 0, w, h)
      ctx.lineJoin = 'round'
      ctx.lineCap = 'butt'
      ctx.setLineDash(NODASH)

      ctx.save()
      ctx.beginPath()
      ctx.rect(cx - half, cy - half, layout.side, layout.side)
      ctx.clip()

      /* ---- swept ground -------------------------------------------------- */

      if (netherPass && owFade > 0.01) {
        ctx.globalAlpha = 0.055 * owFade
        ctx.fillStyle = inkSoft
        const e = (GRID_R + 0.5) * s
        ctx.fillRect(cx - e, cy - e, e * 2, e * 2)
      }
      if (ring > 0 || sweepP >= 1) {
        const e = (sweepP >= 1 ? GRID_R + 0.5 : ring - 0.5) * s
        ctx.globalAlpha = 0.06
        ctx.fillStyle = inkSoft
        ctx.fillRect(cx - e, cy - e, e * 2, e * 2)
      }

      /* ---- the region lattice -------------------------------------------- */

      ctx.lineWidth = 0.75
      ctx.strokeStyle = inkFaint
      ctx.globalAlpha = 0.22
      ctx.beginPath()
      for (let i = -GRID_R - 1; i <= GRID_R; i += 1) {
        const p = (i + 0.5) * s
        if (Math.abs(p) <= half) {
          ctx.moveTo(cx + p, cy - half)
          ctx.lineTo(cx + p, cy + half)
          ctx.moveTo(cx - half, cy + p)
          ctx.lineTo(cx + half, cy + p)
        }
      }
      ctx.stroke()

      // The nether grid is nine times the size — its lattice is finer.
      if (netherPass) {
        ctx.globalAlpha = 0.12 * clamp(np * 6)
        ctx.setLineDash(FINE)
        ctx.beginPath()
        for (let i = -GRID_R * 3; i <= GRID_R * 3; i += 1) {
          const p = (i + 0.5) * s * 0.333
          if (Math.abs(p) <= half) {
            ctx.moveTo(cx + p, cy - half)
            ctx.lineTo(cx + p, cy + half)
            ctx.moveTo(cx - half, cy + p)
            ctx.lineTo(cx + half, cy + p)
          }
        }
        ctx.stroke()
        ctx.setLineDash(NODASH)
      }

      /* ---- the frontier: cells being visited right now -------------------- */

      if (scanP < 1) {
        // Cells are culled against the stage, so the sweep survives the camera.
        const lim = half / s + 1
        const done = Math.floor(idxF)
        ctx.globalAlpha = 0.13
        ctx.fillStyle = inkSoft
        for (let i = 0; i <= done; i += 1) {
          ringCell(ring, i)
          if (Math.abs(CELL.x) > lim || Math.abs(CELL.y) > lim) continue
          ctx.fillRect(cx + (CELL.x - 0.5) * s, cy + (CELL.y - 0.5) * s, s, s)
        }
        ctx.fillStyle = accent
        const glow = Math.max(1, Math.round(perim * 0.16))
        for (let i = Math.max(0, done - glow); i <= done; i += 1) {
          ringCell(ring, i)
          if (Math.abs(CELL.x) > lim || Math.abs(CELL.y) > lim) continue
          ctx.globalAlpha = 0.42 * (1 - (done - i) / glow)
          ctx.fillRect(cx + (CELL.x - 0.5) * s, cy + (CELL.y - 0.5) * s, s, s)
        }

        // The cursor itself, and the hairlines it drags across the grid.
        ringCell(ring, Math.floor(idxF))
        const ax = CELL.x
        const ay = CELL.y
        ringCell(ring, Math.floor(idxF) + 1)
        const f = idxF - Math.floor(idxF)
        const px = cx + lerp(ax, CELL.x, f) * s
        const py = cy + lerp(ay, CELL.y, f) * s
        ctx.globalAlpha = 0.16
        ctx.strokeStyle = accent
        ctx.lineWidth = 0.75
        ctx.beginPath()
        ctx.moveTo(px, cy - half)
        ctx.lineTo(px, cy + half)
        ctx.moveTo(cx - half, py)
        ctx.lineTo(cx + half, py)
        ctx.stroke()
        ctx.globalAlpha = 0.9
        ctx.lineWidth = 1.1
        ctx.strokeRect(px - s * 0.5, py - s * 0.5, s, s)
      }

      /* ---- structures found out in the grid -------------------------------- */

      ctx.lineWidth = 0.9
      for (let i = 0; i < at.hits.length; i += 1) {
        const hit = at.hits[i]
        const pass = hit.nether === netherPass
        const a = easeOutCubic(clamp((ringF - hit.ring) / 0.7)) * far * (pass ? 1 : owFade)
        if (a <= 0.02) continue
        const x = cx + hit.x * s
        const y = cy + hit.y * s
        if (Math.abs(x - cx) > half || Math.abs(y - cy) > half) continue
        ctx.globalAlpha = a * 0.75
        ctx.strokeStyle = inkSoft
        glyph(ctx, hit.kind, x, y, clamp(s * 0.3, 2.2, 7))
      }

      /* ---- the other two strongholds this query checks --------------------- */

      if (closeUp > 0.02) {
        ctx.globalAlpha = 0.3 * closeUp
        for (let i = 0; i < OTHER_HOLDS.length; i += 2) {
          const x = cx + OTHER_HOLDS[i] * s
          const y = cy + OTHER_HOLDS[i + 1] * s
          if (Math.abs(x - cx) > half + 20 || Math.abs(y - cy) > half + 20) continue
          ctx.strokeStyle = inkFaint
          ctx.lineWidth = 0.75
          spiral(ctx, x, y, clamp(R100 * s * 0.6, 2, 9))
          ctx.setLineDash(DASH)
          ctx.beginPath()
          ctx.arc(x, y, R500 * s, 0, Math.PI * 2)
          ctx.stroke()
          ctx.setLineDash(NODASH)
        }
      }

      /* ---- the stronghold, and its two radii ------------------------------- */

      const ringCol = locked ? accent : inkFaint
      ctx.setLineDash(DASH)
      ctx.lineWidth = 0.75
      ctx.strokeStyle = ringCol
      ctx.globalAlpha = 0.45 + 0.45 * closeUp * (locked ? 1 : 0.4)
      ctx.beginPath()
      ctx.arc(cx, cy, R500 * s, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 0.3 + 0.3 * closeUp
      ctx.beginPath()
      ctx.arc(cx, cy, R100 * s, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash(NODASH)

      ctx.globalAlpha = 0.9
      ctx.strokeStyle = locked ? accent : ink
      ctx.lineWidth = 1.1
      spiral(ctx, cx, cy, clamp(R100 * s * 0.85, 2.2, 16))

      if (layout.detail && closeUp > 0.35) {
        ctx.globalAlpha = closeUp * 0.55
        ctx.fillStyle = inkFaint
        ctx.font = layout.fontNano
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        ctx.fillText('500 B', cx - R500 * s - 4, cy)
      }

      /* ---- the check: every required structure measured -------------------- */

      if (closeUp > 0.02) {
        const cp = verdP > 0 ? 1 : checkP
        ctx.font = layout.fontNano
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        for (let k = 0; k < at.near.length; k += 1) {
          const n = at.near[k]
          if (!n.found) continue
          const rev = clamp((cp - 0.08 - k * 0.13) / 0.34)
          if (rev <= 0.01) continue
          const ex = cx + Math.cos(n.ang) * n.d * s
          const ey = cy + Math.sin(n.ang) * n.d * s
          const grow = easeOutCubic(rev)
          const col = n.ok ? accent : inkSoft

          ctx.globalAlpha = closeUp * (n.ok ? 0.85 : 0.5) * (1 - strike * 0.5)
          ctx.strokeStyle = col
          ctx.lineWidth = n.ok ? 1.1 : 0.75
          ctx.beginPath()
          ctx.moveTo(cx, cy)
          ctx.lineTo(lerp(cx, ex, grow), lerp(cy, ey, grow))
          ctx.stroke()

          // Where a failing structure crosses the limit, mark the crossing.
          if (!n.ok && rev > 0.6) {
            const cxr = cx + Math.cos(n.ang) * R500 * s
            const cyr = cy + Math.sin(n.ang) * R500 * s
            ctx.globalAlpha = closeUp * 0.8
            ctx.strokeStyle = accent
            ctx.lineWidth = 1.1
            ctx.beginPath()
            ctx.moveTo(cxr - Math.sin(n.ang) * 3.5, cyr + Math.cos(n.ang) * 3.5)
            ctx.lineTo(cxr + Math.sin(n.ang) * 3.5, cyr - Math.cos(n.ang) * 3.5)
            ctx.stroke()
          }

          const pop = easeOutCubic(clamp((rev - 0.55) / 0.45))
          if (pop > 0.02) {
            const gr = clamp(s * 0.12, 3, 9)
            ctx.globalAlpha = closeUp * pop * (1 - strike * 0.55)
            ctx.strokeStyle = col
            ctx.lineWidth = n.ok ? 1.1 : 0.9
            glyph(ctx, n.kind, ex, ey, gr * (0.6 + 0.4 * pop))
            if (layout.detail && rev > 0.85) {
              // The reading sits outboard of its glyph, on the same ray.
              const off = gr + layout.nano * 1.15
              const lx = ex + Math.cos(n.ang) * off
              const ly = ey + Math.sin(n.ang) * off
              const lw = n.text.length * layout.nano * 0.62
              // Knock the lattice out from under the measurement so it stays legible.
              ctx.globalAlpha = closeUp * 0.8
              ctx.fillStyle = bg
              ctx.fillRect(lx - lw * 0.5 - 2, ly - layout.nano * 0.7, lw + 4, layout.nano * 1.4)
              ctx.globalAlpha = closeUp * 0.9 * (1 - strike * 0.5)
              ctx.fillStyle = n.ok ? accent : inkFaint
              ctx.fillText(n.text, lx, ly)
            }
          }
        }
      }

      /* ---- hover: read a region off the grid -------------------------------- */

      if (chrome && hoverRef.current && !reducedMotion && zoom < 2.4) {
        const hx = hoverXRef.current
        const hy = hoverYRef.current
        if (Math.abs(hx - cx) < half && Math.abs(hy - cy) < half) {
          const gx = Math.round((hx - cx) / s)
          const gy = Math.round((hy - cy) / s)
          ctx.globalAlpha = 0.45
          ctx.strokeStyle = inkSoft
          ctx.lineWidth = 0.75
          ctx.strokeRect(cx + (gx - 0.5) * s, cy + (gy - 0.5) * s, s, s)
          if (layout.detail) {
            const key = gx * 1000 + gy
            if (key !== hoverKeyRef.current) {
              hoverKeyRef.current = key
              hoverTextRef.current = `R ${gx >= 0 ? '+' : '−'}${Math.abs(gx)} ${
                gy >= 0 ? '+' : '−'
              }${Math.abs(gy)}`
            }
            ctx.globalAlpha = 0.55
            ctx.fillStyle = inkFaint
            ctx.font = layout.fontNano
            ctx.textAlign = 'left'
            ctx.textBaseline = 'bottom'
            ctx.fillText(hoverTextRef.current, cx + (gx + 0.7) * s, cy + (gy - 0.6) * s)
          }
        }
      }

      /* ---- the match flash ---------------------------------------------------- */

      if (flash > 0.01) {
        ctx.globalAlpha = flash * 0.09
        ctx.fillStyle = accent
        ctx.fillRect(cx - half, cy - half, layout.side, layout.side)
      }

      ctx.restore()

      /* ---- stage frame --------------------------------------------------------- */

      ctx.globalAlpha = locked ? 0.5 + flash * 0.5 : 0.35
      ctx.strokeStyle = locked ? accent : inkFaint
      ctx.lineWidth = 0.75
      ctx.strokeRect(cx - half, cy - half, layout.side, layout.side)

      /* ---- header: the seed, and the regions burned on it ---------------------- */

      if (layout.detail) {
        const total = netherPass ? regionsNether : regionsOW
        const shown = Math.round((netherPass ? np : netherOn ? scanP / OW_SHARE : scanP) * total)
        const step = Math.max(1, Math.round(total / 240))
        const q = Math.round(shown / step)
        if (q !== countRef.current) {
          countRef.current = q
          countTextRef.current = `${groupDigits(Math.min(total, q * step))} / ${groupDigits(total)} ${
            netherPass ? 'NETHER' : 'OVERWORLD'
          }`
        }

        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.font = layout.fontSeed
        ctx.globalAlpha = locked ? 1 : 0.75
        ctx.fillStyle = locked ? accent : inkSoft
        ctx.fillText(at.label, layout.headX, layout.headY)

        if (at.label !== seedWKeyRef.current) {
          seedWKeyRef.current = at.label
          seedWRef.current = ctx.measureText(at.label).width
        }
        const tw = seedWRef.current
        if (strike > 0.01) {
          ctx.globalAlpha = 0.55
          ctx.strokeStyle = inkFaint
          ctx.lineWidth = 0.75
          ctx.beginPath()
          ctx.moveTo(layout.headX, layout.headY + layout.micro * 0.6)
          ctx.lineTo(layout.headX + tw * strike, layout.headY + layout.micro * 0.6)
          ctx.stroke()
        }
        if (locked) {
          const grow = easeOutCubic(clamp(verdP / 0.35))
          ctx.globalAlpha = 0.9
          ctx.strokeStyle = accent
          ctx.lineWidth = 1.1
          ctx.beginPath()
          ctx.moveTo(layout.headX, layout.headY + layout.micro + 3)
          ctx.lineTo(layout.headX + tw * grow, layout.headY + layout.micro + 3)
          ctx.stroke()
        }

        ctx.font = layout.fontNano
        ctx.globalAlpha = 0.5
        ctx.fillStyle = inkFaint
        ctx.fillText(countTextRef.current, layout.headX, layout.headY + layout.micro + 6)

        if (!chrome) {
          ctx.textAlign = 'right'
          ctx.globalAlpha = 0.45
          ctx.fillText(`MC ${version}`, w - layout.headX, layout.headY + layout.micro + 6)
        }
      }

      /* ---- constraint panel ----------------------------------------------------- */

      if (layout.panelW > 0) {
        const px = layout.panelX
        const pw = layout.panelW
        let py = cy - half + layout.nano

        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.font = layout.fontNano
        ctx.globalAlpha = 0.45
        ctx.fillStyle = inkFaint
        ctx.fillText('REQUIRED', px, py)
        py += layout.nano + 8

        ctx.globalAlpha = 0.3
        ctx.strokeStyle = inkFaint
        ctx.lineWidth = 0.75
        ctx.beginPath()
        ctx.moveTo(px, py - layout.nano * 0.6)
        ctx.lineTo(px + pw, py - layout.nano * 0.6)
        ctx.stroke()

        const cp = verdP > 0 ? 1 : checkP
        for (let k = 0; k < at.near.length; k += 1) {
          const n = at.near[k]
          const rev = clamp((cp - 0.08 - k * 0.13) / 0.34)
          const settled = rev > 0.85
          const col = settled ? (n.ok ? ink : inkFaint) : inkSoft

          ctx.globalAlpha = 0.8
          ctx.strokeStyle = col
          ctx.lineWidth = 0.9
          glyph(ctx, n.kind, px + 4, py, 3.4)

          ctx.globalAlpha = settled && n.ok ? 0.95 : 0.6
          ctx.fillStyle = col
          ctx.font = layout.fontNano
          ctx.textAlign = 'left'
          ctx.fillText(KIND_NAMES[n.kind], px + 12, py)

          if (rev > 0.5) {
            ctx.textAlign = 'right'
            ctx.globalAlpha = settled ? (n.ok ? 0.95 : 0.55) : 0.35
            ctx.fillStyle = n.ok && settled ? accent : inkFaint
            ctx.fillText(n.text, px + pw, py)
          }
          if (settled && !n.ok) {
            ctx.globalAlpha = 0.4
            ctx.strokeStyle = inkFaint
            ctx.lineWidth = 0.75
            ctx.beginPath()
            ctx.moveTo(px + 11, py)
            ctx.lineTo(px + pw, py)
            ctx.stroke()
          }
          py += layout.rowH
        }

        py += 4
        ctx.globalAlpha = 0.3
        ctx.strokeStyle = inkFaint
        ctx.lineWidth = 0.75
        ctx.beginPath()
        ctx.moveTo(px, py - layout.rowH * 0.5)
        ctx.lineTo(px + pw, py - layout.rowH * 0.5)
        ctx.stroke()

        ctx.textAlign = 'left'
        ctx.globalAlpha = 0.45
        ctx.fillStyle = inkFaint
        ctx.fillText('WITHIN 500 B OF', px, py)
        ctx.fillText('3 STRONGHOLDS', px, py + layout.nano + 3)

        if (verdP > 0.05) {
          const vy = py + (layout.nano + 3) * 2 + 6
          ctx.globalAlpha = at.pass ? 0.95 : 0.55
          ctx.fillStyle = at.pass ? accent : inkFaint
          ctx.font = layout.fontMicro
          ctx.fillText(at.pass ? 'MATCH' : 'REJECT', px, vy)
          if (at.pass) {
            ctx.globalAlpha = 0.6
            ctx.strokeStyle = signal
            ctx.lineWidth = 1.1
            ctx.beginPath()
            ctx.moveTo(px, vy + layout.micro)
            ctx.lineTo(px + pw * easeOutCubic(clamp(verdP / 0.5)), vy + layout.micro)
            ctx.stroke()
          }
        }
      }

      ctx.globalAlpha = 1

      /* ---- readout ------------------------------------------------------------- */

      const nextStatus = at.pass && verdP > 0.15
        ? 'SEED LOCKED'
        : !at.pass && verdP > 0.15
          ? 'REJECTED'
          : scanP < 1
            ? 'SCANNING'
            : 'CHECKING'
      if (statusRef.current !== nextStatus) {
        statusRef.current = nextStatus
        setStatus(nextStatus)
      }
      if (seedRef.current !== ai) {
        seedRef.current = ai
        setShownSeed(ai)
      }

      firstRef.current = false
      dirtyRef.current = false
    },
  })

  /* ---- interaction: change the required set, re-run the scan ---------------- */

  const restart = useMemo(
    () => () => {
      restartRef.current = true
      dirtyRef.current = true
    },
    [],
  )

  const toggle = useMemo(
    () => (i: number) => {
      setMask((prev) => {
        const next = prev.slice()
        next[i] = !next[i]
        if (!next.some(Boolean)) return prev
        return next
      })
      restartRef.current = true
      dirtyRef.current = true
    },
    [],
  )

  useEffect(() => {
    dirtyRef.current = true
  }, [run])

  useEffect(() => {
    if (!chrome || reducedMotion) return
    const canvas = ref.current
    if (!canvas) return

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      restart()
    }
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      hoverXRef.current = e.clientX - rect.left
      hoverYRef.current = e.clientY - rect.top
      hoverRef.current = true
      dirtyRef.current = true
    }
    const onLeave = () => {
      hoverRef.current = false
      dirtyRef.current = true
    }

    canvas.style.cursor = 'pointer'
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)

    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.style.cursor = 'default'
    }
  }, [ref, chrome, reducedMotion, restart])

  return (
    <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
      <canvas ref={ref} className={styles.canvas} />
      {chrome && (
        <div className={styles.readout} aria-hidden="true">
          SEED {shownSeed + 1}/{ATTEMPTS} · {status}
          <br />
          {netherOn ? `${groupDigits(regionsNether)} NETHER` : `${groupDigits(regionsOW)} REGIONS`}
        </div>
      )}
      {chrome && (
        <div className={styles.hud}>
          {KIND_NAMES.map((name, i) => (
            <button
              key={name}
              type="button"
              className={styles.chip}
              data-on={mask[i] ? 'true' : 'false'}
              style={{ cursor: 'pointer' }}
              onClick={() => toggle(i)}
              aria-pressed={mask[i]}
            >
              {name}
            </button>
          ))}
          <button
            type="button"
            className={styles.chip}
            style={{ cursor: 'pointer' }}
            onClick={restart}
            aria-label="Re-run the scan"
          >
            RE-RUN
          </button>
          <span className={styles.chip}>MC {version}</span>
        </div>
      )}
    </div>
  )
}
