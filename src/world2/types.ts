export type Vec3 = [number, number, number]
export type Classification = 'terrain' | 'roads' | 'scenery' | 'vegetation' | 'water'
export interface SourceBounds { min: Vec3; max: Vec3; vertices: number; triangles: number }
export interface World2Manifest {
  version: number
  source: string
  sourceSha256: string
  scale: number
  models: string[]
  bounds: SourceBounds
  spawn: string
  spawns: { name: string; position: Vec3; rotation: number }[]
  areas: { name: string; anchor: string; zone: string | null }[]
  roadPaths: { name: string; closed: boolean; points: Vec3[] }[]
  treeCounts: Record<string, number>
  waterLevel: number
  stats: { coreObjects: number; vegetationObjects: number; colliderHelpers: number; triangles: number }
  validationBounds: Record<string, SourceBounds>
}
/** Everything the HUD needs to draw the gameplay layer, recomputed per publish. */
export interface World2Gameplay {
  /** The activity that currently owns the car, or null while free-roaming. */
  activity: string | null
  /** Large centred text: a countdown beat, FINISH, STRIKE. */
  headline: string | null
  /** MM:SS:MMM while a race is timed. */
  timer: string | null
  /** Short supporting lines under the headline. */
  lines: string[]
  /** Label of the world prompt in range, for the touch button. */
  prompt: string | null
  notice: { title: string; body: string } | null
  achievementsUnlocked: number
  achievementsTotal: number
  cratesLeft: number
  /** Populated only while the achievements panel is open. */
  achievements: { id: string; title: string; description: string; progress: number; target: number; unlocked: boolean }[]
}

export const EMPTY_GAMEPLAY: World2Gameplay = {
  activity: null, headline: null, timer: null, lines: [], prompt: null, notice: null,
  achievementsUnlocked: 0, achievementsTotal: 0, cratesLeft: 0, achievements: [],
}

export interface World2Status {
  ready: boolean
  progress: number
  loading: string
  fatal: string | null
  entered: boolean
  paused: boolean
  map: boolean
  help: boolean
  muted: boolean
  touch: boolean
  speed: number
  area: string
  interaction: string | null
  achievementsOpen: boolean
  topDown: boolean
  colliders: boolean
  fps: number
  drawCalls: number
  position: Vec3
  heading: number
  gameplay: World2Gameplay
}
