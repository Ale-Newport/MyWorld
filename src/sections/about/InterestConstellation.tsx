'use client'

import { useLayoutEffect, useMemo, useRef } from 'react'
import { TECH_GROUPS, type SiteContent } from '@/cms/derive'
import { clamp, lerp, range } from '@/lib/math'
import type { SectionAnimationProps } from '../types'
import { expo, textWidth, useBoxSize, useTicker, type Size } from './shared'
import styles from './InterestConstellation.module.css'

/* ============================================================
   INTEREST CONSTELLATION

   A star chart of the site's technologies. Each discipline (the
   Tech Toolbox's own groups) is one constellation; each of its
   technologies a star sized by the public projects that evidence
   it, and a skill with no public evidence drawn hollow, as the
   Toolbox draws it dashed. Each constellation's figure joins its
   stars by their shortest links; across the sky, a few fine arcs
   join two technologies that one project used together, the
   strongest pairings first (intensity: how many arcs are drawn).

   The chart draws itself in as the section scrolls, one
   constellation after another, the arcs last. Only a readable
   few stars are named — more on a bigger box, none on the
   smallest — and a small box shows fewer constellations. Once
   drawn, a slow glint travels the arcs (speed).
   ============================================================ */

interface Star { id: string; name: string; x: number; y: number; r: number; evidence: number; projects: string[]; group: number; t0: number; strongest?: boolean; label?: Label }
interface Label { x: number; y: number; anchor: 'start' | 'end' | 'middle' }
interface Group { id: string; label: string; x: number; y: number; t0: number; text: Label; stars: number[] }
/** One line of a constellation's figure, between two of its stars. */
interface Edge { key: string; a: number; b: number; t0: number }
interface Arc { a: number; b: number; d: string; t0: number; strong: boolean; c: number[] }

interface Layout {
  w: number
  h: number
  /** The faint orbit the constellations sit on: an ellipse, or a line on a short box. */
  orbit: string
  groups: Group[]
  edges: Edge[]
  stars: Star[]
  arcs: Arc[]
  mono: number
  name: number
}

type Rect = [number, number, number, number]
const hit = (a: Rect, b: Rect) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]
/** A small, stable number from a string: the same id always lands in the same place. */
const hash = (s: string) => {
  let v = 2166136261
  for (let i = 0; i < s.length; i++) v = Math.imul(v ^ s.charCodeAt(i), 16777619)
  return ((v >>> 0) % 10007) / 10007
}

/** Prim's minimum spanning tree over a few points: a constellation's figure. */
function figure(pts: { x: number; y: number }[]): [number, number][] {
  if (pts.length < 2) return []
  const inTree = [0]
  const edges: [number, number][] = []
  while (inTree.length < pts.length) {
    let best: [number, number] = [0, 0]
    let bd = Infinity
    for (const i of inTree) {
      for (let j = 0; j < pts.length; j++) {
        if (inTree.includes(j)) continue
        const d = (pts[i].x - pts[j].x) ** 2 + (pts[i].y - pts[j].y) ** 2
        if (d < bd) {
          bd = d
          best = [i, j]
        }
      }
    }
    edges.push(best)
    inTree.push(best[1])
  }
  return edges
}

