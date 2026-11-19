import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDataDir, load } from '../setup.mjs'

freshDataDir('login-limits')
const { lockedFor, recordFailure, clearFailures } = await load('src/server/auth/limits.ts')
const { db } = await load('src/server/db.ts')

const WINDOW = 15 * 60 * 1000
const row = async (key) => (await db()).get('select failures, first_at, locked_until from login_attempts where key = ?', [key])

test('five failures lock the key; a success clears it', async () => {
  const keys = ['email:a@example.com']
  for (let i = 0; i < 4; i++) await recordFailure(keys)
  assert.equal(await lockedFor(keys), 0, 'four failures do not lock')
  await recordFailure(keys)
  const wait = await lockedFor(keys)
  assert.ok(wait > WINDOW - 5000 && wait <= WINDOW, `locked for about fifteen minutes (got ${wait})`)
  await clearFailures(keys)
  assert.equal(await lockedFor(keys), 0)
  assert.equal(await row(keys[0]), undefined)
})

test('failures sent in parallel are all counted', async () => {
  const keys = ['ip:203.0.113.7']
  await Promise.all(Array.from({ length: 12 }, () => recordFailure(keys)))
  assert.equal(Number((await row(keys[0])).failures), 12)
  assert.ok(await lockedFor(keys) > 0)
})

test('failing again soon after a lock ends leads to a longer lock', async () => {
  const key = 'email:b@example.com'
  for (let i = 0; i < 5; i++) await recordFailure([key])
  // The first lock (and its window) ended a minute ago.
  const past = Date.now() - WINDOW - 60_000
  await (await db()).run('update login_attempts set first_at = ?, locked_until = ? where key = ?', [past - WINDOW, Date.now() - 60_000, key])
  for (let i = 0; i < 5; i++) await recordFailure([key])
  const wait = await lockedFor([key])
  assert.ok(wait > 2 * WINDOW - 5000, `the second lock doubles (got ${wait})`)
})

test('a key starts over once its window and any lock are long past', async () => {
  const key = 'email:c@example.com'
  for (let i = 0; i < 3; i++) await recordFailure([key])
  const longAgo = Date.now() - 3 * WINDOW
  await (await db()).run('update login_attempts set first_at = ? where key = ?', [longAgo, key])
  await recordFailure([key])
  assert.equal(Number((await row(key)).failures), 1)
})
