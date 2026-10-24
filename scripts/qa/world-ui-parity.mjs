/* The player's HUD and dialogs, pixel for pixel, on two servers: the UI must look as it did.

   The WebGL canvas is hidden (it is never the same two frames running), so what is compared is the page's own
   chrome on the island's sea colour: the player nav, the speed readout, the activity HUD and the interact
   button, the help and achievements dialogs, the map's chrome, and on a phone (touch UI) the same.
   Shots go to <out>/parity/{before,after}-<state>.png, a diff to diff-<state>.png (red where they differ),
   and every state prints the share of pixels that differ by more than a few levels.

     node scripts/qa/world-ui-parity.mjs --before http://127.0.0.1:3250 --after http://localhost:3210 [--out .qa/runs/impl/ui] [--max 0.5] */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { launch, sleep, assert, finish } from './lib.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback }
const before = arg('before'), after = arg('after'), out = path.resolve(arg('out', '.qa/runs/impl/ui'), 'parity'), max = Number(arg('max', '0.5'))
if (!before || !after) { console.error('--before and --after are required'); process.exit(2) }
fs.mkdirSync(out, { recursive: true })

async function shoot(base, tag) {
  process.env.QA_BASE = base
  const browser = await launch()
  const take = async (page, name) => { await sleep(500); await page.screenshot({ path: path.join(out, `${tag}-${name}.png`) }) }
  const player = async (context) => {
    const page = await context.newPage()
    await page.goto(`${base}/archipelago/preview/index.html`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 180_000 })
    await page.addStyleTag({ content: '#world{visibility:hidden!important}' })
    await sleep(1800)
    await page.mouse.move(2, 2)
    return page
  }
  const place = (page, x, z) => page.evaluate(([x, z]) => { const A = globalThis.__archipelago; A.driving.vehicle.moveTo({ x, y: A.editor.terrainHeightAt(x, z) + 1.3, z }, 0) }, [x, z])
  const prompt = async (page) => { await place(page, -47, 18); await sleep(300); await place(page, -47, -26.5); await page.waitForFunction(() => !document.querySelector('#interact-action').hidden && globalThis.__archipelago.activities.prompt, null, { timeout: 8000 }); await sleep(900) }

  // Desktop
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
    const page = await player(context)
    await take(page, 'desktop-idle')
    await prompt(page)
    await take(page, 'desktop-prompt')
    await page.locator('canvas').first().focus().catch(() => {})
    await page.keyboard.down('Enter'); await sleep(90); await page.keyboard.up('Enter')
    await sleep(4200)
    await place(page, -47, -26.5)
    await sleep(600)
    await take(page, 'desktop-armed')
    await page.keyboard.press('Escape'); await sleep(500)
    await place(page, -47, 18); await sleep(700)
    await page.evaluate(() => document.querySelector('#help-dialog').showModal()); await take(page, 'desktop-help')
    await page.evaluate(() => document.querySelector('#help-dialog').close()); await sleep(300)
    await page.evaluate(() => document.querySelector('#player-awards').click()); await take(page, 'desktop-awards')
    await page.evaluate(() => document.querySelector('#awards-dialog').close()); await sleep(300)
    await page.addStyleTag({ content: '.atlas-plane,.atlas-pins{visibility:hidden!important}' })
    await page.evaluate(() => globalThis.__archipelago.atlas.show()); await sleep(900); await take(page, 'desktop-map-chrome')
    await context.close()
  }
  // Phone
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
    const page = await player(context)
    await take(page, 'phone-idle')
    await prompt(page)
    await take(page, 'phone-prompt')
    await page.evaluate(() => document.querySelector('#help-dialog').showModal()); await take(page, 'phone-help')
    await context.close()
  }
  await browser.close()
}

await shoot(before, 'before')
await shoot(after, 'after')

const results = []
const rows = []
for (const file of fs.readdirSync(out).filter((f) => f.startsWith('before-')).sort()) {
  const name = file.replace(/^before-/, '').replace(/\.png$/, '')
  const [a, b] = await Promise.all([path.join(out, file), path.join(out, `after-${name}.png`)].map((p) => sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true })))
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) { assert(false, `${name}: same size`, results); continue }
  const { width, height } = a.info, diff = Buffer.alloc(width * height * 4)
  let n = 0, minX = width, minY = height, maxX = -1, maxY = -1
  for (let i = 0, p = 0; i < a.data.length; i += 4, p++) {
    const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])
    if (d > 24) { n++; const x = p % width, y = (p / width) | 0; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; diff[i] = 255; diff[i + 1] = 0; diff[i + 2] = 0; diff[i + 3] = 255 }
    else { diff[i] = a.data[i] >> 2; diff[i + 1] = a.data[i + 1] >> 2; diff[i + 2] = a.data[i + 2] >> 2; diff[i + 3] = 255 }
  }
  const share = (100 * n) / (width * height)
  await sharp(diff, { raw: { width, height, channels: 4 } }).png().toFile(path.join(out, `diff-${name}.png`))
  rows.push({ name, share: +share.toFixed(3), pixels: n, box: n ? [minX, minY, maxX, maxY] : null })
  assert(share <= max, `${name}: ${share.toFixed(3)}% of pixels differ${n ? ` (inside ${minX},${minY} - ${maxX},${maxY})` : ''}`, results)
}
fs.writeFileSync(path.join(out, 'parity.json'), JSON.stringify(rows, null, 1))
finish(results)
