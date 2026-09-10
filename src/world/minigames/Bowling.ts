import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { Minigame } from './Minigame'
import { PLAY_SPOTS } from '@/content/world-environment'
import { palette } from '../core/palette'
import { clamp, damp, smoothstep } from '../core/maths'
import { chamferedBox } from '../world/geometry'
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
   model and the floating screen are original.

   THE ONE SCALE CONSTANT. Everything across the lane —
   width, gutters, pin pitch, pin height, ball diameter — is
   a regulation USBC dimension multiplied by S world units
   per metre. That is what fixes the old build, where the
   lane was authored at ~10 u/m and the pin rack at ~4 u/m,
   so a single ball spanned two pin positions.

   S is set by the CAR, not by the lane: the ball has to be
   something a 2.6-long chassis can shove without climbing
   over it, which puts its diameter near 1.5. Everything else
   follows from that — and none of it shrank when the island
   went to 70%, because the car did not shrink either.

   LANE LENGTH IS THE ONE THING NOT TO SCALE. A regulation
   lane is 17.3 lane-widths from the foul line to the head
   pin; at this scale that would be 128 world units of dead
   straight ground. The lane here is 32 units of bed — four
   lane-widths, still a miniature, but long enough that the
   throw is a throw: the ball rolls for two or three seconds
   and the line you took is visible for all of it. It was 12,
   which is close enough to the pins that aiming was the whole
   game and rolling was not part of it.

   ORIENTATION. The lane runs EAST TO WEST with the pins at
   the west end, because that is where the plan puts it. The
   venue is authored in its own space — +Z behind the bowler,
   −Z down-lane — and yawed into the world by `PLAY_SPOTS`'
   `rotation`. Static geometry lives in a child group that
   carries that transform; the eleven loose bodies do not,
   because physics hands their positions back in world space
   and a transformed parent would apply the yaw twice.

   IT IS A SLAB, NOT A BUILDING — AND IT HAS NO WALLS.

   It used to stand on a 2.4 m foundation cuboid whose flanks
   were retaining walls, with the playing surface 0.72 m above
   the highest ground under the footprint and 0.90 m above the
   respawn two metres away. Measured over 1.4 s of throttle
   the car made 3.5 m off that respawn against 11–19 m at
   every other one: it climbed the lip and beached itself, so
   the respawn was turned to face AWAY from its own venue.

   Now the surface sits CLEARANCE (6 cm) over the highest
   ground under the footprint, the slabs are thick enough that
   their undersides are buried at the lowest point, and an
   adaptive skirt ramps the whole perimeter down to the
   terrain with a real trimesh collider under it. The
   kickbacks, the approach rails, the masking unit and the
   scoreboard's housing collider are gone. What is left with a
   collider above the deck is exactly one thing: a 0.40 m kerb
   behind the pin deck, which is the only reason ten pins and
   a 1.35 kg ball do not end up on the north coast.
   ============================================================ */

/* ---- scale ------------------------------------------------ */

/** World units per real metre, across the lane. See the header. */
const S = 7
/** One inch, in world units. Every cross-lane number is USBC. */
const IN = 0.0254 * S

const LANE_W = 41.5 * IN        // 7.379  regulation lane width
const GUTTER_W = 9.25 * IN      // 1.645  regulation gutter
/** Flat verge outside the gutters. It carried the kickbacks; with
 *  those gone it is simply the strip that keeps the venue's edge a
 *  straight line for the skirt to meet. */
const VERGE_W = 0.5
const PIN_PITCH = 12 * IN       // 2.134  pin spot spacing
const ROW_PITCH = PIN_PITCH * Math.cos(Math.PI / 6) // 1.848 — equilateral
const PIN_H = 15 * IN           // 2.667  pin height
const BALL_R = 4.25 * IN        // 0.756  8.5 in diameter
const HALF_W = LANE_W / 2 + GUTTER_W + VERGE_W // 5.835 — the venue's half width

/** How far the playing surface stands over the highest ground under
 *  the venue. Six centimetres, not the old 0.72: enough that the
 *  slabs never surface through a rise, small enough that the skirt's
 *  own ground clamp (+0.04) is always below it, so the skirt's inner
 *  ring lands exactly on the deck instead of a few millimetres proud. */
const CLEARANCE = 0.06
/** Gutter channels, recessed below the lane. They were 0.6 deep —
 *  deeper than 0.6·BALL_R, so a gutter ball could not climb out. At
 *  ground level there is nowhere to recess to: 0.6 would put the
 *  channel floor half a metre under the terrain. So the channel is
 *  shallow and the job is done by the cross-fall instead. */
const GUTTER_DROP = 0.12
/** Three degrees of fall AWAY from the lane. A ball in the channel
 *  gets 0.5 m/s² sideways and runs off the venue edge, which the
 *  out-of-bounds test then resolves as a gutter ball. An inner rail
 *  would do it in one frame and would also be a wall. */
const GUTTER_FALL = (3 * Math.PI) / 180
/** The one remaining vertical. Knee-high, open above, and the only
 *  thing between a swept rack and the coast. */
const KERB_H = 0.4
const KERB_D = 0.5
/** How far the skirt runs out from the venue edge before it is on
 *  raw terrain. Three metres on the sides and the pin end; the
 *  bowler's end gets the full drive-up (APRON_Z − APPROACH_Z). */
const SKIRT_RUN = 3.0

/* ---- the venue, as z offsets from the spot centre ---------
   +Z is behind the bowler, -Z is down-lane. Nothing in this
   file is an absolute world coordinate; the three stale
   literals that used to live in tick() are gone. */
const APRON_Z = 46.0            // outer lip of the graded drive-up
const APPROACH_Z = 38.0         // back edge of the approach / venue edge
const FOUL_Z = 30.0
const DECK_Z = -2.0             // front edge of the pin deck
const HEAD_Z = -3.6             // the 1 pin
const DECK_BACK_Z = -10.6       // back edge of the pin deck
const BACK_Z = -16.0            // outer face of the kerb / venue edge
const BALL_HOME_Z = 26.0        // the ball waits a few lengths up the lane
const MARK_Z = 34.0             // where the car is set down

/** Three frames, scored by the ten-frame rules with the last frame
 *  taking a fill ball. A full game is twenty-one balls and twenty-one
 *  drives back to the mark; three frames is a set you finish. */
const FRAMES = 3
const SWEEP_TIME = 1.15

/* ---- the floating screen ---------------------------------
   It hangs off the venue's north flank, parallel to the lane,
   and slides ALONG the lane to stay level with the car. */
