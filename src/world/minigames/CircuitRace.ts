import * as THREE from 'three'
import { Minigame } from './Minigame'
import { palette } from '../core/palette'
import { clamp, formatTime } from '../core/maths'
import { textTexture } from '../world/materials'
import type { Bin } from '../core/Disposal'
import type { Game } from '../Game'
import type { Physical } from '../physics/Physics'
import type { MinigameId } from '@/content/world'
import { districtById } from '@/content/world'

/* ============================================================
   RACE CIRCUIT

   Ported in behaviour from sources/Game/World/Areas/CircuitArea.js
   (folio-2025, MIT — Copyright (c) 2025 Bruno Simon). See
   THIRD_PARTY_NOTICES.md. The track shape, art and best-time
   persistence are ours.

   Three upstream decisions are kept because they are what make
   the mode feel good rather than punishing:

   1. ANTI-SKIP IS ONE LINE. Only the gate currently held as
      `target` can register. Every other gate is inert. You can
      reverse through the target and it counts; you can clip gates
      ahead and nothing happens. There is no plane-crossing test
      and no direction check. Forgiving on purpose.
   2. FALLING OFF DOES NOT STOP THE CLOCK. You are returned to the
      last gate you took, facing the right way, and the timer runs
      through it. A time penalty on top of losing the position is
      punishment twice.
   3. THE RACE SURFACE IS ITS OWN COLLIDER. During a run the road
      ribbon is enabled and the terrain heightfield beneath it is
      not. A car at 40 m/s on a heightfield with 2.5 m cells feels
      completely different from one on a clean ribbon — this is a
      feel mechanic, not housekeeping. Order matters: the road goes
      on before the terrain goes off, or the car falls through.

   Two upstream problems are fixed rather than copied:

   - TUNNELLING. Detection is a radius-2 proximity test, and a
     boosting car covers up to 2.7 m in one step, so a gate could be
     missed entirely. The proximity test is kept AND a swept
     segment-versus-segment test is added; either one counts.
   - THE CLOCK. Upstream measures `performance.now()` deltas, so a
     GC pause or a hidden tab inflates the recorded time. This
     accumulates clamped simulation deltas instead, which is the
     only honest way to time something in a route that can be
     backgrounded.
   ============================================================ */

const LAPS = 3
/** Gate detection radius, upstream's value. */
const CHECK_RADIUS = 2
const COUNTDOWN = 3

/** Control points of the closed racing line, in district space. */
const TRACK: [number, number][] = [
  [0, 52], [30, 46], [48, 26], [52, -2], [42, -26],
  [20, -38], [-6, -34], [-18, -14], [-14, 8], [-30, 24],
  [-48, 26], [-56, 6], [-48, -22], [-30, -44], [-2, -56],
  [30, -58], [52, -44], [58, -20], [56, 18], [36, 44],
]

const ROAD_WIDTH = 13
const BARRIER_HEIGHT = 1.5

interface Gate {
  index: number
  centre: THREE.Vector3
  /** Endpoints of the gate line, in world XZ. */
  a: THREE.Vector2
  b: THREE.Vector2
  rotation: number
  halfWidth: number
  /** Where the car is put if it falls off after taking this gate. */
  respawn: { position: THREE.Vector3; rotation: number }
}

export class CircuitRace extends Minigame {
  readonly id: MinigameId = 'circuit'
  readonly title = 'RACE CIRCUIT'

  private gates: Gate[] = []
  private reached = 0
  private lap = 1
  private splits: number[] = []
  private countdown = 0

  private roadPhysical: Physical | null = null
  private barriers: Physical[] = []
  private terrainEnabled = true

  private group = new THREE.Group()
  private targetDoor!: THREE.Mesh
  private doorMaterial!: THREE.ShaderMaterial
  private banners: { mesh: THREE.Object3D; phase: number }[] = []

  private startPosition = new THREE.Vector3()
  private startRotation = 0

  private readonly previous2 = new THREE.Vector2()
  private readonly current2 = new THREE.Vector2()

  constructor(game: Game, bin: Bin) {
    super(game, bin)
    this.abandonRadius = 320
  }

  /* ========================================================
     BUILD
     ======================================================== */

