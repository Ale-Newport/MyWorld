import * as THREE from 'three'
import { Events } from '../core/Events'
import { clamp } from '../core/maths'
import type { Ticker } from '../core/Ticker'
import type { Tweens, TweenHandle } from '../core/Tween'
import type { Bin } from '../core/Disposal'
import type { Inputs } from '../input/Inputs'
import type { Nipple } from '../input/Nipple'
import type { PhysicsVehicle, SuspensionState } from '../physics/PhysicsVehicle'
import type { View } from '../view/View'
import type { Respawns } from '../systems/Respawns'

/* ============================================================
   PORTED FROM: sources/Game/Player.js
   folio-2025 — Copyright (c) 2025 Bruno Simon — MIT
   See THIRD_PARTY_NOTICES.md.

   Turns input into driver intent, and owns everything about the
   *person* driving rather than the car: respawning, getting
   unstuck, the hydraulics, distance and time accounting.

   The hydraulics deserve a note. Each wheel has three suspension
   rest lengths (0.88 / 1.23 / 1.63) and three stiffnesses
   (20 / 30 / 40). Holding SPACE sets all four to `high`, which is
   the jump. Pressing a single number key sets ONE corner to `mid`,
   which tips the car. That is the whole feature: no bespoke jump
   code, no animation — the suspension is simply told to be longer,
   and the physics does the rest. It is also why the jump has
   weight: the car is being pushed off the ground by its own
   springs, not teleported upwards.

   Upstream's audio and achievement calls become events; the
   `respawn` overlay callback becomes an injected function so this
   file does not reach into the UI.
   ============================================================ */

export type PlayerState = 'default' | 'locked'

export type PlayerEvent =
  | 'respawn'
  | 'honk'
  | 'hydraulics'
  | 'jump'
  | 'stateChange'
  | 'distance'
  | 'stuck'
  | 'unstuck'
  | 'unstuckFailed'

const HYDRAULICS_ACTIONS = [
  'hydraulicsAll',
  'hydraulicsFront',
  'hydraulicsBack',
  'hydraulicsRight',
  'hydraulicsLeft',
  'hydraulicsFrontLeft',
  'hydraulicsFrontRight',
  'hydraulicsBackRight',
  'hydraulicsBackLeft',
] as const

/** How far the car is lifted when it is set back on its wheels in
 *  place. A little more than the chassis half-height, so the body it
 *  was resting its roof on is clear before gravity takes over. */
const RIGHTING_LIFT = 1.4

export class Player {
  readonly events = new Events<PlayerEvent>()

  state: PlayerState = 'default'

  accelerating = 0
  steering = 0
  boosting = 0
  braking = 0
  readonly suspensions: [SuspensionState, SuspensionState, SuspensionState, SuspensionState] = [
    'low', 'low', 'low', 'low',
  ]

  readonly position = new THREE.Vector3()
  readonly position2 = new THREE.Vector2()
  rotationY = 0

  /** Metres driven, persisted by the save system. */
  distanceDriven = 0
  private distanceFloored = 0

  /** Seconds spent in the world, this session and in total. */
  timePlayed = { all: 0, session: 0 }

  /** Height above ground, metres. Used by achievements and audio. */
  elevation = 0

  private unstuckDelay: TweenHandle | null = null
  private unstuckHop: TweenHandle | null = null
  private hornCooldown = 0
  private nippleJumpTimer: TweenHandle | null = null

  /** Called before a respawn so the UI can fade to black first. */
  onRespawnTransition: ((commit: () => void) => void) | null = null
  /** Environment/gameplay routing; never changes driving parameters. */
  onRespawnRequest: (() => boolean) | null = null

  constructor(
    private inputs: Inputs,
    private vehicle: PhysicsVehicle,
    private view: View,
    private respawns: Respawns,
    private ticker: Ticker,
    private tweens: Tweens,
    private nipple: Nipple | null,
    bin: Bin,
  ) {
    const spawn = this.respawns.getDefault()
    this.position.copy(spawn.position)
    this.position2.set(spawn.position.x, spawn.position.z)

    this.vehicle.chassis.physical.initialState.position = {
      x: spawn.position.x,
      y: spawn.position.y,
      z: spawn.position.z,
    }
    this.vehicle.moveTo(spawn.position, spawn.rotation)
    this.view.focusPoint.trackedPosition.copy(spawn.position)
    this.view.snapToTarget()

    this.bindInputs(bin)
    this.bindVehicle(bin)

    const pre = () => this.updatePrePhysics()
    const post = () => this.updatePostPhysics()
    this.ticker.events.on('fixed', pre, 1)
    this.ticker.events.on('fixed', post, 6)

    bin.add(() => {
      this.ticker.events.off('fixed', pre)
      this.ticker.events.off('fixed', post)
      this.events.clear()
    })
  }

