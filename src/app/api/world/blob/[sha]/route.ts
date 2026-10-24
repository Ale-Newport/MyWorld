import { serveWorldBlob } from '@/server/blob-response'
import { edgeStore, waitUntil } from '@/server/edge-cache'
import { isPublishedBlob, worldBlobStream } from '@/server/world'

export const runtime = 'nodejs'

/* A file of the PUBLISHED world, by its SHA-256. Anything else — a
   draft, an older revision, a guessed name — is 404 here; the admin
   reads drafts through its own authenticated route. The name is the
   content, so the response never changes and caches for good. The file
   is streamed from the store, and kept in the data centre's cache on
   Cloudflare: see server/blob-response.ts. */
export async function GET(request: Request, { params }: { params: Promise<{ sha: string }> }) {
  const { sha } = await params
  return serveWorldBlob(request, sha, { isPublished: isPublishedBlob, open: worldBlobStream, edge: edgeStore(), waitUntil })
}
