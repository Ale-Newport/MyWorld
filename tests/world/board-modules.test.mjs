import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// /world runs the static copies under public/archipelago/preview/portfolio; the typed sources under src/world2 are
// what gets edited. A stale copy would silently ship the old behaviour.
test('generated runtime modules are current with their TypeScript sources', () => {
  const run = spawnSync(process.execPath, ['scripts/world/build-board-modules.mjs', '--check'], { encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
});
