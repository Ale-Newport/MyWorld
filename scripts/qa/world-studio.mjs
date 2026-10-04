/* /admin/world: HelloWorld's editor boots on the draft world inside the admin. */
import { launch, out, sleep, assert, finish } from './lib.mjs'
import { signIn } from './admin-session.mjs'
const results = []
const browser = await launch()
const { page } = await signIn(browser, { viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)) })
await page.goto('http://localhost:3210/admin/world', { waitUntil: 'domcontentloaded' })
const frame = page.frameLocator('iframe[title="World studio"]')
await page.waitForFunction(() => document.querySelector('iframe[title="World studio"]')?.contentDocument?.body?.dataset.ready === 'true', null, { timeout: 240000 })
await sleep(1500)
await page.screenshot({ path: out('studio-map.png') })
const state = await page.evaluate(() => { const w = document.querySelector('iframe[title="World studio"]').contentWindow; const A = w.__archipelago; return { mode: A?.mode, player: w.document.body.dataset.player ?? null, objects: A?.editor?.registry.size, groups: A?.editor?.experiences?.list().length } })
assert(state.player === null && state.mode === 'edit', `studio runs the editor, not the player (${JSON.stringify(state)})`, results)
assert(state.objects > 1000 && state.groups > 10, `the real Archipelago is loaded (${state.objects} objects, ${state.groups} experience groups)`, results)
await frame.locator('#edit').click()
await sleep(2500)
await page.screenshot({ path: out('studio-3d.png') })
assert(errors.length === 0, `no errors (${errors.slice(0, 3).join(' | ')})`, results)
await browser.close()
finish(results)
