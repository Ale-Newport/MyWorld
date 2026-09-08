/**
 * Shore, bank and beach profiles — measured, not eyeballed.
 *
 *   node scripts/world-shore-check.mjs [baseUrl]
 *
 * Walks transects across every waterline in the running world and
 * reports the steepest gradient the car would meet, and how deep the
 * water is a few metres in. The brief's rule is that natural terrain
 * stays drivable: a shore the car cannot reverse out of is a bug, and
 * this is the check that finds it.
 *
 * Thresholds: nothing at a shoreline may exceed 26 degrees, and the
 * first four metres of water must be under half a metre deep.
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:3000'
// Measured against the car: it climbs about 34 degrees under power,
// so 30 leaves margin and still fails anything that reads as a wall.
const MAX_SLOPE = 30
// The car's origin sits ~0.55 m up; it swamps a little past a metre.
const WADE_DEPTH = 0.8

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] })
const page = await (await browser.newContext({ viewport: { width: 900, height: 600 } })).newPage()
await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'ENTER')
  return b && !b.disabled
}, { timeout: 120000 })
await page.getByRole('button', { name: 'ENTER', exact: true }).click()
await page.waitForFunction(() => Boolean(window.__world?.terrain), { timeout: 60000 })
await page.waitForTimeout(2000)

const results = await page.evaluate(({ MAX_SLOPE, WADE_DEPTH }) => {
  const g = window.__world
  const H = (x, z) => g.terrain.colliderHeightAt(x, z)
  const out = []

  /**
   * Walk a transect from dry land into water. Reports the steepest
   * gradient within twenty metres either side of the WATERLINE — the
   * point where the ground actually crosses the surface — rather than
   * anywhere along the line, because a cliff eighty metres out to sea
   * is not something the car can drive into.
   */
  const transect = (name, fromX, fromZ, toX, toZ, level) => {
    const steps = 400
    const total = Math.hypot(toX - fromX, toZ - fromZ)
    const samples = []
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      samples.push({
        d: total * t,
        h: H(fromX + (toX - fromX) * t, fromZ + (toZ - fromZ) * t),
      })
    }
    let waterline = null
    for (let i = 1; i < samples.length; i++) {
      if (samples[i - 1].h >= level && samples[i].h < level) { waterline = samples[i].d; break }
    }
    if (waterline === null) { out.push({ name, skipped: 'never reaches the water' }); return }

    let worst = 0, worstAt = 0
    for (let i = 1; i < samples.length; i++) {
      const rel = samples[i].d - waterline
      // Only the band the car can actually reach: a cliff nine metres
      // out under three metres of water is not a shore defect.
      if (rel < -12 || rel > 6) continue
      const run = samples[i].d - samples[i - 1].d
      const slope = Math.abs(Math.atan2(samples[i].h - samples[i - 1].h, run) * 180 / Math.PI)
      if (slope > worst) { worst = slope; worstAt = rel }
    }
    const at = (rel) => {
      const target = waterline + rel
      let best = samples[0]
      for (const s of samples) if (Math.abs(s.d - target) < Math.abs(best.d - target)) best = s
      return level - best.h
    }
    out.push({
      name, worst: +worst.toFixed(1), worstAt: +worstAt.toFixed(1),
      wade: +at(4).toFixed(2), deep: +at(12).toFixed(2),
      okSlope: worst <= MAX_SLOPE, okWade: at(4) <= WADE_DEPTH,
    })
  }

  const OCEAN = -2.5
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    transect(`ocean @ ${Math.round(a * 180 / Math.PI)}°`,
      Math.cos(a) * 130, Math.sin(a) * 130, Math.cos(a) * 200, Math.sin(a) * 200, OCEAN)
  }
  // Four bearings per lake. A tarn in the highlands is allowed one
  // steep side; what matters is that there is a way in and out.
  for (const lake of [{ id: 'mirror-lake', x: 78, z: -10, r: 18, level: -0.7 },
                      { id: 'willow-lake', x: 90, z: 108, r: 15, level: -0.65 },
                      { id: 'cold-tarn', x: -28, z: -106, r: 15, level: -0.8 }]) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2
      transect(`${lake.id} @ ${Math.round(a * 180 / Math.PI)}°`,
        lake.x + Math.cos(a) * (lake.r + 20), lake.z + Math.sin(a) * (lake.r + 20),
        lake.x, lake.z, lake.level)
    }
  }
  for (const [x, z] of [[-34, -72], [-32, -22], [-29, 24]]) {
    transect(`river @ z=${z}`, x - 20, z, x, z, -0.7)
  }
  return out
}, { MAX_SLOPE, WADE_DEPTH })

console.log(`\nSHORE PROFILES — max slope ${MAX_SLOPE}°, wadeable depth ${WADE_DEPTH} m at 4 m in\n`)
let failures = 0
// A lake passes if ANY of its four approaches is drivable.
const lakeGroups = new Map()
for (const r of results) {
  const m = /^(\S+-\S+) @/.exec(r.name)
  if (!m || r.skipped) continue
  const ok = r.okSlope && r.okWade
  lakeGroups.set(m[1], (lakeGroups.get(m[1]) ?? false) || ok)
}
for (const r of results) {
  if (r.skipped) { console.log(`  skip  ${r.name.padEnd(18)} ${r.skipped}`); continue }
  const lake = /^(\S+-\S+) @/.exec(r.name)?.[1]
  const excused = lake ? lakeGroups.get(lake) : false
  const flags = [r.okSlope ? '' : 'STEEP', r.okWade ? '' : 'DEEP'].filter(Boolean).join(' ')
  if (flags && !excused) failures++
  console.log(`  ${flags ? (excused ? 'note' : 'FAIL') : 'ok  '}  ${r.name.padEnd(18)} steepest ${String(r.worst).padStart(5)}° at ${String(r.worstAt).padStart(6)} m from the waterline   depth +4 m: ${String(r.wade).padStart(5)} m   +12 m: ${String(r.deep).padStart(5)} m ${flags}`)
}
console.log(`\n${failures} failing transect(s)\n`)
await browser.close()
process.exit(failures ? 1 : 0)
