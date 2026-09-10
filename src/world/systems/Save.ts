import { achievementById } from '@/content/achievements'
import { PLAY_SPOTS } from '@/content/world-environment'
import {
  districts, landmarks, devNotes, respawns, FEATURED_SLUGS, SPAWN_RESPAWN,
  type MinigameId,
} from '@/content/world'
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
 * 2 was the circuit leaderboard. 3 is the redrawn island: ten places
 * where there were nineteen, and eight mini-games deleted along with
 * the districts that housed them.
 *
 * `coerce` used to DISCARD the whole blob on any version mismatch, so
 * changing this number threw away every visitor's districts, notes,
 * secrets, achievements and best times. It migrates instead — see the
 * fix-up section at the end of `coerce`.
 */
const SAVE_VERSION = 3
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

/* ============================================================
   VERSION 2 → 3 — THE DRAWN ISLAND

   The map was redrawn from the hand-drawn plan and the island
   lost nine of its nineteen districts, eight mini-games, the
   client city, the archive ring and the waterfall. A version-2
   blob still names every one of them.

   The engine ignores ids it does not recognise, so none of this
   crashes — but "ignores" is not good enough:

     - EXPLORER counts unique district ids. Thirteen dead ones
       satisfy the new target of eight without the visitor
       entering a single place that still exists.
     - ARCHIVIST and READING UP count unique landmark ids, and
       the old archive ring alone would unlock both from
       landmarks that are now open water.
     - a best time and a "completed" flag for a mini-game that no
       longer exists are rows the map and the HUD read back and
       that nothing can ever clear.

   So stored ids are filtered against what the world actually
   builds today. Everything the drawing kept is kept: settings,
   every race time, distance, time played, and every achievement
   still on the list.
   ============================================================ */

/**
 * The ids the world can still produce. Built on demand rather than at
 * module scope: `content/world` sits in an import cycle with
 * `world-layout`, and reading its exports while it is mid-evaluation
 * is how that cycle turns into a set full of `undefined`.
 */
function liveIds() {
  const districtIds = new Set<string>(districts.map((d) => d.id))
  const noteIds = new Set<string>(devNotes.map((n) => n.id))

  const landmarkIds = new Set<string>(landmarks.map((l) => l.id))
  // The plinth ring and the play spots are landmarks the engine
  // synthesises at load, so they are not in `landmarks` and would
  // otherwise be stripped out of a save that legitimately holds them.
  for (const slug of FEATURED_SLUGS) landmarkIds.add(`project-${slug}`)
  for (const spot of PLAY_SPOTS) landmarkIds.add(`play-${spot.id}`)

  const secretIds = new Set<string>()
  for (const landmark of landmarks) if (landmark.secret) secretIds.add(landmark.id)
  for (const district of districts) if (district.secret) secretIds.add(district.id)
  // Playground files these two by hand rather than through a landmark.
  secretIds.add('timeMachine')
  secretIds.add('blackHole')

  return { districtIds, landmarkIds, noteIds, secretIds }
}

/**
 * Exhaustive by construction: adding a `MinigameId` without adding it
 * here is a type error. A hand-kept list is the only part of this
 * migration that could silently drift behind the mini-games folder,
 * and a drifted entry would delete a real best time.
 */
const LIVE_MINIGAMES: Record<MinigameId, true> = {
  circuit: true,
  labyrinth: true,
  bowling: true,
  domino: true,
}

function migrateToDrawnIsland(out: SaveData): void {
  const { districtIds, landmarkIds, noteIds, secretIds } = liveIds()
  const progress = out.progress

  progress.districts = progress.districts.filter((id) => districtIds.has(id))
  progress.landmarks = progress.landmarks.filter((id) => landmarkIds.has(id))
  progress.notes = progress.notes.filter((id) => noteIds.has(id))
  progress.secrets = progress.secrets.filter((id) => secretIds.has(id))

  // Set-typed achievements persist the ids they counted, so each one is
  // filtered against the same inventory its counter is fed from — the
  // stored array IS the progress, and an unfiltered one is progress
  // towards places that no longer exist. CONES is deliberately absent:
  // its members are `cone-<index>` against a field the world still
  // regenerates, so the count it holds still means something.
  const countedIds: Record<string, Set<string>> = {
    explorer: districtIds,
    projects: landmarkIds,
    archivist: landmarkIds,
    notes: noteIds,
  }
  for (const [id, live] of Object.entries(countedIds)) {
    const stored = progress.achievements[id]
    if (Array.isArray(stored)) progress.achievements[id] = stored.filter((v) => live.has(v))
  }

  // Whole awards whose trigger left with its district. `Achievements`
  // already refuses ids it does not know, so this changes nothing the
  // visitor can see; it stops the blob carrying a tail of dead awards
  // into every future version, on a storage that has a quota.
  // `hasOwn`, not a truthiness test: a blob is arbitrary JSON, and an
  // id of "constructor" would otherwise read as a live achievement off
  // `Object.prototype`.
  for (const id of Object.keys(progress.achievements)) {
    if (!Object.hasOwn(achievementById, id)) delete progress.achievements[id]
  }

  for (const id of Object.keys(progress.bestTimes)) {
    if (!Object.hasOwn(LIVE_MINIGAMES, id)) delete progress.bestTimes[id]
  }
  progress.completedGames = progress.completedGames.filter((id) => Object.hasOwn(LIVE_MINIGAMES, id))

  // To a visitor a stored respawn is a PLACE, and half the named places
  // on the old island are open water on this one. Anything that is not
  // still a respawn point goes back to the landing rather than putting
  // a returning car down in the sea.
  if (!progress.lastRespawn || !respawns.some((r) => r.id === progress.lastRespawn)) {
    progress.lastRespawn = SPAWN_RESPAWN
  }
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

  const board = Array.isArray(progress.raceBoard) ? progress.raceBoard : []
  out.progress.raceBoard = board
    .filter(isRecord)
    .map((entry) => ({ time: numberOr(entry.time, 0), at: numberOr(entry.at, 0) }))
    .filter((entry) => Number.isFinite(entry.time) && entry.time > 0)
    .sort((a, b) => a.time - b.time)
    .slice(0, 10)
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

  /* ---- version fix-ups -------------------------------------
     Applied to the COERCED result rather than to `raw`, so each one
     starts from a fully typed blob and only has to think about the
     one thing its version changed. Never a wholesale discard: the
     visitor has no account, so their save file is the only copy of
     everything they have done here.
     ---------------------------------------------------------- */

  // 1 → 2: the circuit leaderboard. A version-1 blob kept a bare list
  // of times with no dates; `at: 0` means "before this site kept
  // dates", which the board renders as a dash rather than as 1
  // January 1970. Left ungated on purpose — it is a no-op on any blob
  // that already has a board, and cheap insurance for one that was
  // written between the two fields.
  if (!out.progress.raceBoard.length && out.progress.raceHistory.length) {
    out.progress.raceBoard = out.progress.raceHistory.map((time) => ({ time, at: 0 }))
  }

  // 2 → 3: the island was redrawn from the hand-drawn map.
  if (version < 3) migrateToDrawnIsland(out)

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
