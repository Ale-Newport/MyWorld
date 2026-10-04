import * as THREE from 'three'
import type { Bin } from '@/world/core/Disposal'
import type { Physical } from '@/world/physics/Physics'
import type { World2Game } from '../World2Game'
import type { References } from './references'
import type { PromptHandle } from './Prompts'

/* ============================================================
   PORTED FROM: sources/Game/World/Areas/BowlingArea.js
   folio-2025 — Copyright (c) 2025 Bruno Simon — MIT
   See THIRD_PARTY_NOTICES.md.

   Ten pins at the authored `pin0`..`pin9` transforms, each a
   dynamic body carrying the two cylinders stripped off the
   `refPinPhysicalDynamic` template, all drawn through one
   instanced mesh. The ball is an ordinary dynamic sphere: the car
   hits it, it rolls, nothing about its path is scripted.

   A pin is DOWN when its own up-axis, rotated by the body, has a
   world Y below 0.5 — sixty degrees of tilt — and the state is
   latched until the frame is reset, which is what stops a pin
   wobbling on its base from flickering the board.

   The board is the authored one: `refDiscs` and `refCrosses`
   carry ten symbols each whose UVs address one texel of a 10x1
   texture, and the inactive symbol is pushed 0.1 back along local
   Z so the screen casing swallows it. That is upstream's trick,
   reproduced here in GLSL rather than TSL.
   ============================================================ */

export type BowlingState = 'ready' | 'rolling' | 'result' | 'resetting'

interface Pin {
  index: number
  physical: Physical
  home: { position: THREE.Vector3; quaternion: THREE.Quaternion }
  down: boolean
  wasSleeping: boolean
}

const PIN_MASS = 0.02
const BALL_MASS = 0.38
/** cos(60°): a pin leaning further than this has fallen. */
const DOWN_DOT = 0.5

const SYMBOL_VERTEX = `
uniform sampler2D states;
uniform float threshold;
varying float vActive;
void main() {
  float sampled = texture2D(states, vec2(uv.x, 0.5)).r;
  vActive = step(abs(sampled - threshold), 0.1);
  vec3 shifted = position;
  shifted.z -= (1.0 - vActive) * 0.1;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(shifted, 1.0);
}
`
const SYMBOL_FRAGMENT = `
uniform vec3 color;
uniform float strength;
varying float vActive;
void main() { gl_FragColor = vec4(color * strength, 1.0); }
`

export class Bowling {
  state: BowlingState = 'ready'
  readonly pins: Pin[] = []
  readonly group = new THREE.Group()
  private ball: Physical | null = null
  private ballNode: THREE.Object3D | null = null
  private ballHome = new THREE.Vector3()
  private instanced: THREE.InstancedMesh | null = null
  private readonly states = new Uint8Array(10)
  private readonly statesTexture: THREE.DataTexture
  private readonly symbolMaterials: THREE.ShaderMaterial[] = []
  private strike = false
  private strikeAt = 0
  private strikeLabel: THREE.Object3D | null = null
  private screen: { physical: Physical; node: THREE.Object3D; min: number; max: number; x: number; z: number } | null = null
  private bumpers: { physical: Physical; node: THREE.Object3D; home: THREE.Vector3; height: number; out: boolean; progress: number } | null = null
  private restart: PromptHandle | null = null
  private restartArmed = false
  private pinsDownTotal = 0
  private readonly matrix = new THREE.Matrix4()
  private readonly up = new THREE.Vector3()
  private readonly pinScale = new THREE.Vector3(1, 1, 1)
  private readonly scratch = new THREE.Vector3()
  private readonly scratchQuaternion = new THREE.Quaternion()
  private readonly centre = new THREE.Vector3()
  private reach = 0

