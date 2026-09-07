'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCanvas2D } from '@/hooks/useCanvas2D'
import { readPalette, type ProjectVisualProps, type VisualPalette } from './types'
import { clamp, damp, easeInOutCubic, easeOutCubic, lerp, range, seeded } from '@/lib/math'
import styles from './visual.module.css'

/* ============================================================
   FOCUS — one generated learning short, taken apart.

   A phone plays a generated short. As the timeline advances the
   frame explodes into the ten production layers the pipeline
   actually runs — script, model, content, voice, audio,
   characters, motion, captions, renderer, app — suspended in
   depth along one axis. Every layer runs its own behaviour off a
   SINGLE shared clock: the same word segmentation drives the
   script typing, the pitch contour, the waveform envelope, the
   character's mouth, the caption chips, the rendered frames and
   the phone scrubber. The accent colour is reserved for that
   clock — a thread of light piercing the whole stack.
   Scrolling on recombines the sheets back into the video.
   ============================================================ */

const LAYERS = [
  'SCRIPT', 'MODEL', 'CONTENT', 'VOICE', 'AUDIO',
  'CHARACTERS', 'MOTION', 'CAPTIONS', 'RENDERER', 'APP',
] as const
const N = LAYERS.length

/* --- card geometry, in local (sheet) units --- */
const HW = 78
const HH = 162
const GAP = 104
/** Extra depth opened in front of the layer being inspected, so its
    face clears the sheet stacked on top of it. */
const PUSH = 235
const FOCAL = 1500
const DESIGN_W = 730
const DESIGN_H = 560
const YAW = 0.52
const PITCH = 0.17

/* --- clocks --- */
const LOOP = 21      // seconds for one self-running explode/recombine
const CLIP = 7.2     // seconds of generated short
const WAVE_N = 128

/* --- the short being generated (demo content, not a claim) --- */
const SCRIPT_LINES = [
  'topic  how neurons fire',
  'a neuron is a switch.',
  'inputs add up.',
  'cross the threshold',
  'and it fires.',
  'all or none.',
]
const LINE_NO = ['01', '02', '03', '04', '05', '06']
const PLATE = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']
const WORDS = [
  'A NEURON', 'IS A SWITCH.', 'INPUTS', 'ADD UP.', 'CROSS THE',
  'THRESHOLD', 'AND IT', 'FIRES.', 'ALL OR NONE.',
]
const WORD_LINE = [1, 1, 2, 2, 3, 3, 4, 4, 5]
const CONTENT_KEYS = ['topic', 'beats', 'voice', 'format', 'assets', 'length']

const DASH: number[] = [2.2, 3.2]
const NODASH: number[] = []
const TWO_PI = Math.PI * 2

/* ============================================================
   Shared per-card drawing context. Allocated once, mutated per
   layer per frame — nothing here is created inside the loop.
   ============================================================ */
interface Cell {
  p: VisualPalette
  a: number        // card alpha after depth + focus dimming
  scr: number      // screen pixels per local unit
  px: number       // local units per screen pixel
  pt: number       // playhead, 0..1 across the clip
  amp: number      // waveform amplitude under the playhead
  wi: number       // word currently voiced, -1 in a gap
  lw: number       // last word that started, -1 before the first
  wp: number       // progress through the active script line
  segS: Float64Array
  segE: Float64Array
  wave: Float32Array
  pitch: Float32Array
  att: Float32Array
  attTo: Uint8Array
  bars: Float32Array
  ax: number       // out: local x of this layer's time anchor
  ay: number       // out: local y of this layer's time anchor
  hasAnchor: boolean
}

/* ---------- primitive helpers (no allocation) ---------- */

function rrect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2)
  ctx.beginPath()
  ctx.moveTo(x + rad, y)
  ctx.arcTo(x + w, y, x + w, y + h, rad)
  ctx.arcTo(x + w, y + h, x, y + h, rad)
  ctx.arcTo(x, y + h, x, y, rad)
  ctx.arcTo(x, y, x + w, y, rad)
  ctx.closePath()
}

