import { adminApi, json } from '@/server/auth/guard'
import { head, history } from '@/server/revisions'
import { draftWorld } from '@/server/world'

export const runtime = 'nodejs'

export const GET = adminApi(async (_req, { actor }) => {
  await draftWorld(actor)
  return json({ head: await head('world'), revisions: await history('world', 200) })
})
