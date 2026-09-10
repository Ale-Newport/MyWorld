import { districts, roads } from './world'
import {
  MAP_DEPTH, MAP_WIDTH, PLAY_SPOTS, VEGETATION_ZONES, coastRayDistance,
} from './world-environment'
import { blockedBy, type Zone, type ZoneKind } from './world-layout'

/* ============================================================
   WHAT IS SCATTERED WHERE

   The island read as empty, and it read as empty by ARITHMETIC
   rather than by budget. `World.scatterProps` made 270 placement
   attempts, landed 117 and threw away 153 WITHOUT SAYING SO —
   all seventeen of SOCIAL's props, every one of the landing's six
   balls, twenty-five of bowling's thirty-two. Nobody knew,
   because nothing counted.

   So this module is two things at once.

   It is the MANIFEST: what stands where, authored in fractions of
   a district's own radius and in items per square metre, never in
   metres from the origin. The island was rescaled to 70% linear
   one morning and every hand-typed coordinate on it had to be
   found again; a band of [0.6, 1.4] survives that, `at(-20, 12)`
   does not.

   And it is the PLANNER: `planDecor()` decides every position
   here, in pure data with no THREE import, so
   `scripts/world-decor-check.mjs` can run the SHIPPED placement
   through `scripts/_ts-loader.mjs` and print exactly what the
   world will build — placed against attempted, and every
   rejection by the kind of ground that caused it. A system that
   silently ships half of what it was asked for is how the island
   got like this, and the histogram is the fix.

   Placement goes through `blockedBy` from `world-layout`, which
   is the same door the ecology scatter, the scenery details and
   the respawn audit already use. It is deliberately NOT a fourth
   private copy of "may something stand here": the last one did
   not know about the labyrinth and dropped fourteen crates inside
   its walls.

   MASS IS AUTHORED AGAINST THE CAR, NOT AGAINST REALITY. The
   chassis is 2.5 kg with 300 N per wheel. Anything over ~6 kg
   reads as a wall and anything over ~12 kg stops the car dead, so
   a hay bale here is 3 kg and a picnic table is 4. The brief was
   "que todo sea atropellable y que no me estampe"; the number
   that delivers it is the mass, and nothing else.
   ============================================================ */

/** How a set of one kind is laid out inside its band. */
export type DecorArrangement =
  /** Spread evenly around the anchor, one bearing each. */
  | 'ring'
  /** Two or three knots of things, the way a yard actually looks. */
  | 'cluster'
  /** A row along a seeded bearing: kerbs, racks, car-park edges. */
  | 'line'
  /** Rows and columns on a rotated grid: a loading dock, a car park. */
  | 'grid'
  /** Uniform over the annulus. The fallback, and the least interesting. */
  | 'scatter'

/** The procedural shape `decorGeometry.ts` builds for a kind. */
export type DecorShape =
  | 'tyre' | 'bale' | 'pallet' | 'sack' | 'bollard' | 'pin' | 'pot'
  | 'parasol' | 'deckchair' | 'cog' | 'rubble' | 'marker' | 'table' | 'lantern'

export interface DecorKind {
  id: string
  shape: DecorShape
  /** Bounding envelope in metres: width (X), height (Y), depth (Z). */
  size: readonly [number, number, number]
  /**
   * Ground radius for the placement test, and half the spacing
   * between two of these. Deliberately a little wider than the
   * object: props that touch at rest wake each other every time
   * one is nudged.
   */
  footprint: number
  /** Kilograms. See the header — the car is 2.5. */
  mass: number
  friction: number
  restitution: number
  linearDamping: number
  angularDamping: number
  /** Contact force above which the hit is worth a sound. */
  contactThreshold: number
  roughness: number
  metalness: number
  /** Base tint, and the per-instance variations the planner draws from. */
  colours: readonly string[]
  castShadow: boolean
  /** Per-instance uniform scale range. Mass follows it cubed. */
  scale: readonly [number, number]
}

/* ------------------------------------------------------------
   THE KINDS

   Fourteen shapes, and per-instance colour and scale on top of
   them, which is what lets one geometry serve a whole family: a
   crate is a crate at 0.55 and a shipping box at 1.3. Each kind
   is one draw call whatever the count, so the count is free and
   the KIND is what costs — fourteen new kinds is twenty-eight
   draws against a measured 156 and a budget of 260.
   ------------------------------------------------------------ */

