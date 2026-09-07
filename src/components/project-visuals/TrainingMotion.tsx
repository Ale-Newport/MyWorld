'use client'

/**
 * TrainingMotion — the motion graphic for the "ML Revision Engine".
 *
 * The syllabus drawn as a constellation. Fourteen topic circles sit on a ring,
 * each sized by how many of the 188 questions belong to it; the quiz engine at
 * the centre carries the eight modes on a dial. The engine fires one token per
 * question: it arcs out to a topic, lands, and the verdict fires there. A
 * correct answer arcs back green and is absorbed into the session ring. A miss
 * falls inward instead and joins the weak-spot ring — a slow accent orbit that
 * is the one thing in the frame worth looking at twice. Trap questions (25 of
 * the 188) fly as hollow diamonds and fail far more often, so the weak ring
 * fills with them. Every twenty-five answers the engine pulses: progress
 * written to local storage.
 *
 * Timeline (clock 0..1 is one full 188-question session):
 *   0.00  cold syllabus — fourteen circles sized by question count, dial on mode 1
 *   0.33  three modes deep; topic arcs a third closed; the weak ring holds its first arc
 *   0.66  most topics past half; traps have clustered into the orbit
 *   1.00  188/188 answered — every topic ring closed, the misses left orbiting
 *
 * Reduced motion holds the session at 78%: arcs mostly closed, the weak ring
 * populated, one token outbound, one returning green, one dropping to the orbit.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useCanvas2D } from '@/hooks/useCanvas2D'
import { clamp, damp, easeInOutCubic, easeOutCubic, lerp, range, seeded } from '@/lib/math'
import type { Project } from '@/content/types'
import { readPalette, type ProjectVisualProps, type VisualPalette } from './types'
import styles from './visual.module.css'

/* ---------------------------------------------------------------- constants */

/** Verified: 188 questions, 14 topics, 25 traps, 8 quiz modes, 83 flashcards. */
const Q_TOTAL = 188
const TOPIC_N = 14
const TRAP_N = 25
const MODE_N = 8
const CARD_N = 83

/** Launches stop here so the last verdicts land inside the clock. */
const LAUNCH_END = 0.9
/** One question's whole flight, in clock units. */
const FLIGHT = 0.058
/** Where inside a flight the token reaches the topic and the verdict fires. */
const MARK = 0.46
/** How long the verdict flash lives after that, in flight units. */
const FLASH = 0.16
/** Answers between local-storage writes. */
const SAVE_EVERY = 25
/** The frame reduced motion holds. */
const HOLD = 0.78

/** Miss rates. Traps are the questions the engine flags as hard. */
const MISS_TRAP = 0.52
const MISS_PLAIN = 0.11

/** Golden angle — keeps the weak ring evenly spread at every size it passes through. */
const GOLD = Math.PI * (3 - Math.sqrt(5))

const DASH: number[] = [1.5, 2.5]
const NODASH: number[] = []

/* ------------------------------------------------------------- the schedule */

interface Shot {
  topic: number
  trap: boolean
  hit: boolean
  /** Launch time on the master clock. */
  t0: number
  /** Lateral bow of the outbound arc, in units of the flight length. */
  bow: number
  /** Slot in the weak ring, or -1 for a hit. */
  weak: number
  /** Radius wobble so the orbit reads as a shell, not a compass circle. */
  wobble: number
}

interface Schedule {
  shots: Shot[]
  perTopic: number[]
  trapPerTopic: number[]
  weakTotal: number
  maxQ: number
  /** Verdict times, ascending — used to date the local-storage pulses. */
  lands: Float32Array
}

