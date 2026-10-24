import * as THREE from 'three';
import { BOARD_FEATURED_COUNT } from '../content/projects.js';
import { resolveBoard } from '../content/boards.js';
import { EMBLEM_RECT, FACE_H, FACE_W, LINK_PLANE, emblemKindFor, paintAttribute, paintLinkStrip, paintNeighbour, paintProjectEmblem, paintProjectFace, paintTitlePlate, prefitSteps, } from './screenMotion.js';
import { BOARD_BACK, EMBLEM_SIZE, Facets, SIGN_DESIGN, SWATCH, TOKENS, Sign, SignRuntime, addBox, addTube, bindLayer, bracketGeometry, charmGeometry, clearFocusPose, collectOccluders, faceFrame, hashSeed, mergeParts, nailGeometry, measuringContext, onSignFontsLoaded, place, planeSize, ropeGeometry, signFontsLoaded, signMaterials, swatchOf, themeForProject, recolorPalette, vineGeometry, } from '../signs/index.js';
const CAMERA_OFFSET = new THREE.Vector3(4.65, 4, 4.85);
const TARGET_OFFSET = new THREE.Vector3(-3, 1.6, -4.6);
const CAMERA_DIRECTION = CAMERA_OFFSET.clone().sub(TARGET_OFFSET).normalize();
const ATTRACT_HOLD = 7;
const FLIP = 0.5;
const NEAR = 26;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const HIT_REACH = 2.5;
const HIT_BELOW_BOTTOM = 3;
const HIT_ABOVE_TOP = 1;
export function inSwitchZone(player, box) {
    const across = Math.hypot(Math.max(box.min.x - player.x, 0, player.x - box.max.x), Math.max(box.min.z - player.z, 0, player.z - box.max.z));
    return across <= HIT_REACH && player.y >= box.min.y - HIT_BELOW_BOTTOM && player.y <= box.max.y + HIT_ABOVE_TOP;
}
const SEEN = [
    [0.5, 0.5], [0.08, 0.5], [0.92, 0.5], [0.5, 0.08], [0.5, 0.92], [0.08, 0.08], [0.92, 0.08], [0.08, 0.92], [0.92, 0.92],
    [-0.06, -0.06], [1.06, -0.06], [-0.06, 1.06], [1.06, 1.06],
];
const VISIBLE_SCREEN = 4.8;
const VISIBLE_BOARD = 9.8;
const NARROW = 0.8;
const WIDE = 1.35;
export function focusFraming(ratio, fov = 25) {
    if (!(ratio > 0) || ratio >= WIDE)
        return null;
    const t = Math.min(1, Math.max(0, (ratio - NARROW) / (WIDE - NARROW)));
    const blend = t * t * (3 - 2 * t);
    const width = VISIBLE_SCREEN + (VISIBLE_BOARD - VISIBLE_SCREEN) * blend;
    return { distance: width / (2 * Math.tan((fov * Math.PI) / 360) * ratio), centred: 1 - blend };
}
export class Projects {
    constructor(game, references, bin) {
        this.game = game;
        this.references = references;
        this.state = 'closed';
        this.index = 0;
        this.group = new THREE.Group();
        this.screen = null;
        this.flips = [];
        this.pagination = [];
        this.attributes = [];
        this.prompt = null;
        this.attract = 0;
        this.transition = 0;
        this.seen = new Set();
        this.face = null;
        this.emblem = null;
        this.emblemMesh = null;
        this.frame = null;
        this.charm = null;
        this.woods = new Map();
        this.charms = new Map();
        this.woodNow = null;
        this.charmNow = null;
        this.near = false;
        this.nearAt = -1;
        this.focused = false;
        this.swapping = false;
        this.saved = null;
        this.framed = null;
        this.warmed = false;
        this.prefitQueue = [];
        this.prefitFor = -1;
        this.prefitContext = null;
        this.faceCentre = null;
        this.faceSamples = [];
        this.occluders = null;
        this.vehicle = null;
        this.metrics = {};
        this.signs = [];
        this.items = resolveBoard(game.worldBoards, 'projects');
        this.group.name = 'World2 / projects';
        this.group.userData.signDesign = SIGN_DESIGN;
        this.readerPoint = references.position('refInteractivePoint') ?? new THREE.Vector3();
        this.materials = signMaterials(references.environment.group);
        this.runtime = new SignRuntime({ ticker: game.ticker, camera: () => game.view?.camera }, bin);
        this.sign = new Sign({ id: 'projects', variant: 'custom', width: 4, height: 2.25, materials: this.materials, runtime: this.runtime });
        this.recolour();
        this.buildScreen();
        this.buildFlips();
        this.buildSigns();
        this.buildPagination();
        this.buildAttributes();
        this.hideDecals();
        this.hideForeignBadges();
        this.buildHardware();
        this.select(0, true);
        this.reveal();
        const tick = () => this.update();
        game.ticker.events.on('tick', tick, 11);
        bin.add(() => {
            game.ticker.events.off('tick', tick);
            this.focusUi?.hide();
            this.runtime.focus(null);
            this.sign.dispose();
            for (const mesh of [...this.woods.values(), ...this.charms.values()]) {
                mesh.geometry.dispose();
                mesh.removeFromParent();
            }
            this.materials.dispose();
        });
        bin.object3D(this.group);
    }
    get current() { return this.items[this.index]; }
    get previous() { return this.items[(this.index - 1 + this.items.length) % this.items.length]; }
    get next() { return this.items[(this.index + 1) % this.items.length]; }
    attachPrompt(prompt) { this.prompt = prompt; }
    get focusUi() { return this.game.focus; }
    focusSpec() {
        return {
            id: 'projects',
            index: this.index,
            total: this.items.length,
            title: this.current.title,
            canOpen: !!this.current.link,
            onExit: () => this.close(),
            onPrev: () => this.step(-1),
            onNext: () => this.step(1),
            onOpen: () => this.openLink(),
        };
    }
    get reader() { return this.readerPoint; }
    recolour() {
        const nodes = this.references.environment.nodes;
        const recolor = (name, map) => { const node = nodes.get(name); if (node instanceof THREE.Mesh)
            recolorPalette(node, map); };
        recolor('Cube.065', { [SWATCH.grey]: SWATCH.woodDark, [SWATCH.pink]: SWATCH.woodDark, [SWATCH.copper]: BOARD_BACK });
        recolor('Cube.080', { [SWATCH.copper]: SWATCH.tan });
        recolor('panel', { [SWATCH.purple]: SWATCH.woodDark });
        for (const name of ['Cube.077', 'cube.023'])
            recolor(name, { [SWATCH.grey]: SWATCH.woodDark, [SWATCH.purple]: SWATCH.gold });
        for (const name of ['refArrowNextProject', 'refArrowPreviousProject'])
            recolor(name, { [SWATCH.paleRose]: SWATCH.ink });
        recolor('medal', { [SWATCH.purple]: SWATCH.orange, [SWATCH.pink]: SWATCH.crimson });
    }
    layerFor(mesh, name, longSide, paint, priority = 0, base) {
        const { width, height } = planeSize(mesh);
        return this.sign.addLayer({ name, width: longSide, height: Math.max(8, Math.round(longSide * (height / width))), paint, priority, base });
    }
    buildScreen() {
        const node = this.references.node('refImages');
        if (!(node instanceof THREE.Mesh))
            return;
        const layer = this.layerFor(node, 'face', FACE_W, (context, width, height) => {
            this.metrics.face = paintProjectFace(context, width, height, this.current, { ready: () => layer.invalidate(), index: this.index, total: this.items.length });
        }, 10, TOKENS.paper);
        bindLayer(layer, node, this.materials, this.reader);
        this.face = layer;
        this.screen = { mesh: node, canvas: layer.canvas, texture: layer.texture };
        const frame = this.frame = faceFrame(node, layer.texture);
        const unit = frame.width / FACE_W;
        const side = EMBLEM_RECT.size * unit;
        const emblem = this.sign.addLayer({
            name: 'emblem', width: EMBLEM_SIZE, height: EMBLEM_SIZE, live: true, base: TOKENS.woodDark,
            paint: (context, width, _height, time) => paintProjectEmblem(context, width, this.current, time),
        });
        this.emblem = emblem;
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(side, side), this.materials.face(emblem.texture));
        quad.name = 'sign:projects:emblem';
        quad.receiveShadow = true;
        quad.position.set((EMBLEM_RECT.x + EMBLEM_RECT.size / 2 - FACE_W / 2) * unit, (FACE_H / 2 - (EMBLEM_RECT.y + EMBLEM_RECT.size / 2)) * unit, 0.012);
        frame.root.add(quad);
        this.emblemMesh = quad;
        this.sign.setBounds(node, new THREE.Vector3().setFromMatrixPosition(frame.matrix), 4.6);
        node.updateWorldMatrix(true, false);
        this.faceCentre = new THREE.Vector3().setFromMatrixPosition(frame.matrix).applyMatrix4(node.matrixWorld);
        this.faceSamples = SEEN.map(([a, b]) => frame.toFace(a, b).applyMatrix4(frame.matrix).applyMatrix4(node.matrixWorld));
    }
    buildFlips() {
        const make = (holder, delay, paint, narrow = 1, longSide = 1024) => {
            const group = this.references.node(holder);
            const inner = group?.children[0];
            if (!inner)
                return;
            const text = inner.children.find(child => String(child.userData.w2Source ?? child.name).startsWith('text'));
            if (!(text instanceof THREE.Mesh))
                return;
            const chip = inner.children.find(child => child !== text && child instanceof THREE.Mesh) ?? null;
            text.scale.x *= narrow;
            const layer = this.layerFor(text, holder, longSide, (context, width, height) => paint(context, width, height, chip, this.current));
            bindLayer(layer, text, this.materials, this.reader, { transparent: true });
            this.flips.push({
                inner, base: inner.quaternion.clone(), mode: 'turn', canvas: layer.canvas, texture: layer.texture, layer,
                paint: (context, project) => { context.clearRect(0, 0, layer.canvas.width, layer.canvas.height); paint(context, layer.canvas.width, layer.canvas.height, chip, project); },
                progress: 1, delay, swapped: true, pending: null,
            });
        };
        make('refTitle', 0, (context, width, height, _chip, project) => { this.metrics.title = paintTitlePlate(context, width, height, project); });
        make('refUrl', 0.07, (context, width, height, chip, project) => {
            const textWidth = paintLinkStrip(context, width, height, project);
            if (chip)
                chip.scale.x = Math.max(0.35, (textWidth / width) * LINK_PLANE + 0.2);
        }, LINK_PLANE / 4, Math.round(1024 * LINK_PLANE / 1.6));
    }
    buildSigns() {
        for (const [name, which] of [['refPrevious', 'previous'], ['refNext', 'next']]) {
            const group = this.references.node(name);
            const inner = group?.children[0];
            const text = inner?.children.find(child => String(child.userData.w2Source ?? child.name).startsWith('text'));
            if (!inner || !(text instanceof THREE.Mesh))
                continue;
            const layer = this.layerFor(text, name, 512, (context, width, height) => paintNeighbour(context, width, height, which, which === 'previous' ? this.previous : this.next));
            bindLayer(layer, text, this.materials, this.reader, { transparent: true });
            const pivot = new THREE.Group();
            pivot.name = `${text.name}:pivot`;
            pivot.position.copy(text.position);
            text.position.set(0, 0, 0);
            inner.add(pivot);
            pivot.add(text);
            this.flips.push({
                inner: pivot, base: pivot.quaternion.clone(), mode: 'card', canvas: layer.canvas, texture: layer.texture, layer,
                paint: (context, _project) => {
                    context.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
                    paintNeighbour(context, layer.canvas.width, layer.canvas.height, which, which === 'previous' ? this.previous : this.next);
                },
                progress: 1, delay: which === 'previous' ? 0.14 : 0.21, swapped: true, pending: null,
            });
            const position = group?.getWorldPosition(new THREE.Vector3());
            if (group && position) {
                group.updateWorldMatrix(true, true);
                this.signs.push({ which, position, box: new THREE.Box3().setFromObject(group), hit: false });
            }
        }
    }
    buildPagination() {
        const group = this.references.node('refPagination')?.children[0];
        if (!group)
            return;
        this.pagination = group.children.filter((child) => child instanceof THREE.Mesh);
    }
    buildAttributes() {
        const holder = this.references.node('refAttributes');
        if (!holder)
            return;
        const roles = ['category', 'year', 'stack'];
        holder.children.forEach((child, index) => {
            const text = child.children.find(node => String(node.userData.w2Source ?? node.name).startsWith('text'));
            if (!(text instanceof THREE.Mesh))
                return;
            const role = roles[Math.min(index, 2)];
            const layer = this.layerFor(text, `attribute:${role}`, 512, (context, width, height) => paintAttribute(context, width, height, role, this.current));
            bindLayer(layer, text, this.materials, this.reader, { transparent: true });
            this.attributes.push({ node: text, canvas: layer.canvas, texture: layer.texture, layer, role });
        });
    }
    hideDecals() {
        for (const name of ['refel', 'refel.001', 'refel.002', 'refel.003'])
            this.references.suppress(name);
    }
    hideForeignBadges() {
        for (const name of ['awwwards', 'fwa', 'cssda']) {
            const node = this.references.node(name);
            if (node)
                node.visible = false;
        }
    }
    buildHardware() {
        const frame = this.frame;
        if (!frame)
            return;
        const pivot = new THREE.Group();
        pivot.name = 'sign:projects:charm';
        pivot.position.set(1.5, -1.34, 0.13);
        frame.root.add(pivot);
        this.charm = pivot;
        this.sign.animate = time => { pivot.rotation.z = Math.sin(time * 1.35) * 0.09; };
    }
    woodFor(kind) {
        const frame = this.frame;
        if (!frame)
            return null;
        const known = this.woods.get(kind);
        if (known)
            return known;
        const parts = [];
        const nail = nailGeometry({ radius: 0.034, height: 0.03 });
        for (let i = 0; i < 7; i++)
            parts.push(place(nail, [-1.8 + i * 0.6, 2.04, 0.036]));
        for (const x of [-1.62, -1.2, 1.2, 1.62])
            parts.push(place(nail, [x, 1.22, 0.036]));
        for (const s of [-1, 1])
            for (const y of [-0.9, -0.3, 0.3, 0.9])
                parts.push(place(nail, [s * 2.14, y, 0.082]));
        const brace = bracketGeometry({ arm: 0.3, thickness: 0.055, depth: 0.04 });
        parts.push(place(brace, [-1.96, -1.1, 0.13], [0, 0, 0]), place(brace, [1.96, -1.1, 0.13], [0, 0, Math.PI / 2]));
        if (kind === 'vine') {
            const path = [];
            for (let i = 0; i <= 12; i++)
                path.push([-2.43 + Math.sin(i * 1.1) * 0.05, -1.7 + (i / 12) * 3.55, 0.04 + Math.cos(i * 0.8) * 0.03]);
            parts.push(place(vineGeometry(path, { radius: 0.02, leaves: 12, leafSize: 0.2, seed: hashSeed('projects') })));
        }
        else if (kind === 'rope' || kind === 'chain') {
            const chain = kind === 'chain';
            const peg = new Facets();
            addBox(peg, [0, 0, 0.04], [0.04, 0.04, 0.05], SWATCH.woodDark, 0.01);
            parts.push(place(peg.geometry(), [2.14, 1.0, 0.1]));
            const loops = new Facets();
            for (let i = 0; i < (chain ? 5 : 3); i++) {
                const ring = [];
                const radius = chain ? 0.085 : 0.15;
                for (let k = 0; k < 10; k++) {
                    const a = (k / 10) * Math.PI * 2;
                    ring.push([Math.cos(a) * radius * (chain && i % 2 ? 0.45 : 1), Math.sin(a) * radius - (chain ? i * 0.15 : i * 0.05) - radius, chain ? 0 : i * 0.035]);
                }
                addTube(loops, ring, chain ? 0.022 : 0.026, chain ? SWATCH.silver : SWATCH.khaki, 4, true);
            }
            parts.push(place(loops.geometry(), [2.14, 1.0, 0.16]));
        }
        const mesh = new THREE.Mesh(mergeParts(parts), this.materials.wood);
        mesh.name = `sign:projects:wood:${kind}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.visible = false;
        frame.root.add(mesh);
        this.woods.set(kind, mesh);
        return mesh;
    }
    charmFor(kind) {
        if (!this.charm)
            return null;
        const known = this.charms.get(kind);
        if (known)
            return known;
        const hung = mergeParts([ropeGeometry([0, 0, 0], [0, -0.16, 0], { sag: 0, sides: 4, segments: 2 }), place(charmGeometry(kind, 0.34), [0, -0.16, 0])]);
        const mesh = new THREE.Mesh(hung, this.materials.wood);
        mesh.name = `sign:projects:charm:${kind}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.visible = false;
        this.charm.add(mesh);
        this.charms.set(kind, mesh);
        return mesh;
    }
    skin() {
        if (!this.frame)
            return;
        const theme = themeForProject(this.current);
        const wood = this.woodFor(theme.hardware);
        const charm = theme.charm === 'none' ? null : this.charmFor(theme.charm);
        if (this.woodNow !== wood) {
            if (this.woodNow)
                this.woodNow.visible = false;
            if (wood)
                wood.visible = true;
            this.woodNow = wood;
        }
        if (this.charmNow !== charm) {
            if (this.charmNow)
                this.charmNow.visible = false;
            if (charm)
                charm.visible = true;
            this.charmNow = charm;
        }
    }
    select(index, silent = false) {
        const count = this.items.length;
        this.index = ((index % count) + count) % count;
        this.attract = 0;
        for (const flip of this.flips) {
            flip.progress = -flip.delay;
            flip.swapped = false;
            flip.pending = this.current;
            flip.layer.hold = true;
        }
        this.swapping = this.flips.length > 0;
        this.paintPagination();
        if (this.swapping) {
            if (this.face)
                this.face.hold = true;
            for (const attribute of this.attributes)
                attribute.layer.hold = true;
            if (this.emblem)
                this.emblem.hold = true;
        }
        else
            this.swapContent();
        this.seen.add(this.current.id);
        if (this.state === 'opening' || this.state === 'open')
            this.focusUi?.update(this.focusSpec());
        if (!silent) {
            this.game.interactions?.achievements.mark('projects', this.current.id);
            this.game.audio.play('blip', 1.3);
        }
        this.game.publishGameplay();
    }
    step(direction) { this.select(this.index + direction); }
    reveal() {
        for (const flip of this.flips) {
            flip.progress = 1;
            flip.swapped = true;
            flip.pending = null;
            flip.layer.hold = false;
            flip.layer.invalidate();
            flip.inner.quaternion.copy(flip.base);
        }
        this.swapContent();
    }
    swapContent() {
        this.swapping = false;
        if (this.face) {
            this.face.hold = false;
            this.face.invalidate();
        }
        for (const attribute of this.attributes) {
            attribute.layer.hold = false;
            attribute.layer.invalidate();
        }
        this.refreshEmblem();
        this.skin();
    }
    refreshEmblem() {
        if (!this.emblem)
            return;
        const still = !!this.current.image || !emblemKindFor(this.current);
        this.emblem.live = !still;
        this.emblem.hold = still;
        if (this.emblemMesh)
            this.emblemMesh.visible = !still;
        if (!still)
            this.emblem.invalidate();
    }
    settle() {
        this.runtime.dispose();
        if (signFontsLoaded())
            return;
        const off = onSignFontsLoaded(() => { off(); this.paintNow(); });
    }
    paintAttributes() { for (const attribute of this.attributes)
        attribute.layer.invalidate(); }
    paintPagination() {
        this.pagination.forEach((token, i) => {
            const total = Math.min(this.pagination.length, this.items.length);
            const window = Math.floor(this.index / total) * total;
            const active = this.index - window === i;
            token.visible = i < total;
            token.scale.setScalar(active ? 1 : 0.45);
            const uv = token.geometry.getAttribute('uv');
            const from = uv ? swatchOf(uv.getX(0)) : -1;
            const to = active ? SWATCH.gold : SWATCH.khaki;
            if (uv && from !== to)
                recolorPalette(token, { [from]: to });
        });
    }
    paintNow() {
        this.reveal();
        this.refreshEmblem();
        this.sign.paintNow();
    }
    open() {
        if (this.state === 'open' || this.state === 'opening')
            return;
        const point = this.references.position('refInteractivePoint');
        if (!point)
            return;
        this.state = 'opening';
        this.transition = 1.5;
        const flat = point.clone();
        flat.y = 0;
        this.frameCamera(flat);
        this.game.player.setState('locked');
        this.saved ?? (this.saved = [...this.game.inputs.filters]);
        this.game.inputs.setFilters(['minigame']);
        this.game.interactions.prompts.setSuspended(true);
        this.focusUi?.show(this.focusSpec());
        this.game.audio.play('interact');
        this.game.publishGameplay();
    }
    close() {
        if (this.state === 'closed' || this.state === 'closing')
            return;
        this.state = 'closing';
        this.transition = 1;
        this.framed = null;
        this.occluders = null;
        this.vehicle = null;
        this.game.view.endCinematic();
        const focusPoint = this.game.view.focusPoint;
        if (focusPoint)
            focusPoint.isTracking = true;
        this.game.player.setState('default');
        this.game.inputs.setFilters(this.saved ?? ['driving', 'camera']);
        this.saved = null;
        this.game.interactions.prompts.setSuspended(false);
        this.prompt?.show();
        this.focusUi?.hide();
        this.game.publishGameplay();
    }
    frameCamera(flat) {
        const view = this.game.view;
        const target = flat.clone().add(TARGET_OFFSET);
        const position = flat.clone().add(CAMERA_OFFSET);
        const ratio = view.viewport?.ratio ?? 0;
        this.framed = { flat: flat.clone(), ratio };
        const framing = ratio > 0 ? focusFraming(ratio, view.camera?.fov) : null;
        if (!framing) {
            this.game.view.startCinematic(position, target);
            this.clearTheView();
            return;
        }
        if (this.faceCentre && framing.centred > 0) {
            const slide = this.faceCentre.clone().sub(target);
            slide.addScaledVector(CAMERA_DIRECTION, -slide.dot(CAMERA_DIRECTION)).multiplyScalar(framing.centred);
            target.add(slide);
        }
        position.copy(target).addScaledVector(CAMERA_DIRECTION, framing.distance);
        this.game.view.startCinematic(position, target, { pullBack: false });
        this.clearTheView();
    }
    clearTheView() {
        const view = this.game.view;
        const cinematic = view.cinematic;
        const frame = this.group.parent;
        if (!cinematic || !frame?.parent || !this.faceSamples.length)
            return;
        this.group.updateWorldMatrix(true, false);
        const world = this.group.matrixWorld;
        const target = cinematic.target.clone();
        const position = cinematic.position.clone();
        if (!this.occluders) {
            let root = this.group;
            while (root.parent)
                root = root.parent;
            const car = this.game.visual?.group;
            const reach = position.distanceTo(target) * 1.25 + 8;
            this.occluders = collectOccluders(root, target, reach, [frame, car]);
            this.vehicle = car ? collectOccluders(car, target, reach) : [];
        }
        const result = clearFocusPose({
            target, position, occluders: this.occluders, vehicle: this.vehicle ?? [],
            samples: this.faceSamples.map(point => point.clone().applyMatrix4(world)),
            fov: view.camera?.fov ?? 25, ratio: view.viewport?.ratio ?? 1,
        });
        if (!result.moved)
            return;
        const inverse = world.clone().invert();
        this.game.view.startCinematic(result.position.applyMatrix4(inverse), target.applyMatrix4(inverse), { pullBack: false });
    }
    openLink() {
        const link = this.current.link;
        if (!link)
            return;
        window.open(link, '_blank', 'noopener,noreferrer');
    }
    update() {
        const delta = this.game.ticker.delta * this.game.ticker.scale;
        const time = this.game.ticker.elapsed;
        if (this.transition > 0) {
            this.transition -= delta;
            if (this.transition <= 0) {
                const opened = this.state === 'opening';
                this.state = opened ? 'open' : 'closed';
                if (opened)
                    this.game.interactions?.achievements.mark('projects', this.current.id);
            }
        }
        const focused = this.state !== 'closed';
        if (focused !== this.focused) {
            this.focused = focused;
            this.runtime.focus(focused ? this.sign : null);
        }
        for (const flip of this.flips) {
            if (flip.progress >= 1)
                continue;
            flip.progress = Math.min(1, flip.progress + delta / (FLIP * 2));
            const p = Math.max(0, flip.progress);
            if (flip.mode === 'turn')
                flip.inner.quaternion.copy(flip.base).multiply(TURN.setFromAxisAngle(Y_AXIS, p * Math.PI * 2));
            else {
                const angle = p < 0.5 ? p * Math.PI : -Math.PI / 2 + (p - 0.5) * Math.PI;
                flip.inner.quaternion.copy(flip.base).multiply(TURN.setFromAxisAngle(Y_AXIS, angle));
            }
            if (!flip.swapped && flip.progress >= 0.5) {
                flip.swapped = true;
                flip.layer.hold = false;
                flip.layer.invalidate();
                if (this.swapping && flip === this.flips[0])
                    this.swapContent();
            }
            if (flip.progress >= 1)
                flip.inner.quaternion.copy(flip.base);
        }
        if (time - this.nearAt > 0.25) {
            this.nearAt = time;
            this.near = this.nearby();
        }
        if (this.near && !this.warmed) {
            this.warmed = true;
            this.focusUi?.warm?.();
        }
        if (this.framed && (this.state === 'opening' || this.state === 'open')) {
            const ratio = this.game.view.viewport?.ratio ?? 0;
            if (ratio > 0 && Math.abs(ratio - this.framed.ratio) > 0.02)
                this.frameCamera(this.framed.flat);
        }
        if ((this.near || this.state !== 'closed') && !this.swapping)
            this.prefit();
        if (this.state === 'closed' && this.near) {
            this.attract += delta;
            if (this.attract > ATTRACT_HOLD) {
                const featured = Math.max(1, BOARD_FEATURED_COUNT);
                this.select(this.index < featured ? (this.index + 1) % featured : 0, true);
            }
        }
        if (this.state === 'closed' && this.near) {
            const player = this.game.player.position;
            for (const sign of this.signs) {
                if (!inSwitchZone(player, sign.box)) {
                    sign.hit = false;
                    continue;
                }
                if (sign.hit)
                    continue;
                sign.hit = true;
                this.step(sign.which === 'next' ? 1 : -1);
            }
        }
    }
    prefit() {
        if (this.prefitFor !== this.index) {
            this.prefitFor = this.index;
            this.prefitQueue = this.prefitPlan();
        }
        if (!this.prefitQueue.length)
            return;
        for (const layer of this.sign.layers)
            if (layer.dirty && !layer.hold)
                return;
        for (const flip of this.flips)
            if (flip.progress < 1)
                return;
        this.prefitContext ?? (this.prefitContext = measuringContext(document.createElement('canvas').getContext('2d')));
        this.prefitQueue.shift()(this.prefitContext);
    }
    prefitPlan() {
        const count = this.items.length;
        const featured = Math.max(1, BOARD_FEATURED_COUNT);
        const size = (name) => {
            const layer = this.flips.find(flip => flip.layer.name === name)?.layer ?? this.attributes.find(attribute => attribute.layer.name === name)?.layer;
            return layer ? [layer.canvas.width, layer.canvas.height] : undefined;
        };
        const sizes = {
            title: size('refTitle'), link: size('refUrl'), previous: size('refPrevious'), next: size('refNext'),
            category: size('attribute:category'), year: size('attribute:year'), stack: size('attribute:stack'),
        };
        const next = [this.index < featured ? (this.index + 1) % featured : 0, (this.index + 1) % count, (this.index - 1 + count) % count]
            .filter((at, i, all) => at !== this.index && all.indexOf(at) === i);
        const queued = new Set();
        const steps = next.flatMap(at => this.hardwareSteps(this.items[at], queued));
        for (const at of next)
            steps.push(...prefitSteps(this.items[at], this.items[(at - 1 + count) % count], this.items[(at + 1) % count], sizes));
        return steps;
    }
    hardwareSteps(project, queued) {
        const { hardware, charm } = themeForProject(project);
        const steps = [];
        if (!this.woods.has(hardware) && !queued.has(`wood:${hardware}`)) {
            queued.add(`wood:${hardware}`);
            steps.push(() => { this.woodFor(hardware); });
        }
        if (charm !== 'none' && !this.charms.has(charm) && !queued.has(`charm:${charm}`)) {
            queued.add(`charm:${charm}`);
            steps.push(() => { this.charmFor(charm); });
        }
        return steps;
    }
    nearby() {
        return this.game.player.position.distanceTo(this.readerPoint) < NEAR;
    }
    hud() {
        if (this.state === 'closed')
            return { activity: null, headline: null, lines: [] };
        return {
            activity: 'projects',
            headline: null,
            lines: [`${this.index + 1} / ${this.items.length}`, this.current.title, this.current.link ? 'Open to visit' : 'Private source'],
        };
    }
}
const TURN = new THREE.Quaternion();
