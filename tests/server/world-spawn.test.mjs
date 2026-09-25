import { test } from 'node:test'
import assert from 'node:assert/strict'
import { load } from '../setup.mjs'

const { driveSpawnProblems } = await load('src/server/world-spawn.ts')
const base = { id: 'archipelago', name: 'Archipiélago' }

test('documents without a pinned spawn stay valid (the legacy spawn is ignored, the plaza is used)', () => {
  assert.deepEqual(driveSpawnProblems(undefined), [])
  assert.deepEqual(driveSpawnProblems(base), [])
  assert.deepEqual(driveSpawnProblems({ ...base, spawn: [-118.55, 31.36, 1.4] }), [])
})

test('a complete pinned spawn is valid', () => {
  assert.deepEqual(driveSpawnProblems({ ...base, spawn: [-16.05, -51.76, 1.29], spawnHeading: 2.7489, spawnPinned: true }), [])
  assert.deepEqual(driveSpawnProblems({ ...base, spawn: [-16.05, -51.76, 1.29], spawnPinned: true }), [])
})

test('a malformed pinned spawn is refused', () => {
  assert.equal(driveSpawnProblems({ ...base, spawnPinned: true }).length, 1)
  assert.equal(driveSpawnProblems({ ...base, spawn: [1, 2], spawnPinned: true }).length, 1)
  assert.equal(driveSpawnProblems({ ...base, spawn: [1, 'x', 3], spawnPinned: true }).length, 1)
  assert.equal(driveSpawnProblems({ ...base, spawn: [1, 2, 3], spawnHeading: 'north', spawnPinned: true }).length, 1)
  assert.equal(driveSpawnProblems({ ...base, spawn: [1, 2, 3], spawnPinned: 'yes' }).length, 1)
})
