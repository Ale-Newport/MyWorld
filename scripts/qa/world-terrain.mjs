/* Terrain in the world studio: paint new land in open sea with the editor's own
   brush (Create land), test-drive on it — the car rests on the new ground, so it
   has a collider — then erase it (Erase land) and confirm the spot is sea again.
   Nothing is saved: the studio is closed without saving afterwards.
   node scripts/qa/world-terrain.mjs */
import { BASE, launch, sleep, assert, finish, out } from './lib.mjs'
import { signIn } from './admin-session.mjs'

const results = []
const browser = await launch()
const { page } = await signIn(browser)
page.on('dialog', (d) => d.accept())
await page.goto(`${BASE}/admin/world`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => document.querySelector('iframe[title="World studio"]')?.contentDocument?.body?.dataset.ready === 'true', null, { timeout: 240000 })
await sleep(800)
const win = await page.evaluateHandle(() => document.querySelector('iframe[title="World studio"]').contentWindow)
const AT = { x: 132, z: 40 }

const before = await page.evaluate(([w, AT]) => { const A = w.__archipelago; return { ground: A.editor.terrainHeightAt(AT.x, AT.z), sea: A.root.userData.seaLevel } }, [win, AT])
console.log('before', before)

const painted = await page.evaluate(async ([w, AT]) => {
  const A = w.__archipelago, e = A.editor, THREE = A.THREE
  const { paintLand } = await w.eval("import('/archipelago/preview/land-builder.js')")
  e.mutate(() => { for (let i = 0; i < 6; i++) paintLand(e, new THREE.Vector3(AT.x, A.root.userData.seaLevel ?? -1.2, AT.z), 9, 2.5, false) })
  let tile; A.root.traverse((n) => { if (!tile && n.userData.landTile && n.visible) { const b = new THREE.Box3().setFromObject(n); if (b.containsPoint(new THREE.Vector3(AT.x, b.getCenter(new THREE.Vector3()).y, AT.z))) tile = n } })
  return { tile: tile?.userData.landTile ?? null, collision: tile?.userData.collision, height: e.terrainHeightAt(AT.x, AT.z) }
}, [win, AT])
assert(painted.tile && painted.collision === true && painted.height > before.sea + 1.5, `Create land raises new ground in open sea (${JSON.stringify(painted)})`, results)

// Test drive, spawning on the new land (the studio spawns on a selected land tile).
await page.evaluate(([w, key]) => { const A = w.__archipelago; let tile; A.root.traverse((n) => { if (n.userData.landTile === key) tile = n }); A.editor.select([tile]) }, [win, painted.tile])
await page.frameLocator('iframe[title="World studio"]').locator('#drive').click()
await sleep(4000)
const onLand = await page.evaluate(([w]) => { const A = w.__archipelago, p = A.driving?.vehicle.position; return p ? { x: +p.x.toFixed(1), y: +p.y.toFixed(2), z: +p.z.toFixed(1) } : null }, [win])
assert(onLand && Math.hypot(onLand.x - AT.x, onLand.z - AT.z) < 12 && onLand.y > before.sea + 1, `test drive: the car rests on the painted land, so it collides (${JSON.stringify(onLand)})`, results)
await page.screenshot({ path: out('terrain-drive.png') })
await page.frameLocator('iframe[title="World studio"]').locator('canvas').first().press('Escape').catch(() => {})
await sleep(1500)

// Erase it.
const erased = await page.evaluate(async ([w, AT]) => {
  const A = w.__archipelago, e = A.editor, THREE = A.THREE
  const { paintLand } = await w.eval("import('/archipelago/preview/land-builder.js')")
  e.mutate(() => { for (let i = 0; i < 8; i++) paintLand(e, new THREE.Vector3(AT.x, A.root.userData.seaLevel ?? -1.2, AT.z), 14, 0, true) })
  return { height: e.terrainHeightAt(AT.x, AT.z), mode: A.mode }
}, [win, AT])
assert(erased.height < before.sea, `Erase land takes it back under the sea (${erased.height.toFixed(2)} < ${before.sea})`, results)
// Driving there now means water: place the car over the spot and let it fall.
const sunk = await page.evaluate(async ([w, AT]) => {
  const A = w.__archipelago, frame = () => new Promise((r) => requestAnimationFrame(r))
  w.document.querySelector('#drive').click()
  for (let i = 0; i < 120 && !A.driving; i++) await frame()
  A.driving.vehicle.moveTo({ x: AT.x, y: 3, z: AT.z }, 0)
  let lowest = Infinity
  for (let i = 0; i < 150; i++) { await frame(); lowest = Math.min(lowest, A.driving.vehicle.position.y) }
  return { lowest: +lowest.toFixed(2) }
}, [win, AT])
assert(sunk.lowest < before.sea + 0.3, `after erasing, the car no longer finds ground there (lowest ${sunk.lowest})`, results)
await browser.close()
finish(results)
