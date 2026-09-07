'use client'

import { Suspense, lazy, useMemo } from 'react'
import { useJourney } from '@/state/journey'
import type { ChapterId } from '@/content/types'
import { chapters } from '@/content/chapters'

/* Each heavy scene is a separate chunk, mounted only in a window
   around the active chapter so GPU memory stays bounded. */
const FieldScene     = lazy(() => import('./FieldScene').then((m) => ({ default: m.FieldScene })))
const PlaygroundScene= lazy(() => import('./PlaygroundScene').then((m) => ({ default: m.PlaygroundScene })))
const MetaviewScene  = lazy(() => import('./MetaviewScene').then((m) => ({ default: m.MetaviewScene })))
const ChessScene     = lazy(() => import('./ChessScene').then((m) => ({ default: m.ChessScene })))
const StockScene     = lazy(() => import('./StockScene').then((m) => ({ default: m.StockScene })))
const UniverseScene  = lazy(() => import('./UniverseScene').then((m) => ({ default: m.UniverseScene })))
const ToolboxScene   = lazy(() => import('./ToolboxScene').then((m) => ({ default: m.ToolboxScene })))
const ContactScene   = lazy(() => import('./ContactScene').then((m) => ({ default: m.ContactScene })))

/** Which chapters keep a given scene alive. */
const SCENE_MAP: { id: string; chapters: ChapterId[]; Comp: React.ComponentType }[] = [
  { id: 'field',      chapters: ['prelude', 'about', 'kcl', 'pansofia', 'teaching', 'focus', 'gym', 'ucl'], Comp: FieldScene },
  { id: 'playground', chapters: ['playground'], Comp: PlaygroundScene },
  { id: 'metaview',   chapters: ['metaview'], Comp: MetaviewScene },
  { id: 'chess',      chapters: ['chess'], Comp: ChessScene },
  { id: 'stock',      chapters: ['stock'], Comp: StockScene },
  { id: 'universe',   chapters: ['universe'], Comp: UniverseScene },
  { id: 'toolbox',    chapters: ['toolbox'], Comp: ToolboxScene },
  { id: 'contact',    chapters: ['contact'], Comp: ContactScene },
]

const indexOf = (id: ChapterId) => chapters.findIndex((c) => c.id === id)

export function SceneManager() {
  const chapter = useJourney((s) => s.chapter)
  const active = indexOf(chapter)

  const mounted = useMemo(
    () =>
      SCENE_MAP.filter((s) =>
        // Mount if the active chapter is within one step of any owner chapter:
        // the next scene is warm before the visitor arrives.
        s.chapters.some((c) => Math.abs(indexOf(c) - active) <= 1),
      ),
    [active],
  )

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
