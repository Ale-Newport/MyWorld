import * as THREE from 'three'
import type { Bin } from '../core/Disposal'
import type { Game } from '../Game'
import { validateLayout, validateRespawns, zones, type Zone, type ZoneKind } from '@/content/world-layout'

/* ============================================================
   LAYOUT DEBUG VIEW  —  DEVELOPMENT ONLY

   Press SHIFT + L, or call `__world.layoutDebug.toggle()`.

   Every footprint the occupancy registry knows about, drawn on
   the ground in the colour of its kind, so you can see what the
   world thinks it owns instead of inferring it from a wrong
   answer. Roads and the circuit are drawn as corridors, lakes as
   ellipses, everything else as a ring; respawns get an arrow
   showing which way the car will be facing.

   It also prints the conflict report, which is the same one
   `scripts/world-layout-check.mjs` runs — so the thing you see
   in the world and the thing CI checks are the same thing.

   This is stripped from production builds: the whole class is
   behind `process.env.NODE_ENV === 'development'` at its only
   construction site in Game.ts, and it registers no listeners
   and builds no geometry until the first toggle.
   ============================================================ */

const COLOURS: Record<ZoneKind, string> = {
  plate: '#c8a23c',
  district: '#5f8490',
  road: '#e46a2b',
  circuit: '#d4491f',
  water: '#3f9ad6',
  bridge: '#8f6bd0',
  ramp: '#e0b400',
  landmark: '#2f6f5e',
  play: '#c04ea8',
  respawn: '#28c07a',
  letters: '#8d8467',
  forest: '#4d7a3a',
  noveg: '#a03030',
}

/** Kinds drawn faintly: they overlap everything by design. */
const SOFT: ZoneKind[] = ['district', 'forest', 'noveg']

export class LayoutDebug {
  private group: THREE.Group | null = null
  private visible = false

  constructor(private game: Game, bin: Bin) {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'KeyL' && event.shiftKey && !event.metaKey && !event.ctrlKey) {
        // Not while typing into anything.
        const target = event.target as HTMLElement | null
        if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
        this.toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    bin.add(() => {
      window.removeEventListener('keydown', onKey)
      this.dispose()
    })
  }

  toggle(): boolean {
    this.visible = !this.visible
    if (this.visible) {
      if (!this.group) this.build()
      this.report()
    }
    if (this.group) this.group.visible = this.visible
    return this.visible
  }

  /** The conflict report, in the console, in the same words as the script. */
  report(): void {
    const conflicts = validateLayout()
    const respawns = validateRespawns()
    const head = 'font: 600 13px ui-monospace, monospace; color:#d4491f'
    const body = 'font: 11px/1.5 ui-monospace, monospace; color:#888'
    console.log(
      `%c[WorldLayout] ${zones().length} footprints · ${conflicts.length} conflicts · ${respawns.length} respawn problems%c\n`
      + conflicts.slice(0, 30).map((c) => `  ${c.message}`).join('\n')
      + (conflicts.length > 30 ? `\n  … and ${conflicts.length - 30} more` : '')
      + (respawns.length ? '\n' + respawns.map((r) => `  ${r}`).join('\n') : ''),
      head, body,
    )
  }

  private build(): void {
    const group = new THREE.Group()
    group.renderOrder = 999
    this.group = group

    const line = (colour: string, opacity: number) =>
      new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity, depthTest: false })

    /** Height above the terrain to float the outline. */
    const lift = (x: number, z: number) => this.game.world.terrain.colliderHeightAt(x, z) + 0.35

    for (const zone of zones()) {
      const colour = COLOURS[zone.kind] ?? '#ffffff'
      const soft = SOFT.includes(zone.kind)
      const material = line(colour, soft ? 0.28 : 0.85)

      if (zone.points) {
        // A corridor: the centreline, plus both edges.
        for (const side of [0, 1, -1]) {
          const points: THREE.Vector3[] = []
          for (let i = 0; i < zone.points.length; i++) {
            const [x, z] = zone.points[i]
            const a = zone.points[Math.max(0, i - 1)]
            const b = zone.points[Math.min(zone.points.length - 1, i + 1)]
            const dx = b[0] - a[0]
            const dz = b[1] - a[1]
            const length = Math.hypot(dx, dz) || 1
            const ox = (-dz / length) * zone.radius * side
            const oz = (dx / length) * zone.radius * side
            points.push(new THREE.Vector3(x + ox, lift(x + ox, z + oz), z + oz))
          }
          const geometry = new THREE.BufferGeometry().setFromPoints(points)
          group.add(new THREE.Line(geometry, material))
        }
        continue
      }

      // A ring, elliptical where the zone is.
      const rx = zone.rx ?? zone.radius
      const rz = zone.rz ?? zone.radius
      const points: THREE.Vector3[] = []
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * Math.PI * 2
        const x = zone.x + Math.cos(a) * rx
        const z = zone.z + Math.sin(a) * rz
        points.push(new THREE.Vector3(x, lift(x, z), z))
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points)
      group.add(new THREE.Line(geometry, material))

      if (zone.kind === 'respawn') this.addRespawnArrow(group, zone, material)
    }

    this.game.renderer.scene.add(group)
  }

  /** Which way the car will be pointing when it is put down here. */
  private addRespawnArrow(group: THREE.Group, zone: Zone, material: THREE.Material): void {
    const point = this.game.respawns.items.get(zone.id.replace(/^respawn-/, ''))
    if (!point) return
    const y = this.game.world.terrain.colliderHeightAt(zone.x, zone.z) + 0.35
    // The vehicle faces (cos r, -sin r).
    const dx = Math.cos(point.rotation)
    const dz = -Math.sin(point.rotation)
    const tip = new THREE.Vector3(zone.x + dx * 9, y, zone.z + dz * 9)
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(zone.x, y, zone.z),
      tip,
      new THREE.Vector3(tip.x - dx * 2.6 - dz * 1.6, y, tip.z - dz * 2.6 + dx * 1.6),
      tip,
      new THREE.Vector3(tip.x - dx * 2.6 + dz * 1.6, y, tip.z - dz * 2.6 - dx * 1.6),
    ])
    group.add(new THREE.Line(geometry, material))
  }

  private dispose(): void {
    if (!this.group) return
    this.group.traverse((child) => {
      if (child instanceof THREE.Line) {
        child.geometry.dispose()
        ;(child.material as THREE.Material).dispose()
      }
    })
    this.group.removeFromParent()
    this.group = null
  }
}
