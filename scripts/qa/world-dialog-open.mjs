/* /world housekeeping a visitor feels: the Achievements dialog opens at once, the console is clean, and a visitor's URL cannot switch the engine.

   1. The dialog is ready before it is asked for. Its rows (runtime/awards-list.js) exist as soon as the world is ready, before any click; opening
      writes nothing into them when nothing changed (no DOM mutation in the list), rewrites only the row of an award that was unlocked, and shows the
      dialog with the markup it always had.
   2. Its first layout is not the click's. The ✓ and ○ markers are in none of the page's fonts; the system looks a font up for the first layout that
      meets them (about 10 ms each). With ✓ and ○ rows both on screen, the first open of a fresh page spent 22-28 ms in layout before the rows were
      warmed under the loading cover (HEAD and the integrated build alike; 9-14 ms with one award unlocked), and the click took as long to reach the DOM
      (25-36 ms; perf-world's first dialog: 25-32 ms against 10 ms at HEAD). Warmed it spends about 1 ms; the check is median layout under 5 ms
      over --rounds fresh pages. The control (glyphs nothing has used) is printed to show the measure can see a lookup: it is not asserted.
   3. The console has no warning and no error while the player loads and the dialogs open: Rapier's "using deprecated parameters for the
      initialization function" came from the vendored library's own init call.
   4. A page on a public host (here visitor.test, resolved to the QA server) cannot put the engine in another mode: no window.__archipelago, no QA probe
      downloaded for ?perf, and runtime/qa-switches.js, asked from the page itself, answers false to every switch; on localhost the same URL switches them on.

     QA_BASE=http://localhost:3210 node scripts/qa/world-dialog-open.mjs [--rounds 3] [--out dir]  */
import fs from 'node:fs'
import path from 'node:path'
import { BASE, launch, openPlayer, assert, sleep, finish, watch } from './lib.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback }
const rounds = Number(arg('rounds', 3)), dir = path.resolve(arg('out', '.qa/runs/impl/hygiene-final'))
fs.mkdirSync(dir, { recursive: true })
const results = [], report = { base: BASE }
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
const ALL = 'shadow=legacy&fps=uncapped&freeze=off&terrain=whole&ferris=meshes&surfaces=legacy'
const GPU = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
const port = new URL(BASE).port || '80'

const browser = await launch({ args: [...GPU, '--host-resolver-rules=MAP visitor.test 127.0.0.1'] })

