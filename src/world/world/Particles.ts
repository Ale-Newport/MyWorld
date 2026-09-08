import * as THREE from 'three'
import { palette } from '../core/palette'
import { clamp, seeded } from '../core/maths'
import type { Bin } from '../core/Disposal'
import type { Ticker } from '../core/Ticker'
import type { Quality } from '../core/Quality'
import type { PhysicsVehicle } from '../physics/PhysicsVehicle'
import type { Player } from '../player/Player'

/* ============================================================
   PARTICLES

   One pooled system for everything that puffs: wheel dust, impact
   debris, landing scuffs and the boost trail. Adapted in shape
   from upstream's Confetti and Trails (folio-2025, MIT —
   Copyright (c) 2025 Bruno Simon); the behaviour is ours.

   ONE pool, ONE draw call, ONE material. A separate emitter per
   effect is how a physics playground ends up with fifteen
   transparent draws and a frame-rate cliff on a phone. Particles
   are recycled from a ring: the oldest is reused when the pool is
   full, which means the effects degrade by getting shorter rather
   than by failing to appear.

   Everything is simulated on the CPU and uploaded as one instance
   matrix buffer. At the few hundred particles this needs, that is
   cheaper than the bookkeeping a GPU simulation would require,
   and it means an impact can read the physics contact point
   directly.
   ============================================================ */

type ParticleKind = 'dust' | 'debris' | 'boost' | 'spark'

interface Particle {
  kind: ParticleKind
  life: number
  maxLife: number
  size: number
  position: THREE.Vector3
  velocity: THREE.Vector3
  spin: number
  spinSpeed: number
}

const KINDS: Record<ParticleKind, { colour: string; drag: number; gravity: number }> = {
  // Kicked-up ground: slow, floats, fades.
  dust: { colour: palette.paper4, drag: 2.4, gravity: -1.2 },
  // Knocked-off material: heavier, falls properly.
  debris: { colour: palette.ink3, drag: 0.6, gravity: -11 },
  // The boost plume: rises, no gravity to speak of.
  boost: { colour: palette.accentSoft, drag: 3.2, gravity: 1.4 },
  // Hard contact: quick, bright, gone.
  spark: { colour: palette.accent, drag: 1.2, gravity: -6 },
}

export class Particles {
  readonly group = new THREE.Group()

  private pool: Particle[] = []
  private cursor = 0
  private mesh!: THREE.InstancedMesh
  private colours!: THREE.InstancedBufferAttribute

  private readonly matrix = new THREE.Matrix4()
  private readonly quaternion = new THREE.Quaternion()
  private readonly scale = new THREE.Vector3()
  private readonly colour = new THREE.Color()
  private readonly rand = seeded(770231)

  private dustTimer = 0
  private boostTimer = 0

