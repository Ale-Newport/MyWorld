'use client'

/* ============================================================
   DotsBoxesMotion — Dots & Boxes: Dice Quotas
   The lattice settles in, a d6 tumbles and lands, and exactly
   that many edges snap in one at a time — each stroke growing
   dot to dot in the active player's colour — while the quota
   ticks burn down and finished boxes flood with their owner's
   fill. When no safe edge is left the quota still has to be
   paid: those sacrificial strokes carry a small strain tick,
   which is the whole point of the rule change.
   Late in the game the roll is clamped to the edges remaining.
   Click the board (or the chip) to take the game over: you
   roll, you draw exactly that many edges, the machine answers.
   ============================================================ */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useCanvas2D, type CanvasContext } from '@/hooks/useCanvas2D'
import { clamp, easeOutCubic, range, seeded } from '@/lib/math'
import { readPalette, type ProjectVisualProps, type VisualPalette } from './types'
import styles from './visual.module.css'

/* ---- board ---------------------------------------------- */
const MIN_N = 3 // the real app's smallest board: 3×3
const MAX_N = 6 // …and its largest: 6×6
const DEFAULT_N = 4

/* ---- timing, in seconds --------------------------------- */
const INTRO = 0.9
const ROLL_DUR = 0.55
const EDGE_DUR = 0.18
const EDGE_GAP = 0.06
const TURN_GAP = 0.18
const TAIL = 2.2
const LOOP_FADE = 0.5
const FLOOD = 0.42

const NEVER = 1e9
const LONG_AGO = -1e6

const NO_DASH: number[] = []
const DASH_GHOST: number[] = [2, 3]

/** Pip layout per face, as (col,row) pairs on a -1..1 grid. */
const PIPS: ReadonlyArray<ReadonlyArray<number>> = [
  [],
  [0, 0],
  [-1, -1, 1, 1],
  [-1, -1, 0, 0, 1, 1],
  [-1, -1, 1, -1, -1, 1, 1, 1],
  [-1, -1, 1, -1, 0, 0, -1, 1, 1, 1],
  [-1, -1, 1, -1, -1, 0, 1, 0, -1, 1, 1, 1],
]

/** Two-digit labels, built once so the draw loop never formats. */
const N2: string[] = []
for (let i = 0; i < 100; i++) N2.push(i < 10 ? `0${i}` : String(i))

/* ============================================================
   data
   ============================================================ */

interface Board {
  n: number
  d: number
  e: number
  b: number
  hCount: number
  /** Edge endpoints in lattice units (0..n). */
  ex0: Float32Array
  ey0: Float32Array
  ex1: Float32Array
  ey1: Float32Array
  /** Two box ids per edge, -1 where the edge is on the border. */
  boxOfEdge: Int32Array
  /** Four edge ids per box: top, bottom, left, right. */
  edgeOfBox: Int32Array
  /** Intro stagger per dot, seconds. */
  dotDelay: Float32Array
}

/** Everything the renderer needs to draw a position at any clock. */
interface View {
  /** When each edge started growing; NEVER while undrawn. */
  t0: Float32Array
  player: Int8Array
  /** 1 when the stroke was paid with no safe option left. */
  forced: Uint8Array
  boxOwner: Int8Array
  boxT: Float32Array
}

interface TurnRec {
  die: number
  quota: number
  player: number
  t0: number
  t1: number
  clamped: boolean
  moveT: number[]
}

interface Script {
  view: View
  turns: TurnRec[]
  total: number
  /** The single frame reduced motion renders. */
  staticClock: number
}

interface Live {
  on: boolean
  drawn: Uint8Array
  count: Uint8Array
  remaining: number
  player: number
  die: number
  rollT: number
  quota: number
  quotaTotal: number
  clamped: boolean
  nextAt: number
  seedStep: number
  rnd: () => number
  view: View
}

interface Scratch {
  cand: Int32Array
  ghosts: Int32Array
  prog: Float32Array
  forced: boolean
}

interface Layout {
  w: number
  h: number
  n: number
  s: number
  bx: number
  by: number
  size: number
  cell: number
  railX: number
  railW: number
  railTop: number
  dieHalf: number
  dot: number
  edgeW: number
  caption: string
  fMicro: string
  fSmall: string
}

/* ============================================================
   board + game construction (never runs inside the draw loop)
   ============================================================ */

