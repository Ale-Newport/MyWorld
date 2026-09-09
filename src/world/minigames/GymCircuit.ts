import * as THREE from 'three'
import { Minigame } from './Minigame'
import { palette } from '../core/palette'
import { clamp, dist2, formatTime, seeded, smallestAngle } from '../core/maths'
import { chamferedBox } from '../world/geometry'
import { textTexture } from '../world/materials'
import type { Bin } from '../core/Disposal'
import type { Game } from '../Game'
import type { Physical } from '../physics/Physics'
import type { MinigameId } from '@/content/world'
import { districtById, landmarkById } from '@/content/world'

/* ============================================================
   GYM CIRCUIT

   The Gym App is one rigged athlete, a table of pose data and a
   list of equipment; every exercise in it is those three things
   recombined. A district that showed four separate animated
   figures would be showing the opposite of what the app does, so
   this builds the architecture instead of illustrating it:

     ONE ATHLETE, on a podium near the centre. A hierarchy of
     capsules and boxes, 1.85 m tall, no physics — a rig, not a
     ragdoll.

     FOUR STATIONS, on a ring nineteen metres out. Bench and bar,
     cable tower, squat rack, mat. These are real static geometry
     with real colliders; you can drive into them and stop.

     THE JOIN. Drive within fifteen metres of a station and the
     athlete performs that station's movement — press, row,
     squat, crunch — from the same rig, driven by sine motion on
     the joints. The plaque on the podium names the movement. The
     model never changes; only the numbers do.

   The mini-game on top is deliberately thin: touch all four
   stations in any order, against the clock. There is no route to
   memorise and no order to get wrong, because the point being
   made is about the athlete, not about the driving.

   Three notes on how it is wired:

   1. THE ATHLETE ANIMATES WHEN THE GAME IS NOT RUNNING. The
      mini-game manager only ticks the ACTIVE game, so an idle
      mini-game gets no frames. The rig therefore subscribes to
      the ticker itself, at order 12, and `tick()` is left with
      nothing but scoring.
   2. NOTHING IS LOCKED. No camera take-over, no player state, no
      input filters, no swapped colliders. `reset()` puts the
      lamps back and the loose plates back, and that is the whole
      of it — there is no state a cancel could strand.
   3. POSES ARE DAMPED, NOT CROSS-FADED. Every joint eases toward
      the target angle the active exercise asks for, so switching
      stations mid-rep is a transition rather than a cut, and one
      blend constant replaces four hand-authored ones.
   ============================================================ */

/** Distance from the district centre to each station. */
const RING = 20
/** How close the car must get for a station to count. */
const STATION_RADIUS = 7
/** How far the car must get back out before a station can count. */
const ARM_RADIUS = 11
/** How close the car must get for the athlete to demonstrate. */
const POSE_RADIUS = 15

/** Real seconds to take all four stations. */
const TIME_LIMIT = 60
/** Seconds of 3-2-1 at the gate. */
const LEAD_IN = 3

/** Hip height of the standing rig, and the length of each bone. */
const HIP_Y = 0.86
const THIGH = 0.42
const SHIN = 0.44
const UPPER_ARM = 0.3
const FOREARM = 0.28

const YAXIS = new THREE.Vector3(0, 1, 0)

type ExerciseId = 'push' | 'pull' | 'legs' | 'core'
type PlaqueKey = ExerciseId | 'idle'

interface StationSpec {
  id: ExerciseId
  label: string
  sublabel: string
  /** Where on the ring it stands: degrees clockwise from north. */
  bearing: number
  /** What the podium plaque reads while this one is being shown. */
  movement: string
}

/* The ring is rotated off the compass points on purpose. Due
   south is the approach gate and the north-east sector carries
   the road spur in from the hub; both want to stay clear. */
const STATIONS: StationSpec[] = [
  { id: 'push', label: 'PUSH', sublabel: 'BENCH & BAR', bearing: 57, movement: 'PRESS' },
  { id: 'pull', label: 'PULL', sublabel: 'CABLE TOWER', bearing: 147, movement: 'ROW' },
  { id: 'legs', label: 'LEGS', sublabel: 'SQUAT RACK', bearing: 237, movement: 'SQUAT' },
  { id: 'core', label: 'CORE', sublabel: 'MAT', bearing: 327, movement: 'CRUNCH' },
]

interface Station {
  spec: StationSpec
  /** World position at ground level. */
  position: THREE.Vector3
  done: boolean
  /**
   * False while the car is still inside this station's pad. The gate
   * landmark used to stand 9.96 m from PULL against a 7 m scoring
   * radius, so the first station of a run was very nearly free; now a
   * station only counts once the car has been out past ARM_RADIUS.
   */
  armed: boolean
  lampPending: THREE.Mesh
  lampDone: THREE.Mesh
}

/** Where a station stands and which way it looks. Local +Z faces the centre. */
interface Frame {
  at: THREE.Vector3
  rotation: number
}

/** The joints the pose data writes to. Left is index 0. */
interface Rig {
  root: THREE.Group
  pelvis: THREE.Group
  spine: THREE.Group
  head: THREE.Object3D
  shoulders: THREE.Group[]
  elbows: THREE.Group[]
  hips: THREE.Group[]
  knees: THREE.Group[]
}

