import * as THREE from 'three'
import { Minigame } from './Minigame'
import { palette } from '../core/palette'
import { clamp, formatTime, lineIntersectsCircle } from '../core/maths'
import { chamferedBox, rampGeometry } from '../world/geometry'
import { textTexture } from '../world/materials'
import type { Bin } from '../core/Disposal'
import type { Game } from '../Game'
import type { MinigameId } from '@/content/world'
import { districtById } from '@/content/world'

/* ============================================================
   ORDER RUSH

   The exchange landmark is already an order book: a teal wall of
   BUY levels, a vermilion wall of SELL levels, and a raised
   matching engine down the middle. This mode makes the engine
   drivable and runs a sequence of gates along it — BUY, LIMIT,
   MATCH, SELL — alternating sides, so clearing the book is a
   weave rather than a straight line.

   Three decisions worth naming:

   1. THE ENGINE IS TOO NARROW TO PLAY ON, so this lays a deck
      flush with it. As built the platform is 5.4 m wide; the car
      is about 2 m. There is no weave available in 5.4 m, and
      falling off a 1.2 m ledge every few seconds is not a game.
      The deck is 8.4 m and stops 10 cm short of both walls, so
      the book's own levels become the run's barriers — but only
      along the 20 m the book spans. The deck runs 32 m, so the
      outer gates sit past the last level with nothing at the
      edge, which is where a run is actually lost. It is
      permanent world geometry rather than something the mode
      switches on, because a surface you can learn between
      attempts is worth more than the tidiness of hiding it.
   2. THE CLOCK RUNS DOWN, NOT UP. You start with twelve seconds
      and every gate buys back 3.6, capped so the bank cannot be
      hoarded. Running out ends the round. The recorded score is
      still the elapsed time, so a best time persists and the
      countdown only decides whether you finish at all.
   3. ANTI-SKIP IS THE SAME ONE LINE AS THE CIRCUIT. Only the
      gate currently held as target can register; every other
      gate is inert, and there is no direction check. That leaves
      the return leg open on purpose — reversing the length of
      the book is shorter, looping around the outside on boost is
      faster, and both are legal.

   The gate test is the same pair the circuit uses: a small
   proximity disc plus a swept segment crossing. The disc half is
   `lineIntersectsCircle` from core/maths; the crossing has no
   shared home yet — the circuit's copy is module-private — so it
   is at the bottom of this file.
   ============================================================ */

/** Gates per lap, one full BUY → LIMIT → MATCH → SELL cycle. */
const GATES_PER_LAP = 4
const LAPS = 3
const TOTAL_GATES = GATES_PER_LAP * LAPS

/** Seconds on the clock at the opening bell. */
const START_SECONDS = 12
/** Seconds returned by each gate. */
const GATE_BONUS = 3.6
/** The bank cannot exceed this, so a clean deck pass is not a hoard. */
const CLOCK_CAP = 12
/** Held at the start line while the camera settles. */
const ARMING = 1.6

const DECK_HALF_WIDTH = 4.2
const DECK_HALF_LENGTH = 16
/** Six centimetres proud of the landmark's own platform, to avoid z-fighting. */
const DECK_HEIGHT = 1.26
const RAMP_LENGTH = 7

/** Inner and outer ends of a gate line, as distance from the centreline. */
const GATE_INNER = 1.6
const GATE_OUTER = 4.0
/**
 * Proximity radius. Deliberately far smaller than the circuit's 2 m:
 * the whole point here is that the centreline misses every gate, and
 * a generous disc would hand the player a straight line through the
 * book. The swept test below does the real work.
 */
const GATE_RADIUS = 0.6

const BAR_HEIGHT = 3.2
const BEACON_HEIGHT = 13

type GateRole = 'target' | 'next' | 'idle'

interface GateSpec {
  label: string
  /** -1 is the BUY wall's side, +1 the SELL wall's. */
  side: -1 | 1
  /** Offset along the run, in district space. +Z is south. */
  z: number
  colour: string
}

/**
 * BUY and SELL sit under their own wall; LIMIT and MATCH take
 * whichever side keeps the alternation going.
 */
const GATE_SPECS: GateSpec[] = [
  { label: 'BUY', side: -1, z: 12, colour: palette.signalSoft },
  { label: 'LIMIT', side: 1, z: 4, colour: palette.chalk2 },
  { label: 'MATCH', side: -1, z: -4, colour: palette.chalk },
  { label: 'SELL', side: 1, z: -12, colour: palette.accentSoft },
]

