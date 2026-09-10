import { districtById, landmarks, projectPlinths, roads, type DistrictId } from './world'
import { PLAY_SPOTS, VEGETATION_ZONES } from './world-environment'
import { blockedBy, type PlacementRules, type Zone } from './world-layout'

/* ============================================================
   THE ATTRACTIONS

   Fourteen things to do that have nothing to do with the CV.
   `Attractions.ts` builds them; this file says WHERE they are and
   HOW BIG they are, and it never says either as a world
   coordinate.

   That is not a stylistic preference. The island was redrawn once
   and rescaled to 70% a second time, and both times every literal
   coordinate in the world moved out from under the thing standing
   on it — the altar, the quarry and the chip shop all ended up in
   the sea, and `SceneryDetails` was rewritten from scratch for
   exactly this reason. So an attraction is authored as A BEARING
   AND A DISTANCE FROM SOMETHING THAT IS ALREADY ON THE MAP: a
   district, a mini-game venue, a road, or another attraction. The
   island can move again and these move with it.

   The bearing and distance are a WISH. `nearestFree` walks out
   from that point in two-metre rings until the occupancy registry
   says the ground is not a road, a lake, the racing line, a
   landmark, woodland or another attraction — so a spec that lands
   on a carriageway is nudged off it rather than shipped on top of
   it, and one that cannot be placed at all says so at dev boot
   instead of quietly emigrating to the other side of the island.
   ============================================================ */

export type AttractionId =
  | 'klaxon'
  | 'catapult'
  | 'pinata'
  | 'piano'
  | 'speedTrap'
  | 'carWash'
  | 'football'
  | 'skittles'
  | 'fireworks'
  | 'bell'
  | 'trampolines'
  | 'bumpers'
  | 'weatherLever'
  | 'turntable'

type PlaySpotId = (typeof PLAY_SPOTS)[number]['id']

/**
 * What a spec is measured from.
 *
 * `road` is exact and the others are searched. A car wash that is
 * nudged eleven metres off the road it straddles is not a car wash,
 * so roadside furniture keeps its point and takes an offset across
 * the carriageway instead.
 */
type Anchor =
  | { kind: 'district'; id: DistrictId }
  | { kind: 'spot'; id: PlaySpotId }
  | { kind: 'attraction'; id: AttractionId }
  | { kind: 'road'; id: string; t: number; offset: number }

interface AttractionSpec {
  id: AttractionId
  anchor: Anchor
  /** Radians from the anchor. 0 is east, +π/2 is south. Ignored for roads. */
  bearing: number
  /** Metres from the anchor. Ignored for roads. */
  distance: number
  /** Radius of the ground the built thing stands on. */
  footprint: number
  /**
   * Trigger radius of its prompt, or 0 for the ones that have none.
   *
   * A SEPARATE DISTANCE FROM THE FOOTPRINT, and the two are resolved
   * separately. A toy with no prompt may stand on a district plate or
   * a bowling forecourt quite happily; a toy WITH one must also keep
   * its circle clear of every other prompt on the island, including
   * the six here, because only the nearest prompt is ever offered.
   * An overlapping pair does not degrade — it deletes one of the two,
   * and which one depends on the side you drove up from. This island
   * has shipped that bug twice.
   */
  prompt: number
  /**
   * Which way it points. `anchor` — the default — turns it back
   * towards the district it belongs to, which is what a sign, a bell
   * or a scoreboard wants. `away` points it out into the open, which
   * is what anything that THROWS the car wants: a catapult aimed at
   * the middle of its own district lands you on the monument.
   */
  face?: 'anchor' | 'away'
  /** Zone kinds this thing is allowed to stand on. */
  allow?: PlacementRules['allow']
  /** Metres to stay inside the coastline. Defaults to 8. */
  coastMargin?: number
  /**
   * Half-length along the heading, for the two attractions that are
   * not discs: the piano's twelve keys and the football pitch.
   *
   * `nearestFree` only ever tests the anchor, so a 24 m strip whose
   * middle is on clear grass can still have its far end in a lake,
   * on the racing line or inside a vegetation mass — which is
   * exactly where the piano's south end started, in the middle of
   * the south forest, with trees free to grow between the keys.
   * `validateAttractions` walks this and says so.
   */
  span?: number
}

