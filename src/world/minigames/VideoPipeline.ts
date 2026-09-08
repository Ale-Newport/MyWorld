import * as THREE from 'three'
import { Minigame } from './Minigame'
import { palette } from '../core/palette'
import { clamp, seeded } from '../core/maths'
import { easing } from '../core/Tween'
import { textTexture } from '../world/materials'
import { chamferedBox } from '../world/geometry'
import type { Bin } from '../core/Disposal'
import type { Game } from '../Game'
import type { Landmark, MinigameId } from '@/content/world'
import { districtById, landmarkById } from '@/content/world'

/* ============================================================
   VIDEO PIPELINE

   Focus turns a prompt into a finished short video: prompt to
   script, script to narration, narration to captions, and the
   whole thing rendered. The interesting part of that product is
   not any one stage — it is that the stages only work in one
   order. So this is a game about order and nothing else.

   Five plinth gates stand in a ring around the pipeline
   landmark. Drive through them SCRIPT → VOICE → VISUALS →
   CAPTIONS → RENDER. The stage you need next glows accent, the
   ones you have stamped go graphite, the rest stay paper. Take a
   stage early and the run is over: the base class puts OUT OF
   ORDER on the HUD, holds it, then resets and returns to idle.
   Starting again is ENTER at the landmark, which stands at the
   centre of the ring, 21 m from every gate — a mistake costs the
   sequence, never the ability to try it again.

   Four decisions worth writing down:

   1. NO CLOCK. `finish(null)`, not `finish(time)`. Recording a
      best time would quietly turn a five-step sequence into a
      five-step sequence driven fast, which is the race circuit's
      job and not this one's. Progress is N/5 in the HUD and
      nothing else.
   2. STAGES ALREADY STAMPED ARE INERT. Only stages AHEAD of the
      target can fail you. The route cuts across the ring, so a
      car passes back over gates it has already taken constantly;
      failing those would reset runs for a mistake nobody made.
      Getting ahead of yourself is the error the game is about.
   3. GATES ARM ON EXIT. A gate the car is standing in when the
      sequence resets — at the start of a run, and again 2.6 s
      after a failure — cannot register until the car has left it.
      Without that, a car parked in a gate stamps or fails a stage
      on the first frame of the next run, off an input nobody gave.
   4. THE HUD IS NOT REPUBLISHED ONCE THE RUN IS OVER. `fail` and
      `finish` write the card the player is meant to read, and then
      the base `update` publishes once more on the way out of
      `tick`. This game's `lines()` is built entirely from state a
      failure does not change, so that last publish replaced OUT OF
      ORDER with the live progress on the frame it was set and the
      message was never seen. OrderRush guards the same way. See
      `publish` below.

   The gate test itself — proximity to the gate line, plus a swept
   segment crossing so a boosting car cannot tunnel between two
   samples — is the pair CircuitRace uses, adapted there from
   folio-2025's checkpoint check (MIT, Copyright (c) 2025 Bruno
   Simon). See THIRD_PARTY_NOTICES.md.
   ============================================================ */

/** The five stages, in the only order that produces a video. */
const STAGES = ['SCRIPT', 'VOICE', 'VISUALS', 'CAPTIONS', 'RENDER'] as const

/**
 * Which slot on the ring each stage stands at. Two slots per step
 * means the route crosses the middle instead of walking the rim,
 * so the labels have to be read rather than followed round.
 */
const RING_SLOTS = [0, 2, 4, 1, 3]

const RING_RADIUS = 21
/** Half the clear opening between a gate's two plinths. */
const GATE_HALF_WIDTH = 4.6
/** Gate detection radius. The circuit's value; forgiving on purpose. */
const CHECK_RADIUS = 2
/** How far the car must get from a gate before that gate can fire again. */
const ARM_DISTANCE = 9

const SLOT_STEP = (Math.PI * 2) / STAGES.length
/**
 * The road in from the Focus device arrives from due north, so the
 * ring opens towards it — turned half a slot so that no gate stands
 * inside the device's own interact radius and steals the ENTER key
 * from a run in progress.
 */
