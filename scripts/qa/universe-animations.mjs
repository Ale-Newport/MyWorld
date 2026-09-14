/* The five Project Universe animations, on the real page: screenshots
   at the sizes the section has to compose for, and the interaction
   contract every option keeps (src/sections/README.md).

     node scripts/qa/universe-animations.mjs [--base URL] [--only orbits,gallery]
       [--out DIR] [--sizes 1440x900,390x844] [--at 0.5]

   For each option the page is opened with `?section-animation=<id>`
   and the Universe chapter is scrolled to `--at` of its length (the
   middle by default, where its stage is pinned). Then:

     shots       the viewport at every size, plus 1440×900 under
                 reduced motion, with a filter on, and with keyboard
                 focus on a project
     overflow    the document is never wider than the viewport
     console     no errors and no warnings from the page. Turbopack's
                 dev server answers 404 for a few chunk preloads its
                 own manifest lists; those are counted apart, as noise
                 of `next dev`, never as the option's
     buttons     every project the current filter shows is a button in
                 the animation's group, labelled with its title, in the
                 tab order; the group is labelled "Project archive"
     keyboard    Tab from the last filter chip lands on a project;
                 Enter opens its case study (#project/<slug>), Escape
                 closes it
     hover       pointing at a project names it in the chapter's readout
     filter      "AI / ML": every item stays, the others are subdued,
                 marked aria-hidden and out of the tab order, and Tab
                 reaches only matching projects
     tap         on a touch phone, a tap on a project opens it

   Exit code 1 when any check fails. Needs a dev or production server.
*/
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  if (i < 0) return fallback
  const v = args[i + 1]
  return v === undefined || v.startsWith('--') ? true : v
}
const BASE = opt('base', process.env.QA_BASE ?? 'http://localhost:3402')
const OUT = path.resolve(opt('out', '.qa/universe-animations'))
const AT = Number(opt('at', 0.5))
const ALL = ['orbits', 'constellation', 'gallery', 'mosaic', 'layered-field']
const ONLY = String(opt('only', ALL.join(','))).split(',')
const SIZES = String(opt('sizes', '1440x900,1024x768,768x1024,390x844,320x640,2560x1440'))
  .split(',')
  .map((s) => s.split('x').map(Number))
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const failures = []
let noise = 0