/*
  Ordered. Each placement is registered as a keep-out for the ones
  after it, so the six that carry prompts go first and the toys that
  only need floor space fill in around them.
*/
const SPECS: AttractionSpec[] = [
  /* ---- prompted ------------------------------------------ */
  /* The forecourt's west gate, beside the two signposts that point at
     the circuit and the bridge — the first junction anybody reaches
     and the loudest thing on the island.

     NOT on the plate east of the letters, which is where it was
     authored: the one gap there is 2.5 m from a project plinth's
     prompt, and two prompts that close means one of the two cannot
     be reached. NOT south-east of the forecourt either: that rise is
     inside the south forest, and an attraction inside a vegetation
     mass gets trees planted through it. */
  { id: 'klaxon', anchor: { kind: 'district', id: 'landing' }, bearing: -2.85, distance: 21, footprint: 2, prompt: 5, allow: ['plate'] },
  /* On the open belt between ACHIEVEMENTS and SOCIAL — thirty metres
     of grass with no road, no water and no woodland in it, which is
     the rarest thing on this island and exactly what a machine that
     throws cars needs. Facing AWAY, so the flight is over that belt
     and not over the trophy. */
  { id: 'catapult', anchor: { kind: 'district', id: 'achievements' }, bearing: -0.4, distance: 21, footprint: 4, prompt: 5, face: 'away' },
  /* Twelve pins on the sand west of the pin deck, where the alley's
     own lane ends. Near enough to read as an overflow of it, far
     enough that a ball coming off the deck never reaches them. */
  { id: 'skittles', anchor: { kind: 'district', id: 'bowling' }, bearing: -3.01, distance: 25, footprint: 5, prompt: 7 },
  /* The bay shore at the east end of the bowling precinct, pointed
     over the water at the islet. `coastMargin` 6 rather than 8
     because the whole joke is that they are ON the sand. */
  { id: 'fireworks', anchor: { kind: 'spot', id: 'bowling' }, bearing: -0.14, distance: 58, footprint: 3, prompt: 6, coastMargin: 6 },
  /* Landward verge of the south shore road, facing the water. Nine
     metres the other way is the beach and then the sea. */
  { id: 'bell', anchor: { kind: 'road', id: 'south-shore-road', t: 0.5, offset: -9 }, bearing: 0, distance: 0, footprint: 2, prompt: 5 },
  /* Within sight of the TIME MACHINE, because the two levers that
     change what the sky is doing belong together — but twenty-one
     metres from it and to the north-east, because everything closer
     is inside the south forest, and because JUMP TO THE NEXT COMMIT
     owns a seven-metre circle this one's five must clear. */
  /* RE-AIMED, AND THE REASON IS WORTH KEEPING. At bearing -0.77 this
     resolved into the labyrinth's west corridor, on the unique route
     to its centre, and made the maze impossible to complete — the
     occupancy registry described a 47.8 m square as the 23.9 m disc
     inside it, so the corner it landed in read as open ground. The
     square is registered as a square now, but the wish is re-aimed as
     well: a placement that only survives because the oracle was fixed
     is a placement waiting for the next oracle. Twelve metres and
     bearing 0.175 is the nearest point to the time machine that is
     28.5 m from the maze centre, out of the water, off the roads and
     clear of everything already placed. */
  { id: 'weatherLever', anchor: { kind: 'district', id: 'timeMachine' }, bearing: 0.175, distance: 12, footprint: 2, prompt: 5, allow: ['plate'] },

  /* ---- no prompt: driven, hit, or driven over ------------- */
  /* Where the catapult throws you — measured off the catapult's
     resolved heading rather than a bearing of its own, so moving the
     catapult moves the target it is aimed at. */
  { id: 'pinata', anchor: { kind: 'attraction', id: 'catapult' }, bearing: 0, distance: 22, footprint: 4, prompt: 0 },
  /* An arch OVER the road out of the landing, because driving through
     it is the interaction. It has to keep its point on the
     carriageway, so it is a road anchor with no offset. */
  { id: 'carWash', anchor: { kind: 'road', id: 'landing-bridge-social', t: 0.55, offset: 0 }, bearing: 0, distance: 0, footprint: 5, prompt: 0, allow: ['road'] },
  /* The long straight to the start line — the one road on this island
     you arrive at with speed already on the clock. */
  { id: 'speedTrap', anchor: { kind: 'road', id: 'landing-racestart', t: 0.5, offset: 0 }, bearing: 0, distance: 0, footprint: 5, prompt: 0, allow: ['road'] },
  /* Twelve keys laid ALONG the south shore road, on the landward
     verge rather than the carriageway: a keyboard you play by
     driving down it.

     NOT the south spine, which is where it was authored, and eight
     metres out rather than twelve. A 26 m strip needs 26 m of clear
     ground IN A STRAIGHT LINE, and there are exactly three places
     on this island that offer it: the spine's verge is inside the
     south forest from z 24 southwards, so the strip's far half
     stood among trees the ecology is free to plant between the
     keys, and at eleven metres out this verge is in the south lake.
     Eight leaves 1.1 m between the outer edge of a key and the
     road's shoulder, and beach grass for the whole length. */
  { id: 'piano', anchor: { kind: 'road', id: 'south-shore-road', t: 0.2, offset: -8 }, bearing: 0, distance: 0, footprint: 6, prompt: 0, span: 13 },
  /* The circuit's infield, east of the start line: visible from the
     pit straight, and reachable without crossing the racing surface. */
  { id: 'football', anchor: { kind: 'district', id: 'circuit' }, bearing: 0.05, distance: 25, footprint: 5, prompt: 0, span: 8 },
  /* The terrace east of the PROJECTS terminal. A thirteen-metre disc
     needs seven metres of clearance all round and this island has
     exactly five pieces of ground that offer it; this is the only
     one of them not already spoken for. */
  { id: 'turntable', anchor: { kind: 'district', id: 'projects' }, bearing: -0.17, distance: 20, footprint: 7, prompt: 0 },
  /* The same belt as the catapult, far enough down it that a bounce
     does not end on the arm. */
  { id: 'trampolines', anchor: { kind: 'district', id: 'achievements' }, bearing: -0.21, distance: 31, footprint: 5, prompt: 0 },
  /* Hard against the ACHIEVEMENTS plate. A star on a plinth is the
     least playable place on the island and it is a lap's-end sprint
     from the start line; a pinball corner is what it was missing. */
  { id: 'bumpers', anchor: { kind: 'district', id: 'achievements' }, bearing: -2.95, distance: 12.5, footprint: 5, prompt: 0, allow: ['plate'] },
]

