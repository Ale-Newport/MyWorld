import { TOKENS } from './palette'
import { hashSeed, mulberry32 } from './geometry'

/* ============================================================
   PAINTING A SIGN'S FACE

   Everything written on a sign goes through here: Geist for the
   lettering (the site's own face, read from the CSS variables the
   parent page mirrors into the iframe), ink on parchment or cream
   on dark timber, and a `fitText` that wraps, shrinks and then
   ellipsizes — it never squeezes glyphs horizontally and never
   drops a line without saying so.

   Painters are plain functions of a 2D context and a rectangle,
   seeded by a string so a repaint draws the same grain, which is
   what lets a face be repainted on a content change only.
   ============================================================ */

export interface Rect { x: number; y: number; w: number; h: number }

/* ------------------------------------------------------------------ fonts -- */

export interface SignFonts { sans: string; mono: string }

const FALLBACK_SANS = '"Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif'
const FALLBACK_MONO = '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

let fontCache: { at: number; value: SignFonts } | null = null
let fontListeners: Set<() => void> | null = null
let fontsLoaded = false

const readVariable = (name: string): string => {
  try { return getComputedStyle(document.body).getPropertyValue(name).trim() } catch { return '' }
}

/**
 * The site's faces as canvas `font-family` lists. The parent page exposes `--font-geist-sans` /
 * `--font-geist-mono` on the iframe's body; standalone (QA, the studio) the fallbacks apply.
 */
export function signFonts(): SignFonts {
  const now = typeof performance !== 'undefined' ? performance.now() : 0
  if (fontCache && now - fontCache.at < 2000) return fontCache.value
  const sans = readVariable('--font-geist-sans')
  const mono = readVariable('--font-geist-mono')
  const value = { sans: sans ? `${sans}, ${FALLBACK_SANS}` : FALLBACK_SANS, mono: mono ? `${mono}, ${FALLBACK_MONO}` : FALLBACK_MONO }
  fontCache = { at: now, value }
  return value
}

const WEIGHTS = ['500 28px', '600 28px', '700 48px', '800 48px']

/** Asks the browser to load the weights the kit paints with. Resolves when they are usable (or failed). */
export function loadSignFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve()
  const { sans, mono } = signFonts()
  const jobs = [...WEIGHTS.map(w => `${w} ${sans}`), `600 28px ${mono}`].map(font => document.fonts.load(font).catch(() => []))
  return Promise.all(jobs).then(() => { fontsLoaded = true })
}

/**
 * Calls `listener` whenever web fonts finish loading, so faces painted with a fallback repaint once with Geist.
 * Returns the unsubscribe function. One document listener serves every subscriber.
 */
export function onSignFontsLoaded(listener: () => void): () => void {
  if (typeof document === 'undefined' || !document.fonts) return () => {}
  if (!fontListeners) {
    const set = fontListeners = new Set<() => void>()
    const notify = () => { fontCache = null; clearFitCache(); for (const l of [...set]) l() }
    document.fonts.addEventListener?.('loadingdone', notify)
    void loadSignFonts().then(notify)
  }
  fontListeners.add(listener)
  return () => { fontListeners?.delete(listener) }
}

export const signFontsLoaded = (): boolean => fontsLoaded

/* ------------------------------------------------------------------ text -- */

/** The slice of CanvasRenderingContext2D that fitText needs, so it can be tested without a canvas. */
export interface Measurer { font: string; measureText(text: string): { width: number } }

export interface FitOptions {
  maxWidth: number
  maxLines?: number
  /** Budget for the whole block; a candidate size must fit lines x px x lineHeight inside it. */
  maxHeight?: number
  minPx: number
  maxPx: number
  weight?: number | string
  family: string
  lineHeight?: number
  step?: number
  ellipsis?: string
}

export interface FitResult {
  lines: string[]
  px: number
  lineHeight: number
  font: string
  /** Height of the block: lines x px x lineHeight. */
  height: number
  /** True when text had to be cut and the last line ends in an ellipsis. */
  truncated: boolean
}

const fontFor = (weight: number | string, px: number, family: string): string => `${weight} ${px}px ${family}`

