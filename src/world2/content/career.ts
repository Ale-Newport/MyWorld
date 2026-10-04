import { education } from '@/content/education'
import { experience } from '@/content/experience'
import { heroProjects } from '@/content/projects'

/* ============================================================
   THE CAREER WALK, FROM THE PORTFOLIO'S OWN DATA

   The road, its four lanes, the stones, the label frame and the
   year plate are authored in folio-2025.blend. What runs ALONG
   them comes from the same files that feed the written portfolio
   — `src/content/education.ts`, `src/content/experience.ts` and
   `src/content/projects/*` — so the drive and the page can never
   disagree. Nothing is retyped here.

   Three tracks, one per lane, plus the year lane:

     education  what was being studied
     work       who was being worked for
     projects   what was being built

   Bruno's original pours one flat chronological list down the
   middle lane and gives the outer two to his long-running
   parallel threads. The shape is the same; the reading is by
   KIND rather than by which thread happened to be long.

   `Focus` is the one entry both `experience` and `projects`
   claim. It is a role with a real date range, so it runs on the
   work lane and the projects lane does not repeat it.
   ============================================================ */

export type TrackId = 'education' | 'work' | 'projects'

export interface CareerStop {
  id: string
  track: TrackId
  /**
   * The two lines the stone's label carries, and nothing else. Upstream's
   * labels are a name and a qualifier — "HETIC STUDENT" over "+5 YEARS
   * DIPLOMA" — read at driving speed from several metres away. Four lines of
   * title, employer, dates and a metric is a CV entry, not a road sign; the
   * dates are what the year plate beside the road is FOR.
   */
  headline: string
  subtitle: string
  /** The role, the degree, or the project. */
  title: string
  organisation: string
  /** As the portfolio writes them, not as this file computes them. */
  dates: string
  /** One short line: the result, or the thing that mattered. */
  note: string
  /** Months since year 0, so two tracks can share one time axis. */
  start: number
  end: number
  /**
   * True when the portfolio gives this stop a month range. A project carries
   * only a year, and the road must not imply a precision the data lacks.
   */
  dated: boolean
}

export interface CareerTrack {
  id: TrackId
  label: string
  /** The lane's neon line, its stone tip and its label highlight. */
  colour: string
  stops: CareerStop[]
}

/** `2026-09` and `2026-09-01` both mean the same month. */
const month = (iso: string): number => {
  const [year, part] = iso.split('-')
  return Number(year) * 12 + (Number(part ?? 1) - 1)
}
const yearOf = (value: number): number => Math.floor(value / 12)

/** "King's College London" is KCL on a road sign; the data already says so. */
const SHORT = new Map(education.map(item => [item.institution, item.shortName]))
const shortName = (organisation: string): string =>
  SHORT.get(organisation) ?? organisation.split(' / ')[0]

const educationStops: CareerStop[] = education.map(item => ({
  id: item.id,
  track: 'education' as const,
  headline: item.shortName,
  // `degreeLine` is the portfolio's own three-line setting of the degree:
  // the award, then what it is in. The road takes the first two.
  subtitle: `${item.degreeLine[0]} ${item.degreeLine[1]}`,
  title: item.degree,
  organisation: item.institution,
  dates: item.dates,
  note: item.result ?? item.location,
  start: month(item.start),
  end: month(item.end),
  dated: true,
}))

const workStops: CareerStop[] = experience.map(item => ({
  id: item.id,
  track: 'work' as const,
  headline: shortName(item.organisation),
  subtitle: item.role,
  title: item.role,
  organisation: item.organisation,
  dates: item.dates,
  note: item.metrics[0]
    ? `${item.metrics[0].value} ${item.metrics[0].label.toLowerCase()}`
    : item.summary.split('.')[0],
  start: month(item.start),
  end: month(item.end),
  dated: true,
}))

/*
  A project carries a year and nothing finer, so its stone covers that calendar
  year and its label says the year — no invented months. Only the portfolio's
  own hero projects get a stone: the inventory runs to forty-odd, and a
  seventeen-metre road is not a list.

  Two hero projects share 2026, and a year is one stretch of road: laid out
  naively they would stand on the same spot, one stone inside the other. A
  shared year is split evenly between the projects that share it, in the order
  the inventory lists them. That is a statement about the road, not about the
  work, which is why the label still says the year and nothing more.
*/
const projectSource = heroProjects.filter(project => !workStops.some(stop => stop.id === project.id))
const perYear = new Map<string, number>()
for (const project of projectSource) perYear.set(project.year, (perYear.get(project.year) ?? 0) + 1)
const placed = new Map<string, number>()

const projectStops: CareerStop[] = projectSource.map(project => {
  const share = perYear.get(project.year) ?? 1
  const index = placed.get(project.year) ?? 0
  placed.set(project.year, index + 1)
  const first = Number(project.year) * 12
  return {
    id: `project-${project.id}`,
    track: 'projects' as const,
    headline: project.shortTitle ?? project.title,
    subtitle: project.subcategory ?? project.category,
    title: project.shortTitle ?? project.title,
    organisation: project.subcategory ?? project.category,
    dates: project.year,
    note: project.shortDescription,
    start: first + Math.round((12 * index) / share),
    end: first + Math.round((12 * (index + 1)) / share) - 1,
    dated: false,
  }
})

export const CAREER_TRACKS: CareerTrack[] = [
  { id: 'education', label: 'Studies', colour: '#5390ff', stops: educationStops },
  { id: 'work', label: 'Work', colour: '#ff8039', stops: workStops },
  { id: 'projects', label: 'Projects', colour: '#b65fff', stops: projectStops },
].map(track => ({ ...track, stops: [...track.stops].sort((a, b) => a.start - b.start || a.end - b.end) })) as CareerTrack[]

/** Every stop on every lane, chronological. The awards count these. */
export const CAREER: CareerStop[] = CAREER_TRACKS
  .flatMap(track => track.stops)
  .sort((a, b) => a.start - b.start || a.end - b.end)

/** The shared time axis every lane is measured against. */
export const CAREER_FIRST_MONTH = Math.min(...CAREER.map(stop => stop.start))
export const CAREER_LAST_MONTH = Math.max(...CAREER.map(stop => stop.end))
export const CAREER_FIRST_YEAR = yearOf(CAREER_FIRST_MONTH)
export const CAREER_LAST_YEAR = yearOf(CAREER_LAST_MONTH)
