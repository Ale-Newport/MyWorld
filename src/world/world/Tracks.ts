import * as THREE from 'three'
import { palette } from '../core/palette'
import { clamp } from '../core/maths'
import type { Bin } from '../core/Disposal'
import type { Ticker } from '../core/Ticker'
import type { Quality } from '../core/Quality'
import type { PhysicsVehicle } from '../physics/PhysicsVehicle'

/* ============================================================
   TYRE TRACKS

   Ported from sources/Game/Tracks.js + Trails.js (folio-2025,
   MIT — Copyright (c) 2025 Bruno Simon). See THIRD_PARTY_NOTICES.md.

   Each track is a ring buffer of 128 samples — position plus a
   "was the wheel touching" flag — uploaded as a float DataTexture
   and read in the vertex shader. The ribbon geometry is a
   128-segment strip whose vertices are pushed sideways from the
   path by the shader, perpendicular to the direction of travel.
   So the CPU writes four floats a frame and the GPU builds the
   whole ribbon; there is no per-frame geometry rebuild.

   The double throttle is upstream's and matters: a sample is only
   taken when at least 1/30 s AND 0.2 m have passed. Time alone
   fills the buffer while parked; distance alone samples densely
   at speed and sparsely when crawling. Both together give an
   even 25 m of remembered track at any speed.

   One upstream detail worth keeping: the touching flag is
   interpolated along the ribbon, so a wheel leaving the ground
   fades its mark out rather than cutting it off.

   Upstream renders these into a 512² render target that the
   ground, grass and snow shaders all sample. This draws them
   straight into the scene instead: without grass or snow to feed,
   the render target is a pass and a texture for no benefit.
   ============================================================ */

const SUBDIVISIONS = 128
const TIME_THROTTLE = 1 / 30
const DISTANCE_THROTTLE = 0.2

const VERTEX = /* glsl */ `
  uniform sampler2D uData;
  uniform float uSubdivisions;
  uniform float uThickness;

  varying vec4 vTrackData;
  varying vec2 vTrackUv;

  void main() {
    vTrackUv = uv;

    float fragmentSize = 1.0 / uSubdivisions;
    // The half-texel offset lands exactly on texel centres, which is
    // why NEAREST filtering here is identical to LINEAR — and why
    // this does not need the float-linear extension.
    float ratio = uv.x - fragmentSize * 0.5;

    vec4 current  = texture2D(uData, vec2(ratio, 0.5));
    vec4 previous = texture2D(uData, vec2(ratio - fragmentSize, 0.5));

    vTrackData = current;

    float angle = atan(current.z - previous.z, current.x - previous.x);
    float side = -sign(position.y);
    float a = angle + side * 1.5707963267948966;
    vec2 offset = vec2(cos(a), sin(a)) * uThickness;

    vec3 world = vec3(current.x + offset.x, current.y, current.z + offset.y);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
  }
`

const FRAGMENT = /* glsl */ `
  precision highp float;

  varying vec4 vTrackData;
  varying vec2 vTrackUv;

  uniform vec3 uColor;
  uniform float uOpacity;

  void main() {
    // Fade out along the length: the far end of the buffer is the
    // oldest sample and should already be gone.
    float endAlpha   = 1.0 - smoothstep(0.45, 1.0, vTrackUv.x);
    float startAlpha = smoothstep(0.0, 0.05, vTrackUv.x);
    // Interpolated contact flag: a wheel lifting fades its mark.
    float contact    = clamp(vTrackData.a, 0.0, 1.0);
    // Soften the ribbon's own edges so it is a smear, not a decal.
    float edgeAlpha  = 1.0 - abs(vTrackUv.y - 0.5) * 2.0;
    edgeAlpha = smoothstep(0.0, 0.55, edgeAlpha);

    float alpha = endAlpha * startAlpha * contact * edgeAlpha * uOpacity;
    if (alpha < 0.004) discard;

    gl_FragColor = vec4(uColor, alpha);
    #include <colorspace_fragment>
  }
`

class Track {
  readonly mesh: THREE.Mesh
  private data: Float32Array
  private texture: THREE.DataTexture
  private material: THREE.ShaderMaterial

  private lastTime = 0
  private readonly lastPosition = new THREE.Vector3()
  private readonly scratch = new THREE.Vector3()

