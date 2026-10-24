/* gzip copies of the vehicle GLBs the player loads at startup (scripts/world/compress-models.mjs does the island's models).
   The raw .glb stays: the studio and the Blender workflow read it, and the player falls back to it if the copy is missing.
     node scripts/world/compress-vehicle-models.mjs          write the copies
     node scripts/world/compress-vehicle-models.mjs --check  exit 1 when a copy is missing or stale */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'

const root = path.resolve(import.meta.dirname, '../..')
export const VEHICLE_MODELS = ['public/archipelago/assets/vehicles/plane/corsair.glb']

export async function compressVehicleModels({ check = false } = {}) {
  const stale = []
  for (const model of VEHICLE_MODELS) {
    const file = path.join(root, model)
    const source = await readFile(file)
    const existing = await readFile(`${file}.gz`).then((b) => gunzipSync(b), () => null)
    if (existing && Buffer.compare(existing, source) === 0) continue
    if (check) { stale.push(model); continue }
    const compressed = gzipSync(source, { level: 9 })
    await writeFile(`${file}.gz`, compressed)
    console.log(`${model}: ${(source.length / 1e3).toFixed(0)} KB → ${(compressed.length / 1e3).toFixed(0)} KB`)
  }
  return stale
}

if (process.argv[1] === import.meta.filename) {
  const stale = await compressVehicleModels({ check: process.argv.includes('--check') })
  if (stale.length) { console.error('stale or missing gzip copies:', stale.join(', ')); process.exit(1) }
}
