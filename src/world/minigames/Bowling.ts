import * as THREE from 'three'
import { Minigame } from './Minigame'
import { PLAY_SPOTS } from '@/content/world-environment'
import { palette } from '../core/palette'
import { textGeometry } from '../world/Type3D'
import type { Game } from '../Game'
import type { Bin } from '../core/Disposal'
import type { ColliderDescription, Physical } from '../physics/Physics'

/* ============================================================
   NEWPORT LANES

   A miniature bowling alley you play with the car. The
   down-vector/settle/re-rack loop follows folio-2025's
   BowlingArea (MIT — Copyright (c) 2025 Bruno Simon); the
   venue, the pin model, the lane cross-section, the scoring
   model and the physical scoreboard are original.

   THE ONE SCALE CONSTANT. Everything across the lane —
   width, gutters, pin pitch, pin height, ball diameter — is
   a regulation USBC dimension multiplied by S world units
   per metre. That is what fixes the old build, where the
   lane was authored at ~10 u/m and the pin rack at ~4 u/m,
   so a single ball spanned two pin positions.

   S is set by the CAR, not by the lane: the ball has to be
   something a 2.6-long chassis can shove without climbing
   over it, which puts its diameter near 1.5. Everything else
   follows from that.

   LANE LENGTH IS THE ONE THING NOT TO SCALE. A regulation
   lane is 17.3 lane-widths from the foul line to the head
   pin; at this scale that would be 128 world units of dead
   straight ground, which is a third of the island. The lane
   here is 12 units of bed — deliberately a miniature, the
   way a table-top alley is — and every OTHER proportion is
   real, so it still reads as a bowling lane and not as a
   corridor with skittles in it.

   IT IS A BUILDING, NOT A SLAB. The venue stands on its own
   foundation, with the deck set above the highest ground
   under its footprint and a graded apron at the bowler's end
   for the car to drive up. That is what let the terrain
   flattening at this spot drop from `flat: 24` (which levelled
   50 m of island and reached into four districts) to
   `flat: 15`: the plinth absorbs the residual relief that
   the flattening no longer removes.
   ============================================================ */

/* ---- scale ------------------------------------------------ */

/** World units per real metre, across the lane. See the header. */
const S = 7
/** One inch, in world units. Every cross-lane number is USBC. */
const IN = 0.0254 * S

const LANE_W = 41.5 * IN        // 7.379  regulation lane width
const GUTTER_W = 9.25 * IN      // 1.645  regulation gutter
const KICK_W = 0.5              //        outer kickback wall
const PIN_PITCH = 12 * IN       // 2.134  pin spot spacing
const ROW_PITCH = PIN_PITCH * Math.cos(Math.PI / 6) // 1.848 — equilateral
const PIN_H = 15 * IN           // 2.667  pin height
const BALL_R = 4.25 * IN        // 0.756  8.5 in diameter
const HALF_W = LANE_W / 2 + GUTTER_W + KICK_W // 5.835 — the venue's half width
/** Gutter and pit floor, below the lane surface. Deeper than 0.6·BALL_R,
 *  so a ball that drops in cannot climb the lane edge again. */
const DROP = 0.6
/** Top of the foundation: just under the deepest playing surface. */
const BASE = DROP + 0.02

/* ---- the venue, as z offsets from the spot centre ---------
   +Z is behind the bowler, -Z is down-lane. Nothing in this
   file is an absolute world coordinate; the three stale
   literals that used to live in tick() are gone. */
const APRON_Z = 23.5            // outer lip of the graded drive-up
const APPROACH_Z = 18.0         // back edge of the approach / venue edge
const FOUL_Z = 11.0
const DECK_Z = -1.0             // front edge of the pin deck
const HEAD_Z = -2.6             // the 1 pin
const DECK_BACK_Z = -9.6        // back edge of the pin deck, lip of the pit
const PIT_BACK_Z = -14.0
const BACK_Z = -15.0            // outer face of the masking unit
const BALL_HOME_Z = 10.0        // the ball waits just past the foul line
const MARK_Z = 16.2             // where the car is set down

/** Three frames, scored by the ten-frame rules with the last frame
 *  taking a fill ball. A full game is twenty-one balls and twenty-one
 *  drives back to the mark; three frames is a set you finish. */
const FRAMES = 3
const SWEEP_TIME = 1.15
/** Height of the masking unit above the deck. */
const MASK_H = 3.0

/** USBC pin silhouette, (radius, height) in inches. The lathe, the
 *  physics hull and the scoreboard diagram are all built from this
 *  one list, so the model, the collider and the readout cannot drift
 *  apart. */
const PROFILE: [number, number][] = [
  [1.06, 0.0], [1.45, 0.6], [1.95, 1.5], [2.28, 3.0], [2.38, 4.5],
  [2.27, 6.0], [1.90, 7.5], [1.34, 9.0], [0.90, 10.0], [1.00, 11.0],
  [1.32, 12.0], [1.41, 12.8], [1.28, 13.8], [0.80, 14.5], [0.0, 15.0],
]
/** The two neck bands, in inches. Sized FROM the profile at build
 *  time — the old build put a fixed-radius ring inside a body twice
 *  its width, so the pins had no colour identity at all. */
const BANDS: [number, number][] = [[10.3, 11.1], [11.9, 12.7]]

type Pin = {
  physical: Physical
  mesh: THREE.Object3D
  /** 1..10, numbered from the bowler's left. */
  number: number
  /** Authored reset transform. */
  spot: THREE.Vector3
}

type Phase = 'ready' | 'rolling' | 'sweep'

export class Bowling extends Minigame {
  readonly id = 'bowling' as const
  readonly title = 'NEWPORT LANES'
  readonly group = new THREE.Group()
  readonly pins: Pin[] = []
  readonly startPosition = new THREE.Vector3()
  /** The venue origin. Everything is an offset from it. */
  private readonly at = { x: 0, z: 0 }
  private floorY = 0
  ball!: { physical: Physical; mesh: THREE.Object3D }
  private ballHome = new THREE.Vector3()

