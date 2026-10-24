import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RIM, buildLaneRim, layoutSockets } from '../../public/archipelago/preview/portfolio/world2/interactions/Career.js';
import { CAREER_TRACKS, CAREER_FIRST_MONTH, CAREER_LAST_MONTH } from '../../public/archipelago/preview/portfolio/world2/content/career.js';

// The road the career is measured against (the authored refLine empties), as Career.measure() reads it.
const NEAR = 6.5324, FAR = -10.465, OPEN_END = FAR - 0.146;
const at = (month) => NEAR - ((month - CAREER_FIRST_MONTH) / (CAREER_LAST_MONTH - CAREER_FIRST_MONTH)) * (NEAR - FAR);
/** Mirrors Career.plan(): where each stop's stone stands and where its slide would end. */
function placed(track) {
  return track.stops.map((stop) => {
    const from = at(stop.start), to = at(stop.end);
    const span = Math.max(2.1, Math.max(0, from - to));
    const head = (from + to) / 2 + span / 2;
    return { id: stop.id, head, tail: head - span, span, hasEnd: stop.end < CAREER_LAST_MONTH };
  });
}
const lanes = CAREER_TRACKS.map((track) => ({ track, raw: placed(track), laid: layoutSockets(placed(track)) }));

test('stops that overlap in time get distinct sockets and never move their heads', () => {
  for (const { track, raw, laid } of lanes) {
    laid.stops.forEach((stop, i) => assert.equal(stop.head, raw[i].head, `${track.id}/${stop.id}: a head never moves`));
    const zs = laid.sockets.map((socket) => socket.z);
    for (let i = 1; i < zs.length; i++) {
      const gap = zs[i - 1] - zs[i];
      // two heads may be as close as the data puts them; every socket a tail creates or joins is 1 m clear of the rest
      const tailOnly = laid.sockets[i].heads.length === 0 || laid.sockets[i - 1].heads.length === 0;
      if (tailOnly) assert.ok(gap >= 1 - 1e-9, `${track.id}: sockets ${zs[i - 1].toFixed(3)} and ${zs[i].toFixed(3)} are ${gap.toFixed(3)} m apart`);
    }
    for (const stop of laid.stops) {
      const home = laid.sockets.find((socket) => Math.abs(socket.z - stop.head) < 1e-9);
      assert.ok(home?.heads.includes(stop.id), `${track.id}/${stop.id}: its head is a socket`);
      assert.ok(stop.hasEnd === laid.sockets.some((socket) => socket.tails.includes(stop.id)), `${track.id}/${stop.id}: a tail socket iff the stop has an end`);
      if (stop.hasEnd) assert.ok(Math.abs(stop.span - (stop.head - stop.tail)) < 1e-9, `${track.id}/${stop.id}: span is head - tail`);
    }
  }
});

test('a tail moves down the road, by less than a metre, to the socket it must share or clear', () => {
  for (const { track, raw, laid } of lanes) {
    laid.stops.forEach((stop, i) => {
      if (!stop.hasEnd) { assert.equal(stop.tail, raw[i].tail); return; }
      const shift = stop.tail - raw[i].tail;
      assert.ok(Math.abs(shift) <= 1.0 + 1e-9, `${track.id}/${stop.id} moved ${shift.toFixed(3)} m`);
      assert.ok(stop.span >= raw[i].span - 0.4, `${track.id}/${stop.id} is not shortened`);
    });
  }
});

test('the seed career lays out as 3 + 7 + 4 sockets', () => {
  const counts = Object.fromEntries(lanes.map(({ track, laid }) => [track.id, laid.sockets.length]));
  assert.deepEqual(counts, { education: 3, work: 7, projects: 4 });
});

