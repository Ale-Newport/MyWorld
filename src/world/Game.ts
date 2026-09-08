import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'

import { Bin } from './core/Disposal'
import { Events } from './core/Events'
import { Ticker } from './core/Ticker'
import { Tweens } from './core/Tween'
import { Viewport } from './core/Viewport'
import { Quality, probeDevice, type QualityPreference } from './core/Quality'
import { Inputs, ACTION_DEFINITIONS } from './input/Inputs'
import { Nipple } from './input/Nipple'
import { Physics } from './physics/Physics'
import { PhysicsVehicle } from './physics/PhysicsVehicle'
import { Player } from './player/Player'
import { View } from './view/View'
import { Renderer } from './render/Renderer'
import { Materials } from './world/materials'
import { Lighting } from './world/Lighting'
import { VisualVehicle } from './world/VisualVehicle'
import { World } from './world/World'
import { Ecology } from './world/Ecology'
import { Grass } from './world/Grass'
import { Water } from './world/Water'
import { Playground } from './world/Playground'
import { buildSceneryDetails } from './world/SceneryDetails'
import { Tracks } from './world/Tracks'
import { Particles } from './world/Particles'
import { Respawns } from './systems/Respawns'
import { Zones } from './systems/Zones'
import { Achievements } from './systems/Achievements'
import { InteractivePoints } from './systems/InteractivePoints'
import { Audio } from './systems/Audio'
import { Weather } from './systems/Weather'
import { Secrets } from './systems/Secrets'
import { Minigames } from './minigames/Minigame'
import { CircuitRace } from './minigames/CircuitRace'
import { Labyrinth } from './minigames/Labyrinth'
import { ChessPuzzle } from './minigames/ChessPuzzle'
import { VideoPipeline } from './minigames/VideoPipeline'
import { Retrieval } from './minigames/Retrieval'
import { OrderRush } from './minigames/OrderRush'
import { GymCircuit } from './minigames/GymCircuit'
import { ThreeBody } from './minigames/ThreeBody'
import { PacketRun } from './minigames/PacketRun'
import { Bowling } from './minigames/Bowling'
import { IslandChallenge } from './minigames/IslandChallenges'
import { AnimationStudio } from './world/districts/AnimationStudio'
import { VoxelField } from './world/districts/VoxelField'
import { LabInstallations } from './world/districts/LabInstallations'
import { Save } from './systems/Save'
import type { Terrain } from './world/Terrain'
import type { WorldStore } from './state/store'
import { districtById, landmarkById, resolvePanel, type DistrictId } from '@/content/world'

/* ============================================================
   THE GAME

   One instance per mount of the /world route. Owns a canvas, a
   physics world, a render loop and nothing outside itself: no
   module-level singletons, no globals, no listeners on anything
   it does not also remove.

   Upstream (`sources/Game/Game.js`) is a classic
   `Game.getInstance()` singleton, which is right for an app that
   owns its tab for life. It is wrong here — a visitor can open
   /world, go back to the portfolio and open it again, and a
   singleton would either leak the first world or refuse to build
   the second. Everything is instance-scoped and everything
   registers with `this.bin`.

   Construction order matters and is not alphabetical. Physics
   before the vehicle, the vehicle before the player, the view
   before the renderer, and the world last because it measures the
   terrain it sits on.
   ============================================================ */

export interface GameOptions {
  canvas: HTMLCanvasElement
  /** The element the viewport measures and pointer events bind to. */
  host: HTMLElement
  store: WorldStore
  /** Honours `prefers-reduced-motion` unless the visitor overrides it. */
  reducedMotion: boolean
}

export type GameEvent = 'ready' | 'districtEnter' | 'districtLeave' | 'interact'

export class Game {
  readonly bin = new Bin()
  readonly events = new Events<GameEvent>()

  readonly save: Save
  readonly quality: Quality
  readonly viewport: Viewport
  readonly ticker = new Ticker()
  readonly tweens: Tweens
  readonly inputs: Inputs
  readonly achievements: Achievements

