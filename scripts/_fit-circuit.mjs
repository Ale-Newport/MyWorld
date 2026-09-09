import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
register('./_ts-loader.mjs', pathToFileURL('./scripts/'))
const { CIRCUIT, coastRadius } = await import('../src/content/world-environment.ts')
const { WORLD_RADIUS } = await import('../src/content/world.ts')

// Pull any control point that is too near the coast straight back
// towards the circuit's centre until it has the margin it needs.
const MARGIN = 18
const pts = CIRCUIT.points.map(([x, z]) => [x, z])
for (let pass = 0; pass < 400; pass++) {
  let worst = -Infinity, at = -1
  for (let i = 0; i < pts.length; i++) {
    const wx = pts[i][0] + CIRCUIT.x, wz = pts[i][1] + CIRCUIT.z
    const over = Math.hypot(wx, wz) - (coastRadius(wx, wz, WORLD_RADIUS) - MARGIN)
    if (over > worst) { worst = over; at = i }
  }
  if (worst <= 0) break
  const wx = pts[at][0] + CIRCUIT.x, wz = pts[at][1] + CIRCUIT.z
  const len = Math.hypot(wx, wz) || 1
  pts[at][0] -= (wx / len) * 0.5
  pts[at][1] -= (wz / len) * 0.5
}
let length = 0
for (let i = 0; i < pts.length; i++) {
  const a = pts[i], b = pts[(i + 1) % pts.length]
  length += Math.hypot(b[0] - a[0], b[1] - a[1])
}
let margin = Infinity
for (const [x, z] of pts) {
  const wx = x + CIRCUIT.x, wz = z + CIRCUIT.z
  margin = Math.min(margin, coastRadius(wx, wz, WORLD_RADIUS) - Math.hypot(wx, wz))
}
console.log(`lap ${length.toFixed(0)} m · coast margin ${margin.toFixed(1)} m`)
console.log(pts.map(([x, z]) => `[${Math.round(x)},${Math.round(z)}]`).join(','))
