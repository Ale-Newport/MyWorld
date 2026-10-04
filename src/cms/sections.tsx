'use client'

import { Chapter } from '@/components/journey/Chapter'
import type { ChapterId } from '@/content/types'
import { useSite } from './context'

/* A section added in the editor: a stage of its own scroll length
   whose content is entirely the elements placed in it. The slot
   inside <Chapter> renders them; this only gives them a stage
   and a heading landmark for assistive tech. */
export function CustomSection({ id }: { id: string }) {
  const title = useSite().chapterById[id]?.title ?? 'Section'
  return (
    <Chapter id={id as ChapterId} labelledBy={undefined}>
      <h2 className="sr-only">{title}</h2>
    </Chapter>
  )
}