/**
 * Greedy word wrap. `broke` is set when a single word was wider than the line and had to be cut by characters.
 * With `limit` it gives up the moment the text needs more than `limit` lines or a word has to be cut (`over`): a size that
 * cannot be chosen anyway is not worth wrapping to the end, and `lines` is then incomplete.
 */
function wrapWords(ctx: Measurer, text: string, maxWidth: number, limit = Infinity): { lines: string[]; broke: boolean; over: boolean } {
  const lines: string[] = []
  let line = ''
  let broke = false
  const push = () => { if (line) { lines.push(line); line = '' } }
  for (const word of text.split(' ')) {
    const candidate = line ? `${line} ${word}` : word
    if (ctx.measureText(candidate).width <= maxWidth) { line = candidate; continue }
    push()
    if (lines.length > limit) return { lines, broke, over: true }
    if (ctx.measureText(word).width <= maxWidth) { line = word; continue }
    broke = true
    if (limit !== Infinity) return { lines, broke, over: true }
    for (const char of word) {
      const next = line + char
      if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = char } else line = next
    }
  }
  push()
  return { lines, broke, over: lines.length > limit }
}

/** Shortens `text` until `text + ellipsis` fits `maxWidth`. */
export function ellipsize(ctx: Measurer, text: string, maxWidth: number, ellipsis = '…'): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let low = 0, high = text.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (ctx.measureText(text.slice(0, mid).trimEnd() + ellipsis).width <= maxWidth) low = mid
    else high = mid - 1
  }
  return text.slice(0, low).trimEnd() + ellipsis
}

/* Results are remembered per (text, options). Measuring depends on the faces the document has loaded, so the memory is dropped
   whenever fonts finish loading. Every real canvas context measures the same, so they share one memory: what one layer fitted
   another (or a `measuringContext`, which draws nothing) has already settled. Anything else (a test's stand-in) keeps its own. */
interface FitMemory { epoch: number; results: Map<string, FitResult> }
const FIT_SCOPE = Symbol('fitScope')
const CANVAS_SCOPE = {}
const fitMemories = new WeakMap<object, FitMemory>()
const FIT_MEMORY_SIZE = 512
let fitEpoch = 0
let watchingFonts = false

/** Forgets every remembered fit. Called when fonts load; call it too after anything else that changes how text measures. */
export function clearFitCache(): void { fitEpoch++ }

const watchFonts = (): void => {
  if (watchingFonts) return
  watchingFonts = true
  if (typeof document !== 'undefined') document.fonts?.addEventListener?.('loadingdone', clearFitCache)
}

const isCanvasContext = (ctx: object): boolean =>
  (typeof CanvasRenderingContext2D !== 'undefined' && ctx instanceof CanvasRenderingContext2D) ||
  (typeof OffscreenCanvasRenderingContext2D !== 'undefined' && ctx instanceof OffscreenCanvasRenderingContext2D)

/** The canvas text settings besides `font` that change how text measures. Nothing here sets them; if something did, its fits would not be mixed up with the defaults. */
const TEXT_STATE = ['letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering'] as const
const textState = (ctx: object): string => {
  let state = ''
  for (const name of TEXT_STATE) { const value = (ctx as Record<string, unknown>)[name]; if (typeof value === 'string') state += value + ',' }
  return state
}

const scopeOf = (ctx: object): object => (ctx as { [FIT_SCOPE]?: object })[FIT_SCOPE] ?? (isCanvasContext(ctx) ? CANVAS_SCOPE : ctx)

/**
 * A context that measures exactly like `real` and draws nothing. Run a painter on it and every fit the painter makes is
 * worked out and remembered (see fitText) without a pixel being drawn, so when the real paint comes it only draws. This is
 * how a board gets the next project's lettering ready one small step at a time instead of all in the frame it changes.
 * Setting `font` on it sets it on `real`, so `real` should be a scratch context nobody is painting with.
 */
