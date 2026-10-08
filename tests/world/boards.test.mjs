import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_DEFAULTS, resolveBoard } from '../../public/archipelago/preview/portfolio/world2/content/boards.js';

test('board edits survive a serialized world draft, including cleared optional fields', () => {
  const first = BOARD_DEFAULTS.projects[0];
  const input = { projects: { [first.id]: { title: 'Edited title', metric: '', link: '', image: 'data:image/webp;base64,AAAA', motion: 'ThreeBodyMotion' } } };
  const normalized = Object.fromEntries(resolveBoard(input, 'projects').map(p => [p.id, p]));
  const restored = resolveBoard(JSON.parse(JSON.stringify({ projects: normalized })), 'projects')[0];
  assert.equal(restored.title, 'Edited title');
  assert.equal(restored.metric, null);
  assert.equal(restored.link, null);
  assert.equal(restored.image, 'data:image/webp;base64,AAAA');
  assert.equal(restored.motion, 'ThreeBodyMotion');
});

test('legacy worlds retain their boards and imported overrides cannot add unsafe URLs or image formats', () => {
  assert.equal(resolveBoard(undefined, 'experiments')[0].title, BOARD_DEFAULTS.experiments[0].title);
  const first = BOARD_DEFAULTS.projects[0];
  const output = resolveBoard({ projects: { [first.id]: { title: 'a'.repeat(400), link: 'javascript:alert(1)', image: 'data:image/svg+xml;base64,AAAA', technologies: [null, 'JS', 3] } } }, 'projects')[0];
  assert.equal(output.title.length, 120);
  assert.equal(output.link, null);
  assert.equal(output.image, undefined);
  assert.deepEqual(output.technologies, ['JS']);
});
