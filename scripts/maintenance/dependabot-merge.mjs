#!/usr/bin/env node
/* ============================================================
   MERGE COMPATIBLE, TESTED DEPENDABOT UPDATES — as the owner

   main requires the code owner's approval (the ruleset), and no
   workflow token can give it, so this runs on the owner's Mac
   with his own `gh` login. For each open Dependabot pull request
   it approves and squash-merges ONLY when every rule holds:

   - opened by dependabot[bot], every commit authored by it, on a
     dependabot/* branch, not a draft;
   - only package.json, package-lock.json or workflow files change;
   - every version change is a patch or minor update (for 0.x, a
     patch only), parsed from Dependabot's own "from A to B" lines;
     pre-releases, SHAs and anything unparsed are left alone;
   - every check on the head commit finished green, including all
     the checks the main ruleset requires, and GitHub says it
     merges cleanly.

   Anything else is reported and left for a human. Nothing is
   force-merged: the approval satisfies the ruleset, so the merge
   needs no bypass.

     node scripts/maintenance/dependabot-merge.mjs [run] [--dry-run]
     node scripts/maintenance/dependabot-merge.mjs install | uninstall | status
   ============================================================ */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REPO = 'Ale-Newport/MyWorld'
const LABEL = 'com.alejandro.portfolio-dependabot'
const PLIST = path.join(os.homedir(), 'Library/LaunchAgents', `${LABEL}.plist`)
const LOG = path.join(os.homedir(), 'Library/Logs/portfolio-dependabot.log')
const ALLOWED_FILES = /^(package\.json|package-lock\.json|\.github\/workflows\/[\w.-]+\.ya?ml)$/
const GREEN = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED'])

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const ghJson = (...args) => JSON.parse(gh(...args))
const say = (line) => console.log(`${new Date().toISOString()} ${line}`)

/** Every "from A to B" Dependabot writes, as version pairs. */
export function versionChanges(text) {
  const out = []
  // A version is digits and dots, maybe a -pre-release; a trailing full stop is not part of it, and neither is a SHA.
  const pattern = /\bfrom `?v?(\d+(?:\.\d+)*(?:-[0-9A-Za-z.]+)?)(?![\w-])`? to `?v?(\d+(?:\.\d+)*(?:-[0-9A-Za-z.]+)?)(?![\w-])/g
  for (const m of text.matchAll(pattern)) out.push([m[1], m[2]])
  return out
}

/** Patch or minor (0.x: patch only); false for majors, pre-releases and anything that is not plain x.y.z. */
export function compatible(from, to) {
  const parse = (v) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : /^\d+\.\d+$/.test(v) ? [...v.split('.').map(Number), 0] : null)
  const a = parse(from), b = parse(to)
  if (!a || !b) return false
  if (a[0] !== b[0]) return false
  if (a[0] === 0 && a[1] !== b[1]) return false
  return b[1] > a[1] || (b[1] === a[1] && b[2] >= a[2])
}

function requiredChecks() {
  const rules = ghJson('api', `repos/${REPO}/rules/branches/main`)
  return rules.filter((r) => r.type === 'required_status_checks').flatMap((r) => r.parameters.required_status_checks.map((c) => c.context))
}

/** Why this pull request must be left alone, or null when it may be merged. */
function blocker(pr, required) {
  if (pr.author?.login !== 'app/dependabot' && pr.author?.login !== 'dependabot[bot]' && pr.author?.login !== 'dependabot') return `author is ${pr.author?.login}`
  if (!pr.headRefName.startsWith('dependabot/')) return `branch ${pr.headRefName}`
  if (pr.isDraft) return 'draft'
  const strangers = pr.commits.flatMap((c) => c.authors.map((a) => a.login)).filter((l) => l !== 'dependabot[bot]')
  if (strangers.length) return `commits by ${[...new Set(strangers)].join(', ')}`
  const files = pr.files.map((f) => f.path).filter((f) => !ALLOWED_FILES.test(f))
  if (files.length) return `touches ${files.join(', ')}`
  const changes = versionChanges(`${pr.title}\n${pr.body}`)
  if (!changes.length) return 'no version change could be read'
  const major = changes.filter(([a, b]) => !compatible(a, b))
  if (major.length) return `not a patch/minor update: ${major.map(([a, b]) => `${a} → ${b}`).join(', ')}`
  const checks = pr.statusCheckRollup.map((c) => ({ name: c.name ?? c.context, state: c.conclusion || c.state, done: (c.status ?? 'COMPLETED') === 'COMPLETED' }))
  const pending = checks.filter((c) => !c.done || !c.state || c.state === 'PENDING' || c.state === 'EXPECTED')
  if (pending.length) return `checks still running: ${pending.map((c) => c.name).join(', ')}`
  const red = checks.filter((c) => !GREEN.has(c.state))
  if (red.length) return `checks not green: ${red.map((c) => `${c.name}=${c.state}`).join(', ')}`
  const missing = required.filter((name) => !checks.some((c) => c.name === name && c.state === 'SUCCESS'))
  if (missing.length) return `required checks missing: ${missing.join(', ')}`
  if (pr.mergeable !== 'MERGEABLE') return `GitHub says ${pr.mergeable}`
  return null
}

function run({ dryRun }) {
  const required = requiredChecks()
  const list = ghJson('pr', 'list', '-R', REPO, '--state', 'open', '--app', 'dependabot', '--json', 'number')
  if (!list.length) { say('no open Dependabot pull requests'); return }
  for (const { number } of list) {
    const pr = ghJson('pr', 'view', String(number), '-R', REPO, '--json', 'number,title,body,author,headRefName,isDraft,commits,files,statusCheckRollup,mergeable,url')
    const why = blocker(pr, required)
    if (why) { say(`#${number} left for review: ${why} (${pr.title})`); continue }
    if (dryRun) { say(`#${number} would merge: ${pr.title}`); continue }
    gh('pr', 'review', String(number), '-R', REPO, '--approve', '--body', 'Patch/minor update, every check green, only dependency files: approved by the owner’s merge policy (scripts/maintenance/dependabot-merge.mjs).')
    gh('pr', 'merge', String(number), '-R', REPO, '--squash', '--delete-branch')
    say(`#${number} merged: ${pr.title}`)
  }
}

