import { drawBoardImage } from '../content/boards.js';
import { EMBLEM_SIZE, TOKENS, drawFit, fitText, paintEmblem, paintParchment, paintRibbon, paintTag, paintWood, roundRect, signFonts, themeForProject, } from '../signs/index.js';
export const FACE_W = 1024;
export const FACE_H = 576;
export const PLATE_H = 154;
export const LINK_PLANE = 2.2;
export const BOARD_H = PLATE_H + FACE_H;
export const EMBLEM_RECT = { x: 640, y: 66, size: 336 };
const hostOf = (link) => link.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
const trimmed = (text) => String(text ?? '').trim();
export const cleanTechs = (project) => project.technologies.map(trimmed).filter(Boolean);
export const projectLinkLabel = (project) => project.link ? hostOf(project.link) : 'Private source';
export const emblemKindFor = (project) => themeForProject(project).emblem;
export function paintProjectEmblem(context, size, project, time) {
    paintEmblem(context, emblemKindFor(project) ?? 'rings', size, time, project.id);
}
export function paintProjectFace(context, width, height, project, options = {}) {
    const fonts = signFonts();
    const theme = themeForProject(project);
    const scale = Math.min(width / FACE_W, height / FACE_H);
    context.save();
    context.fillStyle = TOKENS.paperDeep;
    context.fillRect(0, 0, width, height);
    context.translate((width - FACE_W * scale) / 2, (height - FACE_H * scale) / 2);
    context.scale(scale, scale);
    paintParchment(context, { x: 0, y: 0, w: FACE_W, h: FACE_H }, { seed: 'face', radius: 14 });
    const left = 64, right = 600, columnWidth = right - left;
    const kicker = [project.category, project.year].map(trimmed).filter(Boolean).join(' · ').toUpperCase();
    if (kicker) {
        const kickerFit = fitText(context, kicker, { maxWidth: columnWidth - 80, minPx: 20, maxPx: 26, weight: 600, family: fonts.mono, lineHeight: 1 });
        const ribbonWidth = Math.min(columnWidth, context.measureText(kickerFit.lines[0] ?? '').width + 76);
        paintRibbon(context, { x: left - 14, y: 50, w: ribbonWidth, h: 50 }, theme.ribbon, theme.ribbonDeep);
        context.fillStyle = theme.ribbonInk;
        drawFit(context, kickerFit, left - 14 + ribbonWidth / 2, 50 + 25 - kickerFit.px / 2, 'center');
    }
    const metric = trimmed(project.metric);
    const metricTop = 116, metricHeight = 70;
    const tagsTop = 490;
    const descTop = metric ? metricTop + metricHeight + 18 : 124;
    if (metric)
        paintMedalLine(context, metric, left, metricTop, columnWidth, metricHeight, fonts.sans, theme.accent);
    const description = fitText(context, project.description, {
        maxWidth: columnWidth, maxLines: 10, maxHeight: tagsTop - 18 - descTop, minPx: 22, maxPx: 48, weight: 500, family: fonts.sans, lineHeight: 1.28,
    });
    context.fillStyle = TOKENS.ink2;
    drawFit(context, description, left, descTop, 'left');
    let x = left;
    const techs = cleanTechs(project);
    for (let i = 0; i < techs.length; i++) {
        const room = right - x;
        context.font = `600 20px ${fonts.mono}`;
        const tagWidth = context.measureText(techs[i]).width + 36;
        const more = techs.length - i;
        if (tagWidth > room) {
            if (i > 0)
                paintTag(context, `+${more}`, x, tagsTop, 40, fonts, { fill: TOKENS.copper, ink: TOKENS.ink, px: 20 });
            else
                paintTag(context, techs[i].slice(0, 14) + '…', x, tagsTop, 40, fonts, { px: 20 });
            break;
        }
        x += paintTag(context, techs[i], x, tagsTop, 40, fonts, { px: 20 }) + 10;
    }
    const m = EMBLEM_RECT;
    paintWood(context, { x: m.x - 16, y: m.y - 16, w: m.size + 32, h: m.size + 32 }, { seed: 'mat', base: TOKENS.woodDark, grain: 0.35, knots: 0 });
    context.fillStyle = TOKENS.paper;
    context.fillRect(m.x, m.y, m.size, m.size);
    if (project.image) {
        context.fillStyle = TOKENS.paperHi;
        context.fillRect(m.x, m.y, m.size, m.size);
        drawBoardImage(context, project.image, m.x + 10, m.y + 10, m.size - 20, m.size - 20, options.ready);
    }
    context.strokeStyle = 'rgba(26,23,18,0.55)';
    context.lineWidth = 3;
    context.strokeRect(m.x, m.y, m.size, m.size);
    const statusY = m.y + m.size + 40;
    paintTag(context, project.link ? 'OPEN TO VISIT  ↗' : 'PRIVATE SOURCE', m.x - 16, statusY, 42, fonts, { fill: project.link ? theme.ribbon : TOKENS.woodDeep, ink: theme.ribbonInk, px: 20 });
    if (options.index !== undefined && options.total) {
        const label = `${String(options.index + 1).padStart(2, '0')}`;
        context.textBaseline = 'alphabetic';
        context.textAlign = 'right';
        context.fillStyle = TOKENS.ink;
        context.font = `700 54px ${fonts.sans}`;
        const total = ` / ${String(options.total).padStart(2, '0')}`;
        context.font = `500 26px ${fonts.mono}`;
        const totalWidth = context.measureText(total).width;
        context.fillStyle = TOKENS.ink3;
        context.fillText(total, m.x + m.size + 16, statusY + 86);
        context.font = `700 54px ${fonts.sans}`;
        context.fillStyle = TOKENS.ink;
        context.fillText(label, m.x + m.size + 16 - totalWidth, statusY + 86);
    }
    context.restore();
    return { description, scale };
}
function paintMedalLine(c, text, x, y, width, height, family, accent) {
    c.save();
    c.translate(x + width / 2, y + height / 2);
    c.rotate(-0.018);
    c.translate(-width / 2, -height / 2);
    c.fillStyle = 'rgba(248,236,208,0.65)';
    roundRect(c, 0, 0, width, height, 10);
    c.fill();
    c.strokeStyle = accent;
    c.lineWidth = 3;
    roundRect(c, 1.5, 1.5, width - 3, height - 3, 10);
    c.stroke();
    c.lineWidth = 1.2;
    roundRect(c, 7, 7, width - 14, height - 14, 6);
    c.stroke();
    const r = 22, cx = 44, cy = height / 2;
    c.fillStyle = TOKENS.gold;
    c.beginPath();
    for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2, rr = i % 2 ? r * 0.82 : r;
        c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    c.closePath();
    c.fill();
    c.strokeStyle = '#a9790a';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = '#a9790a';
    c.font = `700 16px ${family}`;
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.fillText('★', cx, cy + 6);
    const fit = fitText(c, text, { maxWidth: width - 104, maxLines: 2, maxHeight: height - 16, minPx: 20, maxPx: 34, weight: 700, family, lineHeight: 1.12 });
    c.fillStyle = TOKENS.ink;
    drawFit(c, fit, 84, (height - fit.height) / 2, 'left');
    c.restore();
}
export function paintProjectScreen(context, width, height, project, time, ready, position) {
    paintProjectFace(context, width, height, project, { ready, index: position?.index, total: position?.total });
    if (project.image)
        return;
    const scale = Math.min(width / FACE_W, height / FACE_H);
    context.save();
    context.translate((width - FACE_W * scale) / 2 + EMBLEM_RECT.x * scale, (height - FACE_H * scale) / 2 + EMBLEM_RECT.y * scale);
    context.beginPath();
    context.rect(0, 0, EMBLEM_RECT.size * scale, EMBLEM_RECT.size * scale);
    context.clip();
    paintProjectEmblem(context, EMBLEM_RECT.size * scale, project, time);
    context.restore();
}
export function paintTitlePlate(context, width, height, project) {
    const fonts = signFonts();
    paintWood(context, { x: 0, y: 0, w: width, h: height }, { seed: 'title-plate', base: TOKENS.woodDark, grain: 0.7, nails: true });
    const padX = width * 0.04;
    const fit = fitText(context, trimmed(project.title), {
        maxWidth: width - padX * 2, maxLines: 2, maxHeight: height * 0.96, minPx: height * 0.2, maxPx: height * 0.94, weight: 700, family: fonts.sans, lineHeight: 1.02,
    });
    const top = (height - fit.height) / 2;
    context.save();
    context.beginPath();
    context.rect(0, 0, width, height);
    context.clip();
    context.fillStyle = 'rgba(0,0,0,0.35)';
    drawFit(context, fit, width / 2 + height * 0.012, top + height * 0.014, 'center');
    context.fillStyle = TOKENS.cream;
    drawFit(context, fit, width / 2, top, 'center');
    context.restore();
    return fit;
}
const compactLink = (label) => {
    const parts = label.split('/').filter(Boolean);
    return parts.length > 2 ? `${parts[0]}/…/${parts[parts.length - 1]}` : label;
};
export function fitLinkStrip(context, width, height, project) {
    const fonts = signFonts();
    const label = projectLinkLabel(project);
    const options = { maxWidth: width * 0.9, minPx: height * 0.3, maxPx: height * 0.62, weight: 600, family: fonts.mono, lineHeight: 1 };
    let fit = fitText(context, label, options);
    if (fit.truncated) {
        const compact = compactLink(label);
        if (compact !== label)
            fit = fitText(context, compact, options);
    }
    context.font = fit.font;
    return { fit, textWidth: context.measureText(fit.lines[0] ?? '').width };
}
export function paintLinkStrip(context, width, height, project, fitted) {
    const { fit, textWidth } = fitted ?? fitLinkStrip(context, width, height, project);
    context.fillStyle = project.link ? TOKENS.cream : TOKENS.chalk;
    drawFit(context, fit, width / 2, (height - fit.height) / 2, 'center');
    return textWidth;
}
function paintLinkChip(context, centreX, plateBottom, project) {
    const metre = FACE_W / 4;
    const stripW = LINK_PLANE * metre, stripH = 0.2 * metre;
    const fitted = fitLinkStrip(context, stripW, stripH, project);
    const { textWidth } = fitted;
    const chipW = Math.max(0.35, (textWidth / stripW) * LINK_PLANE + 0.2) * metre, chipH = 0.24 * metre;
    const x = centreX - chipW / 2, y = plateBottom - chipH * 0.55;
    context.save();
    context.shadowColor = 'rgba(0,0,0,0.35)';
    context.shadowBlur = 8;
    context.shadowOffsetY = 3;
    paintWood(context, { x, y, w: chipW, h: chipH }, { seed: 'url-chip', base: TOKENS.woodDark, grain: 0.5, knots: 0 });
    context.restore();
    context.save();
    context.translate(x + (chipW - stripW) / 2, y + (chipH - stripH) / 2);
    paintLinkStrip(context, stripW, stripH, project, fitted);
    context.restore();
}
export function paintProjectBoard(context, width, height, project, time, ready, position) {
    const scale = Math.min(width / FACE_W, height / BOARD_H);
    const ox = (width - FACE_W * scale) / 2, oy = (height - BOARD_H * scale) / 2;
    context.save();
    context.fillStyle = TOKENS.paperDeep;
    context.fillRect(0, 0, width, height);
    context.save();
    context.translate(ox, oy + PLATE_H * scale);
    paintProjectScreen(context, FACE_W * scale, FACE_H * scale, project, time, ready, position);
    context.restore();
    context.save();
    context.translate(ox, oy);
    context.scale(scale, scale);
    paintTitlePlate(context, FACE_W, PLATE_H, project);
    paintLinkChip(context, FACE_W / 2, PLATE_H, project);
    context.restore();
    context.restore();
}
function tag(context, width, height) {
    context.save();
    context.shadowColor = 'rgba(0,0,0,0.3)';
    context.shadowBlur = height * 0.04;
    context.shadowOffsetY = height * 0.02;
    paintParchment(context, { x: height * 0.03, y: height * 0.03, w: width - height * 0.06, h: height - height * 0.06 }, { seed: 'tag', radius: height * 0.09, rule: false, burn: 0.35 });
    context.restore();
}
export function paintNeighbour(context, width, height, which, project) {
    const fonts = signFonts();
    tag(context, width, height);
    const pad = width * 0.09;
    const kicker = which === 'previous' ? '◀ PREVIOUS' : 'NEXT ▶';
    const kickerFit = fitText(context, kicker, { maxWidth: width - pad * 2, minPx: height * 0.09, maxPx: height * 0.13, weight: 600, family: fonts.mono, lineHeight: 1 });
    context.fillStyle = TOKENS.ink2;
    drawFit(context, kickerFit, width / 2, height * 0.12, 'center');
    const nameTop = height * 0.12 + kickerFit.height + height * 0.05;
    const fit = fitText(context, project.short, { maxWidth: width - pad * 2, maxLines: 3, maxHeight: height * 0.9 - nameTop, minPx: height * 0.11, maxPx: height * 0.27, weight: 700, family: fonts.sans, lineHeight: 1.08 });
    context.fillStyle = TOKENS.ink;
    drawFit(context, fit, width / 2, nameTop + (height * 0.9 - nameTop - fit.height) / 2, 'center');
}
export function paintAttribute(context, width, height, role, project) {
    const fonts = signFonts();
    tag(context, width, height);
    const pad = width * 0.07;
    const label = role === 'category' ? 'CATEGORY' : role === 'year' ? 'YEAR' : 'STACK';
    const labelFit = fitText(context, label, { maxWidth: width - pad * 2, minPx: height * 0.13, maxPx: height * 0.2, weight: 600, family: fonts.mono, lineHeight: 1 });
    context.fillStyle = TOKENS.ink2;
    drawFit(context, labelFit, pad, height * 0.13, 'left');
    const value = trimmed(role === 'category' ? project.category : role === 'year' ? project.year : cleanTechs(project).slice(0, 3).join(' · ')) || '—';
    const top = height * 0.13 + labelFit.height + height * 0.04;
    const fit = fitText(context, value, { maxWidth: width - pad * 2, maxLines: role === 'stack' ? 2 : 1, maxHeight: height * 0.88 - top, minPx: height * 0.14, maxPx: height * 0.4, weight: 700, family: fonts.sans, lineHeight: 1.1 });
    context.fillStyle = TOKENS.ink;
    drawFit(context, fit, pad, top + (height * 0.88 - top - fit.height) / 2, 'left');
}
export function prefitSteps(project, previous, next, sizes) {
    const steps = [context => { paintProjectFace(context, FACE_W, FACE_H, project); }];
    const { title, link } = sizes;
    if (title)
        steps.push(context => { paintTitlePlate(context, title[0], title[1], project); });
    if (link)
        steps.push(context => { paintLinkStrip(context, link[0], link[1], project); });
    if (sizes.previous)
        steps.push(context => paintNeighbour(context, sizes.previous[0], sizes.previous[1], 'previous', previous));
    if (sizes.next)
        steps.push(context => paintNeighbour(context, sizes.next[0], sizes.next[1], 'next', next));
    for (const role of ['category', 'year', 'stack']) {
        const size = sizes[role];
        if (size)
            steps.push(context => paintAttribute(context, size[0], size[1], role, project));
    }
    return steps;
}
export { EMBLEM_SIZE };