/** Clear of the skirt's outer edge (HALF_W + SKIRT_RUN = 8.83), so
 *  the board never floats over ground the car is driving on. */
const SCREEN_X = HALF_W + 4.2
/** Centre height above the deck. The board is 6 units tall, so its
 *  bottom edge is two units clear of a 2.667 pin. */
const SCREEN_Y = 5.0
/** Where it drifts back to: level with the targeting arrows, which
 *  is where you look from the mark anyway. */
const SCREEN_REST_Z = 10.0
const SCREEN_MIN_Z = DECK_Z + 4
const SCREEN_MAX_Z = APPROACH_Z + 2
/** Beyond this distance from the lane the board stops following. 34
 *  covers the whole venue plus its forecourt without the board
 *  chasing a car that has left for SOCIAL. */
const SCREEN_RANGE = 34
/** damp() lambda. 2.6 settles ~90% of a step in a second: fast
 *  enough to keep up with a car at 10 m/s, slow enough to read as
 *  drifting rather than snapping. */
const SCREEN_LAMBDA = 2.6

/* ---- the pin diagram, in canvas pixels --------------------
   scripts/world-bowling-qa.mjs samples the middle of each
   indicator at these exact numbers to prove the screen never
   shows a pin that is not there. THEY ARE A CONTRACT: move
   one and the sampler reads background, `lit` comes back all
   false, and the harness's central check passes while
   measuring nothing. Change these four and change them there,
   in the same commit. */
const BOARD_PX_W = 1024
const BOARD_PX_H = 560
const DIAG_CX = 512
const DIAG_TOP = 106
const DIAG_DX = 200
const DIAG_DY = 132
/** Silhouette height in pixels. The base of each pin sits 26 px
 *  below its row line, which puts the harness's sample (row + 10)
 *  sixteen pixels up the belly, where the profile is 16 px wide. */
const DIAG_PIN = 118
/** Board plane, sized from the canvas so nothing is stretched. */
const BOARD_W = 11
const BOARD_H = (BOARD_W * BOARD_PX_H) / BOARD_PX_W

