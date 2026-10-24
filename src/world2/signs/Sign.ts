import * as THREE from 'three'
import { orientForMesh } from '../interactions/bindCanvas'
import { SWATCH, TOKENS } from './palette'
import {
  Facets, addBox, bracketGeometry, charmGeometry, hashSeed, mergeParts, nailGeometry, place, plankGeometry,
  postGeometry, ropeGeometry, vineGeometry, type MergePart, type Vec3,
} from './geometry'
import {
  drawFit, fitText, onSignFontsLoaded, paintNumeral, paintParchment, paintRibbon, paintWood, roundRect, signFonts,
  type Rect, type SignFonts,
} from './paint'
import { EMBLEM_SIZE, STATIC_TIME, paintEmblem } from './emblems'
import type { SignMaterials } from './materials'
import { DEFAULT_THEME, themeById, type EmblemKind, type SignTheme } from './themes'

/* ============================================================
   SIGNS: LAYERS, THE SHAPES THAT CARRY THEM, AND THE ONE CLOCK

   A face is a stack of canvas layers. A STATIC layer is painted
   when its content changes and then left alone, which is almost
   always; a LIVE layer is the small animated picture, repainted
   on a timer — and only while somebody can see it.

   `SignRuntime` is that timer. It is the only thing in the kit
   that listens to the ticker, it probes every sign's distance and
   visibility a few times a second (no allocations, a cached
   frustum), and each frame it paints AT MOST ONE layer across
   all signs, so a canvas upload can never pile up into a hitch.
   ============================================================ */

export type QualityTier = 'high' | 'medium' | 'low'

/* ------------------------------------------------------------------ layers -- */

export type LayerPaint = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number, layer: SignLayer) => void

export interface LayerOptions {
  name: string
  width: number
  height: number
  paint: LayerPaint
  /** Repainted on a timer while near and visible. Static layers paint once per invalidation. */
  live?: boolean
  /** Repaints per second by quality tier (live layers). Focus multiplies by 1.5. */
  hz?: Partial<Record<QualityTier, number>>
  /** Higher paints first when several are dirty. */
  priority?: number
  /** Mipmaps: on for static faces read at a glancing angle, off for the small live layer. */
  mipmaps?: boolean
  /**
   * What the canvas shows before its first paint. An opaque face passes its ground colour, so a layer that has not been
   * painted yet reads as blank paper or timber instead of the black an empty emissive map renders as. Overlays leave it.
   */
  base?: string
}

const DEFAULT_HZ: Record<QualityTier, number> = { high: 10, medium: 8, low: 5 }

export class SignLayer {
  readonly name: string
  readonly canvas: HTMLCanvasElement
  readonly context: CanvasRenderingContext2D
  readonly texture: THREE.CanvasTexture
  /** Repainted on a timer while near and visible. A board that swaps its picture for a photo turns this off. */
  live: boolean
  readonly priority: number
  readonly hzTable: Record<QualityTier, number>
  /** Needs a (re)paint the next time its sign is on screen. */
  dirty = true
  /** True while the content is not ready (a flip waiting for its midpoint): the scheduler skips it. */
  hold = false
  /** `ticker.elapsed` of the last paint, -Infinity before the first. */
  paintedAt = -Infinity
  /** How many times it has painted, so a test can prove nothing repainted. */
  paints = 0
  sign: Sign | null = null
  private readonly painter: LayerPaint

  constructor(options: LayerOptions) {
    this.name = options.name
    this.live = options.live ?? false
    this.priority = options.priority ?? 0
    this.hzTable = { ...DEFAULT_HZ, ...options.hz }
    this.painter = options.paint
    this.canvas = document.createElement('canvas')
    this.canvas.width = Math.max(1, Math.round(options.width))
    this.canvas.height = Math.max(1, Math.round(options.height))
    const context = this.canvas.getContext('2d')
    if (!context) throw new Error('World2: 2D canvas is unavailable, so signs cannot be painted.')
    this.context = context
    if (options.base) { context.fillStyle = options.base; context.fillRect(0, 0, this.canvas.width, this.canvas.height) }
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    const mipmaps = options.mipmaps ?? !this.live
    this.texture.generateMipmaps = mipmaps
    this.texture.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
    this.texture.magFilter = THREE.LinearFilter
    this.texture.anisotropy = mipmaps ? 8 : 1
  }

  invalidate(): void { this.dirty = true }

  /** Repaints per second at `tier`. */
  hz(tier: QualityTier, focused: boolean): number { return this.hzTable[tier] * (focused ? 1.5 : 1) }

  /** True until the first paint: what the canvas shows is only its `base`. */
  get unpainted(): boolean { return this.paintedAt === -Infinity }

  /**
   * Clears, paints, queues the upload. Called by the runtime, or directly for a synchronous first frame.
   * `time` is the picture's clock; `at` is when it was painted by the scheduler's clock (they differ for a still frame).
   */
  paint(time: number, at: number = time): void {
    const { context, canvas } = this
    context.save()
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.globalAlpha = 1
    this.painter(context, canvas.width, canvas.height, time, this)
    context.restore()
    this.texture.needsUpdate = true
    this.dirty = false
    this.paintedAt = at
    this.paints++
  }

  /** Same, for a caller that has no clock: live layers get their still frame. */
  paintNow(time = STATIC_TIME): void { this.paint(this.live ? STATIC_TIME : time) }

  dispose(): void { this.texture.dispose() }
}

/* ------------------------------------------------------------------ the face of a plane -- */

export interface FaceFrame {
  /** Metres (authored units) across and up the painted surface, as the reader sees it. */
  width: number
  height: number
  /** Face space -> mesh-local space. In face space +X is right, +Y is up and +Z points at the reader. */
  matrix: THREE.Matrix4
  /** A group whose matrix is `matrix`, added to the mesh: put anything that should sit ON the face in it, in face units. */
  root: THREE.Group
  /** Canvas fraction (0..1, origin top-left) to a point in face space. */
  toFace(a: number, b: number, z?: number, out?: THREE.Vector3): THREE.Vector3
}

