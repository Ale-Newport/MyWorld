import { adminApi, json, problem } from '@/server/auth/guard'
import { checkWorld, draftWorld } from '@/server/world'
import { readRevision } from '@/server/revisions'

export const runtime = 'nodejs'
export const maxDuration = 120

/* The publish checks, without publishing: the studio shows the result. */
export const GET = adminApi(async (req, { actor }) => {
  const id = req.nextUrl.searchParams.get('revision')
  const refs = id ? readRevision(id)?.blobs : draftWorld(actor).refs
  if (!refs?.world || !refs.assets) return problem(404, 'Unknown revision.')
  const problems = checkWorld({ world: refs.world, assets: refs.assets })
  return json({ problems })
})
