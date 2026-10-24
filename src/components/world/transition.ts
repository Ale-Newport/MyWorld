import { garden } from '@/components/home/botanical/garden'
import { standing } from '@/components/home/room/canopy/standing'
import { heldKey } from './lock-keys'

/* ============================================================
   THE WAY INTO THE WORLD — one state machine for the whole site

     HOME ─begin→ COVERING ─(cover verified on screen)→ COVERED
          ─(URL becomes /world, world starts loading)→ LOADING_WORLD
          ─(world reports its first prepared frame)→ WORLD_READY
          ─(leaves part)→ REVEALING ─(parted)→ IN_WORLD

   and from LOADING_WORLD, ERROR (the leaves stay closed; retry or
   go home). World bytes may be cached on approach, but no world runtime
   is evaluated and no world renderer runs before COVERED. Bytes are warmed only
   while the visitor is still on the way (prepare.ts: the scroll approach, a hover
   or focus): from COVERING on the frame is a second or two away and fetches
   everything itself, so nothing is started here. COVERED is not
   "the charge reached 1" or "a timer ran out" — the cover itself
   checks, after a frame has actually been presented, that its
   opaque layer is fully opaque and spans the whole viewport (see
   CanopyCover.whenCovered). WORLD_READY is not a timeout either:
   the world posts it after its models, textures, shaders, physics
   and vehicle are up and a real frame has been drawn.

   THE DOOR IS CLOSED WHILE THE LEAVES ARE. From COVERING until the
   first parting frame (and through ERROR) nothing behind them can be
   scrolled, focused, read out or clicked:
     · scrolling, bouncing and pull-to-refresh are held by CSS keyed on
       `html[data-world-phase]` (globals.css), and pan and pinch by the
       cover's own `touch-action` (every gesture starts on it) — the
       browser scrolls on a thread that keeps working while the world
       blocks this one, so only declarations hold; Lenis is stopped from
       the same `world:phase` event (hooks/useLenisScroll);
     · every child of <body> that is not part of the cover, the loader
       or the error dialog is made `inert` (lockPage) — a frame after the
       rest, which is a style recalculation of the whole page — and stays
       so while the route swaps underneath;
     · until that pass has run, which on the homepage is a second or so, a
       transparent sheet stands over the page from the first frame (it takes
       the pointer and the touch), the keys that act on a page are held
       (Tab, Enter, Space, the arrows: `deaf`) and nothing outside the
       allow list keeps the focus. Whole-page inert is what makes this
       airtight; the sheet is what makes it airtight *now*, for the cost of one
       element.

   Module state on purpose: it has to outlive the homepage, which
   unmounts in the middle of the sequence, exactly like the cover.
   ============================================================ */

export type WorldPhase = 'HOME' | 'COVERING' | 'COVERED' | 'LOADING_WORLD' | 'WORLD_READY' | 'REVEALING' | 'IN_WORLD' | 'ERROR'

export interface TransitionState {
  phase: WorldPhase
  /** Where the visitor came from: the scroll portal, the index link, a 404 link… */
  source: string | null
  error: string | null
  /** performance.now() of each phase, for the QA traces. */
  marks: Partial<Record<WorldPhase, number>>
  /** The visitor asked for reduced motion: a plain fade, same guarantees. */
  reduced: boolean
  attempt: number
}

const INITIAL: TransitionState = { phase: 'HOME', source: null, error: null, marks: {}, reduced: false, attempt: 0 }
let state: TransitionState = INITIAL
const listeners = new Set<() => void>()
let navigate: ((href: string) => void) | null = null

function set(patch: Partial<TransitionState>) {
  const marks = patch.phase ? { ...state.marks, [patch.phase]: performance.now() } : state.marks
  state = { ...state, ...patch, marks }
  if (typeof window !== 'undefined') {
    document.documentElement.dataset.worldPhase = state.phase
    window.dispatchEvent(new CustomEvent('world:phase', { detail: state.phase }))
  }
  listeners.forEach((fn) => fn())
}

/** The canopy's darkest green: painted on <html> across the swap so no frame can show white between pages. */
const SEAM = '#0f1804'

/* ---- the lock ------------------------------------------------ */

/** What stays live under a closed door: the cover, whatever is marked `data-world-allow`
    (the loader, the status line, the error dialog) and the page's own plumbing. */
const ALLOW = '[data-world-cover],[data-world-allow],next-route-announcer,nextjs-portal,script,style,link,noscript,template,[hidden]'
/** Only what this lock made inert is ever made live again: an element that was inert for
    its own reasons (a closed overlay) is never touched. The value is what its `aria-hidden`
    said when it was taken, so a disclosure that was closed in the meantime (the index,
    `inert={!open}` in React) is left closed rather than reopened to the keyboard. */
