export const DEFAULT_ACCENT = '#2f6b3f';
const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (value) => typeof value === 'string' && HEX.test(value);
function requested() {
    if (typeof window === 'undefined')
        return DEFAULT_ACCENT;
    try {
        const handed = window.frameElement?.getAttribute('data-accent');
        if (isHex(handed))
            return handed.toLowerCase();
        if (window.parent !== window) {
            const inherited = getComputedStyle(window.parent.document.documentElement).getPropertyValue('--accent').trim();
            if (isHex(inherited))
                return inherited.toLowerCase();
        }
    }
    catch { }
    return DEFAULT_ACCENT;
}
export function mixHex(a, b, t) {
    const ca = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
    const cb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
    return '#' + ca.map((v, i) => Math.round(v + (cb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
export const ACCENT = requested();
export const ACCENT_SOFT = mixHex(ACCENT, '#ffffff', 0.3);
export const ACCENT_DEEP = mixHex(ACCENT, '#000000', 0.3);
