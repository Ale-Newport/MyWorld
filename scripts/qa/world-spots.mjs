/* The five places the /world per-frame checks measure, in world coordinates (the arrival is found the way the map's travel finds one). */
export const SPOTS = {
  plaza: null, // where the world starts
  ferris: { x: 60.6, z: -35.9, name: 'Ferris Plaza' },
  circuit: { x: -49.7, z: 43.6, name: 'Start race' },
  projects: { x: 94.7, z: 18.7, name: 'Projects' },
  beach: { x: -91.8, z: 126.7, name: 'Beach' },
}

/** Places along the shore, where the sea's colour and mesh show: the south coast (harbor, beach) and the west (lighthouse), seen from the gameplay camera. */
export const COAST_SPOTS = {
  harbor: { x: 26, z: 98, name: 'Harbor' },
  beachshore: { x: -56, z: 110, name: 'Beach' },
  lighthouse: { x: -124, z: 50, name: 'Lighthouse' },
  beach: SPOTS.beach,
}