export const DECOR_KINDS = [
  {
    // Motorsport, and the only stackable thing here that also reads
    // as motorsport when it is lying on its own in a field.
    id: 'tyre', shape: 'tyre', size: [1.5, 0.44, 1.5], footprint: 1.05,
    mass: 1.6, friction: 0.85, restitution: 0.32,
    linearDamping: 0.25, angularDamping: 0.5, contactThreshold: 6,
    roughness: 0.78, metalness: 0.02,
    colours: ['#26262a', '#1b1b1f', '#31313a'], castShadow: true,
    scale: [0.9, 1.15],
  },
  {
    // A cylinder lying on its side, so it ROLLS when the car clips
    // it. Repainted in bark by the forest-floor biome it is a fallen
    // log, which is most of what that biome is — one geometry, two
    // objects, no extra draw call.
    id: 'bale', shape: 'bale', size: [1.7, 1.0, 1.0], footprint: 1.15,
    mass: 3.0, friction: 0.9, restitution: 0.04,
    linearDamping: 0.35, angularDamping: 0.55, contactThreshold: 8,
    roughness: 0.95, metalness: 0,
    colours: ['#c8b06a', '#b8a15c', '#d2bd7e'], castShadow: true,
    scale: [0.85, 1.2],
  },
  {
    // Flat enough to drive straight over, which is the point: a
    // loading dock the car cannot cross is a wall with slats.
    id: 'pallet', shape: 'pallet', size: [1.5, 0.16, 1.2], footprint: 1.0,
    mass: 1.8, friction: 0.72, restitution: 0.05,
    linearDamping: 0.4, angularDamping: 0.7, contactThreshold: 7,
    roughness: 0.92, metalness: 0,
    colours: ['#9f875f', '#8d7550', '#ab9670'], castShadow: true,
    scale: [0.85, 1.25],
  },
  {
    id: 'sack', shape: 'sack', size: [1.0, 0.6, 0.78], footprint: 0.7,
    mass: 2.2, friction: 0.95, restitution: 0.02,
    linearDamping: 0.5, angularDamping: 0.85, contactThreshold: 7,
    roughness: 0.96, metalness: 0,
    colours: ['#b9ad86', '#a89b74', '#c6bb96'], castShadow: true,
    scale: [0.8, 1.25],
  },
  {
    id: 'bollard', shape: 'bollard', size: [0.5, 0.95, 0.5], footprint: 0.55,
    mass: 1.2, friction: 0.7, restitution: 0.08,
    linearDamping: 0.3, angularDamping: 0.6, contactThreshold: 5,
    roughness: 0.68, metalness: 0.1,
    colours: ['#d4491f', '#e2b33a', '#f2f1ee'], castShadow: true,
    scale: [0.85, 1.15],
  },
  {
    // The bowling silhouette at car-park scale. Ten of these in a
    // triangle beside the venue says NEWPORT LANES from 80 m.
    id: 'pin', shape: 'pin', size: [0.62, 1.5, 0.62], footprint: 0.6,
    mass: 0.9, friction: 0.55, restitution: 0.2,
    linearDamping: 0.2, angularDamping: 0.4, contactThreshold: 4,
    roughness: 0.5, metalness: 0.02,
    colours: ['#f2f1ee', '#eee9d7', '#e2dfd8'], castShadow: true,
    scale: [0.8, 1.2],
  },
  {
    id: 'pot', shape: 'pot', size: [1.15, 1.25, 1.15], footprint: 0.85,
    mass: 2.8, friction: 0.85, restitution: 0.03,
    linearDamping: 0.45, angularDamping: 0.75, contactThreshold: 9,
    roughness: 0.9, metalness: 0,
    colours: ['#6f8a4f', '#5e7f4f', '#7d9758', '#8d9f65'], castShadow: true,
    scale: [0.8, 1.3],
  },
  {
    id: 'parasol', shape: 'parasol', size: [2.4, 2.4, 2.4], footprint: 1.3,
    mass: 1.0, friction: 0.6, restitution: 0.06,
    linearDamping: 0.5, angularDamping: 0.9, contactThreshold: 4,
    roughness: 0.85, metalness: 0,
    colours: ['#d4491f', '#4f9a85', '#e2b33a', '#5f8490'], castShadow: true,
    scale: [0.85, 1.15],
  },
  {
    id: 'deckchair', shape: 'deckchair', size: [0.95, 0.95, 1.35], footprint: 0.8,
    mass: 1.4, friction: 0.7, restitution: 0.05,
    linearDamping: 0.4, angularDamping: 0.75, contactThreshold: 5,
    roughness: 0.86, metalness: 0,
    colours: ['#4f9a85', '#d4491f', '#5f8490', '#e2b33a'], castShadow: true,
    scale: [0.9, 1.1],
  },
  {
    // Stood on its rim like a wheel, because a gear lying flat in
    // the grass is a disc and a gear on its edge rolls away.
    id: 'cog', shape: 'cog', size: [1.6, 1.6, 0.3], footprint: 1.0,
    mass: 2.6, friction: 0.4, restitution: 0.24,
    linearDamping: 0.22, angularDamping: 0.3, contactThreshold: 8,
    roughness: 0.42, metalness: 0.5,
    colours: ['#c2b974', '#8a8a92', '#a89a5e'], castShadow: true,
    scale: [0.8, 1.35],
  },
  {
    id: 'rubble', shape: 'rubble', size: [1.0, 0.85, 1.0], footprint: 0.65,
    mass: 1.5, friction: 0.9, restitution: 0.06,
    linearDamping: 0.4, angularDamping: 0.7, contactThreshold: 6,
    roughness: 0.95, metalness: 0,
    colours: ['#8d8f86', '#a8a49b', '#75757c', '#9c9276'], castShadow: true,
    scale: [0.65, 1.45],
  },
  {
    // A plate on a post. Information, so it topples rather than
    // stopping anything — the world's rule is that a sign is never
    // a road obstacle, and a 1 kg sign obeys it by falling over.
    id: 'marker', shape: 'marker', size: [0.95, 1.7, 0.5], footprint: 0.7,
    mass: 1.0, friction: 0.6, restitution: 0.08,
    linearDamping: 0.35, angularDamping: 0.7, contactThreshold: 4,
    roughness: 0.72, metalness: 0.08,
    colours: ['#d4491f', '#e2b33a', '#2f6f5e', '#f4f2ee'], castShadow: true,
    scale: [0.85, 1.2],
  },
  {
    id: 'table', shape: 'table', size: [2.5, 0.85, 1.9], footprint: 1.6,
    mass: 4.0, friction: 0.85, restitution: 0.03,
    linearDamping: 0.5, angularDamping: 0.8, contactThreshold: 12,
    roughness: 0.9, metalness: 0,
    colours: ['#9f875f', '#8d7550'], castShadow: true,
    scale: [0.9, 1.1],
  },
  {
    // The road lantern, moved off a fixed collider and onto this.
    // Fifteen of them stood on the verges as 3.8 m static posts and
    // every one of them stopped a 2.5 kg car dead.
    id: 'lantern', shape: 'lantern', size: [0.7, 3.9, 0.7], footprint: 0.8,
    mass: 2.4, friction: 0.6, restitution: 0.05,
    linearDamping: 0.4, angularDamping: 0.85, contactThreshold: 6,
    roughness: 0.7, metalness: 0.2,
    colours: ['#536955', '#4a5f4d'], castShadow: true,
    scale: [0.95, 1.05],
  },
] as const satisfies readonly DecorKind[]

export type DecorKindId = (typeof DECOR_KINDS)[number]['id']

export const decorKindById = Object.fromEntries(
  DECOR_KINDS.map((k): [string, DecorKind] => [k.id, k]),
) as Record<DecorKindId, DecorKind>

/* ------------------------------------------------------------
   THE KINDS THAT ALREADY EXIST

   `Props.SPECS` has carried ten kinds since the playground was
   built, and their instanced meshes are already reserved and
   already drawn. A theme that wants a crate should use THAT
   crate: the marginal cost of one more instance of a reserved
   kind is zero draw calls, where a fifteenth geometry is two.

   Only the footprint and the colour palette are repeated here —
   the mass, the collider and the geometry stay where they are.
   The ids are checked at compile time by `Decor.ts`, which passes
   them straight to `props.add`, so a typo here is a build error
   rather than a missing set.
   ------------------------------------------------------------ */

export const SHARED_KINDS = [
  { id: 'cone', footprint: 0.5, colours: ['#d4491f', '#e2b33a'] },
  { id: 'crate', footprint: 0.85, colours: ['#e2dfd8', '#c8b06a', '#9f875f', '#b9ad86'] },
  { id: 'drum', footprint: 0.6, colours: ['#8a8a92', '#536955', '#a13415'] },
  { id: 'ball', footprint: 0.75, colours: ['#2f6f5e', '#d4491f', '#5f8490'] },
  { id: 'barrier', footprint: 1.45, colours: ['#f2f1ee', '#e2b33a'] },
  { id: 'plank', footprint: 1.95, colours: ['#d8d4cb', '#9f875f'] },
  { id: 'block', footprint: 1.05, colours: ['#3a3a3e', '#75757c'] },
  { id: 'bench', footprint: 1.5, colours: ['#a8a49b', '#9f875f'] },
] as const

