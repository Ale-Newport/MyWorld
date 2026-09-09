'use client'

import type { TechNode } from '@/content/types'
import { techLogos } from '@/content/tech-logos'
import styles from './tech-tile.module.css'

/* ============================================================
   TECH TILE
   One app icon per technology. The brand marks are Simple Icons
   geometry (CC0-1.0); the marks themselves remain the
   trademarks of their owners and are used nominatively — to
   identify the technologies behind real projects — with no
   claim of endorsement or affiliation. See
   THIRD_PARTY_NOTICES.md.

   Where there is no mark — a concept such as "Deep Learning",
   or a trademark Simple Icons does not carry — the tile draws a
   house glyph instead. Approximating someone's logo from memory
   would be both a worse drawing and a worse citizen.
   ============================================================ */

interface TechTileProps {
  node: TechNode
  /** The technology currently previewed or pinned, if any. */
  active: string | null
  pinned: boolean
  onPreview: (id: string | null) => void
  onToggle: (id: string) => void
}

export function TechTile({ node, active, pinned, onPreview, onToggle }: TechTileProps) {
  const logo = techLogos[node.id]
  const count = node.evidence.length
  const on = active === node.id

  /* The name leads, so the wall is navigable by name alone; the
     evidence follows it, for anyone who can read neither the
     count badge nor the dashed edge. */
  const label = `${node.name} — ${count > 0 ? `${count} project${count === 1 ? '' : 's'}` : 'no public repository yet'}`

  return (
    <button
      type="button"
      className={styles.tile}
      data-on={on}
      data-pinned={pinned}
      data-dim={active !== null && !on}
      data-weight={node.weight}
      data-evidence={count > 0}
      aria-pressed={pinned}
      aria-label={label}
      title={node.name}
      data-cursor="link"
      onMouseEnter={() => onPreview(node.id)}
      onMouseLeave={() => onPreview(null)}
      onFocus={() => onPreview(node.id)}
      onBlur={() => onPreview(null)}
      onClick={() => onToggle(node.id)}
    >
      <span className={styles.plate}>
        <span
          className={styles.mark}
          style={logo ? { ['--brand' as string]: logo.ink } : undefined}
        >
          {logo ? (
            <svg viewBox="0 0 24 24" width="100%" height="100%" className={styles.brand} aria-hidden="true">
              <path d={logo.path} />
            </svg>
          ) : (
            <HouseGlyph id={node.id} name={node.name} />
          )}
        </span>
        {count > 0 && <span className={styles.count} aria-hidden="true">{count}</span>}
      </span>
      <span className={styles.name}>{node.name}</span>
    </button>
  )
}

/* ------------------------------------------------------------
   HOUSE GLYPHS
   Drawn with the same pen as ModuleGlyph — 40×40, line art, one
   stroke weight, currentColor — so a concept sits beside a brand
   mark without either looking imported.
   ------------------------------------------------------------ */

const pen = {
  width: '100%', height: '100%', viewBox: '0 0 40 40',
  fill: 'none', stroke: 'currentColor', strokeWidth: 1,
} as const

/* One cloud, two platforms: what sits inside it says which. */
const cloud = 'M9 28H29A6 6 0 0 0 28.4 16.1A8 8 0 0 0 13.2 14.6A7.5 7.5 0 0 0 9 28Z'

