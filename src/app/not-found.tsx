import { themeScript } from '@/components/site/theme-script'
import { FirstPaintScript } from '@/components/site/FirstPaintScript'
import { LostInSpace } from './LostInSpace'

/* The page for an address that leads nowhere. It is outside the
   public site's layout, so it carries the theme's first-paint script
   itself: a visitor who chose the dark is not lost in daylight. */
export default function NotFound() {
  return (
    <>
      <FirstPaintScript code={themeScript} />
      <LostInSpace />
    </>
  )
}
