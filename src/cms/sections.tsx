'use client'

import { Chapter } from '@/components/journey/Chapter'
import type { ChapterId } from '@/content/types'
import { AddedContent } from './blocks'
import { useSite } from './context'

/* A content section: what the retired page builder added to the
   site, kept as a section of its own (see cms/migrate.ts). It
   scrolls naturally — no pinned stage — and its blocks stack in
   one responsive column. */
export function CustomSection({ id }: { id: string }) {
  const title = useSite().chapterById[id]?.title ?? 'Section'
  return (
    <Chapter id={id as ChapterId} labelledBy={undefined} noPin grow>
      <h2 className="sr-only">{title}</h2>
      <AddedContent section={id} />
    </Chapter>
  )
}
