import type { ChapterId, Theme } from './types'
import { projects, projectBySlug } from './projects'
import { experience } from './experience'
import { education } from './education'
import { findNear, type Zone } from './world-layout'
import { PATHS, ZONES } from './world-map'
import { CIRCUIT, WORLD_RADIUS } from './world-environment'

/* ============================================================
   ALEJANDRO'S WORLD — SPATIAL PRESENTATION LAYER

   This file adds *where things stand* to the portfolio. It adds
   no facts. Every claim the /world route makes is read from
   `experience.ts`, `education.ts`, `projects/*` and `profile.ts`
   through the `ref` field below, so updating a project updates
   the scroll journey and the world at the same time.

   WHERE THE POSITIONS COME FROM. Not from here. The island is a
   hand-drawn map, digitised into `world-map.ts` and turned into
   geography by `world-environment.ts`; this file places the built
   things against those zones. If a number here is not read out of
   `ZONES`, `PATHS` or `CIRCUIT`, it is an offset from one that is,
   and the comment says which.

   Coordinates are metres in the physics world. +X is east, +Z
   is south, Y is up — so the top of the drawing is −Z. The
   vehicle is ~2.6 m long and tops out around 10 m/s cruising and
   ~35 m/s boosting, so a 90 m hop between places is a few seconds
   of driving.
   ============================================================ */

export type DistrictId =
  | 'landing'
  | 'circuit'
  | 'social'
  | 'bowling'
  | 'projects'
  | 'achievements'
  | 'maze'
  | 'timeMachine'
  | 'blackhole'
  | 'tnt'

/** How a landmark is built in 3D. One builder per value. */
export type LandmarkVisual =
  | 'sign'
  | 'monument'
  | 'billboard'
  | 'idCard'
  | 'terminal'
  | 'island'
  | 'gate'
  | 'camera'
  | 'trophy'
  | 'singularity'
  | 'bracket'

/** What pressing ENTER inside the landmark's radius does. */
export type LandmarkInteraction =
  | 'project'
  | 'panel'
  | 'minigame'
  | 'link'
  | 'note'
  | 'projects'
  | 'achievements'
  | 'none'

/** Joins a landmark to the single source of truth. */
export type ContentRef =
  | { kind: 'project'; id: string }
  | { kind: 'experience'; id: string }
  | { kind: 'education'; id: string }
  | { kind: 'profile' }

export interface District {
  id: DistrictId
  /** Shown on signposts, the map and the district-entered toast. */
  label: string
  /** Tight label for the map legend. */
  short: string
  x: number
  z: number
  /** Discovery radius, and the footprint drawn on the map. */
  radius: number
  /**
   * The *built* footprint, in metres: the ground this district
   * flattens and paves. Separate from `radius` on purpose — a
   * district can be discoverable from a distance without stamping a
   * disc on the landscape. Leave it out and the district sits on
   * natural ground, which is what most of them should do; set it
   * only where one continuous surface actually matters.
   */
  plate?: number
  theme: Theme
  accent: string
  /** One line. Shown when the district is first entered. */
  blurb: string
  /** Corresponding chapter in the scroll journey, for cross-links. */
  chapter?: ChapterId
  /** Ground treatment used by the terrain builder. */
  ground: 'paper' | 'plate' | 'grid' | 'dark' | 'asphalt' | 'water'
  /** Districts are revealed on the map only once visited. */
  secret?: boolean
  /** Signposted from the landing. */
  signposted?: boolean
}

export interface Landmark {
  id: string
  district: DistrictId
  label: string
  /** Second line on the physical sign. Optional. */
  sublabel?: string
  x: number
  z: number
  /** Y rotation in radians. */
  rotation?: number
  visual: LandmarkVisual
  interaction: LandmarkInteraction
  /** Interaction trigger radius in metres. */
  radius?: number
  /** Uniform visual scale. */
  scale?: number
  ref?: ContentRef
  /** Mini-game id when `interaction` is `minigame`. */
  minigame?: MinigameId
  /** Achievement unlocked by interacting. */
  achievement?: string
  /** Panel body when `interaction` is `panel` and there is no `ref`. */
  panel?: { title: string; lines: string[] }
  /** External URL when `interaction` is `link`. */
  href?: string
  /** Hidden until discovered; not drawn on the map beforehand. */
  secret?: boolean
}

/** Four physical experiences survive the map. Everything else the
 *  world used to run as a mini-game was tied to a district the
 *  drawing does not have, and lives in the PROJECTS archive now. */
export type MinigameId = 'circuit' | 'labyrinth' | 'bowling' | 'domino'

/* ============================================================
   DISTRICTS

   The named places on the drawing, and nothing else. Positions
   are read straight out of the plan.
   ============================================================ */

