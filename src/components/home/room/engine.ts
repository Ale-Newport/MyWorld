import * as THREE from 'three'
import { ATLAS_SEED, ROOM_CONFIG, type QualityName } from './config'
import { compositionFor, type Composition } from './scene/compositions'
import { buildArchitecture, type BuiltArchitecture } from './scene/architecture'
import { applyLens, fitLens, type Band } from './render/camera'
import { LightingCache } from './render/lighting'
import { createDetailTexture } from './render/textures'
import { fullscreenVert, outputFrag, roomFrag, roomVert } from './render/shaders'
import { blitFrag, depthOnlyFrag, depthOnlyVert } from './render/natureShaders'
import { WallRelief } from './nature/relief'
import { buildBotany, prune, type Botany, type FieldProbe } from './nature/botany'
import { buildLitter, FRAME_ORDER, Vegetation, type VegetationUniforms } from './nature/vegetation'
import { FieldBaker, fieldsToTextures, type SurfaceFields } from './nature/fieldTextures'
import { createLeafAtlas, createMossSheet, type LeafAtlas } from './nature/sprites'
import { sampleSlice, sliceFor, type ReadingField } from './layout/readingField'
import { roomView } from './view'

/* ============================================================
   ROOM ENGINE
   Owns the WebGL context and everything drawn with it. The React
   layer gives it a canvas, a viewport, the measured reading field
   and a growth value; it decides what actually needs redrawing:

   · a new layout class   → rebuild the hall and its plan of growth
   · a new viewport size  → refit the lens, relight
   · a new reading field  → re-prune the plants (cheap)
   · a new growth value   → redraw the surfaces, then the plants
   · an ambient tick      → redraw the plants over the cached room
   · nothing changed      → draw nothing at all

   Nothing heavy runs in one go on the main thread: the procedural
   sheets, the hall and its fields are prepared in stages, each in
   the browser's idle time, so the page above stays responsive while
   the room is being made; the light is accumulated a few dozen
   samples per frame.
   ============================================================ */

export interface EngineOptions {
  quality: QualityName
  onReady?: () => void
  onContextLost?: () => void
  /** A hall has just been built (the first, or for a new layout). */
  onBuilt?: () => void
  /** The browser has given a lost context back. */
  onContextRestored?: () => void
}

interface Built {
  comp: Composition
  arch: BuiltArchitecture
  relief: WallRelief
  plan: Botany
  /** Baked in a worker while the light gathers; null until it lands. */
  fields: SurfaceFields | null
  litter: ReturnType<typeof buildLitter>
}

/* ============================================================
   START-UP, IN PARALLEL

   The first frame is the finished room — light converged, plants
   pruned around the copy — never a partial one; what can be made
   faster is everything before it. So the preparation runs as three
   things at once instead of one queue:

     · the GPU gathers the hall's light from the moment the hall's
       geometry exists (a few milliseconds in);
     · a worker bakes the surface fields (the largest piece of
       arithmetic) at the same time;
     · the main thread builds the plan of growth, the procedural
       sheets and the plants' buffers, and has the shaders compiled,
       in short slices that yield to the page between them.

   The slices yield; they do not wait for the browser to go idle —
   on a busy phone an idle period can take a long time to come, and
   six of them in a row was most of the wait for the first frame.
   ============================================================ */

/** Give the thread back for a moment (input, rendering), then carry on. */
const yieldTask = () =>
  new Promise<void>((resolve) => {
    const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
    if (s?.yield) {
      void s.yield().then(resolve)
      return
    }
    const ch = new MessageChannel()
    ch.port1.onmessage = () => { ch.port1.close(); ch.port2.close(); resolve() }
    ch.port2.postMessage(0)
  })

/** Thrown out of a staged build when the engine is torn down mid-way. */
class Aborted extends Error {}

const pixel = () => {
  const t = new THREE.DataTexture(new Uint8Array([0, 255, 0, 0]), 1, 1, THREE.RGBAFormat)
  t.needsUpdate = true
  return t
}

