/* The proof tool for changes that must not alter what /world is made of (the world document, the GLB pipeline): it dumps every
   mesh of the ready scene and every physics collider as raw arrays, and compares two dumps.

     QA_BASE=http://127.0.0.1:3291 node scripts/qa/world-geometry-dump.mjs --label before --out .qa/work/bytes/dumps
     QA_BASE=http://127.0.0.1:3292 node scripts/qa/world-geometry-dump.mjs --label after  --out .qa/work/bytes/dumps
     node scripts/qa/world-geometry-dump.mjs --compare before after --out .qa/work/bytes/dumps [--pos-tol 0.004] [--uv-tol 0.0002] [--normal-deg 1]

   Per mesh (keyed by its path of names and sibling positions): position, normal, uv, uv1, color and index arrays, the world matrix,
   instance matrices, visibility. Per Rapier collider: the shape's vertices and indices (what the engine was given).
   --compare reports exact equality when the tolerances are 0 (the default), otherwise the largest deviation seen per attribute:
   indices and counts must always be identical; positions within --pos-tol metres; normals within --normal-deg; uvs within --uv-tol.
   World matrices are reported (movedMatrices, largestDeviation.matrix) but only judged with --strict-matrix: animated and physics-driven
   nodes move with the clock of each run. The exit code is 1 when anything else is outside its tolerance. */
import fs from 'node:fs'
import path from 'node:path'
import { launch, BASE } from './lib.mjs'

const args = process.argv.slice(2)
const arg = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : fallback }
const OUT = path.resolve(arg('out', '.qa/work/bytes/dumps'))
const files = (label) => ({ meta: path.join(OUT, `geometry-${label}.json`), data: path.join(OUT, `geometry-${label}.bin`) })
const ATTRIBUTES = ['position', 'normal', 'uv', 'uv1', 'color']

