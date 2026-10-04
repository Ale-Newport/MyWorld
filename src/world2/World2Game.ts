import * as THREE from 'three'
import { Bin } from '@/world/core/Disposal'
import { Ticker } from '@/world/core/Ticker'
import { Tweens } from '@/world/core/Tween'
import { Viewport } from '@/world/core/Viewport'
import { Quality, probeDevice } from '@/world/core/Quality'
import { Inputs, ACTION_DEFINITIONS } from '@/world/input/Inputs'
import { Nipple } from '@/world/input/Nipple'
import { Physics, type Physical } from '@/world/physics/Physics'
import { PhysicsVehicle } from '@/world/physics/PhysicsVehicle'
import { Player } from '@/world/player/Player'
import { Respawns } from '@/world/systems/Respawns'
import { View } from '@/world/view/View'
import { Renderer } from '@/world/render/Renderer'
import { Lighting } from '@/world/world/Lighting'
import { Materials } from '@/world/world/materials'
import { VisualVehicle } from '@/world/world/VisualVehicle'
import { Tracks } from '@/world/world/Tracks'
import { Particles } from '@/world/world/Particles'
import { Audio } from '@/world/systems/Audio'
import { Save } from '@/world/systems/Save'
import { World2Environment } from './World2Environment'
import { World2Grass } from './World2Grass'
import { Interactions, reservedNames } from './interactions/Interactions'
import type { World2Interactions } from './interactions/references'
import { EMPTY_GAMEPLAY, type World2Manifest, type World2Status } from './types'

/** Shared settings may seed the controls; all writes belong to World2. */
class World2Save extends Save {
  constructor() {
    super()
    try {
      const saved = JSON.parse(localStorage.getItem('alejandro-world2-settings-v1') ?? 'null')
      if (saved) {
        this.data.settings.muted = typeof saved.muted === 'boolean' ? saved.muted : true
        this.data.settings.volume = typeof saved.volume === 'number' ? Math.min(1, Math.max(0, saved.volume)) : .5
      }
    } catch { /* Unavailable storage does not block driving. */ }
  }
  override schedule(): void { this.flush() }
  override flush(): void {
    try { localStorage.setItem('alejandro-world2-settings-v1', JSON.stringify({ muted: this.data.settings.muted, volume: this.data.settings.volume })) } catch { /* Private mode. */ }
  }
}

export class World2Game {
  readonly bin = new Bin()
  readonly ticker = new Ticker()
  readonly abort = new AbortController()
  readonly status: World2Status = { ready: false, progress: 0, loading: 'Loading the Blender level', fatal: null, entered: false, paused: false, map: false, help: false, muted: true, touch: false, speed: 0, area: 'landing', interaction: null, achievementsOpen: false, topDown: false, colliders: false, fps: 60, drawCalls: 0, position: [0, 0, 0], heading: 0, gameplay: EMPTY_GAMEPLAY }
  readonly inputs: Inputs
  readonly quality: Quality
  readonly viewport: Viewport
  readonly tweens: Tweens
  readonly save = new World2Save()
  physics!: Physics
  view!: View
  renderer!: Renderer
  environment!: World2Environment
  manifest!: World2Manifest
  vehicle!: PhysicsVehicle
  player!: Player
  respawns!: Respawns
  visualVehicle!: VisualVehicle
  nipple!: Nipple
  audio!: Audio
  lighting!: Lighting
  tracks!: Tracks
  interactions!: Interactions
  grass!: World2Grass
  private running = false
  private destroyed = false
  private raf = 0
  private lastStatus = 0
  private lastGameplay = 0
  private lastGameplaySignature = ''
  private volume = .5
  private readonly topCamera = new THREE.OrthographicCamera(-100, 100, 100, -100, .1, 1000)

