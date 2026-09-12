import type { NextRequest } from 'next/server'
import { draftMode } from 'next/headers'
import { destroySession, SESSION_COOKIE } from '@/server/auth/session'
import { adminApi, json } from '@/server/auth/guard'
import { audit } from '@/server/audit'

export const runtime = 'nodejs'

export const POST = adminApi(async (req: NextRequest, { actor }) => {
  destroySession(req.cookies.get(SESSION_COOKIE)?.value)
  audit(actor, 'auth.logout')
  // Signed out, this browser is a visitor again: no draft previews.
  ;(await draftMode()).disable()
  const res = json({ ok: true })
  res.headers.append('set-cookie', `${SESSION_COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`)
  return res
})
