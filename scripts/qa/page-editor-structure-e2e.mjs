/* The page editor's structural tools:
     sections: add a custom section, rename it, hide / show, reorder, delete
     drag an element from the Insert panel onto the page (real DOM drag events)
     align and distribute three elements; copy and paste; reorder in Layers
     Preview mode lets the page behave normally; Test transition runs the
     leaf transition into /world inside the frame while the admin stays put
   Everything is undone by restoring the original document at the end.

   node scripts/qa/page-editor-structure-e2e.mjs */
import { BASE, launch, assert, sleep, watch, out } from './lib.mjs'
import { signIn, adminFetch } from './admin-session.mjs'

const results = []
const browser = await launch()
const { context, page } = await signIn(browser, { viewport: { width: 1600, height: 1000 } })
const errors = watch(page, 'admin ')
const original = (await adminFetch(page, '/api/admin/site')).body.doc
const frameEl = () => page.locator('iframe[title^="Draft preview"]')
const frame = () => page.frameLocator('iframe[title^="Draft preview"]')
const inFrame = (fn, arg) => frameEl().evaluate((f, [src, a]) => f.contentWindow.eval(`(${src})`)(a), [fn.toString(), arg])
const rects = (ids) => inFrame((ids) => ids.map((id) => { const r = document.querySelector(`[data-cms-id="${id}"]`).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, cx: r.left + r.width / 2 } }), ids)

