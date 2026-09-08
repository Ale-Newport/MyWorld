import * as THREE from 'three'
import { palette } from '../../core/palette'
import { clamp, dist2, seeded, smoothstep } from '../../core/maths'
import { easing } from '../../core/Tween'
import { chamferedBox } from '../geometry'
import type { Bin } from '../../core/Disposal'
import type { Game } from '../../Game'
import type { ColliderDescription, Physical } from '../../physics/Physics'
import { districtById, landmarkById, ramps, roads } from '@/content/world'

/* ============================================================
   VOXEL FIELD — SEED CHUNKS

   The district for the Minecraft Seed Finder (procedural
   generation search, written in Python and C). It is a set piece
   rather than a mini-game: no timer, no start, nothing locked,
   nothing to fail. The one thing it has to say is what that
   project was — a generator you can drive around inside.

   So the ground here is made the way that search was: a seeded
   height function evaluated per column, chunk by chunk, the same
   on every reload, with nothing stored anywhere. Change the seed
   at the top of this file and the district is a different world.

   Nothing in here is taken from Minecraft. The blocks are cubes
   because cubes are what a height function quantised in two axes
   looks like.

   Four decisions worth explaining, because each of them is a
   place where the obvious version does not work:

   1. THE VERTICAL LATTICE IS A QUARTER OF A BLOCK. Blocks are
      1.8 m cubes, but the surface is quantised to 0.5 m. A
      full-block step is 1.8 m, which is taller than the car's
      whole body: 0.4 m wheels on 0.88 m of suspension cannot
      climb it and the chassis hits it flat. A true one-block
      lattice would be a field you can look at and never drive
      on. At 0.5 m one terrace is drivable and four of them are
      a cliff, which is the read the district wants anyway.
   2. COLLIDERS ARE THE SURFACE, EXTRUDED DOWNWARDS. Only columns
      with air above them get one; buried blocks get nothing. But
      a lone cube collider perched on top of an uncollided stack
      lets the car drive straight through the face of a cliff and
      end up inside the hill, so each surface collider runs from
      its own top face down past the ground. Same count as one
      per surface block, no hollow cliffs. Runs of neighbouring
      columns that share a top face merge into a single box, which
      takes about a third of them back off again.
   3. THE EDGE FADES TO NOTHING. Column height is multiplied by a
      smoothstep that reaches zero at the district radius, so the
      smooth terrain does not meet the field at a wall — it thins
      to a single 0.5 m lip and stops. That fade is also the only
      reason the field is drivable at all: it is the ramp.
   4. QUALITY SCALES THE BLOCK COUNT, NEVER THE SILHOUETTE. The
      generator emits about 2,900 blocks from 923 columns; about
      1,200 of them have a face touching air and the rest are
      buried inside the mass. Blocks are emitted exposed-first and
      cut off at `quality.count`, floored at the exposed set — so
      LOW draws little more than the shell, HIGH fills in behind
      it, and the outline, the colours and every collider are
      identical.
      The fill earns its instances at HIGH for one reason: the
      chase camera can be pushed inside a mesa, and a one-layer
      shell seen from the inside is a hole through the district.

   THE SECRET. Five blocks carry an inlay. Drive over them in
   order and the dead end at the bottom of the slot canyon sinks
   into the ground, opening the chamber under the monolith where
   the `voxel-room` terminal stands. Detection is deliberately
   soft — a 3.4 m radius, no time limit, no penalty for touching
   the wrong one — and once the first block is lit the next one
   carries a beacon, so the trail can be followed rather than
   guessed. Solving it once is remembered: if the achievement is
   already unlocked the hatch is built open.

   The field holds no player state of its own — no camera
   take-over, no input filter, no lock, no disabled terrain — so
   `reset()` has only the sequence to clear, and never re-closes
   a hatch somebody has already earned.
   ============================================================ */

/** Cube edge, metres. See note 1 above for why it is not exactly two. */
const BLOCK = 1.8
/** Surface quantisation. A quarter of a block, and drivable. */
const TERRACE = 0.5
/**
 * What counts as one step when testing whether the car could get
 * somewhere. A terrace plus slack, because the terrain the field
 * stands on rolls a few centimetres between columns and two tops on
 * the same terrace are not bit-identical out near the rim.
 */
const STEP_TOLERANCE = TERRACE + 0.15
/** Columns per chunk edge: 8 × 1.8 m = 14.4 m. Biome bands change here. */
const CHUNK = 8

/** Half-width of the chamber, in columns. Nine columns across = 16.2 m. */
const ROOM_HALF = 4
/** Headroom under the chunks. Three blocks exactly, so the ceiling is flat. */
const ROOM_HEIGHT = BLOCK * 3
/** Doorway height. Two blocks, which is the hatch. */
const DOOR_HEIGHT = BLOCK * 2
/** The monolith over the chamber: room + ceiling, five blocks exactly. */
const MONOLITH = BLOCK * 5
/** How far the hatch sinks. Far enough to be inside the ground. */
const DOOR_DROP = DOOR_HEIGHT + 0.7

