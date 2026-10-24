import { Suspense } from 'react'
import { WorldFallback } from '@/components/world/WorldFallback'
import { WorldRoute } from '@/components/world/WorldRoute'
import { profile as seededProfile } from '@/content/profile'
import { publishedSite } from '@/server/site'

/* The world's shell — the frame, the loader, the error dialog — needs no data from the
   server, so it lives in the layout and commits the moment the route is chosen. The
   page below it reads the published site (for its metadata) behind `loading.tsx`; waiting
   for that used to delay the frame, and the whole start of the world, by one server render.

   The crawlable text version of the world needs no data either, apart from the owner's
   name in its heading: it is rendered here, ahead of the shell, so it is in the first chunk
   of the document — present and reachable with scripts off, as it has always been — and only
   the name is a suspended slot (`ProfileName`, streamed in behind it; the seeded name stands in
   while the read is slow). */
async function ProfileName() {
  const { doc } = await publishedSite()
  return <> — {doc.profile.name}</>
}

/** What the heading says if the read is slow: the name the site was seeded with, so a document that is
    read with scripts off (where the streamed name cannot be swapped in) still names its owner. */
function SeededName() {
  return <> — {seededProfile.name}</>
}

export default function WorldLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Server-rendered and crawlable: the whole point of the world
          is reachable without WebGL, a keyboard or a mouse. */}
      <WorldFallback name={<Suspense fallback={<SeededName />}><ProfileName /></Suspense>} />
      {children}
      <WorldRoute />
    </>
  )
}
