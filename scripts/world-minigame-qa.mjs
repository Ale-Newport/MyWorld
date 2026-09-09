/**
 * Every mini-game: start, play, reset, replay, leave, return, replay.
 *
 *   node scripts/world-minigame-qa.mjs [baseUrl] [--only=id,id]
 *
 * The brief's hardest requirement about mini-games is not that they are
 * fun — it is that none of them can trap the player, and that the third
 * attempt works as well as the first. So this does the whole cycle for
 * each one and asserts the HUD is clean afterwards, rather than
 * checking that a game can be started once.
 *
 * It drives through `window.__world`, which the Game exposes in
 * development only.
 */
import { chromium } from 'playwright'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const BASE = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000'
const ONLY = args.find((a) => a.startsWith('--only='))?.slice(7).split(',')
const OUT = path.resolve('.qa/minigames')
await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--disable-frame-rate-limit'],
})
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 180)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 180)) })

await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'ENTER')
  return b && !b.disabled
}, { timeout: 120000 })
await page.getByRole('button', { name: 'ENTER', exact: true }).click()
await page.waitForFunction(() => Boolean(window.__world?.minigames), { timeout: 60000 })
await page.waitForTimeout(2500)
await page.locator('canvas').click({ position: { x: 640, y: 640 } })

// `private items` is erased at runtime, and finding the registry by
// looking for the Map is what keeps this working if it is renamed.
const list = (await page.evaluate(() => {
  const m = window.__world.minigames
  for (const key of Object.keys(m)) {
    if (m[key] instanceof Map) return [...m[key].keys()]
  }
  return []
})).filter((id) => !ONLY || ONLY.includes(id))
if (!list.length) throw new Error('no mini-games found on window.__world.minigames')

const probe = () => page.evaluate(() => {
  const g = window.__world
  const s = g.store.getState()
  return {
    state: g.minigames.current?.state ?? null,
    currentId: g.minigames.current?.id ?? null,
    hud: s.minigame ? { id: s.minigame.id, title: s.minigame.title, lines: s.minigame.lines, hasResult: Boolean(s.minigame.result) } : null,
    overlay: s.overlay,
    playerState: g.player.state,
  }
})

/*
  Where each game is PLAYED, from the content rather than from the
  instance: `Minigame.origin` is only set once a game has been started,
  so asking the instance where to stand put the car at (0, 0) — eighty
  metres from the chess board — and the game cancelled itself for
  straying before the harness had looked at it. Passed in from Node,
  which can read `src/content` directly.
*/
const VENUES = JSON.parse(process.env.VENUES_JSON ?? '{}')

const startAt = (id) => page.evaluate(({ id, at }) => {
  const g = window.__world
  const game = g.minigames.get(id)
  if (!game) return { ok: false, why: 'not registered' }
  const spot = at ?? game.startPosition ?? null
  if (spot && (spot.x || spot.z)) {
    const y = g.terrain.colliderHeightAt(spot.x, spot.z) + 2
    g.vehicle.moveTo({ x: spot.x, y, z: spot.z }, 0)
    g.view.focusPoint.trackedPosition.set(spot.x, y, spot.z)
    g.view.snapToTarget()
  }
  return { ok: true }
}, { id, at: VENUES[id] ?? null })

const rows = []
for (const id of list) {
  const row = { id, start: false, running: false, cancel: false, hudCleared: false, replay: false, third: false, notes: [] }
  const before = errors.length

  await startAt(id)
  await page.waitForTimeout(500)

  for (const attempt of [1, 2, 3]) {
    if (attempt === 3) {
      // Leave and come back before the third go.
      await page.evaluate(() => {
        const g = window.__world
        const y = g.terrain.colliderHeightAt(18, 20) + 2
        g.vehicle.moveTo({ x: 18, y, z: 20 }, 0)
        g.view.focusPoint.trackedPosition.set(18, y, 20)
        g.view.snapToTarget()
      })
      await page.waitForTimeout(900)
      await startAt(id)
      await page.waitForTimeout(400)
    }
    const started = await page.evaluate((id) => window.__world.minigames.start(id), id)
    await page.waitForTimeout(1400)
    const during = await probe()
    const live = started && (during.state !== null && during.state !== 'idle')
    if (attempt === 1) { row.start = Boolean(started); row.running = live }
    if (attempt === 2) row.replay = live
    if (attempt === 3) row.third = live
    if (!live) row.notes.push(`attempt ${attempt} did not enter a playing state (state=${during.state})`)

    await page.evaluate(() => window.__world.minigames.cancel())
    await page.waitForTimeout(900)
    const after = await probe()
    if (attempt === 1) {
      row.cancel = after.state === null || after.state === 'idle'
      row.hudCleared = after.hud === null
      if (!row.hudCleared) row.notes.push(`HUD left behind after cancel: ${JSON.stringify(after.hud?.lines ?? after.hud)}`)
      if (after.playerState !== 'default') row.notes.push(`player left in state "${after.playerState}"`)
    } else if (after.hud !== null) {
      row.notes.push(`attempt ${attempt}: HUD left behind after cancel`)
    }
  }

  row.errors = errors.slice(before)
  rows.push(row)
  const ok = row.start && row.running && row.cancel && row.hudCleared && row.replay && row.third && !row.errors.length
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'}  ${id.padEnd(12)} ` +
    `start ${row.start ? 'y' : 'n'} · play ${row.running ? 'y' : 'n'} · exit ${row.cancel ? 'y' : 'n'} · ` +
    `hud clear ${row.hudCleared ? 'y' : 'n'} · 2nd ${row.replay ? 'y' : 'n'} · 3rd ${row.third ? 'y' : 'n'}` +
    (row.notes.length ? `\n          ${row.notes.join('\n          ')}` : '') +
    (row.errors.length ? `\n          errors: ${row.errors.slice(0, 2).join(' | ')}` : ''),
  )
}

await writeFile(path.join(OUT, 'minigames.json'), JSON.stringify(rows, null, 2))
const failed = rows.filter((r) => !(r.start && r.running && r.cancel && r.hudCleared && r.replay && r.third && !r.errors.length))
console.log(`\n${rows.length} mini-games · ${failed.length} failing${failed.length ? ': ' + failed.map((r) => r.id).join(', ') : ''}\n`)
await browser.close()
process.exit(failed.length ? 1 : 0)