const SEQUENCE = 5
/** Forgiving on purpose — the car is 2.6 m long and often sideways. */
const MARKER_RADIUS = 3.4
const BEAM_HEIGHT = 3.4

const ROOM_LANDMARK = 'voxel-room'
const SEED_LANDMARK = 'voxel-seed'
const ROAD_ID = 'ucl-voxel'
const RAMP_ID = 'ramp-voxel'
const ACHIEVEMENT = 'underground'

/* ------------------------------------------------------------
   BANDS
   One material per band, one InstancedMesh per material. Bands
   follow height, offset per chunk so the boundaries break on
   chunk seams rather than drawing contour lines round the field.
   ------------------------------------------------------------ */

interface Band {
  colour: string
  roughness: number
  /** Upper bound of the band, in metres of column height. */
  ceiling: number
}

const BANDS: Band[] = [
  { colour: palette.paper4, roughness: 0.95, ceiling: 1.6 },
  { colour: palette.signalSoft, roughness: 0.9, ceiling: 4.6 },
  { colour: palette.signal, roughness: 0.9, ceiling: 8.2 },
  { colour: palette.concreteDark, roughness: 0.92, ceiling: 12.5 },
  { colour: palette.chalk, roughness: 0.86, ceiling: Infinity },
  // Everything below the surface block. One colour, because a cut
  // through the field should read as one material rather than as a
  // stack of biomes with their biomes still on them.
  { colour: palette.concrete, roughness: 0.94, ceiling: Infinity },
]
const SUBSTRATE = BANDS.length - 1

/** Marker states. Held as colours rather than parsed from hex per frame. */
const MARKER_PENDING = new THREE.Color(palette.ink3)
const MARKER_TARGET = new THREE.Color(palette.accent)
const MARKER_DONE = new THREE.Color(palette.signalSoft)

/* ------------------------------------------------------------
   NOISE
   The same shape of value noise the terrain uses, on its own
   seed. Module scope, so the offsets are fixed at import and the
   field is identical for every visitor.
   ------------------------------------------------------------ */

const rand = seeded(9124137)
const OCTAVES = Array.from({ length: 4 }, () => ({ ox: rand() * 1000, oz: rand() * 1000 }))

function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123
  return s - Math.floor(s)
}

function valueNoise(x: number, z: number): number {
  const xi = Math.floor(x)
  const zi = Math.floor(z)
  const xf = x - xi
  const zf = z - zi
  const u = xf * xf * (3 - 2 * xf)
  const v = zf * zf * (3 - 2 * zf)

  const a = hash2(xi, zi)
  const b = hash2(xi + 1, zi)
  const c = hash2(xi, zi + 1)
  const d = hash2(xi + 1, zi + 1)

  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

function fbm(x: number, z: number, octaves: number): number {
  let amplitude = 1
  let frequency = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    const octave = OCTAVES[i]
    sum += valueNoise(x * frequency + octave.ox, z * frequency + octave.oz) * amplitude
    norm += amplitude
    amplitude *= 0.5
    frequency *= 2.1
  }
  return sum / norm
}

function distanceToPolyline(x: number, z: number, points: [number, number][]): number {
  let best = Infinity
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i]
    const [bx, bz] = points[i + 1]
    const dx = bx - ax
    const dz = bz - az
    const lengthSq = dx * dx + dz * dz || 1e-6
    const t = clamp(((x - ax) * dx + (z - az) * dz) / lengthSq, 0, 1)
    const distance = Math.hypot(x - (ax + dx * t), z - (az + dz * t))
    if (distance < best) best = distance
  }
  return best
}

/* ------------------------------------------------------------
   TYPES
   ------------------------------------------------------------ */

interface Column {
  i: number
  j: number
  x: number
  z: number
  /** Terrain elevation the stack sits on. */
  baseY: number
  /** Metres of solid above `baseY`, quantised to TERRACE. */
  height: number
  /** World Y of the top face. */
  topY: number
  /** World Y where solid begins. Equal to `baseY` unless hollow. */
  floorY: number
  /** True where the chamber or the doorway has been cut out below. */
  hollow: boolean
  /** Biome band of the surface block. */
  band: number
}

interface PlacedBlock {
  x: number
  y: number
  z: number
  band: number
}

interface Marker {
  x: number
  z: number
  topY: number
  material: THREE.MeshBasicMaterial
}

