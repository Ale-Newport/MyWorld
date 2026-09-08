import * as THREE from 'three'
import { clamp, damp, remapClamp } from '../core/maths'
import { palette } from '../core/palette'
import type { Bin } from '../core/Disposal'
import type { Ticker } from '../core/Ticker'
import type { Physics } from '../physics/Physics'
import type { PhysicsVehicle } from '../physics/PhysicsVehicle'
import type { Player } from '../player/Player'
import type { Inputs } from '../input/Inputs'
import type { Materials } from './materials'
import { monogramTexture } from './materials'
import { chamferedBox, strutGeometry, wheelGeometry } from './geometry'

/* ============================================================
   THE VEHICLE, VISUALLY

   Structure and behaviour follow sources/Game/World/VisualVehicle.js
   (folio-2025, MIT — Copyright (c) 2025 Bruno Simon). See
   THIRD_PARTY_NOTICES.md. The car itself is Alejandro's: an
   off-white shell with a graphite greenhouse, a vermilion stripe
   and an AN plate on the door. No upstream model, texture or
   branding is used.

   What upstream gets right and is kept:
   - The chassis is NOT smoothed. Every bit of suppleness comes
     from the wheels; damping the body as well turns the car to
     jelly.
   - The suspension strut is a unit-height mesh scaled to
     `|hubY| - 0.5`, so its top always meets the body no matter
     how far the wheel has travelled.
   - Wheel spin is gated on braking-without-throttle, from raw
     input rather than from physics, which is what sells a
     locked-wheel skid.

   Three upstream frame-rate bugs are fixed rather than copied:
   the wheel spin had no delta term (wheels span twice as fast on
   a 120 Hz screen), and the steering and suspension lerps used
   `rate * delta` directly, which overshoots past 1 below ~30 fps.
   All three now use exponential damping.
   ============================================================ */

const WHEEL_RADIUS = 0.4
const WHEEL_WIDTH = 0.3

interface VisualWheel {
  container: THREE.Group
  spinner: THREE.Group
  strut: THREE.Mesh
  basePosition: THREE.Vector3
  spin: number
}

export class VisualVehicle {
  readonly group = new THREE.Group()
  readonly chassis = new THREE.Group()

  private wheels: VisualWheel[] = []
  private steeringVisual = 0

  private headlights!: THREE.Mesh
  private brakeLights!: THREE.Mesh
  private reverseLights!: THREE.Mesh
  private boostCells: THREE.Mesh[] = []
  private boostGlow!: THREE.Mesh
  private hornRing!: THREE.Mesh

  /** 0..1, sharpened. Drives every boost visual. */
  private boostMix = 0
  private hornPulse = 0
  private impactFlash = 0

  /** Normalised screen position of the car, for UI and effects. */
  readonly screenPosition = new THREE.Vector2(0.5, 0.5)

  private readonly interpolatedPosition = new THREE.Vector3()
  private readonly interpolatedQuaternion = new THREE.Quaternion()
  private readonly projected = new THREE.Vector3()

  /** Emitter points for the boost trail, in world space. */
  readonly trailEmitters = [new THREE.Vector3(), new THREE.Vector3()]
  private trailAnchors: THREE.Object3D[] = []
  trailActive = false

  constructor(
    private vehicle: PhysicsVehicle,
    private player: Player,
    private inputs: Inputs,
    private physics: Physics,
    private ticker: Ticker,
    private materials: Materials,
    bin: Bin,
    private castShadows = true,
  ) {
    this.build(bin)

    const update = () => this.update()
    // Order 8, as upstream: after View so the projection is current.
    this.ticker.events.on('tick', update, 8)

    const onCollision = (force: number) => {
      this.impactFlash = Math.max(this.impactFlash, clamp(force / 90, 0, 1))
    }
    this.vehicle.events.on('collision', onCollision as never)

    const onHorn = () => {
      this.hornPulse = 1
    }
    this.player.events.on('honk', onHorn as never)

    bin.add(() => {
      this.ticker.events.off('tick', update)
      this.vehicle.events.off('collision', onCollision as never)
      this.player.events.off('honk', onHorn as never)
    })
    bin.object3D(this.group)
  }