function compose(size: Size, site: SiteContent, intensity: number): Layout | null {
  const { w, h } = size
  if (w < 80 || h < 60) return null
  const m = Math.min(w, h)
  const area = w * h
  const tier = area >= 300_000 ? 3 : area >= 160_000 ? 2 : area >= 70_000 ? 1 : 0
  const mono = m >= 360 ? 10 : 9.5
  const name = m >= 480 ? 12.5 : 11.5
  const all = TECH_GROUPS.map((g) => {
    const techs = site.techNodes.filter((t) => t.group === g.id).sort((a, b) => b.evidence.length - a.evidence.length)
    return { ...g, techs, weight: techs.reduce((a, t) => a + t.evidence.length, 0) }
  }).filter((g) => g.techs.length)
  if (!all.length) return null
  // A small box shows fewer constellations: the most evidenced, kept in the Toolbox's order.
  const keep = new Set([...all].sort((a, b) => b.weight - a.weight).slice(0, [4, 5, 7, 7][tier]).map((g) => g.id))
  const used = all.filter((g) => keep.has(g.id))
  const G = used.length
  const perGroup = [3, 5, 7, 9][tier]
  const short = h < 230 && w > h * 1.4
  const pad = clamp(m * 0.05, 8, 30)
  const labelRoom = mono * 2.2

  /* Constellation centres: around an ellipse, or along a row on a short box. */
  let rc = 0
  let centres: [number, number][] = []
  let orbit = ''
  if (short) {
    rc = clamp(Math.min((w - pad * 2) / (G * 2.5), (h - pad * 2 - labelRoom) / 2.4), 12, 80)
    centres = used.map((_, i) => [pad + rc * 1.25 + (i * (w - pad * 2 - rc * 2.5)) / Math.max(1, G - 1), h / 2 + labelRoom / 2 + (i % 2 ? 1 : -1) * Math.min(rc * 0.25, 10)])
    orbit = `M${pad.toFixed(1)} ${(h / 2 + labelRoom / 2).toFixed(1)}H${(w - pad).toFixed(1)}`
  } else {
    rc = clamp(m * 0.13, 16, 110)
    for (let pass = 0; pass < 3; pass++) {
      const rx = w / 2 - pad - rc - labelRoom * 0.5
      const ry = h / 2 - pad - rc - labelRoom
      const chord = 2 * Math.min(rx, ry) * Math.sin(Math.PI / Math.max(3, G))
      rc = clamp(Math.min(rc, chord / 2.7), 14, 110)
    }
    const rx = w / 2 - pad - rc - labelRoom * 0.5
    const ry = h / 2 - pad - rc - labelRoom
    centres = used.map((_, i) => {
      const a = -Math.PI / 2 + (i / G) * Math.PI * 2 + (G % 2 ? 0 : Math.PI / G)
      return [w / 2 + Math.cos(a) * rx, h / 2 + Math.sin(a) * ry]
    })
    orbit = `M${(w / 2 - rx).toFixed(1)} ${(h / 2).toFixed(1)}a${rx.toFixed(1)} ${ry.toFixed(1)} 0 1 0 ${(rx * 2).toFixed(1)} 0a${rx.toFixed(1)} ${ry.toFixed(1)} 0 1 0 ${(-rx * 2).toFixed(1)} 0`
  }

  const maxEv = Math.max(1, ...site.techNodes.map((t) => t.evidence.length))
  const rMax = clamp(m * 0.0105, 3, 6.2)
  const stars: Star[] = []
  const groups: Group[] = []
  const edgeList: Edge[] = []
  used.forEach((g, gi) => {
    const [cx, cy] = centres[gi]
    const techs = g.techs.slice(0, perGroup)
    const t0 = 0.04 + (gi / G) * 0.26
    const idx: number[] = []
    techs.forEach((t, k) => {
      // A loose sunflower, jittered by the technology's id so the figure looks charted, not plotted.
      const golden = Math.PI * (3 - Math.sqrt(5))
      const jr = hash(t.id)
      const span = rc * (0.75 + 0.35 * Math.sqrt(techs.length / perGroup))
      const rr = span * (0.18 + 0.82 * Math.sqrt((k + 0.4) / techs.length)) * (0.86 + jr * 0.28)
      const a = k * golden + gi * 1.3 + (jr - 0.5) * 0.6
      const ev = t.evidence.length
      idx.push(stars.length)
      stars.push({
        id: t.id,
        name: t.name,
        x: clamp(cx + Math.cos(a) * rr, pad, w - pad),
        y: clamp(cy + Math.sin(a) * rr * (short ? 0.8 : 1), pad, h - pad),
        r: ev ? lerp(1.6, rMax, Math.sqrt(ev / maxEv)) : 1.8,
        evidence: ev,
        projects: t.evidence,
        group: gi,
        t0: t0 + 0.02 + k * 0.014,
      })
    })
    /* Ease the stars apart until each has room for its light (and a name). */
    const gap = clamp(m * 0.028, 7, 16)
    for (let it = 0; it < 24; it++) {
      for (let i = 0; i < idx.length; i++) {
        for (let j = i + 1; j < idx.length; j++) {
          const A = stars[idx[i]]
          const B = stars[idx[j]]
          const dx = B.x - A.x
          const dy = B.y - A.y
          const d = Math.hypot(dx, dy) || 0.01
          const need = A.r + B.r + gap
          if (d >= need) continue
          const push = (need - d) / 2
          A.x = clamp(A.x - (dx / d) * push, pad, w - pad)
          A.y = clamp(A.y - (dy / d) * push, pad, h - pad)
          B.x = clamp(B.x + (dx / d) * push, pad, w - pad)
          B.y = clamp(B.y + (dy / d) * push, pad, h - pad)
        }
      }
    }
    const pts = idx.map((i) => stars[i])
    figure(pts).forEach(([a, b], k) => edgeList.push({ key: `${g.id}-${idx[a]}-${idx[b]}`, a: idx[a], b: idx[b], t0: t0 + 0.05 + k * 0.012 }))
    groups.push({ id: g.id, label: g.label, x: cx, y: cy, t0, text: { x: cx, y: cy, anchor: 'middle' }, stars: idx })
  })
  const brightest = stars.reduce<Star | null>((a, s) => (s.evidence > (a?.evidence ?? 0) ? s : a), null)
  if (brightest) brightest.strongest = true

  /* Arcs: two technologies one project used together, across disciplines. */
  const pairs: { a: number; b: number; weight: number }[] = []
  for (let i = 0; i < stars.length; i++) {
    for (let j = i + 1; j < stars.length; j++) {
      if (stars[i].group === stars[j].group) continue
      const weight = stars[i].projects.filter((e) => stars[j].projects.includes(e)).length
      if (weight) pairs.push({ a: i, b: j, weight })
    }
  }
  pairs.sort((p, q) => q.weight - p.weight || stars[q.a].evidence + stars[q.b].evidence - (stars[p.a].evidence + stars[p.b].evidence))
  // No star collects more than three arcs, and two constellations share at most one
  // (two on a large chart): a few busy pairs must not bundle into a web.
  const degree = new Map<number, number>()
  const between = new Map<string, number>()
  const perPair = tier >= 3 ? 2 : 1
  const want = Math.round(lerp(1, short ? 3 : [3, 5, 8, 10][tier], clamp(intensity)))
  const arcs: Arc[] = []
  for (const pr of pairs) {
    if (arcs.length >= want) break
    if ((degree.get(pr.a) ?? 0) >= 3 || (degree.get(pr.b) ?? 0) >= 3) continue
    const pair = [stars[pr.a].group, stars[pr.b].group].sort((x, y) => x - y).join(':')
    if ((between.get(pair) ?? 0) >= perPair) continue
    between.set(pair, (between.get(pair) ?? 0) + 1)
    degree.set(pr.a, (degree.get(pr.a) ?? 0) + 1)
    degree.set(pr.b, (degree.get(pr.b) ?? 0) + 1)
    const A = stars[pr.a]
    const B = stars[pr.b]
    const mx = (A.x + B.x) / 2
    const my = (A.y + B.y) / 2
    // Bowed toward the middle of the chart, so the arcs read as curves rather than a mesh of chords.
    const bx = mx + (w / 2 - mx) * 0.5
    const by = my + (h / 2 - my) * 0.5
    arcs.push({ a: pr.a, b: pr.b, strong: pr.weight > 1, d: `M${A.x.toFixed(1)} ${A.y.toFixed(1)}Q${bx.toFixed(1)} ${by.toFixed(1)} ${B.x.toFixed(1)} ${B.y.toFixed(1)}`, t0: 0, c: [A.x, A.y, bx, by, B.x, B.y] })
  }
  arcs.forEach((a, k) => {
    a.t0 = 0.34 + (k / Math.max(1, arcs.length)) * 0.2
  })

  /* Names: every constellation, then the brightest stars while they fit untouched. */
  const discs: (Rect & { r?: number })[] = stars.map((s) => Object.assign([s.x - s.r - 1, s.y - s.r - 1, s.r * 2 + 2, s.r * 2 + 2] as Rect, { r: s.r }))
  const labels: Rect[] = []
  const rect = (l: Label, tw: number, th: number): Rect => [l.anchor === 'end' ? l.x - tw : l.anchor === 'middle' ? l.x - tw / 2 : l.x, l.y - th * 0.8, tw, th]
  const inside = (r: Rect) => r[0] >= 2 && r[1] >= 2 && r[0] + r[2] <= w - 2 && r[1] + r[3] <= h - 2
  /** The first candidate that is inside the box and clear; `lenient` lets a name cover the faintest stars. */
  const place = (opts: Label[], tw: number, th: number, lenient = false) => {
    for (const l of opts) {
      const r = rect(l, tw, th)
      if (!inside(r) || labels.some((q) => hit(q, r)) || discs.some((q) => (!lenient || (q.r ?? 9) > 2.4) && hit(q, r))) continue
      labels.push(r)
      return l
    }
    return null
  }
  groups.forEach((g) => {
    const tw = textWidth(g.label.toUpperCase(), mono, { mono: true, tracking: 0.18 })
    const ys = g.stars.map((i) => stars[i].y)
    const xs = g.stars.map((i) => stars[i].x)
    const top = Math.min(...ys) - 9
    const bottom = Math.max(...ys) + mono + 7
    const below = !short && g.y > h / 2
    const opts: Label[] = [
      { x: g.x, y: below ? bottom : top, anchor: 'middle' },
      { x: g.x, y: below ? top : bottom, anchor: 'middle' },
      { x: Math.max(...xs) + 8, y: g.y + 3, anchor: 'start' },
      { x: Math.min(...xs) - 8, y: g.y + 3, anchor: 'end' },
    ]
    g.text = place(opts, tw, mono * 1.3) ?? place(opts, tw, mono * 1.3, true) ?? { x: clamp(g.x, tw / 2 + 3, w - tw / 2 - 3), y: clamp(below ? bottom : top, mono + 2, h - 3), anchor: 'middle' }
  })
  const named = [0, 3, 7, 11][tier]
  let count = 0
  for (const s of [...stars].filter((s) => s.evidence > 0).sort((a, b) => b.evidence - a.evidence)) {
    if (count >= named) break
    const tw = textWidth(s.name, name)
    const opts: Label[] = []
    for (const k of [1, 1.7]) {
      const d = s.r + 4 * k
      opts.push(
        { x: s.x + d, y: s.y + name * 0.34, anchor: 'start' },
        { x: s.x - d, y: s.y + name * 0.34, anchor: 'end' },
        { x: s.x, y: s.y - d, anchor: 'middle' },
        { x: s.x, y: s.y + d + name * 0.75, anchor: 'middle' },
        { x: s.x + d * 0.75, y: s.y - d * 0.75, anchor: 'start' },
        { x: s.x - d * 0.75, y: s.y - d * 0.75, anchor: 'end' },
        { x: s.x + d * 0.75, y: s.y + d * 0.75 + name * 0.6, anchor: 'start' },
        { x: s.x - d * 0.75, y: s.y + d * 0.75 + name * 0.6, anchor: 'end' },
      )
    }
    // The brightest stars may cover a faint one rather than go unnamed.
    const l = place(opts, tw, name * 1.05) ?? (count < 3 ? place(opts, tw, name * 1.05, true) : null)
    if (l) {
      s.label = l
      count++
    }
  }
  return { w, h, orbit, groups, edges: edgeList, stars, arcs, mono, name }
}

