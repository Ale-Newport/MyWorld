import * as THREE from 'three';
export const ORDER = 21;
export const AFTER_ORDER = ORDER + 1;
export const MAP_HIDDEN_LAYER = 2;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const _m = new THREE.Matrix4();
const _pv = new THREE.Matrix4();
const _frustum = new THREE.Frustum();
const _sphere = new THREE.Sphere();
const _qCam = new THREE.Quaternion();
const _qWorld = new THREE.Quaternion();
const _qLean = new THREE.Quaternion();
const _qParentInverse = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const systems = new WeakMap();
function handedness(e) {
    return e[0] * (e[5] * e[10] - e[9] * e[6]) - e[4] * (e[1] * e[10] - e[9] * e[2]) + e[8] * (e[1] * e[6] - e[5] * e[2]);
}
export class Billboards {
    static for(ticker) {
        let system = systems.get(ticker);
        if (!system) {
            system = new Billboards(ticker);
            systems.set(ticker, system);
        }
        return system;
    }
    constructor(ticker) {
        this.ticker = ticker;
        this.items = [];
        this.getCamera = null;
        this.subscribed = false;
        this.seen = new Float64Array(9);
        this.seenValid = false;
        this.tick = () => this.update();
    }
    get camera() {
        return this.getCamera?.() ?? null;
    }
    useCamera(getCamera) {
        this.getCamera = getCamera;
        this.seenValid = false;
        return this;
    }
    add(object, options = {}) {
        const o = options;
        const item = {
            object,
            mode: o.mode ?? 'spherical',
            lean: o.lean ?? 0,
            pitchFollow: o.pitchFollow ?? 0,
            maxPitch: o.maxPitch ?? 1.2,
            radius2: (o.radius ?? 120) ** 2,
            cull: o.cull ?? 0,
            moves: !!o.moves,
            scale: o.scale
                ? { ref: o.scale.ref ?? 21, min: o.scale.min ?? 1, max: o.scale.max ?? 1.6, compensate: o.scale.compensateParent !== false, base: 0 }
                : null,
            stale: true,
            enabled: true,
            removed: false,
            warned: false,
        };
        if (o.layer !== undefined)
            object.traverse((node) => { node.layers.set(o.layer); });
        this.items.push(item);
        this.subscribe();
        return {
            object,
            get enabled() { return item.enabled; },
            set enabled(value) { item.enabled = !!value; item.stale = true; },
            get cull() { return item.cull; },
            set cull(value) { item.cull = value; item.stale = true; },
            refresh() { item.stale = true; },
            remove: () => this.drop(item),
        };
    }
    drop(item) {
        if (item.removed)
            return;
        item.removed = true;
        const at = this.items.indexOf(item);
        if (at >= 0)
            this.items.splice(at, 1);
        if (!this.items.length)
            this.unsubscribe();
    }
    subscribe() {
        if (this.subscribed)
            return;
        this.ticker.events.on('tick', this.tick, ORDER);
        this.subscribed = true;
    }
    unsubscribe() {
        if (!this.subscribed)
            return;
        this.ticker.events.off('tick', this.tick);
        this.subscribed = false;
        this.seenValid = false;
    }
    update() {
        const camera = this.getCamera?.();
        if (!camera)
            return;
        const items = this.items;
        if (!items.length)
            return;
        const ce = camera.matrixWorld.elements;
        const pe = camera.projectionMatrix.elements;
        _m.extractRotation(camera.matrixWorld);
        _qCam.setFromRotationMatrix(_m);
        const s = this.seen;
        const moved = !this.seenValid
            || s[0] !== ce[12] || s[1] !== ce[13] || s[2] !== ce[14]
            || s[3] !== _qCam.x || s[4] !== _qCam.y || s[5] !== _qCam.z || s[6] !== _qCam.w
            || s[7] !== pe[0] || s[8] !== pe[5];
        if (moved) {
            s[0] = ce[12];
            s[1] = ce[13];
            s[2] = ce[14];
            s[3] = _qCam.x;
            s[4] = _qCam.y;
            s[5] = _qCam.z;
            s[6] = _qCam.w;
            s[7] = pe[0];
            s[8] = pe[5];
            this.seenValid = true;
            _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
            _frustum.setFromProjectionMatrix(_pv);
        }
        const cx = ce[12], cy = ce[13], cz = ce[14];
        let lastParent = null;
        let parentScale = 1;
        for (let i = 0; i < items.length; i++) {
            const b = items[i];
            const o = b.object;
            if (!b.enabled || !o.visible) {
                b.stale = true;
                continue;
            }
            if (!moved && !b.stale && !b.moves)
                continue;
            const p = o.parent;
            _pos.copy(o.position);
            if (p) {
                if (b.moves) {
                    p.updateWorldMatrix(true, false);
                    lastParent = null;
                }
                _pos.applyMatrix4(p.matrixWorld);
            }
            const dx = cx - _pos.x, dy = cy - _pos.y, dz = cz - _pos.z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > b.radius2) {
                b.stale = true;
                continue;
            }
            if (p && p !== lastParent) {
                const pm = p.matrixWorld;
                _m.extractRotation(pm);
                _qParentInverse.setFromRotationMatrix(_m).invert();
                const sx = pm.elements[0], sy = pm.elements[1], sz = pm.elements[2];
                parentScale = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
                lastParent = p;
                if (b.stale && !b.warned && handedness(pm.elements) < 0) {
                    b.warned = true;
                    console.warn(`[billboards] "${o.name || o.type}" sits under a mirrored (negative-scale) parent: its text will read mirrored. Un-mirror the frame.`);
                }
            }
            const frame = p ? parentScale : 1;
            const sc = b.scale;
            let local = o.scale.x;
            if (sc) {
                if (sc.base === 0)
                    sc.base = o.scale.x;
                if (sc.base > 0) {
                    let k = Math.sqrt(d2) / sc.ref;
                    if (k < sc.min)
                        k = sc.min;
                    else if (k > sc.max)
                        k = sc.max;
                    local = sc.base * k / (sc.compensate ? frame : 1);
                }
            }
            if (b.cull > 0) {
                _sphere.center.copy(_pos);
                _sphere.radius = b.cull * local * frame;
                if (!_frustum.intersectsSphere(_sphere)) {
                    b.stale = true;
                    continue;
                }
            }
            b.stale = false;
            if (b.mode !== 'sprite') {
                if (b.mode === 'spherical') {
                    _qWorld.copy(_qCam);
                }
                else {
                    _qWorld.setFromAxisAngle(Y_AXIS, Math.atan2(dx, dz));
                    let pitch = b.lean;
                    if (b.pitchFollow > 0)
                        pitch += b.pitchFollow * Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));
                    if (pitch > b.maxPitch)
                        pitch = b.maxPitch;
                    if (pitch !== 0)
                        _qWorld.multiply(_qLean.setFromAxisAngle(X_AXIS, -pitch));
                }
                if (p)
                    o.quaternion.copy(_qParentInverse).multiply(_qWorld);
                else
                    o.quaternion.copy(_qWorld);
            }
            if (sc && sc.base > 0)
                o.scale.setScalar(local);
        }
    }
}
