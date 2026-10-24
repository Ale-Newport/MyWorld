/* How soon the homepage's controls answer a pointer: arriving on them (hover) and pressing them.

     QA_BASE=http://localhost:3295 node scripts/qa/home-press-feedback.mjs
       [--profile desktop|phone]   desktop: 1440x900 mouse (hover + press); phone: 390x844 touch (press only)
       [--assert]                  exit 1 when a control answers late (limits below)
       [--out file.json] [--shots dir]

   Against a PRODUCTION build (next build && next start); the numbers of the dev server say nothing.

   Nothing is guessed from screenshots: for each control a requestAnimationFrame sampler reads the computed style
   (colours, shadows, transform, opacity, padding, stroke...) of the control and everything inside it, and of the
   custom cursor's ring, from the frame the pointer event reaches the page until the look has settled, and
   reports, per control and per gesture:

     first   ms until any property has started to move
     t90     ms until every property that moves has covered 90 % of its way
     frames  the number of rAF frames between the event and the first change

   Limits (--assert): the first change within 34 ms (two frames; 50 ms for a touch, which the browser hands to the page a
   frame later) and the look at 90 % within 130 ms (the quickest
   --dur-quick transition plus the frame it lands in). The CSS transitions of the arrival are also read from the
   browser (document.getAnimations) and must each last at most 100 ms.

   The controls: the HUD's four (mark, PROJECTS link, SOUND, INDEX), a Toolbox tile, a Universe body (the orbit's
   node and its name), and in the index overlay an entry and the close button. */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const VIEWPORTS = {
  desktop: { width: 1440, height: 900, dpr: 1, touch: false },
  phone: { width: 390, height: 844, dpr: 3, touch: true },
}
const launch = () => chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const ctxOptions = (vp) => ({
  viewport: { width: vp.width, height: vp.height },
  deviceScaleFactor: vp.dpr,
  ...(vp.touch ? { isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36' } : {}),
})

const argv = process.argv.slice(2)
const flag = (k) => argv.includes(`--${k}`)
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const vp = VIEWPORTS[opt('profile', 'desktop')]
if (!vp) throw new Error(`unknown profile ${opt('profile', 'desktop')}`)
const touch = vp.touch
const BASE = (process.env.QA_BASE ?? 'http://localhost:3210').replace(/\/$/, '')
const PROFILE = opt('profile', 'desktop')
const ASSERT = flag('assert')
const OUT = opt('out', null)
const SHOTS = opt('shots', null)
const MAX_FIRST = touch ? 50 : 34
const MAX_T90 = 130
const MAX_TRANSITION = 100


/** Installed in the page: samples the look of `el` (and what is inside it) every frame from the first pointer event. */
function installSampler() {
  const PROPS = ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'boxShadow', 'transform', 'opacity', 'paddingLeft', 'textDecorationColor', 'stroke', 'fill']
  // Colours arrive in whichever space the engine interpolates in (oklab() while a transition runs, rgb() once it has
  // landed): they are all read through a canvas, as plain rgba, so a change of notation is not a jump.
  const cv = document.createElement('canvas')
  cv.width = cv.height = 1
  const g = cv.getContext('2d', { willReadFrequently: true })
  const cache = new Map()
  const rgba = (c) => {
    let v = cache.get(c)
    if (!v) {
      g.clearRect(0, 0, 1, 1)
      g.fillStyle = '#000'
      g.fillStyle = c
      g.fillRect(0, 0, 1, 1)
      const d = g.getImageData(0, 0, 1, 1).data
      v = [d[0], d[1], d[2], d[3]]
      cache.set(c, v)
    }
    return v
  }
  const COLOUR = /(?:rgba?|oklab|oklch|lab|lch|hsla?|color)\([^)]*\)/g
  const COLOUR_PROPS = new Set(['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'textDecorationColor', 'stroke', 'fill'])
  const nums = (s, p) => {
    if (s === 'none' || s === '' || s == null) return p === 'transform' ? [1, 0, 0, 1, 0, 0] : [0]
    s = String(s)
    if (COLOUR_PROPS.has(p)) return /\(/.test(s) ? rgba(s) : [0]
    if (p === 'boxShadow') {
      const colours = (s.match(COLOUR) ?? []).flatMap(rgba)
      const rest = (s.replace(COLOUR, '').match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? []).map(Number)
      return [...rest, ...colours]
    }
    const m = s.match(/-?\d*\.?\d+(?:e-?\d+)?/g)
    return m ? m.map(Number) : [0]
  }
  const dist = (a, b) => { let d = 0; for (let i = 0; i < Math.max(a.length, b.length); i++) d += ((a[i] ?? 0) - (b[i] ?? 0)) ** 2; return Math.sqrt(d) }
  window.__sampler = {
    arm(selector, ringSelector, skipSelf) {
      const el = typeof selector === 'string' ? document.querySelector(selector) : selector
      // A body that orbits moves by itself: only what is inside it answers the pointer.
      const nodes = [...(skipSelf ? [] : [el]), ...el.querySelectorAll('*')].slice(0, 30)
      const ring = ringSelector ? document.querySelector(ringSelector) : null
      if (ring) nodes.push(ring)
      // The ring's position trails the pointer by design; what is measured of it is its size and its look.
      const read = () => nodes.map((n) => {
        const cs = getComputedStyle(n)
        return PROPS.map((p) => {
          if (n === ring && p === 'transform') { const m = nums(cs.transform, 'transform'); return [m[0]] }
          return nums(cs[p], p)
        })
      })
      const start = read()
      const rec = { start, frames: [], t0: 0, nodes: nodes.length, ringIndex: ring ? nodes.length - 1 : -1 }
      let running = true
      const tick = (now) => {
        if (!running) return
        if (rec.t0) rec.frames.push([now - rec.t0, read()])
        requestAnimationFrame(tick)
      }
      // The clock starts when the event reaches the page.
      const first = (e) => { if (!rec.t0) rec.t0 = e.timeStamp || performance.now() }
      for (const t of ['pointermove', 'pointerdown', 'touchstart']) window.addEventListener(t, first, { capture: true, once: true })
      requestAnimationFrame(tick)
      window.__sampler.rec = rec
      window.__sampler.stop = () => { running = false }
    },
    result() {
      const rec = window.__sampler.rec
      const last = rec.frames[rec.frames.length - 1]?.[1]
      if (!last) return null
      const pairs = []
      for (let n = 0; n < rec.start.length; n++) {
        for (let p = 0; p < PROPS.length; p++) {
          const final = dist(last[n][p], rec.start[n][p])
          if (final < 1e-6) continue
          let first = null
          let t90 = null
          for (const [t, vals] of rec.frames) {
            const d = dist(vals[n][p], rec.start[n][p])
            if (first === null && d > final * 0.02) first = t
            if (t90 === null && d >= final * 0.9) { t90 = t; break }
          }
          pairs.push({ node: n === rec.ringIndex ? 'ring' : n, prop: PROPS[p], first, t90, final })
        }
      }
      const dts = []
      for (let i = 1; i < rec.frames.length; i++) dts.push(rec.frames[i][0] - rec.frames[i - 1][0])
      dts.sort((a, b) => a - b)
      return { pairs, frameCount: rec.frames.length, dt: dts.length ? dts[dts.length >> 1] : null }
    },
    /** The CSS transitions the arrival started, as the browser has them. */
    transitions(selector) {
      const el = document.querySelector(selector)
      const out = []
      for (const a of document.getAnimations()) {
        if (!(a instanceof CSSTransition)) continue
        const target = a.effect?.target
        if (!target || !(el === target || el.contains(target))) continue
        const t = a.effect.getTiming()
        out.push({ property: a.transitionProperty, ms: Math.round(Number(t.duration) + Number(t.delay)) })
      }
      return out
    },
  }
}

const results = []
const bad = []
function summarise(label, gesture, r, trans) {
  if (!r) { bad.push(`${label} ${gesture}: no frames sampled`); return { label, gesture, error: 'no frames' } }
  // The machine may be busy: a page that draws every 40 ms cannot answer in 34. The limits keep their frames.
  const slack = Math.max(0, (r.dt ?? 16.7) - 16.7)
  const maxFirst = MAX_FIRST + 2 * slack
  const maxT90 = MAX_T90 + 3 * slack
  const moving = r.pairs.filter((p) => p.first !== null)
  const first = moving.length ? Math.min(...moving.map((p) => p.first)) : null
  const t90 = moving.length ? Math.max(...moving.map((p) => p.t90 ?? Infinity)) : null
  const worst = moving.slice().sort((a, b) => (b.t90 ?? 0) - (a.t90 ?? 0))[0]
  const row = {
    label, gesture, first: first === null ? null : Math.round(first), t90: t90 === null ? null : Math.round(t90), frameMs: r.dt === null ? null : Math.round(r.dt * 10) / 10,
    worst: worst ? `${worst.node}:${worst.prop}` : null, moved: moving.length,
    transitions: (trans ?? []).sort((a, b) => b.ms - a.ms).slice(0, 4),
  }
  results.push(row)
  if (flag('verbose')) for (const p of moving) console.log(`      ${String(p.node).padEnd(5)} ${p.prop.padEnd(20)} first ${Math.round(p.first)} t90 ${Math.round(p.t90 ?? -1)}`)
  console.log(`${row.label.padEnd(26)} ${gesture.padEnd(6)} first ${String(row.first).padStart(4)} ms   t90 ${String(row.t90).padStart(4)} ms   moved ${String(row.moved).padStart(2)}   frame ${row.frameMs} ms   slowest ${row.worst}   transitions ${row.transitions.map((t) => `${t.property} ${t.ms}`).join(', ')}`)
  if (first === null) bad.push(`${label} ${gesture}: nothing changed`)
  else {
    if (first > maxFirst) bad.push(`${label} ${gesture}: first change after ${row.first} ms (> ${Math.round(maxFirst)})`)
    if (t90 > maxT90) bad.push(`${label} ${gesture}: look at 90 % after ${row.t90} ms (> ${Math.round(maxT90)}; slowest ${row.worst})`)
  }
  for (const t of row.transitions) if (gesture === 'hover' && t.ms > MAX_TRANSITION) bad.push(`${label} hover: transition ${t.property} lasts ${t.ms} ms (> ${MAX_TRANSITION})`)
  return row
}

const browser = await launch()
const ctx = await browser.newContext({ ...ctxOptions(vp), reducedMotion: 'no-preference' })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
await page.addInitScript(installSampler)
await page.goto(BASE + '/', { waitUntil: 'load' })
await page.waitForFunction(() => window.__room?.().milestones?.ready != null, null, { timeout: 90000 })
await sleep(1500)

const CURSOR_RING = '[class*="Cursor-module"][class*="ring"]'
const center = async (selector) => {
  const box = await page.locator(selector).first().boundingBox()
  if (!box) throw new Error(`no box for ${selector}`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
/** Marks the element a (Playwright) locator finds, so the page can find it with a plain selector. */
let tags = 0
async function tag(locator) {
  const id = `q${++tags}`
  await locator.first().evaluate((el, id) => el.setAttribute('data-qa-press', id), id)
  return `[data-qa-press="${id}"]`
}
const away = async () => { if (!touch) { await page.mouse.move(vp.width / 2, vp.height / 2); await sleep(700) } }
const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${PROFILE}-${name}.png`) }) } }

let touchSession = null
/** Controls that move by themselves (the selector is added when one is chosen below). */
const SELF = new Set()
/** One gesture on one control, measured. */
async function gesture(label, selector, kind) {
  await away()
  await page.evaluate(([s, r, k]) => window.__sampler.arm(s, r, k), [selector, touch ? null : CURSOR_RING, SELF.has(selector)])
  const at = await center(selector)
  if (kind === 'hover') await page.mouse.move(at.x, at.y)
  else if (kind === 'press-mouse') { await page.mouse.move(at.x, at.y); await sleep(700); await page.evaluate(([s, r, k]) => window.__sampler.arm(s, r, k), [selector, CURSOR_RING, SELF.has(selector)]); await page.mouse.down() }
  else if (kind === 'press-touch') {
    // The finger stays down for the sample: a CDP session that goes away takes its touch with it.
    touchSession ??= await ctx.newCDPSession(page)
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y }] })
  }
  await sleep(50)
  const mid = await page.evaluate((s) => window.__sampler.transitions(s), selector)
  await sleep(650)
  const r = await page.evaluate(() => { window.__sampler.stop(); return window.__sampler.result() })
  await shot(`${label.replace(/\W+/g, '-')}-${kind}`)
  // Let go (a press must not do what a click does here).
  if (kind === 'press-mouse') { await page.mouse.move(2, 2); await page.mouse.up(); await sleep(300) }
  if (kind === 'press-touch') {
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }).catch(() => {})
    await sleep(300)
  }
  return summarise(label, kind === 'hover' ? 'hover' : 'press', r, kind === 'hover' ? mid : [])
}

const HUD = {
  'HUD mark': page.locator('[data-hud] header a[href^="#chapter"]'),
  'HUD PROJECTS link': page.locator('[data-hud] header a[href="/projects"]'),
  'HUD SOUND': page.locator('[data-hud] header button', { hasText: 'SOUND' }),
  'HUD INDEX': page.locator('[data-hud] header button', { hasText: 'INDEX' }),
}
for (const [label, found] of Object.entries(HUD)) {
  if (!(await found.count())) { bad.push(`${label}: not found`); continue }
  const sel = await tag(found)
  if (!touch) await gesture(label, sel, 'hover')
  await gesture(label, sel, touch ? 'press-touch' : 'press-mouse')
}

// Chapter controls: scroll them into the pinned stage, let their animations mount.
async function scrollTo(chapter) {
  const y = await page.evaluate((id) => { const sec = document.querySelector(`#journey section[data-chapter="${id}"]`); return sec ? Math.round(sec.getBoundingClientRect().top + scrollY + sec.offsetHeight * 0.35) : null }, chapter)
  if (y === null) return false
  await page.evaluate((y) => window.scrollTo(0, y), y)
  await sleep(2500)
  return true
}
const CHAPTER = {
  'Toolbox tile': ['toolbox', 'section[data-chapter="toolbox"] button[class*="tile"]'],
  'Universe body': ['universe', 'section[data-chapter="universe"] button[class*="body"]'],
}
for (const [label, [chapter, sel]] of Object.entries(CHAPTER)) {
  if (!(await scrollTo(chapter))) { bad.push(`${label}: chapter not found`); continue }
  const n = await page.locator(sel).count()
  if (!n) { bad.push(`${label}: no control (${sel})`); continue }
  // A control that is on screen (the first may be off to the side of a phone's stage).
  const idx = await page.evaluate((s) => { const els = [...document.querySelectorAll(s)]; const i = els.findIndex((e) => { const r = e.getBoundingClientRect(); return r.width > 4 && r.top > 100 && r.bottom < innerHeight - 120 && r.left > 20 && r.right < innerWidth - 20 }); return i }, sel)
  if (idx < 0) { bad.push(`${label}: no control on screen`); continue }
  const one = await tag(page.locator(sel).nth(idx))
  if (chapter === 'universe') SELF.add(one)
  if (!touch) await gesture(label, one, 'hover')
  await gesture(label, one, touch ? 'press-touch' : 'press-mouse')
}

// The index overlay's entries.
await page.evaluate(() => window.scrollTo(0, 0))
await sleep(600)
await page.keyboard.press('i')
await page.waitForSelector('[role="dialog"] button[class*="item"], [class*="IndexOverlay"] button[class*="item"]', { timeout: 5000 }).catch(() => {})
await sleep(900)
const ITEM = '[class*="IndexOverlay"] button[class*="item"]:not([disabled])'
const CLOSE = '[class*="IndexOverlay"] button[class*="close"]'
for (const [label, sel] of [['Index entry', ITEM], ['Index close', CLOSE]]) {
  if (!(await page.locator(sel).count())) { bad.push(`${label}: not found`); continue }
  const one = await tag(page.locator(sel))
  if (!touch) await gesture(label, one, 'hover')
  // A press on these closes or navigates; the pointer is taken away before it is let go, which cancels the click.
  await gesture(label, one, touch ? 'press-touch' : 'press-mouse')
}
await browser.close()

if (errors.length) bad.push(`page errors: ${errors.join(' | ')}`)
const doc = { harness: 'home-press-feedback', base: BASE, profile: PROFILE, limits: { first: MAX_FIRST, t90: MAX_T90, transition: MAX_TRANSITION }, results, failures: bad }
if (OUT) { fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(doc, null, 2)) }
if (bad.length) { console.log('\n' + (ASSERT ? 'FAIL' : 'late') + '\n' + bad.join('\n')); if (ASSERT) process.exitCode = 1 } else console.log(`\nPASS: every control answers within ${MAX_FIRST} ms and settles within ${MAX_T90} ms`)
