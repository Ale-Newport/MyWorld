import * as THREE from 'three'
import type { Physical } from '@/world/physics/Physics'
import type { World2Environment } from '../World2Environment'

/* ============================================================
   BLENDER IS THE SOURCE OF TRUTH

   Upstream finds its objects with a regex over sanitised glTF
   node names (`refLettersPhysicalDynamic.010` → key `letters`,
   index 10) and then relies on `Area.setObjects` having mutated
   every child's `position` from area-local to world.

   Our export is kinder: every node carries `w2Source`, the exact
   Blender name, and `w2Collections`, the collections it belongs
   to. So a lookup here is the authored name, not a decoded one,
   and world transforms come from `matrixWorld` rather than from
   an in-place mutation nobody can see.

   Nothing in this file invents a coordinate. If a name is not in
   the level, the caller gets `null` and says so.
   ============================================================ */

/** Transforms the export leaves out: race gates, career text, hit targets. */
export interface AuthoredTransform {
  name: string
  position: [number, number, number]
  quaternion: [number, number, number, number]
  scale: [number, number, number]
  dimensions: [number, number, number]
  inGlb: boolean
  properties: Record<string, unknown>
}

export interface World2Interactions {
  version: number
  source: string
  sourceSha256: string
  checkpoints: AuthoredTransform[]
  careerText: AuthoredTransform[]
  intersects: AuthoredTransform[]
  signReference: AuthoredTransform
}

export class References {
  /** Blender name → node. Populated from `w2Source`, not the glTF name. */
  private readonly bySource = new Map<string, THREE.Object3D>()
  /**
   * Every node the interaction layer has asked for. The environment's scenery
   * batching reads this and leaves those subtrees alone: if gameplay looked a
   * node up, something is going to move it, hide it or repaint it, and a
   * merged copy would not follow.
   */
  readonly touched = new Set<THREE.Object3D>()

  constructor(readonly environment: World2Environment, readonly interactions: World2Interactions) {
    environment.group.traverse(node => {
      const source = node.userData.w2Source
      if (typeof source === 'string' && !this.bySource.has(source)) this.bySource.set(source, node)
    })
  }

  /** The node authored in Blender under this exact name, or null. */
  node(name: string): THREE.Object3D | null {
    const found = this.bySource.get(name) ?? this.environment.nodes.get(name) ?? null
    if (found) this.touched.add(found)
    return found
  }

  /** Same, but a missing name is a level/runtime mismatch worth shouting about. */
  require(name: string): THREE.Object3D {
    const node = this.node(name)
    if (!node) throw new Error(`World2: "${name}" is not in the exported level. Re-run npm run world2:export.`)
    return node
  }

  /** Every authored name matching `<prefix>` or `<prefix>.NNN`, in numeric order. */
  series(prefix: string): THREE.Object3D[] {
    const found: { key: number; node: THREE.Object3D }[] = []
    for (const [source, node] of this.bySource) {
      if (source === prefix) { found.push({ key: -1, node }); continue }
      if (!source.startsWith(`${prefix}.`)) continue
      const suffix = source.slice(prefix.length + 1)
      if (!/^\d+$/.test(suffix)) continue
      found.push({ key: Number(suffix), node })
    }
    const nodes = found.sort((a, b) => a.key - b.key).map(item => item.node)
    for (const node of nodes) this.touched.add(node)
    return nodes
  }

  /** Every node in a Blender collection. */
  collection(name: string): THREE.Object3D[] {
    const nodes = this.environment.collection(name)
    for (const node of nodes) this.touched.add(node)
    return nodes
  }

  /**
   * "We are drawing something else here." Hides an authored node for good —
   * and keeps the validation panel's category toggles from bringing it back.
   */
  suppress(name: string): THREE.Object3D | null {
    const node = this.node(name)
    if (node) this.environment.suppress(node)
    return node
  }

  /** World position of an authored reference. */
  position(name: string): THREE.Vector3 | null {
    const node = this.node(name)
    return node ? node.getWorldPosition(new THREE.Vector3()) : null
  }

  /** World position, rotation and scale of an authored reference. */
  transform(name: string): { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 } | null {
    const node = this.node(name)
    if (!node) return null
    node.updateWorldMatrix(true, false)
    const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3()
    node.matrixWorld.decompose(position, quaternion, scale)
    return { position, quaternion, scale }
  }

  /** The rigid body built for an authored root, if the level gave it one. */
  physical(name: string): Physical | null {
    const node = this.node(name)
    return node ? this.environment.physicals.get(node) ?? null : null
  }

  /** Reference transforms recovered from the .blend for objects the GLB omits. */
  authored(list: AuthoredTransform[]): { name: string; position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3; properties: Record<string, unknown> }[] {
    return list.map(item => ({
      name: item.name,
      position: new THREE.Vector3(...item.position),
      quaternion: new THREE.Quaternion(...item.quaternion),
      scale: new THREE.Vector3(...item.scale),
      properties: item.properties,
    }))
  }
}

/** The authored zone an area uses for gameplay proximity, as a flat circle. */
export function boundingCircle(references: References, index: number | null): { centre: THREE.Vector2; radius: number } | null {
  const name = index === null ? 'refZoneBounding' : `refZoneBounding.${String(index).padStart(3, '0')}`
  const transform = references.transform(name)
  if (!transform) return null
  return { centre: new THREE.Vector2(transform.position.x, transform.position.z), radius: Math.abs(transform.scale.x) }
}
