import { blobStats, collectBlobs } from './blobs.ts'
import { exists, prune, referencedBlobs } from './revisions.ts'
import { audit, SYSTEM, type Actor } from './audit.ts'
import { config } from './config.ts'
import { db } from './db.ts'

/* ============================================================
   KEEPING THE STORE A SENSIBLE SIZE

   Every world save stores a full world document (~17 MB). After
   a save — at most every ten minutes — and whenever an admin asks
   from History, this keeps:
     · the live and draft revisions of both documents,
     · the most recent publications (config.keepPublishedRevisions),
     · the most recent drafts (fewer for the world),
     · the first revision of each document (the import);
   and then removes the files no surviving revision refers to, but
   only once they are older than config.blobGraceMs, so the upload
   of a save still in flight is never collected under it.
   ============================================================ */

let last = 0

export async function storeStats() {
  const counts = Object.fromEntries((await (await db()).all<{ doc_id: string; n: number }>('select doc_id, count(*) n from revisions group by doc_id')).map((r) => [r.doc_id, Number(r.n)]))
  return { revisions: { site: counts.site ?? 0, world: counts.world ?? 0 }, blobs: await blobStats(), policy: { drafts: config.keepDraftRevisions, worldDrafts: config.keepWorldDraftRevisions, publications: config.keepPublishedRevisions, graceHours: config.blobGraceMs / 3_600_000 } }
}

export async function maintain({ actor = SYSTEM, force = false }: { actor?: Actor; force?: boolean } = {}) {
  if (!force && Date.now() - last < 10 * 60_000) return null
  last = Date.now()
  const revisions = ((await exists('site')) ? await prune('site') : 0) + ((await exists('world')) ? await prune('world') : 0)
  const freed = await collectBlobs(await referencedBlobs(), { graceMs: config.blobGraceMs })
  if (revisions || freed.files) await audit(actor, 'maintenance', { detail: `Removed ${revisions} old revision(s) and ${freed.files} unused file(s), ${(freed.bytes / 1e6).toFixed(1)} MB` })
  return { removedRevisions: revisions, removedFiles: freed.files, freedBytes: freed.bytes, ...(await storeStats()) }
}

/** After a save: never fails the save it follows. */
export async function maintainQuietly(actor?: Actor) {
  try { await maintain({ actor }) } catch (error) { console.error('[maintenance]', error) }
}