  /* ========================================================
     INPUT BINDINGS
     ======================================================== */
  private bindInputs(bin: Bin): void {
    const onRespawn = (action: { active: boolean }) => {
      if (this.state !== 'default' || !action.active) return
      this.respawn()
    }
    const onHorn = (action: { active: boolean }) => {
      if (action.active) this.honk()
    }
    const onHydraulics = () => this.updateHydraulics()
    const onJump = (action: { active: boolean }) => {
      onHydraulics()
      if (action.active && this.inputs.mode === 'touch') this.nipple?.jump()
    }

    this.inputs.events.on('respawn', onRespawn as never)
    this.inputs.events.on('horn', onHorn as never)
    this.inputs.events.on('jump', onJump as never)
    for (const name of HYDRAULICS_ACTIONS) {
      this.inputs.events.on(name, onHydraulics as never)
    }

    // A tap inside the joystick's dead zone is the touch jump.
    const onTap = () => {
      if (this.state !== 'default') return
      this.nipple?.jump()
      for (let i = 0; i < 4; i++) this.suspensions[i] = 'high'
      this.events.trigger('jump', [4])
      this.nippleJumpTimer?.kill()
      this.nippleJumpTimer = this.tweens.delay(0.2, () => {
        for (let i = 0; i < 4; i++) this.suspensions[i] = 'low'
      })
    }
    this.nipple?.events.on('tap', onTap as never)

    bin.add(() => {
      this.inputs.events.off('respawn', onRespawn as never)
      this.inputs.events.off('horn', onHorn as never)
      this.inputs.events.off('jump', onJump as never)
      for (const name of HYDRAULICS_ACTIONS) {
        this.inputs.events.off(name, onHydraulics as never)
      }
      this.nipple?.events.off('tap', onTap as never)
      this.nippleJumpTimer?.kill()
      this.unstuckDelay?.kill()
    })
  }

  private updateHydraulics(): void {
    if (this.state !== 'default') return

    const on = (name: string) => this.inputs.isActive(name)
    const all = on('jump') || on('hydraulicsAll')

    // Wheel order: 0 front-right, 1 front-left, 2 back-right, 3 back-left.
    const active = [
      all || on('hydraulicsFront') || on('hydraulicsRight') || on('hydraulicsFrontRight'),
      all || on('hydraulicsFront') || on('hydraulicsLeft') || on('hydraulicsFrontLeft'),
      all || on('hydraulicsBack') || on('hydraulicsRight') || on('hydraulicsBackRight'),
      all || on('hydraulicsBack') || on('hydraulicsLeft') || on('hydraulicsBackLeft'),
    ]

    // SPACE goes all the way to `high` — that is the jump. Number
    // keys stop at `mid`, which lifts without launching.
    const state: SuspensionState = on('jump') ? 'high' : 'mid'
    for (let i = 0; i < 4; i++) this.suspensions[i] = active[i] ? state : 'low'

    const count = active.reduce((n, a) => n + (a ? 1 : 0), 0)
    if (count === 0) return

    this.events.trigger('hydraulics', [count, state])
    if (state === 'high') this.events.trigger('jump', [count])
  }

