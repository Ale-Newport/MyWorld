import * as THREE from 'three'
import { palette } from '../core/palette'
import { clamp, lerp, smoothstep } from '../core/maths'
import type { Bin } from '../core/Disposal'
import type { Quality } from '../core/Quality'
import type { Ticker } from '../core/Ticker'
import type { Renderer } from '../render/Renderer'
import type { View } from '../view/View'
import type { World } from './World'

/* ============================================================
   LIGHTING & DAY CYCLE

   Adapted from sources/Game/Ligthing.js and Cycles/DayCycles.js
   (folio-2025, MIT — Copyright (c) 2025 Bruno Simon). Upstream's
   structure is kept: one directional sun whose shadow camera
   follows the player rather than covering the world, one
   hemisphere fill, and a normalised day phase driving colour
   keyframes.

   The shadow camera is the part worth copying carefully. A single
   directional light covering a 700 m world at any useful shadow
   resolution produces shadows the size of buildings. Instead the
   sun is repositioned every frame relative to the CAMERA FOCUS,
   with a ~90 m orthographic box: shadows stay sharp, and the
   world beyond the box simply has none, which nobody notices at
   this camera angle.

   A full day is DAY_DURATION seconds. It is deliberately long
   enough that a visitor is not strobed between noon and midnight,
   and short enough that someone who stays fifteen minutes sees
   the world go dark once.
   ============================================================ */

export const DAY_DURATION = 600

interface Keyframe {
  /** Day phase, 0..1. 0 = midnight, 0.25 = dawn, 0.5 = noon. */
  at: number
  sky: string
  sun: string
  sunIntensity: number
  ambient: string
  ambientIntensity: number
  fogNear: number
  fogFar: number
  /** Sun elevation above the horizon, radians. */
  elevation: number
}

const KEYFRAMES: Keyframe[] = [
  { at: 0.00, sky: palette.skyNight, sun: palette.moon, sunIntensity: 0.22, ambient: '#2a3550', ambientIntensity: 0.72, fogNear: 60, fogFar: 260, elevation: -0.25 },
  { at: 0.21, sky: '#2c3347', sun: '#8fa2c4', sunIntensity: 0.48, ambient: '#3d4a66', ambientIntensity: 0.95, fogNear: 70, fogFar: 300, elevation: 0.02 },
  { at: 0.27, sky: palette.skyDusk, sun: palette.sunDusk, sunIntensity: 1.85, ambient: '#d3b49c', ambientIntensity: 1.25, fogNear: 90, fogFar: 340, elevation: 0.14 },
  { at: 0.38, sky: '#e6e9ea', sun: palette.sunDay, sunIntensity: 2.85, ambient: '#cfd8de', ambientIntensity: 1.42, fogNear: 130, fogFar: 470, elevation: 0.62 },
  { at: 0.50, sky: palette.skyDay, sun: '#ffffff', sunIntensity: 3.10, ambient: '#d8dfe4', ambientIntensity: 1.50, fogNear: 150, fogFar: 520, elevation: 1.12 },
  { at: 0.66, sky: '#e4e2dc', sun: palette.sunDay, sunIntensity: 2.72, ambient: '#d2d5d2', ambientIntensity: 1.38, fogNear: 130, fogFar: 460, elevation: 0.58 },
  { at: 0.76, sky: palette.skyDusk, sun: palette.sunDusk, sunIntensity: 1.72, ambient: '#c9a58c', ambientIntensity: 1.18, fogNear: 90, fogFar: 330, elevation: 0.12 },
  { at: 0.84, sky: '#3a3a4c', sun: '#8f86b0', sunIntensity: 0.52, ambient: '#404a68', ambientIntensity: 0.92, fogNear: 70, fogFar: 290, elevation: -0.02 },
  { at: 1.00, sky: palette.skyNight, sun: palette.moon, sunIntensity: 0.22, ambient: '#2a3550', ambientIntensity: 0.72, fogNear: 60, fogFar: 260, elevation: -0.25 },
]

export class Lighting {
  readonly group = new THREE.Group()
  readonly sun: THREE.DirectionalLight
  readonly ambient: THREE.HemisphereLight
  readonly sunTarget = new THREE.Object3D()

  /** 0..1 day phase. */
  phase = 0.42
  /** 0..1, how dark it is. Read by headlights, signs and secrets. */
  nightFactor = 0
  /** Seconds per full day. Set to 0 to freeze time. */
  duration = DAY_DURATION

  private readonly skyColor = new THREE.Color()
  private readonly sunColor = new THREE.Color()
  private readonly ambientColor = new THREE.Color()
  private readonly scratchA = new THREE.Color()
  private readonly scratchB = new THREE.Color()

  private shadowExtent = 0

  /** Set by the Game so the sky dome follows the same clock. */
  world: World | null = null
  private readonly zenith = new THREE.Color()

  constructor(
    private renderer: Renderer,
    private view: View,
    private ticker: Ticker,
    private quality: Quality,
    bin: Bin,
  ) {
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6)
    this.sun.castShadow = quality.settings.shadows
    this.configureShadow()
    this.sun.target = this.sunTarget

    this.ambient = new THREE.HemisphereLight(0xd8dfe4, 0x9a958c, 1.45)

    this.group.add(this.sun, this.sunTarget, this.ambient)
    renderer.scene.add(this.group)

    const update = () => this.update()
    // Order 9, as upstream: after the View has settled this frame.
    this.ticker.events.on('tick', update, 9)