/**
 * The geometry of a canvas-textured authored plane, derived from its own UVs and the texture's repeat/offset (so a
 * mirrored face is handled): how big it reads, and a face space in which overlays can be placed upright.
 * Call after `orientForMesh`. The mesh should have unit scale.
 */
export function faceFrame(mesh: THREE.Mesh, texture: THREE.Texture): FaceFrame {
  const position = mesh.geometry.getAttribute('position')
  const uv = mesh.geometry.getAttribute('uv')
  const probe = (a: number, b: number): THREE.Vector3 => {
    // Solve the affine map canvas (a, b) -> local from the three vertices that span the quad.
    const canvas: [number, number][] = []
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i) * texture.repeat.x + texture.offset.x
      const v = uv.getY(i) * texture.repeat.y + texture.offset.y
      canvas.push([u, texture.flipY ? 1 - v : v])
    }
    const pick = [0]
    for (let i = 1; i < canvas.length && pick.length < 3; i++) {
      const [u0, v0] = canvas[pick[0]]
      if (pick.length === 1 && (Math.abs(canvas[i][0] - u0) > 1e-4 || Math.abs(canvas[i][1] - v0) > 1e-4)) pick.push(i)
      else if (pick.length === 2) {
        const [u1, v1] = canvas[pick[1]]
        const cross = (u1 - u0) * (canvas[i][1] - v0) - (v1 - v0) * (canvas[i][0] - u0)
        if (Math.abs(cross) > 1e-4) pick.push(i)
      }
    }
    const [i0, i1, i2] = pick
    const [u0, v0] = canvas[i0], [u1, v1] = canvas[i1], [u2, v2] = canvas[i2]
    const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)
    const s = ((a - u0) * (v2 - v0) - (u2 - u0) * (b - v0)) / det
    const t = ((u1 - u0) * (b - v0) - (a - u0) * (v1 - v0)) / det
    const p0 = new THREE.Vector3().fromBufferAttribute(position, i0)
    const p1 = new THREE.Vector3().fromBufferAttribute(position, i1)
    const p2 = new THREE.Vector3().fromBufferAttribute(position, i2)
    return p0.add(p1.sub(p0.clone()).multiplyScalar(s)).add(p2.sub(new THREE.Vector3().fromBufferAttribute(position, i0)).multiplyScalar(t))
  }
  const centre = probe(0.5, 0.5)
  const right = probe(1, 0.5).sub(probe(0, 0.5))
  const up = probe(0.5, 0).sub(probe(0.5, 1))
  const width = right.length(), height = up.length()
  const x = right.clone().normalize(), y = up.clone().normalize()
  const z = new THREE.Vector3().crossVectors(x, y).normalize()
  const matrix = new THREE.Matrix4().makeBasis(x, y, z).setPosition(centre)
  const root = new THREE.Group()
  root.name = 'sign:face-space'
  root.matrixAutoUpdate = false
  root.matrix.copy(matrix)
  root.userData.signMount = 'fixed'
  mesh.add(root)
  const toFace = (a: number, b: number, zz = 0, out = new THREE.Vector3()): THREE.Vector3 => out.set((a - 0.5) * width, (0.5 - b) * height, zz)
  return { width, height, matrix, root, toFace }
}

/** How big an authored plane reads, in its own units: the two largest extents of its geometry times its scale. */
export function planeSize(mesh: THREE.Mesh): { width: number; height: number } {
  mesh.geometry.computeBoundingBox()
  const size = mesh.geometry.boundingBox!.getSize(new THREE.Vector3()).multiply(mesh.scale)
  const [width, height] = [size.x, size.y, size.z].sort((a, b) => b - a)
  return { width, height }
}

/** Gives `mesh` a lit face painted by `layer`, the right way up and round for someone standing at `reader`. */
export function bindLayer(layer: SignLayer, mesh: THREE.Mesh, materials: SignMaterials, reader: THREE.Vector3, options: { transparent?: boolean; emissive?: number } = {}): void {
  orientForMesh(layer.texture, mesh, reader)
  mesh.material = materials.face(layer.texture, options)
  mesh.visible = true
}

/* ------------------------------------------------------------------ the sign -- */

export type SignVariant = 'board' | 'plank' | 'label' | 'custom'

export interface PaintTools {
  fonts: SignFonts
  theme: SignTheme
  seed: string
  fitText: typeof fitText
  drawFit: typeof drawFit
  paintWood: typeof paintWood
  paintParchment: typeof paintParchment
  paintRibbon: typeof paintRibbon
  paintNumeral: typeof paintNumeral
  roundRect: typeof roundRect
  tokens: typeof TOKENS
}
export type SignPainter = (ctx: CanvasRenderingContext2D, rect: Rect, tools: PaintTools, sign: Sign) => void

export interface SignText { title?: string; subtitle?: string; value?: string | number; kicker?: string }

export interface SignOptions extends SignText {
  id: string
  variant: SignVariant
  /** The readable rectangle, in metres. */
  width: number
  height: number
  theme?: SignTheme | string
  materials: SignMaterials
  /** Anything with `add(disposer)`: the controller's Bin. */
  bin?: { add(disposer: () => void): unknown }
  /** Registers with this runtime on construction. */
  runtime?: SignRuntime
  /** Canvas pixels per metre of face. Default 256 (board), 320 (plank, label). */
  dpm?: number
  /** Stable seed for grain. Default: the id. */
  seed?: string | number
  /** Plank: hang it from two ropes. */
  hang?: 'none' | 'rope'
  /** Board: the animated picture. Default: the theme's; null for none. */
  emblem?: EmblemKind | null
  /** A colour band on plank and label faces (lane colours, status). */
  accent?: string
  /** Board: how high the face sits off the ground. */
  legHeight?: number
  /** Replaces the default layout of the main face. */
  paint?: SignPainter
}

export interface SignBounds { centre: THREE.Vector3; radius: number; object: THREE.Object3D }
export interface SignState { visible: boolean; near: boolean; distance: number }

const FACE_LIFT = 0.004

