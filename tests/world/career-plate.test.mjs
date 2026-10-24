import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leadBound as solve, pickLead, fitSize, floorSize, carEdge, homeFree, BOUND } from '../../public/archipelago/preview/portfolio/world2/interactions/Career.js';

// leadBound(point, out) takes its seven numbers in an array (it runs every frame and must not box them); name them here.
const leadBound = (a, da, z, dz, sign, limit, projection) => {
  const point = [];
  Object.entries({ A: a, DA: da, Z: z, DZ: dz, SIGN: sign, LIMIT: limit, PROJECTION: projection }).forEach(([name, value]) => { point[BOUND[name]] = value; });
  return solve(point);
};

/*
  A camera at the origin looking down -Z with a projection scale of 2 on the axis in question:
  a point at (a, z) lands at NDC 2a / -z. leadBound says how far a point that moves (da, dz) per
  metre of lead may be pushed before it leaves +-limit.
*/
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

test('a point past the left edge needs a lead, and says how much', () => {
  // x -5 at depth 10 is NDC -1; it drifts right 0.5 m per metre of lead; -0.8 is the limit.
  const [lo, hi] = leadBound(-5, 0.5, -10, 0, -1, 0.8, 2);
  near(lo, 2);
  assert.equal(hi, Infinity);
  // at exactly that lead the point sits on the limit, and past it is inside
  const ndc = (lead) => (2 * (-5 + 0.5 * lead)) / 10;
  near(ndc(lo), -0.8);
  assert.ok(ndc(lo + 0.1) > -0.8);
});

test('a point near the right edge has a ceiling on the lead', () => {
  const [lo, hi] = leadBound(4, 0.5, -10, 0, 1, 0.8, 2);
  assert.equal(lo, -Infinity);
  near(hi, 0);
});

test('moving away from the lens shrinks the picture, so the limit moves with it', () => {
  // each metre of lead is also a metre deeper: -5 / (10 + L) * 2 stays inside -0.8 once -10 + L >= -8 - 0.8 L
  const [lo] = leadBound(-5, 0.5, -10, -1, -1, 0.8, 2);
  near(lo, 2 / 1.8);
  const ndc = (lead) => (2 * (-5 + 0.5 * lead)) / (10 + lead);
  near(ndc(lo), -0.8);
});

test('a point that does not move across the screen with the lead puts no limit on it', () => {
  assert.deepEqual(leadBound(1, 0, -10, 0, 1, 0.8, 2), [-Infinity, Infinity]);
});

test('the answer is written into the array it is given, so a per-frame caller allocates nothing', () => {
  const out = [0, 0];
  const point = [];
  point[BOUND.A] = -5; point[BOUND.DA] = 0.5; point[BOUND.Z] = -10; point[BOUND.DZ] = 0; point[BOUND.SIGN] = -1; point[BOUND.LIMIT] = 0.8; point[BOUND.PROJECTION] = 2;
  assert.equal(solve(point, out), out);
  near(out[0], 2);
  assert.equal(out[1], Infinity);
});

test('the upper edge works the same way', () => {
  // y 3 at depth 10, projection 2: NDC 0.6, rising 0.2 m per metre of lead, limit 0.74
  const [lo, hi] = leadBound(3, 0.2, -10, 0, 1, 0.74, 2);
  assert.equal(lo, -Infinity);
  // 0.6 + 0.04 L <= 0.74
  near(hi, 3.5);
});

test('a limit may be negative: keeping a point left of a thing that is itself left of the middle', () => {
  // x -1 at depth 10, projection 2: NDC -0.2, drifting right 0.5 m per metre of lead. Keep it left of NDC -0.1: -0.2 + 0.1 L <= -0.1
  const [lo, hi] = leadBound(-1, 0.5, -10, 0, 1, -0.1, 2);
  assert.equal(lo, -Infinity);
  near(hi, 1);
  // and with the point drifting LEFT instead, the same wish is a floor, not a ceiling
  const [lo2, hi2] = leadBound(1, -0.5, -10, 0, 1, -0.1, 2);
  assert.equal(hi2, Infinity);
  near(lo2, 3);
  assert.ok((2 * (1 - 0.5 * 3)) / 10 <= -0.1 + 1e-9);
});

test('the plate takes the limit of its slot, whichever end of the road that limit is on', () => {
  // "no further along than 1.5": the furthest along it may be, the nearest the car
  near(pickLead([-Infinity, 1.5], -4, 7, 2.4), 1.5);
  // "at least 0.5 along": the least along it may be
  near(pickLead([0.5, Infinity], -4, 7, 2.4), 0.5);
  // nothing known about the slot (no camera, the car behind the lens): the default
  near(pickLead([-Infinity, Infinity], -4, 7, 2.4), 2.4);
});

