import Link from 'next/link'
import { profile } from '@/content/profile'
import styles from './fallback.module.css'

/** An accessible alternative to the canvas, kept in sync with Archipelago. */
export function WorldFallback() {
  return (
    <div className={styles.fallback}>
      <header className={styles.head}>
        <h1>Archipiélago — {profile.name}</h1>
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
          <li>Space or B to brake; double Space to switch between car and plane.</li>
          <li>E or Enter to interact; Escape to leave an activity.</li>
          <li>M or Tab for the map, K for achievements, R to respawn, C for the camera.</li>
          <li>In the plane: W/S for speed, A/D to turn and Q/E for pitch.</li>
        </ul>
      </section>
    </div>
  )
}
