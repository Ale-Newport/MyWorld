import { db, now } from '../db.ts'

/* Login throttling. Failures are counted per account and per
   address; five in fifteen minutes locks that key for fifteen
   minutes, doubling on each further lock. A correct password
   during a lock is still refused, so the lock cannot be used to
   probe whether a guess was right. */

const WINDOW = 15 * 60 * 1000
const MAX_FAILURES = 5

export async function lockedFor(keys: string[]): Promise<number> {
  const at = now()
  const d = await db()
  let until = 0
  for (const key of keys) {
    const row = await d.get<{ locked_until: number | null }>('select locked_until from login_attempts where key = ?', [key])
    const lockedUntil = row?.locked_until == null ? 0 : Number(row.locked_until)
    if (lockedUntil > at) until = Math.max(until, lockedUntil)
  }
  return until ? until - at : 0
}

export async function recordFailure(keys: string[]) {
  const at = now()
  const d = await db()
  for (const key of keys) {
    const raw = await d.get<{ failures: number; first_at: number; locked_until: number | null }>('select * from login_attempts where key = ?', [key])
    const row = raw && { failures: Number(raw.failures), first_at: Number(raw.first_at), locked_until: raw.locked_until == null ? null : Number(raw.locked_until) }
    if (!row || at - row.first_at > WINDOW && !(row.locked_until && row.locked_until > at)) {
      await d.run('insert into login_attempts (key, failures, first_at, locked_until) values (?, 1, ?, null) on conflict(key) do update set failures = 1, first_at = excluded.first_at, locked_until = null', [key, at])
      continue
    }
    const failures = row.failures + 1
    const locks = Math.floor(failures / MAX_FAILURES)
    const lockedUntil = failures % MAX_FAILURES === 0 ? at + WINDOW * 2 ** Math.max(0, locks - 1) : row.locked_until
    await d.run('update login_attempts set failures = ?, locked_until = ? where key = ?', [failures, lockedUntil, key])
  }
}

export async function clearFailures(keys: string[]) {
  const d = await db()
  for (const key of keys) await d.run('delete from login_attempts where key = ?', [key])
}
