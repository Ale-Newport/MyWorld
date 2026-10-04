import { adminApi, json, problem } from '@/server/auth/guard'
import { putBlob } from '@/server/blobs'
import { config } from '@/server/config'

export const runtime = 'nodejs'
export const maxDuration = 120

/* Raw upload of one world file (gzip JSON or JSON). The client sends its
   SHA-256 in x-content-sha256; a mismatch means a broken upload and nothing
   is stored. Uploading does not change any revision. */
export const POST = adminApi(async (req) => {
  const expected = req.headers.get('x-content-sha256') ?? ''
  if (!/^[a-f0-9]{64}$/.test(expected)) return problem(400, 'Send the file’s SHA-256 in x-content-sha256.')
  const length = Number(req.headers.get('content-length') ?? 0)
  if (length > config.maxWorldBlobBytes) return problem(413, `World files are limited to ${Math.round(config.maxWorldBlobBytes / 1048576)} MB.`)
  const bytes = Buffer.from(await req.arrayBuffer())
  if (bytes.byteLength > config.maxWorldBlobBytes) return problem(413, 'File too large.')
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b
  const isJson = bytes[0] === 0x7b
  if (!isGzip && !isJson) return problem(415, 'Expected gzip-compressed JSON or JSON.')
  const ref = putBlob(bytes, expected)
  return json(ref, 201)
})
