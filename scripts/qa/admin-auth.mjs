/* The admin is protected server-side: pages redirect, APIs refuse without a
   session, mutations refuse without the CSRF token or from another origin. */
import { launch, assert, finish, BASE } from './lib.mjs'
import { signIn, qaAdmin } from './admin-session.mjs'
const results = []
const get = (path, init) => fetch(BASE + path, { redirect: 'manual', ...init })

// Anonymous: pages redirect to login, APIs answer 401.
for (const path of ['/admin', '/admin/pages', '/admin/world', '/admin/settings']) {
  const r = await get(path)
  assert(r.status === 307 || r.status === 308, `anonymous ${path} → redirect to sign-in (${r.status} ${r.headers.get('location')})`, results)
}
for (const [path, method] of [['/api/admin/site', 'GET'], ['/api/admin/site/draft', 'PUT'], ['/api/admin/site/publish', 'POST'], ['/api/admin/media', 'GET'], ['/api/admin/world/draft', 'GET']]) {
  const r = await get(path, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' })
  assert(r.status === 401, `anonymous ${method} ${path} → 401 (${r.status})`, results)
}
// A forged cookie passes the proxy's quick check but not the server's.
const forged = await get('/admin', { headers: { cookie: 'an_admin=' + 'x'.repeat(43) } })
assert(forged.status === 307 || forged.status === 308, `forged session cookie → redirect (${forged.status})`, results)
const forgedApi = await get('/api/admin/site', { headers: { cookie: 'an_admin=' + 'x'.repeat(43) } })
assert(forgedApi.status === 401, `forged session cookie on the API → 401 (${forgedApi.status})`, results)
// Wrong password.
const bad = await get('/api/admin/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ email: qaAdmin().email, password: 'definitely-not-the-password' }) })
assert(bad.status === 401, `wrong password → 401 (${bad.status})`, results)

const browser = await launch()
const { context, page } = await signIn(browser)
assert(new URL(page.url()).pathname === '/admin', `signed in lands on the dashboard (${page.url()})`, results)
const cookies = await context.cookies()
const session = cookies.find((c) => c.name.endsWith('an_admin'))
assert(session && session.httpOnly && session.sameSite === 'Strict', 'session cookie is httpOnly and SameSite=Strict', results)
// With a session but no CSRF token, mutations are refused.
const noCsrf = await page.evaluate(async () => (await fetch('/api/admin/site/publish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status)
assert(noCsrf === 403, `session without CSRF token → 403 (${noCsrf})`, results)
const cross = await get('/api/admin/site/publish', { method: 'POST', headers: { cookie: `${session.name}=${session.value}`, origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' })
assert(cross.status === 403, `cross-origin request with a valid session → 403 (${cross.status})`, results)
// Sign out kills the session server-side.
await page.click('button[title="Sign out"]')
await page.waitForURL(/\/admin\/login/)
const after = await get('/api/admin/site', { headers: { cookie: `${session.name}=${session.value}` } })
assert(after.status === 401, `the old session is dead after sign-out (${after.status})`, results)
await browser.close()
finish(results)
