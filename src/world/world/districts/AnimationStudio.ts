import * as THREE from 'three'
import { palette } from '../../core/palette'
import { easing, type Easing } from '../../core/Tween'
import { clamp, lerp, safeMod, seeded } from '../../core/maths'
import { chamferedBox } from '../geometry'
import { textTexture } from '../materials'
import type { Bin } from '../../core/Disposal'
import type { Game } from '../../Game'
import { districtById } from '@/content/world'

/* ============================================================
   ANIMATION STUDIO — KEYFRAMES

   A set piece, not a mini-game. Nothing here is scored, nothing
   completes, and nothing can be failed. The district is one
   exhibit: a sound stage where every moving thing is driven by a
   single clock, and that clock is a timeline you can drive on.

   The project it stands for is Keyframes — a full-stack platform
   (React and Vite on the front, Express and Prisma on Postgres
   behind it) that catalogues motion work. What the exhibit builds
   is the one idea the product is about — a timeline, a playhead,
   and scenery that obeys them — rather than a screenshot on a
   billboard.

   Three decisions worth naming:

   1. THE PATHS ARE DRAWN. Every animated object shows its own
      motion path as a line with a diamond at each keyframe, so
      the interpolation is visible instead of hidden. What you see
      is what the code evaluates — straight segments between keys,
      with the EASE in the timing rather than in the shape of the
      path. That is why the bouncing ball has a sharp corner at
      the top of each arc: linear spatial interpolation, eased
      time.
   2. NOTHING ANIMATED HAS A COLLIDER. Every moving piece is
      visual only. An animated collider meeting a car at 35 m/s is
      a physics problem this exhibit does not need to have.
      Everything that translates either clears the car's roof or —
      the bouncing ball, the one exception — stays inside the
      footprint of its own plinth. The fixed structure — rig
      columns, cyclorama, test plinth — collides; the performance
      does not.
   3. THE BUTTONS ARE FLAT. PLAY, PAUSE and REVERSE are pads you
      drive over, with no collider of their own. A kerb between
      the car and the control is the one thing that would stop
      someone reaching the control.
   ============================================================ */

type Playback = 'playing' | 'paused' | 'reversed'

/** World seconds for one pass of the timeline. */
const DURATION = 20

/**
 * The stage floor. The district's terrain is exactly level out to
 * `radius * 0.72` (24.5 m here) and blends into the landscape after
 * that, so the plate stops short of the blend and nothing the studio
 * builds reaches past it onto the slope.
 */
const FLOOR_RADIUS = 23.5

/** Half the length of the physical timeline bar, in metres. */
const BAR_HALF = 16
const BAR_Z = 10

const BUTTON_Z = 15.5
const BUTTON_SPACING = 9
const PAD_RADIUS = 3
/** Gameplay radius. Never scaled by quality. */
const TRIGGER_RADIUS = 3.6

/** How close the playhead must be, in normalised time, to flash a key. */
const KEY_FLASH = 0.03

/**
 * One keyframe. `ease` is the curve used on the way INTO this key,
 * which is how a key's ease reads in every animation tool worth
 * copying. Rotations are radians; `scale` is uniform.
 */
interface Key {
  t: number
  x: number
  y: number
  z: number
  ry?: number
  rz?: number
  scale?: number
  ease?: Easing
}

interface Animated {
  object: THREE.Object3D
  keys: Key[]
}

/** A diamond that flashes as the playhead passes its time. */
interface Marker {
  mesh: THREE.Mesh
  t: number
  base: number
}

interface Button {
  mode: Playback
  group: THREE.Group
  glyph: THREE.Mesh
  ring: THREE.Mesh
  restY: number
}

/* ---- the performances ------------------------------------
   Local coordinates, metres, relative to the district centre.
   Every list closes on its opening pose so the loop has no seam
   and the wrap needs no special case.
   --------------------------------------------------------- */

const BLOCK_KEYS: Key[] = [
  { t: 0, x: -13, y: 4.2, z: -9, ry: 0, scale: 1 },
  { t: 0.25, x: -4, y: 7.4, z: -3, ry: 1.2, scale: 1.25, ease: easing.power2InOut },
  { t: 0.5, x: 7, y: 4.6, z: 4, ry: 2.4, scale: 1, ease: easing.power2InOut },
  { t: 0.75, x: 13, y: 6.8, z: -6, ry: 3.8, scale: 0.8, ease: easing.power2InOut },
  { t: 1, x: -13, y: 4.2, z: -9, ry: Math.PI * 2, scale: 1, ease: easing.power2InOut },
]

