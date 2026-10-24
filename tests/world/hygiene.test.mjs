/* The player's housekeeping: what a visitor's URL can and cannot change, the stylesheets' dead rules, the Achievements dialog's rows, the console. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { qaSwitches } from '../../public/archipelago/preview/runtime/qa-switches.js'
import { createAwardsList } from '../../public/archipelago/preview/runtime/awards-list.js'

const PREVIEW = path.resolve(import.meta.dirname, '../../public/archipelago/preview')
const read = (file) => fs.readFileSync(path.join(PREVIEW, file), 'utf8')
const ALL = '?shadow=legacy&fps=uncapped&freeze=off&terrain=whole&ferris=meshes&surfaces=legacy&perf'

test('a link a visitor was given cannot put the engine in another mode', () => {
  for (const host of ['portfolio.example.com', 'www.alejandronewport.com', 'visitor.test', '192.168.0.21', 'localhost.evil.example']) {
    for (const search of [ALL, '?shadow=post&freeze=flags', '']) {
      const on = Object.entries(qaSwitches(search, host)).filter(([, value]) => value)
      assert.deepEqual(on, [], `${host}${search}`)
    }
  }
})

test('the switches work where QA runs: localhost, and any page opened with ?qa', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const s = qaSwitches(ALL, host)
    assert.deepEqual([s.qa, s.perf, s.legacyShadow, s.uncapped, s.freezeOff, s.terrainWhole, s.ferrisMeshes, s.legacySurfaces], Array(8).fill(true), host)
  }
  const flagged = qaSwitches('?qa&freeze=flags&shadow=post', 'portfolio.example.com')
  assert.equal(flagged.qa && flagged.freezeFlags && flagged.postShadow, true)
  assert.equal(flagged.freezeOff || flagged.legacyShadow || flagged.perf, false, 'only what was asked for')
  assert.equal(qaSwitches('?qa&perf', 'portfolio.example.com').perf, true)
  assert.equal(qaSwitches('?perf', 'portfolio.example.com').perf, false, '?perf alone is not enough on the public host')
  assert.equal(qaSwitches('?fps=fast', 'localhost').uncapped, false, 'only the value the runtime knows')
})

test('the runtime reads the switches only through qa-switches.js', () => {
  for (const file of ['main.js', 'map-surfaces.js']) {
    const source = read(file)
    assert.ok(source.includes("./runtime/qa-switches.js'") || source.includes("'./qa-switches.js'"), `${file} imports the helper`)
    assert.ok(!/URLSearchParams\(\s*location\.search/.test(source), `${file} does not read the URL itself`)
    assert.ok(!/\.get\(\s*['"](shadow|fps|freeze|ferris|terrain|surfaces)['"]/.test(source), `${file} does not read a switch itself`)
  }
  const main = read('main.js')
  assert.ok(/if\(qaHost\)globalThis\.__archipelago=/.test(main), 'the QA handle is behind the same gate')
  // Every other file of the runtime: no switch read anywhere (the helper is the one place).
  const walk = (dir) => fs.readdirSync(path.join(PREVIEW, dir), { withFileTypes: true }).flatMap((e) => (e.name === 'vendor' ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : /\.js$/.test(e.name) ? [path.join(dir, e.name)] : []))
  const readers = walk('.').filter((file) => file !== 'runtime/qa-switches.js' && /URLSearchParams\(\s*location\.search/.test(read(file)))
  assert.deepEqual(readers, [], 'no module reads the page URL: a switch added elsewhere would reach visitors')
})

test('the stylesheets carry no rule for the removed #map-panel, #minimap and #map-legend', () => {
  for (const sheet of ['style.css', 'portfolio-theme.css', 'studio-theme.css', 'player.css', 'atlas.css']) assert.ok(!/#map-panel|#minimap|#map-legend/.test(read(sheet)), sheet)
})

/** Just enough of the DOM: elements with children, text, style and a count of every write. */
function fakePage() {
  const writes = { text: 0, style: 0, layout: 0, append: 0, remove: 0 }
  const element = (tag) => ({
    tag, children: [], parent: null, _text: '', _style: '', attrs: {},
    get textContent() { return this._text }, set textContent(v) { writes.text++; this._text = String(v) },
    set innerHTML(v) { this._text = v.replace(/<[^>]+>/g, '') },
    append(...nodes) { writes.append++; for (const n of nodes) { n.parent = this; this.children.push(n) } },
    remove() { writes.remove++; if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null },
    getAttribute(k) { return k === 'style' ? this._style : null },
    hasAttribute(k) { return k === 'style' && this._style !== null },
    setAttribute(k, v) { if (k === 'style') this._style = v },
    removeAttribute(k) { if (k === 'style') this._style = null },
    style: null,
    get offsetHeight() { writes.layout++; return 100 },
  })
  const make = (tag) => { const e = element(tag); e._style = null; e.style = { set cssText(v) { writes.style++; e._style = v } }; return e }
  const dialog = make('dialog'), list = make('div')
  const doc = { createElement: make }
  return { dialog, list, doc, writes, awards: createAwardsList({ dialog, list, document: doc }) }
}
const view = (n, unlocked = 0) => Array.from({ length: n }, (_, i) => ({ id: 'a' + i, title: 'Title ' + i, description: 'Do the thing ' + i, progress: i < unlocked ? 5 : 2, target: 5, unlocked: i < unlocked }))

