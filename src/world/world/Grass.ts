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
  /** Radial band this ring covers: fade in over .xy, out over .zw. */
  uniform vec4  uBand;

  attribute vec2  aBlade;
  attribute float aCorner;
  attribute float aHeightRandom;

  varying float vTipness;
  varying float vGrass;
  varying float vDepth;
  varying float vCrushed;

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

    // Two scales of variation: broad patches at ~30 m, and tufts at
    // ~3 m. Without the second the field is an even pile of spikes;
    // with it the ground reads as grass that grew somewhere.
    float broad = 0.45 + noise(world * 0.0321) * 0.85;   // 'patch' is reserved in GLSL
    float tuft  = 0.55 + noise(world * 0.34) * 0.9;

    // This ring's radial band. Blades grow in over the inner edge and
    // shrink away over the outer one, so a ring never has a boundary:
    // its blades are already zero-height where it stops. The near ring
    // hands over to the far ring inside the band they share.
    float fromEye = length(looped);
    float band = smoothstep(uBand.x, uBand.y, fromEye)
               * (1.0 - smoothstep(uBand.z, uBand.w, fromEye));

    float height = uBladeHeight
      * (0.4 + 0.6 * aHeightRandom)
      * broad * tuft
      * grass * band;
    float width = uBladeWidth * grass * mix(0.55, 1.0, band);

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

    // The car flattens what it drives through: the blade ROTATES about
    // its root by up to ~72°, which moves the tip a long way without
    // ever making the blade longer than it was. Pushing the tip out by
    // a multiple of the height — which is what this did — grew a 0.6 m
    // blade into a metre-long spike, and a parked car sat in a
    // starburst of them.
    vec2 fromCar = world - uCar.xz;
    float reach = length(fromCar);
    float crushed = (1.0 - smoothstep(1.0, 2.9, reach)) * step(abs(groundY - uCar.y), 2.4);
    float lay = crushed * 1.26;
    position.xz += normalize(fromCar + vec2(1e-4)) * (height * sin(lay)) * vTipness;
    position.y -= height * (1.0 - cos(lay)) * vTipness;
    vCrushed = crushed;

    vec4 view = viewMatrix * vec4(position, 1.0);
    vDepth = -view.z;

    // A blade with no grass under it — or none left after the radial
    // band — is pushed out of the frustum rather than degenerated, so
    // the triangle count stays static.
    view.y += step(grass * band, 0.02) * 10000.0;
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
  varying float vCrushed;

  void main() {
    // Darker at the root: a free ambient-occlusion cue that stops the
    // field reading as a flat green sheet from above.
    vec3 colour = mix(uRoot, uTip, vTipness * 0.85 + 0.15);
    colour *= 0.84 + 0.16 * vGrass;
    // A blade laid flat is showing its face to the sky, so it reads
    // LIGHTER, not darker. Without this the flattened patch under the
    // car looked like a scorch mark rather than like trodden grass.
    colour = mix(colour, uTip * 1.06, vCrushed * 0.55);

    float fog = smoothstep(uFogNear, uFogFar, vDepth);
    gl_FragColor = vec4(mix(colour, uFogColor, fog), 1.0);
  }
`

/** One toroidal ring of the clipmap. */
interface RingSpec {
  /** Square edge, metres. Must be at least twice `bandOut`. */
  size: number
  /** Blades along one edge. */
  subdivisions: number
  /** Blade width and height multipliers. */
  scale: number
  /** [fadeInStart, fadeInEnd, fadeOutStart, fadeOutEnd] radii, metres. */
  band: [number, number, number, number]
}

class Ring {
  readonly mesh: THREE.Mesh
  readonly bladeCount: number
  readonly material: THREE.ShaderMaterial
  private readonly geometry: THREE.BufferGeometry
  private readonly size: number

  constructor(terrain: Terrain, quality: Quality, bin: Bin, spec: RingSpec) {
    this.size = spec.size
    const subdivisions = spec.subdivisions
    const count = subdivisions * subdivisions
    this.bladeCount = count
    const fragment = this.size / subdivisions

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
        uBand: { value: new THREE.Vector4(...spec.band) },
        uBladeWidth: { value: 0.1 * spec.scale },
        uBladeHeight: { value: 0.6 * spec.scale },
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

/* ============================================================
   THE CLIPMAP

   One ring is upstream's design and it is right up to about
   thirty metres, which is as far as upstream's camera looks.
   This camera pulls back to a thirty-metre boom on a
   twenty-five-degree lens, so the ground is still legible at
   eighty — and a single 72 m field put its own corner inside
   the frame. That corner is the "circle of grass around the
   car" the brief describes.

   So: nested rings, like a shadow clipmap. Each is a toroidal
   field of its own — nothing is ever allocated, streamed or
   respawned, which is the property worth keeping — and each
   covers a radial BAND, growing in at its inner edge and
   shrinking away at its outer one. The near ring is dense and
   fine; the far ring is a quarter of the density with blades
   twice the size, which at sixty metres is indistinguishable
   and costs a third of the vertices.

   Because the bands overlap and every blade goes to zero
   height at both ends of its own band, there is no boundary
   anywhere: not between the rings, and not at the outside,
   where the last blades shrink into terrain that is already
   painted green.
   ============================================================ */

export class Grass {
  readonly group = new THREE.Group()
  readonly rings: Ring[] = []
  readonly bladeCount: number
  /** Kept for the QA harness, which reads the near ring's extent. */
  readonly size: number

  constructor(terrain: Terrain, quality: Quality, bin: Bin) {
    const density = quality.settings.density

    // Upstream's ratio is ~21 blades/m². The near ring holds it; the
    // far ring trades density for reach and grows its blades to match.
    const near: RingSpec = {
      size: 64,
      subdivisions: quality.count(330, 132),
      scale: 1,
      band: [-1, 0, 24, 31],
    }
    const far: RingSpec = {
      size: 190,
      subdivisions: quality.count(300, 0),
      scale: 2.35,
      band: [22, 30, 74, 92],
    }

    this.rings.push(new Ring(terrain, quality, bin, near))
    // The far ring is the first thing to go on a weak machine: without
    // it the near ring simply reaches its own edge, which is where it
    // was before, and a low-quality device is not running a 30 m boom
    // over open country anyway.
    if (density > 0.55) this.rings.push(new Ring(terrain, quality, bin, far))

    for (const ring of this.rings) this.group.add(ring.mesh)
    this.bladeCount = this.rings.reduce((n, r) => n + r.bladeCount, 0)
    this.size = near.size
    bin.add(() => this.group.removeFromParent())
  }

  /** Recentre every ring on the camera. Two uniform writes. */
  update(camera: THREE.Vector3, car: THREE.Vector3, wind: THREE.Vector2, elapsed: number): void {
    for (const ring of this.rings) ring.update(camera, car, wind, elapsed)
  }

  setFog(color: THREE.Color, near: number, far: number): void {
    for (const ring of this.rings) ring.setFog(color, near, far)
  }
}
