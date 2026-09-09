import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
register('./_ts-loader.mjs', pathToFileURL('./scripts/'))
const W = await import('../src/content/world.ts')
const E = await import('../src/content/world-environment.ts')
const out = {}
for (const lm of W.landmarks) if (lm.minigame) out[lm.minigame] = { x: lm.x, z: lm.z }
for (const spot of E.PLAY_SPOTS) {
  out[spot.id] = { x: spot.x, z: spot.z }
  if ('game' in spot) out[spot.game] = { x: spot.x, z: spot.z }
}
out.circuit = { x: E.CIRCUIT.x + E.CIRCUIT.points[0][0], z: E.CIRCUIT.z + E.CIRCUIT.points[0][1] }
out.labyrinth = { x: W.districtById.labyrinth.x, z: W.districtById.labyrinth.z + 40 }
console.log(JSON.stringify(out))