const owned = new Map<HTMLElement, string | null>()
let locked = false
let watcher: MutationObserver | null = null
/** The pending pass that makes the page inert (see lockPage). */
let inertFrame = 0
/** The pass may be made (see lockPage: a heavy page waits for its cover). */
let inertAllowed = false
let inertTimer = 0
/** How long a heavy page waits for its cover before it is made inert regardless. */
const INERT_WAIT_MS = 600
/** The page behind is not inert yet (a heavy page waiting for its cover, or a pass that is scheduled): the keyboard and the focus
    are held by hand until it is. */
const pending = () => locked && (!inertAllowed || inertFrame !== 0)

/** The sheet that takes the pointer from the first frame of the way in (see lockPage): one transparent element over the page and under the
    cover (z-index 90, the loader above that), `data-world-allow` so that the inert pass leaves it alone, and `touch-action: none` so that no
    gesture that starts on it pans or zooms. Its box is written on the element itself, not by a stylesheet rule: a direct arrival can run this
    before its stylesheet has arrived, and an element that has no box takes nothing. It is one element: no style recalculation of the page. */
const SHIELD_STYLE = 'position:fixed;inset:0;z-index:89;contain:strict;touch-action:none;overscroll-behavior:none;-webkit-tap-highlight-color:transparent;cursor:default'
let shield: HTMLElement | null = null
function raiseShield() {
  if (shield?.isConnected) return
  const el = document.createElement('div')
  el.style.cssText = SHIELD_STYLE
  el.setAttribute('data-world-shield', '')
  el.setAttribute('data-world-allow', '')
  el.setAttribute('aria-hidden', 'true')
  document.body.appendChild(el)
  shield = el
}
function dropShield() {
  shield?.remove()
  shield = null
}

/** `frames` on, never in this one: not the frame that closes the door, nor the one that freezes the leaves. */
function inertSoon(frames = 2) {
  if (inertFrame) return
  const wait = (left: number) => {
    inertFrame = requestAnimationFrame(() => {
      if (left > 1) return wait(left - 1)
      inertFrame = 0
      if (locked) inertify()
    })
  }
  wait(frames)
}

/** The page behind may be made inert now (its cover is verified): in the next frame. */
function allowInert() {
  window.clearTimeout(inertTimer)
  inertTimer = 0
  inertAllowed = true
  inertSoon(1)
}

function inertify() {
  for (const el of Array.from(document.body.children) as HTMLElement[]) {
    if (el.hasAttribute('inert') || el.matches(ALLOW)) continue
    // Taken once; taken again if something else opened it meanwhile.
    if (!owned.has(el)) owned.set(el, el.getAttribute('aria-hidden'))
    el.setAttribute('inert', '')
  }
}

/** While the door is closed no page-level shortcut (the index on `i`, Escape, the arrows)
    may answer: only the dialog and the cover hear the keyboard. Until the page is inert, the key's own
    action is held as well (Tab would put the focus on a link behind the leaves, Enter would follow it) —
    but the browser's own shortcuts (reload, find, history, zoom) are never touched. */
const deaf = (e: KeyboardEvent) => {
  if (e.target instanceof Element && e.target.closest('[data-world-allow],[data-world-cover]')) return
  e.stopImmediatePropagation()
  if (pending() && heldKey(e)) e.preventDefault()
}

/** Focus that lands on the page behind the leaves while it is not inert yet (a script, a pointer that got through) is taken off at once. */
const keepFocusOut = (e: FocusEvent) => {
  if (!pending()) return
  const target = e.target
  if (target instanceof HTMLElement && !target.closest(ALLOW)) target.blur()
}

/**
 * Closes (or reopens) the page behind the leaves. Document-level rather than a
 * list of selectors, and re-applied while locked, so the route swap — which puts
 * a new page in <body> under a standing cover — cannot open a gap.
 *
 * What closes at once: the keyboard (`deaf`), scrolling and gestures (the CSS keyed
 * on `html[data-world-phase]`, written by `set`, and the pointer's own sheet), the
 * pointer (the sheet: `raiseShield`) and the focus (taken off whatever has it).
 * Making every child of <body> inert is a style recalculation of the whole page — 5 ms
 * here, 20 ms on a phone-class CPU, for the homepage's 1,400 elements — and it is not paid
 * in the frame that closes the door, nor the one that freezes the leaves, nor the one that
 * verifies them: a `heavy` page (the homepage, which is under the leaves from COVERING) waits
 * for its cover to be verified (`allowInert`, from the machine) — by then it cannot be seen,
 * and the frame that pays for it is the first of the world's own start — or for INERT_WAIT_MS,
 * whichever comes first. The window between is shut by the things above, none of which touch
 * the page's styles: that is the whole of the lock for a second, and not a gap in it. Anything
 * else (the route swapped under a standing cover, a small page) is made inert two frames
 * after it appears.
 */