  physics!: Physics
  view!: View
  renderer!: Renderer
  materials!: Materials
  world!: World
  ecology!: Ecology
  grass!: Grass
  water!: Water
  playground!: Playground
  lighting!: Lighting
  vehicle!: PhysicsVehicle
  player!: Player
  visualVehicle!: VisualVehicle
  respawns!: Respawns
  zones!: Zones
  interactions!: InteractivePoints
  audio!: Audio
  weather!: Weather
  secrets!: Secrets
  tracks!: Tracks
  particles!: Particles
  minigames!: Minigames
  nipple!: Nipple

  readonly store: WorldStore
  private host: HTMLElement
  private canvas: HTMLCanvasElement
  private raf = 0
  private running = false
  private destroyed = false
  private rapier!: typeof RAPIER

  reducedMotion: boolean

  constructor(options: GameOptions) {
    this.canvas = options.canvas
    this.host = options.host
    this.store = options.store
    this.reducedMotion = options.reducedMotion

    this.save = new Save()
    this.bin.add(() => this.save.destroy())

    const probe = probeDevice()
    if (probe.unsupported) {
      this.store.getState().setFatal(
        'This browser cannot start WebGL, so the interactive world will not run here. Everything it contains is on the main portfolio.',
      )
    }

    const preference: QualityPreference = this.save.data.settings.quality
    this.quality = new Quality(preference, probe)
    this.bin.add(() => this.quality.destroy())

    this.viewport = new Viewport(this.host, this.quality.pixelRatio)
    this.bin.add(() => this.viewport.destroy())

    this.tweens = new Tweens(this.ticker, this.bin)

    this.inputs = new Inputs(this.canvas)
    this.inputs.setOverrides(this.save.data.settings.bindings)
    this.inputs.add(ACTION_DEFINITIONS)
    if (probe.isTouch && probe.isMobile) this.inputs.assumeTouch()
    this.bin.add(() => this.inputs.destroy())

    this.achievements = new Achievements(this.save)
    this.bin.add(() => this.achievements.destroy())

    // Reduced motion is a stored override on top of the OS setting.
    const stored = this.save.data.settings.reducedMotion
    if (stored !== null) this.reducedMotion = stored

    this.store.getState().setQuality(this.quality.level, preference)
    this.store.getState().setAudio(this.save.data.settings.muted, this.save.data.settings.volume)
    this.store.getState().setReducedMotion(this.reducedMotion)
    this.store.getState().setOnboarding(!this.save.data.settings.onboarded)
    this.bin.add(() => this.ticker.destroy())
  }

  /* ========================================================
     BOOT
     ======================================================== */

