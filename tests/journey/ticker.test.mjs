import { test } from 'node:test'
import assert from 'node:assert/strict'
import { load } from '../setup.mjs'

/* The shared ticker, driven by hand: a window that is an event target, and a requestAnimationFrame
   whose frames are run by the test. */
const listeners = new Map()
let nextId = 1
let queue = new Map()
globalThis.window = {
  addEventListener: (type, fn) => { listeners.set(type, (listeners.get(type) ?? new Set()).add(fn)) },
  removeEventListener: (type, fn) => { listeners.get(type)?.delete(fn) },
  dispatch: (type) => { for (const fn of [...(listeners.get(type) ?? [])]) fn({ type }) },
}
globalThis.document = { documentElement: {} }
globalThis.requestAnimationFrame = (fn) => { const id = nextId++; queue.set(id, fn); return id }
globalThis.cancelAnimationFrame = (id) => { queue.delete(id) }

const { IDLE, AMBIENT_EASE, AMBIENT_LINGER, ambient, subscribe, wake, watchPace, tickerStats } = await load('src/lib/ticker.ts')

let clock = 1000
/** Run the frame that is waiting, if any. Returns whether there was one. */
const frame = (ms = 16.7) => {
  const next = [...queue.entries()][0]
  if (!next) return false
  queue.delete(next[0])
  clock += ms
  next[1](clock)
  return true
}
const waiting = () => queue.size
const inputs = () => [...listeners.values()].reduce((n, set) => n + set.size, 0)

test('a subscriber that returns nothing keeps the loop running', () => {
  let calls = 0
  const stop = subscribe(() => { calls++ })
  for (let i = 0; i < 5; i++) assert.ok(frame())
  assert.equal(calls, 5)
  assert.equal(waiting(), 1)
  stop()
  assert.equal(waiting(), 0)
})

test('the loop sleeps when every subscriber is idle, and an input wakes it', () => {
  let busy = 3
  const seen = []
  const stop = subscribe((dt) => { seen.push(dt); return busy-- > 0 ? undefined : IDLE })
  while (frame()) { /* run until it stops asking */ }
  assert.equal(seen.length, 4, 'three busy passes, one idle pass, then silence')
  assert.equal(waiting(), 0)
  assert.equal(tickerStats().running, false)

  window.dispatch('wheel')
  assert.equal(waiting(), 1, 'the wheel asks for a frame')
  window.dispatch('pointermove')
  assert.equal(waiting(), 1, 'and only one')
  frame(5000)
  // A long sleep is not one long frame.
  assert.equal(seen.at(-1), 1 / 60)
  stop()
})

test('one busy subscriber is enough to keep an idle one company', () => {
  let ticks = 0
  const stopIdle = subscribe(() => IDLE)
  const stopBusy = subscribe(() => { ticks++ })
  for (let i = 0; i < 4; i++) assert.ok(frame())
  assert.equal(ticks, 4)
  stopBusy()
  assert.ok(frame())
  assert.equal(waiting(), 0, 'with only the idle one left the loop sleeps')
  stopIdle()
})

test('subscribing wakes a sleeping loop, wake() does nothing while it runs', () => {
  const stopA = subscribe(() => IDLE)
  while (frame()) { /* sleep */ }
  assert.equal(waiting(), 0)
  let calls = 0
  const stopB = subscribe(() => { calls++; return IDLE })
  assert.equal(waiting(), 1)
  wake()
  wake()
  assert.equal(waiting(), 1)
  while (frame()) { /* sleep again */ }
  assert.equal(calls, 1)
  stopA()
  stopB()
})

test('a subscriber that wakes the loop from inside its own pass is not lost', () => {
  let rounds = 0
  const stop = subscribe(() => {
    rounds++
    if (rounds === 1) wake() // something it shows has just changed
    return IDLE
  })
  assert.ok(frame())
  assert.equal(waiting(), 1, 'the wake asked for another frame although everyone said idle')
  assert.ok(frame())
  assert.equal(waiting(), 0)
  stop()
})

test('the input listeners exist only while something is subscribed', () => {
  const before = inputs()
  const stop = subscribe(() => IDLE)
  assert.ok(inputs() > before)
  stop()
  assert.equal(inputs(), before)
})

test('every input that can change what the page shows wakes it', () => {
  const stop = subscribe(() => IDLE)
  for (const type of ['wheel', 'pointermove', 'pointerdown', 'touchmove', 'keydown', 'scroll', 'resize', 'visibilitychange', 'journey:layout']) {
    while (frame()) { /* sleep */ }
    window.dispatch(type)
    assert.equal(waiting(), 1, `${type} wakes the loop`)
  }
  while (frame()) { /* sleep */ }
  stop()
})

