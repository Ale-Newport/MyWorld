import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDataDir, load } from '../setup.mjs'

freshDataDir('contact')
const C = await load('src/server/contact.ts')

const good = { name: 'Ada Lovelace', email: 'ada@example.com', message: 'I would like to talk about a project.' }

test('a complete message passes, trimmed and normalised', () => {
  const r = C.validateContact({ ...good, name: '  Ada Lovelace ', message: 'Line one\r\nLine two, long enough.' })
  assert.equal(r.ok, true)
  assert.equal(r.value.name, 'Ada Lovelace')
  assert.equal(r.value.message, 'Line one\nLine two, long enough.')
})

test('each field says why it was refused', () => {
  const r = C.validateContact({ name: '', email: 'not-an-address', message: 'short' })
  assert.equal(r.ok, false)
  assert.ok(r.errors.name && r.errors.email && r.errors.message)
  assert.equal(C.validateContact({ ...good, message: 'x'.repeat(C.LIMITS.message + 1) }).ok, false)
  assert.equal(C.validateContact({ ...good, email: 'a@b' }).ok, false)
  assert.equal(C.validateContact(null).ok, false)
})

test('nothing that becomes a header can carry a line break', () => {
  for (const name of ['Ada\r\nBcc: victim@example.com', 'Ada\nX: y', 'Ada Bcc: x']) {
    assert.equal(C.validateContact({ ...good, name }).ok, false, JSON.stringify(name))
  }
  assert.equal(C.validateContact({ ...good, email: 'ada@example.com\r\nBcc: x@example.com' }).ok, false)
  assert.throws(() => C.buildContactEmail({ ...good, name: 'a\r\nb' }, { from: 'contact@site.test', to: 'me@site.test', site: 'site.test' }))
})

test('the email is plain-text MIME, replies go to the visitor, and the body survives any language', () => {
  const raw = C.buildContactEmail({ ...good, name: 'José Núñez', message: 'Hola — ¿hablamos? 你好' }, { from: 'contact@site.test', to: 'me@site.test', site: 'www.site.test', date: new Date(0), id: 'abc' })
  const [head, body] = raw.split('\r\n\r\n')
  assert.match(head, /^From: Portfolio contact form <contact@site\.test>\r\n/m)
  assert.match(head, /^To: <me@site\.test>$/m)
  assert.match(head, /^Reply-To: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <ada@example\.com>$/m)
  assert.match(head, /^Subject: =\?UTF-8\?B\?/m)
  assert.match(head, /^Message-ID: <abc@site\.test>$/m)
  assert.match(head, /^Content-Type: text\/plain; charset=utf-8$/m)
  for (const line of raw.split('\r\n')) assert.ok(line.length <= 998, 'no line over the RFC 5322 limit')
  const text = Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')
  assert.match(text, /Hola — ¿hablamos\? 你好/)
  assert.match(text, /José Núñez <ada@example\.com>/)
})

test('the mail-app fallback carries the message, encoded', () => {
  assert.equal(C.mailtoFor('me@site.test'), 'mailto:me@site.test')
  const href = C.mailtoFor('me@site.test', { name: 'Ada', message: 'Hi & bye\nnext line' })
  const url = new URL(href)
  assert.equal(url.protocol, 'mailto:')
  assert.equal(url.searchParams.get('subject'), 'Hello from Ada')
  assert.equal(url.searchParams.get('body'), 'Hi & bye\nnext line')
  assert.ok(!href.includes('+'), 'spaces as %20, which every mail app reads')
})

test('outside a Worker with the send_email binding, nothing claims it can send', async () => {
  assert.equal(await C.delivery('https://www.site.test', 'me@site.test'), null)
})

test('three messages an hour per address, counted across requests', async () => {
  const results = []
  for (let i = 0; i < 4; i++) results.push(await C.overLimit('203.0.113.9'))
  assert.deepEqual(results.map((r) => r.over), [false, false, false, true])
  assert.ok(results[3].retryAfter > 3000 && results[3].retryAfter <= 3600)
  assert.equal((await C.overLimit('198.51.100.4')).over, false, 'another address is not affected')
})
