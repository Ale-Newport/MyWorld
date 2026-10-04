'use client'

import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { garden } from './garden'
import type { CoverHandle } from '@/components/home/room/canopy/CanopyCover'

/* The canopy only downloads once some page asks for it. */
const CanopyCover = dynamic(() => import('@/components/home/room/canopy/CanopyCover').then((m) => m.CanopyCover), { ssr: false })

/**
 * Mounted once, in the root layout, so it outlives every route: see
 * `garden.ts` for why the homepage's canopy and the world's arrival
 * cover have to be the same element.
 */
export function GardenCover() {
  const state = useSyncExternalStore(garden.subscribe, garden.get, garden.server)
  const attach = useCallback((h: CoverHandle | null) => garden.attach(h), [])
  const opened = useCallback(() => garden.opened(), [])
  /* The cover belongs to the home journey's foot and to the world's
     arrival, nowhere else: on any other route, whatever brought it
     there, it goes — and the seam colour painted under it too. */
  const pathname = usePathname()
  useEffect(() => {
    if (pathname === '/' || pathname === '/world2') return
    garden.hide()
    document.documentElement.style.background = ''
  }, [pathname])
  if (!state.active) return null
  return <CanopyCover initial={state.initial} budget={state.budget} handleRef={attach} onOpened={opened} />
}
