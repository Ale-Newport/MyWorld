'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'
import type { SiteContent } from '@/cms/derive'
import { clamp, range } from '@/lib/math'
import type { SectionAnimationProps } from '../types'
import { easeOut, journeyMilestones, textWidth, useBoxSize, useTicker, type Milestone, type Size } from './shared'
import styles from './JourneyRibbon.module.css'

/* ============================================================
   JOURNEY RIBBON — the section's default

   A paper banderole threads the box from where the story starts
   (the "from" half of every through-line: Spain, KCL, software…)
   to where it is going (the "to" half), passing the real
   milestones in the order they began: each university and each
   role, with its own dates. The band has a lit face and a shaded
   one; in every other stretch it twists over and shows its back,
   and the intensity knob decides how far it folds.

   Scroll unrolls it from its tail and every milestone settles onto
   the band as the band reaches it. The only clock is a slow breath
   in the twist, which `speed` scales.

   The band is Canvas2D (one gradient per run of a face, so no
   seams); the words are DOM, crisp and in the site's own faces.
   ============================================================ */

type Kind = 'from' | 'to' | 'study' | 'work'
type Side = 'left' | 'right' | 'above' | 'below'

interface Station {
  key: string
  kind: Kind
  m?: Milestone
  /** Bookends: the through-line words, packed into lines. */
  lines?: string[]
  /** Milestones: 0 pin only · 1 year and title on one line · 2 date over title · 3 date, title, detail. */
  mode: number
  /** Lines the detail wraps to (1–2). */
  dl: number
  side: Side
  x: number
  y: number
  lx: number
  ly: number
  lw: number
  lh: number
  align: 'left' | 'right'
  /** The progress at which the band reaches it. */
  at: number
}

interface Layout {
  w: number
  h: number
  band: number
  type: { title: number; mono: number; detail: number }
  n: number
  x: Float32Array
  y: Float32Array
  nx: Float32Array
  ny: Float32Array
  s: Float32Array
  /** Per sample: the stretch between two stations it lies in, and how far along it. */
  gap: Uint16Array
  v: Float32Array
  len: number
  fold: number[]
  stations: Station[]
  /** Sample index of each station. */
  index: number[]
}

/* ---- timing --------------------------------------------------------- */

const HEAD_FROM = 0.03
const HEAD_TO = 0.6
const headOf = (p: number) => 0.5 - 0.5 * Math.cos(Math.PI * range(p, HEAD_FROM, HEAD_TO))
/** The progress at which the head reaches arc fraction u (the inverse of headOf). */
const reach = (u: number) => HEAD_FROM + (HEAD_TO - HEAD_FROM) * (Math.acos(clamp(1 - 2 * u, -1, 1)) / Math.PI)
const settle = (st: Station, p: number) => (st.kind === 'from' ? easeOut(range(p, 0, 0.07)) : easeOut(range(p, st.at - 0.012, st.at + 0.07)))

/* ---- type ----------------------------------------------------------- */

function scale({ w, h }: Size) {
  const m = Math.min(w, h * 1.25)
  const k = m >= 860 ? 3 : m >= 560 ? 2 : m >= 360 ? 1 : 0
  return {
    type: { title: [13, 15, 17, 20][k], mono: [9.5, 10, 10.5, 11][k], detail: [11.5, 12, 12.5, 13][k] },
    band: [13, 18, 26, 32][k],
  }
}

const LH = { mono: 1.5, title: 1.2, detail: 1.34, words: 1.7 }
const GAP = 2
const MONO = { mono: true, tracking: 0.18 }

function labelHeight(mode: number, dl: number, t: Layout['type']) {
  const mono = t.mono * LH.mono
  const title = t.title * LH.title
  if (mode === 3) return mono + title + dl * t.detail * LH.detail + GAP * 2
  if (mode === 2) return mono + title + GAP
  if (mode === 1) return Math.max(mono, title)
  return 0
}

const dateOf = (m: Milestone, mode: number) => (mode === 1 ? m.year : m.when || m.year)

function labelWidth(m: Milestone, mode: number, t: Layout['type']) {
  const date = textWidth(dateOf(m, mode).toUpperCase(), t.mono, MONO)
  const title = textWidth(m.title, t.title, { weight: 500, tracking: -0.015 })
  if (mode === 1) return date + t.title * 0.55 + title
  return Math.max(date, title)
}

