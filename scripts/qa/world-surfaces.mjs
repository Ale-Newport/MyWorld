/* The painted ground (map-surfaces.js): how many triangles it is, how much ground it covers, where it covers, how close it follows the terrain, and that a car drives over it.

     QA_BASE=http://127.0.0.1:3281 node scripts/qa/world-surfaces.mjs --label base      # before
     QA_BASE=http://127.0.0.1:3282 node scripts/qa/world-surfaces.mjs --label after     # after
     node scripts/qa/world-surfaces.mjs --compare .qa/runs/impl/frame/surfaces-base.json .qa/runs/impl/frame/surfaces-after.json

   Per surface (every node with userData.surfaceDefinition): triangles, vertices, the area of its triangles seen from above against the
   definition's own area (planarBoolean), coverage by ray: 4,000 seeded points in its bounding box, dropped from above onto the mesh, against
   the definition itself (inside or not; a ring of 4 cm around the edge is not counted), the height of 3,000 points of its surface against the
   terrain + offset (max and p99 deviation), build time. Then a drive: the car is put on the biggest conforming surface and drives over it for 4 s. */
import fs from 'node:fs'
import path from 'node:path'
import { launch, BASE, sleep } from './lib.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback }
const OUT = path.resolve(arg('out', '.qa/runs/impl/frame'))
if (process.argv.includes('--compare')) {
  const [a, b] = process.argv.slice(process.argv.indexOf('--compare') + 1).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')))
  console.log(`${a.label} -> ${b.label}`)
  let ta = 0, tb = 0
  for (const x of a.surfaces) {
    const y = b.surfaces.find((s) => s.uuid === x.uuid)
    if (!y) { console.log('missing in b:', x.name); continue }
    ta += x.triangles; tb += y.triangles
    console.log(`${(x.name + ' ' + x.kind).padEnd(26)} ${String(x.area.toFixed(1)).padStart(7)} m2  tris ${String(x.triangles).padStart(7)} -> ${String(y.triangles).padStart(5)}  area vs definition ${x.areaError.toFixed(2)}% -> ${y.areaError.toFixed(2)}%  coverage wrong ${x.coverageWrong.toFixed(2)}% -> ${y.coverageWrong.toFixed(2)}%  height dev max/p99 as loaded ${x.heightMax.toFixed(3)}/${x.heightP99.toFixed(3)} -> ${y.heightMax.toFixed(3)}/${y.heightP99.toFixed(3)} m, rebuilt on final terrain ${x.rebuiltHeightMax.toFixed(3)}/${x.rebuiltHeightP99.toFixed(3)} -> ${y.rebuiltHeightMax.toFixed(3)}/${y.rebuiltHeightP99.toFixed(3)} m  build ${x.buildMs} -> ${y.buildMs} ms`)
  }
  console.log(`total triangles ${ta} -> ${tb}  (${(100 * tb / ta).toFixed(1)}%)`)
  console.log('drive:', JSON.stringify(a.drive), '->', JSON.stringify(b.drive))
  process.exit(0)
}
const LABEL = arg('label', 'run')
const browser = await launch()
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
await page.goto(`${BASE}/archipelago/preview/index.html?qa`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 600_000 })
await sleep(2000)
const result = await page.evaluate(async () => {
  const A = globalThis.__archipelago, T = A.THREE, planar = await import('/archipelago/preview/roads/planar.js'), surfaces = await import('/archipelago/preview/map-surfaces.js')
  const rng = (seed) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296
  const nodes = []; A.root.traverse((n) => { if (n.userData.surfaceDefinition && (n.userData.batched || A.editor.isVisible(n))) nodes.push(n) })
  const rows = []
  for (const node of nodes) {
    const def = node.userData.surfaceDefinition, g = node.geometry, pos = g.attributes.position, index = g.index
    const tri = index ? index.count / 3 : pos.count / 3, at = (i) => index ? index.getX(i) : i
    // the definition's own region, from planarBoolean
    let cells, area
    if (def.kind === 'brush') ({ cells, area } = planar.planarBoolean([def.cells], (n) => n[0] > 0))
    else if (def.kind === 'plaza') ({ cells, area } = planar.planarBoolean([[def.polygon], def.holes ?? []], (c) => c[0] > 0 && !c[1]))
    else continue
    if (def.brushCuts?.length) ({ cells, area } = planar.planarBoolean([cells, def.brushCuts], (n) => n[0] > 0 && !n[1]))
    // area of the triangles seen from above
    let seen = 0, tris = []
    for (let i = 0; i < tri; i++) {
      const a = at(i * 3), b = at(i * 3 + 1), c = at(i * 3 + 2)
      const ax = pos.getX(a), az = pos.getZ(a), bx = pos.getX(b), bz = pos.getZ(b), cx = pos.getX(c), cz = pos.getZ(c)
      const ar = Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2; seen += ar; tris.push([a, b, c, ar])
    }
    // coverage by ray against the definition
    node.updateWorldMatrix(true, false)
    const ray = new T.Raycaster(), bb = new T.Box3().setFromObject(node), r = rng(1234), inside = (x, z) => cells.some((cell) => planar.pointInPolygon([x, z], cell))
    const edgeDistance = (x, z) => { let best = Infinity; for (const cell of cells) for (let i = 0; i < cell.length; i++) { const p = cell[i], q = cell[(i + 1) % cell.length], dx = q[0] - p[0], dz = q[1] - p[1], t = Math.max(0, Math.min(1, ((x - p[0]) * dx + (z - p[1]) * dz) / (dx * dx + dz * dz || 1))); best = Math.min(best, Math.hypot(x - p[0] - dx * t, z - p[1] - dz * t)) } return best }
    let tested = 0, wrong = 0
    const N = tri > 20000 ? 800 : 3000
    for (let k = 0; k < N; k++) {
      const x = bb.min.x + r() * (bb.max.x - bb.min.x), z = bb.min.z + r() * (bb.max.z - bb.min.z)
      const truth = inside(x, z); if (cells.length < 400 && edgeDistance(x, z) < .04) continue
      ray.set(new T.Vector3(x, 200, z), new T.Vector3(0, -1, 0)); const hit = ray.intersectObject(node, false).length > 0
      tested++; if (hit !== truth) wrong++
    }
    // height against the terrain: as loaded, then after rebuilding on the final terrain (the loaded mesh can be older than the last terrain cut)
    const sampleDev = (seed) => {
      const g2 = node.geometry, p2 = g2.attributes.position, i2 = g2.index, n2 = i2 ? i2.count / 3 : p2.count / 3, at2 = (i) => i2 ? i2.getX(i) : i, dev = [], r2 = rng(seed), offset = def.offset ?? .025
      for (let k = 0; k < 3000 && n2; k++) {
        const t = Math.floor(r2() * n2), a = at2(t * 3), b = at2(t * 3 + 1), c = at2(t * 3 + 2), u = r2(), v = r2() * (1 - u), w = 1 - u - v
        const x = p2.getX(a) * u + p2.getX(b) * v + p2.getX(c) * w, y = p2.getY(a) * u + p2.getY(b) * v + p2.getY(c) * w, z = p2.getZ(a) * u + p2.getZ(b) * v + p2.getZ(c) * w
        if (def.conformToTerrain) dev.push(Math.abs(y - (A.editor.terrainHeightAt(x, z) + offset)))
      }
      return dev.sort((p, q) => p - q)
    }
    const dev = sampleDev(99)
    const t0 = performance.now(); surfaces.rebuildSurface(node, { heightAt: (x, z) => A.editor.terrainHeightAt(x, z) }); const buildMs = Math.round(performance.now() - t0)
    const dev2 = sampleDev(77)
    rows.push({ uuid: node.uuid, name: node.name, kind: def.kind, conform: !!def.conformToTerrain, area, triangles: tri, vertices: pos.count, areaError: 100 * (seen - area) / area, coverageTested: tested, coverageWrong: tested ? 100 * wrong / tested : 0, heightMax: dev.at(-1) ?? 0, heightP99: dev[Math.floor(dev.length * .99)] ?? 0, rebuiltHeightMax: dev2.at(-1) ?? 0, rebuiltHeightP99: dev2[Math.floor(dev2.length * .99)] ?? 0, buildMs, rebuiltTriangles: (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3 })
  }
  return rows
})
// the drive: onto the biggest conforming surface, W for 4 s
const target = await page.evaluate(() => { const A = __archipelago; let best = null; A.root.traverse((n) => { if (n.userData.surfaceDefinition?.conformToTerrain && (n.userData.batched || A.editor.isVisible(n))) { const b = new A.THREE.Box3().setFromObject(n); const area = (n.userData.surfaceStats?.area ?? 0) * (n.userData.surfaceDefinition.kind === 'brush' ? 10 : 1); if (!best || area > best.area) best = { area, c: b.getCenter(new A.THREE.Vector3()), name: n.name } } }); return best && { x: best.c.x, z: best.c.z, name: best.name, area: best.area } })
const placed = await page.evaluate(async (t) => {
  const A = __archipelago, d = A.driving, c = d.placement.near(t.x, t.z, { radius: 12, step: 1, margin: .6, dynamicMargin: 1, maxEdge: 4 })
  if (!c) return { placed: false, reason: 'no valid pose within 12 m of the surface centre' }
  d.place(c, { reason: 'travel' }); return { placed: true, from: d.vehicle.position.toArray().map((v) => +v.toFixed(1)) }
}, target)
const drive = { ...placed }
if (placed.placed) {
  await sleep(800)
  const ys = [], start = await page.evaluate(() => __archipelago.driving.vehicle.position.toArray())
  await page.keyboard.down('KeyW')
  for (let i = 0; i < 20; i++) { await sleep(200); ys.push(await page.evaluate(() => __archipelago.driving.vehicle.position.y)) }
  await page.keyboard.up('KeyW')
  const end = await page.evaluate(() => __archipelago.driving.vehicle.position.toArray())
  Object.assign(drive, { travelled: +Math.hypot(end[0] - start[0], end[2] - start[2]).toFixed(1), yMin: +Math.min(...ys).toFixed(2), yMax: +Math.max(...ys).toFixed(2), onGround: Math.max(...ys) - Math.min(...ys) < 3 })
}
const out = { label: LABEL, base: BASE, errors, target, drive, surfaces: result }
fs.writeFileSync(path.join(OUT, `surfaces-${LABEL}.json`), JSON.stringify(out, null, 1))
console.log(`wrote surfaces-${LABEL}.json: ${result.length} surfaces, ${result.reduce((s, r) => s + r.triangles, 0)} triangles; drive`, JSON.stringify(drive), errors.length ? 'errors ' + errors.join(' | ') : 'no errors')
await browser.close()
