import { ROOM_CONFIG } from './config'
import type { ChapterRange } from '@/content/chapters'

/* ============================================================
   GROWTH FROM SCROLL
   Growth G is a pure function of the journey's scroll progress:
   it runs from the start of one chapter to the start of another
   (the prelude to the contact chapter by default), so the room is
   mature before the last chapter pins and is still while its copy
   and the portal play. The same scroll position always gives the
   same G — forward, backward, restored or jumped to.

   The room is never bare: G starts at `growth.floor`.
   ============================================================ */

export function growthFor(progress: number, ranges: ChapterRange[]): number {
  const g = ROOM_CONFIG.growth
  const from = ranges.find((r) => r.id === g.fromChapter)?.start ?? 0
  const to = ranges.find((r) => r.id === g.toChapter)?.start ?? 0.83
  const t = Math.min(1, Math.max(0, (progress - from) / Math.max(1e-3, to - from)))
  return g.floor + (1 - g.floor) * t
}
