/* The editor as a Mac app: nothing to type to use it.

   `npm run editor:install` builds the editor, registers it with launchd (so it starts when you log in and
   comes back if it stops) and puts "Portfolio Editor.app" in ~/Applications: open it, or drag it to the Dock,
   and the editor opens in your browser at http://127.0.0.1:41873. It is the same editor `npm run dev` shows
   (same local store in .data/cms, same git login), built once instead of compiled on demand, and listening
   only on this Mac.

     npm run editor:install      build, register, create the app
     npm run editor:update       pull the latest code, rebuild, restart (after the site's code changed, or
                                 after `npm install` changed Next.js); `-- --no-pull` rebuilds what is here
     npm run editor:restart      restart without rebuilding (e.g. to move off a port another program took)
     npm run editor:status       is it running, on which port, and if not, what holds that port
     npm run editor:uninstall    stop it and remove the app and the launchd entry (your content is untouched)

   The port is chosen when the service is (re)started by one of these commands, never by itself: the one asked
   for (`-- --port <n>`, or EDITOR_PORT), else the one it already had (41873 at first), else, when another
   program holds that one, the next free port above it. It is written to the plist (EnvironmentVariables.PORT),
   which the app and `status` read, so they always open and check the address the editor really uses. Nothing
   else is ever stopped to free a port. (`next start` does not move to another port by itself: on a taken port
   it fails, and launchd retries every 10 seconds until the port is free.)

   The editor's content (the drafts) is in .data/cms and the published files are in the repository: neither is
   touched by any of these. Logs: ~/Library/Logs/portfolio-editor.log */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawnSync } from 'node:child_process'

const LABEL = 'com.alejandro.portfolio-editor'
/* An address of its own, so nothing else on this Mac can collide with it: a port no common tool uses, and
   127.0.0.1 rather than localhost, because a browser keeps cookies per host name and shares them between every
   port of `localhost` (a Draft Mode or sign-in cookie of another dev server would otherwise leak in). */
const DEFAULT_PORT = 41873
const HOST = '127.0.0.1'
const urlFor = (port) => `http://${HOST}:${port}/`
const root = path.resolve(import.meta.dirname, '../..')
const home = os.homedir()
const plist = path.join(home, 'Library/LaunchAgents', `${LABEL}.plist`)
const log = path.join(home, 'Library/Logs/portfolio-editor.log')
const app = path.join(home, 'Applications/Portfolio Editor.app')
const domain = `gui/${process.getuid()}`
const distDir = '.next-editor'

const say = (text) => console.log(text)
const run = (cmd, args, options = {}) => spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...options })
const quiet = (cmd, args) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8' })
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const tilde = (p) => (p.startsWith(home + '/') ? `~${p.slice(home.length)}` : p)

/** A node that survives `brew upgrade`: Homebrew's own link rather than the versioned Cellar path. */
function nodePath() {
  const exec = process.execPath
  const link = exec.replace(/\/Cellar\/node\/[^/]+\/bin\/node$/, '/bin/node')
  return fs.existsSync(link) ? link : exec
}

/** The launchd job: whether it is registered, and the pid of its process when it is running. */
function job() {
  const r = quiet('launchctl', ['print', `${domain}/${LABEL}`])
  if (r.status) return { loaded: false }
  const pid = Number(r.stdout.match(/^\s*pid = (\d+)$/m)?.[1]) || undefined
  return { loaded: true, pid, lastExit: r.stdout.match(/^\s*last exit code = (.+)$/m)?.[1] }
}
const loaded = () => job().loaded

/** The port the installed service is set to. The plist is the one record of it (the app and `status` read it). */
function configuredPort() {
  if (!fs.existsSync(plist)) return undefined
  const r = quiet('plutil', ['-convert', 'json', '-o', '-', plist])
  if (r.status) return undefined
  const { EnvironmentVariables: env = {}, ProgramArguments: args = [] } = JSON.parse(r.stdout)
  const flag = args.indexOf('-p') // plists written before the port moved to PORT
  return Number(env.PORT) || (flag >= 0 && Number(args[flag + 1])) || undefined
}

/** The port asked for on the command line (`--port 41900`) or in EDITOR_PORT, if any. */
function requestedPort() {
  const i = process.argv.findIndex((a) => a === '--port' || a.startsWith('--port='))
  const raw = i < 0 ? process.env.EDITOR_PORT : process.argv[i].includes('=') ? process.argv[i].split('=')[1] : process.argv[i + 1]
  if (!raw) return undefined
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`Not a usable port: ${raw} (1024 to 65535).`)
  return port
}

/** The TCP ports a process listens on. */
function portsOf(pid) {
  const r = quiet('lsof', ['-nP', '-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN', '-Fn'])
  return [...new Set(r.stdout.split('\n').filter((l) => l.startsWith('n')).map((l) => Number(l.slice(l.lastIndexOf(':') + 1))))]
}