// The oldest exercise in animation, and still the clearest test of
// an easing curve: fast through the contact, slow at the apex.
const BALL_KEYS: Key[] = [
  { t: 0, x: -19, y: 2, z: 4 },
  { t: 0.125, x: -17.4, y: 5.2, z: 4, ease: easing.power2Out },
  { t: 0.25, x: -15.9, y: 2, z: 4, ease: easing.power2In },
  { t: 0.375, x: -14.6, y: 4, z: 4, ease: easing.power2Out },
  { t: 0.5, x: -13.4, y: 2, z: 4, ease: easing.power2In },
  { t: 0.625, x: -14.6, y: 4, z: 4, ease: easing.power2Out },
  { t: 0.75, x: -15.9, y: 2, z: 4, ease: easing.power2In },
  { t: 0.875, x: -17.4, y: 5.2, z: 4, ease: easing.power2Out },
  { t: 1, x: -19, y: 2, z: 4, ease: easing.power2In },
]

const FRAME_KEYS: Key[] = [
  { t: 0, x: 16.5, y: 5.5, z: -11, scale: 1 },
  { t: 0.5, x: 16.5, y: 5.5, z: 11, scale: 1.15, ease: easing.power4InOut },
  { t: 1, x: 16.5, y: 5.5, z: -11, scale: 1, ease: easing.power4InOut },
]

/** Yaw that points an object's +Z at the centre of the floor. */
const facingCentre = (x: number, z: number) => Math.atan2(-x, -z)

const JIB_KEYS: Key[] = [
  { t: 0, x: -11, y: 5, z: -14, ry: facingCentre(-11, -14) },
  { t: 0.3, x: 0, y: 6.4, z: -17, ry: facingCentre(0, -17), ease: easing.power2InOut },
  { t: 0.6, x: 11, y: 5, z: -14, ry: facingCentre(11, -14), ease: easing.power2InOut },
  { t: 0.8, x: 13, y: 6, z: -6, ry: facingCentre(13, -6), ease: easing.power2InOut },
  { t: 1, x: -11, y: 5, z: -14, ry: facingCentre(-11, -14), ease: easing.power2InOut },
]

/**
 * Rotation-only keys for a moving head, hung under a rig beam. The
 * tilt is always the same way in the head's own frame; it is the pan
 * that swings, which is what carries the beam across the floor.
 */
function panKeys(x: number, z: number, phase: number): Key[] {
  const y = 8.3
  return [
    { t: 0, x, y, z, ry: phase * 1.1, rz: 0.62 },
    { t: 0.25, x, y, z, ry: phase * -0.8, rz: 0.3, ease: easing.power2InOut },
    { t: 0.5, x, y, z, ry: phase * 0.4, rz: 0.7, ease: easing.power2InOut },
    { t: 0.75, x, y, z, ry: phase * -1.3, rz: 0.34, ease: easing.power2InOut },
    { t: 1, x, y, z, ry: phase * 1.1, rz: 0.62, ease: easing.power2InOut },
  ]
}

export class AnimationStudio {
  private group = new THREE.Group()
  private origin = new THREE.Vector3()

  /**
   * Per instance, not per module: leaving /world and coming back
   * builds a second studio, and a module-level generator would
   * carry its cursor across and hang the rig differently the
   * second time.
   */
  private readonly rand = seeded(70214)

  /** Normalised position on the timeline, 0..1. */
  private time = 0
  private playback: Playback = 'playing'

  private animated: Animated[] = []
  private markers: Marker[] = []
  private buttons: Button[] = []

  /** Every distinct keyframe time in the installation, normalised. */
  private keyTimes = new Set<number>()

  private playhead = new THREE.Group()
  private diamondGeometry!: THREE.BufferGeometry
  private activeMaterial!: THREE.Material
  private idleMaterial!: THREE.Material

  constructor(private game: Game, private bin: Bin) {}

  /* ========================================================
     BUILD
     ======================================================== */

  build(): void {
    const district = districtById.studio
    const groundY = this.game.world.terrain.colliderHeightAt(district.x, district.z)
    this.origin.set(district.x, groundY, district.z)
    this.group.position.copy(this.origin)

    // Shared across every keyframe marker in the district: one
    // geometry, one material, forty-odd meshes.
    this.diamondGeometry = new THREE.OctahedronGeometry(0.34)
    this.bin.add(() => this.diamondGeometry.dispose())

    this.activeMaterial = this.game.materials.get('emissiveAccent')
    this.idleMaterial = this.game.materials.flat(palette.ink4)

    this.buildFloor()
    this.buildCyclorama()
    this.buildRig()
    this.buildTestStage()
    this.buildPerformers()
    this.buildTimeline()
    this.buildButtons()

    this.game.renderer.scene.add(this.group)
    this.bin.object3D(this.group)

    const tick = () => this.tick()
    // Order 12: after the physics-facing systems, alongside the
    // world's other purely visual animation.
    this.game.ticker.events.on('tick', tick, 12)
    this.bin.add(() => this.game.ticker.events.off('tick', tick))

    this.setPlayback('playing', false)
    this.apply()
  }

