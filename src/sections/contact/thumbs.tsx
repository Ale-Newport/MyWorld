import type { JSX, ReactNode } from 'react'

/* ============================================================
   END OF JOURNEY — PICKER THUMBNAILS

   One small, still drawing per option for the admin's picker: the
   stage in miniature (the closing words as a terracotta bar, the
   links' hairline below) and the option's own motif around it.
   Plain inline SVG, no script and no animation. Never imported by
   the public page.
   ============================================================ */

const BG = '#f6f0e6'
const INK = '#1a1712'
const INK3 = '#675e4f'
const INK4 = '#8b816f'
const ACCENT = '#bf4f27'
const TEAL = '#2f6f5e'
const STEM = '#8d7659'

/** The stage: plaster, the closing words, the links' rule. */
function Stage({ children, label }: { children: ReactNode; label: string }) {
  return (
    <svg viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label={label}>
      <rect width="160" height="100" fill={BG} />
      {children}
      <rect x="52" y="45" width="56" height="9" rx="1" fill={ACCENT} />
      <line x1="12" y1="80" x2="148" y2="80" stroke={INK} strokeOpacity=".16" strokeWidth=".6" />
      {[12, 46, 80, 114].map((x) => (
        <rect key={x} x={x} y="83.5" width="22" height="1.6" fill={INK3} opacity=".35" />
      ))}
    </svg>
  )
}

/** A pointed leaf from (x, y) along angle a (degrees), as a path. */
function leaf(x: number, y: number, a: number, len: number, wid: number) {
  const r = (a * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r)
  const P = (u: number, v: number) => `${(x + c * u * len - s * v * wid).toFixed(1)} ${(y + s * u * len + c * v * wid).toFixed(1)}`
  return `M${P(0, 0)} Q${P(0.35, 1)} ${P(1, 0)} Q${P(0.35, -1)} ${P(0, 0)}Z`
}

/** Leaves along a polyline, alternating sides. */
function leaves(points: [number, number][], len: number, wid: number, spread = 55) {
  const out: string[] = []
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i]
    const a = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI
    out.push(leaf(x1, y1, a + (i % 2 ? spread : -spread), len, wid))
  }
  return out.join(' ')
}

const vineL: [number, number][] = [[2, 72], [6, 62], [9, 52], [12, 43], [17, 34], [24, 27], [32, 21], [41, 17], [51, 14], [61, 13], [69, 13]]
const vineR = vineL.map(([x, y]) => [160 - x, y] as [number, number])
const frondL: [number, number][] = [[0, 50], [6, 46], [12, 43], [18, 41], [24, 40], [30, 40], [35, 41]]
const frondR = frondL.map(([x, y]) => [160 - x, y + 6] as [number, number])
const poly = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${x} ${y}`).join(' L')}`

const BotanicalGateway = (
  <Stage label="Botanical gateway">
    <path d={leaves(frondL, 5, 1.2, 70)} fill="#c9d3c2" />
    <path d={leaves(frondR, 5, 1.2, 70)} fill="#c9d3c2" />
    <path d={poly(frondL)} fill="none" stroke="#b9ad97" strokeWidth=".5" />
    <path d={poly(frondR)} fill="none" stroke="#b9ad97" strokeWidth=".5" />
    <path d={poly(vineL)} fill="none" stroke={STEM} strokeWidth=".6" />
    <path d={poly(vineR)} fill="none" stroke={STEM} strokeWidth=".6" />
    <path d={leaves(vineL, 4.2, 1.5)} fill="#9fb59a" />
    <path d={leaves(vineR, 4.2, 1.5)} fill="#9fb59a" />
    {[[24, 27], [51, 14], [136, 27], [109, 14]].map(([x, y]) => (
      <circle key={`${x}`} cx={x} cy={y - 3} r="1.3" fill="#fbf8f2" stroke={INK4} strokeWidth=".3" />
    ))}
    <path d={leaf(-2, 30, -18, 22, 4.5)} fill="#7f9479" />
    <path d={leaf(-2, 66, -40, 18, 4)} fill="#86997c" />
    <path d={leaf(162, 34, 200, 21, 4.5)} fill="#7f9479" />
    <path d={leaf(162, 70, 222, 17, 4)} fill="#86997c" />
  </Stage>
)

const ConvergingPaths = (
  <Stage label="Converging paths">
    {/* The ground covered, teal; the way still ahead, dotted. */}
    <path d="M0 22 C 30 24, 56 32, 80 36" fill="none" stroke={TEAL} strokeOpacity=".7" strokeWidth=".8" />
    <path d="M0 66 C 14 58, 18 42, 34 36 S 60 33, 70 34" fill="none" stroke={TEAL} strokeOpacity=".7" strokeWidth=".8" />
    <path d="M160 26 C 132 26, 106 32, 80 36" fill="none" stroke={TEAL} strokeOpacity=".7" strokeWidth=".8" />
    <path d="M160 64 C 146 56, 142 40, 126 36 S 100 34, 92 35" fill="none" stroke={INK4} strokeWidth=".9" strokeDasharray=".1 2.2" strokeLinecap="round" />
    <circle cx="70" cy="34" r="1.2" fill="none" stroke={INK4} strokeWidth=".4" />
    <circle cx="92" cy="35" r="1.6" fill={INK3} />
    <circle cx="92" cy="35" r="3" fill="none" stroke={INK3} strokeOpacity=".5" strokeWidth=".4" />
    <circle cx="80" cy="36" r="5.5" fill="none" stroke={ACCENT} strokeOpacity=".4" strokeWidth=".5" />
    <circle cx="80" cy="36" r="2.2" fill={ACCENT} />
  </Stage>
)