function makeBoard(n: number): Board {
  const d = n + 1
  const hCount = d * n
  const e = 2 * d * n
  const b = n * n
  const ex0 = new Float32Array(e)
  const ey0 = new Float32Array(e)
  const ex1 = new Float32Array(e)
  const ey1 = new Float32Array(e)
  const boxOfEdge = new Int32Array(e * 2).fill(-1)
  const edgeOfBox = new Int32Array(b * 4)

  for (let r = 0; r < d; r++) {
    for (let c = 0; c < n; c++) {
      const id = r * n + c
      ex0[id] = c
      ey0[id] = r
      ex1[id] = c + 1
      ey1[id] = r
      boxOfEdge[id * 2] = r > 0 ? (r - 1) * n + c : -1
      boxOfEdge[id * 2 + 1] = r < n ? r * n + c : -1
    }
  }
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < d; c++) {
      const id = hCount + r * d + c
      ex0[id] = c
      ey0[id] = r
      ex1[id] = c
      ey1[id] = r + 1
      boxOfEdge[id * 2] = c > 0 ? r * n + (c - 1) : -1
      boxOfEdge[id * 2 + 1] = c < n ? r * n + c : -1
    }
  }
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const id = r * n + c
      edgeOfBox[id * 4] = r * n + c
      edgeOfBox[id * 4 + 1] = (r + 1) * n + c
      edgeOfBox[id * 4 + 2] = hCount + r * d + c
      edgeOfBox[id * 4 + 3] = hCount + r * d + c + 1
    }
  }

  /* dots wake from the centre outward */
  const dotDelay = new Float32Array(d * d)
  const mid = n / 2
  const far = Math.hypot(mid, mid) || 1
  for (let r = 0; r < d; r++) {
    for (let c = 0; c < d; c++) {
      dotDelay[r * d + c] = (Math.hypot(c - mid, r - mid) / far) * 0.45
    }
  }

  return { n, d, e, b, hCount, ex0, ey0, ex1, ey1, boxOfEdge, edgeOfBox, dotDelay }
}

function makeView(e: number, b: number): View {
  return {
    t0: new Float32Array(e),
    player: new Int8Array(e),
    forced: new Uint8Array(e),
    boxOwner: new Int8Array(b),
    boxT: new Float32Array(b),
  }
}

function resetView(v: View) {
  v.t0.fill(NEVER)
  v.player.fill(-1)
  v.forced.fill(0)
  v.boxOwner.fill(-1)
  v.boxT.fill(NEVER)
}

/**
 * The house player. Take a box if one is on offer; otherwise
 * play an edge that hands nothing over; otherwise pay the quota
 * with the cheapest sacrifice there is. `sc.forced` records
 * which of those three it was.
 */
function pickEdge(
  bd: Board,
  drawn: Uint8Array,
  count: Uint8Array,
  sc: Scratch,
  rnd: () => number,
): number {
  const cand = sc.cand
  let n = 0

  for (let e = 0; e < bd.e; e++) {
    if (drawn[e]) continue
    const a = bd.boxOfEdge[e * 2]
    const b = bd.boxOfEdge[e * 2 + 1]
    if ((a >= 0 && count[a] === 3) || (b >= 0 && count[b] === 3)) cand[n++] = e
  }
  if (n > 0) {
    sc.forced = false
    return cand[Math.floor(rnd() * n)]
  }

  for (let e = 0; e < bd.e; e++) {
    if (drawn[e]) continue
    const a = bd.boxOfEdge[e * 2]
    const b = bd.boxOfEdge[e * 2 + 1]
    if ((a >= 0 && count[a] === 2) || (b >= 0 && count[b] === 2)) continue
    cand[n++] = e
  }
  if (n > 0) {
    sc.forced = false
    return cand[Math.floor(rnd() * n)]
  }

  let best = -1
  let bestCost = 9
  for (let e = 0; e < bd.e; e++) {
    if (drawn[e]) continue
    const a = bd.boxOfEdge[e * 2]
    const b = bd.boxOfEdge[e * 2 + 1]
    let cost = 0
    if (a >= 0 && count[a] === 2) cost++
    if (b >= 0 && count[b] === 2) cost++
    if (cost < bestCost || (cost === bestCost && rnd() < 0.28)) {
      bestCost = cost
      best = e
    }
  }
  sc.forced = true
  return best
}