/**
 * The plank behind a board's face: what a visitor sees when the camera is orbited round to the back. A surface that faces
 * away from the island's sun keeps about a quarter of its colour, so the dark timber the faces are framed in (woodDark) read
 * as a black slab there. This is the warm timber of the posts and rails, which is still timber in shade. Anything that builds
 * a board of its own (the plaza's lighter boards, the Projects board's authored back) takes this swatch so every back matches.
 */
export const BOARD_BACK = SWATCH.lightOrange

export class Sign {
  readonly id: string
  readonly variant: SignVariant
  readonly width: number
  readonly height: number
  readonly group = new THREE.Group()
  readonly layers: SignLayer[] = []
  readonly materials: SignMaterials
  /** The painted face, when the sign builds one. */
  face: THREE.Mesh | null = null
  /** The wood: a single merged mesh of posts, borders, nails, rope, vine and charm. */
  hardware: THREE.Mesh | null = null
  main: SignLayer | null = null
  emblem: SignLayer | null = null
  /** Set by the runtime. */
  focused = false
  readonly state: SignState = { visible: false, near: false, distance: Infinity }
  bounds: SignBounds | null = null
  /** Transform-only motion (a charm swinging). Called by the runtime while near and visible, never when reduced. */
  animate: ((time: number) => void) | null = null
  text: SignText
  private themeValue: SignTheme
  private readonly options: SignOptions
  private readonly seed: string
  private runtime: SignRuntime | null = null
  private disposed = false
  private readonly geometries: THREE.BufferGeometry[] = []

  constructor(options: SignOptions) {
    this.options = options
    this.id = options.id
    this.variant = options.variant
    this.width = options.width
    this.height = options.height
    this.materials = options.materials
    this.seed = String(options.seed ?? options.id)
    this.text = { title: options.title, subtitle: options.subtitle, value: options.value, kicker: options.kicker }
    this.themeValue = typeof options.theme === 'string' ? themeById(options.theme) : options.theme ?? DEFAULT_THEME
    this.group.name = `sign:${this.id}`
    // Not enumerable: Object3D.clone() copies userData through JSON, which cannot take a Sign (it points back at its own group),
    // so any tree that held one would throw the first time somebody cloned it. Still there to read; invisible to JSON and clone.
    Object.defineProperty(this.group.userData, 'sign', { value: this, enumerable: false, writable: true, configurable: true })
    this.group.userData.signMount = 'fixed'
    if (options.variant === 'board') this.buildBoard()
    else if (options.variant === 'plank') this.buildPlank()
    else if (options.variant === 'label') this.buildLabel()
    options.bin?.add(() => this.dispose())
    if (options.runtime) options.runtime.add(this)
  }

  get theme(): SignTheme { return this.themeValue }

  /* ---- layers ---- */

  addLayer(options: LayerOptions): SignLayer {
    const layer = new SignLayer(options)
    layer.sign = this
    this.layers.push(layer)
    this.runtime?.wake()
    return layer
  }

  /** Marks every layer for repaint (content, theme or fonts changed). */
  invalidate(): void { for (const layer of this.layers) layer.invalidate() }

  /** Paints every layer synchronously. For studio thumbnails, tests and the first frame of a sign with no runtime. */
  paintNow(): void { for (const layer of this.layers) { if (!layer.hold) layer.paintNow() } }

  setText(text: SignText): void { this.text = { ...this.text, ...text }; this.main?.invalidate() }

  setTheme(theme: SignTheme | string): void {
    this.themeValue = typeof theme === 'string' ? themeById(theme) : theme
    this.invalidate()
  }

  /** Replaces the default layout of the main face. */
  paint(painter: SignPainter): void { (this.options as SignOptions).paint = painter; this.main?.invalidate() }

  /** Where the sign is, for the runtime's visibility and distance tests. Built variants set this themselves. */
  setBounds(object: THREE.Object3D, centre: THREE.Vector3, radius: number): void { this.bounds = { object, centre, radius } }

  /** Pass to a painter: everything a layout needs. */
  tools(): PaintTools {
    return {
      fonts: signFonts(), theme: this.themeValue, seed: this.seed, fitText, drawFit, paintWood, paintParchment,
      paintRibbon, paintNumeral, roundRect, tokens: TOKENS,
    }
  }

  /** Registers the sign with a runtime (done for you when `runtime` is passed in the options). */
  attach(runtime: SignRuntime | null): void { this.runtime = runtime }

  /* ---- default layouts ---- */

  private layout = (ctx: CanvasRenderingContext2D, w: number, h: number): void => {
    const rect: Rect = { x: 0, y: 0, w, h }
    const tools = this.tools()
    if (this.options.paint) { this.options.paint(ctx, rect, tools, this); return }
    if (this.variant === 'board') this.paintBoardFace(ctx, rect, tools)
    else if (this.variant === 'plank') this.paintPlankFace(ctx, rect, tools)
    else this.paintLabelFace(ctx, rect, tools)
  }

  private emblemKind(): EmblemKind | null {
    return this.options.emblem === undefined ? this.themeValue.emblem : this.options.emblem
  }

