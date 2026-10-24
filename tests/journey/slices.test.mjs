import { test } from 'node:test'
import assert from 'node:assert/strict'
import { load } from '../setup.mjs'

const { sliced } = await load('src/components/home/room/layout/slices.ts')

/* A clock the test moves, and a scheduler it steps by hand. */
function rig() {
  const clock = { t: 0 }
  const queue = []
  return {
    clock,
    queue,
    options: {
      now: () => clock.t,
      schedule: (run) => { const entry = { run }; queue.push(entry); return () => { const i = queue.indexOf(entry); if (i >= 0) queue.splice(i, 1) } },
    },
    /** Runs the next requested slice; `idle` describes the idle period it was given (null: a timer). */
    next(idle = null) { const e = queue.shift(); e?.run(idle) },
  }
}

function* job(log, pieces, cost, clock) {
  for (let i = 0; i < pieces; i++) {
    clock.t += cost
    log.push(i)
    yield
  }
  return 'done'
}

test('a slice does pieces until its budget is spent, then asks for another', () => {
  const r = rig(); const log = []
  const s = sliced(job(log, 10, 2, r.clock), { budget: 5, ...r.options })
  assert.deepEqual(log, [])
  r.next()
  // 2 ms a piece, 5 ms budget: three pieces (the third finishes past it).
  assert.deepEqual(log, [0, 1, 2])
  assert.equal(r.queue.length, 1)
  assert.equal(s.done, false)
})

test('a piece dearer than the budget still runs: every slice advances', () => {
  const r = rig(); const log = []
  sliced(job(log, 3, 40, r.clock), { budget: 3, ...r.options })
  r.next(); r.next(); r.next()
  assert.deepEqual(log, [0, 1, 2])
})

test('finishing calls onDone once and asks for nothing more', () => {
  const r = rig(); const log = []; let done = 0
  const s = sliced(job(log, 4, 1, r.clock), { budget: 100, onDone: () => done++, ...r.options })
  r.next()
  assert.equal(done, 1)
  assert.equal(s.done, true)
  assert.equal(r.queue.length, 0)
})

test('an idle period that has nearly run out is left alone; the timeout is not', () => {
  const r = rig(); const log = []
  sliced(job(log, 5, 1, r.clock), { budget: 10, reserve: 2, ...r.options })
  r.next({ timeRemaining: () => 1.5, didTimeout: false })
  assert.deepEqual(log, [])
  assert.equal(r.queue.length, 1)
  r.next({ timeRemaining: () => 0, didTimeout: true })
  assert.ok(log.length >= 1)
})

test('an idle period caps the slice at what it has left', () => {
  const r = rig(); const log = []
  sliced(job(log, 20, 1, r.clock), { budget: 50, reserve: 2, ...r.options })
  r.next({ timeRemaining: () => 6, didTimeout: false })
  // 6 ms left, 2 reserved: 4 ms of pieces.
  assert.deepEqual(log, [0, 1, 2, 3])
})

test('the budget can be read afresh for every slice', () => {
  const r = rig(); const log = []; let budget = 1
  sliced(job(log, 20, 1, r.clock), { budget: () => budget, ...r.options })
  r.next()
  assert.equal(log.length, 1)
  budget = 6
  r.next()
  assert.equal(log.length, 1 + 6)
})

test('cancelling stops the work, takes back the request and closes the job', () => {
  const r = rig(); const log = []; let closed = false
  function* g() { try { for (let i = 0; i < 10; i++) { log.push(i); yield } } finally { closed = true } }
  const s = sliced(g(), { budget: 1, ...r.options })
  r.next()
  s.cancel()
  assert.equal(r.queue.length, 0)
  assert.equal(closed, true)
  assert.equal(s.done, true)
  const n = log.length
  r.next()
  assert.equal(log.length, n)
})

test('a job that throws reports it and stops', () => {
  const r = rig(); let err = null
  function* g() { yield; throw new Error('boom') }
  const s = sliced(g(), { budget: 100, onError: (e) => { err = e }, ...r.options })
  r.next()
  assert.equal(err?.message, 'boom')
  assert.equal(s.done, true)
  assert.equal(r.queue.length, 0)
})
