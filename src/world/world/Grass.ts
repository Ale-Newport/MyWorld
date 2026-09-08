import * as THREE from 'three'
import type { Quality } from '../core/Quality'
import type { Bin } from '../core/Disposal'
import type { Terrain } from './Terrain'

/* ============================================================
   GRASS

   PORTED FROM sources/Game/World/Grass.js (folio-2025, MIT —
   Copyright (c) 2025 Bruno Simon). The design is upstream's: one
   fixed-size field of billboarded blades that FOLLOWS THE CAMERA
   and wraps toroidally around it, so a constant number of blades
   always covers the visible ground and nothing is allocated,
   culled or respawned at runtime.

   Upstream is WebGPU/TSL. This is WebGL, so the vertex program is
   GLSL on a ShaderMaterial, and the ground data it reads is this
   project's own baked mask rather than an authored texture. The
   numbers — 280 subdivisions, 0.1 m blade width, 0.6 m height,
   0.6 height randomness, the 0.0321 noise frequency — are
   upstream's, because they are what makes it read as a lawn
   rather than as scattered spikes.

   Why this exists: scattering blades over the whole island, which
   is what the ecology layer does, gives about 0.1 per m². Upstream
   runs ~21 per m² across the small patch you can actually see.
   That is the difference between "there is grass" and "the ground
   is grass", and it was the largest single visual gap this route
   had against the reference.

   Two things here are ours rather than upstream's: blades sit on
   the real terrain height, sampled from the mask, instead of on a
   flat plane; and the car flattens what it drives through.
   ============================================================ */

const VERTEX = /* glsl */`
  uniform vec2  uCenter;
  uniform float uSize;
  uniform float uBladeWidth;
  uniform float uBladeHeight;
  uniform float uTime;
  uniform vec2  uWind;
  uniform vec3  uCar;
  uniform sampler2D uMask;
  uniform float uMaskExtent;
  uniform float uHeightBias;
  uniform float uHeightScale;

  attribute vec2  aBlade;
  attribute float aCorner;
  attribute float aHeightRandom;

  varying float vTipness;
  varying float vGrass;
  varying float vDepth;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    // Corner 0 is the tip. Only the tip moves, which is what makes a
    // blade look hinged at the root instead of sliding about.
    vTipness = step(aCorner, 0.5);

    // Wrap the blade's home position into the square centred on the
    // camera. Every blade is always in view; none is ever respawned.
    float halfSize = uSize * 0.5;
    vec2 looped = mod(aBlade - uCenter + halfSize, uSize) - halfSize;
    vec2 world = looped + uCenter;

    vec4 ground = texture2D(uMask, world / (uMaskExtent * 2.0) + 0.5);
    float grass = ground.g;
    vGrass = grass;
    float groundY = ground.a * uHeightScale + uHeightBias;

    float height = uBladeHeight
      * (0.4 + 0.6 * aHeightRandom)
      * (0.5 + noise(world * 0.0321))
      * grass;
    float width = uBladeWidth * grass;

    // Blade shape in its own plane: tip up, two corners at the root.
    vec2 shape = aCorner < 0.5 ? vec2(0.0, height)
               : aCorner < 1.5 ? vec2(width, 0.0)
                               : vec2(-width, 0.0);

    // Billboard about the blade's own root, so it always faces the
    // camera and never shows its zero-thickness edge.
    vec3 toCamera = cameraPosition - vec3(world.x, groundY, world.y);
    float angle = atan(toCamera.x, toCamera.z);
    vec3 right = vec3(cos(angle), 0.0, -sin(angle));

    vec3 position = vec3(world.x, groundY, world.y) + right * shape.x;
    position.y += shape.y;

    // Wind bends the tip, and varies across the field so the whole
    // lawn does not breathe in unison.
    float gust = noise(world * 0.02 + uWind * uTime * 0.06) - 0.5;
    position.xz += uWind * gust * vTipness * height * 2.0;

    // The car flattens what it drives through. Blades spring back as
    // it leaves, because nothing here remembers being crushed.
    vec2 fromCar = world - uCar.xz;
    float reach = length(fromCar);
    float crushed = (1.0 - smoothstep(1.2, 3.6, reach)) * step(abs(groundY - uCar.y), 3.0);
    position.xz += normalize(fromCar + vec2(1e-4)) * crushed * vTipness * height * 0.9;
    position.y -= crushed * vTipness * height * 0.8;

    vec4 view = viewMatrix * vec4(position, 1.0);
    vDepth = -view.z;

    // A blade with no grass under it is pushed out of the frustum
    // rather than degenerated, so the triangle count stays static.
    view.y += step(grass, 0.02) * 10000.0;
    gl_Position = projectionMatrix * view;
  }
`

