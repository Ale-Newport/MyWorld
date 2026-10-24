/* /world M map pin labels: every place that can have a label has one, and no label lies over another place's dot, over another label, or off the stage.
   Pins compete for a label in rank order (activities, then areas, then the rest, higher priority first; ties keep the order the world lists its places in;
   only the DOM, and so Tab, reads north to south). A label takes the first free side of its dot: right, left, above, below, then the corners. A side is free
   when the label would cover no other place's dot (the ones ranked after it too), the player's arrow or an earlier label; a place with no free side has no label
   and shows it on hover and focus. This runs the same world through the HEAD atlas (the files are served from `git show HEAD:` by request interception) and
   through the working tree at six viewports, and compares what a player sees:
     - the pins are ranked as before, Tab order is reading order, and the island is not smaller than HEAD's (the frame pad no longer shrinks portrait maps);
     - on the DOM geometry the player sees: no label over any other pin's dot, none over another label, none off the stage (HEAD had 4 to 19 labels over dots);
     - the placement model (atlas.js) and the stylesheet agree: each label sits where the model says it does, and its width is the width it was given;
     - at least as many labels as HEAD, and on every desktop and tablet-landscape viewport every label HEAD showed (Projects, Career, Behind the scenes ...), and
       on the phone the Castle label that the first pad cost it.
   Usage:  QA_OUT=.qa/runs/impl/map/labels node scripts/qa/world-map-labels.mjs      (VIEWPORTS="1440x900,390x844" to limit) */
import { execFileSync } from 'node:child_process'
import { launch, openPlayer, out, sleep, assert, finish, watch } from './lib.mjs'

const results = []
const VIEWPORTS = (process.env.VIEWPORTS ?? '1440x900,1280x720,1024x768,768x1024,390x844,844x390').split(',').map((v) => v.split('x').map(Number))
const HEAD_FILES = ['atlas.js', 'atlas.css', 'world-bounds.js', 'portfolio-theme.css']
const SIDES = ['right', 'left', 'above', 'below', 'above-right', 'above-left', 'below-right', 'below-left']
const browser = await launch()

/** One pass over every viewport: what the map shows, measured on the DOM the player sees. */
async function pass(base) {
  const page = await browser.newPage({ viewport: { width: VIEWPORTS[0][0], height: VIEWPORTS[0][1] } })
  const errors = watch(page, base ? 'HEAD' : 'NEW')
  if (base) {
    for (const name of HEAD_FILES) {
      const body = execFileSync('git', ['show', `HEAD:public/archipelago/preview/${name}`], { maxBuffer: 1 << 26 })
      await page.route(`**/archipelago/preview/${name}`, (r) => r.fulfill({ body, contentType: name.endsWith('.css') ? 'text/css' : 'text/javascript' }))
    }
  }
  await openPlayer(page)
  await sleep(2500)
  const rows = {}
  for (const [w, h] of VIEWPORTS) {
    await page.setViewportSize({ width: w, height: h })
    await sleep(300)
    await page.evaluate(() => document.querySelector('#world').focus())
    await page.keyboard.press('KeyM')
    // The HEAD atlas has no photo.state: it is ready as soon as there is a photograph.
    await page.waitForFunction(() => { const a = globalThis.__archipelago.atlas; return !a.dialog.hidden && (a.photo?.state === undefined ? !!a.photo : a.photo.state === 'sharp') }, null, { timeout: 90_000 })
    await sleep(900)
    rows[`${w}x${h}`] = await page.evaluate(() => {
      const atlas = globalThis.__archipelago.atlas, stage = atlas.stage.getBoundingClientRect()
      const pins = [...document.querySelectorAll('.atlas-pin')].filter((p) => !p.hidden), R = (e) => e.getBoundingClientRect()
      const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
      const labels = pins.filter((p) => p.dataset.label === 'true').map((p) => ({ p, r: R(p.querySelector('span')), n: p.querySelector('span').textContent }))
      // The dot as drawn: a diamond (activity) is rotated, and its bounding rectangle is what the browser reports.
      const dots = pins.map((p) => ({ p, r: R(p.querySelector('i')) }))
      const covered = []
      for (const l of labels) for (const d of dots) if (d.p !== l.p && inter(l.r, d.r) > 1) covered.push(`${l.n} <- dot of ${d.p.querySelector('span').textContent}`)
      let overlaps = 0
      for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) if (inter(labels[i].r, labels[j].r) > 1) overlaps++
      const outside = labels.filter((l) => l.r.left < stage.left - 1 || l.r.right > stage.right + 1 || l.r.top < stage.top - 1 || l.r.bottom > stage.bottom + 1).map((l) => l.n)
      // The oracle for the ranking is HEAD's own formula, on the places in the order the atlas holds them.
      const order = { activity: 0, experience: 1, place: 2 }
      const expected = [...atlas.markers.places].sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3) || (b.priority ?? 0) - (a.priority ?? 0)).map((m) => m.name)
      const ranked = atlas.ranked?.map((r) => r.m?.name ?? r.name)
      const reading = [...atlas.markers.places].sort((a, b) => a.z - b.z || a.x - b.x).map((m) => m.name)
      const dom = [...atlas.pins.querySelectorAll('.atlas-pin')].map((p) => p.querySelector('span').textContent)
      const metres = 100, scale = (atlas.toScreen(metres, 0)[0] - atlas.toScreen(0, 0)[0]) / metres
      // The placement model against the stylesheet (working tree only): each shown label is anchored where the model says, and is as wide as it was given.
      const model = []
      if (atlas.pinEls?.[0]?.side !== undefined) {
        const ox = stage.left + atlas.stage.clientLeft, oy = stage.top + atlas.stage.clientTop
        for (const rec of atlas.pinEls) {
          if (rec.pin.hidden || rec.side === null) continue
          const r = R(rec.pin.querySelector('span')), x = rec.x + ox, y = rec.y + oy, s = rec.side, cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2
          const err = {
            right: Math.abs(r.left - (x + 13)) + Math.abs(cy - y), left: Math.abs(r.right - (x - 13)) + Math.abs(cy - y),
            above: Math.abs(r.bottom - (y - 11)) + Math.abs(cx - x), below: Math.abs(r.top - (y + 11)) + Math.abs(cx - x),
            'above-right': Math.abs(r.bottom - (y - 11)) + Math.abs(r.left - (x - 4)), 'above-left': Math.abs(r.bottom - (y - 11)) + Math.abs(r.right - (x + 4)),
            'below-right': Math.abs(r.top - (y + 11)) + Math.abs(r.left - (x - 4)), 'below-left': Math.abs(r.top - (y + 11)) + Math.abs(r.right - (x + 4)),
          }[s]
          model.push({ n: rec.m.name, side: s, attr: rec.pin.dataset.side, err, widthErr: Math.abs(r.width - rec.lw) })
        }
      }
      const shownPlaces = atlas.pinEls.filter((r) => !r.pin.hidden && r.pin.dataset.label === 'true').map((r) => r.m.name)
      return { pins: pins.length, shown: labels.map((l) => l.n), shownPlaces, covered, overlaps, outside, scale, rankedOk: JSON.stringify(ranked) === JSON.stringify(expected), domOk: JSON.stringify(dom) === JSON.stringify(reading), model }
    })
    await page.screenshot({ path: out(`labels-${base ? 'head' : 'new'}-${w}x${h}.png`) })
    await page.keyboard.press('Escape')
    await sleep(250)
  }
  await page.close()
  return { rows, errors }
}

