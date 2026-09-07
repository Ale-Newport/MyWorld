import type { CoreState } from '@/content/types'

export interface CoreTransform {
  scale: number
  x: number
  y: number
  z: number
  /** Vertical elongation of the shell. */
  stretch: number
  /** Extra spin rate. */
  spin: number
  /** How far the instrument rings open. */
  ringSpread: number
  /** Face-explosion amount. */
  shatter: number
  opacity: number
  tiltX: number
}

const base: CoreTransform = {
  scale: 1, x: 0, y: 0, z: 0,
  stretch: 0, spin: 0, ringSpread: 0, shatter: 0, opacity: 1, tiltX: 0,
}

/**
 * The Core's identity per chapter. These are TARGETS — the Core
 * damps toward them, so every transition is reversible and
 * continuous no matter how the visitor scrubs.
 */
export const CORE_STATES: Record<CoreState, CoreTransform> = {
  // Prelude / About / UCL — the original probe.
  capsule:   { ...base, scale: 0.62, y: -2.45, z: -0.2, ringSpread: 0.22, spin: 0.05 },

  // About — small, right of the type, alone in a large room.
  drift:     { ...base, scale: 0.5,  x: 2.9,  y: -0.6, z: -2.0, ringSpread: 0.5, spin: 0.12, tiltX: 0.1 },

  // KCL — travelling along the timeline, leaning into motion.
  traveller: { ...base, scale: 0.44, x: -1.1, y: -2.1, z: 0.4, stretch: 0.22, spin: 0.35, ringSpread: 0.3, tiltX: 0.24 },

  // Playground — becomes a small ground vehicle, sits low.
  rover:     { ...base, scale: 0.5,  y: -1.6, z: 1.2, stretch: -0.18, spin: 0.1, ringSpread: 0.55, opacity: 0.0 },

  // Pansofia — unfolds into browser panes; the Core recedes.
  window:    { ...base, scale: 0.34, x: -3.1, y: 1.0,  z: -1.4, opacity: 0.28, ringSpread: 0.6, spin: 0.2 },

  // Teaching — a quiet terminal marker at the edge.
  terminal:  { ...base, scale: 0.24, x: 3.3,  y: -1.7, z: -1.6, opacity: 0.22, ringSpread: 0.3, spin: 0.08 },

  // Focus — becomes the device; the Core hides behind the phone.
  device:    { ...base, scale: 0.22, x: 0.2,  y: 2.1, z: -3.4, opacity: 0.16, ringSpread: 0.35, spin: 0.6 },

  // Gym — the rig's origin joint.
  rig:       { ...base, scale: 0.26, x: -3.6, y: 1.3, z: -1.8, opacity: 0.3, ringSpread: 1.0, spin: 0.5 },

  // Metaview — a neural/data node at the centre of the galaxy.
  node:      { ...base, scale: 0.34, y: 0,    z: -2.0, stretch: -0.3, spin: 0.9, ringSpread: 1.4, opacity: 0.6 },

  // Chess — dissolves into the board lattice.
  grid:      { ...base, scale: 0.3,  y: 2.3,  z: -2.4, shatter: 0.32, spin: 0.3, ringSpread: 0.9, opacity: 0.35 },

  // Stock — stretched into a stream of parallel orders.
  stream:    { ...base, scale: 0.36, x: -3.9, y: 1.4, z: -1.8, stretch: 1.6, spin: 1.4, ringSpread: 0.25, opacity: 0.22 },

  // Universe — the central star everything orbits.
  star:      { ...base, scale: 0.42, spin: 0.4, ringSpread: 1.4, opacity: 0.75 },

  // Toolbox — a lattice hub.
  matrix:    { ...base, scale: 0.3,  y: 0.2, z: -3.0, spin: 0.7, ringSpread: 1.8, opacity: 0.3 },

  // Contact — everything reassembles around it.
  system:    { ...base, scale: 0.85, spin: 0.16, ringSpread: 1.1, opacity: 1 },
}
