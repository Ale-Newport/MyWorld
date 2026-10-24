/* Button feedback in /world: instant, quiet and right on a screen that cannot hover.

   Static (any engine): every :hover rule of the player's own stylesheets (player.css, portfolio-theme.css,
   atlas.css) sits inside @media (hover:hover); the buttons transition only transform and colours, in 120 ms
   or less, not `all` and not 180 ms; touch-action is manipulation and the tap highlight is transparent on
   the page's buttons; the spinner behind the leaves does not turn.

   On a phone (hasTouch + isMobile, no hover): a tap on Map's neighbours leaves no hover colours behind (the
   button is the colour it rests in once the finger is up), the zoom buttons of the map likewise; a finger
   held on a button shrinks it on the frame of the touch (it carries [data-press], its transform is 0.97 within
   100 ms) and lets go when the finger lifts; a mouse press does the same on a desktop.

   The theme's blanket button rule must not reach what is not a plain button: the drive's touch buttons keep
   touch-action:none (a finger drifting on JUMP is not taken over by the browser: no pointercancel, the hold
   goes on), and the map's pins, which atlas.js places with style.transform on every frame of a pan or zoom,
   have no transform transition (a pin never trails the photo). With prefers-reduced-motion nothing transitions.

     QA_BASE=http://localhost:3210 node scripts/qa/world-ui-feedback.mjs [--browser chromium|webkit|firefox] [--out dir] [--label x] */
import fs from 'node:fs'
import path from 'node:path'
import { BASE, launch, openPlayer, assert, sleep, finish, watch } from './lib.mjs'
import { webkit, firefox } from 'playwright'

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback }
const engine = arg('browser', 'chromium'), label = arg('label', 'run'), dir = path.resolve(arg('out', '.qa/runs/impl/ui'))
fs.mkdirSync(dir, { recursive: true })
const results = [], report = { engine, label, base: BASE }
const browser = engine === 'chromium' ? await launch() : await { webkit, firefox }[engine].launch({ headless: true })

