/* /world on the devices the site has to work on: the world's own controls (HUD, touch controls, map button, prompts)
   must stand inside the screen, clear of one another, and big enough to tap on a touch screen — in portrait and on
   its side, with a phone's address bar up. Real GPU, real input.

     node scripts/qa/world-devices.mjs [--base URL] [--sizes 390x664,844x390,...] [--map] [--out .qa/world-devices]

   Per size: a screenshot of the world once ready (and with the map open under --map), the controls' bounds, and any
   two controls that overlap. */
import { launch, sleep } from './lib.mjs'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1] }
const BASE = opt('base', process.env.QA_BASE ?? 'http://127.0.0.1:3398')
const SIZES = opt('sizes', '375x553,390x664,430x739,360x560,320x454,667x315,844x390,932x430,744x1048,1133x690,1366x960,1280x720,1440x900,1920x1080,3440x1440').split(',').map((s) => s.split('x').map(Number))
const OUT = path.resolve(opt('out', '.qa/world-devices'))
const MAP = args.includes('--map')
fs.mkdirSync(OUT, { recursive: true })

const INSPECT = () => {
  const vw = document.documentElement.clientWidth, vh = innerHeight
  const found = []
  const grow = (el) => { let x = 0, y = 0; for (const pseudo of ['::before', '::after']) { const c = getComputedStyle(el, pseudo); if (c.position === 'absolute' && c.content !== 'none' && c.content !== 'normal') { x = Math.max(x, parseFloat(c.left) < 0 ? -parseFloat(c.left) : 0); y = Math.max(y, parseFloat(c.top) < 0 ? -parseFloat(c.top) : 0) } } return { x, y } }
  const consider = (doc, offset = [0, 0], tag = '') => {
    for (const el of doc.querySelectorAll('button, a[href], [role="button"], [role="slider"], input, select')) {
      if (el.closest('.sr-only, [aria-hidden="true"], [inert]')) continue
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.1) continue
      let hidden = false
      for (let a = el.parentElement; a; a = a.parentElement) { const s = getComputedStyle(a); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) { hidden = true; break } }
      if (hidden) continue
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      found.push({ grow: grow(el), label: `${tag}${el.tagName.toLowerCase()}${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 16) ? ` “${(el.getAttribute('aria-label') || el.textContent).trim().slice(0, 16)}”` : ''}`, l: r.left + offset[0], t: r.top + offset[1], r: r.right + offset[0], b: r.bottom + offset[1], el })
    }
  }
  consider(document)
  for (const frame of document.querySelectorAll('iframe')) {
    try { const fr = frame.getBoundingClientRect(); if (frame.contentDocument) consider(frame.contentDocument, [fr.left, fr.top], 'game ') } catch { /* another origin */ }
  }
  const problems = []
  for (const f of found) {
    if (f.l < -1 || f.t < -1 || f.r > vw + 1 || f.b > vh + 1) problems.push(`${f.label} outside the screen [${Math.round(f.l)},${Math.round(f.t)} → ${Math.round(f.r)},${Math.round(f.b)}] of ${vw}×${vh}`)
    if (matchMedia('(pointer: coarse)').matches && (f.r - f.l + 2 * f.grow.x < 30 || f.b - f.t + 2 * f.grow.y < 30) && getComputedStyle(f.el).display !== 'inline') problems.push(`${f.label} is ${Math.round(f.r - f.l + 2 * f.grow.x)}×${Math.round(f.b - f.t + 2 * f.grow.y)}: small to tap`)
  }
  for (let i = 0; i < found.length && problems.length < 12; i++) for (let j = i + 1; j < found.length; j++) {
    const a = found[i], b = found[j]
    if (a.el.contains(b.el) || b.el.contains(a.el)) continue
    const x = Math.min(a.r, b.r) - Math.max(a.l, b.l), y = Math.min(a.b, b.b) - Math.max(a.t, b.t)
    if (x > 4 && y > 4) problems.push(`${a.label} overlaps ${b.label} by ${Math.round(x)}×${Math.round(y)}`)
  }
  return { count: found.length, problems: problems.slice(0, 12) }
}

const browser = await launch()
let bad = 0
for (const [w, h] of SIZES) {
  const touch = w < 800 || h < 500
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
  await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded' })
  let ready = true
  try { await page.waitForSelector('[data-world-shell][data-ready]', { timeout: 120_000 }) } catch { ready = false }
  await sleep(3500)
  const base = path.join(OUT, `world-${w}x${h}`)
  await page.screenshot({ path: `${base}.png` })
  const r = await page.evaluate(INSPECT)
  let mapReport = null
  if (MAP && ready) {
    await page.keyboard.press('m').catch(() => {})
    await sleep(2500)
    await page.screenshot({ path: `${base}-map.png` })
    mapReport = await page.evaluate(INSPECT)
  }
  const problems = [...r.problems, ...(mapReport ? mapReport.problems.map((p) => `map: ${p}`) : [])]
  if (!ready || problems.length || errors.length) bad++
  console.log(`${!ready || problems.length || errors.length ? 'WARN' : 'ok  '} ${w}×${h} ${ready ? '' : '(never became ready) '}${r.count} controls${problems.length ? `\n     ${problems.join('\n     ')}` : ''}${errors.length ? `\n     page errors: ${[...new Set(errors)].join(' | ')}` : ''}`)
  await context.close()
}
await browser.close()
console.log(`${bad} size(s) with problems; screenshots in ${OUT}`)
if (bad) process.exitCode = 1