/* ------------------------------------------------------------
   SIZES

   The dimensions the builders lay out from. Here rather than in
   `Attractions.ts` for the same reason the positions are: a thing
   whose reach is written in one file and whose trigger is written
   in another drifts apart the first time either is tuned.

   Every one of these is a metre or a second unless it says
   otherwise. Nothing here is a world coordinate.
   ------------------------------------------------------------ */

export const PARTS = {
  klaxon: {
    postHeight: 5.2,
    hornLength: 3.4,
    hornMouth: 1.5,
    /** Everything loose inside this gets shoved. */
    blast: 9,
    /** Metres per second imparted at the centre of the blast. */
    blastSpeed: 5.5,
    cooldown: 0.7,
  },
  catapult: {
    armLength: 9,
    frameHeight: 3.2,
    /** How near the cradle the car has to be for the arm to find it. */
    cradle: 4.5,
    /**
     * The launch, as the velocity the car leaves with rather than as
     * an impulse — an impulse is a number nobody can picture and this
     * had to be tuned against a landing the car survives. 11 up and 12
     * along gives an apex near six metres and a flight of about
     * twenty-seven, which is a jump and not an artillery piece.
     * `Respawns` is the net; it is not the plan.
     */
    launch: { up: 11, forward: 12 },
    /**
     * Radians the arm is drawn back to at rest, and radians it
     * travels when it fires.
     *
     * 0.55 is not a taste: the pivot is 4.1 m up and the beam is 9
     * long, so the cradle only reaches the ground at an angle whose
     * sine is about 0.53. Drawn back to 0.95 — which is what this
     * was — the cradle sat six and a half metres in the air and the
     * one instruction the prompt gives, sit in the cradle, could not
     * be followed.
     */
    rest: 0.55,
    sweep: 1.5,
    /** Seconds to throw, and seconds to wind back. */
    swing: 0.32,
    recover: 1.6,
  },
  pinata: {
    span: 9,
    /** Height of the rope. Low enough that a hop reaches the belly. */
    barHeight: 4.2,
    bodyDrop: 1.2,
    /** How near the car has to pass, and how far off the ground. */
    reach: 3,
    lift: 1.2,
    /** Loose pieces that fall out of it. */
    sweets: 8,
  },
  piano: {
    keys: 12,
    keyPitch: 2,
    keyLength: 3.6,
    keyWidth: 2,
    /** Trigger radius per key. Below the pitch, so two never fire. */
    keyReach: 1.1,
    /**
     * The phrase, as key numbers. Painted on the board at the end of
     * the strip, because a five-note secret nobody can read is not a
     * secret, it is a lottery.
     */
    phrase: [1, 5, 8, 12, 8],
    /** Seconds of silence that abandons a half-played phrase. */
    phraseGap: 3.5,
  },
  speedTrap: {
    postHeight: 5.4,
    beamDrop: 0.5,
    boardWidth: 6,
    boardHeight: 2,
    flash: 0.35,
  },
  carWash: {
    postHeight: 5,
    brushRadius: 1.1,
    brushHeight: 3.4,
    /** Radians per second. Fast enough to read, slow enough to see. */
    brushSpin: 3.2,
    /** How long the curtain runs after you pass through. */
    rinse: 1.6,
  },
  football: {
    ballRadius: 1.5,
    ballMass: 1.1,
    /** Goal to spot. The ball starts the same distance the other way. */
    pitch: 16,
    goalWidth: 8,
    goalHeight: 3.4,
    /** The ball goes home if it is left further away than this. */
    stray: 70,
    returnDelay: 1.4,
  },
  skittles: {
    count: 12,
    rows: [2, 3, 3, 4],
    pitch: 3.4,
    height: 2.4,
    radius: 0.55,
    mass: 1.6,
    /** Cosine of the tilt at which a pin counts as flattened. */
    down: 0.45,
  },
  fireworks: {
    tubes: 6,
    tubeLength: 2.6,
    tubeSpread: 4.4,
    shells: 18,
    /** Seconds the volley lasts. */
    volley: 5,
    /** How high a shell climbs before it opens. */
    apex: 26,
    climb: 1.1,
  },
  bell: {
    frameHeight: 4.6,
    bellRadius: 1.15,
    swing: 0.55,
    /** Rings inside this window that earn the carillon. */
    carillon: { rings: 7, seconds: 10 },
  },
  trampolines: {
    pads: 3,
    padRadius: 3.4,
    padHeight: 0.9,
    /** Centre-to-centre. Close enough to chain three bounces. */
    spacing: 8.5,
    /** Metres per second straight up, out of a standstill. */
    bounce: 9,
    cooldown: 0.35,
    /** A chain survives this long between bounces. */
    chainGap: 3,
    chain: 3,
  },
  bumpers: {
    count: 5,
    radius: 1.9,
    height: 1.5,
    spread: 7.5,
    /** Metres per second thrown outwards. */
    kick: 9,
    cooldown: 0.4,
  },
  weatherLever: {
    plinth: 1.8,
    leverLength: 2.8,
    /** Seconds of weather you asked for. */
    hold: 30,
  },
  turntable: {
    radius: 6.5,
    /**
     * Thickness, and it is BURIED to its middle. A disc sitting on
     * the ground is a 0.6 m vertical kerb all the way round, which
     * a car arrives at rather than drives onto; half-sunk it is a
     * 0.25 m lip, which is under the wheel radius.
     */
    thickness: 0.5,
    /** Seconds per revolution. */
    period: 14,
    /** A ride counts once the disc has carried you this far. */
    revolution: Math.PI * 2,
  },
} as const