  /* ---- scoring ---- */
  /** Balls thrown, per frame. */
  frames: number[][] = [[]]
  frame = 0
  ballNumber = 0
  /** Which pins are up RIGHT NOW, read off the bodies, never sticky. */
  standing: boolean[] = new Array(10).fill(true)
  /** Which were up when the current ball left the mark. */
  standingAtBallStart: boolean[] = new Array(10).fill(true)
  /** Pins felled by the ball in flight. */
  down = 0
  score = 0
  bestScore = 0
  lastCall = ''

  /* ---- run state ---- */
  private phase: Phase = 'ready'
  private rollTime = 0
  private settled = 0
  private sweepT = 0
  private pending = { rerack: false, frameOver: false, gameOver: false }
  private impactAt = 0
  private tidyAt = 0

  /* ---- scoreboard ---- */
  private canvas!: HTMLCanvasElement
  private texture!: THREE.CanvasTexture
  private painted = ''
  private sweepBar!: THREE.Mesh

  constructor(game: Game, bin: Bin) {
    super(game, bin)
    this.abandonRadius = 95
  }

  /* ==========================================================
     BUILD
     ========================================================== */

  build(): void {
    const spot = PLAY_SPOTS.find((p) => p.id === 'bowling')!
    this.at.x = spot.x
    this.at.z = spot.z
    const ox = this.at.x
    const oz = this.at.z

    // The deck sits above the HIGHEST ground under the footprint, so
    // the recessed gutters and pit clear the terrain everywhere. With
    // flat: 15 the residual relief here is about 0.75, which is the
    // height of the plinth on the low side.
    let highest = -Infinity
    let lowest = Infinity
    for (let dz = BACK_Z; dz <= APPROACH_Z; dz += 1.5) {
      for (let dx = -HALF_W; dx <= HALF_W; dx += 1.5) {
        const h = this.game.terrain.colliderHeightAt(ox + dx, oz + dz)
        if (h > highest) highest = h
        if (h < lowest) lowest = h
      }
    }
    this.floorY = highest + BASE + 0.10
    const floorY = this.floorY
    const footY = lowest - 1.6

    this.startPosition.set(ox, floorY + 1.5, oz + MARK_Z)
    this.ballHome.set(ox, floorY + BALL_R + 0.02, oz + BALL_HOME_Z)

    this.buildStructure(footY)
    this.buildMarkings()
    this.buildPins()
    this.buildBall()
    this.buildScoreboard()
    this.buildSignage()

    this.game.renderer.scene.add(this.group)
    this.bin.object3D(this.group)

    this.game.interactions.add({
      id: 'bowling-start',
      position: this.startPosition.clone(),
      radius: 9,
      label: 'BOWL A SET',
      sublabel: 'Three frames. Drive into the ball.',
      onInteract: () => {
        if (this.running) this.backToTheMark()
        else this.game.minigames.start(this.id)
      },
    })

    // Order 12: render interpolation for the eleven loose bodies, the
    // sweep bar, and the between-games watchdog. It runs whether or
    // not a set is live, which is what recovers a ball the player
    // nudged off the lane on their way past.
    const tick = () => this.frameTick()
    this.game.ticker.events.on('tick', tick, 12)
    this.bin.add(() => this.game.ticker.events.off('tick', tick))
    this.paint()
  }

  /* ---- lane, gutters, deck, pit, plinth -------------------- */

  private buildStructure(footY: number): void {
    const ox = this.at.x
    const oz = this.at.z
    const floorY = this.floorY
    const m = this.game.materials

    const maple = m.tinted('#d9b981', 0.62)
    const approachWood = m.tinted('#8a6f4c', 0.72)
    const deckWood = m.tinted('#e6cfa2', 0.55)
    const channel = m.tinted('#39443e', 0.85)
    const kick = m.tinted(palette.signal, 0.8)
    const stone = m.tinted(palette.concreteDark, 0.9)

    // One fixed body for the whole venue shell. Per-collider friction
    // and category, so the gutters can be slick and the lane grippy
    // without eleven separate rigid bodies.
    const colliders: ColliderDescription[] = []
    const centre = new THREE.Vector3(ox, 0, oz)
    const box = (
      w: number, h: number, d: number,
      x: number, yTop: number, z: number,
      material: THREE.Material,
      friction = 0.6,
      solid = true,
    ) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
      mesh.position.set(ox + x, yTop - h / 2, oz + z)
      mesh.receiveShadow = true
      this.group.add(mesh)
      if (solid) {
        colliders.push({
          shape: 'cuboid',
          parameters: [w / 2, h / 2, d / 2],
          position: { x, y: mesh.position.y, z },
          category: 'floor',
          friction,
        })
      }
      return mesh
    }

    const laneLen = FOUL_Z - DECK_Z
    const deckLen = DECK_Z - DECK_BACK_Z
    const approachLen = APPROACH_Z - FOUL_Z
    const venueLen = APPROACH_Z - BACK_Z
    const gutterX = LANE_W / 2 + GUTTER_W / 2

    // Foundation. Its flanks ARE the retaining walls, which is what
    // lets the terrain flattening stay small.
    box(HALF_W * 2, floorY - BASE - footY, venueLen, 0, floorY - BASE, (APPROACH_Z + BACK_Z) / 2, stone, 0.7)