test('the screen outranks the slot: a phone with no room keeps the plate in view', () => {
  // the slot wants -6, the left edge of the screen needs at least -1.5
  near(pickLead([-Infinity, -6], -1.5, 7, 2.4), -1.5);
  // the slot wants a lead of 9, the right edge allows 7
  near(pickLead([9, Infinity], -4, 7, 2.4), 7);
  // the screen's own limits disagree: the upper one wins, as it always has
  near(pickLead([-Infinity, 1], 8, 7, 2.4), 7);
});

/*
  fitSize finds the largest plate the screen has room for. "Room" is monotone: a plate that fits fits at every smaller size.
*/
test('a plate that fits at full size keeps it, and that is all that is asked of the screen', () => {
  const asked = [];
  const size = fitSize((s) => { asked.push(s); return true; }, 0.6, 1.38);
  assert.equal(size, 1.38);
  assert.deepEqual(asked, [1.38]);
});

test('a plate that fits nowhere is drawn at its smallest, never smaller', () => {
  assert.equal(fitSize(() => false, 0.6, 1.38), 0.6);
});

test('between the two it takes the largest size that fits, to a third of a percent', () => {
  for (const room of [0.62, 0.7, 0.706, 0.91, 1.11, 1.2, 1.37]) {
    const size = fitSize((s) => s <= room, 0.6, 1.38);
    assert.ok(size <= room, `${size} must fit in ${room}`);
    assert.ok(room - size < 0.78 / 2 ** 8 + 1e-12, `${size} is not close to ${room}`);
  }
});

test('the answer is always a size that fits, and a frame asks at most steps + 2 times', () => {
  let asked = 0;
  const size = fitSize((s) => { asked++; return s <= 0.8; }, 0.6, 1.38, 8);
  assert.ok(size <= 0.8 && size > 0.79);
  assert.equal(asked, 10);
});

test('a plate is smaller on a narrow screen: the room left of the car, set against the plate\'s own width', () => {
  // clip space, one metre of the picture = k of the half-width. A car 1.5 m from the middle needs 1.5k of clear ground to its left.
  const room = (k, limit = 0.95) => (s) => (2 * 1.022 * s) * k <= limit - 1.5 * k;
  // k is what the QA measures on a 390x844 phone, an 820x1180 tablet and a 1440x900 desktop (the car's 1.45 m is 0.458, 0.359 and 0.194 of the half-width)
  const phone = fitSize(room(0.316), 0.6, 1.38), tablet = fitSize(room(0.2476), 0.6, 1.38), desktop = fitSize(room(0.134), 0.6, 1.38);
  assert.ok(phone < tablet && tablet < desktop, `${phone} < ${tablet} < ${desktop}`);
  assert.equal(desktop, 1.38);
  // a 390x844 phone is the narrowest common screen: 0.7 of the authored plate, which is still 93 px wide there
  assert.ok(phone > 0.68 && phone < 0.74, `${phone}`);
});

/*
  homeFree: may the plate wait at its home while the car is where it is? It may if it is clear of the car on the screen (left of it
  as the slot asks, right of it, or higher up the picture), and the car is only in its way where none of those holds.
*/
test('the home is free where the plate would be clear of the car, on whichever side', () => {
  const none = [Infinity, -Infinity];
  // left of the car for leads up to -1, right of it from 4 on
  const left = [-Infinity, -1], right = [4, Infinity];
  assert.equal(homeFree(-3, left, right), true);
  assert.equal(homeFree(5, left, right), true);
  // between them the plate and the car are one over the other
  assert.equal(homeFree(0.5, left, right), false);
  assert.equal(homeFree(3.9, left, right), false);
  // the limits themselves are clear (a bound is where the plate stands exactly the room away)
  assert.equal(homeFree(-1, left, right), true);
  assert.equal(homeFree(4, left, right), true);
  // higher up the picture than the car is clear too, which a plate far up the road is whatever its lane
  assert.equal(homeFree(0.5, left, right, [0, Infinity]), true);
  assert.equal(homeFree(-0.5, left, right, [0, Infinity]), false);
  assert.equal(homeFree(0.5, left, right, none), false);
});

test('with no car to measure against the home is always free: the slot is open at both ends', () => {
  assert.equal(homeFree(7, [-Infinity, Infinity], [-Infinity, Infinity]), true);
  assert.equal(homeFree(-7, [-Infinity, Infinity], [-Infinity, Infinity]), true);
});

test('the right of the car is the same bound as the left, seen from the other side', () => {
  // a point at x -1 at depth 10 (projection 2), drifting right 0.5 m per metre of lead, keep it right of NDC 0.1:
  // -0.2 + 0.1 L >= 0.1  <=>  L >= 3. leadBound keeps a point inside a limit, so the sign is -1 and the limit is -0.1.
  const [lo, hi] = leadBound(-1, 0.5, -10, 0, -1, -0.1, 2);
  near(lo, 3);
  assert.equal(hi, Infinity);
  assert.equal(homeFree(3.2, [-Infinity, -2], [lo, hi]), true);
  assert.equal(homeFree(2.5, [-Infinity, -2], [lo, hi]), false);
});

