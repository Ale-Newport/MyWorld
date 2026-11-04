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
  // The retired second world: old links land on the one world.
  async redirects() {
    return [{ source: '/world2', destination: '/world', permanent: true }]
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
