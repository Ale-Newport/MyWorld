'use client'

/**
 * LibraryMotion — the motion graphic for "My Library".
 *
 * The Django catalogue drawn as its own admission machine. Faker emits records
 * from the rail on the left; each one flies in as an index card and types its
 * author, title and ISBN. The digits land on a thirteen-slot track beneath the
 * card — the ISBN regex, drawn as a state machine. The head walks one slot per
 * digit; gate 10 is an accepting state (double circle), and any digit past it
 * opens the optional three-digit tail that ends at gate 13. A complete value is
 * then swept against the book table on the right — the 100 seeded rows — to
 * enforce the unique constraint. Accepted cards shrink into their row; rejects
 * drop into the bin carrying the reason they failed.
 *
 * Timeline (clock 0..1 walks six records):
 *   0.00  the first record leaves the Faker rail, its fields still empty
 *   0.33  a 13-digit ISBN closes the optional tail and locks on gate 13
 *   0.66  a duplicate of that ISBN clears the length gate and dies on UNIQUE
 *   1.00  the last record is filed; the seed run stands at 98 of 100
 *
 * Reduced motion holds the final verdict: thirteen digits locked on gate 13,
 * the tail open, the table all but seeded, both rejections still in the bin.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useCanvas2D } from '@/hooks/useCanvas2D'
import { clamp, damp, easeInOutCubic, easeOutCubic, lerp, seeded } from '@/lib/math'
import type { Project } from '@/content/types'
import { readPalette, type ProjectVisualProps, type VisualPalette } from './types'
import styles from './visual.module.css'

/* ---------------------------------------------------------------- constants */

/** The two accepting lengths of the validator: ^(\d{10}|\d{13})$ */
const GATE_A = 10
const GATE_B = 13
const SLOTS = GATE_B
const MAX_TYPED = SLOTS

/** Beat lengths, in abstract units. A longer ISBN takes longer to type. */
const ENTER = 0.9
const FSTART = ENTER * 0.65
const FIELDS = 0.85
const DIGIT = 0.13
const VERDICT_OK = 1.05
const VERDICT_NO = 0.9
/** Fraction of the verdict spent sweeping the table for a collision. */
const SCAN = 0.45

const RAIL_N = 14
const DASH: number[] = [2, 3]
const NODASH: number[] = []

type CardVerdict = 'accept' | 'len' | 'dup'
type MachineState = 'typing' | CardVerdict

/* ------------------------------------------------------------- the schedule */

interface Card {
  isbn: string
  chars: string[]
  len: number
  verdict: CardVerdict
  verdLen: number
  /** Index of the earlier record this one collides with, or -1. */
  dup: number
  /** Character counts for the two author words and the three title words. */
  author: number[]
  title: number[]
  vStart: number
  weight: number
  t0: number
  t1: number
  /** Clock at which this record's verdict begins — fixes its table row. */
  vClock: number
}

/**
 * Six sampled records. Two lengths pass, one stops between the gates, one is
 * a digit-for-digit repeat of an ISBN the table already holds.
 */
const SPECS: [string, number][] = [
  ['4471028365', -1],
  ['9784471028369', -1],
  ['84710283654', -1],
  ['9784471028369', 1],
  ['2938471065', -1],
  ['9782938471062', -1],
]

function buildCards(): Card[] {
  const rnd = seeded(0x1b0057)
  const cards: Card[] = []
  let total = 0

  for (const [isbn, dup] of SPECS) {
    const len = isbn.length
    const verdict: CardVerdict =
      dup >= 0 ? 'dup' : len === GATE_A || len === GATE_B ? 'accept' : 'len'
    const verdLen = verdict === 'accept' ? VERDICT_OK : VERDICT_NO
    const vStart = FSTART + FIELDS + len * DIGIT
    cards.push({
      isbn,
      chars: isbn.split(''),
      len,
      verdict,
      verdLen,
      dup,
      author: [4 + Math.floor(rnd() * 5), 5 + Math.floor(rnd() * 7)],
      title: [3 + Math.floor(rnd() * 4), 4 + Math.floor(rnd() * 5), 3 + Math.floor(rnd() * 6)],
      vStart,
      weight: vStart + verdLen,
      t0: 0,
      t1: 0,
      vClock: 0,
    })
    total += vStart + verdLen
  }

  let acc = 0
  for (const c of cards) {
    c.t0 = acc / total
    acc += c.weight
    c.t1 = acc / total
    c.vClock = c.t0 + (c.vStart / c.weight) * (c.t1 - c.t0)
  }
  return cards
}

const CARDS = buildCards()
const LAST = CARDS.length - 1

