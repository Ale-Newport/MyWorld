import { TOKENS } from './palette'
import { hashSeed, mulberry32 } from './geometry'
import type { EmblemKind } from './themes'

/* ============================================================
   THE LITTLE PICTURES

   Each project used to get a glowing animation on a dark screen.
   These are the same ideas redrawn the way a painter at the
   guild would put them on a board: ink and flat colour on paper,
   inside a 256 x 256 square that is the ONLY part of a sign
   that ever repaints on a timer.

   `time` is in seconds and may be huge. `STATIC_TIME` is the
   frame shown when nothing should move (reduced motion, hidden
   tab, first paint): chosen so every picture is mid-gesture and
   readable as a still.
   ============================================================ */

export const EMBLEM_SIZE = 256
export const STATIC_TIME = 0.6

type Painter = (c: CanvasRenderingContext2D, t: number, rand: () => number) => void

const INK = TOKENS.ink, INK2 = TOKENS.ink2, PAPER = TOKENS.paper
const TERRA = TOKENS.terracotta, TEAL = TOKENS.teal, GOLD = TOKENS.gold, LEAF = TOKENS.leaf, WOOD = TOKENS.woodDark, TAN = '#a47e50', SAND = '#e9d3a3'

const dot = (c: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) => { c.fillStyle = fill; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill() }
const line = (c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number, stroke: string) => { c.strokeStyle = stroke; c.lineWidth = w; c.lineCap = 'round'; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke() }
const frac = (v: number) => v - Math.floor(v)
const mono = (px: number) => `600 ${px}px ui-monospace, SFMono-Regular, Menlo, monospace`

const chess: Painter = (c, t) => {
  const left = 36, top = 34, cell = 23
  for (let r = 0; r < 8; r++) for (let q = 0; q < 8; q++) { c.fillStyle = (r + q) % 2 ? TAN : SAND; c.fillRect(left + q * cell, top + r * cell, cell, cell) }
  c.strokeStyle = INK; c.lineWidth = 3; c.strokeRect(left, top, cell * 8, cell * 8)
  const scan = frac(t * 0.45), y = top + scan * cell * 8
  c.fillStyle = 'rgba(47,111,94,0.22)'; c.fillRect(left, y - cell * 0.5, cell * 8, cell)
  line(c, left, y, left + cell * 8, y, 3, TEAL)
  const found = Math.floor(scan * 8)
  c.lineWidth = 2.5; c.strokeStyle = TERRA
  for (let r = 0; r < found; r++) for (const q of [1, 3, 6]) { if ((r * 3 + q) % 4) continue; c.strokeRect(left + q * cell + 3, top + r * cell + 3, cell - 6, cell - 6) }
  const from = [left + cell * 4.5, top + cell * 6.5], to = [left + cell * 4.5, top + cell * 3.6]
  line(c, from[0], from[1], to[0], to[1] + 10, 6, INK)
  c.fillStyle = INK; c.beginPath(); c.moveTo(to[0], to[1] - 4); c.lineTo(to[0] - 12, to[1] + 14); c.lineTo(to[0] + 12, to[1] + 14); c.closePath(); c.fill()
}

const stock: Painter = (c, t, rand) => {
  const step = Math.floor(t * 1.2)
  let value = 130
  for (let i = 0; i < 16; i++) {
    const seed = Math.sin(i * 12.9898 + step * 0.7) * 43758.5453
    const move = (frac(seed) - 0.47) * 34
    const open = value
    value = Math.max(52, Math.min(190, value + move))
    const up = value < open, x = 28 + i * 13.4, hi = Math.min(open, value) - 6 - (i % 3) * 2, lo = Math.max(open, value) + 6 + (i % 4) * 2
    c.strokeStyle = INK; c.lineWidth = 1.6; c.beginPath(); c.moveTo(x, hi); c.lineTo(x, lo); c.stroke()
    c.fillStyle = up ? TEAL : TERRA
    c.fillRect(x - 4.6, Math.min(open, value), 9.2, Math.max(3, Math.abs(value - open)))
  }
  c.strokeStyle = INK2; c.lineWidth = 2; c.beginPath(); c.moveTo(20, 214); c.lineTo(236, 214); c.stroke()
  c.fillStyle = INK; c.font = mono(15); c.textAlign = 'left'
  const shift = (t * 30) % 90
  for (let i = 0; i < 4; i++) { c.fillStyle = i % 2 ? TEAL : TERRA; c.fillText(i % 2 ? '▲ BUY' : '▼ SELL', 22 + i * 62 - shift * 0.0, 238) }
  void rand
}

