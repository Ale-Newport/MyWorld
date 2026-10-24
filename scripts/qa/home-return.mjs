/* Coming back to the homepage from /world with the chapter index open when the visitor left.

     QA_BASE=http://localhost:3235 node scripts/qa/home-return.mjs

   Run it against a PRODUCTION build. The index holds the way into the world, so a visitor can leave from
   it, and the store that remembers it is open outlives the route: Back used to bring the same panel back
   over a page built again, with its scroll lock on. Checks (each prints PASS or FAIL; exit 1 if any failed):

     leaving    the index is open (and the lock on) when the world link is followed, and the route is /world
     back       the route is / again and the index is shut, hidden from assistive technology and inert,
                with no scroll lock left on the page
     the page   the wheel and the keys move the page, `i` opens the index again and Escape shuts it,
                and with the index open and shut again the lock goes with it */
import { chromium } from 'playwright'

const BASE = String(process.env.QA_BASE ?? 'http://localhost:3235').replace(/\/$/, '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], ignoreDefaultArgs: ['--hide-scrollbars'] })
let failed = 0
const check = (name, ok, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`)
}

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
const state = () => page.evaluate(() => {
  const idx = document.querySelector('[role="dialog"][aria-label="Chapter index"]')
  return {
    path: location.pathname,
    y: Math.round(scrollY),
    open: idx?.getAttribute('data-open') ?? null,
    hidden: idx?.getAttribute('aria-hidden') ?? null,
    inert: idx ? idx.hasAttribute('inert') : null,
    locked: document.documentElement.dataset.sheet === 'open',
  }
})
const ready = () => page.waitForFunction(() => document.querySelector('[data-room-host]')?.getAttribute('data-ready') === 'true', null, { timeout: 120000 })

await page.goto(`${BASE}/?room-still`, { waitUntil: 'load' })
await ready()
await sleep(1200)
await page.evaluate(() => scrollTo(0, 9000))
await sleep(1500)
await page.keyboard.press('i')
await sleep(900)
const before = await state()
check('leaving: the index is open, with the lock on', before.open === 'true' && before.locked, JSON.stringify(before))
await page.locator('[role="dialog"][aria-label="Chapter index"] a[href="/world"]').first().click()
await page.waitForURL('**/world', { timeout: 30000 }).catch(() => {})
await sleep(3000)
check('leaving: the route is /world', (await state()).path === '/world', JSON.stringify(await state()))

await page.goBack({ waitUntil: 'load' }).catch(() => {})
await ready().catch(() => {})
await sleep(2500)
const back = await state()
check('back: the route is the homepage again', back.path === '/', JSON.stringify(back))
check('back: the index is shut, hidden and inert', back.open === 'false' && back.hidden === 'true' && back.inert === true, JSON.stringify(back))
check('back: no scroll lock is left on the page', !back.locked, JSON.stringify(back))

await page.mouse.move(720, 450)
const y0 = back.y
await page.mouse.wheel(0, 700)
await sleep(1500)
const afterWheel = await state()
check('the page: the wheel moves it', afterWheel.y > y0 + 100, `${y0} -> ${afterWheel.y}`)
await page.keyboard.press('PageDown')
await sleep(1200)
const afterKey = await state()
check('the page: PageDown moves it', afterKey.y > afterWheel.y + 100, `${afterWheel.y} -> ${afterKey.y}`)
await page.keyboard.press('i')
await sleep(900)
const reopened = await state()
check('the page: `i` opens the index again', reopened.open === 'true' && reopened.locked, JSON.stringify(reopened))
await page.keyboard.press('Escape')
await sleep(900)
const shut = await state()
check('the page: Escape shuts it and the lock goes with it', shut.open === 'false' && !shut.locked, JSON.stringify(shut))
check('no page errors', errors.length === 0, JSON.stringify(errors))

await browser.close()
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