test('tails that end together, or where another stop begins, share one socket', () => {
  const result = layoutSockets([
    { id: 'a', head: 5, tail: 1.5, span: 3.5, hasEnd: true },
    { id: 'b', head: 1.6, tail: -3, span: 4.6, hasEnd: true },     // starts within 0.35 of a's end
    { id: 'c', head: 4, tail: -3.1, span: 7.1, hasEnd: true },     // ends within 0.35 of b's end
  ]);
  const a = result.stops[0], b = result.stops[1], c = result.stops[2];
  assert.equal(a.tail, b.head, 'a ends on b\'s head');
  assert.equal(b.tail, c.tail, 'b and c end on one socket');
  assert.equal(result.sockets.length, 4);
});

// ---- the rim ----

const SOCKET_HOLE = RIM.SOCKET_INNER * 2;
const triangles = (positions, index) => {
  const out = [];
  for (let i = 0; i < index.length; i += 3) out.push([0, 1, 2].map((k) => [positions[index[i + k] * 3], positions[index[i + k] * 3 + 1], positions[index[i + k] * 3 + 2]]));
  return out;
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const insideXZ = (tri, x, z) => {
  const [a, b, c] = tri, d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
  if (Math.abs(d) < 1e-12) return false;
  const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d, v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
  return u >= 0 && v >= 0 && u + v <= 1;
};
const laneOf = ({ laid }, x) => buildLaneRim({
  x,
  sockets: laid.sockets.map((socket) => socket.z),
  channels: laid.stops.map((stop) => [stop.hasEnd ? stop.tail : OPEN_END, stop.head]),
});

test('every rim triangle faces the way its vertex normals say, so lighting and culling agree', () => {
  for (const lane of lanes) {
    const { rim } = laneOf(lane, 27.064);
    const tris = triangles(rim.position, rim.index);
    assert.ok(tris.length > 100);
    tris.forEach((tri, i) => {
      const n = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]));
      const length = Math.hypot(...n);
      const vertex = [rim.normal[rim.index[i * 3] * 3], rim.normal[rim.index[i * 3] * 3 + 1], rim.normal[rim.index[i * 3] * 3 + 2]];
      assert.ok(length > 1e-9, `${lane.track.id}: triangle ${i} is degenerate`);
      assert.ok((n[0] * vertex[0] + n[1] * vertex[1] + n[2] * vertex[2]) / length > 0.99, `${lane.track.id}: triangle ${i} is wound against its normal`);
    });
  }
});

test('the hole in the rim is the coloured floor: 0.505 m square around every socket centre', () => {
  const x = 27.064;
  for (const lane of lanes) {
    const { rim, floor } = laneOf(lane, x);
    const tops = triangles(rim.position, rim.index).filter((tri) => tri.every((v) => Math.abs(v[1] - RIM.TOP) < 1e-9));
    const floors = triangles(floor.position, floor.index);
    const covered = (tris, px, pz) => tris.some((tri) => insideXZ(tri, px, pz));
    for (const socket of lane.laid.sockets) {
      // a point on a diagonal, so a channel running on does not stand in for the wall
      for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const near = SOCKET_HOLE / 2 - 0.01, far = SOCKET_HOLE / 2 + 0.01;
        assert.ok(covered(floors, x + sx * near, socket.z + sz * near), `${lane.track.id} ${socket.z.toFixed(3)}: floor 1 cm inside the corner`);
        assert.ok(!covered(tops, x + sx * near, socket.z + sz * near), `${lane.track.id} ${socket.z.toFixed(3)}: no rim 1 cm inside the corner`);
        assert.ok(covered(tops, x + sx * far, socket.z + sz * far), `${lane.track.id} ${socket.z.toFixed(3)}: rim 1 cm outside the corner`);
        assert.ok(!covered(floors, x + sx * far, socket.z + sz * far), `${lane.track.id} ${socket.z.toFixed(3)}: no floor 1 cm outside the corner`);
      }
      assert.ok(covered(floors, x, socket.z), `${lane.track.id} ${socket.z.toFixed(3)}: the centre is floor`);
    }
  }
});

