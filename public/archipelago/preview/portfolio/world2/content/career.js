import { education } from '../../content/education.js';
import { experience } from '../../content/experience.js';
import { heroProjects } from '../../content/projects/index.js';
/** `2026-09` and `2026-09-01` both mean the same month. */
const month = (iso) => {
    const [year, part] = iso.split('-');
    return Number(year) * 12 + (Number(part ?? 1) - 1);
};
const yearOf = (value) => Math.floor(value / 12);
/** "King's College London" is KCL on a road sign; the data already says so. */
const SHORT = new Map(education.map(item => [item.institution, item.shortName]));
const shortName = (organisation) => SHORT.get(organisation) ?? organisation.split(' / ')[0];
const educationStops = education.map(item => ({
    id: item.id,
    track: 'education',
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
}));
const workStops = experience.map(item => ({
    id: item.id,
    track: 'work',
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
}));
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
const projectSource = heroProjects.filter(project => !workStops.some(stop => stop.id === project.id));
const perYear = new Map();
for (const project of projectSource)
    perYear.set(project.year, (perYear.get(project.year) ?? 0) + 1);
const placed = new Map();
const projectStops = projectSource.map(project => {
    const share = perYear.get(project.year) ?? 1;
    const index = placed.get(project.year) ?? 0;
    placed.set(project.year, index + 1);
    const first = Number(project.year) * 12;
    return {
        id: `project-${project.id}`,
        track: 'projects',
        headline: project.shortTitle ?? project.title,
        subtitle: project.subcategory ?? project.category,
        title: project.shortTitle ?? project.title,
        organisation: project.subcategory ?? project.category,
        dates: project.year,
        note: project.shortDescription,
        start: first + Math.round((12 * index) / share),
        end: first + Math.round((12 * (index + 1)) / share) - 1,
        dated: false,
    };
});
export const CAREER_TRACKS = [
    { id: 'education', label: 'Studies', colour: '#5390ff', stops: educationStops },
    { id: 'work', label: 'Work', colour: '#ff8039', stops: workStops },
    { id: 'projects', label: 'Projects', colour: '#b65fff', stops: projectStops },
].map(track => ({ ...track, stops: [...track.stops].sort((a, b) => a.start - b.start || a.end - b.end) }));
/** Every stop on every lane, chronological. The awards count these. */
export const CAREER = CAREER_TRACKS
    .flatMap(track => track.stops)
    .sort((a, b) => a.start - b.start || a.end - b.end);
/** The shared time axis every lane is measured against. */
export const CAREER_FIRST_MONTH = Math.min(...CAREER.map(stop => stop.start));
export const CAREER_LAST_MONTH = Math.max(...CAREER.map(stop => stop.end));
export const CAREER_FIRST_YEAR = yearOf(CAREER_FIRST_MONTH);
export const CAREER_LAST_YEAR = yearOf(CAREER_LAST_MONTH);
