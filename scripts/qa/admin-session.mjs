/* Signs the QA administrator in (credentials from the git-ignored .data/qa-admin.json,
   created by `npm run admin:create`) and returns an authenticated browser context. */
import fs from 'node:fs'
import { BASE } from './lib.mjs'

export function qaAdmin() {
  return JSON.parse(fs.readFileSync('.data/qa-admin.json', 'utf8'))
}

export async function signIn(browser, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options })
  const page = await context.newPage()
  const { email, password } = qaAdmin()
  await page.goto(`${BASE}/admin/login`)
  await page.fill('input[name=email]', email)
  await page.fill('input[name=password]', password)
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 60000 }), page.click('button[type=submit]')])
  return { context, page }
}

/** Calls an admin API from the signed-in page, with the session's CSRF token. */
export async function adminFetch(page, path, { method = 'GET', json } = {}) {
  return page.evaluate(async ({ path, method, json }) => {
    const { csrf } = await (await fetch('/api/admin/auth/session')).json()
    const res = await fetch(path, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: json === undefined ? undefined : JSON.stringify(json) })
    return { status: res.status, body: await res.json().catch(() => null) }
  }, { path, method, json })
}
