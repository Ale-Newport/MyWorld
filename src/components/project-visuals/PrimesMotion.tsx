'use client'

/**
 * PrimesMotion — the motion graphic for "Primos en Click".
 *
 * Trial division, drawn instead of described. Integers march along a number
 * ribbon at the top; the current value is lifted out of the line and held
 * large at the left of the stage. Divisor probes fan out from it — one spoke
 * per candidate d ≤ √n — and each one tries to fold the number's n unit cells
 * into equal rows of d. A fold that fills its rectangle exactly kills the
 * number: the rectangle strokes, the numeral is struck through and drops away.
 * A fold that leaves holes fails, unwinds, and the next divisor tries. A number
 * that survives every candidate flares and flies down to the prime ribbon.
 *
 * Timeline (clock 0..1 walks 2…17):
 *   0.00  2 is lifted off the ribbon — no candidate divisors, prime by default
 *   0.33  9 folds cleanly into 3 × 3 — the rectangle closes, the numeral dies
 *   0.66  13 refuses 2 and 3, leaves holes both times, joins the prime ribbon
 *   1.00  17 refuses 2, 3 and 4; seven primes stand on the bottom ribbon
 *
 * Reduced motion holds the single most informative frame: 17 folded into rows
 * of 4, three holes open in the last row, the ribbon of primes already found.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useCanvas2D } from '@/hooks/useCanvas2D'
import { clamp, damp, easeInOutCubic, easeOutCubic, lerp, range, seeded } from '@/lib/math'
import type { Project } from '@/content/types'
import { readPalette, type ProjectVisualProps, type VisualPalette } from './types'
import styles from './visual.module.css'

/* ---------------------------------------------------------------- constants */

const N_MIN = 2
const N_MAX = 17

/** Beat lengths, in abstract units. The step for n is as long as its work. */
const ENTER = 0.85
const PROBE = 0.95
const VERD_PRIME = 0.95
const VERD_COMP = 0.62

/** Where inside one probe the fold completes and where it unwinds. */
const FOLD_IN = 0.5
const HOLD_OUT = 0.8

const BASE_NUM = 64
const FONT_NUM = `${BASE_NUM}px ui-monospace, monospace`
/** Module-scope dash patterns — setLineDash takes an array, so never build one per frame. */
const DASH: number[] = [2, 3]
const NODASH: number[] = []

/* ------------------------------------------------------------- the schedule */

interface Step {
  n: number
  /** Divisors actually tried: 2 … 2 + probes - 1. Trial division exits early. */
  probes: number
  /** Every candidate up to floor(√n) — the full fan, tried or not. */
  candidates: number
  prime: boolean
  /** Primes found strictly before this number. Doubles as its ribbon slot. */
  before: number
  weight: number
  t0: number
  t1: number
}

interface Schedule {
  steps: Step[]
  primes: number[]
  total: number
}

function buildSchedule(): Schedule {
  const steps: Step[] = []
  const primes: number[] = []
  let total = 0
  for (let n = N_MIN; n <= N_MAX; n += 1) {
    let probes = 0
    let prime = true
    for (let d = 2; d * d <= n; d += 1) {
      probes += 1
      if (n % d === 0) {
        prime = false
        break
      }
    }
    const before = primes.length
    const weight = ENTER + probes * PROBE + (prime ? VERD_PRIME : VERD_COMP)
    steps.push({
      n,
      probes,
      candidates: Math.max(0, Math.floor(Math.sqrt(n)) - 1),
      prime,
      before,
      weight,
      t0: 0,
      t1: 0,
    })
    if (prime) primes.push(n)
    total += weight
  }
  let acc = 0
  for (let i = 0; i < steps.length; i += 1) {
    steps[i].t0 = acc / total
    acc += steps[i].weight
    steps[i].t1 = acc / total
  }
  return { steps, primes, total }
}

const SCHED = buildSchedule()
const LAST = SCHED.steps.length - 1

/** Numerals used on the canvas, pre-stringified so the draw loop allocates nothing. */
const NUMS: string[] = []
for (let i = 0; i <= N_MAX + 6; i += 1) NUMS.push(String(i))

/** Primality of every tick the ribbon can show. 0 and 1 are marked composite. */
const IS_PRIME = new Uint8Array(N_MAX + 7)
for (let i = 2; i < IS_PRIME.length; i += 1) {
  let p = 1
  for (let d = 2; d * d <= i; d += 1) if (i % d === 0) { p = 0; break }
  IS_PRIME[i] = p
}

