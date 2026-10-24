/* The player's models, as small as they can be without changing what is drawn.

   Blender's exports stay as they are (they are what Blender and a GLB export read; neither the player nor the studio downloads them).
   Next to each one this writes a .glb.gz that both the player and the studio download: a GLB whose mesh data is meshopt-compressed (EXT_meshopt_compression) and quantised,
   and whose PNGs are WebP, then gzipped. public/archipelago/preview/compressed-gltf.js reads it back into an ordinary GLB
   (Float32 attributes, as the Blender export has them) before GLTFLoader parses it, so nothing downstream knows the difference.

     node scripts/world/compress-models.mjs                  write the .glb.gz files
     node scripts/world/compress-models.mjs --check          exit 1 when a .glb.gz is missing, stale (its source changed) or not this format
     node scripts/world/compress-models.mjs --lossless       float32 + meshopt only (no quantisation, lossless WebP): a fallback if a quantised model ever shows a defect
     options: --out <dir> writes there instead (a scratch copy of the tree); --only <substring> picks models; --report prints per-attribute bytes

   What changes, per attribute (everything else, indices included, comes back bit for bit):
     POSITION   16 bits per axis over the accessor's own bounds, only when the half step is at most 0.25 mm (an extent of 33 m); larger meshes stay Float32
     NORMAL     octahedral, 10 bits per component (about 0.15 degrees), unit length restored on load; Float32 if any normal is not a unit vector
     TEXCOORD   16 bits per axis over the accessor's bounds, only when they span at most 8 units (half step 0.00006: a quarter of a texel at 2048 px)
     indices    meshopt index sequence: every index in its place
     the rest   Float32, meshopt-coded without loss (vertex colours, UV sets spanning more than 8 units, ...)
     images     WebP, lossless (alpha and the colours under it preserved) wherever that is smaller than the PNG; the terrain colour map, which
                is 1 MB of dithered ground colour, is near-lossless WebP (no channel off by more than 2 of 255)
   The format needs EXT_meshopt_compression, KHR_mesh_quantization, EXT_texture_webp and PORTFOLIO_range_quantization (unsigned 16-bit
   normalised accessors with extras.portfolioRange {min, max} decode as min + c / 65535 * (max - min)); the last one is why no other viewer can mistake it for a
   plain glTF. The source's SHA-256 is recorded in asset.extras.portfolioPack so --check knows when a copy is stale. */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import sharp from 'sharp'
import { writeFiles } from './write-files.mjs'
import { MeshoptEncoder } from 'meshoptimizer/encoder'

export const FORMAT = 'portfolio-meshopt-1'
export const OPTIONS = { positionHalfStepMetres: 0.00025, normalBits: 10, uvMaxRange: 8, vertexLevel: 3, nearLosslessImages: { 'terrain-color': 60 } }
export const MODELS = [
  'public/archipelago/exports/AlejandroWorld.glb',
  'public/archipelago/assets/environment/portfolio/models/world.glb',
  'public/archipelago/assets/environment/portfolio/models/vegetation.glb',
]
const ORDER = ['INDEX', 'POSITION', 'NORMAL', 'TEXCOORD', 'COLOR']
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }
const TYPED = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }

export function readGLB(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB')
  let offset = 12, json = null, bin = null
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32LE(offset), type = buffer.readUInt32LE(offset + 4), data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'))
    else if (type === 0x004e4942 && !bin) bin = data
    offset += 8 + length + ((4 - (length % 4)) % 4)
  }
  return { json, bin }
}
export function writeGLB(json, bin) {
  const text = Buffer.from(JSON.stringify(json), 'utf8'), jsonPad = (4 - (text.length % 4)) % 4, binPad = (4 - (bin.length % 4)) % 4
  const total = 12 + 8 + text.length + jsonPad + 8 + bin.length + binPad, out = Buffer.alloc(total)
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8)
  out.writeUInt32LE(text.length + jsonPad, 12); out.writeUInt32LE(0x4e4f534a, 16); text.copy(out, 20); out.fill(0x20, 20 + text.length, 20 + text.length + jsonPad)
  const at = 20 + text.length + jsonPad
  out.writeUInt32LE(bin.length + binPad, at); out.writeUInt32LE(0x004e4942, at + 4); Buffer.from(bin.buffer, bin.byteOffset, bin.length).copy(out, at + 8)
  return out
}

