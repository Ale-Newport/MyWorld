import { projects } from '../../content/projects/index.js';
const CATEGORY = {
    'ai-ml': 'AI / ML',
    software: 'Software',
    web: 'Web',
    mobile: 'Mobile',
    '3d': '3D',
    data: 'Data',
    university: 'University',
    experiment: 'Experiment',
    'client-work': 'Client work',
};
function toBoard(project) {
    const metric = project.metrics[0];
    return {
        id: project.id,
        title: project.title,
        short: (project.shortTitle ?? project.title).toUpperCase(),
        year: project.year,
        category: CATEGORY[project.category] ?? project.category,
        description: project.shortDescription,
        metric: metric ? `${metric.value} ${metric.label.toLowerCase()}` : null,
        technologies: project.technologies.slice(0, 6),
        link: project.liveUrl ?? project.repository ?? null,
        linkLabel: project.liveUrl ? 'Live' : project.repository ? 'Repository' : null,
        motion: project.presentation.motionComponent,
    };
}
/**
 * The board's running order: the strongest work first, then the rest of the
 * inventory, so the attract cycle opens on something worth stopping for.
 */
export const BOARD_PROJECTS = [
    ...projects.filter(p => p.importance === 'hero'),
    ...projects.filter(p => p.importance === 'featured'),
    ...projects.filter(p => p.importance === 'archive'),
].map(toBoard);
/**
 * How many of the run are strong enough to put up unattended. The attract
 * cycle stays inside this prefix; stepping by hand reaches everything.
 */
export const BOARD_FEATURED_COUNT = projects.filter(p => p.importance === 'hero' || p.importance === 'featured').length;
/** The labels the authored wooden signs carry, in board order. */
export const BOARD_SHORT_TITLES = BOARD_PROJECTS.map(project => project.short);
