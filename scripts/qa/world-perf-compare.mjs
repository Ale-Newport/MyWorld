/* Side by side of two world-perf-probe results (before / after), per spot: the numbers an acceptance list asks for.
     node scripts/qa/world-perf-compare.mjs .qa/runs/impl/frame/perf-base-1440-dpr1.5.json .qa/runs/impl/frame/perf-after-1440-dpr1.5.json */
import fs from 'node:fs'
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')))
const f = (v, d = 1) => (v == null || Number.isNaN(v) ? 'n/a' : Number(v).toFixed(d))
const pct = (x, y) => (x ? ((100 * (y - x)) / x).toFixed(0) + '%' : 'n/a')
const gpu = (r) => (r.gpu?.mainMs ? r.gpu.mainMs.p50 + r.gpu.shadowMs.p50 : null)
console.log(`${a.label}  ->  ${b.label}   (${a.size.join('x')} dpr ${a.dpr} cpu ${a.cpu}x ${a.touch ? 'touch' : ''})`)
console.log('spot      state    cpu ms p50        gpu ms p50        frame p95/p99       shadow passes     shadow calls        shadow tris(k)      main calls/tris(k)   matrix ms')
for (const spot of Object.keys(a.spots)) {
  const x = a.spots[spot], y = b.spots[spot]
  if (!y) continue
  for (const state of ['parked', 'driving']) {
    const p = x[state], q = y[state]
    console.log(`${spot.padEnd(9)} ${state.padEnd(8)} ${f(p.cpuFrameMs.p50)}->${f(q.cpuFrameMs.p50)} (${pct(p.cpuFrameMs.p50, q.cpuFrameMs.p50)})   ${f(gpu(p), 2)}->${f(gpu(q), 2)} (${pct(gpu(p), gpu(q))})   ${f(p.frameMs.p95)}/${f(p.frameMs.p99)} -> ${f(q.frameMs.p95)}/${f(q.frameMs.p99)}   ${f(p.shadow.framesWithPass * 100, 0)}%->${f(q.shadow.framesWithPass * 100, 0)}%   ${p.shadow.calls.p50}->${q.shadow.calls.p50}   ${f(p.shadow.triangles.p50 / 1e3, 0)}->${f(q.shadow.triangles.p50 / 1e3, 0)}   ${x.passes.main.calls}/${f(x.passes.main.triangles / 1e3, 0)} -> ${y.passes.main.calls}/${f(y.passes.main.triangles / 1e3, 0)}   ${x.passes.updateMatrixWorldMs}->${y.passes.updateMatrixWorldMs}`)
  }
  const sa = x.passes, sb = y.passes
  console.log(`          A/B pass: shadow ${sa.shadow.calls} calls ${f(sa.shadow.triangles / 1e3, 0)}k tris ${sa.shadow.cpuMs} ms -> ${sb.shadow.calls} calls ${f(sb.shadow.triangles / 1e3, 0)}k tris ${sb.shadow.cpuMs} ms | total ${sa.total.calls}/${f(sa.total.triangles / 1e3, 0)}k -> ${sb.total.calls}/${f(sb.total.triangles / 1e3, 0)}k (${pct(sa.total.triangles, sb.total.triangles)} tris)`)
}