/** The accessor's elements as a tightly packed typed array (a copy). */
function readAccessor(json, bin, index) {
  const a = json.accessors[index], n = TYPE_COMPONENTS[a.type], T = TYPED[a.componentType], view = json.bufferViews[a.bufferView]
  const stride = view.byteStride || n * T.BYTES_PER_ELEMENT, base = (view.byteOffset || 0) + (a.byteOffset || 0), out = new T(a.count * n)
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength), get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType]
  for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) out[i * n + c] = dv[get](base + i * stride + c * T.BYTES_PER_ELEMENT, true)
  return out
}
const bytesOf = (typed) => new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength)
const ranges = (array, n) => {
  const min = new Array(n).fill(Infinity), max = new Array(n).fill(-Infinity)
  for (let i = 0; i < array.length; i++) { const c = i % n, v = array[i]; if (v < min[c]) min[c] = v; if (v > max[c]) max[c] = v }
  return { min, max }
}
/** Unsigned 16-bit codes over [min, max] per axis, `stride` elements per vertex (the spare ones stay 0). */
function quantizeRange(array, n, stride, { min, max }) {
  const out = new Uint16Array((array.length / n) * stride)
  for (let i = 0, v = 0; i < array.length; i += n, v++) for (let c = 0; c < n; c++) { const span = max[c] - min[c]; out[v * stride + c] = span > 0 ? Math.round(((array[i + c] - min[c]) / span) * 65535) : 0 }
  return out
}

