import * as THREE from 'three'
import { ROOM_CONFIG } from '../config'

/* ============================================================
   NIGHT
   The site has a dark theme (`<html data-theme="dark">`, written
   before the first paint by site/theme-script.ts and toggled by
   site/theme.ts). In it the copy is cream, and a white hall in
   sunlight behind cream type is no ground at all: the room goes to
   night instead — the same room, the same composition, the same
   plants, so toggling never moves a column.

   Nothing is lit again for it. The light cache already holds the
   key's share of every pixel's light apart from the rest (its alpha:
   the plants split it the same way), and the moon comes in by the
   window the sun did, so night is a re-weighting of what is there:

     E_night = moon · key share + dusk · (E − day key · key share)

   then the frame is brought down after tone mapping (`level`), in
   display-linear light, where it keeps the day's proportions — the
   contact shades, the soffits, the pilasters' shadows — at the
   value of the page's dark ground. Brought down before tone mapping
   it would sink into the curve's toe and lose them.

   `night` is 0..1, so a toggle is a short cross-fade of three
   uniforms over the cached room (a redraw a frame for `fade`
   seconds), and costs no relight.
   ============================================================ */

/** Whether the page is in its dark theme now. */
export function isNight(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark'
}

/** Calls `fn` whenever the theme on <html> changes, whoever writes it. Returns the unsubscribe. */
export function onNight(fn: (night: boolean) => void): () => void {
  if (typeof MutationObserver === 'undefined') return () => {}
  let last = isNight()
  const mo = new MutationObserver(() => {
    const now = isNight()
    if (now === last) return
    last = now
    fn(now)
  })
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => mo.disconnect()
}

const N = ROOM_CONFIG.night
const L = ROOM_CONFIG.light
const DAY_KEY = new THREE.Vector3(...L.key.color).multiplyScalar(L.key.intensity)
const ONE = new THREE.Vector3(1, 1, 1)

/** The night's uniforms, shared by the hall, its plants and the canopy. */
export interface NightUniforms {
  uNight: { value: number }
  /** The moon: what the cache's key share is worth at night. */
  uMoon: { value: THREE.Vector3 }
  /** The rest of the light's worth at night, per channel. */
  uDusk: { value: THREE.Vector3 }
  /** The plants' lift and their cuticles' sheen at night (1 by day). */
  uPlantLift: { value: number }
  uSheen: { value: number }
}

export function nightUniforms(): NightUniforms {
  return {
    uNight: { value: 0 },
    uMoon: { value: new THREE.Vector3(...N.moon) },
    uDusk: { value: new THREE.Vector3(...N.dusk) },
    uPlantLift: { value: 1 },
    uSheen: { value: 1 },
  }
}

/**
 * Writes `n` (0 day … 1 night) into the uniforms, and the frame's level
 * into `level`. The level is interpolated geometrically: the eye judges
 * light by ratios, and a straight line from 1 to 0.03 would spend most
 * of a cross-fade looking like the day and then drop.
 */
export function applyNight(u: NightUniforms, n: number, level?: THREE.Vector3, levels: readonly number[] = N.level) {
  u.uNight.value = n
  u.uPlantLift.value = 1 + (N.plants - 1) * n
  u.uSheen.value = 1 + (N.sheen - 1) * n
  level?.set(Math.pow(levels[0], n), Math.pow(levels[1], n), Math.pow(levels[2], n))
}

/** The canopy's own light (it reads no cache): the day's key and sky, or the night's. */
export function canopyLight(n: number, key: THREE.Vector3, ambient: THREE.Vector3) {
  const C = ROOM_CONFIG.canopy
  const dayKey = DAY_KEY.clone().multiplyScalar(C.key)
  const dayAmb = new THREE.Vector3(...L.sky.color).multiplyScalar(C.ambient)
  key.copy(dayKey).lerp(new THREE.Vector3(...N.moon).multiplyScalar(C.key), n)
  ambient.copy(dayAmb).multiply(ONE.clone().lerp(new THREE.Vector3(...N.dusk), n))
}

/** GLSL: the cached light at a pixel, by day or by night (see above). Needs uKeyColor and the night uniforms. */
export const nightLight = /* glsl */ `
  uniform float uNight;
  uniform vec3 uMoon;
  uniform vec3 uDusk;
  uniform float uPlantLift;
  uniform float uSheen;
  // The key's colour now: the sun's by day, the moon's by night.
  vec3 keyNow() { return mix(uKeyColor, uMoon, uNight); }
  // What the rest of the light is worth now, per channel.
  vec3 duskNow() { return mix(vec3(1.0), uDusk, uNight); }
  // A cache texel (rgb: all light, a: the key's share) as it is now.
  vec3 lightNow(vec4 E) {
    vec3 key = uKeyColor * E.a;
    return keyNow() * E.a + max(E.rgb - key, vec3(0.0)) * duskNow();
  }
`
