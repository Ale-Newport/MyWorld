import * as THREE from 'three'
import { Minigame } from './Minigame'
import { palette } from '../core/palette'
import { clamp, formatTime, seeded } from '../core/maths'
import { easing } from '../core/Tween'
import { chamferedBox, strutGeometry } from '../world/geometry'
import { textTexture } from '../world/materials'
import type { Bin } from '../core/Disposal'
import type { Game } from '../Game'
import type { MinigameId } from '@/content/world'
import { districtById } from '@/content/world'

/* ============================================================
   LABYRINTH

   Nothing here is ported: folio-2025 has no maze. What this
   inherits from upstream is the base class's cancel rules, which
   matter more in a maze than anywhere else — a place with walls
   is the easiest place in the world to get stuck in.

   Four things hold the whole mode up.

   1. THE WALLS ARE SOLID, ALWAYS. They are static colliders that
      exist from world load, whether or not the timer is running.
      The maze is a piece of the district, not a mode you enter;
      starting the run is optional and cancelling it changes
      nothing you can see. That also means the mini-game never
      has to build or tear down geometry mid-run, which is where
      a game like this would otherwise strand somebody.
   2. THE MAZE IS GENERATED, NOT DRAWN. A recursive backtracker
      on an odd grid, run from a fixed seed. Same maze every
      reload, on every machine — which it must be, because a best
      time for a maze that changes is a best time for nothing.
   3. IT IS VERIFIED, NOT ASSUMED. A recursive backtracker always
      produces a perfect maze, so the centre is always reachable —
      but that guarantee belongs to the algorithm as written, not
      as intended. `measure()` floods the finished grid from the
      centre and warns in development if the entrance cannot see
      it, or if any corridor is walled off. The same flood fill
      feeds the progress bar, so it earns its cost either way:
      progress is measured in corridors still to drive, not in
      metres as the crow flies, which in a maze is a lie.
   4. THE CLOCK STARTS AT THE THRESHOLD. There is no 3-2-1. See
      MOUTH_RADIUS and the constructor for what that costs.

   SIZES. Corridors are 5.2 m and walls are 1.2 m, both chosen
   around the car rather than around the picture. The car is 2.6 m
   long and about 1.7 m wide, so a corridor is exactly two car
   lengths and three car widths across — enough to turn in with one
   shunt, and enough that a mistake costs a manoeuvre rather than
   the run. The hedge is squashed to the wall's own thickness
   rather than bolted onto its faces, so it takes 7 cm a side and
   the driveable width is 5.06 m; a hedge laid ON the walls would
   have taken a metre.

   1.2 m walls are thin, and thin static geometry is the kind a
   fast body tunnels through, so: the world steps at 1/60 s real
   with `scale = 2`, giving a 1/30 s simulated step, and a boosting
   car tops out near 40 m/s, so it moves at most ~1.33 m per step.
   Discrete detection misses a slab only when one step clears the
   whole overlap window, which is the wall's thickness plus the
   car's own length: 1.2 + 2.6 = 3.8 m. Nearly three times the
   worst case, with no CCD needed — and the shorter corridor did
   not change this arithmetic, because neither the wall nor the car
   changed size. One cuboid per merged wall is therefore enough —
   and it beats a trimesh of the maze, which is slower to query and
   tunnels more easily rather than less.
   ============================================================ */

/*
  THE SEED IS CHOSEN BY SEARCH, NOT BY TASTE.

  Sweeping seeds 1..9999 through this exact carve at 7 x 7 cells:
  the mouth-to-centre distance ranges from 7 to 91 grid steps, the
  merged-run count from 18 to 38, and no seed strands a corridor.
  Maximising the route alone is a trap — the seeds that reach 91
  steps do it by carving a single snake with two dead ends and one
  junction in the whole square, which is a queue rather than a maze.

  5236 is on the Pareto front of route length against branching:
  83 grid steps (91 % of the longest route any seed produces), 265.6 m
  of corridor to drive against the 37 m the old 5 x 5 maze asked for,
  and SEVEN dead ends, seven junctions and seven decision points ON
  the solution — every one of them a place you can be wrong. It
  merges into 29 wall runs of 14 distinct sizes, mid-range for the
  seed pool, and the whole thing is 98 open grid squares against 127
  solid ones.

  Change this and every stored best time is for a maze that no
  longer exists.
*/
const SEED = 5236

/*
  SEVEN BY SEVEN, IN THE SAME 46 m SQUARE.

  The footprint is fixed and it is not this file's to move: it is
  written here as CELLS x CORRIDOR + (CELLS + 1) x WALL, again as
  `MAZE` in src/content/world-layout.ts (which is what keeps roads
  from being routed through the walls) and a third time as
  `ZONES.maze.size` through the map emitter's hold list. All three
  say 46. 7 * 5.2 + 8 * 1.2 = 46.0 exactly.

  So the maze got denser rather than bigger: 49 cells against 25,
  at 5.2 m corridors rather than 7 m ones. That is the whole of
  "much more complex" — the square is the same square.

  BOTH COUNTS MUST BE ODD. `CENTRE_Z = (CELLS_Z - 1) / 2` indexes a
  cell, and an even count puts the centre between two of them — the
  first attempt at this used 5 x 4 and the world would not start, with
  `RangeError: Invalid array length` from a half-integer index.
*/
const CELLS_X = 7
const CELLS_Z = 7
/** Odd grid: cells sit on odd indices, the walls between them on even ones. */
const GRID_W = CELLS_X * 2 + 1
const GRID_H = CELLS_Z * 2 + 1

const CENTRE_X = (CELLS_X - 1) / 2
const CENTRE_Z = (CELLS_Z - 1) / 2
/** The mouth is cut in the middle column, so it lines up with the gate. */
const ENTRANCE_COL = CENTRE_X

/*
  4.6 m, not 5.2, and the reason is the coast rather than the driving.

  Seven cells at 5.2 between 1.2 m walls is 46.0 m square, and on a
  266 m island there is nowhere in the south-east to put that: three of
  the four corners of its levelling pad were measured OUTSIDE the
  coastline, the furthest by 20.2 m, so the shore correctly took the
  ground back and the floor sloped again. 4.6 gives 41.8 m, which fits
  once the square moves inland — and 4.6 m is still two and a half car
  widths, which is a corridor rather than a slot.

  It is written in three places and they must agree: here, `MAZE` in
  world-layout.ts, and `ZONES.maze.size` through the map emitter's HOLD
  table.
*/
const CORRIDOR = 4.6
const WALL = 1.2
const WALL_HEIGHT = 2.6
/** Stone showing under the hedge. The rest of the wall is planting. */
const KERB = 0.5
/** How far walls are buried. Cheap, and it is what stops a gap under one. */
const SKIRT = 1.4

/*
  COLLECT_RADIUS MUST STAY INSIDE THE CENTRE CELL'S OWN WALLS.

  It was 4.2 against a 7 m corridor. Against a 5.2 m one the
  neighbouring corridor's near edge is CORRIDOR/2 + WALL = 3.8 m from
  the middle, so anything at or past 3.8 fires the centre zone from
  the corridor NEXT DOOR, through a wall, without ever entering. 3.2
  reaches 0.6 m into the 1.2 m wall and no further, and still covers
  every position a car can hold inside the cell.
*/
const COLLECT_RADIUS = 3.2

