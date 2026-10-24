import * as THREE from 'three';
import { WORLD2_ACHIEVEMENTS } from '../content/achievements.js';
import { PLAZA, U, THETA, at, daisHeight } from './PlazaLayout.js';
import { softObstacles } from '../../../runtime/placement.js';
import { BOARD_BACK, Facets, SIGN_THEMES, SWATCH, Sign, SignRuntime, TOKENS, addBox, addExtrude, addLathe, addPrism, charmGeometry, hashSeed, mergeParts, paintPips, place, ropeGeometry, signMaterials, vineGeometry } from '../signs/index.js';
/* ============================================================
   THE WINNERS' COURT — the dressing of the Achievement plaza.

   WHAT THIS IS. The plaza's arch, pond, pillar and waterfall are one
   authored asset; the level's document added a golden trophy, palms,
   trees, planters and lamps around it. All of it was laid out for a
   top-down editor camera. /world plays through ONE fixed camera
   (azimuth 45 degrees, 41 degrees up, 21 m away: a frame about 24 x
   16 m of ground and 9 m of picture), so the plaza is re-composed for
   it, in code, on top of the asset:

     the dais      a low stage on the camera axis through the pillar.
                   The map arrival, the prompt and the parked car are on
                   it; two stepped frustums with ramped skirts and convex
                   colliders, so the car drives up without a launch.
     the signs     a title and four boards (driving, places, games,
                   mischief) in the sign kit's timber, facing the camera,
                   with the real numbers: how many awards are won.
     the dressing  inlays, lanterns and banners (later in this file).
     the props     the document's own props are re-seated at run time
                   (adjustWorld): the trophy out of the cliff, the trees
                   and the lamps out of the arrival frame. The two that
                   stand over the roads the car comes in by, the trophy and
                   the east palm's crown, are cut like the arch (dressProps).

   COORDINATES. Everything below is written in PLAZA METRES: the origin
   is the plaza's centre (the asset's anchor), +x east, +z south, +y up
   from the ground, at the scale the plaza ships at (1.25): the numbers
   are in PlazaLayout.js. The group that holds it is scaled by 1 / 1.25,
   so one unit in it is one world metre at that scale. It scales WITH the
   asset, and the layout keeps its proportions if somebody enlarges the
   plaza.

   WHERE IT RUNS. Only /world builds this (Achievements.js is the /world
   controller; /world2 has its own TypeScript twin and never sees this
   file). The studio's Edit preview builds the geometry too, so the
   author sees the stage; only the player (`adjustWorld`) moves the
   document's props, and only there are bodies made.
   ============================================================ */

/** The four groups of awards, in the order the medals tier up, with the sign each gets. */
const GROUPS = [
    { id: 'driving', name: 'DRIVING', base: 'chess', charm: 'gear', hardware: 'oak' },
    { id: 'places', name: 'PLACES', base: 'maze', charm: 'compass', hardware: 'vine' },
    { id: 'games', name: 'GAMES', base: 'stock', charm: 'pawn', hardware: 'rope' },
    { id: 'mischief', name: 'MISCHIEF', base: 'dots', charm: 'acorn', hardware: 'oak', colours: { ribbon: '#7b3f9e', ribbonDeep: '#55296f', ribbonInk: TOKENS.cream, accent: '#c365ef' } },
];
const themeFor = (group) => ({ ...SIGN_THEMES[group.base], ...(group.colours ?? {}), id: `plaza-${group.id}`, emblem: null, charm: group.charm, hardware: group.hardware });
const TITLE_THEME = { ...SIGN_THEMES.plain, id: 'plaza-title', charm: 'none' };

export { PLAZA, daisHeight };

/** The dais is drawn with as many sides as its collider has (a 24-gon: the skirt the car climbs is the skirt it sees). */
const DAIS_SIDES = 24;

/**
 * The document's own props around the plaza, and where this layout wants them (plaza metres). Each is found by the stable id the
 * document gave it; `from` is where the document has it today, so a prop somebody has since moved is left alone.
 * `scale` is the absolute scale the prop should have afterwards (omit to keep it). `cut` is a test of the names of its meshes that take
 * the arch's see-through cut (dressProps): the parts of a prop that is tall, stands on the camera's side of a road the car drives in
 * by, and so would hide the car behind it for a few metres.
 */
export const PROPS = [
    // The 7.6 m golden trophy stood two metres inside the back of the cliff, in the mouth of the north path: out of the rock and
    // out of the way, at the north-east corner of the court (the north-west half of the camera's line is where tall things belong).
    // It stands on the camera's side of the north road, though: a car coming in over it is cut free of the bowl and the pedestal, and the pedestal
    // keeps a car's width from the road's east lane (PLAZA.road), so that lane runs to the arch.
    { id: 'user:f1bed642-d644-4905-8e6e-84396fc7924e', name: 'golden trophy', from: [-1, -9], to: [5.0, -11.8], scale: 1.2, cut: /^Trophy_/ },
    // Three broadleaf trees stood south of the disc, on the camera's side, between the lens and the stage: out to the west lawn.
    { id: 'user:83801aae-f6cb-42c0-ab36-8c5028017f77', name: 'tree south', from: [-1.92, 16.17], to: [-14.9, 10.6] },
    { id: 'user:a30c592d-2789-46c9-a22c-4ccdd6c41274', name: 'tree south west', from: [-9.7, 17.57], to: [-16.4, -2.6] },
    { id: 'user:62e1baa5-e8cd-4337-b439-15df2fe0b9f0', name: 'tree under the dais', from: [5.18, 14.35], to: [-17.0, 3.4] },
    // Trees and palms hide the car under their crowns: the ones on the drivable disc move to its rim or past it.
    { id: 'user:0bda1be1-0d1a-43f9-b163-a01e2a220361', name: 'tree north west', from: [-13.06, -7.33], to: [-16.2, -8.2] },
    { id: 'user:ca8d7137-bf42-4c3d-ac7a-ab083c58436c', name: 'tree north', from: [-9.95, -10.73], to: [-12.6, -13.2] },
    { id: 'user:43dff156-093c-4efe-8786-80024c0d06fa', name: 'tree north north', from: [-8.16, -12.72], to: [-9.6, -15.6] },
    { id: 'user:6f4ea73a-ec37-4a97-8407-9404c117cc76', name: 'west palm', from: [-10, 3], to: [-13.4, 3] },
    // (Its crown still stands over the east lane's south-east side, a car's length from the runner: the fronds and their stems are cut too.)
    { id: 'user:55daf8df-7f58-4477-9a83-bdbd1cb3a583', name: 'east palm', from: [10, 3], to: [14.6, 1.2], cut: /^Palm (stem|frond)/ },
    // The planters and lamps flanked a front yard that is now the stage.
    { id: 'user:78cc91ee-f6d8-4e96-b549-0dba70877d2d', name: 'west planter', from: [-8.19, 7.15], to: [-9.5, 7.15] },
    { id: 'user:fe1ff686-96b1-48da-a201-21579da3eb2a', name: 'west lamp', from: [-8.45, 8.84], to: [-9.7, 8.84] },
    { id: 'user:495bfafe-3e38-44e4-87b3-cc79c1faaf72', name: 'east planter', from: [8.19, 7.15], to: [11.8, 3.6] },
    { id: 'user:e1862c76-c418-40db-93be-2916508306e6', name: 'east lamp', from: [8.45, 8.84], to: [12.2, 6.4] },
];

