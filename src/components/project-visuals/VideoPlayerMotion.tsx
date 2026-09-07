'use client'

/**
 * VideoPlayerMotion — the motion graphic for "Fullscreen Video Player".
 *
 * 441 bytes of JavaScript doing two unglamorous things, drawn rather than
 * described.
 *
 * First the autoplay handshake. The poster frame sits still; a play() promise
 * is issued and drawn as a ring sweeping around the play glyph. The browser
 * refuses it — the ring breaks and the glyph is struck through. Two flags latch
 * (muted, playsInline), the call is reissued, the ring closes and the picture
 * wakes.
 *
 * Then the loop. The source frame — colour bars drifting under a sweeping
 * scanline — stays exactly where it is while the viewport rectangle changes
 * aspect around it, so the cover fit crops into the frame from the sides or
 * from top and bottom depending on which way the box goes. Underneath, the
 * playhead runs the lane, reaches the end, snaps back to zero along the return
 * arc, and the picture resets with it. That reset is the loop attribute.
 *
 * Timeline (clock 0..1):
 *   0.00  poster frame — bars dim and still, play() pending on the ring
 *   0.33  playing; first loop mid-way, the viewport widening past 16:9 so the
 *         source is cropped top and bottom
 *   0.66  second loop; the viewport has gone tall, heavy crop left and right
 *   1.00  third loop closed, three passes ticked off, viewport at 1.25:1
 *
 * Reduced motion holds the third loop at 36%: portrait viewport, the cover crop
 * open on both sides, two passes already counted, both fallback flags latched.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useCanvas2D } from '@/hooks/useCanvas2D'
import { clamp, damp, easeInOutCubic, easeOutCubic, lerp, seeded } from '@/lib/math'
import type { Project } from '@/content/types'
import { readPalette, type ProjectVisualProps, type VisualPalette } from './types'
import styles from './visual.module.css'

/* ---------------------------------------------------------------- constants */

/** The source material is 16:9. Everything else crops into it. */
const SRC_AR = 16 / 9
const AR_MIN = 0.52
const AR_MAX = 2.6

/** Viewport aspect at each loop boundary — wide, then tall, then settled. */
const AR_KEYS = [SRC_AR, 2.25, 0.78, 1.25]
const LOOPS = 3

/** Beat lengths, in abstract units. */
const POSTER = 0.55
const CALL1 = 0.55
const LATCH = 0.5
const CALL2 = 0.35
const LOOP = 2.2

const T1 = POSTER
const T2 = T1 + CALL1
const T3 = T2 + LATCH
const T_PLAY = T3 + CALL2
const TOTAL = T_PLAY + LOOPS * LOOP

/** The frame reduced motion holds: third pass at 36%, portrait viewport. */
const STATIC_CLOCK = (T_PLAY + 2.36 * LOOP) / TOTAL

/** Where inside the first call the promise rejects. */
const REJECT_AT = 0.55

/** Pattern travel and scan sweeps per loop. Both non-integer, so the restart
 *  at phase 1 → 0 is a visible cut rather than a seamless join. */
const DRIFT = 2.35
const SCAN_CYCLES = 2.7

/** Luminance staircase — a test pattern built from ink alpha, never a
 *  hardcoded grey. One band carries the signal hue as the colour burst. */
const BAR_A = [0.92, 0.7, 0.52, 0.38, 0.27, 0.18, 0.11, 0.06]
const BURST = 3
/** Static pedestal strip along the bottom of the source frame. It is the first
 *  thing a wide viewport crops away, which is rather the point of it. */
const PED_A = [0.3, 0.12, 0.22, 0.07, 0.17]

/** Per-band flicker phase — deterministic, so SSR and client agree. */
const BAR_J = new Float32Array(BAR_A.length)
{
  const rnd = seeded(0x5ed17a)
  for (let i = 0; i < BAR_J.length; i += 1) BAR_J[i] = rnd()
}

/** Module-scope dash patterns — setLineDash takes an array, so never build
 *  one per frame. */
const DASH: number[] = [2, 3]
const DASH_L: number[] = [4, 4]
const NODASH: number[] = []

const TAU = Math.PI * 2

