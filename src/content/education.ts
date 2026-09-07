import type { DataStatus } from './types'

export interface Module {
  name: string
  /** Visual metaphor key used by the KCL / UCL scenes. */
  visual: 'graph' | 'tree' | 'schedule' | 'cipher' | 'modules' | 'matrix' | 'network' | 'mining' | 'verify' | 'stats'
  blurb: string
}

export interface Education {
  id: string
  institution: string
  shortName: string
  degree: string
  degreeLine: string[]
  result?: string
  dates: string
  start: string
  end: string
  location: string
  modules: Module[]
  dataStatus: DataStatus
}

export const education: Education[] = [
  {
    id: 'ucl',
    institution: 'University College London',
    shortName: 'UCL',
    degree: 'MSc Artificial Intelligence and Data Engineering',
    degreeLine: ['MSc', 'ARTIFICIAL INTELLIGENCE', '& DATA ENGINEERING'],
    dates: 'Sep 2026 – Sep 2027',
    start: '2026-09',
    end: '2027-09',
    location: 'London, UK',
    dataStatus: 'verified',
    modules: [
      { name: 'Machine Learning', visual: 'matrix', blurb: 'Statistical learning, optimisation, generalisation.' },
      { name: 'Applied Deep Learning', visual: 'network', blurb: 'Architectures, training regimes, representation.' },
      { name: 'Data Analysis', visual: 'stats', blurb: 'Inference, experiment design, uncertainty.' },
      { name: 'Data Mining', visual: 'mining', blurb: 'Pattern discovery at scale.' },
      { name: 'Validation and Verification', visual: 'verify', blurb: 'Proving systems behave as specified.' },
    ],
  },
  {
    id: 'kcl',
    institution: "King's College London",
    shortName: 'KCL',
    degree: 'BSc Computer Science (Software Engineering)',
    degreeLine: ['BSc', 'COMPUTER SCIENCE', 'SOFTWARE ENGINEERING'],
    result: 'First Class Honours',
    dates: 'Sep 2023 – Jun 2026',
    start: '2023-09',
    end: '2026-06',
    location: 'London, UK',
    dataStatus: 'verified',
    modules: [
      { name: 'Data Structures', visual: 'graph', blurb: 'Nodes, edges, invariants, cost.' },
      { name: 'Database Systems', visual: 'tree', blurb: 'Relational algebra, indexing, transactions.' },
      { name: 'Operating Systems', visual: 'schedule', blurb: 'Processes, scheduling, memory, concurrency.' },
      { name: 'Cryptography', visual: 'cipher', blurb: 'Transformation, keys, guarantees.' },
      { name: 'Software Engineering', visual: 'modules', blurb: 'Modules assembling into one system.' },
    ],
  },
]

export interface Credential {
  id: string
  title: string
  issuer: string
  note: string
  dataStatus: DataStatus
}

/** Smaller learning milestones — deliberately not weighted like a degree. */
export const credentials: Credential[] = [
  {
    id: 'cs50',
    title: 'CS50',
    issuer: 'Harvard University',
    note: 'Introduction to Computer Science',
    dataStatus: 'verified',
  },
  {
    id: 'cs50ai',
    title: 'Artificial Intelligence with Python',
    issuer: 'Harvard University',
    note: 'Search, knowledge, optimisation, learning, neural networks',
    dataStatus: 'verified',
  },
]

export const educationById = Object.fromEntries(education.map((e) => [e.id, e]))
