import * as THREE from 'three'
import { textPlane, type Dressing } from '../kit'
import { palette } from '../../core/palette'
import { chamferedBox, extrudeOutline, rampGeometry } from '../geometry'
import { textGeometry } from '../Type3D'
import { mergeParts } from '../decorGeometry'
import { achievementGroups } from '@/content/achievements'
import { isFree } from '@/content/world-layout'
import type { MaterialName } from '../materials'

/* ============================================================
   ACHIEVEMENTS — THE PODIUM YARD

   The district is a star on a plinth and a ring on the ground, and
   from thirty metres that is indistinguishable from the time
   machine, which until this morning also wore #c8922f. What makes
   a trophy plaza a trophy plaza is the FURNITURE OF WINNING: a
   podium, a wall of rosettes, a laurel arch you drive under, and
   four cans throwing light at the thing on the plinth.

   THE ONE PLACE IN THE WORLD WHERE PROGRESS CHANGES GEOMETRY.
   Six medal posts, one per `achievementGroups` entry, hang a disc
   in `concreteDark` until every achievement in that group is
   unlocked and in `emissiveAmber` afterwards. Everything else in
   the portfolio reports progress in an overlay; this reports it in
   the world, so a returning visitor can see from the road how much
   of the island they have finished.

   THE COST. Eight merge buckets (concrete, ink, chalk, metal,
   accent, emissiveAmber, hedge, foliageLight), one translucent
   mesh for the four spotlight beams, two for the medals and one
   label: twelve draw calls for sixty pieces. The medals are two
   MERGED meshes rebuilt on unlock rather than six meshes with a
   swappable material, because six discs are not worth six draw
   calls and an unlock happens a handful of times in a session.
   Every piece of wording that CAN be solid letters is — a
   `textGeometry` run joins a bucket and costs nothing, where a
   `textPlane` is a canvas, a texture, a material and a sorted
   transparent draw call each.

   COLLIDERS ONLY WHERE THE CAR SHOULD STOP: the podium slabs and
   their wedges (you are meant to drive up them), the wall panels,
   the arch's two feet, the leaderboard posts and the low plinths.
   Not the arch's crown, not the 2.3 m medal masts, not the board
   4.7 m up, and not one of the twenty-eight star decals.
   ============================================================ */

/** Three.js yaws the other way round from a compass bearing: a Y
 *  rotation of θ sends local +X to (cos θ, 0, −sin θ). Everything
 *  here is authored as a bearing and converted once, because a lost
 *  minus sign is a rosette wall facing the sea. */
const yaw = (bearing: number): number => -bearing

/** The trophy's star sits at 6.6 m — `buildTrophy` in `Landmarks.ts`.
 *  Four spotlights aim at that number, so it lives here once. */
const STAR_HEIGHT = 6.6

/** A five-pointed outline at unit radius, for the ground decals. */
const STAR_OUTLINE: [number, number][] = Array.from({ length: 10 }, (_, i) => {
  const angle = (i / 10) * Math.PI * 2 - Math.PI / 2
  const radius = i % 2 === 0 ? 1 : 0.42
  return [Math.cos(angle) * radius, Math.sin(angle) * radius]
})

