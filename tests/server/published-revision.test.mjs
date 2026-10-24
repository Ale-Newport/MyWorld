import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { freshDataDir, load } from '../setup.mjs'

/* publishedRevision(): the public site and the world release read the PUBLISHED side of a document in ONE
   query, where head() (three sequential queries) plus readRevision (a fourth) used to be needed. It must give
   exactly what those gave. The SQL is the dialect-neutral kind that also runs on Supabase's Postgres. */

const dir = freshDataDir('published-revision')
const R = await load('src/server/revisions.ts')
const actor = { id: null, name: 'Test' }

let statements = 0
const prepare = DatabaseSync.prototype.prepare
DatabaseSync.prototype.prepare = function (sql) {
  statements++
  return prepare.call(this, sql)
}
const counted = async (fn) => {
  statements = 0
  const result = await fn()
  return { result, statements }
}

test('a document that does not exist has nothing published, like head()', async () => {
  assert.equal(await R.publishedRevision('site'), null)
  assert.equal((await R.head('site')).published, null)
})

test('it returns the same revision head() reports as published, in one query instead of three', async () => {
  await R.seed('site', 'site', { content: JSON.stringify({ n: 0 }), schemaVersion: 1, message: 'seed', actor })
  const old = await counted(async () => (await R.head('site')).published)
  const now = await counted(() => R.publishedRevision('site'))
  assert.deepEqual(now.result, old.result)
  assert.equal(old.statements, 3, 'head() is the three sequential queries this replaces')
  assert.equal(now.statements, 1)
})

test('content and blobs come back only when asked for (undefined otherwise), still in one query', async () => {
  const plain = await R.publishedRevision('site')
  assert.equal(plain.content, undefined)
  assert.equal(plain.blobs, undefined)
  const withContent = await counted(() => R.publishedRevision('site', { content: true }))
  assert.equal(withContent.result.content, JSON.stringify({ n: 0 }))
  assert.equal(withContent.result.blobs, undefined)
  assert.equal(withContent.statements, 1)
  const full = await R.readRevision(plain.id)
  assert.equal(withContent.result.content, full.content, 'the same text readRevision() returns')
})

test('a draft saved on top never shows up as published', async () => {
  const published = await R.publishedRevision('site')
  await R.saveDraft('site', { base: (await R.head('site')).draft.id, content: JSON.stringify({ n: 1 }), schemaVersion: 1, actor })
  assert.notEqual((await R.head('site')).draft.id, published.id)
  assert.deepEqual(await R.publishedRevision('site'), published)
  assert.equal((await R.publishedRevision('site', { content: true })).content, JSON.stringify({ n: 0 }))
})

test('publishing moves what it returns, and agrees with head() at every step', async () => {
  await R.publish('site', { actor, validate: () => {} })
  assert.deepEqual(await R.publishedRevision('site'), (await R.head('site')).published)
  assert.equal((await R.publishedRevision('site', { content: true })).content, JSON.stringify({ n: 1 }))
})

test('the world: blob references are parsed, and a blobs-only revision has no content', async () => {
  const blobs = { world: { sha: 'a'.repeat(64), size: 11 }, assets: { sha: 'b'.repeat(64), size: 22 } }
  await R.seed('world', 'world', { blobs, schemaVersion: 2, message: 'seed', actor })
  const found = await counted(() => R.publishedRevision('world', { blobs: true }))
  assert.deepEqual(found.result.blobs, blobs)
  assert.equal(found.result.content, undefined)
  assert.equal(found.statements, 1)
  const full = await R.readRevision(found.result.id)
  assert.deepEqual(full.blobs, found.result.blobs)
  assert.equal(full.content, null)
})

test('a pointer to a revision that is gone is "nothing published", like head()', async () => {
  const published = await R.publishedRevision('world')
  const raw = new DatabaseSync(path.join(dir, 'cms.sqlite'))
  raw.exec('pragma busy_timeout = 5000')
  raw.prepare('delete from revisions where id = ?').run(published.id)
  raw.close()
  assert.equal(await R.publishedRevision('world', { blobs: true }), null)
  assert.equal((await R.head('world')).published, null)
})
