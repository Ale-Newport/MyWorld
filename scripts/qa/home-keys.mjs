/* The keyboard on the two sheets that stand over the homepage: the case study and the chapter index.

     QA_BASE=http://localhost:3235 [QA_BROWSER=webkit] node scripts/qa/home-keys.mjs

   Run it against a PRODUCTION build. Each check prints PASS or FAIL; the exit code is 1 if any failed.

   While a sheet is open the page behind it must not move (scroll lock), and the sheet's own scroller must
   answer the paging keys wherever the keyboard happens to be: on the Close button where the sheet puts it,
   on the page body after a click on the text, or on a row or a link inside the scroller. Per start:

     case study at 1280x640 and 1280x480   body after a click on the text (both), Close focused / blurred /
                                           a link in the column (480)
     index panel at 1280x420  (the panel itself scrolls) body after a click on its heading / Close focused
     index panel at 1280x800  (the list scrolls, the head and Close are outside it) Close focused / body /
                              the current chapter's row, where the panel puts focus when it opens

   and for each start: PageDown, ArrowDown, Space, Shift+Space, PageUp, End and Home move the scroller (and
   only it; Space is left to a focused Close button or row, which it presses); Ctrl+End, Ctrl+Home, Cmd+Down
   and Cmd+Up go to its ends where the keyboard is not inside it; the page stays where it was; at an end the
   key does not carry on to the page; ten ArrowDowns
   sent at once travel ten lines; and with reduced motion the scroller is already at its destination a
   frame after the key.

   Also the keys on a LINK that stands outside the scroller (the index panel's footer holds the way into the world and
   the contact links, below the list, above about 700px of height): Space on a link does nothing but scroll, so the
   sheet has to carry it out like any paging key and not leave it to the browser, which would move the page behind;
   the same on a link inside the scroller at its ends. On a Mac, Option+Up and Option+Down page the sheet. And with
   the index open under a case study, a key belongs to the case study in front, not to the list underneath; and
   the other way round: with a case study open, `i` does not open the index beneath it, and if the index is
   forced open there (the HUD button) the keys still go to the case study, wherever the focus is. One Escape
   closes one sheet, the front one, in both orders, also when the focus is on something that takes Escape for
   itself and cancels it (the canvas of the My Library case study). A scroll that did not come from a key
   (a jump, the scroll bar) is not undone by the next key, which starts from where the scroller is. */
import { chromium, webkit } from 'playwright'

