/* Where does the lap leave the island? Pure geometry, no browser. */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
register('./_ts-loader.mjs', pathToFileURL('./scripts/'))
const E = await import('../src/content/world-environment.ts')
const T = E.CIRCUIT_TRACK, W = E.CIRCUIT.width, HALF = W / 2

const cum = [0]
for (let i = 1; i <= T.length; i++) {
  const a = T[i-1], b = T[i % T.length]
  cum.push(cum[i-1] + Math.hypot(b[0]-a[0], b[1]-a[1]))
}
const lap = cum[T.length]
const at = (s) => {
  s = ((s % lap) + lap) % lap
  let i = 1; while (i < cum.length && cum[i] < s) i++
  const a = T[(i-1) % T.length], b = T[i % T.length]
  const t = (s - cum[i-1]) / ((cum[i] - cum[i-1]) || 1)
  return [a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t]
}

const N = 640
const rows = []
for (let i = 0; i < N; i++) {
  const s = lap * i / N
  const [x, z] = at(s), [nx, nz] = at(s + 0.5)
  const dx = nx-x, dz = nz-z, L = Math.hypot(dx,dz) || 1
  const px = -dz/L, pz = dx/L
  // Which side is seaward? Test both edges.
  const eA = E.coastInset(x + px*HALF, z + pz*HALF)
  const eB = E.coastInset(x - px*HALF, z - pz*HALF)
  const worst = Math.min(eA, eB)
  const inward = eA < eB ? [-px, -pz] : [px, pz]   // unit vector toward land
  rows.push({ i, s, x, z, centre: E.coastInset(x, z), worst, inward })
}

// Contiguous arcs where the track edge is within SAFE of the coast.
const SAFE = 8      // metres of dry land the outer kerb should have
const bad = rows.map(r => r.worst < SAFE)
const arcs = []
let k = 0
while (k < N) {
  if (!bad[k]) { k++; continue }
  let j = k
  while (bad[(j+1) % N] && j - k < N) j++
  arcs.push({ from: k, to: j })
  k = j + 1
}
// Merge wrap-around
if (arcs.length > 1 && arcs[0].from === 0 && arcs[arcs.length-1].to === N-1) {
  const last = arcs.pop(); arcs[0].from = last.from - N
}

console.log(`lap ${lap.toFixed(1)} m, track ${W} m wide, ${N} stations (${(lap/N).toFixed(2)} m apart)`)
console.log(`stations whose outer edge has < ${SAFE} m of land: ${bad.filter(Boolean).length}/${N}\n`)
for (const a of arcs) {
  const seg = []
  for (let q = a.from; q <= a.to; q++) seg.push(rows[((q % N) + N) % N])
  const w = seg.reduce((m, r) => r.worst < m.worst ? r : m, seg[0])
  const need = Math.max(...seg.map(r => SAFE - r.worst))
  console.log(`arc ${String(a.from).padStart(4)}..${String(a.to).padStart(4)}  ` +
    `${(seg.length * lap / N).toFixed(0).padStart(4)} m of lap  ` +
    `from (${seg[0].x.toFixed(0)},${seg[0].z.toFixed(0)}) to (${seg[seg.length-1].x.toFixed(0)},${seg[seg.length-1].z.toFixed(0)})  ` +
    `worst edge inset ${w.worst.toFixed(1)} m at (${w.x.toFixed(0)},${w.z.toFixed(0)})  ` +
    `centreline inset ${w.centre.toFixed(1)} m  ` +
    `must move <= ${need.toFixed(1)} m inland`)
}
