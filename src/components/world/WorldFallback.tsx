import Link from 'next/link'
import styles from './fallback.module.css'

/** An accessible alternative to the canvas, kept in sync with Archipelago. */
export function WorldFallback({ name }: { name: string }) {
  return (
    <div className={styles.fallback}>
      <header className={styles.head}>
        <h1>Archipiélago — {name}</h1>
        <p>
          Drive and fly around my island. Discover projects and experiments,
          education and career, social links and achievements. Race on the
          circuit, go bowling, explore the ice rink and take on the loop.
        </p>
        <p>
          The interactive world needs WebGL and a recent browser. You can also
          read about my work on the <Link href="/">main portfolio</Link>.
        </p>
      </header>
      <section>
        <h2>Controls</h2>
        <ul>
          <li>WASD or arrow keys to drive; Shift to boost.</li>
          <li>Space to jump, held to keep the wheels raised; B or Control to brake; Space twice to switch between car and plane.</li>
          <li>E or Enter to interact; Escape to leave an activity.</li>
          <li>M or Tab for the map: select a place, or any point of the island, to travel there (Escape closes it).</li>
          <li>R to get back on your wheels nearby, K for achievements, C for the camera.</li>
          <li>In the plane: W/S for speed, A/D to turn and Q/E for pitch.</li>
        </ul>
      </section>
    </div>
  )
}
