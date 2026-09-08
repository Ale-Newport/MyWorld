import { Events } from '../core/Events'
import {
  achievements as achievementData,
  achievementById,
  completionistTargets,
  type Achievement,
} from '@/content/achievements'
import type { Save } from './Save'

/* ============================================================
   ACHIEVEMENTS

   Architecture from sources/Game/Achievements.js (folio-2025,
   MIT — Copyright (c) 2025 Bruno Simon). See THIRD_PARTY_NOTICES.md.
   Content, persistence schema and presentation are ours.

   Two kinds of progress, as upstream:
     COUNTERS   a number. `add` increments, `set` takes the max.
     SETS       a set of ids. Progress is the set's size.

   Sets are what make "visit every district" work: the same
   district can be entered fifty times and only count once, and
   the ids survive a reload so progress cannot be farmed by
   driving in and out.

   The one behavioural change from upstream: `set` here takes the
   MAXIMUM rather than assigning. Upstream assigns, so a caller
   that forgets to guard can move progress backwards — every
   upstream call site has to write `if (x > group.progress)` by
   hand, and one that forgets is a silent bug. Taking the max
   makes the guard unnecessary and the API honest.
   ============================================================ */

export interface AchievementGroupState {
  id: string
  definition: Achievement
  /** Counter value, or the size of `ids`. */
  progress: number
  ids: Set<string> | null
  unlocked: boolean
}

/** Ids whose progress is a set of unique things rather than a count. */
const UNIQUE_GROUPS: Record<string, true> = {
  labPlay: true,
  explorer: true,
  notes: true,
  projects: true,
  archivist: true,
  debugger: true,
  cones: true,
  completionist: true,
}

export class Achievements {
  readonly events = new Events<'unlock' | 'progress' | 'reset'>()
  readonly groups = new Map<string, AchievementGroupState>()

  private silent = false

  constructor(private save: Save) {
    for (const definition of achievementData) {
      this.groups.set(definition.id, {
        id: definition.id,
        definition,
        progress: 0,
        ids: UNIQUE_GROUPS[definition.id] ? new Set() : null,
        unlocked: false,
      })
    }

    this.hydrate()
  }

  /** Replays stored progress without firing notifications. */
  private hydrate(): void {
    this.silent = true
    for (const [id, value] of Object.entries(this.save.data.progress.achievements)) {
      const group = this.groups.get(id)
      if (!group) continue
      if (group.ids && Array.isArray(value)) this.set(id, value)
      else if (!group.ids && typeof value === 'number') this.set(id, value)
    }
    this.silent = false
    this.evaluateCompletionist()
  }

  isUnlocked(id: string): boolean {
    return this.groups.get(id)?.unlocked ?? false
  }

  progressOf(id: string): number {
    return this.groups.get(id)?.progress ?? 0
  }

  /** Adds `amount` to a counter group. */
  add(id: string, amount = 1): void {
    const group = this.groups.get(id)
    if (!group || group.ids) return
    this.set(id, group.progress + amount)
  }

  /**
   * Sets progress. For counters, keeps the higher of old and new.
   * For sets, adds the given id(s).
   */
  set(id: string, value: number | string | string[]): void {
    const group = this.groups.get(id)
    if (!group) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[world] unknown achievement "${id}"`)
      }
      return
    }

    const before = group.progress

    if (group.ids) {
      const ids = Array.isArray(value) ? value : [String(value)]
      for (const item of ids) group.ids.add(item)
      group.progress = group.ids.size
    } else {
      const next = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(next)) return
      group.progress = Math.max(group.progress, next)
    }

    if (group.progress === before) return

    this.save.data.progress.achievements[id] = group.ids
      ? Array.from(group.ids)
      : group.progress
    this.save.schedule()

    if (!this.silent) this.events.trigger('progress', [group])

    if (!group.unlocked && group.progress >= group.definition.target) {
      group.unlocked = true
      if (!this.silent) {
        this.events.trigger('unlock', [group])
        // Finding any secret also satisfies CURIOUS.
        if (group.definition.group === 'secrets' && id !== 'curious') this.set('curious', 1)
      }
      this.evaluateCompletionist()
    }
  }

  /** Unlocks COMPLETIONIST once everything else is done. */
  private evaluateCompletionist(): void {
    const completionist = this.groups.get('completionist')
    if (!completionist || completionist.unlocked) return
    for (const id of completionistTargets) {
      if (!this.groups.get(id)?.unlocked) return
    }
    this.set('completionist', 1)
  }

  /** For the achievements panel. Locked-but-visible items included. */
  list(): AchievementGroupState[] {
    return achievementData
      .filter((a) => !a.hidden || this.isUnlocked(a.id))
      .map((a) => this.groups.get(a.id))
      .filter((g): g is AchievementGroupState => Boolean(g))
  }

  get unlockedCount(): number {
    let n = 0
    for (const group of this.groups.values()) if (group.unlocked) n++
    return n
  }

  get totalCount(): number {
    return this.groups.size
  }

  reset(): void {
    for (const group of this.groups.values()) {
      group.progress = 0
      group.unlocked = false
      group.ids?.clear()
    }
    this.save.data.progress.achievements = {}
    this.save.schedule()
    this.events.trigger('reset')
  }

  destroy(): void {
    this.events.clear()
  }
}

export { achievementById }
