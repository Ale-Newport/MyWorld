import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { load } from '../setup.mjs'

const G = await load('src/server/git-publish.ts')

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

/** A bare "remote", and two checkouts of it (this editor, and "someone else"). */
function scene() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-publish-'))
  const remote = path.join(dir, 'remote.git')
  git(dir, 'init', '--bare', '--initial-branch=main', remote)
  const clone = (name) => {
    const at = path.join(dir, name)
    git(dir, 'clone', '--quiet', remote, at)
    git(at, 'config', 'user.email', 'editor@example.com')
    git(at, 'config', 'user.name', 'Editor')
    return at
  }
  const editor = clone('editor')
  fs.mkdirSync(path.join(editor, 'content/published'), { recursive: true })
  fs.writeFileSync(path.join(editor, 'content/published/site.json'), '{"v":1}\n')
  fs.writeFileSync(path.join(editor, 'unrelated.txt'), 'one\n')
  git(editor, 'add', '-A')
  git(editor, 'commit', '--quiet', '-m', 'start')
  git(editor, 'push', '--quiet', 'origin', 'HEAD:main')
  git(editor, 'branch', '--set-upstream-to=origin/main')
  return { dir, remote, editor, other: clone('other') }
}

test('publishing commits and pushes only the published paths, never the rest of the working tree', async () => {
  const { editor, remote } = scene()
  process.chdir(editor)
  fs.writeFileSync(path.join(editor, 'content/published/site.json'), '{"v":2}\n')
  fs.writeFileSync(path.join(editor, 'unrelated.txt'), 'edited, not published\n')
  fs.writeFileSync(path.join(editor, 'untracked.txt'), 'new\n')
  const result = await G.commitAndPush(['content/published'], 'content: publish the site')
  assert.equal(result.committed, true)
  assert.equal(result.pushed, true)
  assert.equal(result.error, null)
  assert.equal(git(remote, 'show', 'main:content/published/site.json'), '{"v":2}')
  assert.equal(git(remote, 'show', 'main:unrelated.txt'), 'one', 'an unrelated edit is not published')
  assert.match(git(editor, 'status', '--porcelain'), /unrelated\.txt/, 'and stays in the working tree')
  assert.equal(git(editor, 'log', '-1', '--format=%B').trim(), 'content: publish the site', 'no attribution trailers are added')
})

test('publishing what is already committed is a no-op, and a rejected push says how to recover', async () => {
  const { editor, other } = scene()
  process.chdir(editor)
  const same = await G.commitAndPush(['content/published'], 'content: publish the site')
  assert.deepEqual([same.committed, same.pushed, same.error], [false, false, null])
  // Someone pushes first: this checkout's push is refused, but its commit is kept.
  fs.writeFileSync(path.join(other, 'other.txt'), 'x\n')
  git(other, 'add', '-A'); git(other, 'commit', '--quiet', '-m', 'other'); git(other, 'push', '--quiet', 'origin', 'HEAD:main')
  fs.writeFileSync(path.join(editor, 'content/published/site.json'), '{"v":3}\n')
  const rejected = await G.commitAndPush(['content/published'], 'content: publish the site')
  assert.equal(rejected.committed, true)
  assert.equal(rejected.pushed, false)
  assert.match(rejected.error, /git pull --rebase && git push/)
})

test('the editor refuses to publish over a newer version of the same file on the remote', async () => {
  const { editor, other } = scene()
  process.chdir(editor)
  await G.assertNotBehind(['content/published/site.json'])
  // Settings published from the web admin land on the remote.
  fs.writeFileSync(path.join(other, 'content/published/site.json'), '{"v":"settings changed on the web"}\n')
  git(other, 'commit', '--quiet', '-am', 'settings'); git(other, 'push', '--quiet', 'origin', 'HEAD:main')
  await assert.rejects(() => G.assertNotBehind(['content/published/site.json']), /newer version of content\/published\/site\.json/)
  // A remote change to some other file does not block publishing this one.
  await G.assertNotBehind(['public/media'])
})

test('a folder that does not exist yet (no uploads so far) does not stop the publish', async () => {
  const { editor, remote } = scene()
  process.chdir(editor)
  fs.writeFileSync(path.join(editor, 'content/published/site.json'), '{"v":4}\n')
  const result = await G.commitAndPush(['content/published/site.json', 'public/media'], 'content: publish the site')
  assert.deepEqual([result.committed, result.pushed, result.error], [true, true, null])
  assert.equal(git(remote, 'show', 'main:content/published/site.json'), '{"v":4}')
  // Once uploads were published, emptying the folder is a deletion that is committed too.
  fs.mkdirSync(path.join(editor, 'public/media/abc'), { recursive: true })
  fs.writeFileSync(path.join(editor, 'public/media/abc/x.png'), 'png')
  await G.commitAndPush(['public/media'], 'content: publish the site')
  fs.rmSync(path.join(editor, 'public/media'), { recursive: true })
  const removed = await G.commitAndPush(['public/media'], 'content: publish the site')
  assert.equal(removed.committed, true)
  assert.equal(git(remote, 'ls-tree', '-r', '--name-only', 'main', 'public/media'), '')
})