  /* ========================================================
     BUILD
     ======================================================== */
  private build(bin: Bin): void {
    this.group.add(this.chassis)

    const shell = this.materials.tinted(palette.paper2, 0.55, 0.08)
    const graphite = this.materials.get('graphite')
    const ink = this.materials.get('ink')
    const accent = this.materials.get('accent')
    const glass = this.materials.get('glass')

    const add = (
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      position: [number, number, number],
      parent: THREE.Object3D = this.chassis,
    ) => {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.set(...position)
      mesh.castShadow = this.castShadows
      mesh.receiveShadow = false
      parent.add(mesh)
      bin.add(() => geometry.dispose())
      return mesh
    }

    /* ---- body ------------------------------------------- */
    this.defaultShellMaterial = shell
    // Matches the main collider (half-extents 1.3 × 0.4 × 0.85)
    // with the chamfer pulled in, so what you see is what hits.
    this.shellMeshes.push(add(chamferedBox(2.56, 0.74, 1.66, 0.14), shell, [0, -0.1, 0]))

    // A lower sill in graphite: visually separates body from wheels
    // and hides the gap when the suspension is fully compressed.
    add(chamferedBox(2.44, 0.2, 1.72, 0.06), graphite, [0, -0.42, 0])

    // Bonnet scoop and boot lip, for a silhouette that has a front.
    add(chamferedBox(0.5, 0.1, 1.0, 0.04), graphite, [0.86, 0.24, 0])
    this.shellMeshes.push(add(chamferedBox(0.26, 0.16, 1.5, 0.05), shell, [-1.2, 0.16, 0]))

    /* ---- greenhouse ------------------------------------- */
    // Matches the cabin collider (0.5 × 0.15 × 0.65 at y 0.4).
    add(chamferedBox(0.98, 0.28, 1.28, 0.09), graphite, [-0.06, 0.42, 0])
    const windscreen = add(chamferedBox(1.0, 0.2, 1.3, 0.04), glass, [-0.06, 0.44, 0])
    windscreen.castShadow = false

    /* ---- the vermilion stripe --------------------------- */
    // One accent line down the spine. The site uses exactly one
    // signal colour; the car does the same.
    add(chamferedBox(2.3, 0.03, 0.14, 0.01), accent, [0, 0.29, 0])

    /* ---- AN plate on each door -------------------------- */
    const monogram = monogramTexture(palette.ink, null)
    bin.add(() => monogram.dispose())
    const plateMaterial = this.materials.own(
      new THREE.MeshBasicMaterial({ map: monogram, transparent: true, opacity: 0.82 }),
    )
    for (const side of [1, -1]) {
      const plateGeometry = new THREE.PlaneGeometry(0.34, 0.34)
      const plate = new THREE.Mesh(plateGeometry, plateMaterial)
      plate.position.set(-0.1, 0.02, side * 0.845)
      plate.rotation.y = side > 0 ? 0 : Math.PI
      this.chassis.add(plate)
      bin.add(() => plateGeometry.dispose())
    }

    /* ---- lights ----------------------------------------- */
    const headlightGeometry = new THREE.BoxGeometry(0.06, 0.13, 1.16)
    this.headlights = new THREE.Mesh(headlightGeometry, this.materials.get('emissiveWhite'))
    this.headlights.position.set(1.29, 0.02, 0)
    this.chassis.add(this.headlights)
    bin.add(() => headlightGeometry.dispose())

    const brakeGeometry = new THREE.BoxGeometry(0.06, 0.12, 1.2)
    this.brakeLights = new THREE.Mesh(brakeGeometry, this.materials.get('emissiveAccent'))
    this.brakeLights.position.set(-1.31, 0.06, 0)
    this.brakeLights.visible = false
    this.chassis.add(this.brakeLights)
    bin.add(() => brakeGeometry.dispose())

    const reverseGeometry = new THREE.BoxGeometry(0.05, 0.09, 0.5)
    this.reverseLights = new THREE.Mesh(reverseGeometry, this.materials.get('emissiveWhite'))
    this.reverseLights.position.set(-1.31, -0.1, 0)
    this.reverseLights.visible = false
    this.chassis.add(this.reverseLights)
    bin.add(() => reverseGeometry.dispose())

    /* ---- boost cells ------------------------------------ */
    // Three plates in the rear deck that drop as the boost charges,
    // in upstream's deliberately uneven 1-3-2 order.
    for (let i = 0; i < 3; i++) {
      const geometry = new THREE.BoxGeometry(0.16, 0.06, 0.26)
      const cell = new THREE.Mesh(geometry, this.materials.get('emissiveAccent'))
      cell.position.set(-0.86, 0.2, (i - 1) * 0.34)
      this.chassis.add(cell)
      this.boostCells.push(cell)
      bin.add(() => geometry.dispose())
    }

    const glowGeometry = new THREE.PlaneGeometry(0.9, 0.5)
    this.boostGlow = new THREE.Mesh(
      glowGeometry,
      this.materials.own(
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(palette.accentSoft),
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      ),
    )
    this.boostGlow.position.set(-1.4, -0.06, 0)
    this.boostGlow.rotation.y = Math.PI * 0.5
    this.chassis.add(this.boostGlow)
    bin.add(() => glowGeometry.dispose())

    for (const z of [-0.55, 0.55]) {
      const anchor = new THREE.Object3D()
      anchor.position.set(-1.28, 0.1, z)
      this.chassis.add(anchor)
      this.trailAnchors.push(anchor)
    }

    /* ---- horn ring -------------------------------------- */
    // A ring that pops on the ground when the horn sounds. Cheaper
    // and clearer than a particle burst at this camera distance.
    const ringGeometry = new THREE.RingGeometry(0.6, 0.72, 32)
    ringGeometry.rotateX(-Math.PI * 0.5)
    this.hornRing = new THREE.Mesh(
      ringGeometry,
      this.materials.own(
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(palette.accent),
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      ),
    )
    this.hornRing.visible = false
    this.group.add(this.hornRing)
    bin.add(() => ringGeometry.dispose())

    /* ---- wheels ----------------------------------------- */
    const tyreGeometry = wheelGeometry(WHEEL_RADIUS, WHEEL_WIDTH, 16)
    const hubGeometry = wheelGeometry(WHEEL_RADIUS * 0.46, WHEEL_WIDTH + 0.02, 10)
    const spokeGeometry = new THREE.BoxGeometry(WHEEL_RADIUS * 1.5, 0.045, WHEEL_WIDTH * 0.55)
    const strut = strutGeometry(0.055, 8)
    bin.add(() => {
      tyreGeometry.dispose()
      hubGeometry.dispose()
      spokeGeometry.dispose()
      strut.dispose()
    })

    for (let i = 0; i < 4; i++) {
      const base = this.vehicle.wheels.items[i].basePosition

      const container = new THREE.Group()
      container.position.set(base.x, base.y - WHEEL_RADIUS, base.z)
      this.chassis.add(container)

      const spinner = new THREE.Group()
      container.add(spinner)

      const tyre = new THREE.Mesh(tyreGeometry, ink)
      tyre.castShadow = this.castShadows
      spinner.add(tyre)

      const hub = new THREE.Mesh(hubGeometry, this.materials.tinted(palette.paper, 0.6, 0.1))
      spinner.add(hub)

      // Two crossed spokes: enough to read the spin, cheap to draw.
      for (const angle of [0, Math.PI / 2]) {
        const spoke = new THREE.Mesh(spokeGeometry, this.materials.tinted(palette.paper3, 0.7, 0))
        spoke.rotation.z = angle
        spinner.add(spoke)
      }

      const strutMesh = new THREE.Mesh(strut, this.materials.get('metal'))
      strutMesh.castShadow = false
      container.add(strutMesh)

      this.wheels.push({
        container,
        spinner,
        strut: strutMesh,
        basePosition: base.clone(),
        spin: 0,
      })
    }
  }

