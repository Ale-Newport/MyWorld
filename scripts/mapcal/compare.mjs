/**
 * scripts/mapcal/compare.mjs — the drawing and the world, side by side.
 *
 *   node scripts/world-topdown.mjs <url> --out=.qa/world/topdown.png
 *   node scripts/mapcal/compare.mjs
 *
 * The brief's acceptance test is not "does it run": it is whether a
 * top-down screenshot of the finished world is recognisably the same
 * map as the photograph. That is a question you answer by looking, so
 * this puts the two images beside each other, at the same aspect, with
 * the same tenth-lines drawn over both.
 */
import sharp from 'sharp'
import fs from 'node:fs'

const PLAN = 'public/dev/map-plan.webp'
const SHOT = process.argv[2] ?? '.qa/world/topdown.png'
const OUT = process.argv[3] ?? '.qa/world/compare.png'

if (!fs.existsSync(SHOT)) {
  console.error(`no screenshot at ${SHOT} — run scripts/world-topdown.mjs first`)
  process.exit(1)
}

/* The island's own extents, read from the generated map rather than
   written down here: it was 380 x 285 and is now 266 x 199.5, and a
   comparison that still crops to the old numbers silently compares
   two different framings. */
const { MAP_WIDTH, MAP_DEPTH, BOOM } = JSON.parse(
  process.env.MAP_JSON ?? '{"MAP_WIDTH":266,"MAP_DEPTH":199.5,"BOOM":490}',
)

const W = 900
const H = Math.round(W * MAP_DEPTH / MAP_WIDTH)

/* The screenshot is a 4:3 frame around the island, so it occupies a
   known fraction of the frame: the camera sees 2*tan(12.5°)*BOOM metres
   down and that times the aspect across. Crop to the island's own
   extents so the two images are the same map at the same scale. */
const shot = sharp(SHOT)
const meta = await shot.metadata()
const seenX = 2 * Math.tan((25 / 2) * Math.PI / 180) * BOOM * (meta.width / meta.height)
const seenZ = 2 * Math.tan((25 / 2) * Math.PI / 180) * BOOM
const cropW = Math.round(meta.width * MAP_WIDTH / seenX)
const cropH = Math.round(meta.height * MAP_DEPTH / seenZ)

const grid = (w, h) => {
  let g = ''
  for (let i = 1; i < 10; i++) {
    const x = Math.round(w * i / 10)
    const y = Math.round(h * i / 10)
    g += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="#d4491f" stroke-width="1" opacity="0.35"/>`
    g += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="#d4491f" stroke-width="1" opacity="0.35"/>`
  }
  return Buffer.from(`<svg width="${w}" height="${h}">${g}</svg>`)
}

const left = await sharp(PLAN).resize(W, H, { fit: 'fill' })
  .composite([{ input: grid(W, H) }]).png().toBuffer()
const right = await shot
  .extract({
    left: Math.round((meta.width - cropW) / 2),
    top: Math.round((meta.height - cropH) / 2),
    width: cropW, height: cropH,
  })
  .resize(W, H, { fit: 'fill' })
  .composite([{ input: grid(W, H) }]).png().toBuffer()

const label = (text) => Buffer.from(
  `<svg width="${W}" height="34"><rect width="${W}" height="34" fill="#141a17"/>`
  + `<text x="14" y="23" fill="#eae4c6" font-family="monospace" font-size="16">${text}</text></svg>`,
)

await sharp({ create: { width: W * 2 + 12, height: H + 34, channels: 3, background: '#141a17' } })
  .composite([
    { input: label('THE DRAWING'), left: 0, top: 0 },
    { input: label('THE WORLD — top-down, 700 m'), left: W + 12, top: 0 },
    { input: left, left: 0, top: 34 },
    { input: right, left: W + 12, top: 34 },
  ])
  .png().toFile(OUT)

console.log(`wrote ${OUT}`)