const orbit: Painter = (c, t) => {
  const colours = [GOLD, TERRA, TEAL]
  dot(c, 128, 128, 13, GOLD); dot(c, 128, 128, 6, TERRA)
  for (let i = 0; i < 3; i++) {
    const phase = t * (0.7 + i * 0.25) + (i * Math.PI * 2) / 3
    const radius = 46 + i * 28, wobble = Math.sin(t * 0.9 + i) * radius * 0.12
    c.strokeStyle = 'rgba(68,61,49,0.45)'; c.lineWidth = 1.6
    c.beginPath(); c.ellipse(128, 128, radius + wobble, radius * 0.72, i * 0.7, 0, Math.PI * 2); c.stroke()
    const a = i * 0.7, ex = Math.cos(phase) * (radius + wobble), ey = Math.sin(phase) * radius * 0.72
    const x = 128 + ex * Math.cos(a) - ey * Math.sin(a), y = 128 + ex * Math.sin(a) + ey * Math.cos(a)
    dot(c, x, y, 11, INK); dot(c, x, y, 8.5, colours[i])
  }
}

const gym: Painter = (c, t) => {
  const cycle = (Math.sin(t * 2.4) + 1) / 2
  const hip = [128, 150 + cycle * 14], sh = [128, hip[1] - 52]
  const limb = (from: number[], dx: number, dy: number) => line(c, from[0], from[1], from[0] + dx, from[1] + dy, 9, INK)
  line(c, hip[0], hip[1], sh[0], sh[1], 10, INK)
  dot(c, sh[0], sh[1] - 22, 17, INK)
  limb(sh, -34, 20 - cycle * 44); limb(sh, 34, 20 - cycle * 44); limb(hip, -26, 52); limb(hip, 26, 52)
  const barY = sh[1] + 20 - cycle * 44
  line(c, sh[0] - 70, barY, sh[0] + 70, barY, 7, TERRA)
  for (const s of [-1, 1]) { c.fillStyle = WOOD; c.fillRect(sh[0] + s * 70 - 7, barY - 20, 14, 40) }
  c.fillStyle = INK; c.font = mono(24); c.textAlign = 'center'
  c.fillText(`REP ${String(Math.floor(t * 1.2) % 12 + 1).padStart(2, '0')}`, 128, 236)
}

const pipeline: Painter = (c, t) => {
  const names = ['1', '2', '3', '4', '5']
  const active = (t * 0.9) % names.length
  names.forEach((name, i) => {
    const x = 34 + i * 47, y = 128
    const lit = Math.max(0, 1 - Math.abs(active - i))
    if (i) line(c, x - 47 + 17, y, x - 17, y, 3, INK2)
    dot(c, x, y, 17 + lit * 5, 'rgba(26,23,18,0.9)')
    dot(c, x, y, 14.5 + lit * 5, lit > 0.05 ? TERRA : PAPER)
    c.fillStyle = lit > 0.05 ? TOKENS.cream : INK; c.font = `700 ${14 + lit * 3}px ui-sans-serif, system-ui`; c.textAlign = 'center'
    c.fillText(name, x, y + 5)
    c.fillStyle = TAN; c.fillRect(x - 10, y + 36, 20, 6)
    c.fillStyle = lit > 0.05 ? TERRA : TAN; c.fillRect(x - 10, y + 36, 20 * Math.min(1, lit * 1.2), 6)
  })
  c.strokeStyle = INK; c.lineWidth = 3; c.lineJoin = 'round'
  c.strokeRect(96, 52, 64, 40); c.fillStyle = TERRA
  c.beginPath(); c.moveTo(121, 62); c.lineTo(121, 82); c.lineTo(138, 72); c.closePath(); c.fill()
}

