'use client'

/**
 * CatanMotion — the motion graphic for "Catan AI".
 *
 * HONEST FRAMING: the repository holds a single commit and no source code.
 * Nothing here reports a result, a win rate or a benchmark. What it draws is
 * the *problem statement* — the thing an agent would have to handle — and the
 * shape of the search that was planned for it. The chips say so in words.
 *
 * The board is real Catan geometry, generated rather than drawn: nineteen
 * hexes in the classic 3-4-5-4-3 rings, the standard number spiral with the
 * desert at the centre, and the settlement/road graph it induces — 54 nodes,
 * 72 edges, both facts of the board rather than claims about the project.
 *
 * Timeline (clock 0..1):
 *   0.00  the nineteen hexes stand as a faint blueprint and ink themselves in
 *   0.33  two dice have tumbled and settled; every hex carrying that sum rings
 *         in accent and pushes resource tokens along the graph to settlements
 *   0.66  an expectimax fan opens over three candidate placements — square
 *         decision nodes, ringed chance nodes for the 2d6 that follows each
 *   1.00  one branch lights and the settlement it chose snaps onto the board
 *
 * Non-determinism is carried by one colour rule: `signal` is chance (the dice,
 * the chance layer of the tree), `accent` is decision (the rolled sum, the
 * producing hexes, the chosen branch, the agent's own pieces). Resource hues
 * are project identity, used only as very low-alpha terrain washes.
 *
 * Reduced motion holds the last frame: board complete, roll settled, tokens
 * delivered, the tree fanned with its chosen branch lit and the piece placed.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useCanvas2D } from '@/hooks/useCanvas2D'
import { clamp, damp, easeInOutCubic, easeOutCubic, lerp, range, seeded } from '@/lib/math'
import { readPalette, type ProjectVisualProps, type VisualPalette } from './types'
import styles from './visual.module.css'

/* ---------------------------------------------------------------- constants */

const SQRT3 = Math.sqrt(3)

/** Act boundaries on the 0..1 clock. */
const T_BUILD0 = 0.0
const T_BUILD1 = 0.18
const T_GRAPH0 = 0.05
const T_GRAPH1 = 0.2
const T_NUM0 = 0.1
const T_NUM1 = 0.24
const T_ROLL0 = 0.19
const T_ROLL1 = 0.32
const T_PROD0 = 0.3
const T_PROD1 = 0.58
const T_TREE0 = 0.55
const T_TREE1 = 0.9
const T_PLACE0 = 0.85

/** setLineDash takes an array — never build one inside the draw loop. */
const NODASH: number[] = []
const DASH: number[] = [2, 3]
const DASH_FINE: number[] = [1.5, 2.5]

/** Terrain identity hues. Project colours, not theme colours. */
const TERR_COL = ['#2f6b3f', '#93b04f', '#d0a02c', '#b5512f', '#5d7590', '#c8a97a']
const DESERT = 5

/** Dice pips as (col,row) pairs on a -1..1 grid. */
const PIP_XY: ReadonlyArray<ReadonlyArray<number>> = [
  [],
  [0, 0],
  [-1, -1, 1, 1],
  [-1, -1, 0, 0, 1, 1],
  [-1, -1, 1, -1, -1, 1, 1, 1],
  [-1, -1, 1, -1, 0, 0, -1, 1, 1, 1],
  [-1, -1, 1, -1, -1, 0, 1, 0, -1, 1, 1, 1],
]

/**
 * Chit pips: the ways 2d6 can make each number. Seven is zeroed because no
 * hex carries it — that roll belongs to the robber. This is the board's whole
 * probability story, and it is what makes a vertex worth settling.
 */
const PIPV = [0, 0, 1, 2, 3, 4, 5, 0, 5, 4, 3, 2, 1]

/** The standard number spiral, desert last. */
const NUMBER_SEQ = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11]

/**
 * The scripted rolls, ordered so the opening one pays out to the agent. The
 * second is a seven — nothing yields at all and the robber walks instead —
 * and the last two are numbers no settlement happens to touch. Both are
 * ordinary outcomes of the real game, so both are shown as they fall.
 */
const ROLLS: ReadonlyArray<readonly [number, number]> = [
  [5, 4],
  [4, 3],
  [2, 4],
  [2, 2],
  [3, 2],
  [3, 5],
  [6, 5],
  [5, 5],
]

/** Faces flashed while a die is in the air. Deterministic, indexed by phase. */
const TUMBLE = new Uint8Array(96)
{
  const rnd = seeded(0x0ca7a4)
  for (let i = 0; i < TUMBLE.length; i += 1) TUMBLE[i] = 1 + Math.floor(rnd() * 6)
}

const NUM_STR: string[] = []
const EQ_STR: string[] = []
for (let i = 0; i <= 12; i += 1) {
  NUM_STR.push(String(i))
  EQ_STR.push(`= ${i}`)
}

/** Unit hex corners, pointy-top: a vertex at the top and one at the bottom. */
const CX6 = new Float32Array(6)
const CY6 = new Float32Array(6)
for (let i = 0; i < 6; i += 1) {
  const a = ((60 * i - 90) * Math.PI) / 180
  CX6[i] = Math.cos(a)
  CY6[i] = Math.sin(a)
}

