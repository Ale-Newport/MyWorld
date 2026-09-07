'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useCanvas2D, type CanvasContext } from '@/hooks/useCanvas2D'
import { clamp, easeInOutCubic, easeOutCubic, lerp, range, seeded } from '@/lib/math'
import { readPalette, type ProjectVisualProps, type VisualPalette } from './types'
import styles from './visual.module.css'

/* ==================================================================
   CHESS ASSISTANT — the pipeline replays itself.

   screenshot → corner regression (MobileNetV2, 384×384) → local
   refine → rectify → 64 crops @64×64 → 13-class CNN → FEN →
   Stockfish best move.

   Every number drawn here comes from the project entry: 13 classes,
   64 squares, 99.6% piece accuracy, 384×384 detector, 64×64 crops.
   ================================================================== */

/** Italian Game, Two Knights — the position the pipeline reads. */
const START_FEN = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R'

/** Thirteen classes: empty, six white, six black. */
const CLASS_LETTERS = ['·', 'P', 'N', 'B', 'R', 'Q', 'K', 'p', 'n', 'b', 'r', 'q', 'k']
const STAGE_LABELS = ['DETECT', 'RECTIFY', 'CLASSIFY', 'FEN', 'ENGINE']

const LOOP = 24
const FEN_ORDER = 'PNBRQK'

/** Algebraic square → index (0 = a8, 63 = h1). */
function sqi(name: string): number {
  const f = name.charCodeAt(0) - 97
  const r = name.charCodeAt(1) - 49
  return (7 - r) * 8 + f
}

/** The engine line the easter egg plays out, click by click. */
const LINE = [
  { from: sqi('f3'), to: sqi('g5'), san: 'Ng5' },
  { from: sqi('d7'), to: sqi('d5'), san: 'd5' },
  { from: sqi('e4'), to: sqi('d5'), san: 'exd5' },
  { from: sqi('c6'), to: sqi('a5'), san: 'Na5' },
  { from: sqi('c4'), to: sqi('b5'), san: 'Bb5+' },
]

/** Discarded candidates, flickering while the engine searches. */
const CANDIDATES = [
  [sqi('d2'), sqi('d4')],
  [sqi('b1'), sqi('c3')],
  [sqi('e1'), sqi('g1')],
  [sqi('h2'), sqi('h3')],
]

const FONT_7 = '7px ui-monospace, monospace'
const FONT_8 = '8px ui-monospace, monospace'
const FONT_9 = '9px ui-monospace, monospace'
const DASH_SEARCH: number[] = [2, 3]
const DASH_NONE: number[] = []

/* ---------------------------- geometry ---------------------------- */

interface Pt { x: number; y: number }

function setQuad(
  q: Float32Array,
  x0: number, y0: number, x1: number, y1: number,
  x2: number, y2: number, x3: number, y3: number,
) {
  q[0] = x0; q[1] = y0; q[2] = x1; q[3] = y1
  q[4] = x2; q[5] = y2; q[6] = x3; q[7] = y3
}

/** Bilinear point inside a quad (TL, TR, BR, BL). u,v in 0..1. */
function quadPoint(q: Float32Array, u: number, v: number, o: Pt) {
  const tx = lerp(q[0], q[2], u)
  const ty = lerp(q[1], q[3], u)
  const bx = lerp(q[6], q[4], u)
  const by = lerp(q[7], q[5], u)
  o.x = lerp(tx, bx, v)
  o.y = lerp(ty, by, v)
}

function quadAt(
  x0: number, y0: number, x1: number, y1: number,
  x2: number, y2: number, u: number, o: Pt,
) {
  const iu = 1 - u
  o.x = iu * iu * x0 + 2 * iu * u * x1 + u * u * x2
  o.y = iu * iu * y0 + 2 * iu * u * y1 + u * u * y2
}

/* ------------------------- piece silhouettes ----------------------- */

function circlePath(cx: number, cy: number, r: number, n: number): number[] {
  const a: number[] = []
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2
    a.push(cx + Math.cos(t) * r, cy + Math.sin(t) * r)
  }
  return a
}

/** Closed sub-paths per piece type, normalised to a unit square. */
const PIECE: number[][][] = [
  [],
  // pawn
  [
    [-0.23, 0.31, -0.23, 0.26, -0.11, 0.07, -0.055, -0.04, 0.055, -0.04, 0.11, 0.07, 0.23, 0.26, 0.23, 0.31],
    circlePath(0, -0.21, 0.115, 14),
  ],
  // knight
  [[
    -0.22, 0.31, 0.24, 0.31, 0.22, 0.11, 0.16, -0.07, 0.08, -0.18,
    0.10, -0.31, -0.02, -0.24, -0.13, -0.25, -0.25, -0.05, -0.12, -0.01, -0.17, 0.12,
  ]],
  // bishop
  [
    [0, -0.34, 0.085, -0.23, 0.135, -0.09, 0.12, 0.02, 0.175, 0.10, -0.175, 0.10, -0.12, 0.02, -0.135, -0.09, -0.085, -0.23],
    [-0.23, 0.31, 0.23, 0.31, 0.17, 0.17, -0.17, 0.17],
  ],
  // rook
  [[
    -0.25, -0.30, -0.14, -0.30, -0.14, -0.21, -0.05, -0.21, -0.05, -0.30,
    0.05, -0.30, 0.05, -0.21, 0.14, -0.21, 0.14, -0.30, 0.25, -0.30,
    0.25, -0.12, 0.18, -0.05, 0.18, 0.16, 0.26, 0.31, -0.26, 0.31,
    -0.18, 0.16, -0.18, -0.05, -0.25, -0.12,
  ]],
  // queen
  [[
    -0.30, -0.28, -0.21, -0.04, -0.15, -0.20, -0.06, -0.04, 0, -0.32,
    0.06, -0.04, 0.15, -0.20, 0.21, -0.04, 0.30, -0.28,
    0.26, 0.16, 0.29, 0.31, -0.29, 0.31, -0.26, 0.16,
  ]],
  // king
  [
    [-0.05, -0.35, 0.05, -0.35, 0.05, -0.27, 0.135, -0.27, 0.135, -0.18, 0.05, -0.18, 0.05, -0.12, -0.05, -0.12, -0.05, -0.18, -0.135, -0.18, -0.135, -0.27, -0.05, -0.27],
    [-0.24, 0.31, -0.20, 0.10, -0.15, -0.02, -0.06, -0.09, 0.06, -0.09, 0.15, -0.02, 0.20, 0.10, 0.24, 0.31],
  ],
]

