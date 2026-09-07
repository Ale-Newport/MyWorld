import * as THREE from 'three'
import { palette } from '../core/palette'
import { seeded } from '../core/maths'
import type { Bin } from '../core/Disposal'
import type { Ticker } from '../core/Ticker'
import type { Physical, Physics } from '../physics/Physics'
import type { Materials } from './materials'
import { chamferedBox } from './geometry'

/* ============================================================
   PHYSICAL PROPS

   Architecture from sources/Game/Objects.js + InstancedGroup.js
   (folio-2025, MIT — Copyright (c) 2025 Bruno Simon). See
   THIRD_PARTY_NOTICES.md. The objects themselves are ours.

   Two ideas are worth keeping from upstream. The first is one
   InstancedMesh per prop kind, with transforms written from
   physics after the step — four hundred cones cost four draw
   calls, not four hundred. The second is that mass is the whole
   design: a cone at 0.6 kg scatters, a crate at 6 kg shifts, and
   a bench at 40 kg barely moves. Getting those three tiers right
   is most of what makes a physics playground feel physical.

   Sleeping bodies are skipped. Rapier puts a settled prop to
   sleep and it stops moving; rewriting its matrix every frame
   afterwards is pure waste, and with several hundred props it is
   measurable.
   ============================================================ */

export type PropKind =
  | 'cone'
  | 'barrier'
  | 'crate'
  | 'ball'
  | 'bench'
  | 'block'
  | 'plank'
  | 'domino'
  | 'drum'
  | 'panel'

interface PropSpec {
  /** Built once and shared by every instance. */
  geometry: () => THREE.BufferGeometry
  color: string
  roughness: number
  metalness: number
  mass: number
  friction: number
  restitution: number
  linearDamping: number
  angularDamping: number
  /** Rapier collider description, in the geometry's own frame. */
  collider: () => {
    shape: 'cuboid' | 'ball' | 'cylinder' | 'cone'
    parameters: number[]
    position?: { x: number; y: number; z: number }
  }
  /** Contact force above which a hit is worth a sound. */
  contactThreshold: number
  castShadow: boolean
}

