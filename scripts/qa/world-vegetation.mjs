/* The public player does not download vegetation.glb.gz up front: it only fills the `nature:*` entries of the studio's vegetation
   library, and nothing the published world names comes from it. A world that DOES name one (an admin placed a tree or a bush and
   published) must still open, and one instance that cannot be restored must never keep the whole world from opening.

     node scripts/qa/world-vegetation.mjs [--out <dir>] [--work <dir>] [--nature-doc <file.gz> --nature-assets <file.json>] [--refresh]

   1. Without --nature-doc it asks the real studio (QA_BASE, default http://localhost:3210, QA administrator from .data/qa-admin.json)
      to place world2:nature:treeBody and to produce the world document and the asset definitions it would save (a pair: a world
      is only restored by the definitions it was saved with). Nothing is saved or published. The pair is kept in --work.
   2. It serves the repository's player twice per scenario from a scratch static root (the working tree through symlinks, only seed/
      replaced) and opens it in Chromium on the real GPU:
        seed    the shipped files: ready, vegetation.glb.gz never requested, no nature entry in the catalog, no warning
        nature  the studio's pair: ready, vegetation.glb.gz requested exactly once, the tree is in the world with its definition,
                the car is placed beside it and a gameplay-camera screenshot is written (nature-tree.png)
        stale   the same pair with that instance's definition renamed to one that does not exist, and a second instance of another
                missing definition: ready, both left out, one warning each, everything else as in the nature run
   Exit code 1 when a scenario's expectation fails. */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { BASE, sleep } from './lib.mjs'
import { signIn } from './admin-session.mjs'
import { startWorldStaticServer } from './world-static-server.mjs'

const args = process.argv.slice(2)
const arg = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : fallback }
const OUT = path.resolve(arg('out', '.qa/runs/vegetation')), WORK = path.resolve(arg('work', '.qa/work/vegetation'))
const PUBLIC = path.resolve('public/archipelago')
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(WORK, { recursive: true })
const ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']

async function captureNaturePair(worldFile, assetsFile) {
  const browser = await chromium.launch({ headless: true, args: ARGS })
  const { page } = await signIn(browser, { viewport: { width: 1440, height: 900 } })
  await page.goto(BASE + '/admin/world', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelector('iframe[title="World studio"]')?.contentDocument?.body?.dataset.ready === 'true', null, { timeout: 300_000 })
  await sleep(2000)
  const result = await page.evaluate(async () => {
    const w = document.querySelector('iframe[title="World studio"]').contentWindow, A = w.__archipelago, e = A.editor
    const autosave = w.document.querySelector('#autosave'); if (autosave) autosave.checked = false
    e.save = async () => false // the studio must not save or publish anything
    const id = 'world2:nature:treeBody', index = e.assetTemplates.findIndex((a) => a.id === id)
    if (index < 0) return { problem: 'the studio offers no ' + id, natureTemplates: e.assetTemplates.filter((a) => a.id?.includes('nature:')).length }
    const mapActive = e.mapController?.active
    e.placeAsset(index, new A.THREE.Vector3(10, 0, 10), null)
    if (mapActive) e.mapController.restoreLayers()
    const doc = e.document(), text = JSON.stringify(doc)
    const gz = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
    let bin = ''; const u8 = new Uint8Array(gz); for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000))
    if (mapActive) e.mapController.applyLayers()
    e.undo(); e.dirty = false
    return { b64: btoa(bin), assets: JSON.stringify(e.assetDefinitions.document()), refs: doc.instanceRefs.filter((r) => r.definitionId === id).length }
  })
  await browser.close()
  if (result.problem || result.refs !== 1) throw Error('could not capture the studio document: ' + JSON.stringify({ ...result, b64: undefined, assets: undefined }))
  fs.writeFileSync(worldFile, Buffer.from(result.b64, 'base64')); fs.writeFileSync(assetsFile, result.assets)
}

function makeRoot(name, worldGz, assetsJson) {
  const root = path.join(WORK, 'root-' + name)
  fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(path.join(root, 'archipelago/seed'), { recursive: true })
  for (const entry of fs.readdirSync(PUBLIC)) if (entry !== 'seed') fs.symlinkSync(path.join(PUBLIC, entry), path.join(root, 'archipelago', entry))
  for (const file of fs.readdirSync(path.join(PUBLIC, 'seed'))) fs.copyFileSync(path.join(PUBLIC, 'seed', file), path.join(root, 'archipelago/seed', file))
  if (worldGz) fs.writeFileSync(path.join(root, 'archipelago/seed/editor-world.json.gz'), worldGz)
  if (assetsJson) fs.writeFileSync(path.join(root, 'archipelago/seed/asset-definitions.json'), assetsJson)
  return root
}

