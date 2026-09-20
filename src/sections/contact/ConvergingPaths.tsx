'use client'

import type { ContactAnimationProps } from '../types'
import { TAU, clamp01, css, easeInOut, easeOut, field, lerp, mix, resample, rng, routeFrom, sd, smooth, useContactCanvas, type Painter, type Rect, type Stage } from './shared'

/* ============================================================
   CONVERGING PATHS

   Routes come in from both edges of the stage and find their way,
   around the words, to one destination beside the closing answer —
   below it where the layout leaves room, above it where it does not.
   A route that meets one plotted before it runs on along it, so the
   map reads as tributaries gathering into a few roads, not as lines
   crossing.

   The map plots itself first, as dotted routes reaching in from the
   edges. Then a traveller sets out along each, all at one pace and
   the farthest first, so they meet where their routes meet and arrive
   together just after the answer does; the ground they have covered
   turns to a solid teal line behind them. The destination lights in
   the accent as they arrive, and from then on a slow stream keeps
   coming in along every route.

   Each route is found on a grid that refuses cells too close to a
   word, pulled taut, drawn as a spline through what is left and
   checked again point by point, so the travellers' rings and the
   stream stay clear of every safe rectangle; the destination is
   placed where its ripple has room.

   intensity → number of paths · speed → the stream and the ripple
   ============================================================ */

const PAD = 2.5
/** The largest ring a traveller grows as others join it. */
const RING = 8
const ARRIVE = 0.78
const STEP = 3

type Pt = [number, number]

interface Route {
  /** Points from the destination outward to the edge, every STEP px. */
  xs: Float32Array
  ys: Float32Array
  L: number
  reveal0: number
  reveal1: number
  depart: number
}

interface Scene {
  routes: Route[]
  dx: number; dy: number
  ripple: number
  junctions: { x: number; y: number; d: number; route: number }[]
  ink: Record<'dot' | 'walked' | 'traveller' | 'ring' | 'junction' | 'mark' | 'accent' | 'accentSoft' | 'stream', string>
  u: number
}

/** The destination: just below the closing words if there is room, else just above, else beside them. */
function destination(stage: Stage, need: number): Pt | null {
  const { keep, head, w, h, top, foot } = stage
  const hx = head ? head.x + head.w / 2 : w / 2
  const tries: [number, number, number, number][] = head
    ? [[hx, head.y + head.h, 0, 1], [hx, head.y, 0, -1], [head.x, head.y + head.h / 2, -1, 0], [head.x + head.w, head.y + head.h / 2, 1, 0]]
    : [[w / 2, (top + foot) / 2, 0, 1]]
  for (const [x0, y0, ux, uy] of tries) {
    for (let t = 0; t < Math.max(w, h) * 0.3; t += 2) {
      const x = x0 + ux * t, y = y0 + uy * t
      if (x < need || x > w - need || y < top || y > foot) break
      if (sd(keep, x, y) >= need) return [x, y]
    }
  }
  return null
}

const clearSeg = (keep: Rect[], a: Pt, b: Pt, need: number) => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  for (let s = 0; s <= len; s += 2.5) {
    const t = len > 0 ? s / len : 0
    if (sd(keep, lerp(a[0], b[0], t), lerp(a[1], b[1], t)) < need) return false
  }
  return true
}

/** Centripetal Catmull-Rom through `w`, sampled densely. */
function spline(w: Pt[]): Pt[] {
  if (w.length < 3) return w.slice()
  const p = [w[0], ...w, w[w.length - 1]]
  const out: Pt[] = []
  for (let i = 1; i < p.length - 2; i++) {
    const [p0, p1, p2, p3] = [p[i - 1], p[i], p[i + 1], p[i + 2]]
    const d = (a: Pt, b: Pt) => Math.max(1e-3, Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5)
    const t1 = d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3)
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 2))
    for (let k = 0; k < n; k++) {
      const t = t1 + ((t2 - t1) * k) / n
      const L = (a: Pt, b: Pt, ta: number, tb: number): Pt => [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)]
      const a1 = L(p0, p1, 0, t1), a2 = L(p1, p2, t1, t2), a3 = L(p2, p3, t2, t3)
      const b1 = L(a1, a2, 0, t2), b2 = L(a2, a3, t1, t3)
      out.push(L(b1, b2, t1, t2))
    }
  }
  out.push(w[w.length - 1])
  return out
}

/**
 * A smooth route through the grid's: pulled taut (each kept point
 * jumps to the farthest one it can see with room to spare), then a
 * spline through what is left; wherever the spline strays too near a
 * word, the grid route's own points are let back in and it is fitted
 * again.
 */