const BASE_ANGLE = -Math.PI / 2 - SLOT_STEP / 2

/* ---- the finished video --------------------------------- */

const SCREEN_WIDTH = 320
const SCREEN_HEIGHT = 180
/** Redraws per second of the canvas the screen samples. */
const SCREEN_FPS = 12
/** Past this, nobody can read the screen, so it stops redrawing. */
const SCREEN_VIEW_DISTANCE = 70

const FONT = 'ui-sans-serif, system-ui, -apple-system, Helvetica, Arial, sans-serif'

/** Caption text, restated from the Focus role in `experience.ts`. */
const CAPTIONS = [
  'PROMPT IN',
  'SCRIPT OUT',
  'NARRATED AND CAPTIONED',
  'RENDERED END TO END',
  'PERSONALISED SHORT-FORM LEARNING',
]

interface Shot {
  x: number
  y: number
  width: number
  height: number
  cx: number
  cy: number
  r: number
  warm: boolean
}

/**
 * The abstract "footage" the finished video cuts between. Seeded,
 * so the same six shots play in the same order on every reload.
 */
const SHOTS: Shot[] = (() => {
  const random = seeded(51966)
  return Array.from({ length: 6 }, () => ({
    x: random(),
    y: random(),
    width: random(),
    height: random(),
    cx: random(),
    cy: random(),
    r: random(),
    warm: random() > 0.5,
  }))
})()

interface Station {
  /** Position in the sequence, 0..4. */
  index: number
  label: string
  centre: THREE.Vector3
  /** Angle on the ring, for placing the beacon and the screen. */
  angle: number
  /** Endpoints of the gate line, in world XZ. */
  a: THREE.Vector2
  b: THREE.Vector2
  plinths: THREE.Mesh[]
  /** The pad's own material: it is the one thing that pulses. */
  padMaterial: THREE.MeshBasicMaterial
  /** False while the car is still inside this gate; see the header. */
  armed: boolean
}

export class VideoPipeline extends Minigame {
  readonly id: MinigameId = 'pipeline'
  readonly title = 'VIDEO PIPELINE'

  private stations: Station[] = []
  private reached = 0

  private group = new THREE.Group()
  private centre = new THREE.Vector3()
  private beacon!: THREE.Mesh
  private beaconBaseY = 0

  private screen = new THREE.Group()
  private panel!: THREE.Mesh
  private screenAnchor = new THREE.Vector3()
  private screenContext: CanvasRenderingContext2D | null = null
  private screenTexture: THREE.CanvasTexture | null = null
  private screenPlaying = false
  private screenStart = 0
  private screenDrawnAt = 0

  private readonly previous2 = new THREE.Vector2()
  private readonly current2 = new THREE.Vector2()

  constructor(game: Game, bin: Bin) {
    super(game, bin)
    // The ring is 21 m in radius; 90 m from its centre is past the
    // far edge of the Focus district, so straying is unambiguous.
    this.abandonRadius = 90
  }

  /* ========================================================
     BUILD
     ======================================================== */

  build(): void {
    // Coordinates live in the content layer, so moving the landmark
    // moves the game with it.
    const anchor: Landmark | undefined = landmarkById['focus-pipeline']
    this.centre.set(
      anchor?.x ?? districtById.focus.x,
      0,
      anchor?.z ?? districtById.focus.z,
    )
    this.centre.y = this.game.world.terrain.colliderHeightAt(this.centre.x, this.centre.z)

    for (let index = 0; index < STAGES.length; index++) {
      this.stations.push(this.buildStation(index))
    }

    this.buildRingPath()
    this.buildBeacon()
    this.buildScreen(this.stations[STAGES.length - 1])

    this.game.renderer.scene.add(this.group)
    this.bin.object3D(this.group)

    // The beacon bob, the pad pulse and the finished video all keep
    // running when this is not the active mini-game, so they hang off
    // the ticker rather than off `update`.
    const animate = () => this.animate()
    this.game.ticker.events.on('tick', animate, 15)
    this.bin.add(() => this.game.ticker.events.off('tick', animate))

    this.refresh()
  }