export type SharedKindId = (typeof SHARED_KINDS)[number]['id']
export type DecorPlacementKind = DecorKindId | SharedKindId

interface SharedProfile { footprint: number; colours: readonly string[] }

const sharedById = Object.fromEntries(
  SHARED_KINDS.map((k): [string, SharedProfile] => [k.id, k]),
) as Record<SharedKindId, SharedProfile>

/** Ground radius and colour palette for any kind a theme may name. */
export function kindProfile(id: DecorPlacementKind): {
  footprint: number
  colours: readonly string[]
  scale: readonly [number, number]
} {
  const decor = (decorKindById as Record<string, DecorKind | undefined>)[id]
  if (decor) return { footprint: decor.footprint, colours: decor.colours, scale: decor.scale }
  const shared = sharedById[id as SharedKindId]
  // Shared kinds keep their authored geometry size, so their scale
  // range is narrow: a 0.4x crate has a 0.4x collider and 6% of the
  // mass, which stops being a crate and starts being a pebble.
  return { footprint: shared.footprint, colours: shared.colours, scale: [0.8, 1.15] }
}

/* ------------------------------------------------------------
   THEMES

   Ten districts, ten sets. Everything is a FRACTION of the
   anchor's own radius, so the sets follow their districts
   wherever the map generator puts them.

   `band` is [inner, outer] as multiples of that radius. The inner
   figure is what keeps a set off the landmark in the middle; the
   outer is what stops it becoming the ground between districts,
   which the biomes below own instead.
   ------------------------------------------------------------ */

export interface DecorEntry {
  kind: DecorPlacementKind
  /** Base points to try. Instances = count x (stack ?? 1). */
  count: number
  arrangement: DecorArrangement
  /** [inner, outer] as multiples of the anchor radius. */
  band: readonly [number, number]
  /** Items piled at each base point, each lifted by the one below. */
  stack?: number
  /** Overrides the kind's own palette where a district wants its own. */
  colours?: readonly string[]
  /** Passed to `props.add`, so mini-games and achievements can address a set. */
  tag?: string
}

export interface DecorTheme {
  id: string
  /** A district id, or a play spot id. Never a coordinate. */
  anchor: { kind: 'district' | 'play'; id: string }
  entries: readonly DecorEntry[]
  /** Per-theme overrides on the shared placement margins. */
  margin?: Partial<Record<ZoneKind, number>>
}

