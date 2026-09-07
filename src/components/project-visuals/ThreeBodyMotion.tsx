'use client'

/**
 * ThreeBodyMotion — "Three Body Problem"
 *
 * The same velocity-Verlet integrator runs twice on identical figure-eight
 * initial conditions; the second copy has one body nudged by 1e-6. Both draw
 * on the same axes as fading trails. For thousands of steps they are
 * pixel-identical, then they fork — while a log-scale divergence readout
 * beside them climbs six decades. Chaos, demonstrated rather than asserted.
 *
 * Everything on screen is the real integrator: pairwise O(n²) force
 * accumulation exploiting Newton's third law, gravitational softening,
 * positions advanced by v·dt + ½a·dt², accelerations recomputed, velocities
 * corrected. Trails are capped at 2,000 points, exactly like the project.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useCanvas2D } from '@/hooks/useCanvas2D'
import { clamp, damp, range, seeded } from '@/lib/math'
import { readPalette, type ProjectVisualProps, type VisualPalette } from './types'
import styles from './visual.module.css'

/* ------------------------------------------------------------------
   Model — G = 1, three unit masses.
   ------------------------------------------------------------------ */

const TAU = Math.PI * 2

/** Chenciner–Montgomery figure-eight initial conditions. */
const IC_P: readonly number[] = [0.97000436, -0.24308753, 0, 0, -0.97000436, 0.24308753]
const IC_V: readonly number[] = [
  0.46620369, 0.43236573, -0.93240737, -0.86473146, 0.46620369, 0.43236573,
]

/** Gravitational softening length — keeps close approaches non-singular. */
const SOFT = 0.21
const SOFT2 = SOFT * SOFT
const DT = 0.002

/** The nudge applied to a single body of the second copy. */
const EPS = 1e-6

const STEPS_END = 18000
const MAX_CATCHUP = 4000

/** Verified: trails are capped at 2,000 points. */
const TRAIL_CAP = 2000
const TRAIL_EVERY = STEPS_END / TRAIL_CAP // 9
const TRAIL_CHUNKS = 12

const DIV_EVERY = 80
const DIV_N = STEPS_END / DIV_EVERY + 1 // 226
const LOG_LO = -6.7
const LOG_HI = 0.9

const RUN_SECONDS = 22
const HOLD_SECONDS = 5
const CYCLE = RUN_SECONDS + HOLD_SECONDS

const DASH_SOFT: number[] = [1.5, 3]
const DASH_MARK: number[] = [2, 3]
const NO_DASH: number[] = []

/* ------------------------------------------------------------------
   Simulation state — every buffer allocated once.
   ------------------------------------------------------------------ */

interface Copy {
  p: Float64Array
  v: Float64Array
  ac: Float64Array
}

interface Sim {
  A: Copy
  B: Copy
  /** Seeded unit direction of the 1e-6 nudge. */
  ex: number
  ey: number
  trail: Float32Array
  trailHead: number
  trailCount: number
  div: Float32Array
  divCount: number
  step: number
  e0: number
  eRel: number
  dNow: number
  extX: number
  extY: number
  scale: number
  cx: number
  cy: number
  fieldW: number
  fieldH: number
  screen: Float64Array
  grab: number
  grabAx: number
  grabAy: number
  grabBx: number
  grabBy: number
  grabWx: number
  grabWy: number
  dragVx: number
  dragVy: number
  lastWx: number
  lastWy: number
  hasLastW: boolean
  /** True once the viewer has grabbed a body: the sim free-runs from then on. */
  live: boolean
  frame: number
  simulated: boolean
  staticW: number
  staticH: number
  staticInk: string
  lastLocal: number
  /** Loop-clock origin, rewound by Reset. */
  tOffset: number
}

interface Pointer {
  x: number
  y: number
  inside: boolean
}

function makeCopy(): Copy {
  return { p: new Float64Array(6), v: new Float64Array(6), ac: new Float64Array(6) }
}

