import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'

const root = path.resolve(import.meta.dirname, '../..')
const models = [
  'public/archipelago/exports/AlejandroWorld.glb',
  'public/archipelago/assets/environment/portfolio/models/world.glb',
  'public/archipelago/assets/environment/portfolio/models/vegetation.glb',
]

for (const model of models) {
  const file = path.join(root, model)
  const source = await readFile(file)
  const compressed = gzipSync(source, { level: 6 })
  await writeFile(`${file}.gz`, compressed)
  console.log(`${model}: ${(source.length / 1e6).toFixed(1)} MB → ${(compressed.length / 1e6).toFixed(1)} MB`)
}
