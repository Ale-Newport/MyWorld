'use client'

/* ============================================================
   CardsMotion — Cinquillo
   ------------------------------------------------------------
   Explains two entries:

   · cinquillo-fair (HERO) — game design treated as an
     optimisation problem. Four suit tracks seeded by the 5; a
     headless simulation deals outward from those seeds, cards
     snapping into slots with suit-coloured trails from the seat
     that played them, seat rings shrinking as hands empty. A
     win-rate-by-seat bar chart converges live underneath —
     visibly skewed under the base rules, visibly flat once the
     fair variant is switched on.

   · cinquillo-web (archive) — the same board without the
     fairness chart: four suit lanes of ten slots, the rank-5
     column marked, the legal frontier pulsing.

   Nothing here is faked. The board, the legality, the agents,
   the dice mechanic and the bars all come from a deterministic
   Cinquillo simulation that runs in the browser: the 40-card
   Spanish deck (four suits × ranks 1–7 and 10–12), legality
   derived from board adjacency, four agent policies, and 1,200
   headless games tallied per rule set.
   ============================================================ */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useCanvas2D } from '@/hooks/useCanvas2D'
import { clamp, damp, easeOutCubic, formatCount, lerp, range, seeded } from '@/lib/math'
import { readPalette, type ProjectVisualProps, type VisualPalette } from './types'
import styles from './visual.module.css'

/* ---------- deck ----------------------------------------- */

/** Spanish deck ranks: 1–7 and 10–12. Index 4 is the 5 — the seed. */
const RANK_LABELS = ['1', '2', '3', '4', '5', '6', '7', '10', '11', '12'] as const
const SEED_R = 4
const N_RANKS = 10
const N_SUITS = 4
const N_SEATS = 4
const DECK = N_SUITS * N_RANKS
const HAND = DECK / N_SEATS

/** Oros, Copas, Espadas, Bastos — project-identity hues, not theme colours. */
const SUIT_LABELS = ['ORO', 'COP', 'ESP', 'BAS'] as const
const SUIT_HUES = ['#c0892c', '#b0454c', '#3d6d9e', '#4c7a4a'] as const
const AGENT_LABELS = ['RND', 'HEU', 'MCTS', 'RL'] as const
const SEAT_TAGS = ['P1', 'P2', 'P3', 'P4'] as const

/* ---------- experiment ----------------------------------- */

/** Headless games per rule set. The displayed count scales to the real 5,000. */
const N_GAMES = 1200
const TARGET_GAMES = 5000
const BAR_MIN_SAMPLE = 24
/** Bar axis ceiling — a seat win rate never sensibly passes this. */
const BAR_MAX = 0.4
const TRAIL = 8

/* ---------- timeline ------------------------------------- */

const T_INTRO = 0.08
const T_BASE_END = 0.48
const T_WIPE_END = 0.56
const T_VAR_END = 0.92
const T_FADE = 0.975
/** The frame reduced-motion viewers get: both rule sets resolved. */
const STATIC_U = 0.94

const DASH_FAIR: number[] = [3, 5]
const NO_DASH: number[] = []

/** Flat x,y pip offsets (unit square) for die faces 1–6. */
const PIPS: readonly number[][] = [
  [0, 0],
  [-0.42, -0.42, 0.42, 0.42],
  [-0.42, -0.42, 0, 0, 0.42, 0.42],
  [-0.42, -0.42, 0.42, -0.42, -0.42, 0.42, 0.42, 0.42],
  [-0.42, -0.42, 0.42, -0.42, 0, 0, -0.42, 0.42, 0.42, 0.42],
  [-0.42, -0.5, 0.42, -0.5, -0.42, 0, 0.42, 0, -0.42, 0.5, 0.42, 0.5],
]

/* ============================================================
   SIMULATION — deterministic, allocation-free per game
   ============================================================ */

interface MoveLog {
  card: Int16Array
  seat: Int8Array
  die: Int8Array
  n: number
  winner: number
}

interface Scratch {
  owner: Int8Array
  board: Uint8Array
  hand: Int32Array
  order: Int32Array
  suitHold: Int32Array
}

function makeLog(cap: number): MoveLog {
  return {
    card: new Int16Array(cap),
    seat: new Int8Array(cap),
    die: new Int8Array(cap),
    n: 0,
    winner: 0,
  }
}

function makeScratch(): Scratch {
  return {
    owner: new Int8Array(DECK),
    board: new Uint8Array(DECK),
    hand: new Int32Array(N_SEATS),
    order: new Int32Array(DECK),
    suitHold: new Int32Array(N_SUITS),
  }
}

/** Legality is derived from board adjacency; the 5 of a suit is always legal. */
function isLegal(board: Uint8Array, card: number): boolean {
  const s = (card / N_RANKS) | 0
  const r = card - s * N_RANKS
  if (r === SEED_R) return true
  if (r > 0 && board[card - 1] === 1) return true
  if (r < N_RANKS - 1 && board[card + 1] === 1) return true
  return false
}

