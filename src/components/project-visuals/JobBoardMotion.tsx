'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useCanvas2D, type CanvasContext } from '@/hooks/useCanvas2D'
import { clamp, damp, easeInOutCubic, easeOutCubic, lerp, range, seeded } from '@/lib/math'
import { readPalette, type ProjectVisualProps, type VisualPalette } from './types'
import styles from './visual.module.css'

/* ============================================================
   TappedIn — CV parse → skill extraction → bipartite match.

   The matcher is real: required and preferred skills are
   weighted 70/30, a contract-type match adds a bonus, the
   score is clamped to 0–100, and every required skill the
   candidate lacks is reported by name. The synonym table
   (js→javascript, k8s→kubernetes, ml→ai, ux→ui) is what makes
   half of these edges exist at all, so the pills normalise
   on screen as they leave the page.
   ============================================================ */

interface SkillDef {
  /** Token as it appears in the CV. */
  raw: string
  /** Canonical form after the synonym table. */
  canon: string
  syn: boolean
  /** Which ruled line of the CV page it sits on. */
  row: number
}

const SKILLS: SkillDef[] = [
  { raw: 'PYTHON', canon: 'PYTHON', syn: false, row: 2 },
  { raw: 'DJANGO', canon: 'DJANGO', syn: false, row: 4 },
  { raw: 'JS', canon: 'JAVASCRIPT', syn: true, row: 6 },
  { raw: 'POSTGRES', canon: 'POSTGRES', syn: false, row: 8 },
  { raw: 'DOCKER', canon: 'DOCKER', syn: false, row: 10 },
  { raw: 'K8S', canon: 'KUBERNETES', syn: true, row: 12 },
  { raw: 'SPACY', canon: 'SPACY', syn: false, row: 14 },
  { raw: 'ML', canon: 'AI', syn: true, row: 16 },
  { raw: 'REST', canon: 'REST', syn: false, row: 18 },
  { raw: 'UX', canon: 'UI', syn: true, row: 20 },
]

const CANON: string[] = SKILLS.map((s) => s.canon)

const rowY = (row: number) => 0.09 + row * 0.037

/** Ruled lines of the stylised CV page. `skill` indexes SKILLS, or -1. */
const RULES: { y: number; w: number; skill: number }[] = (() => {
  const rnd = seeded(0x4a4f42)
  const out: { y: number; w: number; skill: number }[] = []
  for (let i = 0; i < 22; i++) {
    const r = rnd()
    const si = SKILLS.findIndex((s) => s.row === i)
    out.push({ y: rowY(i), w: si >= 0 ? 0.27 : 0.26 + r * 0.5, skill: si })
  }
  return out
})()

interface JobDef {
  title: string
  req: string[]
  pref: string[]
  /** Candidate is full-time; only full-time roles earn the bonus. */
  contractMatch: boolean
}

const JOBS: JobDef[] = [
  {
    title: 'BACKEND ENG',
    req: ['PYTHON', 'DJANGO', 'POSTGRES', 'REDIS'],
    pref: ['DOCKER', 'REST'],
    contractMatch: true,
  },
  {
    title: 'ML ENGINEER',
    req: ['PYTHON', 'SPACY', 'AI'],
    pref: ['KUBERNETES', 'PYTORCH'],
    contractMatch: true,
  },
  {
    title: 'PLATFORM ENG',
    req: ['KUBERNETES', 'DOCKER', 'GO', 'TERRAFORM'],
    pref: ['PYTHON', 'REST'],
    contractMatch: false,
  },
]

type PinKind = 0 | 1 // 0 = required, 1 = preferred

interface Pin {
  label: string
  kind: PinKind
  /** Index into SKILLS, or -1 when the candidate does not have it. */
  pill: number
  /** Points this slot contributes when matched. */
  contrib: number
}

interface JobCalc {
  pins: Pin[]
  nreq: number
  reqPart: number
  prefPart: number
  bonus: number
  score: number
  legend: string
  missingLabel: string
  hasMissing: boolean
}

