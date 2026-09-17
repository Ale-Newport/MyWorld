import type { JSX } from 'react'

/* ============================================================
   "A LITTLE ABOUT ME" — THUMBNAILS FOR THE ADMIN'S PICKER

   One small, still drawing per option, evoking what it does. For
   the admin only: the public page never imports this file (the
   options themselves are loaded one chunk at a time through
   ../loaders.ts). No script, no animation; ink is currentColor
   so the picker decides it, and the one accent is the site's.
   ============================================================ */

const svg = { viewBox: '0 0 160 100', width: '100%', height: '100%', fill: 'none', 'aria-hidden': true } as const
const accent = 'var(--accent, #bf4f27)'
const signal = 'var(--signal, #2f6f5e)'

/** A folded band: lit face, a twist, shaded face, a twist, lit face. */
const ribbon = (
  <svg {...svg}>
    <path d="M14 70 C34 64 42 52 56 50 L62 50 C76 52 82 44 96 40 L102 39 C118 36 128 30 146 26" stroke="currentColor" strokeOpacity=".18" strokeWidth="13" strokeLinecap="butt" />
    <path d="M14 66 C30 61 38 52 52 48 L58 54 C44 58 34 68 16 74 Z" fill="currentColor" fillOpacity=".06" stroke="currentColor" strokeOpacity=".55" strokeWidth=".8" />
    <path d="M58 54 L52 48 C64 45 78 44 92 37 L98 43 C86 48 72 52 58 54 Z" fill="currentColor" fillOpacity=".22" stroke="currentColor" strokeOpacity=".55" strokeWidth=".8" />
    <path d="M98 43 L92 37 C108 32 124 27 144 21 L148 30 C130 34 114 39 98 43 Z" fill="currentColor" fillOpacity=".06" stroke="currentColor" strokeOpacity=".55" strokeWidth=".8" />
    <circle cx="34" cy="64" r="2.4" fill="var(--bg-primary, #f6f0e6)" stroke="currentColor" />
    <circle cx="76" cy="47" r="2.4" fill="var(--bg-primary, #f6f0e6)" stroke="currentColor" />
    <circle cx="122" cy="31" r="2.4" fill="var(--bg-primary, #f6f0e6)" stroke="currentColor" />
    <circle cx="146" cy="25.5" r="2" fill={accent} />
    <path d="M34 60v-14M76 43v-13M122 35v14" stroke="currentColor" strokeOpacity=".45" strokeWidth=".7" />
    <path d="M28 40h16M28 44h11M70 24h16M70 28h12M116 53h18M116 57h12" stroke="currentColor" strokeOpacity=".7" strokeWidth="1.6" />
  </svg>
)

/** A ruled editorial grid: roles above, columns of tools below, one piece still arriving. */
const assembly = (
  <svg {...svg}>
    <path d="M18 20h124M18 42h124M18 64h124M18 86h124M59 20v22M100 20v22M59 64v22M100 64v22" stroke="currentColor" strokeOpacity=".3" strokeWidth=".8" />
    <path d="M22 28h28M22 34h20M63 28h22M63 34h28M104 28h26M104 34h18" stroke="currentColor" strokeWidth="3.2" />
    <path d="M22 50h24M22 56h28" stroke="currentColor" strokeWidth="3.2" />
    <path d="M118 50h24M118 56h18" stroke="currentColor" strokeWidth="3.2" opacity=".55" />
    <path d="M150 53h8" stroke="currentColor" strokeOpacity=".45" strokeWidth=".8" strokeDasharray="2 2" />
    <path d="M22 70h14M63 70h14M104 70h14" stroke="currentColor" strokeOpacity=".5" strokeWidth="1.2" />
    <path d="M22 77h22M22 82h18M63 77h18M63 82h22M104 77h20" stroke="currentColor" strokeOpacity=".8" strokeWidth="1.6" />
    <path d="M12 18v-5h5" stroke={accent} strokeWidth="1" />
    <path d="M148 13h5v5M12 83v5h5M148 88h5v-5" stroke="currentColor" strokeOpacity=".6" strokeWidth="1" />
  </svg>
)

