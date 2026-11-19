# Security policy

## Supported versions

Only the latest commit on `main`, which is what runs at
[alenewport.com](https://www.alenewport.com), receives security fixes.

## Reporting a vulnerability

**Please do not open a public issue.** Report it privately through GitHub:
[**Report a vulnerability**](https://github.com/Ale-Newport/MyWorld/security/advisories/new)
(Security tab → *Report a vulnerability*).

Include what you found, where (URL, route or file), how to reproduce it, and
what an attacker could do with it. You can expect:

- an acknowledgement within **3 working days**;
- an assessment, and a fix or mitigation plan, within **14 days** for anything
  confirmed;
- credit in the advisory and release notes, if you would like it.

Please give a reasonable window to fix an issue before you disclose it, and do
not access other people's data, degrade the site, or run automated scanners
against production. Testing against a local copy (`npm run dev`) is always fine.

## Scope

In scope: the public site and `/world`, the deployed admin (`/admin`, its
APIs and sessions), the content and media handling in `src/server/`, and this
repository's workflows and configuration.

Out of scope: denial of service by volume, missing best-practice headers with
no demonstrated impact, issues in third-party services (Cloudflare, Supabase,
GitHub) themselves, and social engineering.

## How the project protects itself

- **Secrets** live only in Cloudflare Worker secrets and local `.env.local`
  files (git-ignored); [`.env.example`](.env.example) documents every name with
  no values. GitHub secret scanning and push protection are on, and the full
  history has been scanned with gitleaks (see [`.gitleaks.toml`](.gitleaks.toml)).
- **Admin**: scrypt password hashes, `__Host-` HttpOnly SameSite=Strict session
  cookies, same-origin + per-session CSRF checks on every state-changing
  request, login throttling per account and per Cloudflare client address.
- **Uploads** are typed by their bytes, never their name; SVG is rebuilt from an
  allow-list and served in a sandbox.
- **Headers**: HSTS, `nosniff`, a strict referrer policy and
  `frame-ancestors 'self'` on every response; the admin is never indexed.
- **Supply chain**: Dependabot updates, `npm audit` and dependency review in CI,
  CodeQL on every push to `main`, GitHub Actions pinned to commit SHAs with
  read-only default permissions.
- **Changes**: only the owner can push to this repository's branches or create
  tags; every outside contribution needs his review as code owner before it
  can be merged.
