import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { Ticker } from '../core/Ticker'
import { OCEAN_LEVEL } from '@/content/world-environment'
import type { Bin } from '../core/Disposal'
import { clamp } from '../core/maths'

/* ============================================================
   PORTED FROM: sources/Game/Physics/Physics.js
   folio-2025 — Copyright (c) 2025 Bruno Simon — MIT
   https://github.com/brunosimon/folio-2025
   See THIRD_PARTY_NOTICES.md and ../vendor/LICENSE-folio-2025.md

   Upstream's collision-group scheme, physical-description
   factory and contact-force fan-out, kept as-is. The three
   groups matter more than they look:

     all     everything collides with everything
     object  props; collide with each other and with bumpers
     bumper  an oversized, massless collider on the vehicle that
             collides ONLY with props

   The bumper is what makes hitting a cone feel good. The car's
   real chassis collider is tight (so it fits through gaps and
   does not snag on the ground), while the bumper is 15% larger
   in every axis and sweeps props aside before the chassis
   reaches them. Take the bumper out and the car starts clipping
   into things before it pushes them.

   Changes: TypeScript; the world is stepped by the caller's
   fixed accumulator rather than by a variable delta; a
   `previous`/`current` transform pair is recorded per body so
   the render layer can interpolate; `destroy()` frees the Rapier
   world (upstream never needs to).
   ============================================================ */

export type PhysicalType = 'dynamic' | 'fixed' | 'kinematicPositionBased' | 'kinematicVelocityBased'
export type ColliderShape = 'cuboid' | 'ball' | 'cylinder' | 'cone' | 'capsule' | 'trimesh' | 'hull' | 'heightfield'
export type PhysicsCategory = 'floor' | 'object' | 'bumper' | 'sensor'

export interface ColliderDescription {
  shape: ColliderShape
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shape parameters are per-shape tuples
  parameters: any[]
  position?: { x: number; y: number; z: number }
  quaternion?: { x: number; y: number; z: number; w: number }
  mass?: number
  centerOfMass?: { x: number; y: number; z: number }
  friction?: number
  restitution?: number
  category?: PhysicsCategory
  sensor?: boolean
}

export interface PhysicalDescription {
  type?: PhysicalType
  position?: { x: number; y: number; z: number }
  rotation?: { x: number; y: number; z: number; w: number }
  colliders: ColliderDescription[]
  collidersOverwrite?: Partial<ColliderDescription>
  mass?: number
  friction?: number
  frictionRule?: 'average' | 'min' | 'max' | 'multiply'
  restitution?: number
  category?: PhysicsCategory
  linearDamping?: number
  angularDamping?: number
  canSleep?: boolean
  sleeping?: boolean
  enabled?: boolean
  contactThreshold?: number
  onCollision?: (force: number, position: RAPIER.Vector) => void
  /** Anything the owner wants back from a raycast or a contact event. */
  owner?: unknown
}

export interface Physical {
  type: PhysicalType
  body: RAPIER.RigidBody
  colliders: RAPIER.Collider[]
  linearDamping: number
  angularDamping: number
  onCollision?: (force: number, position: RAPIER.Vector) => void
  owner?: unknown
  initialState: {
    position: { x: number; y: number; z: number }
    rotation: RAPIER.Rotation
    sleeping: boolean
  }
  /** Transform at the start of the current simulation step. */
  previous: { position: THREE.Vector3; quaternion: THREE.Quaternion }
  /** Transform after the current simulation step. */
  current: { position: THREE.Vector3; quaternion: THREE.Quaternion }
  /** Skip interpolation bookkeeping — for static bodies. */
  static: boolean
}

interface BodyUserData {
  physical: Physical
}

export class Physics {
  readonly rapier: typeof RAPIER
  readonly world: RAPIER.World
  private eventQueue: RAPIER.EventQueue
  readonly physicals: Physical[] = []

