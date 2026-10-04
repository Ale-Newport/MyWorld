/* Settings → Leaf parting changes how long the leaves take to open over the world,
   and nothing else: for each value, enter /world from the index and time
   REVEALING → IN_WORLD; the cover is verified before the world loads either way.
   The original value is put back and published at the end.
   node scripts/qa/leaf-parting.mjs */
import { BASE, launch, sleep, assert, finish } from './lib.mjs'
import { signIn, adminFetch } from './admin-session.mjs'

const results = []
const browser = await launch()
const { page: admin } = await signIn(browser)
const setParting = async (value) => {
  const { body } = await adminFetch(admin, '/api/admin/site')
  body.doc.settings.options.leafParting = value
  const saved = await adminFetch(admin, '/api/admin/site/draft', { method: 'PUT', json: { base: body.head.draft?.id ?? null, doc: body.doc, message: `QA: leaf parting ${value}` } })
  const published = await adminFetch(admin, '/api/admin/site/publish', { method: 'POST', json: {} })
  if (saved.status !== 200 || published.status !== 200) throw new Error(`could not set leaf parting to ${value}`)
}
const original = (await adminFetch(admin, '/api/admin/site')).body.doc.settings.options.leafParting ?? 'standard'

async function measure() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.addInitScript(() => { window.__phases = []; window.addEventListener('world:phase', (e) => window.__phases.push({ phase: e.detail, at: performance.now() })) })
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await sleep(1500)
  await page.keyboard.press('i')
  await page.locator('[aria-label="Chapter index"] a[href="/world"]').click()
  await page.waitForFunction(() => window.__phases.some((p) => p.phase === 'IN_WORLD'), null, { timeout: 240000 })
  const phases = await page.evaluate(() => window.__phases)
  await ctx.close()
  const at = (name) => phases.find((p) => p.phase === name)?.at
  return { parting: at('IN_WORLD') - at('REVEALING'), covered: !!at('COVERED') && at('COVERED') < at('LOADING_WORLD') }
}

const times = {}
try {
  for (const value of ['slow', 'standard', 'quick']) {
    await setParting(value)
    await sleep(800)
    times[value] = await measure()
    console.log(value, Math.round(times[value].parting), 'ms')
  }
} finally {
  await setParting(original)
}
assert(Object.values(times).every((t) => t.covered), 'every run verified the cover before loading the world', results)
assert(Math.abs(times.standard.parting - 1500) < 250, `standard parting takes about 1.5 s (${Math.round(times.standard.parting)} ms)`, results)
assert(times.slow.parting > times.standard.parting * 1.3 && times.quick.parting < times.standard.parting * 0.8, `slow is longer and quick is shorter (${Math.round(times.slow.parting)} / ${Math.round(times.standard.parting)} / ${Math.round(times.quick.parting)} ms)`, results)
await browser.close()
finish(results)
