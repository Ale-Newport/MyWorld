# The admin (`/admin`)

The portfolio has its own content management. You can edit pages, projects, animations, settings, media and the 3D world in the browser. Everything is kept as revisions: a draft you can preview, publish when it is ready, and restore later. The public site only ever shows what has been **published**.

| Section | Path | What it is for |
| --- | --- | --- |
| Dashboard | `/admin` | Publishing state, recent activity, last 7 days of audience |
| Page editor | `/admin/pages` | Visual editor for the home page, the projects page and the project-page template |
| Projects | `/admin/projects` | Create, edit, order, hide, publish, archive and delete projects |
| Animation library | `/admin/library` | Every effect the site uses, with live previews and controls; place effects in sections |
| World editor | `/admin/world` | The HelloWorld world studio (2D map, 3D, test drive) saving into the portfolio |
| Media | `/admin/media` | Uploads, alt text, where each file is used, safe deletion |
| Audience | `/admin/analytics` | First-party, cookieless statistics: what was actually recorded |
| Settings | `/admin/settings` | Title, description, sharing image, favicon, navigation, world entrance, leaf transition, analytics |
| History | `/admin/history` | Every revision of the site and the world, restore, the activity log, storage clean-up |

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

Every editor shows the real public page in a frame, rendered in Next's Draft Mode. The server re-checks your session before it serves a draft; the cookie alone is not enough. The edits you make appear in the frame before you save.

---

## Page editor

**Left panel:**
- **Layers** — the page's editable elements, grouped by section. Here you can select, hide, lock and reorder elements; added elements can also be dragged to a new position.
- **Sections** — reorder, hide, rename, add and delete added sections.
- **Insert** — headings, paragraphs, buttons, images, video, tables, cards, rows, columns, grids, animations, dividers and spacers. Drag them onto the page or click to add.
- **Assets** — the media library.

**Centre:** the real page.

**Right:** the inspector. It covers content, layout (in flow or anchored, size, spacing, flex and grid), position, typography, appearance and breakpoint overrides.

**Breakpoints.** The device buttons choose where style changes are written:

| Device | Where changes apply |
| --- | --- |
| Desktop | All sizes |
| Tablet | 1024 px and narrower |
| Mobile | 640 px and narrower |

Values you leave empty are inherited. Each field's placeholder shows the inherited or computed value. Lengths accept `px`, `rem`, `%`, viewport units and `clamp()`. The ⤢ button builds a fluid `clamp()` from two sizes.

**Mouse:**
- Click to select. <kbd>⇧</kbd>-click adds to the selection. <kbd>⌘</kbd>-click selects inside a group. <kbd>⌥</kbd>-click picks what is underneath.
- Double-click text to edit it in place.
- Drag to move: guides snap to edges and centres. Hold <kbd>⌥</kbd> to drag without snapping, <kbd>⇧</kbd> to stay on one axis.
- Drag the handles to resize.

**Keyboard:**

| Keys | Action |
| --- | --- |
| Arrows | Nudge 1 px (with <kbd>⇧</kbd>, 10 px) |
| <kbd>⌘D</kbd> | Duplicate |
| <kbd>⌘C</kbd> / <kbd>⌘V</kbd> | Copy / paste |
| <kbd>⌘G</kbd> / <kbd>⇧⌘G</kbd> | Group / ungroup |
| <kbd>⌘L</kbd> | Lock |
| <kbd>⌫</kbd> | Delete an added element; hide a built-in one |
| <kbd>⌘Z</kbd> / <kbd>⇧⌘Z</kbd> | Undo / redo |

**Built-in versus added elements.** Elements the site's code renders can be:
- restyled, moved, resized, hidden and grouped
- given new text — text bound to the portfolio's data, such as the thesis or a project title, changes everywhere that data appears

They cannot be deleted, because the code would render them again. Elements you add can be anything from the Insert panel.

**Modes:**
- **Preview** turns the selection layer off, so the page behaves exactly as for a visitor.
- **Test transition** runs the full leaf transition into `/world` inside the frame. Anywhere else in the editor, scrolling to the foot of the page never takes you to `/world`.

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

## Animation library

The library has two kinds of entries.

**Built into the site:** the leaf transition, the chapter scenes, the backgrounds, the cursor, navigation and so on. Each entry documents:
- where the effect lives in the code
- its current inputs
- its behaviour under reduced motion
- its cost
- a live look at the real page

The leaf transition's growth and parting speeds can be changed here or in Settings. Neither can make the cover incomplete: the world only starts loading after the cover has been measured covering the whole screen.

**Placeable effects:** the site's own reveal, counter and project visuals, plus 17 added effects across text, data, shapes, particles, backgrounds, interaction, scroll and transitions. Every control works on the preview, and the preview can show the reduced-motion version. *Add to the draft* places the effect in a section, where the page editor positions it.

Effects are code in this repository. Their parameters are data: numbers, choices, colours and short text, validated again when they render. Nothing in the admin runs script. Public pages download only the effects they actually use.

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
| `page-editor-e2e.mjs` | Select, breakpoints, move, nudge, resize, inline text, insert, duplicate, group, hide, undo, publish |
| `page-editor-structure-e2e.mjs` | Sections, drag-and-drop, align and distribute, copy and paste, layer reordering, preview, transition test |
| `admin-settings-e2e.mjs` | Settings reach the public site, including the leaf-growth speed |
| `admin-media-e2e.mjs` | Uploads, SVG sanitising, usage, delete safeguards |
| `analytics.mjs` | What the browser sends; what the server refuses |
| `library-effects.mjs` | Every added effect renders, animates, responds to a control and holds still under reduced motion |
| `world-editor-e2e.mjs`, `world-studio.mjs` | Studio save, publish, map |
| `world-activities.mjs` | Both activities, start to finish |
| `world-terrain.mjs` | Painted land collides; erased land is sea |
| `world-batching.mjs` | Instancing of the new areas |
| `transition.mjs` | `--w`/`--h`, `--reduced`, `--slow`, `--warm`, `--via index` |
| `transition-edges.mjs` | Fling, reverse scroll, resize, back and forward, direct entry, error and retry |
