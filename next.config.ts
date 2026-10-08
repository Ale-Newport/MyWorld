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
  experimental: {
    optimizePackageImports: ['@react-three/drei'],
  },
}

export default nextConfig
