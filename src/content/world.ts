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
    x: 0, z: 0, radius: 52,
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
    x: 0, z: -168, radius: 56,
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
    x: -152, z: -30, radius: 50,
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
    x: 152, z: -30, radius: 50,
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
    x: -112, z: 68, radius: 34,
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
    x: -168, z: 148, radius: 46,
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
    x: 40, z: 132, radius: 44,
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
    x: -42, z: 158, radius: 38,
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
    x: 156, z: 130, radius: 54,
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
    x: -88, z: -128, radius: 34,
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
    x: 90, z: -122, radius: 34,
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
    x: 196, z: -142, radius: 74,
    theme: 'light', accent: '#d4491f',
    ground: 'asphalt',
    blurb: 'Three laps. Your best time lives in this browser.',
    signposted: true,
  },
  {
    id: 'labyrinth',
    label: 'LABYRINTH',
    short: 'MAZE',
    x: -214, z: -116, radius: 42,
    theme: 'light', accent: '#6f6f76',
    ground: 'plate',
    blurb: 'A real maze with a real centre. No shortcuts through the walls.',
  },
  {
    id: 'voxel',
    label: 'SEED CHUNKS',
    short: 'VOXELS',
    x: 212, z: 36, radius: 38,
    theme: 'light', accent: '#8d8467',
    ground: 'voxel',
    blurb: 'The terrain gives up and becomes cubes.',
  },
  {
    id: 'network',
    label: 'TUNNEL',
    short: 'VPN',
    x: -28, z: -232, radius: 30,
    theme: 'dark', accent: '#5f8490',
    ground: 'dark',
    blurb: 'Two nodes, one hazard, and packets that stop being readable.',
  },
  {
    id: 'studio',
    label: 'KEYFRAMES',
    short: 'STUDIO',
    x: 214, z: 202, radius: 34,
    theme: 'light', accent: '#7d7488',
    ground: 'plate',
    blurb: 'An animation studio where the timeline drives the scenery.',
  },
  {
    id: 'orbit',
    label: 'THREE BODIES',
    short: 'ORBIT',
    x: 74, z: -62, radius: 28,
    theme: 'light', accent: '#2f6f5e',
    ground: 'plate',
    blurb: 'Three masses overhead, integrated live. Nudge one and watch it fail.',
  },
  {
    id: 'archive',
    label: 'PROJECT ARCHIVE',
    short: 'ARCHIVE',
    x: -20, z: 244, radius: 70,
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
    x: 292, z: -262, radius: 40,
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
export const WORLD_RADIUS = 360

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
  { id: 'hub', x: 0, z: 26, rotation: Math.PI, district: 'hub' },
  { id: 'hub-north', x: 0, z: -46, rotation: Math.PI, district: 'hub' },
  { id: 'kcl', x: -120, z: -12, rotation: Math.PI * 1.0, district: 'kcl' },
  { id: 'ucl', x: 120, z: -12, rotation: 0, district: 'ucl' },
  { id: 'lab', x: 0, z: -122, rotation: Math.PI * 1.5, district: 'lab' },
  { id: 'teaching', x: -96, z: 44, rotation: Math.PI * 0.5, district: 'teaching' },
  { id: 'algorithms', x: -150, z: 118, rotation: Math.PI * 0.5, district: 'algorithms' },
  { id: 'focus', x: 40, z: 96, rotation: Math.PI * 0.5, district: 'focus' },
  { id: 'gym', x: -42, z: 126, rotation: Math.PI * 0.5, district: 'gym' },
  { id: 'client', x: 128, z: 100, rotation: Math.PI * 0.5, district: 'client' },
  { id: 'chess', x: -88, z: -100, rotation: Math.PI * 1.5, district: 'chess' },
  { id: 'stock', x: 90, z: -96, rotation: Math.PI * 1.5, district: 'stock' },
  { id: 'circuit', x: 196, z: -86, rotation: Math.PI * 1.5, district: 'circuit' },
  { id: 'labyrinth', x: -214, z: -76, rotation: Math.PI * 1.5, district: 'labyrinth' },
  { id: 'voxel', x: 186, z: 36, rotation: 0, district: 'voxel' },
  { id: 'network', x: -28, z: -204, rotation: Math.PI * 1.5, district: 'network' },
  { id: 'studio', x: 196, z: 178, rotation: Math.PI * 0.5, district: 'studio' },
  { id: 'orbit', x: 74, z: -38, rotation: Math.PI * 1.5, district: 'orbit' },
  { id: 'archive', x: -20, z: 196, rotation: Math.PI * 0.5, district: 'archive' },
  { id: 'road-west', x: -78, z: -20, rotation: Math.PI, district: 'hub' },
  { id: 'road-east', x: 78, z: -20, rotation: 0, district: 'hub' },
  { id: 'road-south', x: 6, z: 74, rotation: Math.PI * 0.5, district: 'hub' },
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
    x: 0, z: -14, visual: 'monument', interaction: 'none', scale: 1,
  },
  {
    id: 'hub-welcome', district: 'hub', label: 'WELCOME',
    sublabel: 'PRESS ENTER',
    x: 0, z: 12, visual: 'billboard', interaction: 'panel', radius: 11,
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
    x: -30, z: 8, rotation: Math.PI * 0.25, visual: 'idCard',
    interaction: 'panel', radius: 12, ref: { kind: 'profile' },
    achievement: 'about',
  },
  {
    id: 'hub-sign-kcl', district: 'hub', label: 'KCL', sublabel: 'EDUCATION',
    x: -44, z: -18, rotation: Math.PI, visual: 'sign', interaction: 'none',
  },
  {
    id: 'hub-sign-ucl', district: 'hub', label: 'UCL', sublabel: 'WHAT IS NEXT',
    x: 44, z: -18, rotation: 0, visual: 'sign', interaction: 'none',
  },
  {
    id: 'hub-sign-lab', district: 'hub', label: 'AI LAB', sublabel: 'METAVIEW',
    x: -6, z: -44, rotation: Math.PI * 1.5, visual: 'sign', interaction: 'none',
  },
  {
    id: 'hub-sign-circuit', district: 'hub', label: 'RACE TRACK', sublabel: 'BEST LAP',
    x: 30, z: -40, rotation: Math.PI * 1.75, visual: 'sign', interaction: 'none',
  },
  {
    id: 'hub-sign-client', district: 'hub', label: 'CLIENT WORK', sublabel: '14 SITES',
    x: 34, z: 34, rotation: Math.PI * 0.75, visual: 'sign', interaction: 'none',
  },
  {
    id: 'hub-sign-projects', district: 'hub', label: 'PROJECTS', sublabel: 'ARCHIVE',
    x: 0, z: 46, rotation: Math.PI * 0.5, visual: 'sign', interaction: 'none',
  },
  {
    id: 'hub-sign-focus', district: 'hub', label: 'PRODUCTS', sublabel: 'FOCUS · GYM',
    x: -30, z: 40, rotation: Math.PI * 0.35, visual: 'sign', interaction: 'none',
  },

  /* ---- KCL: five modules as five structures --------------- */
  {
    id: 'kcl-degree', district: 'kcl', label: "KING'S COLLEGE LONDON",
    sublabel: 'BSc COMPUTER SCIENCE',
    x: -152, z: -58, visual: 'billboard', interaction: 'panel', radius: 13,
    ref: ed('kcl'), achievement: 'kcl',
  },
  {
    id: 'kcl-data-structures', district: 'kcl', label: 'DATA STRUCTURES',
    x: -186, z: -34, visual: 'graphSculpture', interaction: 'panel', radius: 10,
    panel: {
      title: 'DATA STRUCTURES',
      lines: ['Nodes, edges, invariants, cost.', 'Drive through the graph — the edges are solid.'],
    },
  },
  {
    id: 'kcl-databases', district: 'kcl', label: 'DATABASE SYSTEMS',
    x: -124, z: -50, visual: 'databaseTower', interaction: 'panel', radius: 10,
    panel: {
      title: 'DATABASE SYSTEMS',
      lines: ['Relational algebra, indexing, transactions.', 'The tower is a B-tree. The top page is the root.'],
    },
  },
  {
    id: 'kcl-os', district: 'kcl', label: 'OPERATING SYSTEMS',
    x: -178, z: 4, visual: 'processBlocks', interaction: 'panel', radius: 10,
    panel: {
      title: 'OPERATING SYSTEMS',
      lines: ['Processes, scheduling, memory, concurrency.', 'Each block is a process. They are scheduled, not static.'],
    },
  },
  {
    id: 'kcl-crypto', district: 'kcl', label: 'CRYPTOGRAPHY',
    x: -126, z: -6, visual: 'cipherWall', interaction: 'panel', radius: 10,
    panel: {
      title: 'CRYPTOGRAPHY',
      lines: ['Transformation, keys, guarantees.', 'The wall re-scrambles every time you look away.'],
    },
  },
  {
    id: 'kcl-se', district: 'kcl', label: 'SOFTWARE ENGINEERING',
    x: -152, z: 8, visual: 'moduleStack', interaction: 'panel', radius: 10,
    panel: {
      title: 'SOFTWARE ENGINEERING',
      lines: ['Modules assembling into one system.', 'Knock a module out and the stack still stands. Mostly.'],
    },
  },
  {
    id: 'kcl-orca', district: 'kcl', label: 'ORCA', sublabel: 'SCHEDULING',
    x: -196, z: -60, visual: 'monument', interaction: 'project', radius: 9,
    ref: p('orca'), scale: 0.7,
  },
  {
    id: 'kcl-tappedin', district: 'kcl', label: 'TAPPEDIN', sublabel: 'NLP + WEB',
    x: -110, z: -78, visual: 'monument', interaction: 'project', radius: 9,
    ref: p('tappedin'), scale: 0.7,
  },
  {
    id: 'kcl-library', district: 'kcl', label: 'MY LIBRARY',
    x: -190, z: 30, visual: 'monument', interaction: 'project', radius: 9,
    ref: p('my-library'), scale: 0.6,
  },

  /* ---- TEACHING / DEBUG YARD ------------------------------ */
  {
    id: 'teaching-role', district: 'teaching', label: 'GRADUATE TEACHING ASSISTANT',
    sublabel: "KING'S COLLEGE LONDON",
    x: -112, z: 44, visual: 'billboard', interaction: 'panel', radius: 12,
    ref: xp('kcl-gta'),
  },
  {
    id: 'teaching-bugs', district: 'teaching', label: 'FAIL',
    sublabel: 'KNOCK THEM DOWN',
    x: -112, z: 78, visual: 'processBlocks', interaction: 'none',
    achievement: 'debugger', scale: 1.2,
  },
  {
    id: 'teaching-duck', district: 'teaching', label: 'RUBBER DUCK',
    x: -134, z: 88, visual: 'duck', interaction: 'note', radius: 7,
    secret: true, achievement: 'duck',
    panel: { title: 'RUBBER DUCK', lines: ['Explain the bug out loud. It usually works.'] },
  },

  /* ---- ALGORITHM FIELD ------------------------------------ */
  {
    id: 'algo-cinquillo', district: 'algorithms', label: 'CINQUILLO 2.0',
    sublabel: 'GAME AI RESEARCH',
    x: -168, z: 122, visual: 'monument', interaction: 'project', radius: 10,
    ref: p('cinquillo-fair-variant'),
  },
  {
    id: 'algo-catan', district: 'algorithms', label: 'CATAN AI',
    x: -200, z: 150, visual: 'monument', interaction: 'project', radius: 9,
    ref: p('catan-ai'), scale: 0.7,
  },
  {
    id: 'algo-dots', district: 'algorithms', label: 'DOTS & BOXES',
    x: -140, z: 156, visual: 'monument', interaction: 'project', radius: 9,
    ref: p('dots-and-boxes'), scale: 0.7,
  },
  {
    id: 'algo-cinquillo-web', district: 'algorithms', label: 'CINQUILLO',
    x: -190, z: 178, visual: 'monument', interaction: 'project', radius: 8,
    ref: p('cinquillo'), scale: 0.6,
  },
  {
    id: 'algo-primes', district: 'algorithms', label: 'PRIMOS EN CLICK',
    x: -146, z: 186, visual: 'monument', interaction: 'project', radius: 8,
    ref: p('primes'), scale: 0.6,
  },

  /* ---- UCL ------------------------------------------------ */
  {
    id: 'ucl-degree', district: 'ucl', label: 'UNIVERSITY COLLEGE LONDON',
    sublabel: 'MSc AI & DATA ENGINEERING',
    x: 152, z: -58, visual: 'researchShell', interaction: 'panel', radius: 14,
    ref: ed('ucl'), achievement: 'ucl',
  },
  {
    id: 'ucl-ml', district: 'ucl', label: 'MACHINE LEARNING',
    x: 122, z: -34, visual: 'monument', interaction: 'panel', radius: 9, scale: 0.7,
    panel: { title: 'MACHINE LEARNING', lines: ['Statistical learning, optimisation, generalisation.'] },
  },
  {
    id: 'ucl-dl', district: 'ucl', label: 'APPLIED DEEP LEARNING',
    x: 182, z: -34, visual: 'monument', interaction: 'panel', radius: 9, scale: 0.7,
    panel: { title: 'APPLIED DEEP LEARNING', lines: ['Architectures, training regimes, representation.'] },
  },
  {
    id: 'ucl-mining', district: 'ucl', label: 'DATA MINING',
    x: 128, z: 2, visual: 'monument', interaction: 'panel', radius: 9, scale: 0.7,
    panel: { title: 'DATA MINING', lines: ['Pattern discovery at scale.'] },
  },
  {
    id: 'ucl-analysis', district: 'ucl', label: 'DATA ANALYSIS',
    x: 176, z: 2, visual: 'monument', interaction: 'panel', radius: 9, scale: 0.7,
    panel: { title: 'DATA ANALYSIS', lines: ['Inference, experiment design, uncertainty.'] },
  },
  {
    id: 'ucl-vv', district: 'ucl', label: 'VALIDATION & VERIFICATION',
    x: 152, z: 16, visual: 'monument', interaction: 'panel', radius: 9, scale: 0.7,
    panel: { title: 'VALIDATION & VERIFICATION', lines: ['Proving systems behave as specified.'] },
  },
  {
    id: 'ucl-ml-revision', district: 'ucl', label: 'ML REVISION ENGINE',
    x: 196, z: 20, visual: 'monument', interaction: 'project', radius: 8,
    ref: p('ml-revision'), scale: 0.6,
  },

  /* ---- AI LAB / METAVIEW ---------------------------------- */
  {
    id: 'lab-role', district: 'lab', label: 'METAVIEW',
    sublabel: 'AI & DATA ANALYSIS ENGINEER',
    x: 0, z: -142, visual: 'billboard', interaction: 'panel', radius: 14,
    ref: xp('metaview'), achievement: 'lab',
  },
  {
    id: 'lab-corpus', district: 'lab', label: 'CORPUS',
    sublabel: 'DRIVE INTO IT',
    x: 0, z: -186, visual: 'dataField', interaction: 'none', scale: 1.4,
  },
  {
    id: 'lab-retrieval', district: 'lab', label: 'RETRIEVAL',
    sublabel: 'QUERY → EMBED → RETRIEVE → GENERATE',
    x: -34, z: -196, visual: 'terminal', interaction: 'minigame', radius: 10,
    minigame: 'retrieval', achievement: 'retrieval',
  },
  {
    id: 'lab-vision', district: 'lab', label: 'VISION',
    sublabel: '50K+ IMAGES · 92% ACCURACY',
    x: 36, z: -196, visual: 'monument', interaction: 'panel', radius: 9, scale: 0.8,
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
    x: -88, z: -128, visual: 'chessboard', interaction: 'minigame', radius: 14,
    ref: p('chess-assistant'), minigame: 'chess', achievement: 'checkmate',
  },

  /* ---- STOCK ---------------------------------------------- */
  {
    id: 'stock-book', district: 'stock', label: 'STOCK MARKET SIMULATOR',
    sublabel: '40K+ TRADES',
    x: 90, z: -122, visual: 'orderBook', interaction: 'minigame', radius: 13,
    ref: p('stock-market-simulator'), minigame: 'orderRush', achievement: 'orderRush',
  },
  {
    id: 'stock-ticker', district: 'stock', label: 'ANP',
    sublabel: 'FICTIONAL TICKER',
    x: 118, z: -146, visual: 'billboard', interaction: 'note', radius: 8,
    secret: true, achievement: 'ticker', scale: 0.7,
    panel: { title: 'ANP', lines: ['Not investment advice. Not a real security.', 'Purely decorative volatility.'] },
  },

  /* ---- FOCUS ---------------------------------------------- */
  {
    id: 'focus-device', district: 'focus', label: 'FOCUS',
    sublabel: 'DRIVE INSIDE',
    x: 40, z: 132, visual: 'device', interaction: 'project', radius: 16,
    ref: p('focus'), scale: 1,
  },
  {
    id: 'focus-pipeline', district: 'focus', label: 'VIDEO PIPELINE',
    sublabel: 'SCRIPT → VOICE → VISUALS → CAPTIONS → RENDER',
    x: 40, z: 166, visual: 'station', interaction: 'minigame', radius: 12,
    minigame: 'pipeline', achievement: 'contentEngine',
  },
  {
    id: 'focus-role', district: 'focus', label: 'CO-FOUNDER & DEVELOPER',
    x: 12, z: 108, visual: 'billboard', interaction: 'panel', radius: 10,
    ref: xp('focus'), scale: 0.8,
  },

  /* ---- GYM ------------------------------------------------ */
  {
    id: 'gym-app', district: 'gym', label: 'GYM APP',
    sublabel: 'ONE MODEL · MANY MOVEMENTS',
    x: -42, z: 158, visual: 'monument', interaction: 'project', radius: 12,
    ref: p('gym-app'),
  },
  {
    id: 'gym-circuit', district: 'gym', label: 'GYM CIRCUIT',
    sublabel: 'PUSH · PULL · LEGS · CORE',
    x: -42, z: 186, visual: 'gate', interaction: 'minigame', radius: 11,
    minigame: 'gymCircuit', achievement: 'gymCircuit',
  },

  /* ---- CLIENT CITY ---------------------------------------- */
  {
    id: 'client-count', district: 'client', label: '14',
    sublabel: 'WEBS SHIPPED',
    x: 156, z: 92, visual: 'monument', interaction: 'panel', radius: 13,
    ref: xp('pansofia'), achievement: 'client', scale: 1.3,
  },

  /* ---- CIRCUIT -------------------------------------------- */
  {
    id: 'circuit-start', district: 'circuit', label: 'START / FINISH',
    sublabel: '3 LAPS',
    x: 196, z: -86, visual: 'gate', interaction: 'minigame', radius: 12,
    minigame: 'circuit', achievement: 'speedDemon',
  },

  /* ---- LABYRINTH ------------------------------------------ */
  {
    id: 'labyrinth-entry', district: 'labyrinth', label: 'LABYRINTH',
    sublabel: 'FIND THE CENTRE',
    x: -214, z: -76, visual: 'gate', interaction: 'project', radius: 11,
    ref: p('labyrinth'), minigame: 'labyrinth',
  },
  {
    id: 'labyrinth-prize', district: 'labyrinth', label: 'CENTRE',
    x: -214, z: -116, visual: 'monument', interaction: 'none', radius: 6,
    secret: true, achievement: 'pathFound', scale: 0.5,
  },

  /* ---- VOXEL ---------------------------------------------- */
  {
    id: 'voxel-seed', district: 'voxel', label: 'MINECRAFT SEED FINDER',
    sublabel: 'PROCEDURAL SEARCH',
    x: 190, z: 20, visual: 'monument', interaction: 'project', radius: 10,
    ref: p('minecraft-seeds'),
  },
  {
    id: 'voxel-room', district: 'voxel', label: 'UNDERGROUND',
    x: 226, z: 54, visual: 'terminal', interaction: 'note', radius: 7,
    secret: true, achievement: 'underground',
    panel: {
      title: 'UNDERGROUND',
      lines: ['You found the room under the chunks.', 'Built at 2am. Left in on purpose.'],
    },
  },

  /* ---- NETWORK / VPN -------------------------------------- */
  {
    id: 'vpn-node-a', district: 'network', label: 'NODE A',
    x: -56, z: -232, visual: 'monument', interaction: 'project', radius: 9,
    ref: p('vpn'), scale: 0.8,
  },
  {
    id: 'vpn-node-b', district: 'network', label: 'NODE B',
    sublabel: 'ENCRYPTED TUNNEL',
    x: 0, z: -232, visual: 'monument', interaction: 'minigame', radius: 9,
    minigame: 'packets', scale: 0.8, achievement: 'tunnel',
  },

  /* ---- STUDIO / KEYFRAMES --------------------------------- */
  {
    id: 'studio-keyframes', district: 'studio', label: 'KEYFRAMES',
    sublabel: 'PLAY · PAUSE · REVERSE',
    x: 214, z: 202, visual: 'station', interaction: 'project', radius: 12,
    ref: p('keyframes'),
  },
  {
    id: 'studio-video', district: 'studio', label: 'VIDEO PLAYER',
    x: 240, z: 178, visual: 'monument', interaction: 'project', radius: 8,
    ref: p('video-player'), scale: 0.6,
  },

  /* ---- ORBIT / THREE BODY --------------------------------- */
  {
    id: 'orbit-system', district: 'orbit', label: 'THREE BODY PROBLEM',
    sublabel: 'NUDGE ONE',
    x: 74, z: -62, visual: 'monument', interaction: 'minigame', radius: 12,
    ref: p('three-body-problem'), minigame: 'threeBody', achievement: 'chaosTheory',
  },

  /* ---- ARCHIVE ISLANDS ------------------------------------ */
  {
    id: 'archive-sign', district: 'archive', label: 'PROJECT ARCHIVE',
    sublabel: 'EVERYTHING ELSE',
    x: -20, z: 202, visual: 'billboard', interaction: 'panel', radius: 12,
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
    x: 0, z: -6, visual: 'terminal', interaction: 'note', radius: 5,
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
    x: 292, z: -262, visual: 'island', interaction: 'note', radius: 14,
    secret: true, achievement: 'hiddenIsland',
    panel: {
      title: 'THE VOID',
      lines: ['Nothing is supposed to be rendered here.', 'And yet.'],
    },
  },
  {
    id: 'secret-brackets', district: 'hub', label: '{ }',
    sublabel: 'JUMP THROUGH',
    x: 58, z: 6, rotation: Math.PI * 0.5, visual: 'bracket', interaction: 'none',
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
  { id: 'ew', width: 11, points: [[-152, -30], [-70, -18], [0, -8], [70, -18], [152, -30]] },
  { id: 'ns', width: 11, points: [[0, -168], [0, -100], [0, -8], [10, 90], [-20, 202]] },
  { id: 'hub-client', width: 9, points: [[0, -8], [70, 40], [130, 96], [156, 130]] },
  { id: 'hub-focus', width: 9, points: [[0, -8], [18, 62], [40, 132]] },
  { id: 'gym-spur', width: 7, points: [[18, 62], [-20, 118], [-42, 158]] },
  { id: 'kcl-teaching', width: 7, points: [[-152, -30], [-136, 20], [-112, 68]] },
  { id: 'teaching-algos', width: 7, points: [[-112, 68], [-140, 110], [-168, 148]] },
  { id: 'lab-chess', width: 7, points: [[0, -168], [-46, -150], [-88, -128]] },
  { id: 'lab-stock', width: 7, points: [[0, -168], [48, -148], [90, -122]] },
  { id: 'stock-circuit', width: 9, points: [[90, -122], [150, -110], [196, -86]] },
  { id: 'kcl-labyrinth', width: 7, points: [[-152, -30], [-190, -60], [-214, -76]] },
  { id: 'ucl-voxel', width: 7, points: [[152, -30], [190, 0], [212, 36]] },
  { id: 'lab-network', width: 7, points: [[0, -168], [-14, -200], [-28, -232]] },
  { id: 'client-studio', width: 7, points: [[156, 130], [190, 170], [214, 202]] },
  { id: 'hub-orbit', width: 6, points: [[0, -8], [40, -36], [74, -62]] },
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
  { id: 'ramp-hub-a', x: 26, z: 22, rotation: Math.PI * 0.25, length: 10, width: 7, height: 1.8, size: 'small' },
  { id: 'ramp-hub-b', x: -26, z: -30, rotation: Math.PI * 1.15, length: 12, width: 7, height: 2.4, size: 'small' },
  { id: 'ramp-brackets', x: 44, z: 6, rotation: Math.PI * 0.5, length: 18, width: 9, height: 5.2, size: 'medium', achievement: 'shipIt' },
  { id: 'ramp-kcl', x: -152, z: 34, rotation: Math.PI * 1.5, length: 16, width: 8, height: 4, size: 'medium' },
  { id: 'ramp-focus', x: 40, z: 96, rotation: Math.PI * 1.5, length: 20, width: 9, height: 6, size: 'medium', achievement: 'phoneHop' },
  { id: 'ramp-stunt', x: 246, z: -200, rotation: Math.PI * 1.28, length: 40, width: 12, height: 17, size: 'large', achievement: 'hiddenIsland' },
  { id: 'ramp-circuit', x: 236, z: -142, rotation: 0, length: 16, width: 10, height: 3.2, size: 'medium' },
  { id: 'ramp-archive', x: -20, z: 168, rotation: Math.PI * 0.5, length: 14, width: 8, height: 3, size: 'small' },
  { id: 'ramp-voxel', x: 212, z: 6, rotation: Math.PI * 0.5, length: 14, width: 8, height: 3.6, size: 'small' },
  { id: 'ramp-lab', x: -40, z: -150, rotation: Math.PI * 0.9, length: 15, width: 8, height: 3.4, size: 'small' },
]