  constructor(private canvas: HTMLCanvasElement, host: HTMLElement, private publish: (status: World2Status) => void) {
    const probe = probeDevice()
    if (probe.unsupported) throw new Error('WebGL is unavailable. You can still explore the main portfolio.')
    this.quality = new Quality('auto', probe); this.bin.add(() => this.quality.destroy())
    this.viewport = new Viewport(host, this.quality.pixelRatio); this.bin.add(() => this.viewport.destroy())
    this.bin.add(() => this.ticker.destroy())
    this.tweens = new Tweens(this.ticker, this.bin)
    this.inputs = new Inputs(canvas); this.inputs.setOverrides(this.save.data.settings.bindings); this.inputs.add(ACTION_DEFINITIONS)
    // Board navigation exists only in World2, so it is declared here rather
    // than in the shared binding table that /world also reads.
    this.inputs.add([
      { name: 'boardPrevious', label: 'Previous project', categories: ['minigame'], keys: ['Keyboard.ArrowLeft', 'Keyboard.KeyA', 'Gamepad.left', 'Touch.previous'] },
      { name: 'boardNext', label: 'Next project', categories: ['minigame'], keys: ['Keyboard.ArrowRight', 'Keyboard.KeyD', 'Gamepad.right', 'Touch.next'] },
    ])
    if (probe.isTouch && probe.isMobile) this.inputs.assumeTouch()
    this.inputs.keyboard.capture = false; this.inputs.setFilters(['ui'])
    this.bin.add(() => this.inputs.destroy()); this.bin.add(() => this.abort.abort())
    this.status.muted = this.save.data.settings.muted; this.volume = this.save.data.settings.volume
    this.bin.add(() => this.save.destroy())
  }

  private update(patch: Partial<World2Status>): void {
    if (this.destroyed) return
    Object.assign(this.status, patch)
    this.publish({ ...this.status })
  }

  async init(): Promise<void> {
    const response = await fetch('/world2/world-manifest.json', { signal: this.abort.signal })
    if (!response.ok) throw new Error('The Blender export is missing. Run npm run world2:export.')
    this.manifest = await response.json()
    if (this.destroyed) return
    // Scene first, before physics and car: no procedural fallback map.
    this.environment = new World2Environment(this.manifest, this.bin)
    await this.environment.load(this.manifest.models[0], this.abort.signal, r => this.update({ progress: r * 45 }))
    if (this.destroyed) return
    this.update({ progress: 48, loading: 'Preparing the original driving engine' })
    const rapier = await import('@dimforge/rapier3d-compat')
    await rapier.init()
    if (this.destroyed) return
    this.physics = new Physics(rapier, this.ticker, this.bin)
    this.view = new View(this.ticker, this.viewport, this.inputs, this.physics, this.bin, this.quality.level === 'low')
    this.view.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
    this.renderer = new Renderer(this.canvas, this.viewport, this.quality, this.ticker, this.view, this.bin)
    this.renderer.instance.info.autoReset = false
    this.renderer.scene.add(this.environment.group)
    this.lighting = new Lighting(this.renderer, this.view, this.ticker, this.quality, this.bin)
    this.lighting.duration = 0
    // The gameplay layer owns some authored bodies; claim them before the
    // level builds its own, or a crate becomes static scenery.
    for (const name of reservedNames(this.environment.nodes)) this.environment.reserved.add(name)
    this.environment.addPhysics(this.physics, this.ticker)
    // Prime Rapier's spatial query pipeline before validating spawns.
    this.physics.world.step()
    this.respawns = new Respawns(this.manifest.spawn, [])
    for (const point of this.manifest.spawns) {
      const [x, sourceY, z] = point.position
      const surface = this.physics.groundAt(x, z, sourceY + 4, 100)
      if (surface === null) throw new Error(`No imported surface below ${point.name}`)
      this.respawns.add({ name: point.name, position: new THREE.Vector3(x, surface + 2.2, z), rotation: point.rotation })
    }
    const spawn = this.respawns.getDefault()
    this.vehicle = new PhysicsVehicle(this.physics, this.ticker, this.bin, spawn.position, spawn.rotation)
    this.nipple = new Nipple(this.tweens); this.renderer.scene.add(this.nipple.group); this.bin.add(() => this.nipple.destroy())
    this.player = new Player(this.inputs, this.vehicle, this.view, this.respawns, this.ticker, this.tweens, this.nipple, this.bin)
    this.tuneHandling()
    const materials = new Materials(this.bin)
    this.visualVehicle = new VisualVehicle(this.vehicle, this.player, this.inputs, this.physics, this.ticker, materials, this.bin, this.quality.settings.shadows)
    this.visualVehicle.camera = this.view.camera; this.renderer.scene.add(this.visualVehicle.group)
    this.tracks = new Tracks(this.vehicle, this.ticker, this.quality, this.bin); this.renderer.scene.add(this.tracks.group)
    const particles = new Particles(this.vehicle, this.player, this.ticker, this.quality, this.bin)
    particles.boostEmitters = this.visualVehicle.trailEmitters; this.renderer.scene.add(particles.group)
    this.audio = new Audio(this.ticker, this.player, this.vehicle, this.save, this.bin)
    const interactionsResponse = await fetch('/world2/interactions.json', { signal: this.abort.signal })
    if (!interactionsResponse.ok) throw new Error('The Blender interaction references are missing. Run node scripts/gen-world2-interactions.mjs.')
    const interactionData = (await interactionsResponse.json()) as World2Interactions
    if (this.destroyed) return
    this.interactions = new Interactions(this, interactionData)
    // Batch what is left over: everything gameplay did not claim above.
    this.environment.batchScenery(this.interactions.references.touched)
    this.bind()
    this.update({ progress: 65, loading: 'Loading Blender vegetation' })
    await this.environment.load(this.manifest.models[1], this.abort.signal, r => this.update({ progress: 65 + r * 30 }))
    if (this.destroyed) return
    this.environment.addVegetationPhysics()
    this.grass = new World2Grass(this.environment.group, this.ticker, this.bin)
    this.renderer.precompile()
    this.update({ ready: true, progress: 100, loading: 'Ready to drive', touch: this.inputs.mode === 'touch' })
    if (process.env.NODE_ENV === 'development') {
      const target = window as unknown as { __world2?: World2Game }
      target.__world2 = this
      this.bin.add(() => { if (target.__world2 === this) delete target.__world2 })
    }
    this.start()
  }

