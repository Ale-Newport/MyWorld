import type { Project } from '../types'

/* ============================================================
   CLIENT WORK — Pansofia / Grupo Newport, summer 2025.
   The GitHub repositories are PRIVATE. Nothing here comes from
   them. Every entry below was verified against the LIVE PUBLIC
   website: HTTP 200, page title and brand palette extracted
   from the public markup. No source code, infrastructure,
   credentials or internal detail is referenced anywhere.
   ============================================================ */

interface ClientSeed {
  slug: string
  title: string
  short: string
  url: string
  sector: string
  palette: [string, string, string]
  /** Verified from the live public page. */
  evidence: string
  region: string
  importance: 'featured' | 'archive'
}

const seeds: ClientSeed[] = [
  {
    slug: 'fuerteventura-2000', title: 'Fuerteventura 2000', short: 'FV2000',
    url: 'https://www.fuerteventura2000.com', sector: 'Vocational training',
    palette: ['#19248b', '#4f6d7a', '#c0d6df'], region: 'Fuerteventura',
    evidence: 'Subsidised employment training centre. Course catalogue, enrolment and centre information.',
    importance: 'featured',
  },
  {
    slug: 'pansofia', title: 'Pansofía', short: 'Pansofía',
    url: 'https://pansofia.com', sector: 'Education technology',
    palette: ['#111113', '#e94a2f', '#a2a2ab'], region: 'Canary Islands',
    evidence: 'The group’s own agency brand: training management, e-learning and editorial services.',
    importance: 'featured',
  },
  {
    slug: 'bioever', title: 'Clínica Bioever', short: 'Bioever',
    url: 'https://clinicabioever.com', sector: 'Longevity and aesthetics clinic',
    palette: ['#0c3e46', '#3fbfa8', '#1c8c82'], region: 'Las Palmas de Gran Canaria',
    evidence: 'Longevity and aesthetic medicine clinic — programmes, services and booking.',
    importance: 'featured',
  },
  {
    slug: 'cht-canarias', title: 'CHT Canarias', short: 'CHT',
    url: 'https://chtcanarias.com', sector: 'Hospitality & tourism school',
    palette: ['#15284c', '#254989', '#adadad'], region: 'Gran Canaria',
    evidence: 'Centro de Hostelería y Turismo de Canarias — programme listings and school information.',
    importance: 'featured',
  },
  {
    slug: 'hotel-escuela-el-mirador', title: 'Hotel Escuela El Mirador', short: 'El Mirador',
    url: 'https://hotelescuelaelmirador.com', sector: 'Hospitality training hotel',
    palette: ['#c48c3d', '#3c3c3b', '#333333'], region: 'Puerto del Rosario',
    evidence: 'A working hotel that doubles as a training school — rooms, restaurant and training programmes.',
    importance: 'featured',
  },
  {
    slug: 'newport-media-films', title: 'Newport Media Films', short: 'NMF',
    url: 'https://newportmediafilms.com', sector: 'Audiovisual production',
    palette: ['#d9000d', '#e13510', '#2e2e2d'], region: 'Canary Islands',
    evidence: 'Production company and audiovisual/drone training — showreel-led, media-heavy layout.',
    importance: 'featured',
  },
  {
    slug: 'escuela-de-hosteleria-canaria', title: 'Escuela de Hostelería Canaria', short: 'EHC',
    url: 'https://escueladehosteleriacanaria.com', sector: 'Catering school',
    palette: ['#021d30', '#ff4130', '#f2f3f5'], region: 'Fuerteventura',
    evidence: 'Vocational catering and hospitality training.',
    importance: 'featured',
  },
  {
    slug: 'esenfuer', title: 'ESENFUER', short: 'ESENFUER',
    url: 'https://esenfuer.com', sector: 'Further education academy',
    palette: ['#41b1c3', '#007ebf', '#00a19a'], region: 'Gran Tarajal',
    evidence: 'Escuela Superior de Enseñanza de Fuerteventura — private training academy.',
    importance: 'archive',
  },
  {
    slug: 'fpe-europea', title: 'FPE Europea', short: 'FPE',
    url: 'https://fpeeuropea.com', sector: 'Employment training & consulting',
    palette: ['#008acf', '#74c4cc', '#fcc72b'], region: 'Puerto del Rosario',
    evidence: 'Vocational training for employment, job placement and business consulting.',
    importance: 'archive',
  },
  {
    slug: 'nformar', title: 'NFORMAR', short: 'NFORMAR',
    url: 'https://nformar.com', sector: 'Employment training',
    palette: ['#e5222e', '#dc2626', '#7c7c7c'], region: 'Canary Islands',
    evidence: 'Subsidised employment training provider.',
    importance: 'archive',
  },
  {
    slug: 'aula-impulsa', title: 'Aula Impulsa', short: 'Aula Impulsa',
    url: 'https://aulaimpulsa.com', sector: 'Employment training',
    palette: ['#071d34', '#8ede6b', '#23b3a6'], region: 'Canary Islands',
    evidence: 'Vocational and employment training courses.',
    importance: 'archive',
  },
  {
    slug: 'talento-profesional', title: 'Talento Profesional', short: 'Talento Pro',
    url: 'https://talentoprofesional.com', sector: 'Vocational training',
    palette: ['#d4e414', '#4d5300', '#1a1a1a'], region: 'Fuerteventura & Gran Canaria',
    evidence: 'Training centre operating across two islands.',
    importance: 'archive',
  },
  {
    slug: 'eduprisma', title: 'Eduprisma', short: 'Eduprisma',
    url: 'https://eduprisma.es', sector: 'Certified training & e-learning',
    palette: ['#4d2779', '#f99c00', '#1d1d1b'], region: 'Canary Islands',
    evidence: 'Certificados de profesionalidad and teleformación (distance learning).',
    importance: 'archive',
  },
  {
    slug: 'level-up-canarias', title: 'Level Up Canarias', short: 'Level Up',
    url: 'https://levelupcanarias.com', sector: 'Fitness & recovery',
    palette: ['#9a5a5c', '#854b4d', '#1f1f1f'], region: 'Canary Islands',
    evidence: 'Personal training and recovery centre — the outlier in an education-heavy portfolio.',
    importance: 'archive',
  },
  {
    slug: 'avanza-fp', title: 'AvanzaFP', short: 'AvanzaFP',
    url: 'https://avanzafp.es', sector: 'Vocational training',
    palette: ['#1230e6', '#01093a', '#0d1b4c'], region: 'Spain',
    evidence: 'Formación profesional para el empleo.',
    importance: 'archive',
  },
  {
    slug: 'innova-urbis', title: 'Innova Urbis', short: 'Innova Urbis',
    url: 'https://innovaurbis.com/es', sector: 'Real estate',
    palette: ['#ce191c', '#a51418', '#1c1917'], region: 'Fuerteventura',
    evidence: 'Property sales and investment — multilingual, listing-driven site.',
    importance: 'archive',
  },
]

