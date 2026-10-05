# The admin (`/admin`)

The portfolio has its own content management. You can edit the website's text and its section animations, the projects, the media, a few site-wide settings and the 3D world in the browser. Everything is kept as revisions: a draft you can preview, publish when it is ready, and restore later. The public site only ever shows what has been **published**.

The admin has four places:

| Place | Path | What it is for |
| --- | --- | --- |
| **Website** | `/admin/pages` | The pages' text and section animations, section by section, with a live preview |
| ↳ Projects | `/admin/projects` | Create, edit, order, hide, publish, archive and delete projects |
| ↳ Media | `/admin/media` | Uploads, alt text, where each file is used, safe deletion |
| ↳ History | `/admin/history` | Every revision of the website and the world, restore, the activity log, storage clean-up |
| **World** | `/admin/world` | The world editor (map, 3D, terrain, test drive) inside the admin |
| **Audience** | `/admin/analytics` | First-party, cookieless statistics: what was actually recorded |
| **Settings** | `/admin/settings` | Title, description, sharing image, favicon, navigation, world entrance, leaf transition, analytics |

The website editor edits **content**, not layout. Where each section's text and animation sit, how big the type is and how everything adapts from a 320 px phone to a 3440 px ultrawide screen is the site's code; nothing in the admin can move, resize or restyle it. (The world editor is different: there, moving, rotating and scaling 3D objects and painting terrain is the point.)

