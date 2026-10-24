/* ============================================================
   ISLAND TIMBER — THE SIGN KIT (public API)

   One system for every board, plank and plaque in the world: wood
   and rope and iron built in code from the level's own palette,
   faces painted ink-on-parchment or cream-on-timber in Geist, a
   small animated picture per sign, and ONE scheduler that decides
   what repaints. Import from here and from nowhere else in the kit:

     import { Sign, SignRuntime, signMaterials, ... } from '../signs'      // TS twins
     import { Sign, SignRuntime, signMaterials, ... } from '../signs/index.js'   // public runtime copy

   Only this surface is stable. Everything below is in scope for
   other agents (Social, the Achievement plaza, Career labels, Lab).

   ------------------------------------------------------------
   1. SET UP ONCE PER CONTROLLER

     const materials = signMaterials(game.environment.group)   // finds the instance's palette material
     const runtime = new SignRuntime({ ticker: game.ticker, camera: () => game.view?.camera }, bin)
     bin.add(() => materials.dispose())

   `materials.wood` IS the level's palette material (shared, so no new shader program and nothing new to
   compile); `materials.face(texture)` builds the lit, emissive-lifted face material. Without a level around
   (a test) signMaterials() builds its own atlas. One runtime per controller or per instance is plenty:
   it owns a single 'tick' listener and paints at most ONE canvas layer per frame across all its signs.
   In /world2 (React) `game.view?.camera` may be missing: the runtime then treats signs as visible and near.

   ------------------------------------------------------------
   2. VARIANTS  (new Sign({ variant, ... }), then group.add(sign.group), position/rotate sign.group)

   All sizes are metres, +Z is the reading face, the default mount is FIXED (physical signs never billboard;
   group.userData.signMount === 'fixed'; yawToCamera(view) gives the yaw a Billboards system would apply).
   Faces repaint only when their content changes (setText / setTheme / invalidate). The runtime warms every layer
   once, out of sight, a frame at a time, so the sign is already painted the first time anyone sees it (or call
   sign.paintNow() for a synchronous frame).

   'board'  a standing board on two posts. Origin on the ground, face centre at legHeight + height/2.
            { id, width, height, title, subtitle, kicker?, theme?, emblem?, legHeight?, runtime, bin, materials }
            theme (id from SIGN_THEMES, or a record) picks ribbon colour, ornament, hardware and the small
            animated emblem (the only live layer); emblem:null turns it off.  ~700 triangles, 3 draw calls.
   'plank'  a small hewn plank for one line or one number, optionally hanging from two ropes (hang:'rope').
            Origin at its centre. { id, width, height, title | value (+title as the label above it), accent?,
            subtitle?, hang?, runtime, bin, materials }.  2 draw calls.
   'label'  a flat wooden plaque with no posts, for floating labels. Origin at its centre, +Z reads.
            { id, width, height, title, subtitle?, accent?, runtime, bin, materials }.  ONE draw call (the
            canvas is the plaque, its chamfer samples the dark border), so nine of them cost nine.
   'custom' no geometry: you attach layers (sign.addLayer) to meshes you already have (bindLayer / faceFrame).

   Common: sign.group, sign.setText({title, subtitle, value, kicker}), sign.setTheme(theme),
   sign.paint((ctx, rect, tools, sign) => ...) to replace the layout, sign.paintNow() for a synchronous first
   frame (studio thumbnails, tests), sign.dispose(). Pass `runtime` and `bin` and the sign registers and
   disposes itself.

   ------------------------------------------------------------
   3. PAINT HELPERS  (plain functions of a 2D context and a Rect {x,y,w,h})

     fitText(ctx, text, { maxWidth, maxLines?, maxHeight?, minPx, maxPx, weight?, family, lineHeight? })
        -> { lines, px, height, truncated }   largest size that wraps into maxLines, THEN ellipsizes. Never squeezes.
        Found by halving the size grid (a handful of wraps, not one per size) and remembered per context and per
        (text, options), one memory for every real canvas context: the same call again costs nothing, until fonts load
        (clearFitCache() for any other reason). measuringContext(scratch) is a context that measures and draws nothing:
        run a painter on it to have its fits ready for the real paint, one small step at a time.
     drawFit(ctx, fit, x, top, align)         draws what fitText returned
     paintWood(ctx, rect, { base?, seed?, boards?, grain?, nails? })
     paintParchment(ctx, rect, { paper?, seed?, radius?, burn?, rule? })
     paintRibbon(ctx, rect, fill, deepFill)   banner with swallow tails
     paintTag(ctx, text, x, y, h, fonts)      timber chip sized to its text, returns its width
     paintNumeral(ctx, value, rect, { color?, shadow?, weight? }) big carved digits fitted to rect
     paintPips(ctx, count, total, rect)       a row of lit/unlit pips
     signFonts() -> { sans, mono }            Geist as canvas font lists (fallbacks when standalone)
     TOKENS                                   ink #1a1712, cream, paper, timber, terracotta, teal, ochre ...
   Contrast (checked in tests): ink on paper 12:1, cream on woodDeep 8.8:1, ribbon pairs >= 4.5:1.

   ------------------------------------------------------------
   4. COLOUR AND GEOMETRY  (when you need a bespoke wooden part)

     SWATCH, paletteUV(i), recolorPalette(mesh, { fromIndex: toIndex })   recolour an authored palette mesh in place
     plankGeometry / postGeometry / pegGeometry / nailGeometry / bracketGeometry / ropeGeometry / vineGeometry /
     charmGeometry(kind) -> flat-shaded BufferGeometry (position, normal, uv) pointing at ONE palette swatch
     mergeParts([geometry | place(geometry, position, rotation, scale)]) -> one geometry, add it to a Mesh with
     materials.wood and you have one draw call.

   ------------------------------------------------------------
   5. SCHEDULING GUARANTEES (SignRuntime)

   far or off-screen: no timer and no GPU upload (a texture is uploaded by a frame that draws it); content that
   changed while unseen is brought up to date once, one layer per tick, nearest sign first, behind everything else.
   near + visible: the live emblem at 10 / 8 / 5 Hz by body.dataset.quality high / medium / low (x1.5 when
   runtime.focus(sign)); static layers once per change.  prefers-reduced-motion: one still frame per layer, no
   timer, no transform animation.  Hidden tab: nothing.
   At most one layer is painted per tick, whoever owns it, with ONE exception that exists so nobody ever sees an
   unpainted face: a layer that has never been painted and is in sight is painted at once (all of them, within a 3 ms
   budget per tick). A jump or swing of the camera forces the visibility test on that very tick (one shared watch per
   camera, so six runtimes cost one set of matrices), and a layer's `base` option is what its canvas shows before its
   first paint (paper or timber, never the black of an empty emissive map).
   A tick with nothing to do allocates nothing it can avoid (flags and whole numbers decide, loops are indexed, the quality
   tier is read at the probe): it runs in every runtime every frame. sign.addLayer() after the sign is registered wakes
   the catch-up for the new layer; anything that builds a board of its own uses BOARD_BACK for the plank behind its face.
   Sign.group.userData.sign points back at the Sign but is not enumerable, so Object3D.clone() and JSON can take the tree.

   ------------------------------------------------------------
   6. A BOARD THAT TAKES THE CAMERA, AND A BOARD THE STUDIO SAVES

   clearFocusPose({ target, position, samples, occluders, fov, ratio }) -> { position, clear, moved, ... } takes the camera pose a board
   asked for and moves it, only when it has to, to the nearest pose on the same sphere round the screen (a little higher, a little to one
   side, a little closer) that sees every sample point of the screen and has the lens free; collectOccluders(root, around, reach, ignore)
   gathers what could stand in the way once per focus (about a millisecond; ground, water and the board itself are left out).
   SIGN_DESIGN is put on a board's group as userData.signDesign: the studio rebuilds a prefab it saved by value, when it carries an older one
   and nothing in it was edited by hand (see design.ts), so its Edit view never keeps the faces of the day it was saved.
   ============================================================ */