/* ---- the daily launchd job ---------------------------------------------------- */

function plist() {
  const node = process.execPath
  const script = path.resolve(import.meta.filename)
  const PATHS = [path.dirname(node), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${node}</string><string>${script}</string><string>run</string></array>
  <key>WorkingDirectory</key><string>${path.dirname(path.dirname(path.dirname(script)))}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${PATHS}</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>${LOG}</string>
  <key>StandardErrorPath</key><string>${LOG}</string>
</dict></plist>
`
}

const domain = `gui/${process.getuid()}`
const loaded = () => { try { execFileSync('launchctl', ['print', `${domain}/${LABEL}`], { stdio: 'ignore' }); return true } catch { return false } }

const [command = 'run', ...flags] = process.argv.slice(2)
const direct = path.resolve(process.argv[1] ?? '') === import.meta.filename
if (!direct) { /* imported by the tests */ }
else if (command === 'run') run({ dryRun: flags.includes('--dry-run') })
else if (command === 'install') {
  fs.mkdirSync(path.dirname(PLIST), { recursive: true })
  fs.writeFileSync(PLIST, plist())
  if (loaded()) execFileSync('launchctl', ['bootout', `${domain}/${LABEL}`], { stdio: 'ignore' })
  execFileSync('launchctl', ['bootstrap', domain, PLIST])
  console.log(`Installed: runs daily at 09:30. Log: ${LOG}`)
} else if (command === 'uninstall') {
  if (loaded()) execFileSync('launchctl', ['bootout', `${domain}/${LABEL}`], { stdio: 'ignore' })
  fs.rmSync(PLIST, { force: true })
  console.log('Uninstalled.')
} else if (command === 'status') {
  console.log(`launchd: ${loaded() ? 'registered (daily 09:30)' : 'not installed'}`)
  console.log(`log:     ${LOG}`)
  if (fs.existsSync(LOG)) console.log(fs.readFileSync(LOG, 'utf8').trim().split('\n').slice(-5).join('\n'))
} else {
  console.error('usage: dependabot-merge.mjs [run [--dry-run] | install | uninstall | status]')
  process.exit(2)
}