/*
  THE MOUTH IS A THRESHOLD, NOT AN APPROACH.

  It was 5 m, which started the clock with the car's nose still 3.1 m
  short of the gap — three metres of free time on every run, and a
  timer that had already started while the driver was still lining up.
  At 2.2 the car's CENTRE trips it 1.6 m outside the wall's outer
  face, so with a 2.6 m car the nose is 0.3 m inside the gap on the
  fixed step the clock starts. Smaller than this and a boosting car
  (1.33 m per simulated step) can sample straight past the disc.
*/
const MOUTH_RADIUS = 2.2

/*
  NINETY SECONDS, AND THIS TIME THE ARITHMETIC IS TRUE.

  Measured on seed 5236: the shortest route is 265.6 m, which is
  about 30 s at the 8-9 m/s a car actually holds through 5.2 m
  corridors and square corners. The maze is a tree, so the worst
  honest case — every wrong turn taken and backtracked out of — is
  every corridor driven twice: 2 * 310.4 = 620.8 m, about 78 s.
  Ninety therefore fails a driver who explored the entire maze AND
  dawdled, and nobody else. The old 70 was three times a 37 m
  solution, which is to say it could not be reached at all.
*/
const TIME_LIMIT = 90
/** How far outside the mouth the START prompt and the mark stand. */
const APPROACH = 7.5
/** A win cannot be re-awarded inside this many seconds. */
const CENTRE_COOLDOWN = 4

/** Blob spacing along the hedge, in metres, at full density. */
const HEDGE_BLOB = 1.15

/** One per dead end, in carve order. The countdown is gone; this is what
 *  carries the place instead. */
const DEAD_END_LINES = [
  'NO WAY THROUGH',
  'NOT THIS WAY',
  'TURN AROUND',
  'STILL A WALL',
  'NICE TRY',
  'THE CENTRE IS ELSEWHERE',
  'YOU CHOSE THIS',
]

const DX = [1, 0, -1, 0]
const DZ = [0, 1, 0, -1]

interface Axis {
  min: number[]
  max: number[]
  centre: number[]
}

/** A maximal solid rectangle of the grid, in grid indices. */
interface Run {
  gx0: number
  gz0: number
  gx1: number
  gz1: number
}

/* ============================================================
   MERGING, BY HAND

   There is no BufferGeometryUtils anywhere in this repo and
   pulling an addon into the bundle to plant a hedge is not a
   trade worth making, so the concatenation is written out the
   way `convexHull` writes out its own — position and normal,
   unindexed, nothing else. Every source fed to it carries both;
   `uv` is dropped where it exists, and nothing merged here wears
   a texture.

   Indexed sources (cylinders, cones, planes) are expanded on the
   way in. Getting that wrong is silent: you keep the first N
   vertices of a cone and quietly lose the rest.
   ============================================================ */

class Merge {
  private position: number[] = []
  private normal: number[] = []
  private readonly normalMatrix = new THREE.Matrix3()
  private readonly vertex = new THREE.Vector3()

  add(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): void {
    const position = geometry.getAttribute('position')
    const normal = geometry.getAttribute('normal')
    if (!position || !normal) return
    this.normalMatrix.getNormalMatrix(matrix)

    const index = geometry.getIndex()
    const count = index ? index.count : position.count
    for (let i = 0; i < count; i++) {
      const at = index ? index.getX(i) : i
      this.vertex.fromBufferAttribute(position, at).applyMatrix4(matrix)
      this.position.push(this.vertex.x, this.vertex.y, this.vertex.z)
      this.vertex.fromBufferAttribute(normal, at).applyMatrix3(this.normalMatrix).normalize()
      this.normal.push(this.vertex.x, this.vertex.y, this.vertex.z)
    }
  }

  /** Null when nothing was added, so an empty bucket costs no mesh. */
  build(): THREE.BufferGeometry | null {
    if (this.position.length === 0) return null
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3))
    geometry.computeBoundingSphere()
    this.position.length = 0
    this.normal.length = 0
    return geometry
  }
}

export class Labyrinth extends Minigame {
  readonly id: MinigameId = 'labyrinth'
  readonly title = 'LABYRINTH'
  /** Where a run begins, for anything that has to put the car there.
   *  Every other mini-game on the island publishes one; this did not,
   *  and a harness looking for "where do I stand to start the
   *  labyrinth" fell through to `undefined` and took itself down. */
  readonly startPosition = new THREE.Vector3()

  /** 1 solid, 0 open. Indexed `gz * GRID_W + gx`. */
  private grid = new Uint8Array(GRID_W * GRID_H)
  /** Grid steps from the centre through open cells; -1 where unreachable. */
  private distance = new Int32Array(GRID_W * GRID_H)
  private mouthDistance = 1

  private readonly xAxis = makeAxis(GRID_W)
  private readonly zAxis = makeAxis(GRID_H)

  private group = new THREE.Group()
  private centre = new THREE.Vector3()
  private mouth = new THREE.Vector3()
  /** Unit vector from the maze's middle out through the mouth. */
  private outward = new THREE.Vector3(0, 0, -1)
  /** Yaw that points a car standing on the mark straight into the gap. */
  private entryYaw = 0
  private beacon!: THREE.Mesh
  private beaconY = 0

  private ratio = 0
  /** Real seconds on the clock when the centre was last awarded. */
  private awardedAt = -CENTRE_COOLDOWN
  /** Real seconds on the clock when the fountain last spat. */
  private splashedAt = 0

  /*
    SEVEN BUCKETS, SEVEN DRAW CALLS, EVERYTHING STATIC IN THEM.

    Every fixed piece of the maze is concatenated into one of these
    and flushed once at the end of `build()`: 29 wall runs, 718 hedge
    blobs at full density (206 at medium, 194 at low), four obelisks,
    seven lanterns, seven signposts, a fountain and a mast. The whole
    district comes to eighteen draw calls and about 15,000 triangles,
    against twenty-two draw calls and 750 triangles for the 5 x 5
    grey-box maze it replaces — the swap this file is making is
    triangles for draw calls, and triangles are the cheap half.

    NOT instancing. One InstancedMesh of a unit chamfered box needs
    per-instance non-uniform scale, which stretches the 0.07 m chamfer
    to half a metre on a twenty-metre run and makes the boxes read
    worse than they did. Merging pre-placed geometry gets the same one
    draw call with the chamfer intact.
  */
  private merges = {
    kerb: new Merge(),
    hedgeDark: new Merge(),
    hedgeLight: new Merge(),
    stone: new Merge(),
    timber: new Merge(),
    metal: new Merge(),
    glow: new Merge(),
  }

