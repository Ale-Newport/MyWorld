/**
 * Cross-browser smoke test for /world.
 *
 *   node scripts/world-browsers.mjs [baseUrl]
 *
 * The full QA harness runs in Chromium because it needs to read
 * engine telemetry and hold keys for seconds at a time. This one
 * answers a narrower and more important question in WebKit and
 * Firefox: does the world start, does it render, does it simulate,
 * and does the car move when a key is pressed.
 *
 * WebKit here is Playwright's build, not Safari — close enough to
 * catch a WebGL or WebAssembly problem, not close enough to promise
 * Safari behaves. Firefox is Firefox.
 */
import { chromium, firefox, webkit } from 'playwright'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const OUT = path.resolve('.qa/browsers')

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const ENGINES = [
  { name: 'chromium', launcher: chromium, args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] },
  { name: 'firefox', launcher: firefox, args: [] },
  { name: 'webkit', launcher: webkit, args: [] },
]

const failures = []

for (const engine of ENGINES) {
  console.log(`\n${engine.name.toUpperCase()}`)
  let browser
  try {
    browser = await engine.launcher.launch({ args: engine.args })
  } catch (error) {
    console.log(`  SKIP  could not launch — ${String(error).slice(0, 120)}`)
    continue
  }

  const page = await (
    await browser.newContext({ viewport: { width: 1280, height: 800 } })
  ).newPage()

  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 200))
  })

  const report = (name, ok, detail = '') => {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
    if (!ok) failures.push(`${engine.name}: ${name}`)
  }

  try {
    await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded', timeout: 90000 })

    await page.waitForFunction(() => {
      const b = Array.from(document.querySelectorAll('button')).find(
        (x) => x.textContent?.trim() === 'ENTER',
      )
      return Boolean(b && !b.disabled)
    }, { timeout: 180000 })
    report('engine boots (Rapier + WebGL)', true)

    await page.getByRole('button', { name: 'ENTER', exact: true }).click()
    await page.waitForTimeout(3000)

    const running = await page.evaluate(() => {
      const g = window.__world
      if (!g?.vehicle) return null
      return {
        elapsed: g.ticker.elapsed,
        wheels: g.vehicle.wheels.inContactCount,
        bodies: g.physics.world.bodies.len(),
        quality: g.quality.level,
      }
    })
    report('render loop runs', Boolean(running) && running.elapsed > 0.5,
      running ? `${running.elapsed.toFixed(1)}s, ${running.bodies} bodies, ${running.quality}` : 'no telemetry')
    report('car settles on its wheels', Boolean(running) && running.wheels === 4,
      running ? `${running.wheels}/4` : '')

    const before = await page.evaluate(() => ({ ...window.__world.player.position }))
    await page.keyboard.down('KeyW')
    await page.waitForTimeout(2200)
    await page.keyboard.up('KeyW')
    const after = await page.evaluate(() => ({ ...window.__world.player.position }))
    const travelled = Math.hypot(after.x - before.x, after.z - before.z)
    report('the car drives', travelled > 10, `${travelled.toFixed(1)} m`)

    await page.screenshot({ path: path.join(OUT, `${engine.name}.png`) })

    // Leaving must not throw, whatever the engine does with contexts.
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
    report('leaving the route is clean', errors.length === 0, errors.slice(0, 2).join(' | '))
  } catch (error) {
    report('completed the run', false, String(error).slice(0, 160))
  }

  await browser.close()
}

console.log(`\n${failures.length === 0 ? 'ALL BROWSERS PASSED' : `${failures.length} FAILED: ${failures.join(', ')}`}`)
console.log(`screenshots → ${OUT}\n`)
process.exit(failures.length === 0 ? 0 : 1)