/** Everything derived from the content layer before generation starts. */
interface Plan {
  centreX: number
  centreZ: number
  radius: number
  roadPoints: [number, number][]
  roadInner: number
  seedX: number
  seedZ: number
  seedInner: number
  rampX: number
  rampZ: number
  rampInner: number
  roomX: number
  roomZ: number
  monolithInner: number
  monolithOuter: number
  canyon: [number, number][]
  roomI: number
  roomJ: number
  doorJ: number
  chamberBaseY: number
}

export class VoxelField {
  private readonly group = new THREE.Group()
  private readonly doorGroup = new THREE.Group()

  private plan!: Plan

  /** Index rectangle. `half` columns either side of the district centre. */
  private half = 0
  private span = 0
  private cells: (Column | null)[] = []
  private surfaceY: Float32Array = new Float32Array(0)
  private columns: Column[] = []

  private markers: Marker[] = []
  private progress = 0
  private opened = false
  private primed = false

  private beam: THREE.Mesh | null = null
  private doorPhysical: Physical | null = null

  constructor(private game: Game, private bin: Bin) {}

  /* ========================================================
     BUILD
     ======================================================== */

  build(): void {
    this.plan = this.makePlan()
    this.generate()
    this.buildBlocks()
    this.buildColliders()
    this.buildChamber()
    this.buildHatch()
    this.buildMarkers()

    // The chamber's terminal is a secret. Its prompt is switched off
    // on the first frame rather than here, because the interaction
    // point is registered by the Game after every district is built
    // and setting it earlier would silently do nothing.
    this.opened = this.game.achievements.isUnlocked(ACHIEVEMENT)
    if (this.opened) this.openHatch(true)

    // A field that somehow produced no markers must not produce a
    // room nobody can reach. This seed places all five; a different
    // one, or a moved landmark, might not.
    if (this.markers.length < 2 && !this.opened) this.openHatch(true)

    this.game.renderer.scene.add(this.group)
    this.bin.object3D(this.group)

    const tick = () => this.update()
    this.game.ticker.events.on('tick', tick, 15)
    this.bin.add(() => this.game.ticker.events.off('tick', tick))
  }

  /**
   * Everything the field has to work around, read from the content
   * layer rather than typed in twice: the road that ends at the
   * district centre, the ramp on its southern approach, the seed
   * monument, and the terminal the chamber is built under.
   */
  private makePlan(): Plan {
    const district = districtById.voxel
    const road = roads.find((item) => item.id === ROAD_ID)
    const ramp = ramps.find((item) => item.id === RAMP_ID)
    const seed = landmarkById[SEED_LANDMARK]
    const room = landmarkById[ROOM_LANDMARK]

    const centreX = district.x
    const centreZ = district.z

    // The chamber is centred on the nearest column to the terminal,
    // so its walls land on block boundaries and its ceiling is flat.
    const roomI = Math.round(((room?.x ?? centreX) - centreX) / BLOCK)
    const roomJ = Math.round(((room?.z ?? centreZ) - centreZ) / BLOCK)
    const roomX = centreX + roomI * BLOCK
    const roomZ = centreZ + roomJ * BLOCK

    // The doorway sits one column outside the chamber's north wall.
    const doorJ = roomJ - (ROOM_HALF + 1)
    const doorFrontZ = centreZ + (doorJ - 0.5) * BLOCK

    // Full height out to the door row, then a wall rather than a
    // ramp: the monolith is meant to be climbed round, not over.
    const monolithInner = (ROOM_HALF + 1) * BLOCK + 0.5

    return {
      centreX,
      centreZ,
      radius: district.radius,
      roadPoints: road?.points ?? [],
      roadInner: (road?.width ?? 7) * 0.64,
      seedX: seed?.x ?? centreX,
      seedZ: seed?.z ?? centreZ,
      seedInner: seed?.radius ?? 10,
      rampX: ramp?.x ?? centreX,
      rampZ: ramp?.z ?? centreZ,
      rampInner: (ramp?.length ?? 14) * 0.64,
      roomX,
      roomZ,
      monolithInner,
      monolithOuter: monolithInner + 3.1,
      canyon: [[centreX, centreZ], [roomX, doorFrontZ]],
      roomI,
      roomJ,
      doorJ,
      chamberBaseY: this.game.world.terrain.colliderHeightAt(roomX, roomZ),
    }
  }

  /* ========================================================
     HEIGHT FIELD
     ======================================================== */

