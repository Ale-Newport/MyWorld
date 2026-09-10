/**
 * scripts/_relayout.mjs — where the stacked things should stand instead.
 *
 *   node scripts/_relayout.mjs
 *
 * For every landmark, timeline plate and respawn that `validateLayout()`
 * reports as intersecting something it should not, this sweeps a ring
 * around its AUTHORED position for the nearest free ground and prints
 * the result. `findNear` is the same oracle the generators use, so a
 * point it returns is one the whole world already agrees is free — and
 * sweeping from the authored bearing keeps a sign near the junction it
 * is signing rather than exiling it to the far side of the island.
 *
 * Nothing is written. A position that is merely legal is not
 * necessarily one worth driving to, so the output is to be read and
 * pasted rather than applied.
 */
import { register } from 'node:module'
register('./_ts-loader.mjs', import.meta.url)
const L = await import('../src/content/world-layout.ts')
const W = await import('../src/content/world.ts')

const conflicts = L.validateLayout()
const zones = new Map(L.zones().map((z) => [z.id, z]))

const weight = new Map()
for (const c of conflicts) {
  for (const id of [c.a, c.b]) {
    if (/^(landmark|timeline|respawn)-/.test(id)) weight.set(id, (weight.get(id) ?? 0) + c.overlap)
  }
}

console.log(`${conflicts.length} conflicts · ${L.validateRespawns().length} respawn problems\n`)
for (const [id, overlap] of [...weight].sort((a, b) => b[1] - a[1])) {
  const zone = zones.get(id)
  if (!zone) continue
  const isRespawn = id.startsWith('respawn-')
  let best = null
  for (const radius of [6, 9, 12, 16, 21, 27, 34]) {
    for (let step = 0; step < 24; step++) {
      const angle = (step / 24) * Math.PI * 2
      const x = zone.x + Math.cos(angle) * radius
      const z = zone.z + Math.sin(angle) * radius
      const blocker = L.blockedBy(x, z, {
        clearance: zone.radius + 0.9,
        allow: isRespawn
          ? ['respawn', 'road', 'plate', 'district', 'circuit', 'bridge', 'play', 'letters']
          : ['plate', 'district', 'respawn'],
        coastMargin: 10,
      })
      if (!blocker) { best = { x, z, radius } ; break }
    }
    if (best) break
  }
  console.log(
    `  ${id.padEnd(32)} (${zone.x.toFixed(1)}, ${zone.z.toFixed(1)}) → `
    + (best ? `(${best.x.toFixed(1)}, ${best.z.toFixed(1)})  ${best.radius} m away` : 'NOTHING FREE WITHIN 34 m')
    + `   [overlap ${overlap.toFixed(1)}]`,
  )
}

console.log('\nNON-MOVABLE CONFLICTS (fix the geometry, not a position)')
for (const c of conflicts) {
  if (/^(landmark|timeline|respawn)-/.test(c.a) || /^(landmark|timeline|respawn)-/.test(c.b)) continue
  console.log('  ' + c.message)
}
console.log('\nRESPAWNS')
for (const p of L.validateRespawns()) console.log('  ' + p)
void W
