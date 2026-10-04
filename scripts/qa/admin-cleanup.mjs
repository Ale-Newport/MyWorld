/* Puts the draft and published site back after an interrupted QA run: removes
   projects the runs create (slug qa-*, id untitled-project*) and strips the
   " QA <mark>" suffix the runs add to titles. node scripts/qa/admin-cleanup.mjs */
import { launch } from './lib.mjs'
import { signIn, adminFetch } from './admin-session.mjs'

export async function cleanup(page) {
  const { body } = await adminFetch(page, '/api/admin/site')
  const doc = body.doc
  let changed = 0
  const keep = doc.projects.filter((p) => !(p.slug.startsWith('qa-') || p.id.startsWith('untitled-project') || p.title.startsWith('Table test QA')))
  changed += doc.projects.length - keep.length
  doc.projects = keep
  for (const p of doc.projects) if (/ QA [a-z0-9]+$/.test(p.title)) { p.title = p.title.replace(/ QA [a-z0-9]+$/, ''); changed++ }
  for (const t of doc.techNodes) t.evidence = t.evidence.filter((e) => doc.projects.some((p) => p.id === e))
  for (const k of Object.keys(doc.collections)) doc.collections[k] = doc.collections[k].filter((e) => doc.projects.some((p) => p.id === e))
  if (!changed) return 0
  const saved = await adminFetch(page, '/api/admin/site/draft', { method: 'PUT', json: { base: body.head.draft?.id ?? null, doc, message: 'QA cleanup' } })
  if (saved.status !== 200) throw new Error(`cleanup save failed: ${saved.status} ${JSON.stringify(saved.body).slice(0, 300)}`)
  const pub = await adminFetch(page, '/api/admin/site/publish', { method: 'POST', json: {} })
  if (pub.status !== 200) throw new Error(`cleanup publish failed: ${pub.status}`)
  return changed
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const browser = await launch()
  const { page } = await signIn(browser)
  console.log('cleaned', await cleanup(page))
  await browser.close()
}
