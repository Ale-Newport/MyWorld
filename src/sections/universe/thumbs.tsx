import type { JSX } from 'react'

/* ============================================================
   THE PICKER'S THUMBNAILS — admin only

   One small still drawing per Universe option, for the admin's
   choice of animation. Static SVG in the site's palette (cream
   ground, warm ink hairlines, one terracotta accent), no script
   and no motion. The public page never imports this file.
   ============================================================ */

const INK = '#1a1712'
const INK3 = '#675e4f'
const INK4 = '#8b816f'
const ACCENT = '#bf4f27'
const TEAL = '#2f6f5e'
const GROUND = '#f6f0e6'
const PAPER = '#fbf7ef'

const frame = (children: JSX.Element, label: string) => (
  <svg viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={label}>
    <rect width="160" height="100" fill={GROUND} />
    {children}
  </svg>
)

/** Points on an ellipse, for the orbits. */
const on = (cx: number, cy: number, rx: number, ry: number, a: number): [number, number] => [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]

const orbits = frame(
  <g fill="none" strokeWidth="0.75">
    {[
      [26, 9],
      [46, 16],
      [66, 23],
    ].map(([rx, ry], k) => (
      <g key={k}>
        <path d={`M ${80 - rx} 50 A ${rx} ${ry} 0 0 1 ${80 + rx} 50`} stroke={INK} strokeOpacity="0.32" strokeDasharray="1 3" strokeLinecap="round" />
        <path d={`M ${80 + rx} 50 A ${rx} ${ry} 0 0 1 ${80 - rx} 50`} stroke={INK} strokeOpacity="0.28" />
      </g>
    ))}
    <path d="M 62.5 56.3 A 26 9 0 0 0 80 59" stroke={ACCENT} strokeWidth="1.4" strokeOpacity="0.7" strokeLinecap="round" />
    <circle cx="80" cy="50" r="3.2" stroke={INK} strokeOpacity="0.4" />
    <circle cx="80" cy="50" r="1.3" fill={INK} />
    {[0.4, 1.9, 3.5].map((a, i) => {
      const [x, y] = on(80, 50, 26, 9, a + 1.2)
      return <circle key={`h${i}`} cx={x} cy={y} r="2.3" fill={i === 0 ? ACCENT : INK3} />
    })}
    {Array.from({ length: 9 }, (_, i) => {
      const [x, y] = on(80, 50, 46, 16, (i / 9) * Math.PI * 2 + 0.3)
      return <circle key={`f${i}`} cx={x} cy={y} r="1.5" fill={i % 3 ? INK4 : TEAL} />
    })}
    {Array.from({ length: 14 }, (_, i) => {
      const [x, y] = on(80, 50, 66, 23, (i / 14) * Math.PI * 2 + 0.1)
      return <circle key={`a${i}`} cx={x} cy={y} r="1" fill={INK4} />
    })}
  </g>,
  'Orbital system',
)

const constellation = frame(
  <g>
    <g stroke={INK} strokeOpacity="0.3" strokeWidth="0.7" fill="none">
      <polyline points="22,30 34,22 46,34 40,48 26,52" />
      <line x1="46" y1="34" x2="58" y2="28" />
      <polyline points="72,62 86,54 98,64 92,76" />
      <line x1="86" y1="54" x2="84" y2="40" />
      <polyline points="114,26 128,34 138,24" />
      <line x1="128" y1="34" x2="126" y2="50" />
      <line x1="46" y1="34" x2="84" y2="40" strokeDasharray="1 2.5" />
    </g>
    <g stroke={ACCENT} strokeOpacity="0.55" strokeWidth="0.6">
      <line x1="86" y1="48" x2="86" y2="60" />
      <line x1="80" y1="54" x2="92" y2="54" />
    </g>
    <circle cx="86" cy="54" r="4" fill={ACCENT} fillOpacity="0.16" />
    <circle cx="86" cy="54" r="2.2" fill={ACCENT} />
    {[
      [22, 30, 1.2],
      [34, 22, 1.6],
      [46, 34, 2],
      [40, 48, 1.2],
      [26, 52, 1.2],
      [58, 28, 1.2],
      [72, 62, 1.3],
      [98, 64, 1.6],
      [92, 76, 1.2],
      [84, 40, 1.4],
      [114, 26, 1.2],
      [128, 34, 1.8],
      [138, 24, 1.2],
      [126, 50, 1.3],
    ].map(([x, y, r], i) => (
      <circle key={i} cx={x} cy={y} r={r} fill={i % 4 === 1 ? TEAL : INK3} />
    ))}
    <g fontFamily="monospace" fontSize="4" letterSpacing="1" fill={INK4}>
      <text x="22" y="16">WEB</text>
      <text x="112" y="16">SOFTWARE</text>
    </g>
  </g>,
  'Project constellation',
)