/**
 * The through-line words as lines: one per line, or (`packed`) as many
 * per line as fit `width`, joined by a middle dot. A phrase too long for
 * the width wraps at its spaces; a single word longer than the width
 * keeps its own line and is cut with an ellipsis by the stylesheet.
 */
function pack(words: string[], width: number, mono: number, packed: boolean): string[] {
  const fits = (t: string) => textWidth(t.toUpperCase(), mono, MONO) <= width
  const lines: string[] = []
  for (const phrase of words) {
    const prev = lines[lines.length - 1]
    if (packed && prev && fits(`${prev} · ${phrase}`)) {
      lines[lines.length - 1] = `${prev} · ${phrase}`
      continue
    }
    if (fits(phrase)) {
      lines.push(phrase)
      continue
    }
    let line = ''
    for (const word of phrase.split(/\s+/)) {
      if (line && !fits(`${line} ${word}`)) {
        lines.push(line)
        line = word
      } else line = line ? `${line} ${word}` : word
    }
    if (line) lines.push(line)
  }
  return lines
}
const linesWidth = (lines: string[], mono: number) => lines.reduce((a, l) => Math.max(a, textWidth(l.toUpperCase(), mono, MONO)), 0)

/** The lowest and highest value the spine takes over [a, b] (fractions of its run, clamped to it). */
function sweep(spine: (f: number) => number, a: number, b: number): [number, number] {
  const f0 = clamp(Math.min(a, b))
  const f1 = clamp(Math.max(a, b))
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i <= 12; i++) {
    const v = spine(f0 + ((f1 - f0) * i) / 12)
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  return [lo, hi]
}

/* ---- composition ---------------------------------------------------- */

interface Try { words: number; packed: boolean; mode: number; thin: boolean }

function compose(size: Size, site: SiteContent): Layout | null {
  if (size.w < 60 || size.h < 60) return null
  const markers = site.profile.markers.map((m) => ({ from: (m.from ?? '').trim(), to: (m.to ?? '').trim() })).filter((m) => m.from && m.to)
  const from = markers.map((m) => m.from)
  const to = markers.map((m) => m.to)
  const milestones = journeyMilestones(site)
  // Nothing to thread: no ribbon at all rather than a band with nothing on it.
  if (!milestones.length && !from.length) return null
  const all = from.length
  /* Richest first: every through-line word on its own line and every
     milestone with its detail; then packed words, shorter labels,
     fewer words, and finally labels on every other milestone only. */
  const tries: Try[] = []
  for (const mode of [3, 2]) for (const packed of [false, true]) tries.push({ words: all, packed, mode, thin: false })
  tries.push({ words: all, packed: true, mode: 1, thin: false })
  for (let words = all - 1; words >= 1; words--) for (const mode of [2, 1]) tries.push({ words, packed: true, mode, thin: false })
  if (all) for (const mode of [3, 2, 1]) tries.push({ words: 0, packed: true, mode, thin: false })
  tries.push({ words: Math.min(all, 2), packed: true, mode: 1, thin: true }, { words: 0, packed: true, mode: 1, thin: true }, { words: 0, packed: true, mode: 0, thin: true })
  for (const t of tries) {
    const out = place(size, milestones, from.slice(0, t.words), to.slice(0, t.words), t)
    if (out) return out
  }
  return null
}

