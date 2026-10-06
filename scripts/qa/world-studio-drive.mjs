/* The world studio's drive spawn and recovery anchors, without an admin
   session: the studio page is served from its template (src/server/
   world-studio/studio-template.ts) with an empty config, so it edits the published
   world in memory and nothing is saved. Checks: "Show recovery anchors" draws
   the anchors for the edited world; "Set drive spawn here" validates, pins
   worldVariant.spawn (spawnPinned, spawnHeading) as an undoable edit and is
   refused on water; DRIVE with nothing selected starts at the pin, a selection
   still wins; leaving DRIVE lets a held SPACE go; undo and "Use the plaza"
   return the drive to the Central Plaza; validation reports the spawn.
   QA_BASE=http://localhost:3404 node scripts/qa/world-studio-drive.mjs */
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
await sleep(1200)
const status = () => page.evaluate(() => document.querySelector('#drive-spawn-status').textContent)
const variant = () => page.evaluate(() => ({ ...globalThis.__archipelago.root.userData.worldVariant }))
const anchorsDrawn = () => page.waitForFunction(() => /\d+ recovery anchors\./.test(document.querySelector('#drive-spawn-status').textContent), null, { timeout: 60_000 })
const drive = async () => { await page.locator('#drive').click(); await page.waitForFunction(() => globalThis.__archipelago.mode === 'drive'); await sleep(1200); return page.evaluate(() => { const d = globalThis.__archipelago.driving; return { source: d.home.source, x: d.vehicle.position.x, z: d.vehicle.position.z } }) }
const edit = async () => { await page.keyboard.press('Escape'); await page.waitForFunction(() => globalThis.__archipelago.mode === 'edit'); await sleep(500) }
const lookAt = (x, z) => page.evaluate(([x, z]) => { const A = globalThis.__archipelago; A.editor.select([]); A.editor.orbit.target.set(x, 0, z) }, [x, z])

assert(await page.evaluate(() => !document.body.dataset.player && globalThis.__archipelago.mode === 'edit'), 'the studio runs the editor', results)
assert(/Central Plaza/.test(await status()), `the drive spawn is automatic in the plaza (“${await status()}”)`, results)
// The editor's map shows the same places, but there is no car to travel with: plain markers, no travel.
await page.locator('#world-map').click()
await page.waitForFunction(() => !document.querySelector('.atlas').hidden)
const editorMap = await page.evaluate(() => ({ buttons: document.querySelectorAll('button.atlas-pin').length, pins: document.querySelectorAll('.atlas-pin').length, eyebrow: document.querySelector('.atlas-eyebrow').textContent }))
assert(editorMap.pins > 10 && editorMap.buttons === 0 && !/travel/i.test(editorMap.eyebrow), `outside DRIVE the map offers no travel (${editorMap.pins} markers, ${editorMap.buttons} buttons)`, results)
await page.keyboard.press('Escape')
await sleep(300)

/* ---- recovery anchors ---- */
await page.locator('#drive-properties summary').click()
await page.locator('#show-recovery-anchors').check()
await anchorsDrawn()
const drawn = await page.evaluate(() => { const g = globalThis.__archipelago.scene.getObjectByName('Drive spawn and recovery anchors'); return { dots: g?.getObjectByName('Recovery anchors')?.geometry.attributes.position.count ?? 0, spawn: !!g?.getObjectByName('Drive spawn'), editorOnly: !!g?.userData.editorOnly, inRoot: !!globalThis.__archipelago.root.getObjectByName('Drive spawn and recovery anchors') } })
assert(drawn.dots > 100 && drawn.spawn && drawn.editorOnly && !drawn.inRoot, `“Show recovery anchors” draws ${drawn.dots} anchors and the spawn, outside the saved world`, results)
await page.screenshot({ path: out('studio-recovery-anchors.png') })