/** Spread `total` over `n` buckets by deterministic weight, exactly. */
function spread(total: number, n: number, floor: number, rnd: () => number, cap?: number[]): number[] {
  const w: number[] = []
  let sum = 0
  for (let i = 0; i < n; i += 1) {
    const v = 0.55 + rnd()
    w.push(v)
    sum += v
  }
  const out: number[] = []
  let acc = 0
  for (let i = 0; i < n; i += 1) {
    const lid = cap ? cap[i] : total
    const v = clamp(Math.round((w[i] / sum) * total), floor, lid)
    out.push(v)
    acc += v
  }
  // Walk the buckets until the sum is exact.
  let debt = total - acc
  for (let g = 0; debt !== 0 && g < n * 80; g += 1) {
    const i = g % n
    const lid = cap ? cap[i] : total
    if (debt > 0 && out[i] < lid) {
      out[i] += 1
      debt -= 1
    } else if (debt < 0 && out[i] > floor) {
      out[i] -= 1
      debt += 1
    }
  }
  return out
}

function buildSchedule(qTotal: number, topicN: number, trapN: number): Schedule {
  const rnd = seeded(0x5ac0de)

  const perTopic = spread(qTotal, topicN, 4, rnd)
  const trapCap = perTopic.map((q) => Math.max(0, Math.floor(q * 0.45)))
  const trapPerTopic = spread(Math.min(trapN, qTotal), topicN, 0, rnd, trapCap)

  const shots: Shot[] = []
  for (let i = 0; i < topicN; i += 1) {
    for (let j = 0; j < perTopic[i]; j += 1) {
      shots.push({
        topic: i,
        trap: j < trapPerTopic[i],
        hit: true,
        t0: 0,
        bow: 0,
        weak: -1,
        wobble: 1,
      })
    }
  }

  // Deterministic shuffle so the engine walks the syllabus, not one topic at a time.
  for (let i = shots.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1))
    const tmp = shots[i]
    shots[i] = shots[j]
    shots[j] = tmp
  }

  const n = shots.length
  let weakTotal = 0
  for (let i = 0; i < n; i += 1) {
    const s = shots[i]
    const slot = (i + (rnd() - 0.5) * 0.55) / Math.max(1, n)
    s.t0 = clamp(slot) * LAUNCH_END
    s.bow = (rnd() < 0.5 ? -1 : 1) * (0.16 + rnd() * 0.14)
    s.hit = rnd() > (s.trap ? MISS_TRAP : MISS_PLAIN)
    s.wobble = 0.9 + rnd() * 0.2
    if (!s.hit) {
      s.weak = weakTotal
      weakTotal += 1
    }
  }

  const lands = new Float32Array(n)
  for (let i = 0; i < n; i += 1) lands[i] = shots[i].t0 + FLIGHT * MARK
  lands.sort()

  let maxQ = 1
  for (let i = 0; i < topicN; i += 1) maxQ = Math.max(maxQ, perTopic[i])

  return { shots, perTopic, trapPerTopic, weakTotal, maxQ, lands }
}

/* ------------------------------------------------------------------ layout */

interface Layout {
  w: number
  h: number
  chrome: boolean
  detail: boolean
  cx: number
  cy: number
  /** Topic ring radius. */
  R: number
  nodeX: Float32Array
  nodeY: Float32Array
  nodeR: Float32Array
  nodeA: Float32Array
  /** Engine dial radius, and the session ring just outside it. */
  eng: number
  prog: number
  weakR: number
  labelR: number
  micro: number
  nano: number
  fontMicro: string
  fontNano: string
}

