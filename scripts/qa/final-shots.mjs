/* Screenshots of the public pages and the admin at the sizes the work is checked
   at, into .qa/runs/final/. node scripts/qa/final-shots.mjs */
import { BASE, launch, sleep, out } from './lib.mjs'
import { signIn } from './admin-session.mjs'

const SIZES = [[390, 844], [768, 1024], [1440, 900], [2560, 1440], [3440, 1440]]
const PUBLIC = [['home', '/'], ['projects', '/projects'], ['project', '/projects/focus'], ['world', '/world']]
const ADMIN = [['admin-dashboard', '/admin'], ['admin-pages', '/admin/pages'], ['admin-projects', '/admin/projects'], ['admin-library', '/admin/library'], ['admin-world', '/admin/world'], ['admin-media', '/admin/media'], ['admin-audience', '/admin/analytics'], ['admin-settings', '/admin/settings']]
const browser = await launch()
const errors = []
for (const [w, h] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${w}x${h} ${String(e).slice(0, 160)}`))
  for (const [name, path] of PUBLIC) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
    if (path === '/world') await page.waitForSelector('[data-world-shell][data-ready]', { timeout: 240000 }).catch(() => {})
    else await page.waitForLoadState('networkidle').catch(() => {})
    await sleep(path === '/world' ? 2500 : 2200)
    await page.screenshot({ path: out(`final/${name}-${w}x${h}.png`) })
  }
  await ctx.close()
}
for (const [w, h] of [[1440, 900], [2560, 1440], [768, 1024]]) {
  const { context, page } = await signIn(browser, { viewport: { width: w, height: h } })
  for (const [name, path] of ADMIN) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
    await sleep(path === '/admin/world' ? 1000 : 400)
    if (path === '/admin/world') await page.waitForFunction(() => document.querySelector('iframe[title="World studio"]')?.contentDocument?.body?.dataset.ready === 'true', null, { timeout: 240000 }).catch(() => {})
    if (path === '/admin/pages') await page.frameLocator('iframe[title^="Draft preview"]').locator('[data-cms-id]').first().waitFor({ timeout: 90000 }).catch(() => {})
    await sleep(2500)
    await page.screenshot({ path: out(`final/${name}-${w}x${h}.png`) })
  }
  await context.close()
}
console.log(errors.length ? errors.join('\n') : 'no page errors')
await browser.close()