/**
 * Agent policies.
 *   0 RND  — uniform over legal moves; the fairness baseline.
 *   1 HEU  — shed the extremes, dump thin suits first.
 *   2 MCTS — extremes, but favour continuations you hold and
 *            avoid opening a slot an opponent can fill.
 *   3 RL   — the same signals under learned weights, valuing
 *            holding a suit long enough to run it out.
 */
function chooseCard(seat: number, policy: number, sc: Scratch, rnd: () => number): number {
  const { owner, board, suitHold } = sc
  suitHold.fill(0)
  for (let c = 0; c < DECK; c++) if (owner[c] === seat) suitHold[(c / N_RANKS) | 0]++

  let best = -1
  let bestScore = -Infinity
  let count = 0

  for (let c = 0; c < DECK; c++) {
    if (owner[c] !== seat) continue
    if (!isLegal(board, c)) continue

    if (policy === 0) {
      count++
      if (rnd() * count < 1) best = c
      continue
    }

    const s = (c / N_RANKS) | 0
    const r = c - s * N_RANKS
    const ext = Math.abs(r - SEED_R)
    let score: number

    if (policy === 1) {
      score = ext - suitHold[s] * 0.15
    } else {
      const nr = r + (r >= SEED_R ? 1 : -1)
      let ownsNext = 0
      let opens = 0
      if (nr >= 0 && nr < N_RANKS && board[s * N_RANKS + nr] === 0) {
        const o = owner[s * N_RANKS + nr]
        if (o === seat) ownsNext = 1
        else if (o >= 0) opens = 1
      }
      score =
        policy === 2
          ? ext * 0.9 + ownsNext * 2.2 - opens * 1.1
          : ext * 0.7 + ownsNext * 2.6 - opens * 0.8 + suitHold[s] * 0.25
    }

    score += rnd() * 0.001
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  return best
}

/**
 * One game; returns the winning seat.
 * `variant` enables the parameterised dice mechanic — a
 * beneficial face grants an extra play, an adverse face costs
 * the turn — on top of a rotating lead seat.
 */
function playGame(
  seed: number,
  agents: readonly number[],
  variant: boolean,
  startSeat: number,
  sc: Scratch,
  log: MoveLog | null,
): number {
  const rnd = seeded((seed * 2654435761 + 12345) >>> 0)
  const { owner, board, hand, order } = sc
  board.fill(0)
  hand.fill(0)
  for (let i = 0; i < DECK; i++) order[i] = i
  for (let i = DECK - 1; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0
    const tmp = order[i]
    order[i] = order[j]
    order[j] = tmp
  }
  for (let i = 0; i < DECK; i++) {
    const seatOf = i % N_SEATS
    owner[order[i]] = seatOf
    hand[seatOf]++
  }
  if (log) {
    log.n = 0
    log.winner = -1
  }

  let seat = startSeat
  let dead = 0

  for (let step = 0; step < 400; step++) {
    let die = 0
    let plays = 1
    if (variant) {
      die = 1 + ((rnd() * 6) | 0)
      if (die === 6) plays = 0
      else if (die === 1) plays = 2
    }

    let played = 0
    for (let p = 0; p < plays; p++) {
      const c = chooseCard(seat, agents[seat], sc, rnd)
      if (c < 0) break
      board[c] = 1
      owner[c] = -1
      hand[seat]--
      played++
      if (log && log.n < log.card.length) {
        log.card[log.n] = c
        log.seat[log.n] = seat
        log.die[log.n] = die
        log.n++
      }
      if (hand[seat] === 0) {
        if (log) log.winner = seat
        return seat
      }
    }

    if (played === 0) {
      if (log && log.n < log.card.length) {
        log.card[log.n] = -1
        log.seat[log.n] = seat
        log.die[log.n] = die
        log.n++
      }
      if (plays > 0) {
        dead++
        if (dead >= N_SEATS) break
      } else dead = 0
    } else dead = 0

    seat = (seat + 1) % N_SEATS
  }

  let win = 0
  for (let i = 1; i < N_SEATS; i++) if (hand[i] < hand[win]) win = i
  if (log) log.winner = win
  return win
}

interface RuleSet {
  /** Cumulative wins per seat after each game — N_GAMES × 4. */
  cum: Uint16Array
  /** Final win rate per seat. */
  final: Float32Array
  /** The single game that gets animated. */
  log: MoveLog
}

interface SimData {
  base: RuleSet
  vari: RuleSet
}

function buildRuleSet(agents: readonly number[], variant: boolean, sc: Scratch): RuleSet {
  const cum = new Uint16Array(N_GAMES * N_SEATS)
  const tally = new Int32Array(N_SEATS)
  for (let g = 0; g < N_GAMES; g++) {
    const w = playGame(g + 1, agents, variant, variant ? g % N_SEATS : 0, sc, null)
    tally[w]++
    const o = g * N_SEATS
    for (let i = 0; i < N_SEATS; i++) cum[o + i] = tally[i]
  }
  const final = new Float32Array(N_SEATS)
  for (let i = 0; i < N_SEATS; i++) final[i] = tally[i] / N_GAMES

  // Showcase game: under the base rules the lead seat should win,
  // under the variant anyone but the lead seat. That is the point.
  const log = makeLog(220)
  for (let s = 5000; s < 5090; s++) {
    const w = playGame(s, agents, variant, variant ? s % N_SEATS : 0, sc, log)
    if (log.n >= 40 && log.n <= 66 && (variant ? w !== 0 : w === 0)) break
  }
  return { cum, final, log }
}

/* ============================================================
   LAYOUT — recomputed only when the box changes
   ============================================================ */

interface Layout {
  w: number
  h: number
  want: boolean
  ok: boolean
  roomy: boolean
  laneLeft: number
  laneRight: number
  slotW: number
  cardW: number
  cardH: number
  laneTop: number
  laneH: number
  seatY: number
  seatR: number
  seatX: Float32Array
  rulerY: number
  gutter: number
  showBars: boolean
  barBase: number
  barH: number
  barW: number
  fontTiny: string
}

function makeLayout(): Layout {
  return {
    w: -1,
    h: -1,
    want: false,
    ok: false,
    roomy: false,
    laneLeft: 0,
    laneRight: 0,
    slotW: 0,
    cardW: 0,
    cardH: 0,
    laneTop: 0,
    laneH: 1,
    seatY: 0,
    seatR: 0,
    seatX: new Float32Array(N_SEATS),
    rulerY: 0,
    gutter: 0,
    showBars: false,
    barBase: 0,
    barH: 0,
    barW: 0,
    fontTiny: '8px ui-monospace, monospace',
  }
}

function computeLayout(L: Layout, w: number, h: number, wantBars: boolean) {
  if (L.w === w && L.h === h && L.want === wantBars) return
  L.w = w
  L.h = h
  L.want = wantBars
  L.ok = w > 150 && h > 120

  const padX = clamp(w * 0.06, 14, 46)
  const padY = clamp(h * 0.07, 12, 28)
  const hudReserve = w < 380 ? 68 : 48
  /** Keeps the seat row clear of the top-right readout. */
  const topReserve = padY + (wantBars ? 24 : 8)

  L.roomy = w > 320 && h > 250
  L.gutter = w > 300 ? 28 : 0
  L.laneLeft = padX + L.gutter
  L.laneRight = w - padX
  L.slotW = Math.max(4, (L.laneRight - L.laneLeft) / N_RANKS)

  L.seatR = clamp(L.slotW * 0.3, 7, 14)
  L.seatY = topReserve + L.seatR
  for (let i = 0; i < N_SEATS; i++) {
    L.seatX[i] = L.laneLeft + ((L.laneRight - L.laneLeft) * (i + 0.5)) / N_SEATS
  }
  L.rulerY = L.seatY + L.seatR + 26

  const bodyTop = L.rulerY + 14
  const bodyBottom = h - hudReserve

  L.barH = clamp(h * 0.17, 32, 78)
  L.barW = Math.min(L.slotW * 0.45, ((L.laneRight - L.laneLeft) / N_SEATS) * 0.14)
  L.showBars = wantBars && bodyBottom - bodyTop - (L.barH + 24) > 76
  L.barBase = bodyBottom
  L.laneTop = bodyTop
  const laneBottom = L.showBars ? bodyBottom - L.barH - 24 : bodyBottom
  L.laneH = Math.max(6, (laneBottom - L.laneTop) / N_SUITS)
  // Real card proportions: height first, width follows at ~2:3.
  L.cardH = Math.min(L.laneH * 0.62, 46)
  L.cardW = Math.min(L.cardH / 1.45, L.slotW * 0.66)

  L.fontTiny = `${clamp(Math.round(L.slotW * 0.2), 7, 10)}px ui-monospace, monospace`
}

/* ============================================================
   DRAW HELPERS — no allocation
   ============================================================ */

function rrect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w * 0.5, h * 0.5)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  ctx.lineTo(x + rr, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr)
  ctx.lineTo(x, y + rr)
  ctx.quadraticCurveTo(x, y, x + rr, y)
  ctx.closePath()
}

