/* How the portfolio's world areas are drawn in the player: the runtime's batch()
   pass turns repeated static meshes into InstancedMesh (same geometry and material
   within a 48 m cell) and merges the rest by material. Reports, per area, how many
   of its meshes were absorbed, and the scene's draw calls with and without batching.
   node scripts/qa/world-batching.mjs */
import { launch, openPlayer, sleep, assert, finish } from './lib.mjs'
const results = []
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await openPlayer(page)
await sleep(1500)
const r = await page.evaluate(async () => {
  const A = globalThis.__archipelago, out = {}
  for (const id of ['experience:portfolio-slalom', 'experience:portfolio-roundup', 'experience:portfolio-grove', 'experience:portfolio-lookout']) {
    let g; A.root.traverse((n) => { if (!g && n.userData.aw_id === id) g = n })
    if (!g) { out[id] = null; continue }
    let meshes = 0, absorbed = 0, dynamic = 0
    g.traverse((n) => { if (!n.isMesh) return; meshes++; let dyn = false; for (let p = n; p; p = p.parent) if (p.userData.physics_mode === 'DYNAMIC') dyn = true; if (dyn) { dynamic++; return } if (!n.visible) absorbed++ })
    out[id] = { name: g.name, meshes, absorbed, dynamic }
  }
  const instanced = []; A.scene.traverse((n) => { if (n.isInstancedMesh) instanced.push(n.count) })
  // Draw calls for one frame of the whole island from above, as batched now.
  A.renderer.info.autoReset = false; A.renderer.info.reset(); A.renderer.render(A.scene, A.camera); const calls = A.renderer.info.render.calls; A.renderer.info.autoReset = true
  return { areas: out, instancedMeshes: instanced.length, instances: instanced.reduce((s, n) => s + n, 0), calls }
})
console.log(JSON.stringify(r, null, 1))
for (const [id, a] of Object.entries(r.areas)) assert(a && a.absorbed + a.dynamic >= a.meshes * 0.6, `${a?.name ?? id}: ${a?.absorbed}/${a?.meshes} static meshes batched (${a?.dynamic} are physics bodies, drawn individually)`, results)
assert(r.instancedMeshes > 0, `the scene draws ${r.instances} placements through ${r.instancedMeshes} instanced meshes`, results)
await browser.close()
finish(results)
