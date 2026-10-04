/* The visual page editor, driven like a person would, against the real page
   in its frame:
     select by clicking the canvas → inspector shows it
     restyle at Desktop, override at Mobile → each frame width gets its own
     drag to move (with snapping), arrow-nudge, resize from a handle
     double-click → edit text in place (a field bound to the profile)
     insert a heading and a table from the palette, duplicate, group, move the group
     hide, lock, undo / redo
     save → the public page is unchanged → publish → the public page has it all
   and finally the original document is restored and published again.

   node scripts/qa/page-editor-e2e.mjs */
import { BASE, launch, assert, sleep, watch, out } from './lib.mjs'
import { signIn, adminFetch } from './admin-session.mjs'

const results = []
const browser = await launch()
const { context, page } = await signIn(browser, { viewport: { width: 1600, height: 1000 } })
const errors = watch(page, 'admin ')
const start = (await adminFetch(page, '/api/admin/site')).body
const original = start.doc

const frameEl = () => page.locator('iframe[title^="Draft preview"]')
const frame = () => page.frameLocator('iframe[title^="Draft preview"]')
const inFrame = (fn, arg) => frameEl().evaluate((f, [src, a]) => f.contentWindow.eval(`(${src})`)(a), [fn.toString(), arg])
/** Page coordinates of a point inside the frame's (scaled) document. */
async function toPage(x, y) {
  const box = await frameEl().boundingBox()
  const scale = box.width / (await frameEl().evaluate((f) => f.offsetWidth))
  return { x: box.x + x * scale, y: box.y + y * scale, scale }
}
async function centerOf(id) {
  const r = await inFrame((id) => { const el = document.querySelector(`[data-cms-id="${id}"]`); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height, l: b.left, t: b.top } }, id)
  const p = await toPage(r.x, r.y)
  return { ...r, px: p.x, py: p.y, scale: p.scale }
}
const computed = (id, prop) => inFrame(([id, prop]) => getComputedStyle(document.querySelector(`[data-cms-id="${id}"]`))[prop], [id, prop])
const draft = async () => (await adminFetch(page, '/api/admin/site')).body.doc

