/* ============================================================
   ONE TICKER
   Every non-React animation on the site shares a single
   requestAnimationFrame loop. Fifteen chapters, the HUD, the
   cursor and the world theme would otherwise open nineteen of
   them — each cheap on its own, collectively pure waste.

   THE LOOP SLEEPS
   A subscriber that has nothing left to do for the moment returns
   `IDLE`. When every subscriber says so in the same pass the loop
   stops asking for frames altogether — a page left open on a
   chapter that is not moving costs no frames, no tasks, no style
   recalculation — and it starts again, in the same frame, on the
   next thing that could have changed what any of them shows: a
   wheel, a pointer, a touch, a key, a scroll, a resize, a tab coming
   back, or `wake()` called by a subscriber's own source of change
   (the room's engine when it is told something new, for instance).

   Returning `IDLE` is a promise that, with no input and no `wake()`,
   the next pass would draw exactly what the last one did. A
   subscriber that animates by the clock (an orbit drifting, a
   lattice turning) does not return it while it moves, and keeps the
   loop awake for as long as it moves (see AMBIENT below, which is
   how such motion comes to rest). A subscriber that returns nothing
   at all is exactly what it always was.

   AMBIENT MOTION COMES TO REST
   Motion that is only there to be alive, with nobody to see it do
   anything, is the one thing that could keep the loop awake for good:
   an orbit that drifts, a ribbon that breathes, a lattice that turns.
   `ambient(now)` is the pace such motion keeps: 1 while the visitor is
   about, and once they have been still for `AMBIENT_LINGER` seconds it
   slows over `AMBIENT_EASE` more to 0, where the subscriber may say
   IDLE. Any input puts it back to 1 at once (a drift that starts moving
   again at its ordinary speed is not a jump), so the first thing the
   visitor does after a pause is answered as quickly as ever. The
   scroll-driven motion, and everything that answers a pointer, is not
   ambient and never waits for this: it is drawn on the input that
   moves it.

   THE PACE OF THE LOOP
   A loop that sleeps has no frame rate until it runs, and the frames it
   runs are the page's own. `watchPace` judges a device by them: over
   consecutive frames of a loop that has been running without a pause
   (a wake, a hidden tab and a pause longer than a window all start the
   count again, because a page that had nothing to draw is not a slow
   one), it calls back once when two windows of `PACE_WINDOW` in a row
   average under `PACE_FLOOR` frames a second. That is the verdict the
   canvas's own governor used to give from its draw loop, which the home
   journey no longer runs; it costs a few additions per frame, only while
   somebody is watching, and never keeps the loop awake.
   ============================================================ */

/** What a subscriber returns when its next pass would change nothing. */
export const IDLE: unique symbol = Symbol('ticker.idle')

type TickFn = (dt: number, now: number) => void | typeof IDLE

const subscribers = new Set<TickFn>()
const labels = new Map<TickFn, string>()
/** The set as an array, rebuilt only when it changes (a subscriber may unsubscribe mid-pass). */
let snapshot: TickFn[] = []
let raf = 0
let last = 0
let passes = 0
let wakes = 0
/** When the visitor last did anything (performance.now): the clock of `ambient()`. */
let lastInput = 0
/** Who kept the last pass busy (recorded only when a QA harness asks, see the foot of the file). */
let busyNow: string[] = []
const wakeSources = new Map<string, number>()
/** `watchPace`: who is told, and the window being measured (frames and its start), and the slow windows so far. */
let paceFn: (() => void) | null = null
let paceFrames = 0
let paceSince = 0
let paceStrikes = 0
let paceFired = false
const debugOn = typeof window !== 'undefined' && !!(window as unknown as { __tickerDebug?: boolean }).__tickerDebug

/** Inputs that can change what a subscriber shows. */
const INPUTS = ['wheel', 'pointermove', 'pointerdown', 'pointerup', 'touchstart', 'touchmove', 'keydown', 'resize', 'visibilitychange', 'journey:layout', 'cms:content'] as const
let listening = false
let sizeObserver: ResizeObserver | null = null

/** The length (ms) of a window, the rate (frames a second) under which one is slow, and the gap (ms) after which a frame is the page having been away. */
const PACE_WINDOW = 2000
const PACE_FLOOR = 32
const PACE_PAUSE = PACE_WINDOW

/** One pass of a loop being watched; `gap` is the time since the pass before it, 0 if the loop had been asleep (and `paceSince` is 0 until a window has begun). */
function judge(now: number, gap: number) {
  if (!gap || !paceSince || gap > PACE_PAUSE || document.hidden) {
    paceFrames = 0
    paceSince = now
    return
  }
  paceFrames++
  const span = now - paceSince
  if (span < PACE_WINDOW) return
  if ((paceFrames * 1000) / span < PACE_FLOOR) {
    if (++paceStrikes >= 2) {
      const fn = paceFn
      paceFn = null
      paceFired = true
      fn?.()
    }
  } else {
    paceStrikes = 0
  }
  paceFrames = 0
  paceSince = now
}

/**
 * Calls `fn` once if the page's frames run slower than a device should let them (see THE PACE OF THE LOOP).
 * Returns the unsubscribe, which also ends the watch after it has fired.
 */
