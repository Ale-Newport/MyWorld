import * as THREE from 'three'
import { ATLAS_SEED, ROOM_CONFIG } from '../config'
import { applyLens } from '../render/camera'
import { fullscreenVert } from '../render/shaders'
import { createLeafAtlas, type LeafAtlas } from '../nature/sprites'
import { Vegetation, type VegetationUniforms } from '../nature/vegetation'
import type { RoomView } from '../view'
import { canopyPlanner } from './plan'
import { canopyLeafFrag, canopyOutFrag, canopyStemFrag } from './shaders'

/* ============================================================
   CANOPY RENDERER
   Its own small WebGL context on a transparent canvas, because the
   canopy has to stand IN FRONT of the page (the room's canvas is
   behind it) and has to outlive the homepage (it lives in the root
   layout, under which the route changes). It draws only while the
   charge changes; once the charge is full it hands its last frame
   to plain canvases, one per depth band and side, and lets its
   context go — the world needs the GPU, and the opening is then the
   compositor's job alone (see CanopyCover).

   Nothing it prepares runs as one long task: the plan, each layer,
   and the programs' compilation are cut into slices of idle time,
   so building it near the foot of the page never stalls the scroll
   that is bringing the reader there. A re-plan (a new lens) is
   built the same way beside the canopy on screen, and swapped in.
   ============================================================ */

/** Pixel budget: a transitional layer, mostly soft and large. */
const MAX_PIXELS = 2.2e6
const MAX_PIXELS_LOW = 1e6

interface Layer {
  veg: Vegetation
  band: number
  /** 0 left, 1 right. */
  side: number
  dark: number
  uDark: { value: number }
}

/** One frozen piece of the canopy, for the cover to part. */
export interface CanopyShot {
  canvas: HTMLCanvasElement
  band: number
  side: number
}

/** Resolves in an idle moment; `timeRemaining` says how much of it is left. */
export type Pause = () => Promise<{ timeRemaining(): number }>

export class CanopyRenderer {
  readonly canvas = document.createElement('canvas')
  private renderer: THREE.WebGLRenderer
  private camera = new THREE.PerspectiveCamera()
  private scene = new THREE.Scene()
  private outScene = new THREE.Scene()
  private quad = new THREE.PlaneGeometry(2, 2)
  private outMat: THREE.ShaderMaterial
  private rt: THREE.WebGLRenderTarget
  private atlas: LeafAtlas
  private uniforms: VegetationUniforms
  private ambient: THREE.Vector3
  private layers: Layer[] = []
  private leafShare: number
  private maxPixels: number
  private charge = -1
  private viewKey = ''
  private wanted: RoomView | null = null
  /** Work still to do to have the wanted view's canopy on screen. */
  private pending: Array<() => void> = []
  private building: Layer[] = []
  private working = false
  private onLostCallback?: () => void
  /** The plants are built and their programs compiled: it can draw. */
  ready = false
  lost = false
  private disposed = false