  /* ---- the floor plate ----------------------------------- */

  private buildFloor(): void {
    // Flat and colliderless: the ground inside a district is already
    // level, so a raised stage would only add a lip to catch wheels.
    // A disc rather than a rectangle because the terrain is dead flat
    // out to 0.72 of the district radius and starts blending after
    // that — a square's corners would reach the slope and the plate
    // would sink into it.
    const geometry = new THREE.CircleGeometry(FLOOR_RADIUS, 72)
    geometry.rotateX(-Math.PI / 2)
    const plate = new THREE.Mesh(geometry, this.game.materials.tinted(palette.paper2, 0.95, 0))
    // Under the landmark's own interaction ring at 0.06, which the
    // visitor needs to see more than they need to see the floor.
    plate.position.y = 0.045
    plate.receiveShadow = this.game.quality.settings.shadows
    plate.renderOrder = 1
    this.group.add(plate)
    this.bin.add(() => geometry.dispose())

    const rimGeometry = new THREE.RingGeometry(FLOOR_RADIUS - 0.5, FLOOR_RADIUS, 72)
    rimGeometry.rotateX(-Math.PI / 2)
    const rim = new THREE.Mesh(rimGeometry, this.game.materials.flat(palette.ink4, 0.5))
    rim.position.y = 0.09
    rim.renderOrder = 2
    this.group.add(rim)
    this.bin.add(() => rimGeometry.dispose())

    // A survey grid, the way a stage floor is marked out. Each line is
    // cut to the chord of the disc it crosses.
    const lines = this.game.quality.count(16, 6)
    const inner = FLOOR_RADIUS - 0.8
    const points: number[] = []
    for (let i = 1; i < lines; i++) {
      const offset = lerp(-inner, inner, i / lines)
      const half = Math.sqrt(Math.max(0, inner * inner - offset * offset))
      points.push(offset, 0, -half, offset, 0, half)
      points.push(-half, 0, offset, half, 0, offset)
    }
    const gridGeometry = new THREE.BufferGeometry()
    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
    const grid = new THREE.LineSegments(gridGeometry, this.game.materials.get('lineChalk'))
    grid.position.y = 0.12
    grid.renderOrder = 2
    this.group.add(grid)
    this.bin.add(() => gridGeometry.dispose())
  }

  /* ---- the cyclorama ------------------------------------- */

  private buildCyclorama(): void {
    // Three panels rather than one wall, angled to wrap the east
    // side. Each is its own box collider, so the shape the car
    // meets is the shape it can see.
    const height = 8.6
    const y = 4.1
    this.solid(16, height, 0.6, [21, y, 0], this.game.materials.get('chalk'), {
      rotation: Math.PI / 2,
    })
    this.solid(10, height, 0.6, [18.96, y, -12.56], this.game.materials.get('chalk'), {
      rotation: Math.PI / 2 + 0.42,
    })
    this.solid(10, height, 0.6, [18.96, y, 12.56], this.game.materials.get('chalk'), {
      rotation: Math.PI / 2 - 0.42,
    })

    // Kept to two short lines rather than read from the project's
    // full `technologies` list in `src/content`: ten comma-separated
    // names on a wall you pass at speed is not readable, and the
    // sign has to survive that list growing.
    const { texture, aspect } = textTexture({
      text: 'KEYFRAMES',
      sublines: [
        'FULL-STACK ANIMATION PLATFORM',
        'REACT · VITE · EXPRESS · PRISMA · POSTGRESQL · TYPESCRIPT',
      ],
      color: palette.ink2,
      letterSpacing: 0.14,
      size: 96,
    })
    const geometry = new THREE.PlaneGeometry(3 * aspect, 3)
    const material = this.game.materials.own(
      new THREE.MeshBasicMaterial({
        map: texture, transparent: true, depthWrite: false, toneMapped: false,
      }),
    )
    const sign = new THREE.Mesh(geometry, material)
    sign.position.set(20.6, 4.8, 0)
    sign.rotation.y = -Math.PI / 2
    this.group.add(sign)
    this.bin.add(() => {
      geometry.dispose()
      texture.dispose()
    })
  }

  /* ---- the lighting rig ---------------------------------- */

