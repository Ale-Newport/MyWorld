/* The verdict on a device that cannot keep up, on the homepage.

     QA_BASE=http://localhost:3235 node scripts/qa/home-pace.mjs [--sleeps]

   Run it against a PRODUCTION build. The canvas that used to judge the device by its own frame rate
   (GlobalCanvas's governor) no longer draws continuously on the home journey, so the page's frames are
   judged instead (lib/ticker `watchPace`), and the verdict is the same one: two windows of two seconds
   under 32 frames a second demote the device to the `low` tier, which the world portal reads to choose
   how thick the canopy is. Checks (each prints PASS or FAIL; exit 1 if any failed):

     watching   once the canvas is mounted (from the About chapter on) the watch is on
     capable    scrolling about the Toolbox for twelve seconds at full speed gives no verdict
     throttled  the same with the CPU slowed 60 times (CDP) does, once
     sleeps     (only with --sleeps) a page left alone after all that lets the shared loop sleep, so the
                watch costs nothing at rest. This needs the loop owners outside the home work (WorldPortal's
                tick and Lenis) to sleep as well, as with home-rest-motion.

   A page that is not being asked for frames has no pace to judge, so the verdict is given while the visitor
   is moving about, as on a device that cannot keep up it is the scroll that shows it: the checks scroll a
   little up and down (a hundred and twenty pixels every hundred milliseconds, turning every twelve steps).

   The state is read through `window.__ticker()`, which exists because this script sets
   `window.__tickerDebug` before the page loads. Nothing in the repository changes. */
import { chromium } from 'playwright'

const SLEEPS = process.argv.includes('--sleeps')
const BASE = String(process.env.QA_BASE ?? 'http://localhost:3235').replace(/\/$/, '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], ignoreDefaultArgs: ['--hide-scrollbars'] })
let failed = 0
const check = (name, ok, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`)
}

async function scrollAbout({ cpu, ms, phone = false }) {
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
  await page.addInitScript(() => { window.__tickerDebug = true })
  const cdp = await ctx.newCDPSession(page)
  await page.goto(`${BASE}/?room-still`, { waitUntil: 'load' })
  await page.waitForFunction(() => document.querySelector('[data-room-host]')?.getAttribute('data-ready') === 'true', null, { timeout: 120000 })
  await sleep(1500)
  const toolbox = await page.evaluate(() => { const el = document.querySelector('#journey section[data-chapter="toolbox"]'); const r = el.getBoundingClientRect(); return Math.round(r.top + scrollY + (el.offsetHeight - innerHeight) * 0.5) })
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
  const pace = () => page.evaluate(() => window.__ticker().pace ?? { watching: false, slow: false, strikes: 0, missing: true }) // a build without `watchPace` has none
  await page.evaluate((y) => scrollTo(0, y), toolbox)
  let watching = false
  const t0 = Date.now()
  for (let step = 0; Date.now() - t0 < ms; step++) {
    await page.evaluate((d) => scrollBy(0, d), Math.floor(step / 12) % 2 ? -120 : 120)
    await sleep(100)
    if (step % 10 === 0) {
      const p = await pace()
      watching ||= p.watching || p.slow
      if (p.slow) break
    }
  }
  const end = await pace()
  watching ||= end.watching || end.slow
  const loop = SLEEPS && cpu === 1 ? await (async () => { await sleep(13500); return page.evaluate(() => { const t = window.__ticker(); return { running: t.running, busy: t.busy } }) })() : null
  await ctx.close()
  return { watching, end, errors, loop }
}

{
  const r = await scrollAbout({ cpu: 1, ms: 12000 })
  check('watching: the watch is on once the canvas is mounted', r.watching, JSON.stringify(r.end))
  check('capable: scrolling about the Toolbox at full speed gives no verdict', !r.end.slow, JSON.stringify(r.end))
  if (SLEEPS) check('sleeps: left alone, the shared loop is asleep with the watch on', !!r.loop && !r.loop.running && r.end.watching, JSON.stringify(r.loop))
  check('capable: no page errors', r.errors.length === 0, JSON.stringify(r.errors))
}
for (const phone of [false, true]) {
  const r = await scrollAbout({ cpu: 60, ms: 40000, phone })
  check(`throttled${phone ? ' (phone)' : ''}: the same with the CPU slowed 60 times gives the verdict, once`, r.end.slow && !r.end.watching, JSON.stringify(r.end))
  check(`throttled${phone ? ' (phone)' : ''}: no page errors`, r.errors.length === 0, JSON.stringify(r.errors))
}

await browser.close()
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
