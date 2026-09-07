'use client'

/* ============================================================
   LABYRINTH — maze generator + search visualiser
   Three beats on one grid:
     01 CARVE   iterative-DFS recursive backtracker carves the
                maze live; the explicit stack trails behind the
                cursor as a ribbon and visibly pops at dead ends.
     02 SEARCH  the finished maze floods twice from the same cell
                at one shared expansion rate — BFS as a cool
                concentric wavefront, A* as a warm body dragged
                toward the goal. Cells are coloured by which
                search owns them, so the two shapes never blend.
     03 PATH    the maze is a spanning tree, so there is exactly
                one path and both searches return it; the two
                expansion counts settle side by side.
   Everything drawn is the real algorithm: real recursive
   backtracker step stream, real BFS queue order, real A* with a
   Manhattan heuristic and a binary heap. Counts are measured, not
   invented — including the honest one, that a perfect maze barely
   rewards a heuristic (A* expands ~90% of what BFS does, because
   the corridor length dwarfs the straight-line estimate).
   ============================================================ */

import { useEffect, useRef, useState } from 'react'
import { useCanvas2D } from '@/hooks/useCanvas2D'
import { clamp, easeInOutCubic, easeOutCubic, lerp, range, seeded } from '@/lib/math'
import { readPalette, type ProjectVisualProps } from './types'
import styles from './visual.module.css'

/* ---- grid constants: 0=N 1=E 2=S 3=W ---------------------- */
const DX = [0, 1, 0, -1]
const DY = [-1, 0, 1, 0]
const BIT = [1, 2, 4, 8]
const OPP = [4, 8, 1, 2]

const SEED0 = 0x5f3a71c9
const CYCLE = 26 // seconds for one self-running pass

/* beat boundaries on the 0..1 timeline */
const CARVE_A = 0.045
const CARVE_B = 0.46
const SETTLE = 0.545
const SEARCH_B = 0.845
const PATH_B = 0.965

type Focus = 'both' | 'bfs' | 'astar'
type Handle = 'start' | 'goal'

interface Maze {
  cols: number
  rows: number
  n: number
  /** number of recorded carve steps (2 * n) */
  steps: number
  stepCell: Int32Array
  /** +1 push (carve into a new cell), -1 pop (dead end) */
  stepKind: Int8Array
  stepFrom: Int32Array
  /** step index at which a cell was first entered, -1 if never */
  visitOrder: Int32Array
  /** finished wall bitmask per cell */
  walls: Uint8Array
  /** scratch: wall state replayed to an arbitrary step */
  wallsNow: Uint8Array
  /** scratch: the generator's stack replayed to an arbitrary step */
  stack: Int32Array
}

interface Search {
  order: Int32Array
  /** expansion index per cell, -1 if never expanded */
  at: Int32Array
  dist: Int32Array
  parent: Int32Array
  path: Int32Array
  pathLen: number
  count: number
}

interface Scene {
  cols: number
  rows: number
  cell: number
  ox: number
  oy: number
  padX: number
  padTop: number
  padBottom: number
  fs: number
  maze: Maze
  bfs: Search
  astar: Search
  carveOrigin: number
  start: number
  goal: number
  mark: Uint8Array
  queue: Int32Array
  heap: Int32Array
  gScore: Float64Array
  fScore: Float64Array
  hScore: Float64Array
}

interface Ends {
  sx: number
  sy: number
  gx: number
  gy: number
}

interface Runtime {
  ctx: CanvasRenderingContext2D | null
  w: number
  h: number
  t: number
  offset: number
  dragging: Handle | null
  hover: Handle | null
}

/* ---------- geometry --------------------------------------- */

function ccx(sc: Scene, i: number) {
  return sc.ox + (i % sc.cols) * sc.cell + sc.cell / 2
}
function ccy(sc: Scene, i: number) {
  return sc.oy + ((i / sc.cols) | 0) * sc.cell + sc.cell / 2
}
function chebyshev(sc: Scene, a: number, b: number) {
  const ax = a % sc.cols
  const bx = b % sc.cols
  const ay = (a / sc.cols) | 0
  const by = (b / sc.cols) | 0
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by))
}

function layout(w: number, h: number) {
  const fs = clamp(Math.min(w * 0.017, h * 0.028), 8, 10.5)
  const padX = Math.round(clamp(w * 0.05, 14, 34))
  const padTop = Math.round(clamp(h * 0.17, 24 + fs * 1.8, 30 + fs * 2.4))
  const padBottom = Math.round(clamp(h * 0.16, 22 + fs * 1.4, 30 + fs * 1.8))
  const plotW = Math.max(48, w - padX * 2)
  const plotH = Math.max(36, h - padTop - padBottom)
  const target = clamp(Math.min(plotW, plotH) / 15, 10, 26)
  const cols = Math.round(clamp(Math.floor(plotW / target), 7, 41))
  const rows = Math.round(clamp(Math.floor(plotH / target), 5, 27))
  const cell = Math.max(5, Math.floor(Math.min(plotW / cols, plotH / rows)))
  const ox = Math.round(padX + (plotW - cols * cell) / 2)
  const oy = Math.round(padTop + (plotH - rows * cell) / 2)
  return { cols, rows, cell, ox, oy, padX, padTop, padBottom, fs }
}

