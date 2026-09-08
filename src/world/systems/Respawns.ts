import * as THREE from 'three'
import { respawns as respawnData, type Respawn as RespawnData } from '@/content/world'

/* ============================================================
   RESPAWNS
   Adapted from sources/Game/Respawns.js (folio-2025, MIT —
   Copyright (c) 2025 Bruno Simon). Upstream reads respawn points
   out of a Blender scene; ours come from `src/content/world.ts`,
   which keeps them next to the districts they belong to.

   Every point spawns the car 4 m up so it drops onto whatever is
   below rather than clipping through it — upstream's trick, and
   it is why respawning near a ramp does not fire you into orbit.
   ============================================================ */

export interface RespawnPoint {
  name: string
  position: THREE.Vector3
  rotation: number
  district?: string
  /** Hidden respawns only become targets once discovered. */
  enabled: boolean
}

export class Respawns {
  readonly items = new Map<string, RespawnPoint>()
  private defaultName: string

  constructor(defaultName = 'hub', data: RespawnData[] = respawnData) {
    this.defaultName = defaultName
    for (const item of data) {
      this.items.set(item.id, {
        name: item.id,
        position: new THREE.Vector3(item.x, 4, item.z),
        rotation: item.rotation,
        district: item.district,
        enabled: true,
      })
    }
  }

  add(point: Omit<RespawnPoint, 'enabled'> & { enabled?: boolean }): void {
    this.items.set(point.name, { ...point, enabled: point.enabled ?? true })
  }

  setEnabled(name: string, enabled: boolean): void {
    const item = this.items.get(name)
    if (item) item.enabled = enabled
  }

  getByName(name: string): RespawnPoint | undefined {
    return this.items.get(name)
  }

  getDefault(): RespawnPoint {
    const item = this.items.get(this.defaultName)
    if (!item) throw new Error(`[world] no respawn named "${this.defaultName}"`)
    return item
  }

  /**
   * Moves any respawn that would drop the car onto a structure.
   *
   * Respawn coordinates are authored in `src/content/world.ts` before
   * the thing that ends up standing there exists — a ramp, a gate, a
   * voxel field, a mini-game's scenery. Six of them landed the car on
   * top of something the first time this ran. Rather than hand-tuning
   * numbers that drift the moment a district is edited, each point
   * checks itself against the FINISHED world and takes a step
   * sideways if it needs to.
   *
   * Call once, after everything is built.
   */
  validate(
    terrainHeightAt: (x: number, z: number) => number,
    surfaceHeightAt: (x: number, z: number) => number | null,
  ): string[] {
    const moved: string[] = []
    // A respawn on a low plinth is fine — the car lands on it and
    // drives off. What has to be avoided is arriving several metres
    // up on a wall, a ramp or a voxel stack.
    const TOLERANCE = 2.5
    const STEP = 7
    const RINGS = 8

    for (const point of this.items.values()) {
      const clear = (x: number, z: number) => {
        const surface = surfaceHeightAt(x, z)
        // No hit at all means a hole, not open ground.
        if (surface === null) return false
        return Math.abs(surface - terrainHeightAt(x, z)) < TOLERANCE
      }

      if (clear(point.position.x, point.position.z)) continue

      // Spiral outward. Eight bearings per ring, so a point boxed in
      // on three sides still finds the fourth.
      let found: { x: number; z: number } | null = null
      for (let ring = 1; ring <= RINGS && !found; ring++) {
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2 + ring * 0.4
          const x = point.position.x + Math.cos(angle) * ring * STEP
          const z = point.position.z + Math.sin(angle) * ring * STEP
          if (clear(x, z)) {
            found = { x, z }
            break
          }
        }
      }

      if (!found) {
        // Leave it where it is. A respawn on a structure still works;
        // one teleported somewhere arbitrary to satisfy a check does
        // not. Worth knowing about in development, not worth breaking.
        moved.push(`${point.name}: no clear ground within ${RINGS * STEP} m, left in place`)
        continue
      }

      const distance = Math.hypot(found.x - point.position.x, found.z - point.position.z)
      point.position.x = found.x
      point.position.z = found.z
      point.position.y = terrainHeightAt(found.x, found.z) + 4
      moved.push(`${point.name}: moved ${distance.toFixed(0)} m to clear ground`)
    }

    return moved
  }

  getClosest(position: { x: number; z: number }): RespawnPoint {
    let closest: RespawnPoint | null = null
    let closestDistance = Infinity
    for (const item of this.items.values()) {
      if (!item.enabled) continue
      const distance = Math.hypot(item.position.x - position.x, item.position.z - position.z)
      if (distance < closestDistance) {
        closestDistance = distance
        closest = item
      }
    }
    return closest ?? this.getDefault()
  }
}