test('the floor is exactly the area the rim leaves open: open inside every socket and channel, wall in the ring round them, nothing beyond', () => {
  const x = 25.051, eps = 0.003;
  for (const lane of lanes) {
    const { rim, floor } = laneOf(lane, x);
    const tops = triangles(rim.position, rim.index).filter((tri) => tri.every((v) => Math.abs(v[1] - RIM.TOP) < 1e-9));
    const floors = triangles(floor.position, floor.index);
    const sockets = lane.laid.sockets.map((socket) => socket.z);
    const channels = lane.laid.stops.map((stop) => [stop.hasEnd ? stop.tail : OPEN_END, stop.head]);
    // The specification, written independently of the generator: how far from the centre line the opening and the wall reach at z.
    const reach = (z, kind) => {
      let half = 0;
      for (const [low, high] of channels) if (z >= low - (kind === 'outer' ? RIM.CAP : 0) && z <= high) half = Math.max(half, kind === 'outer' ? RIM.CHANNEL_OUTER : RIM.CHANNEL_INNER);
      for (const c of sockets) if (Math.abs(z - c) <= (kind === 'outer' ? RIM.SOCKET_OUTER : RIM.SOCKET_INNER)) half = Math.max(half, kind === 'outer' ? RIM.SOCKET_OUTER : RIM.SOCKET_INNER);
      return half;
    };
    let open = 0, wall = 0, bare = 0;
    for (let z = OPEN_END - 0.6; z < NEAR + 0.6; z += 0.0317) {
      // a probe is only judged away from the places the profile changes, where the answer is a matter of the last millimetre
      const steady = [reach(z - eps, 'inner'), reach(z + eps, 'inner')].every((h, i, all) => h === all[0]) && [reach(z - eps, 'outer'), reach(z + eps, 'outer')].every((h, i, all) => h === all[0]);
      if (!steady) continue;
      for (let dx = -0.45; dx <= 0.45; dx += 0.0213) {
        const px = x + dx, inner = reach(z, 'inner'), outer = reach(z, 'outer');
        const isWall = tops.some((tri) => insideXZ(tri, px, z)), isOpen = floors.some((tri) => insideXZ(tri, px, z));
        if (Math.abs(Math.abs(dx) - inner) < eps || Math.abs(Math.abs(dx) - outer) < eps) continue;
        if (Math.abs(dx) < inner) { assert.ok(isOpen && !isWall, `${lane.track.id}: ${px.toFixed(3)}, ${z.toFixed(3)} should be open floor`); open++; }
        else if (Math.abs(dx) < outer) { assert.ok(isWall && !isOpen, `${lane.track.id}: ${px.toFixed(3)}, ${z.toFixed(3)} should be wall`); wall++; }
        else { assert.ok(!isWall && !isOpen, `${lane.track.id}: ${px.toFixed(3)}, ${z.toFixed(3)} should be bare`); bare++; }
      }
    }
    assert.ok(open > 50 && wall > 100 && bare > 100, `${lane.track.id}: judged ${open} open, ${wall} wall, ${bare} bare probes`);
  }
});

test('an open end is closed by a cap and the rim never reaches past the road by more than the cap', () => {
  const { laid } = lanes.find((lane) => lane.track.id === 'education');
  const { rim } = laneOf(lanes.find((lane) => lane.track.id === 'education'), 25.051);
  const zs = [];
  for (let i = 0; i < rim.position.length; i += 3) zs.push(rim.position[i + 2]);
  assert.ok(Math.abs(Math.min(...zs) - (OPEN_END - RIM.CAP)) < 1e-4, `the cap stands at ${Math.min(...zs).toFixed(4)}`);
  assert.ok(Math.abs(Math.max(...zs) - (laid.sockets[0].z + RIM.SOCKET_OUTER)) < 1e-4);
});

test('the rim is a few hundred triangles and the floor a few dozen', () => {
  for (const lane of lanes) {
    const { rim, floor } = laneOf(lane, 27.064);
    assert.ok(rim.index.length / 3 < 600, `${lane.track.id}: ${rim.index.length / 3} rim triangles`);
    assert.ok(floor.index.length / 3 < 80, `${lane.track.id}: ${floor.index.length / 3} floor triangles`);
  }
});