export const DECOR_THEMES: readonly DecorTheme[] = [
  /*
    EVERY BAND BELOW WAS MEASURED, NOT GUESSED.

    `scripts/world-decor-check.mjs` prints, for each district, the
    share of a ring that survives the placement rules. The numbers in
    the comments are that share, and they are not intuitive: the
    ACHIEVEMENTS plaza is 32% free at 0.5 of its radius and 6% at 1.0,
    because the racing line passes between the two; the TIME MACHINE
    is 0% free below 1.3 because its own levelled pad is there.
    Authored by eye, half these sets landed in the corridors they were
    aimed across and the histogram reported them as circuit and water.
  */
  {
    /* THE FORECOURT FAIR. The first ground anyone drives on, and
       until now it was a cone field on bare paving. Tyre stacks,
       planters and bunting poles give the arrival somewhere to be
       arriving AT.

       The landing is the most crowded ground on the island — four
       roads, a bridge, the physical name, the stunt ramp and the
       spawn — and it never rises above 19% free at any radius. The
       set is therefore BROAD rather than tight: it runs from the
       plate edge out to 1.7 radii, where the ring road's far verge
       reaches 22%. */
    id: 'landing', anchor: { kind: 'district', id: 'landing' },
    entries: [
      { kind: 'tyre', count: 9, arrangement: 'ring', band: [0.6, 0.95], stack: 3 },
      { kind: 'pot', count: 14, arrangement: 'ring', band: [0.55, 0.8] },
      { kind: 'marker', count: 10, arrangement: 'ring', band: [0.75, 1.15] },
      { kind: 'pallet', count: 12, arrangement: 'cluster', band: [0.6, 1.3], stack: 2 },
      { kind: 'bale', count: 10, arrangement: 'cluster', band: [0.7, 1.5] },
      { kind: 'parasol', count: 5, arrangement: 'cluster', band: [0.65, 1.2] },
      { kind: 'table', count: 4, arrangement: 'scatter', band: [0.65, 1.4] },
      { kind: 'bollard', count: 12, arrangement: 'line', band: [0.7, 1.3] },
      { kind: 'crate', count: 10, arrangement: 'grid', band: [0.8, 1.6], stack: 2 },
      { kind: 'barrier', count: 6, arrangement: 'line', band: [0.9, 1.6] },
      // CLEAN SWEEP counts twenty unique cones tagged `cones` and the
      // world places about twenty-one that survive. These are the
      // headroom, so a future scatter change cannot take the
      // achievement — and `completionist` with it.
      { kind: 'cone', count: 18, arrangement: 'scatter', band: [0.5, 1.5], tag: 'cones' },
    ],
  },
  {
    /* THE PADDOCK, STRICTLY OUTSIDE THE CORRIDOR. The circuit margin
       below is 6 m ON TOP of the track's own 8.4 m footprint, so
       nothing here is within 14 m of the centreline — the trackside
       barriers stand at 10 and they are the closest thing to the
       racing line that is allowed to exist. Free ground round the
       start/finish holds 11-26% from 0.7 radii out, so the paddock
       spreads rather than ringing the gantry. */
    id: 'circuit', anchor: { kind: 'district', id: 'circuit' },
    margin: { circuit: 6 },
    entries: [
      { kind: 'tyre', count: 12, arrangement: 'cluster', band: [0.9, 2.2], stack: 2 },
      { kind: 'bale', count: 12, arrangement: 'cluster', band: [0.9, 2.3] },
      { kind: 'bollard', count: 10, arrangement: 'line', band: [1.0, 2.0] },
      { kind: 'marker', count: 8, arrangement: 'ring', band: [1.1, 2.3] },
      { kind: 'drum', count: 8, arrangement: 'cluster', band: [1.0, 2.2] },
      { kind: 'pallet', count: 8, arrangement: 'grid', band: [1.2, 2.3] },
      { kind: 'crate', count: 6, arrangement: 'cluster', band: [1.2, 2.3] },
      { kind: 'cone', count: 10, arrangement: 'scatter', band: [0.9, 2.2], tag: 'cones' },
    ],
  },
  {
    /* THE PICNIC LAWN. Seventeen props were authored for this
       district and all seventeen were deleted at placement time by
       the bowling venue's old 44 m disc. That disc is 26 now, and the
       lawn between 1.2 and 1.9 radii is the freest ground of any
       district on the island at 31-42%, so this is both the first set
       SOCIAL has ever had and the one most likely to survive. */
    id: 'social', anchor: { kind: 'district', id: 'social' },
    entries: [
      { kind: 'table', count: 5, arrangement: 'cluster', band: [1.0, 1.9] },
      { kind: 'parasol', count: 7, arrangement: 'cluster', band: [1.0, 1.9] },
      { kind: 'deckchair', count: 14, arrangement: 'cluster', band: [0.95, 2.0] },
      { kind: 'pot', count: 10, arrangement: 'ring', band: [0.85, 1.4] },
      { kind: 'bollard', count: 8, arrangement: 'ring', band: [1.1, 1.7] },
      { kind: 'sack', count: 8, arrangement: 'cluster', band: [1.0, 2.0] },
      { kind: 'crate', count: 8, arrangement: 'grid', band: [1.1, 2.0] },
      { kind: 'ball', count: 6, arrangement: 'scatter', band: [1.0, 2.0] },
    ],
  },
  {
    /* THE CAR PARK AND THE LANE APRON. The pad is a 74 x 30 m
       rectangle and the venue owns it; this is the ground around it,
       which is 29-35% free between 0.8 and 1.0 radii and falls off a
       cliff past 2.0, where the north coast is. */
    id: 'bowling', anchor: { kind: 'district', id: 'bowling' },
    entries: [
      { kind: 'bollard', count: 18, arrangement: 'line', band: [0.78, 1.35] },
      { kind: 'pin', count: 14, arrangement: 'cluster', band: [0.78, 1.3] },
      { kind: 'pallet', count: 8, arrangement: 'grid', band: [0.8, 1.4], stack: 2 },
      { kind: 'tyre', count: 6, arrangement: 'cluster', band: [0.8, 1.5], stack: 2 },
      { kind: 'marker', count: 8, arrangement: 'ring', band: [0.8, 1.5] },
      { kind: 'crate', count: 10, arrangement: 'grid', band: [0.8, 1.45] },
      { kind: 'cone', count: 8, arrangement: 'scatter', band: [0.8, 1.5], tag: 'cones' },
    ],
  },
  {
    /* THE LOADING DOCK. Pallets, cable drums and flight cases: a
       place where things arrive in boxes and are unpacked. The
       terrace itself is the freest ground here — 17-26% at 0.3-0.5
       radii, against 10-19% outside it — so the dock is built ON the
       plate rather than around it. */
    id: 'projects', anchor: { kind: 'district', id: 'projects' },
    entries: [
      { kind: 'pallet', count: 12, arrangement: 'grid', band: [0.4, 1.2], stack: 3 },
      { kind: 'crate', count: 14, arrangement: 'grid', band: [0.4, 1.3], stack: 2 },
      { kind: 'cog', count: 6, arrangement: 'cluster', band: [0.5, 1.4] },
      { kind: 'sack', count: 12, arrangement: 'cluster', band: [0.5, 1.5] },
      { kind: 'bollard', count: 10, arrangement: 'line', band: [0.6, 1.5] },
      { kind: 'marker', count: 6, arrangement: 'ring', band: [0.7, 1.6] },
      { kind: 'block', count: 6, arrangement: 'cluster', band: [0.6, 1.5] },
      { kind: 'plank', count: 5, arrangement: 'line', band: [0.6, 1.5] },
    ],
  },
  {
    /* THE PODIUM YARD, IN TWO PIECES, because the racing line runs
       between them. The plaza itself is 32-36% free at 0.4-0.5 radii
       and only 6% at 1.0; the ground outside the track recovers to
       25-29% past 1.8. So the plinths and ribbons ring the star, and
       a spectator set sits across the circuit where there is room for
       it. */
    id: 'achievements', anchor: { kind: 'district', id: 'achievements' },
    entries: [
      { kind: 'pot', count: 10, arrangement: 'ring', band: [0.38, 0.62] },
      { kind: 'bollard', count: 12, arrangement: 'ring', band: [0.4, 0.68] },
      { kind: 'pin', count: 8, arrangement: 'cluster', band: [0.38, 0.65] },
      { kind: 'cone', count: 8, arrangement: 'scatter', band: [0.38, 0.7], tag: 'cones' },
      { kind: 'ball', count: 8, arrangement: 'cluster', band: [0.38, 0.7] },
      { kind: 'marker', count: 8, arrangement: 'ring', band: [1.75, 2.35] },
      { kind: 'bale', count: 10, arrangement: 'cluster', band: [1.75, 2.4] },
      { kind: 'table', count: 4, arrangement: 'scatter', band: [1.8, 2.4] },
      { kind: 'deckchair', count: 8, arrangement: 'cluster', band: [1.8, 2.4] },
    ],
  },
  {
    /* THE HEDGE YARD, OUTSIDE THE WALLS. The labyrinth's 46 m square
       is registered as a `play` footprint, so the band starts past it
       and the rules keep it there: topiary in a corridor is a maze
       the car cannot solve.

       The apron is 19% free at 0.9 radii and 1-3% from 1.1 to 1.4,
       because the south-east beach is there. Everything below is
       therefore packed into the one ring that exists, plus a thin
       scatter out at 1.6-2.2 where the shore road's inland side
       recovers to 8-10%. */
    id: 'maze', anchor: { kind: 'district', id: 'maze' },
    entries: [
      { kind: 'pot', count: 18, arrangement: 'ring', band: [0.84, 1.0] },
      { kind: 'lantern', count: 10, arrangement: 'ring', band: [0.84, 1.0] },
      { kind: 'marker', count: 8, arrangement: 'ring', band: [0.85, 1.02] },
      { kind: 'bale', count: 10, arrangement: 'cluster', band: [0.84, 1.02] },
      { kind: 'table', count: 3, arrangement: 'scatter', band: [0.85, 1.02] },
      { kind: 'pallet', count: 6, arrangement: 'cluster', band: [0.85, 1.02] },
      { kind: 'rubble', count: 12, arrangement: 'scatter', band: [1.55, 2.3] },
      { kind: 'crate', count: 8, arrangement: 'cluster', band: [1.55, 2.3] },
    ],
  },
  {
    /* THE SCRAPYARD. Gears on their rims, oil drums and springs — the
       parts of a clock at the scale of a yard rather than a movement.
       Nothing at all fits inside 1.3 radii: the venue levels a flat
       11 m disc there and it is registered as a play footprint. From
       1.3 to 2.3 the infield is 29-38% free, which is the best
       unbuilt ground any district has. */
    id: 'timeMachine', anchor: { kind: 'district', id: 'timeMachine' },
    entries: [
      { kind: 'cog', count: 14, arrangement: 'cluster', band: [1.35, 2.3] },
      { kind: 'drum', count: 10, arrangement: 'cluster', band: [1.35, 2.3], stack: 2 },
      { kind: 'rubble', count: 16, arrangement: 'scatter', band: [1.35, 2.4] },
      { kind: 'sack', count: 10, arrangement: 'cluster', band: [1.35, 2.3] },
      { kind: 'pallet', count: 8, arrangement: 'cluster', band: [1.35, 2.3] },
      { kind: 'bale', count: 8, arrangement: 'cluster', band: [1.4, 2.4] },
      { kind: 'marker', count: 6, arrangement: 'ring', band: [1.4, 2.3] },
      { kind: 'plank', count: 5, arrangement: 'line', band: [1.4, 2.3] },
    ],
  },
  {
    /* THE QUARRY. Rubble, sandbags and hazard plates on the verge
       between the west straight and the lake, which is fifteen metres
       wide. Free ground is 3% at 1.1 radii and peaks at 32% at 1.5,
       so the whole yard sits in that one band and the histogram will
       still report the sea and the circuit taking a share of it. */
    id: 'tnt', anchor: { kind: 'district', id: 'tnt' },
    margin: { circuit: 5 },
    entries: [
      { kind: 'rubble', count: 18, arrangement: 'cluster', band: [1.3, 2.1] },
      { kind: 'sack', count: 14, arrangement: 'cluster', band: [1.3, 2.1] },
      { kind: 'marker', count: 6, arrangement: 'ring', band: [1.35, 2.1] },
      { kind: 'pallet', count: 6, arrangement: 'cluster', band: [1.3, 2.1] },
      { kind: 'bale', count: 6, arrangement: 'cluster', band: [1.35, 2.1] },
      { kind: 'barrier', count: 6, arrangement: 'line', band: [1.35, 2.0] },
      { kind: 'crate', count: 6, arrangement: 'grid', band: [1.35, 2.1] },
    ],
  },
  {
    /* DEBRIS CAUGHT ON THE WAY IN. Inside the circuit's north loop,
       so everything is seen at speed from the outside: silhouette
       only, and nothing that could ever reach the racing surface.

       THE DEBRIS BELONGS IN THE CRATER, so the venue's own disc is
       opened up rather than kept out of. Held out of it, the ring had
       to sit past 13 m, the north loop is right there, and 482 of 594
       attempts were rejected by the racing corridor — the void ended
       up with four stones in it. */
    id: 'blackhole', anchor: { kind: 'district', id: 'blackhole' },
    margin: { play: -7 },
    entries: [
      { kind: 'rubble', count: 22, arrangement: 'ring', band: [0.45, 1.0] },
      { kind: 'block', count: 8, arrangement: 'cluster', band: [0.5, 1.0] },
      { kind: 'cog', count: 6, arrangement: 'cluster', band: [0.5, 1.0] },
      { kind: 'sack', count: 10, arrangement: 'scatter', band: [0.45, 1.0] },
      { kind: 'tyre', count: 5, arrangement: 'cluster', band: [0.5, 1.0] },
      { kind: 'marker', count: 4, arrangement: 'ring', band: [0.55, 1.0] },
    ],
  },
]

