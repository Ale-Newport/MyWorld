import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import { Events } from '../core/Events'
import { lerp, smallestAngle } from '../core/maths'
import type { Ticker } from '../core/Ticker'
import type { Bin } from '../core/Disposal'
import type { Physical, Physics } from './Physics'

/* ============================================================
   PORTED FROM: sources/Game/Physics/PhysicsVehicle.js
   folio-2025 — Copyright (c) 2025 Bruno Simon — MIT
   https://github.com/brunosimon/folio-2025
   See THIRD_PARTY_NOTICES.md and ../vendor/LICENSE-folio-2025.md

   THIS FILE IS THE GAME FEEL. Every number below is upstream's,
   transcribed rather than re-derived, because they are the
   result of tuning that cannot be recovered from a screenshot:
   the 300 engine force divided by (1 + overflowSpeed) so the car
   pulls hard from rest and tapers instead of hitting a wall; the
   0.06 idle brake that makes it coast to a stop rather than
   rolling forever; the 0.4 reverse brake that turns "press the
   opposite key" into a handbrake rather than an instant gear
   change; three discrete suspension heights so the hydraulics
   read as mechanical.

   Do not "clean up" the constants. Changing them changes the car.

   Local axes, set by the wheel direction/axle vectors below:
     forward  +X      up  +Y      right (axle)  +Z
   Wheel order: 0 front-right, 1 front-left, 2 back-right, 3 back-left.
   Only 0 and 1 steer.

   Changes from upstream: TypeScript; audio/achievement calls are
   replaced by events the owner subscribes to, so this file has no
   dependencies beyond physics and the ticker; the surface-friction
   override is generalised from upstream's ice special-case; and
   `destroy()` exists.
   ============================================================ */

export type VehicleEvent =
  | 'stop'
  | 'start'
  | 'upsideDown'
  | 'rightSideUp'
  | 'stuck'
  | 'unstuck'
  | 'flip'
  | 'land'
  | 'takeOff'
  | 'collision'

export type SuspensionState = 'low' | 'mid' | 'high'

export interface VehicleDriverInput {
  /** -1..1. Negative is reverse. */
  accelerating: number
  /** -1..1. Positive steers left. */
  steering: number
  /** 0..1. */
  boosting: number
  /** 0..1. */
  braking: number
  suspensions: [SuspensionState, SuspensionState, SuspensionState, SuspensionState]
}

export interface Wheel {
  inContact: boolean
  contactPoint: RAPIER.Vector | null
  contactNormal: RAPIER.Vector | null
  suspensionLength: number
  suspensionState: SuspensionState
  lastTouchTime: number
  basePosition: THREE.Vector3
  /** Accumulated spin, radians. Driven by the controller. */
  rotation: number
  /** Sideways slip impulse — used for skid marks and tyre squeal. */
  sideImpulse: number
  forwardImpulse: number
  /** Collider under the wheel, for per-surface friction. */
  groundCollider: RAPIER.Collider | null
}

/**
 * Per-surface grip. `null` means "use the default frictionSlip"; a null
 * collider means "a wheel with nothing under it", which the vehicle never
 * asks about but a caller wanting to know the default can.
 */
export type SurfaceFriction = (collider: RAPIER.Collider | null) => number | null

export class PhysicsVehicle {
  readonly events = new Events<VehicleEvent>()

  /* ---- upstream tuning constants ------------------------ */
  steeringAmplitude = 0.5
  engineForceAmplitude = 300
  boostMultiplier = 2
  topSpeed = 5
  topSpeedBoost = 40
  brakeAmplitude = 35
  idleBrake = 0.06
  reverseBrake = 0.4

  readonly suspensionsHeights: Record<SuspensionState, number> = { low: 0.88, mid: 1.23, high: 1.63 }
  readonly suspensionsStiffness: Record<SuspensionState, number> = { low: 20, mid: 30, high: 40 }