/* ---------- generator: iterative-DFS recursive backtracker -- */

function buildMaze(cols: number, rows: number, origin: number, seed: number): Maze {
  const n = cols * rows
  const walls = new Uint8Array(n)
  walls.fill(15)
  const visitOrder = new Int32Array(n)
  visitOrder.fill(-1)
  const maxSteps = 2 * n
  const stepCell = new Int32Array(maxSteps)
  const stepKind = new Int8Array(maxSteps)
  const stepFrom = new Int32Array(maxSteps)
  const stack = new Int32Array(n + 1)
  const cand = new Int32Array(4)
  const rnd = seeded(seed)

  let sp = 0
  let s = 0
  stack[sp++] = origin
  visitOrder[origin] = 0
  stepCell[0] = origin
  stepKind[0] = 1
  stepFrom[0] = -1
  s = 1

  while (sp > 0 && s < maxSteps) {
    const c = stack[sp - 1]
    const cx = c % cols
    const cy = (c / cols) | 0
    let m = 0
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d]
      const ny = cy + DY[d]
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
      if (visitOrder[ny * cols + nx] >= 0) continue
      cand[m++] = d
    }
    if (m === 0) {
      sp--
      stepCell[s] = c
      stepKind[s] = -1
      stepFrom[s] = -1
      s++
      continue
    }
    const d = cand[Math.min(m - 1, Math.floor(rnd() * m))]
    const ni = (cy + DY[d]) * cols + (cx + DX[d])
    walls[c] &= ~BIT[d]
    walls[ni] &= ~OPP[d]
    visitOrder[ni] = s
    stack[sp++] = ni
    stepCell[s] = ni
    stepKind[s] = 1
    stepFrom[s] = c
    s++
  }

  return {
    cols,
    rows,
    n,
    steps: s,
    stepCell,
    stepKind,
    stepFrom,
    visitOrder,
    walls,
    wallsNow: new Uint8Array(n),
    stack,
  }
}

function dirOf(from: number, to: number, cols: number) {
  const d = to - from
  if (d === 1) return 1
  if (d === -1) return 3
  if (d === cols) return 2
  return 0
}

/** Replays the generator to step k. Fills wallsNow, returns stack depth. */
function replayTo(m: Maze, k: number) {
  const { stepKind, stepCell, stepFrom, stack, wallsNow, cols } = m
  wallsNow.fill(15)
  let sp = 0
  for (let i = 0; i < k; i++) {
    if (stepKind[i] === 1) {
      const c = stepCell[i]
      const f = stepFrom[i]
      if (f >= 0) {
        const d = dirOf(f, c, cols)
        wallsNow[f] &= ~BIT[d]
        wallsNow[c] &= ~OPP[d]
      }
      stack[sp++] = c
    } else if (sp > 0) {
      sp--
    }
  }
  return sp
}

/* ---------- solvers ---------------------------------------- */

function createSearch(n: number): Search {
  return {
    order: new Int32Array(n),
    at: new Int32Array(n),
    dist: new Int32Array(n),
    parent: new Int32Array(n),
    path: new Int32Array(n),
    pathLen: 0,
    count: 0,
  }
}

function indexOrder(out: Search) {
  out.at.fill(-1)
  for (let i = 0; i < out.count; i++) out.at[out.order[i]] = i
}

function buildPath(out: Search, start: number, goal: number) {
  const p = out.path
  let c = goal
  let len = 0
  while (c >= 0 && len < p.length) {
    p[len++] = c
    if (c === start) break
    c = out.parent[c]
  }
  if (len === 0 || p[len - 1] !== start) {
    out.pathLen = 0
    return
  }
  for (let i = 0, j = len - 1; i < j; i++, j--) {
    const t = p[i]
    p[i] = p[j]
    p[j] = t
  }
  out.pathLen = len
}

function solveBFS(m: Maze, start: number, goal: number, out: Search, mark: Uint8Array, queue: Int32Array) {
  const { cols, rows, walls } = m
  mark.fill(0)
  out.parent.fill(-1)
  out.dist.fill(-1)
  let head = 0
  let tail = 0
  queue[tail++] = start
  mark[start] = 1
  out.dist[start] = 0
  let count = 0
  while (head < tail) {
    const c = queue[head++]
    out.order[count++] = c
    if (c === goal) break
    const cx = c % cols
    const cy = (c / cols) | 0
    for (let d = 0; d < 4; d++) {
      if (walls[c] & BIT[d]) continue
      const nx = cx + DX[d]
      const ny = cy + DY[d]
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
      const ni = ny * cols + nx
      if (mark[ni]) continue
      mark[ni] = 1
      out.parent[ni] = c
      out.dist[ni] = out.dist[c] + 1
      queue[tail++] = ni
    }
  }
  out.count = count
  indexOrder(out)
  buildPath(out, start, goal)
}

