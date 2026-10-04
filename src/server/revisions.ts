import { randomUUID } from 'node:crypto'
import { config } from './config.ts'
import { db, now, tx } from './db.ts'
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

type Row = Record<string, unknown>

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

export function revisionMeta(id: string): RevisionMeta | null {
  const row = db().prepare(`select ${META} from revisions where id = ?`).get(id) as Row | undefined
  return row ? meta(row) : null
}

export function readRevision(id: string): Revision | null {
  const row = db().prepare(`select ${META}, content, blobs from revisions where id = ?`).get(id) as Row | undefined
  if (!row) return null
  return { ...meta(row), content: (row.content as string) ?? null, blobs: row.blobs ? JSON.parse(row.blobs as string) : null }
}

export function head(docId: DocId): Head {
  const row = db().prepare('select draft_rev, published_rev, updated_at from documents where id = ?').get(docId) as Row | undefined
  if (!row) return { draft: null, published: null, updatedAt: null }
  return {
    draft: row.draft_rev ? revisionMeta(row.draft_rev as string) : null,
    published: row.published_rev ? revisionMeta(row.published_rev as string) : null,
    updatedAt: Number(row.updated_at),
  }
}

export function exists(docId: DocId) {
  return !!db().prepare('select 1 from documents where id = ?').get(docId)
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

function insert(docId: DocId, parentId: string | null, input: Omit<WriteInput, 'base' | 'force'>, publishedAt: number | null = null): RevisionMeta {
  const id = randomUUID()
  const body = input.content ?? JSON.stringify(input.blobs ?? {})
  const at = now()
  db().prepare(`insert into revisions (id, doc_id, parent_id, created_at, author_id, author_name, message, schema_version, content, blobs, hash, size, published_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, docId, parentId, at, input.actor.id, input.actor.name, input.message ?? null, input.schemaVersion,
    input.content ?? null, input.blobs ? JSON.stringify(input.blobs) : null, sha256(body),
    input.content ? Buffer.byteLength(input.content) : Object.values(input.blobs ?? {}).reduce((n, b) => n + b.size, 0),
    publishedAt,
  )
  return revisionMeta(id)!
}

/**
 * Creates the document with its first revision, published, if it does not
 * exist yet: the migration of the content that shipped in the repository.
 */
export function seed(docId: DocId, kind: string, input: Omit<WriteInput, 'base' | 'force'>): Head {
  return tx(() => {
    if (exists(docId)) return head(docId)
    const at = now()
    db().prepare('insert into documents (id, kind, draft_rev, published_rev, updated_at) values (?, ?, null, null, ?)').run(docId, kind, at)
    const rev = insert(docId, null, input, at)
    db().prepare('update documents set draft_rev = ?, published_rev = ?, updated_at = ? where id = ?').run(rev.id, rev.id, at, docId)
    audit(input.actor, 'document.seed', { docId, revisionId: rev.id, detail: input.message ?? undefined })
    return head(docId)
  })
}

export function saveDraft(docId: DocId, input: WriteInput): RevisionMeta {
  return tx(() => {
    const current = head(docId)
    const currentId = current.draft?.id ?? null
    if (!input.force && currentId !== input.base) throw new ConflictError(current)
    const rev = insert(docId, currentId, input)
    db().prepare('update documents set draft_rev = ?, updated_at = ? where id = ?').run(rev.id, now(), docId)
    audit(input.actor, input.force ? 'draft.overwrite' : 'draft.save', { docId, revisionId: rev.id, detail: input.message ?? undefined })
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
  const current = head(docId)
  const id = revisionId ?? current.draft?.id
  if (!id) throw new Error('Nothing to publish yet.')
  const rev = readRevision(id)
  if (!rev || rev.docId !== docId) throw new Error('Unknown revision.')
  await validate(rev)
  return tx(() => {
    const again = head(docId)
    if (!revisionId && again.draft?.id !== id) throw new ConflictError(again)
    const at = now()
    db().prepare('update revisions set published_at = coalesce(published_at, ?) where id = ?').run(at, id)
    db().prepare('update documents set published_rev = ?, updated_at = ? where id = ?').run(id, at, docId)
    audit(actor, 'publish', { docId, revisionId: id })
    return revisionMeta(id)!
  })
}

/** Copies an old revision forward as the new draft. Nothing is rewritten. */
export function restore(docId: DocId, revisionId: string, actor: Actor, base: string | null): RevisionMeta {
  const old = readRevision(revisionId)
  if (!old || old.docId !== docId) throw new Error('Unknown revision.')
  const rev = saveDraft(docId, {
    base,
    content: old.content ?? undefined,
    blobs: old.blobs ?? undefined,
    schemaVersion: old.schemaVersion,
    message: `Restored revision from ${new Date(old.createdAt).toISOString()}${old.message ? ` (“${old.message}”)` : ''}`,
    actor,
  })
  audit(actor, 'restore', { docId, revisionId: rev.id, detail: revisionId })
  return rev
}

export function history(docId: DocId, limit = 100): RevisionMeta[] {
  return (db().prepare(`select ${META} from revisions where doc_id = ? order by created_at desc, rowid desc limit ?`).all(docId, limit) as Row[]).map(meta)
}

/** Keeps the heads, the most recent publications and the most recent drafts; the oldest beyond those go. */
export function prune(docId: DocId) {
  const { draft, published } = head(docId)
  const keep = new Set([draft?.id, published?.id].filter(Boolean) as string[])
  const rows = db().prepare('select id, published_at from revisions where doc_id = ? order by created_at desc, rowid desc').all(docId) as Row[]
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
  tx(() => {
    const stmt = db().prepare('delete from revisions where id = ?')
    for (const id of doomed) stmt.run(id)
    // Children of a pruned revision point at nothing; keep the chain readable.
    db().prepare('update revisions set parent_id = null where doc_id = ? and parent_id is not null and parent_id not in (select id from revisions)').run(docId)
  })
  return doomed.length
}

/** Every blob any surviving revision refers to (for garbage collection). */
export function referencedBlobs(): Set<string> {
  const set = new Set<string>()
  for (const row of db().prepare('select blobs from revisions where blobs is not null').all() as Row[]) {
    for (const ref of Object.values(JSON.parse(row.blobs as string) as Record<string, BlobRef>)) set.add(ref.sha)
  }
  return set
}
