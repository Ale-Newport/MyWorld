'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'
import { TECH_GROUPS, type SiteContent } from '@/cms/derive'
import { clamp, damp, lerp, range } from '@/lib/math'
import type { SectionAnimationProps } from '../types'
import { expo, present, strongestTech, textWidth, useBoxSize, useTicker, type Size } from './shared'
import styles from './IdentityAssembly.module.css'

/* ============================================================
   ASSEMBLING IDENTITY

   An editorial grid assembled from what the site says about its
   author: every role (profile.roles) set large in the upper
   register, and below it the disciplines (the Tech Toolbox's own
   groups) heading columns of their strongest technologies, each
   with a dot per public project that evidences it.

   As the section scrolls, every piece slides in across the margin
   of the box nearest to it and locks into the grid; the hairlines
   are drawn once the pieces are in, and crop marks close the
   composition. Intensity sets how many technologies take part;
   speed sets how briskly the pieces catch up with the scroll.
   ============================================================ */

type Edge = 'left' | 'right' | 'top' | 'bottom'
/** How a tool shows its evidence: dots and the count, dots alone, the count alone, or nothing. */
type Evidence = 'full' | 'dots' | 'count' | 'none'

interface Piece {
  key: string
  kind: 'role' | 'head' | 'tool'
  x: number
  y: number
  w: number
  h: number
  edge: Edge
  /** Arrival window, in progress. */
  t0: number
  t1: number
  lines?: string[]
  text?: string
  count?: number
  showCount?: boolean
}

interface Rule { key: string; x: number; y: number; len: number; vertical: boolean; t0: number; t1: number }

interface Layout {
  w: number
  h: number
  role: number
  mono: number
  tool: number
  /** Inner padding of a role cell and of a discipline column. */
  padR: number
  padT: number
  evidence: Evidence
  pieces: Piece[]
  rules: Rule[]
  frame: { x: number; y: number; w: number; h: number }
}

const ROLE = { weight: 500, tracking: -0.025 }
const MAX_DOTS = 10

/** A role on one or two lines, split where the two halves are most even. */
function split(role: string, size: number): string[] {
  const words = role.split(/\s+/)
  if (words.length < 2) return [role]
  let best: string[] = [role]
  let bestW = Infinity
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ')
    const b = words.slice(i).join(' ')
    const wMax = Math.max(textWidth(a, size, ROLE), textWidth(b, size, ROLE))
    if (wMax < bestW) {
      bestW = wMax
      best = [a, b]
    }
  }
  return best
}

/** The Tech Toolbox's groups that have evidenced technologies, the most evidenced first. */
function disciplines(site: SiteContent) {
  const strong = strongestTech(site)
  return TECH_GROUPS.map((g) => {
    const tools = strong.filter((t) => t.group === g.id)
    return { id: g.id, label: g.label, tools, weight: tools.reduce((a, t) => a + t.evidence.length, 0) }
  })
    .filter((g) => g.tools.length > 0)
    .sort((a, b) => b.weight - a.weight)
}

