'use client'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { garden } from '@/components/home/botanical/garden'
import styles from './world2.module.css'

const Experience = dynamic(() => import('./World2Experience'), { ssr: false, loading: () => <div className={styles.boot} role="status">Opening World 02…</div> })

/*
  THE HOMEPAGE'S CONTRACT, the other half.

  Someone who pushed through the garden at the foot of the portfolio
  arrives here under the very leaves that closed over the page — the
  same elements, which live in the root layout and outlive the route
  change (see garden.ts) — and the world loads, enters and starts
  driving underneath them. The leaves part when it is ready. There is
  no loading screen for that visitor at all.

  The key is spent once, so a reload, or someone typing the URL, gets
  the world's own gate as before.
*/
const ARRIVAL_KEY = 'portal:arrival'
const ARRIVAL_TTL = 30_000

/** Read once per page lifetime: Strict Mode renders twice, and the key is removed on read. */
let arrival: boolean | null = null
function readArrival(): boolean {
  if (arrival !== null) return arrival
  try {
    const raw = sessionStorage.getItem(ARRIVAL_KEY)
    sessionStorage.removeItem(ARRIVAL_KEY)
    arrival = raw !== null && Date.now() - Number(raw) < ARRIVAL_TTL
  } catch {
    arrival = false
  }
  /* The next client-side visit to this route must read afresh. */
  setTimeout(() => { arrival = null }, 2000)
  return arrival
}
const noop = () => () => {}

/** Live mounts of this route: Strict Mode unmounts and remounts once. */
let mounts = 0

export function World2Route() {
  const arriving = useSyncExternalStore(noop, readArrival, () => false)

  /* A hard navigation inside the arrival window (a reload) has no
     leaves standing yet: grow them fully, at once. Any visit that is
     not an arrival puts away whatever was left. */
  useEffect(() => {
    if (arriving) garden.show({ initial: 1 })
    else garden.hide()
  }, [arriving])

  /* Leaving before the leaves have parted (Back, during the world's
     first seconds) must not carry them over the page left for: put
     them away, and the seam colour with them. A beat late, so Strict
     Mode's remount is not mistaken for leaving. */
  useEffect(() => {
    mounts++
    return () => {
      mounts--
      window.setTimeout(() => {
        if (mounts > 0) return
        garden.hide()
        document.documentElement.style.background = ''
      }, 0)
    }
  }, [])

  const onEntered = useCallback(() => {
    garden.open(() => {
      garden.hide()
      document.documentElement.style.background = ''
    })
  }, [])

  return (
    <main className={styles.route}>
      <Experience arriving={arriving} onEntered={onEntered} />
    </main>
  )
}
