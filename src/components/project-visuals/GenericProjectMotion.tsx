'use client'

/**
 * GenericProjectMotion — the fallback motion graphic.
 *
 * Every project that has no bespoke visual is drawn here, and the drawing is
 * composed entirely from the entry's own data: nothing is hardcoded per
 * project, so two different entries cannot produce the same picture.
 *
 *   substrate   the category, as a silhouette — a page for `web`, a phone for
 *               `mobile`, a wire cube for `3d`, layer columns for `ai-ml`,
 *               bands for `data`, a module square otherwise. The same aspect
 *               ratio also shapes the ring the stack sits on, so the whole
 *               assembly takes the form of the thing being built.
 *   core        a polygon with one side per distinct technology *group*
 *               (language / framework / graphics / style / data / test /
 *               tooling), with one port tick per technology.
 *   stack ring  one node per entry in `technologies`, glyph keyed by group,
 *               arriving in listed order along its spoke and settling with
 *               overshoot. Chords between neighbours are seeded from the
 *               project id, so each project gets a stable, distinct lattice.
 *   panel       one row per `metrics` entry — a bar on a √ scale shared across
 *               that project's own numbers, and a numeral counting to the real
 *               value; the largest metric is the one thing that gets accent.
 *   ledger      one hairline per `verifiedFacts` entry, its length the weight
 *               of the claim, ticked off as the build closes.
 *
 * Timeline (clock 0..1):
 *   0.00  substrate silhouette and the hollow core — the shape, nothing in it
 *   0.33  technologies arriving along their spokes, lattice half wired
 *   0.66  stack complete; metric bars sweeping, numerals counting up
 *   1.00  every fact ticked, core locked, one accent ring closed around it all
 *
 * An entry with no technologies and no metrics — an initialised repository with
 * nothing in it — therefore draws an empty dashed ring around a bare core, and
 * an entry with 366 tests and 500 seeded users draws a full lattice with four
 * measured bars. The honesty of the frame comes from the data, not from a mode.
 *
 * Interaction: hover picks the nearest technology node — its spoke and chords
 * go accent and the readout names it; a click pins that highlight.
 *
 * Reduced motion holds clock = 1: the finished, fully measured assembly.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useCanvas2D } from '@/hooks/useCanvas2D'
import { clamp, damp, easeInOutCubic, easeOutCubic, lerp, range, seeded } from '@/lib/math'
import type { Project, ProjectCategory } from '@/content/types'
import { readPalette, type ProjectVisualProps, type VisualPalette } from './types'
import styles from './visual.module.css'

/* ---------------------------------------------------------------- constants */

const TAU = Math.PI * 2
const MAX_NODES = 12
const MAX_METRICS = 4
const MAX_FACTS = 8

/** Module-scope dash patterns — setLineDash takes an array, never build one per frame. */
const DASH: number[] = [2, 3]
const DASH_WIDE: number[] = [1.5, 4]
const NODASH: number[] = []

/** Beat boundaries on the master clock. */
const T_FRAME = 0.07
const T_NODE0 = 0.08
const T_NODE1 = 0.56
const T_MET0 = 0.5
const T_MET1 = 0.86
const T_FACT0 = 0.78
const T_FACT1 = 0.97
const T_LOCK = 0.88

/* ------------------------------------------------------------ project model */

type TechGroup = 'language' | 'framework' | 'graphics' | 'style' | 'data' | 'test' | 'tooling'

