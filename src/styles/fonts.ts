import localFont from 'next/font/local'

/* Font loader values must be literal, hence the repeated paths.
   Every typeface the site can wear (see typefaces.ts), served from our own origin and subset to Latin.
   Only the default is preloaded: the others are fetched the moment the page actually uses them, so a
   choice made in the admin costs nothing to the visitors of the one that is live. Each file is a
   variable font, so one request covers every weight. */
export const spaceGrotesk = localFont({ src: '../../node_modules/@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2', variable: '--tf-grotesk', weight: '300 700', display: 'swap' })
export const hankenGrotesk = localFont({ src: '../../node_modules/@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2', variable: '--tf-hanken', weight: '100 900', display: 'swap', preload: false })
export const interTight = localFont({ src: '../../node_modules/@fontsource-variable/inter-tight/files/inter-tight-latin-wght-normal.woff2', variable: '--tf-inter-tight', weight: '100 900', display: 'swap', preload: false })
export const instrumentSans = localFont({ src: '../../node_modules/@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2', variable: '--tf-instrument', weight: '400 700', display: 'swap', preload: false })
export const schibstedGrotesk = localFont({ src: '../../node_modules/@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2', variable: '--tf-schibsted', weight: '400 900', display: 'swap', preload: false })

/* Geist, the type the site wore before: the admin's interface keeps it, and it is a choice for the site. */
export const geistSans = localFont({ src: '../../node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2', variable: '--font-geist-sans', weight: '100 900', display: 'swap', preload: false })
export const geistMono = localFont({ src: '../../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2', variable: '--font-geist-mono', weight: '100 900', display: 'swap', preload: false })

/** The classes that define every font variable; the document element carries them all. */
export const fontVariables = [spaceGrotesk, hankenGrotesk, interTight, instrumentSans, schibstedGrotesk, geistSans, geistMono].map((f) => f.variable).join(' ')
