import * as THREE from 'three'
import { palette } from '../core/palette'
import type { Bin } from '../core/Disposal'
import type { Quality } from '../core/Quality'
import type { Ticker } from '../core/Ticker'
import type { Viewport } from '../core/Viewport'
import type { View } from '../view/View'

/* ============================================================
   RENDERER

   Adapted from sources/Game/Rendering.js (folio-2025, MIT —
   Copyright (c) 2025 Bruno Simon). Upstream targets
   `WebGPURenderer` with TSL node materials and a stack of
   post-processing nodes. This route deliberately does not: the
   brief says WebGPU must never be a requirement, and a WebGL
   fallback that is a second, differently-tuned renderer is two
   things to keep working instead of one.

   So: classic `WebGLRenderer`, one composite pass, and the
   quality tiers decide whether that pass runs at all.

   The composite is upstream's `cheapDOF` idea — blur by distance
   from the focus, cheaply — reduced to what actually reads at
   this camera distance: a slight radial softening plus a vignette
   and a touch of grain, so the world looks photographed rather
   than rendered. At MEDIUM and LOW it is skipped entirely and the
   scene draws straight to the canvas.
   ============================================================ */

const COMPOSITE_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const COMPOSITE_FRAGMENT = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  uniform sampler2D tScene;
  uniform vec2  uResolution;
  uniform float uStrength;     // depth-of-field amount
  uniform float uVignette;
  uniform float uGrain;
  uniform float uTime;
  uniform float uSpeedLines;
  uniform vec3  uSpeedLineColor;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    vec2 uv = vUv;
    vec2 centered = uv - 0.5;
    centered.x *= uResolution.x / uResolution.y;
    float radius = length(centered);

    // Cheap radial blur: five taps along the vector to the centre,
    // scaled by distance, so the middle of the frame stays crisp.
    // The falloff starts LATE on purpose. At a 25-degree field of
    // view everything on screen is roughly the same distance away,
    // so a wide blur does not read as depth of field — it reads as
    // a broken renderer. This is a soft corner, nothing more.
    float blur = smoothstep(0.58, 1.15, radius) * uStrength;
    vec3 color = texture2D(tScene, uv).rgb;

    if (blur > 0.001) {
      vec2 step = normalize(vec2(centered.x * uResolution.y / uResolution.x, centered.y))
                  * blur * 0.006;
      vec3 sum = color;
      sum += texture2D(tScene, uv + step).rgb;
      sum += texture2D(tScene, uv - step).rgb;
      sum += texture2D(tScene, uv + step * 2.0).rgb;
      sum += texture2D(tScene, uv - step * 2.0).rgb;
      color = sum / 5.0;
    }

    // Speed lines: radial streaks that appear only while boosting.
    if (uSpeedLines > 0.001) {
      float angle = atan(centered.y, centered.x);
      float streak = fract(angle * 7.6394 + hash(vec2(floor(angle * 24.0), 0.0)) * 3.0);
      streak = smoothstep(0.86, 1.0, streak);
      float radial = smoothstep(0.22, 0.72, radius);
      color = mix(color, uSpeedLineColor, streak * radial * uSpeedLines * 0.55);
    }

    // Vignette. Multiplicative, never additive: the paper white has
    // to stay paper white in the middle of the frame.
    float vignette = 1.0 - smoothstep(0.42, 1.15, radius) * uVignette;
    color *= vignette;

    // A little grain stops large flat areas of sky from banding.
    float grain = (hash(uv * uResolution + uTime) - 0.5) * uGrain;
    color += grain;

    gl_FragColor = vec4(color, 1.0);

    // The scene target is LINEAR and un-tone-mapped, so every step
    // above happens in linear light — which is the only place a
    // blur or a vignette is physically meaningful. Encoding is the
    // last thing that happens, exactly once. Writing linear values
    // straight to an sRGB canvas is the classic way to end up with
    // a world that looks like it was rendered at dusk.
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export class Renderer {
  readonly instance: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()

  private target: THREE.WebGLRenderTarget | null = null
  private compositeScene: THREE.Scene | null = null
  private compositeCamera: THREE.OrthographicCamera | null = null
  private compositeMaterial: THREE.ShaderMaterial | null = null
  private usesComposite = false

  constructor(
    canvas: HTMLCanvasElement,
    private viewport: Viewport,
    private quality: Quality,
    private ticker: Ticker,
    private view: View,
    bin: Bin,
  ) {
    this.instance = new THREE.WebGLRenderer({
      canvas,
      antialias: quality.settings.antialias,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      // The world is opaque; not preserving the buffer lets the
      // driver discard it and saves bandwidth on mobile.
      preserveDrawingBuffer: false,
    })

    this.instance.setClearColor(palette.paper, 1)
    this.instance.outputColorSpace = THREE.SRGBColorSpace
    // Neutral rather than ACES: ACES pulls the off-white paper
    // towards cream and the whole palette drifts away from the DOM.
    this.instance.toneMapping = THREE.NeutralToneMapping
    this.instance.toneMappingExposure = 1.12
    this.instance.shadowMap.enabled = quality.settings.shadows
    // Soft PCF: with the day locked open the sun is always high and
    // always casting, so shadow EDGES are visible all the time. Hard
    // PCF put a staircase on every tree.
    this.instance.shadowMap.type = THREE.PCFSoftShadowMap

    this.scene.fog = new THREE.Fog(palette.paper, 120, 460)

    this.applyQuality()

    const onResize = () => this.resize()
    this.viewport.events.on('change', onResize)

    const onQuality = () => this.applyQuality()
    this.quality.events.on('change', onQuality)

    const render = () => this.render()
    // Order 998, exactly as upstream: after every world system.
    this.ticker.events.on('tick', render, 998)

    bin.add(() => {
      this.ticker.events.off('tick', render)
      this.quality.events.off('change', onQuality)
      this.viewport.events.off('change', onResize)
      this.disposeComposite()
      this.instance.dispose()
      this.instance.forceContextLoss()
    })
  }

  private applyQuality(): void {
    const settings = this.quality.settings
    this.instance.setPixelRatio(this.quality.pixelRatio)
    this.instance.shadowMap.enabled = settings.shadows
    this.instance.shadowMap.needsUpdate = true

    const wantsComposite = settings.postProcessing
    if (wantsComposite && !this.usesComposite) this.buildComposite()
    else if (!wantsComposite && this.usesComposite) this.disposeComposite()

    this.resize()
  }

  private buildComposite(): void {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      samples: this.quality.settings.antialias ? 4 : 0,
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
    })
    // Linear, high dynamic range. Tone mapping and encoding happen
    // in the composite, after the post-processing maths.
    this.target.texture.colorSpace = THREE.LinearSRGBColorSpace

    this.compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: COMPOSITE_VERTEX,
      fragmentShader: COMPOSITE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: this.target.texture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uStrength: { value: 0.42 },
        uVignette: { value: 0.16 },
        uGrain: { value: 0.006 },
        uTime: { value: 0 },
        uSpeedLines: { value: 0 },
        uSpeedLineColor: { value: new THREE.Color(palette.chalk) },
      },
    })

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.compositeMaterial)
    quad.frustumCulled = false
    this.compositeScene = new THREE.Scene()
    this.compositeScene.add(quad)
    this.compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this.usesComposite = true
  }

  private disposeComposite(): void {
    this.target?.dispose()
    this.target = null
    this.compositeMaterial?.dispose()
    this.compositeMaterial = null
    this.compositeScene?.traverse((child) => {
      const mesh = child as THREE.Mesh
      mesh.geometry?.dispose()
    })
    this.compositeScene = null
    this.compositeCamera = null
    this.usesComposite = false
  }

  resize(): void {
    const { width, height } = this.viewport
    this.instance.setSize(width, height, false)
    if (this.target && this.compositeMaterial) {
      const ratio = this.quality.pixelRatio
      this.target.setSize(Math.round(width * ratio), Math.round(height * ratio))
      this.compositeMaterial.uniforms.uResolution.value.set(width * ratio, height * ratio)
    }
  }

  setFogRange(near: number, far: number): void {
    const fog = this.scene.fog as THREE.Fog | null
    if (fog) {
      fog.near = near
      fog.far = far
    }
  }

  setBackground(color: THREE.Color): void {
    this.instance.setClearColor(color, 1)
    const fog = this.scene.fog as THREE.Fog | null
    if (fog) fog.color.copy(color)
  }

  private render(): void {
    const camera = this.view.camera

    if (this.usesComposite && this.target && this.compositeScene && this.compositeCamera && this.compositeMaterial) {
      const u = this.compositeMaterial.uniforms
      u.uTime.value = this.ticker.elapsed
      u.uSpeedLines.value = this.view.smoothedSpeedLineStrength

      this.instance.setRenderTarget(this.target)
      this.instance.clear()
      this.instance.render(this.scene, camera)
      this.instance.setRenderTarget(null)
      this.instance.render(this.compositeScene, this.compositeCamera)
      return
    }

    this.instance.render(this.scene, camera)
  }

  /** Compiles every material once, so the first drive has no hitches. */
  precompile(): void {
    this.instance.compile(this.scene, this.view.camera)
  }

  get info() {
    return this.instance.info
  }
}
