/**
 * Screenshot tour of /world.
 *
 *   node scripts/world-tour.mjs [baseUrl] [--wide]
 *
 * Teleports to every district in turn and photographs it, so the
 * whole world can be reviewed without driving all of it. Writes to
 * `.qa/tour/`. `--wide` also takes a high pull-back shot of the
 * entire island.
 */
import { chromium } from 'playwright'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const BASE = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000'
const WIDE = args.includes('--wide')
const OUT = path.resolve('.qa/tour')

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle'],
})
const page = await (
  await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })
).newPage()

page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)))

await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'ENTER')
  return b && !b.disabled
}, { timeout: 120000 })
await page.getByRole('button', { name: 'ENTER', exact: true }).click()
await page.waitForTimeout(2000)

const districts = await page.evaluate(async () => {
  const mod = await import('/_next/static/chunks/src_content_world_ts.js').catch(() => null)
  void mod
  const g = window.__world
  return g.world
    ? Object.keys(g.store.getState()).length && null
    : null
})
void districts

// Read the district table straight off the running engine.
const list = await page.evaluate(() => {
  const g = window.__world
  const out = []
  for (const zone of g.zones.items) {
    if (!zone.id.startsWith('district-')) continue
    out.push({ id: zone.id.replace('district-', ''), x: zone.position.x, z: zone.position.z, r: zone.radius })
  }
  return out
})

console.log(`touring ${list.length} districts\n`)

for (const district of list) {
  await page.evaluate(({ id, x, z }) => {
    const g = window.__world
    // Use the district's own respawn point where it has one: a
    // position a player would actually occupy, rather than a drop
    // onto whatever happens to be at the edge.
    const respawn = g.respawns.getByName(id)
    const px = respawn ? respawn.position.x : x
    const pz = respawn ? respawn.position.z : z
    const y = g.terrain.colliderHeightAt(px, pz) + 2
    g.vehicle.moveTo({ x: px, y, z: pz }, respawn ? respawn.rotation : 0)
    g.view.focusPoint.trackedPosition.set(px, y, pz)

    // A fixed, wide framing so districts are comparable with one
    // another rather than each shot being whatever the camera's
    // obstruction avoidance decided.
    g.view.spherical.radius.edges.min = 78
    g.view.spherical.radius.edges.max = 78
    g.view.zoom.baseRatio = 0.5
    g.view.zoom.ratio = 0.5
    g.view.zoom.smoothedRatio = 0.5
    g.view.snapToTarget()
  }, district)
  await page.waitForTimeout(900)
  await page.screenshot({ path: path.join(OUT, `${district.id}.png`) })
  console.log(`  ${district.id}`)
}

if (WIDE) {
  await page.evaluate(() => {
    const g = window.__world
    g.view.spherical.radius.edges.max = 620
    g.view.spherical.radius.edges.min = 620
    g.view.spherical.targetPhi = Math.PI * 0.16
    g.view.zoom.baseRatio = 0
    g.view.zoom.smoothedRatio = 0
    g.renderer.scene.fog = null
    g.view.camera.far = 2200
    g.view.camera.updateProjectionMatrix()
    g.vehicle.moveTo({ x: 0, y: 6, z: 0 }, 0)
    g.view.focusPoint.trackedPosition.set(0, 0, 0)
    g.view.snapToTarget()
    g.renderer.instance.setClearColor('#f4f2ee', 1)
  })
  await page.waitForTimeout(1400)
  await page.screenshot({ path: path.join(OUT, '00-overview.png') })
  console.log('  overview')
}

await browser.close()
console.log(`\nscreenshots → ${OUT}\n`)