  private buildRig(): void {
    const columnHeight = 9
    const beamY = 8.8

    for (const x of [-15, 15]) {
      for (const z of [-15, 15]) {
        this.solid(0.9, columnHeight, 0.9, [x, columnHeight / 2 - 0.1, z],
          this.game.materials.get('metal'), { chamfer: 0.1 })
      }
    }

    // Beams sit nine metres up, where nothing the player controls can
    // reach them, so they carry no collider.
    const beam = (width: number, depth: number, x: number, z: number) => {
      const geometry = new THREE.BoxGeometry(width, 0.5, depth)
      const mesh = new THREE.Mesh(geometry, this.game.materials.get('graphite'))
      mesh.position.set(x, beamY, z)
      mesh.castShadow = this.game.quality.settings.shadows
      this.group.add(mesh)
      this.bin.add(() => geometry.dispose())
    }
    beam(30.9, 0.5, 0, -15)
    beam(30.9, 0.5, 0, 15)
    beam(0.5, 30.9, -15, 0)
    beam(0.5, 30.9, 15, 0)
    beam(30.9, 0.4, 0, -6)
    beam(30.9, 0.4, 0, 6)

    this.buildLamps(beamY)
    this.buildPanLights()
  }

  /** Dead lamps: decoration, so their count follows quality. */
  private buildLamps(beamY: number): void {
    const count = this.game.quality.count(10, 4)
    const bodyGeometry = new THREE.CylinderGeometry(0.32, 0.55, 0.9, 8)
    const lensGeometry = new THREE.CircleGeometry(0.5, 8)
    lensGeometry.rotateX(Math.PI / 2)
    const rodGeometry = new THREE.BoxGeometry(0.09, 0.7, 0.09)
    this.bin.add(() => {
      bodyGeometry.dispose()
      lensGeometry.dispose()
      rodGeometry.dispose()
    })

    for (let i = 0; i < count; i++) {
      const x = lerp(-13, 13, (i + 0.5) / count)
      const z = i % 2 === 0 ? -6 : 6
      const lamp = new THREE.Group()
      lamp.position.set(x, beamY - 0.85, z)
      // A rig nobody has straightened. Seeded, so it is the same
      // crooked lamp on every reload. Two draws per lamp in a fixed
      // order, so a lamp's tilt does not change when quality changes
      // the count around it.
      lamp.rotation.z = (this.rand() - 0.5) * 0.5
      lamp.rotation.x = (this.rand() - 0.5) * 0.4
      this.group.add(lamp)

      const rod = new THREE.Mesh(rodGeometry, this.game.materials.get('metal'))
      rod.position.y = 0.75
      lamp.add(rod)

      const body = new THREE.Mesh(bodyGeometry, this.game.materials.get('graphite'))
      lamp.add(body)

      const lens = new THREE.Mesh(lensGeometry, this.game.materials.get('emissiveAmber'))
      lens.position.y = -0.46
      lamp.add(lens)
    }
  }

