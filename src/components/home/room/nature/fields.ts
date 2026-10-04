import * as THREE from 'three'
import { ROOM_CONFIG } from '../config'
import type { RoomPlan } from '../scene/compositions'
import { clamp, fbm, noise, random, smooth } from '../lib/random'

/* ============================================================
   SURFACE FIELDS
   The prototype's `mossAt` gave every point of every plane a
   BIRTH — the growth value at which moss arrives there — from a
   few seeded colonies, the distance to damp edges and two
   octaves of noise. That idea is kept whole; it is evaluated in
   metres on the hall's own surfaces instead of on screen planes,
   and baked into small textures the surface shader reads:

   WALL   (x across the back wall, y up)  birth, variation, fine
   FLOOR  (x across, z out from the wall)  birth, variation, fine

   Moss then appears wherever growth G has passed a texel's
   birth, with a short ragged front, so it spreads outward from
   its colonies — and recedes along exactly the same front when G
   falls. The prototype's `buildWeather` (hairline cracks that run
   out of the seams, damp streaks under the cornice and above the
   skirting) is baked the same way, each pixel carrying the growth
   value at which its stretch of crack or stain appears.

   Nothing here depends on the viewport: a resize never moves a
   colony, and a given seed always grows the same moss.
   ============================================================ */

export interface SurfaceFields {
  wall: THREE.DataTexture
  floor: THREE.DataTexture
  weather: THREE.DataTexture
  /** x0, y0, width, height of the wall map, metres. */
  wallRect: THREE.Vector4
  /** x0, z0, width, depth of the floor map, metres. */
  floorRect: THREE.Vector4
}

const enc = (birth: number) => Math.round(clamp(birth / 2) * 255)

