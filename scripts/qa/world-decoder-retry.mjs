/* The player's model decoder (three's meshopt decoder, a dynamic import in public/archipelago/preview/compressed-gltf.js) is fetched
   again, under its own URL, when a fetch fails: a browser remembers a module whose fetch failed, so the same URL would fail for good.
   Blocks the module's first N requests and reports whether the island still comes up and what was requested.

     QA_BASE=http://127.0.0.1:3295 node scripts/qa/world-decoder-retry.mjs <failures>     0, 1, 2: ready;  3 or more: the island gives up (as for a failed model download) */
import { chromium } from 'playwright'
import { BASE } from './lib.mjs'

const FAILS = Number(process.argv[2] ?? 1)
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
const requests = [], errors = []
let blocked = 0
await page.route('**/meshopt_decoder.module.js*', (route) => {
  requests.push(route.request().url().replace(BASE, ''))
  if (blocked < FAILS) { blocked++; return route.abort('failed') }
  return route.continue()
})
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
const t0 = Date.now()
await page.goto(BASE + '/archipelago/preview/index.html')
let ready = true
try { await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: FAILS >= 3 ? 20_000 : 120_000, polling: 100 }) } catch { ready = false }
console.log(JSON.stringify({ failures: FAILS, ready, seconds: (Date.now() - t0) / 1000, decoderRequests: requests, errors: errors.slice(0, 6) }, null, 1))
await browser.close()
process.exit(ready === (FAILS < 3) ? 0 : 1)
