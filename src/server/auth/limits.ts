import { db, now } from '../db.ts'

/* Login throttling. Failures are counted per account and per
   address; five in fifteen minutes locks that key for fifteen
   minutes, doubling on each further lock. A correct password
   during a lock is still refused, so the lock cannot be used to
   probe whether a guess was right. */

const WINDOW = 15 * 60 * 1000
const MAX_FAILURES = 5

export function lockedFor(keys: string[]): number {
  const at = now()
  let until = 0
  for (const key of keys) {
    const row = db().prepare('select locked_until from login_attempts where key = ?').get(key) as { locked_until: number | null } | undefined
    if (row?.locked_until && row.locked_until > at) until = Math.max(until, row.locked_until)
  }
  return until ? until - at : 0
}

export function recordFailure(keys: string[]) {
  const at = now()
  for (const key of keys) {
    const row = db().prepare('select * from login_attempts where key = ?').get(key) as { failures: number; first_at: number; locked_until: number | null } | undefined
    if (!row || at - row.first_at > WINDOW && !(row.locked_until && row.locked_until > at)) {
      db().prepare('insert into login_attempts (key, failures, first_at, locked_until) values (?, 1, ?, null) on conflict(key) do update set failures = 1, first_at = excluded.first_at, locked_until = null').run(key, at)
      continue
    }
    const failures = row.failures + 1
    const locks = Math.floor(failures / MAX_FAILURES)
    const lockedUntil = failures % MAX_FAILURES === 0 ? at + WINDOW * 2 ** Math.max(0, locks - 1) : row.locked_until
    db().prepare('update login_attempts set failures = ?, locked_until = ? where key = ?').run(failures, lockedUntil, key)
  }
}

export function clearFailures(keys: string[]) {
  for (const key of keys) db().prepare('delete from login_attempts where key = ?').run(key)
}
