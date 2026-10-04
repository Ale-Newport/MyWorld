/* ============================================================
   THE ROOM — TUNING SURFACE
   Every number a designer is expected to turn lives here and
   nowhere else. Developer-facing only: nothing on the page
   exposes these. Units are metres for anything in the room,
   0..1 for anything in the growth timeline, and fractions of the
   viewport for anything about the copy.
   ============================================================ */

export const ROOM_CONFIG = {
  /** One seed grows the whole room. Change it and every vine,
      leaf, tuft and crack moves; keep it and nothing ever does. */
  seed: 23118,

  /* ---- growth timeline ------------------------------------
     Growth G is 0..1. It is derived from the journey's scroll
     progress between two chapter boundaries (see `growth.ts`),
     never from time, so any scroll position has exactly one look. */
  growth: {
    /** Chapter whose start is G = 0. */
    fromChapter: 'prelude',
    /** Chapter whose start is G = 1 — the room is mature before
        the contact chapter pins, so its copy reads over a still
        wall and the portal's leaf cover never competes with it. */
    toChapter: 'contact',
    /** The room is never empty: at G = 0 it already shows this
        much growth (moss in the joints, a first shoot or two). */
    floor: 0.06,
    /** Damped follow of the scroll value, per second. High enough
        that a jump lands within a few frames; reduced motion and
        restored positions snap. */
    follow: 9,
    /** With reduced motion the room does not grow at all: it holds
        one settled, mature-but-calm state. */
    reducedMotion: 0.78,
    /** The portal's charge (0..1) at which the room's takeover of the
        copy's ground is complete; the canopy closes the rest. */
    takeoverAt: 0.75,
  },

  /* ---- vegetation ----------------------------------------- */
  vines: {
    /** Multiplies the leaf count along every stem. */
    leafDensity: 1,
    /** Leaf length in metres (before per-leaf variation). */
    leafScale: 0.125,
    /** Fraction of leaves that lift away from the wall. */
    liftedShare: 0.42,
    /** Upper bound on lift angle, radians. */
    maxLift: 0.75,
    /** Stem radius at the root, metres. */
    stemRadius: 0.0075,
    /** Branch count multiplier. */
    branchDensity: 1,
    /** Fraction of leaves that move with the air. */
    swayShare: 0.14,
    /** Sway amplitude, radians. */
    swayAmplitude: 0.05,
  },

  moss: {
    /** Global multiplier on how far moss spreads by G = 1. */
    coverage: 1,
    /** Repeat of the moss sheet on the stone, metres. */
    tile: 1.15,
    /** Tufts per square metre where moss has taken hold. */
    tuftDensity: 5200,
    /** Mean tuft diameter, metres (each varies about half either way). */
    tuftSize: 0.038,
  },

  weather: {
    cracks: 16,
    drips: 26,
    litter: 38,
  },

  /* ---- reading field ---------------------------------------
     The copy's measured boxes become a smooth field over the
     viewport; growth is planned away from it rather than cut at
     its edge. Clearance is in multiples of the text's font size
     plus a fixed fraction of the viewport's short side. */
  clearance: {
    /** Clearance round display type (>= 28px), in em, capped in px:
        a 190px name carries its own air. */
    displayEm: 0.22,
    displayMax: 44,
    /** Clearance round body type (16–28px), in em. */
    bodyEm: 0.6,
    /** Clearance round labels (< 16px), in em. */
    labelEm: 0.55,
    /** Fixed clearance, as a fraction of min(width, height). */
    base: 0.006,
    /** Field value above which no leaf or stem may sit. */
    leafLimit: 0.3,
    /** How strongly the field delays moss, damp and cracks. */
    mossDelay: 1.6,
    /** Blur radius of the field, as a fraction of the short side. */
    blur: 0.012,
  },

  /* ---- light ------------------------------------------------ */
  light: {
    /** Exposure applied before tone mapping. */
    exposure: 0.74,
    /** Soft key: a broad roof light high above the front of the
        hall, a little to the left, never seen. `intensity` is what
        the back wall receives at `reference`; it falls off with
        distance from there, so the hall is brighter to the left. */
    key: {
      intensity: 0.95,
      color: [1.0, 0.958, 0.895],
      window: { center: [-3.8, 9.6, 10.6], size: [3.6, 2.8], normal: [0.28, -0.62, -0.73] },
      reference: [0, 2.2, 0],
      /** Mean direction, for specular and for the plants' shading. */
      direction: [-0.29, 0.55, 0.78],
    },
    /** Skylight: the top-lit gallery's even fill. */
    sky: { intensity: 0.7, color: [0.93, 0.965, 1.0] },
    /** Inter-reflection floor in a white room. */
    bounce: { intensity: 0.58, color: [1.0, 0.972, 0.93] },
    /** Light returned by the lit back wall into the hall. */
    wallBounce: { intensity: 0.7, color: [1.0, 0.975, 0.94] },
  },

  /* ---- the portal's canopy ----------------------------------
     The ivy that closes over the page at the very end (see
     canopy/plan.ts). It hangs in the air in front of the hall, so it
     takes the hall's key and sky directly rather than from the
     wall-side light cache. */
  canopy: {
    /** Skylight on leaves in the open, as a share of the sky's colour. */
    ambient: 0.55,
    /** Multiplier on the hall's key light. */
    key: 1,
  },

  /* ---- quality tiers ---------------------------------------
     Chosen from the device profile and demoted at runtime if the
     frame budget is missed. A lower tier keeps the same scene and
     the same plants; it spends fewer samples and pixels. */
  quality: {
    high: { dpr: 1.75, msaa: 4, shadowSize: 2048, keySamples: 72, skySamples: 96, samplesPerFrame: 32, leafShare: 1, sway: true },
    medium: { dpr: 1.5, msaa: 4, shadowSize: 1536, keySamples: 48, skySamples: 64, samplesPerFrame: 14, leafShare: 0.85, sway: true },
    low: { dpr: 1, msaa: 0, shadowSize: 1024, keySamples: 28, skySamples: 36, samplesPerFrame: 8, leafShare: 0.7, sway: false },
  },
  /** Pixel budget for the canvas, in megapixels, after dpr. Every
      pixel is paid for twice over (two multisampled passes). */
  maxMegapixels: 3.8,
  /** While the light accumulates: samples × pixels per frame, at most
      (each tier's `samplesPerFrame` caps it too). */
  samplePixelsPerFrame: 40e6,
  /** Frame cap for ambient motion. */
  swayFps: 30,
  /** Seconds the air keeps moving after the last scroll or resize. */
  swayLinger: 8,
} as const

/** The painted leaf sheet: the room and the canopy draw the same leaves. */
export const ATLAS_SEED = ROOM_CONFIG.seed ^ 0x0a71

export type QualityName = keyof typeof ROOM_CONFIG.quality
export type QualitySettings = (typeof ROOM_CONFIG.quality)[QualityName]
