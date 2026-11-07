'use client'

import { setTheme, useTheme } from './theme'

/* The sun and the moon, drawn with the chrome's hairline. One button: it says what it will do. */
export function ThemeToggle({ className, labelClassName }: { className?: string; labelClassName?: string }) {
  const theme = useTheme()
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      className={className}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-pressed={dark}
      aria-label="Dark mode"
      data-cursor="link"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true" focusable="false">
        {dark ? (
          <>
            <circle cx="8" cy="8" r="3" />
            <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
          </>
        ) : (
          <path d="M13.2 10.1A5.6 5.6 0 0 1 5.9 2.8a5.6 5.6 0 1 0 7.3 7.3Z" />
        )}
      </svg>
      <span className={labelClassName}>{dark ? 'LIGHT' : 'DARK'}</span>
    </button>
  )
}
