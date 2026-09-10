/* Which stage claims this ground? Geometry only — no browser needed. */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
register('./_ts-loader.mjs', pathToFileURL('./scripts/'))
const E = await import('../src/content/world-environment.ts')
const W = await import('../src/content/world.ts')
const smoothstep = (v,a,b)=>{const t=Math.min(1,Math.max(0,(v-a)/(b-a)));return t*t*(3-2*t)}
const BANK_WIDTH = E.BANK_WIDTH

const probes = [
  ['circuit worst',      -105,   71],
  ['circuit worst 2',    -110.6, 67.4],
  ['road landing-projects', 69, -40.5],
  ['road bowling-projects', 68.1, -51.1],
  ['road east-coast',     70.8, -42.7],
  ['pad timeMachine low', 38.7,  57.1],
  ['pad tnt low',        -97.5,  22.2],
  ['pad bowling low',     39.5, -58.5],
  ['ramp-east through',   69.6, -17.1],
  ['ramp-landing through',106.6,  4.8],
]

for (const [name, x, z] of probes) {
  const claims = []
  // shore
  const inset = E.coastInset(x, z), over = -inset
  const onShore = smoothstep(over, -15 - 12, -15 + 4)
  if (onShore > 0.001) claims.push(`SHORE ${onShore.toFixed(2)} (inset ${inset.toFixed(1)} m, valve ${smoothstep(inset,-2,8).toFixed(2)})`)
  // lake bank + apron
  for (const l of E.LAKES) {
    const n = Math.hypot((x-l.x)/l.rx, (z-l.z)/l.rz)
    const scale = Math.min(l.rx, l.rz)
    const reach = 1 + BANK_WIDTH/scale, apron = reach + 13/scale
    if (n <= apron) {
      const inside = 1 - smoothstep(n, reach, apron)
      if (inside > 0.001) claims.push(`LAKE-APRON ${l.id} ${inside.toFixed(2)} (n=${n.toFixed(2)}, reach ${reach.toFixed(2)})`)
    }
  }
  const w = E.inlandWater(x, z)
  if (w) claims.push(`WATER-CARVE ${w.flow>0.9?'river':'lake'} bank ${smoothstep(w.edge,-BANK_WIDTH,0).toFixed(2)} depth ${w.depth}`)
  // river apron
  const along = E.lineDistance(x, z, E.RIVER.points)
  const bankStart = E.RIVER.width/2 + BANK_WIDTH, ap = bankStart + 14
  if (along < ap) claims.push(`RIVER-APRON ${(1-smoothstep(along,bankStart,ap)).toFixed(2)} (${along.toFixed(1)} m out)`)
  // ramp pads
  for (const r of W.ramps) {
    const cos=Math.cos(r.rotation), sin=Math.sin(r.rotation)
    const dx=x-r.x, dz=z-r.z
    const lx=dx*cos+dz*sin, lz=-dx*sin+dz*cos
    const hl=r.length/2+16, hw=r.width/2+8
    const inside=(1-smoothstep(Math.abs(lx),hl-16,hl))*(1-smoothstep(Math.abs(lz),hw-8,hw))
    if (inside>0.001) claims.push(`RAMP-PAD ${r.id} ${inside.toFixed(2)}`)
  }
  // bridges
  for (const b of E.BRIDGES) {
    const cos=Math.cos(b.rotation), sin=Math.sin(b.rotation)
    const dx=x-b.x, dz=z-b.z
    const al=Math.abs(dx*cos+dz*sin)-b.length/2, ac=Math.abs(-dx*sin+dz*cos)
    if (al>-3 && al<20 && ac<b.width/2+3) claims.push(`BRIDGE-APPROACH ${b.road}`)
  }
  console.log(`${name.padEnd(24)} (${String(x).padStart(7)},${String(z).padStart(6)})  ${claims.length?claims.join('  |  '):'— nothing after the pads claims it'}`)
}