  readonly groups = {
    all: 0b0000000000000001,
    object: 0b0000000000000010,
    bumper: 0b0000000000000100,
    // Upstream has three groups. This fourth one exists so a QUERY
    // can address the world's solid surfaces and nothing else: with
    // only `all`, a downward ray from the car hits the car, because
    // every collider is a member of `all`. Terrain and static world
    // geometry carry it; props and the vehicle do not.
    terrain: 0b0000000000001000,
  }

  readonly categories: Record<PhysicsCategory, number>
  /** InteractionGroups for a raycast that should only see solid world. */
  readonly queryTerrainOnly: number
  readonly queryObjectsOnly: number
  private frictionRules: Record<string, RAPIER.CoefficientCombineRule>

  /**
   * Sea level for damping on anything not over inland water.
   *
   * Read straight from the geography rather than duplicated. The
   * comment here used to claim "the world sets it at boot"; nothing
   * did, so this was a second, silently divergent copy of
   * OCEAN_LEVEL sitting in the middle of the physics step. Changing
   * the beach would have moved the waterline without moving the
   * damping threshold, and the resulting "the car goes heavy on dry
   * sand" would have looked like a vehicle bug.
   */
  waterElevation = OCEAN_LEVEL
  waterAt: ((x: number, z: number) => number | null) | null = null

  constructor(rapier: typeof RAPIER, private ticker: Ticker, bin: Bin) {
    this.rapier = rapier
    this.world = new rapier.World({ x: 0, y: -9.81, z: 0 })
    this.eventQueue = new rapier.EventQueue(true)

    const { all, object, bumper, terrain } = this.groups
    this.categories = {
      floor: ((all | terrain) << 16) | (all | terrain),
      object: ((all | object) << 16) | (all | bumper),
      bumper: (bumper << 16) | object,
      // Sensors observe props without pushing them.
      sensor: (all << 16) | (all | object),
    }

    // Query mask that matches the floor category and nothing else.
    this.queryTerrainOnly = (terrain << 16) | terrain
    // …and one that matches everything BUILT, and no terrain at all.
    this.queryObjectsOnly = ((all | object) << 16) | (all | object)

    this.frictionRules = {
      average: rapier.CoefficientCombineRule.Average,
      min: rapier.CoefficientCombineRule.Min,
      max: rapier.CoefficientCombineRule.Max,
      multiply: rapier.CoefficientCombineRule.Multiply,
    }

    // Order 3: after player (1) and vehicle (2) pre-physics.
    const step = () => this.step()
    this.ticker.events.on('fixed', step, 3)
    bin.add(() => this.ticker.events.off('fixed', step))
    bin.add(() => this.destroy())
  }

  getBinaryGroups(groupNames: (keyof typeof this.groups)[]): number {
    let binary = 0
    for (const name of groupNames) binary |= this.groups[name]
    return binary
  }

