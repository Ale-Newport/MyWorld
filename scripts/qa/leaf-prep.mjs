/* The end of the homepage: how soon the leaves can answer a push.

     node scripts/qa/leaf-prep.mjs [--base URL] [--runs 3] [--cpu 4] [--settle 1500]
       [--w 1440 --h 900] [--fling 700] [--json out.json]

   Each run opens the homepage in a fresh context (cold cache), waits
   `--settle` ms, flings to the foot in `--fling` ms (a fast scroll right
   after arriving), then pushes with the wheel as a visitor would. It
   records:

     pushAt        when the first push reached the foot (ms after load)
     readyAt       when the canopy could first draw (window.__canopy, when
                   the build exposes it), relative to the push: <= 0 means it
                   was prepared before anyone pushed
     firstLeaf     ms from the push until the canopy had drawn leaves
                   (its live canvas has pixels), sampled every frame
     worstFrame    the longest gap between animation frames from the push
                   until the cover was verified
     longTasks     long tasks (>50 ms) from the fling until COVERED
     covered       ms from the push until the cover was verified (COVERED)
     worldEarly    requests for /world, its runtime or document before COVERED
                   (must be zero)

   Nothing here is estimated; a figure the page did not report is "–". */
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
const SETTLE = Number(opt('settle', 1500))
const FLING = Number(opt('fling', 700))
const W = Number(opt('w', 1440))
const H = Number(opt('h', 900))
const JSON_OUT = opt('json', null)
const WORLD = /\/archipelago\/|\/api\/world\/|^\/world(\?|$)|_rsc.*world/

async function run(browser) {
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU })
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  const requests = []
  page.on('request', (r) => { const u = new URL(r.url()); requests.push({ at: Date.now(), path: u.pathname + u.search }) })
  await page.addInitScript(() => {
    const w = window
    w.__lp = { gaps: [], longTasks: [], leafAt: 0, phases: [] }
    let last = 0
    const tick = (t) => {
      if (last) w.__lp.gaps.push([t, t - last])
      last = t
      // Has the live canopy put any leaves on screen yet?
      if (!w.__lp.leafAt && w.__lp.pushAt) {
        const live = document.querySelector('[class*="canopy-module"] canvas, [class*="canopy"] canvas')
        if (live && live.width > 1) {
          try {
            const c = document.createElement('canvas')
            c.width = 48; c.height = 32
            const g = c.getContext('2d')
            g.drawImage(live, 0, 0, 48, 32)
            const d = g.getImageData(0, 0, 48, 32).data
            for (let i = 3; i < d.length; i += 4) if (d[i] > 8) { w.__lp.leafAt = performance.now(); break }
          } catch { /* a lost context reads as empty */ }
        }
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    new PerformanceObserver((list) => { for (const e of list.getEntries()) w.__lp.longTasks.push([e.startTime, e.duration]) }).observe({ type: 'longtask', buffered: true })
    window.addEventListener('world:phase', (e) => w.__lp.phases.push([e.detail, performance.now()]))
  })
  await page.goto(`${BASE}/`, { waitUntil: 'load' })
  const loadedAt = Date.now()
  await page.waitForTimeout(SETTLE)
  // The fling: the whole page in FLING ms.
  const flingAt = await page.evaluate(() => performance.now())
  await page.evaluate(async (ms) => {
    const end = document.documentElement.scrollHeight - innerHeight
    const t0 = performance.now()
    await new Promise((resolve) => {
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / ms)
        window.scrollTo(0, end * (1 - (1 - k) ** 3))
        if (k < 1) requestAnimationFrame(step)
        else resolve()
      }
      requestAnimationFrame(step)
    })
  }, FLING)
  // The push, as wheel input at the foot.
  await page.evaluate(() => { window.__lp.pushAt = performance.now() })
  const pushWall = Date.now()
  for (let i = 0; i < 400; i++) {
    await page.mouse.move(W / 2, H / 2)
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(25)
    const phase = await page.evaluate(() => document.documentElement.dataset.worldPhase)
    if (phase && phase !== 'HOME' && phase !== 'COVERING') break
  }
  await page.waitForFunction(() => window.__lp.phases.some(([p]) => p === 'COVERED'), null, { timeout: 60000 }).catch(() => {})
  const r = await page.evaluate((flingAt) => {
    const lp = window.__lp
    const covered = lp.phases.find(([p]) => p === 'COVERED')?.[1] ?? null
    const canopy = window.__canopy?.() ?? null
    const window_ = (a, b) => lp.gaps.filter(([t]) => t >= a && (b == null || t <= b)).map(([, g]) => g)
    const gaps = window_(lp.pushAt, covered)
    return {
      pushAt: Math.round(lp.pushAt),
      readyAt: canopy?.readyAt ? Math.round(canopy.readyAt - lp.pushAt) : null,
      firstLeaf: lp.leafAt ? Math.round(lp.leafAt - lp.pushAt) : null,
      worstFrame: gaps.length ? Math.round(Math.max(...gaps)) : null,
      longTasks: lp.longTasks.filter(([s]) => s >= flingAt && (covered == null || s <= covered)).length,
      covered: covered ? Math.round(covered - lp.pushAt) : null,
    }
  }, flingAt)
  r.worldEarly = requests.filter((q) => WORLD.test(q.path) && q.at >= loadedAt && (r.covered == null || q.at < pushWall + r.covered)).length
  await context.close()
  return r
}

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const runs = []
for (let i = 0; i < RUNS; i++) runs.push(await run(browser))
await browser.close()
const ms = (v) => (v == null ? '–' : `${v} ms`)
console.log(`${BASE}  ${W}×${H}  cpu ×${CPU}  settle ${SETTLE} ms  fling ${FLING} ms  runs ${RUNS}`)
for (const r of runs) console.log(`  canopy ready ${ms(r.readyAt)} (vs push)  first leaves ${ms(r.firstLeaf)}  worst frame ${ms(r.worstFrame)}  long tasks ${r.longTasks}  covered ${ms(r.covered)}  world before cover ${r.worldEarly}`)
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, W, H, CPU, SETTLE, FLING, runs }, null, 2))
if (runs.some((r) => r.worldEarly > 0)) {
  console.log('FAIL /world was requested before the cover was verified')
  process.exitCode = 1
}
