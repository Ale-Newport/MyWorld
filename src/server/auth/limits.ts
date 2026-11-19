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

/* The count and the reset happen inside one statement, so failures
   sent in parallel are all counted. A key starts over only when its
   window has passed AND any lock it had ended a full window ago, so
   failing again soon after a lock expires leads to a longer lock. */
const STALE = 'cast(? as bigint) - login_attempts.first_at > cast(? as bigint) and (login_attempts.locked_until is null or cast(? as bigint) - login_attempts.locked_until > cast(? as bigint))'
const COUNT_FAILURE = `insert into login_attempts (key, failures, first_at, locked_until) values (?, 1, cast(? as bigint), null)
  on conflict(key) do update set
    failures = case when ${STALE} then 1 else login_attempts.failures + 1 end,
    first_at = case when ${STALE} then excluded.first_at else login_attempts.first_at end,
    locked_until = case when ${STALE} then null else login_attempts.locked_until end
  returning failures`

export async function recordFailure(keys: string[]) {
  const at = now()
  const d = await db()
  const stale = [at, WINDOW, at, WINDOW]
  for (const key of keys) {
    const row = await d.get<{ failures: number }>(COUNT_FAILURE, [key, at, ...stale, ...stale, ...stale])
    const failures = Number(row?.failures ?? 1)
    if (failures % MAX_FAILURES !== 0) continue
    const locks = failures / MAX_FAILURES
    const lockedUntil = at + WINDOW * 2 ** Math.min(6, locks - 1)
    // Only ever extends a lock, so parallel failures cannot shorten one another's.
    await d.run('update login_attempts set locked_until = cast(? as bigint) where key = ? and (locked_until is null or locked_until < cast(? as bigint))', [lockedUntil, key, lockedUntil])
  }
}

export async function clearFailures(keys: string[]) {
  const d = await db()
  for (const key of keys) await d.run('delete from login_attempts where key = ?', [key])
}
