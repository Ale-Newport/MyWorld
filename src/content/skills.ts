import type { TechNode } from './types'
import { projects } from './projects'

/* ============================================================
   TECH TOOLBOX
   Every technology links to the projects that provide evidence
   of use. `evidence` ids are validated against the project
   inventory at module load, so a typo or a deleted project
   fails loudly in development rather than silently claiming a
   skill with no backing.
   ============================================================ */

const raw: Omit<TechNode, 'weight'>[] = [
  /* ---- languages ---------------------------------------- */
  { id: 'python', name: 'Python', group: 'language', evidence: ['chess-assistant', 'cinquillo-fair', 'tappedin', 'orca', 'my-library', 'vpn', 'minecraft-seeds', 'focus'] },
  { id: 'typescript', name: 'TypeScript', group: 'language', evidence: ['keyframes', 'focus', 'events-app'] },
  { id: 'javascript', name: 'JavaScript', group: 'language', evidence: ['three-body', 'labyrinth', 'primes', 'cinquillo-web', 'dots-and-boxes', 'video-player', 'vpn-client', 'personal-web', 'ml-test'] },
  { id: 'java', name: 'Java', group: 'language', evidence: ['stock-market-simulator'] },
  { id: 'c', name: 'C / C++', group: 'language', evidence: ['minecraft-seeds', 'chess-assistant'] },
  { id: 'swift', name: 'Swift', group: 'language', evidence: ['gym-app'], note: 'Mobile client work — see CONTENT_STATUS.md' },
  { id: 'sql', name: 'SQL', group: 'language', evidence: ['keyframes', 'orca', 'tappedin', 'my-library'] },
  { id: 'html', name: 'HTML / CSS', group: 'language', evidence: ['personal-web', 'primes', 'cinquillo-web', 'ml-test', 'video-player'] },
  { id: 'scala', name: 'Scala', group: 'language', evidence: [], note: 'Studied at KCL; no public repository yet.' },
  { id: 'haskell', name: 'Haskell', group: 'language', evidence: [], note: 'Studied at KCL; no public repository yet.' },
  { id: 'prolog', name: 'Prolog', group: 'language', evidence: [], note: 'Studied at KCL; no public repository yet.' },
  { id: 'r', name: 'R', group: 'language', evidence: [], note: 'Used for statistical coursework.' },
  { id: 'ruby', name: 'Ruby', group: 'language', evidence: [], note: 'Working familiarity.' },
  { id: 'csharp', name: 'C#', group: 'language', evidence: [], note: 'Working familiarity.' },

  /* ---- frameworks --------------------------------------- */
  { id: 'react', name: 'React', group: 'framework', evidence: ['keyframes', 'robot-arm-portfolio', 'focus'] },
  { id: 'vue', name: 'Vue.js', group: 'framework', evidence: ['pokeappvue', 'ft2000-vue', 'vue-web'] },
  { id: 'django', name: 'Django', group: 'framework', evidence: ['tappedin', 'orca', 'my-library'] },
  { id: 'express', name: 'Express / Node', group: 'framework', evidence: ['keyframes'] },
  { id: 'threejs', name: 'Three.js / WebGL', group: 'framework', evidence: ['robot-arm-portfolio', 'gym-app'] },
  { id: 'javafx', name: 'JavaFX', group: 'framework', evidence: ['stock-market-simulator'] },
  { id: 'flask', name: 'Flask', group: 'framework', evidence: ['cinquillo-fair'] },
  { id: 'reactnative', name: 'React Native', group: 'framework', evidence: ['events-app'] },
  { id: 'laravel', name: 'Laravel', group: 'framework', evidence: ['pansofia', 'fuerteventura-2000', 'cht-canarias'], note: 'Client work — private repositories.' },
  { id: 'fastify', name: 'Fastify', group: 'framework', evidence: [], note: 'Used in client work; repositories are private.' },

  /* ---- AI / ML ------------------------------------------ */
  { id: 'tensorflow', name: 'TensorFlow / Keras', group: 'ai', evidence: ['chess-assistant'] },
  { id: 'deeplearning', name: 'Deep Learning', group: 'ai', evidence: ['chess-assistant', 'focus'] },
  { id: 'cv', name: 'Computer Vision', group: 'ai', evidence: ['chess-assistant'] },
  { id: 'nlp', name: 'NLP / RAG', group: 'ai', evidence: ['tappedin', 'focus'] },
  { id: 'rl', name: 'Reinforcement Learning', group: 'ai', evidence: ['cinquillo-fair'] },
  { id: 'mcts', name: 'Search & MCTS', group: 'ai', evidence: ['cinquillo-fair', 'labyrinth', 'catan-ai'] },
  { id: 'evaluation', name: 'Model Evaluation', group: 'ai', evidence: ['chess-assistant', 'cinquillo-fair'] },
  { id: 'features', name: 'Feature Engineering', group: 'ai', evidence: ['cinquillo-fair', 'tappedin'] },
  { id: 'spacy', name: 'spaCy', group: 'ai', evidence: ['tappedin'] },
  { id: 'opencv', name: 'OpenCV', group: 'ai', evidence: ['chess-assistant'] },

  /* ---- data --------------------------------------------- */
  { id: 'pandas', name: 'Pandas', group: 'data', evidence: ['cinquillo-fair'] },
  { id: 'numpy', name: 'NumPy', group: 'data', evidence: ['cinquillo-fair', 'chess-assistant'] },
  { id: 'eda', name: 'EDA & Statistics', group: 'data', evidence: ['cinquillo-fair'] },
  { id: 'postgres', name: 'PostgreSQL', group: 'data', evidence: ['keyframes', 'tappedin'] },
  { id: 'mysql', name: 'MySQL', group: 'data', evidence: ['pansofia', 'fuerteventura-2000'], note: 'Client work — private repositories.' },
  { id: 'sqlite', name: 'SQLite', group: 'data', evidence: ['keyframes', 'orca', 'my-library'] },
  { id: 'prisma', name: 'Prisma', group: 'data', evidence: ['keyframes'] },
  { id: 'mongo', name: 'MongoDB', group: 'data', evidence: [], note: 'Working familiarity.' },

  /* ---- cloud & infra ------------------------------------ */
  { id: 'aws', name: 'AWS EC2 / S3', group: 'cloud', evidence: ['chess-assistant'] },
  { id: 'docker', name: 'Docker', group: 'cloud', evidence: ['tappedin'] },
  { id: 'linux', name: 'Linux / Servers', group: 'cloud', evidence: ['vpn', 'pansofia'] },
  { id: 'azure', name: 'Azure', group: 'cloud', evidence: [], note: 'Working familiarity.' },
  { id: 'ci', name: 'CI / GitHub Actions', group: 'cloud', evidence: ['my-library'] },

  /* ---- tooling ------------------------------------------ */
  { id: 'git', name: 'Git / GitHub', group: 'tooling', evidence: ['keyframes', 'orca', 'tappedin', 'chess-assistant'] },
  { id: 'testing', name: 'Testing', group: 'tooling', evidence: ['orca', 'tappedin', 'cinquillo-fair', 'my-library'] },
  { id: 'concurrency', name: 'Concurrency', group: 'tooling', evidence: ['stock-market-simulator', 'vpn'] },
  { id: 'crypto', name: 'Cryptography', group: 'tooling', evidence: ['vpn', 'vpn-client'] },
  { id: 'vite', name: 'Vite', group: 'tooling', evidence: ['keyframes', 'pokeappvue', 'robot-arm-portfolio'] },
  { id: 'maven', name: 'Maven', group: 'tooling', evidence: ['stock-market-simulator'] },
]

const validIds = new Set(projects.map((p) => p.id))

export const techNodes: TechNode[] = raw.map((n) => {
  if (process.env.NODE_ENV === 'development') {
    const bad = n.evidence.filter((e) => !validIds.has(e))
    if (bad.length) {
      console.warn(`[skills] "${n.name}" cites unknown project id(s): ${bad.join(', ')}`)
    }
  }
  const evidence = n.evidence.filter((e) => validIds.has(e))
  return {
    ...n,
    evidence,
    weight: evidence.length >= 5 ? 3 : evidence.length >= 2 ? 2 : 1,
  }
})

export const techById = Object.fromEntries(techNodes.map((t) => [t.id, t]))

export const techGroups = [
  { id: 'language', label: 'Languages' },
  { id: 'framework', label: 'Frameworks' },
  { id: 'ai', label: 'AI / ML' },
  { id: 'data', label: 'Data' },
  { id: 'cloud', label: 'Cloud & Infra' },
  { id: 'tooling', label: 'Tooling' },
] as const

/** Reverse index: project id → technology ids. */
export const techByProject: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {}
  for (const t of techNodes) for (const p of t.evidence) (out[p] ??= []).push(t.id)
  return out
})()
