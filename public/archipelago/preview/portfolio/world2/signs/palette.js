import * as THREE from 'three';
export const SWATCH = {
    grey: 0, sand: 1, woodDark: 2, sky: 3, silver: 4, dark: 5, slate: 6, peach: 7,
    gold: 8, sage: 9, salmon: 10, tan: 11, olive: 12, khaki: 13, copper: 14, orange: 15,
    redOrange: 16, paleRose: 17, lightOrange: 18, crimson: 19, purple: 20, pink: 21, ink: 22, white: 23,
};
export const SWATCH_COUNT = 32;
export const PALETTE_HEX = [
    '#7c7691', '#ebd1a3', '#574e37', '#3dbbe7', '#c8c2c1', '#4a413c', '#575a5e', '#eec3af',
    '#e4a90c', '#91ad78', '#e49a78', '#988165', '#abae2b', '#a49876', '#b36d45', '#e46202',
    '#ed3f1c', '#fde6e2', '#f8a658', '#c30e3a', '#c365ef', '#ed72a0', '#1e0603', '#fff2e8',
];
export const TOKENS = {
    ink: '#1a1712',
    ink2: '#443d31',
    ink3: '#675e4f',
    cream: '#f6f0e6',
    paper: '#f1d8a6',
    paperHi: '#f8e8c4',
    paperDeep: '#d8b680',
    chalk: '#e9d3a3',
    woodDark: '#574e37',
    woodDeep: '#4a413c',
    woodMid: '#988165',
    copper: '#b36d45',
    timber: '#f8a658',
    gold: '#e4a90c',
    terracotta: '#bf4f27',
    terracottaDeep: '#8d3515',
    teal: '#2f6f5e',
    leaf: '#4b6a1d',
    sage: '#91ad78',
    sky: '#3dbbe7',
};
const clampIndex = (index) => Math.max(0, Math.min(SWATCH_COUNT - 1, Math.round(index)));
export const paletteU = (index) => (clampIndex(index) + 0.5) / SWATCH_COUNT;
export const paletteUV = (index) => [paletteU(index), 0.5];
export const swatchOf = (u) => Math.max(0, Math.min(SWATCH_COUNT - 1, Math.floor(u * SWATCH_COUNT)));
export function recolorPalette(target, map) {
    const geometry = target instanceof THREE.BufferGeometry ? target : target.geometry;
    const uv = geometry.getAttribute('uv');
    if (!uv)
        return 0;
    const next = new Float32Array(uv.count * 2);
    let changed = 0;
    for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i);
        next[i * 2] = u;
        next[i * 2 + 1] = uv.getY(i);
        const to = map[swatchOf(u)];
        if (to !== undefined && swatchOf(u) !== to) {
            next[i * 2] = paletteU(to);
            changed++;
        }
    }
    if (changed)
        geometry.setAttribute('uv', new THREE.BufferAttribute(next, 2));
    return changed;
}
export function swatchHistogram(target) {
    const geometry = target instanceof THREE.BufferGeometry ? target : target.geometry;
    const uv = geometry.getAttribute('uv');
    const out = {};
    if (!uv)
        return out;
    for (let i = 0; i < uv.count; i++) {
        const s = swatchOf(uv.getX(i));
        out[s] = (out[s] ?? 0) + 1;
    }
    return out;
}
export function relativeLuminance(hex) {
    const value = hex.replace('#', '');
    const channel = (offset) => {
        const c = parseInt(value.slice(offset, offset + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}
export function contrastRatio(a, b) {
    const la = relativeLuminance(a), lb = relativeLuminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
