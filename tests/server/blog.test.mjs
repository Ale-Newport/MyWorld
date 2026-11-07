import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import zlib from 'node:zlib'
import { freshDataDir, load, root } from '../setup.mjs'

/* The blog in the database (server/blog.ts), on a fresh SQLite store:
   each change a new revision, published at once; visitors read only the
   published posts; a stale change to the same post is refused, one to
   another post goes through; pictures in the media library, served only
   as images; the old-content cleanup leaves the blog alone. */

freshDataDir('blog')
const B = await load('src/server/blog.ts')
const R = await load('src/server/revisions.ts')
const M = await load('src/server/media.ts')
const L = await load('src/server/legacy.ts')
const { config } = await load('src/server/config.ts')
const { migrateSiteDocument } = await load('src/cms/migrate.ts')
const S = await load('src/cms/schema.ts')
const actor = { id: null, name: 'Test' }

const post = (id, extra = {}) => ({ id, slug: id, title: `Post ${id}`, excerpt: 'An excerpt.', body: '## Hello\n\nA body.', date: '2026-11-07', tags: ['notes'], status: 'draft', ...extra })
const save = (p, original, base, force) => B.commitChange({ type: 'save', post: p, original }, { base, force, actor })
const text = async (stream) => Buffer.from(await new Response(stream).arrayBuffer())

test('an empty blog: nothing for visitors, nothing for the admin, and no document until the first post', async () => {
  assert.deepEqual(await B.publishedPosts(), [])
  assert.deepEqual(await B.blogState(), { revision: null, posts: [] })
  assert.equal(await R.exists('blog'), false)
})

test('a draft is saved as a new published revision of the blog, and visitors never see it', async () => {
  const state = await save(post('first'), null, null)
  assert.ok(state.revision)
  assert.deepEqual(state.posts.map((p) => p.id), ['first'])
  const head = await R.head('blog')
  assert.equal(head.published.id, state.revision, 'every change is published at once')
  assert.equal(head.draft.id, state.revision)
  assert.equal(head.published.message, 'Blog post “Post first” saved as a draft')
  assert.deepEqual(await B.publishedPosts(), [], 'a draft never reaches a visitor')
  assert.deepEqual((await B.blogState()).posts.map((p) => p.status), ['draft'], 'the admin reads every post')
})

test('publishing, editing, unpublishing and deleting: each one revision, read back at once', async () => {
  let state = await B.blogState()
  const draft = state.posts[0]
  state = await save({ ...draft, status: 'published' }, draft, state.revision)
  assert.deepEqual((await B.publishedPosts()).map((p) => p.id), ['first'])
  const live = state.posts[0]
  state = await save({ ...live, title: 'Edited' }, live, state.revision)
  assert.equal((await B.publishedPosts())[0].title, 'Edited')
  const edited = state.posts[0]
  state = await save({ ...edited, status: 'draft' }, edited, state.revision)
  assert.deepEqual(await B.publishedPosts(), [], 'unpublished: gone for visitors')
  const messages = (await R.history('blog', 10)).map((r) => r.message)
  assert.deepEqual(messages.slice(0, 3), ['Blog post “Edited” unpublished', 'Blog post “Edited” updated', 'Blog post “Post first” published'])
  state = await B.commitChange({ type: 'delete', id: 'first', original: state.posts[0] }, { base: state.revision, actor })
  assert.deepEqual(state.posts, [])
  assert.equal((await R.history('blog', 1))[0].message, 'Blog post “Edited” deleted')
  await assert.rejects(B.commitChange({ type: 'delete', id: 'first', original: null }, { base: state.revision, actor }), /already gone/)
})

test('a stale base: refused when THAT post changed meanwhile (unless overwritten on purpose), let through when another one did', async () => {
  const first = await save(post('a', { status: 'published' }), null, (await B.blogState()).revision)
  await save(post('b'), null, first.revision)
  const opened = await B.blogState()
  const a = opened.posts.find((p) => p.id === 'a')
  const b = opened.posts.find((p) => p.id === 'b')
  // Another tab changes A.
  await save({ ...a, title: 'A from the other tab' }, a, opened.revision)
  // This tab, still on the old revision: B goes through, and A's change from the other tab is kept.
  const afterB = await save({ ...b, title: 'B from this tab' }, b, opened.revision)
  assert.deepEqual(afterB.posts.map((p) => p.title), ['A from the other tab', 'B from this tab'])
  // A itself, from the old revision: refused…
  await assert.rejects(save({ ...a, title: 'A from this tab' }, a, opened.revision), (e) => e.name === 'ConflictError' && /changed in another tab/.test(e.message))
  assert.equal((await B.blogState()).posts[0].title, 'A from the other tab', 'nothing was written')
  // …and written only when the admin says so.
  const forced = await save({ ...a, title: 'A from this tab' }, a, opened.revision, true)
  assert.equal(forced.posts[0].title, 'A from this tab')
  // A new post whose id was just taken elsewhere is refused too.
  await assert.rejects(save(post('a'), null, opened.revision), (e) => e.name === 'ConflictError')
})

