import { test } from 'node:test'
import assert from 'node:assert/strict'
import { load } from '../setup.mjs'

const { readingGrid, readingSignature } = await load('src/components/home/room/layout/readingSignature.ts')

const boxes = () => [
  { x: 60, y: 104, w: 312, h: 60, px: 56, chapter: 'toolbox' },
  { x: 58, y: 240, w: 270, h: 22, px: 14, chapter: 'toolbox' },
  { x: 393, y: 104, w: 982, h: 693, px: 12, chapter: 'toolbox' },
]

test('the grid keeps its width and follows the viewport’s aspect', () => {
  // The sizes the room reports on a 1440x900 desktop and a 390x844 phone.
  assert.deepEqual(readingGrid(1440, 900), { gw: 192, gh: 120 })
  assert.deepEqual(readingGrid(390, 844), { gw: 192, gh: 416 })
  // Never shorter than 16 rows, however wide the window.
  assert.equal(readingGrid(4000, 100).gh, 16)
})

test('the same copy in the same place has the same signature', () => {
  const { gw, gh } = readingGrid(1440, 900)
  assert.equal(readingSignature(boxes(), gw, gh), readingSignature(boxes(), gw, gh))
})

test('a line that settles by under a pixel is not a change; one that moves is', () => {
  const { gw, gh } = readingGrid(1440, 900)
  const base = readingSignature(boxes(), gw, gh)
  // Quantised to 4 px: nudging a line by a fraction of a pixel inside its cell keeps the signature.
  const nudged = boxes()
  nudged[0].y += 0.4
  nudged[0].x -= 0.3
  assert.equal(readingSignature(nudged, gw, gh), base)
  const moved = boxes()
  moved[1].y += 12
  assert.notEqual(readingSignature(moved, gw, gh), base)
  const wider = boxes()
  wider[2].w += 40
  assert.notEqual(readingSignature(wider, gw, gh), base)
  const bigger = boxes()
  bigger[1].px += 2
  assert.notEqual(readingSignature(bigger, gw, gh), base)
})

test('a line added or taken away is a change, and the grid is part of the signature', () => {
  const { gw, gh } = readingGrid(1440, 900)
  const base = readingSignature(boxes(), gw, gh)
  assert.notEqual(readingSignature(boxes().slice(0, 2), gw, gh), base)
  assert.notEqual(readingSignature(boxes(), gw, gh + 1), base)
})
