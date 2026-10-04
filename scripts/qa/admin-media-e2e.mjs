/* Media: upload (a PNG, an SVG with a script in it, a file that is not
   media), alt text and title, usage tracking, delete safeguards.
   node scripts/qa/admin-media-e2e.mjs */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { BASE, launch, assert, sleep, watch, out } from './lib.mjs'
import { signIn, adminFetch } from './admin-session.mjs'

/* A real 64×40 PNG, built here so the test needs no fixture. */
function png(w, h) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1 } return ~c >>> 0 }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 200; raw[o + 1] = 80 + y; raw[o + 2] = 40 + x }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const dir = out('media-fixtures')
fs.mkdirSync(dir, { recursive: true })
const pngPath = path.join(dir, 'qa-swatch.png'); fs.writeFileSync(pngPath, png(64, 40))
const svgPath = path.join(dir, 'qa-icon.svg'); fs.writeFileSync(svgPath, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)"><circle cx="5" cy="5" r="4" fill="#bf4f27"/></a></svg>')
const txtPath = path.join(dir, 'notes.png'); fs.writeFileSync(txtPath, 'this is not an image')

const results = []
const browser = await launch()
const { context, page } = await signIn(browser)
const errors = watch(page)
const original = (await adminFetch(page, '/api/admin/site')).body
const created = []
try {
  await page.goto(`${BASE}/admin/media`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Media' }).waitFor()
  const input = page.locator('input[type=file]')
  await input.setInputFiles([pngPath, svgPath])
  await page.locator('.media-tile', { hasText: 'qa swatch' }).waitFor({ timeout: 20000 })
  await page.locator('.media-tile', { hasText: 'qa icon' }).waitFor({ timeout: 20000 })
  const list = (await adminFetch(page, '/api/admin/media')).body.items
  const pngItem = list.find((m) => m.filename === 'qa-swatch.png'), svgItem = list.find((m) => m.filename === 'qa-icon.svg')
  created.push(pngItem?.id, svgItem?.id)
  assert(pngItem?.width === 64 && pngItem?.height === 40 && pngItem.mime === 'image/png', `the PNG is stored with its real type and size (${pngItem?.width}×${pngItem?.height})`, results)
  const svgText = await (await fetch(`${BASE}${svgItem.url}`)).text()
  const svgHeaders = (await fetch(`${BASE}${svgItem.url}`)).headers
  assert(!/script|onload|javascript:/i.test(svgText) && /<circle/.test(svgText), 'the SVG is stored without its script, handlers or javascript: link', results)
  assert(/sandbox/.test(svgHeaders.get('content-security-policy') ?? '') && svgHeaders.get('x-content-type-options') === 'nosniff', 'and served sandboxed with nosniff', results)
  await input.setInputFiles([txtPath])
  const refused = await page.getByText(/not accepted/).first().waitFor({ timeout: 10000 }).then(() => true, () => false)
  assert(refused, 'a text file named .png is refused by its contents', results)

  // alt text through the UI
  await page.locator('.media-tile', { hasText: 'qa swatch' }).click()
  const alt = page.getByLabel('Alternative text')
  await alt.fill('An orange gradient swatch used by the QA run')
  await page.getByLabel('Title').click()
  await sleep(800)
  const saved = (await adminFetch(page, '/api/admin/media')).body.items.find((m) => m.id === pngItem.id)
  assert(saved.alt.startsWith('An orange gradient'), 'alt text is saved', results)

  // used by the draft → cannot be deleted
  const doc = structuredClone(original.doc)
  doc.settings.ogImage = pngItem.url
  const put = await adminFetch(page, '/api/admin/site/draft', { method: 'PUT', json: { base: original.head.draft?.id ?? null, doc, message: 'QA: media usage' } })
  assert(put.status === 200, 'the draft can use the uploaded file', results)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.media-tile', { hasText: 'qa swatch' }).click()
  await page.getByText('Settings → ogImage').waitFor({ timeout: 10000 }).then(() => assert(true, 'its usage is listed (Settings → ogImage)', results), () => assert(false, 'its usage is listed (Settings → ogImage)', results))
  assert(await page.getByRole('button', { name: 'Delete' }).isDisabled(), 'deleting a used file is not offered', results)
  const del = await adminFetch(page, `/api/admin/media/${pngItem.id}`, { method: 'DELETE' })
  assert(del.status === 422 && /still used/.test(del.body?.error ?? ''), `and the server refuses it too (${del.status})`, results)
  await page.screenshot({ path: out('media.png') })
} finally {
  const head = (await adminFetch(page, '/api/admin/site')).body.head
  await adminFetch(page, '/api/admin/site/draft', { method: 'PUT', json: { base: head.draft?.id ?? null, doc: original.doc, message: 'QA: media run restored' } })
  for (const id of created.filter(Boolean)) {
    const r = await adminFetch(page, `/api/admin/media/${id}`, { method: 'DELETE' })
    assert(r.status === 200, `cleanup deleted ${id} once unused (${r.status})`, results)
  }
}
assert(errors.filter((e) => !/422|Unprocessable/.test(e)).length === 0, `no unexpected console errors (${errors.slice(0, 2).join(' | ')})`, results)
await context.close(); await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