interface Gate {
  spec: GateSpec
  /** Middle of the gate line, on the deck surface. */
  centre: THREE.Vector3
  /** Endpoints of the gate line in world XZ. */
  a: THREE.Vector2
  b: THREE.Vector2
  bars: THREE.Mesh[]
  beacon: THREE.Mesh
  stripe: THREE.Mesh
}

export class OrderRush extends Minigame {
  readonly id: MinigameId = 'orderRush'
  readonly title = 'ORDER RUSH'

  private gates: Gate[] = []
  private filled = 0
  private remaining = START_SECONDS
  private arming = 0
  /** True only while the gates should be lit and answering. */
  private live = false
  /** Whole seconds left at the last warning chirp. */
  private warnedAt = 0

  private group = new THREE.Group()
  private startPosition = new THREE.Vector3()
  private startRotation = Math.PI / 2

  private dimMaterial!: THREE.Material

  private readonly previous2 = new THREE.Vector2()
  private readonly current2 = new THREE.Vector2()
  /** False on the frame after a teleport, when there is no path to sweep. */
  private hasPrevious = false

  constructor(game: Game, bin: Bin) {
    super(game, bin)
    // The whole run fits inside the district, so straying is unambiguous.
    this.abandonRadius = 130
  }

  /* ========================================================
     BUILD
     ======================================================== */

  build(): void {
    // The landmark stands on the district's centre, so district
    // coordinates and landmark coordinates are the same thing here.
    const district = districtById.stock
    const cx = district.x
    const cz = district.z
    const baseY = this.game.world.terrain.colliderHeightAt(cx, cz)
    const deckY = baseY + DECK_HEIGHT

    this.dimMaterial = this.game.materials.flat(palette.ink3)

    this.buildDeck(cx, cz, baseY)
    this.buildRamps(cx, cz, baseY)
    this.buildGates(cx, cz, deckY)

    this.startPosition.set(cx, baseY + 2, cz + DECK_HALF_LENGTH + RAMP_LENGTH + 4)

    this.game.renderer.scene.add(this.group)
    this.bin.object3D(this.group)

    this.applyRoles()
  }

  private buildDeck(cx: number, cz: number, baseY: number): void {
    const geometry = chamferedBox(
      DECK_HALF_WIDTH * 2,
      DECK_HEIGHT,
      DECK_HALF_LENGTH * 2,
      0.12,
    )
    const mesh = new THREE.Mesh(geometry, this.game.materials.get('graphite'))
    mesh.position.set(cx, baseY + DECK_HEIGHT / 2, cz)
    mesh.castShadow = this.game.quality.settings.shadows
    mesh.receiveShadow = this.game.quality.settings.shadows
    this.group.add(mesh)
    this.bin.add(() => geometry.dispose())

    this.game.physics.add({
      type: 'fixed',
      category: 'floor',
      position: { x: cx, y: baseY + DECK_HEIGHT / 2, z: cz },
      friction: 1,
      restitution: 0,
      colliders: [
        {
          shape: 'cuboid',
          parameters: [DECK_HALF_WIDTH, DECK_HEIGHT / 2, DECK_HALF_LENGTH],
        },
      ],
    })

    // Two lit edges. A dark deck at night has no readable width
    // otherwise, and the width is the whole game.
    const edgeGeometry = new THREE.BoxGeometry(0.18, 0.09, DECK_HALF_LENGTH * 2)
    this.bin.add(() => edgeGeometry.dispose())
    for (const side of [-1, 1]) {
      const edge = new THREE.Mesh(edgeGeometry, this.game.materials.flat(palette.chalk3))
      edge.position.set(cx + side * (DECK_HALF_WIDTH - 0.1), baseY + DECK_HEIGHT + 0.045, cz)
      this.group.add(edge)
    }

    this.deckText(cx, baseY + DECK_HEIGHT, cz + 14, 'MATCHING ENGINE', 0.8, palette.chalk3)
    this.deckText(cx, baseY + DECK_HEIGHT, cz - 14, 'PRICE-TIME PRIORITY', 0.68, palette.chalk3)
  }