/** Plays one whole deterministic game and time-stamps every stroke. */
function buildScript(bd: Board, sc: Scratch): Script {
  const view = makeView(bd.e, bd.b)
  resetView(view)
  const drawn = new Uint8Array(bd.e)
  const count = new Uint8Array(bd.b)
  const rnd = seeded(0x2b7d13 + bd.n * 9973)
  const turns: TurnRec[] = []

  let clock = INTRO
  let remaining = bd.e
  let player = 0
  let guard = 4000

  while (remaining > 0 && guard-- > 0) {
    const die = 1 + Math.floor(rnd() * 6)
    const quota = Math.min(die, remaining)
    const t0 = clock
    const t1 = clock + ROLL_DUR
    const moveT: number[] = []
    clock = t1

    for (let k = 0; k < quota; k++) {
      const e = pickEdge(bd, drawn, count, sc, rnd)
      if (e < 0) break
      drawn[e] = 1
      remaining--
      view.t0[e] = clock
      view.player[e] = player
      view.forced[e] = sc.forced ? 1 : 0
      moveT.push(clock)
      const done = clock + EDGE_DUR
      for (let j = 0; j < 2; j++) {
        const bx = bd.boxOfEdge[e * 2 + j]
        if (bx < 0) continue
        count[bx]++
        if (count[bx] === 4) {
          view.boxOwner[bx] = player
          view.boxT[bx] = done
        }
      }
      clock = done + EDGE_GAP
    }

    turns.push({ die, quota, player, t0, t1, clamped: die > quota, moveT })
    clock += TURN_GAP
    player = 1 - player
  }

  const total = clock + TAIL

  /* the still frame: a die already landed, part of its quota
     spent, one stroke caught mid-growth, boxes on the board */
  let staticClock = total * 0.7
  for (let i = 0; i < turns.length; i++) {
    const tr = turns[i]
    if (tr.quota < 3 || tr.moveT.length < 3) continue
    if (tr.t1 < total * 0.35 || tr.t1 > total * 0.82) continue
    staticClock = tr.moveT[2] + EDGE_DUR * 0.62
  }

  return { view, turns, total, staticClock }
}

function makeLive(bd: Board): Live {
  return {
    on: false,
    drawn: new Uint8Array(bd.e),
    count: new Uint8Array(bd.b),
    remaining: bd.e,
    player: 0,
    die: 0,
    rollT: -1,
    quota: 0,
    quotaTotal: 0,
    clamped: false,
    nextAt: 0,
    seedStep: 0,
    rnd: seeded(0x9e3779 + bd.n * 131),
    view: makeView(bd.e, bd.b),
  }
}

function rollLive(g: Live, now: number) {
  const die = 1 + Math.floor(g.rnd() * 6)
  const quota = Math.min(die, g.remaining)
  g.die = die
  g.quota = quota
  g.quotaTotal = quota
  g.clamped = die > quota
  g.rollT = now
  g.nextAt = now + ROLL_DUR
}

function applyLive(g: Live, bd: Board, e: number, now: number, forced: boolean) {
  g.drawn[e] = 1
  g.remaining--
  g.view.t0[e] = now
  g.view.player[e] = g.player
  g.view.forced[e] = forced ? 1 : 0
  const done = now + EDGE_DUR
  for (let j = 0; j < 2; j++) {
    const bx = bd.boxOfEdge[e * 2 + j]
    if (bx < 0) continue
    g.count[bx]++
    if (g.count[bx] === 4) {
      g.view.boxOwner[bx] = g.player
      g.view.boxT[bx] = done
    }
  }
  g.quota--
  g.nextAt = done + EDGE_GAP
}

/** True when playing this edge puts a box on a plate. */
function isSacrifice(g: Live, bd: Board, e: number): boolean {
  const a = bd.boxOfEdge[e * 2]
  const b = bd.boxOfEdge[e * 2 + 1]
  const gives = (a >= 0 && g.count[a] === 2) || (b >= 0 && g.count[b] === 2)
  const takes = (a >= 0 && g.count[a] === 3) || (b >= 0 && g.count[b] === 3)
  return gives && !takes
}

/** Hands the scripted position to the viewer, mid-game. */
function takeOver(g: Live, bd: Board, s: Script, clock: number, now: number) {
  g.drawn.fill(0)
  g.count.fill(0)
  resetView(g.view)
  g.remaining = bd.e
  g.player = 0
  g.die = 0
  g.rollT = -1
  g.quota = 0
  g.quotaTotal = 0
  g.clamped = false
  g.nextAt = now
  g.seedStep++
  g.rnd = seeded(0x9e3779 + bd.n * 131 + g.seedStep * 7919)

  /* only strokes that finished are adopted, so every box the
     viewer inherits has a legitimate owner */
  const complete = s.total > 0 && clock < s.total - TAIL * 0.5
  if (!complete) return
  for (let e = 0; e < bd.e; e++) {
    if (s.view.t0[e] + EDGE_DUR > clock) continue
    g.drawn[e] = 1
    g.remaining--
    g.view.t0[e] = LONG_AGO
    g.view.player[e] = s.view.player[e]
    g.view.forced[e] = s.view.forced[e]
  }
  for (let b = 0; b < bd.b; b++) {
    let filled = 0
    let lastT = -NEVER
    let owner = -1
    for (let j = 0; j < 4; j++) {
      const e = bd.edgeOfBox[b * 4 + j]
      if (!g.drawn[e]) continue
      filled++
      if (s.view.t0[e] > lastT) {
        lastT = s.view.t0[e]
        owner = s.view.player[e]
      }
    }
    g.count[b] = filled
    if (filled === 4 && owner >= 0) {
      g.view.boxOwner[b] = owner
      g.view.boxT[b] = LONG_AGO
    }
  }
}

