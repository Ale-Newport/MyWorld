import * as THREE from 'three'
import { palette } from '../core/palette'
import { seeded } from '../core/maths'
import type { Bin } from '../core/Disposal'
import type { Ticker } from '../core/Ticker'
import type { Physical, Physics } from '../physics/Physics'
import type { Materials } from './materials'
import { chamferedBox } from './geometry'
import { DECOR_KINDS, buildDecorShape, mergeParts, type DecorCollider } from './decorGeometry'
import type { DecorKindId } from '@/content/world-decor'

/* ============================================================
   PHYSICAL PROPS

   Architecture from sources/Game/Objects.js + InstancedGroup.js
   (folio-2025, MIT — Copyright (c) 2025 Bruno Simon). See
   THIRD_PARTY_NOTICES.md. The objects themselves are ours.

   Two ideas are worth keeping from upstream. The first is one
   InstancedMesh per prop kind, with transforms written from
   physics after the step — four hundred cones cost four draw
   calls, not four hundred. The second is that mass is the whole
   design: a cone at 0.6 kg scatters, a crate at 6 kg shifts and a
   panel at 11 kg barely moves. Getting those three tiers right is
   most of what makes a physics playground feel physical — and the
   scale they are read against is the 2.5 kg chassis, not the real
   world, which is why the bench here is 9 kg and not 40.

   Sleeping bodies are skipped. Rapier puts a settled prop to
   sleep and it stops moving; rewriting its matrix every frame
   afterwards is pure waste, and with several hundred props it is
   measurable.

   PER-INSTANCE SCALE AND COLOUR are what turn ten kinds into a
   world's worth of things. A draw call is spent per KIND and not
   per instance, so the expensive way to vary decoration is to add
   geometries and the cheap way is to vary the instances of the
   ones already reserved — a crate at 0.6 in hay yellow and the
   same crate at 1.3 in paper grey are two objects for one draw.
   The scale is UNIFORM and it is applied to the collider and to
   the mass as well as to the matrix: a prop you cannot hit where
   you can see it is worse than one that never varied.
   ============================================================ */

/** The ten kinds the playground was built with. */
export type BasePropKind =
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

/** …and the fourteen the decoration manifest adds on top of them. */
export type PropKind = BasePropKind | DecorKindId

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
  collider: () => DecorCollider
  /** Contact force above which a hit is worth a sound. */
  contactThreshold: number
  castShadow: boolean
  /**
   * Placed asleep. Decoration is meant to be exactly where it was
   * put until something hits it, and a settling pass over eight
   * hundred props on sloping ground is eight hundred props that
   * have all slid a little way downhill by the time the car
   * arrives. Rapier wakes a sleeping body on contact, so nothing
   * is lost but the drift.
   */
  sleeping?: boolean
}

