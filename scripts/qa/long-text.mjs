/* Long text, through the real pipeline. Every text the website admin can
   edit on the home page and the projects page, and every project title,
   is set to about twice its recommended length in a DRAFT; the
   responsive check (responsive-shots.mjs, with --cut and --overlap) then runs against
   that draft through Draft Mode, at every width and held sideways.

     node scripts/qa/long-text.mjs [--paths /,/projects]
       [--widths 320,390,768,1024,1440,1920,3440] [--landscape 667,844,932]

   Needs the QA administrator (.data/qa-admin.json) on QA_BASE (default
   :3210). The draft is put back at the end, and published back only if
   it was identical to the live site to begin with, so an administrator's
   unpublished work is never published by this check. */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { BASE, launch } from './lib.mjs'
import { signIn, adminFetch } from './admin-session.mjs'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i < 0 || args[i + 1] === undefined ? fallback : args[i + 1]
}
const PATHS = opt('paths', '/,/projects').split(',')
const WIDTHS = opt('widths', '320,390,768,1024,1440,1920,3440')
const LANDSCAPE = opt('landscape', '667,844,932')
const OUT = path.resolve(process.env.QA_OUT ?? '.qa/long-text')
fs.mkdirSync(OUT, { recursive: true })

/* About twice each field's recommended length (src/admin/website/registry.ts),
   written as a person might really write it: long words, long names, an
   unbroken address. */
const LONG_ELEMENTS = {
  'prelude.tag': 'PORTFOLIO · SELECTED WORK',
  'prelude.location': 'London, United Kingdom\n51.5072° N · 0.1276° W',
  'about.tag': 'A LITTLE ABOUT ME, WHERE I COME FROM AND WHERE I AM GOING',
  'about.corner': 'THE PATH BELOW IS THE TIMELINE\nOF EVERYTHING THAT BROUGHT ME HERE',
  'toolbox.tag': 'EVIDENCE, NOT KEYWORDS: EVERY TOOL IS BACKED BY REAL WORK',
  'toolbox.title': 'The tech\ntoolbox behind every project',
  'toolbox.note': 'Hover over or tap any technology to light up every single project that actually used it in production, at university or in a personal experiment, and read how it was used there.',
  'toolbox.group.language': 'Programming languages',
  'toolbox.group.framework': 'Frameworks and libraries',
  'toolbox.group.ai': 'AI and machine learning',
  'toolbox.group.data': 'Data and analytics',
  'toolbox.group.cloud': 'Cloud, infrastructure and DevOps',
  'toolbox.group.tooling': 'Tooling and automation',
  'toolbox.group.design': 'Design, web and accessibility',
  'universe.tag': 'PROJECT UNIVERSE: EVERYTHING, BIG AND SMALL',
  'universe.title': 'Everything I have built,\nshipped and still maintain',
  'universe.hint': 'Point at any project to read what it is and why it matters · select one to open its full case study with screenshots',
  'education.tag': 'EDUCATION AND QUALIFICATIONS',
  'education.title': 'Two universities,\none direction, and many late nights in the library.',
  'education.foot.label': 'Also certified in',
  'contact.tag': 'END OF JOURNEY · THANK YOU FOR SCROLLING THIS FAR',
  'contact.colophon.built': 'Built by hand with Next.js, React Three Fiber, a vegetation simulation, a lot of scroll maths and more coffee than I would like to admit in public.',
}
const PROJECT_CHAPTERS = ['pansofia', 'teaching', 'focus', 'gym', 'metaview', 'chess', 'stock']