const tunnel: Painter = (c, t) => {
  for (let i = 0; i < 9; i++) {
    const p = frac(t * 0.35 + i / 9), r = p * 118
    c.strokeStyle = `rgba(47,111,94,${0.75 * (1 - p)})`; c.lineWidth = 3.4
    c.beginPath(); c.arc(128, 128, r, 0, Math.PI * 2); c.stroke()
  }
  dot(c, 128, 128, 14, WOOD)
  c.fillStyle = TOKENS.cream; c.fillRect(122, 128, 12, 9); c.strokeStyle = TOKENS.cream; c.lineWidth = 2.6
  c.beginPath(); c.arc(128, 128, 4.2, Math.PI, 0); c.stroke()
  for (let i = 0; i < 3; i++) {
    const p = frac(t * 0.5 + i / 3), x = 20 + p * 216
    c.globalAlpha = Math.sin(p * Math.PI)
    c.fillStyle = GOLD; c.fillRect(x - 21, 190, 42, 22)
    c.strokeStyle = INK; c.lineWidth = 2; c.strokeRect(x - 21, 190, 42, 22)
    c.fillStyle = INK; c.font = mono(12); c.textAlign = 'center'; c.fillText('AES', x, 205)
    c.globalAlpha = 1
  }
}

const timeline: Painter = (c, t) => {
  for (let row = 0; row < 4; row++) {
    const y = 40 + row * 40
    c.fillStyle = TAN; c.fillRect(24, y, 208, 24)
    c.fillStyle = 'rgba(26,23,18,0.18)'; c.fillRect(24, y + 21, 208, 3)
    for (let k = 0; k < 4; k++) {
      const x = 34 + frac(k * 0.26 + row * 0.07 + t * 0.05) * 188
      c.fillStyle = row % 2 ? TEAL : TERRA
      c.beginPath(); c.moveTo(x, y + 3); c.lineTo(x + 9, y + 12); c.lineTo(x, y + 21); c.lineTo(x - 9, y + 12); c.closePath(); c.fill()
      c.strokeStyle = INK; c.lineWidth = 1.4; c.stroke()
    }
  }
  const head = 24 + frac(t * 0.14) * 208
  line(c, head, 26, head, 214, 3, INK)
  c.fillStyle = INK; c.beginPath(); c.moveTo(head - 8, 22); c.lineTo(head + 8, 22); c.lineTo(head, 34); c.closePath(); c.fill()
}

const maze: Painter = (c, t) => {
  const cells = 9, size = 190, cell = size / cells, left = (256 - size) / 2, top = (256 - size) / 2
  c.strokeStyle = INK2; c.lineWidth = 3; c.lineCap = 'square'
  for (let r = 0; r < cells; r++) for (let q = 0; q < cells; q++) {
    const seed = Math.sin(r * 37.1 + q * 91.7) * 43758.5453
    const v = frac(seed)
    if (v < 0.5) { c.beginPath(); c.moveTo(left + q * cell, top + (r + 1) * cell); c.lineTo(left + (q + 1) * cell, top + (r + 1) * cell); c.stroke() }
    if (v > 0.35 && v < 0.85) { c.beginPath(); c.moveTo(left + (q + 1) * cell, top + r * cell); c.lineTo(left + (q + 1) * cell, top + (r + 1) * cell); c.stroke() }
  }
  c.strokeStyle = INK; c.lineWidth = 4; c.strokeRect(left, top, size, size)
  const steps = Math.floor(frac(t * 0.35) * cells * 2)
  c.strokeStyle = TEAL; c.lineWidth = 5; c.lineJoin = 'round'; c.beginPath()
  let x = 0, y = 0
  c.moveTo(left + cell / 2, top + cell / 2)
  for (let i = 0; i < steps; i++) { if (i % 2) y = Math.min(cells - 1, y + 1); else x = Math.min(cells - 1, x + 1); c.lineTo(left + cell * (x + 0.5), top + cell * (y + 0.5)) }
  c.stroke()
  dot(c, left + cell / 2, top + cell / 2, 6, TERRA)
  dot(c, left + size - cell / 2, top + size - cell / 2, 6, GOLD)
}

