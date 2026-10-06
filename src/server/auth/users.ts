import { randomUUID } from 'node:crypto'
import { db, now, type Row } from '../db.ts'
import { hashPassword, passwordProblem } from './password.ts'

/* Administrator accounts. There is no sign-up route anywhere in
   the app: accounts are created from the command line with
   `npm run admin:create` (scripts/admin/create-admin.mjs), which
   calls createUser() below on the server's own database. */

export interface User {
  id: string
  email: string
  name: string
  role: 'admin'
  createdAt: number
  lastLoginAt: number | null
  disabled: boolean
}

const toUser = (r: Row): User => ({
  id: r.id as string,
  email: r.email as string,
  name: r.name as string,
  role: 'admin',
  createdAt: Number(r.created_at),
  lastLoginAt: r.last_login_at == null ? null : Number(r.last_login_at),
  disabled: !!r.disabled,
})

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function createUser({ email, name, password }: { email: string; name: string; password: string }): Promise<User> {
  const clean = email.trim().toLowerCase()
  if (!EMAIL.test(clean)) throw new Error('Enter a valid email address.')
  if (!name.trim()) throw new Error('Enter a name.')
  const problem = passwordProblem(password, clean)
  if (problem) throw new Error(problem)
  const d = await db()
  if (await d.get('select 1 as one from users where email = ?', [clean])) throw new Error('An account with that email already exists.')
  const id = randomUUID()
  await d.run('insert into users (id, email, name, password_hash, role, created_at) values (?, ?, ?, ?, ?, ?)', [id, clean, name.trim(), await hashPassword(password), 'admin', now()])
  return (await getUser(id))!
}

export async function getUser(id: string): Promise<User | null> {
  const row = await (await db()).get('select * from users where id = ?', [id])
  return row ? toUser(row) : null
}

export async function findByEmail(email: string): Promise<(User & { passwordHash: string }) | null> {
  const row = await (await db()).get('select * from users where email = ?', [email.trim().toLowerCase()])
  return row ? { ...toUser(row), passwordHash: row.password_hash as string } : null
}

export async function countUsers() {
  return Number((await (await db()).get('select count(*) as n from users where disabled = 0'))?.n ?? 0)
}

export async function listUsers(): Promise<User[]> {
  return (await (await db()).all('select * from users order by created_at')).map(toUser)
}

export async function setPassword(id: string, password: string) {
  const user = await getUser(id)
  if (!user) throw new Error('Unknown user.')
  const problem = passwordProblem(password, user.email)
  if (problem) throw new Error(problem)
  const d = await db()
  await d.run('update users set password_hash = ? where id = ?', [await hashPassword(password), id])
  // A new password signs every existing session out.
  await d.run('delete from sessions where user_id = ?', [id])
}

export async function recordLogin(id: string) {
  await (await db()).run('update users set last_login_at = ? where id = ?', [now(), id])
}