/** Nested mats stepping back in depth, the initials in the innermost window. */
const frame = (
  <svg {...svg}>
    <rect x="34" y="10" width="92" height="80" stroke="currentColor" strokeOpacity=".45" strokeWidth="5" opacity=".35" />
    <rect x="34" y="10" width="92" height="80" stroke="currentColor" strokeOpacity=".5" strokeWidth=".8" />
    <rect x="47" y="19" width="70" height="62" stroke="currentColor" strokeOpacity=".5" strokeWidth=".8" transform="rotate(-1.2 82 50)" />
    <rect x="58" y="27" width="50" height="46" stroke="currentColor" strokeOpacity=".55" strokeWidth=".8" transform="rotate(1 83 50)" />
    <rect x="67" y="33" width="34" height="34" stroke={accent} strokeWidth=".9" />
    <text x="84" y="56" textAnchor="middle" fontSize="17" fontWeight="500" letterSpacing="-1" fill="currentColor" style={{ fontFamily: 'var(--font-display, sans-serif)' }}>
      AN
    </text>
    <text x="80" y="58" textAnchor="middle" fontSize="17" fontWeight="500" letterSpacing="-1" stroke="currentColor" strokeOpacity=".4" strokeWidth=".5" style={{ fontFamily: 'var(--font-display, sans-serif)' }}>
      AN
    </text>
    <path d="M38 7h22M104 93h18" stroke="currentColor" strokeOpacity=".7" strokeWidth="1.4" />
  </svg>
)

/** Small constellations, each joined by its own figure, a few fine arcs between them. */
const constellation = (
  <svg {...svg}>
    <ellipse cx="80" cy="50" rx="56" ry="34" stroke="currentColor" strokeOpacity=".14" strokeWidth=".7" />
    <path d="M36 70Q70 56 112 26M40 66Q82 70 118 70" stroke={signal} strokeOpacity=".7" strokeWidth=".8" />
    <path d="M70 14l10 6 9-4M80 20l-2 9M106 20l8 6 8-2M114 26l2 9M28 30l9 5 4 9M118 64l9 4M110 72l8-4 6 9M32 66l8 4 9-3M40 70l-1 9" stroke="currentColor" strokeOpacity=".45" strokeWidth=".7" />
    <g fill="currentColor">
      <circle cx="70" cy="14" r="2" />
      <circle cx="89" cy="16" r="2.4" />
      <circle cx="78" cy="29" r="1.7" />
      <circle cx="106" cy="20" r="2" />
      <circle cx="122" cy="24" r="1.6" />
      <circle cx="116" cy="35" r="1.8" />
      <circle cx="37" cy="35" r="1.8" />
      <circle cx="41" cy="44" r="1.6" />
      <circle cx="127" cy="68" r="1.8" />
      <circle cx="110" cy="72" r="2" />
      <circle cx="124" cy="81" r="1.6" />
      <circle cx="32" cy="66" r="1.8" />
      <circle cx="49" cy="67" r="1.6" />
      <circle cx="39" cy="79" r="1.8" />
    </g>
    <circle cx="28" cy="30" r="1.8" stroke="currentColor" strokeWidth=".8" />
    <circle cx="80" cy="20" r="3" fill={accent} />
    <circle cx="40" cy="70" r="2.6" fill="currentColor" />
    <circle cx="118" cy="64" r="2.2" fill="currentColor" />
  </svg>
)

/** Large type crossing in its masks: one line solid, one being filled, a rule, the roll. */
const type = (
  <svg {...svg}>
    <text x="150" y="70" textAnchor="end" fontSize="64" fontWeight="500" letterSpacing="-4" fill="currentColor" fillOpacity=".06" style={{ fontFamily: 'var(--font-display, sans-serif)' }}>
      AN
    </text>
    <rect x="22" y="16" width="96" height="16" fill="currentColor" />
    <rect x="10" y="37" width="78" height="16" stroke="currentColor" strokeWidth="1" />
    <rect x="10" y="37" width="46" height="16" fill="currentColor" />
    <path d="M118 24h22M3 45h5" stroke="currentColor" strokeOpacity=".4" strokeWidth=".8" strokeDasharray="2 2" />
    <path d="M10 60h140" stroke="currentColor" strokeOpacity=".4" strokeWidth=".8" />
    <rect x="10" y="66.5" width="4" height="4" fill={accent} />
    <path d="M19 68.5h44" stroke="currentColor" strokeWidth="3.4" />
    <path d="M10 78h140M10 90h140" stroke="currentColor" strokeOpacity=".2" strokeWidth=".7" />
    <path d="M10 84h12M28 84h8M40 84h12M84 84h8M98 84h8M110 84h14" stroke="currentColor" strokeOpacity=".75" strokeWidth="1.3" />
  </svg>
)

export const ABOUT_THUMBS: Record<string, JSX.Element> = {
  'about.journey-ribbon': ribbon,
  'about.identity-assembly': assembly,
  'about.profile-frame': frame,
  'about.interest-constellation': constellation,
  'about.type-motion': type,
}