const rings: Painter = (c, t) => {
  for (let i = 0; i < 5; i++) {
    const p = frac(t * 0.22 + i / 5)
    c.strokeStyle = `rgba(168,67,31,${0.6 * (1 - p)})`; c.lineWidth = 3
    c.beginPath(); c.arc(128, 118, 22 + p * 100, 0, Math.PI * 2); c.stroke()
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + t * 0.4
    const x = 128 + Math.cos(a) * 62, y = 118 + Math.sin(a) * 40
    line(c, 128, 118, x, y, 2, 'rgba(68,61,49,0.55)')
    dot(c, x, y, 9, INK); dot(c, x, y, 6.6, i % 2 ? TERRA : TEAL)
  }
  dot(c, 128, 118, 17, INK); dot(c, 128, 118, 12, GOLD)
}

const browser: Painter = (c, t) => {
  c.fillStyle = INK; c.fillRect(24, 36, 208, 184)
  c.fillStyle = PAPER; c.fillRect(27, 58, 202, 159)
  c.fillStyle = WOOD; c.fillRect(27, 39, 202, 19)
  for (const [i, col] of [TERRA, GOLD, LEAF].entries()) dot(c, 38 + i * 12, 48.5, 3.6, col)
  c.fillStyle = TOKENS.paperHi; c.fillRect(86, 43, 130, 11)
  c.save(); c.beginPath(); c.rect(27, 58, 202, 159); c.clip()
  const scroll = (Math.sin(t * 0.8) * 0.5 + 0.5) * 60
  c.translate(0, -scroll)
  c.fillStyle = TEAL; c.fillRect(38, 70, 180, 54)
  c.fillStyle = TOKENS.cream; c.fillRect(48, 82, 90, 9); c.fillRect(48, 98, 56, 6)
  c.fillStyle = TERRA; c.fillRect(150, 94, 52, 18)
  for (let i = 0; i < 3; i++) { c.fillStyle = TAN; c.fillRect(38 + i * 62, 136, 56, 40); c.fillStyle = INK2; c.fillRect(44 + i * 62, 184, 42, 5); c.fillRect(44 + i * 62, 194, 28, 5) }
  c.fillStyle = TAN; c.fillRect(38, 214, 180, 30)
  c.restore()
  const cx = 70 + frac(t * 0.3) * 120, cy = 110 + Math.sin(t * 2.1) * 12
  c.fillStyle = INK; c.strokeStyle = TOKENS.cream; c.lineWidth = 2
  c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + 3, cy + 22); c.lineTo(cx + 9, cy + 15); c.lineTo(cx + 18, cy + 15); c.closePath(); c.fill(); c.stroke()
}

const cards: Painter = (c, t) => {
  for (let i = 0; i < 5; i++) {
    const a = (i - 2) * 0.24 + Math.sin(t * 1.1) * 0.05
    c.save(); c.translate(128, 196); c.rotate(a); c.translate(0, -112)
    c.fillStyle = 'rgba(0,0,0,0.2)'; c.fillRect(-35, -52, 76, 108)
    c.fillStyle = TOKENS.paperHi; c.fillRect(-38, -56, 76, 108); c.strokeStyle = INK; c.lineWidth = 2.4; c.strokeRect(-38, -56, 76, 108)
    const red = i % 2 === 0
    dot(c, 0, 0, 14, red ? TERRA : INK)
    c.fillStyle = red ? TERRA : INK; c.font = '700 18px ui-sans-serif, system-ui'; c.textAlign = 'left'; c.fillText(String(i + 1 + (i % 3)), -31, -36)
    c.restore()
  }
}

