'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useCanvas2D } from '@/hooks/useCanvas2D'
import { clamp, damp, easeOutCubic, lerp, seeded } from '@/lib/math'
import { readPalette, type ProjectVisualProps, type VisualPalette } from './types'
import styles from './visual.module.css'

/* ============================================================
   StockMotion — Stock Market Simulator
   A limit order book, drawn as it actually behaves.

   · price engine: geometric random walk, sigma 0.1 %, 5 ticks/s
   · 4 trader threads emit orders on parallel lanes
   · orders slide in from both edges and rest at a price level
   · crossing bid/ask annihilate at the RESTING order's limit
     price; the remainder re-rests. The tape prints the fill.
   · the matched-trade counter climbs 1 -> 10 -> ... -> 40,000+

   The whole frame is a pure function of one number (`ts`), so it
   scrubs backwards under scroll and freezes cleanly on hover.
   ============================================================ */

/* ---- simulator constants (mirror the Java configuration) ---- */
const TICK_HZ = 5
const TICK_SIZE = 0.05
const BASE_PRICE = 20
const SIGMA = 0.001
const TOTAL_TICKS = 360
const DURATION = TOTAL_TICKS / TICK_HZ
const THREADS = 4
const SYMBOLS = 3
const TRADE_TARGET = 40000

/* ---- fixed-capacity storage (nothing allocates in draw) ----- */
const SPAN = 128
const ORIGIN = Math.round(BASE_PRICE / TICK_SIZE) - SPAN / 2
const MAX_EVENTS = 1300
const WINDOW = 90
const CANCEL_FADE = 30
const MAX_TRADES = 96

/* ---- motion timings ---------------------------------------- */
const TRAVEL = 0.45
const FLASH_LIFE = 0.5
const TAPE_ROWS = 8
const LANE_SEC = 6
const HIST_TICKS = 80
const TAU = Math.PI * 2

const font = (px: number) => `${px}px ui-monospace, monospace`
const F7 = font(7)
const F8 = font(8)
const F9 = font(9)
const F10 = font(10)

const DASH: number[] = [2, 5]
const NODASH: number[] = []

/** Below this the HTML chips/readout would swamp the frame; the canvas takes over. */
const COMPACT_W = 560
const COMPACT_H = 380

const LOG_TARGET = Math.log10(TRADE_TARGET)
const DECADES = ['1', '10', '100', '1K', '10K', '40K+']
const DECADE_POS = [0, 1 / LOG_TARGET, 2 / LOG_TARGET, 3 / LOG_TARGET, 4 / LOG_TARGET, 1]

/* ============================================================ */

interface Sim {
  price: Float32Array
  evT: Float32Array
  evPx: Int32Array
  evQty: Float32Array
  evSide: Uint8Array
  evTh: Uint8Array
  n: number
}

interface Book {
  bidQ: Float32Array
  askQ: Float32Array
  bidN: Float32Array
  askN: Float32Array
  bidA: Float32Array
  askA: Float32Array
  tPx: Int32Array
  tQty: Float32Array
  tT: Float32Array
  tTh: Uint8Array
  lane: Int32Array
  seen: Uint8Array
  nT: number
  lo: number
  hi: number
}

interface Geom {
  ok: boolean
  top: number
  rowH: number
  rows: number
  half: number
  midIdx: number
  x0: number
  x1: number
  ts: number
}

const modIdx = (i: number, n: number) => ((i % n) + n) % n

function line(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number) {
  ctx.beginPath()
  ctx.moveTo(ax, ay)
  ctx.lineTo(bx, by)
  ctx.stroke()
}

/** Letter-spaced technical label. Monospace, so one measure serves every glyph. */
function tracked(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, sp: number) {
  const adv = ctx.measureText('M').width + sp
  for (let i = 0; i < s.length; i++) ctx.fillText(s.charAt(i), x + i * adv, y)
}

function groupInt(n: number): string {
  const s = String(Math.max(0, Math.round(n)))
  if (s.length <= 3) return s
  let out = ''
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ','
    out += s.charAt(i)
  }
  return out
}