export const districts: District[] = [
  {
    id: 'landing',
    label: 'LANDING',
    short: 'LANDING',
    x: ZONES.landing.x, z: ZONES.landing.z, radius: 30, plate: 15,
    theme: 'light', accent: '#d4491f',
    ground: 'paper',
    blurb: 'Where the name is written large enough to drive on.',
    chapter: 'prelude',
    signposted: true,
  },
  {
    id: 'circuit',
    label: 'NEWPORT CIRCUIT',
    short: 'RACE',
    // The start/finish line. The TRACK is 954 m of the western half;
    // this disc is where you join it.
    x: ZONES.raceStart.x, z: ZONES.raceStart.z, radius: 21,
    theme: 'light', accent: '#8c1f14',
    ground: 'asphalt',
    blurb: 'One lap of the long way round. Your best time lives in this browser.',
    signposted: true,
  },
  {
    id: 'social',
    label: 'SOCIAL',
    short: 'SOCIAL',
    // Twenty, not twenty-six. At 26 the discovery disc reached z −114
    // and the bowling lane runs along z −112.6: driving a ball down the
    // lane announced "you have arrived at SOCIAL".
    x: ZONES.social.x, z: ZONES.social.z, radius: 14, plate: 11,
    theme: 'light', accent: '#5f8490',
    ground: 'plate',
    blurb: 'A camera on a tripod, and four ways to get hold of me.',
    chapter: 'contact',
    signposted: true,
  },
  {
    id: 'bowling',
    label: 'NEWPORT LANES',
    short: 'BOWLING',
    // The venue's own middle, not the foul line: the lane runs west
    // from PLAY_SPOTS.bowling and the district should sit over it.
    /* Follows the venue, which moved 12 m east and 8 m south to keep
       its pad out of the sea. A district centre that stays where the
       venue used to be puts the toast, the ground paint and the map
       marker in the wrong field. */
    x: -6.2, z: -71, radius: 32,
    theme: 'light', accent: '#a8683f',
    ground: 'plate',
    blurb: 'Ten pins, one very large ball, and a car instead of a bowler.',
    signposted: true,
  },
  {
    id: 'projects',
    label: 'PROJECTS',
    short: 'PROJECTS',
    x: ZONES.projects.x, z: ZONES.projects.z, radius: 20, plate: 9,
    theme: 'light', accent: '#5b6f8a',
    ground: 'plate',
    blurb: 'Everything I have built, in one place instead of nine.',
    chapter: 'universe',
    signposted: true,
  },
  {
    id: 'achievements',
    label: 'ACHIEVEMENTS',
    short: 'AWARDS',
    x: ZONES.achievements.x, z: ZONES.achievements.z, radius: 17, plate: 11,
    theme: 'light', accent: '#c8922f',
    ground: 'plate',
    blurb: 'A star on a plinth, and the list of what you have found.',
    signposted: true,
  },
  {
    id: 'maze',
    label: 'LABYRINTH',
    short: 'MAZE',
    x: ZONES.maze.x, z: ZONES.maze.z, radius: 36,
    /* A PLATE, because a labyrinth has a floor.

       Without one the square sat across the hillside that runs down to
       the south-east beach: 2.8 m of fall from its west wall to its
       east one, an 11.8° cross-slope through the middle of it, and a
       corner three metres under the rest. Corridors seven metres wide
       on a side-slope roll a car into a wall, and a car on its roof
       between two walls cannot hop itself back over — the tour found
       one there and left it there for the rest of the run.

       26 rather than 21: `plate * 0.8` is the fully-flat radius, so 26
       flattens everything inside 20.8 m — the whole square bar its
       four corners, which are wall cells. The shore profile is applied
       after this, so the plate cannot push the beach out to sea. */
    /* NO PLATE. A disc big enough to hold a 46 m square dead flat to
       its corners is 41 across, ramps for a further 22 m and paves out
       to 63 — a bald circle a quarter of the island wide. The
       labyrinth levels its own floor with a RECTANGLE instead; see
       `PLAY_SPOTS.maze` in world-environment.ts. */
    theme: 'light', accent: '#4f7a4a',
    ground: 'plate',
    blurb: 'A real maze with a real centre. No shortcuts through the walls.',
    signposted: true,
  },
  {
    id: 'timeMachine',
    label: 'TIME MACHINE',
    short: 'TIME',
    x: ZONES.timeMachine.x, z: ZONES.timeMachine.z, radius: 11, plate: 7,
    theme: 'light', accent: '#7a6cb0',
    ground: 'plate',
    blurb: 'It does not go anywhere. It goes when.',
    signposted: true,
  },
  {
    id: 'blackhole',
    label: 'BLACK HOLE',
    short: 'VOID',
    x: ZONES.blackHole.x, z: ZONES.blackHole.z, radius: 11,
    theme: 'dark', accent: '#3b3b45',
    ground: 'dark',
    blurb: 'Inside the north loop. You will see it every lap.',
    secret: true,
  },
  {
    id: 'tnt',
    label: 'TNT',
    short: 'TNT',
    // Beside the circuit's west run, on the infield verge.
    x: ZONES.tnt.x + 8, z: ZONES.tnt.z, radius: 10,
    theme: 'light', accent: '#e2b33a',
    ground: 'grid',
    blurb: 'Eighteen crates, one fuse, and a racing line you should not park on.',
  },
]