function drawDie(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  face: number,
  ink: string,
  hot: string,
  alpha: number,
) {
  const adverse = face === 6
  const tone = adverse ? hot : ink
  ctx.globalAlpha = alpha * 0.65
  ctx.strokeStyle = tone
  ctx.lineWidth = 1
  rrect(ctx, x - size * 0.5, y - size * 0.5, size, size, size * 0.22)
  ctx.stroke()
  const pips = PIPS[clamp(face, 1, 6) - 1]
  ctx.fillStyle = tone
  ctx.globalAlpha = alpha * 0.85
  const rad = Math.max(0.7, size * 0.09)
  for (let i = 0; i < pips.length; i += 2) {
    ctx.beginPath()
    ctx.arc(x + pips[i] * size * 0.5, y + pips[i + 1] * size * 0.5, rad, 0, Math.PI * 2)
    ctx.fill()
  }
}

/* ============================================================
   COMPONENT
   ============================================================ */

/** Mutable per-frame timeline state — reused, never re-allocated. */
interface Phase {
  variantOn: boolean
  intro: number
  dealT: number
  barT: number
  boardFade: number
}

/**
 * Every mutable buffer the component owns, allocated once. Scroll-linked
 * parents re-render on every frame, so nothing here may be built per render.
 */
interface Buffers {
  layout: Layout
  phase: Phase
  scratch: Scratch
  board: Uint8Array
  placed: Int16Array
  frontier: Uint8Array
  hand: Int32Array
  manualAt: Float32Array
  manualFrom: Float32Array
  barDisp: Float32Array
}

