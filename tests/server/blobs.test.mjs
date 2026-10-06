import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { freshDataDir, load } from '../setup.mjs'

const dir = freshDataDir('blobs')
const B = await load('src/server/blobs.ts')

test('blobs are content-addressed and checked on write', async () => {
  const a = await B.putBlob(Buffer.from('hello'))
  const again = await B.putBlob(Buffer.from('hello'))
  assert.equal(a.sha, again.sha)
  assert.equal((await B.readBlob(a.sha)).toString(), 'hello')
  await assert.rejects(B.putBlob(Buffer.from('hello'), 'f'.repeat(64)), /checksum/)
  await assert.rejects(B.readBlob('../../etc/passwd'), /Invalid blob name/)
})

test('collection removes only unreferenced blobs older than the grace period', async () => {
  const kept = await B.putBlob(Buffer.from('kept'))
  const orphan = await B.putBlob(Buffer.from('orphan'))
  const fresh = await B.collectBlobs(new Set([kept.sha]), { graceMs: 60_000 })
  assert.equal(fresh.files, 0, 'a just-uploaded orphan may belong to a save in flight')
  const old = new Date(Date.now() - 3_600_000)
  fs.utimesSync(path.join(dir, 'blobs', orphan.sha.slice(0, 2), orphan.sha), old, old)
  const done = await B.collectBlobs(new Set([kept.sha]), { graceMs: 60_000 })
  assert.equal(done.files >= 1, true)
  assert.equal(await B.hasBlob(orphan.sha), false)
  assert.equal(await B.hasBlob(kept.sha), true)
})
