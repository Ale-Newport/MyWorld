import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clearFocusPose, collectOccluders } from '../../public/archipelago/preview/portfolio/world2/signs/focusCamera.js';

/* The focus camera must see the screen. These build a small world (a screen standing at the origin facing +z, trees as boxes) and ask
   clearFocusPose for the pose; the same rays are then cast independently to check that what it returns really sees every sample. */

const FOV = 25;
const RATIO = 390 / 844;
/** A screen 3 wide and 1.7 tall, its middle 1.6 above the ground, facing +z; the samples the Projects board uses. */
const MIDDLE = new THREE.Vector3(0, 1.6, 0);
const samples = () => [[0, 0], [-1.3, 0], [1.3, 0], [0, 0.7], [0, -0.7], [-1.3, 0.7], [1.3, 0.7], [-1.3, -0.7], [1.3, -0.7], [-1.7, -1], [1.7, -1], [-1.7, 1], [1.7, 1]]
  .map(([x, y]) => new THREE.Vector3(x, 1.6 + y, 0));
const IDEAL = new THREE.Vector3(7, 5, 16);

function scene(...boxes) {
  const root = new THREE.Scene();
  for (const [x, y, z, w, h, d, name] of boxes) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
    mesh.position.set(x, y, z); mesh.name = name ?? 'box';
    root.add(mesh);
  }
  root.updateMatrixWorld(true);
  return root;
}

function pose(root, extra = {}, position = IDEAL) {
  const occluders = collectOccluders(root, MIDDLE, 40);
  return { occluders, result: clearFocusPose({ target: MIDDLE, position, samples: samples(), occluders, fov: FOV, ratio: RATIO, ...extra }) };
}

/** An independent check: every sample is reachable from `at` with no mesh of `root` in between (a half metre of slack in front of the screen). */
function sees(root, at, tolerance = 0.5) {
  const ray = new THREE.Raycaster();
  return samples().every(point => {
    const direction = point.clone().sub(at), length = direction.length();
    ray.set(at, direction.normalize()); ray.far = length - tolerance;
    return ray.intersectObjects(root.children, true).length === 0;
  });
}

test('an empty world keeps the pose it was asked for, untouched', () => {
  const { result } = pose(scene());
  assert.equal(result.moved, false);
  assert.equal(result.clear, true);
  assert.ok(result.position.equals(IDEAL));
  assert.equal(result.tested, 1, 'one look at the pose and nothing more');
});

test('a tree on the line from the camera to the screen moves the camera, round it, to a pose that sees every sample', () => {
  // A pine 3 m in front of the camera on the line to the middle of the screen (the Ice Rink's, 3.1 m from the lens).
  const direction = MIDDLE.clone().sub(IDEAL).normalize();
  const at = IDEAL.clone().addScaledVector(direction, 3.1);
  const root = scene([at.x, at.y, at.z, 3.5, 5, 3.5, 'pine']);
  assert.equal(sees(root, IDEAL), false, 'the asked-for pose is blind (the setup)');
  const { result } = pose(root);
  assert.equal(result.moved, true);
  assert.equal(result.clear, true);
  assert.ok(sees(root, result.position), 'the new pose sees every sample');
  // Same sphere round the screen (within the closer step), above the ground, and not a long way from where it was.
  const wanted = IDEAL.distanceTo(MIDDLE), got = result.position.distanceTo(MIDDLE);
  assert.ok(got <= wanted + 1e-6 && got >= wanted * 0.93, `distance ${got.toFixed(2)} of ${wanted.toFixed(2)}`);
  assert.ok(result.position.y >= IDEAL.y - 1e-6 || Math.abs(result.yaw) > 0, 'raised or swung round');
  assert.ok(result.position.distanceTo(IDEAL) < 9, `moved ${result.position.distanceTo(IDEAL).toFixed(1)} m`);
  assert.ok(Math.abs(result.yaw) <= 30 && result.pitch <= 30);
});