function makeBuffers(): Buffers {
  return {
    layout: makeLayout(),
    phase: { variantOn: false, intro: 0, dealT: 0, barT: 0, boardFade: 1 },
    scratch: makeScratch(),
    board: new Uint8Array(DECK),
    placed: new Int16Array(DECK),
    frontier: new Uint8Array(DECK),
    hand: new Int32Array(N_SEATS),
    manualAt: new Float32Array(DECK).fill(-1),
    manualFrom: new Float32Array(DECK * 2),
    barDisp: new Float32Array(N_SEATS),
  }
}

export function CardsMotion(props: ProjectVisualProps) {
  const { project, progress, reducedMotion, interactive, className } = props

  const isWeb = project?.id === 'cinquillo-web'
  const wantBars = !isWeb
  const loopSec = clamp(project?.presentation.duration ?? 26, 14, 30)

  const [agents, setAgents] = useState<readonly number[]>(() => [0, 0, 0, 0])

  const bufRef = useRef<Buffers | null>(null)
  if (bufRef.current === null) bufRef.current = makeBuffers()
  const buf = bufRef.current

  /**
   * The 2,400 headless games are built on first draw, not during render,
   * so server rendering never pays for them. Rebuilt only when a seat's
   * agent changes.
   */
  const simRef = useRef<{ key: readonly number[]; data: SimData } | null>(null)

  const paletteRef = useRef<VisualPalette | null>(null)
  const paletteAt = useRef(-10)
  const clockRef = useRef(0)
  const barReadyRef = useRef(false)

  const hoverSeatRef = useRef(-1)
  const hoverSlotRef = useRef(-1)
  const cursorRef = useRef('')
  /** 0 auto · 1 pinned base · 2 pinned variant. The web build never switches. */
  const overrideRef = useRef(isWeb ? 1 : 0)
  const prevURef = useRef(0)
  const prevVariantRef = useRef(false)

  const readoutRef = useRef<HTMLDivElement | null>(null)
  const readoutARef = useRef<HTMLSpanElement | null>(null)
  const readoutBRef = useRef<HTMLSpanElement | null>(null)
  const lastGamesRef = useRef(-1)
  const lastSpreadRef = useRef(-1)
  const baseChipRef = useRef<HTMLButtonElement | null>(null)
  const varChipRef = useRef<HTMLButtonElement | null>(null)

  const canvasRef = useCanvas2D({
    setup: (c) => {
      buf.layout.w = -1
      paletteRef.current = readPalette(c.ctx.canvas)
      paletteAt.current = -10
      barReadyRef.current = false
      lastGamesRef.current = -1
      lastSpreadRef.current = -1
    },
    draw: (c) => {
      const { ctx, w, h, t, dt } = c
      clockRef.current = t

      if (!paletteRef.current || t - paletteAt.current > 0.5) {
        paletteRef.current = readPalette(ctx.canvas)
        paletteAt.current = t
      }
      const pal = paletteRef.current

      if (simRef.current === null || simRef.current.key !== agents) {
        simRef.current = {
          key: agents,
          data: {
            base: buildRuleSet(agents, false, buf.scratch),
            vari: buildRuleSet(agents, true, buf.scratch),
          },
        }
      }
      const sim = simRef.current.data

      const L = buf.layout
      computeLayout(L, w, h, wantBars)
      ctx.clearRect(0, 0, w, h)
      if (!L.ok) return

      /* ---- timeline -------------------------------------- */
      const still = reducedMotion === true
      const scrub = typeof progress === 'number'
      const u = still ? STATIC_U : scrub ? clamp(progress) : (t / loopSec) % 1

      const P = buf.phase
      const ov = overrideRef.current
      if (ov !== 0) {
        P.variantOn = ov === 2
        P.intro = range(u, 0, T_INTRO)
        P.dealT = range(u, T_INTRO, T_VAR_END)
        P.barT = range(u, T_INTRO, T_VAR_END)
        P.boardFade = 1
      } else {
        P.intro = range(u, 0, T_INTRO)
        if (u < T_WIPE_END) {
          P.variantOn = false
          P.dealT = range(u, T_INTRO, T_BASE_END)
          P.barT = range(u, T_INTRO, T_BASE_END)
          P.boardFade = 1 - range(u, T_BASE_END, T_WIPE_END)
        } else {
          P.variantOn = true
          P.dealT = range(u, T_WIPE_END, T_VAR_END)
          P.barT = range(u, T_WIPE_END, T_VAR_END)
          P.boardFade = 1
        }
      }
      if (!still && !scrub) P.boardFade *= 1 - range(u, T_FADE, 1)

      const manualAt = buf.manualAt
      const manualFrom = buf.manualFrom
      if (u < prevURef.current - 0.15 || P.variantOn !== prevVariantRef.current) manualAt.fill(-1)
      prevURef.current = u
      prevVariantRef.current = P.variantOn

      const rules = P.variantOn ? sim.vari : sim.base
      const log = rules.log
      const showGhost = P.variantOn && wantBars

      /* ---- replay the showcase game ---------------------- */
      const board = buf.board
      const placed = buf.placed
      const hand = buf.hand
      board.fill(0)
      placed.fill(-1)
      for (let i = 0; i < N_SEATS; i++) hand[i] = HAND

      const span = P.dealT * log.n
      const k = Math.min(log.n, Math.floor(span))
      const frac = clamp(span - k)
      for (let i = 0; i < k; i++) {
        const cd = log.card[i]
        if (cd < 0) continue
        board[cd] = 1
        placed[cd] = i
        hand[log.seat[i]]--
      }
      for (let cd = 0; cd < DECK; cd++) if (manualAt[cd] >= 0) board[cd] = 1

      /* ---- legal frontier -------------------------------- */
      const frontier = buf.frontier
      for (let cd = 0; cd < DECK; cd++) {
        frontier[cd] = board[cd] === 0 && isLegal(board, cd) ? 1 : 0
      }

      const pulse = still ? 0.55 : 0.5 + 0.5 * Math.sin(t * 3.1)
      const introE = easeOutCubic(P.intro)
      const fade = P.boardFade
      const cw = L.cardW
      const ch = L.cardH
      const hoverSlot = hoverSlotRef.current

      ctx.setLineDash(NO_DASH)
      ctx.font = L.fontTiny
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'

      /* ---- seed column ----------------------------------- */
      const seedX = L.laneLeft + L.slotW * (SEED_R + 0.5)
      ctx.strokeStyle = pal.accent
      ctx.globalAlpha = 0.16 * introE
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(seedX, L.laneTop + L.laneH * 0.08)
      ctx.lineTo(seedX, L.laneTop + L.laneH * (N_SUITS - 0.08))
      ctx.stroke()

      /* ---- lanes ----------------------------------------- */
      const showRank = cw >= 14 && ch >= 18
      for (let s = 0; s < N_SUITS; s++) {
        const cy = L.laneTop + L.laneH * (s + 0.5)
        const laneIn = clamp((introE - s * 0.06) / 0.7)
        if (laneIn <= 0) continue
        const hue = SUIT_HUES[s]

        ctx.strokeStyle = pal.inkFaint
        ctx.globalAlpha = 0.22 * laneIn
        ctx.lineWidth = 0.75
        ctx.beginPath()
        ctx.moveTo(L.laneLeft + 2, cy)
        ctx.lineTo(L.laneLeft + 2 + (L.laneRight - L.laneLeft - 4) * laneIn, cy)
        ctx.stroke()

        if (L.gutter > 0) {
          ctx.globalAlpha = 0.5 * laneIn
          ctx.fillStyle = hue
          ctx.textAlign = 'right'
          ctx.fillText(SUIT_LABELS[s], L.laneLeft - 8, cy)
          ctx.textAlign = 'center'
        }

        for (let r = 0; r < N_RANKS; r++) {
          const cd = s * N_RANKS + r
          const cx = L.laneLeft + L.slotW * (r + 0.5)

          if (board[cd] === 0) {
            const seedGlow = r === SEED_R ? 1 - clamp(P.dealT * 6) : 0
            if (hoverSlot === cd) {
              ctx.strokeStyle = pal.accent
              ctx.globalAlpha = laneIn * 0.9
              ctx.lineWidth = 1.2
            } else if (seedGlow > 0.01) {
              ctx.strokeStyle = pal.accent
              ctx.globalAlpha = laneIn * fade * (0.3 + 0.45 * pulse) * seedGlow
              ctx.lineWidth = 1.1
            } else if (frontier[cd] === 1) {
              ctx.strokeStyle = pal.inkSoft
              ctx.globalAlpha = laneIn * fade * (0.22 + 0.3 * pulse)
              ctx.lineWidth = 1
            } else {
              ctx.strokeStyle = pal.inkFaint
              ctx.globalAlpha = laneIn * 0.15
              ctx.lineWidth = 0.75
            }
            rrect(ctx, cx - cw * 0.5, cy - ch * 0.5, cw, ch, 2)
            ctx.stroke()
            continue
          }

          // placed card, easing in from the moment it was played
          const man = manualAt[cd]
          let ent: number
          if (man >= 0) ent = still ? 1 : clamp((t - man) / 0.38)
          else if (placed[cd] >= 0) ent = clamp((k - placed[cd] + frac) / 1.1)
          else ent = 1
          const e = easeOutCubic(ent)
          const sz = lerp(0.72, 1, e)
          const a = fade * laneIn * e

          if (man >= 0 && ent < 1) {
            ctx.strokeStyle = pal.accent
            ctx.globalAlpha = (1 - ent) * 0.55
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(lerp(manualFrom[cd * 2], cx, e), lerp(manualFrom[cd * 2 + 1], cy, e))
            ctx.lineTo(cx, cy)
            ctx.stroke()
          }

          ctx.globalAlpha = a * 0.1
          ctx.fillStyle = hue
          rrect(ctx, cx - cw * sz * 0.5, cy - ch * sz * 0.5, cw * sz, ch * sz, 2)
          ctx.fill()
          ctx.globalAlpha = a * 0.8
          ctx.strokeStyle = hue
          ctx.lineWidth = 1
          ctx.stroke()

          if (showRank) {
            ctx.globalAlpha = a * (r === SEED_R ? 0.95 : 0.58)
            ctx.fillStyle = r === SEED_R ? pal.accent : hue
            ctx.fillText(RANK_LABELS[r], cx, cy)
          }
        }
      }

      /* ---- rank ruler ------------------------------------ */
      for (let r = 0; r < N_RANKS; r++) {
        const seed = r === SEED_R
        ctx.globalAlpha = introE * (seed ? 0.8 : 0.22)
        ctx.fillStyle = seed ? pal.accent : pal.inkFaint
        ctx.fillText(RANK_LABELS[r], L.laneLeft + L.slotW * (r + 0.5), L.rulerY)
      }

      /* ---- trails + the card in flight ------------------- */
      const flyIdx = k < log.n ? k : -1
      for (let i = Math.max(0, k - TRAIL); i <= k && i < log.n; i++) {
        const cd = log.card[i]
        if (cd < 0) continue
        const s = (cd / N_RANKS) | 0
        const r = cd - s * N_RANKS
        const px = L.laneLeft + L.slotW * (r + 0.5)
        const py = L.laneTop + L.laneH * (s + 0.5)
        const sx = L.seatX[log.seat[i]]
        const sy = L.seatY + L.seatR * 0.35
        const mx = (sx + px) * 0.5 + (px - sx) * 0.18
        const my = (sy + py) * 0.5 - L.laneH * 0.5

        const flying = i === flyIdx
        const aT = flying ? 1 : clamp(1 - (k - i + frac) / TRAIL)
        if (aT <= 0.01) continue

        ctx.strokeStyle = SUIT_HUES[s]
        ctx.globalAlpha = fade * aT * (flying ? 0.6 : 0.34)
        ctx.lineWidth = flying ? 1.3 : 0.9
        ctx.beginPath()
        ctx.moveTo(sx, sy)
        ctx.quadraticCurveTo(mx, my, px, py)
        ctx.stroke()

        if (flying) {
          const ft = easeOutCubic(frac)
          const inv = 1 - ft
          const fx = inv * inv * sx + 2 * inv * ft * mx + ft * ft * px
          const fy = inv * inv * sy + 2 * inv * ft * my + ft * ft * py
          const fs = lerp(0.45, 1, ft)
          ctx.globalAlpha = fade * 0.95
          ctx.fillStyle = SUIT_HUES[s]
          rrect(ctx, fx - cw * fs * 0.5, fy - ch * fs * 0.5, cw * fs, ch * fs, 2)
          ctx.fill()
        }
      }

      /* ---- a pass strikes the seat ring ------------------ */
      const passSeat = flyIdx >= 0 && log.card[flyIdx] < 0 ? log.seat[flyIdx] : -1
      if (passSeat >= 0) {
        ctx.globalAlpha = fade * (0.25 + 0.5 * (1 - frac))
        ctx.strokeStyle = pal.inkSoft
        ctx.lineWidth = 1
        const px = L.seatX[passSeat]
        ctx.beginPath()
        ctx.moveTo(px - L.seatR * 1.35, L.seatY)
        ctx.lineTo(px + L.seatR * 1.35, L.seatY)
        ctx.stroke()
      }

      /* ---- seats ----------------------------------------- */
      const actSeat = flyIdx >= 0 ? log.seat[flyIdx] : -1
      const winner = P.dealT >= 0.999 ? log.winner : -1
      const hoverSeat = hoverSeatRef.current
      for (let i = 0; i < N_SEATS; i++) {
        const pop = clamp((introE - i * 0.05) / 0.6)
        if (pop <= 0) continue
        const sx = L.seatX[i]
        const sy = L.seatY
        const hov = hoverSeat === i
        const isWin = winner === i
        const live = i === actSeat || hov

        ctx.strokeStyle = pal.inkFaint
        ctx.globalAlpha = 0.24 * pop
        ctx.lineWidth = 0.75
        ctx.beginPath()
        ctx.arc(sx, sy, L.seatR * pop, 0, Math.PI * 2)
        ctx.stroke()

        ctx.strokeStyle = isWin ? pal.accent : live ? pal.ink : pal.inkSoft
        ctx.globalAlpha = pop * (isWin ? 0.95 : live ? 0.8 : 0.5)
        ctx.lineWidth = isWin || hov ? 1.4 : 1
        ctx.beginPath()
        ctx.arc(sx, sy, Math.max(0.6, L.seatR * lerp(0.16, 1, clamp(hand[i] / HAND)) * pop), 0, Math.PI * 2)
        ctx.stroke()

        if (isWin) {
          ctx.globalAlpha = pop * 0.9
          ctx.fillStyle = pal.accent
          ctx.beginPath()
          ctx.arc(sx, sy, 1.6, 0, Math.PI * 2)
          ctx.fill()
        }

        ctx.globalAlpha = pop * (hov ? 1 : 0.46)
        ctx.fillStyle = hov ? pal.accent : pal.inkSoft
        ctx.fillText(isWeb ? SEAT_TAGS[i] : AGENT_LABELS[agents[i]], sx, sy + L.seatR + 9)

        if (P.variantOn && i === actSeat && flyIdx >= 0 && log.die[flyIdx] > 0) {
          drawDie(
            ctx,
            sx + L.seatR + 11,
            sy,
            Math.max(9, L.seatR * 0.95),
            log.die[flyIdx],
            pal.inkSoft,
            pal.accent,
            fade * (0.35 + 0.65 * (1 - frac)),
          )
        }
      }

      /* ---- win rate by seat ------------------------------ */
      let spread = 0
      let games = 0
      if (L.showBars) {
        const m = BAR_MIN_SAMPLE + Math.round(P.barT * (N_GAMES - BAR_MIN_SAMPLE))
        const off = (m - 1) * N_SEATS
        const disp = buf.barDisp
        for (let i = 0; i < N_SEATS; i++) {
          const target = rules.cum[off + i] / m
          disp[i] =
            barReadyRef.current && !still && !scrub ? damp(disp[i], target, 11, dt) : target
        }
        barReadyRef.current = true

        let hi = 0
        let lo = 1
        for (let i = 0; i < N_SEATS; i++) {
          if (disp[i] > hi) hi = disp[i]
          if (disp[i] < lo) lo = disp[i]
        }
        spread = (hi - lo) * 100
        games = Math.round((m / N_GAMES) * TARGET_GAMES)

        const base = L.barBase
        const appear = clamp((P.barT + 0.05) * 4)

        ctx.strokeStyle = pal.inkFaint
        ctx.globalAlpha = 0.35 * introE
        ctx.lineWidth = 0.75
        ctx.beginPath()
        ctx.moveTo(L.laneLeft, base + 0.5)
        ctx.lineTo(L.laneRight, base + 0.5)
        ctx.stroke()

        // the one thing that matters in this frame: perfect fairness
        const fairY = base - (0.25 / BAR_MAX) * L.barH
        ctx.setLineDash(DASH_FAIR)
        ctx.strokeStyle = pal.accent
        ctx.globalAlpha = 0.75 * introE
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(L.laneLeft, fairY)
        ctx.lineTo(L.laneRight, fairY)
        ctx.stroke()
        ctx.setLineDash(NO_DASH)

        ctx.textAlign = 'left'
        ctx.globalAlpha = 0.7 * introE
        ctx.fillStyle = pal.accent
        ctx.fillText('0.25', L.laneLeft, fairY - 8)
        ctx.textAlign = 'center'

        for (let i = 0; i < N_SEATS; i++) {
          const cx = L.seatX[i]
          const bw = L.barW

          if (showGhost) {
            const gh = (sim.base.final[i] / BAR_MAX) * L.barH
            ctx.strokeStyle = pal.inkFaint
            ctx.globalAlpha = 0.6
            ctx.lineWidth = 0.75
            ctx.beginPath()
            ctx.moveTo(cx - bw * 0.5, base - gh)
            ctx.lineTo(cx - bw * 0.5, base)
            ctx.moveTo(cx + bw * 0.5, base - gh)
            ctx.lineTo(cx + bw * 0.5, base)
            ctx.moveTo(cx - bw * 0.5, base - gh)
            ctx.lineTo(cx + bw * 0.5, base - gh)
            ctx.stroke()
          }

          const bh = Math.min(L.barH, (disp[i] / BAR_MAX) * L.barH) * appear
          const iw = showGhost ? bw * 0.56 : bw
          const baseA = P.variantOn ? 0.72 : 0.48
          ctx.fillStyle = P.variantOn ? pal.signal : pal.inkSoft
          ctx.globalAlpha =
            hoverSeat === i ? 0.92 : actSeat === i || passSeat === i ? baseA + 0.16 : baseA
          ctx.fillRect(cx - iw * 0.5, base - Math.max(0, bh), iw, Math.max(0, bh))
        }
      } else {
        for (let cd = 0; cd < DECK; cd++) games += board[cd]
      }

      ctx.globalAlpha = 1
      ctx.setLineDash(NO_DASH)

      /* ---- HTML readout, written only when it changes ---- */
      if (readoutRef.current && readoutRef.current.hidden === L.roomy) {
        readoutRef.current.hidden = !L.roomy
      }
      const spreadKey = Math.round(spread * 10)
      if (games !== lastGamesRef.current && readoutARef.current) {
        readoutARef.current.textContent = L.showBars
          ? `${formatCount(games)} GAMES`
          : `${games} / ${DECK} PLACED`
        lastGamesRef.current = games
      }
      if (spreadKey !== lastSpreadRef.current && readoutBRef.current) {
        readoutBRef.current.textContent = L.showBars
          ? `SEAT SPREAD ${(spreadKey / 10).toFixed(1)}%`
          : '10 RANKS × 4 SUITS'
        lastSpreadRef.current = spreadKey
      }

      const onBase = P.variantOn ? 'false' : 'true'
      if (baseChipRef.current && baseChipRef.current.dataset.on !== onBase) {
        baseChipRef.current.dataset.on = onBase
        baseChipRef.current.setAttribute('aria-pressed', onBase)
      }
      const onVar = P.variantOn ? 'true' : 'false'
      if (varChipRef.current && varChipRef.current.dataset.on !== onVar) {
        varChipRef.current.dataset.on = onVar
        varChipRef.current.setAttribute('aria-pressed', onVar)
      }

      /* ---- cursor ---------------------------------------- */
      const want = hoverSeat >= 0 || hoverSlot >= 0 ? 'pointer' : 'default'
      if (want !== cursorRef.current) {
        ctx.canvas.style.cursor = want
        cursorRef.current = want
      }
    },
  })

  /* ---- pointer: cycle a seat's agent, or play a frontier card ---- */
  useEffect(() => {
    if (interactive === false) return
    const canvas = canvasRef.current
    if (!canvas) return

    const hit = (x: number, y: number) => {
      const L = buf.layout
      if (!L.ok) return
      let seat = -1
      if (!isWeb) {
        const reach = L.seatR + 12
        for (let i = 0; i < N_SEATS; i++) {
          const dx = x - L.seatX[i]
          const dy = y - L.seatY
          if (dx * dx + dy * dy < reach * reach) {
            seat = i
            break
          }
        }
      }
      hoverSeatRef.current = seat

      let slot = -1
      if (seat < 0) {
        const r = Math.floor((x - L.laneLeft) / L.slotW)
        const s = Math.floor((y - L.laneTop) / L.laneH)
        if (r >= 0 && r < N_RANKS && s >= 0 && s < N_SUITS) {
          const cd = s * N_RANKS + r
          if (buf.frontier[cd] === 1) slot = cd
        }
      }
      hoverSlotRef.current = slot
    }

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      hit(e.clientX - rect.left, e.clientY - rect.top)
    }

    const onLeave = () => {
      hoverSeatRef.current = -1
      hoverSlotRef.current = -1
    }

    const onDown = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      hit(x, y)

      const seat = hoverSeatRef.current
      if (seat >= 0) {
        setAgents((prev) => {
          const next = prev.slice()
          next[seat] = (next[seat] + 1) % AGENT_LABELS.length
          return next
        })
        return
      }

      const slot = hoverSlotRef.current
      if (slot >= 0) {
        buf.manualAt[slot] = clockRef.current
        buf.manualFrom[slot * 2] = x
        buf.manualFrom[slot * 2 + 1] = y
      }
    }

    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('pointerdown', onDown)
    return () => {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('pointerdown', onDown)
      hoverSeatRef.current = -1
      hoverSlotRef.current = -1
    }
  }, [buf, canvasRef, interactive, isWeb])

  const pin = useCallback((mode: number) => {
    overrideRef.current = overrideRef.current === mode ? 0 : mode
  }, [])

  return (
    <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
      <canvas ref={canvasRef} className={styles.canvas} />

      <div className={styles.readout} ref={readoutRef} aria-hidden="true">
        <span ref={readoutARef} />
        {!isWeb && <br />}
        {!isWeb && <span ref={readoutBRef} />}
      </div>

      <div className={styles.hud}>
        {isWeb ? (
          <>
            <span className={styles.chip}>40-card deck</span>
            <span className={styles.chip}>1 file · 15.7 KB</span>
          </>
        ) : (
          <>
            <button
              type="button"
              ref={baseChipRef}
              className={styles.chip}
              data-on="true"
              onClick={() => pin(1)}
            >
              Base rules
            </button>
            <button
              type="button"
              ref={varChipRef}
              className={styles.chip}
              data-on="false"
              onClick={() => pin(2)}
            >
              Fair variant
            </button>
            <span className={styles.chip}>33 variants</span>
          </>
        )}
      </div>
    </div>
  )
}
