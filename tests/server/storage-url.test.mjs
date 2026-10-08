import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDataDir, load } from '../setup.mjs'

freshDataDir('storage-url')
const storage = await load('src/server/storage.ts')

test('Storage requests use the Storage API even when SUPABASE_URL is a Data API URL', async () => {
  const oldUrl = process.env.SUPABASE_URL
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const oldFetch = globalThis.fetch
  const called = []
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'
  globalThis.fetch = async (url) => {
    called.push(String(url))
    return Response.json([])
  }
  try {
    for (const suffix of ['', '/', '/rest/v1', '/rest/v1/', '/storage/v1']) {
      process.env.SUPABASE_URL = `https://example.supabase.co${suffix}`
      await storage.listObjects('blobs')
    }
    assert.deepEqual(called, Array(5).fill('https://example.supabase.co/storage/v1/object/list/cms'))
  } finally {
    globalThis.fetch = oldFetch
    if (oldUrl === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = oldUrl
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey
  }
})