  /*
    HANDLING, FOR THIS ISLAND ONLY

    The shared vehicle ships `frictionSlip: 0.9`, which on this level reads as
    a car that pushes wide and keeps sliding. `surfaceFriction` is the hook the
    vehicle already exposes for exactly this, and `frictionSlip` is the ONLY
    lever it has: Rapier's raycast vehicle never reads the ground collider's
    own friction coefficient, so sweeping the road's 0.7 changes nothing.

    An earlier round raised it everywhere to 1.9 and stopped there, on a
    reading that grip "plateaus above about 2". That reading was an artefact —
    it measured a FINAL heading, which wraps at 180 degrees, and 171 was nine
    degrees short of the fold. Measured again with yaw accumulated per step,
    the steady-state full-lock radius is 4.26 m at 1.9, 3.80 at 3.0, 3.52 at
    4.0 and 3.49 from 5 upward: the plateau is at four to five, not two. Roll
    never passes 3.2 degrees anywhere in that sweep, because the chassis centre
    of mass is pinned half a metre low, so the usual reason to keep grip down
    does not apply to this car.

    So the circuit — the one surface built to be driven hard — gets 4.0, and
    the rest of the island keeps 1.9, which suits grass and sand. The tag comes
    from Blender: the exporter puts every road, ramp and bridge in the `roads`
    category. BOTH halves of the tarmac have to carry it, because the level
    ships the track twice — `refRoad`, the visible ribbon, and
    `refRoadPhysicalFixed`, thirteen slabs whose top face is at exactly the
    same height — and the wheel ray swaps between them several times a second.
    Tagging one and not the other makes the grip flicker at walking pace.

    `idleBrake` and the chassis damping are raised alongside: at stock values
    the car crept at about 1.4 km/h with nothing pressed and carried too much
    of a collision through.

    THE BOOST WHEELIE, which is a different complaint with the same symptom.
    The engine force is applied at each wheel's contact patch, and those sit
    below the centre of mass, so hard acceleration pitches the nose up. At the
    stock boost that is not a lean — it is a launch. Measured over a
    1.2-second standing start on flat tarmac, repeated three times a run and
    reproducible to the percent:

      multiplier 2,   ceiling 40 : nose 12.4 degrees up, a FRONT WHEEL OFF
                                   THE GROUND 65 % of the time, 191 km/h
      multiplier 0.8, ceiling 22 : 19 % of the time
      multiplier 0.6, ceiling 22 : nose 10.3 degrees, front wheels down
                                   100 % of the time, 145 km/h

    The front pair are the only wheels this vehicle steers, and a wheel with
    nothing under it transmits neither engine force nor brake — so for
    two-thirds of a boost the car went where it was already going and the
    pedals did nothing. That is the "keeps its momentum, carries straight on,
    loses the pedals for a few thousandths" this reads as from the driver's
    seat. Over a whole 2.5-second straight and into the first corner it falls
    from 51 % contactless to 10 %, and what is left is the car genuinely
    flying over kerbs at 168 km/h, which is the track doing its job.

    Note what is NOT the cause, because both were measured and neither is:
    grip (0 % lift at 0.9, 1.9 and 4.0 with no boost) and the doubled road
    surface (80-odd collider swaps per five seconds between the ribbon and the
    slabs under it, and not one frame of lost contact).

    0.6 is the floor, not a taste: below it the car can no longer clear the
    authored ramp. Driven the way `scripts/world2-qa.mjs` drives it — from a
    standing start four metres short, throttle and boost held — it lands 9.8 m
    past the far edge at 0.6 and 0.7 m SHORT at 0.4. The ceiling sets how far
    past: 19.1 m at the upstream values, 9.8 m here, against the metre the
    check asks for.

    Lowering the multiplier costs less speed than it looks like it should,
    because a car up on its back wheels is putting its engine into rotation
    instead of into the road.

    Every one of these is an instance property of THIS game's vehicle. `/world`
    constructs its own and is untouched.
  */
  private tuneHandling(): void {
    const ROAD_GRIP = 4, ISLAND_GRIP = 1.9
    // Resolved once, here, because the hook fires four times per fixed step.
    // Keyed on the Physical rather than on a collider handle: Rapier recycles
    // freed handles, and this world removes bodies while it runs.
    const grip = new Map<Physical, number>()
    for (const [node, physical] of this.environment.physicals) {
      if (node.userData.w2Category === 'roads') grip.set(physical, ROAD_GRIP)
    }
    for (const physical of this.physics.physicals) {
      // The fallback trimeshes the environment fits to un-bodied scenery carry
      // the authored name but no node, so they are matched by it.
      if (typeof physical.owner === 'string' && this.environment.nodes.get(physical.owner)?.userData.w2Category === 'roads') {
        grip.set(physical, ROAD_GRIP)
      }
    }
    this.vehicle.surfaceFriction = collider => {
      if (!collider) return ISLAND_GRIP
      const body = collider.parent()
      const physical = (body?.userData as { physical?: Physical } | undefined)?.physical
      return (physical && grip.get(physical)) ?? ISLAND_GRIP
    }
    this.vehicle.idleBrake = 0.14
    this.vehicle.chassis.physical.linearDamping = 0.18
    // Boost is force AND ceiling. The force is what lifts the nose, so it
    // comes down hard; the ceiling is what makes boost worth pressing, so it
    // only comes down enough to stop the car outrunning its own track.
    this.vehicle.boostMultiplier = 0.6
    this.vehicle.topSpeedBoost = 22
    this.lowerCentreOfMass()
  }