const JOB_CALC: JobCalc[] = JOBS.map((j) => {
  const pins: Pin[] = []
  const missing: string[] = []
  let reqHit = 0
  for (const s of j.req) {
    const pill = CANON.indexOf(s)
    if (pill >= 0) reqHit += 1
    else missing.push(s)
    pins.push({ label: s, kind: 0, pill, contrib: 70 / j.req.length })
  }
  let prefHit = 0
  for (const s of j.pref) {
    const pill = CANON.indexOf(s)
    if (pill >= 0) prefHit += 1
    pins.push({ label: s, kind: 1, pill, contrib: 30 / j.pref.length })
  }
  const reqPart = (70 * reqHit) / j.req.length
  const prefPart = (30 * prefHit) / j.pref.length
  const bonus = j.contractMatch ? 5 : 0
  return {
    pins,
    nreq: j.req.length,
    reqPart,
    prefPart,
    bonus,
    score: clamp(reqPart + prefPart + bonus, 0, 100),
    legend: bonus > 0 ? 'REQ 70 · PREF 30 · +5 CONTRACT' : 'REQ 70 · PREF 30',
    missingLabel: missing.length > 0 ? `MISSING · ${missing.join(', ')}` : 'NO MISSING REQUIRED',
    hasMissing: missing.length > 0,
  }
})

const BEST_JOB = JOB_CALC.reduce((best, c, i) => (c.score > JOB_CALC[best].score ? i : best), 0)

const CANDIDATES = ['008', '023', '042', '061', '087']
const ACTIVE_CAND = 2

const MAX_PINS = JOB_CALC.reduce((n, c) => Math.max(n, c.pins.length), 0)

const PHASES = ['01 PARSE', '02 EXTRACT', '03 MATCH', '04 SCORE']

const LOOP = 22

/* ---------- drawing primitives (allocation free) ---------- */

const FONTS = new Map<number, string>()
function mono(px: number): string {
  const k = Math.round(px * 2) / 2
  let f = FONTS.get(k)
  if (f === undefined) {
    f = `${k}px ui-monospace, monospace`
    FONTS.set(k, f)
  }
  return f
}

/** Optional-chained letter spacing — not in every engine, never required. */
function applyTracking(ctx: CanvasRenderingContext2D) {
  if ('letterSpacing' in ctx) {
    ;(ctx as unknown as Record<string, unknown>).letterSpacing = '0.08em'
  }
}

/** Dial angle for a 0–100 score across a 270° arc. */
const DIAL_A0 = 2.42
const DIAL_SWEEP = 4.71
const dialAngle = (v: number) => DIAL_A0 + (v / 100) * DIAL_SWEEP

function rrPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rad = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rad, y)
  ctx.lineTo(x + w - rad, y)
  ctx.arcTo(x + w, y, x + w, y + rad, rad)
  ctx.lineTo(x + w, y + h - rad)
  ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad)
  ctx.lineTo(x + rad, y + h)
  ctx.arcTo(x, y + h, x, y + h - rad, rad)
  ctx.lineTo(x, y + rad)
  ctx.arcTo(x, y, x + rad, y, rad)
  ctx.closePath()
}

/** Flow curve from a pill to a job pin, drawn to `prog` of its length. */
function edgePath(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  prog: number,
  steps: number,
) {
  const dx = (x2 - x1) * 0.45
  const c1x = x1 + dx
  const c2x = x2 - dx
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  for (let s = 1; s <= steps; s += 1) {
    const tt = (s / steps) * prog
    const u = 1 - tt
    const px = u * u * u * x1 + 3 * u * u * tt * c1x + 3 * u * tt * tt * c2x + tt * tt * tt * x2
    const py = u * u * u * y1 + 3 * u * u * tt * y1 + 3 * u * tt * tt * y2 + tt * tt * tt * y2
    ctx.lineTo(px, py)
  }
  ctx.stroke()
}

function edgeMidX(x1: number, x2: number): number {
  const dx = (x2 - x1) * 0.45
  return 0.125 * x1 + 0.375 * (x1 + dx) + 0.375 * (x2 - dx) + 0.125 * x2
}

const FALLBACK_PALETTE: VisualPalette = readPalette(null)

interface Layout {
  s: number
  cvX: number
  cvY: number
  cvW: number
  cvH: number
  chipH: number
  chipStep: number
  chipY0: number
  pillCx: number
  pillW: number
  pillH: number
  pillStep: number
  pillY0: number
  stageCx: number
  cardX: number
  cardW: number
  cardH: number
  cardStep: number
  cardY0: number
}

