import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { measuringContext, clearFitCache } from '../../public/archipelago/preview/portfolio/world2/signs/paint.js';
import { themeForProject } from '../../public/archipelago/preview/portfolio/world2/signs/themes.js';
import { BOARD_DEFAULTS } from '../../public/archipelago/preview/portfolio/world2/content/boards.js';
import { Projects } from '../../public/archipelago/preview/portfolio/world2/interactions/Projects.js';
import {
  FACE_H, FACE_W, paintAttribute, paintLinkStrip, paintNeighbour, paintProjectFace, paintTitlePlate, prefitSteps,
} from '../../public/archipelago/preview/portfolio/world2/interactions/screenMotion.js';

/* A board changes project in one frame. Fitting the new lettering (wrapping and sizing every line, trying sizes the browser
   has never measured) is what made that frame long on a phone, so the board fits the NEXT project's lettering ahead of time,
   a step a frame, on a context that measures and draws nothing. These tests hold the steps to that: they settle the fits the
   real paint makes, they draw nothing, and what is painted afterwards is the same as without them. */

/** A 2D context that counts what it is asked to measure and records the text it draws; every glyph is half an em wide. */
function recordingContext() {
  const drawn = [];
  const state = { font: '10px Test', measured: 0 };
  const gradient = { addColorStop() {} };
  const target = {
    drawn,
    measureText(text) { state.measured++; const px = Number(/(\d+(?:\.\d+)?)px/.exec(state.font)?.[1] ?? 10); return { width: String(text).length * px * 0.5 }; },
    fillText(text, x, y) { drawn.push([String(text), +x.toFixed(2), +y.toFixed(2), state.font]); },
    createLinearGradient: () => gradient, createRadialGradient: () => gradient, createPattern: () => ({}),
  };
  const noop = () => {};
  return new Proxy(target, {
    get(t, key) { if (key in t) return t[key]; if (key in state) return state[key]; return noop; },
    set(t, key, value) { state[key] = value; return true; },
  });
}

const [first, second, third] = BOARD_DEFAULTS.projects;
const sizes = { title: [1024, 154], link: [1408, 128], previous: [512, 307], next: [512, 307], category: [512, 165], year: [512, 165], stack: [512, 165] };
const painters = (context, project, previous, next) => {
  paintProjectFace(context, FACE_W, FACE_H, project);
  paintTitlePlate(context, ...sizes.title, project);
  paintLinkStrip(context, ...sizes.link, project);
  paintNeighbour(context, ...sizes.previous, 'previous', previous);
  paintNeighbour(context, ...sizes.next, 'next', next);
  for (const role of ['category', 'year', 'stack']) paintAttribute(context, ...sizes[role], role, project);
};

test('a measuring context measures like the real one and draws nothing', () => {
  const real = recordingContext();
  const stub = measuringContext(real);
  stub.font = '700 40px Test';
  assert.equal(real.font, '700 40px Test', 'font is set on the scratch context');
  assert.equal(stub.font, '700 40px Test');
  assert.equal(stub.measureText('abcd').width, 80, 'text is measured by the scratch context at its font');
  stub.fillText('never drawn', 0, 0);
  stub.fillRect(0, 0, 10, 10);
  stub.beginPath(); stub.stroke();
  assert.equal(stub.createLinearGradient(0, 0, 1, 1).addColorStop(0, 'red'), undefined, 'gradients can be built and ignored');
  assert.deepEqual(real.drawn, [], 'nothing reaches the real context');
});

test('prefitSteps covers every layer of the board, and skips a layer the model does not have', () => {
  assert.equal(prefitSteps(first, second, third, sizes).length, 8, 'sheet, title, link, two neighbours, three facts');
  assert.equal(prefitSteps(first, second, third, { title: sizes.title }).length, 2);
  assert.equal(prefitSteps(first, second, third, {}).length, 1, 'the sheet needs no layer size');
});

test('the steps settle the fits the real paint makes: it measures far less, and draws exactly what it drew without them', () => {
  const cold = recordingContext();
  clearFitCache();
  painters(cold, second, first, third);
  const coldMeasured = cold.measured;

  const real = recordingContext();
  clearFitCache();
  const stub = measuringContext(real);
  for (const step of prefitSteps(second, first, third, sizes)) step(stub);
  assert.deepEqual(real.drawn, [], 'the steps draw nothing');
  const measuredByTheSteps = real.measured;
  assert.ok(measuredByTheSteps > 0, 'but they measure');
  const paintsOn = recordingContext();
  // The scratch context and the real one share a memory only when they are the same kind of context; here they are the same object.
  const settled = measuringContext(paintsOn);
  for (const step of prefitSteps(second, first, third, sizes)) step(settled);
  const before = paintsOn.measured;
  painters(paintsOn, second, first, third);
  const paintMeasured = paintsOn.measured - before;
  assert.ok(paintMeasured < coldMeasured * 0.6, `the paint measured ${paintMeasured} times after the steps, ${coldMeasured} without`);
  assert.deepEqual(paintsOn.drawn, cold.drawn, 'the same text, in the same places, in the same fonts');
});