export async function buildSurfaceFields(
  plan: RoomPlan, soffit: number, floorDepth: number, seed: number,
  /** Called between the stages, to give the main thread back. */
  pause: () => Promise<void> = async () => {},
): Promise<SurfaceFields> {
  // Give the thread back every few milliseconds, row by row, so no
  // single slice of this runs long enough to delay an input.
  let slice = performance.now()
  const breathe = async () => {
    if (performance.now() - slice < 6) return
    await pause()
    slice = performance.now()
  }
  const W = plan.width
  const cfg = ROOM_CONFIG.moss
  const r = random(seed ^ 0x2d1f)

  /* ---- wall ------------------------------------------------ */
  // ~2.5 cm a texel on the wall, ~2.8 cm on the floor: the fields
  // are smooth; the moss's fine structure is the shader's.
  const wx = 512
  const wy = Math.round((wx * soffit) / W)
  const wall = new Uint8Array(wx * wy * 4)
  // Vertical re-entrant corners: both sides of every pilaster and
  // the two corners of the hall. Damp gathers in them first.
  const corners: number[] = [-W / 2, W / 2]
  for (const p of plan.pilasters) {
    const c = p.u - W / 2
    corners.push(c - p.width / 2 - 0.08, c + p.width / 2 + 0.08)
  }
  // A few seeded colonies low on the wall (the prototype's floor
  // seeds, stood up): where a leak or a crack keeps the base wet.
  const colonies: Array<[number, number, number]> = []
  for (let i = 0; i < 7; i++) colonies.push([(r() - 0.5) * W, r() * 0.5, 0.12 + r() * 0.3])
  for (let j = 0; j < wy; j++) {
    await breathe()
    const y = ((j + 0.5) / wy) * soffit
    for (let i = 0; i < wx; i++) {
      const x = ((i + 0.5) / wx - 0.5) * W
      const n = fbm(x * 1.6 + 41, y * 1.9 + 8)
      const fine = noise(x * 7.1 + 33, y * 9.4 + 27)
      let cd = Infinity
      for (const c of corners) cd = Math.min(cd, Math.abs(x - c))
      const corner = Math.exp(-cd / 0.45)
      // Rising damp: early at the foot, never far up a dry wall,
      // highest in the corners where two surfaces hold the water.
      let birth = 0.24 + (y / 0.42) * (1.0 - 0.45 * corner) + (n - 0.48) * 0.45 + (fine - 0.5) * 0.09
      for (const [cx, cy, b] of colonies) {
        const d = Math.hypot((x - cx) * 0.9, (y - cy) * 1.6)
        birth = Math.min(birth, b + d * 2.2 + (n - 0.5) * 0.3)
      }
      // A second, later band in the cornice's lee, where water from
      // the roof finds its way down the frieze: patchy, never a stripe.
      if (y > soffit - 0.6) {
        const lee = y < soffit ? 0.72 + ((soffit - y) / 0.25) * 0.9 : 0.8 + (y - soffit) * 1.2
        birth = Math.min(birth, lee + (1 - n) * 0.9 + (fine - 0.5) * 0.25 + (1 - corner) * 0.4)
      }
      birth /= cfg.coverage
      const k = (j * wx + i) * 4
      wall[k] = enc(birth)
      wall[k + 1] = Math.round(n * 255)
      wall[k + 2] = Math.round(fine * 255)
      wall[k + 3] = 255
    }
  }

  /* ---- floor ----------------------------------------------- */
  const fx = 512
  const fz = Math.round((fx * floorDepth) / W)
  const floor = new Uint8Array(fx * fz * 4)
  // Colonies where water stands: the hall's corners, the foot of
  // every pilaster, a few along the skirting, and out in the
  // foreground where the floor has settled and holds puddles.
  const seeds: Array<[number, number, number]> = [
    [-W / 2, 0, 0.1],
    [W / 2, 0, 0.14],
  ]
  for (const p of plan.pilasters) {
    const c = p.u - W / 2
    seeds.push([c - p.width / 2 - 0.1, 0.1, 0.12 + r() * 0.06], [c + p.width / 2 + 0.1, 0.1, 0.14 + r() * 0.06])
  }
  for (let i = 0; i < 3; i++) seeds.push([(r() - 0.5) * W * 0.8, 0.05, 0.3 + r() * 0.2])
  for (let i = 0; i < 6; i++) seeds.push([(r() - 0.5) * W * 0.9, 1.4 + r() * 3.2, 0.22 + r() * 0.3])
  for (let j = 0; j < fz; j++) {
    await breathe()
    const z = ((j + 0.5) / fz) * floorDepth
    for (let i = 0; i < fx; i++) {
      const x = ((i + 0.5) / fx - 0.5) * W
      const n = fbm(x * 1.3 + 17, z * 1.3 + 5)
      const fine = noise(x * 6.3 + 3, z * 6.3 + 9)
      let birth = 10
      for (const [sx, sz, b] of seeds) birth = Math.min(birth, b + Math.hypot((x - sx) * 0.6, (z - sz) * 0.75) * 0.5)
      // Along the wall's foot, everywhere a little earlier.
      birth = Math.min(birth, 0.45 + z * 0.7 + Math.abs(x) / W * 0.3)
      birth += (n - 0.43) * 0.42 + (fine - 0.5) * 0.085
      // The prototype's drier strip down the middle of the room:
      // the way people would have walked.
      birth += Math.exp(-Math.pow(x / (W * 0.12), 2)) * smooth(z / 1.5) * 0.35
      birth /= cfg.coverage
      const k = (j * fx + i) * 4
      floor[k] = enc(birth)
      floor[k + 1] = Math.round(n * 255)
      floor[k + 2] = Math.round(fine * 255)
      floor[k + 3] = 255
    }
  }

  await breathe()

  /* ---- weathering (wall) ----------------------------------- */
  // Three times the moss field's resolution (~8 mm a texel): a crack
  // is a hairline, and at the field's 2.5 cm it would be a groove.
  const vx = wx * 3
  const vy = wy * 3
  const weather = new Uint8Array(vx * vy * 4)
  // R crack mask · G crack birth (inverted, so max = earliest)
  // B damp-streak strength · A streak birth (inverted)
  for (let k = 0; k < weather.length; k += 4) weather[k + 1] = 0
  const toPx = (x: number, y: number) => [((x / W + 0.5) * vx), (y / soffit) * vy] as const
  const stamp = (px: number, py: number, rad: number, mask: number, birth: number) => {
    const x0 = Math.max(0, Math.floor(px - rad - 1))
    const x1 = Math.min(vx - 1, Math.ceil(px + rad + 1))
    const y0 = Math.max(0, Math.floor(py - rad - 1))
    const y1 = Math.min(vy - 1, Math.ceil(py + rad + 1))
    const inv = Math.round(clamp(1 - birth / 2) * 255)
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const k = (y * vx + x) * 4
        // The birth reaches a texel past the line itself, so filtering
        // never pairs the line with "never" and breaks it into dashes.
        weather[k + 1] = Math.max(weather[k + 1], inv)
        const d = Math.hypot(x + 0.5 - px, y + 0.5 - py)
        const a = clamp(rad + 0.5 - d) * mask
        if (a > 0) weather[k] = Math.max(weather[k], Math.round(a * 255))
      }
    }
  }
  const cracks = ROOM_CONFIG.weather.cracks
  const crack = (x: number, y: number, angle: number, len: number, start: number, depth: number) => {
    const steps = 14
    const pts: Array<[number, number]> = [[x, y]]
    let cx = x
    let cy = y
    for (let s = 1; s <= steps; s++) {
      const a = angle + (r() - 0.5) * 1.22
      cx += (Math.cos(a) * len) / steps
      cy += (Math.sin(a) * len) / steps
      pts.push([cx, cy])
    }
    const dur = 0.2 + r() * 0.25
    for (let s = 0; s < steps; s++) {
      const [ax, ay] = toPx(pts[s][0], pts[s][1])
      const [bx, by] = toPx(pts[s + 1][0], pts[s + 1][1])
      const segLen = Math.hypot(bx - ax, by - ay)
      const n = Math.max(1, Math.ceil(segLen * 1.5))
      for (let q = 0; q <= n; q++) {
        const t = (s + q / n) / steps
        stamp(ax + ((bx - ax) * q) / n, ay + ((by - ay) * q) / n, depth ? 0.35 : 0.55, depth ? 0.6 : 0.9, start + dur * t)
      }
    }
    if (!depth) for (const t of [4, 9]) crack(pts[t][0], pts[t][1], angle + (r() > 0.5 ? 0.7 : -0.7), len * (0.2 + r() * 0.22), start + 0.1, 1)
  }
  // From the skirting upward, and down out of the architrave.
  for (let i = 0; i < cracks; i++) {
    const fromTop = i % 3 === 0
    const x = (r() - 0.5) * W * 0.96
    if (fromTop) crack(x, soffit - 0.02, -Math.PI / 2 + (r() - 0.5) * 1.1, 0.25 + r() * 0.7, 0.14 + r() * 0.5, 0)
    else crack(x, 0.27, Math.PI / 2 + (r() - 0.5) * 0.9, 0.15 + r() * 0.85, 0.08 + r() * 0.55, 0)
  }
  // Damp streaks: the prototype's drips — faint, vertical, growing
  // downward from under the cornice and up from the floor.
  for (let i = 0; i < ROOM_CONFIG.weather.drips; i++) {
    const fromTop = i < ROOM_CONFIG.weather.drips * 0.45
    const x = (r() - 0.5) * W * 0.98
    const len = (0.25 + r() * 1.2) * (fromTop ? 1 : 0.5)
    const width = 0.04 + r() * 0.22
    const start = 0.08 + r() * 0.42
    const strength = 0.25 + r() * 0.55
    const y0 = fromTop ? soffit : 0.27
    const dir = fromTop ? -1 : 1
    const [px] = toPx(x, 0)
    const half = (width / W) * vx * 0.5
    const n = Math.ceil((len / soffit) * vy)
    for (let q = 0; q <= n; q++) {
      const t = q / n
      const yy = y0 + dir * t * len
      const [, py] = toPx(0, yy)
      const row = Math.round(py)
      if (row < 0 || row >= vy) continue
      const fade = (1 - t) * (1 - t * 0.3)
      const birth = start + 0.55 * t
      const inv = Math.round(clamp(1 - birth / 2) * 255)
      // Water does not run in a ruled band: the streak wanders a
      // little in width along its length.
      const w = half * 1.6 * (0.65 + 0.7 * noise(i * 3.7 + 11, t * 5))
      // The birth is written a couple of texels wider than the stain
      // itself, so filtering never pairs the stain with a far-off
      // birth at its edges (which would cut its sides square).
      for (let xx = Math.max(0, Math.floor(px - w - 4)); xx <= Math.min(vx - 1, Math.ceil(px + w + 4)); xx++) {
        const k = (row * vx + xx) * 4
        if (inv > weather[k + 3]) weather[k + 3] = inv
        const across = 1 - Math.pow(Math.abs(xx + 0.5 - px) / w, 2)
        if (across <= 0) continue
        const v = Math.round(across * across * fade * strength * 255)
        if (v > weather[k + 2]) weather[k + 2] = v
      }
    }
  }

  const tex = (data: Uint8Array, w: number, h: number) => {
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType)
    t.magFilter = THREE.LinearFilter
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.generateMipmaps = true
    t.wrapS = THREE.ClampToEdgeWrapping
    t.wrapT = THREE.ClampToEdgeWrapping
    t.colorSpace = THREE.NoColorSpace
    t.anisotropy = 8
    t.needsUpdate = true
    return t
  }
  return {
    wall: tex(wall, wx, wy),
    floor: tex(floor, fx, fz),
    weather: tex(weather, vx, vy),
    wallRect: new THREE.Vector4(-W / 2, 0, W, soffit),
    floorRect: new THREE.Vector4(-W / 2, 0, W, floorDepth),
  }
}
