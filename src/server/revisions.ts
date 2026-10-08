import { randomUUID } from 'node:crypto'
import { config } from './config.ts'
import { db, now, tx, type Row } from './db.ts'
import { sha256 } from './blobs.ts'
import { audit, type Actor } from './audit.ts'

/* ============================================================
   DOCUMENTS AND REVISIONS

   Every editable thing — the site content, the world — is a
   document with an append-only line of revisions. Two pointers
   per document say which revision is the working DRAFT and which
   is PUBLISHED; the public website only ever reads the second.

   Saving a draft names the revision it was based on. If someone
   else (another tab, another session) saved in between, the base
   no longer matches the head and the save is refused with the
   current head, instead of silently overwriting their work.

   Publishing moves one pointer inside a transaction, after the
   caller's validation has passed — a failed upload or an invalid
   document can therefore never replace the version visitors see.
   Restoring an old revision copies it forward as a new draft, so
   history is never rewritten.
   ============================================================ */

export type DocId = 'site' | 'world'

export interface RevisionMeta {
  id: string
  docId: DocId
  parentId: string | null
  createdAt: number
  authorId: string | null
  authorName: string | null
  message: string | null
  schemaVersion: number
  hash: string
  size: number
  publishedAt: number | null
}

export interface BlobRef {
  sha: string
  size: number
}

export interface Revision extends RevisionMeta {
  content: string | null
  blobs: Record<string, BlobRef> | null
}

export interface Head {
  draft: RevisionMeta | null
  published: RevisionMeta | null
  updatedAt: number | null
}

export class ConflictError extends Error {
  name = 'ConflictError'
  head: Head
  constructor(current: Head) {
    super('This document was changed in another tab or session since you opened it.')
    this.head = current
  }
}


function meta(row: Row): RevisionMeta {
  return {
    id: row.id as string,
    docId: row.doc_id as DocId,
    parentId: (row.parent_id as string) ?? null,
    createdAt: Number(row.created_at),
    authorId: (row.author_id as string) ?? null,
    authorName: (row.author_name as string) ?? null,
    message: (row.message as string) ?? null,
    schemaVersion: Number(row.schema_version),
    hash: row.hash as string,
    size: Number(row.size),
    publishedAt: row.published_at == null ? null : Number(row.published_at),
  }
}

const META = 'id, doc_id, parent_id, created_at, author_id, author_name, message, schema_version, hash, size, published_at'

export async function revisionMeta(id: string): Promise<RevisionMeta | null> {
  const row = await (await db()).get(`select ${META} from revisions where id = ?`, [id])
  return row ? meta(row) : null
}

export async function readRevision(id: string): Promise<Revision | null> {
  const row = await (await db()).get(`select ${META}, content, blobs from revisions where id = ?`, [id])
  if (!row) return null
  return { ...meta(row), content: (row.content as string) ?? null, blobs: row.blobs ? JSON.parse(row.blobs as string) : null }
}

export async function head(docId: DocId): Promise<Head> {
  const row = await (await db()).get('select draft_rev, published_rev, updated_at from documents where id = ?', [docId])
  if (!row) return { draft: null, published: null, updatedAt: null }
  return {
    draft: row.draft_rev ? await revisionMeta(row.draft_rev as string) : null,
    published: row.published_rev ? await revisionMeta(row.published_rev as string) : null,
    updatedAt: Number(row.updated_at),
  }
}

export async function exists(docId: DocId) {
  return !!(await (await db()).get('select 1 as one from documents where id = ?', [docId]))
}

interface WriteInput {
  base: string | null
  content?: string
  blobs?: Record<string, BlobRef>
  schemaVersion: number
  message?: string
  actor: Actor
  /** Skip the base check: an explicit "overwrite theirs" from the conflict dialog. */
  force?: boolean
}

