import * as THREE from 'three'
import { palette } from '../core/palette'
import { clamp, seeded, smoothstep } from '../core/maths'
import type { Bin } from '../core/Disposal'
import type { Quality } from '../core/Quality'
import type { Physics } from '../physics/Physics'
import type { Materials } from './materials'
import { districts, roads, WORLD_RADIUS, type District } from '@/content/world'

/* ============================================================
   TERRAIN

   Approach adapted from sources/Game/Terrain.js + World/Floor.js
   (folio-2025, MIT — Copyright (c) 2025 Bruno Simon), which
   drives a Rapier heightfield from a texture. Here the height
   comes from a pure function instead, which has one large
   advantage: `heightAt(x, z)` is available to every other system
   — landmark placement, prop scattering, the map, the minimap
   marker — so nothing has to raycast just to find the ground.

   THE RULE: the collider and the visible mesh are generated from
   the same function at the same resolution. If they ever diverge,
   the car drives through the floor in one place and floats in
   another, and that is the single worst bug this route can have.
   Visual detail is reduced by quality; the COLLIDER NEVER IS.

   Layout, top-down (+X east, +Z south):
     - a broad, almost flat plain out to ~250 m
     - gentle rolling noise, ±1.4 m, so the suspension has work
     - every district flattened to a plate at its own elevation
     - roads cut flat corridors between them
     - past `WORLD_RADIUS` the ground falls away into the void,
       which is both the map edge and the OUT OF BOUNDS achievement
   ============================================================ */

/** Collider resolution. Identical at every quality level. */
const COLLIDER_SEGMENTS = 320
/** Half-width of the heightfield, metres. */
const FIELD_HALF = 400

const rand = seeded(20260908)
/** Four octaves of value noise, precomputed offsets. */
const OCTAVES = Array.from({ length: 4 }, () => ({
  ox: rand() * 1000,
  oz: rand() * 1000,
}))

function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123
  return s - Math.floor(s)
}

function valueNoise(x: number, z: number): number {
  const xi = Math.floor(x)
  const zi = Math.floor(z)
  const xf = x - xi
  const zf = z - zi
  const u = xf * xf * (3 - 2 * xf)
  const v = zf * zf * (3 - 2 * zf)

  const a = hash2(xi, zi)
  const b = hash2(xi + 1, zi)
  const c = hash2(xi, zi + 1)
  const d = hash2(xi + 1, zi + 1)

  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

function fbm(x: number, z: number): number {
  let amplitude = 1
  let frequency = 1
  let sum = 0
  let norm = 0
  for (const octave of OCTAVES) {
    sum += valueNoise(x * frequency + octave.ox, z * frequency + octave.oz) * amplitude
    norm += amplitude
    amplitude *= 0.5
    frequency *= 2.1
  }
  return sum / norm
}

/** Distance from a point to a polyline, and the segment parameter. */
function distanceToPolyline(x: number, z: number, points: [number, number][]): number {
  let best = Infinity
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i]
    const [bx, bz] = points[i + 1]
    const dx = bx - ax
    const dz = bz - az
    const lengthSq = dx * dx + dz * dz || 1e-6
    const t = clamp(((x - ax) * dx + (z - az) * dz) / lengthSq, 0, 1)
    const px = ax + dx * t
    const pz = az + dz * t
    const distance = Math.hypot(x - px, z - pz)
    if (distance < best) best = distance
  }
  return best
}

/** Elevation of each district's plate. Most sit at zero. */
const DISTRICT_ELEVATION: Partial<Record<string, number>> = {
  lab: -1.4,
  ucl: 1.8,
  kcl: 0.6,
  circuit: 0,
  voxel: 0.9,
  labyrinth: 0.4,
  network: -0.8,
  archive: -0.4,
  void: -14,
}

export interface TerrainSample {
  height: number
  /** Nearest district, if the point is inside one. */
  district: District | null
  /** 0..1, how strongly the point sits on a road. */
  road: number
}

export class Terrain {
  readonly group = new THREE.Group()
  mesh!: THREE.Mesh

  private colliderHeights!: Float32Array
  private step = (FIELD_HALF * 2) / COLLIDER_SEGMENTS

