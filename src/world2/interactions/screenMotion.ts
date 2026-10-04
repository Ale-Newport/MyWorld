import type { BoardProject } from '../content/projects'

/* ============================================================
   WHAT THE BIG SCREEN SHOWS

   Upstream loads a KTX2 screenshot per project and wipes between
   them. This portfolio has no screenshots for most of its work —
   several projects are private, and a folder of stale PNGs would
   age badly — so each project gets a small drawn identity instead:
   a chessboard being scanned, three bodies orbiting, an order
   book filling. Same job as a screenshot, no assets to rot, and
   it moves, which a screenshot does not.

   Everything is 2D canvas at the screen's own resolution. No
   project claims a number its data does not carry.
   ============================================================ */

const INK = '#f4f1e8'
const DIM = '#8f8aa0'
const ACCENT = '#ff8039'
const COOL = '#5390ff'
const GOOD = '#32ffc1'

type Painter = (context: CanvasRenderingContext2D, width: number, height: number, time: number) => void

const grid: Painter = (context, width, height, time) => {
  context.strokeStyle = 'rgba(143,138,160,0.18)'
  context.lineWidth = 1
  const step = 48
  const drift = (time * 12) % step
  for (let x = -step; x < width + step; x += step) {
    context.beginPath(); context.moveTo(x + drift, 0); context.lineTo(x + drift, height); context.stroke()
  }
  for (let y = -step; y < height + step; y += step) {
    context.beginPath(); context.moveTo(0, y + drift); context.lineTo(width, y + drift); context.stroke()
  }
}

const chess: Painter = (context, width, height, time) => {
  const size = Math.min(width, height) * 0.62
  const cell = size / 8
  const left = width / 2 - size / 2
  const top = height / 2 - size / 2
  for (let row = 0; row < 8; row++) {
    for (let column = 0; column < 8; column++) {
      context.fillStyle = (row + column) % 2 ? '#2b2636' : '#3b3548'
      context.fillRect(left + column * cell, top + row * cell, cell, cell)
    }
  }
  // The recognition pass sweeps down the board and boxes what it finds.
  const scan = (time * 0.5) % 1
  const y = top + scan * size
  context.fillStyle = 'rgba(50,255,193,0.16)'
  context.fillRect(left, y - cell * 0.5, size, cell)
  context.strokeStyle = GOOD
  context.lineWidth = 3
  context.beginPath(); context.moveTo(left, y); context.lineTo(left + size, y); context.stroke()
  const found = Math.floor(scan * 8)
  context.lineWidth = 2
  for (let row = 0; row < found; row++) {
    for (const column of [1, 3, 6]) {
      if ((row * 3 + column) % 4) continue
      context.strokeStyle = 'rgba(50,255,193,0.8)'
      context.strokeRect(left + column * cell + 4, top + row * cell + 4, cell - 8, cell - 8)
    }
  }
  // Best move.
  const from = { x: left + cell * 4.5, y: top + cell * 6.5 }
  const to = { x: left + cell * 4.5, y: top + cell * 4.5 }
  context.strokeStyle = ACCENT
  context.lineWidth = 6
  context.lineCap = 'round'
  context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y + 14); context.stroke()
  context.beginPath()
  context.moveTo(to.x, to.y - 6); context.lineTo(to.x - 13, to.y + 16); context.lineTo(to.x + 13, to.y + 16)
  context.closePath(); context.fillStyle = ACCENT; context.fill()
}

