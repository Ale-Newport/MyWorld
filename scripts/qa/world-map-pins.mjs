/* /world M map pins: a visitor who aims at a place's dot reaches that place.
   For every pin on the stage, the element under the CENTRE of its dot (document.elementFromPoint, which is where a finger or a click that aims at the dot lands)
   must belong to that pin. It can only fail legitimately where another place's dot really lies over it, two places a few pixels apart; it must not fail because a
   label of another place is over it, or because another place's invisible touch margin (atlas.css, coarse pointers: 9 px around the pin) reaches it. Desktop and laptop
   use a mouse; tablet, phone and landscape phone are touch (coarse pointer, so the margins exist). The same world runs through the HEAD atlas (served from `git show HEAD:`
   by request interception) for comparison: it covers 1 to 22 dot centres per viewport, mostly by labels and margins.
     - every covered dot centre is explained by a dot that really is on top of it (another place's centre within 10.5 px);
     - never more covered than HEAD, at any viewport; the centre of every shown label belongs to its own pin too.
   Usage:  QA_OUT=.qa/runs/impl/map/pins node scripts/qa/world-map-pins.mjs      (ONLY=phone,land to limit) */
import { execFileSync } from 'node:child_process'
import { launch, openPlayer, out, sleep, assert, finish, watch } from './lib.mjs'

const results = []
const VP = {
  desk: { width: 1440, height: 900 }, lap: { width: 1280, height: 720 },
  tab: { width: 768, height: 1024, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
  phone: { width: 390, height: 844, hasTouch: true, isMobile: true, deviceScaleFactor: 3 },
  land: { width: 844, height: 390, hasTouch: true, isMobile: true, deviceScaleFactor: 3 },
}
const only = (process.env.ONLY ?? Object.keys(VP).join(',')).split(',')
const HEAD_FILES = ['atlas.js', 'atlas.css', 'world-bounds.js', 'portfolio-theme.css']
const browser = await launch()

async function measure(name, base) {
  const vp = VP[name], ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor ?? 1, hasTouch: !!vp.hasTouch, isMobile: !!vp.isMobile })
  const page = await ctx.newPage(), errors = watch(page, base ? 'HEAD' : 'NEW')
  if (base) for (const file of HEAD_FILES) {
    const body = execFileSync('git', ['show', `HEAD:public/archipelago/preview/${file}`], { maxBuffer: 1 << 26 })
    await page.route(`**/archipelago/preview/${file}`, (r) => r.fulfill({ body, contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript' }))
  }
  await openPlayer(page)
  await sleep(2500)
  await page.evaluate(() => document.querySelector('#world')?.focus())
  await page.keyboard.press('KeyM')
  await page.waitForFunction(() => { const a = globalThis.__archipelago.atlas; return !a.dialog.hidden && (a.photo?.state === undefined ? !!a.photo : a.photo.state === 'sharp') }, null, { timeout: 90_000 })
  await sleep(1200)
  const res = await page.evaluate(() => {
    const atlas = globalThis.__archipelago.atlas, R = (e) => e.getBoundingClientRect(), pins = [...document.querySelectorAll('.atlas-pin')].filter((p) => !p.hidden)
    const nm = (p) => p.querySelector('span').textContent, centre = (e) => { const r = R(e); return [r.left + r.width / 2, r.top + r.height / 2] }
    const covered = [], labelCovered = []
    for (const p of pins) {
      const [cx, cy] = centre(p.querySelector('i')), el = document.elementFromPoint(cx, cy), hit = el?.closest?.('.atlas-pin')
      // The nearest other dot: the only legitimate reason for this centre to be covered.
      let near = Infinity; for (const q of pins) if (q !== p) { const [qx, qy] = centre(q.querySelector('i')); near = Math.min(near, Math.hypot(qx - cx, qy - cy)) }
      if (hit !== p) covered.push({ pin: nm(p), by: hit ? nm(hit) : String(el?.className || el?.tagName), via: el?.tagName === 'SPAN' ? 'label' : el?.tagName === 'I' ? 'dot' : 'touch margin', nearest: +near.toFixed(1) })
      if (p.dataset.label === 'true') { const [lx, ly] = centre(p.querySelector('span')), top = document.elementFromPoint(lx, ly)?.closest?.('.atlas-pin'); if (top !== p) labelCovered.push({ pin: nm(p), by: top ? nm(top) : null }) }
    }
    return { pins: pins.length, labels: pins.filter((p) => p.dataset.label === 'true').length, covered, labelCovered, coarse: matchMedia('(pointer:coarse)').matches, stage: [atlas.sw, atlas.sh] }
  })
  await page.screenshot({ path: out(`pins-${base ? 'head' : 'new'}-${name}.png`) })
  res.errors = errors
  await ctx.close()
  return res
}

const rows = {}
for (const name of only) {
  const head = await measure(name, true), mine = await measure(name, false)
  rows[name] = { head, mine }
  const by = (r, v) => r.covered.filter((c) => c.via === v).length
  console.log(`${name.padEnd(5)} ${mine.coarse ? 'touch' : 'mouse'} stage ${mine.stage.join('x')}  pins HEAD ${head.pins} NEW ${mine.pins}   dot centres covered HEAD ${head.covered.length} (label ${by(head, 'label')}, dot ${by(head, 'dot')}, touch margin ${by(head, 'touch margin')})  NEW ${mine.covered.length} (label ${by(mine, 'label')}, dot ${by(mine, 'dot')}, touch margin ${by(mine, 'touch margin')})`)
  if (mine.covered.length) console.log(`      NEW covered: ${mine.covered.map((c) => `${c.pin} <- ${c.by} (${c.via}, ${c.nearest} px)`).join('; ')}`)
  const unexplained = mine.covered.filter((c) => c.nearest > 10.5)
  assert(unexplained.length === 0, `${name}: every covered dot centre has another dot on top of it (${unexplained.length} do not${unexplained.length ? ': ' + unexplained.slice(0, 3).map((c) => `${c.pin} <- ${c.by} (${c.via}, ${c.nearest} px)`).join('; ') : ''})`, results)
  assert(by(mine, 'label') === 0, `${name}: no dot centre lies under a label`, results)
  assert(mine.covered.length <= head.covered.length, `${name}: no more dot centres covered than HEAD (${mine.covered.length} vs ${head.covered.length})`, results)
  assert(mine.labelCovered.length === 0, `${name}: the centre of every shown label belongs to its own pin (${mine.labelCovered.length}${mine.labelCovered.length ? ': ' + JSON.stringify(mine.labelCovered.slice(0, 3)) : ''})`, results)
  assert(mine.errors.length === 0 && head.errors.length === 0, `${name}: no page errors`, results)
}
const sum = (k) => Object.values(rows).reduce((n, r) => n + r[k].covered.length, 0)
if (Object.keys(rows).length > 1) assert(sum('mine') < sum('head'), `in all, fewer dot centres are covered than at HEAD (${sum('mine')} vs ${sum('head')})`, results)
await browser.close()
finish(results)
