import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import zlib from 'node:zlib'
import { load, root } from '../setup.mjs'

const B = await load('src/server/blog-publish.ts')

/* ============================================================
   A STAND-IN FOR GITHUB'S CONTENTS API

   Files by path, each with a sha that changes on every write; a PUT
   with a stale sha is refused with 409 (as GitHub does), creating a
   file that exists without its sha with 422. `beforePut` lets a test
   commit something "from elsewhere" between the admin's read and its
   write. Files over `inlineLimit` bytes come back without their
   content, as GitHub does over 1 MB, and are read through the blob API.
   ============================================================ */
function fakeGitHub(initial = {}, { inlineLimit = 1024 * 1024 } = {}) {
  const files = new Map()
  let n = 0
  const sha = () => `sha${++n}`
  for (const [path, text] of Object.entries(initial)) files.set(path, { bytes: Buffer.from(text), sha: sha() })
  const commits = []
  const calls = []
  const state = { beforePut: null }
  const fetch = async (url, init = {}) => {
    const u = new URL(url)
    const method = init.method ?? 'GET'
    calls.push(`${method} ${u.pathname}`)
    assert.equal(init.headers.authorization, 'Bearer test-token', 'every call carries the token')
    const blob = /^\/repos\/owner\/site\/git\/blobs\/(.+)$/.exec(u.pathname)
    if (blob) {
      const f = [...files.values()].find((x) => x.sha === blob[1])
      return f ? Response.json({ sha: f.sha, content: f.bytes.toString('base64'), encoding: 'base64' }) : new Response('{}', { status: 404 })
    }
    const m = /^\/repos\/owner\/site\/contents\/(.+)$/.exec(u.pathname)
    if (!m) return new Response('{}', { status: 404 })
    const path = m[1].split('/').map(decodeURIComponent).join('/')
    if (method === 'GET') {
      assert.equal(u.searchParams.get('ref'), 'main')
      const f = files.get(path)
      if (!f) return Response.json({ message: 'Not Found' }, { status: 404 })
      if (init.headers.accept === 'application/vnd.github.raw+json') return new Response(f.bytes)
      const inline = f.bytes.length <= inlineLimit
      return Response.json({ sha: f.sha, encoding: inline ? 'base64' : 'none', content: inline ? f.bytes.toString('base64') : '' })
    }
    if (method === 'PUT') {
      const body = JSON.parse(init.body)
      if (state.beforePut) { const hook = state.beforePut; state.beforePut = null; hook(files, sha) }
      const f = files.get(path)
      if (f && body.sha !== f.sha) return Response.json({ message: `${path} does not match ${body.sha}` }, { status: 409 })
      if (f && !body.sha) return Response.json({ message: 'Invalid request. "sha" wasn\'t supplied.' }, { status: 422 })
      files.set(path, { bytes: Buffer.from(body.content, 'base64'), sha: sha() })
      commits.push({ path, message: body.message, branch: body.branch })
      return Response.json({ commit: { sha: `commit${commits.length}`, html_url: `https://github.com/owner/site/commit/${commits.length}` } }, { status: f ? 200 : 201 })
    }
    return new Response('{}', { status: 405 })
  }
  const target = { token: 'test-token', repo: 'owner/site', branch: 'main', api: 'https://github.test', fetch }
  const json = (path = B.SITE_FILE) => JSON.parse(files.get(path).bytes.toString('utf8'))
  return { target, files, commits, calls, state, json }
}

/* The committed site file, as the deployed admin would find it on GitHub. */
const committed = fs.readFileSync(`${root}/content/published/site.json`, 'utf8')
const siteText = () => B.serialise(B.validateDocument(JSON.parse(committed)))

const post = (id, extra = {}) => ({ id, slug: id, title: `Post ${id}`, excerpt: 'An excerpt.', body: '## Hello\n\nA body.', date: '2026-11-07', tags: ['notes'], status: 'published', ...extra })

test('a change is applied to the posts as they are now, and refused if the post moved on since it was opened', () => {
  const a = post('a'), b = post('b')
  assert.deepEqual(B.applyPostChange([a], { type: 'save', post: b, base: null }).map((p) => p.id), ['a', 'b'], 'a new post is added')
  const a2 = { ...a, title: 'A, edited' }
  assert.equal(B.applyPostChange([a, b], { type: 'save', post: a2, base: a })[0].title, 'A, edited', 'an edit replaces the post in place')
  assert.deepEqual(B.applyPostChange([a, b], { type: 'delete', id: 'a', base: a }).map((p) => p.id), ['b'])
  // The same post, its keys in another order, is the same post.
  assert.equal(B.applyPostChange([a], { type: 'save', post: a2, base: Object.fromEntries(Object.entries(a).reverse()) })[0].title, 'A, edited')
  const conflict = (fn) => assert.throws(fn, (e) => e.name === 'ConflictError')
  conflict(() => B.applyPostChange([{ ...a, title: 'changed elsewhere' }], { type: 'save', post: a2, base: a }))
  conflict(() => B.applyPostChange([a], { type: 'save', post: { ...a, title: 'x' }, base: null }))
  conflict(() => B.applyPostChange([], { type: 'delete', id: 'a', base: a }))
})

