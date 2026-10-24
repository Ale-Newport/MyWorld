/* Is the sun's shadow ever stale? A ground-truth check of runtime/shadow-rig.js that does not use the rig's own idea of what matters (its caster classes, its thresholds, its frame): a check that did
   would agree with whatever the rig skips.

     QA_BASE=http://localhost:3210 node scripts/qa/world-shadow-stale.mjs [--only projects,cookies,career,banners,crates,parked] [--all] [--size 1440x900] [--dpr 1] [--touch]
                                                                          [--every 1-3] [--limit 0.3] [--out DIR] [--control lag|old-rule]

   After the player's own frame was drawn (same requestAnimationFrame batch, same task), the canvas is read back: A, what the loop drew with whatever shadow map it had. Then the sun's shadow map is swapped
   for a throw-away one (the rig's own map and every bit of its state are left untouched, so the check cannot repair what it is measuring), drawn fresh from the world matrices as they are
   (matrixWorldAutoUpdate off) with the loop's own shadow camera, and the same camera rendered again: B. Once more for C, the noise floor (B against C: nothing may differ, both are fresh). The share of the picture
   where A differs from B (4x4 luminance cells, more than 14/255) beyond what C differs from B is shadow the loop failed to refresh: `net`.
   Samples are taken every `--every` frames (a range, `1-3`: every frame to every third, at random), a step that moves things densely uses every frame.

   What fails a step: any sample whose `net` is over --limit (0.3 % of the picture: no exemption for a blip, a lag or a caster that has just appeared: a caster that starts to move in this frame is the case
   that matters), and in a cinematic view (the Projects board) over CINEMATIC_LIMIT. Samples taken while the governor had lowered the CPU tier (half-rate or no shadows: a loaded machine) are left out and
   counted.
   Steps (the activities whose casters move): parked, crates (light one, then a chain), projects (open, next x4, previous, close), cookies (taken by the interact action, and with the interact key), career
   (the walkway: its stones rise as cards), banners (the beach's waving one); --all adds bowling, the race, the title letters, the social signs, the achievements plaza, the time machine, the plane, the
   Ferris wheel, the harbor and the lighthouse.
   The worst pairs (what the loop drew, what a fresh map draws, where they differ) are saved to --out for a look.

   --control is a negative control, which this script must fail on:
     lag       the rig reads the poses after the render, as it did before main.js handed update() a frame (a mover's shadow follows one frame late, a new caster's up to 50 ms)
     old-rule  lag, and the decision as it was in the second round: a thin opaque sheet tolerates 60 cm of travel, no cinematic mode, translation only, appearing small casters ask for nothing. */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { launch, BASE, sleep, assert, finish, watch } from './lib.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback }
const OUT = path.resolve(arg('out', '.qa/runs/shadow-stale')), ALL = process.argv.includes('--all'), TOUCH = process.argv.includes('--touch')
const [E0, E1] = arg('every', '1-3').split('-').map(Number)
const [W, H] = arg('size', '1440x900').split('x').map(Number), DPR = Number(arg('dpr', 1))
const ONLY = arg('only', '') ? arg('only', '').split(',') : null
const CONTROL = arg('control', '')
/** Percent of the picture. The noise floor (two fresh renders against each other) is 0; a stale panel of the Projects board was 1.7 to 2.7, a career stone's card 1.0, a cookie 0.6 to 0.8. */
const LIMIT = Number(arg('limit', 0.3)), CINEMATIC_LIMIT = Number(arg('cinematic-limit', 0.05))
fs.mkdirSync(OUT, { recursive: true })

const browser = await launch()
const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, ...(TOUCH ? { hasTouch: true, isMobile: true } : {}) })).newPage()
const errors = watch(page)
await page.goto(`${BASE}/archipelago/preview/index.html?qa&perf`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 600_000 })
await sleep(3000)