    // Approach — a visibly different, matte surface. This is where the
    // car is set down and where the venue names itself.
    box(HALF_W * 2, BASE, approachLen, 0, floorY, (APPROACH_Z + FOUL_Z) / 2, approachWood, 0.7)
    // Lane bed.
    box(LANE_W, BASE, laneLen, 0, floorY, (FOUL_Z + DECK_Z) / 2, maple, 0.62)
    // Pin deck — pale maple, its own surface, as on a real lane.
    box(LANE_W, BASE, deckLen, 0, floorY, (DECK_Z + DECK_BACK_Z) / 2, deckWood, 0.55)
    // Gutters: recessed channels running the length of the lane and the
    // deck and emptying into the pit. Slick, so a gutter ball keeps
    // travelling instead of parking in the middle of the lane.
    for (const sx of [-1, 1]) {
      box(GUTTER_W, 0.14, FOUL_Z - PIT_BACK_Z, sx * gutterX, floorY - DROP, (FOUL_Z + PIT_BACK_Z) / 2, channel, 0.14)
    }
    // Pit floor, level with the gutters.
    box(LANE_W, 0.14, DECK_BACK_Z - PIT_BACK_Z, 0, floorY - DROP, (DECK_BACK_Z + PIT_BACK_Z) / 2, channel, 0.2)
    // Kickbacks. They replace the old pair of bumper rails, which sat
    // OUTSIDE the playing surface and made every throw a bumper throw.
    for (const sx of [-1, 1]) {
      box(KICK_W, 1.45 + DROP, FOUL_Z - BACK_Z, sx * (LANE_W / 2 + GUTTER_W + KICK_W / 2), floorY + 1.45, (FOUL_Z + BACK_Z) / 2, kick, 0.3)
    }
    // Low rails along the approach, so the car has an edge to line up on.
    for (const sx of [-1, 1]) {
      box(KICK_W, 0.55 + BASE, approachLen, sx * (HALF_W - KICK_W / 2), floorY + 0.55, (APPROACH_Z + FOUL_Z) / 2, kick, 0.3)
    }
    // Masking unit: the backstop the pins and the ball end up against,
    // and the plinth the scoreboard stands on.
    box(HALF_W * 2, MASK_H + DROP, PIT_BACK_Z - BACK_Z, 0, floorY + MASK_H, (PIT_BACK_Z + BACK_Z) / 2, m.tinted(palette.voidDark3, 0.9), 0.4)
    // Ball return: an alcove beside the mark, so the ball that arrives
    // back at the head of the lane has somewhere to have come from.
    box(0.8, 0.44, approachLen - 1.4, HALF_W - KICK_W - 0.4, floorY + 0.5, (APPROACH_Z + FOUL_Z) / 2, m.tinted(palette.metal, 0.5), 0.3, false)

    this.game.physics.add({ type: 'fixed', position: centre, colliders })