function compose(size: Size, site: SiteContent, intensity: number): Layout | null {
  const { w, h } = size
  if (w < 80 || h < 60) return null
  const outer = clamp(Math.min(w, h) * 0.045, 8, 28)
  const iw = w - outer * 2
  const ih = h - outer * 2
  const roles = present(site.profile.roles).map((r) => r.toUpperCase())
  const groups = disciplines(site)
  const mono = iw >= 520 ? 10.5 : 10
  const tool = iw >= 760 ? 15 : iw >= 520 ? 14 : 13

  /* Upper register: the roles, in three columns on a wide box, two otherwise. */
  const colsR = roles.length >= 3 && iw >= 520 ? 3 : roles.length >= 2 && iw >= 200 ? 2 : 1
  const rowsR = Math.ceil(roles.length / colsR) || 0
  const cellW = iw / colsR
  const padR = clamp(cellW * 0.06, 6, 16)
  const fits = roles.map((r) => {
    const widest = Math.max(...split(r, 100).map((l) => textWidth(l, 100, ROLE)))
    return ((cellW - padR * 2 - 2) / Math.max(1, widest)) * 100
  })
  // One size for every role, the one at which the longest fits; only below 12px is a role cut short.
  const maxRole = clamp(Math.min(iw * 0.06, ih * 0.075), 13, 44)
  let role = clamp(Math.min(...fits, maxRole), Math.min(12, maxRole), maxRole)

  /* Lower register: disciplines heading columns of their strongest tools. */
  const colsD = Math.min(groups.length, iw >= 640 ? 4 : iw >= 430 ? 3 : 2)
  const budget = Math.round(lerp(4, 18, clamp(intensity)))
  const headH = mono * 1.6 + 8
  const toolH = tool * 1.25 + 12
  const gapBand = clamp(ih * 0.06, 10, 36)
  const twoLines = roles.some((r) => r.includes(' '))
  const roleRowH = (s: number) => (twoLines ? 2 : 1) * s * 1.02 + clamp(s * 0.55, 8, 22)
  let rowsT = 0
  for (;;) {
    const upper = rowsR * roleRowH(role)
    const room = ih - upper - gapBand - headH
    rowsT = colsD && ih >= 200 ? Math.max(0, Math.min(Math.ceil(budget / colsD), Math.floor(room / toolH), Math.max(...groups.map((g) => g.tools.length)))) : 0
    const lower = rowsT > 0 ? headH + rowsT * toolH : 0
    if (upper + (lower ? gapBand + lower : 0) <= ih || role <= 10) break
    role = Math.max(10, role * 0.92)
  }
  const upper = rowsR * roleRowH(role)
  if (upper > ih + 0.5) return null
  const lower = rowsT > 0 ? headH + rowsT * toolH : 0
  if (!upper && !lower) return null

  // Spare height: a little more air in both registers, then centre the whole.
  const spare = Math.max(0, ih - upper - (lower ? gapBand + lower : 0))
  const grow = Math.min(spare * 0.5, ih * 0.12)
  const rowR = roleRowH(role) + (rowsR ? (grow * 0.6) / rowsR : 0)
  const bandGap = gapBand + grow * 0.4
  const totalH = rowsR * rowR + (lower ? bandGap + lower : 0)
  const top = outer + Math.max(0, (ih - totalH) / 2)

  const pieces: Piece[] = []
  const rules: Rule[] = []
  const edgeOf = (x: number, y: number, pw: number, ph: number): Edge => {
    const d: [Edge, number][] = [['left', x], ['right', w - (x + pw)], ['top', y], ['bottom', h - (y + ph)]]
    return d.sort((a, b) => a[1] - b[1])[0][0]
  }

  roles.forEach((r, i) => {
    const x = outer + (i % colsR) * cellW
    const y = top + Math.floor(i / colsR) * rowR
    const t0 = 0.03 + (i / Math.max(1, roles.length)) * 0.2
    pieces.push({ key: `r${i}`, kind: 'role', x, y, w: cellW, h: rowR, edge: edgeOf(x, y, cellW, rowR), t0, t1: t0 + 0.2, lines: twoLines ? split(r, role) : [r] })
  })
  for (let row = 0; row <= rowsR && rowsR; row++) rules.push({ key: `hr${row}`, x: outer, y: top + row * rowR, len: iw, vertical: false, t0: 0.26 + row * 0.04, t1: 0.46 + row * 0.04 })
  for (let c = 1; c < colsR; c++) rules.push({ key: `vr${c}`, x: outer + c * cellW, y: top, len: rowsR * rowR, vertical: true, t0: 0.3 + c * 0.03, t1: 0.5 + c * 0.03 })

  let evidence: Evidence = 'none'
  let padT = 8
  if (lower) {
    const used = groups.slice(0, colsD)
    const colW = iw / used.length
    const y0 = top + rowsR * rowR + bandGap
    const tools: { t: (typeof used)[number]['tools'][number]; c: number; row: number }[] = []
    for (let row = 0; row < rowsT; row++) {
      used.forEach((g, c) => {
        const t = g.tools[row]
        if (t && tools.length < budget) tools.push({ t, c, row })
      })
    }
    /* The richest way of showing evidence that leaves every name whole. */
    padT = clamp(colW * 0.06, 6, 14)
    const room = colW - padT * 2 - 8
    const widestName = Math.max(...tools.map(({ t }) => textWidth(t.name, tool)))
    const most = Math.min(MAX_DOTS, Math.max(...tools.map(({ t }) => t.evidence.length)))
    const dotsW = most * 5.5
    const countW = mono * 2
    evidence = widestName + dotsW + countW <= room ? 'full' : widestName + dotsW <= room ? 'dots' : widestName + countW <= room ? 'count' : 'none'
    used.forEach((g, c) => {
      const x = outer + c * colW
      const t0 = 0.14 + c * 0.04
      pieces.push({ key: `h${g.id}`, kind: 'head', x, y: y0, w: colW, h: headH, edge: edgeOf(x, y0 + 40, colW, headH), t0, t1: t0 + 0.2, text: g.label })
    })
    tools.forEach(({ t, c, row }, k) => {
      const x = outer + c * colW
      const y = y0 + headH + row * toolH
      const t0 = 0.2 + (k / Math.max(1, tools.length)) * 0.24
      pieces.push({ key: `t${k}:${t.id}`, kind: 'tool', x, y, w: colW, h: toolH, edge: edgeOf(x, y, colW, toolH), t0, t1: t0 + 0.18, text: t.name, count: t.evidence.length, showCount: t.showCount })
    })
    rules.push({ key: 'band', x: outer, y: y0, len: iw, vertical: false, t0: 0.36, t1: 0.56 })
    rules.push({ key: 'foot', x: outer, y: y0 + lower, len: iw, vertical: false, t0: 0.4, t1: 0.6 })
    for (let c = 1; c < used.length; c++) rules.push({ key: `vd${c}`, x: outer + c * colW, y: y0, len: lower, vertical: true, t0: 0.4 + c * 0.03, t1: 0.58 + c * 0.03 })
  }
  /* Arrival order: the deepest pieces first. A piece far from every edge
     has to cross other slots on its way in, so it passes through them
     while they are still empty and the outer pieces follow behind it. */
  const depth = (pc: Piece) => Math.min(pc.x, w - (pc.x + pc.w), pc.y, h - (pc.y + pc.h))
  const order = pieces.map((pc, i) => ({ i, d: depth(pc) + (pc.kind === 'role' ? 1e4 : 0) })).sort((a, b) => b.d - a.d)
  order.forEach(({ i }, rank) => {
    const t0 = 0.03 + (rank / Math.max(1, order.length - 1)) * 0.36
    pieces[i].t0 = t0
    pieces[i].t1 = t0 + 0.2
  })
  return { w, h, role, mono, tool, padR, padT, evidence, pieces, rules, frame: { x: outer, y: top, w: iw, h: totalH } }
}

