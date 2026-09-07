import type { Chapter, ChapterId } from './types'

/* ============================================================
   THE JOURNEY
   One continuous scroll. `vh` is the scroll length of each
   chapter in viewport heights — this is the single source of
   truth for pacing. Everything (progress bar, index, camera,
   Core morphing) derives from this array.
   ============================================================ */

export const chapters: Chapter[] = [
  {
    id: 'prelude', index: 0, number: '01',
    title: 'Intro', label: 'PRELUDE',
    subtitle: 'Alejandro Newport',
    vh: 3.2, quickVh: 1.6,
    theme: 'light', coreState: 'capsule',
  },
  {
    id: 'about', index: 1, number: '02',
    title: 'About', label: 'A LITTLE ABOUT ME',
    subtitle: 'Computer scientist & engineer',
    vh: 3.4, quickVh: 1.8,
    theme: 'light', coreState: 'drift',
  },
  {
    id: 'kcl', index: 2, number: '03',
    title: 'Foundations', label: "KING'S COLLEGE LONDON",
    subtitle: 'BSc Computer Science · First Class',
    vh: 5.4, quickVh: 2.2,
    theme: 'light', coreState: 'traveller', year: '2023',
  },
  {
    id: 'playground', index: 3, number: '04',
    title: 'Early Projects', label: 'I STARTED BUILDING',
    subtitle: 'Drivable project playground',
    vh: 3.0, quickVh: 0.9,
    theme: 'light', coreState: 'rover', year: '2024',
    skipInQuickView: true,
  },
  {
    id: 'pansofia', index: 4, number: '05',
    title: 'Client Work', label: 'PANSOFIA / GRUPO NEWPORT',
    subtitle: 'From projects to products',
    vh: 5.0, quickVh: 2.4,
    theme: 'light', coreState: 'window', year: '2025',
  },
  {
    id: 'teaching', index: 5, number: '06',
    title: 'Teaching', label: 'LEARNING BY TEACHING',
    subtitle: 'Graduate Teaching Assistant · KCL',
    vh: 3.0, quickVh: 1.4,
    theme: 'light', coreState: 'terminal',
  },
  {
    id: 'focus', index: 6, number: '07',
    title: 'Focus', label: 'BUILDING A PRODUCT',
    subtitle: 'AI-generated learning video engine',
    vh: 6.4, quickVh: 2.6,
    theme: 'light', coreState: 'device',
  },
  {
    id: 'gym', index: 7, number: '08',
    title: 'Gym App', label: 'ONE MODEL, MANY MOVEMENTS',
    subtitle: 'Rigged pose-data exercise system',
    vh: 4.4, quickVh: 1.8,
    theme: 'light', coreState: 'rig',
  },
  {
    id: 'metaview', index: 8, number: '09',
    title: 'Intelligence', label: 'METAVIEW — AI & DATA',
    subtitle: 'Retrieval, vision and scale',
    vh: 7.0, quickVh: 3.0,
    theme: 'dark', coreState: 'node', year: '2026',
  },
  {
    id: 'chess', index: 9, number: '10',
    title: 'Chess Assistant', label: 'SEEING THE BOARD',
    subtitle: 'CNN board reconstruction → Stockfish',
    vh: 5.0, quickVh: 2.0,
    theme: 'dark', coreState: 'grid',
  },
  {
    id: 'stock', index: 10, number: '11',
    title: 'Stock Market', label: 'FORTY THOUSAND TRADES',
    subtitle: 'Multithreaded matching engine',
    vh: 3.4, quickVh: 1.4,
    theme: 'dark', coreState: 'stream',
  },
  {
    id: 'universe', index: 11, number: '12',
    title: 'Project Universe', label: 'EVERYTHING I HAVE BUILT',
    subtitle: 'Interactive spatial archive',
    vh: 3.6, quickVh: 2.0,
    theme: 'dark', coreState: 'star',
  },
  {
    id: 'toolbox', index: 12, number: '13',
    title: 'Tech Toolbox', label: 'EVIDENCE, NOT KEYWORDS',
    subtitle: 'Technologies linked to real projects',
    vh: 3.4, quickVh: 2.0,
    theme: 'dark', coreState: 'matrix',
  },
  {
    id: 'ucl', index: 13, number: '14',
    title: 'UCL', label: 'UNIVERSITY COLLEGE LONDON',
    subtitle: 'MSc AI & Data Engineering',
    vh: 4.2, quickVh: 1.8,
    theme: 'light', coreState: 'capsule', year: '2027',
  },
  {
    id: 'contact', index: 14, number: '15',
    title: 'Contact', label: "WHAT'S NEXT?",
    subtitle: 'Let’s build it',
    vh: 3.6, quickVh: 2.2,
    theme: 'dark', coreState: 'system',
  },
]

export const chapterById = Object.fromEntries(
  chapters.map((c) => [c.id, c]),
) as Record<ChapterId, Chapter>

export const chapterIds = chapters.map((c) => c.id)

/** Total scroll length in viewport heights for a given mode. */
export function totalVh(quick: boolean): number {
  return chapters.reduce(
    (sum, c) => sum + (quick ? (c.skipInQuickView ? 0 : c.quickVh) : c.vh),
    0,
  )
}

export interface ChapterRange {
  id: ChapterId
  start: number // 0..1 of total scroll
  end: number
  chapter: Chapter
}

/** Normalised [start,end] scroll ranges for every chapter. */
export function chapterRanges(quick: boolean): ChapterRange[] {
  const total = totalVh(quick)
  let cursor = 0
  const out: ChapterRange[] = []
  for (const c of chapters) {
    const len = quick ? (c.skipInQuickView ? 0 : c.quickVh) : c.vh
    const start = cursor / total
    cursor += len
    out.push({ id: c.id, start, end: cursor / total, chapter: c })
  }
  return out
}

/** Timeline markers shown in the persistent HUD. */
export const timelineYears = [
  { year: '2023', chapter: 'kcl' as ChapterId },
  { year: '2024', chapter: 'playground' as ChapterId },
  { year: '2025', chapter: 'pansofia' as ChapterId },
  { year: '2026', chapter: 'metaview' as ChapterId },
  { year: '2027', chapter: 'ucl' as ChapterId },
]