export function measuringContext(real: Measurer & { canvas?: unknown }): CanvasRenderingContext2D {
  const state: Record<PropertyKey, unknown> = {}
  const gradient = { addColorStop() {} }
  const nothing = (): undefined => undefined
  const scope = scopeOf(real)
  return new Proxy(state, {
    get(_, key) {
      if (key === 'measureText') return (text: string) => real.measureText(text)
      if (key === 'font') return real.font
      if (key === FIT_SCOPE) return scope
      if (key === 'canvas') return real.canvas
      if (typeof key === 'string' && (TEXT_STATE as readonly string[]).includes(key)) return (real as unknown as Record<string, unknown>)[key]
      if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createConicGradient') return () => gradient
      return key in state ? state[key] : nothing
    },
    set(_, key, value) {
      if (key === 'font') real.font = value as string
      else state[key] = value
      return true
    },
  }) as unknown as CanvasRenderingContext2D
}

const copyOf = (fit: FitResult): FitResult => ({ ...fit, lines: fit.lines.slice() })

/**
 * Picks the largest size in [minPx, maxPx] at which `text` wraps into at most `maxLines` lines inside
 * `maxWidth` (and `maxHeight`) without cutting a word. At the minimum size, text that still does not fit is cut and the last
 * line ellipsized. Glyphs are never scaled sideways. Leaves `ctx.font` set to the chosen size.
 *
 * Sizes are tried on the grid maxPx, maxPx - step, ... down to minPx. Whether a size fits only ever goes from "no" to "yes"
 * as the type gets smaller, so the largest fitting size is found by halving the grid (a handful of wraps, not one per size),
 * the largest of all being tried first because short copy usually takes it. The size chosen always fits.
 */
export function fitText(ctx: Measurer, text: string, o: FitOptions): FitResult {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim()
  const maxLines = Math.max(1, o.maxLines ?? 1)
  const lineHeight = o.lineHeight ?? 1.2
  const weight = o.weight ?? 600
  const step = Math.max(0.5, o.step ?? 2)
  const budget = o.maxHeight ?? Infinity
  if (!clean) { ctx.font = fontFor(weight, o.minPx, o.family); return { lines: [], px: o.minPx, lineHeight, font: ctx.font, height: 0, truncated: false } }
  watchFonts()
  const scope = scopeOf(ctx)
  let memory = fitMemories.get(scope)
  if (!memory) fitMemories.set(scope, memory = { epoch: fitEpoch, results: new Map() })
  else if (memory.epoch !== fitEpoch) { memory.epoch = fitEpoch; memory.results.clear() }
  const key = `${o.maxWidth}|${maxLines}|${budget}|${o.minPx}|${o.maxPx}|${weight}|${o.family}|${lineHeight}|${step}|${o.ellipsis ?? ''}|${textState(ctx)}|${clean}`
  const known = memory.results.get(key)
  if (known) { ctx.font = known.font; return copyOf(known) }
  const result = solveFit(ctx, clean, o, { maxLines, lineHeight, weight, step, budget })
  if (memory.results.size >= FIT_MEMORY_SIZE) {
    // Full: forget the oldest quarter (a Map keeps insertion order), not everything, so a cycle through many projects keeps most of what it fitted.
    let drop = FIT_MEMORY_SIZE >> 2
    for (const oldest of memory.results.keys()) { if (drop-- <= 0) break; memory.results.delete(oldest) }
  }
  memory.results.set(key, copyOf(result))
  return result
}

