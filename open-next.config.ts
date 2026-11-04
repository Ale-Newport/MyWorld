import { defineCloudflareConfig } from '@opennextjs/cloudflare'
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache'

/* The deployed site is prerendered at build from the content committed in the repository
   (content/published, the world seed) and does not revalidate: a publish is a commit and a
   deploy. The prerendered pages and route responses ship inside the static assets, which
   this read-only cache serves; nothing is written at run time. */
export default defineCloudflareConfig({ incrementalCache: staticAssetsIncrementalCache })
