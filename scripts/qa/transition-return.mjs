/* Back from /world is a return, by every way in.

     QA_BASE=<production url> node scripts/qa/transition-return.mjs

   The journey is one long page (about 18,500 px) and `history.scrollRestoration` is manual, so the homepage puts a
   returning visitor down itself, from a position written when the way in began. The scroll push always did; the "Enter
   my world" link and the index's link went back to the very top. Each way in is taken, the world is reached, Back is
   pressed, and the homepage must be where the visitor left it (the foot is put down at 93 %, the last chapter, with the
   door not armed): through the push, the foot's link, the index's link from the foot, and the index's link from
   the middle of the journey. */
import { BASE, launch, sleep, assert, finish } from './lib.mjs'

const results = []
const browser = await launch()
const phase = (page) => page.evaluate(() => document.documentElement.dataset.worldPhase ?? 'HOME')

for (const via of ['push', 'link', 'index-foot', 'index-middle']) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__room?.().milestones.ready, null, { timeout: 90000 })
  await sleep(1200)
  const max = () => page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
  const at = via === 'index-middle' ? 0.4 : 1
  await page.evaluate((p) => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * p), at)
  await sleep(2600)
  const before = await page.evaluate(() => scrollY)
  if (via === 'push') for (let i = 0; i < 300 && (await phase(page)) === 'HOME'; i++) { await page.mouse.wheel(0, 120); await sleep(22) }
  else if (via === 'link') await page.locator('[data-stage-foot] a[href="/world"]').first().evaluate((a) => a.click())
  else { await page.keyboard.press('i'); const link = page.locator('[aria-label="Chapter index"] a[href="/world"]'); await link.waitFor({ state: 'visible' }); await sleep(900); await link.click() }
  await page.waitForFunction(() => document.documentElement.dataset.worldPhase === 'IN_WORLD', null, { timeout: 300000 })
  await sleep(800)
  await page.goBack()
  await page.waitForFunction(() => location.pathname === '/')
  await sleep(2500)
  const back = await page.evaluate(() => scrollY)
  const total = await max()
  const want = Math.min(before / total, 0.93)
  const got = back / total
  assert(Math.abs(got - want) <= 0.03, `${via}: Back puts the visitor at ${(got * 100).toFixed(0)} % of the journey; they left from ${(before / total * 100).toFixed(0)} % (expected ${(want * 100).toFixed(0)} % ± 3)`, results)
  assert(got > 0.2, `${via}: not the top of the page (${back} of ${total} px)`, results)
  await context.close()
}
await browser.close()
finish(results)
