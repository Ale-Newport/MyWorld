import { publishedWorld } from '@/server/world'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* Which world /world shows: the published revision's two files, by
   content hash. Tiny and always revalidated; the files it names are
   immutable and cached for a year (see ../blob/[sha]). */
export async function GET() {
  const { refs, revision } = await publishedWorld()
  return Response.json(
    {
      revision: revision?.id ?? null,
      publishedAt: revision?.publishedAt ?? null,
      world: { url: `/api/world/blob/${refs.world.sha}`, sha: refs.world.sha, size: refs.world.size },
      assets: { url: `/api/world/blob/${refs.assets.sha}`, sha: refs.assets.sha, size: refs.assets.size },
    },
    { headers: { 'cache-control': 'no-cache' } },
  )
}
