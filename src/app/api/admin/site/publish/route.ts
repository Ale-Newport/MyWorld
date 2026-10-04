import { adminApi, json } from '@/server/auth/guard'
import { publishSite } from '@/server/site'

export const runtime = 'nodejs'

/* Validate and publish the current draft (or a named revision), then
   regenerate the public pages on their next visit. */
export const POST = adminApi(async (req, { actor }) => {
  const body = (await req.json().catch(() => ({}))) as { revision?: string }
  const revision = await publishSite({ revisionId: body.revision, actor })
  return json({ revision })
})