function computeLayout(w: number, h: number, chrome: boolean, sched: Schedule): Layout {
  const n = sched.perTopic.length
  const detail = w >= 300 && h >= 230
  const padX = clamp(w * 0.06, 10, 40)
  const padTop = clamp(h * 0.08, 10, 26)
  const padBot = padTop + (chrome ? 26 : 0)
  const minDim = Math.min(w, h)

  const cx = w * 0.5
  const cy = padTop + (h - padTop - padBot) * 0.5
  const maxNodeR = clamp(minDim * 0.05, 4, 15)
  const labelPad = maxNodeR + (detail ? 15 : 5)
  const halfY = Math.min(cy - padTop, h - padBot - cy)
  const R = clamp(
    Math.min(w * 0.5 - padX - labelPad, halfY - labelPad, minDim * 0.4),
    22,
    200,
  )

  const nodeX = new Float32Array(n)
  const nodeY = new Float32Array(n)
  const nodeR = new Float32Array(n)
  const nodeA = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2
    nodeA[i] = a
    nodeX[i] = cx + Math.cos(a) * R
    nodeY[i] = cy + Math.sin(a) * R
    // Area, not radius, carries the count — so the circles read honestly.
    nodeR[i] = maxNodeR * (0.42 + 0.58 * Math.sqrt(sched.perTopic[i] / sched.maxQ))
  }

  const eng = clamp(R * 0.18, 8, 26)
  const prog = eng + clamp(R * 0.06, 3.5, 8)
  const wLo = prog + 9
  const wHi = Math.max(wLo + 1, R - maxNodeR - 6)

  const micro = clamp(Math.round(minDim * 0.032), 8, 11)
  const nano = Math.max(7, micro - 2)

  return {
    w,
    h,
    chrome,
    detail,
    cx,
    cy,
    R,
    nodeX,
    nodeY,
    nodeR,
    nodeA,
    eng,
    prog,
    weakR: clamp(R * 0.56, wLo, wHi),
    labelR: R + maxNodeR + 10,
    micro,
    nano,
    fontMicro: `${micro}px ui-monospace, monospace`,
    fontNano: `${nano}px ui-monospace, monospace`,
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

/** Scratch point for the bezier sampler — module scope so the loop allocates nothing. */
const PT = { x: 0, y: 0 }

function quad(
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  t: number,
): void {
  const u = 1 - t
  PT.x = u * u * p0x + 2 * u * t * p1x + t * t * p2x
  PT.y = u * u * p0y + 2 * u * t * p1y + t * t * p2y
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

/** A trap question: hollow diamond, so misses are traceable to their kind. */
function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath()
  ctx.moveTo(x, y - s)
  ctx.lineTo(x + s, y)
  ctx.lineTo(x, y + s)
  ctx.lineTo(x - s, y)
  ctx.closePath()
  ctx.stroke()
}

function arcStroke(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  a0: number,
  sweep: number,
  colour: string,
  alpha: number,
  lw: number,
): void {
  if (sweep <= 0.004 || alpha <= 0.004) return
  ctx.globalAlpha = alpha
  ctx.strokeStyle = colour
  ctx.lineWidth = lw
  ctx.beginPath()
  ctx.arc(x, y, r, a0, a0 + Math.min(sweep, Math.PI * 2 - 1e-4))
  ctx.stroke()
}

/* ----------------------------------------------------------- the component */

export function TrainingMotion(props: ProjectVisualProps) {
  const { project, progress, reducedMotion = false, interactive = true, className } = props
  const chrome = interactive !== false

  const questions = Math.round(clamp(metricValue(project, 'Questions', Q_TOTAL), 20, 400))
  const topicN = Math.round(clamp(metricValue(project, 'Topics', TOPIC_N), 3, 24))
  const modes = Math.round(clamp(metricValue(project, 'Quiz modes', MODE_N), 2, 16))
  const cards = Math.round(metricValue(project, 'Flashcards', CARD_N))

  const sched = useMemo(() => buildSchedule(questions, topicN, TRAP_N), [questions, topicN])
  /** Per-topic tallies, refilled (never reallocated) each frame. */
  const tally = useMemo(
    () => ({ seen: new Int16Array(topicN), bad: new Int16Array(topicN) }),
    [topicN],
  )

  /** Node captions, pre-stringified so the draw loop allocates nothing. */
  const labels = useMemo(() => {
    const short: string[] = []
    const full: string[] = []
    for (let i = 0; i < topicN; i += 1) {
      const tag = `T${i < 9 ? '0' : ''}${i + 1}`
      short.push(tag)
      full.push(`${tag} ${sched.perTopic[i]}Q`)
    }
    return { short, full }
  }, [topicN, sched])

  /** One session should take about as long as the designed motion. */
  const period = useMemo(
    () => clamp(project?.presentation.duration ?? 16, 8, 30),
    [project],
  )

  const [hover, setHover] = useState(-1)

  const layoutRef = useRef<Layout | null>(null)
  const paletteRef = useRef<VisualPalette | null>(null)
  const paletteAtRef = useRef(-1)
  const clockRef = useRef(0)
  const hoverRef = useRef(-1)
  const firstRef = useRef(true)
  const dirtyRef = useRef(true)

  const ref = useCanvas2D<HTMLCanvasElement>({
    setup: ({ ctx, w, h }) => {
      layoutRef.current = computeLayout(w, h, chrome, sched)
      paletteRef.current = readPalette(ctx.canvas)
      paletteAtRef.current = -1
      firstRef.current = true
      dirtyRef.current = true
    },

    draw: ({ ctx, w, h, t, dt }) => {
      let layout = layoutRef.current
      if (
        !layout ||
        layout.w !== w ||
        layout.h !== h ||
        layout.chrome !== chrome ||
        layout.nodeX.length !== topicN
      ) {
        layout = computeLayout(w, h, chrome, sched)
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

      const selfRun = typeof progress !== 'number'
      let clock: number
      if (reducedMotion) {
        clock = HOLD
      } else if (typeof progress === 'number') {
        // Scroll-linked: chase the scrubbed value instead of snapping to it.
        const target = clamp(progress) * 0.99999
        clock = firstRef.current ? target : damp(clockRef.current, target, 14, dt)
      } else {
        clock = (clockRef.current + dt / period) % 1
      }
      clockRef.current = clock

      if (reducedMotion && !dirtyRef.current) return

      /* ---- where the session stands -------------------------------------- */

      const { shots, perTopic, weakTotal, lands } = sched
      const { seen, bad } = tally
      seen.fill(0)
      bad.fill(0)

      let answered = 0
      let correct = 0
      let missed = 0
      for (let i = 0; i < shots.length; i += 1) {
        const s = shots[i]
        const local = (clock - s.t0) / FLIGHT
        if (local < MARK) continue
        seen[s.topic] += 1
        answered += 1
        if (s.hit) correct += 1
        else {
          missed += 1
          bad[s.topic] += 1
        }
      }

      // A self-running loop clears the session at the wrap instead of cutting.
      const clearK = selfRun && !reducedMotion ? 1 - range(clock, 0.955, 0.995) : 1
      const rot = clock * Math.PI * 2 * 0.3
      const hoverI = hoverRef.current

      const cx = layout.cx
      const cy = layout.cy

      /* ---- frame --------------------------------------------------------- */

      ctx.clearRect(0, 0, w, h)
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.setLineDash(NODASH)

      /* ---- the syllabus ring --------------------------------------------- */

      ctx.globalAlpha = 0.14
      ctx.strokeStyle = inkFaint
      ctx.lineWidth = 0.75
      ring(ctx, cx, cy, layout.R)

      for (let i = 0; i < topicN; i += 1) {
        const a = layout.nodeA[i]
        const nr = layout.nodeR[i]
        const on = i === hoverI
        ctx.globalAlpha = on ? 0.4 : 0.11
        ctx.strokeStyle = on ? accent : inkFaint
        ctx.lineWidth = 0.75
        ctx.beginPath()
        ctx.moveTo(cx + Math.cos(a) * (layout.prog + 3), cy + Math.sin(a) * (layout.prog + 3))
        ctx.lineTo(cx + Math.cos(a) * (layout.R - nr - 3), cy + Math.sin(a) * (layout.R - nr - 3))
        ctx.stroke()
      }

      /* ---- topic circles, each sized by its question count ---------------- */

      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let i = 0; i < topicN; i += 1) {
        const x = layout.nodeX[i]
        const y = layout.nodeY[i]
        const nr = layout.nodeR[i]
        const a = layout.nodeA[i]
        const on = i === hoverI
        const q = Math.max(1, perTopic[i])
        const done = seen[i] * clearK
        const wrong = bad[i] * clearK

        ctx.globalAlpha = on ? 0.9 : 0.4
        ctx.strokeStyle = on ? accent : inkFaint
        ctx.lineWidth = on ? 1 : 0.75
        ring(ctx, x, y, nr)

        if (done > 0.01) {
          const good = Math.max(0, done - wrong)
          const rr = nr + 3.2
          ctx.globalAlpha = 0.16
          ctx.strokeStyle = inkFaint
          ctx.lineWidth = 0.75
          ring(ctx, x, y, rr)
          const gs = (good / q) * Math.PI * 2
          const ws = (wrong / q) * Math.PI * 2
          arcStroke(ctx, x, y, rr, a, gs, inkSoft, 0.62, 1.2)
          arcStroke(ctx, x, y, rr, a + gs, ws, accent, 0.9, 1.4)
        }

        // The interior fills as the topic is covered — mass, read at a glance.
        if (done > 0.01) {
          ctx.globalAlpha = 0.1 + 0.16 * (done / q)
          ctx.fillStyle = on ? accent : inkSoft
          dot(ctx, x, y, nr * clamp(0.28 + 0.62 * (done / q), 0.2, 0.9))
        }

        if (!layout.detail) continue
        const lx = cx + Math.cos(a) * layout.labelR
        const ly = cy + Math.sin(a) * layout.labelR
        ctx.font = layout.fontNano
        ctx.globalAlpha = on ? 0.95 : 0.26
        ctx.fillStyle = on ? accent : inkFaint
        ctx.fillText(on ? labels.full[i] : labels.short[i], lx, ly)
      }

      /* ---- the weak-spot ring, settled ------------------------------------ */

      if (weakTotal > 0 && missed > 0 && clearK > 0.01) {
        ctx.globalAlpha = 0.12 * clearK
        ctx.strokeStyle = accent
        ctx.lineWidth = 0.75
        ctx.setLineDash(DASH)
        ring(ctx, cx, cy, layout.weakR)
        ctx.setLineDash(NODASH)
      }

      for (let i = 0; i < shots.length; i += 1) {
        const s = shots[i]
        if (s.hit) continue
        const local = (clock - s.t0) / FLIGHT
        if (local < 1) continue
        const ang = GOLD * s.weak + rot
        const rr = layout.weakR * s.wobble
        const x = cx + Math.cos(ang) * rr
        const y = cy + Math.sin(ang) * rr
        ctx.globalAlpha = 0.78 * clearK
        if (s.trap) {
          ctx.strokeStyle = accent
          ctx.lineWidth = 0.75
          diamond(ctx, x, y, 2.6)
        } else {
          ctx.fillStyle = accent
          dot(ctx, x, y, 1.5)
        }
      }

      /* ---- the engine: eight modes on a dial ------------------------------ */

      // The dial walks the eight modes across the session; the hand only moves
      // in the last fifth of each window, so it snaps between modes and rests.
      const modeF = clamp(clock / LAUNCH_END) * modes
      const mi = Math.min(modes - 1, Math.floor(modeF))
      const frac = clamp(modeF - mi)
      const adv = mi >= modes - 1 ? 0 : easeInOutCubic(clamp((frac - 0.8) / 0.2))
      const handA = -Math.PI / 2 + ((mi + adv) / modes) * Math.PI * 2

      for (let k = 0; k < modes; k += 1) {
        const a = -Math.PI / 2 + (k / modes) * Math.PI * 2
        const live = k === mi
        const past = k < mi
        ctx.globalAlpha = live ? 0.95 : past ? 0.45 : 0.24
        ctx.strokeStyle = live ? accent : past ? inkSoft : inkFaint
        ctx.lineWidth = live ? 1.2 : 0.75
        const r0 = layout.eng - 2.5
        const r1 = layout.eng + (live ? 4 : 1.5)
        ctx.beginPath()
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
        ctx.stroke()
      }

      ctx.globalAlpha = 0.75
      ctx.strokeStyle = accent
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(cx + Math.cos(handA) * 2.5, cy + Math.sin(handA) * 2.5)
      ctx.lineTo(cx + Math.cos(handA) * (layout.eng - 3), cy + Math.sin(handA) * (layout.eng - 3))
      ctx.stroke()

      ctx.globalAlpha = 0.85
      ctx.fillStyle = ink
      dot(ctx, cx, cy, 1.7)

      // Session ring: green for what came back right, accent for what did not.
      ctx.globalAlpha = 0.18
      ctx.strokeStyle = inkFaint
      ctx.lineWidth = 0.75
      ring(ctx, cx, cy, layout.prog)
      const top = -Math.PI / 2
      const cs = ((correct * clearK) / questions) * Math.PI * 2
      const ms = ((missed * clearK) / questions) * Math.PI * 2
      arcStroke(ctx, cx, cy, layout.prog, top, cs, signal, 0.8, 1.5)
      arcStroke(ctx, cx, cy, layout.prog, top + cs, ms, accent, 0.9, 1.5)

      /* ---- persistence: a pulse each time progress is written ------------- */

      const saved = Math.floor((answered * clearK) / SAVE_EVERY) * SAVE_EVERY
      if (saved > 0 && saved <= lands.length) {
        const age = (clock - lands[saved - 1]) / FLIGHT
        if (age >= 0 && age < 1.6) {
          const k = age / 1.6
          ctx.globalAlpha = (1 - k) * 0.35
          ctx.strokeStyle = signal
          ctx.lineWidth = 0.75
          ring(ctx, cx, cy, layout.prog + 3 + easeOutCubic(k) * 12)
          if (layout.detail) {
            ctx.globalAlpha = (1 - k) * 0.5
            ctx.fillStyle = inkFaint
            ctx.font = layout.fontNano
            ctx.fillText('SAVED', cx, cy - layout.prog - layout.nano - 6)
          }
        }
      }

      /* ---- tokens in flight ----------------------------------------------- */

      for (let i = 0; i < shots.length; i += 1) {
        const s = shots[i]
        const local = (clock - s.t0) / FLIGHT
        if (local <= 0 || local >= 1) continue

        const a = layout.nodeA[s.topic]
        const nr = layout.nodeR[s.topic]
        const sx = cx + Math.cos(a) * layout.prog
        const sy = cy + Math.sin(a) * layout.prog
        const ex = cx + Math.cos(a) * (layout.R - nr - 2.5)
        const ey = cy + Math.sin(a) * (layout.R - nr - 2.5)
        const dx = ex - sx
        const dy = ey - sy
        const px = -dy * s.bow
        const py = dx * s.bow

        if (local < MARK) {
          /* outbound — the engine asks a question of one topic */
          const u = easeInOutCubic(local / MARK)
          const c1x = (sx + ex) * 0.5 + px
          const c1y = (sy + ey) * 0.5 + py

          const u0 = Math.max(0, u - 0.34)
          ctx.globalAlpha = 0.3
          ctx.strokeStyle = inkFaint
          ctx.lineWidth = 0.75
          ctx.beginPath()
          for (let k = 0; k <= 8; k += 1) {
            quad(sx, sy, c1x, c1y, ex, ey, lerp(u0, u, k / 8))
            if (k === 0) ctx.moveTo(PT.x, PT.y)
            else ctx.lineTo(PT.x, PT.y)
          }
          ctx.stroke()

          quad(sx, sy, c1x, c1y, ex, ey, u)
          ctx.globalAlpha = 0.9
          if (s.trap) {
            ctx.strokeStyle = inkSoft
            ctx.lineWidth = 0.75
            diamond(ctx, PT.x, PT.y, 2.8)
          } else {
            ctx.fillStyle = inkSoft
            dot(ctx, PT.x, PT.y, 1.7)
          }
          continue
        }

        /* the verdict, struck at the topic */
        const v = (local - MARK) / (1 - MARK)
        if (local < MARK + FLASH) {
          const k = (local - MARK) / FLASH
          ctx.globalAlpha = (1 - k) * 0.7
          ctx.strokeStyle = s.hit ? signal : accent
          ctx.lineWidth = 0.75
          ring(ctx, ex, ey, nr * 0.5 + easeOutCubic(k) * nr * 1.6)
        }

        if (s.hit) {
          /* returns green, on the opposite bow, and is absorbed */
          const e = easeInOutCubic(v)
          const c2x = (sx + ex) * 0.5 - px
          const c2y = (sy + ey) * 0.5 - py
          quad(ex, ey, c2x, c2y, sx, sy, e)
          ctx.globalAlpha = (1 - clamp((v - 0.75) / 0.25)) * 0.95
          ctx.fillStyle = signal
          dot(ctx, PT.x, PT.y, 1.7)
        } else {
          /* drops inward into the weak-spot orbit */
          const e = easeOutCubic(v)
          const ang = GOLD * s.weak + rot
          const rr = layout.weakR * s.wobble
          const wx = cx + Math.cos(ang) * rr
          const wy = cy + Math.sin(ang) * rr
          const mx = (ex + wx) * 0.5 - (wy - ey) * 0.16
          const my = (ey + wy) * 0.5 + (wx - ex) * 0.16
          quad(ex, ey, mx, my, wx, wy, e)
          ctx.globalAlpha = clamp(0.35 + v) * clearK
          if (s.trap) {
            ctx.strokeStyle = accent
            ctx.lineWidth = 0.75
            diamond(ctx, PT.x, PT.y, 2.6)
          } else {
            ctx.fillStyle = accent
            dot(ctx, PT.x, PT.y, 1.6)
          }
        }
      }

      /* ---- the one number that matters ------------------------------------ */

      if (layout.detail) {
        const shown = Math.round(answered * clearK)
        ctx.font = layout.fontMicro
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        // Knock the rings out from under the counter so it stays readable.
        ctx.globalAlpha = 0.82
        ctx.fillStyle = bg
        ctx.fillRect(cx - 26, cy + layout.prog + 5, 52, layout.micro + 3)
        ctx.globalAlpha = 0.6
        ctx.fillStyle = inkSoft
        ctx.fillText(`${shown}/${questions}`, cx, cy + layout.prog + 6)

        if (hoverI < 0) {
          ctx.globalAlpha = 0.3
          ctx.fillStyle = inkFaint
          ctx.font = layout.fontNano
          ctx.textAlign = 'left'
          ctx.fillText('WEAK SPOTS', cx - layout.weakR, cy + layout.weakR * 0.6)
        }
      }

      ctx.globalAlpha = 1
      firstRef.current = false
      dirtyRef.current = false
    },
  })

  /* ---- interaction: hover a topic to read its question count -------------- */

  useEffect(() => {
    if (!chrome) return
    const canvas = ref.current
    if (!canvas) return

    const pick = (e: PointerEvent) => {
      const layout = layoutRef.current
      if (!layout) return
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      let best = -1
      let bestD = Number.POSITIVE_INFINITY
      for (let i = 0; i < layout.nodeX.length; i += 1) {
        const d = Math.hypot(x - layout.nodeX[i], y - layout.nodeY[i])
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      const grab = best >= 0 && bestD < Math.max(16, layout.nodeR[best] + 12) ? best : -1
      if (grab !== hoverRef.current) {
        hoverRef.current = grab
        dirtyRef.current = true
        setHover(grab)
      }
    }
    const onLeave = () => {
      if (hoverRef.current === -1) return
      hoverRef.current = -1
      dirtyRef.current = true
      setHover(-1)
    }

    canvas.style.cursor = 'crosshair'
    canvas.addEventListener('pointermove', pick)
    canvas.addEventListener('pointerdown', pick)
    canvas.addEventListener('pointerleave', onLeave)

    return () => {
      canvas.removeEventListener('pointermove', pick)
      canvas.removeEventListener('pointerdown', pick)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.style.cursor = 'default'
    }
  }, [ref, chrome])

  const on = hover >= 0 && hover < topicN
  const label = on
    ? `${labels.short[hover]} · ${sched.perTopic[hover]} Q · ${sched.trapPerTopic[hover]} TRAP`
    : `${topicN} TOPICS · ${questions} Q`

  return (
    <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
      <canvas ref={ref} className={styles.canvas} />
      {chrome && (
        <div className={styles.readout} aria-hidden="true">
          {label}
        </div>
      )}
      {chrome && (
        <div className={styles.hud}>
          <span className={styles.chip}>{questions} Q</span>
          <span className={styles.chip}>{modes} MODES</span>
          <span className={styles.chip} data-on="true">{TRAP_N} TRAPS</span>
          <span className={styles.chip}>{cards} CARDS</span>
        </div>
      )}
    </div>
  )
}