const FRAGMENT = /* glsl */`
  precision highp float;

  uniform vec3  uRoot;
  uniform vec3  uTip;
  uniform vec3  uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;

  varying float vTipness;
  varying float vGrass;
  varying float vDepth;

  void main() {
    // Darker at the root: a free ambient-occlusion cue that stops the
    // field reading as a flat green sheet from above.
    vec3 colour = mix(uRoot, uTip, vTipness * 0.85 + 0.15);
    colour *= 0.84 + 0.16 * vGrass;

    float fog = smoothstep(uFogNear, uFogFar, vDepth);
    gl_FragColor = vec4(mix(colour, uFogColor, fog), 1.0);
  }
`

export class Grass {
  readonly mesh: THREE.Mesh
  readonly bladeCount: number
  private readonly material: THREE.ShaderMaterial
  private readonly geometry: THREE.BufferGeometry
  private readonly size: number

  constructor(terrain: Terrain, quality: Quality, bin: Bin) {
    // Upstream's field is ~61 m across carrying 280² blades, which is
    // ~21 per m². Matching the RATIO matters more than matching either
    // number: a bigger field at the same count is a thinner lawn.
    this.size = Math.round(46 + 26 * quality.settings.density)
    const subdivisions = quality.count(340, 110)
    const count = subdivisions * subdivisions
    this.bladeCount = count
    const fragment = this.size / subdivisions

    // Upstream grows the blades as the visible area grows, so a
    // sparser field still covers the ground rather than pin-cushioning.
    const ideal = 2000
    // Capped: past a point, growing the blades to cover a thinner field
    // stops reading as grass and starts reading as a field of spikes.
    const overflow = Math.min(1, Math.max(0, this.size * this.size - ideal) / ideal)

    const blade = new Float32Array(count * 3 * 2)
    const corner = new Float32Array(count * 3)
    const random = new Float32Array(count * 3)
    for (let ix = 0; ix < subdivisions; ix++) {
      const cellX = (ix / subdivisions - 0.5) * this.size + fragment * 0.5
      for (let iz = 0; iz < subdivisions; iz++) {
        const cellZ = (iz / subdivisions - 0.5) * this.size + fragment * 0.5
        const index = ix * subdivisions + iz
        // Jitter inside the cell, or the field reads as a grid.
        const x = cellX + (Math.random() - 0.5) * fragment
        const z = cellZ + (Math.random() - 0.5) * fragment
        const r = Math.random()
        for (let v = 0; v < 3; v++) {
          blade[index * 6 + v * 2] = x
          blade[index * 6 + v * 2 + 1] = z
          corner[index * 3 + v] = v
          random[index * 3 + v] = r
        }
      }
    }

    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('aBlade', new THREE.BufferAttribute(blade, 2))
    this.geometry.setAttribute('aCorner', new THREE.BufferAttribute(corner, 1))
    this.geometry.setAttribute('aHeightRandom', new THREE.BufferAttribute(random, 1))
    // three.js needs a `position` to derive the draw range from; the
    // vertex program never reads it.
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 9), 3))
    // The field moves with the camera every frame, so any bounding
    // volume would be wrong the moment it was computed.
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1)

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uCenter: { value: new THREE.Vector2() },
        uSize: { value: this.size },
        uBladeWidth: { value: 0.1 * (1 + overflow * 0.5) },
        uBladeHeight: { value: 0.6 * (1 + overflow * 0.5) },
        uTime: { value: 0 },
        uWind: { value: new THREE.Vector2(1, 0.35) },
        uCar: { value: new THREE.Vector3() },
        uMask: { value: terrain.mask },
        uMaskExtent: { value: terrain.maskExtent },
        uHeightBias: { value: terrain.maskHeightBias },
        uHeightScale: { value: terrain.maskHeightScale },
        uRoot: { value: new THREE.Color('#5b7442') },
        uTip: { value: new THREE.Color('#96ad61') },
        uFogColor: { value: new THREE.Color('#dfe3d2') },
        uFogNear: { value: quality.settings.drawDistance * 0.45 },
        uFogFar: { value: quality.settings.drawDistance },
      },
      side: THREE.DoubleSide,
    })

    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.receiveShadow = false
    this.mesh.castShadow = false
    bin.add(() => { this.geometry.dispose(); this.material.dispose() })
  }

  /** Recentre on the camera. One uniform write; nothing is rebuilt. */
  update(camera: THREE.Vector3, car: THREE.Vector3, wind: THREE.Vector2, elapsed: number): void {
    const u = this.material.uniforms
    // Snap to a sub-cell grid so the field does not shimmer as it slides.
    const cell = this.size / 128
    u.uCenter.value.set(Math.round(camera.x / cell) * cell, Math.round(camera.z / cell) * cell)
    u.uTime.value = elapsed
    u.uWind.value.copy(wind)
    u.uCar.value.copy(car)
  }

  setFog(color: THREE.Color, near: number, far: number): void {
    this.material.uniforms.uFogColor.value.copy(color)
    this.material.uniforms.uFogNear.value = near
    this.material.uniforms.uFogFar.value = far
  }
}
