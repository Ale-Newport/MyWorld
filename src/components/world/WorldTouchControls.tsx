'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useStore } from 'zustand'
import type { WorldStore } from '@/world/state/store'
import type { Game } from '@/world/Game'
import styles from './touch.module.css'

/* ============================================================
   TOUCH CONTROLS

   The joystick is not here. Steering and throttle come from
   dragging anywhere on the world — a ring drawn on the ground
   around the car, ported from upstream's `Nipple` — because a
   fixed on-screen stick covers the thing you are driving towards
   and fights the camera for the same finger.

   What IS here is the handful of actions that have no gesture:
   boost, brake, horn, respawn, and the map. They sit in the
   bottom-right where a right thumb reaches, they are large enough
   to hit at speed, and they are `pointerdown`/`pointerup` rather
   than `click` so a hold is a hold.

   INTERACT is deliberately not a permanent button: the prompt
   itself is tappable, so the only time it exists is the moment it
   means something.
   ============================================================ */

interface Props {
  store: WorldStore
  getGame: () => Game | null
}

interface TouchAction {
  id: string
  label: string
  /** Held actions drive an input action for as long as the finger is down. */
  action?: string
  /** One-shot actions fire once on press. */
  once?: (game: Game) => void
  accent?: boolean
}

const ACTIONS: TouchAction[] = [
  { id: 'boost', label: 'BOOST', action: 'boost', accent: true },
  { id: 'brake', label: 'BRAKE', action: 'brake' },
  { id: 'jump', label: 'JUMP', action: 'jump' },
  { id: 'horn', label: 'HORN', once: (game) => game.player.honk() },
  { id: 'respawn', label: 'RESET', once: (game) => game.player.respawn() },
]

export function WorldTouchControls({ store, getGame }: Props) {
  const inputMode = useStore(store, (s) => s.inputMode)
  const overlay = useStore(store, (s) => s.overlay)
  const prompt = useStore(store, (s) => s.prompt)
  const held = useRef(new Map<string, string>())

  /* A finger lifted outside the button must still release the action,
     or the car drives away with the boost stuck on. */
  const release = useCallback((id: string) => {
    const game = getGame()
    const action = held.current.get(id)
    if (!game || !action) return
    held.current.delete(id)
    game.inputs.releaseTouchAction(action)
  }, [getGame])

  useEffect(() => {
    const releaseAll = () => {
      for (const id of Array.from(held.current.keys())) release(id)
    }
    window.addEventListener('pointercancel', releaseAll)
    window.addEventListener('blur', releaseAll)
    return () => {
      releaseAll()
      window.removeEventListener('pointercancel', releaseAll)
      window.removeEventListener('blur', releaseAll)
    }
  }, [release])

  if (inputMode !== 'touch' || overlay) return null

  const press = (item: TouchAction) => {
    const game = getGame()
    if (!game) return
    if (item.once) {
      item.once(game)
      return
    }
    if (!item.action) return
    held.current.set(item.id, item.action)
    game.inputs.pressTouchAction(item.action)
  }

  return (
    <div className={styles.touch}>
      <div className={styles.cluster}>
        {ACTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={styles.button}
            data-accent={item.accent ? 'true' : 'false'}
            onPointerDown={(event) => {
              event.preventDefault()
              event.currentTarget.setPointerCapture(event.pointerId)
              press(item)
            }}
            onPointerUp={() => release(item.id)}
            onPointerLeave={() => release(item.id)}
            aria-label={item.label}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className={styles.corner}>
        <button
          type="button"
          className={styles.button}
          onPointerDown={(event) => {
            event.preventDefault()
            store.getState().setOverlay('map')
          }}
          aria-label="Map"
        >
          MAP
        </button>
        <button
          type="button"
          className={styles.button}
          onPointerDown={(event) => {
            event.preventDefault()
            store.getState().setOverlay('pause')
          }}
          aria-label="Menu"
        >
          MENU
        </button>
      </div>

      {/* The interact prompt is the button. It only exists when there
          is something to interact with, so it never sits idle over
          the world. */}
      {prompt && (
        <button
          type="button"
          className={styles.interact}
          style={{ left: `${prompt.x * 100}%`, top: `${prompt.y * 100}%` }}
          onPointerDown={(event) => {
            event.preventDefault()
            /* `interactions.trigger()`, not `openLandmark(id)`.
               openLandmark returns silently for any id that is not a
               landmark, so every prompt the world registers itself —
               the mini-games, the playground, the black hole — did
               nothing at all when tapped. This is the same call ENTER
               makes. */
            getGame()?.interactions.trigger()
          }}
        >
          <span className={styles.interactLabel}>{prompt.label}</span>
          {prompt.sublabel && <span className={styles.interactSub}>{prompt.sublabel}</span>}
        </button>
      )}
    </div>
  )
}