/** Per-cell phase jitter — deterministic, so SSR and client agree. */
const JITTER = new Float32Array(N_MAX + 1)
{
  const rnd = seeded(0x7c9e1d)
  for (let i = 0; i < JITTER.length; i += 1) JITTER[i] = rnd()
}

/** The clock at which a step is most legible: its last fold, held. */
function holdClock(s: Step): number {
  const beats =
    s.probes > 0
      ? ENTER + (s.probes - 1) * PROBE + PROBE * 0.68
      : ENTER + (s.prime ? VERD_PRIME : VERD_COMP) * 0.45
  return s.t0 + (beats / s.weight) * (s.t1 - s.t0)
}

function stepAt(clock: number): number {
  let i = 0
  while (i < LAST && clock >= SCHED.steps[i].t1) i += 1
  return i
}

/* ------------------------------------------------------------------ layout */

interface Layout {
  w: number
  h: number
  chrome: boolean
  detail: boolean
  padX: number
  /** Integer ribbon. */
  ribY: number
  ribDy: number
  ribFont: number
  tick: number
  curX: number
  /** Stage. */
  numX: number
  fx: number
  fy: number
  fieldW: number
  fieldH: number
  smax: number
  bigSize: number
  spokeX: number
  spokeLen: number
  /** Prime ribbon. */
  primeY: number
  pX0: number
  pStep: number
  pFont: number
  pDy: number
  fontNano: string
  fontMicro: string
}