  add(description: PhysicalDescription): Physical {
    const R = this.rapier

    const linearDamping = description.linearDamping ?? 0.1
    const angularDamping = description.angularDamping ?? 0.1

    let bodyDesc: RAPIER.RigidBodyDesc
    const type: PhysicalType = description.type ?? 'dynamic'
    switch (type) {
      case 'fixed': bodyDesc = R.RigidBodyDesc.fixed(); break
      case 'kinematicPositionBased': bodyDesc = R.RigidBodyDesc.kinematicPositionBased(); break
      case 'kinematicVelocityBased': bodyDesc = R.RigidBodyDesc.kinematicVelocityBased(); break
      default: bodyDesc = R.RigidBodyDesc.dynamic()
    }

    if (description.position) {
      bodyDesc.setTranslation(description.position.x, description.position.y, description.position.z)
    }
    if (description.rotation) bodyDesc.setRotation(description.rotation)
    if (description.canSleep !== undefined) bodyDesc.setCanSleep(description.canSleep)
    bodyDesc.setLinearDamping(linearDamping)
    bodyDesc.setAngularDamping(angularDamping)
    if (description.sleeping !== undefined) bodyDesc.setSleeping(description.sleeping)
    if (description.enabled !== undefined) bodyDesc.setEnabled(description.enabled)

    const body = this.world.createRigidBody(bodyDesc)

    const colliders: RAPIER.Collider[] = []
    const overwrite = description.collidersOverwrite ?? {}

    for (const raw of description.colliders) {
      const c: ColliderDescription = { ...raw, ...overwrite }
      let desc: RAPIER.ColliderDesc

      switch (c.shape) {
        case 'cuboid': desc = R.ColliderDesc.cuboid(c.parameters[0], c.parameters[1], c.parameters[2]); break
        case 'ball': desc = R.ColliderDesc.ball(c.parameters[0]); break
        case 'cylinder': desc = R.ColliderDesc.cylinder(c.parameters[0], c.parameters[1]); break
        case 'cone': desc = R.ColliderDesc.cone(c.parameters[0], c.parameters[1]); break
        case 'capsule': desc = R.ColliderDesc.capsule(c.parameters[0], c.parameters[1]); break
        case 'trimesh': desc = R.ColliderDesc.trimesh(c.parameters[0], c.parameters[1]); break
        case 'hull': {
          const hull = R.ColliderDesc.convexHull(c.parameters[0])
          if (!hull) throw new Error('[world] convex hull could not be built')
          desc = hull
          break
        }
        case 'heightfield':
          desc = R.ColliderDesc.heightfield(c.parameters[0], c.parameters[1], c.parameters[2], c.parameters[3])
          break
      }

      if (c.position) desc = desc.setTranslation(c.position.x, c.position.y, c.position.z)
      if (c.quaternion) desc = desc.setRotation(c.quaternion)

      desc = desc.setDensity(0.1)

      if (c.mass !== undefined) {
        if (c.centerOfMass) {
          desc = desc.setMassProperties(
            c.mass,
            c.centerOfMass,
            { x: 1, y: 1, z: 1 },
            { x: 0, y: 0, z: 0, w: 1 },
          )
        } else {
          desc = desc.setMass(c.mass)
        }
      }
      if (description.mass !== undefined) {
        desc = desc.setMass(description.mass / description.colliders.length)
      }

      if (description.friction !== undefined) desc = desc.setFriction(description.friction)
      else if (c.friction !== undefined) desc = desc.setFriction(c.friction)
      else desc = desc.setFriction(0.2)

      if (description.frictionRule) {
        desc = desc.setFrictionCombineRule(this.frictionRules[description.frictionRule])
      }

      if (description.restitution !== undefined) desc = desc.setRestitution(description.restitution)
      else if (c.restitution !== undefined) desc = desc.setRestitution(c.restitution)
      else desc = desc.setRestitution(0.15)

      const category: PhysicsCategory = description.category ?? c.category ?? 'object'
      desc = desc.setCollisionGroups(this.categories[category])

      if (c.sensor) desc = desc.setSensor(true)

      if (typeof description.onCollision === 'function' || description.contactThreshold !== undefined) {
        desc = desc.setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
        desc = desc.setContactForceEventThreshold(description.contactThreshold ?? 15)
      }

      colliders.push(this.world.createCollider(desc, body))
    }

    const t = body.translation()
    const position = new THREE.Vector3(t.x, t.y, t.z)
    const r = body.rotation()
    const quaternion = new THREE.Quaternion(r.x, r.y, r.z, r.w)

    const physical: Physical = {
      type,
      body,
      colliders,
      linearDamping,
      angularDamping,
      onCollision: description.onCollision,
      owner: description.owner,
      initialState: {
        position: { x: t.x, y: t.y, z: t.z },
        rotation: { x: r.x, y: r.y, z: r.z, w: r.w },
        sleeping: body.isSleeping(),
      },
      previous: { position: position.clone(), quaternion: quaternion.clone() },
      current: { position, quaternion },
      static: type === 'fixed',
    }

    body.userData = { physical } satisfies BodyUserData
    this.physicals.push(physical)
    return physical
  }