/* ------------------------------------------------------------
   PLACEMENT
   ------------------------------------------------------------ */

export interface AttractionSpot {
  id: AttractionId
  x: number
  z: number
  /**
   * Radians. What the thing faces and lays itself out along: back at
   * its anchor for a searched spec, along the direction of travel for
   * a road one.
   */
  heading: number
  /** Copied off the spec so the builder never re-states it. */
  prompt: number
  /** Half-length along the heading; 0 for the discs. */
  span: number
  /** False when the placer had to settle. Reported in development. */
  clear: boolean
}

interface PromptCircle {
  id: string
  x: number
  z: number
  radius: number
}

/**
 * Every prompt already on the island.
 *
 * The landmarks and the plinths come out of the content layer. The
 * other seven are registered at run time by `Playground`, `Bowling`,
 * `Labyrinth` and `TntDomino` from offsets this file cannot import,
 * so they are RE-DERIVED here from the same play spot the venue
 * itself measures from, and each one names the constant it mirrors.
 * That can drift; a coarse "stay 44 m from the whole venue" cannot,
 * but it also forbids the skittle yard on the bowling forecourt,
 * which is the one place a skittle yard belongs. The comments are
 * the mitigation, and `validateAttractions` runs at dev boot.
 */
function existingPrompts(): PromptCircle[] {
  const out: PromptCircle[] = []
  for (const landmark of landmarks) {
    if (landmark.interaction === 'none') continue
    out.push({ id: `prompt-${landmark.id}`, x: landmark.x, z: landmark.z, radius: landmark.radius ?? 8 })
  }
  // The eight plinths are generated, and every one of them is a prompt.
  for (const plinth of projectPlinths()) {
    out.push({ id: `prompt-${plinth.id}`, x: plinth.x, z: plinth.z, radius: 8 })
  }
  const spot = (id: PlaySpotId) => {
    const found = PLAY_SPOTS.find((s) => s.id === id)
    if (!found) throw new Error(`[world] no play spot '${id}'`)
    return found
  }

  // BOWL A SET stands at the mark, `Bowling.MARK_Z` = 34 m down-lane
  // of the venue origin, in the venue's own yaw.
  const lanes = spot('bowling')
  const yaw = 'rotation' in lanes ? lanes.rotation : 0
  out.push({
    id: 'prompt-bowling-start',
    x: lanes.x + Math.sin(yaw) * 34,
    z: lanes.z + Math.cos(yaw) * 34,
    radius: 9,
  })
  // RESTOCK TNT is 21 m south of the stack (`Playground.buildTnt`);
  // PLAY TNT DOMINO is on the stack itself.
  const quarry = spot('tnt')
  out.push({ id: 'prompt-reset-tnt', x: quarry.x, z: quarry.z + 21, radius: 7 })
  out.push({ id: 'prompt-challenge-domino', x: quarry.x, z: quarry.z, radius: 7 })
  out.push({ id: 'prompt-time-machine', x: spot('timeMachine').x, z: spot('timeMachine').z, radius: 7 })
  // FALL IN takes the spot's radius minus one.
  const hole = spot('blackHole')
  out.push({ id: 'prompt-black-hole', x: hole.x, z: hole.z, radius: hole.radius - 1 })
  // RUN THE LABYRINTH stands an approach outside the square's mouth.
  // Generous, because the maze is being re-laid and its mouth may
  // move: 12 m of circle for a 7 m prompt.
  const maze = spot('maze')
  out.push({ id: 'prompt-labyrinth-start', x: maze.x, z: maze.z - maze.radius - 10, radius: 12 })
  // RESTORE THE NAME is 26 m east of the name's plinth, and the
  // plinth is the only part of it the content layer knows about.
  const name = landmarks.find((l) => l.id === 'landing-name')
  if (name) out.push({ id: 'prompt-reset-name', x: name.x + 26, z: name.z + 5, radius: 7 })
  return out
}