  async init(): Promise<void> {
    const ui = this.store.getState()
    if (ui.fatal) return

    /* ---- physics ---------------------------------------- */
    // Rapier ships as WebAssembly and must be initialised before any
    // of its constructors exist. Dynamic import keeps its ~2 MB out
    // of every other route's bundle.
    const rapier = await import('@dimforge/rapier3d-compat')
    await rapier.init()
    if (this.destroyed) return
    this.rapier = rapier as unknown as typeof RAPIER

    this.physics = new Physics(this.rapier, this.ticker, this.bin)
    ui.setStep('physics', true)

    /* ---- view + renderer -------------------------------- */
    this.view = new View(
      this.ticker,
      this.viewport,
      this.inputs,
      this.physics,
      this.bin,
      this.quality.level === 'low',
    )
    this.view.reducedMotion = this.reducedMotion

    this.renderer = new Renderer(
      this.canvas,
      this.viewport,
      this.quality,
      this.ticker,
      this.view,
      this.bin,
    )

    this.materials = new Materials(this.bin)

    /* ---- world ------------------------------------------ */
    this.lighting = new Lighting(this.renderer, this.view, this.ticker, this.quality, this.bin)
    this.world = new World(this.physics, this.quality, this.materials, this.ticker, this.bin)
    this.renderer.scene.add(this.world.group)
    this.lighting.world = this.world
    ui.setStep('world', true)

    /* ---- vehicle ---------------------------------------- */
    this.respawns = new Respawns('hub')
    const spawn = this.respawns.getDefault()
    // Drop the car onto the actual ground rather than a guessed height.
    spawn.position.y = this.world.terrain.colliderHeightAt(spawn.position.x, spawn.position.z) + 3

    this.vehicle = new PhysicsVehicle(
      this.physics,
      this.ticker,
      this.bin,
      spawn.position,
      spawn.rotation,
    )

    this.nipple = new Nipple(this.tweens)
    this.renderer.scene.add(this.nipple.group)
    this.bin.add(() => this.nipple.destroy())

    this.player = new Player(
      this.inputs,
      this.vehicle,
      this.view,
      this.respawns,
      this.ticker,
      this.tweens,
      this.nipple,
      this.bin,
    )
    this.player.hydrate({
      distanceDriven: this.save.data.progress.distanceDriven,
      timePlayed: this.save.data.progress.timePlayed,
    })

    this.visualVehicle = new VisualVehicle(
      this.vehicle,
      this.player,
      this.inputs,
      this.physics,
      this.ticker,
      this.materials,
      this.bin,
      this.quality.settings.shadows,
    )
    this.visualVehicle.camera = this.view.camera
    this.renderer.scene.add(this.visualVehicle.group)
    ui.setStep('vehicle', true)

    /* ---- gameplay systems ------------------------------- */
    this.zones = new Zones(this.ticker, this.bin)
    this.interactions = new InteractivePoints(
      this.ticker, this.inputs, this.view, this.store, this.bin,
    )

    this.audio = new Audio(this.ticker, this.player, this.vehicle, this.save, this.bin)

    this.tracks = new Tracks(this.vehicle, this.ticker, this.quality, this.bin)
    this.renderer.scene.add(this.tracks.group)

    this.particles = new Particles(
      this.vehicle, this.player, this.ticker, this.quality, this.bin,
    )
    this.particles.boostEmitters = this.visualVehicle.trailEmitters
    this.renderer.scene.add(this.particles.group)

    this.weather = new Weather(
      this.ticker, this.view, this.renderer, this.lighting, this.quality, this.bin,
    )

    this.minigames = new Minigames(this, this.bin)
    this.player.onRespawnRequest = () => this.minigames.current?.recover() ?? false
    // Registration order is display order in nothing, but build order
    // in everything: each one raises its geometry here, on the world
    // that already exists.
    this.minigames.register(new CircuitRace(this, this.bin))
    this.minigames.register(new Labyrinth(this, this.bin))
    this.minigames.register(new ChessPuzzle(this, this.bin))
    this.minigames.register(new VideoPipeline(this, this.bin))
    this.minigames.register(new Retrieval(this, this.bin))
    this.minigames.register(new OrderRush(this, this.bin))
    this.minigames.register(new GymCircuit(this, this.bin))
    this.minigames.register(new ThreeBody(this, this.bin))
    this.minigames.register(new PacketRun(this, this.bin))
    this.startMinigame = (id) => this.minigames.start(id)
    this.water = new Water(this, this.bin)
    this.ecology = new Ecology(this, this.bin)

    // The grass field follows the camera, so it is created after the
    // view exists and updated in the same slot as the rest of the
    // vegetation (upstream runs Grass at tick order 10 too).
    this.grass = new Grass(this.world.terrain, this.quality, this.bin)
    this.renderer.scene.add(this.grass.group)
    {
      const fogColour = new THREE.Color()
      const follow = () => {
        this.grass.update(
          this.view.camera.position,
          this.player.position,
          this.weather.windDirection.clone().multiplyScalar(0.35 + this.weather.windStrength),
          this.ticker.elapsed,
        )
        // The grass runs its own fog — it is not a lit material — so it
        // has to be told what the sky is doing, or the far ring stays
        // the colour of a clear noon through a rainstorm.
        const fog = this.renderer.scene.fog as THREE.Fog | null
        if (fog) {
          fogColour.copy(fog.color).lerp(this.lighting.ambient.color, 0.18)
          this.grass.setFog(fogColour, fog.near * 0.55, fog.far * 0.92)
        }
      }
      this.ticker.events.on('tick', follow, 10)
      this.bin.add(() => this.ticker.events.off('tick', follow))
    }
    this.playground = new Playground(this, this.bin)
    new LabInstallations(this, this.bin)
    buildSceneryDetails(this, this.bin)
    this.minigames.register(new Bowling(this, this.bin))
    for (const id of ['debugDash', 'riverRun', 'chipRelay', 'domino', 'deployment'] as const) this.minigames.register(new IslandChallenge(this, this.bin, id))

    // District set pieces: places rather than games. They have no
    // completion state and nothing to cancel.
    new AnimationStudio(this, this.bin).build()
    new VoxelField(this, this.bin).build()

    // A timed run has to be comparable with the last one, so the
    // weather is held still for its duration.
    const circuit = this.minigames.get('circuit')
    if (circuit) {
      const onRaceStart = () => this.weather.lock('clear')
      const onRaceEnd = () => this.weather.unlock()
      circuit.events.on('start', onRaceStart as never)
      circuit.events.on('finish', onRaceEnd as never)
      circuit.events.on('cancel', onRaceEnd as never)
      this.bin.add(() => {
        circuit.events.off('start', onRaceStart as never)
        circuit.events.off('finish', onRaceEnd as never)
        circuit.events.off('cancel', onRaceEnd as never)
      })
    }

    this.bindLandmarks()
    this.bindDistricts()
    this.bindNotes()
    this.bindFrameLoopSystems()

    // Respawn points are authored before the things that end up
    // standing on them exist, so they check themselves against the
    // finished world and step aside where they have to.
    const moved = this.respawns.validate(
      (x, z) => this.world.terrain.colliderHeightAt(x, z),
      (x, z) => this.physics.groundAt(x, z, 90, 220),
    )
    if (process.env.NODE_ENV === 'development' && moved.length > 0) {
      console.info('[world] respawn points adjusted:\n  ' + moved.join('\n  '))
    }

    // Secrets last: it reaches into landmarks, zones and the vehicle,
    // all of which have to exist first.
    this.secrets = new Secrets(this, this.bin)
    this.bindUiActions()
    this.bindAchievementFeed()

    ui.setStep('projects', true)
    ui.setStep('audio', true)
    ui.setLoaded(true)

    this.renderer.precompile()

    if (process.env.NODE_ENV === 'development') {
      // A handle for the browser console during tuning. Never in production.
      ;(window as unknown as { __world?: Game }).__world = this
      this.bin.add(() => {
        delete (window as unknown as { __world?: Game }).__world
      })
    }

    this.events.trigger('ready')
    this.start()
  }