const SPECS: Record<PropKind, PropSpec> = {
  // Light and tall: falls over from almost any contact, which is
  // exactly what a traffic cone is for.
  cone: {
    geometry: () => {
      const geometry = new THREE.ConeGeometry(0.34, 0.86, 10, 1)
      geometry.translate(0, 0.43, 0)
      return geometry
    },
    color: palette.accent, roughness: 0.62, metalness: 0,
    mass: 0.6, friction: 0.5, restitution: 0.1,
    linearDamping: 0.2, angularDamping: 0.4,
    collider: () => ({ shape: 'cone', parameters: [0.43, 0.34], position: { x: 0, y: 0.43, z: 0 } }),
    contactThreshold: 4, castShadow: true,
  },

  barrier: {
    geometry: () => chamferedBox(2.4, 1.0, 0.28, 0.05),
    color: palette.chalk, roughness: 0.72, metalness: 0,
    mass: 9, friction: 0.6, restitution: 0.08,
    linearDamping: 0.3, angularDamping: 0.5,
    collider: () => ({ shape: 'cuboid', parameters: [1.2, 0.5, 0.14] }),
    contactThreshold: 12, castShadow: true,
  },

  crate: {
    geometry: () => chamferedBox(1.1, 1.1, 1.1, 0.07),
    color: palette.paper3, roughness: 0.86, metalness: 0,
    mass: 6, friction: 0.7, restitution: 0.06,
    linearDamping: 0.25, angularDamping: 0.4,
    collider: () => ({ shape: 'cuboid', parameters: [0.55, 0.55, 0.55] }),
    contactThreshold: 10, castShadow: true,
  },

  // The one prop with real bounce. A ball that does not bounce is
  // just a heavy sphere.
  ball: {
    geometry: () => new THREE.IcosahedronGeometry(0.62, 2),
    color: palette.signal, roughness: 0.42, metalness: 0.05,
    mass: 2.2, friction: 0.35, restitution: 0.68,
    linearDamping: 0.06, angularDamping: 0.12,
    collider: () => ({ shape: 'ball', parameters: [0.62] }),
    contactThreshold: 6, castShadow: true,
  },

  bench: {
    geometry: () => {
      const group = new THREE.BufferGeometry()
      const seat = chamferedBox(2.6, 0.16, 0.7, 0.04)
      seat.translate(0, 0.52, 0)
      const legA = chamferedBox(0.16, 0.52, 0.62, 0.03)
      legA.translate(-1.0, 0.26, 0)
      const legB = chamferedBox(0.16, 0.52, 0.62, 0.03)
      legB.translate(1.0, 0.26, 0)
      const merged = mergeGeometries([seat, legA, legB])
      seat.dispose(); legA.dispose(); legB.dispose()
      group.dispose()
      return merged
    },
    color: palette.concreteDark, roughness: 0.8, metalness: 0.05,
    mass: 40, friction: 0.8, restitution: 0.04,
    linearDamping: 0.5, angularDamping: 0.8,
    collider: () => ({ shape: 'cuboid', parameters: [1.3, 0.34, 0.35], position: { x: 0, y: 0.34, z: 0 } }),
    contactThreshold: 22, castShadow: true,
  },

  block: {
    geometry: () => chamferedBox(1.6, 1.6, 1.6, 0.08),
    color: palette.ink2, roughness: 0.6, metalness: 0.1,
    mass: 14, friction: 0.7, restitution: 0.05,
    linearDamping: 0.3, angularDamping: 0.5,
    collider: () => ({ shape: 'cuboid', parameters: [0.8, 0.8, 0.8] }),
    contactThreshold: 16, castShadow: true,
  },

  plank: {
    geometry: () => chamferedBox(3.6, 0.22, 0.9, 0.04),
    color: palette.paper4, roughness: 0.88, metalness: 0,
    mass: 7, friction: 0.75, restitution: 0.05,
    linearDamping: 0.3, angularDamping: 0.6,
    collider: () => ({ shape: 'cuboid', parameters: [1.8, 0.11, 0.45] }),
    contactThreshold: 12, castShadow: true,
  },

  // Tall, thin and heavy enough to carry momentum into the next
  // one. The whole point is the chain.
  domino: {
    geometry: () => chamferedBox(0.24, 2.2, 1.2, 0.04),
    color: palette.chalk, roughness: 0.7, metalness: 0,
    mass: 3.2, friction: 0.55, restitution: 0.02,
    linearDamping: 0.1, angularDamping: 0.15,
    collider: () => ({ shape: 'cuboid', parameters: [0.12, 1.1, 0.6] }),
    contactThreshold: 6, castShadow: true,
  },

  drum: {
    geometry: () => {
      const geometry = new THREE.CylinderGeometry(0.42, 0.42, 1.1, 12, 1)
      geometry.translate(0, 0.55, 0)
      return geometry
    },
    color: palette.metal, roughness: 0.4, metalness: 0.5,
    mass: 5, friction: 0.45, restitution: 0.2,
    linearDamping: 0.2, angularDamping: 0.3,
    collider: () => ({ shape: 'cylinder', parameters: [0.55, 0.42], position: { x: 0, y: 0.55, z: 0 } }),
    contactThreshold: 9, castShadow: true,
  },

  panel: {
    geometry: () => chamferedBox(2.0, 2.6, 0.16, 0.04),
    color: palette.paper2, roughness: 0.8, metalness: 0,
    mass: 11, friction: 0.6, restitution: 0.04,
    linearDamping: 0.3, angularDamping: 0.6,
    collider: () => ({ shape: 'cuboid', parameters: [1.0, 1.3, 0.08] }),
    contactThreshold: 14, castShadow: true,
  },
}

/** Minimal geometry merge — enough for the few multi-part props. */
function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  for (const geometry of list) {
    const source = geometry.index ? geometry.toNonIndexed() : geometry
    const p = source.getAttribute('position')
    const n = source.getAttribute('normal')
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i))
      normals.push(n.getX(i), n.getY(i), n.getZ(i))
    }
    if (source !== geometry) source.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  return out
}

export interface PropInstance {
  kind: PropKind
  index: number
  physical: Physical
  /** Set by whoever placed it — used by mini-games and achievements. */
  tag?: string
  /** True once the prop has been moved from where it started. */
  disturbed: boolean
}

interface Group {
  kind: PropKind
  spec: PropSpec
  mesh: THREE.InstancedMesh
  instances: PropInstance[]
  /** Instances whose matrix still needs writing even while asleep. */
  dirty: Set<number>
}

export type PropHitHandler = (
  instance: PropInstance,
  force: number,
  position: { x: number; y: number; z: number },
) => void

export class Props {
  readonly group = new THREE.Group()
  private groups = new Map<PropKind, Group>()
  private rand = seeded(917531)

  /** Raised whenever a prop is hit hard enough to be worth a sound. */
  onHit: PropHitHandler | null = null
  /** Raised the first time a prop is moved from its starting place. */
  onDisturb: ((instance: PropInstance) => void) | null = null

  private readonly matrix = new THREE.Matrix4()
  private readonly position = new THREE.Vector3()
  private readonly quaternion = new THREE.Quaternion()
  private readonly scale = new THREE.Vector3(1, 1, 1)

