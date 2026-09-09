import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
register('./_ts-loader.mjs', pathToFileURL('./scripts/'))
const W = await import('../src/content/world.ts')
const E = await import('../src/content/world-environment.ts')
console.log(JSON.stringify({ bridges: E.BRIDGES, ramps: W.ramps.map(r => ({ x: r.x, z: r.z, length: r.length })) }))
