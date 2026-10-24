/* The input layer's two event-handler rules (portfolio/world/input/{Pointer,Keyboard}.js, the player's copies):
   an event handler never reads the layout, and Enter belongs to a focused button. */
import test from 'node:test'
import assert from 'node:assert/strict'

/** The globals the input classes bind to, with the listeners kept so a test can fire them. */
function browser() {
  const listeners = new Map(), observers = []
  const add = (type, fn, options) => { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)).add(fn); void options }
  const remove = (type, fn) => listeners.get(type)?.delete(fn)
  globalThis.window = { addEventListener: add, removeEventListener: remove }
  globalThis.document = { addEventListener: add, removeEventListener: remove, visibilityState: 'visible' }
  globalThis.ResizeObserver = class { constructor(fn) { this.fn = fn; this.watching = new Set(); observers.push(this) } observe(e) { this.watching.add(e) } disconnect() { this.watching.clear(); this.gone = true } }
  return { listeners, observers, fire: (type, event = {}) => { for (const fn of [...(listeners.get(type) ?? [])]) fn(event) }, count: (type) => listeners.get(type)?.size ?? 0 }
}
const { Pointer } = await import('../../public/archipelago/preview/portfolio/world/input/Pointer.js')
const { Keyboard } = await import('../../public/archipelago/preview/portfolio/world/input/Keyboard.js')

function canvas() {
  const listeners = new Map(), el = { reads: 0, box: { left: 10, top: 20 },
    addEventListener(type, fn) { listeners.set(type, fn) }, removeEventListener(type) { listeners.delete(type) },
    getBoundingClientRect() { el.reads++; return { ...el.box, width: 800, height: 600 } },
    fire(type, event) { listeners.get(type)(event) } }
  return el
}

test('a pointer reads the canvas rect once, not on every move', () => {
  browser()
  const el = canvas(), pointer = new Pointer(el)
  for (let i = 0; i < 200; i++) el.fire('mousemove', { clientX: 100 + i, clientY: 100 })
  assert.equal(el.reads, 1)
  pointer.update()
  assert.equal(pointer.current.x, 100 + 199 - 10)
  assert.equal(pointer.current.y, 100 - 20)
})

test('the rect is read again when the canvas changes size, the window resizes or scrolls, and at the start of a press', () => {
  const page = browser(), el = canvas(), pointer = new Pointer(el)
  const read = () => { const before = el.reads; el.fire('mousemove', { clientX: 50, clientY: 50 }); return el.reads - before }
  assert.equal(read(), 1)
  assert.equal(read(), 0)
  el.box = { left: 40, top: 60 }
  assert.equal(read(), 0, 'nothing told it, so it keeps what it had')
  page.observers[0].fn()
  assert.equal(read(), 1, 'a resize of the canvas')
  assert.equal(pointer.upcoming.x, 50 - 40)
  el.box = { left: 0, top: 0 }
  page.fire('resize')
  assert.equal(read(), 1, 'a resize of the window')
  page.fire('scroll')
  assert.equal(read(), 1, 'a scroll')
  el.box = { left: 5, top: 5 }
  el.fire('mousedown', { preventDefault() {}, button: 0, clientX: 30, clientY: 30 })
  assert.equal(pointer.upcoming.x, 25, 'a press starts from where the canvas is now')
  assert.equal(read(), 0)
  el.box = { left: 7, top: 7 }
  el.fire('touchstart', { touches: [{ identifier: 1, clientX: 50, clientY: 50 }] })
  assert.equal(pointer.upcomingTouches[0].x, 43)
})

test('destroy() lets go of the observer and the window listeners', () => {
  const page = browser(), el = canvas(), pointer = new Pointer(el)
  assert.equal(page.count('resize'), 1); assert.equal(page.count('scroll'), 1)
  pointer.destroy()
  assert.equal(page.count('resize'), 0); assert.equal(page.count('scroll'), 0)
  assert.equal(page.observers[0].gone, true)
})

/** A key event: `target` answers matches() and closest() the way an element does. */
const key = (code, tag = 'canvas', key = code === 'NumpadEnter' ? 'Enter' : code) => {
  const chain = tag.split('>'), has = (selector) => chain.some((t) => selector.split(',').map((s) => s.trim()).some((s) => s === t || (s === 'a[href]' && t === 'a') || (s === '[role="button"]' && t === 'role-button')))
  return { code, key, repeat: false, metaKey: false, ctrlKey: false, altKey: false, target: { matches: (s) => /input|textarea/.test(s) && ['input', 'textarea'].some((t) => chain.includes(t) && s.includes(t)), closest: (s) => (has(s) ? {} : null) }, prevented: false, preventDefault() { this.prevented = true } }
}

test('Enter on a focused button or link belongs to it; the car does not also interact', () => {
  browser()
  const kb = new Keyboard(), downs = []
  kb.events.on('down', (code) => downs.push(code))
  kb.onKeyDown(key('Enter', 'canvas')); assert.deepEqual(downs, ['Enter'], 'on the canvas it is the world key')
  downs.length = 0
  for (const tag of ['button', 'a', 'summary', 'role-button', 'button>span']) { kb.onKeyDown(key('Enter', tag)); kb.onKeyDown(key('NumpadEnter', tag)) }
  assert.deepEqual(downs, [], 'on a control it is not')
  kb.onKeyDown(key('Enter', 'body')); assert.deepEqual(downs, ['Enter'])
})

test('only Enter is the control\'s: Space and the driving keys still reach the world, and Space still has no default', () => {
  browser()
  const kb = new Keyboard(), downs = []
  kb.events.on('down', (code) => downs.push(code))
  const space = key('Space', 'button'), w = key('KeyW', 'button')
  kb.onKeyDown(space); kb.onKeyDown(w)
  assert.deepEqual(downs, ['Space', 'KeyW'])
  assert.equal(space.prevented, true)
})

test('typing in a field is still left alone', () => {
  browser()
  const kb = new Keyboard(), downs = []
  kb.events.on('down', (code) => downs.push(code))
  kb.onKeyDown(key('Enter', 'input')); kb.onKeyDown(key('KeyE', 'textarea'))
  assert.deepEqual(downs, [])
})