const BASE_SPECS: Record<BasePropKind, PropSpec> = {
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
    // Lighter than it looks on purpose. At 9 kg — heavier than the
    // 2.5 kg car — a barrier is something the car climbs onto and
    // beaches on rather than something it scatters.
    mass: 4, friction: 0.55, restitution: 0.1,
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
      const seat = chamferedBox(2.6, 0.16, 0.7, 0.04)
      seat.translate(0, 0.52, 0)
      // A BACKREST, because this geometry now has to stand in for the
      // lake and coast benches `SceneryDetails` used to build out of
      // merged boxes. Those had one and their replacement should: a
      // backless slab beside the water reads as a kerb.
      const back = chamferedBox(2.6, 0.5, 0.1, 0.03)
      back.translate(0, 0.85, -0.3)
      const legA = chamferedBox(0.16, 0.52, 0.62, 0.03)
      legA.translate(-1.0, 0.26, 0)
      const legB = chamferedBox(0.16, 0.52, 0.62, 0.03)
      legB.translate(1.0, 0.26, 0)
      return mergeParts([seat, back, legA, legB])
    },
    color: palette.concreteDark, roughness: 0.8, metalness: 0.05,
    // NINE, NOT FORTY. A bench at 40 kg against a 2.5 kg car is a
    // brick: the car stops dead on it, which is the single most
    // common way this world said 'you may not go there' by accident.
    // Nine shoves, slides and eventually tips.
    mass: 9, friction: 0.8, restitution: 0.04,
    linearDamping: 0.5, angularDamping: 0.8,
    collider: () => ({ shape: 'cuboid', parameters: [1.3, 0.34, 0.35], position: { x: 0, y: 0.34, z: 0 } }),
    contactThreshold: 22, castShadow: true,
  },

  block: {
    geometry: () => chamferedBox(1.6, 1.6, 1.6, 0.08),
    color: palette.ink2, roughness: 0.6, metalness: 0.1,
    // Eight. At 14 it was the second wall in this table — heavier
    // than a crate, and the maze and black-hole scatters are made of
    // it. `panel` at 11 is the one deliberate immovable left.
    mass: 8, friction: 0.7, restitution: 0.05,
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

/*
  THE FOURTEEN DECORATION KINDS, built from the manifest.

  Their numbers live in `content/world-decor.ts` — which holds no
  THREE import, so the headless checker can read every mass and
  count without a renderer — and their shapes in `decorGeometry.ts`,
  where each is authored beside its own collider. Nothing about them
  is repeated here: this is only the join.
*/
const DECOR_SPECS = Object.fromEntries(
  DECOR_KINDS.map((kind): [string, PropSpec] => {
    /*
      THE GEOMETRY IS BUILT FRESH AND THE COLLIDER IS CACHED, and the
      asymmetry is not an oversight.

      A `Bin` disposes every geometry it was given when the game is
      torn down, and a hot reload builds a second `Props` immediately
      afterwards. Handing that second one a module-level geometry the
      first one has already disposed gives an empty mesh and no error
      at all. The collider is plain numbers, so it survives — and it
      has to be cached, because `add` asks for one per instance and
      there are eight hundred of them.
    */
    let collider: DecorCollider | null = null
    return [kind.id, {
      geometry: () => buildDecorShape(kind).geometry,
      color: kind.colours[0],
      roughness: kind.roughness,
      metalness: kind.metalness,
      mass: kind.mass,
      friction: kind.friction,
      restitution: kind.restitution,
      linearDamping: kind.linearDamping,
      angularDamping: kind.angularDamping,
      // A shallow copy, which is enough: `add` REPLACES `parameters`
      // and `position` when it scales them rather than writing into
      // them, so the cached arrays are never touched.
      collider: () => ({ ...(collider ??= buildDecorShape(kind).collider) }),
      contactThreshold: kind.contactThreshold,
      castShadow: kind.castShadow,
      sleeping: true,
    }]
  }),
) as Record<DecorKindId, PropSpec>

const SPECS: Record<PropKind, PropSpec> = { ...BASE_SPECS, ...DECOR_SPECS }

export interface PropInstance {
  kind: PropKind
  index: number
  physical: Physical
  /** Set by whoever placed it — used by mini-games and achievements. */
  tag?: string
  /** True once the prop has been moved from where it started. */
  disturbed: boolean
  /** Uniform, and shared by the mesh, the collider and the mass. */
  scale: number
}

/** What varies from one instance of a kind to the next. */
export interface PropOptions {
  rotation?: number
  tag?: string
  tilt?: number
  /**
   * Uniform scale. It multiplies the collider's half-extents and its
   * offset as well as the matrix, and the mass by its CUBE — a crate
   * at 0.5 that still weighs six kilograms is a paving slab the size
   * of a shoebox, and it stops the car.
   */
  scale?: number
  /** Per-instance tint, multiplied into the kind's own material. */
  colour?: string
  /** Overrides the kind's default. See `PropSpec.sleeping`. */
  sleeping?: boolean
}

interface Group {
  kind: PropKind
  spec: PropSpec
  geometry: THREE.BufferGeometry
  mesh: THREE.InstancedMesh
  instances: PropInstance[]
  /** Instances whose matrix still needs writing even while asleep. */
  dirty: Set<number>
  /** Set once any instance of the kind asked for its own colour. */
  tinted: boolean
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
  private readonly colour = new THREE.Color()

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

  /**
   * Pre-allocates an instanced mesh for a kind, or GROWS the one
   * that is already there.
   *
   * The early return this replaces made capacity first-come: whoever
   * reserved a kind first fixed it forever, so once `SceneryDetails`
   * and `Decor` both wanted benches, the second one to ask spent its
   * whole set on `ran out of "bench" instances` warnings in dev and
   * on silence in production. An InstancedMesh cannot be resized, so
   * growing means a new one — the geometry and the material are
   * shared with the old, every instance is marked dirty, and the next
   * tick rewrites the matrices it already had.
   */
  reserve(kind: PropKind, capacity: number): void {
    const spec = SPECS[kind]
    const existing = this.groups.get(kind)
    if (existing && existing.mesh.instanceMatrix.count >= capacity) return

    const geometry = existing ? existing.geometry : spec.geometry()
    const material = this.materials.tinted(spec.color, spec.roughness, spec.metalness)
    const mesh = new THREE.InstancedMesh(geometry, material, capacity)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.castShadow = this.castShadows && spec.castShadow
    mesh.receiveShadow = false
    mesh.count = existing ? existing.instances.length : 0
    mesh.frustumCulled = false
    this.group.add(mesh)

    if (!existing) {
      this.bin.add(() => geometry.dispose())
      this.groups.set(kind, {
        kind, spec, geometry, mesh, instances: [], dirty: new Set(), tinted: false,
      })
      return
    }

    // Carry the colours across before the old mesh goes, or a grown
    // kind loses every tint it had been given.
    if (existing.tinted && existing.mesh.instanceColor) {
      for (let i = 0; i < existing.instances.length; i++) {
        this.colour.fromArray(existing.mesh.instanceColor.array, i * 3)
        mesh.setColorAt(i, this.colour)
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    this.group.remove(existing.mesh)
    existing.mesh.dispose()
    existing.mesh = mesh
    for (const instance of existing.instances) existing.dirty.add(instance.index)
  }

  /** How many instances of a kind are still unplaced. */
  headroom(kind: PropKind): number {
    const group = this.groups.get(kind)
    return group ? group.mesh.instanceMatrix.count - group.instances.length : 0
  }

  /** How many are already standing. A second builder reserving the
   *  same kind adds to this rather than replacing it. */
  countOf(kind: PropKind): number {
    return this.groups.get(kind)?.instances.length ?? 0
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
    options: PropOptions = {},
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
    const scale = options.scale ?? 1
    const collider = spec.collider()
    // The collider is described in the geometry's frame, so a uniform
    // scale is a uniform scale of every half-extent, radius and
    // offset in it — and of nothing else, which is why `scale` here
    // is a number and not a Vector3. A cylinder scaled 1.4 on X only
    // is not a cylinder any more and Rapier has no shape for it.
    if (scale !== 1) {
      collider.parameters = collider.parameters.map((n) => n * scale)
      if (collider.position) {
        collider.position = {
          x: collider.position.x * scale,
          y: collider.position.y * scale,
          z: collider.position.z * scale,
        }
      }
    }
    const index = group.instances.length

    const rotation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(options.tilt ?? 0, options.rotation ?? this.rand() * Math.PI * 2, 0),
    )

    const instance: PropInstance = {
      kind,
      index,
      tag: options.tag,
      disturbed: false,
      scale,
      physical: this.physics.add({
        type: 'dynamic',
        position: { x, y, z },
        rotation,
        // Volume scales with the cube, and so does anything that is
        // going to feel right when the car hits it. Floored at 0.15 kg
        // so a heavily shrunk prop is still something rather than a
        // body Rapier has to integrate at absurd accelerations.
        mass: Math.max(0.15, spec.mass * scale * scale * scale),
        friction: spec.friction,
        restitution: spec.restitution,
        linearDamping: spec.linearDamping,
        angularDamping: spec.angularDamping,
        contactThreshold: spec.contactThreshold,
        sleeping: options.sleeping ?? spec.sleeping ?? false,
        colliders: [collider],
        onCollision: (force, at) => this.handleHit(instance, force, at),
      }),
    }

    if (options.colour) {
      group.tinted = true
      group.mesh.setColorAt(index, this.colour.set(options.colour))
      if (group.mesh.instanceColor) group.mesh.instanceColor.needsUpdate = true
    }

    group.instances.push(instance)
    group.mesh.count = group.instances.length
    group.dirty.add(index)
    return instance
  }

  /**
   * A whole set at once.
   *
   * The saving is not the loop, it is the flags: `add` marks the
   * instance matrix dirty on every call, and eight hundred separate
   * calls at build time is eight hundred buffer uploads scheduled
   * for a frame that has not started yet. One `needsUpdate` at the
   * end of the batch is the same picture.
   */
  addMany(
    kind: PropKind,
    placements: readonly { x: number; y: number; z: number; options?: PropOptions }[],
  ): PropInstance[] {
    const out: PropInstance[] = []
    for (const p of placements) {
      const instance = this.add(kind, p.x, p.y, p.z, p.options)
      if (instance) out.push(instance)
    }
    const group = this.groups.get(kind)
    if (group) {
      group.mesh.instanceMatrix.needsUpdate = true
      if (group.mesh.instanceColor) group.mesh.instanceColor.needsUpdate = true
    }
    return out
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
        this.matrix.compose(this.position, this.quaternion, this.scale.setScalar(instance.scale))
        group.mesh.setMatrixAt(instance.index, this.matrix)
        wrote = true

        if (sleeping) group.dirty.delete(instance.index)
        else group.dirty.add(instance.index)
      }

      if (wrote) group.mesh.instanceMatrix.needsUpdate = true
    }
  }
}