/** Ordered — the first pattern that matches wins. */
const GROUP_RULES: ReadonlyArray<readonly [RegExp, TechGroup]> = [
  [/pytest|selenium|jest|vitest|cypress|playwright|junit|testing|test/i, 'test'],
  [/webgl|webgpu|gltf|glb|three|shader|glsl|opengl|blender|canvas/i, 'graphics'],
  [/css|tailwind|bootstrap|sass|scss|styled|figma/i, 'style'],
  [/sql|postgres|mongo|redis|prisma|api|axios|graphql|pandas|numpy|firebase|supabase/i, 'data'],
  [/react|vue|angular|svelte|next|nuxt|django|flask|fastapi|express|expo|spring|laravel|node/i, 'framework'],
  [/python|javascript|typescript|html|java|kotlin|swift|rust|golang|c\+\+|c#|php|ruby/i, 'language'],
]

function classify(tech: string): TechGroup {
  for (let i = 0; i < GROUP_RULES.length; i += 1) {
    if (GROUP_RULES[i][0].test(tech)) return GROUP_RULES[i][1]
  }
  return 'tooling'
}

/** Category → the aspect the ring and the substrate are stretched to. */
const UNIT: readonly [number, number] = [1, 1]
const ASPECT: Partial<Record<ProjectCategory, readonly [number, number]>> = {
  web: [1.18, 0.74],
  mobile: [0.66, 1.14],
  '3d': [1.06, 0.92],
  'ai-ml': [1.12, 0.82],
  data: [1.2, 0.72],
  software: [1, 1],
  university: [1, 1],
  experiment: [0.98, 0.98],
  'client-work': [1.1, 0.88],
}

function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** The two names that will not survive a clip — the readout carries the rest. */
const ABBREV: Record<string, string> = { JAVASCRIPT: 'JS', TYPESCRIPT: 'TS' }

/** First token, uppercased, clipped — 'Three.js' → THREE, 'React Native' → REACT. */
function shortLabel(tech: string): string {
  const head = tech.split(/[\s.-]+/)[0] ?? ''
  const t = (head.length >= 2 ? head : tech).toUpperCase()
  return ABBREV[t] ?? (t.length > 9 ? t.slice(0, 8) : t)
}

/** Thousands separators without touching locale — SSR and client must agree. */
function groupInt(v: number): string {
  const s = String(Math.max(0, Math.round(v)))
  if (s.length <= 3) return s
  let out = ''
  for (let i = 0; i < s.length; i += 1) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ','
    out += s[i]
  }
  return out
}

function angleGap(a: number, b: number): number {
  let d = Math.abs(a - b) % TAU
  if (d > Math.PI) d = TAU - d
  return d
}

interface TechNodeSpec {
  label: string
  full: string
  group: TechGroup
  angle: number
  /** Fraction of the ring radius — inner ring sits closer to the core. */
  rad: number
}

interface EdgeSpec {
  /** -1 means the core — every technology is wired back to it. */
  a: number
  b: number
}

interface MetricRow {
  label: string
  value: string
  numeric: number | null
  /** 0..1 bar length on a √ scale against this project's own largest number. */
  norm: number
}

interface Model {
  nodes: TechNodeSpec[]
  edges: EdgeSpec[]
  metrics: MetricRow[]
  /** One weight per verified fact — longer claim, longer hairline. */
  facts: Float32Array
  factCount: number
  coreSides: number
  corePhase: number
  spin: number
  category: ProjectCategory | 'none'
  aspect: readonly [number, number]
  topMetric: number
  /** Scratch, allocated once: screen positions for hit-testing. */
  pos: Float32Array
  /** How far each node has arrived — the pointer must not grab a node that isn't there yet. */
  live: Float32Array
  focus: Float32Array
  /** Cached count-up strings so the draw loop only formats on change. */
  shown: string[]
  shownAt: Int32Array
}

function buildModel(project: Project | undefined): Model {
  const rnd = seeded(hashString(project?.id ?? 'neutral-lattice') ^ 0x9e3779b9)
  const techs = (project?.technologies ?? []).slice(0, MAX_NODES)
  const n = techs.length

  const groups = new Set<TechGroup>()
  const nodes: TechNodeSpec[] = []
  const inner = n > 6 ? Math.max(2, Math.round(n * 0.42)) : 0
  const innerPhase = rnd() * TAU
  const outerPhase = rnd() * TAU

  for (let i = 0; i < n; i += 1) {
    const group = classify(techs[i])
    groups.add(group)
    const onInner = i < inner
    const count = onInner ? inner : n - inner
    const k = onInner ? i : i - inner
    const phase = onInner ? innerPhase : outerPhase
    nodes.push({
      label: shortLabel(techs[i]),
      full: techs[i].toUpperCase(),
      group,
      angle: phase + (k / Math.max(1, count)) * TAU,
      rad: onInner ? 0.56 : inner > 0 ? 1 : 0.92,
    })
  }

  const edges: EdgeSpec[] = []
  for (let i = 0; i < n; i += 1) edges.push({ a: -1, b: i })
  for (let i = 0; i < n; i += 1) {
    const onInner = i < inner
    const start = onInner ? 0 : inner
    const count = onInner ? inner : n - inner
    if (count < 3) continue
    const j = start + ((i - start + 1) % count)
    if (rnd() > 0.42) edges.push({ a: i, b: j })
  }
  if (inner > 0) {
    for (let i = inner; i < n; i += 1) {
      let best = 0
      let bd = Infinity
      for (let j = 0; j < inner; j += 1) {
        const d = angleGap(nodes[i].angle, nodes[j].angle)
        if (d < bd) {
          bd = d
          best = j
        }
      }
      if (rnd() > 0.28) edges.push({ a: i, b: best })
    }
  }

  const raw = (project?.metrics ?? []).slice(0, MAX_METRICS)
  let maxNum = 0
  for (let i = 0; i < raw.length; i += 1) {
    const v = raw[i].numeric
    if (typeof v === 'number' && v > maxNum) maxNum = v
  }
  let topMetric = -1
  const metrics: MetricRow[] = raw.map((m, i) => {
    const numeric = typeof m.numeric === 'number' ? m.numeric : null
    if (numeric !== null && numeric === maxNum && topMetric < 0 && maxNum > 0) topMetric = i
    return {
      label: m.label.toUpperCase(),
      value: `${m.prefix ?? ''}${m.value}${m.suffix ?? ''}`,
      numeric,
      norm: numeric !== null && maxNum > 0 ? clamp(Math.sqrt(numeric) / Math.sqrt(maxNum), 0.05, 1) : 0,
    }
  })

  const rawFacts = (project?.verifiedFacts ?? []).slice(0, MAX_FACTS)
  const facts = new Float32Array(MAX_FACTS)
  for (let i = 0; i < rawFacts.length; i += 1) {
    facts[i] = clamp(rawFacts[i].length / 130, 0.24, 1)
  }

  return {
    nodes,
    edges,
    metrics,
    facts,
    factCount: rawFacts.length,
    coreSides: clamp(groups.size, 3, 8),
    corePhase: rnd() * TAU,
    spin: rnd() > 0.5 ? 1 : -1,
    category: project?.category ?? 'none',
    aspect: (project ? ASPECT[project.category] : undefined) ?? UNIT,
    topMetric,
    pos: new Float32Array(MAX_NODES * 2),
    live: new Float32Array(MAX_NODES),
    focus: new Float32Array(MAX_NODES),
    shown: new Array<string>(MAX_METRICS).fill(''),
    shownAt: new Int32Array(MAX_METRICS).fill(-1),
  }
}