/** USBC pin silhouette, (radius, height) in inches. The lathe, the
 *  physics hull and the screen diagram are all built from this one
 *  list, so the model, the collider and the readout cannot drift
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
  /** The venue's yaw, and its sin/cos. Every local↔world conversion in
   *  this file goes through `wx`/`wz`/`lx`/`lz` so there is exactly one
   *  place the orientation is expressed. */
  private yaw = 0
  private cosYaw = 1
  private sinYaw = 0
  /** Static geometry, in venue-local space, carrying the transform. */
  private venue = new THREE.Group()
  private floorY = 0
  /** Slab thickness. Derived, not authored: it is whatever buries the
   *  underside below the lowest ground anywhere under the venue. */
  private slab = 0.34
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

  /* ---- the screen ---- */
  private canvas!: HTMLCanvasElement
  private texture!: THREE.CanvasTexture
  private painted = ''
  /** Carries the yaw and the position. Its yaw is set ONCE. */
  private screen!: THREE.Group
  /** Carries the lean and the micro-roll, inside the yawed frame. */
  private board!: THREE.Group
  private screenZ = SCREEN_REST_Z
  private sweepBar!: THREE.Mesh
  /** Shared by the ten pins and the two giant totems. */
  private pinMaterial!: THREE.Material

  constructor(game: Game, bin: Bin) {
    super(game, bin)
    this.abandonRadius = 66
  }

  /* ---- venue space ↔ world space --------------------------
     Local (dx, dz) is the venue's own frame: +Z behind the
     bowler, −Z down-lane, +X the bowler's left. */
  private wx(dx: number, dz: number): number { return this.at.x + dx * this.cosYaw + dz * this.sinYaw }
  private wz(dx: number, dz: number): number { return this.at.z - dx * this.sinYaw + dz * this.cosYaw }
  private lx(x: number, z: number): number { return (x - this.at.x) * this.cosYaw - (z - this.at.z) * this.sinYaw }
  private lz(x: number, z: number): number { return (x - this.at.x) * this.sinYaw + (z - this.at.z) * this.cosYaw }
  /** The heading that faces a car down the lane. */
  private get downLane(): number { return Math.atan2(this.cosYaw, -this.sinYaw) }
  /** Terrain under a venue-local point. */
  private groundAt(dx: number, dz: number): number {
    return this.game.terrain.colliderHeightAt(this.wx(dx, dz), this.wz(dx, dz))
  }

  /* ==========================================================
     BUILD
     ========================================================== */

  build(): void {
    const spot = PLAY_SPOTS.find((p) => p.id === 'bowling')!
    this.at.x = spot.x
    this.at.z = spot.z
    this.yaw = 'rotation' in spot ? spot.rotation : 0
    this.cosYaw = Math.cos(this.yaw)
    this.sinYaw = Math.sin(this.yaw)
    this.venue.position.set(this.at.x, 0, this.at.z)
    this.venue.rotation.y = this.yaw
    this.group.add(this.venue)

    /*
      TWO NUMBERS OFF ONE PROBE OF THE VENUE RECTANGLE.

      `highest` sets the deck: at CLEARANCE over it, no rise under the
      footprint can surface through the slabs. `lowest` sets how THICK
      the slabs are, so their undersides stay buried at the low corner
      — otherwise the lane reads as a plank lying on a field. Neither
      is a lip: the skirt ramps the difference away.

      colliderHeightAt samples a 1.3 m grid, so a 1.5 m probe grid is
      already at the resolution the physics floor actually has.
    */
    let highest = -Infinity
    let lowest = Infinity
    for (let dz = BACK_Z; dz <= APPROACH_Z; dz += 1.5) {
      for (let dx = -HALF_W; dx <= HALF_W; dx += 1.5) {
        const h = this.groundAt(dx, dz)
        if (h > highest) highest = h
        if (h < lowest) lowest = h
      }
    }
    this.floorY = highest + CLEARANCE
    this.slab = clamp(this.floorY - lowest + 0.2, 0.34, 2.5)
    const floorY = this.floorY

    this.startPosition.set(this.wx(0, MARK_Z), floorY + 1.5, this.wz(0, MARK_Z))
    this.ballHome.set(this.wx(0, BALL_HOME_Z), floorY + BALL_R + 0.02, this.wz(0, BALL_HOME_Z))

    this.buildStructure()
    this.buildMarkings()
    this.buildPins()
    this.buildBall()
    this.buildScreen()
    this.buildSignage()
    this.buildDressing()

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
    // sweep bar, the floating screen and the between-games watchdog. It
    // runs whether or not a set is live, which is what recovers a ball
    // the player nudged off the lane on their way past — and it is why
    // the screen tracks the car when nobody is playing.
    const tick = () => this.frameTick()
    this.game.ticker.events.on('tick', tick, 12)
    this.bin.add(() => this.game.ticker.events.off('tick', tick))
    this.paint()
  }

  /* ---- lane, gutters, deck, run-out, kerb, skirt ----------- */

  private buildStructure(): void {
    const floorY = this.floorY
    const slab = this.slab
    const m = this.game.materials

    const maple = m.tinted('#d9b981', 0.62)
    const approachWood = m.tinted('#8a6f4c', 0.72)
    const deckWood = m.tinted('#e6cfa2', 0.55)
    const channel = m.tinted('#39443e', 0.85)
    const runOut = m.tinted('#6d6152', 0.8)
    const kerbStone = m.tinted(palette.concreteDark, 0.9)

    // One fixed body for the whole venue. Per-collider friction and
    // category, so the gutters can be slick and the lane grippy
    // without eight separate rigid bodies — and so scripts/_probe.mjs
    // keeps finding the venue by "the static body here with the most
    // colliders".
    const colliders: ColliderDescription[] = []
    const box = (
      w: number, h: number, d: number,
      x: number, yTop: number, z: number,
      material: THREE.Material,
      options: { friction?: number; solid?: boolean; roll?: number } = {},
    ) => {
      const { friction = 0.6, solid = true, roll = 0 } = options
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
      mesh.position.set(x, yTop - h / 2, z)
      mesh.rotation.z = roll
      mesh.receiveShadow = true
      this.venue.add(mesh)
      if (solid) {
        // Collider offsets are LOCAL to the body, and the body carries
        // the venue's yaw — so these are the same numbers as the mesh's
        // and the two cannot drift apart when the venue is rotated.
        colliders.push({
          shape: 'cuboid',
          parameters: [w / 2, h / 2, d / 2],
          position: { x, y: mesh.position.y, z },
          quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, roll)),
          category: 'floor',
          friction,
        })
      }
      return mesh
    }

    const laneLen = FOUL_Z - DECK_Z
    const deckLen = DECK_Z - DECK_BACK_Z
    const approachLen = APPROACH_Z - FOUL_Z
    const runOutLen = DECK_BACK_Z - BACK_Z
    const gutterX = LANE_W / 2 + GUTTER_W / 2

    /*
      EVERY PLAYING SURFACE HAS ITS TOP AT floorY.

      box() treats its y parameter as the TOP face, so one number
      describes the whole venue's height and there is no plinth left to
      get wrong. The thickness is `slab` for all of them, which is not
      a look — it is the depth that buries the underside at the venue's
      lowest corner so no slab is ever seen edge-on from the field.
    */
    // Approach — a visibly different, matte surface. This is where the
    // car is set down and where the venue names itself.
    box(HALF_W * 2, slab, approachLen, 0, floorY, (APPROACH_Z + FOUL_Z) / 2, approachWood, { friction: 0.7 })
    // Lane bed.
    box(LANE_W, slab, laneLen, 0, floorY, (FOUL_Z + DECK_Z) / 2, maple, { friction: 0.62 })
    // Pin deck — pale maple, its own surface, as on a real lane.
    box(LANE_W, slab, deckLen, 0, floorY, (DECK_Z + DECK_BACK_Z) / 2, deckWood, { friction: 0.55 })
    // Run-out. It replaces the pit, which was a 0.6 m hole that ended
    // a throw by swallowing the ball; flush, it ends nothing, so the
    // kerb and the bounds test in tick() do that job instead.
    box(LANE_W + GUTTER_W * 2, slab, runOutLen, 0, floorY, (DECK_BACK_Z + BACK_Z) / 2, runOut, { friction: 0.5 })
    // Verges: the half-metre strip outside each gutter. Without it the
    // car drops through a 0.5 m slot between the gutter's outer edge
    // and the skirt's inner edge for the whole length of the lane.
    for (const sx of [-1, 1]) {
      box(VERGE_W, slab, FOUL_Z - BACK_Z, sx * (HALF_W - VERGE_W / 2), floorY, (FOUL_Z + BACK_Z) / 2, approachWood, { friction: 0.7 })
    }
    // Gutters: shallow channels, slick, falling away from the lane.
    for (const sx of [-1, 1]) {
      box(
        GUTTER_W, slab, FOUL_Z - DECK_BACK_Z,
        sx * gutterX, floorY - GUTTER_DROP, (FOUL_Z + DECK_BACK_Z) / 2,
        channel,
        // The roll is about the venue's own Z, which runs down the
        // lane, so it tips the channel across it. NEGATIVE sx: a
        // positive rotation about +Z lifts the +X side, and the +X
        // side of the +X gutter is the one that has to fall away.
        { friction: 0.14, roll: -sx * GUTTER_FALL },
      )
    }
    // The kerb. The masking unit that used to do this was 3.6 m tall
    // and eleven wide — a wall you could not see the pins over. This
    // is 0.40, which a pin cannot climb and a camera does not notice.
    box(HALF_W * 2, KERB_H + slab, KERB_D, 0, floorY + KERB_H, BACK_Z + KERB_D / 2, kerbStone, { friction: 0.6 })

    this.buildSkirt(colliders)

    this.game.physics.add({
      type: 'fixed',
      position: new THREE.Vector3(this.at.x, 0, this.at.z),
      rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw, 0)),
      colliders,
    })
  }

  /**
   * The skirt: one adaptive ring from the venue's edge down to the
   * terrain, on all four sides.
   *
   * The old build had a graded apron at the bowler's end ONLY, because
   * that was the only side a car was expected to arrive from. The
   * other three were the plinth's retaining walls. With those gone,
   * every edge needs the same treatment or the venue is a 0.4 m step
   * on three sides instead of a wall on three sides.
   *
   * It is built as a ring rather than four strips because four strips
   * leave four corner gaps, and a corner gap in the floor is a hole
   * the car falls into. Inner and outer boundaries are the venue
   * rectangle and the same rectangle grown per side, mapped through
   * the same (u, v) so the corners mitre.
   */
  private buildSkirt(colliders: ColliderDescription[]): void {
    const a = HALF_W
    const zc = (BACK_Z + APPROACH_Z) / 2
    const half = (APPROACH_Z - BACK_Z) / 2
    // The bowler's end runs out to the old apron lip: that is the side
    // the car drives up, and 8 m of it is 0.7° on the measured relief.
    const drive = APRON_Z - APPROACH_Z

    const inner = (u: number, v: number): [number, number] => [u * a, zc + v * half]
    const outer = (u: number, v: number): [number, number] => [
      u * (a + SKIRT_RUN),
      zc + v * (half + (v > 0 ? drive : SKIRT_RUN)),
    ]

    // Roughly one ring sample every 2.5 m of perimeter, four radial
    // steps across the run. 54 × 5 vertices — small enough to be a
    // trimesh collider without thinking about it.
    const nz = Math.max(2, Math.ceil(half * 2 / 2.5))
    const nx = Math.max(2, Math.ceil(a * 2 / 2.5))
    const ring: [number, number][] = []
    for (let i = 0; i < nz; i++) ring.push([-1, -1 + (2 * i) / nz])
    for (let i = 0; i < nx; i++) ring.push([-1 + (2 * i) / nx, 1])
    for (let i = 0; i < nz; i++) ring.push([1, 1 - (2 * i) / nz])
    for (let i = 0; i < nx; i++) ring.push([1 - (2 * i) / nx, -1])

    const steps = 4
    const verts: number[] = []
    for (const [u, v] of ring) {
      const [ix, iz] = inner(u, v)
      const [ox, oz] = outer(u, v)
      for (let k = 0; k <= steps; k++) {
        const t = k / steps
        const x = ix + (ox - ix) * t
        const z = iz + (oz - iz) * t
        // +0.04 is below CLEARANCE, so at t = 0 this always resolves to
        // floorY and the ring's inner edge is flush with the deck; at
        // t = 1 it is a four-centimetre film over the terrain, which is
        // the same tolerance the old apron used and is not a step.
        const ground = this.groundAt(x, z) + 0.04
        const s = smoothstep(t, 0, 1)
        verts.push(x, Math.max(ground, this.floorY * (1 - s) + ground * s), z)
      }
    }

    const rows = steps + 1
    const index: number[] = []
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length
      for (let k = 0; k < steps; k++) {
        const a0 = i * rows + k
        const a1 = i * rows + k + 1
        const b0 = j * rows + k
        const b1 = j * rows + k + 1
        index.push(a0, a1, b1, a0, b1, b0)
      }
    }
    // Winding is checked, not assumed: a ring built the wrong way round
    // is invisible under FrontSide and reads as a hole in the floor.
    const nx0 = verts[index[1] * 3] - verts[index[0] * 3]
    const nz0 = verts[index[1] * 3 + 2] - verts[index[0] * 3 + 2]
    const mx0 = verts[index[2] * 3] - verts[index[0] * 3]
    const mz0 = verts[index[2] * 3 + 2] - verts[index[0] * 3 + 2]
    if (nz0 * mx0 - nx0 * mz0 < 0) {
      for (let i = 0; i < index.length; i += 3) {
        const swap = index[i + 1]
        index[i + 1] = index[i + 2]
        index[i + 2] = swap
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    geometry.setIndex(index)
    geometry.computeVertexNormals()
    const mesh = new THREE.Mesh(geometry, this.game.materials.tinted('#9c9276', 0.95))
    mesh.receiveShadow = true
    this.venue.add(mesh)

    // Same body, same local frame — so the skirt cannot drift from the
    // slabs it meets, whatever the venue's yaw.
    colliders.push({
      shape: 'trimesh',
      parameters: [new Float32Array(verts), new Uint32Array(index)],
      category: 'floor',
      friction: 0.85,
    })
  }

  /* ---- painted markings ------------------------------------ */

  private buildMarkings(): void {
    /*
      ON the lane, not over it. These were all at
      `floorY + BASE / 2 + 0.008`, which was written against an earlier
      box() whose y parameter was the CENTRE of the slab. Once box()
      started taking the TOP, every board line, the foul line, the
      seven arrows, the ten pin spots and both laid signs floated
      0.32 m above the bed — mid-shin on a 2.667 m pin.
    */
    const y = this.floorY + 0.008
    const m = this.game.materials
    const line = m.tinted('#b8925c', 0.7)
    const paint = m.tinted('#7d5f3a', 0.7)

    // Thirty-nine boards is regulation; nine drawn lines is enough to
    // read the lane as planked without nine geometries.
    for (let i = 1; i < 9; i++) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.01, FOUL_Z - DECK_BACK_Z), line)
      mesh.position.set(-LANE_W / 2 + (i * LANE_W) / 9, y, (FOUL_Z + DECK_BACK_Z) / 2)
      this.venue.add(mesh)
    }
    // Foul line.
    const foul = new THREE.Mesh(new THREE.BoxGeometry(LANE_W + GUTTER_W * 2, 0.012, 0.22), m.tinted(palette.accent, 0.6))
    foul.position.set(0, this.floorY + 0.012, FOUL_Z)
    this.venue.add(foul)

    // The seven targeting arrows. Free guidance, no UI, and they are
    // what makes aiming the car a decision.
    const arrow = new THREE.CircleGeometry(0.3, 3)
    for (let k = -3; k <= 3; k++) {
      const mesh = new THREE.Mesh(arrow, paint)
      mesh.rotation.x = -Math.PI / 2
      // Sixteen units up the lane, so the arrows sit where the eye
      // wants them on a bed four lane-widths long rather than bunched
      // against the pin deck.
      mesh.position.set((k * LANE_W) / 8, this.floorY + 0.01, 12 + Math.abs(k) * 1.6)
      this.venue.add(mesh)
    }
    // Ten pin spots, so the rack has a home even when it is empty.
    const dot = new THREE.CircleGeometry(0.24, 12)
    for (const { dx, dz } of this.rackSpots()) {
      const mesh = new THREE.Mesh(dot, paint)
      mesh.rotation.x = -Math.PI / 2
      mesh.position.set(dx, this.floorY + 0.01, dz)
      this.venue.add(mesh)
    }

    // Sweep bar: a visual pinsetter beat, so the re-rack is a machine
    // doing something rather than ten pins popping out of existence.
    this.sweepBar = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_W - 0.1, 0.75, 0.2),
      m.tinted(palette.accentDeep, 0.6),
    )
    this.sweepBar.visible = false
    this.sweepBar.rotation.y = this.yaw
    this.group.add(this.sweepBar)
    this.parkSweep()
  }

  /** Authored rack transforms: an equilateral 1/2/3/4 triangle.
   *  Both frames, because the deck markings are drawn in venue space
   *  and the pin bodies live in world space. */
  private rackSpots(): { dx: number; dz: number; x: number; z: number; number: number }[] {
    const out: { dx: number; dz: number; x: number; z: number; number: number }[] = []
    let n = 1
    for (let row = 0; row < 4; row++) {
      // The bowler faces -Z, so their left hand points at -X: iterating
      // col upward numbers 7-8-9-10 left to right FROM THE MARK, which
      // is the only ordering the score diagram can be read against.
      for (let col = 0; col <= row; col++) {
        const dx = (col - row / 2) * PIN_PITCH
        const dz = HEAD_Z - row * ROW_PITCH
        out.push({ dx, dz, x: this.wx(dx, dz), z: this.wz(dx, dz), number: n++ })
      }
    }
    return out
  }

  /* ---- pins ------------------------------------------------ */

  private buildPins(): void {
    const geometry = pinGeometry()
    this.pinMaterial = this.game.materials.own(new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.42, metalness: 0.02,
    }))
    const hull = pinHull()
    const shadows = this.game.quality.settings.shadows

    for (const spot of this.rackSpots()) {
      const mesh = new THREE.Mesh(geometry, this.pinMaterial)
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

  /* ---- the floating screen --------------------------------- */

  /*
    IT FLOATS, IT FOLLOWS, AND IT IS ONLY A PIN DIAGRAM.

    The old board stood on legs behind a 12 × 4.4 × 1.0 collider,
    yawed −π/2 + 0.55 so it faced up the lane from one fixed point.
    Two things were wrong with it. The yaw meant it was only readable
    from the mark — square-on at the approach, edge-on for the whole
    second half of a throw. And it was a solid object 1.4 units
    outside the venue, so the one place you could not drive was beside
    your own lane.

    This one is a child of `this.venue`, so the venue's yaw is applied
    exactly once and the board is PARALLEL to the lane by construction
    rather than by a number that has to be kept in step with
    PLAY_SPOTS' rotation. Its own yaw is set once, here, and never
    touched again: the tracking only ever writes `position.z`.
  */
  private buildScreen(): void {
    this.canvas = document.createElement('canvas')
    this.canvas.width = BOARD_PX_W
    this.canvas.height = BOARD_PX_H
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.bin.add(() => this.texture.dispose())

    const m = this.game.materials

    this.screen = new THREE.Group()
    // −π/2 turns the plane's +Z normal to face local −X: across the
    // lane, from the north flank, for every position it ever takes.
    this.screen.rotation.y = -Math.PI / 2
    this.screen.position.set(SCREEN_X, this.floorY + SCREEN_Y, SCREEN_REST_Z)
    this.venue.add(this.screen)

    // The lean and the roll live one level down, because inside the
    // yawed frame local X is the board's width axis and local Z is its
    // normal — so rotation.x tips the top back and rotation.z rolls it
    // in its own plane. Applied to the yawed group instead, both would
    // fight the yaw.
    this.board = new THREE.Group()
    this.board.rotation.x = -0.06
    this.screen.add(this.board)

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_W + 0.6, BOARD_H + 0.6, 0.3),
      m.tinted(palette.voidDark2, 0.85),
    )
    frame.castShadow = this.game.quality.settings.shadows
    this.board.add(frame)

    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(BOARD_W, BOARD_H),
      // Basic and un-tone-mapped: in daylight a lit material puts the
      // sun's own exposure over the readout, and the pin diagram is the
      // one thing that has to stay legible at noon.
      m.own(new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false })),
    )
    face.position.set(0, 0, 0.17)
    this.board.add(face)

    // Under-glow. Unlit geometry, which is how this world makes a
    // light: the scene has two lights and adding a third recompiles
    // every lit material for something that is invisible at noon.
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(BOARD_W + 0.6, 0.18),
      m.get('emissiveAccent'),
    )
    glow.position.set(0, -(BOARD_H + 0.6) / 2 - 0.14, 0.17)
    this.board.add(glow)

    // Two hangers reaching up to the rail buildDressing() hangs over
    // the whole of the board's travel, so it reads as running on a
    // track rather than levitating for no reason.
    for (const sx of [-1, 1]) {
      const rod = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 1.2, 0.12),
        m.tinted(palette.metal, 0.5, 0.4),
      )
      rod.position.set(sx * (BOARD_W / 2 - 1.2), (BOARD_H + 0.6) / 2 + 0.6, 0)
      this.board.add(rod)
    }
  }

  /* ---- signage --------------------------------------------- */

  private buildSignage(): void {
    const m = this.game.materials
    const lay = (text: string, size: number, dz: number, material: THREE.Material) => {
      const { geometry, width } = textGeometry(text, { size, weight: 0.17, depth: 0.08, align: 'center' })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.rotation.x = -Math.PI / 2
      const fit = Math.min(1, (LANE_W + GUTTER_W * 2) / width)
      mesh.scale.setScalar(fit)
      mesh.position.set(0, this.floorY + 0.012, dz)
      this.venue.add(mesh)
    }
    lay('NEWPORT LANES', 1.05, APPROACH_Z - 2.6, m.tinted(palette.chalk, 0.6))
    lay('PUSH THE BALL', 0.52, APPROACH_Z - 5.4, m.tinted('#c9b48b', 0.7))
  }

  /* ---- set dressing ---------------------------------------- */

  /*
    NOTHING HERE CARRIES A COLLIDER.

    That is the rule for this venue now, and it is not squeamishness:
    the whole point of the rebuild is that the only things a car can
    hit at NEWPORT LANES are the deck it drives on and one 0.40 m
    kerb. A ten-metre pin totem with a post collider is a wall by
    another name for anybody who takes a wide line, and the venue has
    just spent a pass getting rid of those.

    The knockables in this district come from World.scatterProps
    (barrier ×10, cone ×14, crate ×8 over the district disc), which
    already reserves against a shared instance budget — cone's is 60
    at the low tier against about 80 placements island-wide — so this
    file adds none of its own rather than being the call that silently
    runs the pool dry.

    Static geometry is merged by material: masts, rail and rack are
    one draw call, and the two pennant colours are one each.
  */
  private buildDressing(): void {
    const m = this.game.materials
    const shadows = this.game.quality.settings.shadows
    const metal: THREE.BufferGeometry[] = []
    const stone: THREE.BufferGeometry[] = []
    const flags: Record<'accent' | 'chalk', THREE.BufferGeometry[]> = { accent: [], chalk: [] }

    const put = (
      bucket: THREE.BufferGeometry[],
      geometry: THREE.BufferGeometry,
      x: number, y: number, z: number,
      rotation?: THREE.Euler,
    ) => {
      /*
        NORMALISE BEFORE MERGING, HERE, ONCE.

        mergeGeometries rejects a bucket whose members disagree about
        either indexing or attributes, returns null and logs — so the
        bucket silently disappears with no exception to catch. Our
        pieces disagree about both: chamferedBox is unindexed with
        position + normal, BoxGeometry and PlaneGeometry are indexed
        and carry uv. Stripping both here is cheaper than remembering
        which family a call site is in.
      */
      const piece = geometry.index ? geometry.toNonIndexed() : geometry
      if (piece !== geometry) geometry.dispose()
      piece.deleteAttribute('uv')
      piece.applyMatrix4(new THREE.Matrix4().compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(rotation ?? new THREE.Euler()),
        new THREE.Vector3(1, 1, 1),
      ))
      bucket.push(piece)
    }

    /* ---- giant pin totems ----------------------------------
       The venue's own lathe at 3.2×, so the thing you can see from a
       hundred metres is literally the thing you are knocking over.
       Flanking the pin end, where they close the view down the lane
       from the mark and are nowhere near the drive-up. */
    const totemGeometry = pinGeometry()
    totemGeometry.scale(3.2, 3.2, 3.2)
    for (const sx of [-1, 1]) {
      // Clear of the skirt's outer edge (HALF_W + SKIRT_RUN = 8.83) by
      // more than the plinth's half width, so the plinth stands on
      // terrain rather than half-sunk in the ramp.
      const dx = sx * (HALF_W + 4.6)
      const dz = DECK_Z - 4
      const base = this.groundAt(dx, dz)
      const totem = new THREE.Mesh(totemGeometry, this.pinMaterial)
      totem.castShadow = shadows
      totem.position.set(dx, base + 1.6, dz)
      this.venue.add(totem)
      // The plinth is 3 m deep and shows 1.6: the rest is buried, so
      // it cannot hang in the air wherever the dune happens to fall.
      put(stone, chamferedBox(2.6, 3.0, 2.6, 0.1), dx, base + 0.1, dz)
    }

    /* ---- the screen's rail ---------------------------------
       A track the length of the board's travel, on two masts placed
       outside it so the board never passes through one. Its underside
       lands exactly on the tops of the board's two hangers. */
    const railTop = this.floorY + SCREEN_Y + (BOARD_H + 0.6) / 2 + 1.35
    const railFrom = SCREEN_MIN_Z - 3
    const railTo = SCREEN_MAX_Z + 3
    put(metal, new THREE.BoxGeometry(0.3, 0.3, railTo - railFrom), SCREEN_X, railTop, (railFrom + railTo) / 2)
    for (const dz of [railFrom, railTo]) {
      const base = this.groundAt(SCREEN_X, dz)
      put(metal, new THREE.BoxGeometry(0.42, railTop - base + 0.4, 0.42), SCREEN_X, (railTop + base - 0.4) / 2, dz)
    }

    /* ---- ball-return rack ----------------------------------
       Where the ball you are about to push is supposed to have come
       from. Its top shows 0.55 and the rest is buried, for the same
       reason as the plinths — it stands on the skirt's slope. */
    const rackX = HALF_W + 1.5
    const rackZ = (APPROACH_Z + FOUL_Z) / 2
    const rackTop = this.floorY + 0.55
    put(metal, chamferedBox(1.5, 1.6, 6.0, 0.08), rackX, rackTop - 0.8, rackZ)
    // Geometry and material are shared by the three, and every mesh
    // here hangs off this.group — bin.object3D traverse-disposes it.
    const spare = new THREE.SphereGeometry(BALL_R, 16, 12)
    const spareMaterial = m.tinted(palette.accentDeep, 0.24, 0.3)
    for (const k of [-1, 0, 1]) {
      // Static, not dynamic. A loose ball parked beside the approach
      // rolls onto the lane the first time anybody clips the rack, and
      // then there are two balls among the pins.
      const ball = new THREE.Mesh(spare, spareMaterial)
      ball.castShadow = shadows
      ball.position.set(rackX, rackTop + BALL_R * 0.75, rackZ + k * 1.9)
      this.venue.add(ball)
    }

    /* ---- the neon ------------------------------------------
       Unlit, so it punches through the tone map at noon; there is no
       night here to switch it on for. */
    const neonSize = 1.3
    const strike = textGeometry('STRIKE', { size: neonSize, weight: 0.22, depth: 0.28, align: 'center' })
    const neon = new THREE.Mesh(strike.geometry, m.get('emissiveAccent'))
    // textGeometry puts the BASELINE at y = 0 and reads along +X, so
    // the yaw that faces the lettering at the lane also turns its
    // reading direction down-lane, which is the way it is read from.
    neon.position.set(-(HALF_W + 2.2), this.floorY + 2.4, DECK_Z - 3)
    neon.rotation.y = Math.PI / 2
    this.venue.add(neon)
    put(
      metal, new THREE.BoxGeometry(0.24, neonSize * 2.0, strike.width + 1.2),
      -(HALF_W + 2.4), this.floorY + 2.4 + neonSize / 2, DECK_Z - 3,
    )

    /* ---- bunting -------------------------------------------
       Six masts down the south flank with five pennants a span. The
       cheapest possible "this is a place" signal, and it is on the
       side the screen is not, so neither crowds the other. */
    const buntZ = [4, 11.2, 18.4, 25.6, 32.8, 40]
    const buntX = -(HALF_W + 2.6)
    const mastTop: number[] = []
    for (const dz of buntZ) {
      const base = this.groundAt(buntX, dz)
      mastTop.push(base + 3.6)
      put(metal, new THREE.BoxGeometry(0.16, 4.0, 0.16), buntX, base + 1.8, dz)
    }
    const pennant = new THREE.PlaneGeometry(0.62, 0.5)
    for (let s = 0; s < buntZ.length - 1; s++) {
      for (let p = 1; p <= 5; p++) {
        const f = p / 6
        const dz = buntZ[s] + (buntZ[s + 1] - buntZ[s]) * f
        // A straight line of flags between two masts reads as a rail.
        // The parabola is what makes it a string.
        const y = mastTop[s] + (mastTop[s + 1] - mastTop[s]) * f - 0.9 * 4 * f * (1 - f) - 0.3
        put(
          flags[(s + p) % 2 === 0 ? 'accent' : 'chalk'], pennant.clone(),
          buntX, y, dz,
          new THREE.Euler(0, Math.PI / 2, 0.42),
        )
      }
    }
    pennant.dispose()

    const bake = (pieces: THREE.BufferGeometry[], material: THREE.Material) => {
      if (!pieces.length) return
      const merged = mergeGeometries(pieces)
      for (const piece of pieces) piece.dispose()
      if (!merged) return
      const mesh = new THREE.Mesh(merged, material)
      mesh.castShadow = shadows
      mesh.receiveShadow = true
      this.venue.add(mesh)
    }
    bake(metal, m.tinted(palette.metal, 0.5, 0.4))
    bake(stone, m.tinted(palette.concreteDark, 0.9))
    // Bespoke rather than materials.flat(), which is FrontSide: a
    // single-sided pennant vanishes from half the approaches to the
    // venue, which is exactly the half a car arrives from.
    for (const [side, colour] of [['accent', palette.accent], ['chalk', palette.chalk]] as const) {
      bake(flags[side], m.own(new THREE.MeshBasicMaterial({
        color: colour, side: THREE.DoubleSide, toneMapped: false,
      })))
    }
  }

  /* ==========================================================
     LIFECYCLE
     ========================================================== */

  start(): boolean {
    if (this.running) return true
    super.start()
    this.origin.copy(this.startPosition)
    this.game.vehicle.moveTo(this.startPosition, this.downLane)
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
    this.game.vehicle.moveTo(this.startPosition, this.downLane)
    this.game.audio.blip()
  }

  /* ==========================================================
     THE THROW
     ========================================================== */

  /**
   * The ball is still in the throw while it is on the venue or its
   * skirt.
   *
   * This used to be `p.y > floorY - 3` and nothing else, which worked
   * only because a ball that left the deck fell 0.6 m into the pit. On
   * a flat lane it never falls: a ball nudged sideways off the bed
   * rolled away across the field with `inPlay` still true, the settle
   * test never fired because the ball was still moving, and the throw
   * ran to the fourteen-second timeout instead of resolving as the
   * gutter ball it was.
   */
  private inBounds(p: THREE.Vector3): boolean {
    if (p.y < this.floorY - 3) return false
    const dz = this.lz(p.x, p.z)
    if (dz < BACK_Z - 6 || dz > APRON_Z + 6) return false
    return Math.abs(this.lx(p.x, p.z)) < HALF_W + 6
  }

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
    const inPlay = this.inBounds(p)
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

    /*
      ONLY PINS STILL ON THE DECK COUNT AS MOVING.

      A pin knocked off the deck lands on a flat surface and never
      quite sleeps: Rapier keeps it micro-jittering just above these
      thresholds for ever. With every fallen pin voting, `settled`
      never reached 0.65 and EVERY throw ran to the fourteen-second
      timeout instead — half a minute per ball on a three-frame set.

      Whether a pin off the deck is still rolling has no bearing on
      whether the throw is over. It is already down; it was counted the
      moment it left the deck.
    */
    const onDeck = (pin: Pin) => {
      const p = pin.physical.current.position
      const dx = this.lx(p.x, p.z)
      const dz = this.lz(p.x, p.z)
      return Math.abs(dx) < LANE_W / 2 + 1 && dz > DECK_BACK_Z - 1 && dz < DECK_Z + 1
    }
    const pinsMoving = this.pins.some((pin) => {
      if (!pin.physical.body.isEnabled()) return false
      if (!onDeck(pin)) return false
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
   * deck, or OFF the deck — laterally into a gutter, back past the
   * kerb or forward onto the lane. The old build tested tilt alone, so
   * a pin shoved clean off the deck while upright scored as standing.
   */
  private isDown(pin: Pin): boolean {
    if (!pin.physical.body.isEnabled()) return true
    const q = pin.physical.current.quaternion
    if (1 - 2 * (q.x * q.x + q.z * q.z) < 0.64) return true
    const p = pin.physical.current.position
    if (p.y < this.floorY - 0.3) return true
    // Measured in VENUE space. Written in world x/z — as it was — this
    // test only agrees with the deck while the venue happens to be
    // axis-aligned, and the lane runs east-west now.
    if (Math.abs(this.lx(p.x, p.z)) > LANE_W / 2 + 0.15) return true
    const dz = this.lz(p.x, p.z)
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
        new THREE.Vector3(this.wx(0, HEAD_Z - ROW_PITCH), this.floorY + 2.4, this.wz(0, HEAD_Z - ROW_PITCH)),
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
    /*
      RE-READ THE RACK BEFORE THE NEXT BALL.

      `standing` latches: during a roll a pin is marked down and never
      un-marked, which is the debounce that stops the diagram flickering
      while ten bodies are bouncing off each other. The cost is that
      anything which happens to a pin AFTER the throw resolved — the
      sweep bar catching a leaner, a pin walking off the deck edge as it
      settles — never reached the board, and the player lined up the
      next ball against a diagram showing a pin that was no longer
      there.

      Between balls the rack on the deck is simply the truth, so take it.
    */
    for (let i = 0; i < this.pins.length; i++) {
      if (this.standing[i] && this.isDown(this.pins[i])) this.standing[i] = false
    }
    this.standingAtBallStart = this.standing.slice()
    this.down = 0
    this.phase = 'ready'
    this.rollTime = 0
    this.settled = 0
    this.game.vehicle.moveTo(this.startPosition, this.downLane)
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

  /** The score, the frame and the call live HERE, in the HUD — which
   *  is why the screen beside the lane can be ten pins and nothing
   *  else. */
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
     PER-FRAME: interpolation, sweep bar, the screen, watchdog
     ========================================================== */

  private parkSweep(): void {
    this.sweepBar.position.set(this.wx(0, DECK_BACK_Z - 0.4), this.floorY + 0.38, this.wz(0, DECK_BACK_Z - 0.4))
  }

  /**
   * The screen slides along the lane to stay level with the car, and
   * eases back to the arrows when the car is gone.
   *
   * `ticker.delta` is real seconds and is not touched by bullet time,
   * so the board keeps drifting at the same rate while the world is in
   * slow motion — which is right: it is furniture, not physics.
   */
  private trackScreen(): void {
    const t = this.game.ticker.elapsed
    const p = this.game.player.position
    const cx = this.lx(p.x, p.z)
    const cz = this.lz(p.x, p.z)
    // Distance to the stretch of lane the board can reach, not to the
    // venue centre: standing at the pin end should pull the board to
    // the pin end, not push it away.
    const along = clamp(cz, SCREEN_MIN_Z, SCREEN_MAX_Z)
    const near = Math.hypot(cx, cz - along) < SCREEN_RANGE
    this.screenZ = damp(this.screenZ, near ? along : SCREEN_REST_Z, SCREEN_LAMBDA, this.game.ticker.delta)
    // The bob and the micro-roll are what sell "floating"; the yaw set
    // once in buildScreen() is what keeps it parallel to the lane.
    this.screen.position.set(SCREEN_X, this.floorY + SCREEN_Y + Math.sin(t * 1.1) * 0.14, this.screenZ)
    this.board.rotation.z = Math.sin(t * 0.7) * 0.012
  }

  private frameTick(): void {
    const alpha = this.game.ticker.alpha
    for (const pin of this.pins) {
      this.game.physics.sample(pin.physical, alpha, pin.mesh.position, pin.mesh.quaternion)
    }
    this.game.physics.sample(this.ball.physical, alpha, this.ball.mesh.position, this.ball.mesh.quaternion)
    this.trackScreen()

    /*
      A LEANER THAT GOES OVER LATE IS STILL A PIN THAT WENT OVER.

      `standing` is a latch: it is written down during a roll and again
      in `endSweep`, and never touched in between. A pin that topples
      while the phase is `ready` — a leaner settling a second after the
      sweep, a pin nudged by the returning ball — therefore stayed lit
      on the diagram until the next throw resolved. The harness caught
      seven of them across five sets, always the same shape: the screen
      claiming one pin the deck no longer had.

      Between balls there is nothing to debounce, so read the deck.
      `standingAtBallStart` moves with it or the next throw is credited
      with a pin it did not knock over.
    */
    if (this.phase === 'ready') {
      for (let i = 0; i < this.pins.length; i++) {
        if (!this.standing[i] || !this.isDown(this.pins[i])) continue
        this.standing[i] = false
        this.standingAtBallStart[i] = false
      }
    }

    if (this.sweepBar.visible) {
      const t = Math.min(1, this.sweepT / (SWEEP_TIME * 0.52))
      const dz = DECK_Z + 0.3 + (DECK_BACK_Z - DECK_Z - 0.7) * t
      this.sweepBar.position.set(this.wx(0, dz), this.floorY + 0.38, this.wz(0, dz))
    }

    if (this.running || this.state === 'finished') return

    // Between games: recover anything the player left lying around.
    // tick() only runs while a set is live, so without this a ball
    // nudged off the lane in passing stays off it for ever.
    const now = this.game.ticker.elapsed
    if (now - this.tidyAt < 1) return
    this.tidyAt = now
    const p = this.ball.physical.current.position
    // Out of BOUNDS, not below the deck. This was `p.y < floorY - 2.5`,
    // which on a flush venue is only true if the ball has fallen off
    // the island — so a ball shoved gently sideways sat in the grass
    // until the player happened to drive 55 m away.
    if (p.distanceTo(this.ballHome) > 1.2 && !this.inBounds(p)) this.returnBall()
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
     THE SCREEN'S CONTENT: TEN INDICATORS, NOTHING ELSE
     ========================================================== */

  /**
   * What is left to hit, and that is all.
   *
   * The board used to carry a header, a live frame/ball line, a state
   * chip, a three-frame scoresheet, PINS DOWN n/10, the call and the
   * last throw. All of it duplicated the HUD, none of it was legible
   * from a car, and it left the diagram — the only part you actually
   * aim against — occupying a seventh of a 12-unit board.
   *
   * The cache key is the standing set and the phase, which is exactly
   * what the painting is a function of. It is not an optimisation
   * detail: a canvas that repaints every frame uploads a 1024 × 560
   * texture sixty times a second for a picture that changes twice a
   * throw.
   */
  private paint(): void {
    /*
      THE LATCH IS FOR THE ROLL, AND ONLY FOR THE ROLL.

      `standing` is written down during a throw and never un-written,
      which is the debounce that stops ten bouncing bodies making the
      diagram flicker. Everywhere else the deck is simply the truth,
      and reading the latch instead left a one-frame window in which a
      pin that had just tipped was still lit: the harness caught it
      once in about two hundred and fifty samples, always at the mark,
      always the pin that went over last.

      So the board paints the LIVE deck unless a ball is rolling. The
      cache key is what is painted, so it still repaints twice a throw
      rather than sixty times a second.
    */
    const shown = this.phase === 'rolling'
      ? this.standing
      : this.pins.map((pin) => !this.isDown(pin))
    const key = `${shown.map((s) => (s ? 1 : 0)).join('')}|${this.phase}`
    if (key === this.painted) return
    this.painted = key

    const c = this.canvas.getContext('2d')!
    const W = BOARD_PX_W
    const H = BOARD_PX_H
    c.fillStyle = '#141a17'
    c.fillRect(0, 0, W, H)
    c.strokeStyle = palette.signal
    c.lineWidth = 7
    c.strokeRect(3.5, 3.5, W - 7, H - 7)

    /*
      THE RACK, IN SCORESHEET ORIENTATION: back row at the top, head
      pin at the bottom, so the diagram matches the way a bowler talks
      about it. The column pitch is wider than the row pitch on
      purpose — 200 against 132, where an overhead rack would be 200
      against 173 — because this is the rack as it looks from the
      mark, which is where it is being read from.
    */
    let index = 0
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col <= row; col++) {
        const px = DIAG_CX + (col - row / 2) * DIAG_DX
        const base = DIAG_TOP + (3 - row) * DIAG_DY + 26
        pinPath(c, px, base, DIAG_PIN)
        if (shown[index]) {
          c.fillStyle = '#f4f1e6'
          c.fill()
          // The two neck bands, from the same profile as the model.
          c.strokeStyle = palette.accent
          c.lineWidth = 6
          for (const [a, b] of BANDS) {
            const y = base - ((a + b) / 2 / 15) * DIAG_PIN
            const r = (radiusAt((a + b) / 2) / 15) * DIAG_PIN
            c.beginPath(); c.moveTo(px - r, y); c.lineTo(px + r, y); c.stroke()
          }
        } else {
          // The silhouette stays, in the ground colour, so the ten
          // indicators keep their places and the cross reads as a pin
          // struck out rather than as a mark floating in a gap.
          c.fillStyle = '#1d2622'
          c.fill()
          c.strokeStyle = '#3d4a43'
          c.lineWidth = 4
          c.stroke()
          c.strokeStyle = '#6d7d74'
          c.lineWidth = 6
          const r = DIAG_PIN * 0.22
          const cy = base - DIAG_PIN * 0.55
          c.beginPath()
          c.moveTo(px - r, cy - r); c.lineTo(px + r, cy + r)
          c.moveTo(px + r, cy - r); c.lineTo(px - r, cy + r)
          c.stroke()
        }
        index++
      }
    }

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

/** Named `vecLength` so it cannot shadow `Array.length` at a glance. */
const vecLength = (v: { x: number; y: number; z: number }): number => Math.hypot(v.x, v.y, v.z)
