import * as THREE from 'three'
import type { Game } from '../../Game'
import type { Bin } from '../../core/Disposal'
import { dress } from '../kit'
import { dressLanding } from './landing'
import { dressSocial } from './social'
import { dressProjects } from './projects'
import { dressAchievements } from './achievements'
import { dressTimeMachine } from './timeMachine'
import { dressBlackHole } from './blackHole'
import { dressTnt } from './tnt'

/* ============================================================
   SET DRESSING

   Seven districts' worth of silhouettes: the things that make a
   place recognisable from thirty metres without reading a word.
   The other three dress themselves, because their dressing has to
   know venue-local coordinates this layer cannot supply —
   `CircuitRace` builds the grandstand, the tyre walls and the pit
   boxes, `Bowling` the pin totems and the screen gantry, and
   `Labyrinth` the hedge facing, the obelisks and the fountain.

   THE SEEDS ARE ARBITRARY AND FIXED. Each district's scatter is
   seeded so that a reload does not move the bunting, and each has
   its own so that adding a district does not reshuffle its
   neighbours.
   ============================================================ */

const DISTRICTS = [
  { seed: 0x1a4d17, build: dressLanding },
  { seed: 0x50c1a1, build: dressSocial },
  { seed: 0x9c0de5, build: dressProjects },
  { seed: 0x7409f7, build: dressAchievements },
  { seed: 0xc10c4b, build: dressTimeMachine },
  { seed: 0x0be15e, build: dressBlackHole },
  { seed: 0xdeb115, build: dressTnt },
] as const

/**
 * Builds every district's dressing into one group.
 *
 * Called from `Game.init` after the scenery details, so it can see
 * the furniture it must not stand in. `dress()` catches a builder
 * that throws, so one district's mistake costs that district and
 * nothing else.
 */
export function buildDressing(game: Game, bin: Bin): THREE.Group {
  const root = new THREE.Group()
  root.name = 'dressing'
  game.renderer.scene.add(root)
  bin.object3D(root)
  for (const district of DISTRICTS) dress(game, bin, root, district.seed, district.build)
  return root
}
