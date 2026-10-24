import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { root } from '../setup.mjs'

/* The page warms the world's bytes only while the visitor is still on the way (the scroll approach, a hover or
   a focus: WorldPortal, WorldEntryLink), never from a click, a reload or a shared link, which start the frame
   within a second or two and let it fetch everything itself. The queue goes smallest first and the saved world
   document, the biggest by far, last: what has finished when the visitor arrives is whole files, and the
   document is the least likely to be mid-transfer then. Nothing in flight is ever cut: in a normal profile the
   frame's own request for the same URL joins the transfer on its way (measured: baseline 9.6 s against 12.7 s
   for a version that cut it, on a 5 s approach at 4G), while a private window's in-memory cache cannot keep a
   6.8 MB entry at all. When the frame is created the queue is dropped and nothing new starts: a copy of
   the document begun after the frame exists is pure contention (a second full copy in a private window). */

const FILE = pathToFileURL(path.join(root, 'src/components/world/prepare.ts')).href
let fresh = 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** A fake network: each request is answered after `every` ms with a body of `size` bytes. */
function rig({ size = 1000, every = 1, release, releaseEvery = 0 } = {}) {
  const calls = [], completed = []
  let open = 0, peak = 0
  const fakeFetch = (url, init = {}) => {
    const u = String(url).replace('http://site.test', '')
    calls.push({ url: u, init })
    if (u === '/api/world/release') {
      const answer = new Response(JSON.stringify(release ?? { world: { url: '/doc.gz' }, assets: { url: '/defs.json' } }), { headers: { 'content-type': 'application/json' } })
      return releaseEvery ? new Promise((resolve) => setTimeout(() => resolve(answer), releaseEvery)) : Promise.resolve(answer)
    }
    open++; peak = Math.max(peak, open)
    return new Promise((resolve) => setTimeout(() => { open--; completed.push(u); resolve(new Response(new Uint8Array(size))) }, every))
  }
  return { fetch: fakeFetch, calls, completed, peak: () => peak }
}

async function load(opts) {
  const net = rig(opts)
  globalThis.window = globalThis
  globalThis.location = { origin: 'http://site.test' }
  globalThis.fetch = net.fetch
  const prepare = await import(`${FILE}?fresh=${++fresh}`)
  return { ...prepare, net }
}

test('the world document is asked for last, after the small files, the models and the definitions', async () => {
  const { prepareWorld, net } = await load()
  prepareWorld()
  await sleep(250)
  const order = net.calls.map((c) => c.url).filter((u) => u !== '/api/world/release')
  assert.equal(order.at(-1), '/doc.gz', 'the biggest file goes last')
  const at = (needle) => order.findIndex((u) => u.includes(needle))
  for (const small of ['navigation.json', 'interactions.json', 'world-manifest.json', 'corsair.glb.gz']) {
    assert.ok(at(small) >= 0 && at(small) < at('rapier.es.js'), `${small} before the engine`)
  }
  assert.ok(at('/defs.json') < at('/doc.gz'), 'definitions before the document')
})

test('only what the frame draws is warmed: no editor library, the compressed plane the runtime asks for', async () => {
  const { prepareWorld, net } = await load()
  prepareWorld()
  await sleep(250)
  const urls = net.calls.map((c) => c.url)
  assert.ok(!urls.some((u) => u.includes('vegetation')), 'the editor’s library is never warmed')
  assert.ok(urls.includes('/archipelago/assets/vehicles/plane/corsair.glb.gz'))
  assert.ok(!urls.includes('/archipelago/assets/vehicles/plane/corsair.glb'), 'not the raw plane, which nothing asks for')
})

test('two at a time, low priority, same origin credentials, and the release is revalidated', async () => {
  const { prepareWorld, net } = await load({ every: 15 })
  prepareWorld()
  await sleep(400)
  assert.ok(net.peak() <= 2, `at most two transfers at once (saw ${net.peak()})`)
  const files = net.calls.filter((c) => c.url !== '/api/world/release')
  assert.ok(files.length >= 9)
  for (const c of files) assert.equal(c.init.priority, 'low')
  const release = net.calls.find((c) => c.url === '/api/world/release')
  assert.equal(release.init.cache, 'no-cache')
})

test('asked twice, it asks once: a hover and then a scroll warm the same bytes', async () => {
  const { prepareWorld, net } = await load()
  prepareWorld()
  prepareWorld()
  await sleep(200)
  const urls = net.calls.map((c) => c.url)
  assert.equal(new Set(urls).size, urls.length)
})

test('data saver: nothing is fetched on a guess', async () => {
  const { prepareWorld, net } = await load()
  Object.defineProperty(globalThis.navigator, 'connection', { value: { saveData: true }, configurable: true })
  try {
    prepareWorld()
    await sleep(30)
    assert.equal(net.calls.length, 0)
  } finally {
    delete globalThis.navigator.connection
  }
})

test('a release on another origin is never warmed from here', async () => {
  const { prepareWorld, net } = await load({ release: { world: { url: 'https://cdn.example/doc.gz' }, assets: { url: '/defs.json' } } })
  prepareWorld()
  await sleep(200)
  const urls = net.calls.map((c) => c.url)
  assert.ok(!urls.some((u) => u.includes('cdn.example')))
  assert.ok(urls.includes('/defs.json'))
})

test('a failed release is tried again on the next approach', async () => {
  const { prepareWorld, net } = await load()
  const real = globalThis.fetch
  let failures = 1
  globalThis.fetch = (url, init) => (String(url) === '/api/world/release' && failures-- > 0 ? Promise.resolve(new Response('no', { status: 500 })) : real(url, init))
  prepareWorld()
  await sleep(60)
  prepareWorld()
  await sleep(200)
  const releases = net.calls.filter((c) => c.url === '/api/world/release').length
  assert.equal(releases, 1, 'the second request reached the network (the first failed before it)')
  assert.ok(net.calls.some((c) => c.url === '/doc.gz'))
})

test('when the frame is created what has not started is dropped and nothing new starts, but what is on its way is left alone', async () => {
  const { prepareWorld, endWarm, net } = await load({ every: 40 })
  prepareWorld()
  await sleep(60)
  const started = net.calls.length
  assert.ok(started >= 2 && started < 10, `mid-way: ${started} asked for`)
  endWarm()
  await sleep(500)
  assert.equal(net.calls.length, started, 'no request begins after the frame does')
  const flying = net.calls.slice(1).filter((c) => c.init.signal)
  assert.equal(flying.length, 0, 'and none is given a signal to be cut with: the frame joins what is on its way')
  assert.ok(net.completed.length >= 2, 'what was on its way arrived')
  assert.ok(!net.calls.some((c) => c.url === '/doc.gz'), 'the document, last in the queue, was never begun')
})

test('a release that is answered after the frame was created warms nothing, and a later approach is a no-op', async () => {
  const { prepareWorld, endWarm, net } = await load({ releaseEvery: 80 })
  prepareWorld()
  await sleep(20)
  endWarm()
  await sleep(250)
  const urls = net.calls.map((c) => c.url)
  assert.ok(!urls.includes('/doc.gz') && !urls.includes('/defs.json'), 'the files the release names are not asked for')
  const before = net.calls.length
  prepareWorld()
  await sleep(100)
  assert.equal(net.calls.length, before, 'a visit leaves everything in the HTTP cache: nothing to warm again')
})
