/* CPU profile of one cold /world runtime start (standalone), with inclusive time per startup stage.

     QA_BASE=http://127.0.0.1:3262 node scripts/qa/world-startup-profile.mjs --label before

   Writes .qa/runs/impl/startup/profile-<label>.json (the raw V8 profile) and prints the inclusive milliseconds of
   the stages and hot functions the startup work targets, plus self time by file. */
import fs from 'node:fs'
import path from 'node:path'
import { launch, BASE } from './lib.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback }
const LABEL = arg('label', 'run'), OUT = path.resolve(arg('out', '.qa/runs/impl/startup'))
const WATCH = ['buildWorldMap', 'createRoad', 'rebuildRoadNetwork', 'planarBoolean', 'curatedLibrary', 'prefab', 'authoringPreview', 'buildAssets', 'updatePrefabTerrain', 'rebuildSurfaces', 'updateTerrainShoreline',
  'restore', 'initializeAssets', 'enterDrive', 'startSimulation', 'setupPhysics', 'buildPhysics', 'Driving', 'resume', 'mapTerrain', 'batch', 'presentable', 'compileAsync', 'initTexture', 'loadWorld2Catalog', 'finishOcean', 'init', 'parseAsync']
const browser = await launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
const cdp = await page.context().newCDPSession(page)
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start')
await page.goto(BASE + '/archipelago/preview/index.html')
await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 300_000, polling: 100 })
const { profile } = await cdp.send('Profiler.stop')
await browser.close()
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, `profile-${LABEL}.json`), JSON.stringify(profile))
const nodes = new Map(profile.nodes.map((n) => [n.id, n])), self = new Map()
for (let i = 0; i < profile.samples.length; i++) self.set(profile.samples[i], (self.get(profile.samples[i]) ?? 0) + profile.timeDeltas[i] / 1000)
const byName = new Map(), byFile = new Map()
const walk = (id, stack) => {
  const n = nodes.get(id), name = n.callFrame.functionName || '(anon)'
  let total = self.get(id) ?? 0
  const first = !stack.has(name); if (first) stack.add(name)
  for (const c of n.children ?? []) total += walk(c, stack)
  if (first) { stack.delete(name); byName.set(name, (byName.get(name) ?? 0) + total) }
  const file = n.callFrame.url.split('/').slice(-2).join('/') || n.callFrame.functionName
  byFile.set(file, (byFile.get(file) ?? 0) + (self.get(id) ?? 0))
  return total
}
const total = walk(profile.nodes[0].id, new Set())
const stages = Object.fromEntries(WATCH.map((w) => [w, Math.round(byName.get(w) ?? 0)]))
const files = [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([f, ms]) => [f, Math.round(ms)])
console.log(JSON.stringify({ label: LABEL, profileMs: Math.round(total), idleMs: Math.round(byName.get('(idle)') ?? 0), gcMs: Math.round(byName.get('(garbage collector)') ?? 0), inclusiveMs: stages, selfByFile: files }, null, 1))