/**
 * One frame of the athlete. Angles are radians in the joint's own
 * frame, with the figure facing local +Z: a negative shoulder or
 * hip pitch swings the limb forwards, a positive knee bends the
 * shin back, and `pelvisY` is an offset from standing height.
 */
interface Pose {
  pelvisY: number
  spinePitch: number
  headPitch: number
  shoulderPitch: [number, number]
  shoulderRoll: [number, number]
  elbow: [number, number]
  hipPitch: [number, number]
  knee: [number, number]
}

export class GymCircuit extends Minigame {
  readonly id: MinigameId = 'gymCircuit'
  readonly title = 'GYM CIRCUIT'

  private group = new THREE.Group()
  private stations: Station[] = []

  /** Loose weight plates. The only dynamic bodies this district adds. */
  private plates: { physical: Physical; mesh: THREE.Mesh }[] = []

  private rig!: Rig
  private plaque!: THREE.Mesh
  private plaqueSkins = new Map<PlaqueKey, { material: THREE.Material; aspect: number }>()
  private plaqueKey: PlaqueKey = 'idle'

  private pose: Pose = blankPose()
  private wanted: Pose = blankPose()

  private facing = 0
  private restFacing = 0

  constructor(game: Game, bin: Bin) {
    super(game, bin)
    // The station ring is 40 m across and the run starts at the
    // southern gate, 28 m out from the centre, so 110 m is well
    // clear of any honest lap and still catches somebody who has
    // driven off to the hub.
    this.abandonRadius = 110
    this.leadIn = LEAD_IN
  }

  /* ========================================================
     BUILD
     ======================================================== */

  build(): void {
    const district = districtById.gym
    const centre = new THREE.Vector3(
      district.x,
      this.game.world.terrain.colliderHeightAt(district.x, district.z),
      district.z,
    )

    this.buildTrack(centre)
    for (const spec of STATIONS) this.buildStation(centre, spec)
    this.buildAthlete(centre)

    this.game.renderer.scene.add(this.group)
    this.bin.object3D(this.group)

    // Order 12: after the world facts at 11, before the mini-game
    // manager at 13, so a station scored this frame is already
    // reflected in the pose the same frame.
    const animate = () => this.animate()
    this.game.ticker.events.on('tick', animate, 12)
    this.bin.add(() => this.game.ticker.events.off('tick', animate))
  }

  /** Registers a geometry for disposal and hands it back. */
  private own<T extends THREE.BufferGeometry>(geometry: T): T {
    this.bin.add(() => geometry.dispose())
    return geometry
  }

  /* ---- placing things in a rotated station frame ---------- */

  private toWorld(frame: Frame, x: number, y: number, z: number) {
    const local = new THREE.Vector3(x, y, z).applyAxisAngle(YAXIS, frame.rotation).add(frame.at)
    return { x: local.x, y: local.y, z: local.z }
  }

