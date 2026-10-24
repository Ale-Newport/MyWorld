/* The Projects board's way out (fix #6): focus bar, boardExit action, restore-exactly contract, phone framing.

   node scripts/qa/world-focus-exit.mjs [--suite=desktop,touch,short,portrait,vehicle,fullscreen,gamepad,repeat,reduced,hit,embedded] [--out=<dir>] [--baseline]

   Everything runs in a real Chromium on the real GPU against the QA server (QA_BASE, default http://localhost:3210) and
   reaches the board the way a player does: the car is put at the reading spot and E (or a tap on the interact button) opens it.

   short       short landscape windows that are not phones (1000x520, 900x560, 834x600, 1100x560, 1000x650): the page's pills step aside and nothing of the
               page (pills, counter chip, bar) sits on the title plate, the neighbour signs or the screen; taller or wider windows keep their pills.
   portrait    the SEED world (the one with the Ice Rink pines beside the board) on phone portrait 360, 390, 412, 430 and 540 px wide, a tablet, a
               landscape phone and a desktop: the screen is on screen in PIXELS (its face drawn flat magenta for one shot: >= 85% of its projected
               area must be magenta, so a pine in front of the lens cannot pass), the camera stands clear of everything within 2 m, and with the
               clear-the-view step cut out of Projects.js the same measurement fails (the control). The same on a phone whose CPU is throttled x16 and
               x24 while the board opens: the pose never depends on how fast the device is.
   vehicle     the player's car parked anywhere in front of the board (9 places, 2 headings; 390x844 and 1440x900): the screen is still on screen in pixels
               (>= 85%), and with the car left out of the camera's rays some places fail (the control).
   desktop     open with E; leave by the Back button, Escape and Backspace; each must end exactly as it began (board closed, camera
               and car back, input filters the SAME SET as before, prompt visible, bar hidden, canvas focused, car drivable).
               Prev/next by mouse, arrows and A/D. Tab reaches the bar, Enter and Space on its buttons never open the project's
               page (window.open is spied), Enter on the canvas still does. Rapid open/close sequences. Map travel while open.
   touch       390x844, 844x390 and 834x1112 with touch: tap the interact button, prev, next, Back; tap targets and the bar inside
               the viewport; the screen's width in pixels (>= 300 at 390x844, it was ~150); a phone turned while the board is open.
   fullscreen  the bar works in HTML fullscreen; an Escape within 250 ms of a fullscreenchange is dropped, a later one closes.
   gamepad     a navigator.getGamepads shim: cross opens, D-pad steps, circle exits; circle still boosts while driving.
   repeat      open/close cycles: warm-up cycles until the lazily built hardware has plateaued (geometries unchanged over 6 cycles), then 40 more:
               geometries and textures never grow, ticker/inputs listeners, tweens, window/document listeners and DOM nodes are unchanged.
   reduced     prefers-reduced-motion: the bar has no transition and everything still works.
   hit         the "drive into a neighbour sign to switch project" hit test: from the ground, HEAD's against the current one.
   embedded    /world (the parent page with the iframe): the same exit from inside the real embedding, in iframe fullscreen.

   Screenshots go to --out (default .qa/runs/impl/signs-exit/focus). Exit code 1 when any check fails. */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { launch, sleep, assert, finish, BASE } from './lib.mjs'
import { openSigns, boardRects } from './world-signs.mjs'

const args = new Map(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true] }))
const OUT = path.resolve(String(args.get('out') ?? '.qa/runs/impl/signs-exit/focus'))
fs.mkdirSync(OUT, { recursive: true })
const results = []
const ok = (condition, message) => assert(condition, message, results)
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) })
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/* ------------------------------------------------------------------ helpers -- */

/** Counters and spies installed before any page script runs. */
const INIT = () => {
  window.__opened = []
  const open = window.open
  window.open = (...a) => { window.__opened.push(a.slice(0, 3)); return null }
  window.__openOriginal = open
  // Net listeners per target: add minus remove, by (type, listener, capture).
  const live = new WeakMap()
  const key = (type, fn, options) => `${type}|${typeof options === 'object' ? !!options?.capture : !!options}`
  const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener
  EventTarget.prototype.addEventListener = function (type, fn, options) {
    if (fn) { let m = live.get(this); if (!m) live.set(this, m = new Map()); const k = key(type, fn, options); let s = m.get(k); if (!s) m.set(k, s = new Set()); s.add(fn) }
    return add.call(this, type, fn, options)
  }
  EventTarget.prototype.removeEventListener = function (type, fn, options) {
    live.get(this)?.get(key(type, fn, options))?.delete(fn)
    return remove.call(this, type, fn, options)
  }
  window.__listeners = (target) => { let n = 0; for (const s of live.get(target)?.values() ?? []) n += s.size; return n }
  // A pad that the page believes in, for the gamepad suite: buttons by index, all released.
  window.__pad = { id: 'QA pad', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) }
  navigator.getGamepads = () => [window.__pad]
}

async function open(browser, options = {}) {
  const session = await openSigns(browser, { ...options, prepare: async (context) => { await context.addInitScript(INIT); await options.prepare?.(context) } })
  return session
}

/** Puts the car at the reading spot (the Projects prompt shows) with the camera behind it. */
async function park(page, offset = [0.8, 0.5, 0.8], rotation = Math.PI * 1.25) {
  await page.evaluate(async ({ offset, rotation }) => {
    const a = window.__archipelago, i = a.gameplay.instances.find(i => i.parts.projects)
    const at = i.references.position('refInteractivePoint')
    a.driving.place({ position: i.physics.point(at.clone().add(new a.THREE.Vector3(...offset))), rotation })
    i.parts.projects.attract = -1e9
    document.getElementById('world').focus({ preventScroll: true })
    await new Promise(r => setTimeout(r, 1300))
  }, { offset, rotation })
  await page.waitForFunction(() => window.__archipelago.gameplay.instances.some(i => i.parts.projects && i.prompts.activeLabel === 'Projects'), null, { timeout: 8000 })
}

/** Everything the exit contract talks about, in one object. */
const read = (page) => page.evaluate(() => {
  const a = window.__archipelago, pr = a.gameplay.instances.find(i => i.parts.projects).parts.projects, d = a.driving
  const bar = document.getElementById('focus-bar'), shown = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden'
  const active = document.activeElement
  return {
    state: pr.state, index: pr.index, mode: d.view.mode, player: d.player.state, filters: [...d.inputs.filters].sort(),
    bar: !!bar, barHidden: bar ? bar.hidden : true, barOpen: !!bar?.classList.contains('is-open'), dataFocus: document.body.dataset.focus ?? null,
    interact: shown(document.getElementById('interact-action')), interactText: document.getElementById('interact-action').textContent,
    touchControls: shown(document.getElementById('touch-controls')), driveHud: shown(document.getElementById('drive-hud')),
    active: active?.id || active?.tagName?.toLowerCase(), count: document.getElementById('focus-count')?.textContent ?? null,
    canOpen: bar ? !bar.querySelector('.focus-open').hidden : null, opened: window.__opened.length,
    tracking: d.view.focusPoint.isTracking, car: d.vehicle.position.toArray(),
  }
})

const closed = (page, timeout = 4000) => page.waitForFunction(() => window.__archipelago.gameplay.instances.find(i => i.parts.projects).parts.projects.state === 'closed', null, { timeout })
const opened = (page, timeout = 4000) => page.waitForFunction(() => window.__archipelago.gameplay.instances.find(i => i.parts.projects).parts.projects.state === 'open', null, { timeout })

/** Holds W for a moment: did the car go anywhere? */
async function drives(page) {
  const before = (await read(page)).car
  await page.keyboard.down('KeyW'); await sleep(700); await page.keyboard.up('KeyW')
  const after = (await read(page)).car
  return Math.hypot(after[0] - before[0], after[2] - before[2])
}

