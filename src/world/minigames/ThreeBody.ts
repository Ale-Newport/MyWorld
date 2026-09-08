import * as THREE from 'three'
import { Minigame } from './Minigame'
import { palette } from '../core/palette'
import { clamp } from '../core/maths'
import { textTexture } from '../world/materials'
import type { Bin } from '../core/Disposal'
import type { Game } from '../Game'
import type { MinigameId } from '@/content/world'
import { landmarkById } from '@/content/world'

/* ============================================================
   THREE BODY PROBLEM

   The exhibit above the ORBIT district, running the same simulation
   as the project it advertises (`three-body-problem`, linked from
   the `orbit-system` landmark): velocity Verlet, softened gravity,
   the figure-eight preset, a live energy readout. The masses are
   integrated every frame and the HUD reads out of the integrator.

   Three decisions are worth explaining.

   1. THE DEFAULT STATE IS CALM AND STAYS CALM. The initial
      conditions are Chenciner and Montgomery's figure-eight (the
      numerical values are Simó's, and are the same ones the real
      project ships as a preset). They are a genuinely periodic
      solution, so the exhibit loops forever with no bookkeeping.
      Integrated on a fixed 0.005 step with softening 0.03, eighty
      orbits drift by 1.6e-3 per cent of total energy and the peak
      separation never leaves 2.008. That margin is why the escape
      threshold below can sit at 2.5 without ever tripping itself.

   2. A NUDGE IS FOLLOWED BY A BOOST INTO THE BARYCENTRE FRAME.
      Kicking one body adds net momentum, and a system with net
      momentum sails out of its own display volume. Subtracting the
      centre-of-mass velocity from all three is a Galilean boost:
      separations, internal energy and the character of the motion
      are untouched, and the exhibit stays where it was built.

   3. IT CANNOT BE LEFT BROKEN. Cancelling restores the initial
      conditions (the base class calls `reset` on every exit route),
      destabilising it schedules a restore a few seconds later, and
      a body that falls towards the play area or flies past the
      display volume restores immediately.

   The bodies are decoration with no colliders. They hang sixteen
   metres up, above everything the car can reach.
   ============================================================ */

/** The landmark this exhibit stands on. Both the ENTER that starts a
 *  run and the ENTER that nudges arrive as this id. */
const LANDMARK_ID = 'orbit-system'

/* ---- the simulation ------------------------------------- */

/**
 * Figure-eight initial conditions for three equal masses with
 * G = 1, m = 1. Chenciner & Montgomery (2000); numerical values as
 * tabulated by Simó. Period 6.32591398.
 */
const FIGURE_EIGHT = {
  px: [0.97000436, -0.97000436, 0],
  py: [-0.24308753, 0.24308753, 0],
  vx: [0.466203685, 0.466203685, -0.93240737],
  vy: [0.43236573, 0.43236573, -0.86473146],
} as const

const PERIOD = 6.32591398
/** Wall seconds one orbit takes. Slow enough to read the shape. */
const ORBIT_SECONDS = 9
/** Simulation units per real second. */
const RATE = PERIOD / ORBIT_SECONDS

/** Fixed integrator step, in simulation units. */
const SUB_DT = 0.005
/** Never integrate more than this in one frame; drop the backlog instead. */
const MAX_SUBSTEPS = 12
/** A stalled tab must not teleport the orbit. */
const MAX_FRAME = 0.05

/** Plummer softening. Small enough to leave the orbit alone, large
 *  enough that a close encounter after a nudge cannot divide by zero. */
const SOFTENING2 = 0.03 * 0.03

/* ---- what counts as destabilised ------------------------ */

/** The undisturbed system peaks at 2.008. Anything past this left. */
const ESCAPE_SEPARATION = 2.5
/** Total energy above this and the three are no longer bound to each other. */
const UNBOUND_ENERGY = -0.85
/** Where the progress bar starts filling. */
const CALM_SEPARATION = 2.05

/** One press adds nine per cent to the vermilion body's speed. */
const NUDGE = 0.09
const NUDGED_BODY = 0
/** Seconds between accepted nudges. Also swallows the press that starts the run. */
const NUDGE_COOLDOWN = 0.5

