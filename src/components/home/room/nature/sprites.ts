import * as THREE from 'three'
import { random, TAU } from '../lib/random'

/* ============================================================
   LEAF AND MOSS ATLASES
   Ported from the prototype's `createLeafSprites` and
   `createMossSprites`: the same two leaf outlines (a five-lobed
   ivy and a plain heart), the same seeded variation in hue,
   lightness, speckling, venation and the odd blemish, the same
   strand-and-tip moss tufts.

   What changes is what the paintings are allowed to contain. The
   prototype painted a finished picture: a detached drop shadow
   under every leaf, a light-to-dark gradient across the blade, a
   glint. In a lit 3D scene those would fight the real light, so
   here they are separated out:

   · ALBEDO keeps the pigment — hue, the gentle variation of the
     blade, speckles, veins, blemishes — at even exposure;
   · RELIEF becomes a normal map (a cupped blade, a sunk midrib,
     raised secondary veins) that the scene's light shades;
   · the cast shadow is drawn by the renderer from the leaf's real
     position against the wall, not painted into the sprite.
   ============================================================ */

export const LEAF_VARIANTS = 32
export const LEAF_COLS = 8
export const LEAF_ROWS = 4
// 96 px a leaf: on screen a leaf is 15–30 px, so this is plenty and
// keeps the CPU-side painting (and its normal-map pass) cheap.
const CELL = 96

/** Canvas 2D path of a leaf, base at (0,0), tip near (0,-1.16). */
function leafShape(ctx: CanvasRenderingContext2D, kind: number, variation: number) {
  ctx.beginPath()
  if (kind === 0) {
    ctx.moveTo(0, 0)
    ctx.bezierCurveTo(-0.16, -0.03, -0.33, -0.06, -0.41, -0.2)
    ctx.bezierCurveTo(-0.5, -0.28, -0.57, -0.28, -0.67, -0.32)
    ctx.bezierCurveTo(-0.52, -0.42, -0.44, -0.45, -0.4, -0.54)
    ctx.lineTo(-0.49, -0.76)
    ctx.bezierCurveTo(-0.28, -0.69, -0.16, -0.71, -0.1, -0.9)
    ctx.lineTo(0.03, -1.16 - variation * 0.06)
    ctx.bezierCurveTo(0.09, -0.99, 0.11, -0.85, 0.21, -0.69)
    ctx.lineTo(0.47, -0.83)
    ctx.bezierCurveTo(0.42, -0.56, 0.47, -0.46, 0.63, -0.38)
    ctx.bezierCurveTo(0.47, -0.34, 0.43, -0.22, 0.3, -0.16)
    ctx.bezierCurveTo(0.18, -0.06, 0.11, -0.02, 0, 0)
  } else {
    ctx.moveTo(0, 0)
    ctx.bezierCurveTo(-0.17, 0.02, -0.48, -0.14, -0.44, -0.46)
    ctx.bezierCurveTo(-0.4, -0.76, -0.1, -0.85, 0.02, -1.16)
    ctx.bezierCurveTo(0.14, -0.87, 0.47, -0.68, 0.43, -0.38)
    ctx.bezierCurveTo(0.4, -0.12, 0.15, 0.02, 0, 0)
  }
  ctx.closePath()
}

const VEINS: Array<[number, number, number, number]> = [
  [-0.39, -0.21, -0.01, -0.13], [-0.44, -0.66, 0, -0.3], [0.43, -0.69, 0.006, -0.3],
  [0.49, -0.37, 0.006, -0.2], [-0.2, -0.73, 0, -0.57], [0.2, -0.83, 0, -0.67], [-0.27, -0.47, 0, -0.4],
]

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

export interface LeafAtlas {
  albedo: THREE.CanvasTexture
  normal: THREE.CanvasTexture
  /** Per variant: aspect (width/length) of the painted blade. */
  kinds: number[]
}

/**
 * Paints LEAF_VARIANTS leaves into an 8×4 atlas. In each cell the
 * leaf's base sits at the bottom centre and its tip near the top,
 * the blade spanning the cell's full height.
 */
