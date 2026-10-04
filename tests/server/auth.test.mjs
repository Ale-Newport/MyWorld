import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDataDir, load } from '../setup.mjs'

freshDataDir('auth')
const { hashPassword, verifyPassword, passwordProblem } = await load('src/server/auth/password.ts')
const { createUser, findByEmail, countUsers } = await load('src/server/auth/users.ts')
const { createSession, readSession, destroySession, csrfMatches } = await load('src/server/auth/session.ts')
const { db } = await load('src/server/db.ts')

test('passwords are salted scrypt hashes and verify only the right password', async () => {
  const a = await hashPassword('correct horse battery staple')
  const b = await hashPassword('correct horse battery staple')
  assert.notEqual(a, b, 'same password, different salt')
  assert.ok(!a.includes('correct horse'), 'no plaintext in the hash')
  assert.equal(await verifyPassword('correct horse battery staple', a), true)
  assert.equal(await verifyPassword('correct horse battery stapler', a), false)
  assert.equal(await verifyPassword('anything', 'not-a-hash'), false)
})

test('weak passwords are refused with a reason', () => {
  assert.ok(passwordProblem('short'))
  assert.ok(passwordProblem('alex@example.com-is-long', 'alex@example.com'))
  assert.equal(passwordProblem('a long and unusual passphrase 91'), null)
})

test('administrators are created explicitly, once per email', async () => {
  assert.equal(countUsers(), 0, 'no account exists until one is created')
  const user = await createUser({ email: 'Admin@Example.com', name: 'Admin', password: 'a long and unusual passphrase 91' })
  assert.equal(user.email, 'admin@example.com')
  assert.ok(findByEmail('ADMIN@example.com'))
  await assert.rejects(createUser({ email: 'admin@example.com', name: 'Again', password: 'another long passphrase 1234' }), /already exists/)
  await assert.rejects(createUser({ email: 'second@example.com', name: 'Weak', password: 'short' }))
})

test('sessions: the raw token is never stored, CSRF is checked, sign-out and expiry end them', async () => {
  const user = findByEmail('admin@example.com')
  const { token, csrf } = createSession(user.id, 'test-agent')
  const rows = db().prepare('select * from sessions').all()
  assert.ok(rows.every((r) => !Object.values(r).includes(token)), 'only a hash of the token is stored')
  const session = readSession(token)
  assert.equal(session?.user.id, user.id)
  assert.equal(csrfMatches(session, csrf), true)
  assert.equal(csrfMatches(session, 'forged'), false)
  assert.equal(csrfMatches(session, null), false)
  assert.equal(readSession('not-a-real-token'), null)
  destroySession(token)
  assert.equal(readSession(token), null, 'signed out')
  const second = createSession(user.id, null)
  db().prepare('update sessions set expires_at = ?').run(Date.now() - 1000)
  assert.equal(readSession(second.token), null, 'expired')
})