// A warning every start of the player has (Rapier's init() signature), not something this check is about.
const KNOWN = /using deprecated parameters for the initialization function/
async function boot(name, files, probe) {
  const server = await startWorldStaticServer({ root: makeRoot(name, files?.world, files?.assets), port: 0 }), base = server.url
  const browser = await chromium.launch({ headless: true, args: ARGS })
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage()
  const log = { errors: [], warnings: [], vegetation: 0 }
  page.on('request', (r) => { if (r.url().includes('vegetation.glb')) log.vegetation++ })
  page.on('pageerror', (e) => log.errors.push('pageerror ' + String(e).slice(0, 300)))
  page.on('console', (m) => { if (m.type() === 'error') log.errors.push(m.text().slice(0, 300)); if (m.type() === 'warning' && !KNOWN.test(m.text())) log.warnings.push(m.text().slice(0, 300)) })
  await page.goto(base + '/archipelago/preview/index.html')
  let ready = true
  try { await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 120_000, polling: 100 }) } catch { ready = false }
  const message = await page.evaluate(() => document.querySelector('#load-message')?.textContent ?? null)
  const facts = ready ? await probe(page) : {}
  await browser.close(); await server.close()
  return { ready, message, ...log, ...facts }
}

// The car is placed 6 m north of the tree, which then stands to its left in the chase camera's frame (the frame both runs are compared in).
async function besideTheTree(page, label) {
  await page.evaluate(([p]) => {
    const a = window.__archipelago, arrival = a.driving.arrival({ group: null, x: p[0], z: p[2] - 6, name: 'tree' })
    if (arrival.ok) a.driving.place(arrival, { reason: 'travel' })
  }, [treePosition])
  await sleep(2500) // the car has settled and the frame has been drawn
  await page.screenshot({ path: path.join(OUT, label + '.png') })
}

const problems = []
const expect = (ok, what) => { if (!ok) problems.push(what); console.log((ok ? '  ok   ' : '  FAIL ') + what) }
const natureFile = arg('nature-doc', path.join(WORK, 'doc-with-nature.gz')), assetsFile = arg('nature-assets', path.join(WORK, 'doc-with-nature.assets.json'))
if (!args.includes('--nature-doc') && (!fs.existsSync(natureFile) || !fs.existsSync(assetsFile) || args.includes('--refresh'))) await captureNaturePair(natureFile, assetsFile)
const natureGz = fs.readFileSync(natureFile), natureDoc = JSON.parse(zlib.gunzipSync(natureGz)), natureAssets = args.includes('--nature-doc') && !args.includes('--nature-assets') ? null : fs.readFileSync(assetsFile)
const tree = natureDoc.instanceRefs.find((r) => r.definitionId === 'world2:nature:treeBody')
const treePosition = tree.parts[0].state.p
console.log('the studio document places', tree.rootId, 'at', treePosition.map((v) => +v.toFixed(2)).join(', '))

const catalogFacts = (page) => page.evaluate(() => { const a = window.__archipelago, e = a.editor; return { natureEntries: e.catalog.entries.filter((x) => x.id.startsWith('nature:')).length, natureDefinitions: [...e.assetDefinitions.definitions.keys()].filter((id) => id.startsWith('world2:nature:')).length, registry: e.registry.size } })

console.log('\nseed: the document the repository ships')
const seed = await boot('seed', null, catalogFacts)
expect(seed.ready, `ready${seed.message ? ' (' + seed.message + ')' : ''}`)
expect(seed.vegetation === 0, `vegetation.glb.gz not requested (${seed.vegetation} requests)`)
expect(seed.natureEntries === 0 && seed.natureDefinitions === 0, `no nature entry or definition (${seed.natureEntries}, ${seed.natureDefinitions})`)
expect(!seed.errors.length && !seed.warnings.length, `no console errors or warnings ${JSON.stringify([...seed.errors, ...seed.warnings].slice(0, 3))}`)

