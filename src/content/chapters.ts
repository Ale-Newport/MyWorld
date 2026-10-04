import type { Chapter, ChapterId, JourneyId } from './types'

export type { JourneyId } from './types'

/* ============================================================
   TWO JOURNEYS, NOT ONE TIMELINE

   This was a single fourteen-chapter scroll ordered by date, and
   ordering a portfolio by date makes the reader do the sorting:
   the education, the jobs and the side projects interleave, and
   the answer to "what does he build" is spread over ten screens.

   So it is two journeys now, each ordered THEMATICALLY.

     `/`          who he is — intro, practice, education, contact
     `/projects`  what he has built — craft, products, intelligence

   `vh` is the scroll length of each chapter in viewport heights
   and remains the single source of truth for pacing. Everything
   (progress bar, index, camera) derives from these arrays — but
   from ONE journey's array at a time, never from both. `index`
   and `number` are journey-local for exactly that reason: a
   chapter's number is its position in the story the visitor is
   actually reading.
   ============================================================ */

export const homeChapters: Chapter[] = [
  {
    id: 'prelude', index: 0, number: '01',
    journey: 'home', group: 'Introduction',
    title: 'Intro', label: 'PRELUDE',
    subtitle: 'Alejandro Newport',
    vh: 3.2, quickVh: 1.6,
  },
  {
    id: 'about', index: 1, number: '02',
    journey: 'home', group: 'Introduction',
    title: 'About', label: 'A LITTLE ABOUT ME',
    subtitle: 'Computer scientist & engineer',
    vh: 3.4, quickVh: 1.8,
  },
  {
    id: 'toolbox', index: 2, number: '03',
    journey: 'home', group: 'Practice',
    title: 'Tech Toolbox', label: 'EVIDENCE, NOT KEYWORDS',
    subtitle: 'Technologies linked to real projects',
    vh: 3.4, quickVh: 2.0,
  },
  {
    id: 'universe', index: 3, number: '04',
    journey: 'home', group: 'Practice',
    title: 'Project Universe', label: 'EVERYTHING I HAVE BUILT',
    subtitle: 'Interactive spatial archive',
    vh: 3.6, quickVh: 2.0,
  },
  {
    id: 'education', index: 4, number: '05',
    journey: 'home', group: 'Education',
    title: 'Education', label: "KING'S COLLEGE · UCL",
    subtitle: 'BSc Computer Science · MSc AI & Data Engineering',
    vh: 4.4, quickVh: 2.2,
    year: '2023',
  },
  {
    id: 'contact', index: 5, number: '06',
    journey: 'home', group: 'Contact',
    title: 'Contact', label: "WHAT'S NEXT?",
    subtitle: 'Let’s build it',
    vh: 3.6, quickVh: 2.2,
  },
]

export const projectChapters: Chapter[] = [
  {
    id: 'pansofia', index: 0, number: '01',
    journey: 'projects', group: 'Practice & Craft',
    title: 'Client Work', label: 'PANSOFIA / GRUPO NEWPORT',
    subtitle: 'From projects to products',
    vh: 5.0, quickVh: 2.4,
    year: '2025',
  },
  {
    id: 'teaching', index: 1, number: '02',
    journey: 'projects', group: 'Practice & Craft',
    title: 'Teaching', label: 'LEARNING BY TEACHING',
    subtitle: 'Graduate Teaching Assistant · KCL',
    vh: 3.0, quickVh: 1.4,
  },
  {
    id: 'focus', index: 2, number: '03',
    journey: 'projects', group: 'Products',
    title: 'Focus', label: 'BUILDING A PRODUCT',
    subtitle: 'AI-generated learning video engine',
    vh: 6.4, quickVh: 2.6,
  },
  {
    id: 'gym', index: 3, number: '04',
    journey: 'projects', group: 'Products',
    title: 'Gym App', label: 'ONE MODEL, MANY MOVEMENTS',
    subtitle: 'Rigged pose-data exercise system',
    vh: 4.4, quickVh: 1.8,
  },
  {
    id: 'metaview', index: 4, number: '05',
    journey: 'projects', group: 'Intelligence',
    title: 'Intelligence', label: 'METAVIEW — AI & DATA',
    subtitle: 'Retrieval, vision and scale',
    vh: 7.0, quickVh: 3.0,
    year: '2026',
  },
  {
    id: 'chess', index: 5, number: '06',
    journey: 'projects', group: 'Intelligence',
    title: 'Chess Assistant', label: 'SEEING THE BOARD',
    subtitle: 'CNN board reconstruction → Stockfish',
    vh: 5.0, quickVh: 2.0,
  },
  {
    id: 'stock', index: 6, number: '07',
    journey: 'projects', group: 'Systems',
    title: 'Stock Market', label: 'FORTY THOUSAND TRADES',
    subtitle: 'Multithreaded matching engine',
    vh: 3.4, quickVh: 1.4,
  },
]