/** Waits until the camera has stopped easing (it moves toward the board's pose at a rate of 3 per second): the framing is only measurable then. */
async function settle(page, { quiet = 350, timeout = 8000 } = {}) {
  const started = Date.now()
  let last = null, since = Date.now()
  while (Date.now() - started < timeout) {
    const now = await page.evaluate(() => { const c = window.__archipelago.camera; return [...c.position.toArray(), ...c.quaternion.toArray()] })
    if (last && now.every((v, i) => Math.abs(v - last[i]) < 0.004)) { if (Date.now() - since >= quiet) return true } else since = Date.now()
    last = now
    await sleep(60)
  }
  return false
}

/**
 * How much of the screen's face is on screen, in pixels. The face mesh is drawn flat magenta (nothing on it, no lighting, no tone mapping) for
 * one screenshot and the magenta inside its projected quadrilateral is counted against that quadrilateral's area: a pine, a roof or a post in
 * front of the lens takes its share off. Returns { share, area } and saves the unaltered frame beside the magenta one.
 */
async function faceShare(page, name) {
  await shot(page, `${name}.png`)
  const quad = await page.evaluate(() => {
    const a = window.__archipelago, T = a.THREE, face = a.gameplay.instances.find(i => i.parts.projects).references.node('refImages')
    a.camera.updateMatrixWorld(true); face.updateWorldMatrix(true, false)
    face.geometry.computeBoundingBox()
    const box = face.geometry.boundingBox, points = []
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const p = new T.Vector3(x, y, z).applyMatrix4(face.matrixWorld).project(a.camera)
      points.push([(p.x + 1) / 2 * innerWidth, (1 - p.y) / 2 * innerHeight])
    }
    // Convex hull (monotone chain) of the eight projected corners: the quad, whatever the thickness of the plane.
    points.sort((p, q) => p[0] - q[0] || p[1] - q[1])
    const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0])
    const half = (list) => { const h = []; for (const p of list) { while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 1e-9) h.pop(); h.push(p) } h.pop(); return h }
    const hull = [...half(points), ...half([...points].reverse())]
    window.__swap = { face, material: face.material, hidden: face.children.filter(c => c.visible) }
    face.material = new T.MeshBasicMaterial({ color: 0xff00ff, toneMapped: false, fog: false })
    for (const c of window.__swap.hidden) c.visible = false
    return { hull, dpr: devicePixelRatio }
  })
  await sleep(350)
  const file = path.join(OUT, `${name}-magenta.png`)
  await page.screenshot({ path: file })
  await page.evaluate(() => { const s = window.__swap; s.face.material.dispose(); s.face.material = s.material; for (const c of s.hidden) c.visible = true; window.__swap = null })
  // Count magenta inside the hull (point-in-polygon on the pixel grid of its bounding box) and compare with the hull's own area.
  const { hull, dpr } = quad
  const xs = hull.map(p => p[0] * dpr), ys = hull.map(p => p[1] * dpr)
  const meta = await sharp(file).metadata()
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys)))
  const x1 = Math.min(meta.width, Math.ceil(Math.max(...xs))), y1 = Math.min(meta.height, Math.ceil(Math.max(...ys)))
  let area = 0
  for (let i = 0; i < hull.length; i++) { const p = hull[i], q = hull[(i + 1) % hull.length]; area += p[0] * q[1] - q[0] * p[1] }
  area = Math.abs(area) / 2 * dpr * dpr
  if (x1 - x0 < 2 || y1 - y0 < 2) return { share: 0, area, file }
  const { data, info } = await sharp(file).extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const inside = (x, y) => { let c = false; for (let i = 0, j = hull.length - 1; i < hull.length; j = i++) { const [xi, yi] = [hull[i][0] * dpr, hull[i][1] * dpr], [xj, yj] = [hull[j][0] * dpr, hull[j][1] * dpr]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c } return c }
  let magenta = 0
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const o = (y * info.width + x) * info.channels
    if (data[o] > 160 && data[o + 2] > 160 && data[o + 1] < 100 && inside(x0 + x + 0.5, y0 + y + 0.5)) magenta++
  }
  return { share: area > 0 ? magenta / area : 0, area, file }
}

/** Opens by E, checks the open-state invariants, runs `leave`, and checks the board is exactly as it was. */
async function cycle(page, label, leave, { link = false, touch = false } = {}) {
  await park(page)
  if (link) await page.evaluate(() => { const pr = window.__archipelago.gameplay.instances.find(i => i.parts.projects).parts.projects; pr.select(pr.items.findIndex(p => p.link), true); pr.attract = -1e9 })
  const before = await read(page)
  const t0 = Date.now()
  if (touch) { const box = await page.locator('#interact-action').boundingBox(); await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2) }
  else await page.keyboard.press('KeyE')
  await opened(page)
  await sleep(300)
  const o = await read(page)
  ok(o.state === 'open' && o.mode === 'cinematic' && o.player === 'locked' && same(o.filters, ['minigame']), `${label}: opens (state ${o.state}, camera ${o.mode}, car ${o.player}, filters ${o.filters})`)
  ok(o.bar && !o.barHidden && o.barOpen && o.dataFocus === 'projects', `${label}: the focus bar is up and body[data-focus] is set`)
  ok(!o.interact && !o.touchControls, `${label}: the interact button and the touch buttons are hidden while focused`)
  const spec = await page.evaluate(() => { const pr = window.__archipelago.gameplay.instances.find(i => i.parts.projects).parts.projects; return { index: pr.index, total: pr.items.length } })
  ok(o.count === `${spec.index + 1} / ${spec.total}`, `${label}: the bar counts the project (${o.count})`)
  await leave()
  const t1 = Date.now()
  await closed(page, 5000)
  const took = Date.now() - t1
  await sleep(250)
  const after = await read(page)
  ok(after.state === 'closed' && after.mode === 'default' && after.player === 'default', `${label}: closed, camera default, car default (${after.state}/${after.mode}/${after.player}, ${took} ms after the action)`)
  ok(same(after.filters, before.filters), `${label}: the input filters are the same set as before (${before.filters} -> ${after.filters})`)
  ok(after.interact || touch === false && after.interactText.includes('Projects') || after.interactText.includes('Projects'), `${label}: the prompt is back (${after.interactText})`)
  ok(after.barHidden && after.dataFocus === null, `${label}: the bar is hidden and body[data-focus] cleared`)
  ok(after.active === 'world', `${label}: the canvas has the keyboard (${after.active})`)
  ok(after.tracking === true, `${label}: the camera tracks the car again`)
  const moved = await drives(page)
  ok(moved > 0.4, `${label}: the car drives afterwards (${moved.toFixed(2)} m)`)
  return { before, o, after, took, t0 }
}

const pointerClickBar = (page, act) => page.locator(`#focus-bar [data-act=${act}]`).click()

/* ------------------------------------------------------------------ suites -- */

