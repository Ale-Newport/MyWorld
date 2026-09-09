import type { Chapter, ChapterId } from './types'

/* ============================================================
   THE JOURNEY
   One continuous scroll. `vh` is the scroll length of each
   chapter in viewport heights — this is the single source of
   truth for pacing. Everything (progress bar, index, camera)
   derives from this array.
   ============================================================ */

export const chapters: Chapter[] = [
  {
    id: 'prelude', index: 0, number: '01',
    title: 'Intro', label: 'PRELUDE',
    subtitle: 'Alejandro Newport',
    vh: 3.2, quickVh: 1.6,
  },
  {
    id: 'about', index: 1, number: '02',
    title: 'About', label: 'A LITTLE ABOUT ME',
    subtitle: 'Computer scientist & engineer',
    vh: 3.4, quickVh: 1.8,
  },
  {
    id: 'kcl', index: 2, number: '03',
    title: 'Foundations', label: "KING'S COLLEGE LONDON",
    subtitle: 'BSc Computer Science · First Class',
    vh: 4.6, quickVh: 2.2,
    year: '2023',
  },
  {
    id: 'pansofia', index: 3, number: '04',
    title: 'Client Work', label: 'PANSOFIA / GRUPO NEWPORT',
    subtitle: 'From projects to products',
    vh: 5.0, quickVh: 2.4,
    year: '2025',
  },
  {
    id: 'teaching', index: 4, number: '05',
    title: 'Teaching', label: 'LEARNING BY TEACHING',
    subtitle: 'Graduate Teaching Assistant · KCL',
    vh: 3.0, quickVh: 1.4,
  },
  {
    id: 'focus', index: 5, number: '06',
    title: 'Focus', label: 'BUILDING A PRODUCT',
    subtitle: 'AI-generated learning video engine',
    vh: 6.4, quickVh: 2.6,
  },
  {
    id: 'gym', index: 6, number: '07',
    title: 'Gym App', label: 'ONE MODEL, MANY MOVEMENTS',
    subtitle: 'Rigged pose-data exercise system',
    vh: 4.4, quickVh: 1.8,
  },
  {
    id: 'metaview', index: 7, number: '08',
    title: 'Intelligence', label: 'METAVIEW — AI & DATA',
    subtitle: 'Retrieval, vision and scale',
    vh: 7.0, quickVh: 3.0,
    year: '2026',
  },
  {
    id: 'chess', index: 8, number: '09',
    title: 'Chess Assistant', label: 'SEEING THE BOARD',
    subtitle: 'CNN board reconstruction → Stockfish',
    vh: 5.0, quickVh: 2.0,
  },
  {
    id: 'stock', index: 9, number: '10',
    title: 'Stock Market', label: 'FORTY THOUSAND TRADES',
    subtitle: 'Multithreaded matching engine',
    vh: 3.4, quickVh: 1.4,
  },
  {
    id: 'universe', index: 10, number: '11',
    title: 'Project Universe', label: 'EVERYTHING I HAVE BUILT',
    subtitle: 'Interactive spatial archive',
    vh: 3.6, quickVh: 2.0,
  },
  {
    id: 'toolbox', index: 11, number: '12',
    title: 'Tech Toolbox', label: 'EVIDENCE, NOT KEYWORDS',
    subtitle: 'Technologies linked to real projects',
    vh: 3.4, quickVh: 2.0,
  },
  {
    id: 'ucl', index: 12, number: '13',
    title: 'UCL', label: 'UNIVERSITY COLLEGE LONDON',
    subtitle: 'MSc AI & Data Engineering',
    vh: 4.2, quickVh: 1.8,
    year: '2027',
  },
  {
    id: 'contact', index: 13, number: '14',
    title: 'Contact', label: "WHAT'S NEXT?",
    subtitle: 'Let’s build it',
    vh: 3.6, quickVh: 2.2,
  },
]

export const chapterById = Object.fromEntries(
  chapters.map((c) => [c.id, c]),
) as Record<ChapterId, Chapter>

export const chapterIds = chapters.map((c) => c.id)

/** Total scroll length in viewport heights for a given mode. */
export function totalVh(quick: boolean): number {
  return chapters.reduce(
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

/** Normalised [start,end] scroll ranges for every chapter. */
export function chapterRanges(quick: boolean): ChapterRange[] {
  const total = totalVh(quick)
  let cursor = 0
  const out: ChapterRange[] = []
  for (const c of chapters) {
    const len = quick ? c.quickVh : c.vh
    const start = cursor / total
    cursor += len
    out.push({ id: c.id, start, end: cursor / total, chapter: c })
  }
  return out
}

/** Timeline markers shown in the persistent HUD. */
export const timelineYears = [
  { year: '2023', chapter: 'kcl' as ChapterId },
  { year: '2025', chapter: 'pansofia' as ChapterId },
  { year: '2026', chapter: 'metaview' as ChapterId },
  { year: '2027', chapter: 'ucl' as ChapterId },
]