if (args.includes('--compare')) {
  const [la, lb] = args.slice(args.indexOf('--compare') + 1, args.indexOf('--compare') + 3)
  const load = (label) => {
    const f = files(label), meta = JSON.parse(fs.readFileSync(f.meta, 'utf8')), buf = fs.readFileSync(f.data)
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
    const view = (ref) => { if (!ref) return null; const T = { Float32Array, Uint32Array, Float64Array }[ref.type]; return new T(bytes.buffer.slice(bytes.byteOffset + ref.off, bytes.byteOffset + ref.off + ref.len * T.BYTES_PER_ELEMENT)) }
    return { meta, view }
  }
  const A = load(la), B = load(lb)
  const strictMatrix = args.includes('--strict-matrix')
  const tol = { position: Number(arg('pos-tol', 0)), uv: Number(arg('uv-tol', 0)), normalDeg: Number(arg('normal-deg', 0)) }
  const problems = [], worst = { position: 0, uv: 0, normalDeg: 0, color: 0, matrix: 0, collider: 0 }, counts = { meshes: 0, geometries: 0, colliders: 0, exactGeometries: 0, vertices: 0, movedMatrices: 0, movedColliders: 0 }
  const bigger = (k, v, limit, what) => { if (v > worst[k]) worst[k] = v; if (v > limit) problems.push(what) }
  const geoA = new Map(A.meta.geometries.map((g) => [g.id, g])), geoB = new Map(B.meta.geometries.map((g) => [g.id, g]))
  const meshesB = new Map(B.meta.meshes.map((m) => [m.key, m]))
  if (A.meta.meshes.length !== B.meta.meshes.length) problems.push(`mesh count ${A.meta.meshes.length} vs ${B.meta.meshes.length}`)
  const checked = new Set()
  for (const m of A.meta.meshes) {
    const n = meshesB.get(m.key)
    if (!n) { problems.push(`only in ${la}: ${m.key}`); continue }
    counts.meshes++
    if (m.visible !== n.visible || m.instances !== n.instances) problems.push(`${m.key}: visibility or instance count differs`)
    const ma = A.view(m.matrix), mb = B.view(n.matrix)
    // Matrices are reported, not judged: balloons, fountains, wakes and props settling under physics move with the clock of each run.
    if (ma && mb) { let d = 0; for (let i = 0; i < 16; i++) d = Math.max(d, Math.abs(ma[i] - mb[i])); if (d > 0) counts.movedMatrices++; bigger('matrix', d, strictMatrix ? 0 : Infinity, `${m.key}: world matrix differs by ${d}`) }
    if (m.instanceMatrix || n.instanceMatrix) { const ia = A.view(m.instanceMatrix), ib = B.view(n.instanceMatrix); let d = 0; if (!ia || !ib || ia.length !== ib.length) d = Infinity; else for (let i = 0; i < ia.length; i++) d = Math.max(d, Math.abs(ia[i] - ib[i])); bigger('matrix', d, strictMatrix ? 0 : Infinity, `${m.key}: instance matrices differ by ${d}`) }
    const pair = m.geometry + '|' + n.geometry
    if (checked.has(pair)) continue
    checked.add(pair)
    const ga = geoA.get(m.geometry), gb = geoB.get(n.geometry)
    counts.geometries++
    const ia = A.view(ga.index), ib = B.view(gb.index)
    if (!!ia !== !!ib || (ia && (ia.length !== ib.length || ia.some((v, i) => v !== ib[i])))) problems.push(`${m.key}: index buffers differ`)
    let exact = true
    for (const name of ATTRIBUTES) {
      const xa = A.view(ga[name]), xb = B.view(gb[name])
      if (!!xa !== !!xb) { problems.push(`${m.key}: ${name} present in one only`); continue }
      if (!xa) continue
      if (xa.length !== xb.length) { problems.push(`${m.key}: ${name} length ${xa.length} vs ${xb.length}`); continue }
      let d = 0
      if (name === 'normal') {
        for (let i = 0; i < xa.length; i += 3) {
          // the angle between the two vectors; atan2 of |cross| and dot is exact for equal vectors (acos of a rounded dot is not)
          const ax = xa[i], ay = xa[i + 1], az = xa[i + 2], bx = xb[i], by = xb[i + 1], bz = xb[i + 2]
          if (ax === bx && ay === by && az === bz) continue
          const la_ = Math.hypot(ax, ay, az), lb_ = Math.hypot(bx, by, bz)
          if (la_ < 1e-6 && lb_ < 1e-6) continue
          const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx
          d = Math.max(d, la_ < 1e-6 || lb_ < 1e-6 ? 180 : Math.atan2(Math.hypot(cx, cy, cz), ax * bx + ay * by + az * bz) * 180 / Math.PI)
        }
        bigger('normalDeg', d, tol.normalDeg, `${m.key}: normals deviate ${d.toFixed(3)} deg (limit ${tol.normalDeg})`)
      } else {
        for (let i = 0; i < xa.length; i++) d = Math.max(d, Math.abs(xa[i] - xb[i]))
        const key = name === 'position' ? 'position' : name === 'color' ? 'color' : 'uv'
        bigger(key, d, key === 'color' ? 0 : tol[key], `${m.key}: ${name} deviates ${d} (limit ${key === 'color' ? 0 : tol[key]})`)
      }
      if (d !== 0) exact = false
      if (name === 'position') counts.vertices += xa.length / 3
    }
    if (exact) counts.exactGeometries++
  }
  const colliderB = new Map(B.meta.colliders.map((c) => [c.handle, c]))
  if (A.meta.colliders.length !== B.meta.colliders.length) problems.push(`collider count ${A.meta.colliders.length} vs ${B.meta.colliders.length}`)
  for (const c of A.meta.colliders) {
    const d = colliderB.get(c.handle)
    if (!d) { problems.push(`collider ${c.handle} only in ${la}`); continue }
    counts.colliders++
    if (c.shape !== d.shape || (strictMatrix && c.translation.some((v, i) => v !== d.translation[i]))) { problems.push(`collider ${c.handle}: shape or placement differs`); continue }
    if (c.translation.some((v, i) => v !== d.translation[i])) counts.movedColliders++
    const va = A.view(c.vertices), vb = B.view(d.vertices), ia = A.view(c.indices), ib = B.view(d.indices)
    if (!!va !== !!vb || (va && va.length !== vb.length)) { problems.push(`collider ${c.handle}: vertex count differs`); continue }
    if (!!ia !== !!ib || (ia && (ia.length !== ib.length || ia.some((v, i) => v !== ib[i])))) problems.push(`collider ${c.handle}: indices differ`)
    if (va) { let dist = 0; for (let i = 0; i < va.length; i++) dist = Math.max(dist, Math.abs(va[i] - vb[i])); bigger('collider', dist, tol.position, `collider ${c.handle} (${c.shape}): vertices deviate ${dist} (limit ${tol.position})`) }
  }
  const unique = [...new Set(problems)]
  console.log(JSON.stringify({ a: la, b: lb, tolerances: tol, counts, largestDeviation: worst, problems: unique.length, first: unique.slice(0, 12) }, null, 1))
  process.exit(unique.length ? 1 : 0)
}

