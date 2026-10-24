/* What the homepage does when it is left alone, and what it shows with motion reduced.

     QA_BASE=http://localhost:3235 node scripts/qa/home-rest-motion.mjs [--sleeps]

   Run it against a PRODUCTION build. Checks (each prints PASS or FAIL; the exit code is 1 if any failed):

     cursor        the cursor ring is drawn at the centre of the viewport before the first pointer move (it used
                   to be left at 0,0 and jump on the first move)
     leader        reduced motion, Universe > Orbits: the leader line is on while a body is hovered and off after
                   the pointer leaves it, for three bodies (its pose reads this render's hover, not the last one's)
     stale         reduced motion, Universe > Constellation: hovering a star changes the picture and leaving it
                   brings back exactly the picture there was
     ambient rest  About > Journey ribbon, the Toolbox lattice and Universe > Orbits stop asking for frames once
                   the visitor has been still for the ambient linger (lib/ticker `ambient`), ask again on the next
                   input, and a page asleep draws the same picture two seconds on
     sleeps        (only with --sleeps) the shared loop itself is asleep then: no pass at all. This needs the two
                   loop owners that are not part of the home work (WorldPortal's tick and Lenis) to sleep as well;
                   without it, `busy` still has to list neither a section nor the lattice.

   The ticker's state is read through `window.__ticker()`, which exists because this script sets
   `window.__tickerDebug` before the page loads. Nothing in the repository changes. */
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const BASE = String(process.env.QA_BASE ?? 'http://localhost:3235').replace(/\/$/, '')
const SLEEPS = args.includes('--sleeps')
// lib/ticker AMBIENT_LINGER + AMBIENT_EASE, and a margin.
const QUIET_MS = 13500
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], ignoreDefaultArgs: ['--hide-scrollbars'] })
let failed = 0
const check = (name, ok, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`)
}

const open = async ({ reducedMotion = 'no-preference', query = '' } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
  await page.addInitScript(() => { window.__tickerDebug = true })
  await page.goto(`${BASE}/?room-still${query}`, { waitUntil: 'load' })
  await page.waitForFunction(() => document.querySelector('[data-room-host]')?.getAttribute('data-ready') === 'true', null, { timeout: 120000 })
  await sleep(1500)
  const chapters = await page.evaluate(() => [...document.querySelectorAll('#journey section[data-chapter]')].map((el) => ({ id: el.dataset.chapter, top: el.getBoundingClientRect().top + scrollY, h: el.offsetHeight })))
  const goto = async (id, ms = 2500) => {
    const c = chapters.find((x) => x.id === id)
    await page.evaluate((y) => scrollTo(0, y), Math.round(c.top + (c.h - 900) * 0.5))
    await sleep(ms)
  }
  return { ctx, page, errors, goto }
}

/* ---- the cursor ring before the first move ---- */
{
  const { ctx, page } = await open()
  const ring = await page.evaluate(() => {
    const host = document.querySelector('[class*="Cursor-module"][class*="host"]')
    const el = host?.children[1]
    const r = el?.getBoundingClientRect()
    return r ? [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)] : null
  })
  check('cursor: the ring starts at the centre of the viewport', !!ring && Math.abs(ring[0] - 720) <= 2 && Math.abs(ring[1] - 450) <= 2, JSON.stringify(ring))
  await ctx.close()
}

/* ---- reduced motion: the Orbits leader ---- */
{
  const { ctx, page, goto } = await open({ reducedMotion: 'reduce', query: '&section-animation=universe.orbits' })
  await goto('universe', 3000)
  const leader = () => page.evaluate(() => document.querySelector('#chapter-universe line[class*="leader"]')?.style.opacity ?? null)
  const bodies = page.locator('#chapter-universe button[data-tier]')
  const n = await bodies.count()
  for (const i of [0, 2, 5].filter((k) => k < n)) {
    const b = await bodies.nth(i).boundingBox()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 })
    await sleep(350)
    const on = await leader()
    await page.mouse.move(8, 8, { steps: 3 })
    await sleep(350)
    const off = await leader()
    check(`leader: body ${i} lights its leader on enter and clears it on leave`, on === '1' && off === '0', `enter ${on}, leave ${off}`)
  }
  await ctx.close()
}

/* ---- reduced motion: the Constellation's stars ---- */
{
  const { ctx, page, goto } = await open({ reducedMotion: 'reduce', query: '&section-animation=universe.constellation' })
  await goto('universe', 3000)
  const buttons = page.locator('#chapter-universe [data-section-animation] button')
  const n = await buttons.count()
  const before = await page.screenshot()
  const b = await buttons.nth(Math.min(2, n - 1)).boundingBox()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 })
  await sleep(500)
  const during = await page.screenshot()
  await page.mouse.move(8, 8, { steps: 3 })
  await sleep(500)
  const after = await page.screenshot()
  check('stale: hovering a star changes the picture', !before.equals(during))
  check('stale: leaving it brings back the same picture', before.equals(after))
  await ctx.close()
}

/* ---- ambient motion comes to rest, and wakes ---- */
{
  const { ctx, page, goto, errors } = await open({ query: '&section-animation=about.journey-ribbon,universe.orbits' })
  const tick = () => page.evaluate(() => { const t = window.__ticker?.(); return t ? { running: t.running, passes: t.passes, busy: t.busy } : null })
  for (const [id, who] of [['about', 'section:about'], ['toolbox', 'toolbox-lattice'], ['universe', 'section:universe']]) {
    await goto(id, 2500)
    const during = await tick()
    await sleep(QUIET_MS - 2500)
    const a = await tick()
    const shotA = await page.screenshot()
    await sleep(2000)
    const b = await tick()
    const shotB = await page.screenshot()
    const asleep = !!a && !a.busy.some((x) => x === who || x.startsWith('section:') || x === 'toolbox-lattice')
    check(`ambient rest: ${id} asks for no more frames after ${QUIET_MS / 1000} s of stillness`, asleep, `busy while still: ${JSON.stringify(a?.busy)}`)
    check(`ambient rest: ${id} shows the same picture two seconds on`, shotA.equals(shotB))
    if (SLEEPS) check(`sleeps: the shared loop is asleep at ${id}`, !!a && !!b && !a.running && b.passes === a.passes, JSON.stringify({ running: a?.running, passes: [a?.passes, b?.passes], busy: a?.busy }))
    await page.mouse.move(600, 450)
    await page.mouse.move(604, 452)
    await sleep(300)
    const c = await tick()
    check(`ambient rest: an input wakes ${id}`, !!during?.busy.includes(who) && !!c?.busy.includes(who), `while on stage ${JSON.stringify(during?.busy)}, after a move ${JSON.stringify(c?.busy)}`)
  }
  check('no page errors', errors.length === 0, JSON.stringify(errors))
  await ctx.close()
}

await browser.close()
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
