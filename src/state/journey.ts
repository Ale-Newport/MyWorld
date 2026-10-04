'use client'

import { create } from 'zustand'
import type { ChapterId, JourneyId } from '@/content/types'
import { chapters, chapterRanges, journeys, type ChapterRange } from '@/content/chapters'

export type PerformanceTier = 'low' | 'medium' | 'high'

export interface JourneyState {
  /* ---- scroll ------------------------------------------- */
  /** 0..1 across the entire document. */
  progress: number
  /** 0..1 within the active chapter. */
  chapterProgress: number
  chapter: ChapterId
  /** Position within the ACTIVE journey, never global. */
  chapterIndex: number
  /** Signed scroll velocity in px/frame, smoothed. */
  velocity: number
  direction: 1 | -1

  /* ---- presentation ------------------------------------- */
  /**
   * Which of the two scroll stories is mounted, for the readers
   * that live outside React's tree: the scroll driver, the frame
   * loops, and the scene manager inside the R3F canvas, which no
   * DOM context reaches. Anything that renders markup takes the
   * route from `useJourneyRoute` instead — this copy is only ever
   * correct in the browser, and the chrome has to be right in the
   * HTML the server sends. Either way it is one journey's chapters
   * and never the global list, because no route renders fourteen.
   */
  journeyId: JourneyId
  ranges: ChapterRange[]

  /* ---- modes -------------------------------------------- */
  quickView: boolean
  reducedMotion: boolean
  performanceTier: PerformanceTier
  soundEnabled: boolean
  indexOpen: boolean
  ready: boolean
  /** Slug of the project overlay currently open, or null. */
  activeProject: string | null
  /** Pointer in normalised device coords, -1..1. */
  pointer: { x: number; y: number }

  /* ---- actions ------------------------------------------ */
  setScroll: (p: { progress: number; velocity: number }) => void
  setPointer: (x: number, y: number) => void
  setJourney: (id: JourneyId) => void
  setQuickView: (v: boolean) => void
  setReducedMotion: (v: boolean) => void
  setPerformanceTier: (t: PerformanceTier) => void
  toggleSound: () => void
  setIndexOpen: (v: boolean) => void
  setReady: (v: boolean) => void
  setActiveProject: (slug: string | null) => void
}

function resolve(progress: number, ranges: ChapterRange[]) {
  const p = Math.min(0.999999, Math.max(0, progress))
  let active = ranges[0]
  for (const r of ranges) {
    if (r.end <= r.start) continue
    if (p >= r.start && p < r.end) { active = r; break }
    if (p >= r.end) active = r
  }
  const span = Math.max(1e-6, active.end - active.start)
  const chapterProgress = Math.min(1, Math.max(0, (p - active.start) / span))
  return { active, chapterProgress }
}

/* The store boots on the home journey because a module singleton
   has to boot on something, and on the server it must then stay
   exactly as it is: one process answers many requests at once, so
   a route written in here would be a route leaked between them.
   What the chrome renders therefore comes from the route context
   in `JourneyProvider`, not from this. `setJourney` corrects this
   copy in the browser, during that provider's render and before
   any child of it has looked — it is what the scroll driver reads
   from outside React, where a context cannot be reached. */
const initialJourney = journeys.home

export const useJourney = create<JourneyState>((set, get) => ({
  progress: 0,
  chapterProgress: 0,
  chapter: initialJourney.chapters[0].id,
  chapterIndex: 0,
  velocity: 0,
  direction: 1,

  journeyId: initialJourney.id,
  ranges: chapterRanges(false, initialJourney.chapters),

  quickView: false,
  reducedMotion: false,
  performanceTier: 'high',
  soundEnabled: false,
  indexOpen: false,
  ready: false,
  activeProject: null,
  pointer: { x: 0, y: 0 },

  setScroll: ({ progress, velocity }) => {
    const s = get()
    const { active, chapterProgress } = resolve(progress, s.ranges)
    const next: Partial<JourneyState> = { progress, velocity, chapterProgress }
    if (Math.abs(velocity) > 0.01) next.direction = velocity > 0 ? 1 : -1
    if (active.id !== s.chapter) {
      next.chapter = active.id
      next.chapterIndex = active.chapter.index
    }
    set(next)
  },

  setPointer: (x, y) => set({ pointer: { x, y } }),

  /* Swapping journeys is a hard reset of everything derived from
     scroll. The two stories are different documents of different
     heights: carrying 0.72 progress across the boundary would
     land the visitor in an arbitrary chapter of the new one. */
  setJourney: (id) => {
    const s = get()
    if (s.journeyId === id) return
    const list = journeys[id].chapters
    set({
      journeyId: id,
      ranges: chapterRanges(s.quickView, list),
      chapter: list[0].id,
      chapterIndex: 0,
      progress: 0,
      chapterProgress: 0,
      velocity: 0,
      direction: 1,
    })
  },

  setQuickView: (v) => {
    const s = get()
    const ranges = chapterRanges(v, journeys[s.journeyId].chapters)
    const { active, chapterProgress } = resolve(s.progress, ranges)
    set({
      quickView: v,
      ranges,
      chapter: active.id,
      chapterIndex: active.chapter.index,
      chapterProgress,
    })
  },

  setReducedMotion: (v) => set({ reducedMotion: v }),
  setPerformanceTier: (t) => set({ performanceTier: t }),
  toggleSound: () => set((s) => ({ soundEnabled: !s.soundEnabled })),
  setIndexOpen: (v) => set({ indexOpen: v }),
  setReady: (v) => set({ ready: v }),
  setActiveProject: (slug) => set({ activeProject: slug }),
}))

/* ============================================================
   FRAME-RATE STATE
   Values that change every frame must NOT live in the React
   store — they live here and are read directly inside rAF /
   useFrame loops. This keeps React re-renders to chapter
   changes only.
   ============================================================ */
export const frame = {
  progress: 0,
  chapterProgress: 0,
  chapterIndex: 0,
  velocity: 0,
  /** Normalised pointer, lerped. */
  pointerX: 0,
  pointerY: 0,
  /** Raw pointer target. */
  pointerTargetX: 0,
  pointerTargetY: 0,
  /** Seconds since mount. */
  time: 0,
}

/** Chapters across BOTH journeys. No single route renders this many. */
export const chapterCount = chapters.length
