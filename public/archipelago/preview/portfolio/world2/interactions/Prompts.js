import * as THREE from 'three';
import { easing } from '../../world/core/Tween.js';
import { AFTER_ORDER, Billboards } from './Billboards.js';
const RADIUS = 2.5;
const MOVE_GATE = 0.2;
const CANVAS_HEIGHT = 64;
const PAD_NEAR = 60;
const PAD_FAR = 12;
const LABEL_HEIGHT = 0.75;
const CAP_HEIGHT = 0.37;
const REACH = 0.75;
const FIT_MARGIN_PX = 10;
const FIT_SWAP_PX = 8;
const FIT_HUD_CLEAR_PX = 8;
const FIT_HUD_POLL = 0.25;
const FIT_HUD_SLACK_PX = 4;
const FIT_HUD_IDS = ['touch-controls', 'drive-hud'];
const FIT_BUTTON_ID = 'interact-action';
const FIT_BAR_ID = 'player-nav';
const FIT_SNAP_FRAMES = 3;
const FIT_PHONE_WIDTH = 600;
const FIT_MIN_CAP_PX = 12.5;
const FIT_SWAP_RATE = 18;
const FIT_MAX_SHIFT = 1.2;
const FIT_PULL = 11;
const FIT_PULL_SLIDE = 0.05;
class PageControls {
    constructor() {
        this.rects = FIT_HUD_IDS.map(() => emptyKeepOut());
        this.button = emptyKeepOut();
        this.keepOuts = [this.button, ...this.rects];
        this.ceiling = 1;
        this.at = -Infinity;
        this.seenWidth = -1;
        this.seenHeight = -1;
        this.bar = emptyKeepOut();
    }
    measure(now, width, height) {
        this.at = now;
        this.seenWidth = width;
        this.seenHeight = height;
        const canvas = document.getElementById('world')?.getBoundingClientRect();
        const left = canvas?.left ?? 0;
        const top = canvas?.top ?? 0;
        const wide = canvas && canvas.width > 0 ? canvas.width : width;
        const high = canvas && canvas.height > 0 ? canvas.height : height;
        for (let i = 0; i < FIT_HUD_IDS.length; i++)
            this.read(FIT_HUD_IDS[i], this.rects[i], left, top, wide, high);
        this.read(FIT_BUTTON_ID, this.button, left, top, wide, high);
        this.read(FIT_BAR_ID, this.bar, left, top, wide, high);
        const margin = 1 - (2 * FIT_MARGIN_PX) / high;
        this.ceiling = this.bar.x0 < this.bar.x1 && this.bar.y0 < margin ? this.bar.y0 : margin;
    }
    read(id, out, left, top, width, height) {
        const box = document.getElementById(id)?.getBoundingClientRect();
        if (box && box.width > 0 && box.height > 0) {
            out.x0 = ((box.left - left - FIT_HUD_CLEAR_PX) / width) * 2 - 1;
            out.x1 = ((box.right - left + FIT_HUD_CLEAR_PX) / width) * 2 - 1;
            out.y1 = 1 - ((box.top - top - FIT_HUD_CLEAR_PX) / height) * 2;
            out.y0 = 1 - ((box.bottom - top + FIT_HUD_CLEAR_PX) / height) * 2;
        }
        else {
            out.x0 = 2;
            out.y0 = 2;
            out.x1 = -2;
            out.y1 = -2;
        }
    }
}
export function keepOut(x0, y0, x1, y1) {
    const out = { x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5 };
    out.x0 = x0;
    out.y0 = y0;
    out.x1 = x1;
    out.y1 = y1;
    return out;
}
function emptyKeepOut() {
    return keepOut(2, 2, -2, -2);
}
export function fitState() {
    const job = {
        anchor: 0.5, k: 0.5, body: 0.5, ownLeft: false, lo: 0.5, hi: 0.5, floor: 0.5, swap: 0.5, shift: 0.5, own: 0.5, other: 0.5, scale: 0.5, flipped: false,
    };
    job.anchor = 0;
    job.k = 0;
    job.body = 0;
    job.lo = -1;
    job.hi = 1;
    job.floor = 1;
    job.swap = 0;
    job.shift = 0;
    job.own = 0;
    job.other = 0;
    job.scale = 1;
    return job;
}
function overflow(anchor, body, reach, left, lo, hi) {
    const a = anchor - (left ? body : reach);
    const b = anchor + (left ? reach : body);
    if (left)
        return a < lo ? lo - a : b > hi ? hi - b : 0;
    return b > hi ? hi - b : a < lo ? lo - a : 0;
}
export function fitPrompt(out) {
    const anchor = out.anchor;
    const k = out.k;
    const ownLeft = out.ownLeft;
    const lo = out.lo;
    const hi = out.hi;
    const floor = out.floor;
    const swap = out.swap;
    const w = out.body * k;
    const d = REACH * k;
    let scale = (hi - lo) / (w + d);
    if (scale > 1)
        scale = 1;
    const least = floor < 1 ? floor : 1;
    if (scale < least)
        scale = least;
    const own = overflow(anchor, scale * w, scale * d, ownLeft, lo, hi);
    const other = overflow(anchor, scale * w, scale * d, !ownLeft, lo, hi);
    const ownCost = own < 0 ? -own : own;
    const otherCost = other < 0 ? -other : other;
    if (ownCost < 1e-9)
        out.flipped = false;
    else if (out.flipped ? ownCost + swap < otherCost : otherCost + swap < ownCost)
        out.flipped = !out.flipped;
    out.own = (own > FIT_MAX_SHIFT ? FIT_MAX_SHIFT : own < -FIT_MAX_SHIFT ? -FIT_MAX_SHIFT : own) / k;
    out.other = (other > FIT_MAX_SHIFT ? FIT_MAX_SHIFT : other < -FIT_MAX_SHIFT ? -FIT_MAX_SHIFT : other) / k;
    out.shift = out.flipped ? out.other : out.own;
    out.scale = scale;
    return out;
}
export function liftJob() {
    const job = { x0: 0.5, x1: 0.5, centre: 0.5, half: 0.5, head: 0.5, ceiling: 0.5, count: 0, slack: 0.5, rise: 0.5 };
    job.x0 = 0;
    job.x1 = 0;
    job.centre = 0;
    job.half = 0;
    job.head = 0;
    job.ceiling = 1;
    job.slack = 0;
    job.rise = 0;
    return job;
}
export function liftClear(job, keepOuts) {
    const x0 = job.x0;
    const x1 = job.x1;
    const half = job.half;
    const slack = job.slack;
    const count = job.count;
    let rise = 0;
    for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < count; i++) {
            const o = keepOuts[i];
            const near = i === 0 ? 0 : slack;
            const c = job.centre + rise;
            if (x1 - near > o.x0 && x0 + near < o.x1 && c + half > o.y0 && c - half < o.y1)
                rise += o.y1 - (c - half);
        }
    }
    const room = job.ceiling - (job.centre + job.head);
    job.rise = rise < room ? rise : room > 0 ? room : 0;
    return job;
}
const DIAMOND_VERTEX = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const DIAMOND_FRAGMENT = `
uniform float threshold;
uniform float lineThickness;
uniform float lineOffset;
uniform vec3 backColor;
uniform vec3 frontColor;
varying vec2 vUv;
void main() {
  float d = max(abs(vUv.x - 0.5), abs(vUv.y - 0.5)) * 2.0;
  if (d > threshold) discard;
  float band = abs(threshold - d - lineOffset);
  float line = step(band, lineThickness * 0.5);
  gl_FragColor = vec4(mix(backColor, frontColor, line), 1.0);
}
`;
const LABEL_FRAGMENT = `
uniform sampler2D map;
uniform float labelOffset;
uniform float labelShift;
uniform vec3 backColor;
uniform vec3 frontColor;
varying vec2 vUv;
void main() {
  float x = vUv.x - labelOffset;
  if (x > 1.0 || x < 0.0) discard;
  // labelShift slides the type along the plate (the padding for the diamond moves to the other end); the canvas edge is plain background.
  float text = texture2D(map, vec2(x - labelShift, vUv.y)).r;
  gl_FragColor = vec4(mix(backColor, frontColor, text), 1.0);
}
`;
const BACK = new THREE.Color('#251f2b');
const FRONT = new THREE.Color('#ffffff');
function keyTexture(kind) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d');
    context.fillStyle = '#000000';
    context.fillRect(0, 0, 128, 128);
    context.strokeStyle = context.fillStyle = '#ffffff';
    context.lineWidth = 9;
    context.lineJoin = context.lineCap = 'round';
    if (kind === 'gamepad') {
        context.beginPath();
        context.arc(64, 64, 38, 0, Math.PI * 2);
        context.stroke();
        context.font = '700 46px system-ui, sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText('A', 64, 68);
    }
    else {
        context.beginPath();
        context.moveTo(94, 34);
        context.lineTo(94, 82);
        context.lineTo(38, 82);
        context.stroke();
        context.beginPath();
        context.moveTo(58, 62);
        context.lineTo(36, 82);
        context.lineTo(58, 102);
        context.closePath();
        context.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    return texture;
}
export class Prompts {
    constructor(ticker, tweens, inputs, bin, playerPosition) {
        this.ticker = ticker;
        this.tweens = tweens;
        this.inputs = inputs;
        this.bin = bin;
        this.playerPosition = playerPosition;
        this.items = [];
        this.plane = new THREE.PlaneGeometry(2, 2);
        this.labelGeometry = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0);
        this.last = new THREE.Vector2(Infinity, Infinity);
        this.active = null;
        this.needsTest = true;
        this.suspended = false;
        this.fitPull = FIT_PULL;
        this.fitOn = true;
        this.decision = fitState();
        this.rising = liftJob();
        this.group = new THREE.Group();
        this.group.name = 'World2 / prompts';
        this.billboards = Billboards.for(ticker);
        this.controls = new PageControls();
        this.keyTextures = { keyboard: keyTexture('keyboard'), gamepad: keyTexture('gamepad') };
        this.keyIcon = new THREE.Mesh(this.plane, new THREE.ShaderMaterial({
            transparent: true,
            depthTest: false,
            uniforms: { map: { value: this.keyTextures.keyboard }, frontColor: { value: FRONT } },
            vertexShader: DIAMOND_VERTEX,
            fragmentShader: `
        uniform sampler2D map; uniform vec3 frontColor; varying vec2 vUv;
        void main() {
          float a = texture2D(map, vUv).r;
          if (a < 0.5) discard;
          gl_FragColor = vec4(frontColor, 1.0);
        }`,
        }));
        this.keyIcon.renderOrder = 8;
        this.keyIcon.position.z = 0.01;
        this.keyIcon.scale.setScalar(0);
        this.keyIcon.visible = false;
        const tick = () => this.update();
        ticker.events.on('tick', tick, 9);
        const fit = () => this.fit();
        ticker.events.on('tick', fit, AFTER_ORDER);
        bin.add(() => {
            ticker.events.off('tick', tick);
            ticker.events.off('tick', fit);
            for (const item of [...this.items])
                this.remove(item);
            this.plane.dispose();
            this.labelGeometry.dispose();
            this.keyIcon.material.dispose();
            this.keyTextures.keyboard.dispose();
            this.keyTextures.gamepad.dispose();
        });
        bin.object3D(this.group);
    }
    refreshKeyIcon() {
        const mode = this.inputs.mode;
        if (mode === 'touch') {
            this.keyIcon.visible = false;
            return;
        }
        this.keyIcon.material.uniforms.map.value = this.keyTextures[mode === 'gamepad' ? 'gamepad' : 'keyboard'];
    }
    paint(item) {
        const context = item.canvas.getContext('2d');
        const height = CANVAS_HEIGHT;
        const paddingLeft = item.align === 'left' ? PAD_NEAR : PAD_FAR;
        const paddingRight = item.align === 'left' ? PAD_FAR : PAD_NEAR;
        item.textStart = paddingLeft;
        const font = '700 44px ui-sans-serif, system-ui, sans-serif';
        context.font = font;
        const width = Math.ceil(context.measureText(item.label).width) + paddingLeft + paddingRight;
        item.canvas.width = width;
        item.canvas.height = height;
        context.font = font;
        context.fillStyle = '#000000';
        context.fillRect(0, 0, width, height);
        context.fillStyle = '#ffffff';
        context.textBaseline = 'middle';
        context.fillText(item.label, paddingLeft, height / 2 + 2);
        item.texture.needsUpdate = true;
        item.labelMesh.scale.x = LABEL_HEIGHT * width / height;
        item.labelMesh.scale.y = LABEL_HEIGHT;
        this.lay(item);
        item.billboard.cull = Math.max(1.5, item.labelMesh.scale.x) + 0.5;
    }
    get fitting() {
        return this.fitOn;
    }
    set fitting(on) {
        this.fitOn = on;
        if (on)
            return;
        for (const item of this.items) {
            item.fit.position.set(0, 0, 0);
            item.fit.scale.setScalar(1);
            item.left = item.align === 'right' ? 1 : 0;
            item.flipped = false;
            item.swap = 0;
            item.pull = 0;
            item.lift = 0;
            item.snap = FIT_SNAP_FRAMES;
            this.lay(item);
        }
    }
    lay(item) {
        const mesh = item.labelMesh;
        mesh.position.x = -mesh.scale.x * item.left;
        const uniform = mesh.material.uniforms.labelShift;
        const shift = (PAD_NEAR - (PAD_NEAR - PAD_FAR) * item.left - item.textStart) / item.canvas.width;
        if (uniform.value !== shift)
            uniform.value = shift;
    }
    fit() {
        const item = this.active;
        if (!this.fitOn || !item || item.state !== 'open')
            return;
        const camera = this.billboards.camera;
        if (!camera)
            return;
        const group = item.group;
        const at = group.position;
        const pm = this.group.matrixWorld.elements;
        const x = pm[0] * at.x + pm[4] * at.y + pm[8] * at.z + pm[12];
        const y = pm[1] * at.x + pm[5] * at.y + pm[9] * at.z + pm[13];
        const z = pm[2] * at.x + pm[6] * at.y + pm[10] * at.z + pm[14];
        const me = camera.matrixWorldInverse.elements;
        const pe = camera.projectionMatrix.elements;
        const depth = -(me[2] * x + me[6] * y + me[10] * z + me[14]);
        if (!(depth > 0.5))
            return;
        const worldScale = group.scale.x * Math.sqrt(pm[0] * pm[0] + pm[1] * pm[1] + pm[2] * pm[2]);
        const width = typeof innerWidth === 'number' && innerWidth > 0 ? innerWidth : 1280;
        const height = typeof innerHeight === 'number' && innerHeight > 0 ? innerHeight : 800;
        const sideways = me[0] * x + me[4] * y + me[8] * z + me[12];
        const upwards = me[1] * x + me[5] * y + me[9] * z + me[13];
        const k = (pe[0] * worldScale) / depth;
        const ky = (pe[5] * worldScale) / depth;
        const anchor = (pe[0] * sideways) / depth;
        const strip = REACH * ky;
        const centre = (pe[5] * upwards) / depth;
        const safe = 1 - (2 * FIT_MARGIN_PX) / width;
        let lo = -safe;
        let hi = safe;
        const snap = item.snap > 0;
        if (snap)
            item.snap--;
        const controls = this.controls;
        const clock = this.ticker.elapsed;
        if (typeof document !== 'undefined' && (snap || !(clock - controls.at < FIT_HUD_POLL) || width !== controls.seenWidth || height !== controls.seenHeight))
            controls.measure(clock, width, height);
        const rects = controls.rects;
        for (let i = 0; i < rects.length; i++) {
            const o = rects[i];
            if (o.x0 >= o.x1 || o.y0 > centre + strip || o.y1 < centre - strip)
                continue;
            if (o.x0 + o.x1 > 0) {
                if (o.x0 < hi)
                    hi = o.x0;
            }
            else if (o.x1 > lo)
                lo = o.x1;
        }
        const capPx = (CAP_HEIGHT * worldScale * 0.5 * height * pe[5]) / depth;
        const floor = FIT_MIN_CAP_PX / capPx;
        const blocked = hi - lo < (item.labelMesh.scale.x + REACH) * k * (floor < 1 ? floor : 1);
        if (blocked) {
            lo = -safe;
            hi = safe;
        }
        const decision = this.decision;
        decision.anchor = anchor;
        decision.k = k;
        decision.body = item.labelMesh.scale.x;
        decision.ownLeft = item.align === 'right';
        decision.lo = lo;
        decision.hi = hi;
        decision.floor = floor;
        decision.swap = (2 * FIT_SWAP_PX) / width;
        decision.flipped = item.flipped;
        fitPrompt(decision);
        item.flipped = decision.flipped;
        const ease = 1 - Math.exp(-FIT_SWAP_RATE * (this.ticker.delta || 1 / 60));
        const swapTo = item.flipped ? 1 : 0;
        if (snap)
            item.swap = swapTo;
        else {
            item.swap += (swapTo - item.swap) * ease;
            if (Math.abs(swapTo - item.swap) < 0.002)
                item.swap = swapTo;
        }
        const ownLeft = item.align === 'right' ? 1 : 0;
        item.left = ownLeft + (1 - 2 * ownLeft) * item.swap;
        const shift = decision.own + (decision.other - decision.own) * item.swap;
        const scale = decision.scale;
        const body = scale * k * item.labelMesh.scale.x;
        const bx = anchor + shift * k;
        const keepOuts = controls.keepOuts;
        const rising = this.rising;
        rising.x0 = bx - body * item.left;
        rising.x1 = bx + body * (1 - item.left);
        rising.centre = centre;
        rising.half = scale * ky * (LABEL_HEIGHT / 2);
        rising.head = scale * ky * REACH;
        rising.ceiling = controls.ceiling;
        rising.count = blocked ? keepOuts.length : 1;
        rising.slack = (2 * FIT_HUD_SLACK_PX) / width;
        liftClear(rising, keepOuts);
        const liftTo = rising.rise / ky;
        if (snap)
            item.lift = liftTo;
        else {
            item.lift += (liftTo - item.lift) * ease;
            if (Math.abs(liftTo - item.lift) < 0.002)
                item.lift = liftTo;
        }
        let moved = Math.abs(shift * k);
        const raised = Math.abs(item.lift * ky);
        if (raised > moved)
            moved = raised;
        let pull = item.swap > 0 || scale < 1 || (width < FIT_PHONE_WIDTH && height > width) ? 1 : moved / FIT_PULL_SLIDE;
        if (pull > 1)
            pull = 1;
        if (snap)
            item.pull = pull;
        else
            item.pull += (pull - item.pull) * ease;
        const f = (item.pull * this.fitPull) / Math.sqrt(sideways * sideways + upwards * upwards + depth * depth);
        const pivot = item.fit;
        pivot.position.x = ((1 - f) * shift) - (f * sideways) / worldScale;
        pivot.position.y = ((1 - f) * item.lift) - (f * upwards) / worldScale;
        pivot.position.z = (f * depth) / worldScale;
        pivot.scale.x = pivot.scale.y = pivot.scale.z = (1 - f) * scale;
        this.lay(item);
    }
    create(options) {
        const align = options.align ?? 'right';
        const group = new THREE.Group();
        group.rotation.order = 'YXZ';
        group.rotation.set(-Math.PI * 0.15, Math.PI * 0.25, 0);
        group.position.copy(options.position);
        group.scale.setScalar(0.85);
        this.group.add(group);
        const billboard = Billboards.for(this.ticker).add(group, {
            mode: 'spherical', radius: 250, cull: 10,
            scale: { ref: 31, min: 1, max: 1.8, compensateParent: true },
        });
        const diamond = new THREE.Mesh(this.plane, new THREE.ShaderMaterial({
            transparent: true,
            uniforms: {
                threshold: { value: 0 }, lineThickness: { value: 0.15 }, lineOffset: { value: 0.175 },
                backColor: { value: BACK }, frontColor: { value: FRONT },
            },
            vertexShader: DIAMOND_VERTEX,
            fragmentShader: DIAMOND_FRAGMENT,
        }));
        diamond.renderOrder = 7;
        diamond.rotation.z = Math.PI * 0.25;
        diamond.visible = false;
        const fit = new THREE.Group();
        fit.name = 'prompt fit';
        group.add(fit);
        fit.add(diamond);
        const canvas = document.createElement('canvas');
        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        const labelMesh = new THREE.Mesh(this.labelGeometry, new THREE.ShaderMaterial({
            transparent: true,
            uniforms: { map: { value: texture }, labelOffset: { value: 1 }, labelShift: { value: 0 }, backColor: { value: BACK }, frontColor: { value: FRONT } },
            vertexShader: DIAMOND_VERTEX,
            fragmentShader: LABEL_FRAGMENT,
        }));
        labelMesh.renderOrder = 6;
        labelMesh.position.z = -0.01;
        labelMesh.visible = false;
        fit.add(labelMesh);
        const item = {
            label: options.label, align, at: new THREE.Vector2(options.position.x, options.position.z),
            group, billboard, fit, textStart: PAD_FAR, left: align === 'right' ? 1 : 0, flipped: false, swap: 0, pull: 0, lift: 0, snap: FIT_SNAP_FRAMES,
            diamond, labelMesh, texture, canvas,
            state: 'hidden', isIn: false, requestedHidden: options.startHidden ?? false,
            onInteract: options.onInteract, destroyed: false,
        };
        this.paint(item);
        this.items.push(item);
        this.needsTest = true;
        return {
            get label() { return item.label; },
            get open() { return item.state === 'open'; },
            setLabel: (label) => { item.label = label; this.paint(item); },
            show: () => { item.requestedHidden = false; this.needsTest = true; },
            hide: () => { item.requestedHidden = true; this.hide(item); },
            destroy: () => this.remove(item),
        };
    }
    setSuspended(suspended) {
        if (this.suspended === suspended)
            return;
        this.suspended = suspended;
        if (suspended)
            for (const item of this.items)
                this.hide(item);
        this.needsTest = true;
    }
    remove(item) {
        if (item.destroyed)
            return;
        item.destroyed = true;
        if (this.active === item)
            this.active = null;
        const index = this.items.indexOf(item);
        if (index >= 0)
            this.items.splice(index, 1);
        this.tweens.killOf(item.diamond.material.uniforms.threshold);
        item.billboard.remove();
        item.group.removeFromParent();
        item.diamond.material.dispose();
        item.labelMesh.material.dispose();
        item.texture.dispose();
    }
    uniforms(item) {
        return {
            threshold: item.diamond.material.uniforms.threshold,
            lineThickness: item.diamond.material.uniforms.lineThickness,
            lineOffset: item.diamond.material.uniforms.lineOffset,
            labelOffset: item.labelMesh.material.uniforms.labelOffset,
        };
    }
    reveal(item) {
        if (item.state === 'open')
            return;
        item.state = 'open';
        item.snap = FIT_SNAP_FRAMES;
        item.diamond.visible = true;
        item.labelMesh.visible = true;
        item.fit.add(this.keyIcon);
        const u = this.uniforms(item);
        this.tweens.to(u.threshold, { value: 0.5 }, { duration: 1.5, ease: easing.elasticOut, overwrite: true });
        this.tweens.to(u.lineThickness, { value: 0.075 }, { duration: 1.5, ease: easing.elasticOut, overwrite: true });
        this.tweens.to(u.lineOffset, { value: 0.15 }, { duration: 1.5, ease: easing.elasticOut, overwrite: true });
        this.tweens.to(u.labelOffset, { value: 0 }, { duration: 0.6, delay: 0.2, ease: easing.power2Out, overwrite: true });
        this.refreshKeyIcon();
        if (this.inputs.mode !== 'touch') {
            this.keyIcon.visible = true;
            this.keyIcon.scale.setScalar(0);
            this.tweens.to(this.keyIcon.scale, { x: 0.25, y: 0.25, z: 0.25 }, { duration: 1.5, delay: 0.6, ease: easing.elasticOut, overwrite: true });
        }
    }
    conceal(item) {
        if (item.state === 'concealed')
            return;
        const wasHidden = item.state === 'hidden';
        item.state = 'concealed';
        item.diamond.visible = true;
        const ease = wasHidden ? easing.power2Out : easing.power2In;
        const u = this.uniforms(item);
        this.tweens.to(u.threshold, { value: 0.25 }, { duration: 0.6, delay: 0.2, ease, overwrite: true });
        this.tweens.to(u.lineThickness, { value: 0.15 }, { duration: 0.6, delay: 0.2, ease, overwrite: true });
        this.tweens.to(u.lineOffset, { value: 0.175 }, { duration: 0.6, delay: 0.2, ease, overwrite: true, onComplete: () => { item.labelMesh.visible = false; } });
        this.tweens.to(u.labelOffset, { value: 1 }, { duration: 0.6, ease: easing.power2In, overwrite: true });
        if (this.active === item)
            this.dropKeyIcon();
    }
    hide(item) {
        if (item.state === 'hidden')
            return;
        item.state = 'hidden';
        item.isIn = false;
        if (this.active === item) {
            this.active = null;
            this.dropKeyIcon();
        }
        const u = this.uniforms(item);
        this.tweens.to(u.threshold, { value: 0 }, { duration: 0.6, ease: easing.power2In, overwrite: true });
        this.tweens.to(u.lineThickness, { value: 0.15 }, { duration: 0.6, ease: easing.power2In, overwrite: true });
        this.tweens.to(u.lineOffset, { value: 0.175 }, {
            duration: 0.6, ease: easing.power2In, overwrite: true,
            onComplete: () => { item.diamond.visible = false; item.labelMesh.visible = false; },
        });
        this.tweens.to(u.labelOffset, { value: 1 }, { duration: 0.6, ease: easing.power2In, overwrite: true });
    }
    dropKeyIcon() {
        this.tweens.to(this.keyIcon.scale, { x: 0, y: 0, z: 0 }, {
            duration: 0.6, ease: easing.power2In, overwrite: true,
            onComplete: () => { this.keyIcon.visible = false; },
        });
    }
    interact(item) {
        const threshold = item.diamond.material.uniforms.threshold;
        this.tweens.to(threshold, { value: 0.6 }, {
            duration: 0.1, ease: easing.power2Out, overwrite: true,
            onComplete: () => this.tweens.to(threshold, { value: 0.5 }, { duration: 1.5, ease: easing.elasticOut, overwrite: true }),
        });
        item.onInteract();
    }
    interactActive() {
        if (!this.active || this.active.state !== 'open')
            return false;
        this.interact(this.active);
        return true;
    }
    get activeLabel() {
        return this.active && this.active.state === 'open' ? this.active.label : null;
    }
    update() {
        const position = this.playerPosition();
        const travelled = Math.hypot(this.last.x - position.x, this.last.y - position.z);
        if (travelled <= MOVE_GATE && !this.needsTest)
            return;
        this.needsTest = false;
        this.last.set(position.x, position.z);
        let nearest = null;
        let nearestDistance = Infinity;
        for (const item of this.items) {
            if (item.requestedHidden || this.suspended) {
                this.hide(item);
                continue;
            }
            const distance = Math.hypot(item.at.x - position.x, item.at.y - position.z);
            const isIn = distance < RADIUS;
            if (isIn && distance < nearestDistance) {
                nearest = item;
                nearestDistance = distance;
            }
            if (!isIn && item.isIn) {
                item.isIn = false;
                if (item.state !== 'hidden')
                    this.conceal(item);
            }
            else if (!isIn && item.state === 'hidden')
                this.conceal(item);
        }
        if (nearest) {
            if (this.active && this.active !== nearest) {
                this.active.isIn = false;
                this.conceal(this.active);
            }
            this.active = nearest;
            nearest.isIn = true;
            this.reveal(nearest);
        }
        else if (this.active) {
            this.conceal(this.active);
            this.active = null;
        }
    }
}
