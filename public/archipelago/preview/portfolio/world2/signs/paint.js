import { TOKENS } from './palette.js';
import { hashSeed, mulberry32 } from './geometry.js';
const FALLBACK_SANS = '"Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif';
const FALLBACK_MONO = '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
let fontCache = null;
let fontListeners = null;
let fontsLoaded = false;
const readVariable = (name) => {
    try {
        return getComputedStyle(document.body).getPropertyValue(name).trim();
    }
    catch {
        return '';
    }
};
export function signFonts() {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (fontCache && now - fontCache.at < 2000)
        return fontCache.value;
    const sans = readVariable('--font-geist-sans');
    const mono = readVariable('--font-geist-mono');
    const value = { sans: sans ? `${sans}, ${FALLBACK_SANS}` : FALLBACK_SANS, mono: mono ? `${mono}, ${FALLBACK_MONO}` : FALLBACK_MONO };
    fontCache = { at: now, value };
    return value;
}
const WEIGHTS = ['500 28px', '600 28px', '700 48px', '800 48px'];
export function loadSignFonts() {
    if (typeof document === 'undefined' || !document.fonts)
        return Promise.resolve();
    const { sans, mono } = signFonts();
    const jobs = [...WEIGHTS.map(w => `${w} ${sans}`), `600 28px ${mono}`].map(font => document.fonts.load(font).catch(() => []));
    return Promise.all(jobs).then(() => { fontsLoaded = true; });
}
export function onSignFontsLoaded(listener) {
    if (typeof document === 'undefined' || !document.fonts)
        return () => { };
    if (!fontListeners) {
        const set = fontListeners = new Set();
        const notify = () => { fontCache = null; clearFitCache(); for (const l of [...set])
            l(); };
        document.fonts.addEventListener?.('loadingdone', notify);
        void loadSignFonts().then(notify);
    }
    fontListeners.add(listener);
    return () => { fontListeners?.delete(listener); };
}
export const signFontsLoaded = () => fontsLoaded;
const fontFor = (weight, px, family) => `${weight} ${px}px ${family}`;
function wrapWords(ctx, text, maxWidth, limit = Infinity) {
    const lines = [];
    let line = '';
    let broke = false;
    const push = () => { if (line) {
        lines.push(line);
        line = '';
    } };
    for (const word of text.split(' ')) {
        const candidate = line ? `${line} ${word}` : word;
        if (ctx.measureText(candidate).width <= maxWidth) {
            line = candidate;
            continue;
        }
        push();
        if (lines.length > limit)
            return { lines, broke, over: true };
        if (ctx.measureText(word).width <= maxWidth) {
            line = word;
            continue;
        }
        broke = true;
        if (limit !== Infinity)
            return { lines, broke, over: true };
        for (const char of word) {
            const next = line + char;
            if (ctx.measureText(next).width > maxWidth && line) {
                lines.push(line);
                line = char;
            }
            else
                line = next;
        }
    }
    push();
    return { lines, broke, over: lines.length > limit };
}
export function ellipsize(ctx, text, maxWidth, ellipsis = '…') {
    if (ctx.measureText(text).width <= maxWidth)
        return text;
    let low = 0, high = text.length;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (ctx.measureText(text.slice(0, mid).trimEnd() + ellipsis).width <= maxWidth)
            low = mid;
        else
            high = mid - 1;
    }
    return text.slice(0, low).trimEnd() + ellipsis;
}
const FIT_SCOPE = Symbol('fitScope');
const CANVAS_SCOPE = {};
const fitMemories = new WeakMap();
const FIT_MEMORY_SIZE = 512;
let fitEpoch = 0;
let watchingFonts = false;
export function clearFitCache() { fitEpoch++; }
const watchFonts = () => {
    if (watchingFonts)
        return;
    watchingFonts = true;
    if (typeof document !== 'undefined')
        document.fonts?.addEventListener?.('loadingdone', clearFitCache);
};
const isCanvasContext = (ctx) => (typeof CanvasRenderingContext2D !== 'undefined' && ctx instanceof CanvasRenderingContext2D) ||
    (typeof OffscreenCanvasRenderingContext2D !== 'undefined' && ctx instanceof OffscreenCanvasRenderingContext2D);