/** Packs one GLB (a Buffer) the way described above. Returns the new GLB and what it did. */
export async function packGLB(source, { lossless = false, ...override } = {}) {
  await MeshoptEncoder.ready
  const options = { ...OPTIONS, ...override }
  const { json, bin } = readGLB(source)
  const accessors = json.accessors ?? [], views = json.bufferViews ?? []
  // The unpacking rewrites accessors, images and buffer views; anything else that points into a buffer view would be left dangling.
  const unsupported = (json.extensionsUsed ?? []).filter((name) => /draco|meshopt|gpu_instancing|basisu|texture_ktx/i.test(name))
  if (unsupported.length || accessors.some((a) => a.sparse)) throw new Error(`cannot pack: ${unsupported.join(', ') || 'sparse accessors'} refer to buffer views`)
  const stats = { accessors: { total: accessors.length, packed: 0, left: 0, shared: 0 }, bytes: {}, quantized: { position: 0, positionKept: 0, normal: 0, normalKept: 0, uv: 0, uvKept: 0 }, images: [], maxStep: { position: 0, uv: 0 } }
  const count = (key, bytes) => { stats.bytes[key] = (stats.bytes[key] ?? 0) + bytes }

  // Which accessors feed meshes (and as what), and which bufferViews anyone else needs untouched.
  const role = new Map(), otherUse = new Set(), viewUsers = new Map()
  const assign = (accessor, what) => { const known = role.get(accessor); if (known && known !== what) otherUse.add(accessor); role.set(accessor, what) }
  for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) {
    for (const [name, accessor] of Object.entries(primitive.attributes)) assign(accessor, name)
    if (primitive.indices !== undefined) { if ((primitive.mode ?? 4) === 4) assign(primitive.indices, 'INDEX'); else otherUse.add(primitive.indices) }
    if (primitive.targets) for (const target of primitive.targets) for (const accessor of Object.values(target)) otherUse.add(accessor)
  }
  for (const animation of json.animations ?? []) for (const s of animation.samplers) { otherUse.add(s.input); otherUse.add(s.output) }
  for (const skin of json.skins ?? []) if (skin.inverseBindMatrices !== undefined) otherUse.add(skin.inverseBindMatrices)
  accessors.forEach((a, i) => { if (a.bufferView !== undefined) (viewUsers.get(a.bufferView) ?? viewUsers.set(a.bufferView, new Set()).get(a.bufferView)).add(i) })

  const chunks = [], fallback = { length: 0 }
  let offset = 0
  const place = (bytes) => { const at = offset; chunks.push([at, bytes]); offset += (bytes.length + 3) & ~3; return at }
  const newViews = [], viewMap = new Map(), seen = new Map(), deferred = []
  const packed = (index) => {
    const a = accessors[index]
    if (a.sparse || a.bufferView === undefined || a.byteOffset || otherUse.has(index)) return null
    if (viewUsers.get(a.bufferView).size !== 1 || views[a.bufferView].byteStride) return null
    return a
  }

  // Meshes: every accessor they use becomes a meshopt bufferView of its own (identical payloads share one).
  for (const [index, name] of [...role].sort((x, y) => x[0] - y[0])) {
    const a = packed(index)
    if (!a) { stats.accessors.left++; continue }
    const n = TYPE_COMPONENTS[a.type], source = readAccessor(json, bin, index)
    let payload, stride, mode = 'ATTRIBUTES', filter = null, patch = {}
    if (name === 'INDEX') {
      if (a.componentType !== 5123 && a.componentType !== 5125) { stats.accessors.left++; continue }
      // The sequence codec, not the triangle one: it gives back every index in its place (the triangle codec rotates 12% of the
      // triangles, the same triangle with another corner first), for 1.8% more bytes.
      stride = COMPONENT_BYTES[a.componentType]; payload = bytesOf(source); mode = 'INDICES'
    } else if (a.componentType !== 5126) { stats.accessors.left++; continue }
    else if (name === 'POSITION' && !lossless && n === 3) {
      const r = ranges(source, 3), span = Math.max(...r.max.map((m, c) => m - r.min[c])), step = span / 65535 / 2
      if (step <= options.positionHalfStepMetres) {
        payload = bytesOf(quantizeRange(source, 3, 4, r)); stride = 8; patch = { componentType: 5123, normalized: true, extras: { ...a.extras, portfolioRange: { min: r.min, max: r.max } } }
        stats.quantized.position++; stats.maxStep.position = Math.max(stats.maxStep.position, step)
      } else stats.quantized.positionKept++
    } else if (name === 'NORMAL' && !lossless && n === 3) {
      let unit = true
      for (let i = 0; i < source.length && unit; i += 3) if (Math.abs(Math.hypot(source[i], source[i + 1], source[i + 2]) - 1) > 1e-3) unit = false
      if (unit) {
        const four = new Float32Array(a.count * 4)
        for (let i = 0; i < a.count; i++) { four[i * 4] = source[i * 3]; four[i * 4 + 1] = source[i * 3 + 1]; four[i * 4 + 2] = source[i * 3 + 2] }
        payload = MeshoptEncoder.encodeFilterOct(four, a.count, 8, options.normalBits); stride = 8; filter = 'OCTAHEDRAL'; patch = { componentType: 5122, normalized: true }
        stats.quantized.normal++
      } else stats.quantized.normalKept++
    } else if (name.startsWith('TEXCOORD') && !lossless && n === 2) {
      const r = ranges(source, 2), span = Math.max(r.max[0] - r.min[0], r.max[1] - r.min[1])
      if (span <= options.uvMaxRange) {
        payload = bytesOf(quantizeRange(source, 2, 2, r)); stride = 4; patch = { componentType: 5123, normalized: true, extras: { ...a.extras, portfolioRange: { min: r.min, max: r.max } } }
        stats.quantized.uv++; stats.maxStep.uv = Math.max(stats.maxStep.uv, span / 65535 / 2)
      } else stats.quantized.uvKept++
    }
    if (!payload) { payload = bytesOf(source); stride = n * COMPONENT_BYTES[a.componentType]; if (stride % 4) { stats.accessors.left++; continue } }
    const key = [a.count, stride, mode, filter, a.componentType, JSON.stringify(patch)].join('|') + '|' + crypto.createHash('sha1').update(payload).digest('hex')
    let slot = seen.get(key)
    if (slot !== undefined) stats.accessors.shared++
    else {
      const data = mode === 'INDICES' ? MeshoptEncoder.encodeIndexSequence(payload, a.count, stride) : MeshoptEncoder.encodeVertexBufferLevel(payload, a.count, stride, options.vertexLevel, 0)
      const fallbackAt = fallback.length
      fallback.length += (a.count * stride + 3) & ~3
      const compression = { buffer: 0, byteOffset: 0, byteLength: data.length, byteStride: stride, count: a.count, mode, ...(filter ? { filter } : {}) }
      deferred.push({ compression, data, rank: ORDER.indexOf(name === 'INDEX' ? 'INDEX' : name.replace(/_\d+$/, '')) + 1 || ORDER.length + 1, order: deferred.length })
      slot = newViews.push({ buffer: 1, byteOffset: fallbackAt, byteLength: a.count * stride, ...(mode === 'ATTRIBUTES' ? { byteStride: stride } : {}), target: mode === 'INDICES' ? 34963 : 34962, extensions: { EXT_meshopt_compression: compression } }) - 1
      seen.set(key, slot)
      count(name === 'INDEX' ? 'INDEX' : name.replace(/_\d+$/, ''), data.length)
    }
    viewMap.set(index, slot)
    Object.assign(a, patch)
    stats.accessors.packed++
  }
  // Streams of one kind lie side by side, which is what gzip's 32 KB window wants (one kind after another saves 15% over mesh by mesh).
  for (const entry of deferred.sort((x, y) => x.rank - y.rank || x.order - y.order)) entry.compression.byteOffset = place(entry.data)
  // newViews hold the compressed ones so far; the viewIndex space is [kept views..., compressed views...].
  const keptViews = [], keptMap = new Map()
  const usedByPacked = new Set([...viewMap.keys()].map((i) => accessors[i].bufferView))
  const imageViews = new Set((json.images ?? []).map((image) => image.bufferView).filter((v) => v !== undefined))
  views.forEach((view, i) => {
    if (usedByPacked.has(i)) return
    if (imageViews.has(i)) return // rewritten below
    const at = place(bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength))
    keptMap.set(i, keptViews.push({ ...view, buffer: 0, byteOffset: at }) - 1)
  })

  // Images.
  let webp = false
  for (const [i, image] of (json.images ?? []).entries()) {
    const view = views[image.bufferView], png = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength)
    let best = { bytes: png, mime: image.mimeType }
    const lossy = options.nearLosslessImages[image.name] ?? null
    if (image.mimeType === 'image/png' || image.mimeType === 'image/jpeg') {
      const candidate = await sharp(png).webp(lossy && !lossless ? { nearLossless: true, quality: lossy, effort: 6 } : { lossless: true, exact: true, effort: 6 }).toBuffer()
      if (lossy && !lossless || candidate.length < png.length) best = { bytes: candidate, mime: 'image/webp' }
    }
    stats.images.push({ index: i, name: image.name, from: png.length, to: best.bytes.length, mime: best.mime, nearLossless: !!lossy && !lossless && best.mime === 'image/webp' })
    count('images', best.bytes.length)
    const at = place(best.bytes)
    keptMap.set(image.bufferView, keptViews.push({ buffer: 0, byteOffset: at, byteLength: best.bytes.length }) - 1)
    image.bufferView = keptMap.get(image.bufferView); image.mimeType = best.mime
    if (best.mime === 'image/webp') { webp = true; for (const texture of json.textures ?? []) if (texture.source === i) { texture.extensions = { ...texture.extensions, EXT_texture_webp: { source: i } }; delete texture.source } }
  }

  // Stitch the buffer views together: kept ones first, then the compressed ones, and point everything at its new index.
  const finalViews = [...keptViews, ...newViews], base = keptViews.length
  for (const [i, a] of accessors.entries()) {
    if (viewMap.has(i)) a.bufferView = base + viewMap.get(i)
    else if (a.bufferView !== undefined) { if (!keptMap.has(a.bufferView)) throw new Error(`accessor ${i} points at a buffer view that was dropped`); a.bufferView = keptMap.get(a.bufferView) }
  }
  json.bufferViews = finalViews
  const total = offset
  json.buffers = [{ byteLength: total }, { byteLength: fallback.length, extensions: { EXT_meshopt_compression: { fallback: true } } }]
  const used = new Set(json.extensionsUsed ?? [])
  for (const name of ['EXT_meshopt_compression', 'KHR_mesh_quantization', 'PORTFOLIO_range_quantization']) used.add(name)
  if (webp) used.add('EXT_texture_webp')
  json.extensionsUsed = [...used]
  json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), 'EXT_meshopt_compression', 'KHR_mesh_quantization', 'PORTFOLIO_range_quantization', ...(webp ? ['EXT_texture_webp'] : [])])]
  json.asset = { ...json.asset, extras: { ...json.asset?.extras, portfolioPack: { format: FORMAT, source: crypto.createHash('sha256').update(source).digest('hex'), lossless, options: lossless ? null : options } } }
  const out = Buffer.alloc(total)
  for (const [at, bytes] of chunks) out.set(bytes, at)
  return { glb: writeGLB(json, out), stats }
}