test('each commit says what happened to which post, and who did it', () => {
  const draft = post('a', { status: 'draft', title: 'Hello world' })
  const live = { ...draft, status: 'published' }
  assert.equal(B.describeChange({ type: 'save', post: draft, base: null }, 'Ale'), 'content: blog post “Hello world” saved as a draft from the admin by Ale')
  assert.equal(B.describeChange({ type: 'save', post: live, base: draft }, 'Ale'), 'content: blog post “Hello world” published from the admin by Ale')
  assert.equal(B.describeChange({ type: 'save', post: live, base: live }, 'Ale'), 'content: blog post “Hello world” updated from the admin by Ale')
  assert.equal(B.describeChange({ type: 'save', post: draft, base: live }, 'Ale'), 'content: blog post “Hello world” unpublished from the admin by Ale')
  assert.equal(B.describeChange({ type: 'delete', id: 'a', base: live }, 'Ale'), 'content: blog post “Hello world” deleted from the admin by Ale')
  assert.ok(!/co-authored/i.test(B.describeChange({ type: 'save', post: draft, base: null }, 'Ale')))
})

test('publishing commits the site file with only the posts changed', async () => {
  const gh = fakeGitHub({ [B.SITE_FILE]: siteText() })
  const before = gh.json()
  const result = await B.commitPostChange(gh.target, { type: 'save', post: post('first'), base: null }, 'Ale')
  assert.equal(result.commit, 'commit1')
  assert.deepEqual(gh.commits, [{ path: B.SITE_FILE, message: 'content: blog post “Post first” published from the admin by Ale', branch: 'main' }])
  const after = gh.json()
  assert.deepEqual(after.posts.map((p) => p.id), ['first'])
  const { posts: _a, ...restAfter } = after
  const { posts: _b, ...restBefore } = before
  assert.deepEqual(restAfter, restBefore, 'nothing but the posts changed')
  assert.ok(gh.files.get(B.SITE_FILE).bytes.toString('utf8').endsWith('}\n'), 'written as the editor writes it')
  // Unpublish, then delete: each a commit, each from a fresh read.
  await B.commitPostChange(gh.target, { type: 'save', post: post('first', { status: 'draft' }), base: post('first') }, 'Ale')
  assert.equal(gh.json().posts[0].status, 'draft')
  await B.commitPostChange(gh.target, { type: 'delete', id: 'first', base: post('first', { status: 'draft' }) }, 'Ale')
  assert.deepEqual(gh.json().posts, [])
  assert.deepEqual(gh.commits.map((c) => c.message.match(/” (.+) from/)[1]), ['published', 'unpublished', 'deleted'])
})

test('a commit made elsewhere between the read and the write is kept: the change is applied again to the fresh file', async () => {
  const gh = fakeGitHub({ [B.SITE_FILE]: siteText() })
  await B.commitPostChange(gh.target, { type: 'save', post: post('older'), base: null }, 'Ale')
  // Settings published from this admin (another tab) while the post was being sent.
  gh.state.beforePut = (files, sha) => {
    const doc = JSON.parse(files.get(B.SITE_FILE).bytes.toString('utf8'))
    doc.settings.title = 'Changed meanwhile'
    files.set(B.SITE_FILE, { bytes: Buffer.from(B.serialise(doc)), sha: sha() })
  }
  await B.commitPostChange(gh.target, { type: 'save', post: post('newer'), base: null }, 'Ale')
  const after = gh.json()
  assert.equal(after.settings.title, 'Changed meanwhile', 'the other commit is not lost')
  assert.deepEqual(after.posts.map((p) => p.id), ['older', 'newer'], 'and the post is there')
  assert.equal(gh.calls.filter((c) => c.startsWith('PUT')).length, 3, 'one refused write, retried once')
})