export const districtById = Object.fromEntries(districts.map((d) => [d.id, d])) as Record<
  DistrictId,
  District
>

/** Re-exported for the handful of callers that still import it from
 *  here. See the note on its declaration: it is a fallback, not a
 *  description of the island. */
export { WORLD_RADIUS }

/** Where a fresh visitor starts. This is the id `Respawns.getDefault()`
 *  looks up, and the one place a respawn's name matters. */
export const SPAWN_RESPAWN = 'landing'

/* ============================================================
   RESPAWN POINTS
   `R` teleports to the nearest of these. One per place, plus
   a few along the long paths, so nowhere is a long walk back.
   ============================================================ */

export interface Respawn {
  id: string
  x: number
  z: number
  /** Facing, radians. 0 looks along +X. */
  rotation: number
  district?: DistrictId
}

export const respawns: Respawn[] = [
  /*
    Authored against the drawing, then checked: every one is on free
    ground, near a path so there is a way out, inside the place it
    claims to serve, and facing that place's centre — which is the
    thing you came to look at. `scripts/world-layout-check.mjs`
    proves it and `Respawns.validate()` runs as a net.
  */
  // On the forecourt east of the name, facing back across it.
  { id: 'landing', x: 54.6, z: 6, rotation: -2.42, district: 'landing' },
  // The north side of the landing is the physical name, so the second
  // point is on the open ground west of it rather than inside an A.
  { id: 'landing-west', x: 22.4, z: -1.4, rotation: -0.28, district: 'landing' },
  { id: 'circuit', x: -43.4, z: -0.7, rotation: 2.24, district: 'circuit' },
  { id: 'social', x: -1.4, z: -50.4, rotation: -2.36, district: 'social' },
  /* Off the east end of the lane, FACING OUT.

     It faced west, down the lane at a bed that stood 0.81 m proud of
     the pad two metres in front of it: the car climbed the lip and
     beached itself, making 3.5 m in 1.4 s of throttle against 11-19 m
     at every other respawn, and because R lands on the same point the
     mini-game sweep failed with it.

     The lane is flush with the ground now — 0.06 m, with a skirt
     ramping every edge — so the step is gone, but the point still
     faces out: the way ONTO the lane is the prompt, and a respawn you
     can drive straight off is worth more than one with a view. */
  { id: 'bowling', x: 32, z: -71, rotation: 0, district: 'bowling' },
  { id: 'projects', x: 61.6, z: -42, rotation: -0.87, district: 'projects' },
  /* OFF THE PODIUM'S FLANK. The set dressing builds a three-tier podium
     with an entry wedge on each tier, so it can be driven up — along its
     own approach. This point sat beside it facing across that approach,
     and a 0.42 m step taken sideways rolls a 2.5 kg car: `world-qa`
     reported the respawn as flipped about one run in three. */
  { id: 'achievements', x: -36, z: -14, rotation: 2.66, district: 'achievements' },
  // Off the maze's west side: the maze is 35 m square and this used
  // to be the sort of point that lands inside a wall.
  /* OUTSIDE THE WALLS, on the spur that arrives at the gate.
     (86.8, 56) is inside the 46 m square — nineteen metres west and six
     north of its centre, which on the current seed is an open corridor
     and on any other seed is a wall. Respawning eight corridors deep
     with no way of knowing where you are is not a respawn. This stands
     on the spur from the time machine, west of the square and facing
     along it towards the gate; `respawn + road` is a pairing the
     registry expects. The approach straight in front of the mouth is
     not available: the pad's own footprint reaches 33 m from the maze
     centre and `ramp-landing` claims another 19 m of it. */
  { id: 'maze', x: 80, z: 40, rotation: 0.25, district: 'maze' },
  /* Follows the venue, which moved 23 m west this pass to clear the
     enlarged labyrinth. Left where it was, the point stood off the
     district it serves and the car flipped on the bank behind it. */
  { id: 'timeMachine', x: 48, z: 52, rotation: 0.9, district: 'timeMachine' },
  // On the long paths, so the east of the island is never a walk.
  { id: 'road-ramp', x: 52, z: -55, rotation: 0.8 },
  { id: 'road-south', x: 50.4, z: 30.8, rotation: 1.4 },
  { id: 'road-race', x: -14, z: -4.2, rotation: 3.02 },
]

/* ============================================================
   LANDMARKS

   The built things. Twenty-eight of them, against sixty-one on
   the old island — the drawing has ten places, not nineteen, and
   the projects that used to have a district each are reached
   through one terminal now.
   ============================================================ */

