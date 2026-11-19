# Contributing to MyWorld

Thanks for your interest! MyWorld is Alejandro Newport's personal portfolio,
so it has a slightly unusual contribution model: **the content is his, the
engineering is open.**

| Welcome | Not accepted |
| --- | --- |
| Bug fixes on the site, the island or the editor | Changes to biography, projects, copy or images |
| Performance work (start-up, frame time, bytes) | New personal content or branding |
| Accessibility and reduced-motion improvements | Large rewrites or framework swaps without an issue first |
| Browser and device compatibility fixes | Dependencies with GPL/AGPL licences |
| Tests, tooling and documentation | Tracking, ads or third-party scripts |

If you are unsure, open an [issue](https://github.com/Ale-Newport/MyWorld/issues/new/choose)
or a [discussion](https://github.com/Ale-Newport/MyWorld/discussions) first.
Issues labelled [`good first issue`](https://github.com/Ale-Newport/MyWorld/labels/good%20first%20issue)
are scoped for a first contribution.

## How changes get in

1. **Fork** the repository; contributors cannot push branches here.
2. Create a branch in your fork, make one focused change, and open a pull
   request against `main`.
3. CI must pass: lint, typecheck, tests, a production build, CodeQL and
   dependency review.
4. The maintainer reviews every pull request as code owner. **Nothing is merged
   without his approval**, a new push dismisses an earlier approval, and
   conversations must be resolved first.

Workflows on pull requests from first-time contributors run only after the
maintainer approves them.

## Local setup

You need **Node.js 26 LTS** and npm (Node 24 runs the site, but one
allocation test in `npm test` depends on Node 26's V8). Nothing else: no
database, cloud account or API key.

```bash
git clone https://github.com/<you>/MyWorld.git && cd MyWorld && npm ci && npm run dev:site
```

- `npm run dev:site` serves the public site at <http://localhost:3000>.
- `npm run dev` serves the local **editor** instead (public pages redirect to
  `/admin`); create an account with `npm run admin:create`. See
  [docs/ADMIN.md](docs/ADMIN.md).
- `/world` needs a browser with WebGL. Its runtime is documented in
  [docs/ARCHIPELAGO_WORLD.md](docs/ARCHIPELAGO_WORLD.md).

## Before you open a pull request

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

- Keep pull requests small and about one thing; explain *why* in the
  description.
- For anything visible, add before/after screenshots at desktop and phone size,
  and check `prefers-reduced-motion`.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
  `fix(world): …`, `perf(home): …`, `docs: …`.
- Never commit secrets or `.env` files. Push protection will block known token
  formats, but please check yourself too.
- Ported or third-party code must be credited in
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) with a compatible licence.

## Where things live

| Path | What |
| --- | --- |
| `src/app/` | Next.js routes, admin pages and API handlers |
| `src/sections/`, `src/components/` | The portfolio's chapters and interface |
| `src/experience/` | React Three Fiber scenes (the home room, transitions) |
| `src/world/`, `public/archipelago/` | The island runtime (Three.js + Rapier) |
| `src/server/` | Content store, auth, media, blog, analytics |
| `src/cms/` | Site document schema, migration and the Markdown renderer |
| `tests/` | `node --test` suites (`npm test`) |
| `scripts/` | Generators, QA and perf harnesses |

## Licence

By contributing you agree that your contribution is licensed under the
[MIT License](LICENSE). Please read the [Code of Conduct](CODE_OF_CONDUCT.md).
