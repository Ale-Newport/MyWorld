import * as THREE from 'three'
import { GeometryBuilder, MAT } from './builder'
import { Profile, sweep, planPath, type SweepSegment } from './profiles'
import type { RoomPlan, WallId, PilasterPlan, NichePlan, PanelPlan } from './compositions'
import { random } from '../lib/random'

/* ============================================================
   ARCHITECTURE
   A restrained white hall in the Greco-Roman manner, built as
   real geometry so that light has something to do:

   · a full entablature — two-fascia architrave, plain frieze and
     a cornice with bed mould, corona and cyma crown — running
     round all three walls, mitred at every corner;
   · fluted pilasters on Attic bases and Tuscan capitals, their
     flutes cut as real grooves with rounded arrises;
   · a moulded skirting and a recessed, bolection-framed panel in
     each bay;
   · blind arched niches, cut into the wall and closed at the
     back by a half cylinder and a semi-dome;
   · limestone slabs laid as separate stones, each with its own
     bevel, a few tenths of a millimetre of lippage and a joint.

   Units are metres. The back wall is the plane z = 0, the room
   opens towards +z, the floor is y = 0.
   ============================================================ */

export interface WallFrame {
  id: WallId
  origin: THREE.Vector3
  /** Along the wall, left to right as seen from inside. */
  ax: THREE.Vector3
  /** Into the room. */
  normal: THREE.Vector3
  length: number
}

export function wallFrames(plan: RoomPlan): Record<WallId, WallFrame> {
  const W = plan.width
  const D = plan.depth
  return {
    left: { id: 'left', origin: new THREE.Vector3(-W / 2, 0, D), ax: new THREE.Vector3(0, 0, -1), normal: new THREE.Vector3(1, 0, 0), length: D },
    back: { id: 'back', origin: new THREE.Vector3(-W / 2, 0, 0), ax: new THREE.Vector3(1, 0, 0), normal: new THREE.Vector3(0, 0, 1), length: W },
    right: { id: 'right', origin: new THREE.Vector3(W / 2, 0, 0), ax: new THREE.Vector3(0, 0, 1), normal: new THREE.Vector3(-1, 0, 0), length: D },
  }
}

/** Point on a wall: u along it, v up, d proud of it. */
export function wallPoint(f: WallFrame, u: number, v: number, d = 0, out = new THREE.Vector3()) {
  return out.copy(f.origin).addScaledVector(f.ax, u).addScaledVector(f.normal, d).setY(v)
}

/* ---- profiles --------------------------------------------- */

/** Entablature, 0.625 m: architrave, frieze, cornice. The architrave
    is a single plain fascia, deliberately: it is the band the HUD's
    row reads off, so it carries no step and no shadow line. */
export function entablatureProfile() {
  const p = new Profile(0, 0)
  // Architrave soffit, then one tall fascia.
  p.line(0.14, 0).ease(0.005).line(0, 0.19).ease(0.004)
  p.cymaReversa(0.02, 0.03)
  p.line(0, 0.012).ease(0.003)
  // Back to the frieze.
  p.line(-0.042, 0)
  // Frieze: a plain band.
  p.line(0, 0.15)
  // Bed mould: fillet and ovolo.
  p.line(0.012, 0).line(0, 0.01).ovolo(0.034)
  p.line(0, 0.008)
  // Corona: the deep soffit that throws the cornice's shadow, a
  // drip lip, and a vertical face.
  p.line(0.17, 0).ease(0.004).line(0, -0.012).line(0.012, 0).ease(0.003).line(0, 0.105).ease(0.005)
  // Fillet and cyma recta crown.
  p.line(0.012, 0).line(0, 0.012).cymaRecta(0.075, 0.09)
  p.line(0, 0.014).ease(0.004)
  const top = p.cursor.h
  p.to(0, top)
  return p
}