function solveFit(ctx: Measurer, clean: string, o: FitOptions, { maxLines, lineHeight, weight, step, budget }: { maxLines: number; lineHeight: number; weight: number | string; step: number; budget: number }): FitResult {
  // The sizes, built the way a countdown would so every one is the exact number it always was.
  const grid: number[] = []
  for (let px = o.maxPx; px >= o.minPx; px -= step) grid.push(px)
  // The lines at size `px`, or null when that size cannot be used: a word cut in half is worse than smaller type, so only the
  // minimum size may do it.
  const attempt = (px: number): string[] | null => {
    ctx.font = fontFor(weight, px, o.family)
    const wrapped = wrapWords(ctx, clean, o.maxWidth, maxLines)
    return wrapped.over || wrapped.broke || wrapped.lines.length * px * lineHeight > budget ? null : wrapped.lines
  }
  let best: string[] | null = null
  let bestPx = o.minPx
  let low = 0
  let high = grid.length
  if (high > 0) {
    const first = attempt(grid[0])
    if (first) { best = first; bestPx = grid[0]; high = 0 } else low = 1
  }
  while (low < high) {
    const mid = (low + high) >> 1
    const lines = attempt(grid[mid])
    if (lines) { best = lines; bestPx = grid[mid]; high = mid } else low = mid + 1
  }
  if (best) {
    ctx.font = fontFor(weight, bestPx, o.family)
    return { lines: best, px: bestPx, lineHeight, font: ctx.font, height: best.length * bestPx * lineHeight, truncated: false }
  }
  const px = o.minPx
  ctx.font = fontFor(weight, px, o.family)
  const { lines } = wrapWords(ctx, clean, o.maxWidth)
  const room = Math.max(1, Math.min(maxLines, Math.floor(budget / (px * lineHeight))))
  if (lines.length <= room) return { lines, px, lineHeight, font: ctx.font, height: lines.length * px * lineHeight, truncated: false }
  const kept = lines.slice(0, room)
  kept[room - 1] = ellipsize(ctx, lines.slice(room - 1).join(' '), o.maxWidth, o.ellipsis)
  return { lines: kept, px, lineHeight, font: ctx.font, height: kept.length * px * lineHeight, truncated: true }
}

/** Draws a fitted block. `top` is the top of the first line box; baselines sit where Geist's caps centre in the box. */
export function drawFit(ctx: CanvasRenderingContext2D, fit: FitResult, x: number, top: number, align: CanvasTextAlign = 'left'): void {
  ctx.font = fit.font
  ctx.textAlign = align
  ctx.textBaseline = 'alphabetic'
  fit.lines.forEach((line, i) => ctx.fillText(line, x, top + (i + 0.5) * fit.px * fit.lineHeight + fit.px * 0.36))
}

/** Rounded rectangle path (no fill). */
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + k, y)
  ctx.arcTo(x + w, y, x + w, y + h, k)
  ctx.arcTo(x + w, y + h, x, y + h, k)
  ctx.arcTo(x, y + h, x, y, k)
  ctx.arcTo(x, y, x + w, y, k)
  ctx.closePath()
}

/* ------------------------------------------------------------------ surfaces -- */

export interface WoodOptions {
  base?: string
  seed?: string | number
  /** Horizontal boards stacked in the rect. */
  boards?: number
  /** 0..1 amount of grain. */
  grain?: number
  knots?: number
  /** Light on the top edge, shade at the bottom. */
  edge?: boolean
  /** Four nail heads in the corners. */
  nails?: boolean
}

const hexToRgb = (hex: string): [number, number, number] => {
  const v = hex.replace('#', '')
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]
}
const shade = (hex: string, amount: number): string => {
  const [r, g, b] = hexToRgb(hex)
  const k = (c: number) => Math.max(0, Math.min(255, Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount))))
  return `rgb(${k(r)},${k(g)},${k(b)})`
}

