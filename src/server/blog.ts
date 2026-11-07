import { Buffer } from 'node:buffer'
import { blogPost, type BlogPost } from '../cms/schema.ts'
import { db, tx } from './db.ts'
import { ValidationError } from './errors.ts'
import { getMedia, mediaKey, saveUpload, type MediaItem } from './media.ts'
import { head, prune, publish, publishedRevision, readRevision, saveDraft, seed } from './revisions.ts'
import { getObjectStream } from './storage.ts'
import type { Actor } from './audit.ts'

/* ============================================================
   THE BLOG, IN THE DATABASE

   The one part of the deployed site that is not built from the
   repository. The posts are one revisioned document, `blog`, in
   the same documents/revisions store as the site and the world
   (Postgres through Hyperdrive in production, SQLite locally):
   its content is `{ posts: BlogPost[] }`, drafts included.

   The deployed admin changes one post at a time — saved as a
   draft, published, unpublished or deleted — and every change is
   one new revision, made the published one in the same
   transaction. /blog and /blog/<slug> are rendered on request
   from the published revision (one query) and show only the
   published posts, so a post is on the site as soon as it is
   saved, with no build and nothing committed.

   A change names the revision the admin read (`base`). If the
   blog moved on since — another tab, another person — the change
   still goes through when THIS post is as the admin found it (the
   other edit is kept: the change is applied to the posts as they
   are now); when the post itself changed, it is refused with 409,
   unless the admin explicitly chooses to overwrite it.

   The admin's reads run inside a transaction: a pooler's query
   cache (Hyperdrive caches plain reads; this deployment's config
   has caching off) never answers inside one, so what the admin
   sees right after a write is the write.

   Pictures go into the media library (media.ts: checked by their
   bytes, stored in the private bucket) and are served to visitors
   by /blog-media/<id>/<name>, images only.
   ============================================================ */

const DOC = 'blog' as const
export const BLOG_SCHEMA_VERSION = 1
export const MAX_POSTS = 500
/** Pictures for posts: small enough for a page, and the admin resizes large photos before sending them. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

export interface BlogState {
  /** The revision these posts were read at: the `base` of the next change. Null before the first post. */
  revision: string | null
  posts: BlogPost[]
}

/** The post changed elsewhere since the admin opened it: answered 409 (the admin offers to reload or overwrite). */
export class PostConflictError extends Error {
  name = 'ConflictError'
}

/** The stored text. */
export const serialise = (posts: readonly BlogPost[]) => JSON.stringify({ posts })

/** Read as stored. A revision is validated when it is written; reading it never throws for a missing list. */
function parsePosts(content: string | null | undefined): BlogPost[] {
  if (!content) return []
  const data = JSON.parse(content) as { posts?: unknown }
  return Array.isArray(data.posts) ? (data.posts as BlogPost[]) : []
}

/** Every post checked with the schema's own rules (cms/schema.ts `blogPost`), ids and addresses unique. */
export function validatePosts(input: unknown): BlogPost[] {
  if (!Array.isArray(input)) throw new ValidationError('The blog must be a list of posts.')
  if (input.length > MAX_POSTS) throw new ValidationError(`The blog holds at most ${MAX_POSTS} posts.`)
  const posts = input.map((raw, i) => {
    const parsed = blogPost.safeParse(raw)
    if (parsed.success) return parsed.data
    const issue = parsed.error.issues[0]
    const title = (raw as { title?: unknown })?.title
    throw new ValidationError(`${typeof title === 'string' && title ? `“${title}”` : `Post ${i + 1}`}: ${issue.path.join('.') || 'post'} — ${issue.message}`, parsed.error.issues)
  })
  const ids = new Set<string>()
  const slugs = new Set<string>()
  for (const p of posts) {
    if (ids.has(p.id)) throw new ValidationError(`Two posts share the id “${p.id}”.`)
    if (slugs.has(p.slug)) throw new ValidationError(`Two posts share the address /blog/${p.slug}.`)
    ids.add(p.id)
    slugs.add(p.slug)
  }
  return posts
}

/** Key order does not make two posts different. */
export function samePost(a: BlogPost | null | undefined, b: BlogPost | null | undefined): boolean {
  const stable = (v: unknown): unknown => (Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])])) : v)
  return JSON.stringify(stable(a ?? null)) === JSON.stringify(stable(b ?? null))
}

/* ---- reading ----------------------------------------------------- */

/** For visitors: the published posts, never a draft — the published revision, in one query. */
export async function publishedPosts(): Promise<BlogPost[]> {
  const revision = await publishedRevision(DOC, { content: true })
  return parsePosts(revision?.content).filter((p) => p.status === 'published')
}

/** For the admin: every post, drafts included, and the revision they were read at — inside a transaction, so never a cached answer. */
export function blogState(): Promise<BlogState> {
  return tx(async () => {
    const current = await head(DOC)
    if (!current.draft) return { revision: null, posts: [] }
    return { revision: current.draft.id, posts: parsePosts((await readRevision(current.draft.id))?.content) }
  })
}

/* ---- one change ---------------------------------------------------- */

export type PostChange =
  /** Create or replace the post with this id. `original` is the post as the admin read it (null: a new post). */
  | { type: 'save'; post: BlogPost; original: BlogPost | null }
  /** Remove the post with this id. */
  | { type: 'delete'; id: string; original: BlogPost | null }

const changedId = (change: PostChange) => (change.type === 'save' ? change.post.id : change.id)