function watch(page) {
  const log = { errors: [], warnings: [], devMisses: 0 }
  const misses = []
  page.on('response', (r) => {
    if (r.status() === 404 && /\/_next\/static\/chunks\//.test(r.url())) misses.push(r.url())
  })
  page.on('console', (m) => {
    const text = m.text()
    if (m.type() === 'error') {
      // A 404 the dev server gave for one of its own chunk preloads.
      if (/Failed to load resource.*404/.test(text) && misses.length > log.devMisses) {
        log.devMisses++
        return
      }
      log.errors.push(text.slice(0, 240))
    } else if (m.type() === 'warning') {
      // Three's deprecation notice and the dev server's preload hints are the site's, not an option's.
      if (/THREE\.Clock|was preloaded using link preload but not used/.test(text)) return
      log.warnings.push(text.slice(0, 240))
    }
  })
  page.on('pageerror', (e) => log.errors.push(`pageerror: ${String(e).slice(0, 240)}`))
  return log
}

async function open(page, id) {
  await page.goto(`${BASE}/?section-animation=universe.${id}`, { waitUntil: 'load' })
  await page.waitForSelector('section[data-chapter="universe"]')
  await page.waitForTimeout(800)
  await page.evaluate((at) => {
    const s = document.querySelector('section[data-chapter="universe"]')
    window.scrollTo(0, Math.max(0, s.offsetTop + (s.offsetHeight - innerHeight) * at))
  }, AT)
  await page.waitForSelector(`[data-section-animation="universe.${id}"] [role="group"] button`, { state: 'attached', timeout: 30000 })
  await page.waitForTimeout(1800)
}

const GROUP = (id) => `[data-section-animation="universe.${id}"] [role="group"][aria-label="Project archive"]`

/** Titles the chapter's own list shows for the current filter: the ground truth. */
const listTitles = (page) =>
  page.$$eval('section[data-chapter="universe"] [data-open] li button > span:nth-child(2)', (els) => els.map((e) => e.textContent.trim()))

/** A project in the tab order whose centre is its own (in view, nothing drawn over it): the aria-label, or null. */
const pickVisible = (page, id) =>
  page.$$eval(`${GROUP(id)} button:not([tabindex="-1"])`, (els) => {
    for (const e of els) {
      const r = e.getBoundingClientRect()
      if (r.width < 4 || r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) continue
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      if (hit && (hit === e || e.contains(hit))) return e.getAttribute('aria-label')
    }
    return null
  })
const byLabel = (id, label) => `${GROUP(id)} button[aria-label="${label.replace(/"/g, '\\"')}"]`

async function check(name, id, fn) {
  try {
    const result = await fn()
    if (result === true || result === undefined) console.log(`  ok    ${name}`)
    else {
      failures.push(`${id}: ${name} — ${result}`)
      console.log(`  FAIL  ${name} — ${result}`)
    }
  } catch (e) {
    failures.push(`${id}: ${name} — ${String(e).split('\n')[0]}`)
    console.log(`  FAIL  ${name} — ${String(e).split('\n')[0]}`)
  }
}

for (const id of ONLY) {
  console.log(`\nuniverse.${id}`)

  /* ---- screenshots and overflow at every size ---- */
  for (const [w, h] of SIZES) {
    const phone = w < 800
    const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone })
    const page = await context.newPage()
    const log = watch(page)
    await open(page, id)
    await page.screenshot({ path: path.join(OUT, `${id}-${w}x${h}.png`) })
    await check(`${w}×${h} no horizontal overflow`, id, () =>
      page.evaluate(() => (document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 ? true : `scrollWidth ${document.documentElement.scrollWidth}`)),
    )
    await check(`${w}×${h} every listed project is a labelled button in the tab order`, id, async () => {
      const titles = await listTitles(page)
      // Tabbable for real: not only tabindex, but nothing (hidden, inert, undisplayed) keeping focus out.
      const buttons = await page.$$eval(`${GROUP(id)} button:not([tabindex="-1"])`, (els) =>
        els.map((e) => ({ label: e.getAttribute('aria-label') ?? '', focusable: e.checkVisibility({ visibilityProperty: true }) && !e.closest('[inert]') && !e.disabled })),
      )
      const labels = buttons.map((b) => b.label)
      const missing = titles.filter((t) => !labels.some((l) => l.includes(t)))
      const blocked = buttons.filter((b) => !b.focusable)
      if (!titles.length) return 'the chapter lists no projects'
      if (missing.length) return `no button for: ${missing.slice(0, 4).join(', ')}`
      if (labels.length !== titles.length) return `${labels.length} tabbable buttons for ${titles.length} projects`
      if (blocked.length) return `${blocked.length} buttons cannot take focus (e.g. ${blocked[0].label})`
      return true
    })
    await check(`${w}×${h} console clean`, id, () => (log.errors.length || log.warnings.length ? [...log.errors, ...log.warnings].slice(0, 3).join(' | ') : true))
    noise += log.devMisses
    await context.close()
  }

  /* ---- reduced motion ---- */
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    const log = watch(page)
    await open(page, id)
    await page.screenshot({ path: path.join(OUT, `${id}-1440x900-reduced.png`) })
    await check('reduced motion: still (two frames a second apart match)', id, async () => {
      const a = await page.locator(GROUP(id)).screenshot()
      await page.waitForTimeout(1000)
      const b = await page.locator(GROUP(id)).screenshot()
      return a.equals(b) ? true : 'the composition moved'
    })
    await check('reduced motion: console clean', id, () => (log.errors.length || log.warnings.length ? [...log.errors, ...log.warnings].slice(0, 3).join(' | ') : true))
    noise += log.devMisses
    await context.close()
  }

  /* ---- keyboard, hover and filter on a desktop ---- */
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    const log = watch(page)
    await open(page, id)
    const group = GROUP(id)

    await check('group role and label', id, async () => ((await page.$(group)) ? true : 'no role=group labelled "Project archive"'))

    await check('Tab from the filters lands on a project', id, async () => {
      await page.$$eval('[data-filter-chip]', (els) => els[els.length - 1].focus())
      await page.keyboard.press('Tab')
      await page.waitForTimeout(500)
      const inside = await page.evaluate((sel) => {
        const a = document.activeElement
        return !!a && a.tagName === 'BUTTON' && !!a.closest(sel) && !!a.getAttribute('aria-label')
      }, group)
      if (!inside) return 'focus went elsewhere'
      for (let i = 0; i < 3; i++) await page.keyboard.press('Tab')
      await page.waitForTimeout(500)
      const still = await page.evaluate((sel) => !!document.activeElement?.closest(sel), group)
      return still ? true : 'the fourth Tab left the archive'
    })
    await page.screenshot({ path: path.join(OUT, `${id}-1440x900-focus.png`) })

    if (id === 'gallery') {
      await check('arrow keys step the focus between frames', id, async () => {
        const labels = await page.$$eval(`${group} button:not([tabindex="-1"])`, (els) => els.map((e) => e.getAttribute('aria-label')))
        const at = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')
        const from = labels.indexOf(await at())
        await page.keyboard.press('ArrowRight')
        await page.waitForTimeout(250)
        const right = labels.indexOf(await at())
        await page.keyboard.press('ArrowLeft')
        await page.keyboard.press('ArrowLeft')
        await page.waitForTimeout(250)
        const left = labels.indexOf(await at())
        await page.keyboard.press('End')
        await page.waitForTimeout(1500)
        const end = labels.indexOf(await at())
        await page.screenshot({ path: path.join(OUT, `${id}-1440x900-focus-end.png`) })
        if (right !== from + 1 || left !== from - 1 || end !== labels.length - 1) return `from ${from}: right ${right}, left ${left}, end ${end}`
        // The room has turned the last frame into view.
        const inView = await page.evaluate(() => {
          const r = document.activeElement.getBoundingClientRect()
          return r.left >= 0 && r.right <= innerWidth && r.width > 20
        })
        return inView ? true : 'the focused frame is out of view'
      })
    }

    await check('Enter opens the case study, Escape closes it', id, async () => {
      const label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')
      await page.keyboard.press('Enter')
      try {
        await page.waitForFunction(() => location.hash.startsWith('#project/'), null, { timeout: 5000 })
        const dialog = await page.$eval('[role="dialog"][aria-label$="case study"]', (d) => ({ open: d.getAttribute('data-open'), label: d.getAttribute('aria-label') }))
        const title = label.split(' — ')[0].replace(/ \([^)]*\)$/, '')
        if (dialog.open !== 'true' || !dialog.label?.includes(title)) return `overlay ${JSON.stringify(dialog)} for "${label}"`
      } finally {
        await page.keyboard.press('Escape')
      }
      await page.waitForFunction(() => !location.hash.startsWith('#project/'), null, { timeout: 5000 })
      await page.waitForTimeout(600)
      return true
    })

    await check('hover names the project in the readout', id, async () => {
      const label = await pickVisible(page, id)
      if (!label) return 'no project in view to point at'
      await page.locator(byLabel(id, label)).hover({ force: true })
      await page.waitForTimeout(400)
      const text = await page.$eval('section[data-chapter="universe"] [aria-live="polite"]', (e) => e.textContent ?? '')
      await page.mouse.move(2, 2)
      return text.includes(label.split(' — ')[0].replace(/ \([^)]*\)$/, '')) ? true : `readout says "${text.slice(0, 60)}"`
    })

    await check('filter "AI / ML" subdues the rest in place and out of the tab order', id, async () => {
      const before = await page.$$eval(`${group} button`, (els) => els.length)
      const chip = page.locator('[data-filter-chip]', { hasText: 'AI / ML' })
      const expected = Number((await chip.textContent()).replace(/\D+/g, ''))
      await chip.click()
      await page.waitForTimeout(1200)
      const state = await page.$$eval(`${group} button`, (els) =>
        els.map((e) => {
          const chain = [e, e.parentElement, e.firstElementChild, e.firstElementChild?.firstElementChild].filter(Boolean)
          const opacity = Math.min(...chain.map((x) => Number(getComputedStyle(x).opacity)))
          const dim = e.hasAttribute('data-dim') || e.parentElement?.hasAttribute('data-dim')
          return { tab: e.getAttribute('tabindex'), hidden: e.getAttribute('aria-hidden'), dim, opacity, label: e.getAttribute('aria-label') }
        }),
      )
      await page.screenshot({ path: path.join(OUT, `${id}-1440x900-filter-ai.png`) })
      if (state.length !== before) return `${before} items became ${state.length}`
      const on = state.filter((s) => s.tab !== '-1')
      const off = state.filter((s) => s.tab === '-1')
      if (on.length !== expected) return `${on.length} tabbable for ${expected} matching`
      const bad = off.filter((s) => s.hidden !== 'true' || !s.dim || s.opacity > 0.6)
      if (bad.length) return `${bad.length} left-out items not subdued/hidden (e.g. ${JSON.stringify(bad[0])})`
      const titles = await listTitles(page)
      await page.$$eval('[data-filter-chip]', (els) => els[els.length - 1].focus())
      await page.keyboard.press('Tab')
      await page.waitForTimeout(300)
      const first = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')
      await page.locator('[data-filter-chip]', { hasText: 'All' }).click()
      await page.waitForTimeout(600)
      return titles.some((t) => first.includes(t)) ? true : `Tab reached "${first}", not a matching project`
    })

    await check('desktop console clean', id, () => (log.errors.length || log.warnings.length ? [...log.errors, ...log.warnings].slice(0, 3).join(' | ') : true))
    noise += log.devMisses
    await context.close()
  }

  /* ---- a tap on a touch phone ---- */
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
    const page = await context.newPage()
    const log = watch(page)
    await open(page, id)
    await check('a tap opens a project', id, async () => {
      // A project whose centre is its own (nothing drawn over it), so the tap is unambiguous.
      const label = await pickVisible(page, id)
      if (!label) return 'no project could be tapped'
      await page.tap(byLabel(id, label), { force: true })
      await page.waitForFunction(() => location.hash.startsWith('#project/'), null, { timeout: 5000 })
      return true
    })
    await check('phone console clean', id, () => (log.errors.length || log.warnings.length ? [...log.errors, ...log.warnings].slice(0, 3).join(' | ') : true))
    noise += log.devMisses
    await context.close()
  }
}

await browser.close()
if (noise) console.log(`\n(${noise} dev-server chunk preload 404s ignored: next dev's own manifest, not an option's)`)
console.log(failures.length ? `\n${failures.length} failure(s):\n  ${failures.join('\n  ')}` : '\nall checks passed')
console.log(`screenshots in ${OUT}`)
if (failures.length) process.exitCode = 1
