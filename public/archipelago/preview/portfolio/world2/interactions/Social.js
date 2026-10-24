import * as THREE from 'three';
import { contact } from '../../content/profile.js';
import { cutGlyph, paintUv } from './glyphs.js';
import { SIGN_THEMES, SWATCH, Sign, SignRuntime, mergeParts, onSignFontsLoaded, place, plankGeometry, signMaterials, } from '../signs/index.js';
import { ARRIVAL, PLAZA, arrivalSpots, authoredYaw, lensDirection, lensYaw, pieceMatrix, plazaToLocal, selectKeepers, slots, splitPieces, standingLevel, towardLens, yawToward, } from './socialLayout.js';
import { STATIONS, STATION_ICONS, isPending, shortValue } from '../content/social.js';
const ICONS = STATION_ICONS;
export const RETIRED = [
    'twitchPhysicalDynamic',
    'youtubePhysicalDynamic',
    'discordPhysicalDynamic',
    'blueskyPhysicalDynamic.001',
    'xPhysicalDynamic',
    'onlyfansPhysicalDynamic',
    'refStatuePhysicalDynamic',
    'boyMesh',
    'baguiraMesh.001',
    'sudoMesh.003',
    'wings',
];
export const REPLACED = ['physicalFixed.002', 'refFan'];
export const REPLACED_FLAG = 'w2Replaced';
const MONOGRAM = ['A', 'N'];
const PLAZA_MONOGRAM = 0.8;
const CV_SEAT = 'twitchPhysicalDynamic';
function modalUv(mesh) {
    const attribute = mesh?.geometry.getAttribute('uv');
    if (!attribute)
        return null;
    const tally = new Map();
    for (let i = 0; i < attribute.count; i++) {
        const x = attribute.getX(i), y = attribute.getY(i);
        const key = `${x.toFixed(4)},${y.toFixed(4)}`;
        const seen = tally.get(key);
        if (seen)
            seen.count++;
        else
            tally.set(key, { uv: new THREE.Vector2(x, y), count: 1 });
    }
    let best = null;
    for (const entry of tally.values())
        if (!best || entry.count > best.count)
            best = entry;
    return best?.uv ?? null;
}
const layouts = new WeakMap();
export const layoutOf = (environment) => layouts.get(environment);
function visualBox(node) {
    const box = new THREE.Box3();
    node.updateWorldMatrix(true, true);
    node.traverse(child => {
        if (!(child instanceof THREE.Mesh) || child.userData.w2Role === 'collider')
            return;
        if (!child.geometry.boundingBox)
            child.geometry.computeBoundingBox();
        box.union(child.geometry.boundingBox.clone().applyMatrix4(child.matrixWorld));
    });
    return box;
}
const WORLD_UP = new THREE.Vector3(0, 1, 0);
export function reachFloor(root, floor) {
    root.updateWorldMatrix(true, true);
    const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
    const up = new THREE.Vector3();
    let lowest = null;
    for (const node of root.children) {
        if (node.userData.w2Role !== 'collider' || node.isMesh)
            continue;
        if (node.userData.w2Shape !== 'cuboid' && node.userData.w2Shape !== 'tube')
            continue;
        node.matrixWorld.decompose(position, quaternion, scale);
        if (Math.abs(up.set(0, 1, 0).applyQuaternion(quaternion).y) < 0.99)
            continue;
        const half = Math.abs(scale.y) * (node.userData.w2DisplaySize ?? 0.5);
        if (half > 1e-6 && (!lowest || position.y - half < lowest.bottom))
            lowest = { node, bottom: position.y - half, half };
    }
    if (!lowest)
        return;
    const reach = lowest.bottom - floor;
    if (reach <= 0.005)
        return;
    const k = root.getWorldScale(new THREE.Vector3()).y;
    lowest.node.scale.y *= (lowest.half + reach / 2) / lowest.half;
    lowest.node.position.y -= reach / 2 / k;
    lowest.node.updateMatrixWorld(true);
}
const LEAN = Math.tan(30 * Math.PI / 180);
export function steady(root) {
    root.updateWorldMatrix(true, true);
    const parts = [];
    const up = new THREE.Vector3();
    for (const node of root.children) {
        if (node.userData.w2Role !== 'collider' || node.isMesh)
            continue;
        const shape = node.userData.w2Shape;
        if (shape !== 'cuboid' && shape !== 'tube')
            return null;
        if (Math.abs(up.set(0, 1, 0).applyQuaternion(node.quaternion).y) < 0.99)
            return null;
        const half = node.userData.w2DisplaySize ?? 0.5;
        const sx = Math.abs(node.scale.x) * half, sy = Math.abs(node.scale.y) * half, sz = Math.abs(node.scale.z) * half;
        const yaw = 2 * Math.atan2(node.quaternion.y, node.quaternion.w), c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw));
        const radius = Math.max(sx, sz);
        parts.push(shape === 'tube'
            ? { x: node.position.x, y: node.position.y, z: node.position.z, hx: radius, hy: sy, hz: radius }
            : { x: node.position.x, y: node.position.y, z: node.position.z, hx: c * sx + s * sz, hy: sy, hz: s * sx + c * sz });
    }
    if (parts.length < 2)
        return null;
    const lowest = parts.reduce((a, b) => (b.y - b.hy < a.y - a.hy ? b : a));
    const bottom = lowest.y - lowest.hy;
    const mean = (axis, extra = []) => (parts.reduce((sum, p) => sum + p[axis], 0) + extra.reduce((sum, v) => sum + v, 0)) / (parts.length + extra.length);
    if (Math.abs(mean('x') - lowest.x) <= lowest.hx * 0.6 && Math.abs(mean('z') - lowest.z) <= lowest.hz * 0.6)
        return null;
    const k = root.getWorldScale(new THREE.Vector3()).y || 1;
    const thick = Math.min(0.05 / k, lowest.hy);
    const own = { x0: lowest.x - lowest.hx, x1: lowest.x + lowest.hx, z0: lowest.z - lowest.hz, z1: lowest.z + lowest.hz };
    let rect = own;
    for (let pass = 0; pass < 8; pass++) {
        const at = { x: (rect.x0 + rect.x1) / 2, y: bottom + thick / 2, z: (rect.z0 + rect.z1) / 2 };
        const com = { x: mean('x', [at.x]), y: mean('y', [at.y]), z: mean('z', [at.z]) };
        const reach = Math.max(0, com.y - bottom) * LEAN;
        const next = { x0: Math.min(own.x0, com.x - reach), x1: Math.max(own.x1, com.x + reach), z0: Math.min(own.z0, com.z - reach), z1: Math.max(own.z1, com.z + reach) };
        const same = Math.abs(next.x0 - rect.x0) + Math.abs(next.x1 - rect.x1) + Math.abs(next.z0 - rect.z0) + Math.abs(next.z1 - rect.z1) < 1e-5;
        rect = next;
        if (same)
            break;
    }
    const foot = colliderBox('cuboid.foot', [rect.x1 - rect.x0, thick, rect.z1 - rect.z0], [(rect.x0 + rect.x1) / 2, bottom + thick / 2, (rect.z0 + rect.z1) / 2]);
    root.add(foot);
    foot.updateMatrixWorld(true);
    return foot;
}
export function documentGeometry() {
    const bar = (width, y, x = 0, swatch = SWATCH.dark) => place(plankGeometry({ width, height: 0.075, depth: 0.02, swatch, bevel: 0 }), [x, y, 0.082]);
    return mergeParts([
        place(plankGeometry({ width: 1.1, height: 0.12, depth: 0.62, swatch: SWATCH.copper, edge: SWATCH.woodDark, bevel: 0.025 }), [0, 0.06, 0.02]),
        place(plankGeometry({ width: 0.16, height: 0.62, depth: 0.12, swatch: SWATCH.tan, edge: SWATCH.woodDark, bevel: 0.02 }), [0, 0.43, -0.1]),
        place(plankGeometry({ width: 1.0, height: 1.34, depth: 0.09, swatch: SWATCH.white, edge: SWATCH.silver, bevel: 0.025 }), [0, 1.2, 0.0]),
        bar(0.56, 1.72, -0.12, SWATCH.copper),
        bar(0.72, 1.5, -0.04), bar(0.72, 1.36, -0.04), bar(0.6, 1.22, -0.1), bar(0.72, 1.08, -0.04), bar(0.5, 0.94, -0.15),
        place(plankGeometry({ width: 0.2, height: 0.2, depth: 0.025, swatch: SWATCH.silver, bevel: 0 }), [0.4, 0.62, 0.082], [0, 0, Math.PI / 4]),
    ]);
}
function colliderBox(name, size, at) {
    const node = new THREE.Object3D();
    node.name = name;
    node.userData = { w2Role: 'collider', w2Shape: 'cuboid', w2DisplaySize: 0.5 };
    node.position.set(...at);
    node.scale.set(...size);
    node.visible = false;
    return node;
}
export function arrange(environment, { rotation = null, theta = Math.PI / 4 } = {}) {
    const nodes = environment.nodes;
    const centre = nodes.get('refCenter'), pads = nodes.get('Cube.133');
    if (!centre || !(pads instanceof THREE.Mesh) || !pads.geometry.index || pads.geometry.groups.length || Array.isArray(pads.material))
        return null;
    environment.group.updateMatrixWorld(true);
    const world = pads.matrixWorld;
    const worldRotation = new THREE.Quaternion(), worldScale = new THREE.Vector3();
    world.decompose(new THREE.Vector3(), worldRotation, worldScale);
    if (worldRotation.angleTo(new THREE.Quaternion()) > 1e-4 || Math.abs(worldScale.x - 1) > 1e-4 || Math.abs(worldScale.y - 1) > 1e-4 || Math.abs(worldScale.z - 1) > 1e-4)
        return null;
    const psi = lensYaw(theta, rotation);
    const dais = centre.getWorldPosition(new THREE.Vector3());
    const placed = slots().map(slot => ({ ...slot, ...plazaToLocal(slot, psi, dais) }));
    const target = Object.fromEntries(STATIONS.map((id, index) => [id, placed[index]]));
    const iconNode = (id) => nodes.get(ICONS[id] ?? CV_SEAT) ?? null;
    const anchors = {};
    for (const id of STATIONS) {
        const node = iconNode(id);
        if (!node)
            return null;
        const at = node.getWorldPosition(new THREE.Vector3());
        anchors[id] = { x: at.x, z: at.z };
    }
    const geometry = pads.geometry;
    const indexArray = pads.geometry.index.array;
    const pieces = splitPieces(geometry);
    const centres = pieces.map(piece => piece.box.getCenter(new THREE.Vector3()).applyMatrix4(world));
    const keepers = selectKeepers(centres, { x: dais.x, z: dais.z }, anchors);
    if (!keepers)
        return null;
    const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
    const inverse = world.clone().invert();
    const point = new THREE.Vector3(), n = new THREE.Vector3();
    const kept = [];
    let padTop = 0;
    for (const { index, id } of keepers) {
        const piece = pieces[index], c = centres[index];
        const to = id === 'dais' ? { x: dais.x, z: dais.z } : target[id];
        const turn = psi - (id === 'dais' ? 0 : authoredYaw(c, dais));
        const scale = id === 'dais' ? 1 : PLAZA.padScale;
        const matrix = pieceMatrix(c, to, turn, scale);
        const normals = new THREE.Matrix3().getNormalMatrix(new THREE.Matrix4().makeRotationY(turn).multiply(new THREE.Matrix4().makeScale(scale, 1, scale)));
        for (const v of piece.vertices) {
            point.set(position.getX(v), position.getY(v), position.getZ(v)).applyMatrix4(world).applyMatrix4(matrix).applyMatrix4(inverse);
            position.setXYZ(v, point.x, point.y, point.z);
            if (normal) {
                n.set(normal.getX(v), normal.getY(v), normal.getZ(v)).applyMatrix3(normals).normalize();
                normal.setXYZ(v, n.x, n.y, n.z);
            }
        }
        for (const t of piece.triangles)
            kept.push(indexArray[t], indexArray[t + 1], indexArray[t + 2]);
        if (id !== 'dais')
            padTop = Math.max(padTop, standingLevel(geometry, piece) + world.elements[13]);
    }
    compactGeometry(geometry, kept);
    const seats = {};
    const yaw = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, psi);
    for (const id of STATIONS) {
        const slot = target[id];
        const seat = { id, x: slot.x, z: slot.z, angle: slot.angle, node: null };
        seats[id] = seat;
        const node = id === 'cv' ? null : iconNode(id);
        if (!node || node.userData.assetPartEdited) {
            seat.node = node;
            continue;
        }
        seat.node = node;
        node.userData.proceduralDerived = true;
        const parent = node.parent;
        const before = visualBox(node);
        const origin = node.getWorldPosition(new THREE.Vector3());
        const gap = Math.min(before.min.y - padTop, 0.02);
        const pad = centres[keepers.find(keeper => keeper.id === id).index];
        const authored = node.getWorldQuaternion(new THREE.Quaternion());
        const offset = new THREE.Vector3(origin.x - pad.x, 0, origin.z - pad.z)
            .applyQuaternion(new THREE.Quaternion().setFromAxisAngle(WORLD_UP, psi - 2 * Math.atan2(authored.y, authored.w)));
        node.scale.multiplyScalar(PLAZA.iconScale);
        parent.updateWorldMatrix(true, false);
        const parentRotation = parent.getWorldQuaternion(new THREE.Quaternion());
        node.quaternion.copy(parentRotation.clone().invert().multiply(yaw));
        const next = new THREE.Vector3(slot.x, 0, slot.z).addScaledVector(offset, PLAZA.iconScale);
        next.y = origin.y;
        node.position.copy(parent.worldToLocal(next.clone()));
        node.updateMatrixWorld(true);
        const after = visualBox(node);
        next.y += padTop + gap * PLAZA.iconScale - after.min.y;
        node.position.copy(parent.worldToLocal(next.clone()));
        node.updateMatrixWorld(true);
        reachFloor(node, Math.max(padTop + gap * PLAZA.iconScale, padTop));
        steady(node);
    }
    const cv = seats.cv;
    const material = pads.material;
    const prop = new THREE.Mesh(documentGeometry(), material);
    prop.name = 'cvPhysicalDynamic';
    prop.userData = { name: prop.name, w2Source: prop.name, w2Category: 'scenery', w2Role: 'physical', w2Body: 'dynamic', mass: 1, proceduralDerived: true };
    prop.castShadow = true;
    prop.receiveShadow = true;
    prop.add(colliderBox('cuboid.cvSheet', [1.0, 1.34, 0.09], [0, 1.2, 0]), colliderBox('cuboid.cvFoot', [1.1, 0.12, 0.62], [0, 0.06, 0.02]));
    prop.scale.setScalar(PLAZA.iconScale);
    prop.quaternion.copy(yaw);
    prop.position.set(cv.x, padTop + 0.005, cv.z);
    environment.group.add(prop);
    environment.nodes.set(prop.name, prop);
    environment.meshes.push(prop);
    cv.node = prop;
    for (const name of REPLACED) {
        const node = nodes.get(name);
        if (node)
            node.userData[REPLACED_FLAG] = true;
    }
    const layout = { psi, dais, seats, padTop };
    layouts.set(environment, layout);
    return layout;
}
function compactGeometry(geometry, index) {
    const count = geometry.getAttribute('position').count;
    const remap = new Int32Array(count).fill(-1);
    let next = 0;
    for (const v of index)
        if (remap[v] < 0)
            remap[v] = next++;
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
        const size = attribute.itemSize;
        const array = new attribute.array.constructor(next * size);
        for (let v = 0; v < count; v++) {
            const to = remap[v];
            if (to < 0)
                continue;
            for (let k = 0; k < size; k++)
                array[to * size + k] = attribute.array[v * size + k];
        }
        geometry.setAttribute(name, new THREE.BufferAttribute(array, size, attribute.normalized));
    }
    geometry.setIndex(index.map(v => remap[v]));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
}
const BOARD_THEMES = {
    github: { ...SIGN_THEMES.voxel, id: 'social-github', emblem: null, charm: 'gear', hardware: 'oak' },
    linkedin: { ...SIGN_THEMES.jobs, id: 'social-linkedin', emblem: null, charm: 'cards', hardware: 'rope' },
    email: { ...SIGN_THEMES.chess, id: 'social-email', emblem: null, charm: 'pennant', hardware: 'oak' },
    cv: { ...SIGN_THEMES.timeline, id: 'social-cv', emblem: null, charm: 'books', hardware: 'chain' },
};
const KICKER = { github: 'The code', linkedin: 'The career', email: 'Say hello', cv: 'The document' };
export const BOARD = { width: 3.42, height: 1.38, bottom: 2.55, behind: 1.9, lean: 12 * Math.PI / 180, dpm: 176 };
export const PROMPT = { toward: 1.5, height: 2.7 };
function paintBoard(station, title, value, pending) {
    return (ctx, r, t) => {
        const { w, h } = r;
        t.paintParchment(ctx, r, { seed: station, radius: h * 0.035 });
        const pad = h * 0.1;
        const theme = t.theme;
        const ribbon = { x: pad, y: pad * 0.8, w: 0, h: h * 0.13 };
        const kicker = t.fitText(ctx, KICKER[station].toUpperCase(), { maxWidth: w * 0.5, minPx: h * 0.06, maxPx: h * 0.085, weight: 600, family: t.fonts.mono, lineHeight: 1 });
        ribbon.w = Math.min(w - pad * 2, ctx.measureText(kicker.lines[0] ?? '').width + h * 0.22);
        t.paintRibbon(ctx, ribbon, theme.ribbon, theme.ribbonDeep);
        ctx.fillStyle = theme.ribbonInk;
        t.drawFit(ctx, kicker, pad + h * 0.11, ribbon.y + ribbon.h / 2 - kicker.px * 0.5, 'left');
        const top = ribbon.y + ribbon.h + pad * 0.35;
        const room = h - pad - top;
        const name = t.fitText(ctx, title, { maxWidth: w - pad * 2, maxLines: 1, minPx: h * 0.14, maxPx: h * 0.4, weight: 700, family: t.fonts.sans, lineHeight: 1 });
        ctx.fillStyle = t.tokens.ink;
        t.drawFit(ctx, name, pad, top, 'left');
        const sub = t.fitText(ctx, value, { maxWidth: w - pad * 2, maxLines: 1, minPx: h * 0.07, maxPx: h * 0.2, weight: pending ? 600 : 500, family: t.fonts.sans, lineHeight: 1 });
        ctx.fillStyle = pending ? t.tokens.terracottaDeep : t.tokens.ink2;
        t.drawFit(ctx, sub, pad, top + Math.min(room - sub.height, name.height + h * 0.05), 'left');
    };
}
export class Social {
    constructor(game, references, prompts, bin) {
        this.game = game;
        this.references = references;
        this.links = [];
        this.group = new THREE.Group();
        this.fans = null;
        this.monogram = [];
        this.boards = [];
        this.group.name = 'World2 / social';
        const layout = this.layout = layoutOf(references.environment) ?? null;
        if (layout)
            this.arranged(layout, prompts, bin);
        else
            this.legacy(prompts, bin);
        bin.object3D(this.group);
    }
    arranged(layout, prompts, bin) {
        this.retire();
        this.references.suppress('refFan');
        const camera = () => this.game.view?.camera;
        const materials = signMaterials(this.references.environment.group);
        const runtime = new SignRuntime({ ticker: this.game.ticker, camera }, bin);
        bin.add(() => materials.dispose());
        for (const id of STATIONS) {
            const entry = contact.find(c => c.id === id);
            const seat = layout.seats[id];
            if (!entry || !seat?.node)
                continue;
            const pending = isPending(entry);
            const href = pending ? null : entry.href.startsWith('/') ? new URL(entry.href, window.location.origin).toString() : entry.href;
            const sign = new Sign({
                id: `social-${id}`, variant: 'board', width: BOARD.width, height: BOARD.height, legHeight: BOARD.bottom, dpm: BOARD.dpm,
                title: entry.label, subtitle: shortValue(entry), kicker: KICKER[id], theme: BOARD_THEMES[id], emblem: null,
                materials, runtime, bin, paint: paintBoard(id, entry.label, shortValue(entry), pending),
            });
            delete sign.group.userData.sign;
            const at = towardLens(seat, layout.psi, -BOARD.behind);
            sign.group.position.set(at.x, 0, at.z);
            sign.group.rotation.order = 'YXZ';
            sign.group.rotation.set(-BOARD.lean, layout.psi, 0);
            this.group.add(sign.group);
            this.boards.push(sign);
            if (!camera())
                this.paintPreview(sign, bin);
            this.boardBody(at, layout.psi, id);
            if (!pending && href) {
                const ahead = towardLens(seat, layout.psi, PROMPT.toward);
                prompts.create({
                    label: entry.label, position: new THREE.Vector3(ahead.x, PROMPT.height, ahead.z), align: seat.angle < 0 ? 'left' : 'right',
                    onInteract: () => this.open(entry.id, href),
                });
            }
            this.links.push({ id, label: entry.label, href, node: seat.node, sign: sign.group });
        }
        this.buildMonogram(layout.dais, layout.psi, PLAZA_MONOGRAM);
        this.declareArrival(layout, bin);
    }
    declareArrival(layout, bin) {
        const points = this.game.placement?.arrivalPoints;
        const physics = this.game.physics;
        if (!points || !physics.point || !physics.vector)
            return;
        const lens = lensDirection(layout.psi);
        const away = physics.vector({ x: -lens.x, y: 0, z: -lens.z });
        const heading = Math.atan2(-away.z, away.x);
        const poses = arrivalSpots(layout.psi, layout.dais, physics.scale ?? 1).map(spot => {
            const at = physics.point(new THREE.Vector3(spot.x, layout.dais.y, spot.z));
            return { x: at.x, z: at.z, heading };
        });
        const point = { name: 'Contact', poses, dynamicMargin: ARRIVAL.dynamicMargin, reach: ARRIVAL.reach };
        points.add(point);
        bin.add(() => points.delete(point));
    }
    paintPreview(sign, bin) {
        const face = sign.face;
        if (!face)
            return;
        if (document.body?.dataset.player === 'true') {
            face.onBeforeRender = () => { face.onBeforeRender = () => { }; sign.paintNow(); };
            return;
        }
        sign.paintNow();
        bin.add(onSignFontsLoaded(() => sign.paintNow()));
    }
    boardBody(at, psi, id) {
        const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-BOARD.lean, psi, 0, 'YXZ'));
        const postX = BOARD.width / 2 + 0.11, postHalfHeight = (BOARD.bottom + BOARD.height + 0.2) / 2;
        const post = (side) => ({ shape: 'cuboid', parameters: [0.09, postHalfHeight, 0.09], position: new THREE.Vector3(side * postX, postHalfHeight, -0.01), category: 'object' });
        const face = { shape: 'cuboid', parameters: [BOARD.width / 2 + 0.1, BOARD.height / 2 + 0.1, 0.08], position: new THREE.Vector3(0, BOARD.bottom + BOARD.height / 2, 0), category: 'object' };
        const physical = this.game.physics.add({
            type: 'fixed', position: new THREE.Vector3(at.x, 0, at.z), rotation, colliders: [post(-1), post(1), face],
            friction: 0.6, restitution: 0.1, owner: `social-board-${id}`,
        });
        this.references.environment.anchor(physical);
    }
    legacy(prompts, bin) {
        const references = this.references;
        const centre = references.position('refCenter');
        const spare = references.position('twitchPhysicalDynamic') ?? this.nextOnArc(centre);
        const plates = [];
        for (const entry of contact) {
            const iconName = ICONS[entry.id];
            const node = iconName ? references.node(iconName) : null;
            const anchor = node?.getWorldPosition(new THREE.Vector3()) ?? spare;
            if (!anchor)
                continue;
            const href = entry.href.startsWith('/') ? new URL(entry.href, window.location.origin).toString() : entry.href;
            const sign = this.buildSign(entry.label, entry.value);
            sign.position.copy(anchor).add(new THREE.Vector3(0, 1.35, 0));
            this.group.add(sign);
            plates.push(sign);
            prompts.create({
                label: entry.label, position: anchor.clone().setY(Math.max(1, anchor.y)), align: 'right',
                onInteract: () => this.open(entry.id, href),
            });
            this.links.push({ id: entry.id, label: entry.label, href, node: node ?? sign, sign });
        }
        this.retire();
        this.buildMonogram(centre);
        this.buildFans(prompts);
        const reach = 34;
        const tick = () => {
            const player = this.game.player.position;
            for (const sign of plates) {
                const near = Math.hypot(player.x - sign.position.x, player.z - sign.position.z) <= reach;
                sign.visible = near;
                if (near)
                    sign.rotation.y = yawToward(sign.position, player);
            }
        };
        this.game.ticker.events.on('tick', tick, 12);
        bin.add(() => this.game.ticker.events.off('tick', tick));
        bin.add(() => {
            for (const sign of plates) {
                sign.geometry.dispose();
                const material = sign.material;
                material.map?.dispose();
                material.dispose();
            }
        });
    }
    retire() {
        for (const name of RETIRED)
            this.references.suppress(name);
    }
    buildMonogram(centre, facing = Math.PI, scale = 1) {
        const statue = this.references.node('refStatuePhysicalDynamic');
        if (!centre || !statue)
            return;
        statue.updateWorldMatrix(true, true);
        const volume = new THREE.Box3().setFromObject(statue);
        const size = volume.getSize(new THREE.Vector3()).multiplyScalar(scale);
        const base = volume.min.y;
        const leading = 1.18;
        const capHeight = size.y / (MONOGRAM.length * leading);
        const cut = MONOGRAM.map(char => cutGlyph(char, capHeight, Math.min(size.z, capHeight * 0.42)))
            .filter((glyph) => !!glyph);
        if (cut.length !== MONOGRAM.length)
            return;
        const source = statue instanceof THREE.Mesh ? statue : statue.children.find(child => child instanceof THREE.Mesh);
        const material = source
            ? (Array.isArray(source.material) ? source.material[0] : source.material)
            : new THREE.MeshStandardMaterial({ color: '#fff2e8' });
        const uv = modalUv(source) ?? new THREE.Vector2(0.73563, 0.5);
        cut.forEach((glyph, index) => {
            paintUv(glyph.geometry, uv);
            const mesh = new THREE.Mesh(glyph.geometry, material);
            mesh.name = glyph.char;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            const row = MONOGRAM.length - 1 - index;
            const height = glyph.box.max.y - glyph.box.min.y;
            mesh.position.set(centre.x, base + row * capHeight * leading + height / 2 + capHeight * 0.09, centre.z);
            mesh.rotation.y = facing;
            this.group.add(mesh);
            this.monogram.push(mesh);
            const half = new THREE.Vector3((glyph.box.max.x - glyph.box.min.x) / 2, height / 2, (glyph.box.max.z - glyph.box.min.z) / 2);
            const physical = this.game.physics.add({
                type: 'fixed', position: mesh.position.clone(),
                rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, facing, 0)),
                colliders: [{ shape: 'cuboid', parameters: [half.x, half.y, half.z], category: 'object' }],
                friction: 0.6, restitution: 0.1, owner: `monogram-${glyph.char}`,
            });
            this.references.environment.anchor(physical);
        });
    }
    nextOnArc(centre) {
        if (!centre)
            return null;
        const seats = Object.values(ICONS)
            .map(name => this.references.node(name)?.getWorldPosition(new THREE.Vector3()))
            .filter((p) => !!p)
            .map(p => ({ angle: Math.atan2(p.z - centre.z, p.x - centre.x), radius: Math.hypot(p.x - centre.x, p.z - centre.z), y: p.y }))
            .sort((a, b) => a.angle - b.angle);
        if (!seats.length)
            return centre.clone().add(new THREE.Vector3(0, 1.6, 0));
        const radius = seats.reduce((sum, seat) => sum + seat.radius, 0) / seats.length;
        const y = seats.reduce((sum, seat) => sum + seat.y, 0) / seats.length;
        const gap = seats.length > 1 ? (seats[seats.length - 1].angle - seats[0].angle) / (seats.length - 1) : 0.5;
        const angle = seats[seats.length - 1].angle + gap;
        return new THREE.Vector3(centre.x + Math.cos(angle) * radius, y, centre.z + Math.sin(angle) * radius);
    }
    buildSign(label, value) {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 160;
        const context = canvas.getContext('2d');
        context.fillStyle = 'rgba(35,31,43,0.92)';
        context.beginPath();
        context.roundRect(6, 26, 500, 104, 26);
        context.fill();
        context.textAlign = 'center';
        context.fillStyle = '#f4f1e8';
        context.font = '700 44px ui-sans-serif, system-ui, sans-serif';
        context.fillText(label.toUpperCase(), 256, 76);
        context.fillStyle = '#9b94a8';
        context.font = '500 28px ui-monospace, SFMono-Regular, monospace';
        let text = value;
        while (context.measureText(text).width > 460 && text.length > 8)
            text = `${text.slice(0, -4)}…`;
        context.fillText(text, 256, 114);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 8;
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.59), new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
        mesh.renderOrder = 4;
        return mesh;
    }
    open(id, href) {
        this.game.audio.play('interact');
        this.game.interactions?.achievements.mark('social', id);
        if (/^mailto:/i.test(href)) {
            const anchor = document.createElement('a');
            anchor.href = href;
            anchor.rel = 'noopener noreferrer';
            anchor.click();
            return;
        }
        window.open(href, '_blank', 'noopener,noreferrer');
    }
    buildFans(prompts) {
        const pad = this.references.node('refFan');
        if (!pad)
            return;
        const home = pad.getWorldPosition(new THREE.Vector3());
        this.fans = { node: pad, home };
        prompts.create({
            label: 'Give it a spin', position: home.clone().setY(Math.max(1, home.y)), align: 'left',
            onInteract: () => {
                this.game.audio.play('blip', 0.8);
                const centre = this.fans.home;
                for (const { physical } of this.references.environment.dynamic) {
                    const at = physical.body.translation();
                    if (Math.hypot(at.x - centre.x, at.z - centre.z) > 5)
                        continue;
                    physical.body.wakeUp();
                    physical.body.applyImpulse({ x: (Math.random() - 0.5) * physical.body.mass(), y: 3.2 * physical.body.mass(), z: (Math.random() - 0.5) * physical.body.mass() }, true);
                }
            },
        });
    }
    get found() { return this.links.length; }
}