  /* ========================================================
     FRAME WIRING
     ======================================================== */

  private bindFrameLoopSystems(): void {
    // Order 0 on `frame`: sample devices once per rendered frame,
    // never per physics substep.
    const pollInputs = () => {
      this.inputs.update()
      this.nipple.update()
    }
    this.ticker.events.on('frame', pollInputs, 0)

    // Order 8 on `fixed`: the zone target must be the post-physics
    // position, or triggers fire a step late.
    const syncZones = () => {
      this.zones.setTarget(this.player.position)
      this.interactions.setTarget(this.player.position)
    }
    this.ticker.events.on('fixed', syncZones, 7)

    // Touch joystick needs the camera and viewport to unproject.
    const onPointerAction = (action: { name: string }) => {
      if (this.inputs.mode !== 'touch') return
      const orbit = this.inputs.actions.get('orbit')
      if (!orbit || action.name !== 'orbit') return
      this.nipple.updateFromPointer(this.inputs.pointer, orbit, this.view.defaultCamera, this.viewport)
    }
    this.inputs.events.on('orbit', onPointerAction as never)

    const onModeChange = (mode: string) => {
      this.store.getState().setInputMode(mode as never)
    }
    this.inputs.events.on('modeChange', onModeChange as never)

    // The mode may already have been decided in the constructor, from
    // the device probe, long before this listener existed. Push it
    // once so the touch controls appear without waiting for the
    // visitor to change input device.
    this.store.getState().setInputMode(this.inputs.mode)

    // Landing shake, scaled by how hard the impact was.
    const onLand = (airtime: number, wheels: number) => {
      if (airtime > 0.35) this.view.kick(Math.min(1, airtime * 0.9))
      if (wheels >= 2 && airtime > 0.25) this.achievements.set('takeoff', 1)
    }
    this.vehicle.events.on('land', onLand as never)

    const onCollision = (force: number) => {
      if (force > 24) this.view.kick(Math.min(1, force / 140))
    }
    this.vehicle.events.on('collision', onCollision as never)

    // The world is locked to daylight, so `nightFactor` now only ever
    // rises under heavy weather — which is exactly when headlights are
    // worth having, and what STORM SHIFT is now awarded for.
    const syncNight = () => {
      this.visualVehicle.nightFactor = Math.max(
        this.lighting.nightFactor,
        this.weather.rain * 0.75 + this.weather.snow * 0.5,
      )
      if (this.weather.rain > 0.45 && this.vehicle.speed > 1) {
        this.achievements.set('nightDrive', 1)
      }
    }
    this.ticker.events.on('tick', syncNight, 10)

    this.bin.add(() => {
      this.ticker.events.off('frame', pollInputs)
      this.ticker.events.off('fixed', syncZones)
      this.ticker.events.off('tick', syncNight)
      this.inputs.events.off('orbit', onPointerAction as never)
      this.inputs.events.off('modeChange', onModeChange as never)
      this.vehicle.events.off('land', onLand as never)
      this.vehicle.events.off('collision', onCollision as never)
    })
  }