/** How many awards of each group there are and how many are won, from the controller's own table. */
export function groupStats(groups) {
    const out = new Map();
    for (const definition of WORLD2_ACHIEVEMENTS) {
        const entry = out.get(definition.group) ?? { id: definition.group, total: 0, unlocked: 0 };
        entry.total++;
        if (groups.get(definition.id)?.unlocked)
            entry.unlocked++;
        out.set(definition.group, entry);
    }
    return out;
}

/* ------------------------------------------------------------------ the see-through arch -- */

/**
 * The arch is a 9 m stone asset on the camera's side of the court's far half: from the fixed camera it stands between the lens and
 * the car along the pond's north-west flank. Where it is in front of the car, it is cut away in a soft, dithered circle round the
 * car, which is how a game lets you see your car behind a building. Metres, in the world. `inner`: fully cut, `outer`: where the
 * stone is whole again (between the two the cut thins out in a screen-door pattern); `margin`: stone this close in front of the car
 * is the car's own surroundings and stays; `drop`: nothing below the car's own height is cut (the ground, a kerb); `range`: past this
 * distance from the plaza the cut is off.
 */
export const CUT = { inner: 1.7, outer: 3.0, margin: 0.9, drop: 0.2, range: 60 };

/**
 * How much of the stone at `point` is cut away, 0..1, exactly as the fragment shader decides it: only what is nearer to the eye than
 * the car, inside a cone round the line from the eye to the car (the cone, not a cylinder, so the hole is the same size on the screen
 * whatever its depth), and above the car's own height. Points are {x, y, z} in the world.
 */
export function cutFraction(point, eye, car, cut = CUT) {
    const cx = car.x - eye.x, cy = car.y - eye.y, cz = car.z - eye.z;
    const length = Math.hypot(cx, cy, cz);
    if (length < 1e-3)
        return 0;
    const px = point.x - eye.x, py = point.y - eye.y, pz = point.z - eye.z;
    const along = (px * cx + py * cy + pz * cz) / length;
    if (along <= 0 || along >= length - cut.margin || point.y <= car.y - cut.drop)
        return 0;
    const lateral = Math.hypot(px - cx / length * along, py - cy / length * along, pz - cz / length * along);
    const low = cut.inner / length, high = cut.outer / length;
    const k = Math.min(1, Math.max(0, (lateral / along - low) / (high - low)));
    return 1 - k * k * (3 - 2 * k);
}

/** The cut, spliced into the palette material's own lit shader (see AchievementsPlaza.dressArch). An instanced mesh (a batch of fronds) carries its place in its instance matrices. */
const CUT_VERTEX_DECLARE = 'varying float vCutY;';
const CUT_VERTEX = `
vec4 cutLocal = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  cutLocal = instanceMatrix * cutLocal;
#endif
vCutY = (modelMatrix * cutLocal).y;`;
const CUT_FRAGMENT_DECLARE = `
uniform vec3 uCutDir;
uniform vec4 uCut;
uniform float uCutFloor;
varying float vCutY;`;
const CUT_FRAGMENT = `
  if (uCut.x > 0.0 && vCutY > uCutFloor) {
    vec3 cutP = -vViewPosition;
    float cutAlong = dot(cutP, uCutDir);
    if (cutAlong > 0.0 && cutAlong < uCut.x - uCut.w) {
      float cutKeep = smoothstep(uCut.y, uCut.z, length(cutP - uCutDir * cutAlong) / cutAlong);
      float cutDither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      if (cutDither >= cutKeep) discard;
    }
  }
`;

/** Splices the cut into a lit shader (a palette or water material's own), once: its uniforms are the plaza's single set. */
function spliceCut(shader, uniforms) {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${CUT_VERTEX_DECLARE}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${CUT_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>${CUT_FRAGMENT_DECLARE}`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>${CUT_FRAGMENT}`);
}

/* ------------------------------------------------------------------ lighter timber for the boards -- */

/**
 * The timber of one board: the sign kit's own board (Sign.buildBoard: two posts with pyramid caps on stone feet, a border all round, a
 * back plank, four braces, the theme's rope or vine, a charm) in the same places and the same colours, without the chamfers, the
 * nails and the braces' rivets. None of those is more than a pixel or two across from the gameplay camera, and together they were
 * three quarters of the plaza's triangles (about 1.4 k a board against 0.4 k here). Parts are in the sign's own coordinates.
 */
export function liteBoardParts({ width: W, height: H, leg, theme, seed }) {
    const postW = 0.14, border = 0.09, px = W / 2 + postW / 2 + 0.04, faceY = leg + H / 2;
    const solid = (build) => { const f = new Facets(); build(f); return f.geometry(); };
    const plank = (w, h, d, swatch) => solid((f) => addBox(f, [0, 0, 0], [w / 2, h / 2, d / 2], swatch, 0));
    const post = solid((f) => {
        const height = leg + H + 0.2, slab = postW * 0.16, cap = postW * 0.62, base = height + slab;
        addBox(f, [0, height / 2, 0], [postW / 2, height / 2, postW / 2], SWATCH.lightOrange, 0);
        addBox(f, [0, height + slab / 2, 0], [cap, slab / 2, cap], SWATCH.woodDark, 0);
        const corners = [[-cap, base, -cap], [cap, base, -cap], [cap, base, cap], [-cap, base, cap]], tip = [0, base + postW * 0.5, 0];
        for (let i = 0; i < 4; i++)
            f.poly([corners[i], corners[(i + 1) % 4], tip], SWATCH.woodDark, [0, base - 1, 0]);
    });
    const foot = plank(postW * 1.7, 0.1, postW * 1.7, SWATCH.slate);
    const parts = [];
    for (const s of [-1, 1]) {
        parts.push(place(post, [s * px, 0, -0.01]));
        parts.push(place(foot, [s * px, 0.05, -0.01]));
    }
    const rail = plank(W + 0.2, border, 0.1, SWATCH.lightOrange), stile = plank(0.08, H, 0.1, SWATCH.lightOrange);
    for (const s of [-1, 1]) {
        parts.push(place(rail, [0, faceY + s * (H / 2 + border / 2 - 0.01), 0]));
        parts.push(place(stile, [s * (W / 2 + 0.03), faceY, 0]));
    }
    parts.push(place(plank(W + 0.1, H + 0.1, 0.05, BOARD_BACK), [0, faceY, -0.04]));
    const brace = solid((f) => {
        addBox(f, [0.11, 0.02, 0], [0.11, 0.02, 0.015], SWATCH.dark, 0);
        addBox(f, [0.02, 0.11, 0], [0.02, 0.11, 0.015], SWATCH.dark, 0);
    });
    for (const sx of [-1, 1])
        for (const sy of [-1, 1]) {
            const turn = sx < 0 ? (sy < 0 ? 0 : -Math.PI / 2) : (sy > 0 ? Math.PI : Math.PI / 2);
            parts.push(place(brace, [sx * (W / 2 + 0.075), faceY + sy * (H / 2 + 0.075), 0.05], [0, 0, turn]));
        }
    if (theme.hardware === 'vine') {
        const path = [];
        for (let i = 0; i <= 4; i++)
            path.push([-px - 0.075 + Math.sin(i * 2.6) * 0.035, 0.1 + (i / 4) * (H + 0.5), 0.075 + Math.cos(i * 1.8) * 0.02]);
        parts.push(place(vineGeometry(path, { radius: 0.012, leaves: 6, leafSize: 0.15, seed: hashSeed(seed), sides: 3 })));
    }
    else if (theme.hardware === 'rope' || theme.hardware === 'chain') {
        const top = faceY + H / 2 + 0.05;
        for (const s of [-1, 1])
            parts.push(place(ropeGeometry([s * (W / 2 - 0.15), top, 0.07], [s * px, top + 0.22, 0.02], { sag: 0.05, swatch: theme.hardware === 'chain' ? SWATCH.silver : SWATCH.khaki, radius: 0.018, sides: 4, segments: 3 })));
    }
    if (theme.charm && theme.charm !== 'none') {
        const x = W / 2 - 0.22, top = faceY - H / 2 - 0.06;
        parts.push(place(ropeGeometry([x, top, 0.07], [x, top - 0.14, 0.07], { sag: 0, swatch: SWATCH.khaki, sides: 4, segments: 1 })));
        parts.push(place(charmGeometry(theme.charm, 0.26), [x, top - 0.14, 0.07]));
    }
    return parts;
}