export function dressAchievements(kit: Dressing): void {
  const yard = kit.district('achievements')
  const home = kit.district('landing')
  const { materials, physics, quality, achievements } = kit.game
  const shadows = quality.settings.shadows

  const centreY = kit.groundAt(yard.x, yard.z)

  const at = (bearing: number, distance: number) => ({
    x: yard.x + Math.cos(bearing) * distance,
    z: yard.z + Math.sin(bearing) * distance,
  })

  /** `kit.free` is `isFree` with nothing allowed, and a district PLATE
   *  is a HARD zone — so it rejects the eleven metres of paving this
   *  whole yard is for. `SceneryDetails.usable` hits the same wall and
   *  answers it the same way: allow the plate, the landmark being
   *  dressed and the play disc, and leave every road, ramp and circuit
   *  margin exactly where it was. What this still catches — and the
   *  only thing it needs to — is a road. */
  const usable = (x: number, z: number, clearance: number): boolean =>
    isFree(x, z, {
      clearance,
      allow: ['plate', 'landmark', 'play'],
      margin: { circuit: 5, ramp: 6, water: 1.5 },
    })

  /* The yard faces the way visitors arrive from, which is the landing
     — derived, so the podium still greets the road after the next time
     the island is rescaled.

     THEN IT TURNS UNTIL IT IS NOT IN THE ROAD. That approach is also
     where the road to this district arrives, and a three-tier podium
     with a collider standing in a carriageway is precisely what
     `world:clearance` exists to fail on. The whole yard rotates
     together, so the alternative to a free axis is a deleted podium
     rather than a moved one. */
  const preferred = Math.atan2(home.z - yard.z, home.x - yard.x)
  const facing = ([0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2] as const)
    .map((step) => preferred + step)
    .find((bearing) => [5, 9, 13, 15.8].every((d) => {
      const p = at(bearing, d)
      return usable(p.x, p.z, 2.4)
    })) ?? preferred

  /** A chamfered box straight into a merge bucket. No collider and no
   *  mesh of its own: `solidBox` gives both, and this yard is sixty
   *  boxes. */
  const piece = (
    material: MaterialName,
    p: { x: number; z: number }, y: number,
    w: number, h: number, d: number, bearing = facing, chamfer = 0.07,
  ): void => {
    const g = chamferedBox(w, h, d, chamfer)
    g.rotateY(yaw(bearing))
    g.translate(p.x, y, p.z)
    kit.add(material, g)
  }

  /** The collider half, on its own, for the things that should stop a
   *  2.5 kg car. Never taller and never wider than what you can see. */
  const blocker = (
    p: { x: number; z: number }, y: number,
    w: number, h: number, d: number, bearing = facing,
  ): void => {
    physics.add({
      type: 'fixed', category: 'floor',
      position: { x: p.x, y, z: p.z },
      rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw(bearing), 0)),
      friction: 0.7, restitution: 0.12,
      colliders: [{ shape: 'cuboid', parameters: [w / 2, h / 2, d / 2] }],
    })
  }

  /* ---- 1. THE PODIUM, AND YOU CAN DRIVE UP IT --------------

     Three tiers at 0.42 m a step. The car's wheels are 0.35 m, so a
     stack of bare slabs is three kerbs you bounce off; each tier
     therefore carries its own 3.2 m wedge, and the wedge and its
     collider are the same eight points because `rampGeometry` hands
     back both. The top deck ends at 2.6 m from the centre, which is
     where the trophy's own 4.6 m plinth begins: you park against the
     star rather than inside it. */
  const RISE = 0.42
  for (let tier = 0; tier < 3; tier++) {
    const deck = centreY + RISE * (tier + 1)
    const distance = 11.6 - tier * 3.6
    const width = 7.4 - tier * 1.2
    const slab = at(facing, distance)
    // The podium is one poured object and its decks are levelled off
    // the plate, not off the terrain under each slab — three tiers
    // each following the ground is three tiers at three angles. The
    // skirt reaches below whichever is lower so nothing floats where
    // the outer tier runs off the 11 m plate.
    const under = Math.min(centreY, kit.groundAt(slab.x, slab.z)) - 0.35
    piece('concrete', slab, (deck + under) / 2, 3.6, deck - under, width, facing, 0.12)
    blocker(slab, (deck + under) / 2, 3.6, deck - under, width)
    // A bright nosing on the lip: a flat-shaded pale slab in permanent
    // noon has no visible edge at all from the driving camera.
    piece('emissiveAmber', at(facing, distance - 1.74), deck - 0.05, 0.22, 0.1, width)

    const foot = at(facing, distance + 3.1)
    const footY = tier === 0 ? kit.groundAt(foot.x, foot.z) : centreY + RISE * tier
    // Height is measured, not assumed: the entry wedge has to bridge
    // whatever the terrain does where it lands, and the two inner ones
    // rise exactly one step.
    const ramp = rampGeometry(3.2, width * 0.62, Math.max(0.18, deck - footY))
    // Rising along +X towards the centre, so the approach is from
    // outside and the climb ends on the tier's own deck.
    ramp.geometry.rotateY(yaw(facing + Math.PI))
    ramp.geometry.translate(foot.x, footY, foot.z)
    kit.add('concrete', ramp.geometry)
    physics.add({
      type: 'fixed', category: 'floor',
      position: { x: foot.x, y: footY, z: foot.z },
      rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw(facing + Math.PI), 0)),
      friction: 0.7, restitution: 0.12,
      colliders: [{ shape: 'hull', parameters: [ramp.hull] }],
    })
  }

  /* ---- 2. THE ROSETTE WALL ---------------------------------
     Behind the star, so it backs the trophy in every photograph the
     driving camera takes of it. Three faceted panels on an arc rather
     than one curved wall: a chamfered box merges, a curve does not,
     and three flat faces read as a wall from anywhere in the yard. */
  const back = facing + Math.PI
  for (let panel = 0; panel < 3; panel++) {
    const bearing = back + (panel - 1) * 0.33
    const p = at(bearing, 11.5)
    const base = kit.groundAt(p.x, p.z)
    piece('concrete', p, base + 1.45, 0.55, 2.9, 4.0, bearing, 0.1)
    blocker(p, base + 1.45, 0.55, 2.9, 4.0, bearing)

    // Rosettes on the inward face. A RingGeometry's normal is +Z, and
    // +Z is sent to the yard's centre by yaw(bearing) − π/2.
    for (let i = 0; i < 8; i++) {
      const across = ((i % 4) - 1.5) * 0.92
      const up = 1.85 - Math.floor(i / 4) * 0.86
      const face = {
        x: p.x - Math.cos(bearing) * 0.32 - Math.sin(bearing) * across,
        z: p.z - Math.sin(bearing) * 0.32 + Math.cos(bearing) * across,
      }
      const ring = new THREE.RingGeometry(0.26, 0.4, 12)
      ring.rotateY(yaw(bearing) - Math.PI / 2)
      ring.translate(face.x, base + up, face.z)
      kit.add('emissiveAmber', ring)
      // Two ribbon tails, the district's one hit of vermilion.
      for (const side of [-1, 1]) {
        const tail = {
          x: face.x - Math.sin(bearing) * side * 0.13,
          z: face.z + Math.cos(bearing) * side * 0.13,
        }
        piece('accent', tail, base + up - 0.62, 0.06, 0.5, 0.14, bearing)
      }
    }
  }

  /* ---- 3. THE MEDAL POSTS ----------------------------------
     One per achievement group, in a row down the yard's east flank.
     The plinth stops the car at 0.5 m; the 2.3 m mast does not, so a
     wide line through the plaza clips nothing it cannot see. */
  const medalShapes: { group: string; geometry: THREE.BufferGeometry }[] = []
  achievementGroups.forEach((group, i) => {
    // 1.05 to 2.35 rad off the approach: clear of the podium corridor
    // on one side and of the rosette wall's 2.81 rad on the other.
    const bearing = facing + 1.05 + i * 0.26
    const p = at(bearing, 9.2)
    const base = kit.groundAt(p.x, p.z)

    piece('concrete', p, base + 0.25, 1.0, 0.5, 1.0, bearing, 0.09)
    blocker(p, base + 0.25, 1.0, 0.5, 1.0, bearing)
    piece('metal', p, base + 1.4, 0.2, 2.3, 0.2, bearing)
    piece('accent', p, base + 2.06, 0.14, 0.62, 0.06, bearing)

    // The group's name in solid letters on the plinth's inward face —
    // one geometry into the ink bucket, so naming six posts costs no
    // draw call at all where six `textPlane`s would cost six.
    const name = textGeometry(group.label, { size: 0.24, weight: 0.17, depth: 0.05 })
    name.geometry.rotateY(yaw(bearing) - Math.PI / 2)
    name.geometry.translate(
      p.x - Math.cos(bearing) * 0.53,
      base + 0.14,
      p.z - Math.sin(bearing) * 0.53,
    )
    kit.add('ink', name.geometry)

    // The disc itself is held back — it belongs to whichever of the
    // two state meshes is rebuilt below.
    const disc = new THREE.CylinderGeometry(0.5, 0.5, 0.1, 20)
    disc.rotateZ(Math.PI / 2)
    disc.rotateY(yaw(bearing))
    disc.translate(p.x, base + 1.62, p.z)
    medalShapes.push({ group: group.id, geometry: disc })
  })

  const dull = new THREE.Mesh(new THREE.BufferGeometry(), materials.get('concreteDark'))
  const won = new THREE.Mesh(new THREE.BufferGeometry(), materials.get('emissiveAmber'))
  dull.castShadow = shadows
  won.castShadow = shadows
  kit.group.add(dull, won)

  /** A group is won when every achievement filed under it is. */
  const complete = (id: string): boolean => {
    for (const state of achievements.groups.values()) {
      if (state.definition.group === id && !state.unlocked) return false
    }
    return true
  }

  const refreshMedals = (): void => {
    const lit: THREE.BufferGeometry[] = []
    const cold: THREE.BufferGeometry[] = []
    // Clones, because `mergeParts` disposes what it is handed and the
    // masters have to survive every later rebuild.
    for (const medal of medalShapes) {
      (complete(medal.group) ? lit : cold).push(medal.geometry.clone())
    }
    dull.geometry.dispose()
    won.geometry.dispose()
    dull.geometry = mergeParts(cold)
    won.geometry = mergeParts(lit)
  }
  refreshMedals()

  achievements.events.on('unlock', refreshMedals)
  kit.bin.add(() => {
    achievements.events.off('unlock', refreshMedals)
    for (const medal of medalShapes) medal.geometry.dispose()
    dull.geometry.dispose()
    won.geometry.dispose()
  })

  /* ---- 4. THE LAUREL ARCH ----------------------------------
     Over the approach, 4.2 m to the crown and 8.4 m between the feet.
     Feet collide, crown does not: a full-height collider on an arch
     is an invisible wall to anyone taking a wide line into the yard,
     which is the exact failure `buildBillboard` refuses to repeat. */
  const gate = at(facing, 15.8)
  const gateY = kit.groundAt(gate.x, gate.z)
  const arch = new THREE.TorusGeometry(4.2, 0.26, 6, 20, Math.PI)
  arch.rotateY(yaw(facing + Math.PI / 2))
  arch.translate(gate.x, gateY, gate.z)
  kit.add('hedge', arch)
  for (const side of [-1, 1]) {
    const foot = {
      x: gate.x - Math.sin(facing) * side * 4.2,
      z: gate.z + Math.cos(facing) * side * 4.2,
    }
    piece('concrete', foot, gateY + 0.45, 1.0, 0.9, 1.0, facing, 0.1)
    blocker(foot, gateY + 0.5, 0.9, 1.0, 0.9)
  }
  const leaves = quality.count(40, 16)
  for (let i = 0; i < leaves; i++) {
    const along = (i / leaves) * Math.PI
    const leaf = new THREE.IcosahedronGeometry(0.26 + kit.rand() * 0.14, 0)
    const radius = 4.2 + (kit.rand() - 0.5) * 0.5
    leaf.translate(
      gate.x - Math.sin(facing) * Math.cos(along) * radius,
      gateY + Math.sin(along) * radius,
      gate.z + Math.cos(facing) * Math.cos(along) * radius,
    )
    kit.add('foliageLight', leaf)
  }

  /* ---- 5. THE STAR FIELD -----------------------------------
     Flat decals in the annulus between the podium and the plate's
     edge. Decoration, so the count follows `quality.count`; no
     colliders, so the tier a phone plays on is the same game. */
  const stars = quality.count(28, 10)
  for (let i = 0; i < stars; i++) {
    const bearing = kit.rand() * Math.PI * 2
    const distance = 7.6 + kit.rand() * 7.6
    // The podium corridor is where the car goes; stars under a tier
    // are stars nobody sees.
    if (Math.abs(Math.atan2(Math.sin(bearing - facing), Math.cos(bearing - facing))) < 0.4) continue
    const p = at(bearing, distance)
    if (!usable(p.x, p.z, 1.0)) continue
    const star = extrudeOutline(
      STAR_OUTLINE.map(([x, y]): [number, number] => [x * 0.36, y * 0.36]), 0.1,
    )
    star.rotateX(-Math.PI / 2)
    star.rotateY(kit.rand() * Math.PI * 2)
    star.translate(p.x, kit.groundAt(p.x, p.z) + 0.06, p.z)
    kit.add('emissiveAmber', star)
  }

  /* ---- 6. SPOTLIGHT CANS, AND THE ONLY LEGAL BEAM ----------
     There are two lights in this world and adding a third recompiles
     every lit material for a fixture that would be invisible at noon
     anyway. So a spotlight here is a dark can, an unlit disc for its
     face, and an open cone at 12 % opacity standing in for the light
     — the idiom `Lighting.ts` spells out. All four beams merge into
     one mesh, because four cones are not worth four draw calls. */
  const target = new THREE.Vector3(yard.x, centreY + STAR_HEIGHT, yard.z)
  const beams: THREE.BufferGeometry[] = []
  const aim = new THREE.Quaternion()
  const down = new THREE.Vector3(0, -1, 0)
  for (const offset of [0.95, -0.95, 2.5, -2.5]) {
    const bearing = facing + offset
    const p = at(bearing, 14.2)
    const base = kit.groundAt(p.x, p.z)
    piece('concrete', p, base + 0.18, 1.0, 0.36, 1.0, bearing, 0.08)
    blocker(p, base + 0.18, 1.0, 0.4, 1.0, bearing)
    piece('metal', p, base + 0.95, 0.14, 1.2, 0.14, bearing)

    const mouth = new THREE.Vector3(p.x, base + 1.7, p.z)
    const direction = target.clone().sub(mouth).normalize()
    aim.setFromUnitVectors(down, direction)

    const can = new THREE.CylinderGeometry(0.34, 0.44, 1.1, 12)
    can.translate(0, 0.2, 0)
    can.applyQuaternion(aim)
    can.translate(mouth.x, mouth.y, mouth.z)
    kit.add('ink', can)

    const face = new THREE.CircleGeometry(0.33, 12)
    face.rotateX(Math.PI / 2)
    face.translate(0, -0.36, 0)
    face.applyQuaternion(aim)
    face.translate(mouth.x, mouth.y, mouth.z)
    kit.add('emissiveAmber', face)

    const length = mouth.distanceTo(target)
    const beam = new THREE.ConeGeometry(1.7, length, 12, 1, true)
    // Apex at the can, mouth at the star: the cone's own apex is at
    // +height/2, so drop it by half its length before aiming it.
    beam.translate(0, -length / 2, 0)
    beam.applyQuaternion(aim)
    beam.translate(mouth.x, mouth.y, mouth.z)
    beams.push(beam)
  }
  // `materials.flat` would do, except that it writes depth, and four
  // translucent cones writing depth punch holes in the star behind
  // them. One bespoke material, registered for disposal.
  const beamMesh = new THREE.Mesh(mergeParts(beams), materials.own(
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.paper),
      transparent: true, opacity: 0.12, depthWrite: false, toneMapped: false,
    }),
  ))
  beamMesh.renderOrder = 2
  kit.group.add(beamMesh)
  kit.bin.add(() => beamMesh.geometry.dispose())

  /* ---- 7. THE LEADERBOARD ----------------------------------
     Opposite the medal posts. The heading is solid letters in the ink
     bucket and costs nothing; the times underneath are the one canvas
     label this district spends, redrawn only when a personal best
     actually changes — which is what an achievement's `progress`
     event announces, since every mini-game that records a time also
     moves an achievement. */
  const boardBearing = facing - 2.1
  const board = at(boardBearing, 12)
  const boardY = kit.groundAt(board.x, board.z)
  for (const side of [-1, 1]) {
    const post = {
      x: board.x - Math.sin(boardBearing) * side * 2.2,
      z: board.z + Math.cos(boardBearing) * side * 2.2,
    }
    piece('metal', post, boardY + 1.6, 0.24, 3.2, 0.24, boardBearing)
    blocker(post, boardY + 1.0, 0.35, 2.0, 0.35, boardBearing)
  }
  // No collider on the board: its lower edge is 3.2 m up, which is
  // over the roof of anything that can reach this plaza.
  piece('ink', board, boardY + 4.7, 0.24, 3.0, 5.0, boardBearing, 0.1)
  const heading = textGeometry('HALL OF FAME', { size: 0.52, weight: 0.17, depth: 0.06 })
  heading.geometry.rotateY(yaw(boardBearing) - Math.PI / 2)
  heading.geometry.translate(
    board.x - Math.cos(boardBearing) * 0.2,
    boardY + 5.6,
    board.z - Math.sin(boardBearing) * 0.2,
  )
  kit.add('chalk', heading.geometry)

  const facingBoard = yaw(boardBearing) - Math.PI / 2
  const face = new THREE.Group()
  face.position.set(board.x, boardY, board.z)
  face.rotation.y = facingBoard
  kit.group.add(face)
  const ctx = kit.site(board.x, board.z, facingBoard)
  let printed = ''
  const refreshTimes = (): void => {
    const times = kit.game.save.data.progress.bestTimes
    const lines = (['circuit', 'labyrinth', 'bowling', 'domino'] as const).map((id) => {
      const best = times[id]
      const label = id.toUpperCase()
      if (!best) return `${label}  --`
      const minutes = Math.floor(best / 60)
      const seconds = (best % 60).toFixed(1).padStart(4, '0')
      return `${label}  ${minutes}:${seconds}`
    })
    const next = lines.join('|')
    if (next === printed) return
    printed = next
    face.clear()
    textPlane(ctx, face, lines[0], 0.4, [0, 4.5, 0.14], {
      color: palette.chalk, sublines: lines.slice(1), letterSpacing: 0.1, weight: 500,
    })
  }
  refreshTimes()
  achievements.events.on('progress', refreshTimes)
  kit.bin.add(() => achievements.events.off('progress', refreshTimes))
}