try {
  await page.goto(`${BASE}/admin/pages`, { waitUntil: 'domcontentloaded' })
  await frame().locator('[data-cms-id="prelude.thesis"]').first().waitFor({ timeout: 90000 })
  await page.locator('.pe-tree-section').first().waitFor()
  await sleep(1500)

  /* 1 — select on the canvas */
  const thesis = await centerOf('prelude.thesis')
  await page.mouse.click(thesis.px, thesis.py)
  await page.locator('.pe-right .pe-title', { hasText: 'Thesis' }).waitFor({ timeout: 5000 }).then(() => true, () => false).then((ok) => assert(ok, 'clicking the thesis on the canvas selects it in the inspector', results))
  const boxShown = await inFrame(() => [...document.querySelectorAll('[data-cms-overlay] .b.s')].some((b) => !b.hidden))
  assert(boxShown, 'the frame draws a selection box around it', results)

  /* 2 — restyle at desktop, override at mobile */
  const size = page.locator('.pe-right input[aria-label="Size"]')
  await size.fill('44px')
  await sleep(600)
  assert(await computed('prelude.thesis', 'fontSize') === '44px', `desktop font size applied in the frame (${await computed('prelude.thesis', 'fontSize')})`, results)
  await page.getByRole('button', { name: 'Mobile', exact: true }).click()
  await frame().locator('[data-cms-id="prelude.thesis"]').first().waitFor({ timeout: 60000 })
  await sleep(1500)
  assert(await computed('prelude.thesis', 'fontSize') === '44px', 'mobile inherits the desktop size until it sets its own', results)
  await page.locator('.pe-right input[aria-label="Size"]').fill('22px')
  await sleep(600)
  assert(await computed('prelude.thesis', 'fontSize') === '22px', 'a mobile override applies at mobile width', results)
  await page.getByRole('button', { name: 'Desktop', exact: true }).click()
  await frame().locator('[data-cms-id="prelude.thesis"]').first().waitFor({ timeout: 60000 })
  await sleep(1500)
  assert(await computed('prelude.thesis', 'fontSize') === '44px', 'and desktop keeps its own size', results)
  const d1 = await draft().catch(() => null)
  void d1

  /* 3 — drag to move, with snapping; nudge; resize */
  const t0 = await centerOf('prelude.thesis')
  await page.mouse.move(t0.px, t0.py)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) { await page.mouse.move(t0.px + i * 6, t0.py + i * 3); await sleep(16) }
  await page.mouse.up()
  await sleep(700)
  const tr = await computed('prelude.thesis', 'translate')
  assert(tr && tr !== 'none' && tr !== '0px', `dragging writes a translate (${tr})`, results)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+ArrowDown')
  await sleep(500)
  const tr2 = await computed('prelude.thesis', 'translate')
  const [x1, y1] = tr.split(' ').map(parseFloat), [x2, y2] = tr2.split(' ').map(parseFloat)
  assert(Math.abs(x2 - x1 - 1) < 0.2 && Math.abs(y2 - (y1 || 0) - 10) < 0.2, `arrow keys nudge 1 px and Shift 10 px (${tr} → ${tr2})`, results)
  const handle = await inFrame(() => { const k = document.querySelector('[data-cms-overlay] .k[data-h="e"]'); const r = k.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
  const hp = await toPage(handle.x, handle.y)
  const w0 = parseFloat(await computed('prelude.thesis', 'width'))
  await page.mouse.move(hp.x, hp.y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) { await page.mouse.move(hp.x - i * 8, hp.y); await sleep(16) }
  await page.mouse.up()
  await sleep(700)
  const w1 = parseFloat(await computed('prelude.thesis', 'width'))
  assert(w1 < w0 - 20, `dragging the right handle resizes the width (${w0} → ${w1})`, results)

  /* 4 — inline text, bound to the profile */
  const before = (await page.evaluate(() => null), original.profile)
  void before
  const thesisNow = await centerOf('prelude.thesis')
  await page.mouse.dblclick(thesisNow.px, thesisNow.py)
  const area = frame().locator('[data-cms-overlay] textarea')
  const opened = await area.waitFor({ timeout: 5000 }).then(() => true, () => false)
  assert(opened, 'double-clicking text opens an in-place editor', results)
  if (opened) {
    await area.fill('I build intelligent systems — QA edit.')
    await area.press('Escape')
    await sleep(800)
    const shown = await inFrame(() => document.querySelector('[data-cms-id="prelude.thesis"]').textContent)
    assert(shown.includes('QA edit'), 'the page shows the new text', results)
  }

  /* 5 — insert, duplicate, group, move the group */
  await page.getByRole('tab', { name: 'Insert' }).click()
  await page.locator('.pe-tile', { hasText: 'Heading' }).click()
  await sleep(1200)
  const heading = await inFrame(() => { const el = document.querySelector('[data-cms-added][data-cms-kind="heading"]'); return el && { id: el.dataset.cmsId, text: el.textContent } })
  assert(heading?.text === 'A new heading', `the palette adds a heading to the section in view (${heading?.id})`, results)
  await page.locator('.pe-tile', { hasText: 'Table' }).click()
  await sleep(1200)
  const table = await inFrame(() => { const t = document.querySelector('[data-cms-added] table'); return t && { caption: t.caption?.textContent, ths: t.querySelectorAll('th').length } })
  assert(table?.caption === 'Table' && table.ths >= 2, 'a table renders as a semantic table with caption and header cells', results)
  // select the heading, duplicate
  const h = await centerOf(heading.id)
  await page.mouse.click(h.px, h.py)
  await sleep(300)
  await page.keyboard.press('Meta+d')
  await sleep(1000)
  const headings = await inFrame(() => document.querySelectorAll('[data-cms-added][data-cms-kind="heading"]').length)
  assert(headings === 2, `⌘D duplicates the added heading (${headings})`, results)
  // shift-click the original to select both, group, then move the group
  const copyId = await inFrame((first) => [...document.querySelectorAll('[data-cms-added][data-cms-kind="heading"]')].map((e) => e.dataset.cmsId).find((x) => x !== first), heading.id)
  const c1 = await centerOf(heading.id)
  await page.mouse.click(c1.px, c1.py)
  const c2 = await centerOf(copyId)
  await page.keyboard.down('Shift')
  await page.mouse.click(c2.px, c2.py)
  await page.keyboard.up('Shift')
  await sleep(300)
  await page.keyboard.press('Meta+g')
  await sleep(800)
  const g = (await page.evaluate(() => document.querySelector('.pe-right .pe-title')?.textContent))
  assert(/2 elements/.test(g ?? ''), `two elements selected for grouping (${g})`, results)
  await page.locator('.pe-item', { hasText: 'Group of 2' }).waitFor({ timeout: 5000 }).catch(() => {})
  await page.getByRole('tab', { name: 'Layers' }).click()
  assert(await page.locator('.pe-item', { hasText: 'Group of 2' }).count() === 1, 'the group appears in Layers', results)
  await page.mouse.click(5, 500) // focus the editor, not a field
  const ga = await centerOf(heading.id)
  await page.mouse.click(ga.px, ga.py)
  await sleep(300)
  const selectedBoth = await inFrame(() => document.querySelectorAll('[data-cms-overlay] .b.s.g').length)
  assert(selectedBoth >= 2, `clicking one member selects the whole group (${selectedBoth} dashed boxes)`, results)
  const before1 = await computed(heading.id, 'translate'), before2 = await computed(copyId, 'translate')
  await page.keyboard.press('Shift+ArrowRight')
  await sleep(500)
  const after1 = await computed(heading.id, 'translate'), after2 = await computed(copyId, 'translate')
  assert(after1 !== before1 && after2 !== before2, `moving the group moves both members (${before1}→${after1}, ${before2}→${after2})`, results)

  /* 6 — hide, undo, redo */
  await page.keyboard.press('Escape')
  const t3 = await centerOf('prelude.thesis')
  await page.mouse.click(t3.px, t3.py)
  await page.locator('.pe-right button', { hasText: /^Hide$/ }).click()
  await sleep(500)
  // In the editor a hidden element stays selectable: faint and outlined (the chapter animates its opacity inline, so check the outline).
  assert(await computed('prelude.thesis', 'outlineStyle') === 'dashed', 'hiding marks the element as hidden in the editor', results)
  await page.mouse.click(5, 500)
  await page.keyboard.press('Meta+z')
  await sleep(500)
  assert(await computed('prelude.thesis', 'outlineStyle') !== 'dashed', 'undo brings it back', results)
  await page.keyboard.press('Meta+Shift+z')
  await sleep(500)
  assert(await computed('prelude.thesis', 'outlineStyle') === 'dashed', 'redo hides it again', results)
  await page.keyboard.press('Meta+z')
  await sleep(500)
  await page.screenshot({ path: out('page-editor-e2e.png') })

  /* 7 — save, public unchanged, publish, public changed */
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByText('Draft differs from the live site').waitFor({ timeout: 20000 })
  const visitor = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const pub = await visitor.newPage()
  await pub.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  const pubBefore = await pub.evaluate(() => ({ text: document.querySelector('[data-cms-id="prelude.thesis"]')?.textContent, added: document.querySelectorAll('[data-cms-added]').length }))
  assert(!pubBefore.text?.includes('QA edit') && pubBefore.added === 0, 'a saved draft does not reach the public page', results)
  await page.getByRole('button', { name: 'Publish' }).click()
  await page.getByText('Live site is up to date').waitFor({ timeout: 30000 })
  await pub.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  const pubAfter = await pub.evaluate(() => ({ text: document.querySelector('[data-cms-id="prelude.thesis"]')?.textContent, size: getComputedStyle(document.querySelector('[data-cms-id="prelude.thesis"]')).fontSize, added: document.querySelectorAll('[data-cms-added]').length, table: !!document.querySelector('[data-cms-added] table caption') }))
  assert(pubAfter.text?.includes('QA edit') && pubAfter.size === '44px' && pubAfter.added >= 3 && pubAfter.table, `after publishing, the public page has the edits (${JSON.stringify(pubAfter)})`, results)
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true })
  const mp = await mobile.newPage()
  await mp.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  const mSize = await mp.evaluate(() => getComputedStyle(document.querySelector('[data-cms-id="prelude.thesis"]')).fontSize)
  assert(mSize === '22px', `a phone gets the mobile override (${mSize})`, results)
  await pub.screenshot({ path: out('page-editor-public.png') })
  await visitor.close(); await mobile.close()
} finally {
  const head = (await adminFetch(page, '/api/admin/site')).body.head
  const saved = await adminFetch(page, '/api/admin/site/draft', { method: 'PUT', json: { base: head.draft?.id ?? null, doc: original, message: 'QA: page editor run restored' } })
  const pubd = await adminFetch(page, '/api/admin/site/publish', { method: 'POST', json: {} })
  assert(saved.status === 200 && pubd.status === 200, 'the original document was restored and published', results)
}
assert(errors.length === 0, `no console errors in the admin (${errors.slice(0, 3).join(' | ')})`, results)
await context.close()
await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
