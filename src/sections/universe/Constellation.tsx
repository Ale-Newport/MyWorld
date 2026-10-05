'use client'

import { memo, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'
import type { SiteProject, UniverseAnimationProps } from '../types'
import { CATEGORY_LABEL, CATEGORY_ORDER, approach, clamp01, fitTitle, hash01, labelOf, smooth, textWidth, tierOf, toneOf, useBoxSize, useFinePointer, useHot, useTicker, type Tier } from './shared'
import styles from './Constellation.module.css'

/* ============================================================
   PROJECT CONSTELLATION

   A star chart. Each category is a constellation: its projects
   are stars set out from the middle of the figure (the headline
   work brightest, at the heart of its figure) and joined by the
   fewest lines that connect them — a spanning tree that prefers
   to join projects which share technologies, so a figure is a
   drawing of related work, never a web. A few dashed lines cross
   between constellations where two projects share a real stack.

   The chart draws itself in as the section arrives: stars come
   out figure by figure and the lines are ruled between them.
   After that the sky is still but for a faint twinkle, and on a
   mouse or trackpad the stars sit at three depths and shift a
   few pixels with the pointer. Pointing at a star (or focusing
   it) lights its lines and names its neighbours; a filter lights
   its own stars and lets the rest go faint, in place.

   Names are set where they fit without touching another name or
   star, the brightest first; a star with no room is named when
   it is pointed at or focused.

   Intensity: how many lines are drawn, from the bare figures to
   figures with their cross-links. Speed: the twinkle's clock.
   ============================================================ */

interface Star {
  p: SiteProject
  tier: Tier
  cluster: number
  x: number
  y: number
  r: number
  depth: number
  text: string
  /** Label offset from the star's centre, and whether it found room. */
  lx: number
  ly: number
  side: 'r' | 'l' | 'c'
  shown: boolean
  /** When it comes out during the draw-in, 0..1. */
  delay: number
  twinkle: number
}

interface Edge {
  a: number
  b: number
  cross: boolean
  delay: number
}

interface Cluster {
  cat: SiteProject['category']
  name: string
  x: number
  y: number
  shown: boolean
}

interface Chart {
  stars: Star[]
  edges: Edge[]
  clusters: Cluster[]
  type: [number, number, number]
  compact: boolean
}

const DOT = [10, 6.5, 4]

interface Region {
  x: number
  y: number
  w: number
  h: number
}

/** Squarified treemap (Bruls, Huizing, van Wijk): areas in proportion to `values` (sorted, largest first), as square as they come. */
function squarify(values: number[], x: number, y: number, w: number, h: number): Region[] {
  const total = values.reduce((a, b) => a + b, 0) || 1
  const areas = values.map((v) => (v / total) * w * h)
  const out: Region[] = []
  const worst = (row: number[], side: number) => {
    const s = row.reduce((a, b) => a + b, 0)
    return Math.max(...row.map((r) => Math.max((side * side * r) / (s * s), (s * s) / (side * side * r))))
  }
  let i = 0
  while (i < areas.length) {
    const side = Math.min(w, h)
    const row = [areas[i]]
    let j = i + 1
    while (j < areas.length && worst([...row, areas[j]], side) <= worst(row, side)) row.push(areas[j++])
    const s = row.reduce((a, b) => a + b, 0)
    if (w >= h) {
      const sw = s / h
      let yy = y
      for (const a of row) {
        out.push({ x, y: yy, w: sw, h: a / sw })
        yy += a / sw
      }
      x += sw
      w -= sw
    } else {
      const sh = s / w
      let xx = x
      for (const a of row) {
        out.push({ x: xx, y, w: a / sh, h: sh })
        xx += a / sh
      }
      y += sh
      h -= sh
    }
    i = j
  }
  return out
}

function sharedTech(a: string[] | undefined, b: string[] | undefined) {
  if (!a || !b) return 0
  const set = new Set(a)
  return b.reduce((n, t) => n + (set.has(t) ? 1 : 0), 0)
}

function chart(projects: SiteProject[], tech: Record<string, string[]>, w: number, h: number, intensity: number): Chart {
  const n = projects.length
  const compact = w < 560 || h < 300
  // A bigger sky gets brighter stars and larger names, within reason.
  const zoom = Math.min(1.6, Math.max(0.85, Math.sqrt((w * h) / 613000)))
  const kt = 1 + (zoom - 1) * 0.6
  const type: [number, number, number] = compact ? [12, 10.5, 8.5] : [14 * kt, 12 * kt, 9 * kt].map((v) => Math.round(v * 2) / 2) as [number, number, number]
  const margin = compact ? 14 : 22
  const groups = CATEGORY_ORDER.map((cat) => projects.filter((p) => p.category === cat)).filter((g) => g.length)
  const others = projects.filter((p) => !CATEGORY_ORDER.includes(p.category))
  if (others.length) groups.push(others)
  groups.sort((a, b) => b.length - a.length)

  /* ---- each figure gets a share of the sky in proportion to its stars:
          a squarified treemap, so the chart is evenly settled and no
          figure is starved of room for its names ---- */
  const area = w * h
  const regions = squarify(
    groups.map((g) => g.length),
    margin,
    margin,
    w - margin * 2,
    h - margin * 2,
  )
  const anchors = regions.map((r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 }))
  const radius = regions.map((r) => Math.min(r.w, r.h) / 2)

  /* ---- stars: a sunflower inside each figure, headline work at its heart ---- */
  const stars: Star[] = []
  groups.forEach((g, k) => {
    const ordered = [...g].sort((a, b) => tierOf(a) - tierOf(b))
    const spin = hash01(g[0].category, 3) * Math.PI * 2
    const reg = regions[k]
    ordered.forEach((p, i) => {
      const rr = Math.sqrt((i + (g.length === 1 ? 0 : 0.6)) / g.length)
      const a = spin + i * 2.39996
      const tier = tierOf(p)
      stars.push({
        p,
        tier,
        cluster: k,
        x: anchors[k].x + Math.cos(a) * rr * reg.w * 0.41,
        y: anchors[k].y + Math.sin(a) * rr * reg.h * 0.39,
        r: (DOT[tier] * (compact ? 0.9 : zoom)) / 2,
        depth: [1, 0.62, 0.32][tier] + (hash01(p.id, 4) - 0.5) * 0.16,
        text: '',
        lx: 0,
        ly: 0,
        side: 'r',
        shown: false,
        // The chart draws in from left to right, each figure from its heart outwards.
        delay: (anchors[k].x / Math.max(1, w)) * 0.45 + (i / Math.max(1, g.length)) * 0.15,
        twinkle: hash01(p.id, 5) * Math.PI * 2,
      })
    })
  })

  /* ---- keep stars apart (and inside), without breaking up the figures ---- */
  const minD = Math.max(compact ? 20 : 26, Math.sqrt(area / Math.max(1, n)) * 0.5)
  const home = stars.map((s) => ({ x: s.x, y: s.y }))
  for (let it = 0; it < 90; it++) {
    for (let i = 0; i < stars.length; i++) {
      for (let j = i + 1; j < stars.length; j++) {
        const a = stars[i]
        const b = stars[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d = Math.hypot(dx, dy) || 0.01
        const want = a.cluster === b.cluster ? minD : minD * 1.5
        if (d < want) {
          const push = ((want - d) / d) * 0.5
          a.x -= dx * push
          a.y -= dy * push
          b.x += dx * push
          b.y += dy * push
        }
      }
    }
    stars.forEach((s, i) => {
      s.x += (home[i].x - s.x) * 0.04
      s.y += (home[i].y - s.y) * 0.04
      s.x = Math.min(w - margin, Math.max(margin, s.x))
      s.y = Math.min(h - margin, Math.max(margin, s.y))
    })
  }

  /* ---- lines: each figure's spanning tree, then the strongest shared stacks across ---- */
  const edges: Edge[] = []
  const linked = new Set<string>()
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`)
  groups.forEach((_, k) => {
    const idx = stars.map((s, i) => (s.cluster === k ? i : -1)).filter((i) => i >= 0)
    if (idx.length < 2) return
    const inTree = new Set([idx[0]])
    while (inTree.size < idx.length) {
      let best: [number, number, number] | null = null
      for (const a of inTree) {
        for (const b of idx) {
          if (inTree.has(b)) continue
          const d = Math.hypot(stars[a].x - stars[b].x, stars[a].y - stars[b].y) / (1 + 0.35 * sharedTech(tech[stars[a].p.id], tech[stars[b].p.id]))
          if (!best || d < best[2]) best = [a, b, d]
        }
      }
      if (!best) break
      inTree.add(best[1])
      linked.add(key(best[0], best[1]))
      edges.push({ a: best[0], b: best[1], cross: false, delay: stars[best[1]].delay })
    }
    // With more intensity a large figure closes one loop: its shortest unused chord.
    if (intensity > 0.55 && idx.length >= 4) {
      let best: [number, number, number] | null = null
      for (const a of idx) for (const b of idx) {
        if (a >= b || linked.has(key(a, b))) continue
        const d = Math.hypot(stars[a].x - stars[b].x, stars[a].y - stars[b].y)
        if (!best || d < best[2]) best = [a, b, d]
      }
      if (best && best[2] < radius[k] * 1.3) {
        linked.add(key(best[0], best[1]))
        edges.push({ a: best[0], b: best[1], cross: false, delay: Math.max(stars[best[0]].delay, stars[best[1]].delay) })
      }
    }
  })
  const crossBudget = Math.round(intensity * Math.min(8, Math.max(2, n / 6)))
  const reach = Math.hypot(w, h) * 0.42
  if (crossBudget > 0) {
    const pairs: [number, number, number, number][] = []
    for (let a = 0; a < stars.length; a++) {
      for (let b = a + 1; b < stars.length; b++) {
        if (stars[a].cluster === stars[b].cluster) continue
        const shared = sharedTech(tech[stars[a].p.id], tech[stars[b].p.id])
        if (shared < 2) continue
        pairs.push([a, b, shared, Math.hypot(stars[a].x - stars[b].x, stars[a].y - stars[b].y)])
      }
    }
    pairs.sort((p, q) => q[2] - p[2] || p[3] - q[3])
    const perStar = new Map<number, number>()
    for (const [a, b, , d] of pairs) {
      if (edges.filter((e) => e.cross).length >= crossBudget) break
      // One cross-link per star at most, and only between neighbouring figures.
      if (perStar.has(a) || perStar.has(b) || d > reach) continue
      // Never a line that grazes a third star.
      const ax = stars[a].x
      const ay = stars[a].y
      const bx = stars[b].x
      const by = stars[b].y
      const len2 = (bx - ax) ** 2 + (by - ay) ** 2
      const grazes = stars.some((s, i) => {
        if (i === a || i === b) return false
        const t = clamp01(((s.x - ax) * (bx - ax) + (s.y - ay) * (by - ay)) / (len2 || 1))
        return Math.hypot(ax + t * (bx - ax) - s.x, ay + t * (by - ay) - s.y) < minD * 0.45
      })
      if (grazes) continue
      perStar.set(a, (perStar.get(a) ?? 0) + 1)
      perStar.set(b, (perStar.get(b) ?? 0) + 1)
      edges.push({ a, b, cross: true, delay: 0.6 })
    }
  }

  /* ---- names: brightest first, each where it touches nothing ---- */
  const boxes: [number, number, number, number][] = []
  const hits = (x: number, y: number, bw: number, bh: number, pad: number) => {
    if (x < 3 || y < 3 || x + bw > w - 3 || y + bh > h - 3) return true
    for (const b of boxes) if (x < b[0] + b[2] + pad && x + bw + pad > b[0] && y < b[1] + b[3] + pad && y + bh + pad > b[1]) return true
    return false
  }
  const nearStar = (x: number, y: number, bw: number, bh: number, self: number) =>
    stars.some((s, i) => i !== self && s.x + s.r + 5 > x && s.x - s.r - 5 < x + bw && s.y + s.r + 5 > y && s.y - s.r - 5 < y + bh)
  const pad = compact ? 3 : 5
  const order = stars.map((_, i) => i).sort((a, b) => stars[a].tier - stars[b].tier || stars[a].delay - stars[b].delay)
  const clusters: Cluster[] = groups.map((g, k) => ({ cat: g[0].category, name: CATEGORY_LABEL[g[0].category] ?? g[0].category, x: anchors[k].x, y: anchors[k].y, shown: false }))
  const place = (i: number) => {
    const s = stars[i]
    const px = type[s.tier]
    const mono = s.tier === 2
    const maxW = compact ? 120 : 190
    s.text = fitTitle(s.p, maxW, px, mono, mono ? 0.12 : 0)
    const bw = Math.min(maxW, textWidth(s.text, px, mono, mono ? 0.12 : 0))
    const bh = px * 1.25
    const gap = s.r + 5
    const options: [number, number, 'r' | 'l' | 'c'][] = [
      [s.x + gap, s.y - bh / 2, 'r'],
      [s.x - gap - bw, s.y - bh / 2, 'l'],
      [s.x - bw / 2, s.y + gap - 1, 'c'],
      [s.x - bw / 2, s.y - gap - bh + 1, 'c'],
    ]
    for (const [x, y, side] of options) {
      if (hits(x, y, bw, bh, pad) || nearStar(x, y, bw, bh, i)) continue
      boxes.push([x, y, bw, bh])
      Object.assign(s, { lx: x - s.x, ly: y - s.y, side, shown: true })
      return
    }
    Object.assign(s, { lx: gap, ly: -bh / 2, side: 'r', shown: false })
  }
  // Headline names claim their room before the constellations' names, the rest after.
  order.filter((i) => stars[i].tier === 0).forEach(place)
  clusters.forEach((c, k) => {
    const members = stars.filter((s) => s.cluster === k)
    if (members.length < (compact ? 3 : 1)) return
    const bw = textWidth(c.name.toUpperCase(), 9, true, 0.3)
    const bh = 12
    const mid = members.reduce((a, s) => a + s.x, 0) / members.length
    const top = Math.min(...members.map((s) => s.y)) - 24
    const bottom = Math.max(...members.map((s) => s.y)) + 14
    for (const y of [top, bottom]) {
      for (const shift of [0, -0.35, 0.35]) {
        const x = mid - bw / 2 + shift * bw
        // A constellation's name keeps a wider berth, so two never read as one phrase.
        if (hits(x, y, bw, bh, 16) || nearStar(x, y, bw, bh, -1)) continue
        boxes.push([x, y, bw, bh])
        Object.assign(c, { x, y, shown: true })
        return
      }
    }
  })
  order.filter((i) => stars[i].tier > 0).forEach(place)

  return { stars, edges, clusters, type, compact }
}

const INK = '26, 23, 18'
const ACCENT = '191, 79, 39'

function Constellation({ projects, visible, filter, progress, active, reducedMotion, intensity, speed, site, onOpen, onHover }: UniverseAnimationProps) {
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const { w, h } = useBoxSize(root)
  const fine = useFinePointer()
  const sky = useMemo(() => (w > 0 && h > 0 ? chart(projects, site.techByProject, w, h, intensity) : null), [projects, site.techByProject, w, h, intensity])
  const { hot, bind } = useHot(onHover)

  const els = useRef<(HTMLButtonElement | null)[]>([])
  const dots = useRef<(HTMLSpanElement | null)[]>([])
  const names = useRef<(HTMLSpanElement | null)[]>([])
  const sim = useRef({
    t: 0,
    px: 0,
    py: 0,
    tx: 0,
    ty: 0,
    rect: null as DOMRect | null,
    lit: [] as number[],
    hot: -1,
    drawn: '',
  })

  const hotIndex = sky ? sky.stars.findIndex((s) => s.p.slug === hot) : -1
  const near = useMemo(() => {
    const set = new Set<number>()
    if (!sky || hotIndex < 0) return set
    for (const e of sky.edges) {
      if (e.a === hotIndex) set.add(e.b)
      if (e.b === hotIndex) set.add(e.a)
    }
    return set
  }, [sky, hotIndex])

  // Keyboard order: the headline stars first, then each figure's in turn (the drawing is unaffected).
  const tabOrder = useMemo(() => (sky ? sky.stars.map((_, i) => i).sort((a, b) => sky.stars[a].tier - sky.stars[b].tier || a - b) : []), [sky])

  const visibleRef = useRef(visible)
  useEffect(() => {
    visibleRef.current = visible
    sim.current.hot = hotIndex
  }, [visible, hotIndex])

  /** Positions, twinkle and lines for the current state; `still` is the composed, motionless chart. */
  const frame = (dt: number, still: boolean) => {
    const c = canvas.current
    if (!sky || !c) return
    const s = sim.current
    const t = still ? 1 : clamp01((progress.current + 0.06) / 0.3)
    s.t += still ? 0 : dt * speed
    s.px = still ? 0 : approach(s.px, s.tx, 4, dt)
    s.py = still ? 0 : approach(s.py, s.ty, 4, dt)
    const amp = still ? 0 : Math.min(10, w * 0.008)
    const vis = visibleRef.current
    const pos = sky.stars.map((star, i) => {
      const come = still ? 1 : smooth(star.delay, star.delay + 0.3, t)
      const x = star.x + s.px * amp * star.depth
      const y = star.y + s.py * amp * star.depth + (1 - come) * 6
      const el = els.current[i]
      if (el) {
        el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`
        el.style.opacity = come.toFixed(3)
      }
      const dot = dots.current[i]
      if (dot && !still && star.tier > 0) dot.style.opacity = (0.8 + 0.2 * Math.sin(s.t * (0.7 + star.depth) + star.twinkle)).toFixed(3)
      return { x, y }
    })
    sky.clusters.forEach((cl, k) => {
      const el = names.current[k]
      if (el) el.style.opacity = (still ? 1 : smooth(0.2 + (k / sky.clusters.length) * 0.5, 0.5 + (k / sky.clusters.length) * 0.5, t)).toFixed(3)
    })

    // Lines are redrawn only when something about them changed.
    const lit = sky.edges.map((e) => (vis.has(sky.stars[e.a].p.id) && vis.has(sky.stars[e.b].p.id) ? 1 : 0.12))
    sky.edges.forEach((_, k) => {
      s.lit[k] = still || s.lit[k] === undefined ? lit[k] : approach(s.lit[k], lit[k], 6, dt)
    })
    const stamp = `${t.toFixed(3)}|${s.px.toFixed(3)}|${s.py.toFixed(3)}|${s.hot}|${s.lit.map((v) => v.toFixed(2)).join('')}|${w}x${h}`
    if (stamp === s.drawn) return
    s.drawn = stamp
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const g = c.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, h)
    g.lineCap = 'round'
    sky.edges.forEach((e, k) => {
      const a = pos[e.a]
      const b = pos[e.b]
      const ra = sky.stars[e.a].r + 4
      const rb = sky.stars[e.b].r + 4
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      if (len <= ra + rb) return
      const ux = (b.x - a.x) / len
      const uy = (b.y - a.y) / len
      const drawn = still ? 1 : smooth(e.delay + 0.05, e.delay + 0.35, t)
      if (drawn <= 0) return
      const x0 = a.x + ux * ra
      const y0 = a.y + uy * ra
      const x1 = x0 + (len - ra - rb) * drawn * ux
      const y1 = y0 + (len - ra - rb) * drawn * uy
      const isHot = s.hot >= 0 && (e.a === s.hot || e.b === s.hot)
      const base = e.cross ? 0.2 : 0.3
      const alpha = isHot ? 0.85 : base * s.lit[k] * (s.hot >= 0 ? 0.55 : 1)
      g.strokeStyle = `rgba(${isHot ? ACCENT : INK}, ${alpha.toFixed(3)})`
      g.lineWidth = isHot ? 1.25 : 1
      g.setLineDash(e.cross ? [1.5, 4] : [])
      g.beginPath()
      g.moveTo(x0, y0)
      g.lineTo(x1, y1)
      g.stroke()
    })
  }

  // Size the canvas for the box (device pixels, capped at 2) and draw the still state at once.
  useLayoutEffect(() => {
    const c = canvas.current
    if (!c || !w || !h) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
    sim.current.drawn = ''
  }, [w, h])
  useLayoutEffect(() => {
    sim.current.drawn = ''
    frame(0, reducedMotion)
  })

  useTicker(active && !reducedMotion && !!sky, (dt) => frame(dt, false))

  // Pointer parallax, on a mouse or trackpad only. The box's place is read when the pointer enters, never per frame.
  useEffect(() => {
    const el = root.current
    if (!el || !fine || reducedMotion) return
    const s = sim.current
    const enter = () => {
      s.rect = el.getBoundingClientRect()
    }
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      if (!s.rect) s.rect = el.getBoundingClientRect()
      s.tx = clamp01((e.clientX - s.rect.left) / s.rect.width) * 2 - 1
      s.ty = clamp01((e.clientY - s.rect.top) / s.rect.height) * 2 - 1
    }
    const leave = () => {
      s.tx = 0
      s.ty = 0
      s.rect = null
    }
    const scrolled = () => {
      s.rect = null
    }
    el.addEventListener('pointerenter', enter)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    window.addEventListener('scroll', scrolled, { passive: true })
    return () => {
      el.removeEventListener('pointerenter', enter)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
      window.removeEventListener('scroll', scrolled)
    }
  }, [fine, reducedMotion])

  const style = useMemo(() => {
    if (!sky) return undefined
    const [a, b, c] = sky.type
    return { '--t0': `${a}px`, '--t1': `${b}px`, '--t2': `${c}px` } as CSSProperties
  }, [sky])

  return (
    <div ref={root} className={styles.root} role="group" aria-label="Project archive" style={style}>
      <canvas ref={canvas} className={styles.lines} aria-hidden="true" />
      {sky?.clusters.map((c, k) =>
        c.shown ? (
          <span
            key={c.cat}
            ref={(el) => {
              names.current[k] = el
            }}
            className={styles.cluster}
            aria-hidden="true"
            data-on={filter !== 'all' && sky.stars.some((s) => s.cluster === k && visible.has(s.p.id)) ? true : undefined}
            data-off={filter !== 'all' && !sky.stars.some((s) => s.cluster === k && visible.has(s.p.id)) ? true : undefined}
            style={{ transform: `translate3d(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px, 0)` }}
          >
            {c.name}
          </span>
        ) : null,
      )}
      {sky && tabOrder.map((i) => {
        const s = sky.stars[i]
        const dim = !visible.has(s.p.id)
        return (
          <button
            key={s.p.id}
            ref={(el) => {
              els.current[i] = el
            }}
            type="button"
            className={styles.star}
            data-tier={s.tier}
            data-dim={dim || undefined}
            data-hot={hot === s.p.slug || undefined}
            data-near={near.has(i) || undefined}
            data-named={s.shown || undefined}
            data-side={s.side}
            aria-hidden={dim || undefined}
            tabIndex={dim ? -1 : 0}
            aria-label={labelOf(s.p, s.text)}
            data-cursor="view"
            onClick={() => onOpen(s.p.slug)}
            style={{ '--tone': toneOf(s.p), '--d': `${(s.r * 2).toFixed(1)}px`, '--lx': `${s.lx.toFixed(1)}px`, '--ly': `${s.ly.toFixed(1)}px` } as CSSProperties}
            {...bind(s.p.slug)}
          >
            <span className={styles.inner}>
              {s.tier === 0 && <span className={styles.spikes} />}
              <span
                className={styles.dot}
                ref={(el) => {
                  dots.current[i] = el
                }}
              />
              <span className={styles.name}>{s.text}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

export default memo(Constellation)