/** Wall skirting, 0.24 m: a plain plinth band whose top is eased
    and weathered back to the wall, so it catches the light along its
    arris instead of drawing a dark crease across the room. */
export function skirtingProfile() {
  const p = new Profile(0, 0)
  p.line(0.034, 0).line(0, 0.215).ease(0.01)
  p.line(-0.014, 0.012).ease(0.006)
  p.line(-0.02, 0.013).ease(0.004)
  return p
}

/** Attic base round a pilaster, from its shaft face, 0.33 m. */
export function baseProfile() {
  const p = new Profile(0, 0)
  // Plinth block.
  p.line(0.078, 0).line(0, 0.15).ease(0.007)
  p.line(-0.03, 0).ease(0.003)
  // Lower torus, fillet, scotia, fillet, upper torus.
  p.torus(0.031, 12)
  p.line(-0.012, 0).line(0, 0.008)
  p.scotia(0.017, 0.013, 10)
  p.line(0, 0.007).line(-0.002, 0)
  p.torus(0.02, 10)
  p.line(-0.016, 0).line(0, 0.008)
  // Apophyge into the shaft.
  const { d, h } = p.cursor
  p.arc(d - 0.0, h + 0.02, d, 0.02, -Math.PI / 2, -Math.PI, 6)
  return p
}

/** Tuscan capital from the shaft face, 0.245 m. */
export function capitalProfile() {
  const p = new Profile(0, 0)
  // Apophyge out of the shaft, astragal, fillet.
  p.arc(0.012, 0, 0.012, 0.016, Math.PI, Math.PI / 2, 5)
  p.torus(0.011, 8)
  p.line(-0.006, 0).line(0, 0.008).line(-0.006, 0)
  // Necking.
  p.line(0, 0.085)
  // Fillet, echinus, abacus.
  p.line(0.01, 0).line(0, 0.008).ovolo(0.046, 9)
  p.line(0.008, 0).line(0, 0.058).ease(0.005)
  p.to(0, p.cursor.h)
  return p
}

/** Bolection frame round a recessed panel, 0.085 m wide. */
export function panelFrameProfile(recess: number) {
  const p = new Profile(0, 0)
  p.ovolo(0.016, 6)
  p.line(0, 0.012).ease(0.004)
  p.line(0.003, 0)
  p.cymaReversa(-0.018, 0.034)
  // Down into the field.
  p.to(-recess, p.cursor.h + 0.012)
  return p
}

/** Moulded surround of a niche, 0.11 m wide. */
export function surroundProfile() {
  const p = new Profile(0, 0)
  p.line(0.024, 0).ease(0.004)
  p.line(0, 0.05).ease(0.004)
  p.line(0.006, 0).ease(0.002)
  p.ovolo(0.012, 5)
  p.line(0, 0.02).ease(0.003)
  p.line(-0.042, 0.03)
  return p
}

/* ---- the hall ---------------------------------------------- */

export interface BuiltArchitecture {
  geometry: THREE.BufferGeometry
  frames: Record<WallId, WallFrame>
  /** Heights the rest of the system plans against. */
  levels: {
    skirting: number
    soffit: number
    shaftBottom: number
    shaftTop: number
    baseHeight: number
    capitalHeight: number
  }
  profiles: {
    entablature: Profile
    skirting: Profile
    base: Profile
    capital: Profile
  }
}