  private paintBoardFace(ctx: CanvasRenderingContext2D, r: Rect, t: PaintTools): void {
    const { w, h } = r
    paintParchment(ctx, r, { seed: this.seed, radius: h * 0.035 })
    const pad = h * 0.1
    const side = this.emblemKind() ? Math.min(h - pad * 2, w * 0.34) : 0
    const right = w - pad - (side ? side + pad * 0.7 : 0)
    let y = pad * 0.85
    const theme = this.themeValue
    if (this.text.kicker) {
      const fit = fitText(ctx, this.text.kicker.toUpperCase(), { maxWidth: right - pad, minPx: h * 0.05, maxPx: h * 0.075, weight: 600, family: t.fonts.mono, lineHeight: 1 })
      const ribbonW = Math.min(right - pad, ctx.measureText(fit.lines[0] ?? '').width + h * 0.2)
      paintRibbon(ctx, { x: pad, y, w: ribbonW, h: h * 0.12 }, theme.ribbon, theme.ribbonDeep)
      ctx.fillStyle = theme.ribbonInk
      drawFit(ctx, fit, pad + h * 0.1, y + h * 0.12 / 2 - fit.px * 0.5, 'left')
      y += h * 0.12 + pad * 0.5
    }
    const bottom = h - pad
    const titleFit = fitText(ctx, this.text.title ?? '', { maxWidth: right - pad, maxLines: 2, maxHeight: (bottom - y) * 0.6, minPx: h * 0.09, maxPx: h * 0.26, weight: 700, family: t.fonts.sans, lineHeight: 1.08 })
    ctx.fillStyle = TOKENS.ink
    drawFit(ctx, titleFit, pad, y, 'left')
    y += titleFit.height + pad * 0.35
    if (this.text.subtitle) {
      const sub = fitText(ctx, this.text.subtitle, { maxWidth: right - pad, maxLines: 3, maxHeight: Math.max(0, bottom - y), minPx: h * 0.06, maxPx: h * 0.12, weight: 500, family: t.fonts.sans, lineHeight: 1.25 })
      ctx.fillStyle = TOKENS.ink2
      drawFit(ctx, sub, pad, y, 'left')
    }
    if (side) {
      const x = w - pad - side, top = (h - side) / 2
      paintWood(ctx, { x: x - h * 0.03, y: top - h * 0.03, w: side + h * 0.06, h: side + h * 0.06 }, { seed: this.seed + ':mat', base: TOKENS.woodDark, nails: false })
    }
  }

  private paintPlankFace(ctx: CanvasRenderingContext2D, r: Rect, t: PaintTools): void {
    const { w, h } = r
    paintWood(ctx, r, { seed: this.seed, base: TOKENS.woodDark, boards: h > w * 0.5 ? 2 : 1, nails: false })
    const pad = h * 0.12
    const accent = this.options.accent
    let x0 = pad
    if (accent) { ctx.fillStyle = accent; ctx.fillRect(0, 0, h * 0.14, h); x0 = h * 0.14 + pad }
    const inner: Rect = { x: x0, y: pad, w: w - x0 - pad, h: h - pad * 2 }
    if (this.text.value !== undefined) {
      const labelH = this.text.title ? inner.h * 0.28 : 0
      if (this.text.title) {
        const fit = fitText(ctx, this.text.title.toUpperCase(), { maxWidth: inner.w, minPx: labelH * 0.5, maxPx: labelH * 0.9, weight: 600, family: t.fonts.mono, lineHeight: 1 })
        ctx.fillStyle = TOKENS.chalk
        drawFit(ctx, fit, inner.x + inner.w / 2, inner.y, 'center')
      }
      paintNumeral(ctx, this.text.value, { x: inner.x, y: inner.y + labelH, w: inner.w, h: inner.h - labelH }, { color: TOKENS.cream, family: t.fonts.sans })
      return
    }
    const sub = this.text.subtitle
    const titleFit = fitText(ctx, this.text.title ?? '', { maxWidth: inner.w, maxLines: sub ? 1 : 2, maxHeight: inner.h * (sub ? 0.66 : 1), minPx: h * 0.12, maxPx: h * 0.56, weight: 700, family: t.fonts.sans, lineHeight: 1.1 })
    const subFit = sub ? fitText(ctx, sub, { maxWidth: inner.w, minPx: h * 0.08, maxPx: h * 0.2, weight: 500, family: t.fonts.sans, lineHeight: 1.1 }) : null
    const total = titleFit.height + (subFit ? subFit.height + h * 0.04 : 0)
    const top = inner.y + (inner.h - total) / 2
    ctx.fillStyle = TOKENS.cream
    drawFit(ctx, titleFit, inner.x + inner.w / 2, top, 'center')
    if (subFit) { ctx.fillStyle = TOKENS.chalk; drawFit(ctx, subFit, inner.x + inner.w / 2, top + titleFit.height + h * 0.04, 'center') }
  }

  private paintLabelFace(ctx: CanvasRenderingContext2D, r: Rect, t: PaintTools): void {
    const { w, h } = r
    paintWood(ctx, r, { seed: this.seed, base: TOKENS.woodDeep, boards: 1, nails: false })
    // The slab's chamfer and sides sample the canvas border, so it stays the dark timber.
    ctx.strokeStyle = '#2c2619'; ctx.lineWidth = Math.max(3, h * 0.035)
    ctx.strokeRect(0, 0, w, h)
    const pad = h * 0.14
    let x0 = pad
    const accent = this.options.accent ?? this.themeValue.ribbon
    ctx.fillStyle = accent; ctx.fillRect(h * 0.035, h * 0.035, h * 0.13, h - h * 0.07)
    x0 = h * 0.17 + pad * 0.6
    const inner: Rect = { x: x0, y: pad * 0.7, w: w - x0 - pad, h: h - pad * 1.4 }
    const sub = this.text.subtitle
    const titleFit = fitText(ctx, this.text.title ?? '', { maxWidth: inner.w, maxLines: sub ? 1 : 2, maxHeight: inner.h * (sub ? 0.62 : 1), minPx: h * 0.12, maxPx: h * 0.5, weight: 700, family: t.fonts.sans, lineHeight: 1.08 })
    const subFit = sub ? fitText(ctx, sub, { maxWidth: inner.w, maxLines: 1, minPx: h * 0.08, maxPx: h * 0.22, weight: 500, family: t.fonts.sans, lineHeight: 1.1 }) : null
    const total = titleFit.height + (subFit ? subFit.height + h * 0.05 : 0)
    const top = inner.y + (inner.h - total) / 2
    ctx.fillStyle = TOKENS.cream
    drawFit(ctx, titleFit, inner.x, top, 'left')
    if (subFit) { ctx.fillStyle = TOKENS.chalk; drawFit(ctx, subFit, inner.x, top + titleFit.height + h * 0.05, 'left') }
  }

  /* ---- geometry ---- */

  private track<T extends THREE.BufferGeometry>(geometry: T): T { this.geometries.push(geometry); return geometry }