export const clientProjects: Project[] = seeds.map((s, i) => ({
  id: `client-${s.slug}`,
  slug: s.slug,
  title: s.title,
  shortTitle: s.short,
  year: '2025',
  dates: 'Jun 2025 – Sep 2025',
  source: 'client',
  organisation: 'Pansofia / Grupo Newport',
  category: 'client-work',
  subcategory: s.sector,
  importance: s.importance,
  shortDescription: `${s.sector} · ${s.region}`,
  description: s.evidence,
  contribution:
    'Built as part of the site programme delivered by a team of six, led by Alejandro. Front-end build, back-end integration and deployment to private server infrastructure.',
  verifiedFacts: [
    'Live and publicly reachable — verified by HTTP request and page content.',
    `Brand palette extracted from the live public stylesheet: ${s.palette.join(', ')}.`,
    'Source repository is private; no code, infrastructure or client data is exposed here.',
  ],
  metrics: [],
  technologies: ['JavaScript', 'HTML', 'CSS', 'PHP', 'MySQL', 'Responsive Design'],
  liveUrl: s.url,
  chapter: 'pansofia',
  timelinePosition: 0.44 + i * 0.002,
  presentation: {
    type: 'screenshot-motion',
    motionComponent: 'WebsiteMotion',
    concept:
      'A live capture of the real site inside a browser frame that auto-scrolls on hover, then peels apart into desktop / tablet / mobile viewports as the visitor drags across the gallery.',
    interaction: 'Hover to auto-scroll the page. Click to open the responsive breakdown. Drag the gallery horizontally.',
    duration: 8,
  },
  assets: {
    screenshots: [
      `/assets/client-work/${s.slug}-desktop.webp`,
      `/assets/client-work/${s.slug}-mobile.webp`,
    ],
    videos: [], models: [], textures: [], audio: [],
  },
  assetStatus: 'real',
  dataStatus: 'verified',
  privateSource: true,
  featured: s.importance === 'featured',
  accent: s.palette[0],
}))

/* The eight sites the Pansofia gallery shows, in the order it shows
   them. `clientProjects` above stays complete — it feeds the project
   inventory, the static profile and the world route. This is only the
   edit for the chapter, so the rail reads as a selection rather than
   a contact sheet. */
const gallerySlugs = [
  'pansofia',
  'bioever',
  'innova-urbis',
  'talento-profesional',
  'avanza-fp',
  'aula-impulsa',
  'escuela-de-hosteleria-canaria',
  'level-up-canarias',
]

export const featuredClientProjects: Project[] = gallerySlugs.flatMap((slug) => {
  const project = clientProjects.find((p) => p.slug === slug)
  if (!project) {
    // A rename upstream would otherwise drop a site from the gallery in silence.
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[client] gallery lists unknown slug: ${slug}`)
    }
    return []
  }
  return [project]
})

/** Palette lookup used by the gallery for per-site accenting. */
export const clientPalettes = Object.fromEntries(
  seeds.map((s) => [s.slug, s.palette]),
) as Record<string, [string, string, string]>
