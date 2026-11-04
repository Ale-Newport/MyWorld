import { Buffer } from 'node:buffer'
import { env } from './env.ts'
import { validateSite } from './site.ts'
import type { SiteDocument } from '@/cms/schema'
import { ValidationError } from './errors.ts'

/* ============================================================
   SETTINGS FROM THE DEPLOYED ADMIN

   The deployed site has no content store: what it shows is the
   file content/published/site.json in the repository, built into
   each deploy. The one thing the deployed admin edits is the
   site's SETTINGS (title, typeface, navigation, options…), and it
   publishes them the way the editor publishes everything: as a
   commit to that file, through GitHub's contents API. The host
   rebuilds from the commit, so a setting goes live a minute or
   two after Publish.

   Only `settings` is taken from the admin's document. The rest of
   the file is read fresh from the repository at that moment, so a
   publish from the editor that is still deploying is never
   overwritten. Needs three Worker settings: GITHUB_TOKEN (a
   fine-grained token with Contents: read and write on this one
   repository), GITHUB_REPO ("owner/name") and optionally
   GITHUB_BRANCH (default "main").
   ============================================================ */

export const SITE_FILE = 'content/published/site.json'

/** GitHub's API; `GITHUB_API_URL` points tests at a stand-in. */
const api = () => env('GITHUB_API_URL') || 'https://api.github.com'

function target() {
  const token = env('GITHUB_TOKEN')
  const repo = env('GITHUB_REPO')
  if (!token || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null
  return { token, repo, branch: env('GITHUB_BRANCH') || 'main' }
}

export const githubConfigured = () => !!target()

async function call(path: string, init: RequestInit & { token: string }) {
  const { token, ...rest } = init
  const response = await fetch(`${api()}${path}`, {
    ...rest,
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'portfolio-admin', ...(rest.headers ?? {}) },
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    if (response.status === 401 || response.status === 403) throw new Error('GitHub refused the token. Check that GITHUB_TOKEN has not expired and can write this repository’s contents.')
    if (response.status === 409 || response.status === 422) throw new Error('The site file changed on GitHub while you were publishing. Reload the admin and publish again.')
    throw new Error(`GitHub answered ${response.status}: ${detail.slice(0, 200)}`)
  }
  return response.json() as Promise<Record<string, unknown>>
}

/** Commit the given settings into the site file. Returns the commit. */
export async function publishSettings(settings: unknown, actorName: string): Promise<{ commit: string; url: string }> {
  const t = target()
  if (!t) throw new ValidationError('Publishing from the web needs the GITHUB_TOKEN and GITHUB_REPO settings on the Worker. Until they are set, change settings in the editor on your own machine.')
  const file = `/repos/${t.repo}/contents/${SITE_FILE}`
  const current = await call(`${file}?ref=${encodeURIComponent(t.branch)}`, { token: t.token })
  const text = Buffer.from(String(current.content), 'base64').toString('utf8')
  const doc = JSON.parse(text) as SiteDocument
  const next = validateSite({ ...doc, settings })
  const body = JSON.stringify(next, null, 2) + '\n'
  if (body === text) throw new ValidationError('Nothing changed: these settings are already published.')
  const result = await call(file, {
    token: t.token,
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: `content: settings changed from the admin by ${actorName}`, content: Buffer.from(body, 'utf8').toString('base64'), sha: current.sha, branch: t.branch }),
  })
  const commit = result.commit as { sha: string; html_url: string }
  return { commit: commit.sha, url: commit.html_url }
}

/** What the deployed admin shows as its "draft" and "published" revision: the file built into the deploy. */
const stamp = { docId: 'site', parentId: null, createdAt: 0, authorId: null, authorName: null, message: null, schemaVersion: 2, hash: 'git', size: 0, publishedAt: null } as const
export const LIVE_HEAD = { draft: { id: 'git', ...stamp }, published: { id: 'git', ...stamp }, updatedAt: null } as unknown as import('./revisions.ts').Head

/* ============================================================
   THE TOKEN'S EXPIRY

   A fine-grained token has an expiry date, and GitHub reports it
   on every authenticated response (github-authentication-token-
   expiration). The admin reads it so the Settings page can say how
   long is left, warn before publishing stops working, and say how
   to renew it. Asked at most every half hour per Worker instance.
   ============================================================ */

export interface TokenStatus {
  configured: boolean
  /** GitHub accepts the token for this repository. */
  valid: boolean
  /** When it expires (ms since epoch), or null for a token without an expiry. */
  expiresAt: number | null
  daysLeft: number | null
  repo: string | null
  error: string | null
}

let remembered: { at: number; status: TokenStatus } | null = null

export async function tokenStatus({ fresh = false }: { fresh?: boolean } = {}): Promise<TokenStatus> {
  const t = target()
  if (!t) return { configured: false, valid: false, expiresAt: null, daysLeft: null, repo: null, error: null }
  if (!fresh && remembered && Date.now() - remembered.at < 30 * 60_000) return remembered.status
  let status: TokenStatus
  try {
    const response = await fetch(`${api()}/repos/${t.repo}`, { headers: { authorization: `Bearer ${t.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'portfolio-admin' } })
    // "2027-11-04 18:34:28 UTC"
    const header = response.headers.get('github-authentication-token-expiration')
    const expiresAt = header ? Date.parse(header.replace(' UTC', 'Z').replace(' ', 'T')) : NaN
    const known = Number.isFinite(expiresAt)
    // Read the body rather than cancel it: under Next's patched fetch the response is a tee, and cancelling a tee waits for both halves.
    await response.text().catch(() => '')
    status = {
      configured: true,
      valid: response.ok,
      expiresAt: known ? expiresAt : null,
      daysLeft: known ? Math.floor((expiresAt - Date.now()) / 86_400_000) : null,
      repo: t.repo,
      error: response.ok ? null : response.status === 401 ? 'GitHub no longer accepts this token (it has expired or was revoked).' : response.status === 404 ? 'The token cannot see this repository.' : `GitHub answered ${response.status}.`,
    }
  } catch (error) {
    // Offline or GitHub unreachable: say nothing alarming; the next look retries.
    return { configured: true, valid: true, expiresAt: null, daysLeft: null, repo: t.repo, error: `Could not reach GitHub: ${(error as Error).message}` }
  }
  remembered = { at: Date.now(), status }
  return status
}
