import { maintainQuietly } from '@/server/maintenance'
import { adminApi, json, problem } from '@/server/auth/guard'
import { saveSiteDraft } from '@/server/site'

export const runtime = 'nodejs'

/* Save the whole document as a new draft revision on top of `base`.
   409 with the current head when someone else saved in between. */
export const PUT = adminApi(async (req, { actor }) => {
  const body = (await req.json().catch(() => null)) as { base?: string | null; doc?: unknown; message?: string; force?: boolean } | null
  if (!body || body.doc === undefined) return problem(400, 'Send { base, doc }.')
  const length = Number(req.headers.get('content-length') ?? 0)
  if (length > 8 * 1024 * 1024) return problem(413, 'The document is larger than 8 MB.')
  const revision = await saveSiteDraft({ base: body.base ?? null, doc: body.doc, message: body.message?.slice(0, 300), actor, force: body.force === true })
  await maintainQuietly(actor)
  return json({ revision })
})
