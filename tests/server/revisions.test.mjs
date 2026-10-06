import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDataDir, load } from '../setup.mjs'

freshDataDir('revisions')
const R = await load('src/server/revisions.ts')
const { config } = await load('src/server/config.ts')
const actor = { id: null, name: 'Test' }
const doc = (n) => JSON.stringify({ n })

test('a document starts with its seed revision, published', async () => {
  const head = await R.seed('site', 'site', { content: doc(0), schemaVersion: 1, message: 'seed', actor })
  assert.ok(head.draft && head.published && head.draft.id === head.published.id)
})

test('saving on top of a stale base is a conflict; force overwrites it', async () => {
  const base = (await R.head('site')).draft.id
  const a = await R.saveDraft('site', { base, content: doc(1), schemaVersion: 1, actor })
  await assert.rejects(R.saveDraft('site', { base, content: doc(2), schemaVersion: 1, actor }), (e) => e.name === 'ConflictError' && e.head.draft.id === a.id)
  const forced = await R.saveDraft('site', { base, content: doc(2), schemaVersion: 1, actor, force: true })
  assert.equal((await R.head('site')).draft.id, forced.id)
})

test('publishing moves the live pointer only after validation passes', async () => {
  const before = (await R.head('site')).published.id
  await assert.rejects(R.publish('site', { actor, validate: () => { throw new Error('invalid') } }))
  assert.equal((await R.head('site')).published.id, before, 'a failed validation publishes nothing')
  await R.publish('site', { actor, validate: () => {} })
  const head = await R.head('site')
  assert.equal(head.published.id, head.draft.id)
})

test('restoring copies an old revision forward as the new draft', async () => {
  const first = (await R.history('site', 100)).at(-1)
  const restored = await R.restore('site', first.id, actor, (await R.head('site')).draft.id)
  assert.equal((await R.readRevision(restored.id)).content, doc(0))
  assert.equal((await R.history('site', 100)).length >= 4, true, 'nothing is overwritten')
})

test('pruning keeps the heads, the first revision, the recent drafts and publications', async () => {
  for (let i = 0; i < config.keepDraftRevisions + 15; i++) await R.saveDraft('site', { base: (await R.head('site')).draft.id, content: doc(100 + i), schemaVersion: 1, actor })
  for (let i = 0; i < config.keepPublishedRevisions + 5; i++) {
    await R.saveDraft('site', { base: (await R.head('site')).draft.id, content: doc(500 + i), schemaVersion: 1, actor })
    await R.publish('site', { actor, validate: () => {} })
  }
  const firstId = (await R.history('site', 1000)).at(-1).id
  const removed = await R.prune('site')
  assert.ok(removed > 0)
  const left = await R.history('site', 1000)
  const head = await R.head('site')
  assert.ok(left.some((r) => r.id === firstId), 'the first revision survives')
  assert.ok(left.some((r) => r.id === head.draft.id) && left.some((r) => r.id === head.published.id))
  assert.ok(left.filter((r) => r.publishedAt == null).length <= config.keepDraftRevisions + 1)
  assert.ok(left.filter((r) => r.publishedAt != null).length <= config.keepPublishedRevisions + 2)
})
