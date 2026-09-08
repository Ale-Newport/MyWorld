import type { ChapterId, Theme } from './types'
import { projects, projectBySlug } from './projects'
import { experience } from './experience'
import { education } from './education'

/* ============================================================
   ALEJANDRO'S WORLD — SPATIAL PRESENTATION LAYER

   This file adds *where things stand* to the portfolio. It adds
   no facts. Every claim the /world route makes is read from
   `experience.ts`, `education.ts`, `projects/*` and `profile.ts`
   through the `ref` field below, so updating a project updates
   the scroll journey and the world at the same time.

   Coordinates are metres in the physics world. +X is east, +Z
   is south, Y is up. The vehicle is ~2.6 m long and tops out
   around 10 m/s cruising and ~35 m/s boosting, so a 90 m hop
   between districts is a few seconds of driving.
   ============================================================ */

export type DistrictId =
  | 'hub'
  | 'kcl'
  | 'teaching'
  | 'algorithms'
  | 'ucl'
  | 'lab'
  | 'chess'
  | 'stock'
  | 'focus'
  | 'gym'
  | 'client'
  | 'circuit'
  | 'labyrinth'
  | 'voxel'
  | 'network'
  | 'studio'
  | 'orbit'
  | 'archive'
  | 'void'

/** How a landmark is built in 3D. One builder per value. */
export type LandmarkVisual =
  | 'sign'
  | 'monument'
  | 'billboard'
  | 'browserTower'
  | 'device'
  | 'idCard'
  | 'graphSculpture'
  | 'processBlocks'
  | 'cipherWall'
  | 'databaseTower'
  | 'moduleStack'
  | 'researchShell'
  | 'dataField'
  | 'chessboard'
  | 'orderBook'
  | 'station'
  | 'gate'
  | 'island'
  | 'terminal'
  | 'duck'
  | 'bracket'

/** What pressing ENTER inside the landmark's radius does. */
export type LandmarkInteraction =
  | 'project'
  | 'panel'
  | 'minigame'
  | 'link'
  | 'note'
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
   * only where one continuous surface actually matters (a board, a
   * maze floor, a slab of asphalt, paving the letters lie on).
   */
  plate?: number
  theme: Theme
  accent: string
  /** One line. Shown when the district is first entered. */
  blurb: string
  /** Corresponding chapter in the scroll journey, for cross-links. */
  chapter?: ChapterId
  /** Ground treatment used by the terrain builder. */
  ground: 'paper' | 'plate' | 'grid' | 'dark' | 'voxel' | 'asphalt' | 'water'
  /** Districts are revealed on the map only once visited. */
  secret?: boolean
  /** Signposted from the hub. */
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

export type MinigameId =
  | 'circuit'
  | 'labyrinth'
  | 'chess'
  | 'pipeline'
  | 'retrieval'
  | 'orderRush'
  | 'gymCircuit'
  | 'threeBody'
  | 'packets'
  | 'bowling'
  | 'debugDash'
  | 'riverRun'
  | 'chipRelay'
  | 'domino'
  | 'deployment'

/* ============================================================
   DISTRICTS
   The macro map. Roughly the arrangement in the brief: the lab
   to the north, the two universities east and west of the hub,
   products and client work to the south.
   ============================================================ */