const yawOf = (q) => q ? Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z)) : 0;
const _v = new THREE.Vector3();
/** Same test as world-storage.js PLAYER_MODE: the public player, as opposed to the admin's studio. */
const playerMode = () => typeof document !== 'undefined' && document.body?.dataset.player === 'true';

export class AchievementsPlaza {
    /**
     * Whether this controller should dress the plaza. The Edit preview of the asset (`status.area === 'preview'`) shows it, in
     * the studio, so an author sees the stage; in the player that preview is a hidden template nobody ever looks at, and the
     * level's own instance (built next) is the one that counts.
     */
    static wanted(game) {
        if (!game?.plaza)
            return false;
        return !(game.status?.area === 'preview' && playerMode());
    }

    /** @param owner the Achievements controller that built this (it has `groups`, `group`, `game`). */
    constructor(owner, game, references, bin) {
        const began = typeof performance !== 'undefined' ? performance.now() : 0;
        this.owner = owner;
        this.game = game;
        this.references = references;
        this.bin = bin;
        this.group = new THREE.Group();
        this.group.name = 'World2 / plaza';
        this.signs = [];
        /** The studio's Edit preview has no ground, no car and no bodies: only the look. */
        this.preview = game.status?.area === 'preview';
        this.capFraction = new Map();
        this.dais = null;
        this.bodies = [];
        this.adjusted = false;
        /** The see-through arch (dressArch): null where there is no car to see through to (the studio's preview). */
        this.cut = null;
        this.finial = null;
        // The anchor of the asset: where plaza metres start. The asset node is the area's origin in the level's own frame.
        const area = references.node('achievements');
        const origin = area ? area.getWorldPosition(new THREE.Vector3()) : owner.pillarAt.clone().add(new THREE.Vector3(1.11 * U, 0, -3.09 * U));
        this.group.position.set(origin.x, 0, origin.z);
        this.group.scale.setScalar(U);
        owner.group.add(this.group);
        this.frameYaw = yawOf(game.physics?.rotation);
        // The camera's azimuth as the frame sees it: the signs face it whatever way the instance is turned.
        this.yaw = THETA - this.frameYaw;
        this.materials = signMaterials(references.environment.group);
        bin.add(() => this.materials.dispose());
        this.runtime = new SignRuntime({ ticker: game.ticker, camera: () => game.view?.camera }, bin);
        this.statics = [];
        this.buildDais();
        this.buildSigns();
        this.buildDressing();
        this.finishStatics();
        this.buildWater();
        this.placePrompt();
        // No camera, no runtime ticks (the studio's preview): paint now, once.
        if (!game.view?.camera)
            this.signs.forEach(sign => sign.paintNow());
        /** Milliseconds the module spent building itself and re-seating the document's props (read by the QA harness). */
        this.timing = { build: typeof performance !== 'undefined' ? performance.now() - began : 0, adjust: 0 };
    }

    /* ---------------------------------------------------------------- the dais -- */

    buildDais() {
        const { x, z } = PLAZA.dais;
        const f = new Facets();
        const sunk = PLAZA.sunk;
        let below = -sunk;
        PLAZA.tiers.forEach(([top, foot, h], i) => {
            // Skirt and flat top, one lathe: the foot ring buried, the lip, the top.
            addLathe(f, [[0, below], [foot, i === 0 ? -sunk : below], [top, h], [0, h]], DAIS_SIDES, i === 0 ? SWATCH.copper : SWATCH.salmon, i === 0 ? SWATCH.sand : SWATCH.paleRose);
            below = h - 0.02;
        });
        // Gold nosing on the lip of each tier, and a copper ring just inside the top one.
        for (const [top, , h] of PLAZA.tiers)
            addLathe(f, [[top - 0.1, h + 0.005], [top + 0.05, h + 0.005], [top + 0.05, h + 0.045], [top - 0.1, h + 0.045], [top - 0.1, h + 0.005]], DAIS_SIDES, SWATCH.gold, SWATCH.gold);
        const top = PLAZA.tiers[PLAZA.tiers.length - 1];
        addLathe(f, [[top[0] - 0.5, top[2] + 0.004], [top[0] - 0.36, top[2] + 0.004], [top[0] - 0.36, top[2] + 0.02], [top[0] - 0.5, top[2] + 0.02], [top[0] - 0.5, top[2] + 0.004]], DAIS_SIDES, SWATCH.copper, SWATCH.copper);
        this.statics.push({ geometry: f.geometry(), position: [x, 0, z] });
        const plaza = this;
        this.dais = {
            x, z, tiers: PLAZA.tiers, top: top[2],
            /** Where the dais is in the world (metres): for the QA harness and anything that wants to drive onto it. */
            get world() {
                plaza.group.updateWorldMatrix(true, false);
                const centre = new THREE.Vector3(x, 0, z).applyMatrix4(plaza.group.matrixWorld);
                return { x: centre.x, z: centre.z, radius: PLAZA.tiers[0][1], top: centre.y + top[2] * plaza.group.matrixWorld.getMaxScaleOnAxis() };
            },
        };
        this.pendingBodies = this.pendingBodies ?? [];
        this.pendingBodies.push(() => this.daisBody());
    }

    /** One fixed body, one convex hull per tier: a frustum whose side IS the ramp. */
    daisBody() {
        const physics = this.game.physics;
        if (!physics?.add)
            return null;
        const colliders = [];
        let below = -PLAZA.sunk;
        PLAZA.tiers.forEach(([top, foot, h], i) => {
            const vertices = [];
            for (let k = 0; k < DAIS_SIDES; k++) {
                const a = (k / DAIS_SIDES) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
                vertices.push(c * foot * U, (i === 0 ? -PLAZA.sunk : below) * U, s * foot * U, c * top * U, h * U, s * top * U);
            }
            colliders.push({ shape: 'hull', parameters: [Float32Array.from(vertices)] });
            below = h - 0.02;
        });
        return this.addBody({ position: this.local(PLAZA.dais.x, 0, PLAZA.dais.z), colliders, owner: 'plaza:dais' });
    }

    /** A fixed body, anchored the way every authored floor is (World2Environment.FLOOR_MASS): the car brakes against it, it never gives. */
    addBody({ position, rotation, colliders, owner }) {
        const physical = this.game.physics.add({ type: 'fixed', category: 'floor', position, rotation, colliders, friction: 0.7, restitution: 0.02, owner });
        this.references.environment.anchor?.(physical);
        this.bodies.push(physical);
        this.bin.add(() => { try { this.game.physics.remove?.(physical); } catch { /* the world is already gone */ } });
        return physical;
    }