/** Pairwise O(n²) accumulation, one evaluation per pair (Newton's third law). */
function accelerations(c: Copy): void {
  const { p, ac } = c
  ac[0] = 0
  ac[1] = 0
  ac[2] = 0
  ac[3] = 0
  ac[4] = 0
  ac[5] = 0
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const dx = p[j * 2] - p[i * 2]
      const dy = p[j * 2 + 1] - p[i * 2 + 1]
      const r2 = dx * dx + dy * dy + SOFT2
      const inv = 1 / (r2 * Math.sqrt(r2))
      const fx = dx * inv
      const fy = dy * inv
      ac[i * 2] += fx
      ac[i * 2 + 1] += fy
      ac[j * 2] -= fx
      ac[j * 2 + 1] -= fy
    }
  }
}

/** One velocity-Verlet step: drift, half-kick, re-evaluate, half-kick. */
function verlet(c: Copy): void {
  const { p, v, ac } = c
  for (let k = 0; k < 6; k++) {
    p[k] += v[k] * DT + 0.5 * ac[k] * DT * DT
    v[k] += 0.5 * ac[k] * DT
  }
  accelerations(c)
  for (let k = 0; k < 6; k++) v[k] += 0.5 * ac[k] * DT
}

/** Total energy under the softened potential. */
function energy(c: Copy): number {
  const { p, v } = c
  let e = 0
  for (let i = 0; i < 3; i++) e += 0.5 * (v[i * 2] * v[i * 2] + v[i * 2 + 1] * v[i * 2 + 1])
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const dx = p[j * 2] - p[i * 2]
      const dy = p[j * 2 + 1] - p[i * 2 + 1]
      e -= 1 / Math.sqrt(dx * dx + dy * dy + SOFT2)
    }
  }
  return e
}

/** Largest per-body distance between the two copies. */
function separation(sim: Sim): number {
  let d = 0
  for (let i = 0; i < 3; i++) {
    const dx = sim.A.p[i * 2] - sim.B.p[i * 2]
    const dy = sim.A.p[i * 2 + 1] - sim.B.p[i * 2 + 1]
    const r = Math.sqrt(dx * dx + dy * dy)
    if (r > d) d = r
  }
  return d
}

function trailIndex(copy: number, body: number, slot: number): number {
  return ((copy * 3 + body) * TRAIL_CAP + slot) * 2
}

function pushTrail(sim: Sim): void {
  const slot = sim.trailHead
  for (let i = 0; i < 3; i++) {
    const ax = sim.A.p[i * 2]
    const ay = sim.A.p[i * 2 + 1]
    const bx = sim.B.p[i * 2]
    const by = sim.B.p[i * 2 + 1]
    const ia = trailIndex(0, i, slot)
    const ib = trailIndex(1, i, slot)
    sim.trail[ia] = ax
    sim.trail[ia + 1] = ay
    sim.trail[ib] = bx
    sim.trail[ib + 1] = by
    if (Math.abs(ax) > sim.extX) sim.extX = Math.abs(ax)
    if (Math.abs(bx) > sim.extX) sim.extX = Math.abs(bx)
    if (Math.abs(ay) > sim.extY) sim.extY = Math.abs(ay)
    if (Math.abs(by) > sim.extY) sim.extY = Math.abs(by)
  }
  sim.trailHead = (slot + 1) % TRAIL_CAP
  if (sim.trailCount < TRAIL_CAP) sim.trailCount++
}

function resetSim(sim: Sim): void {
  sim.A.p.set(IC_P)
  sim.A.v.set(IC_V)
  sim.B.p.set(IC_P)
  sim.B.v.set(IC_V)
  sim.B.p[0] += sim.ex * EPS
  sim.B.p[1] += sim.ey * EPS
  accelerations(sim.A)
  accelerations(sim.B)
  sim.e0 = energy(sim.A)
  sim.eRel = 0
  sim.dNow = EPS
  sim.step = 0
  sim.trailHead = 0
  sim.trailCount = 0
  sim.divCount = 0
  sim.extX = 1.12
  sim.extY = 0.42
  sim.grab = -1
  sim.hasLastW = false
  sim.live = false
  sim.dragVx = 0
  sim.dragVy = 0
  sim.simulated = false
  sim.div[sim.divCount++] = Math.log10(EPS)
  pushTrail(sim)
}