  /** Two heads that pan and tilt on the timeline, with visible beams. */
  private buildPanLights(): void {
    const beamMaterial = this.game.materials.own(
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(palette.sunDay),
        transparent: true,
        opacity: 0.14,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      }),
    )

    // Hung from the two perimeter beams, clear of the dead lamps on
    // the cross beams — whose count changes with quality, so a head
    // sharing a beam with them would intersect one at some settings
    // and not at others.
    const mounts: [number, number][] = [[-8, -15], [8, 15]]

    for (const [index, mount] of mounts.entries()) {
      const head = new THREE.Group()

      const yokeGeometry = new THREE.BoxGeometry(0.9, 0.24, 1.5)
      const yoke = new THREE.Mesh(yokeGeometry, this.game.materials.get('metal'))
      yoke.position.y = 0.5
      head.add(yoke)
      this.bin.add(() => yokeGeometry.dispose())

      const bodyGeometry = new THREE.CylinderGeometry(0.42, 0.72, 1.2, 10)
      const body = new THREE.Mesh(bodyGeometry, this.game.materials.get('graphite'))
      head.add(body)
      this.bin.add(() => bodyGeometry.dispose())

      const lensGeometry = new THREE.CircleGeometry(0.66, 10)
      lensGeometry.rotateX(Math.PI / 2)
      const lens = new THREE.Mesh(lensGeometry, this.game.materials.get('emissiveWhite'))
      lens.position.y = -0.61
      head.add(lens)
      this.bin.add(() => lensGeometry.dispose())

      // An open cone standing in for a beam, long enough to pass
      // through the floor: the plate then clips it, so the light
      // appears to land rather than to stop in mid-air.
      const coneGeometry = new THREE.ConeGeometry(2.1, 11, 14, 1, true)
      coneGeometry.translate(0, -5.5, 0)
      const cone = new THREE.Mesh(coneGeometry, beamMaterial)
      cone.renderOrder = 5
      head.add(cone)
      this.bin.add(() => coneGeometry.dispose())

      this.addAnimated(head, panKeys(mount[0], mount[1], index === 0 ? 1 : -1))
    }
  }

  /* ---- the easing test stage ----------------------------- */

  private buildTestStage(): void {
    this.solid(8, 1.3, 8, [-16, 0.65, 4], this.game.materials.get('concrete'), { chamfer: 0.12 })
    this.groundLabel('EASE IN · EASE OUT', 0.44, [-16, 1.33, 7.2], palette.ink3, { opacity: 0.8 })
  }

  /* ---- the performers ------------------------------------ */

  private buildPerformers(): void {
    const shadows = this.game.quality.settings.shadows

    /* A render block, tumbling around the rig. */
    const blockGeometry = chamferedBox(2.4, 2.4, 2.4, 0.14)
    const block = new THREE.Mesh(blockGeometry, this.game.materials.get('accent'))
    block.castShadow = shadows
    this.bin.add(() => blockGeometry.dispose())
    this.addAnimated(block, BLOCK_KEYS, 'lineAccent')

    /* The bouncing ball, over its own plinth. */
    const ballGeometry = new THREE.SphereGeometry(0.7, 16, 12)
    const ball = new THREE.Mesh(ballGeometry, this.game.materials.get('chalk'))
    ball.castShadow = shadows
    this.bin.add(() => ballGeometry.dispose())
    this.addAnimated(ball, BALL_KEYS, 'lineInk')

    /* A framed shot, tracking along the cyclorama. */
    const frame = new THREE.Group()
    const frameGeometry = chamferedBox(0.18, 2.8, 4.6, 0.06)
    const frameBody = new THREE.Mesh(frameGeometry, this.game.materials.get('accentDeep'))
    frameBody.castShadow = shadows
    frame.add(frameBody)
    this.bin.add(() => frameGeometry.dispose())

    const fillGeometry = new THREE.PlaneGeometry(4, 2.2)
    const fill = new THREE.Mesh(fillGeometry, this.game.materials.flat(palette.paper))
    fill.position.x = -0.1
    fill.rotation.y = -Math.PI / 2
    frame.add(fill)
    this.bin.add(() => fillGeometry.dispose())
    this.addAnimated(frame, FRAME_KEYS, 'lineAccent')

    /* A camera on a jib, keeping the floor in shot. */
    const jib = new THREE.Group()
    const bodyGeometry = chamferedBox(1.3, 0.9, 1.5, 0.08)
    const body = new THREE.Mesh(bodyGeometry, this.game.materials.get('graphite'))
    body.castShadow = shadows
    jib.add(body)
    this.bin.add(() => bodyGeometry.dispose())

    const lensGeometry = new THREE.CylinderGeometry(0.3, 0.36, 0.9, 10)
    lensGeometry.rotateX(Math.PI / 2)
    const lens = new THREE.Mesh(lensGeometry, this.game.materials.get('ink'))
    lens.position.z = 1
    jib.add(lens)
    this.bin.add(() => lensGeometry.dispose())

    const glassGeometry = new THREE.CircleGeometry(0.28, 10)
    const glass = new THREE.Mesh(glassGeometry, this.game.materials.get('emissiveSignal'))
    glass.position.z = 1.46
    jib.add(glass)
    this.bin.add(() => glassGeometry.dispose())

    this.addAnimated(jib, JIB_KEYS, 'lineChalk')
  }

  /* ---- the timeline -------------------------------------- */

  private buildTimeline(): void {
    // The bar stands a hand's width proud of the floor and has no
    // collider: it should look like a kerb and drive like paint. A
    // real lip here sits between the visitor and the transport
    // controls, which is the one place it must not be.
    const barGeometry = chamferedBox(BAR_HALF * 2, 0.22, 1.9, 0.07)
    const bar = new THREE.Mesh(barGeometry, this.game.materials.get('concreteDark'))
    bar.position.set(0, 0.15, BAR_Z)
    bar.receiveShadow = this.game.quality.settings.shadows
    this.group.add(bar)
    this.bin.add(() => barGeometry.dispose())

    const grooveGeometry = new THREE.PlaneGeometry(BAR_HALF * 2 - 0.6, 0.16)
    grooveGeometry.rotateX(-Math.PI / 2)
    const groove = new THREE.Mesh(grooveGeometry, this.game.materials.flat(palette.ink3))
    groove.position.set(0, 0.27, BAR_Z)
    this.group.add(groove)
    this.bin.add(() => grooveGeometry.dispose())

    // Frame ticks between the keys. Decoration, so quality scales it.
    const ticks = this.game.quality.count(64, 20)
    const points: number[] = []
    for (let i = 0; i <= ticks; i++) {
      const x = lerp(-BAR_HALF + 0.4, BAR_HALF - 0.4, i / ticks)
      points.push(x, 0, BAR_Z - 0.62, x, 0, BAR_Z - 0.36)
    }
    const tickGeometry = new THREE.BufferGeometry()
    tickGeometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
    const tickLines = new THREE.LineSegments(tickGeometry, this.game.materials.get('lineInk'))
    tickLines.position.y = 0.27
    this.group.add(tickLines)
    this.bin.add(() => tickGeometry.dispose())

    // One diamond per distinct keyframe time in the whole district.
    // The bar is not a decoration of the animation; it is its index.
    for (const t of [...this.keyTimes].sort((a, b) => a - b)) {
      this.addMarker(this.barX(t), 0.58, BAR_Z, t, 0.9)
    }

    this.buildPlayhead()

    this.groundLabel('TIMELINE', 0.5, [0, 0.14, BAR_Z - 2.4], palette.ink3, { opacity: 0.75 })
  }

  private buildPlayhead(): void {
    const finGeometry = chamferedBox(0.16, 2.6, 0.6, 0.05)
    const fin = new THREE.Mesh(finGeometry, this.game.materials.get('emissiveAccent'))
    fin.position.y = 1.6
    this.playhead.add(fin)
    this.bin.add(() => finGeometry.dispose())

    const shoeGeometry = chamferedBox(0.9, 0.3, 2.6, 0.06)
    const shoe = new THREE.Mesh(shoeGeometry, this.game.materials.get('accentDeep'))
    shoe.position.y = 0.2
    this.playhead.add(shoe)
    this.bin.add(() => shoeGeometry.dispose())

    this.playhead.position.z = BAR_Z
    this.group.add(this.playhead)
  }

  /* ---- the transport ------------------------------------- */

  private buildButtons(): void {
    // Left to right: REVERSE, PAUSE, PLAY, so the two arrows point
    // outward from the pause in the middle — the transport layout
    // the visitor already knows.
    const specs: { mode: Playback; label: string; x: number }[] = [
      { mode: 'reversed', label: 'REVERSE', x: -BUTTON_SPACING },
      { mode: 'paused', label: 'PAUSE', x: 0 },
      { mode: 'playing', label: 'PLAY', x: BUTTON_SPACING },
    ]

    const padGeometry = new THREE.CylinderGeometry(PAD_RADIUS, PAD_RADIUS - 0.25, 0.3, 28)
    const ringGeometry = new THREE.RingGeometry(PAD_RADIUS - 0.42, PAD_RADIUS - 0.18, 40)
    ringGeometry.rotateX(-Math.PI / 2)
    this.bin.add(() => {
      padGeometry.dispose()
      ringGeometry.dispose()
    })

    for (const spec of specs) {
      const group = new THREE.Group()
      const restY = 0.15
      group.position.set(spec.x, restY, BUTTON_Z)
      this.group.add(group)

      const pad = new THREE.Mesh(padGeometry, this.game.materials.get('chalk'))
      pad.receiveShadow = this.game.quality.settings.shadows
      group.add(pad)

      const ring = new THREE.Mesh(ringGeometry, this.idleMaterial)
      ring.position.y = 0.16
      ring.renderOrder = 3
      group.add(ring)

      const glyph = new THREE.Mesh(this.glyphGeometry(spec.mode), this.idleMaterial)
      glyph.position.set(0, 0.17, 0.9)
      glyph.renderOrder = 4
      group.add(glyph)

      // The word rides on the pad rather than the ground beside it, so
      // the whole control — rim, mark and name — takes the press as
      // one object.
      this.groundLabel(spec.label, 0.6, [0, 0.17, -1.2], palette.ink2, {
        opacity: 0.95,
        parent: group,
      })

      this.buttons.push({ mode: spec.mode, group, glyph, ring, restY })

      // The trigger is a zone rather than a sensor collider: it fires
      // on where the car actually is, not on where a bumper corner
      // clipped, which is the difference between a button that
      // responds and one that flickers.
      const zone = this.game.zones.create<Playback>(
        `studio-transport-${spec.mode}`,
        'cylinder',
        new THREE.Vector3(this.origin.x + spec.x, this.origin.y, this.origin.z + BUTTON_Z),
        TRIGGER_RADIUS,
        spec.mode,
      )
      zone.events.on('enter', () => this.setPlayback(spec.mode, true))
      this.bin.add(() => this.game.zones.remove(zone))
    }
  }

  /** Flat play/pause/reverse marks, lying on the pad. */
  private glyphGeometry(mode: Playback): THREE.BufferGeometry {
    let geometry: THREE.BufferGeometry
    if (mode === 'paused') {
      const left = new THREE.PlaneGeometry(0.36, 1.5)
      left.rotateX(-Math.PI / 2)
      left.translate(-0.34, 0, 0)
      const right = new THREE.PlaneGeometry(0.36, 1.5)
      right.rotateX(-Math.PI / 2)
      right.translate(0.34, 0, 0)
      // Two quads as one geometry, so a pause button is one draw call.
      const positions = [
        ...Array.from(left.getAttribute('position').array as ArrayLike<number>),
        ...Array.from(right.getAttribute('position').array as ArrayLike<number>),
      ]
      const leftIndex = Array.from(left.getIndex()?.array ?? [])
      const offset = left.getAttribute('position').count
      const merged = new THREE.BufferGeometry()
      merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      merged.setIndex([...leftIndex, ...leftIndex.map((i) => i + offset)])
      left.dispose()
      right.dispose()
      geometry = merged
    } else {
      geometry = new THREE.CircleGeometry(0.95, 3)
      geometry.rotateX(-Math.PI / 2)
      // A triangle from `CircleGeometry` points at +X; reverse points back.
      if (mode === 'reversed') geometry.rotateY(Math.PI)
    }
    this.bin.add(() => geometry.dispose())
    return geometry
  }

  /* ========================================================
     HELPERS
     ======================================================== */

  /** A drawn box that also collides, in the group's local space. */
  private solid(
    width: number,
    height: number,
    depth: number,
    position: [number, number, number],
    material: THREE.Material,
    options: { rotation?: number; chamfer?: number } = {},
  ): THREE.Mesh {
    const geometry = chamferedBox(width, height, depth, options.chamfer ?? 0.08)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(...position)
    if (options.rotation) mesh.rotation.y = options.rotation
    mesh.castShadow = this.game.quality.settings.shadows
    mesh.receiveShadow = this.game.quality.settings.shadows
    this.group.add(mesh)
    this.bin.add(() => geometry.dispose())

    // The group is axis-aligned at the district centre, so local plus
    // origin is world. Colliders carry the mesh's own Y rotation or
    // the angled cyclorama panels would collide as if they were flat.
    this.game.physics.add({
      type: 'fixed',
      category: 'floor',
      position: {
        x: this.origin.x + position[0],
        y: this.origin.y + position[1],
        z: this.origin.z + position[2],
      },
      rotation: new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0, options.rotation ?? 0, 0),
      ),
      friction: 0.7,
      restitution: 0.12,
      colliders: [{ shape: 'cuboid', parameters: [width / 2, height / 2, depth / 2] }],
    })

    return mesh
  }

  private groundLabel(
    text: string,
    height: number,
    position: [number, number, number],
    color: string,
    options: { opacity?: number; parent?: THREE.Object3D } = {},
  ): void {
    const { texture, aspect } = textTexture({
      text, color, letterSpacing: 0.22, size: 96, weight: 600,
    })
    const geometry = new THREE.PlaneGeometry(height * aspect, height)
    // Flat, with the top of the letters toward the north — the way up
    // for anyone driving in off the client road.
    geometry.rotateX(-Math.PI / 2)
    const material = this.game.materials.own(
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: options.opacity ?? 0.85,
        depthWrite: false,
        toneMapped: false,
      }),
    )
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(...position)
    mesh.renderOrder = 3
    ;(options.parent ?? this.group).add(mesh)
    this.bin.add(() => {
      geometry.dispose()
      texture.dispose()
    })
  }

  /**
   * Registers an object as driven by the timeline, and — when a line
   * material is named — draws its path with a diamond on every key.
   */
  private addAnimated(
    object: THREE.Object3D,
    keys: Key[],
    path: 'lineAccent' | 'lineInk' | 'lineChalk' | null = null,
  ): void {
    this.group.add(object)
    this.animated.push({ object, keys })

    // The closing key repeats the opening pose, so it is a duplicate
    // on the master timeline and would draw a second diamond on top
    // of the first.
    for (const key of keys) if (key.t < 1) this.keyTimes.add(key.t)

    if (!path) return

    const points: number[] = []
    for (const key of keys) points.push(key.x, key.y, key.z)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
    const line = new THREE.Line(geometry, this.game.materials.get(path))
    this.group.add(line)
    this.bin.add(() => geometry.dispose())

    for (const key of keys) {
      if (key.t >= 1) continue
      this.addMarker(key.x, key.y, key.z, key.t, 1)
    }
  }

  private addMarker(x: number, y: number, z: number, t: number, base: number): void {
    const mesh = new THREE.Mesh(this.diamondGeometry, this.activeMaterial)
    mesh.position.set(x, y, z)
    mesh.scale.setScalar(base)
    this.group.add(mesh)
    this.markers.push({ mesh, t, base })
  }

  /** Where a normalised time sits along the physical bar. */
  private barX(t: number): number {
    return lerp(-BAR_HALF + 0.6, BAR_HALF - 0.6, t)
  }

  /* ========================================================
     PLAYBACK
     ======================================================== */

  /**
   * One state, every object. There is no per-object playback and no
   * way to desynchronise them.
   */
  private setPlayback(mode: Playback, feedback: boolean): void {
    const changed = this.playback !== mode
    this.playback = mode

    for (const button of this.buttons) {
      const active = button.mode === mode
      button.glyph.material = active ? this.activeMaterial : this.idleMaterial
      button.ring.material = active ? this.activeMaterial : this.idleMaterial
    }

    if (!feedback) return

    this.game.audio?.blip(mode === 'playing' ? 1.5 : mode === 'paused' ? 0.85 : 1.12)
    if (!changed) return

    const button = this.buttons.find((item) => item.mode === mode)
    if (!button) return

    // The pad takes the press, so the control has some weight even
    // though nothing about it is a rigid body.
    this.game.tweens.to(button.group.position, { y: button.restY - 0.16 }, {
      duration: 0.08,
      ease: easing.power2Out,
      overwrite: true,
      onComplete: () => {
        this.game.tweens.to(button.group.position, { y: button.restY }, {
          duration: 0.45,
          ease: easing.backOut,
        })
      },
    })
  }

  /**
   * Back to the opening frame, playing. The district locks nothing —
   * no player state, no cinematic, no input filter, no disabled
   * collider — so there is nothing else here to give back.
   */
  reset(): void {
    this.time = 0
    this.setPlayback('playing', false)

    // A reset can land between the press tween and the release tween
    // it schedules. Killing the tween drops the pending release with
    // it, so the pad is put back by hand rather than left sunk.
    for (const button of this.buttons) {
      this.game.tweens.killOf(button.group.position)
      button.group.position.y = button.restY
    }

    this.apply()
  }

  /* ========================================================
     TICK
     ======================================================== */

  private tick(): void {
    const direction = this.playback === 'playing' ? 1 : this.playback === 'reversed' ? -1 : 0

    if (direction !== 0) {
      // World time, so the timeline slows with bullet time along with
      // everything else the visitor can see.
      const delta = this.game.ticker.delta * this.game.ticker.scale
      this.time = safeMod(this.time + (direction * delta) / DURATION, 1)
    }

    this.apply()
  }

  /** Writes the current frame onto every object the timeline owns. */
  private apply(): void {
    for (const item of this.animated) this.pose(item)

    this.playhead.position.x = this.barX(this.time)

    const spin = this.game.ticker.elapsedScaled * 0.6
    for (const marker of this.markers) {
      // Distance in wrapped normalised time — a key at 0.99 is close
      // to a playhead at 0.01, not a whole loop away from it.
      const raw = Math.abs(this.time - marker.t)
      const distance = Math.min(raw, 1 - raw)
      const flash = Math.max(0, 1 - distance / KEY_FLASH)
      marker.mesh.scale.setScalar(marker.base * (1 + flash * 0.85))
      marker.mesh.rotation.y = spin
    }
  }

  private pose(item: Animated): void {
    const keys = item.keys

    // Linear scan over at most nine keys. A binary search would cost
    // more to read than it saves to run.
    let i = 0
    while (i < keys.length - 2 && this.time >= keys[i + 1].t) i++

    const from = keys[i]
    const to = keys[i + 1]
    const span = to.t - from.t
    const raw = span > 0 ? clamp((this.time - from.t) / span, 0, 1) : 1
    const eased = (to.ease ?? easing.power2InOut)(raw)

    item.object.position.set(
      lerp(from.x, to.x, eased),
      lerp(from.y, to.y, eased),
      lerp(from.z, to.z, eased),
    )
    item.object.rotation.set(
      0,
      lerp(from.ry ?? 0, to.ry ?? 0, eased),
      lerp(from.rz ?? 0, to.rz ?? 0, eased),
    )
    const scale = lerp(from.scale ?? 1, to.scale ?? 1, eased)
    if (scale !== 1 || item.object.scale.x !== 1) item.object.scale.setScalar(scale)
  }
}
