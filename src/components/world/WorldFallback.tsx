import Link from 'next/link'
import { districts, landmarks, resolvePanel } from '@/content/world'
import { profile } from '@/content/profile'
import styles from './fallback.module.css'

/* ============================================================
   THE WORLD, WITHOUT THE WORLD

   Server-rendered, in the DOM, visible to a screen reader and a
   crawler, and hidden from sighted visitors once the canvas takes
   over. Every district and every landmark that carries content is
   listed here with the same copy the 3D panels show, so nothing
   in the world is reachable only by driving.

   This is not a courtesy stub. It is the accessibility contract
   for the route: if it is in the world, it is in this list.
   ============================================================ */

export function WorldFallback() {
  const withContent = landmarks.filter((l) => l.interaction === 'panel' || l.interaction === 'project')

  return (
    <div className={styles.fallback}>
      <header className={styles.head}>
        <h1>{profile.name} — the interactive world</h1>
        <p>
          A drivable map of the same work described on the{' '}
          <Link href="/">main portfolio</Link>. It needs WebGL, a reasonably recent browser and
          either a keyboard, a touchscreen or a gamepad. Everything it contains is written out
          below, and every project links to its full case study.
        </p>
      </header>

      <section>
        <h2>Districts</h2>
        <dl>
          {districts.map((district) => (
            <div key={district.id}>
              <dt>{district.label}</dt>
              <dd>{district.blurb}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h2>What is in it</h2>
        {withContent.map((landmark) => {
          const panel = resolvePanel(landmark)
          if (!panel) return null
          return (
            <article key={landmark.id}>
              <h3>{panel.title}</h3>
              {panel.eyebrow && <p>{panel.eyebrow}</p>}
              {panel.lines.filter(Boolean).map((line, i) => (
                <p key={i}>{line}</p>
              ))}
              {panel.metrics.length > 0 && (
                <ul>
                  {panel.metrics.map((metric) => (
                    <li key={metric.label}>
                      {metric.value} — {metric.label}
                    </li>
                  ))}
                </ul>
              )}
              {panel.projectSlug && (
                <p>
                  <Link href={`/#project/${panel.projectSlug}`}>Read the full case study</Link>
                </p>
              )}
            </article>
          )
        })}
      </section>

      <section>
        <h2>Controls</h2>
        <ul>
          <li>WASD or the arrow keys to drive</li>
          <li>Shift to boost, B or Ctrl to brake</li>
          <li>Space to jump; number keys for individual corners</li>
          <li>Enter to interact when a prompt appears</li>
          <li>M for the map, K for achievements, R to respawn, H for the horn, L to mute</li>
          <li>Drag to orbit the camera, scroll to zoom, Escape to pause</li>
          <li>On touch: drag anywhere to drive, tap the car to jump, two fingers to move the camera</li>
        </ul>
      </section>
    </div>
  )
}