    /** A plaza position (metres) in the controller's own coordinates. */
    local(x, y, z) {
        return new THREE.Vector3(this.group.position.x + x * U, y * U, this.group.position.z + z * U);
    }

    /* ---------------------------------------------------------------- the signs -- */

    buildSigns() {
        const { boards, title } = PLAZA;
        const stats = () => groupStats(this.owner.groups);
        const make = (spec) => {
            const sign = new Sign({
                id: `plaza-${spec.id}`, variant: 'board', width: spec.w, height: spec.h, title: spec.title, theme: spec.theme, emblem: null,
                legHeight: spec.leg, materials: this.materials, runtime: this.runtime, bin: this.bin, paint: spec.paint,
            });
            const [x, z] = spec.at;
            // A sign points back at itself through userData, which a cloned template (the studio's asset library) cannot copy.
            delete sign.group.userData.sign;
            sign.group.position.set(x, daisHeight(Math.hypot(x - PLAZA.dais.x, z - PLAZA.dais.z)), z);
            sign.group.rotation.order = 'YXZ';
            sign.group.rotation.y = this.yaw;
            sign.group.rotation.x = -spec.lean;
            this.group.add(sign.group);
            sign.group.updateMatrix();
            this.signs.push(sign);
            this.addSignBody(sign, spec);
            return sign;
        };
        this.title = make({
            id: 'title', title: 'ACHIEVEMENTS', w: title.w, h: title.h, leg: title.leg, lean: title.lean, theme: TITLE_THEME,
            at: at(title.r, title.f), paint: (ctx, rect, tools) => paintTitle(ctx, rect, tools, this, stats()),
        });
        this.boards = GROUPS.map((group, i) => make({
            id: group.id, title: group.name, w: boards.w, h: boards.h, leg: boards.leg, lean: boards.lean, theme: themeFor(group),
            at: at(boards.at[i], boards.f), paint: (ctx, rect, tools) => paintBoard(ctx, rect, tools, this, group, stats().get(group.id) ?? { total: 0, unlocked: 0 }),
        }));
    }

    /** A sign is a solid thing: one box for the board and its two posts, as wide as the posts, as tall as the cap. */
    addSignBody(sign, spec) {
        if (this.preview || !this.game.physics?.add)
            return;
        const halfWidth = spec.w / 2 + 0.2, halfHeight = (spec.leg + spec.h + 0.2) / 2;
        this.pendingBodies = this.pendingBodies ?? [];
        this.pendingBodies.push(() => {
            const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
            return this.addBody({
                position: this.local(sign.group.position.x, sign.group.position.y, sign.group.position.z), rotation: q,
                colliders: [{ shape: 'cuboid', parameters: [halfWidth * U, halfHeight * U, 0.16 * U], position: new THREE.Vector3(0, halfHeight * U, 0) }],
                owner: `plaza:${sign.id}`,
            });
        });
    }

    /**
     * The statics of the plaza (the dais, the signs' timber) are ONE mesh with the level's own palette material: one draw
     * for everything built of wood and stone. The signs keep their painted faces (a canvas each) and give up their timber.
     */
    finishStatics() {
        const parts = [...this.statics];
        const lite = [];
        for (const sign of this.signs) {
            if (!sign.hardware)
                continue;
            sign.group.updateMatrix();
            // The kit's own timber is built (the sign needs its face and bounds) but not drawn: the plaza's boards get the lighter set.
            const timber = mergeParts(liteBoardParts({ width: sign.width, height: sign.height, leg: sign.options.legHeight ?? 0.5, theme: sign.themeValue, seed: sign.seed }));
            lite.push(timber);
            parts.push({ geometry: timber, matrix: sign.group.matrix.clone() });
            sign.hardware.removeFromParent();
        }
        const geometry = mergeParts(parts);
        for (const part of [...this.statics, ...lite.map((g) => ({ geometry: g }))])
            part.geometry.dispose();
        const mesh = new THREE.Mesh(geometry, this.materials.wood);
        mesh.name = 'World2 / plaza / stone and timber';
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.group.add(mesh);
        this.mesh = mesh;
        this.bin.add(() => geometry.dispose());
        if (!this.preview && this.game.physics?.add)
            for (const build of this.pendingBodies ?? [])
                build();
        this.pendingBodies = [];
    }

    /* ---------------------------------------------------------------- the dressing -- */

