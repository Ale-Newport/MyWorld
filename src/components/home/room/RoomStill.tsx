import styles from './room.module.css'

/** A light first frame, kept underneath the live canvas until it is ready. */
export function RoomStill({ start = false }: { start?: boolean }) {
  const name = start ? 'still-start' : 'still'
  return (
    <picture>
      {start && <>
        <source media="(min-aspect-ratio: 21/9)" srcSet="/home-room/still-start-wide.webp" />
        <source media="(min-aspect-ratio: 17/10)" srcSet="/home-room/still-start-landscape.webp" />
        <source media="(min-aspect-ratio: 1/1)" srcSet="/home-room/still-start-laptop.webp" />
        <source media="(min-aspect-ratio: 3/5)" srcSet="/home-room/still-start-tablet.webp" />
      </>}
      <source media="(max-aspect-ratio: 4/5)" srcSet={`/home-room/${name}-portrait.webp`} />
      <img className={styles.still} src={`/home-room/${name}-landscape.webp`} alt="" decoding="async" fetchPriority="high" />
    </picture>
  )
}

/** Server-visible placeholder while the WebGL code is being downloaded. */
export function RoomLoading() {
  return <div className={styles.host} aria-hidden="true"><RoomStill start /></div>
}