interface Els {
  pieces: (HTMLDivElement | null)[]
  rules: (HTMLDivElement | null)[]
  marks: HTMLDivElement | null
}

/** Writes one moment of the assembly (q: the followed progress). */
function render(L: Layout, els: Els, q: number) {
  L.pieces.forEach((pc, i) => {
    const el = els.pieces[i]
    if (!el) return
    const a = expo(range(q, pc.t0, pc.t1))
    // From just beyond the box's own margin, so each piece enters across the edge.
    const out = pc.edge === 'left' ? -(pc.x + pc.w) : pc.edge === 'right' ? L.w - pc.x : pc.edge === 'top' ? -(pc.y + pc.h) : L.h - pc.y
    const d = ((1 - a) * (out + Math.sign(out) * 8)).toFixed(1)
    const across = pc.edge === 'left' || pc.edge === 'right'
    el.style.transform = across ? `translate3d(${d}px, 0, 0)` : `translate3d(0, ${d}px, 0)`
    el.style.opacity = clamp(a * 1.6).toFixed(3)
  })
  L.rules.forEach((rl, i) => {
    const el = els.rules[i]
    if (!el) return
    const a = expo(range(q, rl.t0, rl.t1)).toFixed(4)
    el.style.transform = rl.vertical ? `scaleY(${a})` : `scaleX(${a})`
  })
  if (els.marks) {
    const a = expo(range(q, 0.56, 0.68))
    els.marks.style.opacity = a.toFixed(3)
    els.marks.style.setProperty('--lock', `${((1 - a) * 10).toFixed(2)}px`)
  }
}