  private toWorldRotation(frame: Frame, extra = 0): THREE.Quaternion {
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(0, frame.rotation + extra, 0))
  }

  /**
   * A chamfered box that draws in station-local space and, unless
   * told otherwise, collides in world space at the same place. The
   * two must be described from one call or they drift apart the
   * first time a station's bearing changes.
   */
  private addBox(
    frame: Frame,
    parent: THREE.Object3D,
    size: [number, number, number],
    position: [number, number, number],
    material: THREE.Material,
    options: { collide?: boolean; chamfer?: number; rotation?: number } = {},
  ): THREE.Mesh {
    const [width, height, depth] = size
    const geometry = this.own(chamferedBox(width, height, depth, options.chamfer ?? 0.05))
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(...position)
    if (options.rotation) mesh.rotation.y = options.rotation
    mesh.castShadow = this.game.quality.settings.shadows
    mesh.receiveShadow = this.game.quality.settings.shadows
    parent.add(mesh)

    if (options.collide !== false) {
      this.game.physics.add({
        type: 'fixed',
        category: 'floor',
        position: this.toWorld(frame, position[0], position[1], position[2]),
        rotation: this.toWorldRotation(frame, options.rotation ?? 0),
        friction: 0.7,
        restitution: 0.12,
        colliders: [{ shape: 'cuboid', parameters: [width / 2, height / 2, depth / 2] }],
      })
    }
    return mesh
  }

  /** A decorative disc, used for the plates hanging off every bar. */
  private addDisc(
    parent: THREE.Object3D,
    radius: number,
    thickness: number,
    position: [number, number, number],
    material: THREE.Material,
  ): void {
    const geometry = this.own(new THREE.CylinderGeometry(radius, radius, thickness, 12))
    // Bars run along local X, so the plates lie on the X axis too.
    geometry.rotateZ(Math.PI / 2)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(...position)
    mesh.castShadow = this.game.quality.settings.shadows
    parent.add(mesh)
  }

  /* ---- the painted circuit -------------------------------- */

  /**
   * A painted ring joining the four stations. Every vertex samples
   * the terrain rather than trusting the district plate to be
   * level, so the paint cannot sink into a slope at the edge.
   */
  private buildTrack(centre: THREE.Vector3): void {
    const segments = 72
    const inner = RING - 0.9
    const outer = RING + 0.9

    const positions: number[] = []
    const normals: number[] = []
    const indices: number[] = []

    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2
      const sin = Math.sin(angle)
      const cos = Math.cos(angle)
      for (const radius of [inner, outer]) {
        const x = centre.x + sin * radius
        const z = centre.z + cos * radius
        const y = this.game.world.terrain.colliderHeightAt(x, z) + 0.07
        positions.push(x, y, z)
        normals.push(0, 1, 0)
      }
    }

    for (let i = 0; i < segments; i++) {
      const a = i * 2
      const b = a + 1
      const c = ((i + 1) % segments) * 2
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }

    const geometry = this.own(new THREE.BufferGeometry())
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setIndex(indices)

    const mesh = new THREE.Mesh(
      geometry,
      this.game.materials.own(
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(palette.signalSoft),
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          // Double-sided so the paint survives whichever way the ring
          // happens to wind; it is a decal, not a surface.
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      ),
    )
    mesh.renderOrder = 1
    this.group.add(mesh)
  }

  /* ---- stations ------------------------------------------- */

  private buildStation(centre: THREE.Vector3, spec: StationSpec): void {
    const bearing = (spec.bearing * Math.PI) / 180
    const x = centre.x + Math.sin(bearing) * RING
    const z = centre.z - Math.cos(bearing) * RING
    const y = this.game.world.terrain.colliderHeightAt(x, z)

    // Local +Z must point back at the district centre, so the whole
    // station faces the way the car arrives.
    const frame: Frame = { at: new THREE.Vector3(x, y, z), rotation: -bearing }

    const group = new THREE.Group()
    group.position.copy(frame.at)
    group.rotation.y = frame.rotation
    this.group.add(group)

    // The pad is a painted plate, not a kerb: no collider, because a
    // 12 cm lip around every station would jolt the car for nothing.
    this.addBox(frame, group, [6.4, 0.12, 6.4], [0, 0.06, 0], this.game.materials.get('concrete'), {
      collide: false,
      chamfer: 0.04,
    })

    switch (spec.id) {
      case 'push': this.buildBench(frame, group); break
      case 'pull': this.buildTower(frame, group); break
      case 'legs': this.buildRack(frame, group); break
      case 'core': this.buildMat(frame, group); break
    }

    const lamps = this.buildSign(frame, group, spec)
    this.buildLoosePlate(frame)

    this.stations.push({
      spec,
      position: frame.at.clone(),
      done: false,
      armed: false,
      lampPending: lamps.pending,
      lampDone: lamps.done,
    })
  }

  /** PUSH: a flat bench under a racked bar. */
  private buildBench(frame: Frame, group: THREE.Group): void {
    const graphite = this.game.materials.get('graphite')
    const metal = this.game.materials.get('metal')

    this.addBox(frame, group, [0.66, 0.18, 2.0], [0, 0.55, 0], this.game.materials.get('ink'))
    for (const z of [-0.8, 0.8]) {
      this.addBox(frame, group, [0.56, 0.46, 0.16], [0, 0.23, z], graphite)
    }
    for (const x of [-0.62, 0.62]) {
      this.addBox(frame, group, [0.18, 1.5, 0.18], [x, 0.75, -1.15], graphite)
    }
    this.addBox(frame, group, [2.4, 0.1, 0.1], [0, 1.52, -1.15], metal, { chamfer: 0.03 })
    for (const x of [-0.98, 0.98]) {
      this.addDisc(group, 0.34, 0.1, [x, 1.52, -1.15], this.game.materials.get('accent'))
    }
  }

  /** PULL: a cable tower with a stack and a handle at chest height. */
  private buildTower(frame: Frame, group: THREE.Group): void {
    const graphite = this.game.materials.get('graphite')

    this.addBox(frame, group, [1.5, 0.24, 1.7], [0, 0.12, -0.1], graphite, { collide: false })
    this.addBox(frame, group, [0.5, 3.4, 0.5], [0, 1.7, -0.6], graphite)
    this.addBox(frame, group, [0.62, 1.3, 0.44], [0, 0.65, -0.14], this.game.materials.get('ink'))
    this.addBox(frame, group, [0.64, 0.1, 0.46], [0, 1.02, -0.14], this.game.materials.get('accent'), {
      collide: false,
      chamfer: 0.02,
    })
    this.addBox(frame, group, [0.3, 0.22, 1.6], [0, 3.3, 0.3], graphite)

    // Cable and handle are too thin to collide with usefully; a
    // collider there would only catch a wheel on nothing visible.
    this.addBox(frame, group, [0.06, 1.3, 0.06], [0, 2.55, 1.02], this.game.materials.get('ink'), {
      collide: false,
      chamfer: 0.02,
    })
    this.addBox(frame, group, [0.86, 0.1, 0.1], [0, 1.92, 1.02], this.game.materials.get('metal'), {
      collide: false,
      chamfer: 0.03,
    })
  }

  /** LEGS: a squat rack with a loaded bar in the hooks. */
  private buildRack(frame: Frame, group: THREE.Group): void {
    const graphite = this.game.materials.get('graphite')
    const metal = this.game.materials.get('metal')

    for (const x of [-0.9, 0.9]) {
      this.addBox(frame, group, [0.34, 0.16, 1.9], [x, 0.08, 0], graphite, { collide: false })
      this.addBox(frame, group, [0.24, 2.2, 0.24], [x, 1.1, 0], graphite)
      this.addBox(frame, group, [0.34, 0.12, 0.12], [x, 1.5, 0.2], metal, { collide: false, chamfer: 0.03 })
    }
    this.addBox(frame, group, [2.0, 0.16, 0.16], [0, 2.06, -0.08], graphite, { collide: false })
    this.addBox(frame, group, [2.9, 0.1, 0.1], [0, 1.57, 0.24], metal, { chamfer: 0.03 })
    for (const x of [-1.3, 1.3]) {
      this.addDisc(group, 0.44, 0.12, [x, 1.57, 0.24], this.game.materials.get('accent'))
    }
  }

  /** CORE: a mat, a foot anchor and a step to work off. */
  private buildMat(frame: Frame, group: THREE.Group): void {
    const graphite = this.game.materials.get('graphite')

    // The mat does not collide either, for the same reason the pad
    // does not: it is 16 cm of foam, and a car that bounces off it
    // is a car being stopped by a kerb the eye cannot see.
    this.addBox(frame, group, [2.8, 0.16, 1.9], [0, 0.08, 0.2], this.game.materials.get('signal'), {
      collide: false,
      chamfer: 0.06,
    })
    for (const x of [-0.72, 0.72]) {
      this.addBox(frame, group, [0.14, 0.42, 0.14], [x, 0.21, -0.95], graphite)
    }
    this.addBox(frame, group, [1.7, 0.1, 0.1], [0, 0.4, -0.95], this.game.materials.get('metal'), {
      collide: false,
      chamfer: 0.03,
    })

    const concreteDark = this.game.materials.get('concreteDark')
    this.addBox(frame, group, [1.0, 0.18, 0.62], [1.95, 0.09, -0.5], concreteDark, { collide: false })
    this.addBox(frame, group, [0.82, 0.18, 0.5], [1.95, 0.27, -0.5], concreteDark, { collide: false })
  }

  /** A board, a post and the two lamps that say whether it is done. */
  private buildSign(
    frame: Frame,
    group: THREE.Group,
    spec: StationSpec,
  ): { pending: THREE.Mesh; done: THREE.Mesh } {
    // Off to one side of the pad, clear of the loaded bars, so the
    // board never stands between the driver and the equipment.
    const x = 2.6
    const z = 1.5

    this.addBox(frame, group, [0.14, 2.0, 0.14], [x, 1.0, z], this.game.materials.get('graphite'))
    this.addBox(frame, group, [1.9, 0.62, 0.12], [x, 2.2, z], this.game.materials.get('chalk'))

    const { texture, aspect } = textTexture({
      text: spec.label,
      sublines: [spec.sublabel],
      size: 96,
      color: palette.ink,
      letterSpacing: 0.1,
    })
    this.bin.add(() => texture.dispose())

    const height = 0.46
    const plane = this.own(new THREE.PlaneGeometry(height * aspect, height))
    const label = new THREE.Mesh(
      plane,
      this.game.materials.own(
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }),
      ),
    )
    label.position.set(x, 2.2, z + 0.07)
    group.add(label)

    // Two lamps rather than one recoloured lamp: the emissive
    // materials are shared with the rest of the world, and tinting
    // one here would repaint every other light that uses it.
    const lampGeometry = this.own(chamferedBox(0.26, 0.26, 0.26, 0.05))
    const pending = new THREE.Mesh(lampGeometry, this.game.materials.get('emissiveAccent'))
    pending.position.set(x, 2.64, z)
    group.add(pending)

    const done = new THREE.Mesh(lampGeometry, this.game.materials.get('emissiveSignal'))
    done.position.copy(pending.position)
    done.visible = false
    group.add(done)

    return { pending, done }
  }

  /**
   * One loose plate per station, at the medium prop mass tier used
   * by `world/Props.ts` — heavy enough to shrug off a nudge, light
   * enough to send skittering at speed.
   */
  private buildLoosePlate(frame: Frame): void {
    const at = this.toWorld(frame, -2.3, 0.09, 1.9)

    const geometry = this.own(new THREE.CylinderGeometry(0.42, 0.42, 0.14, 12))
    const mesh = new THREE.Mesh(geometry, this.game.materials.get('accentDeep'))
    mesh.castShadow = this.game.quality.settings.shadows
    mesh.position.set(at.x, at.y, at.z)
    // World-space transform written from physics, so it must not sit
    // under a station group that carries a rotation of its own.
    this.group.add(mesh)

    const physical = this.game.physics.add({
      type: 'dynamic',
      category: 'object',
      position: at,
      mass: 6,
      friction: 0.7,
      restitution: 0.06,
      linearDamping: 0.25,
      angularDamping: 0.4,
      // No contact callback and so no contact-force events: the car
      // already sounds its own impacts, and asking Rapier to report
      // these as well would be paying for a sound twice.
      colliders: [{ shape: 'cylinder', parameters: [0.07, 0.42] }],
    })

    this.plates.push({ physical, mesh })
  }

  /* ---- the athlete ---------------------------------------- */

  private buildAthlete(centre: THREE.Vector3): void {
    // Off the centre line: the project monument stands on the exact
    // centre, and the gate-to-monument run should stay drivable.
    const x = centre.x - 4
    const z = centre.z + 8
    const y = this.game.world.terrain.colliderHeightAt(x, z)

    const podiumGeometry = this.own(new THREE.CylinderGeometry(2.4, 2.5, 0.9, 16))
    const podium = new THREE.Mesh(podiumGeometry, this.game.materials.get('concrete'))
    podium.position.set(x, y + 0.45, z)
    podium.castShadow = this.game.quality.settings.shadows
    podium.receiveShadow = this.game.quality.settings.shadows
    this.group.add(podium)

    this.game.physics.add({
      type: 'fixed',
      category: 'floor',
      position: { x, y: y + 0.45, z },
      friction: 0.7,
      restitution: 0.1,
      colliders: [{ shape: 'cylinder', parameters: [0.45, 2.4] }],
    })

    const rimGeometry = this.own(new THREE.CylinderGeometry(2.46, 2.46, 0.1, 16))
    const rim = new THREE.Mesh(rimGeometry, this.game.materials.get('signal'))
    rim.position.set(x, y + 0.86, z)
    this.group.add(rim)

    this.buildStuds(x, y, z)
    this.buildPlaque(x, y, z)

    this.rig = this.buildRig()
    this.rig.root.position.set(x, y + 0.9, z)
    this.group.add(this.rig.root)

    // At rest the athlete looks at the entrance gate, so the first
    // thing seen on driving in is a figure facing you.
    const gate = landmarkById['gym-circuit']
    this.restFacing = Math.atan2(gate.x - x, gate.z - z)
    this.facing = this.restFacing
    this.rig.root.rotation.y = this.facing
  }

  /** Floor studs marking the athlete's platform. Decoration only. */
  private buildStuds(x: number, y: number, z: number): void {
    const count = this.game.quality.count(28, 10)
    const random = seeded(74211)
    const geometry = this.own(chamferedBox(0.2, 0.06, 0.2, 0.02))
    const material = this.game.materials.get('concreteDark')

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (random() - 0.5) * 0.05
      const radius = 3.3 + (random() - 0.5) * 0.16
      const stud = new THREE.Mesh(geometry, material)
      const sx = x + Math.sin(angle) * radius
      const sz = z + Math.cos(angle) * radius
      stud.position.set(sx, this.game.world.terrain.colliderHeightAt(sx, sz) + 0.03, sz)
      stud.rotation.y = angle
      this.group.add(stud)
    }
  }

  /**
   * The plaque names the movement, not the station. Five textures
   * are baked once and swapped, because the whole point is that the
   * figure in front of it never changes.
   */
  private buildPlaque(x: number, y: number, z: number): void {
    const words: [PlaqueKey, string][] = [
      ['idle', 'READY'],
      ...STATIONS.map((spec) => [spec.id, spec.movement] as [PlaqueKey, string]),
    ]

    for (const [key, word] of words) {
      const { texture, aspect } = textTexture({
        text: word,
        sublines: ['ONE MODEL'],
        size: 80,
        color: palette.chalk,
        letterSpacing: 0.14,
      })
      this.bin.add(() => texture.dispose())
      const material = this.game.materials.own(
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }),
      )
      this.plaqueSkins.set(key, { material, aspect })
    }

    const backing = this.own(chamferedBox(1.9, 0.62, 0.1, 0.04))
    const board = new THREE.Mesh(backing, this.game.materials.get('ink'))
    board.position.set(x, y + 0.52, z + 2.42)
    this.group.add(board)

    // A unit plane, scaled per texture: the words are different
    // widths and stretched glyphs read as a mistake.
    const plane = this.own(new THREE.PlaneGeometry(1, 1))
    const skin = this.plaqueSkins.get('idle')
    this.plaque = new THREE.Mesh(plane, skin ? skin.material : this.game.materials.get('chalk'))
    this.plaque.position.set(x, y + 0.52, z + 2.49)
    this.group.add(this.plaque)
    this.setPlaque('idle')
  }

  private setPlaque(key: PlaqueKey): void {
    const skin = this.plaqueSkins.get(key)
    if (!skin) return
    this.plaqueKey = key
    this.plaque.material = skin.material
    const height = 0.4
    this.plaque.scale.set(height * skin.aspect, height, 1)
  }

  /**
   * The rig. Every limb is a capsule whose pivot sits at the top of
   * its cylinder, so a joint rotation reads as a bone swinging from
   * its socket and the cap doubles as the joint itself.
   */
  private buildRig(): Rig {
    const dark = this.game.materials.get('ink')
    const limbMaterial = this.game.materials.get('graphite')

    // The root sits on the podium's top face; the pelvis stands a
    // leg's length above it, which is what makes the feet land on
    // the podium rather than inside it.
    const root = new THREE.Group()
    const pelvis = new THREE.Group()
    pelvis.position.y = HIP_Y
    root.add(pelvis)

    const hipBlock = this.own(chamferedBox(0.36, 0.2, 0.24, 0.05))
    const hipMesh = new THREE.Mesh(hipBlock, dark)
    hipMesh.position.y = -0.02
    hipMesh.castShadow = this.game.quality.settings.shadows
    pelvis.add(hipMesh)

    const spine = new THREE.Group()
    pelvis.add(spine)

    const torso = this.own(chamferedBox(0.46, 0.6, 0.28, 0.07))
    const torsoMesh = new THREE.Mesh(torso, dark)
    torsoMesh.position.y = 0.36
    torsoMesh.castShadow = this.game.quality.settings.shadows
    spine.add(torsoMesh)

    // The one flash of colour on the figure, at chest height, so the
    // torso's rotation is readable from twenty metres up.
    const band = this.own(chamferedBox(0.48, 0.14, 0.3, 0.04))
    const bandMesh = new THREE.Mesh(band, this.game.materials.get('signal'))
    bandMesh.position.y = 0.46
    spine.add(bandMesh)

    const neck = this.own(chamferedBox(0.13, 0.14, 0.13, 0.03))
    const neckMesh = new THREE.Mesh(neck, limbMaterial)
    neckMesh.position.y = 0.68
    spine.add(neckMesh)

    const head = new THREE.Group()
    head.position.y = 0.72
    spine.add(head)
    const skull = this.own(chamferedBox(0.24, 0.28, 0.24, 0.06))
    const skullMesh = new THREE.Mesh(skull, dark)
    skullMesh.position.y = 0.13
    skullMesh.castShadow = this.game.quality.settings.shadows
    head.add(skullMesh)

    const shoulders: THREE.Group[] = []
    const elbows: THREE.Group[] = []
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group()
      shoulder.position.set(side * 0.28, 0.62, 0)
      spine.add(shoulder)
      this.addLimb(shoulder, 0.075, UPPER_ARM, limbMaterial)

      const elbow = new THREE.Group()
      elbow.position.y = -UPPER_ARM
      shoulder.add(elbow)
      this.addLimb(elbow, 0.065, FOREARM, limbMaterial)

      const fist = this.own(chamferedBox(0.13, 0.13, 0.13, 0.03))
      const fistMesh = new THREE.Mesh(fist, dark)
      fistMesh.position.y = -FOREARM
      elbow.add(fistMesh)

      shoulders.push(shoulder)
      elbows.push(elbow)
    }

    const hips: THREE.Group[] = []
    const knees: THREE.Group[] = []
    for (const side of [-1, 1]) {
      const hip = new THREE.Group()
      hip.position.set(side * 0.13, 0, 0)
      pelvis.add(hip)
      this.addLimb(hip, 0.095, THIGH, limbMaterial)

      const knee = new THREE.Group()
      knee.position.y = -THIGH
      hip.add(knee)
      this.addLimb(knee, 0.08, SHIN, limbMaterial)

      const foot = this.own(chamferedBox(0.2, 0.09, 0.3, 0.03))
      const footMesh = new THREE.Mesh(foot, dark)
      footMesh.position.set(0, -SHIN + 0.04, 0.05)
      knee.add(footMesh)

      hips.push(hip)
      knees.push(knee)
    }

    return { root, pelvis, spine, head, shoulders, elbows, hips, knees }
  }

  private addLimb(
    parent: THREE.Object3D,
    radius: number,
    length: number,
    material: THREE.Material,
  ): void {
    const geometry = this.own(new THREE.CapsuleGeometry(radius, length, 2, 7))
    // Pivot at the top of the cylindrical section: the upper cap then
    // sits proud of the joint and reads as the ball of it.
    geometry.translate(0, -length / 2, 0)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = this.game.quality.settings.shadows
    parent.add(mesh)
  }

  /* ========================================================
     PER-FRAME — runs whether or not a run is in progress
     ======================================================== */

  private animate(): void {
    const delta = Math.min(0.1, this.game.ticker.delta * this.game.ticker.scale)
    const time = this.game.ticker.elapsedScaled

    const demonstrating = this.nearestStation()
    const key: PlaqueKey = demonstrating ? demonstrating.spec.id : 'idle'
    if (key !== this.plaqueKey) this.setPlaque(key)

    switch (key) {
      case 'push': posePress(this.wanted, time); break
      case 'pull': poseRow(this.wanted, time); break
      case 'legs': poseSquat(this.wanted, time); break
      case 'core': poseCrunch(this.wanted, time); break
      default: poseIdle(this.wanted, time)
    }

    dampPose(this.pose, this.wanted, delta)
    applyPose(this.rig, this.pose)

    // Turn to face whoever is watching. Damped through the shortest
    // arc, so a station directly behind does not spin the figure.
    const target = demonstrating
      ? Math.atan2(
          demonstrating.position.x - this.rig.root.position.x,
          demonstrating.position.z - this.rig.root.position.z,
        )
      : this.restFacing
    this.facing += smallestAngle(this.facing, target) * (1 - Math.exp(-3.5 * delta))
    this.rig.root.rotation.y = this.facing

    const alpha = this.game.ticker.alpha
    for (const plate of this.plates) {
      this.game.physics.sample(plate.physical, alpha, plate.mesh.position, plate.mesh.quaternion)
    }
  }

  private nearestStation(): Station | null {
    const position = this.game.player.position
    let best: Station | null = null
    let bestDistance = POSE_RADIUS * POSE_RADIUS
    for (const station of this.stations) {
      const distance = dist2(position.x, position.z, station.position.x, station.position.z)
      if (distance >= bestDistance) continue
      bestDistance = distance
      best = station
    }
    return best
  }

  /* ========================================================
     THE RUN
     ======================================================== */

  protected tick(delta: number): void {
    void delta

    // A circuit with no clock is a drive round a ring. Sixty real
    // seconds is about four times the distance at a gentle pace.
    if (this.elapsed > TIME_LIMIT) {
      this.game.audio?.play('fail')
      this.fail('SESSION TIMED OUT')
      return
    }

    const position = this.game.player.position
    for (const station of this.stations) {
      if (station.done) continue
      const distance = dist2(position.x, position.z, station.position.x, station.position.z)
      if (!station.armed) {
        if (distance > ARM_RADIUS * ARM_RADIUS) station.armed = true
        continue
      }
      if (distance > STATION_RADIUS * STATION_RADIUS) continue
      this.markDone(station)
    }
  }

  private markDone(station: Station): void {
    station.done = true
    station.lampPending.visible = false
    station.lampDone.visible = true

    const done = this.doneCount
    // Rising pitch per station, so a run audibly builds to the last.
    this.game.audio?.blip(1 + (done - 1) * 0.18)

    if (done < this.stations.length) return
    this.game.achievements.set('gymCircuit', 1)
    // A sound of its own, because the achievement only fires its
    // unlock chime the first time anybody ever finishes.
    this.game.audio?.play('achievement')
    this.game.particles.burst(this.game.player.position, 24, 'confetti')
    this.finish(this.elapsed)
  }

  protected reset(): void {
    const position = this.game.player.position
    for (const station of this.stations) {
      station.done = false
      // Measured rather than assumed: a run started while parked on a
      // pad must not hand that station over on the first frame.
      station.armed =
        dist2(position.x, position.z, station.position.x, station.position.z) > ARM_RADIUS * ARM_RADIUS
      station.lampPending.visible = true
      station.lampDone.visible = false
    }
    // Loose plates go back to their racks, so a run always starts
    // from the same picture. Nothing else was moved, and nothing
    // was locked, so there is nothing else to undo.
    for (const plate of this.plates) this.game.physics.reset(plate.physical)
  }

  private get doneCount(): number {
    let count = 0
    for (const station of this.stations) if (station.done) count++
    return count
  }

  /* ========================================================
     HUD
     ======================================================== */

  protected briefing(): string {
    return `FOUR STATIONS IN ${TIME_LIMIT}s · ANY ORDER`
  }

  protected lines(): string[] {
    const best = this.bestTime

    if (this.state === 'countdown') {
      return [Math.ceil(this.leadInLeft).toFixed(0), 'GET READY', this.briefing()]
    }

    // Capitals for stations you have hit, lower case for the ones
    // left. One glance, no legend, and it fits the same width as
    // the race circuit's line.
    const marks = this.stations
      .map((station) => (station.done ? station.spec.label : station.spec.label.toLowerCase()))
      .join(' ')

    const left = Math.max(0, TIME_LIMIT - this.elapsed)
    return [
      `${formatTime(this.elapsed)}   ${left.toFixed(0)}s LEFT`,
      marks,
      `${this.doneCount}/${this.stations.length}  ${best !== null ? `BEST ${formatTime(best)}` : 'NO BEST YET'}  ESC TO LEAVE`,
    ]
  }

  protected progress(): number | null {
    return clamp(this.doneCount / this.stations.length, 0, 1)
  }
}

