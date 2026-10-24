/* Runs any scripts/qa check against the SHIPPED SEED world instead of whatever the QA server has published.
     NODE_OPTIONS="--import=./scripts/qa/seed-world.mjs" node scripts/qa/world-spawn.mjs
   Why: the QA server's local database serves its own published revision, which at the time of writing has lost the Achievements
   plaza instance (see scripts/qa/world-plaza.mjs); the seed (public/archipelago/seed, named by src/server/world-seed.json) is what a
   fresh install serves and still has it. Every page a script opens gets /api/world/release answered with the seed's two files.
   With QA_PLAZA=before the plaza work is taken out as well (HEAD's Achievements.js, the working tree's world2-gameplay.js and
   world2-catalog.js minus the plaza's few lines): the same script, the same world, with and without it. */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'

const seed = JSON.parse(fs.readFileSync(path.resolve('src/server/world-seed.json'), 'utf8'))
const release = { revision: null, publishedAt: null, world: { url: seed.world.path, sha: seed.world.sha, size: seed.world.size }, assets: { url: seed.assets.path, sha: seed.assets.sha, size: seed.assets.size } }
const answer = (route) => route.fulfill({ json: release })

/** The three modules the plaza work touches, as they were before it (served in place of the working tree's). */
function before() {
  const preview = 'public/archipelago/preview'
  const working = (rel) => fs.readFileSync(path.resolve(preview, rel), 'utf8')
  const without = (text, pieces) => pieces.reduce((out, [from, to = '']) => { if (!out.includes(from)) throw new Error(`QA_PLAZA=before: cannot find ${from.slice(0, 60)}`); return out.replace(from, to) }, text)
  return {
    '**/portfolio/world2/interactions/Achievements.js': execFileSync('git', ['show', `HEAD:${preview}/portfolio/world2/interactions/Achievements.js`], { maxBuffer: 1 << 26 }).toString(),
    '**/world2-gameplay.js': without(working('world2-gameplay.js'), [
      [',plaza:true'], ['a.follow(manager.achievements);'],
      ['  // The document\'s own props around the Achievement plaza are re-seated for the fixed camera (player only; see AchievementsPlaza.adjustWorld).\n  for(const instance of this.instances)instance.parts.achievements?.plaza?.adjustWorld(root,physics,driving);\n'],
    ]),
    '**/world2-catalog.js': without(working('world2-catalog.js'), [
      ["\nimport {plazaArrival} from './portfolio/world2/interactions/PlazaLayout.js';"],
      ["const seat=entry.id==='achievements'?plazaArrival(entry.anchor,source.position[1]):source;const p=new THREE.Vector3(...seat.position)", 'const p=new THREE.Vector3(...source.position)'],
      ['Math.cos(seat.rotation),0,-Math.sin(seat.rotation)', 'Math.cos(source.rotation),0,-Math.sin(source.rotation)'],
    ]),
  }
}
const served = process.env.QA_PLAZA === 'before' ? before() : {}
const route = async (target) => {
  await target.route('**/api/world/release', answer)
  for (const [pattern, body] of Object.entries(served)) await target.route(pattern, (r) => r.fulfill({ contentType: 'text/javascript; charset=utf-8', body }))
}

const launch = chromium.launch.bind(chromium)
chromium.launch = async (...args) => {
  const browser = await launch(...args)
  const newPage = browser.newPage.bind(browser)
  browser.newPage = async (...options) => {
    const page = await newPage(...options)
    await route(page)
    return page
  }
  const newContext = browser.newContext.bind(browser)
  browser.newContext = async (...options) => {
    const context = await newContext(...options)
    await route(context)
    return context
  }
  return browser
}
