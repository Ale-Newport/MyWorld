/* ============================================================
   THE COVER THAT IS STANDING

   A back channel from the mounted canopy cover to the world's state machine, kept in a module of its
   own so that the machine (which the /world bundle carries) never imports the canopy (which is
   downloaded on demand). The cover registers while it is mounted; the machine asks it to take a parting
   back when the way in is taken again while the leaves are still parting for the last way out
   (world/transition.ts).
   ============================================================ */

export const standing: {
  /** Close the leaves again from wherever the parting has got to. False: there is no parting to take back. */
  close: (() => boolean) | null
} = { close: null }