/* ============================================================
   POSE DATA

   The whole gym app, in one place: five sets of numbers written
   into the same rig. Angles follow the figure's own frame, which
   faces local +Z — negative pitch swings a limb forward, and each
   pose keeps the leg chain long enough that the feet stay on the
   podium rather than sinking through it.
   ============================================================ */

function blankPose(): Pose {
  return {
    pelvisY: 0,
    spinePitch: 0,
    headPitch: 0,
    shoulderPitch: [0, 0],
    shoulderRoll: [0, 0],
    elbow: [0, 0],
    hipPitch: [0, 0],
    knee: [0, 0],
  }
}

/** Outward is -X for the left arm and +X for the right. */
const OUTWARD: [number, number] = [-1, 1]

/**
 * How far the ankle falls below the pelvis for a given leg. Every
 * pose sets `pelvisY` from this rather than from a hand-tuned
 * ramp: bend the knees on a linear drop and the feet sink through
 * the podium halfway down, because the chain shortens as a cosine
 * and the ramp does not.
 */
function legDrop(hip: number, knee: number): number {
  return Math.cos(hip) * THIGH + Math.cos(hip + knee) * SHIN
}

/** Standing, breathing. What the rig does when nobody is close. */
function poseIdle(pose: Pose, time: number): void {
  const breath = Math.sin(time * 0.7)
  // The breath offset is held non-negative: a raw sine would take the
  // pelvis below the leg chain on every exhale and push the feet
  // through the podium. A centimetre of float does not read; clipping
  // does.
  pose.pelvisY = legDrop(0, 0.04) - HIP_Y + 0.012 * (0.5 + 0.5 * breath)
  pose.spinePitch = 0.04 + breath * 0.02
  pose.headPitch = -0.04
  for (let i = 0; i < 2; i++) {
    pose.shoulderPitch[i] = 0.06 + breath * 0.05
    pose.shoulderRoll[i] = OUTWARD[i] * (0.12 + breath * 0.02)
    pose.elbow[i] = -0.18
    pose.hipPitch[i] = 0
    pose.knee[i] = 0.04
  }
}

