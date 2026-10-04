import { requireAdmin } from '@/server/auth/guard'
import { AdminShell } from '@/admin/AdminShell'

/* Everything behind the login: the session is verified here, on the
   server, before any panel renders; the API routes check it again. */
export const dynamic = 'force-dynamic'

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin()
  return (
    <AdminShell user={{ name: session.user.name, email: session.user.email }} csrf={session.csrf}>
      {children}
    </AdminShell>
  )
}
