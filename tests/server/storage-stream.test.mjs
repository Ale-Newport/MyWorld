import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDataDir, load } from '../setup.mjs'

/* getObjectStream(): the same object getObject() returns, handed on as a stream so a 17 MB world file is not
   held in memory before its first byte is sent. */

freshDataDir('storage-stream')
const storage = await load('src/server/storage.ts')
const key = `blobs/${'c'.repeat(64)}`

async function withSupabase(fetchImpl, run) {
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY, bucket: process.env.SUPABASE_STORAGE_BUCKET, fetch: globalThis.fetch }
  process.env.SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'
  delete process.env.SUPABASE_STORAGE_BUCKET
  globalThis.fetch = fetchImpl
  try {
    return await run()
  } finally {
    globalThis.fetch = saved.fetch
    for (const [name, value] of [['SUPABASE_URL', saved.url], ['SUPABASE_SERVICE_ROLE_KEY', saved.key], ['SUPABASE_STORAGE_BUCKET', saved.bucket]]) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

test('announcedSize trusts content-length only when it describes the bytes that will be forwarded', () => {
  const of = (headers) => storage.announcedSize({ headers: new Headers(headers) })
  assert.equal(of({ 'content-length': '17168242' }), 17168242)
  assert.equal(of({ 'content-length': '0' }), 0)
  assert.equal(of({}), undefined)
  assert.equal(of({ 'content-length': 'abc' }), undefined)
  assert.equal(of({ 'content-length': '-5' }), undefined)
  assert.equal(of({ 'content-length': '12', 'content-encoding': 'gzip' }), undefined, 'the length of an encoded transfer is not the length of the decoded body')
})

test('from the local store: same bytes as getObject, with the exact size, read as a stream', async () => {
  const payload = Buffer.alloc(300_000, 'xyz')
  await storage.putObject(key, payload)
  const found = await storage.getObjectStream(key)
  assert.equal(found.size, payload.length)
  let chunks = 0
  const parts = []
  for await (const chunk of found.body) { chunks++; parts.push(Buffer.from(chunk)) }
  assert.ok(chunks > 1, 'delivered in pieces, not as one buffer')
  assert.deepEqual(Buffer.concat(parts), await storage.getObject(key))
})

test('a missing object is null and a bad key is refused', async () => {
  assert.equal(await storage.getObjectStream(`blobs/${'d'.repeat(64)}`), null)
  await assert.rejects(storage.getObjectStream('../../etc/passwd'), /Invalid object key/)
})

test('from Supabase: asks for the stored bytes, hands the body on unread, and reports the announced size', async () => {
  const seen = []
  let pulls = 0
  const body = new ReadableStream({ pull(c) { pulls++; c.enqueue(Uint8Array.from([1, 2, 3])); c.close() } }, { highWaterMark: 0 })
  await withSupabase(async (url, init) => {
    seen.push({ url: String(url), headers: new Headers(init.headers) })
    return new Response(body, { headers: { 'content-length': '3', 'content-type': 'application/octet-stream' } })
  }, async () => {
    const found = await storage.getObjectStream(key)
    assert.equal(found.size, 3)
    assert.equal(pulls, 0, 'the body has not been read: nothing was buffered')
    assert.deepEqual([...Buffer.from(await new Response(found.body).arrayBuffer())], [1, 2, 3])
  })
  assert.equal(seen[0].url, `https://example.supabase.co/storage/v1/object/authenticated/cms/${key}`)
  assert.equal(seen[0].headers.get('accept-encoding'), 'identity')
  assert.equal(seen[0].headers.get('authorization'), 'Bearer test-service-key')
  assert.equal(seen[0].headers.get('apikey'), 'test-service-key')
})

test('from Supabase: an encoded response has no trusted size, 404 and 400 are "not there", other errors throw', async () => {
  await withSupabase(async () => new Response(Uint8Array.from([1]), { headers: { 'content-length': '999', 'content-encoding': 'br' } }), async () => {
    assert.equal((await storage.getObjectStream(key)).size, undefined)
  })
  for (const status of [404, 400]) {
    await withSupabase(async () => new Response('{"error":"not_found"}', { status }), async () => {
      assert.equal(await storage.getObjectStream(key), null)
    })
  }
  await withSupabase(async () => new Response('boom', { status: 500 }), async () => {
    await assert.rejects(storage.getObjectStream(key), /Storage download failed \(500\)/)
  })
})