  remove(physical: Physical): void {
    const index = this.physicals.indexOf(physical)
    if (index !== -1) this.physicals.splice(index, 1)
    // Removing the body removes its colliders too.
    this.world.removeRigidBody(physical.body)
  }

  /** Puts a body back where it was created and stops it dead. */
  reset(physical: Physical): void {
    const s = physical.initialState
    physical.body.resetForces(true)
    physical.body.resetTorques(true)
    physical.body.setEnabled(true)
    physical.body.setTranslation(s.position, true)
    physical.body.setRotation(s.rotation, true)
    physical.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    physical.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    physical.current.position.set(s.position.x, s.position.y, s.position.z)
    physical.current.quaternion.set(s.rotation.x, s.rotation.y, s.rotation.z, s.rotation.w)
    physical.previous.position.copy(physical.current.position)
    physical.previous.quaternion.copy(physical.current.quaternion)
    if (s.sleeping) physical.body.sleep()
  }

  /** Interpolated render transform. `alpha` comes from the Ticker. */
  sample(physical: Physical, alpha: number, outPosition: THREE.Vector3, outQuaternion: THREE.Quaternion): void {
    if (physical.static) {
      outPosition.copy(physical.current.position)
      outQuaternion.copy(physical.current.quaternion)
      return
    }
    outPosition.lerpVectors(physical.previous.position, physical.current.position, alpha)
    outQuaternion.slerpQuaternions(physical.previous.quaternion, physical.current.quaternion, alpha)
  }

  private step(): void {
    // Fixed step — see Ticker. `deltaScaled` is FIXED_DELTA * scale.
    this.world.timestep = this.ticker.deltaScaled

    for (const physical of this.physicals) {
      if (physical.static) continue

      // Roll the render-interpolation window forward.
      physical.previous.position.copy(physical.current.position)
      physical.previous.quaternion.copy(physical.current.quaternion)

      /*
        A SLEEPING BODY PAYS NOTHING.

        Everything below this line is water damping, and it was run for
        every non-static body on the island sixty times a second whether
        or not the body had moved since the world booted. `waterAt` is
        five ellipse tests and an eight-segment polyline distance, so a
        settled crate on the far side of the map cost the same as the
        car. With a few hundred pieces of knockable decoration in the
        world that is the frame budget, and it does not show up as a
        draw call — it shows up as jitter.

        Rapier re-applies nothing on wake, so the damping is simply set
        again on the first step after the body stirs, which is the frame
        it starts moving in. A car that drives into a lake still goes
        heavy: it was never asleep.
      */
      if (physical.body.isSleeping()) continue

      /*
        Underwater bodies get damping rather than buoyancy — the same
        trick upstream uses, and it reads correctly at speed. What it
        must NOT be is a step: the old version snapped from the body's
        own damping to 1.0 the instant the origin crossed the
        waterline, so a car that put one wheel in the shallows lurched
        as though it had hit something. Now the drag comes on over the
        first metre, which is exactly the depth the beaches and the
        river are authored to.
      */
      const water = this.waterAt?.(physical.current.position.x, physical.current.position.z) ?? this.waterElevation
      const depth = water - physical.current.position.y
      if (depth > -0.35) {
        const wet = clamp((depth + 0.35) / 1.35, 0, 1)
        const drag = wet * wet
        physical.body.setLinearDamping(physical.linearDamping + (1 - physical.linearDamping) * drag)
        physical.body.setAngularDamping(physical.angularDamping + (1 - physical.angularDamping) * drag)
      } else {
        physical.body.setLinearDamping(physical.linearDamping)
        physical.body.setAngularDamping(physical.angularDamping)
      }
    }

    this.world.step(this.eventQueue)

    for (const physical of this.physicals) {
      if (physical.static) continue
      const t = physical.body.translation()
      const r = physical.body.rotation()
      physical.current.position.set(t.x, t.y, t.z)
      physical.current.quaternion.set(r.x, r.y, r.z, r.w)
    }

    this.eventQueue.drainContactForceEvents((event) => {
      const collider1 = this.world.getCollider(event.collider1())
      const collider2 = this.world.getCollider(event.collider2())
      const body1 = collider1?.parent()
      const body2 = collider2?.parent()
      if (!body1 || !body2) return

      const callback1 = (body1.userData as BodyUserData | undefined)?.physical?.onCollision
      const callback2 = (body2.userData as BodyUserData | undefined)?.physical?.onCollision
      if (!callback1 && !callback2) return

      const mass1 = body1.mass()
      const mass2 = body2.mass()
      const force = event.maxForceMagnitude() / (mass1 + mass2 || 1)

      const p1 = body1.translation()
      const p2 = body2.translation()
      // A fixed body sits at the origin of its own description; prefer
      // the one that has actually moved.
      const at = p1.x === 0 && p1.y === 0 && p1.z === 0 ? p2 : p1

      callback1?.(force, at)
      callback2?.(force, at)
    })
  }

