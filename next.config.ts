import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /* A production build normally writes to `.next`, which is also where
     `next dev` keeps its state — so building while a dev server is up
     restarts it mid-compile. `NEXT_DIST_DIR` lets a verification build
     go somewhere else and leave the running server alone. Unset in CI
     and in deployment, where the default is what you want. */
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  transpilePackages: ['three'],
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  // Next's file tracer otherwise omits the Worker-specific pg socket files.
  outputFileTracingIncludes: {
    '**/*': ['./node_modules/pg-cloudflare/dist/**', './node_modules/pg-cloudflare/esm/**'],
  },
  async redirects() {
    // The retired second world: old links land on the one world.
    const redirects = [{ source: '/world2', destination: '/world', permanent: true }]
    /* On your own machine the app is the editor, not the website: the public pages answer only to the
       editor's own previews (which switch Draft Mode on first) and send everything else to the editor.
       The website is the deployed one. `npm run dev:site` (CMS_SHOW_SITE=1) shows it, for working on its code. */
    const editor = process.env.NODE_ENV !== 'production' || process.env.CMS_EDITOR === '1'
    if (editor && process.env.CMS_SHOW_SITE !== '1') {
      const missing = [{ type: 'cookie' as const, key: '__prerender_bypass' }]
      for (const source of ['/', '/projects/:path*', '/world']) redirects.push({ source, missing, destination: '/admin', permanent: false } as never)
    }
    return redirects
  },
  /* The admin is never indexed, framed by another site, or sent as a referrer.
     These were a Node.js middleware (src/proxy.ts); as plain headers they cost no
     separate bundle to load on a cold start. Who may enter is decided on the
     server by requireAdmin() / adminApi(), never here. */
  async headers() {
    const admin = [
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
    ]
    return [
      { source: '/admin', headers: admin },
      { source: '/admin/:path*', headers: admin },
    ]
  },
  experimental: {
    optimizePackageImports: ['@react-three/drei'],
  },
}

export default nextConfig