export const districts: District[] = [
  {
    id: 'hub',
    label: 'CENTRAL HUB',
    short: 'HOME',
    x: 18, z: -2, radius: 32, plate: 30,
    theme: 'light', accent: '#d4491f',
    ground: 'paper',
    blurb: 'Where the name is written large enough to drive on.',
    chapter: 'prelude',
    signposted: true,
  },
  {
    id: 'lab',
    label: 'AI LAB',
    short: 'AI LAB',
    x: 48, z: -96, radius: 26, plate: 18,
    theme: 'dark', accent: '#d4491f',
    ground: 'dark',
    blurb: 'Metaview. Half a million documents, standing up as light.',
    chapter: 'metaview',
    signposted: true,
  },
  {
    id: 'kcl',
    label: "KING'S COLLEGE LONDON",
    short: 'KCL',
    x: -2, z: -40, radius: 32,
    theme: 'light', accent: '#8d8467',
    ground: 'plate',
    blurb: 'Foundations. Five modules, built as five structures.',
    chapter: 'kcl',
    signposted: true,
  },
  {
    id: 'ucl',
    label: 'UNIVERSITY COLLEGE LONDON',
    short: 'UCL',
    x: 90, z: -34, radius: 30,
    theme: 'light', accent: '#5f8490',
    ground: 'plate',
    blurb: 'The next degree. Still under construction, on purpose.',
    chapter: 'ucl',
    signposted: true,
  },
  {
    id: 'teaching',
    label: 'DEBUG YARD',
    short: 'TEACHING',
    x: -4, z: 28, radius: 20,
    theme: 'light', accent: '#2f6f5e',
    ground: 'grid',
    blurb: 'Graduate Teaching Assistant. Knock the failing blocks over.',
    chapter: 'teaching',
    signposted: true,
  },
  {
    id: 'algorithms',
    label: 'ALGORITHM FIELD',
    short: 'ALGOS',
    x: 4, z: 68, radius: 26,
    theme: 'light', accent: '#6f6f76',
    ground: 'grid',
    blurb: 'Search, games and experiments. The things built for the sake of building.',
    chapter: 'playground',
    signposted: true,
  },
  {
    id: 'focus',
    label: 'FOCUS',
    short: 'FOCUS',
    x: 52, z: 22, radius: 24,
    theme: 'light', accent: '#d4491f',
    ground: 'plate',
    blurb: 'A phone the size of a building, and the pipeline that fills it.',
    chapter: 'focus',
    signposted: true,
  },
  {
    id: 'gym',
    label: 'GYM APP',
    short: 'GYM',
    x: 48, z: 62, radius: 20,
    theme: 'light', accent: '#2f6f5e',
    ground: 'plate',
    blurb: 'One rigged athlete. Many exercises. Drive the circuit.',
    chapter: 'gym',
    signposted: true,
  },
  {
    id: 'client',
    label: 'CLIENT CITY',
    short: 'CLIENTS',
    x: 108, z: 32, radius: 24,
    theme: 'light', accent: '#a8683f',
    ground: 'asphalt',
    blurb: 'Pansofía / Grupo Newport. Fourteen sites, shipped as towers.',
    chapter: 'pansofia',
    signposted: true,
  },
  {
    id: 'chess',
    label: 'CHESS TERMINAL',
    short: 'CHESS',
    x: -6, z: -80, radius: 14, plate: 13,
    theme: 'dark', accent: '#d4491f',
    ground: 'dark',
    blurb: 'Camera to CNN to FEN to engine. Park and solve one.',
    chapter: 'chess',
    signposted: true,
  },
  {
    id: 'stock',
    label: 'EXCHANGE',
    short: 'MARKET',
    x: 66, z: -72, radius: 24,
    theme: 'dark', accent: '#2f6f5e',
    ground: 'dark',
    blurb: 'Forty thousand trades, matched between two moving walls.',
    chapter: 'stock',
    signposted: true,
  },
  {
    id: 'circuit',
    label: 'RACE CIRCUIT',
    short: 'CIRCUIT',
    x: -42, z: 88, radius: 26, plate: 26,
    theme: 'light', accent: '#d4491f',
    ground: 'asphalt',
    blurb: 'Three laps. Your best time lives in this browser.',
    signposted: true,
  },
  {
    id: 'labyrinth',
    label: 'LABYRINTH',
    short: 'MAZE',
    x: 98, z: -66, radius: 22, plate: 24,
    theme: 'light', accent: '#6f6f76',
    ground: 'plate',
    blurb: 'A real maze with a real centre. No shortcuts through the walls.',
  },
  {
    id: 'voxel',
    label: 'SEED CHUNKS',
    short: 'VOXELS',
    x: 118, z: -6, radius: 20, plate: 20,
    theme: 'light', accent: '#8d8467',
    ground: 'voxel',
    blurb: 'The terrain gives up and becomes cubes.',
  },
  {
    id: 'network',
    label: 'TUNNEL',
    short: 'VPN',
    x: 76, z: -100, radius: 20,
    theme: 'dark', accent: '#5f8490',
    ground: 'dark',
    blurb: 'Two nodes, one hazard, and packets that stop being readable.',
  },
  {
    id: 'studio',
    label: 'KEYFRAMES',
    short: 'STUDIO',
    x: 104, z: 74, radius: 22, plate: 17,
    theme: 'light', accent: '#7d7488',
    ground: 'plate',
    blurb: 'An animation studio where the timeline drives the scenery.',
  },
  {
    id: 'orbit',
    label: 'THREE BODIES',
    short: 'ORBIT',
    x: 38, z: -46, radius: 14,
    theme: 'light', accent: '#2f6f5e',
    ground: 'plate',
    blurb: 'Three masses overhead, integrated live. Nudge one and watch it fail.',
  },
  {
    id: 'archive',
    label: 'PROJECT ARCHIVE',
    short: 'ARCHIVE',
    // Pulled south and tightened: at radius 70 it reached back over
    // the gym, and two districts claiming the same ground makes the
    // "you have arrived" toast meaningless.
    x: 34, z: 104, radius: 30, plate: 22,
    theme: 'light', accent: '#6f6f76',
    ground: 'plate',
    blurb: 'Everything smaller, kept honestly, on its own small island.',
    chapter: 'universe',
    signposted: true,
  },
  {
    id: 'void',
    label: '404',
    short: '404',
    // Past the edge of the world, on the bearing of the stunt ramp
    // and 91 m out from its lip — which is where a boosting car
    // actually comes down. See the island check in
    // scripts/world-qa.mjs; that distance is measured, not chosen.
    x: 20, z: -233, radius: 30, plate: 14,
    theme: 'dark', accent: '#d4491f',
    ground: 'water',
    blurb: 'You were not supposed to get here.',
    secret: true,
  },
]

export const districtById = Object.fromEntries(districts.map((d) => [d.id, d])) as Record<
  DistrictId,
  District
>

/** Radius of the drivable world. Beyond this the ground stops. */
export const WORLD_RADIUS = 160

/** Where a fresh visitor starts, facing the hub sign. */
export const SPAWN = { x: 0, y: 4, z: 26, rotation: Math.PI }