  private buildStation(index: number): Station {
    const angle = BASE_ANGLE + RING_SLOTS[index] * SLOT_STEP
    const x = this.centre.x + Math.cos(angle) * RING_RADIUS
    const z = this.centre.z + Math.sin(angle) * RING_RADIUS
    const y = this.game.world.terrain.colliderHeightAt(x, z)

    // Gate line is tangent to the ring, so a stage is driven through
    // radially and the plinths never stand in the driving line.
    const tx = -Math.sin(angle)
    const tz = Math.cos(angle)
    const yaw = Math.atan2(-tz, tx)

    const plinths: THREE.Mesh[] = []

    /* ---- the two plinths, and their colliders ---- */
    const offset = GATE_HALF_WIDTH + 0.8
    for (const sign of [-1, 1]) {
      const px = x + tx * offset * sign
      const pz = z + tz * offset * sign
      const py = this.game.world.terrain.colliderHeightAt(px, pz)

      const geometry = chamferedBox(1.6, 2.4, 1.6, 0.08)
      const mesh = new THREE.Mesh(geometry, this.game.materials.get('paper'))
      mesh.position.set(px, py + 1.2, pz)
      mesh.rotation.y = yaw
      mesh.castShadow = this.game.quality.settings.shadows
      mesh.receiveShadow = this.game.quality.settings.shadows
      this.group.add(mesh)
      this.bin.add(() => geometry.dispose())

      this.game.physics.add({
        type: 'fixed',
        category: 'floor',
        position: { x: px, y: py + 1.2, z: pz },
        rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
        friction: 0.7,
        restitution: 0.12,
        colliders: [{ shape: 'cuboid', parameters: [0.8, 1.2, 0.8] }],
      })

      plinths.push(mesh)
    }

    /* ---- the gantry the label hangs from ---- */
    // No collider: it spans the opening at 2.5 m, and a jumping car
    // clipping an invisible bar over a gate would read as a bug.
    const barGeometry = chamferedBox(offset * 2 + 1.6, 0.34, 0.34, 0.05)
    const bar = new THREE.Mesh(barGeometry, this.game.materials.get('graphite'))
    bar.position.set(x, y + 2.56, z)
    bar.rotation.y = yaw
    this.group.add(bar)
    this.bin.add(() => barGeometry.dispose())

    /* ---- label ---- */
    const { texture, aspect } = textTexture({
      text: STAGES[index],
      sublines: [`STAGE ${String(index + 1).padStart(2, '0')} OF ${STAGES.length}`],
      color: palette.ink,
      letterSpacing: 0.14,
      size: 96,
    })
    this.bin.add(() => texture.dispose())

    const labelHeight = 0.9
    const labelGeometry = new THREE.PlaneGeometry(labelHeight * aspect, labelHeight)
    const labelMaterial = this.game.materials.own(
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }),
    )
    this.bin.add(() => labelGeometry.dispose())

    // Two backs-to-back planes rather than one double-sided one: a
    // double-sided label reads mirrored from the far approach, and
    // every stage here has two approaches.
    const facing = Math.atan2(Math.cos(angle), Math.sin(angle))
    for (const turn of [0, Math.PI]) {
      const label = new THREE.Mesh(labelGeometry, labelMaterial)
      label.position.set(x, y + 3.35, z)
      label.rotation.y = facing + turn
      this.group.add(label)
    }

    /* ---- the pad you actually drive over ---- */
    const padGeometry = new THREE.PlaneGeometry(GATE_HALF_WIDTH * 2, 2.6)
    padGeometry.rotateX(-Math.PI / 2)
    const padMaterial = this.game.materials.own(
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(palette.paper),
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        toneMapped: false,
      }),
    )
    const pad = new THREE.Mesh(padGeometry, padMaterial)
    pad.position.set(x, y + 0.06, z)
    pad.rotation.y = yaw
    pad.renderOrder = 2
    this.group.add(pad)
    this.bin.add(() => padGeometry.dispose())

    return {
      index,
      label: STAGES[index],
      centre: new THREE.Vector3(x, y, z),
      angle,
      a: new THREE.Vector2(x - tx * GATE_HALF_WIDTH, z - tz * GATE_HALF_WIDTH),
      b: new THREE.Vector2(x + tx * GATE_HALF_WIDTH, z + tz * GATE_HALF_WIDTH),
      plinths,
      padMaterial,
      armed: true,
    }
  }

  /** Faint marks around the ring, so the five gates read as one shape. */
  private buildRingPath(): void {
    const count = this.game.quality.count(64, 20)
    const geometry = new THREE.PlaneGeometry(0.5, 0.5)
    geometry.rotateX(-Math.PI / 2)

    const dots = new THREE.InstancedMesh(
      geometry,
      this.game.materials.flat(palette.chalk3, 0.35),
      count,
    )
    const dummy = new THREE.Object3D()
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2
      const x = this.centre.x + Math.cos(angle) * RING_RADIUS
      const z = this.centre.z + Math.sin(angle) * RING_RADIUS
      dummy.position.set(x, this.game.world.terrain.colliderHeightAt(x, z) + 0.05, z)
      dummy.rotation.y = -angle
      dummy.updateMatrix()
      dots.setMatrixAt(i, dummy.matrix)
    }
    dots.instanceMatrix.needsUpdate = true
    dots.renderOrder = 1
    this.group.add(dots)
    this.bin.add(() => geometry.dispose())
    this.bin.add(() => dots.dispose())
  }

  /** One cone, teleported to whichever stage is next. */
  private buildBeacon(): void {
    const geometry = new THREE.ConeGeometry(0.6, 1.5, 6)
    geometry.rotateX(Math.PI)
    this.beacon = new THREE.Mesh(geometry, this.game.materials.get('emissiveAccent'))
    this.beacon.renderOrder = 3
    this.group.add(this.beacon)
    this.bin.add(() => geometry.dispose())
  }

  /**
   * The payoff: a screen behind RENDER that plays a short procedural
   * video once the sequence is complete. Everything on it is drawn to
   * a 320×180 canvas at 12 Hz — no files, no decoding, and it stops
   * redrawing when there is nobody near enough to read it.
   */
  private buildScreen(station: Station): void {
    const outward = new THREE.Vector3(Math.cos(station.angle), 0, Math.sin(station.angle))
    const at = station.centre.clone().addScaledVector(outward, 5.4)
    at.y = this.game.world.terrain.colliderHeightAt(at.x, at.z)

    this.screen.position.copy(at)
    // Faces the middle of the ring, which is where the last run ends.
    this.screen.rotation.y = Math.atan2(-outward.x, -outward.z)
    this.group.add(this.screen)

    this.screenAnchor.copy(at).setY(at.y + 5.6)

    const facing = this.screen.rotation.y
    for (const local of [-2.6, 2.6]) {
      const geometry = new THREE.CylinderGeometry(0.16, 0.16, 5.6, 8)
      const mast = new THREE.Mesh(geometry, this.game.materials.get('metal'))
      mast.position.set(local, 2.8, 0)
      this.screen.add(mast)
      this.bin.add(() => geometry.dispose())

      // The masts are solid: a screen a car drives straight through
      // is scenery, not a thing standing in the world.
      this.game.physics.add({
        type: 'fixed',
        category: 'floor',
        position: {
          x: at.x + Math.cos(facing) * local,
          y: at.y + 2.8,
          z: at.z - Math.sin(facing) * local,
        },
        rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, facing, 0)),
        friction: 0.6,
        restitution: 0.1,
        colliders: [{ shape: 'cuboid', parameters: [0.2, 2.8, 0.2] }],
      })
    }

    const frameGeometry = chamferedBox(6.6, 3.9, 0.3, 0.08)
    const frame = new THREE.Mesh(frameGeometry, this.game.materials.get('graphite'))
    frame.position.set(0, 5.6, -0.16)
    this.screen.add(frame)
    this.bin.add(() => frameGeometry.dispose())

    const canvas = document.createElement('canvas')
    canvas.width = SCREEN_WIDTH
    canvas.height = SCREEN_HEIGHT
    this.screenContext = canvas.getContext('2d')

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    this.screenTexture = texture
    this.bin.add(() => texture.dispose())

    // The mast, the frame and its colliders stand from the start —
    // an armature that appears at the moment of winning would be a
    // wall the car could drive through five seconds earlier. Only the
    // picture is withheld, so the screen reads as switched off.
    const panelGeometry = new THREE.PlaneGeometry(6.2, 3.5)
    this.panel = new THREE.Mesh(
      panelGeometry,
      this.game.materials.own(new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })),
    )
    this.panel.position.set(0, 5.6, 0.02)
    this.panel.visible = false
    this.screen.add(this.panel)
    this.bin.add(() => panelGeometry.dispose())
  }

  /* ========================================================
     LIFECYCLE
     ======================================================== */

  start(): boolean {
    if (this.running) return true
    const started = super.start()
    // Straying is measured from the ring, not from wherever the car
    // happened to be parked when ENTER was pressed.
    this.origin.copy(this.centre)
    this.game.audio?.blip(0.8)
    return started
  }

  protected reset(): void {
    this.reached = 0
    this.previous2.set(0, 0)

    // A gate the car is sitting in must not fire until it has left.
    const position = this.game.player.position
    for (const station of this.stations) {
      station.armed = this.isClearOf(station, position)
    }

    this.screenPlaying = false
    this.panel.visible = false
    this.refresh()
  }

  /* ========================================================
     TICK
     ======================================================== */

  protected tick(delta: number): void {
    void delta
    const position = this.game.player.position
    this.current2.set(position.x, position.z)

    for (const station of this.stations) {
      // Stages already stamped are inert — see the header.
      if (station.index < this.reached) continue

      const crossed = this.hasCrossed(station)

      if (!station.armed) {
        if (!crossed && this.isClearOf(station, position)) station.armed = true
        continue
      }
      if (!crossed) continue

      if (station.index === this.reached) this.stamp(station)
      else this.failOutOfOrder()
      break
    }

    this.previous2.copy(this.current2)
  }

  /**
   * Proximity to the gate line, or a swept crossing since the last
   * sample. Either counts, in both directions: the sequence is the
   * difficulty here, and a gate that rejects a reverse approach adds
   * frustration rather than challenge.
   */
  private hasCrossed(station: Station): boolean {
    if (segmentCircleHit(station.a, station.b, this.current2, CHECK_RADIUS)) return true
    if (this.previous2.lengthSq() === 0) return false
    return segmentsIntersect(this.previous2, this.current2, station.a, station.b)
  }

  private isClearOf(station: Station, position: THREE.Vector3): boolean {
    const dx = position.x - station.centre.x
    const dz = position.z - station.centre.z
    return dx * dx + dz * dz > ARM_DISTANCE * ARM_DISTANCE
  }

  private stamp(station: Station): void {
    this.reached++
    station.armed = false

    // Each stage a tone higher, so a clean run climbs.
    this.game.audio?.blip(1 + (this.reached - 1) * 0.11)
    this.refresh()

    if (this.reached >= STAGES.length) this.complete()
  }

  private failOutOfOrder(): void {
    this.game.audio?.play('fail')
    // The base class holds the message for 2.6 s, calls `reset` and
    // goes idle. The run ends; the mini-game does not, and every gate
    // is back at SCRIPT for whoever drives to the landmark next.
    this.fail('OUT OF ORDER')
  }

  private complete(): void {
    this.game.achievements.set('contentEngine', 1)
    this.game.view.kick(0.3)

    // The screen switches on and keeps playing after the HUD has
    // cleared, so the finished video is something to drive back to
    // rather than a five-second reward.
    this.screenStart = this.game.ticker.elapsed
    this.screenDrawnAt = this.screenStart
    this.screenPlaying = true
    this.panel.visible = true

    // Drawn here rather than at build: this is the only tick that
    // makes the panel visible, so it is the only one that can show a
    // blank canvas. Under reduced motion this frame is also the last.
    this.drawScreen(0)

    if (this.game.reducedMotion) {
      this.panel.scale.setScalar(1)
    } else {
      this.panel.scale.setScalar(0.55)
      this.game.tweens.to(
        this.panel.scale,
        { x: 1, y: 1, z: 1 },
        { duration: 0.7, ease: easing.backOut },
      )
    }

    // No time is recorded: this is a sequence, not a lap.
    this.finish(null)
  }

  /* ========================================================
     PRESENTATION
     ======================================================== */

  /** Colours every stage from `reached`, and moves the beacon. */
  private refresh(): void {
    for (const station of this.stations) {
      const done = station.index < this.reached
      const next = station.index === this.reached

      const material = next
        ? this.game.materials.get('accent')
        : done
          ? this.game.materials.get('graphite')
          : this.game.materials.get('paper')
      for (const plinth of station.plinths) plinth.material = material

      station.padMaterial.color.set(
        next ? palette.accent : done ? palette.ink2 : palette.paper,
      )
      station.padMaterial.opacity = next ? 0.42 : done ? 0.22 : 0.14
    }

    const target = this.stations[this.reached]
    this.beacon.visible = Boolean(target)
    if (target) {
      this.beaconBaseY = target.centre.y + 4.9
      this.beacon.position.set(target.centre.x, this.beaconBaseY, target.centre.z)
    }
  }

  /** Runs every frame, in every state, including while idle. */
  private animate(): void {
    const t = this.game.ticker.elapsedScaled
    // Reduced motion keeps every signal — the beacon still marks the
    // stage, the pad still reads as the live one, the screen still
    // holds a finished frame — and stops each of them moving. The
    // setting is toggled at runtime, so both branches write the value
    // rather than one of them simply stopping: a beacon frozen at the
    // top of its bob hangs off the stage it is pointing at.
    const reduced = this.game.reducedMotion

    if (this.beacon.visible) {
      this.beacon.position.y = reduced
        ? this.beaconBaseY
        : this.beaconBaseY + Math.sin(t * 2.2) * 0.28
      if (!reduced) this.beacon.rotation.y = t * 0.9
    }

    const target = this.stations[this.reached]
    if (target) {
      // Only the stage you need pulses; the others hold their value.
      target.padMaterial.opacity = reduced ? 0.42 : 0.34 + Math.sin(t * 3.4) * 0.14
    }

    if (!this.screenPlaying || reduced) return
    const now = this.game.ticker.elapsed
    if (now - this.screenDrawnAt < 1 / SCREEN_FPS) return
    if (
      this.game.player.position.distanceToSquared(this.screenAnchor) >
      SCREEN_VIEW_DISTANCE * SCREEN_VIEW_DISTANCE
    ) return

    this.screenDrawnAt = now
    this.drawScreen(now - this.screenStart)
  }

  /**
   * One frame of the finished video: frames advancing along the top,
   * a shot that cuts and pushes in, a narration waveform, and the
   * caption typing itself out underneath. Abstract on purpose — the
   * point is that all four layers arrive together.
   */
  private drawScreen(time: number): void {
    const ctx = this.screenContext
    if (!ctx) return

    const w = SCREEN_WIDTH
    const h = SCREEN_HEIGHT

    ctx.fillStyle = palette.voidDark2
    ctx.fillRect(0, 0, w, h)

    /* ---- frames advancing ---- */
    const cell = 34
    const travelled = (time * 40) / cell
    const scroll = (travelled % 1) * cell
    ctx.lineWidth = 1
    for (let i = -1; i <= Math.ceil(w / cell); i++) {
      const x = i * cell - scroll + 8
      const absolute = i + Math.floor(travelled)
      if (absolute % 4 === 0) {
        ctx.fillStyle = palette.accent
        ctx.fillRect(x, 8, cell - 6, 14)
      } else {
        ctx.strokeStyle = palette.chalk3
        ctx.strokeRect(x + 0.5, 8.5, cell - 7, 13)
      }
    }

    /* ---- the shot ---- */
    const shot = SHOTS[Math.floor(time / 1.1) % SHOTS.length]
    const within = (time / 1.1) % 1
    ctx.save()
    ctx.beginPath()
    ctx.rect(10, 30, w - 20, 82)
    ctx.clip()
    ctx.fillStyle = palette.voidDark3
    ctx.fillRect(10, 30, w - 20, 82)

    // A slow push in gives the shot movement without any content.
    const zoom = 1 + within * 0.14
    ctx.translate(w / 2, 71)
    ctx.scale(zoom, zoom)
    ctx.translate(-w / 2, -71)

    ctx.fillStyle = shot.warm ? palette.accentDeep : palette.signal
    ctx.fillRect(
      14 + shot.x * 200,
      34 + shot.y * 40,
      40 + shot.width * 90,
      18 + shot.height * 40,
    )
    ctx.fillStyle = palette.chalk
    ctx.beginPath()
    ctx.arc(20 + shot.cx * 270, 40 + shot.cy * 60, 7 + shot.r * 15, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    /* ---- narration ---- */
    const bars = 60
    ctx.fillStyle = palette.accent
    for (let i = 0; i < bars; i++) {
      const phase = time * 6 + i * 0.4
      const amplitude =
        Math.sin(phase) * 0.5 + Math.sin(phase * 1.7) * 0.3 + Math.sin(phase * 0.6) * 0.2
      const height = 2 + Math.abs(amplitude) * 20
      ctx.fillRect(12 + (i / bars) * (w - 24), 132 - height / 2, 3, height)
    }

    /* ---- caption ---- */
    const cycle = 2.8
    const line = CAPTIONS[Math.floor(time / cycle) % CAPTIONS.length]
    // Finishes typing at about two thirds of the cycle, then holds.
    const typed = line.slice(0, Math.max(1, Math.floor(((time % cycle) / cycle) * line.length * 1.6)))
    ctx.font = `600 15px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = palette.chalk
    ctx.fillText(typed, w / 2, 156)

    /* ---- meta ---- */
    ctx.font = `500 10px ${FONT}`
    ctx.fillStyle = palette.ink4
    ctx.textAlign = 'left'
    ctx.fillText(`FRAME ${String(Math.floor(time * 12) % 1000).padStart(3, '0')}`, 12, 172)
    ctx.textAlign = 'right'
    ctx.fillText('FOCUS · RENDERED', w - 12, 172)

    if (this.screenTexture) this.screenTexture.needsUpdate = true
  }

  /* ========================================================
     HUD
     ======================================================== */

  /**
   * `fail` and `finish` write the card the player is meant to read,
   * and `Minigame.update` publishes once more after `tick` returns.
   * Without this guard that last publish lands on the same frame and
   * replaces OUT OF ORDER — or COMPLETE — with the live progress.
   */
  protected publish(): void {
    if (!this.running) return
    super.publish()
  }

  protected lines(): string[] {
    const target = this.stations[this.reached]
    return [
      `${this.reached}/${STAGES.length}`,
      target ? `NEXT · ${target.label}` : 'RENDERING',
      this.hint(),
    ]
  }

  /** Kept short: the HUD centres these at up to 1.8 rem. */
  protected hint(): string {
    return 'SKIPPING RESETS'
  }

  protected progress(): number | null {
    return clamp(this.reached / STAGES.length, 0, 1)
  }
}

/* ============================================================
   GEOMETRY TESTS
   The same pair CircuitRace uses. They are duplicated rather than
   shared because the two games have no module between them worth
   creating for thirty lines of arithmetic.
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