function place(size: Size, milestones: Milestone[], from: string[], to: string[], opt: Try): Layout | null {
  const { w, h } = size
  const { type, band } = scale(size)
  const horizontal = w / h >= 1.3 || (h < 240 && w > h)
  const padX = clamp(w * 0.035, 8, 26)
  const padY = clamp(h * 0.045, 6, 22)
  const gapX = clamp(band * 0.62, 9, 20)
  const wordsH = (lines: string[]) => lines.length * type.mono * LH.words

  const list: Station[] = []
  const base = { mode: 0, dl: 1, side: 'right' as Side, x: 0, y: 0, lx: 0, ly: 0, lw: 0, lh: 0, align: 'left' as const, at: 0 }
  list.push({ ...base, key: 'from', kind: 'from', lines: from })
  milestones.forEach((m, i) => {
    const labelled = !opt.thin || i === 0 || i === milestones.length - 1 || i % 2 === 0
    list.push({ ...base, key: m.key, kind: m.kind, m, mode: labelled ? opt.mode : 0 })
  })
  list.push({ ...base, key: 'to', kind: 'to', lines: to })
  const S = list.length
  /* The spine: a slow sine, a swing and a half for a short story and a
     little more for a long one, so it reads as one loose ribbon. */
  const PHI = Math.PI * (1.5 + Math.max(0, S - 8) * 0.12)
  let spine: (f: number) => number
  let A0 = 0
  let A1 = 1

  if (!horizontal) {
    /* Down the box. Wide enough, the labels alternate either side of
       the band; otherwise they all sit to its right. */
    const alternate = w >= 520
    const amp = alternate ? clamp(w * 0.1, 18, 96) : clamp(w * 0.03, 5, 16)
    const cx = alternate ? w * 0.5 : padX + clamp(w * 0.07, 14, 40) + amp
    spine = (f) => cx + amp * Math.sin(f * PHI)
    // Sides: the "from" words left of the tail, then alternating; the "to" words opposite the last.
    for (const [i, st] of list.entries()) {
      if (!alternate) st.side = 'right'
      else if (i === 0) st.side = 'left'
      else if (i === S - 1) st.side = S > 2 && list[S - 2].side === 'right' ? 'left' : 'right'
      else st.side = i % 2 === 1 ? 'right' : 'left'
      st.align = st.side === 'left' ? 'right' : 'left'
      // Room on its side wherever the band swings (its widest swing toward the label).
      const reachX = st.side === 'left' ? cx - amp : cx + amp
      st.lw = st.side === 'left' ? reachX - band / 2 - gapX - padX : w - padX - (reachX + band / 2 + gapX)
      // The tail starts on the centre line and swings away from the "from" words.
      if (i === 0 && alternate) st.lw = cx - band / 2 - gapX - padX
      if (st.lines) {
        st.lines = pack(st.lines, st.lw, type.mono, opt.packed)
        st.lh = wordsH(st.lines)
      } else {
        if (st.mode === 3) st.dl = textWidth(st.m!.detail, type.detail) > st.lw ? 2 : 1
        st.lh = labelHeight(st.mode, st.dl, type)
      }
      if ((st.lines ? st.lines.length : st.mode) && st.lw < Math.min(96, w * 0.3)) return null
    }
    const minStep = band * 1.15 + (alternate ? 10 : 4)
    const sameGap = clamp(h * 0.026, 6, 18)
    const y: number[] = []
    for (let i = 0; i < S; i++) {
      const hi = list[i].lh
      let v = i === 0 ? padY + hi / 2 : y[i - 1] + minStep
      for (let j = i - 1; j >= 0; j--) {
        if (list[j].side !== list[i].side) continue
        v = Math.max(v, y[j] + list[j].lh / 2 + sameGap + hi / 2)
        break
      }
      y.push(v)
    }
    const bottom = h - padY
    if (Math.max(...y.map((v, i) => v + list[i].lh / 2)) > bottom + 0.5) return null
    // Stretch the spacing over the height, short of a sparse ladder: a short story stays a short ribbon.
    const most = clamp(h * 0.3, 90, 230) * (S - 1)
    let k = Math.min(h * 0.92, most) / Math.max(1, y[S - 1] - y[0])
    for (let i = 1; i < S; i++) k = Math.min(k, (bottom - list[i].lh / 2 - y[0]) / Math.max(1, y[i] - y[0]))
    k = Math.max(1, k)
    const lo = Math.min(...y.map((v, i) => y[0] + (v - y[0]) * k - list[i].lh / 2))
    const hi = Math.max(...y.map((v, i) => y[0] + (v - y[0]) * k + list[i].lh / 2))
    const shift = Math.max(0, (h - (hi - lo)) / 2 - lo)
    list.forEach((st, i) => {
      st.y = y[0] + (y[i] - y[0]) * k + shift
    })
    A0 = list[0].y
    A1 = list[S - 1].y
    const span = Math.max(1, A1 - A0)
    for (const st of list) {
      st.x = spine((st.y - A0) / span)
      st.ly = clamp(st.y - st.lh / 2, 2, h - 2 - st.lh)
      // Clear the band wherever it swings beside the label's lines, not only at its pin.
      const [lo, hi] = sweep(spine, (st.ly - A0) / span, (st.ly + st.lh - A0) / span)
      st.lx = st.side === 'left' ? padX : Math.max(st.x, hi) + band / 2 + gapX
      st.lw = st.side === 'left' ? Math.min(st.x, lo) - band / 2 - gapX - padX : w - padX - st.lx
      if ((st.lines ? st.lines.length : st.mode) && st.lw < Math.min(90, w * 0.26)) return null
    }
  } else {
    /* Across the box: the "from" words on the left, the "to" words on
       the right, the milestones alternating above and below the band. */
    const cy = h * 0.5
    const amp = clamp(h * 0.12, 4, 96)
    spine = (f) => cy - amp * Math.sin(f * PHI)
    const target = Math.max(70, w * 0.2)
    const first = list[0]
    const last = list[S - 1]
    first.lines = pack(first.lines!, target, type.mono, opt.packed)
    last.lines = pack(last.lines!, target, type.mono, opt.packed)
    const fromW = first.lines.length ? Math.min(target * 1.4, linesWidth(first.lines, type.mono)) : 0
    const toW = last.lines.length ? Math.min(target * 1.4, linesWidth(last.lines, type.mono)) : 0
    const x0 = padX + (fromW ? fromW + gapX : band)
    const x1 = w - padX - (toW ? toW + gapX : band)
    if (x1 - x0 < Math.min(140, w * 0.4)) return null
    const maxLabel = Math.max(64, (x1 - x0) * (S > 4 ? 0.36 : 0.6))
    const lead = 4
    for (const [i, st] of list.entries()) {
      if (st.lines) {
        st.side = i === 0 ? 'left' : 'right'
        st.align = i === 0 ? 'right' : 'left'
        st.lh = wordsH(st.lines)
        st.lw = i === 0 ? fromW : toW
        if (st.lh > h - 8) return null
        continue
      }
      st.side = i % 2 === 1 ? 'above' : 'below'
      const natural = st.mode ? labelWidth(st.m!, st.mode, type) : 0
      if (st.mode === 3) st.dl = textWidth(st.m!.detail, type.detail) > maxLabel ? 2 : 1
      st.lw = st.mode ? Math.min(maxLabel, Math.max(natural, st.mode === 3 ? Math.min(maxLabel, textWidth(st.m!.detail, type.detail)) : 0) + 2) : 0
      st.lh = labelHeight(st.mode, st.dl, type)
    }
    const minStep = Math.max(band * 1.5, 22)
    const xs: number[] = [x0]
    for (let i = 1; i < S; i++) {
      let v = xs[i - 1] + minStep
      if (i < S - 1 && i > 2) v = Math.max(v, xs[i - 2] + list[i - 2].lw + gapX * 0.9)
      if (i === S - 1) for (let j = Math.max(1, S - 3); j < S - 1; j++) v = Math.max(v, xs[j] - lead + list[j].lw + gapX * 0.6)
      xs.push(v)
    }
    if (xs[S - 1] > x1 + 0.5) return null
    const k = (x1 - x0) / Math.max(1, xs[S - 1] - x0)
    A0 = x0
    A1 = x1
    const span = Math.max(1, A1 - A0)
    for (const [i, st] of list.entries()) {
      st.x = x0 + (xs[i] - x0) * k
      st.y = spine((st.x - A0) / span)
      if (i === 0) {
        st.lx = padX
        st.lw = Math.max(1, st.x - gapX - padX)
        st.ly = st.y - st.lh / 2
      } else if (i === S - 1) {
        st.lx = st.x + gapX
        st.lw = Math.max(1, w - padX - st.lx)
        st.ly = st.y - st.lh / 2
      } else {
        st.lx = st.x - lead
        // Clear the band under the label's whole width, not only at its pin.
        const [lo, hi] = sweep(spine, (st.lx - A0) / span, (st.lx + st.lw - A0) / span)
        st.ly = st.side === 'above' ? Math.min(st.y, lo) - band / 2 - gapX * 0.7 - st.lh : Math.max(st.y, hi) + band / 2 + gapX * 0.7
        if (st.mode && (st.ly < 1 || st.ly + st.lh > h - 1)) return null
      }
      st.ly = clamp(st.ly, 1, h - 1 - st.lh)
    }
  }

  /* Sample the spine densely: positions, normals, arc length. */
  const steps = Math.max(32, Math.ceil(Math.abs(A1 - A0) / 2.5))
  const n = steps + 1
  const x = new Float32Array(n)
  const y = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const f = i / steps
    const a = A0 + (A1 - A0) * f
    if (horizontal) {
      x[i] = a
      y[i] = spine(f)
    } else {
      x[i] = spine(f)
      y[i] = a
    }
  }
  const nx = new Float32Array(n)
  const ny = new Float32Array(n)
  const s = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1)
    const i1 = Math.min(n - 1, i + 1)
    const tx = x[i1] - x[i0]
    const ty = y[i1] - y[i0]
    const l = Math.hypot(tx, ty) || 1
    nx[i] = -ty / l
    ny[i] = tx / l
    if (i > 0) s[i] = s[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1])
  }
  const len = s[n - 1] || 1
  const index = list.map((st) => clamp(Math.round((((horizontal ? st.x : st.y) - A0) / Math.max(1, A1 - A0)) * steps), 0, steps))
  const gap = new Uint16Array(n)
  const v = new Float32Array(n)
  for (let g = 0; g < S - 1; g++) {
    const i0 = index[g]
    const i1 = index[g + 1]
    for (let i = i0; i <= i1; i++) {
      gap[i] = g
      v[i] = (s[i] - s[i0]) / Math.max(1e-3, s[i1] - s[i0])
    }
  }
  /* Every other stretch turns the band right over; the rest only
     lean it. A fixed pattern: the same story always folds the same way. */
  const fold = Array.from({ length: S }, (_, g) => (g % 2 === 1 || S <= 2 ? 1 : 0.16))
  list.forEach((st, i) => {
    st.at = reach(s[index[i]] / len)
  })
  return { w, h, band, type, n, x, y, nx, ny, s, gap, v, len, fold, stations: list, index }
}