export interface JourneyDef {
  id: JourneyId
  /** Route this journey is served from. */
  path: string
  /** Human title, used in metadata and cross-links. */
  title: string
  /** Mono/uppercase label, used everywhere the chrome speaks. */
  label: string
  chapters: Chapter[]
}

export const journeys: Record<JourneyId, JourneyDef> = {
  home: {
    id: 'home',
    path: '/',
    title: 'Portfolio',
    label: 'PORTFOLIO',
    chapters: homeChapters,
  },
  projects: {
    id: 'projects',
    path: '/projects',
    title: 'Projects',
    label: 'PROJECTS',
    chapters: projectChapters,
  },
}

/**
 * Every chapter across both journeys, in reading order. This is a
 * LOOKUP list, not a running order: nothing may lay out scroll
 * from it, because no page renders all fourteen. It exists so
 * `chapterById` stays total and so callers that only need a
 * chapter's metadata do not have to know which route it lives on.
 */
export const chapters: Chapter[] = [...homeChapters, ...projectChapters]

export const chapterById = Object.fromEntries(
  chapters.map((c) => [c.id, c]),
) as Record<ChapterId, Chapter>

export const chapterIds = chapters.map((c) => c.id)

/** Which journey a chapter is told on. */
export function journeyOf(id: ChapterId): JourneyId {
  return chapterById[id].journey
}

/** Total scroll length in viewport heights for a given mode. */
export function totalVh(quick: boolean, list: Chapter[] = chapters): number {
  return list.reduce(
    (sum, c) => sum + (quick ? c.quickVh : c.vh),
    0,
  )
}

export interface ChapterRange {
  id: ChapterId
  start: number // 0..1 of total scroll
  end: number
  chapter: Chapter
}

/** Normalised [start,end] scroll ranges for every chapter in `list`. */
export function chapterRanges(quick: boolean, list: Chapter[] = chapters): ChapterRange[] {
  const total = totalVh(quick, list)
  let cursor = 0
  const out: ChapterRange[] = []
  for (const c of list) {
    const len = quick ? c.quickVh : c.vh
    const start = cursor / total
    cursor += len
    out.push({ id: c.id, start, end: cursor / total, chapter: c })
  }
  return out
}

/* ============================================================
   YEAR PLINTHS — /world ONLY

   The journey no longer has a timeline. Nothing in the HUD, the
   index or either running order is ordered by date, and no
   chapter draws an axis of years — the UCL chapter was the last
   to, and its modules carry that stretch of scroll now. A year
   still appears beside the handful of chapters that have one, as
   an annotation on a row; it decides nothing.

   This array survives for one consumer, the time-machine district in
   `src/world/world/dressing/timeMachine.ts`, which stands the
   CV's years on physical plinths. That is decor in a drivable
   world, not a chronology imposed on the reader, and the file
   that uses it belongs to another track — so it is kept here,
   deliberately unused by everything on this side of the site,
   until it can be moved into `src/world/`.
   ============================================================ */
export const timelineYears = [
  { year: '2023', chapter: 'education' as ChapterId },
  { year: '2025', chapter: 'pansofia' as ChapterId },
  { year: '2026', chapter: 'metaview' as ChapterId },
  { year: '2027', chapter: 'education' as ChapterId },
]