test('a file that keeps changing is given up on after one retry, with words for it', async () => {
  const gh = fakeGitHub({ [B.SITE_FILE]: siteText() })
  const bump = (files, sha) => { const f = files.get(B.SITE_FILE); files.set(B.SITE_FILE, { ...f, sha: sha() }) }
  const original = gh.target.fetch
  gh.target.fetch = async (url, init) => { if (init?.method === 'PUT') gh.state.beforePut = bump; return original(url, init) }
  await assert.rejects(B.commitPostChange(gh.target, { type: 'save', post: post('a'), base: null }, 'Ale'), (e) => e.name === 'ValidationError' && /kept changing/.test(e.message))
  assert.equal(gh.commits.length, 0)
})

test('the whole document is validated before anything is written: schema, references, and no empty commit', async () => {
  const gh = fakeGitHub({ [B.SITE_FILE]: siteText() })
  await B.commitPostChange(gh.target, { type: 'save', post: post('taken'), base: null }, 'Ale')
  const invalid = [
    [post('other', { slug: 'taken' }), /share the address/],
    [post('evil', { cover: 'javascript:alert(1)' }), /posts\.1\.cover/],
    [post('dated', { date: '7 Nov' }), /posts\.1\.date/],
    [post('Bad Slug', { slug: 'Bad Slug' }), /posts\.1/],
  ]
  for (const [p, message] of invalid) {
    await assert.rejects(B.commitPostChange(gh.target, { type: 'save', post: p, base: null }, 'Ale'), (e) => e.name === 'ValidationError' && message.test(e.message), p.id)
  }
  await assert.rejects(B.commitPostChange(gh.target, { type: 'save', post: post('taken'), base: post('taken') }, 'Ale'), /Nothing to publish/)
  assert.equal(gh.commits.length, 1, 'nothing invalid was committed')
})

test('a site file over GitHub’s inline limit is read through the blob API', async () => {
  const gh = fakeGitHub({ [B.SITE_FILE]: siteText() }, { inlineLimit: 1000 })
  await B.commitPostChange(gh.target, { type: 'save', post: post('big'), base: null }, 'Ale')
  assert.ok(gh.calls.some((c) => c.includes('/git/blobs/')))
  assert.deepEqual(gh.json().posts.map((p) => p.id), ['big'])
})

test('a refused token is said in words', async () => {
  const gh = fakeGitHub({ [B.SITE_FILE]: siteText() })
  gh.target.fetch = async () => new Response('Bad credentials', { status: 401 })
  await assert.rejects(B.readSite(gh.target), /GitHub refused the token/)
})

function png(w, h) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1 } return ~c >>> 0 }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.alloc((w * 3 + 1) * h))), chunk('IEND', Buffer.alloc(0))])
}

test('images: only what is really a picture, at most 5 MB, committed once under its content hash', async () => {
  const gh = fakeGitHub()
  const bytes = new Uint8Array(png(4, 3))
  const first = await B.commitImage(gh.target, bytes, 'Ale')
  assert.match(first.url, /^\/uploads\/blog\/[a-f0-9]{20}\.png$/)
  assert.match(first.name, B.UPLOAD_NAME)
  assert.equal(gh.commits.length, 1)
  assert.equal(gh.commits[0].path, `public/uploads/blog/${first.name}`)
  assert.equal(gh.commits[0].message, `content: blog image ${first.name} uploaded from the admin by Ale`)
  const again = await B.commitImage(gh.target, bytes, 'Ale')
  assert.deepEqual([again.url, again.commit, gh.commits.length], [first.url, null, 1], 'the same bytes are not committed twice')
  assert.deepEqual(Buffer.from(await B.readBytes(gh.target, `public/uploads/blog/${first.name}`)), Buffer.from(bytes), 'read back for the preview')
  assert.equal(await B.readBytes(gh.target, 'public/uploads/blog/0000000000000000000a.png'), null)

  const refused = [
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), /Only PNG, JPEG, WebP, GIF or AVIF/],
    [Buffer.from('MZ not a picture at all'), /Only PNG/],
    [Buffer.alloc(0), /empty/],
    [Buffer.concat([png(1, 1), Buffer.alloc(B.MAX_IMAGE_BYTES)]), /at most 5 MB/],
  ]
  for (const [data, message] of refused) await assert.rejects(B.commitImage(gh.target, new Uint8Array(data), 'Ale'), message)
  assert.equal(gh.commits.length, 1, 'nothing refused was committed')
  assert.equal(B.imageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])).ext, 'jpg')
  assert.equal(B.imageType(new Uint8Array(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).ext, 'webp')
  assert.equal(B.imageType(new Uint8Array(Buffer.from('GIF89a'))).ext, 'gif')
})
