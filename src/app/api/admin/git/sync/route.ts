import { editorApi, json } from '@/server/auth/guard'
import { syncSiteFromGit } from '@/server/publish'

export const runtime = 'nodejs'

/* After a `git pull`: make the committed site file (content/published/site.json) this
   editor's draft and published revision, so what is edited is what is live. */
export const POST = editorApi(async (_req, { actor }) => json(await syncSiteFromGit(actor)))
