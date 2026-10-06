import { defineCloudflareConfig } from '@opennextjs/cloudflare'

/* The site renders on request (its content lives in Supabase and a publish must
   show at once), so no incremental cache is configured. */
export default defineCloudflareConfig({})