  constructor(game: Game, bin: Bin) {
    super(game, bin)
    /*
      SIXTY-SIX, MEASURED RATHER THAN GUESSED.

      Two distances have to fit inside it, both measured on the
      finished 46 m square. The deepest open square is 45.8 m from the
      mouth, which is the origin of a run started by driving in. It is
      52.7 m from the start mark, which is both the origin of a run
      started at the prompt AND the worst gap a fail can leave between
      the car and the fail card's own origin, since `fail` teleports to
      the mark and `resultIsDistant` is min(140, this) from wherever
      you were lost. Anything under 53 shows up as a losing run that
      VANISHES rather than one that fails, because the base class
      cancels for straying before it ticks the game.

      66 clears both with thirteen metres to spare. It came down from
      80, which was never the "tightest radius on the island" it was
      described as: the landing forecourt is 79.1 m from the mouth, so
      a run used to survive the entire drive home.
    */
    this.abandonRadius = 66
    /*
      NO LEAD-IN. `Minigame.start()` puts the state straight into
      'running' when `leadIn` is 0, zeroes `elapsed` and calls
      `onStart()` on the same fixed step — so the clock starts in the
      step the mouth zone fires and not three seconds later. The
      'countdown' state stays in the union for CircuitRace and
      TntDomino, which still want it; this game simply never enters it.
    */
  }

  /* ========================================================
     BUILD
     ======================================================== */

  build(): void {
    const district = districtById.maze
    this.centre.set(
      district.x,
      this.game.world.terrain.colliderHeightAt(district.x, district.z),
      district.z,
    )
    this.mouth.set(
      this.centre.x + this.xAxis.centre[ENTRANCE_COL * 2 + 1],
      0,
      this.centre.z + this.zAxis.centre[0],
    )
    this.mouth.y = this.game.world.terrain.colliderHeightAt(this.mouth.x, this.mouth.z)
    // Derived rather than written down: the day the hole moves to
    // another face, the side test and the mark move with it.
    this.outward.subVectors(this.mouth, this.centre).setY(0).normalize()

    this.carve()
    this.measure()

    this.buildWalls(this.mergeRuns())
    this.buildLandmarks()
    this.buildApproach()
    this.buildCentre()
    this.flushMerges()

    this.buildZones()
    this.buildEntrance()

    this.game.renderer.scene.add(this.group)
    this.bin.object3D(this.group)

    // The beacon turns whether or not anyone is timing themselves, so it
    // cannot live in `tick` — the manager only ticks the active game.
    const animate = () => this.animate()
    this.game.ticker.events.on('tick', animate, 14)
    this.bin.add(() => this.game.ticker.events.off('tick', animate))
  }

  /**
   * Recursive backtracker, with the recursion written out as a stack.
   * Carving starts at the centre, which makes the goal the root of the
   * spanning tree rather than one more leaf of it.
   */
  private carve(): void {
    this.grid.fill(1)

    const random = seeded(SEED)
    const visited = new Uint8Array(CELLS_X * CELLS_Z)
    const stack: number[] = []
    const open = (gx: number, gz: number) => {
      this.grid[gz * GRID_W + gx] = 0
    }

    const start = CENTRE_Z * CELLS_X + CENTRE_X
    visited[start] = 1
    open(CENTRE_X * 2 + 1, CENTRE_Z * 2 + 1)
    stack.push(start)

    const order = [0, 1, 2, 3]

    while (stack.length > 0) {
      const current = stack[stack.length - 1]
      const cx = current % CELLS_X
      const cz = (current - cx) / CELLS_X

      // Fisher–Yates on the four directions, drawn from the seeded
      // stream so the shuffle is part of the same deterministic run.
      for (let i = 3; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        const swap = order[i]
        order[i] = order[j]
        order[j] = swap
      }

      let moved = false
      for (const direction of order) {
        const nx = cx + DX[direction]
        const nz = cz + DZ[direction]
        if (nx < 0 || nz < 0 || nx >= CELLS_X || nz >= CELLS_Z) continue

        const next = nz * CELLS_X + nx
        if (visited[next]) continue

        visited[next] = 1
        open(nx * 2 + 1, nz * 2 + 1)
        // The even-index cell between the two odd ones is the wall.
        open(cx * 2 + 1 + DX[direction], cz * 2 + 1 + DZ[direction])
        stack.push(next)
        moved = true
        break
      }

      if (!moved) stack.pop()
    }

    /*
      Exactly one hole in the boundary, cut in the middle column of the
      NORTH face — row zero, the -Z side — which is the side the island
      is on. This used to be `GRID_H - 1`, the south face, under a
      comment that called it north; on the re-drawn island the maze
      stands against the south-east beach and that face is three metres
      from the waterline, so the mouth, its approach marks and the
      START prompt were all in the sea.

      The sign this game registers itself (`buildEntrance`) stands
      APPROACH metres beyond the hole in the same column, so the way in
      is a straight line from the prompt. Every other boundary cell
      stays solid.
    */
    open(ENTRANCE_COL * 2 + 1, 0)
  }

  /**
   * Flood fill from the centre. Doubles as the build-time proof that the
   * maze can be solved and as the source of the progress bar.
   */
  private measure(): void {
    this.distance.fill(-1)

    const start = (CENTRE_Z * 2 + 1) * GRID_W + (CENTRE_X * 2 + 1)
    this.distance[start] = 0
    const queue = [start]

    for (let head = 0; head < queue.length; head++) {
      const node = queue[head]
      const gx = node % GRID_W
      const gz = (node - gx) / GRID_W

      for (let i = 0; i < 4; i++) {
        const nx = gx + DX[i]
        const nz = gz + DZ[i]
        if (nx < 0 || nz < 0 || nx >= GRID_W || nz >= GRID_H) continue

        const next = nz * GRID_W + nx
        if (this.grid[next] === 1 || this.distance[next] !== -1) continue
        this.distance[next] = this.distance[node] + 1
        queue.push(next)
      }
    }

    const mouthNode = ENTRANCE_COL * 2 + 1
    this.mouthDistance = Math.max(1, this.distance[mouthNode])

    if (process.env.NODE_ENV === 'development') {
      if (this.distance[mouthNode] < 0) {
        console.warn(`[world] labyrinth seed ${SEED}: the centre cannot be reached from the mouth`)
      }
      let stranded = 0
      for (let i = 0; i < this.grid.length; i++) {
        if (this.grid[i] === 0 && this.distance[i] < 0) stranded++
      }
      if (stranded > 0) {
        console.warn(`[world] labyrinth seed ${SEED}: ${stranded} open cells are walled off`)
      }
    }
  }

  /* ---- walls ---------------------------------------------- */

  /**
   * Solid cells are merged into the largest rectangles that will fit
   * before anything is built — greedy along X, then down Z. A long
   * boundary wall becomes one box instead of fifteen, which is fewer
   * colliders and, more usefully, fewer collider seams for a car to
   * catch on at speed. Seed 5236's 127 solid squares come out as 29.
   */
  private mergeRuns(): Run[] {
    const claimed = new Uint8Array(GRID_W * GRID_H)
    const runs: Run[] = []

    for (let gz = 0; gz < GRID_H; gz++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        const first = gz * GRID_W + gx
        if (this.grid[first] === 0 || claimed[first]) continue

        let x1 = gx
        while (
          x1 + 1 < GRID_W &&
          this.grid[gz * GRID_W + x1 + 1] === 1 &&
          !claimed[gz * GRID_W + x1 + 1]
        ) {
          x1++
        }

        let z1 = gz
        rows: while (z1 + 1 < GRID_H) {
          for (let x = gx; x <= x1; x++) {
            const node = (z1 + 1) * GRID_W + x
            if (this.grid[node] === 0 || claimed[node]) break rows
          }
          z1++
        }

        for (let z = gz; z <= z1; z++) {
          for (let x = gx; x <= x1; x++) claimed[z * GRID_W + x] = 1
        }

        runs.push({ gx0: gx, gz0: gz, gx1: x1, gz1: z1 })
      }
    }