const stock: Painter = (context, width, height, time) => {
  const bars = 34
  const barWidth = width / (bars + 6)
  let value = height * 0.55
  for (let i = 0; i < bars; i++) {
    const seed = Math.sin(i * 12.9898 + Math.floor(time * 1.2) * 0.7) * 43758.5453
    const move = ((seed - Math.floor(seed)) - 0.45) * height * 0.08
    const open = value
    value = Math.max(height * 0.18, Math.min(height * 0.82, value + move))
    const up = value < open
    context.strokeStyle = context.fillStyle = up ? GOOD : ACCENT
    const x = barWidth * (i + 3)
    context.lineWidth = 2
    context.beginPath(); context.moveTo(x, Math.min(open, value) - 8); context.lineTo(x, Math.max(open, value) + 8); context.stroke()
    context.fillRect(x - barWidth * 0.3, Math.min(open, value), barWidth * 0.6, Math.max(2, Math.abs(value - open)))
  }
  // Order book ticking down the right-hand side.
  context.font = '600 20px ui-monospace, SFMono-Regular, monospace'
  for (let i = 0; i < 8; i++) {
    const alive = (time * 3 + i) % 8
    context.fillStyle = i % 2 ? GOOD : ACCENT
    context.globalAlpha = 0.35 + (alive / 8) * 0.5
    context.textAlign = 'right'
    context.fillText(`${i % 2 ? 'BUY ' : 'SELL'} ${(120 + i * 7).toFixed(0)}.${((i * 37) % 100).toString().padStart(2, '0')}`, width - 28, 70 + i * 28)
  }
  context.globalAlpha = 1
}

const threeBody: Painter = (context, width, height, time) => {
  const centre = { x: width / 2, y: height / 2 }
  const colours = [ACCENT, COOL, GOOD]
  for (let i = 0; i < 3; i++) {
    const phase = time * (0.6 + i * 0.22) + (i * Math.PI * 2) / 3
    const radius = Math.min(width, height) * (0.16 + i * 0.09)
    const wobble = Math.sin(time * 0.9 + i) * radius * 0.18
    context.strokeStyle = 'rgba(143,138,160,0.28)'
    context.lineWidth = 1
    context.beginPath(); context.ellipse(centre.x, centre.y, radius + wobble, radius * 0.72, i * 0.7, 0, Math.PI * 2); context.stroke()
    const x = centre.x + Math.cos(phase) * (radius + wobble)
    const y = centre.y + Math.sin(phase) * radius * 0.72
    const glow = context.createRadialGradient(x, y, 0, x, y, 34)
    glow.addColorStop(0, colours[i])
    glow.addColorStop(1, 'rgba(0,0,0,0)')
    context.fillStyle = glow
    context.beginPath(); context.arc(x, y, 34, 0, Math.PI * 2); context.fill()
    context.fillStyle = colours[i]
    context.beginPath(); context.arc(x, y, 9, 0, Math.PI * 2); context.fill()
  }
}

const gym: Painter = (context, width, height, time) => {
  // A rigged figure doing reps, plus the count.
  const cycle = (Math.sin(time * 2.4) + 1) / 2
  const hip = { x: width / 2, y: height * 0.62 + cycle * height * 0.06 }
  const shoulder = { x: hip.x, y: hip.y - height * 0.2 }
  context.strokeStyle = INK
  context.lineWidth = 9
  context.lineCap = 'round'
  const limb = (from: { x: number; y: number }, dx: number, dy: number) => {
    context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(from.x + dx, from.y + dy); context.stroke()
  }
  context.beginPath(); context.moveTo(hip.x, hip.y); context.lineTo(shoulder.x, shoulder.y); context.stroke()
  context.beginPath(); context.arc(shoulder.x, shoulder.y - 30, 22, 0, Math.PI * 2); context.fillStyle = INK; context.fill()
  limb(shoulder, -52, 30 - cycle * 52)
  limb(shoulder, 52, 30 - cycle * 52)
  limb(hip, -40, 70)
  limb(hip, 40, 70)
  context.strokeStyle = ACCENT
  context.lineWidth = 12
  const barY = shoulder.y + 30 - cycle * 52
  context.beginPath(); context.moveTo(shoulder.x - 92, barY); context.lineTo(shoulder.x + 92, barY); context.stroke()
  context.fillStyle = DIM
  context.font = '700 26px ui-monospace, SFMono-Regular, monospace'
  context.textAlign = 'left'
  context.fillText(`REPS ${String(Math.floor(time * 1.2) % 12 + 1).padStart(2, '0')}`, 34, height - 34)
}