function solveAStar(
  m: Maze,
  start: number,
  goal: number,
  out: Search,
  mark: Uint8Array,
  g: Float64Array,
  f: Float64Array,
  hCost: Float64Array,
  heap: Int32Array,
) {
  const { cols, rows, walls } = m
  mark.fill(0)
  out.parent.fill(-1)
  out.dist.fill(-1)
  g.fill(Infinity)
  const gx = goal % cols
  const gy = (goal / cols) | 0
  const cap = heap.length
  let size = 0

  const before = (a: number, b: number) => (f[a] !== f[b] ? f[a] < f[b] : hCost[a] < hCost[b])
  const push = (v: number) => {
    if (size >= cap) return
    let i = size++
    heap[i] = v
    while (i > 0) {
      const par = (i - 1) >> 1
      if (!before(heap[i], heap[par])) break
      const tmp = heap[par]
      heap[par] = heap[i]
      heap[i] = tmp
      i = par
    }
  }
  const pop = () => {
    const top = heap[0]
    size--
    if (size > 0) {
      heap[0] = heap[size]
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let b = i
        if (l < size && before(heap[l], heap[b])) b = l
        if (r < size && before(heap[r], heap[b])) b = r
        if (b === i) break
        const tmp = heap[b]
        heap[b] = heap[i]
        heap[i] = tmp
        i = b
      }
    }
    return top
  }

  g[start] = 0
  hCost[start] = Math.abs((start % cols) - gx) + Math.abs(((start / cols) | 0) - gy)
  f[start] = hCost[start]
  out.dist[start] = 0
  push(start)

  let count = 0
  while (size > 0) {
    const c = pop()
    if (mark[c]) continue
    mark[c] = 1
    out.order[count++] = c
    if (c === goal) break
    const cx = c % cols
    const cy = (c / cols) | 0
    for (let d = 0; d < 4; d++) {
      if (walls[c] & BIT[d]) continue
      const nx = cx + DX[d]
      const ny = cy + DY[d]
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue
      const ni = ny * cols + nx
      if (mark[ni]) continue
      const ng = g[c] + 1
      if (ng < g[ni]) {
        g[ni] = ng
        out.parent[ni] = c
        out.dist[ni] = ng
        hCost[ni] = Math.abs(nx - gx) + Math.abs(ny - gy)
        f[ni] = ng + hCost[ni]
        push(ni)
      }
    }
  }
  out.count = count
  indexOrder(out)
  buildPath(out, start, goal)
}

function solveAll(sc: Scene) {
  solveBFS(sc.maze, sc.start, sc.goal, sc.bfs, sc.mark, sc.queue)
  solveAStar(sc.maze, sc.start, sc.goal, sc.astar, sc.mark, sc.gScore, sc.fScore, sc.hScore, sc.heap)
}

function makeScene(w: number, h: number, seed: number, ends: Ends): Scene {
  const l = layout(w, h)
  const { cols, rows } = l
  const n = cols * rows
  const sx = Math.round(clamp(ends.sx, 0, 1) * (cols - 1))
  const sy = Math.round(clamp(ends.sy, 0, 1) * (rows - 1))
  const gx = Math.round(clamp(ends.gx, 0, 1) * (cols - 1))
  const gy = Math.round(clamp(ends.gy, 0, 1) * (rows - 1))
  const start = sy * cols + sx
  let goal = gy * cols + gx
  if (goal === start) goal = start === n - 1 ? 0 : n - 1
  const sc: Scene = {
    ...l,
    maze: buildMaze(cols, rows, start, seed),
    bfs: createSearch(n),
    astar: createSearch(n),
    carveOrigin: start,
    start,
    goal,
    mark: new Uint8Array(n),
    queue: new Int32Array(n + 1),
    heap: new Int32Array(2 * n + 8),
    gScore: new Float64Array(n),
    fScore: new Float64Array(n),
    hScore: new Float64Array(n),
  }
  solveAll(sc)
  return sc
}

/* ---------- drawing primitives ------------------------------ */

function setTracking(ctx: CanvasRenderingContext2D, v: string) {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string }
  if ('letterSpacing' in c) c.letterSpacing = v
}

function tinyText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  alpha: number,
  align: CanvasTextAlign,
  track: string,
) {
  if (alpha <= 0.012) return
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.font = `${size}px ui-monospace, monospace`
  ctx.textAlign = align
  ctx.textBaseline = 'alphabetic'
  setTracking(ctx, track)
  ctx.fillText(text, x, y)
  setTracking(ctx, '0px')
  ctx.globalAlpha = 1
}

/** Fills cells order[from..to) as inset squares in one path. */
function bandFill(
  ctx: CanvasRenderingContext2D,
  sc: Scene,
  order: Int32Array,
  from: number,
  to: number,
  color: string,
  alpha: number,
) {
  if (to <= from || alpha <= 0.006) return
  const { cell, cols, ox, oy } = sc
  const inset = Math.max(0.6, cell * 0.16)
  const s = cell - inset * 2
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.beginPath()
  for (let i = Math.max(0, from); i < to; i++) {
    const c = order[i]
    ctx.rect(ox + (c % cols) * cell + inset, oy + ((c / cols) | 0) * cell + inset, s, s)
  }
  ctx.fill()
  ctx.globalAlpha = 1
}