/* ------------------------------------------------------------------ layout */

interface Layout {
  w: number
  h: number
  chrome: boolean
  detail: boolean
  cx: number
  cy: number
  R: number
  coreR: number
  nodeR: number
  panel: boolean
  px: number
  py: number
  pw: number
  ph: number
  rowH: number
  compactRows: boolean
  ledgerY: number
  ledgerRow: number
  maxFacts: number
  fontNano: string
  fontMicro: string
}

function computeLayout(
  w: number,
  h: number,
  chrome: boolean,
  metricCount: number,
  factCount: number,
  ax: number,
  ay: number,
): Layout {
  const padX = clamp(w * 0.055, 10, 40)
  const padTop = clamp(h * 0.08, 8, 22) + (chrome ? 16 : 0)
  const padBot = clamp(h * 0.07, 8, 20) + (chrome ? 28 : 0)
  const stageW = Math.max(40, w - padX * 2)
  const stageH = Math.max(40, h - padTop - padBot)
  const detail = w >= 330 && h >= 210
  const micro = clamp(Math.round(Math.min(w, h) * 0.032), 8, 11)
  const nano = Math.max(7, micro - 2)

  const rows = Math.min(metricCount, MAX_METRICS)
  const wide = stageW > stageH * 1.12
  const gap = clamp(stageW * 0.045, 8, 26)

  let latW = stageW
  let latH = stageH
  let px = padX
  let py = padTop
  let pw = 0
  let ph = 0
  let panel = false

  if (detail && (rows > 0 || factCount > 0)) {
    if (wide) {
      const want = clamp(stageW * 0.34, 100, 240)
      if (stageW - want - gap > 140) {
        panel = true
        pw = want
        ph = stageH
        latW = stageW - want - gap
        px = padX + latW + gap
      }
    } else if (stageH > 250) {
      const want = clamp(stageH * 0.28, 56, 130)
      panel = true
      pw = stageW
      ph = want
      latH = stageH - want - gap * 0.7
      py = padTop + latH + gap * 0.7
    }
  }

  const cx = padX + latW * 0.5
  const cy = padTop + latH * 0.5
  const room = detail ? 0.72 : 0.8
  const R = Math.max(14, Math.min((latW * 0.5) / ax, (latH * 0.5) / ay) * room)

  const rowH = rows > 0 ? clamp((ph * (factCount > 0 ? 0.6 : 0.92)) / rows, 13, 30) : 0
  const ledgerY = py + rows * rowH + (rows > 0 ? clamp(ph * 0.06, 6, 14) : 0)
  const ledgerRow = clamp(nano + 2, 8, 12)
  const maxFacts = panel
    ? Math.max(0, Math.min(factCount, MAX_FACTS, Math.floor((py + ph - ledgerY - (nano + 7)) / ledgerRow)))
    : 0

  return {
    w,
    h,
    chrome,
    detail,
    cx,
    cy,
    R,
    coreR: clamp(Math.min(latW, latH) * 0.052, 7, 20),
    nodeR: clamp(Math.min(w, h) * 0.019, 2.8, 6.5),
    panel,
    px,
    py,
    pw,
    ph,
    rowH,
    compactRows: rowH < 17,
    ledgerY,
    ledgerRow,
    maxFacts,
    fontNano: `${nano}px ui-monospace, monospace`,
    fontMicro: `${micro}px ui-monospace, monospace`,
  }
}