/* ============================================================
   RESPAWN POINTS
   `R` teleports to the nearest of these. One per district, plus
   a few along the long roads, so nowhere is a long walk back.
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
  { id: 'hub', x: 18, z: 10, rotation: 1.571, district: 'hub' },
  { id: 'hub-north', x: 18, z: -30, rotation: 4.712, district: 'hub' },
  // On the road in, facing the campus, and clear of the cipher wall
  // at (-126, -6) which the old point drove straight into.
  { id: 'kcl', x: 14, z: -40, rotation: 0, district: 'kcl' },
  { id: 'ucl', x: 99, z: -26, rotation: 5.564, district: 'ucl' },
  { id: 'lab', x: 52, z: -80, rotation: 3.142, district: 'lab' },
  { id: 'teaching', x: -15, z: 43, rotation: 4.084, district: 'teaching' },
  { id: 'algorithms', x: 7, z: 82, rotation: 1.798, district: 'algorithms' },
  // Clear of ramp-focus at (40, 96), which it used to sit on top of.
  { id: 'focus', x: 52, z: 38, rotation: 4.712, district: 'focus' },
  { id: 'gym', x: 42, z: 79, rotation: 4.364, district: 'gym' },
  { id: 'client', x: 112, z: 20, rotation: 4.391, district: 'client' },
  { id: 'chess', x: 12, z: -64, rotation: 0.278, district: 'chess' },
  { id: 'stock', x: 84, z: -92, rotation: 5.498, district: 'stock' },
  { id: 'circuit', x: -51, z: 81, rotation: 2.467, district: 'circuit' },
  { id: 'labyrinth', x: 124, z: -66, rotation: 3.142, district: 'labyrinth' },
  // Outside the voxel field's western edge, on open ground.
  { id: 'voxel', x: 110, z: -15, rotation: 2.279, district: 'voxel' },
  { id: 'network', x: 51, z: -101, rotation: 1.107, district: 'network' },
  { id: 'studio', x: 104, z: 92, rotation: 4.712, district: 'studio' },
  { id: 'orbit', x: 32, z: -30, rotation: 1.222, district: 'orbit' },
  { id: 'archive', x: 50, z: 103, rotation: 3.232, district: 'archive' },
  { id: 'road-west', x: -13.6, z: -10.1, rotation: Math.PI, district: 'hub' },
  { id: 'road-east', x: 49.6, z: -10.1, rotation: 0, district: 'hub' },
  { id: 'road-south', x: 20.4, z: 28, rotation: Math.PI * 0.5, district: 'hub' },
]

/* ============================================================
   LANDMARKS
   Positions are absolute, not district-relative, so a landmark
   can straddle a boundary without special-casing.
   ============================================================ */

const p = (id: string): ContentRef => ({ kind: 'project', id })
const xp = (id: string): ContentRef => ({ kind: 'experience', id })
const ed = (id: string): ContentRef => ({ kind: 'education', id })