export function createLeafAtlas(seedBase = 134): LeafAtlas {
  const { ac, nc, kinds } = paintLeafAtlas(seedBase)
  const albedo = new THREE.CanvasTexture(ac)
  albedo.colorSpace = THREE.SRGBColorSpace
  albedo.anisotropy = 4
  albedo.premultiplyAlpha = false
  const normal = new THREE.CanvasTexture(nc)
  normal.colorSpace = THREE.NoColorSpace
  for (const t of [albedo, normal]) {
    t.generateMipmaps = true
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.magFilter = THREE.LinearFilter
    t.needsUpdate = true
  }
  return { albedo, normal, kinds }
}

/** Painted once per seed: the room and the portal's canopy (two WebGL
    contexts) upload the very same sheets. */
const painted = new Map<number, { ac: HTMLCanvasElement; nc: HTMLCanvasElement; kinds: number[] }>()

function paintLeafAtlas(seedBase: number) {
  const done = painted.get(seedBase)
  if (done) return done
  const W = LEAF_COLS * CELL
  const H = LEAF_ROWS * CELL
  const ac = canvas(W, H)
  const hc = canvas(W, H)
  const a = ac.getContext('2d')!
  const h = hc.getContext('2d')!
  h.fillStyle = 'rgb(128,128,128)'
  h.fillRect(0, 0, W, H)
  const kinds: number[] = []
  // Painted units: the blade runs 0 → -1.22 in y; scale so it fills
  // the cell's height with a small margin.
  const S = CELL / 1.3
  for (let i = 0; i < LEAF_VARIANTS; i++) {
    const r = random(seedBase + i * 61)
    const kind = i % 4 === 0 ? 1 : 0
    kinds.push(kind)
    const cx = (i % LEAF_COLS) * CELL + CELL / 2
    const cy = Math.floor(i / LEAF_COLS) * CELL + CELL - CELL * 0.04
    const variation = r()
    const hue = 80 + r() * 26
    const light = 24 + r() * 11

    /* ---- albedo ------------------------------------------- */
    a.save()
    a.translate(cx, cy)
    a.scale(S, S)
    leafShape(a, kind, variation)
    // Pigment varies along the blade, but evenly lit: no light side.
    const g = a.createLinearGradient(0, 0, 0, -1.16)
    g.addColorStop(0, `hsl(${hue + 3} 34% ${light - 3}%)`)
    g.addColorStop(0.45, `hsl(${hue} 32% ${light + 1}%)`)
    g.addColorStop(1, `hsl(${hue - 4} 31% ${light + 4}%)`)
    a.fillStyle = g
    a.fill()
    a.save()
    a.clip()
    // Lateral pigment drift (the edge of a leaf is often paler).
    const e = a.createRadialGradient(0, -0.55, 0.1, 0, -0.55, 0.75)
    e.addColorStop(0, 'rgba(10,30,8,0.10)')
    e.addColorStop(1, 'rgba(200,214,140,0.10)')
    a.fillStyle = e
    a.fillRect(-0.8, -1.3, 1.6, 1.4)
    // The prototype's speckle: 120 flecks of pale and dark.
    for (let j = 0; j < 120; j++) {
      const x = r() * 1.4 - 0.7
      const y = -r() * 1.25
      a.fillStyle = r() > 0.5 ? 'rgba(215,218,146,0.09)' : 'rgba(3,24,9,0.1)'
      a.fillRect(x, y, 0.008 + r() * 0.016, 0.009 + r() * 0.014)
    }
    // Veins: midrib and the seven secondaries, paler than the blade.
    a.lineCap = 'round'
    a.strokeStyle = 'rgba(184,202,134,0.34)'
    a.lineWidth = 0.016
    a.beginPath()
    a.moveTo(0, 0)
    a.bezierCurveTo(0.02, -0.38, -0.03, -0.78, 0.025, -1.13)
    a.stroke()
    a.lineWidth = 0.009
    a.strokeStyle = 'rgba(183,201,134,0.24)'
    for (const v of VEINS) {
      a.beginPath()
      a.moveTo(v[2], v[3])
      a.quadraticCurveTo((v[0] + v[2]) * 0.65, v[1] * 0.9, v[0], v[1])
      a.stroke()
    }
    // The odd sun-scorched blemish.
    if (i % 7 === 0) {
      a.fillStyle = 'rgba(167,146,60,0.18)'
      a.beginPath()
      a.ellipse(-0.3, -0.48, 0.06, 0.1, -0.4, 0, TAU)
      a.fill()
    }
    a.restore()
    // Darker rim and the petiole stub.
    a.strokeStyle = 'rgba(16,40,15,0.28)'
    a.lineWidth = 0.01
    leafShape(a, kind, variation)
    a.stroke()
    a.beginPath()
    a.moveTo(0, 0.04)
    a.quadraticCurveTo(-0.015, 0.02, 0, -0.09)
    a.strokeStyle = `hsl(${hue} 25% 28%)`
    a.lineWidth = 0.02
    a.stroke()
    a.restore()

    /* ---- relief (height) ---------------------------------- */
    h.save()
    h.translate(cx, cy)
    h.scale(S, S)
    leafShape(h, kind, variation)
    h.save()
    h.clip()
    // Cupped blade: high along the midrib's flanks, falling to the
    // margin; the midrib itself sunk in a groove.
    const cup = h.createRadialGradient(0, -0.58, 0.05, 0, -0.58, 0.72)
    cup.addColorStop(0, 'rgb(170,170,170)')
    cup.addColorStop(1, 'rgb(110,110,110)')
    h.fillStyle = cup
    h.fillRect(-0.8, -1.3, 1.6, 1.4)
    h.lineCap = 'round'
    h.strokeStyle = 'rgb(118,118,118)'
    h.lineWidth = 0.05
    h.beginPath()
    h.moveTo(0, 0)
    h.bezierCurveTo(0.02, -0.38, -0.03, -0.78, 0.025, -1.13)
    h.stroke()
    h.strokeStyle = 'rgb(186,186,186)'
    h.lineWidth = 0.022
    for (const v of VEINS) {
      h.beginPath()
      h.moveTo(v[2], v[3])
      h.quadraticCurveTo((v[0] + v[2]) * 0.65, v[1] * 0.9, v[0], v[1])
      h.stroke()
    }
    h.restore()
    h.restore()
  }

  // Height → tangent-space normal (Sobel), alpha from the albedo.
  const hd = h.getImageData(0, 0, W, H).data
  const ad = a.getImageData(0, 0, W, H).data
  const nc = canvas(W, H)
  const nctx = nc.getContext('2d')!
  const out = nctx.createImageData(W, H)
  const at = (x: number, y: number) => hd[(Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4] / 255
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1))
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1))
      const k = 2.2
      let nx = -dx * k
      let ny = dy * k
      let nz = 1
      const l = Math.hypot(nx, ny, nz)
      nx /= l
      ny /= l
      nz /= l
      out.data[i] = Math.round((nx * 0.5 + 0.5) * 255)
      out.data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255)
      out.data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255)
      out.data[i + 3] = ad[i + 3]
    }
  }
  nctx.putImageData(out, 0, 0)
  const result = { ac, nc, kinds }
  painted.set(seedBase, result)
  return result
}

