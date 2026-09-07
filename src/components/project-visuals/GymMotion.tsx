'use client'

import { useEffect, useMemo, useRef } from 'react'

import { useCanvas2D, type CanvasContext } from '@/hooks/useCanvas2D'
import { clamp, damp, easeInOutCubic, easeOutCubic, lerp, range, seeded } from '@/lib/math'

import { readPalette, type ProjectVisualProps, type VisualPalette } from './types'
import styles from './visual.module.css'

/* ============================================================
   GYM APP — one rigged model, many pose records.

   The brief: a figure fades from skin to skeleton, the joints
   resolve into labelled points, the points become rows of pose
   data, equipment assembles, one exercise plays, and finally a
   ring of poses orbits the same body — all driven by the same
   rig. Nothing here is duplicated per exercise: every figure on
   screen is `solvePose()` run over one skeleton definition with
   a different 18-number record.
   ============================================================ */

const DEG = Math.PI / 180
const TAU = Math.PI * 2
const HALF_PI = Math.PI / 2

/* ---------- skeleton ---------- */

const J_PELVIS = 0
const J_SPINE = 1
const J_CHEST = 2
const J_NECK = 3
const J_HEAD = 4
const J_SHL = 5
const J_ELL = 6
const J_WRL = 7
const J_SHR = 8
const J_ELR = 9
const J_WRR = 10
const J_HIPL = 11
const J_KNL = 12
const J_ANL = 13
const J_TOL = 14
const J_HIPR = 15
const J_KNR = 16
const J_ANR = 17
const J_TOR = 18
const NJ = 19

const L_PEL_SPI = 0.14
const L_SPI_CHE = 0.17
const L_CHE_NEC = 0.09
const L_NEC_HEA = 0.13
const SH_X = 0.18
const SH_Y = 0.02
const HIP_X = 0.105
const HIP_Y = -0.02
const L_UPPER = 0.28
const L_FORE = 0.26
const L_THIGH = 0.42
const L_SHIN = 0.41
const L_FOOT = 0.16
const HEAD_R = 0.1
const GROUND_CLEAR = 0.03
const PIVOT_Y = 0.78
const FOCAL = 12

/** from → to → silhouette mass class */
const BONE_A = new Uint8Array([
  J_PELVIS, J_SPINE, J_CHEST, J_NECK,
  J_SHL, J_HIPL, J_CHEST, J_CHEST,
  J_SHL, J_ELL, J_SHR, J_ELR,
  J_PELVIS, J_PELVIS,
  J_HIPL, J_KNL, J_ANL,
  J_HIPR, J_KNR, J_ANR,
])
const BONE_B = new Uint8Array([
  J_SPINE, J_CHEST, J_NECK, J_HEAD,
  J_SHR, J_HIPR, J_SHL, J_SHR,
  J_ELL, J_WRL, J_ELR, J_WRR,
  J_HIPL, J_HIPR,
  J_KNL, J_ANL, J_TOL,
  J_KNR, J_ANR, J_TOR,
])
const BONE_M = new Uint8Array([
  4, 4, 2, 2,
  3, 3, 3, 3,
  2, 1, 2, 1,
  3, 3,
  3, 2, 1,
  3, 2, 1,
])
const NB = BONE_A.length
const MASS = [0.03, 0.048, 0.062, 0.072, 0.098]

/** hierarchy depth per joint — drives the rig's propagating reveal */
const J_DEPTH = new Uint8Array([0, 1, 2, 3, 4, 3, 4, 5, 3, 4, 5, 1, 2, 3, 4, 1, 2, 3, 4])

/* ---------- pose records ---------- */

const R_ROOT = 0
const R_LIFT = 1
const R_SPINE = 2
const R_NECK = 3
const R_SHL = 4
const R_SHR = 5
const R_ABL = 6
const R_ABR = 7
const R_ELL = 8
const R_ELR = 9
const R_HIPL = 10
const R_HIPR = 11
const R_HABL = 12
const R_HABR = 13
const R_KNL = 14
const R_KNR = 15
const R_ANKL = 16
const R_ANKR = 17
const NP = 18

type Equip = 'none' | 'barbell' | 'dumbbell' | 'pullup' | 'bench'

interface PoseRecord {
  readonly name: string
  readonly equip: Equip
  /** degrees, except LIFT which is body-heights */
  readonly a: readonly number[]
}

/* every entry drives the SAME skeleton above — this table is the
   whole "exercise library": data, not assets. */
const POSES: readonly PoseRecord[] = [
  { name: 'REFERENCE', equip: 'none', a: [0, 0, 3, 0, 6, 6, 14, 14, 8, 8, 2, 2, 4, 4, 4, 4, 0, 0] },
  { name: 'SQUAT.TOP', equip: 'barbell', a: [0, 0, 6, -2, 26, 26, 24, 24, 140, 140, 8, 8, 7, 7, 10, 10, 0, 0] },
  { name: 'SQUAT.BTM', equip: 'barbell', a: [0, 0, 22, -8, 32, 32, 26, 26, 136, 136, 95, 95, 13, 13, 116, 116, -14, -14] },
  { name: 'DEADLIFT', equip: 'barbell', a: [0, 0, 62, -26, -4, -4, 7, 7, 4, 4, 58, 58, 7, 7, 72, 72, -10, -10] },
  { name: 'LOCKOUT', equip: 'barbell', a: [0, 0, -3, 0, -2, -2, 6, 6, 3, 3, 1, 1, 4, 4, 3, 3, 0, 0] },
  { name: 'BENT.ROW', equip: 'barbell', a: [0, 0, 68, -30, -26, -26, 10, 10, 100, 100, 24, 24, 5, 5, 32, 32, 0, 0] },
  { name: 'BENCH.PRESS', equip: 'bench', a: [-85, 0, 0, 12, 95, 95, 16, 16, 18, 18, -26, -26, 9, 9, 100, 100, -18, -18] },
  { name: 'OVERHEAD', equip: 'barbell', a: [0, 0, -5, -8, 172, 172, 13, 13, 8, 8, 2, 2, 4, 4, 4, 4, 0, 0] },
  { name: 'CURL', equip: 'dumbbell', a: [0, 0, 2, 0, 10, 10, 7, 7, 128, 128, 2, 2, 4, 4, 4, 4, 0, 0] },
  { name: 'LAT.RAISE', equip: 'dumbbell', a: [0, 0, 2, 0, 2, 2, 86, 86, 8, 8, 2, 2, 4, 4, 4, 4, 0, 0] },
  { name: 'PULL.UP', equip: 'pullup', a: [0, 0.52, -2, -10, 168, 168, 17, 17, 58, 58, -22, -22, 7, 7, 78, 78, 30, 30] },
  { name: 'LUNGE', equip: 'dumbbell', a: [0, 0, 6, 0, -2, -2, 8, 8, 5, 5, 90, -40, 5, 5, 90, 60, -8, 55] },
  { name: 'PLANK', equip: 'none', a: [71, 0, -4, -14, 71, 71, 9, 9, 6, 6, 2, 2, 5, 5, 3, 3, 4, 4] },
  { name: 'PUSH.UP', equip: 'none', a: [83, 0, -4, -12, 53, 53, 32, 32, 105, 105, 2, 2, 5, 5, 3, 3, -8, -8] },
  { name: 'ROMANIAN.DL', equip: 'barbell', a: [0, 0, 74, -30, -6, -6, 6, 6, 4, 4, 32, 32, 5, 5, 24, 24, -6, -6] },
  { name: 'CALF.RAISE', equip: 'none', a: [0, 0, 2, 0, 0, 0, 7, 7, 4, 4, 0, 0, 4, 4, 2, 2, 44, 44] },
  { name: 'KNEE.RAISE', equip: 'none', a: [0, 0, 4, 0, 18, 18, 12, 12, 34, 34, 96, 2, 6, 4, 104, 4, 0, 0] },
  { name: 'CARRY', equip: 'dumbbell', a: [0, 0, 1, 0, -2, -2, 11, 11, 4, 4, 2, 2, 4, 4, 3, 3, 0, 0] },
]
const ORBIT_FROM = 2
const ORBIT_ALL = POSES.length - ORBIT_FROM
const ORBIT_MAX = 16
const RING_R = 2.05