    // Graded apron. A single adaptive strip: the inner edge meets the
    // deck, the outer edge sits on the ground, and every vertex is
    // clamped above the terrain so the drive-up is continuous however
    // the ground rolls. Without it the plinth is a wall.
    this.buildApron()
  }

  private buildApron(): void {
    const ox = this.at.x
    const oz = this.at.z
    const cols = 13
    const rows = 9
    const width = HALF_W * 2
    const geometry = new THREE.PlaneGeometry(width, APRON_Z - APPROACH_Z, cols - 1, rows - 1)
    geometry.rotateX(-Math.PI / 2)
    const position = geometry.attributes.position as THREE.BufferAttribute
    const verts: number[] = []
    for (let i = 0; i < position.count; i++) {
      const dx = position.getX(i)
      // PlaneGeometry's local +Z after the rotation runs from the far
      // edge to the near one; map it back to a 0..1 ramp parameter.
      const dz = position.getZ(i) + (APRON_Z + APPROACH_Z) / 2
      const t = Math.min(1, Math.max(0, (dz - APPROACH_Z) / (APRON_Z - APPROACH_Z)))
      const ground = this.game.terrain.colliderHeightAt(ox + dx, oz + dz) + 0.06
      const smooth = t * t * (3 - 2 * t)
      const y = Math.max(ground, this.floorY * (1 - smooth) + ground * smooth) - this.floorY
      position.setY(i, y)
      verts.push(dx, y, position.getZ(i))
    }
    geometry.computeVertexNormals()
    const mesh = new THREE.Mesh(geometry, this.game.materials.tinted('#9c9276', 0.95))
    mesh.position.set(ox, this.floorY, oz + (APRON_Z + APPROACH_Z) / 2)
    mesh.receiveShadow = true
    this.group.add(mesh)

    const index = geometry.getIndex()!
    this.game.physics.add({
      type: 'fixed',
      category: 'floor',
      friction: 0.85,
      position: mesh.position,
      colliders: [{
        shape: 'trimesh',
        parameters: [new Float32Array(verts), new Uint32Array(index.array)],
      }],
    })
  }

  /* ---- painted markings ------------------------------------ */

  private buildMarkings(): void {
    const ox = this.at.x
    const oz = this.at.z
    const y = this.floorY + BASE / 2 + 0.008
    const m = this.game.materials
    const line = m.tinted('#b8925c', 0.7)
    const paint = m.tinted('#7d5f3a', 0.7)

    // Thirty-nine boards is regulation; nine drawn lines is enough to
    // read the lane as planked without nine geometries.
    for (let i = 1; i < 9; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.01, FOUL_Z - DECK_BACK_Z), line)
      mesh.position.set(ox - LANE_W / 2 + (i * LANE_W) / 9, y, oz + (FOUL_Z + DECK_BACK_Z) / 2)
      this.group.add(mesh)
    }
    // Foul line.
    const foul = new THREE.Mesh(new THREE.BoxGeometry(LANE_W + GUTTER_W * 2, 0.012, 0.22), m.tinted(palette.accent, 0.6))
    foul.position.set(ox, y, oz + FOUL_Z)
    this.group.add(foul)

    // The seven targeting arrows. Free guidance, no UI, and they are
    // what makes aiming the car a decision.
    const arrow = new THREE.CircleGeometry(0.3, 3)
    for (let k = -3; k <= 3; k++) {
      const mesh = new THREE.Mesh(arrow, paint)
      mesh.rotation.x = -Math.PI / 2
      mesh.position.set(ox + (k * LANE_W) / 8, y, oz + 3.4 + Math.abs(k) * 0.85)
      this.group.add(mesh)
    }
    // Ten pin spots, so the rack has a home even when it is empty.
    const dot = new THREE.CircleGeometry(0.24, 12)
    for (const { x, z } of this.rackSpots()) {
      const mesh = new THREE.Mesh(dot, paint)
      mesh.rotation.x = -Math.PI / 2
      mesh.position.set(x, this.floorY + BASE / 2 + 0.01, z)
      this.group.add(mesh)
    }

    // Sweep bar: a visual pinsetter beat, so the re-rack is a machine
    // doing something rather than ten pins popping out of existence.
    this.sweepBar = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_W - 0.1, 0.75, 0.2),
      m.tinted(palette.accentDeep, 0.6),
    )
    this.sweepBar.visible = false
    this.group.add(this.sweepBar)
    this.parkSweep()
  }

  /** Authored rack transforms: an equilateral 1/2/3/4 triangle. */
  private rackSpots(): { x: number; z: number; number: number }[] {
    const out: { x: number; z: number; number: number }[] = []
    let n = 1
    for (let row = 0; row < 4; row++) {
      // The bowler faces -Z, so their left hand points at -X: iterating
      // col upward numbers 7-8-9-10 left to right FROM THE MARK, which
      // is the only ordering the score diagram can be read against.
      for (let col = 0; col <= row; col++) {
        out.push({
          x: this.at.x + (col - row / 2) * PIN_PITCH,
          z: this.at.z + HEAD_Z - row * ROW_PITCH,
          number: n++,
        })
      }
    }
    return out
  }

  /* ---- pins ------------------------------------------------ */

  private buildPins(): void {
    const geometry = pinGeometry()
    const material = this.game.materials.own(new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.42, metalness: 0.02,
    }))
    const hull = pinHull()
    const shadows = this.game.quality.settings.shadows

    for (const spot of this.rackSpots()) {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.castShadow = shadows
      mesh.position.set(spot.x, this.floorY + 0.02, spot.z)
      this.group.add(mesh)

      const physical = this.game.physics.add({
        type: 'dynamic',
        position: mesh.position,
        friction: 0.4,
        restitution: 0.28,
        linearDamping: 0.12,
        // Higher than the old 0.22: pins that spin for ever never
        // settle, and the settle test is what ends a throw.
        angularDamping: 0.36,
        // One hull from the same silhouette as the mesh. Rapier derives
        // the inertia and the centre of mass from the shape, so the pin
        // is bottom-heavy because it IS bottom-heavy — no fake COM
        // override, which in this Physics layer would also force a
        // constant principal inertia and turn the pin into a post.
        colliders: [{ shape: 'hull', parameters: [hull], mass: 0.285 }],
        onCollision: (force) => {
          const now = this.game.ticker.elapsed
          if (force < 18 || now - this.impactAt < 0.1) return
          if (this.game.player.position.distanceTo(physical.current.position) > 70) return
          this.impactAt = now
          this.game.audio.impact(Math.min(60, force))
        },
      })
      this.pins.push({
        physical,
        mesh,
        number: spot.number,
        spot: new THREE.Vector3(spot.x, this.floorY + 0.02, spot.z),
      })
    }
  }

  /* ---- ball ------------------------------------------------ */

  private buildBall(): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R, 24, 16),
      this.game.materials.tinted(palette.accentDeep, 0.24, 0.3),
    )
    mesh.position.copy(this.ballHome)
    mesh.castShadow = this.game.quality.settings.shadows
    this.group.add(mesh)

    // Three drilled holes. Flat discs laid ON the surface rather than
    // dark spheres buried inside it, which is what the old build had:
    // at |v| < R they read as pimples, not holes.
    const holeGeometry = new THREE.CircleGeometry(BALL_R * 0.15, 10)
    const holeMaterial = this.game.materials.flat('#1a0d08')
    for (const [ax, ay] of [[-0.30, 0.62], [0.30, 0.62], [0.0, 0.30]] as [number, number][]) {
      const dir = new THREE.Vector3(ax, ay, 0.72).normalize()
      const hole = new THREE.Mesh(holeGeometry, holeMaterial)
      hole.position.copy(dir).multiplyScalar(BALL_R * 0.995)
      hole.lookAt(dir.clone().multiplyScalar(BALL_R * 2))
      mesh.add(hole)
    }

    const physical = this.game.physics.add({
      type: 'dynamic',
      position: this.ballHome,
      mass: 1.35,
      friction: 0.5,
      restitution: 0.16,
      linearDamping: 0.06,
      angularDamping: 0.06,
      colliders: [{ shape: 'ball', parameters: [BALL_R] }],
    })
    physical.body.enableCcd(true)
    this.ball = { physical, mesh }
  }

  /* ---- scoreboard ------------------------------------------ */

  private buildScoreboard(): void {
    const ox = this.at.x
    const oz = this.at.z
    this.canvas = document.createElement('canvas')
    this.canvas.width = 1024
    this.canvas.height = 448
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.bin.add(() => this.texture.dispose())

    const m = this.game.materials
    const width = HALF_W * 2 - 0.7
    const height = width * (448 / 1024)

    // Housing on top of the masking unit: frame, two posts, and the
    // screen inset in front of it, tilted at the car's eye line.
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.5, height + 0.5, 0.35),
      m.tinted(palette.voidDark2, 0.85),
    )
    const centreY = this.floorY + MASK_H + 0.35 + height / 2
    frame.position.set(ox, centreY, oz + BACK_Z + 0.6)
    frame.rotation.x = -0.1
    this.group.add(frame)

    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      m.own(new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false })),
    )
    screen.position.set(0, 0, 0.19)
    frame.add(screen)

    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 1.2, 0.34),
        m.tinted(palette.voidDark2, 0.85),
      )
      post.position.set(ox + sx * (width / 2 - 0.2), this.floorY + MASK_H + 0.3, oz + BACK_Z + 0.6)
      this.group.add(post)
    }
  }

  /* ---- signage --------------------------------------------- */

  private buildSignage(): void {
    const ox = this.at.x
    const oz = this.at.z
    const m = this.game.materials
    const lay = (text: string, size: number, dz: number, material: THREE.Material) => {
      const { geometry, width } = textGeometry(text, { size, weight: 0.17, depth: 0.08, align: 'center' })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.rotation.x = -Math.PI / 2
      const fit = Math.min(1, (LANE_W + GUTTER_W * 2) / width)
      mesh.scale.setScalar(fit)
      mesh.position.set(ox, this.floorY + BASE / 2 + 0.012, oz + dz)
      this.group.add(mesh)
    }
    lay('NEWPORT LANES', 1.05, APPROACH_Z - 2.6, m.tinted(palette.chalk, 0.6))
    lay('PUSH THE BALL', 0.52, APPROACH_Z - 5.4, m.tinted('#c9b48b', 0.7))
  }

  /* ==========================================================
     LIFECYCLE
     ========================================================== */

  start(): boolean {
    if (this.running) return true
    super.start()
    this.origin.copy(this.startPosition)
    this.game.vehicle.moveTo(this.startPosition, Math.PI / 2)
    this.game.interactions.setLabel('bowling-start', 'BACK TO THE MARK', 'Line the car up behind the ball.')
    this.game.audio.blip(1.1)
    this.paint()
    return true
  }

  protected reset(): void {
    this.frames = [[]]
    this.frame = 0
    this.ballNumber = 0
    this.down = 0
    this.score = 0
    this.lastCall = ''
    this.phase = 'ready'
    this.rollTime = 0
    this.settled = 0
    this.sweepT = 0
    this.pending = { rerack: false, frameOver: false, gameOver: false }
    this.rerack()
    this.standingAtBallStart = this.standing.slice()
    this.sweepBar.visible = false
    this.parkSweep()
    this.game.interactions.setLabel('bowling-start', 'BOWL A SET', 'Three frames. Drive into the ball.')
    this.painted = ''
    this.paint()
  }

  /** Every pin back on its authored spot, upright, awake and visible. */
  private rerack(): void {
    for (const pin of this.pins) {
      this.game.physics.reset(pin.physical)
      pin.mesh.visible = true
      pin.mesh.position.copy(pin.spot)
      pin.mesh.quaternion.identity()
    }
    this.standing = new Array(10).fill(true)
    this.returnBall()
  }

  private returnBall(): void {
    if (!this.ball) return
    this.game.physics.reset(this.ball.physical)
    this.ball.mesh.position.copy(this.ballHome)
  }

  private backToTheMark(): void {
    if (this.phase !== 'ready') return
    this.game.vehicle.moveTo(this.startPosition, Math.PI / 2)
    this.game.audio.blip()
  }

  /* ==========================================================
     THE THROW
     ========================================================== */

  protected tick(delta: number): void {
    const dt = delta / this.game.ticker.defaultScale
    const p = this.ball.physical.current.position

    if (this.phase === 'ready') {
      if (p.distanceTo(this.ballHome) > BALL_R * 0.9) {
        this.phase = 'rolling'
        this.rollTime = 0
        this.settled = 0
      }
      this.paint()
      return
    }

    if (this.phase === 'sweep') {
      this.sweepT += dt
      if (this.sweepT > SWEEP_TIME * 0.52 && this.sweepBar.visible) this.applySweep()
      if (this.sweepT >= SWEEP_TIME) this.endSweep()
      this.paint()
      return
    }

    /* rolling */
    this.rollTime += dt
    const speed = vecLength(this.ball.physical.body.linvel())
    const inPlay = p.y > this.floorY - 3
    this.game.audio.environment(
      'rolling',
      Math.max(0, 1 - p.distanceTo(this.game.player.position) / 55) * 0.5,
    )

    // Live pin state, so the readout is honest while the rack is still
    // moving rather than only after it stops.
    for (let i = 0; i < this.pins.length; i++) {
      if (this.standing[i] && this.isDown(this.pins[i])) this.standing[i] = false
    }
    this.down = this.knockedThisBall()

    const pinsMoving = this.pins.some((pin) => {
      if (!pin.physical.body.isEnabled()) return false
      return vecLength(pin.physical.body.linvel()) > 0.25 || vecLength(pin.physical.body.angvel()) > 0.4
    })
    const moving = pinsMoving || (inPlay && speed > 0.35)
    if (this.rollTime > 0.7 && !moving) this.settled += dt
    else this.settled = 0

    if (this.settled > 0.65 || !inPlay || this.rollTime > 14) this.resolveBall()
    this.paint()
  }

  /**
   * A pin is down when it is swept, tilted past 50 degrees, below the
   * deck, or OFF the deck — laterally into a gutter, back into the pit
   * or forward onto the lane. The old build tested tilt alone, so a pin
   * shoved clean off the deck while upright scored as standing.
   */
  private isDown(pin: Pin): boolean {
    if (!pin.physical.body.isEnabled()) return true
    const q = pin.physical.current.quaternion
    if (1 - 2 * (q.x * q.x + q.z * q.z) < 0.64) return true
    const p = pin.physical.current.position
    if (p.y < this.floorY - 0.3) return true
    if (Math.abs(p.x - this.at.x) > LANE_W / 2 + 0.15) return true
    const dz = p.z - this.at.z
    return dz < DECK_BACK_Z || dz > DECK_Z + 0.5
  }

  private knockedThisBall(): number {
    let n = 0
    for (let i = 0; i < 10; i++) if (this.standingAtBallStart[i] && !this.standing[i]) n++
    return n
  }

  private resolveBall(): void {
    const knocked = this.knockedThisBall()
    this.down = knocked
    const rolls = this.frames[this.frame]
    rolls.push(knocked)

    const last = this.frame === FRAMES - 1
    let rerack = false
    let frameOver = false
    if (!last) {
      if (rolls.length === 1 && knocked === 10) { frameOver = true; rerack = true }
      else if (rolls.length >= 2) { frameOver = true; rerack = true }
    } else if (rolls.length === 1) {
      rerack = rolls[0] === 10
    } else if (rolls.length === 2) {
      if (rolls[0] === 10) rerack = rolls[1] === 10
      else if (rolls[0] + rolls[1] === 10) rerack = true
      else frameOver = true
    } else {
      frameOver = true
    }

    // Calls, and the presentation that goes with them.
    const strike = rolls[rolls.length - 1] === 10 && this.standingAtBallStart.every(Boolean)
    const spare = !strike && rolls.length >= 2 && this.standing.every((s) => !s)
    this.lastCall = strike ? 'STRIKE' : spare ? 'SPARE' : knocked === 0 ? 'MISS' : ''
    if (strike || spare) {
      this.game.achievements.set(strike ? 'strike' : 'spare', 1)
      this.game.particles.burst(
        new THREE.Vector3(this.at.x, this.floorY + 2.4, this.at.z + HEAD_Z - ROW_PITCH),
        strike ? 46 : 26,
        'confetti',
      )
      this.game.audio.play('achievement')
    } else {
      this.game.audio.blip(knocked === 0 ? 0.6 : 0.9)
    }

    this.score = this.total()
    this.pending = { rerack, frameOver, gameOver: frameOver && last }
    this.phase = 'sweep'
    this.sweepT = 0
    this.sweepBar.visible = true
  }

  /** Midway through the sweep beat: clear what fell, or re-rack. */
  private applySweep(): void {
    if (this.pending.rerack) {
      this.rerack()
    } else {
      for (let i = 0; i < this.pins.length; i++) {
        if (this.standing[i]) continue
        this.pins[i].mesh.visible = false
        this.pins[i].physical.body.setEnabled(false)
      }
      this.returnBall()
    }
    this.sweepBar.visible = false
    this.parkSweep()
    this.game.audio.environment('rolling', 0.35)
  }

  private endSweep(): void {
    const { frameOver, gameOver } = this.pending
    this.sweepT = 0
    if (gameOver) { this.finishSet(); return }
    if (frameOver) {
      this.frame++
      this.frames.push([])
      this.ballNumber = 0
    } else {
      this.ballNumber++
    }
    this.standingAtBallStart = this.standing.slice()
    this.down = 0
    this.phase = 'ready'
    this.rollTime = 0
    this.settled = 0
    this.game.vehicle.moveTo(this.startPosition, Math.PI / 2)
    this.game.audio.blip(1.15)
  }

  private finishSet(): void {
    this.score = this.total()
    this.bestScore = Math.max(this.bestScore, this.score)
    this.game.achievements.set('bowling', 1)
    // `null`, deliberately: a fastest frame is not a bowling result,
    // and the base class would file this in bestTimes and print it as
    // BEST 00:12.430 under the score.
    this.finish(null)
    // NOT prepareAttempt() — that killed finish()'s own dismiss timer
    // and pinned the result card open until the player drove 95 m away.
    this.game.store.getState().setMinigame({
      id: this.id,
      title: this.title,
      lines: [`SCORE ${this.score}`, `BEST ${this.bestScore}`, 'SET COMPLETE • ENTER TO PLAY AGAIN'],
      time: null,
      best: null,
      progress: 1,
    })
    this.game.interactions.setLabel('bowling-start', 'BOWL A SET', 'Three frames. Drive into the ball.')
    this.painted = ''
    this.paint()
  }

  /* ==========================================================
     SCORING
     ========================================================== */

  /** True when the final frame has had every ball it is owed. */
  private lastFrameDone(rolls: number[]): boolean {
    if (rolls.length >= 3) return true
    if (rolls.length === 2) return rolls[0] !== 10 && rolls[0] + rolls[1] < 10
    return false
  }

  /** Running totals per frame; null where the bonus is not yet known.
   *  Not `running` — the base class already has that, as the boolean
   *  saying whether a game is in play. */
  runningTotals(): (number | null)[] {
    const balls = this.frames.flat()
    const out: (number | null)[] = []
    let total = 0
    let at = 0
    for (let f = 0; f < FRAMES; f++) {
      const rolls = this.frames[f] ?? []
      if (f === FRAMES - 1) {
        if (!this.lastFrameDone(rolls)) { out.push(null); break }
        total += rolls.reduce((a, b) => a + b, 0)
        out.push(total)
        break
      }
      if (rolls.length === 0) { out.push(null); break }
      if (rolls[0] === 10) {
        const bonus = balls.slice(at + 1, at + 3)
        if (bonus.length < 2) { out.push(null); break }
        total += 10 + bonus[0] + bonus[1]
        out.push(total)
        at += 1
      } else if (rolls.length >= 2) {
        if (rolls[0] + rolls[1] === 10) {
          const bonus = balls.slice(at + 2, at + 3)
          if (bonus.length < 1) { out.push(null); break }
          total += 10 + bonus[0]
        } else {
          total += rolls[0] + rolls[1]
        }
        out.push(total)
        at += 2
      } else {
        out.push(null)
        break
      }
    }
    return out
  }

  total(): number {
    const rows = this.runningTotals()
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i] !== null) return rows[i]!
    return 0
  }

  protected lines(): string[] {
    const label = this.phase === 'rolling' ? 'ROLLING…' : this.phase === 'sweep' ? 'RE-RACKING…' : 'PUSH THE BALL'
    return [
      `FRAME ${this.frame + 1} / ${FRAMES} · BALL ${this.ballNumber + 1}`,
      `${this.standing.filter((s) => !s).length} / 10 DOWN · SCORE ${this.score}`,
      this.lastCall && this.phase !== 'ready' ? `${this.lastCall}!` : label,
    ]
  }

  protected progress(): number {
    const done = this.frame + (this.frames[this.frame]?.length ?? 0) / 2
    return Math.min(1, done / FRAMES)
  }

  /* ==========================================================
     PER-FRAME: interpolation, sweep bar, idle watchdog
     ========================================================== */

  private parkSweep(): void {
    this.sweepBar.position.set(this.at.x, this.floorY + 0.38, this.at.z + DECK_BACK_Z - 0.4)
  }

  private frameTick(): void {
    const alpha = this.game.ticker.alpha
    for (const pin of this.pins) {
      this.game.physics.sample(pin.physical, alpha, pin.mesh.position, pin.mesh.quaternion)
    }
    this.game.physics.sample(this.ball.physical, alpha, this.ball.mesh.position, this.ball.mesh.quaternion)

    if (this.sweepBar.visible) {
      const t = Math.min(1, this.sweepT / (SWEEP_TIME * 0.52))
      this.sweepBar.position.set(
        this.at.x,
        this.floorY + 0.38,
        this.at.z + DECK_Z + 0.3 + (DECK_BACK_Z - DECK_Z - 0.7) * t,
      )
    }

    if (this.running || this.state === 'finished') return

    // Between games: recover anything the player left lying around.
    // tick() only runs while a set is live, so without this a ball
    // nudged off the lane in passing stays off it for ever.
    const now = this.game.ticker.elapsed
    if (now - this.tidyAt < 1) return
    this.tidyAt = now
    const p = this.ball.physical.current.position
    if (p.distanceTo(this.ballHome) > 1.2 && p.y < this.floorY - 2.5) this.returnBall()
    const far = this.game.player.position.distanceTo(this.startPosition) > 55
    if (!far) return
    const disturbed = this.pins.some((pin) => this.isDown(pin))
      || p.distanceTo(this.ballHome) > BALL_R * 1.5
    if (disturbed) {
      this.rerack()
      this.painted = ''
      this.paint()
    }
  }

  /* ==========================================================
     THE PHYSICAL SCOREBOARD
     ========================================================== */

  private paint(): void {
    const totals = this.runningTotals()
    const key = [
      this.frame, this.ballNumber, this.standing.map((s) => (s ? 1 : 0)).join(''),
      this.score, this.phase, this.lastCall, this.state, this.bestScore,
    ].join('|')
    if (key === this.painted) return
    this.painted = key

    const c = this.canvas.getContext('2d')!
    const W = 1024
    const H = 448
    c.fillStyle = '#141a17'
    c.fillRect(0, 0, W, H)
    c.strokeStyle = palette.signal
    c.lineWidth = 7
    c.strokeRect(3.5, 3.5, W - 7, H - 7)

    /* ---- header ---- */
    c.textAlign = 'left'
    c.fillStyle = '#eae4c6'
    c.font = 'bold 38px monospace'
    c.fillText('NEWPORT LANES', 30, 60)
    c.textAlign = 'right'
    c.font = '26px monospace'
    c.fillStyle = '#8fae9d'
    const live = this.state === 'finished'
      ? 'SET COMPLETE'
      : `FRAME ${this.frame + 1}/${FRAMES}   BALL ${this.ballNumber + 1}`
    c.fillText(live, W - 30, 58)
    c.strokeStyle = '#2c3a33'
    c.lineWidth = 3
    c.beginPath(); c.moveTo(24, 78); c.lineTo(W - 24, 78); c.stroke()

    /* ---- the rack, in scoresheet orientation --------------
       Back row at the top, head pin at the bottom, so the
       diagram matches the way a bowler talks about it. */
    const cx = 152
    const top = 118
    const dx = 52
    const dy = 66
    let index = 0
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col <= row; col++) {
        const px = cx + (col - row / 2) * dx
        const py = top + (3 - row) * dy
        const up = this.standing[index]
        pinPath(c, px, py + 26, 52)
        if (up) {
          c.fillStyle = '#f4f1e6'
          c.fill()
          // The two neck bands, from the same profile as the model.
          c.strokeStyle = palette.accent
          c.lineWidth = 3
          for (const [a, b] of BANDS) {
            const y = py + 26 - ((a + b) / 2 / 15) * 52
            const r = (radiusAt((a + b) / 2) / 15) * 52
            c.beginPath(); c.moveTo(px - r, y); c.lineTo(px + r, y); c.stroke()
          }
        } else {
          c.fillStyle = '#1d2622'
          c.fill()
          c.strokeStyle = '#3d4a43'
          c.lineWidth = 2
          c.stroke()
          c.strokeStyle = '#6d7d74'
          c.lineWidth = 3
          const r = 12
          c.beginPath()
          c.moveTo(px - r, py + 26 - 30 - r); c.lineTo(px + r, py + 26 - 30 + r)
          c.moveTo(px + r, py + 26 - 30 - r); c.lineTo(px - r, py + 26 - 30 + r)
          c.stroke()
        }
        index++
      }
    }

    /* ---- scoresheet --------------------------------------- */
    const boxW = 172
    const boxH = 132
    const x0 = 372
    const y0 = 104
    c.textAlign = 'center'
    for (let f = 0; f < FRAMES; f++) {
      const bx = x0 + f * (boxW + 14)
      c.strokeStyle = f === this.frame && this.state !== 'finished' ? palette.accent : '#3a4a42'
      c.lineWidth = f === this.frame && this.state !== 'finished' ? 4 : 2
      c.strokeRect(bx, y0, boxW, boxH)
      c.fillStyle = '#6f8579'
      c.font = '20px monospace'
      c.fillText(`${f + 1}`, bx + 18, y0 + 26)

      const rolls = this.frames[f] ?? []
      const slots = f === FRAMES - 1 ? 3 : 2
      const sw = (boxW - 34) / slots
      c.font = 'bold 40px monospace'
      for (let s = 0; s < slots; s++) {
        const sx = bx + 30 + sw * s + sw / 2
        c.strokeStyle = '#2c3a33'
        c.lineWidth = 1
        c.strokeRect(bx + 30 + sw * s, y0 + 34, sw, 52)
        const mark = rollMark(rolls, s)
        if (!mark) continue
        c.fillStyle = mark === 'X' || mark === '/' ? palette.accentSoft : '#eae4c6'
        c.fillText(mark, sx, y0 + 76)
      }
      c.font = 'bold 34px monospace'
      c.fillStyle = '#eae4c6'
      const t = totals[f]
      c.fillText(t === null || t === undefined ? '·' : String(t), bx + boxW / 2, y0 + 120)
    }

    /* ---- the call ---------------------------------------- */
    const downNow = this.standing.filter((s) => !s).length
    c.textAlign = 'left'
    c.font = 'bold 48px monospace'
    c.fillStyle = '#eae4c6'
    c.fillText(`PINS DOWN ${downNow} / 10`, 372, 400)
    if (this.lastCall) {
      c.textAlign = 'right'
      c.font = 'bold 54px monospace'
      c.fillStyle = this.lastCall === 'MISS' ? '#6f8579' : palette.accent
      c.fillText(`${this.lastCall}!`, W - 34, 402)
    } else if (this.state === 'finished') {
      c.textAlign = 'right'
      c.font = 'bold 44px monospace'
      c.fillStyle = palette.accentSoft
      c.fillText(`SCORE ${this.score}`, W - 34, 400)
    }
    c.textAlign = 'left'
    c.font = '22px monospace'
    c.fillStyle = '#6f8579'
    c.fillText(this.state === 'finished' ? 'ENTER AT THE MARK TO PLAY AGAIN' : 'DRIVE INTO THE BALL', 30, 400)

    this.texture.needsUpdate = true
  }
}