  private buildRamps(cx: number, cz: number, baseY: number): void {
    const lipGeometry = new THREE.BoxGeometry(DECK_HALF_WIDTH * 2, 0.1, 0.4)
    this.bin.add(() => lipGeometry.dispose())

    for (const side of [-1, 1] as const) {
      const { geometry, hull } = rampGeometry(RAMP_LENGTH, DECK_HALF_WIDTH * 2, DECK_HEIGHT)
      // A ramp rises along its own +X, and a Y rotation maps +X to
      // (cos, -sin) in XZ — so +PI/2 climbs towards -Z and -PI/2
      // towards +Z. Each ramp sits on the far side of the deck edge
      // it serves, so it must climb back towards the centre: the
      // ramp at -Z climbs to +Z, and the one at +Z climbs to -Z.
      const rotation = side < 0 ? -Math.PI / 2 : Math.PI / 2
      const z = cz + side * (DECK_HALF_LENGTH + RAMP_LENGTH / 2)

      const mesh = new THREE.Mesh(geometry, this.game.materials.get('graphite'))
      mesh.position.set(cx, baseY, z)
      mesh.rotation.y = rotation
      mesh.castShadow = this.game.quality.settings.shadows
      mesh.receiveShadow = this.game.quality.settings.shadows
      this.group.add(mesh)
      this.bin.add(() => geometry.dispose())

      this.game.physics.add({
        type: 'fixed',
        category: 'floor',
        position: { x: cx, y: baseY, z },
        rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotation, 0)),
        friction: 0.95,
        restitution: 0.02,
        colliders: [{ shape: 'hull', parameters: [hull] }],
      })