/** Hand-hewn timber: seams, grain, a couple of knots, a lit top edge. Deterministic for a given seed. */
export function paintWood(ctx: CanvasRenderingContext2D, r: Rect, o: WoodOptions = {}): void {
  const rand = mulberry32(hashSeed(o.seed ?? 'wood'))
  const base = o.base ?? TOKENS.woodDark
  const boards = Math.max(1, Math.round(o.boards ?? 1))
  const grain = o.grain ?? 0.55
  const s = Math.max(0.5, Math.min(r.w, r.h) / 140)
  ctx.save()
  ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip()
  ctx.fillStyle = base
  ctx.fillRect(r.x, r.y, r.w, r.h)
  const bh = r.h / boards
  for (let b = 0; b < boards; b++) {
    const y0 = r.y + b * bh
    // Each board is a touch lighter or darker than its neighbour.
    ctx.fillStyle = rand() > 0.5 ? `rgba(255,236,200,${0.03 + rand() * 0.06})` : `rgba(20,12,4,${0.05 + rand() * 0.09})`
    ctx.fillRect(r.x, y0, r.w, bh)
    const streaks = Math.max(3, Math.round((r.w / 40) * grain))
    for (let i = 0; i < streaks; i++) {
      const y = y0 + (0.08 + rand() * 0.84) * bh
      const x = r.x + (rand() * 0.7 - 0.1) * r.w
      const len = r.w * (0.18 + rand() * 0.5)
      const dark = rand() > 0.38
      ctx.strokeStyle = dark ? `rgba(28,18,6,${0.10 + rand() * 0.16})` : `rgba(255,232,190,${0.06 + rand() * 0.1})`
      ctx.lineWidth = (0.8 + rand() * 1.8) * s
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.bezierCurveTo(x + len * 0.3, y + (rand() - 0.5) * 5 * s, x + len * 0.65, y + (rand() - 0.5) * 5 * s, x + len, y + (rand() - 0.5) * 3 * s)
      ctx.stroke()
    }
    const knots = Math.round((o.knots ?? 1) * (bh > 40 * s ? 1 : 0.4) * rand() * 1.6)
    for (let k = 0; k < knots; k++) {
      const kx = r.x + (0.1 + rand() * 0.8) * r.w, ky = y0 + (0.3 + rand() * 0.4) * bh
      for (let ring = 3; ring >= 1; ring--) {
        ctx.strokeStyle = `rgba(28,18,6,${0.12 + (3 - ring) * 0.07})`
        ctx.lineWidth = 1.3 * s
        ctx.beginPath(); ctx.ellipse(kx, ky, ring * 4.5 * s, ring * 2.3 * s, 0, 0, Math.PI * 2); ctx.stroke()
      }
    }
    if (b > 0) {
      ctx.fillStyle = 'rgba(20,12,4,0.55)'; ctx.fillRect(r.x, y0 - 1.2 * s, r.w, 2.4 * s)
      ctx.fillStyle = 'rgba(255,236,200,0.14)'; ctx.fillRect(r.x, y0 + 1.2 * s, r.w, 1.2 * s)
    }
  }
  if (o.edge !== false) {
    const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h)
    g.addColorStop(0, 'rgba(255,240,210,0.20)'); g.addColorStop(0.1, 'rgba(255,240,210,0)')
    g.addColorStop(0.88, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.30)')
    ctx.fillStyle = g
    ctx.fillRect(r.x, r.y, r.w, r.h)
  }
  ctx.restore()
  if (o.nails) {
    const m = Math.min(r.h * 0.5, 16 * s)
    for (const [nx, ny] of [[r.x + m, r.y + m], [r.x + r.w - m, r.y + m], [r.x + m, r.y + r.h - m], [r.x + r.w - m, r.y + r.h - m]]) drawNail(ctx, nx, ny, 4.2 * s)
  }
}