/** A process, as someone would recognise it: pid, command and the folder it runs in. */
function describe(pid) {
  const command = quiet('ps', ['-o', 'command=', '-p', String(pid)]).stdout.trim() || 'exited'
  const cwd = quiet('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).stdout.split('\n').find((l) => l.startsWith('n'))
  return `pid ${pid} (${command}${cwd ? `, in ${tilde(cwd.slice(1))}` : ''})`
}

/** Can 127.0.0.1:port be bound now? Catches a holder lsof cannot see (another user's process). */
const bindable = (port) => new Promise((resolve) => {
  const server = net.createServer()
  server.once('error', () => resolve(false))
  server.listen(port, HOST, () => server.close(() => resolve(true)))
})

/** What other than the editor's own process holds a port, described; undefined when nothing does. Only looks. */
async function occupant(port, editorPid) {
  const pids = [...new Set(quiet('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']).stdout.split('\n').filter(Boolean).map(Number))]
  if (editorPid && pids.includes(editorPid)) return undefined
  if (pids.length) return pids.map(describe).join(' and ')
  return (await bindable(port)) ? undefined : 'a process of another user'
}

/** How many ms the server on this port took to answer, or undefined if it did not. Any HTTP answer counts (the
   sign-in page may redirect); whose server it is, is decided by the listening pid, not by the answer, since any
   other Next app answers /admin/login too. */
async function answers(port, seconds = 5) {
  const started = Date.now()
  try {
    const response = await fetch(`${urlFor(port)}admin/login`, { redirect: 'manual', signal: AbortSignal.timeout(seconds * 1000) })
    await response.arrayBuffer()
    return response.status < 500 ? Date.now() - started : undefined
  } catch { return undefined }
}

/** The editor is up when the launchd job's own process listens on the port and answers there. */
async function editorUp(port) {
  const { pid } = job()
  return Boolean(pid && portsOf(pid).includes(port) && (await answers(port)) !== undefined)
}
async function waitUp(port, seconds = 60) {
  for (let i = 0; i < seconds * 2; i++) { if (await editorUp(port)) return true; await new Promise((r) => setTimeout(r, 500)) }
  return false
}

/** The port to start on (see the top of this file). Run before the service is restarted, so the editor's own
   process still holding the port counts as free. */
async function choosePort() {
  const { pid } = job()
  const asked = requestedPort()
  if (asked) {
    const holder = await occupant(asked, pid)
    if (holder) throw new Error(`Port ${asked} is in use by ${holder}. Choose another with --port.`)
    return asked
  }
  const base = configuredPort() ?? DEFAULT_PORT
  const holder = await occupant(base, pid)
  if (!holder) return base
  for (let port = base + 1; port <= Math.min(base + 100, 65535); port++) {
    if (!(await occupant(port, pid))) { say(`Port ${base} is in use by ${holder}; the editor moves to ${port}.`); return port }
  }
  throw new Error(`Port ${base} is in use by ${holder}, and no port up to ${base + 100} is free. Choose one with --port.`)
}

/* A build only runs on the Next.js it was made with: after `npm install` brings another version, the old build
   crash-loops at start (e.g. ENOENT .next-editor/server/preview-props.json). So the version is recorded with it. */
const builtWith = path.join(root, distDir, 'EDITOR_NEXT_VERSION')
const installedNext = () => JSON.parse(fs.readFileSync(path.join(root, 'node_modules/next/package.json'), 'utf8')).version
/** Why the build cannot be started as it is, or undefined when it can. */
function staleBuild() {
  if (!fs.existsSync(path.join(root, distDir, 'BUILD_ID'))) return 'there is no build'
  const made = fs.existsSync(builtWith) ? fs.readFileSync(builtWith, 'utf8').trim() : undefined
  if (made !== installedNext()) return `the build was made with Next.js ${made ?? '(an unrecorded version)'}, node_modules has ${installedNext()}`
}

/** The editor, built for production with the editor switched on (see src/server/mode.ts). */
function build() {
  const env = { ...process.env, CMS_EDITOR: '1', NEXT_DIST_DIR: distDir }
  say('Building the editor (about a minute)…')
  if (run(process.execPath, ['scripts/world/build-seed.mjs']).status) throw new Error('Could not make the world seed.')
  const attempt = () => run(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'build'], { env })
  let result = attempt()
  if (result.status) {
    // Another dev server's generated types can be stale (a route deleted since); they are rewritten by that server.
    const stale = path.join(root, '.next/types/validator.ts')
    if (fs.existsSync(stale)) { say('Retrying without a stale generated type file…'); fs.rmSync(stale); result = attempt() }
  }
  // Building with another dist folder adds it to tsconfig.json; put that back.
  quiet('git', ['checkout', '--', 'tsconfig.json'])
  if (result.status) throw new Error('The build failed.')
  fs.writeFileSync(builtWith, `${installedNext()}\n`)
}

