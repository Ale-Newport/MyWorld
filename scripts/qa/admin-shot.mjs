/* Screenshot of an admin page as the QA administrator: node scripts/qa/admin-shot.mjs /admin out.png [w h] */
import { BASE, launch, out, sleep } from './lib.mjs'
import { signIn } from './admin-session.mjs'
const [path = '/admin', name = 'admin.png', w = '1440', h = '900', wait = '1500'] = process.argv.slice(2)
const browser = await launch()
const { page } = await signIn(browser, { viewport: { width: +w, height: +h } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)) })
await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
await sleep(+wait)
await page.screenshot({ path: out(name), fullPage: false })
if (errors.length) console.log('errors:', errors)
await browser.close()
