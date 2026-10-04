#!/usr/bin/env node
/* Creates an administrator for /admin, or resets one's password.

     npm run admin:create -- --email you@example.com --name "Your Name"
     npm run admin:create -- --reset you@example.com

   The password is asked for interactively and never echoed. For an
   unattended setup (a container's first boot) set ADMIN_PASSWORD in
   the environment of that one command instead; it is never read
   from argv, so it cannot end up in shell history or `ps`.

   Writes to the same database the server uses: CMS_DATA_DIR, from
   the environment or .env.local / .env, defaulting to .data/cms. */
import fs from 'node:fs'
import readline from 'node:readline'

for (const file of ['.env.local', '.env']) if (fs.existsSync(file)) process.loadEnvFile(file)

const args = process.argv.slice(2)
const arg = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s) }
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer) })
  })
}

async function password(email) {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD
  const { passwordProblem } = await import('../../src/server/auth/password.ts')
  for (;;) {
    const first = await ask('Password (12+ characters): ', { hidden: true })
    const issue = passwordProblem(first, email)
    if (issue) { console.log(issue); continue }
    if ((await ask('Repeat password: ', { hidden: true })) !== first) { console.log('The passwords do not match.'); continue }
    return first
  }
}

const { config } = await import('../../src/server/config.ts')
const users = await import('../../src/server/auth/users.ts')
const { audit } = await import('../../src/server/audit.ts')

const reset = arg('reset')
if (reset) {
  const user = users.findByEmail(reset)
  if (!user) { console.error(`No administrator with the email ${reset}.`); process.exit(1) }
  await users.setPassword(user.id, await password(user.email))
  audit({ id: null, name: 'CLI' }, 'user.password-reset', { detail: user.email })
  console.log(`Password updated for ${user.email}. Every existing session for that account was signed out.`)
  process.exit(0)
}

if (users.countUsers() > 0 && !args.includes('--additional')) {
  console.error('An administrator already exists. Pass --additional to create another, or --reset <email> to change a password.')
  process.exit(1)
}
const email = arg('email') ?? (await ask('Email: '))
const name = arg('name') ?? (await ask('Name: '))
try {
  const user = await users.createUser({ email, name, password: await password(email) })
  audit({ id: null, name: 'CLI' }, 'user.create', { detail: user.email })
  console.log(`Administrator ${user.email} created in ${config.dataDir}. Sign in at /admin/login.`)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
