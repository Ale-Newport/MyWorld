import * as THREE from 'three';
/* ============================================================
   PALETTE

   The world reads from the same tokens as the rest of the site
   (`src/styles/tokens.css`). Two mediums, one colour system: the
   3D world must not look like a different designer's project
   bolted onto the portfolio.

   Values are duplicated here as literals rather than read from
   computed styles, because a shader that waits on `getComputedStyle`
   is a shader that flashes the wrong colour on first frame. They
   are checked against the stylesheet by `npm run typecheck`? No —
   by hand, and by the note below. Keep them in sync.

   tokens.css            here
   --paper    #f4f2ee    paper
   --paper-2  #eceae5    paper2
   --paper-3  #e2dfd8    paper3
   --void     #0a0a0b    voidDark
   --void-2   #111113    voidDark2
   --void-3   #1a1a1d    voidDark3
   --ink      #0c0c0d    ink
   --ink-2    #3a3a3e    ink2
   --ink-3    #75757c    ink3
   --ink-4    #a6a6ad    ink4
   --chalk    #f2f1ee    chalk
   --accent   #d4491f    accent
   --signal   #2f6f5e    signal
   ============================================================ */
export const palette = {
    paper: '#f4f2ee',
    paper2: '#eceae5',
    paper3: '#e2dfd8',
    paper4: '#d8d4cb',
    voidDark: '#0a0a0b',
    voidDark2: '#111113',
    voidDark3: '#1a1a1d',
    ink: '#0c0c0d',
    ink2: '#3a3a3e',
    ink3: '#75757c',
    ink4: '#a6a6ad',
    chalk: '#f2f1ee',
    chalk2: '#b8b7b3',
    chalk3: '#7c7b79',
    accent: '#d4491f',
    accentSoft: '#e8734d',
    accentDeep: '#a13415',
    signal: '#2f6f5e',
    signalSoft: '#4f9a85',
    /* Working greys for the world's built environment. */
    concrete: '#cfcbc2',
    concreteDark: '#a8a49b',
    asphalt: '#2e2e33',
    asphaltLight: '#3c3c42',
    metal: '#8a8a92',
    glass: '#9fb4c9',
    /* ---- ROAD SURFACES ------------------------------------------
       Roads used to be painted in `concrete` (#cfcbc2), which is two
       shades off the paper the districts are paved with and lighter
       than the grass either side. From the driving camera the network
       simply did not read: you could not tell where the road went
       without looking at the map.
  
       This is deliberately not black. A charcoal ribbon across a
       pale-green island reads as a scar; these are the warm, slightly
       blue-grey greys of worn asphalt, dark enough to hold their own
       against #b6be88 grass and light enough to take a shadow. */
    road: '#5d5c5f',
    roadDark: '#4b4a4e',
    roadLight: '#6e6d70',
    /** Compacted dirt and gravel where the tarmac ends. */
    roadShoulder: '#9c9276',
    /** Lane and edge markings. Bone, not white — white flares. */
    roadLine: '#d8d4c6',
    /** Unsurfaced tracks: the dirt run out to the stunt ramp. */
    roadDirt: '#b08a55',
    roadDirtEdge: '#8e6d3f',
    /* Sky and light. */
    skyDay: '#dfe4e8',
    skyDusk: '#c69a7e',
    skyNight: '#0d1017',
    sunDay: '#fff4e2',
    sunDusk: '#ff9a5c',
    moon: '#c8d4e8',
};
const cache = new Map();
/** Cached `THREE.Color` for a hex string. Never mutate the result. */
export function colour(hex) {
    let c = cache.get(hex);
    if (!c) {
        c = new THREE.Color(hex);
        cache.set(hex, c);
    }
    return c;
}
/** Cached colour for a palette token. */
export function token(key) {
    return colour(palette[key]);
}
/** A fresh, mutable copy — for anything that lerps. */
export function colourOf(hex) {
    return new THREE.Color(hex);
}
