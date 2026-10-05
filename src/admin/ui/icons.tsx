/* One icon set for the whole admin, world editor included: 20-unit
   grid, 1.5 stroke, round joins, currentColor. Decorative by default
   (the control around it carries the name). */

const paths = {
  website: <><rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2" /><path d="M2.75 7.25h14.5M5.5 5.5h.01M7.75 5.5h.01" /></>,
  world: <><circle cx="10" cy="10" r="7.25" /><path d="M2.75 10h14.5M10 2.75c2.2 2.3 2.2 12.2 0 14.5M10 2.75c-2.2 2.3-2.2 12.2 0 14.5" /></>,
  audience: <><path d="M3 16.5h14" /><path d="M5.5 14V9.5M10 14V5M14.5 14v-6.5" /></>,
  settings: <><path d="M4 5.5h12M4 10h12M4 14.5h12" /><circle cx="7.5" cy="5.5" r="1.6" fill="var(--a-panel, #fff)" /><circle cx="12.5" cy="10" r="1.6" fill="var(--a-panel, #fff)" /><circle cx="8.5" cy="14.5" r="1.6" fill="var(--a-panel, #fff)" /></>,
  pages: <><path d="M5.25 2.75h6.5l3 3v11.5h-9.5z" /><path d="M11.75 2.75v3h3M7.75 9.5h4.5M7.75 12.5h4.5" /></>,
  projects: <><rect x="3" y="3" width="6" height="6" rx="1.25" /><rect x="11" y="3" width="6" height="6" rx="1.25" /><rect x="3" y="11" width="6" height="6" rx="1.25" /><rect x="11" y="11" width="6" height="6" rx="1.25" /></>,
  media: <><rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2" /><circle cx="7.25" cy="8" r="1.4" /><path d="m3.5 15 4.25-4 3 2.5 2.5-2 3.25 3" /></>,
  history: <><path d="M3.5 10a6.5 6.5 0 1 0 1.9-4.6" /><path d="M3.25 3.5v2.25H5.5M10 6.5V10l2.5 1.75" /></>,
  external: <><path d="M11.5 3.5h5v5M16.25 3.75 9.5 10.5" /><path d="M14.5 11.5v4.25a.75.75 0 0 1-.75.75H4.25a.75.75 0 0 1-.75-.75V6.25a.75.75 0 0 1 .75-.75H8.5" /></>,
  signout: <><path d="M8 3.5H4.25a.75.75 0 0 0-.75.75v11.5c0 .41.34.75.75.75H8" /><path d="M12.5 6.5 16 10l-3.5 3.5M16 10H7.5" /></>,
  phone: <><rect x="6" y="2.75" width="8" height="14.5" rx="1.75" /><path d="M9.25 14.75h1.5" /></>,
  tablet: <><rect x="4" y="2.75" width="12" height="14.5" rx="1.75" /><path d="M9.25 14.75h1.5" /></>,
  laptop: <><rect x="4.25" y="4.25" width="11.5" height="8.5" rx="1.25" /><path d="M2.5 15.75h15" /></>,
  desktop: <><rect x="2.75" y="3.25" width="14.5" height="10" rx="1.5" /><path d="M7.5 16.75h5M10 13.25v3.5" /></>,
  wide: <><rect x="1.75" y="4.75" width="16.5" height="8.5" rx="1.5" /><path d="M7.5 16.25h5M10 13.25v3" /></>,
  eye: <><path d="M2.5 10s2.75-5 7.5-5 7.5 5 7.5 5-2.75 5-7.5 5-7.5-5-7.5-5z" /><circle cx="10" cy="10" r="2.25" /></>,
  check: <path d="m4.5 10.5 3.5 3.5 7.5-8" />,
  chevron: <path d="m6 8 4 4 4-4" />,
  close: <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />,
  expand: <path d="M11.75 3.5h4.75v4.75M8.25 16.5H3.5v-4.75M16.5 3.5l-5 5M3.5 16.5l5-5" />,
  collapse: <path d="M15.75 8.25H11.75V4.25M4.25 11.75h4v4M11.75 8.25l4.75-4.75M8.25 11.75 3.5 16.5" />,
  undo: <><path d="M7.5 5.5 4 9l3.5 3.5" /><path d="M4.5 9h7a4 4 0 0 1 0 8H9" /></>,
  redo: <><path d="M12.5 5.5 16 9l-3.5 3.5" /><path d="M15.5 9h-7a4 4 0 0 0 0 8H11" /></>,
  play: <path d="M6.5 4.5v11l9-5.5z" />,
  reset: <><path d="M4 10a6 6 0 1 0 1.8-4.25" /><path d="M4 3.75V6.5h2.75" /></>,
  leaf: <><path d="M4 16c0-7 4.5-11.5 12-12-0.5 7.5-5 12-12 12z" /><path d="M4 16 11 9" /></>,
  menu: <path d="M3.5 6h13M3.5 10h13M3.5 14h13" />,
}

export type IconName = keyof typeof paths

export function Icon({ name, size = 18, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="a-ico"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {paths[name]}
    </svg>
  )
}