const pipeline: Painter = (context, width, height, time) => {
  const stages = ['PROMPT', 'SCRIPT', 'VOICE', 'CAPTIONS', 'RENDER']
  const y = height / 2
  const gap = width / (stages.length + 1)
  stages.forEach((stage, i) => {
    const x = gap * (i + 1)
    const active = (time * 0.9) % stages.length
    const lit = Math.max(0, 1 - Math.abs(active - i))
    context.strokeStyle = i ? 'rgba(143,138,160,0.4)' : 'transparent'
    context.lineWidth = 3
    if (i) { context.beginPath(); context.moveTo(x - gap + 46, y); context.lineTo(x - 46, y); context.stroke() }
    context.fillStyle = lit > 0.05 ? ACCENT : '#2f2a3b'
    context.beginPath(); context.arc(x, y, 34 + lit * 8, 0, Math.PI * 2); context.fill()
    context.fillStyle = lit > 0.05 ? '#1a1622' : DIM
    context.font = '700 15px ui-sans-serif, system-ui, sans-serif'
    context.textAlign = 'center'
    context.fillText(String(i + 1), x, y + 6)
    context.fillStyle = INK
    context.font = '600 17px ui-sans-serif, system-ui, sans-serif'
    context.fillText(stage, x, y + 78)
  })
}

const tunnel: Painter = (context, width, height, time) => {
  const centre = { x: width / 2, y: height / 2 }
  for (let i = 0; i < 14; i++) {
    const progress = ((time * 0.35 + i / 14) % 1)
    const radius = progress * Math.min(width, height) * 0.75
    context.strokeStyle = `rgba(83,144,255,${0.55 * (1 - progress)})`
    context.lineWidth = 3
    context.beginPath(); context.arc(centre.x, centre.y, radius, 0, Math.PI * 2); context.stroke()
  }
  for (let i = 0; i < 5; i++) {
    const progress = ((time * 0.55 + i / 5) % 1)
    const x = width * progress
    context.fillStyle = GOOD
    context.globalAlpha = Math.sin(progress * Math.PI)
    context.fillRect(x - 26, centre.y - 12, 52, 24)
    context.globalAlpha = 1
    context.fillStyle = '#151220'
    context.font = '700 13px ui-monospace, monospace'
    context.textAlign = 'center'
    context.fillText('AES', x, centre.y + 5)
  }
}

const timeline: Painter = (context, width, height, time) => {
  const rows = 4
  const rowHeight = height / (rows + 2)
  for (let row = 0; row < rows; row++) {
    const y = rowHeight * (row + 1.2)
    context.fillStyle = '#2b2636'
    context.fillRect(60, y, width - 120, rowHeight * 0.6)
    for (let key = 0; key < 5; key++) {
      const x = 60 + ((key * 0.21 + row * 0.05 + time * 0.06) % 1) * (width - 140)
      context.fillStyle = row % 2 ? COOL : ACCENT
      context.beginPath()
      context.moveTo(x, y + rowHeight * 0.1); context.lineTo(x + 12, y + rowHeight * 0.3)
      context.lineTo(x, y + rowHeight * 0.5); context.lineTo(x - 12, y + rowHeight * 0.3)
      context.closePath(); context.fill()
    }
  }
  const head = 60 + ((time * 0.14) % 1) * (width - 140)
  context.strokeStyle = INK
  context.lineWidth = 3
  context.beginPath(); context.moveTo(head, rowHeight * 0.6); context.lineTo(head, height - rowHeight * 0.6); context.stroke()
}

const maze: Painter = (context, width, height, time) => {
  const cells = 13
  const size = Math.min(width, height) * 0.7
  const cell = size / cells
  const left = width / 2 - size / 2
  const top = height / 2 - size / 2
  context.strokeStyle = 'rgba(143,138,160,0.5)'
  context.lineWidth = 2
  for (let row = 0; row < cells; row++) {
    for (let column = 0; column < cells; column++) {
      const seed = Math.sin(row * 37.1 + column * 91.7) * 43758.5453
      if ((seed - Math.floor(seed)) > 0.62) continue
      context.strokeRect(left + column * cell, top + row * cell, cell, cell)
    }
  }
  // The solver's path, drawn in as far as the clock has got.
  const steps = Math.floor(((time * 0.4) % 1) * cells * 2)
  context.strokeStyle = GOOD
  context.lineWidth = 5
  context.lineJoin = 'round'
  context.beginPath()
  let x = 0, y = 0
  context.moveTo(left + cell * 0.5, top + cell * 0.5)
  for (let i = 0; i < steps; i++) {
    if (i % 2) y = Math.min(cells - 1, y + 1); else x = Math.min(cells - 1, x + 1)
    context.lineTo(left + cell * (x + 0.5), top + cell * (y + 0.5))
  }
  context.stroke()
}