  constructor(
    private physics: Physics,
    private quality: Quality,
    private materials: Materials,
    bin: Bin,
  ) {
    this.buildCollider()
    this.buildMesh(bin)
    bin.object3D(this.group)
  }

  /* ========================================================
     HEIGHT FIELD
     ======================================================== */

  /**
   * The ground elevation anywhere in the world. Pure, cheap, and
   * the single source of truth for both the collider and the mesh.
   */
  heightAt(x: number, z: number): number {
    const radius = Math.hypot(x, z)

    // Past the edge, the ground falls away. Not a wall: driving off
    // is allowed, and is its own achievement.
    if (radius > WORLD_RADIUS) {
      const over = radius - WORLD_RADIUS
      return -Math.pow(over * 0.12, 1.7) - 0.5
    }

    // Rolling base. Deliberately gentle — the suspension should have
    // something to do, but nothing should launch the car unbidden.
    let height = (fbm(x * 0.0042, z * 0.0042) - 0.5) * 2.8
    height += (fbm(x * 0.017, z * 0.017) - 0.5) * 0.55

    // A soft rim so the world reads as an island rather than a
    // rectangle that stops.
    height += smoothstep(radius, WORLD_RADIUS - 90, WORLD_RADIUS) * 3.2

    // District plates. Each flattens its footprint towards its own
    // elevation, with a shoulder so the transition is drivable.
    for (const district of districts) {
      const distance = Math.hypot(x - district.x, z - district.z)
      if (distance > district.radius * 1.55) continue
      const inside = 1 - smoothstep(distance, district.radius * 0.72, district.radius * 1.5)
      const target = DISTRICT_ELEVATION[district.id] ?? 0
      height = height * (1 - inside) + target * inside
    }

    // Roads flatten a corridor between whatever they connect.
    for (const road of roads) {
      const distance = distanceToPolyline(x, z, road.points)
      const half = road.width * 0.5
      if (distance > half * 3) continue
      const on = 1 - smoothstep(distance, half, half * 2.6)
      if (on <= 0) continue
      // The road surface follows the terrain it was flattened onto,
      // just without the small noise, so hills stay but ruts do not.
      const smooth = (fbm(x * 0.0042, z * 0.0042) - 0.5) * 2.8
      let roadHeight = smooth + smoothstep(radius, WORLD_RADIUS - 90, WORLD_RADIUS) * 3.2
      for (const district of districts) {
        const dd = Math.hypot(x - district.x, z - district.z)
        if (dd > district.radius * 1.55) continue
        const inside = 1 - smoothstep(dd, district.radius * 0.72, district.radius * 1.5)
        roadHeight = roadHeight * (1 - inside) + (DISTRICT_ELEVATION[district.id] ?? 0) * inside
      }
      height = height * (1 - on) + roadHeight * on
    }

    return height
  }

  /** Full sample, for placement code that also wants context. */
  sample(x: number, z: number): TerrainSample {
    let district: District | null = null
    let bestDistance = Infinity
    for (const item of districts) {
      const distance = Math.hypot(x - item.x, z - item.z)
      if (distance < item.radius && distance < bestDistance) {
        bestDistance = distance
        district = item
      }
    }

    let road = 0
    for (const item of roads) {
      const distance = distanceToPolyline(x, z, item.points)
      road = Math.max(road, 1 - smoothstep(distance, item.width * 0.42, item.width * 0.62))
    }

    return { height: this.heightAt(x, z), district, road }
  }

  /* ========================================================
     COLLIDER
     ======================================================== */

  private buildCollider(): void {
    const n = COLLIDER_SEGMENTS + 1
    const heights = new Float32Array(n * n)

    // Rapier's heightfield indexes [i * (ncols + 1) + j] with i along
    // Z and j along X. Getting this transposed is the classic way to
    // end up with a world that collides 90° out from what you see.
    for (let i = 0; i < n; i++) {
      const z = -FIELD_HALF + i * this.step
      for (let j = 0; j < n; j++) {
        const x = -FIELD_HALF + j * this.step
        heights[i * n + j] = this.heightAt(x, z)
      }
    }

    this.colliderHeights = heights

    this.physics.add({
      type: 'fixed',
      category: 'floor',
      friction: 1,
      restitution: 0,
      colliders: [
        {
          shape: 'heightfield',
          parameters: [
            COLLIDER_SEGMENTS,
            COLLIDER_SEGMENTS,
            heights,
            { x: FIELD_HALF * 2, y: 1, z: FIELD_HALF * 2 },
          ],
        },
      ],
    })
  }

