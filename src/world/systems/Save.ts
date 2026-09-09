import type { QualityPreference } from '../core/Quality'

/* ============================================================
   SAVE

   Everything the world remembers about a visitor lives in one
   versioned blob in `localStorage`. Upstream keeps a key per
   concern (`distanceDriven`, `timePlayed`, `achievements`, …),
   which works until the schema changes and there is no single
   place to migrate.

   Rules:
   - One key, one version number.
   - A corrupt, foreign or newer blob is discarded silently and
     replaced with defaults. A visitor should never see the world
     fail to load because of something in their own browser.
   - Writes are debounced; achievements can fire several times in
     a frame and localStorage is synchronous.
   - Every read is defensive. `unknown` in, typed out.
   ============================================================ */

export const SAVE_KEY = 'alejandro-world-save-v1'
/**
 * Bumped to 2 for the circuit leaderboard.
 *
 * `coerce` used to DISCARD the whole blob on any version mismatch, so
 * changing this number threw away every visitor's districts, notes,
 * secrets, achievements and best times. It now migrates instead: a
 * version-1 blob is read as it always was, and its bare list of race
 * times becomes leaderboard entries with an unknown date.
 */
const SAVE_VERSION = 2
const WRITE_DEBOUNCE_MS = 700

export interface SaveData {
  version: number
  settings: {
    quality: QualityPreference
    volume: number
    muted: boolean
    reducedMotion: boolean | null
    /** Per-action key overrides for the remapping UI. */
    bindings: Record<string, string[]>
    /** Skips the first-run controls card. */
    onboarded: boolean
  }
  progress: {
    /** Achievement id → progress. Arrays are "unique" set-style groups. */
    achievements: Record<string, number | string[]>
    /** District ids the visitor has entered. */
    districts: string[]
    /** Landmark ids whose panel has been opened. */
    landmarks: string[]
    /** Dev-note ids found. */
    notes: string[]
    /** Secret ids found. */
    secrets: string[]
    distanceDriven: number
    timePlayed: number
    /** Mini-game id → best time in seconds (lower is better). */
    bestTimes: Record<string, number>
    completedGames: string[]
    /** Kept for the version-1 blobs it is migrated from. */
    raceHistory: number[]
    /** The circuit leaderboard: fastest first, at most ten. */
    raceBoard: { time: number; at: number }[]
    /** Last respawn point name. */
    lastRespawn: string | null
  }
}

function defaults(): SaveData {
  return {
    version: SAVE_VERSION,
    settings: {
      quality: 'auto',
      volume: 0.7,
      muted: false,
      reducedMotion: null,
      bindings: {},
      onboarded: false,
    },
    progress: {
      achievements: {},
      districts: [],
      landmarks: [],
      notes: [],
      secrets: [],
      distanceDriven: 0,
      timePlayed: 0,
      bestTimes: {},
      completedGames: [],
      raceHistory: [],
      raceBoard: [],
      lastRespawn: null,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Rebuilds a full `SaveData` from whatever was in storage. */
function coerce(raw: unknown): SaveData {
  const out = defaults()
  if (!isRecord(raw)) return out

  // A blob from a FUTURE version is not ours to guess at. An older one
  // is, and throwing it away is how a visitor loses everything they
  // did here because a field was added.
  const version = numberOr(raw.version, 0)
  if (version < 1 || version > SAVE_VERSION) return out

  const settings = isRecord(raw.settings) ? raw.settings : {}
  const quality = settings.quality
  if (quality === 'auto' || quality === 'low' || quality === 'medium' || quality === 'high') {
    out.settings.quality = quality
  }
  out.settings.volume = Math.min(1, Math.max(0, numberOr(settings.volume, 0.7)))
  out.settings.muted = settings.muted === true
  out.settings.reducedMotion =
    typeof settings.reducedMotion === 'boolean' ? settings.reducedMotion : null
  out.settings.onboarded = settings.onboarded === true

  if (isRecord(settings.bindings)) {
    for (const [name, keys] of Object.entries(settings.bindings)) {
      const list = stringArray(keys)
      if (list.length) out.settings.bindings[name] = list
    }
  }

  const progress = isRecord(raw.progress) ? raw.progress : {}
  if (isRecord(progress.achievements)) {
    for (const [id, value] of Object.entries(progress.achievements)) {
      if (typeof value === 'number' && Number.isFinite(value)) out.progress.achievements[id] = value
      else if (Array.isArray(value)) out.progress.achievements[id] = stringArray(value)
    }
  }
  out.progress.districts = stringArray(progress.districts)
  out.progress.landmarks = stringArray(progress.landmarks)
  out.progress.notes = stringArray(progress.notes)
  out.progress.secrets = stringArray(progress.secrets)
  out.progress.completedGames = stringArray(progress.completedGames)
  out.progress.raceHistory = Array.isArray(progress.raceHistory)
    ? progress.raceHistory.filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0).sort((a, b) => a - b).slice(0, 5)
    : []

  // The leaderboard, either read back or migrated from the version-1
  // list of bare times. `at: 0` means "before this site kept dates",
  // which the board renders as a dash rather than as 1 January 1970.
  const board = Array.isArray(progress.raceBoard) ? progress.raceBoard : []
  out.progress.raceBoard = board
    .filter(isRecord)
    .map((entry) => ({ time: numberOr(entry.time, 0), at: numberOr(entry.at, 0) }))
    .filter((entry) => Number.isFinite(entry.time) && entry.time > 0)
    .sort((a, b) => a.time - b.time)
    .slice(0, 10)
  if (!out.progress.raceBoard.length && out.progress.raceHistory.length) {
    out.progress.raceBoard = out.progress.raceHistory.map((time) => ({ time, at: 0 }))
  }
  out.progress.distanceDriven = Math.max(0, numberOr(progress.distanceDriven, 0))
  out.progress.timePlayed = Math.max(0, numberOr(progress.timePlayed, 0))
  out.progress.lastRespawn =
    typeof progress.lastRespawn === 'string' ? progress.lastRespawn : null

  if (isRecord(progress.bestTimes)) {
    for (const [id, value] of Object.entries(progress.bestTimes)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        out.progress.bestTimes[id] = value
      }
    }
  }

  return out
}

export class Save {
  data: SaveData
  /** False when storage is unavailable (private mode, blocked cookies). */
  readonly available: boolean

  private timer: number | null = null

  constructor() {
    let raw: unknown = null
    let available = true
    try {
      const text = window.localStorage.getItem(SAVE_KEY)
      raw = text ? JSON.parse(text) : null
    } catch {
      // Private browsing, disabled storage, or a half-written blob.
      // Either way the world runs; it just will not remember.
      available = false
    }
    this.available = available
    this.data = coerce(raw)
  }

  /** Queues a write. Safe to call many times per frame. */
  schedule(): void {
    if (!this.available) return
    if (this.timer !== null) return
    this.timer = window.setTimeout(() => {
      this.timer = null
      this.flush()
    }, WRITE_DEBOUNCE_MS)
  }

  /** Writes immediately. Called on unmount and on pagehide. */
  flush(): void {
    if (!this.available) return
    if (this.timer !== null) {
      window.clearTimeout(this.timer)
      this.timer = null
    }
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(this.data))
    } catch {
      // Quota exceeded is not worth interrupting a game for.
    }
  }

  /** Wipes progress but keeps the visitor's settings. */
  resetProgress(): void {
    this.data.progress = defaults().progress
    this.flush()
  }

  /** Wipes everything. */
  resetAll(): void {
    this.data = defaults()
    this.flush()
  }

  destroy(): void {
    this.flush()
  }
}
