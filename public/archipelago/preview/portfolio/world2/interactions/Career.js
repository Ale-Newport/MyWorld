import * as THREE from 'three';
import { Billboards, MAP_HIDDEN_LAYER } from './Billboards.js';
import { CAREER, CAREER_FIRST_MONTH, CAREER_LAST_MONTH, CAREER_FIRST_YEAR, CAREER_TRACKS, } from '../content/career.js';
import { Sign, SignRuntime, TOKENS, drawFit, drawNail, fitText, paintParchment, paintWood, roundRect, signFonts, signMaterials, } from '../signs/index.js';
const ELEVATION = 2.5;
const PADDING = 0.25;
const MIN_SPAN = 2.1;
const LANE_LIFT = { education: 0.95, work: 0.75, projects: 0.55 };
const PLAQUE_HEIGHT = 0.91;
const PLAQUE_MAX_WIDTH = 4.4;
const PLAQUE_GAP = 0.36;
const PLAQUE_ORDER = 3;
const LABEL_DPM = 280;
const LABEL_ANISOTROPY = 4;
const PLAQUE_LIGHT = 0.84;
const PLAQUE_SCALE = { ref: 31, min: 1, max: 1.8 };
export const SAFE = { x: 0.94, top: 0.8, bottom: 0.9, spacing: 0.02 };
const SLIDE_RATE = 10;
const MIN_SUB_PX = 12;
const FIT_MAX = 2.2;
const REVEAL_RADIUS = 14;
const REVEAL_HOLD = 3;
const VIEW_MARGIN = 0.05;
const VIEW_HOLD = 0.2;
const NEAR_CUT = 4;
const NEAR_SHARE = 0.8;
const DESIGN_SLACK = 1.05;
const DEFAULT_ZOOM = 0.6;
const REFERENCE_DEPTH = 21;
const GAP_SHARE = 0.26;
const GAP_ENTER = 0.8;
const LANE_SPREAD = 6;
const HIDE_SHARE = 0.06;
const HIDE_NEAR = 0.04;
const HIDE_KEPT = 0.02;
const GIVE_UP_AFTER = 0.3;
const REVIVE_AFTER = 0.15;
const LATCH_WINDOW = 5;
const REVIVE_WARY = 1;
const WARY_RESET = 10;
const LATCH_EPS = 0.004;
const SLIDE_MAX_PX = 400;
const REVIVE_SNAP = 0.35;
const SETTLE_FAR = 0.08;
const SETTLE_SAME = 0.15;
const SETTLE_AFTER = 0.25;
const RELOCATE_HIDDEN = 0.1;
const RELOCATE_FAINT = 0.5;
const RELOCATE_RATE = 9;
const RELOCATE_RAMP = 0.1;
const CROSS_LENGTH = 0.12;
const RESCUE_MOVE = 0.25;
const RESCUE_AFTER = GIVE_UP_AFTER / 2;
const SETTLING = 3;
const CROSS_AFTER = 0.4;
const CROSS_ON = 0.04;
const PINS = 4;
const STANDS_MIN = 0.03;
const ASTRAY = 0.012;
const WIDTH_SHARE = 0.4;
const BAR_CLEAR_PX = 10;
const HUD_CLEAR_PX = 8;
const HUD_POLL_MS = 250;
const CAR_KEEP = { radius: 1.45, wide: 1.60, below: 1.1, above: 0.7, pad: 0.015 };
const SEGMENTS = [0b0111111, 0b0000110, 0b1011011, 0b1001111, 0b1100110, 0b1101101, 0b1111101, 0b0000111, 0b1111111, 0b1101111];
const SEGMENT_RISE = 0.42;
const READOUT = '#fff1c9';
const PLATE_SCALE = 1.38;
const PLATE_MIN_PX = 74;
const PLATE_MIN_WIDTH = 390;
const PLATE_MIN_SHARE = 0.19;
const PLATE_AWAY = true;
const MODE_HYST = 0.2;
const PLATE_SHRINK = 20;
const PLATE_GROW = 1.5;
const FIT_STEPS = 8;
const FIT_EVERY = 6;
const CAMERA_MOVING = 0.01;
const PLATE_TURN = 6;
const BAR_RATE = 9;
const YEAR_HYSTERESIS = 0.15;
const PLATE_LEAD = 2.4;
const PLATE_SLOT = true;
const CAR_CLEAR = 1.9;
const CAR_BODY = 1.5;
const CAR_NEAR = 0.9;
const PLATE_BACK = 5.5;
const FOLLOW_CLAMP = true;
const PLATE_LEAD_MAX = 7;
const PLATE_OVERRUN = 5;
const DODGE_ENTER = 2.6;
const DODGE_EXIT = 3.8;
const DODGE_ABOVE = 0.6;
const DODGE_MAX = 16;
const HOP = 2.5;
const HOP_SPEED = 25;
const POP_OUT = 8;
const POP_IN = 5;
const LABEL_HOLE = 1;
const HOLE_PAD = 0.015;
const HOLE_FEATHER = 0.03;
const PLAQUE_VERTEX = `
uniform float uInvWidth;
varying vec2 vUv;
varying vec3 vClip;
varying float vAlong;
void main() {
  vUv = uv;
  vAlong = position.x * uInvWidth + 0.5;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vClip = vec3(clip.xy, clip.w);
  gl_Position = clip;
}
`;
const PLAQUE_FRAGMENT = `
uniform sampler2D map;
uniform float reveal;
uniform vec4 uPlate;
uniform vec4 uCar;
varying vec2 vUv;
varying vec3 vClip;
varying float vAlong;
void main() {
  if (vAlong > reveal) discard;
  vec2 ndc = vClip.xy / vClip.z;
  vec2 across = smoothstep(uPlate.xy - ${HOLE_FEATHER.toFixed(3)}, uPlate.xy, ndc) * (1.0 - smoothstep(uPlate.zw, uPlate.zw + ${HOLE_FEATHER.toFixed(3)}, ndc));
  vec2 over = smoothstep(uCar.xy - ${HOLE_FEATHER.toFixed(3)}, uCar.xy, ndc) * (1.0 - smoothstep(uCar.zw, uCar.zw + ${HOLE_FEATHER.toFixed(3)}, ndc));
  if (${LABEL_HOLE.toFixed(3)} * max(across.x * across.y, over.x * over.y) > 0.5) discard;
  gl_FragColor = vec4(texture2D(map, vUv).rgb * ${PLAQUE_LIGHT.toFixed(3)}, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
const SAFE_X = 0.95;
const SAFE_TOP = 0.74;
const SAFE_BOTTOM = 0.8;
const READOUT_ON_TOP = true;
const READOUT_LIFT = 4;
const OPEN_END = 0.146;
const MERGE = 0.35;
const SEPARATION = 1.0;
const REPLACED = ['Plane.049', 'Plane.018', 'Plane.022', 'Plane.035', 'Plane.048', 'Plane.030'];
function sortByHeight(rects, n) {
    for (let i = 1; i < n; i++) {
        const item = rects[i];
        const top = item.y1;
        let j = i - 1;
        while (j >= 0 && rects[j].y1 < top) {
            rects[j + 1] = rects[j];
            j--;
        }
        rects[j + 1] = item;
    }
}
export const BOUND = { A: 0, DA: 1, Z: 2, DZ: 3, SIGN: 4, LIMIT: 5, PROJECTION: 6 };
export function leadBound(point, out = [0, 0]) {
    const sign = point[BOUND.SIGN], limit = point[BOUND.LIMIT], projection = point[BOUND.PROJECTION];
    const at0 = sign * projection * point[BOUND.A] + limit * point[BOUND.Z];
    const per = sign * projection * point[BOUND.DA] + limit * point[BOUND.DZ];
    if (Math.abs(per) < 1e-9) {
        out[0] = -Infinity;
        out[1] = Infinity;
        return out;
    }
    const lead = -at0 / per;
    if (per > 0) {
        out[0] = -Infinity;
        out[1] = lead;
    }
    else {
        out[0] = lead;
        out[1] = Infinity;
    }
    return out;
}
export function pickLead(slot, lowest, highest, fallback) {
    let lead = fallback;
    if (slot[1] !== Infinity)
        lead = slot[1];
    else if (slot[0] !== -Infinity)
        lead = slot[0];
    return Math.min(highest, Math.max(lowest, lead));
}
const NO_RANGE = [Infinity, -Infinity];
export function homeFree(lead, left, right, above = NO_RANGE) {
    return (lead >= left[0] && lead <= left[1]) || (lead >= right[0] && lead <= right[1]) || (lead >= above[0] && lead <= above[1]);
}
export function fitSize(fits, min, max, steps = 8) {
    if (fits(max))
        return max;
    if (!(fits(min)))
        return min;
    let low = min, high = max;
    for (let i = 0; i < steps; i++) {
        const mid = (low + high) / 2;
        if (fits(mid))
            low = mid;
        else
            high = mid;
    }
    return low;
}
export function plaqueReach(was, lateral, ax, ay, depth) {
    if (!(lateral <= REVEAL_RADIUS + (was ? REVEAL_HOLD : 0)))
        return false;
    if (!(depth > NEAR_CUT + (was ? -1 : 0)))
        return false;
    const edge = 1 + VIEW_MARGIN + (was ? VIEW_HOLD : 0);
    return Math.abs(ax) <= edge && Math.abs(ay) <= edge;
}
export function plaqueFit(subPx, depth, carDepth, share = 0) {
    const readable = MIN_SUB_PX / subPx;
    const floor = carDepth * NEAR_SHARE;
    let capped = depth < floor ? Math.max(depth, 0.5) / floor : 1;
    if (share > 0) {
        const narrow = WIDTH_SHARE / share;
        if (narrow < capped)
            capped = narrow;
    }
    const fit = readable > capped ? readable : capped;
    return fit > FIT_MAX ? FIT_MAX : fit;
}
export function plaqueFactor(dist) {
    const k = dist / PLAQUE_SCALE.ref;
    return k < PLAQUE_SCALE.min ? PLAQUE_SCALE.min : k > PLAQUE_SCALE.max ? PLAQUE_SCALE.max : k;
}
export function defaultDepth(min, max, offset, overflow) {
    const depth = min + (max + overflow * offset - min) * (1 - DEFAULT_ZOOM);
    return Number.isFinite(depth) && depth > 1 ? depth : REFERENCE_DEPTH;
}
export function plaqueCap(sub, height, project, depth, dist, carDepth, design, share = 0) {
    const there = Math.max(1, design + depth - carDepth);
    const factorThere = plaqueFactor((dist * there) / depth);
    const fitThere = plaqueFit((sub * factorThere * height * 0.5 * project) / there, there, design, (share * factorThere * depth) / (plaqueFactor(dist) * there));
    const cap = (DESIGN_SLACK * fitThere * factorThere * depth) / (there * plaqueFactor(dist));
    return Number.isFinite(cap) && cap > 0 ? cap : Infinity;
}
export function carEdge(projection, x, depth, near, side) {
    return (projection * x) / Math.max(0.1, x * side > 0 ? depth - near : depth + near);
}
export function plateFloorPx(canvas) {
    return canvas > 0 && canvas < PLATE_MIN_WIDTH ? (PLATE_MIN_PX * canvas) / PLATE_MIN_WIDTH : PLATE_MIN_PX;
}
export function floorSize(px, canvas, depth, projection, width, max) {
    const size = ((px / canvas) * 2 * depth) / (projection * width);
    return Number.isFinite(size) && size > 0 ? Math.min(max, size) : max;
}
export class Hud {
    constructor() {
        this.width = 1;
        this.height = 1;
        this.top = 0;
        this.touch = { x0: 2, y0: 2, x1: -2, y1: -2, hard: true };
        this.speed = { x0: 2, y0: 2, x1: -2, y1: -2, hard: true };
        this.at = -Infinity;
        this.seenWidth = -1;
        this.seenHeight = -1;
    }
    measure() {
        if (typeof document === 'undefined')
            return;
        const now = performance.now();
        if (now - this.at < HUD_POLL_MS && innerWidth === this.seenWidth && innerHeight === this.seenHeight)
            return;
        this.at = now;
        this.seenWidth = innerWidth;
        this.seenHeight = innerHeight;
        const canvas = document.getElementById('world')?.getBoundingClientRect();
        const left = canvas?.left ?? 0, top = canvas?.top ?? 0;
        const width = canvas && canvas.width > 0 ? canvas.width : innerWidth;
        const height = canvas && canvas.height > 0 ? canvas.height : innerHeight;
        this.width = width;
        this.height = height;
        const bar = document.getElementById('player-nav')?.getBoundingClientRect();
        this.top = bar && bar.height > 0 ? Math.max(0, bar.bottom - top) : 0;
        this.keepOff('touch-controls', this.touch, left, top, width, height);
        this.keepOff('drive-hud', this.speed, left, top, width, height);
    }
    keepOff(id, out, left, top, width, height) {
        const box = document.getElementById(id)?.getBoundingClientRect();
        if (box && box.width > 0 && box.height > 0) {
            out.x0 = ((box.left - left - HUD_CLEAR_PX) / width) * 2 - 1;
            out.x1 = ((box.right - left + HUD_CLEAR_PX) / width) * 2 - 1;
            out.y1 = 1 - ((box.top - top - HUD_CLEAR_PX) / height) * 2;
            out.y0 = 1 - ((box.bottom - top + HUD_CLEAR_PX) / height) * 2;
        }
        else {
            out.x0 = 2;
            out.y0 = 2;
            out.x1 = -2;
            out.y1 = -2;
        }
    }
}
export class Career {
    get still() { return this.motion?.matches === true; }
    constructor(game, references, bin) {
        this.game = game;
        this.references = references;
        this.bin = bin;
        this.lines = [];
        this.group = new THREE.Group();
        this.lanes = {};
        this.yearGroup = null;
        this.yearHomeZ = 0;
        this.yearCareerZ = 0;
        this.yearOffset = 0;
        this.plateReach = null;
        this.spot = new THREE.Vector3();
        this.step = new THREE.Vector3();
        this.lowest = 0;
        this.highest = 0;
        this.range = [0, 0];
        this.point = new Float64Array(7);
        this.car = new THREE.Vector3();
        this.plateRect = { value: new THREE.Vector4(2, 2, -2, -2) };
        this.carRect = { value: new THREE.Vector4(2, 2, -2, -2) };
        this.housing = null;
        this.housingBox = null;
        this.clip = new THREE.Matrix4();
        this.corner = new THREE.Vector4();
        this.leading = PLATE_LEAD;
        this.size = PLATE_SCALE;
        this.fitted = PLATE_SCALE;
        this.sized = false;
        this.sinceFit = 0;
        this.lastDepth = 0;
        this.homeScale = new THREE.Vector3(1, 1, 1);
        this.up = 0;
        this.deep = 0;
        this.worldScale = 1;
        this.carDepth = 0;
        this.designAt = REFERENCE_DEPTH;
        this.designFor = NaN;
        this.projection = null;
        this.slot = [-Infinity, Infinity];
        this.hasRoom = (size) => this.limits(size, this.roomClear);
        this.roomClear = CAR_BODY;
        this.right = [-Infinity, Infinity];
        this.above = [-Infinity, Infinity];
        this.ready = false;
        this.away = false;
        this.moved = false;
        this.homeLead = 0;
        this.dodging = false;
        this.pop = 1;
        this.hopping = false;
        this.lastTarget = 0;
        this.offsetSet = false;
        this.speaking = new Map();
        this.current = CAREER_FIRST_YEAR;
        this.digits = [];
        this.near = 0;
        this.far = 0;
        this.centre = new THREE.Vector3();
        this.reach = 0;
        this.socketList = [];
        this.track = null;
        this.readout = null;
        this.faced = false;
        this.grown = false;
        this.motion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
        this.aim = new THREE.Vector3();
        this.turn = new THREE.Quaternion();
        this.kit = null;
        this.stoneTop = 0.9;
        this.warm = null;
        this.disposed = false;
        this.inReach = false;
        this.slots = [];
        this.shown = [];
        this.clock = 0;
        this.arrivedAt = -Infinity;
        this.asked = new Float64Array(0);
        this.work = [];
        this.answer = new Float64Array(64);
        this.answerOut = new Uint8Array(32);
        this.spare = new Float64Array(128);
        this.spareOut = new Uint8Array(32);
        this.hud = new Hud();
        this.safe = { ...SAFE };
        this.keepPlate = { x0: 2, y0: 2, x1: -2, y1: -2, margin: LEAN_PLATE };
        this.keepCar = { x0: 2, y0: 2, x1: -2, y1: -2, margin: CAR_KEEP.pad };
        this.pins = Array.from({ length: PINS }, () => ({ x0: 2, y0: 2, x1: -2, y1: -2, hard: true, plaque: true }));
        this.keepOuts = [this.keepPlate, this.keepCar, this.hud.touch, this.hud.speed];
        this.keepPinned = [...this.keepOuts, ...this.pins];
        this.subMin = NOMINAL_SUB;
        this.where = new THREE.Vector3();
        this.least = PLATE_SCALE;
        this.visited = new Set();
        this.group.name = 'World2 / career';
        this.measure();
        this.retireColliders();
        this.buildLines();
        this.buildYear();
        if (this.lines.length) {
            for (const line of this.lines)
                this.centre.add(line.origin);
            this.centre.divideScalar(this.lines.length);
            this.reach = Math.max(...this.lines.map(line => this.centre.distanceTo(line.origin))) + 28;
        }
        this.group.traverse(node => { node.userData.proceduralDerived = true; });
        const tick = () => this.update();
        game.ticker.events.on('tick', tick, 11);
        bin.add(() => {
            game.ticker.events.off('tick', tick);
            this.disposed = true;
            this.kit?.materials.dispose();
            if (this.warm) {
                this.warm.geometry.dispose();
                this.warm.material.uniforms.map.value.dispose();
                this.warm.material.dispose();
            }
            for (const digit of this.digits) {
                digit.material.dispose();
                digit.mesh.geometry.dispose();
            }
            this.readout?.dispose();
            if (this.track) {
                this.track.rim.geometry.dispose();
                this.track.floor.geometry.dispose();
                this.track.floor.material.dispose();
            }
        });
        bin.object3D(this.group);
    }
    measure() {
        const authored = this.references.series('refLine');
        const xs = [];
        let near = -Infinity, far = Infinity;
        for (const node of authored) {
            const at = node.getWorldPosition(new THREE.Vector3());
            const size = Number(node.userData.size ?? 3) || 3;
            xs.push(at.x);
            near = Math.max(near, at.z);
            far = Math.min(far, at.z - size);
        }
        const yearNode = this.references.node('refYear');
        if (yearNode) {
            const home = yearNode.getWorldPosition(new THREE.Vector3());
            this.lanes.year = home.x;
            this.yearCareerZ = home.z;
        }
        const unique = [...new Set(xs.map(x => Math.round(x * 1000) / 1000))].sort((a, b) => a - b);
        const order = ['education', 'work', 'projects'];
        order.forEach((track, index) => { this.lanes[track] = unique[index] ?? unique[unique.length - 1] ?? 27; });
        this.near = Number.isFinite(near) ? near : 6.5;
        this.far = Number.isFinite(far) ? far : -10.5;
    }
    at(month) {
        const span = Math.max(1, CAREER_LAST_MONTH - CAREER_FIRST_MONTH);
        const t = (month - CAREER_FIRST_MONTH) / span;
        return this.near - t * (this.near - this.far);
    }
    plan() {
        const plans = [];
        for (const track of CAREER_TRACKS) {
            const x = this.lanes[track.id];
            if (x === undefined)
                continue;
            const placed = track.stops.map((stop) => {
                const from = this.at(stop.start);
                const to = this.at(stop.end);
                const span = Math.max(MIN_SPAN, Math.max(0, from - to));
                const head = (from + to) / 2 + span / 2;
                return { id: stop.id, head, tail: head - span, span, hasEnd: stop.end < CAREER_LAST_MONTH };
            });
            const { stops, sockets } = layoutSockets(placed, { merge: MERGE, separation: SEPARATION });
            plans.push({ track, x, stops, sockets });
        }
        return plans;
    }
    buildTrack(plans) {
        const plate = this.references.node('Plane.049');
        const strip = this.references.node('Plane.018');
        for (const name of ['Plane.035', 'Plane.018', 'Plane.022'])
            this.references.suppress(name);
        const bounds = plate ? new THREE.Box3().setFromObject(plate) : null;
        const spec = {
            ...RIM,
            TOP: bounds ? bounds.max.y : RIM.TOP,
            FOOT: bounds ? bounds.min.y : RIM.FOOT,
            FLOOR: strip ? new THREE.Box3().setFromObject(strip).max.y : RIM.FLOOR,
        };
        if (plate instanceof THREE.Mesh)
            this.keepYearLane(plate, plans);
        const positions = [], normals = [], indices = [];
        const floorPositions = [], floorColours = [], floorIndices = [];
        const sockets = [];
        for (const lane of plans) {
            const built = buildLaneRim({
                x: lane.x,
                sockets: lane.sockets.map(socket => socket.z),
                channels: lane.stops.map((stop) => [stop.hasEnd ? stop.tail : this.far - OPEN_END, stop.head]),
            }, spec);
            const base = positions.length / 3;
            for (const value of built.rim.position)
                positions.push(value);
            for (const value of built.rim.normal)
                normals.push(value);
            for (const value of built.rim.index)
                indices.push(base + value);
            const floorBase = floorPositions.length / 3;
            for (const value of built.floor.position)
                floorPositions.push(value);
            for (const value of built.floor.index)
                floorIndices.push(floorBase + value);
            const colour = new THREE.Color(lane.track.colour);
            for (let i = 0; i < built.floor.position.length / 3; i++)
                floorColours.push(colour.r, colour.g, colour.b);
            for (const socket of lane.sockets)
                sockets.push({ lane: lane.track.id, x: lane.x, z: socket.z, heads: socket.heads, tails: socket.tails });
        }
        this.socketList = sockets;
        if (!indices.length)
            return;
        const texel = plate instanceof THREE.Mesh ? plate.geometry.getAttribute('uv') : null;
        const material = plate instanceof THREE.Mesh
            ? (Array.isArray(plate.material) ? plate.material[0] : plate.material)
            : new THREE.MeshStandardMaterial({ color: '#575a5e', roughness: 1 });
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        const uv = [];
        for (let i = 0; i < positions.length / 3; i++)
            uv.push(texel ? texel.getX(0) : 0, texel ? texel.getY(0) : 0);
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geometry.setIndex(indices);
        const rim = new THREE.Mesh(geometry, material);
        rim.name = 'career rim';
        rim.castShadow = plate?.castShadow ?? true;
        rim.receiveShadow = plate?.receiveShadow ?? true;
        const floorGeometry = new THREE.BufferGeometry();
        floorGeometry.setAttribute('position', new THREE.Float32BufferAttribute(floorPositions, 3));
        floorGeometry.setAttribute('color', new THREE.Float32BufferAttribute(floorColours, 3));
        floorGeometry.setIndex(floorIndices);
        const floor = new THREE.Mesh(floorGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
        floor.name = 'career floor';
        this.group.add(rim, floor);
        this.track = { rim, floor };
    }
    keepYearLane(plate, plans) {
        const year = this.lanes.year;
        if (year === undefined) {
            this.references.suppress('Plane.049');
            return;
        }
        const edge = (year + (plans[0]?.x ?? year + 2)) / 2;
        plate.updateWorldMatrix(true, false);
        const geometry = plate.geometry;
        const position = geometry.getAttribute('position');
        const index = geometry.index;
        const count = index ? index.count : position.count;
        const point = new THREE.Vector3();
        const keep = [];
        for (let i = 0; i + 2 < count; i += 3) {
            let inside = true;
            for (let k = 0; k < 3; k++) {
                point.fromBufferAttribute(position, index ? index.getX(i + k) : i + k).applyMatrix4(plate.matrixWorld);
                if (point.x >= edge)
                    inside = false;
            }
            if (inside)
                for (let k = 0; k < 3; k++)
                    keep.push(index ? index.getX(i + k) : i + k);
        }
        if (!keep.length) {
            this.references.suppress('Plane.049');
            return;
        }
        geometry.setIndex(keep);
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
    }
    retireColliders() {
        const physics = this.game.physics;
        if (!physics?.physicals || typeof physics.remove !== 'function')
            return;
        const owners = new Set();
        const collect = (node) => node?.traverse(child => {
            if (child instanceof THREE.Mesh)
                owners.add(String(child.userData.w2Source ?? child.name));
        });
        for (const name of REPLACED)
            collect(this.references.node(name));
        for (const stone of this.references.series('stone'))
            collect(stone);
        for (const child of this.references.node('refYear')?.children ?? []) {
            if (String(child.userData.w2Source ?? child.name).startsWith('digit'))
                collect(child);
        }
        for (const physical of [...physics.physicals]) {
            if (typeof physical.owner === 'string' && owners.has(physical.owner))
                physics.remove(physical);
        }
    }
    buildLines() {
        const plans = this.plan();
        this.buildTrack(plans);
        const source = this.references.node('stone');
        if (!source)
            return;
        source.updateWorldMatrix(true, true);
        const stoneY = source.getWorldPosition(new THREE.Vector3()).y;
        for (const node of this.references.series('refLine'))
            this.references.environment.suppress(node);
        const frame = this.references.interactions.careerText[0];
        const fallback = frame ? new THREE.Quaternion(...frame.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)) : null;
        this.stoneTop = Math.max(0.3, Math.min(2, new THREE.Box3().setFromObject(source).max.y - stoneY));
        let index = 0;
        for (const { track, x, stops } of plans) {
            for (const stop of track.stops) {
                const { head, span } = stops.find(placed => placed.id === stop.id);
                const stone = source.clone();
                stone.traverse(node => { node.visible = true; node.castShadow = true; node.receiveShadow = true; });
                const home = new THREE.Vector3(x, stoneY, head);
                stone.position.copy(home);
                stone.quaternion.identity();
                stone.scale.copy(source.getWorldScale(new THREE.Vector3()));
                tintStone(stone, track.colour);
                this.group.add(stone);
                const pivot = new THREE.Group();
                pivot.name = `career label / ${stop.id}`;
                const pivotHome = new THREE.Vector3(x, stoneY + this.stoneTop + (LANE_LIFT[track.id] ?? 0.9), head);
                pivot.position.copy(pivotHome);
                if (fallback)
                    pivot.quaternion.copy(fallback);
                pivot.visible = false;
                this.group.add(pivot);
                const billboard = Billboards.for(this.game.ticker).add(pivot, {
                    mode: 'spherical', moves: true, radius: 250,
                    scale: { ...PLAQUE_SCALE, compensateParent: true },
                });
                this.bin.add(billboard.remove);
                if (!this.warm)
                    this.warmUp(pivot);
                this.lines.push({
                    stop, track, origin: home.clone(), span,
                    stone, stoneHome: home.clone(),
                    pivot, pivotHome, billboard, sign: null, label: null, width: 0, fit: 1, shiftX: 0, shiftY: 0, lastDx: NaN, lastDy: NaN, type: null, placed: false, near: false, wants: false, crowded: false, held: 0, revivedAt: -Infinity, pending: 0, pendingDx: 0, pendingDy: 0, relocating: false, crossing: 0, wiped: 0, latched: false, wary: false, latchSig: null,
                    hasEnd: stop.end < CAREER_LAST_MONTH,
                    isIn: false, isUp: false, reveal: 0, elevation: 0, slide: 0, index,
                });
                this.slots.push({ line: this.lines[this.lines.length - 1], x0: 0, y0: 0, x1: 0, y1: 0, dx: 0, dy: 0, pdx: NaN, pdy: NaN, kx: 1, ky: 1, ax: 0, ay: 0, reach: 0, rank: 0, out: false, trial: false, ask: false, fits: false, revive: false, holdFrom: NaN, holdFromY: NaN });
                index++;
            }
        }
    }
    plaqueKit() {
        if (!this.kit) {
            const materials = signMaterials(this.references.environment.group);
            const runtime = new SignRuntime({ ticker: this.game.ticker, camera: () => this.game.view?.camera }, this.bin);
            this.kit = { materials, runtime };
        }
        return this.kit;
    }
    plaqueMaterial(map, width) {
        return new THREE.ShaderMaterial({
            uniforms: { map: { value: map }, reveal: { value: 0 }, uPlate: this.plateRect, uCar: this.carRect, uInvWidth: { value: 1 / width } },
            vertexShader: PLAQUE_VERTEX, fragmentShader: PLAQUE_FRAGMENT,
            transparent: true, depthTest: false, depthWrite: false,
        });
    }
    warmUp(parent) {
        const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Array(9).fill(0), 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(6).fill(0), 2));
        const mesh = new THREE.Mesh(geometry, this.plaqueMaterial(texture, 1));
        mesh.name = 'career label / shader warm-up';
        mesh.visible = false;
        mesh.frustumCulled = false;
        parent.add(mesh);
        this.warm = mesh;
    }
    buildPlaque(line, now = false) {
        if (line.sign || this.disposed)
            return;
        const kit = this.plaqueKit();
        const { stop, track } = line;
        const width = plaqueWidth(stop);
        const materials = {
            wood: kit.materials.wood, owned: false, dispose() { },
            face: map => this.plaqueMaterial(map, width),
        };
        const sign = new Sign({
            id: `career-${stop.id}`, variant: 'label', width, height: PLAQUE_HEIGHT, dpm: LABEL_DPM,
            materials, runtime: kit.runtime, bin: this.bin,
            paint: (context, rect, tools) => {
                line.type = paintPlaque(context, rect, tools.fonts.sans, stop, track);
                this.subMin = Math.min(this.subMin, line.type.sub / LABEL_DPM);
            },
        });
        delete sign.group.userData.sign;
        sign.group.userData.signMount = 'billboard';
        sign.group.position.set(PLAQUE_GAP + width / 2, 0, 0);
        sign.group.traverse(node => { node.userData.proceduralDerived = true; });
        this.keepOffTheMap(line.pivot);
        this.keepOffTheMap(sign.group);
        const mesh = sign.face;
        mesh.renderOrder = PLAQUE_ORDER + (track.id === 'work' ? 1 : track.id === 'projects' ? 2 : 0);
        if (sign.main)
            sign.main.texture.anisotropy = LABEL_ANISOTROPY;
        this.bin.add(() => mesh.material.dispose());
        line.pivot.add(sign.group);
        line.sign = sign;
        line.label = mesh;
        line.width = width;
        if (now)
            sign.paintNow();
    }
    keepOffTheMap(node) {
        const camera = this.game.view?.camera;
        if (camera?.layers.isEnabled(MAP_HIDDEN_LAYER))
            node.traverse(child => { child.layers.set(MAP_HIDDEN_LAYER); });
    }
    buildNext(player) {
        let next = null;
        let nearest = Infinity;
        for (const line of this.lines) {
            if (line.sign)
                continue;
            const dx = line.origin.x - player.x, dz = line.origin.z - player.z;
            const distance = dx * dx + dz * dz;
            if (distance < nearest) {
                nearest = distance;
                next = line;
            }
        }
        if (next)
            this.buildPlaque(next);
    }
    buildYear() {
        const group = this.references.node('refYear');
        if (!group)
            return;
        this.yearGroup = group;
        this.yearHomeZ = group.position.z;
        const housing = this.references.node('Plane.030');
        if (housing instanceof THREE.Mesh) {
            housing.updateMatrix();
            housing.geometry.computeBoundingBox();
            const box = housing.geometry.boundingBox.clone().applyMatrix4(housing.matrix);
            this.plateReach = { left: Math.max(0, -box.min.x), right: Math.max(0, box.max.x), far: Math.max(0, -box.min.z), near: Math.max(0, box.max.z) };
            this.housing = housing;
            this.housingBox = housing.geometry.boundingBox.clone();
        }
        const lane = this.references.node('Plane.048');
        if (lane instanceof THREE.Mesh) {
            this.readout = new THREE.MeshBasicMaterial({ color: READOUT, toneMapped: false });
            lane.material = this.readout;
        }
        const digits = group.children
            .filter(child => String(child.userData.w2Source ?? child.name).startsWith('digit'))
            .filter((child) => child instanceof THREE.Mesh)
            .sort((a, b) => a.getWorldPosition(new THREE.Vector3()).x - b.getWorldPosition(new THREE.Vector3()).x);
        for (const mesh of digits) {
            const geometry = mesh.geometry.clone();
            const uv1 = geometry.getAttribute('uv1');
            if (!uv1)
                continue;
            const segment = new Float32Array(uv1.count);
            for (let i = 0; i < uv1.count; i++)
                segment[i] = Math.floor(Math.min(0.999, Math.max(0, uv1.getX(i))) * 7);
            geometry.setAttribute('segment', new THREE.BufferAttribute(segment, 1));
            mesh.geometry = geometry;
            const lift = new Float32Array(7);
            const material = new THREE.MeshBasicMaterial({ color: READOUT, toneMapped: false });
            material.onBeforeCompile = shader => {
                shader.uniforms.uLift = { value: lift };
                shader.vertexShader = shader.vertexShader
                    .replace('#include <common>', `
            #include <common>
            attribute float segment;
            uniform float uLift[7];
            varying float vLift;
          `)
                    .replace('#include <begin_vertex>', `
            #include <begin_vertex>
            vLift = uLift[int(segment + 0.5)];
            transformed.y += vLift * ${SEGMENT_RISE.toFixed(3)};
          `)
                    .replace('#include <project_vertex>', READOUT_ON_TOP ? `
            #include <project_vertex>
            if (projectionMatrix[2][3] < -0.5) {
              float ray = length(mvPosition.xyz);
              mvPosition.xyz *= max(ray - ${READOUT_LIFT.toFixed(2)}, 0.5) / ray;
              gl_Position = projectionMatrix * mvPosition;
            }
          ` : '#include <project_vertex>');
                shader.fragmentShader = shader.fragmentShader
                    .replace('#include <common>', `
            #include <common>
            varying float vLift;
          `)
                    .replace('#include <color_fragment>', `
            #include <color_fragment>
            if (vLift < 0.03) discard;
            diffuseColor.rgb *= 0.55 + 0.45 * smoothstep(0.03, 1.0, vLift);
          `);
            };
            mesh.material = material;
            if (READOUT_ON_TOP) {
                material.transparent = true;
                material.depthWrite = false;
                mesh.renderOrder = 10;
            }
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            this.digits.push({ mesh, material, lift, goal: new Float32Array(7), mask: 0, moving: false });
        }
        this.writeYear(this.current, true);
    }
    writeYear(value, instant = false) {
        if (!this.digits.length)
            return;
        const text = String(Math.max(0, value)).padStart(this.digits.length, '0').slice(-this.digits.length);
        this.digits.forEach((digit, index) => {
            digit.mask = SEGMENTS[Number(text[index])] ?? 0;
            for (let bar = 0; bar < 7; bar++) {
                digit.goal[bar] = (digit.mask >> bar) & 1;
                if (instant)
                    digit.lift[bar] = digit.goal[bar];
            }
            digit.moving = !instant;
        });
    }
    raiseBars(delta) {
        const rate = this.still ? 1 : Math.min(1, delta * BAR_RATE);
        for (const digit of this.digits) {
            if (!digit.moving)
                continue;
            let moving = false;
            for (let bar = 0; bar < 7; bar++) {
                const gap = digit.goal[bar] - digit.lift[bar];
                if (gap === 0)
                    continue;
                if (Math.abs(gap) < 0.004)
                    digit.lift[bar] = digit.goal[bar];
                else {
                    digit.lift[bar] += gap * rate;
                    moving = true;
                }
            }
            digit.moving = moving;
        }
    }
    facePlate(delta, camera) {
        const group = this.yearGroup;
        if (!group?.parent || !camera)
            return;
        camera.getWorldDirection(this.aim);
        group.parent.getWorldQuaternion(this.turn).invert();
        this.aim.applyQuaternion(this.turn);
        if (this.aim.x * this.aim.x + this.aim.z * this.aim.z < 1e-4)
            return;
        const target = Math.atan2(-this.aim.x, -this.aim.z);
        if (!Number.isFinite(target))
            return;
        if (!this.faced || this.still) {
            group.rotation.y = target;
            this.faced = true;
            return;
        }
        const gap = Math.atan2(Math.sin(target - group.rotation.y), Math.cos(target - group.rotation.y));
        if (Math.abs(gap) > 1e-4)
            group.rotation.y += gap * Math.min(1, delta * PLATE_TURN);
    }
    canSpeak(line, player, camera) {
        const lateral = Math.abs(player.x - line.origin.x);
        if (camera?.isPerspectiveCamera !== true)
            return lateral <= REVEAL_RADIUS + (line.wants ? REVEAL_HOLD : 0);
        const e = camera.matrixWorldInverse.elements, p = camera.projectionMatrix.elements;
        if (!(p[0] > 0 && p[5] > 0) || !Number.isFinite(e[0] + e[12]))
            return line.wants;
        this.group.updateWorldMatrix(true, false);
        const along = Math.min(line.origin.z, Math.max(line.origin.z - line.span, player.z));
        const at = this.where.set(line.pivotHome.x, line.pivotHome.y + ELEVATION, along).applyMatrix4(this.group.matrixWorld);
        const depth = -(e[2] * at.x + e[6] * at.y + e[10] * at.z + e[14]);
        if (!(depth > 0.01))
            return false;
        const ax = (p[0] * (e[0] * at.x + e[4] * at.y + e[8] * at.z + e[12])) / depth;
        const ay = (p[5] * (e[1] * at.x + e[5] * at.y + e[9] * at.z + e[13])) / depth;
        return plaqueReach(line.wants, lateral, ax, ay, depth);
    }
    layoutPlaques(camera, delta, design) {
        const shown = this.shown;
        shown.length = 0;
        this.clock += delta;
        const perspective = camera?.isPerspectiveCamera === true ? camera : null;
        const usable = perspective !== null && perspective.projectionMatrix.elements[0] > 0 && perspective.projectionMatrix.elements[5] > 0 && Number.isFinite(perspective.matrixWorldInverse.elements[0] + perspective.matrixWorldInverse.elements[12]);
        const e = usable ? perspective.matrixWorldInverse.elements : null;
        const p = usable ? perspective.projectionMatrix.elements : null;
        if (e)
            this.group.updateWorldMatrix(true, false);
        const hud = this.hud;
        let carDepth = REFERENCE_DEPTH;
        const car = e ? this.game.player?.position : null;
        if (e && car) {
            const at = this.where.set(car.x, car.y, car.z).applyMatrix4(this.group.matrixWorld);
            const d = -(e[2] * at.x + e[6] * at.y + e[10] * at.z + e[14]);
            if (d > 0.5)
                carDepth = d;
        }
        let measured = false;
        let reach = 0;
        for (let i = 0; i < this.slots.length; i++) {
            const slot = this.slots[i];
            const line = slot.line;
            slot.dx = slot.dy = 0;
            slot.pdx = slot.pdy = NaN;
            slot.out = false;
            slot.revive = false;
            slot.ask = false;
            const trial = line.wants && line.crowded;
            slot.trial = trial;
            if (!line.label || (!line.pivot.visible && !trial)) {
                line.shiftX = line.shiftY = 0;
                line.fit = 1;
                if (line.placed)
                    this.stand(line);
                line.placed = false;
                line.lastDx = line.lastDy = NaN;
                line.pending = 0;
                line.relocating = false;
                line.crossing = 0;
                continue;
            }
            if (!e || !p) {
                if (trial) {
                    line.crowded = false;
                    line.latched = false;
                    line.relocating = false;
                }
                continue;
            }
            if (!measured) {
                hud.measure();
                measured = true;
                reach = (2 * GAP_SHARE * Math.min(hud.width, hud.height)) / Math.max(1, hud.height);
            }
            const at = this.where.copy(line.pivot.position).applyMatrix4(this.group.matrixWorld);
            const cx = e[0] * at.x + e[4] * at.y + e[8] * at.z + e[12];
            const cy = e[1] * at.x + e[5] * at.y + e[9] * at.z + e[13];
            const cz = e[2] * at.x + e[6] * at.y + e[10] * at.z + e[14];
            const depth = -cz;
            if (depth < 0.5) {
                line.fit = plaqueFit(Infinity, 0, carDepth);
                this.stand(line);
                continue;
            }
            const dist = Math.sqrt(cx * cx + cy * cy + cz * cz);
            let k = dist / PLAQUE_SCALE.ref;
            k = k < PLAQUE_SCALE.min ? PLAQUE_SCALE.min : k > PLAQUE_SCALE.max ? PLAQUE_SCALE.max : k;
            const subPx = (this.subMin * k * hud.height * 0.5 * p[5]) / depth;
            const share = (line.width * p[0] * k) / (2 * depth);
            const fit = Math.min(plaqueFit(subPx, depth, carDepth, share), plaqueCap(this.subMin, hud.height, p[5], depth, dist, carDepth, design, share));
            line.fit = fit;
            slot.kx = (p[0] * k) / depth;
            slot.ky = (p[5] * k) / depth;
            const bx = (p[0] * cx) / depth, by = (p[5] * cy) / depth;
            slot.x0 = bx + slot.kx * PLAQUE_GAP;
            slot.x1 = slot.x0 + slot.kx * line.width * fit;
            slot.y0 = by - (slot.ky * PLAQUE_HEIGHT * fit) / 2;
            slot.y1 = by + (slot.ky * PLAQUE_HEIGHT * fit) / 2;
            if (line.wants) {
                if (!trial) {
                    slot.pdx = line.lastDx;
                    slot.pdy = line.lastDy;
                }
                slot.ax = bx;
                slot.ay = by;
                const lateral = car ? Math.min(LANE_SPREAD, Math.abs(car.x - line.origin.x)) : 0;
                const hide = HIDE_SHARE + HIDE_NEAR * (1 - lateral / LANE_SPREAD);
                const area = (slot.x1 - slot.x0) * (slot.y1 - slot.y0);
                slot.reach = trial ? reach * GAP_ENTER : reach;
                slot.rank = plaquePrice(area, (trial ? 0 : HIDE_KEPT) + hide);
                slot.fits = false;
                shown.push(slot);
            }
            else
                this.stand(line);
        }
        if (measured && e && p)
            this.clearCar(e, p);
        if (!shown.length)
            return;
        const safe = this.safe;
        safe.aspect = hud.width / hud.height;
        safe.top = hud.top > 0 ? Math.max(0.1, Math.min(0.95, 1 - ((hud.top + BAR_CLEAR_PX) / hud.height) * 2)) : SAFE.top;
        const plate = this.plateRect.value;
        this.keepPlate.x0 = plate.x;
        this.keepPlate.y0 = plate.y;
        this.keepPlate.x1 = plate.z;
        this.keepPlate.y1 = plate.w;
        this.ask(shown, safe);
        let kept = 0;
        for (let i = 0; i < shown.length; i++) {
            const slot = shown[i], line = slot.line;
            if (line.latched) {
                if (this.changed(line))
                    line.latched = false;
                else {
                    line.held = 0;
                    this.stand(line);
                    continue;
                }
            }
            shown[kept++] = slot;
        }
        shown.length = kept;
        if (!kept)
            return;
        this.solve(safe, true);
        this.recover(shown, safe);
        this.rescue(shown, safe);
        this.settle(shown, safe, delta);
        let trying = 0;
        for (let i = 0; i < shown.length; i++)
            if (shown[i].trial)
                trying++;
        if (trying)
            this.admit(shown, safe, delta);
        const slide = this.still ? 1 : Math.min(1, delta * SLIDE_RATE);
        for (let i = 0; i < shown.length; i++) {
            const slot = shown[i];
            const line = slot.line;
            if (slot.revive) {
                line.crowded = false;
                line.relocating = false;
                line.held = 0;
                line.revivedAt = this.clock;
                line.lastDx = slot.dx;
                line.lastDy = slot.dy;
                line.pending = 0;
                if (line.reveal < REVIVE_SNAP)
                    line.placed = false;
                this.stand(line);
                continue;
            }
            if (slot.trial) {
                if (slot.fits)
                    line.held += delta;
                else
                    line.held = 0;
                this.stand(line);
                continue;
            }
            if (slot.out) {
                line.relocating = false;
                if (line.placed)
                    line.held += delta;
                else
                    line.held = GIVE_UP_AFTER;
                if (line.held >= GIVE_UP_AFTER) {
                    if (this.clock - line.revivedAt < LATCH_WINDOW) {
                        this.latch(line);
                        if (!this.settling())
                            line.wary = true;
                    }
                    line.crowded = true;
                    line.held = 0;
                }
                else if (line.placed)
                    this.within(slot, safe, delta);
                this.stand(line);
                continue;
            }
            line.held = 0;
            if (line.wary && this.clock - line.revivedAt >= WARY_RESET)
                line.wary = false;
            if (line.relocating) {
                line.lastDx = slot.dx;
                line.lastDy = slot.dy;
                line.pending = 0;
                if (this.home(slot)) {
                    line.relocating = false;
                    line.crossing = 0;
                    this.stand(line);
                    continue;
                }
                if (line.reveal >= RELOCATE_HIDDEN) {
                    this.stand(line);
                    continue;
                }
                line.relocating = false;
                line.crossing = 0;
                line.placed = false;
                this.stand(line);
                continue;
            }
            else if (line.placed && !this.still && this.crosses(slot, line.shiftX * slot.kx, line.shiftY * slot.ky, slot.dx, slot.dy)) {
                line.lastDx = slot.dx;
                line.lastDy = slot.dy;
                line.pending = 0;
                line.crossing += delta;
                const cx = line.shiftX * slot.kx, cy = line.shiftY * slot.ky;
                if (line.crossing >= (this.stands(slot, cx, cy, STANDS_MIN) || this.beyond(slot, cx, cy, this.safe, this.safe.aspect ?? 1) ? CROSS_ON : CROSS_AFTER)) {
                    if (line.reveal < RELOCATE_FAINT) {
                        line.placed = false;
                        line.crossing = 0;
                    }
                    else
                        line.relocating = true;
                }
                this.stand(line);
                continue;
            }
            line.crossing = 0;
            const was = line.placed;
            line.placed = true;
            line.lastDx = slot.dx;
            line.lastDy = slot.dy;
            let sx = (slot.dx / slot.kx - line.shiftX) * (was ? slide : 1);
            let sy = (slot.dy / slot.ky - line.shiftY) * (was ? slide : 1);
            if (was && !this.still && !this.astray(slot) && !this.stands(slot, line.shiftX * slot.kx, line.shiftY * slot.ky, STANDS_MIN)) {
                const px = sx * slot.kx * 0.5 * hud.width, py = sy * slot.ky * 0.5 * hud.height;
                const length = Math.sqrt(px * px + py * py), most = SLIDE_MAX_PX * delta;
                if (length > most) {
                    const shrink = most / length;
                    sx *= shrink;
                    sy *= shrink;
                }
            }
            line.shiftX += sx;
            line.shiftY += sy;
            this.stand(line);
        }
    }
    solve(safe, speakers, keeping = true) {
        const shown = this.shown, work = this.work;
        let n = 0;
        for (let i = 0; i < shown.length; i++) {
            const slot = shown[i];
            if (slot.trial ? slot.ask : speakers)
                work[n++] = slot;
        }
        settlePlaques(work, safe, speakers ? this.keepOuts : this.keepPinned, n, keeping);
    }
    settle(shown, safe, delta) {
        const aspect = safe.aspect ?? 1;
        let held = 0;
        for (let i = 0; i < shown.length; i++) {
            const slot = shown[i], line = slot.line;
            slot.holdFrom = NaN;
            if (slot.trial || slot.out || line.relocating || !(line.lastDx === line.lastDx && line.lastDy === line.lastDy)) {
                line.pending = 0;
                continue;
            }
            const mx = (slot.dx - line.lastDx) * aspect, my = slot.dy - line.lastDy;
            if (mx * mx + my * my <= SETTLE_FAR * SETTLE_FAR || this.stands(slot, line.lastDx, line.lastDy) || this.beyond(slot, line.lastDx, line.lastDy, safe, aspect)) {
                line.pending = 0;
                continue;
            }
            const ax = (slot.dx - line.pendingDx) * aspect, ay = slot.dy - line.pendingDy;
            if (!(line.pending > 0) || ax * ax + ay * ay > SETTLE_SAME * SETTLE_SAME) {
                line.pending = delta;
                line.pendingDx = slot.dx;
                line.pendingDy = slot.dy;
            }
            else
                line.pending += delta;
            if (line.pending >= SETTLE_AFTER) {
                if (!line.placed || !this.crosses(slot, line.shiftX * slot.kx, line.shiftY * slot.ky, slot.dx, slot.dy)) {
                    line.pending = 0;
                    continue;
                }
                line.pending = SETTLE_AFTER;
            }
            slot.holdFrom = slot.dx;
            slot.holdFromY = slot.dy;
            slot.dx = line.lastDx;
            slot.dy = line.lastDy;
            held++;
        }
        if (!held)
            return;
        for (let i = 0; i < shown.length; i++) {
            const slot = shown[i];
            if (!(slot.holdFrom === slot.holdFrom))
                continue;
            for (let j = 0; j < shown.length; j++) {
                const other = shown[j];
                if (j === i || other.trial || other.out)
                    continue;
                if (Math.min(slot.x1 + slot.dx, other.x1 + other.dx) - Math.max(slot.x0 + slot.dx, other.x0 + other.dx) > ASTRAY && Math.min(slot.y1 + slot.dy, other.y1 + other.dy) - Math.max(slot.y0 + slot.dy, other.y0 + other.dy) > ASTRAY) {
                    slot.dx = slot.holdFrom;
                    slot.dy = slot.holdFromY;
                    slot.holdFrom = NaN;
                    slot.line.pending = 0;
                    break;
                }
            }
        }
    }
    beyond(slot, dx, dy, safe, aspect) {
        if (slot.x0 + dx < -safe.x - ASTRAY || slot.x1 + dx > safe.x + ASTRAY || slot.y0 + dy < -safe.bottom - ASTRAY || slot.y1 + dy > safe.top + ASTRAY)
            return true;
        if (!(slot.reach > 0))
            return false;
        const gx = Math.max(slot.x0 + dx - slot.ax, slot.ax - (slot.x1 + dx), 0) * aspect;
        const gy = Math.max(slot.y0 + dy - slot.ay, slot.ay - (slot.y1 + dy), 0);
        return gx * gx + gy * gy > slot.reach * slot.reach;
    }
    recover(shown, safe) {
        if (this.slots.length > 32)
            return;
        let any = false;
        for (let i = 0; i < shown.length; i++) {
            const slot = shown[i];
            if (!slot.trial && slot.out && slot.pdx === slot.pdx) {
                any = true;
                break;
            }
        }
        if (!any)
            return;
        for (let i = 0; i < shown.length; i++) {
            const slot = shown[i], k = slot.line.index;
            this.spare[4 * k] = slot.dx;
            this.spare[4 * k + 1] = slot.dy;
            this.spare[4 * k + 2] = slot.pdx;
            this.spare[4 * k + 3] = slot.pdy;
            this.spareOut[k] = slot.out ? 1 : 0;
            if (!slot.trial && slot.out) {
                slot.pdx = NaN;
                slot.pdy = NaN;
            }
        }
        this.solve(safe, true);
        let better = false, worse = false;
        for (let i = 0; i < shown.length; i++) {
            const slot = shown[i];
            if (slot.trial)
                continue;
            const was = this.spareOut[slot.line.index] === 1;
            if (was && !slot.out)
                better = true;
            else if (!was && slot.out)
                worse = true;
        }
        if (better && !worse)
            return;
        for (let i = 0; i < shown.length; i++) {
            const slot = shown[i], k = slot.line.index;
            slot.dx = this.spare[4 * k];
            slot.dy = this.spare[4 * k + 1];
            slot.pdx = this.spare[4 * k + 2];
            slot.pdy = this.spare[4 * k + 3];
            slot.out = this.spareOut[k] === 1;
        }
    }
    rescue(shown, safe) {
        if (this.slots.length > 32)
            return;
        let out = 0, waiting = false;
        for (let i = 0; i < shown.length; i++) {
            const slot = shown[i], k = slot.line.index;
            this.answer[2 * k] = slot.dx;
            this.answer[2 * k + 1] = slot.dy;
            this.answerOut[k] = slot.out ? 1 : 0;
            if (!slot.trial && slot.out) {
                out++;
                if (slot.line.held >= RESCUE_AFTER)
                    waiting = true;
            }
        }
        if (!out)
            return;
        this.solve(safe, true, false);
        let then = 0, most = 0;
        const aspect = safe.aspect ?? 1;
        for (let i = 0; i < shown.length; i++) {
            const slot = shown[i], k = slot.line.index;
            if (slot.trial)
                continue;
            if (slot.out)
                then++;
            else if (this.answerOut[k] === 0 && !this.settling()) {
                const mx = (slot.dx - this.answer[2 * k]) * aspect, my = slot.dy - this.answer[2 * k + 1];
                most = Math.max(most, Math.sqrt(mx * mx + my * my));
            }
        }
        if (then < out && (most <= RESCUE_MOVE || waiting) && this.calm(shown))
            return;
        for (let i = 0; i < shown.length; i++) {
            const slot = shown[i], k = slot.line.index;
            slot.dx = this.answer[2 * k];
            slot.dy = this.answer[2 * k + 1];
            slot.out = this.answerOut[k] === 1;
        }
    }
    admit(shown, safe, delta) {
        if (this.slots.length > 32)
            return;
        for (let i = 0; i < shown.length; i++) {
            const slot = shown[i], k = slot.line.index;
            this.answer[2 * k] = slot.dx;
            this.answer[2 * k + 1] = slot.dy;
            this.answerOut[k] = slot.out ? 1 : 0;
            slot.ask = slot.trial;
            slot.fits = false;
        }
        this.pin(shown);
        this.solve(safe, false);
        let due = 0, spare = 0, left = 0;
        for (let i = 0; i < shown.length; i++) {
            const slot = shown[i];
            if (!slot.trial)
                continue;
            slot.fits = !slot.out;
            slot.revive = slot.fits && slot.line.held + delta >= (slot.line.wary ? REVIVE_WARY : REVIVE_AFTER);
            if (slot.revive)
                due++;
            else if (slot.fits)
                spare++;
            else
                left++;
        }
        if (due && spare) {
            for (let i = 0; i < shown.length; i++)
                shown[i].ask = shown[i].trial && shown[i].revive;
            this.solve(safe, false);
            for (let i = 0; i < shown.length; i++) {
                const slot = shown[i];
                if (!slot.revive || !slot.out)
                    continue;
                slot.revive = false;
                slot.fits = false;
                this.latch(slot.line);
                due--;
            }
        }
        this.unpin();
        if (!due && left)
            this.displace(shown, safe, delta);
    }
    displace(shown, safe, delta) {
        for (let i = 0; i < shown.length; i++)
            shown[i].ask = shown[i].trial && !shown[i].fits;
        this.solve(safe, true, false);
        let kept = this.keptAll(shown) && this.calm(shown);
        let seen = false;
        for (let i = 0; i < shown.length; i++)
            if (!shown[i].trial && !shown[i].out && !this.settling()) {
                seen = true;
                break;
            }
        let due = 0, spare = 0;
        for (let i = 0; i < shown.length; i++) {
            const slot = shown[i];
            if (!slot.ask)
                continue;
            slot.fits = kept && !slot.out;
            slot.revive = slot.fits && slot.line.held + delta >= (slot.line.wary ? REVIVE_WARY : REVIVE_AFTER) + (seen ? SETTLE_AFTER : 0);
            if (slot.revive)
                due++;
            else if (!slot.out)
                spare++;
        }
        if (due && spare) {
            for (let i = 0; i < shown.length; i++)
                shown[i].ask = shown[i].ask && shown[i].revive;
            this.solve(safe, true, false);
            kept = this.keptAll(shown) && this.calm(shown);
        }
        let agreed = due > 0;
        for (let i = 0; i < shown.length; i++) {
            const slot = shown[i];
            if (slot.revive && (!kept || slot.out)) {
                agreed = false;
                this.answerOut[slot.line.index] |= 2;
            }
        }
        if (agreed)
            return;
        for (let i = 0; i < shown.length; i++) {
            const slot = shown[i], line = slot.line, k = line.index;
            slot.dx = this.answer[2 * k];
            slot.dy = this.answer[2 * k + 1];
            slot.out = (this.answerOut[k] & 1) === 1;
            if (!slot.revive)
                continue;
            slot.revive = false;
            if ((this.answerOut[k] & 2) !== 0)
                this.latch(line);
        }
    }
    pin(shown) {
        let n = 0;
        for (let i = 0; i < shown.length && n < this.pins.length; i++) {
            const slot = shown[i];
            if (slot.trial || slot.out)
                continue;
            const pin = this.pins[n++];
            pin.x0 = slot.x0 + slot.dx;
            pin.x1 = slot.x1 + slot.dx;
            pin.y0 = slot.y0 + slot.dy;
            pin.y1 = slot.y1 + slot.dy;
        }
    }
    unpin() {
        for (let i = 0; i < this.pins.length; i++) {
            const pin = this.pins[i];
            pin.x0 = pin.y0 = 2;
            pin.x1 = pin.y1 = -2;
        }
    }
    calm(shown) {
        for (let i = 0; i < shown.length; i++) {
            const slot = shown[i], line = slot.line;
            if (slot.trial || slot.out || !line.placed || line.relocating || this.settling() || this.answerOut[line.index] !== 0)
                continue;
            if (this.crosses(slot, line.shiftX * slot.kx, line.shiftY * slot.ky, slot.dx, slot.dy))
                return false;
        }
        return true;
    }
    keptAll(shown) {
        for (let i = 0; i < shown.length; i++) {
            const slot = shown[i];
            if (slot.trial)
                continue;
            const k = slot.line.index;
            if (this.answerOut[k] !== 0)
                continue;
            if (slot.out)
                return false;
            if (this.stands(slot, slot.dx, slot.dy) && !this.stands(slot, this.answer[2 * k], this.answer[2 * k + 1]))
                return false;
        }
        return true;
    }
    crosses(slot, cx, cy, tx, ty) {
        const keeps = this.keepOuts;
        const ddx = tx - cx, ddy = ty - cy;
        const length = Math.sqrt(ddx * ddx + ddy * ddy);
        if (length <= CROSS_LENGTH)
            return false;
        for (let i = 0; i < keeps.length; i++) {
            const o = keeps[i];
            const x0 = o.x0 - slot.x1 + ASTRAY, x1 = o.x1 - slot.x0 - ASTRAY, y0 = o.y0 - slot.y1 + ASTRAY, y1 = o.y1 - slot.y0 - ASTRAY;
            if (!(o.x0 < o.x1 && o.y0 < o.y1 && x0 < x1 && y0 < y1))
                continue;
            let near = 0, far = 1;
            if (ddx === 0) {
                if (cx <= x0 || cx >= x1)
                    continue;
            }
            else {
                let a = (x0 - cx) / ddx, b = (x1 - cx) / ddx;
                if (a > b) {
                    const t = a;
                    a = b;
                    b = t;
                }
                if (a > near)
                    near = a;
                if (b < far)
                    far = b;
            }
            if (ddy === 0) {
                if (cy <= y0 || cy >= y1)
                    continue;
            }
            else {
                let a = (y0 - cy) / ddy, b = (y1 - cy) / ddy;
                if (a > b) {
                    const t = a;
                    a = b;
                    b = t;
                }
                if (a > near)
                    near = a;
                if (b < far)
                    far = b;
            }
            if ((far - near) * length > CROSS_LENGTH)
                return true;
        }
        return false;
    }
    settling() {
        return this.clock - this.arrivedAt < SETTLING;
    }
    home(slot) {
        const line = slot.line;
        const dx = line.shiftX * slot.kx, dy = line.shiftY * slot.ky;
        const mx = (slot.dx - dx) * (this.safe.aspect ?? 1), my = slot.dy - dy;
        return mx * mx + my * my <= SETTLE_FAR * SETTLE_FAR && !this.stands(slot, dx, dy) && !this.astray(slot);
    }
    stands(slot, dx, dy, margin = ASTRAY) {
        const keeps = this.keepOuts;
        for (let i = 0; i < keeps.length; i++) {
            const o = keeps[i];
            if (!(o.x0 < o.x1 && o.y0 < o.y1))
                continue;
            if (Math.min(slot.x1 + dx, o.x1) - Math.max(slot.x0 + dx, o.x0) > margin && Math.min(slot.y1 + dy, o.y1) - Math.max(slot.y0 + dy, o.y0) > margin)
                return true;
        }
        return false;
    }
    ask(shown, safe) {
        const lines = this.slots.length;
        const need = lines * 6 + this.keepOuts.length * 4 + 3;
        if (this.asked.length !== need) {
            this.asked = new Float64Array(need);
            for (let i = 0; i < lines; i++)
                this.slots[i].line.latchSig = new Float64Array(need);
        }
        const a = this.asked;
        a.fill(0);
        for (let i = 0; i < shown.length; i++) {
            const slot = shown[i], o = slot.line.index * 6;
            a[o] = slot.x0;
            a[o + 1] = slot.y0;
            a[o + 2] = slot.x1;
            a[o + 3] = slot.y1;
            a[o + 4] = slot.ax;
            a[o + 5] = slot.ay;
        }
        let o = lines * 6;
        for (let i = 0; i < this.keepOuts.length; i++) {
            const keep = this.keepOuts[i];
            a[o++] = keep.x0;
            a[o++] = keep.y0;
            a[o++] = keep.x1;
            a[o++] = keep.y1;
        }
        a[o++] = safe.top;
        a[o++] = safe.x;
        a[o] = safe.aspect ?? 1;
    }
    latch(line) {
        line.latched = true;
        line.latchSig?.set(this.asked);
    }
    changed(line) {
        const then = line.latchSig, now = this.asked;
        if (!then || then.length !== now.length)
            return true;
        for (let i = 0; i < now.length; i++)
            if (Math.abs(now[i] - then[i]) > LATCH_EPS)
                return true;
        return false;
    }
    within(slot, safe, delta) {
        const line = slot.line;
        const dx = line.shiftX * slot.kx, dy = line.shiftY * slot.ky;
        const x0 = slot.x0 + dx, x1 = slot.x1 + dx, y0 = slot.y0 + dy, y1 = slot.y1 + dy;
        let mx = 0, my = 0;
        if (x1 > safe.x)
            mx = safe.x - x1;
        if (x0 + mx < -safe.x)
            mx = -safe.x - x0;
        if (y1 > safe.top)
            my = safe.top - y1;
        if (y0 + my < -safe.bottom)
            my = -safe.bottom - y0;
        if (!(mx === mx && my === my))
            return;
        const px = mx * 0.5 * this.hud.width, py = my * 0.5 * this.hud.height;
        const length = Math.sqrt(px * px + py * py), most = SLIDE_MAX_PX * delta;
        if (length > most) {
            const shrink = most / length;
            mx *= shrink;
            my *= shrink;
        }
        line.shiftX += mx / slot.kx;
        line.shiftY += my / slot.ky;
    }
    astray(slot) {
        const line = slot.line;
        const dx = line.shiftX * slot.kx, dy = line.shiftY * slot.ky;
        return slot.x0 + dx < -1 - ASTRAY || slot.x1 + dx > 1 + ASTRAY || slot.y0 + dy < -1 - ASTRAY || slot.y1 + dy > 1 + ASTRAY;
    }
    stand(line) {
        const group = line.sign.group;
        group.position.set(PLAQUE_GAP + (line.width * line.fit) / 2 + line.shiftX, line.shiftY, 0);
        group.scale.setScalar(line.fit);
    }
    clearCar(e, p) {
        const out = this.keepCar;
        out.x0 = out.y0 = 2;
        out.x1 = out.y1 = -2;
        this.carRect.value.set(2, 2, -2, -2);
        const car = this.game.player?.position;
        if (!car)
            return;
        const at = this.where.set(car.x, car.y, car.z).applyMatrix4(this.group.matrixWorld);
        const cx = e[0] * at.x + e[4] * at.y + e[8] * at.z + e[12];
        const cy = e[1] * at.x + e[5] * at.y + e[9] * at.z + e[13];
        const depth = -(e[2] * at.x + e[6] * at.y + e[10] * at.z + e[14]);
        if (depth < 0.5)
            return;
        const sine = Math.abs(e[6]), cosine = Math.abs(e[5]);
        const kx = p[0] / depth, ky = p[5] / depth;
        const flat = CAR_KEEP.radius * sine;
        out.x0 = cx * kx - CAR_KEEP.wide * kx - CAR_KEEP.pad;
        out.x1 = cx * kx + CAR_KEEP.wide * kx + CAR_KEEP.pad;
        out.y0 = cy * ky - (flat + CAR_KEEP.below * cosine) * ky - CAR_KEEP.pad;
        out.y1 = cy * ky + (flat + CAR_KEEP.above * cosine) * ky + CAR_KEEP.pad;
        this.carRect.value.set(out.x0 + CAR_KEEP.pad, out.y0 + CAR_KEEP.pad, out.x1 - CAR_KEEP.pad, out.y1 - CAR_KEEP.pad);
    }
    update() {
        if (!this.lines.length)
            return;
        const delta = this.game.ticker.delta * this.game.ticker.scale;
        const player = this.game.player.position;
        if (Math.hypot(player.x - this.centre.x, player.z - this.centre.z) > this.reach) {
            if (this.inReach) {
                this.inReach = false;
                for (const line of this.lines) {
                    line.reveal = 0;
                    line.pivot.visible = false;
                    line.placed = false;
                    line.lastDx = line.lastDy = NaN;
                    line.pending = 0;
                    line.near = false;
                    line.wants = false;
                    line.crowded = false;
                    line.held = 0;
                    line.latched = false;
                    line.wary = false;
                    line.relocating = false;
                    line.crossing = 0;
                }
            }
            return;
        }
        if (!this.inReach)
            this.arrivedAt = this.clock;
        this.inReach = true;
        this.buildNext(player);
        const view = this.game.view;
        const camera = view?.camera;
        const speaking = this.speaking;
        speaking.clear();
        for (const line of this.lines) {
            const along = line.origin.z - player.z;
            if (along <= -PADDING || along >= line.span + PADDING * 2)
                continue;
            const best = speaking.get(line.track.id);
            if (!best || line.span < best.span)
                speaking.set(line.track.id, line);
        }
        for (const line of this.lines) {
            const along = line.origin.z - player.z;
            const isIn = along > -PADDING && along < line.span + PADDING * 2;
            if (isIn !== line.isIn) {
                line.isIn = isIn;
                this.game.audio.play('note', isIn ? 1.2 + line.index * 0.1 : 0.6);
                if (isIn) {
                    this.visited.add(line.stop.id);
                    this.game.interactions?.achievements.mark('career', line.stop.id);
                }
            }
            if (line.isIn)
                line.isUp = true;
            else if (along > line.span) {
                if (line.hasEnd)
                    line.isUp = false;
            }
            else
                line.isUp = false;
            const was = line.wants;
            line.wants = line === speaking.get(line.track.id) && this.canSpeak(line, player, camera);
            if (!line.wants) {
                line.crowded = false;
                line.held = 0;
                line.latched = false;
                line.wary = false;
                line.relocating = false;
                line.crossing = 0;
            }
            else if (!was) {
                line.crowded = true;
                line.held = REVIVE_AFTER;
                line.latched = false;
                line.wary = false;
                line.relocating = false;
                line.crossing = 0;
            }
            line.near = line.wants && !line.crowded;
            const revealTarget = line.near && !line.relocating ? 1 : 0;
            if (line.wants && !line.sign)
                this.buildPlaque(line, true);
            line.wiped = line.relocating ? line.wiped + delta : 0;
            line.reveal += (revealTarget - line.reveal) * Math.min(1, delta * (line.relocating ? 3 + (RELOCATE_RATE - 3) * Math.min(1, line.wiped / RELOCATE_RAMP) : 3));
            if (line.label)
                line.label.material.uniforms.reveal.value = line.reveal;
            line.pivot.visible = line.label !== null && line.reveal > 0.01;
            const elevationTarget = line.isUp ? ELEVATION : 0;
            line.elevation += (elevationTarget - line.elevation) * Math.min(1, delta * 3);
            let slideTarget = line.slide;
            if (line.isIn) {
                if (line.elevation > 1)
                    slideTarget = -Math.max(0, Math.min(along, line.span));
            }
            else
                slideTarget = along > line.span ? -line.span : 0;
            line.slide += (slideTarget - line.slide) * Math.min(1, delta * 10);
            line.stone.position.set(line.stoneHome.x, line.stoneHome.y + line.elevation, line.stoneHome.z + line.slide);
            line.pivot.position.set(line.pivotHome.x, line.pivotHome.y + line.elevation, line.pivotHome.z + line.slide);
        }
        if (this.yearGroup) {
            const walk = Math.max(1, this.near - this.far);
            const along = Math.max(0, Math.min(this.near - player.z, walk));
            if (!this.grown) {
                this.homeScale.copy(this.yearGroup.scale);
                this.grown = true;
            }
            this.leading = this.placePlate(delta, player, camera);
            const raw = this.yearCareerZ - player.z + this.leading;
            this.dodging = this.stepAside(raw);
            const target = Math.max(this.dodging ? -DODGE_MAX : 0, Math.min(raw, walk + PLATE_OVERRUN));
            if (Number.isFinite(target)) {
                this.moveTo(target, delta);
                const base = this.yearCareerZ - player.z;
                if (FOLLOW_CLAMP && this.ready && !this.hopping && (this.dodging || raw >= 0) && Number.isFinite(base + this.lowest + this.highest)) {
                    this.yearOffset = Math.max(this.dodging ? -DODGE_MAX : 0, Math.min(this.yearOffset, base + this.highest, walk + PLATE_OVERRUN));
                    if (this.yearOffset < base + this.lowest)
                        this.yearOffset = Math.min(base + this.lowest, base + this.highest, walk + PLATE_OVERRUN);
                }
            }
            else if (!Number.isFinite(this.yearOffset))
                this.yearOffset = 0;
            const shown = this.pop * this.pop * (3 - 2 * this.pop);
            this.yearGroup.scale.copy(this.homeScale).multiplyScalar(this.size * Math.max(shown, 1e-3));
            this.yearGroup.visible = shown > 1e-3;
            this.yearGroup.position.z = this.yearHomeZ - this.yearOffset;
            const months = CAREER_LAST_MONTH - CAREER_FIRST_MONTH;
            const years = (CAREER_FIRST_MONTH + (along / walk) * months) / 12;
            const margin = (YEAR_HYSTERESIS / walk) * (months / 12);
            if (years >= this.current + 1 + margin || years < this.current - margin) {
                const value = Math.floor(years);
                if (value !== this.current) {
                    this.current = value;
                    this.writeYear(value);
                }
            }
            this.raiseBars(delta);
            this.facePlate(delta, camera);
            this.clearPlate(camera);
        }
        this.layoutPlaques(camera, delta, this.designDepth(view));
    }
    designDepth(view) {
        const overflow = view?.ratioOverflow;
        if (typeof overflow !== 'number')
            return REFERENCE_DEPTH;
        if (overflow === this.designFor)
            return this.designAt;
        const radius = view?.spherical?.radius;
        this.designFor = overflow;
        this.designAt = defaultDepth(radius?.edges?.min ?? NaN, radius?.edges?.max ?? NaN, radius?.nonIdealRatioOffset ?? NaN, overflow);
        return this.designAt;
    }
    placePlate(delta, player, camera) {
        const group = this.yearGroup;
        const ready = this.prepare(player, camera);
        this.ready = ready;
        if (ready) {
            const moving = Math.abs(this.carDepth - this.lastDepth) > CAMERA_MOVING;
            this.lastDepth = this.carDepth;
            if (!this.sized || moving || ++this.sinceFit >= FIT_EVERY) {
                this.hud.measure();
                this.fitted = this.fit();
                this.sinceFit = 0;
            }
            if (!this.sized) {
                this.size = this.fitted;
                this.sized = true;
            }
            else if (this.fitted < this.size)
                this.size = this.still ? this.fitted : this.size + (this.fitted - this.size) * Math.min(1, delta * PLATE_SHRINK);
            else
                this.size += (this.fitted - this.size) * Math.min(1, delta * PLATE_GROW);
        }
        group.scale.copy(this.homeScale).multiplyScalar(this.size);
        if (!ready)
            return PLATE_LEAD;
        this.limits(this.size, CAR_CLEAR);
        this.homeLead = player.z - this.yearCareerZ;
        if (!PLATE_SLOT)
            return Math.max(0, Math.min(this.highest, Math.max(PLATE_LEAD, this.lowest)));
        const lead = pickLead(this.slot, this.lowest, this.highest, PLATE_LEAD);
        return Number.isFinite(lead) ? Math.min(PLATE_LEAD_MAX, Math.max(-PLATE_BACK, lead)) : PLATE_LEAD;
    }
    stepAside(raw) {
        if (!(raw < 0) || !this.ready)
            return false;
        if (this.away)
            return false;
        return this.dodging ? !this.homeClear(DODGE_EXIT) : !this.homeClear(DODGE_ENTER);
    }
    homeClear(clear) {
        const right = this.right, above = this.above;
        right[0] = above[0] = -Infinity;
        right[1] = above[1] = Infinity;
        if (this.carDepth > 0.1) {
            const reach = this.plateReach, projection = this.projection, spot = this.spot, step = this.step;
            const scale = this.size * this.homeScale.x * this.worldScale;
            const p = this.point;
            p[BOUND.Z] = spot.z - this.deep * reach.near * scale;
            p[BOUND.DA] = step.x;
            p[BOUND.DZ] = step.z;
            p[BOUND.A] = spot.x - reach.left * scale;
            p[BOUND.SIGN] = -1;
            p[BOUND.PROJECTION] = projection[0];
            p[BOUND.LIMIT] = -carEdge(projection[0], this.car.x + clear, this.carDepth, CAR_NEAR, 1);
            leadBound(p, right);
            p[BOUND.A] = spot.y - this.up * reach.near * scale;
            p[BOUND.DA] = step.y;
            p[BOUND.SIGN] = -1;
            p[BOUND.PROJECTION] = projection[5];
            const top = this.car.y + CAR_KEEP.radius * this.up + CAR_KEEP.above * Math.abs(this.deep) + (clear - CAR_BODY) * DODGE_ABOVE;
            p[BOUND.LIMIT] = (-projection[5] * top) / this.carDepth;
            leadBound(p, above);
        }
        return homeFree(this.homeLead, this.slot, right, above);
    }
    moveTo(target, delta) {
        const jumped = this.offsetSet && (this.moved || Math.abs(target - this.lastTarget) > HOP + HOP_SPEED * delta);
        this.moved = false;
        this.lastTarget = target;
        if (!this.offsetSet || (jumped && this.still)) {
            this.yearOffset = target;
            this.offsetSet = true;
            this.hopping = false;
            this.pop = this.away ? 0 : 1;
            if (jumped)
                this.size = this.fitted;
            return;
        }
        if (jumped)
            this.hopping = true;
        if (this.hopping) {
            this.pop = Math.max(0, this.pop - delta * POP_OUT);
            if (this.pop > 0)
                return;
            this.yearOffset = target;
            this.size = this.fitted;
            this.hopping = false;
            return;
        }
        this.pop = Math.max(0, Math.min(1, this.pop + delta * (this.away ? -POP_OUT : POP_IN)));
        if (this.away) {
            if (this.pop <= 0) {
                this.yearOffset = target;
                this.size = this.fitted;
            }
            return;
        }
        this.yearOffset += (target - this.yearOffset) * Math.min(1, delta * 10);
    }
    prepare(player, camera) {
        const group = this.yearGroup, reach = this.plateReach;
        if (!group?.parent || !reach || !camera?.isPerspectiveCamera)
            return false;
        const projection = camera.projectionMatrix.elements;
        if (!(projection[0] > 0 && projection[5] > 0))
            return false;
        const world = group.parent.matrixWorld;
        const lens = camera.matrixWorld.elements;
        let gx = -lens[8], gz = -lens[10];
        const flat = Math.sqrt(gx * gx + gz * gz);
        if (!(flat > 1e-3))
            return false;
        gx /= flat;
        gz /= flat;
        this.up = gx * lens[4] + gz * lens[6];
        this.deep = gx * lens[8] + gz * lens[10];
        this.projection = projection;
        this.worldScale = world.getMaxScaleOnAxis();
        const z = player.z + (this.yearHomeZ - this.yearCareerZ);
        this.spot.set(group.position.x, group.position.y, z).applyMatrix4(world).applyMatrix4(camera.matrixWorldInverse);
        this.step.set(group.position.x, group.position.y, z - 1).applyMatrix4(world).applyMatrix4(camera.matrixWorldInverse).sub(this.spot);
        this.car.set(player.x + (group.position.x - (this.lanes.year ?? group.position.x)), group.position.y, z).applyMatrix4(world).applyMatrix4(camera.matrixWorldInverse);
        this.carDepth = -this.car.z;
        return Number.isFinite(this.spot.x + this.spot.y + this.spot.z + this.step.x + this.step.y + this.step.z + this.car.x + this.carDepth + this.up + this.deep);
    }
    limits(size, clear) {
        const reach = this.plateReach, projection = this.projection, spot = this.spot, step = this.step;
        const up = this.up, deep = this.deep;
        const scale = size * this.homeScale.x * this.worldScale;
        const p = this.point;
        this.lowest = PLATE_SLOT ? -PLATE_BACK : 0;
        this.highest = PLATE_LEAD_MAX;
        p[BOUND.Z] = spot.z - deep * reach.near * scale;
        p[BOUND.DA] = step.x;
        p[BOUND.DZ] = step.z;
        p[BOUND.A] = spot.x - reach.left * scale;
        p[BOUND.SIGN] = -1;
        p[BOUND.LIMIT] = SAFE_X;
        p[BOUND.PROJECTION] = projection[0];
        this.narrow();
        p[BOUND.A] = spot.x + reach.right * scale;
        p[BOUND.SIGN] = 1;
        this.narrow();
        const right = p[BOUND.A];
        p[BOUND.A] = spot.y + up * reach.far * scale;
        p[BOUND.DA] = step.y;
        p[BOUND.Z] = spot.z + deep * reach.far * scale;
        p[BOUND.SIGN] = 1;
        p[BOUND.LIMIT] = SAFE_TOP;
        p[BOUND.PROJECTION] = projection[5];
        this.narrow();
        p[BOUND.A] = spot.y - up * reach.near * scale;
        p[BOUND.Z] = spot.z - deep * reach.near * scale;
        p[BOUND.SIGN] = -1;
        p[BOUND.LIMIT] = SAFE_BOTTOM;
        this.narrow();
        const slot = this.slot;
        slot[0] = -Infinity;
        slot[1] = Infinity;
        if (!PLATE_SLOT)
            return this.lowest <= this.highest;
        if (this.carDepth > 0.1) {
            p[BOUND.Z] = spot.z - deep * reach.near * scale;
            p[BOUND.DA] = step.x;
            p[BOUND.DZ] = step.z;
            p[BOUND.A] = right;
            p[BOUND.SIGN] = 1;
            p[BOUND.PROJECTION] = projection[0];
            p[BOUND.LIMIT] = carEdge(projection[0], this.car.x - clear, this.carDepth, CAR_NEAR, -1);
            leadBound(p, slot);
        }
        return this.lowest <= this.highest && slot[1] >= this.lowest && slot[0] <= this.highest;
    }
    setFloor() {
        const reach = this.plateReach;
        const canvas = this.hud.width > 1 ? this.hud.width : PLATE_MIN_PX / PLATE_MIN_SHARE;
        const depth = this.carDepth > 0.1 ? this.carDepth : -this.spot.z;
        this.least = floorSize(plateFloorPx(canvas), canvas, depth, this.projection[0], (reach.left + reach.right) * this.homeScale.x * this.worldScale, PLATE_SCALE);
    }
    fit() {
        this.setFloor();
        const floor = this.least;
        const was = this.away;
        this.roomClear = CAR_BODY + (was ? MODE_HYST : 0);
        const size = fitSize(this.hasRoom, floor, PLATE_SCALE, FIT_STEPS);
        const fits = size > floor || this.hasRoom(floor);
        const away = !fits && PLATE_AWAY;
        if (away !== was) {
            this.away = away;
            this.moved = true;
        }
        return size;
    }
    clearPlate(camera) {
        const group = this.yearGroup, housing = this.housing, box = this.housingBox;
        const out = this.plateRect.value;
        if (!group?.parent || !housing || !box || !camera || this.pop < 0.02) {
            out.set(2, 2, -2, -2);
            return;
        }
        group.updateMatrix();
        this.clip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
            .multiply(group.parent.matrixWorld).multiply(group.matrix).multiply(housing.matrix);
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < 8; i++) {
            const corner = this.corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z, 1).applyMatrix4(this.clip);
            if (corner.w < 0.01) {
                out.set(2, 2, -2, -2);
                return;
            }
            const x = corner.x / corner.w, y = corner.y / corner.w;
            if (x < x0)
                x0 = x;
            if (x > x1)
                x1 = x;
            if (y < y0)
                y0 = y;
            if (y > y1)
                y1 = y;
        }
        if (!Number.isFinite(x0 + x1 + y0 + y1)) {
            out.set(2, 2, -2, -2);
            return;
        }
        out.set(x0 - HOLE_PAD, y0 - HOLE_PAD, x1 + HOLE_PAD, y1 + HOLE_PAD);
    }
    narrow() {
        const range = leadBound(this.point, this.range);
        this.lowest = Math.max(this.lowest, range[0]);
        this.highest = Math.min(this.highest, range[1]);
    }
    get year() { return this.current; }
    get plateLead() { return this.leading; }
    get plateSize() { return this.size; }
    get platePlace() { return this.away ? 'away' : 'left'; }
    get digitMasks() { return this.digits.map(digit => digit.mask); }
    get litSegments() { return this.digits.map(digit => Array.from(digit.lift, value => value > 0.5)); }
    get sockets() { return this.socketList; }
    get rim() { return this.track; }
    get plaqueHeight() { return PLAQUE_HEIGHT; }
    get plaques() { return this.lines.reduce((n, line) => n + (line.sign ? 1 : 0), 0); }
    get paintedYear() { return false; }
    get seen() { return this.visited.size; }
    get stops() { return CAREER.length; }
}
export const RIM = {
    SOCKET_OUTER: 0.3915, SOCKET_INNER: 0.2525,
    CHANNEL_OUTER: 0.170, CHANNEL_INNER: 0.0645,
    CAP: 0.139,
    TOP: 0.0912, FLOOR: 0.0414, FOOT: 0,
};
const round5 = (value) => Math.round(value * 1e5) / 1e5;
export function buildLaneRim(lane, spec = RIM) {
    const { x: xc, sockets, channels } = lane;
    const { SOCKET_OUTER, SOCKET_INNER, CHANNEL_OUTER, CHANNEL_INNER, CAP, TOP: T, FLOOR: FL, FOOT: B } = spec;
    const outer = (z) => {
        let half = 0;
        for (const [low, high] of channels)
            if (z >= low - CAP && z <= high)
                half = Math.max(half, CHANNEL_OUTER);
        for (const c of sockets)
            if (Math.abs(z - c) <= SOCKET_OUTER)
                half = Math.max(half, SOCKET_OUTER);
        return half;
    };
    const inner = (z) => {
        let half = 0;
        for (const [low, high] of channels)
            if (z >= low && z <= high)
                half = Math.max(half, CHANNEL_INNER);
        for (const c of sockets)
            if (Math.abs(z - c) <= SOCKET_INNER)
                half = Math.max(half, SOCKET_INNER);
        return half;
    };
    const marks = new Set();
    for (const c of sockets)
        for (const d of [SOCKET_OUTER, SOCKET_INNER]) {
            marks.add(round5(c - d));
            marks.add(round5(c + d));
        }
    for (const [low, high] of channels) {
        marks.add(round5(low - CAP));
        marks.add(round5(low));
        marks.add(round5(high));
    }
    const breaks = [...marks].sort((a, b) => a - b);
    const slabs = [];
    for (let i = 0; i + 1 < breaks.length; i++) {
        if (breaks[i + 1] - breaks[i] < 1e-6)
            continue;
        const middle = (breaks[i] + breaks[i + 1]) / 2;
        const slab = { z0: breaks[i], z1: breaks[i + 1], o: outer(middle), n: inner(middle) };
        const last = slabs[slabs.length - 1];
        if (last && last.o === slab.o && last.n === slab.n && last.z1 === slab.z0)
            last.z1 = slab.z1;
        else
            slabs.push(slab);
    }
    const P = [], N = [], I = [], F = [], FI = [];
    const quad = (a, b, c, d, normal) => {
        const k = P.length / 3;
        for (const v of [a, b, c, d]) {
            P.push(v[0], v[1], v[2]);
            N.push(normal[0], normal[1], normal[2]);
        }
        I.push(k, k + 1, k + 2, k, k + 2, k + 3);
    };
    for (const s of slabs) {
        if (s.o <= 0)
            continue;
        const top = (a, b) => quad([a, T, s.z1], [b, T, s.z1], [b, T, s.z0], [a, T, s.z0], [0, 1, 0]);
        if (s.n > 0) {
            top(xc - s.o, xc - s.n);
            top(xc + s.n, xc + s.o);
        }
        else
            top(xc - s.o, xc + s.o);
        quad([xc - s.o, B, s.z0], [xc - s.o, B, s.z1], [xc - s.o, T, s.z1], [xc - s.o, T, s.z0], [-1, 0, 0]);
        quad([xc + s.o, B, s.z1], [xc + s.o, B, s.z0], [xc + s.o, T, s.z0], [xc + s.o, T, s.z1], [1, 0, 0]);
        if (s.n > 0) {
            quad([xc - s.n, FL, s.z1], [xc - s.n, FL, s.z0], [xc - s.n, T, s.z0], [xc - s.n, T, s.z1], [1, 0, 0]);
            quad([xc + s.n, FL, s.z0], [xc + s.n, FL, s.z1], [xc + s.n, T, s.z1], [xc + s.n, T, s.z0], [-1, 0, 0]);
            const k = F.length / 3;
            for (const v of [[xc - s.n, FL, s.z1], [xc + s.n, FL, s.z1], [xc + s.n, FL, s.z0], [xc - s.n, FL, s.z0]])
                F.push(v[0], v[1], v[2]);
            FI.push(k, k + 1, k + 2, k, k + 2, k + 3);
        }
    }
    const step = (z, a, b, kind) => {
        if (a === b)
            return;
        const low = Math.min(a, b), high = Math.max(a, b);
        if (high <= 0)
            return;
        const towardNext = b < a;
        const faceZ = kind === 'outer' ? (towardNext ? 1 : -1) : (towardNext ? -1 : 1);
        const y0 = kind === 'outer' ? B : FL;
        for (const side of [-1, 1]) {
            const p = xc + side * low, q = xc + side * high;
            const left = Math.min(p, q), right = Math.max(p, q);
            if (right - left < 1e-6)
                continue;
            if (faceZ > 0)
                quad([left, y0, z], [right, y0, z], [right, T, z], [left, T, z], [0, 0, 1]);
            else
                quad([right, y0, z], [left, y0, z], [left, T, z], [right, T, z], [0, 0, -1]);
        }
    };
    for (let i = 0; i + 1 < slabs.length; i++) {
        const a = slabs[i], b = slabs[i + 1];
        step(a.z1, a.o, b.o, 'outer');
        step(a.z1, a.n, b.n, 'inner');
    }
    const first = slabs.find(s => s.o > 0);
    const last = [...slabs].reverse().find(s => s.o > 0);
    if (first && last) {
        quad([xc + first.o, B, first.z0], [xc - first.o, B, first.z0], [xc - first.o, T, first.z0], [xc + first.o, T, first.z0], [0, 0, -1]);
        quad([xc - last.o, B, last.z1], [xc + last.o, B, last.z1], [xc + last.o, T, last.z1], [xc - last.o, T, last.z1], [0, 0, 1]);
    }
    return { rim: { position: P, normal: N, index: I }, floor: { position: F, index: FI } };
}
export function layoutSockets(stops, { merge = MERGE, separation = SEPARATION } = {}) {
    const laid = stops.map(stop => ({ ...stop }));
    const sockets = [];
    const at = (z) => sockets.find(socket => Math.abs(socket.z - z) < 1e-6);
    for (const stop of laid) {
        const socket = at(stop.head);
        if (socket)
            socket.heads.push(stop.id);
        else
            sockets.push({ z: stop.head, heads: [stop.id], tails: [] });
    }
    const ends = laid.filter(stop => stop.hasEnd).sort((a, b) => b.tail - a.tail);
    const clusters = [];
    for (const stop of ends) {
        const cluster = clusters[clusters.length - 1];
        if (cluster && Math.abs(cluster[0].tail - stop.tail) < merge)
            cluster.push(stop);
        else
            clusters.push([stop]);
    }
    for (const cluster of clusters) {
        let z = cluster[0].tail;
        let socket;
        for (let guard = 0; guard < 32 && !socket; guard++) {
            socket = sockets.find(other => Math.abs(other.z - z) < merge);
            if (socket)
                break;
            const clash = sockets.filter(other => Math.abs(other.z - z) < separation);
            if (!clash.length)
                break;
            z = Math.min(...clash.map(other => other.z)) - separation;
        }
        if (!socket) {
            socket = { z, heads: [], tails: [] };
            sockets.push(socket);
        }
        for (const stop of cluster) {
            stop.tail = socket.z;
            stop.span = stop.head - stop.tail;
            socket.tails.push(stop.id);
        }
    }
    return { stops: laid, sockets: sockets.sort((a, b) => b.z - a.z) };
}
const PLAQUE_OVER_PLAQUE = 100;
const PLAQUE_OVER_KEEP = 5;
const AREA_WEIGHT = 1e3;
const OVERLAP_EPS = 1e-9;
const STAY = 0.3;
const SWITCH = 0.3;
const SWITCH_AT = 0.06;
const HOLD = 0.02;
const LEAN_Y = 0.03;
const LEAN_X = 0.02;
const LEAN_OVER = 0.002;
const LEAN_REACH = 0.02;
const LEAN_HARD = 0.01;
const LEAN_PLATE = 0;
const LEAN_NEAR = 0.06;
export function plaqueGap(r, aspect) {
    const ax = r.ax ?? 0, ay = r.ay ?? 0;
    const gx = Math.max(r.x0 + r.dx - ax, ax - (r.x1 + r.dx), 0) * aspect;
    const gy = Math.max(r.y0 + r.dy - ay, ay - (r.y1 + r.dy), 0);
    return Math.sqrt(gx * gx + gy * gy);
}
export function plaquePrice(area, share) {
    return PLAQUE_OVER_KEEP + AREA_WEIGHT * area * share;
}
const keepAt = (keepOut, many, index) => (many ? keepOut[index] : keepOut);
const used = (o) => o.x0 < o.x1 && o.y0 < o.y1;
const MOST = 32;
const ORDER = new Int8Array(MOST);
const COUNTER = new Int8Array(MOST);
const BEST = new Float64Array(MOST * 2);
const BEST_OUT = new Uint8Array(MOST);
const COST = new Float64Array(2);
const REST = new Int8Array(MOST);
const TRY_ALL = 4;
function placeInOrder(rects, n, safe, keepOut, many, count, from, keeping) {
    const aspect = safe.aspect ?? 1;
    const gap = safe.spacing;
    let total = 0, clashes = 0;
    for (let step = from; step < n; step++) {
        const r = rects[ORDER[step]];
        r.out = false;
        const width = r.x1 - r.x0, height = r.y1 - r.y0;
        const ax = r.ax ?? 0, ay = r.ay ?? 0, reach = r.reach ?? 0;
        const limited = reach > 0 && ax === ax && ay === ay;
        const reachSq = reach * reach + OVERLAP_EPS;
        const leanReach = reach + LEAN_REACH;
        const leanReachSq = leanReach * leanReach + OVERLAP_EPS;
        const xMin = -safe.x, xMax = Math.max(xMin, safe.x - width);
        const yMin = -safe.bottom, yMax = Math.max(yMin, safe.top - height);
        const prevX0 = r.x0 + (r.pdx ?? NaN), prevY0 = r.y0 + (r.pdy ?? NaN);
        const stays = prevX0 === prevX0 && prevY0 === prevY0;
        const prevX = prevX0 < xMin ? xMin : prevX0 > xMax ? xMax : prevX0;
        const prevY = prevY0 < yMin ? yMin : prevY0 > yMax ? yMax : prevY0;
        if (keeping && !stays) {
            r.out = true;
            r.dx = 0;
            r.dy = 0;
            continue;
        }
        let wantX = r.x0, wantY = r.y0;
        if (r.x1 > safe.x)
            wantX += safe.x - r.x1;
        if (wantX < -safe.x)
            wantX = -safe.x;
        if (r.y1 > safe.top)
            wantY += safe.top - r.y1;
        if (wantY < -safe.bottom)
            wantY = -safe.bottom;
        const nx = 3 + 2 * count + (stays ? 1 : 0), ny = 3 + 2 * count + 2 * step + (stays ? 1 : 0);
        let bestX = wantX, bestY = wantY, best = Infinity, bestClash = 0;
        for (let pass = 0; pass < (keeping ? 2 : 1); pass++) {
            const nudge = pass === 1;
            best = Infinity;
            bestClash = 0;
            for (let attempt = 0; attempt < (stays ? 2 : 1); attempt++) {
                const margins = attempt === 0 && stays;
                for (let ix = keeping && !nudge ? nx - 1 : 0; ix < nx; ix++) {
                    let x = wantX;
                    if (ix === 1)
                        x = xMin;
                    else if (ix === 2)
                        x = xMax;
                    else if (stays && ix === nx - 1)
                        x = prevX;
                    else if (ix > 2) {
                        const o = keepAt(keepOut, many, (ix - 3) >> 1);
                        if (!used(o) || o.plaque === true)
                            continue;
                        x = (ix & 1) === 1 ? o.x1 : o.x0 - width;
                    }
                    if (!(x >= xMin - OVERLAP_EPS && x <= xMax + OVERLAP_EPS))
                        continue;
                    for (let iy = keeping && !nudge ? ny - 1 : 0; iy < ny; iy++) {
                        let y = wantY;
                        if (iy === 1)
                            y = yMin;
                        else if (iy === 2)
                            y = yMax;
                        else if (stays && iy === ny - 1)
                            y = prevY;
                        else if (iy > 2) {
                            const k = (iy - 3) >> 1, over = ((iy - 3) & 1) === 1;
                            if (k < count) {
                                const o = keepAt(keepOut, many, k);
                                if (!used(o))
                                    continue;
                                y = over ? o.y1 + gap : o.y0 - gap - height;
                            }
                            else {
                                const q = rects[ORDER[k - count]];
                                if (q.out)
                                    continue;
                                y = over ? q.y1 + q.dy + gap : q.y0 + q.dy - gap - height;
                            }
                        }
                        let away = 0;
                        if (stays) {
                            const sx = (x - prevX) * aspect, sy = y - prevY;
                            away = Math.sqrt(sx * sx + sy * sy);
                        }
                        if (nudge && away > LEAN_NEAR)
                            continue;
                        const change = margins && away > SWITCH_AT;
                        const slack = change ? HOLD : 0;
                        const leaned = stays && away <= LEAN_NEAR;
                        if (!(y >= yMin + slack - OVERLAP_EPS && y <= yMax - slack + OVERLAP_EPS))
                            continue;
                        if (limited) {
                            let gx = x - ax, gy = y - ay;
                            if (ax - (x + width) > gx)
                                gx = ax - (x + width);
                            if (ay - (y + height) > gy)
                                gy = ay - (y + height);
                            if (gx < 0)
                                gx = 0;
                            if (gy < 0)
                                gy = 0;
                            gx *= aspect;
                            if (gx * gx + gy * gy > (leaned ? leanReachSq : reachSq))
                                continue;
                        }
                        const mx = (x - wantX) * aspect, my = y - wantY;
                        let cost = Math.sqrt(mx * mx + my * my);
                        if (stays)
                            cost += STAY * away + (change ? SWITCH : 0);
                        const pad = change && mx * mx + my * my < OVERLAP_EPS ? HOLD : 0;
                        const spacing = leaned ? Math.max(-LEAN_OVER, gap - LEAN_Y) : gap;
                        let clash = 0;
                        for (let j = 0; j < step; j++) {
                            const q = rects[ORDER[j]];
                            if (q.out)
                                continue;
                            const across = Math.min(x + width, q.x1 + q.dx + pad) - Math.max(x, q.x0 + q.dx - pad);
                            if (across <= OVERLAP_EPS)
                                continue;
                            const down = Math.min(y + height, q.y1 + q.dy + spacing + pad) - Math.max(y, q.y0 + q.dy - spacing - pad);
                            if (down > OVERLAP_EPS)
                                clash += PLAQUE_OVER_PLAQUE + AREA_WEIGHT * across * down;
                        }
                        for (let k = 0; k < count; k++) {
                            const o = keepAt(keepOut, many, k);
                            if (!used(o))
                                continue;
                            const hard = o.hard === true, rim = o.margin ?? 0;
                            const mx0 = leaned ? pad - (hard ? LEAN_HARD : Math.min(LEAN_X, rim)) : pad;
                            const my0 = leaned ? pad + gap - (hard ? LEAN_HARD : Math.min(LEAN_Y, gap + rim)) : pad + gap;
                            const across = Math.min(x + width, o.x1 + mx0) - Math.max(x, o.x0 - mx0);
                            if (across <= OVERLAP_EPS)
                                continue;
                            const down = Math.min(y + height, o.y1 + my0) - Math.max(y, o.y0 - my0);
                            if (down > OVERLAP_EPS)
                                clash += (o.hard === true ? PLAQUE_OVER_PLAQUE : PLAQUE_OVER_KEEP) + AREA_WEIGHT * across * down;
                        }
                        cost += clash;
                        if (cost < best - OVERLAP_EPS) {
                            best = cost;
                            bestClash = clash;
                            bestX = x;
                            bestY = y;
                        }
                    }
                }
                if (best < Infinity && bestClash === 0)
                    break;
            }
            if (!keeping || (best < Infinity && bestClash === 0))
                break;
        }
        if (keeping) {
            if (!(best < Infinity && bestClash === 0)) {
                r.out = true;
                r.dx = 0;
                r.dy = 0;
                continue;
            }
            r.dx = bestX - r.x0;
            r.dy = bestY - r.y0;
            continue;
        }
        const price = r.rank;
        if (price !== undefined && !(best < price)) {
            r.out = true;
            r.dx = 0;
            r.dy = 0;
            total += price;
            clashes += price;
            continue;
        }
        r.dx = bestX - r.x0;
        r.dy = bestY - r.y0;
        total += best;
        clashes += bestClash;
    }
    COST[0] = total;
    COST[1] = clashes;
}
export function settlePlaques(rects, safe = SAFE, keepOut = null, size = rects.length, keeping = true) {
    const n = Math.min(size, rects.length, MOST);
    sortByHeight(rects, n);
    const many = Array.isArray(keepOut);
    const count = keepOut === null ? 0 : many ? keepOut.length : 1;
    for (let i = 0; i < n; i++)
        ORDER[i] = i;
    if (keeping)
        placeInOrder(rects, n, safe, keepOut, many, count, 0, true);
    else
        for (let i = 0; i < n; i++)
            rects[i].out = true;
    let fixed = 0, loose = 0;
    for (let i = 0; i < n; i++) {
        if (rects[i].out)
            REST[loose++] = i;
        else
            ORDER[fixed++] = i;
    }
    for (let k = 0; k < loose; k++)
        ORDER[fixed + k] = REST[k];
    COST[0] = 0;
    COST[1] = 0;
    if (loose)
        placeInOrder(rects, n, safe, keepOut, many, count, fixed, false);
    let best = COST[0];
    if (COST[1] > 0 && loose > 1 && loose <= TRY_ALL) {
        for (let i = 0; i < n; i++) {
            BEST[2 * i] = rects[i].dx;
            BEST[2 * i + 1] = rects[i].dy;
            BEST_OUT[i] = rects[i].out ? 1 : 0;
        }
        for (let i = 0; i < loose; i++)
            COUNTER[i] = 0;
        let i = 0;
        while (i < loose) {
            if (COUNTER[i] < i) {
                const j = fixed + ((i & 1) === 0 ? 0 : COUNTER[i]);
                const swap = ORDER[j];
                ORDER[j] = ORDER[fixed + i];
                ORDER[fixed + i] = swap;
                placeInOrder(rects, n, safe, keepOut, many, count, fixed, false);
                if (COST[0] < best - OVERLAP_EPS) {
                    best = COST[0];
                    for (let k = 0; k < n; k++) {
                        BEST[2 * k] = rects[k].dx;
                        BEST[2 * k + 1] = rects[k].dy;
                        BEST_OUT[k] = rects[k].out ? 1 : 0;
                    }
                }
                COUNTER[i]++;
                i = 0;
            }
            else {
                COUNTER[i] = 0;
                i++;
            }
        }
        for (let k = 0; k < n; k++) {
            rects[k].dx = BEST[2 * k];
            rects[k].dy = BEST[2 * k + 1];
            rects[k].out = BEST_OUT[k] === 1;
        }
    }
    for (let k = 0; k < fixed; k++) {
        const last = n - 1;
        const swap = ORDER[k];
        ORDER[k] = ORDER[last];
        ORDER[last] = swap;
        const r = rects[swap];
        const dx = r.dx, dy = r.dy;
        placeInOrder(rects, n, safe, keepOut, many, count, last, false);
        if (r.out) {
            r.out = false;
            r.dx = dx;
            r.dy = dy;
        }
        ORDER[last] = ORDER[k];
        ORDER[k] = swap;
    }
    return rects;
}
const FRAME = 0.075;
const BAND = 0.62;
const GAP = 0.1;
const HEAD_MAX = 0.42;
const HEAD_MIN = 0.2;
const SUB_MAX = 0.24;
const SUB_MIN = 0.14;
const BEVEL = Math.min(0.02, PLAQUE_HEIGHT * 0.12);
const NOMINAL_SUB = SUB_MAX * (PLAQUE_HEIGHT - BEVEL * 2);
let measurer = null;
export function plaqueWidth(stop) {
    measurer ?? (measurer = document.createElement('canvas').getContext('2d'));
    const fonts = signFonts();
    const h = (PLAQUE_HEIGHT - BEVEL * 2) * LABEL_DPM;
    measurer.font = `800 ${h * HEAD_MAX}px ${fonts.sans}`;
    const head = measurer.measureText(stop.headline.toUpperCase()).width;
    measurer.font = `600 ${h * SUB_MAX}px ${fonts.sans}`;
    const sub = measurer.measureText(stop.subtitle).width;
    const text = Math.max(head, sub);
    const px = h * (FRAME * 2 + BAND + GAP * 2) + text;
    return Math.max(1.9, Math.min(PLAQUE_MAX_WIDTH, px / LABEL_DPM + BEVEL * 2));
}
export function paintPlaque(ctx, rect, sans, stop, track) {
    const { w, h } = rect;
    const frame = h * FRAME;
    paintWood(ctx, rect, { seed: stop.id, base: TOKENS.woodDark, boards: 1, nails: false });
    ctx.strokeStyle = '#2c2619';
    ctx.lineWidth = Math.max(3, h * 0.035);
    ctx.strokeRect(0, 0, w, h);
    const inner = { x: frame, y: frame, w: w - frame * 2, h: h - frame * 2 };
    paintParchment(ctx, inner, { seed: `${stop.id}:paper`, radius: h * 0.045, burn: 0.35, rule: false });
    const band = h * BAND;
    ctx.save();
    ctx.beginPath();
    ctx.rect(inner.x, inner.y, band, inner.h);
    ctx.clip();
    ctx.fillStyle = track.colour;
    ctx.fillRect(inner.x, inner.y, band, inner.h);
    const sheen = ctx.createLinearGradient(inner.x, 0, inner.x + band, 0);
    sheen.addColorStop(0, 'rgba(255,255,255,0.16)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = sheen;
    ctx.fillRect(inner.x, inner.y, band, inner.h);
    ctx.restore();
    ctx.fillStyle = 'rgba(26,23,18,0.55)';
    ctx.fillRect(inner.x + band - h * 0.012, inner.y, h * 0.024, inner.h);
    paintMark(ctx, track.id, inner.x + band / 2, inner.y + inner.h / 2, band * 0.56, track.colour);
    const x = inner.x + band + h * GAP;
    const room = inner.x + inner.w - h * GAP - x;
    const head = fitText(ctx, stop.headline.toUpperCase(), { maxWidth: room, minPx: h * HEAD_MIN, maxPx: h * HEAD_MAX, weight: 800, family: sans, lineHeight: 1 });
    const sub = fitText(ctx, stop.subtitle, { maxWidth: room, minPx: h * SUB_MIN, maxPx: h * SUB_MAX, weight: 600, family: sans, lineHeight: 1.1 });
    const gap = h * 0.05;
    const top = inner.y + (inner.h - (head.height + gap + sub.height)) / 2;
    ctx.fillStyle = TOKENS.ink;
    drawFit(ctx, head, x, top, 'left');
    ctx.fillStyle = TOKENS.ink2;
    drawFit(ctx, sub, x, top + head.height + gap, 'left');
    const nail = frame * 0.5;
    for (const [nx, ny] of [[nail, nail], [w - nail, nail], [nail, h - nail], [w - nail, h - nail]])
        drawNail(ctx, nx, ny, frame * 0.26);
    return { head: head.px, sub: sub.px };
}
function paintMark(ctx, lane, cx, cy, size, ground) {
    const k = size / 2;
    ctx.save();
    ctx.fillStyle = TOKENS.ink;
    ctx.strokeStyle = TOKENS.ink;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (lane === 'education') {
        ctx.beginPath();
        ctx.moveTo(cx - k * 0.56, cy + k * 0.02);
        ctx.lineTo(cx, cy + k * 0.3);
        ctx.lineTo(cx + k * 0.56, cy + k * 0.02);
        ctx.lineTo(cx + k * 0.56, cy + k * 0.46);
        ctx.quadraticCurveTo(cx, cy + k * 0.84, cx - k * 0.56, cy + k * 0.46);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx, cy - k * 0.66);
        ctx.lineTo(cx + k, cy - k * 0.2);
        ctx.lineTo(cx, cy + k * 0.26);
        ctx.lineTo(cx - k, cy - k * 0.2);
        ctx.closePath();
        ctx.lineWidth = k * 0.08;
        ctx.strokeStyle = ground;
        ctx.stroke();
        ctx.fill();
        ctx.lineWidth = k * 0.07;
        ctx.strokeStyle = TOKENS.ink;
        ctx.beginPath();
        ctx.moveTo(cx + k * 0.82, cy - k * 0.12);
        ctx.lineTo(cx + k * 0.82, cy + k * 0.5);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + k * 0.82, cy + k * 0.58, k * 0.1, 0, Math.PI * 2);
        ctx.fill();
    }
    else if (lane === 'work') {
        ctx.lineWidth = k * 0.15;
        ctx.beginPath();
        ctx.moveTo(cx - k * 0.3, cy - k * 0.36);
        ctx.lineTo(cx - k * 0.3, cy - k * 0.68);
        ctx.lineTo(cx + k * 0.3, cy - k * 0.68);
        ctx.lineTo(cx + k * 0.3, cy - k * 0.36);
        ctx.stroke();
        roundRect(ctx, cx - k * 0.94, cy - k * 0.44, k * 1.88, k * 1.32, k * 0.16);
        ctx.fill();
        ctx.fillStyle = ground;
        ctx.fillRect(cx - k * 0.94, cy + k * 0.1, k * 1.88, k * 0.08);
        ctx.fillRect(cx - k * 0.14, cy - k * 0.02, k * 0.28, k * 0.3);
    }
    else {
        for (let i = 0; i < 8; i++) {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate((i * Math.PI) / 4);
            ctx.fillRect(-k * 0.15, -k * 0.98, k * 0.3, k * 0.5);
            ctx.restore();
        }
        ctx.beginPath();
        ctx.arc(cx, cy, k * 0.74, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = ground;
        ctx.beginPath();
        ctx.arc(cx, cy, k * 0.3, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}
function tintStone(stone, colour) {
    stone.traverse(node => {
        if (!(node instanceof THREE.Mesh))
            return;
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        const painted = materials.map(material => /emissive/i.test(material.name ?? '')
            ? new THREE.MeshBasicMaterial({ color: colour, name: material.name })
            : material);
        node.material = painted.length === 1 ? painted[0] : painted;
    });
}