function seg(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
) {
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

function txt(
  ctx: CanvasRenderingContext2D, c: Cell, s: string,
  x: number, y: number, size: number,
  color: string, alpha: number, align: CanvasTextAlign,
) {
  if (alpha <= 0.012 || size * c.scr < 4.4 || s.length === 0) return
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.font = `${size}px ui-monospace, monospace`
  ctx.textAlign = align
  ctx.fillText(s, x, y)
}

/** Local x for a normalised time u — every timed layer shares it. */
function tx(u: number) {
  return -64 + clamp(u) * 128
}

function playhead(ctx: CanvasRenderingContext2D, c: Cell, y1: number, y2: number) {
  const x = tx(c.pt)
  ctx.globalAlpha = c.a * 0.85
  ctx.strokeStyle = c.p.accent
  ctx.lineWidth = 1.1 * c.px
  seg(ctx, x, y1, x, y2)
}

function sampleAt(arr: Float32Array, u: number) {
  const i = clamp(Math.floor(u * WAVE_N), 0, WAVE_N - 1)
  return arr[i]
}

/** An abstract presenter — head, shoulders, and a mouth driven by the audio. */
function drawBust(
  ctx: CanvasRenderingContext2D, c: Cell,
  ox: number, oy: number, k: number, alpha: number,
) {
  ctx.globalAlpha = alpha
  ctx.strokeStyle = c.p.ink
  ctx.lineWidth = 1 * c.px
  ctx.beginPath()
  ctx.arc(ox, oy - 32 * k, 16 * k, 0, TWO_PI)
  ctx.stroke()

  /* shoulders: closed block, vertical sides, sloped tops */
  ctx.beginPath()
  ctx.moveTo(ox - 50 * k, oy + 42 * k)
  ctx.lineTo(ox - 50 * k, oy + 14 * k)
  ctx.quadraticCurveTo(ox - 43 * k, oy - 9 * k, ox - 9 * k, oy - 14 * k)
  ctx.lineTo(ox + 9 * k, oy - 14 * k)
  ctx.quadraticCurveTo(ox + 43 * k, oy - 9 * k, ox + 50 * k, oy + 14 * k)
  ctx.lineTo(ox + 50 * k, oy + 42 * k)
  ctx.closePath()
  ctx.stroke()

  /* eyes as ticks, not dots — a diagram, not a cartoon */
  ctx.lineWidth = 1.1 * c.px
  seg(ctx, ox - 8 * k, oy - 37 * k, ox - 4 * k, oy - 37 * k)
  seg(ctx, ox + 4 * k, oy - 37 * k, ox + 8 * k, oy - 37 * k)
  ctx.lineWidth = 1 * c.px

  ctx.beginPath()
  ctx.ellipse(ox, oy - 25 * k, 5 * k, (0.6 + c.amp * 3.6) * k, 0, 0, TWO_PI)
  ctx.stroke()
}

/* ============================================================
   LAYER 01 — SCRIPT. The beat sheet types itself, one line per
   spoken beat, with the caret sitting on the line being said.
   ============================================================ */
function drawScript(ctx: CanvasRenderingContext2D, c: Cell) {
  const fs = 8
  const cw = fs * 0.6
  const active = c.lw < 0 ? 0 : WORD_LINE[c.lw]
  for (let i = 0; i < SCRIPT_LINES.length; i++) {
    const y = -104 + i * 27
    if (i > active) {
      ctx.globalAlpha = c.a * 0.16
      ctx.strokeStyle = c.p.inkFaint
      ctx.lineWidth = 0.75 * c.px
      seg(ctx, -46, y + 3, -46 + 34, y + 3)
      continue
    }
    txt(ctx, c, LINE_NO[i], -64, y, fs * 0.85, c.p.inkFaint, c.a * 0.45, 'left')
    const full = SCRIPT_LINES[i]
    if (i < active) {
      txt(ctx, c, full, -46, y, fs, c.p.inkSoft, c.a * 0.6, 'left')
      continue
    }
    const k = Math.max(1, Math.round(full.length * clamp(c.wp * 1.25)))
    const shown = full.slice(0, k)
    txt(ctx, c, shown, -46, y, fs, c.p.ink, c.a, 'left')
    if ((c.pt * 22) % 1 < 0.62) {
      ctx.globalAlpha = c.a * 0.8
      ctx.fillStyle = c.p.accent
      ctx.fillRect(-46 + shown.length * cw + 0.8, y - fs * 0.5, cw * 0.8, fs)
    }
    c.ax = -46 + shown.length * cw
    c.ay = y
    c.hasAnchor = true
  }
}

/* ============================================================
   LAYER 02 — MODEL. Tokens condition tokens: the generator emits
   the script left to right, each new token pulling on the ones
   it attends to.
   ============================================================ */
function drawModel(ctx: CanvasRenderingContext2D, c: Cell) {
  const cols = 9
  const step = 14.5
  const x0 = -62
  const topY = -96
  const botY = 46
  const emitted = Math.floor(c.pt * cols)

  ctx.lineWidth = 0.75 * c.px
  for (let j = 0; j <= Math.min(emitted, cols - 1); j++) {
    const bx = x0 + j * step + 5
    for (let k = 0; k < 3; k++) {
      const target = c.attTo[j * 3 + k]
      const wgt = c.att[j * 3 + k]
      const txp = x0 + target * step + 5
      ctx.globalAlpha = c.a * wgt * (j === emitted ? 0.75 : 0.22)
      ctx.strokeStyle = j === emitted ? c.p.accent : c.p.inkSoft
      ctx.beginPath()
      ctx.moveTo(txp, topY + 10)
      ctx.quadraticCurveTo((txp + bx) * 0.5, (topY + botY) * 0.5, bx, botY)
      ctx.stroke()
    }
  }

  for (let j = 0; j < cols; j++) {
    const x = x0 + j * step
    ctx.globalAlpha = c.a * 0.4
    ctx.strokeStyle = c.p.inkFaint
    ctx.lineWidth = 0.75 * c.px
    ctx.strokeRect(x, topY, 10, 10)
    ctx.strokeRect(x, botY, 10, 10)
    if (j <= emitted) {
      ctx.globalAlpha = c.a * (j === emitted ? 0.95 : 0.5)
      ctx.fillStyle = j === emitted ? c.p.accent : c.p.ink
      ctx.fillRect(x + 2, botY + 2, 6, 6)
    }
    ctx.globalAlpha = c.a * 0.5
    ctx.fillStyle = c.p.inkSoft
    ctx.fillRect(x + 2, topY + 2, 6, 6)
  }
  txt(ctx, c, 'next token', -64, botY + 30, 7.5, c.p.inkFaint, c.a * 0.5, 'left')
}

/* ============================================================
   LAYER 03 — CONTENT. One content model. The format field
   branches into the visual formats it can be rendered as —
   the model does not change when the format does.
   ============================================================ */
function drawContent(ctx: CanvasRenderingContext2D, c: Cell) {
  for (let i = 0; i < CONTENT_KEYS.length; i++) {
    const y = -112 + i * 26
    txt(ctx, c, CONTENT_KEYS[i], -64, y, 8, c.p.inkSoft, c.a * 0.7, 'left')
    ctx.globalAlpha = c.a * 0.35
    ctx.strokeStyle = c.p.inkFaint
    ctx.lineWidth = 0.75 * c.px
    ctx.strokeRect(-4, y - 5, 68, 10)
    ctx.globalAlpha = c.a * 0.5
    ctx.fillStyle = c.p.ink
    ctx.fillRect(-4, y - 5, 68 * c.bars[i], 10)
  }

  const branchY = -112 + 3 * 26 + 5
  const thumbY = 66
  for (let i = 0; i < 3; i++) {
    const x = -54 + i * 39
    const sel = i === 1
    ctx.globalAlpha = c.a * (sel ? 0.5 : 0.22)
    ctx.strokeStyle = c.p.inkFaint
    ctx.lineWidth = 0.75 * c.px
    ctx.beginPath()
    ctx.moveTo(30, branchY)
    ctx.quadraticCurveTo(x + 15, branchY + 22, x + 15, thumbY)
    ctx.stroke()

    ctx.globalAlpha = c.a * (sel ? 0.9 : 0.3)
    ctx.strokeStyle = sel ? c.p.ink : c.p.inkFaint
    ctx.lineWidth = (sel ? 1 : 0.75) * c.px
    rrect(ctx, x, thumbY, 30, 42, 2)
    ctx.stroke()
    ctx.globalAlpha = c.a * (sel ? 0.45 : 0.18)
    if (i === 0) {
      ctx.fillStyle = c.p.inkSoft
      ctx.fillRect(x + 4, thumbY + 4, 22, 34)
    } else if (i === 1) {
      ctx.fillStyle = c.p.inkSoft
      ctx.fillRect(x + 4, thumbY + 4, 22, 20)
      ctx.fillRect(x + 4, thumbY + 28, 14, 10)
    } else {
      ctx.fillStyle = c.p.inkSoft
      ctx.fillRect(x + 4, thumbY + 4, 10, 16)
      ctx.fillRect(x + 16, thumbY + 4, 10, 16)
      ctx.fillRect(x + 4, thumbY + 22, 10, 16)
      ctx.fillRect(x + 16, thumbY + 22, 10, 16)
    }
  }
  txt(ctx, c, 'formats', -64, thumbY + 56, 7.5, c.p.inkFaint, c.a * 0.5, 'left')
}

/* ============================================================
   LAYER 04 — VOICE. Synthesis: a pitch contour that only exists
   where a word is voiced, ticked at every phrase boundary.
   ============================================================ */
function drawVoice(ctx: CanvasRenderingContext2D, c: Cell) {
  const base = -24
  ctx.globalAlpha = c.a * 0.3
  ctx.strokeStyle = c.p.inkFaint
  ctx.lineWidth = 0.75 * c.px
  seg(ctx, -64, base, 64, base)

  ctx.globalAlpha = c.a * 0.9
  ctx.strokeStyle = c.p.ink
  ctx.lineWidth = 1 * c.px
  ctx.beginPath()
  let pen = false
  for (let j = 0; j < WAVE_N; j++) {
    const u = (j + 0.5) / WAVE_N
    if (c.wave[j] < 0.12) { pen = false; continue }
    const x = tx(u)
    const y = base - (c.pitch[j] - 0.5) * 74
    if (!pen) { ctx.moveTo(x, y); pen = true } else ctx.lineTo(x, y)
  }
  ctx.stroke()

  ctx.globalAlpha = c.a * 0.4
  ctx.strokeStyle = c.p.inkFaint
  ctx.lineWidth = 0.75 * c.px
  for (let i = 0; i < WORDS.length; i++) {
    const x = tx(c.segS[i])
    seg(ctx, x, base + 46, x, base + 58)
  }
  playhead(ctx, c, base - 62, base + 64)

  const py = base - (sampleAt(c.pitch, c.pt) - 0.5) * 74
  ctx.globalAlpha = c.a
  ctx.fillStyle = c.p.accent
  ctx.beginPath()
  ctx.arc(tx(c.pt), py, 3.2 * c.px, 0, TWO_PI)
  ctx.fill()
  c.ax = tx(c.pt)
  c.ay = py
  c.hasAnchor = true

  txt(ctx, c, 'f0 contour', -64, base + 82, 7.5, c.p.inkFaint, c.a * 0.5, 'left')
}

/* ============================================================
   LAYER 05 — AUDIO. The rendered narration. Everything below
   this layer is timed off these word segments.
   ============================================================ */
function drawAudio(ctx: CanvasRenderingContext2D, c: Cell) {
  const bars = 42
  const bw = 1.7
  for (let b = 0; b < bars; b++) {
    const u = (b + 0.5) / bars
    const a = sampleAt(c.wave, u) * 58
    const x = tx(u) - bw / 2
    const on = u <= c.pt
    ctx.globalAlpha = c.a * (on ? 0.7 : 0.26)
    ctx.fillStyle = on ? c.p.ink : c.p.inkSoft
    ctx.fillRect(x, -a, bw, Math.max(a * 2, 0.8))
  }

  ctx.globalAlpha = c.a * 0.35
  ctx.strokeStyle = c.p.inkFaint
  ctx.lineWidth = 0.75 * c.px
  for (let i = 0; i < WORDS.length; i++) {
    const a = tx(c.segS[i])
    const b = tx(c.segE[i])
    seg(ctx, a, 104, b, 104)
    seg(ctx, a, 100, a, 108)
  }
  playhead(ctx, c, -96, 112)
  c.ax = tx(c.pt)
  c.ay = 0
  c.hasAnchor = true

  txt(ctx, c, 'narration', -64, -122, 7.5, c.p.inkFaint, c.a * 0.5, 'left')
}

/* ============================================================
   LAYER 06 — CHARACTERS. The presenter. Its mouth is driven by
   the same amplitude array the audio layer draws.
   ============================================================ */
function drawCharacters(ctx: CanvasRenderingContext2D, c: Cell) {
  drawBust(ctx, c, -40, -34, 0.55, c.a * 0.16)
  drawBust(ctx, c, 40, -34, 0.55, c.a * 0.16)
  drawBust(ctx, c, 0, -38, 1.15, c.a * 0.95)

  for (let i = 0; i < 3; i++) {
    const x = -32 + i * 32
    const sel = i === 1
    ctx.globalAlpha = c.a * (sel ? 0.9 : 0.28)
    ctx.strokeStyle = sel ? c.p.ink : c.p.inkFaint
    ctx.lineWidth = (sel ? 1 : 0.75) * c.px
    ctx.beginPath()
    ctx.arc(x, 108, 9, 0, TWO_PI)
    ctx.stroke()
  }
  c.ax = 0
  c.ay = -67
  c.hasAnchor = true
  txt(ctx, c, 'presenter', -64, 140, 7.5, c.p.inkFaint, c.a * 0.5, 'left')
}

/* ============================================================
   LAYER 07 — MOTION. Composition curves. The playhead reads a
   value out of each one — the layout moves because a curve says
   so, not because a frame was drawn by hand.
   ============================================================ */
function drawMotion(ctx: CanvasRenderingContext2D, c: Cell) {
  for (let plot = 0; plot < 2; plot++) {
    const top = plot === 0 ? -122 : -6
    const bot = top + 66
    ctx.globalAlpha = c.a * 0.3
    ctx.strokeStyle = c.p.inkFaint
    ctx.lineWidth = 0.75 * c.px
    seg(ctx, -64, bot, 64, bot)
    seg(ctx, -64, top, -64, bot)

    ctx.globalAlpha = c.a * 0.85
    ctx.strokeStyle = c.p.ink
    ctx.lineWidth = 1 * c.px
    ctx.beginPath()
    ctx.moveTo(-64, bot)
    if (plot === 0) ctx.bezierCurveTo(-24, bot, -6, top, 64, top)
    else ctx.bezierCurveTo(-20, bot, 20, top, 64, top)
    ctx.stroke()

    const e = plot === 0 ? easeOutCubic(c.pt) : easeInOutCubic(c.pt)
    const vx = tx(c.pt)
    const vy = bot + (top - bot) * e

    ctx.globalAlpha = c.a * 0.4
    ctx.strokeStyle = c.p.inkFaint
    ctx.setLineDash(DASH)
    ctx.lineWidth = 0.75 * c.px
    seg(ctx, -64, vy, vx, vy)
    ctx.setLineDash(NODASH)

    ctx.globalAlpha = c.a * 0.5
    ctx.fillStyle = c.p.inkFaint
    ctx.beginPath()
    ctx.arc(-64, bot, 2, 0, TWO_PI)
    ctx.arc(64, top, 2, 0, TWO_PI)
    ctx.fill()

    ctx.globalAlpha = c.a
    ctx.fillStyle = c.p.accent
    ctx.beginPath()
    ctx.arc(vx, vy, 2.6, 0, TWO_PI)
    ctx.fill()

    if (plot === 0) {
      c.ax = vx
      c.ay = vy
      c.hasAnchor = true
    }
  }
  txt(ctx, c, 'ease · scale · hold', -64, 100, 7.5, c.p.inkFaint, c.a * 0.5, 'left')
}

/* ============================================================
   LAYER 08 — CAPTIONS. Chips laid out on the same segments the
   audio was built from — the captions are not typed, they are
   read off the speech.
   ============================================================ */
function drawCaptions(ctx: CanvasRenderingContext2D, c: Cell) {
  const cur = c.lw
  if (cur > 0) txt(ctx, c, WORDS[cur - 1], 0, -76, 11, c.p.inkFaint, c.a * 0.5, 'center')
  if (cur >= 0) txt(ctx, c, WORDS[cur], 0, -50, 13, c.p.ink, c.a, 'center')
  if (cur >= 0 && cur < WORDS.length - 1) {
    txt(ctx, c, WORDS[cur + 1], 0, -24, 11, c.p.inkFaint, c.a * 0.3, 'center')
  }

  ctx.globalAlpha = c.a * 0.28
  ctx.strokeStyle = c.p.inkFaint
  ctx.lineWidth = 0.75 * c.px
  seg(ctx, -64, 74, 64, 74)

  for (let i = 0; i < WORDS.length; i++) {
    const a = tx(c.segS[i])
    const b = tx(c.segE[i])
    const on = i === c.wi
    ctx.globalAlpha = c.a * (on ? 0.95 : 0.45)
    if (on) {
      ctx.fillStyle = c.p.accent
      ctx.fillRect(a, 68, b - a, 12)
    } else {
      ctx.strokeStyle = i <= cur ? c.p.inkSoft : c.p.inkFaint
      ctx.lineWidth = 0.75 * c.px
      ctx.strokeRect(a, 68, b - a, 12)
    }
  }
  playhead(ctx, c, 46, 102)
  c.ax = tx(c.pt)
  c.ay = 74
  c.hasAnchor = true
  txt(ctx, c, 'aligned to audio', -64, 124, 7.5, c.p.inkFaint, c.a * 0.5, 'left')
}

/* ============================================================
   LAYER 09 — RENDERER. Frames composited in order. Everything
   above collapses into this grid.
   ============================================================ */
function drawRenderer(ctx: CanvasRenderingContext2D, c: Cell) {
  const cols = 5
  const rows = 7
  const cell = 19
  const gap = 4
  const x0 = -(cols * (cell + gap) - gap) / 2
  const y0 = -(rows * (cell + gap) - gap) / 2 - 8
  const total = cols * rows
  const done = Math.floor(clamp(c.pt) * total)

  for (let i = 0; i < total; i++) {
    const cx = x0 + (i % cols) * (cell + gap)
    const cy = y0 + Math.floor(i / cols) * (cell + gap)
    if (i < done) {
      ctx.globalAlpha = c.a * 0.2
      ctx.fillStyle = c.p.signal
      ctx.fillRect(cx, cy, cell, cell)
      ctx.globalAlpha = c.a * 0.4
      ctx.strokeStyle = c.p.inkSoft
      ctx.lineWidth = 0.75 * c.px
      ctx.strokeRect(cx, cy, cell, cell)
    } else if (i === done) {
      ctx.globalAlpha = c.a
      ctx.strokeStyle = c.p.accent
      ctx.lineWidth = 1.25 * c.px
      ctx.strokeRect(cx, cy, cell, cell)
      c.ax = cx + cell / 2
      c.ay = cy + cell / 2
      c.hasAnchor = true
    } else {
      ctx.globalAlpha = c.a * 0.22
      ctx.strokeStyle = c.p.inkFaint
      ctx.lineWidth = 0.75 * c.px
      ctx.strokeRect(cx, cy, cell, cell)
    }
  }
  txt(ctx, c, 'composite', -64, y0 + rows * (cell + gap) + 16, 7.5, c.p.inkFaint, c.a * 0.5, 'left')
}

/* ============================================================
   LAYER 10 — APP. The short, playing. When the stack is closed
   this is the only sheet you see.
   ============================================================ */
function drawApp(ctx: CanvasRenderingContext2D, c: Cell) {
  ctx.globalAlpha = c.a * 0.25
  ctx.fillStyle = c.p.inkFaint
  rrect(ctx, -17, -150, 34, 8, 4)
  ctx.fill()

  ctx.globalAlpha = c.a * 0.3
  ctx.strokeStyle = c.p.inkFaint
  ctx.lineWidth = 0.75 * c.px
  rrect(ctx, -64, -130, 128, 206, 3)
  ctx.stroke()

  drawBust(ctx, c, 0, -44, 0.95, c.a * 0.9)

  const cur = c.lw
  if (cur >= 0) {
    const s = WORDS[cur]
    const wpx = s.length * 11 * 0.6
    if (c.wi >= 0) {
      ctx.globalAlpha = c.a * 0.9
      ctx.fillStyle = c.p.accent
      ctx.fillRect(-wpx / 2, 54, wpx, 1.6)
    }
    txt(ctx, c, s, 0, 42, 11, c.p.ink, c.a, 'center')
  }

  const py = 100
  ctx.globalAlpha = c.a * 0.28
  ctx.strokeStyle = c.p.inkFaint
  ctx.lineWidth = 1 * c.px
  seg(ctx, -64, py, 64, py)
  ctx.globalAlpha = c.a * 0.75
  ctx.strokeStyle = c.p.ink
  seg(ctx, -64, py, tx(c.pt), py)
  ctx.globalAlpha = c.a
  ctx.fillStyle = c.p.accent
  ctx.beginPath()
  ctx.arc(tx(c.pt), py, 3.4, 0, TWO_PI)
  ctx.fill()

  const sec = Math.floor(c.pt * CLIP)
  txt(ctx, c, `0:0${sec}`, -64, py + 16, 7.5, c.p.inkFaint, c.a * 0.6, 'left')
  txt(ctx, c, '0:07', 64, py + 16, 7.5, c.p.inkFaint, c.a * 0.6, 'right')

  ctx.globalAlpha = c.a * 0.3
  ctx.fillStyle = c.p.inkFaint
  for (let i = 0; i < 3; i++) {
    ctx.beginPath()
    ctx.arc(-22 + i * 22, 138, 2.4, 0, TWO_PI)
    ctx.fill()
  }
  c.ax = tx(c.pt)
  c.ay = py
  c.hasAnchor = true
}

/* ============================================================ */

function pointInQuad(q: Float64Array, o: number, x: number, y: number) {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const ax = q[o + i * 2]
    const ay = q[o + i * 2 + 1]
    const bx = q[o + ((i + 1) % 4) * 2]
    const by = q[o + ((i + 1) % 4) * 2 + 1]
    const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
    if (cross === 0) continue
    const s = cross > 0 ? 1 : -1
    if (sign === 0) sign = s
    else if (sign !== s) return false
  }
  return true
}

