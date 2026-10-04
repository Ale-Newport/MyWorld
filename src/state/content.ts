import type { SiteContent } from '@/cms/derive'

/* ============================================================
   THE CONTENT, FOR READERS OUTSIDE REACT

   The canvas scenes, the frame loops and a few helpers run
   outside the component tree and cannot read a context. The
   SiteContentProvider (src/cms/context.tsx) writes the derived
   document here as it renders, before any of its children; those
   readers call currentContent() when they need it.

   Browser only in practice: on the server a module variable is
   shared by every request, so nothing server-side may read this.
   Server components take the document as an argument instead.
   ============================================================ */

let current: SiteContent | null = null

export function setJourneyContent(content: SiteContent) {
  current = content
}

export function currentContent(): SiteContent {
  if (!current) throw new Error('Site content read before <SiteContentProvider> rendered')
  return current
}

export function maybeContent(): SiteContent | null {
  return current
}
