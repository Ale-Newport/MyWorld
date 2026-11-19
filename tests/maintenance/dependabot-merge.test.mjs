import { test } from 'node:test'
import assert from 'node:assert/strict'
import { load } from '../setup.mjs'

const { versionChanges, compatible } = await load('scripts/maintenance/dependabot-merge.mjs')

test('reads every version change Dependabot writes, single or grouped', () => {
  assert.deepEqual(versionChanges('chore(deps): bump next from 16.4.6 to 16.4.7'), [['16.4.6', '16.4.7']])
  const grouped = 'Bumps the npm-minor-and-patch group with 2 updates:\n\nUpdates `zod` from 4.6.7 to 4.7.0\n- [Release notes](https://x)\n\nUpdates `three` from 0.185.1 to 0.186.0\n'
  assert.deepEqual(versionChanges(grouped), [['4.6.7', '4.7.0'], ['0.185.1', '0.186.0']])
  assert.deepEqual(versionChanges('Bumps [actions/checkout](https://github.com/actions/checkout) from 7.0.1 to 7.1.0.'), [['7.0.1', '7.1.0']])
  assert.deepEqual(versionChanges('nothing to see'), [])
})

test('only patch and minor updates are compatible; 0.x minors, majors and pre-releases are not', () => {
  assert.equal(compatible('16.4.6', '16.4.7'), true)
  assert.equal(compatible('4.6.7', '4.7.0'), true)
  assert.equal(compatible('7.0', '7.1'), true)
  assert.equal(compatible('16.4.6', '17.0.0'), false)
  assert.equal(compatible('0.185.1', '0.186.0'), false, 'a 0.x minor can break')
  assert.equal(compatible('0.185.1', '0.185.2'), true)
  assert.equal(compatible('1.2.3', '1.3.0-beta.1'), false)
  assert.equal(compatible('1.2.3', '1.2.2'), false, 'never a downgrade')
  assert.equal(compatible('3d3c42e', '5a1b2c3'), false, 'SHAs are left for a human')
})
