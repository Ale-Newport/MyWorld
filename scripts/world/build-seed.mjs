/* Makes the world seed the site serves from the sources the repository keeps (content/world):
   public/archipelago/seed/* and src/server/world-seed.json. See seed-lib.mjs. Nothing to do (and quick)
   when they are already current.
     node scripts/world/build-seed.mjs [--force] */
import { buildSeed } from './seed-lib.mjs'

const made = buildSeed({ force: process.argv.includes('--force') })
if (made) console.log(`world seed built: ${(made.world.size / 1e6).toFixed(2)} MB gzipped · ${made.world.sha.slice(0, 12)}`)
