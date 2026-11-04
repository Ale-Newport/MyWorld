import { editorApi, json } from '@/server/auth/guard'
import { syncSiteFromGit, syncWorldFromGit } from '@/server/publish'

export const runtime = 'nodejs'
export const maxDuration = 120

/* After a `git pull`: make the committed website (content/published/site.json) and the committed
   world (content/world) this editor's draft and published revisions, so what is edited is what is live. */
export const POST = editorApi(async (_req, { actor }) => {
  const site = await syncSiteFromGit(actor)
  const world = await syncWorldFromGit(actor)
  return json({ changed: site.changed || world.changed, site, world })
})
