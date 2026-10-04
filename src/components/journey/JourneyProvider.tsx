'use client'

import { createContext, useContext, useEffect, useLayoutEffect, useMemo } from 'react'
import { useJourney } from '@/state/journey'
import { useLenisScroll, scrollToProgress } from '@/hooks/useLenisScroll'
import { detectDevice } from '@/lib/perf'
import { chapterRanges, totalVh, type ChapterRange } from '@/content/chapters'
import { useSite } from '@/cms/context'
import type { Chapter, JourneyId } from '@/content/types'

/* ============================================================
   THE ROUTE IS THE ANSWER, NOT SOMETHING TO BE TOLD LATER

   Which of the two stories is mounted is decided by the URL and
   handed to this component as a prop. It used to be written into
   the store from an effect, which meant the server — where no
   effect ever runs — rendered every route's chrome as the HOME
   journey's: `/projects` was served HTML carrying a link to
   `/projects`, a brand anchor to a chapter that route does not
   have, and the wrong chapter tag. A crawler or a visitor without
   JavaScript kept exactly that, and everyone else watched the top
   bar correct itself after paint.

   So the route travels down the tree instead. Everything that
   depends on WHICH story this is reads the context below, and
   therefore agrees with the URL on the very first render, on both
   sides of the wire.
   ============================================================ */

export interface JourneyRoute {
  id: JourneyId
  /** The running order of THIS route, never all fourteen. */
  chapters: Chapter[]
  ranges: ChapterRange[]
}

const RouteContext = createContext<JourneyRoute | null>(null)

/* Before paint in a browser; never called at all on the server,
   where `useLayoutEffect` would only warn about an effect that
   cannot run. */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** The mounted journey, its running order and its scroll ranges. */
export function useJourneyRoute(): JourneyRoute {
  const route = useContext(RouteContext)
  if (!route) throw new Error('useJourneyRoute must be called inside <JourneyProvider>')
  return route
}

/**
 * The chapter being read, resolved against the mounted route.
 *
 * The store boots on the first chapter of the home journey and is
 * only corrected once this route's provider renders, so a consumer
 * that trusted it blindly would print a chapter belonging to the
 * other story. Falling back to the first chapter here means the
 * server and the first client render both say "01", and say the
 * right one.
 */
export function useActiveChapter(): Chapter {
  const route = useJourneyRoute()
  const id = useJourney((s) => s.chapter)
  return route.chapters.find((c) => c.id === id) ?? route.chapters[0]
}

/**
 * Owns the global side effects of the experience:
 * device tiering, reduced-motion, scroll driver, document
 * height and deep-link restore — and publishes which journey is
 * mounted to everything underneath it.
 */
export function JourneyProvider({
  journey,
  children,
}: {
  journey: JourneyId
  children: React.ReactNode
}) {
  const quickView = useJourney((s) => s.quickView)
  const reducedMotion = useJourney((s) => s.reducedMotion)
  const setReducedMotion = useJourney((s) => s.setReducedMotion)
  const setPerformanceTier = useJourney((s) => s.setPerformanceTier)
  const setQuickView = useJourney((s) => s.setQuickView)
  const setReady = useJourney((s) => s.setReady)

  useLenisScroll(true)

  const list = useSite().journeys[journey].chapters
  const ranges = useMemo(() => chapterRanges(quickView, list), [quickView, list])
  const route = useMemo<JourneyRoute>(
    () => ({ id: journey, chapters: list, ranges }),
    [journey, list, ranges],
  )

  /* ---- which story is mounted ----------------------------- */
  /* ============================================================
     SEEDED BEFORE PAINT, NOT DURING RENDER

     The store keeps its own copy of the route, because the scroll
     driver resolves the active chapter from outside React and
     cannot reach a context. For a while that copy was written
     during this component's render, on the reasoning that children
     render after their provider and would therefore find the right
     ranges already in place.

     That reasoning was sound about children and wrong about
     everybody else. A client navigation between the two journeys
     renders the INCOMING provider while the OUTGOING tree is still
     committed and still subscribed — the HUD, the index overlay,
     the scene manager, all of them reading this same module
     singleton through `useSyncExternalStore`. Writing to it in the
     middle of that render mutates a store the committed tree is
     holding a snapshot of, which is the one thing that hook exists
     to catch: React discards the in-flight render and starts
     again, the next attempt writes again, and the transition never
     commits. In practice `/` and `/projects` simply could not
     reach each other by link — the URL never changed, and the only
     trace was React's "cannot update a component while rendering a
     different component" in the console.

     So the seed moves to a LAYOUT effect, which is still before
     paint and still before anything reads it: the ticker runs on
     rAF, which is after layout effects, and `useChapterProgress`
     reads the ranges from inside that same rAF. A child layout
     effect does run before this one, and gets the outgoing route's
     ranges for that single commit — `ranges.find` simply misses
     and the chapter sits at zero, which is where a chapter that
     has just mounted belongs anyway.

     Still client-only, and for the original reason: the store is
     one module-level singleton shared by every request the server
     is answering at once, so a route written into it there would
     be a route leaked between them. The server's answer comes from
     the context above, which is per render tree.
     ============================================================ */
  useIsomorphicLayoutEffect(() => {
    useJourney.getState().setJourney(journey, list)
  }, [journey, list])

  /* ---- device + preferences ------------------------------ */
  useEffect(() => {
    // Own scroll restoration: the browser dropping the visitor into
    // the middle of a pinned chapter reads as a broken page.
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
    const device = detectDevice()
    setPerformanceTier(device.tier)

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReducedMotion(mq.matches)
    apply()
    mq.addEventListener('change', apply)

    // Deep-link: ?quick or #quick enables recruiter mode.
    const params = new URLSearchParams(window.location.search)
    if (params.has('quick') || window.location.hash === '#quick') setQuickView(true)

    setReady(true)
    return () => mq.removeEventListener('change', apply)
  }, [setPerformanceTier, setReducedMotion, setQuickView, setReady])

  /* ---- reduced motion ------------------------------------ */
  useEffect(() => {
    document.documentElement.setAttribute('data-reduced', reducedMotion ? 'true' : 'false')
  }, [reducedMotion])

  /* ---- document height ----------------------------------- */
  useEffect(() => {
    const vh = totalVh(quickView, list)
    document.documentElement.style.setProperty('--journey-vh', String(vh))
  }, [list, quickView])

  /* ============================================================
     CHAPTER DEEP LINKS
     The index on one journey links to a chapter on the other as
     `/projects#chapter-focus`. Scroll restoration is manual here,
     so the browser will not act on that hash and there is nothing
     to fight: we resolve it ourselves, once, after the document
     has been given its height — otherwise the target progress is
     measured against a one-screen-tall page and everything lands
     at the bottom.
     ============================================================ */
  useEffect(() => {
    const match = /^#chapter-(.+)$/.exec(window.location.hash)
    if (!match) return
    const id = match[1]
    const r = useJourney.getState().ranges.find((x) => x.id === id)
    if (!r) return
    const raf = requestAnimationFrame(() =>
      scrollToProgress(r.start + 0.0015, { immediate: true }),
    )
    return () => cancelAnimationFrame(raf)
  }, [journey])

  return <RouteContext.Provider value={route}>{children}</RouteContext.Provider>
}
