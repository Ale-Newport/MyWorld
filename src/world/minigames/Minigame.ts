import * as THREE from 'three'
import { Events } from '../core/Events'
import { formatTime } from '../core/maths'
import type { Bin } from '../core/Disposal'
import type { Game } from '../Game'
import type { MinigameId } from '@/content/world'
import type { TweenHandle } from '../core/Tween'

/* ============================================================
   MINI-GAMES

   Upstream builds each one inside its Area, with its own state
   and its own way of ending. That works when there is one author.
   Here they share a base class, because the brief's hardest
   requirement about mini-games is not that they are fun — it is
   that NONE OF THEM CAN TRAP THE PLAYER.

   So cancelling is not each game's problem. The base class binds
   it once: ESCAPE, respawning and opening the map release ordinary
   games; a race pauses or recovers at its checkpoint. Driving far
   enough away cancels. A
   subclass that forgets to handle any of those still cannot
   strand anyone.

   Best times are per-browser and versioned with the save file.
   There is no leaderboard and no backend, which is a deliberate
   choice: the interfaces below would take one, but shipping an
   unauthenticated score endpoint to make a portfolio look busier
   is not a trade worth making.
   ============================================================ */

export type MinigameState = 'idle' | 'ready' | 'countdown' | 'running' | 'finished' | 'failed' | 'resetting'

export abstract class Minigame {
  abstract readonly id: MinigameId
  abstract readonly title: string

  /** How far from the start the player may stray before it cancels. */
  protected abandonRadius = 260

  readonly events = new Events<'start' | 'finish' | 'cancel'>()

  state: MinigameState = 'idle'
  protected elapsed = 0
  protected origin = new THREE.Vector3()
  private resultOrigin = new THREE.Vector3()
  private resultTimer: TweenHandle | null = null

  constructor(protected game: Game, protected bin: Bin) {}

  /** Called once at world load. Build geometry, zones, checkpoints. */
  abstract build(): void

  /** Called each tick while the game is running. */
  protected abstract tick(delta: number): void

  /** Reset internal state. Called on start and on cancel. */
  protected abstract reset(): void

  /** Optional: a short line of copy shown under the timer. */
  protected hint(): string | null {
    return null
  }

  get running(): boolean {
    return this.state === 'countdown' || this.state === 'running'
  }
  get resultIsDistant(): boolean {
    return this.game.player.position.distanceTo(this.resultOrigin) > Math.min(140, this.abandonRadius)
  }

  /* ---- lifecycle ---------------------------------------- */

  start(): boolean {
    if (this.running) return true
    this.reset()
    this.elapsed = 0
    this.state = 'running'
    this.origin.copy(this.game.player.position)
    this.game.inputs.setFilters([])
    this.publish()
    this.events.trigger('start')
    return true
  }

  cancel(reason: 'player' | 'strayed' | 'respawn' = 'player'): void {
    // Also clears a finish or fail card. Those linger for a few
    // seconds on purpose, but Escape has to mean "get this off my
    // screen" in every state, not only while a run is live.
    if (this.state === 'idle') return
    this.state = 'idle'
    this.reset()
    this.game.store.getState().setMinigame(null)
    this.events.trigger('cancel', [reason])
  }

  protected finish(time: number | null = null): void {
    if (this.state === 'finished') return
    this.state = 'finished'
    this.resultOrigin.copy(this.game.player.position)
    this.game.save.data.progress.completedGames = Array.from(new Set([
      ...this.game.save.data.progress.completedGames, this.id,
    ]))
    this.game.save.schedule()
    const best = time === null ? null : this.recordBest(time)

    this.game.store.getState().setMinigame({
      id: this.id,
      title: this.title,
      lines:
        time === null
          ? ['COMPLETE']
          : [formatTime(time), best !== null ? `BEST ${formatTime(best)}` : ''],
      time: null,
      best,
      progress: null,
    })

    // Leave the result up for a moment, then get out of the way.
    this.resultTimer?.kill()
    this.resultTimer = this.game.tweens.delay(5, () => {
      if (this.state !== 'finished') return
      this.state = 'idle'
      if (this.game.store.getState().minigame?.id === this.id) this.game.store.getState().setMinigame(null)
    })

    this.events.trigger('finish', [time])
  }

  protected fail(message: string): void {
    this.state = 'failed'
    this.game.store.getState().setMinigame({
      id: this.id,
      title: this.title,
      lines: [message],
      time: null,
      best: this.bestTime,
      progress: null,
    })
    this.resultTimer?.kill()
    this.resultTimer = this.game.tweens.delay(2.6, () => {
      if (this.state !== 'failed') return
      this.state = 'idle'
      this.reset()
      if (this.game.store.getState().minigame?.id === this.id) this.game.store.getState().setMinigame(null)
    })
  }