  constructor(
    private physics: Physics,
    private ticker: Ticker,
    private materials: Materials,
    private bin: Bin,
    private castShadows = true,
  ) {
    // Order 4: after the physics step, before the vehicle's own
    // post-physics pass, exactly as upstream orders `Objects`.
    const update = () => this.update()
    this.ticker.events.on('tick', update, 12)
    this.bin.add(() => this.ticker.events.off('tick', update))
    this.bin.object3D(this.group)
  }

  /** Pre-allocates an instanced mesh for a kind. Call before `add`. */
  reserve(kind: PropKind, capacity: number): void {
    if (this.groups.has(kind)) return
    const spec = SPECS[kind]
    const geometry = spec.geometry()
    const material = this.materials.tinted(spec.color, spec.roughness, spec.metalness)
    const mesh = new THREE.InstancedMesh(geometry, material, capacity)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.castShadow = this.castShadows && spec.castShadow
    mesh.receiveShadow = false
    mesh.count = 0
    mesh.frustumCulled = false
    this.group.add(mesh)
    this.bin.add(() => geometry.dispose())

    this.groups.set(kind, { kind, spec, mesh, instances: [], dirty: new Set() })
  }

  /**
   * Places one prop. `y` is the elevation of its base; the collider
   * offset in the spec puts the body's origin in the right place.
   */
  add(
    kind: PropKind,
    x: number,
    y: number,
    z: number,
    options: { rotation?: number; tag?: string; tilt?: number } = {},
  ): PropInstance | null {
    const group = this.groups.get(kind)
    if (!group) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[world] prop kind "${kind}" was not reserved`)
      }
      return null
    }
    if (group.instances.length >= group.mesh.instanceMatrix.count) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[world] ran out of "${kind}" instances`)
      }
      return null
    }

    const spec = group.spec
    const collider = spec.collider()
    const index = group.instances.length

    const rotation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(options.tilt ?? 0, options.rotation ?? this.rand() * Math.PI * 2, 0),
    )

    const instance: PropInstance = {
      kind,
      index,
      tag: options.tag,
      disturbed: false,
      physical: this.physics.add({
        type: 'dynamic',
        position: { x, y, z },
        rotation,
        mass: spec.mass,
        friction: spec.friction,
        restitution: spec.restitution,
        linearDamping: spec.linearDamping,
        angularDamping: spec.angularDamping,
        contactThreshold: spec.contactThreshold,
        colliders: [collider],
        onCollision: (force, at) => this.handleHit(instance, force, at),
      }),
    }

    group.instances.push(instance)
    group.mesh.count = group.instances.length
    group.dirty.add(index)
    return instance
  }

  private handleHit(
    instance: PropInstance,
    force: number,
    at: { x: number; y: number; z: number },
  ): void {
    if (!instance.disturbed && force > 2) {
      instance.disturbed = true
      this.onDisturb?.(instance)
    }
    this.onHit?.(instance, force, at)
  }

  /** Every prop carrying `tag`. Used by mini-games and achievements. */
  tagged(tag: string): PropInstance[] {
    const out: PropInstance[] = []
    for (const group of this.groups.values()) {
      for (const instance of group.instances) {
        if (instance.tag === tag) out.push(instance)
      }
    }
    return out
  }

  /** How many tagged props have been knocked about. */
  disturbedCount(tag?: string): number {
    let n = 0
    for (const group of this.groups.values()) {
      for (const instance of group.instances) {
        if (tag && instance.tag !== tag) continue
        if (instance.disturbed) n++
      }
    }
    return n
  }

  /** Puts everything back. Bound to the options menu. */
  reset(tag?: string): void {
    for (const group of this.groups.values()) {
      for (const instance of group.instances) {
        if (tag && instance.tag !== tag) continue
        this.physics.reset(instance.physical)
        instance.disturbed = false
        group.dirty.add(instance.index)
      }
    }
  }

  get count(): number {
    let n = 0
    for (const group of this.groups.values()) n += group.instances.length
    return n
  }

  private update(): void {
    const alpha = this.ticker.alpha

    for (const group of this.groups.values()) {
      let wrote = false

      for (const instance of group.instances) {
        const sleeping = instance.physical.body.isSleeping()
        // A sleeping prop has not moved. Skipping it is most of the
        // reason several hundred props are affordable at all.
        if (sleeping && !group.dirty.has(instance.index)) continue

        this.physics.sample(instance.physical, alpha, this.position, this.quaternion)
        this.matrix.compose(this.position, this.quaternion, this.scale)
        group.mesh.setMatrixAt(instance.index, this.matrix)
        wrote = true

        if (sleeping) group.dirty.delete(instance.index)
        else group.dirty.add(instance.index)
      }

      if (wrote) group.mesh.instanceMatrix.needsUpdate = true
    }
  }
}
