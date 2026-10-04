import { adminApi, json } from '@/server/auth/guard'
import { head, history } from '@/server/revisions'
import { draftSite } from '@/server/site'

export const runtime = 'nodejs'

export const GET = adminApi(async (_req, { actor }) => {
  draftSite(actor)
  return json({ head: head('site'), revisions: history('site', 200) })
})