/** Deterministic gzip: level 9, no timestamp, the host's OS byte pinned. */
export function gzip(bytes) { const out = zlib.gzipSync(bytes, { level: 9 }); out[4] = out[5] = out[6] = out[7] = 0; out[9] = 3; return out }

const root = path.resolve(import.meta.dirname, '../..')
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')

/** What --check looks at: is there a copy, and was it made from this very source in this format. */
export function copyStatus(model, dir = root) {
  const source = path.join(root, model), target = path.join(dir, model + '.gz')
  if (!fs.existsSync(target)) return 'missing'
  let pack
  try { pack = readGLB(zlib.gunzipSync(fs.readFileSync(target))).json.asset?.extras?.portfolioPack } catch { return 'unreadable' }
  if (!pack || pack.format !== FORMAT) return 'old format (plain gzip)'
  if (pack.source !== sha256(fs.readFileSync(source))) return 'stale (the .glb changed)'
  if (!pack.lossless && JSON.stringify(pack.options) !== JSON.stringify(OPTIONS)) return 'stale (the packing options changed)'
  return 'current'
}

if (process.argv[1] === import.meta.filename) {
  const args = process.argv.slice(2), flag = (name) => args.includes('--' + name), option = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : null }
  const outDir = option('out') ? path.resolve(option('out')) : root, only = option('only'), lossless = flag('lossless')
  const models = MODELS.filter((m) => !only || m.includes(only))
  if (flag('check')) {
    const bad = models.map((m) => [m, copyStatus(m, outDir)]).filter(([, status]) => status !== 'current')
    if (bad.length) { console.error(bad.map(([m, s]) => `${m}.gz: ${s}`).join('\n') + '\nrun: node scripts/world/compress-models.mjs'); process.exit(1) }
    console.log('every .glb.gz is made from its current .glb')
  } else {
    for (const model of models) {
      const source = fs.readFileSync(path.join(root, model)), t = performance.now()
      const { glb, stats } = await packGLB(source, { lossless })
      const compressed = gzip(glb), target = path.join(outDir, model + '.gz')
      writeFiles([[target, compressed]])
      const before = fs.existsSync(path.join(root, model + '.gz')) ? fs.statSync(path.join(root, model + '.gz')).size : null
      console.log(`${model}: ${(source.length / 1e6).toFixed(1)} MB → ${(glb.length / 1e6).toFixed(2)} MB GLB → ${(compressed.length / 1e6).toFixed(2)} MB gz${before ? ` (was ${(before / 1e6).toFixed(2)} MB)` : ''} in ${((performance.now() - t) / 1e3).toFixed(1)} s`)
      if (flag('report')) console.log(JSON.stringify(stats, null, 1))
    }
  }
}