export {
  SWATCH, SWATCH_COUNT, PALETTE_HEX, TOKENS, paletteU, paletteUV, swatchOf, recolorPalette, swatchHistogram,
  contrastRatio, relativeLuminance,
  type SwatchName, type TokenName,
} from './palette'

export {
  mergeParts, place, triangleCount, mulberry32, hashSeed,
  plankGeometry, postGeometry, pegGeometry, nailGeometry, bracketGeometry, ropeGeometry, vineGeometry, charmGeometry, CHARM_KINDS,
  Facets, addBox, addLathe, addPrism, addSphere, addExtrude, addTube,
  type CharmKind, type MergePart, type Vec3,
} from './geometry'

export {
  signFonts, loadSignFonts, onSignFontsLoaded, signFontsLoaded,
  fitText, clearFitCache, measuringContext, drawFit, ellipsize, roundRect,
  paintWood, paintParchment, paintRibbon, paintTag, paintNumeral, paintPips, drawNail,
  type Rect, type SignFonts, type FitOptions, type FitResult, type Measurer,
} from './paint'

export { signMaterials, findPaletteMaterial, FACE_EMISSIVE, type SignMaterials, type FaceOptions } from './materials'

export {
  SIGN_THEMES, MOTION_THEME, DEFAULT_THEME, themeById, themeForProject,
  type SignTheme, type EmblemKind, type HardwareKind,
} from './themes'

export { paintEmblem, EMBLEM_KINDS, EMBLEM_SIZE, STATIC_TIME } from './emblems'

export {
  Sign, SignLayer, SignRuntime, BOARD_BACK, bindLayer, faceFrame, planeSize, yawToCamera,
  type SignOptions, type SignVariant, type SignPainter, type PaintTools, type SignText, type LayerOptions, type LayerPaint,
  type FaceFrame, type QualityTier, type RuntimeEnv, type SignLike, type LayerLike, type SignState, type SignBounds,
} from './Sign'

export { clearFocusPose, collectOccluders, type ClearPose, type ClearPoseOptions, type Occluder } from './focusCamera'
export { SIGN_DESIGN } from './design'