/* ------------------------------------------------------------
   BIOMES — THE GROUND BETWEEN THE DISTRICTS

   Ten decorated districts on an empty lawn is ten decorated
   islands. These four fill the rest, and each is derived from a
   feature that already exists: the road network, the coastline,
   the drawing's green masses and the map rectangle.

   Line biomes are authored as a SPACING along their run, because
   that is the unit a verge actually has. Area biomes are authored
   per square metre, because that is the unit a field has. Neither
   is a count, and neither has to be re-tuned when the island is
   rescaled.
   ------------------------------------------------------------ */

export interface DecorLineBiome {
  id: string
  source: 'road' | 'coast'
  /** Metres between candidates along the run, or a fraction of a turn
   *  round the coast — an outline has bearings, not a length. */
  spacing: number
  /** Metres out from the centreline (roads) or in from the sea (coast). */
  offset: number
  kinds: readonly DecorPlacementKind[]
  margin?: Partial<Record<ZoneKind, number>>
  /** Overrides the island-wide 5 m inset from the coastline. */
  coast?: number
  /** How far a rejected candidate may walk off the run, in metres. */
  reach: number
  /** Repaints every kind in the biome. A `bale` in hay yellow is a
   *  hay bale; the same shape in bark is a fallen log. */
  colours?: readonly string[]
}

export interface DecorAreaBiome {
  id: string
  source: 'forest' | 'open'
  /** Overrides the island-wide 5 m inset from the coastline. */
  coast?: number
  /** Repaints every kind in the biome — see `DecorLineBiome.colours`. */
  colours?: readonly string[]
  /** Candidates per square metre of the source's area. */
  density: number
  kinds: readonly DecorPlacementKind[]
  /** Instances per candidate, for logs and cairns that come in twos. */
  clump?: number
  margin?: Partial<Record<ZoneKind, number>>
}

export const DECOR_LINE_BIOMES: readonly DecorLineBiome[] = [
  {
    /* ROADSIDE. The offset is measured from the centreline and the
       road margin is dropped to zero for exactly this reason: a
       marker 3.4 m out is 1.8 m clear of a road whose footprint is
       half its width plus 1.6, which is verge, not carriageway. The
       general 2 m margin is for things that have no business being
       near a road at all. */
    id: 'roadside', source: 'road', spacing: 8, offset: 4.2,
    kinds: ['bollard', 'marker', 'pot', 'rubble', 'bale'],
    /*
      A ROAD GOES WHERE IT GOES, AND ITS VERGE GOES WITH IT.

      With the island-wide margins this biome landed fifteen of
      fifty-three: the roads run INTO the venues, PAST the landmarks
      and ALONG the shore, so the general keep-out around each of
      those was rejecting the one place a verge can be. A kerbstone
      beside the bowling approach is not in the bowling alley, and the
      3 m coast inset is what lets the shore road keep its seaward
      side.
    */
    margin: { road: 0, plate: 0, play: 0, landmark: 0, ramp: 0, respawn: 2 },
    coast: 3,
    // Eight metres. Past that it is not a verge, it is a field.
    reach: 8,
  },
  {
    /* THE STRAND. Twelve metres back from the first shoreline a
       bearing crosses, which is off the beach with the sea still the
       view. `spacing` is a fraction of a turn here rather than a
       distance: an island is an outline, not a polyline with a length
       anyone has measured, and 0.0045 is a bearing every 1.6 degrees,
       or 222 candidates round the coast. */
    id: 'strand', source: 'coast', spacing: 0.0045, offset: 12,
    kinds: ['rubble', 'bale', 'sack', 'crate', 'pallet'],
    colours: ['#c9c2a0', '#ded4ae', '#9f875f', '#b9ad86', '#8d8f86'],
    coast: 3,
    /* Twenty-two, because the circuit's west run and north loop are
       within fifteen metres of the shoreline for most of their
       length: a beach candidate that cannot walk past the track has
       nowhere to go, and 1,850 of its 4,274 rejections were the
       racing corridor. */
    reach: 22,
  },
]