const jobs: Painter = (c, t) => {
  c.fillStyle = TAN; c.fillRect(22, 30, 212, 196); c.strokeStyle = WOOD; c.lineWidth = 6; c.strokeRect(22, 30, 212, 196)
  const picked = Math.floor(t * 0.8) % 6
  for (let i = 0; i < 6; i++) {
    const x = 40 + (i % 3) * 64, y = 48 + Math.floor(i / 3) * 84, a = ((i * 37) % 7 - 3) * 0.018
    c.save(); c.translate(x + 26, y + 32); c.rotate(a)
    c.fillStyle = 'rgba(0,0,0,0.2)'; c.fillRect(-26, -30, 56, 66)
    c.fillStyle = i === picked ? GOLD : TOKENS.paperHi; c.fillRect(-28, -32, 56, 66)
    c.fillStyle = INK2; for (let l = 0; l < 4; l++) c.fillRect(-20, -18 + l * 11, l === 0 ? 34 : 40, 4)
    dot(c, 0, -32, 5, i === picked ? TERRA : TEAL)
    c.restore()
  }
}

const voxel: Painter = (c, t) => {
  const iso = (x: number, y: number, z: number): [number, number] => [128 + (x - y) * 22, 150 + (x + y) * 12 - z * 24]
  const cube = (x: number, y: number, z: number, top: string, left: string, right: string) => {
    const p = [iso(x, y, z + 1), iso(x + 1, y, z + 1), iso(x + 1, y + 1, z + 1), iso(x, y + 1, z + 1), iso(x, y + 1, z), iso(x + 1, y + 1, z), iso(x + 1, y, z)]
    c.strokeStyle = INK; c.lineWidth = 1.6; c.lineJoin = 'round'
    c.fillStyle = top; c.beginPath(); c.moveTo(...p[0]); c.lineTo(...p[1]); c.lineTo(...p[2]); c.lineTo(...p[3]); c.closePath(); c.fill(); c.stroke()
    c.fillStyle = left; c.beginPath(); c.moveTo(...p[3]); c.lineTo(...p[2]); c.lineTo(...p[5]); c.lineTo(...p[4]); c.closePath(); c.fill(); c.stroke()
    c.fillStyle = right; c.beginPath(); c.moveTo(...p[2]); c.lineTo(...p[1]); c.lineTo(...p[6]); c.lineTo(...p[5]); c.closePath(); c.fill(); c.stroke()
  }
  for (let y = 2; y >= 0; y--) for (let x = 0; x < 3; x++) {
    const h = 1 + Math.round(1 + Math.sin(t * 1.4 + x * 1.3 + y * 0.9) * 0.9)
    for (let z = 0; z < h; z++) cube(x, y, z, z === h - 1 ? '#91ad78' : '#a47e50', '#6b8a53', '#4b6a1d')
  }
}

