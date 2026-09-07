'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useStore } from 'zustand'
import type { WorldStore } from '@/world/state/store'
import type { Game } from '@/world/Game'
import { profile } from '@/content/profile'
import styles from './world.module.css'

/* ============================================================
   LOADER

   A readout, not a spinner. Each subsystem reports when it is up,
   and the visitor presses ENTER when everything is ready — which
   also gives the browser the user gesture the audio context needs
   before it will make a sound.

   The controls card underneath is the whole tutorial. It shows
   once, on a first visit, and fades the moment the car moves.
   ============================================================ */

interface Props {
  store: WorldStore
  getGame: () => Game | null
}

const CONTROLS: { key: string; label: string; mode?: 'keyboard' | 'touch' | 'gamepad' }[] = [
  { key: 'WASD / ARROWS', label: 'Drive', mode: 'keyboard' },
  { key: 'SHIFT', label: 'Boost', mode: 'keyboard' },
  { key: 'SPACE', label: 'Jump', mode: 'keyboard' },
  { key: 'DRAG', label: 'Camera', mode: 'keyboard' },
  { key: 'ENTER', label: 'Interact', mode: 'keyboard' },
  { key: 'M', label: 'Map', mode: 'keyboard' },
  { key: 'DRAG', label: 'Drive', mode: 'touch' },
  { key: 'TAP CAR', label: 'Jump', mode: 'touch' },
  { key: 'TWO FINGERS', label: 'Camera', mode: 'touch' },
  { key: 'LEFT STICK', label: 'Drive', mode: 'gamepad' },
  { key: '○', label: 'Boost', mode: 'gamepad' },
  { key: '△', label: 'Jump', mode: 'gamepad' },
  { key: '✕', label: 'Interact', mode: 'gamepad' },
  { key: 'RIGHT STICK', label: 'Camera', mode: 'gamepad' },
]

export function WorldLoader({ store, getGame }: Props) {
  const steps = useStore(store, (s) => s.steps)
  const loaded = useStore(store, (s) => s.loaded)
  const entered = useStore(store, (s) => s.entered)
  const fatal = useStore(store, (s) => s.fatal)
  const inputMode = useStore(store, (s) => s.inputMode)
  const [leaving, setLeaving] = useState(false)

  const enter = () => {
    if (!loaded || leaving) return
    setLeaving(true)
    // Let the fade play before the HUD arrives.
    window.setTimeout(() => store.getState().setEntered(true), 520)

    // This click is the user gesture the browser requires before an
    // AudioContext will start. There is no other moment to take it,
    // and asking earlier just fails silently.
    getGame()?.enableAudio()
    getGame()?.markOnboarded()
  }

  // ENTER on the keyboard does what the button does.
  useEffect(() => {
    if (entered || fatal) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        enter()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entered, fatal, loaded, leaving])

  if (entered) return null

  const controls = CONTROLS.filter((c) => c.mode === inputMode)

  return (
    <div className={styles.loader} data-leaving={leaving ? 'true' : 'false'} role="dialog" aria-label="Enter the world">
      <div className={styles.loaderInner}>
        <p className={styles.loaderEyebrow}>{profile.name}</p>
        <h1 className={styles.loaderTitle}>
          THE
          <br />
          WORLD
        </h1>

        {fatal ? (
          <div className={styles.loaderFatal}>
            <p>{fatal}</p>
            <Link href="/" className={styles.loaderExit}>
              Back to the portfolio →
            </Link>
          </div>
        ) : (
          <>
            <ul className={styles.loaderSteps} aria-label="Loading progress">
              {steps.map((step) => (
                <li key={step.id} className={styles.loaderStep} data-done={step.done}>
                  <span className={styles.loaderStepName}>{step.label}</span>
                  <span className={styles.loaderStepDots} aria-hidden="true" />
                  <span className={styles.loaderStepState}>{step.done ? 'READY' : '····'}</span>
                </li>
              ))}
            </ul>

            <dl className={styles.loaderControls}>
              {controls.map((control) => (
                <div key={`${control.key}-${control.label}`} className={styles.loaderControl}>
                  <dt>{control.key}</dt>
                  <dd>{control.label}</dd>
                </div>
              ))}
            </dl>

            <button
              type="button"
              className={styles.loaderEnter}
              onClick={enter}
              disabled={!loaded}
            >
              {loaded ? 'ENTER' : 'PREPARING'}
            </button>

            <Link href="/" className={styles.loaderExit}>
              Or read the portfolio instead →
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