    /** Everything built of stone and timber that is not a sign: inlays, lamps, banners, the finial. All of it goes into the one static mesh. */
    buildDressing() {
        const geo = (build) => { const f = new Facets(); build(f); return f.geometry(); };
        const flat = (build) => this.statics.push({ geometry: geo(build) });
        const { runner, lamps, poles, finial, ring } = PLAZA;
        const dais = PLAZA.dais;
        // Inlays lie just above the disc's slab (its top is at 0.025) and the ground around it.
        const Y = 0.05;
        // The disc's cream ring, with a copper line inside it, broken where the dais and the north path cross.
        flat((f) => {
            const gapped = (deg) => ring.gaps.some(([a, b]) => deg >= a && deg <= b);
            for (const [radius, width, swatch] of [[ring.radius, ring.width, SWATCH.sand], [ring.radius - 0.55, ring.width * 0.35, SWATCH.copper]]) {
                const steps = 72;
                for (let i = 0; i < steps; i++) {
                    const a0 = (i / steps) * 360 - 180, a1 = ((i + 1) / steps) * 360 - 180;
                    if (gapped((a0 + a1) / 2))
                        continue;
                    const p = (a, r) => [Math.cos((a * Math.PI) / 180) * r, Y, Math.sin((a * Math.PI) / 180) * r];
                    f.facing([p(a0, radius - width / 2), p(a1, radius - width / 2), p(a1, radius + width / 2), p(a0, radius + width / 2)], swatch, [0, 1, 0]);
                }
            }
        });
        // The apron: a cream ring where the dais meets the land, on the land side only.
        flat((f) => {
            const steps = 32;
            for (let i = 0; i < steps; i++) {
                const a0 = 150 + (i / steps) * 200, a1 = 150 + ((i + 1) / steps) * 200;
                const p = (a, r) => [dais.x + Math.cos((a * Math.PI) / 180) * r, Y, dais.z + Math.sin((a * Math.PI) / 180) * r];
                const r0 = PLAZA.tiers[0][1] - 0.05, r1 = r0 + 0.55;
                f.facing([p(a0, r0), p(a1, r0), p(a1, r1), p(a0, r1)], SWATCH.sand, [0, 1, 0]);
            }
        });
        // The runner: a ribbon of cream along the east lane, ending in the apron.
        flat((f) => {
            const pts = runner.points;
            for (let i = 0; i < pts.length - 1; i++) {
                const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
                const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), nx = -dz / len, nz = dx / len, w = runner.width / 2;
                const a = [x0 + nx * w, Y, z0 + nz * w], b = [x1 + nx * w, Y, z1 + nz * w], c = [x1 - nx * w, Y, z1 - nz * w], d = [x0 - nx * w, Y, z0 - nz * w];
                f.facing([a, b, c, d], SWATCH.sand, [0, 1, 0]);
                // a thin copper line down the middle
                const m = 0.05;
                f.facing([[x0 + nx * m, Y + 0.004, z0 + nz * m], [x1 + nx * m, Y + 0.004, z1 + nz * m], [x1 - nx * m, Y + 0.004, z1 - nz * m], [x0 - nx * m, Y + 0.004, z0 - nz * m]], SWATCH.copper, [0, 1, 0]);
            }
        });
        // Low lamps along it (no taller than a car's door: they never stand between the lens and the car).
        for (const [x, z] of lamps)
            this.statics.push({ geometry: geo((f) => lampHead(f)), position: [x, 0, z] });
        // Banner poles with a pennant each, on the north-west half.
        const cloths = { copper: SWATCH.lightOrange, teal: SWATCH.sky, gold: SWATCH.gold, cream: SWATCH.sand };
        for (const [x, z, cloth] of poles)
            this.statics.push({ geometry: geo((f) => banner(f, cloths[cloth] ?? SWATCH.gold)), position: [x, 0, z], rotation: [0, this.yaw, 0] });
        // The gold star on the crest of the arch: it faces the camera. Its own mesh, because it is cut away with the arch (dressArch).
        const crest = new THREE.Mesh(geo((f) => star(f, finial.radius)), this.materials.wood);
        crest.name = 'World2 / plaza / finial';
        crest.position.set(finial.x, finial.y, finial.z);
        crest.rotation.y = this.yaw;
        crest.castShadow = true;
        crest.receiveShadow = true;
        this.group.add(crest);
        this.finial = crest;
        this.bin.add(() => crest.geometry.dispose());
        // The solid parts: the pole feet and the lamp posts.
        if (!this.preview && this.game.physics?.add) {
            this.pendingBodies = this.pendingBodies ?? [];
            this.pendingBodies.push(() => this.addBody({
                position: this.local(0, 0, 0),
                colliders: [
                    ...poles.map(([x, z]) => ({ shape: 'cylinder', parameters: [2.1 * U, 0.14 * U], position: new THREE.Vector3(x * U, 2.1 * U, z * U) })),
                    ...lamps.map(([x, z]) => ({ shape: 'cylinder', parameters: [0.45 * U, 0.15 * U], position: new THREE.Vector3(x * U, 0.45 * U, z * U) })),
                ],
                owner: 'plaza:dressing',
            }));
        }
    }

    /* ---------------------------------------------------------------- the water -- */

    /**
     * The waterfall and the pond were flat blue. They get their own copy of the level's material (the shared one is never
     * touched) with streaks running down the fall, foam at its foot and a slow glitter on the pond; and a drift of mist
     * rises where the water lands. Both run only while somebody is near, and stand still for prefers-reduced-motion.
     */
    buildWater() {
        const time = { value: 3.2 };
        this.water = { time, materials: [], meshes: [], mist: null };
        for (const [name, mode] of [['refWaterfallDrop', 0], ['refWaterfallStill', 1]]) {
            const mesh = this.references.node(name);
            if (!mesh?.isMesh || Array.isArray(mesh.material))
                continue;
            const material = mesh.material.clone();
            material.name = `${mesh.material.name || 'waterfall'} (plaza)`;
            material.onBeforeCompile = (shader) => {
                shader.uniforms.uTime = time;
                shader.uniforms.uMode = { value: mode };
                shader.vertexShader = shader.vertexShader
                    .replace('#include <common>', '#include <common>\nvarying vec2 vWaterUv;\nvarying vec3 vWaterPos;')
                    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWaterUv = uv;\nvWaterPos = position;');
                shader.fragmentShader = shader.fragmentShader
                    .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uMode;\nvarying vec2 vWaterUv;\nvarying vec3 vWaterPos;')
                    .replace('#include <color_fragment>', '#include <color_fragment>\n' + WATER_FRAGMENT);
            };
            material.customProgramCacheKey = () => 'achievements-plaza-water';
            mesh.material = material;
            this.water.materials.push(material);
            this.water.meshes.push(mesh);
            this.bin.add(() => material.dispose());
        }
        if (this.preview)
            return;
        // The mist: soft puffs that rise and fade where the fall lands, camera-facing, added together.
        const count = 22;
        const geometry = new THREE.PlaneGeometry(1, 1);
        const seeds = new Float32Array(count);
        const mesh = new THREE.InstancedMesh(geometry, new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
            uniforms: { uTime: time, uColor: { value: new THREE.Color('#cfe6ff') } },
            vertexShader: MIST_VERTEX, fragmentShader: MIST_FRAGMENT,
        }), count);
        const matrix = new THREE.Matrix4();
        for (let i = 0; i < count; i++) {
            seeds[i] = (i * 0.61803398875) % 1;
            // Spread along the foot of the fall (the sheet is 3.4 m wide, its face at z = -3.3), in plaza metres.
            matrix.makeTranslation(-2.7 + ((i * 7) % count) / count * 3.2, 0.55, -3.0 + (((i * 5) % count) / count - 0.5) * 1.1);
            mesh.setMatrixAt(i, matrix);
        }
        geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
        // The puffs rise and drift in the vertex shader, so the sphere is the whole column they can reach. Culling by the camera is all the
        // gating the draw needs, and it stays visible so the program compiles with the rest of the scene at start-up.
        mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(-1.1, 1.4, -3.0), 4.6);
        mesh.name = 'World2 / plaza / mist';
        mesh.renderOrder = 5;
        mesh.layers.set(2);
        this.group.add(mesh);
        this.water.mist = mesh;
        this.bin.add(() => { geometry.dispose(); mesh.material.dispose(); });
    }

    /**
     * Called every tick by the controller. `near` is "somebody is within 40 m", `reduced` the OS's reduced-motion setting: the water
     * flows (its clock runs) only when someone is near and has not asked for stillness; otherwise it holds its last frame.
     */
    update(near, reduced) {
        const water = this.water;
        if (!water)
            return;
        if (near && !reduced)
            water.time.value = this.game.ticker.elapsed;
    }

    /* ---------------------------------------------------------------- prompt and spawn -- */

    /** Moves the authored "Achievements" point onto the dais. Places.js reads it when it builds the prompt, a moment after this runs. */
    placePrompt() {
        const point = this.references.node('refInteractivePoint.005');
        if (!point?.parent)
            return;
        const [x, z] = at(PLAZA.prompt.r, PLAZA.prompt.f);
        const target = this.local(x, daisHeight(Math.hypot(x - PLAZA.dais.x, z - PLAZA.dais.z)) + PLAZA.prompt.y, z);
        point.parent.updateWorldMatrix(true, false);
        point.position.copy(point.parent.worldToLocal(target));
        point.updateMatrixWorld(true);
    }

    /* ---------------------------------------------------------------- the see-through arch -- */

    /**
     * Gives the arch, and the gold star on its crest, a copy of the arch's own palette material with the cut of CUT spliced into its
     * shader: where either is between the camera and the car, it is dithered away round the car (see `cutFraction`). The arch keeps its
     * one draw call and its shadow. The uniforms are written as each mesh is drawn (onBeforeRender) from the camera that draws it,
     * so the hole never lags the car by a frame, and only for the gameplay camera (the map's own renders never see a hole).
     * The player only: the studio's Edit preview has no car, and shows the arch whole.
     */
    dressArch(driving) {
        const camera = this.game?.view?.camera;
        const vehicle = driving?.vehicle;
        if (this.cut || !camera || !vehicle?.position)
            return;
        const box = new THREE.Box3();
        const meshes = [];
        this.references.node('achievements')?.traverse((o) => {
            if (!o.isMesh || !o.visible || Array.isArray(o.material) || !o.material.isMeshStandardMaterial || o.material.transparent || o.material.map?.name !== 'palette')
                return;
            // The tall stone only: the 9 m asset, not the pillar, the waterfall or the collision hulls.
            if (box.setFromObject(o).getSize(_v).y >= 6)
                meshes.push(o);
        });
        if (!meshes.length)
            return;
        if (this.finial)
            meshes.push(this.finial);
        const source = meshes[0].material;
        const material = source.clone();
        material.name = `${source.name || 'palette'} (plaza cut)`;
        const state = { enabled: true, meshes: [...meshes], dir: new THREE.Vector3(0, 0, -1), params: new THREE.Vector4(), material, centre: this.group.getWorldPosition(new THREE.Vector3()), uniforms: null, before: null, clones: new Map([[source, material]]), materials: new Set([material]), props: [] };
        const uniforms = { uCutDir: { value: state.dir }, uCut: { value: state.params }, uCutFloor: { value: 0 } };
        material.onBeforeCompile = (shader) => spliceCut(shader, uniforms);
        material.customProgramCacheKey = () => 'achievements-plaza-cut';
        const car = new THREE.Vector3();
        const before = (renderer, scene, drawing) => {
            const p = state.params;
            const here = vehicle.position;
            if (!state.enabled || drawing !== camera || Math.hypot(here.x - state.centre.x, here.z - state.centre.z) > CUT.range) {
                p.x = 0;
                return;
            }
            car.copy(here).applyMatrix4(camera.matrixWorldInverse);
            const distance = car.length();
            if (distance < 3) {
                p.x = 0;
                return;
            }
            state.dir.copy(car).divideScalar(distance);
            p.set(distance, CUT.inner / distance, CUT.outer / distance, CUT.margin);
            uniforms.uCutFloor.value = here.y - CUT.drop;
        };
        state.uniforms = uniforms;
        state.before = before;
        for (const mesh of meshes) {
            mesh.material = material;
            mesh.onBeforeRender = before;
        }
        // The pond's block and the waterfall's sheet stand in front of the car as often as the stone does, and have shaders of their own
        // (buildWater): they take the same cut on top of them.
        for (const mesh of this.water?.meshes ?? []) {
            const water = mesh.material, own = water.onBeforeCompile, key = water.customProgramCacheKey();
            water.onBeforeCompile = (shader, renderer) => { own.call(water, shader, renderer); spliceCut(shader, uniforms); };
            water.customProgramCacheKey = () => `${key}+cut`;
            water.needsUpdate = true;
            state.meshes.push(mesh);
            state.materials.add(water);
            mesh.onBeforeRender = before;
        }
        this.cut = state;
        this.bin.add(() => material.dispose());
    }

    /**
     * Gives the parts of the document's tall props that PROPS names (`cut`) the same cut as the arch: the golden trophy that stands over
     * the north road's east side and the east palm's crown over the east lane. They are not assets of the plaza but the level's own props,
     * and the world batches them (main.js batch(): the trophy's gold into one merged mesh, a palm's fronds into one instanced mesh), so
     * the cut cannot hang on each mesh: a prop's part gets a copy of its own material with the cut spliced in (one copy per original,
     * shared by every part that had it), and the hook that writes the cut is on the MATERIAL, so the batch that is made of those parts
     * later, which keeps the first part's material, draws with it. Nothing else of the world shares a copy: those parts batch among
     * themselves, a draw or two of their own. Called by adjustWorld, before the world is batched. Returns how many meshes took it.
     * @param {Array<[THREE.Object3D, RegExp]>} nodes the props found in the world, each with the test of its mesh names
     */
    dressProps(nodes) {
        const state = this.cut;
        if (!state)
            return 0;
        const restore = [];
        for (const [node, names] of nodes) {
            node.traverse((mesh) => {
                const source = mesh.material;
                if (!mesh.isMesh || Array.isArray(source) || !source?.isMeshStandardMaterial || source.transparent || !names.test(mesh.name) || state.materials.has(source))
                    return;
                let material = state.clones.get(source);
                if (!material) {
                    material = source.clone();
                    material.name = `${source.name || 'prop'} (plaza cut)`;
                    material.onBeforeCompile = (shader) => spliceCut(shader, state.uniforms);
                    material.customProgramCacheKey = () => 'achievements-plaza-cut';
                    material.onBeforeRender = state.before;
                    state.clones.set(source, material);
                    state.materials.add(material);
                    this.bin.add(() => material.dispose());
                }
                restore.push([mesh, source]);
                mesh.material = material;
                state.props.push(mesh);
            });
        }
        if (restore.length)
            this.bin.add(() => { for (const [mesh, source] of restore) mesh.material = source; });
        return restore.length;
    }

    /** Whether the stone, water or prop part that `object` is (a batch made of the parts counts) is drawn with the cut: for the QA harness. */
    isCut(object) {
        const state = this.cut;
        return !!state && (state.meshes.includes(object) || state.materials.has(object?.material));
    }

    /** How much of the stone at `point` is cut away (0..1): the shader's own rule, for the QA harness and the tests. */
    cutFraction(point, eye, car) {
        return this.cut?.enabled ? cutFraction(point, eye, car) : 0;
    }

    /* ---------------------------------------------------------------- the document's props -- */

    /**
     * Re-seats the level document's props around the plaza (PROPS above). The document is the editor's, and what /world serves
     * is the published copy in the database, which a change to the seed never reaches: so this happens here, at run time, for
     * the player only (the studio never runs it, so nothing is ever saved moved), before the world is batched and frozen.
     * A prop that is not there, or is no longer where the document had it, is left alone. Returns how many moved.
     * `driving` is the player's Driving: its placement checks (map travel, respawn) must see the props where they are now.
     */
    adjustWorld(root, physics, driving) {
        if (this.adjusted || !playerMode() || !root)
            return 0;
        this.adjusted = true;
        const began = performance.now();
        this.dressArch(driving);
        this.group.updateWorldMatrix(true, false);
        const nodes = new Map();
        root.traverse((o) => { if (o.userData.aw_id) nodes.set(o.userData.aw_id, o); });
        let moved = 0;
        const movedNodes = [];
        for (const prop of PROPS) {
            const node = nodes.get(prop.id);
            if (!node?.parent)
                continue;
            node.updateWorldMatrix(true, false);
            const here = this.group.worldToLocal(node.getWorldPosition(new THREE.Vector3()));
            if (Math.hypot(here.x - prop.from[0], here.z - prop.from[1]) > 0.75)
                continue;
            // Where the node is in the world now, to carry its solid bodies by the same step afterwards.
            const was = node.getWorldPosition(new THREE.Vector3());
            let held = [];
            try {
                held = physics ? this.holdBodies(node, physics) : [];
            }
            catch (error) {
                // The physics world is not what this expects: leave this prop exactly where the document has it.
                console.warn(`plaza: ${prop.name} not moved`, error);
                continue;
            }
            const target = this.group.localToWorld(new THREE.Vector3(prop.to[0], 0, prop.to[1]));
            node.position.copy(node.parent.worldToLocal(target)).setY(node.position.y);
            if (prop.scale)
                node.scale.multiplyScalar(prop.scale / (node.scale.x || 1));
            node.updateMatrixWorld(true);
            // The trunks and the pedestal are solid. A prop that only moved takes its static bodies with it (they are built in world
            // space around an origin body, so the body moves by the step); a prop that also changed size gets new ones where it
            // stands and its old ones are switched off. Nothing is ever removed from the physics world: freeing handles there hands them
            // to bodies that are made later (the activities' penguins), and that was seen to kick the car.
            const step = node.getWorldPosition(new THREE.Vector3()).sub(was);
            if (prop.scale) {
                for (const physical of held.map((h) => h.physical))
                    physical.body.setEnabled(false);
                for (const owner of new Set(held.map((h) => h.owner)))
                    physics.mesh(owner);
            }
            else {
                for (const { physical } of held) {
                    const t = physical.body.translation();
                    physical.body.setTranslation({ x: t.x + step.x, y: t.y + step.y, z: t.z + step.z }, true);
                }
            }
            movedNodes.push(node);
            moved++;
        }
        // Where they stand, the tall ones are cut free of the car (their materials are copied before the world batches them).
        this.dressProps(PROPS.filter((prop) => prop.cut && nodes.get(prop.id)?.parent).map((prop) => [nodes.get(prop.id), prop.cut]));
        if (moved) {
            physics?.refreshQueries?.();
            // Placement keeps its own list of the scenery the physics world cannot see (trees, palms), taken at start: it must see
            // the props where they stand now. Only those entries change (a full re-read of the world would also pick up things that
            // appeared since, which the list never had).
            if (driving?.placement)
                this.reseatScenery(driving.placement, movedNodes);
        }
        this.timing.adjust = performance.now() - began;
        return moved;
    }

    /** Replaces, in Placement's scenery list, the entries of the nodes that moved: their old boxes out, their new ones in. */
    reseatScenery(placement, nodes) {
        const names = new Set(nodes.map((n) => n.name));
        const base = placement.soft;
        if (!base?.near)
            return;
        const fresh = [];
        for (const parent of new Set(nodes.map((n) => n.parent)))
            for (const box of softObstacles(parent).list)
                if (names.has(box.name))
                    fresh.push(box);
        const kept = (box) => !names.has(box.name);
        const reaches = (box, x, z, r) => box.maxX >= x - r && box.minX <= x + r && box.maxZ >= z - r && box.minZ <= z + r;
        placement.soft = {
            list: [...base.list.filter(kept), ...fresh],
            near: (x, z, r) => [...base.near(x, z, r).filter(kept), ...fresh.filter((box) => reaches(box, x, z, r))],
        };
    }

    /** The static bodies the document built for `node`'s subtree, each with the node that owned it (so it can be built again). */
    holdBodies(node, physics) {
        const own = new Map();
        node.traverse((o) => own.set(o.userData, o));
        const held = [];
        for (const physical of physics.physicals) {
            if (!physical.static)
                continue;
            for (const collider of physical.colliders) {
                const owner = own.get(physics.colliders.get(collider.handle));
                if (owner) {
                    held.push({ physical, owner });
                    break;
                }
            }
        }
        return held;
    }

    /* ---------------------------------------------------------------- the numbers -- */

    /** A medal flipped, or the progress was reset: the boards read the new totals the next time they are seen. */
    refresh() {
        for (const sign of this.signs)
            sign.invalidate();
    }

    /** What the boards say right now (for the QA harness). */
    snapshot() {
        const stats = groupStats(this.owner.groups);
        return { unlocked: [...stats.values()].reduce((n, g) => n + g.unlocked, 0), total: WORLD2_ACHIEVEMENTS.length, groups: Object.fromEntries([...stats.values()].map(g => [g.id, g.unlocked])) };
    }

    /** The faces of every sign in the world: four corners each (counter-clockwise from the lower left) and the cap height of its numerals. */
    measure() {
        const out = [];
        for (const sign of this.signs) {
            sign.group.updateWorldMatrix(true, true);
            const w = sign.width / 2, h = sign.height / 2;
            const corners = [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => {
                _v.set(x, y, 0).applyMatrix4(sign.face.matrixWorld);
                return _v.clone();
            });
            out.push({ name: sign.id, corners, capFraction: this.capFraction.get(sign.id) });
        }
        return out;
    }

    /** Draw calls and triangles this module put in the scene (for the QA harness). */
    counts() {
        let draws = 0, triangles = 0;
        this.group.traverse((o) => {
            if (!o.isMesh || !o.visible)
                return;
            draws++;
            const g = o.geometry;
            triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3 * (o.isInstancedMesh ? o.count : 1);
        });
        return { draws, triangles: Math.round(triangles) };
    }
}

