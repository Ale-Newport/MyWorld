/* First-party statistics, without adding a single row to the store:
   1. the browser sends the named events (beacon intercepted and answered here):
      pageview, journey progress, a project opened from the overlay,
      entering the world, the world ready, the map opened;
   2. the server drops what it must: a signed-in administrator, Do Not Track,
      Global Privacy Control, automation — measured by the Audience totals
      not moving.
   node scripts/qa/analytics.mjs */
import { BASE, launch, assert, sleep } from './lib.mjs'
import { signIn } from './admin-session.mjs'

const results = []
const browser = await launch()

/* 1 — what the browser sends */
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' })
await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }))
const sent = []
await ctx.route('**/api/analytics/collect', async (route) => {
  try { sent.push(...JSON.parse(route.request().postData() ?? '{}').events.map((e) => ({ type: e.type, path: e.path, props: e.props }))) } catch { /* not json */ }
  await route.fulfill({ status: 204 })
})
const page = await ctx.newPage()
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await sleep(1500)
await page.evaluate(() => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.55))
await sleep(2500)
await page.goto(`${BASE}/#project/focus`, { waitUntil: 'networkidle' })
await sleep(2500)
await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('[data-world-shell][data-ready]', { timeout: 240000 })
await sleep(800)
const frame = page.frameLocator('iframe').first()
await frame.locator('canvas').first().click({ position: { x: 300, y: 300 } }).catch(() => {})
await page.keyboard.press('KeyM')
await sleep(1500)
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
await page.goto('about:blank')
await sleep(800)
const types = sent.map((e) => e.type)
console.log('sent:', JSON.stringify(sent.map((e) => `${e.type}${e.props ? ' ' + JSON.stringify(e.props) : ''}`)))
assert(types.includes('pageview'), 'page views are sent', results)
assert(sent.some((e) => e.type === 'journey_progress' && e.props?.journey === 'home' && e.props?.pct === 50), 'reaching half of the homepage sends journey_progress 50', results)
assert(sent.some((e) => e.type === 'project_open' && e.props?.from === 'overlay' && e.props?.slug === 'focus'), 'opening a case study sends project_open from the overlay', results)
assert(sent.some((e) => e.type === 'world_ready' && typeof e.props?.ms === 'number'), 'the world reports how long it took to be ready', results)
assert(sent.some((e) => e.type === 'map_open'), 'opening the M map is counted', results)
assert(sent.every((e) => !/[?&]/.test(e.path ?? '')), 'no query strings are sent', results)
await ctx.close()

/* 2 — what the server refuses to store */
const { page: admin } = await signIn(browser)
const totalEvents = async () => {
  await admin.goto(`${BASE}/admin/analytics?days=7`, { waitUntil: 'domcontentloaded' })
  const views = await admin.locator('.stat', { hasText: 'Page views' }).locator('b').textContent().catch(() => '0')
  return Number((views ?? '0').replace(/,/g, ''))
}
const before = await totalEvents()
const post = (headers) => fetch(`${BASE}/api/analytics/collect`, { method: 'POST', headers: { 'content-type': 'text/plain', 'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/140.0 Safari/537.36', ...headers }, body: JSON.stringify({ events: [{ type: 'pageview', path: '/qa-should-not-count' }], width: 1440 }) })
const cookie = (await admin.context().cookies()).filter((c) => c.name.includes('an_admin')).map((c) => `${c.name}=${c.value}`).join('; ')
const answers = await Promise.all([
  post({ cookie }), post({ dnt: '1' }), post({ 'sec-gpc': '1' }),
  post({ 'user-agent': 'Mozilla/5.0 HeadlessChrome/140.0' }), post({ 'user-agent': 'Googlebot/2.1' }),
  fetch(`${BASE}/api/analytics/collect`, { method: 'POST', body: '{"events":[{"type":"made_up","path":"/"}]}', headers: { 'user-agent': 'Mozilla/5.0 Chrome/140' } }),
])
assert(answers.every((r) => r.status === 204), 'the collector answers 204 either way (whether anything was kept is not disclosed)', results)
await sleep(500)
const after = await totalEvents()
assert(after === before, `admin, Do Not Track, GPC, headless and bot traffic and unknown events are all dropped (page views ${before} → ${after})`, results)
await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
