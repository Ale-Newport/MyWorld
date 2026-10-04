import type { Lens } from './render/camera'

/* ============================================================
   THE ROOM'S VIEW, published
   The portal's canopy is drawn in its own layer (above the copy, in
   the root layout) but through the room's own lens, so the ivy that
   closes over the page is continuous with the ivy on the walls. The
   engine publishes the fitted lens each time it relights.
   ============================================================ */

export interface RoomView {
  lens: Lens
  aspect: number
  /** The lens's distance from the back wall, metres. */
  distance: number
  /** The layout class's leaf scale (phones draw finer leaves). */
  foliage: number
}

let current: RoomView | null = null
const listeners = new Set<() => void>()

export const roomView = {
  get: () => current,
  set(view: RoomView) {
    current = view
    listeners.forEach((fn) => fn())
  },
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
}