  /**
   * Metres of blocks above the ground at (x, z), quantised to the
   * terrace. Pure and cheap: it is called once per column at build
   * and never again.
   */
  private surfaceAt(x: number, z: number, j: number): number {
    const p = this.plan

    // Three layers. The first two are gentle enough that the terrace
    // steps between neighbouring columns are usually one lip; the
    // third is a sharp threshold, and it is where the cliffs are.
    const low = fbm(x * 0.012, z * 0.012, 3)
    const mid = fbm(x * 0.055, z * 0.055, 2)
    const mesa = fbm(x * 0.028, z * 0.028, 2)

    let height = 6 + (low - 0.5) * 3.5 + (mid - 0.5) * 1
    height += smoothstep(mesa, 0.52, 0.62) * 11
    height = Math.max(0, height)

    // Whatever was here first keeps its ground, and keeps a slope
    // out of it: these three clearings are how the field is entered.
    if (p.roadPoints.length > 1) {
      height *= smoothstep(distanceToPolyline(x, z, p.roadPoints), p.roadInner, p.roadInner + 12)
    }
    height *= smoothstep(Math.hypot(x - p.seedX, z - p.seedZ), p.seedInner, p.seedInner + 9)
    height *= smoothstep(Math.hypot(x - p.rampX, z - p.rampZ), p.rampInner, p.rampInner + 8)

    // The dissolve at the district edge.
    height *= 1 - smoothstep(Math.hypot(x - p.centreX, z - p.centreZ), p.radius * 0.5, p.radius)

    // The monolith over the chamber, applied on top of the fade
    // rather than under it: it has to be tall enough to hold a room
    // whatever the fade would otherwise have done to it out here.
    const chebyshev = Math.max(Math.abs(x - p.roomX), Math.abs(z - p.roomZ))
    height = Math.max(height, MONOLITH * (1 - smoothstep(chebyshev, p.monolithInner, p.monolithOuter)))

    // The slot canyon, cut only on the approach side of the door so
    // it stops dead against the wall the hatch is in.
    if (j < p.doorJ) {
      height = Math.min(height, Math.max(0, distanceToPolyline(x, z, p.canyon) - 3.2) * 2.5)
    }

    return Math.round(Math.max(0, height) / TERRACE) * TERRACE
  }

  /* ========================================================
     COLUMNS
     ======================================================== */

  private generate(): void {
    const p = this.plan
    const terrain = this.game.world.terrain

    this.half = Math.ceil((p.radius + 6) / BLOCK)
    this.span = this.half * 2 + 1
    this.cells = new Array<Column | null>(this.span * this.span).fill(null)
    this.surfaceY = new Float32Array(this.span * this.span)

    const chunkLow = Math.floor(-this.half / CHUNK)
    const chunkHigh = Math.floor(this.half / CHUNK)

    // Chunk by chunk, the way the thing it is about generated its
    // world. The order is invisible in the result; the chunk index
    // is not, because the biome offset is sampled from it.
    for (let cz = chunkLow; cz <= chunkHigh; cz++) {
      for (let cx = chunkLow; cx <= chunkHigh; cx++) {
        const biome = hash2(cx * 13.7 + 0.5, cz * 7.3 + 0.5)

        for (let j = cz * CHUNK; j < (cz + 1) * CHUNK; j++) {
          if (j < -this.half || j > this.half) continue
          for (let i = cx * CHUNK; i < (cx + 1) * CHUNK; i++) {
            if (i < -this.half || i > this.half) continue

            const x = p.centreX + i * BLOCK
            const z = p.centreZ + j * BLOCK
            const cell = this.cellIndex(i, j)

            const inRoom = Math.abs(i - p.roomI) <= ROOM_HALF && Math.abs(j - p.roomJ) <= ROOM_HALF
            const inDoor = j === p.doorJ && Math.abs(i - p.roomI) <= 1
            const chebyshev = Math.max(Math.abs(x - p.roomX), Math.abs(z - p.roomZ))

            // The monolith's flat top shares one base elevation, or
            // its ceiling would follow the terrain's gentle roll and
            // the chamber would have a sloping roof.
            const baseY = chebyshev <= p.monolithInner
              ? p.chamberBaseY
              : terrain.colliderHeightAt(x, z)

            const height = this.surfaceAt(x, z, j)
            this.surfaceY[cell] = baseY + height
            if (height <= 0) continue

            const floorY = inRoom
              ? p.chamberBaseY + ROOM_HEIGHT
              : inDoor
                ? p.chamberBaseY + DOOR_HEIGHT
                : baseY

            const column: Column = {
              i, j, x, z, baseY, height,
              topY: baseY + height,
              floorY,
              hollow: inRoom || inDoor,
              band: bandFor(height, biome),
            }
            this.cells[cell] = column
            this.columns.push(column)
          }
        }
      }
    }
  }

  private cellIndex(i: number, j: number): number {
    return (j + this.half) * this.span + (i + this.half)
  }

  private columnAt(i: number, j: number): Column | null {
    if (i < -this.half || i > this.half || j < -this.half || j > this.half) return null
    return this.cells[this.cellIndex(i, j)]
  }

  /* ========================================================
     BLOCKS
     ======================================================== */

