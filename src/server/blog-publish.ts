import { Buffer } from 'node:buffer'
import { siteDocument, type BlogPost, type SiteDocument } from '../cms/schema.ts'
import { migrateSiteDocument } from '../cms/migrate.ts'
import { validateSiteReferences } from '../cms/references.ts'
import { ValidationError } from './errors.ts'

/* ============================================================
   THE BLOG, PUBLISHED FROM THE DEPLOYED ADMIN

   The deployed site has no content store: it is built from the
   repository. So a post is written in the deployed admin and each
   save is a commit, through GitHub's contents API, to the one file
   the site is built from (content/published/site.json) — with only
   `posts` changed. Workers Builds rebuilds on every push, and the
   post is on the site a minute or two later.

   The file is read again at the branch head for every change, the
   change is applied to THAT list of posts (never to the admin's
   copy of the file), and the whole document is validated — schema
   and cross-references — before it is written back with the sha it
   was read at. If someone else committed in between (settings from
   this admin, a publish from the editor), GitHub refuses the sha:
   the file is read once more and the same change applied to the
   fresh list, so their commit is kept. A change to a post that was
   itself changed since the admin opened it is refused instead of
   overwriting it.

   Images are committed too, as public/uploads/blog/<content hash>
   (served as /uploads/blog/… once the site has rebuilt; until then
   the admin reads them back from GitHub). Not under public/media:
   the editor's publish keeps that folder to its own library.

   This module has no Next.js or Cloudflare imports, so the tests
   drive it with a stand-in for GitHub; server/github.ts supplies
   the real target from the Worker's settings.
   ============================================================ */

export const SITE_FILE = 'content/published/site.json'
export const UPLOAD_DIR = 'public/uploads/blog'
export const UPLOAD_URL = '/uploads/blog'
/** Images only, and small enough to commit: the admin re-encodes large photos before sending them. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
/** A stored upload's name: its content hash and the extension of its detected type. */
export const UPLOAD_NAME = /^[a-f0-9]{20}\.(webp|png|jpg|gif|avif)$/

export interface GitHubTarget {
  token: string
  /** owner/name */
  repo: string
  branch: string
  /** https://api.github.com, or a stand-in */
  api: string
  fetch?: typeof fetch
}

export class GitHubError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** The post changed on GitHub since the admin loaded it: answered 409, the admin offers to reload. */
export class PostConflictError extends Error {
  name = 'ConflictError'
}