async function suiteDesktop(browser) {
  console.log('\n== desktop: keyboard and mouse ==')
  const { context, page, errors } = await open(browser, { width: 1440, height: 900 })
  const first = await cycle(page, 'Back button (click)', () => pointerClickBar(page, 'exit'))
  await shot(page, 'after-back-click.png')
  await cycle(page, 'Escape', () => page.keyboard.press('Escape'))
  await cycle(page, 'Backspace', () => page.keyboard.press('Backspace'))
  ok(first.o.filters.length === 1, 'filters while open are exactly [minigame]')

  // Backspace means nothing while driving.
  await park(page)
  await page.keyboard.press('Backspace'); await sleep(300)
  ok((await read(page)).state === 'closed', 'Backspace does nothing while the board is closed')

  // The first open takes the first look: screenshot with the bar.
  await park(page); await page.keyboard.press('KeyE'); await opened(page); await sleep(500)
  await shot(page, 'desktop-1440x900-focused.png')

  // Stepping: buttons, arrows, A/D.
  const idx = async () => (await read(page)).index
  const start = await idx()
  await pointerClickBar(page, 'next'); await sleep(250)
  ok(await idx() === start + 1, 'the Next button steps to the next project')
  await pointerClickBar(page, 'prev'); await sleep(250)
  ok(await idx() === start, 'the Previous button steps back')
  ok((await read(page)).active === 'world', 'after a pointer press the keyboard is back on the canvas')
  await page.keyboard.press('ArrowRight'); await sleep(250)
  ok(await idx() === start + 1, 'ArrowRight steps on')
  await page.keyboard.press('KeyA'); await sleep(250)
  ok(await idx() === start, 'A steps back')
  const count = (await read(page)).count
  ok(count === `${start + 1} / 42`, `the count follows (${count})`)

  // A project with a link: Visit button shown; clicking it opens the page through window.open exactly once.
  await page.evaluate(() => { const pr = window.__archipelago.gameplay.instances.find(i => i.parts.projects).parts.projects; pr.select(pr.items.findIndex(p => p.link)) })
  await sleep(400)
  ok((await read(page)).canOpen === true, 'a project with a link shows the Visit button')
  await shot(page, 'desktop-1440x900-link.png')
  await pointerClickBar(page, 'open'); await sleep(200)
  const spied = await page.evaluate(() => window.__opened)
  ok(spied.length === 1 && /^https?:/.test(spied[0][0]) && spied[0][1] === '_blank' && /noopener/.test(spied[0][2]), `Visit opens the link once with noopener (${JSON.stringify(spied)})`)
  await page.evaluate(() => { window.__opened.length = 0 })
  await page.evaluate(() => { const pr = window.__archipelago.gameplay.instances.find(i => i.parts.projects).parts.projects; pr.select(pr.items.findIndex(p => !p.link)) })
  await sleep(400)
  ok((await read(page)).canOpen === false, 'a project without a link hides the Visit button')

  // Keyboard: Tab goes to the bar; Enter/Space on a bar button is that button's and never the game's "interact".
  await page.evaluate(() => { const pr = window.__archipelago.gameplay.instances.find(i => i.parts.projects).parts.projects; pr.select(pr.items.findIndex(p => p.link), true) })
  await sleep(300)
  await page.evaluate(() => document.getElementById('world').focus())
  await page.keyboard.press('Tab')
  ok((await read(page)).active === 'focus-bar' || await page.evaluate(() => document.activeElement?.dataset?.act) === 'exit', 'Tab from the world lands on the Back button')
  ok(!(await page.evaluate(() => !document.querySelector('.atlas').hidden)), 'Tab did not open the map while the bar is up')
  await page.keyboard.press('Tab')
  ok(await page.evaluate(() => document.activeElement?.dataset?.act) === 'prev', 'Tab walks on to Previous')
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab')
  await page.evaluate(() => document.getElementById('world').focus())
  await page.keyboard.press('Shift+Tab')
  ok(await page.evaluate(() => document.activeElement?.dataset?.act) === 'open', 'Shift+Tab from the world lands on the last button (Visit)')
  await page.evaluate(() => { window.__opened.length = 0 })
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab')
  ok(await page.evaluate(() => document.activeElement?.dataset?.act) === 'exit', 'Shift+Tab walks back to Back')
  await page.keyboard.press('Enter')
  await closed(page)
  ok(await page.evaluate(() => window.__opened.length) === 0, 'Enter on the focused Back button exits and does NOT open the project page (no window.open)')
  ok((await read(page)).active === 'world', 'keyboard exit hands the canvas the keyboard back')

  await park(page); await page.keyboard.press('KeyE'); await opened(page); await sleep(300)
  await page.evaluate(() => { const pr = window.__archipelago.gameplay.instances.find(i => i.parts.projects).parts.projects; pr.select(pr.items.findIndex(p => p.link), true) })
  await sleep(300)
  await page.locator('#focus-bar [data-act=next]').focus()
  const before = (await read(page)).index
  await page.keyboard.press('Enter'); await sleep(250)
  ok((await read(page)).index === before + 1 && await page.evaluate(() => window.__opened.length) === 0, 'Enter on the focused Next button steps and does not open the page')
  await page.keyboard.press('Space'); await sleep(250)
  ok((await read(page)).index === before + 2 && await page.evaluate(() => window.__opened.length) === 0, 'Space on the focused Next button presses it')
  ok((await read(page)).active === 'next' || await page.evaluate(() => document.activeElement?.dataset?.act) === 'next', 'a keyboard press keeps the focus on the button')
  await page.locator('#focus-bar [data-act=exit]').focus()
  await page.keyboard.press('Space'); await closed(page)
  ok(await page.evaluate(() => window.__opened.length) === 0 && (await read(page)).state === 'closed', 'Space on the focused Back button exits')

  // Enter on the canvas is still the game's interact: the page opens (what E and Enter did before).
  await park(page); await page.keyboard.press('KeyE'); await opened(page); await sleep(300)
  await page.evaluate(() => { const pr = window.__archipelago.gameplay.instances.find(i => i.parts.projects).parts.projects; pr.select(pr.items.findIndex(p => p.link), true); window.__opened.length = 0 })
  await sleep(300)
  await page.evaluate(() => document.getElementById('world').focus())
  await page.keyboard.press('Enter'); await sleep(200)
  ok(await page.evaluate(() => window.__opened.length) === 1, 'Enter on the canvas still opens the project page')
  await page.keyboard.press('Escape'); await closed(page)

  // Rapid sequences end consistent.
  await park(page)
  const sequences = [['E', 0, 'Escape', 0], ['E', 120, 'Escape', 0], ['E', 400, 'Escape', 60], ['E', 900, 'Backspace', 100], ['E', 2000, 'Escape', 150]]
  for (const [open1, gap1, leave, gap2] of sequences) {
    await park(page)
    await page.keyboard.press(`Key${open1}`); await sleep(gap1)
    await page.keyboard.press(leave); await sleep(gap2)
    await page.keyboard.press('KeyE'); await sleep(gap2)   // open again, often while it is still closing
    await page.keyboard.press('Escape')
    await sleep(2300)
    const s = await read(page)
    ok(s.state === 'closed' && s.mode === 'default' && s.player === 'default' && same(s.filters, ['camera', 'driving']) && s.barHidden && s.dataFocus === null && s.tracking, `rapid E/${gap1}/${leave}/${gap2}: consistent (${s.state}/${s.mode}/${s.player}/${s.filters})`)
  }
  // And the reverse: open while closing finishes open.
  await park(page)
  await page.keyboard.press('KeyE'); await opened(page); await sleep(200)
  await page.evaluate(() => { const pr = window.__archipelago.gameplay.instances.find(i => i.parts.projects).parts.projects; pr.close(); pr.open() })
  await sleep(2300)
  const reopened = await read(page)
  ok(reopened.state === 'open' && reopened.mode === 'cinematic' && same(reopened.filters, ['minigame']) && !reopened.barHidden, 'close() then open() in one frame leaves the board open and the bar up')
  await page.keyboard.press('Escape'); await closed(page); await sleep(300)
  ok(same((await read(page)).filters, ['camera', 'driving']), 'and one Escape later the original filters are back')

  // The window turns the other way while open (phone rotated): re-framed, bar still there.
  // Every measurement waits for the camera to stop easing: 400 ms after the board opened it was still arriving (578 px, then 579 once settled).
  await park(page); await page.keyboard.press('KeyE'); await opened(page)
  ok(await settle(page), 'the camera comes to rest after the board opens')
  const wide = (await boardRects(page)).face.w
  await page.setViewportSize({ width: 600, height: 900 }); await sleep(300)
  ok(await settle(page), 'and after the window narrows')
  const narrow = (await boardRects(page)).face
  ok(narrow.w > 0.7 * 600 && narrow.w < 600, `resized to a narrow window while open: the screen is re-framed to fill it (${Math.round(wide)} -> ${Math.round(narrow.w)} px of 600)`)
  await shot(page, 'desktop-resized-600x900-focused.png')
  await page.setViewportSize({ width: 1440, height: 900 }); await sleep(300)
  ok(await settle(page), 'and after it widens again')
  const again = (await boardRects(page)).face.w
  ok(Math.abs(again - wide) < 2, `and back to the wide window it frames as before (${Math.round(wide)} px, then ${Math.round(again)} px)`)
  await page.keyboard.press('Escape'); await closed(page)

  // Map travel while open: the board closes cleanly and the map closes with the travel.
  await park(page); await page.keyboard.press('KeyE'); await opened(page); await sleep(300)
  await page.keyboard.press('KeyM')
  await page.waitForFunction(() => !document.querySelector('.atlas').hidden)
  await sleep(500)
  await shot(page, 'desktop-map-over-board.png')
  const pin = await page.evaluate(() => { const pins = [...document.querySelectorAll('.atlas-pin')].filter(p => !/project/i.test(p.getAttribute('aria-label'))); return pins[0]?.getAttribute('aria-label') ?? null })
  await page.locator(`.atlas-pin[aria-label="${pin}"]`).first().click()
  await closed(page, 6000); await sleep(1200)
  const traveled = await read(page)
  ok(traveled.state === 'closed' && traveled.mode === 'default' && traveled.player === 'default' && same(traveled.filters, ['camera', 'driving']) && traveled.barHidden && traveled.dataFocus === null, `map travel while open (${pin}) closes the board cleanly (${traveled.state}/${traveled.mode}/${traveled.player}/${traveled.filters}, bar hidden ${traveled.barHidden})`)
  ok(await page.evaluate(() => document.querySelector('.atlas').hidden), 'and the map closed')

  ok(errors.length === 0, `no console errors or page errors (${errors.join('; ')})`)
  await context.close()
}