  private buildBlocks(): void {
    const exposed: PlacedBlock[] = []
    const buried: PlacedBlock[] = []

    for (const column of this.columns) {
      const neighbours = [
        this.columnAt(column.i + 1, column.j),
        this.columnAt(column.i - 1, column.j),
        this.columnAt(column.i, column.j + 1),
        this.columnAt(column.i, column.j - 1),
      ]

      let top = column.topY
      let depth = 0
      while (top > column.floorY + 1e-3) {
        // A hollow column's lowest block is pulled up so its underside
        // is exactly the ceiling. It overlaps the block above, which
        // costs nothing and is the only way the ceiling the visitor
        // sees is the ceiling the collider stops them at.
        const snap = column.hollow && top - BLOCK < column.floorY - 1e-3
        const centreY = snap ? column.floorY + BLOCK / 2 : top - BLOCK / 2
        const bottom = centreY - BLOCK / 2
        const ceiling = centreY + BLOCK / 2

        // Buried means every side is covered by a neighbour that is
        // solid across this block's whole span — which is also what
        // makes the chamber's walls draw: their inner faces are not.
        const hidden = neighbours.every(
          (n) => n !== null && solidFloor(n) <= bottom + 1e-3 && n.topY >= ceiling - 1e-3,
        )

        const block: PlacedBlock = {
          x: column.x,
          y: centreY,
          z: column.z,
          band: depth === 0 ? column.band : SUBSTRATE,
        }
        if (hidden) buried.push(block)
        else exposed.push(block)

        top -= BLOCK
        depth++
      }
    }

    // The budget can take blocks away from the fill, never from the
    // shell: LOW and HIGH must have the same outline.
    const budget = Math.max(exposed.length, this.game.quality.count(4200, 1400))
    const drawn = exposed.concat(buried.slice(0, Math.max(0, budget - exposed.length)))

    const counts = new Array<number>(BANDS.length).fill(0)
    for (const block of drawn) counts[block.band]++

    const geometry = chamferedBox(BLOCK, BLOCK, BLOCK, 0.05)
    this.bin.add(() => geometry.dispose())

    const shadows = this.game.quality.settings.shadows
    const matrix = new THREE.Matrix4()
    const cursors = new Array<number>(BANDS.length).fill(0)
    const meshes: (THREE.InstancedMesh | null)[] = BANDS.map((band, index) => {
      if (counts[index] === 0) return null
      const material = this.game.materials.tinted(band.colour, band.roughness, 0)
      const mesh = new THREE.InstancedMesh(geometry, material, counts[index])
      mesh.castShadow = shadows
      mesh.receiveShadow = shadows
      this.group.add(mesh)
      return mesh
    })

    for (const block of drawn) {
      const mesh = meshes[block.band]
      if (!mesh) continue
      matrix.makeTranslation(block.x, block.y, block.z)
      mesh.setMatrixAt(cursors[block.band]++, matrix)
    }

    for (const mesh of meshes) {
      if (!mesh) continue
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    }
  }

  /* ========================================================
     COLLIDERS

     One fixed body carrying every box, rather than a body each.
     Six hundred-odd static cuboids are nothing to the broad
     phase; six hundred-odd rigid bodies are a list the physics
     step walks through on every substep, for ever.
     ======================================================== */

  private buildColliders(): void {
    const descriptions: ColliderDescription[] = []
    let run: Column[] = []

    const flush = () => {
      if (run.length === 0) return
      const first = run[0]
      const last = run[run.length - 1]
      const top = first.topY
      // Open ground is solid all the way into the terrain below it,
      // so its box is extruded past the base rather than stopping at
      // it. A hollow column stops exactly at the ceiling.
      let bottom = first.floorY
      if (!first.hollow) {
        let lowest = first.baseY
        for (const column of run) lowest = Math.min(lowest, column.baseY)
        bottom = lowest - 2
      }
      const minX = first.x - BLOCK / 2
      const maxX = last.x + BLOCK / 2

      descriptions.push({
        shape: 'cuboid',
        parameters: [(maxX - minX) / 2, (top - bottom) / 2, BLOCK / 2],
        position: { x: (minX + maxX) / 2, y: (top + bottom) / 2, z: first.z },
      })
      run = []
    }

    for (let j = -this.half; j <= this.half; j++) {
      for (let i = -this.half; i <= this.half + 1; i++) {
        const column = this.columnAt(i, j)
        const last = run.length > 0 ? run[run.length - 1] : null

        const joins =
          column !== null && last !== null &&
          Math.abs(column.topY - last.topY) < 1e-3 &&
          column.hollow === last.hollow &&
          (!column.hollow || Math.abs(column.floorY - last.floorY) < 1e-3)

        if (column !== null && (last === null || joins)) {
          run.push(column)
          continue
        }
        flush()
        if (column !== null) run.push(column)
      }
      flush()
    }

    this.game.physics.add({
      type: 'fixed',
      category: 'floor',
      friction: 0.92,
      restitution: 0.02,
      colliders: descriptions,
    })
  }

