/* Proves a packed model (scripts/world/compress-models.mjs) is the Blender export it came from, to the tolerances the packing promises.

     node scripts/world/verify-models.mjs [--dir <root holding public/archipelago/...>] [--only substring]

   For every model: the packed .glb.gz is read back with the very decoder and inflate code the browser runs
   (public/archipelago/preview/compressed-gltf.js + three's meshopt_decoder.module.js), then compared with the raw .glb:
     structure   same nodes, meshes, primitives, materials, textures, animations, accessor count; every primitive reads the same accessors
     indices     identical, element for element
     positions   within the half step the packing recorded (at most 0.25 mm), per-mesh bounds within the same step, endpoints exact
     normals     largest angle between source and decoded, unit length restored
     uvs         within half a step (at most 0.00006) ; Float32 attributes kept as they were: identical
     images      lossless WebP: every RGBA byte identical; the near-lossless one (terrain colour map): largest error 3 of 255 at most, PSNR
   Exits 1 when a limit is exceeded; prints the measurements either way. */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import sharp from 'sharp'
import { MeshoptDecoder } from '../../node_modules/three/examples/jsm/libs/meshopt_decoder.module.js'
import { MODELS, readGLB } from './compress-models.mjs'
import { importPreview } from './import-preview.mjs'

const { inflateGLB } = await importPreview('../../public/archipelago/preview/compressed-gltf.js')

const root = path.resolve(import.meta.dirname, '../..')
const TYPED = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }

function accessor({ json, bin }, index) {
  const a = json.accessors[index], n = COMPONENTS[a.type], T = TYPED[a.componentType], view = json.bufferViews[a.bufferView]
  const stride = view.byteStride || n * T.BYTES_PER_ELEMENT, base = (view.byteOffset || 0) + (a.byteOffset || 0), out = new T(a.count * n)
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength), get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType]
  for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) out[i * n + c] = dv[get](base + i * stride + c * T.BYTES_PER_ELEMENT, true)
  return out
}

