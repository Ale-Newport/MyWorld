/**
 * Two regressions, one browser.
 *
 *   node scripts/world-achievement-checks.mjs [baseUrl]
 *
 * 1. Loading/settling props is not a player achievement. CLEAN SWEEP
 *    counts cones the visitor knocked over, so a world that has just
 *    finished dropping its props onto the ground must score zero.
 * 2. A save file written by EITHER older schema still loads through the
 *    whole chain. The blob is version 3 now, with a 1 → 2 fix-up that
 *    builds the race board out of the old bare list of times and a
 *    2 → 3 migration that strips the nine districts, eight mini-games,
 *    archive ring and waterfall the redrawn island does not have.
 *    `coerce` used to discard any blob whose version did not match, so
 *    the thing being proved here is that it no longer does: the visitor
 *    has no account, and their save file is the only copy of everything
 *    they have done.
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'

const base = process.argv[2] ?? 'http://localhost:3001', KEY = 'alejandro-world-save-v1'
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] })
const errors = [], results = []
const record = (name, ok, detail = {}) => {
  results.push({ name, ok, ...detail })
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${Object.keys(detail).length ? ` — ${JSON.stringify(detail)}` : ''}`)
}
/** Boots /world with `blob` already in storage. Each fixture gets its own
 *  context: `addInitScript` is per-context, and two saves in one profile
 *  would test whichever the second boot happened to overwrite. */
const boot = async blob => {
  const context = await browser.newContext(), page = await context.newPage()
  page.on('pageerror', error => errors.push(String(error)))
  await page.addInitScript(([key, text]) => localStorage.setItem(key, text), [KEY, JSON.stringify(blob)])
  await page.goto(`${base}/world`)
  await page.getByRole('button', { name: 'ENTER', exact: true }).click({ timeout: 120000 })
  await page.waitForFunction(() => window.__world?.player?.state === 'default')
  return { context, page }
}

/* ============================================================
   VERSION 1 — and the cones

   Kept as a version-1 blob on purpose: this is the oldest thing a
   returning visitor can be carrying, and it has to survive two
   migrations in a row. `raceHistory` is the pre-leaderboard list of
   times, `chess` a mini-game that left with its district, `hub` a
   district that did.
   ============================================================ */

const { context: firstContext, page } = await boot({
  version: 1,
  settings: { quality: 'medium', onboarded: true, muted: true },
  progress: {
    raceHistory: [132.5, 118.9],
    districts: ['hub', 'landing'],
    bestTimes: { chess: 12.5, circuit: 118.9 },
  },
})
await page.waitForTimeout(3500)
const v1 = await page.evaluate(() => {
  const p = window.__world.save.data
  return { version: p.version, settings: p.settings, districts: p.progress.districts, bestTimes: p.progress.bestTimes, raceBoard: p.progress.raceBoard }
})
record('a version-1 blob is migrated, not discarded', v1.version === 3 && v1.settings.quality === 'medium' && v1.settings.muted && v1.settings.onboarded, { version: v1.version, quality: v1.settings.quality })
record('1 → 2 builds the race board from the bare list of times', v1.raceBoard.length === 2 && v1.raceBoard[0].time === 118.9 && v1.raceBoard[0].at === 0, { raceBoard: v1.raceBoard })
record('2 → 3 drops the dead district and keeps the live one', !v1.districts.includes('hub') && v1.districts.includes('landing'), { districts: v1.districts })
record('2 → 3 drops the dead best time and keeps the circuit', !('chess' in v1.bestTimes) && v1.bestTimes.circuit === 118.9, { bestTimes: v1.bestTimes })

const score = () => page.evaluate(() => ({
  cones: window.__world.achievements.progressOf('cones'),
  unlocked: window.__world.achievements.isUnlocked('cones'),
}))
const idle = await score()
console.log('idle', idle)
const cones = await page.evaluate(() => window.__world.world.props.tagged('cones').slice(0, 25).map(c => c.index))
for (const index of cones) {
  await page.evaluate(index => {
    const g = window.__world, cone = g.world.props.tagged('cones').find(c => c.index === index)
    const at = cone.physical.current.position, x = at.x - 7, z = at.z
    g.vehicle.moveTo({ x, y: g.terrain.colliderHeightAt(x, z) + 2, z }, 0)
  }, index)
  await page.waitForTimeout(600)
  await page.keyboard.down('KeyW'); await page.waitForTimeout(950); await page.keyboard.up('KeyW')
  await page.keyboard.down('KeyB'); await page.waitForTimeout(300); await page.keyboard.up('KeyB')
}
const driven = await score()
console.log('driven', driven)
record('settling props score nothing; driving into them scores', idle.cones === 0 && !idle.unlocked && driven.unlocked, { idle, driven })
await firstContext.close()

/* ============================================================
   VERSION 2 — the island that was redrawn out from under it

   Every id in `progress` below was real on the old island and is
   gone from this one. The engine ignores ids it does not recognise,
   which is why none of this crashes — but "ignores" is not good
   enough: EXPLORER counts unique district ids, so thirteen dead ones
   satisfy the new target of eight without the visitor entering a
   single place that still exists, and ARCHIVIST counts landmarks the
   archive ring alone would finish from open water.
   ============================================================ */

