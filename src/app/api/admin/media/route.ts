import { adminApi, json, problem } from '@/server/auth/guard'
import { listMedia, saveUpload, type MediaKind } from '@/server/media'
import { mediaUsages } from '@/server/media-usage'
import { config } from '@/server/config'

export const runtime = 'nodejs'

export const GET = adminApi(async () => {
  const usages = await mediaUsages()
  return json({ items: (await listMedia()).map((m) => ({ ...m, usages: usages.get(m.id) ?? [] })), limits: { maxBytes: config.maxMediaBytes } })
})

/* multipart/form-data with `file` (and optionally `kind`: texture | icon). */
export const POST = adminApi(async (req, { actor }) => {
  const length = Number(req.headers.get('content-length') ?? 0)
  if (length > config.maxMediaBytes + 64 * 1024) return problem(413, `Files are limited to ${Math.round(config.maxMediaBytes / 1048576)} MB.`)
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return problem(400, 'Send the file as multipart form data in a “file” field.')
  const kind = form?.get('kind')
  const item = await saveUpload(Buffer.from(await file.arrayBuffer()), file.name, actor, { kind: kind === 'texture' || kind === 'icon' ? (kind as MediaKind) : undefined })
  return json({ item: { ...item, usages: [] } }, 201)
})