/** A nail head: dark disc, a lit crescent, a pinpoint highlight. */
export function drawNail(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(x + radius * 0.25, y + radius * 0.35, radius * 1.05, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = TOKENS.woodDeep; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#9b8f78'; ctx.beginPath(); ctx.arc(x - radius * 0.28, y - radius * 0.3, radius * 0.48, 0, Math.PI * 2); ctx.fill()
}

export interface ParchmentOptions {
  paper?: string
  seed?: string | number
  /** Corner radius in px. */
  radius?: number
  /** 0..1 darkening toward the edges. */
  burn?: number
  /** Double rule inside the edge. */
  rule?: boolean
}

/** A sheet of paper: lit centre, burnt edges, fibres, two hand-ruled lines. */
export function paintParchment(ctx: CanvasRenderingContext2D, r: Rect, o: ParchmentOptions = {}): void {
  const rand = mulberry32(hashSeed(o.seed ?? 'paper'))
  const paper = o.paper ?? TOKENS.paper
  const s = Math.max(0.5, Math.min(r.w, r.h) / 140)
  const radius = o.radius ?? 10 * s
  const burn = o.burn ?? 0.5
  ctx.save()
  roundRect(ctx, r.x, r.y, r.w, r.h, radius)
  ctx.clip()
  const g = ctx.createRadialGradient(r.x + r.w * 0.45, r.y + r.h * 0.4, Math.min(r.w, r.h) * 0.1, r.x + r.w / 2, r.y + r.h / 2, Math.max(r.w, r.h) * 0.75)
  g.addColorStop(0, shade(paper, 0.34)); g.addColorStop(0.55, paper); g.addColorStop(1, shade(paper, -0.12 - burn * 0.12))
  ctx.fillStyle = g
  ctx.fillRect(r.x, r.y, r.w, r.h)
  for (let i = 0; i < 3; i++) {
    const cx = r.x + rand() * r.w, cy = r.y + rand() * r.h, rad = (0.15 + rand() * 0.25) * Math.max(r.w, r.h)
    const stain = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
    stain.addColorStop(0, 'rgba(120,80,30,0.07)'); stain.addColorStop(1, 'rgba(120,80,30,0)')
    ctx.fillStyle = stain; ctx.fillRect(r.x, r.y, r.w, r.h)
  }
  ctx.lineWidth = 1 * s
  const fibres = Math.round((r.w * r.h) / (2600 * s * s))
  for (let i = 0; i < fibres; i++) {
    const x = r.x + rand() * r.w, y = r.y + rand() * r.h, a = rand() * Math.PI, l = (4 + rand() * 9) * s
    ctx.strokeStyle = `rgba(90,60,25,${0.04 + rand() * 0.06})`
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke()
  }
  const edge = Math.min(r.w, r.h) * 0.07
  const sides: [number, number, number, number, Rect][] = [
    [r.x, r.y, r.x, r.y + edge, { x: r.x, y: r.y, w: r.w, h: edge }],
    [r.x, r.y + r.h, r.x, r.y + r.h - edge, { x: r.x, y: r.y + r.h - edge, w: r.w, h: edge }],
    [r.x, r.y, r.x + edge, r.y, { x: r.x, y: r.y, w: edge, h: r.h }],
    [r.x + r.w, r.y, r.x + r.w - edge, r.y, { x: r.x + r.w - edge, y: r.y, w: edge, h: r.h }],
  ]
  for (const [x0, y0, x1, y1, box] of sides) {
    const e = ctx.createLinearGradient(x0, y0, x1, y1)
    e.addColorStop(0, `rgba(88,52,16,${0.22 * burn + 0.04})`); e.addColorStop(1, 'rgba(88,52,16,0)')
    ctx.fillStyle = e
    ctx.fillRect(box.x, box.y, box.w, box.h)
  }
  ctx.restore()
  if (o.rule !== false) {
    ctx.strokeStyle = 'rgba(87,78,55,0.55)'; ctx.lineWidth = 2.2 * s
    roundRect(ctx, r.x + 12 * s, r.y + 12 * s, r.w - 24 * s, r.h - 24 * s, Math.max(2, radius * 0.6)); ctx.stroke()
    ctx.strokeStyle = 'rgba(87,78,55,0.28)'; ctx.lineWidth = 1 * s
    roundRect(ctx, r.x + 18 * s, r.y + 18 * s, r.w - 36 * s, r.h - 36 * s, Math.max(2, radius * 0.4)); ctx.stroke()
  }
}

/** A banner with swallow-tail ends, for category and section names. `color` fills it, `deep` shades the folds. */
export function paintRibbon(ctx: CanvasRenderingContext2D, r: Rect, color: string, deep: string): void {
  const n = Math.min(r.h * 0.4, r.w * 0.2)
  ctx.save()
  ctx.fillStyle = 'rgba(0,0,0,0.22)'
  ctx.beginPath(); ctx.moveTo(r.x + 2, r.y + 4); ctx.lineTo(r.x + r.w + 2, r.y + 4); ctx.lineTo(r.x + r.w - n + 2, r.y + r.h / 2 + 4); ctx.lineTo(r.x + r.w + 2, r.y + r.h + 4); ctx.lineTo(r.x + 2, r.y + r.h + 4); ctx.lineTo(r.x + n + 2, r.y + r.h / 2 + 4); ctx.closePath(); ctx.fill()
  ctx.fillStyle = color
  ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x + r.w, r.y); ctx.lineTo(r.x + r.w - n, r.y + r.h / 2); ctx.lineTo(r.x + r.w, r.y + r.h); ctx.lineTo(r.x, r.y + r.h); ctx.lineTo(r.x + n, r.y + r.h / 2); ctx.closePath(); ctx.fill()
  ctx.fillStyle = deep
  ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x + n * 0.55, r.y); ctx.lineTo(r.x + n, r.y + r.h / 2); ctx.lineTo(r.x + n * 0.55, r.y + r.h); ctx.lineTo(r.x, r.y + r.h); ctx.lineTo(r.x + n, r.y + r.h / 2); ctx.closePath(); ctx.globalAlpha = 0.5; ctx.fill()
  ctx.globalAlpha = 1
  ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(r.x + n, r.y, r.w - 2 * n, Math.max(1.5, r.h * 0.07))
  ctx.restore()
}