export function buildArchitecture(plan: RoomPlan, seed: number): BuiltArchitecture {
  const rng = random(seed ^ 0x51a8)
  const B = new GeometryBuilder()
  const frames = wallFrames(plan)
  const W = plan.width
  const D = plan.depth
  const H = plan.height

  const ent = entablatureProfile()
  const entH = ent.bounds().h1
  const soffit = H - entH
  const skirt = skirtingProfile()
  const skirtH = skirt.bounds().h1
  const base = baseProfile()
  const cap = capitalProfile()
  const baseH = base.bounds().h1
  const capH = cap.bounds().h1
  const shaftBottom = baseH
  const shaftTop = soffit - capH

  /* Walls -------------------------------------------------- */
  for (const id of ['left', 'back', 'right'] as WallId[]) {
    const f = frames[id]
    const holes: THREE.Vector2[][] = []
    for (const panel of plan.panels.filter((p) => p.wall === id)) holes.push(rect(panel.u0, panel.v0, panel.u1, panel.v1))
    for (const niche of plan.niches.filter((n) => n.wall === id)) holes.push(nicheOutline(niche, 24))
    B.material = MAT.plaster
    B.random = rng()
    const contour = rect(0, 0, f.length, soffit + 0.01)
    B.polygon(contour, holes, f.origin, f.ax, new THREE.Vector3(0, 1, 0), f.normal)
  }

  /* Recessed panels ----------------------------------------- */
  for (const panel of plan.panels) buildPanel(B, frames[panel.wall], panel, rng)

  /* Niches -------------------------------------------------- */
  for (const niche of plan.niches) buildNiche(B, frames[niche.wall], niche, rng)

  /* Entablature, round all three walls ----------------------- */
  B.material = MAT.stone
  B.random = rng()
  const run = planPath(
    [[-W / 2, D], [-W / 2, 0], [W / 2, 0], [W / 2, D]],
    soffit,
    [[1, 0], [0, 1], [-1, 0]],
  )
  sweep(B, ent, run, { capStart: true, capEnd: true })

  /* Skirting, broken by every pilaster plinth ------------------- */
  B.random = rng()
  for (const id of ['left', 'back', 'right'] as WallId[]) {
    const f = frames[id]
    const stops = plan.pilasters
      .filter((p) => p.wall === id)
      .map((p) => [p.u - p.width / 2 - 0.075, p.u + p.width / 2 + 0.075] as const)
      .sort((a, b) => a[0] - b[0])
    let from = 0
    const spans: Array<[number, number]> = []
    for (const [a, b] of stops) {
      if (a > from) spans.push([from, a])
      from = b
    }
    if (from < f.length) spans.push([from, f.length])
    for (const [a, b] of spans) {
      const seg: SweepSegment = {
        a: wallPoint(f, a, 0),
        b: wallPoint(f, b, 0),
        dAxis: f.normal.clone(),
        hAxis: new THREE.Vector3(0, 1, 0),
      }
      sweep(B, skirt, [seg], { capStart: a > 0, capEnd: b < f.length })
    }
  }
  // The skirting turns the two back corners as one mitred run.
  B.random = rng()

  /* Pilasters ------------------------------------------------- */
  for (const pil of plan.pilasters) buildPilaster(B, frames[pil.wall], pil, { base, cap, shaftBottom, shaftTop }, rng)

  /* Floor ------------------------------------------------------ */
  buildFloor(B, plan, rng)

  /* Ceiling ---------------------------------------------------- */
  B.material = MAT.ceiling
  B.random = rng()
  B.face(
    new THREE.Vector3(-W / 2, H, 0),
    new THREE.Vector3(W / 2, H, 0),
    new THREE.Vector3(W / 2, H, D),
    new THREE.Vector3(-W / 2, H, D),
    new THREE.Vector3(0, -1, 0),
  )

  return {
    geometry: B.toGeometry(),
    frames,
    levels: { skirting: skirtH, soffit, shaftBottom, shaftTop, baseHeight: baseH, capitalHeight: capH },
    profiles: { entablature: ent, skirting: skirt, base, capital: cap },
  }
}

function rect(u0: number, v0: number, u1: number, v1: number) {
  return [new THREE.Vector2(u0, v0), new THREE.Vector2(u1, v0), new THREE.Vector2(u1, v1), new THREE.Vector2(u0, v1)]
}

