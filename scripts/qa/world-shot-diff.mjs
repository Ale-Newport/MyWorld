/* Amplified pixel difference of two screenshots, written next to them: node scripts/qa/world-shot-diff.mjs a.png b.png out.png [threshold=24] */
import sharp from 'sharp'
const [a, b, out, threshold = 24] = process.argv.slice(2)
const [x, y] = await Promise.all([a, b].map((p) => sharp(p).removeAlpha().raw().toBuffer({ resolveWithObject: true })))
const { width, height, channels } = x.info, diff = Buffer.alloc(width * height * 3)
let over = 0
for (let i = 0, j = 0; i < x.data.length; i += channels, j += 3) {
  const d = Math.abs(x.data[i] - y.data[i]) + Math.abs(x.data[i + 1] - y.data[i + 1]) + Math.abs(x.data[i + 2] - y.data[i + 2])
  if (d > threshold) over++
  const v = Math.min(255, d * 4)
  diff[j] = v; diff[j + 1] = d > threshold ? 0 : v * 0.3; diff[j + 2] = d > threshold ? 0 : v * 0.3
}
await sharp(diff, { raw: { width, height, channels: 3 } }).png().toFile(out)
console.log(`${(100 * over / (width * height)).toFixed(2)}% of pixels differ by more than ${threshold}`)
