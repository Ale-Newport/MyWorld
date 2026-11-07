import * as THREE from 'three'
import { isNight, onPalette, token } from '@/styles/palette-runtime'

/* The scenes' accent: the site's (the editor's colour, its dark-theme shade at night), held in shared THREE.Colors
   that a shader uniform or a per-frame lerp can reference directly, and recoloured in place when the palette changes. */
export const ACCENT = new THREE.Color('#2f6b3f')
export const ACCENT_SOFT = new THREE.Color('#6d9779')

/* Day or night, for the values a scene tunes against the ground rather than takes from a token: graphite that
   subtracts from the cream by day has to be a pale ink that adds to the dark at night, at about the same distance
   from the page. `version` moves on every change, so a scene that bakes colours into instance or vertex
   attributes (and only rewrites them when something changes) knows to rewrite them. */
export const SCENE = { night: false, version: 0 }

/** A scene's day value or its night one. */
export const byNight = <T,>(day: T, night: T): T => (SCENE.night ? night : day)

function sync() {
  ACCENT.set(token('--accent', '#2f6b3f'))
  ACCENT_SOFT.set(token('--accent-soft', '#6d9779'))
  SCENE.night = isNight()
  SCENE.version++
}

if (typeof window !== 'undefined') {
  sync()
  onPalette(sync)
}