  /** Bilinear read of the collider grid — matches physics exactly. */
  colliderHeightAt(x: number, z: number): number {
    const n = COLLIDER_SEGMENTS + 1
    const fx = (x + FIELD_HALF) / this.step
    const fz = (z + FIELD_HALF) / this.step
    const j = clamp(Math.floor(fx), 0, COLLIDER_SEGMENTS - 1)
    const i = clamp(Math.floor(fz), 0, COLLIDER_SEGMENTS - 1)
    const tx = clamp(fx - j, 0, 1)
    const tz = clamp(fz - i, 0, 1)

    const h00 = this.colliderHeights[i * n + j]
    const h10 = this.colliderHeights[i * n + j + 1]
    const h01 = this.colliderHeights[(i + 1) * n + j]
    const h11 = this.colliderHeights[(i + 1) * n + j + 1]

    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz
  }

  /* ========================================================
     MESH
     ======================================================== */

  private buildMesh(bin: Bin): void {
    // Visual resolution follows quality; the collider above does not.
    const segments =
      this.quality.level === 'high' ? COLLIDER_SEGMENTS
        : this.quality.level === 'medium' ? 200
        : 128

    const geometry = new THREE.PlaneGeometry(FIELD_HALF * 2, FIELD_HALF * 2, segments, segments)
    geometry.rotateX(-Math.PI / 2)

    const position = geometry.getAttribute('position') as THREE.BufferAttribute
    const colors = new Float32Array(position.count * 3)

    const grass = new THREE.Color(palette.paper2)
    const plate = new THREE.Color(palette.paper)
    const asphalt = new THREE.Color(palette.concrete)
    const deep = new THREE.Color(palette.paper4)
    const scratch = new THREE.Color()

    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i)
      const z = position.getZ(i)
      // Sample the collider grid, not `heightAt`, so a lower-detail
      // visual mesh still sits exactly on the surface the car drives
      // on rather than on its own smoother version of it.
      const height = this.colliderHeightAt(x, z)
      position.setY(i, height)

      const sample = this.sample(x, z)
      scratch.copy(grass)

      if (sample.district) {
        const distance = Math.hypot(x - sample.district.x, z - sample.district.z)
        const inside = 1 - smoothstep(distance, sample.district.radius * 0.6, sample.district.radius)
        const target = sample.district.theme === 'dark' ? deep : plate
        scratch.lerp(target, inside * 0.85)
        if (sample.district.theme === 'dark') {
          scratch.lerp(new THREE.Color(palette.voidDark3), inside * 0.8)
        }
      }

      if (sample.road > 0) scratch.lerp(asphalt, sample.road * 0.9)

      // A little tonal noise stops the large flats from banding.
      const grain = (hash2(x * 3.7, z * 3.7) - 0.5) * 0.022
      colors[i * 3] = clamp(scratch.r + grain, 0, 1)
      colors[i * 3 + 1] = clamp(scratch.g + grain, 0, 1)
      colors[i * 3 + 2] = clamp(scratch.b + grain, 0, 1)
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.computeVertexNormals()

    const material = this.materials.own(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.96,
        metalness: 0,
        flatShading: false,
      }),
    )

    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.receiveShadow = this.quality.settings.shadows
    this.mesh.matrixAutoUpdate = false
    this.mesh.updateMatrix()
    this.group.add(this.mesh)
    bin.add(() => geometry.dispose())
  }

  /** Places an object on the ground, returning the surface height. */
  place(object: THREE.Object3D, x: number, z: number, offset = 0): number {
    const height = this.colliderHeightAt(x, z)
    object.position.set(x, height + offset, z)
    return height
  }
}