const BASE = String(process.env.QA_BASE ?? 'http://localhost:3235').replace(/\/$/, '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const WEBKIT = process.env.QA_BROWSER === 'webkit'
// QA_ONLY=link,close runs only the starts that name one of those (and, with reduced motion, `reduced`).
const ONLY = process.env.QA_ONLY ? process.env.QA_ONLY.split(',') : null
const wanted = (how) => !ONLY || ONLY.includes(how)
const browser = WEBKIT
  ? await webkit.launch({ headless: true })
  : await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'], ignoreDefaultArgs: ['--hide-scrollbars'] })
let failed = 0
const check = (name, ok, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`)
}

async function open({ width, height, reducedMotion = 'no-preference' }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
  await page.goto(`${BASE}/?room-still`, { waitUntil: 'load' })
  await page.waitForFunction(() => document.querySelector('[data-room-host]')?.getAttribute('data-ready') === 'true', null, { timeout: 120000 })
  await sleep(1200)
  await page.evaluate(() => scrollTo(0, 9000))
  await sleep(1500)
  return { ctx, page, errors }
}

/** The state the checks read: the open sheet's scroller, and the page behind. */
const read = (page) => page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"][data-open="true"]')
  let sc = null
  for (const el of dlg ? dlg.querySelectorAll('*') : []) {
    const o = getComputedStyle(el).overflowY
    if ((o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight + 1) { sc = el; break }
  }
  return {
    open: !!dlg,
    y: Math.round(scrollY),
    locked: document.documentElement.dataset.sheet === 'open',
    top: sc ? Math.round(sc.scrollTop) : null,
    max: sc ? Math.round(sc.scrollHeight - sc.clientHeight) : null,
    client: sc ? sc.clientHeight : null,
    active: document.activeElement ? document.activeElement.tagName.toLowerCase() + (document.activeElement.className ? '.' + String(document.activeElement.className).split(' ')[0].replace(/_[a-zA-Z0-9]{5,}__.*$/, '') : '') : null,
  }
})

/** Waits until the scroller has stopped (a smooth scroll is a few hundred ms), then reads it. */
async function settled(page) {
  let last = await read(page)
  let still = 0
  for (let i = 0; i < 50 && still < 4; i++) {
    await sleep(60)
    const now = await read(page)
    still = now.top === last.top ? still + 1 : 0
    last = now
  }
  return last
}

async function press(page, key) {
  await page.keyboard.press(key)
  return settled(page)
}

/** One start (a way the sheet can have the keyboard): the paging keys and the lock. */
async function paging(label, page, y0, { space = true, chords = false, native = false } = {}) {
  // Where the keyboard is inside the scroller the browser itself scrolls it, and Playwright's WebKit does not scroll for the arrow keys there (it does not on the base build either).
  const arrows = !(WEBKIT && native)
  const s0 = await settled(page)
  check(`${label}: a sheet is open with a scroller that has room to scroll`, s0.open && s0.max > 100 && s0.top === 0, JSON.stringify(s0))
  if (!s0.open || !s0.max) return
  const room = s0.max
  const moves = (a, b) => b.top - a.top

  let a = s0
  let b = await press(page, 'PageDown')
  check(`${label}: PageDown scrolls it a page`, moves(a, b) >= Math.min(room, 0.6 * s0.client), `${a.top} -> ${b.top} (client ${s0.client})`)
  a = b
  if (arrows) {
    b = await press(page, 'ArrowDown')
    check(`${label}: ArrowDown scrolls it a line`, moves(a, b) >= 20 && moves(a, b) <= 80 || b.top === room, `${a.top} -> ${b.top}`)
    a = b
  }
  // On the Close button Space presses it (that is the button's own key, and the sheet must leave it alone).
  if (space) {
    b = await press(page, 'Space')
    check(`${label}: Space scrolls it a page`, moves(a, b) >= Math.min(room - a.top, 0.6 * s0.client) - 1, `${a.top} -> ${b.top}`)
    a = b
    b = await press(page, 'Shift+Space')
    check(`${label}: Shift+Space scrolls it back up a page`, moves(a, b) <= -Math.min(a.top, 0.6 * s0.client) + 1 && b.top < a.top, `${a.top} -> ${b.top}`)
    a = b
  }
  b = await press(page, 'End')
  check(`${label}: End goes to the end`, b.top === room, `${a.top} -> ${b.top} (max ${room})`)
  const atEnd = b
  b = await press(page, 'PageDown')
  check(`${label}: at the end PageDown stays there and does not carry on to the page`, b.top === room && b.y === y0, `top ${b.top}, page ${b.y} (was ${y0})`)
  b = await press(page, 'End')
  check(`${label}: at the end End does not carry on to the page`, b.top === room && b.y === y0, `top ${b.top}, page ${b.y}`)
  if (space) {
    b = await press(page, 'Space')
    check(`${label}: at the end Space does not carry on to the page`, b.top === room && b.y === y0, `top ${b.top}, page ${b.y}`)
  }
  a = atEnd
  b = await press(page, 'PageUp')
  check(`${label}: PageUp scrolls it back`, moves(a, b) <= -Math.min(room, 0.6 * s0.client), `${a.top} -> ${b.top}`)
  b = await press(page, 'Home')
  check(`${label}: Home goes to the start`, b.top === 0, `-> ${b.top}`)
  b = await press(page, 'PageUp')
  check(`${label}: at the start PageUp stays there and does not carry on to the page`, b.top === 0 && b.y === y0, `top ${b.top}, page ${b.y}`)
  b = await press(page, 'Home')
  check(`${label}: at the start Home does not carry on to the page`, b.top === 0 && b.y === y0, `top ${b.top}, page ${b.y}`)
  if (space) {
    b = await press(page, 'Shift+Space')
    check(`${label}: at the start Shift+Space does not carry on to the page`, b.top === 0 && b.y === y0, `top ${b.top}, page ${b.y}`)
  }
  check(`${label}: the page behind never moved and the lock held`, b.y === y0 && b.locked, `page ${b.y} (was ${y0}), locked ${b.locked}`)

  // The chords that mean "to the end" and "to the start" (Ctrl+End, Cmd+Down on a Mac): carried out by the sheet as well, where the keyboard is not in its scroller.
  if (chords) {
    for (const [key, want] of [['Control+End', room], ['Control+Home', 0], ['Meta+ArrowDown', room], ['Meta+ArrowUp', 0]]) {
      b = await press(page, key)
      check(`${label}: ${key} goes to the ${want ? 'end' : 'start'} and the page stays`, b.top === want && b.y === y0, `top ${b.top} (want ${want}), page ${b.y}`)
    }
    // Option+Down and Option+Up are a page on a Mac (Playwright cannot raise the browser's own command for them, so what moves the scroller here is the sheet).
    if (await page.evaluate(() => /Mac/i.test(navigator.userAgent))) {
      a = await press(page, 'Home')
      b = await press(page, 'Alt+ArrowDown')
      check(`${label}: Option+Down scrolls it a page and the page stays`, moves(a, b) >= Math.min(room, 0.6 * s0.client) && b.y === y0, `${a.top} -> ${b.top}, page ${b.y}`)
      a = b
      b = await press(page, 'Alt+ArrowUp')
      check(`${label}: Option+Up scrolls it back a page and the page stays`, moves(a, b) <= -Math.min(a.top, 0.6 * s0.client) && b.top < a.top && b.y === y0, `${a.top} -> ${b.top}, page ${b.y}`)
      b = await press(page, 'Home')
    }
  }

  // Held down: ten lines at once, with nothing awaited between them (the key repeats while it is held).
  if (arrows) {
    for (let i = 0; i < 10; i++) await page.keyboard.down('ArrowDown')
    await page.keyboard.up('ArrowDown')
    b = await settled(page)
    const want = Math.min(room, 400)
    check(`${label}: ten ArrowDowns in a row travel ten lines`, b.top >= want - 40 && b.top <= want + 40 && b.y === y0, `top ${b.top} (want about ${want}), page ${b.y}`)
    await press(page, 'Home')
  }
}

/** Reduced motion: the scroller is at its destination a frame or two after the key, not on its way. */
async function instant(label, page) {
  const s0 = await settled(page)
  if (!s0.open || !s0.max) return check(`${label}: nothing to scroll`, false, JSON.stringify(s0))
  await page.keyboard.press('PageDown')
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const early = await read(page)
  const late = await settled(page)
  check(`${label}: with reduced motion PageDown is already at its destination a frame later`, early.top > 0 && early.top === late.top, `after 2 frames ${early.top}, settled ${late.top}`)
  await page.keyboard.press('End')
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  const end = await read(page)
  check(`${label}: with reduced motion End is at the end a frame later`, end.top === end.max, `${end.top} of ${end.max}`)
}

/** Space on the focused Close button still closes the sheet, and leaves the page where it was. */
async function pressesClose(label, page, y0) {
  await page.locator('[role="dialog"][data-open="true"] button[class*="close"]').first().focus()
  await page.keyboard.press('Space')
  await sleep(900)
  const after = await read(page)
  check(`${label}: Space on Close still presses it, and the page stays where it was`, !after.open && !after.locked && after.y === y0, JSON.stringify(after))
}

const blur = (page) => page.evaluate(() => document.activeElement?.blur())

/** Presses Tab until the focus is on the link to `href` (the real way a keyboard gets there). Returns the number of Tabs, or -1. */
async function tabTo(page, href) {
  for (let i = 0; i < 80; i++) {
    if (await page.evaluate((h) => document.activeElement?.getAttribute?.('href') === h, href)) return i
    await page.keyboard.press('Tab')
    await sleep(30)
  }
  return -1
}

/** Where the open sheet's scroller is set to: its start or its end, with nothing in flight. */
async function park(page, where) {
  await page.evaluate((w) => {
    const dlg = document.querySelector('[role="dialog"][data-open="true"]')
    const sc = [...dlg.querySelectorAll('*')].find((el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1)
    sc.style.scrollBehavior = 'auto'
    sc.scrollTop = w === 'end' ? sc.scrollHeight : 0
    sc.style.scrollBehavior = ''
  }, where)
  return settled(page)
}

/** Space and Shift+Space on each link that stands outside the sheet's scroller (the index panel's footer): the sheet scrolls, the page stays. */
async function spaceOnLinks(label, page, y0) {
  const n = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"][data-open="true"]')
    const sc = [...dlg.querySelectorAll('*')].find((el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1)
    const out = [...dlg.querySelectorAll('a[href]')].filter((a) => !sc.contains(a))
    out.forEach((a, i) => a.setAttribute('data-qa-outside', String(i)))
    return out.length
  })
  check(`${label}: the panel has links outside the scroller to try`, n >= 2, `${n} links`)
  for (let i = 0; i < n; i++) {
    const sel = `[data-qa-outside="${i}"]`
    const name = await page.evaluate((q) => { const a = document.querySelector(q); return `${a.getAttribute('href')}`.slice(0, 40) }, sel)
    const s0 = await park(page, 'start')
    await page.locator(sel).focus()
    let b = await press(page, 'Space')
    check(`${label}: Space on the link ${name} scrolls the list a page and the page stays`, b.top >= Math.min(s0.max, 0.6 * s0.client) && b.y === y0, `0 -> ${b.top}, page ${b.y} (was ${y0})`)
    const mid = b.top
    b = await press(page, 'Shift+Space')
    check(`${label}: Shift+Space on the link ${name} scrolls it back and the page stays`, b.top < mid && b.y === y0, `${mid} -> ${b.top}, page ${b.y}`)
    await park(page, 'end')
    await page.locator(sel).focus()
    b = await press(page, 'Space')
    check(`${label}: at the end of the list Space on the link ${name} stays there and does not carry on to the page`, b.top === s0.max && b.y === y0, `top ${b.top} of ${s0.max}, page ${b.y}`)
    await park(page, 'start')
    await page.locator(sel).focus()
    b = await press(page, 'Shift+Space')
    check(`${label}: at the start of the list Shift+Space on the link ${name} does not carry on to the page`, b.top === 0 && b.y === y0, `top ${b.top}, page ${b.y}`)
  }
  const after = await read(page)
  check(`${label}: the lock held`, after.locked && after.y === y0, JSON.stringify(after))
}

/** The scroller of the open dialog named `name`: where it is, and the page behind. */
const scrollerOf = (page, name) => page.evaluate((n) => {
  const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.getAttribute('aria-label')?.includes(n))
  if (!dlg || dlg.getAttribute('data-open') !== 'true') return null
  const sc = [...dlg.querySelectorAll('*')].find((el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1)
  return { top: sc ? Math.round(sc.scrollTop) : null, max: sc ? Math.round(sc.scrollHeight - sc.clientHeight) : null, y: Math.round(scrollY) }
}, name)

/* ---- the case study ---- */
for (const [height, how] of [[640, 'text'], [480, 'text'], [480, 'close'], [480, 'blurred'], [480, 'link']].filter(([, h]) => wanted(h))) {
  const { ctx, page, errors } = await open({ width: 1280, height })
  await page.evaluate(() => { location.hash = '#project/focus' })
  await page.waitForFunction(() => document.querySelector('[role="dialog"][data-open="true"]'), null, { timeout: 8000 }).catch(() => {})
  await sleep(1000)
  if (how === 'text') await page.locator('[role="dialog"][data-open="true"] p').first().click()
  if (how === 'blurred') await blur(page)
  if (how === 'link') {
    const link = page.locator('[role="dialog"][data-open="true"] a[href]').first()
    if (await link.count()) await link.focus({ timeout: 2000 }).catch(() => {})
    await page.evaluate(() => { const sc = [...document.querySelectorAll('[role="dialog"][data-open="true"] *')].find((el) => getComputedStyle(el).overflowY === 'auto' && el.scrollHeight > el.clientHeight + 1); if (sc) sc.scrollTop = 0 })
  }
  const start = await read(page)
  const label = `case study at 1280x${height}, keys on ${how} (${start.active})`
  await paging(label, page, start.y, { space: how !== 'close', chords: how !== 'link', native: how === 'link' })
  if (how === 'close') await pressesClose(label, page, start.y)
  check(`${label}: no page errors`, errors.length === 0, JSON.stringify(errors))
  await ctx.close()
}

/* ---- the index panel ---- */
for (const [height, how] of [[420, 'heading'], [420, 'close'], [800, 'close'], [800, 'heading'], [800, 'row'], [800, 'links'], [900, 'tab']].filter(([, h]) => wanted(h))) {
  const { ctx, page, errors } = await open({ width: height === 900 ? 1440 : 1280, height })
  const y0 = (await read(page)).y
  await page.keyboard.press('i')
  await page.waitForFunction(() => document.querySelector('[role="dialog"][data-open="true"]'), null, { timeout: 8000 }).catch(() => {})
  await sleep(900)
  if (how === 'heading') await page.locator('[role="dialog"][data-open="true"] header p').first().click()
  if (how === 'close') await page.locator('[role="dialog"][data-open="true"] button[class*="close"]').first().focus()
  // The real way to the world link: Tab, from where the panel put the focus.
  if (how === 'tab') {
    // Safari's Tab skips links unless the visitor has asked it not to (so the focus is put there directly under WebKit).
    if (WEBKIT) await page.locator('[role="dialog"][data-open="true"] a[href="/world"]').focus()
    else check(`index at 1440x${height}: Tab reaches the link to the world`, (await tabTo(page, '/world')) >= 0, await page.evaluate(() => String(document.activeElement?.getAttribute?.('href'))))
    await park(page, 'start') // tabbing through the rows brought the list along; the keys are tried from its start
  }
  const start = await read(page)
  const wide = height === 900 ? 1440 : 1280
  const label = `index at ${wide}x${height}, keys on ${how} (${start.active})`
  if (how === 'links') await spaceOnLinks(label, page, y0)
  else await paging(label, page, y0, { space: how === 'heading' || how === 'tab', chords: how !== 'row' && !(height === 420 && how === 'close'), native: how === 'row' || (height === 420 && how === 'close') })
  if (how === 'close') await pressesClose(`index at 1280x${height}, keys on ${how}`, page, y0)
  check(`index at ${wide}x${height}, keys on ${how}: no page errors`, errors.length === 0, JSON.stringify(errors))
  await ctx.close()
}


/* ---- the index with a case study opened over it: a key belongs to the one in front ---- */
if (wanted('stack')) {
  const { ctx, page, errors } = await open({ width: 1280, height: 640 })
  const y0 = (await read(page)).y
  await page.keyboard.press('i')
  await page.waitForFunction(() => document.querySelector('[role="dialog"][aria-label="Chapter index"][data-open="true"]'), null, { timeout: 8000 }).catch(() => {})
  await sleep(900)
  await page.evaluate(() => { location.hash = '#project/focus' })
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"][data-open="true"]')].length === 2, null, { timeout: 8000 }).catch(() => {})
  await sleep(1000)
  const L = 'case study over the index at 1280x640'
  let idx = await scrollerOf(page, 'Chapter index')
  let cs = await scrollerOf(page, 'case study')
  check(`${L}: both sheets are open, each with room to scroll`, !!idx && !!cs && idx.max > 100 && cs.max > 100, JSON.stringify({ idx, cs }))
  // The case study put the focus on its Close button; a key goes to its column, not to the list under it.
  await page.keyboard.press('PageDown')
  await sleep(900)
  idx = await scrollerOf(page, 'Chapter index')
  cs = await scrollerOf(page, 'case study')
  check(`${L}: PageDown with focus on the case study's Close scrolls the case study`, cs.top > 100, JSON.stringify(cs))
  check(`${L}: and not the index under it`, idx.top === 0, JSON.stringify(idx))
  await page.keyboard.press('Space')
  await sleep(900)
  const cs2 = await scrollerOf(page, 'case study')
  idx = await scrollerOf(page, 'Chapter index')
  check(`${L}: Space on the Close button of the case study leaves both alone but presses it (it closes)`, cs2 === null && idx !== null && idx.top === 0 && idx.y === y0, JSON.stringify({ cs2, idx }))
  // The case study is gone: the key belongs to the index again.
  await page.locator('[role="dialog"][data-open="true"] header p').first().click()
  await page.keyboard.press('PageDown')
  await sleep(900)
  idx = await scrollerOf(page, 'Chapter index')
  check(`${L}: once the case study is closed, PageDown scrolls the index again`, idx && idx.top > 100 && idx.y === y0, JSON.stringify(idx))
  check(`${L}: no page errors`, errors.length === 0, JSON.stringify(errors))
  await ctx.close()
}

/* ---- a case study open, then the index: the case study keeps the keys, and Escape closes one sheet at a time ---- */
if (wanted('stack')) {
  const { ctx, page, errors } = await open({ width: 1280, height: 640 })
  const y0 = (await read(page)).y
  await page.evaluate(() => { location.hash = '#project/focus' })
  await page.waitForFunction(() => document.querySelector('[role="dialog"][aria-label$="case study"][data-open="true"]'), null, { timeout: 8000 })
  await sleep(1000)
  const L = 'index under a case study at 1280x640'
  const focusIn = () => page.evaluate(() => document.activeElement?.closest('[role="dialog"]')?.getAttribute('aria-label') ?? 'page')
  const isIndexOpen = async () => (await scrollerOf(page, 'Chapter index')) !== null
  // `i` is the index's shortcut, and it does not open the index over a case study: the focus would go under it.
  await page.keyboard.press('i')
  await sleep(900)
  check(`${L}: i does not open the index beneath the case study`, !(await isIndexOpen()), `index open ${await isIndexOpen()}`)
  check(`${L}: and the focus stays in the case study`, (await focusIn()).endsWith('case study'), await focusIn())
  await page.keyboard.press('PageDown')
  await sleep(900)
  let cs = await scrollerOf(page, 'case study')
  check(`${L}: PageDown then scrolls the case study`, cs && cs.top > 100 && cs.y === y0, JSON.stringify(cs))
  await page.keyboard.press('Home')
  await sleep(900)

  // Forced open all the same (the HUD button, reached by a script: it stands under the case study's scrim).
  await page.evaluate(() => document.querySelector('button[class*="indexBtn"]').click())
  await page.waitForFunction(() => document.querySelector('[role="dialog"][aria-label="Chapter index"][data-open="true"]'), null, { timeout: 8000 })
  await sleep(900)
  check(`${L}: forced open, the focus is inside the index (the case under test)`, (await focusIn()) === 'Chapter index', await focusIn())
  // (Not Space: the focus is on a row of the index, a button, which Space presses.)
  for (const key of ['PageDown', 'ArrowDown', 'End']) {
    await page.keyboard.press('Home')
    await sleep(900)
    const before = await scrollerOf(page, 'case study')
    await page.keyboard.press(key)
    await sleep(900)
    cs = await scrollerOf(page, 'case study')
    const idx = await scrollerOf(page, 'Chapter index')
    check(`${L}: ${key} with the focus in the index scrolls the case study in front`, !!cs && cs.top > before.top, `${before.top} -> ${cs?.top}`)
    check(`${L}: and not the index, nor the page, after ${key}`, !!idx && idx.top === 0 && idx.y === y0, JSON.stringify(idx))
  }
  // One Escape, one sheet: the case study (in front) goes, the index stays; a second Escape closes the index.
  await page.keyboard.press('Escape')
  await sleep(900)
  cs = await scrollerOf(page, 'case study')
  check(`${L}: Escape closes the case study in front and leaves the index open`, cs === null && (await isIndexOpen()), `case study ${JSON.stringify(cs)}, index open ${await isIndexOpen()}`)
  await page.keyboard.press('Escape')
  await sleep(900)
  const end = await read(page)
  check(`${L}: a second Escape closes the index, the lock is released and the page is where it was`, !end.open && !end.locked && end.y === y0, JSON.stringify(end))
  check(`${L}: no page errors`, errors.length === 0, JSON.stringify(errors))
  await ctx.close()
}

if (wanted('stack')) {
  // The other order: the index first, a case study over it (a deep link). Escape closes the case study, then the index.
  const { ctx, page, errors } = await open({ width: 1280, height: 640 })
  const y0 = (await read(page)).y
  await page.keyboard.press('i')
  await page.waitForFunction(() => document.querySelector('[role="dialog"][aria-label="Chapter index"][data-open="true"]'), null, { timeout: 8000 })
  await sleep(900)
  await page.evaluate(() => { location.hash = '#project/focus' })
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"][data-open="true"]')].length === 2, null, { timeout: 8000 })
  await sleep(1000)
  const L = 'case study over the index, Escape'
  await page.keyboard.press('Escape')
  await sleep(900)
  const cs = await scrollerOf(page, 'case study')
  const idx = await scrollerOf(page, 'Chapter index')
  check(`${L}: the first closes the case study and leaves the index open`, cs === null && idx !== null, `case study ${JSON.stringify(cs)}, index ${JSON.stringify(idx)}`)
  await page.keyboard.press('Escape')
  await sleep(900)
  const end = await read(page)
  check(`${L}: the second closes the index, and the page is where it was`, !end.open && !end.locked && end.y === y0, JSON.stringify(end))
  check(`${L}: no page errors`, errors.length === 0, JSON.stringify(errors))
  await ctx.close()
}

/* ---- Escape with the focus on something inside the sheet that takes the key for itself ----
   The My Library visual is a canvas the visitor types an ISBN on; it clears what was typed on Escape and cancels the
   event (`preventDefault`). That must not stop the sheet from closing: the press is not "answered" by a sheet until
   a sheet has closed on it. */
if (wanted('library')) {
  const { ctx, page, errors } = await open({ width: 1280, height: 800 })
  const y0 = (await read(page)).y
  const L = 'My Library case study, Escape on its canvas'
  await page.evaluate(() => { location.hash = '#project/my-library' })
  await page.waitForFunction(() => document.querySelector('[role="dialog"][aria-label$="case study"][data-open="true"] canvas'), null, { timeout: 8000 })
  await sleep(1200)
  const focusOnCanvas = () => page.evaluate(() => document.activeElement?.tagName === 'CANVAS')
  await page.locator('[role="dialog"][data-open="true"] canvas').first().click()
  await page.keyboard.type('978')
  await sleep(200)
  check(`${L}: the canvas has the focus and took the digits (the case under test)`, await focusOnCanvas())
  await page.keyboard.press('PageDown')
  await sleep(900)
  const cs = await scrollerOf(page, 'case study')
  check(`${L}: a paging key from the canvas scrolls the case study and not the page`, !!cs && cs.top > 100 && cs.y === y0, JSON.stringify(cs))
  await page.locator('[role="dialog"][data-open="true"] canvas').first().click()
  await page.keyboard.press('Escape')
  await sleep(900)
  const end = await read(page)
  check(`${L}: the first Escape closes the sheet, the lock is released and the page is where it was`, !end.open && !end.locked && end.y === y0, JSON.stringify(end))
  check(`${L}: no page errors`, errors.length === 0, JSON.stringify(errors))
  await ctx.close()
}
if (wanted('library')) {
  // And with the index under it (the case study over the index, the canvas focused): one Escape closes the case study only.
  const { ctx, page, errors } = await open({ width: 1280, height: 800 })
  const y0 = (await read(page)).y
  const L = 'My Library case study over the index, Escape on its canvas'
  await page.keyboard.press('i')
  await page.waitForFunction(() => document.querySelector('[role="dialog"][aria-label="Chapter index"][data-open="true"]'), null, { timeout: 8000 })
  await sleep(900)
  await page.evaluate(() => { location.hash = '#project/my-library' })
  await page.waitForFunction(() => document.querySelector('[role="dialog"][aria-label$="case study"][data-open="true"] canvas'), null, { timeout: 8000 })
  await sleep(1200)
  await page.locator('[role="dialog"][aria-label$="case study"][data-open="true"] canvas').first().click()
  await page.keyboard.press('Escape')
  await sleep(900)
  const cs = await scrollerOf(page, 'case study')
  const idx = await scrollerOf(page, 'Chapter index')
  check(`${L}: the first closes the case study and leaves the index open`, cs === null && idx !== null, `case study ${JSON.stringify(cs)}, index ${JSON.stringify(idx)}`)
  await page.keyboard.press('Escape')
  await sleep(900)
  const end = await read(page)
  check(`${L}: the second closes the index, and the page is where it was`, !end.open && !end.locked && end.y === y0, JSON.stringify(end))
  check(`${L}: no page errors`, errors.length === 0, JSON.stringify(errors))
  await ctx.close()
}

/* ---- a scroll that did not come from a key is not undone by the next one ---- */
if (wanted('aim')) {
  const { ctx, page, errors } = await open({ width: 1280, height: 640 })
  await page.evaluate(() => { location.hash = '#project/focus' })
  await page.waitForFunction(() => document.querySelector('[role="dialog"][data-open="true"]'), null, { timeout: 8000 })
  await sleep(1000)
  const L = 'case study at 1280x640, a jump between two keys'
  const jump = (top) => page.evaluate((t) => {
    const dlg = document.querySelector('[role="dialog"][data-open="true"]')
    const sc = [...dlg.querySelectorAll('*')].find((el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1)
    sc.style.scrollBehavior = 'auto'
    sc.scrollTop = t
    sc.style.scrollBehavior = ''
  }, top)
  // An arrow starts a smooth scroll; while it is still on its way something else (a find, an anchor, the scroll bar) puts the scroller elsewhere.
  await page.keyboard.press('ArrowDown')
  await sleep(40)
  await jump(250)
  await sleep(60)
  await page.keyboard.press('ArrowDown')
  const b = await settled(page)
  check(`${L}: the next arrow goes a line on from where the jump left it, not back to where the last was heading`, b.top >= 250 && b.top <= 250 + 80, `top ${b.top} (jump to 250)`)
  check(`${L}: no page errors`, errors.length === 0, JSON.stringify(errors))
  await ctx.close()
}

/* ---- reduced motion ---- */
if (wanted('reduced')) {
  const { ctx, page } = await open({ width: 1280, height: 640, reducedMotion: 'reduce' })
  await page.evaluate(() => { location.hash = '#project/focus' })
  await page.waitForFunction(() => document.querySelector('[role="dialog"][data-open="true"]'), null, { timeout: 8000 }).catch(() => {})
  await sleep(1000)
  await blur(page)
  await instant('case study, reduced motion', page)
  await ctx.close()
}
if (wanted('reduced')) {
  const { ctx, page } = await open({ width: 1280, height: 420, reducedMotion: 'reduce' })
  await page.keyboard.press('i')
  await page.waitForFunction(() => document.querySelector('[role="dialog"][data-open="true"]'), null, { timeout: 8000 }).catch(() => {})
  await sleep(900)
  await page.locator('[role="dialog"][data-open="true"] header p').first().click()
  await instant('index, reduced motion', page)
  await ctx.close()
}

await browser.close()
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