test('the Achievements rows are what the dialog always showed', () => {
  const { awards, list } = fakePage()
  awards.sync(view(31, 2))
  assert.equal(list.children.length, 31)
  const text = (row) => row.children.map((c) => c.textContent).join('|')
  assert.equal(text(list.children[0]), '✓ Title 0|Do the thing 0 · 5 / 5')
  assert.equal(text(list.children[2]), '○ Title 2|Do the thing 2 · 2 / 5')
  assert.equal(list.children[0].tag, 'p')
  assert.deepEqual(list.children[0].children.map((c) => c.tag), ['strong', 'small'])
})

test('the rows are built once; a sync that changes nothing writes nothing', () => {
  const { awards, list, writes } = fakePage()
  awards.sync(view(31))
  const rows = [...list.children]
  for (const k of Object.keys(writes)) writes[k] = 0
  for (let i = 0; i < 5; i++) awards.sync(view(31))
  assert.deepEqual(writes, { text: 0, style: 0, layout: 0, append: 0, remove: 0 }, 'five opens, nothing to write')
  assert.ok(list.children.every((row, i) => row === rows[i]), 'the same elements')
})

test('an unlocked award rewrites its own row and no other', () => {
  const { awards, list, writes } = fakePage()
  awards.sync(view(31))
  const rows = [...list.children]
  writes.text = 0
  awards.sync(view(31, 1))
  assert.equal(writes.text, 2, 'its title (✓) and its progress')
  assert.ok(list.children.every((row, i) => row === rows[i]))
  assert.equal(list.children[0].children[0].textContent, '✓ Title 0')
})

test('progress past the target reads as the target, as it did', () => {
  const { awards, list } = fakePage()
  awards.sync([{ title: 'T', description: 'D', progress: 9, target: 5, unlocked: true }])
  assert.equal(list.children[0].children[1].textContent, 'D · 5 / 5')
})

test('a list that gets shorter drops its extra rows', () => {
  const { awards, list } = fakePage()
  awards.sync(view(5)); awards.sync(view(3))
  assert.equal(list.children.length, 3)
  assert.equal(awards.count, 3)
})

test('warming lays the dialog out once, off screen, and leaves it as it found it', () => {
  const { awards, list, dialog, writes } = fakePage()
  const seen = []
  Object.defineProperty(dialog, 'offsetHeight', { get() { writes.layout++; seen.push({ style: dialog._style, rows: list.children.length }); return 100 } })
  awards.warm(view(31))
  assert.equal(writes.layout, 1, 'one forced layout')
  assert.match(seen[0].style, /display:block/)
  assert.match(seen[0].style, /visibility:hidden/, 'never painted')
  assert.match(seen[0].style, /left:-9999px/, 'and not on screen')
  assert.equal(seen[0].rows, 32, 'the 31 rows and a probe carrying both markers')
  assert.equal(list.children.length, 31, 'the probe is gone')
  assert.equal(dialog._style, null, 'the dialog has no style attribute again')
  dialog._style = 'color:red'
  awards.warm(view(31))
  assert.equal(dialog._style, 'color:red', 'a style it had is put back')
})

test('main.js builds the rows under the loading cover and the click only syncs and shows', () => {
  const main = read('main.js')
  assert.ok(/enterDrive\(\);if\(gameplay\)try\{awards\.warm\(gameplay\.achievements\.view\(\)\);\}catch\(e\)\{[^}]*\}await presentable\(\)/.test(main), 'warmed after the drive is set up, before the first frame is presented, and a failure to warm cannot stop the world from starting')
  const show = main.match(/function showAchievements\(\)\{[^\n]*\}/)[0]
  assert.ok(show.includes('awards.sync(') && show.includes('.showModal()') && !show.includes('replaceChildren') && !show.includes('createElement'), 'the click does not rebuild the list')
})

test('vendored rapier starts without the deprecated-parameters warning', async () => {
  const warnings = []
  const warn = console.warn
  console.warn = (...args) => { warnings.push(args.join(' ')) }
  try {
    const rapier = await import(pathToFileURL(path.join(PREVIEW, 'vendor/@dimforge/rapier3d-compat/rapier.es.js')).href)
    await (rapier.default?.init ?? rapier.init)()
    const world = new rapier.World({ x: 0, y: -9.81, z: 0 })
    const body = world.createRigidBody(rapier.RigidBodyDesc.dynamic().setTranslation(0, 5, 0))
    world.createCollider(rapier.ColliderDesc.ball(0.5), body)
    for (let i = 0; i < 30; i++) world.step()
    assert.ok(Math.abs(body.translation().y - 3.7635) < 1e-3, 'and it still simulates: a ball falls the same distance')
  } finally { console.warn = warn }
  assert.deepEqual(warnings, [])
})

/** The repo's own scripts: what the npm scripts name must exist, and nothing may wait for the handle of an engine no route mounts any more. */
const ROOT = path.resolve(import.meta.dirname, '../..')
const scriptFiles = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? scriptFiles(path.join(dir, e.name)) : /\.mjs$/.test(e.name) ? [path.join(dir, e.name)] : []))

test('every script the npm scripts name exists', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const missing = []
  for (const [name, command] of Object.entries(pkg.scripts)) for (const file of command.match(/\bscripts\/[\w./-]+\.(?:mjs|py)\b/g) ?? []) if (!fs.existsSync(path.join(ROOT, file))) missing.push(`${name}: ${file}`)
  assert.deepEqual(missing, [])
})

test('no script waits for window.__world: the in-React engine that set it is not mounted by any route (/world is the Archipelago player in an iframe)', () => {
  const stale = scriptFiles('scripts').filter((file) => /(?:window|globalThis)\.__world\b/.test(fs.readFileSync(path.join(ROOT, file), 'utf8')))
  assert.deepEqual(stale, [], 'a script that drives window.__world can only time out: port it to window.__archipelago or delete it')
})