export const landmarks: Landmark[] = [
  /* ---- LANDING ------------------------------------------- */
  {
    id: 'landing-name', district: 'landing', label: 'ALEJANDRO NEWPORT',
    /* The letters themselves are physics bodies built by Playground;
       this is the plinth and the anchor for the prompt.

       Offset to the name's north-west corner rather than its middle.
       Dead centre, on a 266 m island, is 6.9 m from the landing-projects
       carriageway and the plinth needs 8.7; here it is 12.8, and it is
       still inside the letters' own footprint, which is where a plinth
       for the name belongs. */
    x: ZONES.nameLetters.x - 4.4, z: ZONES.nameLetters.z - 4,
    visual: 'monument', interaction: 'none', scale: 1,
  },
  {
    id: 'landing-welcome', district: 'landing', label: 'WELCOME',
    sublabel: 'PRESS ENTER',
    x: 68, z: 2, rotation: Math.PI * 1.05, visual: 'billboard', interaction: 'panel', radius: 8,
    panel: {
      title: 'WELCOME',
      lines: [
        'Drive around to explore my work, my projects, and a few',
        'things I probably spent too long building.',
        '',
        'Nothing here is required reading. The whole CV is on the',
        'main site — this is the same material, laid out as a place',
        'instead of a page.',
      ],
    },
  },
  {
    id: 'landing-about', district: 'landing', label: 'ABOUT',
    x: 15.4, z: 14.2, rotation: Math.PI * 0.35, visual: 'idCard',
    interaction: 'panel', radius: 7, ref: { kind: 'profile' },
  },
  /* The signposts. One per direction you can actually leave in, set
     back from the junction so a car leaving the landing does not have
     to drive through them. */
  {
    id: 'landing-sign-race', district: 'landing', label: 'RACE CIRCUIT', sublabel: 'BEST LAP',
    x: 18.2, z: -9.8, rotation: Math.PI * 1.02, visual: 'sign', interaction: 'none',
  },
  {
    id: 'landing-sign-social', district: 'landing', label: 'SOCIAL', sublabel: 'OVER THE BRIDGE',
    x: 25, z: -10, rotation: Math.PI * 1.24, visual: 'sign', interaction: 'none',
  },
  {
    id: 'landing-sign-projects', district: 'landing', label: 'PROJECTS', sublabel: 'ALL OF THEM',
    x: 44, z: -26, rotation: Math.PI * 1.72, visual: 'sign', interaction: 'none',
  },
  {
    id: 'landing-sign-maze', district: 'landing', label: 'LABYRINTH', sublabel: 'AND THE TIME MACHINE',
    x: 48, z: 2, rotation: Math.PI * 0.32, visual: 'sign', interaction: 'none',
  },
  {
    id: 'secret-brackets', district: 'landing', label: '{ }',
    x: 36, z: 64, visual: 'bracket', interaction: 'none', secret: true,
  },

  /* ---- SOCIAL -------------------------------------------- */
  {
    id: 'social-camera', district: 'social', label: 'SOCIAL',
    sublabel: 'FOUR WAYS TO REACH ME',
    x: ZONES.social.x, z: ZONES.social.z - 2, visual: 'camera',
    interaction: 'panel', radius: 12,
    panel: {
      title: 'SOCIAL',
      lines: [
        'The four posts around this camera are the real links:',
        'GitHub, LinkedIn, email and the CV.',
        '',
        'Drive up to one and press ENTER to open it.',
      ],
    },
  },
  {
    id: 'social-github', district: 'social', label: 'GITHUB', sublabel: 'Ale-Newport',
    x: ZONES.social.x - 15, z: ZONES.social.z - 2, rotation: Math.PI * 0.5,
    visual: 'sign', interaction: 'link', radius: 6.5,
    href: 'https://github.com/Ale-Newport',
  },
  {
    id: 'social-linkedin', district: 'social', label: 'LINKEDIN', sublabel: 'alejandro-newport',
    x: ZONES.social.x - 11, z: ZONES.social.z - 12, rotation: Math.PI * 0.75,
    visual: 'sign', interaction: 'link', radius: 6.5,
    href: 'https://www.linkedin.com/in/alejandro-newport',
  },
  {
    id: 'social-email', district: 'social', label: 'EMAIL', sublabel: 'hello@alejandronewport.com',
    x: ZONES.social.x - 6, z: ZONES.social.z + 15, rotation: Math.PI,
    visual: 'sign', interaction: 'link', radius: 6.5,
    href: 'mailto:hello@alejandronewport.com',
  },
  {
    id: 'social-cv', district: 'social', label: 'CV', sublabel: 'PDF',
    x: ZONES.social.x - 11, z: ZONES.social.z + 11, rotation: Math.PI * 1.25,
    visual: 'sign', interaction: 'link', radius: 6.5,
    href: '/assets/alejandro-newport-cv.pdf',
  },

  /* ---- BOWLING ------------------------------------------- */
  {
    id: 'bowling-sign', district: 'bowling', label: 'NEWPORT LANES',
    sublabel: 'DRIVE INTO THE BALL',
    // Beside the approach, on the north verge. The venue registers its
    // own prompt at the mark; this is the thing you see from the path.
    x: 8.4, z: -88.2, rotation: Math.PI * 0.5, visual: 'sign', interaction: 'none',
  },

  /* ---- PROJECTS ------------------------------------------ */
  {
    id: 'projects-terminal', district: 'projects', label: 'PROJECTS',
    sublabel: 'ENTER TO EXPLORE',
    x: ZONES.projects.x, z: ZONES.projects.z, visual: 'terminal',
    interaction: 'projects', radius: 11, achievement: 'archivist',
  },

  /* ---- ACHIEVEMENTS -------------------------------------- */
  {
    id: 'achievements-star', district: 'achievements', label: 'ACHIEVEMENTS',
    sublabel: 'ENTER TO SEE THE LIST',
    x: ZONES.achievements.x, z: ZONES.achievements.z, visual: 'trophy',
    interaction: 'achievements', radius: 11,
  },

  /* ---- CIRCUIT ------------------------------------------- */
  {
    id: 'circuit-start', district: 'circuit', label: 'START / FINISH',
    sublabel: 'ENTER TO RACE',
    // On the line. `CircuitRace` owns the gantry itself; the landmark
    // is the trigger and the map marker.
    x: CIRCUIT.points[0][0], z: CIRCUIT.points[0][1],
    visual: 'gate', interaction: 'minigame', minigame: 'circuit',
    radius: 10, achievement: 'speedDemon',
  },

  /* ---- BLACK HOLE ----------------------------------------

     Not here. `Playground.buildBlackHole` owns it end to end — the
     horizon, the disc, the crater rim and the one prompt that pulls
     you in — because the pull has to be an interaction rather than a
     field, and the thing that applies it should be the thing that
     offers it.

     There used to be a `blackhole-core` landmark at this exact point
     as well: a second flat ring, a second marker ring, a floating
     'ENTER TO PULL' under the disc, and a second prompt on top of
     'FALL IN'. The nearest prompt wins, so one of the two was always
     unreachable and which one was a coin toss. The map is unaffected
     — it only draws landmarks you have opened — and the district
     itself is still the secret that reveals the black hole on it.
     ------------------------------------------------------------ */

  /* ---- MAZE ---------------------------------------------- */
  {
    id: 'maze-entry', district: 'maze', label: 'LABYRINTH',
    sublabel: 'ENTER TO START THE CLOCK',
    // The mouth. Labyrinth.ts builds the walls around the district
    // centre and puts its opening on the north face; the arch stands
    // across that opening, turned to face the road that arrives from
    // the north so the name is not on the back of the gate.
    x: ZONES.maze.x, z: ZONES.maze.z - ZONES.maze.size * 0.5 - 6,
    rotation: Math.PI,
    /* SCENERY, NOT A TRIGGER. `Labyrinth.buildEntrance` puts its own
       prompt one metre from here, and the nearest prompt wins — so
       two prompts on one spot means one of them cannot be reached
       and which one is a coin toss. The mini-game keeps the prompt,
       because it is the one that states the rule and the clock and
       starts the run; the gate keeps the words.

       The `achievement: 'labyrinth'` this used to carry was not an
       achievement id at all. The labyrinth's is `pathFound`, and
       `Labyrinth` awards it at the centre, where it is earned. */
    visual: 'gate', interaction: 'none',
  },
]

