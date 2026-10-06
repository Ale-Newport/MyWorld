import { adminApi, json } from '@/server/auth/guard'
import { draftSite, publishedSite } from '@/server/site'

export const runtime = 'nodejs'

/* The editor's starting point: the draft document, its head, and the
   published document (so the UI can say what is unpublished). */
export const GET = adminApi(async (_req, { actor }) => {
  const { doc, head } = await draftSite(actor)
  const published = await publishedSite()
  return json({ doc, head, published: published.revision ? { revision: published.revision.id, doc: published.doc } : null })
})