if (CONTROL) {
  await page.evaluate(async ({ control }) => {
    const { measureCaster, CASTER_AMBIENT, CASTER_SMALL, SHADOW_MOTION, STATICS } = await import('/archipelago/preview/runtime/shadow-rig.js'), rig = __archipelago.shadow
    // the poses are read after the render, by watch(): update() is given no frame
    const update = rig.update; rig.update = function (camera, ground, car, cinematic) { return update.call(this, camera, ground, car, control === 'old-rule' ? false : cinematic, null) }
    if (control !== 'old-rule') return
    const thin = (o) => { const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox(); const b = g.boundingBox, e = o.matrixWorld.elements; return !o.isInstancedMesh && Math.min((b.max.x - b.min.x) * Math.hypot(e[0], e[1], e[2]), (b.max.y - b.min.y) * Math.hypot(e[4], e[5], e[6]), (b.max.z - b.min.z) * Math.hypot(e[8], e[9], e[10])) <= .045 }
    rig.compare = function (camera) {
      if (camera || this.legacy || this.off || this.moved) return
      const list = this.watched, ref = this.ref, versions = this.versions, thr = this.threshold, dir = this.dir, view = this.view, reach = view.r, slope = Math.max(.2, dir.y)
      for (let i = 0; i < list.length && !this.moved; i++) {
        const o = list[i], e = o.matrixWorld.elements, at = i * 16; let same = true
        for (let k = 0; k < 16; k++) if (e[k] !== ref[at + k]) { same = false; break }
        const version = o.isInstancedMesh ? o.instanceMatrix.version : 0
        if (same && version === versions[i]) continue
        if (version !== versions[i]) { this.moved = true; break }
        const move = Math.max(Math.abs(e[12] - ref[at + 12]), Math.abs(e[13] - ref[at + 13]), Math.abs(e[14] - ref[at + 14]))
        let turn = 0; for (const k of [0, 1, 2, 4, 5, 6, 8, 9, 10]) turn = Math.max(turn, Math.abs(e[k] - ref[at + k]))
        const q = measureCaster(e, this.statics, i * STATICS), radius = q.radius, cls = thin(o) ? CASTER_AMBIENT : q.cls
        if (cls === CASTER_AMBIENT ? move < SHADOW_MOTION.thinMove : move + turn * radius < (cls === CASTER_SMALL ? Math.max(thr, SHADOW_MOTION.smallMove) : thr)) continue
        const t = Math.max(0, (e[13] - view.y) / slope), gx = e[12] - dir.x * t, gz = e[14] - dir.z * t
        if (Math.hypot(gx - view.x, gz - view.z) < reach + radius + 2) this.moved = true
      }
    }
    rig.nearCamera = () => false
  }, { control: CONTROL })
}

