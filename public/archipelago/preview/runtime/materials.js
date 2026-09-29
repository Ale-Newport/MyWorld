import * as THREE from 'three';
import { palette } from './palette.js';
const SPECS = {
    // Clipped box hedge, and the lighter green of new growth on top of it.
    hedge: { color: '#5e7f4f', roughness: 0.95, metalness: 0 },
    foliageLight: { color: '#729651', roughness: 0.95, metalness: 0 },
    // Bare softwood: pallets, barriers, the labyrinth's signs, crates.
    // Matches the wood bucket SceneryDetails already uses, so dressing
    // and scenery do not disagree about what a plank looks like.
    timber: { color: '#9f875f', roughness: 0.88, metalness: 0 },
    sandbag: { color: '#b9ad86', roughness: 0.95, metalness: 0 },
    // The time machine's rings were building this ad hoc every boot.
    brass: { color: '#c2b974', roughness: 0.4, metalness: 0.45 },
    hazard: { color: '#e2b33a', roughness: 0.7, metalness: 0 },
    // The one COOL light on a warm island: the black hole's, and
    // anything else that is supposed to look wrong.
    emissiveCool: { color: '#9fd7ff', kind: 'basic' },
    paper: { color: palette.paper, roughness: 0.92, metalness: 0 },
    paperDark: { color: palette.paper3, roughness: 0.94, metalness: 0 },
    concrete: { color: palette.concrete, roughness: 0.88, metalness: 0 },
    concreteDark: { color: palette.concreteDark, roughness: 0.9, metalness: 0 },
    graphite: { color: palette.ink2, roughness: 0.62, metalness: 0.12 },
    ink: { color: palette.ink, roughness: 0.7, metalness: 0.05 },
    asphalt: { color: palette.asphalt, roughness: 0.95, metalness: 0 },
    metal: { color: palette.metal, roughness: 0.38, metalness: 0.55 },
    accent: { color: palette.accent, roughness: 0.5, metalness: 0.05 },
    accentDeep: { color: palette.accentDeep, roughness: 0.55, metalness: 0.05 },
    signal: { color: palette.signal, roughness: 0.55, metalness: 0.05 },
    chalk: { color: palette.chalk, roughness: 0.85, metalness: 0 },
    glass: {
        color: palette.glass, roughness: 0.12, metalness: 0.2,
        transparent: true, opacity: 0.42,
    },
    // Emissives are `basic`: they must not be re-lit, or they go grey
    // in shadow and stop reading as lights at night.
    emissiveAccent: { color: palette.accent, kind: 'basic' },
    emissiveWhite: { color: '#fff6ea', kind: 'basic' },
    emissiveSignal: { color: palette.signalSoft, kind: 'basic' },
    emissiveAmber: { color: '#ffb066', kind: 'basic' },
    lineInk: { color: palette.ink2, kind: 'line', transparent: true, opacity: 0.5 },
    lineAccent: { color: palette.accent, kind: 'line', transparent: true, opacity: 0.7 },
    lineChalk: { color: palette.chalk2, kind: 'line', transparent: true, opacity: 0.45 },
};
export class Materials {
    bin;
    cache = new Map();
    constructor(bin) {
        this.bin = bin;
    }
    get(name) {
        const existing = this.cache.get(name);
        if (existing)
            return existing;
        const spec = SPECS[name];
        let material;
        if (spec.kind === 'line') {
            material = new THREE.LineBasicMaterial({
                color: spec.color,
                transparent: spec.transparent ?? false,
                opacity: spec.opacity ?? 1,
            });
        }
        else if (spec.kind === 'basic') {
            material = new THREE.MeshBasicMaterial({
                color: spec.color,
                transparent: spec.transparent ?? false,
                opacity: spec.opacity ?? 1,
                side: spec.side ?? THREE.FrontSide,
                toneMapped: false,
            });
        }
        else {
            material = new THREE.MeshStandardMaterial({
                color: spec.color,
                roughness: spec.roughness ?? 0.8,
                metalness: spec.metalness ?? 0,
                flatShading: spec.flatShading ?? true,
                transparent: spec.transparent ?? false,
                opacity: spec.opacity ?? 1,
                emissive: new THREE.Color(spec.emissive ?? '#000000'),
                emissiveIntensity: spec.emissiveIntensity ?? 1,
                side: spec.side ?? THREE.FrontSide,
            });
        }
        material.name = name;
        this.cache.set(name, material);
        this.bin.add(() => material.dispose());
        return material;
    }
    /** A one-off tinted standard material, cached by colour. */
    tinted(color, roughness = 0.8, metalness = 0) {
        const key = `tint_${color}_${roughness}_${metalness}`;
        const existing = this.cache.get(key);
        if (existing)
            return existing;
        const material = new THREE.MeshStandardMaterial({
            color, roughness, metalness, flatShading: true,
        });
        material.name = key;
        this.cache.set(key, material);
        this.bin.add(() => material.dispose());
        return material;
    }
    /** A one-off unlit colour, cached. Used for signage and lights. */
    flat(color, opacity = 1) {
        const key = `flat_${color}_${opacity}`;
        const existing = this.cache.get(key);
        if (existing)
            return existing;
        const material = new THREE.MeshBasicMaterial({
            color,
            transparent: opacity < 1,
            opacity,
            toneMapped: false,
        });
        material.name = key;
        this.cache.set(key, material);
        this.bin.add(() => material.dispose());
        return material;
    }
    /** Registers a bespoke material so it is disposed with everything else. */
    own(material) {
        this.bin.add(() => material.dispose());
        return material;
    }
}
/**
 * Draws text into a power-of-two-ish canvas and returns a texture
 * plus the aspect ratio, so callers can size a plane to match
 * rather than stretching the glyphs.
 */