/* ---- placement ------------------------------------------ */

/** Metres per simulation unit. The orbit is two units across. */
const SPAN = 5.5
/** Height of the barycentre above the terrain. */
const CENTRE_Y = 16
/** Lean of the orbital plane away from vertical, radians. Chosen so
 *  the chase camera — which sits about level with the exhibit — looks
 *  nearly square onto the figure eight rather than along its edge. */
const TILT = 0.45
const COS_TILT = Math.cos(TILT)

/** A body below this height is heading for the play area: restore. */
const FLOOR_CLEARANCE = 6
/** Simulation units from the barycentre before we restore. */
const RESTORE_RADIUS = 4

/** Beyond this the exhibit is not on screen, so it is not integrated. */
const WATCH_RANGE = 200

/** One trail sample every this many simulation units. Sampling on
 *  simulation time rather than on frames keeps the trail the same
 *  length on a 30 Hz phone and a 144 Hz desktop. */
const TRAIL_INTERVAL = 0.045

interface SystemState {
  px: number[]
  py: number[]
  vx: number[]
  vy: number[]
  ax: number[]
  ay: number[]
}

interface Body {
  mesh: THREE.Mesh
  /** The trail's position buffer, oldest sample first. */
  samples: Float32Array
  attribute: THREE.BufferAttribute
}

export class ThreeBody extends Minigame {
  readonly id: MinigameId = 'threeBody'
  readonly title = 'THREE BODY PROBLEM'

  private group = new THREE.Group()
  /** Child of `group`: its local XY plane is the orbital plane. */
  private plane = new THREE.Group()
  private bodies: Body[] = []

  private system = createState()
  private accumulator = 0
  private trailClock = 0
  private trailPoints = 0

  private baseEnergy = 0
  private peakSeparation = 0
  private nudges = 0
  private nudgeLockout = 0

  /** HUD strings, refreshed about ten times a second so they can be read. */
  private readout: string[] = []
  private readoutAt = -1

  private readonly centre = new THREE.Vector3()

  constructor(game: Game, bin: Bin) {
    super(game, bin)
    // Tight enough that leaving the district restores the exhibit,
    // loose enough that circling it does not.
    this.abandonRadius = 70
  }

  /* ========================================================
     BUILD
     ======================================================== */

  build(): void {
    const landmark = landmarkById[LANDMARK_ID]
    const groundY = this.game.world.terrain.colliderHeightAt(landmark.x, landmark.z)

    this.group.position.set(landmark.x, groundY, landmark.z)
    this.centre.set(landmark.x, groundY + CENTRE_Y, landmark.z)

    this.plane.position.y = CENTRE_Y
    this.plane.rotation.x = TILT
    this.group.add(this.plane)

    this.baseEnergy = totalEnergy(this.system)

    this.buildMast()
    this.buildGhostOrbit()
    this.buildBarycentre()
    this.buildBodies()

    this.game.renderer.scene.add(this.group)
    this.bin.object3D(this.group)

    this.restore()
    this.refreshReadout()

    // The simulation belongs to the world, not to the run: it is
    // turning over whether or not anyone has pressed ENTER. Order 12
    // puts it before the mini-game manager's own tick, so the HUD
    // publishes this frame's numbers rather than last frame's.
    const step = () => this.simulate(Math.min(this.game.ticker.delta, MAX_FRAME))
    this.game.ticker.events.on('tick', step, 12)

    // ENTER at the landmark. Routed through the interaction system
    // rather than the raw input, so a nudge can only come from
    // someone standing at the landmark with no overlay open.
    const onInteract = (id: string) => {
      if (id !== LANDMARK_ID || this.state !== 'running') return
      this.nudge()
    }
    this.game.interactions.events.on('interact', onInteract as never)

    this.bin.add(() => {
      this.game.ticker.events.off('tick', step)
      this.game.interactions.events.off('interact', onInteract as never)
    })
  }