const head = await pass(true)
const mine = await pass(false)
await browser.close()

for (const vp of Object.keys(mine.rows)) {
  const h = head.rows[vp], n = mine.rows[vp], ratio = n.scale / h.scale, [w, ht] = vp.split('x').map(Number), landscape = w > ht && w >= 1024
  const lost = h.shown.filter((x) => !n.shown.includes(x))
  console.log(`${vp}  scale NEW/HEAD ${ratio.toFixed(3)} (${n.scale.toFixed(3)} vs ${h.scale.toFixed(3)} px/m)  labels HEAD ${h.shown.length}/${h.pins} NEW ${n.shown.length}/${n.pins}   over a dot HEAD ${h.covered.length} NEW ${n.covered.length}   label/label HEAD ${h.overlaps} NEW ${n.overlaps}`)
  console.log(`   HEAD shows: ${h.shown.join(' | ')}`)
  console.log(`   NEW  shows: ${n.shown.join(' | ')}`)
  console.log(`   HEAD labels NEW does not show: ${lost.join(', ') || '-'}   sides: ${SIDES.map((s) => `${s} ${n.model.filter((m) => m.side === s).length}`).join(', ')}`)
  if (n.covered.length) console.log(`   NEW covered: ${n.covered.join('; ')}`)
  assert(n.rankedOk, `${vp}: pins are ranked for labels exactly as HEAD ranks them (kind, then priority, ties in the world's own order)`, results)
  assert(n.domOk, `${vp}: Tab order is reading order (north to south, west to east)`, results)
  assert(ratio >= 0.97, `${vp}: the island is not smaller than HEAD's (NEW/HEAD ${ratio.toFixed(3)}, wanted >= 0.97: HEAD measured the stage 2 px too big, which is the rest)`, results)
  assert(n.covered.length === 0, `${vp}: no label lies over another place's dot (${n.covered.length}${n.covered.length ? ': ' + n.covered.slice(0, 3).join('; ') : ''}; HEAD ${h.covered.length})`, results)
  assert(n.overlaps === 0, `${vp}: no two labels overlap (${n.overlaps}; HEAD ${h.overlaps})`, results)
  assert(n.outside.length === 0, `${vp}: every label sits inside the stage${n.outside.length ? ' (' + n.outside.join(', ') + ')' : ''}`, results)
  assert(n.shown.length >= h.shown.length, `${vp}: at least as many labels as HEAD (${n.shown.length} vs ${h.shown.length})`, results)
  if (landscape) assert(lost.length === 0, `${vp}: every label HEAD shows is still shown${lost.length ? ' (lost ' + lost.join(', ') + ')' : ''}`, results)
  const bad = n.model.filter((m) => !SIDES.includes(m.side) || m.attr !== m.side || m.err > 2 || m.widthErr > 2.5)
  assert(n.model.length === n.shown.length && bad.length === 0, `${vp}: the stylesheet puts each label where the placement model says, at the width it was given (${bad.length} off${bad.length ? ': ' + bad.slice(0, 3).map((m) => `${m.n} ${m.side}/${m.attr} err ${m.err.toFixed(1)} w ${m.widthErr.toFixed(1)}`).join('; ') : ''})`, results)
}
const key = '1440x900'
if (mine.rows[key]) for (const name of ['Projects', 'Career', 'Behind the scenes']) assert(mine.rows[key].shown.includes(name), `${key}: "${name}" keeps its label`, results)
if (mine.rows['390x844']) assert(mine.rows['390x844'].shown.includes('Castle'), '390x844: "Castle" keeps its label (the phone lost it when the whole shelf was framed with the 4 % pad)', results)
assert(mine.errors.length === 0, `no page errors (${mine.errors.length})`, results)
finish(results)
