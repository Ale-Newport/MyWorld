/* The world studio shows the same map (WorldAtlas), without travel. Unchanged by the visitor map's new framing and opening:
   it opens, frames the island, shows the editor's places as plain markers, and photographs the world again after an edit (the editor
   changes the world between openings, so the kept photograph would be stale).
   The studio page is served from its template with an empty config, no admin session needed (as world-studio-drive.mjs).
   Usage:  QA_OUT=.qa/runs/impl/map/studio node scripts/qa/world-map-studio.mjs */
import { BASE, launch, out, sleep, assert, finish, watch } from './lib.mjs'

const results = []
const html = (await import(new URL('../../src/server/world-studio/studio-template.ts', import.meta.url))).STUDIO_HTML.replace('<!--CONFIG-->', '<script>window.ARCHIPELAGO_CONFIG={}</script>')
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = watch(page)
await page.route(`${BASE}/archipelago/preview/studio-qa.html`, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }))
await page.goto(`${BASE}/archipelago/preview/studio-qa.html`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 240_000 })
await page.locator('#edit').click()
await sleep(1000)
const state = () => page.evaluate(async () => {
  const A = globalThis.__archipelago, a = A.atlas, f = (await import('/archipelago/preview/world-bounds.js')).landFootprint(A.root), [x0, y0] = a.toScreen(f.minX, f.minZ), [x1, y1] = a.toScreen(f.maxX, f.maxZ), cs = getComputedStyle(a.scrim)
  return { open: !a.dialog.hidden, state: a.photo?.state, photo: a.photo && a.photo.bounds.minX, dx: ((x0 + x1) / 2 - a.sw / 2) / a.sw * 100, dy: ((y0 + y1) / 2 - a.sh / 2) / a.sh * 100, pins: document.querySelectorAll('.atlas-pin').length, buttons: document.querySelectorAll('button.atlas-pin').length, scrim: cs.display, dialog: (() => { const r = a.dialog.getBoundingClientRect(); return [r.width, r.height] })() }
})
const open = async () => { await page.locator('#world-map').click(); await page.waitForFunction(() => globalThis.__archipelago.atlas.photo?.state === 'sharp' && !globalThis.__archipelago.atlas.dialog.hidden, null, { timeout: 60_000 }); await sleep(300) }
await open()
const first = await state()
await page.screenshot({ path: out('studio-map.png') })
assert(first.open && first.pins > 10 && first.buttons === 0, `the studio's map opens with plain markers and no travel (${first.pins} markers, ${first.buttons} buttons)`, results)
assert(Math.abs(first.dx) <= 1 && first.dy <= -.5 && first.dy >= -2.5, `the island is framed the same way (${first.dx.toFixed(2)} % / ${first.dy.toFixed(2)} %)`, results)
assert(first.scrim === 'none' && Math.abs(first.dialog[0] - 1440) < 2, `the studio's full-screen map needs no scrim (scrim display ${first.scrim}, dialog ${first.dialog.map(Math.round).join('x')})`, results)
await page.keyboard.press('Escape'); await sleep(200)
// Close, change the world through the scene (move an experience group), open again: the photograph is taken again and the marker follows the group.
const before = await page.evaluate(() => { const A = globalThis.__archipelago, a = A.atlas; globalThis.__oldPhoto = a.photo; const m = a.markers.places.find((p) => p.kind === 'experience' && p.group); return { name: m.name, x: m.x } })
await page.evaluate((name) => { const A = globalThis.__archipelago; A.root.traverse((n) => { if (n.userData.worldExperience && !n.__moved && (n.userData.mapLabel ?? n.name).startsWith(name)) { n.position.x += 24; n.__moved = true } }) }, before.name)
await open()
const second = await state()
const after = await page.evaluate((name) => { const a = globalThis.__archipelago.atlas; return { fresh: a.photo !== globalThis.__oldPhoto, x: a.markers.places.find((p) => p.name === name)?.x } }, before.name)
assert(second.state === 'sharp' && after.fresh, `after the editor changed the world the map photographs it again (new photograph: ${after.fresh})`, results)
assert(after.x !== undefined && Math.abs(after.x - before.x) > 5, `and the marker followed the moved group ("${before.name}" x ${before.x.toFixed(1)} → ${after.x?.toFixed(1)})`, results)
await page.screenshot({ path: out('studio-map-after-edit.png') })
await page.keyboard.press('Escape')
assert(errors.length === 0, `no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
await browser.close()
finish(results)
