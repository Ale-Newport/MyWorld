import * as THREE from 'three';
import { WORLD2_ACHIEVEMENTS, WORLD2_ACHIEVEMENT_BY_ID } from '../content/achievements.js';
import { AchievementsPlaza } from './AchievementsPlaza.js';
import { U } from './PlazaLayout.js';
/* ============================================================
   PORTED FROM: sources/Game/Achievements.js and
   sources/Game/World/Areas/AchievementsArea.js
   folio-2025 — Copyright (c) 2025 Bruno Simon — MIT
   See THIRD_PARTY_NOTICES.md.

   Two kinds of progress, as upstream: a counter, or a SET of ids
   so the same crate cannot be counted twice. Progress is per
   browser; there is no account and no backend.

   The display is upstream's idea: a ring of medals around the
   authored `refPillar` in the achievements area, lit as each award
   is earned. It is built for THIS camera, though: 31 round
   medallions (0.55 m) that turn to face it, hung in one tier per
   award group (driving, places, games, mischief) on the side of the
   pillar the player drives up, slate when locked, gold when earned,
   and they pop when one is won. One deviation — upstream assigns
   progress, which lets a careless caller move it backwards; `set`
   here takes the maximum.

   TWO INSTANCES. /world builds this class twice: the MANAGER
   (world2-gameplay.js, no references) receives every unlock, and the
   plaza's own controller (with the pillar) owns the medals. The manager
   tells its listeners (`onChange`) when an award flips or the progress
   is reset; the plaza controller follows it (`follow`) and repaints.
   ============================================================ */
const STORAGE = 'helloworld-world2-achievements-v1';
/* ------------------------------------------------------------ the medals -- */
const MEDAL = {
    locked: new THREE.Color('#575a5e'),
    earned: new THREE.Color('#e4a90c'),
    /** The palette's own copper, sage, sky and purple: one hue per award group. */
    tint: { driving: new THREE.Color('#b36d45'), places: new THREE.Color('#91ad78'), games: new THREE.Color('#3dbbe7'), mischief: new THREE.Color('#c365ef') },
    tintMix: 0.42,
};
/** One tier per group, bottom to top: [group, height above the ground, distance from the pillar's axis], in metres. */
const TIERS = [['driving', 1.15, 3.5], ['places', 1.95, 3.2], ['games', 2.75, 2.9], ['mischief', 3.55, 2.6]];
/** Centre to centre, so two medals never touch. */
const MEDAL_PITCH = 0.7;
/** The way the gameplay camera looks when nothing says otherwise (View.js: azimuth 45 degrees, 41 degrees up): Ry(theta) Rx(-elevation). */
const FALLBACK_FACING = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.23 * Math.PI, 0.25 * Math.PI, 0, 'YXZ'));
/** The angle about Y of an instance's frame rotation (a quaternion), 0 without one. */
const frameYaw = (q) => q ? Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z)) : 0;
const _facing = new THREE.Quaternion();
const _frame = new THREE.Quaternion();
const _basis = new THREE.Matrix4();
const _matrix = new THREE.Matrix4();
const _one = new THREE.Vector3(1, 1, 1);
/** 1 -> 1.45 -> 1 over the pop's 0..1, a little overshoot on the way back. */
const popScale = t => 1 + 0.45 * Math.sin(Math.PI * Math.min(1, t)) * (1 - 0.35 * t);
/**
 * A coin facing +Z: a raised rim, a recessed face and a small gem in the middle, shaded by vertex colour (the instance colour
 * multiplies it) so a plain colour still reads as a worked medal with no light on it. 54 triangles: only the face, because the
 * medal always turns to look at the camera, so its edge and its back are never seen.
 */
export function medalGeometry(unit) {
    // Radius 0.28 m: 0.56 m across, ~60 px at the default camera on a 1080p screen. [radius, height, shade]
    // The profile runs from the rim IN to the gem: LatheGeometry's front faces are on the right of the way the profile travels, so
    // travelling inward is what makes the relief face up (+Y, which becomes +Z, toward the camera) and not away from it.
    const profile = [
        [0.28, 0.072, 1.0], [0.215, 0.072, 1.12], [0.17, 0.05, 0.86], [0, 0.09, 1.18],
    ];
    const sides = 9;
    const points = profile.map(([x, y]) => new THREE.Vector2(x * unit, y * unit));
    const geometry = new THREE.LatheGeometry(points, sides);
    // The lathe stands on Y; the medal faces +Z.
    geometry.rotateX(Math.PI / 2);
    const rings = profile.length;
    const colours = new Float32Array(geometry.getAttribute('position').count * 3);
    // LatheGeometry orders its vertices segment by segment along the profile (sides + 1 segments, one vertex per profile point).
    for (let j = 0; j <= sides; j++)
        for (let k = 0; k < rings; k++) {
            const v = profile[k][2];
            colours.set([v, v, v], (j * rings + k) * 3);
        }
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geometry.deleteAttribute('normal');
    return geometry;
}
/**
 * Where each medal hangs, in this controller's coordinates: the awards in the order of the list, one tier per group, each tier
 * an arc centred on the side of the pillar that faces the camera, wider the more it carries.
 */