function HouseGlyph({ id, name }: { id: string; name: string }) {
  switch (id) {
    case 'sql': // A store, and a query leaving it
      return (
        <svg {...pen} aria-hidden="true">
          <ellipse cx="20" cy="9" rx="11" ry="4" />
          <path d="M9 9v8c0 2.2 4.9 4 11 4s11-1.8 11-4V9" />
          <path d="M9 17v7c0 2.2 4.9 4 11 4s11-1.8 11-4v-7" strokeOpacity="0.5" />
          <path d="M13 33h11m-3-3 3 3-3 3" />
        </svg>
      )
    case 'prolog': // An inference rule: premises over the bar
      return (
        <svg {...pen} aria-hidden="true">
          <rect x="6" y="8" width="11" height="7" />
          <rect x="23" y="8" width="11" height="7" />
          <path d="M4 20h32" />
          <rect x="14.5" y="25" width="11" height="7" />
        </svg>
      )
    case 'csharp': // The letter and the sharp, not the logo
      return (
        <svg {...pen} aria-hidden="true">
          <path d="M22 13A8.5 8.5 0 1 0 22 27" />
          <path d="M26 12.5v14M31 12.5v14" />
          <path d="M24 18.5l9-1.4M24 24.5l9-1.4" />
        </svg>
      )
    case 'javafx': // A desktop window with its controls
      return (
        <svg {...pen} aria-hidden="true">
          <rect x="5" y="8" width="30" height="24" />
          <path d="M5 14h30" />
          <circle cx="9" cy="11" r="1.1" fill="currentColor" stroke="none" />
          <rect x="9" y="18" width="10" height="5" />
          <path d="M23 19h8M23 22.5h5" strokeOpacity="0.5" />
          <path d="M9 27.5h18" strokeOpacity="0.4" />
          <circle cx="17" cy="27.5" r="2.2" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'deeplearning': { // Four layers: the depth is the point
      const layers: [number, number[]][] = [
        [6, [14, 26]],
        [16, [9, 17, 25, 33]],
        [26, [9, 17, 25, 33]],
        [35, [14, 26]],
      ]
      return (
        <svg {...pen} aria-hidden="true">
          <g strokeOpacity="0.26">
            {layers.slice(0, -1).map(([x, ys], i) =>
              ys.map((y) =>
                layers[i + 1][1].map((y2) => (
                  <path key={`${i}-${y}-${y2}`} d={`M${x} ${y} L${layers[i + 1][0]} ${y2}`} />
                )),
              ),
            )}
          </g>
          {layers.map(([x, ys]) =>
            ys.map((y) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r="1.8" fill="currentColor" stroke="none" />
            )),
          )}
        </svg>
      )
    }
    case 'cv': // A lens, framed by focus brackets
      return (
        <svg {...pen} aria-hidden="true">
          <path d="M4 9V4h5M36 9V4h-5M4 31v5h5M36 31v5h-5" strokeOpacity="0.55" />
          <circle cx="20" cy="20" r="10" />
          <circle cx="20" cy="20" r="4.5" strokeOpacity="0.6" />
          <circle cx="16.5" cy="16.5" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'nlp': // A source retrieved into an answer
      return (
        <svg {...pen} aria-hidden="true">
          <rect x="4" y="9" width="12" height="17" />
          <path d="M7 14h6M7 18h6M7 22h4" strokeOpacity="0.5" />
          <path d="M18 17.5h6m-2.5-2.5 2.5 2.5-2.5 2.5" />
          <path d="M26 10h10v12h-5l-4 4v-4h-1z" />
        </svg>
      )
    case 'rl': // Agent acts, environment answers, reward follows
      return (
        <svg {...pen} aria-hidden="true">
          <rect x="4" y="12" width="12" height="10" />
          <rect x="24" y="12" width="12" height="10" />
          <path d="M16 15h8m-2.5-2.5 2.5 2.5-2.5 2.5" />
          <path d="M24 19h-8m2.5-2.5L16 19l2.5 2.5" />
          <path d="M20 27v6M17 30h6" strokeOpacity="0.75" />
        </svg>
      )
    case 'mcts': // A tree with one rollout committed to
      return (
        <svg {...pen} aria-hidden="true">
          <path d="M20 9 8 18M8 20 4 30M8 20l5 10M32 20l-5 10" strokeOpacity="0.35" />
          <path d="M20 9l12 9M32 20l3 10" strokeWidth="1.5" />
          <circle cx="20" cy="7" r="2.2" fill="currentColor" stroke="none" />
          <circle cx="8" cy="19" r="1.9" fill="currentColor" stroke="none" fillOpacity="0.4" />
          <circle cx="32" cy="19" r="1.9" fill="currentColor" stroke="none" />
          {[[4, 31], [13, 31], [27, 31]].map(([x, y]) => (
            <circle key={x} cx={x} cy={y} r="1.6" fill="currentColor" stroke="none" fillOpacity="0.4" />
          ))}
          <circle cx="35" cy="31" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'evaluation': // A confusion matrix, diagonal weighted
      return (
        <svg {...pen} aria-hidden="true">
          <path d="M9 6v26h26" strokeOpacity="0.45" />
          <rect x="12" y="8" width="10" height="10" fill="currentColor" stroke="none" fillOpacity="0.8" />
          <rect x="24" y="8" width="10" height="10" fill="currentColor" stroke="none" fillOpacity="0.16" />
          <rect x="12" y="20" width="10" height="10" fill="currentColor" stroke="none" fillOpacity="0.16" />
          <rect x="24" y="20" width="10" height="10" fill="currentColor" stroke="none" fillOpacity="0.8" />
        </svg>
      )
    case 'features': // Raw observations become a few strong signals
      return (
        <svg {...pen} aria-hidden="true">
          <rect x="4" y="8" width="13" height="24" strokeOpacity="0.4" />
          {[[7, 13], [13, 16], [9, 21], [14, 26], [7, 29]].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="1.4" fill="currentColor" stroke="none" fillOpacity="0.75" />
          ))}
          <path d="M19 20h5m-2.5-2.5L24 20l-2.5 2.5" />
          <rect x="26" y="25" width="3" height="7" fill="currentColor" stroke="none" fillOpacity="0.55" />
          <rect x="31" y="18" width="3" height="14" fill="currentColor" stroke="none" />
          <rect x="36" y="22" width="3" height="10" fill="currentColor" stroke="none" fillOpacity="0.75" />
        </svg>
      )
    case 'eda': // A box plot: the first thing you draw of a column
      return (
        <svg {...pen} aria-hidden="true">
          <path d="M4 33h32" strokeOpacity="0.45" />
          <path d="M7 20h7M26 20h7" />
          <path d="M7 14v12M33 14v12" />
          <rect x="14" y="11" width="12" height="18" />
          <path d="M19 11v18" strokeWidth="1.6" />
        </svg>
      )
    case 'testing': // A report: two pass, one fails loudly
      return (
        <svg {...pen} aria-hidden="true">
          <path d="M8 12.5l2.4 2.6 5-6" strokeWidth="1.5" />
          <path d="M8 20.5l2.4 2.6 5-6" strokeWidth="1.5" />
          <path d="M8.5 26.5l6 6m0-6-6 6" strokeWidth="1.5" />
          <path d="M20 13h13M20 21h10M20 29h7" strokeOpacity="0.5" />
        </svg>
      )
    case 'concurrency': // Threads that interleave and carry on
      return (
        <svg {...pen} aria-hidden="true">
          <path d="M4 20h32" strokeOpacity="0.4" />
          <path d="M4 11h8c6 0 6 18 12 18h12" />
          <path d="M4 29h8c6 0 6-18 12-18h12" />
        </svg>
      )
    case 'crypto': // A key
      return (
        <svg {...pen} aria-hidden="true">
          <circle cx="12" cy="20" r="6.5" />
          <circle cx="12" cy="20" r="2.2" fill="currentColor" stroke="none" />
          <path d="M18.5 20H35" />
          <path d="M27 20v5M31.5 20v4" />
        </svg>
      )
    case 'aws': // A cloud with racks in it: compute and storage
      return (
        <svg {...pen} aria-hidden="true">
          <path d={cloud} />
          <rect x="14" y="18" width="12" height="4" strokeOpacity="0.6" />
          <rect x="14" y="23.5" width="12" height="4" strokeOpacity="0.6" />
        </svg>
      )
    case 'azure': // The same cloud, tiled with resources
      return (
        <svg {...pen} aria-hidden="true">
          <path d={cloud} />
          <rect x="14.5" y="17.5" width="4.5" height="4.5" strokeOpacity="0.6" />
          <rect x="21" y="17.5" width="4.5" height="4.5" strokeOpacity="0.6" />
          <rect x="17.75" y="23" width="4.5" height="4.5" strokeOpacity="0.6" />
        </svg>
      )
    default: // Nothing honest left to draw: set the initial instead
      return (
        <svg {...pen} aria-hidden="true">
          <rect x="6" y="6" width="28" height="28" rx="7" strokeDasharray="3 3" strokeOpacity="0.45" />
          <text
            x="20" y="21" className={styles.monogram}
            textAnchor="middle" dominantBaseline="middle"
            fill="currentColor" stroke="none"
          >
            {name.charAt(0)}
          </text>
        </svg>
      )
  }
}