function drawGlyph(
  ctx: CanvasRenderingContext2D,
  code: number,
  x: number,
  y: number,
  s: number,
  pal: VisualPalette,
  alpha: number,
) {
  if (code <= 0 || alpha <= 0.01) return
  const black = code > 6
  const subs = PIECE[black ? code - 6 : code]
  if (!subs || subs.length === 0) return
  ctx.beginPath()
  for (let k = 0; k < subs.length; k++) {
    const pts = subs[k]
    ctx.moveTo(x + pts[0] * s, y + pts[1] * s)
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(x + pts[i] * s, y + pts[i + 1] * s)
    ctx.closePath()
  }
  ctx.globalAlpha = alpha
  ctx.fillStyle = black ? pal.ink : pal.bg
  ctx.fill()
  ctx.globalAlpha = alpha * 0.92
  ctx.strokeStyle = pal.ink
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.globalAlpha = 1
}

/* ------------------------------ FEN -------------------------------- */

function parseFen(fen: string): Uint8Array {
  const b = new Uint8Array(64)
  let i = 0
  for (let k = 0; k < fen.length && i < 64; k++) {
    const ch = fen[k]
    if (ch === '/') continue
    const n = ch.charCodeAt(0) - 48
    if (n >= 1 && n <= 8) { i += n; continue }
    const up = ch.toUpperCase()
    const t = FEN_ORDER.indexOf(up)
    if (t < 0) continue
    b[i] = ch === up ? t + 1 : t + 7
    i++
  }
  return b
}

function fenFromBoard(b: Uint8Array, ply: number): string {
  let out = ''
  for (let r = 0; r < 8; r++) {
    let gap = 0
    for (let f = 0; f < 8; f++) {
      const code = b[r * 8 + f]
      if (!code) { gap++; continue }
      if (gap) { out += String(gap); gap = 0 }
      const t = code > 6 ? code - 6 : code
      const ch = FEN_ORDER[t - 1]
      out += code > 6 ? ch.toLowerCase() : ch
    }
    if (gap) out += String(gap)
    if (r < 7) out += '/'
  }
  return `${out} ${ply % 2 === 0 ? 'w' : 'b'} KQkq - 0 ${4 + Math.floor(ply / 2)}`
}

/* ------------------------------ scene ------------------------------ */

interface Scene {
  ready: boolean
  cx: number
  cy: number
  S: number
  warp: number
  ang: number
  sq: Float32Array
  desk: Float32Array
  now: Float32Array
  guess: Float32Array
  pred: Float32Array
  jit: Float32Array
  winA: Float32Array
  wins: Float32Array
  frame: Float32Array
  panelOn: boolean
  panelX: number
  panelY: number
  panelW: number
}

