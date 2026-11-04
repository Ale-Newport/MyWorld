import { adminApi, json } from '@/server/auth/guard'
import { EDITOR } from '@/server/mode'
import { githubConfigured, LIVE_HEAD } from '@/server/github'
import { draftSite, publishedSite } from '@/server/site'

export const runtime = 'nodejs'

/* The editor's starting point: the draft document, its head, and the
   published document (so the UI can say what is unpublished).
   In the deployed site there is no draft: the document is the one built into
   the deploy, and `live` tells the settings page how it can publish. */
export const GET = adminApi(async (_req, { actor }) => {
  if (!EDITOR) {
    const { doc } = await publishedSite()
    return json({ doc, head: LIVE_HEAD, published: { revision: 'git', doc }, live: { canPublish: githubConfigured() } })
  }
  const { doc, head } = await draftSite(actor)
  const published = await publishedSite()
  return json({ doc, head, published: published.revision ? { revision: published.revision.id, doc: published.doc } : null })
})