/**
 * Same as bandFill, but skips cells the other search already owns
 * (`at[cell]` inside [0, limit)). Keeps the two territories from
 * blending into mud where they overlap.
 */
function bandFillMinus(
  ctx: CanvasRenderingContext2D,
  sc: Scene,
  order: Int32Array,
  from: number,
  to: number,
  at: Int32Array,
  limit: number,
  color: string,
  alpha: number,
) {
  if (to <= from || alpha <= 0.006) return
  const { cell, cols, ox, oy } = sc
  const inset = Math.max(0.6, cell * 0.16)
  const s = cell - inset * 2
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.beginPath()
  for (let i = Math.max(0, from); i < to; i++) {
    const c = order[i]
    const a = at[c]
    if (a >= 0 && a < limit) continue
    ctx.rect(ox + (c % cols) * cell + inset, oy + ((c / cols) | 0) * cell + inset, s, s)
  }
  ctx.fill()
  ctx.globalAlpha = 1
}

function strokePath(
  ctx: CanvasRenderingContext2D,
  sc: Scene,
  path: Int32Array,
  len: number,
  t: number,
  color: string,
  width: number,
  alpha: number,
) {
  if (len < 2 || t <= 0 || alpha <= 0.01) return
  const total = len - 1
  const f = clamp(t, 0, 1) * total
  const seg = Math.min(total - 1, Math.floor(f))
  const frac = clamp(f - seg, 0, 1)
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(ccx(sc, path[0]), ccy(sc, path[0]))
  for (let i = 1; i <= seg; i++) ctx.lineTo(ccx(sc, path[i]), ccy(sc, path[i]))
  const a = path[seg]
  const b = path[seg + 1]
  ctx.lineTo(lerp(ccx(sc, a), ccx(sc, b), frac), lerp(ccy(sc, a), ccy(sc, b), frac))
  ctx.stroke()
  ctx.globalAlpha = 1
}