  /**
   * Elevation of the solid world below (x, z), or null if there is
   * none. Only the `floor` category answers, so the car cannot
   * measure itself.
   */
  groundAt(x: number, z: number, y = 60, maxDistance = 200): number | null {
    const ray = new this.rapier.Ray({ x, y, z }, { x: 0, y: -1, z: 0 })
    const hit = this.world.castRay(ray, maxDistance, true, undefined, this.queryTerrainOnly)
    if (hit) return y - hit.timeOfImpact
    // Rapier 0.17 can miss a perfectly vertical ray exactly on a heightfield
    // row seam. A 1 mm offset avoids a false "no ground" at authored points.
    const seam = this.world.castRay(new this.rapier.Ray({ x, y, z: z + .001 }, { x: 0, y: -1, z: 0 }), maxDistance, true, undefined, this.queryTerrainOnly)
    return seam ? y - seam.timeOfImpact : null
  }

  /**
   * The top of whatever is BUILT at this column — a wall, a ramp, a
   * gate, a voxel stack — or null for open ground.
   *
   * `groundAt` filters to the terrain group, so asking it whether a
   * respawn point is clear of a structure compared the heightfield
   * with itself and always said yes. That is why `Respawns.validate`
   * has never moved a point in its life.
   */
  obstacleAt(x: number, z: number, y = 60, maxDistance = 200): number | null {
    const ray = new this.rapier.Ray({ x, y, z }, { x: 0, y: -1, z: 0 })
    // Fixed bodies only. A crate is not a reason to move a respawn —
    // you push it out of the way — and asking this question during
    // world construction, before anything has fallen, saw every
    // dynamic prop still sitting at its spawn height and read a stack
    // of settling boxes as a three-metre wall.
    const hit = this.world.castRay(
      ray, maxDistance, true,
      this.rapier.QueryFilterFlags.EXCLUDE_DYNAMIC | this.rapier.QueryFilterFlags.EXCLUDE_KINEMATIC,
      this.queryObjectsOnly,
    )
    return hit ? y - hit.timeOfImpact : null
  }

  /**
   * Rebuilds the broad phase so raycasts work before the first step.
   * `castRay` reads the query pipeline, which `step()` maintains — so
   * anything that raycasts during world construction, as the respawn
   * audit does, gets null from every ray until this is called.
   */
  refreshQueries(): void {
    this.world.updateSceneQueries?.()
  }

  destroy(): void {
    this.physicals.length = 0
    this.eventQueue.free()
    this.world.free()
  }
}
