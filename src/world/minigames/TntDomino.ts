import * as THREE from 'three'
import { Minigame } from './Minigame'
import type { Game } from '../Game'
import type { Bin } from '../core/Disposal'
import { PLAY_SPOTS } from '@/content/world-environment'

/* ============================================================
   TNT DOMINO

   The one challenge on the drawing. It used to be one of five
   kinds inside a shared `IslandChallenge` class; the other four
   were played in districts the drawing does not have, and a
   five-way switch with one live branch is worse than a file.

   The stack itself is built by `Playground.buildTnt()` beside the
   circuit's west run. This is the clock, the rule and the score:
   hit one crate hard enough that the chain takes most of the
   field before the fuses burn out.
   ============================================================ */

/** How many of the eighteen crates a winning chain has to reach. A
 *  chain that has to take ALL of them cannot survive one crate being
 *  blown out of formation before its neighbour's fuse lights, and the
 *  only way that run can end is a thirty-second timeout. */
const SHARE = 0.8
const LIMIT = 30
const RULE = 'Hit a TNT crate hard enough to take most of the field with it.'

export class TntDomino extends Minigame {
  readonly id = 'domino' as const
  readonly title = 'TNT DOMINO'
  readonly group = new THREE.Group()
  readonly startPosition = new THREE.Vector3()
  reached = 0

  constructor(game: Game, bin: Bin) {
    super(game, bin)
    this.abandonRadius = 63
    this.leadIn = 3
  }

  private get goal(): number {
    return Math.ceil(this.game.playground.crates.length * SHARE)
  }

  build(): void {
    const spot = PLAY_SPOTS.find((p) => p.id === 'tnt')!
    /*
      SOUTH OF THE STACK, aimed straight up the verge at it.

      The mark used to sit twenty metres EAST, which on this island is
      three metres inside the west lake: a car put down there sank,
      respawned at the circuit and cancelled the run mid-countdown. The
      verge is only twenty metres wide, so the only run-up is along it.

      Lined up with the middle column rather than the gap between two,
      because started off-line the car threads the stack at speed and
      touches nothing — which makes "hit a crate hard enough" a game
      you cannot win by driving at it.
    */
    const z = spot.z + 26
    this.startPosition.set(spot.x, this.game.terrain.colliderHeightAt(spot.x, z) + 1.6, z)

    this.game.playground.label(this.title, this.group, this.startPosition.clone().add(new THREE.Vector3(0, 5, 0)), 10, 1.8)
    this.game.renderer.scene.add(this.group)
    this.bin.object3D(this.group)

    this.game.interactions.add({
      id: 'challenge-domino',
      position: this.startPosition.clone(),
      radius: 7,
      label: 'PLAY TNT DOMINO',
      sublabel: RULE,
      onInteract: () => this.game.minigames.start(this.id),
    })
  }

  start(): boolean {
    if (this.running) return true
    const ok = super.start()
    this.origin.copy(this.startPosition)
    this.game.audio?.blip(0.75)
    return ok
  }

  protected reset(): void {
    this.reached = 0
    this.game.playground.resetTnt()
  }

  protected tick(): void {
    const seconds = this.elapsed
    if (seconds > LIMIT) {
      this.game.audio?.play('fail')
      this.fail('TIME UP • TRY AGAIN')
      return
    }
    this.reached = this.game.playground.crates.filter((c) => c.exploded).length
    if (this.reached < this.goal) return
    // No `prepareAttempt()` here. It used to be called one statement
    // after `finish()`, which killed the timer that returns the game to
    // idle on the very frame it was created — so every win left the
    // card welded to the HUD and the state machine stuck on 'finished'.
    this.game.achievements.set('domino', 1)
    this.game.audio.play('achievement')
    this.game.audio.blip(1.9)
    this.game.particles.burst(this.game.player.position, 30, 'confetti')
    this.game.view.kick(0.3)
    this.finish(seconds)
  }

  protected briefing(): string { return RULE }

  protected lines(): string[] {
    if (this.state === 'countdown') return [Math.ceil(this.leadInLeft).toFixed(0), `${LIMIT}s ON THE CLOCK`, RULE]
    const left = Math.max(0, LIMIT - this.elapsed).toFixed(1)
    return [`${left}s LEFT • ${this.reached} / ${this.goal}`, RULE, 'ESC TO LEAVE']
  }

  protected progress(): number { return Math.min(1, this.reached / this.goal) }
}
