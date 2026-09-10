/**
 * What the decoration pass will actually build, without a browser.
 *
 *   node scripts/world-decor-check.mjs [--all]
 *
 * `src/content/world-decor.ts` holds no THREE import for exactly this
 * reason: the SHIPPED planner runs here, through the same
 * `blockedBy()` the world runs, so these are the island's numbers and
 * not a headless approximation of them.
 *
 * THE POINT OF IT IS THE REJECTION HISTOGRAM. `World.scatterProps`
 * made 270 attempts, landed 117 and discarded 153 in silence — all
 * seventeen of SOCIAL's props, every one of the landing's six balls —
 * and nobody found out for months, because nothing counted. A set that
 * lands a quarter of what it asked for is not a bug this can fix, but
 * it is one this refuses to hide.
 *
 * Four things are hard failures rather than reports:
 *   · a dynamic kind heavier than 12 kg, which stops a 2.5 kg car dead
 *   · a theme naming a kind that does not exist
 *   · a kind whose planned count exceeds what `Decor` will reserve
 *   · two placements closer together than they are wide
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./_ts-loader.mjs', pathToFileURL('./scripts/'))

const {
  planDecor, DECOR_KINDS, SHARED_KINDS, DECOR_THEMES,
  DECOR_LINE_BIOMES, DECOR_AREA_BIOMES, kindProfile,
} = await import('../src/content/world-decor.ts')

const ALL = process.argv.includes('--all')

/* The car is 2.5 kg. Above about 6 kg a prop reads as a wall and above
   12 it stops the car dead — this is the ceiling the whole brief hangs
   on, so it is asserted rather than trusted. */
const MASS_CEILING = 12
/* Two props whose footprints overlap wake each other every time one is
   nudged, and a pile of them never settles. The planner spaces on the
   sum of the two footprints, so anything below the smallest single
   footprint on the island means the `extra` self-avoidance is broken. */
const SPACING_FLOOR = 0.8

const plan = planDecor()
const failures = []

/* ---- masses ------------------------------------------------ */
const heavy = DECOR_KINDS.filter((k) => k.mass > MASS_CEILING)
for (const kind of heavy) {
  failures.push(`${kind.id} is ${kind.mass} kg — over the ${MASS_CEILING} kg ceiling for a 2.5 kg car`)
}

/* ---- every kind a theme names must exist ------------------- */
const known = new Set([...DECOR_KINDS.map((k) => k.id), ...SHARED_KINDS.map((k) => k.id)])
const named = new Set()
for (const theme of DECOR_THEMES) for (const entry of theme.entries) named.add(entry.kind)
for (const biome of [...DECOR_LINE_BIOMES, ...DECOR_AREA_BIOMES]) {
  for (const kind of biome.kinds) named.add(kind)
}
for (const kind of named) {
  if (!known.has(kind)) failures.push(`theme names unknown kind "${kind}"`)
}

/* ---- capacity ----------------------------------------------
   `Decor` reserves exactly `plan.capacity[kind]` on top of whatever is
   standing already, so this can only fail if the two ever disagree —
   which is precisely the failure worth catching, because in production
   `Props.add` returns null without a word. */
const planned = {}
for (const placement of plan.placements) {
  planned[placement.kind] = (planned[placement.kind] ?? 0) + 1
}
for (const [kind, count] of Object.entries(planned)) {
  if (count > (plan.capacity[kind] ?? 0)) {
    failures.push(`${kind}: ${count} placed against ${plan.capacity[kind] ?? 0} reserved`)
  }
}

if (plan.minSpacing < SPACING_FLOOR) {
  failures.push(`closest pair is ${plan.minSpacing.toFixed(2)} m apart, under the ${SPACING_FLOOR} m floor`)
}

/* ---- report ------------------------------------------------ */
const rate = (placed, attempted) => (attempted ? Math.round((placed / attempted) * 100) : 0)

const wanted = plan.themes.reduce((t, s) => t + s.wanted, 0)
console.log(`\nWORLD DECOR — ${plan.placed} placed of ${wanted} asked for (${rate(plan.placed, wanted)}%), ${plan.attempted} candidates tested\n`)

/*
  THE YIELD IS PLACED AGAINST WANTED, NOT AGAINST ATTEMPTED.

  Every base point gets up to twenty-two candidates before it is given
  up on, so `attempted` measures how hard the planner had to look and
  reads as 2-13% everywhere. `wanted` is the number of THINGS the
  manifest asked for, and placed-against-wanted is the number that
  answers "did this set arrive".
*/
const width = Math.max(...plan.themes.map((t) => t.id.length))
console.log(`  ${'theme'.padEnd(width)}   placed / asked  yield   tried   rejected by`)
for (const theme of plan.themes) {
  const reasons = Object.entries(theme.rejected)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${reason} ${n}`)
  const shown = ALL ? reasons : reasons.slice(0, 5)
  const tail = !ALL && reasons.length > 5 ? `, +${reasons.length - 5} more` : ''
  console.log(
    `  ${theme.id.padEnd(width)}  ${String(theme.placed).padStart(7)} / ${String(theme.wanted).padStart(5)}`
    + `  ${String(rate(theme.placed, theme.wanted)).padStart(4)}%  ${String(theme.attempted).padStart(6)}   ${shown.join(', ') || 'nothing'}${tail}`,
  )
  // A set that lands a quarter of what it asked for has been aimed at
  // ground that does not exist. Not a failure — the island is small
  // and its corridors are wide — but it is never what was meant, and
  // it is exactly the condition nobody could see before this printed.
  if (theme.wanted >= 12 && rate(theme.placed, theme.wanted) < 25) {
    console.log(`  ${' '.repeat(width)}  ^ under a quarter of the set arrived`)
  }
}

console.log(`\n  kinds (${Object.keys(plan.capacity).length} instanced meshes, one draw call each)\n`)
const kinds = Object.entries(plan.capacity).sort((a, b) => b[1] - a[1])
for (const [kind, count] of kinds) {
  const decor = DECOR_KINDS.find((k) => k.id === kind)
  const mass = decor ? `${decor.mass.toFixed(1)} kg` : 'shared kind'
  console.log(`    ${kind.padEnd(10)} ${String(count).padStart(4)}   ${mass.padStart(11)}   footprint ${kindProfile(kind).footprint.toFixed(2)} m`)
}

console.log(`\n  closest pair: ${plan.minSpacing.toFixed(2)} m`)
console.log(`  bodies added: ${plan.placed} (all dynamic, all placed asleep)`)

console.log(`\n  failures: ${failures.length}`)
for (const failure of failures) console.log(`    ${failure}`)

console.log('')
process.exit(failures.length ? 1 : 0)
