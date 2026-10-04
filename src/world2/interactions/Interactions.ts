import * as THREE from 'three'
import type { World2Game } from '../World2Game'
import type { World2Interactions } from './references'
import { References } from './references'
import { Prompts } from './Prompts'
import { Explosions } from './Explosions'
import { ExplosiveCrates } from './ExplosiveCrates'
import { Achievements } from './Achievements'
import { Circuit } from './Circuit'
import { Bowling } from './Bowling'
import { Title } from './Title'
import { Career } from './Career'
import { Projects } from './Projects'
import { Social } from './Social'
import { Places } from './Places'
import { Blackboards } from './Blackboards'
import { RETIRED } from './Social'
import type { World2Gameplay } from '../types'

/* ============================================================
   THE INTERACTION LAYER

   The map, the car, the camera and the physics already work.
   This is the layer that makes the map DO something: it resolves
   the authored Blender objects, hands each one to the controller
   that owns its behaviour, and owns the lifetimes so leaving the
   route leaves nothing running.

   Nothing in here places geometry. Every position, rotation and
   collider comes out of folio-2025.blend.
   ============================================================ */

/**
 * Authored names whose physics this layer builds itself, resolved before
 * `World2Environment.addPhysics` runs so the level does not build a static
 * collider where a mini-game needs a dynamic or kinematic one.
 */
export function reservedNames(nodes: Map<string, THREE.Object3D>): string[] {
  const reserved: string[] = []
  for (const name of nodes.keys()) {
    // The title letters spell someone else's name; ours replace them.
    if (name.startsWith('refLettersPhysicalDynamic')) reserved.push(name)
    // Crates must be light dynamic bodies, not static scenery.
    else if (name.startsWith('explosiveCrates')) reserved.push(name)
    // One authored pin template stands in for ten placed pins.
    else if (name === 'refPinPhysicalDynamic' || name === 'refBallPhysicalDynamic') reserved.push(name)
    // `refCookie` is the same kind of thing: the mould every cookie the oven
    // hands out is pressed from. Left alone it is a metre-wide disc hanging in
    // the air over the counter, and the environment's fallback pass fits a
    // static trimesh to it — so hiding it without this leaves a floating
    // invisible step the car can climb.
    else if (name === 'refCookie') reserved.push(name)
    // "KinematicPositionBased" contains no "dynamic", so the level exports
    // these as static. They are supposed to slide.
    else if (name.includes('KinematicPositionBased')) reserved.push(name)
  }
  // Props this portfolio does not stand behind get no body at all. Reserving
  // them here — before `addPhysics` — is what stops the environment's fallback
  // pass fitting a trimesh collider around a mesh nobody will ever see.
  for (const name of RETIRED) if (nodes.has(name)) reserved.push(name)
  return reserved
}

export class Interactions {
  readonly references: References
  readonly prompts: Prompts
  readonly explosions: Explosions
  readonly crates: ExplosiveCrates
  readonly achievements: Achievements
  readonly circuit: Circuit
  readonly bowling: Bowling
  readonly title: Title
  readonly career: Career
  readonly projects: Projects
  readonly social: Social
  readonly places: Places
  readonly blackboards: Blackboards
  constructor(private game: World2Game, data: World2Interactions) {
    const { bin, ticker, tweens, inputs, physics, view, environment, audio } = game
    this.references = new References(environment, data)

    this.prompts = new Prompts(ticker, tweens, inputs, bin, () => game.player.position)
    game.renderer.scene.add(this.prompts.group)

    this.achievements = new Achievements(game, this.references, bin)
    game.renderer.scene.add(this.achievements.group)

    this.explosions = new Explosions(physics, ticker, view, bin, game.vehicle.chassis.physical, (_at, strength) => {
      audio.environment('explosion', Math.min(1, strength / 8))
    })
    game.renderer.scene.add(this.explosions.group)

    this.crates = new ExplosiveCrates(this.references, physics, ticker, tweens, this.explosions, bin, {
      onFuse: () => audio.play('blip', 1.9),
      onExplode: () => this.achievements.unlock('tnt'),
      onChain: (count, total) => {
        if (count >= 2) this.achievements.set('tntChain', count)
        for (let i = 0; i < total; i++) this.achievements.mark('tntAll', `crate-${i}`)
      },
    })

    this.circuit = new Circuit(game, this.references, bin)
    game.renderer.scene.add(this.circuit.group)
    const start = this.references.position('refInteractivePoint.003')
    if (start) {
      this.circuit.attachPrompt(this.prompts.create({
        label: 'Start race', position: start, align: 'right',
        onInteract: () => this.circuit.restart(),
      }))
    }
    const reset = this.references.position('refLeaderboardReset')
    if (reset) {
      this.prompts.create({
        label: 'Clear best laps', position: reset, align: 'left',
        onInteract: () => { this.circuit.clearRecords(); audio.play('interact') },
      })
    }

    this.bowling = new Bowling(game, this.references, bin)
    game.renderer.scene.add(this.bowling.group)
    const restart = this.references.position('refRestartInteractivePoint')
    if (restart) {
      this.bowling.attachPrompts(this.prompts.create({
        label: 'Reset pins', position: restart, align: 'right', startHidden: true,
        onInteract: () => this.bowling.reset(),
      }), null)
    }
    const bumpers = this.references.position('refBumpersInteractivePoint.001')
    if (bumpers) {
      this.prompts.create({
        label: 'Bumpers', position: bumpers, align: 'left',
        onInteract: () => this.bowling.toggleBumpers(),
      })
    }

    this.title = new Title(game, this.references, bin)
    game.renderer.scene.add(this.title.group)
    const bonfire = this.references.position('refBonfireInteractivePoint')
    if (bonfire) {
      // Upstream's bonfire is the world's "Res(e)t" — it stands the name back
      // up and puts every prop where Blender had it.
      this.prompts.create({
        label: 'Reset the island', position: bonfire, align: 'right',
        onInteract: () => { this.resetProps(); audio.play('interact') },
      })
    }

    this.career = new Career(game, this.references, bin)
    game.renderer.scene.add(this.career.group)

    this.projects = new Projects(game, this.references, bin)
    game.renderer.scene.add(this.projects.group)
    const board = this.references.position('refInteractivePoint')
    if (board) {
      this.projects.attachPrompt(this.prompts.create({
        label: 'Projects', position: board, align: 'right',
        onInteract: () => this.projects.open(),
      }))
    }

    this.social = new Social(game, this.references, this.prompts, bin)
    game.renderer.scene.add(this.social.group)

    this.places = new Places(game, this.references, this.prompts, bin)
    game.renderer.scene.add(this.places.group)

    this.blackboards = new Blackboards(this.references, inputs, bin)

    this.bindBoardControls()
    this.watchDriving()
  }

