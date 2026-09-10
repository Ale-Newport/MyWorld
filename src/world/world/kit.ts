import * as THREE from 'three'
import type { Game } from '../Game'
import type { Bin } from '../core/Disposal'
import type { MaterialName } from './materials'
import { mergeParts } from './decorGeometry'
import { solidBox, textPlane, markerRing, type BuildContext } from './Landmarks'
import { districtById, type DistrictId } from '@/content/world'
import { PLAY_SPOTS } from '@/content/world-environment'
import { isFree, type PlacementRules } from '@/content/world-layout'

/* ============================================================
   THE DRESSING KIT

   Set dressing is the layer between the landmarks (which say what a
   place IS) and the decoration (which is knockable clutter). It is
   the silhouettes: the grandstand, the clock face, the server racks,
   the monoliths — the things that make a district recognisable from
   thirty metres away without reading a word.

   THE COST MODEL IS THE WHOLE DESIGN. Every one of these pieces is
   static, so the naive version is one draw call each and ten
   districts of eight pieces is eighty draw calls on a budget of a
   hundred and fifty-six. So a district builds into BUCKETS keyed by
   material and flushes them into one merged mesh per material, and
   the whole dressing layer costs about as much as the scenery
   details do: single figures.

   WHAT THIS FILE IS NOT. It does not decide where districts are, it
   does not place knockable props (that is `Decor`), and it does not
   own a prompt (that is `Attractions` and the content layer). It
   turns "the achievements plaza should read as a podium" into
   geometry, at a position it asked the occupancy registry for.
   ============================================================ */

/** Everything a district's dressing builder is handed. */
export interface Dressing {
  game: Game
  bin: Bin
  /** The group everything is added to. Already in the scene. */
  group: THREE.Group
  /** Accumulate a pre-positioned geometry into a material bucket. */
  add(material: MaterialName, geometry: THREE.BufferGeometry): void
  /** A `BuildContext` for `solidBox` / `textPlane` / `markerRing`. */
  site(x: number, z: number, rotation?: number): BuildContext
  /** Ground height, straight from the terrain. */
  groundAt(x: number, z: number): number
  /**
   * Is this point free of everything the registry knows about?
   *
   * `rules` is passed straight through to `isFree` because a district
   * PLATE and a play disc are HARD zones, and dressing is FOR that
   * paving: with the plain rules every square metre inside a paved
   * district is refused, and both of the first two districts to be
   * written had to import `isFree` themselves to get past it. What
   * must always be caught is a road.
   */
  free(x: number, z: number, clearance: number, rules?: Omit<PlacementRules, 'clearance'>): boolean
  /** The district's own centre and radius, from the content layer. */
  district(id: DistrictId): { x: number; z: number; radius: number; accent: string }
  /** A play spot's anchor, for the venues that are not districts. */
  spot(id: string): { x: number; z: number; rotation: number } | null
  /** Deterministic 0..1, seeded per district so a rebuild is stable. */
  rand(): number
}

/**
 * A district's dressing, as a function of the kit.
 *
 * Returning nothing is legal and means "this district is dressed
 * elsewhere" — the bowling alley, the labyrinth and the circuit all
 * build their own, because their dressing has to know venue-local
 * coordinates the kit cannot supply.
 */
export type DressingBuilder = (kit: Dressing) => void

/** Mulberry32. The same generator `Ecology` uses, for the same reason:
 *  a seeded scatter that survives a reload is a scatter you can fix. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Builds one district's dressing and flushes its buckets.
 *
 * Each call is independent, so a district that throws takes only its
 * own dressing down — which matters when eight of them are authored
 * by different hands and one of them reaches for a play spot that has
 * been renamed.
 */
export function dress(
  game: Game,
  bin: Bin,
  parent: THREE.Object3D,
  seed: number,
  build: DressingBuilder,
): void {
  const group = new THREE.Group()
  parent.add(group)

  const buckets = new Map<MaterialName, THREE.BufferGeometry[]>()
  const random = seeded(seed)

  const kit: Dressing = {
    game,
    bin,
    group,
    add(material, geometry) {
      const list = buckets.get(material)
      if (list) list.push(geometry)
      else buckets.set(material, [geometry])
    },
    site(x, z, rotation = 0) {
      return {
        materials: game.materials,
        physics: game.physics,
        quality: game.quality,
        bin,
        at: new THREE.Vector3(x, game.world.terrain.colliderHeightAt(x, z), z),
        rotation,
      }
    },
    groundAt: (x, z) => game.world.terrain.colliderHeightAt(x, z),
    free: (x, z, clearance, rules) => isFree(x, z, { clearance, ...rules }),
    district(id) {
      const d = districtById[id]
      return { x: d.x, z: d.z, radius: d.radius, accent: d.accent }
    },
    spot(id) {
      const s = PLAY_SPOTS.find((p) => p.id === id)
      return s ? { x: s.x, z: s.z, rotation: 'rotation' in s ? s.rotation : 0 } : null
    },
    rand: random,
  }

  try {
    build(kit)
  } catch (error) {
    // One district's dressing is not worth the world. In development
    // this is loud; in production the place is simply plainer.
    if (process.env.NODE_ENV === 'development') console.error('[dressing]', error)
  }

  for (const [name, parts] of buckets) {
    if (!parts.length) continue
    const geometry = mergeParts(parts)
    const mesh = new THREE.Mesh(geometry, game.materials.get(name))
    mesh.castShadow = game.quality.settings.shadows
    mesh.receiveShadow = game.quality.settings.shadows
    group.add(mesh)
    bin.add(() => geometry.dispose())
  }
}

export { solidBox, textPlane, markerRing }
export type { BuildContext }