const gallery = frame(
  <g>
    <path d="M 4 22 Q 80 30 156 22" fill="none" stroke={INK} strokeOpacity="0.26" strokeWidth="0.7" />
    <path d="M 4 84 Q 80 76 156 84" fill="none" stroke={INK} strokeOpacity="0.16" strokeWidth="0.7" />
    {[
      [18, 0.86, -18],
      [49, 0.94, -8],
      [80, 1, 0],
      [111, 0.94, 8],
      [142, 0.86, 18],
    ].map(([x, k, skew], i) => {
      const w = 22 * k
      const h = 30 * k
      const top = 52 - h / 2
      return (
        <g key={i} transform={`translate(${x} 0) skewY(${skew * 0.15})`}>
          <path d={`M ${-w * 0.26} ${top} L 0 ${top - 9} L ${w * 0.26} ${top}`} fill="none" stroke={INK} strokeOpacity="0.35" strokeWidth="0.6" />
          <rect x={-w / 2} y={top} width={w} height={h} fill={i === 2 ? '#f6e3d6' : PAPER} stroke={i === 2 ? ACCENT : INK} strokeOpacity={i === 2 ? 1 : 0.55} strokeWidth="0.7" />
          <rect x={-w / 2 + 3} y={top + 4} width={w * 0.5} height="1.2" fill={INK4} />
          <rect x={-w / 2 + 3} y={top + 9} width={w - 6} height="1.6" fill={INK3} />
          <rect x={-w / 2 + 3} y={top + 12.5} width={w - 9} height="1.6" fill={INK3} />
          <rect x={-w / 2 + 3} y={top + h - 5} width={w * 0.24} height="1.2" fill={i === 2 ? ACCENT : INK4} />
          <rect x={-w * 0.3} y={top + h + 4} width={w * 0.6} height="1.6" fill={INK3} />
        </g>
      )
    })}
  </g>,
  'Dimensional gallery',
)

const mosaic = frame(
  <g>
    {[
      [8, 8, 34, 40, 'h'],
      [46, 8, 34, 18, 'f'],
      [84, 8, 16, 18, 'a'],
      [104, 8, 48, 18, 'f'],
      [46, 30, 16, 18, 'a'],
      [66, 30, 34, 18, 'f'],
      [104, 30, 16, 18, 'a'],
      [124, 30, 28, 18, 'a'],
      [8, 52, 16, 18, 'a'],
      [28, 52, 34, 18, 'f'],
      [66, 52, 34, 40, 'h'],
      [104, 52, 48, 18, 'f'],
      [8, 74, 16, 18, 'a'],
      [28, 74, 16, 18, 'a'],
      [48, 74, 14, 18, 'a'],
      [104, 74, 22, 18, 'a'],
      [130, 74, 22, 18, 'a'],
    ].map(([x, y, w, h, t], i) => (
      <g key={i} transform={i === 5 ? 'translate(1.5 -1.5)' : undefined}>
        <rect
          x={x as number}
          y={y as number}
          width={w as number}
          height={h as number}
          rx="1.5"
          fill={t === 'h' ? '#f6e3d6' : PAPER}
          stroke={i === 5 ? ACCENT : INK}
          strokeOpacity={i === 5 ? 1 : 0.18}
          strokeWidth="0.7"
        />
        <rect x={(x as number) + 3} y={(y as number) + 3} width="2" height="2" fill={t === 'h' ? ACCENT : i % 3 ? INK4 : TEAL} />
        <rect x={(x as number) + 3} y={(y as number) + (h as number) - 6} width={Math.min((w as number) - 6, t === 'h' ? 18 : 12)} height={t === 'h' ? 2.4 : 1.6} fill={INK3} />
      </g>
    ))}
  </g>,
  'Magnetic mosaic',
)

const field = frame(
  <g>
    {Array.from({ length: 5 }, (_, r) =>
      Array.from({ length: 7 }, (_, c) => {
        const cx = 14 + c * 22
        const cy = 14 + r * 18
        const d = Math.hypot((cx - 80) / 160, ((cy - 50) / 100) * 0.82)
        if (d > 0.5) return null
        const t = d < 0.12 ? 0 : d < 0.28 ? 1 : 2
        const w = [20, 17, 15][t]
        const h = [16, 14, 9][t]
        return (
          <g key={`${r}-${c}`}>
            <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx="1.5" fill={t === 0 ? '#f6e3d6' : PAPER} fillOpacity={t === 2 ? 0.7 : 1} stroke={INK} strokeOpacity={t === 2 ? 0.12 : 0.2} strokeWidth="0.6" />
            <circle cx={cx - w / 2 + 3} cy={cy - h / 2 + 3} r="0.9" fill={t === 0 ? ACCENT : INK4} />
            <rect x={cx - w / 2 + 2.5} y={cy + h / 2 - 4} width={w * 0.55} height="1.3" fill={t === 2 ? INK4 : INK3} />
          </g>
        )
      }),
    )}
  </g>,
  'Layered field',
)

export const UNIVERSE_THUMBS: Record<string, JSX.Element> = {
  'universe.orbits': orbits,
  'universe.constellation': constellation,
  'universe.gallery': gallery,
  'universe.mosaic': mosaic,
  'universe.layered-field': field,
}