/* ------------------------------------------------------------- the board */

interface Hex {
  x: number
  y: number
  ring: number
  num: number
  terr: number
}

interface Pair {
  hex: number
  vert: number
  owner: number
}

interface Board {
  hexes: Hex[]
  /** Vertex positions in board units (hex radius = 1). */
  vx: Float32Array
  vy: Float32Array
  /** Six vertex ids per hex, in corner order. */
  hexVerts: Int32Array
  /** Road graph: pairs of vertex ids. */
  roads: Int32Array
  /** -1 unowned, 0 the agent, 1 the opponent. */
  owner: Int8Array
  settlements: number[]
  candidates: number[]
  /** Producing (hex → settled vertex) pairs, per dice sum. */
  prod: Pair[][]
  /** Hex ids carrying each sum. */
  byNum: number[][]
  robberFrom: number
  robberTo: number
}

function buildBoard(): Board {
  const hexes: Hex[] = []
  for (let q = -2; q <= 2; q += 1) {
    for (let r = -2; r <= 2; r += 1) {
      if (Math.abs(q + r) > 2) continue
      hexes.push({
        x: SQRT3 * (q + r / 2),
        y: 1.5 * r,
        ring: (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2,
        num: 0,
        terr: DESERT,
      })
    }
  }

  // Spiral: outer ring first, clockwise from the top, centre last.
  const spiral = hexes.map((_, i) => i)
  const angleKey = (h: Hex) => (Math.atan2(h.y, h.x) + Math.PI * 2.5) % (Math.PI * 2)
  spiral.sort((a, b) => {
    const ha = hexes[a]
    const hb = hexes[b]
    if (ha.ring !== hb.ring) return hb.ring - ha.ring
    return angleKey(ha) - angleKey(hb)
  })
  const centre = spiral[spiral.length - 1]
  for (let i = 0; i < NUMBER_SEQ.length; i += 1) hexes[spiral[i]].num = NUMBER_SEQ[i]

  // Terrain bag: 4 wood, 4 pasture, 4 field, 3 hill, 3 mountain — desert centred.
  const bag = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4]
  const rnd = seeded(0x5e771e)
  for (let i = bag.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1))
    const tmp = bag[i]
    bag[i] = bag[j]
    bag[j] = tmp
  }
  for (let i = 0; i < bag.length; i += 1) hexes[spiral[i]].terr = bag[i]

  // Corners, deduplicated — 54 of them on a standard board.
  const keyOf = (x: number, y: number) => `${Math.round(x * 1000)}:${Math.round(y * 1000)}`
  const index = new Map<string, number>()
  const vxs: number[] = []
  const vys: number[] = []
  const hexVerts = new Int32Array(hexes.length * 6)
  for (let h = 0; h < hexes.length; h += 1) {
    for (let i = 0; i < 6; i += 1) {
      const px = hexes[h].x + CX6[i]
      const py = hexes[h].y + CY6[i]
      const k = keyOf(px, py)
      let id = index.get(k)
      if (id === undefined) {
        id = vxs.length
        index.set(k, id)
        vxs.push(px)
        vys.push(py)
      }
      hexVerts[h * 6 + i] = id
    }
  }

  // Roads: every corner-to-corner segment of every hex, deduplicated — 72.
  const seen = new Set<string>()
  const roadList: number[] = []
  const nbr: number[][] = vxs.map(() => [])
  for (let h = 0; h < hexes.length; h += 1) {
    for (let i = 0; i < 6; i += 1) {
      const a = hexVerts[h * 6 + i]
      const b = hexVerts[h * 6 + ((i + 1) % 6)]
      const k = a < b ? `${a}-${b}` : `${b}-${a}`
      if (seen.has(k)) continue
      seen.add(k)
      roadList.push(a, b)
      nbr[a].push(b)
      nbr[b].push(a)
    }
  }

  // Every vertex's touching hexes, and its pip value: the opening heuristic.
  const touch: number[][] = vxs.map(() => [])
  for (let h = 0; h < hexes.length; h += 1) {
    for (let i = 0; i < 6; i += 1) touch[hexVerts[h * 6 + i]].push(h)
  }
  const score = vxs.map((_, v) => touch[v].reduce((s, h) => s + PIPV[hexes[h].num], 0))

  const ranked = vxs.map((_, v) => v).sort((a, b) => score[b] - score[a] || a - b)
  const owner = new Int8Array(vxs.length).fill(-1)
  const taken: number[] = []
  const free = (v: number) => taken.every((t) => t !== v && !nbr[v].includes(t))

  const settlements: number[] = []
  for (const v of ranked) {
    if (settlements.length >= 4) break
    if (!free(v)) continue
    owner[v] = settlements.length % 2 === 0 ? 0 : 1
    settlements.push(v)
    taken.push(v)
  }
  const candidates: number[] = []
  for (const v of ranked) {
    if (candidates.length >= 3) break
    if (!free(v)) continue
    candidates.push(v)
    taken.push(v)
  }

  const prod: Pair[][] = []
  const byNum: number[][] = []
  for (let s = 0; s <= 12; s += 1) {
    prod.push([])
    byNum.push([])
  }
  for (let h = 0; h < hexes.length; h += 1) {
    const n = hexes[h].num
    if (n < 2) continue
    byNum[n].push(h)
    for (let i = 0; i < 6; i += 1) {
      const v = hexVerts[h * 6 + i]
      if (owner[v] >= 0) prod[n].push({ hex: h, vert: v, owner: owner[v] })
    }
  }

  // Where the robber goes on a seven: the fattest hex the agent is drinking from.
  let robberTo = centre
  let best = -1
  for (const v of settlements) {
    if (owner[v] !== 0) continue
    for (const h of touch[v]) {
      if (PIPV[hexes[h].num] > best) {
        best = PIPV[hexes[h].num]
        robberTo = h
      }
    }
  }

  return {
    hexes,
    vx: Float32Array.from(vxs),
    vy: Float32Array.from(vys),
    hexVerts,
    roads: Int32Array.from(roadList),
    owner,
    settlements,
    candidates,
    prod,
    byNum,
    robberFrom: centre,
    robberTo,
  }
}