  /* ========================================================
     VEHICLE EVENTS
     ======================================================== */
  private bindVehicle(bin: Bin): void {
    /*
      Three kicks, then a hand.

      The kick is `PhysicsVehicle.jump`: an upward impulse and a roll
      torque, which rights the car in the open in about a second. In a
      seven-metre labyrinth corridor it does not — there is nowhere to
      roll to, so the car lands back on its roof and the loop tried the
      same thing again for ever. The tour found one upside down between
      two walls and drove the remaining three stops on its roof; the
      same thing happens against the bowling shell and under the ramp.

      So the loop is bounded. After three kicks the car is set back on
      its wheels WHERE IT STANDS, facing the way it was already facing.
      That is not a respawn: it does not move you, it does not fire the
      respawn event, it does not fade, and it cannot fail. If the car
      is genuinely buried rather than merely inverted, the beached path
      below still ends in `respawn()`.
    */
    let kicks = 0

    const onRightSideUp = () => {
      this.unstuckDelay?.kill()
      this.unstuckDelay = null
      kicks = 0
    }

    const waitAndTest = () => {
      this.unstuckDelay = this.tweens.delay(3, () => {
        this.unstuckDelay = null
        if (this.state !== 'default') return
        if (!this.vehicle.upsideDown.active) {
          kicks = 0
          return
        }

        // Kick it back over rather than making the visitor find R.
        if (kicks < 3) {
          kicks++
          this.vehicle.jump()
          this.events.trigger('hydraulics', [4, 'high'])
          waitAndTest()
          return
        }

        kicks = 0
        this.rightItself()
        waitAndTest()
      })
    }

    const onUpsideDown = () => {
      this.unstuckDelay?.kill()
      waitAndTest()
    }

    /* ---- beached, not flipped -------------------------- */

    // Being on your roof is not the only way to be immobile. Landing
    // belly-down on a barrier leaves the car upright, level and with
    // no wheel touching anything, which the upside-down test cannot
    // see. The recovery is the same hop, and it has to exist: a
    // world with several hundred props in it WILL beach the car, and
    // "press R" is a worse answer than getting yourself out.
    let hops = 0
    const tryHop = () => {
      this.unstuckHop = this.tweens.delay(2, () => {
        this.unstuckHop = null
        if (this.state !== 'default' || !this.vehicle.stuck.active) {
          hops = 0
          return
        }

        hops++
        this.vehicle.jump()
        this.events.trigger('hydraulics', [4, 'high'])

        // Three hops is enough to tell the difference between wedged
        // and genuinely trapped. After that, put it back on a road.
        if (hops >= 3) {
          hops = 0
          this.events.trigger('unstuckFailed')
          this.respawn()
          return
        }
        tryHop()
      })
    }

    const onStuck = () => {
      if (this.vehicle.upsideDown.active) return
      this.events.trigger('stuck')
      tryHop()
    }
    const onUnstuck = () => {
      this.unstuckHop?.kill()
      this.unstuckHop = null
      hops = 0
      this.events.trigger('unstuck')
    }

    this.vehicle.events.on('rightSideUp', onRightSideUp as never)
    this.vehicle.events.on('upsideDown', onUpsideDown as never)
    this.vehicle.events.on('stuck', onStuck as never)
    this.vehicle.events.on('unstuck', onUnstuck as never)

    bin.add(() => {
      this.vehicle.events.off('rightSideUp', onRightSideUp as never)
      this.vehicle.events.off('upsideDown', onUpsideDown as never)
      this.vehicle.events.off('stuck', onStuck as never)
      this.vehicle.events.off('unstuck', onUnstuck as never)
      this.unstuckHop?.kill()
    })
  }

  /* ========================================================
     ACTIONS
     ======================================================== */

  /**
   * Sets the car back on its wheels without moving it.
   *
   * The last resort of the upside-down loop. `moveTo` is the same call
   * `respawn` makes, but with THIS position and THIS heading rather
   * than a respawn point's: the car keeps its place on the island and
   * only loses its inversion. It is lifted by its own ride height
   * first, because a chassis re-oriented in place starts intersecting
   * the ground it was resting its roof on, and Rapier resolves that by
   * firing it somewhere.
   */
  private rightItself(): void {
    // `rotationY` is measured off +X with the sign flipped (see
    // `updatePostPhysics`), and `moveTo` wants the angle it was
    // flipped from — so take the heading off the forward vector.
    const heading = Math.atan2(-this.vehicle.forward.z, this.vehicle.forward.x)
    this.vehicle.moveTo(
      { x: this.position.x, y: this.position.y + RIGHTING_LIFT, z: this.position.z },
      heading,
    )
    this.events.trigger('hydraulics', [4, 'mid'])
  }

