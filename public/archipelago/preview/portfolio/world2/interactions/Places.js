import * as THREE from 'three';
import { Screen } from './Screen.js';
import { Billboards, MAP_HIDDEN_LAYER } from './Billboards.js';
import { orientForMesh } from './bindCanvas.js';
import { projects } from '../../content/projects/index.js';
import { resolveBoard, drawBoardImage } from '../content/boards.js';
import { FACE_H, FACE_W, LINK_PLANE, emblemKindFor, paintProjectEmblem } from './screenMotion.js';
import { profile } from '../../content/profile.js';
import { EMBLEM_SIZE, FACE_EMISSIVE, SIGN_DESIGN, SIGN_THEMES, STATIC_TIME, SWATCH, TOKENS, Facets, Sign, SignRuntime, addTube, bindLayer, bracketGeometry, charmGeometry, drawFit, faceFrame, fitText, hashSeed, mergeParts, nailGeometry, paintNumeral, paintParchment, paintRibbon, paintTag, paintWood, pegGeometry, onSignFontsLoaded, place, planeSize, recolorPalette, ropeGeometry, signFonts, signMaterials, themeForProject, vineGeometry, } from '../signs/index.js';
const trimmed = (text) => String(text ?? '').trim();
function paintFlask(c, cx, cy, s, liquid) {
    c.save();
    c.translate(cx, cy);
    c.lineJoin = 'round';
    const belly = s * 0.3, bellyY = s * 0.15;
    c.beginPath();
    c.moveTo(-s * 0.075, -s * 0.38);
    c.lineTo(-s * 0.075, bellyY - belly * 0.93);
    c.arc(0, bellyY, belly, -Math.PI * 0.59, Math.PI * 1.59);
    c.lineTo(s * 0.075, -s * 0.38);
    c.closePath();
    c.save();
    c.clip();
    c.fillStyle = 'rgba(246,240,230,0.18)';
    c.fillRect(-s, -s, s * 2, s * 2);
    c.fillStyle = liquid;
    c.fillRect(-s, bellyY - belly * 0.12, s * 2, s);
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.fillRect(-belly * 0.62, bellyY - belly * 0.5, belly * 0.18, belly * 0.8);
    c.restore();
    c.strokeStyle = TOKENS.cream;
    c.lineWidth = Math.max(2, s * 0.045);
    c.stroke();
    c.fillStyle = TOKENS.woodMid;
    c.fillRect(-s * 0.115, -s * 0.46, s * 0.23, s * 0.1);
    c.restore();
}
export function paintLabPlate(context, width, height) {
    const fonts = signFonts();
    paintWood(context, { x: 0, y: 0, w: width, h: height }, { seed: 'lab-plate', base: TOKENS.woodDark, grain: 0.7, nails: true });
    const fit = fitText(context, 'THE LAB', { maxWidth: width * 0.5, minPx: height * 0.3, maxPx: height * 0.68, weight: 800, family: fonts.sans, lineHeight: 1 });
    const textWidth = context.measureText(fit.lines[0] ?? '').width;
    const top = (height - fit.height) / 2;
    context.save();
    context.beginPath();
    context.rect(0, 0, width, height);
    context.clip();
    context.fillStyle = 'rgba(0,0,0,0.35)';
    drawFit(context, fit, width / 2 + height * 0.012, top + height * 0.016, 'center');
    context.fillStyle = TOKENS.cream;
    drawFit(context, fit, width / 2, top, 'center');
    const reach = textWidth / 2 + height * 0.62;
    paintFlask(context, width / 2 - reach, height * 0.52, height * 0.66, TOKENS.gold);
    paintFlask(context, width / 2 + reach, height * 0.52, height * 0.66, TOKENS.sage);
    context.restore();
}
export function paintLabChip(context, width, height, project) {
    const fit = fitText(context, (trimmed(project.category) || 'Experiment').toUpperCase(), {
        maxWidth: width * 0.9, minPx: height * 0.3, maxPx: height * 0.62, weight: 600, family: signFonts().mono, lineHeight: 1,
    });
    context.fillStyle = TOKENS.cream;
    drawFit(context, fit, width / 2, (height - fit.height) / 2, 'center');
    return context.measureText(fit.lines[0] ?? '').width;
}
export function paintLabPicture(context, width, height, project, ready) {
    paintParchment(context, { x: 0, y: 0, w: width, h: height }, { seed: 'lab-picture', radius: height * 0.05, rule: false, burn: 0.6 });
    const pad = height * 0.07;
    const side = height - pad * 2;
    const x = (width - side) / 2;
    context.fillStyle = TOKENS.paperHi;
    context.fillRect(x, pad, side, side);
    if (project.image)
        drawBoardImage(context, project.image, x, pad, side, side, ready);
    else {
        context.save();
        context.translate(x, pad);
        context.beginPath();
        context.rect(0, 0, side, side);
        context.clip();
        paintProjectEmblem(context, side, project, STATIC_TIME);
        context.restore();
    }
    context.strokeStyle = 'rgba(26,23,18,0.55)';
    context.lineWidth = Math.max(2, height * 0.012);
    context.strokeRect(x, pad, side, side);
}
export function paintLabCaption(context, width, height, project) {
    const fonts = signFonts();
    paintWood(context, { x: 0, y: 0, w: width, h: height }, { seed: 'lab-caption', base: TOKENS.woodDark, grain: 0.5, knots: 0 });
    const pad = width * 0.04;
    const kicker = fitText(context, 'UP NEXT', { maxWidth: width - pad * 2, minPx: height * 0.14, maxPx: height * 0.24, weight: 600, family: fonts.mono, lineHeight: 1 });
    context.fillStyle = TOKENS.chalk;
    drawFit(context, kicker, width / 2, height * 0.08, 'center');
    const name = fitText(context, trimmed(project.short) || trimmed(project.title), { maxWidth: width - pad * 2, minPx: height * 0.22, maxPx: height * 0.46, weight: 700, family: fonts.sans, lineHeight: 1 });
    context.fillStyle = TOKENS.cream;
    drawFit(context, name, width / 2, height * 0.12 + kicker.height + (height * 0.86 - kicker.height - height * 0.12 - name.height) / 2, 'center');
}
export const LAB_PICTURE = { x: 724, y: 46, size: 236 };
export function paintLabFace(context, project, index, total, ready) {
    const { width, height } = context.canvas;
    const fonts = signFonts();
    const theme = themeForProject(project);
    const scale = Math.min(width / FACE_W, height / FACE_H);
    const metrics = { titlePx: 0, bodyPx: 0, tagPx: 0, truncated: false };
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = TOKENS.paperDeep;
    context.fillRect(0, 0, width, height);
    context.translate((width - FACE_W * scale) / 2, (height - FACE_H * scale) / 2);
    context.scale(scale, scale);
    paintParchment(context, { x: 0, y: 0, w: FACE_W, h: FACE_H }, { seed: 'experiment', radius: 14 });
    const left = 56;
    const columnWidth = LAB_PICTURE.x - 14 - 24 - left;
    const label = fitText(context, `EXPERIMENT ${index + 1} / ${total}`, { maxWidth: columnWidth - 90, minPx: 24, maxPx: 30, weight: 600, family: fonts.mono, lineHeight: 1 });
    const ribbonWidth = Math.min(columnWidth, context.measureText(label.lines[0] ?? '').width + 84);
    paintRibbon(context, { x: left - 14, y: 40, w: ribbonWidth, h: 54 }, theme.ribbon, theme.ribbonDeep);
    context.fillStyle = theme.ribbonInk;
    drawFit(context, label, left - 14 + ribbonWidth / 2, 40 + 27 - label.px / 2, 'center');
    const year = trimmed(project.year);
    if (year) {
        context.font = `600 30px ${fonts.mono}`;
        context.textAlign = 'left';
        context.textBaseline = 'alphabetic';
        context.fillStyle = TOKENS.ink3;
        if (left - 14 + ribbonWidth + 20 + context.measureText(year).width < LAB_PICTURE.x - 30)
            context.fillText(year, left - 14 + ribbonWidth + 20, 40 + 27 + 10.8);
    }
    const title = fitText(context, project.title, { maxWidth: columnWidth, maxLines: 2, maxHeight: 176, minPx: 46, maxPx: 80, weight: 700, family: fonts.sans, lineHeight: 1.04 });
    context.fillStyle = TOKENS.ink;
    drawFit(context, title, left, 112 + (184 - title.height) / 2, 'left');
    metrics.titlePx = title.px;
    const top = 304;
    const description = fitText(context, project.description, { maxWidth: FACE_W - 88, maxLines: 4, maxHeight: 492 - top, minPx: 38, maxPx: 56, weight: 500, family: fonts.sans, lineHeight: 1.18 });
    context.fillStyle = TOKENS.ink2;
    drawFit(context, description, 44, top, 'left');
    metrics.bodyPx = description.px;
    metrics.truncated = title.truncated || description.truncated;
    const tagPx = 36, tagHeight = 48;
    let x = left;
    for (const tech of project.technologies.slice(0, 5)) {
        context.font = `600 ${tagPx}px ${fonts.mono}`;
        if (x + context.measureText(tech).width + tagHeight * 0.9 > FACE_W - left)
            break;
        x += paintTag(context, tech, x, 510, tagHeight, fonts, { px: tagPx }) + 12;
        metrics.tagPx = tagPx;
    }
    const mat = LAB_PICTURE;
    paintWood(context, { x: mat.x - 14, y: mat.y - 14, w: mat.size + 28, h: mat.size + 28 }, { seed: 'mat', base: TOKENS.woodDark, grain: 0.35, knots: 0 });
    context.fillStyle = TOKENS.paperHi;
    context.fillRect(mat.x, mat.y, mat.size, mat.size);
    if (project.image)
        drawBoardImage(context, project.image, mat.x + 8, mat.y + 8, mat.size - 16, mat.size - 16, ready);
    else {
        context.save();
        context.translate(mat.x, mat.y);
        context.beginPath();
        context.rect(0, 0, mat.size, mat.size);
        context.clip();
        paintProjectEmblem(context, mat.size, project, STATIC_TIME);
        context.restore();
    }
    context.strokeStyle = 'rgba(26,23,18,0.55)';
    context.lineWidth = 3;
    context.strokeRect(mat.x, mat.y, mat.size, mat.size);
    context.restore();
    return metrics;
}
export const NOTICE_NOTES = [
    { label: 'LEVEL', body: 'folio-2025 by Bruno Simon (MIT)' },
    { label: 'RENDER', body: 'Three.js, instanced vegetation' },
    { label: 'PHYSICS', body: 'Rapier on a fixed step' },
    { label: 'GAMEPLAY', body: 'Bound to Blender objects by name' },
    { label: 'DATA', body: 'Same files as the written portfolio' },
];
export const NOTICE_SIZE = { width: 3.6, height: 2.25 };
const NOTE_TILT = [-0.022, 0.016, -0.01, 0.02, -0.014];
export function paintNotice(context, width, height, fonts, notes = NOTICE_NOTES, name = profile.name) {
    const k = Math.min(width / 1024, height / 640);
    const metrics = { bodyPx: Infinity, truncated: false };
    paintWood(context, { x: 0, y: 0, w: width, h: height }, { seed: 'notice-frame', base: TOKENS.woodDark, grain: 0.5, knots: 0 });
    const frame = 24 * k;
    const board = { x: frame, y: frame, w: width - frame * 2, h: height - frame * 2 };
    paintWood(context, board, { seed: 'notice-planks', base: TOKENS.woodMid, boards: 6, grain: 0.55, knots: 1 });
    context.strokeStyle = 'rgba(20,12,4,0.55)';
    context.lineWidth = 4 * k;
    context.strokeRect(board.x, board.y, board.w, board.h);
    for (const [x, y] of [[frame * 0.5, frame * 0.5], [width - frame * 0.5, frame * 0.5], [frame * 0.5, height - frame * 0.5], [width - frame * 0.5, height - frame * 0.5]]) {
        context.fillStyle = TOKENS.woodDeep;
        context.beginPath();
        context.arc(x, y, 5.5 * k, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = '#9b8f78';
        context.beginPath();
        context.arc(x - 1.6 * k, y - 1.8 * k, 2.6 * k, 0, Math.PI * 2);
        context.fill();
    }
    const inset = frame + 16 * k;
    const ribbonH = 62 * k;
    const title = fitText(context, 'UNDER THE HOOD', { maxWidth: 560 * k, minPx: 28 * k, maxPx: 38 * k, weight: 700, family: fonts.mono, lineHeight: 1 });
    const ribbonW = Math.min(width - inset * 2, context.measureText(title.lines[0] ?? '').width + 110 * k);
    paintRibbon(context, { x: inset - 8 * k, y: inset, w: ribbonW, h: ribbonH }, SIGN_THEMES.rings.ribbon, SIGN_THEMES.rings.ribbonDeep);
    context.fillStyle = TOKENS.cream;
    drawFit(context, title, inset - 8 * k + ribbonW / 2, inset + ribbonH / 2 - title.px / 2, 'center');
    const footerH = 40 * k;
    const footerY = board.y + board.h - 14 * k - footerH;
    paintTag(context, `${name} · World 02`, inset, footerY, footerH, fonts, { fill: TOKENS.woodDeep, ink: TOKENS.cream, px: 22 * k });
    const gap = 16 * k;
    const top = inset + ribbonH + 18 * k;
    const areaW = width - inset * 2;
    const cardH = (footerY - 14 * k - top - gap) / 2;
    const rows = [notes.slice(0, 3), notes.slice(3)];
    let n = 0;
    rows.forEach((row, r) => {
        const cardW = (areaW - gap * (row.length - 1)) / row.length;
        row.forEach((note, i) => {
            const x = inset + i * (cardW + gap), y = top + r * (cardH + gap);
            const fit = paintNote(context, x, y, cardW, cardH, NOTE_TILT[n++ % NOTE_TILT.length], note, fonts, k);
            metrics.bodyPx = Math.min(metrics.bodyPx, fit.px);
            if (fit.truncated)
                metrics.truncated = true;
        });
    });
    if (!Number.isFinite(metrics.bodyPx))
        metrics.bodyPx = 0;
    return metrics;
}
function paintNote(context, x, y, w, h, tilt, note, fonts, k) {
    context.save();
    context.translate(x + w / 2, y + h / 2);
    context.rotate(tilt);
    context.translate(-w / 2, -h / 2);
    context.shadowColor = 'rgba(20,12,4,0.45)';
    context.shadowBlur = 10 * k;
    context.shadowOffsetY = 5 * k;
    paintParchment(context, { x: 0, y: 0, w, h }, { seed: `note-${note.label}`, radius: 8 * k, rule: false, burn: 0.45 });
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;
    const pad = 18 * k;
    const label = fitText(context, note.label, { maxWidth: w - pad * 2, minPx: 18 * k, maxPx: 26 * k, weight: 700, family: fonts.mono, lineHeight: 1 });
    context.fillStyle = TOKENS.terracottaDeep;
    drawFit(context, label, pad, pad * 0.8, 'left');
    context.fillStyle = 'rgba(87,78,55,0.45)';
    context.fillRect(pad, pad * 0.8 + label.px + 6 * k, w - pad * 2, 2 * k);
    const top = pad * 0.8 + label.px + 16 * k;
    const body = fitText(context, note.body, { maxWidth: w - pad * 2, maxLines: 4, maxHeight: h - top - pad * 0.6, minPx: 24 * k, maxPx: 40 * k, weight: 600, family: fonts.sans, lineHeight: 1.16 });
    context.fillStyle = TOKENS.ink;
    drawFit(context, body, pad, top, 'left');
    context.fillStyle = 'rgba(0,0,0,0.3)';
    context.beginPath();
    context.arc(w - pad * 0.9 + 1.5 * k, pad * 0.9 + 2.5 * k, 7 * k, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = TOKENS.terracotta;
    context.beginPath();
    context.arc(w - pad * 0.9, pad * 0.9, 7 * k, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = 'rgba(255,255,255,0.45)';
    context.beginPath();
    context.arc(w - pad * 0.9 - 2 * k, pad * 0.9 - 2.2 * k, 2.6 * k, 0, Math.PI * 2);
    context.fill();
    context.restore();
    return body;
}
function paintCounter(context, face) {
    const { width, height } = context.canvas;
    const fonts = signFonts();
    paintWood(context, { x: 0, y: 0, w: width, h: height }, { seed: face.seed, base: TOKENS.woodDark, boards: 2, grain: 0.6, knots: 0, nails: true });
    const pad = width * 0.1;
    const label = fitText(context, face.label, { maxWidth: width - pad * 2, minPx: height * 0.12, maxPx: height * 0.17, weight: 700, family: fonts.mono, lineHeight: 1 });
    const labelTop = height * (face.caption ? 0.1 : 0.12);
    context.fillStyle = TOKENS.chalk;
    drawFit(context, label, width / 2, labelTop, 'center');
    context.fillStyle = face.accent;
    context.fillRect(width * 0.3, labelTop + label.px + height * 0.03, width * 0.4, Math.max(3, height * 0.018));
    const numeralTop = labelTop + label.px + height * 0.09;
    const numeralH = height - numeralTop - (face.caption ? height * 0.26 : height * 0.12);
    paintNumeral(context, face.value, { x: pad, y: numeralTop, w: width - pad * 2, h: numeralH }, { color: TOKENS.cream, family: fonts.mono, weight: 700 });
    if (face.caption) {
        const caption = fitText(context, face.caption, { maxWidth: width - pad * 2, minPx: height * 0.08, maxPx: height * 0.11, weight: 500, family: fonts.mono, lineHeight: 1 });
        context.fillStyle = TOKENS.chalk;
        drawFit(context, caption, width / 2, height * 0.8, 'center');
    }
}
export const paintAltarCounter = (context, offerings) => paintCounter(context, { label: 'OFFERINGS', value: String(offerings).padStart(3, '0'), caption: 'this browser', accent: TOKENS.terracotta, seed: 'altar' });
export const paintCookieCounter = (context, cookies) => paintCounter(context, { label: 'COOKIES TAKEN', value: String(cookies), accent: TOKENS.gold, seed: 'cookies' });
const STORAGE = 'alejandro-world2-places-v1';
const NOTICE_SINK = 3.2;
const NOTICE_MIN_SCALE = 1.45;
const NOTICE_MAX_SCALE = 2.6;
const NOTICE_MAX_BOOST = 1.6;
const NOTICE_TUNED_HEIGHT = 900;
const NOTICE_LIFT = 1.6;
const _point = new THREE.Vector3();
const _right = new THREE.Vector3();
const _frameInverse = new THREE.Matrix4();
const NOTICE_LOW_LIFT = 0.25;
const NOTICE_TOP_CLEAR = 68;
const NOTICE_SIDE_CLEAR = 8;
const NOTICE_MAX_SHARE = 0.46;
const NOTICE_MIN_BOOST = 0.55;
const NOTICE_ROOF_OVERLAP = 0.08;
const NOTICE_ROOF = 1.3;
export function fitNotice(i, out = { boost: 1, lift: NOTICE_LIFT, slide: 0 }) {
    const natural = Math.max(NOTICE_MIN_BOOST, Math.min(i.wanted, NOTICE_MAX_SHARE * i.height / i.boardHeight, (i.width - NOTICE_SIDE_CLEAR * 2) / i.boardWidth));
    let boost = Number.isFinite(natural) ? natural : i.wanted;
    const asked = boost;
    let lift = NOTICE_LIFT;
    const k = i.perUnit * i.up;
    if (k > 1e-3 && i.boardHeight > 0) {
        const reachAbove = (b) => b * i.boardHeight * (1 + i.up) / 2;
        const reachBelow = (b) => b * i.boardHeight * (1 - i.up) / 2;
        lift = Math.min(NOTICE_LIFT, (i.ground - NOTICE_TOP_CLEAR - reachAbove(boost)) / k);
        if (lift < NOTICE_LIFT) {
            const floor = Math.max(NOTICE_LOW_LIFT, Math.min(NOTICE_LIFT, (i.ground - (i.roof + NOTICE_ROOF_OVERLAP * i.height) + reachBelow(boost)) / k));
            if (lift < floor) {
                lift = floor;
                boost = Math.max(NOTICE_MIN_BOOST, Math.min(boost, 2 * (i.ground - lift * k - NOTICE_TOP_CLEAR) / (i.boardHeight * (1 + i.up))));
            }
        }
    }
    const half = boost * i.boardWidth / 2;
    let slide = 0;
    if (half * 2 > i.width - NOTICE_SIDE_CLEAR * 2)
        slide = i.width / 2 - i.centreX;
    else if (i.centreX - half < NOTICE_SIDE_CLEAR)
        slide = NOTICE_SIDE_CLEAR - (i.centreX - half);
    else if (i.centreX + half > i.width - NOTICE_SIDE_CLEAR)
        slide = i.width - NOTICE_SIDE_CLEAR - (i.centreX + half);
    const outside = Math.max(0, -i.centreX, i.centreX - i.width);
    slide *= Math.max(0, 1 - outside / Math.max(half, 1));
    const engaged = Number.isFinite(i.carOffset) ? Math.max(0, Math.min(1, 2 - i.carOffset / Math.max(i.boardWidth, 1))) : 0;
    out.boost = asked + (boost - asked) * engaged;
    out.lift = NOTICE_LIFT + (lift - NOTICE_LIFT) * engaged;
    out.slide = slide * engaged;
    return out;
}
const LAB_CHARM_AT = [1.35, 1.3, 0.08];
export class Places {
    constructor(game, references, prompts, bin) {
        this.game = game;
        this.references = references;
        this.prompts = prompts;
        this.group = new THREE.Group();
        this.counts = { offerings: 0, cookies: 0 };
        this.beam = null;
        this.altarAt = null;
        this.altarCooldown = 0;
        this.altarBoard = null;
        this.cabin = null;
        this.moon = null;
        this.tv = null;
        this.cookies = [];
        this.cookieSpawn = null;
        this.cookiesSpawned = 0;
        this.cookieBoard = null;
        this.cookieMould = null;
        this.blower = null;
        this.sceneBoard = null;
        this.fitIn = { wanted: 1, width: 0, height: 0, boardHeight: 0, boardWidth: 0, perUnit: 0, up: 1, ground: 0, roof: 0, centreX: 0, carOffset: 0 };
        this.fitOut = { boost: 1, lift: NOTICE_LIFT, slide: 0 };
        this.labBoard = null;
        this.disposed = false;
        this.movedProps = new Set();
        this.sweptAt = -1;
        this.signKit = null;
        this.bin = bin;
        this.labProjects = resolveBoard(game.worldBoards, 'experiments');
        bin.add(() => { this.disposed = true; });
        this.group.name = 'World2 / places';
        this.load();
        this.setLanding();
        this.setAltar();
        this.setToilet();
        this.setTimeMachine();
        this.setCookie();
        this.setBehindTheScene();
        this.setLab();
        this.hideHeat();
        this.setAchievements();
        this.setJukebox();
        const tick = () => this.update();
        game.ticker.events.on('tick', tick, 11);
        bin.add(() => {
            game.ticker.events.off('tick', tick);
            this.beam?.geometry.dispose();
            this.beam?.material.dispose();
            this.altarBoard?.destroy();
            this.cookieBoard?.destroy();
            this.tv?.screen.destroy();
        });
        bin.object3D(this.group);
        bin.add(() => { for (const cookie of this.cookies)
            this.group.remove(cookie.mesh); });
    }
    load() {
        try {
            const raw = JSON.parse(localStorage.getItem(STORAGE) ?? 'null');
            if (raw && typeof raw === 'object')
                this.counts = { offerings: Number(raw.offerings) || 0, cookies: Number(raw.cookies) || 0 };
        }
        catch { }
    }
    save() {
        try {
            localStorage.setItem(STORAGE, JSON.stringify(this.counts));
        }
        catch { }
    }
    setLanding() {
        const kiosk = this.references.position('refKioskInteractivePoint');
        if (kiosk)
            this.prompts.create({ label: 'Map', position: kiosk, align: 'right', onInteract: () => this.game.toggleMap() });
        const controls = this.references.position('refControlsInteractivePoint');
        if (controls)
            this.prompts.create({ label: 'Controls', position: controls, align: 'left', onInteract: () => this.game.toggleHelp() });
    }
    setAltar() {
        const altar = this.references.position('refAltar');
        if (!altar)
            return;
        this.altarAt = altar;
        const geometry = new THREE.CylinderGeometry(2.5, 2.5, 6, 32, 1, true);
        geometry.translate(0, 3, 0);
        this.beam = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
            transparent: true, side: THREE.DoubleSide, depthWrite: false,
            uniforms: { time: { value: 0 }, tint: { value: new THREE.Color('#ff544d') } },
            vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
            fragmentShader: `
        uniform float time; uniform vec3 tint; varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          vec2 uv = vec2(vUv.x * 6.0 - vUv.y * 2.0, vUv.y - time * 0.2);
          float n = hash(floor(uv * 8.0)) * 0.6 + 0.4;
          n += vUv.y * 3.0;
          if (n > 1.0) discard;
          gl_FragColor = vec4(tint * (1.0 - n * 0.4), (1.0 - vUv.y) * 0.55);
        }`,
        }));
        this.beam.position.copy(altar);
        this.group.add(this.beam);
        const counter = this.references.transform('refCounter');
        if (counter) {
            this.altarBoard = new Screen({ width: 512, height: 256, worldWidth: 2.4, emissive: FACE_EMISSIVE });
            this.altarBoard.group.position.copy(counter.position);
            this.altarBoard.group.quaternion.copy(counter.quaternion);
            this.group.add(this.altarBoard.group);
            this.paintAltar();
        }
    }
    paintAltar() {
        this.altarBoard?.draw(context => paintAltarCounter(context, this.counts.offerings));
    }
    setToilet() {
        const physical = this.references.physical('refCabinPhysicalDynamic');
        if (physical)
            this.cabin = { physical, down: false };
        this.moon = this.references.node('refMoon');
    }
    setTimeMachine() {
        const point = this.references.position('refInteractivePoint.006');
        const previousSite = projects.find(project => project.id === 'personal-web');
        const screenNode = this.references.node('refScreen');
        const physical = this.references.physical('refTvPhysicalDynamic');
        if (screenNode instanceof THREE.Mesh) {
            const screen = new Screen({ width: 512, height: 384, worldWidth: 1, emissive: 0.9, authored: true });
            orientForMesh(screen.texture, screenNode, this.references.position('refInteractivePoint.006') ?? new THREE.Vector3());
            screenNode.material = screen.material;
            this.tv = { physical: physical ?? null, screen, rammed: 0 };
            this.paintTv(previousSite?.year ?? '2024');
        }
        if (point && previousSite?.liveUrl) {
            this.prompts.create({
                label: 'Time machine', position: point, align: 'right',
                onInteract: () => {
                    this.game.audio.play('interact');
                    this.game.interactions?.achievements.unlock('timeMachine');
                    window.open(previousSite.liveUrl, '_blank', 'noopener,noreferrer');
                },
            });
        }
    }
    paintTv(year, noise = false) {
        this.tv?.screen.draw(context => {
            const { width, height } = context.canvas;
            context.fillStyle = '#0d1014';
            context.fillRect(0, 0, width, height);
            if (noise) {
                for (let i = 0; i < 2400; i++) {
                    context.fillStyle = `rgba(255,255,255,${Math.random() * 0.5})`;
                    context.fillRect(Math.random() * width, Math.random() * height, 3, 2);
                }
                return;
            }
            for (let y = 0; y < height; y += 4) {
                context.fillStyle = 'rgba(120,255,190,0.05)';
                context.fillRect(0, y, width, 2);
            }
            context.textAlign = 'center';
            context.fillStyle = '#7cffc0';
            context.font = '700 44px ui-monospace, SFMono-Regular, monospace';
            context.fillText(year, width / 2, 130);
            context.font = '600 26px ui-monospace, SFMono-Regular, monospace';
            context.fillText('THE SITE BEFORE', width / 2, 186);
            context.fillText('THIS ONE', width / 2, 222);
            context.fillStyle = '#3f7a68';
            context.font = '500 20px ui-monospace, SFMono-Regular, monospace';
            context.fillText('press to travel', width / 2, 290);
        });
    }
    setCookie() {
        this.cookieSpawn = this.references.position('refSpawner');
        const point = this.references.position('refInteractivePoint.002');
        const blowerNode = this.references.node('refBlower.001') ?? this.references.node('refBlower');
        if (blowerNode)
            this.blower = { node: blowerNode, base: blowerNode.scale.y };
        this.mouldCookie();
        const label = this.references.transform('refCounterLabel');
        if (label) {
            this.cookieBoard = new Screen({ width: 512, height: 200, worldWidth: 1.6, emissive: FACE_EMISSIVE });
            this.cookieBoard.group.position.copy(label.position);
            this.cookieBoard.group.quaternion.copy(label.quaternion);
            this.group.add(this.cookieBoard.group);
            this.paintCookies();
        }
        if (point && this.cookieSpawn) {
            this.prompts.create({
                label: 'Take a cookie', position: point, align: 'right',
                onInteract: () => this.spawnCookie(),
            });
        }
    }
    mouldCookie() {
        const node = this.references.node('refCookie');
        if (!node)
            return;
        this.references.environment.suppress(node);
        const mesh = node instanceof THREE.Mesh
            ? node
            : node.children.find(child => child instanceof THREE.Mesh);
        if (!mesh)
            return;
        const geometry = mesh.geometry;
        geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        const scale = mesh.getWorldScale(new THREE.Vector3());
        const size = new THREE.Vector3((box.max.x - box.min.x) * Math.abs(scale.x), (box.max.y - box.min.y) * Math.abs(scale.y), (box.max.z - box.min.z) * Math.abs(scale.z));
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        this.cookieMould = {
            geometry,
            material,
            radius: Math.max(size.x, size.z) * 0.5,
            half: Math.max(0.02, size.y * 0.5),
        };
    }
    spawnCookie() {
        if (!this.cookieSpawn || !this.cookieMould || this.cookies.length > 24)
            return;
        const { geometry, material, radius, half } = this.cookieMould;
        const mesh = new THREE.Mesh(geometry, material);
        const angle = this.cookiesSpawned++ * 2.39996;
        const spread = radius * 1.05;
        const at = this.cookieSpawn.clone().add(new THREE.Vector3(Math.cos(angle) * spread, 0.7, Math.sin(angle) * spread));
        mesh.position.copy(at);
        mesh.castShadow = true;
        this.group.add(mesh);
        const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
        const physical = this.game.physics.add({
            type: 'dynamic', position: at, rotation: spin,
            colliders: [{ shape: 'cylinder', parameters: [half, radius], category: 'object' }],
            mass: 3, friction: 0.8, restitution: 0.2, angularDamping: 0.4, owner: 'cookie',
        });
        this.cookies.push({ physical, mesh, spawned: this.game.ticker.elapsed });
        this.game.audio.play('blip', 1.5);
    }
    paintCookies() {
        this.cookieBoard?.draw(context => paintCookieCounter(context, this.counts.cookies));
    }
    kit() {
        if (!this.signKit) {
            const materials = signMaterials(this.references.environment.group);
            const runtime = new SignRuntime({ ticker: this.game.ticker, camera: () => this.game.view?.camera }, this.bin);
            this.bin.add(() => materials.dispose());
            this.signKit = { materials, runtime };
        }
        return this.signKit;
    }
    setBehindTheScene() {
        const centre = this.references.position('refCenter.001');
        const point = this.references.position('refInteractivePoint.004');
        if (!centre)
            return;
        const group = new THREE.Group();
        group.name = 'World2 / behind the scenes';
        group.position.copy(centre).add(new THREE.Vector3(0, -NOTICE_SINK, 0));
        group.visible = false;
        this.group.add(group);
        this.sceneBoard = { screen: { group, sign: null }, shown: false, home: centre.clone(), metrics: null, slide: { x: 0, z: 0 } };
        const billboard = Billboards.for(this.game.ticker).add(group, {
            mode: 'spherical', moves: true, radius: 250, cull: 4,
            scale: { ref: 21, min: NOTICE_MIN_SCALE, max: NOTICE_MAX_SCALE, compensateParent: true },
        });
        this.bin.add(billboard.remove);
        if (point) {
            this.prompts.create({
                label: 'Behind the scenes', position: point, align: 'right',
                onInteract: () => {
                    const board = this.sceneBoard;
                    if (!board)
                        return;
                    board.shown = !board.shown;
                    if (board.shown)
                        this.raiseNotice(board);
                    this.game.audio.play('interact');
                    this.game.interactions?.achievements.unlock('behindTheScene');
                },
            });
        }
    }
    raiseNotice(board) {
        const { group } = board.screen;
        this.buildNotice(board);
        if (!group.visible) {
            const player = this.game.player.position;
            group.rotation.y = Math.atan2(player.x - group.position.x, player.z - group.position.z);
            group.position.y = board.home.y - NOTICE_SINK;
        }
        group.visible = true;
    }
    viewOf() {
        return this.game.view;
    }
    hiddenLayer() {
        return this.viewOf()?.camera?.layers?.isEnabled(MAP_HIDDEN_LAYER) ? MAP_HIDDEN_LAYER : undefined;
    }
    noticeBoost() {
        const height = this.viewOf()?.viewport?.height;
        return height && height > 0 ? Math.max(1, Math.min(NOTICE_MAX_BOOST, NOTICE_TUNED_HEIGHT / height)) : 1;
    }
    noticeFit(board) {
        const out = this.fitOut;
        const wanted = this.noticeBoost();
        const view = this.viewOf();
        const camera = view?.camera;
        const width = view?.viewport?.width, height = view?.viewport?.height;
        const group = board.screen.group;
        const frame = group.parent;
        const slideX = board.slide.x, slideZ = board.slide.z;
        out.boost = wanted;
        out.lift = NOTICE_LIFT;
        out.slide = 0;
        board.slide.x = 0;
        board.slide.z = 0;
        if (!camera || !frame || !(width && width > 0) || !(height && height > 0))
            return out;
        const c = camera.matrixWorld.elements, g = group.matrixWorld.elements;
        const depth = -((g[12] - c[12]) * c[8] + (g[13] - c[13]) * c[9] + (g[14] - c[14]) * c[10]);
        if (!(depth > 0.1))
            return out;
        const perUnit = 0.5 * height * camera.projectionMatrix.elements[5] * frame.matrixWorld.getMaxScaleOnAxis() / depth;
        const scale = group.scale.y;
        const player = this.game.player.position;
        const input = this.fitIn;
        _point.copy(board.home).applyMatrix4(frame.matrixWorld).project(camera);
        input.ground = (1 - _point.y) * 0.5 * height;
        _point.set(player.x, player.y + NOTICE_ROOF, player.z).applyMatrix4(frame.matrixWorld).project(camera);
        const carX = (_point.x + 1) * 0.5 * width;
        input.roof = (1 - _point.y) * 0.5 * height;
        _point.set(group.position.x - slideX, group.position.y, group.position.z - slideZ).applyMatrix4(frame.matrixWorld).project(camera);
        input.centreX = (_point.x + 1) * 0.5 * width;
        input.wanted = wanted;
        input.width = width;
        input.height = height;
        input.perUnit = perUnit;
        input.up = c[5];
        input.boardHeight = NOTICE_SIZE.height * scale * perUnit;
        input.boardWidth = NOTICE_SIZE.width * scale * perUnit;
        input.carOffset = Math.hypot(carX - input.centreX, input.roof - input.ground);
        fitNotice(input, out);
        if (out.slide !== 0) {
            _right.set(c[0], 0, c[2]).normalize().transformDirection(_frameInverse.copy(frame.matrixWorld).invert());
            board.slide.x = _right.x * out.slide / perUnit;
            board.slide.z = _right.z * out.slide / perUnit;
        }
        return out;
    }
    buildNotice(board) {
        if (board.screen.sign || this.disposed)
            return;
        const { materials, runtime } = this.kit();
        const { width, height } = NOTICE_SIZE;
        const sign = new Sign({
            id: 'behind-the-scenes', variant: 'label', width, height, materials, runtime, bin: this.bin,
            dpm: 1024 / (width - 0.04),
            paint: (context, rect, tools) => { board.metrics = paintNotice(context, rect.w, rect.h, tools.fonts); },
        });
        sign.group.userData.signMount = 'billboard';
        const layer = this.hiddenLayer();
        if (layer !== undefined)
            sign.group.traverse(node => { node.layers.set(layer); });
        board.screen.group.add(sign.group);
        board.screen.sign = sign;
        sign.paintNow();
    }
    hideHeat() {
        for (const node of this.references.series('refHeat'))
            this.references.environment.suppress(node);
        this.references.suppress('refOvenHeat');
    }
    setLab() {
        const node = this.references.node('refImages.001');
        const point = this.references.position('refInteractivePoint.001');
        if (!(node instanceof THREE.Mesh) || !this.labProjects.length)
            return;
        const reader = point ?? new THREE.Vector3();
        const { materials, runtime } = this.kit();
        this.recolourLab();
        const sign = new Sign({ id: 'lab', variant: 'custom', width: 4, height: 2.25, materials, runtime });
        const total = () => this.labProjects.length;
        const current = () => this.labProjects[this.labBoard?.index ?? 0];
        const face = sign.addLayer({
            name: 'face', width: FACE_W, height: FACE_H, priority: 10, base: TOKENS.paper,
            paint: context => {
                const metrics = paintLabFace(context, current(), this.labBoard?.index ?? 0, total(), () => face.invalidate());
                if (this.labBoard)
                    this.labBoard.metrics = metrics;
            },
        });
        bindLayer(face, node, materials, reader);
        const frame = faceFrame(node, face.texture);
        const board = {
            index: 0, sign, face, frame, emblem: null, emblemMesh: null, chip: null, picture: null, caption: null,
            charm: new THREE.Group(), woods: new Map(), charms: new Map(), woodNow: null, charmNow: null, kickedAt: -Infinity, metrics: null, still: false,
        };
        this.labBoard = board;
        sign.setBounds(node, new THREE.Vector3().setFromMatrixPosition(frame.matrix), 5);
        const unit = frame.width / FACE_W;
        const side = LAB_PICTURE.size * unit;
        const emblem = board.emblem = sign.addLayer({
            name: 'emblem', width: EMBLEM_SIZE, height: EMBLEM_SIZE, live: true, base: TOKENS.woodDark,
            paint: (context, width, _height, time) => paintProjectEmblem(context, width, current(), time),
        });
        const quad = board.emblemMesh = new THREE.Mesh(new THREE.PlaneGeometry(side, side), materials.face(emblem.texture));
        quad.name = 'sign:lab:emblem';
        quad.receiveShadow = true;
        quad.position.set((LAB_PICTURE.x + LAB_PICTURE.size / 2 - FACE_W / 2) * unit, (FACE_H / 2 - (LAB_PICTURE.y + LAB_PICTURE.size / 2)) * unit, 0.012);
        frame.root.add(quad);
        const plate = this.references.node('text.009');
        if (plate instanceof THREE.Mesh) {
            const layer = this.planeLayer(sign, plate, 'plate', 1024, (context, width, height) => paintLabPlate(context, width, height), 4, TOKENS.woodDark);
            bindLayer(layer, plate, materials, reader);
        }
        const chipText = this.references.node('text.007');
        if (chipText instanceof THREE.Mesh) {
            const panel = this.references.node('panel.002');
            chipText.scale.x *= LINK_PLANE / 4;
            const layer = this.planeLayer(sign, chipText, 'chip', 704, (context, width, height) => {
                const textWidth = paintLabChip(context, width, height, current());
                if (panel)
                    panel.scale.x = Math.max(0.35, (textWidth / width) * LINK_PLANE + 0.2);
            }, 3);
            bindLayer(layer, chipText, materials, reader, { transparent: true });
            board.chip = { layer, panel: panel instanceof THREE.Mesh ? panel : null };
        }
        const picture = this.references.node('image');
        if (picture instanceof THREE.Mesh) {
            const next = () => this.labProjects[((this.labBoard?.index ?? 0) + 1) % total()];
            const layer = this.planeLayer(sign, picture, 'next-picture', 384, (context, width, height) => paintLabPicture(context, width, height, next(), () => layer.invalidate()), 2, TOKENS.paper);
            bindLayer(layer, picture, materials, reader);
            board.picture = layer;
        }
        const caption = this.references.node('text.008');
        if (caption instanceof THREE.Mesh) {
            const next = () => this.labProjects[((this.labBoard?.index ?? 0) + 1) % total()];
            const layer = this.planeLayer(sign, caption, 'next-caption', 640, (context, width, height) => paintLabCaption(context, width, height, next()), 2, TOKENS.woodDark);
            bindLayer(layer, caption, materials, reader);
            board.caption = layer;
        }
        this.references.suppress('intersect');
        board.charm.name = 'sign:lab:charm';
        board.charm.position.set(...LAB_CHARM_AT);
        frame.root.add(board.charm);
        sign.animate = time => {
            const since = time - board.kickedAt;
            const kick = since >= 0 && since < 2.5 ? Math.exp(-since * 2.4) * Math.sin(since * 11) * 0.38 : 0;
            board.charm.rotation.z = Math.sin(time * 1.35) * 0.09 + kick;
            this.parkEmblem(board);
        };
        this.refreshLabPicture();
        this.skinLab();
        this.bin.add(() => {
            sign.dispose();
            for (const mesh of [...board.woods.values(), ...board.charms.values()]) {
                mesh.geometry.dispose();
                mesh.removeFromParent();
            }
            quad.geometry.dispose();
        });
        this.group.userData.signDesign = SIGN_DESIGN;
        this.paintPreview(sign);
        if (point) {
            this.prompts.create({
                label: 'Next experiment', position: point, align: 'right',
                onInteract: () => {
                    if (!this.labBoard)
                        return;
                    this.labBoard.index = (this.labBoard.index + 1) % this.labProjects.length;
                    this.labBoard.kickedAt = this.game.ticker.elapsed;
                    this.paintLab();
                    this.game.audio.play('blip', 1.2);
                    this.game.interactions?.achievements.unlock('lab');
                },
            });
        }
    }
    paintPreview(sign) {
        if (document.body?.dataset.player === 'true')
            return;
        sign.paintNow();
        this.bin.add(onSignFontsLoaded(() => sign.paintNow()));
    }
    recolourLab() {
        const nodes = this.references.environment.nodes;
        const recolor = (name, map) => { const node = nodes.get(name); if (node instanceof THREE.Mesh)
            recolorPalette(node, map); };
        recolor('Cube.003', { [SWATCH.grey]: SWATCH.woodDark, [SWATCH.purple]: SWATCH.gold });
        recolor('Cube.178', { [SWATCH.copper]: SWATCH.tan });
        recolor('panel.002', { [SWATCH.purple]: SWATCH.woodDark });
        for (const name of ['refArrowNext', 'refArrowPrevious'])
            recolor(name, { [SWATCH.paleRose]: SWATCH.ink });
        for (const name of ['refChainLeft', 'refChainRight', 'refChainPulley'])
            recolor(name, { [SWATCH.grey]: SWATCH.slate });
    }
    planeLayer(sign, mesh, name, longSide, paint, priority = 0, base) {
        const { width, height } = planeSize(mesh);
        return sign.addLayer({ name, width: longSide, height: Math.max(8, Math.round(longSide * (height / width))), paint, priority, base });
    }
    paintLab() {
        const board = this.labBoard;
        if (!board)
            return;
        board.face.invalidate();
        board.chip?.layer.invalidate();
        board.picture?.invalidate();
        board.caption?.invalidate();
        this.refreshLabPicture();
        this.skinLab();
    }
    refreshLabPicture() {
        const board = this.labBoard;
        if (!board?.emblem)
            return;
        const project = this.labProjects[board.index];
        const still = !!project.image || !emblemKindFor(project);
        board.still = still;
        board.emblem.live = !still;
        board.emblem.hold = still;
        if (board.emblemMesh)
            board.emblemMesh.visible = !still;
        if (!still)
            board.emblem.invalidate();
    }
    parkEmblem(board) {
        const emblem = board.emblem, camera = this.viewOf()?.camera;
        if (!emblem || !camera)
            return;
        const e = board.frame.root.matrixWorld.elements, c = camera.matrixWorld.elements;
        const front = e[8] * (c[12] - e[12]) + e[9] * (c[13] - e[13]) + e[10] * (c[14] - e[14]) > 0;
        const hold = board.still || (!front && emblem.paintedAt !== -Infinity);
        if (emblem.hold !== hold)
            emblem.hold = hold;
    }
    skinLab() {
        const board = this.labBoard;
        if (!board)
            return;
        const theme = themeForProject(this.labProjects[board.index]);
        const wood = this.labWood(board, theme.hardware);
        const charm = theme.charm === 'none' ? null : this.labCharm(board, theme.charm);
        if (board.woodNow !== wood) {
            if (board.woodNow)
                board.woodNow.visible = false;
            wood.visible = true;
            board.woodNow = wood;
        }
        if (board.charmNow !== charm) {
            if (board.charmNow)
                board.charmNow.visible = false;
            if (charm)
                charm.visible = true;
            board.charmNow = charm;
        }
    }
    labWood(board, kind) {
        const known = board.woods.get(kind);
        if (known)
            return known;
        const parts = [];
        const nail = nailGeometry({ radius: 0.034, height: 0.03 });
        for (let i = 0; i < 7; i++)
            parts.push(place(nail, [-1.8 + i * 0.6, 2.03, 0.115]));
        const brace = bracketGeometry({ arm: 0.3, thickness: 0.055, depth: 0.04 });
        for (const sx of [-1, 1])
            for (const sy of [-1, 1]) {
                const turn = sx < 0 ? (sy < 0 ? 0 : -Math.PI / 2) : (sy > 0 ? Math.PI : Math.PI / 2);
                parts.push(place(brace, [sx * 1.965, sy * 1.09, 0.06], [0, 0, turn]), place(nail, [sx * 1.965, sy * 1.09, 0.085]));
            }
        if (kind === 'vine') {
            const path = [];
            for (let i = 0; i <= 12; i++)
                path.push([-2.3 + Math.sin(i * 1.1) * 0.05, -1.6 + (i / 12) * 3.7, 0.2 + Math.cos(i * 0.8) * 0.03]);
            parts.push(place(vineGeometry(path, { radius: 0.02, leaves: 12, leafSize: 0.2, seed: hashSeed('lab') })));
        }
        else if (kind === 'rope' || kind === 'chain') {
            const chain = kind === 'chain';
            parts.push(place(pegGeometry({ radius: 0.04, length: 0.1 }), [2.27, 0.95, 0.17]));
            const loops = new Facets();
            for (let i = 0; i < (chain ? 5 : 3); i++) {
                const ring = [];
                const radius = chain ? 0.085 : 0.15;
                for (let k = 0; k < 10; k++) {
                    const a = (k / 10) * Math.PI * 2;
                    ring.push([Math.cos(a) * radius * (chain && i % 2 ? 0.45 : 1), Math.sin(a) * radius - (chain ? i * 0.15 : i * 0.05) - radius, chain ? 0 : i * 0.035]);
                }
                addTube(loops, ring, chain ? 0.022 : 0.026, chain ? SWATCH.silver : SWATCH.khaki, 4, true);
            }
            parts.push(place(loops.geometry(), [2.27, 0.95, 0.27]));
        }
        const mesh = new THREE.Mesh(mergeParts(parts), this.kit().materials.wood);
        mesh.name = `sign:lab:wood:${kind}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.visible = false;
        board.frame.root.add(mesh);
        board.woods.set(kind, mesh);
        return mesh;
    }
    labCharm(board, kind) {
        const known = board.charms.get(kind);
        if (known)
            return known;
        const hung = mergeParts([ropeGeometry([0, 0, 0], [0, -0.16, 0], { sag: 0, sides: 4, segments: 2 }), place(charmGeometry(kind, 0.34), [0, -0.16, 0])]);
        const mesh = new THREE.Mesh(hung, this.kit().materials.wood);
        mesh.name = `sign:lab:charm:${kind}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.visible = false;
        board.charm.add(mesh);
        board.charms.set(kind, mesh);
        return mesh;
    }
    setAchievements() {
        const point = this.references.position('refInteractivePoint.005');
        if (!point)
            return;
        this.prompts.create({
            label: 'Achievements', position: point, align: 'right',
            onInteract: () => { this.game.toggleAchievements(); this.game.audio.play('interact'); },
        });
    }
    setJukebox() {
        const point = this.references.position('refJukeboxInteractivePoint');
        if (!point)
            return;
        this.prompts.create({
            label: 'Jukebox', position: point, align: 'left',
            onInteract: () => {
                const notes = [1, 1.25, 1.5, 2, 1.5, 1.25, 1.875, 1.5];
                notes.forEach((rate, i) => this.game.tweens.delay(i * 0.16, () => this.game.audio.play('note', rate)));
                this.game.interactions?.achievements.unlock('jukebox');
            },
        });
    }
    update() {
        const delta = this.game.ticker.delta * this.game.ticker.scale;
        const time = this.game.ticker.elapsed;
        const player = this.game.player.position;
        const near = (at, reach = 30) => !!at && Math.hypot(player.x - at.x, player.z - at.z) < reach;
        if (this.beam && near(this.altarAt, 40))
            this.beam.material.uniforms.time.value = time;
        if (this.blower && near(this.cookieSpawn))
            this.blower.node.scale.y = this.blower.base * (Math.sin(time * 2 + Math.PI) * 0.25 + 0.75);
        if (this.altarAt) {
            this.altarCooldown = Math.max(0, this.altarCooldown - delta);
            const flat = Math.hypot(player.x - this.altarAt.x, player.z - this.altarAt.z);
            if (flat < 2.5 && player.y < this.altarAt.y + 5 && this.altarCooldown <= 0) {
                this.altarCooldown = 6;
                this.counts.offerings++;
                this.save();
                this.paintAltar();
                this.game.audio.play('fail');
                this.game.interactions?.explosions.explode(this.altarAt.clone().setY(this.altarAt.y + 0.5), 6, 14);
                this.game.interactions?.achievements.unlock('altar');
                this.game.tweens.delay(1.1, () => this.game.player.respawn());
            }
        }
        if (this.cabin && !this.cabin.down && !this.cabin.physical.body.isSleeping()) {
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.cabin.physical.current.quaternion);
            if (up.y < 0.55) {
                this.cabin.down = true;
                this.game.audio.impact(14);
                this.game.interactions?.achievements.unlock('toilet');
            }
        }
        if (this.moon && near(this.moon.position, 60)) {
            this.moon.visible = this.game.lighting.phase > 0.75 || this.game.lighting.phase < 0.2;
        }
        if (this.tv) {
            if (this.tv.physical && !this.tv.physical.body.isSleeping() && this.tv.rammed <= 0) {
                this.tv.rammed = 1.4;
                this.paintTv('', true);
                this.game.audio.play('fail');
            }
            else if (this.tv.rammed > 0) {
                this.tv.rammed -= delta;
                if (this.tv.rammed <= 0)
                    this.paintTv(projects.find(p => p.id === 'personal-web')?.year ?? '2024');
            }
        }
        for (let i = this.cookies.length - 1; i >= 0; i--) {
            const cookie = this.cookies[i];
            const position = cookie.physical.current.position;
            cookie.mesh.position.lerpVectors(cookie.physical.previous.position, position, this.game.ticker.alpha);
            cookie.mesh.quaternion.slerpQuaternions(cookie.physical.previous.quaternion, cookie.physical.current.quaternion, this.game.ticker.alpha);
            const reached = player.distanceTo(position) < 1.6 + (this.cookieMould?.radius ?? 0);
            if (!reached && time - cookie.spawned < 120)
                continue;
            if (reached) {
                this.counts.cookies++;
                this.save();
                this.paintCookies();
                this.game.audio.play('blip', 1.9);
                this.game.interactions?.achievements.set('cookies', this.counts.cookies);
            }
            this.game.physics.remove(cookie.physical);
            cookie.mesh.removeFromParent();
            this.cookies.splice(i, 1);
        }
        const board = this.sceneBoard;
        if (board && (board.screen.group.visible || board.shown)) {
            const group = board.screen.group;
            if (board.shown)
                this.buildNotice(board);
            const { boost, lift } = this.noticeFit(board);
            group.position.x = board.home.x + board.slide.x;
            group.position.z = board.home.z + board.slide.z;
            const sign = board.screen.sign;
            if (sign && sign.group.scale.x !== boost)
                sign.group.scale.setScalar(boost);
            const half = NOTICE_SIZE.height * 0.5 * group.scale.y * boost;
            const target = board.shown ? board.home.y + lift + half : board.home.y - half - 0.3;
            group.position.y += (target - group.position.y) * Math.min(1, delta * 2.5);
            if (!board.shown && Math.abs(group.position.y - target) < 0.05)
                group.visible = false;
        }
        if (this.movedProps.size < 20 && time - this.sweptAt > 0.25) {
            this.sweptAt = time;
            for (const { physical } of this.references.environment.dynamic) {
                if (this.movedProps.has(physical) || physical.body.isSleeping())
                    continue;
                const home = physical.initialState.position;
                const now = physical.body.translation();
                if (Math.hypot(now.x - home.x, now.y - home.y, now.z - home.z) < 0.6)
                    continue;
                this.movedProps.add(physical);
                this.game.interactions?.achievements.mark('bricks', String(physical.owner ?? this.movedProps.size));
            }
        }
    }
    get offerings() { return this.counts.offerings; }
    get cookiesTaken() { return this.counts.cookies; }
}
