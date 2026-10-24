/* A geometry fingerprint of the /world scene at ready, to prove a startup change did not alter what is drawn.

     QA_BASE=http://127.0.0.1:3262 node scripts/qa/world-scene-fingerprint.mjs --label before
     QA_BASE=http://127.0.0.1:3263 node scripts/qa/world-scene-fingerprint.mjs --label after
     node scripts/qa/world-scene-fingerprint.mjs --compare before after

   Every mesh that is drawn (itself and all its ancestors visible) is keyed by its stable id (aw_id, else its path of names) and
   hashed over its position, index and uv arrays (rounded to 0.1 mm); batched/instanced meshes by their order in the scene.
   --compare lists what is only in one run and what differs, by kind (terrain, surfaces, roads, props, batches). */
import fs from 'node:fs'
import path from 'node:path'
import { launch, BASE } from './lib.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback }
const OUT = path.resolve(arg('out', '.qa/runs/impl/startup'))
const file = (label) => path.join(OUT, `fingerprint-${label}.json`)

if (process.argv.includes('--compare')) {
  const [a, b] = process.argv.slice(process.argv.indexOf('--compare') + 1, process.argv.indexOf('--compare') + 3).map((l) => JSON.parse(fs.readFileSync(file(l), 'utf8')))
  const out = { onlyBefore: [], onlyAfter: [], differ: [], same: 0, byKind: {} }
  for (const [k, v] of Object.entries(a.meshes)) {
    const w = b.meshes[k]
    if (!w) { out.onlyBefore.push(k); continue }
    if (w.h === v.h && w.n === v.n) out.same++
    else out.differ.push(`${k}: ${v.n}→${w.n} tris`)
  }
  for (const k of Object.keys(b.meshes)) if (!a.meshes[k]) out.onlyAfter.push(k)
  const kind = (k) => (a.meshes[k] ?? b.meshes[k]).kind
  for (const list of [out.onlyBefore, out.onlyAfter, out.differ.map((s) => s.split(': ')[0])]) for (const k of list) out.byKind[kind(k)] = (out.byKind[kind(k)] ?? 0) + 1
  console.log(JSON.stringify({ before: a.totals, after: b.totals, ...out, onlyBefore: out.onlyBefore.slice(0, 20), onlyAfter: out.onlyAfter.slice(0, 20), differ: out.differ.slice(0, 20) }, null, 1))
  process.exit(out.onlyBefore.length || out.onlyAfter.length || out.differ.length ? 1 : 0)
}

const label = arg('label', 'run')
const browser = await launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
await page.goto(BASE + '/archipelago/preview/index.html')
await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 300_000, polling: 100 })
await page.waitForTimeout(2000)
const result = await page.evaluate(() => {
  const a = window.__archipelago, meshes = {}, totals = { meshes: 0, triangles: 0, instanced: 0 }
  const hashOf = (g) => {
    let h = 0
    for (const name of ['position', 'uv', 'color']) { const arr = g.attributes[name]?.array; if (arr) for (let i = 0; i < arr.length; i++) h = (h * 31 + Math.round(arr[i] * 1e4)) | 0 }
    if (g.index) for (let i = 0; i < g.index.array.length; i++) h = (h * 17 + g.index.array[i]) | 0
    return h
  }
  const drawn = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true }
  const kindOf = (o) => { const d = o.userData; return d.terrain || d.landTile || d.mapTerrainGenerated ? 'terrain' : d.mapSurface || d.surfaceDefinition ? 'surface' : d.road_points || d.roadPart || d.roadGenerated ? 'road' : d.sea || d.waterSurface ? 'water' : 'prop' }
  const pathOf = (o) => { const parts = []; for (let p = o; p && p !== a.scene; p = p.parent) parts.push(p.userData.aw_id ?? p.name ?? p.type); return parts.reverse().join('>') }
  let batch = 0
  a.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry || !drawn(o)) return
    const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1)
    const top = o.parent === a.scene, key = (top ? 'batch#' + batch++ + ':' : '') + pathOf(o)
    let h = hashOf(g); if (o.isInstancedMesh) for (let i = 0; i < o.count * 16; i++) h = (h * 31 + Math.round(o.instanceMatrix.array[i] * 1e3)) | 0
    meshes[key] = { h, n, kind: top ? 'batch' : kindOf(o) }
    totals.meshes++; totals.triangles += n; if (o.isInstancedMesh) totals.instanced++
  })
  return { meshes, totals, info: { calls: a.renderer.info.render.calls, triangles: a.renderer.info.render.triangles } }
})
await browser.close()
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(file(label), JSON.stringify({ label, base: BASE, errors, ...result }))
console.log(JSON.stringify({ label, totals: result.totals, info: result.info, errors }))
