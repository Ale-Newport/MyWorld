import { redirect } from 'next/navigation'
import { currentSession } from '@/server/auth/guard'
import { countUsers } from '@/server/auth/users'
import { LoginForm } from '@/admin/LoginForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Sign in' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  const safeNext = next && next.startsWith('/admin') && !next.startsWith('//') ? next : '/admin'
  if (await currentSession()) redirect(safeNext)
  const noAdmins = countUsers() === 0
  return <LoginForm next={safeNext} noAdmins={noAdmins} />
}