async function suiteRepeat(browser) {
  console.log('\n== repeat: open/close cycles, warm-up then 40 ==')
  const { context, page, errors } = await open(browser, { width: 1440, height: 900 })
  const sample = () => page.evaluate(() => {
    const a = window.__archipelago, d = a.driving
    const info = a.renderer.info.memory
    return {
      geometries: info.geometries, textures: info.textures, ticker: d.ticker.events.count(), inputs: d.inputs.events.count(),
      tweens: d.tweens.items.length + d.tweens.delayed.length, windowListeners: window.__listeners(window), documentListeners: window.__listeners(document),
      bodyListeners: window.__listeners(document.body), dom: document.getElementsByTagName('*').length, filters: [...d.inputs.filters].sort().join(),
      focusBars: document.querySelectorAll('#focus-bar').length, sheets: document.querySelectorAll('link[data-focus-ui]').length,
    }
  })
  await park(page)
  // One full cycle first: lazy things (the bar, its stylesheet, a first sound) are allowed to appear once.
  await page.keyboard.press('KeyE'); await opened(page); await sleep(300); await page.keyboard.press('Escape'); await closed(page); await sleep(500)
  // The board builds each project theme's hardware the first time that project shows (bounded, by design): show them all once, so what the
  // cycles below add is the cycles' own.
  const total = await page.evaluate(() => window.__archipelago.gameplay.instances.find(i => i.parts.projects).parts.projects.items.length)
  for (let k = 0; k < total; k++) { await page.evaluate((k) => { const pr = window.__archipelago.gameplay.instances.find(i => i.parts.projects).parts.projects; pr.select(k, true); pr.attract = -1e9 }, k); await sleep(450) }
  await sleep(1500)
  const leaves = [() => page.keyboard.press('Escape'), () => pointerClickBar(page, 'exit'), () => page.keyboard.press('Backspace')]
  let n = 0
  // The car stays at the reading spot between cycles: only the prompt has to be there again before E.
  const cycleOnce = async () => {
    await page.waitForFunction(() => window.__archipelago.gameplay.instances.some(i => i.parts.projects && i.prompts.activeLabel === 'Projects'), null, { timeout: 8000 })
    await page.keyboard.press('KeyE'); await opened(page); await sleep(250)
    if (n % 4 === 1) await page.keyboard.press('ArrowRight')
    await leaves[n % 3]()
    await closed(page, 5000); await sleep(150)
    n++
  }
  // Some of what a cycle builds is built lazily, the first few times (each hardware variant, a ring of ivy, a charm): the count of geometries
  // climbs for a while and then stops. Warm-up runs until it has not moved for 6 cycles in a row (at most 40), and only what happens after
  // that is held against the board.
  const history = []
  for (let k = 0; k < 40; k++) {
    await cycleOnce(); await sleep(200)
    history.push((await sample()).geometries)
    if (history.length >= 6 && history.slice(-6).every(g => g === history[history.length - 1])) break
  }
  const plateau = history.length >= 6 && history.slice(-6).every(g => g === history[history.length - 1])
  ok(plateau, `geometries reach a plateau within ${history.length} warm-up cycles (${history[0]} -> ${history[history.length - 1]}; ${[...new Set(history)].length} distinct counts)`)
  const base = await sample()
  for (let k = 0; k < 40; k++) await cycleOnce()
  await sleep(500)
  const end = await sample()
  ok(end.tweens <= base.tweens, `40 cycles after warm-up: no tween left running (${base.tweens} -> ${end.tweens})`)
  ok(end.geometries <= base.geometries, `40 cycles after warm-up: geometries do not grow (${base.geometries} -> ${end.geometries})`)
  ok(end.textures <= base.textures, `40 cycles after warm-up: textures do not grow (${base.textures} -> ${end.textures})`)
  for (const k of ['ticker', 'inputs', 'windowListeners', 'documentListeners', 'bodyListeners', 'focusBars', 'sheets', 'filters']) ok(base[k] === end[k], `40 cycles after warm-up: ${k} unchanged (${base[k]} -> ${end[k]})`)
  ok(end.dom - base.dom <= 2, `40 cycles after warm-up: DOM nodes unchanged (${base.dom} -> ${end.dom})`)
  ok(errors.length === 0, `no console errors (${errors.join('; ')})`)
  await context.close()
}

