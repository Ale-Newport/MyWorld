/* ============================================================
   THE WINNERS' COURT — the layout, and nothing else.

   Pure numbers and two pure functions, so the level catalog (which decides
   where the map puts the car) and AchievementsPlaza.js (which builds the
   dais the car lands on) can both read them without one importing the other,
   and without the catalog loading the sign kit.

   Everything is in PLAZA METRES: the origin is the plaza's centre (the
   asset's anchor), +x east, +z south, +y up from the ground, at the scale the
   plaza ships at (1.25). See AchievementsPlaza.js.
   ============================================================ */
/** The scale the plaza was composed at: one design metre is 1 / this in the controller's own units. */
export const DESIGN_SCALE = 1.25;
export const U = 1 / DESIGN_SCALE;
/** The gameplay camera's azimuth (View.js baseTheta) and the directions that follow from it, in plan (x, z). */
export const THETA = Math.PI / 4;
export const RIGHT = [Math.cos(THETA), -Math.sin(THETA)];
export const FORWARD = [-Math.sin(THETA), -Math.cos(THETA)];

/**
 * The layout, in plaza metres. `at(r, f)` below turns "r to the right of the car on screen, f up the screen" into a
 * position: the signs are placed in the camera's own frame, which is what makes them line up on screen.
 */
export const PLAZA = {
    /** The dais: where the car is put down, where the prompt is, the centre of the composition. */
    dais: { x: 6.6, z: 13.0 },
    /** Two stepped frustums, [radius of the flat top, radius of the foot, height of the top]. */
    tiers: [[3.0, 4.6, 0.12], [1.9, 2.9, 0.28]],
    /** How far a skirt is buried, so it never floats over ground that dips (the shore). */
    sunk: 0.14,
    /**
     * The four boards stand in two pairs either side of a gate on the camera axis (3.2 m between them: the way from the pond's
     * front yard onto the dais), `f` up the screen from the dais, `at` the screen offsets of their centres.
     */
    boards: { f: 3.5, w: 1.4, h: 1.1, leg: 0.4, lean: 0.24, at: [-4.45, -2.55, 2.55, 4.45] },
    /** The title, low and to the left of the dais, where the screen has room on every shape of window. */
    title: { r: -4.85, f: 0.5, w: 2.3, h: 1.2, leg: 0.35, lean: 0.24 },
    /** The prompt's marker: over the middle of the dais, clear above the car's roof, a little right of it. Its label reads to the left, over the empty dais, clear of the car, the title and the boards. */
    prompt: { r: 0.55, f: 0, y: 2.4 },
    /** Where the map arrival puts the car: on the top tier, nose to the far corner of the screen. */
    spawn: { r: 0, f: -0.5, rotation: Math.PI * 0.75 },
    /** The cream runner that leads down the east lane to the dais (plan points, width), and the low lamps along the shore side of the lane. */
    runner: { width: 1.7, points: [[9.9, -9.5], [10.2, -3.5], [10.1, 2.5], [9.7, 7.0], [9.0, 9.4]] },
    lamps: [[12.0, -8.2], [12.0, -4.2], [12.0, -0.2]],
    /**
     * Banner poles, on the far (north-west) half only: tall things there cannot stand between the lens and the car. [x, z, cloth]
     * The two on the north road flank it OUTSIDE its lanes (`road`), a pole's distance from the arch's own width either side, so a car that
     * drives the road's east edge, the verge between the cobbles and the shore, is not stopped by a pole 8 m before the arch.
     */
    poles: [[-6.1, -15.4, 'copper'], [3.9, -15.4, 'teal'], [-12.9, -4.4, 'gold'], [-12.9, 5.4, 'cream']],
    /** The road the car comes in by from the north, to the arch: the x of the centres of its lanes (west, east), and the z where the poles flanking it stand (nothing solid stands inside the lanes north of the arch). */
    road: { lanes: [-4.0, 1.9], north: -9 },
    /** The gold star on the arch's crest. */
    finial: { x: -1.1, y: 9.05, z: -2.9, radius: 1.0 },
    /** The disc's cream ring (radius, width) and the stretch of it left out where the dais and the north path cross it, in degrees (z south). */
    ring: { radius: 11.6, width: 0.4, gaps: [[38, 90], [-105, -75]] },
};
export const at = (r, f, base = PLAZA.dais) => [base.x + RIGHT[0] * r + FORWARD[0] * f, base.z + RIGHT[1] * r + FORWARD[1] * f];


/** Height of the dais at a distance from its centre (metres): the flat tops and the ramps between them. */
export function daisHeight(distance, tiers = PLAZA.tiers) {
    let height = 0;
    for (const [top, foot, h] of tiers) {
        if (distance <= top)
            height = Math.max(height, h);
        else if (distance < foot) {
            const lower = tiers.find(([, , other]) => other < h)?.[2] ?? 0;
            height = Math.max(height, lower + (h - lower) * (foot - distance) / (foot - top));
        }
    }
    return height;
}

/**
 * Where the map puts the car when it travels to the plaza, in the asset's own (Blender) frame: on the top tier of the dais,
 * nose to the far corner of the screen. `anchor` is the asset's anchor, `y` the Blender spawn's height.
 */
export function plazaArrival(anchor, y) {
    const [x, z] = at(PLAZA.spawn.r, PLAZA.spawn.f);
    return { position: [anchor[0] + x * U, y, anchor[2] + z * U], rotation: PLAZA.spawn.rotation };
}