The admin is not linked from the public site. That is not what protects it; see [Security](#security).

---

## First administrator

There is no sign-up page and no default account. Create the first administrator from a shell on the machine that runs the site, using the same data directory:

```bash
npm run admin:create -- --email you@example.com --name "Your Name"
```

The password is asked for interactively and is never echoed. It must be at least 12 characters and must not contain your email address. For an unattended first boot (for example in a container), set `ADMIN_PASSWORD` in the environment of that one command. The script never reads the password from its arguments, so it cannot end up in shell history.

To reset a password:

```bash
npm run admin:create -- --reset you@example.com
```

Sign in at `/admin/login`.

---

## Configuration

Copy `.env.example` to `.env.local` (development) or set the variables in the host's environment (production).

| Variable | Required | Meaning |
| --- | --- | --- |
| `CMS_DATA_DIR` | In production | Where the SQLite database, revision files and uploads live. Default: `.data/cms` (git-ignored). In production, point this at a **persistent volume**. |
| `CMS_SECRET` | In production | 32 or more random characters. Used to salt the daily audience visitor key. Without it in production nothing is recorded, and the server logs why. Generate one with `openssl rand -base64 48`. |

The data directory holds:

- `cms.sqlite` — documents, revisions, users, sessions, audit log, media index, audience events
- `blobs/` — world documents and their asset definitions, stored by SHA-256
- `media/` — uploaded files

To back up, copy the whole directory while the server is stopped, or use `sqlite3 cms.sqlite ".backup …"` together with a copy of `blobs/` and `media/`.

### Hosting

The admin writes to local disk, so the site needs a Node server with a persistent directory: `next start` on a VM, or the Docker image from the README with a volume mounted at `CMS_DATA_DIR`.

**Serverless platforms such as Vercel do not keep files between requests.** The public site still works there, serving the content and world that ship in the repository. Admin edits, however, would not persist. That is a limitation of the hosting, and the admin does not hide it.

Before anything has been saved, the site serves the content that ships in the repository:

- the page and project content migrated from `src/content`
- the world seed in `content/seed/world/archipelago`

The first save in the admin imports these as revision 1, and nothing is lost.

---

## Drafts, publishing and history

- **Save draft** (<kbd>⌘S</kbd>) stores a new draft revision on top of the one you loaded. The public site does not change.
- **Publish** validates the draft and makes it live. Public pages are regenerated straight away.
- If someone else saved in the meantime (another tab or another administrator), saving is refused instead of overwriting their work. You can either load their version or explicitly keep yours.
- **History** lists every revision of the site and of the world. *Restore* copies an old revision forward as the new draft, and nothing is ever overwritten. The activity log shows who did what and when.
- **Retention.** The store keeps:
  - the live and draft revisions
  - the first import
  - the last 20 publications
  - the last 40 site drafts and 12 world drafts (a world document is about 17 MB)

  Older revisions, and files nothing refers to, are removed after saves. History → *Clean up now* does the same on demand. A file is only removed once it is six hours old, so an upload for a save still in progress is never collected.

### Previewing

Every editor shows the real public page in a frame, rendered in Next's Draft Mode: the same components and the same responsive layout a visitor gets, at a real phone (390 × 844), tablet (820 × 1180), laptop (1280 × 800), desktop (1440 × 900) or ultrawide (2560 × 1080) viewport, scaled to fit. The server re-checks your session before it serves a draft; the cookie alone is not enough. The edits you make appear in the frame before you save.

**View site** in the navigation leaves Draft Mode first, so it shows the live site as visitors see it; signing out ends Draft Mode too.

---

## Website › Pages

Pages → a section → its text and its animation → the preview → save or publish.

- **Left:** the page (Home or the Projects page) and its sections, in their order, each with a line saying what it holds. On narrower screens this is a choice at the top of the form.
- **Middle:** the selected section's form.
  - **Text** — every piece of text in the section, named in words (*Summary*, *Chapter tag*, *Closing answer*…), with a line of help where it matters. Text that belongs to the portfolio's data (your summary, your contact links) is edited at its source, so it changes everywhere it appears. A counter shows the length the design expects; longer text is accepted and the layout adapts to it (it is set smaller or wrapped), but the counter says so. Optional lines (corner notes, hints, the colophon) have a *Show on the site* switch. *Default* puts back the site's own text.
  - **Lists** — through-lines, rotating roles, universities and their modules, contact links.
  - **Animation** — for *A little about me*, *Project universe* and *End of journey* (see below).
  - **Technology details** — for the Tech Toolbox (see below).
  - **Section** — whether it is shown, and its name, label and subtitle in the index.
- **Right:** the live preview, with the screen-size switch. Selecting a section scrolls the preview to it; clicking a section in the preview selects it in the form. On narrow screens the preview opens with the **Preview** button.

**Save draft** (<kbd>⌘S</kbd>), undo and redo (<kbd>⌘Z</kbd> / <kbd>⇧⌘Z</kbd>) and **Publish** are in the header, with the draft's state in words: *Unsaved changes*, *Draft differs from the live site* or *Live site is up to date*.

### Section animations

Three sections have a choice of five animations each. Each option has a still thumbnail and a sentence; the chosen one plays in the preview. Two knobs adjust it: **intensity** (what it changes is named under the slider for each option) and **speed**. Visitors who ask their device for reduced motion see a still, composed version of whichever option is chosen.

| Section | Options |
| --- | --- |
| A little about me | Journey ribbon (default) · Assembling identity · Layered profile frame · Interest constellation · Typographic identity |
| Project universe | Orbital system (default) · Project constellation · Dimensional gallery · Magnetic mosaic · Layered field |
| End of journey | Botanical gateway (default) · Converging paths · Stepping path · Contour horizon · Ribbon aperture |

The animations draw only real content — your milestones, roles, skills and projects — and keep clear of the section's text at every size. The *End of journey* animation is separate from the leaf transition into the world, which works the same with every option; **Test it in the preview** runs that transition inside the frame.

A choice that no longer exists (a retired option in an old revision) falls back to the section's default when the page is shown.

### Tech Toolbox details

Two independent switches decide what the wall says about each technology when it is pointed at, focused or tapped: **project counts** (the number on each tile and the "3 projects" line) and **project names** (the list of projects in the readout). Under *Per-technology overrides* each technology can inherit the section's setting, always show or always hide either detail. A detail that is off is not rendered at all — no badge, no line, no label, no tooltip. Only published, listed projects are ever counted or named. Hovering a technology never fades the others.

### Content from the old page builder

Schema v1 had a visual page builder. Documents saved with it are migrated when they are read: edited text, hidden lines and link targets are kept; per-element styles, positions, locks and groups are dropped, because the layout is the code's. Elements that had been added to a section are kept, with their text, in a content section of their own right after it, where they read in one responsive column; their text stays editable and they can be removed.

## Projects

`/admin/projects` lists every project in display order. Drag rows or use the arrows to reorder them.

| Status | Effect |
| --- | --- |
| Published | Shown on the public site |
| Draft | Visible only in the admin preview |
| Archived | Kept, but off the public site |
| Hidden (option on a published project) | Its page keeps working at its address, but it leaves every listing |

Each project has one editor covering:
- content, facts and numbers
- details and status, slug, classification and colours
- media and motion
- links and SEO
- page sections: text, facts, numbers, gallery, video, links and tables
- stack evidence

The same entity feeds:
- the home page cards
- the universe
- `/projects`
- the project's own page at `/projects/<slug>`
- the case-study overlay

The preview can show the project page, the listing or the home page.

## World editor

`/admin/world` loads the real HelloWorld world studio from this site, with:
- the 2D map editor and 3D editing
- the asset library, transforms and multi-selection
- experience groups
- terrain painting
- roads and paths, slabs and surfaces
- spawn points
- static and dynamic physics, and the ice-prop presets
- undo and redo, import and export
- test drive

**Save draft** gzips the world in the browser, uploads it with SHA-256 checks and stores it as a draft revision. If someone saved in between, saving is refused instead of overwriting their work.

**Publish world** validates the scene, then switches what `/world` serves. Its M map is drawn from the same scene, so it follows automatically.

`/world` never depends on HelloWorld's development server, on a path on this Mac or on a symbolic link. The studio and the player are files in `public/archipelago`, and the world document is stored here.

### Activities

An activity is an experience group whose data includes `activity: { type, … }`. The runtime (`public/archipelago/preview/activities.js`) reads everything else from the group's members, so moving the group or its objects in the editor moves the activity with them.

- **Infield slalom** (`type: 'slalom'`) uses objects named:
  - `Slalom start · left` and `Slalom start · right`
  - `Slalom gate N · left` and `Slalom gate N · right`
  - `Slalom finish · left` and `Slalom finish · right`
  - optionally a `Slalom timing screen`

  The gate cones are light rigid bodies. Missing a gate costs 3 s and knocking a cone costs 1 s.
- **Penguin round-up** (`type: 'roundup'`, with `radius` and `seconds`): the pen is drawn on the ice where the group stands. The herd is made of the lake's pushable penguins.

`scripts/world/author-areas.mjs` built the current areas: the slalom, the round-up, the paddock grove and the coastal lookout. It used the studio itself, so they are ordinary groups you can edit there.

`scripts/world/export-seed.mjs` makes the published world the one the repository ships.

## Media

Uploads are identified by their bytes, not their file name, and are size-limited per type. Accepted types:

- PNG, JPEG, WebP, AVIF and GIF images
- SVG and ICO icons
- MP4 and WebM video
- GLB models

SVGs are rebuilt from an allow-list: no scripts, event handlers, external references or `javascript:` links. They are served with a sandboxing Content-Security-Policy. Every file is served with `nosniff`.

The media page shows where each file is used, in both the draft and the live site. A file in use cannot be deleted.

## Audience

The site counts:
- page views
- how far visitors read
- project opens
- entering the world, how long it took to load, and load errors
- the M map
- world activities

It never collects:
- cookies, or any identifier that outlives the day
- IP addresses or full user agents
- query strings, or the full address a visitor came from (only the host name is kept)

"Visitors" are daily-unique estimates: someone returning tomorrow counts again. These visits are never recorded:
- signed-in administrators and anything rendered in Draft Mode
- automation and bots
- browsers sending Do Not Track or Global Privacy Control

A period with no visits says so. Nothing is estimated or filled in. Collection can be switched off in Settings, and when it is off, the collector refuses every event.

---

## Security

Not linking the admin is not what protects it. These do:

- **Server-side checks on every request.**
  - The proxy only redirects signed-out browsers to the login page as a convenience.
  - Every admin page verifies the session on the server (`requireAdmin`).
  - Every admin API verifies it again (`adminApi`), together with a CSRF token sent in a header on every write.
- **Sessions.**
  - The token is random. Only its SHA-256 is stored.
  - The cookie is `HttpOnly`, `SameSite=Strict`, `Secure`, and named with the `__Host-` prefix in production.
  - Sessions end after 14 days without activity and after 30 days at most. Sign-out deletes them.
- **Sign-in.**
  - Passwords are salted scrypt hashes.
  - Five failures in 15 minutes lock that account and address. Each further lock doubles the time.
  - A correct password is still refused during a lock, so a lock cannot be used to test guesses.
- **No open registration.** Administrators exist only through `npm run admin:create`.
- **Validation.** Every saved document is checked against a schema and for broken references before it is stored, and again before it is published:
  - Links must be `http(s)`, `mailto`, `tel` or site paths, never `javascript:` or `data:`.
  - Style values must match CSS length and colour patterns, so they cannot break out of their declaration.
  - Text is rendered as text, never as HTML.
- **Uploads.** See [Media](#media).
- **Other protections.**
  - Admin responses are `noindex` and can only be framed by this origin.
  - Drafts are never public. The world draft is served only through an authenticated route.
  - No endpoint reads arbitrary paths. Blob names must be SHA-256 hex, and media ids are random.

---

## Checking it

```bash
npm run lint && npm run typecheck && npm test   # unit tests (tests/)
npm run build
```

The end-to-end checks in `scripts/qa/` drive a real browser against `npm run dev` on port 3210. They need the QA administrator in `.data/qa-admin.json`.

| Script | What it checks |
| --- | --- |
| `admin-auth.mjs` | Sign-in, CSRF, sessions, lockout |
| `admin-projects-e2e.mjs` | Projects: create, edit, table sections, publish |
| `content-editor-e2e.mjs` | No layout tools; text in the preview, not live after saving, live after publishing; five animations per section; Toolbox counts/names and per-tool overrides; refused unauthenticated and CSRF-less writes |
| `admin-settings-e2e.mjs` | Settings reach the public site, including the leaf-growth speed |
| `admin-media-e2e.mjs` | Uploads, SVG sanitising, usage, delete safeguards |
| `analytics.mjs` | What the browser sends; what the server refuses |
| `world-editor-e2e.mjs`, `world-studio.mjs` | Studio save, publish, map |
| `world-activities.mjs` | Both activities, start to finish |
| `world-terrain.mjs` | Painted land collides; erased land is sea |
| `world-batching.mjs` | Instancing of the new areas |
| `transition.mjs` | `--w`/`--h`, `--reduced`, `--slow`, `--warm`, `--via index` |
| `transition-edges.mjs` | Fling, reverse scroll, resize, back and forward, direct entry, error and retry |