  constructor(
    private vehicle: PhysicsVehicle,
    private player: Player,
    private ticker: Ticker,
    quality: Quality,
    bin: Bin,
  ) {
    const capacity = quality.count(320, 90)

    for (let i = 0; i < capacity; i++) {
      this.pool.push({
        kind: 'dust',
        life: 0,
        maxLife: 1,
        size: 0,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        spin: 0,
        spinSpeed: 0,
      })
    }

    // A quad rather than a sphere: at this camera distance a
    // particle is four pixels, and nobody has ever seen its normals.
    const geometry = new THREE.PlaneGeometry(1, 1)

    // three applies `instanceColor` to `vColor`, but only MULTIPLIES
    // it into the fragment when USE_COLOR is defined — which comes
    // from `vertexColors: true`, which in turn makes the shader read
    // a per-vertex `color` attribute. Without one, WebGL supplies
    // (0,0,0) and every particle renders black. So the geometry
    // carries a white vertex colour whose only job is to be a
    // multiplicative identity.
    geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(new Float32Array(12).fill(1), 3),
    )
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      vertexColors: true,
    })

    this.mesh = new THREE.InstancedMesh(geometry, material, capacity)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 6
    this.mesh.count = capacity

    const colours = new Float32Array(capacity * 3)
    this.colours = new THREE.InstancedBufferAttribute(colours, 3)
    this.colours.setUsage(THREE.DynamicDrawUsage)
    this.mesh.instanceColor = this.colours

    // Everything starts collapsed rather than hidden: an unused
    // instance with a zero matrix draws nothing.
    for (let i = 0; i < capacity; i++) {
      this.matrix.makeScale(0, 0, 0)
      this.mesh.setMatrixAt(i, this.matrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true

    this.group.add(this.mesh)

    bin.add(() => {
      geometry.dispose()
      material.dispose()
    })
    bin.object3D(this.group)

    const update = () => this.update()
    this.ticker.events.on('tick', update, 11)
    bin.add(() => this.ticker.events.off('tick', update))

    const onCollision = (force: number, at: { x: number; y: number; z: number }) => {
      if (force < 14) return
      const count = Math.round(clamp(force / 18, 1, 8))
      for (let i = 0; i < count; i++) {
        this.emit('debris', at, 2.2 + force * 0.02, 0.22)
      }
      if (force > 40) {
        for (let i = 0; i < 3; i++) this.emit('spark', at, 3.5, 0.13)
      }
    }
    this.vehicle.events.on('collision', onCollision as never)

    const onLand = (airtime: number) => {
      if (airtime < 0.22) return
      const strength = clamp(airtime, 0.2, 1.2)
      for (const wheel of this.vehicle.wheels.items) {
        if (!wheel.contactPoint) continue
        for (let i = 0; i < Math.round(2 + strength * 4); i++) {
          this.emit('dust', wheel.contactPoint, 1.4 + strength * 2.4, 0.42)
        }
      }
    }
    this.vehicle.events.on('land', onLand as never)

    bin.add(() => {
      this.vehicle.events.off('collision', onCollision as never)
      this.vehicle.events.off('land', onLand as never)
    })
  }

  /** Takes the next particle from the ring, whether or not it is free. */
  private emit(
    kind: ParticleKind,
    at: { x: number; y: number; z: number },
    speed: number,
    size: number,
  ): void {
    const particle = this.pool[this.cursor]
    this.cursor = (this.cursor + 1) % this.pool.length

    particle.kind = kind
    particle.maxLife = kind === 'boost' ? 0.5 : kind === 'spark' ? 0.35 : 0.9
    particle.life = particle.maxLife
    particle.size = size * (0.7 + this.rand() * 0.7)
    particle.position.set(at.x, at.y + 0.1, at.z)
    particle.spin = this.rand() * Math.PI
    particle.spinSpeed = (this.rand() - 0.5) * 6

    // Hemisphere, biased upward: nothing should be launched into
    // the ground it just came from.
    const angle = this.rand() * Math.PI * 2
    const lift = 0.3 + this.rand() * 0.8
    particle.velocity.set(
      Math.cos(angle) * (1 - lift * 0.5),
      lift,
      Math.sin(angle) * (1 - lift * 0.5),
    ).multiplyScalar(speed * (0.6 + this.rand() * 0.8))

    // Inherit some of the car's motion, or dust hangs behind it in
    // a way that reads as a bug.
    particle.velocity.addScaledVector(this.vehicle.velocity, 12)
  }

  private update(): void {
    const dt = Math.min(0.05, this.ticker.delta)
    const scaled = dt * this.ticker.scale

    /* ---- continuous emitters --------------------------- */

    // Wheel dust, while moving and in contact.
    const speed = this.vehicle.xzSpeed
    const contact = this.vehicle.wheels.inContactCount
    if (speed > 5 && contact > 0) {
      this.dustTimer -= dt
      if (this.dustTimer <= 0) {
        this.dustTimer = 0.05
        // The rear wheels do the work; the fronts are just rolling.
        for (const index of [2, 3]) {
          const wheel = this.vehicle.wheels.items[index]
          if (wheel.inContact && wheel.contactPoint) {
            this.emit('dust', wheel.contactPoint, clamp(speed * 0.06, 0.4, 2.2), 0.3)
          }
        }
      }
    }

    // Boost plume from the two rear emitters.
    if (this.player.boosting > 0.5 && this.player.accelerating > 0 && speed > 4) {
      this.boostTimer -= dt
      if (this.boostTimer <= 0) {
        this.boostTimer = 0.026
        for (const emitter of this.boostEmitters) {
          this.emit('boost', emitter, 1.1, 0.34)
        }
      }
    }

    /* ---- integrate ------------------------------------- */

    let alive = 0
    for (let i = 0; i < this.pool.length; i++) {
      const particle = this.pool[i]

      if (particle.life <= 0) {
        this.matrix.makeScale(0, 0, 0)
        this.mesh.setMatrixAt(i, this.matrix)
        continue
      }

      alive++
      particle.life -= dt
      const spec = KINDS[particle.kind]

      particle.velocity.y += spec.gravity * scaled
      particle.velocity.multiplyScalar(Math.max(0, 1 - spec.drag * scaled))
      particle.position.addScaledVector(particle.velocity, scaled)
      particle.spin += particle.spinSpeed * scaled

      const t = clamp(particle.life / particle.maxLife, 0, 1)
      // Grow as it fades: a puff spreads, it does not shrink.
      const size = particle.size * (particle.kind === 'debris' ? t : 1.9 - t)

      // Billboard to the camera by leaning the quad back — cheaper
      // than a full lookAt, and at this angle indistinguishable.
      this.quaternion.setFromEuler(
        this.eulerScratch.set(-Math.PI * 0.34, particle.spin, 0),
      )
      this.scale.set(size, size, size)
      this.matrix.compose(particle.position, this.quaternion, this.scale)
      this.mesh.setMatrixAt(i, this.matrix)

      this.colour.set(spec.colour).multiplyScalar(0.4 + t * 0.6)
      this.colours.setXYZ(i, this.colour.r, this.colour.g, this.colour.b)
    }

    this.mesh.instanceMatrix.needsUpdate = true
    this.colours.needsUpdate = true
    this.mesh.visible = alive > 0
  }

  private readonly eulerScratch = new THREE.Euler()

  /** World-space boost emitters. Written by VisualVehicle each frame. */
  boostEmitters: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3()]

  /** Throws a burst at a point. Used by mini-games and achievements. */
  burst(at: THREE.Vector3, count = 12, kind: ParticleKind = 'spark'): void {
    for (let i = 0; i < count; i++) this.emit(kind, at, 4, 0.3)
  }
}
