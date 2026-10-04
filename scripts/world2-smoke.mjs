import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
await mkdir('.qa/world2', { recursive: true })
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', e => { errors.push(String(e)); console.log('PAGEERROR', String(e)) })
page.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); console.log('ERROR', m.text().slice(0, 250)) } })
await page.goto('http://localhost:3000/world2', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__world2?.status.ready || document.querySelector('[role=alert]'), { timeout: 120000 })
console.log('BODY', (await page.locator('body').innerText()).slice(0, 2200))
if (await page.getByRole('button', { name: 'Start driving' }).isEnabled().catch(() => false)) {
  await page.getByRole('button', { name: 'Start driving' }).click()
  await page.waitForTimeout(3000)
  console.log('TELEMETRY', await page.evaluate(() => { const g = window.__world2; return { status: g.status, pos: g.player.position.toArray(), wheels: g.vehicle.wheels.inContactCount, ground: g.physics.groundAt(g.player.position.x, g.player.position.z), terrain: g.environment.terrainHeightAt(g.player.position.x, g.player.position.z), colliders: g.physics.world.colliders.len(), bodies: g.physics.world.bodies.len(), meshes: g.environment.meshes.length, areas: g.environment.areas, dynamic: g.environment.dynamic.length } }))
  await page.screenshot({ path: '.qa/world2/spawn.png' })
  await page.evaluate(() => window.__world2.toggleTopDown())
  await page.waitForTimeout(600)
  await page.screenshot({ path: '.qa/world2/browser-top.png' })
}
await writeFile('.qa/world2/smoke-errors.json', JSON.stringify(errors, null, 2))
await browser.close()
