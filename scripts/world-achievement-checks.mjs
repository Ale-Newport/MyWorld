/** Regression: loading/settling props is not a player achievement. */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] })
const page = await browser.newPage(), errors = []
page.on('pageerror', error => errors.push(String(error)))
await page.addInitScript(() => localStorage.setItem('alejandro-world-save-v1', JSON.stringify({
  version: 1, settings: { quality: 'medium', onboarded: true, muted: true }, progress: {},
})))
await page.goto(`${process.argv[2] ?? 'http://localhost:3001'}/world`)
await page.getByRole('button', { name: 'ENTER', exact: true }).click({ timeout: 120000 })
await page.waitForFunction(() => window.__world?.player?.state === 'default')
await page.waitForTimeout(3500)
const score = () => page.evaluate(() => ({
  cones: window.__world.achievements.progressOf('cones'),
  unlocked: window.__world.achievements.isUnlocked('cones'),
}))
const idle = await score()
console.log('idle', idle)
const cones = await page.evaluate(() => window.__world.world.props.tagged('cones').slice(0, 25).map(c => c.index))
for (const index of cones) {
  await page.evaluate(index => {
    const g = window.__world, cone = g.world.props.tagged('cones').find(c => c.index === index)
    const at = cone.physical.current.position, x = at.x - 7, z = at.z
    g.vehicle.moveTo({ x, y: g.terrain.colliderHeightAt(x, z) + 2, z }, 0)
  }, index)
  await page.waitForTimeout(600)
  await page.keyboard.down('KeyW'); await page.waitForTimeout(950); await page.keyboard.up('KeyW')
  await page.keyboard.down('KeyB'); await page.waitForTimeout(300); await page.keyboard.up('KeyB')
}
const driven = await score(), ok = idle.cones === 0 && !idle.unlocked && driven.unlocked
console.log('driven', driven)
await mkdir('.qa/achievements', { recursive: true })
await writeFile('.qa/achievements/results.json', JSON.stringify({ ok, idle, driven, errors }, null, 2))
await browser.close()
process.exitCode = ok && !errors.length ? 0 : 1