  /* ========================================================
     THE CHAMBER

     The room is a hollow in the monolith at ground level, so its
     floor is the terrain and its walls are the surrounding
     columns' own colliders — the only thing it needs of its own
     is a liner, because a room lit by nothing but a shadowed
     directional light looks like a bug at HIGH and like an
     accident at LOW.
     ======================================================== */

  private buildChamber(): void {
    const p = this.plan
    const baseY = p.chamberBaseY
    const width = (ROOM_HALF * 2 + 1) * BLOCK
    const doorWidth = BLOCK * 3
    const minZ = p.roomZ - width / 2
    const maxZ = p.roomZ + width / 2
    const minX = p.roomX - width / 2
    const maxX = p.roomX + width / 2

    const dark = this.game.materials.flat(palette.voidDark3)
    const darker = this.game.materials.flat(palette.voidDark2)

    const panel = (
      w: number, h: number, material: THREE.Material,
      x: number, y: number, z: number, rotationY: number, rotationX = 0,
    ) => {
      const geometry = new THREE.PlaneGeometry(w, h)
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.set(x, y, z)
      mesh.rotation.set(rotationX, rotationY, 0)
      this.group.add(mesh)
      this.bin.add(() => geometry.dispose())
      return mesh
    }

    const midY = baseY + ROOM_HEIGHT / 2

    // Floor. Painted rather than lit, so the chamber reads the same
    // whether or not the quality level draws shadows.
    panel(width, width, darker, p.roomX, baseY + 0.04, p.roomZ, 0, -Math.PI / 2)
    // Ceiling.
    panel(width, width, dark, p.roomX, baseY + ROOM_HEIGHT - 0.04, p.roomZ, 0, Math.PI / 2)
    // South, east and west walls.
    panel(width, ROOM_HEIGHT, dark, p.roomX, midY, maxZ - 0.04, Math.PI)
    panel(width, ROOM_HEIGHT, dark, minX + 0.04, midY, p.roomZ, Math.PI / 2)
    panel(width, ROOM_HEIGHT, dark, maxX - 0.04, midY, p.roomZ, -Math.PI / 2)
    // North wall, in three pieces around the doorway.
    const cheek = (width - doorWidth) / 2
    panel(cheek, ROOM_HEIGHT, dark, minX + cheek / 2, midY, minZ + 0.04, 0)
    panel(cheek, ROOM_HEIGHT, dark, maxX - cheek / 2, midY, minZ + 0.04, 0)
    panel(
      doorWidth, ROOM_HEIGHT - DOOR_HEIGHT, dark,
      p.roomX, baseY + (ROOM_HEIGHT + DOOR_HEIGHT) / 2, minZ + 0.04, 0,
    )

    // Four strips where the walls meet the ceiling. Unlit, so they
    // stay legible at every quality level and at night.
    const stripGeometry = new THREE.BoxGeometry(width - 0.4, 0.14, 0.14)
    this.bin.add(() => stripGeometry.dispose())
    const strip = this.game.materials.get('emissiveSignal')
    const stripY = baseY + ROOM_HEIGHT - 0.36
    for (const [x, z, rotation] of [
      [p.roomX, minZ + 0.3, 0],
      [p.roomX, maxZ - 0.3, 0],
      [minX + 0.3, p.roomZ, Math.PI / 2],
      [maxX - 0.3, p.roomZ, Math.PI / 2],
    ] as [number, number, number][]) {
      const mesh = new THREE.Mesh(stripGeometry, strip)
      mesh.position.set(x, stripY, z)
      mesh.rotation.y = rotation
      this.group.add(mesh)
    }
  }

  /* ========================================================
     THE HATCH
     ======================================================== */

  private buildHatch(): void {
    const p = this.plan
    const doorZ = p.centreZ + p.doorJ * BLOCK
    const baseY = p.chamberBaseY

    // Six cubes in the substrate colour, because a door you can
    // pick out of the wall it is in is not a door worth finding.
    const geometry = chamferedBox(BLOCK, BLOCK, BLOCK, 0.05)
    this.bin.add(() => geometry.dispose())
    const material = this.game.materials.tinted(BANDS[SUBSTRATE].colour, BANDS[SUBSTRATE].roughness, 0)
    const shadows = this.game.quality.settings.shadows

    for (let k = -1; k <= 1; k++) {
      for (let layer = 0; layer < 2; layer++) {
        const mesh = new THREE.Mesh(geometry, material)
        mesh.position.set(p.roomX + k * BLOCK, baseY + BLOCK / 2 + layer * BLOCK, doorZ)
        mesh.castShadow = shadows
        mesh.receiveShadow = shadows
        this.doorGroup.add(mesh)
      }
    }
    this.group.add(this.doorGroup)

    this.doorPhysical = this.game.physics.add({
      type: 'fixed',
      category: 'floor',
      position: { x: p.roomX, y: baseY + DOOR_HEIGHT / 2, z: doorZ },
      friction: 0.9,
      restitution: 0.02,
      colliders: [{ shape: 'cuboid', parameters: [BLOCK * 1.5, DOOR_HEIGHT / 2, BLOCK / 2] }],
    })
  }

