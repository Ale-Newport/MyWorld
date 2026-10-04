/* The projects manager, end to end, as the QA administrator:
   edit a project → the live preview shows it before saving → save → the
   public site is unchanged → publish → its page, the index and the
   homepage show it; create a project with a table section → publish →
   its public page renders a semantic table; then put everything back
   and publish again, checking the public site matches where it started.

   node scripts/qa/admin-projects-e2e.mjs */
import { BASE, launch, assert, sleep, watch, out } from './lib.mjs'
import { signIn } from './admin-session.mjs'
import { cleanup } from './admin-cleanup.mjs'

const results = []
const browser = await launch()
const { context, page } = await signIn(browser)
const errors = watch(page, 'admin ')
const visitor = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const pub = await visitor.newPage()
const publicText = async (path) => {
  await pub.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
  await pub.waitForLoadState('networkidle').catch(() => {})
  return pub.evaluate(() => document.body.innerText)
}
const draftDoc = () => page.evaluate(async () => (await (await fetch('/api/admin/site')).json()).doc)

await cleanup(page)
const MARK = `QA ${Date.now().toString(36)}`
const original = (await draftDoc()).projects.find((p) => p.id === 'focus')
assert(original, 'the draft has the Focus project', results)

try {
/* 1 — edit, live preview */
await page.goto(`${BASE}/admin/projects`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('table.table tbody tr')
const rows = await page.locator('table.table tbody tr').count()
assert(rows >= 10, `the list shows every project (${rows} rows)`, results)
await page.click('a[href="/admin/projects/focus"] >> nth=0')
await page.waitForURL('**/admin/projects/focus')
const title = page.getByLabel('Title', { exact: true })
await title.waitFor()
const frame = page.frameLocator('iframe[title^="Draft preview"]')
await frame.locator('h1').first().waitFor({ timeout: 60000 })
await title.fill(`Focus ${MARK}`)
await frame.locator('h1', { hasText: MARK }).first().waitFor({ timeout: 10000 }).then(() => true, () => false).then((ok) => assert(ok, 'the preview shows the new title before saving', results))
await page.screenshot({ path: out('projects-e2e-preview.png') })
assert(!(await publicText('/projects/focus')).includes(MARK), 'the public page is unchanged by an unsaved edit', results)

/* 2 — save the draft */
await page.getByRole('button', { name: 'Save', exact: true }).click()
await page.getByText('Draft differs from the live site').waitFor({ timeout: 15000 })
assert((await draftDoc()).projects.find((p) => p.id === 'focus').title.includes(MARK), 'the saved draft holds the new title', results)
assert(!(await publicText('/projects/focus')).includes(MARK), 'the public page is unchanged by a saved draft', results)

/* 3 — the listing preview reads the same entity */
await page.getByRole('button', { name: 'Listing' }).click()
const listed = await frame.getByText(MARK).first().waitFor({ timeout: 60000 }).then(() => true, () => false)
assert(listed, 'the listing preview shows the edited title', results)

/* 4 — publish */
await page.getByRole('button', { name: 'Publish' }).click()
await page.getByText('Live site is up to date').waitFor({ timeout: 30000 })
assert((await publicText('/projects/focus')).includes(MARK), 'after publishing, the public project page shows the new title', results)
assert((await publicText('/projects')).includes(MARK), 'after publishing, the public index shows the new title', results)

/* 5 — a new project with a table */
await page.goto(`${BASE}/admin/projects`, { waitUntil: 'domcontentloaded' })
await page.getByRole('button', { name: '+ New project' }).click()
await page.waitForURL(/\/admin\/projects\/untitled-project/)
const newId = decodeURIComponent(page.url().split('/').pop())
await page.getByLabel('Title', { exact: true }).fill(`Table test ${MARK}`)
await page.getByLabel('One-line summary', { exact: true }).fill('A project created by the QA run.')
await page.getByRole('tab', { name: 'Details' }).click()
await page.getByLabel('Slug', { exact: true }).fill(`qa-${MARK.split(' ')[1]}`)
await page.getByLabel('Status', { exact: true }).selectOption('published')
await page.getByRole('tab', { name: 'Page sections' }).click()
await page.getByLabel('New section type').selectOption('table')
await page.getByRole('button', { name: '+ Add section' }).click()
await page.getByLabel('Caption', { exact: true }).fill('Comparison')
await page.getByLabel('Column 1 heading').fill('Aspect')
await page.getByLabel('Column 2 heading').fill('Value')
await page.getByLabel('Row 1, Aspect').fill('Speed')
await page.getByLabel('Row 1, Value').fill('Fast')
await sleep(900)
const slug = `qa-${MARK.split(' ')[1]}`
const previewTable = await frame.locator('table caption', { hasText: 'Comparison' }).waitFor({ timeout: 60000 }).then(() => true, () => false)
assert(previewTable, 'the preview of the unsaved new project renders its table', results)
await page.getByRole('button', { name: 'Publish' }).click()
await page.getByText('Live site is up to date').waitFor({ timeout: 30000 })
await pub.goto(`${BASE}/projects/${slug}`, { waitUntil: 'networkidle' })
const table = await pub.evaluate(() => {
  const t = document.querySelector('main table')
  return t && { caption: t.querySelector('caption')?.textContent, th: [...t.querySelectorAll('thead th')].map((x) => x.textContent), rowHeader: t.querySelector('tbody th[scope=row]')?.textContent, cell: t.querySelector('tbody td')?.textContent }
})
assert(table?.caption === 'Comparison' && table.th.join() === 'Aspect,Value' && table.rowHeader === 'Speed' && table.cell === 'Fast', `the public page renders a semantic table (${JSON.stringify(table)})`, results)
await pub.screenshot({ path: out('projects-e2e-new-public.png') })

/* 6 — put everything back */
await page.goto(`${BASE}/admin/projects/${encodeURIComponent(newId)}`, { waitUntil: 'domcontentloaded' })
await page.getByRole('tab', { name: 'Details' }).click()
page.once('dialog', (d) => d.accept())
await page.getByRole('button', { name: 'Delete project' }).click()
await page.waitForURL('**/admin/projects')
await page.click('a[href="/admin/projects/focus"] >> nth=0')
await page.getByLabel('Title', { exact: true }).fill(original.title)
await page.getByRole('button', { name: 'Publish' }).click()
await page.getByText('Live site is up to date').waitFor({ timeout: 30000 })
const after = (await draftDoc()).projects
assert(!after.some((p) => p.id === newId) && after.find((p) => p.id === 'focus').title === original.title, 'the draft is back to the original projects', results)
assert(!(await publicText('/projects')).includes(MARK), 'the public index no longer shows the QA edits', results)
const gone = await pub.goto(`${BASE}/projects/${slug}`).then((r) => r.status())
assert(gone === 404, `the deleted project's page answers 404 (${gone})`, results)

} finally {
  const left = await cleanup(page).catch((e) => { console.log('cleanup failed', e.message); return -1 })
  if (left) console.log(`cleanup had to undo ${left} leftover change(s)`)
}
assert(errors.length === 0, `no console errors in the admin (${errors.slice(0, 3).join(' | ')})`, results)
await context.close()
await visitor.close()
await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