test('a project that was not stepped is still painted from scratch, and a font load makes the steps worth doing again', () => {
  const real = recordingContext();
  clearFitCache();
  const stub = measuringContext(real);
  for (const step of prefitSteps(second, first, third, sizes)) step(stub);
  const other = recordingContext();
  painters(other, third, second, first);
  assert.ok(other.measured > 20, 'another project has its own fits to make');
  clearFitCache();
  const again = recordingContext();
  const again2 = measuringContext(again);
  for (const step of prefitSteps(second, first, third, sizes)) step(again2);
  assert.ok(again.measured > 0, 'after the memory is cleared (fonts arrived) the steps measure again');
});

/* The other cost of a change was not text: the first time a project with a new theme was shown, the frame that swaps the sheet
   also built that theme's hardware and charm and uploaded them. The board builds them ahead, hidden, in the same idle steps. */

/** A Projects board with just what its hardware and prefit plan touch: no game, no scene, no layers. */
function boardAt(index) {
  const board = Object.create(Projects.prototype);
  Object.assign(board, {
    items: BOARD_DEFAULTS.projects, index, flips: [], attributes: [],
    frame: { root: new THREE.Group() }, charm: new THREE.Group(), materials: { wood: new THREE.MeshBasicMaterial() },
    woods: new Map(), charms: new Map(), woodNow: null, charmNow: null,
  });
  return board;
}
const built = (board) => [...board.woods.values(), ...board.charms.values()];
const neighbours = (board) => [1, -1].map(d => board.items[(board.index + d + board.items.length) % board.items.length]);

test('the plan builds the hardware and charm of the projects a change can reach, hidden, before any of them is shown', () => {
  const board = boardAt(0);
  const stub = measuringContext(recordingContext());
  const plan = board.prefitPlan();
  for (const step of plan) step(stub);
  for (const project of neighbours(board)) {
    const theme = themeForProject(project);
    assert.ok(board.woods.has(theme.hardware), `${project.id}: its ${theme.hardware} hardware is built`);
    if (theme.charm !== 'none') assert.ok(board.charms.has(theme.charm), `${project.id}: its ${theme.charm} charm is built`);
  }
  assert.ok(built(board).length >= 2);
  assert.ok(built(board).every(mesh => mesh.visible === false), 'built ahead, none of it on show');
  assert.equal(board.woodNow, null);
  assert.equal(board.charmNow, null);
});

test('the hardware steps come before the lettering and are one cheap step a mesh, once each', () => {
  const board = boardAt(0);
  const plan = board.prefitPlan();
  const hardware = plan.findIndex(step => step.length === 0);
  assert.equal(hardware, 0, 'the first step is a hardware one (it asks for no context)');
  const lastHardware = plan.map(step => step.length === 0).lastIndexOf(true);
  assert.ok(plan.slice(0, lastHardware + 1).every(step => step.length === 0), 'all of them ahead of the first fit');
  const wanted = new Set();
  for (const project of neighbours(board)) { const theme = themeForProject(project); wanted.add(`wood:${theme.hardware}`); if (theme.charm !== 'none') wanted.add(`charm:${theme.charm}`); }
  assert.equal(lastHardware + 1, wanted.size, 'one step per distinct kind, not per project');
  for (const step of plan.slice(0, lastHardware + 1)) step();
  assert.equal(built(board).length, wanted.size);
  assert.equal(board.prefitPlan().filter(step => step.length === 0).length, 0, 'nothing is planned twice: what is built is not queued again');
});

test('showing a project whose hardware was built ahead only turns it on, and turns the last one off', () => {
  const board = boardAt(0);
  const stub = measuringContext(recordingContext());
  for (const step of board.prefitPlan()) step(stub);
  board.skin();
  const first = themeForProject(board.items[0]);
  assert.equal(board.woods.get(first.hardware).visible, true, 'the current project dresses the board (built on the spot: it is the first)');
  const meshes = built(board).length;
  board.index = 1;
  board.skin();
  const second = themeForProject(board.items[1]);
  assert.equal(built(board).length, meshes, 'the swap built nothing new');
  assert.equal(board.woodNow, board.woods.get(second.hardware));
  assert.equal(board.woodNow.visible, true);
  assert.equal(built(board).filter(mesh => mesh.visible).length, second.charm === 'none' ? 1 : 2, 'one hardware and one charm on show, the rest hidden');
});
