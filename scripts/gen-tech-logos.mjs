/**
 * Generate `src/content/tech-logos.ts` from the `simple-icons` package.
 *
 *   node scripts/gen-tech-logos.mjs
 *
 * Only the technologies listed in `src/content/skills.ts` that have a real
 * brand mark are emitted. Everything else is drawn as a house glyph by
 * `TechTile`, so no logo is ever invented for a concept.
 *
 * The icon geometry is CC0 (Simple Icons); the marks themselves remain the
 * trademarks of their owners and are used here nominatively, to identify the
 * technologies behind real projects. See THIRD_PARTY_NOTICES.md.
 */
import * as si from 'simple-icons'
import { writeFile } from 'node:fs/promises'

/** tech id (src/content/skills.ts) → simple-icons slug. */
const MAP = {
  python: 'python',
  typescript: 'typescript',
  javascript: 'javascript',
  java: 'openjdk',
  c: 'cplusplus',
  swift: 'swift',
  html: 'html5',
  scala: 'scala',
  haskell: 'haskell',
  r: 'r',
  ruby: 'ruby',

  react: 'react',
  vue: 'vuedotjs',
  django: 'django',
  /* Node and Express each carry their own mark now. Express's is
     a near-black wordmark, which the contrast pass leaves alone
     because it already clears the bar on white. */
  node: 'nodedotjs',
  express: 'express',
  threejs: 'threedotjs',
  flask: 'flask',
  reactnative: 'react',
  laravel: 'laravel',
  fastify: 'fastify',
  nextjs: 'nextdotjs',
  nuxt: 'nuxt',
  svelte: 'svelte',
  tailwind: 'tailwindcss',

  tensorflow: 'tensorflow',
  spacy: 'spacy',
  opencv: 'opencv',

  pandas: 'pandas',
  numpy: 'numpy',
  postgres: 'postgresql',
  mysql: 'mysql',
  sqlite: 'sqlite',
  prisma: 'prisma',
  mongo: 'mongodb',

  docker: 'docker',
  linux: 'linux',
  ci: 'githubactions',
  git: 'git',

  vite: 'vite',
  maven: 'apachemaven',

  figma: 'figma',
  framer: 'framer',
  blender: 'blender',
  webflow: 'webflow',
  wordpress: 'wordpress',
}

/* Brand colours are chosen against whatever ground their owner uses.
   This wall is white, and several of them (JavaScript's yellow, C's
   pale blue, Swift's orange) land at 1.3–2.8:1 against it — legible
   as a shape, not as a mark. Each one is darkened along its own hue
   until it clears 3:1, the WCAG bar for a graphical object, so the
   logo stays recognisably itself and is still visible. The untouched
   brand value is kept beside it, because that is the fact. */
const MIN_CONTRAST = 3

const srgb = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const luminance = ([r, g, b]) =>
  0.2126 * srgb(r / 255) + 0.7152 * srgb(g / 255) + 0.0722 * srgb(b / 255)
const contrastOnWhite = (rgb) => 1.05 / (luminance(rgb) + 0.05)
const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const toHex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

/** Darken towards black in small steps, holding the hue. */
function legible(hex) {
  let rgb = toRgb(hex)
  for (let i = 0; i < 40 && contrastOnWhite(rgb) < MIN_CONTRAST; i++) {
    rgb = rgb.map((v) => v * 0.94)
  }
  return toHex(rgb)
}

const key = (slug) => 'si' + slug.charAt(0).toUpperCase() + slug.slice(1)

const entries = []
const missing = []
for (const [id, slug] of Object.entries(MAP)) {
  const icon = si[key(slug)]
  if (!icon) { missing.push(`${id} → ${slug}`); continue }
  const hex = `#${icon.hex}`
  entries.push([id, { title: icon.title, hex, ink: legible(hex), path: icon.path }])
}

if (missing.length) {
  console.error(`Unknown simple-icons slug(s): ${missing.join(', ')}`)
  process.exit(1)
}

const body = entries
  .map(([id, v]) => `  ${id}: { title: ${JSON.stringify(v.title)}, hex: '${v.hex}', ink: '${v.ink}', path: '${v.path}' },`)
  .join('\n')

await writeFile(
  'src/content/tech-logos.ts',
  `/* ============================================================
   BRAND MARKS — GENERATED FILE, DO NOT EDIT BY HAND
   Regenerate with: node scripts/gen-tech-logos.mjs

   Path geometry comes from Simple Icons (CC0-1.0), pinned into
   the repository so the toolbox never fetches a third-party
   asset at runtime. The marks remain the trademarks of their
   respective owners and are used nominatively — to identify the
   technologies behind real projects. See THIRD_PARTY_NOTICES.md.

   Technologies with no brand mark (concepts like "Deep Learning",
   or trademarks Simple Icons does not carry) are deliberately
   absent: TechTile draws a house glyph for those instead of
   inventing a logo.
   ============================================================ */

export interface TechLogo {
  /** Official brand name, as published by Simple Icons. */
  title: string
  /** The brand's own colour, recorded as published. */
  hex: string
  /** The same colour darkened until it clears 3:1 on white — what
      the tile actually paints, so a pale mark is still a mark. */
  ink: string
  /** 24×24 viewBox path data. */
  path: string
}

export const techLogos: Record<string, TechLogo> = {
${body}
}
`,
)

console.log(`wrote src/content/tech-logos.ts — ${entries.length} brand marks`)