export default function IdentityAssembly({ progress, active, reducedMotion, intensity, speed, site }: SectionAnimationProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const els = useRef<Els>({ pieces: [], rules: [], marks: null })
  const follow = useRef(0)
  const size = useBoxSize(rootRef)
  const layout = useMemo(() => compose(size, site, intensity), [size, site, intensity])

  useLayoutEffect(() => {
    if (!layout) return
    follow.current = reducedMotion ? 1 : progress.current
    render(layout, els.current, follow.current)
  }, [layout, reducedMotion, progress])

  // Back from far away, the pieces start where the scroll is rather than chasing it from where they were left.
  useEffect(() => {
    if (active) follow.current = progress.current
  }, [active, progress])

  useTicker(active && !reducedMotion && !!layout, (dt) => {
    if (!layout) return
    // The pieces catch up with the scroll on their own clock: `speed` sets how briskly.
    const q = damp(follow.current, progress.current, 7 * speed, dt)
    // Settled and the page still: nothing moves, so nothing is written.
    if (Math.abs(q - follow.current) < 1e-5) return
    follow.current = q
    render(layout, els.current, q)
  })

  const vars = layout
    ? ({ '--role': `${layout.role.toFixed(2)}px`, '--mono': `${layout.mono}px`, '--tool': `${layout.tool}px`, '--pad-r': `${layout.padR.toFixed(1)}px`, '--pad-t': `${layout.padT.toFixed(1)}px` } as CSSProperties)
    : undefined
  const f = layout?.frame

  return (
    <div ref={rootRef} className={styles.root} style={vars} data-evidence={layout?.evidence}>
      {layout?.rules.map((rl, i) => (
        <div
          key={rl.key}
          ref={(el) => {
            els.current.rules[i] = el
          }}
          className={styles.rule}
          data-vertical={rl.vertical || undefined}
          style={rl.vertical ? { left: rl.x, top: rl.y, height: rl.len } : { left: rl.x, top: rl.y, width: rl.len }}
        />
      ))}
      {layout?.pieces.map((pc, i) => (
        <div
          key={pc.key}
          ref={(el) => {
            els.current.pieces[i] = el
          }}
          className={styles.piece}
          data-kind={pc.kind}
          style={{ left: pc.x, top: pc.y, width: pc.w, height: pc.h }}
        >
          {pc.kind === 'role' &&
            pc.lines!.map((l, j) => (
              <span key={j} className={styles.roleLine}>
                {l}
              </span>
            ))}
          {pc.kind === 'head' && <span className={styles.head}>{pc.text}</span>}
          {pc.kind === 'tool' && (
            <>
              <span className={styles.toolName}>{pc.text}</span>
              <span className={styles.dots}>
                {Array.from({ length: Math.min(pc.count ?? 0, MAX_DOTS) }, (_, j) => (
                  <i key={j} />
                ))}
                {pc.showCount && <b>{pc.count}</b>}
              </span>
            </>
          )}
        </div>
      ))}
      {f && (
        <div
          ref={(el) => {
            els.current.marks = el
          }}
          className={styles.marks}
          style={{ left: f.x, top: f.y, width: f.w, height: f.h }}
        >
          <i data-corner="tl" />
          <i data-corner="tr" />
          <i data-corner="bl" />
          <i data-corner="br" />
        </div>
      )}
    </div>
  )
}
