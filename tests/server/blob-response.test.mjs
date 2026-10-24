import { test } from 'node:test'
import assert from 'node:assert/strict'
import { load } from '../setup.mjs'

/* serveWorldBlob(): streaming a published world file, the "is it published?" check running at the same time as
   the object is opened, and the data-centre cache. Everything environment-specific is a fake here. */

const B = await load('src/server/blob-response.ts')
const sha = 'a'.repeat(64)
const request = new Request(`https://site.test/api/world/blob/${sha}?utm=1`)
const GZ = [0x1f, 0x8b]

const streamOf = (chunks, { hold = false, onCancel } = {}) =>
  new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(Uint8Array.from(c))
      if (!hold) controller.close()
    },
    cancel: () => onCancel?.(),
  })
const bytes = async (res) => new Uint8Array(await res.arrayBuffer())

/** A stream the test feeds by hand, to watch what reaches the visitor while the store is still sending. */
function manual() {
  let controller
  const stream = new ReadableStream({ start: (c) => (controller = c) })
  return { stream, push: (c) => controller.enqueue(Uint8Array.from(c)), end: () => controller.close(), fail: (e) => controller.error(e) }
}

function fakeEdge(initial) {
  const store = new Map(initial)
  return {
    store,
    calls: { match: 0, put: 0 },
    async match(key) {
      this.calls.match++
      return store.get(key.url)?.clone()
    },
    async put(key, response) {
      this.calls.put++
      const body = await response.arrayBuffer() // rejects if the body stream fails, like the real cache
      store.set(key.url, new Response(body, { headers: response.headers }))
    },
  }
}

function make(overrides = {}) {
  const pending = []
  const log = []
  const deps = {
    isPublished: async () => (log.push('isPublished'), true),
    open: async () => (log.push('open'), { body: streamOf([[...GZ, 1, 2, 3]]), size: 5 }),
    edge: null,
    waitUntil: (p) => pending.push(p),
    ...overrides,
  }
  return { deps, log, settled: () => Promise.all(pending) }
}

test('a name that is not a SHA-256 is 404 and touches nothing', async () => {
  const { deps, log } = make()
  for (const bad of ['nothex', 'A'.repeat(64), 'a'.repeat(63), '../etc/passwd']) assert.equal((await B.serveWorldBlob(request, bad, deps)).status, 404)
  assert.deepEqual(log, [])
})

test('a published gzip file is sent with the headers the player relies on', async () => {
  const { deps } = make()
  const res = await B.serveWorldBlob(request, sha, deps)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'application/gzip')
  assert.equal(res.headers.get('content-length'), '5')
  assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.equal(res.headers.get('etag'), `"${sha}"`)
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  assert.deepEqual([...(await bytes(res))], [...GZ, 1, 2, 3])
})

test('anything that does not start with the gzip magic is application/json', async () => {
  const body = Buffer.from('{"schema":1}')
  const { deps } = make({ open: async () => ({ body: streamOf([[...body]]), size: body.length }) })
  const res = await B.serveWorldBlob(request, sha, deps)
  assert.equal(res.headers.get('content-type'), 'application/json')
  assert.equal(await res.text(), '{"schema":1}')
})

test('a file the store did not announce a length for is sent chunked, without content-length', async () => {
  const { deps } = make({ open: async () => ({ body: streamOf([[...GZ, 9]]) }) })
  const res = await B.serveWorldBlob(request, sha, deps)
  assert.equal(res.headers.get('content-length'), null)
  assert.equal((await bytes(res)).length, 3)
})

test('the first bytes reach the visitor while the store is still sending the rest', async () => {
  const source = manual()
  const { deps } = make({ open: async () => ({ body: source.stream, size: 7 }) })
  const pending = B.serveWorldBlob(request, sha, deps)
  source.push([...GZ, 1])
  const res = await pending // the response exists before the store has sent everything
  const reader = res.body.getReader()
  const first = await reader.read()
  assert.deepEqual([...first.value], [...GZ, 1])
  source.push([2, 3, 4, 5])
  assert.deepEqual([...(await reader.read()).value], [2, 3, 4, 5])
  source.end()
  assert.equal((await reader.read()).done, true)
})

test('a name that is not published is 404, the opened object is cancelled and nothing is cached', async () => {
  let cancelled = false
  const edge = fakeEdge()
  const { deps, settled } = make({
    isPublished: async () => false,
    open: async () => ({ body: streamOf([[...GZ, 1]], { hold: true, onCancel: () => (cancelled = true) }), size: 3 }),
    edge,
  })
  const res = await B.serveWorldBlob(request, sha, deps)
  assert.equal(res.status, 404)
  await settled()
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(cancelled, true)
  assert.equal(edge.calls.put, 0)
})

