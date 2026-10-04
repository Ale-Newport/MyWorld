import type { NextRequest } from 'next/server'
import { findByEmail, recordLogin } from '@/server/auth/users'
import { verifyPassword } from '@/server/auth/password'
import { createSession, cookieOptions, SESSION_COOKIE } from '@/server/auth/session'
import { clearFailures, lockedFor, recordFailure } from '@/server/auth/limits'
import { json, problem, sameOrigin } from '@/server/auth/guard'
import { audit } from '@/server/audit'

export const runtime = 'nodejs'

/* A fixed hash to verify against when the account does not exist,
   so a missing account and a wrong password take the same time. */
const DECOY = 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

function clientAddress(req: NextRequest) {
  return (req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'local').trim().slice(0, 64)
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return problem(403, 'Cross-site request refused.')
  let body: { email?: unknown; password?: unknown }
  try {
    body = await req.json()
  } catch {
    return problem(400, 'Send JSON with an email and a password.')
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 200) : ''
  const password = typeof body.password === 'string' ? body.password.slice(0, 256) : ''
  if (!email || !password) return problem(400, 'Enter your email and password.')
  const keys = [`email:${email}`, `ip:${clientAddress(req)}`]
  const wait = lockedFor(keys)
  if (wait) return problem(429, `Too many attempts. Try again in ${Math.ceil(wait / 60000)} minutes.`, { retryAfter: Math.ceil(wait / 1000) })
  const user = findByEmail(email)
  const ok = await verifyPassword(password, user?.passwordHash ?? DECOY)
  if (!user || !ok || user.disabled) {
    recordFailure(keys)
    audit({ id: null, name: null }, 'auth.failed', { detail: email })
    return problem(401, 'That email and password do not match an administrator.')
  }
  clearFailures(keys)
  recordLogin(user.id)
  const session = createSession(user.id, req.headers.get('user-agent'))
  audit({ id: user.id, name: user.name }, 'auth.login')
  const res = json({ user: { id: user.id, email: user.email, name: user.name }, csrf: session.csrf })
  const cookie = cookieOptions(session.expiresAt)
  res.headers.append('set-cookie', `${SESSION_COOKIE}=${session.token}; Path=${cookie.path}; Expires=${cookie.expires.toUTCString()}; HttpOnly; SameSite=Strict${cookie.secure ? '; Secure' : ''}`)
  return res
}
