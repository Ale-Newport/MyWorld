'use client'

import { useCallback, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { JourneyProvider } from './JourneyProvider'
import { Hud } from '@/components/navigation/Hud'
import { IndexOverlay } from '@/components/navigation/IndexOverlay'
import { Cursor } from '@/components/ui/Cursor'
import { PressFeedback } from '@/components/ui/PressFeedback'
import { ProjectOverlay } from '@/components/ui/ProjectOverlay'
import { useJourney } from '@/state/journey'
import { useSound } from '@/hooks/useSound'
import { useEasterEggs } from '@/hooks/useEasterEggs'
import type { ChapterId, JourneyId } from '@/content/types'
import { useEditing, useSite } from '@/cms/context'
import { track } from '@/components/analytics/track'
import { CustomSection } from '@/cms/sections'
import { Chapter } from './Chapter'
import { RoomLoading } from '@/components/home/room/RoomStill'
import styles from './Journey.module.css'

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
  { ssr: false, loading: RoomLoading },
)

/* The projects journey's sprig sheet: its own chunk, so the homepage —
   which never draws it — does not download it. Server-rendered on
   /projects as before. */
const Vegetation = dynamic(() => import('@/components/vegetation/Vegetation').then((m) => m.Vegetation))

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

/* How long after the room's first frame the second canvas is made (see the effect in Journey). */
const CANVAS_AFTER_ROOM_MS = 1200

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

/* Sound reacts to the chapter, the index and the open project, and none of that
   is a reason for the journey itself to render again: a hook that read those
   fields in the root re-rendered the whole tree (HomeRoom, every chapter, the
   HUD, both overlays) at each chapter boundary and at each toggle. It listens
   from a leaf instead and draws nothing. */
function SoundEffects() {
  useSound()
  return null
}

/* The index reads its own open flag for the same reason: opening it commits
   the overlay and nothing else. */
function IndexHost() {
  const open = useJourney((s) => s.indexOpen)
  const setIndexOpen = useJourney((s) => s.setIndexOpen)
  const close = useCallback(() => setIndexOpen(false), [setIndexOpen])
  return <IndexOverlay open={open} onClose={close} />
}

export function Journey({ journey }: { journey: JourneyId }) {
  const setIndexOpen = useJourney((s) => s.setIndexOpen)
  const openIndex = useCallback(() => setIndexOpen(true), [setIndexOpen])
  const [canvasReady, setCanvasReady] = useState(false)

  useEasterEggs()

  /* P1: the second canvas is only useful near a scene. The room already
     renders the hero; loading R3F and allocating an empty canvas there
     competes with it for both parsing time and GPU memory.

     It is also not a thing to start in the middle of a scroll. Its WebGL
     context is a round trip to the GPU process, and while the room is
     drawing a frame for every frame of a gesture that round trip waits
     behind them: 50 to 120 ms of the main thread at the Toolbox and again
     at the Universe, with R3F's code arriving (parse, evaluate) in the same
     stretch. So it is made once the room's first frame is out and the page
     is waiting for the visitor — the room asleep, the GPU idle — a moment
     after it, and in idle time. A visitor who is already scrolling by then,
     or who gets to the About chapter first, has it made there, as before. */
  useEffect(() => {
    let scheduled = false
    let cancel = () => {}
    let afterReady = 0
    const start = () => setCanvasReady(true)
    const mount = () => {
      if (scheduled) return
      scheduled = true
      if (typeof window.requestIdleCallback === 'function') {
        const id = window.requestIdleCallback(start, { timeout: 500 })
        cancel = () => window.cancelIdleCallback(id)
      } else {
        const id = window.setTimeout(start, 0)
        cancel = () => window.clearTimeout(id)
      }
    }
    const prepare = () => {
      if (scheduled) return
      const s = useJourney.getState()
      const owner = s.chapters.findIndex(c => c.id === 'toolbox')
      const active = s.chapters.findIndex(c => c.id === s.chapter)
      if (journey === 'home' && (owner < 0 || active < owner - 1)) return
      mount()
    }
    prepare()
    const unsubscribe = useJourney.subscribe(prepare)
    const settled = () => { afterReady = window.setTimeout(mount, CANVAS_AFTER_ROOM_MS) }
    if (journey === 'home' && !scheduled) {
      if (document.querySelector('[data-room-host][data-ready="true"]')) settled()
      else window.addEventListener('room:ready', settled, { once: true })
    }
    return () => {
      unsubscribe()
      cancel()
      window.clearTimeout(afterReady)
      window.removeEventListener('room:ready', settled)
    }
  }, [journey])

  /* Audience statistics: how far into this journey a visit gets (each mark once per visit to the page). */
  useEffect(() => {
    const marks = [25, 50, 75, 100]
    let next = 0
    return useJourney.subscribe((s) => {
      while (next < marks.length && s.progress * 100 >= (marks[next] === 100 ? 98.5 : marks[next])) {
        track('journey_progress', { journey, pct: marks[next] })
        if (marks[next] === 100) track('journey_complete', { journey })
        next++
      }
    })
  }, [journey])

  /* The index and a case study belong to the page that opened them. The store outlives the route, so a visitor
     who left with the index open (it holds the way into the world) came back, by Back, to the same panel
     standing over a page that had been built again, with its scroll lock on. They are put away on the way out,
     behind the leaves. */
  useEffect(() => () => {
    const s = useJourney.getState()
    if (s.indexOpen) s.setIndexOpen(false)
    if (s.activeProject) s.setActiveProject(null)
  }, [])

  /* Global keyboard shortcuts. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /input|textarea|select/i.test(target.tagName)) return
      if (e.key !== 'i' || e.metaKey || e.ctrlKey) return
      const { indexOpen, activeProject } = useJourney.getState()
      // The index is not opened beneath a case study: it would take the focus and the keys into a panel nobody can see.
      if (activeProject && !indexOpen) return
      setIndexOpen(!indexOpen)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setIndexOpen])

  const list = useSite().journeys[journey].chapters
  // In the admin's preview the editor draws its own pointer feedback.
  const editing = useEditing()

  return (
    <JourneyProvider journey={journey}>
      {/* Skipping "to content" has to mean the first thing this
          route actually tells — the journeys open on different
          chapters and a hardcoded target is a broken link on one
          of them. */}
      <a href={`#chapter-${list[0].id}`} className="skip-link">Skip to content</a>

      {canvasReady && <GlobalCanvas />}
      {!editing && <Cursor />}
      <PressFeedback />

      {/* The room is the home journey's alone; `/projects` keeps
          the sprig sheet exactly as it shipped. */}
      {journey === 'home' ? <HomeRoom /> : <Vegetation />}

      <main id="journey" className={`journey ${styles.journey}`} data-journey={journey}>
        {list.map((c) => {
          /* Sections added in the editor have no component of their own. */
          const Component = CHAPTER_COMPONENTS[c.id]
          return Component ? <Component key={c.id} /> : <CustomSection key={c.id} id={c.id} />
        })}
      </main>

      <Hud onOpenIndex={openIndex} />
      <IndexHost />
      <ProjectOverlay />
      <SoundEffects />
    </JourneyProvider>
  )
}