function lengthen(doc) {
  const d = structuredClone(doc)
  const p = d.profile
  p.name = 'Alejandro Maximiliano Newport Díaz-Fernández'
  p.thesis = 'I build products where machine learning, careful design and solid engineering meet.'
  p.summary = 'I am a software engineer and machine learning practitioner who moved from Spain to London to study, teach and build. I care about products that people actually use: the data behind them, the systems that keep them running and the small interface details that make them feel calm, quick and trustworthy every day.'
  if (Array.isArray(p.roles)) p.roles = p.roles.map((r) => `${r} and systems designer`)
  if (Array.isArray(p.markers)) p.markers = p.markers.map((m) => ({ ...m, from: `${m.from}, the beginning`, to: `${m.to}, and onwards` }))
  if (p.closing) p.closing = { ...p.closing, question: 'So, what are we building next?', answer: 'Something worth remembering, together.' }
  d.contact = d.contact.map((c) => ({ ...c, label: `${c.label} (preferred)`, value: c.value.includes('@') ? c.value.replace('@', '.portfolio.enquiries@') : `${c.value}/portfolio-and-writing` }))
  d.education = d.education.map((e) => ({ ...e, institution: `${e.institution}, University of London`, degree: `${e.degree} with Honours and a Year in Industry` }))
  d.elements = { ...d.elements }
  for (const [id, text] of Object.entries(LONG_ELEMENTS)) d.elements[id] = { ...d.elements[id], text }
  for (const id of PROJECT_CHAPTERS) {
    d.elements[`${id}.tag`] = { ...d.elements[`${id}.tag`], text: 'FROM A SMALL EXPERIMENT TO A REAL PRODUCT PEOPLE USE' }
    d.elements[`${id}.title`] = { ...d.elements[`${id}.title`], text: 'A much longer chapter title,\nwritten over two lines' }
  }
  d.projects = d.projects.map((pr) => ({ ...pr, title: `${pr.title}: the extended edition`, shortDescription: `${pr.shortDescription} Extended with a second sentence to test how cards hold longer text.`.slice(0, 200) }))
  return d
}

const browser = await launch()
const { context, page } = await signIn(browser)
const start = (await adminFetch(page, '/api/admin/site')).body
const original = start.doc
const wasLive = start.published && JSON.stringify(start.published.doc) === JSON.stringify(original)
let failed = 0
try {
  const saved = await adminFetch(page, '/api/admin/site/draft', { method: 'PUT', json: { base: start.head.draft?.id ?? null, doc: lengthen(original), message: 'QA: long text', force: true } })
  if (saved.status !== 200) throw new Error(`the long draft was refused: ${saved.status} ${JSON.stringify(saved.body).slice(0, 400)}`)
  const preview = await adminFetch(page, '/api/admin/preview', { method: 'POST', json: {} })
  if (preview.status !== 200) throw new Error(`Draft Mode was refused: ${preview.status}`)
  const state = path.join(OUT, 'state.json')
  await context.storageState({ path: state })
  // The draft really is what the page shows.
  const check = await browser.newContext({ storageState: state })
  const probe = await check.newPage()
  await probe.goto(`${BASE}/`, { waitUntil: 'load' })
  const shown = await probe.evaluate(() => document.body.innerText.includes('Maximiliano'))
  await check.close()
  if (!shown) throw new Error('the page does not show the long draft (Draft Mode not applied)')
  console.log('the long draft is on the page')

  for (const p of PATHS) {
    for (const [label, extra] of [['portrait', ['--widths', WIDTHS]], ['landscape', ['--widths', LANDSCAPE, '--landscape']]]) {
      console.log(`\n== ${p} ${label}`)
      const r = spawnSync(process.execPath, ['scripts/qa/responsive-shots.mjs', '--base', BASE, '--path', p, '--storage', state, '--cut', '--overlap', ...extra], { stdio: 'inherit', env: { ...process.env, QA_OUT: OUT } })
      if (r.status !== 0) failed++
    }
  }
} finally {
  const now = (await adminFetch(page, '/api/admin/site')).body
  const restored = await adminFetch(page, '/api/admin/site/draft', { method: 'PUT', json: { base: now.head.draft?.id ?? null, doc: original, message: 'QA: long text restored', force: true } })
  console.log(`\ndraft restored: ${restored.status === 200 ? 'yes' : `NO (${restored.status})`}`)
  if (wasLive) {
    const pub = await adminFetch(page, '/api/admin/site/publish', { method: 'POST', json: {} })
    console.log(`published back (it matched the live site): ${pub.status === 200 ? 'yes' : `NO (${pub.status})`}`)
  }
  await adminFetch(page, '/api/admin/preview', { method: 'DELETE' })
  await browser.close()
}
console.log(failed ? `\n${failed} run(s) with problems; screenshots in ${OUT}` : `\nno problems; screenshots in ${OUT}`)
if (failed) process.exitCode = 1
