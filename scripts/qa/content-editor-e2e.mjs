/* The section-based content editor, end to end, against a running dev server
   (QA_BASE, default :3210) with the QA administrator (.data/qa-admin.json).

     node scripts/qa/content-editor-e2e.mjs

   Checks:
     · the editor offers pages → sections → text / animation, and has no
       layout tools (no layers, insert panel, drag or resize handles, rulers,
       style inspectors);
     · an edited text shows in the real-page preview at once, is not on the
       live site after saving a draft, and is after publishing;
     · each animated section offers exactly five options; choosing one
       changes the preview and, once published, the live page;
     · the Tech Toolbox's project counts and project names switch
       independently, a per-tool override wins over the section, and a hidden
       detail leaves no badge, line, list or label behind;
     · the admin API refuses writes without a session or without the CSRF token.
   Everything is restored and published back at the end. */
import { BASE, launch, assert, finish, sleep, watch, out } from './lib.mjs'
import { signIn, adminFetch } from './admin-session.mjs'

const results = []
const browser = await launch()
const { page } = await signIn(browser, { viewport: { width: 1440, height: 900 } })
const errors = watch(page, 'admin ')
const original = (await adminFetch(page, '/api/admin/site')).body.doc
const MARK = `QA ${Date.now().toString(36)}`

const frame = () => page.frameLocator('iframe[title^="Draft preview"]')
const visitorPage = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const p = await ctx.newPage()
  return { ctx, p }
}
const publish = async () => {
  await page.getByRole('button', { name: 'Publish' }).click()
  await page.getByText('Live site is up to date').waitFor({ timeout: 30000 })
}