test('the nearest clear pose wins: a little higher before a lot to one side', () => {
  const direction = MIDDLE.clone().sub(IDEAL).normalize();
  const at = IDEAL.clone().addScaledVector(direction, 3);
  // A narrow trunk: raising the camera a few degrees clears it.
  const root = scene([at.x, at.y, at.z, 0.8, 8, 0.8, 'trunk']);
  const { result } = pose(root);
  assert.equal(result.clear, true);
  assert.ok(result.yaw === 0 || Math.abs(result.yaw) <= 6, `swung ${result.yaw}`);
  assert.ok(result.pitch <= 15, `raised ${result.pitch}`);
});

test('what stands within half a metre of the screen itself (its own frame, a rope) is not in the way', () => {
  const root = scene([0, 1.6, 0.3, 3.4, 2, 0.2, 'frame']);
  const { result } = pose(root);
  assert.equal(result.moved, false);
  assert.equal(result.clear, true);
});

test('a wall of foliage the camera cannot get round keeps the asked-for pose rather than a worse one', () => {
  const root = scene([0, 5, 6, 80, 30, 2, 'wall']);
  const { result } = pose(root);
  assert.equal(result.clear, false);
  assert.equal(result.moved, false);
  assert.ok(result.position.equals(IDEAL));
});

test('a branch at the lens, off the sight lines to the screen, still counts: the corners of the picture must be free for 2 m', () => {
  // 1.2 m ahead of the camera and a little above the line to the screen: the ray through the picture's top corner meets it, no ray to the
  // screen does (a phone's picture is tall and the screen is a thin strip across its middle).
  const forward = MIDDLE.clone().sub(IDEAL).normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward);
  const near = IDEAL.clone().addScaledVector(forward, 1.2).addScaledVector(up, 0.22);
  const root = scene([near.x, near.y, near.z, 0.5, 0.12, 0.5, 'branch']);
  assert.equal(sees(root, IDEAL), true, 'no ray to the screen is blocked (the setup)');
  const { result } = pose(root);
  assert.equal(result.moved, true, 'the pose with a branch at the lens is left');
  assert.ok(result.clear);
});

test('ground and water are not obstacles; a drawn mesh with nothing to show is not either', () => {
  const root = scene();
  const big = new THREE.Mesh(new THREE.PlaneGeometry(400, 400, 160, 160), new THREE.MeshBasicMaterial());
  big.rotation.x = -Math.PI / 2; big.position.y = 4; big.updateMatrixWorld(true); root.add(big);
  const sea = new THREE.Mesh(new THREE.BoxGeometry(20, 1, 20), new THREE.MeshBasicMaterial());
  sea.userData.waterSurface = true; sea.position.set(5, 3, 8); sea.updateMatrixWorld(true); root.add(sea);
  const ghost = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 1), new THREE.MeshBasicMaterial({ visible: false }));
  ghost.position.set(3, 3, 8); ghost.updateMatrixWorld(true); root.add(ghost);
  const hidden = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 1), new THREE.MeshBasicMaterial());
  hidden.visible = false; hidden.position.set(3, 3, 8); hidden.updateMatrixWorld(true); root.add(hidden);
  assert.equal(collectOccluders(root, MIDDLE, 60).length, 0);
});

test('collectOccluders leaves out what it is told to (the board, the car) and what is out of reach', () => {
  const root = scene([0, 1, 0, 1, 1, 1, 'near'], [200, 1, 0, 1, 1, 1, 'far'], [3, 1, 0, 1, 1, 1, 'car']);
  const car = root.children[2];
  const found = collectOccluders(root, MIDDLE, 40, [car, null, undefined]);
  assert.deepEqual(found.map(o => o.mesh.name), ['near']);
});