  /* ========================================================
     LANDMARKS → INTERACTION
     ======================================================== */

  private bindLandmarks(): void {
    const opened = new Set(this.save.data.progress.landmarks)

    for (const handle of this.world.landmarks.values()) {
      const landmark = handle.landmark
      if (landmark.interaction === 'none') continue

      const label =
        landmark.interaction === 'minigame' ? 'START'
          : landmark.interaction === 'link' ? 'OPEN'
          : 'READ'

      this.interactions.add({
        id: landmark.id,
        position: new THREE.Vector3(
          landmark.x,
          this.world.terrain.colliderHeightAt(landmark.x, landmark.z),
          landmark.z,
        ),
        anchor: handle.anchor,
        radius: handle.radius,
        label,
        sublabel: landmark.label,
        onInteract: () => this.openLandmark(landmark.id),
      })
    }

    void opened
  }

  /** What ENTER does at a landmark. */
  openLandmark(id: string): void {
    const handle = this.world.landmarks.get(id)
    const landmark = handle?.landmark ?? landmarkById[id]
    if (!landmark) return

    if (landmark.interaction === 'link' && landmark.href) {
      window.open(landmark.href, '_blank', 'noopener,noreferrer')
      return
    }

    if (landmark.interaction === 'minigame' && landmark.minigame) {
      this.events.trigger('interact', [landmark.id, landmark.minigame])
      // Mini-games are registered by the Minigames system; if one is
      // not present the landmark still opens its panel, so a landmark
      // can never be a dead end.
      if (this.startMinigame?.(landmark.minigame)) return
    }

    // Everything else — projects, panels and notes — opens the same
    // overlay, rendered from the same content the scroll journey uses.
    if (resolvePanel(landmark)) {
      this.store.getState().setOverlay('panel', landmark.id)
      this.recordLandmark(landmark.id)
    }

    if (landmark.achievement) this.achievements.set(landmark.achievement, 1)
    if (landmark.secret) this.recordSecret(landmark.id)
  }

  /** Installed by the Minigames system. Returns true if it handled it. */
  startMinigame: ((id: string) => boolean) | null = null

  private recordLandmark(id: string): void {
    const list = this.save.data.progress.landmarks
    if (list.includes(id)) return
    list.push(id)
    this.save.schedule()

    this.achievements.set('projects', id)
    const handle = this.world.landmarks.get(id)
    if (handle?.landmark.district === 'archive') this.achievements.set('archivist', id)
  }