  /* ========================================================
     THE SEQUENCE

     Markers are chosen from columns the car can actually get to.
     A flood fill from the plate outside the field, stepping only
     where neighbouring surfaces are within one terrace, is the
     same test the car passes, so a marker can never end up on a
     mesa top with no way up.
     ======================================================== */

  private buildMarkers(): void {
    const p = this.plan
    const reachable = this.floodReachable()

    const flat = (column: Column) =>
      [
        this.columnAt(column.i + 1, column.j),
        this.columnAt(column.i - 1, column.j),
        this.columnAt(column.i, column.j + 1),
        this.columnAt(column.i, column.j - 1),
      ].every((n) => Math.abs((n?.topY ?? column.baseY) - column.topY) <= STEP_TOLERANCE)

    const chosen: Column[] = []
    for (let k = 0; k < SEQUENCE; k++) {
      // Five aiming points spread evenly round a ring inside the
      // field, so the trail is a lap of the district rather than a
      // line across it. Each marker is the nearest column that
      // passes every test below.
      const angle = Math.PI + (k * Math.PI * 2) / SEQUENCE
      const targetX = p.centreX + Math.cos(angle) * p.radius * 0.6
      const targetZ = p.centreZ + Math.sin(angle) * p.radius * 0.6

      let best: Column | null = null
      let bestDistance = Infinity
      for (const column of this.columns) {
        if (column.height < 1) continue
        if (Math.hypot(column.x - p.centreX, column.z - p.centreZ) > p.radius - 4) continue
        if (!reachable.has(this.cellIndex(column.i, column.j))) continue
        if (Math.max(Math.abs(column.x - p.roomX), Math.abs(column.z - p.roomZ)) < 13) continue
        if (!flat(column)) continue
        if (chosen.some((other) => Math.hypot(other.x - column.x, other.z - column.z) < 13)) continue

        const distance = Math.hypot(column.x - targetX, column.z - targetZ)
        if (distance < bestDistance) {
          bestDistance = distance
          best = column
        }
      }
      if (best) chosen.push(best)
    }

    const inlay = new THREE.PlaneGeometry(BLOCK * 0.62, BLOCK * 0.62)
    inlay.rotateX(-Math.PI / 2)
    this.bin.add(() => inlay.dispose())

    for (const column of chosen) {
      const material = this.game.materials.own(
        new THREE.MeshBasicMaterial({
          color: MARKER_PENDING.clone(),
          transparent: true,
          opacity: 0.18,
          depthWrite: false,
          toneMapped: false,
        }),
      )
      const mesh = new THREE.Mesh(inlay, material)
      mesh.position.set(column.x, column.topY + 0.03, column.z)
      mesh.renderOrder = 2
      this.group.add(mesh)

      this.markers.push({ x: column.x, z: column.z, topY: column.topY, material })
    }

    // One beacon, moved to whichever marker is next — a beam each
    // would cost five draw calls with four of them switched off.
    const beamGeometry = new THREE.CylinderGeometry(0.55, 0.55, BEAM_HEIGHT, 10, 1, true)
    this.bin.add(() => beamGeometry.dispose())
    this.beam = new THREE.Mesh(
      beamGeometry,
      this.game.materials.own(
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(palette.accent),
          transparent: true,
          opacity: 0.22,
          side: THREE.DoubleSide,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
    )
    this.beam.visible = false
    this.beam.renderOrder = 3
    this.group.add(this.beam)
  }

  /** Cells the car can reach from outside, one terrace at a time. */
  private floodReachable(): Set<number> {
    const seen = new Set<number>()
    const queue: [number, number][] = []

    for (let j = -this.half; j <= this.half; j++) {
      for (let i = -this.half; i <= this.half; i++) {
        const x = this.plan.centreX + i * BLOCK
        const z = this.plan.centreZ + j * BLOCK
        const r = Math.hypot(x - this.plan.centreX, z - this.plan.centreZ)
        if (r < this.plan.radius - 2 || r > this.plan.radius + 4) continue
        if (this.columnAt(i, j) !== null) continue
        const cell = this.cellIndex(i, j)
        if (seen.has(cell)) continue
        seen.add(cell)
        queue.push([i, j])
      }
    }

    while (queue.length > 0) {
      const next = queue.pop()
      if (!next) break
      const [i, j] = next
      const from = this.surfaceY[this.cellIndex(i, j)]

      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
        const ni = i + di
        const nj = j + dj
        if (ni < -this.half || ni > this.half || nj < -this.half || nj > this.half) continue
        const cell = this.cellIndex(ni, nj)
        if (seen.has(cell)) continue
        if (Math.abs(this.surfaceY[cell] - from) > STEP_TOLERANCE) continue
        seen.add(cell)
        queue.push([ni, nj])
      }
    }

    return seen
  }