/* ============================================================
   PATHS

   The drawing's brown tracks, straight out of the plan. Compact
   earth rather than asphalt: the only tarmac on this island is
   the circuit, which is what makes the circuit read as a circuit
   from above.
   ============================================================ */

const PATH_WIDTHS: Record<string, number> = {
  landing_bridge_social: 9,
  social_bowling: 8,
  bridge_bowling_east: 8,
  bowling_projects: 8,
  landing_projects: 9,
  landing_ramp: 8,
  east_coast_road: 7,
  landing_south_spine: 8,
  landing_maze_road: 8,
  // Six, not eight. It is a spur that arrives at the maze's mouth, and
  // the mouth is six metres outside a forty-two-metre square of solid
  // wall: a wider carriageway cannot reach it without standing on it.
  timemachine_maze: 6,
  landing_racestart: 9,
  south_shore_road: 7,
  bowling_west_spur: 7,
}

export const roads: { id: string; points: [number, number][]; width: number; surface?: 'dirt' }[] =
  PATHS.map((path) => ({
    id: path.id.replace(/_/g, '-'),
    width: PATH_WIDTHS[path.id] ?? 8,
    surface: 'dirt' as const,
    points: path.points.map(([x, z]) => [x, z] as [number, number]),
  }))

/* ============================================================
   RAMPS AND JUMPS
   ============================================================ */