/** Opening of an arched niche in wall coordinates (counter-clockwise). */
export function nicheOutline(n: NichePlan, steps: number) {
  const r = n.width / 2
  const pts = [new THREE.Vector2(n.u - r, n.sill), new THREE.Vector2(n.u + r, n.sill)]
  for (let i = 0; i <= steps; i++) {
    const a = (Math.PI * i) / steps
    pts.push(new THREE.Vector2(n.u + Math.cos(a) * r, n.spring + Math.sin(a) * r))
  }
  return pts
}

/* ---- pieces -------------------------------------------------- */

function buildPanel(B: GeometryBuilder, f: WallFrame, panel: PanelPlan, rng: () => number) {
  const up = new THREE.Vector3(0, 1, 0)
  const frame = panelFrameProfile(panel.recess)
  const fw = frame.bounds().h1
  // The frame runs round the opening; its h axis points inwards.
  const corners = [
    wallPoint(f, panel.u0, panel.v0),
    wallPoint(f, panel.u1, panel.v0),
    wallPoint(f, panel.u1, panel.v1),
    wallPoint(f, panel.u0, panel.v1),
  ]
  const inward = [up.clone(), f.ax.clone().negate(), up.clone().negate(), f.ax.clone()]
  const segs: SweepSegment[] = corners.map((a, i) => ({
    a,
    b: corners[(i + 1) % 4],
    dAxis: f.normal.clone(),
    hAxis: inward[i],
  }))
  B.material = MAT.stone
  B.random = rng()
  sweep(B, frame, segs, { closed: true })
  // The sunk field.
  B.material = MAT.plaster
  B.random = rng()
  const o = wallPoint(f, 0, 0, -panel.recess)
  B.polygon(rect(panel.u0 + fw, panel.v0 + fw, panel.u1 - fw, panel.v1 - fw), [], o, f.ax, up, f.normal)
}