test('every post is checked with the schema, ids and addresses unique, and an empty save is refused', async () => {
  const state = await B.blogState()
  const count = (await R.history('blog', 1000)).length
  const bad = [
    [post('dup', { slug: 'a' }), /share the address \/blog\/a/],
    [post('evil', { cover: 'javascript:alert(1)' }), /cover/],
    [post('evil2', { cover: 'http://insecure.example/x.png' }), /cover/],
    [post('dated', { date: '7 Nov' }), /date/],
    [post('Bad Id', { slug: 'bad-id' }), /id/],
    [post('long', { excerpt: 'x'.repeat(321) }), /excerpt/],
  ]
  for (const [p, message] of bad) await assert.rejects(save(p, null, state.revision), (e) => e.name === 'ValidationError' && message.test(e.message), p.id)
  const a = state.posts.find((p) => p.id === 'a')
  await assert.rejects(save(a, a, state.revision), /Nothing to save/)
  assert.equal((await R.history('blog', 1000)).length, count, 'nothing refused was written')
  assert.throws(() => B.validatePosts([post('x'), post('x', { slug: 'y' })]), /share the id/)
})

test('old versions are pruned as the blog changes: the heads, recent publications and the first revision stay', async () => {
  let state = await B.blogState()
  for (let i = 0; i < config.keepPublishedRevisions + 10; i++) {
    const a = state.posts.find((p) => p.id === 'a')
    state = await save({ ...a, excerpt: `Version ${i}` }, a, state.revision)
  }
  const history = await R.history('blog', 1000)
  assert.ok(history.length <= config.keepPublishedRevisions + 2, `${history.length} revisions kept`)
  assert.equal(history[0].id, state.revision)
  assert.equal(history.at(-1).message, 'The blog starts empty', 'the first revision is never pruned')
})

function png(w, h) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1 } return ~c >>> 0 }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.alloc((w * 3 + 1) * h))), chunk('IEND', Buffer.alloc(0))])
}

test('pictures: only real images, at most 5 MB, into the media library, served by id and own name', async () => {
  const bytes = png(12, 8)
  const { item, url } = await B.saveBlogImage(new Uint8Array(bytes), 'Holiday Photo.png', actor)
  assert.equal(url, `/blog-media/${item.id}/${item.filename}`)
  assert.match(url, /^\/blog-media\/[a-z0-9]{20}\/Holiday-Photo\.png$/)
  assert.ok(S.safeSrc.safeParse(url).success, 'a post may use the address')
  const served = await B.blogImage(item.id, item.filename)
  assert.equal(served.item.mime, 'image/png')
  assert.deepEqual(await text(served.body), bytes)
  assert.equal(await B.blogImage(item.id, 'other-name.png'), null, 'only under its own name')
  assert.equal(await B.blogImage('aaaaaaaaaaaaaaaaaaaa', 'x.png'), null)
  // Something the library holds that is not a picture for a post (an SVG is an "icon") is never served here.
  const svg = await M.saveUpload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4"/></svg>'), 'mark.svg', actor)
  assert.equal(await B.blogImage(svg.id, svg.filename), null)
  for (const [data, message] of [
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), /Only PNG, JPEG, WebP, GIF or AVIF/],
    [Buffer.from('MZ not a picture'), /Only PNG/],
    [Buffer.alloc(0), /empty/],
    [Buffer.concat([png(1, 1), Buffer.alloc(B.MAX_IMAGE_BYTES)]), /at most 5 MB/],
  ]) await assert.rejects(B.saveBlogImage(new Uint8Array(data), 'x.png', actor), message)
})

test('the old-content cleanup removes the old store but never the blog or the pictures it uses', async () => {
  // A post using one picture; another picture nobody uses; an old site revision; an old world blob.
  const used = await B.saveBlogImage(new Uint8Array(png(3, 3)), 'used.png', actor)
  const unused = await M.saveUpload(png(5, 5), 'unused.png', actor)
  let state = await B.blogState()
  state = await save(post('pictured', { status: 'published', cover: used.url, body: `![x](${used.url})` }), null, state.revision)
  await R.seed('site', 'site', { content: '{"old":true}', schemaVersion: 2, message: 'old', actor })
  const stats = await L.legacyStats()
  assert.equal(stats.documents, 1, 'the blog is not counted as old content')
  await L.clearLegacy(actor)
  assert.equal(await R.exists('site'), false, 'the old site revisions are gone')
  assert.equal(await M.getMedia(unused.id), null, 'an unused picture is gone')
  assert.ok(await M.getMedia(used.item.id), 'the picture a post uses is kept')
  assert.ok(await B.blogImage(used.item.id, used.item.filename), 'and still served')
  assert.equal((await B.blogState()).revision, state.revision, 'the blog is untouched')
  assert.ok((await B.publishedPosts()).some((p) => p.id === 'pictured' && p.cover === used.url), 'and its post is still on /blog')
  const after = await L.legacyStats()
  assert.equal(after.documents + after.revisions + after.media, 0, 'nothing old is left to offer for removal')
})

test('the site document no longer carries posts: an old file with them still parses, without them', () => {
  const committed = JSON.parse(fs.readFileSync(`${root}/content/published/site.json`, 'utf8'))
  assert.equal('posts' in committed, false)
  const migrated = migrateSiteDocument({ ...committed, posts: [post('old')] })
  assert.equal('posts' in migrated, false)
  assert.ok(S.siteDocument.safeParse(migrated).success)
  assert.equal('posts' in S.siteDocument.shape, false)
})