export interface Ramp {
  id: string
  x: number
  z: number
  rotation: number
  /** Length along the slope. */
  length: number
  width: number
  height: number
  size: 'small' | 'medium' | 'large'
  achievement?: string
}

export const ramps: Ramp[] = [
  /* THE RAMP, where the drawing puts it and pointing where the
     drawing's arrow points: east, off the grass, over the beach and
     into the shallows. The landing is water on purpose — it is the
     only water on the island you are supposed to end up in.

     It used to say "the shelf there is 0.6 m deep, so you drive out
     again", and the general beach shelf is — for the fifteen metres
     past the waterline that every other stretch of coast gets. A
     full-boost launch off 5.6 m flies seventy-eight, so the claim was
     false for the only run that clears the lip at all: the car went
     eleven metres under and was recovered by the drowning rule. The
     shallows are now carried out under the whole flight —
     `Terrain.LANDING_SHOALS`, derived from THIS table, so a ramp
     turned inland stops carrying one. */
  {
    id: 'ramp-east', x: ZONES.ramp.x, z: ZONES.ramp.z, rotation: ZONES.ramp.rotation,
    /* 6.6 m, not 5.6. The deck is built from its FOOT so that the low
       end cannot be a step (see World.buildRamps), and on rising ground
       that puts the base plane below the levelled pad around it — the
       lip cleared the ground by 4.77 m of a 5.6 m ramp. A metre back
       makes the jump the size it says it is: measured, 5.8 m of air. */
    length: ZONES.ramp.length, width: ZONES.ramp.width, height: 6.6,
    size: 'large', achievement: 'airborne',
  },
  /*
     THE CIRCUIT JUMP, ON THE SOUTH RUN, read off the racing line at
     CIRCUIT.jumpAt (0.60 of a 633 m lap) and written down.

     RE-DERIVE IT WHENEVER THE CENTRELINE MOVES, and note that scaling
     it is not re-deriving it: the island shrank by 30% and this point
     was multiplied by 0.7 along with everything else, which left the
     ramp THIRTY METRES off a racing line whose SHAPE the relaxer had
     also changed. A jump nobody can reach is worse than no jump. The
     width follows CIRCUIT.width so the ramp spans the track rather
     than a memory of how wide it used to be.
  */
  { id: 'ramp-circuit-jump', x: -64.3, z: 71.6, rotation: -0.05, length: 16, width: CIRCUIT.width, height: 2.4, size: 'medium' },
  /*
    A STARTER BUMP, AND ITS THIRD ADDRESS.

    It stood on the LANDING forecourt, which on a 266 m island has no
    twelve-metre hole left in it; then on the open run towards the
    labyrinth, which turned out to be the labyrinth's own approach the
    moment that approach became a footprint anything could see; then
    here, at (104, 8), where two things were wrong at once and neither
    was visible.

    Its RUN-UP WAS THE SEA. `rotation` PI*0.92 points the slope
    west-north-west, so the approach runs in from the east — and
    (104, 8) is 9.7 m inland. Measured, the ground ten metres behind
    the foot sits 1.33 m BELOW sea level and fifteen metres behind it
    is the ocean floor; two of three full-speed runs from the run-up
    the registry reserves ended in the water. Nothing checked: the
    landing shoal tests what is thirty metres PAST the lip and nothing
    tested what is behind the foot.

    And its lip stood inside the labyrinth's approach pad, which the
    registry could not see while a square pad was registered as the
    disc inside it.

    (104, 16) facing 285 degrees fixes both: 28 m of run-up and deck
    with 1.82 m of relief and a 10.8 degree maximum gradient, a
    minimum coast inset of 11.5 m over the whole run-up — which also
    shuts the shore's own valve, since it is fully open only inside
    8 m — and 30 m of landing at 0.51 to 0.65 m. That is an eight
    metre move.
  */
  { id: 'ramp-landing', x: 104, z: 16, rotation: 4.9742, length: 12, width: 7, height: 2.2, size: 'small' },
]

/* ============================================================
   TIMELINE STRIP
   Four year plates on the landing forecourt. Driving them in
   order unlocks TIME TRAVELLER.
   ============================================================ */

export const timelinePlates = [
  // WEST of the south spine, on open forecourt: landing on a plate
  // fires TIME TRAVELLER, and a plate under a road fires it every time
  // you drive past.
  { year: '2023', x: 35.8, z: 13.4 },
  { year: '2024', x: 24.5, z: 13.3 },
  { year: '2025', x: 26.6, z: 20.3 },
  { year: '2026', x: 33.6, z: 22.4 },
]

/* ============================================================
   DEV NOTES
   Short hidden notes, found by driving over their marker.
   ============================================================ */

