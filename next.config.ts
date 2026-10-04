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
  experimental: {
    optimizePackageImports: ['@react-three/drei'],
  },
  /* The world seed is read from disk (src/server/world.ts) by these routes until the
     first world save; ship it with them, and nothing else of the project. */
  outputFileTracingIncludes: {
    '/api/world/**': ['./content/seed/world/**'],
    '/api/admin/world/**': ['./content/seed/world/**'],
    '/admin': ['./content/seed/world/**'],
  },
}

export default nextConfig