function lockPage(on: boolean, heavy = false) {
  if (typeof document === 'undefined') return
  if (on) {
    if (!locked) {
      window.addEventListener('keydown', deaf, true)
      window.addEventListener('keyup', deaf, true)
      window.addEventListener('focusin', keepFocusOut, true)
      inertAllowed = !heavy
      locked = true
      if (heavy) raiseShield()
      // Whatever has the focus leaves with the page: the link that was just pressed, or the text page a Tab before the script ran
      // opened over the leaves (a direct arrival). It does not stay to be pressed again.
      const held = document.activeElement
      if (held instanceof HTMLElement && held !== document.body && !held.closest(ALLOW)) held.blur()
    }
    locked = true
    if (inertAllowed) inertSoon()
    else if (!inertTimer) inertTimer = window.setTimeout(allowInert, INERT_WAIT_MS)
    if (!watcher && typeof MutationObserver !== 'undefined') {
      // New children (the route swap) and an `inert` taken off one (a disclosure that opens).
      watcher = new MutationObserver(() => { if (locked && inertAllowed) inertSoon() })
      watcher.observe(document.body, { childList: true, attributes: true, attributeFilter: ['inert'], subtree: true })
    }
    return
  }
  if (locked) {
    window.removeEventListener('keydown', deaf, true)
    window.removeEventListener('keyup', deaf, true)
    window.removeEventListener('focusin', keepFocusOut, true)
  }
  cancelAnimationFrame(inertFrame)
  inertFrame = 0
  window.clearTimeout(inertTimer)
  inertTimer = 0
  inertAllowed = false
  locked = false
  watcher?.disconnect()
  watcher = null
  dropShield()
  for (const [el, hidden] of owned) {
    if (hidden !== 'true' && el.getAttribute('aria-hidden') === 'true') continue
    el.removeAttribute('inert')
  }
  owned.clear()
}

/* ---- leaving the sequence by the browser's own buttons ---------- */

/** A COVERED page whose navigation never completes is not a place to leave anyone. */
const COVERED_MS = 20_000
/** Nor is a cover that is still not verified after this long (a lost wait, a canopy that cannot be sealed). */
const COVERING_MS = 15_000
let popGuard: (() => void) | null = null
let coveredTimer = 0
/** The leaves are parting to uncover the page left for (Back, an error's exit). */
let uncovering = false

function unguard() {
  if (popGuard) window.removeEventListener('popstate', popGuard)
  popGuard = null
  window.clearTimeout(coveredTimer)
  coveredTimer = 0
}

/**
 * Back (or an edge swipe) before the route has committed never mounts the world, so
 * the world's own cleanup never runs: without this the home page comes back under a
 * cover that takes every click. Once the URL is not the world's any more, uncover.
 */
function guardHistory(href: string, watch?: 'COVERING' | 'COVERED') {
  unguard()
  popGuard = () => { if (inTransition() && window.location.pathname !== href) worldTransition.abort() }
  window.addEventListener('popstate', popGuard)
  if (watch) {
    coveredTimer = window.setTimeout(() => { if (state.phase === watch) worldTransition.abort() }, watch === 'COVERED' ? COVERED_MS : COVERING_MS)
  }
}

/**
 * A way in that starts while the leaves are still parting for the last way out (Back, then the link
 * again) meets a cover that is on its way off. It cannot be grown from leaves that are already open,
 * and when its parting ended it would put the cover away under the new way in (the page was left
 * locked with nothing over it). The parting is taken back instead: the leaves close again from
 * where they are, and the way in verifies them as it does any cover. A cover that is not
 * standing yet (it was still being fetched when the way out was taken) has nothing to take back
 * and is put away, so that what the way in does next shows a fresh one.
 */
function takeBackParting() {
  if (!uncovering) return
  uncovering = false
  if (!standing.close?.()) garden.hide()
}

/** Charge 0 → 1 with an immediate ease-out, for a cover nobody pushed (a link). */
function grow(ms: number) {
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms)
    if (state.phase !== 'COVERING') return
    garden.set(1 - (1 - t) ** 2)
    if (t < 1 && state.phase === 'COVERING') requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