/* ---- paint ---------------------------------------------------------- */

const FRONT = [252, 249, 243]
const FRONT_EDGE = [222, 213, 198]
const BACK = [209, 196, 176]
const BACK_EDGE = [176, 161, 140]
const tone = (a: number[], b: number[], t: number) =>
  `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`

interface Frame { p: number; time: number; intensity: number; dpr: number; still: boolean }
/** A point of a run: position, signed half-width, and the sample whose normal it uses. */
type Pt = [number, number, number, number]

function paint(ctx: CanvasRenderingContext2D, L: Layout, f: Frame, hw: Float32Array) {
  ctx.clearRect(0, 0, L.w, L.h)
  const head = f.still ? 1 : headOf(f.p)
  const headS = head * L.len
  if (headS < 1) return
  const { x, y, nx, ny, s, gap, v, n } = L
  const W = L.band / 2
  const A = 0.08 + 0.92 * clamp(f.intensity)
  const curlLen = Math.min(L.len * 0.08, 90)
  const unrolling = 1 - range(head, 0.93, 1)
  const done = head >= 0.999
  let last = 0
  while (last < n - 1 && s[last + 1] <= headS) last++

  /* The band's signed half-width is the cosine of its twist: where it
     crosses zero the band is edge-on and the faces swap. The twist is
     zero at every station, so each milestone sits on the lit face. */
  for (let i = 0; i <= last; i++) {
    const sv = Math.sin(Math.PI * v[i])
    let th = Math.PI * A * L.fold[gap[i]] * sv * sv
    th += 0.14 * (0.4 + A) * sv * Math.sin((s[i] / L.len) * 7 - f.time * 0.5)
    const d = headS - s[i]
    if (unrolling > 0 && d < curlLen) th += Math.PI * 0.8 * unrolling * (1 - d / curlLen) ** 2
    hw[i] = W * Math.cos(th)
  }

  const runs: Pt[][] = []
  let run: Pt[] = []
  for (let i = 0; i <= last; i++) {
    if (i > 0 && hw[i - 1] !== 0 && Math.sign(hw[i]) !== Math.sign(hw[i - 1])) {
      const t = hw[i - 1] / (hw[i - 1] - hw[i])
      const z: Pt = [x[i - 1] + (x[i] - x[i - 1]) * t, y[i - 1] + (y[i] - y[i - 1]) * t, 0, i]
      run.push(z)
      runs.push(run)
      run = [z]
    }
    run.push([x[i], y[i], hw[i], i])
  }
  if (!done && last < n - 1) {
    const t = (headS - s[last]) / Math.max(1e-3, s[last + 1] - s[last])
    run.push([x[last] + (x[last + 1] - x[last]) * t, y[last] + (y[last + 1] - y[last]) * t, hw[last], last])
  }
  runs.push(run)

  // Each run's outline, built once for the shadow, the face and the edge.
  const notch = W * 1.15
  const outlines = runs.map((r, ri) => {
    const path = new Path2D()
    r.forEach(([px, py, hwv, k], j) => {
      if (j === 0) path.moveTo(px + nx[k] * hwv, py + ny[k] * hwv)
      else path.lineTo(px + nx[k] * hwv, py + ny[k] * hwv)
    })
    if (ri === runs.length - 1 && done) {
      // A swallowtail at the end: notched back along the band's axis…
      const [ex, ey, , k] = r[r.length - 1]
      path.lineTo(ex - ny[k] * notch, ey + nx[k] * notch)
    }
    for (let j = r.length - 1; j >= 0; j--) {
      const [px, py, hwv, k] = r[j]
      path.lineTo(px - nx[k] * hwv, py - ny[k] * hwv)
    }
    if (ri === 0) {
      // …and at the tail it starts from.
      const [sx, sy, , k] = r[0]
      path.lineTo(sx + ny[k] * notch, sy - nx[k] * notch)
    }
    path.closePath()
    return path
  })

  // The band stands a few pixels off the plaster.
  ctx.save()
  ctx.shadowColor = 'rgba(72, 50, 24, 0.17)'
  ctx.shadowBlur = 10 * f.dpr
  ctx.shadowOffsetX = 2 * f.dpr
  ctx.shadowOffsetY = 6 * f.dpr
  ctx.fillStyle = 'rgb(240, 234, 224)'
  for (const o of outlines) ctx.fill(o)
  ctx.restore()

  // Faces: a gradient along each run, brightest where it faces the light.
  runs.forEach((r, j) => {
    const [ax, ay] = r[0]
    const [bx, by] = r[r.length - 1]
    const dx = bx - ax
    const dy = by - ay
    const l2 = dx * dx + dy * dy
    const back = r[Math.floor(r.length / 2)][2] < 0
    const [lo, hi] = back ? [BACK_EDGE, BACK] : [FRONT_EDGE, FRONT]
    const shade = (hwv: number) => tone(lo, hi, Math.pow(Math.abs(hwv) / W, 0.6))
    if (l2 < 1) ctx.fillStyle = shade(r[0][2])
    else {
      const g = ctx.createLinearGradient(ax, ay, bx, by)
      const step = Math.max(1, Math.floor(r.length / 12))
      for (let k = 0; k < r.length; k += step) g.addColorStop(clamp(((r[k][0] - ax) * dx + (r[k][1] - ay) * dy) / l2), shade(r[k][2]))
      g.addColorStop(1, shade(r[r.length - 1][2]))
      ctx.fillStyle = g
    }
    ctx.fill(outlines[j])
  })

  ctx.lineWidth = 0.8
  ctx.lineJoin = 'round'
  ctx.strokeStyle = 'rgba(68, 61, 49, 0.4)'
  for (const o of outlines) ctx.stroke(o)
}

