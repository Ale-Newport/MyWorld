import { adminApi, json, problem } from '@/server/auth/guard'
import { restore } from '@/server/revisions'
import { draftWorld } from '@/server/world'

export const runtime = 'nodejs'

export const POST = adminApi(async (req, { actor }) => {
  const body = (await req.json().catch(() => null)) as { revision?: string; base?: string | null } | null
  if (!body?.revision) return problem(400, 'Send { revision, base }.')
  await draftWorld(actor)
  return json({ revision: await restore('world', body.revision, actor, body.base ?? null) })
})
