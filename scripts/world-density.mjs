/**
 * Near-field density probe for /world.
 *
 *   node scripts/world-density.mjs [baseUrl] [radius]
 *
 * Teleports to every district and counts the rendered instances
 * standing within `radius` metres of the car. Vegetation and props
 * are drawn from InstancedMesh, so an instance — not a draw call —
 * is the unit that matters: it is what the player actually sees.
 *
 * This is the number the folio-2025 parity work has to move. A
 * reference frame of that world carries several hundred pieces of
 * vegetation plus dozens of props; a sample here reporting a few
 * dozen is a scene the player reads as empty.
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const RADIUS = Number(process.argv[3] ?? 60)

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 160)))

await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'ENTER')
  return b && !b.disabled
}, { timeout: 120000 })
await page.getByRole('button', { name: 'ENTER', exact: true }).click()
await page.waitForTimeout(2500)

const points = await page.evaluate(() => {
  const g = window.__world
  return g.zones.items
    .filter((z) => z.id.startsWith('district-'))
    .map((z) => ({ id: z.id.replace('district-', ''), x: z.position.x, z: z.position.z }))
})

const rows = []
for (const point of points) {
  const row = await page.evaluate(async ({ point, RADIUS }) => {
    const g = window.__world
    const respawn = g.respawns.getByName(point.id)
    const x = respawn ? respawn.position.x : point.x
    const z = respawn ? respawn.position.z : point.z
    g.vehicle.moveTo({ x, y: g.terrain.colliderHeightAt(x, z) + 2, z }, respawn ? respawn.rotation : 0)
    g.view.focusPoint.trackedPosition.set(x, 0, z)
    g.view.snapToTarget()
    // Let chunk activation and any distance culling settle, so the
    // count reflects what a player standing here would be shown.
    await new Promise((r) => setTimeout(r, 1200))

    const near = (px, pz) => Math.hypot(px - x, pz - z) < RADIUS
    // Apply a Matrix4 to a local point without needing THREE here.
    const apply = (e, lx, ly, lz) => {
      const w = e[3] * lx + e[7] * ly + e[11] * lz + e[15] || 1
      return [
        (e[0] * lx + e[4] * ly + e[8] * lz + e[12]) / w,
        (e[2] * lx + e[6] * ly + e[10] * lz + e[14]) / w,
      ]
    }

    const byKind = {}
    let instances = 0
    let meshes = 0
    g.renderer.scene.updateMatrixWorld(true)
    g.renderer.scene.traverse((o) => {
      if (!o.visible || !o.isMesh) return
      let parent = o.parent
      while (parent) { if (!parent.visible) return; parent = parent.parent }
      const kind = o.name || o.geometry?.type || 'mesh'
      if (o.isInstancedMesh) {
        const a = o.instanceMatrix.array
        const e = o.matrixWorld.elements
        let n = 0
        for (let i = 0; i < o.count; i++) {
          const o16 = i * 16
          const [wx, wz] = apply(e, a[o16 + 12], a[o16 + 13], a[o16 + 14])
          if (near(wx, wz)) n++
        }
        instances += n
        if (n) byKind[kind] = (byKind[kind] ?? 0) + n
      } else {
        const e = o.matrixWorld.elements
        if (near(e[12], e[14])) { meshes++; byKind[kind] = (byKind[kind] ?? 0) + 1 }
      }
    })
    const top = Object.entries(byKind).sort((a, b) => b[1] - a[1]).slice(0, 4)
    return { id: point.id, instances, meshes, total: instances + meshes, top }
  }, { point, RADIUS })
  rows.push(row)
  const top = row.top.map(([k, n]) => `${k}:${n}`).join(' ')
  console.log(`${row.id.padEnd(12)} total ${String(row.total).padStart(6)}  (inst ${row.instances}, mesh ${row.meshes})  ${top}`)
}

const totals = rows.map((r) => r.total).sort((a, b) => a - b)
console.log(
  `\nwithin ${RADIUS} m across ${rows.length} districts — ` +
  `median ${totals[Math.floor(totals.length / 2)]}, min ${totals[0]}, max ${totals[totals.length - 1]}`,
)

await browser.close()