    return runs
  }

  /**
   * One cuboid collider per run, one stone kerb merged into a single
   * geometry, and a hedge merged into two more — three draw calls for
   * every wall in the maze, against one mesh per run before.
   */
  private buildWalls(runs: Run[]): void {
    /* Cached by size to 2 dp, and NOT by scaling one unit box: a
       chamfer is an absolute distance, so a unit cube stretched to
       20 x 2 x 1.2 carries a 1.4 m bevel down its length. 29 runs come
       out of 14 distinct sizes on this seed. */
    const kerbs = new Map<string, THREE.BufferGeometry>()
    const matrix = new THREE.Matrix4()

    for (const run of runs) {
      const x0 = this.centre.x + this.xAxis.min[run.gx0]
      const x1 = this.centre.x + this.xAxis.max[run.gx1]
      const z0 = this.centre.z + this.zAxis.min[run.gz0]
      const z1 = this.centre.z + this.zAxis.max[run.gz1]

      const width = x1 - x0
      const depth = z1 - z0
      const ground = this.groundRange(x0, x1, z0, z1)

      // Measured from the highest ground under the run so it is never
      // shorter than 2.6 m anywhere, and buried to the lowest so a
      // tilted plate cannot open a gap under it. The maze district is
      // levelled dead flat by the rectangular pad in PLAY_SPOTS.maze,
      // so today min and max are the same number — the burial costs
      // nothing and it is what would catch it if the pad ever moved.
      const bottom = ground.min - SKIRT
      const top = ground.max + WALL_HEIGHT
      const height = Math.ceil((top - bottom) * 100) / 100
      const at = { x: (x0 + x1) / 2, y: bottom + height / 2, z: (z0 + z1) / 2 }

      // The visible stone is only the bottom KERB metres; the rest of
      // the wall is planting. The buried skirt goes in the stone, not
      // in the hedge, because it is never seen and a blob per buried
      // metre is a blob nobody looks at.
      const kerbTop = ground.max + KERB
      const kerbHeight = kerbTop - bottom
      const key = `${width.toFixed(2)}_${kerbHeight.toFixed(2)}_${depth.toFixed(2)}`
      let kerb = kerbs.get(key)
      if (!kerb) {
        kerb = chamferedBox(width, kerbHeight, depth, 0.07)
        kerbs.set(key, kerb)
      }
      matrix.makeTranslation(at.x, bottom + kerbHeight / 2, at.z)
      this.merges.kerb.add(kerb, matrix)

      this.plantHedge(x0, x1, z0, z1, kerbTop - 0.15, top)

      // The collider is the box you can see, at the size you can see it
      // — the hedge is squashed to the wall's own 1.2 m rather than
      // bolted onto its faces, so there is nothing to collide with that
      // this cuboid does not already cover. Low restitution on purpose:
      // clipping a corner at 40 m/s should cost you the corner, not
      // fire you across the corridor.
      this.game.physics.add({
        type: 'fixed',
        category: 'floor',
        position: at,
        friction: 0.55,
        restitution: 0.08,
        colliders: [{ shape: 'cuboid', parameters: [width / 2, height / 2, depth / 2] }],
      })
    }

    // The merge holds copies of the vertices; the source shapes have
    // no further use and no mesh points at them.
    for (const geometry of kerbs.values()) geometry.dispose()
  }

  /**
   * Fills a wall run with overlapping faceted blobs. Nothing here has a
   * collider and nothing here leaves the run's own footprint: the blobs
   * are scaled to the box, not laid on its faces, so a hedge maze
   * drives exactly like the box maze it replaces.
   */
  private plantHedge(
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    from: number,
    to: number,
  ): void {
    const blob = new THREE.IcosahedronGeometry(0.5, 0)
    // Density follows the quality level — this is decoration and the
    // colliders are already placed — but it is floored, because at 0.28
    // an unfloored step puts four-metre boulders on a twenty-metre run.
    const step = HEDGE_BLOB / Math.max(0.55, this.game.quality.settings.density)
    const width = x1 - x0
    const depth = z1 - z0
    const height = to - from

    const nx = Math.max(1, Math.round(width / step))
    const nz = Math.max(1, Math.round(depth / step))
    const ny = Math.max(1, Math.round(height / step))

    /*
      ABOVE THE KERB THE HEDGE *IS* THE WALL — there is no box behind
      it — so a gap between two blobs is a hole you can see the next
      corridor through. Two rules keep that impossible. Blobs overlap
      by 30 % along an axis that carries more than one of them, and by
      12 % across the thin axis that carries only one; and they are
      jittered only along axes that have a neighbour to cover for
      them. The `swell` floor of 0.92 is inside both margins:
      0.92 x 1.12 x 1.2 = 1.24 m of blob across a 1.2 m wall, in the
      worst case the seeded stream can produce.
    */
    const sx = (width / nx) * (nx > 1 ? 1.3 : 1.12)
    const sz = (depth / nz) * (nz > 1 ? 1.3 : 1.12)
    const sy = (height / ny) * 1.34
    const jx = nx > 1 ? 0.14 : 0
    const jz = nz > 1 ? 0.14 : 0

    const random = seeded(SEED + Math.round((x0 + z0) * 100))
    const matrix = new THREE.Matrix4()
    const quaternion = new THREE.Quaternion()
    const euler = new THREE.Euler()
    const position = new THREE.Vector3()
    const scale = new THREE.Vector3()

    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        for (let iy = 0; iy < ny; iy++) {
          position.set(
            x0 + ((ix + 0.5) * width) / nx + (random() - 0.5) * jx,
            from + ((iy + 0.5) * height) / ny + (random() - 0.5) * 0.14,
            z0 + ((iz + 0.5) * depth) / nz + (random() - 0.5) * jz,
          )
          const swell = 0.92 + random() * 0.2
          scale.set(sx * swell, sy * swell, sz * swell)
          euler.set(random() * Math.PI, random() * Math.PI, random() * Math.PI)
          matrix.compose(position, quaternion.setFromEuler(euler), scale)
          // Two tints rather than one, split from the same stream, so
          // the hedge has depth in flat noon light. Two draw calls.
          const bucket = random() < 0.5 ? this.merges.hedgeDark : this.merges.hedgeLight
          bucket.add(blob, matrix)
        }
      }
    }

    blob.dispose()
  }

  /** Lowest and highest terrain under a footprint, sampled per collider cell. */
  private groundRange(x0: number, x1: number, z0: number, z1: number): { min: number; max: number } {
    const terrain = this.game.world.terrain
    // The heightfield has 2.5 m cells; sampling finer than that finds
    // nothing new, sampling coarser can step over a whole ridge.
    const nx = Math.max(1, Math.ceil((x1 - x0) / 2.5))
    const nz = Math.max(1, Math.ceil((z1 - z0) / 2.5))

    let min = Infinity
    let max = -Infinity
    for (let i = 0; i <= nx; i++) {
      const x = x0 + ((x1 - x0) * i) / nx
      for (let j = 0; j <= nz; j++) {
        const z = z0 + ((z1 - z0) * j) / nz
        const height = terrain.colliderHeightAt(x, z)
        if (height < min) min = height
        if (height > max) max = height
      }
    }
    return { min, max }
  }

  /* ---- what you steer by ---------------------------------- */

  /**
   * Everything inside the walls that is not a wall. All of it is read
   * off the grid the carve produced rather than placed by hand, so a
   * change of seed moves the lanterns and the signs with the corridors
   * instead of leaving them standing in hedge.
   *
   * None of it collides. The house rule from `Landmarks` holds here
   * more than anywhere: information must never be a road obstacle, and
   * a maze corridor is five metres wide.
   */
  private buildLandmarks(): void {
    const cellAt = (gx: number, gz: number) =>
      new THREE.Vector3(
        this.centre.x + this.xAxis.centre[gx],
        this.game.world.terrain.colliderHeightAt(
          this.centre.x + this.xAxis.centre[gx],
          this.centre.z + this.zAxis.centre[gz],
        ),
        this.centre.z + this.zAxis.centre[gz],
      )

    /* FOUR CORNER OBELISKS. The only thing that shows over a 2.6 m
       hedge from inside the maze, and the only thing that tells you
       which corner of the square you are in. They stand on the corner
       grid squares, which are solid, so the wall's own collider is
       already there and they need none of their own. */
    const shaft = chamferedBox(1.0, 6.4, 1.0, 0.12)
    const cap = chamferedBox(0.58, 0.42, 0.58, 0.08)
    const matrix = new THREE.Matrix4()
    for (const gx of [0, GRID_W - 1]) {
      for (const gz of [0, GRID_H - 1]) {
        const at = cellAt(gx, gz)
        matrix.makeTranslation(at.x, at.y + 6.4 / 2 - SKIRT, at.z)
        this.merges.stone.add(shaft, matrix)
        matrix.makeTranslation(at.x, at.y + 6.4 - SKIRT + 0.21, at.z)
        this.merges.glow.add(cap, matrix)
      }
    }
    shaft.dispose()
    cap.dispose()

    /* JUNCTION LANTERNS and DEAD-END SIGNS, in one pass over the cells.
       With the countdown gone the lanterns are the breadcrumb that
       makes a 49-cell maze navigable rather than punishing, and the
       signs are the joke that carries a wrong turn. Seed 5236 gives
       seven of each. */
    const post = strutGeometry(0.07)
    const signPost = strutGeometry(0.06)
    const head = chamferedBox(0.42, 0.6, 0.42, 0.08)
    let deadEnd = 0

    for (let cz = 0; cz < CELLS_Z; cz++) {
      for (let cx = 0; cx < CELLS_X; cx++) {
        const gx = cx * 2 + 1
        const gz = cz * 2 + 1
        const exits: number[] = []
        for (let i = 0; i < 4; i++) {
          const nx = gx + DX[i]
          const nz = gz + DZ[i]
          if (nx < 0 || nz < 0 || nx >= GRID_W || nz >= GRID_H) continue
          if (this.grid[nz * GRID_W + nx] === 0) exits.push(i)
        }
        const isCentre = cx === CENTRE_X && cz === CENTRE_Z
        const at = cellAt(gx, gz)

        if (exits.length >= 3 && !isCentre) {
          // Tucked into a corner of the cell, which is always closed —
          // the diagonals of a cell in an odd grid are wall squares —
          // so a lantern is out of the line anybody takes through a
          // junction, and carries no collider for the times it is not.
          const inset = CORRIDOR / 2 - 0.5
          const lx = at.x + (cx <= CENTRE_X ? -inset : inset)
          const lz = at.z + (cz <= CENTRE_Z ? -inset : inset)
          matrix.makeScale(1, 2.2, 1)
          matrix.setPosition(lx, at.y, lz)
          this.merges.metal.add(post, matrix)
          matrix.makeTranslation(lx, at.y + 2.42, lz)
          this.merges.glow.add(head, matrix)
        }

        if (exits.length === 1 && !isCentre) {
          // Against the closed end, facing back down the only corridor
          // that reaches it — so you read it as you arrive, not as you
          // leave.
          const facing = exits[0]
          const back = CORRIDOR / 2 - 0.4
          const sx = at.x - DX[facing] * back
          const sz = at.z - DZ[facing] * back
          matrix.makeScale(1, 1.5, 1)
          matrix.setPosition(sx, at.y, sz)
          this.merges.timber.add(signPost, matrix)
          this.plate(
            DEAD_END_LINES[deadEnd % DEAD_END_LINES.length],
            0.42,
            new THREE.Vector3(sx, at.y + 1.58, sz),
            Math.atan2(DX[facing], DZ[facing]),
          )
          deadEnd++
        }
      }
    }
    post.dispose()
    signPost.dispose()
    head.dispose()

    /* ENTRANCE TOPIARY. Two clipped spirals on the boundary wall
       either side of the gap — they are the only planting that stands
       above the hedge line, so from the road the mouth reads as a way
       in rather than as one more panel of wall. */
    const across = new THREE.Vector3(-this.outward.z, 0, this.outward.x)
    for (const side of [-1, 1]) {
      const base = this.mouth
        .clone()
        .addScaledVector(across, side * (CORRIDOR / 2 + WALL / 2))
      let y = base.y - 0.2
      for (let tier = 0; tier < 5; tier++) {
        const radius = 0.86 - tier * 0.14
        const cone = new THREE.ConeGeometry(radius, 0.74, 8)
        matrix.makeTranslation(base.x, y + 0.37, base.z)
        this.merges.hedgeDark.add(cone, matrix)
        cone.dispose()
        y += 0.62
      }
    }
  }

  /**
   * A dark plate with light type on it, sized from its own texture.
   *
   * Sized by HEIGHT and not by width, so a long joke makes a wider
   * board rather than smaller letters — seven signs whose type changes
   * size with the sentence read as seven different objects.
   */
  private plate(text: string, height: number, at: THREE.Vector3, facing: number): void {
    // `signLabel` draws at 256 px a line, which for a twenty-character
    // joke is a 2,800 px canvas — seven of those is 28 MB of texture
    // for seven dead ends. 96 is the size `textPlane` uses, puts these
    // at about 0.7 MB each, and is legible from the far end of a 5.2 m
    // corridor.
    const { texture, aspect } = textTexture({
      text,
      size: 96,
      color: '#eee9d7',
      background: '#2e423b',
    })
    const geometry = new THREE.PlaneGeometry(height * aspect, height)
    const mesh = new THREE.Mesh(
      geometry,
      this.game.materials.own(
        new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false }),
      ),
    )
    mesh.position.copy(at)
    mesh.rotation.y = facing
    this.group.add(mesh)
  }

  /* ---- the way in ----------------------------------------- */

  /** A threshold across the mouth, marks leading up to it, and a plan. */
  private buildApproach(): void {
    /* One geometry for every mark on the ground. They share a material
       and none of them move, so there is no reason for them to be
       eleven draw calls. */
    const decals = new Merge()
    const matrix = new THREE.Matrix4()

    const threshold = new THREE.PlaneGeometry(CORRIDOR, WALL)
    threshold.rotateX(-Math.PI / 2)
    matrix.makeTranslation(this.mouth.x, this.mouth.y + 0.07, this.mouth.z)
    decals.add(threshold, matrix)
    threshold.dispose()

    // Decorative only — the run starts on the mouth zone, not on these
    // — so the count may follow the quality level.
    const mark = new THREE.PlaneGeometry(3.4, 1)
    mark.rotateX(-Math.PI / 2)
    const count = this.game.quality.count(4, 2)
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0
      const along = this.mouth.clone().addScaledVector(this.outward, 3 + t * 7)
      matrix.makeTranslation(
        along.x,
        this.game.world.terrain.colliderHeightAt(along.x, along.z) + 0.07,
        along.z,
      )
      decals.add(mark, matrix)
    }
    mark.dispose()

    const geometry = decals.build()
    if (geometry) {
      const strip = new THREE.Mesh(geometry, this.game.materials.flat(palette.accent, 0.5))
      strip.renderOrder = 2
      this.group.add(strip)
    }

    this.buildBoard()
  }

  /**
   * The you-are-here board: the generator's own grid, drawn to a canvas
   * and stood beside the approach. It gives away the plan, and it is
   * supposed to — a fifteen-by-fifteen plan read once from a moving car
   * is a hint, not a solution, and 265 m of corridor is long enough
   * that being pointed the right way at the start is a kindness.
   */
  private buildBoard(): void {
    const cell = 15
    const pad = 10
    const plan = GRID_W * cell + pad * 2
    const header = 34
    const canvas = document.createElement('canvas')
    canvas.width = plan
    canvas.height = plan + header
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.fillStyle = palette.paper2
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#2e423b'
    ctx.fillRect(0, 0, canvas.width, header)
    ctx.fillStyle = '#eee9d7'
    ctx.font = '700 19px ui-sans-serif, system-ui, Helvetica, Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('YOU ARE HERE', canvas.width / 2, header / 2 + 1)

    for (let gz = 0; gz < GRID_H; gz++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        if (this.grid[gz * GRID_W + gx] === 0) continue
        ctx.fillStyle = '#5e7f4f'
        ctx.fillRect(pad + gx * cell, header + pad + gz * cell, cell, cell)
      }
    }

    // The mouth and the middle, in the one colour this world spends on
    // "this matters".
    ctx.fillStyle = palette.accent
    ctx.fillRect(pad + ENTRANCE_COL * 2 * cell + cell, header + pad, cell, cell)
    ctx.beginPath()
    ctx.arc(
      pad + (CENTRE_X * 2 + 1.5) * cell,
      header + pad + (CENTRE_Z * 2 + 1.5) * cell,
      cell * 0.7,
      0,
      Math.PI * 2,
    )
    ctx.fill()

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 4

    const width = 2.4
    const height = (width * canvas.height) / canvas.width
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      this.game.materials.own(
        new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false }),
      ),
    )
    // Beside the approach, clear of the 5.2 m gap, tilted back so a
    // driver sees the face and not the edge.
    const across = new THREE.Vector3(-this.outward.z, 0, this.outward.x)
    const at = this.mouth
      .clone()
      .addScaledVector(this.outward, APPROACH * 0.5)
      .addScaledVector(across, CORRIDOR / 2 + 1.4)
    at.y = this.game.world.terrain.colliderHeightAt(at.x, at.z) + 1.5
    board.position.copy(at)
    board.rotation.y = Math.atan2(this.outward.x, this.outward.z)
    board.rotateX(-0.36)
    this.group.add(board)

    const matrix = new THREE.Matrix4()
    const post = strutGeometry(0.06)
    for (const side of [-1, 1]) {
      const foot = at.clone().addScaledVector(across, side * (width / 2 - 0.2))
      matrix.makeScale(1, 1.5, 1)
      matrix.setPosition(foot.x, at.y - 1.5, foot.z)
      this.merges.timber.add(post, matrix)
    }
    post.dispose()
  }

  /**
   * The way in, as something you can read and press ENTER at.
   *
   * The content layer's `maze-entry` gate stands one metre up-track
   * with LABYRINTH written across the lintel in letters you can read
   * from the road, and it is deliberately `interaction: 'none'` — the
   * gate is the name; this is the rule, the clock and the start. It is
   * also, once a run is live, the way back to the mark.
   */
  private buildEntrance(): void {
    const at = this.mouth.clone().addScaledVector(this.outward, APPROACH)
    // Clear of the ground by more than the chassis' own half-height. The
    // mark used to sit exactly ON the terrain, which was harmless while
    // nothing teleported to it; now that `returnToStart` does, spawning
    // the chassis origin at ground level buries half the car and lets the
    // solver fire it out. Bowling's mark carries the same lift for the
    // same reason. `InteractivePoints` measures range in XZ, so the
    // prompt's radius is unaffected.
    at.y = this.game.world.terrain.colliderHeightAt(at.x, at.z) + 1.2
    this.startPosition.copy(at)
    // Forward is (cos yaw, -sin yaw), so this is the yaw that points a
    // car standing on the mark at the gap rather than past it.
    this.entryYaw = Math.atan2(at.z - this.mouth.z, this.mouth.x - at.x)

    this.game.interactions.add({
      id: 'labyrinth-start',
      position: at,
      radius: 7,
      label: 'RUN THE LABYRINTH',
      sublabel: `Find the centre inside ${TIME_LIMIT} seconds.`,
      onInteract: () => {
        if (this.running) this.restart()
        else this.game.minigames.start(this.id)
      },
    })
    this.bin.add(() => this.game.interactions.remove('labyrinth-start'))
  }

  /* ---- the middle ----------------------------------------- */

  /**
   * A fountain in the centre chamber and a beacon on a mast above the
   * walls, so the goal is visible from three corridors away. Knowing
   * where the centre is was never the hard part of a maze; hiding it
   * would only add laps, not difficulty — and at 49 cells there are
   * enough laps already.
   */
  private buildCentre(): void {
    const ring = new THREE.RingGeometry(2.2, 2.45, 48)
    ring.rotateX(-Math.PI / 2)
    const ringMesh = new THREE.Mesh(
      ring,
      this.game.materials.own(
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(palette.accent),
          transparent: true,
          opacity: 0.42,
          side: THREE.DoubleSide,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
    )
    ringMesh.position.set(this.centre.x, this.centre.y + 0.08, this.centre.z)
    ringMesh.renderOrder = 2
    this.group.add(ringMesh)

    /*
      THE FOUNTAIN IS THE GOAL, AND IT IS DELIBERATELY SMALL.

      A 1.5 m basin in a 5.2 m cell leaves 1.1 m either side, which is
      not a lane — you are meant to stop at it. The collider is 1.55 m,
      so a 2.6 m car touches it with its own centre 2.85 m from the
      middle, and the centre zone is 3.2 m: the run is already won on
      the step before the bumper lands. One cylinder collider, category
      'floor' like the walls, because a thing you can drive at has to
      be a thing the ground query sees.
    */
    const basin = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.62, 0.8, 18),
      this.game.materials.get('concrete'),
    )
    basin.position.set(this.centre.x, this.centre.y + 0.4, this.centre.z)
    basin.castShadow = this.game.quality.settings.shadows
    basin.receiveShadow = this.game.quality.settings.shadows
    this.group.add(basin)
    this.game.physics.add({
      type: 'fixed',
      category: 'floor',
      position: { x: this.centre.x, y: this.centre.y + 0.4, z: this.centre.z },
      friction: 0.6,
      restitution: 0.05,
      colliders: [{ shape: 'cylinder', parameters: [0.4, 1.55] }],
    })

    const matrix = new THREE.Matrix4()
    const pedestal = new THREE.CylinderGeometry(0.34, 0.52, 1.1, 12)
    matrix.makeTranslation(this.centre.x, this.centre.y + 1.35, this.centre.z)
    this.merges.stone.add(pedestal, matrix)
    pedestal.dispose()

    const water = new THREE.Mesh(
      new THREE.ConeGeometry(0.62, 1.5, 12),
      this.game.materials.get('glass'),
    )
    water.position.set(this.centre.x, this.centre.y + 2.35, this.centre.z)
    this.group.add(water)

    /*
      THE MAST, because a beacon at 5.2 m over a 46 m maze is lost the
      moment you are three corridors out. It runs from the pedestal to
      just under the beacon so the goal reads as one object from the
      road as well as from inside, and it carries no collider — a pole
      in the middle of the one cell everybody has to drive into is the
      last place to put a thing that stops a car.
    */
    this.beaconY = this.centre.y + 8.2
    const mast = strutGeometry(0.09)
    // From the top of the pedestal to inside the beacon, which bobs
    // 0.32 m: stopping the mast short of the octahedron's lowest
    // position leaves a floating beacon over a stick.
    matrix.makeScale(1, this.beaconY - 0.6 - (this.centre.y + 1.9), 1)
    matrix.setPosition(this.centre.x, this.centre.y + 1.9, this.centre.z)
    this.merges.metal.add(mast, matrix)
    mast.dispose()

    const geometry = new THREE.OctahedronGeometry(1.05, 0)
    this.beacon = new THREE.Mesh(geometry, this.game.materials.get('accent'))
    this.beacon.position.set(this.centre.x, this.beaconY, this.centre.z)
    this.beacon.castShadow = this.game.quality.settings.shadows
    this.group.add(this.beacon)
  }

  /** Turns the seven accumulators into seven meshes. Called once. */
  private flushMerges(): void {
    const shadows = this.game.quality.settings.shadows
    const materials = this.game.materials
    const buckets: [Merge, THREE.Material][] = [
      [this.merges.kerb, materials.get('concreteDark')],
      // Two greens rather than one, and both of them NAMED: the world's
      // shared library already carries the clipped-hedge pair, so the
      // maze reads as the same planting as everything else rather than
      // as a colour only this file knows about. In permanent noon,
      // tonal variation has to be in the paint — there is no dusk to
      // model it for us.
      [this.merges.hedgeDark, materials.get('hedge')],
      [this.merges.hedgeLight, materials.get('foliageLight')],
      [this.merges.stone, materials.get('paperDark')],
      [this.merges.timber, materials.get('timber')],
      [this.merges.metal, materials.get('metal')],
      // Unlit, because this world has exactly two lights and neither of
      // them is in the maze. A re-lit emissive goes grey in shadow and
      // stops reading as a lamp at all.
      [this.merges.glow, materials.get('emissiveAmber')],
    ]

    for (const [merge, material] of buckets) {
      const geometry = merge.build()
      if (!geometry) continue
      const mesh = new THREE.Mesh(geometry, material)
      mesh.castShadow = shadows
      mesh.receiveShadow = shadows
      this.group.add(mesh)
    }
  }

  /* ---- triggers ------------------------------------------- */

  private buildZones(): void {
    const mouth = this.game.zones.create('labyrinth-mouth', 'cylinder', this.mouth, MOUTH_RADIUS)
    mouth.events.on('enter', () => this.onMouth())

    const centre = this.game.zones.create(
      'labyrinth-centre',
      'cylinder',
      this.centre,
      COLLECT_RADIUS,
    )
    centre.events.on('enter', () => this.onCentre())

    this.bin.add(() => {
      this.game.zones.remove(mouth)
      this.game.zones.remove(centre)
    })
  }

  private onMouth(): void {
    if (this.state !== 'idle') return

    // The zone fires whichever way you cross it, and starting a run on
    // the way OUT would leave a timer running behind somebody who has
    // just left. The side the car is on decides, measured against the
    // mouth's OWN outward normal rather than a hard-coded axis: move
    // the hole to another face and this follows it instead of silently
    // inverting. A side test rather than a flag armed by an outer zone,
    // because a flag can be missed — a car running along the boundary
    // and turning in never crosses one.
    const from = this.game.player.position
    const outside =
      (from.x - this.mouth.x) * this.outward.x + (from.z - this.mouth.z) * this.outward.z
    if (outside <= 0) return

    // Through the manager, not `this.start()`, or nothing would tick it.
    this.game.minigames.start(this.id)
  }

  private onCentre(): void {
    if (this.state === 'finished') return

    // The zone's exit hysteresis is 1.08, so any loop out past 3.5 m and
    // back re-fires `enter`. Without this the arrival re-awarded the
    // achievement, re-kicked the camera and re-published a COMPLETE card
    // on every bounce, forever.
    const now = this.game.ticker.elapsed
    if (now - this.awardedAt < CENTRE_COOLDOWN) return
    this.awardedAt = now

    this.game.achievements.set('pathFound', 1)
    this.game.audio?.play('achievement')
    this.game.audio?.blip(1.8)
    this.game.view.kick(0.5)
    this.game.particles.burst(this.centre.clone().setY(this.centre.y + 1.4), 24, 'confetti')
    this.pulse()
    this.ratio = 1

    if (this.running) {
      this.finish(this.elapsed)
      return
    }

    // Arriving without a run going still counts — the maze is not
    // gated on the timer, there is simply no time to record. If some
    // other game owns the HUD, leave the HUD alone.
    if (!this.game.minigames.current) this.finish(null)
  }

  private pulse(): void {
    const scale = this.beacon.scale
    // Reduced motion still gets the blip and the HUD; it does not get
    // an elastic bounce. Snapping back to 1 also cleans up a pulse
    // caught mid-flight by the setting being turned on.
    if (this.game.reducedMotion) {
      this.game.tweens.killOf(scale)
      scale.set(1, 1, 1)
      return
    }
    this.game.tweens.to(
      scale,
      { x: 1.9, y: 1.9, z: 1.9 },
      {
        duration: 0.3,
        ease: easing.power2Out,
        overwrite: true,
        onComplete: () => {
          this.game.tweens.to(scale, { x: 1, y: 1, z: 1 }, { duration: 1, ease: easing.elasticOut })
        },
      },
    )
  }

  /* ========================================================
     LIFECYCLE
     ======================================================== */

  start(): boolean {
    if (this.running) return true
    const started = super.start()
    if (!started) return started

    /* NO TELEPORT HERE, deliberately. Bowling's `start` puts the car on
       its mark because a throw begins there. A labyrinth run begins on
       the step the car crossed the threshold, so dragging it back out
       through the gap it has just driven through would undo the entry
       that started the clock — which is the entire point of the mode.
       The mark is reachable on demand instead, through the prompt. */
    this.game.interactions.setLabel(
      'labyrinth-start',
      'BACK TO THE START',
      'Back to the mark, with the clock at zero.',
    )
    this.game.audio?.blip(0.8)
    return started
  }

  /**
   * The car goes back to the mark, pointed at the gap. Called from
   * exactly three places — an explicit restart, `fail` and `finish` —
   * and from NOWHERE else.
   *
   * In particular not from `reset` or `cancel`. The manager binds
   * `cancel` to ESCAPE, to the pause action, to the map key, to the
   * player's `respawn` event and to ANY overlay opening, and
   * `Minigames.resetAll` calls `reset` from the world's "reset objects"
   * button — so a teleport in either would yank the car across the
   * island because somebody opened the map.
   */
  private returnToStart(): void {
    this.game.vehicle.moveTo(this.startPosition, this.entryYaw)
    this.game.player.position.copy(this.startPosition)
  }

  /** The prompt, pressed while a run is live: back to the mark, clock at zero. */
  private restart(): void {
    this.returnToStart()
    // Cancel first. `start()` takes an early exit while `running`, so
    // restarting a live run without this moved the car and left the old
    // clock running behind it.
    this.cancel('player')
    this.game.minigames.start(this.id)
    this.game.audio?.blip(0.6)
  }

  protected finish(time: number | null = null): void {
    const already = this.state === 'finished'
    super.finish(time)
    if (already || this.state !== 'finished') return
    /*
      A beat before the car moves, so the confetti and the camera kick
      land at the fountain rather than at the mark. `finish` calls
      `prepareAttempt()` before it schedules its own dismissal, so a
      timer registered after it survives — and ESCAPE inside that beat
      kills it, which is the right answer to "leave me alone".

      `resultOrigin` is the fountain, and the manager cancels a finished
      run as 'strayed' once the player is min(140, abandonRadius) from
      it. The mark is 29.9 m from the middle against a radius of 66, so
      the teleport lands with half the radius unspent — which is the
      whole reason the radius was not cut to fit the maze alone.
    */
    this.schedule(1.2, () => this.returnToStart())
  }

  protected fail(message: string): void {
    const already = this.state === 'failed'
    super.fail(message)
    if (already || this.state !== 'failed') return
    // No beat here: the card says PRESS ENTER AT THE ENTRANCE TO RETRY,
    // and leaving somebody nine corridors deep to find the entrance
    // again is how a losing run turned into a five-minute drive out.
    this.returnToStart()
  }

  /**
   * There is nothing to undo but the progress bar and the prompt. This
   * game locks no input, no camera and no player state, disables no
   * collider and MOVES NOBODY — the walls belong to the district rather
   * than to the run — so a cancel puts back only those two. Whether the
   * run was cancelled at the mouth or nine corridors in, the world is
   * identical either way.
   */
  protected reset(): void {
    this.ratio = 0
    this.game.interactions.setLabel(
      'labyrinth-start',
      'RUN THE LABYRINTH',
      `Find the centre inside ${TIME_LIMIT} seconds.`,
    )
  }

  /**
   * The setting is toggled at runtime, so the reduced branch writes the
   * resting pose rather than simply stopping: a beacon abandoned at the
   * top of its bob sits 0.32 m off the mark it is there to point at.
   */
  private animate(): void {
    if (this.game.reducedMotion) {
      this.beacon.rotation.set(0, 0, 0)
      this.beacon.position.y = this.beaconY
      return
    }
    const t = this.game.ticker.elapsedScaled
    this.beacon.rotation.y = t * 0.5
    this.beacon.rotation.x = Math.sin(t * 0.35) * 0.25
    this.beacon.position.y = this.beaconY + Math.sin(t * 1.3) * 0.32

    // The fountain runs, but only for somebody who could see it. Two
    // particles every 0.55 s is four a second; the same drip left on
    // across the island is a pool of live particles nobody is looking
    // at, and the pool is shared with the boost trail.
    const now = this.game.ticker.elapsed
    if (now - this.splashedAt < 0.55) return
    if (this.game.player.position.distanceToSquared(this.centre) > 45 * 45) return
    this.splashedAt = now
    this.game.particles.burst(this.centre.clone().setY(this.centre.y + 3), 2, 'splash')
  }

  /* ========================================================
     TICK
     ======================================================== */

  protected tick(delta: number): void {
    void delta

    // A maze with no losing condition is a walk. Ninety real seconds is
    // three times the shortest route and a little over the cost of
    // driving every wrong turn, so the limit catches an exhaustive
    // search and nothing shorter.
    if (this.elapsed > TIME_LIMIT) {
      this.game.audio?.play('fail')
      this.fail('LOST IN THE MAZE')
      return
    }

    const position = this.game.player.position
    const gx = indexAt(this.xAxis, position.x - this.centre.x)
    const gz = indexAt(this.zAxis, position.z - this.centre.z)
    if (gx < 0 || gz < 0) return

    // Distance is in corridors left to drive, not metres as the crow
    // flies. A wrong turn is supposed to show as one.
    const remaining = this.distance[gz * GRID_W + gx]
    if (remaining < 0) return
    this.ratio = clamp(1 - remaining / this.mouthDistance, 0, 1)
  }

  /* ========================================================
     HUD
     ======================================================== */

  protected briefing(): string {
    return `FIND THE CENTRE IN ${TIME_LIMIT}s`
  }

  protected lines(): string[] {
    // No countdown branch: `leadIn` is 0, so this game is never in the
    // 'countdown' state and a branch for it would be dead code that
    // reads like a promise.
    const best = this.bestTime
    const left = Math.max(0, TIME_LIMIT - this.elapsed)
    return [
      formatTime(this.elapsed),
      `${left.toFixed(0)}s LEFT · FIND THE CENTRE`,
      best !== null ? `BEST ${formatTime(best)} · ESC TO LEAVE` : 'ESC TO LEAVE',
    ]
  }

  protected progress(): number | null {
    return this.ratio
  }
}

/* ============================================================
   GRID → METRES
   ============================================================ */

/**
 * Where each index of one axis of the odd grid sits, in metres from
 * the maze's middle. Even indices are wall thickness, odd ones are
 * corridor width, so the two never have to be assumed equal.
 */
function makeAxis(length: number): Axis {
  let total = 0
  for (let i = 0; i < length; i++) total += i % 2 === 0 ? WALL : CORRIDOR

  const min: number[] = []
  const max: number[] = []
  const centre: number[] = []
  let cursor = -total / 2

  for (let i = 0; i < length; i++) {
    const size = i % 2 === 0 ? WALL : CORRIDOR
    min.push(cursor)
    max.push(cursor + size)
    centre.push(cursor + size / 2)
    cursor += size
  }

  return { min, max, centre }
}

/** Which index of an axis a local coordinate falls in, or -1 outside it. */
function indexAt(axis: Axis, local: number): number {
  for (let i = 0; i < axis.min.length; i++) {
    if (local >= axis.min[i] && local < axis.max[i]) return i
  }
  return -1
}