async function insert(docId: DocId, parentId: string | null, input: Omit<WriteInput, 'base' | 'force'>, publishedAt: number | null = null): Promise<RevisionMeta> {
  const id = randomUUID()
  const body = input.content ?? JSON.stringify(input.blobs ?? {})
  const at = now()
  const d = await db()
  // The Cloudflare TCP socket closes when a single Postgres parameter reaches
  // roughly 64 KiB. Write large documents in smaller pieces in this transaction.
  // Slice on UTF-16 boundaries without splitting a surrogate pair.
  const chunks: string[] = []
  if (input.content && d.dialect === 'postgres') {
    for (let start = 0; start < input.content.length;) {
      let end = Math.min(start + 8192, input.content.length)
      if (end < input.content.length && end > start) {
        const last = input.content.charCodeAt(end - 1)
        if (last >= 0xd800 && last <= 0xdbff) end--
      }
      chunks.push(input.content.slice(start, end))
      start = end
    }
  }
  await d.run(`insert into revisions (id, doc_id, parent_id, created_at, author_id, author_name, message, schema_version, content, blobs, hash, size, published_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    id, docId, parentId, at, input.actor.id, input.actor.name, input.message ?? null, input.schemaVersion,
    chunks.length ? chunks[0] : input.content ?? null, input.blobs ? JSON.stringify(input.blobs) : null, sha256(body),
    input.content ? Buffer.byteLength(input.content) : Object.values(input.blobs ?? {}).reduce((n, b) => n + b.size, 0),
    publishedAt,
  ])
  for (const chunk of chunks.slice(1)) {
    await d.run('update revisions set content = content || ? where id = ?', [chunk, id])
  }
  return (await revisionMeta(id))!
}

/**
 * Creates the document with its first revision, published, if it does not
 * exist yet: the migration of the content that shipped in the repository.
 */
export function seed(docId: DocId, kind: string, input: Omit<WriteInput, 'base' | 'force'>): Promise<Head> {
  return tx(async () => {
    if (await exists(docId)) return head(docId)
    const d = await db()
    const at = now()
    await d.run('insert into documents (id, kind, draft_rev, published_rev, updated_at) values (?, ?, null, null, ?)', [docId, kind, at])
    const rev = await insert(docId, null, input, at)
    await d.run('update documents set draft_rev = ?, published_rev = ?, updated_at = ? where id = ?', [rev.id, rev.id, at, docId])
    await audit(input.actor, 'document.seed', { docId, revisionId: rev.id, detail: input.message ?? undefined })
    return head(docId)
  })
}

export function saveDraft(docId: DocId, input: WriteInput): Promise<RevisionMeta> {
  return tx(async () => {
    const current = await head(docId)
    const currentId = current.draft?.id ?? null
    if (!input.force && currentId !== input.base) throw new ConflictError(current)
    const rev = await insert(docId, currentId, input)
    await (await db()).run('update documents set draft_rev = ?, updated_at = ? where id = ?', [rev.id, now(), docId])
    await audit(input.actor, input.force ? 'draft.overwrite' : 'draft.save', { docId, revisionId: rev.id, detail: input.message ?? undefined })
    return rev
  })
}

/**
 * Publishes `revisionId` (the current draft by default) after `validate`
 * accepts it. Validation runs before the transaction; the pointer only
 * moves if the draft is still the one that was validated.
 */
export async function publish(docId: DocId, { revisionId, actor, validate }: {
  revisionId?: string
  actor: Actor
  validate: (rev: Revision) => Promise<void> | void
}): Promise<RevisionMeta> {
  const current = await head(docId)
  const id = revisionId ?? current.draft?.id
  if (!id) throw new Error('Nothing to publish yet.')
  const rev = await readRevision(id)
  if (!rev || rev.docId !== docId) throw new Error('Unknown revision.')
  await validate(rev)
  return tx(async () => {
    const again = await head(docId)
    if (!revisionId && again.draft?.id !== id) throw new ConflictError(again)
    const d = await db()
    const at = now()
    await d.run('update revisions set published_at = coalesce(published_at, ?) where id = ?', [at, id])
    await d.run('update documents set published_rev = ?, updated_at = ? where id = ?', [id, at, docId])
    await audit(actor, 'publish', { docId, revisionId: id })
    return (await revisionMeta(id))!
  })
}

/** Copies an old revision forward as the new draft. Nothing is rewritten. */
export async function restore(docId: DocId, revisionId: string, actor: Actor, base: string | null): Promise<RevisionMeta> {
  const old = await readRevision(revisionId)
  if (!old || old.docId !== docId) throw new Error('Unknown revision.')
  const rev = await saveDraft(docId, {
    base,
    content: old.content ?? undefined,
    blobs: old.blobs ?? undefined,
    schemaVersion: old.schemaVersion,
    message: `Restored revision from ${new Date(old.createdAt).toISOString()}${old.message ? ` (“${old.message}”)` : ''}`,
    actor,
  })
  await audit(actor, 'restore', { docId, revisionId: rev.id, detail: revisionId })
  return rev
}

export async function history(docId: DocId, limit = 100): Promise<RevisionMeta[]> {
  return (await (await db()).all(`select ${META} from revisions where doc_id = ? order by created_at desc, id desc limit ?`, [docId, limit])).map(meta)
}

/** Keeps the heads, the most recent publications and the most recent drafts; the oldest beyond those go. */
export async function prune(docId: DocId) {
  const { draft, published } = await head(docId)
  const keep = new Set([draft?.id, published?.id].filter(Boolean) as string[])
  const rows = await (await db()).all('select id, published_at from revisions where doc_id = ? order by created_at desc, id desc', [docId])
  const keepDrafts = docId === 'world' ? config.keepWorldDraftRevisions : config.keepDraftRevisions
  let drafts = 0, publications = 0
  const doomed: string[] = []
  for (const row of rows) {
    const id = row.id as string
    if (keep.has(id)) continue
    // The first revision is the import every history starts from: never pruned.
    if (row === rows[rows.length - 1]) continue
    if (row.published_at != null) { if (++publications > config.keepPublishedRevisions) doomed.push(id); continue }
    if (++drafts > keepDrafts) doomed.push(id)
  }
  if (!doomed.length) return 0
  await tx(async () => {
    const d = await db()
    for (const id of doomed) await d.run('delete from revisions where id = ?', [id])
    // Children of a pruned revision point at nothing; keep the chain readable.
    await d.run('update revisions set parent_id = null where doc_id = ? and parent_id is not null and parent_id not in (select id from revisions)', [docId])
  })
  return doomed.length
}

/** Every blob any surviving revision refers to (for garbage collection). */
export async function referencedBlobs(): Promise<Set<string>> {
  const set = new Set<string>()
  for (const row of await (await db()).all('select blobs from revisions where blobs is not null')) {
    for (const ref of Object.values(JSON.parse(row.blobs as string) as Record<string, BlobRef>)) set.add(ref.sha)
  }
  return set
}
