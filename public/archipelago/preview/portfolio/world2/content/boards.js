import { BOARD_PROJECTS, BOARD_EXPERIMENTS } from './projects.js';
export const BOARD_DEFAULTS = { projects: BOARD_PROJECTS, experiments: BOARD_EXPERIMENTS };
export const BOARD_MOTIONS = [
    'ChessMotion', 'StockMotion', 'ThreeBodyMotion', 'GymMotion', 'FocusMotion', 'VpnMotion', 'KeyframesMotion', 'LabyrinthMotion', 'PrimesMotion',
    'WebsiteMotion', 'CardsMotion', 'JobBoardMotion', 'VoxelMotion', 'LibraryMotion', 'DotsBoxesMotion', 'VideoPlayerMotion', 'TrainingMotion', 'CatanMotion', 'GenericProjectMotion',
];
const record = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export const boardImageSource = (value) => typeof value === 'string' && value.length <= 1500000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : undefined;
export function resolveBoard(value, kind) {
    const overrides = record(record(value)[kind]);
    return BOARD_DEFAULTS[kind].map(original => {
        const raw = record(overrides[original.id]), result = { ...original };
        for (const key of ['title', 'short', 'year', 'category', 'description', 'metric', 'linkLabel']) {
            if (typeof raw[key] === 'string')
                result[key] = raw[key].slice(0, key === 'description' ? 500 : 120);
        }
        if (result.metric === '' || raw.metric === null)
            result.metric = null;
        if (raw.link === null)
            result.link = null;
        if (raw.linkLabel === null)
            result.linkLabel = null;
        if (Array.isArray(raw.technologies))
            result.technologies = raw.technologies.filter((v) => typeof v === 'string').slice(0, 6).map(v => v.slice(0, 40));
        if (typeof raw.link === 'string')
            result.link = /^https?:\/\//i.test(raw.link) ? raw.link.slice(0, 2048) : null;
        if (typeof raw.motion === 'string' && BOARD_MOTIONS.includes(raw.motion))
            result.motion = raw.motion;
        result.image = boardImageSource(raw.image);
        return result;
    });
}
const images = new Map();
export function drawBoardImage(context, source, x, y, width, height, ready) {
    if (!source)
        return false;
    let image = images.get(source);
    if (!image) {
        image = new Image();
        images.set(source, image);
        if (images.size > 32)
            images.delete(images.keys().next().value);
        image.src = source;
    }
    if (!image.complete) {
        if (ready)
            image.onload = ready;
        return false;
    }
    if (!image.naturalWidth)
        return false;
    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
    context.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
    return true;
}
