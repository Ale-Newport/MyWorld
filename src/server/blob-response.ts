/* ============================================================
   SERVING A PUBLISHED WORLD FILE

   /api/world/blob/<sha> hands out the two large files of the
   published world (a 17 MB document and the asset definitions).
   The name is the SHA-256 of the content, so a response can never
   go stale; what can change is whether the file is still PUBLISHED.

   Three things keep the first byte close:

     · the file is STREAMED from the store to the visitor. It used
       to be buffered (twice) before anything was sent;
     · the check "is this sha the published one?" (one query) and
       the opening of the object run at the same time. The body is
       only ever released after the check passes, and is cancelled
       when it does not;
     · on Cloudflare the response is also kept in the data
       centre's cache (caches.default), keyed by the URL, so the
       next visitor of that data centre is served without a Worker
       query or a Supabase round trip. A cached copy lives one day
       (EDGE_TTL_SECONDS): a world that is unpublished stops being
       served from the cache after at most that long. Off Cloudflare
       (Node, tests) there is no cache and nothing changes.

   Everything environment-specific is passed in (ServeDeps), so
   the logic is tested with fakes (tests/server/blob-response).
   ============================================================ */

export interface BlobSource {
  body: ReadableStream<Uint8Array>
  /** The exact length of `body`, when known. Without it the response is chunked and never cached. */
  size?: number
}

/** The part of Cloudflare's Cache that is used. */
export interface EdgeStore {
  match(key: Request): Promise<Response | undefined>
  put(key: Request, response: Response): Promise<void>
}

export interface ServeDeps {
  /** Is `sha` one of the files of the published world? */
  isPublished(sha: string): Promise<boolean>
  /** The object's bytes, or null when the store does not have it. */
  open(sha: string): Promise<BlobSource | null>
  /** The data-centre cache, when running on Cloudflare. */
  edge: EdgeStore | null
  /** Keeps the Worker alive for work that finishes after the response (the cache write). */
  waitUntil(promise: Promise<unknown>): void
}

export const SHA = /^[a-f0-9]{64}$/
/** What the visitor's browser is told: the name is the content. */
export const IMMUTABLE = 'public, max-age=31536000, immutable'
/** How long the data-centre copy is served without asking the database whether the file is still published. */
export const EDGE_TTL_SECONDS = 86400

const notFound = () => new Response('Not found', { status: 404 })

/** The cache key: this blob's own URL on this site, without any query string. */
export function edgeKey(request: Request, sha: string): Request {
  return new Request(new URL(`/api/world/blob/${sha}`, request.url).href)
}

/**
 * Looks at the first two bytes (gzip magic) and returns a stream that still
 * delivers every byte. The runtime tells gzip from plain JSON by content-type.
 */
export async function peekGzip(source: ReadableStream<Uint8Array>): Promise<{ gzip: boolean; body: ReadableStream<Uint8Array> }> {
  const reader = source.getReader()
  const held: Uint8Array[] = []
  const first: number[] = []
  while (first.length < 2) {
    const { done, value } = await reader.read()
    if (done) break
    held.push(value)
    for (let i = 0; i < value.byteLength && first.length < 2; i++) first.push(value[i])
  }
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (held.length) return controller.enqueue(held.shift()!)
      const { done, value } = await reader.read()
      if (done) controller.close()
      else controller.enqueue(value)
    },
    cancel: (reason) => reader.cancel(reason),
  })
  return { gzip: first[0] === 0x1f && first[1] === 0x8b, body }
}

/** Passes the bytes through and fails the stream if their count is not `size`: a truncated copy must never be cached. */
export function exactly(size: number): TransformStream<Uint8Array, Uint8Array> {
  let seen = 0
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength
      if (seen > size) controller.error(new Error(`The blob is longer than its announced ${size} bytes`))
      else controller.enqueue(chunk)
    },
    flush(controller) {
      if (seen !== size) controller.error(new Error(`The blob ended after ${seen} of its announced ${size} bytes`))
    },
  })
}

function reply(body: ReadableStream<Uint8Array> | null, type: string, size: number | undefined, sha: string): Response {
  const headers = new Headers({
    'content-type': type,
    'cache-control': IMMUTABLE,
    etag: `"${sha}"`,
    'x-content-type-options': 'nosniff',
  })
  if (size !== undefined) headers.set('content-length', String(size))
  return new Response(body, { headers })
}

/** What is stored in the data-centre cache: the bytes with a bounded lifetime instead of the browser's "forever". */
function stored(body: ReadableStream<Uint8Array>, type: string, size: number): Response {
  return new Response(body.pipeThrough(exactly(size)), {
    headers: { 'content-type': type, 'content-length': String(size), 'cache-control': `public, max-age=${EDGE_TTL_SECONDS}` },
  })
}

export async function serveWorldBlob(request: Request, sha: string, deps: ServeDeps): Promise<Response> {
  if (!SHA.test(sha)) return notFound()
  const key = deps.edge ? edgeKey(request, sha) : null

  if (deps.edge && key) {
    const hit = await deps.edge.match(key).catch(() => undefined)
    if (hit?.ok && hit.body) {
      const length = hit.headers.get('content-length')
      const head = request.method === 'HEAD'
      if (head) void hit.body.cancel().catch(() => {})
      return reply(head ? null : hit.body, hit.headers.get('content-type') ?? 'application/octet-stream', length && /^\d+$/.test(length) ? Number(length) : undefined, sha)
    }
  }

  // Ask the database and open the object at the same time; the object is only used if the answer is yes.
  const opening = deps.open(sha)
  opening.catch(() => {})
  const discard = () => void opening.then((source) => source?.body.cancel(), () => {}).catch(() => {})
  let published: boolean
  try {
    published = await deps.isPublished(sha)
  } catch (error) {
    discard()
    throw error
  }
  if (!published) {
    discard()
    return notFound()
  }
  const source = await opening
  if (!source) return notFound()

  const { gzip, body } = await peekGzip(source.body)
  const type = gzip ? 'application/gzip' : 'application/json'
  if (request.method === 'HEAD') {
    // Headers only: nothing to send, so nothing is read, kept or cached.
    void body.cancel().catch(() => {})
    return reply(null, type, source.size, sha)
  }
  if (!deps.edge || !key || source.size === undefined) return reply(body, type, source.size, sha)

  // Two readers of one body: the visitor, and the cache write that finishes after the response.
  const [toVisitor, toCache] = body.tee()
  deps.waitUntil(
    deps.edge.put(key, stored(toCache, type, source.size)).catch(() => {
      // Nothing was cached (a failure, or a cache that does not store here): stop holding the second branch.
      return toCache.cancel().catch(() => {})
    }),
  )
  return reply(toVisitor, type, source.size, sha)
}
