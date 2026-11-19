# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html): the site's public
URLs, the content document schema and the documented commands are its
"public API".

## [Unreleased]

## [1.0.0] - 2026-11-19

The first tagged release: everything built since September 2026, live at
[alenewport.com](https://www.alenewport.com).

### Portfolio

- A scroll-led story in chapters (introduction, about, tech toolbox, project
  universe, education, contact) composed over a lit 3D room, with a
  night version and a dark theme.
- **Project universe**: 37 projects on an orbital system with category filters,
  plus `/projects` with case studies in an overlay that keeps its URL.
- Seventeen section animations (journey ribbon, interest constellation,
  magnetic mosaic, botanical gateway and more), each with reduced-motion
  behaviour.
- Pages-only navigation (Projects, World, Blog, Contact); a phone index overlay;
  a terminal-style `/contact` page; a blog at `/blog`.
- Every pinned stage sized in `svh`, verified across a device sweep; no text cut
  at any size.

### The island (`/world`)

- **Archipiélago**: an explorable island entered "under the leaves" from the end
  of the story. Drive or fly; a map with travel; districts for projects, career,
  education, social and achievements; wooden signs and camera-facing labels.
- Physics with Rapier, a ray-cast vehicle and camera adapted from Bruno Simon's
  MIT-licensed `folio-2025` (see THIRD_PARTY_NOTICES.md), mini-games, particles,
  tyre tracks and synthesised audio.
- Touch driving on phones; iOS Safari's bars tinted to follow the island.
- Performance pass: time to drive 8.1 s → 4.1 s, transfer 28.5 → 12.9 MB, draw
  calls 1149 → 185 (desktop, measured on production builds).

### Content and editing

- A local **editor** app (`npm run dev`, or installed as a Mac app): pick a page
  and section, edit text and animations, preview at device sizes, publish.
  Publishing commits the content to git; the site is prerendered from it.
- A world studio for placing, rotating and scaling the island's objects.
- A deployed admin for settings, first-party audience statistics (no third-party
  trackers) and blog posts stored in the database.

### Platform

- Next.js 16 App Router on Cloudflare Workers via OpenNext; Supabase Postgres
  (through Hyperdrive) and storage for the admin; static pages served from
  Workers Static Assets with long-lived caching for hashed files.

### Security and maintenance

- Owner-only rulesets for every branch and tag, CODEOWNERS review for outside
  contributions, Dependabot, CodeQL, dependency review and CI (Node 26 LTS)
  on every push.
- Login throttling keyed on Cloudflare's client address and counted atomically;
  the audience page checks the session itself; backslash paths can no longer
  leave the site through stored links; the login page no longer shows database
  errors to visitors; the audience collector's rate limit can no longer be
  reset by changing the User-Agent; SVG uploads are recognised without a
  backtracking regex; HSTS, `nosniff`, referrer policy and
  `frame-ancestors` on every response.
- Dependencies updated (Next.js 16.4.6, zod 4.6.7, undici) to clear known
  advisories in production dependencies.
- MIT licence for the code; personal content reserved (CONTENT_LICENSE.md).

[Unreleased]: https://github.com/Ale-Newport/MyWorld/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Ale-Newport/MyWorld/releases/tag/v1.0.0
