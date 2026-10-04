/* World editor end to end: move a whole experience group in the studio, save a
   draft (public /world unchanged), publish (public /world and its map change),
   then put it back. Runs against the local dev store. */
import { launch, out, sleep, assert, finish, BASE } from './lib.mjs'
import { signIn } from './admin-session.mjs'
const results = []
const browser = await launch()
const { page } = await signIn(browser)
const studio = () => page.evaluateHandle(() => document.querySelector('iframe[title="World studio"]').contentWindow)
const openStudio = async () => {
  await page.goto(`${BASE}/admin/world`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelector('iframe[title="World studio"]')?.contentDocument?.body?.dataset.ready === 'true', null, { timeout: 240000 })
  await sleep(800)
}
const GROUP = 'Ice Rink Complete'
const groupPosition = async (win) => page.evaluate(([w, name]) => { const A = w.__archipelago; let g; A.root.traverse((n) => { if (!g && n.userData.worldExperience && n.name === name) g = n }); return g ? g.position.toArray() : null }, [win, GROUP])
const publicRelease = () => fetch(`${BASE}/api/world/release`).then((r) => r.json())

await openStudio()
let win = await studio()
const before = await groupPosition(win)
const releaseBefore = await publicRelease()
assert(!!before, `found the “${GROUP}” group in the studio at ${before?.map((v) => v.toFixed(2))}`, results)

// Move the whole group 6 m east, as the editor's own transform does (one undoable change).
const moved = await page.evaluate(([w, name]) => {
  const A = w.__archipelago, e = A.editor
  let g; A.root.traverse((n) => { if (!g && n.userData.worldExperience && n.name === name) g = n })
  const children = []; g.traverse((n) => { if (n !== g && n.userData.pushable) children.push([n.name, n.getWorldPosition(new A.THREE.Vector3()).toArray()]) })
  e.select([g]); e.startChange(); g.position.x += 6; g.updateMatrixWorld(true); e.endChange()
  const after = []; g.traverse((n) => { if (n !== g && n.userData.pushable) after.push([n.name, n.getWorldPosition(new A.THREE.Vector3()).toArray()]) })
  return { pos: g.position.toArray(), kept: children.every(([, p], i) => Math.abs(after[i][1][0] - p[0] - 6) < 1e-6 && Math.abs(after[i][1][2] - p[2]) < 1e-6), pieces: children.length, undo: e.undoStack?.length ?? e.history?.length ?? null }
}, [win, GROUP])
assert(Math.abs(moved.pos[0] - before[0] - 6) < 1e-6, `group moved 6 m east (${moved.pos.map((v) => v.toFixed(2))})`, results)
assert(moved.kept && moved.pieces > 0, `its ${moved.pieces} pushable props moved with it, relative transforms kept`, results)

// Save a draft through the admin bar.
await page.click('button:has-text("Save draft")')
await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /saved/i.test(t.textContent)), null, { timeout: 180000 })
const releaseAfterSave = await publicRelease()
assert(releaseAfterSave.world.sha === releaseBefore.world.sha, 'saving a draft leaves the public /world unchanged', results)
assert(await page.waitForFunction(() => !document.querySelector('header button.btn-accent')?.disabled, null, { timeout: 30000 }).then(() => true, () => false), 'the bar offers to publish the new draft', results)

// Publish.
await page.click('button:has-text("Publish world")')
await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Published/.test(t.textContent)), null, { timeout: 180000 })
const releasePublished = await publicRelease()
assert(releasePublished.world.sha !== releaseBefore.world.sha && releasePublished.revision, `publishing switched the public world (${releasePublished.world.sha.slice(0, 10)}…)`, results)

// The public player now builds the moved group, and the map marks it there.
const player = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await player.goto(`${BASE}/archipelago/preview/index.html`, { waitUntil: 'domcontentloaded' })
await player.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 240000 })
const live = await player.evaluate((name) => { const A = globalThis.__archipelago; let g; A.root.traverse((n) => { if (!g && n.userData.worldExperience && n.name === name) g = n }); return g.position.toArray() }, GROUP)
assert(Math.abs(live[0] - before[0] - 6) < 1e-4, `/world builds the group at its published position (${live.map((v) => v.toFixed(2))})`, results)
await player.keyboard.press('KeyM'); await sleep(600)
const pin = await player.evaluate(() => [...document.querySelectorAll('.atlas-pin')].find((p) => /Ice Rink/.test(p.textContent))?.getBoundingClientRect().x)
await player.screenshot({ path: out('e2e-map-after-publish.png') })
assert(typeof pin === 'number', 'the map shows the moved group from the published scene', results)
await player.close()

// Put it back: undo in a fresh studio session, save, publish.
await openStudio()
win = await studio()
await page.evaluate(([w, name]) => { const A = w.__archipelago, e = A.editor; let g; A.root.traverse((n) => { if (!g && n.userData.worldExperience && n.name === name) g = n }); e.select([g]); e.startChange(); g.position.x -= 6; g.updateMatrixWorld(true); e.endChange() }, [win, GROUP])
await page.click('button:has-text("Save draft")')
await page.waitForFunction(() => [...document.querySelectorAll('.toast')].filter((t) => /saved/i.test(t.textContent)).length > 0, null, { timeout: 180000 })
await sleep(500)
await page.click('button:has-text("Publish world")')
await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Published/.test(t.textContent)), null, { timeout: 180000 })
const restored = await groupPosition(win)
assert(Math.abs(restored[0] - before[0]) < 1e-6, 'moved back and republished', results)
await browser.close()
finish(results)