/* ============================================================
   TIMELINE STRIP
   Four year plates near the hub. Driving them in order unlocks
   TIME TRAVELLER.
   ============================================================ */

export const timelinePlates = [
  { year: '2023', x: -58, z: 60 },
  { year: '2024', x: -34, z: 68 },
  { year: '2025', x: -10, z: 76 },
  { year: '2026', x: 14, z: 84 },
]

/* ============================================================
   DEV NOTES
   Short hidden notes, found by driving over their marker. Local
   replacement for upstream's server-backed visitor whispers.
   ============================================================ */

export const devNotes: { id: string; x: number; z: number; text: string }[] = [
  { id: 'note-1', x: 22, z: -34, text: 'Built this at 2am. It shows in the commit messages.' },
  { id: 'note-2', x: -96, z: -12, text: 'Data Structures was the module that made the rest make sense.' },
  { id: 'note-3', x: 132, z: -66, text: 'Two degrees, one city, no plan to stop.' },
  { id: 'note-4', x: -60, z: -172, text: 'Half a million documents. I read approximately none of them.' },
  { id: 'note-5', x: 60, z: 150, text: 'The captions were harder than the video.' },
  { id: 'note-6', x: 172, z: 108, text: 'Fourteen sites, six people, two weeks early. Once.' },
  { id: 'note-7', x: -180, z: 160, text: 'This bug took longer than the feature.' },
  { id: 'note-8', x: -190, z: -100, text: 'The maze has one solution. I checked.' },
  { id: 'note-9', x: 232, z: -110, text: 'Do not take the inside line here. Or do.' },
  { id: 'note-10', x: -8, z: 214, text: 'Some of these are scaffolds. They are in the archive anyway.' },
  { id: 'note-11', x: 96, z: 4, text: 'Do not hit the red button. There is no red button.' },
  { id: 'note-12', x: 206, z: 54, text: 'Every chunk here is one integer away from a different world.' },
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