export const landmarks: Landmark[] = [
  /* ---- HUB ---------------------------------------------- */
  {
    id: 'hub-name', district: 'hub', label: 'ALEJANDRO NEWPORT',
    x: 18, z: -7.7, visual: 'monument', interaction: 'none', scale: 1,
  },
  {
    id: 'hub-welcome', district: 'hub', label: 'WELCOME',
    sublabel: 'PRESS ENTER',
    x: 18, z: 2.9, visual: 'billboard', interaction: 'panel', radius: 7.7,
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
    id: 'hub-about', district: 'hub', label: 'ABOUT',
    x: 5.9, z: 1.2, rotation: Math.PI * 0.25, visual: 'idCard',
    interaction: 'panel', radius: 12, ref: { kind: 'profile' },
    achievement: 'about',
  },
  {
    id: 'hub-sign-kcl', district: 'hub', label: 'KCL', sublabel: 'EDUCATION',
    x: -4.5, z: -11.2, rotation: Math.PI, visual: 'sign', interaction: 'none',
  },
  {
    id: 'hub-sign-ucl', district: 'hub', label: 'UCL', sublabel: 'WHAT IS NEXT',
    x: 40.5, z: -11.2, rotation: 0, visual: 'sign', interaction: 'none',
  },
  {
    id: 'hub-sign-lab', district: 'hub', label: 'AI LAB', sublabel: 'METAVIEW',
    x: 14.8, z: -26.1, rotation: Math.PI * 1.5, visual: 'sign', interaction: 'none',
  },
  {
    id: 'hub-sign-circuit', district: 'hub', label: 'RACE TRACK', sublabel: 'BEST LAP',
    x: 32.6, z: -21.4, rotation: Math.PI * 1.75, visual: 'sign', interaction: 'none',
  },
  {
    id: 'hub-sign-client', district: 'hub', label: 'CLIENT WORK', sublabel: '14 SITES',
    x: 35.2, z: 15.2, rotation: Math.PI * 0.75, visual: 'sign', interaction: 'none',
  },
  {
    id: 'hub-sign-projects', district: 'hub', label: 'PROJECTS', sublabel: 'ARCHIVE',
    x: 9.9, z: 21, rotation: Math.PI * 0.5, visual: 'sign', interaction: 'none',
  },
  {
    id: 'hub-sign-focus', district: 'hub', label: 'PRODUCTS', sublabel: 'FOCUS · GYM',
    x: 3.4, z: 17.4, rotation: Math.PI * 0.35, visual: 'sign', interaction: 'none',
  },

  /* ---- KCL: five modules as five structures --------------- */
  {
    id: 'kcl-degree', district: 'kcl', label: "KING'S COLLEGE LONDON",
    sublabel: 'BSc COMPUTER SCIENCE',
    x: -2, z: -51.3, visual: 'billboard', interaction: 'panel', radius: 9.1,
    ref: ed('kcl'), achievement: 'kcl',
  },
  {
    id: 'kcl-data-structures', district: 'kcl', label: 'DATA STRUCTURES',
    x: -15.8, z: -41.6, visual: 'graphSculpture', interaction: 'panel', radius: 7,
    panel: {
      title: 'DATA STRUCTURES',
      lines: ['Nodes, edges, invariants, cost.', 'Drive through the graph — the edges are solid.'],
    },
  },
  {
    id: 'kcl-databases', district: 'kcl', label: 'DATABASE SYSTEMS',
    x: 9.3, z: -48.1, visual: 'databaseTower', interaction: 'panel', radius: 7,
    panel: {
      title: 'DATABASE SYSTEMS',
      lines: ['Relational algebra, indexing, transactions.', 'The tower is a B-tree. The top page is the root.'],
    },
  },
  {
    id: 'kcl-os', district: 'kcl', label: 'OPERATING SYSTEMS',
    x: -12.5, z: -26.2, visual: 'processBlocks', interaction: 'panel', radius: 7,
    panel: {
      title: 'OPERATING SYSTEMS',
      lines: ['Processes, scheduling, memory, concurrency.', 'Each block is a process. They are scheduled, not static.'],
    },
  },
  {
    id: 'kcl-crypto', district: 'kcl', label: 'CRYPTOGRAPHY',
    x: 8.5, z: -30.3, visual: 'cipherWall', interaction: 'panel', radius: 7,
    panel: {
      title: 'CRYPTOGRAPHY',
      lines: ['Transformation, keys, guarantees.', 'The wall re-scrambles every time you look away.'],
    },
  },
  {
    id: 'kcl-se', district: 'kcl', label: 'SOFTWARE ENGINEERING',
    x: -2, z: -24.6, visual: 'moduleStack', interaction: 'panel', radius: 7,
    panel: {
      title: 'SOFTWARE ENGINEERING',
      lines: ['Modules assembling into one system.', 'Knock a module out and the stack still stands. Mostly.'],
    },
  },
  {
    id: 'kcl-orca', district: 'kcl', label: 'ORCA', sublabel: 'SCHEDULING',
    x: -19.8, z: -52.1, visual: 'monument', interaction: 'project', radius: 7,
    ref: p('orca'), scale: 0.7,
  },
  {
    id: 'kcl-tappedin', district: 'kcl', label: 'TAPPEDIN', sublabel: 'NLP + WEB',
    x: 15, z: -59.4, visual: 'monument', interaction: 'project', radius: 7,
    ref: p('tappedin'), scale: 0.7,
  },
  {
    id: 'kcl-library', district: 'kcl', label: 'MY LIBRARY',
    x: -17.4, z: -15.7, visual: 'monument', interaction: 'project', radius: 7,
    ref: p('my-library'), scale: 0.6,
  },

  /* ---- TEACHING / DEBUG YARD ------------------------------ */
  {
    id: 'teaching-role', district: 'teaching', label: 'GRADUATE TEACHING ASSISTANT',
    sublabel: "KING'S COLLEGE LONDON",
    x: -4, z: 18.3, visual: 'billboard', interaction: 'panel', radius: 8.4,
    ref: xp('kcl-gta'),
  },
  {
    id: 'teaching-bugs', district: 'teaching', label: 'FAIL',
    sublabel: 'KNOCK THEM DOWN',
    x: -4, z: 32.1, visual: 'processBlocks', interaction: 'none',
    achievement: 'debugger', scale: 1.2,
  },
  {
    id: 'teaching-duck', district: 'teaching', label: 'RUBBER DUCK',
    x: -12.9, z: 36.1, visual: 'duck', interaction: 'note', radius: 7,
    secret: true, achievement: 'duck',
    panel: { title: 'RUBBER DUCK', lines: ['Explain the bug out loud. It usually works.'] },
  },

  /* ---- ALGORITHM FIELD ------------------------------------ */
  {
    id: 'algo-cinquillo', district: 'algorithms', label: 'CINQUILLO 2.0',
    sublabel: 'GAME AI RESEARCH',
    x: 4, z: 57.5, visual: 'monument', interaction: 'project', radius: 7,
    ref: p('cinquillo-fair-variant'),
  },
  {
    id: 'algo-catan', district: 'algorithms', label: 'CATAN AI',
    x: -9, z: 68.8, visual: 'monument', interaction: 'project', radius: 7,
    ref: p('catan-ai'), scale: 0.7,
  },
  {
    id: 'algo-dots', district: 'algorithms', label: 'DOTS & BOXES',
    x: 15.3, z: 71.2, visual: 'monument', interaction: 'project', radius: 7,
    ref: p('dots-and-boxes'), scale: 0.7,
  },
  {
    id: 'algo-cinquillo-web', district: 'algorithms', label: 'CINQUILLO',
    x: -4.9, z: 80.2, visual: 'monument', interaction: 'project', radius: 7,
    ref: p('cinquillo'), scale: 0.6,
  },
  {
    id: 'algo-primes', district: 'algorithms', label: 'PRIMOS EN CLICK',
    x: 12.9, z: 83.4, visual: 'monument', interaction: 'project', radius: 7,
    ref: p('primes'), scale: 0.6,
  },

  /* ---- UCL ------------------------------------------------ */
  {
    id: 'ucl-degree', district: 'ucl', label: 'UNIVERSITY COLLEGE LONDON',
    sublabel: 'MSc AI & DATA ENGINEERING',
    x: 90, z: -45.3, visual: 'researchShell', interaction: 'panel', radius: 9.8,
    ref: ed('ucl'), achievement: 'ucl',
  },
  {
    id: 'ucl-ml', district: 'ucl', label: 'MACHINE LEARNING',
    x: 77.9, z: -35.6, visual: 'monument', interaction: 'panel', radius: 7, scale: 0.7,
    panel: { title: 'MACHINE LEARNING', lines: ['Statistical learning, optimisation, generalisation.'] },
  },
  {
    id: 'ucl-dl', district: 'ucl', label: 'APPLIED DEEP LEARNING',
    x: 102.2, z: -35.6, visual: 'monument', interaction: 'panel', radius: 7, scale: 0.7,
    panel: { title: 'APPLIED DEEP LEARNING', lines: ['Architectures, training regimes, representation.'] },
  },
  {
    id: 'ucl-mining', district: 'ucl', label: 'DATA MINING',
    x: 80.3, z: -21, visual: 'monument', interaction: 'panel', radius: 7, scale: 0.7,
    panel: { title: 'DATA MINING', lines: ['Pattern discovery at scale.'] },
  },
  {
    id: 'ucl-analysis', district: 'ucl', label: 'DATA ANALYSIS',
    x: 99.7, z: -21, visual: 'monument', interaction: 'panel', radius: 7, scale: 0.7,
    panel: { title: 'DATA ANALYSIS', lines: ['Inference, experiment design, uncertainty.'] },
  },
  {
    id: 'ucl-vv', district: 'ucl', label: 'VALIDATION & VERIFICATION',
    x: 90, z: -15.4, visual: 'monument', interaction: 'panel', radius: 7, scale: 0.7,
    panel: { title: 'VALIDATION & VERIFICATION', lines: ['Proving systems behave as specified.'] },
  },
  {
    id: 'ucl-ml-revision', district: 'ucl', label: 'ML REVISION ENGINE',
    x: 107.8, z: -13.7, visual: 'monument', interaction: 'project', radius: 7,
    ref: p('ml-revision'), scale: 0.6,
  },

  /* ---- AI LAB / METAVIEW ---------------------------------- */
  {
    id: 'lab-role', district: 'lab', label: 'METAVIEW',
    sublabel: 'AI & DATA ANALYSIS ENGINEER',
    x: 48, z: -85.5, visual: 'billboard', interaction: 'panel', radius: 9.8,
    ref: xp('metaview'), achievement: 'lab',
  },
  {
    id: 'lab-corpus', district: 'lab', label: 'CORPUS',
    sublabel: 'DRIVE INTO IT',
    x: 48, z: -103.3, visual: 'dataField', interaction: 'none', scale: 1.4,
  },
  {
    id: 'lab-retrieval', district: 'lab', label: 'RETRIEVAL',
    sublabel: 'QUERY → EMBED → RETRIEVE → GENERATE',
    x: 34.2, z: -107.3, visual: 'terminal', interaction: 'minigame', radius: 7,
    minigame: 'retrieval', achievement: 'retrieval',
  },
  {
    id: 'lab-vision', district: 'lab', label: 'VISION',
    sublabel: '50K+ IMAGES · 92% ACCURACY',
    x: 62.6, z: -107.3, visual: 'monument', interaction: 'panel', radius: 7, scale: 0.8,
    panel: {
      title: 'IMAGE CLASSIFICATION',
      lines: [
        'Trained and evaluated a classifier over a 50,000+ image dataset.',
        '92% classification accuracy. Manual labelling time down 70%.',
      ],
    },
  },

  /* ---- CHESS ---------------------------------------------- */
  {
    id: 'chess-board', district: 'chess', label: 'CHESS ASSISTANT',
    sublabel: 'CAMERA → CNN → FEN → STOCKFISH',
    x: -6, z: -80, visual: 'chessboard', interaction: 'minigame', radius: 9.8,
    ref: p('chess-assistant'), minigame: 'chess', achievement: 'checkmate',
  },

  /* ---- STOCK ---------------------------------------------- */
  {
    id: 'stock-book', district: 'stock', label: 'STOCK MARKET SIMULATOR',
    sublabel: '40K+ TRADES',
    x: 66, z: -72, visual: 'orderBook', interaction: 'minigame', radius: 9.1,
    ref: p('stock-market-simulator'), minigame: 'orderRush', achievement: 'orderRush',
  },
  {
    id: 'stock-ticker', district: 'stock', label: 'ANP',
    sublabel: 'FICTIONAL TICKER',
    x: 77.3, z: -81.7, visual: 'billboard', interaction: 'note', radius: 7,
    secret: true, achievement: 'ticker', scale: 0.7,
    panel: { title: 'ANP', lines: ['Not investment advice. Not a real security.', 'Purely decorative volatility.'] },
  },

  /* ---- FOCUS ---------------------------------------------- */
  {
    id: 'focus-device', district: 'focus', label: 'FOCUS',
    sublabel: 'DRIVE INSIDE',
    x: 52, z: 22, visual: 'device', interaction: 'project', radius: 11.2,
    ref: p('focus'), scale: 1,
  },
  {
    id: 'focus-pipeline', district: 'focus', label: 'VIDEO PIPELINE',
    sublabel: 'SCRIPT → VOICE → VISUALS → CAPTIONS → RENDER',
    x: 52, z: 35.8, visual: 'station', interaction: 'minigame', radius: 8.4,
    minigame: 'pipeline', achievement: 'contentEngine',
  },
  {
    id: 'focus-role', district: 'focus', label: 'CO-FOUNDER & DEVELOPER',
    x: 40.7, z: 12.3, visual: 'billboard', interaction: 'panel', radius: 7,
    ref: xp('focus'), scale: 0.8,
  },

  /* ---- GYM ------------------------------------------------ */
  {
    id: 'gym-app', district: 'gym', label: 'GYM APP',
    sublabel: 'ONE MODEL · MANY MOVEMENTS',
    x: 48, z: 62, visual: 'monument', interaction: 'project', radius: 8.4,
    ref: p('gym-app'),
  },
  {
    id: 'gym-circuit', district: 'gym', label: 'GYM CIRCUIT',
    sublabel: 'PUSH · PULL · LEGS · CORE',
    x: 48, z: 73.3, visual: 'gate', interaction: 'minigame', radius: 7.7,
    minigame: 'gymCircuit', achievement: 'gymCircuit',
  },

  /* ---- CLIENT CITY ---------------------------------------- */
  {
    id: 'client-count', district: 'client', label: '14',
    sublabel: 'WEBS SHIPPED',
    x: 108, z: 16.6, visual: 'monument', interaction: 'panel', radius: 9.1,
    ref: xp('pansofia'), achievement: 'client', scale: 1.3,
  },

  /* ---- CIRCUIT -------------------------------------------- */
  {
    id: 'circuit-start', district: 'circuit', label: 'START / FINISH',
    sublabel: '3 LAPS',
    x: -42, z: 110.7, visual: 'gate', interaction: 'minigame', radius: 8.4,
    minigame: 'circuit', achievement: 'speedDemon',
  },

  /* ---- LABYRINTH ------------------------------------------ */
  {
    id: 'labyrinth-entry', district: 'labyrinth', label: 'LABYRINTH',
    sublabel: 'FIND THE CENTRE',
    x: 98, z: -49.8, visual: 'gate', interaction: 'project', radius: 7.7,
    ref: p('labyrinth'), minigame: 'labyrinth',
  },
  {
    id: 'labyrinth-prize', district: 'labyrinth', label: 'CENTRE',
    x: 98, z: -66, visual: 'monument', interaction: 'none', radius: 7,
    secret: true, achievement: 'pathFound', scale: 0.5,
  },

  /* ---- VOXEL ---------------------------------------------- */
  {
    id: 'voxel-seed', district: 'voxel', label: 'MINECRAFT SEED FINDER',
    sublabel: 'PROCEDURAL SEARCH',
    x: 109.1, z: -12.5, visual: 'monument', interaction: 'project', radius: 7,
    ref: p('minecraft-seeds'),
  },
  {
    id: 'voxel-room', district: 'voxel', label: 'UNDERGROUND',
    x: 123.7, z: 1.3, visual: 'terminal', interaction: 'note', radius: 7,
    secret: true, achievement: 'underground',
    panel: {
      title: 'UNDERGROUND',
      lines: ['You found the room under the chunks.', 'Built at 2am. Left in on purpose.'],
    },
  },

  /* ---- NETWORK / VPN -------------------------------------- */
  {
    id: 'vpn-node-a', district: 'network', label: 'NODE A',
    x: 64.7, z: -100, visual: 'monument', interaction: 'project', radius: 7,
    ref: p('vpn'), scale: 0.8,
  },
  {
    id: 'vpn-node-b', district: 'network', label: 'NODE B',
    sublabel: 'ENCRYPTED TUNNEL',
    x: 87.3, z: -100, visual: 'monument', interaction: 'minigame', radius: 7,
    minigame: 'packets', scale: 0.8, achievement: 'tunnel',
  },

  /* ---- STUDIO / KEYFRAMES --------------------------------- */
  {
    id: 'studio-keyframes', district: 'studio', label: 'KEYFRAMES',
    sublabel: 'PLAY · PAUSE · REVERSE',
    x: 104, z: 74, visual: 'station', interaction: 'project', radius: 8.4,
    ref: p('keyframes'),
  },
  {
    id: 'studio-video', district: 'studio', label: 'VIDEO PLAYER',
    x: 114.5, z: 64.3, visual: 'monument', interaction: 'project', radius: 7,
    ref: p('video-player'), scale: 0.6,
  },

  /* ---- ORBIT / THREE BODY --------------------------------- */
  {
    id: 'orbit-system', district: 'orbit', label: 'THREE BODY PROBLEM',
    sublabel: 'NUDGE ONE',
    x: 38, z: -46, visual: 'monument', interaction: 'minigame', radius: 8.4,
    ref: p('three-body-problem'), minigame: 'threeBody', achievement: 'chaosTheory',
  },

  /* ---- ARCHIVE ISLANDS ------------------------------------ */
  {
    id: 'archive-sign', district: 'archive', label: 'PROJECT ARCHIVE',
    sublabel: 'EVERYTHING ELSE',
    x: 34, z: 79.7, visual: 'billboard', interaction: 'panel', radius: 8.4,
    panel: {
      title: 'PROJECT ARCHIVE',
      lines: [
        'The smaller work, kept as it is rather than dressed up.',
        'Each island is one repository. Drive up and press ENTER.',
      ],
    },
  },

  /* ---- SECRETS -------------------------------------------- */
  {
    id: 'secret-devroom', district: 'hub', label: 'DEV ROOM',
    x: 4, z: -6, visual: 'terminal', interaction: 'note', radius: 7,
    secret: true, achievement: 'devRoom',
    panel: {
      title: 'DEV ROOM',
      lines: [
        'Under the sign there is a room.',
        '',
        'The engine here is a port of Bruno Simon’s folio-2025 (MIT).',
        'The world, the art and the mistakes are mine.',
        'Source: github.com/Ale-Newport',
      ],
    },
  },
  {
    id: 'secret-island', district: 'void', label: 'HIDDEN ISLAND',
    x: 20, z: -233, visual: 'island', interaction: 'note', radius: 11.2,
    secret: true, achievement: 'hiddenIsland',
    panel: {
      title: 'THE VOID',
      lines: ['Nothing is supposed to be rendered here.', 'And yet.'],
    },
  },
  {
    id: 'secret-brackets', district: 'hub', label: '{ }',
    sublabel: 'JUMP THROUGH',
    x: 41.5, z: 0.4, rotation: Math.PI * 0.5, visual: 'bracket', interaction: 'none',
    achievement: 'shipIt',
  },
]

