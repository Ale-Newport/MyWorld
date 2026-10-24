/* When the island cannot start: plain words, soon, and a way out.

     QA_BASE=<production url> node scripts/qa/leaf-error.mjs [--phone]

   A direct arrival whose runtime cannot be had, in two ways:

     doc    the saved world cannot be fetched (the runtime says "Failed to fetch" and posts an error)
     main   the runtime's script never loads (the frame loads, says nothing: it used to be 12 s before anyone was told)

   Each must put the dialog over the leaves, focused on "Try again", with words a visitor can act on — never the
   browser's phrasing — within a few seconds of the page loading; the page stays shut behind it; "Try again" starts the
   world once more (and fails the same way while the cause stays), and with the cause gone it recovers. */
import { devices } from 'playwright'
import { BASE, launch, assert, finish } from './lib.mjs'

const PHONE = process.argv.includes('--phone')
const results = []
const browser = await launch()
const BAD = /fetch|TypeError|undefined|\.js\b|ERR_|HTTP \d/i

for (const [which, pattern, expect, within] of [
  ['doc', '**/api/world/release*', /could not be downloaded.*connection/i, 5000],
  ['main', '**/archipelago/preview/main.js*', /did not wake up/i, 6000],
]) {
  const context = await browser.newContext(PHONE ? { ...devices['Pixel 7'] } : { viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  let abort = true
  await page.route(pattern, (route) => (abort ? route.abort() : route.continue()))
  await page.addInitScript(() => { window.__ph = []; window.addEventListener('world:phase', (e) => window.__ph.push([e.detail, performance.now()])) })
  const t0 = Date.now()
  await page.goto(`${BASE}/world`, { waitUntil: 'commit' })
  await page.waitForSelector('[role="alertdialog"]', { timeout: 40000 })
  const ms = Date.now() - t0
  const d = await page.evaluate(() => ({
    text: document.querySelector('#world-error-text')?.textContent ?? '',
    focused: document.activeElement?.textContent?.trim(),
    phase: document.documentElement.dataset.worldPhase,
    overflow: getComputedStyle(document.documentElement).overflowY,
    loader: !!document.querySelector('[data-world-loader]'),
    fontSize: parseFloat(getComputedStyle(document.querySelector('#world-error-text')).fontSize),
  }))
  assert(ms <= within, `${which}: the dialog is up ${ms} ms after the navigation (within ${within})`, results)
  assert(expect.test(d.text) && !BAD.test(d.text), `${which}: it says, in plain words, "${d.text}"`, results)
  assert(d.focused === 'Try again' && d.phase === 'ERROR' && d.overflow === 'hidden' && !d.loader, `${which}: focused on "Try again", the page shut behind it, the loader gone (${d.focused}, ${d.phase}, ${d.overflow}, loader ${d.loader})`, results)
  await page.getByRole('button', { name: 'Try again' }).click()
  await page.waitForSelector('[role="alertdialog"]', { timeout: 40000 })
  assert(true, `${which}: "Try again" with the cause still there fails again and says so again`, results)
  abort = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await page.waitForFunction(() => document.documentElement.dataset.worldPhase === 'IN_WORLD', null, { timeout: 120000 }).then(
    () => assert(true, `${which}: with the cause gone, "Try again" reaches the world`, results),
    () => assert(false, `${which}: with the cause gone, "Try again" reaches the world`, results),
  )
  await context.close()
}
await browser.close()
finish(results)
