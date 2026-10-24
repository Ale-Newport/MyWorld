import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { load, root } from '../setup.mjs'

const { heldKey } = await load('src/components/world/lock-keys.ts')
const read = (rel) => fs.readFileSync(`${root}/${rel}`, 'utf8')
const bare = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const key = (k, mods = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods })

test('the keys that act on a page by themselves are held while the page is not inert; the browser’s own shortcuts never are', () => {
  for (const k of ['Tab', 'Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']) assert.ok(heldKey(key(k)), k)
  // Shift+Tab and Shift+Space still have to be held.
  assert.ok(heldKey(key('Tab', { shiftKey: true })) && heldKey(key(' ', { shiftKey: true })))
  for (const [k, mods] of [['r', { ctrlKey: true }], ['r', { metaKey: true }], ['f', { ctrlKey: true }], ['ArrowLeft', { altKey: true }], ['Home', { metaKey: true }], ['Tab', { ctrlKey: true }], ['+', { metaKey: true }]]) {
    assert.ok(!heldKey(key(k, mods)), `${Object.keys(mods)[0]}+${k} is the browser's, not the page's`)
  }
  for (const k of ['F5', 'F12', 'Escape', 'a', 'i', 'Shift', 'Control']) assert.ok(!heldKey(key(k)), `${k} has no default action on the page`)
})

test('the first second of the way in is shut without a style recalculation of the page: a sheet under the cover, the keys held, the focus taken off', () => {
  const machine = read('src/components/world/transition.ts')
  // The sheet: one element, appended from the first frame of a way in from the homepage and of a direct arrival, and put away with the lock.
  assert.match(machine, /el\.setAttribute\('data-world-shield', ''\)[\s\S]*el\.setAttribute\('data-world-allow', ''\)/, 'the sheet is data-world-allow, so the inert pass leaves it alone')
  assert.match(machine, /if \(heavy\) raiseShield\(\)/, 'a way in from the homepage raises it with the lock (the frame that closes the door)')
  assert.match(machine, /lockPage\(true\)\s*\n\s*raiseShield\(\)/, 'and so does a direct arrival, whose cover is a React render away')
  assert.match(machine, /watcher = null\s*\n\s*dropShield\(\)/, 'unlocking puts it away')
  // The keys and the focus are held only while the page is not inert; afterwards `inert` does it and a Tab to the dialog must still work.
  assert.match(machine, /const pending = \(\) => locked && \(!inertAllowed \|\| inertFrame !== 0\)/)
  assert.match(machine, /if \(pending\(\) && heldKey\(e\)\) e\.preventDefault\(\)/)
  assert.match(machine, /window\.addEventListener\('focusin', keepFocusOut, true\)/)
  assert.match(machine, /window\.removeEventListener\('focusin', keepFocusOut, true\)/)
  assert.match(machine, /if \(held instanceof HTMLElement && held !== document\.body && !held\.closest\(ALLOW\)\) held\.blur\(\)/, 'what has the focus (the link just pressed, the text page a Tab opened before the script ran) loses it, on every way in')
  // What the sheet is not: a write to the page's own styles. Its box is on the element itself (a direct arrival can run before its stylesheet has).
  const raise = /function raiseShield\(\) \{[\s\S]*?\n\}/.exec(machine)?.[0] ?? ''
  assert.ok(raise && /el\.style\.cssText = SHIELD_STYLE/.test(raise) && !/document\.(body|documentElement)\.(style|classList)|setAttribute\('(style|class)'/.test(raise), 'the box is written on the sheet, not on the page')
  const style = /const SHIELD_STYLE = '([^']*)'/.exec(machine)?.[1] ?? ''
  assert.match(style, /position:fixed/)
  assert.match(style, /inset:0/)
  assert.match(style, /touch-action:none/)
  const z = Number(/z-index:(\d+)/.exec(style)?.[1])
  const cover = Number(/z-index: (\d+)/.exec(bare(read('src/components/home/room/canopy/canopy.module.css')))?.[1])
  assert.ok(z > 85 && z < cover, `under the cover (${z} < ${cover}) so the cover wins its own hit tests, over the index (80) and the project overlay (85)`)
})

test('the lock suite keeps hammering the first second of every way in', () => {
  const lock = read('scripts/qa/world-loading-lock.mjs')
  assert.match(lock, /if \(want\('early'\)\)/)
  assert.match(lock, /const ENTRY_EARLY = \{\s*\.\.\.ENTRY,/, 'the scroll push, the foot link and the index are the suite’s own entries')
  assert.match(lock, /async keys\(page\)[\s\S]*link\.focus\(\)[\s\S]*keyboard\.press\('Enter'\)/, 'and the foot link pressed with the keyboard, which leaves the focus on the link')
  assert.match(lock, /async direct\(page\)[\s\S]*\/world/, 'and a direct arrival')
  assert.match(lock, /for \(const how of \[\.\.\.ENTRIES,/, 'every one of them is run')
  assert.match(lock, /reached nothing but the cover and the loader/)
  assert.match(lock, /left the focus on the cover or the loader/)
  assert.match(lock, /was on no other route on the way/, 'a key that follows a link behind the leaves ends the visit on the wrong page')
})