/* ------------------------------------------------------------------ small builders -- */

/** A low lamp: a square post on a stone foot with a glowing head and a gold cap, 0.9 m tall. */
function lampHead(f) {
    addBox(f, [0, 0.08, 0], [0.2, 0.08, 0.2], SWATCH.slate);
    addBox(f, [0, 0.4, 0], [0.065, 0.32, 0.065], SWATCH.woodDark);
    addBox(f, [0, 0.74, 0], [0.15, 0.15, 0.15], SWATCH.peach);
    addPrism(f, 0.2, 0.89, 0.97, 4, SWATCH.gold, SWATCH.gold, 0.03);
}

/** A banner pole 4.2 m tall with a gold ball and a swallow-tailed cloth hung from a crossbar, facing +Z. */
function banner(f, cloth) {
    addBox(f, [0, 2.1, 0], [0.07, 2.1, 0.07], SWATCH.woodDark);
    addBox(f, [0, 0.12, 0], [0.22, 0.12, 0.22], SWATCH.slate);
    addLathe(f, [[0, 4.2], [0.13, 4.2], [0.1, 4.34], [0, 4.4]], 6, SWATCH.gold, SWATCH.gold);
    addBox(f, [0.5, 3.9, 0], [0.5, 0.04, 0.04], SWATCH.woodDark);
    const g = new Facets();
    addExtrude(g, [[-0.42, 0], [0.42, 0], [0.42, -1.9], [0, -1.5], [-0.42, -1.9]], 0.05, cloth, cloth);
    const positions = g.position;
    for (let i = 0; i < positions.length; i += 3) {
        positions[i] += 0.55;
        positions[i + 1] += 3.86;
        positions[i + 2] += 0.02 + Math.sin(positions[i] * 3.0) * 0.05;
    }
    f.position.push(...g.position);
    f.normal.push(...g.normal);
    f.uv.push(...g.uv);
}