async function suiteTouch(browser) {
  console.log('\n== touch: phone portrait, phone landscape, tablet portrait ==')
  for (const vp of [{ width: 390, height: 844, name: 'phone-portrait' }, { width: 844, height: 390, name: 'phone-landscape' }, { width: 834, height: 1112, name: 'tablet-portrait' }]) {
    const label = `${vp.width}x${vp.height}`
    const { context, page, errors } = await open(browser, { width: vp.width, height: vp.height, mobile: true })
    ok(await page.evaluate(() => matchMedia('(pointer: coarse)').matches && document.body.dataset.input === 'touch'), `${label}: touch mode`)
    await park(page)
    ok((await read(page)).interact, `${label}: the interact button shows at the board`)
    await cycle(page, `${label} tap Back`, async () => {
      const box = await page.locator('#focus-exit').boundingBox()
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    }, { touch: true })
    // Open again to measure and step by tapping.
    await park(page)
    const box = await page.locator('#interact-action').boundingBox()
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await opened(page); await settle(page)
    const geometry = await page.evaluate(() => {
      const vw = innerWidth, vh = innerHeight, bar = document.getElementById('focus-bar').getBoundingClientRect()
      const buttons = [...document.querySelectorAll('#focus-bar button')].filter(b => !b.hidden).map(b => { const r = b.getBoundingClientRect(); return { act: b.dataset.act, w: Math.round(r.width), h: Math.round(r.height), inside: r.left >= 0 && r.right <= vw && r.top >= 0 && r.bottom <= vh } })
      return { vw, vh, bar: [bar.left, bar.top, bar.right, bar.bottom].map(Math.round), buttons, overflow: document.documentElement.scrollWidth > vw }
    })
    ok(geometry.buttons.every(b => b.w >= 44 && b.h >= 44), `${label}: every bar button is at least 44 px (${geometry.buttons.map(b => `${b.act} ${b.w}x${b.h}`).join(', ')})`)
    ok(geometry.buttons.find(b => b.act === 'exit').h >= 48, `${label}: Back is at least 48 px tall`)
    ok(geometry.buttons.every(b => b.inside) && !geometry.overflow, `${label}: the bar is inside the viewport with no page scroll (bar ${geometry.bar})`)
    const face = (await boardRects(page)).face
    if (vp.width === 390) ok(face.w >= 300, `${label}: the screen is ${Math.round(face.w)} px wide (was ~150 before; >= 300 required)`)
    else console.log(`   ${label}: the screen is ${Math.round(face.w)} px wide of ${vp.width}`)
    if (vp.height < 500) {
      // A phone on its side: the page's pills sat across the title plate and the counter chip across the neighbour sign.
      const hud = await page.evaluate(() => {
        const nav = document.getElementById('player-nav'), chip = document.getElementById('gameplay-hud')
        const r = chip && getComputedStyle(chip).display !== 'none' ? chip.getBoundingClientRect() : null
        return { nav: nav ? getComputedStyle(nav).visibility : 'none', chip: r && { x: r.left, y: r.top, w: r.width, h: r.height } }
      })
      const rects = await boardRects(page)
      const meets = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
      ok(hud.nav === 'hidden' || hud.nav === 'none', `${label}: the page's pills step aside while the board is focused (#player-nav is ${hud.nav})`)
      ok(!hud.chip || ![['title', rects.title], ['left sign', rects.prev], ['right sign', rects.next], ['screen', rects.face]].some(([, r]) => r && meets(hud.chip, r)), `${label}: the counter chip stays off the title plate, the neighbour signs and the screen (${hud.chip ? [hud.chip.x, hud.chip.y, hud.chip.w, hud.chip.h].map(Math.round) : 'not shown'})`)
    }
    await shot(page, `touch-${label}-focused.png`)
    await page.evaluate(() => { const pr = window.__archipelago.gameplay.instances.find(i => i.parts.projects).parts.projects; pr.select(pr.items.findIndex(p => p.link), true) })
    await sleep(1200)
    ok((await read(page)).canOpen === true, `${label}: a project with a link shows Visit on the bar`)
    await shot(page, `touch-${label}-focused-with-link.png`)
    await page.evaluate(() => { const pr = window.__archipelago.gameplay.instances.find(i => i.parts.projects).parts.projects; pr.select(0, true) })
    await sleep(600)
    const before = (await read(page)).index
    let b = await page.locator('#focus-bar [data-act=next]').boundingBox()
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); await sleep(300)
    ok((await read(page)).index === before + 1, `${label}: tapping Next steps`)
    b = await page.locator('#focus-bar [data-act=prev]').boundingBox()
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); await sleep(300)
    ok((await read(page)).index === before, `${label}: tapping Previous steps back`)
    // An already-open board is not left by a stray tap on the world (no gesture closes it by accident).
    await page.touchscreen.tap(vp.width / 2, vp.height * 0.45); await sleep(300)
    ok((await read(page)).state === 'open', `${label}: a tap on the world does not close the board`)
    b = await page.locator('#focus-exit').boundingBox()
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2)
    await closed(page); await sleep(300)
    const after = await read(page)
    ok(after.state === 'closed' && after.barHidden && after.interact, `${label}: Back by touch ends with the prompt and the touch controls back (${after.state}, interact ${after.interact})`)
    ok(await page.evaluate(() => getComputedStyle(document.getElementById('player-nav')).visibility === 'visible'), `${label}: the page's pills are back after Back`)
    if (vp.width === 390) {
      // Rotated while focused: portrait -> landscape.
      await park(page)
      b = await page.locator('#interact-action').boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2)
      await opened(page); await sleep(500)
      const portrait = (await boardRects(page)).face.w
      await page.setViewportSize({ width: 844, height: 390 }); await sleep(1400)
      const landscape = await page.evaluate(() => { const r = document.getElementById('focus-bar').getBoundingClientRect(); return { inside: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, h: Math.round(r.height) } })
      const wideFace = (await boardRects(page)).face
      ok(landscape.inside && wideFace.w > 200, `rotated to landscape while open: re-framed (screen ${Math.round(portrait)} -> ${Math.round(wideFace.w)} px) and the bar fits (${landscape.h} px tall)`)
      await shot(page, 'touch-390x844-rotated-to-landscape.png')
      await page.setViewportSize({ width: 390, height: 844 }); await sleep(800)
      await page.evaluate(() => window.__archipelago.gameplay.instances.find(i => i.parts.projects).parts.projects.close()); await closed(page)
    }
    ok(errors.length === 0, `${label}: no console errors (${errors.join('; ')})`)
    await context.close()
  }
}

/** A short landscape window that is not a phone (a small browser window, a tablet with its toolbars up): nothing of the page may sit on the board's title or its neighbour signs. */
async function suiteShort(browser) {
  console.log('\n== short: landscape windows up to 1100 x 660 (pointer: fine) ==')
  const meets = (a, b) => !!a && !!b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  // [width, height, the pills step aside]: the three short ones that overlapped, a window just over the limit and a tall one that never did.
  for (const [width, height, hidden] of [[1000, 520, true], [900, 560, true], [834, 600, true], [1100, 560, true], [1000, 650, true], [1280, 600, false], [1024, 700, false], [1280, 720, false]]) {
    const label = `${width}x${height}`
    const { context, page, errors } = await open(browser, { width, height, seed: true })
    await park(page)
    await page.keyboard.press('KeyE')
    await opened(page); await settle(page)
    const state = await page.evaluate(() => {
      const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return { x: r.left, y: r.top, w: r.width, h: r.height, shown: cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.01 } }
      const nav = document.getElementById('player-nav')
      return { nav: nav ? getComputedStyle(nav).visibility : 'none', pills: [...(nav?.querySelectorAll('a,button') ?? [])].map(rect), chip: rect(document.getElementById('gameplay-hud')), bar: rect(document.getElementById('focus-bar')) }
    })
    const rects = await boardRects(page)
    const covered = (r) => ['title', 'prev', 'next', 'face'].filter(k => meets(r, rects[k]))
    ok((state.nav === 'hidden') === hidden, `${label}: the page's pills ${hidden ? 'step aside' : 'stay'} while the board is focused (#player-nav is ${state.nav})`)
    const pills = state.pills.filter(p => p.shown && covered(p).length)
    ok(pills.length === 0, `${label}: no pill sits on the title plate, the neighbour signs or the screen (${pills.length ? pills.map(p => covered(p)).join('; ') : 'clear'})`)
    const chip = state.chip?.shown ? covered(state.chip) : []
    ok(chip.length === 0, `${label}: the counter chip stays off the title plate, the neighbour signs and the screen (${chip.join(', ') || 'clear'})`)
    ok(covered(state.bar).filter(k => k === 'face' || k === 'title').length === 0, `${label}: the bar covers neither the screen nor the title plate`)
    await shot(page, `short-${label}.png`)
    await page.evaluate(() => window.__archipelago.gameplay.instances.find(i => i.parts.projects).parts.projects.close()); await closed(page); await sleep(500)
    ok(await page.evaluate(() => getComputedStyle(document.getElementById('player-nav')).visibility === 'visible'), `${label}: the page's pills are back after Back`)
    ok(errors.length === 0, `${label}: no console errors (${errors.join('; ')})`)
    await context.close()
  }
}