function writePlist(port) {
  /* ProcessType Standard, not Background: a Background job runs at the lowest CPU and disk priority (pri 4), so
     after a while idle, with its memory paged out, the editor took 7 to 60 seconds to answer a page. */
  // `next start` takes its port from PORT; kept there (not in -p) so the app's launcher can read it back by name.
  const env = { CMS_EDITOR: '1', NEXT_DIST_DIR: distDir, NODE_ENV: 'production', PORT: String(port), PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', HOME: home, GIT_TERMINAL_PROMPT: '0' }
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(nodePath())}</string>
    <string>${xml(path.join(root, 'node_modules/next/dist/bin/next'))}</string>
    <string>start</string>
    <string>-H</string><string>${HOST}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env).map(([k, v]) => `    <key>${k}</key><string>${xml(v)}</string>`).join('\n')}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Standard</string>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`
  fs.mkdirSync(path.dirname(plist), { recursive: true })
  fs.mkdirSync(path.dirname(log), { recursive: true })
  fs.writeFileSync(plist, body)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function load() {
  if (loaded()) {
    quiet('launchctl', ['bootout', `${domain}/${LABEL}`])
    // launchd takes a moment to let go; bootstrapping before then fails with an input/output error.
    for (let i = 0; i < 20 && loaded(); i++) await sleep(500)
  }
  let r
  for (let attempt = 0; attempt < 5; attempt++) {
    r = quiet('launchctl', ['bootstrap', domain, plist])
    if (!r.status) break
    await sleep(1000)
  }
  if (r.status) throw new Error(`launchctl could not load the editor: ${r.stderr.trim()}`)
  quiet('launchctl', ['enable', `${domain}/${LABEL}`])
}

/** An icon from the site's own favicon (rendered by Quick Look), falling back to the touch icon. */
function makeIcon(resources) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-icon-'))
  try {
    let source = path.join(root, 'public/apple-touch-icon.png')
    quiet('qlmanage', ['-t', '-s', '1024', '-o', tmp, path.join(root, 'public/favicon.svg')])
    const rendered = path.join(tmp, 'favicon.svg.png')
    if (fs.existsSync(rendered)) source = rendered
    const set = path.join(tmp, 'icon.iconset')
    fs.mkdirSync(set)
    for (const size of [16, 32, 128, 256, 512]) {
      quiet('sips', ['-z', size, size, source, '--out', path.join(set, `icon_${size}x${size}.png`)])
      quiet('sips', ['-z', size * 2, size * 2, source, '--out', path.join(set, `icon_${size}x${size}@2x.png`)])
    }
    quiet('iconutil', ['-c', 'icns', set, '-o', path.join(resources, 'AppIcon.icns')])
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

function writeApp() {
  const contents = path.join(app, 'Contents')
  fs.rmSync(app, { recursive: true, force: true })
  fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true })
  fs.mkdirSync(path.join(contents, 'Resources'), { recursive: true })
  fs.writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Portfolio Editor</string>
  <key>CFBundleDisplayName</key><string>Portfolio Editor</string>
  <key>CFBundleIdentifier</key><string>${LABEL}.app</string>
  <key>CFBundleExecutable</key><string>launcher</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
`)
  writeLauncher()
  makeIcon(path.join(contents, 'Resources'))
  quiet('touch', [app])
}

/* Opens the editor, starting it first if it is not running. The port is read from the plist on every open, and
   "up" means the launchd job's own process listens there: another program on that port is never opened. */
function writeLauncher() {
  fs.writeFileSync(path.join(app, 'Contents/MacOS/launcher'), `#!/bin/bash
PLIST="${plist}"
JOB="${domain}/${LABEL}"
PORT=$(/usr/bin/plutil -extract EnvironmentVariables.PORT raw "$PLIST" 2>/dev/null) || PORT=${DEFAULT_PORT}
URL="http://${HOST}:$PORT/"
up() {
  local pid
  pid=$(/bin/launchctl print "$JOB" 2>/dev/null | /usr/bin/awk '$1 == "pid" { print $3; exit }')
  [ -n "$pid" ] && /usr/sbin/lsof -nP -a -p "$pid" -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 &&
    /usr/bin/curl -s -m 10 -o /dev/null "$URL"admin/login
}
if ! up; then
  /bin/launchctl kickstart "$JOB" 2>/dev/null || /bin/launchctl bootstrap "${domain}" "$PLIST"
  while [ $SECONDS -lt 90 ]; do up && break; sleep 0.5; done
fi
if up; then
  /usr/bin/open "$URL"
else
  /usr/bin/osascript -e "display alert \"Portfolio Editor did not start\" message \"It is not answering at $URL. In the project folder, run: npm run editor:status\""
fi
`, { mode: 0o755 })
}

