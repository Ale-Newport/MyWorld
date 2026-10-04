import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { NextRequest } from 'next/server'
import { csrfMatches, readSession, SESSION_COOKIE, type Session } from './session.ts'
import type { Actor } from '../audit.ts'

/* ============================================================
   THE GUARDS

   Every admin page calls requireAdmin() on the server before it
   renders anything, and every admin API route is wrapped in
   adminApi(), which checks the session and, for anything that
   changes state, the CSRF token and the request's origin. The
   proxy's cookie check in src/proxy.ts is only a fast redirect;
   it is never what keeps anyone out.
   ============================================================ */

export async function currentSession(): Promise<Session | null> {
  return readSession((await cookies()).get(SESSION_COOKIE)?.value)
}

export async function requireAdmin(next = '/admin'): Promise<Session> {
  const session = await currentSession()
  if (!session) redirect(`/admin/login?next=${encodeURIComponent(next)}`)
  return session
}

export const actorOf = (session: Session): Actor => ({ id: session.user.id, name: session.user.name })

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } })
}

export function problem(status: number, message: string, extra: Record<string, unknown> = {}) {
  return json({ error: message, ...extra }, status)
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Same-origin only: the Origin header, when present, must be this site; fetch metadata must not say cross-site. */
export function sameOrigin(req: NextRequest) {
  const origin = req.headers.get('origin')
  const site = req.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') return false
  if (!origin) return true
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

type Handler<C> = (req: NextRequest, ctx: C & { session: Session; actor: Actor }) => Promise<Response> | Response

export function adminApi<C = object>(handler: Handler<C>) {
  return async (req: NextRequest, ctx: C) => {
    const session = readSession(req.cookies.get(SESSION_COOKIE)?.value)
    if (!session) return problem(401, 'Sign in to continue.')
    if (MUTATING.has(req.method)) {
      if (!sameOrigin(req)) return problem(403, 'Cross-site request refused.')
      if (!csrfMatches(session, req.headers.get('x-csrf-token'))) return problem(403, 'Missing or invalid CSRF token. Reload the admin and try again.')
    }
    try {
      return await handler(req, { ...ctx, session, actor: actorOf(session) })
    } catch (error) {
      const name = (error as Error)?.name
      if (name === 'ConflictError') return problem(409, (error as Error).message, { head: (error as { head?: unknown }).head })
      if (name === 'ValidationError' || name === 'ZodError') return problem(422, (error as Error).message, { issues: (error as { issues?: unknown }).issues })
      console.error('[admin api]', error)
      return problem(500, (error as Error)?.message || 'Unexpected error.')
    }
  }
}

/* Kept in its own module so code that only validates (media, the world) has no tie to Next's request APIs. */
export { ValidationError } from '../errors.ts'