const { context: secondContext, page: second } = await boot({
  version: 2,
  settings: { quality: 'low', onboarded: true, muted: true, volume: 0.3 },
  progress: {
    achievements: {
      explorer: ['hub', 'chess', 'kcl', 'landing', 'bowling'],
      notes: ['note-1', 'note-99'],
      archivist: ['archive-ring-3', 'projects-terminal'],
      // A whole award whose trigger left with its district.
      pipeline: 3,
      firstDrive: 1,
    },
    districts: ['hub', 'chess', 'kcl', 'clientCity', 'landing', 'bowling'],
    landmarks: ['hub-name', 'archive-ring-3', 'landing-welcome', 'play-bowling'],
    notes: ['note-1', 'note-99'],
    secrets: ['waterfall', 'voidIsland', 'blackHole'],
    bestTimes: { circuit: 118.4, chess: 42, orderRush: 9.5, bowling: 61 },
    completedGames: ['circuit', 'pipeline', 'riverRun'],
    raceBoard: [{ time: 118.4, at: 1710000000000 }, { time: 131, at: 1709000000000 }],
    distanceDriven: 4321, timePlayed: 900,
    lastRespawn: 'chess',
  },
})
await second.waitForTimeout(1500)
const v2 = await second.evaluate(() => {
  const d = window.__world.save.data
  return { version: d.version, settings: d.settings, ...d.progress }
})
await secondContext.close()

/* The engine ADDS to a save as soon as it runs — entering the LANDING
   files a district and an EXPLORER id — so every assertion below is
   about presence and absence, never about an exact array. An equality
   test here would fail for the one reason that is not a defect. */
const gone = (list, ...ids) => ids.every(id => !list.includes(id))
record('settings survive the migration untouched', v2.version === 3 && v2.settings.quality === 'low' && v2.settings.volume === 0.3 && v2.settings.muted && v2.settings.onboarded, { version: v2.version, settings: v2.settings })
record('removed districts are dropped, live ones kept', gone(v2.districts, 'hub', 'chess', 'kcl', 'clientCity') && v2.districts.includes('landing') && v2.districts.includes('bowling'), { districts: v2.districts })
/* The stored array IS the progress for a set-typed award, so each one
   is filtered against the same inventory its counter is fed from. */
record('set-typed awards stop counting things that do not exist', gone(v2.achievements.explorer, 'hub', 'chess', 'kcl') && v2.achievements.explorer.includes('landing') && gone(v2.achievements.archivist, 'archive-ring-3') && v2.achievements.archivist.includes('projects-terminal'), { explorer: v2.achievements.explorer, archivist: v2.achievements.archivist })
record('removed mini-games lose their best times', gone(Object.keys(v2.bestTimes), 'chess', 'orderRush') && v2.bestTimes.circuit === 118.4 && v2.bestTimes.bowling === 61, { bestTimes: v2.bestTimes })
record('removed mini-games lose their completion flags', gone(v2.completedGames, 'pipeline', 'riverRun') && v2.completedGames.includes('circuit'), { completedGames: v2.completedGames })
record('race times are kept in full', v2.raceBoard.length === 2 && v2.raceBoard[0].time === 118.4 && v2.raceBoard[0].at === 1710000000000, { raceBoard: v2.raceBoard })
record('distance and time played are kept', v2.distanceDriven === 4321 && v2.timePlayed >= 900, { distanceDriven: v2.distanceDriven, timePlayed: v2.timePlayed })
record('landmarks and notes that are gone are dropped', gone(v2.landmarks, 'hub-name', 'archive-ring-3') && v2.landmarks.includes('landing-welcome') && v2.landmarks.includes('play-bowling') && gone(v2.notes, 'note-99') && v2.notes.includes('note-1'), { landmarks: v2.landmarks, notes: v2.notes })
record('secrets that are gone are dropped', gone(v2.secrets, 'waterfall', 'voidIsland') && v2.secrets.includes('blackHole'), { secrets: v2.secrets })
record('awards whose trigger left are deleted, live ones kept', !('pipeline' in v2.achievements) && v2.achievements.firstDrive === 1, { achievements: Object.keys(v2.achievements) })
/* A stored respawn is a PLACE to a visitor, and half the named places
   on the old island are open water on this one. Anything that is not
   still a respawn point goes back to the landing rather than putting a
   returning car down in the sea. */
record('a respawn that is now open water falls back to the landing', v2.lastRespawn === 'landing', { lastRespawn: v2.lastRespawn })

const ok = results.every(r => r.ok) && !errors.length
await mkdir('.qa/achievements', { recursive: true })
await writeFile('.qa/achievements/results.json', JSON.stringify({ ok, results, errors }, null, 2))
await browser.close()
console.log(`\n${results.filter(r => !r.ok).length} failing of ${results.length}${errors.length ? `, ${errors.length} page errors` : ''}\n`)
process.exitCode = ok ? 0 : 1
