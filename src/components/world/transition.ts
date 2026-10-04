import { garden } from '@/components/home/botanical/garden'

/* ============================================================
   THE WAY INTO THE WORLD — one state machine for the whole site

     HOME ─begin→ COVERING ─(cover verified on screen)→ COVERED
          ─(URL becomes /world, world starts loading)→ LOADING_WORLD
          ─(world reports its first prepared frame)→ WORLD_READY
          ─(leaves part)→ REVEALING ─(parted)→ IN_WORLD

   and from LOADING_WORLD, ERROR (the leaves stay closed; retry or
   go home). Nothing about the world is requested before COVERED:
   not its route, not its runtime, not its document. COVERED is not
   "the charge reached 1" or "a timer ran out" — the cover itself
   checks, after a frame has actually been presented, that its
   opaque layer is fully opaque and spans the whole viewport (see
   CanopyCover.whenCovered). WORLD_READY is not a timeout either:
   the world posts it after its models, textures, shaders, physics
   and vehicle are up and a real frame has been drawn.

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

function lockPage(locked: boolean) {
  for (const el of document.querySelectorAll('#journey, [data-hud], [data-world-shell]')) {
    if (locked) el.setAttribute('inert', '')
    else el.removeAttribute('inert')
  }
}

/** Charge 0 → 1 with an ease-in-out, for a cover nobody pushed (a link). */
function grow(ms: number) {
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms)
    garden.set(t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
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
    set({ phase: 'COVERING', source, error: null, reduced, attempt: 0, marks: {} })
    document.documentElement.style.background = SEAM
    lockPage(true)
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
      grow(1100)
    }
    void garden.whenCovered().then(() => {
      if (state.phase !== 'COVERING') return
      set({ phase: 'COVERED' })
      // The homepage hands back its WebGL contexts (browsers cap live
      // contexts and the world wants one) before the route changes.
      window.dispatchEvent(new CustomEvent('journey:leaving'))
      navigate?.(href)
    })
    return true
  },

  /** /world has mounted under a verified cover and is creating the world. */
  loading() {
    if (state.phase === 'COVERED' || state.phase === 'ERROR') set({ phase: 'LOADING_WORLD', error: null })
  },

  /** The world drew its first prepared frame: part the leaves. */
  ready(onRevealed?: () => void) {
    if (state.phase !== 'LOADING_WORLD') return
    set({ phase: 'WORLD_READY' })
    set({ phase: 'REVEALING' })
    garden.open(() => {
      garden.hide()
      document.documentElement.style.background = ''
      lockPage(false)
      set({ phase: 'IN_WORLD' })
      onRevealed?.()
    })
  },

  fail(message: string) {
    if (state.phase !== 'LOADING_WORLD' && state.phase !== 'COVERED') return
    // The leaves stay closed; the recovery choices drawn over them must be reachable.
    lockPage(false)
    set({ phase: 'ERROR', error: message })
  },

  retry() {
    if (state.phase !== 'ERROR') return
    lockPage(true)
    set({ phase: 'LOADING_WORLD', error: null, attempt: state.attempt + 1 })
  },

  /** Leave the sequence (Back, "Return to the portfolio", an error): uncover whatever page is now showing. */
  abort() {
    if (state.phase === 'HOME' || state.phase === 'IN_WORLD') {
      set({ phase: 'HOME', source: null })
      return
    }
    lockPage(false)
    document.documentElement.style.background = ''
    garden.open(() => garden.hide())
    set({ phase: 'HOME', source: null, error: null })
  },

  /** Back on the homepage after a completed visit. */
  reset() {
    if (state.phase === 'IN_WORLD') set({ phase: 'HOME', source: null })
  },
}

/** True once the leaves are closed or closing for the world: other overlays should stay away. */
export const inTransition = () => state.phase !== 'HOME' && state.phase !== 'IN_WORLD'