/** PUSH — overhead press. Racked at the shoulder, locked out above. */
function posePress(pose: Pose, time: number): void {
  const drive = 0.5 - 0.5 * Math.cos(time * 1.5)
  pose.pelvisY = legDrop(0, 0.06) - HIP_Y
  pose.spinePitch = -0.04 * drive
  pose.headPitch = -0.12 * drive
  for (let i = 0; i < 2; i++) {
    pose.shoulderPitch[i] = -0.55 - drive * 2.34
    pose.shoulderRoll[i] = OUTWARD[i] * (0.34 - drive * 0.2)
    pose.elbow[i] = -2.5 + drive * 2.35
    pose.hipPitch[i] = 0
    pose.knee[i] = 0.06
  }
}

/** PULL — bent-over row. Hinged at the hips, elbows driven back. */
function poseRow(pose: Pose, time: number): void {
  const drive = 0.5 - 0.5 * Math.cos(time * 1.7)
  const hinge = 0.92 - drive * 0.06
  const hip = -0.25
  const knee = 0.35

  pose.pelvisY = legDrop(hip, knee) - HIP_Y
  pose.spinePitch = hinge
  pose.headPitch = -0.55
  for (let i = 0; i < 2; i++) {
    // The shoulder cancels the hinge first, so the arms hang plumb
    // at the bottom of the rep however far the torso is tipped.
    pose.shoulderPitch[i] = -hinge + drive * 0.75
    pose.shoulderRoll[i] = OUTWARD[i] * 0.05
    pose.elbow[i] = -0.35 - drive * 1.85
    pose.hipPitch[i] = hip
    pose.knee[i] = knee
  }
}