/**
 * Ground nothing may be built on that the occupancy registry does
 * not already forbid: woodland.
 *
 * `findNear` cannot be asked to avoid it — `forest` is a SOFT kind
 * and soft kinds are always allowed, because woodland is where
 * vegetation is WANTED. An attraction inside a mass gets trees
 * planted through it, so the masses go in as hard footprints of this
 * placer's own.
 */
function woodland(): Zone[] {
  return VEGETATION_ZONES.map((mass) => ({
    id: `wood-${mass.id}`,
    kind: 'landmark' as const,
    x: mass.x,
    z: mass.z,
    radius: Math.min(mass.rx, mass.rz),
    rx: mass.rx,
    rz: mass.rz,
  }))
}

/** A point a fraction of the way along a road, and its heading. */
function alongRoad(id: string, t: number): { x: number; z: number; heading: number } {
  const road = roads.find((r) => r.id === id)
  if (!road) throw new Error(`[world] no road '${id}' to hang an attraction on`)
  const span = road.points.length - 1
  const at = Math.max(0, Math.min(span - 0.0001, t * span))
  const index = Math.floor(at)
  const [ax, az] = road.points[index]
  const [bx, bz] = road.points[index + 1]
  const f = at - index
  return { x: ax + (bx - ax) * f, z: az + (bz - az) * f, heading: Math.atan2(bz - az, bx - ax) }
}

