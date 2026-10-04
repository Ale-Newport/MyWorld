import { isPublishedBlob, worldBlob } from '@/server/world'

export const runtime = 'nodejs'

/* A file of the PUBLISHED world, by its SHA-256. Anything else — a
   draft, an older revision, a guessed name — is 404 here; the admin
   reads drafts through its own authenticated route. The name is the
   content, so the response never changes and caches for good. */
export async function GET(_req: Request, { params }: { params: Promise<{ sha: string }> }) {
  const { sha } = await params
  if (!/^[a-f0-9]{64}$/.test(sha) || !isPublishedBlob(sha)) return new Response('Not found', { status: 404 })
  const bytes = worldBlob(sha)
  if (!bytes) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': bytes[0] === 0x1f && bytes[1] === 0x8b ? 'application/gzip' : 'application/json',
      'content-length': String(bytes.byteLength),
      'cache-control': 'public, max-age=31536000, immutable',
      etag: `"${sha}"`,
      'x-content-type-options': 'nosniff',
    },
  })
}