/* ============================================================
   PIN GEOMETRY

   One lathe, one material, one draw call per pin. The two neck
   bands are vertex colours with the boundary rows duplicated,
   so the edge is a crease rather than a gradient — and the band
   radius comes from the profile instead of being guessed.
   ============================================================ */

function radiusAt(y: number): number {
  if (y <= PROFILE[0][1]) return PROFILE[0][0]
  for (let i = 1; i < PROFILE.length; i++) {
    const [r1, y1] = PROFILE[i]
    if (y > y1) continue
    const [r0, y0] = PROFILE[i - 1]
    const t = y1 === y0 ? 0 : (y - y0) / (y1 - y0)
    return r0 + (r1 - r0) * t
  }
  return 0
}

const inBand = (y: number): boolean => BANDS.some(([a, b]) => y >= a && y <= b)

function pinGeometry(): THREE.BufferGeometry {
  const ys = [...new Set([...PROFILE.map(([, y]) => y), ...BANDS.flat()])].sort((a, b) => a - b)
  const rows: { r: number; y: number; red: boolean }[] = [{ r: 0, y: 0, red: false }]
  for (let i = 0; i < ys.length; i++) {
    const y = ys[i]
    const r = radiusAt(y)
    const below = i > 0 ? inBand((ys[i - 1] + y) / 2) : null
    const above = i < ys.length - 1 ? inBand((y + ys[i + 1]) / 2) : null
    if (below === null) rows.push({ r, y, red: above === true })
    else if (above === null) rows.push({ r, y, red: below })
    else if (below === above) rows.push({ r, y, red: below })
    else { rows.push({ r, y, red: below }); rows.push({ r, y, red: above }) }
  }

  const geometry = new THREE.LatheGeometry(
    rows.map((p) => new THREE.Vector2(p.r * IN, p.y * IN)),
    18,
  )
  geometry.computeVertexNormals()

  const body = new THREE.Color('#f6f2e7')
  const band = new THREE.Color(palette.accent)
  const count = geometry.attributes.position.count
  const colours = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const c = rows[i % rows.length].red ? band : body
    colours[i * 3] = c.r
    colours[i * 3 + 1] = c.g
    colours[i * 3 + 2] = c.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3))
  return geometry
}