function computeLayout(w: number, h: number, chrome: boolean): Layout {
  const padX = clamp(w * 0.06, 12, 44)
  const padTop = clamp(h * 0.1, 12, 28) + (chrome ? 20 : 0)
  const padBot = clamp(h * 0.08, 10, 22) + (chrome ? 30 : 0)
  const detail = w >= 320 && h >= 195

  const ribY = padTop
  const primeY = Math.max(ribY + 56, h - padBot)
  const stageTop = ribY + clamp(h * 0.13, 20, 54)
  const stageBot = primeY - clamp(h * 0.11, 16, 46)
  const fy = (stageTop + stageBot) * 0.5
  const fieldH = Math.max(26, stageBot - stageTop)

  const numW = clamp(w * 0.2, 38, 104)
  const gap = clamp(w * 0.08, 14, 56)
  const numX = padX + numW * 0.5
  const fx0 = padX + numW + gap
  const fx1 = w - padX
  const fieldW = Math.max(36, fx1 - fx0)

  const micro = clamp(Math.round(Math.min(w, h) * 0.03), 8, 11)

  return {
    w,
    h,
    chrome,
    detail,
    padX,
    ribY,
    ribDy: micro + 5,
    ribFont: micro,
    tick: clamp(w / 12, 20, 56),
    curX: w * 0.5,
    numX,
    fx: (fx0 + fx1) * 0.5,
    fy,
    fieldW,
    fieldH,
    smax: clamp(Math.min(fieldW, fieldH) * 0.14, 6.5, 20),
    bigSize: clamp(Math.min(numW * 0.82, fieldH * 0.5), 18, 58),
    spokeX: padX + numW,
    spokeLen: gap * 0.92,
    primeY,
    pX0: padX,
    pStep: clamp((w - padX * 2) / SCHED.primes.length, 18, 58),
    pFont: micro + 1,
    pDy: micro * 0.6 + 3,
    fontNano: `${Math.max(7, micro - 2)}px ui-monospace, monospace`,
    fontMicro: `${micro}px ui-monospace, monospace`,
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

/** One numeral, drawn by scaling a single cached font — no per-frame font strings. */
function numeral(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  colour: string,
  alpha: number,
): void {
  if (alpha <= 0.004 || size <= 0.4) return
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = colour
  ctx.font = FONT_NUM
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.translate(x, y)
  const k = size / BASE_NUM
  ctx.scale(k, k)
  ctx.fillText(text, 0, 0)
  ctx.restore()
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath()
  ctx.arc(x, y, Math.max(0.4, r), 0, Math.PI * 2)
  ctx.fill()
}

/* ------------------------------------------------------------- the component */

export function PrimesMotion(props: ProjectVisualProps) {
  const { project, progress, reducedMotion = false, interactive = true, className } = props
  const chrome = interactive !== false

  const loc = metricValue(project, 'Lines of code', 71)
  /** The designed duration sets the tempo; the number line sets the loop length. */
  const period = useMemo(
    () => SCHED.total * clamp((project?.presentation.duration ?? 14) / 28, 0.3, 0.72),
    [project],
  )

  const [shownN, setShownN] = useState(N_MIN)
  const [shownP, setShownP] = useState(0)

  const layoutRef = useRef<Layout | null>(null)
  const paletteRef = useRef<VisualPalette | null>(null)
  const paletteAtRef = useRef(-1)
  const clockRef = useRef(0)
  const idxRef = useRef(reducedMotion ? LAST : 0)
  const manualRef = useRef(false)
  const hoverRef = useRef(false)
  const firstRef = useRef(true)
  const dirtyRef = useRef(true)
  const nRef = useRef(-1)
  const pRef = useRef(-1)

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
      const { ink, inkSoft, inkFaint, bg, accent } = palette

      /* ---- master clock -------------------------------------------------- */

      let clock: number
      if (manualRef.current) {
        const target = holdClock(SCHED.steps[idxRef.current])
        let c = clockRef.current
        if (reducedMotion) {
          c = target
        } else {
          // Stepping back (or wrapping) replays that number from its own start.
          if (c > target + 1e-5) c = SCHED.steps[idxRef.current].t0
          const secs = (target - c) * period
          const rush = 1 + clamp((secs - 2.2) / 3) * 2.4
          c = Math.min(target, c + (dt / period) * rush)
          if (c < target - 1e-5) dirtyRef.current = true
        }
        clockRef.current = c
        clock = c
      } else if (reducedMotion) {
        clock = holdClock(SCHED.steps[LAST])
        clockRef.current = clock
      } else if (typeof progress === 'number') {
        const target = clamp(progress) * 0.99999
        clock = firstRef.current ? target : damp(clockRef.current, target, 14, dt)
        clockRef.current = clock
      } else {
        clock = (clockRef.current + dt / period) % 1
        clockRef.current = clock
      }

      if (reducedMotion && !dirtyRef.current) return

      /* ---- where are we in the walk -------------------------------------- */

      const idx = stepAt(clock)
      const step = SCHED.steps[idx]
      const prev = idx > 0 ? SCHED.steps[idx - 1] : null
      const n = step.n
      const beats = ((clock - step.t0) / (step.t1 - step.t0)) * step.weight

      const enterP = clamp(beats / ENTER)
      const probeSpan = step.probes * PROBE
      const inProbes = step.probes > 0 && beats >= ENTER && beats < ENTER + probeSpan
      const probeIdx = step.probes > 0 ? clamp(Math.floor((beats - ENTER) / PROBE), 0, step.probes - 1) : 0
      const probeP = step.probes > 0 ? clamp((beats - ENTER - probeIdx * PROBE) / PROBE) : 0
      const verd = step.prime ? VERD_PRIME : VERD_COMP
      const inVerdict = beats >= ENTER + probeSpan
      const verdictP = clamp((beats - ENTER - probeSpan) / verd)

      /** Divisor under test, and how far its fold has closed. */
      let d = 0
      let fold = 0
      if (step.probes > 0) {
        const last = probeIdx === step.probes - 1
        if (inProbes) {
          d = 2 + probeIdx
          if (probeP < FOLD_IN) fold = easeInOutCubic(probeP / FOLD_IN)
          else if (probeP < HOLD_OUT || last) fold = 1
          else fold = 1 - easeInOutCubic((probeP - HOLD_OUT) / (1 - HOLD_OUT))
        } else if (inVerdict) {
          d = step.probes + 1
          fold = 1
        }
      }
      /** How settled the current fold's verdict is — drives every accent mark. */
      const held = inVerdict ? 1 : clamp((probeP - FOLD_IN) / 0.16) * (1 - clamp((probeP - HOLD_OUT) / 0.12))
      const rows = d >= 2 ? Math.ceil(n / d) : 1
      const holes = d >= 2 ? d * rows - n : 0
      const activeProbe = inVerdict ? step.probes - 1 : inProbes ? probeIdx : -1

      /* ---- frame --------------------------------------------------------- */

      ctx.clearRect(0, 0, w, h)
      ctx.lineJoin = 'round'
      ctx.lineCap = 'butt'
      ctx.setLineDash(NODASH)

      const nFloat = n - 1 + easeInOutCubic(enterP)

      /* ---- integer ribbon ------------------------------------------------ */

      ctx.lineWidth = 0.75
      ctx.strokeStyle = inkFaint
      ctx.globalAlpha = 0.4
      ctx.beginPath()
      ctx.moveTo(layout.padX, layout.ribY)
      ctx.lineTo(w - layout.padX, layout.ribY)
      ctx.stroke()

      ctx.font = layout.fontMicro
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      for (let m = 0; m <= N_MAX + 5; m += 1) {
        const x = layout.curX + (m - nFloat) * layout.tick
        if (x < layout.padX - 6 || x > w - layout.padX + 6) continue
        const edge = 1 - range(Math.abs(x - layout.curX), (w * 0.5 - layout.padX) * 0.55, w * 0.5 - layout.padX)
        if (edge <= 0.02) continue
        const done = m < n
        const cur = m === n
        const next = m === n + 1 && hoverRef.current

        ctx.globalAlpha = edge * (cur ? 1 : done ? 0.75 : 0.4)
        ctx.strokeStyle = cur ? accent : done && IS_PRIME[m] ? inkSoft : inkFaint
        ctx.lineWidth = cur ? 1.2 : 0.75
        ctx.beginPath()
        ctx.moveTo(x, layout.ribY - (cur ? 6 : next ? 4.5 : 3))
        ctx.lineTo(x, layout.ribY + (cur ? 5 : 3))
        ctx.stroke()

        if (done && IS_PRIME[m]) {
          ctx.globalAlpha = edge * 0.8
          ctx.fillStyle = inkSoft
          dot(ctx, x, layout.ribY - 8, 1.5)
        }
        if (!layout.detail || cur) continue

        ctx.globalAlpha = edge * (done ? (IS_PRIME[m] ? 0.85 : 0.4) : 0.34)
        ctx.fillStyle = done && IS_PRIME[m] ? inkSoft : inkFaint
        ctx.fillText(NUMS[m], x, layout.ribY + layout.ribDy - layout.ribFont * 0.5)
        if (done && !IS_PRIME[m]) {
          // Struck: tested, folded, discarded.
          ctx.strokeStyle = inkFaint
          ctx.lineWidth = 0.75
          ctx.beginPath()
          ctx.moveTo(x - layout.ribFont * 0.42, layout.ribY + layout.ribDy)
          ctx.lineTo(x + layout.ribFont * 0.42, layout.ribY + layout.ribDy)
          ctx.stroke()
        }
      }

      /* ---- the numeral being tested -------------------------------------- */

      const eN = easeOutCubic(enterP)
      let nx = lerp(layout.curX, layout.numX, eN)
      let ny = lerp(layout.ribY + layout.ribDy, layout.fy, eN)
      let nsz = lerp(layout.ribFont, layout.bigSize, eN)
      let nAlpha = 1
      let nCol = inkSoft
      let fly = 0
      let die = 0

      if (inVerdict) {
        if (step.prime) {
          fly = easeInOutCubic(clamp((verdictP - 0.3) / 0.64))
          const tx = layout.pX0 + (step.before + 0.5) * layout.pStep
          const ty = layout.primeY - layout.pDy
          nx = lerp(nx, tx, fly)
          ny = lerp(ny, ty, fly) - Math.sin(fly * Math.PI) * layout.fieldH * 0.14
          nsz = lerp(nsz, layout.pFont, fly)
          nCol = accent
        } else {
          die = easeInOutCubic(verdictP)
          ny += die * layout.fieldH * 0.24
          nAlpha = 1 - die * 0.7
          nCol = die > 0.3 ? inkFaint : inkSoft
        }
      }

      /* ---- leader: the value is picked out of the line -------------------- */

      if (enterP < 1) {
        ctx.globalAlpha = Math.sin(enterP * Math.PI) * 0.4
        ctx.strokeStyle = accent
        ctx.lineWidth = 0.75
        ctx.setLineDash(DASH)
        ctx.beginPath()
        ctx.moveTo(layout.curX, layout.ribY + 7)
        ctx.lineTo(nx, ny - nsz * 0.62)
        ctx.stroke()
        ctx.setLineDash(NODASH)
      }

      /* ---- the fold field ------------------------------------------------ */

      const sLine = Math.min(layout.fieldW / (n + 1), layout.smax)
      const sGrid =
        d >= 2
          ? Math.min(layout.fieldW / (d + 1.4), layout.fieldH / (rows + 0.6), layout.smax * 1.35)
          : sLine
      const stag = d >= 2 ? Math.min(0.06, 0.45 / Math.max(1, rows - 1)) : 0
      const span = stag * Math.max(0, rows - 1)

      // The rectangle the fold is trying to fill.
      if (d >= 2 && fold > 0.02) {
        const hw = d * sGrid * 0.5
        const hh = rows * sGrid * 0.5
        ctx.globalAlpha = fold * (1 - die * 0.6) * 0.5
        ctx.strokeStyle = inkFaint
        ctx.lineWidth = 0.75
        ctx.setLineDash(DASH)
        ctx.strokeRect(layout.fx - hw, layout.fy - hh, hw * 2, hh * 2)
        ctx.setLineDash(NODASH)

        if (holes === 0 && held > 0) {
          // A clean fold. This is what kills the number.
          ctx.globalAlpha = held * (1 - die * 0.5)
          ctx.strokeStyle = accent
          ctx.lineWidth = 1.25
          ctx.strokeRect(layout.fx - hw, layout.fy - hh, hw * 2, hh * 2)
        }
      }

      // Unit cells: n of them, folded from a strip into rows of d.
      const flare = step.prime && inVerdict ? Math.sin(clamp(verdictP / 0.5) * Math.PI) : 0
      const slotX = layout.pX0 + (step.before + 0.5) * layout.pStep
      const slotY = layout.primeY - layout.pDy
      const eStag = Math.min(0.035, 0.5 / Math.max(1, n - 1))
      const eSpan = eStag * (n - 1)

      for (let i = 0; i < n; i += 1) {
        const lx = layout.fx + (i - (n - 1) * 0.5) * sLine
        let px = lx
        let py = layout.fy
        let ps = sLine
        let ragged = false

        if (d >= 2 && fold > 0) {
          const col = i % d
          const row = (i - col) / d
          const fi = easeInOutCubic(clamp(fold * (1 + span) - row * stag))
          px = lerp(lx, layout.fx + (col - (d - 1) * 0.5) * sGrid, fi)
          py = lerp(layout.fy, layout.fy + (row - (rows - 1) * 0.5) * sGrid, fi)
          ps = lerp(sLine, sGrid, fi)
          ragged = holes > 0 && row === rows - 1
        }

        const ei = easeOutCubic(clamp(enterP * (1 + eSpan) - i * eStag))
        px = lerp(nx, px, ei)
        py = lerp(ny, py, ei)
        ps *= 0.22 + 0.78 * ei
        let alpha = ei

        if (inVerdict) {
          if (step.prime) {
            px = lerp(px, slotX, fly)
            py = lerp(py, slotY, fly)
            ps *= 1 - fly * 0.85
            alpha *= 1 - clamp((fly - 0.7) / 0.3)
          } else {
            py += die * layout.fieldH * 0.24
            ps *= 1 - die * 0.35
            alpha *= 1 - die * 0.8
          }
        }

        const pulse = flare * (0.5 + 0.5 * Math.sin((JITTER[i] + flare * 0.8) * Math.PI * 2))
        const hot = ragged && held > 0.05 && !step.prime === false ? true : ragged && held > 0.05
        ctx.globalAlpha = alpha * (hot ? 1 : 0.9)
        ctx.fillStyle = hot ? accent : flare > 0.05 ? accent : inkSoft
        if (!hot && flare <= 0.05) ctx.globalAlpha = alpha * 0.92
        dot(ctx, px, py, clamp(ps * 0.17, 1.4, 4.2) * (1 + pulse * 0.55))
      }

      // Holes: the slots the number could not fill. No holes ⇒ divisible.
      if (d >= 2 && holes > 0 && fold > 0.5 && held > 0) {
        ctx.globalAlpha = held * fold * 0.55 * (1 - fly)
        ctx.strokeStyle = inkFaint
        ctx.lineWidth = 0.75
        ctx.setLineDash(DASH)
        for (let j = n; j < d * rows; j += 1) {
          const col = j % d
          const row = (j - col) / d
          ctx.beginPath()
          ctx.arc(
            layout.fx + (col - (d - 1) * 0.5) * sGrid,
            layout.fy + (row - (rows - 1) * 0.5) * sGrid,
            clamp(sGrid * 0.17, 1.4, 4.2),
            0,
            Math.PI * 2,
          )
          ctx.stroke()
        }
        ctx.setLineDash(NODASH)
      }

      // The arithmetic, once, tiny: d × q ( + r ).
      if (layout.detail && d >= 2 && held > 0.08) {
        const q = Math.floor(n / d)
        const r = n % d
        const hh = rows * sGrid * 0.5
        ctx.globalAlpha = held * (1 - fly) * (1 - die * 0.5) * 0.95
        ctx.fillStyle = r === 0 ? accent : inkSoft
        ctx.font = layout.fontNano
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillText(
          r === 0 ? `${NUMS[d]}×${NUMS[q]}` : `${NUMS[d]}×${NUMS[q]}+${NUMS[r]}`,
          layout.fx,
          layout.fy + hh + 7,
        )
      }

      /* ---- divisor probes, fanned ---------------------------------------- */

      if (step.candidates > 0 && enterP > 0.25) {
        const K = step.candidates
        const spread = Math.min(0.52, 0.2 * K)
        ctx.font = layout.fontNano
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        for (let k = 0; k < K; k += 1) {
          const a = K === 1 ? 0 : lerp(-spread, spread, k / (K - 1))
          const active = k === activeProbe
          const failed = k < activeProbe || (step.prime && inVerdict && k <= activeProbe)
          const len = layout.spokeLen * (active ? 0.9 + 0.28 * fold : failed ? 0.52 : 0.7)
          const ex = layout.spokeX + Math.cos(a) * len
          const ey = layout.fy + Math.sin(a) * len
          const on = active && !failed

          ctx.globalAlpha = clamp((enterP - 0.25) / 0.4) * (on ? 0.95 : failed ? 0.4 : 0.28) * (1 - fly * 0.8)
          ctx.strokeStyle = on ? accent : inkFaint
          ctx.lineWidth = on ? 1.1 : 0.75
          ctx.beginPath()
          ctx.moveTo(layout.spokeX + Math.cos(a) * 5, layout.fy + Math.sin(a) * 5)
          ctx.lineTo(ex, ey)
          ctx.stroke()

          if (!layout.detail) continue
          const lx = ex + Math.cos(a) * 6
          const ly = ey + Math.sin(a) * 6
          ctx.fillStyle = on ? accent : inkFaint
          ctx.fillText(NUMS[k + 2], lx, ly)
          if (failed) {
            ctx.beginPath()
            ctx.moveTo(lx - 4, ly)
            ctx.lineTo(lx + 4, ly)
            ctx.stroke()
          }
        }
      }

      /* ---- the numeral, and its strike ----------------------------------- */

      numeral(ctx, NUMS[n], nx, ny, nsz, nCol, nAlpha)

      if (!step.prime && inVerdict) {
        const tw = NUMS[n].length * nsz * 0.62
        const sweep = easeOutCubic(clamp(verdictP / 0.3))
        ctx.globalAlpha = (1 - die * 0.55) * 0.9
        ctx.strokeStyle = accent
        ctx.lineWidth = 1.25
        ctx.beginPath()
        ctx.moveTo(nx - tw * 0.5, ny)
        ctx.lineTo(nx - tw * 0.5 + tw * sweep, ny)
        ctx.stroke()
      }

      /* ---- prime ribbon --------------------------------------------------- */

      const filled = step.before + (step.prime ? fly : 0)
      ctx.globalAlpha = 0.4
      ctx.strokeStyle = inkFaint
      ctx.lineWidth = 0.75
      ctx.beginPath()
      ctx.moveTo(layout.pX0, layout.primeY)
      ctx.lineTo(layout.pX0 + Math.max(0.6, filled + 0.5) * layout.pStep, layout.primeY)
      ctx.stroke()

      ctx.font = layout.fontMicro
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let r = 0; r < step.before; r += 1) {
        const x = layout.pX0 + (r + 0.5) * layout.pStep
        ctx.globalAlpha = 0.55
        ctx.strokeStyle = inkFaint
        ctx.lineWidth = 0.75
        ctx.beginPath()
        ctx.moveTo(x, layout.primeY - 3)
        ctx.lineTo(x, layout.primeY + 3)
        ctx.stroke()

        const fresh = prev !== null && prev.prime && r === step.before - 1 ? 1 - enterP : 0
        ctx.globalAlpha = 0.95 * (1 - fresh)
        ctx.fillStyle = ink
        ctx.fillText(NUMS[SCHED.primes[r]], x, layout.primeY - layout.pDy)
        if (fresh > 0) {
          ctx.globalAlpha = 0.95 * fresh
          ctx.fillStyle = accent
          ctx.fillText(NUMS[SCHED.primes[r]], x, layout.primeY - layout.pDy)
        }
      }

      if (layout.detail) {
        ctx.globalAlpha = 0.45
        ctx.fillStyle = inkFaint
        ctx.font = layout.fontNano
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText('PRIMES', layout.pX0, layout.primeY + 6)
      }

      /* ---- hover affordance: the next integer leans in -------------------- */

      if (chrome && hoverRef.current && !reducedMotion) {
        const x = layout.curX + (n + 1 - nFloat) * layout.tick
        if (x > layout.padX && x < w - layout.padX) {
          ctx.globalAlpha = 0.5
          ctx.fillStyle = accent
          dot(ctx, x, layout.ribY - 8, 1.4)
        }
      }

      // Knock the background out from under the tiny LOC mark so it stays legible
      // over the ribbon on very short canvases.
      if (layout.detail && !chrome) {
        ctx.globalAlpha = 0.85
        ctx.fillStyle = bg
        ctx.fillRect(w - layout.padX - 40, layout.ribY - 18, 40, 12)
        ctx.globalAlpha = 0.5
        ctx.fillStyle = inkFaint
        ctx.font = layout.fontNano
        ctx.textAlign = 'right'
        ctx.textBaseline = 'top'
        ctx.fillText(`${loc} LOC`, w - layout.padX, layout.ribY - 17)
      }

      ctx.globalAlpha = 1

      /* ---- readout -------------------------------------------------------- */

      if (nRef.current !== n) {
        nRef.current = n
        setShownN(n)
      }
      const pc = step.before + (step.prime && verdictP > 0.9 ? 1 : 0)
      if (pRef.current !== pc) {
        pRef.current = pc
        setShownP(pc)
      }

      firstRef.current = false
      dirtyRef.current = false
    },
  })

  /* ---- interaction: click advances, right-click steps back ---------------- */

  const stepBy = useMemo(
    () => (dir: number) => {
      manualRef.current = true
      const next = (idxRef.current + dir + SCHED.steps.length) % SCHED.steps.length
      idxRef.current = next
      dirtyRef.current = true
    },
    [],
  )

  useEffect(() => {
    if (!chrome) return
    const canvas = ref.current
    if (!canvas) return

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      stepBy(1)
    }
    const onMenu = (e: MouseEvent) => {
      e.preventDefault()
      stepBy(-1)
    }
    const onEnter = () => {
      hoverRef.current = true
      dirtyRef.current = true
    }
    const onLeave = () => {
      hoverRef.current = false
      dirtyRef.current = true
    }

    canvas.style.cursor = 'pointer'
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('contextmenu', onMenu)
    canvas.addEventListener('pointerenter', onEnter)
    canvas.addEventListener('pointerleave', onLeave)

    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('contextmenu', onMenu)
      canvas.removeEventListener('pointerenter', onEnter)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.style.cursor = 'default'
    }
  }, [ref, chrome, stepBy])

  return (
    <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
      <canvas ref={ref} className={styles.canvas} />
      {chrome && (
        <div className={styles.readout} aria-hidden="true">
          N {shownN} · {shownP} PRIME{shownP === 1 ? '' : 'S'}
        </div>
      )}
      {chrome && (
        <div className={styles.hud}>
          <button
            type="button"
            className={styles.chip}
            style={{ cursor: 'pointer' }}
            onClick={() => stepBy(-1)}
            aria-label="Previous integer"
          >
            ← BACK
          </button>
          <button
            type="button"
            className={styles.chip}
            style={{ cursor: 'pointer' }}
            onClick={() => stepBy(1)}
            aria-label="Next integer"
          >
            NEXT →
          </button>
          <span className={styles.chip}>{loc} LOC</span>
          <span className={styles.chip}>NO DEPS</span>
        </div>
      )}
    </div>
  )
}