/* ---- Set drive spawn here ---- */
await lookAt(-150, 0)
await page.locator('#set-drive-spawn').click()
await sleep(400)
assert(!(await variant()).spawnPinned && /No valid drive spawn/.test(await page.evaluate(() => document.querySelector('#notice').textContent)), 'over the sea, “Set drive spawn here” is refused with a reason', results)
await lookAt(-60, 62)
await page.locator('#set-drive-spawn').click()
await sleep(400)
const pinned = await variant()
assert(pinned.spawnPinned === true && Array.isArray(pinned.spawn) && pinned.spawn.length === 3 && Math.hypot(pinned.spawn[0] + 60, -pinned.spawn[1] - 62) < 10 && Number.isFinite(pinned.spawnHeading), `on open ground it pins worldVariant.spawn [x, north, height] with a heading (${JSON.stringify(pinned.spawn)}, ${pinned.spawnHeading})`, results)
assert(await page.evaluate(() => !document.querySelector('#undo').disabled && !document.querySelector('#clear-drive-spawn').disabled), 'as an undoable edit, and “Use the plaza” is offered', results)
await anchorsDrawn()
await page.screenshot({ path: out('studio-drive-spawn-pinned.png') })

/* ---- DRIVE: the pin, then a selection ---- */
let car = await drive()
assert(car.source === 'pinned' && Math.hypot(car.x - pinned.spawn[0], car.z + pinned.spawn[1]) < 8.5, `DRIVE with nothing selected starts at the pinned spawn (${car.x.toFixed(1)}, ${car.z.toFixed(1)}; validated again with every prop)`, results)
assert(await page.evaluate(() => !globalThis.__archipelago.scene.getObjectByName('Drive spawn and recovery anchors')), 'the anchors are not drawn while driving', results)
await page.keyboard.down('Space'); await sleep(1300)
const raised = await page.evaluate(() => globalThis.__archipelago.driving.jump.extended)
await edit()
await page.keyboard.up('Space')
assert(raised && await page.evaluate(() => globalThis.__archipelago.mode === 'edit' && !globalThis.__archipelago.driving), 'leaving DRIVE with SPACE held lets it go (the drive is torn down)', results)
await anchorsDrawn()
assert(await page.evaluate(() => !!globalThis.__archipelago.scene.getObjectByName('Drive spawn and recovery anchors')), 'back in the editor the anchors are drawn again', results)
await page.evaluate(() => { const A = globalThis.__archipelago; A.editor.select([A.editor.experiences.get('experience:central-plaza')]) })
car = await drive()
assert(car.source === 'selection', `DRIVE with something selected still starts at the selection (${car.source})`, results)
await page.keyboard.down('Space'); await sleep(300)
await page.keyboard.press('KeyR')
await sleep(300)
await page.keyboard.up('Space')
assert(await page.evaluate(() => { const d = globalThis.__archipelago.driving; return !d.jump.extended && d.player.suspensions.every((s) => s === 'low') }), 'R in the studio drive puts the wheels down', results)
await edit()

/* ---- undo, “Use the plaza”, validation ---- */
await page.locator('#undo').click()
await sleep(500)
assert(!(await variant()).spawnPinned, 'undo removes the pin', results)
await page.locator('#redo').click()
await sleep(500)
assert((await variant()).spawnPinned === true, 'redo restores it', results)
await page.locator('#clear-drive-spawn').click()
await anchorsDrawn()
assert(!(await variant()).spawnPinned && /Central Plaza/.test(await status()), `“Use the plaza” unpins it (“${await status()}”)`, results)
await page.evaluate(() => globalThis.__archipelago.editor.select([]))
car = await drive()
assert(car.source === 'plaza', `and DRIVE starts in the plaza again (${car.source})`, results)
await edit()
await page.locator('#validate-world').click()
await page.waitForFunction(() => document.querySelector('#validation-dialog').open, null, { timeout: 30_000 })
const spawnIssues = await page.evaluate(() => [...document.querySelectorAll('#validation-list button')].map((b) => b.textContent).filter((t) => /Drive spawn/.test(t)))
assert(spawnIssues.length === 0, `validation finds nothing wrong with the drive spawn (${spawnIssues.join(' | ')})`, results)
await page.locator('#close-validation').click()
assert(errors.length === 0, `no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
await browser.close()
finish(results)
