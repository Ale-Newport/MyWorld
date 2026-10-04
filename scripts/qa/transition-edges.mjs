/* The leaf transition's edge cases:
     a fast fling down the page does not enter the world (intent needs a page at rest);
     scrolling back up releases a partial charge;
     while covered: one cover only, it spans the viewport after a resize, and the page
       beneath cannot be clicked;
     Back from the world returns to the homepage usable (no cover, nothing inert);
     Forward is a direct arrival with the world's own loading screen;
     a failed load shows the error with Try again, and Try again recovers.
   node scripts/qa/transition-edges.mjs */
import { BASE, launch, sleep, assert, finish, out } from './lib.mjs'

const results = []
const browser = await launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
await page.addInitScript(() => { window.__phases = []; window.addEventListener('world:phase', (e) => window.__phases.push(e.detail)) })
const phase = () => page.evaluate(() => document.documentElement.dataset.worldPhase ?? 'HOME')
const wheel = async (n, dy, gap = 25) => { for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dy); await sleep(gap) } }

/* 1 — a fling to the bottom is not intent */
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await sleep(2500)
await page.mouse.move(720, 450)
await wheel(90, 1600, 8)
await sleep(300)
await wheel(14, 120, 20)
await sleep(400)
assert((await phase()) === 'HOME', `a fast fling that runs out of page does not start the transition (${await phase()})`, results)

/* 2 — scrolling back up releases a partial charge (read from the portal's own fill line) */
const fill = () => page.evaluate(() => { const el = [...document.querySelectorAll('[class*="WorldPortal-module"]')].find((n) => /fill/i.test(n.className)); const m = /scaleX\(([-\d.e]+)\)/.exec(el?.style.transform ?? ''); return m ? Number(m[1]) : 0 })
await sleep(2600)
await wheel(8, 120, 25)
await sleep(120)
const mid = await fill()
await wheel(12, -400, 25)
await sleep(1600)
const after = await fill()
assert(mid > 0.03 && after < 0.02 && (await phase()) === 'HOME', `a partial push charges the portal (${mid.toFixed(2)}) and scrolling back up releases it (${after.toFixed(2)})`, results)

/* 3 — enter for real; while covered, check cover, resize and blocked input */
await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
await sleep(2600)
for (let i = 0; i < 260 && (await phase()) === 'HOME'; i++) { await page.mouse.wheel(0, 120); await sleep(22) }
await page.waitForFunction(() => window.__phases.includes('COVERED'), null, { timeout: 30000 })
const covers = await page.evaluate(() => document.querySelectorAll('[data-covered]').length)
assert(covers === 1, `exactly one cover on screen (${covers})`, results)
await page.setViewportSize({ width: 900, height: 1200 })
await sleep(500)
const spans = await page.evaluate(() => {
  const pts = [[2, 2], [innerWidth - 3, 2], [2, innerHeight - 3], [innerWidth - 3, innerHeight - 3], [innerWidth / 2, innerHeight / 2]]
  return pts.every(([x, y]) => { const el = document.elementFromPoint(x, y); return !!el && (el.closest('[data-covered]') || el.closest('[aria-hidden="true"]')?.querySelector?.('canvas') || el.tagName === 'CANVAS') })
})
assert(spans, 'after resizing the window the cover still spans every corner', results)
const inertNow = await page.evaluate(() => [...document.querySelectorAll('#journey, [data-hud]')].every((el) => el.inert))
assert(inertNow || (await phase()) !== 'COVERED', 'the page under the cover is inert while covered', results)
await page.setViewportSize({ width: 1440, height: 900 })
await page.waitForFunction(() => window.__phases.includes('IN_WORLD'), null, { timeout: 240000 })
assert(page.url().endsWith('/world'), 'arrived in /world', results)

/* 4 — Back to the homepage */
await page.goBack({ waitUntil: 'domcontentloaded' })
await sleep(3000)
const back = await page.evaluate(() => ({ path: location.pathname, inert: [...document.querySelectorAll('#journey, [data-hud]')].some((el) => el.inert), cover: document.querySelectorAll('[data-covered]').length, bg: document.documentElement.style.background, phase: document.documentElement.dataset.worldPhase ?? 'HOME' }))
assert(back.path === '/' && !back.inert && back.cover === 0 && back.phase === 'HOME', `Back returns to a usable homepage (${JSON.stringify(back)})`, results)
const clickable = await page.locator('[data-hud] button').first().isEnabled().catch(() => false)
assert(clickable, 'the homepage controls respond again', results)

/* 5 — Forward is a direct arrival */
await page.goForward({ waitUntil: 'domcontentloaded' })
const loader = await page.locator('[data-world-shell] [role="status"]').first().waitFor({ timeout: 20000 }).then(() => true, () => false)
await page.waitForSelector('[data-world-shell][data-ready]', { timeout: 240000 })
const loaderGone = await page.locator('[data-world-shell] h1', { hasText: 'Building the island' }).count()
assert(loader && loaderGone === 0, 'Forward enters /world directly with its own loading screen, gone once ready', results)

/* 6 — a failed load offers Try again, which recovers */
const fresh = await browser.newPage({ viewport: { width: 1280, height: 800 } })
let blocked = true
await fresh.route('**/archipelago/preview/main.js*', (r) => (blocked ? r.abort() : r.continue()))
await fresh.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded' })
const failed = await fresh.locator('[role="alert"]', { hasText: 'did not load' }).waitFor({ timeout: 90000 }).then(() => true, () => false)
await fresh.screenshot({ path: out('transition-error.png') })
assert(failed, 'when the world cannot load, an error with Try again is shown (not an endless spinner)', results)
blocked = false
await fresh.getByRole('button', { name: 'Try again' }).click()
const recovered = await fresh.waitForSelector('[data-world-shell][data-ready]', { timeout: 240000 }).then(() => true, () => false)
assert(recovered, 'Try again loads the world', results)
await browser.close()
finish(results)