const label = arg('label', 'run')
const browser = await launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
await page.goto(BASE + '/archipelago/preview/index.html')
await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 300_000, polling: 100 })
await page.waitForTimeout(1500)
const result = await page.evaluate((attributeNames) => {
  const a = window.__archipelago, chunks = [], geometries = new Map(), meshes = [], colliders = []
  let offset = 0
  const put = (array, Type) => {
    if (!array) return null
    const typed = array instanceof Type ? array : Type.from(array)
    const ref = { off: offset, len: typed.length, type: Type.name }
    chunks.push([offset, typed]); offset += typed.byteLength; offset = (offset + 7) & ~7
    return ref
  }
  const flat = (attribute) => {
    if (!attribute) return null
    if (attribute.isInterleavedBufferAttribute) { const out = new Float32Array(attribute.count * attribute.itemSize); for (let i = 0; i < attribute.count; i++) for (let c = 0; c < attribute.itemSize; c++) out[i * attribute.itemSize + c] = attribute.getComponent(i, c); return out }
    return attribute.array instanceof Float32Array ? attribute.array : Float32Array.from(attribute.array, (v) => attribute.normalized ? v / (attribute.array instanceof Uint8Array ? 255 : attribute.array instanceof Uint16Array ? 65535 : 32767) : v)
  }
  const drawn = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true }
  const pathOf = (o) => { const parts = []; for (let p = o; p && p !== a.scene; p = p.parent) parts.push(`${p.userData.aw_id ?? p.name ?? p.type}@${p.parent ? p.parent.children.indexOf(p) : 0}`); return parts.reverse().join('/') }
  a.scene.updateMatrixWorld(true)
  a.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return
    let g = geometries.get(o.geometry.uuid)
    if (!g) {
      g = { id: geometries.size }
      for (const name of attributeNames) g[name] = put(flat(o.geometry.attributes[name]), Float32Array)
      g.index = put(o.geometry.index?.array, Uint32Array)
      geometries.set(o.geometry.uuid, g)
    }
    meshes.push({ key: pathOf(o), geometry: g.id, visible: drawn(o), matrix: put(o.matrixWorld.elements, Float64Array), instances: o.isInstancedMesh ? o.count : 0, instanceMatrix: o.isInstancedMesh ? put(o.instanceMatrix.array, Float32Array) : null })
  })
  a.physics?.world?.colliders?.forEach?.((c) => {
    const shape = c.shape, t = c.translation()
    colliders.push({ handle: c.handle, shape: shape?.constructor?.name ?? String(c.shapeType?.()), translation: [t.x, t.y, t.z], vertices: put(shape?.vertices, Float32Array), indices: put(shape?.indices, Uint32Array) })
  })
  const data = new Uint8Array(offset)
  for (const [at, typed] of chunks) data.set(new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength), at)
  return { meta: { geometries: [...geometries.values()], meshes, colliders, info: { calls: a.renderer.info.render.calls, triangles: a.renderer.info.render.triangles } }, data }
}, ATTRIBUTES)
await browser.close()
fs.mkdirSync(OUT, { recursive: true })
const f = files(label)
fs.writeFileSync(f.meta, JSON.stringify({ label, base: BASE, errors, ...result.meta }))
fs.writeFileSync(f.data, Buffer.from(result.data.buffer, result.data.byteOffset, result.data.byteLength))
console.log(JSON.stringify({ label, meshes: result.meta.meshes.length, geometries: result.meta.geometries.length, colliders: result.meta.colliders.length, mb: +(result.data.byteLength / 1e6).toFixed(1), info: result.meta.info, errors }))
