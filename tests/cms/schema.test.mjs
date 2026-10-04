import { test } from 'node:test'
import assert from 'node:assert/strict'
import { load } from '../setup.mjs'

const S = await load('src/cms/schema.ts')
const { validateSiteReferences } = await load('src/cms/references.ts')
const { compileStyles, selectorFor } = await load('src/cms/css.ts')

test('links a visitor may follow: http(s), mailto, tel, site paths — never javascript:, data: or //host', () => {
  for (const ok of ['https://example.com', 'mailto:a@b.co', 'tel:+441234', '/projects', '#top', '']) assert.ok(S.safeHref.safeParse(ok).success, ok)
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>', '//evil.example', 'vbscript:x']) assert.equal(S.safeHref.safeParse(bad).success, false, bad)
  assert.equal(S.safeSrc.safeParse('http://insecure.example/a.png').success, false)
  assert.ok(S.safeSrc.safeParse('/media/abc/x.png').success)
})

test('style values cannot escape their declaration', () => {
  for (const ok of ['24px', '2rem', '50%', 'clamp(1rem, 0.5rem + 2vw, 3rem)', 'auto']) assert.ok(S.cssLength.safeParse(ok).success, ok)
  for (const bad of ['10px;background:url(x)', '1px}body{display:none', 'expression(alert(1))', 'url(javascript:alert(1))']) assert.equal(S.cssLength.safeParse(bad).success, false, bad)
  for (const bad of ['red;}', 'url(x)', '#fff;position:fixed']) assert.equal(S.cssColor.safeParse(bad).success, false, bad)
})

test('element ids are escaped in selectors and breakpoints compile to media queries', () => {
  assert.equal(selectorFor('a"]{x}'), ':root [data-cms-id="a\\"]{x}"][data-cms-id]')
  const css = compileStyles({ elements: { 'about.title': { style: { base: { fontSize: '40px' }, mobile: { fontSize: '24px' } } }, gone: { hidden: true } }, additions: {} })
  assert.match(css, /\[data-cms-id="about\.title"\]\[data-cms-id\]\{font-size:40px\}/)
  assert.match(css, /@media \(max-width: 640px\)\{[^}]*font-size:24px/)
  assert.match(css, /\[data-cms-id="gone"\]\[data-cms-id\]\{display:none\}/)
  assert.match(compileStyles({ elements: { gone: { hidden: true } }, additions: {} }, { editing: true }), /opacity:\.28/, 'the editor keeps hidden elements selectable')
})

test('cross-references are checked: unique slugs, real evidence, known sections', () => {
  const doc = {
    projects: [{ id: 'a', slug: 'same' }, { id: 'b', slug: 'same' }],
    techNodes: [{ name: 'Python', evidence: ['a', 'missing'] }],
    collections: { 'x.list': ['b', 'nope'] },
    journeys: { home: { sections: [{ id: 'about', kind: 'chapter', hidden: false }] }, projects: { sections: [{ id: 'not-a-chapter', kind: 'chapter', hidden: false }] } },
    additions: { 'ghost-section': [] }, groups: {},
  }
  const problems = validateSiteReferences(doc).map((p) => p.message).join(' | ')
  for (const want of [/share the slug/, /cites a project that does not exist/, /includes a project that does not exist/, /not a chapter this site can render/, /section that no longer exists/]) assert.match(problems, want)
})
