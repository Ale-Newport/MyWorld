import { adminApi, json, problem } from '@/server/auth/guard'
import { draftWorld, saveWorldDraft } from '@/server/world'
import { hasBlob } from '@/server/blobs'
import { maintainQuietly } from '@/server/maintenance'

export const runtime = 'nodejs'
export const maxDuration = 120

/* The world the studio edits: the draft revision's two files (read through
   the authenticated blob route — drafts are never public). */
export const GET = adminApi(async (_req, { actor }) => {
  const { head, refs } = draftWorld(actor)
  return json({
    revision: head.draft?.id ?? null,
    head,
    world: { url: `/api/admin/world/blob/${refs.world.sha}`, sha: refs.world.sha, size: refs.world.size },
    assets: { url: `/api/admin/world/blob/${refs.assets.sha}`, sha: refs.assets.sha, size: refs.assets.size },
  })
})

/* Commit two already-uploaded blobs as the new draft, on top of `base`. */
export const PUT = adminApi(async (req, { actor }) => {
  const body = (await req.json().catch(() => null)) as { base?: string | null; world?: { sha?: string; size?: number }; assets?: { sha?: string; size?: number }; message?: string; force?: boolean } | null
  const ok = (r?: { sha?: string; size?: number }) => !!r?.sha && /^[a-f0-9]{64}$/.test(r.sha) && hasBlob(r.sha) && Number.isFinite(r.size)
  if (!body || !ok(body.world) || !ok(body.assets)) return problem(400, 'Upload both files first, then send { base, world: { sha, size }, assets: { sha, size } }.')
  const revision = saveWorldDraft({ base: body.base ?? null, refs: { world: { sha: body.world!.sha!, size: body.world!.size! }, assets: { sha: body.assets!.sha!, size: body.assets!.size! } }, message: body.message?.slice(0, 300), actor, force: body.force === true })
  maintainQuietly(actor)
  return json({ revision })
})