/**
 * Moss: the prototype's tufts — 34 strands each, a stalk and a
 * capsule-like tip, in a spread of yellow-to-olive greens — stamped
 * by the thousand into one tileable sheet. Channels:
 *   RGB  pigment (sRGB)        A  coverage of the stamped tufts
 * and a second sheet:
 *   R    height (tufts are low domes)
 *   G    each tuft's own birth offset, so a growth front advances
 *        tuft by tuft rather than as a smooth wipe
 */
export function createMossSheet(
  size = 512, seed = 55,
  /** Metres the sheet spans on the stone, tufts per m², mean tuft size (m). */
  tile = 1.15, density = 5200, tuft = 0.038,
): { albedo: THREE.CanvasTexture; data: THREE.CanvasTexture } {
  const ac = canvas(size, size)
  const dc = canvas(size, size)
  const a = ac.getContext('2d')!
  const d = dc.getContext('2d')!
  d.fillStyle = 'rgb(0,255,0)'
  d.fillRect(0, 0, size, size)
  const r = random(seed)
  // The prototype's twelve tuft sprites, at 48px.
  const sprites: HTMLCanvasElement[] = []
  for (let n = 0; n < 12; n++) {
    const c = canvas(48, 48)
    const ctx = c.getContext('2d')!
    const rr = random(n * 51 + seed)
    const g = ctx.createRadialGradient(22, 22, 0, 24, 24, 22)
    g.addColorStop(0, 'rgba(35,55,16,.5)')
    g.addColorStop(0.66, 'rgba(39,59,22,.26)')
    g.addColorStop(1, 'rgba(39,59,22,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 48, 48)
    for (let i = 0; i < 34; i++) {
      const an = rr() * TAU
      const rad = Math.sqrt(rr()) * 17
      const x = 24 + Math.cos(an) * rad
      const y = 25 + Math.sin(an) * rad * 0.72
      const len = 2 + rr() * 6
      ctx.strokeStyle = `hsla(${72 + rr() * 27},${27 + rr() * 14}%,${17 + rr() * 20}%,.82)`
      ctx.lineWidth = 0.8 + rr() * 0.9
      ctx.beginPath()
      ctx.moveTo(x, y + 2)
      ctx.quadraticCurveTo(x - 1, y - 3, x + rr() * 3 - 1.5, y - len)
      ctx.stroke()
      ctx.fillStyle = `hsla(${71 + rr() * 29},${30 + rr() * 17}%,${29 + rr() * 24}%,.87)`
      ctx.beginPath()
      ctx.ellipse(x, y - len, 1 + rr() * 0.6, 1.6 + rr(), -0.4, 0, TAU)
      ctx.fill()
    }
    sprites.push(c)
  }
  // Stamp tufts, wrapping at the edges so the sheet tiles.
  const count = Math.round(density * tile * tile)
  const mean = (tuft / tile) * size
  for (let i = 0; i < count; i++) {
    const x = r() * size
    const y = r() * size
    const s = mean * (0.47 + r() * 1.06)
    const sp = sprites[Math.floor(r() * sprites.length)]
    const rot = r() * TAU
    const birth = Math.round(r() * 255)
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const px = x + ox
        const py = y + oy
        if (px < -s || px > size + s || py < -s || py > size + s) continue
        a.save()
        a.translate(px, py)
        a.rotate(rot)
        a.drawImage(sp, -s / 2, -s / 2, s, s)
        a.restore()
        // Height dome and birth offset for this tuft.
        const hg = d.createRadialGradient(px, py, 0, px, py, s * 0.5)
        hg.addColorStop(0, `rgba(255,${birth},0,0.9)`)
        hg.addColorStop(0.7, `rgba(150,${birth},0,0.6)`)
        hg.addColorStop(1, `rgba(0,${birth},0,0)`)
        d.fillStyle = hg
        d.beginPath()
        d.arc(px, py, s * 0.5, 0, TAU)
        d.fill()
      }
    }
  }
  const albedo = new THREE.CanvasTexture(ac)
  albedo.colorSpace = THREE.SRGBColorSpace
  const data = new THREE.CanvasTexture(dc)
  data.colorSpace = THREE.NoColorSpace
  for (const t of [albedo, data]) {
    t.anisotropy = 8
    t.wrapS = THREE.RepeatWrapping
    t.wrapT = THREE.RepeatWrapping
    t.generateMipmaps = true
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.magFilter = THREE.LinearFilter
    t.needsUpdate = true
  }
  return { albedo, data }
}