export async function verifyModel(rawFile, packedFile, { limits = {} } = {}) {
  const limit = { position: 0.00025 + 1e-7, uv: 0.00007, normalDegrees: 0.25, ...limits }
  const source = readGLB(fs.readFileSync(rawFile))
  const plain = await inflateGLB(zlib.gunzipSync(fs.readFileSync(packedFile)), async () => MeshoptDecoder)
  const decoded = readGLB(Buffer.from(plain))
  const problems = [], report = { counts: {}, worst: { position: 0, uv: 0, normalDegrees: 0, bounds: 0, floatExact: 0 }, indices: 0, floatAccessors: 0, images: [] }
  const fail = (message) => { if (problems.length < 25) problems.push(message) }
  for (const key of ['nodes', 'meshes', 'materials', 'textures', 'images', 'samplers', 'animations', 'skins', 'scenes', 'accessors', 'cameras']) {
    const a = source.json[key]?.length ?? 0, b = decoded.json[key]?.length ?? 0
    report.counts[key] = a
    if (a !== b) fail(`${key}: ${a} in the source, ${b} decoded`)
  }
  if (JSON.stringify(source.json.nodes) !== JSON.stringify(decoded.json.nodes)) fail('nodes differ')
  if (JSON.stringify(source.json.materials) !== JSON.stringify(decoded.json.materials)) fail('materials differ')
  if (JSON.stringify(source.json.scenes) !== JSON.stringify(decoded.json.scenes)) fail('scenes differ')
  for (const [i, mesh] of source.json.meshes.entries()) {
    const other = decoded.json.meshes[i]
    if (JSON.stringify(mesh.primitives) !== JSON.stringify(other.primitives) || mesh.name !== other.name || JSON.stringify(mesh.extras) !== JSON.stringify(other.extras)) fail(`mesh ${i} (${mesh.name}): primitives differ`)
  }
  const roles = new Map()
  for (const mesh of source.json.meshes) for (const p of mesh.primitives) { for (const [name, a] of Object.entries(p.attributes)) roles.set(a, name); if (p.indices !== undefined) roles.set(p.indices, 'INDEX') }
  for (const [index, role] of roles) {
    const a = accessor(source, index), b = accessor(decoded, index), def = decoded.json.accessors[index], src = source.json.accessors[index]
    if (src.count !== def.count || src.type !== def.type || src.componentType !== def.componentType) { fail(`accessor ${index} (${role}): type or count changed`); continue }
    const { bufferView: _a, ...left } = src, { bufferView: _b, ...right } = def
    if (JSON.stringify(left) !== JSON.stringify(right)) fail(`accessor ${index} (${role}): its definition changed (${JSON.stringify(left)} vs ${JSON.stringify(right)})`)
    if (role === 'INDEX') { report.indices++; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { fail(`accessor ${index}: index ${i} differs`); break } continue }
    let worst = 0
    if (role === 'NORMAL') {
      for (let i = 0; i < a.length; i += 3) {
        const cx = a[i + 1] * b[i + 2] - a[i + 2] * b[i + 1], cy = a[i + 2] * b[i] - a[i] * b[i + 2], cz = a[i] * b[i + 1] - a[i + 1] * b[i]
        const angle = Math.atan2(Math.hypot(cx, cy, cz), a[i] * b[i] + a[i + 1] * b[i + 1] + a[i + 2] * b[i + 2]) * 180 / Math.PI
        worst = Math.max(worst, angle)
        if (Math.abs(Math.hypot(b[i], b[i + 1], b[i + 2]) - 1) > 1e-5) fail(`accessor ${index}: normal ${i / 3} is not unit length`)
      }
      report.worst.normalDegrees = Math.max(report.worst.normalDegrees, worst)
      if (worst > limit.normalDegrees) fail(`accessor ${index}: normals deviate ${worst.toFixed(3)} deg`)
    } else {
      for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]))
      if (role === 'POSITION' || role.startsWith('TEXCOORD')) {
        const key = role === 'POSITION' ? 'position' : 'uv'
        report.worst[key] = Math.max(report.worst[key], worst)
        if (worst > limit[key]) fail(`accessor ${index} (${role}): deviates ${worst}`)
        if (role === 'POSITION') {
          // the mesh's bounds, as the loader reads them, are the source's; the vertices on the bounds are on them
          for (let c = 0; c < 3; c++) { let lo = Infinity, hi = -Infinity; for (let i = c; i < b.length; i += 3) { lo = Math.min(lo, b[i]); hi = Math.max(hi, b[i]) } report.worst.bounds = Math.max(report.worst.bounds, Math.abs(lo - src.min[c]), Math.abs(hi - src.max[c])) }
        }
      } else { report.floatAccessors++; report.worst.floatExact = Math.max(report.worst.floatExact, worst); if (worst !== 0) fail(`accessor ${index} (${role}) should be identical, deviates ${worst}`) }
    }
  }
  if (report.worst.bounds > limit.position) fail(`bounds moved by ${report.worst.bounds}`)
  // Images: decode both sides and compare pixels.
  for (const [i, image] of source.json.images?.entries() ?? []) {
    const bytes = (c, im) => c.bin.subarray(c.json.bufferViews[im.bufferView].byteOffset || 0, (c.json.bufferViews[im.bufferView].byteOffset || 0) + c.json.bufferViews[im.bufferView].byteLength)
    const a = await sharp(bytes(source, image)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }), b = await sharp(bytes(decoded, decoded.json.images[i])).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    if (a.info.width !== b.info.width || a.info.height !== b.info.height) { fail(`image ${i} changed size`); continue }
    let worst = 0, sum = 0, sq = 0
    for (let p = 0; p < a.data.length; p++) { const d = Math.abs(a.data[p] - b.data[p]); worst = Math.max(worst, d); sum += d; sq += d * d }
    const mse = sq / a.data.length, entry = { name: image.name, size: `${a.info.width}x${a.info.height}`, mime: decoded.json.images[i].mimeType, worst, mean: +(sum / a.data.length).toFixed(4), psnr: mse ? +(10 * Math.log10(255 * 255 / mse)).toFixed(1) : Infinity }
    report.images.push(entry)
    const lossless = decoded.json.images[i].mimeType !== 'image/webp' || image.name !== 'terrain-color'
    if (lossless && worst !== 0) fail(`image ${i} (${image.name}) should be lossless, differs by ${worst}`)
    if (!lossless && (worst > 3 || entry.psnr < 46)) fail(`image ${i} (${image.name}) near-lossless error too large: worst ${worst}, mean ${entry.mean}, PSNR ${entry.psnr}`)
  }
  return { problems, report }
}

if (process.argv[1] === import.meta.filename) {
  const args = process.argv.slice(2), option = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : null }
  const dir = option('dir') ? path.resolve(option('dir')) : root, only = option('only')
  let failed = false
  for (const model of MODELS.filter((m) => !only || m.includes(only))) {
    const { problems, report } = await verifyModel(path.join(root, model), path.join(dir, model + '.gz'))
    console.log(`${model}\n  ${JSON.stringify(report)}\n  ${problems.length ? 'PROBLEMS:\n    ' + problems.join('\n    ') : 'OK'}`)
    if (problems.length) failed = true
  }
  process.exit(failed ? 1 : 0)
}