/** Rail tick lengths — deterministic, so SSR and client agree. */
const RAIL_LEN = new Float32Array(RAIL_N)
{
  const r = seeded(0x9a13f7)
  for (let i = 0; i < RAIL_N; i += 1) RAIL_LEN[i] = 3 + r() * 8
}

/** Gate numerals, pre-stringified so the draw loop allocates nothing. */
const NUMS: string[] = []
for (let i = 0; i <= SLOTS; i += 1) NUMS.push(String(i))

/** The single most legible frame: the last record, held on its verdict. */
const HOLD_CLOCK =
  CARDS[LAST].t0 +
  ((CARDS[LAST].vStart + CARDS[LAST].verdLen * 0.62) / CARDS[LAST].weight) *
    (CARDS[LAST].t1 - CARDS[LAST].t0)

function cardAt(clock: number): number {
  let i = 0
  while (i < LAST && clock >= CARDS[i].t1) i += 1
  return i
}

/** What the regex says about a value of `count` digits, read live. */
function liveVerdict(count: number): MachineState {
  if (count === GATE_A || count === GATE_B) return 'accept'
  if (count > GATE_A) return 'len'
  return 'typing'
}

/** The table row a record is filed into — fixed by the clock at its verdict. */
function cellOf(c: Card, cells: number): number {
  return clamp(Math.floor(c.vClock * cells), 0, cells - 1)
}

/** Unique-index probe: does an accepted row already hold these digits? */
function findDup(chars: string[], count: number): number {
  for (let i = 0; i < CARDS.length; i += 1) {
    const c = CARDS[i]
    if (c.verdict !== 'accept' || c.len !== count) continue
    let same = true
    for (let k = 0; k < count; k += 1) {
      if (c.chars[k] !== chars[k]) {
        same = false
        break
      }
    }
    if (same) return i
  }
  return -1
}

/* ------------------------------------------------------------------ layout */

interface Layout {
  w: number
  h: number
  chrome: boolean
  detail: boolean
  railX: number
  railTop: number
  railH: number
  cardX0: number
  cardX1: number
  cardY0: number
  cardY1: number
  cardMidX: number
  cardMidY: number
  labelX: number
  authorY: number
  titleY: number
  sepY: number
  isbnY: number
  vx0: number
  slot: number
  trackW: number
  vy: number
  stateY: number
  gateLabelY: number
  regexY: number
  showRegex: boolean
  showBin: boolean
  binY: number
  binRowH: number
  gridOn: boolean
  gridX: number
  gridY: number
  gridW: number
  gridH: number
  gridCell: number
  gridCols: number
  gridRows: number
  gridCells: number
  nano: number
  digitSize: number
  fontNano: string
  fontMicro: string
  fontDigit: string
}

function computeLayout(w: number, h: number, chrome: boolean, cells: number): Layout {
  const padX = clamp(w * 0.055, 10, 38)
  const padTop = clamp(h * 0.08, 8, 24) + (chrome ? 20 : 0)
  const padBot = clamp(h * 0.07, 8, 20) + (chrome ? 28 : 0)
  const detail = w >= 330 && h >= 190

  const micro = clamp(Math.round(Math.min(w, h) * 0.031), 7, 11)
  const nano = Math.max(7, micro - 2)

  const stageTop = padTop
  const stageBot = Math.max(stageTop + 90, h - padBot)
  const avail = stageBot - stageTop

  const cols = 10
  const gridOn = detail && w >= 358
  const gridW = gridOn ? clamp(w * 0.19, 62, 104) : 0
  const gridCell = gridW / cols
  const gridRows = Math.ceil(cells / cols)
  const gridH = gridRows * gridCell
  const gridX = w - padX - gridW

  const railX = padX + 3
  const colX0 = railX + clamp(w * 0.05, 16, 32)
  const colX1 = gridOn ? gridX - clamp(w * 0.04, 12, 26) : w - padX
  const colW = Math.max(120, colX1 - colX0)

  // The card is a labelled gutter plus the digit track it holds.
  const gutter = clamp(micro * 4.4, 24, 40)
  const trackW = Math.min(colW - gutter - 14, SLOTS * 20)
  const slot = trackW / SLOTS
  const vx0 = colX0 + gutter + 7

  const machineH = 46
  const binRowH = Math.max(9, nano + 3)
  const wantBin = avail > 196
  const binBlock = wantBin ? 12 + binRowH * 4 : 0
  const cardH = clamp(avail - machineH - binBlock - 12, 44, 92)
  const blockH = cardH + 10 + machineH + binBlock
  const cardY0 = stageTop + Math.max(0, (avail - blockH) * 0.5)
  const cardY1 = cardY0 + cardH

  const vy = cardY1 + 11
  const stateY = vy + 17
  const gateLabelY = stateY + 7
  const regexY = gateLabelY + 11
  // The bin header sits a clear line below the regex, its rows below that.
  const binY = regexY + binRowH + 12
  const digitSize = clamp(slot * 0.66, 7.5, 13)

  return {
    w,
    h,
    chrome,
    detail,
    railX,
    railTop: stageTop + 8,
    railH: Math.max(40, avail - 16),
    cardX0: vx0 - gutter - 7,
    cardX1: vx0 + trackW + 7,
    cardY0,
    cardY1,
    cardMidX: vx0 + trackW * 0.5 - gutter * 0.5,
    cardMidY: cardY0 + cardH * 0.5,
    labelX: vx0 - gutter,
    authorY: cardY0 + cardH * 0.26,
    titleY: cardY0 + cardH * 0.5,
    sepY: cardY0 + cardH * 0.655,
    isbnY: cardY0 + cardH * 0.83,
    vx0,
    slot,
    trackW,
    vy,
    stateY,
    gateLabelY,
    regexY,
    showRegex: detail && stageBot - regexY > 6,
    showBin: wantBin && stageBot - binY > binRowH * 2,
    binY,
    binRowH,
    gridOn,
    gridX,
    gridY: clamp(cardY0 + (blockH - gridH) * 0.5, stageTop, Math.max(stageTop, stageBot - gridH)),
    gridW,
    gridH,
    gridCell,
    gridCols: cols,
    gridRows,
    gridCells: cells,
    nano,
    digitSize,
    fontNano: `${nano}px ui-monospace, monospace`,
    fontMicro: `${micro}px ui-monospace, monospace`,
    fontDigit: `${digitSize}px ui-monospace, monospace`,
  }
}

