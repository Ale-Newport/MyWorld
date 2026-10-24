import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { load } from '../setup.mjs'

const L = await load('src/components/world/loading.ts')
const { MARKS, MILESTONES, ETA, COPY, litCount, marksFor, copyAt, createLoadingStore, QUIET_COPY, READY_COPY } = L

test('the sprig has as many marks, charge lengths and lines as it needs, and the milestones are ordered', () => {
  assert.equal(MARKS, 8)
  assert.equal(MILESTONES.length, MARKS - 1, 'the last mark is the runtime’s `ready`, not a progress value')
  assert.equal(ETA.length, MARKS)
  assert.equal(COPY.length, MARKS)
  for (let i = 1; i < MILESTONES.length; i++) assert.ok(MILESTONES[i] > MILESTONES[i - 1])
  assert.ok(MILESTONES.every((m) => m > 0 && m < 1))
})

test('a legacy progress value lights exactly the steps it has completed, never decreasing, never the last mark', () => {
  assert.equal(litCount(0), 0)
  assert.equal(litCount(0.03), 0, 'reading the release is not a completed step')
  let last = 0
  for (let v = 0; v <= 1.0001; v += 0.001) {
    const n = litCount(v)
    assert.ok(n >= last, `monotonic at ${v}`)
    last = n
  }
  MILESTONES.forEach((m, i) => {
    assert.equal(litCount(m - 0.0005), i, `just below ${m}`)
    assert.equal(litCount(m), i + 1, `at ${m}`)
  })
  assert.equal(litCount(0.98), MARKS - 1)
  assert.equal(litCount(1), MARKS - 1, 'the eighth mark lights with `ready`, not with a value')
})

test('step/of from the runtime wins, rescaled to the sprig; garbage falls back to value; the last mark stays for ready', () => {
  assert.equal(marksFor({ value: 0.9, step: 2, of: 8 }), 2)
  assert.equal(marksFor({ value: 0.1, step: 4, of: 8 }), 4)
  assert.equal(marksFor({ value: 0, step: 3, of: 6 }), 4, '3 of 6 steps is 4 of 8 marks')
  assert.equal(marksFor({ value: 0, step: 9, of: 9 }), MARKS - 1)
  assert.equal(marksFor({ value: 0, step: 99, of: 8 }), MARKS - 1)
  assert.equal(marksFor({ value: 0.66, step: -3, of: 8 }), 0)
  assert.equal(marksFor({ value: 0.66 }), 3)
  assert.equal(marksFor({ value: 0.66, step: 'x', of: 8 }), 3)
  assert.equal(marksFor({ value: 0.66, step: 2, of: 0 }), 3, 'of: 0 is not a total')
  assert.equal(marksFor({ value: Number.NaN }), 0)
  assert.equal(marksFor({}), 0)
  assert.equal(marksFor({ value: 7 }), MARKS - 1)
})

test('the copy follows the marks and the quiet and ready states', () => {
  const s = (lit, extra = {}) => ({ lit, ready: false, quiet: false, ...extra })
  COPY.forEach((line, i) => assert.equal(copyAt(s(i)), line))
  assert.equal(copyAt(s(3, { quiet: true })), QUIET_COPY)
  assert.equal(copyAt(s(8, { ready: true })), READY_COPY)
  assert.ok(!/\d\s*%/.test([...COPY, QUIET_COPY, READY_COPY].join(' ')), 'stage names only, never a percentage')
})

