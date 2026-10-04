/* Homepage → /world through the leaves. Verifies that nothing of the world is
   requested before the cover is verified, that the URL changes while covered,
   that the world loads and draws under the cover, and that the leaves only part
   after the runtime's ready signal. Writes a trace and screenshots to .qa/runs.

   node scripts/qa/transition.mjs [--w 1440 --h 900] [--reduced] [--slow] [--warm] [--via index|scroll] */
import { launch, out, sleep, assert, finish, BASE } from './lib.mjs'
import fs from 'node:fs'
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1] }
const flag = (k) => process.argv.includes(`--${k}`)
const W = +arg('w', 1440), H = +arg('h', 900), reduced = flag('reduced'), slow = flag('slow'), warm = flag('warm'), via = arg('via', 'scroll')
const tag = `${W}x${H}${reduced ? '-reduced' : ''}${slow ? '-slow' : ''}${warm ? '-warm' : ''}-${via}`
const results = []
const browser = await launch()
const context = await browser.newContext({ viewport: { width: W, height: H }, reducedMotion: reduced ? 'reduce' : 'no-preference' })
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
if (slow) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (4 * 1024 * 1024) / 8, uploadThroughput: (1024 * 1024) / 8 })
if (!warm) await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
const requests = []
page.on('request', (r) => requests.push({ at: Date.now(), url: r.url().replace(BASE, '') }))
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
await page.addInitScript(() => {
  window.__phases = []
  window.addEventListener('world:phase', (e) => window.__phases.push({ phase: e.detail, at: Date.now(), path: location.pathname }))
})
if (warm) { // visit the world once so its files are in the HTTP cache
  await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-world-shell][data-ready]', { timeout: 240000 })
}
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await sleep(2500)
const t0 = Date.now()
if (via === 'scroll' && !reduced) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await sleep(2600)
  for (let i = 0; i < 220; i++) {
    await page.mouse.wheel(0, 120)
    await sleep(25)
    if (await page.evaluate(() => document.documentElement.dataset.worldPhase && document.documentElement.dataset.worldPhase !== 'HOME')) break
  }
} else {
  // Reduced motion (or --via index): the visible "Enter my world" link at the foot.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await sleep(1500)
  await page.locator('a[href="/world"]').last().click()
}
await page.waitForFunction(() => window.__phases.some((p) => p.phase === 'COVERED'), null, { timeout: 30000 })
await page.screenshot({ path: out(`transition/${tag}-covered.png`) })
const coveredShot = await page.evaluate(() => { const c = document.querySelector('[data-covered]'); return { covered: !!c } })
await page.waitForFunction(() => window.__phases.some((p) => p.phase === 'REVEALING' || p.phase === 'ERROR'), null, { timeout: 300000 })
await page.screenshot({ path: out(`transition/${tag}-revealing.png`) })
await page.waitForFunction(() => window.__phases.some((p) => p.phase === 'IN_WORLD' || p.phase === 'ERROR'), null, { timeout: 60000 })
await sleep(500)
await page.screenshot({ path: out(`transition/${tag}-in-world.png`) })
const phases = await page.evaluate(() => window.__phases)
const at = (p) => phases.find((x) => x.phase === p)?.at
const covered = at('COVERED'), revealing = at('REVEALING')
const worldish = (u) => u.startsWith('/world') || u.includes('/archipelago/') || u.startsWith('/api/world') || u.includes('_rsc') && u.includes('world')
const early = requests.filter((r) => worldish(r.url) && r.at < covered && r.at >= t0)
assert(!!covered, `cover verified on screen before anything else (${covered - t0} ms after the push began)`, results)
assert(coveredShot.covered, 'the cover marked itself covered (opaque layer spanning the viewport for two presented frames)', results)
assert(early.length === 0, `no world-exclusive request before COVERED (${early.length}: ${early.slice(0, 3).map((r) => r.url).join(', ')})`, results)
const pathAtLoading = phases.find((p) => p.phase === 'LOADING_WORLD')?.path
assert(pathAtLoading === '/world', `URL is /world while still covered (at LOADING_WORLD: ${pathAtLoading})`, results)
const worldReq = requests.filter((r) => worldish(r.url) && r.at >= covered)
assert(worldReq.some((r) => r.url.includes('/archipelago/preview/main.js')) && worldReq.some((r) => r.url.startsWith('/api/world/blob/')), `world runtime and document requested after COVERED (${worldReq.length} requests)`, results)
const lateWorld = requests.filter((r) => (r.url.includes('/archipelago/') || r.url.startsWith('/api/world')) && revealing && r.at > revealing && !r.url.includes('blob:'))
assert(lateWorld.length === 0, `nothing of the initial world was still loading when the leaves parted (${lateWorld.map((r) => r.url).slice(0, 4).join(', ')})`, results)
const ready = await page.evaluate(() => document.querySelector('iframe')?.contentDocument?.body.dataset.ready)
assert(ready === 'true', 'the world reported a prepared frame before the reveal', results)
const order = ['COVERING', 'COVERED', 'LOADING_WORLD', 'WORLD_READY', 'REVEALING', 'IN_WORLD']
assert(JSON.stringify(phases.map((p) => p.phase)) === JSON.stringify(order), `phases in order: ${phases.map((p) => p.phase).join(' → ')}`, results)
assert(page.url().endsWith('/world'), `ended on ${page.url()}`, results)
assert(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ')})`, results)
const trace = { tag, t0, phases: phases.map((p) => ({ ...p, ms: p.at - t0 })), requests: requests.filter((r) => r.at >= t0).map((r) => ({ ms: r.at - t0, url: r.url.slice(0, 140) })) }
fs.writeFileSync(out(`transition/${tag}-trace.json`), JSON.stringify(trace, null, 1))
console.log('phases', trace.phases.map((p) => `${p.phase}@${p.ms}ms`).join('  '))
await browser.close()
finish(results)
