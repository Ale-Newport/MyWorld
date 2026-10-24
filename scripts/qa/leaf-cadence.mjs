/* The frame the door closes in: no longer one long frame on a slow CPU.

     QA_BASE=<production url> node scripts/qa/leaf-cadence.mjs [--phone] [--cpu 4] [--rounds 3] [--entry scroll|link|index]

   Pushing past the foot of the homepage charges the leaves; the frame that completes the charge closes the door
   (the lock on <html> and the page's body, and the leaves frozen into plain canvases). On a CPU four times slower than
   this machine that was one frame of 50-83 ms (the homepage before the way in: 33 ms at worst). It is now split over
   frames and the lock costs the page nothing it did not have to (see world/transition.ts, canopy/CanopyCover.tsx and
   the note in styles/globals.css): this pushes from the foot and measures every frame from the push until COVERED. The foot link
   and the index (`--entry link|index`) close the door in the frame of the click, and in that frame they raise the sheet that
   holds the pointer for the first second (world/transition.ts, `raiseShield`): one element, which must cost no frame either.
   Fails when the median of the rounds' worst frames is above 34 ms, any round's is above 50 ms, or a long task
   (> 50 ms) lands in the window in most rounds. */
import { devices } from 'playwright'
import { BASE, launch, sleep, assert, finish } from './lib.mjs'

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1] }
const PHONE = process.argv.includes('--phone')
const CPU = Number(arg('cpu', 4))
const ROUNDS = Number(arg('rounds', 3))
const ENTRY = arg('entry', 'scroll')
const results = []
const browser = await launch()
const rows = []
for (let round = 0; round < ROUNDS; round++) {
  const context = await browser.newContext(PHONE ? { ...devices['Pixel 7'] } : { viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await page.addInitScript(() => {
    window.__f = []; window.__lt = []; window.__rec = false
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]) }).observe({ type: 'longtask', buffered: true })
    const t = (ts) => { if (window.__rec) window.__f.push([ts, document.documentElement.dataset.worldPhase ?? 'HOME']); requestAnimationFrame(t) }
    requestAnimationFrame(t)
  })
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU })
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__room?.().milestones.ready, null, { timeout: 180000 })
  await sleep(1500)
  if (ENTRY === 'index') {
    await page.keyboard.press('i')
    await page.locator('[aria-label="Chapter index"] a[href="/world"]').waitFor({ state: 'visible' })
    await sleep(900 * CPU)
  } else {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await sleep(2500 * CPU)
  }
  const t0 = await page.evaluate(() => { window.__rec = true; return performance.now() })
  const phase = () => page.evaluate(() => document.documentElement.dataset.worldPhase ?? 'HOME')
  if (ENTRY === 'link') await page.locator('[data-stage-foot] a[href="/world"]').first().evaluate((a) => a.click())
  else if (ENTRY === 'index') await page.locator('[aria-label="Chapter index"] a[href="/world"]').evaluate((a) => a.click())
  else if (PHONE) { for (let i = 0; i < 60 && (await phase()) === 'HOME'; i++) await cdp.send('Input.synthesizeScrollGesture', { x: 195, y: 590, yDistance: -260, speed: 2500, gestureSourceType: 'touch', preventFling: true }).catch(() => {}) }
  else for (let i = 0; i < 400 && (await phase()) === 'HOME'; i++) { await page.mouse.wheel(0, 120); await sleep(22) }
  await page.waitForFunction(() => ['COVERED', 'LOADING_WORLD'].includes(document.documentElement.dataset.worldPhase ?? ''), null, { timeout: 120000 })
  const d = await page.evaluate(() => ({ f: window.__f, lt: window.__lt }))
  const fr = d.f.filter((r) => ['HOME', 'COVERING', 'COVERED'].includes(r[1]))
  const dt = fr.slice(1).map((r, i) => r[0] - fr[i][0])
  const end = fr[fr.length - 1][0]
  rows.push({ max: Math.max(...dt), over34: dt.filter((x) => x > 34).length, long: d.lt.filter(([s, du]) => s >= t0 && s <= end && du > 50).length, frames: fr.length })
  await context.close()
}
await browser.close()
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1]
const label = `${PHONE ? 'phone' : 'desktop'} at ${CPU}x CPU${ENTRY === 'scroll' ? '' : `, ${ENTRY} entry`}`
assert(med(rows.map((r) => r.max)) <= 34, `${label}: the median of the worst frames from the push to COVERED is ${med(rows.map((r) => r.max)).toFixed(1)} ms (rounds: ${rows.map((r) => r.max.toFixed(0)).join(', ')}; at most 34)`, results)
assert(rows.every((r) => r.max <= 50), `${label}: no round has a frame above 50 ms (${rows.map((r) => r.max.toFixed(0)).join(', ')})`, results)
assert(rows.filter((r) => r.long > 0).length <= Math.floor(rows.length / 2), `${label}: a long task (> 50 ms) lands in the window in at most half the rounds (${rows.map((r) => r.long).join(', ')})`, results)
finish(results)