const books: Painter = (c, t) => {
  c.fillStyle = WOOD; c.fillRect(20, 208, 216, 12); c.fillRect(20, 108, 216, 10)
  const colours = [TERRA, TEAL, GOLD, LEAF, '#7e3115', TAN]
  let x = 30
  for (const [row, base] of [[0, 108], [1, 208]] as [number, number][]) {
    x = 30
    for (let i = 0; i < 6; i++) {
      const w = 22 + ((i * 7 + row * 3) % 3) * 5, h = 58 + ((i * 11 + row * 5) % 5) * 7
      const out = row === 0 && i === Math.floor(t * 0.5) % 6
      c.save(); if (out) { c.translate(x + w / 2, base); c.rotate(Math.sin(t * 2) * 0.05 - 0.12); c.translate(-x - w / 2, -base) }
      c.fillStyle = colours[(i + row * 2) % colours.length]; c.fillRect(x, base - h - (out ? 6 : 0), w, h)
      c.strokeStyle = INK; c.lineWidth = 2; c.strokeRect(x, base - h - (out ? 6 : 0), w, h)
      c.fillStyle = 'rgba(246,240,230,0.7)'; c.fillRect(x + 3, base - h + 10 - (out ? 6 : 0), w - 6, 4); c.fillRect(x + 3, base - 14 - (out ? 6 : 0), w - 6, 3)
      c.restore()
      x += w + 6
    }
  }
}

const dots: Painter = (c, t) => {
  const n = 5, gap = 44, left = 128 - (n - 1) * gap / 2, top = 128 - (n - 1) * gap / 2
  const total = (n - 1) * n * 2
  const drawn = Math.floor(frac(t * 0.18) * (total + 8))
  const edges: [number, number, number, number][] = []
  for (let r = 0; r < n; r++) for (let q = 0; q < n - 1; q++) edges.push([q, r, q + 1, r])
  for (let r = 0; r < n - 1; r++) for (let q = 0; q < n; q++) edges.push([q, r, q, r + 1])
  const order = [...edges].sort((a, b) => ((a[0] * 7 + a[1] * 13) % 11) - ((b[0] * 7 + b[1] * 13) % 11))
  const done = new Set<string>()
  order.slice(0, Math.min(drawn, order.length)).forEach(e => done.add(e.join(',')))
  for (let r = 0; r < n - 1; r++) for (let q = 0; q < n - 1; q++) {
    if (done.has([q, r, q + 1, r].join(',')) && done.has([q, r + 1, q + 1, r + 1].join(',')) && done.has([q, r, q, r + 1].join(',')) && done.has([q + 1, r, q + 1, r + 1].join(','))) {
      c.fillStyle = (q + r) % 2 ? 'rgba(47,111,94,0.55)' : 'rgba(168,67,31,0.55)'; c.fillRect(left + q * gap + 4, top + r * gap + 4, gap - 8, gap - 8)
    }
  }
  for (const e of order) if (done.has(e.join(','))) line(c, left + e[0] * gap, top + e[1] * gap, left + e[2] * gap, top + e[3] * gap, 5, INK)
  for (let r = 0; r < n; r++) for (let q = 0; q < n; q++) dot(c, left + q * gap, top + r * gap, 6.5, INK2)
}

const PAINTERS: Record<EmblemKind, Painter> = { chess, stock, orbit, gym, pipeline, tunnel, timeline, maze, rings, browser, cards, jobs, voxel, books, dots }

export const EMBLEM_KINDS = Object.keys(PAINTERS) as EmblemKind[]

/**
 * Paints emblem `kind` into a square canvas context of side `size`, opaque, paper background.
 * `seed` varies the pictures that use randomness so two boards of one kind are not twins.
 */
export function paintEmblem(c: CanvasRenderingContext2D, kind: EmblemKind, size: number, time: number, seed: string | number = kind): void {
  c.save()
  c.scale(size / EMBLEM_SIZE, size / EMBLEM_SIZE)
  c.globalAlpha = 1
  c.fillStyle = PAPER; c.fillRect(0, 0, EMBLEM_SIZE, EMBLEM_SIZE)
  const g = c.createRadialGradient(110, 100, 20, 128, 128, 190)
  g.addColorStop(0, 'rgba(255,248,226,0.5)'); g.addColorStop(1, 'rgba(120,80,30,0.16)')
  c.fillStyle = g; c.fillRect(0, 0, EMBLEM_SIZE, EMBLEM_SIZE)
  ;(PAINTERS[kind] ?? rings)(c, time, mulberry32(hashSeed(seed)))
  c.restore()
}
