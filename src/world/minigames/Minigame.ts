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

/**
 * How often the HUD card may be rewritten, in real seconds. The store
 * hands `WorldHud` a fresh object on every write and the HUD compares
 * by reference, so publishing once per rendered frame re-rendered the
 * whole overlay 60 times a second. Ten is as fast as a stopwatch needs
 * to be read.
 */
const PUBLISH_INTERVAL = 0.1

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

  /**
   * Every delayed callback this game has scheduled. One list, drained
   * by `prepareAttempt`, so a subclass cannot own a timer the base
   * class does not know how to kill — which is how a chess release
   * timer used to be able to steal the camera from a different
   * mini-game two seconds after chess had ended.
   */
  private timers: TweenHandle[] = []

  /** Seconds of lead-in before the clock starts. 0 skips the phase. */
  protected leadIn = 0
  /** Seconds left of that lead-in. Read by `lines()`. */
  protected leadInLeft = 0
  /** When the current result card was written, on the real clock. */
  private resultAt = -1

  private publishedAt = -1
  private published = ''

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

  /** One line of rules, shown while the countdown runs. */
  protected briefing(): string | null {
    return this.hint()
  }

  /** Called once when the countdown reaches zero. */
  protected onStart(): void {}

  get running(): boolean {
    return this.state === 'countdown' || this.state === 'running'
  }
  get resultIsDistant(): boolean {
    return this.game.player.position.distanceTo(this.resultOrigin) > Math.min(140, this.abandonRadius)
  }

  /* ---- timers ------------------------------------------- */

  /**
   * Runs `callback` in `seconds` of REAL time. Tweens advance on the
   * scaled clock, so a bare `tweens.delay(5)` was two and a half
   * seconds — which is why every result card in this folder used to
   * disappear at half the time its author wrote down.
   */
  protected schedule(seconds: number, callback: () => void): TweenHandle {
    const handle = this.game.tweens.delay(seconds * this.game.ticker.defaultScale, () => {
      const index = this.timers.indexOf(handle)
      if (index >= 0) this.timers.splice(index, 1)
      callback()
    })
    this.timers.push(handle)
    return handle
  }

  /* ---- lifecycle ---------------------------------------- */

  start(): boolean {
    if (this.running) return true
    this.prepareAttempt()
    this.reset()
    this.elapsed = 0
    this.leadInLeft = this.leadIn
    this.state = this.leadIn > 0 ? 'countdown' : 'running'
    this.origin.copy(this.game.player.position)
    this.game.inputs.setFilters([])
    if (this.state === 'running') this.onStart()
    this.publish(true)
    this.events.trigger('start')
    return true
  }

  cancel(reason: 'player' | 'strayed' | 'respawn' = 'player'): void {
    // Also clears a finish or fail card. Those linger for a few
    // seconds on purpose, but Escape has to mean "get this off my
    // screen" in every state, not only while a run is live.
    if (this.state === 'idle') return
    this.state = 'idle'
    this.prepareAttempt()
    this.reset()
    this.clearCard()
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

    this.card(
      time === null
        ? ['COMPLETE']
        : [formatTime(time), best !== null ? `BEST ${formatTime(best)}` : ''],
      best,
    )

    // Leave the result up for a moment, then get out of the way — and
    // put the world back while doing it. `finish` used to leave the
    // gym's lamps green and the chip relay's chips hidden until
    // somebody started a second run.
    this.prepareAttempt()
    this.schedule(5, () => {
      if (this.state !== 'finished') return
      this.state = 'idle'
      this.reset()
      this.clearCard()
    })

    this.events.trigger('finish', [time])
  }

  protected fail(message: string): void {
    if (this.state === 'failed') return
    this.state = 'failed'
    this.resultOrigin.copy(this.game.player.position)
    this.card([message, 'PRESS ENTER AT THE ENTRANCE TO RETRY'], this.bestTime)
    this.prepareAttempt()
    this.schedule(3.2, () => {
      if (this.state !== 'failed') return
      this.state = 'idle'
      this.reset()
      this.clearCard()
    })
  }

  /**
   * True once a finish or fail card has outstayed its welcome. The
   * timer that takes it down can be killed by a subclass calling
   * `prepareAttempt()` after `finish()` — two of them do — so the
   * manager sweeps for this as well rather than trusting the timer.
   */
  get resultIsStale(): boolean {
    if (this.state !== 'finished' && this.state !== 'failed') return false
    return this.game.ticker.elapsed - this.resultAt > (this.state === 'finished' ? 6.5 : 4.5)
  }

  /** Writes a result card and stops the live readout overwriting it. */
  private card(lines: string[], best: number | null): void {
    this.published = ''
    this.publishedAt = -1
    this.resultAt = this.game.ticker.elapsed
    this.game.store.getState().setMinigame({
      id: this.id, title: this.title, lines, time: null, best, progress: null,
    })
  }

  /** Takes the card down, but only if it is still ours. */
  private clearCard(): void {
    this.published = ''
    this.publishedAt = -1
    const store = this.game.store.getState()
    if (store.minigame === null || store.minigame.id === this.id) store.setMinigame(null)
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

    if (this.state === 'countdown') {
      this.leadInLeft -= delta
      if (this.leadInLeft <= 0) {
        this.leadInLeft = 0
        this.state = 'running'
        this.elapsed = 0
        this.onStart()
        this.publish(true)
      } else {
        this.publish()
      }
      return
    }

    this.elapsed += delta
    this.tick(delta)
    if (this.running) this.publish()
  }

  /** Invalidates pending result callbacks, including rapid same-game retries. */
  prepareAttempt(): void {
    for (const timer of this.timers) timer.kill()
    this.timers.length = 0
  }

  restoreObjects(): void {
    this.prepareAttempt()
    this.cancel('player')
    this.reset()
    this.elapsed = 0
    this.leadInLeft = 0
    this.state = 'idle'
  }

  /** Race overrides this; other games keep the usual district respawn. */
  recover(): boolean { return false }

  /**
   * Writes the mini-game HUD, at most ten times a second and only when
   * something visible has changed. Both halves matter: the interval
   * keeps a per-frame `lines()` (chess rebuilds a FEN in its) off the
   * hot path, and the comparison stops an idling card writing a new
   * object into the store for no reason.
   */
  protected publish(force = false): void {
    const now = this.game.ticker.elapsed
    if (!force && now - this.publishedAt < PUBLISH_INTERVAL) return

    const lines = this.lines()
    const progress = this.progress()
    const signature = `${this.state} ${lines.join('')} ${progress === null ? '' : progress.toFixed(3)}`
    this.publishedAt = now
    if (!force && signature === this.published) return
    this.published = signature

    this.game.store.getState().setMinigame({
      id: this.id,
      title: this.title,
      lines,
      time: this.elapsed,
      best: this.bestTime,
      progress,
    })
  }

  protected lines(): string[] {
    if (this.state === 'countdown') {
      const briefing = this.briefing()
      return [
        Math.ceil(this.leadInLeft).toFixed(0),
        'GET READY',
        ...(briefing ? [briefing] : []),
      ]
    }
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
      // A result card whose dismissal timer was killed under it (see
      // `resultIsStale`) would otherwise follow the player around the
      // island for the rest of the session.
      if (this.active.resultIsStale) { this.cancel('player'); return }
      // Real seconds, dilated only by bullet time. `ticker.scale` is 2
      // by default — the world runs at twice real time on purpose — so
      // feeding it straight to a mini-game made every clock in this
      // folder run double, and OrderRush's labelled "12.0S" countdown
      // expire in six.
      const ticker = this.game.ticker
      this.active.update(ticker.delta * (ticker.scale / ticker.defaultScale))
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

    // An overlay opened with the MOUSE — the brand button, a pause-menu
    // item — never fires the `pause` or `map` action, so the two
    // listeners above missed it and the manager's tick simply stopped
    // ticking: chess froze with the camera pinned to the board and the
    // car still locked, with nothing left to release it. Watching the
    // store catches every route into an overlay, whatever opened it.
    let overlay = this.game.store.getState().overlay
    const unsubscribe = this.game.store.subscribe((state) => {
      const next = state.overlay
      if (next === overlay) return
      overlay = next
      if (next === null || !this.active) return
      if (this.active.id === 'circuit' && this.active.running) return
      this.cancel('player')
    })

    bin.add(() => {
      unsubscribe()
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
    // Starting one always ends the last, so two timers can never run —
    // including the delayed ones, or a foreign game's result callback
    // fires in the middle of this one.
    if (this.active && this.active !== minigame) {
      this.active.prepareAttempt()
      this.active.cancel('player')
    }
    this.active = minigame
    if (!minigame.running) minigame.prepareAttempt()
    return minigame.start()
  }

  cancel(reason: 'player' | 'strayed' | 'respawn' = 'player'): void {
    this.active?.prepareAttempt()
    this.active?.cancel(reason)
    this.active = null
    // Unconditional, so the HUD's own "Exit game" button is never a
    // no-op: a result card can outlive the game that wrote it, and
    // before this the only way off the screen was to start something.
    this.game.store.getState().setMinigame(null)
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