const headers = (t: GitHubTarget, extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${t.token}`,
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'portfolio-admin',
  ...extra,
})

async function call(t: GitHubTarget, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await (t.fetch ?? fetch)(`${t.api}${path}`, { ...init, headers: headers(t, (init.headers ?? {}) as Record<string, string>) })
  if (response.ok) return response
  const detail = await response.text().catch(() => '')
  if (response.status === 401 || response.status === 403) throw new GitHubError(response.status, 'GitHub refused the token. Check that GITHUB_TOKEN has not expired and can write this repository’s contents.')
  throw new GitHubError(response.status, `GitHub answered ${response.status}: ${detail.slice(0, 200)}`)
}

const contentsPath = (t: GitHubTarget, file: string) => `/repos/${t.repo}/contents/${file.split('/').map(encodeURIComponent).join('/')}`

/** A file at the branch head: its text and the sha to write it back with. Files over 1 MB come through the blob API. */
export async function readText(t: GitHubTarget, file: string): Promise<{ text: string; sha: string }> {
  const meta = (await (await call(t, `${contentsPath(t, file)}?ref=${encodeURIComponent(t.branch)}`)).json()) as { sha: string; content?: string; encoding?: string }
  if (meta.encoding === 'base64' && meta.content) return { text: Buffer.from(meta.content, 'base64').toString('utf8'), sha: meta.sha }
  const blob = (await (await call(t, `/repos/${t.repo}/git/blobs/${meta.sha}`)).json()) as { content: string }
  return { text: Buffer.from(blob.content, 'base64').toString('utf8'), sha: meta.sha }
}

/** A file's bytes at the branch head, or null when there is none. */
export async function readBytes(t: GitHubTarget, file: string): Promise<Uint8Array | null> {
  try {
    const response = await call(t, `${contentsPath(t, file)}?ref=${encodeURIComponent(t.branch)}`, { headers: { accept: 'application/vnd.github.raw+json' } })
    return new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return null
    throw error
  }
}

async function exists(t: GitHubTarget, file: string): Promise<boolean> {
  try {
    const response = await call(t, `${contentsPath(t, file)}?ref=${encodeURIComponent(t.branch)}`)
    await response.text()
    return true
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return false
    throw error
  }
}

async function writeFile(t: GitHubTarget, file: string, content: Buffer, message: string, sha?: string): Promise<{ commit: string; url: string }> {
  const response = await call(t, contentsPath(t, file), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, content: content.toString('base64'), branch: t.branch, ...(sha ? { sha } : {}) }),
  })
  const result = (await response.json()) as { commit: { sha: string; html_url: string } }
  return { commit: result.commit.sha, url: result.commit.html_url }
}

/* ---- the document ------------------------------------------------- */

/** The same checks as the editor's save (server/site.ts validateSite): the schema, then the cross-references. */
export function validateDocument(input: unknown): SiteDocument {
  const result = siteDocument.safeParse(migrateSiteDocument(input))
  if (!result.success) {
    const issues = result.error.issues.slice(0, 50).map((i) => ({ path: i.path.join('.'), message: i.message }))
    throw new ValidationError(`The site would have ${result.error.issues.length} problem(s): ${issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join('; ')}`, issues)
  }
  const problems = validateSiteReferences(result.data)
  if (problems.length) throw new ValidationError(`The site would have ${problems.length} broken reference(s): ${problems.slice(0, 3).map((p) => p.message).join('; ')}`, problems)
  return result.data
}

/** How the file is written: by the editor's publish and by this admin alike, so unchanged parts stay byte for byte. */
export const serialise = (doc: SiteDocument) => JSON.stringify(doc, null, 2) + '\n'

/** The site file as it is now on the branch, read tolerantly (a file from before the blog has no posts). */
export async function readSite(t: GitHubTarget): Promise<{ doc: SiteDocument; sha: string; text: string }> {
  const { text, sha } = await readText(t, SITE_FILE)
  return { doc: migrateSiteDocument<SiteDocument>(JSON.parse(text)), sha, text }
}

/* ---- one change to the posts --------------------------------------- */

export type PostChange =
  /** Create or replace the post with this id. `base` is the post as the admin loaded it (null: a new post). */
  | { type: 'save'; post: BlogPost; base: BlogPost | null }
  /** Remove the post with this id. */
  | { type: 'delete'; id: string; base: BlogPost | null }

/** Key order does not make two posts different. */
export function samePost(a: BlogPost | null | undefined, b: BlogPost | null | undefined): boolean {
  const stable = (v: unknown): unknown => (Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])])) : v)
  return JSON.stringify(stable(a ?? null)) === JSON.stringify(stable(b ?? null))
}

/** The change applied to a list of posts — the list as it is on GitHub now, not as the admin loaded it. */
export function applyPostChange(posts: readonly BlogPost[], change: PostChange): BlogPost[] {
  const id = change.type === 'save' ? change.post.id : change.id
  const current = posts.find((p) => p.id === id) ?? null
  if (!samePost(current, change.base)) {
    throw new PostConflictError(current
      ? `“${current.title || 'Untitled'}” was changed on GitHub since you opened it (another tab or another person). Reload to see that version; your edits are kept here until you discard them.`
      : change.base ? 'This post was deleted on GitHub since you opened it. Reload the list.' : 'A post with this id already exists on GitHub. Reload the list and start the post again.')
  }
  if (change.type === 'delete') return posts.filter((p) => p.id !== id)
  return current ? posts.map((p) => (p.id === id ? change.post : p)) : [...posts, change.post]
}

/** The commit's own words: what happened to which post, and who did it. */
export function describeChange(change: PostChange, actorName: string): string {
  const post = change.type === 'save' ? change.post : change.base
  const title = (post?.title || 'Untitled').replace(/\s+/g, ' ').slice(0, 80)
  let verb: string
  if (change.type === 'delete') verb = 'deleted'
  else if (change.post.status === 'published') verb = change.base?.status === 'published' ? 'updated' : 'published'
  else verb = change.base?.status === 'published' ? 'unpublished' : 'saved as a draft'
  return `content: blog post “${title}” ${verb} from the admin by ${actorName}`
}

/**
 * Commit one change to the posts: read the file at the branch head, apply the change to its posts, validate the
 * whole document, write it with the sha it was read at. A sha conflict (someone committed in between) is retried
 * once, from a fresh read.
 */
export async function commitPostChange(t: GitHubTarget, change: PostChange, actorName: string): Promise<{ commit: string; url: string; doc: SiteDocument }> {
  for (let attempt = 0; ; attempt++) {
    const { doc, sha, text } = await readSite(t)
    const next = validateDocument({ ...doc, posts: applyPostChange(doc.posts ?? [], change) })
    const body = serialise(next)
    if (body === text) throw new ValidationError('Nothing to publish: GitHub already has this version of the post.')
    try {
      const result = await writeFile(t, SITE_FILE, Buffer.from(body, 'utf8'), describeChange(change, actorName), sha)
      return { ...result, doc: next }
    } catch (error) {
      const conflict = error instanceof GitHubError && (error.status === 409 || (error.status === 422 && /sha/i.test(error.message)))
      if (!conflict) throw error
      if (attempt >= 1) throw new ValidationError('The site file kept changing on GitHub while this was being published. Wait a moment and try again.')
    }
  }
}

/* ---- images --------------------------------------------------------- */

/** What the bytes ARE (never what the browser says): the image formats a post may show. */
export function imageType(bytes: Uint8Array): { ext: 'png' | 'jpg' | 'webp' | 'gif' | 'avif'; mime: string } | null {
  const ascii = (at: number, s: string) => Buffer.from(bytes.subarray(at, at + s.length)).toString('latin1') === s
  if (bytes[0] === 0x89 && ascii(1, 'PNG')) return { ext: 'png', mime: 'image/png' }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' }
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return { ext: 'webp', mime: 'image/webp' }
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return { ext: 'gif', mime: 'image/gif' }
  if (ascii(4, 'ftyp') && (ascii(8, 'avif') || ascii(8, 'avis'))) return { ext: 'avif', mime: 'image/avif' }
  return null
}

export const mimeOf = (name: string) => ({ png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' })[name.split('.').pop() as string] ?? 'application/octet-stream'

/** Commit an image (once: the same bytes always get the same name). Returns the address posts use. */
export async function commitImage(t: GitHubTarget, bytes: Uint8Array, actorName: string): Promise<{ url: string; name: string; commit: string | null }> {
  if (bytes.length === 0) throw new ValidationError('The file is empty.')
  if (bytes.length > MAX_IMAGE_BYTES) throw new ValidationError(`Images can be at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB (this one is ${(bytes.length / 1024 / 1024).toFixed(1)} MB).`)
  const type = imageType(bytes)
  if (!type) throw new ValidationError('Only PNG, JPEG, WebP, GIF or AVIF images can be added to a post.')
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))).toString('hex')
  const name = `${digest.slice(0, 20)}.${type.ext}`
  const file = `${UPLOAD_DIR}/${name}`
  const url = `${UPLOAD_URL}/${name}`
  if (await exists(t, file)) return { url, name, commit: null }
  try {
    const { commit } = await writeFile(t, file, Buffer.from(bytes), `content: blog image ${name} uploaded from the admin by ${actorName}`)
    return { url, name, commit }
  } catch (error) {
    // Uploaded by someone else a moment ago: the same bytes, so the same file.
    if (error instanceof GitHubError && error.status === 422 && (await exists(t, file))) return { url, name, commit: null }
    throw error
  }
}
