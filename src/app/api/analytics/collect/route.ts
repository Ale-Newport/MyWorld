import type { NextRequest } from 'next/server'
import { recordBatch } from '@/server/analytics'
import { readSession, SESSION_COOKIE } from '@/server/auth/session'
import { publishedSite } from '@/server/site'

export const runtime = 'nodejs'

/* Beacon endpoint. Always answers 204: whether an event was kept is
   nobody's business but the admin's. See server/analytics.ts for what
   is stored and what is dropped. */
export async function POST(req: NextRequest) {
  const done = new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
  if (!publishedSite().doc.settings.options.analytics) return done
  const raw = await req.text().catch(() => '')
  if (!raw || raw.length > 32_000) return done
  let body: unknown
  try { body = JSON.parse(raw) } catch { return done }
  try {
    recordBatch(body as object, {
      ip: (req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'local').trim(),
      ua: req.headers.get('user-agent') ?? '',
      host: req.headers.get('x-forwarded-host') ?? req.headers.get('host'),
      gpc: req.headers.get('sec-gpc') === '1',
      dnt: req.headers.get('dnt') === '1',
      // An administrator's own browsing and anything rendered in Draft Mode is never counted.
      admin: !!readSession(req.cookies.get(SESSION_COOKIE)?.value) || req.cookies.has('__prerender_bypass'),
    })
  } catch (error) {
    // Misconfiguration (no CMS_SECRET in production) records nothing; the visitor is not affected.
    console.error('[analytics] not recording:', (error as Error).message)
  }
  return done
}