export function FocusMotion(props: ProjectVisualProps) {
  const { progress, reducedMotion = false, interactive = true, className } = props

  const [stage, setStage] = useState(N - 1)
  const stageRef = useRef(N - 1)

  /* ---- deterministic clip data, built once ---- */
  const data = useMemo(() => {
    const rnd = seeded(0x0f0c05)
    const n = WORDS.length
    const dur = new Float64Array(n)
    let total = 0
    for (let i = 0; i < n; i++) {
      const d = 0.32 + WORDS[i].length * 0.085 + rnd() * 0.14
      dur[i] = d
      total += d + 0.19
    }
    const segS = new Float64Array(n)
    const segE = new Float64Array(n)
    const k = 0.92 / total
    let cur = 0.045
    for (let i = 0; i < n; i++) {
      segS[i] = cur
      cur += dur[i] * k
      segE[i] = cur
      cur += 0.19 * k
    }

    const wave = new Float32Array(WAVE_N)
    for (let j = 0; j < WAVE_N; j++) {
      const u = (j + 0.5) / WAVE_N
      let a = 0.012 + rnd() * 0.022
      for (let i = 0; i < n; i++) {
        if (u >= segS[i] && u <= segE[i]) {
          const p = (u - segS[i]) / (segE[i] - segS[i] || 1e-6)
          a = Math.pow(Math.sin(Math.PI * p), 0.5) * (0.4 + 0.6 * rnd())
          break
        }
      }
      wave[j] = a
    }

    const pitch = new Float32Array(WAVE_N)
    let v = 0.5
    for (let j = 0; j < WAVE_N; j++) {
      v = clamp(v + (rnd() - 0.5) * 0.24, 0.16, 0.84)
      pitch[j] = v
    }

    const att = new Float32Array(27)
    const attTo = new Uint8Array(27)
    for (let j = 0; j < 9; j++) {
      for (let e = 0; e < 3; e++) {
        attTo[j * 3 + e] = Math.floor(rnd() * 9)
        att[j * 3 + e] = 0.25 + rnd() * 0.75
      }
    }

    const bars = new Float32Array(CONTENT_KEYS.length)
    for (let i = 0; i < bars.length; i++) bars[i] = 0.3 + rnd() * 0.62

    /* time window each script line is spoken over */
    const lineA = new Float64Array(SCRIPT_LINES.length)
    const lineB = new Float64Array(SCRIPT_LINES.length)
    lineA[0] = 0
    lineB[0] = segS[0]
    for (let l = 1; l < SCRIPT_LINES.length; l++) {
      let a = 1
      let b = 0
      for (let i = 0; i < n; i++) {
        if (WORD_LINE[i] !== l) continue
        if (segS[i] < a) a = segS[i]
        if (segE[i] > b) b = segE[i]
      }
      lineA[l] = b > a ? a : 0
      lineB[l] = b > a ? b : 1
    }

    return { segS, segE, wave, pitch, att, attTo, bars, lineA, lineB }
  }, [])

  /* ---- scratch buffers: allocated once, never inside draw ---- */
  const buf = useMemo(() => ({
    quads: new Float64Array(N * 8),
    cx: new Float64Array(N),
    cy: new Float64Array(N),
    scr: new Float64Array(N),
    alpha: new Float64Array(N),
    sep: new Float64Array(N),
    zs: new Float64Array(N),
    anchorX: new Float64Array(N),
    anchorY: new Float64Array(N),
    anchorOn: new Uint8Array(N),
  }), [])

  const cell = useMemo<Cell>(() => ({
    p: readPalette(null),
    a: 1, scr: 1, px: 1, pt: 0, amp: 0, wi: -1, lw: -1, wp: 0,
    segS: data.segS, segE: data.segE, wave: data.wave, pitch: data.pitch,
    att: data.att, attTo: data.attTo, bars: data.bars,
    ax: 0, ay: 0, hasAnchor: false,
  }), [data])

  const hoverRef = useRef(-1)
  const scrubRef = useRef(false)
  const playRef = useRef(0.18)
  const focusRef = useRef((N - 1) / 2)
  const strengthRef = useRef(0)
  const paletteRef = useRef<VisualPalette | null>(null)
  const frameRef = useRef(0)
  const cursorRef = useRef('')

  const render = useCallback((
    ctx: CanvasRenderingContext2D, w: number, h: number, t: number, dt: number,
  ) => {
    const c = cell
    const p = paletteRef.current
    if (!p) return
    c.p = p

    /* ---------- timeline ---------- */
    const tau = reducedMotion
      ? 0.5
      : progress !== undefined
        ? clamp(progress)
        : (t % LOOP) / LOOP

    if (reducedMotion) {
      playRef.current = 0.615
    } else if (!scrubRef.current) {
      playRef.current = (playRef.current + dt / CLIP) % 1
    }
    const pt = clamp(playRef.current, 0, 0.9999)

    const eIn = easeInOutCubic(range(tau, 0.08, 0.36))
    const eOut = easeInOutCubic(range(tau, 0.80, 0.99))
    const E = reducedMotion ? 1 : eIn * (1 - eOut)

    for (let i = 0; i < N; i++) {
      if (reducedMotion) { buf.sep[i] = 1; continue }
      const a = easeOutCubic(range(tau, 0.07 + i * 0.014, 0.33 + i * 0.014))
      const b = easeInOutCubic(range(tau, 0.79 + (N - 1 - i) * 0.008, 0.91 + (N - 1 - i) * 0.008))
      buf.sep[i] = a * (1 - b)
    }

    /* ---------- camera ---------- */
    const hover = interactive === false || reducedMotion ? -1 : hoverRef.current
    const travelU = range(tau, 0.34, 0.82)
    const swept = easeInOutCubic(travelU)
    const autoF = 4.5 - 4.5 * Math.sin(TWO_PI * swept)
    const targetF = hover >= 0 ? hover : autoF
    const targetS = hover >= 0 ? 1 : Math.pow(Math.sin(Math.PI * travelU), 0.7) * E

    if (reducedMotion) {
      focusRef.current = 7
      strengthRef.current = 0.45
    } else {
      focusRef.current = damp(focusRef.current, targetF, 7, dt)
      strengthRef.current = damp(strengthRef.current, targetS, 8, dt)
    }
    const f = focusRef.current
    const strength = strengthRef.current

    const si = E < 0.45 ? N - 1 : clamp(Math.round(f), 0, N - 1)
    if (si !== stageRef.current) { stageRef.current = si; setStage(si) }

    const drift = reducedMotion ? 0 : Math.sin(t * 0.21) * 0.028
    const yaw = (YAW + drift) * E
    const pit = PITCH * E
    const sinY = Math.sin(yaw)
    const cosY = Math.cos(yaw)
    const sinP = Math.sin(pit)
    const cosP = Math.cos(pit)

    const K = Math.min(w / DESIGN_W, h / DESIGN_H)
    const M = K * lerp(1.32, 1.0, E)
    const CX = w * 0.5 - 80 * K * E
    const CY = h * 0.5 + 62 * K * E

    /* ---------- depth layout ----------
       Everything stacked in front of the inspected sheet steps
       away from it, opening a window onto its face. Total depth
       is conserved and the stack is re-centred, so the diagram
       never walks out of frame while the window travels. */
    const gapEff = GAP - (PUSH / (N - 1)) * strength
    let zsum = 0
    for (let i = 0; i < N; i++) {
      const zi = ((i - (N - 1) / 2) * gapEff + PUSH * strength * clamp(i - f)) * buf.sep[i]
      buf.zs[i] = zi
      zsum += zi
    }
    const zmid = zsum / N

    /* ---------- pass 1: place every sheet in depth ---------- */
    for (let i = 0; i < N; i++) {
      const z = buf.zs[i] - zmid
      const X = z * sinY
      const Z1 = z * cosY
      const Y = -Z1 * sinP
      const Z2 = Z1 * cosP
      const s = FOCAL / Math.max(200, FOCAL - Z2)
      const scr = s * M
      buf.scr[i] = scr
      buf.cx[i] = CX + X * scr
      buf.cy[i] = CY + Y * scr

      const dim = clamp(1 - Math.abs(i - f) * 0.38, 0.14, 1)
      const present = i === N - 1 ? 1 : buf.sep[i]
      /* atmospheric perspective: sheets further back sit back */
      const depth = clamp(0.6 + (s - 0.7) * 1.2, 0.6, 1)
      buf.alpha[i] = present * depth * lerp(1, dim, strength)

      const ux = cosY * scr
      const uy = sinP * sinY * scr
      const vy = cosP * scr
      const o = i * 8
      buf.quads[o] = buf.cx[i] - HW * ux
      buf.quads[o + 1] = buf.cy[i] - HW * uy - HH * vy
      buf.quads[o + 2] = buf.cx[i] + HW * ux
      buf.quads[o + 3] = buf.cy[i] + HW * uy - HH * vy
      buf.quads[o + 4] = buf.cx[i] + HW * ux
      buf.quads[o + 5] = buf.cy[i] + HW * uy + HH * vy
      buf.quads[o + 6] = buf.cx[i] - HW * ux
      buf.quads[o + 7] = buf.cy[i] - HW * uy + HH * vy
    }

    /* ---------- clear ---------- */
    ctx.clearRect(0, 0, w, h)

    /* ---------- the pipeline spine, behind the sheets ---------- */
    if (E > 0.02) {
      ctx.globalAlpha = 0.22 * E
      ctx.strokeStyle = p.inkFaint
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let i = 0; i < N; i++) {
        if (i === 0) ctx.moveTo(buf.cx[i], buf.cy[i])
        else ctx.lineTo(buf.cx[i], buf.cy[i])
      }
      ctx.stroke()
    }

    /* ---------- shared clock, resolved once ---------- */
    let wi = -1
    let lw = -1
    for (let i = 0; i < WORDS.length; i++) {
      if (pt >= data.segS[i] && pt <= data.segE[i]) wi = i
      if (pt >= data.segS[i]) lw = i
    }
    c.pt = pt
    c.wi = wi
    c.lw = lw
    c.amp = sampleAt(data.wave, pt)
    const line = lw < 0 ? 0 : WORD_LINE[lw]
    c.wp = range(pt, data.lineA[line], data.lineB[line])

    /* ---------- pass 2: draw far to near ---------- */
    for (let i = 0; i < N; i++) {
      const A = buf.alpha[i]
      buf.anchorOn[i] = 0
      if (A < 0.02) continue
      const scr = buf.scr[i]
      const ux = cosY * scr
      const uy = sinP * sinY * scr
      const vy = cosP * scr

      ctx.save()
      ctx.transform(ux, uy, 0, vy, buf.cx[i], buf.cy[i])
      ctx.textBaseline = 'middle'
      ctx.lineJoin = 'round'

      c.a = A
      c.scr = scr
      c.px = 1 / scr
      c.hasAnchor = false

      const radius = i === N - 1 ? 18 : 5
      rrect(ctx, -HW, -HH, HW * 2, HH * 2, radius)
      ctx.globalAlpha = A * 0.82
      ctx.fillStyle = p.bg
      ctx.fill()
      /* emphasis rises continuously as the window reaches this sheet */
      const fw = strength * clamp(1 - Math.abs(i - f) / 0.8)
      ctx.globalAlpha = A * lerp(0.7, 0.42, E)
      ctx.strokeStyle = p.inkFaint
      ctx.lineWidth = 0.9 / scr
      ctx.stroke()
      if (fw > 0.02) {
        ctx.globalAlpha = A * fw * 0.85
        ctx.strokeStyle = p.ink
        ctx.lineWidth = 1.2 / scr
        ctx.stroke()
      }

      switch (i) {
        case 0: drawScript(ctx, c); break
        case 1: drawModel(ctx, c); break
        case 2: drawContent(ctx, c); break
        case 3: drawVoice(ctx, c); break
        case 4: drawAudio(ctx, c); break
        case 5: drawCharacters(ctx, c); break
        case 6: drawMotion(ctx, c); break
        case 7: drawCaptions(ctx, c); break
        case 8: drawRenderer(ctx, c); break
        default: drawApp(ctx, c); break
      }

      /* plate number, inside the exposed left edge of each sheet */
      const la = buf.sep[i] * A
      if (la > 0.03) {
        txt(ctx, c, PLATE[i], -HW + 10, -HH + 14, 8, p.inkFaint, la * 0.55, 'left')
        if (fw > 0.05) {
          txt(ctx, c, PLATE[i], -HW + 10, -HH + 14, 8, p.ink, la * fw, 'left')
          txt(ctx, c, LAYERS[i], -HW + 30, -HH + 14, 8, p.ink, la * fw, 'left')
        }
      }

      if (c.hasAnchor) {
        buf.anchorX[i] = buf.cx[i] + c.ax * ux
        buf.anchorY[i] = buf.cy[i] + c.ax * uy + c.ay * vy
        buf.anchorOn[i] = 1
      }
      ctx.restore()
    }

    /* ---------- the clock thread: one accent line through
         every layer that shares the timeline ---------- */
    const thread = range(E, 0.35, 0.8)
    if (thread > 0.02) {
      ctx.globalAlpha = 0.24 * thread
      ctx.strokeStyle = p.accent
      ctx.lineWidth = 0.75
      ctx.beginPath()
      let pen = false
      for (let i = 0; i < N; i++) {
        if (!buf.anchorOn[i] || buf.alpha[i] < 0.1) { pen = false; continue }
        if (!pen) { ctx.moveTo(buf.anchorX[i], buf.anchorY[i]); pen = true }
        else ctx.lineTo(buf.anchorX[i], buf.anchorY[i])
      }
      ctx.stroke()
      ctx.globalAlpha = 0.6 * thread
      ctx.fillStyle = p.accent
      for (let i = 0; i < N; i++) {
        if (!buf.anchorOn[i] || buf.alpha[i] < 0.1) continue
        ctx.beginPath()
        ctx.arc(buf.anchorX[i], buf.anchorY[i], 1.4, 0, TWO_PI)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
  }, [buf, cell, data, interactive, progress, reducedMotion])

  const ref = useCanvas2D<HTMLCanvasElement>({
    maxDpr: 2,
    setup: ({ ctx, w, h }) => {
      paletteRef.current = readPalette(ctx.canvas)
      render(ctx, w, h, 0, 0)
    },
    draw: ({ ctx, w, h, t, dt }) => {
      frameRef.current++
      const prev = paletteRef.current
      if (!prev || frameRef.current % 8 === 0) {
        paletteRef.current = readPalette(ctx.canvas)
      }
      /* Reduced motion: one static frame. Redraw only when the
         chapter theme actually changes underneath it. */
      const now = paletteRef.current
      if (reducedMotion && prev && now && frameRef.current > 3) {
        if (now.ink === prev.ink && now.bg === prev.bg && now.accent === prev.accent) return
      }
      render(ctx, w, h, t, dt)
    },
  })

  /* ---------- pointer: isolate a layer, scrub the phone ---------- */
  useEffect(() => {
    if (interactive === false || reducedMotion) return
    const canvas = ref.current
    if (!canvas) return
    const quads = buf.quads

    /** Front-most sheet under the cursor. Sheets still folded away
        are not pickable — only the phone is, while it is closed. */
    const pick = (x: number, y: number) => {
      for (let i = N - 1; i >= 0; i--) {
        if (i !== N - 1 && buf.alpha[i] < 0.3) continue
        if (pointInQuad(quads, i * 8, x, y)) return i
      }
      return -1
    }

    const setCursor = (v: string) => {
      if (cursorRef.current === v) return
      cursorRef.current = v
      canvas.style.cursor = v
    }

    const locate = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return null
      return { x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width }
    }

    const onMove = (e: PointerEvent) => {
      const q = locate(e)
      if (!q) return
      if (scrubRef.current) {
        playRef.current = clamp((q.x / q.w - 0.12) / 0.76, 0, 0.9999)
        return
      }
      const hit = pick(q.x, q.y)
      hoverRef.current = hit
      setCursor(hit === N - 1 ? 'ew-resize' : hit >= 0 ? 'pointer' : '')
    }

    const onDown = (e: PointerEvent) => {
      const q = locate(e)
      if (!q) return
      if (pick(q.x, q.y) !== N - 1) return
      scrubRef.current = true
      hoverRef.current = -1
      canvas.setPointerCapture(e.pointerId)
      playRef.current = clamp((q.x / q.w - 0.12) / 0.76, 0, 0.9999)
    }

    const onUp = (e: PointerEvent) => {
      if (!scrubRef.current) return
      scrubRef.current = false
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
    }

    const onLeave = () => {
      hoverRef.current = -1
      setCursor('')
    }

    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('pointerleave', onLeave)
    return () => {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.style.cursor = ''
      cursorRef.current = ''
      hoverRef.current = -1
      scrubRef.current = false
    }
  }, [buf, interactive, reducedMotion, ref])

  return (
    <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
      <canvas ref={ref} className={styles.canvas} />
      <div className={styles.readout}>
        <div>{`${String(stage + 1).padStart(2, '0')} / ${N}`}</div>
        <div>{LAYERS[stage]}</div>
      </div>
    </div>
  )
}
