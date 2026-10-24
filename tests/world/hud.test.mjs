/* The visitor's HUD writer (public/archipelago/preview/runtime/hud.js): what it puts on the page, and that a frame with nothing new puts nothing. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHud } from '../../public/archipelago/preview/runtime/hud.js'

/** Just enough of the DOM: elements with children and attributes, text nodes, and a count of every write. */
function fakePage() {
  const writes = { replace: 0, text: 0, value: 0, attr: 0 }
  const text = (value) => ({ nodeType: 3, _v: String(value), get nodeValue() { return this._v }, set nodeValue(v) { writes.value++; this._v = String(v) }, get textContent() { return this._v } })
  const element = () => ({
    nodeType: 1, children: [], attrs: {}, _hidden: false,
    get firstChild() { return this.children[0] ?? null },
    get textContent() { return this.children.map((c) => c.textContent).join('') },
    set textContent(v) { writes.text++; this.children = [text(v)] },
    setAttribute(k, v) { writes.attr++; this.attrs[k] = v },
    replaceChildren(...n) { writes.replace++; this.children = n },
    get hidden() { return this._hidden }, set hidden(v) { writes.attr++; this._hidden = !!v },
  })
  const document = { createElement: element, createTextNode: text }
  const panel = element(), action = element(), readout = element()
  action._hidden = true
  const reset = () => { for (const k of Object.keys(writes)) writes[k] = 0 }
  return { document, panel, action, readout, writes, reset, hud: createHud({ panel, action, readout, document }) }
}
const legacy = (h) => [h.headline, h.timer, ...h.lines, h.notice?.title].filter(Boolean).join(' · ')
const STATES = [
  { headline: '', timer: '', lines: [] },
  { headline: 'Infield slalom', timer: '3', lines: ['Weave through every gate in order'] },
  { headline: 'Infield slalom', timer: '0.37 s', lines: ['Gate 1/5', '+3 s'], notice: { title: 'Gate 1 missed · +3 s' } },
  { headline: '', timer: '', lines: ['Cone down'] },
  { headline: '', timer: '12.40 s', lines: [] },
  { headline: 'Race', timer: '', lines: [], notice: { title: 'Achievement unlocked' } },
  { headline: 'Race', timer: '1:02.15', lines: ['Lap 2/3'], notice: undefined },
]

test('the text on the page is the line it always was, whatever the activity reports', () => {
  const { hud, panel } = fakePage()
  for (const h of STATES) { hud.text(h); assert.equal(panel.textContent, legacy(h), JSON.stringify(h)) }
})

test('an empty HUD leaves the panel empty, so :empty hides it', () => {
  const { hud, panel } = fakePage()
  hud.text(STATES[1]); hud.text(STATES[0])
  assert.equal(panel.children.length, 0)
})

test('a frame with nothing new writes nothing', () => {
  const { hud, writes, reset } = fakePage()
  hud.text(STATES[2]); hud.prompt('Start the slalom', false); hud.speed(42, 0)
  reset()
  for (let i = 1; i <= 120; i++) { hud.text({ ...STATES[2], lines: [...STATES[2].lines] }); hud.prompt('Start the slalom', false); hud.speed(42.2, i * 16.7) }
  assert.deepEqual(writes, { replace: 0, text: 0, value: 0, attr: 0 })
})

test('a clock that moves rewrites its own text and nothing around it', () => {
  const { hud, panel, writes, reset } = fakePage()
  hud.text({ headline: 'Infield slalom', timer: '0.01 s', lines: ['Gate 1/5'] })
  const before = [...panel.children]
  reset()
  for (let i = 2; i <= 60; i++) hud.text({ headline: 'Infield slalom', timer: `0.${String(i).padStart(2, '0')} s`, lines: ['Gate 1/5'] })
  assert.equal(writes.replace, 0, 'the structure is untouched')
  assert.equal(writes.text, 0)
  assert.equal(writes.value, 59, 'one text write per tick, on the clock')
  assert.deepEqual(panel.children, before, 'the same nodes')
  assert.equal(panel.textContent, 'Infield slalom · 0.60 s · Gate 1/5')
})