try {
  await page.goto(`${BASE}/admin/pages`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Pages' }).waitFor()
  await page.locator('iframe[title^="Draft preview"]').waitFor()
  await sleep(2500)
  await page.screenshot({ path: out('content-editor/editor.png') })

  /* ---- no layout tools ---------------------------------------- */
  const layoutTools = await page.evaluate(() => {
    const text = document.body.innerText
    return {
      words: ['Layers', 'Insert', 'Align', 'Distribute', 'Breakpoint', 'Translate', 'Nudge'].filter((w) => new RegExp(`\\b${w}\\b`).test(text)),
      handles: document.querySelectorAll('[data-cms-overlay], .pe-root, [class*="resize"], [draggable="true"]').length,
    }
  })
  assert(layoutTools.words.length === 0 && layoutTools.handles === 0, `no layout tools in the editor (${layoutTools.words.join(', ') || 'none'}; ${layoutTools.handles} handles)`, results)
  const inFrameBridge = await frame().locator('[data-cms-overlay]').count()
  assert(inFrameBridge === 0, 'the preview is the public renderer, with no editing overlay inside it', results)

  /* ---- text: preview now, live only after publishing --------- */
  await page.getByRole('button', { name: /About/ }).first().click()
  const summary = page.getByLabel('Summary', { exact: true })
  await summary.fill(`${original.profile.summary} ${MARK}`)
  await frame().locator('#about-title').filter({ hasText: MARK }).first().waitFor({ timeout: 15000 })
  assert(true, 'the edited summary appears in the real-page preview before saving', results)
  await page.getByRole('button', { name: 'Save draft' }).click()
  await page.getByText('Draft differs from the live site').waitFor({ timeout: 30000 })
  let v = await visitorPage()
  await v.p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  assert(!(await v.p.content()).includes(MARK), 'a saved draft does not change the live page', results)
  await v.ctx.close()
  await publish()
  v = await visitorPage()
  await v.p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  assert((await v.p.content()).includes(MARK), 'after publishing, the live page has the new text', results)
  await v.ctx.close()

  /* ---- animations: five per section, chosen and published ---- */
  for (const [section, pick] of [['About', 'Typographic identity'], ['Project Universe', 'Dimensional gallery'], ['Contact', 'Ribbon aperture']]) {
    await page.getByRole('button', { name: new RegExp(section) }).first().click()
    const radios = page.getByRole('radiogroup', { name: 'Animation' }).getByRole('radio')
    assert((await radios.count()) === 5, `${section}: exactly five animation options`, results)
    await page.getByRole('radio', { name: new RegExp(pick) }).click()
    const id = { About: 'about.type-motion', 'Project Universe': 'universe.gallery', Contact: 'contact.ribbon-aperture' }[section]
    await frame().locator(`[data-section-animation="${id}"]`).waitFor({ timeout: 15000 })
    assert(true, `${section}: the preview switches to “${pick}”`, results)
    await page.getByLabel(/^Intensity/).fill('0.3')
  }
  await page.screenshot({ path: out('content-editor/animation.png') })
  await publish()
  v = await visitorPage()
  await v.p.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  const live = await v.p.evaluate(() => [...document.querySelectorAll('[data-section-animation]')].map((e) => e.getAttribute('data-section-animation')))
  assert(['about.type-motion', 'universe.gallery', 'contact.ribbon-aperture'].every((id) => live.includes(id)), `the published choices are live (${live.join(', ')})`, results)
  await v.ctx.close()

  /* ---- toolbox: counts and names, independent ----------------- */
  await page.getByRole('button', { name: /Tech Toolbox/ }).first().click()
  const counts = page.getByRole('switch', { name: 'Show project counts' })
  const names = page.getByRole('switch', { name: 'Show project names' })
  await counts.uncheck()
  await sleep(800)
  const tiles = frame().locator('[data-tech] button')
  const badgeCount = await frame().locator('[data-tech] button [class*="count"]').count()
  const label = await tiles.first().getAttribute('aria-label')
  assert(badgeCount === 0 && !/project/.test(label ?? ''), `counts off: no badges and no count in the labels (“${label}”)`, results)
  await tiles.first().hover()
  await sleep(400)
  const readout = await frame().locator('[data-room-reserve="7"]').innerText()
  assert(!/\d+ projects?|no public repository/i.test(readout) && readout.trim().length > 0, `counts off: the readout names the tool without a count (“${readout.trim().split('\n')[0]}”)`, results)
  const listShown = await frame().locator('[data-room-reserve="7"] ul li').count()
  assert(listShown > 0, `names on while counts are off: the project list is still shown (${listShown})`, results)
  await names.uncheck()
  await counts.check()
  await sleep(800)
  await tiles.first().hover()
  await sleep(400)
  const list2 = await frame().locator('[data-room-reserve="7"] ul li').count()
  const readout2 = await frame().locator('[data-room-reserve="7"]').innerText()
  assert(list2 === 0 && /\d+ projects?|no public repository/i.test(readout2), 'names off, counts on: a count and no list', results)
  // Per-tool override: Python shows its names even though the section hides them.
  await page.getByText('Per-technology overrides').click()
  await page.getByLabel('Find a technology').fill('Python')
  await page.getByRole('radiogroup', { name: 'Python: project names' }).getByRole('radio', { name: 'Show' }).click()
  await sleep(800)
  await frame().locator('[data-tech="python"] button').hover()
  await sleep(400)
  const pyList = await frame().locator('[data-room-reserve="7"] ul li').count()
  assert(pyList > 0, `a per-tool override wins over the section (Python lists ${pyList} projects)`, results)
  // Nothing else on the wall fades when one tool is hovered.
  const opacities = await frame().locator('[data-tech] button').evaluateAll((els) => els.map((e) => getComputedStyle(e).opacity))
  assert(opacities.every((o) => o === '1'), 'hovering one tool leaves every other tool fully visible', results)
  await page.screenshot({ path: out('content-editor/toolbox.png') })

  /* ---- authorisation ------------------------------------------ */
  const anon = await browser.newContext()
  const ap = await anon.newPage()
  await ap.goto(`${BASE}/admin/login`)
  const anonymous = await ap.evaluate(async () => (await fetch('/api/admin/site/draft', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })).status)
  assert(anonymous === 401, `a write without a session is refused (${anonymous})`, results)
  await anon.close()
  const noCsrf = await page.evaluate(async () => (await fetch('/api/admin/site/draft', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })).status)
  assert(noCsrf === 403, `a write without the CSRF token is refused (${noCsrf})`, results)
} finally {
  /* ---- restore -------------------------------------------------- */
  const now = (await adminFetch(page, '/api/admin/site')).body
  const restored = await adminFetch(page, '/api/admin/site/draft', { method: 'PUT', json: { base: now.head.draft.id, doc: original, message: 'QA: content editor run restored', force: true } })
  const pub = await adminFetch(page, '/api/admin/site/publish', { method: 'POST', json: {} })
  assert(restored.status === 200 && pub.status === 200, `content restored and published back (${restored.status}/${pub.status})`, results)
  assert(errors.length === 0, `no page errors in the admin (${errors.slice(0, 2).join(' | ')})`, results)
  await browser.close()
  finish(results)
}
