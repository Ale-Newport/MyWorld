import { requireAdmin } from '@/server/auth/guard'
import { AdminShell } from '@/admin/AdminShell'
import { EDITOR } from '@/server/mode'
import { publishedSite } from '@/server/site'
import { publicSiteUrl } from '@/lib/site-url'

/* Everything behind the login: the session is verified here, on the
   server, before any panel renders; the API routes check it again. */
export const dynamic = 'force-dynamic'

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin()
  const { doc } = await publishedSite()
  return (
    <AdminShell user={{ name: session.user.name, email: session.user.email }} csrf={session.csrf} editor={EDITOR} siteUrl={publicSiteUrl(doc.settings.siteUrl)}>
      {children}
    </AdminShell>
  )
}