  constructor(opts: { budget: number; onLost?: () => void }) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'default',
      preserveDrawingBuffer: false,
    })
    const gl = this.renderer.getContext()
    if (!(gl instanceof WebGL2RenderingContext)) {
      this.renderer.dispose()
      throw new Error('WebGL2 unavailable')
    }
    this.onLostCallback = opts.onLost
    this.canvas.addEventListener('webglcontextlost', this.onLost, false)
    const r = this.renderer
    r.outputColorSpace = THREE.SRGBColorSpace
    r.toneMapping = THREE.NeutralToneMapping
    r.toneMappingExposure = ROOM_CONFIG.light.exposure
    r.autoClear = false
    r.setClearColor(0x000000, 0)

    // A thinner canopy, and fewer pixels, on a device judged slow.
    this.leafShare = Math.min(1, opts.budget)
    this.maxPixels = opts.budget < 1 ? MAX_PIXELS_LOW : MAX_PIXELS
    // No depth and no multisampling: the canopy is painted back to front
    // (see layerSteps), every leaf blending over what is behind it with
    // its own soft edge — the edges need no coverage samples, and a few
    // layers of blended leaves over the whole screen are fill enough.
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false })
    this.outMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: canopyOutFrag,
      uniforms: { tColor: { value: this.rt.texture } },
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    })
    const out = new THREE.Mesh(this.quad, this.outMat)
    out.frustumCulled = false
    this.outScene.add(out)

    this.atlas = createLeafAtlas(ATLAS_SEED)
    // Premultiplied on upload, so the filtered and mipmapped edges of
    // the blades blend true over the page (the room's leaves, drawn
    // opaque, keep their own straight copy).
    this.atlas.albedo.premultiplyAlpha = true
    const L = ROOM_CONFIG.light
    const keyDir = new THREE.Vector3(...L.key.direction).normalize()
    const C = ROOM_CONFIG.canopy
    this.ambient = new THREE.Vector3(...L.sky.color).multiplyScalar(C.ambient)
    this.uniforms = {
      tIrr: { value: null },
      uRes: { value: new THREE.Vector2(1, 1) },
      uKeyDir: { value: keyDir },
      uKeyDirV: { value: keyDir.clone() },
      uKeyColor: { value: new THREE.Vector3(...L.key.color).multiplyScalar(L.key.intensity * C.key) },
      uGrowth: { value: 0 },
      uTime: { value: 0 },
      uSway: { value: 1 },
      uSwayAmp: { value: ROOM_CONFIG.vines.swayAmplitude },
      // Nothing in the canopy is held back by any copy.
      uTakeover: { value: 1 },
    }
  }

  private onLost = (e: Event) => {
    e.preventDefault()
    this.lost = true
    this.onLostCallback?.()
  }

  /**
   * Plan (or re-plan) the canopy for a view. The work runs in `pause`d
   * slices; until a re-plan is ready, the canopy already built keeps
   * being drawn.
   */
  async setView(view: RoomView, pause: Pause) {
    const key = viewKey(view)
    if (key === this.viewKey) return
    this.viewKey = key
    this.wanted = view
    for (const l of this.building) l.veg.dispose()
    this.building = []
    this.pending = this.layerSteps(view)
    if (this.working) return
    this.working = true
    try {
      while (this.pending.length && !this.disposed && !this.lost) {
        const idle = await pause()
        if (this.disposed || this.lost) return
        // As many slices as this idle moment has room for (at least one).
        do this.pending.shift()?.()
        while (this.pending.length && idle.timeRemaining() > 6)
        if (!this.pending.length) await this.compile(pause)
      }
    } finally {
      this.working = false
    }
  }

  /**
   * Finish whatever is left at once — the charge is full and the frame
   * is about to be frozen, ready or not.
   */
  finishNow() {
    if (this.disposed || this.lost) return
    while (this.pending.length) this.pending.shift()?.()
    this.renderer.compile(this.scene, this.camera)
    this.renderer.compile(this.outScene, this.camera)
    this.ready = this.layers.length > 0
  }

  /** The work of building a view's canopy, cut into slices. */
  private layerSteps(view: RoomView): Array<() => void> {
    const next = canopyPlanner(view, ROOM_CONFIG.seed)
    const eye = view.lens.position
    const steps: Array<() => void> = []
    for (let li = 0; li < 5; li++) {
      let layer: ReturnType<typeof next> = null
      let uDark = { value: 0 }
      steps.push(() => {
        layer = next()
        // One darkening per layer, shared by its two halves.
        uDark = { value: 0 }
      })
      for (let side = 0; side < 2; side++) {
        steps.push(() => {
          if (!layer) return
          const botany = layer.sides[side]
          // PAINTED, back to front. The lens never moves, so the order is
          // fixed once here: every leaf blends over what is behind it.
          botany.leaves.sort((a, b) => b.position.distanceToSquared(eye) - a.position.distanceToSquared(eye))
          const veg = new Vegetation(
            botany, [], this.atlas, this.uniforms, { leafShare: this.leafShare, msaa: 0 },
            { leafFrag: canopyLeafFrag, stemFrag: canopyStemFrag, shadows: false, painter: true, uniforms: { uAmbient: { value: this.ambient }, uDark } },
          )
          // Every stem grows whole and every leaf is admitted: the charge
          // alone decides how far.
          veg.applyPrune(
            { cuts: new Float32Array(botany.stems.length).fill(1), leaves: new Uint8Array(botany.leaves.length).fill(1) },
            new Uint8Array(0),
          )
          // Band by band, far to near; in each band its left half, then
          // its right; in each half its layers far to near; in each
          // layer its stems, then its leaves. Exactly the order the
          // frozen canvases are stacked in, so freezing changes nothing.
          for (const m of veg.meshes) m.renderOrder += layer.band * 1000 + side * 100 + li * 10
          this.building.push({ veg, band: layer.band, side, dark: layer.dark, uDark })
        })
      }
    }
    steps.push(() => this.swapIn())
    return steps
  }

  /** The canopy just built takes the place of the one on screen. */
  private swapIn() {
    for (const l of this.layers) {
      for (const m of l.veg.meshes) this.scene.remove(m)
      l.veg.dispose()
    }
    this.layers = this.building
    this.building = []
    for (const l of this.layers) for (const m of l.veg.meshes) this.scene.add(m)
    if (this.wanted) applyLens(this.camera, this.wanted.lens, this.wanted.aspect)
    // The charge as it stands, on the new layers.
    if (this.charge >= 0) this.applyCharge(this.charge)
  }

  /**
   * Compiles the programs, then waits for the driver to have them
   * ready — polling, rather than three's compileAsync, so that a
   * renderer torn down (or a context lost) meanwhile just stops.
   */
  private async compile(pause: Pause) {
    this.renderer.compile(this.scene, this.camera)
    this.renderer.compile(this.outScene, this.camera)
    const materials = new Set<THREE.Material>([this.outMat])
    for (const l of this.layers) for (const m of l.veg.meshes) materials.add(m.material as THREE.Material)
    const props = this.renderer.properties
    for (let i = 0; i < 300; i++) {
      if (this.disposed || this.lost) return
      const done = [...materials].every((m) => {
        const program = (props.get(m) as { currentProgram?: { isReady(): boolean } }).currentProgram
        return !program || program.isReady()
      })
      if (done) break
      await pause()
    }
    if (this.disposed || this.lost) return
    this.ready = true
    if (this.charge >= 0) this.draw()
  }

  /** CSS size and device pixel ratio of the layer. */
  resize(width: number, height: number, dpr: number) {
    if (this.disposed) return
    const ratio = Math.max(0.5, Math.min(dpr, 1.5, Math.sqrt(this.maxPixels / Math.max(1, width * height))))
    this.renderer.setPixelRatio(ratio)
    this.renderer.setSize(width, height, false)
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2())
    this.rt.setSize(size.x, size.y)
    if (this.ready && this.charge >= 0) this.draw()
  }

  /** The portal's charge, 0..1, applied without drawing. */
  applyCharge(c: number) {
    this.charge = c
    this.uniforms.uGrowth.value = c
    this.uniforms.uTime.value = performance.now() / 1000
    // The deeper layers lose the light as the nearer ones close.
    const close = smooth((c - 0.4) / 0.6)
    for (const l of this.layers) l.uDark.value = l.dark * close
  }

  /** The portal's charge, 0..1. Draws only when it changes. */
  setCharge(c: number) {
    if (this.lost || this.disposed || Math.abs(c - this.charge) < 1e-4) return
    this.applyCharge(c)
    if (this.ready) this.draw()
  }

  private draw(band?: number, side?: number) {
    for (const l of this.layers) for (const m of l.veg.meshes) m.visible = (band === undefined || l.band === band) && (side === undefined || l.side === side)
    const r = this.renderer
    r.setRenderTarget(this.rt)
    r.clear(true, false, false)
    r.render(this.scene, this.camera)
    r.setRenderTarget(null)
    r.clear(true, false, false)
    r.render(this.outScene, this.camera)
  }

  /**
   * The last frame as plain canvases — deep, middle and near leaves,
   * each split down the middle — for the cover to part. Read back in
   * the same task as each draw, so no preserved drawing buffer is
   * needed.
   */
  snapshot(): CanopyShot[] {
    if (this.lost || this.disposed || !this.ready) return []
    const shots: CanopyShot[] = []
    for (let band = 0; band < 3; band++) {
      for (let side = 0; side < 2; side++) {
        this.draw(band, side)
        const canvas = document.createElement('canvas')
        canvas.width = this.canvas.width
        canvas.height = this.canvas.height
        canvas.getContext('2d')?.drawImage(this.canvas, 0, 0)
        shots.push({ canvas, band, side })
      }
    }
    return shots
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.pending = []
    this.canvas.removeEventListener('webglcontextlost', this.onLost, false)
    for (const l of [...this.layers, ...this.building]) l.veg.dispose()
    this.layers = []
    this.building = []
    this.rt.dispose()
    this.outMat.dispose()
    this.quad.dispose()
    this.atlas.albedo.dispose()
    this.atlas.normal.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }
}

/** The lens a canopy was planned through, coarsely: a resize that leaves
    it where it was (a toolbar, a pixel) re-plans nothing. */
function viewKey(view: RoomView) {
  return `${view.lens.ty.toFixed(4)}|${view.lens.shift.toFixed(4)}|${view.aspect.toFixed(2)}|${view.distance}|${view.foliage}`
}

function smooth(x: number) {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}
