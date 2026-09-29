import styles from './archipelago.module.css'

/** Isolate the complete HelloWorld runtime from the portfolio's React renderer. */
export function WorldRoute() {
  return (
    <div className={styles.route}>
      <iframe
        className={styles.player}
        src="/archipelago/preview/index.html"
        title="Archipiélago — explore Alejandro Newport’s world"
        allow="autoplay; fullscreen; gamepad"
        allowFullScreen
      />
    </div>
  )
}
