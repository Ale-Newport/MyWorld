import { adminApi, json, problem } from '@/server/auth/guard'
import { blogState, commitChange, type PostChange } from '@/server/blog'
import { ValidationError } from '@/server/errors'
import { blogPost, type BlogPost } from '@/cms/schema'

export const runtime = 'nodejs'

/* ============================================================
   THE BLOG, FOR THE ADMIN (server/blog.ts)

   GET: every post, drafts included, and the revision they were
   read at — never a cached answer.

   POST: one change — { type: "save", post, original, base } or
   { type: "delete", id, original, base }, with `force` for an
   explicit overwrite after a conflict. It is written and published
   at once: /blog shows it on the next request.

   The deployed admin is where posts are written; the editor on
   your machine answers too, against its own store, for checking.
   ============================================================ */

export const GET = adminApi(async () => json(await blogState()))

/** A post as sent by the admin, checked field by field with the schema's own rules. */
function post(input: unknown, what: string): BlogPost {
  const parsed = blogPost.safeParse(input)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  throw new ValidationError(`The ${what} is not valid: ${issue.path.join('.') || 'post'} — ${issue.message}`, parsed.error.issues)
}

export const POST = adminApi(async (req, { actor }) => {
  const body = (await req.json().catch(() => null)) as { type?: string; post?: unknown; id?: unknown; original?: unknown; base?: unknown; force?: unknown } | null
  const base = typeof body?.base === 'string' ? body.base : null
  const original = body?.original == null ? null : post(body.original, 'version you started from')
  let change: PostChange
  if (body?.type === 'save') change = { type: 'save', post: post(body.post, 'post'), original }
  else if (body?.type === 'delete' && typeof body.id === 'string' && body.id) change = { type: 'delete', id: body.id, original }
  else return problem(400, 'Send { type: "save", post, original, base } or { type: "delete", id, original, base }.')
  return json(await commitChange(change, { base, force: body?.force === true, actor }))
})
