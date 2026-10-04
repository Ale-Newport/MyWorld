import * as THREE from 'three'
import { random } from '../lib/random'

/* ============================================================
   SURFACE DETAIL
   No photographs: the stone's grain, the plaster's trowelling
   and the limestone's fossil flecks come from small tileable
   noise fields generated once at start-up, sampled in world
   space at real-world scales (millimetres for grain, decimetres
   for mottling) so nothing is ever stretched across a wall.
   ============================================================ */

/** Periodic value noise on an integer lattice of `period`. */
function periodicNoise(seed: number, period: number) {
  const r = random(seed)
  const lattice = new Float32Array(period * period)
  for (let i = 0; i < lattice.length; i++) lattice[i] = r()
  const at = (x: number, y: number) => lattice[((y % period) + period) % period * period + (((x % period) + period) % period)]
  return (x: number, y: number) => {
    const ix = Math.floor(x)
    const iy = Math.floor(y)
    let fx = x - ix
    let fy = y - iy
    fx = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
    fy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
    const a = at(ix, iy)
    const b = at(ix + 1, iy)
    const c = at(ix, iy + 1)
    const d = at(ix + 1, iy + 1)
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
  }
}

/**
 * RGBA detail texture, tileable:
 *  R  broad fbm (mottling)        G  medium fbm (grain)
 *  B  fine fbm (pores)            A  sparse flecks
 */
export function createDetailTexture(size = 256, seed = 4242): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4)
  const octave = (base: number, octaves: number, s: number) => {
    const ns = Array.from({ length: octaves }, (_, i) => periodicNoise(s + i * 101, base << i))
    return (x: number, y: number) => {
      let v = 0
      let amp = 0.5
      let norm = 0
      for (let i = 0; i < octaves; i++) {
        const f = (base << i) / size
        v += ns[i](x * f, y * f) * amp
        norm += amp
        amp *= 0.5
      }
      return v / norm
    }
  }
  const broad = octave(4, 4, seed)
  const medium = octave(16, 3, seed + 11)
  const fine = octave(64, 2, seed + 23)
  const fleck = periodicNoise(seed + 37, 96)
  const rr = random(seed + 51)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      data[i] = Math.round(broad(x, y) * 255)
      data[i + 1] = Math.round(medium(x, y) * 255)
      data[i + 2] = Math.round(fine(x, y) * 255)
      const f = fleck((x * 96) / size, (y * 96) / size)
      data[i + 3] = f > 0.78 ? Math.round(Math.min(1, (f - 0.78) * 6 + rr() * 0.2) * 255) : 0
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.colorSpace = THREE.NoColorSpace
  tex.needsUpdate = true
  return tex
}
