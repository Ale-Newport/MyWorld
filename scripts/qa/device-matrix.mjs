/* The responsive check (responsive-shots.mjs) across the devices the site has to work on, in the viewports those
   devices really show: a phone's VISIBLE viewport, with the browser's address bar and toolbar up, is much shorter
   than its screen, and in it `vh` is a hundredth of the larger, toolbar-less height (the `ratio`).

     node scripts/qa/device-matrix.mjs [--base URL] [--engine chromium] [--group phones,tablets] [--path /,/projects]
                                       [--out .qa/devices] [--list]

   Writes one log per page, engine and group under --out, and prints every capture with a problem. */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1] }
const BASE = opt('base', process.env.QA_BASE ?? 'http://127.0.0.1:3398')
const ENGINES = opt('engine', 'chromium').split(',')
const PAGES = opt('path', '/,/projects').split(',')
const OUT = path.resolve(opt('out', '.qa/devices'))

// [name, width, visible height, ratio of the large viewport to the visible one]
export const GROUPS = {
  phones: [
    ['iPhone SE', 375, 553, 1.21], ['iPhone 13 mini', 375, 635, 1.28], ['iPhone 15', 390, 664, 1.27], ['iPhone 15 Pro', 393, 659, 1.29],
    ['iPhone 15 Pro Max', 430, 739, 1.26], ['Pixel 7', 412, 780, 1.17], ['Galaxy S', 360, 560, 1.2], ['small Android', 320, 454, 1.25], ['Galaxy Fold cover', 280, 560, 1.15],
  ],
  landscape: [
    ['iPhone SE landscape', 667, 315, 1.19], ['iPhone 15 landscape', 844, 390, 1], ['iPhone Pro Max landscape', 932, 430, 1], ['Pixel landscape', 915, 360, 1.05], ['small landscape', 568, 280, 1.1],
  ],
  tablets: [
    ['iPad mini', 744, 1048, 1.08], ['iPad', 820, 1100, 1.07], ['iPad Pro 11', 834, 1112, 1.07], ['iPad Pro 12.9', 1024, 1290, 1.06],
    ['iPad mini landscape', 1133, 690, 1.08], ['iPad landscape', 1180, 760, 1.08], ['iPad Pro 12.9 landscape', 1366, 960, 1.07],
  ],
  desktops: [
    ['laptop 1280x720', 1280, 720, 1], ['laptop 1366x768', 1366, 768, 1], ['MacBook 1440x900', 1440, 900, 1], ['laptop 1536x864', 1536, 864, 1],
    ['desktop 1920x1080', 1920, 1080, 1], ['QHD 2560x1440', 2560, 1440, 1], ['ultrawide 3440x1440', 3440, 1440, 1], ['super ultrawide 3840x1080', 3840, 1080, 1],
  ],
  zoomed: [
    ['1440 at 200%', 720, 450, 1], ['1440 at 300%', 480, 300, 1], ['1920 at 200%', 960, 540, 1], ['1280 at 150%', 853, 480, 1],
  ],
}

if (args.includes('--list')) { for (const [g, ds] of Object.entries(GROUPS)) console.log(g, ds.map((d) => d[0]).join(', ')); process.exit(0) }

const wanted = opt('group', Object.keys(GROUPS).join(',')).split(',')
fs.mkdirSync(OUT, { recursive: true })
let total = 0
for (const engine of ENGINES) {
  for (const page of PAGES) {
    for (const group of wanted) {
      // One run per ratio: the simulation of the large viewport is a setting of the whole run.
      const byRatio = new Map()
      for (const d of GROUPS[group]) byRatio.set(d[3], [...(byRatio.get(d[3]) ?? []), d])
      for (const [ratio, devices] of byRatio) {
        const sizes = devices.map((d) => `${d[1]}x${d[2]}`).join(',')
        const tag = `${engine}${page.replace(/\W+/g, '_') || '_'}-${group}-r${ratio}`
        const run = spawnSync(process.execPath, ['scripts/qa/responsive-shots.mjs', '--base', BASE, '--path', page, '--engine', engine, '--sizes', sizes, '--large-ratio', String(ratio), '--cut', '--overlap', '--out', path.join(OUT, tag)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
        fs.writeFileSync(path.join(OUT, `${tag}.log`), run.stdout + run.stderr)
        const bad = run.stdout.split('\n').filter((l) => l.startsWith('WARN') || l.startsWith('  page errors'))
        total += bad.length
        console.log(`[${engine} ${page} ${group} r${ratio}] ${devices.map((d) => d[0]).join(', ')}: ${bad.length ? `${bad.length} problem(s)` : 'ok'}`)
        for (const l of bad) console.log(`   ${l}`)
      }
    }
  }
}
console.log(`\n${total} problem line(s). Logs and screenshots in ${OUT}`)
process.exitCode = total ? 1 : 0
