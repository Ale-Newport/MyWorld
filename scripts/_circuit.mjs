import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
register('./_ts-loader.mjs', pathToFileURL('./scripts/'))
const { CIRCUIT, CIRCUIT_TRACK, coastRadius, lineDistance } = await import('../src/content/world-environment.ts')
const W = await import('../src/content/world.ts')

let length = 0
for (let i = 1; i < CIRCUIT_TRACK.length; i++) {
  length += Math.hypot(CIRCUIT_TRACK[i][0] - CIRCUIT_TRACK[i-1][0], CIRCUIT_TRACK[i][1] - CIRCUIT_TRACK[i-1][1])
}
console.log(`lap length (polyline) ${length.toFixed(0)} m · ${CIRCUIT.laps} laps · target ${CIRCUIT.targetLapSeconds}s`)
console.log(`  a ${CIRCUIT.targetLapSeconds}s lap is ${(length / CIRCUIT.targetLapSeconds).toFixed(1)} m/s average`)

// Corner radii, from the turn angle between consecutive segments.
const radii = []
for (let i = 1; i < CIRCUIT_TRACK.length - 1; i++) {
  const a = CIRCUIT_TRACK[i-1], b = CIRCUIT_TRACK[i], c = CIRCUIT_TRACK[i+1]
  const v1 = [b[0]-a[0], b[1]-a[1]], v2 = [c[0]-b[0], c[1]-b[1]]
  const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2)
  const cos = Math.max(-1, Math.min(1, (v1[0]*v2[0]+v1[1]*v2[1])/(l1*l2)))
  const turn = Math.acos(cos)
  if (turn < 0.12) continue
  radii.push({ at: i, turn: (turn*180/Math.PI).toFixed(0), r: (Math.min(l1,l2)/2/Math.tan(turn/2)).toFixed(0) })
}
console.log(`  ${radii.length} corners; radii ${radii.map(r=>r.r).join(', ')} m`)

// Does it stay on the island, and clear of everything else?
let worstCoast = -Infinity, at = null
for (const [x, z] of CIRCUIT_TRACK) {
  const over = Math.hypot(x, z) - (coastRadius(x, z, W.WORLD_RADIUS) - 14)
  if (over > worstCoast) { worstCoast = over; at = [x, z] }
}
console.log(`  closest to the coast: ${(-worstCoast).toFixed(0)} m of margin (at ${at})`)

// Self-crossing check: every pair of non-adjacent segments.
const seg = (i) => [CIRCUIT_TRACK[i], CIRCUIT_TRACK[i+1]]
const cross = (p1,p2,p3,p4) => {
  const d = (p4[1]-p3[1])*(p2[0]-p1[0]) - (p4[0]-p3[0])*(p2[1]-p1[1])
  if (Math.abs(d) < 1e-9) return false
  const ua = ((p4[0]-p3[0])*(p1[1]-p3[1]) - (p4[1]-p3[1])*(p1[0]-p3[0]))/d
  const ub = ((p2[0]-p1[0])*(p1[1]-p3[1]) - (p2[1]-p1[1])*(p1[0]-p3[0]))/d
  return ua > 0.001 && ua < 0.999 && ub > 0.001 && ub < 0.999
}
let crossings = 0
for (let i = 0; i < CIRCUIT_TRACK.length-1; i++) {
  for (let j = i+2; j < CIRCUIT_TRACK.length-1; j++) {
    if (i === 0 && j === CIRCUIT_TRACK.length-2) continue
    const [a,b] = seg(i), [c,d] = seg(j)
    if (cross(a,b,c,d)) { crossings++; console.log(`  CROSSING: segment ${i} x ${j}`) }
  }
}
// And no two parts of the loop closer than two track widths.
const N = CIRCUIT_TRACK.length - 1
const segDist = (px, pz, i) => {
  const a = CIRCUIT_TRACK[i], b = CIRCUIT_TRACK[i+1]
  const dx = b[0]-a[0], dz = b[1]-a[1]
  const t = Math.max(0, Math.min(1, ((px-a[0])*dx + (pz-a[1])*dz)/(dx*dx+dz*dz||1)))
  return Math.hypot(px-a[0]-dx*t, pz-a[1]-dz*t)
}
let tooClose = 0
for (let i = 0; i < N; i++) {
  const mid = [(CIRCUIT_TRACK[i][0]+CIRCUIT_TRACK[i+1][0])/2, (CIRCUIT_TRACK[i][1]+CIRCUIT_TRACK[i+1][1])/2]
  let best = Infinity, at = -1
  for (let j = 0; j < N; j++) {
    const gap = Math.min(Math.abs(j-i), N - Math.abs(j-i))
    if (gap < 3) continue
    const d = segDist(mid[0], mid[1], j)
    if (d < best) { best = d; at = j }
  }
  if (best < CIRCUIT.width + 4) { tooClose++; console.log(`  MERGED: segment ${i} is ${best.toFixed(1)} m from segment ${at}`) }
}
void lineDistance
console.log(`  ${crossings} crossings · ${tooClose} merged sections`)
