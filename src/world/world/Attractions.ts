import * as THREE from 'three'
import type { Game } from '../Game'
import type { Bin } from '../core/Disposal'
import type { ColliderDescription, Physical } from '../physics/Physics'
import type { Actor } from './Playground'
import { chamferedBox, strutGeometry, wheelGeometry } from './geometry'
import { signLabel } from './materials'
import {
  PARTS, attractionSpot, validateAttractions,
  type AttractionId, type AttractionSpot,
} from '@/content/attractions'

/* ============================================================
   THE ATTRACTIONS

   Fourteen things to do that have nothing to do with the CV: a
   klaxon, a catapult, a piñata, a piano road, a speed trap, a car
   wash, a football pitch, a skittle yard, a firework battery, a
   harbour bell, three trampolines, a bumper field, a weather lever
   and a turntable.

   A SIBLING OF `Playground`, not an extension of it: one group, one
   actor list, one `update()` on the ticker at order 12, one
   `reset()` off the Options overlay's RESET OBJECTS. Playground owns
   the name, the TNT, the time machine and the black hole and is
   already four hundred lines; the second thing to do does not belong
   inside the first.

   FOUR RULES THIS FILE OBEYS, every one of them paid for elsewhere.

   1. POSITIONS COME FROM `content/attractions.ts`. Not one world
      coordinate is typed here. The island was redrawn once and
      rescaled to 70% a second time, and both times every literal
      coordinate moved out from under the thing standing on it.

   2. ONLY THE NEAREST PROMPT IS EVER REACHABLE. Six of the fourteen
      carry one; the other eight are driven into, driven over or
      driven through — better play, and the only way to add this many
      toys without killing a prompt that already exists. The content
      layer spaces the six and says so at dev boot.

   3. SPRUNG THINGS ARE A DISTANCE TEST, NOT A SENSOR. A Rapier
      sensor fires on the frame the colliders overlap; at a 30 Hz
      fixed step and 15 m/s that is a half-metre window a fast car
      goes straight through. Every trampoline and bumper here is a
      solid collider plus one impulse per contact from `update()`,
      with a cooldown.

   4. KNOCKABLE, NOT LETHAL. The car chassis is 2.5 kg and anything
      much over 6 reads as a wall, so the skittles are 1.6 and the
      football 1.1. Every launch is authored as the SPEED the car
      leaves with rather than as an impulse, because a speed is a
      number you can picture against a landing you have to survive.
   ============================================================ */

/** A pad or a bumper: fixed geometry with a spring bolted on in code. */
interface Springy {
  at: THREE.Vector3
  radius: number
  mesh: THREE.Object3D
  /** Rest height of `mesh`, so a hit can push it down and let it up. */
  baseY: number
  /** `ticker.elapsed` before which it will not fire again. */
  ready: number
  /** 0..1, decays each frame. Drives the squash. */
  flex: number
}

export class Attractions {
  readonly group = new THREE.Group()
  private readonly actors: Actor[] = []

  private catapultArm!: THREE.Object3D
  private catapultAim = new THREE.Vector3()
  private catapultFired = -100

  private pinata!: THREE.Object3D
  private pinataAt = new THREE.Vector3()
  private pinataBurst = false
  private sweets: Actor[] = []

  private keys: { mesh: THREE.Mesh; baseY: number; lit: number }[] = []
  private played = new Set<number>()
  private phraseAt = 0
  private lastNote = -100

  private trapSpot!: AttractionSpot
  private trapBoard: THREE.Mesh | null = null
  private trapFlash!: THREE.Mesh
  private trapBest = 0

  private brushes: THREE.Object3D[] = []
  private washUntil = -100
  private washDark = false
  private splashAt = 0

  private ball!: Actor
  private ballHome = new THREE.Vector3()
  private goalAt = new THREE.Vector3()
  private goalAlong = new THREE.Vector3()
  private goalAcross = new THREE.Vector3()
  private goalUntil = 0
  private goals = 0

  private pins: (Actor & { down: boolean })[] = []
  private felled = new Set<number>()

  private mortars: THREE.Object3D[] = []
  private volleyUntil = -100
  private nextShell = 0
  private shellsLeft = 0

  private bell!: THREE.Object3D
  private bellSwing = 0
  private bellReady = 0
  private rings: number[] = []

  private klaxonReady = 0
  private pads: Springy[] = []
  private bumpers: Springy[] = []
  private chain = 0
  private chainAt = -100
  private hits = 0

  private lever!: THREE.Object3D
  private leverAngle = 0
  private rainUntil = 0

  private turntable: Physical | null = null
  private turntablePivot!: THREE.Object3D
  private turntableAt = new THREE.Vector3()
  private turned = 0
  private spin = 0
  private lastSpin = 0

  constructor(private game: Game, bin: Bin) {
    /* The placement is data, and data that cannot be placed is the
       one failure mode this whole design has. Said once, at boot,
       with the metres — never swallowed. */
    if (process.env.NODE_ENV === 'development') {
      const problems = validateAttractions()
      if (problems.length > 0) console.warn('[world] attractions:\n  ' + problems.join('\n  '))
    }

    this.buildKlaxon()
    this.buildCatapult()
    this.buildPinata()
    this.buildPiano()
    this.buildSpeedTrap()
    this.buildCarWash()
    this.buildFootball()
    this.buildSkittles()
    this.buildFireworks()
    this.buildBell()
    this.buildTrampolines()
    this.buildBumpers()
    this.buildWeatherLever()
    this.buildTurntable()

    game.renderer.scene.add(this.group)
    bin.object3D(this.group)

    const tick = () => this.update()
    game.ticker.events.on('tick', tick, 12)
    /* Order 2 on the FIXED clock, which is before `Physics.step` at 3.
       A kinematic body's surface velocity is inferred from the gap
       between its current transform and its next one, so a turntable
       spun on the render tick carries the car at whatever the frame
       rate happens to be — and stops carrying it at all on a frame
       the fixed step ran twice. */
    const fixed = () => this.turn()
    game.ticker.events.on('fixed', fixed, 2)
    bin.add(() => {
      game.ticker.events.off('tick', tick)
      game.ticker.events.off('fixed', fixed)
    })
  }

  /* ========================================================
     SHARED BUILDERS

     Fourteen attractions out of six shapes: a post, a chamfered
     solid, a dynamic body, an open shell, a sign and a prompt.
     ======================================================== */

  private spot(id: AttractionId): AttractionSpot { return attractionSpot(id) }
  private ground(x: number, z: number): number { return this.game.terrain.colliderHeightAt(x, z) }
  /** Mesh yaw for a heading. `rotation.y` turns +X towards −Z. */
  private yaw(heading: number): number { return -heading }
  private get shadows(): boolean { return this.game.quality.settings.shadows }

  /**
   * A point in an attraction's own frame, in world space, on the
   * ground plus `y`.
   *
   * `along` runs down the thing's heading and `across` to its right.
   * Every builder below lays itself out in those two numbers, so a
   * placement that resolves to a different bearing rotates the whole
   * assembly instead of scattering it.
   */
  private at(spot: AttractionSpot, along: number, across: number, y = 0): THREE.Vector3 {
    const cos = Math.cos(spot.heading), sin = Math.sin(spot.heading)
    const x = spot.x + cos * along - sin * across
    const z = spot.z + sin * along + cos * across
    return new THREE.Vector3(x, this.ground(x, z) + y, z)
  }

