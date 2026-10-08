import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '..')
const publicDir = path.join(root, 'public')
const mark = await readFile(path.join(publicDir, 'favicon.svg'))

const iconSizes = [16, 32, 48]
const iconPngs = await Promise.all(iconSizes.map((size) => sharp(mark).resize(size, size).png().toBuffer()))
const header = Buffer.alloc(6 + iconSizes.length * 16)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(iconSizes.length, 4)
let offset = header.length
for (let i = 0; i < iconSizes.length; i++) {
  const entry = 6 + i * 16
  header.writeUInt8(iconSizes[i], entry)
  header.writeUInt8(iconSizes[i], entry + 1)
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(iconPngs[i].length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += iconPngs[i].length
}
await writeFile(path.join(publicDir, 'favicon.ico'), Buffer.concat([header, ...iconPngs]))
await sharp(mark).resize(180, 180).png().toFile(path.join(publicDir, 'apple-touch-icon.png'))

const overlay = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="1200" height="630" fill="#f6f0e6" fill-opacity=".19"/>
  <rect x="104" y="74" width="45" height="45" rx="2" fill="#16241b"/>
  <text x="126.5" y="103" text-anchor="middle" fill="#f6f0e6" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="700" letter-spacing="-1">AN</text>
  <text x="164" y="103" fill="#16241b" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="700" letter-spacing="4">PORTFOLIO / 2026</text>
  <path d="M104 151H1096" stroke="#435340" stroke-opacity=".34"/>
  <text x="99" y="292" fill="#17251b" font-family="Arial, Helvetica, sans-serif" font-size="106" font-weight="700" letter-spacing="-7">ALEJANDRO</text>
  <text x="99" y="394" fill="#17251b" font-family="Arial, Helvetica, sans-serif" font-size="106" font-weight="700" letter-spacing="-7">NEWPORT</text>
  <rect x="106" y="432" width="77" height="4" fill="#526646"/>
  <text x="105" y="485" fill="#273b2e" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="600" letter-spacing="2.2">SOFTWARE &amp; AI ENGINEER</text>
  <text x="105" y="535" fill="#4d5c4d" font-family="Arial, Helvetica, sans-serif" font-size="19" letter-spacing="1.2">INTELLIGENT PRODUCTS · INTERACTIVE WORLDS</text>
  <path d="M104 562H1096" stroke="#435340" stroke-opacity=".34"/>
  <text x="105" y="589" fill="#344b3a" font-family="Arial, Helvetica, sans-serif" font-size="14" letter-spacing="3">LONDON, UK</text>
  <text x="1096" y="589" text-anchor="end" fill="#344b3a" font-family="Arial, Helvetica, sans-serif" font-size="14" letter-spacing="3">ALEJANDRO NEWPORT</text>
</svg>`

await sharp(path.join(publicDir, 'home-room/still-landscape.webp'))
  .resize(1200, 630, { fit: 'cover', position: 'centre' })
  .composite([{ input: Buffer.from(overlay) }])
  .png({ compressionLevel: 9, palette: true })
  .toFile(path.join(publicDir, 'og-image.png'))

console.log('Generated public/og-image.png, favicon.ico and apple-touch-icon.png')