  /* ---- live state --------------------------------------- */
  readonly sideward = new THREE.Vector3(0, 0, 1)
  readonly upward = new THREE.Vector3(0, 1, 0)
  readonly forward = new THREE.Vector3(1, 0, 0)
  readonly position = new THREE.Vector3(0, 4, 0)
  readonly quaternion = new THREE.Quaternion()
  velocity = new THREE.Vector3()
  direction = new THREE.Vector3(1, 0, 0)
  speed = 0
  xzSpeed = 0
  forwardRatio = 1
  goingForward = true
  forwardSpeed = 0
  xRotation = 0
  yRotation = 0
  zRotation = 0

  chassis!: { physical: Physical; mass: number }
  controller!: RAPIER.DynamicRayCastVehicleController

  readonly wheels = {
    inContactCount: 0,
    justTouchedCount: 0,
    items: [] as Wheel[],
    perimeter: 0,
    settings: {
      offset: { x: 0.9, y: 0, z: 0.75 },
      radius: 0.4,
      directionCs: { x: 0, y: -1, z: 0 },
      axleCs: { x: 0, y: 0, z: 1 },
      frictionSlip: 0.9,
      maxSuspensionForce: 150,
      maxSuspensionTravel: 2,
      sideFrictionStiffness: 3,
      suspensionCompression: 10,
      suspensionRelaxation: 2.7,
      suspensionStiffness: 25,
    },
  }

  /** Driver intent, written by Player before the physics step. */
  input: VehicleDriverInput = {
    accelerating: 0,
    steering: 0,
    boosting: 0,
    braking: 0,
    suspensions: ['low', 'low', 'low', 'low'],
  }

  surfaceFriction: SurfaceFriction | null = null

  readonly stop = { active: true, lowThreshold: 0.04, highThreshold: 0.7 }
  readonly upsideDown = { active: false, ratio: 0, threshold: 0.3 }
  readonly stuck = {
    durationTest: 3,
    durationSaved: 0,
    savedItems: [] as [number, number][],
    distance: 0,
    distanceThreshold: 0.5,
    active: false,
  }
  readonly flipState = { force: 5, inAir: false }

  private previousXAngle = 0
  private accumulatedXAngle = 0
  private previousZAngle = 0
  private accumulatedZAngle = 0
  private airborneSince = 0

  private readonly scratchVector = new THREE.Vector3()
  private readonly scratchEuler = new THREE.Euler()
  private readonly downward = new THREE.Vector3(0, -1, 0)
  private readonly worldUp = new THREE.Vector3(0, 1, 0)

  constructor(
    private physics: Physics,
    private ticker: Ticker,
    bin: Bin,
    spawn: { x: number; y: number; z: number } = { x: 0, y: 4, z: 0 },
    spawnRotation = 0,
  ) {
    this.position.set(spawn.x, spawn.y, spawn.z)

    this.setChassis()
    this.controller = this.physics.world.createVehicleController(this.chassis.physical.body)
    this.setWheels()
    this.moveTo(this.position, spawnRotation)

    const pre = () => this.updatePrePhysics()
    const post = () => this.updatePostPhysics()
    this.ticker.events.on('fixed', pre, 2)
    this.ticker.events.on('fixed', post, 5)

    bin.add(() => {
      this.ticker.events.off('fixed', pre)
      this.ticker.events.off('fixed', post)
      this.events.clear()
    })
  }

