/* What the byte changes cost and save on the main thread: the world document's gunzip and JSON.parse, the asset definitions' parse,
   and each model's gunzip, unpacking (public/archipelago/preview/compressed-gltf.js inflateGLB) and GLTFLoader parse, measured in the
   running player of one server. Every operation runs RUNS times (the files are in the HTTP cache after the first, so this is CPU, not network);
   the table prints medians.

     QA_BASE=http://127.0.0.1:3294 node scripts/qa/world-bytes-timing.mjs --label before --runs 7 --out .qa/runs/impl/bytes
     QA_BASE=http://127.0.0.1:3295 node scripts/qa/world-bytes-timing.mjs --label after  --runs 7 --out .qa/runs/impl/bytes

   heapAtReadyMB is the JS heap of the ready world after a forced GC (Chromium's --js-flags=--expose-gc): what the player keeps, not what it
   touched on the way. What a parse touches lives outside the JS heap while it runs; scripts/qa/world-doc-memory.mjs measures that in Node. */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { BASE, sleep } from './lib.mjs'

const args = process.argv.slice(2)
const arg = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : fallback }
const LABEL = arg('label', 'run'), RUNS = Number(arg('runs', 7)), OUT = path.resolve(arg('out', '.qa/runs/impl/bytes'))

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--js-flags=--expose-gc', '--enable-precise-memory-info'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
await page.goto(BASE + '/archipelago/preview/index.html')
await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 300_000, polling: 100 })
await sleep(2500)
const result = await page.evaluate(async (runs) => {
  const now = () => performance.now(), heap = () => { gc(); gc(); return performance.memory.usedJSHeapSize / 1048576 }
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)] }
  const release = await (await fetch('/api/world/release', { cache: 'no-cache' })).json()
  const out = { release: { world: release.world.url, assets: release.assets.url }, heapAtReadyMB: +heap().toFixed(1) }
  const gunzipText = async (response) => new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).text()
  // the world document
  {
    const gunzip = [], parse = []
    for (let i = 0; i < runs; i++) {
      const t0 = now()
      const response = await fetch(release.world.url, { cache: 'force-cache' })
      const gz = response.headers.get('content-type')?.includes('gzip')
      const text = gz ? await gunzipText(response) : await response.text(), t1 = now()
      const doc = JSON.parse(text); const t2 = now()
      gunzip.push(t1 - t0); parse.push(t2 - t1)
      out.docChars = text.length; out.docKeys = Object.keys(doc).length
    }
    out.doc = { gunzipMs: med(gunzip), parseMs: med(parse), characters: out.docChars }
  }
  // the asset definitions: the file's parse, and what the player's restore makes of it
  {
    const parse = [], restore = [], parsedCount = []
    const defs = await import('/archipelago/preview/asset-definitions.js')
    for (let i = 0; i < runs; i++) {
      const response = await fetch(release.assets.url, { cache: 'force-cache' }), text = await response.text(), t1 = now(), json = JSON.parse(text), t2 = now()
      parse.push(t2 - t1)
      const instance = new defs.AssetDefinitions(), t3 = now()
      await instance.restore(json)
      restore.push(now() - t3); parsedCount.push(instance.definitions.size)
      out.defsChars = text.length
    }
    out.defs = { jsonParseMs: med(parse), restoreMs: med(restore), definitionsRestored: parsedCount[0], characters: out.defsChars }
  }
  // the models
  {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'), gltf = await import('/archipelago/preview/compressed-gltf.js')
    out.models = {}
    for (const url of ['/archipelago/exports/AlejandroWorld.glb.gz', '/archipelago/assets/environment/portfolio/models/world.glb.gz', '/archipelago/assets/environment/portfolio/models/vegetation.glb.gz']) {
      const gunzip = [], inflate = [], parse = [], wire = []
      let packed = false
      for (let i = 0; i < runs; i++) {
        const t0 = now(), response = await fetch(url, { cache: 'force-cache' }), bytes = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(), t1 = now()
        wire.push(Number(response.headers.get('content-length')))
        const split = gltf.splitGLB ? gltf.splitGLB(bytes) : null
        packed = !!split?.json.extensionsUsed?.includes('PORTFOLIO_range_quantization')
        const plain = gltf.inflateGLB ? await gltf.inflateGLB(bytes) : bytes, t2 = now()
        await new GLTFLoader().parseAsync(plain, new URL('.', location.href).href); const t3 = now()
        gunzip.push(t1 - t0); inflate.push(t2 - t1); parse.push(t3 - t2)
      }
      out.models[url.split('/').pop()] = { wireBytes: wire[0], packed, gunzipMs: med(gunzip), inflateMs: med(inflate), gltfParseMs: med(parse) }
    }
  }
  return out
}, RUNS)
await browser.close()
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, `timing-${LABEL}.json`), JSON.stringify({ label: LABEL, base: BASE, runs: RUNS, ...result }, null, 1))
console.log(JSON.stringify({ label: LABEL, base: BASE, runs: RUNS, ...result }, null, 1))