export function ChessMotion(props: ProjectVisualProps) {
  const { progress, reducedMotion = false, interactive = true, className } = props

  const base = useMemo(() => parseFen(START_FEN), [])
  const board = useMemo(() => {
    const b = new Uint8Array(64)
    b.set(base)
    return b
  }, [base])

  /** Per-square softmax noise — deterministic, built once. */
  const conf = useMemo(() => {
    const rnd = seeded(0x5ce55)
    const a = new Float32Array(64 * 13)
    for (let i = 0; i < a.length; i++) a[i] = 0.0004 + rnd() * 0.0028
    return a
  }, [])

  const sc = useMemo<Scene>(() => ({
    ready: false,
    cx: 0, cy: 0, S: 1, warp: 0, ang: 0,
    sq: new Float32Array(8),
    desk: new Float32Array(8),
    now: new Float32Array(8),
    guess: new Float32Array(8),
    pred: new Float32Array(8),
    jit: new Float32Array(4),
    winA: new Float32Array(4),
    wins: new Float32Array(8),
    frame: new Float32Array(3),
    panelOn: false, panelX: 0, panelY: 0, panelW: 86,
  }), [])

  const pa = useMemo<Pt>(() => ({ x: 0, y: 0 }), [])
  const pb = useMemo<Pt>(() => ({ x: 0, y: 0 }), [])
  const pc = useMemo<Pt>(() => ({ x: 0, y: 0 }), [])
  const anim = useMemo(() => ({ on: false, t: 0, from: -1, to: -1, code: 0 }), [])
  const fenState = useMemo(() => ({ ply: -1, str: '' }), [])

  const plyRef = useRef(0)
  const hoverRef = useRef(-1)
  const arcRef = useRef(0)
  const stageRef = useRef(-1)
  const staticKeyRef = useRef('')
  const readARef = useRef<HTMLDivElement>(null)
  const readBRef = useRef<HTMLDivElement>(null)
  const readTextRef = useRef('')
  const chipRefs = useRef<(HTMLSpanElement | null)[]>([])

  /* ----------------------------- layout ---------------------------- */

  const setup = (c: Omit<CanvasContext, 't' | 'dt'>) => {
    const { w, h } = c
    const rnd = seeded(0x9e3779)
    const panelW = 86
    const gap = 26
    const panelOn = w >= 420 && h >= 300
    const area = panelOn ? w - panelW - gap - 14 : w
    const S = Math.min(area * 0.78, h * 0.66)
    // Board and classifier panel are centred as one group.
    const groupW = panelOn ? S + gap + panelW : S
    const left = Math.max(8, (w - groupW) / 2)
    const cx = left + S / 2
    const cy = h * 0.44
    const hs = S / 2

    sc.S = S; sc.cx = cx; sc.cy = cy
    setQuad(sc.sq, cx - hs, cy - hs, cx + hs, cy - hs, cx + hs, cy + hs, cx - hs, cy + hs)

    // The board as it sits on the synthetic desktop: smaller, off
    // centre, slightly rotated, slightly keystoned.
    const dS = S * 0.60
    const hw = dS / 2
    const ang = -0.055
    const ca = Math.cos(ang)
    const sa = Math.sin(ang)
    const dcx = cx + S * 0.07
    const dcy = cy + S * 0.06
    const lx = [-hw * 0.93, hw * 0.93, hw, -hw]
    const ly = [-hw * 0.94, -hw * 0.94, hw, hw]
    for (let i = 0; i < 4; i++) {
      sc.desk[i * 2] = dcx + lx[i] * ca - ly[i] * sa
      sc.desk[i * 2 + 1] = dcy + lx[i] * sa + ly[i] * ca
    }
    sc.ang = ang

    // Raw regressor output, before the local refine search.
    for (let i = 0; i < 4; i++) {
      const a = rnd() * Math.PI * 2
      const r = dS * (0.10 + rnd() * 0.10)
      sc.guess[i * 2] = sc.desk[i * 2] + Math.cos(a) * r
      sc.guess[i * 2 + 1] = sc.desk[i * 2 + 1] + Math.sin(a) * r
      sc.jit[i] = rnd() * 6.283
    }

    // The window the board is composited into, plus two neighbours.
    sc.winA[0] = dcx; sc.winA[1] = dcy
    sc.winA[2] = dS * 1.18; sc.winA[3] = dS * 1.30

    // The screenshot the detector sees, kept fully on canvas.
    const fs = Math.min((w - 16) * 0.92, h * 0.74)
    sc.frame[0] = clamp(cx - fs / 2, 8, Math.max(8, w - 8 - fs))
    sc.frame[1] = Math.max(22, Math.min(h - 10 - fs, cy - fs / 2))
    sc.frame[2] = fs
    sc.wins[0] = sc.frame[0] + fs * 0.06
    sc.wins[1] = sc.frame[1] + fs * (0.12 + rnd() * 0.04)
    sc.wins[2] = fs * 0.30
    sc.wins[3] = fs * 0.22
    sc.wins[4] = sc.frame[0] + fs * (0.02 + rnd() * 0.03)
    sc.wins[5] = sc.frame[1] + fs * 0.62
    sc.wins[6] = fs * 0.24
    sc.wins[7] = fs * 0.30

    sc.panelOn = panelOn
    sc.panelX = Math.min(left + S + gap, w - panelW - 8)
    sc.panelY = Math.max(26, Math.min(h - 240, cy - 110))
    sc.panelW = panelW
    sc.ready = true
    staticKeyRef.current = ''
  }

  /* ------------------------------ draw ----------------------------- */

  const draw = (c: CanvasContext) => {
    const { ctx, w, h, dt } = c
    if (!sc.ready) return
    const pal = readPalette(ref.current)
    const hover = hoverRef.current
    let ply = plyRef.current

    if (reducedMotion) {
      const key = `${w}|${h}|${hover}|${ply}|${pal.ink}|${pal.bg}`
      if (key === staticKeyRef.current) return
      staticKeyRef.current = key
    }

    const p = reducedMotion
      ? 1
      : progress !== undefined
        ? clamp(progress)
        : clamp(((c.t % LOOP) / LOOP) * 1.12)

    const stage = p < 0.30 ? 0 : p < 0.46 ? 1 : p < 0.70 ? 2 : p < 0.82 ? 3 : 4

    // Rewinding the timeline resets the easter-egg line.
    if (stage < 4 && ply !== 0) {
      board.set(base)
      plyRef.current = 0
      ply = 0
      anim.on = false
      arcRef.current = 0
    }
    if (stage !== 4) arcRef.current = 0
    else if (reducedMotion) arcRef.current = 2
    else arcRef.current = Math.min(2, arcRef.current + dt)

    if (anim.on) {
      anim.t = Math.min(1, anim.t + dt * 2.4)
      if (anim.t >= 1) anim.on = false
    }

    ctx.clearRect(0, 0, w, h)
    ctx.lineCap = 'butt'
    ctx.setLineDash(DASH_NONE)

    const warp = easeInOutCubic(range(p, 0.30, 0.46))
    sc.warp = warp
    for (let i = 0; i < 8; i++) sc.now[i] = lerp(sc.desk[i], sc.sq[i], warp)
    const q = sc.now
    const cell = (Math.hypot(q[2] - q[0], q[3] - q[1]) + Math.hypot(q[4] - q[6], q[5] - q[7])) / 16

    const deskA = 1 - range(p, 0.26, 0.44)
    const scanP = range(p, 0.01, 0.16)
    const cornerP = easeOutCubic(range(p, 0.10, 0.30))
    const cornerA = range(p, 0.05, 0.12) * (1 - range(p, 0.40, 0.50))
    const classP = range(p, 0.46, 0.70)
    const head = classP * 64
    const fenA = range(p, 0.68, 0.76)
    const fenP = range(p, 0.70, 0.82)
    const tw = reducedMotion ? 0 : c.t

    /* ---------------------- 1 · synthetic desktop -------------------- */

    if (deskA > 0.01) {
      const fx = sc.frame[0]
      const fy = sc.frame[1]
      const fs = sc.frame[2]
      ctx.lineWidth = 1

      ctx.globalAlpha = deskA * 0.35
      ctx.strokeStyle = pal.inkFaint
      ctx.strokeRect(fx + 0.5, fy + 0.5, fs, fs)
      ctx.beginPath()
      ctx.moveTo(fx, fy + 16.5)
      ctx.lineTo(fx + fs, fy + 16.5)
      ctx.stroke()

      // detector-input corner ticks
      ctx.globalAlpha = deskA * 0.8
      ctx.strokeStyle = pal.inkSoft
      const tk = 12
      ctx.beginPath()
      ctx.moveTo(fx, fy + tk); ctx.lineTo(fx, fy); ctx.lineTo(fx + tk, fy)
      ctx.moveTo(fx + fs - tk, fy); ctx.lineTo(fx + fs, fy); ctx.lineTo(fx + fs, fy + tk)
      ctx.moveTo(fx + fs, fy + fs - tk); ctx.lineTo(fx + fs, fy + fs); ctx.lineTo(fx + fs - tk, fy + fs)
      ctx.moveTo(fx + tk, fy + fs); ctx.lineTo(fx, fy + fs); ctx.lineTo(fx, fy + fs - tk)
      ctx.stroke()

      ctx.globalAlpha = deskA * 0.7
      ctx.fillStyle = pal.inkFaint
      ctx.font = FONT_8
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText('384 × 384', fx + 2, fy - 6)

      // neighbouring windows
      ctx.globalAlpha = deskA * 0.30
      ctx.strokeStyle = pal.inkFaint
      for (let i = 0; i < 2; i++) {
        const x = sc.wins[i * 4]
        const y = sc.wins[i * 4 + 1]
        const ww = sc.wins[i * 4 + 2]
        const hh = sc.wins[i * 4 + 3]
        ctx.strokeRect(x + 0.5, y + 0.5, ww, hh)
        ctx.beginPath()
        ctx.moveTo(x, y + 10.5)
        ctx.lineTo(x + ww, y + 10.5)
        ctx.stroke()
      }

      // the window the board is composited into
      ctx.save()
      ctx.translate(sc.winA[0], sc.winA[1])
      ctx.rotate(sc.ang)
      ctx.globalAlpha = deskA * 0.45
      ctx.fillStyle = pal.bg
      ctx.fillRect(-sc.winA[2] / 2, -sc.winA[3] / 2, sc.winA[2], sc.winA[3])
      ctx.globalAlpha = deskA * 0.55
      ctx.strokeStyle = pal.inkFaint
      ctx.strokeRect(-sc.winA[2] / 2 + 0.5, -sc.winA[3] / 2 + 0.5, sc.winA[2], sc.winA[3])
      ctx.beginPath()
      ctx.moveTo(-sc.winA[2] / 2, -sc.winA[3] / 2 + 12.5)
      ctx.lineTo(sc.winA[2] / 2, -sc.winA[3] / 2 + 12.5)
      ctx.stroke()
      ctx.restore()

      // scan sweep
      if (scanP > 0 && scanP < 1) {
        const sy = fy + fs * scanP
        ctx.globalAlpha = deskA * 0.10
        ctx.fillStyle = pal.accent
        ctx.fillRect(fx, sy - 26, fs, 26)
        ctx.globalAlpha = deskA * 0.75
        ctx.strokeStyle = pal.accent
        ctx.beginPath()
        ctx.moveTo(fx, sy + 0.5)
        ctx.lineTo(fx + fs, sy + 0.5)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    /* ------------------- 2 · board squares and grid ------------------ */

    const boardA = 0.35 + 0.65 * range(p, 0.02, 0.20)
    ctx.globalAlpha = boardA * 0.07
    ctx.fillStyle = pal.ink
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        if (((r + f) & 1) === 0) continue
        quadPoint(q, f / 8, r / 8, pa)
        ctx.beginPath()
        ctx.moveTo(pa.x, pa.y)
        quadPoint(q, (f + 1) / 8, r / 8, pa); ctx.lineTo(pa.x, pa.y)
        quadPoint(q, (f + 1) / 8, (r + 1) / 8, pa); ctx.lineTo(pa.x, pa.y)
        quadPoint(q, f / 8, (r + 1) / 8, pa); ctx.lineTo(pa.x, pa.y)
        ctx.closePath()
        ctx.fill()
      }
    }

    ctx.globalAlpha = boardA * (0.16 + 0.30 * warp)
    ctx.strokeStyle = pal.inkSoft
    ctx.lineWidth = 0.75
    ctx.beginPath()
    for (let i = 1; i < 8; i++) {
      quadPoint(q, i / 8, 0, pa); ctx.moveTo(pa.x, pa.y)
      quadPoint(q, i / 8, 1, pa); ctx.lineTo(pa.x, pa.y)
      quadPoint(q, 0, i / 8, pa); ctx.moveTo(pa.x, pa.y)
      quadPoint(q, 1, i / 8, pa); ctx.lineTo(pa.x, pa.y)
    }
    ctx.stroke()

    ctx.globalAlpha = boardA * 0.55
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(q[0], q[1]); ctx.lineTo(q[2], q[3])
    ctx.lineTo(q[4], q[5]); ctx.lineTo(q[6], q[7])
    ctx.closePath()
    ctx.stroke()
    ctx.globalAlpha = 1

    /* -------------------- 3 · corner regression ---------------------- */

    if (cornerA > 0.01) {
      // Regressed corner, the local search that refines it, and then
      // the same four points carrying the board into the rectified square.
      const jitter = (1 - cornerP) * sc.S * 0.013
      for (let i = 0; i < 4; i++) {
        const gx = lerp(sc.guess[i * 2], sc.desk[i * 2], cornerP)
          + Math.sin(tw * 14 + sc.jit[i]) * jitter
        const gy = lerp(sc.guess[i * 2 + 1], sc.desk[i * 2 + 1], cornerP)
          + Math.cos(tw * 11 + sc.jit[i]) * jitter
        sc.pred[i * 2] = lerp(gx, sc.sq[i * 2], warp)
        sc.pred[i * 2 + 1] = lerp(gy, sc.sq[i * 2 + 1], warp)
      }

      const box = lerp(sc.S * 0.10, 7, cornerP)
      ctx.lineWidth = 1
      ctx.setLineDash(DASH_SEARCH)
      ctx.globalAlpha = cornerA * 0.45
      ctx.strokeStyle = pal.inkSoft
      ctx.beginPath()
      for (let i = 0; i < 4; i++) {
        ctx.rect(sc.pred[i * 2] - box, sc.pred[i * 2 + 1] - box, box * 2, box * 2)
      }
      ctx.stroke()
      ctx.setLineDash(DASH_NONE)

      ctx.globalAlpha = cornerA * (0.20 + 0.45 * cornerP)
      ctx.strokeStyle = pal.accent
      ctx.beginPath()
      ctx.moveTo(sc.pred[0], sc.pred[1])
      ctx.lineTo(sc.pred[2], sc.pred[3])
      ctx.lineTo(sc.pred[4], sc.pred[5])
      ctx.lineTo(sc.pred[6], sc.pred[7])
      ctx.closePath()
      ctx.stroke()

      ctx.globalAlpha = cornerA * (0.6 + 0.4 * cornerP)
      ctx.beginPath()
      for (let i = 0; i < 4; i++) {
        const cxp = sc.pred[i * 2]
        const cyp = sc.pred[i * 2 + 1]
        ctx.moveTo(cxp - 5, cyp); ctx.lineTo(cxp + 5, cyp)
        ctx.moveTo(cxp, cyp - 5); ctx.lineTo(cxp, cyp + 5)
      }
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    /* ------------------- 4 · pixels become pieces -------------------- */

    const gs = cell * 0.98
    for (let i = 0; i < 64; i++) {
      const code = board[i]
      if (!code) continue
      if (anim.on && i === anim.to) continue
      const ci = classP <= 0 ? 0 : clamp(head - i)
      const f = i & 7
      const r = i >> 3
      quadPoint(q, (f + 0.5) / 8, (r + 0.5) / 8, pa)
      if (ci < 0.999) {
        const s = cell * 0.52
        ctx.globalAlpha = (1 - ci) * 0.20 * boardA
        ctx.fillStyle = pal.ink
        ctx.fillRect(pa.x - s / 2, pa.y - s / 2, s, s)
        ctx.globalAlpha = 1
      }
      if (ci > 0.001) {
        const e = easeOutCubic(ci)
        drawGlyph(ctx, code, pa.x, pa.y - (1 - e) * cell * 0.32, gs * lerp(0.84, 1, e), pal, e)
      }
    }

    if (anim.on) {
      const fi = anim.from
      const ti = anim.to
      quadPoint(q, ((fi & 7) + 0.5) / 8, ((fi >> 3) + 0.5) / 8, pa)
      quadPoint(q, ((ti & 7) + 0.5) / 8, ((ti >> 3) + 0.5) / 8, pb)
      const e = easeInOutCubic(anim.t)
      const hop = Math.sin(anim.t * Math.PI) * cell * 0.45
      drawGlyph(ctx, anim.code, lerp(pa.x, pb.x, e), lerp(pa.y, pb.y, e) - hop, gs, pal, 1)
    }

    /* ----------------------- 5 · 64 crops ---------------------------- */

    const focus = classP > 0 && classP < 1 ? clamp(Math.floor(head), 0, 63) : -1
    if (focus >= 0) {
      ctx.lineWidth = 1
      for (let i = Math.max(0, focus - 2); i <= Math.min(63, focus + 1); i++) {
        const d = Math.abs(i - head)
        const a = clamp(1 - d / 2.6)
        if (a <= 0.02) continue
        const f = i & 7
        const r = i >> 3
        quadPoint(q, (f + 0.5) / 8, (r + 0.5) / 8, pa)
        const hsz = cell * lerp(0.62, 0.48, clamp(head - i))
        const arm = cell * 0.17
        ctx.globalAlpha = a * (i === focus ? 0.95 : 0.35)
        ctx.strokeStyle = i === focus ? pal.accent : pal.inkSoft
        ctx.beginPath()
        ctx.moveTo(pa.x - hsz, pa.y - hsz + arm); ctx.lineTo(pa.x - hsz, pa.y - hsz); ctx.lineTo(pa.x - hsz + arm, pa.y - hsz)
        ctx.moveTo(pa.x + hsz - arm, pa.y - hsz); ctx.lineTo(pa.x + hsz, pa.y - hsz); ctx.lineTo(pa.x + hsz, pa.y - hsz + arm)
        ctx.moveTo(pa.x + hsz, pa.y + hsz - arm); ctx.lineTo(pa.x + hsz, pa.y + hsz); ctx.lineTo(pa.x + hsz - arm, pa.y + hsz)
        ctx.moveTo(pa.x - hsz + arm, pa.y + hsz); ctx.lineTo(pa.x - hsz, pa.y + hsz); ctx.lineTo(pa.x - hsz, pa.y + hsz - arm)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    /* -------------------- 6 · classifier read-out -------------------- */

    // The static frame inspects the piece the engine is about to move,
    // so one image carries both the classifier and the suggestion.
    const stillSquare = LINE[Math.min(ply, LINE.length - 1)].from
    const inspect = hover >= 0 ? hover : reducedMotion ? stillSquare : focus
    const panelA = sc.panelOn
      ? hover >= 0 || reducedMotion
        ? 1
        : range(p, 0.46, 0.50) * (1 - range(p, 0.70, 0.78))
      : 0

    if (panelA > 0.01 && inspect >= 0) {
      const px = sc.panelX
      const py = sc.panelY
      const cb = sc.panelW
      const code = board[inspect]
      const f = inspect & 7
      const r = inspect >> 3

      // leader line from the square to the enlarged crop
      quadPoint(q, (f + 0.5) / 8, (r + 0.5) / 8, pa)
      ctx.globalAlpha = panelA * 0.28
      ctx.strokeStyle = pal.inkSoft
      ctx.lineWidth = 0.75
      ctx.beginPath()
      ctx.moveTo(pa.x + cell * 0.5, pa.y)
      ctx.lineTo(px - 10, py + cb / 2)
      ctx.lineTo(px - 2, py + cb / 2)
      ctx.stroke()

      // the 64×64 crop
      ctx.globalAlpha = panelA * (((r + f) & 1) === 1 ? 0.07 : 0.035)
      ctx.fillStyle = pal.ink
      ctx.fillRect(px, py, cb, cb)
      ctx.globalAlpha = panelA * 0.5
      ctx.strokeStyle = pal.inkFaint
      ctx.lineWidth = 1
      ctx.strokeRect(px + 0.5, py + 0.5, cb, cb)
      drawGlyph(ctx, code, px + cb / 2, py + cb / 2, cb * 0.9, pal, panelA)

      ctx.globalAlpha = panelA * 0.6
      ctx.fillStyle = pal.inkFaint
      ctx.font = FONT_7
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillText('64 × 64', px, py - 7)
      ctx.textAlign = 'right'
      ctx.fillText(`${String.fromCharCode(97 + f)}${8 - r}`, px + cb, py - 7)

      // thirteen class confidences
      const rowH = 9
      const y0 = py + cb + 17
      const bx = px + 10
      const bw = sc.panelW - 10
      ctx.textAlign = 'left'
      for (let cIdx = 0; cIdx < 13; cIdx++) {
        const win = cIdx === code
        const v = win ? 0.996 : conf[inspect * 13 + cIdx]
        const len = Math.max(1.5, bw * Math.pow(v, 0.45))
        const yy = y0 + cIdx * rowH
        ctx.globalAlpha = panelA * (win ? 0.95 : 0.45)
        ctx.fillStyle = win ? pal.accent : pal.inkSoft
        ctx.font = FONT_8
        ctx.fillText(CLASS_LETTERS[cIdx], px, yy + 3)
        ctx.globalAlpha = panelA * (win ? 1 : 0.3)
        ctx.fillStyle = win ? pal.accent : pal.inkFaint
        ctx.fillRect(bx, yy - 1.5, len, win ? 3 : 2)
      }
      ctx.globalAlpha = panelA * 0.8
      ctx.fillStyle = pal.accent
      ctx.font = FONT_8
      ctx.textAlign = 'right'
      ctx.fillText('ACC 99.6%', px + sc.panelW, y0 + 13 * rowH + 10)
      ctx.textAlign = 'left'
      ctx.globalAlpha = 1
    }

    /* -------------------------- 7 · hover ---------------------------- */

    if (hover >= 0 && warp > 0.85) {
      const f = hover & 7
      const r = hover >> 3
      quadPoint(q, f / 8, r / 8, pa)
      quadPoint(q, (f + 1) / 8, (r + 1) / 8, pb)
      ctx.globalAlpha = 0.85
      ctx.strokeStyle = pal.accent
      ctx.lineWidth = 1
      ctx.strokeRect(pa.x + 0.5, pa.y + 0.5, pb.x - pa.x - 1, pb.y - pa.y - 1)
      ctx.globalAlpha = 1
    }

    /* --------------------------- 8 · FEN ----------------------------- */

    if (fenA > 0.01) {
      if (fenState.ply !== ply) {
        fenState.ply = ply
        fenState.str = fenFromBoard(board, ply)
      }
      const full = fenState.str
      const maxW = w - 32
      let size = 10
      ctx.font = `${size}px ui-monospace, monospace`
      const measured = ctx.measureText(full).width
      let wpx = measured
      if (measured > maxW) {
        size = Math.max(6, size * (maxW / measured))
        ctx.font = `${size}px ui-monospace, monospace`
        wpx = ctx.measureText(full).width
      }
      const shown = ply > 0 || reducedMotion ? full.length : Math.floor(fenP * full.length)
      const fx = sc.cx - wpx / 2
      const fy = Math.min(sc.cy + sc.S / 2 + 30, h - 26)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.globalAlpha = fenA * 0.75
      ctx.fillStyle = pal.inkSoft
      ctx.fillText(full.slice(0, shown), fx, fy)
      if (shown < full.length) {
        const cw = ctx.measureText(full.slice(0, shown)).width
        ctx.globalAlpha = fenA
        ctx.fillStyle = pal.accent
        ctx.fillRect(fx + cw + 1, fy - size * 0.78, 1.5, size * 0.9)
      }
      ctx.globalAlpha = 1
    }

    /* ------------------------ 9 · Stockfish -------------------------- */

    if (stage === 4) {
      const at = arcRef.current
      const mv = LINE[Math.min(ply, LINE.length - 1)]
      const live = ply < LINE.length

      // discarded candidates flicker while the search runs
      if (ply === 0 && at < 0.85) {
        const fade = clamp(1 - range(at, 0.45, 0.85))
        ctx.lineWidth = 0.75
        ctx.strokeStyle = pal.inkSoft
        for (let i = 0; i < CANDIDATES.length; i++) {
          const on = Math.sin(tw * 9 + i * 2.1) > -0.1 ? 1 : 0.15
          const cnd = CANDIDATES[i]
          quadPoint(q, ((cnd[0] & 7) + 0.5) / 8, ((cnd[0] >> 3) + 0.5) / 8, pa)
          quadPoint(q, ((cnd[1] & 7) + 0.5) / 8, ((cnd[1] >> 3) + 0.5) / 8, pb)
          const mx = (pa.x + pb.x) / 2
          const my = (pa.y + pb.y) / 2
          const dx = pb.x - pa.x
          const dy = pb.y - pa.y
          const d = Math.hypot(dx, dy) || 1
          const cxp = mx - (dy / d) * d * 0.24
          const cyp = my + (dx / d) * d * 0.24
          ctx.globalAlpha = fade * 0.28 * on
          ctx.beginPath()
          ctx.moveTo(pa.x, pa.y)
          ctx.quadraticCurveTo(cxp, cyp, pb.x, pb.y)
          ctx.stroke()
        }
        ctx.globalAlpha = 1
      }

      if (live) {
        const ap = easeOutCubic(clamp(range(at, 0.35, 1.15)))
        quadPoint(q, ((mv.from & 7) + 0.5) / 8, ((mv.from >> 3) + 0.5) / 8, pa)
        quadPoint(q, ((mv.to & 7) + 0.5) / 8, ((mv.to >> 3) + 0.5) / 8, pb)
        const dx = pb.x - pa.x
        const dy = pb.y - pa.y
        const d = Math.hypot(dx, dy) || 1
        const side = dy > 0 ? -1 : 1
        const cxp = (pa.x + pb.x) / 2 - (dy / d) * d * 0.30 * side
        const cyp = (pa.y + pb.y) / 2 + (dx / d) * d * 0.30 * side

        // origin square
        ctx.globalAlpha = 0.45 * ap
        ctx.strokeStyle = pal.accent
        ctx.lineWidth = 1
        ctx.setLineDash(DASH_SEARCH)
        quadPoint(q, (mv.from & 7) / 8, (mv.from >> 3) / 8, pc)
        ctx.strokeRect(pc.x + 0.5, pc.y + 0.5, cell - 1, cell - 1)
        ctx.setLineDash(DASH_NONE)

        if (ap > 0.001) {
          const c1x = lerp(pa.x, cxp, ap)
          const c1y = lerp(pa.y, cyp, ap)
          quadAt(pa.x, pa.y, cxp, cyp, pb.x, pb.y, ap, pc)
          ctx.globalAlpha = 0.95
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.moveTo(pa.x, pa.y)
          ctx.quadraticCurveTo(c1x, c1y, pc.x, pc.y)
          ctx.stroke()

          const ang = Math.atan2(pc.y - c1y, pc.x - c1x)
          const ah = Math.max(6, cell * 0.26)
          ctx.beginPath()
          ctx.moveTo(pc.x, pc.y)
          ctx.lineTo(pc.x - Math.cos(ang - 0.42) * ah, pc.y - Math.sin(ang - 0.42) * ah)
          ctx.lineTo(pc.x - Math.cos(ang + 0.42) * ah, pc.y - Math.sin(ang + 0.42) * ah)
          ctx.closePath()
          ctx.fillStyle = pal.accent
          ctx.fill()
        }

        if (ap > 0.98) {
          const pulse = 0.5 + 0.5 * Math.sin(tw * 2.4)
          ctx.globalAlpha = 0.20 + 0.25 * pulse
          ctx.lineWidth = 1
          quadPoint(q, (mv.to & 7) / 8, (mv.to >> 3) / 8, pc)
          ctx.strokeRect(pc.x + 0.5, pc.y + 0.5, cell - 1, cell - 1)

          ctx.globalAlpha = 0.9
          ctx.fillStyle = pal.accent
          ctx.font = FONT_9
          ctx.textAlign = 'center'
          ctx.textBaseline = 'alphabetic'
          ctx.fillText(mv.san, pb.x, pb.y - cell * 0.72)
          ctx.textAlign = 'left'
        }
        ctx.globalAlpha = 1
      }
    }

    /* --------------------------- read-outs --------------------------- */

    if (stage !== stageRef.current) {
      stageRef.current = stage
      for (let i = 0; i < chipRefs.current.length; i++) {
        const el = chipRefs.current[i]
        if (el) el.dataset.on = i === stage ? 'true' : 'false'
      }
    }

    const done = Math.min(64, Math.floor(head))
    const lineA = stage === 0
      ? 'MOBILENETV2 · 384'
      : stage === 1 ? 'HOMOGRAPHY' : stage === 2 ? 'CNN 32·64·128' : stage === 3 ? 'SERIALISE → FEN' : 'STOCKFISH'
    const lineB = stage === 0
      ? `CORNERS ${cornerP > 0.98 ? 4 : Math.floor(cornerP * 4)}/4`
      : stage === 1
        ? '8 × 8 · 64'
        : stage < 4
          ? `${done}/64 · 99.6%`
          : ply < LINE.length ? LINE[Math.min(ply, LINE.length - 1)].san : 'CLICK TO REPLAY'
    const joined = `${lineA}|${lineB}`
    if (joined !== readTextRef.current) {
      readTextRef.current = joined
      if (readARef.current) readARef.current.textContent = lineA
      if (readBRef.current) readBRef.current.textContent = lineB
    }
  }

  const ref = useCanvas2D<HTMLCanvasElement>({ setup, draw })

  /* --------------------------- interaction -------------------------- */

  useEffect(() => {
    const cv = ref.current
    if (!cv || interactive === false) return

    const squareAt = (px: number, py: number) => {
      if (!sc.ready || sc.warp < 0.85) return -1
      const hs = sc.S / 2
      const u = (px - (sc.cx - hs)) / sc.S
      const v = (py - (sc.cy - hs)) / sc.S
      if (u < 0 || u > 1 || v < 0 || v > 1) return -1
      return Math.min(7, Math.floor(v * 8)) * 8 + Math.min(7, Math.floor(u * 8))
    }

    const onMove = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect()
      const i = squareAt(e.clientX - r.left, e.clientY - r.top)
      if (i === hoverRef.current) return
      hoverRef.current = i
      const want = i >= 0 && stageRef.current === 4 ? 'pointer' : 'default'
      if (cv.style.cursor !== want) cv.style.cursor = want
    }

    const onLeave = () => {
      hoverRef.current = -1
      cv.style.cursor = 'default'
    }

    const onDown = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect()
      const i = squareAt(e.clientX - r.left, e.clientY - r.top)
      if (i < 0 || stageRef.current !== 4) return
      const ply = plyRef.current
      if (ply >= LINE.length) {
        board.set(base)
        plyRef.current = 0
        anim.on = false
        arcRef.current = 0
        return
      }
      const mv = LINE[ply]
      const code = board[mv.from]
      board[mv.from] = 0
      board[mv.to] = code
      plyRef.current = ply + 1
      arcRef.current = 0
      if (!reducedMotion) {
        anim.on = true
        anim.t = 0
        anim.from = mv.from
        anim.to = mv.to
        anim.code = code
      }
    }

    cv.addEventListener('pointermove', onMove)
    cv.addEventListener('pointerleave', onLeave)
    cv.addEventListener('pointerdown', onDown)
    return () => {
      cv.removeEventListener('pointermove', onMove)
      cv.removeEventListener('pointerleave', onLeave)
      cv.removeEventListener('pointerdown', onDown)
    }
  }, [interactive, reducedMotion, ref, sc, board, base, anim])

  return (
    <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
      <canvas ref={ref} className={styles.canvas} />
      <div className={styles.readout}>
        <div ref={readARef}>MOBILENETV2 · 384</div>
        <div ref={readBRef}>CORNERS 0/4</div>
      </div>
      <div className={styles.hud}>
        {STAGE_LABELS.map((label, i) => (
          <span
            key={label}
            ref={(el) => { chipRefs.current[i] = el }}
            className={styles.chip}
            data-on={i === 0 ? 'true' : 'false'}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}