/* ============================================================
   ARCHIVE ISLANDS
   Generated from the project inventory rather than hand-listed,
   so a new archive project appears in the world automatically.
   ============================================================ */

/** Project slugs that already have a bespoke landmark above. */
const PLACED = new Set(
  landmarks
    .map((l) => (l.ref?.kind === 'project' ? l.ref.id : null))
    .filter((v): v is string => Boolean(v)),
)

/** Client sites get their own towers in Client City, laid out on a spiral. */
export const clientTowers = projects
  .filter((p) => p.source === 'client')
  .map((project, i, all) => {
    const angle = (i / all.length) * Math.PI * 2 + 0.4
    const radius = 20 + (i % 3) * 12
    return {
      id: `client-tower-${project.slug}`,
      project: project.slug,
      x: districtById.client.x + Math.cos(angle) * radius,
      z: districtById.client.z + Math.sin(angle) * radius,
      rotation: -angle + Math.PI * 0.5,
      height: project.importance === 'featured' ? 16 : 11,
      accent: project.accent ?? '#a8683f',
    }
  })

/** Everything not otherwise placed becomes an island in the archive ring. */
export const archiveIslands = projects
  .filter((p) => p.source !== 'client' && !PLACED.has(p.slug))
  .map((project, i, all) => {
    const angle = (i / all.length) * Math.PI * 2
    const radius = 34 + ((i * 7) % 3) * 13
    return {
      id: `archive-${project.slug}`,
      project: project.slug,
      x: districtById.archive.x + Math.cos(angle) * radius,
      z: districtById.archive.z + Math.sin(angle) * radius * 0.78,
      rotation: -angle,
      scale: project.importance === 'featured' ? 0.85 : 0.62,
    }
  })