  /**
   * A double-sided open material.
   *
   * NOT `materials.tinted`, which caches by colour: a horn and a bell
   * are open cylinders that need `DoubleSide`, and setting that on a
   * cached material sets it on every other object sharing the tint.
   * `own` registers it for disposal without caching it.
   */
  private shell(colour: string, roughness: number, metalness: number): THREE.Material {
    return this.game.materials.own(new THREE.MeshStandardMaterial({
      color: colour, roughness, metalness, flatShading: true, side: THREE.DoubleSide,
    }))
  }

  /** A chamfered box, with a matching fixed collider unless refused. */
  private solid(
    at: THREE.Vector3, w: number, h: number, d: number, material: THREE.Material,
    options: { yaw?: number; collide?: boolean } = {},
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(chamferedBox(w, h, d), material)
    mesh.position.copy(at)
    mesh.rotation.y = options.yaw ?? 0
    mesh.castShadow = this.shadows
    mesh.receiveShadow = true
    this.group.add(mesh)
    if (options.collide !== false) {
      this.game.physics.add({
        type: 'fixed', position: at,
        rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, options.yaw ?? 0, 0)),
        friction: 0.7, restitution: 0.12,
        colliders: [{ shape: 'cuboid', parameters: [w / 2, h / 2, d / 2] }],
      })
    }
    return mesh
  }

  /** A tapered post standing on the ground. `strutGeometry` is unit-height. */
  private post(at: THREE.Vector3, height: number, radius: number, material: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(strutGeometry(radius), material)
    mesh.position.copy(at)
    mesh.scale.y = height
    mesh.castShadow = this.shadows
    this.group.add(mesh)
    this.game.physics.add({
      type: 'fixed', position: new THREE.Vector3(at.x, at.y + height / 2, at.z),
      friction: 0.7, restitution: 0.1,
      colliders: [{ shape: 'cylinder', parameters: [height / 2, radius] }],
    })
    return mesh
  }

  /** A dynamic actor. `Playground.box` with the geometry handed in. */
  private dynamic(
    at: THREE.Vector3, geometry: THREE.BufferGeometry, material: THREE.Material,
    colliders: ColliderDescription[], mass: number,
    options: { restitution?: number; damping?: number } = {},
  ): Actor {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.copy(at)
    mesh.castShadow = this.shadows
    mesh.receiveShadow = true
    this.group.add(mesh)
    const physical = this.game.physics.add({
      type: 'dynamic', position: at, mass, colliders, friction: 0.6,
      restitution: options.restitution ?? 0.14,
      linearDamping: options.damping ?? 0.16, angularDamping: 0.4,
    })
    const actor = { mesh, physical }
    this.actors.push(actor)
    return actor
  }

  private label(text: string, at: THREE.Vector3, width: number, height: number, yaw: number): THREE.Mesh {
    const mesh = signLabel(text, this.group, at, width, height)
    mesh.rotation.y = yaw
    return mesh
  }

  /** Throws the car. The argument is metres per second, not impulse. */
  private shove(velocity: THREE.Vector3): void {
    const chassis = this.game.vehicle.chassis
    chassis.physical.body.applyImpulse(velocity.multiplyScalar(chassis.mass), true)
  }

  private near(at: THREE.Vector3, radius: number): boolean {
    const p = this.game.player.position
    return (p.x - at.x) ** 2 + (p.z - at.z) ** 2 < radius * radius
  }

  /** Camera shake, suppressed under reduced motion as the Options panel promises. */
  private kick(strength: number): void {
    if (!this.game.reducedMotion) this.game.view.kick(strength)
  }

  /* ========================================================
     1 · THE BIG KLAXON

     A brass horn on a post at the forecourt's west gate. Everything
     loose inside nine metres is thrown outwards as a SPEED, so a
     0.6 kg cone leaves faster than a 6 kg crate — which is what
     makes it read as air rather than as a shockwave.
     ======================================================== */

  private buildKlaxon(): void {
    const spot = this.spot('klaxon'), P = PARTS.klaxon, yaw = this.yaw(spot.heading)
    const base = this.at(spot, 0, 0)
    this.post(base, P.postHeight, 0.28, this.game.materials.get('graphite'))
    /* A cylinder with one wide end, not a cone: a cone on its side
       reads as a traffic bollard somebody has knocked over. */
    const flare = new THREE.Mesh(
      new THREE.CylinderGeometry(P.hornMouth, 0.24, P.hornLength, 14, 1, true),
      this.shell('#b98c3f', 0.42, 0.6),
    )
    flare.position.copy(this.at(spot, P.hornLength * 0.4, 0, P.postHeight))
    // −π/2 about Z lays the mouth (+Y) onto +X; the yaw then turns
    // +X down the heading, so the horn points where it is aimed.
    flare.rotation.set(0, yaw, -Math.PI / 2)
    flare.castShadow = this.shadows
    this.group.add(flare)
    this.label('KLAXON', this.at(spot, 0, 0, P.postHeight + 2.4), 5.6, 1.2, yaw)

    this.game.interactions.add({
      id: 'klaxon', position: base.clone(), radius: spot.prompt,
      label: 'SOUND THE KLAXON',
      sublabel: 'Everything loose within nine metres is about to move.',
      action: 'Sound it',
      onInteract: () => this.sound(base),
    })
  }

  private sound(at: THREE.Vector3): void {
    const now = this.game.ticker.elapsed, P = PARTS.klaxon
    if (now < this.klaxonReady) return
    this.klaxonReady = now + P.cooldown
    this.game.audio.horn()
    // Birds, because the joke only lands if something reacts to it.
    this.game.audio.environment('bird', 1)
    this.game.particles.burst(at.clone().setY(at.y + P.postHeight), 10, 'dust')
    this.game.ecology?.burst(at, 3)
    this.kick(0.3)
    for (const physical of this.game.physics.physicals) {
      if (physical.static || !physical.body.isEnabled()) continue
      const delta = physical.current.position.clone().sub(at)
      const distance = delta.length()
      if (distance > P.blast || distance < 0.2) continue
      // Lifted, so light things tumble instead of sliding.
      delta.y = Math.max(0.9, delta.y)
      delta.normalize().multiplyScalar((1 - distance / P.blast) * P.blastSpeed * physical.body.mass())
      physical.body.applyImpulse(delta, true)
    }
    this.game.achievements.add('brassSection')
  }

  /* ========================================================
     2 · THE CATAPULT

     A timber arm on a frame. Drive into the cradle, press the key,
     and it throws the car along its heading — which the content
     layer resolved to point at open ground rather than at the
     monument it stands beside.

     THE ARM IS ANIMATION. Rapier has revolute joints and nothing
     else in this world uses one; a hinge stiff enough to throw a
     2.5 kg car is also a hinge that drives its own arm through the
     ground on the way back. The impulse launches, the arm explains.
     ======================================================== */

  private buildCatapult(): void {
    const spot = this.spot('catapult'), P = PARTS.catapult, yaw = this.yaw(spot.heading)
    const timber = this.game.materials.tinted('#8a6b43', 0.82)
    const iron = this.game.materials.get('graphite')
    this.catapultAim.set(Math.cos(spot.heading), 0, Math.sin(spot.heading))

    this.solid(this.at(spot, 0, 0, 0.45), 5.4, 0.9, 4.4, timber, { yaw })
    for (const side of [-1, 1]) this.post(this.at(spot, -0.6, side * 1.7, 0.9), P.frameHeight, 0.24, iron)

    const arm = new THREE.Group()
    arm.position.copy(this.at(spot, -0.6, 0, 0.9 + P.frameHeight))
    // Yaw outside, tilt inside: three.js applies Euler XYZ, so the Z
    // tilt happens in the arm's own frame and the Y turn carries it.
    arm.rotation.set(0, yaw, P.rest)
    this.group.add(arm)
    const beam = new THREE.Mesh(chamferedBox(P.armLength, 0.5, 0.7), timber)
    beam.position.x = -P.armLength / 2 + 0.4
    beam.castShadow = this.shadows
    arm.add(beam)
    const cradle = new THREE.Mesh(chamferedBox(2.2, 0.3, 2.6), this.game.materials.get('metal'))
    cradle.position.set(-P.armLength + 1.2, 0.4, 0)
    arm.add(cradle)
    this.catapultArm = arm
    this.label('CATAPULT', this.at(spot, -0.6, 0, P.frameHeight + 3), 6.4, 1.3, yaw)

    // The prompt stands at the CRADLE, not at the frame: the thing
    // you have to be near is the thing you have to be sitting in.
    const mark = this.at(spot, -P.armLength * 0.55, 0)
    this.game.interactions.add({
      id: 'catapult', position: mark, radius: spot.prompt,
      label: 'LOOSE THE ARM',
      sublabel: 'Sit in the cradle first. The aim is not adjustable.',
      action: 'Launch',
      onInteract: () => this.launch(mark),
    })
  }

  private launch(mark: THREE.Vector3): void {
    const now = this.game.ticker.elapsed, P = PARTS.catapult
    if (now - this.catapultFired < P.swing + P.recover) return
    // Fired whether or not anybody is in it — an arm that refuses to
    // move until you are standing correctly is a machine that looks
    // broken. Only the impulse is conditional.
    this.catapultFired = now
    this.game.audio.play('jump')
    this.game.particles.burst(mark.clone().setY(mark.y + 1), 12, 'dust')
    if (!this.near(mark, P.cradle)) return
    this.shove(new THREE.Vector3(this.catapultAim.x * P.launch.forward, P.launch.up, this.catapultAim.z * P.launch.forward))
    this.kick(0.4)
    this.game.achievements.set('siegeEngine', 1)
  }

  /* ========================================================
     3 · THE PIÑATA

     A papier-mâché donkey on a rope, hung where the catapult throws
     you — the content layer measures it off the catapult's RESOLVED
     heading, so moving one moves the other.

     It bursts on proximity and height rather than on a collider: a
     hanging rigid body a car can hit at 15 m/s is a body that ends
     up in the sea, and a sensor at 30 Hz is a window you fly through.
     ======================================================== */

  private buildPinata(): void {
    const spot = this.spot('pinata'), P = PARTS.pinata, yaw = this.yaw(spot.heading)
    const timber = this.game.materials.tinted('#8a6b43', 0.82)
    for (const side of [-1, 1]) this.post(this.at(spot, 0, side * P.span * 0.5), P.barHeight, 0.22, timber)
    const bar = new THREE.Mesh(chamferedBox(0.16, 0.16, P.span), timber)
    bar.position.copy(this.at(spot, 0, 0, P.barHeight))
    bar.rotation.y = yaw
    this.group.add(bar)

    // Crêpe paper: four bands of colour rather than one solid, which
    // is the only thing that says papier-mâché at thirty metres.
    const bands = ['#d4491f', '#c8922f', '#4f9a85', '#5f8490']
    const donkey = new THREE.Group()
    this.pinataAt.copy(this.at(spot, 0, 0, P.barHeight - P.bodyDrop))
    donkey.position.copy(this.pinataAt)
    donkey.rotation.y = yaw
    this.group.add(donkey)
    for (const [i, colour] of bands.entries()) {
      const band = new THREE.Mesh(chamferedBox(0.7, 1.5, 2.1, 0.18), this.game.materials.tinted(colour, 0.9))
      band.position.x = (i - 1.5) * 0.72
      band.castShadow = this.shadows
      donkey.add(band)
    }
    const head = new THREE.Mesh(chamferedBox(1, 1, 1, 0.2), this.game.materials.tinted(bands[0], 0.9))
    head.position.set(1.9, 0.5, 0)
    donkey.add(head)
    for (const side of [-1, 1]) for (const end of [-1, 1]) {
      const leg = new THREE.Mesh(chamferedBox(0.32, 1.1, 0.32, 0.1), this.game.materials.tinted(bands[2], 0.9))
      leg.position.set(end, -1.1, side * 0.7)
      donkey.add(leg)
    }
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, P.bodyDrop, 6), this.game.materials.get('chalk'))
    rope.position.y = P.bodyDrop * 0.5 + 0.7
    donkey.add(rope)
    this.pinata = donkey

    /* What falls out, built now and parked forty metres underground
       with its body disabled. Allocating eight rigid bodies inside
       the frame that bursts it is a frame nobody gets back, and the
       burst is the one moment the whole toy exists for. */
    for (let i = 0; i < P.sweets; i++) {
      const sweet = this.dynamic(
        this.pinataAt.clone().setY(this.pinataAt.y - 40),
        chamferedBox(0.6, 0.6, 0.6, 0.14),
        this.game.materials.tinted(bands[i % bands.length], 0.7),
        [{ shape: 'cuboid', parameters: [0.3, 0.3, 0.3] }], 0.5, { restitution: 0.5 },
      )
      sweet.mesh.visible = false
      sweet.physical.body.setEnabled(false)
      this.sweets.push(sweet)
    }
  }

  private burstPinata(): void {
    if (this.pinataBurst) return
    this.pinataBurst = true
    this.pinata.visible = false
    this.game.particles.burst(this.pinataAt, this.game.quality.count(40, 16), 'confetti')
    this.game.particles.burst(this.pinataAt, 8, 'debris')
    this.game.audio.play('achievement')
    this.kick(0.35)
    for (const [i, sweet] of this.sweets.entries()) {
      const angle = (i / this.sweets.length) * Math.PI * 2
      const at = this.pinataAt.clone().add(new THREE.Vector3(Math.cos(angle) * 1.2, 0, Math.sin(angle) * 1.2))
      sweet.physical.body.setEnabled(true)
      sweet.physical.body.setTranslation(at, true)
      sweet.physical.body.setLinvel({ x: Math.cos(angle) * 4, y: 3, z: Math.sin(angle) * 4 }, true)
      sweet.physical.current.position.copy(at)
      sweet.physical.previous.position.copy(at)
      sweet.mesh.visible = true
    }
    this.game.achievements.set('partyTrick', 1)
  }

  /* ========================================================
     4 · THE PIANO ROAD

     Twelve painted slabs on the verge of the south spine, a
     semitone apart. Driving over one plays it — a CYLINDER ZONE,
     not a collider, because a key you can feel through the
     suspension is a pothole.

     The five-note phrase is painted on the board at the end of the
     strip. A secret nobody can read is not a secret, it is a
     lottery. It is built exactly like TIME TRAVELLER: advance on
     the right key, reset SILENTLY on a wrong one, because a wrong
     note that buzzes at you turns a thing you stumble into a thing
     you can fail.
     ======================================================== */

  private buildPiano(): void {
    const spot = this.spot('piano'), P = PARTS.piano, yaw = this.yaw(spot.heading)
    const white = this.game.materials.tinted('#e8e5dc', 0.86)
    const black = this.game.materials.tinted('#2b2b30', 0.7)
    // The semitones a keyboard paints black, so the strip reads as an
    // octave rather than as twelve identical slabs.
    const sharps = new Set([1, 3, 6, 8, 10])

    for (let i = 0; i < P.keys; i++) {
      const at = this.at(spot, (i - (P.keys - 1) / 2) * P.keyPitch, 0, 0.09)
      const mesh = new THREE.Mesh(chamferedBox(P.keyWidth, 0.18, P.keyLength, 0.05), sharps.has(i) ? black : white)
      mesh.position.copy(at)
      mesh.rotation.y = yaw
      mesh.receiveShadow = true
      this.group.add(mesh)
      this.keys.push({ mesh, baseY: at.y, lit: 0 })
      this.game.zones.create(`piano-${i}`, 'cylinder', at, P.keyReach).events.on('enter', () => this.playKey(i))
    }
    // At the WEST end, which is the end you arrive at from the
    // circuit, and the end that is not eight metres from the bell.
    this.label(`PIANO ROAD\n${P.phrase.join(' · ')}`, this.at(spot, -(P.keys / 2 + 1.4) * P.keyPitch, 0, 2.6), 9, 2.4, yaw)
  }

  private playKey(index: number): void {
    const P = PARTS.piano, now = this.game.ticker.elapsed
    this.keys[index].lit = 1
    this.game.audio.blip(2 ** (index / 12))
    this.played.add(index)
    this.game.achievements.set('pianoRoad', this.played.size)

    if (now - this.lastNote > P.phraseGap) this.phraseAt = 0
    this.lastNote = now
    // The phrase is written in key NUMBERS on the board, so it is
    // one-based there and zero-based everywhere else.
    if (P.phrase[this.phraseAt] - 1 === index) {
      if (++this.phraseAt < P.phrase.length) return
      this.phraseAt = 0
      const at = this.keys[index].mesh.position.clone().setY(this.keys[index].baseY + 1.5)
      this.game.particles.burst(at, this.game.quality.count(24, 10), 'confetti')
      this.game.audio.play('achievement')
      this.game.recordSecret('perfectPitch')
      this.game.store.getState().notify({
        kind: 'info', title: 'PERFECT PITCH', body: 'You played the phrase painted on the board.', duration: 5,
      })
      return
    }
    // A wrong note may still be the phrase's own first note.
    this.phraseAt = P.phrase[0] - 1 === index ? 1 : 0
  }

  /* ========================================================
     5 · THE SPEED TRAP

     An arch over the road to the start line, and a board beside it
     holding the session's best. `signLabel` costs a canvas, a
     texture and a material per call and registers none of them with
     the Bin, so the board is redrawn only when the number actually
     changes and the old one is disposed by hand.
     ======================================================== */

  private buildSpeedTrap(): void {
    const spot = this.spot('speedTrap'), P = PARTS.speedTrap, yaw = this.yaw(spot.heading)
    const iron = this.game.materials.get('metal')
    const reach = 5.5
    this.trapSpot = spot

    for (const side of [-1, 1]) this.post(this.at(spot, 0, side * reach), P.postHeight, 0.26, iron)
    const beam = new THREE.Mesh(chamferedBox(0.5, 0.4, reach * 2), iron)
    beam.position.copy(this.at(spot, 0, 0, P.postHeight - P.beamDrop))
    beam.rotation.y = yaw
    this.group.add(beam)
    const radar = new THREE.Mesh(chamferedBox(1.1, 0.8, 1.6), this.game.materials.get('graphite'))
    radar.position.copy(this.at(spot, 0, 0, P.postHeight - P.beamDrop - 0.7))
    radar.rotation.y = yaw
    this.group.add(radar)
    this.trapFlash = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 10, 8),
      this.game.materials.own(new THREE.MeshBasicMaterial({ color: '#fff6ea', transparent: true, opacity: 0, toneMapped: false })),
    )
    this.trapFlash.position.copy(radar.position)
    this.group.add(this.trapFlash)

    this.drawTrapBoard()
    this.game.zones.create('speed-trap', 'cylinder', this.at(spot, 0, 0), reach).events.on('enter', () => this.trip())
  }

  private drawTrapBoard(): void {
    const P = PARTS.speedTrap
    if (this.trapBoard) {
      this.trapBoard.removeFromParent()
      this.trapBoard.geometry.dispose()
      const material = this.trapBoard.material as THREE.MeshBasicMaterial
      material.map?.dispose()
      material.dispose()
    }
    const text = this.trapBest > 0 ? `SPEED TRAP\nBEST ${Math.round(this.trapBest)}` : 'SPEED TRAP\nDRIVE THROUGH'
    this.trapBoard = this.label(
      text, this.at(this.trapSpot, 2.4, 8.5, P.postHeight - 1.4),
      P.boardWidth, P.boardHeight, this.yaw(this.trapSpot.heading),
    )
  }

  private trip(): void {
    const speed = this.game.vehicle.speedKmh
    this.game.audio.blip(1.5)
    ;(this.trapFlash.material as THREE.MeshBasicMaterial).opacity = PARTS.speedTrap.flash
    // A whole km/h of margin, so crawling through it repeatedly does
    // not redraw the canvas once per pass for no visible change.
    if (speed <= this.trapBest + 1) return
    this.trapBest = speed
    this.drawTrapBoard()
  }

  /* ========================================================
     6 · THE CAR WASH

     An arch on the road south of the bridge with two spinning
     brushes. Driving through IS the interaction, so it has no
     prompt — and the brushes carry no collider, because a rotating
     obstacle in a carriageway is a roadblock with a motor.
     ======================================================== */

  private buildCarWash(): void {
    const spot = this.spot('carWash'), P = PARTS.carWash, yaw = this.yaw(spot.heading)
    const frame = this.game.materials.tinted('#5f8490', 0.6, 0.2)
    const reach = 5

    for (const side of [-1, 1]) this.post(this.at(spot, 0, side * reach), P.postHeight, 0.3, frame)
    const lintel = new THREE.Mesh(chamferedBox(1.4, 0.7, reach * 2), frame)
    lintel.position.copy(this.at(spot, 0, 0, P.postHeight))
    lintel.rotation.y = yaw
    this.group.add(lintel)
    this.label('CAR WASH', this.at(spot, 0, 0, P.postHeight + 1.6), 6.4, 1.3, yaw)

    const bristle = this.game.materials.tinted('#4f9a85', 0.95)
    for (const side of [-1, 1]) {
      const brush = new THREE.Mesh(new THREE.CylinderGeometry(P.brushRadius, P.brushRadius, P.brushHeight, 9), bristle)
      brush.position.copy(this.at(spot, 0, side * (reach - 0.9), P.brushHeight * 0.5 + 0.6))
      brush.castShadow = this.shadows
      this.group.add(brush)
      this.brushes.push(brush)
    }
    this.game.zones.create('car-wash', 'cylinder', this.at(spot, 0, 0), reach - 0.5).events.on('enter', () => this.wash())
  }

  private wash(): void {
    this.washUntil = this.game.ticker.elapsed + PARTS.carWash.rinse
    this.game.audio.environment('splash', 0.8)
    /* Two shells, toggled. `setShell` also takes 'konami', which the
       cheat code borrows for 25 seconds and hands back — a wash that
       cycled through it would leave a car painted like the secret one
       with nothing to say which it was. */
    this.washDark = !this.washDark
    this.game.visualVehicle.setShell(this.washDark ? 'graphite' : 'default')
    this.game.achievements.set('showroom', 1)
  }

  /* ========================================================
     7 · THE GIANT FOOTBALL

     A three-metre ball and a goal sixteen metres away, on the
     circuit's infield. The ball is 1.1 kg against the car's 2.5, so
     it moves when it is pushed and stops when it is not.

     THE GOAL IS A DISTANCE TEST ON THE BALL. `Zones` tests exactly
     one point — the player's — so a goal built on it would be a
     goal you can only score by driving into the net yourself.
     ======================================================== */

  private buildFootball(): void {
    const spot = this.spot('football'), P = PARTS.football, yaw = this.yaw(spot.heading)
    const post = this.game.materials.get('chalk')
    this.goalAt.copy(this.at(spot, P.pitch * 0.5, 0))
    this.goalAlong.set(Math.cos(spot.heading), 0, Math.sin(spot.heading))
    this.goalAcross.set(-Math.sin(spot.heading), 0, Math.cos(spot.heading))

    for (const side of [-1, 1]) this.post(this.at(spot, P.pitch * 0.5, side * P.goalWidth * 0.5), P.goalHeight, 0.2, post)
    const bar = new THREE.Mesh(chamferedBox(0.34, 0.34, P.goalWidth + 0.4), post)
    bar.position.copy(this.at(spot, P.pitch * 0.5, 0, P.goalHeight))
    bar.rotation.y = yaw
    this.group.add(bar)
    /* The net as LINES. Twelve thin boxes would be twelve more
       shadow-casting meshes for something whose whole job is to be
       seen through; this is one `LineSegments` and one draw call. */
    const net: number[] = []
    for (let i = 0; i <= 8; i++) {
      const across = (i / 8 - 0.5) * P.goalWidth
      const top = this.at(spot, P.pitch * 0.5, across, P.goalHeight)
      const foot = this.at(spot, P.pitch * 0.5 + 2.2, across, 0)
      net.push(top.x, top.y, top.z, foot.x, foot.y, foot.z)
    }
    for (let i = 0; i <= 3; i++) {
      const back = (1 - i / 3) * 2.2, h = (i / 3) * P.goalHeight
      const a = this.at(spot, P.pitch * 0.5 + back, -P.goalWidth * 0.5, h)
      const b = this.at(spot, P.pitch * 0.5 + back, P.goalWidth * 0.5, h)
      net.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(net, 3))
    this.group.add(new THREE.LineSegments(geometry, this.game.materials.get('lineChalk')))

    this.ballHome.copy(this.at(spot, -P.pitch * 0.5, 0, P.ballRadius + 0.1))
    this.ball = this.dynamic(
      this.ballHome, new THREE.SphereGeometry(P.ballRadius, 20, 14),
      this.game.materials.tinted('#f4f2ee', 0.62),
      [{ shape: 'ball', parameters: [P.ballRadius] }], P.ballMass,
      { restitution: 0.62, damping: 0.28 },
    )
    // A dark cap, so a rolling ball reads as rolling rather than as
    // a pale sphere sliding across the grass.
    const cap = new THREE.Mesh(new THREE.SphereGeometry(P.ballRadius * 0.42, 12, 8), this.game.materials.get('ink'))
    cap.position.y = P.ballRadius * 0.8
    this.ball.mesh.add(cap)
    this.label('GOAL', this.at(spot, P.pitch * 0.5, 0, P.goalHeight + 1.6), 4.2, 1.1, yaw)
  }

  private testGoal(now: number): void {
    const P = PARTS.football
    if (this.goalUntil > 0) {
      if (now < this.goalUntil) return
      this.goalUntil = 0
      this.game.physics.reset(this.ball.physical)
      return
    }
    const at = this.ball.physical.current.position
    const delta = at.clone().sub(this.goalAt)
    const along = delta.dot(this.goalAlong)
    const across = Math.abs(delta.dot(this.goalAcross))
    if (along > -P.ballRadius && along < 2.4 && across < P.goalWidth * 0.5 && delta.y < P.goalHeight) {
      this.goals++
      this.goalUntil = now + P.returnDelay
      this.game.particles.burst(at.clone(), this.game.quality.count(26, 10), 'confetti')
      this.game.audio.play('achievement')
      this.game.achievements.set('backOfTheNet', this.goals)
      return
    }
    // Anything kicked out of the county comes home on its own. There
    // is no prompt here to put it back with, and there should not be.
    if (at.distanceTo(this.ballHome) > P.stray) this.game.physics.reset(this.ball.physical)
  }

  /* ========================================================
     8 · THE SKITTLE YARD

     Twelve oversized pins on the sand west of the pin deck: 1.6 kg,
     so the car flattens the lot and a stray bowling ball does not.
     The prompt restacks them, exactly as RESTOCK TNT does.
     ======================================================== */

  private buildSkittles(): void {
    const spot = this.spot('skittles'), P = PARTS.skittles
    const paint = this.game.materials.tinted('#f4f2ee', 0.7)
    const band = this.game.materials.tinted('#d4491f', 0.6)

    for (const [row, count] of P.rows.entries()) {
      for (let i = 0; i < count; i++) {
        const at = this.at(spot, (row - (P.rows.length - 1) / 2) * P.pitch, (i - (count - 1) / 2) * P.pitch, P.height * 0.5)
        const pin = this.dynamic(
          at, new THREE.CylinderGeometry(P.radius * 0.62, P.radius, P.height, 10), paint,
          [{ shape: 'cylinder', parameters: [P.height / 2, P.radius] }], P.mass, { restitution: 0.2 },
        )
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(P.radius * 0.74, P.radius * 0.74, 0.26, 10), band)
        collar.position.y = P.height * 0.28
        pin.mesh.add(collar)
        this.pins.push({ ...pin, down: false })
      }
    }
    if (this.pins.length !== P.count && process.env.NODE_ENV === 'development') {
      console.warn(`[world] skittles: rows build ${this.pins.length}, TURKEY SHOOT counts to ${P.count}`)
    }

    const mark = this.at(spot, -P.pitch * 3, 0)
    this.label('SKITTLES', this.at(spot, -P.pitch * 3, 0, 3.4), 6, 1.3, this.yaw(spot.heading))
    this.game.interactions.add({
      id: 'reset-skittles', position: mark, radius: spot.prompt,
      label: 'RESTACK THE PINS',
      sublabel: 'Twelve of them. They do not stand back up by themselves.',
      action: 'Restack',
      onInteract: () => { this.restack(); this.game.audio.play('interact') },
    })
  }

  private restack(): void {
    for (const pin of this.pins) {
      this.game.physics.reset(pin.physical)
      pin.down = false
    }
    // Progress is kept as a MAX, so emptying the set cannot take an
    // unlocked TURKEY SHOOT away; it just lets the next dozen count.
    this.felled.clear()
  }

  /* ========================================================
     9 · THE FIREWORK BATTERY

     Six mortars on the bay shore, pointed over the water at the
     islet: eighteen shells across five seconds, each one a rising
     spark trail and a confetti burst at the top.

     It refuses in the rain, which is a joke and also half the
     reason the weather lever is worth pulling.
     ======================================================== */

  private buildFireworks(): void {
    const spot = this.spot('fireworks'), P = PARTS.fireworks, yaw = this.yaw(spot.heading)
    const timber = this.game.materials.tinted('#8a6b43', 0.82)
    this.solid(this.at(spot, 0, 0, 0.3), 2.2, 0.6, P.tubeSpread * 2.2, timber, { yaw })

    // A group, so the fan is authored as a tilt per tube rather than
    // as two trigonometric terms per axis at every mortar.
    const battery = new THREE.Group()
    battery.position.copy(this.at(spot, 0, 0, 0.5))
    battery.rotation.y = yaw
    this.group.add(battery)
    const tube = this.game.materials.tinted('#a13415', 0.7)
    for (let i = 0; i < P.tubes; i++) {
      const across = (i - (P.tubes - 1) / 2) * (P.tubeSpread * 2 / P.tubes)
      const mortar = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, P.tubeLength, 10), tube)
      mortar.position.set(0, P.tubeLength * 0.5, across)
      mortar.rotation.x = across * 0.05
      mortar.castShadow = this.shadows
      battery.add(mortar)
      this.mortars.push(mortar)
    }

    const mark = this.at(spot, -3.4, 0)
    this.label('FIREWORKS', this.at(spot, -3.4, 0, 3.2), 6.6, 1.3, yaw)
    this.game.interactions.add({
      id: 'fireworks', position: mark, radius: spot.prompt,
      label: 'LIGHT THE BATTERY',
      sublabel: 'Eighteen shells over the bay. Stand back, or do not.',
      action: 'Light it',
      onInteract: () => this.lightFireworks(),
    })
  }

  private lightFireworks(): void {
    if (this.game.ticker.elapsed < this.volleyUntil) return
    if (this.game.weather.rain > 0.2) {
      this.game.store.getState().notify({
        kind: 'info', title: 'DAMP SQUIB', body: 'The fuses are wet. Come back when it stops.', duration: 4,
      })
      this.game.audio.play('fail')
      return
    }
    this.volleyUntil = this.game.ticker.elapsed + PARTS.fireworks.volley
    this.shellsLeft = PARTS.fireworks.shells
    this.nextShell = 0
    this.game.audio.play('interact')
    this.game.achievements.set('fireInTheSky', 1)
  }

  private fireShell(): void {
    const P = PARTS.fireworks
    const from = this.mortars[Math.floor(Math.random() * this.mortars.length)].getWorldPosition(new THREE.Vector3())
    const drift = (Math.random() - 0.5) * 14
    const burst = from.clone().add(new THREE.Vector3(drift, P.apex * (0.75 + Math.random() * 0.5), drift * 0.6))
    this.game.particles.burst(from.clone().setY(from.y + 1), 6, 'spark')
    // The climb is a delay, not an interpolated projectile: the trail
    // and the burst are both particle bursts and nothing has to be
    // simulated between them.
    this.game.tweens.delay(P.climb, () => {
      this.game.particles.burst(burst, this.game.quality.count(30, 12), 'confetti')
      this.game.particles.burst(burst, 8, 'spark')
      const proximity = Math.max(0, 1 - this.game.player.position.distanceTo(burst) / 90)
      this.game.audio.environment('explosion', proximity * 0.5)
      this.kick(proximity * 0.12)
    })
  }

  /* ========================================================
     10 · THE HARBOUR BELL

     Rung by the key, and rung again by anything that hits it — the
     pitch comes off the impact force, so a car at speed sounds
     lower than a tap. Seven inside ten seconds is a carillon.
     ======================================================== */

  private buildBell(): void {
    const spot = this.spot('bell'), P = PARTS.bell, yaw = this.yaw(spot.heading)
    const bronze = this.shell('#9a7a3c', 0.4, 0.55)
    const timber = this.game.materials.tinted('#8a6b43', 0.82)

    for (const side of [-1, 1]) this.post(this.at(spot, 0, side * 1.9), P.frameHeight, 0.24, timber)
    const head = new THREE.Mesh(chamferedBox(0.3, 0.3, 4.4), timber)
    head.position.copy(this.at(spot, 0, 0, P.frameHeight))
    head.rotation.y = yaw
    this.group.add(head)

    const bell = new THREE.Group()
    bell.position.copy(this.at(spot, 0, 0, P.frameHeight))
    this.group.add(bell)
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(P.bellRadius * 0.45, P.bellRadius, 1.9, 14, 1, true), bronze)
    skirt.position.y = -1.3
    skirt.castShadow = this.shadows
    bell.add(skirt)
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), bronze)
    crown.position.y = -0.4
    bell.add(crown)
    this.bell = bell

    /* A FIXED body, and deliberately. A two-tonne bronze bell that a
       car can knock off its frame is a bell you lose on the first
       lap; the response to a hit is a sound, not a trajectory. */
    this.game.physics.add({
      type: 'fixed', position: this.at(spot, 0, 0, P.frameHeight - 1.3),
      friction: 0.5, restitution: 0.4, contactThreshold: 8,
      colliders: [{ shape: 'cylinder', parameters: [0.95, P.bellRadius] }],
      onCollision: (force) => this.ring(Math.min(1.4, 0.5 + force / 90)),
    })

    this.label('HARBOUR BELL', this.at(spot, 0, 0, P.frameHeight + 2), 7.4, 1.3, yaw)
    this.game.interactions.add({
      id: 'bell', position: this.at(spot, 0, 0), radius: spot.prompt,
      label: 'RING THE BELL',
      sublabel: 'Or drive into it. It is louder that way.',
      action: 'Ring it',
      onInteract: () => this.ring(0.85),
    })
  }

  private ring(rate: number): void {
    const now = this.game.ticker.elapsed, window = PARTS.bell.carillon
    // A car resting against the bell produces a contact event every
    // step; a bell that answers all of them is a fire alarm.
    if (now < this.bellReady) return
    this.bellReady = now + 0.22
    this.bellSwing = PARTS.bell.swing
    this.game.audio.blip(rate * 0.5)
    this.rings.push(now)
    while (this.rings.length > 0 && now - this.rings[0] > window.seconds) this.rings.shift()
    if (this.rings.length < window.rings) return
    this.rings.length = 0
    this.game.achievements.set('carillon', 1)
    this.game.particles.burst(this.bell.position.clone(), this.game.quality.count(20, 8), 'confetti')
  }

  /* ========================================================
     11 · THE TRAMPOLINES

     Three pads in the belt the catapult fires down. A solid deck
     with a little restitution of its own, plus one impulse per
     landing from `update()` — see rule 3 in the header.
     ======================================================== */

  private buildTrampolines(): void {
    const spot = this.spot('trampolines'), P = PARTS.trampolines
    const frame = this.game.materials.tinted('#3a3a3e', 0.6, 0.2)
    const skin = this.game.materials.tinted('#4f9a85', 0.5)

    for (let i = 0; i < P.pads; i++) {
      // A shallow arc rather than a row, so a bounce off the first
      // has somewhere to land that is not the ground.
      const angle = (i - (P.pads - 1) / 2) * 0.7
      const at = this.at(spot, Math.cos(angle) * P.spacing, Math.sin(angle) * P.spacing)
      for (let leg = 0; leg < 4; leg++) {
        const a = (leg / 4) * Math.PI * 2 + Math.PI / 4
        const foot = at.clone().add(new THREE.Vector3(Math.cos(a) * P.padRadius * 0.8, 0, Math.sin(a) * P.padRadius * 0.8))
        foot.y = this.ground(foot.x, foot.z)
        this.post(foot, P.padHeight, 0.18, frame)
      }
      // `wheelGeometry` lies on Z; a quarter turn about X stands the
      // disc flat with its thickness along world Y.
      const deck = new THREE.Mesh(wheelGeometry(P.padRadius, 0.24, 18), skin)
      deck.position.copy(at).setY(at.y + P.padHeight)
      deck.rotation.x = Math.PI / 2
      deck.receiveShadow = true
      this.group.add(deck)
      this.game.physics.add({
        type: 'fixed', position: deck.position, friction: 0.5, restitution: 0.35,
        colliders: [{ shape: 'cylinder', parameters: [0.12, P.padRadius] }],
      })
      this.pads.push({ at: deck.position.clone(), radius: P.padRadius, mesh: deck, baseY: deck.position.y, ready: 0, flex: 0 })
    }
  }

  /* ========================================================
     12 · THE BUMPER FIELD

     Five sprung mushrooms against the ACHIEVEMENTS plate — the
     same distance test as the pads, thrown outwards instead of up.
     ======================================================== */

  private buildBumpers(): void {
    const spot = this.spot('bumpers'), P = PARTS.bumpers
    const body = this.game.materials.tinted('#c8922f', 0.55)
    const cap = this.game.materials.get('emissiveAccent')

    for (let i = 0; i < P.count; i++) {
      // Four on a ring and one in the middle: the arrangement that
      // makes a car ricochet rather than bounce back out the way it
      // came in.
      const angle = (i / (P.count - 1)) * Math.PI * 2
      const reach = i === P.count - 1 ? 0 : P.spread
      const at = this.at(spot, Math.cos(angle) * reach, Math.sin(angle) * reach)
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(P.radius, P.radius * 1.1, P.height, 14), body)
      drum.position.copy(at).setY(at.y + P.height * 0.5)
      drum.castShadow = this.shadows
      this.group.add(drum)
      const dome = new THREE.Mesh(new THREE.SphereGeometry(P.radius * 0.92, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), cap)
      dome.position.copy(at).setY(at.y + P.height)
      this.group.add(dome)
      this.game.physics.add({
        type: 'fixed', position: drum.position, friction: 0.3, restitution: 0.55,
        colliders: [{ shape: 'cylinder', parameters: [P.height / 2, P.radius] }],
      })
      this.bumpers.push({ at: at.clone(), radius: P.radius, mesh: dome, baseY: dome.position.y, ready: 0, flex: 0 })
    }
  }

  /* ========================================================
     13 · THE WEATHER LEVER

     Thirty seconds of rain on demand, which turns STORM SHIFT into
     something you can go and get rather than something you wait
     for. It never takes the lock off somebody else's weather: the
     circuit race locks it for the length of a lap, and two systems
     fighting over one flag is how a timed run ends up in a
     downpour it did not ask for.
     ======================================================== */

  private buildWeatherLever(): void {
    const spot = this.spot('weatherLever'), P = PARTS.weatherLever, yaw = this.yaw(spot.heading)
    const at = this.at(spot, 0, 0)
    this.solid(at.clone().setY(at.y + P.plinth * 0.5), 2.4, P.plinth, 1.8, this.game.materials.get('concrete'), { yaw })

    const pivot = new THREE.Group()
    pivot.position.copy(at).setY(at.y + P.plinth)
    pivot.rotation.y = yaw
    this.group.add(pivot)
    const arm = new THREE.Mesh(chamferedBox(0.22, P.leverLength, 0.22), this.game.materials.get('graphite'))
    arm.position.y = P.leverLength * 0.5
    pivot.add(arm)
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), this.game.materials.get('emissiveAccent'))
    knob.position.y = P.leverLength
    pivot.add(knob)
    this.lever = pivot

    this.label('WEATHER', at.clone().setY(at.y + P.plinth + P.leverLength + 1.6), 5.2, 1.2, yaw)
    this.game.interactions.add({
      id: 'weather-lever', position: at, radius: spot.prompt,
      label: 'PULL THE LEVER',
      sublabel: 'Thirty seconds of weather you asked for.',
      action: 'Pull it',
      onInteract: () => this.pullLever(),
    })
  }

  private pullLever(): void {
    if (this.game.ticker.elapsed < this.rainUntil) return
    this.rainUntil = this.game.ticker.elapsed + PARTS.weatherLever.hold
    this.game.weather.lock('rain')
    this.game.audio.play('interact')
    this.game.achievements.set('rainmaker', 1)
    this.game.store.getState().notify({
      kind: 'info', title: 'RAIN ORDERED', body: 'Thirty seconds of it. Go and drive in it.', duration: 4,
    })
  }

  /* ========================================================
     14 · THE TURNTABLE

     A thirteen-metre disc that turns once every fourteen seconds.
     Kinematic and driven before the physics step, so its surface
     has a real velocity and friction carries whatever is standing
     on it. Stay aboard for one revolution and it says so.
     ======================================================== */

  private buildTurntable(): void {
    const spot = this.spot('turntable'), P = PARTS.turntable
    const at = this.at(spot, 0, 0)
    this.turntableAt.copy(at)

    /* A PIVOT holding a tilted deck, rather than one mesh carrying
       both rotations. Euler XYZ composes the quarter turn that lays
       the disc flat with the spin, so a mesh doing both spins about
       an axis that is no longer vertical and the chevrons wobble. */
    const pivot = new THREE.Group()
    pivot.position.copy(at)
    this.group.add(pivot)
    this.turntablePivot = pivot
    const deck = new THREE.Mesh(wheelGeometry(P.radius, P.thickness, 28), this.game.materials.get('concreteDark'))
    deck.rotation.x = Math.PI / 2
    deck.receiveShadow = true
    pivot.add(deck)
    // Chevrons, because a disc turning under a stationary car is
    // otherwise completely invisible.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const mark = new THREE.Mesh(chamferedBox(2.4, 0.12, 0.5, 0.04), this.game.materials.get('emissiveAmber'))
      mark.position.set(Math.cos(a) * P.radius * 0.66, P.thickness * 0.5 + 0.08, Math.sin(a) * P.radius * 0.66)
      mark.rotation.y = -a
      pivot.add(mark)
    }

    this.turntable = this.game.physics.add({
      type: 'kinematicPositionBased', position: pivot.position,
      friction: 1.1, frictionRule: 'max', restitution: 0.05,
      colliders: [{ shape: 'cylinder', parameters: [P.thickness / 2, P.radius] }],
    })
  }

  /** Fixed clock, order 2 — before `Physics.step` at 3. */
  private turn(): void {
    if (!this.turntable) return
    this.spin += (Math.PI * 2 / PARTS.turntable.period) * this.game.ticker.deltaScaled
    this.turntable.body.setNextKinematicRotation(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.spin),
    )
  }

  /* ========================================================
     THE FRAME
     ======================================================== */

  private update(): void {
    const game = this.game
    const now = game.ticker.elapsed
    const dt = Math.min(0.05, game.ticker.delta)

    for (const actor of this.actors) {
      if (actor.mesh.visible) game.physics.sample(actor.physical, game.ticker.alpha, actor.mesh.position, actor.mesh.quaternion)
    }

    /* ---- catapult: forward hard, back slowly ------------ */
    {
      const P = PARTS.catapult, t = now - this.catapultFired
      // Down and back at rest, forward and up on the throw, then
      // wound back five times more slowly than it went.
      this.catapultArm.rotation.z =
        t < P.swing ? P.rest - (t / P.swing) * P.sweep
        : t < P.swing + P.recover ? P.rest - P.sweep * (1 - (t - P.swing) / P.recover)
        : P.rest
    }

    /* ---- piñata: swing, and burst on a pass ------------- */
    if (!this.pinataBurst) {
      this.pinata.rotation.z = Math.sin(now * 1.1) * 0.12
      const P = PARTS.pinata
      if (this.near(this.pinataAt, P.reach) && game.player.position.y > this.pinataAt.y - P.lift) this.burstPinata()
    }

    /* ---- piano: a struck key sinks and comes back ------- */
    for (const key of this.keys) {
      if (key.lit <= 0) continue
      key.lit = Math.max(0, key.lit - dt * 3)
      key.mesh.position.y = key.baseY - key.lit * 0.09
    }

    /* ---- speed trap: the flash decays ------------------- */
    {
      const material = this.trapFlash.material as THREE.MeshBasicMaterial
      if (material.opacity > 0) material.opacity = Math.max(0, material.opacity - dt * 1.4)
    }

    /* ---- car wash: brushes turn, rinse follows the car -- */
    for (const [i, brush] of this.brushes.entries()) brush.rotation.y += PARTS.carWash.brushSpin * dt * (i ? 1 : -1)
    if (now < this.washUntil && now > this.splashAt) {
      this.splashAt = now + 0.12
      game.particles.burst(game.player.position.clone().setY(game.player.position.y + 1), 6, 'splash')
    }

    this.testGoal(now)

    /* ---- skittles: what is lying down ------------------- */
    for (const [i, pin] of this.pins.entries()) {
      if (pin.down) continue
      const q = pin.physical.current.quaternion
      // The letters' own test: the world-up component of the body's
      // Y axis, below which it is on its side rather than leaning.
      if (1 - 2 * (q.x * q.x + q.z * q.z) >= PARTS.skittles.down) continue
      pin.down = true
      this.felled.add(i)
      game.achievements.set('turkeyShoot', this.felled.size)
    }

    /* ---- fireworks: the volley ------------------------- */
    if (this.shellsLeft > 0 && now >= this.nextShell) {
      this.nextShell = now + PARTS.fireworks.volley / PARTS.fireworks.shells
      this.shellsLeft--
      this.fireShell()
    }

    /* ---- bell: the swing decays ------------------------ */
    if (this.bellSwing > 0.001) {
      this.bellSwing *= 1 - dt * 2.2
      this.bell.rotation.z = Math.sin(now * 9) * this.bellSwing
    }

    this.springs(now, dt)

    /* ---- weather lever --------------------------------- */
    this.leverAngle += ((now < this.rainUntil ? -0.9 : 0) - this.leverAngle) * Math.min(1, dt * 6)
    this.lever.rotation.z = this.leverAngle
    if (this.rainUntil > 0 && now >= this.rainUntil) {
      this.rainUntil = 0
      // Only if it is still OUR rain — see the builder's note.
      if (game.weather.state === 'rain') game.weather.unlock()
    }

    /* ---- turntable: a full revolution aboard ------------ */
    this.turntablePivot.rotation.y = this.spin
    /* Measured off the disc's OWN angle, not recomputed from the
       period and the render delta. The disc turns on `deltaScaled`,
       which is the fixed step times the ticker's scale of 2, so a
       second accumulator fed the render delta counts half as fast
       and SPIN CYCLE asks for two revolutions instead of one. */
    const spun = this.spin - this.lastSpin
    this.lastSpin = this.spin
    const P = PARTS.turntable
    if (this.near(this.turntableAt, P.radius - 1) && game.player.elevation < 2) {
      this.turned += spun
      if (this.turned >= P.revolution) {
        this.turned = 0
        game.achievements.set('spinCycle', 1)
      }
    } else {
      this.turned = 0
    }
  }

  /**
   * One impulse per contact, with a cooldown, from a distance test.
   *
   * The pads fire only when the car is coming DOWN — without that, a
   * car resting on a trampoline is a car being launched sixty times
   * a second, which is not a bounce, it is a rocket. The bumpers do
   * not care which way you arrived.
   */
  private springs(now: number, dt: number): void {
    const p = this.game.player.position
    const T = PARTS.trampolines
    const falling = this.game.vehicle.chassis.physical.body.linvel().y < 0.5

    for (const pad of this.pads) {
      pad.flex = Math.max(0, pad.flex - dt * 4)
      pad.mesh.position.y = pad.baseY - pad.flex * 0.4
      const high = p.y - pad.at.y
      if (now < pad.ready || !falling || high < -0.4 || high > 2.4 || !this.near(pad.at, pad.radius)) continue
      pad.ready = now + T.cooldown
      pad.flex = 1
      this.shove(new THREE.Vector3(0, T.bounce, 0))
      this.game.audio.play('jump', 0.7)
      this.game.particles.burst(pad.at.clone().setY(pad.at.y + 0.4), 6, 'dust')
      // A chain is bounces that arrive close together. Landing on
      // ordinary ground in between simply takes longer than the gap,
      // so no separate "did you touch the ground" test is needed.
      this.chain = now - this.chainAt < T.chainGap ? this.chain + 1 : 1
      this.chainAt = now
      if (this.chain >= T.chain) this.game.achievements.set('boing', 1)
    }

    const B = PARTS.bumpers
    for (const bumper of this.bumpers) {
      bumper.flex = Math.max(0, bumper.flex - dt * 5)
      bumper.mesh.scale.setScalar(1 + bumper.flex * 0.22)
      if (now < bumper.ready || Math.abs(p.y - bumper.at.y) > 3) continue
      if (!this.near(bumper.at, bumper.radius + 1.6)) continue
      bumper.ready = now + B.cooldown
      bumper.flex = 1
      const away = new THREE.Vector3(p.x - bumper.at.x, 0, p.z - bumper.at.z)
      // Dead centre has no direction to leave in; anywhere will do.
      if (away.lengthSq() < 0.04) away.set(1, 0, 0)
      away.normalize().multiplyScalar(B.kick).setY(2)
      this.shove(away)
      this.game.audio.blip(1.7)
      this.game.particles.burst(bumper.at.clone().setY(bumper.at.y + B.height), 5, 'spark')
      this.kick(0.12)
      this.game.achievements.set('tilt', ++this.hits)
    }
  }

  /** Everything back where it started. Called by `Game.resetObjects`. */
  reset(): void {
    for (const actor of this.actors) this.game.physics.reset(actor.physical)
    // AFTER the loop: `physics.reset` re-enables the body it is given,
    // so sweets reset first and disabled second, or the piñata's
    // contents hang in mid-air at the height they were parked at.
    for (const sweet of this.sweets) {
      sweet.mesh.visible = false
      sweet.physical.body.setEnabled(false)
    }
    this.restack()
    this.pinataBurst = false
    this.pinata.visible = true
    this.goals = 0
    this.goalUntil = 0
    this.shellsLeft = 0
    this.volleyUntil = -100
    this.chain = 0
    this.turned = 0
    this.phraseAt = 0
    this.catapultFired = -100
    if (this.rainUntil > 0 && this.game.weather.state === 'rain') this.game.weather.unlock()
    this.rainUntil = 0
  }
}