  /** A mast from the top of the monument up to the barycentre. */
  private buildMast(): void {
    const base = 5.2
    const height = CENTRE_Y - base
    const geometry = new THREE.CylinderGeometry(0.07, 0.09, height, 8, 1)
    const mesh = new THREE.Mesh(geometry, this.game.materials.get('metal'))
    mesh.position.y = base + height / 2
    this.group.add(mesh)
    this.bin.add(() => geometry.dispose())

    const { texture, aspect } = textTexture({
      text: 'VELOCITY VERLET',
      sublines: ['G = 1 · m = 1 · SOFTENED'],
      size: 64,
      color: palette.ink3,
      letterSpacing: 0.12,
      weight: 600,
    })
    this.bin.add(() => texture.dispose())

    const plateHeight = 0.8
    const plate = new THREE.PlaneGeometry(plateHeight * aspect, plateHeight)
    const label = new THREE.Mesh(
      plate,
      this.game.materials.own(
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }),
      ),
    )
    label.position.set(0, base + 1.1, 0.36)
    this.group.add(label)
    this.bin.add(() => plate.dispose())
  }

  /**
   * The unperturbed orbit, drawn once as a faint ghost. All three
   * bodies trace the same curve, so one line serves for all three —
   * and once a nudge lands you can see exactly how far the real
   * bodies have wandered off the path they should be on.
   */
  private buildGhostOrbit(): void {
    const scratch = createState()
    computeAccelerations(scratch)

    const steps = Math.round(PERIOD / SUB_DT)
    const stride = 6
    const points: number[] = []
    for (let i = 0; i < steps; i++) {
      if (i % stride === 0) points.push(scratch.px[0] * SPAN, scratch.py[0] * SPAN, 0)
      integrate(scratch, SUB_DT)
    }
    // Close the loop back onto the first sample.
    points.push(points[0], points[1], points[2])

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
    const line = new THREE.Line(geometry, this.game.materials.get('lineChalk'))
    this.plane.add(line)
    this.bin.add(() => geometry.dispose())
  }

  /** A ring on the barycentre — the point all three keep falling past. */
  private buildBarycentre(): void {
    const geometry = new THREE.RingGeometry(0.78, 0.9, 40)
    const mesh = new THREE.Mesh(
      geometry,
      this.game.materials.own(
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(palette.ink3),
          transparent: true,
          opacity: 0.34,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      ),
    )
    this.plane.add(mesh)
    this.bin.add(() => geometry.dispose())
  }

  private buildBodies(): void {
    // Vermilion is the one ENTER kicks, so it is named in the HUD.
    // Green is the district's own accent; the third is graphite so
    // all three stay legible against a pale sky and a dark one.
    const colours = [palette.accent, palette.signal, palette.ink2]

    const detail = this.game.quality.settings.density > 0.5 ? 1 : 0
    const sphere = new THREE.IcosahedronGeometry(0.62, detail)
    this.bin.add(() => sphere.dispose())

    this.trailPoints = this.game.quality.count(110, 48)

    for (const colour of colours) {
      const mesh = new THREE.Mesh(sphere, this.game.materials.flat(colour))
      this.plane.add(mesh)

      const samples = new Float32Array(this.trailPoints * 3)
      const attribute = new THREE.BufferAttribute(samples, 3)
      attribute.setUsage(THREE.DynamicDrawUsage)

      // Static ramp: index 0 is the oldest sample and fades out, the
      // last index is where the body is now.
      const fade = new Float32Array(this.trailPoints)
      for (let i = 0; i < this.trailPoints; i++) fade[i] = i / (this.trailPoints - 1)

      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', attribute)
      geometry.setAttribute('aFade', new THREE.BufferAttribute(fade, 1))
      this.bin.add(() => geometry.dispose())

      const line = new THREE.Line(geometry, this.trailMaterial(colour))
      // The bounding sphere is computed from the buffer's first state
      // and the buffer then moves under it, so culling would blink the
      // trail out. Three lines are not worth a per-frame recompute.
      line.frustumCulled = false
      this.plane.add(line)

      this.bodies.push({ mesh, samples, attribute })
    }
  }

  /** Per-vertex alpha, which a LineBasicMaterial cannot do. */
  private trailMaterial(colour: string): THREE.ShaderMaterial {
    return this.game.materials.own(
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uColor: { value: new THREE.Color(colour) } },
        vertexShader: /* glsl */ `
          attribute float aFade;
          varying float vFade;
          void main() {
            vFade = aFade;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          varying float vFade;
          uniform vec3 uColor;
          void main() {
            // Squared, so the tail disappears rather than stopping.
            float alpha = vFade * vFade * 0.9;
            if (alpha < 0.02) discard;
            gl_FragColor = vec4(uColor, alpha);
            #include <colorspace_fragment>
          }
        `,
      }),
    )
  }

  /* ========================================================
     SIMULATION
     ======================================================== */

  private simulate(delta: number): void {
    if (this.nudgeLockout > 0) this.nudgeLockout = Math.max(0, this.nudgeLockout - delta)

    // Nobody is watching, so nothing needs integrating. A periodic
    // orbit resumed at the wrong phase is indistinguishable from one
    // that never stopped.
    const watched = this.running || this.centre.distanceTo(this.game.player.position) < WATCH_RANGE
    this.group.visible = watched
    if (!watched) return

    this.accumulator += delta * RATE
    let steps = 0
    while (this.accumulator >= SUB_DT && steps < MAX_SUBSTEPS) {
      this.accumulator -= SUB_DT
      steps++
      integrate(this.system, SUB_DT)
      this.trailClock += SUB_DT
      if (this.trailClock >= TRAIL_INTERVAL) {
        this.trailClock -= TRAIL_INTERVAL
        this.pushTrail()
      }
    }
    // A backlog we can never pay off is worse than a skipped step.
    if (this.accumulator > SUB_DT) this.accumulator = 0

    for (let i = 0; i < this.bodies.length; i++) {
      this.bodies[i].mesh.position.set(this.system.px[i] * SPAN, this.system.py[i] * SPAN, 0)
    }

    const separation = maxSeparation(this.system)
    if (separation > this.peakSeparation) this.peakSeparation = separation

    if (this.outOfBounds()) {
      this.restore()
      return
    }

    if (this.game.ticker.elapsed - this.readoutAt > 0.1) this.refreshReadout()
  }

  /** Shift each trail one sample along and write the head. */
  private pushTrail(): void {
    for (let i = 0; i < this.bodies.length; i++) {
      const body = this.bodies[i]
      const samples = body.samples
      samples.copyWithin(0, 3)
      const head = samples.length - 3
      samples[head] = this.system.px[i] * SPAN
      samples[head + 1] = this.system.py[i] * SPAN
      samples[head + 2] = 0
      body.attribute.needsUpdate = true
    }
  }

  /**
   * True when the system has left the volume the exhibit occupies —
   * either flung wide, or falling towards the road. Both restore.
   */
  private outOfBounds(): boolean {
    for (let i = 0; i < 3; i++) {
      const x = this.system.px[i]
      const y = this.system.py[i]
      if (!Number.isFinite(x) || !Number.isFinite(y)) return true
      if (Math.hypot(x, y) > RESTORE_RADIUS) return true
      if (CENTRE_Y + y * SPAN * COS_TILT < FLOOR_CLEARANCE) return true
    }
    return false
  }

  /** Back to the figure eight, with the trails collapsed onto it. */
  private restore(): void {
    const s = this.system
    for (let i = 0; i < 3; i++) {
      s.px[i] = FIGURE_EIGHT.px[i]
      s.py[i] = FIGURE_EIGHT.py[i]
      s.vx[i] = FIGURE_EIGHT.vx[i]
      s.vy[i] = FIGURE_EIGHT.vy[i]
    }
    computeAccelerations(s)

    this.accumulator = 0
    this.trailClock = 0
    this.peakSeparation = maxSeparation(s)
    this.nudges = 0

    for (let i = 0; i < this.bodies.length; i++) {
      const body = this.bodies[i]
      const x = s.px[i] * SPAN
      const y = s.py[i] * SPAN
      body.mesh.position.set(x, y, 0)
      // Every sample on the body: a collapsed trail draws nothing,
      // where a zeroed one would draw a line to the barycentre.
      for (let k = 0; k < this.trailPoints; k++) {
        body.samples[k * 3] = x
        body.samples[k * 3 + 1] = y
        body.samples[k * 3 + 2] = 0
      }
      body.attribute.needsUpdate = true
    }

    this.refreshReadout()
  }

  /* ========================================================
     INTERACTION
     ======================================================== */

  private nudge(): void {
    if (this.nudgeLockout > 0) return
    this.nudgeLockout = NUDGE_COOLDOWN

    const s = this.system
    s.vx[NUDGED_BODY] *= 1 + NUDGE
    s.vy[NUDGED_BODY] *= 1 + NUDGE

    // Boost back into the barycentre frame — see the note at the top.
    let cx = 0
    let cy = 0
    for (let i = 0; i < 3; i++) {
      cx += s.vx[i]
      cy += s.vy[i]
    }
    cx /= 3
    cy /= 3
    for (let i = 0; i < 3; i++) {
      s.vx[i] -= cx
      s.vy[i] -= cy
    }

    this.nudges++
    // Each nudge is 12% sharper than the last, so a run audibly builds.
    this.game.audio?.blip(1 + this.nudges * 0.12)
    this.refreshReadout()
  }

  /* ========================================================
     LIFECYCLE
     ======================================================== */

  start(): boolean {
    if (this.running) return true
    const started = super.start()
    // The ENTER that started the run must not also count as the first
    // nudge: the interaction system fires both in one press.
    this.nudgeLockout = NUDGE_COOLDOWN
    return started
  }

  /**
   * Wider than the base class's, which ignores a cancel once the run
   * has finished. Destabilising holds `finished` for five seconds
   * while the result card is up; without this, ESCAPE does nothing
   * during that window and `finish`'s delayed clear fires later and
   * wipes whatever HUD is up by then — including another game's, if
   * one has been started in the meantime.
   */
  cancel(reason: 'player' | 'strayed' | 'respawn' = 'player'): void {
    if (!this.running && this.state !== 'finished') return
    this.state = 'idle'
    this.reset()
    this.game.store.getState().setMinigame(null)
    this.events.trigger('cancel', [reason])
  }

  protected reset(): void {
    this.nudgeLockout = 0
    this.restore()
  }

  protected tick(delta: number): void {
    void delta
    if (this.state !== 'running') return

    const separation = maxSeparation(this.system)
    if (separation > ESCAPE_SEPARATION) {
      this.destabilised('ONE BODY EJECTED')
      return
    }
    if (totalEnergy(this.system) > UNBOUND_ENERGY) {
      this.destabilised('SYSTEM UNBOUND')
    }
  }

  private destabilised(reason: string): void {
    this.game.achievements.set('chaosTheory', 1)
    this.game.view.kick(0.3)
    this.game.audio?.blip(0.6)

    this.finish(null)

    // `finish` writes a generic COMPLETE card. The numbers are the
    // point of this one, so the result keeps them.
    this.game.store.getState().setMinigame({
      id: this.id,
      title: this.title,
      lines: [
        reason,
        `AFTER ${this.nudges} NUDGE${this.nudges === 1 ? '' : 'S'}`,
        `PEAK SEPARATION ${(this.peakSeparation * SPAN).toFixed(1)} m`,
      ],
      time: null,
      best: null,
      progress: 1,
    })

    // Long enough to watch it come apart, short enough that the
    // exhibit is calm again before anyone drives back. Skipped if a
    // new run has already begun, because starting one restores it.
    this.game.tweens.delay(2.6, () => {
      if (this.state === 'running') return
      this.restore()
    })
  }

  /* ========================================================
     HUD
     ======================================================== */

  /**
   * `destabilised` writes the closing card itself, and the base class
   * publishes once more on its way out of `tick` — which would paint
   * the live readout straight back over it.
   */
  protected publish(): void {
    if (!this.running) return
    super.publish()
  }

  private refreshReadout(): void {
    this.readoutAt = this.game.ticker.elapsed

    const separation = maxSeparation(this.system)
    const energy = totalEnergy(this.system)
    const drift = ((energy - this.baseEnergy) / Math.abs(this.baseEnergy)) * 100

    this.readout = [
      `SEPARATION ${(separation * SPAN).toFixed(1)} m`
      + `   PEAK ${(this.peakSeparation * SPAN).toFixed(1)} m`
      + `   ESCAPE ${(ESCAPE_SEPARATION * SPAN).toFixed(1)} m`,
      `ENERGY ${energy.toFixed(4)}   DRIFT ${drift >= 0 ? '+' : ''}${drift.toFixed(3)}%`,
    ]
  }

  protected lines(): string[] {
    const hint = this.hint()
    return hint ? [...this.readout, hint] : this.readout.slice()
  }

  protected hint(): string | null {
    return `ENTER · +${Math.round(NUDGE * 100)}% ON THE VERMILION BODY`
      + `   (${this.nudges} SO FAR)`
  }

  protected progress(): number | null {
    const separation = maxSeparation(this.system)
    const bySeparation =
      (separation - CALM_SEPARATION) / (ESCAPE_SEPARATION - CALM_SEPARATION)
    const byEnergy =
      (totalEnergy(this.system) - this.baseEnergy) / (UNBOUND_ENERGY - this.baseEnergy)
    return clamp(Math.max(bySeparation, byEnergy), 0, 1)
  }
}