/** Deterministic order flow + price walk. Built once, never mutated. */
function buildSim(): Sim {
  const rnd = seeded(0x51_0c_4b)
  const price = new Float32Array(TOTAL_TICKS + 1)
  let p = BASE_PRICE
  price[0] = p
  for (let k = 1; k <= TOTAL_TICKS; k++) {
    const u1 = Math.max(1e-6, rnd())
    const u2 = rnd()
    const g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(TAU * u2)
    p *= Math.exp(SIGMA * g)
    price[k] = p
  }
  // de-trend so the walk is periodic — the self-running loop has no seam
  const drift = price[TOTAL_TICKS] - price[0]
  for (let k = 0; k <= TOTAL_TICKS; k++) price[k] -= (drift * k) / TOTAL_TICKS

  const evT = new Float32Array(MAX_EVENTS)
  const evPx = new Int32Array(MAX_EVENTS)
  const evQty = new Float32Array(MAX_EVENTS)
  const evSide = new Uint8Array(MAX_EVENTS)
  const evTh = new Uint8Array(MAX_EVENTS)

  let n = 0
  for (let k = 0; k < TOTAL_TICKS && n < MAX_EVENTS; k++) {
    const midIdx = Math.round(price[k] / TICK_SIZE)
    const m = 2 + Math.floor(rnd() * 3)
    for (let j = 0; j < m && n < MAX_EVENTS; j++) {
      const side = rnd() < 0.5 ? 0 : 1
      const r = rnd()
      // ~19 % of orders are marketable and will cross the book
      const off = r < 0.19 ? -Math.floor(rnd() * 3) : 1 + Math.floor(rnd() * 8)
      evT[n] = (k + (j + rnd() * 0.9) / m) / TICK_HZ
      evPx[n] = side === 0 ? midIdx - off : midIdx + off
      evQty[n] = 5 + Math.floor(rnd() * 12) * 5
      evSide[n] = side
      evTh[n] = Math.floor(rnd() * THREADS)
      n++
    }
  }
  return { price, evT, evPx, evQty, evSide, evTh, n }
}

function makeBook(): Book {
  return {
    bidQ: new Float32Array(SPAN),
    askQ: new Float32Array(SPAN),
    bidN: new Float32Array(SPAN),
    askN: new Float32Array(SPAN),
    bidA: new Float32Array(SPAN),
    askA: new Float32Array(SPAN),
    tPx: new Int32Array(MAX_TRADES),
    tQty: new Float32Array(MAX_TRADES),
    tT: new Float32Array(MAX_TRADES),
    tTh: new Uint8Array(MAX_TRADES),
    lane: new Int32Array(THREADS),
    seen: new Uint8Array(THREADS),
    nT: 0,
    lo: SPAN,
    hi: -1,
  }
}

/** Last event with time <= ts, or -1. */
function findPtr(evT: Float32Array, n: number, ts: number): number {
  let lo = 0
  let hi = n - 1
  let res = -1
  while (lo <= hi) {
    const m = (lo + hi) >> 1
    if (evT[m] <= ts) {
      res = m
      lo = m + 1
    } else hi = m - 1
  }
  return res
}

/**
 * Rebuilds the book from the trailing event window and runs the
 * matching engine: price-time priority, execution at the resting
 * order's limit price, remainder re-rests. Older resting orders
 * fade out — that is the cancel flow.
 */
function replay(sim: Sim, book: Book, from: number, to: number) {
  book.bidQ.fill(0)
  book.askQ.fill(0)
  book.bidN.fill(0)
  book.askN.fill(0)
  book.bidA.fill(-1)
  book.askA.fill(-1)
  book.lane.fill(0)
  book.nT = 0
  book.lo = SPAN
  book.hi = -1
  if (to < from) return

  const n = sim.n
  for (let i = from; i <= to; i++) {
    const ii = modIdx(i, n)
    const s = sim.evPx[ii] - ORIGIN
    if (s < 0 || s >= SPAN) continue
    const wgt = clamp((WINDOW - (to - i)) / CANCEL_FADE, 0, 1)
    if (wgt <= 0) continue

    const q = sim.evQty[ii] * wgt
    book.lane[sim.evTh[ii]] += 1
    if (sim.evSide[ii] === 0) {
      book.bidQ[s] += q
      book.bidN[s] += wgt
      book.bidA[s] = i
    } else {
      book.askQ[s] += q
      book.askN[s] += wgt
      book.askA[s] = i
    }
    if (s < book.lo) book.lo = s
    if (s > book.hi) book.hi = s

    const et = sim.evT[ii] + Math.floor(i / n) * DURATION
    let guard = 0
    while (guard++ < 20) {
      let bb = -1
      for (let k = book.hi; k >= book.lo; k--) {
        if (book.bidQ[k] > 0.5) {
          bb = k
          break
        }
      }
      if (bb < 0) break
      let ba = -1
      for (let k = book.lo; k <= book.hi; k++) {
        if (book.askQ[k] > 0.5) {
          ba = k
          break
        }
      }
      if (ba < 0 || bb < ba) break

      const qty = Math.min(book.bidQ[bb], book.askQ[ba])
      // execution price is the RESTING order's limit — the one that arrived first
      const px = (book.bidA[bb] < book.askA[ba] ? bb : ba) + ORIGIN
      book.bidQ[bb] -= qty
      book.askQ[ba] -= qty
      if (book.bidQ[bb] <= 0.5) {
        book.bidQ[bb] = 0
        book.bidN[bb] = 0
        book.bidA[bb] = -1
      }
      if (book.askQ[ba] <= 0.5) {
        book.askQ[ba] = 0
        book.askN[ba] = 0
        book.askA[ba] = -1
      }
      const ti = book.nT % MAX_TRADES
      book.tPx[ti] = px
      book.tQty[ti] = qty
      book.tT[ti] = et
      book.tTh[ti] = sim.evTh[ii]
      book.nT++
    }
  }
}

