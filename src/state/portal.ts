/* ============================================================
   THE PORTAL'S NUMBERS
   The gateway at the foot of the home journey (WorldPortal) writes
   these every frame; the contact chapter retreats by them and the
   home room is taken over by them. Plain module state, read inside
   frame loops — like `frame` — so that none of those readers has to
   import the gateway itself (its router, its link, its cover).
   ============================================================ */

export const portal = {
  /** The gateway's charge, 0..1 (1 = through). */
  pull: 0,
  /** Pixels the page is currently being held back by. */
  drag: 0,
}