  /** While the board is open the same keys step through it. */
  private bindBoardControls(): void {
    const { game } = this
    const on = (name: string, run: () => void) => {
      const listener = (action: { active: boolean }) => { if (action.active && this.projects.state === 'open') run() }
      game.inputs.events.on(name, listener as never)
      game.bin.add(() => game.inputs.events.off(name, listener as never))
    }
    on('boardPrevious', () => this.projects.step(-1))
    on('boardNext', () => this.projects.step(1))
    on('interact', () => this.projects.openLink())
  }

  /** Driving awards, read straight off the player and vehicle. */
  private watchDriving(): void {
    const { game } = this
    let boostHeld = 0
    let airborne = 0
    let reportedDistance = 0
    const tick = () => {
      const delta = game.ticker.delta * game.ticker.scale
      // Distance grows every frame. Reporting it every frame kept the save
      // permanently dirty, which meant a full JSON write every two seconds
      // for as long as the car was moving — a hitch you could feel.
      const driven = Math.floor(game.player.distanceDriven)
      if (driven - reportedDistance >= 5) {
        reportedDistance = driven
        this.achievements.set('firstDrive', driven)
        this.achievements.set('longHaul', driven)
      }
      if (game.vehicle.speedKmh >= 120) this.achievements.set('speedDemon', 1)
      boostHeld = game.player.boosting > 0.5 ? boostHeld + delta : 0
      if (boostHeld >= 3) this.achievements.unlock('boosted')
      airborne = game.vehicle.wheels.inContactCount === 0 ? airborne + delta : 0
      if (airborne >= 2) this.achievements.unlock('takeoff')
      const area = game.status.area
      if (area && area !== 'open road') this.achievements.mark('explorer', area)
    }
    game.ticker.events.on('tick', tick, 14)
    game.bin.add(() => game.ticker.events.off('tick', tick))
  }

  /** The label the touch HUD should offer for the prompt in range. */
  get promptLabel(): string | null { return this.prompts.activeLabel }

  /** Routed from the HUD's touch button and from the interact key. */
  interact(): boolean { return this.prompts.interactActive() }

  /** R while an activity owns the car: the activity decides where you land. */
  respawn(): boolean { return this.circuit.respawn() }

  /** True while an activity owns the controls, so the route defers to it. */
  get busy(): boolean { return this.circuit.state !== 'pending' || this.projects.state !== 'closed' }

  exitActivity(): void {
    if (this.projects.state !== 'closed') { this.projects.close(); return }
    this.circuit.exit(true)
  }

  /** Everything the world reset touches: crates, props, effects. */
  resetProps(): void {
    this.explosions.clear()
    this.crates.reset()
    this.bowling.reset()
    this.title.reset()
    // Every other authored dynamic prop goes home too: benches, cones,
    // barrels, fences, the social icons. Upstream's world reset, in one line.
    for (const { physical } of this.references.environment.dynamic) {
      this.game.physics.reset(physical)
      if (physical.initialState.sleeping) physical.body.sleep()
    }
  }

  reset(): void { this.resetProps() }

  /** A cheap signature of `gameplay()`, so an unchanged HUD is not republished. */
  signature(view: World2Gameplay): string {
    return `${view.activity}|${view.headline}|${view.timer}|${view.lines.join('~')}|${view.prompt}|${view.notice?.title ?? ''}|${view.achievementsUnlocked}|${view.cratesLeft}|${view.achievements.length}`
  }

  /** One flat view of gameplay for the HUD. Recomputed, never accumulated. */
  gameplay(): World2Gameplay {
    const race = this.circuit.hud()
    const board = this.projects.hud()
    const lane = this.bowling.hud()
    // Whichever activity owns the car speaks first; bowling fills the gap.
    const active = race.activity ? race : board.activity ? board : null
    return {
      activity: active?.activity ?? null,
      headline: active ? ('headline' in active ? active.headline : null) : lane.headline,
      timer: race.timer,
      lines: active ? active.lines : lane.lines,
      prompt: this.promptLabel,
      notice: this.achievements.notice,
      achievementsUnlocked: this.achievements.unlockedCount,
      achievementsTotal: this.achievements.groups.size,
      cratesLeft: this.crates.remaining,
      achievements: this.game.status.achievementsOpen ? this.achievements.view() : [],
    }
  }
}