/* ============================================================
   ROADS
   Polylines the terrain builder paints and the map draws. They
   are cosmetic: nothing stops you driving across the grass.
   ============================================================ */

export const roads: { id: string; points: [number, number][]; width: number }[] = [
  /* ---- the ring ----------------------------------------------
     One loop through the whole eastern half. Every district sits ON
     it, so leaving one puts the next one ahead rather than back the
     way you came. */
  { id: 'ring-north', width: 10, points: [[18, -2], [30, -24], [38, -46], [52, -62], [66, -72], [58, -88], [48, -96], [62, -100], [76, -100]] },
  { id: 'ring-east', width: 10, points: [[76, -100], [92, -84], [98, -66], [96, -50], [90, -34], [106, -20], [118, -6], [114, 14], [108, 32], [108, 54], [104, 74]] },
  { id: 'ring-south', width: 10, points: [[104, 74], [78, 92], [56, 102], [34, 104], [10, 94], [4, 68]] },
  { id: 'ring-west', width: 10, points: [[4, 68], [0, 48], [-4, 28], [2, 10], [18, -2]] },

  /* The spine cuts north to south through the ring, which is what
     makes its junctions crossroads instead of corners. */
  { id: 'spine', width: 9, points: [[18, -2], [30, 10], [52, 22], [50, 42], [48, 62], [40, 84], [34, 104]] },

  /* ---- branches ---------------------------------------------- */
  { id: 'hub-chess', width: 8, points: [[18, -2], [6, -20], [-2, -40], [-4, -60], [-6, -80]] },
  { id: 'lab-spur', width: 7, points: [[48, -96], [56, -112], [58, -118]] },

  /* Out of the content half and over to the track. */
  { id: 'circuit-link', width: 9, points: [[-4, 28], [-20, 50], [-32, 70], [-42, 88], [-52, 80]] },

  /* Dirt, unlit, and pointed at the stunt ramp. It stops where the
     ground does. */
  { id: 'void-run', width: 6, points: [[-4, -60], [6, -62], [20, -66], [20, -142]] },
]

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
  { id: 'ramp-hub-a', x: 28.5, z: 6.9, rotation: Math.PI * 0.25, length: 10, width: 7, height: 1.8, size: 'small' },
  { id: 'ramp-hub-b', x: 7.5, z: -14.1, rotation: Math.PI * 1.15, length: 12, width: 7, height: 2.4, size: 'small' },
  { id: 'ramp-brackets', x: 35.8, z: 0.4, rotation: Math.PI * 0.5, length: 18, width: 9, height: 5.2, size: 'medium', achievement: 'shipIt' },
  { id: 'ramp-kcl', x: -20.2, z: 14.2, rotation: Math.PI * 1.5, length: 16, width: 8, height: 4, size: 'medium' },
  { id: 'ramp-focus', x: 52, z: 7.4, rotation: Math.PI * 1.5, length: 20, width: 9, height: 6, size: 'medium', achievement: 'phoneHop' },
  // Aimed at the void island, 62 m away across the moat. The angle
  // is derived from that line, not chosen: point it anywhere else
  // and the achievement it carries becomes unreachable.
  // The stunt ramp, sized by measurement rather than by eye. At
  // 17 m over 40 m (23 degrees) the car spent its speed climbing and
  // barely left the lip; at 12 over 48 it cleared the island
  // entirely and landed in the sea beyond. 6.5 over 42 is about
  // 8.8 degrees, which puts a boosting car down on the island's flat
  // top with room either side. Change either number and the
  // achievement it carries stops being reachable — see the island
  // check in scripts/world-qa.mjs.
  { id: 'ramp-stunt', x: 20, z: -142, rotation: Math.PI * 0.5, length: 42, width: 13, height: 6.5, size: 'large', achievement: 'hiddenIsland' },
  { id: 'ramp-circuit', x: -25.8, z: 88, rotation: 0, length: 16, width: 10, height: 3.2, size: 'medium' },
  { id: 'ramp-archive', x: 56.9, z: 66.1, rotation: Math.PI * 0.5, length: 14, width: 8, height: 3, size: 'small' },
  { id: 'ramp-voxel', x: 118, z: -18.1, rotation: Math.PI * 0.5, length: 14, width: 8, height: 3.6, size: 'small' },
  { id: 'ramp-lab', x: 31.8, z: -88.7, rotation: Math.PI * 0.9, length: 15, width: 8, height: 3.4, size: 'small' },
]