/* ---- 1 and 3: the rows before the click, what opening writes, the console ---- */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = watch(page), warnings = []
  page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text().slice(0, 200)) })
  await openPlayer(page)
  await sleep(800)
  const rowsNow = () => page.evaluate(() => {
    const a = globalThis.__archipelago.gameplay.achievements, view = a.view(), rows = [...document.querySelectorAll('#awards-list > p')]
    return { n: view.length, rows: rows.length, text: rows.map((r) => r.textContent), want: view.map((v) => (v.unlocked ? '✓ ' : '○ ') + v.title + v.description + ' · ' + Math.min(v.progress, v.target) + ' / ' + v.target), shape: rows.every((r) => r.children.length === 2 && r.children[0].localName === 'strong' && r.children[1].localName === 'small'), dialogStyle: document.querySelector('#awards-dialog').getAttribute('style'), shown: getComputedStyle(document.querySelector('#awards-dialog')).display, open: document.querySelector('#awards-dialog').open }
  })
  const before = await rowsNow()
  assert(before.n >= 20 && before.rows === before.n && before.shape, `the ${before.n} rows are in the list as soon as the world is ready, before any click (${before.rows}), as <p><strong/><small/></p>`, results)
  assert(before.dialogStyle === null && before.shown === 'none' && !before.open, `the warm-up left the closed dialog untouched (style ${JSON.stringify(before.dialogStyle)}, display ${before.shown})`, results)
  // The first open brings the rows up to date (something may have ticked since the world was ready: the car starts on a place); after it they read as the dialog always did.
  await page.locator('#player-awards').click(); await sleep(150)
  await page.locator('#close-awards').click(); await sleep(250)
  const settled = await rowsNow()
  assert(settled.text.length === settled.n && settled.text.every((t, i) => t === settled.want[i]), 'after an open the rows read as the dialog always did: ✓ / ○ title, description · progress / target', results)

  const watchList = () => page.evaluate(() => {
    const list = document.querySelector('#awards-list'), rows = [...list.children]
    window.__records = []; window.__rows = rows
    window.__mo?.disconnect()
    window.__mo = new MutationObserver((rs) => { for (const r of rs) window.__records.push({ type: r.type, row: rows.findIndex((x) => x === r.target || x.contains(r.target)) }) })
    window.__mo.observe(list, { subtree: true, childList: true, characterData: true, attributes: true })
  })
  const result = () => page.evaluate(async () => { await new Promise((r) => setTimeout(r, 50)); const list = document.querySelector('#awards-list'); return { records: window.__records, same: [...list.children].every((c, i) => c === window.__rows[i]) && list.children.length === window.__rows.length, open: document.querySelector('#awards-dialog').open, first: list.children[0]?.textContent } })
  await watchList()
  await page.locator('#player-awards').click()
  const opened = await result()
  assert(opened.open && opened.records.length === 0 && opened.same, `opening with nothing new writes nothing into the list (${opened.records.length} mutations, same rows ${opened.same})`, results)
  await page.locator('#close-awards').click(); await sleep(200)

  const id = await page.evaluate(() => { const a = globalThis.__archipelago.gameplay.achievements, row = a.view().find((v) => !v.unlocked); a.unlock(row.id); return row.id })
  await watchList()
  await page.locator('#player-awards').click()
  const unlocked = await result()
  const rowsTouched = [...new Set(unlocked.records.map((r) => r.row))]
  assert(unlocked.open && unlocked.same && rowsTouched.length === 1 && unlocked.records.length <= 3 && rowsTouched[0] >= 0, `unlocking ${id} rewrites that row and no other (${unlocked.records.length} mutations, rows ${rowsTouched})`, results)
  const mark = await page.evaluate((id) => { const a = globalThis.__archipelago.gameplay.achievements, i = a.view().findIndex((v) => v.id === id); return document.querySelectorAll('#awards-list > p')[i].textContent.slice(0, 2) }, id)
  assert(mark === '✓ ', `and shows it as unlocked (${JSON.stringify(mark)})`, results)
  await page.screenshot({ path: path.join(dir, 'awards-dialog.png') })
  await page.locator('#close-awards').click(); await sleep(200)
  assert(errors.length === 0, `no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
  assert(warnings.length === 0, `no console warnings while the player loads and the dialog opens (${warnings.slice(0, 2).join(' | ')})`, results)
  report.consoleWarnings = warnings
  await page.close()
}

/* ---- 2: the first open of a fresh page, with both markers on screen ---- */
{
  const layouts = [], toDom = [], control = []
  for (let r = 0; r < rounds; r++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
    const page = await context.newPage(), cdp = await context.newCDPSession(page)
    await cdp.send('Performance.enable')
    await openPlayer(page)
    await sleep(2500)
    // Three awards unlocked: ✓ and ○ both in the list, the worst case for the first layout.
    await page.evaluate(() => { const a = globalThis.__archipelago.gameplay.achievements; for (const row of a.view().slice(0, 3)) a.unlock(row.id) })
    const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
    await page.evaluate(() => { window.__t = {}; addEventListener('click', (e) => { window.__t.click = e.timeStamp }, { capture: true, once: true }); const d = document.querySelector('#awards-dialog'); new MutationObserver((_, mo) => { if (d.open) { window.__t.dom = performance.now(); mo.disconnect() } }).observe(d, { attributes: true }) })
    const m0 = await metrics()
    await page.locator('#player-awards').click()
    await sleep(500)
    const m1 = await metrics()
    const t = await page.evaluate(() => window.__t)
    layouts.push((m1.LayoutDuration - m0.LayoutDuration) * 1000); toDom.push(t.dom - t.click)
    // The control: a glyph nothing has used. The same measurement must be able to see a font lookup (it costs milliseconds on a desktop OS; informative, not asserted).
    const c0 = await metrics()
    await page.evaluate(() => { const p = document.createElement('p'); p.innerHTML = '<strong>⌬ ☂ ⍟</strong>'; document.querySelector('#awards-list').append(p); void p.offsetHeight })
    control.push(((await metrics()).LayoutDuration - c0.LayoutDuration) * 1000)
    await context.close()
  }
  report.firstOpen = { layoutMs: layouts.map((v) => +v.toFixed(2)), clickToDomMs: toDom.map((v) => +v.toFixed(1)), unseenGlyphLayoutMs: control.map((v) => +v.toFixed(2)) }
  console.log(`first open, ✓ and ○ rows on screen: layout ${layouts.map((v) => v.toFixed(2)).join(' / ')} ms, click -> DOM ${toDom.map((v) => v.toFixed(1)).join(' / ')} ms; control (glyphs nothing has used) ${control.map((v) => v.toFixed(2)).join(' / ')} ms`)
  assert(median(layouts) < 5, `the first open of a fresh page spends ${median(layouts).toFixed(2)} ms in layout (median of ${rounds}; 22-28 ms before the warm-up, the marker font lookup in the click)`, results)
}

/* ---- 4: a visitor's URL ---- */
{
  const visit = async (host, query, label) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage(), errors = watch(page, `${label} `), probe = []
    page.on('request', (r) => { if (/perf-probe\.js/.test(r.url())) probe.push(r.url()) })
    await page.goto(`http://${host}:${port}/archipelago/preview/index.html?${query}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 180_000 })
    await sleep(500)
    const seen = await page.evaluate(async () => {
      const { qaSwitches } = await import('/archipelago/preview/runtime/qa-switches.js')
      return { handle: typeof globalThis.__archipelago, switches: Object.entries(qaSwitches()).filter(([, v]) => v).map(([k]) => k), host: location.hostname, qaOpened: Object.entries(qaSwitches('?qa&' + location.search.slice(1), location.hostname)).filter(([, v]) => v).length }
    })
    await context.close()
    return { ...seen, probe: probe.length, errors }
  }
  const visitor = await visit('visitor.test', ALL + '&perf', 'visitor')
  assert(visitor.host === 'visitor.test' && visitor.handle === 'undefined', `on a public host the QA handle is not there (window.__archipelago is ${visitor.handle})`, results)
  assert(visitor.switches.length === 0, `and none of the engine switches is on, with every one in the URL (${visitor.switches.join(', ') || 'none'})`, results)
  assert(visitor.probe === 0, `and ?perf downloads no QA probe (${visitor.probe} requests)`, results)
  assert(visitor.qaOpened >= 7, `the same URL with ?qa switches them on (${visitor.qaOpened} of them)`, results)
  assert(visitor.errors.length === 0, `the player runs there without errors (${visitor.errors.slice(0, 2).join(' | ')})`, results)
  const local = await visit('localhost', ALL + '&perf', 'localhost')
  assert(local.handle === 'object' && local.switches.length >= 7 && local.probe === 1, `on localhost the same URL switches them on (${local.switches.length} switches, handle ${local.handle}, probe requests ${local.probe})`, results)
  assert(local.errors.length === 0, `and the engine still runs in those modes without errors (${local.errors.slice(0, 2).join(' | ')})`, results)
  report.visitor = visitor; report.local = local
}

fs.writeFileSync(path.join(dir, 'world-dialog-open.json'), JSON.stringify(report, null, 2))
await browser.close()
finish(results)
