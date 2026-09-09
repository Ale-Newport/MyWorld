import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
register('./_ts-loader.mjs', pathToFileURL('./scripts/'))
const W = await import('../src/content/world.ts')
const L = await import('../src/content/world-layout.ts')

// Vertices shared by two roads are junctions and may not move.
const count = new Map()
for (const road of W.roads) for (const [x, z] of road.points) {
  const key = `${x},${z}`
  count.set(key, (count.get(key) ?? 0) + 1)
}

const solids = L.zones().filter((z) => z.kind === 'landmark' && !z.points)
const CAP = 15

for (const road of W.roads) {
  const out = []
  let moved = 0
  for (let i = 0; i < road.points.length; i++) {
    const [ox, oz] = road.points[i]
    const pinned = i === 0 || i === road.points.length - 1 || (count.get(`${ox},${oz}`) ?? 0) > 1
    let x = ox, z = oz
    if (!pinned) {
      const a = road.points[Math.max(0, i - 1)]
      const b = road.points[Math.min(road.points.length - 1, i + 1)]
      const dx = b[0] - a[0], dz = b[1] - a[1]
      const len = Math.hypot(dx, dz) || 1
      const nx = -dz / len, nz = dx / len
      for (let pass = 0; pass < 40; pass++) {
        let worst = null, depth = 0
        for (const s of solids) {
          const need = s.radius + road.width * 0.5 + 1.6
          const d = Math.hypot(x - s.x, z - s.z)
          if (d < need && need - d > depth) { depth = need - d; worst = s }
        }
        if (!worst) break
        const side = ((x - worst.x) * nx + (z - worst.z) * nz) >= 0 ? 1 : -1
        x += nx * side * 0.6
        z += nz * side * 0.6
        if (Math.hypot(x - ox, z - oz) > CAP) break
      }
      moved = Math.max(moved, Math.hypot(x - ox, z - oz))
    }
    out.push([Math.round(x * 10) / 10, Math.round(z * 10) / 10])
  }
  if (moved < 0.2) continue
  console.log(`  { id: '${road.id}', width: ${road.width}, points: [${out.map(([a, b]) => `[${a}, ${b}]`).join(', ')}] },   // max nudge ${moved.toFixed(1)} m`)
}