export const DECOR_AREA_BIOMES: readonly DecorAreaBiome[] = [
  {
    /* THE FOREST FLOOR. Fallen logs — a `bale` repainted in bark —
       and the stones that come with them, in twos. The ecology's own
       undergrowth already owns these ellipses, so this is the layer
       you can knock over: one candidate per 190 m² of woodland, at
       the RIM of each mass rather than in its middle, because the rim
       is the part you drive past. */
    id: 'forest-floor', source: 'forest', density: 1 / 190,
    kinds: ['bale', 'rubble', 'pot'], clump: 2,
    colours: ['#76654d', '#8d7550', '#6f7a5a', '#5e7f4f', '#8d8f86'],
  },
  {
    /* OPEN GROUND. The thinnest layer on the island and the one that
       stops the middle distance being a texture. One candidate every
       460 m² over the 266 x 199.5 m map rectangle is 115 darts, and
       two thirds of them land in the sea or on a corridor — counted
       as rejections rather than quietly dropped, which is the whole
       argument of this file. */
    id: 'open-ground', source: 'open', density: 1 / 460,
    kinds: ['rubble', 'bale', 'marker'],
    colours: ['#8d8f86', '#a8a49b', '#9c9276', '#c8b06a'],
  },
]

/* ------------------------------------------------------------
   THE PLANNER
   ------------------------------------------------------------ */

export interface DecorPlacement {
  theme: string
  kind: DecorPlacementKind
  x: number
  z: number
  /** Metres above the ground: stacks, and nothing else. */
  lift: number
  rotation: number
  /** Uniform. The collider and the mass follow it; see `Props.add`. */
  scale: number
  colour: string
  tag?: string
}

export interface DecorThemeStats {
  id: string
  /** Base points the manifest asked for. A stack of three tyres is one
   *  point, so this is the number that says whether a SET arrived. */
  wanted: number
  /** Candidates tested. Each point gets up to 22 of them, so this is
   *  effort spent and not a denominator worth quoting a yield against. */
  attempted: number
  placed: number
  /** Rejections by the ZONE KIND that caused them. The histogram that
   *  would have caught 153 silent discards out of 270. */
  rejected: Record<string, number>
}

export interface DecorPlan {
  placements: DecorPlacement[]
  themes: DecorThemeStats[]
  /** Instances per prop kind, which is exactly what must be reserved. */
  capacity: Record<string, number>
  attempted: number
  placed: number
  /** Closest two placements, metres between their centres. */
  minSpacing: number
}

/*
  THE SHARED DOOR. Ecology asks `world-layout` this same question
  with these same numbers; the difference is only the clearance,
  which is the prop's own footprint rather than a plant's.

  `plate` is allowed because a forecourt is exactly where a
  forecourt fair belongs, and it is given a zero margin so that
  the placements ALREADY MADE — which are passed back in as
  `extra` under the same kind — space themselves on their
  footprints alone.
*/
const BASE_MARGIN: Partial<Record<ZoneKind, number>> = {
  /*
    THESE ARE NOT THE ECOLOGY'S MARGINS AND THEY MUST NOT BE.

    Every one of these numbers was measured against the rejection
    histogram, and the first set — the ecology's, road 2.5 / circuit 2
    / ramp 8 — landed 248 of 9,036 attempts and gave the LANDING, the
    first ground anyone drives on, nineteen objects. Six hundred and
    fifty of its thousand attempts died on a road margin, a hundred
    and forty of the PROJECTS attempts on a ramp disc 34 m across.

    A knockable prop earns looser rules than a tree, for a reason
    that is written into the physics rather than into taste:
    `Physics.obstacleAt` raycasts with EXCLUDE_DYNAMIC, so a dynamic
    prop is invisible to the road-clearance probe and to the respawn
    audit, and at 1-4 kg against a 2.5 kg car it is invisible to the
    driver too — it moves. The margins that remain are the ones where
    something is actually at stake: the racing surface, a ramp's
    landing, the sea.
  */
  // The road footprint is already half its width plus 1.6 m of
  // shoulder, so this is a metre and a half of verge on top of that.
  road: 0.5,
  // On top of width/2 + 3.4, which puts the nearest decoration
  // 11.9 m from the centreline. The trackside barriers stand at 10.
  circuit: 3.5,
  // The ramp zone is already length/2 + 6, which is the run-up.
  ramp: 3,
  water: 1.0,
  landmark: 1.0,
  bridge: 1.5,
  play: 1.5,
  /*
    POSITIVE, giving 10 m clear of a 7 m footprint.

    It was -1 — six metres, the figure the prop scatter has always used
    — on the argument that a wide exclusion paints a bare circle around
    the one spot every visitor is guaranteed to look at. That argument
    was made against a hundred and seventeen props. Against a thousand
    it is wrong: `world-qa` drives away from every respawn for 1.4 s
    and four of the twelve could not make four metres, one of them
    ending on its roof. R is what people press when they are stuck, and
    a respawn you cannot drive out of is the worst object on the
    island. Ten metres costs 3,800 m² of the island's 40,000 and buys
    twelve places that always work.
  */
  respawn: 3,
  letters: 0.5,
  plate: 0,
}

/** Metres inside the coastline. Six, not the ecology's ten: a crate
 *  on a beach is the point of a beach. */
const COAST_MARGIN = 5

const ALLOW: readonly ZoneKind[] = ['plate']

/** A cheap seeded generator, matching `core/maths.seeded`. */
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function anchorOf(theme: DecorTheme): { x: number; z: number; radius: number } | null {
  if (theme.anchor.kind === 'district') {
    const district = districts.find((d) => d.id === theme.anchor.id)
    return district ? { x: district.x, z: district.z, radius: district.radius } : null
  }
  const spot = PLAY_SPOTS.find((p) => p.id === theme.anchor.id)
  return spot ? { x: spot.x, z: spot.z, radius: spot.radius } : null
}

/** Walk a polyline dropping a point every `spacing` metres. */
function alongPolyline(
  points: readonly (readonly number[])[],
  spacing: number,
): { x: number; z: number; angle: number }[] {
  const out: { x: number; z: number; angle: number }[] = []
  let carry = spacing * 0.5
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i]
    const [bx, bz] = points[i + 1]
    const length = Math.hypot(bx - ax, bz - az)
    if (length < 1e-3) continue
    const angle = Math.atan2(bz - az, bx - ax)
    for (let d = carry; d < length; d += spacing) {
      const t = d / length
      out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, angle })
    }
    carry = Math.max(0, carry + Math.ceil((length - carry) / spacing) * spacing - length)
  }
  return out
}