/** LEGS — squat. Arms come forward as a counterweight; the rig holds no bar. */
function poseSquat(pose: Pose, time: number): void {
  const drive = 0.5 - 0.5 * Math.cos(time * 1.3)
  const hip = -1.25 * drive
  const knee = 1.55 * drive

  pose.pelvisY = legDrop(hip, knee) - HIP_Y
  pose.spinePitch = 0.1 + 0.3 * drive
  pose.headPitch = -0.25 * drive
  for (let i = 0; i < 2; i++) {
    pose.shoulderPitch[i] = -0.1 - 1.35 * drive
    pose.shoulderRoll[i] = OUTWARD[i] * 0.1
    pose.elbow[i] = -0.15 - 0.1 * drive
    pose.hipPitch[i] = hip
    pose.knee[i] = knee
  }
}

/** CORE — standing crunch, knees alternating into the fold. */
function poseCrunch(pose: Pose, time: number): void {
  const swing = Math.sin(time * 1.8)
  const curl = Math.abs(swing)

  // One leg is always the support leg, so the pelvis rides on that
  // one and holds its height while the other knee comes up.
  pose.pelvisY = legDrop(0, 0.06) - HIP_Y
  pose.spinePitch = 0.2 + 0.72 * curl
  pose.headPitch = 0.25 * curl

  const lift: [number, number] = [Math.max(0, swing), Math.max(0, -swing)]
  for (let i = 0; i < 2; i++) {
    pose.shoulderPitch[i] = -0.75
    pose.shoulderRoll[i] = OUTWARD[i] * 0.55
    pose.elbow[i] = -2.45
    pose.hipPitch[i] = -1.25 * lift[i]
    pose.knee[i] = 0.06 + 1.29 * lift[i]
  }
}