  build(): void {
    const district = districtById.circuit
    const origin = new THREE.Vector3(district.x, 0, district.z)

    const curve = new THREE.CatmullRomCurve3(
      TRACK.map(([x, z]) => new THREE.Vector3(origin.x + x, 0, origin.z + z)),
      true,
      'catmullrom',
      0.5,
    )

    // Lift the whole ribbon onto the terrain, then keep it there:
    // the road is what the car drives on during a race, so it must
    // not float above or sink below what it replaces.
    const samples = 220
    const points: THREE.Vector3[] = []
    for (let i = 0; i < samples; i++) {
      const point = curve.getPointAt(i / samples)
      point.y = this.game.world.terrain.colliderHeightAt(point.x, point.z) + 0.12
      points.push(point)
    }

    this.buildRoad(points)
    this.buildBarriers(points)
    this.buildGates(curve, points)
    this.buildDoor()
    this.buildBanners(points)

    this.game.renderer.scene.add(this.group)
    this.bin.object3D(this.group)

    // Barriers and the road ribbon are off until a race starts, so
    // the circuit is a place you can drive across the rest of the time.
    this.setRaceColliders(false)
  }

  private buildRoad(points: THREE.Vector3[]): void {
    const count = points.length
    const positions: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    const indices: number[] = []

    const tangent = new THREE.Vector3()
    const side = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)

    for (let i = 0; i < count; i++) {
      const point = points[i]
      const next = points[(i + 1) % count]
      const previous = points[(i - 1 + count) % count]
      tangent.subVectors(next, previous).normalize()
      side.crossVectors(tangent, up).normalize().multiplyScalar(ROAD_WIDTH / 2)

      positions.push(point.x - side.x, point.y, point.z - side.z)
      positions.push(point.x + side.x, point.y, point.z + side.z)
      normals.push(0, 1, 0, 0, 1, 0)
      const v = (i / count) * 26
      uvs.push(0, v, 1, v)
    }

    for (let i = 0; i < count; i++) {
      const a = i * 2
      const b = a + 1
      const c = ((i + 1) % count) * 2
      const d = c + 1
      indices.push(a, c, b, b, c, d)
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setIndex(indices)

    const mesh = new THREE.Mesh(geometry, this.game.materials.tinted(palette.asphaltLight, 0.92, 0))
    mesh.receiveShadow = this.game.quality.settings.shadows
    mesh.renderOrder = 1
    this.group.add(mesh)
    this.bin.add(() => geometry.dispose())

    // The collider is a trimesh of exactly the ribbon above.
    this.roadPhysical = this.game.physics.add({
      type: 'fixed',
      category: 'floor',
      friction: 1.1,
      restitution: 0,
      enabled: false,
      colliders: [
        {
          shape: 'trimesh',
          parameters: [new Float32Array(positions), new Uint32Array(indices)],
        },
      ],
    })
  }

  private buildBarriers(points: THREE.Vector3[]): void {
    const count = points.length
    const tangent = new THREE.Vector3()
    const side = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)