/**
 * The free ground nearest to a wish, or the wish itself with
 * `clear: false`.
 *
 * NOT `findNear`, which the towers and the plinths use. That one
 * sweeps a full circle around a district and grows the ring by up to
 * 22 m, which is right for eight plinths that must end up SOMEWHERE
 * around one terminal and wrong for a named toy: the first cut of
 * this file used it and put the catapult forty-five metres from the
 * forecourt it is aimed at and the skittle yard sixty metres from
 * the bowling alley it belongs to, both reported as clean placements.
 * A toy that has emigrated is worse than a toy that reports a
 * conflict, so this walks out from the authored point in two-metre
 * rings and gives up at twenty.
 */
function nearestFree(x: number, z: number, rules: PlacementRules): { x: number; z: number; clear: boolean } {
  if (!blockedBy(x, z, rules)) return { x, z, clear: true }
  for (let ring = 2; ring <= 20; ring += 2) {
    for (let step = 0; step < 24; step++) {
      // Alternating either side of due east, so the result is
      // deterministic and does not favour one bearing.
      const angle = (Math.ceil(step / 2) * (step % 2 ? 1 : -1) * Math.PI * 2) / 24
      const px = x + Math.cos(angle) * ring
      const pz = z + Math.sin(angle) * ring
      if (!blockedBy(px, pz, rules)) return { x: px, z: pz, clear: true }
    }
  }
  return { x, z, clear: false }
}

let cache: Map<AttractionId, AttractionSpot> | null = null

/**
 * Where every attraction stands.
 *
 * LAZY AND MEMOISED, like `projectPlinths` and for the same reason:
 * this module imports `world-layout`, which imports `world`, so
 * running the search at module-evaluation time would call into a
 * half-built registry. Memoising also makes the layout identical
 * every time it is asked for, which matters because `Attractions`
 * asks once and the development validator asks again.
 */
export function attractionSpots(): Map<AttractionId, AttractionSpot> {
  if (cache) return cache
  const spots = new Map<AttractionId, AttractionSpot>()
  const prompts = existingPrompts()
  const placed: Zone[] = woodland()

  for (const spec of SPECS) {
    /*
      GROUND AND PROMPTS ARE TWO DIFFERENT DISTANCES, and conflating
      them is what made the first cut of this file put the fireworks
      ninety metres from the beach they were authored for.

      Ground clearance is the footprint: what the thing stands on.
      Prompt clearance is separate and only applies to the six specs
      that carry one — a toy with no prompt may stand on the bowling
      forecourt or inside a district plate quite happily. `findNear`
      takes ONE clearance, so the existing prompts go in as `extra`
      zones inflated by the difference: blocked when the distance is
      under `zone.radius + clearance`, so a radius of
      `theirs + mine − footprint` blocks exactly when the two circles
      would touch.
    */
    const rivals: Zone[] = spec.prompt
      ? prompts.map((p) => ({
          id: p.id,
          kind: 'landmark' as const,
          x: p.x,
          z: p.z,
          radius: Math.max(0, p.radius + spec.prompt - spec.footprint),
        }))
      : []

    if (spec.anchor.kind === 'road') {
      const on = alongRoad(spec.anchor.id, spec.anchor.t)
      // Across the carriageway, not along it: +offset is to the right
      // of the direction of travel.
      const nx = -Math.sin(on.heading)
      const nz = Math.cos(on.heading)
      const x = on.x + nx * spec.anchor.offset
      const z = on.z + nz * spec.anchor.offset
      spots.set(spec.id, { id: spec.id, x, z, heading: on.heading, prompt: spec.prompt, span: spec.span ?? 0, clear: true })
      placed.push({ id: `attraction-${spec.id}`, kind: 'landmark', x, z, radius: spec.footprint })
      if (spec.prompt) prompts.push({ id: `prompt-${spec.id}`, x, z, radius: spec.prompt })
      continue
    }

    const from =
      spec.anchor.kind === 'district'
        ? districtById[spec.anchor.id]
        : spec.anchor.kind === 'spot'
          ? PLAY_SPOTS.find((s) => s.id === spec.anchor.id)
          : spots.get(spec.anchor.id)
    if (!from) throw new Error(`[world] attraction '${spec.id}' has no anchor to measure from`)
    // An attraction hung off another attraction inherits its bearing,
    // so the piñata hangs where the catapult actually points rather
    // than where it was authored to point.
    const bearing = spec.anchor.kind === 'attraction' ? (from as AttractionSpot).heading + spec.bearing : spec.bearing

    const found = nearestFree(
      from.x + Math.cos(bearing) * spec.distance,
      from.z + Math.sin(bearing) * spec.distance,
      {
        clearance: spec.footprint,
        allow: spec.allow,
        coastMargin: spec.coastMargin,
        margin: { water: 4, road: 0 },
        extra: [...placed, ...rivals],
      },
    )
    const inward = Math.atan2(from.z - found.z, from.x - found.x)
    spots.set(spec.id, {
      id: spec.id,
      x: found.x,
      z: found.z,
      // Derived from where it ended up, not authored: a sign faces
      // the district it belongs to and a catapult faces the open
      // ground away from it, and neither needs a hand-written angle
      // that would go stale the moment the placement moved.
      heading: spec.face === 'away' ? inward + Math.PI : inward,
      prompt: spec.prompt,
      span: spec.span ?? 0,
      clear: found.clear,
    })
    placed.push({ id: `attraction-${spec.id}`, kind: 'landmark', x: found.x, z: found.z, radius: spec.footprint })
    if (spec.prompt) prompts.push({ id: `prompt-${spec.id}`, x: found.x, z: found.z, radius: spec.prompt })
  }

  cache = spots
  return cache
}