function createSim(): Sim {
  const rnd = seeded(1618)
  const ang = rnd() * TAU
  const sim: Sim = {
    A: makeCopy(),
    B: makeCopy(),
    ex: Math.cos(ang),
    ey: Math.sin(ang),
    trail: new Float32Array(6 * TRAIL_CAP * 2),
    trailHead: 0,
    trailCount: 0,
    div: new Float32Array(DIV_N),
    divCount: 0,
    step: 0,
    e0: 0,
    eRel: 0,
    dNow: EPS,
    extX: 1.12,
    extY: 0.42,
    scale: 0,
    cx: 0,
    cy: 0,
    fieldW: 0,
    fieldH: 0,
    screen: new Float64Array(6),
    grab: -1,
    grabAx: 0,
    grabAy: 0,
    grabBx: 0,
    grabBy: 0,
    grabWx: 0,
    grabWy: 0,
    dragVx: 0,
    dragVy: 0,
    lastWx: 0,
    lastWy: 0,
    hasLastW: false,
    live: false,
    frame: 0,
    simulated: false,
    staticW: -1,
    staticH: -1,
    staticInk: '',
    lastLocal: 0,
    tOffset: 0,
  }
  resetSim(sim)
  return sim
}

/** Advance both copies one step and record the sampled history. */
function advance(sim: Sim): void {
  verlet(sim.A)
  verlet(sim.B)
  sim.step++
  if (sim.step % DIV_EVERY === 0) {
    const l = Math.log10(Math.max(separation(sim), 1e-12))
    if (sim.divCount < DIV_N) {
      sim.div[sim.divCount++] = l
    } else {
      /* free-running past the scripted end: the plot becomes a window */
      sim.div.copyWithin(0, 1)
      sim.div[DIV_N - 1] = l
    }
  }
  if (sim.step % TRAIL_EVERY === 0) pushTrail(sim)
}

/* ------------------------------------------------------------------
   Drawing utilities.
   ------------------------------------------------------------------ */

/** Tiny tracked monospace label. */
function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  tracking: number,
  right = false,
): void {
  ctx.font = `${size}px ui-monospace, monospace`
  const adv = ctx.measureText('0').width + tracking
  let cx = right ? x - (text.length * adv - tracking) : x
  for (let i = 0; i < text.length; i++) {
    ctx.fillText(text.charAt(i), cx, y)
    cx += adv
  }
}

function sci(v: number): string {
  if (!Number.isFinite(v) || v === 0) return '0.00E+00'
  let e = Math.floor(Math.log10(Math.abs(v)))
  let m = v / Math.pow(10, e)
  if (Math.abs(m) >= 9.995) {
    m /= 10
    e += 1
  }
  return `${m.toFixed(2)}E${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`
}

function grouped(n: number): string {
  const s = String(Math.round(n))
  let out = ''
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ' '
    out += s.charAt(i)
  }
  return out
}

/* ------------------------------------------------------------------
   Component.
   ------------------------------------------------------------------ */