/* --------------------------------------------------------------- utilities */

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

function seg(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
  ctx.stroke()
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath()
  ctx.arc(x, y, Math.max(0.4, r), 0, Math.PI * 2)
  ctx.fill()
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath()
  ctx.arc(x, y, Math.max(0.4, r), 0, Math.PI * 2)
  ctx.stroke()
}

/** Tiny canvas type, always left-aligned again afterwards. */
function label(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  font: string,
  colour: string,
  alpha: number,
  align: CanvasTextAlign = 'left',
): void {
  if (alpha <= 0.004) return
  ctx.globalAlpha = alpha
  ctx.fillStyle = colour
  ctx.font = font
  ctx.textAlign = align
  ctx.fillText(s, x, y)
  ctx.textAlign = 'left'
}

/**
 * A field value as redaction glyphs — one block per character, typed in word
 * by word. Never lorem, still reads as prose at a glance.
 */
function glyphRow(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y: number,
  words: number[],
  step: number,
  bh: number,
  typed: number,
): void {
  let x = x0
  let seen = 0
  for (let k = 0; k < words.length; k += 1) {
    for (let i = 0; i < words[k]; i += 1) {
      const on = typed - seen - i
      if (on <= 0) break
      const e = easeOutCubic(clamp(on))
      ctx.fillRect(x + i * step, y - bh * 0.5 - (1 - e) * 2.5, step * 0.62, bh * (0.35 + 0.65 * e))
    }
    seen += words[k]
    x += words[k] * step + step * 1.6
  }
}

/* ------------------------------------------------------------- the component */