/* ============================================================
   TIMELINE STRIP
   Four year plates near the hub. Driving them in order unlocks
   TIME TRAVELLER.
   ============================================================ */

export const timelinePlates = [
  { year: '2023', x: 17.9, z: 24.8 },
  { year: '2024', x: 4.2, z: 25.5 },
  { year: '2025', x: 10.4, z: 25.7 },
  { year: '2026', x: 41.5, z: 2.6 },
]

/* ============================================================
   DEV NOTES
   Short hidden notes, found by driving over their marker. Local
   replacement for upstream's server-backed visitor whispers.
   ============================================================ */

export const devNotes: { id: string; x: number; z: number; text: string }[] = [
  { id: 'note-1', x: 26.9, z: -15.8, text: 'Built this at 2am. It shows in the commit messages.' },
  { id: 'note-2', x: 20.7, z: -32.7, text: 'Data Structures was the module that made the rest make sense.' },
  { id: 'note-3', x: 81.9, z: -48.6, text: 'Two degrees, one city, no plan to stop.' },
  { id: 'note-4', x: 5.3, z: -97.8, text: 'Half a million documents. I read approximately none of them.' },
  { id: 'note-5', x: 60.1, z: 29.3, text: 'The captions were harder than the video.' },
  { id: 'note-6', x: 114.5, z: 23.1, text: 'Fourteen sites, six people, two weeks early. Once.' },
  { id: 'note-7', x: -0.9, z: 72.9, text: 'This bug took longer than the feature.' },
  { id: 'note-8', x: 107.7, z: -59.5, text: 'The maze has one solution. I checked.' },
  { id: 'note-9', x: -27.4, z: 101, text: 'Do not take the inside line here. Or do.' },
  { id: 'note-13', x: 20, z: -92, text: 'It is further than it looks. Take a run-up.' },
  { id: 'note-10', x: 38.9, z: 84.6, text: 'Some of these are scaffolds. They are in the archive anyway.' },
  { id: 'note-11', x: 67.3, z: -20.2, text: 'Do not hit the red button. There is no red button.' },
  { id: 'note-12', x: 115.6, z: 1.3, text: 'Every chunk here is one integer away from a different world.' },
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
