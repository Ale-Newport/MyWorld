import * as THREE from 'three'
import { palette } from '../core/palette'
import { clamp } from '../core/maths'
import type { Bin } from '../core/Disposal'
import type { Ticker } from '../core/Ticker'
import type { Quality } from '../core/Quality'
import type { PhysicsVehicle } from '../physics/PhysicsVehicle'

/* ============================================================
   TYRE TRACKS

   Adapted from sources/Game/Tracks.js (folio-2025, MIT —
   Copyright (c) 2025 Bruno Simon). See THIRD_PARTY_NOTICES.md.

   The ring buffer is upstream's, and so is the double throttle
   that fills it: a sample is only taken when at least 1/30 s AND
   0.2 m have passed. Time alone fills the buffer while parked;
   distance alone samples densely at speed and sparsely when
   crawling. Both together give an even 25 m of remembered track
   whatever the speed. Keeping the contact flag per sample is also
   upstream's, and it is what lets a wheel leaving the ground fade
   its mark out instead of cutting it off.

   The RIBBON, though, is built on the CPU rather than in a vertex
   shader reading the buffer as a float texture. Upstream's shader
   approach is elegant and it went wrong here in a specific way
   worth recording: when a segment has to be dropped — the car
   teleported, or the buffer is not full yet — a vertex shader can
   only push its vertices outside the clip volume, and the
   rasteriser then CLIPS the quad rather than discarding it,
   leaving triangular slivers across the ground. Collapsing the
   segment on the CPU is unambiguous, and at 128 samples across
   five ribbons the per-frame cost is a few thousand floats.
   ============================================================ */

const SAMPLES = 128
const TIME_THROTTLE = 1 / 30
const DISTANCE_THROTTLE = 0.2
/** Beyond this, two consecutive samples mean a teleport, not a drive. */
const MAX_SEGMENT = 6

interface Sample {
  x: number
  y: number
  z: number
  contact: number
}

class Track {
  readonly mesh: THREE.Mesh

  private samples: Sample[] = []
  /** Index of the newest sample in the ring. */
  private head = 0
  private filled = 0

  private positions: Float32Array
  private fades: Float32Array
  private positionAttribute: THREE.BufferAttribute
  private fadeAttribute: THREE.BufferAttribute
  private material: THREE.ShaderMaterial

  private lastTime = 0
  private lastX = 0
  private lastZ = 0

  constructor(
    private thickness: number,
    colour: string,
    private baseOpacity: number,
    bin: Bin,
  ) {
    for (let i = 0; i < SAMPLES; i++) {
      this.samples.push({ x: 0, y: 0, z: 0, contact: 0 })
    }

    // Two vertices per sample, one strip.
    this.positions = new Float32Array(SAMPLES * 2 * 3)
    this.fades = new Float32Array(SAMPLES * 2)

    const geometry = new THREE.BufferGeometry()
    this.positionAttribute = new THREE.BufferAttribute(this.positions, 3)
    this.positionAttribute.setUsage(THREE.DynamicDrawUsage)
    this.fadeAttribute = new THREE.BufferAttribute(this.fades, 1)
    this.fadeAttribute.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('position', this.positionAttribute)
    geometry.setAttribute('aFade', this.fadeAttribute)

    const indices: number[] = []
    for (let i = 0; i < SAMPLES - 1; i++) {
      const a = i * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    geometry.setIndex(indices)

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: new THREE.Color(colour) },
        uOpacity: { value: baseOpacity },
      },
      vertexShader: /* glsl */ `
        attribute float aFade;
        varying float vFade;
        void main() {
          vFade = aFade;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying float vFade;
        uniform vec3 uColor;
        uniform float uOpacity;
        void main() {
          float alpha = vFade * uOpacity;
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(uColor, alpha);
          #include <colorspace_fragment>
        }
      `,
    })

    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 3
    this.mesh.matrixAutoUpdate = false
    this.mesh.updateMatrix()

    bin.add(() => {
      geometry.dispose()
      this.material.dispose()
    })
  }

  /** Records a sample when both throttles allow, then rebuilds. */
  update(
    position: { x: number; y: number; z: number } | null,
    touching: boolean,
    elapsed: number,
  ): void {
    if (position) {
      const moved = Math.hypot(position.x - this.lastX, position.z - this.lastZ)
      if (elapsed - this.lastTime > TIME_THROTTLE && moved > DISTANCE_THROTTLE) {
        this.head = (this.head + 1) % SAMPLES
        this.filled = Math.min(SAMPLES, this.filled + 1)
        this.lastTime = elapsed
        this.lastX = position.x
        this.lastZ = position.z
      }

      const sample = this.samples[this.head]
      sample.x = position.x
      // Lifted so the ribbon never z-fights the ground it lies on.
      sample.y = position.y + 0.03
      sample.z = position.z
      sample.contact = touching ? 1 : 0
    } else if (this.filled > 0) {
      this.samples[this.head].contact = 0
    }

    this.rebuild()
  }

  private rebuild(): void {
    // Below three samples there is no direction to be perpendicular
    // to, so there is nothing to draw.
    if (this.filled < 3) {
      this.fades.fill(0)
      this.fadeAttribute.needsUpdate = true
      this.mesh.visible = false
      return
    }
    this.mesh.visible = true

    for (let i = 0; i < SAMPLES; i++) {
      // i = 0 is the newest sample, walking backwards through the ring.
      const index = (this.head - i + SAMPLES * 2) % SAMPLES
      const previousIndex = (index - 1 + SAMPLES) % SAMPLES
      const current = this.samples[index]
      const previous = this.samples[previousIndex]

      const vertex = i * 2
      const alive = i < this.filled - 1

      let dx = current.x - previous.x
      let dz = current.z - previous.z
      const length = Math.hypot(dx, dz)

      // Either end of the ring, a teleport, or a stationary pair:
      // collapse the segment to a point with zero alpha. Collapsing
      // rather than clipping is the whole reason this is on the CPU.
      if (!alive || length < 1e-4 || length > MAX_SEGMENT) {
        for (const side of [0, 1]) {
          const o = (vertex + side) * 3
          this.positions[o] = current.x
          this.positions[o + 1] = current.y
          this.positions[o + 2] = current.z
          this.fades[vertex + side] = 0
        }
        continue
      }

      dx /= length
      dz /= length
      // Perpendicular in the ground plane.
      const px = -dz * this.thickness
      const pz = dx * this.thickness

      const left = vertex * 3
      this.positions[left] = current.x + px
      this.positions[left + 1] = current.y
      this.positions[left + 2] = current.z + pz

      const right = (vertex + 1) * 3
      this.positions[right] = current.x - px
      this.positions[right + 1] = current.y
      this.positions[right + 2] = current.z - pz

      // Fade with age, and with whether the wheel was down.
      const age = 1 - i / (this.filled - 1)
      const fade = current.contact * age * age
      this.fades[vertex] = fade
      this.fades[vertex + 1] = fade
    }

    this.positionAttribute.needsUpdate = true
    this.fadeAttribute.needsUpdate = true
  }

  setOpacity(value: number): void {
    this.material.uniforms.uOpacity.value = value
  }

  get opacity(): number {
    return this.baseOpacity
  }

  /** Collapses the whole ribbon. Called after any teleport. */
  clear(position: { x: number; y: number; z: number }): void {
    for (const sample of this.samples) {
      sample.x = position.x
      sample.y = position.y
      sample.z = position.z
      sample.contact = 0
    }
    this.filled = 0
    this.head = 0
    this.lastX = position.x
    this.lastZ = position.z
    this.fades.fill(0)
    this.fadeAttribute.needsUpdate = true
    this.mesh.visible = false
  }
}

