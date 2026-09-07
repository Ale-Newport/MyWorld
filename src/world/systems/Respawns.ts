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
