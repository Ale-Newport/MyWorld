/* Homepage start-up measurement against a production build.

     node scripts/qa/home-perf.mjs [--base http://localhost:3123] [--runs 3]
       [--cpu 4] [--net slow4g|fast3g] [--warm] [--w 1440 --h 900] [--json out.json]

   Every run opens a fresh browser context (a cold HTTP cache) unless
   --warm is given, in which case the page is loaded once to fill the
   cache and measured on the second load. Reported per run:

     fcp / lcp        paint timings from the browser
     roomReady        the home room layer marked data-ready="true"
                      (its first lit frame is on screen; the 700 ms
                      opacity fade starts there)
     longTasks / tbt  long tasks in the first 8 s, and the blocking
                      time they add up to (each task's time over 50 ms)
     js / bytes       script and total bytes transferred
     world            requests for /world's runtime or document made
                      while the homepage loaded (must be zero)

   Nothing here is estimated: a figure the browser did not report is
   printed as "–". */
import { chromium } from 'playwright'
import fs from 'node:fs'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  if (i < 0) return fallback
  const v = args[i + 1]
  return v === undefined || v.startsWith('--') ? true : v
}
const BASE = opt('base', process.env.QA_BASE ?? 'http://localhost:3123')
const RUNS = Number(opt('runs', 3))
const CPU = Number(opt('cpu', 1))
const NET = opt('net', null)
const WARM = Boolean(opt('warm', false))
const W = Number(opt('w', 1440))
const H = Number(opt('h', 900))
const JSON_OUT = opt('json', null)

const NETWORKS = {
  // Chrome DevTools presets (download/upload in bytes per second, latency in ms).
  slow4g: { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
  fast3g: { latency: 562.5, downloadThroughput: (1.44 * 1024 * 1024) / 8 * 0.9, uploadThroughput: (675 * 1024) / 8 * 0.9 },
}

const WORLD_PATTERN = /\/archipelago\/|\/api\/world\/|\/world2\//

async function measure(browser) {
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU })
  if (NET) {
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...NETWORKS[NET] })
  }
  await page.addInitScript(() => {
    const w = window
    w.__perf = { lcp: 0, longTasks: [] }
    new PerformanceObserver((list) => { for (const e of list.getEntries()) w.__perf.lcp = e.startTime }).observe({ type: 'largest-contentful-paint', buffered: true })
    new PerformanceObserver((list) => { for (const e of list.getEntries()) w.__perf.longTasks.push([e.startTime, e.duration]) }).observe({ type: 'longtask', buffered: true })
    // The room layer flips data-ready when its first lit frame is presented.
    const watch = () => {
      const host = document.querySelector('[data-room-host], div[data-ready][data-fallback]')
      if (host && host.getAttribute('data-ready') === 'true' && !w.__perf.roomReady) w.__perf.roomReady = performance.now()
    }
    new MutationObserver(watch).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-ready'], childList: true })
  })
  const worldRequests = []
  page.on('request', (r) => { if (WORLD_PATTERN.test(new URL(r.url()).pathname)) worldRequests.push(r.url()) })

  if (WARM) {
    await page.goto(`${BASE}/`, { waitUntil: 'load' })
    await page.waitForTimeout(6000)
    worldRequests.length = 0
  }
  await page.goto(`${BASE}/`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__perf.roomReady, null, { timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(8000 - 0)
  const result = await page.evaluate(() => {
    const paint = Object.fromEntries(performance.getEntriesByType('paint').map((e) => [e.name, e.startTime]))
    const res = performance.getEntriesByType('resource')
    const nav = performance.getEntriesByType('navigation')[0]
    const js = res.filter((r) => r.initiatorType === 'script' || /\.js(\?|$)/.test(r.name)).reduce((a, r) => a + (r.transferSize || 0), 0)
    const bytes = res.reduce((a, r) => a + (r.transferSize || 0), 0) + (nav?.transferSize || 0)
    const early = window.__perf.longTasks.filter(([s]) => s < 8000)
    return {
      fcp: paint['first-contentful-paint'] ?? null,
      lcp: window.__perf.lcp || null,
      roomReady: window.__perf.roomReady ?? null,
      longTasks: early.length,
      longestTask: early.reduce((a, [, d]) => Math.max(a, d), 0),
      tbt: early.reduce((a, [, d]) => a + Math.max(0, d - 50), 0),
      js,
      bytes,
      requests: res.length + 1,
    }
  })
  result.world = worldRequests.length
  await context.close()
  return result
}

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const runs = []
for (let i = 0; i < RUNS; i++) runs.push(await measure(browser))
await browser.close()

const ms = (v) => (v == null ? '–' : `${Math.round(v)} ms`)
const kb = (v) => (v == null ? '–' : `${Math.round(v / 1024)} KB`)
const median = (k) => {
  const v = runs.map((r) => r[k]).filter((x) => x != null).sort((a, b) => a - b)
  return v.length ? v[Math.floor(v.length / 2)] : null
}
console.log(`${BASE}  ${W}×${H}  cpu ×${CPU}  net ${NET ?? 'none'}  ${WARM ? 'warm' : 'cold'} cache  runs ${RUNS}`)
for (const r of runs) console.log(`  fcp ${ms(r.fcp)}  lcp ${ms(r.lcp)}  roomReady ${ms(r.roomReady)}  longTasks ${r.longTasks} (longest ${ms(r.longestTask)}, tbt ${ms(r.tbt)})  js ${kb(r.js)}  total ${kb(r.bytes)}  requests ${r.requests}  world ${r.world}`)
console.log(`median: fcp ${ms(median('fcp'))}  lcp ${ms(median('lcp'))}  roomReady ${ms(median('roomReady'))}  tbt ${ms(median('tbt'))}  js ${kb(median('js'))}`)
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, W, H, CPU, NET, WARM, runs }, null, 2))
if (runs.some((r) => r.world > 0)) {
  console.log('FAIL the homepage requested /world resources while loading')
  process.exitCode = 1
}
