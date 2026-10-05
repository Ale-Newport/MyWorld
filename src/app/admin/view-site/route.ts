import { draftMode } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'

export const runtime = 'nodejs'

/* "View site" from the admin: the public site as a visitor sees it.
   The editor's preview frames switch this browser into Draft Mode,
   and the cookie would otherwise follow the administrator onto the
   public pages, showing the unpublished draft there. Leaving through
   here switches it off first; the editors switch it back on when
   they open a preview. Only site paths are accepted as targets. */
export async function GET(req: NextRequest) {
  ;(await draftMode()).disable()
  const to = req.nextUrl.searchParams.get('to') ?? '/'
  const target = to.startsWith('/') && !to.startsWith('//') && !to.startsWith('/admin') ? to : '/'
  return NextResponse.redirect(new URL(target, req.nextUrl.origin), 303)
}