  recordSecret(id: string): void {
    const list = this.save.data.progress.secrets
    if (list.includes(id)) return
    list.push(id)
    this.save.schedule()
    this.achievements.set('curious', 1)
  }

  /* ========================================================
     DISTRICTS → DISCOVERY
     ======================================================== */

  private bindDistricts(): void {
    const visited = new Set(this.save.data.progress.districts)

    for (const district of Object.values(districtById)) {
      const y = this.world.terrain.colliderHeightAt(district.x, district.z)
      const zone = this.zones.create<DistrictId>(
        `district-${district.id}`,
        'cylinder',
        new THREE.Vector3(district.x, y, district.z),
        district.radius,
        district.id,
      )

      zone.events.on('enter', () => {
        this.store.getState().setDistrict(district.id)

        if (!visited.has(district.id)) {
          visited.add(district.id)
          this.save.data.progress.districts.push(district.id)
          this.save.schedule()

          // The toast only fires the first time. Being told where you
          // are on every lap is nagging, not navigation.
          this.store.getState().notify({
            kind: 'district',
            title: district.label,
            body: district.blurb,
            duration: 4,
          })

          if (district.signposted) this.achievements.set('explorer', district.id)
          if (district.secret) this.recordSecret(district.id)
        }
      })

      zone.events.on('leave', () => {
        if (this.store.getState().district === district.id) {
          this.store.getState().setDistrict(null)
        }
      })
    }
  }

  /* ========================================================
     DEV NOTES
     Driven over rather than interacted with, so finding one is
     a reward for wandering rather than another prompt to read.
     ======================================================== */

  private bindNotes(): void {
    const found = new Set(this.save.data.progress.notes)

    for (const note of this.world.notes) {
      if (found.has(note.id)) {
        note.found = true
        note.mesh.visible = false
        continue
      }

      const zone = this.zones.create(
        `note-${note.id}`,
        'cylinder',
        note.position,
        4.5,
        note.id,
      )
      zone.events.on('enter', () => {
        if (note.found) return
        note.found = true
        note.mesh.visible = false
        this.save.data.progress.notes.push(note.id)
        this.save.schedule()
        this.store.getState().notify({
          kind: 'note',
          title: 'DEV NOTE',
          body: note.text,
          duration: 6,
        })
        this.achievements.set('notes', note.id)
      })
    }

    // Spin the un-found markers so they read as collectable.
    const spin = () => {
      const t = this.ticker.elapsed
      for (const note of this.world.notes) {
        if (note.found) continue
        note.mesh.rotation.y = t * 0.9
        note.mesh.position.y = note.position.y + 1.6 + Math.sin(t * 2 + note.position.x) * 0.18
      }
    }
    this.ticker.events.on('tick', spin, 14)
    this.bin.add(() => this.ticker.events.off('tick', spin))
  }