  /** The ground of a variant's main face: what it shows for the instant before it is painted. */
  private ground(): string {
    return this.variant === 'board' ? TOKENS.paper : this.variant === 'plank' ? TOKENS.woodDark : TOKENS.woodDeep
  }

  private mainLayer(dpm: number): SignLayer {
    const layer = this.addLayer({
      name: 'face', width: this.width * dpm, height: this.height * dpm,
      paint: (ctx, w, h) => this.layout(ctx, w, h), priority: 10, base: this.ground(),
    })
    this.main = layer
    return layer
  }

  private addFace(layer: SignLayer, z: number, width = this.width, height = this.height, y = 0, x = 0): THREE.Mesh {
    const mesh = new THREE.Mesh(this.track(new THREE.PlaneGeometry(width, height)), this.materials.face(layer.texture))
    mesh.name = `sign:${this.id}:face`
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    this.group.add(mesh)
    return mesh
  }

  private addHardware(parts: MergePart[], cast: boolean): void {
    const geometry = this.track(mergeParts(parts))
    const mesh = new THREE.Mesh(geometry, this.materials.wood)
    mesh.name = `sign:${this.id}:wood`
    mesh.castShadow = cast
    mesh.receiveShadow = true
    this.group.add(mesh)
    this.hardware = mesh
  }

  private buildBoard(): void {
    const { width: W, height: H } = this
    const dpm = this.options.dpm ?? 256
    const layer = this.mainLayer(dpm)
    const leg = this.options.legHeight ?? 0.5
    const faceY = leg + H / 2
    const postW = 0.14
    const parts: MergePart[] = []
    const px = W / 2 + postW / 2 + 0.04
    for (const s of [-1, 1]) {
      parts.push(place(postGeometry({ width: postW, height: leg + H + 0.2, swatch: SWATCH.lightOrange, capSwatch: SWATCH.woodDark }), [s * px, 0, -0.01]))
      parts.push(place(plankGeometry({ width: postW * 1.7, height: 0.1, depth: postW * 1.7, swatch: SWATCH.slate, edge: SWATCH.dark, bevel: 0.025 }), [s * px, 0.05, -0.01]))
    }
    const border = 0.09
    for (const s of [-1, 1]) parts.push(place(plankGeometry({ width: W + 0.2, height: border, depth: 0.1 }), [0, faceY + s * (H / 2 + border / 2 - 0.01), 0]))
    for (const s of [-1, 1]) parts.push(place(plankGeometry({ width: 0.08, height: H, depth: 0.1 }), [s * (W / 2 + 0.03), faceY, 0]))
    parts.push(place(plankGeometry({ width: W + 0.1, height: H + 0.1, depth: 0.05, swatch: BOARD_BACK, edge: SWATCH.dark, bevel: 0.01 }), [0, faceY, -0.04]))
    const nail = nailGeometry({ radius: 0.026, height: 0.02 })
    const nails: [number, number][] = []
    for (const s of [-1, 1]) nails.push([s * px, faceY + H / 2 + 0.2], [s * px, leg + 0.2])
    for (let i = 0; i < 5; i++) {
      const x = ((i + 0.5) / 5 - 0.5) * (W + 0.1)
      nails.push([x, faceY + H / 2 + border / 2 - 0.01], [x, faceY - H / 2 - border / 2 + 0.01])
    }
    for (const [x, y] of nails) parts.push(place(nail, [x, y, 0.05]))
    const bracket = bracketGeometry({ arm: 0.22, thickness: 0.04, depth: 0.03 })
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      // The brace's arms run +X and +Y; turn it so they run in from this corner along both borders.
      const turn = sx < 0 ? (sy < 0 ? 0 : -Math.PI / 2) : (sy > 0 ? Math.PI : Math.PI / 2)
      parts.push(place(bracket, [sx * (W / 2 + 0.075), faceY + sy * (H / 2 + 0.075), 0.05], [0, 0, turn]))
    }
    this.themeHardware(parts, W, H, faceY, px)
    this.addHardware(parts, true)
    this.face = this.addFace(layer, 0.0 + FACE_LIFT)
    this.face.position.set(0, faceY, 0.027)
    const kind = this.emblemKind()
    if (kind) {
      const side = Math.min(H * 0.8, W * 0.34)
      const emblem = this.addLayer({
        name: 'emblem', width: EMBLEM_SIZE, height: EMBLEM_SIZE, live: true, base: TOKENS.woodDark,
        paint: (ctx, w, _h, time) => paintEmblem(ctx, kind, w, time, this.seed),
      })
      this.emblem = emblem
      const quad = this.addFace(emblem, 0.03, side * 0.94, side * 0.94, faceY, W / 2 - H * 0.1 - side / 2)
      quad.name = `sign:${this.id}:emblem`
      quad.position.z = 0.031
    }
    this.setBounds(this.group, new THREE.Vector3(0, faceY, 0), Math.hypot(W / 2 + 0.3, H / 2 + leg / 2 + 0.2))
  }

  /** Posts' neighbours: the theme's vine / rope / chain and its charm. */
  private themeHardware(parts: MergePart[], W: number, H: number, faceY: number, postX: number): void {
    const theme = this.themeValue
    const rand = hashSeed(this.seed)
    if (theme.hardware === 'vine') {
      const path: Vec3[] = []
      for (let i = 0; i <= 8; i++) path.push([-postX - 0.075 + Math.sin(i * 1.3) * 0.035, 0.1 + (i / 8) * (H + 0.5), 0.075 + Math.cos(i * 0.9) * 0.02])
      parts.push(place(vineGeometry(path, { radius: 0.012, leaves: 9, leafSize: 0.12, seed: rand }), [0, 0, 0]))
    } else if (theme.hardware === 'rope' || theme.hardware === 'chain') {
      const swatch = theme.hardware === 'chain' ? SWATCH.silver : SWATCH.khaki
      const top = faceY + H / 2 + 0.05
      for (const s of [-1, 1]) parts.push(place(ropeGeometry([s * (W / 2 - 0.15), top, 0.07], [s * postX, top + 0.22, 0.02], { sag: 0.05, swatch, radius: theme.hardware === 'chain' ? 0.02 : 0.016 })))
    }
    if (theme.charm !== 'none') {
      const x = W / 2 - 0.22, top = faceY - H / 2 - 0.06
      parts.push(place(ropeGeometry([x, top, 0.07], [x, top - 0.14, 0.07], { sag: 0, swatch: SWATCH.khaki, sides: 4, segments: 2 })))
      parts.push(place(charmGeometry(theme.charm, 0.26), [x, top - 0.14, 0.07]))
    }
  }

  private buildPlank(): void {
    const { width: W, height: H } = this
    const dpm = this.options.dpm ?? 320
    const layer = this.mainLayer(dpm)
    const depth = 0.07
    const parts: MergePart[] = [place(plankGeometry({ width: W, height: H, depth, swatch: SWATCH.woodDark, edge: SWATCH.dark, bevel: 0.016 }))]
    const nail = nailGeometry({ radius: 0.022, height: 0.018 })
    for (const s of [-1, 1]) parts.push(place(nail, [s * (W / 2 - H * 0.2), 0, depth / 2]))
    if (this.options.hang === 'rope') {
      const apex: Vec3 = [0, H / 2 + Math.max(0.3, H * 0.9), 0]
      for (const s of [-1, 1]) parts.push(place(ropeGeometry([s * (W / 2 - H * 0.2), H / 2 - 0.01, 0.02], apex, { sag: 0, segments: 3, swatch: SWATCH.khaki })))
      parts.push(place(nail, [apex[0], apex[1] + 0.01, 0.0], [Math.PI / 2, 0, 0], 1.3))
    }
    this.addHardware(parts, false)
    this.face = this.addFace(layer, depth / 2 + FACE_LIFT, W - 0.045, H - 0.045)
    this.setBounds(this.group, new THREE.Vector3(0, this.options.hang === 'rope' ? H * 0.3 : 0, 0), Math.hypot(W / 2, H / 2 + (this.options.hang === 'rope' ? 0.4 : 0.05)))
  }

  private buildLabel(): void {
    const { width: W, height: H } = this
    const dpm = this.options.dpm ?? 320
    const layer = this.mainLayer(dpm)
    const depth = 0.05, bevel = Math.min(0.02, H * 0.12)
    const f = new Facets()
    addBox(f, [0, 0, 0], [W / 2, H / 2, depth / 2], SWATCH.woodDark, bevel)
    const geometry = f.geometry()
    // Front facet: planar UVs across the canvas. Everything else samples the dark canvas border.
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    const uv = geometry.getAttribute('uv')
    const fw = W - bevel * 2, fh = H - bevel * 2
    for (let i = 0; i < position.count; i++) {
      if (normal.getZ(i) > 0.99) uv.setXY(i, 0.5 + position.getX(i) / fw, 0.5 + position.getY(i) / fh)
      else uv.setXY(i, 0.003, 0.5)
    }
    uv.needsUpdate = true
    this.track(geometry)
    // The canvas is sized for the front facet only.
    layer.canvas.width = Math.max(1, Math.round(fw * dpm)); layer.canvas.height = Math.max(1, Math.round(fh * dpm))
    const mesh = new THREE.Mesh(geometry, this.materials.face(layer.texture))
    mesh.name = `sign:${this.id}:label`
    mesh.receiveShadow = false
    this.group.add(mesh)
    this.face = mesh
    this.setBounds(this.group, new THREE.Vector3(), Math.hypot(W / 2, H / 2) + 0.05)
  }

  /* ---- lifecycle ---- */

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.runtime?.remove(this)
    for (const layer of this.layers) layer.dispose()
    for (const geometry of this.geometries) geometry.dispose()
    this.group.removeFromParent()
  }
}