      const lip = new THREE.Mesh(lipGeometry, this.game.materials.flat(palette.chalk3))
      lip.position.set(cx, baseY + DECK_HEIGHT + 0.05, cz + side * DECK_HALF_LENGTH)
      this.group.add(lip)
    }
  }

  private buildGates(cx: number, cz: number, deckY: number): void {
    const span = GATE_OUTER - GATE_INNER

    const barGeometry = new THREE.BoxGeometry(0.12, BAR_HEIGHT, 0.12)
    barGeometry.translate(0, BAR_HEIGHT / 2, 0)
    this.bin.add(() => barGeometry.dispose())

    const beaconGeometry = new THREE.BoxGeometry(0.16, BEACON_HEIGHT, 0.16)
    beaconGeometry.translate(0, BEACON_HEIGHT / 2, 0)
    this.bin.add(() => beaconGeometry.dispose())

    const stripeGeometry = new THREE.PlaneGeometry(span, 0.34)
    stripeGeometry.rotateX(-Math.PI / 2)
    this.bin.add(() => stripeGeometry.dispose())

    // Only the two end bars are load-bearing for reading the gate's
    // width; the ones between are decoration and can thin out.
    const interior = this.game.quality.count(3, 1)
    const barCount = interior + 2

    for (const spec of GATE_SPECS) {
      const z = cz + spec.z
      const inner = new THREE.Vector3(cx + spec.side * GATE_INNER, deckY, z)
      const outer = new THREE.Vector3(cx + spec.side * GATE_OUTER, deckY, z)

      const bars: THREE.Mesh[] = []
      for (let i = 0; i < barCount; i++) {
        const bar = new THREE.Mesh(barGeometry, this.dimMaterial)
        bar.position.lerpVectors(inner, outer, i / (barCount - 1))
        this.group.add(bar)
        bars.push(bar)
      }

      // The beacon is how you find the next gate from outside the
      // book: it clears the tallest level in either wall by six
      // metres, so the return leg never needs a map.
      const beacon = new THREE.Mesh(beaconGeometry, this.game.materials.flat(spec.colour))
      beacon.position.set(cx + spec.side * (GATE_OUTER + 0.05), deckY, z)
      beacon.visible = false
      this.group.add(beacon)

      const stripe = new THREE.Mesh(stripeGeometry, this.dimMaterial)
      stripe.position.set(cx + spec.side * (GATE_INNER + span / 2), deckY + 0.02, z)
      stripe.renderOrder = 2
      this.group.add(stripe)

      this.deckText(
        cx + spec.side * (GATE_INNER + span / 2),
        deckY,
        z + 2.4,
        spec.label,
        0.7,
        spec.colour,
      )

      this.gates.push({
        spec,
        centre: new THREE.Vector3().lerpVectors(inner, outer, 0.5),
        a: new THREE.Vector2(inner.x, inner.z),
        b: new THREE.Vector2(outer.x, outer.z),
        bars,
        beacon,
        stripe,
      })
    }
  }

  /**
   * Text painted flat on the deck. Rotating the plane -90° about X
   * puts its up-axis along -Z, which is the direction of the run —
   * so the copy reads the right way round to a driver heading north.
   */
  private deckText(
    x: number,
    y: number,
    z: number,
    text: string,
    height: number,
    color: string,
  ): void {
    const { texture, aspect } = textTexture({
      text,
      size: 64,
      color,
      letterSpacing: 0.16,
      weight: 600,
    })
    this.bin.add(() => texture.dispose())

    const geometry = new THREE.PlaneGeometry(height * aspect, height)
    geometry.rotateX(-Math.PI / 2)
    const mesh = new THREE.Mesh(
      geometry,
      this.game.materials.own(
        new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
    )
    mesh.position.set(x, y + 0.03, z)
    mesh.renderOrder = 3
    this.group.add(mesh)
    this.bin.add(() => geometry.dispose())
  }

  /* ========================================================
     GATE APPEARANCE
     ======================================================== */

  private applyRoles(): void {
    const target = this.filled % GATES_PER_LAP
    const next = (this.filled + 1) % GATES_PER_LAP

    this.gates.forEach((gate, index) => {
      const role: GateRole = !this.live
        ? 'idle'
        : index === target
          ? 'target'
          : index === next
            ? 'next'
            : 'idle'
      this.setGateLook(gate, role)
    })
  }

  private setGateLook(gate: Gate, role: GateRole): void {
    const lit = role !== 'idle'
    const material = lit ? this.game.materials.flat(gate.spec.colour) : this.dimMaterial
    // The gate after the target is shown at half height: you need to
    // see the next side to plan the weave, without mistaking it for
    // the one that counts.
    const scale = role === 'target' ? 1 : role === 'next' ? 0.55 : 0.3

    for (const bar of gate.bars) {
      bar.material = material
      bar.scale.y = scale
    }
    gate.stripe.material = material
    gate.beacon.visible = role === 'target'
  }

  private animateTarget(): void {
    if (!this.live) return
    const gate = this.gates[this.filled % GATES_PER_LAP]
    if (!gate) return
    const t = this.game.ticker.elapsedScaled
    const pulse = 1 + Math.sin(t * 6) * 0.09
    for (const bar of gate.bars) bar.scale.y = pulse
    gate.beacon.scale.y = 1 + Math.sin(t * 3) * 0.05
  }

  /* ========================================================
     LIFECYCLE
     ======================================================== */

  start(): boolean {
    if (this.running) return true

    this.reset()
    this.state = 'countdown'
    this.arming = ARMING
    this.elapsed = 0
    this.remaining = START_SECONDS
    this.warnedAt = Math.ceil(START_SECONDS)
    this.origin.copy(this.startPosition)

    // This override never reaches `super.start()`, so the one thing
    // the base class does before a run has to be repeated: an
    // overlay that filtered the driving controls may still have them
    // held, and a countdown you cannot drive out of is a lost round.
    this.game.inputs.setFilters([])

    this.game.player.setState('locked')
    this.game.vehicle.moveTo(this.startPosition, this.startRotation)
    this.game.view.focusPoint.trackedPosition.copy(this.startPosition)
    this.game.view.snapToTarget()

    this.live = true
    this.applyRoles()
    this.publish()
    this.events.trigger('start')
    return true
  }

  cancel(reason: 'player' | 'strayed' | 'respawn' = 'player'): void {
    // `finish` leaves its card up for five seconds and never calls
    // `reset`, so ESCAPE has to reach a finished round too — otherwise
    // the result hangs over the world until the timer decides.
    if (!this.running && this.state !== 'finished') return
    this.state = 'idle'
    this.reset()
    this.game.store.getState().setMinigame(null)
    this.events.trigger('cancel', [reason])
  }

  protected reset(): void {
    this.filled = 0
    this.remaining = START_SECONDS
    this.arming = 0
    this.live = false
    this.hasPrevious = false
    this.applyRoles()
    this.game.player.setState('default')
  }

  /* ========================================================
     TICK
     ======================================================== */

  update(delta: number): void {
    this.animateTarget()
    if (!this.running) return

    if (this.state === 'countdown') {
      this.arming -= delta
      if (this.arming <= 0) {
        this.state = 'running'
        this.elapsed = 0
        this.game.player.setState('default')
      }
      this.publish()
      return
    }

    super.update(delta)
  }

  protected tick(delta: number): void {
    const position = this.game.player.position

    // The only fall worth catching is a fall out of the world. Coming
    // off the side of the deck is a 1.26 m drop onto the ground you
    // drove in on, and driving back round is the penalty.
    const ground = this.game.world.terrain.colliderHeightAt(position.x, position.z)
    if (position.y < ground - 6) {
      this.returnToRun()
      return
    }

    this.remaining -= delta
    if (this.remaining <= 0) {
      this.remaining = 0
      this.expire()
      return
    }
    this.warn()

    this.current2.set(position.x, position.z)
    const target = this.gates[this.filled % GATES_PER_LAP]
    const reached = this.hasReached(target)

    this.previous2.copy(this.current2)
    this.hasPrevious = true
    if (reached) this.registerFill()
  }

  /**
   * The circuit's pair of tests. The swept crossing is what matters:
   * only a path that actually passes through the half of the deck
   * this gate occupies counts, which is what forces the weave.
   */
  private hasReached(gate: Gate): boolean {
    if (lineIntersectsCircle(gate.a, gate.b, this.current2, GATE_RADIUS)) return true
    if (!this.hasPrevious) return false
    return segmentsCross(this.previous2, this.current2, gate.a, gate.b)
  }

  private registerFill(): void {
    this.filled++
    this.remaining = Math.min(CLOCK_CAP, this.remaining + GATE_BONUS)
    this.warnedAt = Math.ceil(this.remaining)

    // The same rising ladder as the circuit's gates, so a clean run
    // through the book climbs audibly.
    this.game.audio?.blip(1 + (this.filled - 1) * 0.05)

    if (this.filled >= TOTAL_GATES) {
      this.complete()
      return
    }
    this.applyRoles()
  }

  /** One chirp per whole second under four. */
  private warn(): void {
    if (this.remaining > 4) return
    const second = Math.ceil(this.remaining)
    if (second >= this.warnedAt) return
    this.warnedAt = second
    this.game.audio?.blip(0.55)
  }

  private complete(): void {
    const time = this.elapsed
    this.live = false
    this.applyRoles()
    this.game.achievements.set('orderRush', 1)
    this.finish(time)
  }

  private expire(): void {
    this.live = false
    this.applyRoles()
    this.game.audio?.play('fail')
    this.fail('ORDER EXPIRED')
  }

  /** Puts the car back on the deck, pointed at the gate it still owes. */
  private returnToRun(): void {
    const target = this.gates[this.filled % GATES_PER_LAP]
    const behind = this.filled === 0
      ? this.startPosition.clone()
      : new THREE.Vector3(
        target.centre.x,
        target.centre.y + 1.6,
        target.centre.z + 4,
      )

    const rotation = Math.atan2(
      -(target.centre.z - behind.z),
      target.centre.x - behind.x,
    )
    this.game.vehicle.moveTo(behind, rotation)
    this.game.view.focusPoint.trackedPosition.copy(behind)
    this.game.view.snapToTarget()
    // The teleport is not a path the car drove. Sweeping it would run
    // a segment the length of the deck through the target and hand
    // back the gate that was just missed.
    this.hasPrevious = false
  }

  /* ========================================================
     HUD
     ======================================================== */

  /**
   * `finish` and `fail` write the closing card themselves, and the
   * base class publishes once more on its way out of `tick` — which
   * would paint the live readout straight back over it.
   */
  protected publish(): void {
    if (this.state !== 'running' && this.state !== 'countdown') return
    super.publish()
  }

  protected hint(): string {
    return 'GATES BUY TIME'
  }

  protected lines(): string[] {
    const open = TOTAL_GATES - this.filled
    const book = `FILLED ${this.filled}/${TOTAL_GATES}   OPEN ${open}`

    if (this.state === 'countdown') {
      return ['OPENING BELL', book, this.hint()]
    }

    const next = this.gates[this.filled % GATES_PER_LAP]
    return [
      `${this.remaining.toFixed(1)}S`,
      book,
      `${formatTime(this.elapsed)}   NEXT ${next.spec.label}`,
    ]
  }

  protected progress(): number | null {
    if (this.state === 'countdown') return null
    return clamp(this.filled / TOTAL_GATES, 0, 1)
  }
}

/* ============================================================
   GEOMETRY
   ============================================================ */

/** Do segments p1–p2 and p3–p4 cross? The swept half of the gate test. */
function segmentsCross(
  p1: THREE.Vector2,
  p2: THREE.Vector2,
  p3: THREE.Vector2,
  p4: THREE.Vector2,
): boolean {
  const d1x = p2.x - p1.x
  const d1y = p2.y - p1.y
  const d2x = p4.x - p3.x
  const d2y = p4.y - p3.y

  const denominator = d1x * d2y - d1y * d2x
  if (Math.abs(denominator) < 1e-9) return false

  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denominator
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denominator
  return t >= 0 && t <= 1 && u >= 0 && u <= 1
}