/** Picks the port, rewrites the plist and restarts the service on it, then waits for it to answer. */
async function start(what) {
  const port = await choosePort()
  writePlist(port)
  await load()
  return (await waitUp(port)) ? `${what}: ${urlFor(port)}` : `${what}, but it did not answer at ${urlFor(port)} yet. See: npm run editor:status, ${log}`
}

async function install() {
  if (process.platform !== 'darwin') throw new Error('The editor app is for macOS.')
  requestedPort() // a mistyped --port fails before the minute of building
  build()
  const result = await start('The editor is running')
  writeApp()
  say(`\n${result}\nApp: ${app}  (open it, or drag it to the Dock)`)
}

async function update() {
  if (!fs.existsSync(plist)) throw new Error('Not installed. Run: npm run editor:install')
  if (!process.argv.includes('--no-pull')) {
    const pulled = quiet('git', ['pull', '--ff-only'])
    say(pulled.status ? `git pull did not apply (${pulled.stderr.trim().split('\n')[0]}); rebuilding what is here.` : pulled.stdout.trim())
  }
  requestedPort()
  build()
  say(await start('Updated and running'))
  if (fs.existsSync(app)) writeLauncher() // an app made before the port was read from the plist
}

/** Restarts without rebuilding, choosing the port again: how to move off a port another program has taken. */
async function restart() {
  if (!fs.existsSync(plist)) throw new Error('Not installed. Run: npm run editor:install')
  const stale = staleBuild()
  if (stale) throw new Error(`Not restarted: ${stale}. Rebuild first: npm run editor:update`)
  say(await start('Restarted and running'))
  if (fs.existsSync(app)) writeLauncher()
}

function uninstall() {
  if (loaded()) quiet('launchctl', ['bootout', `${domain}/${LABEL}`])
  fs.rmSync(plist, { force: true })
  fs.rmSync(app, { recursive: true, force: true })
  say('The editor app and its launchd entry are removed. Your drafts (.data/cms) and the repository are untouched.')
}

async function status() {
  const { loaded: registered, pid, lastExit } = job()
  const port = configuredPort()
  say(`launchd: ${!registered ? 'not registered' : pid ? `running, pid ${pid}` : `registered, not running (last exit code ${lastExit ?? 'none'})`}`)
  if (port === undefined) say('editor:  not installed (npm run editor:install)')
  else {
    const ports = pid ? portsOf(pid) : []
    const others = ports.filter((p) => p !== port)
    let editor
    if (ports.includes(port)) {
      const ms = await answers(port, 30)
      editor = ms === undefined ? `listening on ${port} (pid ${pid}) but not answering within 30 s; see the log`
        : `answering at ${urlFor(port)}${ms > 2000 ? ` (slowly: ${(ms / 1000).toFixed(1)} s)` : ''}`
    }
    else if (others.length) editor = `listening on ${others.join(', ')}, not on ${port} as the plist says; run: npm run editor:restart`
    else {
      const holder = await occupant(port, pid)
      editor = holder
        ? `not running: port ${port} is in use by ${holder}\n         Nothing was stopped. To move the editor: npm run editor:restart (next free port), or npm run editor:restart -- --port <n>`
        : `not listening on ${port}${pid && lastExit && lastExit !== '0' && lastExit !== '(never exited)' ? `; it keeps exiting (last exit code ${lastExit}), see the log` : pid ? ' yet (starting?)' : ''}`
    }
    say(`port:    ${port}`)
    say(`editor:  ${editor}`)
    const stale = staleBuild()
    if (stale) say(`build:   cannot start as it is: ${stale}. Run: npm run editor:update`)
  }
  const launcher = path.join(app, 'Contents/MacOS/launcher')
  const reads = fs.existsSync(launcher) && fs.readFileSync(launcher, 'utf8').includes('EnvironmentVariables.PORT')
  say(`app:     ${!fs.existsSync(app) ? 'not installed' : reads ? `${app} (opens ${urlFor(port ?? DEFAULT_PORT)})` : `${app} (an older launcher with a fixed address; npm run editor:restart updates it)`}`)
  say(`log:     ${log}`)
}

const commands = { install, update, restart, uninstall, status }
const command = process.argv[2]
if (!commands[command]) { console.error(`Usage: node scripts/editor/service.mjs ${Object.keys(commands).join(' | ')}`); process.exit(2) }
try { await commands[command]() } catch (error) { console.error(`\n${error.message}`); process.exit(1) }
