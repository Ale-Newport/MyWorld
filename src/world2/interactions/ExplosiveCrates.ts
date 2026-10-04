import * as THREE from 'three'
import type { Bin } from '@/world/core/Disposal'
import type { Ticker } from '@/world/core/Ticker'
import type { Physics, Physical } from '@/world/physics/Physics'
import type { Tweens } from '@/world/core/Tween'
import type { Explosions } from './Explosions'
import type { References } from './references'

/* ============================================================
   PORTED FROM: sources/Game/World/ExplosiveCrates.js
   folio-2025 — Copyright (c) 2025 Bruno Simon — MIT
   See THIRD_PARTY_NOTICES.md.

   Upstream's crate is a 0.5-half-extent cuboid weighing 0.02 kg
   that starts asleep and explodes on ANY contact after a 0.4 s
   fuse. The chain reaction is not scripted: the blast impulse
   shoves its neighbours, the neighbours register a contact, and
   their own fuses light. That is the whole mechanic and it is
   kept intact here.

   One deliberate difference. Upstream sets `contactThreshold: 0`,
   so brushing a crate at walking pace detonates it. A non-zero
   threshold is used instead — high enough that a crate resting on
   the ground never triggers itself, low enough that any bump a
   player would call "driving into it" does.
   ============================================================ */

/** Newtons of contact force needed to light a fuse. Resting weight is ~0.2 N. */
const TRIGGER_FORCE = 2
/** Upstream's fuse, in seconds. The pause is what makes chains read. */
const FUSE = 0.4
const MASS = 0.02
const HALF_EXTENT = 0.5
const FIRE_RADIUS = 5
const BLAST_STRENGTH = 8

interface Crate {
  node: THREE.Object3D
  physical: Physical
  home: { position: THREE.Vector3; quaternion: THREE.Quaternion }
  exploded: boolean
  index: number
}

export class ExplosiveCrates {
  readonly items: Crate[] = []
  /** Crates detonated since the last reset — drives the TNT achievements. */
  private chain = 0
  private chainTimer = 0

  constructor(
    private references: References,
    private physics: Physics,
    private ticker: Ticker,
    private tweens: Tweens,
    private explosions: Explosions,
    bin: Bin,
    private hooks: {
      onFuse: (at: THREE.Vector3) => void
      onExplode: (at: THREE.Vector3) => void
      /** Called with the size of a chain once it settles. */
      onChain: (count: number, total: number) => void
    },
  ) {
    const nodes = references.collection('explosiveCrates').filter(node => node instanceof THREE.Mesh)
    let index = 0
    for (const node of nodes) {
      node.updateWorldMatrix(true, false)
      const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3()
      node.matrixWorld.decompose(position, quaternion, scale)
      const crate: Crate = {
        node, index: index++, exploded: false,
        home: { position: position.clone(), quaternion: quaternion.clone() },
        physical: null as unknown as Physical,
      }
      crate.physical = physics.add({
        type: 'dynamic', position, rotation: quaternion,
        colliders: [{ shape: 'cuboid', parameters: [HALF_EXTENT, HALF_EXTENT, HALF_EXTENT], category: 'object' }],
        mass: MASS, friction: 0.7, sleeping: true, contactThreshold: TRIGGER_FORCE,
        owner: node.userData.w2Source ?? node.name,
        onCollision: () => this.light(crate),
      })
      // Detach so the body drives the mesh directly; the level group is identity.
      references.environment.group.attach(node)
      this.items.push(crate)
    }

    const tick = () => this.update()
    ticker.events.on('tick', tick, 8)
    bin.add(() => ticker.events.off('tick', tick))
  }

  private light(crate: Crate): void {
    if (crate.exploded) return
    crate.exploded = true
    const at = crate.physical.body.translation()
    this.hooks.onFuse(new THREE.Vector3(at.x, at.y, at.z))
    this.tweens.delay(FUSE, () => this.detonate(crate))
  }

  private detonate(crate: Crate): void {
    const translation = crate.physical.body.translation()
    const at = new THREE.Vector3(translation.x, translation.y, translation.z)
    this.hooks.onExplode(at)
    crate.physical.body.setEnabled(false)
    crate.node.visible = false
    this.explosions.explode(at, FIRE_RADIUS, BLAST_STRENGTH)
    this.chain++
    // A chain is "still going" while fuses keep lighting within a second.
    this.chainTimer = 1.2
  }

  private update(): void {
    const alpha = this.ticker.alpha
    for (const crate of this.items) {
      if (crate.exploded || crate.physical.body.isSleeping()) continue
      crate.node.position.lerpVectors(crate.physical.previous.position, crate.physical.current.position, alpha)
      crate.node.quaternion.slerpQuaternions(crate.physical.previous.quaternion, crate.physical.current.quaternion, alpha)
    }
    if (this.chainTimer > 0) {
      this.chainTimer -= this.ticker.delta * this.ticker.scale
      if (this.chainTimer <= 0) {
        this.hooks.onChain(this.chain, this.items.filter(c => c.exploded).length)
        this.chain = 0
      }
    }
  }

  get remaining(): number {
    return this.items.filter(crate => !crate.exploded).length
  }

  /**
   * Upstream's reset, including its subtlety: every OTHER dynamic body in
   * the world is disabled for a second, because a crate re-appearing inside
   * a barrel would otherwise register a contact and immediately blow up.
   */
  reset(): void {
    this.chain = 0
    this.chainTimer = 0
    for (const crate of this.items) {
      crate.exploded = false
      crate.node.visible = true
      crate.node.position.copy(crate.home.position)
      crate.node.quaternion.copy(crate.home.quaternion)
      this.physics.reset(crate.physical)
      crate.physical.body.setEnabled(false)
    }
    const suspended: Physical[] = []
    for (const physical of this.physics.physicals) {
      if (physical.type !== 'dynamic' || !physical.body.isEnabled()) continue
      if (this.items.some(crate => crate.physical === physical)) continue
      physical.body.setEnabled(false)
      suspended.push(physical)
    }
    this.tweens.delay(1, () => {
      for (const physical of suspended) {
        physical.body.setEnabled(true)
        if (physical.initialState.sleeping) physical.body.sleep()
      }
    })
    this.tweens.delay(2, () => {
      for (const crate of this.items) {
        crate.physical.body.setEnabled(true)
        crate.physical.body.sleep()
      }
    })
  }
}
