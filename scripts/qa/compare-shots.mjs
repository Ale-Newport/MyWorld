/* Pixel difference between two sets of screenshots (before-* vs after-*). */
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
const dir = process.argv[2] ?? '.qa/runs/journey'
const rows = []
for (const f of fs.readdirSync(dir).filter((f) => f.startsWith('before-'))) {
  const a = path.join(dir, f), b = path.join(dir, f.replace(/^before-/, 'after-'))
  if (!fs.existsSync(b)) continue
  const [x, y] = await Promise.all([a, b].map((p) => sharp(p).raw().toBuffer({ resolveWithObject: true })))
  if (x.info.width !== y.info.width || x.info.height !== y.info.height) { rows.push([f, 'size differs']); continue }
  let diff = 0, n = x.info.width * x.info.height
  for (let i = 0; i < x.data.length; i += x.info.channels) {
    const d = Math.abs(x.data[i] - y.data[i]) + Math.abs(x.data[i + 1] - y.data[i + 1]) + Math.abs(x.data[i + 2] - y.data[i + 2])
    if (d > 48) diff++
  }
  rows.push([f.replace(/^before-/, ''), (100 * diff / n).toFixed(2) + '%'])
}
rows.sort((p, q) => parseFloat(q[1]) - parseFloat(p[1]))
for (const r of rows) console.log(r.join('  '))