await page.evaluate(({ e0, e1, limit }) => {
  const A = __archipelago, r = A.renderer, gl = r.getContext(), rig = A.shadow, sh = rig.sun.shadow
  // the check itself costs frames: keep the governor (cpu tier, quality level) from reacting to it, or the shadows it measures are switched off
  if (A.quality) { A.quality.setCpu(0); A.quality.hold() }
  const S = (globalThis.__stale = { e0, e1, label: '', samples: [], worst: [], on: false, by: {} })
  let wait = 1, lastFrame = -1, passes0 = 0, busy = false
  const grab = () => { const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, u = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, u); return { u, w, h } }
  const down = ({ u, w, h }) => { // luminance, 4x4 box average
    const cw = Math.floor(w / 4), ch = Math.floor(h / 4), out = new Float32Array(cw * ch)
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { let s = 0; for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { const k = ((y * 4 + j) * w + x * 4 + i) * 4; s += u[k] * .3 + u[k + 1] * .59 + u[k + 2] * .11 } out[y * cw + x] = s / 16 }
    return { d: out, w: cw, h: ch }
  }
  const diff = (a, b, thr = 14) => { let n = 0; for (let i = 0; i < a.d.length; i++) if (Math.abs(a.d[i] - b.d[i]) > thr) n++; return 100 * n / a.d.length }
  const tick = () => {
    requestAnimationFrame(tick)
    if (!S.on || busy) return
    const f = r.info.render.frame
    if (f === lastFrame) return            // the player's loop did not draw in this batch (the frame cap): nothing new to read back
    lastFrame = f
    const by = (S.by[S.label] ??= { frames: 0, passes: 0 })
    by.t0 ??= performance.now(); by.t1 = performance.now(); by.frames++; by.passes += rig.stats.passes - passes0; passes0 = rig.stats.passes
    if (--wait > 0) return
    wait = S.e0 + Math.floor(Math.random() * (S.e1 - S.e0 + 1))
    if (A.atlas?.isOpen || document.hidden || !A.driving) return
    busy = true
    try {
      const tier = A.quality?.cpu ?? 0, cinematic = !!(A.driving.view.cinematic.active || A.driving.view.cinematic.progress > .001)
      const a = grab(), da = down(a), lag = !!(rig.moved || rig.dirty)
      // what is waiting for a redraw: the casters whose pose is not the one the map shows (for the report only)
      const pend = []
      { const list = rig.watched, ref = rig.ref; for (let i = 0; i < list.length; i++) { const o = list[i], e = o.matrixWorld.elements, at = i * 16; let same = true; for (let k = 0; k < 16; k++) if (e[k] !== ref[at + k]) { same = false; break } if (same && !o.isInstancedMesh) continue; const mv = Math.max(Math.abs(e[12] - ref[at + 12]), Math.abs(e[13] - ref[at + 13]), Math.abs(e[14] - ref[at + 14])); let turn = 0; for (const k of [0, 1, 2, 4, 5, 6, 8, 9, 10]) turn = Math.max(turn, Math.abs(e[k] - ref[at + k])); const path = []; for (let p = o; p && path.length < 3; p = p.parent) path.push(p.name || p.type); pend.push({ n: path.join('<'), mv: +mv.toFixed(3), turn: +turn.toFixed(3) }) } pend.sort((x, y) => (y.mv + y.turn) - (x.mv + x.turn)) }
      const keep = { map: sh.map, pass: sh.mapPass }, auto = A.scene.matrixWorldAutoUpdate
      A.scene.matrixWorldAutoUpdate = false; sh.map = null; sh.mapPass = null
      let b, c
      try { r.shadowMap.needsUpdate = true; r.render(A.scene, A.camera); b = grab(); r.shadowMap.needsUpdate = true; r.render(A.scene, A.camera); c = grab() }
      // (The two renders above count as frames: main.js takes a frame it did not draw for something that touched its shadow map and redraws in full, which would hide exactly what is measured here. The rig's map
      // was not touched: the counter goes back.)
      finally { sh.map?.dispose(); sh.map = keep.map; sh.mapPass = keep.pass; A.scene.matrixWorldAutoUpdate = auto; r.info.render.frame = f; lastFrame = f }
      const db = down(b), dc = down(c), ab = diff(da, db), bc = diff(db, dc)
      const s = { f, label: S.label, ab: +ab.toFixed(3), bc: +bc.toFixed(3), net: +(ab - bc).toFixed(3), lag, cinematic, tier, pend: pend.slice(0, 4) }
      S.samples.push(s)
      if (s.net > limit * .5 && !tier) { S.worst.push({ ...s, a: a.u, b: b.u, w: a.w, h: a.h }); S.worst.sort((x, y) => y.net - x.net); if (S.worst.length > 4) S.worst.length = 4 }
    } finally { busy = false }
  }
  requestAnimationFrame(tick)
  S.on = true
}, { e0: E0, e1: E1, limit: LIMIT })

