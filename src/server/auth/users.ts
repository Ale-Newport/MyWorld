import { randomUUID } from 'node:crypto'
import { db, now } from '../db.ts'
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

type Row = Record<string, unknown>
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
  if (db().prepare('select 1 from users where email = ?').get(clean)) throw new Error('An account with that email already exists.')
  const id = randomUUID()
  db().prepare('insert into users (id, email, name, password_hash, role, created_at) values (?, ?, ?, ?, ?, ?)')
    .run(id, clean, name.trim(), await hashPassword(password), 'admin', now())
  return getUser(id)!
}

export function getUser(id: string): User | null {
  const row = db().prepare('select * from users where id = ?').get(id) as Row | undefined
  return row ? toUser(row) : null
}

export function findByEmail(email: string): (User & { passwordHash: string }) | null {
  const row = db().prepare('select * from users where email = ?').get(email.trim().toLowerCase()) as Row | undefined
  return row ? { ...toUser(row), passwordHash: row.password_hash as string } : null
}

export function countUsers() {
  return Number((db().prepare('select count(*) as n from users where disabled = 0').get() as Row).n)
}

export function listUsers(): User[] {
  return (db().prepare('select * from users order by created_at').all() as Row[]).map(toUser)
}

export async function setPassword(id: string, password: string) {
  const user = getUser(id)
  if (!user) throw new Error('Unknown user.')
  const problem = passwordProblem(password, user.email)
  if (problem) throw new Error(problem)
  db().prepare('update users set password_hash = ? where id = ?').run(await hashPassword(password), id)
  // A new password signs every existing session out.
  db().prepare('delete from sessions where user_id = ?').run(id)
}

export function recordLogin(id: string) {
  db().prepare('update users set last_login_at = ? where id = ?').run(now(), id)
}