  /* ========================================================
     PER-FRAME
     ======================================================== */

  private update(): void {
    if (!this.primed) {
      this.primed = true
      this.game.interactions.setEnabled(ROOM_LANDMARK, this.opened)
    }

    const target = this.opened ? null : (this.markers[this.progress] ?? null)

    if (this.beam) {
      const show = target !== null && this.progress > 0
      this.beam.visible = show
      if (show && target) {
        this.beam.position.set(target.x, target.topY + BEAM_HEIGHT / 2, target.z)
      }
    }

    if (!target) return

    // The next marker breathes. It is the only thing in the district
    // that moves, which is what makes it findable from a moving car.
    const wave = Math.sin(this.game.ticker.elapsedScaled * 3.1) * 0.5 + 0.5
    target.material.color.copy(MARKER_TARGET)
    target.material.opacity = 0.35 + wave * 0.45

    const player = this.game.player.position
    if (dist2(player.x, player.z, target.x, target.z) > MARKER_RADIUS * MARKER_RADIUS) return
    // Vertical window, so passing under an overhanging marker on a
    // cliff below does not count as standing on it.
    if (player.y < target.topY - 2.2 || player.y > target.topY + 6) return

    this.advance()
  }

  private advance(): void {
    const marker = this.markers[this.progress]
    if (!marker) return

    marker.material.color.copy(MARKER_DONE)
    marker.material.opacity = 0.85
    this.progress++

    // Each step a little brighter, so the run is audible.
    this.game.audio.blip(1 + this.progress * 0.12)

    if (this.progress >= this.markers.length) this.openHatch(false)
  }

  /* ========================================================
     THE HATCH OPENS
     ======================================================== */

  private openHatch(instant: boolean): void {
    if (this.opened && !instant) return
    this.opened = true

    if (this.beam) this.beam.visible = false
    this.doorPhysical?.body.setEnabled(false)

    if (instant) {
      this.doorGroup.position.y = -DOOR_DROP
      // Built open because it was solved on an earlier visit, so the
      // trail is shown solved too rather than sitting there unlit.
      this.progress = this.markers.length
      for (const marker of this.markers) {
        marker.material.color.copy(MARKER_DONE)
        marker.material.opacity = 0.85
      }
    } else {
      this.game.tweens.to(this.doorGroup.position, { y: -DOOR_DROP }, {
        duration: 1.9,
        ease: easing.power2InOut,
      })
      this.game.view.kick(0.35)
      this.game.audio.play('achievement')
      this.game.store.getState().notify({
        kind: 'info',
        title: 'SEED FOUND',
        body: 'The dead end at the bottom of the canyon has sunk into the ground.',
        duration: 5.5,
      })

      // Recorded on the path that earned it, and only there. The
      // instant path is either a replay of a visit that already
      // unlocked this or the degenerate safety net in `build`, and
      // handing out a hidden achievement for either is a lie.
      this.game.achievements.set(ACHIEVEMENT, 1)
    }

    // Only meaningful once the interaction point exists; on the build
    // path `primed` picks it up on the first frame instead.
    if (this.primed) this.game.interactions.setEnabled(ROOM_LANDMARK, true)
  }

  /* ========================================================
     RESET
     Nothing calls this yet — the Game builds the district and
     drops the reference — so it is here to match the other
     district set piece and to keep the rule written down: a
     reset clears an unfinished sequence and never closes a hatch
     that has been opened. Taking a secret back off somebody is
     not a reset.
     ======================================================== */

  reset(): void {
    if (this.opened) return
    this.progress = 0
    for (const marker of this.markers) {
      marker.material.color.copy(MARKER_PENDING)
      marker.material.opacity = 0.18
    }
    if (this.beam) this.beam.visible = false
  }
}

/* ============================================================
   HELPERS
   ============================================================ */

/** How deep a column is solid. Open ground is solid into the terrain. */
function solidFloor(column: Column): number {
  return column.hollow ? column.floorY : -Infinity
}

/**
 * Biome band for a surface block. Height decides it; the chunk's own
 * offset moves the boundaries by up to a metre and a half either way,
 * so bands break on chunk seams instead of drawing contour rings.
 */
function bandFor(height: number, chunkBiome: number): number {
  const level = height + (chunkBiome - 0.5) * 3
  for (let index = 0; index < SUBSTRATE; index++) {
    if (level < BANDS[index].ceiling) return index
  }
  return SUBSTRATE - 1
}