const label = (l, e0 = E0, e1 = E1) => page.evaluate(([l, e0, e1]) => { __stale.label = l; __stale.e0 = e0; __stale.e1 = e1 }, [l, e0, e1])
const within = (promise, ms, what) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} did not answer in ${ms / 1000} s`)), ms))])
const steps = []
const step = (group, name, fn, { seconds = 2.5, e0 = E0, e1 = E1 } = {}) => steps.push({ group, name, fn, seconds, e0, e1 })
const goTo = (x, z) => page.evaluate(([x, z]) => { const d = __archipelago.driving, a = d.arrival({ group: null, x, z, name: 'p' }); if (!a.ok) return { ok: false, reason: a.reason }; d.place(a, { reason: 'travel' }); return { ok: true } }, [x, z])
const drive = async (seconds, keys = ['KeyW']) => { for (const k of keys) await page.keyboard.down(k); await sleep(seconds * 1000); for (const k of keys) await page.keyboard.up(k) }
const interact = () => page.evaluate(() => { const g = __archipelago.gameplay, i = g.instances.find((x) => x.prompts.activeLabel); return { label: i?.prompts.activeLabel ?? null, done: g.interact() } })
const prompt = (label) => page.evaluate((label) => { const g = __archipelago.gameplay; for (const i of g.instances) for (const item of i.prompts.items) if (item.label === label) { const p = item.group.getWorldPosition(new __archipelago.THREE.Vector3()); return { x: p.x, z: p.z } } return null }, label)
const approach = async (label, ring = 2.3) => {
  const p = await prompt(label); if (!p) return { found: false }
  const r = await page.evaluate(([p, ring]) => { const d = __archipelago.driving; for (const [radius, margin] of [[ring, .3], [ring + .6, .3], [ring + 1.2, .1]]) { const pose = d.placement.near(p.x, p.z, { radius, step: .5, margin, dynamicMargin: .2, maxEdge: 4 }); if (pose) { d.place(pose, { reason: 'travel' }); return { ok: true, away: +Math.hypot(pose.x - p.x, pose.z - p.z).toFixed(1) } } } return { ok: false } }, [p, ring])
  await sleep(1500); return { found: true, ...r }
}
const projects = (n) => page.evaluate((n) => { __archipelago.gameplay.active()?.parts.projects?.step(n); return {} }, n)

step('parked', 'parked', async () => ({}), { seconds: 5, e0: 3, e1: 12 })
step('crates', 'crates: light the first', () => page.evaluate(() => { const i = __archipelago.gameplay.instances.find((x) => x.parts?.crates?.items?.length); const c = i.parts.crates.items[0], p = c.node.getWorldPosition(new __archipelago.THREE.Vector3()); __archipelago.driving.place({ x: p.x + 4, z: p.z + 4, rotation: 0, position: { x: p.x + 4, y: p.y + 1.2, z: p.z + 4 } }, { reason: 'travel' }); i.parts.crates.light(c); return { lit: true } }), { seconds: 5 })
step('crates', 'crates: chain, light all', () => page.evaluate(() => { for (const i of __archipelago.gameplay.instances) i.parts?.crates?.items?.slice(0, 3).forEach((c, k) => setTimeout(() => i.parts.crates.light(c), 400 * k)); return {} }), { seconds: 6 })
step('projects', 'projects: approach', () => approach('Projects'), { seconds: 2 })
step('projects', 'projects: open the board', () => interact(), { seconds: 5, e0: 1, e1: 2 })
for (let k = 0; k < 4; k++) step('projects', 'projects: next ' + k, () => projects(1), { seconds: 3, e0: 1, e1: 2 })
step('projects', 'projects: previous', () => projects(-1), { seconds: 3, e0: 1, e1: 2 })
step('projects', 'projects: close', () => page.evaluate(() => { __archipelago.gameplay.active()?.exit(); return {} }), { seconds: 4, e0: 1, e1: 2 })
step('cookies', 'cookies: approach, take (interact)', async () => { const a = await approach('Take a cookie'); const r = await interact(); await sleep(500); const r2 = await interact(); return { ...a, ...r, again: r2.done } }, { seconds: 6, e0: 1, e1: 1 })
step('cookies', 'cookies: take with the key', async () => { await approach('Take a cookie'); for (let k = 0; k < 3; k++) { await page.keyboard.press('KeyE'); await sleep(450) } return {} }, { seconds: 6, e0: 1, e1: 1 })
step('career', 'career: walk the path', async () => { const r = await goTo(10.3, 10.8); await sleep(1500); await drive(5); return r }, { seconds: 3, e0: 1, e1: 1 })
step('career', 'career: and back, slowly', async () => { await goTo(10.3, 60); await sleep(800); await drive(2.5, ['KeyS']); await drive(2, ['KeyW', 'KeyA']); return {} }, { seconds: 3, e0: 1, e1: 1 })
step('banners', 'banners: beach, parked', () => goTo(-91.8, 126.7), { seconds: 9, e0: 4, e1: 30 })
if (ALL) {
  step('bowling', 'bowling: reset the pins', async () => { const a = await approach('Reset pins'); const r = await interact(); await drive(3); return { ...a, ...r } }, { seconds: 4, e0: 1, e1: 3 })
  step('race', 'race: start Catalunya', async () => { const a = await approach('Start race'); const r = await interact(); await drive(8, ['KeyW', 'KeyD']); return { ...a, ...r } }, { seconds: 3 })
  step('race', 'race: leave', () => page.evaluate(() => { __archipelago.gameplay.active()?.exit(); return {} }), { seconds: 3 })
  step('title', 'title letters: drive through', async () => { const r = await goTo(-16, 61); await sleep(800); await drive(5); return r }, { seconds: 3 })
  step('social', 'social: approach the signs', async () => { const a = await approach('Email +2', 2); await drive(2); return a }, { seconds: 4 })
  step('plaza', 'achievements: plaza', async () => { const r = await goTo(78.1, 117.4); await drive(5); return r }, { seconds: 3 })
  step('lab', 'time machine, jukebox, spin', async () => { for (const [l, off] of [['Time machine', 3], ['Jukebox', 3], ['Give it a spin', 3]]) { await approach(l, off); await interact(); await sleep(2500) } return {} }, { seconds: 2 })
  step('plane', 'plane: take off, fly', async () => { await page.keyboard.press('Space'); await sleep(250); await page.keyboard.press('Space'); await sleep(1200); await drive(7, ['KeyW']); await page.keyboard.press('Space'); await page.keyboard.press('Space'); return {} }, { seconds: 4 })
  step('ferris', 'ferris wheel, parked', () => goTo(60.6, -35.9), { seconds: 9, e0: 4, e1: 30 })
  step('harbor', 'harbor, parked', () => goTo(26, 98), { seconds: 6, e0: 4, e1: 30 })
  step('lighthouse', 'lighthouse, parked', () => goTo(-124, 50), { seconds: 6, e0: 4, e1: 30 })
}

const T0 = Date.now()
for (const s of steps) {
  if (ONLY && !ONLY.includes(s.group)) continue
  await label(s.name, s.e0, s.e1)
  let r; try { r = await within(s.fn(), 60_000, s.name) } catch (e) { console.log('STEP FAILED', s.name, e.message); r = { failed: e.message } }
  await sleep(s.seconds * 1000)
  console.log(`${((Date.now() - T0) / 1000).toFixed(0).padStart(4)}s`, s.name.padEnd(38), JSON.stringify(r ?? {}))
}

const res = await page.evaluate(() => {
  __stale.on = false
  const by = {}
  for (const s of __stale.samples) (by[s.label] ??= []).push(s)
  return { by, count: __stale.samples.length, frames: __stale.by, worst: __stale.worst.map((w) => ({ label: w.label, ab: w.ab, bc: w.bc, net: w.net, lag: w.lag, cinematic: w.cinematic, pend: w.pend })) }
})
const worst = await page.evaluate(() => __stale.worst.map((w) => { const enc = (u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s) }; return { label: w.label, net: w.net, lag: w.lag, w: w.w, h: w.h, a: enc(w.a), b: enc(w.b) } }))

const results = []
const pct = (xs, q) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : 0 }
const all = Object.values(res.by).flat(), degraded = all.filter((s) => s.tier > 0).length
console.log(`\n${res.count} samples (${degraded} taken at a lowered CPU tier, left out)${CONTROL ? '  CONTROL: ' + CONTROL : ''}; noise floor (two fresh renders against each other): worst ${Math.max(0, ...all.map((s) => s.bc)).toFixed(3)}%`)
console.log('step'.padEnd(38), 'n'.padStart(5), 'worst %'.padStart(8), 'p95'.padStart(7), '  >0.1', ` >${LIMIT}`.padStart(6), '  redraws/frames', '  cinematic worst %')
for (const [name, taken] of Object.entries(res.by)) {
  const list = taken.filter((s) => !s.tier), cine = list.filter((s) => s.cinematic), peak = Math.max(0, ...list.map((s) => s.net)), cineWorst = Math.max(0, ...cine.map((s) => s.net))
  const over1 = list.filter((s) => s.net > .1).length, over = list.filter((s) => s.net > LIMIT).length, f = res.frames[name]
  console.log(name.padEnd(38), String(list.length).padStart(5), peak.toFixed(3).padStart(8), pct(list.map((s) => s.net), .95).toFixed(3).padStart(7), String(over1).padStart(6), String(over).padStart(6), `  ${f?.passes}/${f?.frames} (${f ? (100 * f.passes / Math.max(1, f.frames)).toFixed(0) : '?'}%)`.padEnd(18), cine.length ? `  ${cineWorst.toFixed(3)} (${cine.length} samples)` : '')
  assert(list.length >= 5, `${name}: enough samples (${list.length})`, results)
  assert(cineWorst <= CINEMATIC_LIMIT, `${name}: a cinematic view never shows a stale shadow (${cine.length} samples, worst ${cineWorst.toFixed(3)}%, limit ${CINEMATIC_LIMIT}%)`, results)
  assert(peak <= LIMIT, `${name}: no sample differs from a fresh shadow map by more than ${LIMIT}% of the picture (${list.length} samples, worst ${peak.toFixed(3)}%, ${over} over)`, results)
}
let n = 0
for (const w of worst) {
  const flip = (buf, wd, ht) => { const out = Buffer.alloc(buf.length), row = wd * 4; for (let y = 0; y < ht; y++) buf.copy(out, y * row, (ht - 1 - y) * row, (ht - y) * row); return out }
  const a = flip(Buffer.from(w.a, 'base64'), w.w, w.h), b = flip(Buffer.from(w.b, 'base64'), w.w, w.h), d = Buffer.alloc(a.length)
  for (let i = 0; i < a.length; i += 4) { const v = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); d[i] = Math.min(255, v * 4); d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 255 }
  for (const [tag, buf] of [['loop', a], ['fresh', b], ['diff', d]]) await sharp(buf, { raw: { width: w.w, height: w.h, channels: 4 } }).png().toFile(path.join(OUT, `worst${n}-${tag}.png`))
  console.log(`worst ${n}: ${w.label} net ${w.net}% (${w.lag ? 'redraw was pending' : 'rig believed the map fresh'})`); n++
}
for (const w of res.worst.slice(0, 3)) console.log('  pending at', w.label, w.net + '%', JSON.stringify(w.pend.slice(0, 3)))
fs.writeFileSync(path.join(OUT, 'stale.json'), JSON.stringify({ base: BASE, size: [W, H, DPR], touch: TOUCH, control: CONTROL, limits: { LIMIT, CINEMATIC_LIMIT }, by: Object.fromEntries(Object.entries(res.by).map(([k, v]) => [k, v.map(({ pend: _pend, ...s }) => s)])), errors }, null, 1))
assert(errors.length === 0, `no console errors ${errors.slice(0, 2).join(' | ')}`, results)
await browser.close()
finish(results)
