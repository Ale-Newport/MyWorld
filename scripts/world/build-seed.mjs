/* Makes the world seed the site serves from the sources the repository keeps (content/world):
   public/archipelago/seed/* and src/server/world-seed.json. See seed-lib.mjs. Nothing to do (and quick)
   when they are already current.
     node scripts/world/build-seed.mjs [--force] [--source-dir <dir>] [--seed-dir <dir>] [--manifest <file>] */
import path from 'node:path'
import { buildSeed, defaults } from './seed-lib.mjs'

const args = process.argv.slice(2)
const option = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 ? path.resolve(args[i + 1]) : fallback }
const made = buildSeed({
  force: args.includes('--force'),
  sourceDir: option('source-dir', defaults.sourceDir),
  seedDir: option('seed-dir', defaults.seedDir),
  manifestFile: option('manifest', defaults.manifest),
})
if (made) console.log(`world seed built: ${(made.world.size / 1e6).toFixed(2)} MB gzipped · ${made.world.sha.slice(0, 12)}`)