  /*
    AND THE OTHER HALF OF THE SAME FAULT: WHERE THE WEIGHT SITS

    The chassis carries its centre of mass 0.5 m under the body origin, and
    the shared vehicle's comment says the low centre is what stops it flipping
    on every kerb. True — and it is not low enough for a level with a circuit
    on it. The lever the engine force turns the car about is the distance from
    the contact patch UP to the centre of mass, so dropping the centre
    shortens it, and the same throttle that used to lift the nose now pushes
    the car along.

    Measured over the same standing start, with this world's boost:

      centre of mass -0.5 : a front wheel off 27 % of the time, nose to 87.5
                            degrees, stops from 145 km/h in 12.1 m
      centre of mass -0.7 : 21 %, 7.1 degrees, 9.8 m
      centre of mass -0.8 : 0 %, 4.6 degrees, 7.3 m

    The 87.5 degrees is not a typo and not the throttle: it is the BRAKE.
    A car whose weight is high stands on its nose when you stop it, which
    lifts the driven wheels off the road and is the other way this reads as
    "the pedals cut out". At -0.8 the same stop stays inside five degrees.

    Nothing else it touches gets worse: full-lock yaw over two seconds goes
    from 413 to 436 degrees, peak roll from 3.9 to 0.6 degrees, and the
    hydraulic jump clears the same 1.78 m. The one cost is self-righting from
    the roof, which takes 26 frames instead of 16 — still automatic, just less
    eager, which is the honest price of a car that no longer wants to tip.
  */
  private lowerCentreOfMass(): void {
    const collider = this.vehicle.chassis.physical.body.collider(0)
    if (!collider) return
    // Same mass, same inertia; only the centre moves. Passing the collider's
    // own mass back keeps this a one-axis change rather than a re-tune.
    collider.setMassProperties(
      collider.mass(),
      { x: 0, y: -0.8, z: 0 },
      { x: 1, y: 1, z: 1 },
      { x: 0, y: 0, z: 0, w: 1 },
    )
  }

