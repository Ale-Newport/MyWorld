import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 900, height: 600 } })).newPage()
await p.goto(`${process.argv[2]}/world`, { waitUntil: 'domcontentloaded', timeout: 90000 })
await p.waitForFunction(() => { const x=[...document.querySelectorAll('button')].find(y=>y.textContent?.trim()==='ENTER'); return x && !x.disabled }, { timeout: 120000 })
await p.getByRole('button', { name: 'ENTER', exact: true }).click()
await p.waitForFunction(() => Boolean(window.__world?.vehicle), { timeout: 60000 })
await p.waitForTimeout(2500)
const at = JSON.parse(process.env.AT)
// Stand the car THERE first: the ecology enables only 96 trunk
// colliders and they follow the player, so probing a distant column
// from the spawn sees no trees anywhere.
await p.evaluate((at) => {
  const g = window.__world
  const y = g.terrain.colliderHeightAt(at.x, at.z) + 2
  g.vehicle.moveTo({ x: at.x, y, z: at.z }, 0)
  g.view.focusPoint.trackedPosition.set(at.x, y, at.z)
  g.view.snapToTarget()
}, at)
await p.waitForTimeout(1500)
const info = await p.evaluate((at) => {
  const g = window.__world
  // Every fixed physics body within 20 m, with what it is.
  const out = []
  // Straight from Rapier: `physics.physicals` only lists what went
  // through `physics.add`, and a raycast filtered to the object group
  // cannot see a collider registered as floor.
  const raw = []
  g.physics.world.forEachCollider((c) => {
    const t = c.translation()
    const d = Math.hypot(t.x - at.x, t.z - at.z)
    if (d > 200) return
    // Big colliders have their origin far from the ground they cover:
    // a hundred-metre wall is centred fifty metres away from anywhere
    // it blocks, so a distance test on the origin misses it entirely.
    const he = c.halfExtents?.() ?? null
    const reach = he ? Math.hypot(he.x, he.z) : (c.radius?.() ?? 1)
    if (d - reach > 6) return
    raw.push({ d: +d.toFixed(1), x: +t.x.toFixed(1), y: +t.y.toFixed(1), z: +t.z.toFixed(1),
      he: he ? [+he.x.toFixed(1), +he.y.toFixed(1), +he.z.toFixed(1)] : null,
      shape: c.shapeType(), sensor: c.isSensor() })
  })
  raw.sort((a, b) => a.d - b.d)
  for (const ph of g.physics.physicals) {
    const pos = ph.current?.position
    if (!pos) continue
    const d = Math.hypot(pos.x - at.x, pos.z - at.z)
    if (d > 20) continue
    const col = ph.colliders?.[0]
    let shape = '?'
    try { const s = col.shape; shape = `${s.type ?? ''} ${JSON.stringify(s.halfExtents ?? s.radius ?? '')}` } catch { /* */ }
    out.push({ d: +d.toFixed(1), x: +pos.x.toFixed(1), y: +pos.y.toFixed(1), z: +pos.z.toFixed(1), type: ph.body.bodyType?.() ?? '?', cat: ph.category ?? '?', shape })
  }
  out.sort((a, b) => a.d - b.d)
  const profile = []
  for (let t = 0; t <= 20; t++) { const x = at.x - 4 + t*0.5, z = at.z - 4 + t*0.5; profile.push(`${x.toFixed(1)},${z.toFixed(1)}=${g.terrain.colliderHeightAt(x,z).toFixed(2)}`) }
  const slope = []
  for (const [dx,dz] of [[4,0],[-4,0],[0,4],[0,-4],[8,0],[-8,0],[0,8],[0,-8]]) slope.push(+(g.terrain.colliderHeightAt(at.x+dx, at.z+dz) - g.terrain.colliderHeightAt(at.x, at.z)).toFixed(2))
  const trees = g.ecology.trees.filter(t => Math.hypot(t.p.x - at.x, t.p.z - at.z) < 20).map(t => ({ x: +t.p.x.toFixed(1), z: +t.p.z.toFixed(1), r: t.radius, kind: t.kind }))
  const props = g.world.props?.items?.length ?? '?'
  return { raw: raw.slice(0, 10), profile, slope, trees, props, near: out.slice(0, 4), ground: +g.terrain.colliderHeightAt(at.x, at.z).toFixed(2), obstacle: g.physics.obstacleAt(at.x, at.z, 90, 220) }
}, at)
console.log(JSON.stringify(info, null, 1))
await b.close()
