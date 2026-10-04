'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { JourneyProvider } from './JourneyProvider'
import { Hud } from '@/components/navigation/Hud'
import { IndexOverlay } from '@/components/navigation/IndexOverlay'
import { Cursor } from '@/components/ui/Cursor'
import { ProjectOverlay } from '@/components/ui/ProjectOverlay'
import { Vegetation } from '@/components/vegetation/Vegetation'
import { useJourney } from '@/state/journey'
import { useSound } from '@/hooks/useSound'
import { useEasterEggs } from '@/hooks/useEasterEggs'
import type { ChapterId, JourneyId } from '@/content/types'
import { useSite } from '@/cms/context'
import { CustomSection } from '@/cms/sections'
import { Chapter } from './Chapter'

/* The WebGL layer is client-only and never blocks first paint:
   the entire story is readable before a single shader compiles. */
const GlobalCanvas = dynamic(
  () => import('@/experience/canvas/GlobalCanvas').then((m) => m.GlobalCanvas),
  { ssr: false },
)

/* The home journey's backdrop: a white classical hall that moss
   and vines take back as the story is scrolled. Client-only and a
   chunk of its own — it is composed for the viewport it has to
   cover, which the server cannot know, and `/projects` has no use
   for it. Nothing of the story waits for it: the layer fades in
   once its light has converged. */
const HomeRoom = dynamic(
  () => import('@/components/home/room/HomeRoom').then((m) => m.HomeRoom),
  { ssr: false },
)

/* ============================================================
   THE CHAPTER REGISTRY
   The running order lives in `src/content/chapters.ts` and
   nowhere else — this map only says which component draws which
   id. Reordering a journey is then a content edit, and a chapter
   can never appear on a route its data does not claim.

   Every entry is its own chunk. Both routes render this shell, so
   a static import list meant each of them shipped, parsed and
   hydrated the OTHER journey's seven chapters as well — `/projects`
   downloading the toolbox and the sixty-odd kilobytes of raw SVG
   path data behind it, plus the contact chapter and the portal and
   the flora it draws, none of which that route ever puts on screen.
   Split per chapter, only the seven a route actually lists are
   fetched, exactly as the scene manager already does with its
   scenes.

   Nothing is deferred past first paint by this: each chapter is
   still prerendered, so the HTML the server sends is unchanged and
   the chunks for the chapters in view are preloaded with the page.
   The placeholder below is the belt to those braces.
   ============================================================ */

/**
 * A chapter's scroll length is its `vh` in the content file, spent
 * by <Chapter>, not by anything the chapter itself draws — so a
 * placeholder that renders the same empty section holds the same
 * height and the same anchor. Should a chunk ever be late, the
 * document keeps its measurements and the pinned stage keeps its
 * place; only the contents of one screen arrive a moment after it.
 */
function reserve(id: ChapterId) {
  function Reserved() {
    return <Chapter id={id} noPin>{null}</Chapter>
  }
  Reserved.displayName = `Reserved(${id})`
  return Reserved
}

const CHAPTER_COMPONENTS: Record<ChapterId, React.ComponentType> = {
  prelude: dynamic(() => import('./chapters/Prelude').then((m) => m.Prelude), { loading: reserve('prelude') }),
  about: dynamic(() => import('./chapters/About').then((m) => m.About), { loading: reserve('about') }),
  toolbox: dynamic(() => import('./chapters/Toolbox').then((m) => m.Toolbox), { loading: reserve('toolbox') }),
  universe: dynamic(() => import('./chapters/Universe').then((m) => m.Universe), { loading: reserve('universe') }),
  education: dynamic(() => import('./chapters/Education').then((m) => m.Education), { loading: reserve('education') }),
  contact: dynamic(() => import('./chapters/Contact').then((m) => m.Contact), { loading: reserve('contact') }),
  pansofia: dynamic(() => import('./chapters/Pansofia').then((m) => m.Pansofia), { loading: reserve('pansofia') }),
  teaching: dynamic(() => import('./chapters/Teaching').then((m) => m.Teaching), { loading: reserve('teaching') }),
  focus: dynamic(() => import('./chapters/Focus').then((m) => m.Focus), { loading: reserve('focus') }),
  gym: dynamic(() => import('./chapters/Gym').then((m) => m.Gym), { loading: reserve('gym') }),
  metaview: dynamic(() => import('./chapters/Metaview').then((m) => m.Metaview), { loading: reserve('metaview') }),
  chess: dynamic(() => import('./chapters/Chess').then((m) => m.Chess), { loading: reserve('chess') }),
  stock: dynamic(() => import('./chapters/Stock').then((m) => m.Stock), { loading: reserve('stock') }),
}

export function Journey({ journey }: { journey: JourneyId }) {
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

  const list = useSite().journeys[journey].chapters

  return (
    <JourneyProvider journey={journey}>
      {/* Skipping "to content" has to mean the first thing this
          route actually tells — the journeys open on different
          chapters and a hardcoded target is a broken link on one
          of them. */}
      <a href={`#chapter-${list[0].id}`} className="skip-link">Skip to content</a>

      {canvasReady && <GlobalCanvas />}
      <Cursor />

      {/* The room is the home journey's alone; `/projects` keeps
          the sprig sheet exactly as it shipped. */}
      {journey === 'home' ? <HomeRoom /> : <Vegetation />}

      <main id="journey" className="journey" data-journey={journey}>
        {list.map((c) => {
          /* Sections added in the editor have no component of their own. */
          const Component = CHAPTER_COMPONENTS[c.id]
          return Component ? <Component key={c.id} /> : <CustomSection key={c.id} id={c.id} />
        })}
      </main>

      <Hud onOpenIndex={() => setIndexOpen(true)} />
      <IndexOverlay open={indexOpen} onClose={() => setIndexOpen(false)} />
      <ProjectOverlay />
    </JourneyProvider>
  )
}
