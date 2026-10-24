/* Runs the whole performance matrix (perf-home + perf-world) one piece at a time and merges the
   results into one JSON file, so a later "after" run against another base URL is a single command.

     QA_BASE=http://localhost:3220 QA_OUT=.qa/runs/perf2/baseline node scripts/qa/perf-all.mjs
        [--only home,enter-fling-desktop]   (comma list of piece ids; default: every piece)
        [--skip probe-phone]                (comma list of piece ids to leave out)
        [--runs 3] [--json .qa/runs/perf2/baseline.json] [--list]

   Pieces run strictly one after the other: the machine is shared and parallel runs would measure
   each other. Each piece is a separate node process, so a crash in one never loses the rest.
   The merged file keeps every repetition (medians and spread are in each piece's `summary`). */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASE, OUT, parseArgs, loadavg, log } from './perf-lib.mjs'

const args = parseArgs()
const RUNS = String(args.runs ?? 3)
const here = path.dirname(fileURLToPath(import.meta.url))
const JSON_OUT = String(args.json ?? path.join(path.dirname(OUT), `${path.basename(OUT)}.json`))

const world = (id, extra) => ({ id, script: 'perf-world.mjs', file: `perf-world-${id}.json`, args: ['--label', id, '--runs', RUNS, ...extra] })
const PIECES = [
  { id: 'home', script: 'perf-home.mjs', file: 'perf-home.json', args: ['--runs', RUNS] },
  // (c)(d)(e): Enter my world, driving, dialogs. Desktop first: unthrottled, real GPU.
  world('enter-fling-desktop', ['--mode', 'enter', '--entry', 'fling', '--profile', 'desktop']),
  world('enter-read-desktop', ['--mode', 'enter', '--entry', 'read', '--profile', 'desktop']),
  world('direct-desktop', ['--mode', 'direct', '--profile', 'desktop']),
  world('enter-fling-laptop', ['--mode', 'enter', '--entry', 'fling', '--profile', 'laptop']),
  world('enter-fling-tablet', ['--mode', 'enter', '--entry', 'fling', '--profile', 'tablet']),
  // "Average hardware and connection": 4x CPU slowdown and a 9 Mbps / 60 ms link.
  world('enter-fling-desktop-cpu4-fast4g', ['--mode', 'enter', '--entry', 'fling', '--profile', 'desktop', '--cpu', '4', '--net', 'fast4g']),
  // (f): the phone (390x844 @3x, touch emulation), same scenarios.
  world('enter-fling-phone-cpu4-fast4g', ['--mode', 'enter', '--entry', 'fling', '--profile', 'phone', '--cpu', '4', '--net', 'fast4g']),
  world('enter-fling-phone', ['--mode', 'enter', '--entry', 'fling', '--profile', 'phone']),
  // Evidence for locking the page behind the leaves: what still reacts while the world loads.
  world('probe-desktop', ['--mode', 'probe', '--entry', 'fling', '--profile', 'desktop', '--cpu', '4', '--runs', '2']),
  world('probe-phone', ['--mode', 'probe', '--entry', 'fling', '--profile', 'phone', '--cpu', '4', '--net', 'fast4g', '--runs', '2']),
  // One long data point: a cold phone on the slow-4G profile.
  world('enter-fling-phone-cpu4-slow4g', ['--mode', 'enter', '--entry', 'fling', '--profile', 'phone', '--cpu', '4', '--net', 'slow4g', '--runs', '1', '--drive-ms', '10000']),
]
// perf-world already takes --runs from the piece when it is given twice: the later one wins.

if (args.list) { console.log(PIECES.map((p) => p.id).join('\n')); process.exit(0) }
const only = args.only ? String(args.only).split(',') : null
const skip = args.skip ? String(args.skip).split(',') : []
const selected = PIECES.filter((p) => (!only || only.includes(p.id)) && !skip.includes(p.id))

const merged = fs.existsSync(JSON_OUT) && args.merge ? JSON.parse(fs.readFileSync(JSON_OUT, 'utf8')) : { harness: 'perf-all', base: BASE, out: OUT, startedAt: new Date().toISOString(), pieces: {} }
for (const piece of selected) {
  const t0 = Date.now()
  const before = loadavg()
  log(`\n=== ${piece.id}  (load ${before.join(' ')})`)
  const res = spawnSync(process.execPath, [path.join(here, piece.script), ...piece.args], { env: process.env, stdio: ['ignore', 'ignore', 'inherit'], maxBuffer: 1 << 28 })
  const file = path.join(OUT, piece.file)
  let doc = null
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* the piece failed before writing */ }
  merged.pieces[piece.id] = { ok: res.status === 0 && !!doc, exit: res.status, seconds: Math.round((Date.now() - t0) / 1000), loadavgBefore: before, loadavgAfter: loadavg(), file: path.relative(process.cwd(), file), result: doc }
  log(`=== ${piece.id}: ${merged.pieces[piece.id].ok ? 'done' : 'FAILED (exit ' + res.status + ')'} in ${merged.pieces[piece.id].seconds} s`)
  merged.finishedAt = new Date().toISOString()
  fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true })
  fs.writeFileSync(JSON_OUT, JSON.stringify(merged, null, 2))
}
log(`\nwrote ${JSON_OUT}`)
process.stdout.write(JSON.stringify({ json: JSON_OUT, pieces: Object.fromEntries(Object.entries(merged.pieces).map(([k, v]) => [k, { ok: v.ok, seconds: v.seconds }])) }, null, 2) + '\n')