/**
 * Every placement on the island, and every rejection, in one pure
 * pass. Deterministic: the same seed gives the same island, which
 * is what lets `world-decor-check.mjs` report the numbers the
 * world will actually build rather than a plausible sample of
 * them.
 *
 * Counts are NOT scaled by quality. Every one of these carries a
 * collider, and `Quality.ts`'s rule is that a tier changes what
 * the world LOOKS like and never what it COLLIDES with — a phone
 * and a desktop have to be playing the same game.
 */
export function planDecor(seed = 402117): DecorPlan {
  const rand = seeded(seed)
  const placements: DecorPlacement[] = []
  const themes: DecorThemeStats[] = []
  const capacity: Record<string, number> = {}
  // Every placement so far, as a footprint `blockedBy` can measure
  // against. This is the mechanism that stops a set finding the same
  // piece of free ground fourteen times.
  const extra: Zone[] = []

  const commit = (
    theme: string, kind: DecorPlacementKind, x: number, z: number,
    footprint: number, colour: string, scale: number, rotation: number,
    lift: number, tag?: string,
  ) => {
    placements.push({ theme, kind, x, z, lift, rotation, scale, colour, tag })
    capacity[kind] = (capacity[kind] ?? 0) + 1
    if (lift === 0) {
      extra.push({ id: `decor-${placements.length}`, kind: 'plate', x, z, radius: footprint })
    }
  }

  /**
   * One candidate, tested. Returns the blocking zone's kind on a
   * rejection so the caller can build the histogram — the whole
   * difference between this and the scatter it replaces.
   */
  const tryPoint = (
    x: number, z: number, footprint: number,
    margin: Partial<Record<ZoneKind, number>>,
    coast: number,
  ): string | null => {
    const blocker = blockedBy(x, z, {
      clearance: footprint,
      coastMargin: coast,
      allow: ALLOW,
      margin,
      extra,
    })
    if (!blocker) return null
    // A placed prop and a district plate are both `plate`; only one of
    // them is worth reporting as a reason.
    return blocker.id.startsWith('decor-') ? 'spacing' : blocker.kind
  }

  const run = (
    id: string,
    margin: Partial<Record<ZoneKind, number>>,
    coast: number,
    entries: readonly {
      kind: DecorPlacementKind
      count: number
      stack: number
      tag?: string
      colours?: readonly string[]
      candidate: (index: number, attempt: number) => { x: number; z: number; rotation: number }
    }[],
  ) => {
    const stats: DecorThemeStats = { id, wanted: 0, attempted: 0, placed: 0, rejected: {} }
    for (const entry of entries) {
      stats.wanted += entry.count
      const profile = kindProfile(entry.kind)
      const palette = entry.colours ?? profile.colours
      for (let index = 0; index < entry.count; index++) {
        // Twenty-two tries per point. Fewer and a crowded district
        // silently ships half its set; more and the yard fills with
        // things wedged into the last gap, which reads as clutter
        // rather than as arrangement.
        let landed = false
        for (let attempt = 0; attempt < 22 && !landed; attempt++) {
          const point = entry.candidate(index, attempt)
          stats.attempted++
          const scale = profile.scale[0] + rand() * (profile.scale[1] - profile.scale[0])
          const footprint = profile.footprint * scale
          const reason = tryPoint(point.x, point.z, footprint, margin, coast)
          if (reason) {
            stats.rejected[reason] = (stats.rejected[reason] ?? 0) + 1
            continue
          }
          const colour = palette[Math.floor(rand() * palette.length)]
          for (let s = 0; s < entry.stack; s++) {
            // A stacked piece is placed on top of the one below and
            // rotated off it, so a tyre wall is not an extruded tyre.
            commit(
              id, entry.kind, point.x, point.z, footprint, colour, scale,
              point.rotation + s * 0.7,
              s * decorStackHeight(entry.kind) * scale,
              entry.tag,
            )
          }
          landed = true
          stats.placed++
        }
      }
    }
    themes.push(stats)
  }

  /* ---- the ten districts ------------------------------- */
  for (const theme of DECOR_THEMES) {
    const anchor = anchorOf(theme)
    if (!anchor) continue
    const margin = { ...BASE_MARGIN, ...theme.margin }
    run(theme.id, margin, COAST_MARGIN, theme.entries.map((entry) => {
      const [inner, outer] = entry.band
      // One bearing per index for a ring, a knot centre per entry for
      // a cluster, a seeded chord for a line, a rotated lattice for a
      // grid. All four are drawn ONCE, outside the attempt loop, so a
      // retry jitters an arrangement rather than abandoning it.
      // `r` and `lineRadius` are positions ACROSS the band, 0 at its
      // inner edge and 1 at its outer, which is what `band()` below
      // takes. Holding them as absolute radii instead was how a
      // cluster authored at [1.0, 3.0] ended up sixty metres out.
      const spin = rand() * Math.PI * 2
      const knots = [0, 1, 2].map(() => ({ a: rand() * Math.PI * 2, r: rand() }))
      const lineAngle = rand() * Math.PI * 2
      const lineRadius = rand()
      const columns = Math.max(2, Math.round(Math.sqrt(entry.count)))
      const step = kindProfile(entry.kind).footprint * 2.7
      return {
        kind: entry.kind,
        count: entry.count,
        stack: entry.stack ?? 1,
        tag: entry.tag,
        colours: entry.colours,
        candidate: (index: number, attempt: number) => {
          /*
            A RETRY SWEEPS, IT DOES NOT WANDER OFF.

            The first version grew a line's radius by 12% per attempt,
            so a rejected car-park kerb was two and a half times its
            band away by attempt twenty-two and had stopped belonging
            to its district. Every arrangement now rotates about the
            anchor instead and stays inside the band it was authored
            in: a set that cannot fit where it was drawn is a set that
            should be reported missing, not one that should be smeared
            across the island looking for room.
          */
          const sweep = Math.ceil(attempt / 2) * (attempt % 2 ? 1 : -1) * 0.38
          const band = (t: number) => anchor.radius * (inner + (outer - inner) * t)
          let x = anchor.x
          let z = anchor.z
          let rotation = rand() * Math.PI * 2
          if (entry.arrangement === 'ring') {
            const a = spin + (index / entry.count) * Math.PI * 2 + sweep * 0.5
            const r = band(0.5 + 0.5 * Math.sin(index * 2.4))
            x += Math.cos(a) * r
            z += Math.sin(a) * r
            rotation = -a
          } else if (entry.arrangement === 'cluster') {
            const knot = knots[index % knots.length]
            const a = knot.a + sweep
            const spread = anchor.radius * (outer - inner) * 0.26
            x += Math.cos(a) * band(knot.r) + (rand() - 0.5) * spread * 2
            z += Math.sin(a) * band(knot.r) + (rand() - 0.5) * spread * 2
          } else if (entry.arrangement === 'line' || entry.arrangement === 'grid') {
            const columnsHere = entry.arrangement === 'line' ? entry.count : columns
            const col = index % columnsHere
            const row = Math.floor(index / columnsHere)
            const rows = Math.ceil(entry.count / columnsHere)
            const along = (col - (columnsHere - 1) / 2) * step
            const back = (row - (rows - 1) / 2) * step
            const a = lineAngle + sweep
            const r = band(lineRadius)
            x += Math.cos(a) * (r + back) - Math.sin(a) * along
            z += Math.sin(a) * (r + back) + Math.cos(a) * along
            rotation = a
          } else {
            const a = rand() * Math.PI * 2
            x += Math.cos(a) * band(rand())
            z += Math.sin(a) * band(rand())
          }
          return { x, z, rotation }
        },
      }
    }))
  }

  /* ---- the ground between them ------------------------- */
  for (const biome of DECOR_LINE_BIOMES) {
    const margin = { ...BASE_MARGIN, ...biome.margin }
    /*
      Each candidate carries the direction a REJECTED one should walk
      in. For a verge that is straight out from the carriageway; for
      the strand it is straight inland. The first version walked every
      point along the same perpendicular for up to thirty-five metres,
      which is how the roadside biome came to be rejected ninety-four
      times by play spots it had wandered into and landed twelve of
      twenty-eight.
    */
    const points: { x: number; z: number; angle: number; ex: number; ez: number }[] = []
    if (biome.source === 'road') {
      let side = 1
      for (const road of roads) {
        for (const point of alongPolyline(road.points, biome.spacing)) {
          side = -side
          const ex = Math.sin(point.angle) * side
          const ez = -Math.cos(point.angle) * side
          const out = road.width * 0.5 + biome.offset
          points.push({
            x: point.x + ex * out, z: point.z + ez * out,
            angle: point.angle, ex, ez,
          })
        }
      }
    } else {
      // `spacing` is a fraction of a turn for the coast — see the
      // strand biome — so this is one bearing every `spacing` of a
      // full turn, walked outward from the origin.
      const steps = Math.max(8, Math.round(1 / biome.spacing))
      for (let i = 0; i < steps; i++) {
        const bearing = (i / steps) * Math.PI * 2
        const r = coastRayDistance(bearing) - biome.offset
        points.push({
          x: Math.cos(bearing) * r, z: Math.sin(bearing) * r,
          angle: bearing, ex: -Math.cos(bearing), ez: -Math.sin(bearing),
        })
      }
    }
    /*
      THE POINTS ARE DEALT ROUND THE KINDS, not multiplied by them. A
      run() entry is one kind, so four entries each asking for every
      point would stand a bollard, a marker, a planter and a stone on
      the same square metre and then reject three of them as
      `spacing` — a rejection histogram full of self-inflicted
      failures, which is the opposite of the point. Dealing them means
      a verge reads as bollard, marker, planter, stone rather than as
      four hundred metres of identical bollard, and every rejection
      reported is a real one.
    */
    run(biome.id, margin, biome.coast ?? COAST_MARGIN, biome.kinds.map((kind, k) => {
      const mine = points.filter((_, index) => index % biome.kinds.length === k)
      return {
        kind,
        count: mine.length,
        stack: 1,
        colours: biome.colours,
        candidate: (index: number, attempt: number) => {
          // A candidate on a line is blocked where it stands, so
          // re-rolling the same metre finds nothing. Each retry steps
          // further along the escape direction — outward from the
          // carriageway for a road, inland for the coast — and stops
          // at the biome's own `reach`, because a verge piece twelve
          // metres from its verge is not roadside furniture any more.
          const point = mine[index]
          const out = Math.min(attempt / 21, 1) * biome.reach
          return {
            x: point.x + point.ex * out,
            z: point.z + point.ez * out,
            rotation: point.angle,
          }
        },
      }
    }))
  }

  for (const biome of DECOR_AREA_BIOMES) {
    const margin = { ...BASE_MARGIN, ...biome.margin }
    const entries: {
      kind: DecorPlacementKind
      count: number
      stack: number
      colours?: readonly string[]
      candidate: (index: number, attempt: number) => { x: number; z: number; rotation: number }
    }[] = []
    if (biome.source === 'forest') {
      for (const zone of VEGETATION_ZONES) {
        const count = Math.max(1, Math.round(Math.PI * zone.rx * zone.rz * biome.density))
        for (let k = 0; k < biome.kinds.length; k++) {
          entries.push({
            kind: biome.kinds[k],
            count: Math.max(1, Math.round(count / biome.kinds.length)),
            stack: biome.clump ?? 1,
            colours: biome.colours,
            candidate: () => {
              const a = rand() * Math.PI * 2
              // sqrt so the darts spread evenly over the ellipse
              // rather than piling into its middle; 0.55 keeps them
              // out to the RIM, which is the edge you actually drive
              // past.
              const d = 0.55 + Math.sqrt(rand()) * 0.45
              return {
                x: zone.x + Math.cos(a) * zone.rx * d,
                z: zone.z + Math.sin(a) * zone.rz * d,
                rotation: rand() * Math.PI * 2,
              }
            },
          })
        }
      }
    } else {
      const count = Math.round(MAP_WIDTH * MAP_DEPTH * biome.density)
      for (let k = 0; k < biome.kinds.length; k++) {
        entries.push({
          kind: biome.kinds[k],
          count: Math.max(1, Math.round(count / biome.kinds.length)),
          stack: biome.clump ?? 1,
          colours: biome.colours,
          candidate: () => ({
            x: (rand() - 0.5) * MAP_WIDTH,
            z: (rand() - 0.5) * MAP_DEPTH,
            rotation: rand() * Math.PI * 2,
          }),
        })
      }
    }
    run(biome.id, margin, biome.coast ?? COAST_MARGIN, entries)
  }

  let minSpacing = Infinity
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      if (placements[i].lift || placements[j].lift) continue
      const d = Math.hypot(placements[i].x - placements[j].x, placements[i].z - placements[j].z)
      if (d < minSpacing) minSpacing = d
    }
  }

  return {
    placements,
    themes,
    capacity,
    attempted: themes.reduce((t, s) => t + s.attempted, 0),
    placed: placements.length,
    minSpacing: Number.isFinite(minSpacing) ? minSpacing : 0,
  }
}

/**
 * How high one of these sits on top of another. Only the shapes a
 * theme actually stacks need an honest answer; anything else is
 * stacked on its own bounding height, which is what a pile of it
 * would do.
 */
export function decorStackHeight(id: DecorPlacementKind): number {
  const decor = (decorKindById as Record<string, DecorKind | undefined>)[id]
  if (decor) return decor.size[1] * 0.94
  // The shared kinds, from their geometry in `Props.SPECS`.
  const heights: Record<SharedKindId, number> = {
    cone: 0.86, crate: 1.1, drum: 1.1, ball: 1.24,
    barrier: 1.0, plank: 0.22, block: 1.6, bench: 0.68,
  }
  return heights[id as SharedKindId] * 0.98
}
