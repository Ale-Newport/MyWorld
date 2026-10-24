import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { load, root } from '../setup.mjs'

const { plainError, ERROR_COPY, NO_START } = await load('src/components/world/loading.ts')
const read = (rel) => fs.readFileSync(`${root}/${rel}`, 'utf8')

test('a failed download is told in plain words, not as the browser phrased it', () => {
  for (const raw of ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed', 'https://x.test/a.glb.gz: HTTP 503', 'The network connection was lost.', 'net::ERR_INTERNET_DISCONNECTED', 'signal timed out']) {
    assert.equal(plainError(raw), ERROR_COPY.network, raw)
  }
})

test('a runtime that never introduced itself, a lost graphics context and anything else each have words of their own', () => {
  assert.equal(plainError(NO_START), ERROR_COPY.start)
  assert.equal(plainError('The graphics context was lost and did not come back'), ERROR_COPY.graphics)
  assert.equal(plainError('WebGL2 unavailable'), ERROR_COPY.graphics)
  for (const raw of ['x.map is not a function', 'Invalid saved terrain grid: 500x500', '', undefined, null, 42, { message: 'Failed to fetch' }]) {
    assert.equal(plainError(raw), ERROR_COPY.start, String(raw))
  }
})

test('the visitor never reads the runtime’s own phrasing, a stack line or a file name', () => {
  for (const copy of Object.values(ERROR_COPY)) {
    assert.ok(!/fetch|TypeError|undefined|\.js|\.glb|HTTP|ERR_|webgl/i.test(copy), copy)
    assert.ok(copy.length < 100 && /[.]$/.test(copy), copy)
  }
})

test('the route says plain words and trusts a runtime that has not spoken for no longer than it needs to', () => {
  const route = read('src/components/world/WorldRoute.tsx')
  assert.match(route, /plainError\(message\)/, 'the dialog is given plainError(message)')
  assert.match(route, /setError\(plain\)/)
  const hello = Number(/const HELLO_MS = ([\d_]+)/.exec(route)?.[1].replaceAll('_', ''))
  assert.ok(hello > 0 && hello <= 4000, `a frame that loaded without saying hello fails within a few seconds (HELLO_MS ${hello}), not twelve`)
})

test('the frame carries `allow` alone: both it and `allowfullscreen` make the browser warn that `allow` wins', () => {
  const route = read('src/components/world/WorldRoute.tsx')
  assert.match(route, /iframe\.allow = '[^']*fullscreen[^']*'/)
  assert.ok(!/setAttribute\(\s*'allowfullscreen'/.test(route) && !/allowFullScreen|\.allowfullscreen\s*=/.test(route))
})

test('every way into the world from the homepage writes the same return position', () => {
  const link = read('src/components/world/WorldEntryLink.tsx')
  const portal = read('src/components/journey/WorldPortal.tsx')
  assert.match(link, /markReturn\(frame\.progress\)/, 'the link (the foot, the index) writes it')
  assert.match(portal, /markReturn\(frame\.progress\)/, 'the scroll push writes it')
  assert.ok(!/sessionStorage\.setItem\(RETURN_KEY/.test(portal), 'there is one writer: world/return.ts')
  assert.match(read('src/components/world/return.ts'), /sessionStorage\.setItem\(RETURN_KEY, String\(progress\)\)/)
})

test('the door is shut by declarations that cost the frame nothing: no touch-action on <html>, the inert pass after the cover is verified', () => {
  const css = read('src/styles/globals.css')
  const locked = css.slice(css.indexOf("html[data-world-phase='COVERING'],"), css.indexOf('html:has([data-world-shell])'))
  assert.ok(locked.length > 100)
  assert.ok(!/(^|\n)\s*touch-action\s*:/.test(locked.replace(/\/\*[\s\S]*?\*\//g, '')), 'a touch-action on <html> is a style recalculation of the whole page, in the frame that closes the door')
  assert.match(read('src/components/home/room/canopy/canopy.module.css'), /\.root\[data-blocking='true'\] \{[^}]*touch-action: none/, 'the cover takes the gestures instead')
  const machine = read('src/components/world/transition.ts')
  // The homepage's inert pass is a style recalculation of 1,400 elements: not in the frame that closes the door, the one that freezes the leaves, or the one that verifies them.
  assert.match(machine, /lockPage\(true, true\)\s*\n\s*guardHistory\(href, 'COVERING'\)/, 'a way in from the homepage locks it as a heavy page')
  assert.match(machine, /set\(\{ phase: 'COVERED' \}\)\s*\n[^\n]*\n\s*allowInert\(\)/, 'and makes it inert once the cover is verified')
  assert.match(machine, /else if \(!inertTimer\) inertTimer = window\.setTimeout\(allowInert, INERT_WAIT_MS\)/, 'or after a bounded wait, whichever is first')
  assert.match(machine, /function inertSoon\(frames = 2\)[\s\S]*requestAnimationFrame/, 'the pass runs in a frame of its own')
  assert.match(machine, /new MutationObserver\(\(\) => \{ if \(locked && inertAllowed\) inertSoon\(\) \}\)/, 'and what is added to <body> meanwhile does not bring it forward into the frame that closes the door')
  assert.ok(!/MutationObserver\([^)]*inertify\(\)/.test(machine))
})