/** The theta (radians) a plane's +Z must be turned by to face a camera orbiting at azimuth `theta`. For billboards. */
export const yawToCamera = (view: { spherical: { theta: number } }): number => view.spherical.theta

/* ------------------------------------------------------------------ the one clock -- */

export interface LayerLike {
  dirty: boolean
  hold: boolean
  live: boolean
  /** The scheduler's clock at the last paint; -Infinity until the first, which is how "never painted" is told. */
  paintedAt: number
  priority: number
  hz(tier: QualityTier, focused: boolean): number
  paint(time: number, at?: number): void
}
export interface SignLike {
  layers: LayerLike[]
  focused: boolean
  state: SignState
  bounds?: SignBounds | null
  animate?: ((time: number) => void) | null
}

export interface RuntimeEnv {
  ticker: { events: { on(name: string, fn: () => void, order?: number): unknown; off(name: string, fn: () => void): unknown }; elapsed: number }
  /** The camera used for the frustum and distance tests. A function is called at every probe (the camera can be replaced). */
  camera?: THREE.Camera | (() => THREE.Camera | null | undefined) | null
  quality?: () => QualityTier
  reduced?: () => boolean
  hidden?: () => boolean
  /** Overrides the built-in visibility test (tests). */
  probe?: (sign: SignLike) => SignState
  /** Metres from the camera within which live layers run. Default 40. */
  nearDistance?: number
  /** The visibility sphere is grown by this factor so a layer repaints just before it comes into view. Default 1.6. */
  margin?: number
  /** Ticker order. The controllers use 11; the default 12 runs after them. */
  order?: number
  /** Milliseconds one tick may spend painting layers that were never painted and are in sight (the first is always painted). Default 3. */
  catchUpMs?: number
}

const PROBE_EVERY = 0.2
/** The camera moving this far (metres, squared) or turning this much (cosine) since the last look asks for the next one at once. */
const JUMP_DISTANCE_SQ = 2.5 * 2.5
const JUMP_TURN = 0.97

const readQuality = (): QualityTier => {
  const q = typeof document !== 'undefined' ? document.body?.dataset?.quality : undefined
  return q === 'low' || q === 'medium' ? q : 'high'
}