function buildNiche(B: GeometryBuilder, f: WallFrame, n: NichePlan, rng: () => number) {
  const up = new THREE.Vector3(0, 1, 0)
  const r = n.width / 2
  const steps = 28
  const rings = 14
  B.material = MAT.niche
  B.random = rng()
  // Plan: half ellipse, half-width r, depth n.depth, opening onto
  // the wall plane. Normals point back into the room's side.
  const planPt = (a: number) => ({ u: n.u + Math.cos(a) * r, d: -Math.sin(a) * n.depth })
  const planN = (a: number) => {
    // Inward normal of the ellipse (towards the opening's axis).
    const nx = -Math.cos(a) / r
    const nz = Math.sin(a) / n.depth
    const l = Math.hypot(nx, nz)
    return { u: nx / l, d: nz / l }
  }
  const P = (u: number, v: number, d: number) => wallPoint(f, u, v, d)
  const N = (nu: number, nv: number, nd: number) =>
    new THREE.Vector3().addScaledVector(f.ax, nu).addScaledVector(f.normal, nd).setY(nv).normalize()
  // Cylinder.
  for (let i = 0; i < steps; i++) {
    const a0 = (Math.PI * i) / steps
    const a1 = (Math.PI * (i + 1)) / steps
    const p0 = planPt(a0)
    const p1 = planPt(a1)
    const n0 = planN(a0)
    const n1 = planN(a1)
    B.quad(
      P(p0.u, n.sill, p0.d), P(p1.u, n.sill, p1.d), P(p1.u, n.spring, p1.d), P(p0.u, n.spring, p0.d),
      N(n0.u, 0, n0.d), N(n1.u, 0, n1.d), N(n1.u, 0, n1.d), N(n0.u, 0, n0.d),
    )
  }
  // Semi-dome.
  for (let j = 0; j < rings; j++) {
    const b0 = ((Math.PI / 2) * j) / rings
    const b1 = ((Math.PI / 2) * (j + 1)) / rings
    for (let i = 0; i < steps; i++) {
      const a0 = (Math.PI * i) / steps
      const a1 = (Math.PI * (i + 1)) / steps
      const pt = (a: number, b: number) =>
        P(n.u + Math.cos(a) * Math.cos(b) * r, n.spring + Math.sin(b) * r, -Math.sin(a) * Math.cos(b) * n.depth)
      const nn = (a: number, b: number) => {
        const nx = -(Math.cos(a) * Math.cos(b)) / r
        const ny = -Math.sin(b) / r
        const nz = (Math.sin(a) * Math.cos(b)) / n.depth
        return N(nx, ny, nz)
      }
      B.quad(pt(a0, b0), pt(a1, b0), pt(a1, b1), pt(a0, b1), nn(a0, b0), nn(a1, b0), nn(a1, b1), nn(a0, b1))
    }
  }
  // Sill: the half-ellipse floor of the niche plus a slab that
  // projects a little into the room.
  const sill: THREE.Vector2[] = []
  for (let i = 0; i <= steps; i++) {
    const a = (Math.PI * i) / steps
    sill.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * n.depth))
  }
  B.material = MAT.stone
  B.random = rng()
  const sillO = P(n.u, n.sill, 0)
  B.polygon(sill, [], sillO, f.ax, f.normal.clone().negate(), up)
  // Projecting sill slab.
  const sp = new Profile(0, 0)
  sp.line(0.05, 0).ease(0.004).line(0, 0.045).ease(0.006).line(-0.05, 0)
  const sillSeg: SweepSegment = {
    a: P(n.u - r - 0.09, n.sill - 0.045, 0),
    b: P(n.u + r + 0.09, n.sill - 0.045, 0),
    dAxis: f.normal.clone(),
    hAxis: up.clone(),
  }
  sweep(B, sp, [sillSeg], { capStart: true, capEnd: true })
  // Moulded surround on the wall face: up one jamb, round the arch,
  // down the other.
  const path: THREE.Vector3[] = []
  const rr = r + 0.0
  path.push(P(n.u - rr, n.sill, 0))
  for (let i = 0; i <= 24; i++) {
    const a = Math.PI - (Math.PI * i) / 24
    path.push(P(n.u + Math.cos(a) * rr, n.spring + Math.sin(a) * rr, 0))
  }
  path.push(P(n.u + rr, n.sill, 0))
  const centre = P(n.u, n.spring, 0)
  const segs: SweepSegment[] = []
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]
    const b = path[i + 1]
    const mid = a.clone().add(b).multiplyScalar(0.5)
    // h runs away from the opening.
    let h: THREE.Vector3
    if (i === 0 || i === path.length - 2) h = new THREE.Vector3().subVectors(mid, P(n.u, mid.y, 0)).setY(0).normalize()
    else h = new THREE.Vector3().subVectors(mid, centre).normalize()
    segs.push({ a, b, dAxis: f.normal.clone(), hAxis: h })
  }
  sweep(B, surroundProfile(), segs, { capStart: true, capEnd: true })
}