export function LibraryMotion(props: ProjectVisualProps) {
  const { project, progress, reducedMotion = false, interactive = true, className } = props
  const chrome = interactive !== false

  const tests = metricValue(project, 'Unit tests', 55)
  const cells = clamp(Math.round(metricValue(project, 'Seeded books', 100)), 20, 200)
  const period = useMemo(() => clamp(project?.presentation.duration ?? 14, 8, 30), [project])

  const [shownLen, setShownLen] = useState(0)
  const [shownState, setShownState] = useState<MachineState>('typing')
  const [typedLen, setTypedLen] = useState(0)

  const layoutRef = useRef<Layout | null>(null)
  const paletteRef = useRef<VisualPalette | null>(null)
  const paletteAtRef = useRef(-1)
  const clockRef = useRef(0)
  const headRef = useRef(0)
  const typedRef = useRef<string[]>([])
  const manualRef = useRef(false)
  const hoverRef = useRef(false)
  const firstRef = useRef(true)
  const dirtyRef = useRef(true)
  const lenRef = useRef(-1)
  const stateRef = useRef<MachineState>('typing')

  const ref = useCanvas2D<HTMLCanvasElement>({
    setup: ({ ctx, w, h }) => {
      layoutRef.current = computeLayout(w, h, chrome, cells)
      paletteRef.current = readPalette(ctx.canvas)
      paletteAtRef.current = -1
      firstRef.current = true
      dirtyRef.current = true
    },

    draw: ({ ctx, w, h, t, dt }) => {
      let L = layoutRef.current
      if (!L || L.w !== w || L.h !== h || L.chrome !== chrome || L.gridCells !== cells) {
        L = computeLayout(w, h, chrome, cells)
        layoutRef.current = L
        firstRef.current = true
        dirtyRef.current = true
      }

      // getComputedStyle is not free — poll the palette rather than read it
      // every frame. A theme swap only needs to land within half a second.
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
      const { ink, inkSoft, inkFaint, accent, signal } = palette

      /* ---- master clock -------------------------------------------------- */

      const manual = manualRef.current && typedRef.current.length > 0
      let clock: number
      if (manual) {
        // Hand the machine over: the seed run is finished, the table is full.
        clock = 1
      } else if (reducedMotion) {
        clock = HOLD_CLOCK
      } else if (typeof progress === 'number') {
        const target = clamp(progress) * 0.99999
        clock = firstRef.current ? target : damp(clockRef.current, target, 14, dt)
      } else {
        clock = (clockRef.current + dt / period) % 1
      }
      clockRef.current = clock

      if (reducedMotion && !dirtyRef.current) return

      /* ---- what the machine is reading ----------------------------------- */

      const idx = cardAt(clock)
      const card = CARDS[idx]
      const beats = ((clock - card.t0) / (card.t1 - card.t0 || 1e-6)) * card.weight

      let chars: string[]
      let count: number
      let state: MachineState
      let verdictP = 0
      let enterP = 1
      let fieldsP = 1
      let typedF = 0
      let dupOn = -1
      let exit = 0

      if (manual) {
        chars = typedRef.current
        count = chars.length
        typedF = count
        state = liveVerdict(count)
        if (state === 'accept') {
          const hit = findDup(chars, count)
          if (hit >= 0) {
            state = 'dup'
            dupOn = hit
          }
        }
        verdictP = state === 'typing' ? 0 : 1
      } else {
        chars = card.chars
        enterP = clamp(beats / ENTER)
        fieldsP = clamp((beats - FSTART) / FIELDS)
        typedF = clamp((beats - FSTART - FIELDS) / (card.len * DIGIT)) * card.len
        count = Math.min(card.len, Math.floor(typedF + 1e-6))
        verdictP = clamp((beats - card.vStart) / card.verdLen)
        if (beats < card.vStart) {
          state = liveVerdict(count)
        } else if (card.verdict === 'dup') {
          // Length passes first; the unique index kills it a beat later.
          state = verdictP < SCAN ? 'accept' : 'dup'
          if (state === 'dup') dupOn = card.dup
        } else {
          state = card.verdict
        }
        exit = easeInOutCubic(clamp((verdictP - SCAN) / (1 - SCAN)))
      }

      const settled = state !== 'typing'
      const verdictInk = state === 'accept' ? signal : settled ? accent : inkSoft
      const trackInk = settled ? verdictInk : inkSoft

      headRef.current =
        reducedMotion || firstRef.current ? count : damp(headRef.current, count, 20, dt)
      const head = headRef.current
      const headX = L.vx0 + head * L.slot
      const tailOpen = clamp((head - GATE_A) / 0.85)
      const filled = manual ? L.gridCells : Math.min(L.gridCells, Math.floor(clock * L.gridCells))

      /* ---- frame --------------------------------------------------------- */

      ctx.clearRect(0, 0, w, h)
      ctx.lineJoin = 'round'
      ctx.lineCap = 'butt'
      ctx.setLineDash(NODASH)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'

      /* ---- generator rail: Faker, still running --------------------------- */

      ctx.strokeStyle = inkFaint
      ctx.lineWidth = 0.75
      ctx.globalAlpha = 0.35
      seg(ctx, L.railX, L.railTop, L.railX, L.railTop + L.railH)

      for (let k = 0; k < RAIL_N; k += 1) {
        const f = ((((k + 0.5) / RAIL_N + clock * 4) % 1) + 1) % 1
        const y = L.railTop + f * L.railH
        ctx.globalAlpha = 0.14 + Math.sin(f * Math.PI) * 0.34
        seg(ctx, L.railX + 2, y, L.railX + 2 + RAIL_LEN[k], y)
      }
      if (L.detail) label(ctx, 'FAKER', L.railX - 1, L.railTop - 7, L.fontNano, inkFaint, 0.4)

      /* ---- book table: the seeded rows ------------------------------------ */

      if (L.gridOn) {
        const box = Math.max(2.6, L.gridCell * 0.42)
        for (let i = 0; i < L.gridCells; i += 1) {
          const x = L.gridX + ((i % L.gridCols) + 0.5) * L.gridCell
          const y = L.gridY + (Math.floor(i / L.gridCols) + 0.5) * L.gridCell
          const s = i < filled ? box : box * 0.7
          ctx.globalAlpha = i < filled ? 0.42 : 0.28
          ctx.fillStyle = i < filled ? inkSoft : inkFaint
          ctx.fillRect(x - s * 0.5, y - s * 0.5, s, s)
        }

        // Rows admitted during this run, and the one a duplicate hit.
        for (let i = 0; i < CARDS.length; i += 1) {
          const c = CARDS[i]
          if (c.verdict !== 'accept') continue
          if (!manual && (i > idx || (i === idx && verdictP < SCAN))) continue
          const ci = cellOf(c, L.gridCells)
          const x = L.gridX + ((ci % L.gridCols) + 0.5) * L.gridCell
          const y = L.gridY + (Math.floor(ci / L.gridCols) + 0.5) * L.gridCell
          const fresh = !manual && i === idx ? clamp((verdictP - SCAN) / 0.3) : 1
          const hit = dupOn === i
          const s = box * (hit ? 1.5 : 1.15) * (0.4 + 0.6 * fresh)
          ctx.globalAlpha = hit ? 1 : 0.85
          ctx.fillStyle = hit ? accent : signal
          ctx.fillRect(x - s * 0.5, y - s * 0.5, s, s)
          if (hit) {
            ctx.globalAlpha = 0.5
            ctx.strokeStyle = accent
            ctx.lineWidth = 0.75
            ring(ctx, x, y, box * 1.9)
          }
        }

        // The unique-index sweep: every complete ISBN is checked against the
        // table before it is written. A duplicate stops the scan at its row.
        if (!manual && verdictP > 0 && verdictP < SCAN && (count === GATE_A || count === GATE_B)) {
          const sweep = clamp(verdictP / SCAN)
          const stop =
            card.verdict === 'dup'
              ? (Math.floor(cellOf(CARDS[card.dup], L.gridCells) / L.gridCols) + 0.5) / L.gridRows
              : 1
          const y = L.gridY + sweep * stop * L.gridH
          ctx.globalAlpha = 0.55 * Math.sin(sweep * Math.PI)
          ctx.strokeStyle = card.verdict === 'dup' ? accent : inkSoft
          ctx.lineWidth = 0.75
          seg(ctx, L.gridX, y, L.gridX + L.gridW, y)
        }

        if (L.detail) {
          label(ctx, 'BOOK TABLE', L.gridX, L.gridY - 7, L.fontNano, inkFaint, 0.4)
          const cnt = `${filled}/${L.gridCells}`
          const cy = L.gridY + L.gridH + 9
          label(ctx, cnt, L.gridX + L.gridW, cy, L.fontMicro, inkSoft, 0.62, 'right')
        }
      }

      /* ---- validator machine: the regex as an automaton -------------------- */

      const x10 = L.vx0 + GATE_A * L.slot
      const x13 = L.vx0 + GATE_B * L.slot

      // Slot track — one cell per digit the machine has consumed.
      for (let i = 0; i < SLOTS; i += 1) {
        const cx = L.vx0 + (i + 0.5) * L.slot
        const tail = i >= GATE_A
        const on = i < count
        ctx.globalAlpha = on ? 0.9 : tail ? 0.2 + 0.5 * tailOpen : 0.55
        ctx.strokeStyle = on ? trackInk : inkFaint
        ctx.lineWidth = on ? 1 : 0.75
        ctx.setLineDash(tail && tailOpen < 0.85 ? DASH : NODASH)
        seg(ctx, cx, L.vy - (on ? 4 : 2.5), cx, L.vy + (on ? 4 : 2.5))
      }
      ctx.setLineDash(NODASH)

      // The consumed span, then everything still unread.
      const hx = Math.max(L.vx0, headX)
      ctx.globalAlpha = 0.75
      ctx.strokeStyle = trackInk
      ctx.lineWidth = 1.1
      seg(ctx, L.vx0, L.vy, hx, L.vy)
      ctx.globalAlpha = 0.3
      ctx.strokeStyle = inkFaint
      ctx.lineWidth = 0.75
      seg(ctx, hx, L.vy, x13, L.vy)

      // The head, and its projection onto the state line.
      ctx.globalAlpha = 0.35
      ctx.strokeStyle = trackInk
      seg(ctx, headX, L.vy, headX, L.stateY)
      ctx.globalAlpha = 0.95
      ctx.fillStyle = settled ? verdictInk : ink
      dot(ctx, headX, L.vy, 2.1)

      // State line: start → gate 10 → the optional tail → gate 13.
      ctx.globalAlpha = 0.4
      ctx.strokeStyle = inkFaint
      ctx.lineWidth = 0.75
      seg(ctx, L.vx0, L.stateY, x10, L.stateY)
      ctx.globalAlpha = 0.25 + 0.6 * tailOpen
      ctx.strokeStyle = tailOpen > 0.5 ? inkSoft : inkFaint
      ctx.setLineDash(tailOpen > 0.9 ? NODASH : DASH)
      seg(ctx, x10, L.stateY, lerp(x10, x13, Math.max(0.06, tailOpen)), L.stateY)
      ctx.setLineDash(NODASH)
      ctx.globalAlpha = 0.5
      ctx.strokeStyle = inkFaint
      ring(ctx, L.vx0, L.stateY, 2)

      // Accepting states, drawn as double circles.
      for (let g = 0; g < 2; g += 1) {
        const gx = g === 0 ? x10 : x13
        const gn = g === 0 ? GATE_A : GATE_B
        const lit = count === gn
        ctx.globalAlpha = lit ? 1 : g === 1 ? 0.3 + 0.5 * tailOpen : 0.55
        ctx.strokeStyle = lit ? trackInk : inkFaint
        ctx.lineWidth = lit ? 1.1 : 0.75
        ring(ctx, gx, L.stateY, 3.4)
        ring(ctx, gx, L.stateY, 1.9)
        if (lit && state === 'accept') {
          ctx.globalAlpha = 0.9
          ctx.fillStyle = signal
          dot(ctx, gx, L.stateY, 1.5)
        }
        if (L.detail) {
          const col = lit ? trackInk : inkFaint
          label(ctx, NUMS[gn], gx, L.gateLabelY + 3, L.fontNano, col, lit ? 0.85 : 0.42, 'center')
        }
      }

      if (L.detail && tailOpen > 0.02) {
        const mid = (x10 + x13) * 0.5
        label(ctx, 'OPT +3', mid, L.vy + 11, L.fontNano, inkFaint, tailOpen * 0.55, 'center')
      }

      // The verdict, stated plainly.
      if (L.detail) {
        const said =
          state === 'accept'
            ? 'ACCEPT'
            : state === 'len'
              ? 'REJECT · LENGTH'
              : state === 'dup'
                ? 'REJECT · UNIQUE'
                : `READ ${count}`
        const col = settled ? verdictInk : inkFaint
        label(ctx, said, L.vx0, L.gateLabelY + 3, L.fontNano, col, settled ? 0.95 : 0.5)
      }
      if (L.showRegex) {
        label(ctx, '^(\\d{10}|\\d{13})$', L.vx0, L.regexY + 2, L.fontNano, inkFaint, 0.34)
      }
      if (chrome && hoverRef.current && !manual && L.showRegex) {
        label(ctx, 'TYPE DIGITS', x13, L.regexY + 2, L.fontNano, accent, 0.55, 'right')
      }

      /* ---- reject bin ------------------------------------------------------ */

      if (L.showBin) {
        label(ctx, 'REJECTED', L.labelX, L.binY - L.binRowH, L.fontNano, inkFaint, 0.36)
        let row = 0
        for (let i = 0; i < CARDS.length && row < 3; i += 1) {
          const c = CARDS[i]
          if (c.verdict === 'accept') continue
          if (!manual && !(i < idx || (i === idx && verdictP > SCAN))) continue
          const fresh = !manual && i === idx ? clamp((verdictP - SCAN) / 0.35) : 1
          const y = L.binY + row * L.binRowH
          const tw = c.isbn.length * L.nano * 0.62
          label(ctx, c.isbn, L.labelX, y - (1 - fresh) * 4, L.fontNano, inkSoft, 0.5 * fresh)
          ctx.globalAlpha = 0.8 * fresh
          ctx.strokeStyle = accent
          ctx.lineWidth = 0.75
          seg(ctx, L.labelX, y, L.labelX + tw * fresh, y)
          const tag = c.verdict === 'dup' ? 'DUP' : 'LEN'
          label(ctx, tag, L.labelX + tw + 7, y, L.fontNano, accent, 0.55 * fresh)
          row += 1
        }
      }

      /* ---- the record card -------------------------------------------------- */

      let dx = 0
      let dy = 0
      let scale = 1
      let cardA = 1

      if (!manual) {
        const eIn = easeOutCubic(enterP)
        dx = lerp(L.railX + 8 - L.cardX0, 0, eIn)
        dy = lerp(L.railH * 0.18, 0, eIn)
        cardA = clamp(enterP * 1.4)
        if (exit > 0) {
          if (card.verdict === 'accept') {
            // Filed: the record shrinks into the row it now occupies.
            let tx = L.cardX1 + 40
            let ty = L.cardMidY
            if (L.gridOn) {
              const ci = cellOf(card, L.gridCells)
              tx = L.gridX + ((ci % L.gridCols) + 0.5) * L.gridCell
              ty = L.gridY + (Math.floor(ci / L.gridCols) + 0.5) * L.gridCell
            }
            dx += (tx - L.cardMidX) * exit
            dy += (ty - L.cardMidY) * exit - Math.sin(exit * Math.PI) * 14
            scale = 1 - 0.88 * exit
          } else {
            // Discarded: it falls out of the machine, into the bin.
            dy += exit * (L.showBin ? L.binY - L.cardMidY : 40) * 0.55
            scale = 1 - 0.2 * exit
          }
          cardA *= 1 - easeInOutCubic(clamp((exit - 0.25) / 0.75))
        }

        // Faker hands the record over.
        if (enterP < 1) {
          ctx.globalAlpha = Math.sin(enterP * Math.PI) * 0.45
          ctx.strokeStyle = accent
          ctx.lineWidth = 0.75
          ctx.setLineDash(DASH)
          seg(ctx, L.railX + 3, L.railTop + L.railH * 0.5, L.cardX0 + dx, L.cardMidY + dy)
          ctx.setLineDash(NODASH)
        }
      }

      if (L.detail) label(ctx, 'BOOK', L.labelX, L.cardY0 - 7, L.fontNano, inkFaint, 0.4)

      if (cardA > 0.004) {
        ctx.save()
        ctx.translate(L.cardMidX + dx, L.cardMidY + dy)
        ctx.scale(scale, scale)
        ctx.translate(-L.cardMidX, -L.cardMidY)

        ctx.globalAlpha = cardA * (settled ? 0.7 : 0.5)
        ctx.strokeStyle = settled ? verdictInk : inkFaint
        ctx.lineWidth = 0.75
        ctx.strokeRect(L.cardX0, L.cardY0, L.cardX1 - L.cardX0, L.cardY1 - L.cardY0)

        if (L.detail) {
          const tag = manual ? 'MANUAL' : `R${idx + 1}`
          const col = manual ? accent : inkFaint
          label(ctx, tag, L.cardX1, L.cardY0 - 7, L.fontNano, col, cardA * (manual ? 0.8 : 0.45), 'right')
        }

        ctx.globalAlpha = cardA * 0.42
        ctx.fillStyle = inkFaint
        ctx.font = L.fontNano
        ctx.fillText('AUTHOR', L.labelX, L.authorY)
        ctx.fillText('TITLE', L.labelX, L.titleY)
        ctx.fillText('ISBN', L.labelX, L.isbnY)

        // Author and title, typing themselves in.
        const step = Math.max(2.8, L.nano * 0.46)
        const bh = Math.max(3, L.nano * 0.52)
        if (manual) {
          ctx.globalAlpha = cardA * 0.28
          ctx.strokeStyle = inkFaint
          ctx.lineWidth = 0.75
          ctx.setLineDash(DASH)
          seg(ctx, L.vx0, L.authorY, L.vx0 + L.trackW * 0.42, L.authorY)
          seg(ctx, L.vx0, L.titleY, L.vx0 + L.trackW * 0.42, L.titleY)
          ctx.setLineDash(NODASH)
        } else {
          const aN = card.author[0] + card.author[1]
          const tN = card.title[0] + card.title[1] + card.title[2]
          ctx.fillStyle = inkSoft
          ctx.globalAlpha = cardA * 0.7
          glyphRow(ctx, L.vx0, L.authorY, card.author, step, bh, fieldsP * aN)
          ctx.globalAlpha = cardA * 0.55
          glyphRow(ctx, L.vx0, L.titleY, card.title, step, bh, clamp(fieldsP * 1.25 - 0.25) * tN)
        }

        // The rule above the field the machine below is reading.
        ctx.globalAlpha = cardA * 0.3
        ctx.strokeStyle = inkFaint
        ctx.lineWidth = 0.75
        seg(ctx, L.labelX, L.sepY, L.cardX1 - 6, L.sepY)

        // The digits, each landing over its own slot.
        const failed = settled && state !== 'accept'
        ctx.font = L.fontDigit
        ctx.textAlign = 'center'
        for (let i = 0; i < count && i < SLOTS; i += 1) {
          const pop = manual ? 1 : easeOutCubic(clamp(typedF - i))
          ctx.globalAlpha = cardA * (0.35 + 0.65 * pop)
          ctx.fillStyle = failed ? verdictInk : ink
          ctx.fillText(chars[i], L.vx0 + (i + 0.5) * L.slot, L.isbnY - (1 - pop) * 5)
        }
        ctx.textAlign = 'left'

        // A struck ISBN is the clearest way to say "not stored".
        if (failed) {
          const swept = manual ? 1 : easeOutCubic(clamp((verdictP - SCAN * 0.5) / 0.3))
          ctx.globalAlpha = cardA * 0.9
          ctx.strokeStyle = accent
          ctx.lineWidth = 1.1
          seg(ctx, L.vx0, L.isbnY, L.vx0 + count * L.slot * swept, L.isbnY)
        }

        // Live caret while the visitor is typing.
        if (manual && count < SLOTS) {
          const blink = reducedMotion ? 0.7 : 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * 7))
          const cx = L.vx0 + (count + 0.5) * L.slot
          ctx.globalAlpha = cardA * blink
          ctx.strokeStyle = accent
          ctx.lineWidth = 1.1
          seg(ctx, cx, L.isbnY - L.digitSize * 0.55, cx, L.isbnY + L.digitSize * 0.55)
        }

        ctx.restore()
      }

      // The collision, named: this value → the row that already holds it.
      if (dupOn >= 0 && L.gridOn) {
        const ci = cellOf(CARDS[dupOn], L.gridCells)
        ctx.globalAlpha = 0.5
        ctx.strokeStyle = accent
        ctx.lineWidth = 0.75
        ctx.setLineDash(DASH)
        seg(
          ctx,
          L.cardX1 + dx + 4,
          L.isbnY + dy,
          L.gridX + ((ci % L.gridCols) + 0.5) * L.gridCell,
          L.gridY + (Math.floor(ci / L.gridCols) + 0.5) * L.gridCell,
        )
        ctx.setLineDash(NODASH)
      }

      ctx.globalAlpha = 1

      /* ---- readout ---------------------------------------------------------- */

      if (lenRef.current !== count) {
        lenRef.current = count
        setShownLen(count)
      }
      if (stateRef.current !== state) {
        stateRef.current = state
        setShownState(state)
      }

      firstRef.current = false
      dirtyRef.current = false
    },
  })

  /* ---- interaction: type an ISBN, the validator runs on it ----------------- */

  const clearTyped = useMemo(
    () => () => {
      typedRef.current.length = 0
      manualRef.current = false
      setTypedLen(0)
      dirtyRef.current = true
    },
    [],
  )

  useEffect(() => {
    if (!chrome) return
    const canvas = ref.current
    if (!canvas) return

    const onKey = (e: KeyboardEvent) => {
      const buf = typedRef.current
      if (e.key.length === 1 && e.key >= '0' && e.key <= '9') {
        if (buf.length < MAX_TYPED) buf.push(e.key)
        manualRef.current = true
      } else if (e.key === 'Backspace') {
        buf.pop()
        if (buf.length === 0) manualRef.current = false
      } else if (e.key === 'Escape') {
        buf.length = 0
        manualRef.current = false
      } else {
        return
      }
      e.preventDefault()
      setTypedLen(buf.length)
      dirtyRef.current = true
    }
    const onDown = () => canvas.focus()
    const onEnter = () => {
      hoverRef.current = true
      dirtyRef.current = true
    }
    const onLeave = () => {
      hoverRef.current = false
      dirtyRef.current = true
    }

    canvas.tabIndex = 0
    canvas.style.outline = 'none'
    canvas.style.cursor = 'text'
    canvas.addEventListener('keydown', onKey)
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerenter', onEnter)
    canvas.addEventListener('pointerleave', onLeave)

    return () => {
      canvas.removeEventListener('keydown', onKey)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerenter', onEnter)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.style.cursor = 'default'
    }
  }, [ref, chrome])

  const stateLabel =
    shownState === 'accept'
      ? 'ACCEPT'
      : shownState === 'len'
        ? 'REJECT LEN'
        : shownState === 'dup'
          ? 'REJECT DUP'
          : 'READING'

  return (
    <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
      <canvas ref={ref} className={styles.canvas} />
      {chrome && (
        <div className={styles.readout} aria-hidden="true">
          {shownLen} DIGIT{shownLen === 1 ? '' : 'S'} · {stateLabel}
        </div>
      )}
      {chrome && (
        <div className={styles.hud}>
          {typedLen > 0 ? (
            <button
              type="button"
              className={styles.chip}
              style={{ cursor: 'pointer' }}
              onClick={clearTyped}
              aria-label="Clear the typed ISBN"
            >
              CLEAR
            </button>
          ) : (
            <span className={styles.chip}>TYPE AN ISBN</span>
          )}
          <span className={styles.chip}>DJANGO 5.1.2</span>
          <span className={styles.chip}>{tests} TESTS</span>
        </div>
      )}
    </div>
  )
}
