'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { createWorldStore, type WorldStore } from '@/world/state/store'
import type { Game } from '@/world/Game'
import { WorldLoader } from './WorldLoader'
import { WorldHud } from './WorldHud'
import { WorldOverlays } from './WorldOverlays'
import { WorldTouchControls } from './WorldTouchControls'
import styles from './world.module.css'

/* ============================================================
   THE MOUNT POINT

   Everything React does for this route happens here: build a
   canvas, build a Game against it, and tear the Game down when
   the route unmounts. React does not render a single frame of
   the world and does not re-render while driving.

   TWO THINGS THIS FILE HAS TO GET RIGHT.

   1. The canvas is created imperatively, one per Game, and
      removed with it. It cannot be a React-rendered element
      shared between instances, because teardown calls
      `forceContextLoss()` — which is the only way to hand the
      GPU context back promptly, and which also makes that canvas
      permanently unusable. A second Game on the same element
      would come up with a dead context.

   2. React Strict Mode mounts, unmounts and remounts effects in
      development, and the engine's start-up is async (Rapier's
      WebAssembly has to compile first). Each effect run therefore
      owns exactly one instance in a local `let`, and the cleanup
      destroys THAT instance — never `gameRef.current`, which by
      then may already belong to the next run. Getting this wrong
      leaves a world whose render loop has been cancelled by its
      predecessor's cleanup, which looks exactly like a physics
      bug and is not one.
   ============================================================ */

export function WorldExperience() {
  const hostRef = useRef<HTMLDivElement>(null)
  const gameRef = useRef<Game | null>(null)
  const [store] = useState<WorldStore>(() => createWorldStore())

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let disposed = false
    let instance: Game | null = null

    const canvas = document.createElement('canvas')
    canvas.className = styles.canvas
    canvas.setAttribute('aria-hidden', 'true')
    canvas.tabIndex = -1
    host.appendChild(canvas)

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    void (async () => {
      try {
        const { Game: GameClass } = await import('@/world/Game')
        if (disposed) return

        instance = new GameClass({ canvas, host, store, reducedMotion: prefersReduced })
        gameRef.current = instance
        await instance.init()

        if (disposed) {
          instance.destroy()
          if (gameRef.current === instance) gameRef.current = null
        }
      } catch (error) {
        if (disposed) return
        console.error('[world] failed to start', error)
        store.getState().setFatal(
          'The world could not start in this browser. Everything it contains is on the main portfolio.',
        )
      }
    })()

    return () => {
      disposed = true
      if (instance) {
        instance.destroy()
        if (gameRef.current === instance) gameRef.current = null
      }
      canvas.remove()
    }
  }, [store])

  const getGame = useCallback(() => gameRef.current, [])

  const entered = useStore(store, (s) => s.entered)
  const fatal = useStore(store, (s) => s.fatal)

  // While the loader is up the world is running, but it should not be
  // stealing arrow keys from the page behind it.
  useEffect(() => {
    const game = gameRef.current
    if (!game) return
    game.inputs.keyboard.capture = entered && !fatal
  }, [entered, fatal])

  return (
    <div className={styles.experience} ref={hostRef} data-entered={entered ? 'true' : 'false'}>
      <WorldLoader store={store} getGame={getGame} />
      {entered && !fatal && <WorldHud store={store} getGame={getGame} />}
      {entered && !fatal && <WorldTouchControls store={store} getGame={getGame} />}
      {entered && !fatal && <WorldOverlays store={store} getGame={getGame} />}
    </div>
  )
}
