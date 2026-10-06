import { adminApi, json, problem } from '@/server/auth/guard'
import { restore } from '@/server/revisions'
import { draftSite } from '@/server/site'

export const runtime = 'nodejs'

/* Copy an old revision forward as the new draft (history is never rewritten). */
export const POST = adminApi(async (req, { actor }) => {
  const body = (await req.json().catch(() => null)) as { revision?: string; base?: string | null } | null
  if (!body?.revision) return problem(400, 'Send { revision, base }.')
  await draftSite(actor)
  const revision = await restore('site', body.revision, actor, body.base ?? null)
  return json({ revision })
})
