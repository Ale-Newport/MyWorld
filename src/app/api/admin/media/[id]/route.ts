import { adminApi, json, problem } from '@/server/auth/guard'
import { deleteMedia, updateMedia } from '@/server/media'
import { mediaUsages } from '@/server/media-usage'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export const PATCH = adminApi<Ctx>(async (req, { params, actor }) => {
  const { id } = await params
  const body = (await req.json().catch(() => null)) as { alt?: unknown; title?: unknown } | null
  if (!body) return problem(400, 'Send { alt, title }.')
  const item = updateMedia(id, { alt: typeof body.alt === 'string' ? body.alt : undefined, title: typeof body.title === 'string' ? body.title : undefined }, actor)
  return json({ item: { ...item, usages: mediaUsages().get(id) ?? [] } })
})

export const DELETE = adminApi<Ctx>(async (_req, { params, actor }) => {
  const { id } = await params
  deleteMedia(id, mediaUsages().get(id) ?? [], actor)
  return json({ deleted: id })
})