/* ============================================================ */

export function StockMotion(props: ProjectVisualProps) {
  const { progress, reducedMotion = false, active, interactive = true, className } = props

  const sim = useMemo(() => buildSim(), [])
  const book = useMemo(() => makeBook(), [])
  const geom = useRef<Geom>({
    ok: false,
    top: 0,
    rowH: 1,
    rows: 1,
    half: 0,
    midIdx: 0,
    x0: 0,
    x1: 0,
    ts: 0,
  })

  const palRef = useRef<VisualPalette | null>(null)
  const frameRef = useRef(0)
  const tsRef = useRef(0)
  const boostRef = useRef(0)
  const countRef = useRef(1)
  const hoverRef = useRef(-1)
  const frozenRef = useRef(-1)
  const drawnRef = useRef(false)
  const countElRef = useRef<HTMLSpanElement>(null)
  const countStrRef = useRef('')
  const roomyRef = useRef(true)
  const [roomy, setRoomy] = useState(true)

  const ref = useCanvas2D<HTMLCanvasElement>({
    setup: ({ ctx }) => {
      palRef.current = readPalette(ctx.canvas)
      drawnRef.current = false
    },
    draw: ({ ctx, w, h, dt }) => {
      const frame = frameRef.current++
      if (!palRef.current || frame % 15 === 0) palRef.current = readPalette(ctx.canvas)
      const P = palRef.current
      if (reducedMotion && drawnRef.current) return

      /* ---- clock ------------------------------------------- */
      let ts: number
      let count: number
      const scrubbed = typeof progress === 'number'

      if (reducedMotion) {
        ts = DURATION * 0.9
        count = TRADE_TARGET
      } else if (scrubbed) {
        ts = clamp(progress ?? 0, 0, 1) * DURATION
        if (frozenRef.current >= 0) ts = frozenRef.current
        count = Math.pow(TRADE_TARGET, clamp(ts / DURATION, 0, 1))
      } else {
        boostRef.current = damp(boostRef.current, 0, 2.4, dt)
        const rate = 1 + boostRef.current * 2.2
        if (active !== false && frozenRef.current < 0) {
          tsRef.current += dt * rate
          countRef.current = Math.min(
            TRADE_TARGET,
            countRef.current * Math.exp((dt * rate * Math.log(TRADE_TARGET)) / DURATION),
          )
        }
        ts = frozenRef.current >= 0 ? frozenRef.current : tsRef.current
        count = countRef.current
      }

      // event stream wraps only when self-running, so scroll-linked
      // playback still starts from a genuinely empty book
      const wrap = !reducedMotion && !scrubbed
      const n = sim.n
      const cyc = Math.floor(ts / DURATION)
      const tsIn = ts - cyc * DURATION
      const ptr = cyc * n + findPtr(sim.evT, n, tsIn)
      const from = wrap ? ptr - WINDOW + 1 : Math.max(0, ptr - WINDOW + 1)
      replay(sim, book, from, ptr)

      /* ---- price engine state ------------------------------ */
      const kf = clamp(tsIn * TICK_HZ, 0, TOTAL_TICKS - 1e-4)
      const k0 = Math.floor(kf)
      const midP = lerp(sim.price[k0], sim.price[k0 + 1], easeOutCubic(clamp((kf - k0) * 2.6, 0, 1)))
      const midIdx = Math.round(midP / TICK_SIZE)

      /* ---- layout ------------------------------------------ */
      ctx.clearRect(0, 0, w, h)
      const pad = clamp(w * 0.045, 14, 32)
      const stageTop = pad + 26
      const wide = w >= COMPACT_W && h >= COMPACT_H
      if (wide !== roomyRef.current) {
        roomyRef.current = wide
        setRoomy(wide)
      }
      const hudReserve = wide ? 36 : 8
      let bandH = clamp(h * 0.16, 34, 62)
      let stageBottom = h - pad - hudReserve - bandH - 12
      if (stageBottom - stageTop < 80) {
        bandH = 0
        stageBottom = h - pad - hudReserve - 6
      }
      const stageH = stageBottom - stageTop
      const showBand = bandH > 0

      if (stageH < 44 || w < 190) {
        ctx.globalAlpha = 0.35
        ctx.strokeStyle = P.ink
        ctx.lineWidth = 1
        line(ctx, pad, h / 2, w - pad, h / 2)
        ctx.globalAlpha = 1
        geom.current.ok = false
        if (reducedMotion) drawnRef.current = true
        return
      }

      let rows = Math.round(stageH / 24)
      if (rows % 2 === 0) rows -= 1
      rows = clamp(rows, 5, 21)
      const rowH = Math.min(stageH / rows, 24)
      const half = (rows - 1) / 2
      const lH = rows * rowH
      const lTop = stageTop + (stageH - lH) / 2

      const showTrace = w > 560
      const showTape = w > 660
      const gap = 16
      const traceW = clamp(w * 0.22, 90, 190)
      const tapeW = clamp(w * 0.16, 82, 130)
      const x0 = pad + (showTrace ? traceW + gap : 0)
      const x1 = w - pad - (showTape ? tapeW + gap : 0)
      const cx = (x0 + x1) / 2
      const spineHalf = clamp((x1 - x0) * 0.07, 18, 30)
      const maxBar = clamp(x1 - cx - spineHalf - 14, 12, 230)
      const bh = Math.min(rowH * 0.4, 9)

      const yOfIdx = (pi: number) => lTop + (half - (pi - midIdx) + 0.5) * rowH
      const yOfPrice = (pr: number) => lTop + (half - (pr / TICK_SIZE - midIdx) + 0.5) * rowH
      const yMid = yOfPrice(midP)

      geom.current.ok = true
      geom.current.top = lTop
      geom.current.rowH = rowH
      geom.current.rows = rows
      geom.current.half = half
      geom.current.midIdx = midIdx
      geom.current.x0 = x0
      geom.current.x1 = x1
      geom.current.ts = ts

      /* ---- visible depth, best bid / best ask -------------- */
      let maxQ = 60
      let bestBid = -1
      let bestAsk = -1
      for (let j = 0; j < rows; j++) {
        const pi = midIdx + (half - j)
        const s = pi - ORIGIN
        if (s < 0 || s >= SPAN) continue
        const bq = book.bidQ[s]
        const aq = book.askQ[s]
        if (bq > maxQ) maxQ = bq
        if (aq > maxQ) maxQ = aq
        if (bq > 0.5 && pi > bestBid) bestBid = pi
        if (aq > 0.5 && (bestAsk < 0 || pi < bestAsk)) bestAsk = pi
      }

      /* ---- header: decade ladder + book selector ----------- */
      const dw = Math.min(150, (x1 - x0) * 0.42)
      const hy = pad + 8
      ctx.lineWidth = 1
      ctx.strokeStyle = P.ink
      ctx.globalAlpha = 0.14
      line(ctx, x0, hy, x0 + dw, hy)
      const cp = clamp(Math.log10(Math.max(1, count)) / LOG_TARGET, 0, 1)
      ctx.globalAlpha = 0.5
      line(ctx, x0, hy, x0 + dw * cp, hy)
      let decade = 0
      for (let i = 0; i < DECADE_POS.length; i++) {
        const nx = x0 + dw * DECADE_POS[i]
        ctx.globalAlpha = DECADE_POS[i] <= cp + 1e-6 ? 0.4 : 0.16
        line(ctx, nx, hy - 3, nx, hy + 3)
        if (DECADE_POS[i] <= cp + 1e-6) decade = i
      }
      const ax = x0 + dw * DECADE_POS[decade]
      ctx.globalAlpha = 1
      ctx.fillStyle = P.accent
      ctx.fillRect(ax - 1.5, hy - 1.5, 3, 3)
      ctx.font = F8
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.globalAlpha = 0.8
      ctx.fillText(DECADES[decade], ax + 5, hy + 9)

      const countStr = count >= TRADE_TARGET ? `${groupInt(TRADE_TARGET)}+` : groupInt(count)
      if (wide) {
        ctx.fillStyle = P.ink
        for (let i = 0; i < SYMBOLS; i++) {
          const sx = x1 - 12 + i * 6
          ctx.globalAlpha = i === 0 ? 0.55 : 0.16
          ctx.fillRect(sx, hy - (i === 0 ? 6 : 3), 1.5, i === 0 ? 12 : 6)
        }
      } else {
        // no HTML readout at this size — the count lives on the canvas
        ctx.globalAlpha = 0.85
        ctx.fillStyle = P.ink
        ctx.font = F10
        ctx.textAlign = 'right'
        ctx.fillText(countStr, w - pad, hy + 4)
      }

      /* ---- price trace: the geometric random walk ---------- */
      if (showTrace) {
        const step = traceW / HIST_TICKS
        ctx.save()
        ctx.beginPath()
        ctx.rect(pad - 1, stageTop - 1, traceW + 2, stageH + 2)
        ctx.clip()
        ctx.beginPath()
        let started = false
        let py = 0
        for (let j = 0; j <= HIST_TICKS; j++) {
          const kk = k0 - HIST_TICKS + j
          if (!wrap && kk < 0) continue
          const pv = sim.price[modIdx(kk, TOTAL_TICKS)]
          const px = pad + traceW - (kf - kk) * step
          const py2 = yOfPrice(pv)
          if (!started) {
            ctx.moveTo(px, py2)
            started = true
          } else {
            ctx.lineTo(px, py)
            ctx.lineTo(px, py2)
          }
          py = py2
        }
        if (started) {
          ctx.lineTo(pad + traceW, py)
          ctx.lineTo(pad + traceW, yMid)
          ctx.globalAlpha = 0.32
          ctx.strokeStyle = P.ink
          ctx.lineWidth = 1
          ctx.stroke()
        }
        ctx.restore()
        ctx.globalAlpha = 0.9
        ctx.fillStyle = P.ink
        ctx.beginPath()
        ctx.arc(pad + traceW, yMid, 1.8, 0, TAU)
        ctx.fill()
        ctx.globalAlpha = 0.4
        ctx.font = F7
        ctx.fillStyle = P.inkSoft
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
        tracked(ctx, 'RANDOM WALK  σ 0.1%', pad, pad + 12, 0.7)
      }

      /* ---- ladder: the spread, drawn as the gap it is ------ */
      if (bestBid >= 0 && bestAsk >= 0 && bestAsk > bestBid) {
        const ytop = yOfIdx(bestAsk) + rowH / 2
        const ybot = yOfIdx(bestBid) - rowH / 2
        if (ybot - ytop > 1) {
          ctx.globalAlpha = 0.045
          ctx.fillStyle = P.ink
          ctx.fillRect(x0, ytop, x1 - x0, Math.min(ybot - ytop, rowH * 5))
        }
      }

      ctx.globalAlpha = 0.1
      ctx.strokeStyle = P.ink
      ctx.lineWidth = 1
      line(ctx, cx, lTop, cx, lTop + lH)

      ctx.font = F9
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let j = 0; j < rows; j++) {
        const pi = midIdx + (half - j)
        const y = lTop + (j + 0.5) * rowH
        const label = (half - j) % 4 === 0 || pi === bestBid || pi === bestAsk
        ctx.globalAlpha = 0.12
        ctx.strokeStyle = P.ink
        line(ctx, cx - spineHalf - 3, y, cx - spineHalf, y)
        line(ctx, cx + spineHalf, y, cx + spineHalf + 3, y)
        if (label && rowH > 9) {
          ctx.globalAlpha = pi === bestBid || pi === bestAsk ? 0.85 : 0.4
          ctx.fillStyle = pi === bestBid ? P.signal : pi === bestAsk ? P.accent : P.inkFaint
          ctx.fillText((pi * TICK_SIZE).toFixed(2), cx, y)
        }
      }

      /* ---- depth bars -------------------------------------- */
      for (let j = 0; j < rows; j++) {
        const pi = midIdx + (half - j)
        const s = pi - ORIGIN
        if (s < 0 || s >= SPAN) continue
        const y = lTop + (j + 0.5) * rowH
        for (let side = 0; side < 2; side++) {
          const q = side === 0 ? book.bidQ[s] : book.askQ[s]
          if (q <= 0.5) continue
          const len = (Math.min(q, maxQ) / maxQ) * maxBar
          const bx = side === 0 ? cx - spineHalf - len : cx + spineHalf
          const col = side === 0 ? P.signal : P.accent
          const best = side === 0 ? pi === bestBid : pi === bestAsk
          ctx.globalAlpha = (best ? 0.42 : 0.25) * (side === 0 ? 1.22 : 1)
          ctx.fillStyle = col
          ctx.fillRect(bx, y - bh / 2, len, bh)
          ctx.globalAlpha = best ? 0.95 : 0.5
          ctx.fillRect(side === 0 ? bx : bx + len - 1, y - bh / 2, 1, bh)
          if (best) {
            // the resting queue at the touch of the book — time priority
            const orders = Math.min(6, Math.round(side === 0 ? book.bidN[s] : book.askN[s]))
            ctx.globalAlpha = 0.35
            ctx.fillStyle = P.bg
            for (let o = 1; o < orders; o++) {
              ctx.fillRect(bx + (len * o) / orders, y - bh / 2, 1, bh)
            }
            ctx.globalAlpha = 0.7
            ctx.fillStyle = col
            ctx.font = F8
            ctx.textAlign = side === 0 ? 'right' : 'left'
            ctx.fillText(String(Math.round(q)), side === 0 ? bx - 5 : bx + len + 5, y)
            ctx.textAlign = 'center'
          }
        }
      }

      /* ---- mid price line ---------------------------------- */
      ctx.setLineDash(DASH)
      ctx.globalAlpha = 0.34
      ctx.strokeStyle = P.ink
      ctx.lineWidth = 1
      line(ctx, showTrace ? pad + traceW : x0, yMid, x1, yMid)
      ctx.setLineDash(NODASH)
      ctx.font = F8
      ctx.textAlign = 'left'
      ctx.globalAlpha = 0.55
      ctx.fillStyle = P.inkSoft
      ctx.fillText(midP.toFixed(2), x0 + 2, yMid - 6)

      /* ---- in-flight orders, sliding in from both edges ---- */
      ctx.save()
      ctx.beginPath()
      ctx.rect(x0 - 1, stageTop - 1, x1 - x0 + 2, stageH + 2)
      ctx.clip()
      for (let m = 0; m < 56; m++) {
        const i = ptr - m
        if (!wrap && i < 0) break
        const ii = modIdx(i, n)
        const et = sim.evT[ii] + Math.floor(i / n) * DURATION
        const age = ts - et
        if (age > TRAVEL) break
        if (age < 0) continue
        const pi = sim.evPx[ii]
        const y = yOfIdx(pi)
        if (y < stageTop - 10 || y > stageTop + stageH + 10) continue
        const side = sim.evSide[ii]
        const s = pi - ORIGIN
        const q = s >= 0 && s < SPAN ? (side === 0 ? book.bidQ[s] : book.askQ[s]) : 0
        const len = (Math.min(q, maxQ) / maxQ) * maxBar
        const tw = clamp(sim.evQty[ii] / 60, 0.2, 1) * 12 + 4
        const a = age / TRAVEL
        const ex = lerp(
          side === 0 ? x0 - 34 : x1 + 34,
          side === 0 ? cx - spineHalf - len - tw : cx + spineHalf + len,
          easeOutCubic(a),
        )
        const fade = a < 0.12 ? a / 0.12 : a > 0.86 ? (1 - a) / 0.14 : 1
        const col = side === 0 ? P.signal : P.accent
        ctx.globalAlpha = clamp(fade, 0, 1) * 0.18
        ctx.strokeStyle = col
        ctx.lineWidth = 1
        line(ctx, ex + (side === 0 ? -26 : tw + 26), y, ex + (side === 0 ? 0 : tw), y)
        ctx.globalAlpha = clamp(fade, 0, 1) * 0.95
        ctx.strokeRect(Math.round(ex) + 0.5, Math.round(y - bh / 2) + 0.5, tw, Math.max(2, bh - 1))
      }
      ctx.restore()

      /* ---- crossing: annihilation flash + tape print ------- */
      const shown = Math.min(book.nT, MAX_TRADES)
      for (let m = 0; m < shown; m++) {
        const idx = modIdx(book.nT - 1 - m, MAX_TRADES)
        let age = ts - book.tT[idx]
        if (reducedMotion && m === 0) age = 0.15
        if (age > FLASH_LIFE || age < 0) break
        const y = yOfIdx(book.tPx[idx])
        if (y < lTop || y > lTop + lH) continue
        const f = 1 - age / FLASH_LIFE
        const e = easeOutCubic(1 - f)
        // the two resting orders converge on the touch, then annihilate
        const conv = easeOutCubic(clamp(age / 0.16, 0, 1))
        if (conv < 1) {
          const run = (1 - conv) * (spineHalf + 40)
          ctx.globalAlpha = 0.75 * (1 - conv)
          ctx.fillStyle = P.signal
          ctx.fillRect(cx - 6 - run - 14, y - bh / 2, 14, bh)
          ctx.fillStyle = P.accent
          ctx.fillRect(cx + 6 + run, y - bh / 2, 14, bh)
        }
        const spreadX = spineHalf + 6 + 44 * e
        ctx.lineWidth = 1.25
        ctx.strokeStyle = P.ink
        ctx.globalAlpha = 0.85 * f * f
        line(ctx, cx - spreadX, y, cx + spreadX, y)
        ctx.lineWidth = 1
        ctx.strokeStyle = P.accent
        ctx.globalAlpha = 0.7 * f
        ctx.beginPath()
        ctx.arc(cx, y, 3 + 22 * e, 0, TAU)
        ctx.stroke()
        ctx.globalAlpha = f
        ctx.fillStyle = P.ink
        ctx.fillRect(cx - 1.5, y - 1.5, 3, 3)
        if (m === 0) {
          ctx.globalAlpha = f * 0.85
          ctx.fillStyle = P.accent
          ctx.font = F8
          ctx.textAlign = 'left'
          ctx.textBaseline = 'middle'
          ctx.fillText(`×${Math.round(book.tQty[idx])}`, cx + spreadX + 6, y)
        }
      }

      /* ---- hover: freeze and inspect a price level --------- */
      const hov = hoverRef.current
      if (hov >= 0) {
        const s = hov - ORIGIN
        const y = yOfIdx(hov)
        ctx.globalAlpha = 0.3
        ctx.strokeStyle = P.ink
        ctx.lineWidth = 1
        ctx.strokeRect(x0 + 0.5, Math.round(y - rowH / 2) + 0.5, x1 - x0 - 1, Math.round(rowH))
        const bq = s >= 0 && s < SPAN ? book.bidQ[s] : 0
        const aq = s >= 0 && s < SPAN ? book.askQ[s] : 0
        const bn = s >= 0 && s < SPAN ? Math.round(book.bidN[s]) : 0
        const an = s >= 0 && s < SPAN ? Math.round(book.askN[s]) : 0
        const cw = 108
        const chh = 46
        const cxx = cx + spineHalf + 18 + cw < x1 ? cx + spineHalf + 18 : cx - spineHalf - 18 - cw
        const cyy = clamp(y - chh / 2, stageTop, stageTop + stageH - chh)
        ctx.globalAlpha = 0.2
        line(ctx, cx, y, cxx + (cxx > cx ? 0 : cw), cyy + chh / 2)
        ctx.globalAlpha = 0.96
        ctx.fillStyle = P.bg
        ctx.fillRect(cxx, cyy, cw, chh)
        ctx.globalAlpha = 0.4
        ctx.strokeStyle = P.ink
        ctx.strokeRect(cxx + 0.5, cyy + 0.5, cw - 1, chh - 1)
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
        ctx.globalAlpha = 0.95
        ctx.fillStyle = P.ink
        ctx.font = F10
        ctx.fillText((hov * TICK_SIZE).toFixed(2), cxx + 8, cyy + 16)
        ctx.font = F8
        ctx.globalAlpha = 0.85
        ctx.fillStyle = P.signal
        ctx.fillText(`BID ${Math.round(bq)}  ${bn} ORD`, cxx + 8, cyy + 29)
        ctx.fillStyle = P.accent
        ctx.fillText(`ASK ${Math.round(aq)}  ${an} ORD`, cxx + 8, cyy + 40)
      }

      /* ---- trade tape -------------------------------------- */
      if (showTape) {
        const tx = x1 + gap
        ctx.globalAlpha = 0.16
        ctx.strokeStyle = P.ink
        ctx.lineWidth = 1
        line(ctx, tx, stageTop, tx + tapeW, stageTop)
        ctx.globalAlpha = 0.45
        ctx.fillStyle = P.inkSoft
        ctx.font = F7
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
        tracked(ctx, 'TAPE', tx, stageTop - 6, 0.9)

        const rh = Math.min(15, (stageH - 18) / (TAPE_ROWS + 1))
        for (let m = 0; m < Math.min(TAPE_ROWS, shown); m++) {
          const idx = modIdx(book.nT - 1 - m, MAX_TRADES)
          const age = ts - book.tT[idx]
          if (age < 0) continue
          const slide = 1 - clamp(age / 0.22, 0, 1)
          const y = stageTop + 15 + (m + slide) * rh
          if (y > stageTop + stageH) break
          const al = (1 - m / (TAPE_ROWS + 1)) * 0.95
          ctx.font = F9
          ctx.textAlign = 'left'
          ctx.globalAlpha = al
          ctx.fillStyle = m === 0 ? P.ink : P.inkFaint
          ctx.fillText((book.tPx[idx] * TICK_SIZE).toFixed(2), tx + 8, y)
          ctx.textAlign = 'right'
          ctx.globalAlpha = al * 0.7
          ctx.fillText(`×${Math.round(book.tQty[idx])}`, tx + tapeW, y)
          if (m === 0) {
            ctx.globalAlpha = 1 - slide
            ctx.fillStyle = P.accent
            ctx.fillRect(tx, y - 4, 2.5, 2.5)
          }
        }
      }

      /* ---- 4 trader threads, running in parallel ----------- */
      if (showBand) {
        const laneH = bandH / THREADS
        const laneX0 = pad + 20
        const laneX1 = w - pad - 26
        const laneW = laneX1 - laneX0
        book.seen.fill(0)

        for (let i = 0; i < THREADS; i++) {
          const y = stageBottom + 12 + (i + 0.5) * laneH
          ctx.globalAlpha = 0.11
          ctx.strokeStyle = P.ink
          ctx.lineWidth = 1
          line(ctx, laneX0, y, laneX1, y)
          ctx.globalAlpha = 0.45
          ctx.fillStyle = P.inkFaint
          ctx.font = F8
          ctx.textAlign = 'left'
          ctx.textBaseline = 'middle'
          ctx.fillText(`T${i}`, pad, y)
          ctx.textAlign = 'right'
          ctx.globalAlpha = 0.3
          ctx.fillText(String(book.lane[i]), w - pad, y)
        }

        for (let m = 0; m < 260; m++) {
          const i = ptr - m
          if (!wrap && i < 0) break
          const ii = modIdx(i, n)
          const et = sim.evT[ii] + Math.floor(i / n) * DURATION
          const age = ts - et
          if (age > LANE_SEC) break
          if (age < 0) continue
          const th = sim.evTh[ii]
          const y = stageBottom + 12 + (th + 0.5) * laneH
          const ex = laneX0 + (1 - age / LANE_SEC) * laneW
          const up = sim.evSide[ii] === 0
          ctx.globalAlpha = 0.12 + 0.4 * (1 - age / LANE_SEC)
          ctx.strokeStyle = P.ink
          line(ctx, ex, y, ex, y + (up ? -4.5 : 4.5))
          if (!book.seen[th]) {
            book.seen[th] = 1
            ctx.globalAlpha = 0.9
            ctx.fillStyle = up ? P.signal : P.accent
            ctx.beginPath()
            ctx.arc(ex, y, 2, 0, TAU)
            ctx.fill()
            // launch mark — the thread has just handed an order to the book
            if (age < 0.16) {
              const g = 1 - age / 0.16
              ctx.globalAlpha = 0.4 * g
              ctx.strokeStyle = up ? P.signal : P.accent
              line(ctx, ex, y, ex, y + (up ? -1 : 1) * (5 + 9 * g))
            }
          }
        }
      }

      ctx.globalAlpha = 1
      if (countStr !== countStrRef.current) {
        countStrRef.current = countStr
        const el = countElRef.current
        if (el) el.textContent = countStr
      }
      if (reducedMotion) drawnRef.current = true
    },
  })

  /* ---- interaction: wheel drives order rate, hover freezes -- */
  useEffect(() => {
    if (!interactive || reducedMotion) return
    const canvas = ref.current
    if (!canvas) return

    const release = () => {
      hoverRef.current = -1
      frozenRef.current = -1
    }
    const onMove = (e: PointerEvent) => {
      const g = geom.current
      if (!g.ok) {
        release()
        return
      }
      const r = canvas.getBoundingClientRect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top
      const inside = x >= g.x0 && x <= g.x1 && y >= g.top && y <= g.top + g.rows * g.rowH
      if (!inside) {
        release()
        return
      }
      const j = Math.floor((y - g.top) / g.rowH)
      hoverRef.current = g.midIdx + (g.half - j)
      if (frozenRef.current < 0) frozenRef.current = g.ts
    }
    const onWheel = (e: WheelEvent) => {
      boostRef.current = clamp(boostRef.current + Math.min(1, Math.abs(e.deltaY) / 320), 0, 1.6)
    }

    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', release)
    canvas.addEventListener('pointercancel', release)
    canvas.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', release)
      canvas.removeEventListener('pointercancel', release)
      canvas.removeEventListener('wheel', onWheel)
      release()
    }
  }, [interactive, reducedMotion, ref])

  return (
    <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
      <canvas
        ref={ref}
        className={styles.canvas}
        role="img"
        aria-label="Limit order book: four trader threads posting bids and asks that cross and execute at the resting order's limit price."
      />
      {roomy && (
        <div className={styles.readout} aria-hidden="true">
          <span ref={countElRef}>1</span>
          <br />
          TRADES MATCHED
        </div>
      )}
      {roomy && (
        <div className={styles.hud} aria-hidden="true">
          <span className={styles.chip}>4 trader threads</span>
          <span className={styles.chip}>3 order books</span>
          <span className={styles.chip}>5 ticks / s</span>
          <span className={styles.chip}>price–time priority</span>
        </div>
      )}
    </div>
  )
}