  /**
   * The keys that open and close things. Deliberately separate from
   * the driving bindings: these actions carry no category, so the
   * `ui` filter cannot lock the visitor out of the menu that would
   * let them unlock it.
   */
  private bindUiActions(): void {
    const ui = () => this.store.getState()

    /** Toggles an overlay, or closes whatever is open. */
    const toggle = (kind: 'map' | 'achievements' | 'pause') => () => {
      const state = ui()
      if (state.overlay === kind) state.setOverlay(null)
      else state.setOverlay(kind)
    }

    const onMap = (action: { active: boolean }) => { if (action.active) toggle('map')() }
    const onAchievements = (action: { active: boolean }) => {
      if (action.active) toggle('achievements')()
    }
    const onPause = (action: { active: boolean }) => {
      if (!action.active) return
      const state = ui()
      // Escape always steps *out*: out of a panel, then out of the
      // menu. It should never be the key that opens a submenu.
      if (state.overlay && state.overlay !== 'pause') state.setOverlay('pause')
      else if (state.overlay === 'pause') state.setOverlay(null)
      else state.setOverlay('pause')
    }
    const onMute = (action: { active: boolean }) => {
      if (!action.active) return
      this.audio.setMuted(!this.audio.muted)
      ui().setAudio(this.audio.muted, this.audio.volume)
    }
    const onHelp = (action: { active: boolean }) => {
      if (action.active) toggle('pause')()
    }

    this.inputs.events.on('map', onMap as never)
    this.inputs.events.on('achievements', onAchievements as never)
    this.inputs.events.on('pause', onPause as never)
    this.inputs.events.on('mute', onMute as never)
    this.inputs.events.on('help', onHelp as never)

    // Being stuck is worth telling the player about: the car will
    // hop itself out, but they should know that is what is happening
    // and that R is faster.
    const onStuck = () => {
      this.store.getState().notify({
        kind: 'info',
        title: 'STUCK',
        body: 'Hopping it loose. Press R to respawn instead.',
        duration: 3,
      })
    }
    this.player.events.on('stuck', onStuck as never)
    this.bin.add(() => this.player.events.off('stuck', onStuck as never))

    const onInteractSound = () => this.audio?.play('interact')
    this.interactions.events.on('interact', onInteractSound as never)
    this.bin.add(() => this.interactions.events.off('interact', onInteractSound as never))

    // Any driving input dismisses the first-run card.
    const onFirstMove = () => {
      if (this.store.getState().onboarding) this.markOnboarded()
    }
    this.vehicle.events.on('start', onFirstMove as never)

    this.bin.add(() => {
      this.inputs.events.off('map', onMap as never)
      this.inputs.events.off('achievements', onAchievements as never)
      this.inputs.events.off('pause', onPause as never)
      this.inputs.events.off('mute', onMute as never)
      this.inputs.events.off('help', onHelp as never)
      this.vehicle.events.off('start', onFirstMove as never)
    })
  }

  private bindAchievementFeed(): void {
    const ui = this.store.getState()

    const onUnlock = (group: { definition: { label: string; hint: string } }) => {
      this.audio?.play('achievement')
      this.store.getState().notify({
        kind: 'achievement',
        title: group.definition.label,
        body: group.definition.hint,
        duration: 4.5,
      })
    }
    this.achievements.events.on('unlock', onUnlock as never)

    // First movement, boost, distance and time are cheap to watch here
    // rather than sprinkling calls through the vehicle.
    const onStart = () => this.achievements.set('firstDrive', 1)
    this.vehicle.events.on('start', onStart as never)

    const onFlip = (direction: number) => {
      this.achievements.set(direction > 0 ? 'frontflip' : 'backflip', 1)
    }
    this.vehicle.events.on('flip', onFlip as never)

    const onUpsideDown = (ratio: number) => {
      if (ratio > 0.75) this.achievements.set('upsideDown', 1)
    }
    this.vehicle.events.on('upsideDown', onUpsideDown as never)

    const onHonk = () => this.achievements.add('honk')
    this.player.events.on('honk', onHonk as never)

    const onHydraulics = (count: number, state: string) => {
      // Only the number-key lowrider bounce counts, not the jump.
      if (state === 'mid' && count > 0) this.achievements.add('hydraulics')
    }
    this.player.events.on('hydraulics', onHydraulics as never)

    const onDistance = (metres: number) => {
      this.save.data.progress.distanceDriven = metres
      this.save.schedule()
      this.achievements.set('distance', Math.floor(metres / 1000))
    }
    this.player.events.on('distance', onDistance as never)

    // A teleport must not leave a tyre mark spanning the map.
    const onPlayerRespawn = () => this.tracks?.reset()
    this.player.events.on('respawn', onPlayerRespawn as never)
    this.bin.add(() => this.player.events.off('respawn', onPlayerRespawn as never))

    const watchWorldFacts = () => {
      if (this.player.boosting > 0.5 && this.vehicle.speed > 6) {
        this.achievements.set('boosted', 1)
      }
      const elevation = this.player.position.y - this.world.terrain.colliderHeightAt(
        this.player.position.x,
        this.player.position.z,
      )
      this.player.elevation = elevation
      if (elevation > 3) this.achievements.set('goHigh', Math.floor(elevation))
      if (Math.hypot(this.player.position.x, this.player.position.z) > 360) {
        this.achievements.set('sea', 1)
      }
    }
    this.ticker.events.on('tick', watchWorldFacts, 11)

    void ui
    this.bin.add(() => {
      this.achievements.events.off('unlock', onUnlock as never)
      this.vehicle.events.off('start', onStart as never)
      this.vehicle.events.off('flip', onFlip as never)
      this.vehicle.events.off('upsideDown', onUpsideDown as never)
      this.player.events.off('honk', onHonk as never)
      this.player.events.off('hydraulics', onHydraulics as never)
      this.player.events.off('distance', onDistance as never)
      this.ticker.events.off('tick', watchWorldFacts)
    })
  }

