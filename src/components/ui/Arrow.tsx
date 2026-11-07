/* ============================================================
   ARROWS ARE DRAWN, NOT TYPED
   "↗" is an emoji on iOS: the site's faces do not carry it, so
   Safari falls back to Apple Color Emoji and a quiet link note
   turns into a blue tile. Every arrow the site prints is this
   one stroke instead — currentColor, the size of the type
   around it (1em), sitting on its baseline like a glyph.
   ============================================================ */

const PATHS = {
  'up-right': 'M4.5 11.5 11.5 4.5M5.5 4.5h6v6',
  right: 'M2.5 8h11M9 3.5 13.5 8 9 12.5',
  left: 'M13.5 8h-11M7 3.5 2.5 8 7 12.5',
  down: 'M8 2.5v11M3.5 9 8 13.5 12.5 9',
} as const

export type ArrowDirection = keyof typeof PATHS

export function Arrow({ dir = 'up-right', className }: { dir?: ArrowDirection; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="square"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'inline-block', verticalAlign: '-0.12em', flex: 'none' }}
    >
      <path d={PATHS[dir]} />
    </svg>
  )
}