function marker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha: number,
  filled: boolean,
  lineWidth: number,
) {
  if (alpha <= 0.01) return
  ctx.globalAlpha = alpha
  ctx.beginPath()
  ctx.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2)
  if (filled) {
    ctx.fillStyle = color
    ctx.fill()
  } else {
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

function statRow(
  ctx: CanvasRenderingContext2D,
  x: number,
  right: number,
  y: number,
  size: number,
  label: string,
  value: string,
  frac: number,
  color: string,
  faint: string,
  alpha: number,
  barW: number,
) {
  if (alpha <= 0.012) return
  tinyText(ctx, label, x, y, size, faint, alpha * 0.8, 'left', '0.14em')
  if (barW > 18) {
    const bx = x + size * 3.4
    const bh = Math.max(1.5, size * 0.28)
    const by = y - bh
    ctx.globalAlpha = alpha * 0.18
    ctx.fillStyle = faint
    ctx.fillRect(bx, by, barW, bh)
    ctx.globalAlpha = alpha * 0.95
    ctx.fillStyle = color
    ctx.fillRect(bx, by, Math.max(0, barW * clamp(frac, 0, 1)), bh)
    ctx.globalAlpha = 1
  }
  tinyText(ctx, value, right, y, size, color, alpha, 'right', '0.04em')
}

/* ============================================================
   COMPONENT
   ============================================================ */

export function LabyrinthMotion({
  project,
  progress,
  reducedMotion = false,
  interactive = true,
  className,
}: ProjectVisualProps) {
  const [focus, setFocus] = useState<Focus>('both')

  const sceneRef = useRef<Scene | null>(null)
  const endsRef = useRef<Ends>({ sx: 0, sy: 0.5, gx: 1, gy: 0.5 })
  const seedRef = useRef(SEED0)
  const rtRef = useRef<Runtime>({
    ctx: null,
    w: 0,
    h: 0,
    t: 0,
    offset: 0,
    dragging: null,
    hover: null,
  })

  const algoCount = project?.metrics.find((m) => m.label === 'Search algorithms')?.value ?? '8'
  const genCount = project?.metrics.find((m) => m.label === 'Maze generators')?.value ?? '3'

  /* ---------- the single frame renderer --------------------- */
  const drawFrame = (p: number) => {
    const rt = rtRef.current
    const ctx = rt.ctx
    const sc = sceneRef.current
    if (!ctx || !sc) return

    const w = rt.w
    const h = rt.h
    const pal = readPalette(canvasRef.current)
    const { maze, cell, cols, padX, fs } = sc
    const compact = w < 420

    ctx.clearRect(0, 0, w, h)
    ctx.lineCap = 'butt'
    ctx.lineJoin = 'miter'

    /* --- timeline ------------------------------------------ */
    const intro = easeOutCubic(range(p, 0, CARVE_A))
    const carveT = range(p, CARVE_A, CARVE_B)
    const kf = carveT * maze.steps
    const k = Math.min(maze.steps, Math.floor(kf))
    const settleFlash = Math.sin(Math.PI * range(p, CARVE_B, SETTLE))
    const goalIn = easeOutCubic(range(p, CARVE_B - 0.02, SETTLE))
    const searchT = range(p, SETTLE, SEARCH_B)
    const pathT = range(p, SEARCH_B, PATH_B)

    const maxCount = Math.max(sc.bfs.count, sc.astar.count, 1)
    const kb = Math.min(sc.bfs.count, Math.floor(searchT * maxCount))
    const ka = Math.min(sc.astar.count, Math.floor(searchT * maxCount))
    const exFade = 1 - 0.3 * easeInOutCubic(pathT)
    const wBfs = focus === 'astar' ? 0.16 : 1
    const wAst = focus === 'bfs' ? 0.16 : 1

    /* --- generator state at step k ------------------------- */
    let sp = 0
    if (k >= maze.steps) maze.wallsNow.set(maze.walls)
    else sp = replayTo(maze, k)

    /* --- 1. unvisited lattice ------------------------------ */
    if (k < maze.steps) {
      const r = Math.max(0.6, cell * 0.055)
      ctx.globalAlpha = 0.55 * intro
      ctx.fillStyle = pal.inkFaint
      ctx.beginPath()
      for (let i = 0; i < maze.n; i++) {
        const vo = maze.visitOrder[i]
        if (vo >= 0 && vo < k) continue
        ctx.rect(ccx(sc, i) - r, ccy(sc, i) - r, r * 2, r * 2)
      }
      ctx.fill()
      ctx.globalAlpha = 1
    }

    /* --- 2. explored territory (drawn under the walls) ----- */
    if (searchT > 0) {
      // Territory, not overlay: warm = cells A* has taken, cool = cells only
      // BFS has taken. The two never blend, so the shapes stay readable.
      bandFillMinus(ctx, sc, sc.bfs.order, 0, kb, sc.astar.at, ka, pal.signal, 0.26 * wBfs * exFade)
      // BFS wavefront: the whole current distance ring, drawn as one arc
      if (kb > 0) {
        const d = sc.bfs.dist[sc.bfs.order[kb - 1]]
        let i = kb - 1
        while (i > 0 && kb - i < 150 && sc.bfs.dist[sc.bfs.order[i - 1]] === d) i--
        bandFill(ctx, sc, sc.bfs.order, i, kb, pal.signal, 0.34 * wBfs * exFade)
      }

      // A* reads as one solid body pulled toward the goal
      bandFill(ctx, sc, sc.astar.order, 0, ka, pal.accent, 0.18 * wAst * exFade)
      // A* head: the most recent expansions, ramped by recency
      const headN = Math.min(18, ka)
      const inset = Math.max(0.6, cell * 0.16)
      const side = cell - inset * 2
      ctx.fillStyle = pal.accent
      for (let i = ka - headN; i < ka; i++) {
        const c = sc.astar.order[i]
        ctx.globalAlpha = 0.34 * wAst * exFade * (1 - (ka - 1 - i) / (headN + 2))
        ctx.fillRect(sc.ox + (c % cols) * cell + inset, sc.oy + ((c / cols) | 0) * cell + inset, side, side)
      }
      ctx.globalAlpha = 1
    }

    /* --- 3. maze walls ------------------------------------- */
    const wallAlpha = (0.72 + 0.28 * settleFlash) * (0.35 + 0.65 * intro)
    ctx.globalAlpha = wallAlpha
    ctx.strokeStyle = pal.inkFaint
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 0; i < maze.n; i++) {
      const vo = maze.visitOrder[i]
      if (vo < 0 || vo >= k) continue
      const gx = i % cols
      const gy = (i / cols) | 0
      const x = sc.ox + gx * cell + 0.5
      const y = sc.oy + gy * cell + 0.5
      const wv = maze.wallsNow[i]
      if (wv & 1) {
        ctx.moveTo(x, y)
        ctx.lineTo(x + cell, y)
      }
      if (wv & 8) {
        ctx.moveTo(x, y)
        ctx.lineTo(x, y + cell)
      }
      if (wv & 4) {
        const s = i + cols
        const sv = gy === sc.rows - 1 ? -1 : maze.visitOrder[s]
        if (sv < 0 || sv >= k) {
          ctx.moveTo(x, y + cell)
          ctx.lineTo(x + cell, y + cell)
        }
      }
      if (wv & 2) {
        const e = i + 1
        const ev = gx === cols - 1 ? -1 : maze.visitOrder[e]
        if (ev < 0 || ev >= k) {
          ctx.moveTo(x + cell, y)
          ctx.lineTo(x + cell, y + cell)
        }
      }
    }
    ctx.stroke()
    ctx.globalAlpha = 1

    /* --- 4. the generator stack, trailing as a ribbon ------ */
    if (k > 0 && k < maze.steps && sp > 0) {
      const frac = clamp(kf - k, 0, 1)
      const headA = maze.stack[sp - 1]
      const popping = maze.stepKind[k] === -1
      const headB = popping ? (sp >= 2 ? maze.stack[sp - 2] : headA) : maze.stepCell[k]
      const hx = lerp(ccx(sc, headA), ccx(sc, headB), frac)
      const hy = lerp(ccy(sc, headA), ccy(sc, headB), frac)

      // whole stack, faint
      ctx.globalAlpha = 0.2
      ctx.strokeStyle = pal.accent
      ctx.lineWidth = 1
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(ccx(sc, maze.stack[0]), ccy(sc, maze.stack[0]))
      for (let i = 1; i < sp; i++) ctx.lineTo(ccx(sc, maze.stack[i]), ccy(sc, maze.stack[i]))
      ctx.lineTo(hx, hy)
      ctx.stroke()

      // last stretch, ramped — this is the live part of the stack
      const tail = Math.max(0, sp - 40)
      ctx.lineWidth = clamp(cell * 0.1, 1, 1.5)
      for (let i = Math.max(1, tail); i < sp; i++) {
        const a = (i - tail) / Math.max(1, sp - tail)
        ctx.globalAlpha = 0.12 + 0.6 * a * a
        ctx.beginPath()
        ctx.moveTo(ccx(sc, maze.stack[i - 1]), ccy(sc, maze.stack[i - 1]))
        ctx.lineTo(ccx(sc, maze.stack[i]), ccy(sc, maze.stack[i]))
        ctx.stroke()
      }
      ctx.globalAlpha = 0.85
      ctx.beginPath()
      ctx.moveTo(ccx(sc, headA), ccy(sc, headA))
      ctx.lineTo(hx, hy)
      ctx.stroke()
      ctx.globalAlpha = 1
      ctx.lineJoin = 'miter'
      ctx.lineCap = 'butt'

      // abandoned dead ends fade out behind the cursor
      const back = Math.max(0, k - 14)
      ctx.strokeStyle = pal.inkSoft
      ctx.lineWidth = 1
      const dr = Math.max(1.5, cell * 0.17)
      for (let i = back; i < k; i++) {
        if (maze.stepKind[i] !== -1) continue
        const c = maze.stepCell[i]
        ctx.globalAlpha = 0.45 * (1 - (k - i) / 15)
        const x = ccx(sc, c)
        const y = ccy(sc, c)
        ctx.beginPath()
        ctx.moveTo(x - dr, y - dr)
        ctx.lineTo(x + dr, y + dr)
        ctx.moveTo(x + dr, y - dr)
        ctx.lineTo(x - dr, y + dr)
        ctx.stroke()
      }
      ctx.globalAlpha = 1

      // cursor
      const hr = Math.max(1.6, cell * 0.24)
      marker(ctx, hx, hy, hr, popping ? pal.inkSoft : pal.accent, 1, !popping, 1.2)
      marker(ctx, ccx(sc, sc.carveOrigin), ccy(sc, sc.carveOrigin), cell * 0.3, pal.inkSoft, 0.4 * intro, false, 1)
    }

    /* --- 5. the two paths --------------------------------- */
    const path = sc.bfs.pathLen > 1 ? sc.bfs.path : sc.astar.path
    const pathLen = sc.bfs.pathLen > 1 ? sc.bfs.pathLen : sc.astar.pathLen
    if (pathT > 0) {
      strokePath(
        ctx,
        sc,
        path,
        pathLen,
        easeOutCubic(range(pathT, 0, 0.62)),
        pal.signal,
        Math.max(2.2, cell * 0.34),
        0.42 * wBfs,
      )
      const t2 = easeOutCubic(range(pathT, 0.16, 0.9))
      strokePath(ctx, sc, path, pathLen, t2, pal.accent, Math.max(1.3, cell * 0.14), 0.95)
      if (t2 < 1 && pathLen > 1) {
        const f = t2 * (pathLen - 1)
        const seg = Math.min(pathLen - 2, Math.floor(f))
        const a = path[seg]
        const b = path[seg + 1]
        marker(
          ctx,
          lerp(ccx(sc, a), ccx(sc, b), f - seg),
          lerp(ccy(sc, a), ccy(sc, b), f - seg),
          Math.max(1.6, cell * 0.2),
          pal.accent,
          0.95,
          true,
          1,
        )
      }
    }

    /* --- 6. start / goal ---------------------------------- */
    const endsAlpha = Math.max(goalIn, searchT > 0 ? 1 : 0)
    if (endsAlpha > 0.01) {
      const sr = Math.max(2, cell * 0.26)
      const dragS = rt.dragging === 'start' || rt.hover === 'start'
      const dragG = rt.dragging === 'goal' || rt.hover === 'goal'
      marker(ctx, ccx(sc, sc.start), ccy(sc, sc.start), sr, pal.ink, endsAlpha * 0.9, true, 1)
      marker(ctx, ccx(sc, sc.start), ccy(sc, sc.start), sr * 2, pal.ink, endsAlpha * (dragS ? 0.7 : 0.22), false, 1)
      const reached = ka >= sc.astar.count && searchT > 0
      marker(
        ctx,
        ccx(sc, sc.goal),
        ccy(sc, sc.goal),
        sr,
        reached ? pal.accent : pal.ink,
        endsAlpha * 0.9,
        false,
        1.4,
      )
      marker(ctx, ccx(sc, sc.goal), ccy(sc, sc.goal), sr * 2, pal.ink, endsAlpha * (dragG ? 0.7 : 0.22), false, 1)

      // arrival pulses — A* first, BFS much later
      if (searchT > 0 && pathT <= 0) {
        const aFound = sc.astar.count / maxCount
        const ap = searchT >= aFound ? Math.max(0, 1 - (searchT - aFound) / 0.1) : 0
        if (ap > 0) marker(ctx, ccx(sc, sc.goal), ccy(sc, sc.goal), sr + (1 - ap) * cell * 1.8, pal.accent, ap * 0.6 * wAst, false, 1)
        const bp = searchT >= 1 ? 1 : 0
        if (bp > 0) marker(ctx, ccx(sc, sc.goal), ccy(sc, sc.goal), sr * 1.5, pal.signal, 0.5 * wBfs, false, 1)
      }
    }

    /* --- 7. type ------------------------------------------ */
    const rowY = Math.round(sc.padTop * 0.34) + fs
    const rowY2 = rowY + fs + 5
    const right = w - padX
    const barW = w < 470 ? 0 : Math.min(96, w * 0.17)
    const blockX = right - (barW > 0 ? fs * 3.4 + barW + fs * 3.4 : fs * 6.2)

    const aCarve = 1 - range(p, CARVE_B, CARVE_B + 0.05)
    const aSearch = range(p, CARVE_B + 0.04, SETTLE) * (1 - range(p, SEARCH_B, SEARCH_B + 0.04))
    const aPath = range(p, SEARCH_B + 0.01, SEARCH_B + 0.05)

    tinyText(
      ctx,
      compact ? '01 CARVE' : '01 CARVE · RECURSIVE BACKTRACKER',
      padX,
      rowY,
      fs,
      pal.inkFaint,
      aCarve * 0.85 * intro,
      'left',
      '0.16em',
    )
    tinyText(
      ctx,
      compact ? '02 SEARCH' : '02 SEARCH · ONE START, TWO FRONTIERS',
      padX,
      rowY,
      fs,
      pal.inkFaint,
      aSearch * 0.85,
      'left',
      '0.16em',
    )
    tinyText(
      ctx,
      compact ? '03 PATH' : `03 PATH · ${pathLen} CELLS`,
      padX,
      rowY,
      fs,
      pal.inkFaint,
      aPath * 0.85,
      'left',
      '0.16em',
    )

    // carve progress: cells reached out of the whole grid
    const pushes = Math.round((k + sp) / 2)
    statRow(
      ctx,
      blockX,
      right,
      rowY,
      fs,
      'CARVED',
      `${pushes}/${maze.n}`,
      pushes / maze.n,
      pal.inkSoft,
      pal.inkFaint,
      aCarve * intro,
      barW * 0.58,
    )

    // Both searches expand at one rate, so one counter serves both until A*
    // pops the goal — then the two settle side by side.
    const aRows = 1 - aCarve
    const split = searchT > 0 ? range(searchT, sc.astar.count / maxCount, sc.astar.count / maxCount + 0.02) : 0
    tinyText(ctx, `EXPANDED ${kb}`, right, rowY, fs, pal.inkSoft, aRows * (1 - split) * 0.9, 'right', '0.14em')
    statRow(ctx, blockX, right, rowY, fs, 'BFS', String(kb), kb / maze.n, pal.signal, pal.inkFaint, aRows * split * (focus === 'astar' ? 0.4 : 1), barW)
    statRow(ctx, blockX, right, rowY2, fs, 'A*', String(ka), ka / maze.n, pal.accent, pal.inkFaint, aRows * split * (focus === 'bfs' ? 0.4 : 1), barW)

    if (!compact) {
      const ratio = Math.round((sc.astar.count / Math.max(1, sc.bfs.count)) * 100)
      tinyText(
        ctx,
        w >= 520
          ? `${algoCount} SEARCH ALGORITHMS · ${genCount} GENERATORS`
          : `${algoCount} ALGORITHMS · ${genCount} GENERATORS`,
        right,
        h - Math.round(sc.padBottom * 0.34),
        fs,
        pal.inkFaint,
        0.4 * (1 - aPath),
        'right',
        '0.16em',
      )
      tinyText(
        ctx,
        w >= 520 ? `SAME PATH · A* EXPANDED ${ratio}% OF BFS` : `SAME PATH · A* ${ratio}% OF BFS`,
        right,
        h - Math.round(sc.padBottom * 0.34),
        fs,
        pal.inkSoft,
        0.6 * aPath,
        'right',
        '0.16em',
      )
    }
  }

  const drawRef = useRef(drawFrame)
  drawRef.current = drawFrame

  const phaseFor = (t: number) => {
    const rt = rtRef.current
    if (rt.dragging) return 1
    if (typeof progress === 'number') return clamp(progress, 0, 1)
    const e = (t - rt.offset) % CYCLE
    return clamp(((e < 0 ? e + CYCLE : e) / CYCLE) / 0.92, 0, 1)
  }

  const canvasRef = useCanvas2D({
    setup: ({ ctx, w, h }) => {
      const rt = rtRef.current
      rt.ctx = ctx
      rt.w = w
      rt.h = h
      sceneRef.current = makeScene(w, h, seedRef.current, endsRef.current)
      if (reducedMotion) drawRef.current(1)
    },
    draw: ({ ctx, w, h, t }) => {
      const rt = rtRef.current
      rt.ctx = ctx
      rt.w = w
      rt.h = h
      rt.t = t
      drawRef.current(reducedMotion ? 1 : phaseFor(t))
    },
    runFor: reducedMotion ? 0.4 : 0,
  })

  /* ---------- pointer: drag the start or the goal ---------- */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !interactive) return

    const cellAt = (e: PointerEvent) => {
      const sc = sceneRef.current
      if (!sc) return -1
      const r = canvas.getBoundingClientRect()
      const gx = Math.floor((e.clientX - r.left - sc.ox) / sc.cell)
      const gy = Math.floor((e.clientY - r.top - sc.oy) / sc.cell)
      if (gx < -2 || gy < -2 || gx > sc.cols + 1 || gy > sc.rows + 1) return -1
      const cx = Math.round(clamp(gx, 0, sc.cols - 1))
      const cy = Math.round(clamp(gy, 0, sc.rows - 1))
      return cy * sc.cols + cx
    }

    const place = (which: Handle, cellIndex: number) => {
      const sc = sceneRef.current
      if (!sc || cellIndex < 0) return
      const other = which === 'start' ? sc.goal : sc.start
      if (cellIndex === other) return
      if (which === 'start') {
        if (sc.start === cellIndex) return
        sc.start = cellIndex
      } else {
        if (sc.goal === cellIndex) return
        sc.goal = cellIndex
      }
      const nx = (cellIndex % sc.cols) / Math.max(1, sc.cols - 1)
      const ny = ((cellIndex / sc.cols) | 0) / Math.max(1, sc.rows - 1)
      const ends = endsRef.current
      if (which === 'start') {
        ends.sx = nx
        ends.sy = ny
      } else {
        ends.gx = nx
        ends.gy = ny
      }
      solveAll(sc)
      drawRef.current(1)
    }

    const onDown = (e: PointerEvent) => {
      const sc = sceneRef.current
      const c = cellAt(e)
      if (!sc || c < 0) return
      const rt = rtRef.current
      rt.dragging = chebyshev(sc, c, sc.start) <= 2 ? 'start' : 'goal'
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        /* pointer already released — dragging still works without capture */
      }
      if (e.pointerType !== 'touch') e.preventDefault()
      place(rt.dragging, c)
    }

    const onMove = (e: PointerEvent) => {
      const sc = sceneRef.current
      const rt = rtRef.current
      if (!sc) return
      const c = cellAt(e)
      if (rt.dragging) {
        place(rt.dragging, c)
        return
      }
      const near: Handle | null =
        c < 0
          ? null
          : chebyshev(sc, c, sc.start) <= 1
            ? 'start'
            : chebyshev(sc, c, sc.goal) <= 1
              ? 'goal'
              : null
      if (near !== rt.hover) {
        rt.hover = near
        canvas.style.cursor = near ? 'grab' : 'default'
        if (reducedMotion) drawRef.current(1)
      }
    }

    const onUp = (e: PointerEvent) => {
      const rt = rtRef.current
      if (!rt.dragging) return
      rt.dragging = null
      try {
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
      } catch {
        /* capture already gone */
      }
      // resume the loop at the search beat so the re-flood is visible
      rt.offset = rt.t - 0.5 * CYCLE
      if (reducedMotion) drawRef.current(1)
    }

    const onLeave = () => {
      const rt = rtRef.current
      if (rt.hover) {
        rt.hover = null
        canvas.style.cursor = 'default'
        if (reducedMotion) drawRef.current(1)
      }
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('pointerleave', onLeave)
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.style.cursor = 'default'
    }
  }, [interactive, reducedMotion, canvasRef])

  useEffect(() => {
    if (reducedMotion) drawRef.current(1)
  }, [focus, reducedMotion])

  const rerun = () => {
    const rt = rtRef.current
    seedRef.current = (seedRef.current * 1664525 + 1013904223) >>> 0
    if (rt.ctx && rt.w > 0) sceneRef.current = makeScene(rt.w, rt.h, seedRef.current, endsRef.current)
    rt.offset = rt.t
    drawRef.current(reducedMotion ? 1 : 0)
  }

  return (
    <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
      <canvas ref={canvasRef} className={styles.canvas} />
      {interactive && (
        <div className={styles.hud}>
          <button
            type="button"
            className={styles.chip}
            data-on={String(focus === 'bfs')}
            onClick={() => setFocus((f) => (f === 'bfs' ? 'both' : 'bfs'))}
          >
            BFS
          </button>
          <button
            type="button"
            className={styles.chip}
            data-on={String(focus === 'astar')}
            onClick={() => setFocus((f) => (f === 'astar' ? 'both' : 'astar'))}
          >
            A*
          </button>
          <button type="button" className={styles.chip} onClick={rerun}>
            Re-run
          </button>
        </div>
      )}
    </div>
  )
}
