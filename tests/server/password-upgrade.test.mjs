import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, scryptSync } from 'node:crypto'
import { freshDataDir, load } from '../setup.mjs'

freshDataDir('password-upgrade')
const { hashPassword, verifyPassword, needsRehash } = await load('src/server/auth/password.ts')
const { createUser, findByEmail, upgradePasswordHash } = await load('src/server/auth/users.ts')
const { createSession, readSession } = await load('src/server/auth/session.ts')

const PASSWORD = 'a long and unusual passphrase 91'

/** A hash in the stored format, made directly with node:crypto (as the earlier p = 1 setting did). */
function legacyHash(password, { n = 32768, r = 8, p = 1 } = {}) {
  const salt = randomBytes(16)
  const key = scryptSync(password.normalize('NFKC'), salt, 64, { N: n, r, p, maxmem: 64 * 1024 * 1024 })
  return ['scrypt', n, r, p, salt.toString('base64url'), key.toString('base64url')].join('$')
}

test('new hashes use N=2^15, r=8, p=3 (OWASP-equivalent, 32 MiB)', async () => {
  const current = await hashPassword(PASSWORD)
  assert.deepEqual(current.split('$').slice(0, 4), ['scrypt', '32768', '8', '3'])
  assert.equal(needsRehash(current), false)
})

test('hashes from the earlier setting still verify, and are flagged for an upgrade', async () => {
  const old = legacyHash(PASSWORD)
  assert.equal(await verifyPassword(PASSWORD, old), true, 'existing accounts keep working')
  assert.equal(await verifyPassword(`${PASSWORD}!`, old), false)
  assert.equal(needsRehash(old), true)
  assert.equal(needsRehash('bcrypt$whatever'), true)
})

test('an upgrade after a correct sign-in keeps the password and the sessions', async () => {
  const user = await createUser({ email: 'owner@example.com', name: 'Owner', password: PASSWORD })
  const session = await createSession(user.id, 'test')
  await upgradePasswordHash(user.id, PASSWORD)
  const after = await findByEmail('owner@example.com')
  assert.equal(needsRehash(after.passwordHash), false)
  assert.equal(await verifyPassword(PASSWORD, after.passwordHash), true)
  assert.ok(await readSession(session.token), 'the session survives: the password did not change')
})