const TEXT_STATE = ['letterSpacing', 'wordSpacing', 'fontKerning', 'textRendering'];
const textState = (ctx) => {
    let state = '';
    for (const name of TEXT_STATE) {
        const value = ctx[name];
        if (typeof value === 'string')
            state += value + ',';
    }
    return state;
};
const scopeOf = (ctx) => ctx[FIT_SCOPE] ?? (isCanvasContext(ctx) ? CANVAS_SCOPE : ctx);
export function measuringContext(real) {
    const state = {};
    const gradient = { addColorStop() { } };
    const nothing = () => undefined;
    const scope = scopeOf(real);
    return new Proxy(state, {
        get(_, key) {
            if (key === 'measureText')
                return (text) => real.measureText(text);
            if (key === 'font')
                return real.font;
            if (key === FIT_SCOPE)
                return scope;
            if (key === 'canvas')
                return real.canvas;
            if (typeof key === 'string' && TEXT_STATE.includes(key))
                return real[key];
            if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createConicGradient')
                return () => gradient;
            return key in state ? state[key] : nothing;
        },
        set(_, key, value) {
            if (key === 'font')
                real.font = value;
            else
                state[key] = value;
            return true;
        },
    });
}
const copyOf = (fit) => ({ ...fit, lines: fit.lines.slice() });
export function fitText(ctx, text, o) {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
    const maxLines = Math.max(1, o.maxLines ?? 1);
    const lineHeight = o.lineHeight ?? 1.2;
    const weight = o.weight ?? 600;
    const step = Math.max(0.5, o.step ?? 2);
    const budget = o.maxHeight ?? Infinity;
    if (!clean) {
        ctx.font = fontFor(weight, o.minPx, o.family);
        return { lines: [], px: o.minPx, lineHeight, font: ctx.font, height: 0, truncated: false };
    }
    watchFonts();
    const scope = scopeOf(ctx);
    let memory = fitMemories.get(scope);
    if (!memory)
        fitMemories.set(scope, memory = { epoch: fitEpoch, results: new Map() });
    else if (memory.epoch !== fitEpoch) {
        memory.epoch = fitEpoch;
        memory.results.clear();
    }
    const key = `${o.maxWidth}|${maxLines}|${budget}|${o.minPx}|${o.maxPx}|${weight}|${o.family}|${lineHeight}|${step}|${o.ellipsis ?? ''}|${textState(ctx)}|${clean}`;
    const known = memory.results.get(key);
    if (known) {
        ctx.font = known.font;
        return copyOf(known);
    }
    const result = solveFit(ctx, clean, o, { maxLines, lineHeight, weight, step, budget });
    if (memory.results.size >= FIT_MEMORY_SIZE) {
        let drop = FIT_MEMORY_SIZE >> 2;
        for (const oldest of memory.results.keys()) {
            if (drop-- <= 0)
                break;
            memory.results.delete(oldest);
        }
    }
    memory.results.set(key, copyOf(result));
    return result;
}
function solveFit(ctx, clean, o, { maxLines, lineHeight, weight, step, budget }) {
    const grid = [];
    for (let px = o.maxPx; px >= o.minPx; px -= step)
        grid.push(px);
    const attempt = (px) => {
        ctx.font = fontFor(weight, px, o.family);
        const wrapped = wrapWords(ctx, clean, o.maxWidth, maxLines);
        return wrapped.over || wrapped.broke || wrapped.lines.length * px * lineHeight > budget ? null : wrapped.lines;
    };
    let best = null;
    let bestPx = o.minPx;
    let low = 0;
    let high = grid.length;
    if (high > 0) {
        const first = attempt(grid[0]);
        if (first) {
            best = first;
            bestPx = grid[0];
            high = 0;
        }
        else
            low = 1;
    }
    while (low < high) {
        const mid = (low + high) >> 1;
        const lines = attempt(grid[mid]);
        if (lines) {
            best = lines;
            bestPx = grid[mid];
            high = mid;
        }
        else
            low = mid + 1;
    }
    if (best) {
        ctx.font = fontFor(weight, bestPx, o.family);
        return { lines: best, px: bestPx, lineHeight, font: ctx.font, height: best.length * bestPx * lineHeight, truncated: false };
    }
    const px = o.minPx;
    ctx.font = fontFor(weight, px, o.family);
    const { lines } = wrapWords(ctx, clean, o.maxWidth);
    const room = Math.max(1, Math.min(maxLines, Math.floor(budget / (px * lineHeight))));
    if (lines.length <= room)
        return { lines, px, lineHeight, font: ctx.font, height: lines.length * px * lineHeight, truncated: false };
    const kept = lines.slice(0, room);
    kept[room - 1] = ellipsize(ctx, lines.slice(room - 1).join(' '), o.maxWidth, o.ellipsis);
    return { lines: kept, px, lineHeight, font: ctx.font, height: kept.length * px * lineHeight, truncated: true };
}
export function drawFit(ctx, fit, x, top, align = 'left') {
    ctx.font = fit.font;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    fit.lines.forEach((line, i) => ctx.fillText(line, x, top + (i + 0.5) * fit.px * fit.lineHeight + fit.px * 0.36));
}
export function roundRect(ctx, x, y, w, h, r) {
    const k = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + k, y);
    ctx.arcTo(x + w, y, x + w, y + h, k);
    ctx.arcTo(x + w, y + h, x, y + h, k);
    ctx.arcTo(x, y + h, x, y, k);
    ctx.arcTo(x, y, x + w, y, k);
    ctx.closePath();
}
const hexToRgb = (hex) => {
    const v = hex.replace('#', '');
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
};
const shade = (hex, amount) => {
    const [r, g, b] = hexToRgb(hex);
    const k = (c) => Math.max(0, Math.min(255, Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount))));
    return `rgb(${k(r)},${k(g)},${k(b)})`;
};
export function paintWood(ctx, r, o = {}) {
    const rand = mulberry32(hashSeed(o.seed ?? 'wood'));
    const base = o.base ?? TOKENS.woodDark;
    const boards = Math.max(1, Math.round(o.boards ?? 1));
    const grain = o.grain ?? 0.55;
    const s = Math.max(0.5, Math.min(r.w, r.h) / 140);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.fillStyle = base;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    const bh = r.h / boards;
    for (let b = 0; b < boards; b++) {
        const y0 = r.y + b * bh;
        ctx.fillStyle = rand() > 0.5 ? `rgba(255,236,200,${0.03 + rand() * 0.06})` : `rgba(20,12,4,${0.05 + rand() * 0.09})`;
        ctx.fillRect(r.x, y0, r.w, bh);
        const streaks = Math.max(3, Math.round((r.w / 40) * grain));
        for (let i = 0; i < streaks; i++) {
            const y = y0 + (0.08 + rand() * 0.84) * bh;
            const x = r.x + (rand() * 0.7 - 0.1) * r.w;
            const len = r.w * (0.18 + rand() * 0.5);
            const dark = rand() > 0.38;
            ctx.strokeStyle = dark ? `rgba(28,18,6,${0.10 + rand() * 0.16})` : `rgba(255,232,190,${0.06 + rand() * 0.1})`;
            ctx.lineWidth = (0.8 + rand() * 1.8) * s;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.bezierCurveTo(x + len * 0.3, y + (rand() - 0.5) * 5 * s, x + len * 0.65, y + (rand() - 0.5) * 5 * s, x + len, y + (rand() - 0.5) * 3 * s);
            ctx.stroke();
        }
        const knots = Math.round((o.knots ?? 1) * (bh > 40 * s ? 1 : 0.4) * rand() * 1.6);
        for (let k = 0; k < knots; k++) {
            const kx = r.x + (0.1 + rand() * 0.8) * r.w, ky = y0 + (0.3 + rand() * 0.4) * bh;
            for (let ring = 3; ring >= 1; ring--) {
                ctx.strokeStyle = `rgba(28,18,6,${0.12 + (3 - ring) * 0.07})`;
                ctx.lineWidth = 1.3 * s;
                ctx.beginPath();
                ctx.ellipse(kx, ky, ring * 4.5 * s, ring * 2.3 * s, 0, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
        if (b > 0) {
            ctx.fillStyle = 'rgba(20,12,4,0.55)';
            ctx.fillRect(r.x, y0 - 1.2 * s, r.w, 2.4 * s);
            ctx.fillStyle = 'rgba(255,236,200,0.14)';
            ctx.fillRect(r.x, y0 + 1.2 * s, r.w, 1.2 * s);
        }
    }
    if (o.edge !== false) {
        const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
        g.addColorStop(0, 'rgba(255,240,210,0.20)');
        g.addColorStop(0.1, 'rgba(255,240,210,0)');
        g.addColorStop(0.88, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.30)');
        ctx.fillStyle = g;
        ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    ctx.restore();
    if (o.nails) {
        const m = Math.min(r.h * 0.5, 16 * s);
        for (const [nx, ny] of [[r.x + m, r.y + m], [r.x + r.w - m, r.y + m], [r.x + m, r.y + r.h - m], [r.x + r.w - m, r.y + r.h - m]])
            drawNail(ctx, nx, ny, 4.2 * s);
    }
}
export function drawNail(ctx, x, y, radius) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.arc(x + radius * 0.25, y + radius * 0.35, radius * 1.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = TOKENS.woodDeep;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9b8f78';
    ctx.beginPath();
    ctx.arc(x - radius * 0.28, y - radius * 0.3, radius * 0.48, 0, Math.PI * 2);
    ctx.fill();
}
export function paintParchment(ctx, r, o = {}) {
    const rand = mulberry32(hashSeed(o.seed ?? 'paper'));
    const paper = o.paper ?? TOKENS.paper;
    const s = Math.max(0.5, Math.min(r.w, r.h) / 140);
    const radius = o.radius ?? 10 * s;
    const burn = o.burn ?? 0.5;
    ctx.save();
    roundRect(ctx, r.x, r.y, r.w, r.h, radius);
    ctx.clip();
    const g = ctx.createRadialGradient(r.x + r.w * 0.45, r.y + r.h * 0.4, Math.min(r.w, r.h) * 0.1, r.x + r.w / 2, r.y + r.h / 2, Math.max(r.w, r.h) * 0.75);
    g.addColorStop(0, shade(paper, 0.34));
    g.addColorStop(0.55, paper);
    g.addColorStop(1, shade(paper, -0.12 - burn * 0.12));
    ctx.fillStyle = g;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    for (let i = 0; i < 3; i++) {
        const cx = r.x + rand() * r.w, cy = r.y + rand() * r.h, rad = (0.15 + rand() * 0.25) * Math.max(r.w, r.h);
        const stain = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        stain.addColorStop(0, 'rgba(120,80,30,0.07)');
        stain.addColorStop(1, 'rgba(120,80,30,0)');
        ctx.fillStyle = stain;
        ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    ctx.lineWidth = 1 * s;
    const fibres = Math.round((r.w * r.h) / (2600 * s * s));
    for (let i = 0; i < fibres; i++) {
        const x = r.x + rand() * r.w, y = r.y + rand() * r.h, a = rand() * Math.PI, l = (4 + rand() * 9) * s;
        ctx.strokeStyle = `rgba(90,60,25,${0.04 + rand() * 0.06})`;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        ctx.stroke();
    }
    const edge = Math.min(r.w, r.h) * 0.07;
    const sides = [
        [r.x, r.y, r.x, r.y + edge, { x: r.x, y: r.y, w: r.w, h: edge }],
        [r.x, r.y + r.h, r.x, r.y + r.h - edge, { x: r.x, y: r.y + r.h - edge, w: r.w, h: edge }],
        [r.x, r.y, r.x + edge, r.y, { x: r.x, y: r.y, w: edge, h: r.h }],
        [r.x + r.w, r.y, r.x + r.w - edge, r.y, { x: r.x + r.w - edge, y: r.y, w: edge, h: r.h }],
    ];
    for (const [x0, y0, x1, y1, box] of sides) {
        const e = ctx.createLinearGradient(x0, y0, x1, y1);
        e.addColorStop(0, `rgba(88,52,16,${0.22 * burn + 0.04})`);
        e.addColorStop(1, 'rgba(88,52,16,0)');
        ctx.fillStyle = e;
        ctx.fillRect(box.x, box.y, box.w, box.h);
    }
    ctx.restore();
    if (o.rule !== false) {
        ctx.strokeStyle = 'rgba(87,78,55,0.55)';
        ctx.lineWidth = 2.2 * s;
        roundRect(ctx, r.x + 12 * s, r.y + 12 * s, r.w - 24 * s, r.h - 24 * s, Math.max(2, radius * 0.6));
        ctx.stroke();
        ctx.strokeStyle = 'rgba(87,78,55,0.28)';
        ctx.lineWidth = 1 * s;
        roundRect(ctx, r.x + 18 * s, r.y + 18 * s, r.w - 36 * s, r.h - 36 * s, Math.max(2, radius * 0.4));
        ctx.stroke();
    }
}
export function paintRibbon(ctx, r, color, deep) {
    const n = Math.min(r.h * 0.4, r.w * 0.2);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.moveTo(r.x + 2, r.y + 4);
    ctx.lineTo(r.x + r.w + 2, r.y + 4);
    ctx.lineTo(r.x + r.w - n + 2, r.y + r.h / 2 + 4);
    ctx.lineTo(r.x + r.w + 2, r.y + r.h + 4);
    ctx.lineTo(r.x + 2, r.y + r.h + 4);
    ctx.lineTo(r.x + n + 2, r.y + r.h / 2 + 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(r.x, r.y);
    ctx.lineTo(r.x + r.w, r.y);
    ctx.lineTo(r.x + r.w - n, r.y + r.h / 2);
    ctx.lineTo(r.x + r.w, r.y + r.h);
    ctx.lineTo(r.x, r.y + r.h);
    ctx.lineTo(r.x + n, r.y + r.h / 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = deep;
    ctx.beginPath();
    ctx.moveTo(r.x, r.y);
    ctx.lineTo(r.x + n * 0.55, r.y);
    ctx.lineTo(r.x + n, r.y + r.h / 2);
    ctx.lineTo(r.x + n * 0.55, r.y + r.h);
    ctx.lineTo(r.x, r.y + r.h);
    ctx.lineTo(r.x + n, r.y + r.h / 2);
    ctx.closePath();
    ctx.globalAlpha = 0.5;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(r.x + n, r.y, r.w - 2 * n, Math.max(1.5, r.h * 0.07));
    ctx.restore();
}
export function paintTag(ctx, text, x, y, h, fonts, o = {}) {
    const px = o.px ?? h * 0.5;
    ctx.font = fontFor(600, px, fonts.mono);
    const w = ctx.measureText(text).width + h * 0.9;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    roundRect(ctx, x + 1.5, y + 2.5, w, h, h * 0.22);
    ctx.fill();
    ctx.fillStyle = o.fill ?? TOKENS.woodDark;
    roundRect(ctx, x, y, w, h, h * 0.22);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,236,200,0.16)';
    ctx.fillRect(x + h * 0.2, y + 1, w - h * 0.4, 1.5);
    ctx.fillStyle = o.ink ?? TOKENS.cream;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, x + h * 0.45, y + h / 2 + px * 0.36);
    return w;
}
export function paintNumeral(ctx, value, r, o = {}) {
    const family = o.family ?? signFonts().sans;
    const fit = fitText(ctx, String(value), { maxWidth: r.w, minPx: 8, maxPx: Math.min(o.maxPx ?? r.h * 0.95, r.h * 0.95), weight: o.weight ?? 800, family, lineHeight: 1, step: 2 });
    const align = o.align ?? 'center';
    const x = align === 'center' ? r.x + r.w / 2 : align === 'left' ? r.x : r.x + r.w;
    const top = r.y + (r.h - fit.height) / 2;
    const offset = Math.max(1, fit.px * 0.045);
    ctx.fillStyle = o.shadow ?? 'rgba(0,0,0,0.38)';
    drawFit(ctx, fit, x + offset, top + offset, align);
    ctx.fillStyle = o.color ?? TOKENS.cream;
    drawFit(ctx, fit, x, top, align);
    return fit.px;
}
export function paintPips(ctx, count, total, r, o = {}) {
    const n = Math.max(1, Math.floor(total));
    const gap = o.gap ?? 0.35;
    const d = Math.min(r.h, r.w / (n + (n - 1) * gap));
    const used = d * n + d * gap * (n - 1);
    const x0 = r.x + (r.w - used) / 2, cy = r.y + r.h / 2;
    for (let i = 0; i < n; i++) {
        const cx = x0 + d / 2 + i * d * (1 + gap);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.arc(cx + d * 0.04, cy + d * 0.07, d * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = i < count ? (o.on ?? TOKENS.gold) : (o.off ?? TOKENS.woodDeep);
        ctx.beginPath();
        ctx.arc(cx, cy, d * 0.46, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = o.ring ?? 'rgba(26,23,18,0.7)';
        ctx.lineWidth = Math.max(1, d * 0.07);
        ctx.stroke();
        if (i < count) {
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.beginPath();
            ctx.arc(cx - d * 0.13, cy - d * 0.15, d * 0.14, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}