/** A five-pointed gold star, a thumb thick, standing on its point. */
function star(f, radius) {
    const outline = [];
    for (let i = 0; i < 10; i++) {
        const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
        const r = i % 2 === 0 ? radius : radius * 0.42;
        outline.push([Math.cos(a) * r, Math.sin(a) * r + radius * 0.85]);
    }
    addExtrude(f, outline, 0.16, SWATCH.gold, SWATCH.gold);
    addPrism(f, 0.16, -0.14, 0.2, 6, SWATCH.copper, SWATCH.copper, 0.1);
}

/** The glow, the streaks and the foam, spliced into the water's own lit fragment shader. */
const WATER_FRAGMENT = `
  float wt = uTime;
  vec3 waterBase = diffuseColor.rgb;
  if (uMode < 0.5) {
    // The fall: v runs down the sheet, u across it.
    float u = vWaterUv.x, v = vWaterUv.y;
    float streak = 0.5 + 0.5 * sin(u * 52.0 + sin(v * 5.0 + wt * 0.35) * 1.4);
    float fall = 0.5 + 0.5 * sin(v * 36.0 - wt * 3.6 + sin(u * 9.0) * 1.7);
    float glint = smoothstep(0.55, 0.97, streak * fall);
    float foam = smoothstep(0.84, 1.0, v) * (0.5 + 0.5 * sin(u * 64.0 + v * 41.0 + wt * 2.2));
    diffuseColor.rgb = waterBase * (0.88 + 0.26 * fall) + vec3(0.5, 0.7, 1.0) * glint * 0.5 + vec3(0.95) * foam * 0.6;
  } else {
    // The pond: a slow glitter.
    float ripple = sin(vWaterPos.x * 2.6 + wt * 0.8) * sin(vWaterPos.z * 2.9 - wt * 0.6) + 0.5 * sin((vWaterPos.x + vWaterPos.z) * 3.7 + wt * 1.3);
    float sparkle = smoothstep(0.85, 1.35, ripple);
    diffuseColor.rgb = waterBase * (0.95 + 0.05 * ripple) + vec3(0.7, 0.85, 1.0) * sparkle * 0.3;
  }
`;

