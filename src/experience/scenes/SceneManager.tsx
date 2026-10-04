'use client'

import { Suspense, lazy, useMemo } from 'react'
import { useJourney } from '@/state/journey'
import type { ChapterId } from '@/content/types'
import { journeys } from '@/content/chapters'

/* Each heavy scene is a separate chunk, mounted only in a window
   around the active chapter so GPU memory stays bounded. */
const FieldScene     = lazy(() => import('./FieldScene').then((m) => ({ default: m.FieldScene })))
const MetaviewScene  = lazy(() => import('./MetaviewScene').then((m) => ({ default: m.MetaviewScene })))
const ChessScene     = lazy(() => import('./ChessScene').then((m) => ({ default: m.ChessScene })))
const StockScene     = lazy(() => import('./StockScene').then((m) => ({ default: m.StockScene })))
const UniverseScene  = lazy(() => import('./UniverseScene').then((m) => ({ default: m.UniverseScene })))
const ToolboxScene   = lazy(() => import('./ToolboxScene').then((m) => ({ default: m.ToolboxScene })))
const ContactScene   = lazy(() => import('./ContactScene').then((m) => ({ default: m.ContactScene })))

/** Which chapters keep a given scene alive. */
const SCENE_MAP: { id: string; chapters: ChapterId[]; Comp: React.ComponentType }[] = [
  /* The field's moving floor grid belongs to /projects. The home
     journey stands in a real room with a fixed camera, and a
     second, drifting floor drawn over it would contradict both. */
  { id: 'field',      chapters: ['pansofia', 'teaching', 'focus', 'gym'], Comp: FieldScene },
  { id: 'metaview',   chapters: ['metaview'], Comp: MetaviewScene },
  { id: 'chess',      chapters: ['chess'], Comp: ChessScene },
  { id: 'stock',      chapters: ['stock'], Comp: StockScene },
  { id: 'universe',   chapters: ['universe'], Comp: UniverseScene },
  { id: 'toolbox',    chapters: ['toolbox'], Comp: ToolboxScene },
  { id: 'contact',    chapters: ['contact'], Comp: ContactScene },
]

/* ============================================================
   THE WINDOW IS PER JOURNEY
   Distance is measured inside the running order the visitor is
   actually scrolling, not across all fourteen chapters. Taken
   globally, `chess` sits one step from `metaview` even when
   neither is on this route, and the scene would mount into a
   page that never shows it — GPU memory spent on nothing. A
   scene whose owner chapters all live on the other journey
   resolves to no indices at all and stays unmounted.

   Alone among the consumers this one reads the journey from the
   store rather than the route context: it lives inside the R3F
   canvas, which is a separate reconciler root that no DOM context
   crosses. That is safe now — the store is seeded during the
   provider's RENDER rather than from an effect, and the canvas
   itself is only mounted once the browser goes idle, so by the
   time this resolves a window the running order is already this
   route's and never the other one's.
   ============================================================ */
export function SceneManager() {
  const chapter = useJourney((s) => s.chapter)
  const journeyId = useJourney((s) => s.journeyId)

  const mounted = useMemo(() => {
    const list = journeys[journeyId].chapters
    const indexOf = (id: ChapterId) => list.findIndex((c) => c.id === id)
    // A chapter belonging to the other story means the store has not
    // caught up yet; the head of this one is the honest answer.
    const active = Math.max(0, indexOf(chapter))
    return SCENE_MAP.filter((s) =>
      // Mount if the active chapter is within one step of any owner
      // chapter present here: the next scene is warm before the
      // visitor arrives, and absent chapters are simply not owners.
      s.chapters.some((c) => {
        const i = indexOf(c)
        return i >= 0 && Math.abs(i - active) <= 1
      }),
    )
  }, [chapter, journeyId])

  return (
    <>
      {mounted.map(({ id, Comp }) => (
        <Suspense key={id} fallback={null}>
          <Comp />
        </Suspense>
      ))}
    </>
  )
}