  constructor(thickness: number, color: string, opacity: number, bin: Bin) {
    this.data = new Float32Array(SUBDIVISIONS * 4)
    this.texture = new THREE.DataTexture(
      this.data, SUBDIVISIONS, 1, THREE.RGBAFormat, THREE.FloatType,
    )
    this.texture.minFilter = THREE.NearestFilter
    this.texture.magFilter = THREE.NearestFilter
    this.texture.wrapS = THREE.ClampToEdgeWrapping
    this.texture.wrapT = THREE.ClampToEdgeWrapping
    this.texture.generateMipmaps = false
    this.texture.needsUpdate = true

    const geometry = new THREE.PlaneGeometry(1, 1, SUBDIVISIONS, 1)
    geometry.translate(0.5, 0, 0)

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      // Marks are darker than the ground, so this is ordinary alpha
      // blending rather than upstream's additive — that only makes
      // sense when the result is being sampled to subtract elsewhere.
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uData: { value: this.texture },
        uSubdivisions: { value: SUBDIVISIONS },
        uThickness: { value: thickness },
        uColor: { value: new THREE.Color(color) },
        uOpacity: { value: opacity },
      },
    })

    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 3
    this.mesh.matrixAutoUpdate = false

    bin.add(() => {
      geometry.dispose()
      this.material.dispose()
      this.texture.dispose()
    })
  }

  /** Records the head sample and, when both throttles pass, shifts. */
  update(position: { x: number; y: number; z: number } | null, touching: boolean, elapsed: number): void {
    if (!position) {
      this.data[3] = 0
      this.texture.needsUpdate = true
      return
    }

    if (elapsed - this.lastTime > TIME_THROTTLE) {
      this.scratch.set(position.x, position.y, position.z)
      if (this.lastPosition.distanceTo(this.scratch) > DISTANCE_THROTTLE) {
        // Shift by one texel. Stops at 1: index 0 is the head and is
        // written unconditionally below, and reading index -4 (which
        // upstream does) is only harmless by accident.
        for (let i = SUBDIVISIONS - 1; i >= 1; i--) {
          const to = i * 4
          const from = to - 4
          this.data[to] = this.data[from]
          this.data[to + 1] = this.data[from + 1]
          this.data[to + 2] = this.data[from + 2]
          this.data[to + 3] = this.data[from + 3]
        }
        this.lastTime = elapsed
        this.lastPosition.copy(this.scratch)
      }
    }

    this.data[0] = position.x
    // Lifted a little so the ribbon never z-fights the ground it
    // is drawn on.
    this.data[1] = position.y + 0.035
    this.data[2] = position.z
    this.data[3] = touching ? 1 : 0
    this.texture.needsUpdate = true
  }

  setOpacity(value: number): void {
    this.material.uniforms.uOpacity.value = value
  }

  /** Clears the buffer. Used on respawn so no ribbon spans the map. */
  clear(position: { x: number; y: number; z: number }): void {
    for (let i = 0; i < SUBDIVISIONS; i++) {
      const i4 = i * 4
      this.data[i4] = position.x
      this.data[i4 + 1] = position.y
      this.data[i4 + 2] = position.z
      this.data[i4 + 3] = 0
    }
    this.lastPosition.set(position.x, position.y, position.z)
    this.texture.needsUpdate = true
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
    // Tracks are the first thing to go at LOW: they are five extra
    // transparent draws for something a phone screen barely resolves.
    this.enabled = quality.settings.trackResolution > 0

    if (this.enabled) {
      for (let i = 0; i < 4; i++) {
        // 0.5 half-width — a one-metre ribbon, upstream's value.
        const track = new Track(0.5, palette.ink2, 0.4, bin)
        this.wheels.push(track)
        this.group.add(track.mesh)
      }

      // A wider, fainter mark under the body. Upstream uses it to
      // carve snow; here it is the shadow a car leaves on dust.
      this.chassis = new Track(1.5, palette.ink3, 0.14, bin)
      this.group.add(this.chassis.mesh)
    }

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
      // Only mark the ground when the tyre is actually loaded. A
      // wheel dangling in mid-air over tarmac should leave nothing.
      this.wheels[i].update(wheel.contactPoint, wheel.inContact, elapsed)
    }

    // The body mark only appears when the car is low enough for it
    // to make sense — airborne, there is nothing under it.
    const position = this.vehicle.position
    this.chassis?.update(position, position.y < 2.2, elapsed)

    // Fade everything out at very low speed so a parked car does not
    // sit on top of a smear it made while arriving.
    const fade = clamp(this.vehicle.xzSpeed / 3, 0, 1)
    for (const track of this.wheels) track.setOpacity(0.4 * fade)
    this.chassis?.setOpacity(0.14 * fade)
  }

  /** Called after a teleport, so no ribbon stretches across the map. */
  reset(): void {
    if (!this.enabled) return
    const position = this.vehicle.position
    for (const track of this.wheels) track.clear(position)
    this.chassis?.clear(position)
  }
}
