/* ============================================================
   THE SITE'S ACCENT, IN THE WORLD

   The portfolio has one signal colour, chosen in the editor
   (`settings.accent`, a forest green unless it says otherwise),
   and the world wears the same one: the JUMP button, the pressed
   PLANE, the focus bar's Back, the ribbons and seals of the signs,
   the counters on the plaques. The car is the exception — it is
   orange because it is a car, not because it is a signal.

   The page that hosts the world hands the colour to its frame on
   the frame element itself (`data-accent`, WorldRoute), set before
   the frame loads, so it is known at module evaluation, before
   anything is painted into a canvas: a sign's ribbon is baked into
   its texture once and never read again. Not on the frame's
   address: nothing in the runtime reads its URL but the QA switches
   (runtime/qa-switches.js), so no link a visitor is given can
   change it. A frame opened without one (the studio, a QA script)
   takes the host page's `--accent` when it can read it, and the
   default otherwise.

   The lighter and darker shades are worked out from it the same
   way as the site's own (styles/accent.ts): mixed with white and
   with black, so an editor's colour gets its pressed and glowing
   tones without anyone choosing three.
   ============================================================ */

/** The site's accent when none has been chosen (styles/accent.ts). */
export const DEFAULT_ACCENT = '#2f6b3f'

const HEX = /^#[0-9a-f]{6}$/i

export const isHex = (value: unknown): value is string => typeof value === 'string' && HEX.test(value)

function requested(): string {
  if (typeof window === 'undefined') return DEFAULT_ACCENT
  try {
    const handed = window.frameElement?.getAttribute('data-accent')
    if (isHex(handed)) return handed.toLowerCase()
    if (window.parent !== window) {
      const inherited = getComputedStyle(window.parent.document.documentElement).getPropertyValue('--accent').trim()
      if (isHex(inherited)) return inherited.toLowerCase()
    }
  } catch { /* a host on another origin: neither its frame element nor its styles are ours to read */ }
  return DEFAULT_ACCENT
}

/** `a` moved `t` of the way towards `b`, both #rrggbb. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const cb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  return '#' + ca.map((v, i) => Math.round(v + (cb[i] - v) * t).toString(16).padStart(2, '0')).join('')
}

export const ACCENT = requested()
/** Lighter, for fills and glows. */
export const ACCENT_SOFT = mixHex(ACCENT, '#ffffff', 0.3)
/** Darker, for pressed states and the fold of a ribbon. */
export const ACCENT_DEEP = mixHex(ACCENT, '#000000', 0.3)