/** Event-driven: advances the viewer's game between frames. */
function stepLive(g: Live, bd: Board, sc: Scratch, now: number) {
  if (g.remaining <= 0) return
  if (g.player === 1) {
    if (g.die === 0) {
      if (now >= g.nextAt) rollLive(g, now)
      return
    }
    if (g.quota > 0) {
      if (now >= g.nextAt) {
        const e = pickEdge(bd, g.drawn, g.count, sc, g.rnd)
        if (e >= 0) applyLive(g, bd, e, now, sc.forced)
        else g.quota = 0
      }
      return
    }
    if (now >= g.nextAt + TURN_GAP) {
      g.player = 0
      g.die = 0
      g.rollT = -1
      g.quotaTotal = 0
      g.clamped = false
      g.nextAt = now
    }
    return
  }
  /* the viewer's turn ends by itself once the quota is paid */
  if (g.die !== 0 && g.quota === 0 && now >= g.nextAt + TURN_GAP) {
    g.player = 1
    g.die = 0
    g.rollT = -1
    g.quotaTotal = 0
    g.clamped = false
    g.nextAt = now + 0.3
  }
}

/* ============================================================
   component
   ============================================================ */

export function DotsBoxesMotion({
  project,
  progress,
  reducedMotion,
  className,
  interactive,
}: ProjectVisualProps) {
  const [n, setN] = useState(DEFAULT_N)
  const [liveOn, setLiveOn] = useState(false)
  const [hud, setHud] = useState(0)

  const board = useMemo(() => makeBoard(n), [n])
  const scratch = useMemo<Scratch>(
    () => ({
      cand: new Int32Array(board.e),
      ghosts: new Int32Array(board.b),
      prog: new Float32Array(board.e),
      forced: false,
    }),
    [board],
  )
  const script = useMemo(() => buildScript(board, scratch), [board, scratch])
  const live = useMemo(() => makeLive(board), [board])

  const readout = useMemo(
    () => (project?.metrics ?? []).slice(0, 2).map((m) => `${m.label} ${m.value}`.toUpperCase()),
    [project],
  )

  const layoutRef = useRef<Layout>({
    w: -1,
    h: -1,
    n: -1,
    s: 1,
    bx: 0,
    by: 0,
    size: 10,
    cell: 10,
    railX: 0,
    railW: 90,
    railTop: 0,
    dieHalf: 15,
    dot: 1.7,
    edgeW: 1.25,
    caption: '',
    fMicro: '7px ui-monospace, monospace',
    fSmall: '8px ui-monospace, monospace',
  })
  const palRef = useRef<VisualPalette | null>(null)
  const palAge = useRef(0)
  const clockRef = useRef(0)
  const wallRef = useRef(0)
  const hoverRef = useRef(-1)
  const hudRef = useRef(0)

  const ref = useCanvas2D<HTMLCanvasElement>({
    setup: ({ ctx, w, h }) => {
      palRef.current = readPalette(ref.current)
      palAge.current = 0
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      relayout(layoutRef.current, w, h, board)
    },
    draw: ({ ctx, w, h, t, dt }: CanvasContext) => {
      const L = layoutRef.current
      if (L.w !== w || L.h !== h || L.n !== board.n) relayout(L, w, h, board)

      palAge.current += dt
      if (!palRef.current || palAge.current > 0.5) {
        palRef.current = readPalette(ref.current)
        palAge.current = 0
      }
      const pal = palRef.current
      const s = L.s
      const cell = L.cell

      if (live.on && !reducedMotion) stepLive(live, board, scratch, t)
      wallRef.current = t

      const scriptClock = reducedMotion
        ? script.staticClock
        : typeof progress === 'number'
          ? clamp(progress) * script.total
          : t % script.total
      clockRef.current = scriptClock

      const clock = live.on ? t : scriptClock
      const view = live.on ? live.view : script.view
      const selfRun = !live.on && !reducedMotion && typeof progress !== 'number'
      const fade = selfRun ? range(script.total - scriptClock, 0, LOOP_FADE) : 1

      /* ---- whose turn, which face, how much quota is left ---- */
      let die = 0
      let rollP = 1
      let quotaTotal = 0
      let quotaSpent = 0
      let clamped = false
      let turnOwner = 0
      let started = live.on

      if (live.on) {
        die = live.die
        rollP = live.rollT < 0 ? 1 : range(t, live.rollT, live.rollT + ROLL_DUR)
        quotaTotal = live.quotaTotal
        quotaSpent = live.quotaTotal - live.quota
        clamped = live.clamped
        turnOwner = live.player
      } else {
        let ti = -1
        for (let i = 0; i < script.turns.length; i++) {
          if (script.turns[i].t0 <= clock) ti = i
          else break
        }
        if (ti >= 0) {
          const tr = script.turns[ti]
          started = true
          die = tr.die
          rollP = range(clock, tr.t0, tr.t1)
          quotaTotal = tr.quota
          clamped = tr.clamped
          turnOwner = tr.player
          let spent = 0
          for (let i = 0; i < tr.moveT.length; i++) {
            if (clock >= tr.moveT[i] + EDGE_DUR) spent++
          }
          quotaSpent = spent
        }
      }

      /* ---- per-edge growth, computed once ------------------- */
      const prog = scratch.prog
      let tipX = 0
      let tipY = 0
      let tipOn = 0
      let tipPlayer = 0
      for (let e = 0; e < board.e; e++) {
        prog[e] = clamp((clock - view.t0[e]) / EDGE_DUR)
      }

      ctx.clearRect(0, 0, w, h)
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      ctx.setLineDash(NO_DASH)

      /* ---- claimed boxes flood with their owner's fill ------- */
      let scoreA = 0
      let scoreB = 0
      let ghostN = 0
      const pad = 2.6 * s
      for (let b = 0; b < board.b; b++) {
        const r = (b / board.n) | 0
        const c = b % board.n
        const cx = L.bx + (c + 0.5) * cell
        const cy = L.by + (r + 0.5) * cell
        const owner = view.boxOwner[b]

        if (owner >= 0 && clock >= view.boxT[b]) {
          if (owner === 0) scoreA++
          else scoreB++
          const bt = view.boxT[b]
          const k = easeOutCubic(range(clock, bt, bt + FLOOD))
          const flash = Math.sin(range(clock, bt, bt + 0.32) * Math.PI)
          const half = (cell * 0.5 - pad) * (0.34 + 0.66 * k)
          ctx.fillStyle = owner === 0 ? pal.accent : pal.signal
          ctx.globalAlpha = fade * (0.12 * k + 0.14 * flash)
          ctx.fillRect(cx - half, cy - half, half * 2, half * 2)
          if (k > 0.55) {
            ctx.globalAlpha = fade * 0.55 * range(k, 0.55, 1)
            ctx.font = L.fSmall
            ctx.textAlign = 'center'
            ctx.fillText(owner === 0 ? 'A' : 'B', cx, cy + 0.5 * s)
            ctx.textAlign = 'left'
          }
          continue
        }

        /* a box one edge from capture — the tactical unit */
        let filled = 0
        let missing = -1
        for (let j = 0; j < 4; j++) {
          const e = board.edgeOfBox[b * 4 + j]
          if (prog[e] >= 1) filled++
          else missing = e
        }
        if (filled === 3 && missing >= 0) scratch.ghosts[ghostN++] = missing
      }

      /* ---- the lattice -------------------------------------- */
      ctx.fillStyle = pal.inkFaint
      for (let r = 0; r < board.d; r++) {
        for (let c = 0; c < board.d; c++) {
          const dl = board.dotDelay[r * board.d + c]
          const k = live.on ? 1 : easeOutCubic(range(clock, dl, dl + 0.4))
          if (k <= 0.01) continue
          ctx.globalAlpha = fade * (0.35 + 0.4 * k)
          const rr = L.dot * (0.4 + 0.6 * k)
          ctx.beginPath()
          ctx.arc(L.bx + c * cell, L.by + r * cell, rr, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      /* ---- ghosts: the edge that would close a box ----------- */
      if (ghostN > 0) {
        ctx.setLineDash(DASH_GHOST)
        ctx.strokeStyle = pal.inkFaint
        ctx.lineWidth = 0.75
        ctx.globalAlpha = fade * 0.32
        ctx.beginPath()
        for (let i = 0; i < ghostN; i++) {
          const e = scratch.ghosts[i]
          ctx.moveTo(L.bx + board.ex0[e] * cell, L.by + board.ey0[e] * cell)
          ctx.lineTo(L.bx + board.ex1[e] * cell, L.by + board.ey1[e] * cell)
        }
        ctx.stroke()
        ctx.setLineDash(NO_DASH)
      }

      /* ---- edges, growing dot to dot ------------------------ */
      for (let e = 0; e < board.e; e++) {
        const a = prog[e]
        if (a <= 0) continue
        const ea = easeOutCubic(a)
        const pl = view.player[e]
        const x0 = L.bx + board.ex0[e] * cell
        const y0 = L.by + board.ey0[e] * cell
        const x1 = L.bx + board.ex1[e] * cell
        const y1 = L.by + board.ey1[e] * cell
        const xt = x0 + (x1 - x0) * ea
        const yt = y0 + (y1 - y0) * ea

        ctx.strokeStyle = pl === 1 ? pal.signal : pal.accent
        ctx.lineWidth = L.edgeW
        ctx.globalAlpha = fade * (a < 1 ? 1 : 0.78)
        ctx.beginPath()
        ctx.moveTo(x0, y0)
        ctx.lineTo(xt, yt)
        ctx.stroke()

        if (a < 1) {
          tipX = xt
          tipY = yt
          tipOn = 1
          tipPlayer = pl
        } else if (view.forced[e]) {
          /* strain tick: the quota had to be paid, so a box went */
          const mx = (x0 + x1) / 2
          const my = (y0 + y1) / 2
          const dx = (y1 - y0) / cell
          const dy = -(x1 - x0) / cell
          const len = 3.2 * s
          ctx.strokeStyle = pal.inkSoft
          ctx.lineWidth = 0.75
          ctx.globalAlpha = fade * 0.3
          ctx.beginPath()
          ctx.moveTo(mx - dx * len, my - dy * len)
          ctx.lineTo(mx + dx * len, my + dy * len)
          ctx.stroke()
        }
      }

      /* the growing tip carries the eye */
      if (tipOn) {
        ctx.fillStyle = tipPlayer === 1 ? pal.signal : pal.accent
        ctx.globalAlpha = fade
        ctx.beginPath()
        ctx.arc(tipX, tipY, L.dot * 1.5, 0, Math.PI * 2)
        ctx.fill()
      }

      /* ---- the edge under the pointer ----------------------- */
      const hov = hoverRef.current
      if (live.on && hov >= 0 && hov < board.e && !live.drawn[hov]) {
        ctx.setLineDash(DASH_GHOST)
        ctx.strokeStyle = pal.accent
        ctx.lineWidth = L.edgeW
        ctx.globalAlpha = 0.5
        ctx.beginPath()
        ctx.moveTo(L.bx + board.ex0[hov] * cell, L.by + board.ey0[hov] * cell)
        ctx.lineTo(L.bx + board.ex1[hov] * cell, L.by + board.ey1[hov] * cell)
        ctx.stroke()
        ctx.setLineDash(NO_DASH)
      }

      /* ---- caption ------------------------------------------ */
      ctx.fillStyle = pal.inkFaint
      ctx.font = L.fMicro
      ctx.globalAlpha = fade * 0.6
      tracked(ctx, L.caption, L.bx, L.by - 13 * s, 6.6 * s, 0.9)

      /* ============ rail: die, quota, score ================== */
      const rx = L.railX
      const dieCx = rx + L.dieHalf
      const dieCy = L.railTop + L.dieHalf
      const appear = live.on ? 1 : easeOutCubic(range(clock, 0.35, 1.0))

      ctx.fillStyle = pal.inkFaint
      ctx.font = L.fMicro
      ctx.globalAlpha = fade * appear * 0.55
      tracked(ctx, 'ROLL', rx, L.railTop - 12 * s, 6.6 * s, 1.1)

      const spin = started ? (1 - easeOutCubic(rollP)) * -Math.PI * 1.4 : 0
      const hop = started ? Math.sin(clamp(rollP) * Math.PI) : 0
      const face = !started ? 0 : rollP < 0.9 ? 1 + (Math.floor(rollP * 17 * (1 - rollP * 0.55)) % 6) : die
      drawDie(
        ctx,
        dieCx,
        dieCy - hop * 6 * s,
        L.dieHalf,
        face,
        spin,
        1 + 0.12 * hop,
        pal,
        fade * appear,
        turnOwner === 1 ? pal.signal : pal.accent,
      )

      /* quota ticks: one per edge still owed this turn */
      const tickY = L.railTop + L.dieHalf * 2 + 20 * s
      const settle = started ? easeOutCubic(range(rollP, 0.55, 1)) : 0
      ctx.fillStyle = pal.inkFaint
      ctx.font = L.fMicro
      ctx.globalAlpha = fade * appear * 0.55
      tracked(ctx, 'QUOTA', rx, tickY - 11 * s, 6.6 * s, 1.1)

      const tw = 5 * s
      const tg = 3.4 * s
      const shown = clamped ? die : quotaTotal
      for (let i = 0; i < shown; i++) {
        const x = rx + i * (tw + tg)
        const spent = i < quotaSpent
        const overflow = i >= quotaTotal
        if (!spent && !overflow) {
          ctx.fillStyle = turnOwner === 1 ? pal.signal : pal.accent
          ctx.globalAlpha = fade * settle * 0.85
          ctx.fillRect(x, tickY - tw / 2, tw, tw)
        } else {
          ctx.strokeStyle = pal.inkFaint
          ctx.lineWidth = 0.75
          ctx.globalAlpha = fade * settle * (overflow ? 0.4 : 0.55)
          ctx.strokeRect(x + 0.4, tickY - tw / 2 + 0.4, tw - 0.8, tw - 0.8)
          if (overflow) {
            ctx.beginPath()
            ctx.moveTo(x, tickY + tw / 2)
            ctx.lineTo(x + tw, tickY - tw / 2)
            ctx.stroke()
          }
        }
      }
      if (clamped && settle > 0.2) {
        ctx.fillStyle = pal.inkSoft
        ctx.globalAlpha = fade * settle * 0.6
        ctx.font = L.fMicro
        tracked(ctx, 'CLAMPED', rx, tickY + 12 * s, 6.6 * s, 1.1)
      }

      /* score: boxes won, out of every box on the board */
      const scoreY = tickY + 30 * s
      const barX = rx + 13 * s
      const barW = Math.max(18 * s, L.railW - 34 * s)
      for (let p = 0; p < 2; p++) {
        const y = scoreY + p * 15 * s
        const val = p === 0 ? scoreA : scoreB
        const col = p === 0 ? pal.accent : pal.signal
        const isTurn = turnOwner === p && started

        ctx.fillStyle = isTurn ? col : pal.inkFaint
        ctx.globalAlpha = fade * appear * (isTurn ? 0.9 : 0.5)
        ctx.font = L.fSmall
        ctx.fillText(p === 0 ? 'A' : 'B', rx, y)

        ctx.fillStyle = pal.inkFaint
        ctx.globalAlpha = fade * appear * 0.22
        ctx.fillRect(barX, y - 1.6 * s, barW, 3.2 * s)
        ctx.fillStyle = col
        ctx.globalAlpha = fade * appear * 0.8
        ctx.fillRect(barX, y - 1.6 * s, (barW * val) / board.b, 3.2 * s)

        ctx.fillStyle = pal.inkSoft
        ctx.globalAlpha = fade * appear * 0.7
        ctx.font = L.fMicro
        ctx.textAlign = 'right'
        ctx.fillText(N2[val] ?? String(val), rx + L.railW, y)
        ctx.textAlign = 'left'
      }

      ctx.globalAlpha = 1

      /* ---- mirror the turn state onto the chips ------------- */
      if (!reducedMotion) {
        const code = live.on ? (live.remaining <= 0 ? -2 : live.player === 1 ? -1 : live.quota) : 0
        if (code !== hudRef.current) {
          hudRef.current = code
          setHud(code)
        }
      }
    },
  })

  /* ---- pointer: take over, then draw the edges ------------- */
  useEffect(() => {
    if (interactive === false || reducedMotion) return
    const c = ref.current
    if (!c) return

    const nearest = (x: number, y: number) => {
      const L = layoutRef.current
      if (L.cell <= 0) return -1
      const u = (x - L.bx) / L.cell
      const v = (y - L.by) / L.cell
      let best = -1
      let bestD = 0.46 * 0.46
      for (let e = 0; e < board.e; e++) {
        if (live.drawn[e]) continue
        const mx = (board.ex0[e] + board.ex1[e]) / 2
        const my = (board.ey0[e] + board.ey1[e]) / 2
        const dx = u - mx
        const dy = v - my
        const d = dx * dx + dy * dy
        if (d < bestD) {
          bestD = d
          best = e
        }
      }
      return best
    }

    const canPlay = () =>
      live.on &&
      live.player === 0 &&
      live.quota > 0 &&
      live.remaining > 0 &&
      wallRef.current >= live.rollT + ROLL_DUR

    const onDown = (ev: PointerEvent) => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const x = ev.clientX - r.left
      const y = ev.clientY - r.top
      const now = wallRef.current

      if (!live.on) {
        takeOver(live, board, script, clockRef.current, now)
        live.on = true
        if (live.remaining > 0) rollLive(live, now)
        setLiveOn(true)
        return
      }
      if (!canPlay()) {
        if (live.player === 0 && live.quota === 0 && live.remaining > 0) rollLive(live, now)
        return
      }
      const e = nearest(x, y)
      if (e < 0) return
      applyLive(live, board, e, now, isSacrifice(live, board, e))
      hoverRef.current = -1
    }

    const onMove = (ev: PointerEvent) => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const x = ev.clientX - r.left
      const y = ev.clientY - r.top
      const e = canPlay() ? nearest(x, y) : -1
      hoverRef.current = e
      el.style.cursor = e >= 0 || !live.on ? 'pointer' : 'default'
    }

    const onLeave = () => {
      hoverRef.current = -1
      const el = ref.current
      if (el) el.style.cursor = 'default'
    }

    c.addEventListener('pointerdown', onDown)
    c.addEventListener('pointermove', onMove)
    c.addEventListener('pointerleave', onLeave)
    return () => {
      c.removeEventListener('pointerdown', onDown)
      c.removeEventListener('pointermove', onMove)
      c.removeEventListener('pointerleave', onLeave)
    }
  }, [interactive, reducedMotion, board, script, live, ref])

  const onRoll = () => {
    const now = wallRef.current
    if (!live.on) {
      takeOver(live, board, script, clockRef.current, now)
      live.on = true
      setLiveOn(true)
    }
    if (live.player !== 0 || live.quota > 0 || live.remaining <= 0) return
    rollLive(live, now)
  }

  const onAuto = () => {
    live.on = false
    hoverRef.current = -1
    setLiveOn(false)
  }

  const onResize = () => {
    live.on = false
    hoverRef.current = -1
    setLiveOn(false)
    setN(n >= MAX_N ? MIN_N : n + 1)
  }

  const rollLabel =
    hud === -2 ? 'Board full' : hud === -1 ? 'B playing' : hud > 0 ? `Quota ${hud}` : 'Roll d6'

  return (
    <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
      <canvas ref={ref} className={styles.canvas} />
      {readout.length > 0 && (
        <div className={styles.readout}>
          {readout.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      )}
      {interactive !== false && !reducedMotion && (
        <div className={styles.hud}>
          <button type="button" className={styles.chip} data-on={hud > 0} onClick={onRoll}>
            {rollLabel}
          </button>
          <button type="button" className={styles.chip} onClick={onResize}>
            {n}×{n}
          </button>
          <button type="button" className={styles.chip} data-on={!liveOn} onClick={onAuto}>
            Auto
          </button>
        </div>
      )}
    </div>
  )
}

/* ============================================================
   helpers kept out of the draw loop
   ============================================================ */

function relayout(L: Layout, w: number, h: number, board: Board) {
  L.w = w
  L.h = h
  L.n = board.n
  const s = clamp(Math.min(w / 560, h / 340), 0.6, 1.35)
  L.s = s

  const padL = 18 * s
  const padR = 12 * s
  const padT = 26 * s
  const padB = 34 + 6 * s // clears the chip row
  const gap = 18 * s

  L.railW = clamp(w * 0.24, 74 * s, 132 * s)
  const availW = Math.max(40, w - padL - padR - L.railW - gap)
  const availH = Math.max(40, h - padT - padB)
  const size = Math.max(40, Math.min(availW, availH))
  L.size = size
  L.cell = size / board.n
  L.bx = padL + (availW - size) / 2
  L.by = padT + (availH - size) / 2
  L.railX = w - padR - L.railW
  L.dieHalf = clamp(15 * s, 11, 22)

  const railH = L.dieHalf * 2 + 80 * s
  L.railTop = Math.max(padT + 6 * s, padT + (availH - railH) / 2)

  L.dot = 1.7 * s
  L.edgeW = clamp(1.35 * s, 0.85, 1.6)
  L.caption = `${board.n}×${board.n} · ${board.e} EDGES`
  L.fMicro = `${(6.6 * s).toFixed(2)}px ui-monospace, monospace`
  L.fSmall = `${(7.8 * s).toFixed(2)}px ui-monospace, monospace`
}

/** Monospace with manual tracking — uppercase technical labels. */
function tracked(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  size: number,
  spacing: number,
) {
  const adv = size * 0.6 + spacing
  let cx = x
  for (let i = 0; i < str.length; i++) {
    ctx.fillText(str[i], cx, y)
    cx += adv
  }
}

function drawDie(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  half: number,
  value: number,
  rot: number,
  scale: number,
  pal: VisualPalette,
  alpha: number,
  pipColor: string,
) {
  if (alpha <= 0.01) return
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(rot)
  ctx.scale(scale, scale)

  const r = half * 0.28
  ctx.beginPath()
  ctx.moveTo(-half + r, -half)
  ctx.arcTo(half, -half, half, half, r)
  ctx.arcTo(half, half, -half, half, r)
  ctx.arcTo(-half, half, -half, -half, r)
  ctx.arcTo(-half, -half, half, -half, r)
  ctx.closePath()

  ctx.globalAlpha = alpha
  ctx.fillStyle = pal.bg
  ctx.fill()
  ctx.strokeStyle = pal.ink
  ctx.lineWidth = 1
  ctx.globalAlpha = alpha * 0.75
  ctx.stroke()

  const pips = PIPS[clamp(value, 0, 6)] ?? PIPS[0]
  const off = half * 0.48
  const pr = Math.max(1.1, half * 0.115)
  ctx.fillStyle = pipColor
  ctx.globalAlpha = alpha * 0.9
  for (let i = 0; i < pips.length; i += 2) {
    ctx.beginPath()
    ctx.arc(pips[i] * off, pips[i + 1] * off, pr, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
  ctx.globalAlpha = alpha
}