  private bind(): void {
    const poll = () => { this.renderer.instance.info.reset(); this.inputs.update(); this.nipple.update() }
    this.ticker.events.on('frame', poll, 0)
    const touch = (action: { name: string }) => {
      if (this.inputs.mode === 'touch' && action.name === 'orbit' && this.status.entered && !this.status.paused && !this.status.map) {
        const orbit = this.inputs.actions.get('orbit')!
        this.nipple.updateFromPointer(this.inputs.pointer, orbit, this.view.defaultCamera, this.viewport)
      }
    }
    this.inputs.events.on('orbit', touch as never)
    const land = (airtime: number) => { if (airtime > .35) this.view.kick(Math.min(1, airtime * .9)) }
    const impact = (force: number) => { if (force > 24) this.view.kick(Math.min(1, force / 140)) }
    this.vehicle.events.on('land', land as never); this.vehicle.events.on('collision', impact as never)
    const reset = () => {
      this.inputs.releaseAll(); this.player.accelerating = 0; this.player.boosting = 0; this.player.steering = 0; this.player.braking = 0
      this.player.suspensions.fill('low'); this.vehicle.input.accelerating = 0; this.vehicle.input.boosting = 0; this.vehicle.input.braking = 0; this.vehicle.input.steering = 0
      this.vehicle.wheels.inContactCount = 0; this.vehicle.wheels.justTouchedCount = 0
      for (const wheel of this.vehicle.wheels.items) { wheel.inContact = false; wheel.contactPoint = null; wheel.contactNormal = null; wheel.groundCollider = null; wheel.rotation = 0; wheel.sideImpulse = 0; wheel.forwardImpulse = 0; wheel.suspensionLength = 0; wheel.suspensionState = 'low' }
      this.tracks.reset()
    }
    this.player.events.on('respawn', reset)
    // A mini-game that owns the car decides where "reset" puts it back.
    this.player.onRespawnRequest = () => this.interactions?.respawn() ?? false
    const action = (name: string, fn: () => void) => {
      const listener = (a: { active: boolean }) => { if (a.active) fn() }
      this.inputs.events.on(name, listener as never); this.bin.add(() => this.inputs.events.off(name, listener as never))
    }
    action('map', () => this.toggleMap()); action('mute', () => this.toggleMute()); action('achievements', () => this.toggleAchievements())
    action('pause', () => { if (this.interactions?.busy) { this.interactions.exitActivity(); return } this.setPaused(!this.status.paused) }); action('help', () => this.toggleHelp())
    action('interact', () => this.interact())
    const telemetry = () => {
      const p = this.player.position, ground = this.environment.terrainHeightAt(p.x, p.z)
      this.player.elevation = Number.isFinite(ground) ? p.y - ground : 0
      const b = this.manifest.bounds
      if (p.y < b.min[1] - 12 || p.x < b.min[0] - 5 || p.x > b.max[0] + 5 || p.z < b.min[2] - 5 || p.z > b.max[2] + 5) this.player.respawn()
      if (this.ticker.elapsed - this.lastStatus > .15) {
        this.lastStatus = this.ticker.elapsed
        this.publishGameplay()
        this.update({ speed: this.vehicle.speedKmh, position: p.toArray(), heading: this.player.rotationY, area: this.environment.currentArea(p), touch: this.inputs.mode === 'touch', fps: this.ticker.fps, drawCalls: this.renderer.instance.info.render.calls })
      }
    }
    this.ticker.events.on('tick', telemetry, 1001)
    // Dev top-view changes only the render camera; the chase controller stays intact.
    const topView = () => {
      if (!this.status.topDown) return
      const b = this.manifest.bounds, width = b.max[0] - b.min[0], height = b.max[2] - b.min[2]
      const halfHeight = Math.max(height / 2, width / (2 * this.viewport.ratio)) + 7
      this.topCamera.left = -halfHeight * this.viewport.ratio; this.topCamera.right = halfHeight * this.viewport.ratio
      this.topCamera.top = halfHeight; this.topCamera.bottom = -halfHeight
      this.topCamera.position.set((b.min[0] + b.max[0]) / 2, 250, (b.min[2] + b.max[2]) / 2)
      this.topCamera.up.set(0, 0, -1); this.topCamera.lookAt(this.topCamera.position.x, 0, this.topCamera.position.z); this.topCamera.updateProjectionMatrix()
      const fog = this.renderer.scene.fog; this.renderer.scene.fog = null
      this.renderer.instance.setRenderTarget(null); this.renderer.instance.render(this.renderer.scene, this.topCamera)
      this.renderer.scene.fog = fog
    }
    this.ticker.events.on('tick', topView, 999)
    this.bin.add(() => { this.ticker.events.off('frame', poll); this.inputs.events.off('orbit', touch as never); this.vehicle.events.off('land', land as never); this.vehicle.events.off('collision', impact as never); this.player.events.off('respawn', reset); this.ticker.events.off('tick', telemetry); this.ticker.events.off('tick', topView) })
    this.bin.listen(document, 'visibilitychange', () => {
      if (document.hidden) { this.stop(); this.audio.setVolume(0) }
      else { this.audio.setVolume(this.volume); this.start() }
    })
    const contextLost = (event: Event) => { event.preventDefault(); this.stop(); this.inputs.keyboard.capture = false; this.audio.setVolume(0); this.update({ fatal: 'The graphics context was lost. Reload to restart World2.' }) }
    this.canvas.addEventListener('webglcontextlost', contextLost)
    this.bin.add(() => this.canvas.removeEventListener('webglcontextlost', contextLost))
  }

