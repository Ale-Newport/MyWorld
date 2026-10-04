import { NextResponse, type NextRequest } from 'next/server'

/* ============================================================
   PROXY — a fast redirect, not the lock

   Admin pages without a session cookie are sent to the login
   page before anything renders, and every admin response is
   marked no-index and same-origin-frame-only. Whether the
   cookie is a real, live session is decided on the server by
   requireAdmin() / adminApi() (src/server/auth/guard.ts) on
   every request; a forged cookie gets past this check and no
   further.
   ============================================================ */

const COOKIE = process.env.NODE_ENV === 'production' ? '__Host-an_admin' : 'an_admin'

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const isPage = pathname === '/admin' || pathname.startsWith('/admin/')
  if (isPage && pathname !== '/admin/login' && !request.cookies.has(COOKIE)) {
    const url = request.nextUrl.clone()
    url.pathname = '/admin/login'
    url.search = `?next=${encodeURIComponent(pathname + search)}`
    return NextResponse.redirect(url)
  }
  const response = NextResponse.next()
  response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  response.headers.set('X-Frame-Options', 'SAMEORIGIN')
  response.headers.set('Referrer-Policy', 'same-origin')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  return response
}

/* Pages only. The admin API authenticates every request itself, and must not
   pass through here: the proxy buffers request bodies up to 10 MB and silently
   truncates the rest, which would cut world uploads (~16 MB) and media short. */
export const config = {
  matcher: ['/admin', '/admin/:path*'],
}