/* ---------- readout rows: param → joint → label ---------- */
const ROW_P = [R_ROOT, R_SPINE, R_SHL, R_ABL, R_ELL, R_HIPL, R_KNL, R_ANKL]
const ROW_J = [J_PELVIS, J_SPINE, J_SHL, J_SHL, J_ELL, J_HIPL, J_KNL, J_ANL]
const ROW_L = ['ROOT', 'SPINE', 'SHLDR.L', 'ABDCT.L', 'ELBOW.L', 'HIP.L', 'KNEE.L', 'ANKLE.L']
const NROWS = ROW_P.length

const PHASE_LABEL = ['01 SILHOUETTE', '02 RIG', '03 POSE DATA', '04 EXERCISE', '05 LIBRARY']
const EQUIP_LABEL: Record<Equip, string> = {
  none: 'BODYWEIGHT',
  barbell: 'BARBELL',
  dumbbell: 'DUMBBELL',
  pullup: 'PULL-UP BAR',
  bench: 'BENCH',
}

const NPART = 150
const TRAIL = 30

/* ============================================================
   forward kinematics
   ============================================================ */

function put(o: Float32Array, j: number, x: number, y: number, z: number): void {
  o[j * 3] = x
  o[j * 3 + 1] = y
  o[j * 3 + 2] = z
}

/** two-segment limb: root → mid → tip, absolute pitches, signed abduction */
function chain(
  o: Float32Array, root: number, mid: number, tip: number,
  p0: number, ab: number, p1: number, l0: number, l1: number,
): void {
  const rx = o[root * 3]
  const ry = o[root * 3 + 1]
  const rz = o[root * 3 + 2]
  const ca = Math.cos(ab)
  const sa = Math.sin(ab)
  const c0 = Math.cos(p0)
  const mx = rx + c0 * sa * l0
  const my = ry - c0 * ca * l0
  const mz = rz + Math.sin(p0) * l0
  put(o, mid, mx, my, mz)
  const c1 = Math.cos(p1)
  put(o, tip, mx + c1 * sa * l1, my - c1 * ca * l1, mz + Math.sin(p1) * l1)
}

/** the single re-used model: 18 numbers in, 19 joints out */
function solvePose(a: ArrayLike<number>, o: Float32Array): void {
  const sp = a[R_SPINE] * DEG
  const cs = Math.cos(sp)
  const ss = Math.sin(sp)

  put(o, J_PELVIS, 0, 0, 0)
  const la = sp * 0.45
  const sy = Math.cos(la) * L_PEL_SPI
  const sz = Math.sin(la) * L_PEL_SPI
  put(o, J_SPINE, 0, sy, sz)
  const chy = sy + cs * L_SPI_CHE
  const chz = sz + ss * L_SPI_CHE
  put(o, J_CHEST, 0, chy, chz)
  const na = sp * 0.85
  const ny = chy + Math.cos(na) * L_CHE_NEC
  const nz = chz + Math.sin(na) * L_CHE_NEC
  put(o, J_NECK, 0, ny, nz)
  const ha = na + a[R_NECK] * DEG
  put(o, J_HEAD, 0, ny + Math.cos(ha) * L_NEC_HEA, nz + Math.sin(ha) * L_NEC_HEA)

  const shy = chy + SH_Y * cs
  const shz = chz + SH_Y * ss
  put(o, J_SHL, SH_X, shy, shz)
  put(o, J_SHR, -SH_X, shy, shz)
  const shl = a[R_SHL] * DEG
  const shr = a[R_SHR] * DEG
  chain(o, J_SHL, J_ELL, J_WRL, shl, a[R_ABL] * DEG, shl + a[R_ELL] * DEG, L_UPPER, L_FORE)
  chain(o, J_SHR, J_ELR, J_WRR, shr, -a[R_ABR] * DEG, shr + a[R_ELR] * DEG, L_UPPER, L_FORE)

  put(o, J_HIPL, HIP_X, HIP_Y, 0)
  put(o, J_HIPR, -HIP_X, HIP_Y, 0)
  const hl = a[R_HIPL] * DEG
  const hr = a[R_HIPR] * DEG
  const abl = a[R_HABL] * DEG
  const abr = -a[R_HABR] * DEG
  chain(o, J_HIPL, J_KNL, J_ANL, hl, abl, hl - a[R_KNL] * DEG, L_THIGH, L_SHIN)
  chain(o, J_HIPR, J_KNR, J_ANR, hr, abr, hr - a[R_KNR] * DEG, L_THIGH, L_SHIN)

  const fl = (75 - a[R_ANKL]) * DEG
  const fr = (75 - a[R_ANKR]) * DEG
  const cfl = Math.cos(fl)
  const cfr = Math.cos(fr)
  put(o, J_TOL,
    o[J_ANL * 3] + cfl * Math.sin(abl * 0.5) * L_FOOT,
    o[J_ANL * 3 + 1] - cfl * Math.cos(abl * 0.5) * L_FOOT,
    o[J_ANL * 3 + 2] + Math.sin(fl) * L_FOOT)
  put(o, J_TOR,
    o[J_ANR * 3] + cfr * Math.sin(abr * 0.5) * L_FOOT,
    o[J_ANR * 3 + 1] - cfr * Math.cos(abr * 0.5) * L_FOOT,
    o[J_ANR * 3 + 2] + Math.sin(fr) * L_FOOT)

  const rp = a[R_ROOT] * DEG
  if (rp !== 0) {
    const cr = Math.cos(rp)
    const sr = Math.sin(rp)
    for (let i = 0; i < NJ; i++) {
      const y = o[i * 3 + 1]
      const z = o[i * 3 + 2]
      o[i * 3 + 1] = y * cr - z * sr
      o[i * 3 + 2] = y * sr + z * cr
    }
  }

  let minY = Infinity
  for (let i = 0; i < NJ; i++) if (o[i * 3 + 1] < minY) minY = o[i * 3 + 1]
  const dy = GROUND_CLEAR - minY + a[R_LIFT]
  for (let i = 0; i < NJ; i++) o[i * 3 + 1] += dy
}