test('ambient motion runs while the visitor is about, eases to rest once they are still, and any input restores it', () => {
  const stop = subscribe(() => IDLE)
  window.dispatch('pointermove')
  const at = (seconds) => ambient(performance.now() + seconds * 1000)
  assert.equal(at(0), 1)
  assert.equal(at(AMBIENT_LINGER - 0.5), 1, 'full pace for the whole linger')
  const mid = at(AMBIENT_LINGER + AMBIENT_EASE / 2)
  assert.ok(Math.abs(mid - 0.5) < 0.01, `half way through the ease it is half pace (${mid})`)
  let last = 1
  for (let s = AMBIENT_LINGER; s <= AMBIENT_LINGER + AMBIENT_EASE; s += 0.1) {
    const v = at(s)
    assert.ok(v <= last + 1e-9 && v >= 0 && v <= 1, 'it only slows')
    last = v
  }
  assert.equal(at(AMBIENT_LINGER + AMBIENT_EASE + 0.01), 0, 'then it is at rest, exactly')
  assert.equal(at(3600), 0)
  window.dispatch('keydown')
  assert.equal(at(0), 1, 'an input puts the pace back at once')
  stop()
})

test('a subscriber that rests with the ambient pace lets the loop sleep, and the next input wakes it', () => {
  let pace = 1
  let calls = 0
  const stop = subscribe((_dt, now) => {
    pace = ambient(now + 20000) // the visitor has been still for twenty seconds more than the loop's clock says
    if (pace === 0) return IDLE
    calls++
  })
  window.dispatch('wheel')
  assert.ok(frame())
  assert.equal(pace, 0)
  assert.equal(calls, 0)
  assert.equal(waiting(), 0, 'asleep')
  window.dispatch('wheel')
  assert.equal(waiting(), 1, 'awake again')
  while (frame()) { /* sleep */ }
  stop()
})

/* ---- THE PACE OF THE LOOP ---- */

/** Runs frames of `ms` each until `total` ms have passed. */
const run = (total, ms) => { for (let t = 0; t < total; t += ms) assert.ok(frame(ms)) }

test('pace: two slow windows in a row call back once, and only once', () => {
  const stopBusy = subscribe(() => {})
  let calls = 0
  const stop = watchPace(() => { calls++ })
  run(3800, 50) // 20 frames a second
  assert.equal(calls, 0, 'one slow window is not a verdict')
  run(600, 50)
  assert.equal(calls, 1)
  assert.equal(tickerStats().pace.slow, true)
  run(8000, 50)
  assert.equal(calls, 1, 'the watch ends when it has spoken')
  stop()
  stopBusy()
})

test('pace: a loop that keeps up never calls back', () => {
  const stopBusy = subscribe(() => {})
  let calls = 0
  const stop = watchPace(() => { calls++ })
  run(20000, 16.7)
  assert.equal(calls, 0)
  assert.equal(tickerStats().pace.strikes, 0)
  stop()
  stopBusy()
})

test('pace: one good window in between clears a slow one', () => {
  const stopBusy = subscribe(() => {})
  let calls = 0
  const stop = watchPace(() => { calls++ })
  run(2100, 50) // slow
  run(2100, 16.7) // fine
  run(2100, 50) // slow again
  assert.equal(calls, 0)
  stop()
  stopBusy()
})

test('pace: a loop that sleeps between short bursts has no pace to judge', () => {
  let burst = 0
  const stopBusy = subscribe(() => (burst-- > 0 ? undefined : IDLE))
  let calls = 0
  const stop = watchPace(() => { calls++ })
  for (let i = 0; i < 8; i++) {
    burst = 30
    window.dispatch('wheel')
    while (frame(50)) { /* 1.5 s at 20 frames a second, then it sleeps */ }
  }
  assert.equal(calls, 0, 'every burst starts its window afresh, and none lasts long enough to complete one')
  assert.equal(waiting(), 0)
  stop()
  stopBusy()
})

test('pace: a pause longer than a window (a tab that was away) is not a slow frame', () => {
  const stopBusy = subscribe(() => {})
  let calls = 0
  const stop = watchPace(() => { calls++ })
  run(1900, 50)
  assert.ok(frame(5000))
  run(1900, 50)
  assert.ok(frame(30000))
  run(1900, 50)
  assert.equal(calls, 0)
  document.hidden = true
  run(10000, 50)
  assert.equal(calls, 0, 'nor are the frames of a hidden page')
  document.hidden = false
  run(4600, 50)
  assert.equal(calls, 1, 'the same loop in view is')
  stop()
  stopBusy()
})

test('pace: watching never keeps a resting loop awake, and an unsubscribed watch is not called', () => {
  const stopIdle = subscribe(() => IDLE)
  let calls = 0
  const stop = watchPace(() => { calls++ })
  while (frame(50)) { /* asleep after one pass */ }
  assert.equal(waiting(), 0)
  stop()
  const stopBusy = subscribe(() => {})
  run(8000, 50)
  assert.equal(calls, 0)
  assert.equal(tickerStats().pace.watching, false)
  stopBusy()
  stopIdle()
})
