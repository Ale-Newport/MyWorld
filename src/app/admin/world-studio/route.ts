import fs from 'node:fs'
import path from 'node:path'
import type { NextRequest } from 'next/server'
import { readSession, SESSION_COOKIE } from '@/server/auth/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* ============================================================
   THE WORLD STUDIO — HelloWorld's editor, inside the admin

   The same editor HelloWorld ran on its local Python server, now
   served by the portfolio to a signed-in administrator only. It
   runs the exact runtime modules /world runs (public/archipelago/
   preview, via <base>), loads the DRAFT world through the
   authenticated draft endpoint, and saves draft revisions through
   the portfolio's API with this session's CSRF token. It is framed
   by /admin/world, which adds validation and publishing.
   ============================================================ */

const TEMPLATE = path.join(process.cwd(), 'src', 'server', 'world-studio', 'studio.html')

export function GET(req: NextRequest) {
  const session = readSession(req.cookies.get(SESSION_COOKIE)?.value)
  if (!session) return Response.redirect(new URL('/admin/login?next=/admin/world', req.url), 307)
  const config = {
    release: '/api/admin/world/draft',
    draft: '/api/admin/world/draft',
    blobs: '/api/admin/world/blobs',
    csrf: session.csrf,
    studio: true,
  }
  const html = fs.readFileSync(TEMPLATE, 'utf8').replace('<!--CONFIG-->', `<script>window.ARCHIPELAGO_CONFIG=${JSON.stringify(config).replace(/</g, '\\u003c')}</script>`)
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-frame-options': 'SAMEORIGIN',
      'x-robots-tag': 'noindex, nofollow',
      'referrer-policy': 'same-origin',
    },
  })
}