/* --------------------------------------------------------------- utilities */

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

function seg(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

/** The category, as a silhouette. Caller owns stroke, alpha and dash. */
function drawSubstrate(
  ctx: CanvasRenderingContext2D,
  kind: ProjectCategory | 'none',
  cx: number,
  cy: number,
  hw: number,
  hh: number,
): void {
  switch (kind) {
    case 'mobile': {
      ctx.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2)
      seg(ctx, cx - hw * 0.3, cy - hh + hh * 0.1, cx + hw * 0.3, cy - hh + hh * 0.1)
      seg(ctx, cx - hw * 0.22, cy + hh - hh * 0.08, cx + hw * 0.22, cy + hh - hh * 0.08)
      break
    }
    case '3d': {
      const o = Math.min(hw, hh) * 0.34
      const fx = cx - hw
      const fy = cy - hh + o
      const fw = hw * 2 - o
      const fh = hh * 2 - o
      ctx.strokeRect(fx, fy, fw, fh)
      ctx.strokeRect(fx + o, fy - o, fw, fh)
      seg(ctx, fx, fy, fx + o, fy - o)
      seg(ctx, fx + fw, fy, fx + fw + o, fy - o)
      seg(ctx, fx, fy + fh, fx + o, fy + fh - o)
      seg(ctx, fx + fw, fy + fh, fx + fw + o, fy + fh - o)
      break
    }
    case 'ai-ml': {
      for (let i = 0; i < 3; i += 1) {
        const x = cx + lerp(-hw * 0.72, hw * 0.72, i / 2)
        seg(ctx, x, cy - hh, x, cy + hh)
        for (let k = 0; k < 4; k += 1) {
          const y = cy + lerp(-hh * 0.72, hh * 0.72, k / 3)
          seg(ctx, x - hw * 0.05, y, x + hw * 0.05, y)
        }
      }
      break
    }
    case 'data': {
      for (let i = 0; i < 5; i += 1) {
        const y = cy + lerp(-hh * 0.8, hh * 0.8, i / 4)
        const k = 0.4 + ((i * 7) % 5) * 0.15
        seg(ctx, cx - hw, y, cx - hw + hw * 2 * clamp(k, 0.3, 1), y)
      }
      break
    }
    case 'web': {
      ctx.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2)
      seg(ctx, cx - hw, cy - hh + hh * 0.32, cx + hw, cy - hh + hh * 0.32)
      seg(ctx, cx - hw + hw * 0.5, cy - hh + hh * 0.32, cx - hw + hw * 0.5, cy + hh)
      break
    }
    default: {
      ctx.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2)
      seg(ctx, cx - hw, cy, cx + hw, cy)
      seg(ctx, cx, cy - hh, cx, cy + hh)
      break
    }
  }
}

/** One technology, drawn as its group. Caller owns stroke, fill and alpha. */
function glyph(ctx: CanvasRenderingContext2D, group: TechGroup, x: number, y: number, s: number): void {
  switch (group) {
    case 'language':
      ctx.fillRect(x - s, y - s, s * 2, s * 2)
      break
    case 'tooling':
      ctx.strokeRect(x - s, y - s, s * 2, s * 2)
      break
    case 'framework':
      ctx.beginPath()
      ctx.arc(x, y, s, 0, TAU)
      ctx.stroke()
      break
    case 'graphics':
      ctx.beginPath()
      ctx.moveTo(x, y - s * 1.2)
      ctx.lineTo(x + s * 1.1, y + s * 0.72)
      ctx.lineTo(x - s * 1.1, y + s * 0.72)
      ctx.closePath()
      ctx.stroke()
      break
    case 'style':
      ctx.beginPath()
      ctx.moveTo(x, y - s * 1.25)
      ctx.lineTo(x + s * 1.25, y)
      ctx.lineTo(x, y + s * 1.25)
      ctx.lineTo(x - s * 1.25, y)
      ctx.closePath()
      ctx.stroke()
      break
    case 'data':
      ctx.beginPath()
      ctx.moveTo(x - s, y - s * 0.6)
      ctx.lineTo(x + s, y - s * 0.6)
      ctx.moveTo(x - s, y + s * 0.1)
      ctx.lineTo(x + s * 0.35, y + s * 0.1)
      ctx.moveTo(x - s, y + s * 0.8)
      ctx.lineTo(x + s * 0.75, y + s * 0.8)
      ctx.stroke()
      break
    case 'test':
      ctx.beginPath()
      ctx.moveTo(x - s * 1.1, y)
      ctx.lineTo(x + s * 1.1, y)
      ctx.moveTo(x, y - s * 1.1)
      ctx.lineTo(x, y + s * 1.1)
      ctx.stroke()
      break
  }
}

function polyPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  sides: number,
  phase: number,
): void {
  ctx.beginPath()
  for (let i = 0; i < sides; i += 1) {
    const a = phase + (i / sides) * TAU
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

/* ------------------------------------------------------------- the component */

export function GenericProjectMotion(props: ProjectVisualProps) {
  const { project, progress, reducedMotion = false, interactive = true, className } = props
  const chrome = interactive !== false

  const model = useMemo(() => buildModel(project), [project])
  const period = useMemo(
    () => clamp((project?.presentation.duration ?? 14) * 0.8, 7, 18),
    [project],
  )

  const catLabel = (project?.category ?? 'project').replace(/-/g, ' ').toUpperCase()
  const titleLabel = (project?.shortTitle ?? project?.title ?? 'PROJECT').toUpperCase()
  const top = model.topMetric >= 0 ? model.metrics[model.topMetric] : null

  const [focusName, setFocusName] = useState('')

  const layoutRef = useRef<Layout | null>(null)
  const paletteRef = useRef<VisualPalette | null>(null)
  const paletteAtRef = useRef(-1)
  const clockRef = useRef(reducedMotion ? 1 : 0)
  const loopRef = useRef(0)
  const hoverRef = useRef(-1)
  const pinRef = useRef(-1)
  const firstRef = useRef(true)
  const dirtyRef = useRef(true)
  const nameRef = useRef('')

  const ref = useCanvas2D<HTMLCanvasElement>({
    setup: ({ ctx, w, h }) => {
      layoutRef.current = computeLayout(
        w, h, chrome, model.metrics.length, model.factCount, model.aspect[0], model.aspect[1],
      )
      paletteRef.current = readPalette(ctx.canvas)
      paletteAtRef.current = -1
      firstRef.current = true
      dirtyRef.current = true
    },

    draw: ({ ctx, w, h, t, dt }) => {
      let layout = layoutRef.current
      if (!layout || layout.w !== w || layout.h !== h || layout.chrome !== chrome) {
        layout = computeLayout(
          w, h, chrome, model.metrics.length, model.factCount, model.aspect[0], model.aspect[1],
        )
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
      const { ink, inkSoft, inkFaint, accent, signal } = palette

      /* ---- master clock -------------------------------------------------- */

      let clock: number
      if (reducedMotion) {
        clock = 1
      } else if (typeof progress === 'number') {
        const target = clamp(progress)
        clock = firstRef.current ? target : damp(clockRef.current, target, 12, dt)
      } else {
        // The last 14 % of the loop holds the finished frame before restarting.
        let u = loopRef.current + dt / period
        if (u >= 1) u -= 1
        loopRef.current = u
        clock = clamp(u / 0.86)
      }
      clockRef.current = clock

      if (reducedMotion && !dirtyRef.current) return

      const { cx, cy, R, coreR, nodeR } = layout
      const [ax, ay] = model.aspect
      const n = model.nodes.length
      const frame = range(clock, 0, T_FRAME)
      const lock = easeOutCubic(range(clock, T_LOCK, 1))

      const span = n > 0 ? Math.min(0.15, ((T_NODE1 - T_NODE0) / n) * 1.9) : 0
      const step = n > 1 ? (T_NODE1 - T_NODE0 - span) / (n - 1) : 0

      const focusIdx = pinRef.current >= 0 ? pinRef.current : hoverRef.current

      ctx.clearRect(0, 0, w, h)
      ctx.lineJoin = 'round'
      ctx.lineCap = 'butt'
      ctx.setLineDash(NODASH)

      /* ---- substrate: the category, behind everything --------------------- */

      ctx.globalAlpha = (0.2 + 0.8 * frame) * 0.3
      ctx.strokeStyle = inkFaint
      ctx.lineWidth = 0.75
      ctx.setLineDash(DASH_WIDE)
      drawSubstrate(ctx, model.category, cx, cy, R * ax * 0.8, R * ay * 0.8)
      ctx.setLineDash(NODASH)

      /* ---- node positions -------------------------------------------------- */

      // Written into the model's scratch buffer so the pointer handler can
      // hit-test against exactly what is on screen.
      for (let i = 0; i < n; i += 1) {
        const node = model.nodes[i]
        const s0 = T_NODE0 + i * step
        const p = easeOutCubic(range(clock, s0, s0 + span))
        // Launch, overshoot, settle — the spoke pushes it out and it eases back.
        const grow = p + 0.07 * Math.sin(p * Math.PI)
        const rr = R * node.rad * lerp(0.14, 1, grow)
        model.pos[i * 2] = cx + Math.cos(node.angle) * rr * ax
        model.pos[i * 2 + 1] = cy + Math.sin(node.angle) * rr * ay
        model.live[i] = p
      }

      /* ---- edges ----------------------------------------------------------- */

      for (let e = 0; e < model.edges.length; e += 1) {
        const edge = model.edges[e]
        const bEnd = T_NODE0 + edge.b * step + span
        const bx = model.pos[edge.b * 2]
        const by = model.pos[edge.b * 2 + 1]

        if (edge.a < 0) {
          // The spoke always reaches its node — the node's own easing is what
          // reads as growth, so the line must not lag behind it.
          const p = range(clock, T_NODE0 + edge.b * step, bEnd)
          if (p <= 0.01) continue
          const a = model.nodes[edge.b].angle
          const sx = cx + Math.cos(a) * coreR * 1.05
          const sy = cy + Math.sin(a) * coreR * 1.05
          const f = model.focus[edge.b]
          ctx.globalAlpha = p * (0.28 + f * 0.6)
          ctx.strokeStyle = f > 0.04 ? accent : inkFaint
          ctx.lineWidth = f > 0.04 ? 1.1 : 0.75
          seg(ctx, sx, sy, bx, by)
          continue
        }

        const aEnd = T_NODE0 + edge.a * step + span
        const t0 = Math.max(aEnd, bEnd)
        const p = easeInOutCubic(range(clock, t0, t0 + 0.07))
        if (p <= 0.01) continue
        const axx = model.pos[edge.a * 2]
        const ayy = model.pos[edge.a * 2 + 1]
        const f = Math.max(model.focus[edge.a], model.focus[edge.b])
        ctx.globalAlpha = p * (0.2 + f * 0.55)
        ctx.strokeStyle = f > 0.04 ? accent : inkFaint
        ctx.lineWidth = 0.75
        seg(ctx, axx, ayy, lerp(axx, bx, p), lerp(ayy, by, p))
      }

      /* ---- the core -------------------------------------------------------- */

      const spinAmt = reducedMotion ? 0 : t * 0.045 * model.spin * (1 - lock * 0.85)
      const phase = model.corePhase + spinAmt

      // Port ticks: one per technology, on the core boundary at its own angle.
      ctx.globalAlpha = frame * 0.5
      ctx.strokeStyle = inkFaint
      ctx.lineWidth = 0.75
      for (let i = 0; i < n; i += 1) {
        const a = model.nodes[i].angle
        const s0 = T_NODE0 + i * step
        const live = range(clock, s0 - 0.02, s0 + 0.04)
        ctx.globalAlpha = frame * (0.28 + live * 0.5)
        seg(
          ctx,
          cx + Math.cos(a) * coreR * 0.86,
          cy + Math.sin(a) * coreR * 0.86,
          cx + Math.cos(a) * coreR * 1.14,
          cy + Math.sin(a) * coreR * 1.14,
        )
      }

      if (lock > 0.02) {
        ctx.globalAlpha = lock * 0.12
        ctx.fillStyle = accent
        polyPath(ctx, cx, cy, coreR, model.coreSides, phase)
        ctx.fill()
      }
      ctx.globalAlpha = frame * (0.45 + lock * 0.5)
      ctx.strokeStyle = lock > 0.5 ? accent : inkSoft
      ctx.lineWidth = lock > 0.5 ? 1.25 : 0.9
      ctx.setLineDash(lock > 0.5 ? NODASH : DASH)
      polyPath(ctx, cx, cy, coreR, model.coreSides, phase)
      ctx.stroke()
      ctx.setLineDash(NODASH)

      // Nothing to assemble — an empty repository reads as an empty ring.
      if (n === 0) {
        ctx.globalAlpha = frame * 0.28
        ctx.strokeStyle = inkFaint
        ctx.lineWidth = 0.75
        ctx.setLineDash(DASH)
        ctx.beginPath()
        ctx.ellipse(cx, cy, R * ax * 0.55, R * ay * 0.55, 0, 0, TAU)
        ctx.stroke()
        ctx.setLineDash(NODASH)
      }

      /* ---- technology nodes ------------------------------------------------ */

      ctx.font = layout.fontNano
      ctx.textBaseline = 'middle'
      for (let i = 0; i < n; i += 1) {
        const node = model.nodes[i]
        const s0 = T_NODE0 + i * step
        const p = easeOutCubic(range(clock, s0, s0 + span))
        if (p <= 0.01) continue

        const x = model.pos[i * 2]
        const y = model.pos[i * 2 + 1]
        const fresh = 1 - range(clock, s0 + span, s0 + span + 0.06)
        const want = i === focusIdx ? 1 : 0
        // Reduced motion draws single frames, so there is no ramp to damp along.
        const f = reducedMotion ? want : damp(model.focus[i], want, 11, dt)
        model.focus[i] = f
        const hot = Math.max(fresh, f)
        const s = nodeR * (0.45 + 0.55 * p) * (1 + f * 0.22)

        ctx.globalAlpha = p * (0.66 + hot * 0.34)
        ctx.strokeStyle = hot > 0.05 ? accent : inkSoft
        ctx.fillStyle = hot > 0.05 ? accent : inkSoft
        ctx.lineWidth = hot > 0.5 ? 1.15 : 0.9
        glyph(ctx, node.group, x, y, s)

        if (hot > 0.05) {
          ctx.globalAlpha = p * hot * 0.55
          ctx.strokeStyle = accent
          ctx.lineWidth = 0.75
          ctx.beginPath()
          ctx.arc(x, y, s * 2.5 + (1 - hot) * 4, 0, TAU)
          ctx.stroke()
        }

        if (!layout.detail && f < 0.5) continue
        const right = Math.cos(node.angle) >= -0.15
        ctx.globalAlpha = p * (0.34 + f * 0.62)
        ctx.fillStyle = f > 0.05 ? accent : inkFaint
        ctx.textAlign = right ? 'left' : 'right'
        ctx.fillText(node.label, x + (right ? s + 5 : -s - 5), y)
      }

      /* ---- the lock ring: the assembly closes ------------------------------ */

      if (lock > 0.01) {
        ctx.globalAlpha = lock * 0.45
        ctx.strokeStyle = accent
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.ellipse(cx, cy, R * ax * 1.16, R * ay * 1.16, 0, -Math.PI / 2, -Math.PI / 2 + TAU * lock)
        ctx.stroke()
      }

      /* ---- the panel: metrics, then the fact ledger ------------------------- */

      if (layout.panel) {
        const x0 = layout.px
        const x1 = layout.px + layout.pw
        const rows = model.metrics.length
        const mSpan = rows > 0 ? Math.min(0.2, ((T_MET1 - T_MET0) / rows) * 1.7) : 0
        const mStep = rows > 1 ? (T_MET1 - T_MET0 - mSpan) / (rows - 1) : 0

        for (let j = 0; j < rows; j += 1) {
          const m = model.metrics[j]
          const p = easeOutCubic(range(clock, T_MET0 + j * mStep, T_MET0 + j * mStep + mSpan))
          if (p <= 0.005) continue
          const isTop = j === model.topMetric
          const yTop = layout.py + j * layout.rowH
          const yText = yTop + (layout.compactRows ? layout.rowH * 0.5 : layout.rowH * 0.36)

          ctx.globalAlpha = p * 0.5
          ctx.fillStyle = inkFaint
          ctx.font = layout.fontNano
          ctx.textAlign = 'left'
          ctx.textBaseline = 'middle'
          ctx.fillText(m.label, x0, yText)

          // Count to the real number; land on the entry's own formatting.
          let text = m.value
          if (m.numeric !== null && p < 0.999) {
            const v = Math.round(m.numeric * p)
            if (model.shownAt[j] !== v) {
              model.shownAt[j] = v
              model.shown[j] = groupInt(v)
            }
            text = model.shown[j]
          }
          ctx.globalAlpha = p * (isTop ? 1 : 0.85)
          ctx.fillStyle = isTop ? accent : ink
          ctx.font = layout.fontMicro
          ctx.textAlign = 'right'
          ctx.fillText(text, x1, yText)

          if (layout.compactRows || m.numeric === null) continue
          const yBar = yTop + layout.rowH * 0.76
          ctx.globalAlpha = p * 0.22
          ctx.strokeStyle = inkFaint
          ctx.lineWidth = 0.75
          seg(ctx, x0, yBar, x1, yBar)
          ctx.globalAlpha = p * (isTop ? 0.95 : 0.6)
          ctx.strokeStyle = isTop ? accent : inkSoft
          ctx.lineWidth = isTop ? 1.4 : 1
          seg(ctx, x0, yBar, x0 + (x1 - x0) * m.norm * p, yBar)
        }

        if (layout.maxFacts > 0) {
          const shownFacts = layout.maxFacts
          const fSpan = Math.min(0.12, ((T_FACT1 - T_FACT0) / shownFacts) * 2.2)
          const fStep = shownFacts > 1 ? (T_FACT1 - T_FACT0 - fSpan) / (shownFacts - 1) : 0
          let done = 0

          ctx.font = layout.fontNano
          ctx.textBaseline = 'middle'
          for (let k = 0; k < shownFacts; k += 1) {
            const p = easeOutCubic(range(clock, T_FACT0 + k * fStep, T_FACT0 + k * fStep + fSpan))
            const y = layout.ledgerY + (k + 0.5) * layout.ledgerRow
            const box = layout.ledgerRow * 0.3
            const ticked = p > 0.6
            if (ticked) done += 1

            ctx.globalAlpha = 0.3 + p * 0.4
            ctx.strokeStyle = ticked ? signal : inkFaint
            ctx.lineWidth = 0.75
            ctx.strokeRect(x0, y - box, box * 2, box * 2)
            if (ticked) {
              ctx.globalAlpha = 0.8
              ctx.fillStyle = signal
              ctx.fillRect(x0 + box * 0.55, y - box * 0.45, box * 0.9, box * 0.9)
            }

            ctx.globalAlpha = p * 0.32
            ctx.strokeStyle = inkFaint
            const lx = x0 + box * 2 + 5
            seg(ctx, lx, y, lx + (x1 - lx) * model.facts[k] * p, y)
          }

          // The ledger may not have room for every fact — report the real total.
          const counted = Math.round((done / shownFacts) * model.factCount)
          const yFoot = layout.ledgerY + shownFacts * layout.ledgerRow + 4
          ctx.globalAlpha = 0.42
          ctx.fillStyle = inkFaint
          ctx.textAlign = 'left'
          ctx.textBaseline = 'top'
          ctx.fillText('VERIFIED', x0, yFoot)
          ctx.textAlign = 'right'
          ctx.fillText(`${counted}/${model.factCount}`, x1, yFoot)
        }
      }

      ctx.globalAlpha = 1

      /* ---- readout: the inspected technology, named ------------------------- */

      const name = focusIdx >= 0 && focusIdx < n ? model.nodes[focusIdx].full : ''
      if (nameRef.current !== name) {
        nameRef.current = name
        setFocusName(name)
      }

      firstRef.current = false
      dirtyRef.current = false
    },
  })

  /* ---- interaction: hover to inspect a node, click to pin it -------------- */

  useEffect(() => {
    if (!chrome) return
    const canvas = ref.current
    if (!canvas) return

    const pick = (e: PointerEvent): number => {
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const reach = Math.max(18, Math.min(rect.width, rect.height) * 0.12)
      let best = -1
      let bd = reach * reach
      for (let i = 0; i < model.nodes.length; i += 1) {
        if (model.live[i] < 0.5) continue
        const dx = model.pos[i * 2] - mx
        const dy = model.pos[i * 2 + 1] - my
        const d = dx * dx + dy * dy
        if (d < bd) {
          bd = d
          best = i
        }
      }
      return best
    }

    const onMove = (e: PointerEvent) => {
      const next = pick(e)
      if (next !== hoverRef.current) {
        hoverRef.current = next
        dirtyRef.current = true
      }
    }
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const hit = pick(e)
      pinRef.current = hit >= 0 && hit === pinRef.current ? -1 : hit
      dirtyRef.current = true
    }
    const onLeave = () => {
      hoverRef.current = -1
      dirtyRef.current = true
    }

    canvas.style.cursor = 'crosshair'
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerleave', onLeave)

    return () => {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.style.cursor = 'default'
    }
  }, [ref, chrome, model])

  const replay = () => {
    loopRef.current = 0
    clockRef.current = 0
    firstRef.current = true
    dirtyRef.current = true
  }

  return (
    <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
      <canvas ref={ref} className={styles.canvas} />
      {chrome && (
        <div className={styles.readout} aria-hidden="true">
          {focusName || titleLabel}
          <br />
          {model.nodes.length} TECH · {model.factCount} FACT{model.factCount === 1 ? '' : 'S'}
        </div>
      )}
      {chrome && (
        <div className={styles.hud}>
          {progress === undefined && !reducedMotion && (
            <button
              type="button"
              className={styles.chip}
              style={{ cursor: 'pointer' }}
              onClick={replay}
              aria-label="Replay the assembly"
            >
              REPLAY
            </button>
          )}
          <span className={styles.chip}>{catLabel}</span>
          {project?.year && <span className={styles.chip}>{project.year}</span>}
          {top && (
            <span className={styles.chip} data-on="true">
              {top.value} {top.label}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
