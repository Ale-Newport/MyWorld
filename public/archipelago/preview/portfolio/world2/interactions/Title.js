import * as THREE from 'three';
import { CAP_UNITS, FONT, cutGlyph, paintUv } from './glyphs.js';
/* ============================================================
   THE PHYSICAL NAME

   Upstream's "BRUNO SIMON" is ten meshes baked in Blender from a
   Text object, one dynamic body each, one cuboid collider each,
   mass 0.2, created asleep and knocked about by the car. See
   sources/Game/World/Areas/LandingArea.js#setLetters().

   The behaviour is kept exactly. The GEOMETRY cannot be: the
   letters we need are not the letters the .blend baked, and we
   are not going to re-author someone else's source file. So the
   glyphs are cut at build time from Geist Bold — the typeface the
   portfolio already ships, under the SIL Open Font License — by
   scripts/gen-title-glyphs.mjs, and extruded here with real
   contours and real counters. No letter is assembled from boxes.

   Everything that defines the LOOK is measured off the authored
   letters rather than invented: cap height, extrusion depth, the
   baseline's position and heading, the palette material and the
   UV that picks its colour. Only the text changes.
   ============================================================ */
/** The two lines of the name, in reading order. */
export const TITLE_LINES = ['ALEJANDRO', 'NEWPORT'];
/** Extra tracking between letters, in cap heights — measured off the original. */
const TRACKING = 0.1;
/** Gap between the two baselines, in cap heights. */
const LEADING = 1.55;
export class Title {
    game;
    letters = [];
    group = new THREE.Group();
    toppled = 0;
    constructor(game, references, bin) {
        this.game = game;
        this.group.name = 'World2 / title';
        const authored = references.series('refLettersPhysicalDynamic');
        if (authored.length < 2)
            return;
        // These spell someone else's name; ours replace them.
        for (const node of authored)
            references.environment.suppress(node);
        // Measure the original: where it sits, which way it faces, how tall and
        // how thick it is. Cap height and depth must come from each letter's OWN
        // box — the world AABB of a letter yawed 25 degrees is wider than the
        // letter is, in both horizontal axes.
        const quaternion = new THREE.Quaternion();
        authored[0].updateWorldMatrix(true, true);
        authored[0].matrixWorld.decompose(new THREE.Vector3(), quaternion, new THREE.Vector3());
        const local = { height: Infinity, depth: Infinity };
        const world = new THREE.Box3();
        for (const node of authored) {
            node.updateWorldMatrix(true, true);
            world.union(new THREE.Box3().setFromObject(node));
            if (!(node instanceof THREE.Mesh))
                continue;
            node.geometry.computeBoundingBox();
            const box = node.geometry.boundingBox;
            if (!box)
                continue;
            const scale = node.getWorldScale(new THREE.Vector3());
            // Round letters overshoot the cap height, so the SMALLEST authored
            // letter height is the cap height; the largest is an O.
            local.height = Math.min(local.height, (box.max.y - box.min.y) * scale.y);
            local.depth = Math.min(local.depth, (box.max.z - box.min.z) * scale.z);
        }
        const capHeight = Number.isFinite(local.height) ? local.height : 1.45;
        const depth = Number.isFinite(local.depth) ? local.depth : 0.46;
        const centre = world.getCenter(new THREE.Vector3());
        const baseY = world.min.y;
        const source = authored.find(node => node instanceof THREE.Mesh);
        const material = source ? (Array.isArray(source.material) ? source.material[0] : source.material) : new THREE.MeshStandardMaterial({ color: '#fff2e8' });
        // Every vertex of every authored letter shares one UV, which is how the
        // palette texture gives them a flat colour. Ours sample the same texel.
        const uv = new THREE.Vector2(0.73563, 0.5);
        if (source?.geometry.getAttribute('uv')) {
            const attribute = source.geometry.getAttribute('uv');
            uv.set(attribute.getX(0), attribute.getY(0));
        }
        const unit = capHeight / CAP_UNITS; // Geist cap height in font units.
        const along = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
        const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
        const built = [];
        const lineWidths = [];
        TITLE_LINES.forEach((line, lineIndex) => {
            let cursor = 0;
            const start = built.length;
            for (const char of line) {
                if (char === ' ') {
                    cursor += FONT.spaceAdvance * unit + capHeight * TRACKING;
                    continue;
                }
                // Each glyph is re-origined on its own bounding box; the collider and
                // the body transform both depend on that being true.
                const cut = cutGlyph(char, capHeight, depth);
                if (!cut)
                    continue;
                // `cut.bearing` carries the glyph's left sidebearing, so pen position
                // plus it puts the re-origined mesh exactly where the type sets it.
                built.push({ char, geometry: cut.geometry, box: cut.box, offset: cursor + cut.bearing, line: lineIndex });
                // The advance carries the typeface's own sidebearings; tracking is the
                // only thing added, matched to the authored word's letter gaps.
                cursor += cut.advance + capHeight * TRACKING;
            }
            lineWidths[lineIndex] = cursor - capHeight * TRACKING;
            // Re-centre this line's letters on their own run.
            for (let i = start; i < built.length; i++)
                built[i].offset -= lineWidths[lineIndex] / 2;
        });
        for (const item of built) {
            paintUv(item.geometry, uv);
            const mesh = new THREE.Mesh(item.geometry, material);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            const lineOffset = (item.line - (TITLE_LINES.length - 1) / 2) * capHeight * LEADING;
            const position = centre.clone()
                .addScaledVector(along, item.offset)
                .addScaledVector(facing, lineOffset);
            // Each glyph was re-origined on its own box, so its origin sits at the
            // box centre above the baseline — round letters a hair lower than flat.
            // The baseline itself comes from the ground under THIS letter, not from
            // one averaged height: a letter placed a centimetre into the terrain is
            // pushed out on the next step, and then "reset" never quite restores it.
            const ground = game.physics.groundAt(position.x, position.z, baseY + 6, 20);
            position.y = (ground ?? baseY) + (item.box.min.y + item.box.max.y) / 2 - item.box.min.y;
            const half = new THREE.Vector3((item.box.max.x - item.box.min.x) / 2, (item.box.max.y - item.box.min.y) / 2, (item.box.max.z - item.box.min.z) / 2);
            const physical = game.physics.add({
                type: 'dynamic', position, rotation: quaternion,
                colliders: [{ shape: 'cuboid', parameters: [half.x, half.y, half.z], category: 'object' }],
                mass: 0.2, friction: 0.2, restitution: 0.15,
                linearDamping: 0.1, angularDamping: 0.1,
                sleeping: true, contactThreshold: 5,
                owner: `title:${item.char}`,
                onCollision: force => { if (force > 5)
                    game.audio.impact(Math.min(force, 20)); },
            });
            mesh.position.copy(position);
            mesh.quaternion.copy(quaternion);
            this.group.add(mesh);
            this.letters.push({ char: item.char, physical, mesh, home: { position: position.clone(), quaternion: quaternion.clone() }, down: false });
        }
        const tick = () => this.update();
        game.ticker.events.on('tick', tick, 9);
        bin.add(() => {
            game.ticker.events.off('tick', tick);
            for (const letter of this.letters)
                letter.mesh.geometry.dispose();
        });
        bin.object3D(this.group);
    }
    update() {
        const alpha = this.game.ticker.alpha;
        const up = new THREE.Vector3();
        for (const letter of this.letters) {
            if (letter.physical.body.isSleeping())
                continue;
            letter.mesh.position.lerpVectors(letter.physical.previous.position, letter.physical.current.position, alpha);
            letter.mesh.quaternion.slerpQuaternions(letter.physical.previous.quaternion, letter.physical.current.quaternion, alpha);
            if (letter.down)
                continue;
            up.set(0, 1, 0).applyQuaternion(letter.physical.current.quaternion);
            if (up.y < 0.6) {
                letter.down = true;
                this.toppled++;
                this.game.interactions?.achievements.unlock('titleNudge');
                this.game.interactions?.achievements.mark('titleDestroyer', letter.char + this.toppled);
            }
        }
    }
    get standing() { return this.letters.filter(letter => !letter.down).length; }
    /** Puts the name back: order, spacing, baseline and heading all restored. */
    reset() {
        for (const letter of this.letters) {
            letter.down = false;
            this.game.physics.reset(letter.physical);
            letter.physical.body.setTranslation(letter.home.position, true);
            letter.physical.body.setRotation(letter.home.quaternion, true);
            letter.physical.body.sleep();
            letter.mesh.position.copy(letter.home.position);
            letter.mesh.quaternion.copy(letter.home.quaternion);
        }
        this.toppled = 0;
    }
}