function mixPose(out: Float32Array, a: ArrayLike<number>, b: ArrayLike<number>, t: number): void {
  for (let i = 0; i < NP; i++) out[i] = a[i] + (b[i] - a[i]) * t
}

/* ============================================================
   camera
   ============================================================ */

interface Cam {
  cosY: number
  sinY: number
  cosP: number
  sinP: number
  ox: number
  oy: number
  s: number
}

function projPoint(cam: Cam, x: number, y: number, z: number, out: Float32Array, o: number): void {
  const yy = y - PIVOT_Y
  const x1 = x * cam.cosY + z * cam.sinY
  const z1 = -x * cam.sinY + z * cam.cosY
  const y2 = yy * cam.cosP - z1 * cam.sinP
  const z2 = yy * cam.sinP + z1 * cam.cosP
  const k = FOCAL / (FOCAL + z2)
  out[o] = cam.ox + x1 * k * cam.s
  out[o + 1] = cam.oy - y2 * k * cam.s
  out[o + 2] = z2
}

function projAll(cam: Cam, j3: Float32Array, out: Float32Array): void {
  for (let i = 0; i < NJ; i++) projPoint(cam, j3[i * 3], j3[i * 3 + 1], j3[i * 3 + 2], out, i * 3)
}

/* ============================================================
   drawing primitives
   ============================================================ */

/** appends a capsule subpath, wound consistently so fills union */
function capsule(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, r: number): void {
  const a = Math.atan2(y1 - y0, x1 - x0)
  ctx.moveTo(x0 + Math.cos(a + HALF_PI) * r, y0 + Math.sin(a + HALF_PI) * r)
  ctx.arc(x0, y0, r, a + HALF_PI, a + HALF_PI + Math.PI, false)
  ctx.arc(x1, y1, r, a - HALF_PI, a + HALF_PI, false)
  ctx.closePath()
}

/** the "skin": one unioned fill so the dissolve reads as a single mass */
function drawSkin(ctx: CanvasRenderingContext2D, pr: Float32Array, s: number, color: string, alpha: number): void {
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.beginPath()
  for (let i = 0; i < NB; i++) {
    const a = BONE_A[i]
    const b = BONE_B[i]
    capsule(ctx, pr[a * 3], pr[a * 3 + 1], pr[b * 3], pr[b * 3 + 1], MASS[BONE_M[i]] * s)
  }
  const hx = pr[J_HEAD * 3]
  const hy = pr[J_HEAD * 3 + 1]
  ctx.moveTo(hx + HEAD_R * s, hy)
  ctx.arc(hx, hy, HEAD_R * s, 0, TAU, false)
  ctx.fill()
  ctx.globalAlpha = 1
}

/** flat single-path skeleton — used for the orbiting copies */
function drawRigFlat(ctx: CanvasRenderingContext2D, pr: Float32Array, color: string, alpha: number, lw: number, s: number): void {
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  ctx.lineWidth = lw
  ctx.beginPath()
  for (let i = 0; i < NB; i++) {
    const a = BONE_A[i] * 3
    const b = BONE_B[i] * 3
    const cut = BONE_B[i] === J_HEAD ? HEAD_R * s : 0
    const dx = pr[b] - pr[a]
    const dy = pr[b + 1] - pr[a + 1]
    const f = cut > 0 ? Math.max(0, 1 - cut / (Math.hypot(dx, dy) || 1)) : 1
    ctx.moveTo(pr[a], pr[a + 1])
    ctx.lineTo(pr[a] + dx * f, pr[a + 1] + dy * f)
  }
  const hx = pr[J_HEAD * 3]
  const hy = pr[J_HEAD * 3 + 1]
  ctx.moveTo(hx + HEAD_R * s, hy)
  ctx.arc(hx, hy, HEAD_R * s, 0, TAU, false)
  ctx.stroke()
  ctx.globalAlpha = 1
}

