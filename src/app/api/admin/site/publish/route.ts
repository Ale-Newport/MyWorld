import { adminApi, json, problem } from '@/server/auth/guard'
import { EDITOR } from '@/server/mode'
import { publishSettings } from '@/server/github'
import { audit } from '@/server/audit'

export const runtime = 'nodejs'

/* Editor: validate and publish the current draft (or a named revision), then
   write it into the repository (content/published/site.json) and push it.
   Deployed site: commit the submitted settings to that same file on GitHub;
   nothing else of the document can be changed from here. */
export const POST = adminApi(async (req, { actor }) => {
  const body = (await req.json().catch(() => ({}))) as { revision?: string; doc?: { settings?: unknown } }
  if (!EDITOR) {
    if (!body.doc?.settings) return problem(400, 'Send { doc } with the settings to publish.')
    const result = await publishSettings(body.doc.settings, actor.name ?? 'the admin')
    await audit(actor, 'site.publish', { docId: 'site', detail: `settings committed ${result.commit.slice(0, 7)}` })
    return json({ commit: result.commit, url: result.url })
  }
  const { publishSiteWithGit } = await import('@/server/publish')
  return json(await publishSiteWithGit({ revisionId: body.revision, actor }))
})
