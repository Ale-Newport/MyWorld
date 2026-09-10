import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
register('./_ts-loader.mjs', pathToFileURL('./scripts/'))
const W = await import('../src/content/world.ts')
const E = await import('../src/content/world-environment.ts')
const out = {}
/* The landmarks that carry a `minigame` are the authored triggers:
   START / FINISH on the racing line, and the labyrinth's mouth on the
   maze's north face. The Labyrinth publishes no `startPosition`, so
   this table is the only thing that knows where to stand for it. */
for (const lm of W.landmarks) if (lm.minigame) out[lm.minigame] = { x: lm.x, z: lm.z }
/* Four spots: BOWLING, TNT, TIME MACHINE, BLACK HOLE. Two are places
   rather than games; `tnt` also carries `game: 'domino'`, the challenge
   played at the stack. The line this replaces read
   `districtById.labyrinth`, which is `undefined` on the drawn island —
   the district is `maze` — so this file threw before it printed. */
for (const spot of E.PLAY_SPOTS) {
  /* A spot is a venue ORIGIN, not a drive-up, and for BOWLING the two
     are 34 m apart: the origin is the pin deck. Standing on it puts the
     harness car among the pins. Where a spot levels a rectangular `pad`
     the far end of that pad from the origin is the apron you arrive on,
     which is the one point on the venue a player ever starts from. */
  let { x, z } = spot
  if (spot.pad) {
    const axis = { x: Math.cos(spot.pad.rotation), z: Math.sin(spot.pad.rotation) }
    const off = (spot.x - spot.pad.x) * axis.x + (spot.z - spot.pad.z) * axis.z
    // Only where the origin actually sits at one END of its pad. The
    // TNT spot is its pad's own centre, and stepping away from a centre
    // has no direction to choose: the rule put the car five metres into
    // the middle of the crate stack.
    if (Math.abs(off) > 4) {
      // Eight metres inside the far lip, so the car is on levelled ground.
      const along = -Math.sign(off) * (spot.pad.length / 2 - 8)
      x = spot.pad.x + axis.x * along
      z = spot.pad.z + axis.z * along
    }
  }
  out[spot.id] = { x, z }
  if ('game' in spot) out[spot.game] = { x, z }
}
console.log(JSON.stringify(out))
