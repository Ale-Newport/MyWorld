// Rasterise only the generated source-geometry map, never an old /world image.
import sharp from 'sharp'
import { readFile } from 'node:fs/promises'
const svg = await readFile(new URL('../public/world2/map.svg', import.meta.url))
await sharp(svg).resize(1024, 1024).png({ compressionLevel: 9 }).toFile(new URL('../public/world2/map.png', import.meta.url).pathname)
console.log('[world2] Generated map.png from the Blender terrain bake and projected meshes')