  /* ========================================================
     UPDATE
     ======================================================== */
  private update(): void {
    const dt = this.ticker.delta
    const scaled = dt * this.ticker.scale
    const vehicle = this.vehicle

    /* ---- chassis: interpolated, never smoothed ---------- */
    this.physics.sample(
      vehicle.chassis.physical,
      this.ticker.alpha,
      this.interpolatedPosition,
      this.interpolatedQuaternion,
    )
    this.chassis.position.copy(this.interpolatedPosition)
    this.chassis.quaternion.copy(this.interpolatedQuaternion)

    /* ---- steering --------------------------------------- */
    const steerTarget = this.player.steering * vehicle.steeringAmplitude
    this.steeringVisual = damp(this.steeringVisual, steerTarget, 32, dt)

    /* ---- wheels ----------------------------------------- */
    const braking = this.inputs.isActive('brake')
    const throttling = this.inputs.isActive('forward') || this.inputs.isActive('backward')
    const wheelsTurn = !braking || throttling

    for (let i = 0; i < 4; i++) {
      const visual = this.wheels[i]
      const physical = vehicle.wheels.items[i]

      // Front wheels steer; rear wheels do not.
      if (i < 2) visual.container.rotation.y = this.steeringVisual

      // The hub sits at the far end of the suspension travel. The
      // clamp keeps it from rising into the body, which is also what
      // keeps the strut scale positive.
      const hubY = Math.min(visual.basePosition.y - physical.suspensionLength, -0.5)
      visual.container.position.y = damp(visual.container.position.y, hubY, 50, dt)
      visual.strut.scale.y = Math.max(0.001, Math.abs(visual.container.position.y) - 0.5)

      if (wheelsTurn) {
        visual.spin += (vehicle.forwardSpeed / WHEEL_RADIUS) * scaled
        visual.spinner.rotation.z = visual.spin
      }
    }

    /* ---- lights ----------------------------------------- */
    const reversing = this.player.accelerating < -0.05
    this.brakeLights.visible = this.player.braking > 0.5 || (braking && vehicle.speed > 0.4)
    this.reverseLights.visible = reversing

    // Headlights come on at night; DayCycle writes `nightFactor`.
    this.headlights.visible = this.nightFactor > 0.25

    /* ---- boost ------------------------------------------ */
    const boosting = this.player.boosting > 0.5 && this.player.accelerating > 0
    const raw = clamp(this.boostRaw + (boosting ? 1 : -1) * scaled * 1.2, 0, 1)
    this.boostRaw = raw
    // Sharpened so the visual arrives instantly and decays slowly.
    this.boostMix = 1 - Math.pow(1 - raw, 7)

    this.boostCells[0].position.y = remapClamp(this.boostMix, 0, 0.6, 0.2, 0)
    this.boostCells[2].position.y = remapClamp(this.boostMix, 0.2, 0.8, 0.2, 0)
    this.boostCells[1].position.y = remapClamp(this.boostMix, 0.4, 1, 0.2, 0)

    const glowMaterial = this.boostGlow.material as THREE.MeshBasicMaterial
    glowMaterial.opacity = this.boostMix * 0.55
    this.boostGlow.scale.setScalar(0.75 + this.boostMix * 0.7)

    this.trailActive = vehicle.goingForward && boosting && vehicle.speed > 4
    for (let i = 0; i < this.trailAnchors.length; i++) {
      this.trailAnchors[i].getWorldPosition(this.trailEmitters[i])
    }

    /* ---- horn ring -------------------------------------- */
    if (this.hornPulse > 0) {
      this.hornPulse = Math.max(0, this.hornPulse - dt * 1.6)
      const t = 1 - this.hornPulse
      this.hornRing.visible = true
      this.hornRing.position.set(
        this.chassis.position.x,
        this.chassis.position.y - 0.6,
        this.chassis.position.z,
      )
      this.hornRing.scale.setScalar(0.6 + t * 4.2)
      ;(this.hornRing.material as THREE.MeshBasicMaterial).opacity = this.hornPulse * 0.5
    } else if (this.hornRing.visible) {
      this.hornRing.visible = false
    }

    /* ---- impact flash ----------------------------------- */
    if (this.impactFlash > 0) {
      this.impactFlash = Math.max(0, this.impactFlash - dt * 3)
    }

    /* ---- screen position -------------------------------- */
    this.projected.setFromMatrixPosition(this.chassis.matrixWorld)
    this.projected.project(this.camera)
    this.screenPosition.set(this.projected.x * 0.5 + 0.5, this.projected.y * -0.5 + 0.5)
  }

  private boostRaw = 0

  /** Written by DayCycle. 0 = noon, 1 = fully dark. */
  nightFactor = 0

  /**
   * Swappable body shells. The brief asks for unlockable ones; this
   * is the mechanism, and the Konami code is its first user. The
   * body meshes are re-materialled rather than rebuilt, so a swap
   * costs nothing and cannot leak geometry.
   */
  private shellMeshes: THREE.Mesh[] = []
  private defaultShellMaterial: THREE.Material | null = null

  setShell(shell: 'default' | 'konami' | 'graphite'): void {
    if (!this.defaultShellMaterial) return
    const material =
      shell === 'konami'
        ? this.materials.tinted(palette.accent, 0.38, 0.24)
        : shell === 'graphite'
          ? this.materials.tinted(palette.ink2, 0.5, 0.2)
          : this.defaultShellMaterial
    for (const mesh of this.shellMeshes) mesh.material = material
  }

  /** Set by the Game once the View exists. */
  camera: THREE.Camera = new THREE.PerspectiveCamera()

  /** How hard the last impact was, decaying. Used by camera shake. */
  get impact(): number {
    return this.impactFlash
  }

  get boostAmount(): number {
    return this.boostMix
  }
}