export function JobBoardMotion(props: ProjectVisualProps) {
  const { progress, reducedMotion = false, interactive = true, className } = props

  const [sel, setSel] = useState(BEST_JOB)
  const selRef = useRef(sel)
  selRef.current = sel

  const layoutRef = useRef<Layout | null>(null)
  const palRef = useRef<VisualPalette>(FALLBACK_PALETTE)
  const palAt = useRef(-1)
  const rerun = useRef(1)
  const ptr = useRef({ x: 0, y: 0, on: false })
  const readout = useRef<HTMLDivElement | null>(null)
  const cursor = useRef('')

  const buf = useMemo(
    () => ({
      /** x1,y1,x2,y2 per drawn edge */
      edge: new Float32Array(MAX_PINS * 4),
      /** midpoint x,y per drawn edge */
      mid: new Float32Array(MAX_PINS * 2),
      /** pin index behind each drawn edge */
      idx: new Int16Array(MAX_PINS),
    }),
    [],
  )

  const setup = ({ ctx, w, h }: Omit<CanvasContext, 't' | 'dt'>) => {
    palRef.current = readPalette(ctx.canvas)
    applyTracking(ctx)

    const s = clamp(Math.min(w / 860, h / 470), 0.62, 1.35)
    const m = Math.max(12, Math.min(w, h) * 0.05)
    const bandY = m + 12 * s
    const bandH = Math.max(48, h - bandY - (m + (interactive ? 22 : 6) * s))

    // The three columns live inside a centred content box so the graph
    // never stretches into a thin smear on a very wide container.
    const contentW = Math.min(w - 2 * m, 760 * s)
    const contentX = (w - contentW) / 2

    ctx.font = mono(Math.max(6, 7 * s))
    let maxw = 0
    for (const sk of SKILLS) maxw = Math.max(maxw, ctx.measureText(sk.canon).width)
    const pillW = Math.min(maxw + 14 * s, contentW * 0.26)
    const pillH = clamp(11 * s, 8, 16)
    const pillStep = Math.min(pillH + 6 * s, bandH / SKILLS.length)
    const pillY0 = bandY + (bandH - (pillStep * (SKILLS.length - 1) + pillH)) / 2

    const cvW = clamp(contentW * 0.155, 46, 128)
    const cvH = Math.min(cvW / 0.7, bandH * 0.94)
    const cvX = contentX
    const cvY = bandY + (bandH - cvH) / 2

    const chipH = clamp(13 * s, 9, 17)
    const chipStep = chipH + 6 * s
    const chipY0 = bandY + (bandH - (chipStep * (CANDIDATES.length - 1) + chipH)) / 2

    const cardX = Math.max(
      cvX + cvW + pillW + 34 * s,
      contentX + contentW - clamp(contentW * 0.37, 88, 300),
    )
    const cardW = Math.max(72, Math.min(w - m, contentX + contentW) - cardX)
    const cardGap = 12 * s
    const cardH = Math.min(78 * s, (bandH - 2 * cardGap) / JOBS.length)
    const cardStep = cardH + cardGap
    const cardY0 = bandY + (bandH - (cardStep * (JOBS.length - 1) + cardH)) / 2

    layoutRef.current = {
      s,
      cvX,
      cvY,
      cvW,
      cvH,
      chipH,
      chipStep,
      chipY0,
      pillCx: (cvX + cvW + cardX) / 2,
      pillW,
      pillH,
      pillStep,
      pillY0,
      stageCx: Math.min(cvX + cvW + 16 * s + pillW / 2, (cvX + cvW + cardX) / 2 - 4 * s),
      cardX,
      cardW,
      cardH,
      cardStep,
      cardY0,
    }
  }

  const draw = ({ ctx, w, h, t, dt }: CanvasContext) => {
    const L = layoutRef.current
    if (!L) return

    if (palAt.current < 0 || t - palAt.current > 0.3) {
      palRef.current = readPalette(ctx.canvas)
      palAt.current = t
    }
    const pal = palRef.current
    const s = L.s

    /* --- timeline --- */
    let p: number
    let env = 1
    if (reducedMotion) {
      p = 1
      rerun.current = 1
    } else {
      if (typeof progress === 'number') {
        p = clamp(progress, 0, 1)
      } else {
        const c = (t % LOOP) / LOOP
        p = clamp(c / 0.88, 0, 1)
        env = Math.min(range(c, 0, 0.03), 1 - range(c, 0.955, 1))
      }
      rerun.current = damp(rerun.current, 1, 8, dt)
    }

    const calc = JOB_CALC[sel]
    const scanT = range(p, 0.03, 0.32)
    const morph = easeInOutCubic(range(p, 0.34, 0.47))
    const titleInk = range(p, 0.14, 0.30)
    const cardInk = range(p, 0.42, 0.56)
    const outline = range(p, 0.02, 0.14)

    ctx.clearRect(0, 0, w, h)
    applyTracking(ctx)
    ctx.lineCap = 'butt'
    ctx.lineJoin = 'round'
    ctx.textBaseline = 'middle'

    /* --- morphing CV page → active candidate chip (same x, same width) --- */
    const chipY = L.chipY0 + ACTIVE_CAND * L.chipStep
    const px0 = L.cvX
    const pw0 = L.cvW
    const py0 = lerp(L.cvY, chipY, morph)
    const ph0 = lerp(L.cvH, L.chipH, morph)
    const prad = lerp(2 * s, L.chipH / 2, morph)

    /* ---------- pill positions ---------- */
    const pillLeft = L.pillCx - L.pillW / 2
    const pillRight = L.pillCx + L.pillW / 2

    /* ---------- job pin geometry for the selected card ---------- */
    const selCy = L.cardY0 + sel * L.cardStep
    const nPins = calc.pins.length
    const pinStep = Math.min(9 * s, (L.cardH - 18 * s) / Math.max(1, nPins - 1))
    const selPinY0 = selCy + L.cardH / 2 - (pinStep * (nPins - 1)) / 2

    /* ---------- edges: pill → job pin ---------- */
    let nEdges = 0
    for (let k = 0; k < nPins; k += 1) {
      const pin = calc.pins[k]
      if (pin.pill < 0) continue
      const y1 = L.pillY0 + pin.pill * L.pillStep + L.pillH / 2
      const x1 = pillRight + 2 * s
      const x2 = L.cardX - 3 * s
      const y2 = selPinY0 + k * pinStep
      const o = nEdges * 4
      buf.edge[o] = x1
      buf.edge[o + 1] = y1
      buf.edge[o + 2] = x2
      buf.edge[o + 3] = y2
      buf.mid[nEdges * 2] = edgeMidX(x1, x2)
      buf.mid[nEdges * 2 + 1] = (y1 + y2) / 2
      buf.idx[nEdges] = k
      nEdges += 1
    }

    /* --- hover: nearest edge midpoint --- */
    let hover = -1
    let overCard = -1
    if (interactive !== false && ptr.current.on) {
      const mx = ptr.current.x
      const my = ptr.current.y
      let best = p > 0.6 && rerun.current > 0.9 ? 24 * s * (24 * s) : -1
      for (let e = 0; e < nEdges; e += 1) {
        const dx = mx - buf.mid[e * 2]
        const dy = my - buf.mid[e * 2 + 1]
        const d = dx * dx + dy * dy
        if (d < best) {
          best = d
          hover = e
        }
      }
      if (mx > L.cardX - 8 * s && mx < L.cardX + L.cardW) {
        for (let j = 0; j < JOBS.length; j += 1) {
          const cy = L.cardY0 + j * L.cardStep
          if (my >= cy && my <= cy + L.cardH) overCard = j
        }
      }
    }
    const wantCursor = overCard >= 0 ? 'pointer' : ''
    if (cursor.current !== wantCursor) {
      cursor.current = wantCursor
      ctx.canvas.style.cursor = wantCursor
    }

    /* ---------- 1. candidate fan (candidate → its skills) ---------- */
    ctx.strokeStyle = pal.inkFaint
    ctx.lineWidth = 0.75
    for (let i = 0; i < SKILLS.length; i += 1) {
      const a = easeOutCubic(range(p, 0.48 + i * 0.008, 0.62 + i * 0.008))
      if (a <= 0.001) continue
      ctx.globalAlpha = 0.42 * a * env
      edgePath(
        ctx,
        px0 + pw0,
        py0 + ph0 / 2,
        pillLeft - 2 * s,
        L.pillY0 + i * L.pillStep + L.pillH / 2,
        a,
        14,
      )
    }

    /* ---------- 2. match edges (skills → selected job) ---------- */
    for (let e = 0; e < nEdges; e += 1) {
      const k = buf.idx[e]
      const pin = calc.pins[k]
      const timeline = easeOutCubic(range(p, 0.52 + e * 0.022, 0.68 + e * 0.022))
      const local = easeOutCubic(clamp(rerun.current * 1.4 - e * 0.05, 0, 1))
      const prog = Math.min(timeline, local)
      if (prog <= 0.001) continue
      const o = e * 4
      const req = pin.kind === 0
      ctx.strokeStyle = e === hover ? pal.accent : req ? pal.ink : pal.inkFaint
      ctx.lineWidth = e === hover ? 1.5 : req ? 1.2 : 0.75
      ctx.globalAlpha = (e === hover ? 1 : req ? 0.72 : 0.62) * env
      edgePath(ctx, buf.edge[o], buf.edge[o + 1], buf.edge[o + 2], buf.edge[o + 3], prog, 20)
    }
    ctx.lineWidth = 1

    /* ---------- 3. left column: CV page / candidate chips ---------- */
    ctx.globalAlpha = env
    ctx.fillStyle = pal.bg
    rrPath(ctx, px0, py0, pw0, ph0, prad)
    ctx.fill()
    ctx.strokeStyle = morph > 0.5 ? pal.ink : pal.inkSoft
    ctx.lineWidth = 1
    ctx.stroke()

    // page interior — ruled lines, skill tokens, scan line
    const inner = 1 - range(p, 0.31, 0.40)
    if (inner > 0.001) {
      ctx.save()
      rrPath(ctx, px0, py0, pw0, ph0, prad)
      ctx.clip()
      for (const r of RULES) {
        const ly = py0 + r.y * ph0
        const passed = r.y <= scanT
        const isSkill = r.skill >= 0
        ctx.globalAlpha = inner * (isSkill ? (passed ? 0.95 : 0.4) : passed ? 0.5 : 0.28) * env
        ctx.strokeStyle = isSkill && passed ? pal.ink : pal.inkFaint
        ctx.lineWidth = isSkill ? 2.2 * s : 1
        ctx.beginPath()
        ctx.moveTo(px0 + 0.12 * pw0, ly)
        ctx.lineTo(px0 + (0.12 + r.w) * pw0, ly)
        ctx.stroke()
      }
      // sweep line
      if (scanT > 0 && scanT < 1) {
        const sy = py0 + lerp(0.05, 0.93, scanT) * ph0
        ctx.globalAlpha = inner * env
        ctx.strokeStyle = pal.accent
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(px0 - 3 * s, sy)
        ctx.lineTo(px0 + pw0 + 3 * s, sy)
        ctx.stroke()
        ctx.fillStyle = pal.accent
        ctx.beginPath()
        ctx.moveTo(px0 - 3 * s, sy - 2.4 * s)
        ctx.lineTo(px0 + 1.5 * s, sy)
        ctx.lineTo(px0 - 3 * s, sy + 2.4 * s)
        ctx.closePath()
        ctx.fill()
      }
      ctx.restore()
      ctx.globalAlpha = inner * env
      ctx.fillStyle = pal.inkFaint
      ctx.font = mono(Math.max(6, 6.4 * s))
      ctx.textAlign = 'left'
      ctx.fillText('CV.PDF', px0, py0 - 7 * s)
    }

    // active chip label
    if (morph > 0.001) {
      ctx.globalAlpha = morph * env
      ctx.fillStyle = pal.ink
      ctx.font = mono(Math.max(6, 6.4 * s))
      ctx.textAlign = 'left'
      ctx.fillText(`CAND ${CANDIDATES[ACTIVE_CAND]}`, px0 + 7 * s, py0 + ph0 / 2)
      ctx.beginPath()
      ctx.arc(px0 + 4 * s, py0 + ph0 / 2, 1.5 * s, 0, Math.PI * 2)
      ctx.fill()
    }

    // the other seeded candidates
    for (let i = 0; i < CANDIDATES.length; i += 1) {
      if (i === ACTIVE_CAND) continue
      const a = easeOutCubic(range(p, 0.40 + i * 0.02, 0.54 + i * 0.02))
      if (a <= 0.001) continue
      const cy = L.chipY0 + i * L.chipStep + lerp(6 * s, 0, a) * (i < ACTIVE_CAND ? 1 : -1)
      ctx.globalAlpha = 0.55 * a * env
      ctx.fillStyle = pal.bg
      rrPath(ctx, L.cvX, cy, L.cvW, L.chipH, L.chipH / 2)
      ctx.fill()
      ctx.strokeStyle = pal.inkFaint
      ctx.lineWidth = 0.75
      ctx.stroke()
      ctx.fillStyle = pal.inkFaint
      ctx.font = mono(Math.max(6, 6.4 * s))
      ctx.fillText(`CAND ${CANDIDATES[i]}`, L.cvX + 7 * s, cy + L.chipH / 2)
    }

    /* ---------- 4. extracted skill pills ---------- */
    ctx.font = mono(Math.max(6, 7 * s))
    ctx.textAlign = 'center'
    for (let i = 0; i < SKILLS.length; i += 1) {
      const sk = SKILLS[i]
      const ty = rowY(sk.row)
      const birth = 0.03 + ty * 0.29
      const a = easeOutCubic(range(p, birth, birth + 0.075))
      const b = easeInOutCubic(range(p, 0.35 + i * 0.01, 0.5 + i * 0.01))
      const slotY = L.pillY0 + i * L.pillStep + L.pillH / 2

      // empty lattice slot
      if (b < 1) {
        ctx.globalAlpha = 0.13 * (1 - b) * env
        ctx.strokeStyle = pal.inkFaint
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(L.pillCx - L.pillW * 0.32, slotY)
        ctx.lineTo(L.pillCx + L.pillW * 0.32, slotY)
        ctx.stroke()
      }
      if (a <= 0.001) continue

      const ox = L.cvX + 0.25 * L.cvW
      const oy = L.cvY + ty * L.cvH
      const sx = lerp(ox, L.stageCx, a)
      const cx = lerp(sx, L.pillCx, b)
      const cy = lerp(oy, slotY, b)
      const sc = a < 1 ? easeOutCubic(a) * (1 + 0.16 * Math.sin(a * Math.PI)) : 1
      const pw = L.pillW * sc
      const ph = L.pillH * sc
      const swap = sk.syn && a > 0.5 && a < 0.86
      const lit = hover >= 0 && calc.pins[buf.idx[hover]].pill === i

      ctx.globalAlpha = env
      ctx.fillStyle = pal.bg
      rrPath(ctx, cx - pw / 2, cy - ph / 2, pw, ph, ph / 2)
      ctx.fill()
      ctx.strokeStyle = lit || swap ? pal.accent : pal.inkSoft
      ctx.lineWidth = lit ? 1.2 : 0.75
      ctx.globalAlpha = (lit ? 1 : 0.75) * env
      ctx.stroke()

      ctx.globalAlpha = (lit ? 1 : 0.9) * env
      ctx.fillStyle = lit ? pal.accent : pal.ink
      ctx.font = mono(Math.max(6, 7 * s * Math.min(1, sc)))
      ctx.fillText(a > 0.5 ? sk.canon : sk.raw, cx, cy + 0.5)
    }

    /* ---------- 5. job cards ---------- */
    for (let j = 0; j < JOBS.length; j += 1) {
      const jc = JOB_CALC[j]
      const cy = L.cardY0 + j * L.cardStep
      const isSel = j === sel
      const n = jc.pins.length
      const step = Math.min(9 * s, (L.cardH - 18 * s) / Math.max(1, n - 1))
      const y0 = cy + L.cardH / 2 - (step * (n - 1)) / 2

      ctx.globalAlpha = env
      ctx.fillStyle = pal.bg
      rrPath(ctx, L.cardX, cy, L.cardW, L.cardH, 2 * s)
      ctx.fill()
      ctx.globalAlpha = (isSel ? lerp(0.35, 1, cardInk) : 0.55) * outline * env
      ctx.strokeStyle = isSel && cardInk > 0.4 ? pal.accent : pal.inkFaint
      ctx.lineWidth = isSel && cardInk > 0.4 ? 1.2 : 0.75
      ctx.stroke()

      ctx.textAlign = 'left'
      if (titleInk > 0.001) {
        ctx.globalAlpha = titleInk * (isSel ? 1 : 0.8) * env
        ctx.fillStyle = isSel && cardInk > 0.4 ? pal.ink : pal.inkSoft
        ctx.font = mono(Math.max(6.5, 7.6 * s))
        ctx.fillText(JOBS[j].title, L.cardX + 10 * s, cy + 12 * s)
      }
      // Only the selected role spells the rule out: 70/30 + contract bonus,
      // and the required skills this candidate is actually missing.
      if (isSel && cardInk > 0.001 && L.cardH > 46 * s) {
        ctx.globalAlpha = cardInk * 0.85 * env
        ctx.fillStyle = pal.inkFaint
        ctx.font = mono(Math.max(6, 6.2 * s))
        ctx.fillText(
          L.cardW > 168 * s ? jc.legend : 'REQ 70 · PREF 30',
          L.cardX + 10 * s,
          cy + 23 * s,
        )

        ctx.globalAlpha = Math.min(range(p, 0.62, 0.72), rerun.current) * env
        ctx.fillStyle = jc.hasMissing ? pal.accent : pal.signal
        ctx.fillText(jc.missingLabel, L.cardX + 10 * s, cy + L.cardH - 9 * s)
      }

      // pins on the card's left edge
      for (let k = 0; k < n; k += 1) {
        const pin = jc.pins[k]
        const y = y0 + k * step
        const matched = pin.pill >= 0
        const a = cardInk * (isSel ? 1 : 0.75)
        if (a <= 0.001) continue
        ctx.globalAlpha = a * env
        if (pin.kind === 0) {
          const q = 5.5 * s
          ctx.beginPath()
          ctx.rect(L.cardX - q / 2, y - q / 2, q, q)
          if (matched) {
            ctx.fillStyle = isSel ? pal.signal : pal.inkFaint
            ctx.fill()
          } else {
            ctx.fillStyle = pal.bg
            ctx.fill()
            ctx.strokeStyle = isSel ? pal.accent : pal.inkFaint
            ctx.lineWidth = 1
            ctx.stroke()
            ctx.beginPath()
            ctx.moveTo(L.cardX - q / 2, y + q / 2)
            ctx.lineTo(L.cardX + q / 2, y - q / 2)
            ctx.stroke()
          }
        } else {
          ctx.beginPath()
          ctx.arc(L.cardX, y, 2.2 * s, 0, Math.PI * 2)
          if (matched) {
            ctx.fillStyle = isSel ? pal.inkSoft : pal.inkFaint
            ctx.fill()
          } else {
            ctx.fillStyle = pal.bg
            ctx.fill()
            ctx.strokeStyle = pal.inkFaint
            ctx.lineWidth = 0.75
            ctx.stroke()
          }
        }
        // 70 / 30 divider between the two groups
        if (k === jc.nreq && k > 0) {
          ctx.globalAlpha = a * 0.6 * env
          ctx.strokeStyle = pal.inkFaint
          ctx.lineWidth = 0.75
          ctx.beginPath()
          ctx.moveTo(L.cardX - 4.5 * s, y - step / 2)
          ctx.lineTo(L.cardX + 4.5 * s, y - step / 2)
          ctx.stroke()
        }
      }

      /* --- score dial --- */
      const dr = Math.min(19 * s, L.cardH * 0.33, L.cardW * 0.2)
      const dcx = L.cardX + L.cardW - dr - 10 * s
      const dcy = cy + L.cardH / 2
      const dialT = isSel
        ? Math.min(easeOutCubic(range(p, 0.7, 0.94)), easeOutCubic(rerun.current))
        : easeOutCubic(range(p, 0.78, 0.99))

      ctx.globalAlpha = 0.45 * cardInk * env
      ctx.strokeStyle = pal.inkFaint
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(dcx, dcy, dr, dialAngle(0), dialAngle(100))
      ctx.stroke()

      // the 70 / 30 boundary on the track
      const cos70 = Math.cos(dialAngle(70))
      const sin70 = Math.sin(dialAngle(70))
      ctx.beginPath()
      ctx.moveTo(dcx + cos70 * (dr - 2.5 * s), dcy + sin70 * (dr - 2.5 * s))
      ctx.lineTo(dcx + cos70 * (dr + 3 * s), dcy + sin70 * (dr + 3 * s))
      ctx.stroke()

      if (dialT > 0.001) {
        ctx.strokeStyle = isSel ? pal.accent : pal.inkSoft
        ctx.globalAlpha = (isSel ? 1 : 0.6) * env
        if (jc.reqPart > 0) {
          ctx.lineWidth = 2 * s
          ctx.beginPath()
          ctx.arc(dcx, dcy, dr, dialAngle(0), dialAngle(jc.reqPart * dialT))
          ctx.stroke()
        }
        if (jc.prefPart > 0) {
          ctx.lineWidth = 1 * s
          ctx.beginPath()
          ctx.arc(dcx, dcy, dr, dialAngle(70), dialAngle(70 + jc.prefPart * dialT))
          ctx.stroke()
        }
        if (isSel && jc.bonus > 0 && dialT > 0.85) {
          const bx = dcx + Math.cos(dialAngle(101)) * (dr + 5 * s)
          const by = dcy + Math.sin(dialAngle(101)) * (dr + 5 * s)
          ctx.strokeStyle = pal.signal
          ctx.lineWidth = 1
          ctx.globalAlpha = range(dialT, 0.85, 1) * env
          ctx.beginPath()
          ctx.moveTo(bx - 2 * s, by)
          ctx.lineTo(bx + 2 * s, by)
          ctx.moveTo(bx, by - 2 * s)
          ctx.lineTo(bx, by + 2 * s)
          ctx.stroke()
        }

        ctx.textAlign = 'center'
        ctx.globalAlpha = (isSel ? 1 : 0.7) * env
        ctx.fillStyle = isSel ? pal.ink : pal.inkSoft
        ctx.font = mono(Math.max(8, Math.min(isSel ? 15 * s : 11 * s, dr * 0.95)))
        ctx.fillText(String(Math.round(jc.score * dialT)), dcx, dcy + 0.5)
      }
    }

    /* ---------- 6. hover readout on the lit edge ---------- */
    if (hover >= 0) {
      const pin = calc.pins[buf.idx[hover]]
      const label = pin.kind === 0 ? 'REQ' : 'PREF'
      const mx = buf.mid[hover * 2]
      const my = buf.mid[hover * 2 + 1]
      ctx.font = mono(Math.max(6, 6.4 * s))
      ctx.textAlign = 'left'
      const txt = `${pin.label} ${label} +${pin.contrib.toFixed(1)}`
      const tw = ctx.measureText(txt).width
      const bx = clamp(mx - tw / 2, 4, w - tw - 12 * s)
      const by = my - 12 * s
      ctx.globalAlpha = env
      ctx.fillStyle = pal.bg
      rrPath(ctx, bx - 4 * s, by - 6 * s, tw + 8 * s, 12 * s, 1.5 * s)
      ctx.fill()
      ctx.strokeStyle = pal.accent
      ctx.lineWidth = 0.75
      ctx.globalAlpha = 0.8 * env
      ctx.stroke()
      ctx.globalAlpha = env
      ctx.fillStyle = pal.accent
      ctx.fillText(txt, bx, by)
    }

    ctx.globalAlpha = 1
    ctx.textAlign = 'left'

    /* --- loop fade, applied as a uniform erase so no colour is faked --- */
    if (env < 1) {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.globalAlpha = 1 - env
      ctx.fillStyle = pal.ink
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
    }

    const phase = PHASES[p < 0.34 ? 0 : p < 0.5 ? 1 : p < 0.72 ? 2 : 3]
    const el = readout.current
    if (el && el.textContent !== phase) el.textContent = phase
  }

  const ref = useCanvas2D<HTMLCanvasElement>({ draw, setup })

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || interactive === false) return

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      ptr.current.x = e.clientX - r.left
      ptr.current.y = e.clientY - r.top
      ptr.current.on = true
    }
    const onLeave = () => {
      ptr.current.on = false
      if (cursor.current !== '') {
        cursor.current = ''
        canvas.style.cursor = ''
      }
    }
    const onDown = (e: PointerEvent) => {
      const L = layoutRef.current
      if (!L) return
      const r = canvas.getBoundingClientRect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top
      if (x < L.cardX - 8 * L.s || x > L.cardX + L.cardW) return
      for (let j = 0; j < JOBS.length; j += 1) {
        const cy = L.cardY0 + j * L.cardStep
        if (y >= cy && y <= cy + L.cardH) {
          rerun.current = reducedMotion ? 1 : 0
          if (j !== selRef.current) setSel(j)
          return
        }
      }
    }

    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('pointerdown', onDown)
    return () => {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('pointerdown', onDown)
    }
  }, [ref, interactive, reducedMotion])

  return (
    <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
      <canvas ref={ref} className={styles.canvas} />
      <div ref={readout} className={styles.readout} />
      {interactive !== false && (
        <div className={styles.hud}>
          {JOBS.map((j, i) => (
            <button
              key={j.title}
              type="button"
              className={styles.chip}
              data-on={i === sel}
              onClick={() => {
                rerun.current = reducedMotion ? 1 : 0
                setSel(i)
              }}
            >
              {j.title}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