/**
 * Eases every joint toward the pose the active exercise wants.
 * One constant for the whole body: joints that move together stay
 * together, which is what stops a blend from looking like a rag.
 */
function dampPose(current: Pose, target: Pose, delta: number): void {
  const t = 1 - Math.exp(-11 * delta)
  current.pelvisY += (target.pelvisY - current.pelvisY) * t
  current.spinePitch += (target.spinePitch - current.spinePitch) * t
  current.headPitch += (target.headPitch - current.headPitch) * t
  for (let i = 0; i < 2; i++) {
    current.shoulderPitch[i] += (target.shoulderPitch[i] - current.shoulderPitch[i]) * t
    current.shoulderRoll[i] += (target.shoulderRoll[i] - current.shoulderRoll[i]) * t
    current.elbow[i] += (target.elbow[i] - current.elbow[i]) * t
    current.hipPitch[i] += (target.hipPitch[i] - current.hipPitch[i]) * t
    current.knee[i] += (target.knee[i] - current.knee[i]) * t
  }
}

function applyPose(rig: Rig, pose: Pose): void {
  rig.pelvis.position.y = HIP_Y + pose.pelvisY
  rig.spine.rotation.x = pose.spinePitch
  rig.head.rotation.x = pose.headPitch
  for (let i = 0; i < 2; i++) {
    // XYZ order applies the roll first, so a shoulder abducts out to
    // the side and then swings forward, rather than the reverse.
    rig.shoulders[i].rotation.set(pose.shoulderPitch[i], 0, pose.shoulderRoll[i])
    rig.elbows[i].rotation.x = pose.elbow[i]
    rig.hips[i].rotation.x = pose.hipPitch[i]
    rig.knees[i].rotation.x = pose.knee[i]
  }
}