interface Els {
  orbit: SVGPathElement | null
  edges: (SVGPathElement | null)[]
  stars: (SVGCircleElement | null)[]
  groups: (SVGTextElement | null)[]
  arcs: (SVGPathElement | null)[]
  names: (SVGTextElement | null)[]
  glints: (SVGCircleElement | null)[]
}

const GLINTS = 2

function render(L: Layout, els: Els, p: number, t: number, still: boolean) {
  const at = (a: number, b: number) => (still ? 1 : expo(range(p, a, b)))
  if (els.orbit) els.orbit.style.strokeDashoffset = (1 - at(0.02, 0.4)).toFixed(4)
  L.groups.forEach((g, gi) => {
    const label = els.groups[gi]
    if (label) label.style.opacity = at(g.t0 + 0.03, g.t0 + 0.14).toFixed(3)
  })
  L.edges.forEach((ed, i) => {
    const el = els.edges[i]
    if (el) el.style.strokeDashoffset = (1 - at(ed.t0, ed.t0 + 0.12)).toFixed(4)
  })
  L.stars.forEach((s, i) => {
    const dot = els.stars[i]
    if (dot) dot.setAttribute('r', (s.r * at(s.t0, s.t0 + 0.06)).toFixed(2))
    const label = els.names[i]
    if (label) label.style.opacity = at(s.t0 + 0.06, s.t0 + 0.16).toFixed(3)
  })
  L.arcs.forEach((a, i) => {
    const el = els.arcs[i]
    if (el) el.style.strokeDashoffset = (1 - at(a.t0, a.t0 + 0.14)).toFixed(4)
  })
  // A slow glint along the arcs, once the chart is drawn.
  const on = still ? 0 : range(p, 0.6, 0.7)
  for (let g = 0; g < GLINTS; g++) {
    const el = els.glints[g]
    if (!el) continue
    const phase = t * 0.06 + g / GLINTS
    const arc = L.arcs.length ? L.arcs[(g * 5 + Math.floor(phase)) % L.arcs.length] : null
    if (!arc || on <= 0) {
      el.style.opacity = '0'
      continue
    }
    const u = phase % 1
    const [x0, y0, x1, y1, x2, y2] = arc.c
    el.setAttribute('cx', ((1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * x1 + u * u * x2).toFixed(1))
    el.setAttribute('cy', ((1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * y1 + u * u * y2).toFixed(1))
    el.style.opacity = (Math.sin(Math.PI * u) * on).toFixed(3)
  }
}

export default function InterestConstellation({ progress, active, reducedMotion, intensity, speed, site }: SectionAnimationProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const els = useRef<Els>({ orbit: null, edges: [], stars: [], groups: [], arcs: [], names: [], glints: [] })
  const clock = useRef(0)
  const size = useBoxSize(rootRef)
  const layout = useMemo(() => compose(size, site, intensity), [size, site, intensity])

  useLayoutEffect(() => {
    if (!layout) return
    render(layout, els.current, reducedMotion ? 1 : progress.current, clock.current, reducedMotion)
  }, [layout, reducedMotion, progress])

  useTicker(active && !reducedMotion && !!layout, (dt) => {
    if (!layout) return
    clock.current += dt * speed
    render(layout, els.current, progress.current, clock.current, false)
  })

  return (
    <div ref={rootRef} className={styles.root}>
      {layout && (
        <svg className={styles.svg} width={layout.w} height={layout.h} viewBox={`0 0 ${layout.w} ${layout.h}`} style={{ ['--mono' as string]: `${layout.mono}px`, ['--name' as string]: `${layout.name}px` }}>
          <path
            ref={(el) => {
              els.current.orbit = el
            }}
            className={styles.orbit}
            d={layout.orbit}
            pathLength={1}
          />
          <g className={styles.arcs}>
            {layout.arcs.map((a, i) => (
              <path
                key={`${a.a}-${a.b}`}
                ref={(el) => {
                  els.current.arcs[i] = el
                }}
                d={a.d}
                pathLength={1}
                data-strong={a.strong || undefined}
              />
            ))}
          </g>
          <g className={styles.figures}>
            {layout.edges.map((ed, i) => {
              const A = layout.stars[ed.a]
              const B = layout.stars[ed.b]
              return (
                <path
                  key={ed.key}
                  ref={(el) => {
                    els.current.edges[i] = el
                  }}
                  d={`M${A.x.toFixed(1)} ${A.y.toFixed(1)}L${B.x.toFixed(1)} ${B.y.toFixed(1)}`}
                  pathLength={1}
                />
              )
            })}
          </g>
          <g>
            {layout.stars.map((s, i) => (
              <circle
                key={i}
                ref={(el) => {
                  els.current.stars[i] = el
                }}
                className={styles.star}
                data-empty={s.evidence ? undefined : ''}
                data-strongest={s.strongest || undefined}
                cx={s.x}
                cy={s.y}
                r={0}
              />
            ))}
          </g>
          <g>
            {layout.groups.map((g, i) => (
              <text
                key={g.id}
                ref={(el) => {
                  els.current.groups[i] = el
                }}
                className={styles.group}
                x={g.text.x}
                y={g.text.y}
                textAnchor={g.text.anchor}
              >
                {g.label}
              </text>
            ))}
            {layout.stars.map((s, i) =>
              s.label ? (
                <text
                  key={i}
                  ref={(el) => {
                    els.current.names[i] = el
                  }}
                  className={styles.name}
                  x={s.label.x}
                  y={s.label.y}
                  textAnchor={s.label.anchor}
                >
                  {s.name}
                </text>
              ) : null,
            )}
          </g>
          <g className={styles.glints}>
            {Array.from({ length: GLINTS }, (_, g) => (
              <circle
                key={g}
                ref={(el) => {
                  els.current.glints[g] = el
                }}
                r={1.7}
              />
            ))}
          </g>
        </svg>
      )}
    </div>
  )
}
