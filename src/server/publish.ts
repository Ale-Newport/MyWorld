import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { SiteDocument } from '@/cms/schema'
import { SITE_FILE } from './github.ts'
import { assertNotBehind, commitAndPush, inRepo, type GitResult } from './git-publish.ts'
import { SYSTEM, type Actor } from './audit.ts'
import { readBlob } from './blobs.ts'
import { getMedia, mediaBytes } from './media.ts'
import { head, publish, readRevision, saveDraft } from './revisions.ts'
import { draftSite, publishSite, validateSite } from './site.ts'
import { publishWorld } from './world.ts'
import { ValidationError } from './errors.ts'

/* ============================================================
   PUBLISH, IN THE EDITOR

   publishSiteWithGit / publishWorldWithGit move the local store's
   published pointer (as before) AND write the result into the
   repository and push it: that is what changes the deployed site.
   syncSiteFromGit goes the other way: after a `git pull` it makes
   the committed site file the editor's current draft and published
   revision, so the editor starts from what is really live.
   ============================================================ */

const WORLD_PATHS = ['content/world']
const MEDIA_URL = /\/media\/([a-z0-9]{20})\/([^"\s)\\]+)/g

const execFileAsync = promisify(execFile)

/** Copy the uploads the document uses to public/media/<id>/<name> (served as static files), drop the ones it no longer uses. */
async function exportMedia(doc: SiteDocument): Promise<void> {
  const used = new Map<string, string>()
  for (const m of JSON.stringify(doc).matchAll(MEDIA_URL)) used.set(m[1], decodeURIComponent(m[2]))
  const root = inRepo('public', 'media')
  for (const [id, name] of used) {
    const item = await getMedia(id)
    const bytes = item ? await mediaBytes(item) : null
    if (!item || !bytes) throw new ValidationError(`The upload ${id} is used by the site but is missing from the library.`)
    const file = path.join(root, id, path.basename(name))
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, bytes)
  }
  if (fs.existsSync(root)) for (const entry of fs.readdirSync(root)) if (!used.has(entry)) fs.rmSync(path.join(root, entry), { recursive: true, force: true })
}

async function exportSite(content: string): Promise<GitResult> {
  const doc = JSON.parse(content) as SiteDocument
  await exportMedia(doc)
  fs.mkdirSync(path.dirname(inRepo(SITE_FILE)), { recursive: true })
  fs.writeFileSync(inRepo(SITE_FILE), JSON.stringify(doc, null, 2) + '\n')
  return commitAndPush([SITE_FILE, 'public/media'], 'content: publish the site')
}

export async function publishSiteWithGit({ revisionId, actor }: { revisionId?: string; actor: Actor }) {
  await assertNotBehind([SITE_FILE])
  const revision = await publishSite({ revisionId, actor })
  const content = (await readRevision(revision.id))?.content
  if (!content) throw new Error('The published revision has no content.')
  return { revision, git: await exportSite(content) }
}

/** The published world's two files, compacted, as the repository's seed. */
async function exportWorld(refs: { world: { sha: string }; assets: { sha: string } }): Promise<GitResult> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-publish-'))
  try {
    const files: Record<string, string> = {}
    for (const [key, ref] of [['world', refs.world], ['assets', refs.assets]] as const) {
      const bytes = await readBlob(ref.sha)
      if (!bytes) throw new Error(`The ${key} file ${ref.sha} is missing from the store.`)
      files[key] = path.join(/*turbopackIgnore: true*/ dir, key)
      fs.writeFileSync(files[key], bytes)
    }
    // A child process: the world document is tens of MB of JSON and is compacted by the same code the studio saves with.
    // It runs from this app's own folder and writes into the repository's.
    await execFileAsync(process.execPath, [
      path.join(process.cwd(), 'scripts/world/export-seed.mjs'),
      '--world-file', files.world, '--assets-file', files.assets,
      '--source-dir', inRepo('content/world'),
    ], { maxBuffer: 16 * 1024 * 1024, timeout: 300_000 })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
  return commitAndPush(WORLD_PATHS, 'content: publish the world')
}

export async function publishWorldWithGit({ revisionId, actor }: { revisionId?: string; actor: Actor }) {
  await assertNotBehind(WORLD_PATHS)
  const revision = await publishWorld({ revisionId, actor })
  const refs = (await readRevision(revision.id))?.blobs
  if (!refs?.world || !refs.assets) throw new Error('The published revision has no world files.')
  try {
    return { revision, git: await exportWorld({ world: refs.world, assets: refs.assets }) }
  } catch (error) {
    // Published in this editor, but the repository was not updated: say so rather than failing the publish.
    const e = error as { stderr?: string; message?: string }
    const git: GitResult = { committed: false, pushed: false, commit: null, branch: null, error: `Could not write the world into the repository: ${(e.stderr || e.message || '').trim().split('\n').slice(-2).join(' ')}` }
    return { revision, git }
  }
}

/** After `git pull`: the committed site file becomes the draft and the published revision of this editor. */
export async function syncSiteFromGit(actor: Actor = SYSTEM) {
  const file = inRepo(SITE_FILE)
  if (!fs.existsSync(file)) throw new ValidationError(`${SITE_FILE} does not exist.`)
  const valid = validateSite(JSON.parse(fs.readFileSync(file, 'utf8')))
  const { head: current } = await draftSite(actor)
  const content = JSON.stringify(valid)
  const latest = await head('site')
  const same = latest.published && latest.draft?.id === latest.published.id && (await readRevision(latest.published.id))?.content === content
  if (same) return { changed: false }
  const draft = await saveDraft('site', { base: current.draft?.id ?? null, content, schemaVersion: valid.schemaVersion, message: 'Reloaded from git', actor, force: true })
  await publish('site', { revisionId: draft.id, actor, validate: () => undefined })
  return { changed: true }
}