/**
 * Has the camera jumped or swung? One watcher per camera, shared by every runtime in the world (each ticks every frame, and
 * a world has half a dozen), so the camera's matrices and the arithmetic are done once a frame instead of once a runtime.
 * It counts epochs: the epoch moves on whenever the camera is 2.5 m or about 14 degrees from where it was at the last
 * change, and a runtime only compares one whole number with the one it saw when it last probed.
 */
class CameraWatch {
  epoch = 0
  private stamp = NaN
  private ready = false
  private readonly eye = new THREE.Vector3()
  private readonly look = new THREE.Vector3()

  /** `now` is the frame's clock: a second runtime asking in the same frame gets the answer of the first. */
  poll(camera: THREE.Camera, now: number): number {
    if (now === this.stamp) return this.epoch
    this.stamp = now
    // Fresh matrices: a view that moved the camera this frame has not been rendered yet, so matrixWorld is last frame's.
    camera.updateWorldMatrix(true, false)
    const e = camera.matrixWorld.elements
    // A camera looks down its own -Z.
    const length = Math.sqrt(e[8] * e[8] + e[9] * e[9] + e[10] * e[10]) || 1
    const lx = -e[8] / length, ly = -e[9] / length, lz = -e[10] / length
    if (!this.ready) {
      this.ready = true
    } else {
      const dx = e[12] - this.eye.x, dy = e[13] - this.eye.y, dz = e[14] - this.eye.z
      if (dx * dx + dy * dy + dz * dz <= JUMP_DISTANCE_SQ && lx * this.look.x + ly * this.look.y + lz * this.look.z >= JUMP_TURN) return this.epoch
      this.epoch++
    }
    this.eye.set(e[12], e[13], e[14])
    this.look.set(lx, ly, lz)
    return this.epoch
  }
}
const watches = new WeakMap<object, CameraWatch>()
const watchOf = (camera: THREE.Camera): CameraWatch => {
  let watch = watches.get(camera)
  if (!watch) watches.set(camera, watch = new CameraWatch())
  return watch
}

export class SignRuntime {
  readonly signs: SignLike[] = []
  /** What happened since construction. `warm` counts paints made out of sight, `catchUps` the ones made because a never-painted layer came into view. */
  readonly stats = { ticks: 0, paints: 0, warm: 0, catchUps: 0, probes: 0 }
  private focusedSign: SignLike | null = null
  private probedAt = -Infinity
  private forceProbe = true
  private disposed = false
  /** Some layer that is not on hold has never been painted: only then is there anything for the catch-up to do. */
  private waiting = true
  /** The camera epoch seen at the last probe (see CameraWatch), and the camera it was seen through. */
  private seenEpoch = -1
  private cameraNow: THREE.Camera | null = null
  /** body.dataset.quality, read at the probe: it only changes when the quality governor steps, and reading it makes a string. */
  private tierNow: QualityTier = 'high'
  private readonly env: RuntimeEnv
  private readonly tickFn = (): void => { this.tick() }
  private reducedQuery: MediaQueryList | null = null
  private fontsOff: (() => void) | null = null
  private readonly frustum = new THREE.Frustum()
  private readonly matrix = new THREE.Matrix4()
  private readonly sphere = new THREE.Sphere()
  private readonly camera = new THREE.Vector3()

  constructor(env: RuntimeEnv, bin?: { add(disposer: () => void): unknown }) {
    this.env = env
    env.ticker.events.on('tick', this.tickFn, env.order ?? 12)
    bin?.add(() => this.dispose())
  }

  add(sign: SignLike): void {
    if (this.signs.includes(sign)) return
    this.signs.push(sign)
    if (sign instanceof Sign) { sign.attach(this); for (const layer of sign.layers) layer.sign = sign }
    this.forceProbe = true
    this.waiting = true
    if (!this.fontsOff) this.fontsOff = onSignFontsLoaded(() => { for (const s of this.signs) for (const l of s.layers) l.dirty = true })
  }

  remove(sign: SignLike): void {
    const i = this.signs.indexOf(sign)
    if (i >= 0) this.signs.splice(i, 1)
    if (this.focusedSign === sign) this.focusedSign = null
    if (sign instanceof Sign) sign.attach(null)
  }

  /** A layer was added to a sign that is already registered: it has never been painted. */
  wake(): void { this.waiting = true }

  /** The sign being looked at (the open Projects board): painted first, at the focus rate, whatever the frustum says. */
  focus(sign: SignLike | null): void {
    if (this.focusedSign) this.focusedSign.focused = false
    this.focusedSign = sign
    if (sign) sign.focused = true
  }

  private isReduced(): boolean {
    if (this.env.reduced) return this.env.reduced()
    if (typeof matchMedia === 'undefined') return false
    this.reducedQuery ??= matchMedia('(prefers-reduced-motion: reduce)')
    return this.reducedQuery.matches
  }

  /** Asks for a fresh visibility test on the next tick, without waiting for the timer (a teleport, a scene change). */
  probeNow(): void { this.forceProbe = true }

  private activeCamera(): THREE.Camera | null {
    const source = this.env.camera
    return (typeof source === 'function' ? source() : source) ?? null
  }

  /**
   * The camera has jumped or swung since the last probe: a map travel, a snap into the board's cinematic. Probing is only
   * every fifth of a second, which is up to a dozen frames of a board in view that the runtime does not yet know is in view.
   */
  private cameraJumped(now: number): boolean {
    if (this.env.probe) return false
    // The camera object is looked up at the probe, not every frame: a host's accessor for it can build a new object per call.
    const camera = this.cameraNow ??= this.activeCamera()
    return camera !== null && watchOf(camera).poll(camera, now) !== this.seenEpoch
  }

