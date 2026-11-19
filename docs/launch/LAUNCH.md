# Launch kit

Drafts for sharing MyWorld. Everything here is checked against the code and the live site; keep it that way.
Post them yourself, from your own accounts, one community at a time, and stay around to answer comments for the first few hours.

**Facts to keep straight**

- Live: <https://www.alenewport.com> · island: <https://www.alenewport.com/world> · code: <https://github.com/Ale-Newport/MyWorld>
- The island's engine (game loop, physics layer, ray-cast vehicle, camera, input) is **ported and adapted from Bruno Simon's MIT-licensed folio-2025**. Say so up front, every time. People will recognise it, and crediting it is both right and disarming.
- What is original: the world itself (procedurally generated geometry, synthesised audio), the story site, the project universe, the git-backed editor and CMS, the Cloudflare architecture and the performance work.
- Measured numbers (desktop, production builds, October 2026): time to drive 8.1 s → 4.1 s, transfer 28.5 → 12.9 MB, draw calls 1149 → 185.
- Code is MIT; personal content is reserved.

---

## Show HN

Show HN rules: <https://news.ycombinator.com/showhn.html>. It must be something people can try (the island qualifies), posted by you, with no vote solicitation. Post on a weekday morning, US Eastern time.

**Title** (80 characters max):

> Show HN: My portfolio is a scroll story that opens onto a drivable 3D island

**URL:** `https://www.alenewport.com`

**First comment (post it right away):**

> Hi HN, I'm Alejandro, a CS graduate (KCL) now doing an MSc in AI at UCL. This is my portfolio. It has two halves that share one content model: a scroll-led story over a real-time 3D room, where you can browse 37 projects on an orbital "universe", and then, at the end, leaves close over the page and you land on an island you can drive or fly around. Each district holds projects, career, education and achievements.
>
> Credit where it's due: the island's engine (game loop, Rapier physics layer, ray-cast vehicle and camera) is ported from Bruno Simon's MIT-licensed folio-2025. Every ported file says so. What I built on top: the world (procedural geometry, synthesised audio, no audio files), the site, and the plumbing, which turned out to be the most interesting part:
>
> - Content is edited in a local editor app, and "Publish" makes a git commit and push. The site is prerendered from those files and served from Cloudflare Workers Static Assets, so a page visit reads no database. Only the admin (sessions, first-party stats, blog) talks to Postgres, through Hyperdrive.
> - A performance pass on production builds took time-to-drive from 8.1 s to 4.1 s and transfer from 28.5 to 12.9 MB; draw calls went from 1149 to 185, and the island's code and assets load only when you go there.
> - The code is MIT: https://github.com/Ale-Newport/MyWorld
>
> It needs WebGL. Phones work, with touch driving. I'd love feedback on performance on your device, and on whether the story-to-island transition works for you.

---

## Reddit

Read each subreddit's rules on the day; they change. Do not cross-post the same text everywhere on the same day.

### r/threejs (showcase posts welcome)

**Title:** I built my portfolio as a drivable island (Three.js + Rapier, engine adapted from Bruno Simon's folio-2025)

> After the scroll story on the homepage, the leaves close over the page and you land on an island: drive or fly between districts for projects, career and education, with a map and fast travel.
>
> Built on Bruno Simon's MIT-licensed folio-2025 engine (credited per file). New on my side: procedurally generated world geometry, Web Audio synthesis for every sound, camera-facing labels, and a perf pass (draw calls 1149 → 185, transfer 28.5 → 12.9 MB).
>
> Live: https://www.alenewport.com/world · Code (MIT): https://github.com/Ale-Newport/MyWorld
>
> Happy to go into detail on any of it. Feedback on frame rate on your machine is very welcome.

Attach `docs/images/demo.gif` or a short screen recording.

### r/webdev (Showoff Saturday only: self-promotion is allowed on Saturdays)

**Title:** [Showoff Saturday] My portfolio: a scroll-led story that ends on a drivable 3D island, with a git-backed CMS

> Next.js 16 on Cloudflare Workers. The part I'm proudest of is boring: content is edited in a local editor whose "Publish" commits to git, so the site is prerendered and a visit reads no database. The island engine is adapted from Bruno Simon's folio-2025 (MIT, credited).
>
> https://www.alenewport.com · https://github.com/Ale-Newport/MyWorld

### r/nextjs

**Title:** A Next.js 16 portfolio on Cloudflare Workers where "Publish" is a git commit, not a database write

Focus the body on the architecture (OpenNext, static-assets incremental cache, the editor-only API routes that 404 in production, Hyperdrive for the admin) and link the repo. Mention the island only briefly.

---

## Other places

- **LinkedIn / X**: one sentence and the GIF: "My portfolio now ends on an island you can drive around. Built with Next.js, Three.js and Rapier; code is open: <repo link>." Tag Bruno Simon's folio-2025 in the credit.
- **Three.js forum** (<https://discourse.threejs.org>, Showcase category): same text as r/threejs.
- **dev.to / Hashnode article**: "Publishing a website with git commits instead of a CMS database": the editor → git → Workers Builds flow, the gotchas (prerendering, the editor-only API, Turbopack and dynamic fs paths), and the numbers.
- **Awwwards / CSS Design Awards / Godly**: submissions for portfolio sites (Awwwards charges a fee).

## Do not

- Ask anyone to upvote, star or comment, or post from more than one account.
- Use star-exchange groups, bots or paid promotion.
- Claim the engine as original work, or round the performance numbers up.