  /* ========================================================
     LOOP
     ======================================================== */

  start(): void {
    if (this.running || this.destroyed) return
    this.running = true
    const loop = (now: number) => {
      if (!this.running) return
      this.raf = requestAnimationFrame(loop)
      this.ticker.update(now)
      this.quality.governor(now)
      this.save.data.progress.timePlayed = this.player?.timePlayed.all ?? 0
    }
    this.raf = requestAnimationFrame(loop)

    // A hidden tab must not accumulate a physics debt, and must not
    // leave the throttle held down when the visitor tabs away.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        this.inputs.releaseAll()
        this.pause()
      } else if (this.store.getState().overlay === null) {
        this.resume()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    this.bin.add(() => document.removeEventListener('visibilitychange', onVisibility))

    const onPageHide = () => this.save.flush()
    window.addEventListener('pagehide', onPageHide)
    this.bin.add(() => window.removeEventListener('pagehide', onPageHide))
  }

  pause(): void {
    if (!this.running) return
    this.running = false
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.inputs.releaseAll()
    this.save.flush()
  }

  resume(): void {
    if (this.running || this.destroyed) return
    this.running = true
    // Re-seed the clock so the first frame back is not a giant delta.
    const loop = (now: number) => {
      if (!this.running) return
      this.raf = requestAnimationFrame(loop)
      this.ticker.update(now)
      this.quality.governor(now)
    }
    this.raf = requestAnimationFrame(loop)
  }

  /* ========================================================
     SETTINGS
     ======================================================== */

  setQualityPreference(preference: QualityPreference): void {
    this.quality.setPreference(preference)
    this.save.data.settings.quality = preference
    this.save.schedule()
    this.store.getState().setQuality(this.quality.level, preference)
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value
    this.view.reducedMotion = value
    this.save.data.settings.reducedMotion = value
    this.save.schedule()
    this.store.getState().setReducedMotion(value)
  }

  /** Called from the loader's ENTER, which is the required gesture. */
  enableAudio(): void {
    this.audio?.resume()
  }

  setMuted(muted: boolean): void {
    this.audio?.setMuted(muted)
    this.store.getState().setAudio(muted, this.audio?.volume ?? 0.7)
  }

  setVolume(volume: number): void {
    this.audio?.setVolume(volume)
    this.store.getState().setAudio(this.audio?.muted ?? false, volume)
  }

  /** Puts every prop back where it started. */
  resetObjects(): void {
    this.minigames?.resetAll()
    this.world?.resetObjects()
    this.playground?.reset()
  }

  markOnboarded(): void {
    if (this.save.data.settings.onboarded) return
    this.save.data.settings.onboarded = true
    this.save.schedule()
    this.store.getState().setOnboarding(false)
  }

  get terrain(): Terrain {
    return this.world.terrain
  }

  /** Live values the HUD samples on its own rAF. */
  readonly telemetry = {
    speed: 0,
    position: new THREE.Vector3(),
    heading: 0,
    fps: 60,
  }

  sampleTelemetry(): typeof this.telemetry {
    this.telemetry.speed = this.vehicle ? this.vehicle.speedKmh : 0
    if (this.player) this.telemetry.position.copy(this.player.position)
    this.telemetry.heading = this.player?.rotationY ?? 0
    this.telemetry.fps = this.ticker.fps
    return this.telemetry
  }

  /* ========================================================
     TEARDOWN
     ======================================================== */

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.running = false
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.events.clear()
    this.bin.dispose()
  }
}