/*
  floorSize: the least the plate is drawn at is a width on the SCREEN (css px), so that a camera that comes in on it shrinks it in the
  world, to the same size on the screen, instead of holding it at a size that fills the car's side and then lying across the bonnet.
*/
test('the floor is the size at which the plate is as wide on the screen as asked', () => {
  // a 390 px phone, the chase camera 31.3 m out (projection scale 9.76 across), a plate 2.03 m wide at size 1
  const size = floorSize(74, 390, 31.3, 9.76, 2.03, 1.38);
  assert.ok(Math.abs(((size * 2.03 * 9.76) / 31.3) * (390 / 2) - 74) < 1e-9, `${size}`);
  assert.ok(size > 0.55 && size < 0.6, `${size}`);
});

test('the closer the camera, the smaller the floor, and the wider the screen, the smaller it is too', () => {
  const at = (canvas, depth, projection) => floorSize(74, canvas, depth, projection, 2.03, 1.38);
  // a phone pinched in from 31 m to 15 m: the same 74 px is half the plate
  assert.ok(at(390, 15, 9.76) < at(390, 31.3, 9.76) * 0.55);
  // a tablet has the pixels: 74 px of 820 is a fraction of what it is of 390
  assert.ok(at(820, 26.6, 6.49) < at(390, 31.3, 9.76) * 0.65);
  // and a camera that is nearer never asks for more
  let last = Infinity;
  for (let depth = 56; depth >= 15; depth -= 1) { const size = at(390, depth, 9.76); assert.ok(size <= last + 1e-12); last = size; }
});

test('the floor is never more than the plate can be, and an input with no number gives the most', () => {
  // a camera so far out that the biggest plate is narrower than 74 px: it is drawn at its biggest
  assert.equal(floorSize(74, 390, 400, 9.76, 2.03, 1.38), 1.38);
  for (const bad of [[NaN, 390, 31, 9.76, 2.03], [74, 0, 31, 9.76, 2.03], [74, 390, 31, 0, 2.03], [74, 390, 31, 9.76, 0], [74, 390, -31, 9.76, 2.03]]) {
    assert.equal(floorSize(...bad, 1.38), 1.38, `${bad}`);
  }
});

test('where no size fits the plate stays at the floor, so the caller can tell it is not there', () => {
  // fitSize returns the floor both where the plate fits only at the floor and where it fits nowhere: only the floor itself tells them apart
  const floor = 0.55;
  const room = (limit) => (s) => s <= limit;
  assert.equal(fitSize(room(0.55), floor, 1.38), floor);
  assert.equal(fitSize(room(0.4), floor, 1.38), floor);
  assert.equal(room(0.55)(floor), true);
  assert.equal(room(0.4)(floor), false);
  // the plate pinched in on a phone: 0.55 of a 74 px floor fitted at 31 m, and fits nowhere at 15 m
  const phone = (depth) => { const f = floorSize(74, 390, depth, 9.76, 2.03, 1.38); const half = 0.95 * (depth / 9.76) - 1.5; return { f, fits: (s) => s * 2.03 <= half }; };
  const far = phone(31.3), near = phone(15);
  assert.ok(far.fits(far.f) && fitSize(far.fits, far.f, 1.38) > far.f);
  assert.ok(!near.fits(near.f));
});

/*
  carEdge: the car's outer edge on the screen. Its near parts (the bumper, a wheel, the roof) are nearer the lens than its middle, and
  a point out to the side is further out on the picture by the ratio of the depths.
*/
test('the car\'s edge is further out than its middle\'s depth says, on either side', () => {
  // 1.5 m out to the left at 15 m, the edge standing 0.9 m nearer: 1.5 / 14.1 instead of 1.5 / 15
  near(carEdge(2, -1.5, 15, 0.9, -1), (2 * -1.5) / 14.1);
  near(carEdge(2, 1.5, 15, 0.9, 1), (2 * 1.5) / 14.1);
  assert.ok(Math.abs(carEdge(2, -1.5, 15, 0.9, -1)) > Math.abs((2 * -1.5) / 15));
});

test('a car that is out to the other side of the middle has its edge on the far part, where it is least out', () => {
  // the left edge of a car whose middle is 4 m to the right of the middle of the picture is the far part's: 2.5 / 15.9 is the least it reaches
  near(carEdge(2, 2.5, 15, 0.9, -1), (2 * 2.5) / 15.9);
  near(carEdge(2, -2.5, 15, 0.9, 1), (2 * -2.5) / 15.9);
});

test('the nearer the camera, the more the near parts count, and a lens that is inside the car gives a number, not a flip', () => {
  const stretch = (depth) => carEdge(1, -1.5, depth, 0.9, -1) / ((1 * -1.5) / depth);
  assert.ok(stretch(15) > stretch(31) && stretch(31) > 1);
  assert.ok(Number.isFinite(carEdge(2, -1.5, 0.5, 0.9, -1)));
  assert.ok(carEdge(2, -1.5, 0.5, 0.9, -1) < 0);
});
