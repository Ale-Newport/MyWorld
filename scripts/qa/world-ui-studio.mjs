/* The world studio keeps its own HUD behaviour: the visitor's HUD work (per-frame writes, the dialog count, the cached canvas rect,
   the disabled gizmo) must not change what the editor does.

   Served from the studio template with an empty config, as world-studio-drive.mjs (no admin session):
   - the editor's gizmo is enabled in the studio and disabled only for the visitor's player;
   - the footer's FPS / calls readout and, while driving, the speed, mode, surface and viewport label still update (twice a second);
   - the interact button and the activity HUD still follow a prompt (their text is the same line, in the same element);
   - the validation dialog pauses the frame loop while it is open and the loop resumes when it closes (the dialog count);
   - the viewport follows the window: the drive's view is re-measured when the studio's canvas changes size.

     QA_BASE=http://localhost:3210 node scripts/qa/world-ui-studio.mjs */
import { BASE, launch, sleep, assert, finish, watch } from './lib.mjs'
const results = []
const html = (await import(new URL('../../src/server/world-studio/studio-template.ts', import.meta.url))).STUDIO_HTML.replace('<!--CONFIG-->', '<script>window.ARCHIPELAGO_CONFIG={}</script>')
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = watch(page)
await page.route(`${BASE}/archipelago/preview/studio-qa.html`, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }))
await page.goto(`${BASE}/archipelago/preview/studio-qa.html`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 240_000 })
await page.locator('#edit').click()
await sleep(1200)

const gizmo = await page.evaluate(() => globalThis.__archipelago.editor.gizmo.enabled)
assert(gizmo === true, `the studio's gizmo is enabled (${gizmo})`, results)
const fps = await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 1300)); return document.querySelector('#performance').textContent })
assert(/^\d+ FPS · \d+ calls$/.test(fps), `the footer shows FPS and calls in the editor (“${fps}”)`, results)

// Validation: a modal dialog pauses the frame loop, closing it resumes it.
const frames = () => page.evaluate(() => globalThis.__archipelago.renderer.info.render.frame)
await page.locator('#validate-world').click()
await page.waitForFunction(() => document.querySelector('#validation-dialog').open, null, { timeout: 30_000 })
await sleep(400)
const open0 = await frames(); await sleep(600); const open1 = await frames()
// One stray draw can come from a render that is not the frame loop's (it happens on the unchanged studio too); the loop would draw ~36 in 600 ms.
assert(open1 - open0 <= 1, `the frame loop is paused while the validation dialog is open (${open0} -> ${open1})`, results)
await page.locator('#close-validation').click()
await sleep(400)
const closed0 = await frames(); await sleep(600); const closed1 = await frames()
assert(closed1 - closed0 > 10, `and frames are drawn again once it is closed (${closed0} -> ${closed1})`, results)

// Drive: the diagnostics.
await page.locator('#drive').click()
await page.waitForFunction(() => globalThis.__archipelago.mode === 'drive')
await sleep(1500)
await page.evaluate(() => { const A = globalThis.__archipelago; A.driving.vehicle.moveTo({ x: -47, y: A.editor.terrainHeightAt(-47, 18) + 1.3, z: 18 }, 0) })
await sleep(800)
const seen = new Set()
await page.keyboard.down('KeyW')
for (let i = 0; i < 8; i++) { await sleep(300); seen.add(await page.evaluate(() => document.querySelector('#speed').textContent)) }
await page.keyboard.up('KeyW')
const diag = await page.evaluate(() => ({ mode: document.querySelector('#vehicle-mode').textContent, surface: document.querySelector('#surface').textContent, label: document.querySelector('#viewport-label').textContent, perf: document.querySelector('#performance').textContent }))
assert(seen.size >= 3, `the speed readout follows the car in the studio drive (${[...seen].join(', ')})`, results)
assert(diag.mode === 'CAR' && diag.surface.length > 0 && /CAR/.test(diag.label) && /FPS/.test(diag.perf), `mode, surface, viewport label and FPS are written (${JSON.stringify(diag)})`, results)

// The activity prompt reaches the HUD in the studio as well.
await page.evaluate(() => { const A = globalThis.__archipelago; A.driving.vehicle.moveTo({ x: -47, y: A.editor.terrainHeightAt(-47, -26.5) + 1.3, z: -26.5 }, 0) })
await page.waitForFunction(() => !document.querySelector('#interact-action').hidden, null, { timeout: 5000 })
const label = await page.evaluate(() => document.querySelector('#interact-action').textContent)
assert(/Start the infield slalom · E/.test(label), `the interact button offers the slalom (“${label}”)`, results)
await page.evaluate(() => { const A = globalThis.__archipelago; A.driving.vehicle.moveTo({ x: -47, y: A.editor.terrainHeightAt(-47, 18) + 1.3, z: 18 }, 0) })
await page.waitForFunction(() => document.querySelector('#interact-action').hidden, null, { timeout: 5000 })
assert(true, 'and goes when the prompt does', results)

// The view follows the window.
const size = (await page.evaluate(() => { const d = globalThis.__archipelago.driving; return [d.viewport.width, d.viewport.height] }))
await page.setViewportSize({ width: 1100, height: 700 })
await sleep(700)
const size2 = (await page.evaluate(() => { const d = globalThis.__archipelago.driving, c = document.querySelector('#world'); return [d.viewport.width, d.viewport.height, c.clientWidth, c.clientHeight] }))
assert(size2[0] === size2[2] && size2[1] === size2[3] && (size2[0] !== size[0] || size2[1] !== size[1]), `the drive's viewport followed the window (${size.join('x')} -> ${size2.slice(0, 2).join('x')}, canvas ${size2.slice(2).join('x')})`, results)

assert(errors.length === 0, `no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
await browser.close()
finish(results)