/** Phone portrait on the SEED world, where the Ice Rink's pines stand on the line the focus camera takes from the board (it ended 3 m inside one). */
async function suitePortrait(browser) {
  console.log('\n== portrait: the screen is on screen, in pixels, on the seed world ==')
  const sizes = [[360, 640], [390, 844], [412, 915], [430, 932], [540, 960], [834, 1112], [844, 390], [1440, 900]]
  const openAt = async (page, touch) => {
    await park(page)
    if (touch) { const box = await page.locator('#interact-action').boundingBox(); await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2) }
    else await page.keyboard.press('KeyE')
    await opened(page)
    return settle(page)
  }
  // Nothing within 2 m of the lens, along the view axis and the picture's corners: a trunk beside the camera fills the frame as surely as one in front.
  const lens = (page) => page.evaluate(() => {
    const a = window.__archipelago, T = a.THREE, cam = a.camera, rc = new T.Raycaster(); rc.far = 2
    cam.updateMatrixWorld(true)
    const board = a.gameplay.instances.find(i => i.parts.projects).frame, car = a.driving.visual.group
    const hits = []
    for (const [x, y] of [[0, 0], [-.9, -.9], [.9, -.9], [-.9, .9], [.9, .9]]) {
      rc.setFromCamera(new T.Vector2(x, y), cam)
      const found = rc.intersectObjects(a.scene.children, true).find(h => { if (!h.object.visible || !h.object.isMesh || h.object.userData.terrain || h.object.userData.waterSurface) return false; for (let n = h.object; n; n = n.parent) if (n === board || n === car || !n.visible) return false; return true })
      if (found) hits.push(`${found.object.name || found.object.parent?.name || found.object.type} at ${found.distance.toFixed(1)} m`)
    }
    return hits
  })
  for (const [width, height] of sizes) {
    const label = `${width}x${height}`
    const touch = width < 700 || height < 500
    const { context, page, errors } = await open(browser, { width, height, mobile: touch, seed: true })
    const rested = await openAt(page, touch)
    const { share, area, file } = await faceShare(page, `portrait-${label}`)
    ok(rested, `${label}: the camera comes to rest`)
    ok(share >= 0.85, `${label}: the screen is on screen (${(share * 100).toFixed(0)}% of its projected area, ${Math.round(area)} device px, is drawn; >= 85% required)`)
    const near = await lens(page)
    ok(near.length === 0, `${label}: nothing within 2 m of the lens (${near.join(', ') || 'clear'})`)
    const poses = await page.evaluate(() => window.__archipelago.camera.position.toArray().map(v => +v.toFixed(1)))
    console.log(`   ${label}: camera at ${poses}, ${path.basename(file)}`)
    ok(errors.length === 0, `${label}: no console errors (${errors.join('; ')})`)
    await context.close()
  }
  // A phone under load: the pose must not depend on how fast the device is. The solver once gave up after 14 ms of wall clock and kept the pose
  // inside the pine (a screen of needle green) on a slow phone: one open in three at x12 to x24. The CPU is throttled from the keypress to the
  // moment the board is open (the step runs in that frame), then released for the measurement.
  for (const [width, height, rate] of [[390, 844, 24], [360, 640, 16]]) {
    const label = `${width}x${height} at CPU x${rate}`
    const { context, page, errors } = await open(browser, { width, height, mobile: true, seed: true })
    await park(page)
    const cdp = await context.newCDPSession(page)
    const box = await page.locator('#interact-action').boundingBox()
    await cdp.send('Emulation.setCPUThrottlingRate', { rate })
    await sleep(500)
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await opened(page, 90000)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    const rested = await settle(page)
    const { share, area, file } = await faceShare(page, `portrait-throttled-${width}x${height}-x${rate}`)
    ok(rested, `${label}: the camera comes to rest`)
    ok(share >= 0.85, `${label}: the screen is on screen (${(share * 100).toFixed(0)}% of its projected area, ${Math.round(area)} device px; >= 85% required)`)
    const near = await lens(page)
    ok(near.length === 0, `${label}: nothing within 2 m of the lens (${near.join(', ') || 'clear'})`)
    const pose = await page.evaluate(() => window.__archipelago.camera.position.toArray().map(v => +v.toFixed(1)))
    console.log(`   ${label}: camera at ${pose}, ${path.basename(file)}`)
    ok(errors.length === 0, `${label}: no console errors (${errors.join('; ')})`)
    await context.close()
  }
  // The control: the same measurement with the step that clears the view cut out of Projects.js must FAIL, or the check above proves nothing.
  const { context, page } = await open(browser, {
    width: 390, height: 844, mobile: true, seed: true,
    prepare: async (context) => { await context.route('**/interactions/Projects.js', async route => { const r = await route.fetch(); await route.fulfill({ response: r, body: (await r.text()).replaceAll('this.clearTheView();', '') }) } ) },
  })
  await openAt(page, true)
  const control = await faceShare(page, 'portrait-control-390x844-no-clear-step')
  ok(control.share < 0.3, `control: with the clear-the-view step removed the screen is NOT on screen (${(control.share * 100).toFixed(0)}% drawn)`)
  await context.close()
}

/** The player's own car parked in front of the board (anywhere in the prompt zone, either heading) can cover the screen from a low camera. */
async function suiteVehicle(browser) {
  console.log('\n== vehicle: the car parked in front of the board does not hide the screen ==')
  const spots = [[2, 0.5, 0.3], [-2, 0.5, 0.5], [0.3, 0.5, 2.2], [0.3, 0.5, -2], [-1.6, 0.5, -1.6], [-1.5, 0.5, 1.7], [1.1, 0.5, -1.1], [-1.1, 0.5, -0.4], [0, 0.5, -1.1]]
  const headings = [Math.PI * 1.25, Math.PI * 0.25]
  const patched = (width, height, mobile, strip) => open(browser, {
    width, height, mobile, seed: true,
    prepare: strip ? async (context) => { await context.route('**/interactions/Projects.js', async route => { const r = await route.fetch(); await route.fulfill({ response: r, body: (await r.text()).replaceAll('vehicle: this.vehicle ?? [],', '') }) }) } : undefined,
  })
  const measure = async (page, width, height, mobile, tag) => {
    const rows = []
    for (const heading of headings) for (const offset of spots) {
      const name = `${width}x${height} car ${offset[0]},${offset[2]} ${heading > 3 ? 'a' : 'b'}`
      await page.evaluate(async ({ offset, rotation }) => {
        const a = window.__archipelago, i = a.gameplay.instances.find(i => i.parts.projects)
        const at = i.references.position('refInteractivePoint')
        a.driving.place({ position: i.physics.point(at.clone().add(new a.THREE.Vector3(...offset))), rotation })
        i.parts.projects.attract = -1e9
        document.getElementById('world').focus({ preventScroll: true })
        await new Promise(r => setTimeout(r, 1300))
        i.parts.projects.open()
      }, { offset, rotation: heading })
      await opened(page)
      await settle(page)
      const { share, file } = await faceShare(page, `vehicle-${tag}-${width}x${height}-${offset[0]}_${offset[2]}-${heading > 3 ? 'a' : 'b'}`)
      rows.push({ name, share, file })
      await page.evaluate(() => window.__archipelago.gameplay.instances.find(i => i.parts.projects).parts.projects.close())
      await closed(page, 6000)
      await sleep(300)
    }
    return rows
  }
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const mobile = width < 700
    const { context, page, errors } = await patched(width, height, mobile, false)
    const rows = await measure(page, width, height, mobile, 'fixed')
    for (const r of rows) console.log(`   ${r.name}: ${(r.share * 100).toFixed(0)}% of the screen is drawn`)
    const worst = rows.reduce((m, r) => (r.share < m.share ? r : m), rows[0])
    ok(worst.share >= 0.85, `${width}x${height}: the screen is on screen with the car anywhere in the prompt zone (worst ${(worst.share * 100).toFixed(0)}%, ${worst.name}; >= 85% required, ${rows.length} places)`)
    ok(errors.length === 0, `${width}x${height}: no console errors (${errors.join('; ')})`)
    await context.close()
  }
  // The control: without the car among the things the camera avoids, some of the same places must fail, or the check proves nothing.
  const { context, page } = await patched(390, 844, true, true)
  const rows = await measure(page, 390, 844, true, 'control')
  const worst = rows.reduce((m, r) => (r.share < m.share ? r : m), rows[0])
  ok(worst.share < 0.85, `control: with the car left out of the camera's rays the screen is hidden in some places (worst ${(worst.share * 100).toFixed(0)}%, ${worst.name})`)
  await context.close()
}