export function watchPace(fn: () => void): () => void {
  paceFn = fn
  paceFrames = 0
  paceSince = 0
  paceStrikes = 0
  paceFired = false
  return () => { if (paceFn === fn) paceFn = null }
}

function loop(now: number) {
  raf = 0
  const gap = last ? now - last : 0
  const dt = last ? Math.min(0.05, gap / 1000) : 1 / 60
  last = now
  passes++
  if (paceFn) judge(now, gap)
  let busy = false
  if (debugOn) busyNow = []
  for (const fn of snapshot) {
    if (fn(dt, now) !== IDLE) {
      busy = true
      if (debugOn) busyNow.push(labels.get(fn) ?? (fn.name || 'anonymous'))
    }
  }
  // A subscriber may have woken the loop itself during the pass (`raf` is set again).
  if (busy && !raf && subscribers.size) raf = requestAnimationFrame(loop)
  // Asleep: the next frame after a wake is a fresh start, not one long frame.
  if (!raf) last = 0
}

/**
 * Ask for a frame if the loop is asleep. Cheap enough to call from any event handler
 * (one comparison when the loop is running).
 */
export function wake(cause?: string) {
  if (raf || !subscribers.size || typeof window === 'undefined') return
  wakes++
  if (debugOn) {
    const from = cause ?? (new Error().stack ?? '').split('\n').slice(2, 5).map((l) => l.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\/_next\/static\//, '')).join(' < ')
    wakeSources.set(from, (wakeSources.get(from) ?? 0) + 1)
  }
  raf = requestAnimationFrame(loop)
}

const onInput = (e: Event) => {
  lastInput = performance.now()
  wake(e.type)
}

/** Seconds the visitor stays about, doing something, before ambient motion starts to slow. */
export const AMBIENT_LINGER = 8
/** Seconds it then takes to come to rest. */
export const AMBIENT_EASE = 2.5

/**
 * The pace of motion that is only there to be alive, for the frame at `now` (the time the
 * ticker passes its subscribers): 1 while the visitor has done something within the last
 * `AMBIENT_LINGER` seconds, then a smooth slowing to 0 over `AMBIENT_EASE`, and 0 after.
 * A subscriber multiplies the clock of its drift, breath or turn by it, and returns `IDLE`
 * once it is 0. An input sets it back to 1 at once, and wakes the loop.
 */
export function ambient(now: number): number {
  const quiet = (now - lastInput) / 1000 - AMBIENT_LINGER
  if (quiet <= 0) return 1
  const k = quiet / AMBIENT_EASE
  return k >= 1 ? 0 : 1 - k * k * (3 - 2 * k)
}

function listen() {
  if (listening || typeof window === 'undefined') return
  listening = true
  // The page has just started to be shown: that is as good as a visitor doing something.
  lastInput = performance.now()
  for (const type of INPUTS) window.addEventListener(type, onInput, { passive: true })
  // A scroller anywhere on the page, not just the document.
  window.addEventListener('scroll', onInput, { passive: true, capture: true })
  // The document growing or shrinking by itself (a font, an image, a chunk arriving).
  if (typeof ResizeObserver !== 'undefined') {
    sizeObserver = new ResizeObserver(() => {
      // What the scroll maps to has moved under a visitor who did nothing: show it, ambient motion included.
      lastInput = performance.now()
      wake('document-size')
    })
    sizeObserver.observe(document.documentElement)
  }
}

function unlisten() {
  if (!listening) return
  listening = false
  for (const type of INPUTS) window.removeEventListener(type, onInput)
  window.removeEventListener('scroll', onInput, { capture: true })
  sizeObserver?.disconnect()
  sizeObserver = null
}

/**
 * `label` only names the subscriber in `tickerStats()`.
 * Returns the unsubscribe.
 */
export function subscribe(fn: TickFn, label?: string): () => void {
  subscribers.add(fn)
  if (label) labels.set(fn, label)
  snapshot = Array.from(subscribers)
  if (typeof window !== 'undefined') {
    listen()
    if (!raf) {
      last = 0
      raf = requestAnimationFrame(loop)
    }
  }
  return () => {
    subscribers.delete(fn)
    labels.delete(fn)
    snapshot = Array.from(subscribers)
    if (subscribers.size === 0) {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      unlisten()
    }
  }
}

/** Subscriber count — used by the dev overlay only. */
export const tickerSize = () => subscribers.size

/** What the loop is doing: for QA probes (see `window.__ticker` below). */
export const tickerStats = () => ({ subscribers: subscribers.size, running: raf !== 0, passes, wakes, busy: busyNow.slice(), wakeSources: Object.fromEntries(wakeSources), pace: { watching: paceFn !== null, slow: paceFired, strikes: paceStrikes } })

/* A QA harness sets `window.__tickerDebug` before the page loads to read the loop's state
   (`window.__ticker()`): which subscribers kept the last pass busy, how many passes ran, how
   often it was woken. Nothing is exposed or recorded otherwise. */
if (debugOn) (window as unknown as { __ticker?: typeof tickerStats }).__ticker = tickerStats