export function textTexture(options) {
    const size = options.size ?? 128;
    const padding = options.padding ?? size * 0.4;
    const weight = options.weight ?? 600;
    const font = options.font ?? 'ui-sans-serif, system-ui, -apple-system, Helvetica, Arial, sans-serif';
    const sublineScale = options.sublineScale ?? 0.52;
    const lines = [options.text, ...(options.sublines ?? [])];
    const measure = document.createElement('canvas').getContext('2d');
    if (!measure)
        throw new Error('[world] 2D canvas unavailable');
    const widths = lines.map((line, i) => {
        const scale = i === 0 ? 1 : sublineScale;
        measure.font = `${weight} ${size * scale}px ${font}`;
        const spacing = (options.letterSpacing ?? 0) * size * scale * Math.max(0, line.length - 1);
        return measure.measureText(line).width + spacing;
    });
    const lineHeights = lines.map((_, i) => size * (i === 0 ? 1.14 : sublineScale * 1.4));
    const contentWidth = Math.max(...widths, 1);
    const contentHeight = lineHeights.reduce((a, b) => a + b, 0);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.ceil(contentWidth + padding * 2));
    canvas.height = Math.max(2, Math.ceil(contentHeight + padding * 2));
    const ctx = canvas.getContext('2d');
    if (!ctx)
        throw new Error('[world] 2D canvas unavailable');
    if (options.background) {
        ctx.fillStyle = options.background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.fillStyle = options.color ?? palette.ink;
    ctx.textBaseline = 'top';
    ctx.textAlign = options.align ?? 'center';
    let y = padding;
    lines.forEach((line, i) => {
        const scale = i === 0 ? 1 : sublineScale;
        ctx.font = `${weight} ${size * scale}px ${font}`;
        const x = ctx.textAlign === 'center' ? canvas.width / 2 : padding;
        if (options.letterSpacing) {
            // Manual tracking: `letterSpacing` on 2D contexts is still
            // patchy, and the technical labels rely on wide tracking.
            const spacing = options.letterSpacing * size * scale;
            const total = ctx.measureText(line).width + spacing * Math.max(0, line.length - 1);
            let cursor = ctx.textAlign === 'center' ? x - total / 2 : x;
            const previousAlign = ctx.textAlign;
            ctx.textAlign = 'left';
            for (const char of line) {
                ctx.fillText(char, cursor, y);
                cursor += ctx.measureText(char).width + spacing;
            }
            ctx.textAlign = previousAlign;
        }
        else {
            ctx.fillText(line, x, y);
        }
        y += lineHeights[i];
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return { texture, aspect: canvas.width / canvas.height };
}
/** The "AN" monogram used on the vehicle and on district plates. */
export function monogramTexture(color = palette.paper, background = null) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx)
        throw new Error('[world] 2D canvas unavailable');
    if (background) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, 128, 128);
    }
    ctx.fillStyle = color;
    ctx.font = '700 62px ui-sans-serif, system-ui, Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('AN', 64, 68);
    // A rule under the mark, like the site's own lockup.
    ctx.fillRect(30, 100, 68, 3);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
}
/**
 * A world-space sign: dark plate, light type, readable from the car.
 *
 * Lived on `Playground` as a method, which made every caller depend
 * on Playground having been constructed — and Playground is built
 * two-thirds of the way through `Game.init`, after the mini-games.
 * The Labyrinth called it from its constructor and took the whole
 * world down with "Cannot read properties of undefined". It is a
 * pure function of `textTexture`; it belongs here.
 */
export function signLabel(text, parent, at, width, height) {
    const [first, ...sublines] = text.split('\n');
    const { texture: map } = textTexture({ text: first, sublines, size: 256, color: '#eee9d7', background: '#2e423b' });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide }));
    mesh.position.copy(at);
    parent.add(mesh);
    return mesh;
}
