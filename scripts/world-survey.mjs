/**
 * Level-design survey. Teleports to every zone, screenshots it, and
 * reports geometry telemetry. Read-only: it changes nothing.
 *
 *   node scripts/world-survey.mjs [baseUrl] [--out=.qa/survey]
 */
import { chromium } from 'playwright'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const BASE = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000'
const OUT = path.resolve(args.find((a) => a.startsWith('--out='))?.slice(6) ?? '.qa/survey')

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--disable-frame-rate-limit'],
})
const context = await browser.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 1 })
const page = await context.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 250)) })
page.on('pageerror', (e) => errors.push(`PAGEERROR ${String(e).slice(0, 250)}`))

await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.waitForFunction(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent?.trim() === 'ENTER')
  return Boolean(b && !b.disabled)
}, { timeout: 120000 })
await page.getByRole('button', { name: 'ENTER', exact: true }).click()
await page.waitForFunction(() => Boolean(window.__world?.vehicle), { timeout: 60000 })
await page.waitForTimeout(3000)

async function teleport(x, z, rotation = 0) {
  await page.evaluate(({ x, z, rotation }) => {
    const g = window.__world
    const y = g.terrain.colliderHeightAt(x, z) + 2.5
    g.vehicle.moveTo({ x, y, z }, rotation)
    g.view.focusPoint.trackedPosition.set(x, y, z)
    g.view.snapToTarget()
  }, { x, z, rotation })
  await page.waitForTimeout(900)
}

const probe = () => page.evaluate(() => {
  const g = window.__world
  const p = g.player.position
  return {
    x: +p.x.toFixed(1), y: +p.y.toFixed(2), z: +p.z.toFixed(1),
    terrainY: +g.terrain.colliderHeightAt(p.x, p.z).toFixed(2),
    district: g.store.getState().district,
    upsideDown: g.vehicle.upsideDown.active,
    fps: Math.round(g.ticker.fps),
    drawCalls: g.renderer.instance.info.render.calls,
    tris: g.renderer.instance.info.render.triangles,
  }
})

// Read the layout straight out of the module the page already imported.
const layout = await page.evaluate(() => {
  const g = window.__world
  const out = { districts: [], respawns: [], landmarks: [] }
  for (const [, h] of g.world.landmarks) {
    out.landmarks.push({ id: h.landmark.id, d: h.landmark.district, x: h.landmark.x, z: h.landmark.z,
      visual: h.landmark.visual, interaction: h.landmark.interaction, r: h.radius, scale: h.landmark.scale ?? 1 })
  }
  return out
})

const results = []
async function visit(name, x, z, rot = 0, zoomOut = false) {
  await teleport(x, z, rot)
  if (zoomOut) {
    await page.evaluate(() => { const g = window.__world; g.view.zoom.baseRatio = 0 })
    await page.waitForTimeout(1200)
  }
  const t = await probe()
  results.push({ name, want: { x, z }, ...t })
  await page.screenshot({ path: path.join(OUT, `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`) })
  if (zoomOut) await page.evaluate(() => { const g = window.__world; g.view.zoom.baseRatio = 0.6 })
  console.log(`  ${name.padEnd(26)} y=${String(t.y).padStart(6)} terrain=${String(t.terrainY).padStart(6)} district=${t.district ?? '-'} fps=${t.fps} calls=${t.drawCalls}`)
}

const SPOTS = JSON.parse(process.env.SPOTS_JSON)
console.log(`\nSURVEY — ${SPOTS.length} spots\n`)
for (const s of SPOTS) await visit(s.name, s.x, s.z, s.rot ?? 0, s.zoom ?? false)

await writeFile(path.join(OUT, 'survey.json'), JSON.stringify({ results, landmarks: layout.landmarks, errors }, null, 2))
console.log(`\nconsole errors: ${errors.length}`)
for (const e of errors.slice(0, 20)) console.log(`  ${e}`)
await browser.close()
