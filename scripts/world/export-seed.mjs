/* Makes the currently published world the one the repository ships: downloads the
   published release's two files (world document, asset definitions) and writes them
   to content/seed/world/archipelago, which a fresh install serves until its first
   world save. Checks each file's SHA-256 against the release before writing.
   node scripts/world/export-seed.mjs [base-url] */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
const BASE = process.argv[2] ?? 'http://localhost:3210'
const release = await (await fetch(`${BASE}/api/world/release`)).json()
const dir = path.resolve('content/seed/world/archipelago')
for (const [key, file] of [['world', 'editor-world.json.gz'], ['assets', 'asset-definitions.json']]) {
  const ref = release[key]
  const bytes = Buffer.from(await (await fetch(`${BASE}${ref.url}`)).arrayBuffer())
  const sha = crypto.createHash('sha256').update(bytes).digest('hex')
  if (sha !== ref.sha) throw new Error(`${key}: downloaded ${sha}, release says ${ref.sha}`)
  fs.writeFileSync(path.join(dir, file), bytes)
  console.log(`${file}: ${(bytes.length / 1e6).toFixed(2)} MB · ${sha.slice(0, 12)}`)
}
console.log(`seed = release ${release.revision} (published ${new Date(release.publishedAt).toISOString()})`)
