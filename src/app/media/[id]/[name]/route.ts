import fs from 'node:fs'
import { getMedia, mediaFile } from '@/server/media'

export const runtime = 'nodejs'

/* Uploaded files, by id. The stored name and type are the ones detected at
   upload (never the browser's claim); nosniff stops reinterpretation, and an
   SVG is sandboxed so even an embedded script could not run. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; name: string }> }) {
  const { id } = await params
  const item = getMedia(id)
  if (!item) return new Response('Not found', { status: 404 })
  const file = mediaFile(item.id, item.filename.split('.').pop()!)
  if (!fs.existsSync(file)) return new Response('Not found', { status: 404 })
  const headers: Record<string, string> = {
    'content-type': item.mime,
    'content-length': String(item.size),
    'cache-control': 'public, max-age=31536000, immutable',
    etag: `"${item.sha256}"`,
    'x-content-type-options': 'nosniff',
    'content-disposition': `inline; filename="${item.filename.replace(/"/g, '')}"`,
    'cross-origin-resource-policy': 'same-origin',
  }
  if (item.mime === 'image/svg+xml') headers['content-security-policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
  return new Response(new Uint8Array(fs.readFileSync(file)), { headers })
}