test('the store renders only when something on screen changes, and lit marks never go back', () => {
  const store = createLoadingStore()
  let renders = 0
  store.subscribe(() => renders++)
  const first = store.get()
  assert.deepEqual({ ...first }, { lit: 0, ready: false, quiet: false })
  assert.equal(store.server(), first, 'the server and the first client snapshot agree')

  // 300 progress messages as a 5 MB download would post them: the first mark lights once.
  for (let i = 0; i < 300; i++) store.report({ stage: 'Loading the island', value: 0.06 + (0.42 * i) / 300 })
  assert.equal(store.get().lit, 1)
  assert.equal(renders, 1, 'one render, not 300')

  const before = store.get()
  store.report({ value: 0.2 })
  store.report({ value: 0.01 })
  assert.equal(store.get(), before, 'a message that changes nothing keeps the very same snapshot')
  assert.equal(renders, 1)

  store.report({ value: 0.66 })
  assert.equal(store.get().lit, 3)
  store.report({ value: 0.3 })
  assert.equal(store.get().lit, 3, 'a later, lower value cannot dim a lit mark')
  store.report({ value: 0.5, step: 1, of: 8 })
  assert.equal(store.get().lit, 3)

  // Quiet: free to re-arm, one render when it flips.
  const n = renders
  store.quiet(false)
  store.quiet(false)
  assert.equal(renders, n)
  store.quiet(true)
  assert.equal(store.get().quiet, true)
  assert.equal(renders, n + 1)
  store.report({ value: 0.7 })
  assert.equal(store.get().quiet, false, 'a word from the runtime ends the quiet line')

  store.ready()
  assert.deepEqual({ ...store.get() }, { lit: MARKS, ready: true, quiet: false })
  store.report({ value: 0.1 })
  store.quiet(true)
  assert.equal(store.get().lit, MARKS, 'nothing changes a world that is ready')
  assert.equal(store.get().quiet, false)

  store.reset()
  assert.deepEqual({ ...store.get() }, { lit: 0, ready: false, quiet: false })
})

/* What the runtime in this tree says about itself. Two generations exist and the test follows whichever is there:
     · runtime/loading.js (the startup agent's): STEPS is the list of steps and every progress message carries
       `step` (completed steps) and `of` (STEPS.length), so the sprig needs no thresholds, only a matching count;
     · none: main.js posts bare values at fixed points, and each of MILESTONES must be one of them. */
const preview = (file) => new URL(`../../public/archipelago/preview/${file}`, import.meta.url)
const read = (file) => (fs.existsSync(preview(file)) ? fs.readFileSync(preview(file), 'utf8') : null)

test('the sprig matches what the runtime reports: as many steps as marks, or thresholds it really posts', () => {
  const protocol = read('runtime/loading.js')
  if (protocol) {
    const block = /export const STEPS\s*=\s*\[([\s\S]*?)\n\];?/.exec(protocol)
    assert.ok(block, 'runtime/loading.js exports STEPS')
    const ids = [...block[1].matchAll(/\bid\s*:\s*['"]([\w-]+)['"]/g)].map((m) => m[1])
    assert.equal(new Set(ids).size, ids.length, 'step ids are unique')
    assert.equal(ids.length, MARKS, `the runtime has ${ids.length} steps, the sprig ${MARKS} fireflies (one per completed step, the last for ready)`)
    // Every message carries the two numbers the sprig reads; `of` is the same list's length.
    assert.match(protocol, /post\(\{[^}]*\bstep\s*:/, 'a progress message says `step`')
    assert.match(protocol, /post\(\{[^}]*\bof\s*:\s*steps\.length/, 'a progress message says `of`, the number of steps')
    // And the sprig reads them as the runtime means them: `step` completed of `of`, never the last mark.
    ids.forEach((_, i) => assert.equal(marksFor({ value: 0, step: i, of: ids.length }), Math.min(MARKS - 1, i)))
    assert.equal(marksFor({ value: 1, step: ids.length, of: ids.length }), MARKS - 1, 'finish() posts step === of: still not the last mark')
    return
  }
  const src = read('main.js')
  assert.ok(src, 'the runtime is here')
  if (/archipelago:progress[^)]*\bstep\b/.test(src)) return
  const posted = new Set([...src.matchAll(/progress\(\s*(?:'[^']*'|"[^"]*"),\s*(\.\d+|0?\.\d+|1)/g)].map((m) => Number(m[1])))
  for (const m of MILESTONES) assert.ok(posted.has(m), `main.js posts a progress value of ${m} (it posts ${[...posted].sort().join(', ')})`)
})
