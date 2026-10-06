import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDataDir, load } from '../setup.mjs'

freshDataDir('analytics')
const A = await load('src/server/analytics.ts')
const { db } = await load('src/server/db.ts')
const visitor = { ip: '203.0.113.7', ua: 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140.0 Safari/537.36', host: 'example.com', gpc: false, dnt: false, admin: false }
const batch = (events, extra = {}) => ({ events, referrer: 'https://news.example.org/some/path?utm=1', width: 1440, ...extra })

test('administrators, Do Not Track, Global Privacy Control and bots are never recorded', async () => {
  const e = [{ type: 'pageview', path: '/' }]
  assert.equal(await A.recordBatch(batch(e), { ...visitor, admin: true }), 0)
  assert.equal(await A.recordBatch(batch(e), { ...visitor, dnt: true }), 0)
  assert.equal(await A.recordBatch(batch(e), { ...visitor, gpc: true }), 0)
  assert.equal(await A.recordBatch(batch(e), { ...visitor, ua: 'Mozilla/5.0 HeadlessChrome/140' }), 0)
  assert.equal(await A.recordBatch(batch(e), { ...visitor, ua: 'Googlebot/2.1' }), 0)
  assert.equal(Number((await (await db()).get('select count(*) n from events')).n), 0)
})

test('only named events, cleaned: no IP, no query strings, referrer host only, no admin paths', async () => {
  const n = await A.recordBatch(batch([
    { type: 'pageview', path: '/projects?ref=abc' },
    { type: 'made_up', path: '/' },
    { type: 'pageview', path: '/admin/pages' },
    { type: 'project_open', path: '/', props: { slug: 'focus', 'bad key!': 1, from: 'overlay' } },
  ]), visitor)
  assert.equal(n, 2)
  const rows = await (await db()).all('select * from events order by id')
  assert.equal(rows[0].path, '/projects')
  assert.equal(rows[0].referrer, 'news.example.org')
  assert.equal(rows[1].props, JSON.stringify({ slug: 'focus', from: 'overlay' }))
  assert.ok(rows.every((r) => !JSON.stringify(r).includes('203.0.113.7')), 'the address is not stored')
  assert.match(rows[0].visitor, /^[0-9a-f]{16}$/)
})

test('the report says what was recorded', async () => {
  const today = new Date().toISOString().slice(0, 10)
  const r = await A.report({ from: today, to: today })
  assert.equal(r.pages[0].path, '/projects')
  assert.equal(r.projects[0].slug, 'focus')
  assert.equal(r.total, 2)
})