    // One box per segment per side. Cheap, and a continuous wall is
    // the only thing that reliably stops a boosting car.
    const step = 2
    for (let i = 0; i < count; i += step) {
      const point = points[i]
      const next = points[(i + step) % count]
      tangent.subVectors(next, point)
      const length = tangent.length() + 0.6
      tangent.normalize()
      side.crossVectors(tangent, up).normalize()

      const angle = Math.atan2(-tangent.z, tangent.x)
      const mid = point.clone().lerp(next, 0.5)

      for (const sign of [-1, 1]) {
        const offset = side.clone().multiplyScalar((sign * ROAD_WIDTH) / 2 + sign * 0.5)
        const at = mid.clone().add(offset)

        const geometry = new THREE.BoxGeometry(length, BARRIER_HEIGHT, 0.5)
        const mesh = new THREE.Mesh(
          geometry,
          this.game.materials.tinted(i % 8 < 4 ? palette.chalk : palette.accent, 0.7, 0),
        )
        mesh.position.set(at.x, at.y + BARRIER_HEIGHT / 2, at.z)
        mesh.rotation.y = angle
        mesh.castShadow = false
        mesh.visible = false
        this.group.add(mesh)
        this.bin.add(() => geometry.dispose())

        const physical = this.game.physics.add({
          type: 'fixed',
          category: 'floor',
          position: { x: at.x, y: at.y + BARRIER_HEIGHT / 2, z: at.z },
          rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, angle, 0)),
          friction: 0.3,
          restitution: 0.25,
          enabled: false,
          colliders: [{ shape: 'cuboid', parameters: [length / 2, BARRIER_HEIGHT / 2, 0.25] }],
        })
        physical.owner = mesh
        this.barriers.push(physical)
      }
    }
  }

  private buildGates(curve: THREE.CatmullRomCurve3, points: THREE.Vector3[]): void {
    const gateCount = 12
    const yAxis = new THREE.Vector3(0, 1, 0)

    for (let i = 0; i < gateCount; i++) {
      const t = i / gateCount
      const centre = curve.getPointAt(t)
      centre.y = this.game.world.terrain.colliderHeightAt(centre.x, centre.z)
      const tangent = curve.getTangentAt(t)
      const rotation = Math.atan2(-tangent.z, tangent.x)

      // Gate axis is perpendicular to the racing line, written
      // directly rather than through upstream's Vector2 rotation —
      // which needs a sign flip that is easy to get backwards.
      const axis = new THREE.Vector3(0, 0, 1).applyAxisAngle(yAxis, rotation)
      const halfWidth = ROAD_WIDTH / 2 + 1

      const a = new THREE.Vector2(centre.x - axis.x * halfWidth, centre.z - axis.z * halfWidth)
      const b = new THREE.Vector2(centre.x + axis.x * halfWidth, centre.z + axis.z * halfWidth)

      // Respawn: three metres back down the track, facing forward.
      const respawnPosition = centre.clone().addScaledVector(tangent, -4)
      respawnPosition.y = this.game.world.terrain.colliderHeightAt(
        respawnPosition.x, respawnPosition.z,
      ) + 2.5

      this.gates.push({
        index: i,
        centre,
        a, b, rotation, halfWidth,
        respawn: { position: respawnPosition, rotation },
      })

      if (i === 0) {
        this.startPosition.copy(respawnPosition)
        this.startRotation = rotation
        this.buildStartLine(centre, rotation)
      } else {
        this.buildGatePosts(centre, axis, halfWidth)
      }
    }

    void points
  }

  private buildStartLine(centre: THREE.Vector3, rotation: number): void {
    const { texture, aspect } = textTexture({
      text: '', sublines: [], size: 8,
    })
    texture.dispose()
    void aspect

    // A chequered strip across the road.
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 16
    const ctx = canvas.getContext('2d')
    if (ctx) {
      for (let x = 0; x < 16; x++) {
        for (let y = 0; y < 2; y++) {
          ctx.fillStyle = (x + y) % 2 ? palette.ink : palette.chalk
          ctx.fillRect(x * 8, y * 8, 8, 8)
        }
      }
    }
    const stripTexture = new THREE.CanvasTexture(canvas)
    stripTexture.colorSpace = THREE.SRGBColorSpace
    this.bin.add(() => stripTexture.dispose())

    const geometry = new THREE.PlaneGeometry(ROAD_WIDTH + 2, 3)
    geometry.rotateX(-Math.PI / 2)
    const mesh = new THREE.Mesh(
      geometry,
      this.game.materials.own(new THREE.MeshBasicMaterial({ map: stripTexture, toneMapped: false })),
    )
    mesh.position.set(centre.x, centre.y + 0.16, centre.z)
    mesh.rotation.y = -rotation
    mesh.renderOrder = 2
    this.group.add(mesh)
    this.bin.add(() => geometry.dispose())
  }

  private buildGatePosts(centre: THREE.Vector3, axis: THREE.Vector3, halfWidth: number): void {
    for (const sign of [-1, 1]) {
      const geometry = new THREE.BoxGeometry(0.4, 4.2, 0.4)
      const mesh = new THREE.Mesh(geometry, this.game.materials.get('emissiveAccent'))
      mesh.position.set(
        centre.x + axis.x * halfWidth * sign,
        centre.y + 2.1,
        centre.z + axis.z * halfWidth * sign,
      )
      this.group.add(mesh)
      this.bin.add(() => geometry.dispose())
    }
  }

  /**
   * One curtain mesh, teleported to whichever gate is next — the
   * upstream trick, and the reason twelve gates cost one draw call
   * instead of twelve.
   */
  private buildDoor(): void {
    const geometry = new THREE.PlaneGeometry(1, 1)
    this.doorMaterial = this.game.materials.own(
      new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
          uScale: { value: 1 },
          uColor: { value: new THREE.Color(palette.accent) },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          precision highp float;
          varying vec2 vUv;
          uniform float uTime;
          uniform float uScale;
          uniform vec3 uColor;
          void main() {
            // The uScale factor on u keeps the diagonal stripes square
            // whatever the gate's width. Without it wide gates smear.
            vec2 uv = vUv;
            uv.y -= uTime * 0.2;
            uv *= vec2(uScale, 1.0) * 2.0;
            float stripes = step(0.5, fract(uv.x + uv.y));
            float alpha = (1.0 - vUv.y) * stripes * 0.85;
            if (alpha < 0.01) discard;
            gl_FragColor = vec4(uColor, alpha);
            #include <colorspace_fragment>
          }
        `,
      }),
    )
    this.targetDoor = new THREE.Mesh(geometry, this.doorMaterial)
    this.targetDoor.visible = false
    this.targetDoor.renderOrder = 4
    this.group.add(this.targetDoor)
    this.bin.add(() => geometry.dispose())
  }

  private buildBanners(points: THREE.Vector3[]): void {
    const count = this.game.quality.count(28, 10)
    for (let i = 0; i < count; i++) {
      const point = points[Math.floor((i / count) * points.length)]
      const geometry = new THREE.PlaneGeometry(0.16, 3.2)
      const pole = new THREE.Mesh(geometry, this.game.materials.get('metal'))
      pole.position.set(point.x, point.y + 1.6, point.z)
      this.group.add(pole)
      this.bin.add(() => geometry.dispose())

      const flagGeometry = new THREE.PlaneGeometry(1.8, 1.0)
      flagGeometry.translate(0.9, 0, 0)
      const flag = new THREE.Mesh(
        flagGeometry,
        this.game.materials.own(new THREE.MeshBasicMaterial({
          color: new THREE.Color(i % 2 ? palette.accent : palette.ink),
          side: THREE.DoubleSide,
          toneMapped: false,
        })),
      )
      flag.position.set(point.x, point.y + 2.9, point.z)
      this.group.add(flag)
      this.bin.add(() => flagGeometry.dispose())

      // Phase offset per banner so the row never flaps in unison.
      this.banners.push({ mesh: flag, phase: i * 0.5 })
    }
  }

  /* ========================================================
     RACE COLLIDERS
     ======================================================== */

  private setRaceColliders(active: boolean): void {
    // Order matters: the road goes on before the terrain goes off,
    // or there is a frame with nothing under the car.
    if (active) {
      this.roadPhysical?.body.setEnabled(true)
      this.setTerrainEnabled(false)
    } else {
      this.setTerrainEnabled(true)
      this.roadPhysical?.body.setEnabled(false)
    }

    for (const barrier of this.barriers) {
      barrier.body.setEnabled(active)
      const mesh = barrier.owner as THREE.Mesh | undefined
      if (mesh) mesh.visible = active
    }
  }

  private setTerrainEnabled(enabled: boolean): void {
    if (this.terrainEnabled === enabled) return
    this.terrainEnabled = enabled
    // The heightfield is the first fixed body the world creates.
    const terrain = this.game.physics.physicals.find((p) => p.type === 'fixed')
    terrain?.body.setEnabled(enabled)
  }

  /* ========================================================
     LIFECYCLE
     ======================================================== */

  start(): boolean {
    if (this.running) return true

    this.reset()
    this.state = 'countdown'
    this.countdown = COUNTDOWN
    this.elapsed = 0
    this.origin.copy(this.startPosition)

    this.game.player.setState('locked')
    this.game.vehicle.moveTo(this.startPosition, this.startRotation)
    this.game.view.focusPoint.trackedPosition.copy(this.startPosition)
    this.game.view.snapToTarget()

    this.setRaceColliders(true)
    this.setTarget(0)
    this.publish()
    this.events.trigger('start')
    return true
  }

  cancel(reason: 'player' | 'strayed' | 'respawn' = 'player'): void {
    if (!this.running && this.state !== 'finished') return
    this.state = 'idle'
    this.reset()
    this.game.store.getState().setMinigame(null)
    this.events.trigger('cancel', [reason])
  }

  protected reset(): void {
    this.reached = 0
    this.lap = 1
    this.splits = []
    this.countdown = 0
    this.targetDoor.visible = false
    this.setRaceColliders(false)
    this.game.player.setState('default')
  }

  /* ========================================================
     TICK
     ======================================================== */

  update(delta: number): void {
    // Banners flap in every state, including while idle.
    const t = this.game.ticker.elapsedScaled
    for (const banner of this.banners) {
      const time = t * 0.9 + banner.phase
      const wave = Math.sin(time) + Math.sin(time * 2.34) * 0.5 + Math.sin(time * 3.45) * 0.25
      banner.mesh.rotation.y = 0.5 + wave * 0.5
    }
    this.doorMaterial.uniforms.uTime.value = t

    if (!this.running) return

    if (this.state === 'countdown') {
      this.countdown -= delta
      if (this.countdown <= 0) {
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
    void delta
    const position = this.game.player.position

    // Falling off the ribbon returns you to the last gate. The clock
    // keeps running: losing the position is the penalty.
    if (position.y < this.game.world.terrain.colliderHeightAt(position.x, position.z) - 6) {
      this.respawnAtLastGate()
      return
    }

    this.current2.set(position.x, position.z)
    const target = this.gates[this.reached % this.gates.length]

    if (this.hasReached(target)) {
      this.previous2.copy(this.current2)
      this.registerReach()
      return
    }

    this.previous2.copy(this.current2)
  }

  /**
   * Upstream's proximity test, plus a swept test it does not have.
   * At 40 m/s the car moves up to 2.7 m per step and the detection
   * radius is 2, so proximity alone can miss a gate entirely.
   */
  private hasReached(gate: Gate): boolean {
    if (segmentCircleHit(gate.a, gate.b, this.current2, CHECK_RADIUS)) return true
    if (this.previous2.lengthSq() === 0) return false
    return segmentsIntersect(this.previous2, this.current2, gate.a, gate.b)
  }

  private registerReach(): void {
    this.reached++
    this.splits.push(this.elapsed)
    this.lap = Math.min(LAPS, Math.floor(this.reached / this.gates.length) + 1)

    // Each gate is 6% sharper than the last, so a run audibly builds.
    this.game.audio?.blip(1 + (this.reached - 1) * 0.06)

    if (this.reached >= this.gates.length * LAPS) {
      this.completeRace()
      return
    }
    this.setTarget(this.reached % this.gates.length)
  }

  private setTarget(index: number): void {
    const gate = this.gates[index]
    this.targetDoor.visible = true
    this.targetDoor.position.set(gate.centre.x, gate.centre.y + 2.2, gate.centre.z)
    this.targetDoor.rotation.y = -gate.rotation
    this.targetDoor.scale.set(gate.halfWidth * 2, 4.4, 1)
    this.doorMaterial.uniforms.uScale.value = gate.halfWidth
  }

  private respawnAtLastGate(): void {
    const index = this.reached === 0 ? 0 : (this.reached - 1) % this.gates.length
    const gate = this.gates[index]
    this.game.vehicle.moveTo(gate.respawn.position, gate.respawn.rotation)
    this.game.view.focusPoint.trackedPosition.copy(gate.respawn.position)
    this.game.view.snapToTarget()
  }

  private completeRace(): void {
    const time = this.elapsed
    this.targetDoor.visible = false
    this.setRaceColliders(false)

    this.game.achievements.set('circuit', 1)
    if (time < 60) this.game.achievements.set('speedDemon', 1)

    this.finish(time)
  }

  /* ========================================================
     HUD
     ======================================================== */

  protected lines(): string[] {
    if (this.state === 'countdown') {
      const n = Math.ceil(this.countdown)
      return [n > 0 ? String(n) : 'GO', `${LAPS} LAPS`]
    }
    const best = this.bestTime
    return [
      formatTime(this.elapsed),
      `LAP ${this.lap}/${LAPS}   GATE ${(this.reached % this.gates.length) + 1}/${this.gates.length}`,
      best !== null ? `BEST ${formatTime(best)}` : 'NO BEST TIME YET',
    ]
  }

  protected progress(): number | null {
    if (this.state === 'countdown') return null
    return clamp(this.reached / (this.gates.length * LAPS), 0, 1)
  }

  /** Sector splits, for a future delta readout. */
  get sectorTimes(): number[] {
    return this.splits.slice()
  }
}

/* ============================================================
   GEOMETRY TESTS
   ============================================================ */

/** Does the disc of `radius` at `centre` touch the segment a–b? */
function segmentCircleHit(
  a: THREE.Vector2,
  b: THREE.Vector2,
  centre: THREE.Vector2,
  radius: number,
): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const fx = a.x - centre.x
  const fy = a.y - centre.y

  const A = dx * dx + dy * dy
  const B = 2 * (fx * dx + fy * dy)
  const C = fx * fx + fy * fy - radius * radius

  const discriminant = B * B - 4 * A * C
  if (discriminant < 0) return false

  const root = Math.sqrt(discriminant)
  const t1 = (-B - root) / (2 * A)
  const t2 = (-B + root) / (2 * A)
  return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1)
}

/** Do segments p1–p2 and p3–p4 cross? The swept fix for tunnelling. */
function segmentsIntersect(
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
