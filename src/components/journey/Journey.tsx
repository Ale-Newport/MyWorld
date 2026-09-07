'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { JourneyProvider } from './JourneyProvider'
import { Hud } from '@/components/navigation/Hud'
import { IndexOverlay } from '@/components/navigation/IndexOverlay'
import { Cursor } from '@/components/ui/Cursor'
import { ProjectOverlay } from '@/components/ui/ProjectOverlay'
import { useJourney } from '@/state/journey'
import { useSound } from '@/hooks/useSound'
import { useEasterEggs } from '@/hooks/useEasterEggs'

import { Prelude } from './chapters/Prelude'
import { About } from './chapters/About'
import { Kcl } from './chapters/Kcl'
import { Playground } from './chapters/Playground'
import { Pansofia } from './chapters/Pansofia'
import { Teaching } from './chapters/Teaching'
import { Focus } from './chapters/Focus'
import { Gym } from './chapters/Gym'
import { Metaview } from './chapters/Metaview'
import { Chess } from './chapters/Chess'
import { Stock } from './chapters/Stock'
import { Universe } from './chapters/Universe'
import { Toolbox } from './chapters/Toolbox'
import { Ucl } from './chapters/Ucl'
import { Contact } from './chapters/Contact'

/* The WebGL layer is client-only and never blocks first paint:
   the entire story is readable before a single shader compiles. */
const GlobalCanvas = dynamic(
  () => import('@/experience/canvas/GlobalCanvas').then((m) => m.GlobalCanvas),
  { ssr: false },
)

export function Journey() {
  const indexOpen = useJourney((s) => s.indexOpen)
  const setIndexOpen = useJourney((s) => s.setIndexOpen)
  const [canvasReady, setCanvasReady] = useState(false)

  useSound()
  useEasterEggs()

  /* Defer WebGL until the browser is idle — the opening seconds
     stay interactive on any device. */
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    const start = () => setCanvasReady(true)
    if (w.requestIdleCallback) w.requestIdleCallback(start, { timeout: 1200 })
    else window.setTimeout(start, 400)
  }, [])

  /* Global keyboard shortcuts. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /input|textarea|select/i.test(target.tagName)) return
      if (e.key === 'i' && !e.metaKey && !e.ctrlKey) setIndexOpen(!useJourney.getState().indexOpen)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setIndexOpen])

  return (
    <JourneyProvider>
      <a href="#chapter-about" className="skip-link">Skip to content</a>

      {canvasReady && <GlobalCanvas />}
      <Cursor />

      <main id="journey" className="journey">
        <Prelude />
        <About />
        <Kcl />
        <Playground />
        <Pansofia />
        <Teaching />
        <Focus />
        <Gym />
        <Metaview />
        <Chess />
        <Stock />
        <Universe />
        <Toolbox />
        <Ucl />
        <Contact />
      </main>

      <Hud onOpenIndex={() => setIndexOpen(true)} />
      <IndexOverlay open={indexOpen} onClose={() => setIndexOpen(false)} />
      <ProjectOverlay />
    </JourneyProvider>
  )
}
