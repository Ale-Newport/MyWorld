import * as THREE from 'three'
import { Minigame } from './Minigame'
import { palette } from '../core/palette'
import { clamp, formatTime, seeded } from '../core/maths'
import { easing } from '../core/Tween'
import { chamferedBox } from '../world/geometry'
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

   Three things hold the whole mode up.

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

   SIZES. Corridors are 9.4 m and walls are 1.2 m, both chosen
   around the car rather than around the picture. The car is 2.6 m
   long and about 1.7 m wide, so 9.4 m is enough to turn in
   without shunting, and enough for two mistakes.

   1.2 m walls are thin, and thin static geometry is the kind a
   fast body tunnels through, so: the world steps at 1/60 s real
   with `scale = 2`, giving a 1/30 s simulated step, and a boosting
   car tops out near 40 m/s, so it moves at most ~1.33 m per step.
   Discrete detection misses a slab only when one step clears the
   whole overlap window, which is the wall's thickness plus the
   car's own length: 1.2 + 2.6 = 3.8 m. Nearly three times the
   worst case, with no CCD needed. One cuboid per merged wall is
   therefore enough — and it beats a trimesh of the maze, which is
   slower to query and tunnels more easily rather than less.
   ============================================================ */

/** Change this and every stored best time is for a maze that no longer exists. */
const SEED = 4213

const CELLS_X = 7
const CELLS_Z = 5
/** Odd grid: cells sit on odd indices, the walls between them on even ones. */
const GRID_W = CELLS_X * 2 + 1
const GRID_H = CELLS_Z * 2 + 1

const CENTRE_X = (CELLS_X - 1) / 2
const CENTRE_Z = (CELLS_Z - 1) / 2
/** The mouth is cut in the middle column, so it lines up with the gate. */
const ENTRANCE_COL = CENTRE_X

const CORRIDOR = 9.4
const WALL = 1.2
const WALL_HEIGHT = 2.6
/** How far walls are buried. The plate tilts at its edges; nothing may gap. */
const SKIRT = 1.4

/** Close enough to the middle of the centre chamber to have arrived. */
const COLLECT_RADIUS = 4.2
const MOUTH_RADIUS = 5

const DX = [1, 0, -1, 0]
const DZ = [0, 1, 0, -1]

interface Axis {
  min: number[]
  max: number[]
  centre: number[]
}

export class Labyrinth extends Minigame {
  readonly id: MinigameId = 'labyrinth'
  readonly title = 'LABYRINTH'

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
  private beacon!: THREE.Mesh
  private beaconY = 0

  private ratio = 0

  constructor(game: Game, bin: Bin) {
    super(game, bin)
    // A run can only begin within MOUTH_RADIUS of the mouth, and the
    // far corner of the maze is ~70 m from there, so 80 holds a run
    // together while heading back up the road to KCL ends it.
    this.abandonRadius = 80
  }

  /* ========================================================
     BUILD
     ======================================================== */

