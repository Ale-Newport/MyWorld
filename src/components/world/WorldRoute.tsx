'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import styles from './world.module.css'

/* ============================================================
   ROUTE SHELL

   The engine — three.js, Rapier's WebAssembly, the whole world —
   is behind a dynamic import with `ssr: false`. Two reasons:

   1. It must never touch the main portfolio's bundle. The home
      page is a scroll experience that has to paint fast, and it
      should not pay a byte for a route the visitor may never
      open.
   2. It reads `window`, `navigator.gpu`, canvas and WebGL at
      module scope in places. Prerendering it on the server is not
      merely wasteful, it fails.

   The loader below is the FIRST thing a visitor sees, so it is
   rendered eagerly and is not part of the deferred chunk.
   ============================================================ */

const WorldExperience = dynamic(
  () => import('./WorldExperience').then((m) => m.WorldExperience),
  {
    ssr: false,
    loading: () => <BootScreen />,
  },
)

function BootScreen() {
  return (
    <div className={styles.boot} role="status" aria-live="polite">
      <div className={styles.bootInner}>
        <p className={styles.bootLabel}>Initialising world</p>
        <div className={styles.bootBar}>
          <span className={styles.bootBarFill} />
        </div>
      </div>
    </div>
  )
}

export function WorldRoute() {
  const [mounted, setMounted] = useState(false)

  // One frame of delay before the engine chunk starts downloading, so
  // the shell paints first and the visitor sees something immediately
  // rather than a white screen while 2 MB of WebAssembly arrives.
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])

  return <div className={styles.route}>{mounted ? <WorldExperience /> : <BootScreen />}</div>
}