export class RoomEngine {
  readonly renderer: THREE.WebGLRenderer
  private camera = new THREE.PerspectiveCamera()
  private built: Built | null = null
  private cache: LightingCache | null = null
  private detail: THREE.Texture = pixel()
  private atlas: LeafAtlas | null = null
  private moss: { albedo: THREE.Texture; data: THREE.Texture } = { albedo: pixel(), data: pixel() }
  private roomMesh: THREE.Mesh | null = null
  private depthMesh: THREE.Mesh | null = null
  private roomScene = new THREE.Scene()
  /** The per-frame pass in one render call: the cached room, its
      depth, the plants' shades, the plants (see FRAME_ORDER). */
  private frameScene = new THREE.Scene()
  private outScene = new THREE.Scene()
  private quad = new THREE.PlaneGeometry(2, 2)
  private roomMat: THREE.ShaderMaterial
  private depthMat: THREE.ShaderMaterial
  private blitMat: THREE.ShaderMaterial
  private outMat: THREE.ShaderMaterial
  private roomRT!: THREE.WebGLRenderTarget
  private frameRT!: THREE.WebGLRenderTarget
  private readTex: THREE.DataTexture
  private reading: ReadingField | null = null
  private vegetation: Vegetation | null = null
  private vegUniforms: VegetationUniforms
  private floatable: boolean
  private width = 1
  private height = 1
  private dpr = 1
  private lastDpr = 1
  private growth = -1
  private pendingCanvas: { width: number; height: number; ratio: number } | null = null
  private dirtyRoom = true
  private dirtyFrame = true
  private dirtyPlants = true
  private needsRelight = false
  private readyFired = false
  private disposed = false
  private lost = false
  private swayEnabled = true
  private lastSway = 0
  /** Ambient motion, 0..1, eased in and out. */
  private air = 0
  /** Engine time of the last scroll or resize. */
  private activeAt = 0
  private time = 0
  private samplesPerFrame = 8
  private lensKey = ''
  private draws = 0
  private booted = false
  private busy = false
  private again = false
  private soffitY: number | null = null
  private inset: number | null = null
  private avoid: Band | null = null
  private floorBand: readonly [number, number] | undefined = undefined
  /** Start-up costs, ms (main thread, per stage), for the QA probe. */
  readonly timings: Record<string, number> = {}
  /** Milliseconds since the engine was made at which each start-up milestone was reached (QA probe). */
  readonly milestones: Record<string, number> = {}
  private born = performance.now()
  private baker: FieldBaker
  private compiled = false
  private compiling = false
  quality: QualityName

