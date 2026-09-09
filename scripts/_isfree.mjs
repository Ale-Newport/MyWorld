import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
register('./_ts-loader.mjs', pathToFileURL('./scripts/'))
const L = await import('../src/content/world-layout.ts')
const { lineDistance } = await import('../src/content/world-environment.ts')
const W = await import('../src/content/world.ts')
for (const [x, z] of [[79.2, -91.4], [78.1, -91.5], [87.3, -93.8], [76.3, -89.1]]) {
  const b = L.blockedBy(x, z, { clearance: 3.6, coastMargin: 10, margin: { road: 2.5, circuit: 6, ramp: 8, landmark: 1.5, plate: 1, water: 0.8 } })
  const road = W.roads.find(r => r.id === 'ring-east')
  console.log(`  (${x}, ${z})  ${lineDistance(x, z, road.points).toFixed(1)} m from ring-east · blockedBy: ${b ? b.label ?? b.id : 'NOTHING'}`)
}
