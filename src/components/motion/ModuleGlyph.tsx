'use client'

import type { Module } from '@/content/education'

/**
 * Each academic module is drawn as the structure it teaches —
 * a graph, a tree, a scheduler, a cipher, a module diagram —
 * rather than illustrated with an icon.
 */
export function ModuleGlyph({ kind }: { kind: Module['visual'] }) {
  const common = { width: 40, height: 40, viewBox: '0 0 40 40', fill: 'none', stroke: 'currentColor', strokeWidth: 1 } as const

  switch (kind) {
    case 'graph': // Data structures — nodes and edges
      return (
        <svg {...common} aria-hidden="true">
          <path d="M20 7 L8 18 M20 7 L32 18 M8 18 L14 32 M32 18 L26 32 M14 32 L26 32 M8 18 L26 32" />
          {[[20, 7], [8, 18], [32, 18], [14, 32], [26, 32]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="2.4" fill="currentColor" stroke="none" />
          ))}
        </svg>
      )
    case 'tree': // Databases — B-tree index
      return (
        <svg {...common} aria-hidden="true">
          <rect x="13" y="5" width="14" height="6" />
          <rect x="4" y="17" width="12" height="6" />
          <rect x="24" y="17" width="12" height="6" />
          <rect x="4" y="29" width="8" height="6" />
          <rect x="16" y="29" width="8" height="6" />
          <rect x="28" y="29" width="8" height="6" />
          <path d="M18 11 L10 17 M22 11 L30 17 M8 23 L8 29 M12 23 L20 29 M30 23 L32 29" />
        </svg>
      )
    case 'schedule': // Operating systems — process scheduling
      return (
        <svg {...common} aria-hidden="true">
          <path d="M3 10 H37 M3 20 H37 M3 30 H37" strokeOpacity="0.3" />
          <rect x="4" y="7" width="9" height="6" fill="currentColor" stroke="none" />
          <rect x="16" y="7" width="6" height="6" fill="currentColor" fillOpacity="0.4" stroke="none" />
          <rect x="6" y="17" width="13" height="6" fill="currentColor" fillOpacity="0.55" stroke="none" />
          <rect x="24" y="17" width="7" height="6" fill="currentColor" stroke="none" />
          <rect x="10" y="27" width="8" height="6" fill="currentColor" fillOpacity="0.3" stroke="none" />
          <rect x="22" y="27" width="12" height="6" fill="currentColor" fillOpacity="0.7" stroke="none" />
        </svg>
      )
    case 'cipher': // Cryptography — plaintext transformed
      return (
        <svg {...common} aria-hidden="true">
          <path d="M4 12 h10 M4 20 h10 M4 28 h6" strokeOpacity="0.85" />
          <path d="M18 20 h6 m-3-3 3 3 -3 3" />
          <path d="M28 9 v22 M32 9 v22 M36 9 v22" strokeDasharray="2 3" />
          <rect x="17" y="14" width="7" height="12" strokeOpacity="0.35" />
        </svg>
      )
    case 'modules': // Software engineering — modules assembling
      return (
        <svg {...common} aria-hidden="true">
          <rect x="5" y="5" width="12" height="12" />
          <rect x="23" y="5" width="12" height="12" />
          <rect x="5" y="23" width="12" height="12" />
          <rect x="23" y="23" width="12" height="12" fill="currentColor" fillOpacity="0.18" />
          <path d="M17 11 h6 M11 17 v6 M29 17 v6 M17 29 h6" />
        </svg>
      )
    case 'matrix':
      return (
        <svg {...common} aria-hidden="true">
          {[0, 1, 2, 3].map((r) =>
            [0, 1, 2, 3].map((c) => (
              <rect key={`${r}${c}`} x={6 + c * 8} y={6 + r * 8} width="5" height="5"
                fill="currentColor" stroke="none" fillOpacity={0.15 + ((r * 4 + c) % 5) * 0.19} />
            )),
          )}
        </svg>
      )
    case 'network':
      return (
        <svg {...common} aria-hidden="true">
          {[10, 20, 30].map((y) => <circle key={`a${y}`} cx="7" cy={y} r="2" fill="currentColor" stroke="none" />)}
          {[8, 16, 24, 32].map((y) => <circle key={`b${y}`} cx="20" cy={y} r="2" fill="currentColor" stroke="none" />)}
          {[15, 25].map((y) => <circle key={`c${y}`} cx="33" cy={y} r="2" fill="currentColor" stroke="none" />)}
          <g strokeOpacity="0.32">
            {[10, 20, 30].map((y1) => [8, 16, 24, 32].map((y2) => (
              <path key={`${y1}-${y2}`} d={`M9 ${y1} L18 ${y2}`} />
            )))}
            {[8, 16, 24, 32].map((y1) => [15, 25].map((y2) => (
              <path key={`x${y1}-${y2}`} d={`M22 ${y1} L31 ${y2}`} />
            )))}
          </g>
        </svg>
      )
    case 'mining':
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="16" cy="18" r="11" strokeOpacity="0.4" />
          <path d="M24 26 L35 36" strokeWidth="1.6" />
          {[[12, 14], [18, 13], [15, 21], [21, 20], [10, 20], [19, 25]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="1.6" fill="currentColor" stroke="none" fillOpacity={i < 3 ? 1 : 0.35} />
          ))}
        </svg>
      )
    case 'verify':
      return (
        <svg {...common} aria-hidden="true">
          <rect x="6" y="6" width="28" height="28" strokeOpacity="0.4" />
          <path d="M11 20 l6 6 12 -14" strokeWidth="1.6" />
          <path d="M6 13 h28" strokeOpacity="0.25" />
        </svg>
      )
    case 'stats':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M5 34 H36" strokeOpacity="0.4" />
          <path d="M5 34 C 12 34, 12 8, 20 8 S 28 34, 35 34" />
          <path d="M20 8 V34" strokeDasharray="2 3" strokeOpacity="0.5" />
        </svg>
      )
    default:
      return <svg {...common} aria-hidden="true"><circle cx="20" cy="20" r="10" /></svg>
  }
}
