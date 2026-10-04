import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { config } from '../config.ts'
import { db, now } from '../db.ts'
import { getUser, type User } from './users.ts'

/* ============================================================
   SESSIONS

   The cookie carries 32 random bytes; the database stores only
   their SHA-256, so a leaked database does not hand out live
   sessions. Each session has its own CSRF token, returned to the
   admin UI and required on every state-changing request.

   The cookie is httpOnly, SameSite=Strict, and Secure in
   production under the `__Host-` prefix (no Domain, Path=/), so
   it is never readable by script, never sent cross-site and
   never shared with a subdomain.
   ============================================================ */

export const SESSION_COOKIE = config.production ? '__Host-an_admin' : 'an_admin'

export interface Session {
  idHash: string
  user: User
  csrf: string
  createdAt: number
  expiresAt: number
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex')

export function createSession(userId: string, userAgent: string | null) {
  const token = randomBytes(32).toString('base64url')
  const csrf = randomBytes(24).toString('base64url')
  const at = now()
  db().prepare('insert into sessions (id_hash, user_id, csrf, created_at, last_seen_at, expires_at, user_agent) values (?, ?, ?, ?, ?, ?, ?)')
    .run(hash(token), userId, csrf, at, at, at + config.sessionIdleMs, userAgent?.slice(0, 300) ?? null)
  return { token, csrf, expiresAt: at + config.sessionIdleMs }
}

export function readSession(token: string | undefined | null): Session | null {
  if (!token || token.length < 30 || token.length > 100) return null
  const idHash = hash(token)
  const row = db().prepare('select * from sessions where id_hash = ?').get(idHash) as Record<string, unknown> | undefined
  if (!row) return null
  const at = now()
  const created = Number(row.created_at)
  if (Number(row.expires_at) < at || created + config.sessionMaxMs < at) {
    db().prepare('delete from sessions where id_hash = ?').run(idHash)
    return null
  }
  const user = getUser(row.user_id as string)
  if (!user || user.disabled) return null
  // Sliding expiry, written at most once a minute.
  if (at - Number(row.last_seen_at) > 60_000) {
    db().prepare('update sessions set last_seen_at = ?, expires_at = ? where id_hash = ?').run(at, Math.min(at + config.sessionIdleMs, created + config.sessionMaxMs), idHash)
  }
  return { idHash, user, csrf: row.csrf as string, createdAt: created, expiresAt: Number(row.expires_at) }
}

export function destroySession(token: string | undefined | null) {
  if (token) db().prepare('delete from sessions where id_hash = ?').run(hash(token))
}

export function csrfMatches(session: Session, supplied: string | null) {
  if (!supplied) return false
  const a = Buffer.from(session.csrf), b = Buffer.from(supplied)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function cookieOptions(expiresAt: number) {
  return {
    httpOnly: true,
    secure: config.production,
    sameSite: 'strict' as const,
    path: '/',
    expires: new Date(expiresAt),
  }
}