    const onQuality = () => {
      this.sun.castShadow = this.quality.settings.shadows
      this.configureShadow()
    }
    this.quality.events.on('change', onQuality)

    bin.add(() => {
      this.ticker.events.off('tick', update)
      this.quality.events.off('change', onQuality)
      this.sun.shadow.dispose()
      this.group.removeFromParent()
    })

    this.apply()
  }

  private configureShadow(): void {
    const size = this.quality.settings.shadowMapSize
    this.sun.shadow.mapSize.set(size, size)
    // ~90 m box around the player: big enough to hold the car, its
    // district's landmarks and anything it is about to drive into.
    this.shadowExtent = this.quality.level === 'high' ? 52 : 40
    const camera = this.sun.shadow.camera
    camera.left = -this.shadowExtent
    camera.right = this.shadowExtent
    camera.top = this.shadowExtent
    camera.bottom = -this.shadowExtent
    camera.near = 1
    camera.far = 260
    camera.updateProjectionMatrix()
    this.sun.shadow.bias = -0.0012
    this.sun.shadow.normalBias = 0.045
  }

  /** Jumps the clock. `phase` is 0..1 across a full day. */
  setPhase(phase: number): void {
    this.phase = ((phase % 1) + 1) % 1
    this.apply()
  }

  private sampleKeyframes(): Keyframe {
    const phase = this.phase
    let a = KEYFRAMES[0]
    let b = KEYFRAMES[KEYFRAMES.length - 1]
    for (let i = 0; i < KEYFRAMES.length - 1; i++) {
      if (phase >= KEYFRAMES[i].at && phase <= KEYFRAMES[i + 1].at) {
        a = KEYFRAMES[i]
        b = KEYFRAMES[i + 1]
        break
      }
    }
    const span = Math.max(1e-6, b.at - a.at)
    const t = clamp((phase - a.at) / span, 0, 1)
    // Smoothstep between keys: linear ramps make dawn look like a
    // dimmer switch rather than a sunrise.
    const e = t * t * (3 - 2 * t)

    this.scratchA.set(a.sky)
    this.scratchB.set(b.sky)
    this.skyColor.copy(this.scratchA).lerp(this.scratchB, e)

    this.scratchA.set(a.sun)
    this.scratchB.set(b.sun)
    this.sunColor.copy(this.scratchA).lerp(this.scratchB, e)

    this.scratchA.set(a.ambient)
    this.scratchB.set(b.ambient)
    this.ambientColor.copy(this.scratchA).lerp(this.scratchB, e)

    return {
      at: phase,
      sky: '',
      sun: '',
      sunIntensity: lerp(a.sunIntensity, b.sunIntensity, e),
      ambient: '',
      ambientIntensity: lerp(a.ambientIntensity, b.ambientIntensity, e),
      fogNear: lerp(a.fogNear, b.fogNear, e),
      fogFar: lerp(a.fogFar, b.fogFar, e),
      elevation: lerp(a.elevation, b.elevation, e),
    }
  }

  private apply(): void {
    const frame = this.sampleKeyframes()

    this.sun.color.copy(this.sunColor)
    this.sun.intensity = frame.sunIntensity
    this.ambient.color.copy(this.ambientColor)
    this.ambient.groundColor.copy(this.skyColor).multiplyScalar(0.65)
    this.ambient.intensity = frame.ambientIntensity

    this.renderer.setBackground(this.skyColor)
    this.renderer.setFogRange(frame.fogNear, frame.fogFar)

    // The dome runs a little deeper than the horizon so the sky has
    // somewhere to go; at night the difference is what stops it
    // reading as a flat black ceiling.
    this.zenith.copy(this.skyColor).multiplyScalar(0.86).lerp(this.ambientColor, 0.22)
    this.world?.setSkyColors(this.skyColor, this.zenith)

    // Night is measured from sun elevation rather than clock time, so
    // it stays right if the phase is scrubbed or frozen.
    this.nightFactor = 1 - smoothstep(frame.elevation, -0.06, 0.22)

    // The sun swings around a fixed azimuth so shadows sweep across
    // the world during the day instead of rotating on the spot.
    const azimuth = Math.PI * 0.35 + this.phase * Math.PI * 2
    const distance = 120
    const height = Math.sin(Math.max(frame.elevation, -0.35)) * distance
    this.sunPosition.set(
      Math.cos(azimuth) * distance * 0.7,
      Math.max(12, height),
      Math.sin(azimuth) * distance * 0.7,
    )
  }

  private readonly sunPosition = new THREE.Vector3(60, 90, 40)

  private update(): void {
    if (this.duration > 0) {
      this.phase = (this.phase + this.ticker.delta / this.duration) % 1
    }
    this.apply()

    // Snap the shadow box to the focus point, quantised to texel size
    // so shadows do not shimmer as the camera moves.
    const focus = this.view.focusPoint.smoothedPosition
    const texel = (this.shadowExtent * 2) / this.quality.settings.shadowMapSize
    const snappedX = Math.round(focus.x / texel) * texel
    const snappedZ = Math.round(focus.z / texel) * texel

    this.sunTarget.position.set(snappedX, 0, snappedZ)
    this.sun.position.copy(this.sunPosition).add(this.sunTarget.position)
    this.sunTarget.updateMatrixWorld()
    this.sun.updateMatrixWorld()
  }
}
