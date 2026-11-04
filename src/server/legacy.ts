import { audit, type Actor } from './audit.ts'
import { db } from './db.ts'
import { deleteObjects, listObjects } from './storage.ts'

/* ============================================================
   THE OLD CONTENT STORE

   Before the website was published through git, the content store
   (revisions of the site and of the world, the media library) lived
   in the database and the storage bucket, and the site read it on
   every visit. The deployed site no longer reads any of it: the
   website is content/published, the world is content/world, and the
   editor keeps its drafts on your own machine. What is left in the
   database and the bucket is dead weight, and the world documents
   among it are 17 MB each.

   This reports what is left and removes it. It touches only the
   content store: users, sessions, the activity log and the audience's
   events stay.
   ============================================================ */

export interface LegacyStats {
  revisions: number
  revisionBytes: number
  documents: number
  media: number
  files: number
  fileBytes: number
}

export async function legacyStats(): Promise<LegacyStats> {
  const d = await db()
  const revisions = await d.get<{ n: number; bytes: number }>('select count(*) n, coalesce(sum(size), 0) bytes from revisions')
  const documents = await d.get<{ n: number }>('select count(*) n from documents')
  const media = await d.get<{ n: number }>('select count(*) n from media')
  const files = [...(await listObjects('blobs')), ...(await listObjects('media'))]
  return {
    revisions: Number(revisions?.n ?? 0),
    revisionBytes: Number(revisions?.bytes ?? 0),
    documents: Number(documents?.n ?? 0),
    media: Number(media?.n ?? 0),
    files: files.length,
    fileBytes: files.reduce((n, o) => n + o.size, 0),
  }
}

/** Removes the old content store. Returns what it held. */
export async function clearLegacy(actor: Actor): Promise<LegacyStats> {
  const before = await legacyStats()
  const d = await db()
  // Files first: if it stops half way, the rows still say what is left to remove.
  const files = [...(await listObjects('blobs')), ...(await listObjects('media'))]
  await deleteObjects(files.map((o) => o.key))
  await d.run('delete from revisions')
  await d.run('delete from documents')
  await d.run('delete from media')
  await audit(actor, 'maintenance', { detail: `Removed the old content store: ${before.revisions} revision(s), ${before.media} media item(s), ${before.files} file(s), ${(before.fileBytes / 1e6).toFixed(1)} MB` })
  return before
}