export class Tracks {
  readonly group = new THREE.Group()
  private wheels: Track[] = []
  private chassis: Track | null = null
  private enabled: boolean

  constructor(
    private vehicle: PhysicsVehicle,
    private ticker: Ticker,
    quality: Quality,
    bin: Bin,
  ) {
    // Tracks are the first thing to go at LOW: five extra transparent
    // draws for something a phone screen barely resolves.
    this.enabled = quality.settings.trackResolution > 0

    if (this.enabled) {
      for (let i = 0; i < 4; i++) {
        const track = new Track(0.34, palette.ink3, 0.22, bin)
        this.wheels.push(track)
        this.group.add(track.mesh)
      }

      // A wider, much fainter smear under the body.
      this.chassis = new Track(1.1, palette.ink4, 0.06, bin)
      this.group.add(this.chassis.mesh)
    }

    this.reset()

    const update = () => this.update()
    // Order 10, as upstream: after the vehicle's post-physics pass.
    this.ticker.events.on('tick', update, 10)

    bin.add(() => this.ticker.events.off('tick', update))
    bin.object3D(this.group)
  }

  private update(): void {
    if (!this.enabled) return
    const elapsed = this.ticker.elapsed

    for (let i = 0; i < 4; i++) {
      const wheel = this.vehicle.wheels.items[i]
      // Only mark the ground when the tyre is actually loaded. A wheel
      // dangling in mid-air over tarmac should leave nothing.
      this.wheels[i].update(wheel.contactPoint, wheel.inContact, elapsed)
    }

    // The body smear needs the ground, not the chassis origin, or it
    // floats a metre above its own tyre marks.
    const position = this.vehicle.position
    const wheel = this.vehicle.wheels.items[0]
    const groundY = wheel.contactPoint?.y ?? position.y - 1.1
    this.chassis?.update(
      { x: position.x, y: groundY, z: position.z },
      this.vehicle.wheels.inContactCount > 2,
      elapsed,
    )

    // Fade out at very low speed so a parked car does not sit on top
    // of the smear it made while arriving.
    const fade = clamp(this.vehicle.xzSpeed / 4, 0, 1)
    for (const track of this.wheels) track.setOpacity(track.opacity * fade)
    if (this.chassis) this.chassis.setOpacity(this.chassis.opacity * fade)
  }

  /** Called after a teleport, so no ribbon stretches across the map. */
  reset(): void {
    if (!this.enabled) return
    const position = this.vehicle.position
    for (const track of this.wheels) track.clear(position)
    this.chassis?.clear(position)
  }
}
