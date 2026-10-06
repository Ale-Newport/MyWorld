import { test } from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { freshDataDir, load } from '../setup.mjs'

freshDataDir('media')
const M = await load('src/server/media.ts')
const actor = { id: null, name: 'Test' }

function png(w, h) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1 } return ~c >>> 0 }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.alloc((w * 3 + 1) * h))), chunk('IEND', Buffer.alloc(0))])
}

test('SVG is rebuilt from an allow-list: no scripts, handlers, javascript: or external links', () => {
  const out = M.sanitizeSvg(`<?xml version="1.0"?><!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)" viewBox="0 0 10 10">
    <script>alert(2)</script><foreignObject><div>x</div></foreignObject>
    <a href="javascript:alert(3)"><circle cx="5" cy="5" r="4" fill="#bf4f27" onclick="alert(4)"/></a>
    <use href="https://evil.example/x.svg#a"/><use href="#ok"/><rect style="background:url(https://evil.example)" width="1" height="1"/></svg>`)
  assert.match(out, /^<svg/)
  for (const bad of [/script/i, /onload|onclick/i, /javascript:/i, /foreignObject/i, /evil\.example/]) assert.doesNotMatch(out, bad)
  assert.match(out, /<circle[^>]*cx="5"/, 'the drawing inside the removed link is kept')
  assert.match(out, /<use href="#ok"\/>/, 'local references are kept')
  assert.throws(() => M.sanitizeSvg('<html><script>alert(1)</script></html>'))
})

test('uploads are typed by their bytes, not their name', async () => {
  await assert.rejects(M.saveUpload(Buffer.from('not an image at all'), 'photo.png', actor), /not accepted/)
  const item = await M.saveUpload(png(64, 40), 'Photo.JPG', actor)
  assert.equal(item.mime, 'image/png')
  assert.equal(item.filename, 'Photo.png', 'the stored name carries the real type')
  assert.deepEqual([item.width, item.height], [64, 40])
})

test('a file still in use cannot be deleted', async () => {
  const item = await M.saveUpload(png(8, 8), 'used.png', actor)
  await assert.rejects(M.deleteMedia(item.id, ['Settings → favicon'], actor), /still used/)
  await M.deleteMedia(item.id, [], actor)
  assert.equal(await M.getMedia(item.id), null)
})