/* ============================================================
   INTEGRATOR

   Velocity Verlet on a softened Newtonian potential, in the plane.
   Kept as free functions over a plain state object so the ghost
   orbit can be integrated at build time without a second exhibit.
   ============================================================ */

function createState(): SystemState {
  return {
    px: [...FIGURE_EIGHT.px],
    py: [...FIGURE_EIGHT.py],
    vx: [...FIGURE_EIGHT.vx],
    vy: [...FIGURE_EIGHT.vy],
    ax: [0, 0, 0],
    ay: [0, 0, 0],
  }
}

/** Pairwise, using Newton's third law: three pairs, not nine. */
function computeAccelerations(s: SystemState): void {
  s.ax[0] = s.ax[1] = s.ax[2] = 0
  s.ay[0] = s.ay[1] = s.ay[2] = 0

  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const dx = s.px[j] - s.px[i]
      const dy = s.py[j] - s.py[i]
      const r2 = dx * dx + dy * dy + SOFTENING2
      const inverse = 1 / (r2 * Math.sqrt(r2))
      s.ax[i] += dx * inverse
      s.ay[i] += dy * inverse
      s.ax[j] -= dx * inverse
      s.ay[j] -= dy * inverse
    }
  }
}

/**
 * Half-kick, drift, recompute, half-kick. Symplectic, so the energy
 * readout stays flat instead of sliding — which is the whole reason
 * the HUD can show energy drift as evidence rather than as noise.
 */
function integrate(s: SystemState, dt: number): void {
  const half = dt * 0.5
  for (let i = 0; i < 3; i++) {
    s.vx[i] += s.ax[i] * half
    s.vy[i] += s.ay[i] * half
    s.px[i] += s.vx[i] * dt
    s.py[i] += s.vy[i] * dt
  }
  computeAccelerations(s)
  for (let i = 0; i < 3; i++) {
    s.vx[i] += s.ax[i] * half
    s.vy[i] += s.ay[i] * half
  }
}

/** Kinetic plus the same softened potential the forces use. */
function totalEnergy(s: SystemState): number {
  let energy = 0
  for (let i = 0; i < 3; i++) {
    energy += 0.5 * (s.vx[i] * s.vx[i] + s.vy[i] * s.vy[i])
  }
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const dx = s.px[j] - s.px[i]
      const dy = s.py[j] - s.py[i]
      energy -= 1 / Math.sqrt(dx * dx + dy * dy + SOFTENING2)
    }
  }
  return energy
}

function maxSeparation(s: SystemState): number {
  let largest = 0
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      const dx = s.px[j] - s.px[i]
      const dy = s.py[j] - s.py[i]
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (distance > largest) largest = distance
    }
  }
  return largest
}
