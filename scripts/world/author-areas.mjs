/* Authors the portfolio's new world areas through the real world editor — the
   same studio the admin uses, in a browser — then saves them as a world draft
   and publishes it. Nothing is written into the world document by hand: every
   object is placed with the editor's own placeDefinition(), every group is an
   experience group made by the editor, so the result is exactly what an
   administrator could have built (and can now move, edit or delete there).

     Infield slalom   north infield — cone gates, start and finish posts, a
                      timing screen, spectator benches (activity: slalom)
     Penguin round-up the ice lake — a pen on the ice and a sign on the shore;
                      the lake's existing penguins are the herd (activity: roundup)
     Paddock grove    north-west infield — gazebo, picnic tables, trees, flowers
     Coastal lookout  south-east pocket — benches facing the sea, planting

   node scripts/world/author-areas.mjs [--replace] [--no-publish]
   Needs the dev server (npm run dev) and the QA administrator (.data/qa-admin.json). */
import { BASE, launch, sleep } from '../qa/lib.mjs'
import { signIn } from '../qa/admin-session.mjs'

const REPLACE = process.argv.includes('--replace')
const PUBLISH = !process.argv.includes('--no-publish')

const slalomCones = []
const gates = [[-36.5, -28.5], [-31, -24.5], [-25.5, -28.5], [-20, -24.5], [-14.5, -28.5]]
gates.forEach(([x, c], i) => { slalomCones.push({ def: 'v4:traffic-cone', x, z: c - 2.5, name: `Slalom gate ${i + 1} · left`, cone: true }, { def: 'v4:traffic-cone', x, z: c + 2.5, name: `Slalom gate ${i + 1} · right`, cone: true }) })

const AREAS = [
  {
    id: 'experience:portfolio-slalom', name: 'Infield slalom', icon: '⛳', centre: [-26, -27],
    activity: { type: 'slalom', name: 'Infield slalom', penaltyMissed: 3, penaltyCone: 1, quickUnder: 22 },
    items: [
      { def: 'v4:bollard', x: -42, z: -31.5, name: 'Slalom start · left' },
      { def: 'v4:bollard', x: -42, z: -21.5, name: 'Slalom start · right' },
      ...slalomCones,
      { def: 'v4:bollard', x: -9, z: -31.5, name: 'Slalom finish · left' },
      { def: 'v4:bollard', x: -9, z: -21.5, name: 'Slalom finish · right' },
      { def: 'v4:timing-screen', x: -4.5, z: -19.5, ry: Math.PI / 2, name: 'Slalom timing screen' },
      { def: 'v4:tire-stack', x: -44.5, z: -34.5, ry: 0.3, name: 'Slalom tyres NW' },
      { def: 'v4:tire-stack', x: -44.5, z: -18.5, ry: -0.3, name: 'Slalom tyres SW' },
      { def: 'v4:tire-stack', x: -6.5, z: -34, ry: -0.2, name: 'Slalom tyres NE' },
      { def: 'v4:park-bench', x: -33.5, z: -36.4, ry: 0, name: 'Slalom spectator bench 1' },
      { def: 'v4:park-bench', x: -25.2, z: -36.8, ry: 0, name: 'Slalom spectator bench 2' },
      { def: 'v4:flower-patch', x: -2.5, z: -17, name: 'Slalom flowers 1' },
      { def: 'v4:flower-patch', x: -6.5, z: -16.2, name: 'Slalom flowers 2' },
      { def: 'v4:flower-patch', x: -40, z: -36.5, name: 'Slalom flowers 3' },
    ],
  },
  {
    id: 'experience:portfolio-roundup', name: 'Penguin round-up', icon: '🐧', centre: [87, 59.5], keepCentre: true,
    activity: { type: 'roundup', name: 'Penguin round-up', radius: 3.6, seconds: 90 },
    items: [
      { def: 'v4:park-sign', x: 91.5, z: 65.5, ry: 0.5, name: 'Round-up sign' },
      { def: 'v4:flower-patch', x: 93.5, z: 66.5, name: 'Round-up flowers' },
    ],
  },
  {
    id: 'experience:portfolio-grove', name: 'Paddock grove', icon: '🌳', centre: [-99, -18],
    items: [
      { def: 'v4:gazebo', x: -101, z: -6.5, ry: 0, name: 'Grove gazebo' },
      { def: 'v4:picnic-table', x: -105.5, z: -9.5, ry: 0.4, name: 'Grove picnic table 1' },
      { def: 'v4:picnic-table', x: -96.5, z: -4.8, ry: -0.3, name: 'Grove picnic table 2' },
      { def: 'v4:park-bench', x: -101, z: -12.8, ry: Math.PI, name: 'Grove bench' },
      { def: 'v4:cherry-blossom', x: -108, z: -14, name: 'Grove cherry 1' },
      { def: 'v4:cherry-blossom', x: -108.2, z: -21.5, name: 'Grove cherry 2' },
      { def: 'v4:broadleaf-tree', x: -90, z: -35, name: 'Grove tree 1' },
      { def: 'v4:pine', x: -86.8, z: -12, name: 'Grove pine' },
      { def: 'v4:rock-cluster', x: -108.5, z: -36.5, ry: 0.7, name: 'Grove rocks' },
      { def: 'v4:flower-patch', x: -95, z: -6.2, name: 'Grove flowers 1' },
      { def: 'v4:flower-patch', x: -106.2, z: -4.2, name: 'Grove flowers 2' },
      { def: 'v4:flower-patch', x: -93.2, z: -13.6, name: 'Grove flowers 3' },
      { def: 'v4:flower-patch', x: -104.5, z: -13.5, name: 'Grove flowers 4' },
      { def: 'v4:low-bush', x: -88, z: -24, name: 'Grove bush 1' },
      { def: 'v4:low-bush', x: -87.6, z: -27.2, name: 'Grove bush 2' },
      { def: 'v4:low-bush', x: -106.2, z: -27, name: 'Grove bush 3' },
      { def: 'v4:low-bush', x: -107, z: -30.2, name: 'Grove bush 4' },
      { def: 'v4:park-sign', x: -97, z: -2.4, ry: 0, name: 'Grove sign' },
    ],
  },
  {
    id: 'experience:portfolio-lookout', name: 'Coastal lookout', icon: '🌅', centre: [34, 102],
    items: [
      { def: 'v4:stone-bench', x: 38.5, z: 98, ry: -Math.PI / 2, name: 'Lookout bench 1' },
      { def: 'v4:stone-bench', x: 38.5, z: 103, ry: -Math.PI / 2, name: 'Lookout bench 2' },
      { def: 'v4:picnic-table', x: 33, z: 106.5, ry: 0.2, name: 'Lookout picnic table' },
      { def: 'v4:broadleaf-tree', x: 30, z: 102, name: 'Lookout tree' },
      { def: 'v4:flower-patch', x: 35, z: 96.5, name: 'Lookout flowers 1' },
      { def: 'v4:flower-patch', x: 36.5, z: 100.5, name: 'Lookout flowers 2' },
      { def: 'v4:flower-patch', x: 34.5, z: 104.5, name: 'Lookout flowers 3' },
      { def: 'v4:flower-patch', x: 31, z: 98.8, name: 'Lookout flowers 4' },
      { def: 'v4:low-bush', x: 30.5, z: 95, name: 'Lookout bush 1' },
      { def: 'v4:low-bush', x: 29.5, z: 108, name: 'Lookout bush 2' },
      { def: 'v4:street-light', x: 36, z: 108.5, ry: 0, name: 'Lookout lamp' },
      { def: 'v4:park-sign', x: 31, z: 94.5, ry: 0, name: 'Lookout sign' },
    ],
  },
]

