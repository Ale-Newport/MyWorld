import { blogImage } from '@/server/blog'
import { EDGE_TTL_SECONDS, exactly, IMMUTABLE } from '@/server/blob-response'
import { edgeStore, waitUntil } from '@/server/edge-cache'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* ============================================================
   A PICTURE IN A BLOG POST, FOR ANYONE

   /blog-media/<id>/<name>: an image of the media library (only an
   image, and only under its own name), streamed from the store —
   the private bucket in production, files locally. An id is never
   reused for other bytes, so the browser keeps it for good; on
   Cloudflare the data centre keeps a copy for a day
   (EDGE_TTL_SECONDS), so a post's pictures cost the database and
   the bucket one read per data centre, not one per visitor.

   Unlike /media/<id>/<name> (the editor's own library, answered
   only in the editor), this answers on the deployed site too.
   ============================================================ */

const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } })

function decode(name: string) {
  try { return decodeURIComponent(name) } catch { return name }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string; name: string }> }) {
  const { id, name: raw } = await params
  const name = decode(raw)
  const edge = edgeStore()
  const key = new Request(new URL(`/blog-media/${id}/${encodeURIComponent(name)}`, request.url).href)
  if (edge) {
    const hit = await edge.match(key).catch(() => undefined)
    if (hit?.ok && hit.body) {
      const headers = new Headers(hit.headers)
      headers.set('cache-control', IMMUTABLE)
      return new Response(hit.body, { headers })
    }
  }

  let found: Awaited<ReturnType<typeof blogImage>>
  try {
    found = await blogImage(id, name)
  } catch (error) {
    console.error('[blog-media]', error)
    return new Response('Unavailable', { status: 503, headers: { 'cache-control': 'no-store', 'retry-after': '30' } })
  }
  if (!found) return notFound()

  const { item, body, size } = found
  const headers: Record<string, string> = {
    'content-type': item.mime,
    'cache-control': IMMUTABLE,
    etag: `"${item.sha256}"`,
    'x-content-type-options': 'nosniff',
    'content-disposition': `inline; filename="${item.filename.replace(/"/g, '')}"`,
  }
  if (size !== undefined) headers['content-length'] = String(size)
  if (!edge || size === undefined) return new Response(body, { headers })

  // One reader for the visitor, one for the data-centre copy (which finishes after the response).
  const [toVisitor, toCache] = body.tee()
  waitUntil(
    edge.put(key, new Response(toCache.pipeThrough(exactly(size)), { headers: { ...headers, 'cache-control': `public, max-age=${EDGE_TTL_SECONDS}` } }))
      .catch(() => toCache.cancel().catch(() => {})),
  )
  return new Response(toVisitor, { headers })
}
