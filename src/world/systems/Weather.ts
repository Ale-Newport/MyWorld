import * as THREE from 'three'
import { Events } from '../core/Events'
import { palette } from '../core/palette'
import { clamp, damp, seeded } from '../core/maths'
import type { Bin } from '../core/Disposal'
import type { Quality } from '../core/Quality'
import type { Ticker } from '../core/Ticker'
import type { Renderer } from '../render/Renderer'
import type { View } from '../view/View'
import type { Lighting } from '../world/Lighting'

/* ============================================================
   WEATHER & WIND

   Adapted from sources/Game/Weather.js, Wind.js and
   World/{RainLines,Snow,Lightnings}.js (folio-2025, MIT —
   Copyright (c) 2025 Bruno Simon). See THIRD_PARTY_NOTICES.md.

   The brief asks for weather to be RESTRAINED — rain occasionally,
   not a permanent storm. So this is a slow state machine on a long
   clock, and the default state is clear. A visitor who stays five
   minutes probably sees one change; one who stays half an hour
   sees several. Nothing here ever blocks the view or the driving.

   Wind is a single vector with a smoothed strength, published for
   anything that should react to it — banners, foliage, the rain's
   slant. One source, so nothing drifts out of phase.

   The particles follow the CAMERA, not the world: a box of rain
   around the player is indistinguishable from rain everywhere, and
   costs a thousand particles instead of a million.
   ============================================================ */

export type WeatherState = 'clear' | 'overcast' | 'rain' | 'snow' | 'storm'

interface StateSpec {
  /** Relative chance of being chosen next. */
  weight: number
  /** Seconds this state lasts, before variance. */
  duration: number
  /** 0..1 targets. */
  rain: number
  snow: number
  wind: number
  fogTighten: number
  lightPull: number
}

const STATES: Record<WeatherState, StateSpec> = {
  clear: { weight: 46, duration: 220, rain: 0, snow: 0, wind: 0.22, fogTighten: 0, lightPull: 0 },
  overcast: { weight: 24, duration: 150, rain: 0, snow: 0, wind: 0.45, fogTighten: 0.28, lightPull: 0.34 },
  rain: { weight: 18, duration: 110, rain: 1, snow: 0, wind: 0.62, fogTighten: 0.5, lightPull: 0.55 },
  snow: { weight: 8, duration: 130, rain: 0, snow: 1, wind: 0.34, fogTighten: 0.42, lightPull: 0.3 },
  // The rare one. Upstream's tornado, re-thought: this world's
  // storms are made of data, not weather.
  storm: { weight: 4, duration: 70, rain: 0.55, snow: 0, wind: 1, fogTighten: 0.66, lightPull: 0.72 },
}

export class Weather {
  readonly events = new Events<'change'>()

  state: WeatherState = 'clear'
  /** 0..1 blend towards the current state's targets. */
  private blend = 0
  private remaining = STATES.clear.duration

  /** Live, smoothed values other systems read. */
  rain = 0
  snow = 0
  windStrength = 0.22
  readonly windDirection = new THREE.Vector2(1, 0.35).normalize()
  /** Slowly rotating wind angle, radians. */
  private windAngle = 0

  /** Set true to hold conditions — used by the race, which must be fair. */
  locked = false

  private rainMesh: THREE.Points | null = null
  private snowMesh: THREE.Points | null = null
  private rainMaterial: THREE.ShaderMaterial | null = null
  private snowMaterial: THREE.ShaderMaterial | null = null

  private flash = 0
  private nextFlash = 0
  private readonly rand = seeded(20260908)
  private readonly group = new THREE.Group()

  constructor(
    private ticker: Ticker,
    private view: View,
    private renderer: Renderer,
    private lighting: Lighting,
    quality: Quality,
    bin: Bin,
  ) {
    const count = quality.settings.weatherParticles
    if (count > 0) {
      this.buildRain(count, bin)
      this.buildSnow(Math.round(count * 0.7), bin)
    }
    this.group.frustumCulled = false
    this.renderer.scene.add(this.group)

    // First change is a long way off: a visitor should meet the world
    // in daylight and clear weather.
    this.remaining = 200 + this.rand() * 160

    const update = () => this.update()
    // Order 9: alongside lighting, before anything that reads wind.
    this.ticker.events.on('tick', update, 9)

    bin.add(() => {
      this.ticker.events.off('tick', update)
      this.group.removeFromParent()
      this.events.clear()
    })
    bin.object3D(this.group)
  }