try {
  await page.goto(`${BASE}/admin/pages`, { waitUntil: 'domcontentloaded' })
  await frame().locator('[data-cms-id="prelude.thesis"]').first().waitFor({ timeout: 90000 })
  await sleep(1500)

  /* 1 — sections */
  await page.getByRole('tab', { name: 'Sections' }).click()
  page.once('dialog', (d) => d.accept('QA section'))
  await page.getByRole('button', { name: '+ Add a section' }).click()
  await frame().locator('[data-chapter="custom-1"]').waitFor({ timeout: 30000 }).then(() => true, () => false).then((ok) => assert(ok, 'a new section is added to the real page', results))
  await page.locator('.pe-right input[aria-label="Title"]').fill('QA section renamed')
  await sleep(500)
  assert(await page.locator('.pe-item', { hasText: 'QA section renamed' }).count() === 1, 'renaming it in the inspector updates the sections list', results)
  const order = () => page.evaluate(() => [...document.querySelectorAll('.pe-list .pe-item .pe-item-text')].map((e) => e.firstChild.textContent))
  const before = await order()
  const i = before.indexOf('QA section renamed')
  await page.getByRole('button', { name: 'Move QA section renamed up' }).click()
  await sleep(400)
  const after = await order()
  assert(after.indexOf('QA section renamed') === i - 1, `moving it up reorders the sections (${i} → ${after.indexOf('QA section renamed')})`, results)
  const domOrder = await inFrame(() => [...document.querySelectorAll('[data-chapter]')].map((c) => c.dataset.chapter))
  assert(domOrder.indexOf('custom-1') === i - 1, `the page renders the new order (${domOrder.join(',')})`, results)
  await page.getByRole('button', { name: 'Hide QA section renamed' }).click()
  await sleep(800)
  assert(!(await inFrame(() => !!document.querySelector('[data-chapter="custom-1"]'))), 'hiding a section removes it from the page', results)
  await page.getByRole('button', { name: 'Show QA section renamed' }).click()
  await sleep(800)
  assert(await inFrame(() => !!document.querySelector('[data-chapter="custom-1"]')), 'showing it brings it back', results)

  /* 2 — drag from the Insert panel onto the new section */
  await page.locator('.pe-list .pe-item', { hasText: 'QA section renamed' }).locator('.pe-item-main').click()
  await sleep(1200)
  await page.getByRole('tab', { name: 'Insert' }).click()
  const tile = page.locator('.pe-tile', { hasText: 'Heading' })
  const box = await frameEl().boundingBox()
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
  await tile.dispatchEvent('dragstart', { dataTransfer })
  // The drop lands at a point inside the frame: dispatch the frame-side events with the same payload.
  const payload = await dataTransfer.evaluate((dt) => dt.getData('application/x-cms'))
  const dropped = await frameEl().evaluate((f, payload) => {
    const w = f.contentWindow, d = f.contentDocument
    // An empty slot has no box; the bridge measures the stage that holds it.
    const stage = d.querySelector('[data-chapter="custom-1"] [data-cms-slot]').parentElement
    const r = stage.getBoundingClientRect()
    const x = r.left + r.width * 0.3, y = r.top + r.height * 0.4
    const dt = new w.DataTransfer()
    dt.setData('application/x-cms', payload)
    const target = d.elementFromPoint(x, y) ?? d.body
    target.dispatchEvent(new w.DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }))
    target.dispatchEvent(new w.DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }))
    return { x, y }
  }, payload)
  void box; void dropped
  await sleep(1200)
  const anchored = await inFrame(() => { const el = document.querySelector('[data-chapter="custom-1"] [data-cms-added][data-cms-kind="heading"]'); if (!el) return null; const s = el.closest('[data-cms-slot]').getBoundingClientRect(); const r = el.getBoundingClientRect(); return { anchored: el.dataset.cmsAnchored, dx: (r.left - s.left) / s.width, dy: (r.top - s.top) / s.height } })
  assert(anchored?.anchored === 'true' && Math.abs(anchored.dx - 0.3) < 0.03 && Math.abs(anchored.dy - 0.4) < 0.03, `a dropped heading is anchored where it was dropped (${JSON.stringify(anchored)})`, results)

  /* 3 — three elements to align and distribute */
  for (const t of ['Paragraph', 'Button']) { await page.locator('.pe-tile', { hasText: t }).click(); await sleep(700) }
  const ids = await inFrame(() => [...document.querySelectorAll('[data-chapter="custom-1"] [data-cms-added]')].map((e) => e.dataset.cmsId))
  assert(ids.length === 3, `three elements in the new section (${ids.length})`, results)
  await page.evaluate((ids) => window.__pageEditor.getState().select(ids), ids)
  await sleep(400)
  await page.getByRole('button', { name: 'Align left edges' }).click()
  await sleep(800)
  const al = await rects(ids)
  assert(Math.max(...al.map((r) => r.l)) - Math.min(...al.map((r) => r.l)) < 1, `align left lines up their left edges (${al.map((r) => r.l.toFixed(1)).join(', ')})`, results)
  await page.getByRole('button', { name: 'Align horizontal centres' }).click()
  await sleep(800)
  const ac = await rects(ids)
  assert(Math.max(...ac.map((r) => r.cx)) - Math.min(...ac.map((r) => r.cx)) < 1, `align centres lines up their centres (${ac.map((r) => r.cx.toFixed(1)).join(', ')})`, results)
  await page.getByRole('button', { name: 'Distribute vertically' }).click()
  await sleep(800)
  const dv = (await rects(ids)).sort((a, b) => a.t - b.t)
  const gaps = [dv[1].t - dv[0].b, dv[2].t - dv[1].b]
  assert(Math.abs(gaps[0] - gaps[1]) < 1.5, `distribute makes the vertical gaps equal (${gaps.map((g) => g.toFixed(1)).join(', ')})`, results)

  /* 4 — copy and paste */
  await page.evaluate((id) => window.__pageEditor.getState().select([id]), ids[1])
  await page.mouse.click(5, 980)
  await page.keyboard.press('Meta+c')
  await page.keyboard.press('Meta+v')
  await sleep(900)
  const count = await inFrame(() => document.querySelectorAll('[data-chapter="custom-1"] [data-cms-added]').length)
  assert(count === 4, `copy and paste adds a copy (${count})`, results)

  /* 5 — reorder in Layers (drag the last added element before the first) */
  await page.getByRole('tab', { name: 'Layers' }).click()
  await page.locator('.pe-tree-head', { hasText: 'QA SECTION RENAMED' }).or(page.locator('.pe-tree-head', { hasText: 'QA section renamed' })).first().waitFor()
  const flowIds = await inFrame(() => [...document.querySelectorAll('[data-chapter="custom-1"] [data-cms-slot] > [data-cms-added]')].map((e) => e.dataset.cmsId))
  const rows = page.locator('.pe-tree-section', { has: page.locator('.pe-tree-head', { hasText: /QA section renamed/i }) }).locator('.pe-item:has(.pe-grip)')
  const n = await rows.count()
  const lastId = await page.evaluate(() => { const l = window.__siteStore.getState().doc.additions['custom-1']; return l[l.length - 1].id })
  await rows.nth(n - 1).locator('.pe-grip').dragTo(rows.nth(0), { targetPosition: { x: 30, y: 8 } })
  await sleep(900)
  const flowAfter = await inFrame(() => [...document.querySelectorAll('[data-chapter="custom-1"] [data-cms-slot] > [data-cms-added]')].map((e) => e.dataset.cmsId))
  assert(flowAfter[0] === lastId && flowAfter.join() !== flowIds.join(), `dragging a layer reorders the elements on the page (${flowIds.join(',')} → ${flowAfter.join(',')})`, results)

  /* 6 — delete the custom section */
  await page.getByRole('tab', { name: 'Sections' }).click()
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Delete QA section renamed' }).click()
  await sleep(900)
  assert(!(await inFrame(() => !!document.querySelector('[data-chapter="custom-1"]'))), 'deleting the section removes it and its elements', results)

  /* 7 — preview mode and the transition test */
  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  await sleep(4000)
  assert(await inFrame(() => !document.querySelector('[data-cms-overlay]')), 'Preview loads the page without the selection layer', results)
  const adminUrl = page.url()
  await inFrame(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await sleep(2500)
  const fbox = await frameEl().boundingBox()
  for (let i = 0; i < 60; i++) { await page.mouse.move(fbox.x + fbox.width / 2, fbox.y + fbox.height / 2); await page.mouse.wheel(0, 120); await sleep(25) }
  await sleep(1500)
  const phasePreview = await inFrame(() => document.documentElement.dataset.worldPhase ?? 'HOME')
  assert(phasePreview === 'HOME' && page.url() === adminUrl, `scrolling past the end in Preview does not start the transition (${phasePreview})`, results)
  await page.getByRole('button', { name: 'Test transition' }).click()
  await page.getByText('Transition test.').waitFor()
  await sleep(5000)
  await inFrame(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await sleep(2600)
  let phase = 'HOME'
  for (let i = 0; i < 260 && phase === 'HOME'; i++) {
    await page.mouse.move(fbox.x + fbox.width / 2, fbox.y + fbox.height / 2)
    await page.mouse.wheel(0, 120)
    await sleep(25)
    phase = await inFrame(() => document.documentElement.dataset.worldPhase ?? 'HOME').catch(() => phase)
  }
  assert(phase !== 'HOME', `in Test transition the push starts the leaf transition (${phase})`, results)
  const reached = await page.waitForFunction(() => {
    const f = document.querySelector('iframe[title^="Draft preview"]')
    return f?.contentDocument?.documentElement.dataset.worldPhase === 'IN_WORLD'
  }, null, { timeout: 240000 }).then(() => true, () => false)
  const framePath = await frameEl().evaluate((f) => f.contentWindow.location.pathname)
  assert(reached && framePath === '/world', `the world opens inside the frame (${framePath})`, results)
  assert(page.url() === adminUrl, `the admin never left the editor (${page.url()})`, results)
  await page.screenshot({ path: out('transition-in-editor.png') }).catch(() => {})
  await page.getByRole('button', { name: 'End test' }).click()
  await frame().locator('[data-cms-id="prelude.thesis"]').first().waitFor({ timeout: 60000 })
  assert(true, 'ending the test returns to editing the page', results)
} finally {
  const head = (await adminFetch(page, '/api/admin/site')).body.head
  // Nothing in this run was saved; make sure of it.
  const draftNow = (await adminFetch(page, '/api/admin/site')).body.doc
  if (JSON.stringify(draftNow) !== JSON.stringify(original)) await adminFetch(page, '/api/admin/site/draft', { method: 'PUT', json: { base: head.draft?.id ?? null, doc: original, message: 'QA: structure run restored' } })
}
assert(errors.length === 0, `no console errors in the admin (${errors.slice(0, 3).join(' | ')})`, results)
await context.close()
await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
