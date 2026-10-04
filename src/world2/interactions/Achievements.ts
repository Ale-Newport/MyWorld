import * as THREE from 'three'
import type { Bin } from '@/world/core/Disposal'
import type { World2Game } from '../World2Game'
import type { References } from './references'
import { WORLD2_ACHIEVEMENTS, WORLD2_ACHIEVEMENT_BY_ID, type World2Achievement } from '../content/achievements'

/* ============================================================
   PORTED FROM: sources/Game/Achievements.js and
   sources/Game/World/Areas/AchievementsArea.js
   folio-2025 — Copyright (c) 2025 Bruno Simon — MIT
   See THIRD_PARTY_NOTICES.md.

   Two kinds of progress, as upstream: a counter, or a SET of ids
   so the same crate cannot be counted twice. Progress is per
   browser; there is no account and no backend.

   The display is upstream's: a ring of glyphs orbiting the
   authored `refPillar` in the achievements area, laid out by a
   seeded generator so the arrangement is the same on every
   visit, lit as each award is earned. One deviation — upstream
   assigns progress, which lets a careless caller move it
   backwards; `set` here takes the maximum.
   ============================================================ */

const STORAGE = 'alejandro-world2-achievements-v1'

interface Group {
  definition: World2Achievement
  progress: number
  ids: Set<string> | null
  unlocked: boolean
}

export interface AchievementView {
  id: string
  title: string
  description: string
  progress: number
  target: number
  unlocked: boolean
}

