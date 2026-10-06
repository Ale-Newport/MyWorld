import { adminApi, problem } from '@/server/auth/guard'
import { worldBlob } from '@/server/world'

export const runtime = 'nodejs'

/* Any world file in the store, for the signed-in editor (drafts included). */
export const GET = adminApi<{ params: Promise<{ sha: string }> }>(async (_req, { params }) => {
  const { sha } = await params
  if (!/^[a-f0-9]{64}$/.test(sha)) return problem(404, 'Not found')
  const bytes = await worldBlob(sha)
  if (!bytes) return problem(404, 'Not found')
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': bytes[0] === 0x1f && bytes[1] === 0x8b ? 'application/gzip' : 'application/json',
      'cache-control': 'private, max-age=31536000, immutable',
      etag: `"${sha}"`,
      'x-content-type-options': 'nosniff',
    },
  })
})