  enter(): void {
    if (!this.status.ready) return
    this.audio.resume(); this.update({ entered: true }); this.setPaused(false)
    this.canvas.focus()
  }
  setPaused(paused: boolean): void {
    if (!this.status.entered) return
    this.inputs.releaseAll(); this.inputs.setFilters(paused ? ['ui'] : ['driving', 'camera']); this.inputs.keyboard.capture = !paused
    this.player.setState(paused ? 'locked' : 'default'); this.nipple.group.visible = !paused && this.inputs.mode === 'touch'
    this.update({ paused, map: false, help: false, interaction: null, achievementsOpen: paused ? this.status.achievementsOpen : false })
  }
  toggleMap(): void { if (!this.status.entered) return; const map = !this.status.map; this.setPaused(map); this.update({ map }) }
  /**
   * Drops the car at an authored area anchor and closes the map. The landing
   * spot is the nearest authored respawn to that anchor, so the car always
   * arrives on ground the level meant to be stood on rather than inside a
   * building that happens to sit on the marker.
   */
  travelTo(area: string): void {
    if (!this.status.entered) return
    const anchor = this.environment.areas.find(item => item.name === area)
    if (!anchor) return
    let best: { name: string; distance: number } | null = null
    for (const [name, point] of this.respawns.items) {
      const distance = point.position.distanceTo(anchor.position)
      if (!best || distance < best.distance) best = { name, distance }
    }
    // An activity must not keep the controls once the player has left.
    if (this.interactions?.busy) this.interactions.exitActivity()
    this.setPaused(false)
    this.player.respawn(best?.name ?? null)
    this.audio?.play('interact')
  }
  toggleHelp(): void { if (!this.status.entered) return; const help = !this.status.help; this.setPaused(help); this.update({ help }) }
  toggleAchievements(): void {
    if (!this.status.entered) return
    const open = !this.status.achievementsOpen
    this.setPaused(open)
    this.update({ achievementsOpen: open })
    this.publishGameplay(true)
  }
  toggleMute(): void { this.audio?.setMuted(!this.status.muted); this.update({ muted: !this.status.muted }) }
  interact(): void {
    if (!this.status.entered || this.status.paused) return
    // A world prompt in range always wins; the area card is the fallback.
    if (this.interactions?.interact()) return
    // While an activity owns the controls its own bindings handle the key.
    // Without this, pressing interact inside the projects board dropped the
    // area card on top of it.
    if (this.interactions?.busy) return
    if (this.status.area === 'open road') return
    const name = this.status.area; this.setPaused(true); this.update({ interaction: name })
  }
  /**
   * Republishes the gameplay half of the status. Throttled, because the
   * React tree compares by reference and a countdown ticking at 60 Hz would
   * re-render the whole overlay sixty times a second.
   */
  publishGameplay(force = false): void {
    if (!this.interactions || this.destroyed) return
    const now = this.ticker.elapsed
    // `force` is for state changes — an activity ending, a panel opening.
    // Without it the throttle can swallow the last publish and leave the
    // HUD showing a race that finished, or an empty achievements list.
    if (!force && now - this.lastGameplay < .05) return
    this.lastGameplay = now
    const next = this.interactions.gameplay()
    // React compares this object by reference, so republishing an identical
    // HUD re-rendered the whole overlay twenty times a second for nothing.
    const signature = this.interactions.signature(next)
    if (!force && signature === this.lastGameplaySignature) return
    this.lastGameplaySignature = signature
    this.update({ gameplay: next })
  }
  toggleTopDown(): void { if (process.env.NODE_ENV === 'development') this.update({ topDown: !this.status.topDown }) }
  toggleColliders(): void { if (process.env.NODE_ENV !== 'development') return; const value = !this.status.colliders; this.environment.showColliders(value); this.update({ colliders: value }) }
  private start(): void {
    if (this.running || this.destroyed || !this.status.ready) return
    this.running = true
    const loop = (now: number) => { if (!this.running) return; this.raf = requestAnimationFrame(loop); this.ticker.update(now); this.quality.governor(now) }
    this.raf = requestAnimationFrame(loop)
  }
  private stop(): void { this.running = false; cancelAnimationFrame(this.raf); this.inputs.releaseAll() }
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true; this.save.data.settings.volume = this.volume; this.stop(); this.abort.abort(); this.environment?.restoreMaterials(); this.bin.dispose()
  }
}