function smoothRoute(grid: Pt[], keep: Rect[], need: number): Pt[] {
  const keepIdx = [0]
  for (let i = 0; i < grid.length - 1;) {
    let j = i + 1
    while (j + 1 < grid.length && clearSeg(keep, grid[i], grid[j + 1], need + 4)) j++
    keepIdx.push(j)
    i = j
  }
  let idx = keepIdx
  for (let round = 0; round < 6; round++) {
    const curve = spline(idx.map((i) => grid[i]))
    let bad = -1
    for (let k = 0; k < curve.length; k++) if (sd(keep, curve[k][0], curve[k][1]) < need) { bad = k; break }
    if (bad < 0) return curve
    // Let back in every grid point between the waypoints around the stray stretch.
    const near = curve[bad]
    let seg = 0, best = Infinity
    for (let k = 0; k < idx.length - 1; k++) {
      const [a, b] = [grid[idx[k]], grid[idx[k + 1]]]
      const dd = Math.min(Math.hypot(near[0] - a[0], near[1] - a[1]), Math.hypot(near[0] - b[0], near[1] - b[1]))
      if (dd < best) { best = dd; seg = k }
    }
    const lo = idx[Math.max(0, seg - 1)], hi = idx[Math.min(idx.length - 1, seg + 2)]
    const more: number[] = []
    for (let i = lo; i <= hi; i += 2) more.push(i)
    idx = Array.from(new Set([...idx, ...more, hi])).sort((a, b) => a - b)
  }
  return grid
}

