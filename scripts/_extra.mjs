/** Bridges and ramps, for the road-clearance probe's exclusions. */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
register('./_ts-loader.mjs', pathToFileURL('./scripts/'))
const W = await import('../src/content/world.ts')
const E = await import('../src/content/world-environment.ts')
console.log(JSON.stringify({
  bridges: E.BRIDGES.map((b) => ({ x: b.x, z: b.z, length: b.length, width: b.width, rotation: b.rotation })),
  ramps: W.ramps.map((r) => ({ x: r.x, z: r.z, length: r.length })),
}))
