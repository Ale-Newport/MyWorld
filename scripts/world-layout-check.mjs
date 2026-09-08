/**
 * Layout conflicts, without a browser.
 *
 *   node scripts/world-layout-check.mjs [--all]
 *
 * Reads the same `src/content/world-layout.ts` the running world
 * reads, so a clean run here means the island has no two hard
 * footprints standing on the same ground.
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./_ts-loader.mjs', pathToFileURL('./scripts/'))

const { validateLayout, validateRespawns, zones } = await import('../src/content/world-layout.ts')

const ALL = process.argv.includes('--all')
const conflicts = validateLayout()
const respawnProblems = validateRespawns()

console.log(`\nWORLD LAYOUT — ${zones().length} footprints\n`)
console.log(`  conflicts: ${conflicts.length}`)
for (const c of (ALL ? conflicts : conflicts.slice(0, 40))) console.log(`    ${c.message}`)
if (!ALL && conflicts.length > 40) console.log(`    … and ${conflicts.length - 40} more (--all)`)

console.log(`\n  respawns: ${respawnProblems.length} problems`)
for (const p of respawnProblems) console.log(`    ${p}`)

console.log('')
process.exit(conflicts.length || respawnProblems.length ? 1 : 0)