export const devNotes: { id: string; x: number; z: number; text: string }[] = [
  { id: 'note-1', x: 49, z: 4.2, text: 'Built this at 2am. It shows in the commit messages.' },
  { id: 'note-2', x: 21, z: -23.8, text: 'The bridge took longer than the river.' },
  { id: 'note-3', x: -8.4, z: -53.2, text: 'Two degrees, one city, no plan to stop.' },
  { id: 'note-4', x: 9.8, z: -72.8, text: 'I have never bowled a real strike. This one counts.' },
  { id: 'note-5', x: 64.4, z: -42, text: 'Some of these are scaffolds. They are in the archive anyway.' },
  { id: 'note-6', x: 78.4, z: -14, text: 'Take a run-up. Then take a longer one.' },
  { id: 'note-7', x: 54.6, z: 33.6, text: 'This bug took longer than the feature.' },
  { id: 'note-8', x: 96.6, z: 53.2, text: 'The maze has one solution. I checked.' },
  { id: 'note-9', x: -72.8, z: 43.4, text: 'Do not take the inside line here. Or do.' },
  { id: 'note-10', x: -109.2, z: -8.4, text: 'The fastest part of the lap is also the narrowest.' },
  { id: 'note-11', x: -46.2, z: -19.6, text: 'Half a million documents. I read approximately none of them.' },
  { id: 'note-12', x: 70, z: 51.8, text: 'It does not go anywhere. It goes when.' },
  { id: 'note-13', x: -68.6, z: -54.6, text: 'Nothing escapes. Except the racing line.' },
]

/* ============================================================
   DERIVED HELPERS
   ============================================================ */

export const landmarkById = Object.fromEntries(landmarks.map((l) => [l.id, l]))

/** Re-exported so the engine reads projects through one door. */
export const projectsBySlugForWorld = projectBySlug

export function landmarksOf(district: DistrictId) {
  return landmarks.filter((l) => l.district === district)
}
/** Resolves a landmark's `ref` into display copy from the content layer. */
export interface ResolvedPanel {
  title: string
  eyebrow?: string
  lines: string[]
  metrics: { label: string; value: string }[]
  technologies: string[]
  links: { label: string; href: string }[]
  projectSlug?: string
}

export function resolvePanel(landmark: Landmark): ResolvedPanel | null {
  const ref = landmark.ref

  if (!ref) {
    if (!landmark.panel) return null
    return {
      title: landmark.panel.title,
      lines: landmark.panel.lines,
      metrics: [],
      technologies: [],
      links: [],
    }
  }

  if (ref.kind === 'project') {
    const project = projectBySlug[ref.id]
    if (!project) return null
    return {
      title: project.title,
      eyebrow: [project.subcategory ?? project.category, project.dates ?? project.year]
        .filter(Boolean)
        .join(' · '),
      lines: [project.description, ...(project.contribution ? [project.contribution] : [])],
      metrics: project.metrics.map((m) => ({ label: m.label, value: m.value })),
      technologies: project.technologies,
      links: [
        ...(project.repository && !project.privateSource
          ? [{ label: 'Source', href: project.repository }]
          : []),
        ...(project.liveUrl ? [{ label: 'Live site', href: project.liveUrl }] : []),
      ],
      projectSlug: project.slug,
    }
  }

  if (ref.kind === 'experience') {
    const role = experience.find((e) => e.id === ref.id)
    if (!role) return null
    return {
      title: role.role,
      eyebrow: `${role.organisation} · ${role.dates}`,
      lines: [role.summary, ...role.facts],
      metrics: role.metrics.map((m) => ({ label: m.label, value: m.value })),
      technologies: role.technologies,
      links: [],
    }
  }

  if (ref.kind === 'education') {
    const school = education.find((e) => e.id === ref.id)
    if (!school) return null
    return {
      title: school.institution,
      eyebrow: `${school.degree} · ${school.dates}`,
      lines: [
        ...(school.result ? [school.result] : []),
        ...school.modules.map((m) => `${m.name} — ${m.blurb}`),
      ],
      metrics: [],
      technologies: [],
      links: [],
    }
  }

  // profile
  return {
    title: 'ALEJANDRO NEWPORT',
    eyebrow: 'Spain → London',
    lines: [
      'Software Engineer · AI Engineer · ML Engineer',
      'Product Engineer · Creative Developer · Founder / Engineer',
      '',
      'Computer scientist and engineer building intelligent products across software, AI, data and interactive systems.',
    ],
    metrics: [],
    technologies: [],
    links: [{ label: 'Full portfolio', href: '/' }],
  }
}

/** Sanity check in development: every ref must resolve. */
if (process.env.NODE_ENV === 'development') {
  for (const landmark of landmarks) {
    if (landmark.ref && !resolvePanel(landmark)) {
      console.warn(`[world] landmark "${landmark.id}" has an unresolvable ref`, landmark.ref)
    }
  }
}