/** Pins where the milestones sit, the hairline tying each to its words, and the band's leading end. */
function paintPins(ctx: CanvasRenderingContext2D, L: Layout, p: number, still: boolean) {
  const r = clamp(L.band * 0.14, 2.2, 4.2)
  for (const st of L.stations) {
    if (!st.m) continue
    const e = still ? 1 : easeOut(range(p, st.at - 0.015, st.at + 0.035))
    if (e <= 0.001) continue
    if (st.mode) {
      const a = still ? 1 : settle(st, p)
      const across = st.side === 'left' || st.side === 'right'
      const dir = st.side === 'left' || st.side === 'above' ? -1 : 1
      const sx = across ? st.x + dir * (L.band / 2 + 3) : st.x
      const sy = across ? st.y : st.y + dir * (L.band / 2 + 3)
      const ex = across ? (st.side === 'left' ? st.lx + st.lw + 3 : st.lx - 3) : st.x
      const ey = across ? st.y : st.side === 'above' ? st.ly + st.lh + 1 : st.ly - 1
      if ((ex - sx) * dir > 0 || (ey - sy) * dir > 0) {
        ctx.strokeStyle = `rgba(68, 61, 49, ${(0.55 * a).toFixed(3)})`
        ctx.lineWidth = 0.75
        ctx.beginPath()
        ctx.moveTo(sx, sy)
        ctx.lineTo(sx + (ex - sx) * a, sy + (ey - sy) * a)
        ctx.stroke()
      }
    }
    ctx.beginPath()
    ctx.arc(st.x, st.y, r * e, 0, Math.PI * 2)
    ctx.fillStyle = 'rgb(253, 250, 244)'
    ctx.fill()
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(26, 23, 18, 0.8)'
    ctx.stroke()
  }
  // The one accent: the band's leading end, which comes to rest at its destination.
  const head = still ? 1 : headOf(p)
  if (head > 0.01) {
    const hs = head * L.len
    let i = 0
    while (i < L.n - 1 && L.s[i + 1] <= hs) i++
    ctx.beginPath()
    ctx.arc(L.x[i], L.y[i], clamp(L.band * 0.11, 2, 3.4), 0, Math.PI * 2)
    ctx.fillStyle = '#bf4f27'
    ctx.fill()
  }
}