console.log('\nnature: the studio document with a tree from the vegetation library')
const nature = await boot('nature', { world: natureGz, assets: natureAssets }, async (page) => {
  await besideTheTree(page, 'nature-tree')
  // (whether the node's own `visible` is set says nothing here: the runtime merges static meshes and hides the originals)
  return page.evaluate((id) => {
    const e = window.__archipelago.editor, node = e.registry.get(id)
    let meshes = 0; node?.traverse((o) => { if (o.isMesh) meshes++ })
    return { natureEntries: e.catalog.entries.filter((x) => x.id.startsWith('nature:')).length, natureDefinitions: [...e.assetDefinitions.definitions.keys()].filter((x) => x.startsWith('world2:nature:')).length, restored: !!node, definition: node?.userData.assetDefinitionId ?? null, meshes, registry: e.registry.size }
  }, tree.rootId)
})
expect(nature.ready, `ready${nature.message ? ' (' + nature.message + ')' : ''}`)
expect(nature.vegetation === 1, `vegetation.glb.gz requested once (${nature.vegetation})`)
expect(nature.restored && nature.definition === 'world2:nature:treeBody' && nature.meshes > 0, `the tree is in the world: ${JSON.stringify({ definition: nature.definition, meshes: nature.meshes })}`)
expect(nature.natureEntries >= 5 && nature.natureDefinitions === nature.natureEntries, `the library entries are catalog entries and definitions (${nature.natureEntries}, ${nature.natureDefinitions})`)
expect(!nature.errors.length && !nature.warnings.length, `no console errors or warnings ${JSON.stringify([...nature.errors, ...nature.warnings].slice(0, 3))}`)

console.log('\nstale: the same instance with a definition that does not exist, and another instance of one that does not either')
const stale = JSON.parse(zlib.gunzipSync(natureGz))
stale.instanceRefs.find((r) => r.rootId === tree.rootId).definitionId = 'world2:nature:noLongerThere'
stale.instanceRefs.push({ ...JSON.parse(JSON.stringify(tree)), rootId: 'user:stale-copy', definitionId: 'custom:never-saved', parts: tree.parts.map((p, i) => ({ ...p, id: i ? 'user:stale-copy/' + i : 'user:stale-copy' })) })
const staleRun = await boot('stale', { world: zlib.gzipSync(Buffer.from(JSON.stringify(stale)), { level: 6 }), assets: natureAssets }, async (page) => {
  await besideTheTree(page, 'stale-no-tree')
  return page.evaluate((id) => ({ present: window.__archipelago.editor.registry.has(id), registry: window.__archipelago.editor.registry.size }), tree.rootId)
})
expect(staleRun.ready, `ready${staleRun.message ? ' (' + staleRun.message + ')' : ''}`)
expect(!staleRun.present && nature.registry - staleRun.registry === tree.parts.length, `both are left out, and nothing else changes: the nature run has the tree's ${tree.parts.length} nodes more (${nature.registry} against ${staleRun.registry})`)
const left = staleRun.warnings.filter((w) => w.includes('Saved asset instance left out'))
expect(left.length === 2 && left.some((w) => w.includes('world2:nature:noLongerThere')) && left.some((w) => w.includes('custom:never-saved')), `one warning each: ${JSON.stringify(left.map((w) => w.slice(0, 110)))}`)
expect(!staleRun.errors.length, `no console errors ${JSON.stringify(staleRun.errors.slice(0, 3))}`)
// The same frame with and without the tree: the tree is drawn.
const [x, y] = await Promise.all(['nature-tree', 'stale-no-tree'].map((n) => sharp(path.join(OUT, n + '.png')).removeAlpha().raw().toBuffer({ resolveWithObject: true })))
let over = 0; for (let i = 0; i < x.info.width * x.info.height; i++) if (Math.max(...[0, 1, 2].map((c) => Math.abs(x.data[i * 3 + c] - y.data[i * 3 + c]))) > 24) over++
const share = 100 * over / (x.info.width * x.info.height)
expect(share > 1, `the tree is drawn: ${share.toFixed(1)}% of the frame differs from the same frame without it (nature-tree.png, stale-no-tree.png)`)

console.log(problems.length ? `\n${problems.length} expectation(s) failed` : '\nall expectations hold')
process.exit(problems.length ? 1 : 0)