  constructor(private game: World2Game, private references: References, bin: Bin) {
    this.group.name = 'World2 / bowling'
    this.statesTexture = new THREE.DataTexture(this.states, 10, 1, THREE.RedFormat, THREE.UnsignedByteType)
    this.statesTexture.minFilter = this.statesTexture.magFilter = THREE.NearestFilter
    this.statesTexture.needsUpdate = true

    this.buildPins()
    this.buildBall()
    this.buildScreen()
    this.buildBumpers()
    if (this.pins.length) {
      for (const pin of this.pins) this.centre.add(pin.home.position)
      this.centre.divideScalar(this.pins.length)
      this.reach = this.centre.distanceTo(this.ballHome) + 30
    }

    const tick = () => this.update()
    game.ticker.events.on('tick', tick, 11)
    bin.add(() => {
      game.ticker.events.off('tick', tick)
      this.statesTexture.dispose()
      this.instanced?.dispose()
      for (const material of this.symbolMaterials) material.dispose()
    })
    bin.object3D(this.group)
  }

  private buildPins(): void {
    const template = this.references.node('refPinPhysicalDynamic')
    // pin0..pin9, authored without a dot suffix, so `series` does not see them.
    const positions = Array.from({ length: 10 }, (_, i) => this.references.node(`pin${i}`)).filter((n): n is THREE.Object3D => !!n)
    if (!template || positions.length !== 10) return
    const built = this.references.environment.collidersFor(template)
    if (!built.colliders.length) return

    // One draw call for ten pins, as upstream. The template's own geometry is
    // reused; its body was reserved so the level never placed it.
    const source = template instanceof THREE.Mesh ? template : template.children.find(child => child instanceof THREE.Mesh) as THREE.Mesh | undefined
    if (source) {
      // The template's geometry is already in its own local space, and the
      // colliders above were harvested in that same space, so one instance
      // matrix per pin body places both consistently.
      template.updateWorldMatrix(true, false)
      template.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), this.pinScale)
      const instanced = new THREE.InstancedMesh(source.geometry, source.material, 10)
      instanced.castShadow = true
      instanced.receiveShadow = true
      this.instanced = instanced
      this.group.add(instanced)
      this.references.environment.suppress(template)
    }

    positions.forEach((node, index) => {
      node.updateWorldMatrix(true, false)
      const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3()
      node.matrixWorld.decompose(position, quaternion, scale)
      const physical = this.game.physics.add({
        type: 'dynamic', position, rotation: quaternion,
        colliders: built.colliders, category: 'object',
        mass: PIN_MASS, friction: 0.5, restitution: 0.15,
        linearDamping: 0.1, angularDamping: 0.5,
        sleeping: true, contactThreshold: 5,
        owner: `pin${index}`,
        onCollision: force => { if (force > 3) this.game.audio.impact(Math.min(force, 20)) },
      })
      this.pins.push({ index, physical, home: { position: position.clone(), quaternion: quaternion.clone() }, down: false, wasSleeping: true })
    })
    this.syncInstances()
  }

  private buildBall(): void {
    const node = this.references.node('refBallPhysicalDynamic')
    if (!node) return
    const built = this.references.environment.collidersFor(node)
    if (!built.colliders.length) return
    this.ballNode = node
    this.ballHome.copy(built.position)
    this.ball = this.game.physics.add({
      type: 'dynamic', position: built.position, rotation: built.quaternion,
      colliders: built.colliders, category: 'object',
      mass: BALL_MASS, friction: 0.35, restitution: 0.2,
      linearDamping: 0.1, angularDamping: 0.2, sleeping: true,
      owner: 'bowlingBall',
    })
    this.references.environment.group.attach(node)
  }

  private buildScreen(): void {
    const node = this.references.node('refScreenPhysicalKinematicPositionBased')
    if (node) {
      const built = this.references.environment.collidersFor(node)
      const physical = this.game.physics.add({
        type: 'kinematicPositionBased', position: built.position, rotation: built.quaternion,
        colliders: built.colliders.length ? built.colliders : [{ shape: 'cuboid', parameters: [0.1, 0.1, 0.1] }],
        category: 'floor', owner: 'bowlingScreen',
      })
      this.references.environment.group.attach(node)
      const head = this.pins[0]?.home.position.x ?? built.position.x - 22
      this.screen = { physical, node, min: head - 0.3, max: built.position.x, x: built.position.x, z: built.position.z }
    }

    // Discs mark a pin still standing; crosses mark one that has gone down.
    const paint = (name: string, threshold: number, color: string, strength: number) => {
      const holder = this.references.node(name)
      if (!holder) return
      holder.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return
        const material = new THREE.ShaderMaterial({
          uniforms: {
            states: { value: this.statesTexture },
            threshold: { value: threshold },
            color: { value: new THREE.Color(color) },
            strength: { value: strength },
          },
          vertexShader: SYMBOL_VERTEX, fragmentShader: SYMBOL_FRAGMENT,
        })
        child.material = material
        this.symbolMaterials.push(material)
      })
    }
    paint('refDiscs', 0, '#ffffff', 1.6)
    paint('refCrosses', 128 / 255, '#ff2b11', 2.4)

    this.strikeLabel = this.references.node('refLabelStrike')
    if (this.strikeLabel) this.strikeLabel.visible = false
  }

  private buildBumpers(): void {
    const node = this.references.node('refBumpersPhysicalKinematicPositionBased')
    if (!node) return
    const built = this.references.environment.collidersFor(node)
    if (!built.colliders.length) return
    const physical = this.game.physics.add({
      type: 'kinematicPositionBased', position: built.position, rotation: built.quaternion,
      colliders: built.colliders, category: 'floor', friction: 0, restitution: 1,
      owner: 'bowlingBumpers',
    })
    this.references.environment.group.attach(node)
    this.bumpers = { physical, node, home: built.position.clone(), height: Math.abs(built.position.y), out: false, progress: 0 }
  }

  /** The two prompts this area owns, created once the manager exists. */
  attachPrompts(restart: PromptHandle, bumpers: PromptHandle | null): void {
    this.restart = restart
    restart.hide()
    void bumpers
  }

  toggleBumpers(): void {
    if (!this.bumpers) return
    this.bumpers.out = !this.bumpers.out
    this.game.audio.play('interact')
  }

  get bumpersOut(): boolean { return this.bumpers?.out ?? false }

  private syncInstances(): void {
    if (!this.instanced) return
    for (const pin of this.pins) {
      this.matrix.compose(pin.physical.current.position, pin.physical.current.quaternion, this.pinScale)
      this.instanced.setMatrixAt(pin.index, this.matrix)
    }
    this.instanced.instanceMatrix.needsUpdate = true
    this.instanced.computeBoundingSphere()
  }

  get pinsDown(): number { return this.pins.filter(pin => pin.down).length }

  reset(): void {
    this.state = 'resetting'
    this.strike = false
    for (const pin of this.pins) {
      pin.down = false
      pin.wasSleeping = true
      this.states[pin.index] = 0
      this.game.physics.reset(pin.physical)
      pin.physical.body.setTranslation(pin.home.position, true)
      pin.physical.body.setRotation(pin.home.quaternion, true)
      pin.physical.body.sleep()
    }
    this.statesTexture.needsUpdate = true
    if (this.ball) {
      this.game.physics.reset(this.ball)
      this.ball.body.setTranslation(this.ballHome, true)
      this.ball.body.sleep()
    }
    if (this.strikeLabel) this.strikeLabel.visible = false
    this.syncInstances()
    this.restartArmed = false
    this.restart?.hide()
    this.game.audio.play('interact')
    this.game.tweens.delay(0.4, () => { this.state = 'ready' })
    this.game.publishGameplay()
  }

  private update(): void {
    const delta = this.game.ticker.delta * this.game.ticker.scale
    const alpha = this.game.ticker.alpha

    let changed = false
    let awake = false
    for (const pin of this.pins) {
      const sleeping = pin.physical.body.isSleeping()
      if (!sleeping) awake = true
      if (sleeping !== pin.wasSleeping) { pin.wasSleeping = sleeping; if (!sleeping) this.restartArmed = true }
      if (pin.down || sleeping) continue
      this.up.set(0, 1, 0).applyQuaternion(pin.physical.current.quaternion)
      if (this.up.y < DOWN_DOT) {
        pin.down = true
        this.states[pin.index] = 128
        changed = true
        this.pinsDownTotal++
        this.game.interactions?.achievements.set('pins', this.pinsDownTotal)
      }
    }

    if (this.ball && !this.ball.body.isSleeping()) { awake = true; this.restartArmed = true }

    if (changed) {
      this.statesTexture.needsUpdate = true
      if (!this.strike && this.pins.every(pin => pin.down)) {
        this.strike = true
        this.strikeAt = this.game.ticker.elapsed
        this.game.audio.play('achievement')
        this.game.interactions?.achievements.unlock('strike')
      }
      this.game.publishGameplay()
    }

    if (this.state === 'ready' && awake) { this.state = 'rolling'; this.game.publishGameplay() }
    else if (this.state === 'rolling' && !awake) { this.state = 'result'; this.game.publishGameplay() }
    if (this.restartArmed) this.restart?.show()

    if (awake || this.state === 'resetting') {
      for (const pin of this.pins) {
        this.matrix.compose(
          this.scratch.lerpVectors(pin.physical.previous.position, pin.physical.current.position, alpha),
          this.scratchQuaternion.slerpQuaternions(pin.physical.previous.quaternion, pin.physical.current.quaternion, alpha),
          this.pinScale)
        this.instanced?.setMatrixAt(pin.index, this.matrix)
      }
      if (this.instanced) { this.instanced.instanceMatrix.needsUpdate = true; this.instanced.computeBoundingSphere() }
    }

    if (this.ball && this.ballNode) {
      this.ballNode.position.lerpVectors(this.ball.previous.position, this.ball.current.position, alpha)
      this.ballNode.quaternion.slerpQuaternions(this.ball.previous.quaternion, this.ball.current.quaternion, alpha)
    }

    if (this.strikeLabel) this.strikeLabel.visible = this.strike && (this.game.ticker.elapsed - this.strikeAt) % 1.5 < 0.75

    const far = this.reach > 0 && Math.hypot(this.game.player.position.x - this.centre.x, this.game.player.position.z - this.centre.z) > this.reach
    // The board drifts along the lane with the player and bobs, as upstream.
    if (this.screen && !far) {
      const target = Math.max(this.screen.min, Math.min(this.game.player.position.x, this.screen.max))
      this.screen.x += (target - this.screen.x) * Math.min(1, delta * 2)
      const y = this.screen.physical.initialState.position.y + Math.sin(this.game.ticker.elapsed * 0.6) * 0.5
      const next = { x: this.screen.x, y, z: this.screen.z }
      this.screen.physical.body.setNextKinematicTranslation(next)
      this.screen.node.position.set(next.x, next.y, next.z)
    }

    if (this.bumpers && !far) {
      const target = this.bumpers.out ? 1 : 0
      if (Math.abs(this.bumpers.progress - target) > 0.001) {
        this.bumpers.progress += (target - this.bumpers.progress) * Math.min(1, delta * 2)
        const next = { x: this.bumpers.home.x, y: this.bumpers.home.y + this.bumpers.progress * this.bumpers.height, z: this.bumpers.home.z }
        this.bumpers.physical.body.setNextKinematicTranslation(next)
        this.bumpers.node.position.set(next.x, next.y, next.z)
      }
    }
  }

  /** What the HUD carries for bowling — the board itself says the rest. */
  hud(): { headline: string | null; lines: string[] } {
    if (this.state === 'ready' && !this.pinsDown) return { headline: null, lines: [] }
    const down = this.pinsDown
    return {
      headline: this.strike ? 'STRIKE!' : null,
      lines: [`Pins down ${down} / 10`, this.bumpersOut ? 'Bumpers up' : 'Bumpers down'],
    }
  }
}