/** The change applied to a list of posts. */
export function applyChange(posts: readonly BlogPost[], change: PostChange): BlogPost[] {
  const id = changedId(change)
  if (change.type === 'delete') return posts.filter((p) => p.id !== id)
  return posts.some((p) => p.id === id) ? posts.map((p) => (p.id === id ? change.post : p)) : [...posts, change.post]
}

/** What happened, in the revision's message and the activity log. */
export function describeChange(change: PostChange, before: BlogPost | null): string {
  const title = ((change.type === 'save' ? change.post : before)?.title || 'Untitled').replace(/\s+/g, ' ').slice(0, 80)
  if (change.type === 'delete') return `Blog post “${title}” deleted`
  if (change.post.status === 'published') return `Blog post “${title}” ${before?.status === 'published' ? 'updated' : 'published'}`
  return `Blog post “${title}” ${before?.status === 'published' ? 'unpublished' : 'saved as a draft'}`
}

/**
 * Writes one change as a new revision of the blog and publishes it, in one transaction. `base` is the revision the
 * admin read; `force` is its explicit "overwrite it with mine" after a conflict.
 */
export async function commitChange(change: PostChange, { base, force = false, actor }: { base: string | null; force?: boolean; actor: Actor }): Promise<BlogState> {
  await seed(DOC, 'blog', { content: serialise([]), schemaVersion: BLOG_SCHEMA_VERSION, message: 'The blog starts empty', actor })
  const state = await tx(async () => {
    const d = await db()
    // Two admins committing at the same moment take turns (SQLite's `begin immediate` already does).
    if (d.dialect === 'postgres') await d.get('select id from documents where id = ? for update', [DOC])
    const current = await head(DOC)
    const currentId = current.draft!.id
    const posts = parsePosts((await readRevision(currentId))?.content)
    const before = posts.find((p) => p.id === changedId(change)) ?? null
    if (!force && currentId !== base && !samePost(before, change.original)) {
      throw new PostConflictError(before
        ? `“${before.title || 'Untitled'}” was changed in another tab or by someone else since you opened it.`
        : change.original ? 'This post was deleted in another tab or by someone else since you opened it.' : 'A post with this id was just created elsewhere. Reload the list and start again.')
    }
    if (change.type === 'delete' && !before) throw new ValidationError('That post is already gone.')
    const next = validatePosts(applyChange(posts, change))
    if (serialise(next) === serialise(posts)) throw new ValidationError('Nothing to save: the blog already has this version of the post.')
    const revision = await saveDraft(DOC, { base: currentId, content: serialise(next), schemaVersion: BLOG_SCHEMA_VERSION, message: describeChange(change, before), actor })
    await publish(DOC, { revisionId: revision.id, actor, validate: () => {} })
    return { revision: revision.id, posts: next }
  })
  // Old versions beyond the store's policy go (recent publications, the heads and the first revision stay).
  await prune(DOC).catch((error) => console.error('[blog] pruning old revisions', error))
  return state
}

/* ---- pictures ------------------------------------------------------- */

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])

/** What the bytes ARE (never what the browser says): the picture formats a post may show. */
export function isPostImage(bytes: Uint8Array): boolean {
  const ascii = (at: number, s: string) => Buffer.from(bytes.subarray(at, at + s.length)).toString('latin1') === s
  return (bytes[0] === 0x89 && ascii(1, 'PNG'))
    || (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    || (ascii(0, 'RIFF') && ascii(8, 'WEBP'))
    || ascii(0, 'GIF87a') || ascii(0, 'GIF89a')
    || (ascii(4, 'ftyp') && (ascii(8, 'avif') || ascii(8, 'avis')))
}

/** The public address of a picture in a post. */
export const blogMediaUrl = (item: Pick<MediaItem, 'id' | 'filename'>) => `/blog-media/${item.id}/${encodeURIComponent(item.filename)}`

/** The media items a post's text and cover use. */
export const BLOG_MEDIA = /\/blog-media\/([a-z0-9]{20})\//g

/** A picture for a post, into the media library. */
export async function saveBlogImage(bytes: Uint8Array, name: string, actor: Actor): Promise<{ item: MediaItem; url: string }> {
  if (bytes.length === 0) throw new ValidationError('The file is empty.')
  if (bytes.length > MAX_IMAGE_BYTES) throw new ValidationError(`Pictures can be at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB (this one is ${(bytes.length / 1024 / 1024).toFixed(1)} MB).`)
  if (!isPostImage(bytes)) throw new ValidationError('Only PNG, JPEG, WebP, GIF or AVIF pictures can be added to a post.')
  const item = await saveUpload(Buffer.from(bytes), name, actor)
  return { item, url: blogMediaUrl(item) }
}

/** A picture by its address, for anyone: only images of the library, and only under their own name. */
export async function blogImage(id: string, name: string): Promise<{ item: MediaItem; body: ReadableStream<Uint8Array>; size?: number } | null> {
  const item = await getMedia(id)
  if (!item || item.kind !== 'image' || !IMAGE_TYPES.has(item.mime) || item.filename !== name) return null
  const stream = await getObjectStream(mediaKey(item.id, item.filename.split('.').pop()!))
  return stream && { item, ...stream }
}

/** Every media id any version of the blog refers to (kept by the old-content cleanup and counted as in use by the library). */
export async function blogMediaIds(): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const row of await (await db()).all<{ content: string | null }>('select content from revisions where doc_id = ?', [DOC])) {
    for (const m of (row.content ?? '').matchAll(BLOG_MEDIA)) ids.add(m[1])
  }
  return ids
}