  /* ========================================================
     PARTICLES
     ======================================================== */

  private buildRain(count: number, bin: Bin): void {
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(count * 3)
    const speeds = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (this.rand() - 0.5) * 90
      positions[i * 3 + 1] = this.rand() * 46
      positions[i * 3 + 2] = (this.rand() - 0.5) * 90
      speeds[i] = 0.7 + this.rand() * 0.6
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1))

    this.rainMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uStrength: { value: 0 },
        uOrigin: { value: new THREE.Vector3() },
        uWind: { value: new THREE.Vector2() },
        uColor: { value: new THREE.Color(palette.glass) },
      },
      vertexShader: /* glsl */ `
        attribute float aSpeed;
        uniform float uTime;
        uniform float uStrength;
        uniform vec3  uOrigin;
        uniform vec2  uWind;
        varying float vAlpha;

        void main() {
          vec3 p = position;
          // Fall, wrapping in a 46 m column, and lean with the wind.
          float fall = mod(p.y - uTime * (26.0 * aSpeed), 46.0);
          p.y = fall;
          p.x += uWind.x * (46.0 - fall) * 0.34;
          p.z += uWind.y * (46.0 - fall) * 0.34;
          // The box follows the camera, so a thousand drops read as
          // rain everywhere.
          p += uOrigin;

          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (7.0 + aSpeed * 5.0) * uStrength * (30.0 / -mv.z);
          vAlpha = uStrength;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying float vAlpha;
        uniform vec3 uColor;
        void main() {
          if (vAlpha < 0.01) discard;
          // A vertical streak rather than a dot: rain read as
          // hailstones the first time this was a round point.
          vec2 uv = gl_PointCoord - 0.5;
          float streak = smoothstep(0.5, 0.0, abs(uv.x) * 6.0) * smoothstep(0.5, 0.1, abs(uv.y));
          if (streak < 0.02) discard;
          gl_FragColor = vec4(uColor, streak * vAlpha * 0.5);
          #include <colorspace_fragment>
        }
      `,
    })

    this.rainMesh = new THREE.Points(geometry, this.rainMaterial)
    this.rainMesh.frustumCulled = false
    this.rainMesh.visible = false
    this.group.add(this.rainMesh)
    bin.add(() => {
      geometry.dispose()
      this.rainMaterial?.dispose()
    })
  }

  private buildSnow(count: number, bin: Bin): void {
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(count * 3)
    const offsets = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (this.rand() - 0.5) * 90
      positions[i * 3 + 1] = this.rand() * 40
      positions[i * 3 + 2] = (this.rand() - 0.5) * 90
      offsets[i] = this.rand() * Math.PI * 2
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 1))

    this.snowMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uStrength: { value: 0 },
        uOrigin: { value: new THREE.Vector3() },
        uWind: { value: new THREE.Vector2() },
        uColor: { value: new THREE.Color(palette.chalk) },
      },
      vertexShader: /* glsl */ `
        attribute float aOffset;
        uniform float uTime;
        uniform float uStrength;
        uniform vec3  uOrigin;
        uniform vec2  uWind;
        varying float vAlpha;

        void main() {
          vec3 p = position;
          float fall = mod(p.y - uTime * 2.6, 40.0);
          p.y = fall;
          // Snow drifts rather than falls: two incommensurate sines
          // per flake, so no two follow the same path.
          p.x += sin(uTime * 0.7 + aOffset) * 1.6 + uWind.x * (40.0 - fall) * 0.22;
          p.z += cos(uTime * 0.53 + aOffset * 1.7) * 1.6 + uWind.y * (40.0 - fall) * 0.22;
          p += uOrigin;

          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = 5.5 * uStrength * (30.0 / -mv.z);
          vAlpha = uStrength;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying float vAlpha;
        uniform vec3 uColor;
        void main() {
          if (vAlpha < 0.01) discard;
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          gl_FragColor = vec4(uColor, smoothstep(0.5, 0.1, d) * vAlpha * 0.75);
          #include <colorspace_fragment>
        }
      `,
    })

    this.snowMesh = new THREE.Points(geometry, this.snowMaterial)
    this.snowMesh.frustumCulled = false
    this.snowMesh.visible = false
    this.group.add(this.snowMesh)
    bin.add(() => {
      geometry.dispose()
      this.snowMaterial?.dispose()
    })
  }

  /* ========================================================
     STATE
     ======================================================== */

  /** Forces a state. Used by the race, which must be identical every run. */
  lock(state: WeatherState): void {
    this.locked = true
    this.setState(state)
  }

  unlock(): void {
    this.locked = false
  }

  setState(state: WeatherState): void {
    if (state === this.state) return
    this.state = state
    this.blend = 0
    const spec = STATES[state]
    this.remaining = spec.duration * (0.7 + this.rand() * 0.6)
    this.events.trigger('change', [state])
  }

  private pickNext(): WeatherState {
    // Never the same twice, and clear is over-represented so the
    // world spends most of its time out of the weather.
    const entries = (Object.keys(STATES) as WeatherState[]).filter((s) => s !== this.state)
    const total = entries.reduce((sum, s) => sum + STATES[s].weight, 0)
    let roll = this.rand() * total
    for (const s of entries) {
      roll -= STATES[s].weight
      if (roll <= 0) return s
    }
    return 'clear'
  }

  /* ========================================================
     TICK
     ======================================================== */

  private update(): void {
    const dt = this.ticker.delta
    const spec = STATES[this.state]

    if (!this.locked) {
      this.remaining -= dt
      if (this.remaining <= 0) this.setState(this.pickNext())
    }

    // Transitions take about eight seconds. Weather that snaps reads
    // as a bug; weather that takes a minute is never noticed at all.
    this.blend = clamp(this.blend + dt / 8, 0, 1)

    this.rain = damp(this.rain, spec.rain * this.blend, 1.5, dt)
    this.snow = damp(this.snow, spec.snow * this.blend, 1.5, dt)

    // Wind direction turns slowly and never snaps.
    this.windAngle += dt * 0.035
    this.windDirection.set(Math.cos(this.windAngle), Math.sin(this.windAngle * 0.7))
    this.windStrength = damp(this.windStrength, spec.wind, 0.6, dt)

    const origin = this.view.focusPoint.smoothedPosition

    if (this.rainMesh && this.rainMaterial) {
      const visible = this.rain > 0.01
      this.rainMesh.visible = visible
      if (visible) {
        const u = this.rainMaterial.uniforms
        u.uTime.value = this.ticker.elapsed
        u.uStrength.value = this.rain
        ;(u.uOrigin.value as THREE.Vector3).set(origin.x, 0, origin.z)
        ;(u.uWind.value as THREE.Vector2)
          .copy(this.windDirection)
          .multiplyScalar(this.windStrength)
      }
    }

    if (this.snowMesh && this.snowMaterial) {
      const visible = this.snow > 0.01
      this.snowMesh.visible = visible
      if (visible) {
        const u = this.snowMaterial.uniforms
        u.uTime.value = this.ticker.elapsed
        u.uStrength.value = this.snow
        ;(u.uOrigin.value as THREE.Vector3).set(origin.x, 0, origin.z)
        ;(u.uWind.value as THREE.Vector2)
          .copy(this.windDirection)
          .multiplyScalar(this.windStrength)
      }
    }

    /* ---- lightning ------------------------------------- */
    // Only in a data storm, and never often enough to be annoying.
    if (this.state === 'storm') {
      this.nextFlash -= dt
      if (this.nextFlash <= 0) {
        this.nextFlash = 4 + this.rand() * 9
        this.flash = 1
      }
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 4)
      // A flash is a brief exposure lift, not a white screen.
      this.renderer.instance.toneMappingExposure = 1.12 + this.flash * 0.55
    } else if (this.renderer.instance.toneMappingExposure !== 1.12) {
      this.renderer.instance.toneMappingExposure = damp(
        this.renderer.instance.toneMappingExposure, 1.12, 4, dt,
      )
    }

    /* ---- atmosphere ------------------------------------ */
    // Weather tightens the fog and pulls light out of the sky. The
    // day cycle still owns the colours; this only leans on them.
    this.lighting.weatherDim = spec.lightPull * this.blend
    this.lighting.weatherFog = spec.fogTighten * this.blend
  }
}