export function attractionSpot(id: AttractionId): AttractionSpot {
  const spot = attractionSpots().get(id)
  if (!spot) throw new Error(`[world] no attraction '${id}'`)
  return spot
}

/**
 * What went wrong with the placement, as lines a human can read.
 *
 * Two questions, and the second is the one that matters: did every
 * spec find free ground, and does any new prompt sit inside an
 * existing one (or the other way round). Only the nearest prompt is
 * ever offered, so that does not degrade — it deletes one of the
 * two, and which one depends on which side you drove up from.
 *
 * NEW AGAINST OLD ONLY. The four link signs at SOCIAL already stand
 * inside the camera's twelve-metre circle and are reachable anyway,
 * because the rule the selection actually enforces is nearest by
 * FRACTION of radius penetrated — a 6.5 m sign beats a 12 m camera
 * from four metres away. Reporting the world's existing pairs here
 * would bury the one thing this check exists to catch.
 */
export function validateAttractions(): string[] {
  const problems: string[] = []
  const spots = [...attractionSpots().values()]
  const wood = woodland()
  for (const spot of spots) {
    if (!spot.clear) problems.push(`${spot.id} could not find clear ground at (${spot.x.toFixed(1)}, ${spot.z.toFixed(1)})`)
    if (!spot.span) continue
    // Five samples down the length of anything that is not a disc.
    for (let i = -2; i <= 2; i++) {
      const x = spot.x + Math.cos(spot.heading) * spot.span * (i / 2)
      const z = spot.z + Math.sin(spot.heading) * spot.span * (i / 2)
      const blocker = blockedBy(x, z, { clearance: 2, allow: ['plate', 'road'], extra: wood, margin: { road: -3 } })
      if (blocker) problems.push(`${spot.id} runs into ${blocker.kind}:${blocker.id} at (${x.toFixed(1)}, ${z.toFixed(1)})`)
    }
  }
  const mine = spots.filter((s) => s.prompt > 0).map((s) => ({ id: s.id, x: s.x, z: s.z, radius: s.prompt }))
  const theirs = existingPrompts()
  for (const [i, a] of mine.entries()) {
    for (const b of [...mine.slice(i + 1), ...theirs]) {
      const gap = Math.hypot(a.x - b.x, a.z - b.z)
      if (gap < Math.max(a.radius, b.radius)) {
        problems.push(`${a.id} and ${b.id} are ${gap.toFixed(1)} m apart — one of the two prompts is unreachable`)
      }
    }
  }
  return problems
}