const browser = await launch()
const { page } = await signIn(browser)
page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 300)))
await page.goto(`${BASE}/admin/world`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => document.querySelector('iframe[title="World studio"]')?.contentDocument?.body?.dataset.ready === 'true', null, { timeout: 240000 })
await sleep(1000)
const studio = await page.evaluateHandle(() => document.querySelector('iframe[title="World studio"]').contentWindow)

const report = await page.evaluate(([w, AREAS, REPLACE]) => {
  const A = w.__archipelago, e = A.editor, THREE = A.THREE, $ = (s) => w.document.querySelector(s)
  const existing = AREAS.map((a) => e.registry.get(a.id)).filter((g) => g && !g.userData.deleted)
  if (existing.length && !REPLACE) return { error: `Already authored: ${existing.map((g) => g.name).join(', ')}. Run with --replace to rebuild them.` }
  if (existing.length) { const members = []; for (const g of existing) g.traverse((n) => members.push(n)); e.select(existing); e.remove() }
  // Place on the ground, exactly where asked.
  for (const [sel, value] of [['#snap-grid', false], ['#snap-ground', true], ['#align-ground', false]]) { const box = $(sel); if (box) box.checked = value }
  const CONE = { collider_shape: 'CONE', mass: 0.01, ballast: 0.6, friction: 0.35, restitution: 0.08, linear_damping: 0.32, angular_damping: 0.6 }
  const out = []
  for (const area of AREAS) {
    const nodes = []
    for (const it of area.items) {
      const o = e.placeDefinition(it.def, new THREE.Vector3(it.x, 0, it.z))
      if (!o) { out.push({ missing: it.def }); continue }
      e.mutate(() => {
        o.name = it.name
        if (it.ry) o.rotation.y = it.ry
        // Slalom cones are light rigid bodies, like the ice props: hitting one moves it.
        if (it.cone) Object.assign(o.userData, CONE, { physics_mode: 'DYNAMIC', collision: true, pushable: true, pushableVersion: 1, ccd: true, friction_rule: 'min', assetPhysicsEdited: true })
        o.updateMatrixWorld(true)
      })
      nodes.push(o)
    }
    let group
    e.mutate(() => {
      const y = e.terrainHeightAt(area.centre[0], area.centre[1])
      group = e.experiences.create(nodes, area.name, { id: area.id, icon: area.icon, position: [area.centre[0], y, area.centre[1]], groundHeight: area.keepCentre ? y : undefined, scaleLocked: true })
      if (area.activity) group.userData.activity = { ...area.activity }
      group.userData.portfolioArea = true
    })
    const at = group.getWorldPosition(new THREE.Vector3())
    out.push({ group: area.name, id: area.id, members: nodes.length, at: at.toArray().map((v) => Math.round(v * 100) / 100) })
  }
  e.select([])
  return { out, dirty: e.dirty }
}, [studio, AREAS, REPLACE])
console.log(JSON.stringify(report, null, 1))
if (report.error) { await browser.close(); process.exit(1) }

await page.click('button:has-text("Save draft")')
await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /saved/i.test(t.textContent)), null, { timeout: 240000 })
console.log('draft saved')
if (PUBLISH) {
  await page.waitForFunction(() => !document.querySelector('header button.btn-accent')?.disabled, null, { timeout: 60000 })
  await page.click('button:has-text("Publish world")')
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /Published/.test(t.textContent)), null, { timeout: 240000 })
  console.log('published', JSON.stringify(await (await fetch(`${BASE}/api/world/release`)).json()).slice(0, 300))
}
await browser.close()