const B = buildBoard()
const N_VERT = B.vx.length
const N_ROAD = B.roads.length / 2

/** Counted from the geometry above, not claimed: the graph a Catan agent searches. */
const FACTS = `${N_VERT} NODES · ${N_ROAD} EDGES`

/** Build-in stagger per hex: centre first, outward. */
const HEX_DELAY = new Float32Array(B.hexes.length)
for (let i = 0; i < B.hexes.length; i += 1) HEX_DELAY[i] = B.hexes[i].ring * 0.14

/* --------------------------------------------------------- the search tree */

/** Expectimax sketch: decision root → three candidate placements → 2d6 outcomes. */
interface TNode {
  u: number
  v: number
  parent: number
  depth: number
  delay: number
  chosen: boolean
}

const CHOSEN_BRANCH = 1
const CHOSEN_LEAF = 1

function buildTree(): TNode[] {
  const nodes: TNode[] = [{ u: 0, v: 0, parent: -1, depth: 0, delay: 0, chosen: true }]
  const rnd = seeded(0x7a11ee)
  for (let i = 0; i < 3; i += 1) {
    nodes.push({
      u: 0.44,
      v: (i - 1) * 0.66,
      parent: 0,
      depth: 1,
      delay: 0.1 + i * 0.06,
      chosen: i === CHOSEN_BRANCH,
    })
  }
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      nodes.push({
        u: 1 - (rnd() - 0.5) * 0.07,
        v: (i - 1) * 0.66 + (j - 1) * 0.2,
        parent: 1 + i,
        depth: 2,
        delay: 0.34 + (i * 3 + j) * 0.032,
        chosen: i === CHOSEN_BRANCH && j === CHOSEN_LEAF,
      })
    }
  }
  return nodes
}

const TREE = buildTree()

/* ------------------------------------------------------------------ layout */

interface Layout {
  w: number
  h: number
  chrome: boolean
  detail: boolean
  padX: number
  bx: number
  by: number
  R: number
  dieX: number
  dieY: number
  dieS: number
  tallyX: number
  tallyY: number
  tallyStep: number
  factX: number
  /** Is there room on the dice line for the graph-size note? */
  facts: boolean
  treeX: number
  treeY: number
  treeW: number
  treeH: number
  fontNano: string
  fontMicro: string
  fontNum: string
  nano: number
}

/** Board units → screen. Module scope so the draw loop allocates no closures. */
function mapX(L: Layout, u: number): number {
  return L.bx + u * L.R
}
function mapY(L: Layout, u: number): number {
  return L.by + u * L.R
}
function nodeX(L: Layout, n: TNode): number {
  return L.treeX + L.treeW * (0.04 + n.u * 0.9)
}
function nodeY(L: Layout, n: TNode): number {
  return L.treeY + L.treeH * 0.5 + n.v * L.treeH * 0.42
}

