import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { ValidationError } from './errors.ts'

/* ============================================================
   PUBLISHING IS A COMMIT

   In the editor, Publish does not only move a pointer in the local
   store: it writes what visitors will see into the repository —
   content/published/site.json, public/media, the world seed — and
   commits and pushes exactly those paths. The host builds from the
   push, so the website changes a minute or two later. Nothing else
   in the working tree is staged or committed.

   Before publishing, the editor refuses to go on if the remote has
   a newer version of the same files (settings changed from the
   deployed admin, a publish from another machine): publishing over
   it would silently undo it. `git pull`, reload from git, and
   publish again.
   ============================================================ */

const run = promisify(execFile)
/** The checkout the editor publishes into: the one it runs from. `CMS_REPO_DIR` points it elsewhere (a scratch clone, for trying publishing out). */
export const repoRoot = () => process.env.CMS_REPO_DIR || process.cwd()

async function git(args: string[], timeout = 120_000): Promise<string> {
  const { stdout } = await run('git', args, { cwd: repoRoot(), timeout, maxBuffer: 32 * 1024 * 1024 })
  return stdout.trim()
}

const message = (error: unknown) => {
  const e = error as { stderr?: string; message?: string }
  return (e.stderr || e.message || String(error)).trim().split('\n').slice(-3).join(' ')
}

export interface GitResult {
  /** Whether a commit was made (false: the files were already what is committed). */
  committed: boolean
  pushed: boolean
  commit: string | null
  branch: string | null
  /** Why it could not be pushed (the commit exists locally), or null. */
  error: string | null
}

/** Throws when the remote branch changed any of `paths` since this checkout. Offline, there is nothing to check. */
export async function assertNotBehind(paths: string[]): Promise<void> {
  let branch: string
  try { branch = await git(['rev-parse', '--abbrev-ref', 'HEAD']) } catch { return }
  const upstream = `origin/${branch}`
  try {
    await git(['fetch', '--quiet', 'origin', branch], 30_000)
    await git(['rev-parse', '--verify', '--quiet', upstream])
  } catch { return }
  const changed = await git(['diff', '--name-only', `HEAD...${upstream}`, '--', ...paths]).catch(() => '')
  if (changed) throw new ValidationError(`The repository has a newer version of ${changed.split('\n').join(', ')} (for example settings published from the web admin). Run "git pull", then use "Reload from git" in History, and publish again.`)
}

/** The paths git can be asked about: on disk, or tracked (a folder that was emptied is a deletion to commit). */
async function known(paths: string[]): Promise<string[]> {
  const keep: string[] = []
  for (const p of paths) if (fs.existsSync(path.join(/*turbopackIgnore: true*/ repoRoot(), p)) || (await git(['ls-files', '--', p]))) keep.push(p)
  return keep
}

/** Stage `paths` (files or folders), commit only them, push the branch. */
export async function commitAndPush(wanted: string[], subject: string): Promise<GitResult> {
  const out: GitResult = { committed: false, pushed: false, commit: null, branch: null, error: null }
  try {
    out.branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'])
    const paths = await known(wanted)
    if (!paths.length) return out
    await git(['add', '--all', '--', ...paths])
    if (!(await git(['diff', '--cached', '--name-only', '--', ...paths]))) return out
    await git(['commit', '--quiet', '-m', subject, '--', ...paths])
    out.committed = true
    out.commit = await git(['rev-parse', '--short', 'HEAD'])
  } catch (error) {
    out.error = `Could not commit: ${message(error)}`
    return out
  }
  try {
    await git(['push', 'origin', 'HEAD'], 180_000)
    out.pushed = true
  } catch (error) {
    out.error = `Committed ${out.commit} but could not push: ${message(error)}. Run "git pull --rebase && git push".`
  }
  return out
}

export const inRepo = (...parts: string[]) => path.join(/*turbopackIgnore: true*/ repoRoot(), ...parts)
