import path from 'node:path'
import { env } from './env.ts'

/* ============================================================
   SERVER CONFIGURATION

   Everything the admin and the content store need from the
   environment, read in one place. Nothing here is a secret that
   ships to the browser: this module is only ever imported by
   route handlers, server components and scripts.

   CMS_DATA_DIR   where the SQLite database, revision blobs and
                  uploaded media live. A persistent volume in
                  production (see docs/ADMIN.md). Defaults to
                  `.data/cms` in the project, which is git-ignored.
   CMS_SECRET     32+ random bytes, used to derive the analytics
                  visitor-hash salt. Required in production.
   ============================================================ */

export const config = {
  // Runtime state, not source: excluded from the bundler's file tracing.
  dataDir: path.resolve(/* turbopackIgnore: true */ process.env.CMS_DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), '.data', 'cms')),
  production: process.env.NODE_ENV === 'production',
  /** Sessions last two weeks of inactivity at most, and 30 days absolute. */
  sessionIdleMs: 14 * 24 * 60 * 60 * 1000,
  sessionMaxMs: 30 * 24 * 60 * 60 * 1000,
  /** Upload limits. Worlds are big: the compressed Archipelago is ~16 MB. */
  maxWorldBlobBytes: 96 * 1024 * 1024,
  maxWorldJsonBytes: 400 * 1024 * 1024,
  maxMediaBytes: 25 * 1024 * 1024,
  /** Draft revisions kept per document beyond the published ones. */
  keepDraftRevisions: 40,
  /** World documents are ~17 MB each: fewer of them are kept. */
  keepWorldDraftRevisions: 12,
  /** Earlier publications kept for restoring, besides the live one. */
  keepPublishedRevisions: 20,
  /** An unreferenced blob is only collected once it is this old, so an upload for a save still in flight is never removed. */
  blobGraceMs: 6 * 60 * 60 * 1000,
}

export function cmsSecret(): string {
  const value = env('CMS_SECRET')
  if (value && value.length >= 32) return value
  if (config.production) throw new Error('CMS_SECRET must be set (32+ characters) in production. See .env.example.')
  // Development only: a fixed, clearly non-production value so local runs work out of the box.
  return 'development-only-cms-secret-do-not-use-in-production'
}

export function dataPath(...parts: string[]) {
  return path.join(/* turbopackIgnore: true */ config.dataDir, ...parts)
}