/* ---- component ------------------------------------------------------ */

export default function JourneyRibbon({ progress, active, reducedMotion, intensity, speed, site }: SectionAnimationProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const labels = useRef<(HTMLDivElement | null)[]>([])
  const live = useRef({ ctx: null as CanvasRenderingContext2D | null, dpr: 1, time: 0, hw: new Float32Array(0) })
  const size = useBoxSize(rootRef)
  const layout = useMemo(() => compose(size, site), [size, site])

  const frame = useCallback(
    (dt: number) => {
      const st = live.current
      if (!layout || !st.ctx) return
      st.time += dt * speed
      const still = reducedMotion
      const p = still ? 1 : progress.current
      paint(st.ctx, layout, { p, time: still ? 0 : st.time, intensity, dpr: st.dpr, still }, st.hw)
      paintPins(st.ctx, layout, p, still)
      layout.stations.forEach((station, i) => {
        const el = labels.current[i]
        if (!el) return
        const e = still ? 1 : settle(station, p)
        const off = (1 - e) * 12
        const ox = station.side === 'left' ? -off : station.side === 'right' ? off : 0
        const oy = station.side === 'above' ? -off : station.side === 'below' ? off : 0
        el.style.opacity = e.toFixed(3)
        el.style.transform = `translate3d(${ox.toFixed(1)}px, ${oy.toFixed(1)}px, 0)`
      })
    },
    [layout, progress, reducedMotion, intensity, speed],
  )

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (!layout) {
      // Nothing to draw at this size or with this content: leave no stale band behind.
      canvas.width = 0
      canvas.height = 0
      live.current.ctx = null
      return
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(layout.w * dpr)
    canvas.height = Math.round(layout.h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const st = live.current
    st.ctx = ctx
    st.dpr = dpr
    if (st.hw.length < layout.n) st.hw = new Float32Array(layout.n)
    frame(0)
  }, [layout, frame])

  useEffect(() => {
    const canvas = canvasRef.current
    const st = live.current
    return () => {
      st.ctx = null
      if (canvas) {
        canvas.width = 0
        canvas.height = 0
      }
    }
  }, [])

  useTicker(active && !reducedMotion && !!layout, frame)

  const vars = layout ? ({ '--t': `${layout.type.title}px`, '--m': `${layout.type.mono}px`, '--d': `${layout.type.detail}px` } as CSSProperties) : undefined

  return (
    <div ref={rootRef} className={styles.root} style={vars}>
      <canvas ref={canvasRef} className={styles.canvas} />
      {layout?.stations.map((st, i) => {
        if (st.lines ? !st.lines.length : !st.mode) return null
        const m = st.m
        return (
          <div
            key={st.key}
            ref={(el) => {
              labels.current[i] = el
            }}
            className={styles.label}
            data-kind={st.kind}
            data-align={st.align}
            style={{ left: st.lx, top: st.ly, width: Math.max(1, st.lw) }}
          >
            {st.lines ? (
              st.lines.map((line, j) => (
                <span key={j} className={styles.words}>
                  {line}
                </span>
              ))
            ) : st.mode === 1 ? (
              <span className={styles.line}>
                <span className={styles.when}>{m!.year}</span>
                <span className={styles.title}>{m!.title}</span>
              </span>
            ) : (
              <>
                <span className={styles.when}>{dateOf(m!, st.mode)}</span>
                <span className={styles.title}>{m!.title}</span>
                {st.mode === 3 && (
                  <span className={styles.detail} data-lines={st.dl}>
                    {m!.detail}
                  </span>
                )}
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
