import { publishedWorld } from '@/server/world'
import SEED from '@/server/world-seed.json' with { type: 'json' }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* Which world /world shows: the published revision's two files, by
   content hash. Tiny and always revalidated; the files it names are
   immutable and cached for a year (see ../blob/[sha]). */
export async function GET() {
  const { refs, revision } = await publishedWorld()
  // The shipped revision lives in Workers Static Assets. Its large files can
  // bypass a Worker invocation and PostgreSQL's publication check entirely.
  const worldUrl = revision ? `/api/world/blob/${refs.world.sha}` : SEED.world.path
  const assetsUrl = revision ? `/api/world/blob/${refs.assets.sha}` : SEED.assets.path
  return Response.json(
    {
      revision: revision?.id ?? null,
      publishedAt: revision?.publishedAt ?? null,
      world: { url: worldUrl, sha: refs.world.sha, size: refs.world.size },
      assets: { url: assetsUrl, sha: refs.assets.sha, size: refs.assets.size },
    },
    { headers: { 'cache-control': 'no-cache' } },
  )
}
