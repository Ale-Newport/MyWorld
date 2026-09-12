import { test } from 'node:test'
import assert from 'node:assert/strict'
import { load } from '../setup.mjs'

const S = await load('src/cms/schema.ts')
const { validateSiteReferences } = await load('src/cms/references.ts')
const { migrateSiteDocument } = await load('src/cms/migrate.ts')
const catalog = await load('src/sections/catalog.ts')

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

test('cross-references are checked: unique slugs, real evidence, known sections', () => {
  const doc = {
    projects: [{ id: 'a', slug: 'same' }, { id: 'b', slug: 'same' }],
    techNodes: [{ name: 'Python', evidence: ['a', 'missing'] }],
    collections: { 'x.list': ['b', 'nope'] },
    journeys: { home: { sections: [{ id: 'about', kind: 'chapter', hidden: false }] }, projects: { sections: [{ id: 'not-a-chapter', kind: 'chapter', hidden: false }] } },
    additions: { 'ghost-section': [] },
  }
  const problems = validateSiteReferences(doc).map((p) => p.message).join(' | ')
  for (const want of [/share the slug/, /cites a project that does not exist/, /includes a project that does not exist/, /not a chapter this site can render/, /section that no longer exists/]) assert.match(problems, want)
})

test('animations must belong to their section; toolbox settings only to the toolbox', () => {
  const base = { projects: [], techNodes: [], collections: {}, additions: {} }
  const wrongSection = { ...base, journeys: { home: { sections: [{ id: 'about', title: 'About', kind: 'chapter', hidden: false, animation: { id: 'universe.orbits' } }] }, projects: { sections: [{ id: 'focus', kind: 'chapter', hidden: false }] } } }
  assert.match(validateSiteReferences(wrongSection).map((p) => p.message).join(' | '), /not one of the animations/)
  const notAnimated = { ...base, journeys: { home: { sections: [{ id: 'education', title: 'Education', kind: 'chapter', hidden: false, animation: { id: 'about.type-motion' } }, { id: 'about', title: 'About', kind: 'chapter', hidden: false, toolbox: { showCounts: true, showNames: false } }] }, projects: { sections: [{ id: 'focus', kind: 'chapter', hidden: false }] } } }
  const messages = validateSiteReferences(notAnimated).map((p) => p.message).join(' | ')
  assert.match(messages, /has no choice of animation/)
  assert.match(messages, /Toolbox settings belong to the Tech Toolbox/)
  const fine = { ...base, journeys: { home: { sections: [{ id: 'about', title: 'About', kind: 'chapter', hidden: false, animation: { id: 'about.type-motion', intensity: 0.4 } }] }, projects: { sections: [{ id: 'focus', kind: 'chapter', hidden: false }] } } }
  assert.deepEqual(validateSiteReferences(fine), [])
})

test('every animated section offers exactly five options, all distinct, with a default among them', () => {
  for (const section of catalog.ANIMATED_SECTIONS) {
    const options = catalog.SECTION_ANIMATIONS[section]
    assert.equal(options.length, 5, section)
    assert.equal(new Set(options.map((o) => o.id)).size, 5, section)
    assert.ok(options.every((o) => o.id.startsWith(`${section}.`)), section)
    assert.ok(options.some((o) => o.id === catalog.DEFAULT_ANIMATION[section]), section)
  }
  // A stored id from another section, or one that was retired, falls back to the default with its own knobs.
  assert.equal(catalog.resolveAnimation('about', { id: 'universe.orbits', intensity: 0.1 }).id, catalog.DEFAULT_ANIMATION.about)
  assert.equal(catalog.resolveAnimation('about', { id: 'about.retired-one' }).id, catalog.DEFAULT_ANIMATION.about)
  const kept = catalog.resolveAnimation('contact', { id: 'contact.ribbon-aperture', intensity: 5, speed: 0.1 })
  assert.deepEqual(kept, { id: 'contact.ribbon-aperture', intensity: 1, speed: 0.5 })
})

test('v1 documents migrate to v2: text kept, geometry dropped, added elements moved into a content section', () => {
  const v1 = {
    schemaVersion: 1,
    journeys: {
      home: { sections: [{ id: 'about', kind: 'chapter', hidden: false, title: 'About', label: 'A LITTLE ABOUT ME', group: 'Introduction', vh: 3.4, quickVh: 1.8 }, { id: 'universe', kind: 'chapter', hidden: false, title: 'Project Universe', label: 'X', group: 'Practice', vh: 3.6, quickVh: 2, animation: { id: 'universe.gone' } }] },
      projects: { sections: [] },
    },
    elements: {
      'about.corner': { text: 'A NOTE', style: { base: { fontSize: '40px', translateX: '12px' } }, locked: true },
      'universe.cross': { props: { href: '/projects' } },
      'prelude.length': { style: { mobile: { display: 'none' } } },
      'about.tag': { hidden: true },
    },
    additions: { about: [{ id: 'el-1', type: 'heading', name: 'Heading', text: 'Kept', props: { level: 2 }, style: { base: { top: '10px' } }, layout: { mode: 'anchored' }, locked: true }] },
    groups: { about: [{ id: 'g1', name: 'Group', members: ['a', 'b'] }] },
  }
  const doc = migrateSiteDocument(v1)
  assert.equal(doc.schemaVersion, 2)
  assert.equal(doc.groups, undefined)
  assert.deepEqual(doc.elements['about.corner'], { text: 'A NOTE' })
  assert.deepEqual(doc.elements['universe.cross'], { href: '/projects' })
  assert.equal(doc.elements['prelude.length'], undefined, 'an override that only held geometry leaves nothing')
  assert.deepEqual(doc.elements['about.tag'], { hidden: true })
  assert.equal(doc.additions.about, undefined)
  assert.deepEqual(doc.additions['about-more'], [{ id: 'el-1', type: 'heading', name: 'Heading', text: 'Kept', props: { level: 2 } }])
  const ids = doc.journeys.home.sections.map((s) => s.id)
  assert.deepEqual(ids, ['about', 'about-more', 'universe'])
  assert.equal(doc.journeys.home.sections[1].kind, 'custom')
  assert.equal(doc.journeys.home.sections[2].animation, undefined, 'a retired animation id is dropped, so the default shows')
  assert.equal(v1.journeys.home.sections[1].animation.id, 'universe.gone', 'the stored document is never mutated')
  assert.throws(() => migrateSiteDocument({ schemaVersion: 99 }), /newer version/)
})
