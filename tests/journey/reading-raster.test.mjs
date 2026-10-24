import { test } from 'node:test'
import assert from 'node:assert/strict'
import { load } from '../setup.mjs'

const { rasteriseBoxes } = await load('src/components/home/room/layout/rasterise.ts')
const { rasterSignature } = await load('src/components/home/room/layout/readingSignature.ts')

const C = { displayEm: 0.22, displayMax: 44, bodyEm: 0.6, labelEm: 0.55, base: 0.006, blur: 0.012 }

/* The field as it was made before it was made cheap: a hypot and an exp for every cell a box reaches, and the blur
   over the whole grid. The cheap version has to give the same field. */
function reference(boxes, vw, vh, gw, gh) {
  const cell = vw / gw
  const data = new Float32Array(gw * gh)
  const short = Math.min(vw, vh)
  for (const b of boxes) {
    const display = b.px >= 28
    const trim = display ? b.h * 0.14 : 0
    const em = display ? Math.min(C.displayEm * b.px, C.displayMax) : b.px >= 16 ? C.bodyEm * b.px : C.labelEm * b.px
    const m = em + C.base * short
    const x0 = b.x - m, x1 = b.x + b.w + m, y0 = b.y + trim - m, y1 = b.y + b.h - trim + m
    const fall = m * 0.6 + cell
    const gx0 = Math.max(0, Math.floor((x0 - fall * 2) / cell)), gx1 = Math.min(gw - 1, Math.ceil((x1 + fall * 2) / cell))
    const gy0 = Math.max(0, Math.floor((y0 - fall * 2) / cell)), gy1 = Math.min(gh - 1, Math.ceil((y1 + fall * 2) / cell))
    for (let gy = gy0; gy <= gy1; gy++) {
      const py = (gy + 0.5) * cell
      const dy = Math.max(y0 - py, 0, py - y1)
      for (let gx = gx0; gx <= gx1; gx++) {
        const px = (gx + 0.5) * cell
        const dx = Math.max(x0 - px, 0, px - x1)
        const d = Math.hypot(dx, dy)
        const v = d <= 0 ? 1 : Math.exp(-(d * d) / (fall * fall))
        const k = gy * gw + gx
        if (v > data[k]) data[k] = v
      }
    }
  }
  const rad = Math.max(1, Math.round((C.blur * short) / cell))
  const kernel = []
  let ks = 0
  for (let i = -rad; i <= rad; i++) { const w = Math.exp(-(i * i) / (2 * (rad / 2) * (rad / 2))); kernel.push(w); ks += w }
  const tmp = new Float32Array(gw * gh)
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let s = 0
    for (let i = -rad; i <= rad; i++) s += data[y * gw + Math.min(gw - 1, Math.max(0, x + i))] * kernel[i + rad]
    tmp[y * gw + x] = s / ks
  }
  const out = new Float32Array(gw * gh)
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let s = 0
    for (let i = -rad; i <= rad; i++) s += tmp[Math.min(gh - 1, Math.max(0, y + i)) * gw + x] * kernel[i + rad]
    out[y * gw + x] = Math.max(s / ks, data[y * gw + x] * 0.9)
  }
  return out
}

/* A deterministic scatter of lines of every size, some off the edges of the screen. */
function boxesFor(vw, vh, n, seed = 7) {
  let a = seed
  const rnd = () => ((a = (a * 1664525 + 1013904223) >>> 0) / 4294967296)
  const out = []
  for (let i = 0; i < n; i++) {
    const px = [10, 12, 14, 18, 28, 56, 120][Math.floor(rnd() * 7)]
    out.push({ x: rnd() * vw * 1.2 - vw * 0.1, y: rnd() * vh * 1.2 - vh * 0.1, w: 30 + rnd() * vw * 0.6, h: px * 1.2, px })
  }
  return out
}

for (const [vw, vh] of [[390, 844], [1440, 900], [834, 1112], [844, 390]]) {
  test(`the cheap field is the field it replaced at ${vw}x${vh}`, () => {
    const gw = 192
    const gh = Math.max(16, Math.round((gw * vh) / vw))
    const boxes = boxesFor(vw, vh, 40)
    const a = reference(boxes, vw, vh, gw, gh)
    const b = rasteriseBoxes(boxes, vw, vh, gw, gh, C)
    let worst = 0
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]))
    // The skirt's exponential is taken as a product of two (a rounding error in the last digit of a float32).
    assert.ok(worst < 1e-6, `worst difference ${worst}`)
  })
}

test('copy that reaches the edge of the grid blurs against the edge, as before', () => {
  const vw = 390, vh = 844, gw = 192, gh = 416
  const boxes = [{ x: -40, y: -20, w: 480, h: 70, px: 56 }, { x: 300, y: 800, w: 200, h: 60, px: 56 }, { x: 0, y: 400, w: 390, h: 14, px: 12 }]
  const a = reference(boxes, vw, vh, gw, gh)
  const b = rasteriseBoxes(boxes, vw, vh, gw, gh, C)
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-6, `cell ${i}`)
})

test('no copy, no field; copy entirely off the grid, none either', () => {
  assert.ok(rasteriseBoxes([], 390, 844, 192, 416, C).every((v) => v === 0))
  const far = [{ x: 5000, y: 5000, w: 100, h: 20, px: 14 }]
  assert.ok(rasteriseBoxes(far, 390, 844, 192, 416, C).every((v) => v === 0))
})

test('a chapter is signed by where its lines are to half a pixel, and by their height', () => {
  const lines = () => [{ x: 10, y: 20, w: 300, h: 60, px: 56 }, { x: 10, y: 120, w: 200, h: 18, px: 14 }]
  const base = rasterSignature(lines())
  assert.equal(rasterSignature(lines()), base)
  const nudged = lines(); nudged[0].y += 0.2
  assert.equal(rasterSignature(nudged), base)
  const moved = lines(); moved[0].y += 1
  assert.notEqual(rasterSignature(moved), base)
  const taller = lines(); taller[1].h += 2
  assert.notEqual(rasterSignature(taller), base)
  assert.notEqual(rasterSignature(lines().slice(0, 1)), base)
})

test('the stepped rasteriser offers the thread back while it works, and gives the same field', async () => {
  const { rasteriseSteps } = await load('src/components/home/room/layout/rasterise.ts')
  const vw = 390, vh = 844, gw = 192, gh = 416
  const boxes = boxesFor(vw, vh, 60, 11)
  const steps = rasteriseSteps(boxes, vw, vh, gw, gh, C)
  let yields = 0
  let r
  while (!(r = steps.next()).done) yields++
  assert.ok(yields >= 4, `only ${yields} offers of the thread for a phone-sized field`)
  const whole = rasteriseBoxes(boxes, vw, vh, gw, gh, C)
  assert.deepEqual(Array.from(r.value), Array.from(whole))
})