export function ThreeBodyMotion(props: ProjectVisualProps) {
  const { project, progress, reducedMotion = false, interactive = true, className } = props

  const sim = useMemo(() => createSim(), [])
  const ptr = useMemo<Pointer>(() => ({ x: 0, y: 0, inside: false }), [])
  const palRef = useRef<VisualPalette | null>(null)
  const resetReq = useRef(false)

  const presets = project?.metrics.find((m) => m.label === 'Orbital presets')?.numeric ?? 6
  const canDrag = interactive !== false && !reducedMotion

  const ref = useCanvas2D<HTMLCanvasElement>({
    setup: ({ ctx }) => {
      palRef.current = readPalette(ctx.canvas)
      sim.staticW = -1
      sim.staticH = -1
    },

    draw: ({ ctx, w, h, t, dt }) => {
      sim.frame++
      if (sim.frame % 30 === 1 || !palRef.current) palRef.current = readPalette(ctx.canvas)
      const pal = palRef.current
      if (!pal) return

      /* --- geometry -------------------------------------------- */
      const pad = clamp(Math.min(w, h) * 0.075, 12, 30)
      const panelW = clamp(w * 0.22, 80, 190)
      const gap = clamp(w * 0.035, 10, 26)
      const fieldX = pad
      const fieldY = pad
      const fieldW = Math.max(48, w - pad * 2 - panelW - gap)
      const fieldH = Math.max(48, h - pad * 2)
      const cx = fieldX + fieldW / 2
      const cy = fieldY + fieldH / 2

      /* --- timeline: reduced motion pins the end state ---------- */
      if (resetReq.current) {
        resetReq.current = false
        if (!reducedMotion) {
          resetSim(sim)
          sim.tOffset = t
          sim.lastLocal = 0
          /* scroll can't be rewound, so a scroll-linked reset free-runs */
          if (typeof progress === 'number') sim.live = true
        }
      }
      let u = 1
      if (reducedMotion) {
        if (sim.staticW === w && sim.staticH === h && sim.staticInk === pal.ink) return
        if (!sim.simulated) {
          resetSim(sim)
          while (sim.step < STEPS_END) advance(sim)
          sim.dNow = separation(sim)
          sim.eRel = (energy(sim.A) - sim.e0) / Math.abs(sim.e0)
          sim.simulated = true
        }
        sim.staticW = w
        sim.staticH = h
        sim.staticInk = pal.ink
      } else if (typeof progress === 'number') {
        u = clamp(progress)
        if (u < sim.lastLocal - 0.002) resetSim(sim)
        sim.lastLocal = u
      } else {
        const local = (t - sim.tOffset) % CYCLE
        if (local < sim.lastLocal) resetSim(sim)
        sim.lastLocal = local
        u = clamp(local / RUN_SECONDS)
      }

      const released = range(u, 0.02, 1)
      const introA = reducedMotion ? 0 : 1 - range(u, 0.004, 0.045)

      /* --- drag: hold the body, carry its momentum on release --- */
      const grabbed = sim.grab
      if (grabbed >= 0 && !reducedMotion && sim.scale > 0) {
        const wx = (ptr.x - sim.cx) / sim.scale
        const wy = -(ptr.y - sim.cy) / sim.scale
        const dx = wx - sim.grabWx
        const dy = wy - sim.grabWy
        sim.A.p[grabbed * 2] = sim.grabAx + dx
        sim.A.p[grabbed * 2 + 1] = sim.grabAy + dy
        sim.B.p[grabbed * 2] = sim.grabBx + dx
        sim.B.p[grabbed * 2 + 1] = sim.grabBy + dy
        const inv = 1 / Math.max(dt, 1 / 120)
        const mvx = sim.hasLastW ? clamp((wx - sim.lastWx) * inv * 0.09, -2.5, 2.5) : 0
        const mvy = sim.hasLastW ? clamp((wy - sim.lastWy) * inv * 0.09, -2.5, 2.5) : 0
        sim.dragVx = damp(sim.dragVx, mvx, 14, dt)
        sim.dragVy = damp(sim.dragVy, mvy, 14, dt)
        sim.A.v[grabbed * 2] = sim.dragVx
        sim.A.v[grabbed * 2 + 1] = sim.dragVy
        sim.B.v[grabbed * 2] = sim.dragVx
        sim.B.v[grabbed * 2 + 1] = sim.dragVy
        sim.lastWx = wx
        sim.lastWy = wy
        sim.hasLastW = true
        accelerations(sim.A)
        accelerations(sim.B)
      }

      /* --- integrate -------------------------------------------- */
      if (!reducedMotion) {
        if (sim.live) {
          /* the viewer has taken over: free-run at the scripted rate */
          let n = Math.min(MAX_CATCHUP, Math.round(dt * (STEPS_END / RUN_SECONDS)))
          while (n > 0) {
            advance(sim)
            n--
          }
        } else {
          const target = Math.min(STEPS_END, Math.floor(released * STEPS_END))
          let budget = MAX_CATCHUP
          while (sim.step < target && budget > 0) {
            advance(sim)
            budget--
          }
        }
        sim.dNow = separation(sim)
        sim.eRel = (energy(sim.A) - sim.e0) / Math.abs(sim.e0)
      }

      /* --- camera: eases back only as the system needs room ----- */
      const targetScale = Math.min(
        fieldW / (2 * sim.extX * 1.14),
        fieldH / (2 * sim.extY * 1.45),
      )
      if (sim.scale <= 0 || sim.fieldW !== fieldW || sim.fieldH !== fieldH || reducedMotion) {
        sim.scale = targetScale
      } else {
        sim.scale = damp(sim.scale, targetScale, 1.1, dt)
      }
      sim.fieldW = fieldW
      sim.fieldH = fieldH
      sim.cx = cx
      sim.cy = cy
      const s = sim.scale

      /* --- how visible is the fork, in pixels ------------------- */
      const reveal = range(sim.dNow * s, 0.5, 3.5)
      const splitLog = Math.log10(Math.max(0.9 / s, 1e-9))
      let splitIdx = -1
      for (let i = 0; i < sim.divCount; i++) {
        if (sim.div[i] > splitLog) {
          splitIdx = i
          break
        }
      }

      /* --- hover ------------------------------------------------ */
      let hover = grabbed
      if (hover < 0 && canDrag && ptr.inside) {
        let best = 26 * 26
        for (let i = 0; i < 3; i++) {
          const hx = ptr.x - sim.screen[i * 2]
          const hy = ptr.y - sim.screen[i * 2 + 1]
          const d2 = hx * hx + hy * hy
          if (d2 < best) {
            best = d2
            hover = i
          }
        }
      }

      /* ==========================================================
         Paint
         ========================================================== */
      ctx.clearRect(0, 0, w, h)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.textBaseline = 'alphabetic'
      ctx.textAlign = 'left'
      ctx.setLineDash(NO_DASH)

      ctx.save()
      ctx.beginPath()
      ctx.rect(fieldX - 2, fieldY - 2, fieldW + 4, fieldH + 4)
      ctx.clip()

      /* barycentre — total momentum is zero, so it never moves */
      ctx.strokeStyle = pal.inkFaint
      ctx.globalAlpha = 0.5
      ctx.lineWidth = 0.75
      ctx.beginPath()
      ctx.moveTo(cx - 4, cy)
      ctx.lineTo(cx + 4, cy)
      ctx.moveTo(cx, cy - 4)
      ctx.lineTo(cx, cy + 4)
      ctx.stroke()

      /* softening length, stated early then left behind */
      const softA = 0.22 * (1 - range(u, 0.05, 0.28))
      if (softA > 0.012) {
        ctx.setLineDash(DASH_SOFT)
        ctx.globalAlpha = softA
        for (let i = 0; i < 3; i++) {
          ctx.beginPath()
          ctx.arc(cx + sim.A.p[i * 2] * s, cy - sim.A.p[i * 2 + 1] * s, SOFT * s, 0, TAU)
          ctx.stroke()
        }
        ctx.setLineDash(NO_DASH)
      }
      ctx.globalAlpha = 1

      /* Trails. Each chunk is coloured by the separation that actually held
         when it was written, so the shared history stays neutral and only
         the segment after the fork carries the accent. */
      const count = sim.trailCount
      if (count > 1) {
        const start = (sim.trailHead - count + TRAIL_CAP) % TRAIL_CAP
        ctx.lineWidth = 0.9
        for (let c = 0; c < TRAIL_CHUNKS; c++) {
          const k0 = Math.floor((count * c) / TRAIL_CHUNKS)
          const k1 = Math.min(count - 1, Math.floor((count * (c + 1)) / TRAIL_CHUNKS))
          if (k1 <= k0) continue
          const fade = 0.02 + 0.5 * Math.pow((c + 1) / TRAIL_CHUNKS, 2.4)
          const stepMid = sim.step - (count - 1 - (k0 + k1) * 0.5) * TRAIL_EVERY
          const di = Math.round(clamp(stepMid / DIV_EVERY, 0, sim.divCount - 1))
          const wasApart = range(Math.pow(10, sim.div[di]) * s, 0.5, 3.5)
          for (let copy = 0; copy < 2; copy++) {
            for (let body = 0; body < 3; body++) {
              ctx.beginPath()
              for (let k = k0; k <= k1; k++) {
                const ix = trailIndex(copy, body, (start + k) % TRAIL_CAP)
                const tx = cx + sim.trail[ix] * s
                const ty = cy - sim.trail[ix + 1] * s
                if (k === k0) ctx.moveTo(tx, ty)
                else ctx.lineTo(tx, ty)
              }
              if (copy === 0) {
                ctx.strokeStyle = pal.inkSoft
                ctx.globalAlpha = fade * 0.8
                ctx.stroke()
              } else {
                ctx.strokeStyle = pal.inkSoft
                ctx.globalAlpha = fade * 0.8 * (1 - wasApart)
                if (ctx.globalAlpha > 0.012) ctx.stroke()
                ctx.strokeStyle = pal.accent
                ctx.globalAlpha = fade * wasApart
                if (ctx.globalAlpha > 0.012) ctx.stroke()
              }
            }
          }
        }
        ctx.globalAlpha = 1
      }

      /* initial-condition velocity vectors, before release */
      if (introA > 0.012) {
        ctx.globalAlpha = introA
        ctx.strokeStyle = pal.accent
        ctx.lineWidth = 1
        for (let i = 0; i < 3; i++) {
          const bx = cx + sim.A.p[i * 2] * s
          const by = cy - sim.A.p[i * 2 + 1] * s
          const vx = sim.A.v[i * 2] * s * 0.42
          const vy = -sim.A.v[i * 2 + 1] * s * 0.42
          const len = Math.hypot(vx, vy)
          if (len < 8) continue
          const ux = vx / len
          const uy = vy / len
          ctx.beginPath()
          ctx.moveTo(bx + ux * 6, by + uy * 6)
          ctx.lineTo(bx + vx, by + vy)
          ctx.moveTo(bx + vx, by + vy)
          ctx.lineTo(bx + vx - ux * 5 + uy * 3, by + vy - uy * 5 - ux * 3)
          ctx.moveTo(bx + vx, by + vy)
          ctx.lineTo(bx + vx - ux * 5 - uy * 3, by + vy - uy * 5 + ux * 3)
          ctx.stroke()
        }
        ctx.globalAlpha = 1
      }

      /* bodies: base copy is a ring, perturbed copy a dot inside it */
      ctx.lineWidth = 1
      for (let i = 0; i < 3; i++) {
        const bx = cx + sim.A.p[i * 2] * s
        const by = cy - sim.A.p[i * 2 + 1] * s
        sim.screen[i * 2] = bx
        sim.screen[i * 2 + 1] = by
        ctx.beginPath()
        ctx.arc(bx, by, 3.6, 0, TAU)
        ctx.fillStyle = pal.bg
        ctx.globalAlpha = 0.88
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.strokeStyle = pal.ink
        ctx.stroke()
      }
      for (let i = 0; i < 3; i++) {
        ctx.beginPath()
        ctx.arc(cx + sim.B.p[i * 2] * s, cy - sim.B.p[i * 2 + 1] * s, 2.3, 0, TAU)
        ctx.fillStyle = pal.ink
        ctx.globalAlpha = 1 - reveal
        ctx.fill()
        ctx.fillStyle = pal.accent
        ctx.globalAlpha = reveal
        ctx.fill()
      }
      ctx.globalAlpha = 1

      /* hover / drag affordance */
      if (hover >= 0) {
        const bx = sim.screen[hover * 2]
        const by = sim.screen[hover * 2 + 1]
        ctx.strokeStyle = grabbed >= 0 ? pal.accent : pal.signal
        ctx.lineWidth = 0.9
        ctx.globalAlpha = grabbed >= 0 ? 0.95 : 0.6
        ctx.beginPath()
        ctx.arc(bx, by, 10, 0, TAU)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(bx - 15, by)
        ctx.lineTo(bx - 11, by)
        ctx.moveTo(bx + 11, by)
        ctx.lineTo(bx + 15, by)
        ctx.stroke()
        ctx.globalAlpha = 1
      }

      ctx.restore()

      /* --- field labels ----------------------------------------- */
      if (fieldW > 130) {
        ctx.fillStyle = pal.inkFaint
        ctx.globalAlpha = 0.9
        label(ctx, `FIGURE-EIGHT / 1 OF ${presets}`, fieldX, fieldY + 8, 7.5, 0.85)
        label(ctx, 'VELOCITY-VERLET  DT 2E-3', fieldX, fieldY + 19, 7.5, 0.85)
        ctx.globalAlpha = 1
      }

      /* legend: ring = base run, dot = the same run + 1e-6 */
      if (fieldW > 250 && fieldH > 90) {
        const legX = fieldX + fieldW - 8
        const legY = fieldY + 8
        ctx.strokeStyle = pal.ink
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(legX - 48, legY - 3, 3.4, 0, TAU)
        ctx.stroke()
        ctx.fillStyle = pal.inkFaint
        label(ctx, 'BASE', legX, legY, 7.5, 0.85, true)
        ctx.beginPath()
        ctx.arc(legX - 48, legY + 8, 2.3, 0, TAU)
        ctx.fillStyle = reveal > 0.5 ? pal.accent : pal.inkSoft
        ctx.fill()
        ctx.fillStyle = reveal > 0.5 ? pal.accent : pal.inkFaint
        label(ctx, '+1E-6', legX, legY + 11, 7.5, 0.85, true)
      }

      /* step + energy conservation, right-aligned to clear the HUD */
      if (fieldW > (canDrag ? 250 : 130)) {
        const footX = fieldX + fieldW
        ctx.fillStyle = pal.inkSoft
        label(ctx, `STEP ${grouped(sim.step)}`, footX, h - pad - 12, 8, 0.6, true)
        const eBad = Math.abs(sim.eRel) > 1e-2
        ctx.fillStyle = eBad ? pal.accent : pal.inkFaint
        ctx.globalAlpha = eBad ? 1 : 0.85
        label(ctx, `ΔE/E0 ${sci(sim.eRel)}`, footX, h - pad - 3, 7.5, 0.6, true)
        ctx.globalAlpha = 1
      }

      /* --- divergence panel -------------------------------------- */
      const px0 = fieldX + fieldW + gap
      const px1 = w - pad
      const py0 = pad + 16
      const py1 = h - pad - 12
      const ph = Math.max(24, py1 - py0)
      const pw = Math.max(24, px1 - px0)
      const yFor = (l: number) => py1 - range(l, LOG_LO, LOG_HI) * ph
      const xFor = (i: number) => px0 + (i / (DIV_N - 1)) * pw

      ctx.fillStyle = pal.inkFaint
      ctx.globalAlpha = 0.9
      label(ctx, 'DIVERGENCE', px0, py0 - 8, 7.5, 0.85)
      ctx.globalAlpha = 1

      ctx.strokeStyle = pal.inkFaint
      ctx.lineWidth = 0.75
      ctx.globalAlpha = 0.28
      ctx.beginPath()
      for (let l = -6; l <= 0; l += 2) {
        ctx.moveTo(px0, yFor(l))
        ctx.lineTo(px1, yFor(l))
      }
      ctx.stroke()
      ctx.globalAlpha = 0.55
      ctx.beginPath()
      ctx.moveTo(px0, py0 - 4)
      ctx.lineTo(px0, py1)
      ctx.lineTo(px1, py1)
      ctx.stroke()

      ctx.fillStyle = pal.inkFaint
      ctx.globalAlpha = 0.8
      label(ctx, '1E+00', px0 + 6, yFor(0) - 3, 7, 0.5)
      label(ctx, '1E-06', px0 + 6, yFor(-6) - 3, 7, 0.5)
      ctx.globalAlpha = 1

      /* the split marker — the one moment that matters */
      if (splitIdx > 0) {
        const mx = xFor(splitIdx)
        ctx.setLineDash(DASH_MARK)
        ctx.strokeStyle = pal.signal
        ctx.lineWidth = 0.75
        ctx.globalAlpha = 0.85
        ctx.beginPath()
        ctx.moveTo(mx, py1)
        ctx.lineTo(mx, py0 - 2)
        ctx.stroke()
        ctx.setLineDash(NO_DASH)
        ctx.fillStyle = pal.signal
        const flip = mx > px1 - 40
        label(ctx, 'SPLIT', flip ? mx - 3 : mx + 3, py0 + 5, 7, 0.7, flip)
        ctx.globalAlpha = 1
      }

      /* the divergence curve */
      if (sim.divCount > 0) {
        ctx.strokeStyle = pal.accent
        if (sim.divCount > 1) {
          ctx.lineWidth = 1.1
          ctx.beginPath()
          for (let i = 0; i < sim.divCount; i++) {
            const gx = xFor(i)
            const gy = yFor(sim.div[i])
            if (i === 0) ctx.moveTo(gx, gy)
            else ctx.lineTo(gx, gy)
          }
          ctx.stroke()
        }
        const hx = xFor(sim.divCount - 1)
        const hy = yFor(sim.div[sim.divCount - 1])
        ctx.globalAlpha = 0.32
        ctx.lineWidth = 0.75
        ctx.beginPath()
        ctx.moveTo(px0, hy)
        ctx.lineTo(px1, hy)
        ctx.stroke()
        ctx.globalAlpha = 1
        ctx.fillStyle = pal.accent
        ctx.beginPath()
        ctx.arc(hx, hy, 1.9, 0, TAU)
        ctx.fill()
      }

      ctx.fillStyle = pal.accent
      label(ctx, `Δ ${sci(sim.dNow)}`, px1, py1 + 9, 8, 0.5, true)
    },
  })

  /* ---- interaction ---------------------------------------------- */

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !canDrag) return

    const nearest = (x: number, y: number): number => {
      let best = 26 * 26
      let pick = -1
      for (let i = 0; i < 3; i++) {
        const dx = x - sim.screen[i * 2]
        const dy = y - sim.screen[i * 2 + 1]
        const d2 = dx * dx + dy * dy
        if (d2 < best) {
          best = d2
          pick = i
        }
      }
      return pick
    }

    const track = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      ptr.x = e.clientX - rect.left
      ptr.y = e.clientY - rect.top
      ptr.inside = true
    }

    const onMove = (e: PointerEvent) => {
      track(e)
      if (sim.grab < 0) canvas.style.cursor = nearest(ptr.x, ptr.y) >= 0 ? 'grab' : 'default'
    }

    const onDown = (e: PointerEvent) => {
      track(e)
      const pick = nearest(ptr.x, ptr.y)
      if (pick < 0) return
      sim.grab = pick
      sim.live = true
      sim.grabAx = sim.A.p[pick * 2]
      sim.grabAy = sim.A.p[pick * 2 + 1]
      sim.grabBx = sim.B.p[pick * 2]
      sim.grabBy = sim.B.p[pick * 2 + 1]
      sim.grabWx = sim.scale > 0 ? (ptr.x - sim.cx) / sim.scale : 0
      sim.grabWy = sim.scale > 0 ? -(ptr.y - sim.cy) / sim.scale : 0
      sim.lastWx = sim.grabWx
      sim.lastWy = sim.grabWy
      sim.hasLastW = false
      sim.dragVx = sim.A.v[pick * 2]
      sim.dragVy = sim.A.v[pick * 2 + 1]
      canvas.style.cursor = 'grabbing'
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        /* pointer capture is best-effort */
      }
    }

    const release = (e: PointerEvent) => {
      if (sim.grab >= 0) {
        sim.grab = -1
        sim.hasLastW = false
        try {
          canvas.releasePointerCapture(e.pointerId)
        } catch {
          /* already released */
        }
      }
      canvas.style.cursor = 'default'
    }

    const onLeave = (e: PointerEvent) => {
      ptr.inside = false
      release(e)
    }

    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerup', release)
    canvas.addEventListener('pointercancel', release)
    canvas.addEventListener('pointerleave', onLeave)
    return () => {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', release)
      canvas.removeEventListener('pointercancel', release)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.style.cursor = 'default'
    }
  }, [ref, sim, ptr, canDrag])

  return (
    <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
      <canvas
        ref={ref}
        className={styles.canvas}
        role="img"
        aria-label="Two runs of the same velocity-Verlet three-body integrator on figure-eight initial conditions, one perturbed by 1e-6, diverging over time beside a log-scale divergence plot."
      />
      {canDrag && (
        <div className={styles.hud}>
          <span className={styles.chip} data-on="true">
            Figure-eight
          </span>
          <button
            type="button"
            className={styles.chip}
            style={{ cursor: 'pointer' }}
            onClick={() => {
              resetReq.current = true
            }}
          >
            Reset
          </button>
        </div>
      )}
    </div>
  )
}