/** True when something in this computed transition would animate `transform` (or everything) for any time. */
const animatesTransform = (c) => { const props = c.property.split(',').map((x) => x.trim()), durs = c.duration.split(',').map((x) => parseFloat(x) * (/ms/.test(x) ? 0.001 : 1)); return props.some((p, i) => (p === 'transform' || p === 'all') && durs[i % durs.length] > 0) }
/* ---- the stylesheets ---- */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = watch(page, `${engine} `)
  await openPlayer(page)
  await sleep(1200)
  // The map's stylesheet is added when the world is ready and loads on its own: wait for its rules; every sheet of the page is read through the CSSOM.
  await page.waitForFunction(() => [...document.styleSheets].some((s) => /atlas\.css/.test(s.href ?? '') && s.cssRules.length > 0), null, { timeout: 8000 }).catch(() => {})
  const sheets = await page.evaluate(() => {
    const out = []
    // A style rule has cssRules too (CSS nesting): look for its selector first.
    const walk = (rules, gated, name) => { for (const rule of rules) {
      if (rule.selectorText !== undefined) { if (/:hover/.test(rule.selectorText)) out.push({ sheet: name, selector: rule.selectorText.slice(0, 120), gated }) }
      else if (rule.cssRules) walk(rule.cssRules, gated || (!!rule.media && /hover:\s*hover/.test(rule.media.mediaText)), name)
    } }
    for (const sheet of document.styleSheets) { const name = (sheet.href ?? 'inline').split('/').pop().split('?')[0]; try { walk(sheet.cssRules, false, name) } catch { /* cross-origin */ } }
    return { rules: out, names: [...document.styleSheets].map((s) => (s.href ?? 'inline').split('/').pop().split('?')[0]) }
  })
  const own = sheets.rules.filter((r) => ['player.css', 'portfolio-theme.css', 'atlas.css'].includes(r.sheet))
  const open = own.filter((r) => !r.gated)
  report.hoverRules = { sheets: sheets.names, own: own.length, ungated: open }
  assert(sheets.names.includes('atlas.css') && own.length >= 6, `the player's own sheets were read (${sheets.names.join(', ')}; ${own.length} :hover rules)`, results)
  assert(open.length === 0, `every :hover rule of player.css, portfolio-theme.css and atlas.css is inside @media (hover:hover)${open.length ? ` — ungated: ${open.map((r) => `${r.sheet} ${r.selector}`).join(' | ')}` : ''}`, results)
  const style = await page.evaluate(() => {
    const read = (s) => { const e = document.querySelector(s), c = getComputedStyle(e); return { property: c.transitionProperty, duration: c.transitionDuration, touchAction: c.touchAction, tap: c.webkitTapHighlightColor } }
    const spinner = document.createElement('div'); spinner.className = 'spinner'; document.body.append(spinner)
    const spin = getComputedStyle(spinner).animationName; spinner.remove()
    return { nav: read('#player-nav button'), link: read('#player-nav a'), help: read('#close-help'), body: getComputedStyle(document.body).webkitTapHighlightColor, spin }
  })
  report.style = style
  const seconds = (list) => list.split(',').map((s) => parseFloat(s) * (/ms/.test(s) ? 0.001 : 1))
  for (const [name, s] of [['nav button', style.nav], ['nav link', style.link], ['dialog button', style.help]]) {
    assert(!/\ball\b/.test(s.property) && !/box-shadow|width|height|top|left|margin|padding/.test(s.property) && /transform/.test(s.property) && seconds(s.duration).every((d) => d <= 0.12), `${name}: transitions ${s.property} in ${s.duration} (only transform and colours, 120 ms at most)`, results)
    assert(s.touchAction === 'manipulation', `${name}: touch-action is ${s.touchAction}`, results)
  }
  // -webkit-tap-highlight-color exists in Chromium and WebKit only.
  assert(style.body === undefined || /rgba\(0, 0, 0, 0\)|transparent/.test(style.body), `the tap highlight is transparent on the player's page (${style.body ?? 'not a property of this engine'})`, results)
  assert(style.spin === 'none', `the spinner behind the leaves does not turn (${style.spin})`, results)
  // The drive's on-screen buttons are not shown on a desktop, but their computed style is read all the same.
  const touchStyle = await page.evaluate(() => Object.fromEntries(['#touch-jump', '#touch-vehicle', '#touch-recover'].map((s) => { const e = document.querySelector(s); return [s, e && { touchAction: getComputedStyle(e).touchAction, property: getComputedStyle(e).transitionProperty, duration: getComputedStyle(e).transitionDuration }] })))
  report.touchControls = touchStyle
  for (const [selector, c] of Object.entries(touchStyle)) {
    assert(c && c.touchAction === 'none', `${selector}: touch-action stays none, so the browser never takes a finger over (${c?.touchAction})`, results)
    assert(c && !animatesTransform(c), `${selector}: no transform transition (it scales at once) (${c?.property} ${c?.duration})`, results)
  }
  // Reduced motion: nothing the player's buttons do is animated (the pressed shrink is a state, not a transition).
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const calm = await page.evaluate(() => ['#player-help', '#player-map', '#close-help', '#interact-action'].map((s) => { const c = getComputedStyle(document.querySelector(s)); return { s, property: c.transitionProperty, duration: c.transitionDuration } }))
  report.reducedMotion = calm
  for (const c of calm) assert(c.property === 'none' || c.duration.split(',').every((d) => parseFloat(d) === 0), `reduced motion: ${c.s} does not transition (${c.property} ${c.duration})`, results)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  assert(errors.length === 0, `no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
  await page.close()
}

/* ---- a phone ---- */
async function phone() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const page = await context.newPage()
  const errors = watch(page, `${engine} phone `)
  await openPlayer(page)
  await sleep(1500)
  return { context, page, errors }
}
const resting = (page, selector) => page.evaluate((s) => { const c = getComputedStyle(document.querySelector(s)); return { bg: c.backgroundColor, border: c.borderTopColor, color: c.color, transform: c.transform } }, selector)
{
  const { context, page, errors } = await phone()
  const hover = await page.evaluate(() => matchMedia('(hover: hover)').matches)
  report.phone = { hoverMedia: hover }
  assert(hover === false, `the emulated phone has no hover (matchMedia hover:hover is ${hover})`, results)

  // Tap Controls: the dialog opens; close it with the keyboard so nothing but the tap touched the button.
  const help = await resting(page, '#player-help')
  const box = await page.locator('#player-help').boundingBox()
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
  await sleep(500)
  const open = await page.evaluate(() => document.querySelector('#help-dialog').open)
  await page.evaluate(() => document.querySelector('#help-dialog').close())
  await sleep(450)
  const afterHelp = await resting(page, '#player-help')
  report.phone.help = { open, resting: help, after: afterHelp }
  assert(open, 'a tap on Controls opens the help', results)
  assert(afterHelp.bg === help.bg && afterHelp.border === help.border && afterHelp.color === help.color, `after the tap Controls is the colour it rests in, not its hover colours (${help.border} -> ${afterHelp.border})`, results)

  // The map's zoom buttons: tap, and they stay as they were.
  const mapBox = await page.locator('#player-map').boundingBox()
  await page.touchscreen.tap(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2)
  await page.waitForFunction(() => !document.querySelector('.atlas').hidden, null, { timeout: 5000 })
  await sleep(700)
  const zoom = page.locator('.atlas-zoom button').first()
  const zoomRest = await resting(page, '.atlas-zoom button')
  const zb = await zoom.boundingBox()
  await page.touchscreen.tap(zb.x + zb.width / 2, zb.y + zb.height / 2)
  await sleep(450)
  const zoomAfter = await resting(page, '.atlas-zoom button')
  report.phone.zoom = { resting: zoomRest, after: zoomAfter }
  assert(zoomAfter.bg === zoomRest.bg && zoomAfter.border === zoomRest.border && zoomAfter.color === zoomRest.color, `after a tap the map's zoom button is the colour it rests in (${zoomRest.bg} -> ${zoomAfter.bg})`, results)
  await page.keyboard.press('Escape')
  await sleep(400)

  // A finger held on a nav button: pressed on the frame of the touch, and let go of with the finger.
  if (engine === 'chromium') {
    const cdp = await context.newCDPSession(page)
    const send = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] })
    const target = await page.locator('#player-help').boundingBox(), x = target.x + target.width / 2, y = target.y + target.height / 2
    await page.evaluate(() => {
      const button = document.querySelector('#player-help'), seen = { frames: [] }
      window.__press = seen
      addEventListener('pointerdown', (e) => { seen.down = e.timeStamp; seen.pressedAtDown = button.hasAttribute('data-press') }, { capture: true })
      const loop = () => { const m = getComputedStyle(button).transform, scale = m === 'none' ? 1 : parseFloat(m.slice(7)); if (seen.down !== undefined) { seen.frames.push({ t: performance.now() - seen.down, scale, press: button.hasAttribute('data-press') }) } if (seen.frames.length < 200) requestAnimationFrame(loop) }
      requestAnimationFrame(loop)
    })
    await send('touchStart', x, y)
    await sleep(250)
    const held = await page.evaluate(() => { const b = document.querySelector('#player-help'); return { press: b.hasAttribute('data-press'), transform: getComputedStyle(b).transform } })
    await send('touchEnd')
    await sleep(300)
    const lifted = await page.evaluate(() => { const b = document.querySelector('#player-help'); return { press: b.hasAttribute('data-press'), transform: getComputedStyle(b).transform } })
    const frames = await page.evaluate(() => window.__press.frames)
    const firstChange = frames.find((f) => f.scale < 0.999), settled = frames.find((f) => f.scale <= 0.9705)
    report.phone.press = { held, lifted, firstChangeMs: firstChange ? +firstChange.t.toFixed(1) : null, settledMs: settled ? +settled.t.toFixed(1) : null }
    assert(held.press && held.transform !== 'none', `a finger held on Controls shrinks it (${held.transform})`, results)
    assert(firstChange && firstChange.t < 60 && settled && settled.t < 140, `and within a few frames of the touch: first change ${report.phone.press.firstChangeMs} ms, settled ${report.phone.press.settledMs} ms`, results)
    assert(!lifted.press && (lifted.transform === 'none' || lifted.transform === 'matrix(1, 0, 0, 1, 0, 0)'), `lifting the finger lets go (${lifted.transform})`, results)
    await page.evaluate(() => document.querySelector('#help-dialog').open && document.querySelector('#help-dialog').close())

    // A thumb that drifts while it holds a touch button: the pointer must stay with the button (no pointercancel), and end with a pointerup.
    report.phone.drift = {}
    for (const selector of ['#touch-jump', '#touch-vehicle', '#touch-recover']) {
      const b = await page.locator(selector).boundingBox()
      if (!b) { assert(false, `${selector} is on the phone's screen`, results); continue }
      const bx = b.x + b.width / 2, by = b.y + b.height / 2
      await page.evaluate((sel) => { const el = document.querySelector(sel); window.__e = []; for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) el.addEventListener(t, (e) => window.__e.push(e.type), true) }, selector)
      for (const dir of [1, -1]) {
        await page.evaluate(() => { window.__e = [] })
        await send('touchStart', bx, by)
        for (let i = 1; i <= 12; i++) { await send('touchMove', bx, by + dir * i * 8); await sleep(16) }
        await send('touchEnd')
        await sleep(200)
        const ev = await page.evaluate(() => window.__e), n = (t) => ev.filter((e) => e === t).length
        report.phone.drift[`${selector}${dir > 0 ? '-down' : '-up'}`] = { down: n('pointerdown'), moves: n('pointermove'), up: n('pointerup'), cancel: n('pointercancel') }
        assert(n('pointerdown') === 1 && n('pointermove') >= 8 && n('pointerup') === 1 && n('pointercancel') === 0, `a finger dragged 96 px ${dir > 0 ? 'down' : 'up'} from ${selector} keeps its pointer to the end (down ${n('pointerdown')}, moves ${n('pointermove')}, up ${n('pointerup')}, cancel ${n('pointercancel')})`, results)
      }
    }
  }
  assert(errors.length === 0, `phone: no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
  await context.close()
}

/* ---- a desktop: a mouse press ---- */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = watch(page, `${engine} desktop `)
  await openPlayer(page)
  await sleep(1500)
  const box = await page.locator('#player-awards').boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2
  const rest = await resting(page, '#player-awards')
  await page.mouse.move(x, y)
  await sleep(300)
  const hovered = await resting(page, '#player-awards')
  await page.mouse.down()
  await sleep(250)
  const pressed = await page.evaluate(() => { const b = document.querySelector('#player-awards'); return { press: b.hasAttribute('data-press'), transform: getComputedStyle(b).transform, bg: getComputedStyle(b).backgroundColor } })
  await page.mouse.up()
  await sleep(450)
  await page.evaluate(() => document.querySelector('#awards-dialog').open && document.querySelector('#awards-dialog').close())
  await page.mouse.move(5, 5)
  await sleep(300)
  const after = await resting(page, '#player-awards')
  report.desktop = { rest, hovered, pressed, after }
  assert(hovered.border !== rest.border, `a mouse over a button still lights it (${rest.border} -> ${hovered.border})`, results)
  assert(pressed.press && pressed.transform !== 'none' && pressed.bg !== hovered.bg, `a mouse press shrinks it and shades it (${pressed.transform}, ${pressed.bg})`, results)
  assert(after.bg === rest.bg && after.border === rest.border && after.transform === rest.transform, `and it is back to rest once the mouse is gone (${after.border})`, results)
  assert(errors.length === 0, `desktop: no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
  await page.close()
}