/** depth-shaded skeleton with a propagating reveal — the hero figure */
function drawRig(ctx: CanvasRenderingContext2D, pr: Float32Array, color: string, alpha: number, lw: number, s: number, reveal: number): void {
  ctx.strokeStyle = color
  ctx.lineWidth = lw
  ctx.lineCap = 'round'
  for (let i = 0; i < NB; i++) {
    const a = BONE_A[i] * 3
    const b = BONE_B[i] * 3
    const rv = clamp((reveal - (J_DEPTH[BONE_B[i]] / 5) * 0.6) / 0.4)
    if (rv <= 0.001) continue
    const depth = (pr[a + 2] + pr[b + 2]) * 0.5
    const shade = clamp(0.95 - depth * 0.3, 0.35, 1)
    const cut = BONE_B[i] === J_HEAD ? HEAD_R * s : 0
    const dx = pr[b] - pr[a]
    const dy = pr[b + 1] - pr[a + 1]
    const f = (cut > 0 ? Math.max(0, 1 - cut / (Math.hypot(dx, dy) || 1)) : 1) * rv
    ctx.globalAlpha = alpha * shade * rv
    ctx.beginPath()
    ctx.moveTo(pr[a], pr[a + 1])
    ctx.lineTo(pr[a] + dx * f, pr[a + 1] + dy * f)
    ctx.stroke()
  }
  const hr = clamp((reveal - 0.56) / 0.3)
  if (hr > 0.001) {
    ctx.globalAlpha = alpha * 0.5 * hr
    ctx.beginPath()
    ctx.arc(pr[J_HEAD * 3], pr[J_HEAD * 3 + 1], HEAD_R * s * hr, 0, TAU, false)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.lineCap = 'butt'
}

function drawJoints(ctx: CanvasRenderingContext2D, pr: Float32Array, pal: VisualPalette, reveal: number, alpha: number): void {
  for (let j = 0; j < NJ; j++) {
    if (j === J_HEAD) continue
    const rv = clamp((reveal - (J_DEPTH[j] / 5) * 0.6) / 0.4)
    if (rv <= 0.001) continue
    const e = easeOutCubic(rv)
    const x = pr[j * 3]
    const y = pr[j * 3 + 1]
    const keyed = j === ROW_J[0] || j === ROW_J[1] || j === ROW_J[2] || j === ROW_J[3]
      || j === ROW_J[4] || j === ROW_J[5] || j === ROW_J[6] || j === ROW_J[7]
    // settling ring
    if (rv < 0.999) {
      ctx.globalAlpha = alpha * (1 - rv) * 0.6
      ctx.strokeStyle = j === J_PELVIS ? pal.accent : pal.inkFaint
      ctx.lineWidth = 0.75
      ctx.beginPath()
      ctx.arc(x, y, 2 + 11 * (1 - e), 0, TAU, false)
      ctx.stroke()
    }
    ctx.globalAlpha = alpha * e
    if (keyed) {
      ctx.strokeStyle = j === J_PELVIS ? pal.accent : pal.ink
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.rect(x - 2.6, y - 2.6, 5.2, 5.2)
      ctx.stroke()
    } else {
      ctx.fillStyle = pal.inkSoft
      ctx.beginPath()
      ctx.arc(x, y, 1.5, 0, TAU, false)
      ctx.fill()
    }
  }
  ctx.globalAlpha = 1
}

/** a plate seen edge-on: an ellipse that flattens as the camera faces it */
function plate(ctx: CanvasRenderingContext2D, cam: Cam, x: number, y: number, z: number, r: number, p3: Float32Array): void {
  projPoint(cam, x, y, z, p3, 0)
  const k = FOCAL / (FOCAL + p3[2])
  const ry = r * k * cam.s
  const rx = Math.max(0.7, ry * Math.abs(cam.sinY))
  ctx.beginPath()
  ctx.ellipse(p3[0], p3[1], rx, ry, 0, 0, TAU)
  ctx.stroke()
}

function seg(ctx: CanvasRenderingContext2D, cam: Cam, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, p3: Float32Array, q3: Float32Array): void {
  projPoint(cam, x0, y0, z0, p3, 0)
  projPoint(cam, x1, y1, z1, q3, 0)
  ctx.beginPath()
  ctx.moveTo(p3[0], p3[1])
  ctx.lineTo(q3[0], q3[1])
  ctx.stroke()
}

/** equipment definitions, composed onto the model at runtime */
function drawEquip(
  ctx: CanvasRenderingContext2D, cam: Cam, j3: Float32Array, kind: Equip,
  color: string, alpha: number, lw: number, detail: boolean, asm: number,
  p3: Float32Array, q3: Float32Array,
): void {
  if (kind === 'none' || alpha <= 0.01) return
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  ctx.lineWidth = lw
  const _wx = (j3[J_WRL * 3] + j3[J_WRR * 3]) * 0.5
  const wy = (j3[J_WRL * 3 + 1] + j3[J_WRR * 3 + 1]) * 0.5
  const wz = (j3[J_WRL * 3 + 2] + j3[J_WRR * 3 + 2]) * 0.5

  if (kind === 'barbell' || kind === 'pullup') {
    const y = kind === 'pullup' ? wy + 0.05 : wy
    const half = (kind === 'pullup' ? 0.58 : 0.72) * asm
    seg(ctx, cam, -half, y, wz, half, y, wz, p3, q3)
    if (!detail) { ctx.globalAlpha = 1; return }
    if (kind === 'pullup') {
      seg(ctx, cam, -half, y, wz, -half, y + 0.18, wz, p3, q3)
      seg(ctx, cam, half, y, wz, half, y + 0.18, wz, p3, q3)
    } else {
      plate(ctx, cam, 0.5 * asm, y, wz, 0.15 * asm, p3)
      plate(ctx, cam, -0.5 * asm, y, wz, 0.15 * asm, p3)
      plate(ctx, cam, 0.58 * asm, y, wz, 0.11 * asm, p3)
      plate(ctx, cam, -0.58 * asm, y, wz, 0.11 * asm, p3)
    }
  } else if (kind === 'dumbbell') {
    for (let h = 0; h < 2; h++) {
      const j = h === 0 ? J_WRL : J_WRR
      const x = j3[j * 3]
      const y = j3[j * 3 + 1]
      const z = j3[j * 3 + 2]
      seg(ctx, cam, x - 0.11 * asm, y, z, x + 0.11 * asm, y, z, p3, q3)
      if (detail) {
        plate(ctx, cam, x - 0.11 * asm, y, z, 0.075 * asm, p3)
        plate(ctx, cam, x + 0.11 * asm, y, z, 0.075 * asm, p3)
      }
    }
  } else if (kind === 'bench') {
    const py = j3[J_PELVIS * 3 + 1] - 0.1
    const pz = j3[J_PELVIS * 3 + 2]
    seg(ctx, cam, -0.16, py, pz - 0.5, -0.16, py, pz + 0.32, p3, q3)
    seg(ctx, cam, 0.16, py, pz - 0.5, 0.16, py, pz + 0.32, p3, q3)
    seg(ctx, cam, -0.16, py, pz - 0.5, 0.16, py, pz - 0.5, p3, q3)
    seg(ctx, cam, -0.16, py, pz + 0.32, 0.16, py, pz + 0.32, p3, q3)
    seg(ctx, cam, -0.78 * asm, wy, wz, 0.78 * asm, wy, wz, p3, q3)
    if (detail) {
      seg(ctx, cam, 0, py, pz - 0.42, 0, 0, pz - 0.42, p3, q3)
      seg(ctx, cam, 0, py, pz + 0.24, 0, 0, pz + 0.24, p3, q3)
      plate(ctx, cam, 0.52 * asm, wy, wz, 0.15 * asm, p3)
      plate(ctx, cam, -0.52 * asm, wy, wz, 0.15 * asm, p3)
    }
  }
  ctx.globalAlpha = 1
}

function tinyText(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, alpha: number, align: CanvasTextAlign): void {
  if (alpha <= 0.01) return
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.font = `${size}px ui-monospace, monospace`
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  ctx.fillText(s, x, y)
  ctx.globalAlpha = 1
}

function fmtDeg(v: number): string {
  const n = Math.round(Math.abs(v))
  return `${v < -0.5 ? '−' : '+'}${n < 100 ? (n < 10 ? '00' : '0') : ''}${n}°`
}

/* ============================================================
   per-instance state — every buffer allocated once
   ============================================================ */

interface Scene {
  cam: Cam
  pal: VisualPalette
  palTick: number
  j3: Float32Array
  pr: Float32Array
  s3: Float32Array
  mp: Float32Array
  sp: Float32Array
  cur: Float32Array
  tgt: Float32Array
  p3: Float32Array
  q3: Float32Array
  trail: Float32Array
  nodes: Float32Array
  order: Int32Array
  prevRows: Float32Array
  parts: Float32Array
  yaw: number
  pitch: number
  equipCur: Equip
  equipFade: number
  warm: boolean
  lastPhase: string
  lastChip: string
  lastCursor: string
}

interface Ui {
  px: number
  py: number
  inside: boolean
  dragging: boolean
  lastX: number
  lastY: number
  moved: number
  yawOff: number
  pitchOff: number
  hover: number
  pinned: number
}

function makeScene(): Scene {
  const parts = new Float32Array(NPART * 6)
  const rnd = seeded(0x6d17)
  for (let i = 0; i < NPART; i++) {
    const o = i * 6
    parts[o] = Math.floor(rnd() * NB)
    parts[o + 1] = rnd()
    parts[o + 2] = rnd() * 2 - 1
    parts[o + 3] = rnd() * TAU
    parts[o + 4] = rnd() * 0.5
    parts[o + 5] = 0.35 + rnd() * 0.9
  }
  return {
    cam: { cosY: 1, sinY: 0, cosP: 1, sinP: 0, ox: 0, oy: 0, s: 1 },
    pal: readPalette(null),
    palTick: 0,
    j3: new Float32Array(NJ * 3),
    pr: new Float32Array(NJ * 3),
    s3: new Float32Array(NJ * 3),
    mp: new Float32Array(NJ * 3),
    sp: new Float32Array(NP),
    cur: new Float32Array(NP),
    tgt: new Float32Array(NP),
    p3: new Float32Array(3),
    q3: new Float32Array(3),
    trail: new Float32Array(TRAIL * 2),
    nodes: new Float32Array(ORBIT_MAX * 4),
    order: new Int32Array(ORBIT_MAX),
    prevRows: new Float32Array(NROWS),
    parts,
    yaw: 0.5,
    pitch: -0.16,
    equipCur: 'none',
    equipFade: 0,
    warm: false,
    lastPhase: '',
    lastChip: '',
    lastCursor: '',
  }
}

/* ============================================================
   the frame
   ============================================================ */

const LOOP = 22

function render(
  c: CanvasContext, sc: Scene, ui: Ui,
  progress: number | undefined, reduced: boolean,
  phaseEl: HTMLElement | null, chipEl: HTMLElement | null,
): void {
  const { ctx, w, h, t, dt } = c
  if (sc.palTick % 20 === 0) sc.pal = readPalette(ctx.canvas)
  sc.palTick++
  const pal = sc.pal

  const tl = reduced
    ? 1
    : typeof progress === 'number'
      ? clamp(progress)
      : clamp(((t % LOOP) / LOOP) / 0.9)

  /* ---- layout: the camera dollies back as the library appears ---- */
  const compact = w < 640
  const dolly = easeInOutCubic(range(tl, 0.72, 0.92))
  // the near arc of the ring lands well below the figure — keep it inside the frame
  const sLib = Math.min(h * 0.42, w * 0.19, Math.max(24, (h * 0.57 - 18) / 1.4))
  const s = lerp(Math.min(h * 0.46, w * 0.3), sLib, dolly)
  const ox = compact ? w * 0.5 : lerp(w * 0.4, w * 0.44, dolly)
  const oy = lerp(h * 0.55, h * 0.43, dolly)

  const yawT = 0.42 - tl * 0.18 + ui.yawOff
  const pitchT = clamp(lerp(-0.07, -0.2, dolly) + ui.pitchOff, -0.5, 0.16)
  sc.yaw = sc.warm ? damp(sc.yaw, yawT, 9, dt) : yawT
  sc.pitch = sc.warm ? damp(sc.pitch, pitchT, 9, dt) : pitchT

  const cam = sc.cam
  cam.cosY = Math.cos(sc.yaw)
  cam.sinY = Math.sin(sc.yaw)
  cam.cosP = Math.cos(sc.pitch)
  cam.sinP = Math.sin(sc.pitch)
  cam.ox = ox
  cam.oy = oy
  cam.s = s

  /* ---- the orbiting pose library ---- */
  const orbitP = range(tl, 0.78, 1)
  const nodeN = compact ? 8 : ORBIT_MAX
  const stride = ORBIT_ALL / nodeN
  const miniK = compact ? 0.2 : 0.155
  const spin = orbitP * TAU * 0.32
  let front = 0
  let frontZ = Infinity
  if (orbitP > 0) {
    for (let i = 0; i < nodeN; i++) {
      const ang = (i / nodeN) * TAU + spin
      projPoint(cam, Math.cos(ang) * RING_R, 0, Math.sin(ang) * RING_R, sc.nodes, i * 4)
      const z2 = sc.nodes[i * 4 + 2]
      sc.nodes[i * 4 + 3] = FOCAL / (FOCAL + z2)
      if (z2 < frontZ) { frontZ = z2; front = i }
      sc.order[i] = i
    }
    for (let i = 1; i < nodeN; i++) {
      const v = sc.order[i]
      let j = i - 1
      while (j >= 0 && sc.nodes[sc.order[j] * 4 + 2] < sc.nodes[v * 4 + 2]) { sc.order[j + 1] = sc.order[j]; j-- }
      sc.order[j + 1] = v
    }
  }

  /* ---- pointer hit-test against the orbiting copies ---- */
  let hover = -1
  if (orbitP > 0.15 && ui.inside && !ui.dragging) {
    let best = Infinity
    for (let i = 0; i < nodeN; i++) {
      const ms = s * miniK * sc.nodes[i * 4 + 3]
      const hx = sc.nodes[i * 4]
      const hy = sc.nodes[i * 4 + 1] - 0.76 * ms
      const d = Math.hypot(ui.px - hx, ui.py - hy)
      if (d < ms * 0.95 && d < best) { best = d; hover = i }
    }
  }
  ui.hover = hover
  const picked = hover >= 0 ? hover : ui.pinned >= 0 && ui.pinned < nodeN ? ui.pinned : front
  const activeIdx = ORBIT_FROM + Math.min(POSES.length - ORBIT_FROM - 1, Math.round(picked * stride))
  const active = POSES[activeIdx]

  /* ---- target pose: rest → rack → rep → library record ---- */
  const rack = easeInOutCubic(range(tl, 0.54, 0.66))
  const repU = 0.5 - 0.5 * Math.cos(range(tl, 0.62, 0.8) * TAU * 2)
  mixPose(sc.tgt, POSES[0].a, POSES[1].a, rack)
  mixPose(sc.tgt, sc.tgt, POSES[2].a, repU)
  const ob = easeInOutCubic(range(tl, 0.78, 0.88))
  if (ob > 0) mixPose(sc.tgt, sc.tgt, active.a, ob)

  if (sc.warm && !reduced) {
    for (let i = 0; i < NP; i++) sc.cur[i] = damp(sc.cur[i], sc.tgt[i], 20, dt)
  } else {
    sc.cur.set(sc.tgt)
  }

  const equipT: Equip = ob > 0.55 ? active.equip : tl > 0.55 ? 'barbell' : 'none'
  if (equipT === sc.equipCur) {
    sc.equipFade = sc.warm && !reduced ? damp(sc.equipFade, 1, 12, dt) : 1
  } else {
    sc.equipFade = sc.warm && !reduced ? damp(sc.equipFade, 0, 16, dt) : 0
    if (sc.equipFade < 0.05) { sc.equipCur = equipT; sc.equipFade = 0 }
  }
  sc.warm = true

  solvePose(sc.cur, sc.j3)
  projAll(cam, sc.j3, sc.pr)

  /* ============ draw ============ */
  ctx.clearRect(0, 0, w, h)
  ctx.lineJoin = 'round'

  drawFloor(ctx, cam, sc, pal, orbitP)

  if (orbitP > 0) drawOrbit(ctx, cam, sc, pal, nodeN, stride, miniK, orbitP, picked, true)

  drawHero(ctx, cam, sc, pal, tl, s)

  if (orbitP > 0) {
    drawOrbit(ctx, cam, sc, pal, nodeN, stride, miniK, orbitP, picked, false)
    drawLink(ctx, sc, pal, picked, miniK, s, orbitP, stride)
  }

  if (!compact) drawRows(ctx, sc, pal, tl, w, oy, orbitP)

  /* ---- HUD ---- */
  const pi = tl < 0.2 ? 0 : tl < 0.36 ? 1 : tl < 0.56 ? 2 : tl < 0.78 ? 3 : 4
  if (phaseEl && sc.lastPhase !== PHASE_LABEL[pi]) {
    phaseEl.textContent = PHASE_LABEL[pi]
    sc.lastPhase = PHASE_LABEL[pi]
  }
  const nm = tl < 0.5 ? `${POSES[0].name} · RIG` : `${orbitP > 0.2 ? active.name : POSES[2].name} · ${EQUIP_LABEL[sc.equipCur]}`
  if (chipEl && sc.lastChip !== nm) {
    chipEl.textContent = nm
    sc.lastChip = nm
  }
  if (chipEl) chipEl.dataset.on = hover >= 0 || ui.pinned >= 0 ? 'true' : 'false'

  const cur = !ui.inside ? '' : ui.dragging ? 'grabbing' : hover >= 0 ? 'pointer' : 'grab'
  if (cur !== sc.lastCursor) {
    ctx.canvas.style.cursor = cur
    sc.lastCursor = cur
  }
}

/* ---------- floor ---------- */
function drawFloor(ctx: CanvasRenderingContext2D, cam: Cam, sc: Scene, pal: VisualPalette, orbitP: number): void {
  ctx.strokeStyle = pal.inkFaint
  ctx.lineWidth = 0.75
  const r = lerp(0.62, RING_R, easeInOutCubic(orbitP))
  ctx.globalAlpha = lerp(0.3, 0.2, orbitP)
  ctx.beginPath()
  for (let i = 0; i <= 56; i++) {
    const a = (i / 56) * TAU
    projPoint(cam, Math.cos(a) * r, 0, Math.sin(a) * r, sc.p3, 0)
    if (i === 0) ctx.moveTo(sc.p3[0], sc.p3[1])
    else ctx.lineTo(sc.p3[0], sc.p3[1])
  }
  ctx.stroke()
  ctx.globalAlpha = 1
}

/* ---------- the one model ---------- */
function drawHero(ctx: CanvasRenderingContext2D, cam: Cam, sc: Scene, pal: VisualPalette, tl: number, s: number): void {
  const pr = sc.pr
  const skin = 1 - easeInOutCubic(range(tl, 0.03, 0.22))
  if (skin > 0.01) drawSkin(ctx, pr, s, pal.inkSoft, 0.8 * skin)

  const reveal = range(tl, 0.1, 0.36)
  drawRig(ctx, pr, pal.ink, 0.92, 1.25, s, reveal)
  drawJoints(ctx, pr, pal, range(tl, 0.22, 0.46), 1)

  /* equipment definitions composed onto the model */
  const asm = easeOutCubic(range(tl, 0.54, 0.66))
  const eqA = sc.equipFade * (sc.equipCur === 'none' ? 0 : 1)
  if (eqA > 0.01) {
    drawEquip(ctx, cam, sc.j3, sc.equipCur, pal.signal, 0.85 * eqA, 1.1, true, Math.max(asm, 0.15), sc.p3, sc.q3)
  }

  /* the rep as a trajectory: the bar path is interpolated pose data */
  const trailA = range(tl, 0.58, 0.68) * (1 - range(tl, 0.74, 0.8))
  if (trailA > 0.01) {
    for (let k = 0; k < TRAIL; k++) {
      mixPose(sc.sp, POSES[1].a, POSES[2].a, k / (TRAIL - 1))
      solvePose(sc.sp, sc.s3)
      projPoint(cam,
        (sc.s3[J_WRL * 3] + sc.s3[J_WRR * 3]) * 0.5,
        (sc.s3[J_WRL * 3 + 1] + sc.s3[J_WRR * 3 + 1]) * 0.5,
        (sc.s3[J_WRL * 3 + 2] + sc.s3[J_WRR * 3 + 2]) * 0.5,
        sc.p3, 0)
      sc.trail[k * 2] = sc.p3[0]
      sc.trail[k * 2 + 1] = sc.p3[1]
    }
    ctx.globalAlpha = 0.5 * trailA
    ctx.strokeStyle = pal.signal
    ctx.lineWidth = 0.75
    ctx.beginPath()
    ctx.moveTo(sc.trail[0], sc.trail[1])
    for (let k = 1; k < TRAIL; k++) ctx.lineTo(sc.trail[k * 2], sc.trail[k * 2 + 1])
    ctx.stroke()
    projPoint(cam,
      (sc.j3[J_WRL * 3] + sc.j3[J_WRR * 3]) * 0.5,
      (sc.j3[J_WRL * 3 + 1] + sc.j3[J_WRR * 3 + 1]) * 0.5,
      (sc.j3[J_WRL * 3 + 2] + sc.j3[J_WRR * 3 + 2]) * 0.5,
      sc.p3, 0)
    ctx.globalAlpha = 0.95 * trailA
    ctx.fillStyle = pal.accent
    ctx.beginPath()
    ctx.arc(sc.p3[0], sc.p3[1], 2.6, 0, TAU, false)
    ctx.fill()
    ctx.globalAlpha = 1
  }

  /* the skin dissolving off the rig */
  const dis = range(tl, 0.02, 0.26)
  if (dis > 0.001 && dis < 0.999) {
    ctx.fillStyle = pal.inkSoft
    const drift = s * 0.34
    for (let i = 0; i < NPART; i++) {
      const o = i * 6
      const lt = range(dis, sc.parts[o + 4], sc.parts[o + 4] + 0.55)
      if (lt <= 0 || lt >= 1) continue
      const b = sc.parts[o] | 0
      const a3 = BONE_A[b] * 3
      const b3 = BONE_B[b] * 3
      const f = sc.parts[o + 1]
      const bx = pr[a3] + (pr[b3] - pr[a3]) * f
      const by = pr[a3 + 1] + (pr[b3 + 1] - pr[a3 + 1]) * f
      const dx = pr[b3] - pr[a3]
      const dy = pr[b3 + 1] - pr[a3 + 1]
      const dl = Math.hypot(dx, dy) || 1
      const r = MASS[BONE_M[b]] * s * sc.parts[o + 2]
      const ang = sc.parts[o + 3]
      const e = easeOutCubic(lt)
      const px = bx - (dy / dl) * r + Math.cos(ang) * drift * e * sc.parts[o + 5]
      const py = by + (dx / dl) * r + (Math.sin(ang) * 0.6 - 0.5) * drift * e * sc.parts[o + 5]
      ctx.globalAlpha = 4 * lt * (1 - lt) * 0.5
      ctx.fillRect(px, py, 1.4, 1.4)
    }
    ctx.globalAlpha = 1
  }
}

/* ---------- the library: the same rig, N records ---------- */
function drawOrbit(
  ctx: CanvasRenderingContext2D, cam: Cam, sc: Scene, pal: VisualPalette,
  nodeN: number, stride: number, miniK: number, orbitP: number, picked: number, farHalf: boolean,
): void {
  const ox = cam.ox
  const oy = cam.oy
  const s = cam.s
  projPoint(cam, 0, 0, 0, sc.q3, 0)
  const hx = sc.q3[0]
  const hy = sc.q3[1]
  for (let k = 0; k < nodeN; k++) {
    const i = sc.order[k]
    const z2 = sc.nodes[i * 4 + 2]
    if (z2 >= 0 !== farHalf) continue
    const nt = easeOutCubic(range(orbitP, (i / nodeN) * 0.38, (i / nodeN) * 0.38 + 0.45))
    if (nt <= 0.002) continue
    const kk = sc.nodes[i * 4 + 3]
    const ms = s * miniK * kk * nt
    const ax = hx + (sc.nodes[i * 4] - hx) * nt
    const ay = hy + (sc.nodes[i * 4 + 1] - hy) * nt
    const idx = ORBIT_FROM + Math.min(POSES.length - ORBIT_FROM - 1, Math.round(i * stride))
    const pose = POSES[idx]
    solvePose(pose.a, sc.s3)
    cam.ox = ax
    cam.oy = ay - PIVOT_Y * ms
    cam.s = ms
    projAll(cam, sc.s3, sc.mp)
    const depthA = clamp((kk - 0.7) / 0.6)
    const on = i === picked
    const alpha = on ? 0.95 * nt : (0.26 + 0.46 * depthA) * nt
    drawRigFlat(ctx, sc.mp, on ? pal.accent : pal.inkFaint, alpha, on ? 1.05 : 0.9, ms)
    if (pose.equip !== 'none') {
      drawEquip(ctx, cam, sc.s3, pose.equip, on ? pal.accent : pal.inkFaint, alpha * 0.85, 0.9, false, 0.5, sc.p3, sc.q3)
    }
  }
  cam.ox = ox
  cam.oy = oy
  cam.s = s
}

/* ---------- the record currently driving the body ---------- */
function drawLink(
  ctx: CanvasRenderingContext2D, sc: Scene, pal: VisualPalette,
  picked: number, miniK: number, s: number, orbitP: number, stride: number,
): void {
  const a = easeOutCubic(range(orbitP, 0.35, 0.7))
  if (a <= 0.01) return
  const ms = s * miniK * sc.nodes[picked * 4 + 3]
  const x0 = sc.nodes[picked * 4]
  const y0 = sc.nodes[picked * 4 + 1] - 0.76 * ms
  const x1 = sc.pr[J_PELVIS * 3]
  const y1 = sc.pr[J_PELVIS * 3 + 1]
  const dx = x1 - x0
  const dy = y1 - y0
  const d = Math.hypot(dx, dy) || 1
  const g0 = Math.min(ms * 0.9, d * 0.4)
  const g1 = Math.min(14, d * 0.3)
  ctx.globalAlpha = 0.4 * a
  ctx.strokeStyle = pal.accent
  ctx.lineWidth = 0.75
  ctx.beginPath()
  ctx.moveTo(x0 + (dx / d) * g0, y0 + (dy / d) * g0)
  ctx.lineTo(x1 - (dx / d) * g1, y1 - (dy / d) * g1)
  ctx.stroke()
  ctx.globalAlpha = 1
  const idx = ORBIT_FROM + Math.min(POSES.length - ORBIT_FROM - 1, Math.round(picked * stride))
  tinyText(ctx, POSES[idx].name, x0, sc.nodes[picked * 4 + 1] + 11, 9, pal.accent, 0.8 * a, 'center')
}

/* ---------- joints → labelled points → rows of pose data ---------- */
function drawRows(
  ctx: CanvasRenderingContext2D, sc: Scene, pal: VisualPalette,
  tl: number, w: number, oy: number, orbitP: number,
): void {
  const colX = w - 22 - 150
  const rowH = 15
  const top = oy - ((NROWS - 1) / 2) * rowH
  const colA = lerp(1, 0.55, easeInOutCubic(orbitP))
  const lead = 1 - range(tl, 0.6, 0.72)

  let hot = -1
  let hotD = 0.22
  for (let i = 0; i < NROWS; i++) {
    const v = sc.cur[ROW_P[i]]
    const d = Math.abs(v - sc.prevRows[i])
    if (d > hotD) { hotD = d; hot = i }
    sc.prevRows[i] = v
  }

  for (let i = 0; i < NROWS; i++) {
    const rr = clamp(range(tl, 0.34 + i * 0.02, 0.5 + i * 0.02))
    if (rr <= 0.001) continue
    const j = ROW_J[i] * 3
    const rowY = top + i * rowH
    const fly = easeInOutCubic(rr)
    const lx = lerp(sc.pr[j] + 9, colX, fly)
    const ly = lerp(sc.pr[j + 1] - 8, rowY, fly)
    const va = range(rr, 0.72, 1) * colA
    const on = i === hot

    if (va > 0.02 && lead > 0.01) {
      ctx.globalAlpha = 0.16 * va * lead
      ctx.strokeStyle = pal.inkFaint
      ctx.lineWidth = 0.75
      ctx.beginPath()
      ctx.moveTo(sc.pr[j], sc.pr[j + 1])
      ctx.lineTo(colX - 30, rowY)
      ctx.lineTo(colX - 8, rowY)
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    tinyText(ctx, ROW_L[i], lx, ly, 9, on ? pal.accent : pal.inkSoft, Math.min(1, rr * 4) * colA, 'left')
    if (va > 0.02) {
      const v = sc.cur[ROW_P[i]]
      tinyText(ctx, fmtDeg(v), colX + 96, rowY, 9, on ? pal.accent : pal.inkFaint, va, 'right')
      ctx.globalAlpha = 0.28 * va
      ctx.strokeStyle = pal.inkFaint
      ctx.lineWidth = 0.75
      ctx.beginPath()
      ctx.moveTo(colX + 104, rowY)
      ctx.lineTo(colX + 146, rowY)
      ctx.stroke()
      const nx = colX + 104 + clamp((v + 40) / 220) * 42
      ctx.globalAlpha = va
      ctx.strokeStyle = on ? pal.accent : pal.ink
      ctx.lineWidth = 1.25
      ctx.beginPath()
      ctx.moveTo(nx, rowY - 3)
      ctx.lineTo(nx, rowY + 3)
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }
}

/* ============================================================
   component
   ============================================================ */

export function GymMotion({ progress, reducedMotion = false, interactive = true, className }: ProjectVisualProps) {
  const sc = useMemo(() => makeScene(), [])
  const ui = useRef<Ui>({
    px: 0, py: 0, inside: false, dragging: false,
    lastX: 0, lastY: 0, moved: 0, yawOff: 0, pitchOff: 0, hover: -1, pinned: -1,
  })
  const phaseRef = useRef<HTMLSpanElement>(null)
  const chipRef = useRef<HTMLSpanElement>(null)

  const ref = useCanvas2D<HTMLCanvasElement>({
    draw: (c) => render(c, sc, ui.current, progress, reducedMotion, phaseRef.current, chipRef.current),
    setup: () => { sc.palTick = 0 },
  })

  useEffect(() => {
    if (reducedMotion || interactive === false) return
    const el = ref.current
    if (!el) return
    const st = ui.current

    const local = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      st.px = e.clientX - r.left
      st.py = e.clientY - r.top
    }
    const onEnter = (e: PointerEvent) => { st.inside = true; local(e) }
    const onMove = (e: PointerEvent) => {
      st.inside = true
      local(e)
      if (!st.dragging) return
      const dx = e.clientX - st.lastX
      const dy = e.clientY - st.lastY
      st.lastX = e.clientX
      st.lastY = e.clientY
      st.moved += Math.abs(dx) + Math.abs(dy)
      st.yawOff = clamp(st.yawOff - dx * 0.006, -1.5, 1.5)
      st.pitchOff = clamp(st.pitchOff + dy * 0.002, -0.3, 0.3)
    }
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      st.dragging = true
      st.moved = 0
      st.lastX = e.clientX
      st.lastY = e.clientY
      local(e)
      el.setPointerCapture(e.pointerId)
    }
    const onUp = (e: PointerEvent) => {
      if (st.dragging && st.moved < 5) st.pinned = st.pinned >= 0 ? -1 : st.hover
      st.dragging = false
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    }
    const onLeave = () => { st.inside = false; st.dragging = false }

    el.addEventListener('pointerenter', onEnter)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('pointerleave', onLeave)
    return () => {
      el.removeEventListener('pointerenter', onEnter)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('pointerleave', onLeave)
    }
  }, [ref, sc, interactive, reducedMotion])

  return (
    <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
      <canvas ref={ref} className={styles.canvas} />
      <div className={styles.readout} aria-hidden="true">
        <span ref={phaseRef}>01 SILHOUETTE</span>
        <br />
        1 RIG × N POSES
      </div>
      <div className={styles.hud} aria-hidden="true">
        <span className={styles.chip} ref={chipRef}>REFERENCE · RIG</span>
      </div>
    </div>
  )
}