export const worldTransition = {
  get: () => state,
  server: () => INITIAL,
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },

  /**
   * Starts the way in. Returns false if a transition is already under way
   * (a second scroll gesture, a double click), so nothing ever starts twice.
   */
  begin({ source, push, reduced = false, href = '/world' }: { source: string; push: (href: string) => void; reduced?: boolean; href?: string }): boolean {
    if (state.phase !== 'HOME') return false
    navigate = push
    takeBackParting()
    set({ phase: 'COVERING', source, error: null, reduced, attempt: 0, marks: {} })
    document.documentElement.style.background = SEAM
    lockPage(true, true)
    guardHistory(href, 'COVERING')
    // A cover already standing (the scroll portal grew it) is completed. From a
    // link, the leaves grow in over a second; with reduced motion the dark of the
    // hedge simply fades in. Either way the next step waits for the verified cover.
    if (reduced) {
      garden.show({ initial: 1, reduced: true })
      garden.set(1)
    } else if (garden.get().active && garden.charge() > 0.05) {
      // The scroll portal has been growing it: complete what is there.
      garden.set(1)
    } else {
      // A link (the index, the portal link): grow it in, from wherever it stands.
      garden.show({ initial: 0 })
      grow(900)
    }
    void garden.whenCovered().then(() => {
      if (state.phase !== 'COVERING') return
      set({ phase: 'COVERED' })
      // The leaves are verified and the page cannot be seen: now it is made inert (lockPage).
      allowInert()
      guardHistory(href, 'COVERED')
      // The homepage hands back its WebGL contexts (browsers cap live
      // contexts and the world wants one) before the route changes.
      window.dispatchEvent(new CustomEvent('journey:leaving'))
      navigate?.(href)
    })
    return true
  },

  /** A reload/new tab uses the same foliage mask, without a homepage to cover. */
  arrive(reduced = false) {
    if (state.phase !== 'HOME') return
    takeBackParting()
    garden.show({ initial: 1, reduced })
    // History navigation can reuse a canopy prepared invisibly on the home
    // page. show() preserves that instance; explicitly complete its charge.
    garden.set(1)
    set({ phase: 'COVERED', source: 'direct', reduced, marks: {} })
    // No homepage was covered here, but the leaves are just as closed — and the cover is a React render away: the sheet takes the pointer until it stands.
    document.documentElement.style.background = SEAM
    lockPage(true)
    raiseShield()
    guardHistory(window.location.pathname)
  },

  /** /world has mounted under a verified cover and is creating the world. */
  loading() {
    if (state.phase === 'COVERED' || state.phase === 'ERROR') {
      window.clearTimeout(coveredTimer)
      coveredTimer = 0
      lockPage(true)
      set({ phase: 'LOADING_WORLD', error: null })
    }
  },

  /**
   * The world drew its first prepared frame: part the leaves. The world is the
   * visitor's from the FIRST parting frame — `onReveal` (focus the world, tell it
   * to go live) runs then, not after the parting — and `onRevealed` once the leaves
   * are gone.
   */
  ready(onReveal?: () => void, onRevealed?: () => void) {
    if (state.phase !== 'LOADING_WORLD') return
    set({ phase: 'WORLD_READY' })
    set({ phase: 'REVEALING' })
    // The cover stops taking clicks as the parting begins (CanopyCover.open); the page
    // behind it opens at the same moment.
    lockPage(false)
    onReveal?.()
    garden.open(() => {
      garden.hide()
      document.documentElement.style.background = ''
      unguard()
      set({ phase: 'IN_WORLD' })
      onRevealed?.()
    })
  },

  fail(message: string) {
    if (state.phase !== 'LOADING_WORLD' && state.phase !== 'COVERED') return
    // The leaves stay closed, and so does everything behind them: the recovery
    // choices drawn over them are `data-world-allow` and the only things reachable.
    window.clearTimeout(coveredTimer)
    coveredTimer = 0
    lockPage(true)
    set({ phase: 'ERROR', error: message })
  },

  retry() {
    if (state.phase !== 'ERROR') return
    lockPage(true)
    set({ phase: 'LOADING_WORLD', error: null, attempt: state.attempt + 1 })
  },

  /** Leave the sequence (Back, "Return to the portfolio", an error): uncover whatever page is now showing. */
  abort() {
    // The leaves are already parting for this very exit (the history guard and the
    // world's own cleanup both ask): the second ask must not cut the parting short.
    if (state.phase === 'HOME' && uncovering) return
    unguard()
    lockPage(false)
    document.documentElement.style.background = ''
    if (state.phase === 'HOME' || state.phase === 'IN_WORLD') {
      garden.hide()
      set({ phase: 'HOME', source: null })
      return
    }
    uncovering = true
    garden.open(() => { uncovering = false; garden.hide() })
    set({ phase: 'HOME', source: null, error: null })
  },

  /** Back on the homepage after a completed visit. */
  reset() {
    if (state.phase === 'IN_WORLD') set({ phase: 'HOME', source: null })
  },
}

/** True once the leaves are closed or closing for the world: other overlays should stay away. */
export const inTransition = () => state.phase !== 'HOME' && state.phase !== 'IN_WORLD'