/** Named aspect detents on the top scale; the major ones double as presets. */
const RATIOS: { ar: number; label: string; major: boolean }[] = [
  { ar: 9 / 16, label: '9:16', major: true },
  { ar: 3 / 4, label: '3:4', major: false },
  { ar: 1, label: '1:1', major: true },
  { ar: 4 / 3, label: '4:3', major: false },
  { ar: 16 / 9, label: '16:9', major: true },
  { ar: 21 / 9, label: '21:9', major: false },
]
const PRESETS = RATIOS.filter((r) => r.major)

const LOG_MIN = Math.log(AR_MIN)
const LOG_SPAN = Math.log(AR_MAX) - LOG_MIN

const arToU = (ar: number) => clamp((Math.log(ar) - LOG_MIN) / LOG_SPAN)

function ratioLabel(ar: number): string {
  for (let i = 0; i < RATIOS.length; i += 1) {
    if (Math.abs(Math.log(ar / RATIOS[i].ar)) < 0.018) return RATIOS[i].label
  }
  return `${ar.toFixed(2)}:1`
}

/* ------------------------------------------------------------------ layout */

interface Layout {
  w: number
  h: number
  chrome: boolean
  detail: boolean
  /** Aspect scale. */
  scaleY: number
  x0: number
  x1: number
  /** Stage the source frame lives in. */
  cx: number
  cy: number
  stageW: number
  stageH: number
  /** Transport lane. */
  laneY: number
  nano: number
  fontNano: string
}

function computeLayout(w: number, h: number, chrome: boolean): Layout {
  const padX = clamp(w * 0.06, 12, 44)
  const padTop = clamp(h * 0.08, 10, 24)
  const padBot = clamp(h * 0.07, 10, 20) + (chrome ? 42 : 0)
  const nano = clamp(Math.round(Math.min(w, h) * 0.026), 7, 9)

  const scaleY = padTop
  const laneY = Math.max(scaleY + 60, h - padBot)
  const stageY0 = scaleY + clamp(h * 0.11, 16, 40)
  const stageY1 = laneY - clamp(h * 0.12, 18, 42)

  return {
    w,
    h,
    chrome,
    detail: w >= 310 && h >= 225,
    scaleY,
    x0: padX,
    x1: w - padX,
    cx: w * 0.5,
    cy: (stageY0 + stageY1) * 0.5,
    stageW: Math.max(40, w - padX * 2),
    stageH: Math.max(30, stageY1 - stageY0),
    laneY,
    nano,
    fontNano: `${nano}px ui-monospace, monospace`,
  }
}

/* --------------------------------------------------------------- utilities */

function metricValue(project: Project | undefined, label: string, fallback: number): number {
  const found = project?.metrics.find((m) => m.label === label)
  return typeof found?.numeric === 'number' ? found.numeric : fallback
}

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

function pen(ctx: CanvasRenderingContext2D, colour: string, alpha: number, width = 0.75): void {
  ctx.strokeStyle = colour
  ctx.globalAlpha = alpha
  ctx.lineWidth = width
}

function line(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number): void {
  ctx.beginPath()
  ctx.moveTo(ax, ay)
  ctx.lineTo(bx, by)
  ctx.stroke()
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath()
  ctx.arc(x, y, Math.max(0.4, r), 0, TAU)
  ctx.fill()
}

function caption(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  colour: string,
  alpha: number,
): void {
  ctx.globalAlpha = alpha
  ctx.fillStyle = colour
  ctx.fillText(s, x, y)
}

/** The scripted viewport aspect when nobody is dragging it. */
function scriptedAspect(playing: boolean, loopIdx: number, phase: number): number {
  if (!playing) return AR_KEYS[0]
  const i = Math.min(loopIdx, AR_KEYS.length - 2)
  return lerp(AR_KEYS[i], AR_KEYS[i + 1], easeInOutCubic(phase))
}

/**
 * The source frame: a drifting luminance staircase over a static pedestal
 * strip. Drawn twice per frame — once ghosted across the whole source rect,
 * once at full strength clipped to the viewport. The difference between the
 * two IS the cover crop.
 */