  build(): void {
    const district = districtById.labyrinth
    this.centre.set(
      district.x,
      this.game.world.terrain.colliderHeightAt(district.x, district.z),
      district.z,
    )
    this.mouth.set(
      this.centre.x + this.xAxis.centre[ENTRANCE_COL * 2 + 1],
      0,
      this.centre.z + this.zAxis.centre[GRID_H - 1],
    )
    this.mouth.y = this.game.world.terrain.colliderHeightAt(this.mouth.x, this.mouth.z)

    this.carve()
    this.measure()

    this.buildWalls()
    this.buildApproach()
    this.buildCentre()
    this.buildZones()

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

    // Exactly one hole in the boundary, cut in the face the road in
    // from KCL arrives on: the gate at (-214, -76) stands 13 m beyond
    // it, in the same column, so the way in is a straight line from the
    // signpost. Every other boundary cell stays solid.
    open(ENTRANCE_COL * 2 + 1, GRID_H - 1)
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

    const mouthNode = (GRID_H - 1) * GRID_W + (ENTRANCE_COL * 2 + 1)
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
   * draw calls and, more usefully, fewer collider seams for a car to
   * catch on at speed.
   */
  private buildWalls(): void {
    const claimed = new Uint8Array(GRID_W * GRID_H)
    const geometries = new Map<string, THREE.BufferGeometry>()

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

        this.addWall(gx, gz, x1, z1, geometries)
      }
    }
  }

  private addWall(
    gx0: number,
    gz0: number,
    gx1: number,
    gz1: number,
    geometries: Map<string, THREE.BufferGeometry>,
  ): void {
    const x0 = this.centre.x + this.xAxis.min[gx0]
    const x1 = this.centre.x + this.xAxis.max[gx1]
    const z0 = this.centre.z + this.zAxis.min[gz0]
    const z1 = this.centre.z + this.zAxis.max[gz1]

    const width = x1 - x0
    const depth = z1 - z0
    const ground = this.groundRange(x0, x1, z0, z1)

    // Measured from the highest ground under the wall so it is never
    // shorter than 2.6 m anywhere, and buried to the lowest so a tilted
    // plate cannot open a gap under it. Rounded up to the centimetre so
    // that walls of the same size share one geometry.
    const bottom = ground.min - SKIRT
    const height = Math.ceil((ground.max + WALL_HEIGHT - bottom) * 100) / 100
    const at = {
      x: (x0 + x1) / 2,
      y: bottom + height / 2,
      z: (z0 + z1) / 2,
    }

    const key = `${width.toFixed(2)}_${height.toFixed(2)}_${depth.toFixed(2)}`
    let geometry = geometries.get(key)
    if (!geometry) {
      const created = chamferedBox(width, height, depth, 0.07)
      geometries.set(key, created)
      this.bin.add(() => created.dispose())
      geometry = created
    }

    const mesh = new THREE.Mesh(geometry, this.game.materials.get('concrete'))
    mesh.position.set(at.x, at.y, at.z)
    mesh.castShadow = this.game.quality.settings.shadows
    mesh.receiveShadow = this.game.quality.settings.shadows
    this.group.add(mesh)

    // The collider is the box you can see, at the size you can see it.
    // Low restitution on purpose: clipping a corner at 40 m/s should
    // cost you the corner, not fire you across the corridor.
    this.game.physics.add({
      type: 'fixed',
      category: 'floor',
      position: at,
      friction: 0.55,
      restitution: 0.08,
      colliders: [{ shape: 'cuboid', parameters: [width / 2, height / 2, depth / 2] }],
    })
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

  /* ---- the way in ----------------------------------------- */

  /** A threshold across the mouth and a few marks leading up to it. */
  private buildApproach(): void {
    const material = this.game.materials.flat(palette.accent, 0.5)

    const threshold = new THREE.PlaneGeometry(CORRIDOR, WALL)
    threshold.rotateX(-Math.PI / 2)
    const strip = new THREE.Mesh(threshold, material)
    strip.position.set(this.mouth.x, this.mouth.y + 0.07, this.mouth.z)
    strip.renderOrder = 2
    this.group.add(strip)
    this.bin.add(() => threshold.dispose())

    // Decorative only — the run starts on the mouth zone, not on these
    // — so the count may follow the quality level.
    const count = this.game.quality.count(3, 2)
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0
      const z = this.mouth.z + 4 + t * 7
      const geometry = new THREE.PlaneGeometry(3.4, 1)
      geometry.rotateX(-Math.PI / 2)
      const mark = new THREE.Mesh(geometry, material)
      mark.position.set(
        this.mouth.x,
        this.game.world.terrain.colliderHeightAt(this.mouth.x, z) + 0.07,
        z,
      )
      mark.renderOrder = 2
      this.group.add(mark)
      this.bin.add(() => geometry.dispose())
    }
  }

  /* ---- the middle ----------------------------------------- */

  /**
   * A ring on the floor of the centre chamber and a beacon floating
   * above the walls, so the goal is visible from three corridors away.
   * Knowing where the centre is was never the hard part of a maze;
   * hiding it would only add laps, not difficulty.
   */
  private buildCentre(): void {
    const ring = new THREE.RingGeometry(3.2, 3.5, 48)
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
    this.bin.add(() => ring.dispose())

    const geometry = new THREE.OctahedronGeometry(1.05, 0)
    this.beaconY = this.centre.y + 5.2
    this.beacon = new THREE.Mesh(geometry, this.game.materials.get('accent'))
    this.beacon.position.set(this.centre.x, this.beaconY, this.centre.z)
    this.beacon.castShadow = this.game.quality.settings.shadows
    this.group.add(this.beacon)
    this.bin.add(() => geometry.dispose())
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
    // just left. The side the car is on decides: the entrance is cut in
    // the +Z face, so the maze lies at lower z and a car still north of
    // the mouth came from outside. A side test rather than a flag armed
    // by an outer zone, because a flag can be missed — a car running
    // along the north wall and turning in never crosses one.
    if (this.game.player.position.z < this.mouth.z) return

    // Through the manager, not `this.start()`, or nothing would tick it.
    this.game.minigames.start(this.id)
  }

  private onCentre(): void {
    if (this.state === 'finished') return

    this.game.achievements.set('pathFound', 1)
    this.game.audio?.blip(1.8)
    this.game.view.kick(0.5)
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
    if (started) this.game.audio?.blip(0.8)
    return started
  }

  /**
   * There is nothing to undo. This game locks no input, no camera and
   * no player state, disables no collider and moves nobody — the walls
   * belong to the district rather than to the run — so a cancel puts
   * back only the progress bar. Whether the run was cancelled at the
   * mouth or nine corridors in, the world is identical either way.
   */
  protected reset(): void {
    this.ratio = 0
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
  }

  /* ========================================================
     TICK
     ======================================================== */

  protected tick(delta: number): void {
    void delta

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

  protected lines(): string[] {
    const best = this.bestTime
    return [
      formatTime(this.elapsed),
      'FIND THE CENTRE',
      best !== null ? `BEST ${formatTime(best)}` : 'NO BEST TIME YET',
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
