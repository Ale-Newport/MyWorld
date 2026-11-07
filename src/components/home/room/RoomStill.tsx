import styles from './room.module.css'

/* ============================================================
   NO START FRAME, ONLY A FALLBACK

   The room is composed for the screen it covers — the lens is
   fitted to the HUD, the gutters and the copy — so a picture of it
   taken at one size is wrong at every other: at 1280×720 a frame
   rendered at 1920×1080 stood its pilasters at the edges where the
   live room has none, and its wall's foot a row lower. Shown under
   the canvas while WebGL prepared, it was the columns "moving to
   fit the screen" a second after every load. The first paint is
   the wall's plain tone instead (`.host` in room.module.css), and
   the room fades in over it once its light has converged.

   The stills remain for the one case they are for: no WebGL, or a
   context that is lost for good. They are requested only then.
   ============================================================ */

/** The fallback frame, when WebGL cannot draw the room. */
export function RoomStill() {
  return (
    <picture>
      <source media="(max-aspect-ratio: 4/5)" srcSet="/home-room/still-portrait.webp" />
      <img className={styles.still} src="/home-room/still-landscape.webp" alt="" decoding="async" />
    </picture>
  )
}

/** Server-visible placeholder while the WebGL code is being downloaded: the wall's own tone. */
export function RoomLoading() {
  return <div className={styles.host} aria-hidden="true" />
}