/** A small timber tag with `text` in cream mono, sized to the text. Returns the tag's width. */
export function paintTag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, h: number, fonts: SignFonts, o: { fill?: string; ink?: string; px?: number } = {}): number {
  const px = o.px ?? h * 0.5
  ctx.font = fontFor(600, px, fonts.mono)
  const w = ctx.measureText(text).width + h * 0.9
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; roundRect(ctx, x + 1.5, y + 2.5, w, h, h * 0.22); ctx.fill()
  ctx.fillStyle = o.fill ?? TOKENS.woodDark; roundRect(ctx, x, y, w, h, h * 0.22); ctx.fill()
  ctx.fillStyle = 'rgba(255,236,200,0.16)'; ctx.fillRect(x + h * 0.2, y + 1, w - h * 0.4, 1.5)
  ctx.fillStyle = o.ink ?? TOKENS.cream
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  ctx.fillText(text, x + h * 0.45, y + h / 2 + px * 0.36)
  return w
}

/* ------------------------------------------------------------------ numbers -- */

export interface NumeralOptions {
  color?: string
  shadow?: string
  family?: string
  weight?: number | string
  maxPx?: number
  align?: CanvasTextAlign
}

/**
 * Big digits (or any short string) carved into a rect: as large as will fit one line, with a drop edge
 * so they read as painted-and-chiselled rather than printed. Returns the pixel size used.
 */
export function paintNumeral(ctx: CanvasRenderingContext2D, value: string | number, r: Rect, o: NumeralOptions = {}): number {
  const family = o.family ?? signFonts().sans
  const fit = fitText(ctx, String(value), { maxWidth: r.w, minPx: 8, maxPx: Math.min(o.maxPx ?? r.h * 0.95, r.h * 0.95), weight: o.weight ?? 800, family, lineHeight: 1, step: 2 })
  const align = o.align ?? 'center'
  const x = align === 'center' ? r.x + r.w / 2 : align === 'left' ? r.x : r.x + r.w
  const top = r.y + (r.h - fit.height) / 2
  const offset = Math.max(1, fit.px * 0.045)
  ctx.fillStyle = o.shadow ?? 'rgba(0,0,0,0.38)'
  drawFit(ctx, fit, x + offset, top + offset, align)
  ctx.fillStyle = o.color ?? TOKENS.cream
  drawFit(ctx, fit, x, top, align)
  return fit.px
}

export interface PipOptions { on?: string; off?: string; ring?: string; gap?: number }

/** A row of `total` round pips, the first `count` lit. Fits the rect, centred. */
export function paintPips(ctx: CanvasRenderingContext2D, count: number, total: number, r: Rect, o: PipOptions = {}): void {
  const n = Math.max(1, Math.floor(total))
  const gap = o.gap ?? 0.35
  const d = Math.min(r.h, r.w / (n + (n - 1) * gap))
  const used = d * n + d * gap * (n - 1)
  const x0 = r.x + (r.w - used) / 2, cy = r.y + r.h / 2
  for (let i = 0; i < n; i++) {
    const cx = x0 + d / 2 + i * d * (1 + gap)
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(cx + d * 0.04, cy + d * 0.07, d * 0.5, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = i < count ? (o.on ?? TOKENS.gold) : (o.off ?? TOKENS.woodDeep)
    ctx.beginPath(); ctx.arc(cx, cy, d * 0.46, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = o.ring ?? 'rgba(26,23,18,0.7)'; ctx.lineWidth = Math.max(1, d * 0.07); ctx.stroke()
    if (i < count) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(cx - d * 0.13, cy - d * 0.15, d * 0.14, 0, Math.PI * 2); ctx.fill() }
  }
}
