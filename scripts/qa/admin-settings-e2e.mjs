/* Settings reach the public site: the title becomes the document title, an
   extra navigation link appears in the index overlay, and "Leaf growth" changes
   how many wheel notches the homepage portal needs before the cover starts
   (measured, standard vs brisk). Everything is put back afterwards.

   node scripts/qa/admin-settings-e2e.mjs */
import { BASE, launch, assert, sleep, watch, out } from './lib.mjs'
import { signIn, adminFetch } from './admin-session.mjs'

const results = []
const browser = await launch()
const { context, page } = await signIn(browser)
const errors = watch(page, 'admin ')
const original = (await adminFetch(page, '/api/admin/site')).body.doc.settings
// Older seeds carried a "projects" entry nothing read; the restore leaves it out.
original.navigation = original.navigation.filter((n) => n.id !== 'projects')

/** Wheel notches at the foot of the homepage until the leaves start covering. */
async function notchesToCover() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const p = await ctx.newPage()
  await p.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await sleep(2000)
  await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await sleep(2600)
  let n = 0
  for (; n < 400; n++) {
    await p.mouse.wheel(0, 100)
    await sleep(30)
    if (await p.evaluate(() => !!document.documentElement.dataset.worldPhase && document.documentElement.dataset.worldPhase !== 'HOME')) break
  }
  await ctx.close()
  return n + 1
}

const MARK = `QA ${Date.now().toString(36)}`
try {
  await page.goto(`${BASE}/admin/settings`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Site title', { exact: true }).waitFor()
  await page.screenshot({ path: out('settings.png') })

  const standard = await notchesToCover()
  console.log('notches (standard):', standard)

  await page.getByLabel('Site title', { exact: true }).fill(`${original.title} ${MARK}`)
  await page.getByLabel('Leaf growth', { exact: true }).selectOption('brisk')
  // Remove extra links left by older seeds, then add one.
  while (await page.getByRole('button', { name: 'Remove link' }).count()) await page.getByRole('button', { name: 'Remove link' }).first().click()
  await page.getByRole('button', { name: '+ Link' }).click()
  await page.locator('input[aria-label$="label"][aria-label^="Link"]').last().fill('QA link')
  await page.locator('input[aria-label$="address"][aria-label^="Link"]').last().fill('https://example.com/qa')
  await page.getByRole('button', { name: 'Publish' }).click()
  await page.getByText('Live site is up to date').waitFor({ timeout: 30000 })

  const visitor = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const pub = await visitor.newPage()
  await pub.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  assert((await pub.title()).includes(MARK), `the public title follows the setting (“${await pub.title()}”)`, results)
  const link = await pub.locator('a[href="https://example.com/qa"]').count()
  assert(link === 1, 'the extra navigation link is in the index overlay', results)
  await visitor.close()

  const brisk = await notchesToCover()
  console.log('notches (brisk):', brisk)
  assert(brisk < standard * 0.9, `brisk leaf growth needs fewer notches than standard (${brisk} vs ${standard})`, results)
} finally {
  const { body } = await adminFetch(page, '/api/admin/site')
  body.doc.settings = original
  const saved = await adminFetch(page, '/api/admin/site/draft', { method: 'PUT', json: { base: body.head.draft?.id ?? null, doc: body.doc, message: 'QA: settings restored' } })
  const pubd = await adminFetch(page, '/api/admin/site/publish', { method: 'POST', json: {} })
  assert(saved.status === 200 && pubd.status === 200, 'the settings were put back and published', results)
}
const visitor = await browser.newContext()
const pub = await visitor.newPage()
await pub.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
assert(!(await pub.title()).includes(MARK), 'the public title is back to the original', results)
assert(errors.length === 0, `no console errors in the admin (${errors.slice(0, 3).join(' | ')})`, results)
await context.close()
await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