/* ============================================================
   THE PROJECTS ARCHIVE

   The island used to give nine projects a district each and put
   the rest on islands in an archive ring — twenty-six separate
   places for one body of work. The drawing has one PROJECTS, so
   this is one place: a terminal you press ENTER on, which opens
   the whole archive as an overlay, and a ring of plinths around
   it carrying the eight featured pieces so the place has
   something in it to drive at.

   NO PROJECT DATA IS LOST. `projects/*` is untouched, every
   project is in `PROJECT_GROUPS` below, and the scroll journey at
   `/` still renders all of it. What went away is districts.
   ============================================================ */

export interface ProjectGroup {
  id: string
  label: string
  slugs: string[]
}

const GROUP_ORDER: { id: string; label: string; match: (p: (typeof projects)[number]) => boolean }[] = [
  { id: 'featured', label: 'FEATURED', match: (p) => p.importance === 'featured' || p.importance === 'hero' },
  { id: 'ai-ml', label: 'AI & ML', match: (p) => p.category === 'ai-ml' || p.category === 'data' },
  { id: 'software', label: 'SOFTWARE', match: (p) => p.category === 'software' || p.category === 'mobile' },
  { id: 'web', label: 'WEB', match: (p) => p.category === 'web' },
  { id: '3d', label: '3D', match: (p) => p.category === '3d' },
  { id: 'university', label: 'UNIVERSITY', match: (p) => p.source === 'university' || p.category === 'university' },
  { id: 'client', label: 'CLIENT WORK', match: (p) => p.source === 'client' || p.category === 'client-work' },
  { id: 'experiments', label: 'EXPERIMENTS', match: (p) => p.category === 'experiment' },
]

/** Every project, grouped for the archive overlay. A project appears in
 *  FEATURED and in its category — the overlay is a browser, not a
 *  partition, and hiding a featured project from AI & ML would be a
 *  strange thing to do to someone looking for it there. */
export const PROJECT_GROUPS: ProjectGroup[] = GROUP_ORDER.map((group) => ({
  id: group.id,
  label: group.label,
  slugs: projects.filter(group.match).map((p) => p.slug),
})).filter((group) => group.slugs.length > 0)

/**
 * The eight that get a physical plinth.
 *
 * EIGHT, capped. `importance` is 'hero' or 'featured' on eighteen of the
 * forty-three, and eighteen four-metre plinths around a twenty-metre
 * ring is not a courtyard, it is a wall of pale discs with no way
 * through it — which is what it looked like from above. The other
 * thirty-five are in the terminal, which is the whole reason the
 * island stopped needing a district each.
 */
export const FEATURED_SLUGS: string[] = projects
  .filter((p) => p.importance === 'hero' || p.importance === 'featured')
  .sort((a, b) => (a.importance === b.importance ? 0 : a.importance === 'hero' ? -1 : 1))
  .slice(0, 8)
  .map((p) => p.slug)

export interface ProjectPlinth {
  id: string
  project: string
  x: number
  z: number
  rotation: number
  scale: number
}

let plinthCache: ProjectPlinth[] | null = null

/**
 * LAZY, and it has to be: `world-layout` imports this module, so
 * running the generator at module-evaluation time would call into a
 * half-initialised registry. Computing it on first use puts the call
 * safely after both modules have finished loading. Memoised, so the
 * layout is identical every time it is asked for.
 */
export function projectPlinths(): ProjectPlinth[] {
  if (plinthCache) return plinthCache
  const placed: Zone[] = []
  const centre = districtById.projects
  plinthCache = FEATURED_SLUGS.map((slug, i, all) => {
    // Two rings, so eight plinths read as a courtyard rather than a
    // fence: the odd ones sit further out and between their neighbours.
    const angle = (i / all.length) * Math.PI * 2 + 0.35
    const radius = i % 2 === 0 ? 19 : 30
    const spot = findNear(
      centre.x, centre.z, radius, angle,
      { clearance: 3.5, allow: ['respawn', 'plate', 'district'], margin: { water: 6, road: 2 }, extra: placed },
    )
    placed.push({ id: slug, kind: 'landmark', x: spot.x, z: spot.z, radius: 5.5 })
    return {
      id: `project-${slug}`,
      project: slug,
      x: spot.x,
      z: spot.z,
      rotation: -angle + Math.PI * 0.5,
      scale: 0.45,
    }
  })
  return plinthCache
}

/*
  NO PROJECT MAY FALL OUT OF THE ISLAND.

  The whole justification for deleting nine districts is that every one
  of their projects is still reachable — from one terminal instead of
  from nine places. That is a claim about a filter chain, and a filter
  chain is exactly the sort of thing that silently drops an entry when
  a category is renamed. So it is checked.
*/
if (process.env.NODE_ENV === 'development') {
  const reachable = new Set(PROJECT_GROUPS.flatMap((group) => group.slugs))
  const lost = projects.filter((project) => !reachable.has(project.slug))
  if (lost.length) {
    console.warn(
      `[world] ${lost.length} project(s) are in no archive group and cannot be reached from the world:`,
      lost.map((p) => p.slug),
    )
  }
}
