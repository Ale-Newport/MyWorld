/* What the repository keeps of the published world, and what is made from it.

   KEPT IN GIT (the sources): content/world/editor-world.json and content/world/asset-definitions.json,
   as plain, compact JSON. Plain text is the point: git stores a new version of it as a small
   difference from the previous one (a typical world edit adds a few hundred KB to the history),
   where a gzip file is a different blob each time (about 7 MB per publish).

   MADE FROM THEM (never committed, ignored by git): public/archipelago/seed/ (the world gzipped, the
   asset definitions copied) and src/server/world-seed.json (their hashes), by `npm run world:seed`.
   Dev, build, test and the Cloudflare build run it first. The gzip is deterministic, and the hashes are
   made together with the files they describe, so they can never disagree. */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { importPreview } from './import-preview.mjs'
import { writeFiles } from './write-files.mjs'

const { compactWorldDocument, shortenFloat32Arrays } = await importPreview('../../public/archipelago/preview/world-instances.js')

export const root = path.resolve(import.meta.dirname, '../..')
export const SOURCE_FILES = { world: 'editor-world.json', assets: 'asset-definitions.json' }
export const SEED_FILES = { world: 'editor-world.json.gz', assets: 'asset-definitions.json' }
export const defaults = {
  sourceDir: path.join(root, 'content/world'),
  seedDir: path.join(root, 'public/archipelago/seed'),
  manifest: path.join(root, 'src/server/world-seed.json'),
}

export const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const isGzip = (bytes) => bytes[0] === 0x1f && bytes[1] === 0x8b

/** Deterministic: level 9, no timestamp, and the header's OS byte pinned (zlib writes the host's). */
export function gzip(bytes) { const out = zlib.gzipSync(bytes, { level: 9 }); out[4] = out[5] = out[6] = out[7] = 0; out[9] = 3; return out }

/** A world document, gzipped or not, as the compact JSON text the studio saves (and git keeps). */
export function compactWorldJson(bytes) {
  const doc = JSON.parse((isGzip(bytes) ? zlib.gunzipSync(bytes) : bytes).toString('utf8'))
  return Buffer.from(JSON.stringify(compactWorldDocument(doc)))
}

/** Asset definitions as the compact JSON text the studio saves. */
export function compactAssetsJson(bytes) {
  const doc = JSON.parse(bytes.toString('utf8'))
  for (const definition of doc.definitions ?? []) shortenFloat32Arrays(definition.object)
  return Buffer.from(JSON.stringify(doc))
}

export const compactSource = (key, bytes) => (key === 'world' ? compactWorldJson(bytes) : compactAssetsJson(bytes))

/** Write the two source files (all or nothing). */
export function writeSources(entries, sourceDir = defaults.sourceDir) {
  writeFiles(Object.entries(SOURCE_FILES).map(([key, file]) => [path.join(sourceDir, file), entries[key]]))
}

/** Make the seed files and the manifest from the sources. Returns false when they were already up to date. */
export function buildSeed({ sourceDir = defaults.sourceDir, seedDir = defaults.seedDir, manifestFile = defaults.manifest, force = false } = {}) {
  const sources = {}
  for (const [key, file] of Object.entries(SOURCE_FILES)) sources[key] = fs.readFileSync(path.join(sourceDir, file))
  const source = { world: sha256(sources.world), assets: sha256(sources.assets) }
  if (!force) {
    try {
      const current = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
      const present = Object.values(SEED_FILES).every((file) => fs.existsSync(path.join(seedDir, file)))
      if (present && current.source?.world === source.world && current.source?.assets === source.assets) return false
    } catch { /* no manifest yet */ }
  }
  const out = { world: gzip(sources.world), assets: sources.assets }
  const manifest = { source }
  const files = []
  for (const [key, file] of Object.entries(SEED_FILES)) {
    files.push([path.join(seedDir, file), out[key]])
    manifest[key] = { path: `/archipelago/seed/${file}`, sha: sha256(out[key]), size: out[key].length }
  }
  // The seed files and the manifest that describes them land together, or not at all.
  writeFiles([...files, [manifestFile, JSON.stringify(manifest, null, 2) + '\n']])
  return manifest
}