  private probeAll(now: number): void {
    this.probedAt = now
    this.forceProbe = false
    this.stats.probes++
    if (!this.env.quality) this.tierNow = readQuality()
    // A layer taken off hold since the last look has never been painted either.
    if (!this.waiting) this.waiting = this.hasUnpainted()
    if (this.env.probe) { for (const sign of this.signs) Object.assign(sign.state, this.env.probe(sign)); return }
    const camera = this.cameraNow = this.activeCamera()
    if (!camera) { for (const sign of this.signs) { sign.state.visible = true; sign.state.near = true; sign.state.distance = 0 } return }
    this.seenEpoch = watchOf(camera).poll(camera, now)
    // Fresh matrices: a view that moved the camera this frame has not been rendered yet, so matrixWorld is last frame's.
    camera.updateWorldMatrix(true, false)
    this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.matrix)
    camera.getWorldPosition(this.camera)
    const margin = this.env.margin ?? 1.6
    const reach = this.env.nearDistance ?? 40
    for (let i = 0; i < this.signs.length; i++) {
      const sign = this.signs[i]
      const bounds = sign.bounds
      if (!bounds) { sign.state.visible = true; sign.state.near = true; sign.state.distance = 0; continue }
      bounds.object.updateWorldMatrix(true, false)
      this.sphere.center.copy(bounds.centre).applyMatrix4(bounds.object.matrixWorld)
      const radius = bounds.radius * bounds.object.matrixWorld.getMaxScaleOnAxis()
      this.sphere.radius = radius * margin
      sign.state.visible = this.frustum.intersectsSphere(this.sphere)
      sign.state.distance = this.sphere.center.distanceTo(this.camera)
      sign.state.near = sign.state.distance - radius < reach
    }
  }

  private hasUnpainted(): boolean {
    for (let i = 0; i < this.signs.length; i++) {
      const layers = this.signs[i].layers
      for (let j = 0; j < layers.length; j++) if (!layers[j].hold && layers[j].paintedAt === -Infinity) return true
    }
    return false
  }

  /**
   * A layer nobody has painted yet shows nothing but its ground (black, for an empty emissive map), so one that is in sight
   * is painted NOW and all of them if need be, ahead of the one-per-frame schedule, up to a small time budget per tick.
   * Warming (below) has normally done it long before anyone could look; this is the guarantee behind it. Once every layer
   * has been painted once there is nothing left to catch up, and this does not run again until a sign or layer is added.
   */
  private catchUp(now: number, reduced: boolean): number {
    const budget = this.env.catchUpMs ?? 3
    let started = 0
    let painted = 0
    let left = false
    // The sign being read (the open board) first, then the rest.
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < this.signs.length; i++) {
        const sign = this.signs[i]
        const first = pass === 0
        if (first !== sign.focused) continue
        const eligible = sign.focused || sign.state.visible
        const layers = sign.layers
        for (let j = 0; j < layers.length; j++) {
          const layer = layers[j]
          if (layer.hold || layer.paintedAt !== -Infinity) continue
          if (!eligible) { left = true; continue }
          if (painted === 0) started = performance.now()
          else if (budget <= 0 || performance.now() - started > budget) return painted
          layer.paint(layer.live && reduced ? STATIC_TIME : now, now)
          this.stats.paints++
          this.stats.catchUps++
          painted++
        }
      }
    }
    // Nothing was out of reach of this pass but out of sight (those are warmed one a tick, and counted again by the probe).
    if (!left) this.waiting = false
    return painted
  }

  /**
   * One scheduling step. In sight, at most ONE layer is painted across every sign (and any that were never painted, see
   * `catchUp`). Out of sight, content that is out of date is painted behind everything else, nearest first, also one per
   * tick and never on a timer: the canvas costs the CPU a fraction of a millisecond and the GPU nothing (a texture is only
   * uploaded by a frame that draws it), and the board is ready the moment it is first seen. Then transform-only animations.
   *
   * It runs in every runtime every frame, so a tick with nothing to do allocates nothing: flags and whole numbers decide,
   * loops are indexed, and the quality tier is read at the probe, not here.
   */
  tick(): boolean {
    if (this.disposed) return false
    const env = this.env
    if (env.hidden ? env.hidden() : typeof document !== 'undefined' && document.hidden) return false
    this.stats.ticks++
    const now = env.ticker.elapsed
    if (this.forceProbe || now - this.probedAt >= PROBE_EVERY || this.cameraJumped(now)) this.probeAll(now)
    const reduced = this.isReduced()
    let painted = this.waiting ? this.catchUp(now, reduced) : 0
    const signs = this.signs
    if (painted === 0) {
      let best: LayerLike | null = null
      let bestScore = -Infinity
      let bestRunning = false
      let bestSeen = false
      for (let i = 0; i < signs.length; i++) {
        const sign = signs[i]
        const focused = sign.focused
        const seen = focused || sign.state.visible
        const running = focused || (seen && sign.state.near)
        const layers = sign.layers
        for (let j = 0; j < layers.length; j++) {
          const layer = layers[j]
          if (layer.hold) continue
          let score: number
          if (!seen) {
            if (!layer.dirty) continue
            score = -1 - Math.min(sign.state.distance, 1e6) * 1e-6
          } else if (layer.dirty) score = 1e9 + layer.priority * 1e5 + (focused ? 5e8 : 0) - sign.state.distance
          else if (layer.live && running && !reduced) {
            // A quarter of a 60 Hz frame of slack, so 10 Hz means every sixth frame instead of every seventh.
            const overdue = now - layer.paintedAt - 1 / layer.hz(env.quality ? env.quality() : this.tierNow, focused) + 0.004
            if (overdue < 0) continue
            score = Math.min(overdue, 1e3) + (focused ? 1e3 : 0)
          } else continue
          if (score > bestScore) { bestScore = score; best = layer; bestRunning = running; bestSeen = seen }
        }
      }
      if (best) {
        // The picture runs only while near and in sight; every other time it is its designated still frame.
        best.paint(best.live && (reduced || !bestRunning) ? STATIC_TIME : now, now)
        this.stats.paints++
        if (!bestSeen) this.stats.warm++
        painted = 1
      }
    }
    if (!reduced) {
      for (let i = 0; i < signs.length; i++) {
        const sign = signs[i]
        if (sign.animate && (sign.focused || (sign.state.visible && sign.state.near))) sign.animate(now)
      }
    }
    return painted > 0
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.env.ticker.events.off('tick', this.tickFn)
    this.fontsOff?.()
    this.signs.length = 0
    this.focusedSign = null
  }
}