  constructor(
    readonly canvas: HTMLCanvasElement,
    private options: EngineOptions,
  ) {
    this.quality = options.quality
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      // Only the finished frame is drawn to the canvas, flat.
      depth: false,
      stencil: false,
      powerPreference: 'default',
      preserveDrawingBuffer: false,
    })
    const gl = this.renderer.getContext()
    if (!(gl instanceof WebGL2RenderingContext)) throw new Error('WebGL2 unavailable')
    // The light is accumulated by additive blending into a float
    // image: 32-bit where that can be both rendered to and blended,
    // else 16-bit (blendable wherever it is renderable). With neither
    // there is no room to draw, and the still is shown instead.
    const colorFloat = !!gl.getExtension('EXT_color_buffer_float')
    const colorHalf = colorFloat || !!gl.getExtension('EXT_color_buffer_half_float')
    if (!colorHalf) throw new Error('No renderable float colour buffers')
    this.floatable = colorFloat && !!gl.getExtension('EXT_float_blend')
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = ROOM_CONFIG.light.exposure
    this.renderer.autoClear = false
    canvas.addEventListener('webglcontextlost', this.onLost, false)
    canvas.addEventListener('webglcontextrestored', this.onRestored, false)

    const L = ROOM_CONFIG.light
    this.readTex = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat)
    this.readTex.magFilter = THREE.LinearFilter
    this.readTex.minFilter = THREE.LinearFilter
    this.readTex.needsUpdate = true

    const keyDir = new THREE.Vector3(...L.key.direction).normalize()
    this.roomMat = new THREE.ShaderMaterial({
      vertexShader: roomVert,
      fragmentShader: roomFrag,
      side: THREE.FrontSide,
      uniforms: {
        tIrr: { value: null },
        tNormal: { value: null },
        tDepth: { value: null },
        tDetail: { value: this.detail },
        uRes: { value: new THREE.Vector2(1, 1) },
        uKeyDir: { value: keyDir },
        uKeyColor: { value: new THREE.Vector3(...L.key.color).multiplyScalar(L.key.intensity) },
        uBounce: { value: new THREE.Vector3(...L.bounce.color).multiplyScalar(L.bounce.intensity * 1.4) },
        uSkyTint: { value: new THREE.Vector3(...L.sky.color).multiplyScalar(L.sky.intensity * 1.6) },
        uSlab: { value: new THREE.Vector3(0.8, 0, 0) },
        uGrowth: { value: 0 },
        uTakeover: { value: 0 },
        tWallField: { value: null },
        tFloorField: { value: null },
        tWeather: { value: null },
        tMossAlbedo: { value: this.moss.albedo },
        tMossData: { value: this.moss.data },
        tRead: { value: this.readTex },
        uWallRect: { value: new THREE.Vector4() },
        uFloorRect: { value: new THREE.Vector4() },
        uReadDelay: { value: ROOM_CONFIG.clearance.mossDelay },
        uSlice: { value: new THREE.Vector3(1, 1, 1) },
        uWallScreen: { value: new THREE.Vector2(0, 0.1) },
        uSoffitH: { value: 4 },
        uMossTile: { value: ROOM_CONFIG.moss.tile },
        uDebugIrr: { value: 0 },
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
      },
    })
    this.depthMat = new THREE.ShaderMaterial({ vertexShader: depthOnlyVert, fragmentShader: depthOnlyFrag, colorWrite: false })
    this.blitMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: blitFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: { tColor: { value: null } },
    })
    this.outMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: outputFrag,
      depthTest: false,
      depthWrite: false,
      uniforms: { tColor: { value: null }, tRead: { value: this.readTex }, uDebug: { value: 0 }, uDither: { value: 1 / 255 } },
    })
    this.baker = new FieldBaker(this.pause)
    this.makeTargets()
    for (const [scene, mat, order] of [[this.frameScene, this.blitMat, FRAME_ORDER.room], [this.outScene, this.outMat, 0]] as const) {
      const m = new THREE.Mesh(this.quad, mat)
      m.frustumCulled = false
      m.renderOrder = order
      scene.add(m)
    }
    this.vegUniforms = {
      tIrr: { value: null },
      uRes: { value: new THREE.Vector2(1, 1) },
      uKeyDir: { value: keyDir.clone() },
      uKeyDirV: { value: keyDir.clone() },
      uKeyColor: { value: new THREE.Vector3(...L.key.color).multiplyScalar(L.key.intensity) },
      uGrowth: { value: 0 },
      uTime: { value: 0 },
      uSway: { value: 0 },
      uSwayAmp: { value: ROOM_CONFIG.vines.swayAmplitude },
      uTakeover: { value: 0 },
    }
  }

  /** The two multisampled passes' targets, for the current tier. */
  private makeTargets() {
    this.roomRT?.dispose()
    this.frameRT?.dispose()
    const q = ROOM_CONFIG.quality[this.quality]
    // Each pass needs depth while it draws; nothing reads it after,
    // so it is never resolved out of the multisampled buffer.
    const target = () =>
      new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: q.msaa, depthBuffer: true, resolveDepthBuffer: false })
    this.roomRT = target()
    this.frameRT = target()
    if (this.cache) {
      const size = this.bufferSize()
      this.roomRT.setSize(size.x, size.y)
      this.frameRT.setSize(size.x, size.y)
    }
    this.blitMat.uniforms.tColor.value = this.roomRT.texture
    this.outMat.uniforms.tColor.value = this.frameRT.texture
    this.dirtyRoom = true
    this.dirtyFrame = true
  }

  private onLost = (e: Event) => {
    e.preventDefault()
    this.lost = true
    this.options.onContextLost?.()
  }

  private onRestored = () => {
    if (!this.disposed) this.options.onContextRestored?.()
  }

  /** A yield, or an abort if the engine was torn down meanwhile. */
  private pause = async () => {
    await yieldTask()
    if (this.disposed) throw new Aborted()
  }

  private mark(name: string) {
    if (this.milestones[name] !== undefined) return
    this.milestones[name] = Math.round(performance.now() - this.born)
    try { performance.mark(`room:${name}`) } catch { /* marks are a courtesy */ }
  }

  private lap(key: string, since: number) {
    this.timings[key] = Math.round(performance.now() - since)
    return performance.now()
  }

  /* ---- preparation --------------------------------------------- */

  /** The procedural sheets, each in its own idle slice. */
  private async boot() {
    await yieldTask()
    if (this.disposed) return
    let t = performance.now()
    const detail = createDetailTexture(256, ROOM_CONFIG.seed)
    t = this.lap('detail', t)
    await yieldTask()
    if (this.disposed) return detail.dispose()
    t = performance.now()
    this.atlas = createLeafAtlas(ATLAS_SEED)
    t = this.lap('leafAtlas', t)
    await yieldTask()
    if (this.disposed) return
    t = performance.now()
    const M = ROOM_CONFIG.moss
    const moss = createMossSheet(512, ROOM_CONFIG.seed ^ 0x0e05, M.tile, M.tuftDensity, M.tuftSize)
    this.lap('mossSheet', t)
    this.detail.dispose()
    this.moss.albedo.dispose()
    this.moss.data.dispose()
    this.detail = detail
    this.moss = moss
    const u = this.roomMat.uniforms
    u.tDetail.value = detail
    u.tMossAlbedo.value = moss.albedo
    u.tMossData.value = moss.data
    this.booted = true
    this.mark('booted')
  }

  /** The hall and its plan of growth for a layout class, in stages (see START-UP, IN PARALLEL). */
  private async rebuild(comp: Composition) {
    await yieldTask()
    if (this.disposed) return
    let t = performance.now()
    const arch = buildArchitecture(comp.plan, ROOM_CONFIG.seed)
    const relief = new WallRelief(comp.plan, arch)
    t = this.lap('architecture', t)
    // The fields go to the worker now and come back while the rest is made.
    const baking = this.baker.bake(comp.plan, arch.levels.soffit, comp.camera.distance, ROOM_CONFIG.seed)
    await yieldTask()
    if (this.disposed) return arch.geometry.dispose()
    t = performance.now()
    const plan = buildBotany(comp.plan, relief, ROOM_CONFIG.seed)
    const litter = buildLitter(comp.plan, ROOM_CONFIG.seed, ROOM_CONFIG.weather.litter)
    t = this.lap('botany', t)
    // Swap in the new hall in one step — without its fields yet: the
    // light needs only the geometry, so it starts gathering now.
    this.disposeBuilt()
    const built: Built = { comp, arch, relief, plan, fields: null, litter }
    this.built = built
    const q = ROOM_CONFIG.quality[this.quality]
    this.cache = new LightingCache(this.renderer, arch.geometry, q, this.floatable)
    this.roomMesh = new THREE.Mesh(arch.geometry, this.roomMat)
    this.roomMesh.frustumCulled = false
    this.roomScene.add(this.roomMesh)
    this.depthMesh = new THREE.Mesh(arch.geometry, this.depthMat)
    this.depthMesh.frustumCulled = false
    this.depthMesh.renderOrder = FRAME_ORDER.depth
    this.frameScene.add(this.depthMesh)
    const u = this.roomMat.uniforms
    const s = comp.plan.slab
    u.uSlab.value.set(s, -Math.ceil(comp.plan.width / 2 / s) * s, 0)
    u.uSoffitH.value = arch.levels.soffit
    this.dirtyPlants = true
    this.needsRelight = true
    this.mark('hall')
    this.options.onBuilt?.()
    // The procedural sheets (first time only), then the plants' buffers.
    if (!this.booted) await this.boot()
    if (this.disposed || this.built !== built) return
    await yieldTask()
    if (this.disposed || this.built !== built) return
    this.prepareVegetation()
    // Programs compile while the fields are still being baked.
    void this.compileAll()
    let raw
    try {
      t = performance.now()
      raw = await baking
      this.lap('fields', t)
    } catch (e) {
      if (e instanceof Aborted) return
      throw e
    }
    if (this.disposed || this.built !== built) return
    const fields = fieldsToTextures(raw)
    built.fields = fields
    u.tWallField.value = fields.wall
    u.tFloorField.value = fields.floor
    u.tWeather.value = fields.weather
    u.uWallRect.value.copy(fields.wallRect)
    u.uFloorRect.value.copy(fields.floorRect)
    this.dirtyRoom = true
    this.mark('fields')
  }

  /** The plants' buffers for this hall and tier (pruning comes later, against the copy). */
  private prepareVegetation() {
    const b = this.built
    if (!b || !this.atlas || this.vegetation) return
    const t0 = performance.now()
    const q = ROOM_CONFIG.quality[this.quality]
    this.vegetation = new Vegetation(b.plan, b.litter, this.atlas, this.vegUniforms, q)
    this.vegetation.setWild(this.takeover > 0)
    for (const m of this.vegetation.meshes) this.frameScene.add(m)
    this.lap('vegetation', t0)
    this.compiled = false
  }

  /** Every program the first frame will use, compiled before it is drawn (in parallel where the driver can). */
  private async compileAll() {
    if (this.compiling || this.compiled || this.disposed) return
    this.compiling = true
    const t0 = performance.now()
    try {
      // Each scene is compiled for the target it is drawn into: the two
      // passes render to linear float targets, the last one to the
      // canvas, and a program compiled for the wrong one is simply
      // compiled again at the first draw.
      const r = this.renderer
      const previous = r.getRenderTarget()
      r.setRenderTarget(this.roomRT)
      const room = r.compileAsync(this.roomScene, this.camera)
      r.setRenderTarget(this.frameRT)
      const frame = r.compileAsync(this.frameScene, this.camera)
      r.setRenderTarget(null)
      const out = r.compileAsync(this.outScene, this.camera)
      r.setRenderTarget(previous)
      await Promise.all([room, frame, out])
      this.compiled = true
      this.lap('compile', t0)
      this.mark('compiled')
    } catch {
      // Compiling at first draw instead is slower, never wrong.
      this.compiled = true
    } finally {
      this.compiling = false
    }
  }

  /** Bring the hall in line with the viewport, one job at a time. */
  private schedule() {
    if (this.busy) {
      this.again = true
      return
    }
    this.busy = true
    void this.sync()
      .catch((e) => {
        if (!(e instanceof Aborted)) console.error('[room]', e)
      })
      .finally(() => {
        this.busy = false
        if (this.again && !this.disposed) {
          this.again = false
          this.schedule()
        }
      })
  }

  private async sync() {
    if (this.disposed) return
    const comp = compositionFor(this.width, this.height)
    // A new layout class: a new hall (which asks for its own light).
    // The same class at a new size: the same hall, relit for it.
    if (!this.built || comp.id !== this.built.comp.id) await this.rebuild(comp)
    else this.needsRelight = true
  }

  /* ---- inputs ---------------------------------------------------- */

  /** CSS size of the canvas and the device pixel ratio to use. */
  setViewport(width: number, height: number, dpr: number) {
    if (this.disposed) return
    this.lastDpr = dpr
    const ratio = this.ratioFor(width, height, dpr)
    if (width === this.width && height === this.height && ratio === this.dpr && this.built) return
    this.activeAt = this.time
    this.width = width
    this.height = height
    this.dpr = ratio
    // The canvas itself is resized only when the new light is ready
    // and the first frame at the new size is drawn (see frame): until
    // then the browser keeps showing the last frame, stretched, rather
    // than a cleared, empty canvas.
    this.pendingCanvas = { width, height, ratio }
    this.schedule()
  }

  /**
   * Step down one quality tier after a sustained run of slow frames.
   * The hall, its light and its plants are the same; fewer pixels,
   * no air moving. Returns false at the lowest tier.
   */
  demote(): boolean {
    if (this.disposed || this.quality === 'low') return false
    const before = ROOM_CONFIG.quality[this.quality]
    this.quality = this.quality === 'high' ? 'medium' : 'low'
    const q = ROOM_CONFIG.quality[this.quality]
    if (q.msaa !== before.msaa) this.makeTargets()
    // Fewer leaves; their edges follow the new MSAA setting.
    this.dropVegetation()
    this.dirtyPlants = true
    this.dirtyRoom = true
    const ratio = this.ratioFor(this.width, this.height, this.lastDpr)
    if (ratio !== this.dpr) {
      // Fewer pixels: the light is re-accumulated for them, with the
      // lower tier's sampling. Until it is ready the last frame stays.
      this.dpr = ratio
      this.pendingCanvas = { width: this.width, height: this.height, ratio }
      if (this.built && this.cache) {
        this.cache.dispose()
        this.cache = new LightingCache(this.renderer, this.built.arch.geometry, q, this.floatable)
        this.needsRelight = true
      }
    }
    return true
  }

  private ratioFor(width: number, height: number, dpr: number) {
    const q = ROOM_CONFIG.quality[this.quality]
    const cap = Math.sqrt((ROOM_CONFIG.maxMegapixels * 1e6) / Math.max(1, width * height))
    return Math.max(0.5, Math.min(dpr, q.dpr, cap))
  }

  /** The measured reading field (viewport space). */
  setReadingField(field: ReadingField) {
    const r = this.reading
    if (r && r.signature === field.signature && r.gw === field.gw && r.gh === field.gh && r.ends.join() === field.ends.join()) return
    this.reading = field
    // Four time slices in four channels, bottom row first so the
    // shaders can index by gl_FragCoord: everything still to come
    // (R), from the third chapter on (G), from the fourth (B), and
    // from the fifth (A) — growth picks its channel by its birth.
    const { gw, gh, slices, ends } = field
    const pick = [0, Math.min(2, slices.length - 1), Math.min(3, slices.length - 1), Math.min(4, slices.length - 1)]
    const px = new Uint8Array(gw * gh * 4)
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const src = (gh - 1 - y) * gw + x
        const k = (y * gw + x) * 4
        for (let c = 0; c < 4; c++) px[k + c] = Math.round(Math.min(1, slices[pick[c]][src]) * 255)
      }
    }
    this.readTex.dispose()
    this.readTex = new THREE.DataTexture(px, gw, gh, THREE.RGBAFormat)
    this.readTex.magFilter = THREE.LinearFilter
    this.readTex.minFilter = THREE.LinearFilter
    this.readTex.needsUpdate = true
    const u = this.roomMat.uniforms
    u.tRead.value = this.readTex
    this.outMat.uniforms.tRead.value = this.readTex
    u.uSlice.value.set(ends[1] ?? 1, ends[2] ?? 1, ends[3] ?? 1)
    this.dirtyPlants = true
    this.dirtyRoom = true
  }

  setGrowth(g: number) {
    if (Math.abs(g - this.growth) < 1e-5) return
    this.growth = g
    this.roomMat.uniforms.uGrowth.value = g
    this.vegUniforms.uGrowth.value = g
    this.dirtyRoom = true
    this.activeAt = this.time
  }

  /**
   * The portal's takeover, 0..1: as the visitor pushes past the end,
   * the room stops keeping clear of the copy (it is about to be
   * covered anyway) and goes further over — every held-back stem and
   * leaf comes in, and the moss and damp advance.
   */
  setTakeover(t: number) {
    const v = Math.min(1, Math.max(0, t))
    // Tiny steps are skipped, but the ends are always reached exactly.
    if (v === this.takeover || (Math.abs(v - this.takeover) < 1e-4 && v !== 0 && v !== 1)) return
    this.takeover = v
    this.roomMat.uniforms.uTakeover.value = v
    this.vegUniforms.uTakeover.value = v
    this.vegetation?.setWild(v > 0)
    this.dirtyRoom = true
    this.activeAt = this.time
  }

  private takeover = 0

  /**
   * Centre the architrave's plain fascia on a band of the screen (the
   * HUD's row, fractions of the height), pin the pilasters' inner
   * edges at `inset`, and keep the wall's foot off the given rows of
   * low copy. The fascia's size on screen depends on the lens, which
   * depends on where the soffit is, so this settles in a few
   * fixed-point steps. A no-op until a hall is built (it is called
   * again from `onBuilt`).
   */
  setFasciaBand(top: number, bottom: number, inset?: number, rows?: Array<[number, number]>) {
    const b = this.built
    if (!b || this.width < 2) return
    // A hall for another layout class is on its way; it calls back.
    if (compositionFor(this.width, this.height).id !== b.comp.id) return
    if (inset !== undefined) this.inset = Math.min(0.08, Math.max(0.004, inset))
    this.avoid = rows ? { rows, px: 1 / this.height } : null
    const comp = b.comp
    const soffit = b.arch.levels.soffit
    const aspect = this.width / this.height
    const { distance: Z, eye } = comp.camera
    // The fascia's face stands 0.14 m proud of the wall, so it sits a
    // little higher on screen than the wall line its soffit meets:
    // project the face itself.
    const face = 0.14
    const fascia = 0.19
    const centre = (top + bottom) / 2
    const lensAt = (y: number) => fitLens(comp, soffit, aspect, y, this.inset ?? undefined, this.avoid ?? undefined, this.floorBand)
    const screenY = (h: number, y: number, z: number) => {
      const lens = lensAt(y)
      const ndc = ((h - eye) / (Z - z)) / lens.ty - lens.shift
      return 0.5 - ndc / 2
    }
    let y = bottom + 0.01
    for (let i = 0; i < 8; i++) y += centre - screenY(soffit + fascia / 2, y, face)
    // Where the fascia is too small on screen to hold the row with a
    // margin (a short landscape screen), the entablature goes up out
    // of the way instead: its soffit just above the row, so the HUD
    // reads off the plain wall below.
    const fasciaPx = (screenY(soffit, y, face) - screenY(soffit + fascia, y, face)) * this.height
    const bandPx = (bottom - top) * this.height
    if (fasciaPx < bandPx + 8) {
      y = top - 12 / this.height
      for (let i = 0; i < 6; i++) y += top - 12 / this.height - screenY(soffit, y, 0)
    }
    this.soffitY = Math.min(0.2, Math.max(-0.05, y))
    // Relight only if the camera itself moves: rows of copy shifting
    // by a pixel or two usually leave the fitted lens where it was.
    if (this.lensKeyFor(fitLens(comp, soffit, aspect, this.soffitY, this.inset ?? undefined, this.avoid ?? undefined, this.floorBand)) !== this.lensKey) this.needsRelight = true
  }

  /**
   * The fallback stills' framing. A still is scaled to screens whose
   * copy it was never fitted to, so nothing dark may stand where a
   * HUD might: the entablature goes just out of the top of the frame,
   * the pilasters stay pinned at `inset`, and the wall's foot falls
   * wherever that leaves it.
   */
  frameForStill(inset: number) {
    this.inset = Math.min(0.08, Math.max(0.004, inset))
    this.soffitY = -0.012
    this.avoid = null
    this.floorBand = [0, 1]
    this.needsRelight = true
  }

  private lensKeyFor(lens: { ty: number; shift: number }) {
    return `${(this.width / this.height).toFixed(5)}|${lens.ty.toFixed(6)}|${lens.shift.toFixed(6)}`
  }

  /** Development aid: draw the reading field or the light over the room. */
  setDebug(mode: 'field' | 'irradiance' | null) {
    this.outMat.uniforms.uDebug.value = mode === 'field' ? 1 : 0
    this.roomMat.uniforms.uDebugIrr.value = mode === 'irradiance' ? 1 : 0
    this.dirtyRoom = true
    this.dirtyFrame = true
  }

  setSway(enabled: boolean) {
    if (enabled === this.swayEnabled) return
    this.swayEnabled = enabled
    if (!enabled) {
      // Still at once (reduced motion, or something covers the page);
      // when it is allowed again the air eases back in.
      this.air = 0
      this.vegUniforms.uSway.value = 0
      this.dirtyFrame = true
    }
  }

  /* ---- drawing --------------------------------------------------- */

  /** Drawing-buffer size the current viewport will have. */
  private bufferSize() {
    return new THREE.Vector2(Math.floor(this.width * this.dpr), Math.floor(this.height * this.dpr))
  }

  private relight() {
    const b = this.built
    if (!b || !this.cache) return
    const aspect = this.width / this.height
    const lens = fitLens(b.comp, b.arch.levels.soffit, aspect, this.soffitY ?? undefined, this.inset ?? undefined, this.avoid ?? undefined, this.floorBand)
    applyLens(this.camera, lens, aspect)
    this.lensKey = this.lensKeyFor(lens)
    roomView.set({ lens: { ...lens, position: lens.position.clone() }, aspect, distance: b.comp.camera.distance, foliage: b.comp.plan.foliage })
    const size = this.bufferSize()
    // Light is accumulated a few samples a frame; how many depends on
    // how many pixels each sample has to touch.
    const q = ROOM_CONFIG.quality[this.quality]
    this.samplesPerFrame = Math.max(4, Math.min(q.samplesPerFrame, Math.round(ROOM_CONFIG.samplePixelsPerFrame / (size.x * size.y))))
    const W = b.comp.plan.width
    const bounds = new THREE.Box3(
      new THREE.Vector3(-W / 2 - 0.6, -0.2, -1.2),
      new THREE.Vector3(W / 2 + 0.6, b.comp.plan.height + 0.2, Math.min(7.5, b.comp.camera.distance)),
    )
    this.cache.begin(this.camera, size.x, size.y, bounds)
    this.roomRT.setSize(size.x, size.y)
    this.frameRT.setSize(size.x, size.y)
    const u = this.roomMat.uniforms
    u.tIrr.value = this.cache.irradiance.texture
    u.tNormal.value = this.cache.gbuffer.texture
    u.tDepth.value = this.cache.gbuffer.depthTexture
    u.uRes.value.set(size.x, size.y)
    u.uInvProj.value.copy(this.camera.projectionMatrixInverse)
    u.uCamWorld.value.copy(this.camera.matrixWorld)
    // Where the back wall's heights land on screen (it faces the lens
    // square, so this is linear in height).
    this.camera.updateMatrixWorld()
    const v = (h: number) => new THREE.Vector3(0, h, 0).project(this.camera).y * 0.5 + 0.5
    u.uWallScreen.value.set(v(0), v(1) - v(0))
    this.vegUniforms.tIrr.value = this.cache.irradiance.texture
    this.vegUniforms.uRes.value.set(size.x, size.y)
    // Pruning depends on the lens (screen positions), so re-plan.
    this.dirtyPlants = true
    this.dirtyRoom = true
  }

  /**
   * Re-prune the fixed plan of growth against the reading field. The
   * hall's vegetation buffers are built once (for its tier); pruning
   * only rewrites how far each stem grows and which leaves it keeps.
   */
  private replant() {
    const b = this.built
    if (!b || !this.atlas) return
    if (!this.vegetation) this.prepareVegetation()
    if (!this.vegetation) return
    const field = this.reading
    const cam = this.camera
    const ty = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))
    const v = new THREE.Vector3()
    const probe: FieldProbe = {
      at: (p, radius, birth) => {
        if (!field) return 0
        const data = sliceFor(field, birth)
        v.copy(p).project(cam)
        const u0 = v.x * 0.5 + 0.5
        const v0 = 0.5 - v.y * 0.5
        const depth = Math.max(0.5, cam.position.z - p.z)
        const rv = radius / (2 * depth * ty)
        const ru = rv / cam.aspect
        let m = sampleSlice(field, data, u0, v0)
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2
          m = Math.max(m, sampleSlice(field, data, u0 + Math.cos(a) * ru, v0 + Math.sin(a) * rv))
        }
        return m
      },
    }
    const t1 = performance.now()
    const limit = ROOM_CONFIG.clearance.leafLimit
    const pruning = prune(b.plan, probe, limit, b.comp.plan.foliage)
    const litter = Uint8Array.from(b.litter, (l) => (probe.at(l.position, l.size, l.birth) <= limit ? 1 : 0))
    this.vegetation.applyPrune(pruning, litter)
    this.lap('replant', t1)
    this.dirtyPlants = false
    this.dirtyFrame = true
  }

  private dropVegetation() {
    if (!this.vegetation) return
    for (const m of this.vegetation.meshes) this.frameScene.remove(m)
    this.vegetation.dispose()
    this.vegetation = null
  }

  /** One tick of the shared frame loop. Returns true if it drew. */
  frame(dt: number): boolean {
    if (this.disposed || this.lost || !this.built || !this.cache) return false
    if (this.needsRelight) {
      this.needsRelight = false
      this.relight()
    }
    this.time += dt
    if (!this.cache.complete) {
      // Before the first frame nothing else is being drawn: the light
      // may take a larger share of each frame and arrive sooner.
      const first = !this.readyFired
      this.cache.step(first ? 12 : 8, first ? Math.round(this.samplesPerFrame * 1.6) : this.samplesPerFrame)
      if (!this.cache.complete) return false
      this.mark('light')
      this.dirtyRoom = true
    }
    // The first frame waits for every part of the finished room — the
    // fields, the sheets, the plants pruned around the measured copy —
    // so what appears first is what stays.
    if (!this.readyFired && (!this.built.fields || !this.booted || !this.reading || !this.vegetation)) return false
    if (!this.readyFired && !this.compiled) {
      void this.compileAll()
      if (this.compiling) return false
    }
    if (this.dirtyPlants) this.replant()
    // Ambient air, capped in rate, only where something can move, and
    // only while the visitor is doing something: it settles a few
    // seconds after the last scroll or resize, so a page left open
    // costs nothing.
    const q = ROOM_CONFIG.quality[this.quality]
    const stirred = this.swayEnabled && q.sway && !!this.vegetation?.swaying && this.growth > 0.1 && this.time - this.activeAt < ROOM_CONFIG.swayLinger
    const want = stirred ? 1 : 0
    let sway = false
    if ((want > 0 || this.air > 0) && this.time - this.lastSway >= 1 / ROOM_CONFIG.swayFps) {
      const step = Math.min(0.1, (this.time - this.lastSway) / 2)
      this.lastSway = this.time
      this.air = want > this.air ? Math.min(1, this.air + step) : Math.max(0, this.air - step)
      this.vegUniforms.uTime.value = this.time
      this.vegUniforms.uSway.value = this.air
      sway = true
    }
    if (!this.dirtyRoom && !this.dirtyFrame && !sway) return false
    const r = this.renderer
    if (this.dirtyRoom) {
      r.setRenderTarget(this.roomRT)
      r.setClearColor(0xe9e6df, 1)
      r.clear(true, true, false)
      r.render(this.roomScene, this.camera)
      this.dirtyRoom = false
    }
    // The plants over the cached room, in one pass (see FRAME_ORDER).
    r.setRenderTarget(this.frameRT)
    r.clear(true, true, false)
    r.render(this.frameScene, this.camera)
    r.setRenderTarget(null)
    if (this.pendingCanvas) {
      const p = this.pendingCanvas
      r.setPixelRatio(p.ratio)
      r.setSize(p.width, p.height, false)
      this.pendingCanvas = null
    }
    r.clear(true, true, false)
    r.render(this.outScene, this.camera)
    this.dirtyFrame = false
    this.draws++
    if (!this.readyFired) {
      this.readyFired = true
      this.mark('ready')
      this.options.onReady?.()
    }
    return true
  }

  /** Read-only probe for QA scripts (`window.__room()`). */
  get state() {
    return {
      composition: this.built?.comp.id,
      quality: this.quality,
      dpr: this.dpr,
      growth: this.growth,
      takeover: this.takeover,
      cache: this.cache?.progress,
      field: this.reading ? `${this.reading.gw}x${this.reading.gh}` : null,
      stems: `${this.vegetation?.kept.stems ?? 0}/${this.built?.plan.stems.length ?? 0}`,
      leaves: this.vegetation?.kept.leaves ?? 0,
      air: +this.air.toFixed(2),
      plannedLeaves: this.built?.plan.leaves.length ?? 0,
      soffitY: this.soffitY,
      inset: this.inset,
      avoidRows: this.avoid?.rows.map((r) => r.map((v) => +v.toFixed(3))),
      fovY: +this.camera.fov.toFixed(2),
      lost: this.lost,
      draws: this.draws,
      milestones: this.milestones,
      timings: this.timings,
      gpu: {
        geometries: this.renderer.info.memory.geometries,
        textures: this.renderer.info.memory.textures,
        programs: this.renderer.info.programs?.length ?? 0,
      },
    }
  }

  private disposeBuilt() {
    if (!this.built) return
    if (this.roomMesh) this.roomScene.remove(this.roomMesh)
    if (this.depthMesh) this.frameScene.remove(this.depthMesh)
    this.dropVegetation()
    this.built.arch.geometry.dispose()
    this.built.fields?.wall.dispose()
    this.built.fields?.floor.dispose()
    this.built.fields?.weather.dispose()
    this.cache?.dispose()
    this.cache = null
    this.built = null
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.canvas.removeEventListener('webglcontextlost', this.onLost, false)
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored, false)
    this.disposeBuilt()
    this.baker.dispose()
    for (const m of [this.roomMat, this.depthMat, this.blitMat, this.outMat]) m.dispose()
    this.roomRT.dispose()
    this.frameRT.dispose()
    this.detail.dispose()
    this.readTex.dispose()
    this.atlas?.albedo.dispose()
    this.atlas?.normal.dispose()
    this.moss.albedo.dispose()
    this.moss.data.dispose()
    this.quad.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }
}