/** A pine 3 m in front of the lens on the line to the middle of the screen (the Ice Rink's). */
const pine = () => {
  const direction = MIDDLE.clone().sub(IDEAL).normalize();
  const at = IDEAL.clone().addScaledVector(direction, 3);
  return scene([at.x, at.y, at.z, 3.5, 5, 3.5, 'pine']);
};

test('the search is bounded by a count of poses and is deterministic', () => {
  const root = pine();
  const a = pose(root).result, b = pose(root).result;
  assert.ok(a.position.equals(b.position));
  assert.ok(a.tested < 12, `a pine is cleared in a handful of poses (${a.tested})`);
  const none = pose(root, { maxTests: 1 }).result;
  assert.equal(none.moved, false, 'only the asked-for pose may be examined: it stays');
  assert.equal(none.tested, 1);
  // A wall nothing gets round costs a bounded number of poses, whatever the world.
  const wall = pose(scene([0, 5, 6, 80, 30, 2, 'wall']), { maxTests: 20 }).result;
  assert.ok(wall.tested <= 20, `examined ${wall.tested} poses of at most 20`);
});

test('the pose does not depend on how fast the device is: a clock that runs 50 ms a look gives the same answer', () => {
  // A phone under load: every look at the clock costs 50 ms. The solver used to give up after 14 ms of wall clock and keep the blocked pose
  // (a screen of pine green); it must not read the clock at all, so the answer is the one of a fast device.
  const root = pine();
  const fast = pose(root).result;
  const original = performance.now.bind(performance);
  let t = 0;
  performance.now = () => (t += 50);
  let slow;
  try { slow = pose(root).result; } finally { performance.now = original; }
  assert.equal(slow.moved, true, 'the blocked pose is left');
  assert.equal(slow.clear, true);
  assert.ok(slow.position.equals(fast.position), 'same pose as on a fast device');
  assert.equal(t, 0, 'the solver never looks at the clock');
});

test('a parked car in front of the screen is seen over or past; the lens clearance ignores it', () => {
  // A car 2.4 to 4.9 m ahead of the screen, 1.3 m tall and 3 m wide: from the pose asked for (7, 5, 16) it hides the lower part of the screen.
  const car = scene([0, 0.65, 3.6, 3, 1.3, 2.5, 'car']);
  const vehicle = collectOccluders(car, MIDDLE, 40);
  assert.equal(vehicle.length, 1);
  assert.equal(sees(car, IDEAL), false, 'the car hides part of the screen from the asked-for pose (the setup)');
  const world = collectOccluders(scene(), MIDDLE, 40);
  // Left out of the rays (as before), the pose stays where it was asked for and the screen stays hidden.
  const left = clearFocusPose({ target: MIDDLE, position: IDEAL, samples: samples(), occluders: world, fov: FOV, ratio: RATIO });
  assert.equal(left.moved, false);
  // Counted, the camera goes where every sample can be seen.
  const seen = clearFocusPose({ target: MIDDLE, position: IDEAL, samples: samples(), occluders: world, vehicle, fov: FOV, ratio: RATIO });
  assert.equal(seen.moved, true);
  assert.equal(seen.clear, true);
  assert.ok(sees(car, seen.position), 'the new pose sees every sample past the car');
  assert.ok(seen.pitch > 0 || Math.abs(seen.yaw) > 0, 'raised or swung round');
  // A car at the lens (1 m ahead of the camera, off the line to the screen) is never a reason to move: only the world's own things count there.
  const forward = MIDDLE.clone().sub(IDEAL).normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward);
  const near = IDEAL.clone().addScaledVector(forward, 1.2).addScaledVector(up, 0.22);
  const beside = scene([near.x, near.y, near.z, 0.5, 0.12, 0.5, 'bonnet']);
  const atLens = clearFocusPose({ target: MIDDLE, position: IDEAL, samples: samples(), occluders: world, vehicle: collectOccluders(beside, MIDDLE, 40), fov: FOV, ratio: RATIO });
  assert.equal(atLens.moved, false);
  assert.equal(atLens.clear, true);
});
