'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
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

   ARRIVING WITH THE EFFORT ALREADY SPENT.
   Someone who charged the portal at the foot of the portfolio has
   already made the gesture this screen exists to ask for, and made
   it against real resistance. Asking them to press ENTER as well
   turns their effort into a queue ticket, so a portal arrival
   enters by itself the moment the world reports ready. What it
   does NOT do is skip the honest part: if the engine is still
   coming up, the readout stands there saying so, exactly as it
   would for anyone else. The promise is no needless wait, not no
   wait.
   ============================================================ */

interface Props {
  store: WorldStore
  getGame: () => Game | null
}

/**
 * The other half of the portal's contract — the key is written in
 * `src/components/journey/WorldPortal.tsx`, deliberately spelled out
 * in both files rather than shared, because importing it here would
 * drag the whole portfolio component into the world's chunk.
 */
const ARRIVAL_KEY = 'portal:arrival'
/** A charge that happened minutes ago was a different visit. */
const ARRIVAL_TTL = 30_000

/**
 * Read once and removed, so a later reload of /world gets the normal
 * loader. The answer is then held for a moment: Strict Mode mounts
 * this component, throws it away and mounts it again within the same
 * beat, and the second mount must not be told the arrival never
 * happened. Anything slower than that beat — the visitor going back
 * to the portfolio and returning by the plain link — reads storage
 * afresh and finds it empty, which is the whole point of removing it.
 */
let claim: { at: number; value: boolean } | null = null

function consumeArrival(): boolean {
  if (typeof window === 'undefined') return false
  const now = performance.now()
  if (claim && now - claim.at < 2000) return claim.value

  let value = false
  try {
    const raw = window.sessionStorage.getItem(ARRIVAL_KEY)
    window.sessionStorage.removeItem(ARRIVAL_KEY)
    value = raw !== null && Date.now() - Number(raw) < ARRIVAL_TTL
  } catch {
    // Storage denied. Show the loader; it is the honest default.
  }
  claim = { at: now, value }
  return value
}

/**
 * The engine builds its AudioContext on the first call, and a browser
 * that refuses to build one throws rather than returning null. Losing
 * the sound is survivable; taking the door down with it is not.
 */
function tryAudio(game: Game | null) {
  try {
    game?.enableAudio()
  } catch (error) {
    console.warn('[world] audio could not start', error)
  }
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
  const [arrived, setArrived] = useState(false)
  const [audioPending, setAudioPending] = useState(false)

  /* The guard is a ref rather than the `leaving` state because the
     door can be opened from a listener that outlived the render it
     was registered in — a stale `false` there would let the fade
     start twice. */
  const leavingRef = useRef(false)

  const enter = (via: 'gesture' | 'portal') => {
    if (!store.getState().loaded || leavingRef.current) return
    leavingRef.current = true
    setLeaving(true)
    // Let the fade play before the HUD arrives. An arrival is shorter:
    // nobody pressed anything, so the screen should get out of the way
    // of a movement that is already happening rather than answer a
    // button with a flourish.
    window.setTimeout(() => store.getState().setEntered(true), via === 'portal' ? 260 : 520)

    // This click is the user gesture the browser requires before an
    // AudioContext will start. There is no other moment to take it,
    // and asking earlier just fails silently.
    tryAudio(getGame())

    if (via === 'gesture') {
      getGame()?.markOnboarded()
      return
    }

    /* A SCROLL IS NOT A GESTURE. Chrome will not count one as the
       activation an AudioContext needs, so the call above succeeds
       only for a visitor who happened to click something earlier in
       the session. The engine keeps its context private and there is
       nothing to ask, so the retry is unconditional and harmless:
       resuming a context that is already running does nothing. */
    setAudioPending(true)
    // The controls card was never read on this path, so the world
    // keeps its onboarding hint — the one thing that still has to
    // teach this visitor which keys drive.
  }

  // ENTER on the keyboard does what the button does.
  useEffect(() => {
    if (entered || fatal) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        enter('gesture')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entered, fatal, loaded, leaving])

  /* ============================================================
     A DOOR THAT OPENS ITSELF
     Did the visitor push their way in here, and is there a world
     behind the door yet? Neither answer belongs to React: the first
     lives in sessionStorage, the second in the engine's own vanilla
     store. So this listens to that store rather than re-deriving
     readiness from a render, and the state it does set is set from
     the listener — writing it straight into the effect body would
     queue a second render before the first had painted, for news
     that arrived from outside React in the first place. The arrival
     flag is read once per mount and the subscription lets go the
     moment the door is through.
     ============================================================ */
  useEffect(() => {
    if (!consumeArrival()) return

    let opened = false
    let unsubscribe = () => {}

    const open = () => {
      if (opened) return
      const s = store.getState()
      if (!s.loaded || s.entered || s.fatal) return
      opened = true
      unsubscribe()
      // Both flags land in one commit, which is what lets the
      // shorter arrival transition apply to this very fade.
      setArrived(true)
      enter('portal')
    }

    unsubscribe = store.subscribe(open)
    // The world may already be up before this ever mounts, and a
    // store that never changes again would never call the listener.
    const id = window.setTimeout(open, 0)

    return () => {
      window.clearTimeout(id)
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The first real gesture inside the world, whatever it turns out to
  // be, is offered to the audio context. One retry, then it lets go.
  useEffect(() => {
    if (!audioPending) return
    const types = ['pointerdown', 'keydown', 'touchstart'] as const
    const retry = () => {
      tryAudio(getGame())
      setAudioPending(false)
    }
    for (const type of types) window.addEventListener(type, retry, { passive: true })
    return () => {
      for (const type of types) window.removeEventListener(type, retry)
    }
  }, [audioPending, getGame])

  if (entered) return null

  const controls = CONTROLS.filter((c) => c.mode === inputMode)

  return (
    <div
      className={styles.loader}
      data-leaving={leaving ? 'true' : 'false'}
      data-arrival={arrived ? 'true' : 'false'}
      role="dialog"
      aria-label="Enter the world"
    >
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
              onClick={() => enter('gesture')}
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
