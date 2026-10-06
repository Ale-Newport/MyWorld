import { adminApi, json, problem } from '@/server/auth/guard'
import { readRevision } from '@/server/revisions'
import { migrateSiteDocument } from '@/cms/migrate'

export const runtime = 'nodejs'

export const GET = adminApi<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const { id } = await params
  const rev = await readRevision(id)
  if (!rev || rev.docId !== 'site' || !rev.content) return problem(404, 'Unknown revision.')
  const { content, blobs, ...meta } = rev
  void blobs
  return json({ revision: meta, doc: migrateSiteDocument(JSON.parse(content)) })
})