function buildPilaster(
  B: GeometryBuilder, f: WallFrame, pil: PilasterPlan,
  parts: { base: Profile; cap: Profile; shaftBottom: number; shaftTop: number },
  rng: () => number,
) {
  const w = pil.width
  const p = pil.projection
  const u0 = pil.u - w / 2
  const u1 = pil.u + w / 2
  const up = new THREE.Vector3(0, 1, 0)
  B.material = MAT.stone
  B.random = rng()

  // Outline in plan for base and capital sweeps: wall → side →
  // front → side → wall. dAxis is each face's outward normal.
  const ring = (y: number): SweepSegment[] => {
    const a = wallPoint(f, u0, y, 0)
    const b = wallPoint(f, u0, y, p)
    const c = wallPoint(f, u1, y, p)
    const d = wallPoint(f, u1, y, 0)
    return [
      { a, b, dAxis: f.ax.clone().negate(), hAxis: up.clone() },
      { a: b, b: c, dAxis: f.normal.clone(), hAxis: up.clone() },
      { a: c, b: d, dAxis: f.ax.clone(), hAxis: up.clone() },
    ]
  }
  sweep(B, parts.base, ring(0))
  sweep(B, parts.cap, ring(parts.shaftTop))

  // Fluted shaft: section in plan, extruded.
  const sec: Array<{ u: number; d: number; nu: number; nd: number; sharp?: boolean }> = []
  const arris = 0.006
  // Left side face, from the wall out.
  sec.push({ u: u0, d: 0, nu: -1, nd: 0 })
  sec.push({ u: u0, d: p - arris, nu: -1, nd: 0 })
  // Rounded arris.
  for (let i = 1; i <= 3; i++) {
    const a = Math.PI - (Math.PI / 2) * (i / 3)
    sec.push({ u: u0 + arris + Math.cos(a) * arris, d: p - arris + Math.sin(a) * arris, nu: Math.cos(a), nd: Math.sin(a) })
  }
  // Front face with flutes.
  const N = pil.flutes
  const fillet = 0.011
  const inner = w - 2 * arris - 0.012
  const fw = (inner - (N + 1) * fillet) / N
  const depth = fw * 0.36
  let u = u0 + arris + 0.006
  sec.push({ u, d: p, nu: 0, nd: 1 })
  for (let k = 0; k < N; k++) {
    u += fillet
    sec.push({ u, d: p, nu: 0, nd: 1, sharp: true })
    // Elliptical groove, rounded where it meets the fillet.
    const steps = 9
    for (let i = 1; i < steps; i++) {
      const a = Math.PI - (Math.PI * i) / steps
      const cu = u + fw / 2
      const pu = cu + (Math.cos(a) * fw) / 2
      const pd = p - Math.sin(a) * depth
      // Normal of the ellipse (pointing out of the groove).
      const nu = (-Math.cos(a) * 2) / fw
      const nd = Math.sin(a) / depth
      const l = Math.hypot(nu, nd)
      sec.push({ u: pu, d: pd, nu: nu / l, nd: nd / l })
    }
    u += fw
    sec.push({ u, d: p, nu: 0, nd: 1, sharp: true })
  }
  u += fillet
  sec.push({ u: Math.max(u, u1 - arris), d: p, nu: 0, nd: 1 })
  for (let i = 0; i <= 3; i++) {
    const a = Math.PI / 2 - (Math.PI / 2) * (i / 3)
    sec.push({ u: u1 - arris + Math.cos(a) * arris, d: p - arris + Math.sin(a) * arris, nu: Math.cos(a), nd: Math.sin(a) })
  }
  sec.push({ u: u1, d: 0, nu: 1, nd: 0 })

  const y0 = parts.shaftBottom - 0.01
  const y1 = parts.shaftTop + 0.01
  const nv = (s: (typeof sec)[number]) => new THREE.Vector3().addScaledVector(f.ax, s.nu).addScaledVector(f.normal, s.nd).normalize()
  for (let i = 0; i < sec.length - 1; i++) {
    const a = sec[i]
    const b = sec[i + 1]
    if (Math.hypot(b.u - a.u, b.d - a.d) < 1e-6) continue
    // Sharp transitions use the face normal for both ends.
    let na = nv(a)
    let nb = nv(b)
    if (a.sharp || b.sharp) {
      const t = new THREE.Vector3().addScaledVector(f.ax, b.u - a.u).addScaledVector(f.normal, b.d - a.d)
      const fn = new THREE.Vector3().crossVectors(t, up).normalize()
      if (fn.dot(na.clone().add(nb)) < 0) fn.negate()
      if (a.sharp) na = fn
      if (b.sharp) nb = fn
    }
    const pa0 = wallPoint(f, a.u, y0, a.d)
    const pb0 = wallPoint(f, b.u, y0, b.d)
    const pb1 = wallPoint(f, b.u, y1, b.d)
    const pa1 = wallPoint(f, a.u, y1, a.d)
    const fn = new THREE.Vector3().subVectors(pb0, pa0).cross(new THREE.Vector3().subVectors(pa1, pa0))
    if (fn.dot(na.clone().add(nb)) >= 0) B.quad(pa0, pb0, pb1, pa1, na, nb, nb, na)
    else B.quad(pa0, pa1, pb1, pb0, na, na, nb, nb)
  }
}

