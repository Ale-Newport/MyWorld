import { BOARD_PROJECTS, BOARD_EXPERIMENTS } from './projects.js';
export const BOARD_DEFAULTS = { projects: BOARD_PROJECTS, experiments: BOARD_EXPERIMENTS };
export const BOARD_MOTIONS = ['ChessMotion', 'StockMotion', 'ThreeBodyMotion', 'GymMotion', 'FocusMotion', 'VpnMotion', 'KeyframesMotion', 'LabyrinthMotion', 'PrimesMotion'];
const record = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export const boardImageSource = (value) => typeof value === 'string' && value.length <= 1500000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : undefined;
/** Overrides live in the world's root metadata, so draft, history and publication stay atomic. */
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
export function paintExperiment(context, project, index, total, ready) {
    context.fillStyle = '#12141b';
    context.fillRect(0, 0, 1024, 512);
    context.textAlign = 'left';
    const textWidth = project.image ? 540 : 936;
    if (project.image)
        drawBoardImage(context, project.image, 622, 100, 360, 340, ready);
    context.fillStyle = '#5390ff';
    context.font = '700 30px system-ui';
    context.fillText(`EXPERIMENT ${index + 1} / ${total}`, 44, 74);
    context.fillStyle = '#f4f1e8';
    context.font = '700 54px system-ui';
    context.fillText(project.title, 44, 150, textWidth);
    context.fillStyle = '#8f8aa0';
    context.font = '500 28px system-ui';
    const words = project.description.split(/\s+/);
    let line = '', y = 210;
    for (const word of words) {
        if (line && context.measureText(`${line} ${word}`).width > textWidth) {
            context.fillText(line, 44, y, textWidth);
            y += 38;
            line = '';
            if (y > 324) {
                line = '…';
                break;
            }
        }
        line += `${line ? ' ' : ''}${word}`;
    }
    context.fillText(line, 44, y, textWidth);
    context.fillStyle = '#32ffc1';
    context.font = '600 26px monospace';
    context.fillText(project.technologies.slice(0, 5).join(' · '), 44, 400, textWidth);
    context.fillStyle = '#8f8aa0';
    context.fillText(project.year, 44, 452, textWidth);
}
