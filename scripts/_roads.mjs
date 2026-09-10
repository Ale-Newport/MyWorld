/**
 * The carriageway table, for the harnesses that walk or drive it.
 *
 *   ROADS_JSON=$(node scripts/_roads.mjs) node scripts/world-loop-drive.mjs
 *
 * `roads` is derived from `PATHS` in `world-map.ts` — the drawing's
 * brown tracks — so this emits whatever the plan currently says, ids
 * hyphenated and `surface: 'dirt'` included. Thirteen of them on the
 * traced island; there is no ring road any more.
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
register('./_ts-loader.mjs', pathToFileURL('./scripts/'))
const W = await import('../src/content/world.ts')
// Loudly, not quietly. A consumer handed `[]` walks no carriageways,
// finds no obstructions and prints a pass — which is the exact failure
// this pass exists to end: a harness that measures nothing and says so
// in the language of success.
if (!Array.isArray(W.roads) || W.roads.length === 0) throw new Error('[_roads] world.ts exports no roads')
for (const r of W.roads) {
  if (!r.points || r.points.length < 2) throw new Error(`[_roads] road "${r.id}" has fewer than two points`)
}
console.log(JSON.stringify(W.roads))
