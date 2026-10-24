/* The island's eleven roads are retired (hidden, deleted) by the published world, so a normal /world never draws them. This puts them back
   — the saved world with every road made visible again — and photographs the junctions from the real gameplay camera, to compare the road
   paint of two trees (or two versions of roads/road-system.js) pixel for pixel:

     node scripts/qa/world-roads-visible.mjs --make-doc .qa/runs/impl/startup/roads/editor-world.roads-visible.json.gz     (once)
     QA_BASE=http://127.0.0.1:3262 node scripts/qa/world-roads-visible.mjs --prefix before --doc <that file>
     QA_BASE=http://127.0.0.1:3264 node scripts/qa/world-roads-visible.mjs --prefix after  --doc <that file>
     node scripts/qa/compare-shots.mjs .qa/runs/impl/startup/roads

   The doc is served in place of /archipelago/seed/editor-world.json.gz (the release of scripts/qa/world-static-server.mjs points there).
   Prints, per road, the triangles of its paint and asphalt, and writes <prefix>-<spot>.png for three junctions. */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { launch, BASE, sleep } from './lib.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback }
const OUT = path.resolve(arg('out', '.qa/runs/impl/startup/roads'))
fs.mkdirSync(OUT, { recursive: true })
if (arg('make-doc')) {
  const doc = JSON.parse(zlib.gunzipSync(fs.readFileSync('public/archipelago/seed/editor-world.json.gz')))
  let roads = 0
  for (const [id, state] of Object.entries(doc.states)) if (/^v4:road:[^:]+$/.test(id)) { state.visible = true; delete state.data.deleted; roads++ }
  fs.writeFileSync(arg('make-doc'), zlib.gzipSync(Buffer.from(JSON.stringify(doc)), { level: 1 }))
  console.log(`${roads} roads made visible -> ${arg('make-doc')}`)
  process.exit(0)
}
const PREFIX = arg('prefix', 'run'), DOC = arg('doc')
// [name, x, north]: Central Boulevard / West Coast Road, the Catalunya pit lane joining the circuit, the Loop approach.
const SPOTS = [['boulevard-junction', -19, 41], ['pit-lane', -66, -75.2], ['loop-approach', 112, 72.5]]
const browser = await launch()
// Reduced motion freezes the meadow grass and the water, so two runs of the same scene are identical pixel for pixel.
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)) })
if (DOC) {
  const body = fs.readFileSync(DOC)
  await page.route('**/archipelago/seed/editor-world.json.gz', (route) => route.fulfill({ status: 200, contentType: 'application/gzip', body }))
}
await page.goto(BASE + '/archipelago/preview/index.html')
await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 300_000, polling: 100 })
await sleep(4200)
const roads = await page.evaluate(() => {
  const a = window.__archipelago, out = {}
  a.root.traverse((o) => {
    if (!(o.userData.road_points || o.userData.roadDefinition) || o.userData.proceduralDerived) return
    let visible = true; for (let p = o; p; p = p.parent) if (!p.visible || p.userData.deleted) visible = false
    const tri = (m) => m?.geometry?.index ? m.geometry.index.count / 3 : 0
    out[o.name] = { visible, asphalt: tri(o), paint: tri(o.children.find((c) => c.name === 'Lane and edge markings')) }
  })
  return out
})
console.log(JSON.stringify(roads))
for (const [name, x, north] of SPOTS) {
  const placed = await page.evaluate(([x, north]) => {
    const a = window.__archipelago, arrival = a.driving.arrival({ group: null, x, z: -north, name: 'spot' })
    if (arrival.ok) a.driving.place(arrival, { reason: 'travel' })
    return arrival.ok ? arrival.position.toArray().map((v) => Math.round(v * 10) / 10) : arrival.reason
  }, [x, north])
  console.log(name, 'car at', JSON.stringify(placed))
  await sleep(2200)
  await page.screenshot({ path: path.join(OUT, `${PREFIX}-${name}.png`) })
}
console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no errors')
await browser.close()
