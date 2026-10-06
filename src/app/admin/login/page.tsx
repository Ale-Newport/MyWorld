import { redirect } from 'next/navigation'
import { currentSession } from '@/server/auth/guard'
import { countUsers } from '@/server/auth/users'
import { LoginForm } from '@/admin/LoginForm'
import { envReport } from '@/server/env'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Sign in' }

/* A store that cannot be reached says why, here and in the Worker's logs,
   instead of an anonymous server error (connection strings are masked). */
const reason = (error: unknown) => {
  const e = error as { message?: string; code?: string; errno?: string } | null
  const text = [e?.code, e?.errno, e?.message].filter(Boolean).join(' · ') || String(error)
  return text.replace(/postgres(ql)?:\/\/\S+/gi, '[connection string]').slice(0, 400)
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  const safeNext = next && next.startsWith('/admin') && !next.startsWith('//') ? next : '/admin'
  let noAdmins: boolean
  try {
    if (await currentSession()) redirect(safeNext)
    noAdmins = (await countUsers()) === 0
  } catch (error) {
    if ((error as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw error
    console.error('[admin] the content store is unavailable:', reason(error))
    return (
      <main style={{ maxWidth: 560, margin: '15vh auto', padding: '0 1.5rem', fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 }}>
        <h1 style={{ fontSize: '1.4rem' }}>The admin cannot reach its database</h1>
        <p>Check the Worker&apos;s <code>DATABASE_URL</code> secret (Supabase → Connect → Transaction pooler, port 6543).</p>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#f3f3f3', padding: '0.8rem', borderRadius: 6 }}>{reason(error)}</pre>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#f3f3f3', padding: '0.8rem', borderRadius: 6, fontSize: 12 }}>{envReport(['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CMS_SECRET'])}</pre>
      </main>
    )
  }
  return <LoginForm next={safeNext} noAdmins={noAdmins} />
}
