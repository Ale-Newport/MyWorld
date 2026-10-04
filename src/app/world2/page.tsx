import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import { World2Route } from '@/world2/World2Route'
export const metadata: Metadata = {
  title: 'World 02',
  description: 'Drive the original folio-2025 Blender island with the portfolio’s vehicle, controls and camera.',
  alternates: { canonical: '/world2' },
  robots: { index: false, follow: true },
}
/*
  The browser chrome on a phone takes this route's ground colour, so
  the frame after the garden parts is one colour from edge to edge.
  It must move with `.route`'s background in world2.module.css.
*/
export const viewport: Viewport = { themeColor: '#dce3dc' }
export default function World2Page() {
  return <><noscript>World 02 needs JavaScript and WebGL. <Link href="/">Visit the portfolio</Link>.</noscript><World2Route /></>
}
