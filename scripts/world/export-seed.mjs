/* Makes the world the repository keeps (content/world: the world document and the asset definitions,
   as compact JSON) from a published release, from files, or from itself, and builds the seed from it
   (public/archipelago/seed and src/server/world-seed.json, see seed-lib.mjs). Each file's SHA-256 is
   checked against the release before anything is written.

   The files are written the way the studio saves them (public/archipelago/preview/world-instances.js,
   compactWorldDocument): map surfaces keep no triangulation or textures (they are regenerated from their
   definition on every restore), Float32 arrays use their shortest round-trip decimals. Exporting a
   document that is already compact writes the same bytes.

     node scripts/world/export-seed.mjs [base-url]       download the published release
     node scripts/world/export-seed.mjs --world-file <f> --assets-file <f>
                                                         make these two files the world (what the editor's Publish does)
     node scripts/world/export-seed.mjs --from-seed      re-encode the sources already in content/world
     node scripts/world/export-seed.mjs --check          exit 1 unless the sources are compact and the seed is made from them
   Options: --source-dir, --seed-dir and --manifest <path> work elsewhere than the repository's own folders. */
import fs from 'node:fs'
import path from 'node:path'
import { buildSeed, compactSource, defaults, sha256, SEED_FILES, SOURCE_FILES, writeSources } from './seed-lib.mjs'

const args = process.argv.slice(2)
const flag = (name) => args.includes('--' + name)
const option = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 ? path.resolve(args[i + 1]) : fallback }
const sourceDir = option('source-dir', defaults.sourceDir)
const seedDir = option('seed-dir', defaults.seedDir)
const manifestFile = option('manifest', defaults.manifest)

function write(entries, note) {
  writeSources(entries, sourceDir)
  buildSeed({ sourceDir, seedDir, manifestFile, force: true })
  for (const [key, file] of Object.entries(SOURCE_FILES)) console.log(`${file}: ${(entries[key].length / 1e6).toFixed(2)} MB · ${sha256(entries[key]).slice(0, 12)}`)
  console.log(note)
}

if (flag('check')) {
  const problems = []
  let manifest
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) } catch { manifest = null }
  for (const [key, file] of Object.entries(SOURCE_FILES)) {
    const bytes = fs.readFileSync(path.join(sourceDir, file))
    if (Buffer.compare(compactSource(key, bytes), bytes) !== 0) problems.push(`${file} is not in its compact form`)
    if (manifest?.source?.[key] !== sha256(bytes)) problems.push(`the seed was not made from the current ${file} (run: npm run world:seed)`)
  }
  for (const file of Object.values(SEED_FILES)) if (!fs.existsSync(path.join(seedDir, file))) problems.push(`${file} is missing from the seed`)
  if (problems.length) { console.error(problems.join('\n') + '\nto re-encode the sources: node scripts/world/export-seed.mjs --from-seed'); process.exit(1) }
  console.log('world sources are compact and the seed is made from them')
} else if (flag('world-file')) {
  write({
    world: compactSource('world', fs.readFileSync(option('world-file'))),
    assets: compactSource('assets', fs.readFileSync(option('assets-file'))),
  }, 'world = the world as the editor published it')
} else if (flag('from-seed')) {
  const entries = {}
  for (const [key, file] of Object.entries(SOURCE_FILES)) entries[key] = compactSource(key, fs.readFileSync(path.join(sourceDir, file)))
  write(entries, 'sources re-encoded in place (same world)')
} else {
  const BASE = args.find((a) => /^https?:/.test(a)) ?? 'http://localhost:3210'
  const release = await (await fetch(`${BASE}/api/world/release`)).json()
  const entries = {}
  for (const key of Object.keys(SOURCE_FILES)) {
    const ref = release[key]
    const bytes = Buffer.from(await (await fetch(`${BASE}${ref.url}`)).arrayBuffer())
    const sha = sha256(bytes)
    if (sha !== ref.sha) throw new Error(`${key}: downloaded ${sha}, release says ${ref.sha}`)
    entries[key] = compactSource(key, bytes)
  }
  write(entries, `world = release ${release.revision} (published ${new Date(release.publishedAt).toISOString()})`)
}