const painter: Painter<Scene> = {
  compose(stage, intensity, pal) {
    const { w, h, keep, u } = stage
    const cell = Math.max(6, 8 * u)
    const draw = PAD + RING + 1
    const ripple = 22 * Math.max(0.6, u)
    const ink = {
      dot: css(mix(pal.bg, pal.ink4, 0.78)),
      walked: css(pal.signal, 0.62),
      traveller: css(pal.ink2),
      ring: css(pal.ink3, 0.55),
      junction: css(pal.ink4, 0.85),
      mark: css(pal.ink3, 0.7),
      accent: css(pal.accent),
      accentSoft: css(pal.accent, 0.45),
      stream: css(pal.signal, 0.6),
    }
    const d = destination(stage, PAD + ripple + 2)
    if (!d) return { routes: [], dx: 0, dy: 0, ripple, junctions: [], ink, u }
    const [dx, dy] = d
    const r = rng(0xc0ffee)
    // A gentle, low-frequency unevenness in the ground, so the routes are not all alike.
    const waves = Array.from({ length: 3 }, () => [r() * TAU, r() * TAU, (0.7 + r()) / Math.max(w, h)] as const)
    const terrain = (x: number, y: number) => waves.reduce((s, [a, b, f]) => s + Math.sin(x * f * TAU + a) * Math.cos(y * f * TAU + b), 0) / 3
    const gridNeed = draw + cell * 0.8
    const f = field(w, h, cell, (x, y) => {
      const rm = sd(keep, x, y)
      if (rm < gridNeed) return Infinity
      return 1 + 24 / (rm - gridNeed + 10) + 0.6 * (1 + terrain(x, y))
    }, [[dx, dy]])

    // Starts: spread over the reachable stretches of both edges.
    const count = 2 + Math.round(intensity * 6)
    const starts: [number, number][] = []
    const per = [Math.ceil(count / 2), Math.floor(count / 2)]
    ;[0, f.cols - 1].forEach((col, s) => {
      const rows: number[] = []
      for (let j = 0; j < f.rows; j++) if (Number.isFinite(f.dist[j * f.cols + col])) rows.push(j)
      if (!rows.length) return
      const n = Math.min(per[s], Math.max(1, Math.floor(rows.length / 7)))
      for (let k = 0; k < n; k++) {
        const q = n === 1 ? 0.5 : 0.06 + (0.88 * k) / (n - 1)
        starts.push([col, rows[Math.round(q * (rows.length - 1))]])
      }
    })

    // Each route from its edge to the destination, smooth; the farthest first.
    const lines = starts
      .map(([i, j]) => {
        const grid = routeFrom(f, j * f.cols + i, 0) as Pt[]
        if (grid.length < 3) return null
        grid[grid.length - 1] = [dx, dy]
        const pts = smoothRoute(grid, keep, draw)
        pts.unshift([pts[0][0] < w / 2 ? -8 : w + 8, pts[0][1]])
        return resample(pts, STEP)
      })
      .filter((x): x is NonNullable<typeof x> => !!x && x.xs.length > 3)
      .sort((a, b) => b.xs.length - a.xs.length)

    /* Tributaries: a route that comes within a few px of one already
       laid joins it — a short curve onto it, then its very points to
       the destination — so shared stretches are one road. */
    const laid: { xs: number[]; ys: number[] }[] = []
    const junctions: Scene['junctions'] = []
    const routes: Route[] = []
    const SNAP = 9, BLEND = 12
    for (const ln of lines) {
      let xs = ln.xs, ys = ln.ys
      let joinAt = -1
      search: for (let k = 0; k < xs.length; k++) {
        for (let q = 0; q < laid.length; q++) {
          const o = laid[q]
          for (let m = 0; m < o.xs.length; m += 2) {
            if (Math.abs(o.xs[m] - xs[k]) < SNAP && Math.abs(o.ys[m] - ys[k]) < SNAP && Math.hypot(o.xs[m] - xs[k], o.ys[m] - ys[k]) < SNAP) {
              const a = Math.max(1, k - BLEND), b = Math.min(o.xs.length - 1, m + BLEND)
              // The blend: a cubic from where this route was, along its heading, onto the other's heading.
              const [ax, ay] = [xs[a], ys[a]], [bx, by] = [o.xs[b], o.ys[b]]
              const h1x = xs[a] - xs[a - 1], h1y = ys[a] - ys[a - 1], h2x = o.xs[Math.min(o.xs.length - 1, b + 1)] - o.xs[b], h2y = o.ys[Math.min(o.ys.length - 1, b + 1)] - o.ys[b]
              const span = Math.hypot(bx - ax, by - ay) / 3
              const n1 = Math.hypot(h1x, h1y) || 1, n2 = Math.hypot(h2x, h2y) || 1
              const blend: Pt[] = []
              for (let t = 0; t <= 1.0001; t += 0.05) {
                const c1x = ax + (h1x / n1) * span, c1y = ay + (h1y / n1) * span, c2x = bx - (h2x / n2) * span, c2y = by - (h2y / n2) * span
                const it = 1 - t
                blend.push([it ** 3 * ax + 3 * it * it * t * c1x + 3 * it * t * t * c2x + t ** 3 * bx, it ** 3 * ay + 3 * it * it * t * c1y + 3 * it * t * t * c2y + t ** 3 * by])
              }
              if (!blend.every(([x, y]) => sd(keep, x, y) >= draw)) continue
              // From the junction on, the other route's very points, so the stretch is printed once.
              const own = resample([...Array.from(xs.slice(0, a), (x, i): Pt => [x, ys[i]]), ...blend], STEP)
              xs = [...own.xs, ...o.xs.slice(b + 1)]
              ys = [...own.ys, ...o.ys.slice(b + 1)]
              joinAt = (xs.length - 1 - own.xs.length) * STEP
              break search
            }
          }
        }
      }
      laid.push({ xs: Array.from(xs), ys: Array.from(ys) })
      // From the destination outward, with dots phased from it.
      const bx = Float32Array.from(xs).reverse(), by = Float32Array.from(ys).reverse()
      if (joinAt > 0) junctions.push({ x: bx[Math.round(joinAt / STEP)], y: by[Math.round(joinAt / STEP)], d: joinAt, route: routes.length })
      routes.push({ xs: bx, ys: by, L: (bx.length - 1) * STEP, reveal0: 0, reveal1: 0, depart: 0 })
    }
    // One pace for everyone, set by the longest route: each leaves when it must to arrive with the rest.
    const longest = routes.reduce((m, rt) => Math.max(m, rt.L), 1)
    routes.forEach((rt, i) => {
      rt.depart = ARRIVE - (rt.L / longest) * 0.44
      rt.reveal0 = 0.08 + 0.1 * (i / Math.max(1, routes.length - 1))
      rt.reveal1 = Math.min(rt.depart, rt.reveal0 + 0.3)
    })
    return { routes, dx, dy, ripple: Math.min(ripple, sd(keep, dx, dy) - PAD - 1), junctions, ink, u }
  },

  draw(ctx, sc, f) {
    if (!sc.routes.length) return
    const { dx, dy, ink } = sc
    const dots = new Path2D(), walked = new Path2D()
    const travellers: Pt[] = []
    const plotted = (rt: Route) => rt.L * easeInOut(clamp01((f.p - rt.reveal0) / Math.max(0.01, rt.reveal1 - rt.reveal0)))
    for (const rt of sc.routes) {
      const n = rt.xs.length
      // Plotting: the dotted route reaches in from the edge.
      const shown = plotted(rt)
      if (shown <= 0) continue
      const from = Math.max(0, Math.floor((rt.L - shown) / STEP))
      // Walking: everyone at the same pace, arriving together.
      const walk = clamp01((f.p - rt.depart) / (ARRIVE - rt.depart))
      const at = f.p >= rt.depart ? rt.L * (1 - easeInOut(walk)) : Infinity
      const atK = Math.min(n - 1, Math.ceil(at / STEP))
      // Dots every other sample, phased from the destination, so shared stretches print one set.
      for (let k = from + (from % 2); k < Math.min(n, at === Infinity ? n : atK); k += 2) {
        dots.moveTo(rt.xs[k] + 1.05, rt.ys[k])
        dots.arc(rt.xs[k], rt.ys[k], 1.05, 0, TAU)
      }
      if (at !== Infinity) {
        walked.moveTo(rt.xs[n - 1], rt.ys[n - 1])
        for (let k = n - 2; k >= atK; k--) walked.lineTo(rt.xs[k], rt.ys[k])
        const fk = Math.min(n - 1.001, at / STEP), k0 = Math.floor(fk), t = fk - k0
        const tx = lerp(rt.xs[k0], rt.xs[k0 + 1], t), ty = lerp(rt.ys[k0], rt.ys[k0 + 1], t)
        walked.lineTo(tx, ty)
        if (walk < 1) travellers.push([tx, ty])
      }
    }
    ctx.fillStyle = ink.dot
    ctx.fill(dots)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = ink.walked
    ctx.lineWidth = 1.1
    ctx.stroke(walked)

    // Where routes meet: a small open ring once the plot has reached it.
    ctx.strokeStyle = ink.junction
    ctx.lineWidth = 0.9
    for (const j of sc.junctions) {
      const rt = sc.routes[j.route]
      const past = plotted(rt) - (rt.L - j.d)
      if (past <= 0) continue
      ctx.beginPath()
      ctx.arc(j.x, j.y, 3.2 * easeOut(clamp01(past / 40)), 0, TAU)
      ctx.stroke()
    }

    // The stream, once everyone has arrived: dots running in along every route, phased by distance so shared stretches carry one stream.
    const after = smooth(ARRIVE, ARRIVE + 0.1, f.p)
    if (after > 0 && !f.still) {
      const gap = 46 * Math.max(0.7, sc.u)
      const run = (f.t * 34 * Math.max(0.7, sc.u)) % gap
      const stream = new Path2D()
      for (const rt of sc.routes) {
        for (let d = gap - run; d < rt.L; d += gap) {
          const k = Math.min(rt.xs.length - 1, Math.round(d / STEP))
          const r = 1.5 * clamp01(d / 30) * clamp01((rt.L - d) / 40)
          if (r < 0.2) continue
          stream.moveTo(rt.xs[k] + r, rt.ys[k])
          stream.arc(rt.xs[k], rt.ys[k], r, 0, TAU)
        }
      }
      ctx.globalAlpha = after
      ctx.fillStyle = ink.stream
      ctx.fill(stream)
      ctx.globalAlpha = 1
    }

    // Travellers: one dot each; where several walk together, one dot with a ring that grows with the company.
    const company: [number, number, number][] = []
    for (const [x, y] of travellers) {
      const near = company.find(([a, b]) => Math.hypot(a - x, b - y) < 1.5)
      if (near) near[2]++
      else company.push([x, y, 1])
    }
    for (const [x, y, n] of company) {
      ctx.fillStyle = ink.traveller
      ctx.beginPath()
      ctx.arc(x, y, 2.6, 0, TAU)
      ctx.fill()
      ctx.strokeStyle = ink.ring
      ctx.lineWidth = 0.9
      ctx.beginPath()
      ctx.arc(x, y, Math.min(RING, 4.4 + 1.2 * (n - 1)), 0, TAU)
      ctx.stroke()
    }

    // The destination: a quiet mark while the map plots, the accent when they arrive, then a slow ripple.
    const lit = smooth(ARRIVE - 0.02, ARRIVE + 0.06, f.p)
    const ready = Math.max(...sc.routes.map((rt) => plotted(rt) / rt.L))
    if (ready > 0) {
      ctx.globalAlpha = smooth(0.2, 0.7, ready)
      ctx.strokeStyle = ink.mark
      ctx.lineWidth = 0.9
      ctx.beginPath()
      ctx.arc(dx, dy, 6.5, 0, TAU)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
    if (lit > 0) {
      ctx.fillStyle = ink.accent
      ctx.beginPath()
      ctx.arc(dx, dy, 4.2 * easeOut(lit), 0, TAU)
      ctx.fill()
      if (!f.still && sc.ripple > 8) {
        const cyc = (f.t / 3.6) % 1
        ctx.globalAlpha = lit * (1 - cyc) * 0.8
        ctx.strokeStyle = ink.accentSoft
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(dx, dy, 6.5 + (sc.ripple - 6.5) * easeOut(cyc), 0, TAU)
        ctx.stroke()
        ctx.globalAlpha = 1
      }
    }
  },
}

export default function ConvergingPaths(props: ContactAnimationProps) {
  const { rootRef, canvasRef, rootStyle, canvasStyle } = useContactCanvas('contact.converging-paths', props, painter)
  return (
    <div ref={rootRef} style={rootStyle}>
      <canvas ref={canvasRef} style={canvasStyle} />
    </div>
  )
}