/* ---- the map's pins: placed by style.transform on every frame of a pan, so they must not trail the photo ---- */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = watch(page, `${engine} pins `)
  await openPlayer(page)
  await sleep(1500)
  await page.keyboard.press('m')
  await page.waitForFunction(() => !document.querySelector('.atlas').hidden, null, { timeout: 5000 })
  await sleep(1200)
  const stage = await page.locator('.atlas-stage').boundingBox(), cx = stage.x + stage.width / 2, cy = stage.y + stage.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.wheel(0, -900)
  await sleep(900)
  const transitions = await page.evaluate(() => [...document.querySelectorAll('.atlas-pin')].map((p) => { const c = getComputedStyle(p); return { property: c.transitionProperty, duration: c.transitionDuration } }))
  const animated = transitions.filter(animatesTransform)
  report.pins = { count: transitions.length, animated: animated.length, sample: transitions[0] }
  assert(transitions.length >= 5, `the map has its pins (${transitions.length})`, results)
  assert(animated.length === 0, `no pin transitions its transform (${animated.length} of ${transitions.length} do: ${animated[0]?.property} ${animated[0]?.duration})`, results)
  // Measured: one pin's box against the translate atlas.js gave it, every frame, through a drag of 40 steps (8 px, 3 px).
  const picked = await page.evaluate(() => {
    const stageRect = document.querySelector('.atlas-stage').getBoundingClientRect(), layer = document.querySelector('.atlas-pins')
    const pin = [...document.querySelectorAll('.atlas-pin:not([hidden])')].find((p) => { const r = p.getBoundingClientRect(); return r.width > 0 && /translate\(/.test(p.style.transform) && r.x > stageRect.x + 250 && r.x < stageRect.right - 250 && r.y > stageRect.y + 150 && r.y < stageRect.bottom - 150 })
    if (!pin) return false
    const samples = (window.__pin = { samples: [], base: null, run: true }).samples
    const frame = () => { const lr = layer.getBoundingClientRect(), r = pin.getBoundingClientRect(), m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(pin.style.transform); if (m) samples.push([r.x - lr.x - parseFloat(m[1]), r.y - lr.y - parseFloat(m[2])]); if (window.__pin.run) requestAnimationFrame(frame) }
    requestAnimationFrame(frame)
    return true
  })
  assert(picked, 'a pin is in view of the zoomed map', results)
  if (picked) {
    await sleep(200)
    await page.mouse.move(cx, cy); await page.mouse.down()
    for (let i = 0; i < 40; i++) { await page.mouse.move(cx - i * 8, cy - i * 3); await sleep(16) }
    await page.mouse.up(); await sleep(250)
    const samples = await page.evaluate(() => { window.__pin.run = false; return window.__pin.samples })
    const rest = samples.slice(0, 8), ox = rest.reduce((a, v) => a + v[0], 0) / rest.length, oy = rest.reduce((a, v) => a + v[1], 0) / rest.length
    const dev = samples.map((v) => Math.hypot(v[0] - ox, v[1] - oy)).sort((a, b) => a - b), max = dev.at(-1), median = dev[Math.floor(dev.length / 2)]
    report.pins.lag = { frames: samples.length, maxPx: +max.toFixed(2), medianPx: +median.toFixed(2) }
    assert(samples.length > 30 && max <= 1.5, `a pin stays on the photo through a pan: ${samples.length} frames, at most ${max.toFixed(1)} px off its translate (median ${median.toFixed(1)})`, results)
  }
  assert(errors.length === 0, `pins: no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
  await page.close()
}

fs.writeFileSync(path.join(dir, `feedback-${engine}-${label}.json`), JSON.stringify(report, null, 1))
await browser.close()
finish(results)