/** A tiny deterministic generator, so the pillar reads the same every visit. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

export class Achievements {
  readonly groups = new Map<string, Group>()
  readonly group = new THREE.Group()
  private pillar: THREE.Object3D | null = null
  private pillarBase = 0
  private glyphs: THREE.InstancedMesh | null = null
  private readonly glyphColour = { on: new THREE.Color('#ffd45e'), off: new THREE.Color('#3a3444') }
  private hydrating = false
  /**
   * Distance-driven progress moves every frame, and every move used to write
   * localStorage. Writes are coalesced instead: an unlock flushes at once,
   * ordinary progress waits for the next tick past the interval.
   */
  private dirty = false
  private savedAt = 0
  private queue: World2Achievement[] = []
  private showing: { achievement: World2Achievement; left: number } | null = null

  constructor(private game: World2Game, references: References, bin: Bin) {
    this.group.name = 'World2 / achievements'
    for (const definition of WORLD2_ACHIEVEMENTS)
      this.groups.set(definition.id, { definition, progress: 0, ids: definition.unique ? new Set() : null, unlocked: false })
    this.hydrate()
    this.buildPillar(references)

    const tick = () => this.update()
    game.ticker.events.on('tick', tick, 13)
    bin.add(() => {
      game.ticker.events.off('tick', tick)
      this.glyphs?.geometry.dispose()
      ;(this.glyphs?.material as THREE.Material | undefined)?.dispose()
    })
    bin.object3D(this.group)
  }

  private hydrate(): void {
    this.hydrating = true
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE) ?? 'null')
      if (raw && typeof raw === 'object') {
        for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
          const group = this.groups.get(id)
          if (!group) continue
          if (group.ids && Array.isArray(value)) for (const item of value) group.ids.add(String(item))
          else if (typeof value === 'number') group.progress = value
          this.evaluate(group)
        }
      }
    } catch { /* Private mode simply starts empty. */ }
    this.hydrating = false
  }

  /** Marks the save dirty. The tick decides when it is actually written. */
  private schedule(): void { this.dirty = true }

  private persist(): void {
    this.dirty = false
    this.savedAt = this.game.ticker.elapsed
    try {
      const payload: Record<string, unknown> = {}
      for (const [id, group] of this.groups) payload[id] = group.ids ? [...group.ids] : group.progress
      localStorage.setItem(STORAGE, JSON.stringify(payload))
    } catch { /* Private mode. */ }
  }

  private evaluate(group: Group): void {
    const progress = group.ids ? group.ids.size : group.progress
    if (progress < group.definition.target || group.unlocked) return
    group.unlocked = true
    this.refreshGlyphs()
    if (this.hydrating) return
    this.dirty = true
    this.persist()
    this.queue.push(group.definition)
    this.game.audio.play('achievement')
  }

  /** Counter progress. Takes the maximum, so a caller cannot regress it. */
  set(id: string, value: number): void {
    const group = this.groups.get(id)
    if (!group || group.ids) return
    if (value <= group.progress) return
    group.progress = value
    this.evaluate(group)
    this.schedule()
  }

  add(id: string, amount = 1): void {
    const group = this.groups.get(id)
    if (!group || group.ids) return
    this.set(id, group.progress + amount)
  }

  /** Set progress: the same id never counts twice. */
  mark(id: string, item: string): void {
    const group = this.groups.get(id)
    if (!group?.ids || group.ids.has(item)) return
    group.ids.add(item)
    group.progress = group.ids.size
    this.evaluate(group)
    this.schedule()
    this.refreshGlyphs()
  }

  /** For the one-shot awards: unlock outright. */
  unlock(id: string): void {
    const group = this.groups.get(id)
    if (!group || group.unlocked) return
    if (group.ids) { for (let i = group.ids.size; i < group.definition.target; i++) group.ids.add(`auto-${i}`); group.progress = group.ids.size }
    else group.progress = group.definition.target
    this.evaluate(group)
    this.persist()
    this.refreshGlyphs()
  }

  has(id: string): boolean { return this.groups.get(id)?.unlocked ?? false }

  view(): AchievementView[] {
    return WORLD2_ACHIEVEMENTS.map(definition => {
      const group = this.groups.get(definition.id)!
      return {
        id: definition.id, title: definition.title, description: definition.description,
        progress: group.ids ? group.ids.size : group.progress, target: definition.target, unlocked: group.unlocked,
      }
    })
  }

  get unlockedCount(): number { return [...this.groups.values()].filter(group => group.unlocked).length }

  reset(): void {
    for (const group of this.groups.values()) { group.progress = 0; group.ids?.clear(); group.unlocked = false }
    this.persist()
    this.refreshGlyphs()
  }

  /** Upstream's orbiting glyph ring, one tile per award, on the authored pillar. */
  private buildPillar(references: References): void {
    const pillar = references.node('refPillar')
    if (!pillar) return
    this.pillar = pillar
    this.pillarBase = pillar.getWorldPosition(new THREE.Vector3()).y
    const centre = pillar.getWorldPosition(new THREE.Vector3())
    const count = WORLD2_ACHIEVEMENTS.length
    const geometry = new THREE.BoxGeometry(0.26, 0.26, 0.06)
    const material = new THREE.MeshStandardMaterial({ vertexColors: false, roughness: 0.5, metalness: 0.1, emissive: new THREE.Color('#000000'), emissiveIntensity: 0.35 })
    const mesh = new THREE.InstancedMesh(geometry, material, count)
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
    const random = seeded(0x5eed)
    const matrix = new THREE.Matrix4()
    const quaternion = new THREE.Quaternion()
    const euler = new THREE.Euler()
    const scale = new THREE.Vector3(1, 1, 1)
    for (let i = 0; i < count; i++) {
      const angle = Math.PI * random() - Math.PI * 0.25
      const elevation = 0.6 + random() * 2.4
      const radius = 1.4 + random() * 0.7
      random()
      euler.set(0, -angle, 0)
      quaternion.setFromEuler(euler)
      matrix.compose(new THREE.Vector3(centre.x + Math.cos(angle) * radius, centre.y + elevation, centre.z + Math.sin(angle) * radius), quaternion, scale)
      mesh.setMatrixAt(i, matrix)
    }
    mesh.castShadow = true
    mesh.computeBoundingSphere()
    this.glyphs = mesh
    this.group.add(mesh)
    this.refreshGlyphs()
  }

  private refreshGlyphs(): void {
    if (!this.glyphs?.instanceColor) return
    WORLD2_ACHIEVEMENTS.forEach((definition, i) => {
      const group = this.groups.get(definition.id)!
      this.glyphs!.setColorAt(i, group.unlocked ? this.glyphColour.on : this.glyphColour.off)
    })
    this.glyphs.instanceColor.needsUpdate = true
  }

  private update(): void {
    const delta = this.game.ticker.delta * this.game.ticker.scale
    if (this.dirty && this.game.ticker.elapsed - this.savedAt > 2) this.persist()
    if (this.pillar) {
      const player = this.game.player.position
      const at = this.pillar.position
      if (Math.hypot(player.x - at.x, player.z - at.z) < 40)
        this.pillar.position.y = this.pillarBase + Math.sin(this.game.ticker.elapsed * 0.2) * 0.25
    }
    if (!this.showing && this.queue.length) this.showing = { achievement: this.queue.shift()!, left: 4 }
    else if (this.showing) {
      this.showing.left -= delta
      if (this.showing.left <= 0) { this.showing = null; this.game.publishGameplay() ; return }
    }
    if (this.showing && Math.abs(this.showing.left % 1) < 0.02) this.game.publishGameplay()
  }

  /** The unlock card the HUD shows, if one is on screen. */
  get notice(): { title: string; body: string } | null {
    if (!this.showing) return null
    return { title: this.showing.achievement.title, body: this.showing.achievement.description }
  }

  static describe(id: string): World2Achievement | undefined { return WORLD2_ACHIEVEMENT_BY_ID[id] }
}
