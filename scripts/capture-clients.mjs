/**
 * Capture desktop + mobile screenshots of the PUBLIC client websites
 * built at Pansofia / Grupo Newport, and encode them as AVIF + WebP.
 *
 *   node scripts/capture-clients.mjs
 *
 * Only public marketing pages are visited. No repository, admin area
 * or authenticated surface is touched.
 */
import { chromium, devices } from 'playwright'
import sharp from 'sharp'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'

const OUT = path.resolve('public/assets/client-work')
const TMP = path.resolve('.cache/shots')

const SITES = [
  ['fuerteventura-2000', 'https://www.fuerteventura2000.com'],
  ['pansofia', 'https://pansofia.com'],
  ['cht-canarias', 'https://chtcanarias.com'],
  ['hotel-escuela-el-mirador', 'https://hotelescuelaelmirador.com'],
  ['newport-media-films', 'https://newportmediafilms.com'],
  ['escuela-de-hosteleria-canaria', 'https://escueladehosteleriacanaria.com'],
  ['esenfuer', 'https://esenfuer.com'],
  ['fpe-europea', 'https://fpeeuropea.com'],
  ['nformar', 'https://nformar.com'],
  ['aula-impulsa', 'https://aulaimpulsa.com'],
  ['talento-profesional', 'https://talentoprofesional.com'],
  ['eduprisma', 'https://eduprisma.es'],
  ['level-up-canarias', 'https://levelupcanarias.com'],
  ['avanza-fp', 'https://avanzafp.es'],
  ['innova-urbis', 'https://innovaurbis.com/es'],
]

/** Long-page desktop capture, cropped to a tall hero strip. */
const DESKTOP = { width: 1440, height: 2200 }
const MOBILE = { width: 390, height: 1400 }

async function settle(page) {
  // Give lazy images and web fonts a chance, then freeze animation.
  await page.waitForTimeout(1600)
  await page.evaluate(async () => {
    await new Promise((r) => {
      let y = 0
      const step = () => {
        y += 600
        window.scrollTo(0, y)
        if (y < 2600) requestAnimationFrame(step)
        else { window.scrollTo(0, 0); r(undefined) }
      }
      step()
    })
  })
  await page.addStyleTag({
    content: `*,*::before,*::after{animation-play-state:paused!important;transition:none!important}
              [class*="cookie" i],[id*="cookie" i],[class*="consent" i],[id*="consent" i],
              [class*="gdpr" i],[class*="rgpd" i]{display:none!important}`,
  })
  await page.waitForTimeout(500)
}

async function encode(raw, slug, kind, width) {
  const img = sharp(raw)
  const base = path.join(OUT, `${slug}-${kind}`)
  await img.clone().resize({ width }).webp({ quality: 74, effort: 5 }).toFile(`${base}.webp`)
  await img.clone().resize({ width }).avif({ quality: 52, effort: 5 }).toFile(`${base}.avif`)
  // A 24px blur placeholder, inlined as a data URI in the manifest.
  const tiny = await img.clone().resize({ width: 24 }).webp({ quality: 30 }).toBuffer()
  return `data:image/webp;base64,${tiny.toString('base64')}`
}

const results = []

const browser = await chromium.launch()
await mkdir(OUT, { recursive: true })
await mkdir(TMP, { recursive: true })

for (const [slug, url] of SITES) {
  const entry = { slug, url, desktop: null, mobile: null, blur: null, status: 'failed', error: null }
  try {
    const ctxD = await browser.newContext({
      viewport: DESKTOP,
      deviceScaleFactor: 1.5,
      locale: 'es-ES',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
    })
    const pageD = await ctxD.newPage()
    await pageD.goto(url, { waitUntil: 'networkidle', timeout: 45000 })
    await settle(pageD)
    const rawD = await pageD.screenshot({ type: 'png', clip: { x: 0, y: 0, width: DESKTOP.width, height: DESKTOP.height } })
    entry.blur = await encode(rawD, slug, 'desktop', 1200)
    entry.desktop = `/assets/client-work/${slug}-desktop.webp`
    await ctxD.close()

    const ctxM = await browser.newContext({ ...devices['iPhone 13'], locale: 'es-ES' })
    const pageM = await ctxM.newPage()
    await pageM.goto(url, { waitUntil: 'networkidle', timeout: 45000 })
    await settle(pageM)
    const rawM = await pageM.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 390, height: MOBILE.height } })
    await encode(rawM, slug, 'mobile', 390)
    entry.mobile = `/assets/client-work/${slug}-mobile.webp`
    await ctxM.close()

    entry.status = 'ok'
    console.log(`ok   ${slug}`)
  } catch (err) {
    entry.error = String(err).slice(0, 200)
    console.log(`FAIL ${slug} — ${entry.error}`)
  }
  results.push(entry)
}

await browser.close()
await rm(TMP, { recursive: true, force: true })

await writeFile(
  path.join(OUT, 'manifest.json'),
  JSON.stringify({ capturedWith: 'playwright/chromium', sites: results }, null, 2),
)

const ok = results.filter((r) => r.status === 'ok').length
console.log(`\n${ok}/${results.length} captured → public/assets/client-work`)
