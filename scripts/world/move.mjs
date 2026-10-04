/* Moves named objects of the world through the studio (one undoable change),
   then saves a draft and publishes — the same as dragging them in the admin.
   node scripts/world/move.mjs '[{"name":"Lookout sign","x":33,"z":93.5}]' [--no-publish] */
import { BASE, launch, sleep } from '../qa/lib.mjs'
import { signIn } from '../qa/admin-session.mjs'

const moves = JSON.parse(process.argv[2] ?? '[]')
const PUBLISH = !process.argv.includes('--no-publish')
const browser = await launch()
const { page } = await signIn(browser)
await page.goto(`${BASE}/admin/world`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => document.querySelector('iframe[title="World studio"]')?.contentDocument?.body?.dataset.ready === 'true', null, { timeout: 240000 })
await sleep(800)
const studio = await page.evaluateHandle(() => document.querySelector('iframe[title="World studio"]').contentWindow)
const done = await page.evaluate(([w, moves]) => {
  const A = w.__archipelago, e = A.editor, THREE = A.THREE, out = []
  e.mutate(() => {
    for (const m of moves) {
      let node
      A.root.traverse((n) => { if (!node && n.name === m.name && !n.userData.deleted) node = n })
      if (!node) { out.push({ name: m.name, missing: true }); continue }
      const at = new THREE.Vector3(m.x, e.terrainHeightAt(m.x, m.z), m.z)
      node.parent.updateWorldMatrix(true, false)
      node.position.copy(node.parent.worldToLocal(at))
      e.drop(node)
      node.updateMatrixWorld(true)
      out.push({ name: m.name, at: node.getWorldPosition(new THREE.Vector3()).toArray().map((v) => +v.toFixed(2)) })
    }
  })
  return out
}, [studio, moves])
console.log(JSON.stringify(done))
await page.click('button:has-text("Save draft")')
await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /saved/i.test(t.textContent)), null, { timeout: 240000 })
if (PUBLISH) {
  await page.waitForFunction(() => !document.querySelector('header button.btn-accent')?.disabled, null, { timeout: 60000 })
  await page.click('button:has-text("Publish world")')
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Published/.test(t.textContent)), null, { timeout: 240000 })
}
console.log(PUBLISH ? 'saved and published' : 'saved')
await browser.close()