  /* ---- persistence -------------------------------------- */

  get bestTime(): number | null {
    return this.game.save.data.progress.bestTimes[this.id] ?? null
  }

  private recordBest(time: number): number {
    const current = this.bestTime
    if (current === null || time < current) {
      this.game.save.data.progress.bestTimes[this.id] = time
      this.game.save.schedule()
      return time
    }
    return current
  }

  /* ---- per-frame ---------------------------------------- */

  /** Called by the manager. Handles the shared rules, then `tick`. */
  update(delta: number): void {
    if (!this.running) return

    // Wandering off is a cancel, not a soft-lock. Measured from where
    // the run began, so a long circuit does not cancel itself.
    if (this.game.player.position.distanceTo(this.origin) > this.abandonRadius) {
      this.cancel('strayed')
      return
    }

    this.elapsed += delta
    this.tick(delta)
    if (this.running) this.publish()
  }

  /** Invalidates pending result callbacks, including rapid same-game retries. */
  prepareAttempt(): void {
    this.resultTimer?.kill()
    this.resultTimer = null
  }

  restoreObjects(): void {
    this.prepareAttempt()
    this.cancel('player')
    this.reset()
    this.elapsed = 0
    this.state = 'idle'
  }

  /** Race overrides this; other games keep the usual district respawn. */
  recover(): boolean { return false }

  /** Writes the mini-game HUD. Subclasses override `lines`/`progress`. */
  protected publish(): void {
    this.game.store.getState().setMinigame({
      id: this.id,
      title: this.title,
      lines: this.lines(),
      time: this.elapsed,
      best: this.bestTime,
      progress: this.progress(),
    })
  }

  protected lines(): string[] {
    const hint = this.hint()
    return [formatTime(this.elapsed), ...(hint ? [hint] : [])]
  }

  protected progress(): number | null {
    return null
  }
}

/* ============================================================
   MANAGER
   ============================================================ */

export class Minigames {
  private items = new Map<string, Minigame>()
  private active: Minigame | null = null

  constructor(private game: Game, bin: Bin) {
    const tick = () => {
      if (!this.active) return
      if (this.game.store.getState().overlay !== null) return
      if (this.active.state === 'finished' && this.active.resultIsDistant) { this.cancel('strayed'); return }
      this.active.update(this.game.ticker.delta * this.game.ticker.scale)
      if (!this.active.running && this.active.state === 'idle') this.active = null
    }
    this.game.ticker.events.on('tick', tick, 13)

    // Ordinary games cancel on these escape hatches. CircuitRace owns
    // its checkpoint recovery and freezes the clock/body during overlays.
    const onRespawn = () => this.cancel('respawn')
    this.game.player.events.on('respawn', onRespawn as never)

    const onPause = (action: { active: boolean }) => {
      if (action.active && (this.active?.id !== 'circuit' || !this.active?.running)) this.cancel('player')
    }
    this.game.inputs.events.on('pause', onPause as never)
    this.game.inputs.events.on('map', onPause as never)

    bin.add(() => {
      this.game.ticker.events.off('tick', tick)
      this.game.player.events.off('respawn', onRespawn as never)
      this.game.inputs.events.off('pause', onPause as never)
      this.game.inputs.events.off('map', onPause as never)
      this.items.clear()
      this.active = null
    })
  }

  register(minigame: Minigame): void {
    this.items.set(minigame.id, minigame)
    minigame.build()
  }

  get(id: string): Minigame | undefined {
    return this.items.get(id)
  }

  /** Returns true when a game with that id exists and has started. */
  start(id: string): boolean {
    const minigame = this.items.get(id)
    if (!minigame) return false
    // Starting one always ends the last, so two timers can never run.
    if (this.active && this.active !== minigame) this.active.cancel('player')
    this.active = minigame
    if (!minigame.running) minigame.prepareAttempt()
    return minigame.start()
  }

  cancel(reason: 'player' | 'strayed' | 'respawn' = 'player'): void {
    this.active?.prepareAttempt()
    this.active?.cancel(reason)
    this.active = null
  }

  resetAll(): void {
    for (const item of this.items.values()) item.restoreObjects()
    this.active = null
    this.game.store.getState().setMinigame(null)
  }

  get current(): Minigame | null {
    return this.active
  }
}
