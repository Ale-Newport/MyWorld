/* Where keyboard focus goes after the player's own buttons, in /world (public player, real GPU).

   The bug this guards: after a click on Map or Controls the button kept focus (Chrome, Firefox), so
   Enter — which is also the world's interact key — pressed it again: the map or the help opened
   behind an activity prompt every time the visitor tried to start it. The rules now:

   - a mouse (or finger) click on Map, Controls, Achievements, the interact button, and on the Close
     buttons of the map and the dialogs, leaves focus on the canvas, so Enter and Space reach the world;
   - the keyboard keeps its place: a dialog or the map opened with the keyboard hands focus back to the
     button that opened it, with its focus ring, and Enter on a focused button presses that button and
     is not also the car's interact key.

   Every "Enter at the prompt" is checked by what it did: the slalom starts its countdown, and the map,
   the help and the achievements stay shut.

     QA_BASE=http://localhost:3210 node scripts/qa/world-ui-focus.mjs [--browser chromium|webkit|firefox] */
import { launch, openPlayer, assert, sleep, finish, watch } from './lib.mjs'
import { webkit, firefox } from 'playwright'

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback }
const engine = arg('browser', 'chromium')
const results = []
const browser = engine === 'chromium' ? await launch() : await { webkit, firefox }[engine].launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = watch(page, `${engine} `)
await openPlayer(page)
await sleep(2000)

const press = async (key, ms = 90) => { await page.keyboard.down(key); await sleep(ms); await page.keyboard.up(key) }
const place = (x, z) => page.evaluate(([x, z]) => { const A = globalThis.__archipelago; A.driving.vehicle.moveTo({ x, y: A.editor.terrainHeightAt(x, z) + 1.3, z }, 0) }, [x, z])
const slalom = () => page.evaluate(() => globalThis.__archipelago.activities.list.find((a) => a.spec.type === 'slalom').state)
const shut = () => page.evaluate(() => ({ map: !document.querySelector('.atlas').hidden, help: document.querySelector('#help-dialog').open, awards: document.querySelector('#awards-dialog').open }))
const focused = () => page.evaluate(() => { const a = document.activeElement; return { id: a?.id || a?.className || a?.tagName, visible: !!a?.matches?.(':focus-visible') } })
/** A real mouse click at the middle of an element (detail 1, as a person's). */
const mouse = async (selector) => { const box = await page.locator(selector).first().boundingBox(); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2) }
/** The car at the slalom's start prompt, nothing open, no run. */
async function atPrompt() {
  await page.evaluate(() => { const A = globalThis.__archipelago; if (A.activities.busy) A.activities.exit() })
  await place(-47, 18); await sleep(250); await place(-47, -26.5)
  await page.waitForFunction(() => globalThis.__archipelago.activities.prompt && !document.querySelector('#interact-action').hidden, null, { timeout: 5000 })
}
/** Enter at the prompt: what happened. */
async function enterAtPrompt() {
  await press('Enter'); await sleep(350)
  const s = { slalom: await slalom(), ...(await shut()), focus: await focused() }
  await page.evaluate(() => { const A = globalThis.__archipelago; A.activities.exit?.() })
  await press('Escape'); await sleep(250)
  return s
}
const started = (s) => s.slalom === 'countdown' && !s.map && !s.help && !s.awards

/* ---- mouse: each button, then Enter at a prompt ---- */
for (const [name, open, close, isOpen] of [
  ['Map, closed with Escape', '#player-map', () => press('Escape'), (s) => s.map],
  ['Map, closed with its Close button', '#player-map', () => mouse('.atlas-close'), (s) => s.map],
  ['Controls, closed with Escape', '#player-help', () => press('Escape'), (s) => s.help],
  ['Controls, closed with its Close button', '#player-help', () => mouse('#close-help'), (s) => s.help],
  ['Achievements, closed with its Close button', '#player-awards', () => mouse('#close-awards'), (s) => s.awards],
]) {
  await atPrompt()
  await mouse(open); await sleep(450)
  assert(isOpen(await shut()), `${name}: a mouse click on ${open} opens it`, results)
  await close(); await sleep(400)
  const after = await shut(), where = await focused()
  assert(!after.map && !after.help && !after.awards, `${name}: closed`, results)
  assert(where.id === 'world', `${name}: focus is on the canvas, not on a button (${where.id})`, results)
  await atPrompt()
  const s = await enterAtPrompt()
  assert(started(s), `${name}: Enter at the prompt starts the activity and opens nothing (${JSON.stringify({ slalom: s.slalom, map: s.map, help: s.help, awards: s.awards })})`, results)
}