export function medalLayout(centre, unit, facing = Math.PI / 4) {
    const groups = new Map();
    WORLD2_ACHIEVEMENTS.forEach((definition, i) => {
        if (!groups.has(definition.group))
            groups.set(definition.group, []);
        groups.get(definition.group).push(i);
    });
    const tiers = new Map(TIERS.map(([group, y, r]) => [group, [y, r]]));
    // A group the table has never heard of climbs on top of the others rather than overlapping one.
    let extra = 0;
    for (const group of groups.keys())
        if (!tiers.has(group))
            tiers.set(group, [TIERS[TIERS.length - 1][1] + 0.8 * ++extra, 2.6]);
    const out = new Array(WORLD2_ACHIEVEMENTS.length);
    // `facing` is toward the camera in plan: (sin 45, cos 45), i.e. the south-east, which is where the car arrives (a frame that is
    // turned in the world turns it by the same angle: see buildPillar).
    for (const [group, indices] of groups) {
        const [y, radius] = tiers.get(group);
        const step = MEDAL_PITCH / radius;
        indices.forEach((index, k) => {
            const angle = facing + (k - (indices.length - 1) / 2) * step;
            out[index] = new THREE.Vector3(centre.x + Math.cos(angle) * radius * unit, centre.y + y * unit, centre.z + Math.sin(angle) * radius * unit);
        });
    }
    return out;
}
export class Achievements {
    game;
    groups = new Map();
    group = new THREE.Group();
    pillar = null;
    pillarBase = 0;
    /** Where the pillar stands in this controller's own coordinates, for the "near enough to animate" test. */
    pillarAt = new THREE.Vector3();
    unit = 1;
    glyphs = null;
    /** Local position of every medal, in award order. */
    medalAt = [];
    medalIndex = new Map();
    /** Medals that are popping: index to progress 0..1. */
    pops = new Map();
    medalFacing = new THREE.Quaternion();
    motionQuery = undefined;
    medalsDirty = true;
    popping = false;
    /** The dressing around the pillar (dais, signs, ...): built only where the level has the pillar. See AchievementsPlaza.js. */
    plaza = null;
    /** Who wants to hear that an award flipped or the progress was reset. */
    listeners = new Set();
    hydrating = false;
    /**
     * Distance-driven progress moves every frame, and every move used to write
     * localStorage. Writes are coalesced instead: an unlock flushes at once,
     * ordinary progress waits for the next tick past the interval.
     */
    dirty = false;
    savedAt = 0;
    queue = [];
    showing = null;
    constructor(game, references, bin) {
        this.game = game;
        this.group.name = 'World2 / achievements';
        for (const definition of WORLD2_ACHIEVEMENTS)
            this.groups.set(definition.id, { definition, progress: 0, ids: definition.unique ? new Set() : null, unlocked: false });
        this.bin = bin;
        this.hydrate();
        this.buildPillar(references);
        // The plaza (dais, boards, banners, water) belongs to the level's own instance: it needs the pillar and the prefab flag
        // world2-gameplay.js sets. The manager (no references) and /world2 (another module) never build it.
        if (this.pillar && AchievementsPlaza.wanted(game))
            this.plaza = new AchievementsPlaza(this, game, references, bin);
        const tick = () => this.update();
        game.ticker.events.on('tick', tick, 13);
        bin.add(() => {
            game.ticker.events.off('tick', tick);
            this.listeners.clear();
            this.glyphs?.geometry.dispose();
            this.glyphs?.material?.dispose();
        });
        bin.object3D(this.group);
    }
    /**
     * `listener(id)` runs when an award flips to unlocked (`id`) and when the progress is reset (`id` is null). Returns the
     * function that stops listening. Nothing about the awards themselves changes: this only tells the display.
     */
    onChange(listener) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
    emit(id) {
        for (const listener of [...this.listeners]) {
            try {
                listener(id);
            }
            catch (error) {
                console.error('achievements listener', error);
            }
        }
    }
    /**
     * The plaza's controller is not the object every system reports to (that is the manager, which has no pillar), so it
     * follows the manager: when an award flips, the medals and the boards repaint. Returns the stop function.
     */
    follow(source) {
        if (!source || source === this || typeof source.onChange !== 'function')
            return () => { };
        const stop = source.onChange(id => this.changed(id));
        this.bin?.add(stop);
        return stop;
    }
    /** An award flipped (or everything was reset): the medal and the numbers on the boards catch up. */
    changed(id) {
        this.refreshGlyphs(id);
        this.plaza?.refresh(id);
    }
    hydrate() {
        this.hydrating = true;
        try {
            const raw = JSON.parse(localStorage.getItem(STORAGE) ?? 'null');
            if (raw && typeof raw === 'object') {
                for (const [id, value] of Object.entries(raw)) {
                    const group = this.groups.get(id);
                    if (!group)
                        continue;
                    if (group.ids && Array.isArray(value))
                        for (const item of value)
                            group.ids.add(String(item));
                    else if (typeof value === 'number')
                        group.progress = value;
                    this.evaluate(group);
                }
            }
        }
        catch { /* Private mode simply starts empty. */ }
        this.hydrating = false;
    }
    /** Marks the save dirty. The tick decides when it is actually written. */
    schedule() { this.dirty = true; }
    persist() {
        this.dirty = false;
        this.savedAt = this.game.ticker.elapsed;
        try {
            const payload = {};
            for (const [id, group] of this.groups)
                payload[id] = group.ids ? [...group.ids] : group.progress;
            localStorage.setItem(STORAGE, JSON.stringify(payload));
        }
        catch { /* Private mode. */ }
    }
    evaluate(group) {
        const progress = group.ids ? group.ids.size : group.progress;
        if (progress < group.definition.target || group.unlocked)
            return;
        group.unlocked = true;
        this.refreshGlyphs(group.definition.id);
        if (this.hydrating)
            return;
        this.emit(group.definition.id);
        this.dirty = true;
        this.persist();
        this.queue.push(group.definition);
        this.game.audio.play('achievement');
    }
    /** Counter progress. Takes the maximum, so a caller cannot regress it. */
    set(id, value) {
        const group = this.groups.get(id);
        if (!group || group.ids)
            return;
        if (value <= group.progress)
            return;
        group.progress = value;
        this.evaluate(group);
        this.schedule();
    }
    add(id, amount = 1) {
        const group = this.groups.get(id);
        if (!group || group.ids)
            return;
        this.set(id, group.progress + amount);
    }
    /** Set progress: the same id never counts twice. */
    mark(id, item) {
        const group = this.groups.get(id);
        if (!group?.ids || group.ids.has(item))
            return;
        group.ids.add(item);
        group.progress = group.ids.size;
        this.evaluate(group);
        this.schedule();
        this.refreshGlyphs();
    }
    /** For the one-shot awards: unlock outright. */
    unlock(id) {
        const group = this.groups.get(id);
        if (!group || group.unlocked)
            return;
        if (group.ids) {
            for (let i = group.ids.size; i < group.definition.target; i++)
                group.ids.add(`auto-${i}`);
            group.progress = group.ids.size;
        }
        else
            group.progress = group.definition.target;
        this.evaluate(group);
        this.persist();
        this.refreshGlyphs();
    }
    has(id) { return this.groups.get(id)?.unlocked ?? false; }
    view() {
        return WORLD2_ACHIEVEMENTS.map(definition => {
            const group = this.groups.get(definition.id);
            return {
                id: definition.id, title: definition.title, description: definition.description,
                progress: group.ids ? group.ids.size : group.progress, target: definition.target, unlocked: group.unlocked,
            };
        });
    }
    get unlockedCount() { return [...this.groups.values()].filter(group => group.unlocked).length; }
    reset() {
        for (const group of this.groups.values()) {
            group.progress = 0;
            group.ids?.clear();
            group.unlocked = false;
        }
        this.persist();
        this.refreshGlyphs();
        this.emit(null);
    }
    /** The medal ring, one medallion per award, around the authored pillar. */
    buildPillar(references) {
        const pillar = references.node('refPillar');
        if (!pillar)
            return;
        this.pillar = pillar;
        // The bob moves the pillar's own (parent-relative) y, so that is the base; `centre` is where it stands in this frame.
        this.pillarBase = pillar.position.y;
        const centre = pillar.getWorldPosition(new THREE.Vector3());
        this.pillarAt.copy(centre);
        // Everything below is designed in metres at the scale the plaza ships at (1.25), and scales with the asset (PlazaLayout.js).
        const unit = U;
        this.unit = unit;
        const count = WORLD2_ACHIEVEMENTS.length;
        const material = new THREE.MeshBasicMaterial({ vertexColors: true });
        const mesh = new THREE.InstancedMesh(medalGeometry(unit), material, count);
        mesh.name = 'World2 / medals';
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = false;
        this.medalAt = medalLayout(centre, unit, Math.PI / 4 + frameYaw(this.game.physics?.rotation));
        this.medalIndex = new Map(WORLD2_ACHIEVEMENTS.map((definition, i) => [definition.id, i]));
        this.glyphs = mesh;
        this.writeMedals(true);
        // Pops enlarge a medal for half a second: the sphere has room for it, and the ring bobs with the pillar.
        mesh.computeBoundingSphere();
        mesh.boundingSphere.radius += 0.6 * unit;
        mesh.frustumCulled = true;
        this.group.add(mesh);
        this.refreshGlyphs();
    }
    /** Locked slate (a little of the group's colour in it) or earned gold, and a pop for the one that just changed. */
    refreshGlyphs(changed) {
        if (!this.glyphs?.instanceColor)
            return;
        const colour = new THREE.Color();
        WORLD2_ACHIEVEMENTS.forEach((definition, i) => {
            const group = this.groups.get(definition.id);
            this.glyphs.setColorAt(i, group.unlocked ? MEDAL.earned : this.lockedColour(definition.group, colour));
        });
        this.glyphs.instanceColor.needsUpdate = true;
        const i = changed ? this.medalIndex.get(changed) : undefined;
        if (i !== undefined && this.groups.get(changed)?.unlocked && !this.reduced())
            this.pops.set(i, 0);
        this.medalsDirty = true;
    }
    lockedColour(group, into) {
        return into.copy(MEDAL.locked).lerp(MEDAL.tint[group] ?? MEDAL.locked, MEDAL.tintMix);
    }
    /**
     * Respects the OS setting: the pop, the bob and the water all stop when it asks for less motion. (The View's own
     * `reducedMotion` flag is honoured too, but nothing sets it today, so the media query is what actually answers.)
     */
    reduced() {
        if (this.game.view?.reducedMotion === true)
            return true;
        if (this.motionQuery === undefined)
            this.motionQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
        return !!this.motionQuery?.matches;
    }
    /**
     * Writes every medal's matrix: where it hangs, turned to face the camera (the whole way round, not only about the
     * vertical: the ring is a lit sculpture, a coin seen edge-on would be a sliver), scaled by its pop.
     */
    writeMedals(force) {
        const mesh = this.glyphs;
        const camera = this.game.view?.camera;
        if (camera) {
            // The camera's orientation, as the frame sees it. The frame is static; its rotation is read from its last matrix.
            _facing.copy(camera.quaternion);
            _frame.setFromRotationMatrix(_basis.extractRotation(this.group.matrixWorld)).invert();
            _facing.premultiply(_frame);
        }
        else
            _facing.copy(FALLBACK_FACING);
        if (!force && !this.medalsDirty && _facing.dot(this.medalFacing) > 0.999999)
            return;
        this.medalFacing.copy(_facing);
        this.medalsDirty = false;
        for (let i = 0; i < this.medalAt.length; i++) {
            const pop = this.pops.get(i);
            const s = pop === undefined ? 1 : popScale(pop);
            _matrix.compose(this.medalAt[i], _facing, _one.set(s, s, s));
            mesh.setMatrixAt(i, _matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
    }
    update() {
        const delta = this.game.ticker.delta * this.game.ticker.scale;
        if (this.dirty && this.game.ticker.elapsed - this.savedAt > 2)
            this.persist();
        if (this.pillar) {
            const player = this.game.player.position;
            const at = this.pillarAt;
            // 40 m, in this controller's units (the plaza is drawn at 1.25).
            const near = Math.hypot(player.x - at.x, player.z - at.z) < 40 * this.unit;
            // The pillar floats up and down a little (and the medals with it) while someone is near enough to see it.
            if (near && !this.reduced()) {
                const bob = Math.sin(this.game.ticker.elapsed * 0.2) * 0.25;
                this.pillar.position.y = this.pillarBase + bob;
                if (this.glyphs)
                    this.glyphs.position.y = bob;
            }
            this.plaza?.update(near, this.reduced());
            if (this.glyphs && (near || this.pops.size)) {
                for (const [i, t] of this.pops) {
                    if (t + delta / 0.6 >= 1)
                        this.pops.delete(i);
                    else
                        this.pops.set(i, t + delta / 0.6);
                }
                // A medal that is popping (or has just finished) is written again even when the camera has not moved.
                if (this.pops.size || this.popping)
                    this.medalsDirty = true;
                this.popping = this.pops.size > 0;
                this.writeMedals(false);
            }
        }
        if (!this.showing && this.queue.length)
            this.showing = { achievement: this.queue.shift(), left: 4 };
        else if (this.showing) {
            this.showing.left -= delta;
            if (this.showing.left <= 0) {
                this.showing = null;
                this.game.publishGameplay();
                return;
            }
        }
        if (this.showing && Math.abs(this.showing.left % 1) < 0.02)
            this.game.publishGameplay();
    }
    /** The unlock card the HUD shows, if one is on screen. */
    get notice() {
        if (!this.showing)
            return null;
        return { title: this.showing.achievement.title, body: this.showing.achievement.description };
    }
    static describe(id) { return WORLD2_ACHIEVEMENT_BY_ID[id]; }
}