/** Convex hull of the same silhouette: a flat base that stands, a
 *  belly that clips its neighbours, and shape-derived mass properties. */
function pinHull(): Float32Array {
  const out: number[] = []
  const segments = 10
  for (const yIn of [0, 1.5, 4.5, 7.5, 10.0, 12.4, 14.0]) {
    const r = radiusAt(yIn) * IN
    const y = yIn * IN
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2
      out.push(Math.cos(a) * r, y, Math.sin(a) * r)
    }
  }
  out.push(0, PIN_H, 0)
  return new Float32Array(out)
}

/** Traces the pin silhouette on a 2D canvas, base at (cx, baseY). */
function pinPath(c: CanvasRenderingContext2D, cx: number, baseY: number, h: number): void {
  const k = h / 15
  c.beginPath()
  for (const [r, y] of PROFILE) c.lineTo(cx - r * k, baseY - y * k)
  for (let i = PROFILE.length - 1; i >= 0; i--) c.lineTo(cx + PROFILE[i][0] * k, baseY - PROFILE[i][1] * k)
  c.closePath()
}

/** Scoresheet glyph for ball `slot` of a frame. */
function rollMark(rolls: number[], slot: number): string {
  const v = rolls[slot]
  if (v === undefined) return ''
  if (v === 10) return 'X'
  if (slot > 0 && rolls[slot - 1] !== 10 && rolls[slot - 1] + v === 10) return '/'
  return v === 0 ? '-' : String(v)
}

/** Named `vecLength` so it cannot shadow `Array.length` at a glance. */
const vecLength = (v: { x: number; y: number; z: number }): number => Math.hypot(v.x, v.y, v.z)