  respawn(name: string | null = null): void {
    if (name === null && this.onRespawnRequest?.()) return
    const commit = () => {
      const target = name
        ? this.respawns.getByName(name) ?? this.respawns.getDefault()
        : this.respawns.getClosest(this.position)

      this.vehicle.moveTo(target.position, target.rotation)
      this.position.copy(target.position)
      this.view.focusPoint.trackedPosition.copy(target.position)
      this.view.snapToTarget()
      this.state = 'default'
      this.events.trigger('respawn', [target])
    }

    if (this.onRespawnTransition) this.onRespawnTransition(commit)
    else commit()
  }

  /** Locks input, waits, then respawns. Used by hazards. */
  die(): void {
    if (this.state === 'locked') return
    this.state = 'locked'
    this.events.trigger('stateChange', ['locked'])
    this.tweens.delay(1.6, () => this.respawn())
  }

  honk(): void {
    // Upstream bounces a random corner on the horn, which is a small
    // joke that makes the car feel alive. Kept.
    if (this.ticker.elapsed - this.hornCooldown < 0.12) return
    this.hornCooldown = this.ticker.elapsed

    const index = Math.floor(Math.random() * 4)
    const previous = this.suspensions[index]
    this.suspensions[index] = 'mid'
    this.tweens.delay(0.15, () => {
      if (this.suspensions[index] === 'mid') this.suspensions[index] = previous
    })

    this.events.trigger('honk')
  }

  setState(state: PlayerState): void {
    if (state === this.state) return
    this.state = state
    this.events.trigger('stateChange', [state])
  }

  /* ========================================================
     TICK
     ======================================================== */

  private updatePrePhysics(): void {
    this.accelerating = 0
    this.steering = 0
    this.boosting = 0
    this.braking = 0

    if (this.state === 'default') {
      const forward = this.inputs.actions.get('forward')
      const backward = this.inputs.actions.get('backward')
      if (forward?.active) this.accelerating += forward.value
      if (backward?.active) this.accelerating -= backward.value

      if (this.inputs.isActive('boost')) this.boosting = 1

      if (this.inputs.isActive('brake')) {
        this.accelerating = 0
        this.braking = 1
      }

      // Note the signs: positive steering turns left, matching the
      // vehicle's +Z axle.
      if (this.inputs.isActive('right')) this.steering -= 1
      if (this.inputs.isActive('left')) this.steering += 1

      const stick = this.inputs.gamepad.joysticks.left
      if (this.steering === 0 && stick.active) this.steering = -stick.safeX

      const touch = this.nipple?.intent()
      if (touch) {
        this.accelerating = touch.accelerating
        this.steering = touch.steering
        this.view.focusPoint.isTracking = true
      }

      this.accelerating = clamp(this.accelerating, -1, 1)
      this.steering = clamp(this.steering, -1, 1)
    }

    this.vehicle.input.accelerating = this.accelerating
    this.vehicle.input.steering = this.steering
    this.vehicle.input.boosting = this.boosting
    this.vehicle.input.braking = this.braking
    this.vehicle.input.suspensions = this.suspensions
  }

  private updatePostPhysics(): void {
    this.position.copy(this.vehicle.position)
    this.position2.set(this.position.x, this.position.z)

    this.view.focusPoint.trackedPosition.copy(this.position)

    // Speed lines only when the boost is actually doing something.
    this.view.speedLineStrength =
      this.boosting && this.accelerating && this.vehicle.speed > 15 ? 1 : 0

    this.rotationY = Math.atan2(this.vehicle.forward.z, this.vehicle.forward.x)
    this.nipple?.setCoordinates(this.position.x, this.position.y, this.position.z, this.rotationY)

    const dt = this.ticker.deltaScaled
    this.timePlayed.all += this.ticker.delta
    this.timePlayed.session += this.ticker.delta

    this.distanceDriven += this.vehicle.xzSpeed * dt
    const floored = Math.floor(this.distanceDriven)
    if (floored !== this.distanceFloored) {
      this.distanceFloored = floored
      this.events.trigger('distance', [floored])
    }
  }

  /** Restores persisted counters from the save file. */
  hydrate(saved: { distanceDriven?: number; timePlayed?: number }): void {
    this.distanceDriven = saved.distanceDriven ?? 0
    this.distanceFloored = Math.floor(this.distanceDriven)
    this.timePlayed.all = saved.timePlayed ?? 0
  }
}