test('a published name the store does not have is 404', async () => {
  const { deps } = make({ open: async () => null })
  assert.equal((await B.serveWorldBlob(request, sha, deps)).status, 404)
})

test('the object is opened while the database is still being asked, not after', async () => {
  const order = []
  let answer
  const { deps } = make({
    isPublished: () => new Promise((resolve) => { order.push('asked'); answer = resolve }),
    open: async () => (order.push('opened'), { body: streamOf([[...GZ]]), size: 2 }),
  })
  const pending = B.serveWorldBlob(request, sha, deps)
  await new Promise((r) => setTimeout(r, 10))
  assert.ok(order.includes('asked') && order.includes('opened'), 'both started before the answer arrived')
  answer(true)
  assert.equal((await pending).status, 200)
})

test('when the published check fails, the error is raised and the object is released', async () => {
  let cancelled = false
  const { deps } = make({
    isPublished: async () => { throw new Error('database down') },
    open: async () => ({ body: streamOf([[1, 2]], { hold: true, onCancel: () => (cancelled = true) }), size: 2 }),
  })
  await assert.rejects(B.serveWorldBlob(request, sha, deps), /database down/)
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(cancelled, true)
})

test('a failing open does not become an unhandled rejection when the check says no', async () => {
  const { deps } = make({ isPublished: async () => false, open: async () => { throw new Error('storage down') } })
  assert.equal((await B.serveWorldBlob(request, sha, deps)).status, 404)
  await new Promise((r) => setTimeout(r, 10))
})

/* ---- the data-centre cache ---- */

const keyUrl = `https://site.test/api/world/blob/${sha}`

test('a miss is sent and also stored for a day, once the response has gone out', async () => {
  const edge = fakeEdge()
  const { deps, settled } = make({ edge })
  const res = await B.serveWorldBlob(request, sha, deps)
  assert.deepEqual([...(await bytes(res))], [...GZ, 1, 2, 3])
  await settled()
  assert.equal(edge.calls.put, 1)
  const copy = edge.store.get(keyUrl)
  assert.ok(copy, 'keyed by the blob URL without its query string')
  assert.equal(copy.headers.get('cache-control'), `public, max-age=${B.EDGE_TTL_SECONDS}`)
  assert.equal(copy.headers.get('content-type'), 'application/gzip')
  assert.equal(copy.headers.get('content-length'), '5')
  assert.deepEqual([...(await bytes(copy))], [...GZ, 1, 2, 3])
})

test('a hit is served without asking the database or the store, with the same headers as a miss', async () => {
  const edge = fakeEdge([[keyUrl, new Response(Uint8Array.from([...GZ, 7]), { headers: { 'content-type': 'application/gzip', 'content-length': '3', 'cache-control': 'public, max-age=86400' } })]])
  const { deps, log, settled } = make({ edge })
  const res = await B.serveWorldBlob(request, sha, deps)
  await settled()
  assert.deepEqual(log, [], 'no isPublished, no open')
  assert.equal(edge.calls.put, 0)
  assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable', 'the visitor still gets the immutable header')
  assert.equal(res.headers.get('etag'), `"${sha}"`)
  assert.equal(res.headers.get('content-type'), 'application/gzip')
  assert.equal(res.headers.get('content-length'), '3')
  assert.deepEqual([...(await bytes(res))], [...GZ, 7])
})

test('a cache that throws on lookup is ignored', async () => {
  const edge = { match: async () => { throw new Error('cache offline') }, put: async () => {} }
  const { deps } = make({ edge })
  assert.equal((await B.serveWorldBlob(request, sha, deps)).status, 200)
})

test('a file of unknown length is never cached', async () => {
  const edge = fakeEdge()
  const { deps, settled } = make({ edge, open: async () => ({ body: streamOf([[...GZ, 9]]) }) })
  await bytes(await B.serveWorldBlob(request, sha, deps))
  await settled()
  assert.equal(edge.calls.put, 0)
})

test('a truncated download is delivered as far as it went but never cached', async () => {
  const edge = fakeEdge()
  const { deps, settled } = make({ edge, open: async () => ({ body: streamOf([[...GZ, 1]]), size: 10 }) })
  await bytes(await B.serveWorldBlob(request, sha, deps))
  await settled()
  assert.equal(edge.calls.put, 1)
  assert.equal(edge.store.size, 0, 'a copy 3 bytes long for a 10 byte file would poison every visitor of the data centre')
})