test('the clock is a timer that a screen reader does not announce; nothing else is', () => {
  const { hud, panel } = fakePage()
  hud.text({ headline: 'Infield slalom', timer: '0.37 s', lines: ['Gate 1/5'], notice: { title: 'Cone down' } })
  const parts = panel.children.filter((c) => c.nodeType === 1)
  assert.equal(parts.length, 3)
  const clock = parts.filter((p) => p.attrs.role === 'timer')
  assert.equal(clock.length, 1)
  assert.equal(clock[0].attrs['aria-live'], 'off')
  assert.equal(clock[0].textContent, '0.37 s')
  assert.ok(parts.filter((p) => p !== clock[0]).every((p) => p.attrs.role === undefined && p.attrs['aria-live'] === undefined))
})

test('the structure is rebuilt when a part appears or goes, and only then', () => {
  const { hud, panel, writes, reset } = fakePage()
  hud.text({ headline: 'Race', timer: '', lines: [] })
  reset(); hud.text({ headline: 'Race', timer: '5', lines: [] })
  assert.equal(writes.replace, 1)
  reset(); hud.text({ headline: 'Race', timer: '4', lines: [] })
  assert.equal(writes.replace, 0)
  reset(); hud.text({ headline: 'Race', timer: '4', lines: ['Go'] })
  assert.equal(writes.replace, 1)
  assert.equal(panel.textContent, 'Race · 4 · Go')
})

test('the interact button is on the call its prompt starts and gone on the call it ends', () => {
  const { hud, action } = fakePage()
  assert.equal(action.hidden, true)
  hud.prompt('Start the infield slalom', false)
  assert.equal(action.hidden, false); assert.equal(action.textContent, 'Start the infield slalom · E')
  hud.prompt('Start the infield slalom', true)
  assert.equal(action.textContent, 'Start the infield slalom', 'a touch screen shows no key')
  hud.prompt('', true)
  assert.equal(action.hidden, true)
  hud.prompt(undefined, false)
  assert.equal(action.hidden, true)
})

test('the button label is written when it changes and never while hidden', () => {
  const { hud, writes, reset } = fakePage()
  hud.prompt('Open the board', false)
  reset(); hud.prompt('Open the board', false); assert.equal(writes.text + writes.attr, 0)
  hud.prompt('', false); reset()
  for (let i = 0; i < 30; i++) hud.prompt('', false)
  assert.equal(writes.text + writes.attr, 0)
})

test('the speed readout looks ten times a second and writes only a new reading', () => {
  const { hud, readout, writes, reset } = fakePage()
  hud.speed(0, 0); assert.equal(readout.textContent, '00')
  reset()
  for (let t = 1; t <= 99; t++) hud.speed(80, t)
  assert.equal(writes.text, 0, 'inside 100 ms it does not even look')
  hud.speed(80.4, 100); assert.equal(readout.textContent, '80'); assert.equal(writes.text, 1)
  hud.speed(80.2, 205); hud.speed(79.6, 310)
  assert.equal(writes.text, 1, '80, 80 and 80 again are one write')
  hud.speed(7.2, 420); assert.equal(readout.textContent, '07')
  hud.speed(-0.2, 530); assert.equal(readout.textContent, '00', 'the car rolling back shows no minus')
})

test('clear() takes everything off the glass and the next frame writes what is true', () => {
  const { hud, panel, action, readout } = fakePage()
  hud.text(STATES[2]); hud.prompt('Go', false); hud.speed(30, 0)
  hud.clear()
  assert.equal(panel.children.length, 0); assert.equal(action.hidden, true)
  hud.text(STATES[2]); hud.prompt('Go', false); hud.speed(30, 1)
  assert.equal(panel.textContent, legacy(STATES[2])); assert.equal(action.hidden, false); assert.equal(readout.textContent, '30')
})