/** Anything without a hand-drawn identity still gets something that moves. */
const generic: Painter = (context, width, height, time) => {
  const centre = { x: width / 2, y: height * 0.44 }
  const rings = 5
  for (let i = 0; i < rings; i++) {
    const progress = ((time * 0.22 + i / rings) % 1)
    context.strokeStyle = `rgba(244,241,232,${0.35 * (1 - progress)})`
    context.lineWidth = 2
    context.beginPath()
    context.arc(centre.x, centre.y, 40 + progress * Math.min(width, height) * 0.42, 0, Math.PI * 2)
    context.stroke()
  }
  const nodes = 7
  for (let i = 0; i < nodes; i++) {
    const angle = (i / nodes) * Math.PI * 2 + time * 0.24
    const radius = Math.min(width, height) * 0.26
    const x = centre.x + Math.cos(angle) * radius
    const y = centre.y + Math.sin(angle) * radius * 0.62
    context.strokeStyle = 'rgba(143,138,160,0.5)'
    context.lineWidth = 1.5
    context.beginPath(); context.moveTo(centre.x, centre.y); context.lineTo(x, y); context.stroke()
    context.fillStyle = i % 2 ? ACCENT : COOL
    context.beginPath(); context.arc(x, y, 9, 0, Math.PI * 2); context.fill()
  }
  context.fillStyle = INK
  context.beginPath(); context.arc(centre.x, centre.y, 16, 0, Math.PI * 2); context.fill()
}

const PAINTERS: Record<string, Painter> = {
  ChessMotion: chess,
  StockMotion: stock,
  ThreeBodyMotion: threeBody,
  GymMotion: gym,
  FocusMotion: pipeline,
  VideoPlayerMotion: pipeline,
  VpnMotion: tunnel,
  KeyframesMotion: timeline,
  TrainingMotion: timeline,
  LabyrinthMotion: maze,
  CatanMotion: maze,
  PrimesMotion: generic,
}

/** Paints one project's screen frame. `time` is seconds, and may be huge. */
export function paintProjectScreen(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  project: BoardProject,
  time: number,
): void {
  context.fillStyle = '#14111c'
  context.fillRect(0, 0, width, height)
  grid(context, width, height, time)
  const painter = PAINTERS[project.motion] ?? generic
  painter(context, width, height, time)

  // The caption band. Kept to one line of each so the art stays the subject.
  const band = height * 0.24
  context.fillStyle = 'rgba(14,11,20,0.86)'
  context.fillRect(0, height - band, width, band)
  context.textAlign = 'left'
  context.fillStyle = INK
  context.font = `700 ${Math.round(band * 0.34)}px ui-sans-serif, system-ui, sans-serif`
  context.fillText(project.title, 34, height - band + band * 0.42)
  context.fillStyle = DIM
  context.font = `600 ${Math.round(band * 0.2)}px ui-sans-serif, system-ui, sans-serif`
  context.fillText(`${project.category} · ${project.year}`, 34, height - band + band * 0.68)
  const detail = project.metric ?? project.description
  context.fillStyle = project.metric ? GOOD : DIM
  context.font = `600 ${Math.round(band * 0.19)}px ui-sans-serif, system-ui, sans-serif`
  const maxWidth = width - 68
  let line = detail
  while (context.measureText(line).width > maxWidth && line.length > 4) line = `${line.slice(0, -5)}…`
  context.fillText(line, 34, height - band + band * 0.9)
}
