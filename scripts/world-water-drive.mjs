/**
 * Drives into every kind of water and tries to get out again.
 *
 *   node scripts/world-water-drive.mjs [baseUrl] [--headed]
 *
 * The brief's rule is that the world is playful, not an off-road
 * simulator: a river, a lake shore and a beach must all be somewhere
 * the car can enter and leave under its own power. Only the deep
 * middle of a lake, and the open sea, are allowed to be a trap.
 *
 * `world-shore-check.mjs` measures the ground. This drives it.
 */
import { chromium } from 'playwright'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const BASE = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000'
const OUT = path.resolve('.qa/water')
await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: !args.includes('--headed'),
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--disable-frame-rate-limit'],
})
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'ENTER')
  return b && !b.disabled
}, { timeout: 120000 })
await page.getByRole('button', { name: 'ENTER', exact: true }).click()
await page.waitForFunction(() => Boolean(window.__world?.vehicle), { timeout: 60000 })
await page.waitForTimeout(2500)
// Keyboard actions are bound to the canvas; without this the first
// key press goes to the button that started the world.
await page.locator('canvas').click({ position: { x: 640, y: 620 } })
await page.waitForTimeout(400)

const put = (x, z, rotation) => page.evaluate(({ x, z, rotation }) => {
  const g = window.__world
  const y = g.terrain.colliderHeightAt(x, z) + 2
  g.vehicle.moveTo({ x, y, z }, rotation)
  g.view.focusPoint.trackedPosition.set(x, y, z)
  g.view.snapToTarget()
}, { x, z, rotation })

const state = () => page.evaluate(() => {
  const g = window.__world
  const p = g.player.position
  return {
    x: +p.x.toFixed(1), z: +p.z.toFixed(1), y: +p.y.toFixed(2),
    ground: +g.terrain.colliderHeightAt(p.x, p.z).toFixed(2),
    speed: +g.vehicle.xzSpeed.toFixed(1),
    wheels: g.vehicle.wheels.inContactCount,
  }
})

async function hold(key, ms) {
  await page.keyboard.down(key)
  await page.waitForTimeout(ms)
  await page.keyboard.up(key)
}

const failures = []

/**
 * Drive from `from` towards `into` in short pulses, stopping as soon
 * as the car is standing on submerged ground, then reverse in pulses
 * until it is back on dry land.
 *
 * Pulses rather than one long press because the distances differ by an
 * order of magnitude — a river is eight metres across and a beach is
 * forty — and a single timed run either stops short of the water or
 * drives through it and out the far side.
 */
async function wadeTest(name, fromX, fromZ, intoX, intoZ, level) {
  // The vehicle faces (cos r, -sin r): +Z is a NEGATIVE rotation.
  const heading = Math.atan2(-(intoZ - fromZ), intoX - fromX)
  await put(fromX, fromZ, heading)
  await page.waitForTimeout(900)

  // Sampled while driving, not only between pulses: a river is eight
  // metres across and a pulse covers six, so a bed sampled at the
  // pulse boundaries is a bed the test drives straight over.
  let deepest = await state()
  for (let pulse = 0; pulse < 10; pulse++) {
    await page.keyboard.down('w')
    for (let tick = 0; tick < 7; tick++) {
      await page.waitForTimeout(60)
      const now = await state()
      if (now.ground < deepest.ground) deepest = now
    }
    await page.keyboard.up('w')
    await page.waitForTimeout(220)
    const now = await state()
    if (now.ground < deepest.ground) deepest = now
    if (deepest.ground < level - 0.25) break
  }
  const entered = deepest.ground < level
  const file = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  await page.screenshot({ path: path.join(OUT, `${file}-in.png`) })

  let back = await state()
  for (let pulse = 0; pulse < 14; pulse++) {
    await hold('s', 420)
    await page.waitForTimeout(260)
    back = await state()
    if (back.ground > level + 0.3) break
  }
  await page.waitForTimeout(600)
  back = await state()
  await page.screenshot({ path: path.join(OUT, `${file}-out.png`) })

  const escaped = back.ground > level + 0.15
  const ok = entered && escaped
  if (!ok) failures.push(name)
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(20)} ` +
    `deepest ground=${String(deepest.ground).padStart(6)} at (${String(deepest.x).padStart(6)},${String(deepest.z).padStart(6)})` +
    ` · out at ground=${String(back.ground).padStart(6)} ` +
    `${entered ? '' : '(never reached the water) '}${escaped ? '' : '(could not get out) '}`,
  )
}

console.log('\nWATER — drive in, drive out\n')
// Beach, on two bearings.
await wadeTest('beach east', 152, 6, 182, 6, -2.5)
await wadeTest('beach south', 6, 132, 6, 162, -2.5)
// Lake shores, on the shallow side each one has.
// From the SOUTH shore: the east side of Mirror Lake is UCL's
// forecourt and the monuments on it are a wall, and the west side is
// where the lake shortcut comes ashore.
await wadeTest('mirror lake', 78, 16, 78, 0, -0.7)
await wadeTest('willow lake', 106, 108, 90, 108, -0.65)
await wadeTest('cold tarn', -13, -106, -28, -106, -0.8)
// The river, forded rather than bridged.
await wadeTest('river ford', -22, -22, -32, -22, -0.7)
await wadeTest('river lower', -20, 24, -30, 24, -0.7)

// And the one place that IS meant to be a trap: the open sea.
console.log('\n  the deep — should recover the car, not strand it\n')
await put(178, 6, 0)
await page.waitForTimeout(600)
await hold('w', 5000)
await page.waitForTimeout(5000)
const rescued = await state()
const recovered = rescued.ground > -1
console.log(`  ${recovered ? 'ok  ' : 'FAIL'}  open sea            recovered to ground=${rescued.ground}`)
if (!recovered) failures.push('open sea recovery')

console.log(`\n${failures.length} failure(s)${failures.length ? ': ' + failures.join(', ') : ''}\n`)
await browser.close()
process.exit(failures.length ? 1 : 0)