async function suiteFullscreen(browser) {
  console.log('\n== fullscreen ==')
  const { context, page, errors } = await open(browser, { width: 1280, height: 800 })
  await page.evaluate(() => { const b = document.createElement('button'); b.id = 'qa-fullscreen'; b.style.cssText = 'position:fixed;left:0;top:0;width:60px;height:30px;z-index:99999'; b.onclick = () => document.documentElement.requestFullscreen(); document.body.append(b) })
  await page.mouse.click(30, 15)
  await sleep(800)
  const fs = await page.evaluate(() => !!document.fullscreenElement)
  if (!fs) { console.log('SKIP fullscreen: this Chromium would not enter fullscreen'); results.push({ ok: true, message: 'SKIPPED: fullscreen not available in this headless Chromium' }); await context.close(); return }
  ok(fs, 'the page is in HTML fullscreen')
  await page.evaluate(() => document.getElementById('qa-fullscreen').remove())
  await park(page); await page.keyboard.press('KeyE'); await opened(page); await sleep(600)
  const bar = await page.evaluate(() => { const r = document.getElementById('focus-bar').getBoundingClientRect(); return { hidden: document.getElementById('focus-bar').hidden, inside: r.top >= 0 && r.bottom <= innerHeight, h: Math.round(r.height), full: !!document.fullscreenElement } })
  ok(!bar.hidden && bar.inside && bar.full, `the bar is up inside fullscreen (${bar.h} px tall)`)
  await shot(page, 'fullscreen-1280x800-focused.png')
  // The browser has used Escape to leave fullscreen; some browsers also hand the page that key press. It must not also close the board.
  await page.evaluate(() => document.dispatchEvent(new Event('fullscreenchange')))
  await page.keyboard.press('Escape'); await sleep(500)
  ok((await read(page)).state === 'open', 'an Escape within 250 ms of a fullscreenchange does not close the board')
  await sleep(300)
  await page.keyboard.press('Escape'); await closed(page)
  ok((await read(page)).state === 'closed', 'a later Escape closes it')
  // And the Back button, still in fullscreen.
  await park(page); await page.keyboard.press('KeyE'); await opened(page); await sleep(400)
  await pointerClickBar(page, 'exit'); await closed(page)
  const after = await read(page)
  ok(after.state === 'closed' && after.barHidden && after.active === 'world', 'Back in fullscreen exits and the canvas has the keyboard')
  ok(await page.evaluate(() => !!document.fullscreenElement), 'and the page is still fullscreen: Back is the board\'s exit, not the browser\'s')
  await page.evaluate(() => document.exitFullscreen())
  ok(errors.length === 0, `no console errors (${errors.join('; ')})`)
  await context.close()
}

async function suiteGamepad(browser) {
  console.log('\n== gamepad shim ==')
  const { context, page, errors } = await open(browser, { width: 1440, height: 900 })
  const press = async (index, ms = 140) => { await page.evaluate((i) => { window.__pad.buttons[i] = { pressed: true, touched: true, value: 1 }; window.__pad.timestamp++ }, index); await sleep(ms); await page.evaluate((i) => { window.__pad.buttons[i] = { pressed: false, touched: false, value: 0 }; window.__pad.timestamp++ }, index); await sleep(120) }
  await park(page)
  // Circle is BOOST while driving: still is, and it is not an exit.
  await page.evaluate(() => { window.__pad.buttons[1] = { pressed: true, touched: true, value: 1 } }); await sleep(200)
  const boost = await page.evaluate(() => window.__archipelago.driving.inputs.isActive('boost'))
  await page.evaluate(() => { window.__pad.buttons[1] = { pressed: false, touched: false, value: 0 } }); await sleep(150)
  ok(boost === true && (await read(page)).state === 'closed', 'circle still boosts while driving and does not touch the board')
  await park(page)
  await press(0)   // cross = interact
  await opened(page); await sleep(400)
  ok((await read(page)).state === 'open', 'cross (interact) opens the board')
  const start = (await read(page)).index
  await press(15); await sleep(200)
  { const now = (await read(page)).index; ok(now === start + 1, `D-pad right steps on (${start} -> ${now})`) }
  await press(14); await sleep(200)
  { const now = (await read(page)).index; ok(now === start, `D-pad left steps back (-> ${now})`) }
  await press(1)   // circle = exit
  await closed(page)
  const after = await read(page)
  ok(after.state === 'closed' && after.mode === 'default' && same(after.filters, ['camera', 'driving']) && after.barHidden && after.tracking, `circle exits and restores everything (${after.state}/${after.mode}/${after.filters})`)
  ok(await drives(page) > 0.4, 'the car drives afterwards')
  ok(errors.length === 0, `no console errors (${errors.join('; ')})`)
  await context.close()
}

async function suiteReduced(browser) {
  console.log('\n== reduced motion ==')
  const { context, page, errors } = await open(browser, { width: 1440, height: 900, prepare: async (c) => { await c.addInitScript(() => { /* the context option below does the work */ }) } })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await park(page); await page.keyboard.press('KeyE'); await opened(page); await sleep(300)
  const style = await page.evaluate(() => { const bar = document.getElementById('focus-bar'), back = bar.querySelector('.focus-back'); return { bar: getComputedStyle(bar).transitionDuration, button: getComputedStyle(back).transitionDuration, transform: getComputedStyle(bar).transform } })
  ok(style.bar === '0s' && style.button === '0s', `no transition on the bar or its buttons (${style.bar}, ${style.button})`)
  await pointerClickBar(page, 'exit'); await closed(page)
  ok((await read(page)).barHidden, 'and it still exits')
  ok(errors.length === 0, `no console errors (${errors.join('; ')})`)
  await context.close()
}

/**
 * The neighbour signs hang on the board's posts. Real driving, from many sides, at each: how close does the car get, and does the
 * sign switch? The same board code runs three ways, differing only in the one line that decides a hit (served through a route, nothing
 * on disk changes): HEAD's test (3-D distance to the sign's origin <= 2.2), the first re-tune (2 across the ground to the origin, and a
 * height window) and the current one (distance to the sign's footprint). Each drive steers the car at the sign's footprint from a
 * different side, throttle held, for four seconds.
 */
const HIT_RULES = {
  HEAD: 'if (player.distanceTo(sign.position) > 2.2)',
  ring: 'if (!(Math.hypot(player.x - sign.position.x, player.z - sign.position.z) <= 2 && sign.position.y - player.y >= -0.5 && sign.position.y - player.y <= 3.6))',
  now: null,
}