const MIST_VERTEX = `
  attribute float aSeed;
  uniform float uTime;
  varying vec2 vMistUv;
  varying float vMistFade;
  void main() {
    float life = fract(aSeed * 7.13 + uTime * 0.11);
    vec4 anchor = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    anchor.y += life * 1.9;
    anchor.x += sin(aSeed * 40.0 + life * 3.0) * 0.28;
    vec4 view = modelViewMatrix * anchor;
    float size = (0.75 + aSeed * 0.75) * (0.6 + life * 1.3);
    view.xy += position.xy * size;
    vMistUv = uv;
    vMistFade = sin(life * 3.14159);
    gl_Position = projectionMatrix * view;
  }
`;
const MIST_FRAGMENT = `
  uniform vec3 uColor;
  varying vec2 vMistUv;
  varying float vMistFade;
  void main() {
    float d = length(vMistUv - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.0, d);
    gl_FragColor = vec4(uColor, a * a * vMistFade * 0.3);
  }
`;

/* ------------------------------------------------------------------ painters -- */

/** A rounded progress bar. */
function paintBar(ctx, rect, fraction, tools) {
    const { roundRect } = tools;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.h / 2);
    ctx.fill();
    if (fraction > 0) {
        ctx.fillStyle = TOKENS.gold;
        roundRect(ctx, rect.x, rect.y, Math.max(rect.h, rect.w * fraction), rect.h, rect.h / 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.fillRect(rect.x + rect.h / 2, rect.y + rect.h * 0.18, Math.max(0, rect.w * fraction - rect.h), rect.h * 0.2);
    }
    ctx.restore();
}

/** The cap height of a numeral at the current font, as a fraction of the canvas, so the QA can say how big it reads. */
const capOf = (ctx, text, canvasHeight) => {
    const m = ctx.measureText(text);
    return (m.actualBoundingBoxAscent || parseFloat(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? 0) * 0.71) / canvasHeight;
};

function paintTitle(ctx, rect, tools, plaza, stats) {
    const { w, h } = rect;
    const total = WORLD2_ACHIEVEMENTS.length;
    const unlocked = [...stats.values()].reduce((n, g) => n + g.unlocked, 0);
    tools.paintWood(ctx, rect, { seed: 'plaza-title', base: TOKENS.woodDark, boards: 2, nails: true });
    // A thin cream rule inside the edge, like the lettering was inlaid.
    ctx.strokeStyle = 'rgba(246,240,230,0.28)';
    ctx.lineWidth = Math.max(2, h * 0.012);
    tools.roundRect(ctx, h * 0.075, h * 0.075, w - h * 0.15, h - h * 0.15, h * 0.04);
    ctx.stroke();
    const fit = tools.fitText(ctx, 'ACHIEVEMENTS', { maxWidth: w * 0.88, minPx: h * 0.2, maxPx: h * 0.5, weight: 800, family: tools.fonts.sans, lineHeight: 1 });
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    tools.drawFit(ctx, fit, w / 2 + fit.px * 0.03, h * 0.12 + fit.px * 0.03, 'center');
    ctx.fillStyle = TOKENS.cream;
    tools.drawFit(ctx, fit, w / 2, h * 0.12, 'center');
    plaza.capFraction.set(plaza.title.id, capOf(ctx, 'H', h));
    // How far along: a bar, and the sum in words.
    const barY = h * 0.66, barH = h * 0.1;
    paintBar(ctx, { x: w * 0.09, y: barY, w: w * 0.82, h: barH }, unlocked / Math.max(1, total), tools);
    const label = tools.fitText(ctx, `${unlocked} OF ${total} UNLOCKED`, { maxWidth: w * 0.82, minPx: h * 0.08, maxPx: h * 0.14, weight: 700, family: tools.fonts.mono, lineHeight: 1 });
    ctx.fillStyle = TOKENS.chalk;
    tools.drawFit(ctx, label, w / 2, barY + barH + h * 0.03, 'center');
}

function paintBoard(ctx, rect, tools, plaza, group, stat) {
    const { w, h } = rect;
    const theme = themeFor(group);
    const { unlocked, total } = stat;
    tools.paintParchment(ctx, rect, { seed: `plaza-${group.id}`, radius: h * 0.04 });
    const pad = h * 0.1;
    // The group's ribbon, centred, in its colour.
    const ribbonH = h * 0.15;
    const name = tools.fitText(ctx, group.name, { maxWidth: w - pad * 3.4, minPx: ribbonH * 0.34, maxPx: ribbonH * 0.58, weight: 700, family: tools.fonts.mono, lineHeight: 1 });
    const ribbonW = Math.min(w - pad * 2.4, ctx.measureText(name.lines[0] ?? '').width + ribbonH * 1.5);
    const ribbonY = pad * 0.85;
    tools.paintRibbon(ctx, { x: (w - ribbonW) / 2, y: ribbonY, w: ribbonW, h: ribbonH }, theme.ribbon, theme.ribbonDeep);
    ctx.fillStyle = theme.ribbonInk;
    tools.drawFit(ctx, name, w / 2, ribbonY + ribbonH / 2 - name.px * 0.5, 'center');
    // The count: as large as the board allows, "/n" smaller beside it.
    const pipsH = h * 0.1;
    const pipsY = h - pad * 0.95 - pipsH;
    const top = ribbonY + ribbonH + pad * 0.12;
    const area = { x: pad * 0.9, y: top, w: w - pad * 1.8, h: pipsY - top - pad * 0.1 };
    const family = tools.fonts.sans;
    const count = String(unlocked), suffix = `/${total}`;
    let px = area.h * 1.05;
    let countW = 0, suffixW = 0;
    for (; px > 10; px -= 2) {
        ctx.font = `800 ${px}px ${family}`;
        countW = ctx.measureText(count).width;
        ctx.font = `700 ${px * 0.44}px ${family}`;
        suffixW = ctx.measureText(suffix).width;
        if (countW + px * 0.1 + suffixW <= area.w)
            break;
    }
    const x0 = area.x + (area.w - (countW + px * 0.1 + suffixW)) / 2;
    const baseline = area.y + area.h / 2 + px * 0.36;
    const done = total > 0 && unlocked >= total;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `800 ${px}px ${family}`;
    plaza.capFraction.set(plaza.boards[GROUPS.indexOf(group)]?.id ?? `plaza-${group.id}`, capOf(ctx, '8', h));
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(count, x0 + px * 0.025, baseline + px * 0.03);
    ctx.fillStyle = done ? '#a9790a' : TOKENS.ink;
    ctx.fillText(count, x0, baseline);
    ctx.font = `700 ${px * 0.44}px ${family}`;
    ctx.fillStyle = TOKENS.ink3;
    ctx.fillText(suffix, x0 + countW + px * 0.1, baseline);
    // One pip per award.
    paintPips(ctx, unlocked, total, { x: pad * 1.1, y: pipsY, w: w - pad * 2.2, h: pipsH }, { on: TOKENS.gold, off: '#bda57a', ring: 'rgba(26,23,18,0.55)' });
}
