/* ============================================================
   WHAT THE VISITOR IS TOLD WHILE THE ISLAND STARTS

   Pure on purpose: no DOM, no React, no imports, so `node --test`
   can read it (tests/world/loading-stages.test.mjs) and so the
   numbers cannot drift from the runtime's without a test noticing.

   The runtime (public/archipelago/preview/main.js) reports
   `archipelago:progress {stage, value, step, of}`. The sprig on the
   leaves lights one mark per COMPLETED step. Only completed steps are
   claims about the world: the step in progress just charges, slowly,
   on its own clock (a CSS ease whose length is `ETA`), because most
   of a step's inside is not knowable from out here — the longest is
   one synchronous block of work with no one to report it.

   An old runtime sends only `value`: `MILESTONES` says at which value
   each step has completed. A runtime that never answers sends
   nothing: the sprig simply stays at its first mark.
   ============================================================ */

/** Marks on the sprig; the last one lights only when the world is ready. */
export const MARKS = 8

/**
 * Legacy runtimes (no `step`/`of`): the progress `value` at which step k (1…7) has
 * completed. They are the values main.js posts when the NEXT step begins:
 * .06 loading the island · .52 building it · .66 applying the saved world ·
 * .76 placing the activities (the car starts at .80, still the same step) ·
 * .86 preparing the car and the plane · .93 compiling · .98 the first frame.
 * The eighth mark is `ready` itself.
 */
export const MILESTONES = [0.06, 0.52, 0.66, 0.76, 0.86, 0.93, 0.98] as const

/**
 * How long each step usually takes on average hardware, in ms, indexed by the mark that is
 * charging (the first unlit one). Only the length of an ease: it never reaches "lit" by itself.
 */
export const ETA = [1800, 5200, 3600, 2600, 2200, 1500, 900, 700] as const

/** The line under "the island is waking up", by number of lit marks. */
export const COPY = [
  'Opening the gate',
  'Raising the island from the sea',
  'Planting trees and laying roads',
  'Setting every sign and stone',
  'Opening the attractions',
  'Tuning the engines',
  'Catching the light',
  'Almost there',
] as const

export const READY_COPY = 'The island is ready'
export const QUIET_COPY = 'Still loading — a slow connection needs a little longer'

/** No word from the runtime for this long: say so (it is not a failure, and it is not "ready"). */
export const QUIET_MS = 25_000

/** Steps completed according to a legacy progress value. */
export const litCount = (value: number): number => {
  let n = 0
  for (const m of MILESTONES) if (value >= m - 1e-9) n++
  return n
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * Marks lit by one progress message: `step` of `of` when the runtime says so
 * (rescaled to the marks on the sprig), otherwise derived from `value`. Never
 * the last mark: that one is the runtime's `ready`.
 */
export function marksFor(msg: { value?: unknown; step?: unknown; of?: unknown }): number {
  const step = num(msg.step)
  const of = num(msg.of)
  const derived = step !== null && of !== null && of > 0
    ? Math.floor((Math.max(0, step) / of) * MARKS + 1e-9)
    : litCount(Math.min(1, Math.max(0, num(msg.value) ?? 0)))
  return Math.min(MARKS - 1, Math.max(0, derived))
}

export interface LoadingSnapshot {
  /** Marks lit: never decreases until `reset()`. */
  readonly lit: number
  readonly ready: boolean
  /** The runtime has been silent for QUIET_MS (a slow link, not a failure). */
  readonly quiet: boolean
}

/** The second line of the loader for a snapshot. Announced by the live region, too: stage names only, never a percentage. */
export const copyAt = (s: LoadingSnapshot): string => (s.ready ? READY_COPY : s.quiet ? QUIET_COPY : COPY[Math.min(COPY.length - 1, s.lit)])

/* ============================================================
   WHAT THE VISITOR READS WHEN THE ISLAND CANNOT START

   The runtime's own words ("Failed to fetch", a stack line, an asset
   name) are for the analytics: a visitor is told in plain words what
   to do. `plainError` sorts a message into one of three, by what the
   visitor can do about it, and never shows anything it did not write.
   ============================================================ */

export const ERROR_COPY = {
  network: 'The island could not be downloaded. Check your connection and try again.',
  graphics: 'This device stopped drawing the island. Try again, or close other tabs first.',
  start: 'The island did not wake up. Trying again usually fixes it.',
} as const

/** The route's own words for a runtime that loaded but never introduced itself. */
export const NO_START = 'The world’s runtime did not start.'

export function plainError(message: unknown): string {
  const text = typeof message === 'string' ? message : ''
  if (text === NO_START) return ERROR_COPY.start
  if (/graphics|webgl|gpu|context (was )?lost/i.test(text)) return ERROR_COPY.graphics
  // A fetch that never reached the server, an HTTP status, a stalled or cut transfer.
  if (/failed to fetch|network|load failed|fetch|offline|timed? ?out|aborted|\bhttp \d{3}\b|\b[45]\d\d\b|err_|download/i.test(text)) return ERROR_COPY.network
  return ERROR_COPY.start
}

const START: LoadingSnapshot = { lit: 0, ready: false, quiet: false }

/**
 * A tiny external store for the loader. Messages arrive far more often than
 * anything changes on screen (the runtime may post one per network chunk), so
 * the snapshot is replaced only when a mark, `ready` or `quiet` actually
 * changes: React renders about ten times in a whole start, not once per message.
 */
export function createLoadingStore() {
  let snap: LoadingSnapshot = START
  const listeners = new Set<() => void>()
  const commit = (next: Partial<LoadingSnapshot>) => {
    if ((next.lit === undefined || next.lit === snap.lit) && (next.ready === undefined || next.ready === snap.ready) && (next.quiet === undefined || next.quiet === snap.quiet)) return false
    snap = { ...snap, ...next }
    listeners.forEach((fn) => fn())
    return true
  }
  return {
    get: () => snap,
    server: () => START,
    subscribe(fn: () => void) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    /** One `archipelago:progress` message. Returns true when something on screen changed. */
    report(msg: { value?: unknown; step?: unknown; of?: unknown }): boolean {
      if (snap.ready) return false
      return commit({ lit: Math.max(snap.lit, marksFor(msg)), quiet: false })
    },
    /** `archipelago:ready`: every mark lights. */
    ready: () => commit({ lit: MARKS, ready: true, quiet: false }),
    /** `on` only when it changes anything, so re-arming a timer is free. */
    quiet: (on: boolean) => (snap.ready ? false : commit({ quiet: on })),
    /** A retry starts again from the first mark. */
    reset() {
      if (snap === START) return
      snap = START
      listeners.forEach((fn) => fn())
    },
  }
}

export type LoadingStore = ReturnType<typeof createLoadingStore>