async function suiteHit(browser) {
  console.log('\n== hit: driving into a neighbour sign, from the ground ==')
  const summary = {}
  for (const [name, rule] of Object.entries(HIT_RULES)) {
    const { context, page, errors } = await open(browser, {
      width: 1000, height: 700,
      prepare: async (c) => {
        if (!rule) return
        await c.route('**/portfolio/world2/interactions/Projects.js*', async (route) => {
          const response = await route.fetch()
          const text = await response.text()
          const patched = text.replace('if (!inSwitchZone(player, sign.box))', rule)
          if (patched === text) throw new Error('the hit test line was not found in Projects.js')
          await route.fulfill({ response, body: patched })
        })
      },
    })
    const rows = []
    for (const which of ['previous', 'next']) for (const deg of [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]) {
      const set = await page.evaluate(({ which, deg }) => {
        const a = window.__archipelago, T = a.THREE, i = a.gameplay.instances.find(i => i.parts.projects), pr = i.parts.projects
        pr.attract = -1e9
        const s = pr.signs.find(x => x.which === which)
        const box = new T.Box3().setFromObject(i.references.node(which === 'next' ? 'refNext' : 'refPrevious'))
        const lo = i.physics.local(box.min), hi = i.physics.local(box.max)
        const b = { minx: Math.min(lo.x, hi.x), maxx: Math.max(lo.x, hi.x), minz: Math.min(lo.z, hi.z), maxz: Math.max(lo.z, hi.z) }
        const cx = (b.minx + b.maxx) / 2, cz = (b.minz + b.maxz) / 2, ang = deg * Math.PI / 180
        const x = cx + Math.cos(ang) * 12, z = cz + Math.sin(ang) * 12
        const g = i.physics.groundAt(x, z, 30, 60)
        if (g === null) return false
        const A = i.physics.point(new T.Vector3(x, g + 0.6, z)), B = i.physics.point(new T.Vector3(cx, g + 0.6, cz))
        a.driving.place({ position: A, rotation: Math.atan2(-(B.z - A.z), B.x - A.x) })
        const trial = window.__trial = { which, deg, footprint: 1e9, origin: 1e9, distance3d: 1e9, hit: false }
        window.__loop = setInterval(() => {
          const lp = i.game.player.position
          trial.footprint = Math.min(trial.footprint, Math.hypot(Math.max(b.minx - lp.x, 0, lp.x - b.maxx), Math.max(b.minz - lp.z, 0, lp.z - b.maxz)))
          trial.origin = Math.min(trial.origin, Math.hypot(lp.x - s.position.x, lp.z - s.position.z)); trial.distance3d = Math.min(trial.distance3d, lp.distanceTo(s.position))
          if (s.hit) trial.hit = true
          // Steer at the footprint's centre: the bearing from the car's own heading.
          const f = i.physics.localVector(a.driving.vehicle.forward), dx = cx - lp.x, dz = cz - lp.z
          const error = Math.atan2(f.x * dz - f.z * dx, f.x * dx + f.z * dz)
          window.__steer = Math.abs(error) < 0.08 ? 0 : error > 0 ? 1 : -1
        }, 40)
        return true
      }, { which, deg })
      if (!set) continue
      await sleep(400)
      await page.keyboard.down('KeyW')
      let key = null
      for (let k = 0; k < 100; k++) {
        const steer = await page.evaluate(() => window.__steer)
        const want = steer > 0 ? 'KeyD' : steer < 0 ? 'KeyA' : null
        if (want !== key) { if (key) await page.keyboard.up(key); if (want) await page.keyboard.down(want); key = want }
        await sleep(40)
      }
      if (key) await page.keyboard.up(key)
      await page.keyboard.up('KeyW')
      rows.push(await page.evaluate(() => { clearInterval(window.__loop); return window.__trial }))
    }
    const hits = rows.filter(r => r.hit)
    const best = (which, k) => +Math.min(...rows.filter(r => r.which === which).map(r => r[k])).toFixed(2)
    summary[name] = { drives: rows.length, hits: hits.length, hitSigns: [...new Set(hits.map(r => r.which))], closestFootprint: { previous: best('previous', 'footprint'), next: best('next', 'footprint') }, closestOrigin: { previous: best('previous', 'origin'), next: best('next', 'origin') }, closest3d: Math.min(best('previous', 'distance3d'), best('next', 'distance3d')) }
    console.log(`  ${name.padEnd(5)}`, JSON.stringify(summary[name]))
    fs.writeFileSync(path.join(OUT, `hit-${name}.json`), JSON.stringify(rows, null, 1))
    ok(errors.length === 0, `hit (${name}): no console errors (${errors.join('; ')})`)
    await context.close()
  }
  ok(summary.HEAD.hits === 0, `HEAD's rule: ${summary.HEAD.drives} steered drives at the signs from the ground, ${summary.HEAD.hits} switched a project (closest 3-D distance ${summary.HEAD.closest3d} > 2.2)`)
  ok(summary.ring.hits * 4 < summary.now.hits && !summary.ring.hitSigns.includes('next'), `the first re-tune (2 across the origin) switched ${summary.ring.hits} of ${summary.ring.drives} drives, never the next sign; the footprint rule ${summary.now.hits}`)
  ok(summary.now.hitSigns.length === 2, `the footprint rule switches BOTH signs by driving into them (${summary.now.hits} of ${summary.now.drives} drives)`)
}

async function suiteEmbedded(browser) {
  console.log('\n== embedded in /world ==')
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.addInitScript(() => { if (window.top !== window) window.__opened = []; })
  const page = await context.newPage()
  const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded' })
  const frameHandle = await page.waitForSelector('iframe', { timeout: 60000 })
  const frame = await frameHandle.contentFrame()
  await frame.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 180000 })
  // The parent keeps the world's input shut while the leaves cover it; the runtime goes live when it says so (or after its own fallback).
  await frame.waitForFunction(() => window.__archipelago.host?.live === true, null, { timeout: 60000 })
  await sleep(1500)
  await frame.evaluate(async () => {
    const a = window.__archipelago, i = a.gameplay.instances.find(i => i.parts.projects)
    const at = i.references.position('refInteractivePoint')
    a.driving.place({ position: i.physics.point(at.clone().add(new a.THREE.Vector3(0.8, 0.5, 0.8))), rotation: Math.PI * 1.25 })
    document.getElementById('world').focus({ preventScroll: true })
    await new Promise(r => setTimeout(r, 1500))
  })
  await frame.evaluate(() => { window.__archipelago.gameplay.instances.find(i => i.parts.projects).parts.projects.attract = -1e9 })
  await frameHandle.focus().catch(() => {})
  await frame.evaluate(() => document.getElementById('world').focus())
  await page.keyboard.press('KeyE')
  await frame.waitForFunction(() => window.__archipelago.gameplay.instances.find(i => i.parts.projects).parts.projects.state === 'open', null, { timeout: 8000 }).catch(() => {})
  const s = await frame.evaluate(() => ({ state: window.__archipelago.gameplay.instances.find(i => i.parts.projects).parts.projects.state, bar: document.getElementById('focus-bar') ? !document.getElementById('focus-bar').hidden : false }))
  ok(s.state === 'open' && s.bar === true, `embedded: E opens the board and the bar is up (${JSON.stringify(s)})`)
  await sleep(500)
  await page.screenshot({ path: path.join(OUT, 'embedded-world-focused.png') })
  // Iframe fullscreen, from a click.
  await page.evaluate(() => { const b = document.createElement('button'); b.id = 'qa-fs'; b.style.cssText = 'position:fixed;left:0;top:0;width:60px;height:30px;z-index:2147483647'; b.onclick = () => document.querySelector('iframe').requestFullscreen(); document.body.append(b) })
  await page.mouse.click(30, 15); await sleep(900)
  const fullscreen = await page.evaluate(() => document.fullscreenElement?.tagName ?? null)
  if (fullscreen === 'IFRAME') {
    await page.screenshot({ path: path.join(OUT, 'embedded-world-fullscreen-focused.png') })
    await frame.locator('#focus-exit').click()
    await frame.waitForFunction(() => window.__archipelago.gameplay.instances.find(i => i.parts.projects).parts.projects.state === 'closed', null, { timeout: 5000 })
    ok(await page.evaluate(() => document.fullscreenElement?.tagName) === 'IFRAME', 'embedded + iframe fullscreen: Back closes the board and fullscreen stays')
    await page.evaluate(() => document.exitFullscreen())
  } else {
    console.log('SKIP iframe fullscreen: could not enter it'); results.push({ ok: true, message: 'SKIPPED: iframe fullscreen not available' })
    await frame.locator('#focus-exit').click()
  }
  const after = await frame.evaluate(() => { const a = window.__archipelago; return { state: a.gameplay.instances.find(i => i.parts.projects).parts.projects.state, filters: [...a.driving.inputs.filters].sort(), bar: document.getElementById('focus-bar')?.hidden } })
  ok(after.state === 'closed' && same(after.filters, ['camera', 'driving']) && after.bar === true, `embedded: closed and restored (${JSON.stringify(after)})`)
  ok(errors.length === 0, `embedded: no page errors (${errors.join('; ')})`)
  await context.close()
}

/* ------------------------------------------------------------------ run -- */

const suites = String(args.get('suite') ?? 'desktop,touch,short,portrait,vehicle,fullscreen,gamepad,repeat,reduced,hit,embedded').split(',')
const table = { desktop: suiteDesktop, touch: suiteTouch, short: suiteShort, portrait: suitePortrait, vehicle: suiteVehicle, fullscreen: suiteFullscreen, gamepad: suiteGamepad, repeat: suiteRepeat, reduced: suiteReduced, hit: suiteHit, embedded: suiteEmbedded }
const browser = await launch()
try {
  for (const name of suites) {
    if (!table[name]) { console.log(`unknown suite ${name}`); continue }
    try { await table[name](browser) } catch (error) { ok(false, `suite ${name} threw: ${String(error.stack ?? error).slice(0, 600)}`) }
  }
} finally {
  await browser.close()
  finish(results)
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1))
}
