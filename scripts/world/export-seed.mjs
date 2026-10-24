/* Makes the currently published world the one the repository ships: downloads the
   published release's two files (world document, asset definitions) and writes them
   to public/archipelago/seed (static assets) and their hashes to
   src/server/world-seed.json; a fresh install serves them until its first world
   save. Checks each file's SHA-256 against the release before writing.

   The files are written the way the studio now saves them (public/archipelago/preview/world-instances.js,
   compactWorldDocument): map surfaces keep no triangulation or textures (they are regenerated from their
   definition on every restore), Float32 arrays use their shortest round-trip decimals. Nothing the player or
   the studio can observe changes, the gzip shrinks from 17 MB to about 7 MB, and exporting a document that is
   already compact writes the same bytes (the gzip is deterministic).

     node scripts/world/export-seed.mjs [base-url]       download the published release
     node scripts/world/export-seed.mjs --from-seed      re-encode the files already in the seed folder
     node scripts/world/export-seed.mjs --check          exit 1 unless the seed files are compact and world-seed.json describes them
   Options: --seed-dir <dir> and --manifest <file> work elsewhere than the repository's own seed (a scratch copy). */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { importPreview } from './import-preview.mjs'
import { writeFiles } from './write-files.mjs'

const { compactWorldDocument, shortenFloat32Arrays } = await importPreview('../../public/archipelago/preview/world-instances.js')

const args = process.argv.slice(2)
const flag = (name) => args.includes('--' + name)
const option = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 ? path.resolve(args[i + 1]) : fallback }
const root = path.resolve(import.meta.dirname, '../..')
const dir = option('seed-dir', path.join(root, 'public/archipelago/seed'))
const manifestFile = option('manifest', path.join(root, 'src/server/world-seed.json'))
const FILES = [['world', 'editor-world.json.gz'], ['assets', 'asset-definitions.json']]

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const isGzip = (bytes) => bytes[0] === 0x1f && bytes[1] === 0x8b
/** Deterministic: level 9, no timestamp, and the header's OS byte pinned (zlib writes the host's). */
export function gzip(bytes) { const out = zlib.gzipSync(bytes, { level: 9 }); out[4] = out[5] = out[6] = out[7] = 0; out[9] = 3; return out }

/** The bytes of the seed file as the studio would save it. */
export function compactSeedFile(key, bytes) {
  if (key === 'world') {
    const doc = JSON.parse((isGzip(bytes) ? zlib.gunzipSync(bytes) : bytes).toString('utf8'))
    return gzip(Buffer.from(JSON.stringify(compactWorldDocument(doc))))
  }
  const doc = JSON.parse(bytes.toString('utf8'))
  for (const definition of doc.definitions ?? []) shortenFloat32Arrays(definition.object)
  return Buffer.from(JSON.stringify(doc))
}

function writeSeed(entries, note) {
  const manifest = {}, files = []
  for (const [key, file] of FILES) {
    const bytes = entries[key]
    files.push([path.join(dir, file), bytes])
    manifest[key] = { path: `/archipelago/seed/${file}`, sha: sha256(bytes), size: bytes.length }
    console.log(`${file}: ${(bytes.length / 1e6).toFixed(2)} MB · ${manifest[key].sha.slice(0, 12)}`)
  }
  // The seed files and the manifest that describes them land together, or not at all.
  writeFiles([...files, [manifestFile, JSON.stringify(manifest, null, 2) + '\n']])
  console.log(note)
}

if (flag('check')) {
  let manifest
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) } catch { manifest = null }
  const problems = []
  for (const [key, file] of FILES) {
    const bytes = fs.readFileSync(path.join(dir, file))
    if (manifest?.[key]?.sha !== sha256(bytes) || manifest?.[key]?.size !== bytes.length) problems.push(`${file} does not match ${path.relative(root, manifestFile)}`)
    if (Buffer.compare(compactSeedFile(key, bytes), bytes) !== 0) problems.push(`${file} is not in its compact form`)
  }
  if (problems.length) { console.error(problems.join('\n') + '\nrun: node scripts/world/export-seed.mjs --from-seed'); process.exit(1) }
  console.log('seed files are compact and described by world-seed.json')
} else if (flag('from-seed')) {
  const entries = {}
  for (const [key, file] of FILES) entries[key] = compactSeedFile(key, fs.readFileSync(path.join(dir, file)))
  writeSeed(entries, 'seed re-encoded in place (same world, smaller files)')
} else {
  const BASE = args.find((a) => /^https?:/.test(a)) ?? 'http://localhost:3210'
  const release = await (await fetch(`${BASE}/api/world/release`)).json()
  const entries = {}
  for (const [key] of FILES) {
    const ref = release[key]
    const bytes = Buffer.from(await (await fetch(`${BASE}${ref.url}`)).arrayBuffer())
    const sha = sha256(bytes)
    if (sha !== ref.sha) throw new Error(`${key}: downloaded ${sha}, release says ${ref.sha}`)
    entries[key] = compactSeedFile(key, bytes)
  }
  writeSeed(entries, `seed = release ${release.revision} (published ${new Date(release.publishedAt).toISOString()})`)
}