function drawBars(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  off: number,
  alpha: number,
  ink: string,
  signal: string,
  wobble: number,
): void {
  const n = BAR_A.length
  const bw = w / n
  const barH = h * 0.86
  const shift = ((off % 1) + 1) % 1
  for (let i = 0; i < n; i += 1) {
    const flick = 1 + 0.06 * Math.sin((wobble * 1.7 + BAR_J[i]) * TAU)
    const bx = x + (((i * bw + shift * w) % w) + w) % w
    ctx.globalAlpha = clamp(alpha * BAR_A[i] * flick)
    ctx.fillStyle = i === BURST ? signal : ink
    ctx.fillRect(bx, y, bw + 0.7, barH)
    if (bx + bw > x + w) ctx.fillRect(bx - w, y, bw + 0.7, barH)
  }
  ctx.fillStyle = ink
  for (let k = 0; k < PED_A.length; k += 1) {
    ctx.globalAlpha = clamp(alpha * PED_A[k])
    ctx.fillRect(x + (k * w) / PED_A.length, y + barH, w / PED_A.length + 0.7, h - barH)
  }
}

/* ----------------------------------------------------------- the component */

export function VideoPlayerMotion(props: ProjectVisualProps) {
  const { project, progress, reducedMotion = false, interactive = true, className } = props
  const chrome = interactive !== false

  const bytes = metricValue(project, 'JavaScript', 441)
  const period = useMemo(() => clamp(project?.presentation.duration ?? 12, 7, 22), [project])

  const [shownLoop, setShownLoop] = useState(0)
  const [shownState, setShownState] = useState('IDLE')
  const [preset, setPreset] = useState<number | null>(null)

  const layoutRef = useRef<Layout | null>(null)
  const paletteRef = useRef<VisualPalette | null>(null)
  const paletteAtRef = useRef(-1)
  const clockRef = useRef(reducedMotion ? STATIC_CLOCK : 0)
  const firstRef = useRef(true)
  const dirtyRef = useRef(true)

  const aspectRef = useRef(SRC_AR)
  const aspectUserRef = useRef<number | null>(null)
  const presetRef = useRef<number | null>(null)

  /** 0 = idle, 1 = dragging the aspect, 2 = scrubbing the lane. */
  const dragRef = useRef<0 | 1 | 2>(0)
  const dragX0Ref = useRef(0)
  const dragAr0Ref = useRef(SRC_AR)
  const hoverRef = useRef(false)

  const loopRef = useRef(-1)
  const stateRef = useRef('')

  const ref = useCanvas2D<HTMLCanvasElement>({
    setup: ({ ctx, w, h }) => {
      layoutRef.current = computeLayout(w, h, chrome)
      paletteRef.current = readPalette(ctx.canvas)
      paletteAtRef.current = -1
      firstRef.current = true
      dirtyRef.current = true
    },

    draw: ({ ctx, w, h, t, dt }) => {
      let layout = layoutRef.current
      if (!layout || layout.w !== w || layout.h !== h || layout.chrome !== chrome) {
        layout = computeLayout(w, h, chrome)
        layoutRef.current = layout
        firstRef.current = true
        dirtyRef.current = true
      }

      // getComputedStyle is not free — poll the palette rather than read it
      // every frame. A theme swap only needs to land within half a second.
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
      const { ink, inkSoft, inkFaint, bg, accent, signal } = palette

      /* ---- master clock -------------------------------------------------- */

      let clock: number
      if (dragRef.current === 2) {
        clock = clockRef.current // scrubbing: the pointer owns the clock
      } else if (reducedMotion) {
        clock = STATIC_CLOCK
        clockRef.current = clock
      } else if (typeof progress === 'number') {
        const target = clamp(progress) * 0.99999
        clock = firstRef.current ? target : damp(clockRef.current, target, 10, dt)
        clockRef.current = clock
      } else {
        clock = (clockRef.current + dt / period) % 1
        clockRef.current = clock
      }

      if (reducedMotion && !dirtyRef.current) return

      /* ---- where are we -------------------------------------------------- */

      const beats = clock * TOTAL
      const playing = beats >= T_PLAY
      const loopT = Math.max(0, (beats - T_PLAY) / LOOP)
      const loopIdx = Math.min(LOOPS - 1, Math.floor(loopT))
      const phase = clamp(loopT - loopIdx)

      const posterP = clamp(beats / POSTER)
      const call1P = clamp((beats - T1) / CALL1)
      const latchP = clamp((beats - T2) / LATCH)
      const call2P = clamp((beats - T3) / CALL2)

      const rejected = call1P > REJECT_AT
      const broke = clamp((call1P - REJECT_AT) / (1 - REJECT_AT))
      const wake = easeOutCubic(call2P)
      const mutedOn = clamp((latchP - 0.12) / 0.22)
      const inlineOn = clamp((latchP - 0.48) / 0.22)

      /** The picture restarts with the playhead — drift and scan reset at wrap. */
      const drift = playing ? phase * DRIFT : 0
      const scan = playing ? (phase * SCAN_CYCLES) % 1 : 0.5
      const wrapFlash = playing && loopIdx > 0 ? 1 - clamp(phase / 0.1) : 0
      const endGlow = playing ? clamp((phase - 0.8) / 0.2) : 0

      /* ---- viewport aspect, damped so a drag has weight ------------------- */

      const arTarget = clamp(
        aspectUserRef.current ?? scriptedAspect(playing, loopIdx, phase),
        AR_MIN,
        AR_MAX,
      )
      const ar =
        reducedMotion || firstRef.current ? arTarget : damp(aspectRef.current, arTarget, 9, dt)
      aspectRef.current = ar

      /* ---- geometry ------------------------------------------------------- */

      const gw = Math.min(layout.stageW * 0.94, layout.stageH * 0.94 * SRC_AR)
      const gh = gw / SRC_AR
      const gx0 = layout.cx - gw * 0.5
      const gy0 = layout.cy - gh * 0.5
      const gx1 = gx0 + gw
      const gy1 = gy0 + gh

      // object-fit: cover — the source is held constant and the viewport crops
      // into it, from the sides or from top and bottom.
      const vw = ar >= SRC_AR ? gw : gh * ar
      const vh = ar >= SRC_AR ? gw / ar : gh
      const vx0 = layout.cx - vw * 0.5
      const vy0 = layout.cy - vh * 0.5
      const vx1 = vx0 + vw
      const vy1 = vy0 + vh
      const crop = clamp(1 - (vw * vh) / (gw * gh))

      /* ---- frame ---------------------------------------------------------- */

      ctx.clearRect(0, 0, w, h)
      ctx.lineJoin = 'round'
      ctx.lineCap = 'butt'
      ctx.setLineDash(NODASH)
      ctx.font = layout.fontNano

      /* ---- aspect scale --------------------------------------------------- */

      const dragAr = dragRef.current === 1
      const span = layout.x1 - layout.x0
      pen(ctx, inkFaint, 0.22)
      line(ctx, layout.x0, layout.scaleY, layout.x1, layout.scaleY)

      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      for (let i = 0; i < RATIOS.length; i += 1) {
        const rx = layout.x0 + arToU(RATIOS[i].ar) * span
        const big = RATIOS[i].major
        pen(ctx, inkFaint, big ? 0.38 : 0.24)
        line(ctx, rx, layout.scaleY - (big ? 3.5 : 2), rx, layout.scaleY + (big ? 3.5 : 2))
        if (layout.detail && big) caption(ctx, RATIOS[i].label, rx, layout.scaleY + 6, inkFaint, 0.3)
      }

      const mx = layout.x0 + arToU(ar) * span
      ctx.globalAlpha = dragAr ? 1 : 0.75
      ctx.fillStyle = dragAr ? accent : inkSoft
      ctx.beginPath()
      ctx.moveTo(mx, layout.scaleY - 1.5)
      ctx.lineTo(mx - 3.4, layout.scaleY - 7)
      ctx.lineTo(mx + 3.4, layout.scaleY - 7)
      ctx.closePath()
      ctx.fill()
      if (layout.detail) {
        ctx.textBaseline = 'bottom'
        caption(ctx, ratioLabel(ar), mx, layout.scaleY - 9, dragAr ? accent : inkSoft, dragAr ? 0.95 : 0.6)
      }
      if (dragAr) {
        // Tie the control to the thing it controls.
        pen(ctx, accent, 0.18)
        ctx.setLineDash(DASH)
        line(ctx, mx, layout.scaleY + 6, mx, vy0 - 4)
        ctx.setLineDash(NODASH)
      }

      /* ---- the source frame, ghosted -------------------------------------- */

      const barAlpha = lerp(0.16, 1, wake)

      ctx.save()
      ctx.beginPath()
      ctx.rect(gx0, gy0, gw, gh)
      ctx.clip()
      drawBars(ctx, gx0, gy0, gw, gh, drift, barAlpha * 0.13, ink, signal, beats)
      ctx.restore()

      pen(ctx, inkFaint, 0.45)
      ctx.setLineDash(DASH)
      ctx.strokeRect(gx0, gy0, gw, gh)
      ctx.setLineDash(NODASH)

      /* ---- the viewport: the same frame, uncropped ------------------------ */

      ctx.save()
      ctx.beginPath()
      ctx.rect(vx0, vy0, vw, vh)
      ctx.clip()

      drawBars(ctx, gx0, gy0, gw, gh, drift, barAlpha, ink, signal, beats)

      // Scanline: a bright line with a short trail. Flat rects, no gradient
      // objects allocated per frame.
      if (wake > 0.02) {
        const sy = gy0 + scan * gh
        ctx.fillStyle = ink
        ctx.globalAlpha = 0.05 * wake
        ctx.fillRect(gx0, sy - gh * 0.14, gw, gh * 0.14)
        ctx.globalAlpha = 0.1 * wake
        ctx.fillRect(gx0, sy - 8, gw, 8)
        ctx.globalAlpha = 0.42 * wake
        ctx.fillRect(gx0, sy - 1.1, gw, 1.1)
        ctx.globalAlpha = 0.14 * wake
        ctx.fillRect(gx0, sy, gw, 2.4)
      }

      /* ---- the autoplay handshake, played out on the poster --------------- */

      if (!playing) {
        const s = Math.min(vw, vh) * 0.13
        const r = s * 1.95
        const fade = 1 - easeOutCubic(clamp((call2P - 0.3) / 0.7))
        const shake = rejected ? Math.sin(broke * 34) * (1 - broke) * 1.6 : 0

        // First call: the promise ring sweeps, then breaks.
        if (beats >= T1) {
          const sweep = easeOutCubic(clamp(call1P / REJECT_AT)) * TAU * 0.78
          pen(ctx, rejected ? accent : inkSoft, fade * (0.85 - broke * 0.5), 1.1)
          if (rejected) ctx.setLineDash(DASH)
          ctx.beginPath()
          ctx.arc(
            layout.cx + shake,
            layout.cy,
            r * (1 - broke * 0.12),
            -Math.PI * 0.5,
            -Math.PI * 0.5 + sweep,
          )
          ctx.stroke()
          ctx.setLineDash(NODASH)
        }

        // Retry: the ring closes, in the signal colour.
        if (beats >= T3) {
          pen(ctx, signal, fade * 0.9, 1.25)
          ctx.beginPath()
          ctx.arc(
            layout.cx,
            layout.cy,
            r,
            -Math.PI * 0.5,
            -Math.PI * 0.5 + easeOutCubic(call2P) * TAU,
          )
          ctx.stroke()
        }

        // The play glyph itself.
        const breathe = beats < T1 ? 0.035 * Math.sin(posterP * TAU * 1.5) : 0
        const gs = s * (1 + breathe) * (1 + call2P * 0.35)
        const glyphCol = beats >= T3 ? signal : rejected ? accent : inkSoft
        pen(ctx, glyphCol, fade * 0.9, 1.25)
        ctx.beginPath()
        ctx.moveTo(layout.cx + shake - gs * 0.52, layout.cy - gs * 0.82)
        ctx.lineTo(layout.cx + shake + gs * 0.86, layout.cy)
        ctx.lineTo(layout.cx + shake - gs * 0.52, layout.cy + gs * 0.82)
        ctx.closePath()
        ctx.stroke()

        // Struck through: NotAllowedError.
        if (rejected && beats < T3) {
          pen(ctx, accent, fade * 0.95, 1.25)
          const sweep = gs * 2.2 * easeOutCubic(clamp(broke / 0.4))
          line(ctx, layout.cx - gs * 1.15, layout.cy, layout.cx - gs * 1.15 + sweep, layout.cy)
        }

        if (layout.detail && vh > 92) {
          const msg =
            beats < T1
              ? 'AUTOPLAY'
              : beats < T2
                ? rejected
                  ? 'NOTALLOWED'
                  : 'PLAY()'
                : beats < T3
                  ? 'MUTED · PLAYSINLINE'
                  : 'PLAY() OK'
          // The fix reads as signal even while the glyph is still struck out.
          const msgCol = beats >= T2 ? signal : rejected ? accent : inkFaint
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          caption(ctx, msg, layout.cx, layout.cy + r + 7, msgCol, fade * 0.55)
        }
      }

      ctx.restore()

      /* ---- viewport edge and the crop it opens ---------------------------- */

      pen(ctx, ink, 0.8, 1.1)
      ctx.strokeRect(vx0, vy0, vw, vh)

      const sideCrop = ar < SRC_AR
      const band = sideCrop ? vx0 - gx0 : vy0 - gy0
      if (band > 2) {
        pen(ctx, inkFaint, 0.3)
        ctx.setLineDash(DASH_L)
        ctx.beginPath()
        if (sideCrop) {
          ctx.moveTo(vx0, gy0)
          ctx.lineTo(vx0, gy1)
          ctx.moveTo(vx1, gy0)
          ctx.lineTo(vx1, gy1)
        } else {
          ctx.moveTo(gx0, vy0)
          ctx.lineTo(gx1, vy0)
          ctx.moveTo(gx0, vy1)
          ctx.lineTo(gx1, vy1)
        }
        ctx.stroke()
        ctx.setLineDash(NODASH)

        // One measure only — the mirrored band is implied.
        if (layout.detail && band > 16) {
          pen(ctx, inkSoft, 0.5)
          ctx.beginPath()
          if (sideCrop) {
            const my = layout.cy + gh * 0.33
            ctx.moveTo(gx0 + 1, my)
            ctx.lineTo(vx0 - 1, my)
            ctx.moveTo(gx0 + 1, my - 3)
            ctx.lineTo(gx0 + 1, my + 3)
            ctx.moveTo(vx0 - 1, my - 3)
            ctx.lineTo(vx0 - 1, my + 3)
          } else {
            const mxx = layout.cx + gw * 0.33
            ctx.moveTo(mxx, gy0 + 1)
            ctx.lineTo(mxx, vy0 - 1)
            ctx.moveTo(mxx - 3, gy0 + 1)
            ctx.lineTo(mxx + 3, gy0 + 1)
            ctx.moveTo(mxx - 3, vy0 - 1)
            ctx.lineTo(mxx + 3, vy0 - 1)
          }
          ctx.stroke()
        }
      }

      /* ---- resize handle --------------------------------------------------- */

      if (chrome) {
        const hot = dragAr || hoverRef.current
        pen(ctx, dragAr ? accent : inkSoft, dragAr ? 1 : hot ? 0.8 : 0.5, 1.25)
        ctx.beginPath()
        ctx.moveTo(vx1 - 9, vy1)
        ctx.lineTo(vx1, vy1)
        ctx.lineTo(vx1, vy1 - 9)
        ctx.stroke()
        pen(ctx, dragAr ? accent : inkSoft, dragAr ? 0.9 : 0.4)
        line(ctx, vx1 - 4.5, vy1 - 1.5, vx1 - 1.5, vy1 - 4.5)
      }

      /* ---- fallback flags + crop readout, under the source frame ---------- */

      if (layout.detail) {
        const fy = gy1 + 9
        const box = 4.5
        const step = 8 + 5 * layout.nano * 0.62 + 12
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
        for (let i = 0; i < 2; i += 1) {
          const on = i === 0 ? mutedOn : inlineOn
          const fx = gx0 + i * step
          pen(ctx, on > 0.5 ? signal : inkFaint, 0.28 + on * 0.5)
          ctx.strokeRect(fx, fy + 1, box, box)
          if (on > 0.02) {
            ctx.globalAlpha = on * 0.85
            ctx.fillStyle = signal
            ctx.fillRect(fx + 1, fy + 2, (box - 2) * on, box - 2)
          }
          const col = on > 0.5 ? signal : inkFaint
          caption(ctx, i === 0 ? 'MUTED' : 'INLINE', fx + box + 4, fy, col, 0.3 + on * 0.4)
        }

        ctx.textAlign = 'right'
        const cropText = `COVER · CROP ${Math.round(crop * 100)}%`
        caption(ctx, cropText, gx1, fy, inkFaint, crop > 0.01 ? 0.55 : 0.3)
      }

      /* ---- transport lane -------------------------------------------------- */

      const ly = layout.laneY
      const lspan = layout.x1 - layout.x0

      if (layout.detail) {
        pen(ctx, inkFaint, 0.1)
        ctx.beginPath()
        for (let k = 1; k < 24; k += 1) {
          const fx = layout.x0 + (k / 24) * lspan
          ctx.moveTo(fx, ly - 2.5)
          ctx.lineTo(fx, ly + 2.5)
        }
        ctx.stroke()
      }

      pen(ctx, inkFaint, 0.35)
      line(ctx, layout.x0, ly, layout.x1, ly)
      // The end of the media, where the playhead is sent back from.
      pen(ctx, inkFaint, 0.4)
      line(ctx, layout.x1, ly - 5, layout.x1, ly + 5)

      // The return arc: the loop attribute, drawn.
      const glow = Math.max(wrapFlash, endGlow * 0.85, reducedMotion ? 0.45 : 0)
      pen(ctx, glow > 0.3 ? accent : inkFaint, 0.18 + glow * 0.72, glow > 0.3 ? 1.1 : 0.75)
      ctx.setLineDash(DASH)
      ctx.beginPath()
      ctx.moveTo(layout.x1, ly + 2)
      ctx.quadraticCurveTo(layout.cx, ly + 22, layout.x0, ly + 2)
      ctx.stroke()
      ctx.setLineDash(NODASH)
      ctx.beginPath()
      ctx.moveTo(layout.x0 + 4.5, ly + 6.5)
      ctx.lineTo(layout.x0 + 0.5, ly + 1.5)
      ctx.lineTo(layout.x0 + 1.5, ly + 7.5)
      ctx.stroke()

      // Elapsed, then the playhead.
      const px = layout.x0 + (playing ? phase : 0) * lspan
      pen(ctx, accent, 0.9, 1.25)
      line(ctx, layout.x0, ly, Math.max(layout.x0 + 0.5, px), ly)
      pen(ctx, accent, playing ? 1 : 0.45, 1.25)
      line(ctx, px, ly - 6.5, px, ly + 6.5)
      ctx.fillStyle = accent
      ctx.globalAlpha = playing ? 1 : 0.5
      dot(ctx, px, ly, 2.1 + wrapFlash * 1.6)

      // One tick per completed pass.
      const done = playing ? Math.min(LOOPS, loopIdx + (phase > 0.99 ? 1 : 0)) : 0
      for (let k = 0; k < LOOPS; k += 1) {
        ctx.globalAlpha = k < done ? 0.85 : 0.2
        ctx.fillStyle = k < done ? accent : inkFaint
        ctx.fillRect(layout.x0 + k * 5, ly - 13, 2, 5)
      }

      if (layout.detail) {
        ctx.textAlign = 'right'
        ctx.textBaseline = 'bottom'
        caption(ctx, 'LOOP', layout.x1, ly - 8, inkFaint, 0.4)
      }

      // Keep the byte count on canvas when the DOM chips are suppressed.
      if (layout.detail && !chrome) {
        ctx.globalAlpha = 0.75
        ctx.fillStyle = bg
        ctx.fillRect(layout.x1 - 52, layout.scaleY - 17, 52, 12)
        ctx.textAlign = 'right'
        ctx.textBaseline = 'top'
        caption(ctx, `${bytes} B JS`, layout.x1, layout.scaleY - 16, inkFaint, 0.5)
      }

      ctx.globalAlpha = 1

      /* ---- readout --------------------------------------------------------- */

      const count = playing ? loopIdx + 1 : 0
      if (loopRef.current !== count) {
        loopRef.current = count
        setShownLoop(count)
      }
      const word = playing
        ? 'LOOPING'
        : beats < T1
          ? 'IDLE'
          : beats < T2
            ? rejected
              ? 'BLOCKED'
              : 'PENDING'
            : beats < T3
              ? 'RETRY'
              : 'PLAYING'
      if (stateRef.current !== word) {
        stateRef.current = word
        setShownState(word)
      }

      firstRef.current = false
      dirtyRef.current = false
    },
  })

  /* ---- aspect presets ------------------------------------------------------ */

  const setAspect = useMemo(
    () => (v: number | null) => {
      aspectUserRef.current = v
      presetRef.current = v
      setPreset(v)
      dirtyRef.current = true
    },
    [],
  )

  /* ---- interaction: drag the aspect, scrub the lane ------------------------ */

  useEffect(() => {
    if (!chrome) return
    const canvas = ref.current
    if (!canvas) return

    const onLane = (y: number): boolean => {
      const l = layoutRef.current
      return l !== null && y > l.laneY - 13 && y < l.laneY + 20
    }

    const seek = (x: number) => {
      const l = layoutRef.current
      if (!l) return
      const u = clamp((x - l.x0) / Math.max(1, l.x1 - l.x0))
      const at = clockRef.current * TOTAL
      const cur = at < T_PLAY ? 0 : Math.min(LOOPS - 1, Math.floor((at - T_PLAY) / LOOP))
      clockRef.current = clamp((T_PLAY + (cur + u) * LOOP) / TOTAL, 0, 0.99999)
      dirtyRef.current = true
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      canvas.setPointerCapture(e.pointerId)
      if (onLane(e.clientY - rect.top)) {
        dragRef.current = 2
        seek(x)
      } else {
        dragRef.current = 1
        dragX0Ref.current = x
        dragAr0Ref.current = aspectUserRef.current ?? aspectRef.current
      }
      dirtyRef.current = true
    }

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top

      if (dragRef.current === 2) {
        seek(x)
        return
      }
      if (dragRef.current === 1) {
        // Relative, log-scaled: the drag resizes from where it started rather
        // than jumping the box to the cursor.
        const travel = Math.max(80, rect.width * 0.62)
        const u = (x - dragX0Ref.current) / travel
        aspectUserRef.current = clamp(
          Math.exp(Math.log(dragAr0Ref.current) + u * LOG_SPAN),
          AR_MIN,
          AR_MAX,
        )
        if (presetRef.current !== null) {
          presetRef.current = null
          setPreset(null)
        }
        dirtyRef.current = true
        return
      }

      hoverRef.current = true
      const next = onLane(y) ? 'pointer' : 'ew-resize'
      if (canvas.style.cursor !== next) canvas.style.cursor = next
      dirtyRef.current = true
    }

    const onUp = (e: PointerEvent) => {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
      dragRef.current = 0
      dirtyRef.current = true
    }

    const onEnter = () => {
      hoverRef.current = true
      dirtyRef.current = true
    }
    const onLeave = () => {
      hoverRef.current = false
      dirtyRef.current = true
    }

    canvas.style.cursor = 'ew-resize'
    canvas.style.touchAction = 'pan-y'
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('pointerenter', onEnter)
    canvas.addEventListener('pointerleave', onLeave)

    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('pointerenter', onEnter)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.style.cursor = 'default'
      canvas.style.touchAction = ''
    }
  }, [ref, chrome])

  return (
    <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
      <canvas ref={ref} className={styles.canvas} />
      {chrome && (
        <div className={styles.readout} aria-hidden="true">
          {shownState}
          {shownLoop > 0 ? ` · LOOP ×${shownLoop}` : ''}
        </div>
      )}
      {chrome && (
        <div className={styles.hud}>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className={styles.chip}
              style={{ cursor: 'pointer' }}
              data-on={preset === p.ar}
              onClick={() => setAspect(p.ar)}
              aria-label={`Set the viewport aspect to ${p.label}`}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            className={styles.chip}
            style={{ cursor: 'pointer' }}
            onClick={() => setAspect(null)}
            aria-label="Release the viewport aspect"
          >
            AUTO
          </button>
          <span className={styles.chip}>{bytes} B JS</span>
          <span className={styles.chip}>NO DEPS</span>
        </div>
      )}
    </div>
  )
}