/* ---- the map and help with their keys, Space after a click ---- */
await atPrompt()
await mouse('#player-map'); await sleep(400); await press('Escape'); await sleep(300)
const hops0 = await page.evaluate(() => globalThis.__archipelago.driving.jump.hops ?? 0)
await press('Space', 120); await sleep(700)
const hops1 = await page.evaluate(() => globalThis.__archipelago.driving.jump.hops ?? 0)
const afterSpace = await shut()
assert(hops1 === hops0 + 1 && !afterSpace.map && !afterSpace.help, `Space after a click on Map jumps (hops ${hops0} -> ${hops1}) and opens nothing`, results)

await atPrompt()
await mouse('#interact-action'); await sleep(350)
const afterInteract = await focused(), afterClick = await slalom()
assert(afterInteract.id !== 'interact-action', `the interact button does not keep focus after a click (${afterInteract.id})`, results)
// The visible "Start the infield slalom · E" button is a button: a mouse click on it starts the run, as E does (it used to reach the World2 prompts and the races only).
assert(afterClick === 'countdown', `a mouse click on the interact button starts the slalom, as E does (${afterClick})`, results)
await page.evaluate(() => { const A = globalThis.__archipelago; A.activities.exit?.() })
await sleep(300)
// ... and a click on it where nothing is on offer does nothing and raises no error.
await place(-47, 18); await sleep(500)
await page.evaluate(() => { document.querySelector('#interact-action').click() }); await sleep(250)
assert((await slalom()) === 'idle', 'the interact button, clicked with no prompt on offer, starts nothing', results)

/* ---- the keyboard keeps its place ---- */
for (const [name, button, isOpen] of [['Map', '#player-map', (s) => s.map], ['Controls', '#player-help', (s) => s.help]]) {
  await atPrompt()
  // A button focused by script right after a key press is a keyboard focus in Chromium; WebKit and Firefox decide differently (and may need a second try).
  let ring
  for (let attempt = 0; attempt < 3; attempt++) { await press('Shift'); await page.focus(button); ring = await focused(); if (ring.visible || attempt === 2) break; await page.evaluate(() => document.activeElement?.blur()); await sleep(80) }
  assert(ring.id === button.slice(1) && (ring.visible || engine !== 'chromium'), `${name}: a button focused after a key is the focused element${engine === 'chromium' ? ' and shows its focus ring' : ` (focus-visible ${ring.visible} in ${engine}: not asserted)`} (${ring.id})`, results)
  await press('Enter'); await sleep(450)
  const opened = await shut(), slalomState = await slalom()
  assert(isOpen(opened) && slalomState === 'idle', `${name}: Enter on the focused button opens it and is not also the car's interact key (open ${isOpen(opened)}, slalom ${slalomState})`, results)
  await press('Escape'); await sleep(450)
  const back = await focused(), closed = await shut()
  assert(!closed.map && !closed.help && back.id === button.slice(1) && (back.visible || !ring.visible), `${name}: closed with the keyboard, focus is back on its button${ring.visible ? ' with the ring' : ''} (${JSON.stringify(back)})`, results)
  await press('Enter'); await sleep(450)
  assert(isOpen(await shut()), `${name}: Enter on it opens it again, as a button does`, results)
  await press('Escape'); await sleep(450)
  await page.evaluate(() => document.querySelector('#world').focus())
}

/* ---- M and Tab still toggle the map, and give focus back to the canvas ---- */
await page.evaluate(() => document.querySelector('#world').focus())
await press('KeyM'); await sleep(450)
const viaKey = await shut()
await press('KeyM'); await sleep(450)
const viaKeyBack = await focused()
assert(viaKey.map && viaKeyBack.id === 'world', `M opens the map and M closes it with focus on the canvas (${viaKeyBack.id})`, results)

assert(errors.length === 0, `no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
await browser.close()
finish(results)