test('a download that dies half way is never cached either', async () => {
  const edge = fakeEdge()
  const source = manual()
  const { deps, settled } = make({ edge, open: async () => ({ body: source.stream, size: 6 }) })
  const pending = B.serveWorldBlob(request, sha, deps)
  source.push([...GZ, 1])
  const res = await pending
  const reading = bytes(res).catch(() => 'visitor saw the failure')
  source.push([2])
  source.fail(new Error('connection lost'))
  assert.equal(await reading, 'visitor saw the failure')
  await settled()
  assert.equal(edge.store.size, 0)
})

test('a cache that refuses the write does not break the response', async () => {
  const edge = { match: async () => undefined, put: async () => { throw new Error('quota') } }
  const { deps, settled } = make({ edge })
  const res = await B.serveWorldBlob(request, sha, deps)
  assert.deepEqual([...(await bytes(res))], [...GZ, 1, 2, 3])
  await settled()
})

test('HEAD gets the headers only: the object is released, nothing is read or cached', async () => {
  let cancelled = false
  const edge = fakeEdge()
  const head = new Request(request.url, { method: 'HEAD' })
  const { deps, settled } = make({
    edge,
    open: async () => ({ body: streamOf([[...GZ, 1, 2, 3]], { hold: true, onCancel: () => (cancelled = true) }), size: 5 }),
  })
  const res = await B.serveWorldBlob(head, sha, deps)
  await settled()
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-length'), '5')
  assert.equal(res.headers.get('content-type'), 'application/gzip')
  assert.equal(res.body, null)
  assert.equal(cancelled, true)
  assert.equal(edge.calls.put, 0)
})

test('HEAD on a cached copy does not stream it either', async () => {
  let cancelled = false
  const body = new ReadableStream({ start: (c) => c.enqueue(Uint8Array.of(1)), cancel: () => (cancelled = true) })
  const edge = fakeEdge()
  edge.match = async () => new Response(body, { headers: { 'content-type': 'application/gzip', 'content-length': '3' } })
  const { deps } = make({ edge })
  const res = await B.serveWorldBlob(new Request(request.url, { method: 'HEAD' }), sha, deps)
  assert.equal(res.headers.get('content-length'), '3')
  assert.equal(res.body, null)
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(cancelled, true)
})

/* ---- the pieces ---- */

test('peekGzip keeps every byte whatever the chunking, and reports the gzip magic', async () => {
  for (const chunks of [[[0x1f], [0x8b, 5, 6]], [[0x1f, 0x8b, 5, 6]], [[0x1f], [0x8b], [5], [6]]]) {
    const { gzip, body } = await B.peekGzip(streamOf(chunks))
    assert.equal(gzip, true)
    assert.deepEqual([...(await bytes(new Response(body)))], [0x1f, 0x8b, 5, 6])
  }
  const plain = await B.peekGzip(streamOf([[0x7b], [0x7d]]))
  assert.equal(plain.gzip, false)
  assert.equal(await new Response(plain.body).text(), '{}')
  const one = await B.peekGzip(streamOf([[0x1f]]))
  assert.equal(one.gzip, false)
  assert.equal((await bytes(new Response(one.body))).length, 1)
  const empty = await B.peekGzip(streamOf([]))
  assert.equal(empty.gzip, false)
  assert.equal((await bytes(new Response(empty.body))).length, 0)
})

test('peekGzip passes a cancel on to the source', async () => {
  let cancelled = false
  const { body } = await B.peekGzip(streamOf([[0x1f, 0x8b, 1]], { hold: true, onCancel: () => (cancelled = true) }))
  await body.cancel('done')
  assert.equal(cancelled, true)
})

test('exactly() fails the stream unless the byte count matches', async () => {
  const run = (chunks, size) => new Response(streamOf(chunks).pipeThrough(B.exactly(size))).arrayBuffer()
  assert.equal((await run([[1, 2], [3]], 3)).byteLength, 3)
  await assert.rejects(run([[1, 2]], 3), /ended after 2 of its announced 3/)
  await assert.rejects(run([[1, 2], [3, 4]], 3), /longer than its announced 3/)
})

test('edgeKey drops the query string and keeps the site the request came to', () => {
  assert.equal(B.edgeKey(new Request(`https://example.org/api/world/blob/${sha}?v=2#x`), sha).url, `https://example.org/api/world/blob/${sha}`)
})