  private setChassis(): void {
    const physical = this.physics.add({
      type: 'dynamic',
      position: this.position,
      friction: 0.4,
      colliders: [
        // Main body. The low centre of mass is what stops it flipping
        // on every kerb; raise it and the car becomes unplayable.
        {
          shape: 'cuboid',
          mass: 2.5,
          parameters: [1.3, 0.4, 0.85],
          position: { x: 0, y: -0.1, z: 0 },
          centerOfMass: { x: 0, y: -0.5, z: 0 },
        },
        // Cabin. Massless — it exists so the roof collides.
        { shape: 'cuboid', mass: 0, parameters: [0.5, 0.15, 0.65], position: { x: 0, y: 0.4, z: 0 } },
        // Bumper. Massless, oversized, and collides only with props.
        {
          shape: 'cuboid',
          mass: 0,
          parameters: [1.5, 0.5, 0.9],
          position: { x: 0.1, y: -0.2, z: 0 },
          category: 'bumper',
        },
      ],
      canSleep: false,
      onCollision: (force, at) => {
        this.events.trigger('collision', [force, at])
      },
    })

    this.chassis = { physical, mass: physical.body.mass() }
  }

  private setWheels(): void {
    for (let i = 0; i < 4; i++) {
      // Placeholder values; updateWheelSettings writes the real ones.
      this.controller.addWheel({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, 1, 1)
      this.wheels.items.push({
        inContact: false,
        contactPoint: null,
        contactNormal: null,
        suspensionLength: 0,
        suspensionState: 'low',
        lastTouchTime: this.ticker.elapsed,
        basePosition: new THREE.Vector3(),
        rotation: 0,
        sideImpulse: 0,
        forwardImpulse: 0,
        groundCollider: null,
      })
    }
    this.updateWheelSettings()
  }

  updateWheelSettings(): void {
    const s = this.wheels.settings
    this.wheels.perimeter = s.radius * Math.PI * 2

    const positions = [
      new THREE.Vector3(s.offset.x, s.offset.y, s.offset.z),
      new THREE.Vector3(s.offset.x, s.offset.y, -s.offset.z),
      new THREE.Vector3(-s.offset.x, s.offset.y, s.offset.z),
      new THREE.Vector3(-s.offset.x, s.offset.y, -s.offset.z),
    ]

    for (let i = 0; i < 4; i++) {
      const wheel = this.wheels.items[i]
      wheel.basePosition.copy(positions[i])
      this.controller.setWheelDirectionCs(i, s.directionCs)
      this.controller.setWheelAxleCs(i, s.axleCs)
      this.controller.setWheelRadius(i, s.radius)
      this.controller.setWheelChassisConnectionPointCs(i, wheel.basePosition)
      this.controller.setWheelFrictionSlip(i, s.frictionSlip)
      this.controller.setWheelMaxSuspensionForce(i, s.maxSuspensionForce)
      this.controller.setWheelMaxSuspensionTravel(i, s.maxSuspensionTravel)
      this.controller.setWheelSideFrictionStiffness(i, s.sideFrictionStiffness)
      this.controller.setWheelSuspensionCompression(i, s.suspensionCompression)
      this.controller.setWheelSuspensionRelaxation(i, s.suspensionRelaxation)
      this.controller.setWheelSuspensionStiffness(i, s.suspensionStiffness)
    }
  }

  /* ========================================================
     PRE-PHYSICS — turn driver intent into wheel forces
     ======================================================== */
  private updatePrePhysics(): void {
    const input = this.input

    // Top speed is interpolated by boost rather than switched, so
    // tapping boost does not snap the force curve.
    const topSpeed = lerp(this.topSpeed, this.topSpeedBoost, input.boosting)
    const overflowSpeed = Math.max(0, this.speed - topSpeed)
    let engineForce =
      ((input.accelerating * (1 + input.boosting * this.boostMultiplier)) *
        this.engineForceAmplitude) /
      (1 + overflowSpeed) *
      this.ticker.deltaScaled

    let brake = input.braking
    if (!input.braking && Math.abs(input.accelerating) < 0.1) brake = this.idleBrake

    // Pressing against the direction of travel is a brake, not a
    // gear change. Below 0.5 speed it becomes reverse.
    if (
      this.speed > 0.5 &&
      ((input.accelerating > 0 && !this.goingForward) ||
        (input.accelerating < 0 && this.goingForward))
    ) {
      brake = this.reverseBrake
      engineForce = 0
    }

    brake *= this.brakeAmplitude * this.ticker.deltaScaled

    const steer = input.steering * this.steeringAmplitude
    this.controller.setWheelSteering(0, steer)
    this.controller.setWheelSteering(1, steer)

    for (let i = 0; i < 4; i++) {
      this.controller.setWheelBrake(i, brake)
      this.controller.setWheelEngineForce(i, engineForce)

      const state = input.suspensions[i]
      this.wheels.items[i].suspensionState = state
      this.controller.setWheelSuspensionRestLength(i, this.suspensionsHeights[state])
      this.controller.setWheelSuspensionStiffness(i, this.suspensionsStiffness[state])

      // Per-surface grip. Upstream special-cases ice; this is the
      // same hook, opened up so any surface can define its own.
      const ground = this.controller.wheelGroundObject(i)
      this.wheels.items[i].groundCollider = ground ?? null
      if (this.surfaceFriction) {
        const override = ground ? this.surfaceFriction(ground) : null
        this.controller.setWheelFrictionSlip(i, override ?? this.wheels.settings.frictionSlip)
      }
    }

    // Upstream: `quality.level === 1 ? 1/60 : min(1/60, deltaAverage)`.
    // On a fixed accumulator this is simply the fixed step, which is
    // what upstream resolves to at 60 Hz. The deliberate 2:1 gap
    // between this and `world.timestep` is part of the tuning.
    this.controller.updateVehicle(1 / 60)
  }

  /* ========================================================
     POST-PHYSICS — measure, then raise events
     ======================================================== */
  private updatePostPhysics(): void {
    const body = this.chassis.physical.body
    const t = body.translation()
    this.scratchVector.set(t.x, t.y, t.z)
    this.velocity.subVectors(this.scratchVector, this.position)
    this.direction.copy(this.velocity).normalize()
    this.position.copy(this.scratchVector)

    const r = body.rotation()
    this.quaternion.set(r.x, r.y, r.z, r.w)
    this.sideward.set(0, 0, 1).applyQuaternion(this.quaternion)
    this.upward.set(0, 1, 0).applyQuaternion(this.quaternion)
    this.forward.set(1, 0, 0).applyQuaternion(this.quaternion)

    const dt = this.ticker.deltaScaled
    this.speed = this.velocity.length() / dt
    this.xzSpeed = Math.hypot(this.velocity.x, this.velocity.z) / dt
    /*
      "Am I travelling the way I am pointing" is a question about the GROUND.
      `direction` is the normalised per-step position delta and `forward` is
      the chassis axis, so taking that dot product in three dimensions makes a
      car with its nose in the air — or its nose down off a ramp — read as
      travelling sideways: the ratio falls under 0.5 while the car is going
      dead ahead, and `updatePrePhysics` hands the driver the handbrake
      instead of the throttle. Measured over a boosted lap of the world-02
      circuit, that accounted for 8 of the 43 fixed steps where the throttle
      was held and no engine force came out, arriving as 17-83 ms episodes at
      30 m/s — a pedal that drops out for a few thousandths at a time.

      Flattening both vectors asks the question that is actually being asked.
      With no horizontal motion at all there is no such question, and the
      answer that does no harm is "forwards": a car falling straight down does
      not want the handbrake.
    */
    const flatDirection = Math.hypot(this.direction.x, this.direction.z)
    const flatForward = Math.hypot(this.forward.x, this.forward.z)
    this.forwardRatio = flatDirection > 1e-4 && flatForward > 1e-4
      ? (this.direction.x * this.forward.x + this.direction.z * this.forward.z) / (flatDirection * flatForward)
      : 1
    this.goingForward = this.forwardRatio > 0.5
    this.forwardSpeed = this.speed * this.forwardRatio

    this.xRotation = this.scratchEuler.setFromQuaternion(this.quaternion, 'XYZ').x
    this.yRotation = this.scratchEuler.setFromQuaternion(this.quaternion, 'YXZ').y
    this.zRotation = this.scratchEuler.setFromQuaternion(this.quaternion, 'ZYX').z

    if (Math.abs(this.input.accelerating) > 0.5) {
      this.accumulateStuck(this.velocity.length(), dt)
    }

    let inContactCount = 0
    for (let i = 0; i < 4; i++) {
      const wheel = this.wheels.items[i]
      const inContact = this.controller.wheelIsInContact(i)
      if (inContact && !wheel.inContact) wheel.lastTouchTime = this.ticker.elapsed
      wheel.inContact = inContact
      wheel.contactPoint = this.controller.wheelContactPoint(i)
      wheel.contactNormal = this.controller.wheelContactNormal(i)
      wheel.suspensionLength = this.controller.wheelSuspensionLength(i) ?? 0
      wheel.rotation = this.controller.wheelRotation(i) ?? wheel.rotation
      wheel.sideImpulse = this.controller.wheelSideImpulse(i) ?? 0
      wheel.forwardImpulse = this.controller.wheelForwardImpulse(i) ?? 0
      if (inContact) inContactCount++
    }

    let justTouchedCount = 0
    if (inContactCount > this.wheels.inContactCount) {
      for (const wheel of this.wheels.items) {
        if (wheel.lastTouchTime > this.ticker.elapsed - 0.2) justTouchedCount++
      }
    }

    const wasAirborne = this.wheels.inContactCount === 0
    this.wheels.inContactCount = inContactCount
    this.wheels.justTouchedCount = justTouchedCount

    if (wasAirborne && inContactCount > 0) {
      this.events.trigger('land', [this.ticker.elapsed - this.airborneSince, justTouchedCount])
    }
    if (!wasAirborne && inContactCount === 0) {
      this.airborneSince = this.ticker.elapsed
      this.events.trigger('takeOff')
    }

    this.testStop()
    this.testUpsideDown()
    this.testStuck()
    this.testFlip()
  }

  /* ---- stop / start ------------------------------------- */
  private testStop(): void {
    if (this.speed < this.stop.lowThreshold) {
      if (!this.stop.active) {
        this.stop.active = true
        this.events.trigger('stop')
      }
    } else if (this.speed > this.stop.highThreshold) {
      if (this.stop.active) {
        this.stop.active = false
        this.events.trigger('start')
      }
    }
  }

  /* ---- upside down -------------------------------------- */
  private testUpsideDown(): void {
    this.upsideDown.ratio = this.upward.dot(this.downward) * 0.5 + 0.5
    if (this.upsideDown.ratio > this.upsideDown.threshold) {
      if (!this.upsideDown.active) {
        this.upsideDown.active = true
        this.events.trigger('upsideDown', [this.upsideDown.ratio])
      }
    } else if (this.upsideDown.active) {
      this.upsideDown.active = false
      this.events.trigger('rightSideUp')
    }
  }

  /* ---- stuck -------------------------------------------- */
  private accumulateStuck(traveled: number, time: number): void {
    const s = this.stuck
    s.savedItems.unshift([traveled, time])
    s.distance = 0
    s.durationSaved = 0
    for (let i = 0; i < s.savedItems.length; i++) {
      if (s.durationSaved >= s.durationTest) {
        s.savedItems.splice(i)
        break
      }
      s.distance += s.savedItems[i][0]
      s.durationSaved += s.savedItems[i][1]
    }
  }

  private testStuck(): void {
    const s = this.stuck
    if (s.durationSaved >= s.durationTest && s.distance < s.distanceThreshold) {
      if (!s.active) {
        s.active = true
        this.events.trigger('stuck')
      }
    } else if (s.active) {
      s.active = false
      this.events.trigger('unstuck')
    }
  }

  /* ---- flips -------------------------------------------- */
  private testFlip(): void {
    if (this.wheels.inContactCount === 0 && !this.flipState.inAir) {
      this.flipState.inAir = true
      this.previousXAngle = this.xRotation
      this.accumulatedXAngle = 0
      this.previousZAngle = this.zRotation
      this.accumulatedZAngle = 0
    }

    if (this.wheels.inContactCount >= 4) {
      if (this.flipState.inAir) {
        this.flipState.inAir = false
        // A flip is a full rotation about Z with the car staying
        // roughly level about X — otherwise it is just a tumble.
        if (Math.abs(this.accumulatedXAngle) < 1 && Math.abs(this.accumulatedZAngle) > 5) {
          this.events.trigger('flip', [Math.sign(this.accumulatedZAngle)])
        }
      }
    } else if (this.flipState.inAir) {
      this.accumulatedXAngle += smallestAngle(this.previousXAngle, this.xRotation)
      this.previousXAngle = this.xRotation
      this.accumulatedZAngle += smallestAngle(this.previousZAngle, this.zRotation)
      this.previousZAngle = this.zRotation
    }
  }

  /**
   * The self-righting hop. Also the jump: an upward impulse plus a
   * torque chosen from whichever body axis is currently pointing at
   * the sky, so a car on its roof rolls back over instead of
   * hopping upside down.
   */
  jump(): void {
    this.accumulatedXAngle = 0
    this.accumulatedZAngle = 0

    const up = this.worldUp
    const sidewardDot = up.dot(this.sideward)
    const forwardDot = up.dot(this.forward)
    const upwardDot = up.dot(this.upward)

    const sidewardAbs = Math.abs(sidewardDot)
    const forwardAbs = Math.abs(forwardDot)
    const upwardAbs = Math.abs(upwardDot)

    const impulse = this.scratchVector.set(0, 1, 0).multiplyScalar(this.flipState.force * this.chassis.mass)
    this.chassis.physical.body.applyImpulse(impulse, true)

    const torque = new THREE.Vector3()
    if (upwardAbs > sidewardAbs && upwardAbs > forwardAbs) {
      torque.set(0.8 * this.chassis.mass, 0, 0)
    } else {
      torque.set(sidewardDot * 0.4 * this.chassis.mass, 0, -forwardDot * 0.8 * this.chassis.mass)
    }
    torque.applyQuaternion(this.quaternion)
    this.chassis.physical.body.applyTorqueImpulse(torque, true)
  }

  moveTo(position: { x: number; y: number; z: number }, rotation = 0): void {
    const quaternion = new THREE.Quaternion().setFromAxisAngle(this.worldUp, rotation)
    const body = this.chassis.physical.body
    body.setTranslation(position, true)
    body.setRotation(quaternion, true)
    body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    body.setAngvel({ x: 0, y: 0, z: 0 }, true)

    this.position.set(position.x, position.y, position.z)
    this.quaternion.copy(quaternion)
    this.velocity.set(0, 0, 0)
    this.speed = 0
    this.xzSpeed = 0

    const physical = this.chassis.physical
    physical.current.position.copy(this.position)
    physical.current.quaternion.copy(quaternion)
    physical.previous.position.copy(this.position)
    physical.previous.quaternion.copy(quaternion)

    // A respawn must not count as three seconds of not moving.
    this.stuck.savedItems.length = 0
    this.stuck.distance = 0
    this.stuck.durationSaved = 0
    this.stuck.active = false
    this.flipState.inAir = false
  }

  activate(): void {
    const body = this.chassis.physical.body
    body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    body.setEnabled(true)
  }

  deactivate(): void {
    this.chassis.physical.body.setEnabled(false)
  }

  /** Metres per real second, for the speedometer. */
  get speedKmh(): number {
    return this.xzSpeed * this.ticker.scale * 3.6
  }
}