function buildFloor(B: GeometryBuilder, plan: RoomPlan, rng: () => number) {
  const W = plan.width
  const D = plan.depth
  const s = plan.slab
  const joint = 0.0035
  const bevel = 0.0028
  const thick = 0.03
  // Square slabs on a straight grid, set out from the back wall's
  // centre line so the joints run to the vanishing point in pairs.
  const rows = Math.ceil(D / s) + 1
  const x0 = -Math.ceil(W / 2 / s) * s
  for (let j = 0; j < rows; j++) {
    const z0 = j * s
    for (let x = x0; x < W / 2; x += s) {
      const a = Math.max(-W / 2 - 0.05, x)
      const b = Math.min(W / 2 + 0.05, x + s)
      if (b - a < 0.05) continue
      B.material = MAT.floor
      B.random = rng()
      const lip = (rng() - 0.5) * 0.0012
      const tiltX = (rng() - 0.5) * 0.0009
      const tiltZ = (rng() - 0.5) * 0.0009
      slab(B, a + joint / 2, z0 + joint / 2, b - joint / 2, Math.min(z0 + s, D + 0.4) - joint / 2, lip, tiltX, tiltZ, bevel, thick)
    }
  }
}

function slab(
  B: GeometryBuilder, x0: number, z0: number, x1: number, z1: number,
  lip: number, tx: number, tz: number, bevel: number, thick: number,
) {
  const cx = (x0 + x1) / 2
  const cz = (z0 + z1) / 2
  const y = (x: number, z: number) => lip + (x - cx) * tx + (z - cz) * tz
  const up = new THREE.Vector3(0, 1, 0)
  const T = (x: number, z: number, dy = 0) => new THREE.Vector3(x, y(x, z) + dy, z)
  // Top, inset by the bevel.
  const a = T(x0 + bevel, z0 + bevel)
  const b = T(x1 - bevel, z0 + bevel)
  const c = T(x1 - bevel, z1 - bevel)
  const d = T(x0 + bevel, z1 - bevel)
  const nTop = new THREE.Vector3(-tx, 1, -tz).normalize()
  B.face(a, b, c, d, nTop)
  // Bevels (45°) and sides down into the joint.
  const e0 = T(x0, z0, -bevel)
  const e1 = T(x1, z0, -bevel)
  const e2 = T(x1, z1, -bevel)
  const e3 = T(x0, z1, -bevel)
  const nb = (nx: number, nz: number) => new THREE.Vector3(nx, 1, nz).normalize()
  B.face(e0, e1, b, a, nb(0, -1))
  B.face(e1, e2, c, b, nb(1, 0))
  B.face(e2, e3, d, c, nb(0, 1))
  B.face(e3, e0, a, d, nb(-1, 0))
  const s0 = new THREE.Vector3(x0, -thick, z0)
  const s1 = new THREE.Vector3(x1, -thick, z0)
  const s2 = new THREE.Vector3(x1, -thick, z1)
  const s3 = new THREE.Vector3(x0, -thick, z1)
  B.face(s0, s1, e1, e0, new THREE.Vector3(0, 0, -1))
  B.face(s1, s2, e2, e1, new THREE.Vector3(1, 0, 0))
  B.face(s2, s3, e3, e2, new THREE.Vector3(0, 0, 1))
  B.face(s3, s0, e0, e3, new THREE.Vector3(-1, 0, 0))
  void up
}