function computeLayout(w: number, h: number, chrome: boolean): Layout {
  const padX = clamp(w * 0.05, 10, 34)
  const padTop = clamp(h * 0.06, 8, 18) + (chrome ? 18 : 0)
  const padBot = clamp(h * 0.06, 8, 18) + (chrome ? 26 : 0)
  const detail = w >= 300 && h >= 190
  const micro = clamp(Math.round(Math.min(w, h) * 0.032), 8, 11)
  const nano = Math.max(7, micro - 2)

  const innerW = Math.max(40, w - padX * 2)
  const innerH = Math.max(40, h - padTop - padBot)
  const headH = clamp(innerH * 0.15, 16, 32)
  const footH = detail ? clamp(innerH * 0.11, 13, 24) : 0

  const wide = w >= h * 1.25
  let boardX: number
  let boardW: number
  let boardY: number
  let boardH: number
  let treeX: number
  let treeY: number
  let treeW: number
  let treeH: number

  if (wide) {
    const split = innerW * 0.56
    const gap = clamp(innerW * 0.03, 6, 20)
    boardX = padX
    boardW = Math.max(30, split - gap)
    boardY = padTop + headH
    boardH = Math.max(30, innerH - headH - footH)
    treeX = padX + split + gap * 0.4
    treeW = Math.max(40, w - padX - treeX)
    treeY = padTop + headH * 0.35
    treeH = Math.max(40, innerH - headH * 0.35 - footH * 0.4)
  } else {
    const gap = clamp(innerH * 0.03, 5, 14)
    boardX = padX
    boardW = innerW
    boardY = padTop + headH
    boardH = Math.max(30, (innerH - headH - footH) * 0.64)
    treeX = padX
    treeW = innerW
    treeY = boardY + boardH + gap
    treeH = Math.max(34, padTop + innerH - footH - treeY)
  }

  const R = Math.max(4.5, Math.min(boardW / 8.66, boardH / 8.0))
  const dieS = clamp(Math.min(headH * 0.86, R * 1.05), 9, 22)

  return {
    w,
    h,
    chrome,
    detail,
    padX,
    bx: boardX + boardW * 0.5,
    by: boardY + boardH * 0.5,
    R,
    dieX: boardX + dieS * 0.6,
    dieY: padTop + headH * 0.5,
    dieS,
    tallyX: boardX + 1,
    tallyY: padTop + innerH - footH * 0.4,
    tallyStep: Math.min(boardW / 5, 46),
    factX: boardX + boardW,
    facts: detail && (wide || !chrome) && boardW - dieS * 4.2 > 130,
    treeX,
    treeY,
    treeW,
    treeH,
    fontNano: `${nano}px ui-monospace, monospace`,
    fontMicro: `${micro}px ui-monospace, monospace`,
    fontNum: `${Math.max(6, Math.round(R * 0.36))}px ui-monospace, monospace`,
    nano,
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

function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(cx + CX6[0] * r, cy + CY6[0] * r)
  for (let i = 1; i < 6; i += 1) ctx.lineTo(cx + CX6[i] * r, cy + CY6[i] * r)
  ctx.closePath()
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath()
  ctx.arc(x, y, Math.max(0.4, r), 0, Math.PI * 2)
  ctx.fill()
}

/** A settlement: a small house, filled when it is the agent's. */
function house(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  fill: boolean,
): void {
  ctx.beginPath()
  ctx.moveTo(x - s, y + s * 0.85)
  ctx.lineTo(x - s, y - s * 0.15)
  ctx.lineTo(x, y - s * 1.05)
  ctx.lineTo(x + s, y - s * 0.15)
  ctx.lineTo(x + s, y + s * 0.85)
  ctx.closePath()
  if (fill) ctx.fill()
  else ctx.stroke()
}

/* ----------------------------------------------------------- the component */

export function CatanMotion(props: ProjectVisualProps) {
  const { project, progress, reducedMotion = false, interactive = true, className } = props
  const chrome = interactive !== false

  const period = useMemo(
    () => clamp(project?.presentation.duration ?? 16, 9, 24),
    [project],
  )

  const [shownSum, setShownSum] = useState(ROLLS[0][0] + ROLLS[0][1])
  const [shownHexes, setShownHexes] = useState(0)

  const layoutRef = useRef<Layout | null>(null)
  const paletteRef = useRef<VisualPalette | null>(null)
  const paletteAtRef = useRef(-1)
  const clockRef = useRef(0)
  const rollRef = useRef(0)
  const manualRef = useRef(false)
  const hoverRef = useRef(false)
  const firstRef = useRef(true)
  const dirtyRef = useRef(true)
  const sumRef = useRef(-1)
  const counts = useMemo(() => new Int32Array(5), [])

  const ref = useCanvas2D<HTMLCanvasElement>({
    setup: ({ ctx, w, h }) => {
      layoutRef.current = computeLayout(w, h, chrome)
      paletteRef.current = readPalette(ctx.canvas)
      paletteAtRef.current = -1
      firstRef.current = true
      dirtyRef.current = true
    },

    draw: ({ ctx, w, h, t, dt }) => {
      let L = layoutRef.current
      if (!L || L.w !== w || L.h !== h || L.chrome !== chrome) {
        L = computeLayout(w, h, chrome)
        layoutRef.current = L
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
        clockRef.current = 1
      } else if (manualRef.current) {
        // A hand-thrown roll runs forward once and then holds on the result.
        const c = Math.min(1, clockRef.current + dt / period)
        clockRef.current = c
        clock = c
        if (c < 1) dirtyRef.current = true
      } else if (typeof progress === 'number') {
        const target = clamp(progress) * 0.99999
        clock = firstRef.current ? target : damp(clockRef.current, target, 14, dt)
        clockRef.current = clock
      } else {
        const next = clockRef.current + dt / period
        if (next >= 1) rollRef.current = (rollRef.current + 1) % ROLLS.length
        clock = next % 1
        clockRef.current = clock
      }

      if (reducedMotion && !dirtyRef.current) return

      /* ---- phases -------------------------------------------------------- */

      const buildP = range(clock, T_BUILD0, T_BUILD1)
      const graphP = range(clock, T_GRAPH0, T_GRAPH1)
      const numP = range(clock, T_NUM0, T_NUM1)
      const rollP = range(clock, T_ROLL0, T_ROLL1)
      const prodP = range(clock, T_PROD0, T_PROD1)
      const treeP = range(clock, T_TREE0, T_TREE1)
      const placeP = range(clock, T_PLACE0, 1)

      const roll = ROLLS[rollRef.current]
      const settle = clamp((rollP - 0.66) / 0.34)
      const airborne = rollP > 0 && rollP < 0.68
      const sum = roll[0] + roll[1]
      const seven = sum === 7
      const producing = B.byNum[sum]
      const pairs = B.prod[sum]

      /* ---- frame --------------------------------------------------------- */

      ctx.clearRect(0, 0, w, h)
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.setLineDash(NODASH)

      const R = L.R

      /* ---- terrain ------------------------------------------------------- */

      for (let i = 0; i < B.hexes.length; i += 1) {
        const hx = B.hexes[i]
        const p = easeOutCubic(range(buildP, HEX_DELAY[i], HEX_DELAY[i] + 0.5))
        const cx = mapX(L, hx.x)
        const cy = mapY(L, hx.y)
        const rr = R * lerp(0.9, 0.94, p)

        // The blueprint outline is there from the first frame; the wash inks in.
        hexPath(ctx, cx, cy, rr)
        ctx.globalAlpha = 0.1 * p
        ctx.fillStyle = TERR_COL[hx.terr]
        ctx.fill()
        ctx.globalAlpha = 0.14 + 0.36 * p
        ctx.strokeStyle = inkFaint
        ctx.lineWidth = 0.75
        ctx.stroke()
      }

      /* ---- road graph ---------------------------------------------------- */

      ctx.strokeStyle = inkFaint
      ctx.lineWidth = 0.75
      for (let e = 0; e < N_ROAD; e += 1) {
        const a = B.roads[e * 2]
        const b = B.roads[e * 2 + 1]
        const p = easeOutCubic(range(graphP, (e / N_ROAD) * 0.5, (e / N_ROAD) * 0.5 + 0.4))
        if (p <= 0.01) continue
        ctx.globalAlpha = p * 0.34
        const x0 = mapX(L, B.vx[a])
        const y0 = mapY(L, B.vy[a])
        ctx.beginPath()
        ctx.moveTo(x0, y0)
        ctx.lineTo(lerp(x0, mapX(L, B.vx[b]), p), lerp(y0, mapY(L, B.vy[b]), p))
        ctx.stroke()
      }

      ctx.fillStyle = inkFaint
      for (let v = 0; v < N_VERT; v += 1) {
        const p = easeOutCubic(range(graphP, (v / N_VERT) * 0.5 + 0.1, (v / N_VERT) * 0.5 + 0.45))
        if (p <= 0.01) continue
        ctx.globalAlpha = p * 0.5
        dot(ctx, mapX(L, B.vx[v]), mapY(L, B.vy[v]), Math.max(0.55, R * 0.035))
      }

      /* ---- number chits -------------------------------------------------- */

      const chitR = R * 0.31
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let i = 0; i < B.hexes.length; i += 1) {
        const hx = B.hexes[i]
        if (hx.num < 2) continue
        const p = easeOutCubic(range(numP, HEX_DELAY[i] * 0.6, HEX_DELAY[i] * 0.6 + 0.5))
        if (p <= 0.01) continue
        const cx = mapX(L, hx.x)
        const cy = mapY(L, hx.y)
        const hot = hx.num === sum && !seven ? clamp(prodP / 0.12) : 0

        ctx.globalAlpha = p * (0.4 + hot * 0.5)
        ctx.strokeStyle = hot > 0.02 ? accent : inkFaint
        ctx.lineWidth = hot > 0.02 ? 1.1 : 0.75
        ctx.beginPath()
        ctx.arc(cx, cy, chitR * lerp(0.75, 1, p), 0, Math.PI * 2)
        ctx.stroke()

        if (!L.detail) continue
        const fat = PIPV[hx.num] >= 5
        ctx.globalAlpha = p * (hot > 0.02 ? 1 : fat ? 0.82 : 0.58)
        ctx.fillStyle = hot > 0.02 ? accent : fat ? inkSoft : inkFaint
        ctx.font = L.fontNum
        ctx.fillText(NUM_STR[hx.num], cx, cy - R * 0.05)

        // Pip dots: how many of the 36 ways the dice can make this number.
        if (R < 21) continue
        const k = PIPV[hx.num]
        ctx.globalAlpha = p * (hot > 0.02 ? 0.9 : 0.42)
        for (let d = 0; d < k; d += 1) {
          dot(ctx, cx + (d - (k - 1) / 2) * R * 0.075, cy + R * 0.19, R * 0.022)
        }
      }

      /* ---- production: hexes carrying the roll push resources out --------- */

      if (!seven && prodP > 0) {
        for (let k = 0; k < producing.length; k += 1) {
          const hx = B.hexes[producing[k]]
          const cx = mapX(L, hx.x)
          const cy = mapY(L, hx.y)
          const pulse = range(prodP, k * 0.07, k * 0.07 + 0.4)

          // A ring that leaves the hex, and a mark that stays: this one paid out.
          if (pulse > 0 && pulse < 1) {
            ctx.globalAlpha = Math.sin(pulse * Math.PI) * 0.75
            ctx.strokeStyle = accent
            ctx.lineWidth = 1.1
            hexPath(ctx, cx, cy, R * lerp(0.9, 1.3, easeOutCubic(pulse)))
            ctx.stroke()
          }
          ctx.globalAlpha = clamp(pulse / 0.3) * 0.72
          ctx.strokeStyle = accent
          ctx.lineWidth = 1
          hexPath(ctx, cx, cy, R * 0.9)
          ctx.stroke()
        }
      }

      /* ---- the robber, and the seven that moves it ----------------------- */

      const fromHex = B.hexes[B.robberFrom]
      const toHex = B.hexes[B.robberTo]
      const walk = seven ? easeInOutCubic(range(prodP, 0.12, 0.62)) : 0
      const rbx = mapX(L, lerp(fromHex.x, toHex.x, walk))
      const rby = mapY(L, lerp(fromHex.y, toHex.y, walk)) - Math.sin(walk * Math.PI) * R * 0.5
      if (buildP > 0.3) {
        ctx.globalAlpha = clamp((buildP - 0.3) / 0.4) * (seven ? 0.95 : 0.55)
        ctx.fillStyle = seven ? accent : ink
        dot(ctx, rbx, rby, R * 0.11)
        ctx.globalAlpha = clamp((buildP - 0.3) / 0.4) * 0.45
        ctx.strokeStyle = seven ? accent : inkSoft
        ctx.lineWidth = 0.75
        ctx.beginPath()
        ctx.arc(rbx, rby, R * 0.2, 0, Math.PI * 2)
        ctx.stroke()
      }

      /* ---- settlements --------------------------------------------------- */

      const hs = Math.max(1.8, R * 0.155)
      for (let i = 0; i < B.settlements.length; i += 1) {
        const v = B.settlements[i]
        const p = easeOutCubic(range(graphP, 0.45 + i * 0.08, 0.85 + i * 0.08))
        if (p <= 0.01) continue
        const mine = B.owner[v] === 0
        ctx.globalAlpha = p * (mine ? 0.95 : 0.6)
        ctx.fillStyle = mine ? accent : inkSoft
        ctx.strokeStyle = mine ? accent : inkSoft
        ctx.lineWidth = 1
        house(ctx, mapX(L, B.vx[v]), mapY(L, B.vy[v]), hs * p, mine)
      }

      /* ---- resource tokens travelling hex → settlement -------------------- */

      counts.fill(0)
      if (!seven && prodP > 0) {
        for (let k = 0; k < pairs.length; k += 1) {
          const pr = pairs[k]
          const hx = B.hexes[pr.hex]
          const x0 = mapX(L, hx.x)
          const y0 = mapY(L, hx.y)
          const x1 = mapX(L, B.vx[pr.vert])
          const y1 = mapY(L, B.vy[pr.vert])
          const raw = range(prodP, 0.16 + k * 0.075, 0.58 + k * 0.075)
          if (raw <= 0) continue
          const e = easeInOutCubic(raw)
          const lift = Math.sin(raw * Math.PI) * R * 0.3
          const tx = lerp(x0, x1, e)
          const ty = lerp(y0, y1, e) - lift

          if (raw < 1) {
            ctx.globalAlpha = pr.owner === 0 ? 0.95 : 0.45
            ctx.fillStyle = TERR_COL[hx.terr]
            dot(ctx, tx, ty, Math.max(1.2, R * 0.075))
          } else if (pr.owner === 0) {
            counts[hx.terr] += 1
          }

          // The settlement acknowledges what it just took in.
          const land = Math.sin(clamp((raw - 0.72) / 0.28) * Math.PI)
          if (land > 0.02) {
            ctx.globalAlpha = land * 0.6
            ctx.strokeStyle = pr.owner === 0 ? accent : inkSoft
            ctx.lineWidth = 0.75
            ctx.beginPath()
            ctx.arc(x1, y1, R * lerp(0.12, 0.3, land), 0, Math.PI * 2)
            ctx.stroke()
          }
        }
      }

      /* ---- the hand: what this one roll actually yielded ------------------ */

      if (L.detail) {
        ctx.globalAlpha = 0.4
        ctx.fillStyle = inkFaint
        ctx.font = L.fontNano
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(seven ? 'ROBBER — NO YIELD' : 'YIELD', L.tallyX, L.tallyY - L.nano * 1.5)

        if (!seven) {
          for (let terr = 0; terr < 5; terr += 1) {
            const gx = L.tallyX + terr * L.tallyStep
            ctx.globalAlpha = 0.5
            ctx.fillStyle = TERR_COL[terr]
            ctx.fillRect(gx, L.tallyY - 2.5, 5, 5)
            for (let c = 0; c < counts[terr]; c += 1) {
              ctx.globalAlpha = 0.85
              dot(ctx, gx + 10 + c * 5.5, L.tallyY, 1.6)
            }
            if (counts[terr] === 0) {
              ctx.globalAlpha = 0.28
              ctx.strokeStyle = inkFaint
              ctx.lineWidth = 0.75
              ctx.beginPath()
              ctx.moveTo(gx + 8, L.tallyY)
              ctx.lineTo(gx + 13, L.tallyY)
              ctx.stroke()
            }
          }
        }
      }

      /* ---- the dice ------------------------------------------------------ */

      const S = L.dieS
      for (let i = 0; i < 2; i += 1) {
        const dx = L.dieX + i * (S + S * 0.42)
        const step = Math.floor(rollP * 26)
        const face = airborne ? TUMBLE[(rollRef.current * 7 + i * 31 + step) % TUMBLE.length] : roll[i]
        const hop = airborne ? -Math.abs(Math.sin(rollP * Math.PI * 4.5)) * S * (0.7 - rollP) : 0
        const spin = airborne ? (0.68 - rollP) * Math.sin(rollP * 34 + i) * 0.9 : 0
        const bounce = airborne ? 0 : Math.sin(settle * Math.PI) * S * 0.06
        const appear = clamp(rollP / 0.08)

        ctx.save()
        ctx.translate(dx, L.dieY + hop - bounce)
        ctx.rotate(spin)
        ctx.globalAlpha = appear * (airborne ? 0.7 : 0.95)
        ctx.strokeStyle = airborne ? inkFaint : signal
        ctx.lineWidth = airborne ? 0.75 : 1
        ctx.strokeRect(-S * 0.5, -S * 0.5, S, S)
        ctx.fillStyle = airborne ? inkFaint : signal
        const pips = PIP_XY[face]
        for (let p = 0; p < pips.length; p += 2) {
          dot(ctx, pips[p] * S * 0.26, pips[p + 1] * S * 0.26, S * 0.072)
        }
        ctx.restore()
      }

      // The sum, once, in accent — the one number the whole board answers to.
      if (settle > 0.02) {
        const pop = easeOutCubic(clamp(settle / 0.4))
        ctx.globalAlpha = pop * 0.95
        ctx.fillStyle = seven ? inkSoft : accent
        ctx.font = L.fontMicro
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(EQ_STR[sum], L.dieX + S * 2.1, L.dieY)
        if (L.detail) {
          ctx.globalAlpha = pop * 0.34
          ctx.fillStyle = inkFaint
          ctx.font = L.fontNano
          ctx.fillText('2D6', L.dieX - S * 0.5, L.dieY - S * 0.95)
        }
      }

      /* ---- candidate placements ------------------------------------------ */

      const chosenVert =
        B.candidates.length > 0 ? B.candidates[Math.min(CHOSEN_BRANCH, B.candidates.length - 1)] : -1
      if (treeP > 0) {
        ctx.setLineDash(DASH_FINE)
        for (let i = 0; i < B.candidates.length; i += 1) {
          const v = B.candidates[i]
          const p = easeOutCubic(range(treeP, 0.06 + i * 0.06, 0.3 + i * 0.06))
          if (p <= 0.01) continue
          const on = v === chosenVert && treeP > 0.74
          ctx.globalAlpha = p * (on ? 0.9 : 0.45)
          ctx.strokeStyle = on ? accent : inkSoft
          ctx.lineWidth = on ? 1.1 : 0.75
          ctx.beginPath()
          ctx.arc(mapX(L, B.vx[v]), mapY(L, B.vy[v]), R * lerp(0.4, 0.24, p), 0, Math.PI * 2)
          ctx.stroke()
        }
        ctx.setLineDash(NODASH)
      }

      /* ---- the search fan ------------------------------------------------ */

      const lit = clamp((treeP - 0.66) / 0.22)

      for (let i = 1; i < TREE.length; i += 1) {
        const n = TREE[i]
        const p = TREE[n.parent]
        const g = easeOutCubic(range(treeP, n.delay, n.delay + 0.24))
        if (g <= 0.01) continue
        const x0 = nodeX(L, p)
        const y0 = nodeY(L, p)
        const x1 = lerp(x0, nodeX(L, n), g)
        const y1 = lerp(y0, nodeY(L, n), g)
        const on = n.chosen && p.chosen

        ctx.globalAlpha = g * (on ? 0.3 + lit * 0.65 : 0.3)
        ctx.strokeStyle = on && lit > 0.02 ? accent : inkFaint
        ctx.lineWidth = on && lit > 0.02 ? 1.2 : 0.75
        ctx.beginPath()
        ctx.moveTo(x0, y0)
        ctx.bezierCurveTo((x0 + x1) * 0.5, y0, (x0 + x1) * 0.5, y1, x1, y1)
        ctx.stroke()
      }

      for (let i = 0; i < TREE.length; i += 1) {
        const n = TREE[i]
        const g = easeOutCubic(range(treeP, n.delay + 0.14, n.delay + 0.34))
        if (g <= 0.01) continue
        const x = nodeX(L, n)
        const y = nodeY(L, n)
        const on = n.chosen && lit > 0.02
        const s = Math.max(1.6, Math.min(L.treeH * 0.05, 4.4)) * g

        if (n.depth === 2) {
          // Chance: what the dice do next. Ringed, never filled.
          ctx.globalAlpha = g * (on ? 0.95 : 0.55)
          ctx.strokeStyle = on ? accent : signal
          ctx.lineWidth = on ? 1.1 : 0.75
          ctx.beginPath()
          ctx.arc(x, y, s, 0, Math.PI * 2)
          ctx.stroke()
        } else {
          // Decision: a placement the agent could choose.
          ctx.globalAlpha = g * (on ? 0.95 : 0.6)
          ctx.fillStyle = on ? accent : inkSoft
          ctx.fillRect(x - s, y - s, s * 2, s * 2)
        }
      }

      if (L.detail) {
        ctx.globalAlpha = clamp(treeP / 0.2) * 0.42
        ctx.fillStyle = inkFaint
        ctx.font = L.fontNano
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        ctx.fillText('EXPECTIMAX', L.treeX + L.treeW * 0.04, L.treeY)
        ctx.globalAlpha = clamp((treeP - 0.5) / 0.3) * 0.4
        ctx.fillText('SPEC ONLY — NOT BUILT', L.treeX + L.treeW * 0.04, L.treeY + L.treeH - L.nano)
      }

      /* ---- the branch comes home ----------------------------------------- */

      if (placeP > 0 && chosenVert >= 0) {
        const px = mapX(L, B.vx[chosenVert])
        const py = mapY(L, B.vy[chosenVert])
        const pick = TREE[1 + CHOSEN_BRANCH]
        const lead = easeInOutCubic(clamp(placeP / 0.55))

        ctx.setLineDash(DASH)
        ctx.globalAlpha = Math.sin(clamp(placeP / 0.8) * Math.PI) * 0.45
        ctx.strokeStyle = accent
        ctx.lineWidth = 0.75
        ctx.beginPath()
        ctx.moveTo(nodeX(L, pick), nodeY(L, pick))
        ctx.lineTo(lerp(nodeX(L, pick), px, lead), lerp(nodeY(L, pick), py, lead))
        ctx.stroke()
        ctx.setLineDash(NODASH)

        const pop = easeOutCubic(clamp((placeP - 0.4) / 0.5))
        if (pop > 0.01) {
          ctx.globalAlpha = pop
          ctx.fillStyle = accent
          house(ctx, px, py, hs * lerp(1.5, 1, pop), true)
          ctx.globalAlpha = Math.sin(pop * Math.PI) * 0.5
          ctx.strokeStyle = accent
          ctx.lineWidth = 0.75
          ctx.beginPath()
          ctx.arc(px, py, R * lerp(0.14, 0.42, pop), 0, Math.PI * 2)
          ctx.stroke()
        }
      }

      /* ---- board facts, tiny --------------------------------------------- */

      if (L.facts) {
        ctx.globalAlpha = clamp(graphP / 0.5) * 0.32
        ctx.fillStyle = inkFaint
        ctx.font = L.fontNano
        ctx.textAlign = 'right'
        ctx.textBaseline = 'middle'
        ctx.fillText(FACTS, L.factX, L.dieY)
      }

      // Hover affordance: the dice lean forward, ready to be thrown again.
      if (chrome && hoverRef.current && !reducedMotion) {
        ctx.globalAlpha = 0.5
        ctx.fillStyle = accent
        dot(ctx, L.dieX - L.dieS * 0.95, L.dieY, 1.4)
      }

      ctx.globalAlpha = 1

      /* ---- readout -------------------------------------------------------- */

      if (sumRef.current !== sum) {
        sumRef.current = sum
        setShownSum(sum)
        setShownHexes(seven ? 0 : producing.length)
      }

      firstRef.current = false
      dirtyRef.current = false
    },
  })

  /* ---- interaction: throw the dice yourself -------------------------------- */

  const throwDice = useMemo(
    () => () => {
      rollRef.current = (rollRef.current + 1) % ROLLS.length
      manualRef.current = true
      clockRef.current = T_ROLL0 - 0.01
      dirtyRef.current = true
    },
    [],
  )

  useEffect(() => {
    if (!chrome) return
    const canvas = ref.current
    if (!canvas) return

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      throwDice()
    }
    const onEnter = () => {
      hoverRef.current = true
      dirtyRef.current = true
    }
    const onLeave = () => {
      hoverRef.current = false
      dirtyRef.current = true
    }

    canvas.style.cursor = 'pointer'
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerenter', onEnter)
    canvas.addEventListener('pointerleave', onLeave)

    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerenter', onEnter)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.style.cursor = 'default'
    }
  }, [ref, chrome, throwDice])

  return (
    <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
      <canvas ref={ref} className={styles.canvas} />
      {chrome && (
        <div className={styles.readout} aria-hidden="true">
          2D6 {shownSum} · {shownHexes} HEX{shownHexes === 1 ? '' : 'ES'}
          <br />
          SPEC · NO SOURCE
        </div>
      )}
      {chrome && (
        <div className={styles.hud}>
          <button
            type="button"
            className={styles.chip}
            style={{ cursor: 'pointer' }}
            onClick={throwDice}
            aria-label="Roll the dice"
          >
            ROLL 2D6
          </button>
          <span className={styles.chip}>PLANNED</span>
          <span className={styles.chip}>1 COMMIT · NO CODE</span>
        </div>
      )}
    </div>
  )
}
