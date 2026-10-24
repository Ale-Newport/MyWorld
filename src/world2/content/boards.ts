import { BOARD_PROJECTS, BOARD_EXPERIMENTS, type BoardProject } from './projects'

export type BoardKind = 'projects' | 'experiments'
export const BOARD_DEFAULTS = { projects: BOARD_PROJECTS, experiments: BOARD_EXPERIMENTS }
/** The small pictures a board can carry: every motion component a project can name. The first nine are the original CMS list; stored overrides refer to them by name only. */
export const BOARD_MOTIONS = [
  'ChessMotion', 'StockMotion', 'ThreeBodyMotion', 'GymMotion', 'FocusMotion', 'VpnMotion', 'KeyframesMotion', 'LabyrinthMotion', 'PrimesMotion',
  'WebsiteMotion', 'CardsMotion', 'JobBoardMotion', 'VoxelMotion', 'LibraryMotion', 'DotsBoxesMotion', 'VideoPlayerMotion', 'TrainingMotion', 'CatanMotion', 'GenericProjectMotion',
]
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
export const boardImageSource = (value: unknown): string | undefined => typeof value === 'string' && value.length <= 1_500_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : undefined

/** Overrides live in the world's root metadata, so draft, history and publication stay atomic. */
export function resolveBoard(value: unknown, kind: BoardKind): BoardProject[] {
  const overrides = record(record(value)[kind])
  return BOARD_DEFAULTS[kind].map(original => {
    const raw = record(overrides[original.id]), result = { ...original }
    for (const key of ['title', 'short', 'year', 'category', 'description', 'metric', 'linkLabel'] as const) {
      if (typeof raw[key] === 'string') result[key] = (raw[key] as string).slice(0, key === 'description' ? 500 : 120)
    }
    if (result.metric === '' || raw.metric === null) result.metric = null
    if (raw.link === null) result.link = null
    if (raw.linkLabel === null) result.linkLabel = null
    if (Array.isArray(raw.technologies)) result.technologies = raw.technologies.filter((v): v is string => typeof v === 'string').slice(0, 6).map(v => v.slice(0, 40))
    if (typeof raw.link === 'string') result.link = /^https?:\/\//i.test(raw.link) ? raw.link.slice(0, 2048) : null
    if (typeof raw.motion === 'string' && BOARD_MOTIONS.includes(raw.motion)) result.motion = raw.motion
    result.image = boardImageSource(raw.image)
    return result
  })
}

const images = new Map<string, HTMLImageElement>()
export function drawBoardImage(context: CanvasRenderingContext2D, source: string | undefined, x: number, y: number, width: number, height: number, ready?: () => void): boolean {
  if (!source) return false
  let image = images.get(source)
  if (!image) {
    image = new Image()
    images.set(source, image)
    if (images.size > 32) images.delete(images.keys().next().value!)
    image.src = source
  }
  if (!image.complete) { if (ready) image.onload = ready; return false }
  if (!image.naturalWidth) return false
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight)
  const w = image.naturalWidth * scale, h = image.naturalHeight * scale
  context.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h)
  return true
}
