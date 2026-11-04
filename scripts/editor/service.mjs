/* The editor as a Mac app: nothing to type to use it.

   `npm run editor:install` builds the editor, registers it with launchd (so it starts when you log in and
   comes back if it stops) and puts "Portfolio Editor.app" in ~/Applications: open it, or drag it to the Dock,
   and the editor opens in your browser at http://localhost:3100. It is the same editor `npm run dev` shows
   (same local store in .data/cms, same git login), built once instead of compiled on demand, and listening
   only on this Mac.

     npm run editor:install      build, register, create the app
     npm run editor:update       pull the latest code, rebuild, restart (after the site's code changed)
     npm run editor:status       is it running?
     npm run editor:uninstall    stop it and remove the app and the launchd entry (your content is untouched)

   The editor's content (the drafts) is in .data/cms and the published files are in the repository: neither is
   touched by any of these. Logs: ~/Library/Logs/portfolio-editor.log */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const LABEL = 'com.alejandro.portfolio-editor'
const PORT = 3100
const URL_ = `http://localhost:${PORT}/`
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

/** A node that survives `brew upgrade`: Homebrew's own link rather than the versioned Cellar path. */
function nodePath() {
  const exec = process.execPath
  const link = exec.replace(/\/Cellar\/node\/[^/]+\/bin\/node$/, '/bin/node')
  return fs.existsSync(link) ? link : exec
}

const up = async () => { try { return (await fetch(`${URL_}admin/login`, { signal: AbortSignal.timeout(2000) })).ok } catch { return false } }
async function waitUp(seconds = 60) {
  for (let i = 0; i < seconds * 2; i++) { if (await up()) return true; await new Promise((r) => setTimeout(r, 500)) }
  return false
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
}

function writePlist() {
  const env = { CMS_EDITOR: '1', NEXT_DIST_DIR: distDir, NODE_ENV: 'production', PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', HOME: home, GIT_TERMINAL_PROMPT: '0' }
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
    <string>-p</string><string>${PORT}</string>
    <string>-H</string><string>127.0.0.1</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env).map(([k, v]) => `    <key>${k}</key><string>${xml(v)}</string>`).join('\n')}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict>
</plist>
`
  fs.mkdirSync(path.dirname(plist), { recursive: true })
  fs.mkdirSync(path.dirname(log), { recursive: true })
  fs.writeFileSync(plist, body)
}

const loaded = () => quiet('launchctl', ['print', `${domain}/${LABEL}`]).status === 0
function load() {
  if (loaded()) quiet('launchctl', ['bootout', `${domain}/${LABEL}`])
  const r = quiet('launchctl', ['bootstrap', domain, plist])
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
  // Opens the editor, starting it first if it is not running.
  fs.writeFileSync(path.join(contents, 'MacOS/launcher'), `#!/bin/bash
URL="${URL_}"
if ! curl -s -m 2 -o /dev/null "\${URL}admin/login"; then
  /bin/launchctl kickstart "${domain}/${LABEL}" 2>/dev/null || /bin/launchctl bootstrap "${domain}" "${plist}"
  for i in $(seq 1 90); do curl -s -m 2 -o /dev/null "\${URL}admin/login" && break; sleep 0.5; done
fi
/usr/bin/open "$URL"
`, { mode: 0o755 })
  makeIcon(path.join(contents, 'Resources'))
  quiet('touch', [app])
}

async function install() {
  if (process.platform !== 'darwin') throw new Error('The editor app is for macOS.')
  build()
  writePlist()
  load()
  writeApp()
  if (await waitUp()) say(`\nThe editor is running: ${URL_}\nApp: ${app}  (open it, or drag it to the Dock)`)
  else say(`\nInstalled, but the editor did not answer yet. See ${log}`)
}

async function update() {
  if (!fs.existsSync(plist)) throw new Error('Not installed. Run: npm run editor:install')
  const pulled = quiet('git', ['pull', '--ff-only'])
  say(pulled.status ? `git pull did not apply (${pulled.stderr.trim().split('\n')[0]}); rebuilding what is here.` : pulled.stdout.trim())
  build()
  quiet('launchctl', ['kickstart', '-k', `${domain}/${LABEL}`])
  say((await waitUp()) ? `Updated and running: ${URL_}` : `Updated, but it did not answer yet. See ${log}`)
}

function uninstall() {
  if (loaded()) quiet('launchctl', ['bootout', `${domain}/${LABEL}`])
  fs.rmSync(plist, { force: true })
  fs.rmSync(app, { recursive: true, force: true })
  say('The editor app and its launchd entry are removed. Your drafts (.data/cms) and the repository are untouched.')
}

async function status() {
  say(`launchd: ${loaded() ? 'registered' : 'not registered'}`)
  say(`editor:  ${(await up()) ? `answering at ${URL_}` : 'not answering'}`)
  say(`app:     ${fs.existsSync(app) ? app : 'not installed'}`)
  say(`log:     ${log}`)
}

const commands = { install, update, uninstall, status }
const command = process.argv[2]
if (!commands[command]) { console.error(`Usage: node scripts/editor/service.mjs ${Object.keys(commands).join(' | ')}`); process.exit(2) }
try { await commands[command]() } catch (error) { console.error(`\n${error.message}`); process.exit(1) }
