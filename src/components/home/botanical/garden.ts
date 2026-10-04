import type { CoverHandle } from '@/components/home/room/canopy/CanopyCover'

/* ============================================================
   THE GARDEN COVER — one instance for the whole site

   The ivy that closes over the homepage is the same ivy the world
   arrives under. Not a copy drawn again on the other side: the same
   DOM, mounted once in the root layout (`GardenCover`), so the route
   can change underneath it without anything being rebuilt or drawn
   again — which is exactly the work that would otherwise land on
   top of the world starting up. (The canopy is drawn live while
   the charge builds, and frozen into plain canvases the moment it
   is full: see `room/canopy/CanopyCover`.)

   The homepage shows it and drives its charge; the world parts it
   when it is ready and puts it away.
   ============================================================ */

export interface GardenState {
  active: boolean
  /** Starting charge when it mounts: 1 for an arrival nobody watched grow. */
  initial: number
  budget: number
}

let state: GardenState = { active: false, initial: 0, budget: 1 }
/** The server never has leaves standing; one object, so React sees a stable snapshot. */
const SERVER: GardenState = { active: false, initial: 0, budget: 1 }
const listeners = new Set<() => void>()
let handle: CoverHandle | null = null
let charge: number | null = null
let opening: (() => void) | null = null
let openPending = false

const emit = () => listeners.forEach((fn) => fn())

export const garden = {
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  get: () => state,
  server: () => SERVER,

  show(opts: Partial<Omit<GardenState, 'active'>> = {}) {
    if (state.active) return
    state = { ...state, ...opts, active: true }
    emit()
  },
  hide() {
    // A parting asked for after the cover went away must not carry
    // over to the next one shown.
    opening = null
    openPending = false
    if (!state.active) return
    state = { ...state, active: false }
    handle = null
    charge = null
    emit()
  },
  /** The charge, 0..1 — held until the cover has mounted. */
  set(c: number) {
    charge = c
    handle?.set(c)
  },
  /** Part the leaves, then call back once they are gone. */
  open(done: () => void) {
    opening = done
    if (handle) handle.open()
    else openPending = true
  },
  /** For `GardenCover`: the mounted cover reports in. */
  attach(h: CoverHandle | null) {
    handle = h
    if (!h) return
    if (charge !== null) h.set(charge)
    if (openPending) {
      openPending = false
      h.open()
    }
  },
  /** For `GardenCover`: the cover has finished parting. */
  opened() {
    const done = opening
    opening = null
    done?.()
  },
}
