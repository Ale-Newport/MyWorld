import { db, now } from './db.ts'

/* The audit trail: who changed, published, restored, uploaded or
   deleted what, and when. Written inside the same transaction as
   the change where there is one, so the trail cannot disagree
   with the data. Read by the History and Dashboard sections. */

export interface Actor {
  id: string | null
  name: string | null
}

export const SYSTEM: Actor = { id: null, name: 'System' }

export interface AuditEntry {
  id: number
  at: number
  actorId: string | null
  actorName: string | null
  action: string
  docId: string | null
  revisionId: string | null
  detail: string | null
}

export function audit(actor: Actor, action: string, extra: { docId?: string; revisionId?: string; detail?: string } = {}) {
  db().prepare('insert into audit (at, actor_id, actor_name, action, doc_id, revision_id, detail) values (?, ?, ?, ?, ?, ?, ?)')
    .run(now(), actor.id, actor.name, action, extra.docId ?? null, extra.revisionId ?? null, extra.detail?.slice(0, 2000) ?? null)
}

export function recentAudit({ limit = 50, before, action }: { limit?: number; before?: number; action?: string } = {}): AuditEntry[] {
  const where: string[] = []
  const args: (string | number)[] = []
  if (before) { where.push('at < ?'); args.push(before) }
  if (action) { where.push('action like ?'); args.push(`${action}%`) }
  const rows = db().prepare(`select * from audit ${where.length ? 'where ' + where.join(' and ') : ''} order by at desc, id desc limit ?`).all(...args, limit) as Record<string, unknown>[]
  return rows.map((r) => ({
    id: Number(r.id), at: Number(r.at), actorId: (r.actor_id as string) ?? null, actorName: (r.actor_name as string) ?? null,
    action: r.action as string, docId: (r.doc_id as string) ?? null, revisionId: (r.revision_id as string) ?? null, detail: (r.detail as string) ?? null,
  }))
}