/** An isometric slab centred at (x, y). */
function slab(x: number, y: number, w = 7, d = 3.6, t = 2) {
  return (
    <g key={`${x},${y}`}>
      <path d={`M${x - w} ${y} L${x} ${y + d} L${x} ${y + d + t} L${x - w} ${y + t}Z`} fill="#e6dccc" stroke={INK} strokeOpacity=".2" strokeWidth=".3" />
      <path d={`M${x} ${y + d} L${x + w} ${y} L${x + w} ${y + t} L${x} ${y + d + t}Z`} fill="#cdbfa9" stroke={INK} strokeOpacity=".2" strokeWidth=".3" />
      <path d={`M${x - w} ${y} L${x} ${y - d} L${x + w} ${y} L${x} ${y + d}Z`} fill="#fbf8f3" stroke={INK} strokeOpacity=".2" strokeWidth=".3" />
    </g>
  )
}

const SteppingPath = (
  <Stage label="Stepping path">
    <defs>
      <linearGradient id="contact-thumb-door" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#c9d8d1" />
        <stop offset="1" stopColor="#f1cfa6" />
      </linearGradient>
    </defs>
    {/* The landing and its arch, then the stones from the top one down. */}
    {slab(124, 30, 11, 5.6, 2.6)}
    <path d="M118 30 L118 16 Q124 8 130 16 L130 30Z" fill="#e6dccc" stroke={INK} strokeOpacity=".22" strokeWidth=".35" />
    <path d="M120.5 29.5 L120.5 17 Q124 11.5 127.5 17 L127.5 29.5Z" fill="url(#contact-thumb-door)" />
    <line x1="120.5" y1="29.6" x2="127.5" y2="29.6" stroke={ACCENT} strokeWidth=".8" />
    {[[136, 41], [143, 50], [150, 59], [156, 68]].map(([x, y]) => slab(x, y))}
  </Stage>
)

const ContourHorizon = (
  <Stage label="Contour horizon">
    <g fill="none" stroke={STEM} strokeLinecap="round">
      <path d="M44 34 C 60 30, 100 30, 116 34 C 124 40, 124 58, 116 63 C 100 67, 60 67, 44 63 C 36 58, 36 40, 44 34Z" strokeOpacity=".45" strokeWidth=".45" />
      <path d="M36 27 C 58 21, 104 23, 124 27 C 136 36, 135 60, 126 69 C 104 75, 58 74, 34 70 C 24 60, 25 36, 36 27Z" strokeOpacity=".7" strokeWidth=".8" />
      <path d="M26 19 C 56 12, 108 15, 134 20 C 148 34, 150 62, 140 74 M20 75 C 10 62, 12 32, 26 19" strokeOpacity=".45" strokeWidth=".45" />
      <path d="M14 11 C 50 4, 112 6, 146 12 M8 74 C 0 60, 2 26, 14 11 M152 74 C 160 56, 158 26, 146 12" strokeOpacity=".35" strokeWidth=".45" />
      <path d="M8 40 C 12 34, 18 36, 18 42 C 18 48, 10 48, 8 40Z M148 50 C 152 44, 157 46, 156 52 C 155 57, 149 56, 148 50Z" strokeOpacity=".4" strokeWidth=".45" />
    </g>
  </Stage>
)

const RibbonAperture = (
  <Stage label="Ribbon aperture">
    {/* Three ribbons around the words, each turning once to show its darker back. */}
    <path d="M30 70 C 22 44, 34 22, 62 18 L80 17 L80 20 L62 21 C 38 25, 28 44, 34 70Z" fill="#a9c5bb" />
    <path d="M80 17 L98 18 C 126 22, 138 44, 130 70 L126 70 C 132 44, 122 25, 98 21 L80 20Z" fill={TEAL} fillOpacity=".85" />
    <path d="M20 72 C 10 40, 28 12, 66 9 L66 13 C 32 16, 16 42, 24 72Z" fill="#c4b39a" />
    <path d="M66 9 L94 9 C 132 12, 150 40, 140 72 L136 72 C 144 42, 128 16, 94 13 L66 13Z" fill="#8d7659" fillOpacity=".75" />
    <path d="M12 74 C 2 36, 26 4, 80 3 C 134 4, 158 36, 148 74 L145 74 C 154 38, 130 7, 80 6 C 30 7, 6 38, 15 74Z" fill="#fbf8f2" stroke={INK} strokeOpacity=".18" strokeWidth=".3" />
  </Stage>
)

export const CONTACT_THUMBS: Record<string, JSX.Element> = {
  'contact.botanical-gateway': BotanicalGateway,
  'contact.converging-paths': ConvergingPaths,
  'contact.stepping-path': SteppingPath,
  'contact.contour-horizon': ContourHorizon,
  'contact.ribbon-aperture': RibbonAperture,
}
