import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDataDir, load } from '../setup.mjs'

freshDataDir('revisions')
const R = await load('src/server/revisions.ts')
const { config } = await load('src/server/config.ts')
const actor = { id: null, name: 'Test' }
const doc = (n) => JSON.stringify({ n })

test('a document starts with its seed revision, published', () => {
  const head = R.seed('site', 'site', { content: doc(0), schemaVersion: 1, message: 'seed', actor })
  assert.ok(head.draft && head.published && head.draft.id === head.published.id)
})

test('saving on top of a stale base is a conflict; force overwrites it', () => {
  const base = R.head('site').draft.id
  const a = R.saveDraft('site', { base, content: doc(1), schemaVersion: 1, actor })
  assert.throws(() => R.saveDraft('site', { base, content: doc(2), schemaVersion: 1, actor }), (e) => e.name === 'ConflictError' && e.head.draft.id === a.id)
  const forced = R.saveDraft('site', { base, content: doc(2), schemaVersion: 1, actor, force: true })
  assert.equal(R.head('site').draft.id, forced.id)
})

test('publishing moves the live pointer only after validation passes', async () => {
  const before = R.head('site').published.id
  await assert.rejects(R.publish('site', { actor, validate: () => { throw new Error('invalid') } }))
  assert.equal(R.head('site').published.id, before, 'a failed validation publishes nothing')
  await R.publish('site', { actor, validate: () => {} })
  assert.equal(R.head('site').published.id, R.head('site').draft.id)
})

test('restoring copies an old revision forward as the new draft', () => {
  const first = R.history('site', 100).at(-1)
  const restored = R.restore('site', first.id, actor, R.head('site').draft.id)
  assert.equal(R.readRevision(restored.id).content, doc(0))
  assert.equal(R.history('site', 100).length >= 4, true, 'nothing is overwritten')
})

test('pruning keeps the heads, the first revision, the recent drafts and publications', async () => {
  for (let i = 0; i < config.keepDraftRevisions + 15; i++) R.saveDraft('site', { base: R.head('site').draft.id, content: doc(100 + i), schemaVersion: 1, actor })
  for (let i = 0; i < config.keepPublishedRevisions + 5; i++) {
    R.saveDraft('site', { base: R.head('site').draft.id, content: doc(500 + i), schemaVersion: 1, actor })
    await R.publish('site', { actor, validate: () => {} })
  }
  const firstId = R.history('site', 1000).at(-1).id
  const removed = R.prune('site')
  assert.ok(removed > 0)
  const left = R.history('site', 1000)
  assert.ok(left.some((r) => r.id === firstId), 'the first revision survives')
  assert.ok(left.some((r) => r.id === R.head('site').draft.id) && left.some((r) => r.id === R.head('site').published.id))
  assert.ok(left.filter((r) => r.publishedAt == null).length <= config.keepDraftRevisions + 1)
  assert.ok(left.filter((r) => r.publishedAt != null).length <= config.keepPublishedRevisions + 2)
})
