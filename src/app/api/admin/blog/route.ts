import { adminApi, json, problem } from '@/server/auth/guard'
import { EDITOR } from '@/server/mode'
import { contentTarget, NOT_CONFIGURED } from '@/server/github'
import { commitPostChange, readSite, type PostChange } from '@/server/blog-publish'
import { publishedSite } from '@/server/site'
import { audit } from '@/server/audit'
import { ValidationError } from '@/server/errors'
import { blogPost, type BlogPost } from '@/cms/schema'

export const runtime = 'nodejs'

/* ============================================================
   THE BLOG, FROM THE DEPLOYED ADMIN

   GET: the posts as they are on GitHub now (the file at the branch
   head, which is what the next build will show) and, beside them,
   the posts this deploy was built with — the admin compares the two
   to say what is not live yet. Without the GitHub settings, or when
   GitHub cannot be reached, the deploy's own posts, and why.

   POST: one change — a post saved (as a draft or published) or
   deleted — committed to content/published/site.json with only the
   posts changed (server/blog-publish.ts).

   Posts are not written in the editor on your machine: there these
   routes do not exist.
   ============================================================ */

const IN_EDITOR = 'Blog posts are written in the live admin, not in the editor.'

export const GET = adminApi(async () => {
  if (EDITOR) return problem(404, IN_EDITOR)
  const deployed = (await publishedSite()).doc
  const t = contentTarget()
  const base = { configured: !!t, repo: t?.repo ?? null, branch: t?.branch ?? null, deployed: deployed.posts ?? [] }
  if (!t) return json({ ...base, source: 'deploy', doc: deployed, sha: null, error: NOT_CONFIGURED })
  try {
    const { doc, sha } = await readSite(t)
    return json({ ...base, source: 'github', doc, sha, error: null })
  } catch (error) {
    return json({ ...base, source: 'deploy', doc: deployed, sha: null, error: `Could not read the posts from GitHub: ${(error as Error).message}` })
  }
})

/** A post as sent by the admin, checked field by field with the schema's own rules. */
function post(input: unknown, what: string): BlogPost {
  const parsed = blogPost.safeParse(input)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  throw new ValidationError(`The ${what} is not valid: ${issue.path.join('.') || 'post'} — ${issue.message}`, parsed.error.issues)
}

export const POST = adminApi(async (req, { actor }) => {
  if (EDITOR) return problem(404, IN_EDITOR)
  const t = contentTarget()
  if (!t) throw new ValidationError(NOT_CONFIGURED)
  const body = (await req.json().catch(() => null)) as { type?: string; post?: unknown; id?: unknown; base?: unknown } | null
  const base = body?.base == null ? null : post(body.base, 'version you started from')
  let change: PostChange
  if (body?.type === 'save') change = { type: 'save', post: post(body.post, 'post'), base }
  else if (body?.type === 'delete' && typeof body.id === 'string' && body.id) change = { type: 'delete', id: body.id, base }
  else return problem(400, 'Send { type: "save", post, base } or { type: "delete", id, base }.')
  const result = await commitPostChange(t, change, actor.name || 'the admin')
  await audit(actor, 'site.publish', { docId: 'site', detail: `blog ${change.type === 'save' ? `“${change.post.title}” (${change.post.status})` : `“${base?.title ?? change.id}” deleted`} — commit ${result.commit.slice(0, 7)}` }).catch(() => {})
  return json({ commit: result.commit, url: result.url, doc: result.doc })
})
