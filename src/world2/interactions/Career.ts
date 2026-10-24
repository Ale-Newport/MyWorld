import * as THREE from 'three'
import type { Bin } from '@/world/core/Disposal'
import type { World2Game } from '../World2Game'
import type { References } from './references'
import { Billboards, MAP_HIDDEN_LAYER, type BillboardHandle } from './Billboards'
import {
  CAREER, CAREER_FIRST_MONTH, CAREER_LAST_MONTH, CAREER_FIRST_YEAR, CAREER_TRACKS,
  type CareerStop, type CareerTrack,
} from '../content/career'
import {
  Sign, SignRuntime, TOKENS, drawFit, drawNail, fitText, paintParchment, paintWood, roundRect, signFonts, signMaterials,
  type SignMaterials,
} from '../signs'

/* ============================================================
   PORTED FROM: sources/Game/World/Areas/CareerArea.js
   folio-2025 — Copyright (c) 2025 Bruno Simon — MIT
   See THIRD_PARTY_NOTICES.md.

   A stretch of road IS the CV. Blender authors it as four
   parallel lanes down a 6.56 x 17.73 m plate — three for the
   career and one, nearest the driver, for the year — and hangs a
   stone on each lane at each event. Drive into a stone's span and
   it rises 2.5 m out of the ground, then slides with you for the
   length of that job while its label wipes in from the left.

   WHAT BLENDER OWNS, and this file only reads: the lanes' X
   positions (23.04 / 25.05 / 27.06 / 29.05), the year lane's
   rim, the stone's mesh, the year plate and its four
   seven-segment digits. (It also authors a frame for the labels,
   45 degrees of yaw and 15 of lean; a label that keeps one pose
   reads sideways the moment the camera is dragged round, so the
   labels no longer use it: see THE LABELS.)

   WHAT THIS FILE OWNS: which stop stands where. Upstream sorts
   its six stones down the road by position and pours one flat
   list into them. Alejandro's career is three threads running at
   once — a degree, a job and a project are not alternatives — so
   each lane carries one KIND of thing and every lane is measured
   against ONE time axis, which is what makes two stones drawing
   level mean "these overlapped".

   The year plate is the authored one, driven the authored way.
   An earlier pass here hid the digits and painted a canvas
   instead, on the belief that the plate stood edge-on to the
   road. It does not: every digit normal is +Y and the whole
   readout lies face-up, which is exactly how the camera sees it.
   It does not stand beside the car (there the car, and the stone
   sliding with it, hid its bars from the chase camera) nor ahead
   of it (there the labels run across it): it stands to the LEFT
   of the car on the screen, the one place nothing else is, as
   near as the picture allows, and as big as the room there is: a
   phone held upright sees only 6 m of road across, so the plate
   is shrunk (never below 0.6) until it fits beside the car instead
   of under it, where its digits read as painted on the bonnet.
   Its lit bars stand a few metres in front of the scene in depth
   (not on the screen), so the car or a stone can never hide one,
   and a label that would still meet it, on a phone with no room
   for all this, fades out of its way: the year is never half
   hidden and never tangled.

   THE BORDERS ARE DRAWN HERE TOO. The grey raised rim round
   each stone's socket, and along the channel between the two
   ends of a stop, is Blender's drawing of Bruno's six stones;
   it cannot be moved onto nine stops that overlap in time. So
   it is rebuilt from the same list of sockets that places the
   stones and the coloured floor, and the hole in the rim is
   the coloured shape because one profile makes both.
   ============================================================ */

/** How far a stone rises. Upstream's `lines.activeElevation`. */
const ELEVATION = 2.5
/** Lead-in and run-out around a stone's span, in metres. */
const PADDING = 0.25
/**
 * No stop gets less road than this. Pansofía ran three months, which on a true
 * scale is 1.06 m — a tenth of a second at speed, so its label would flash and
 * go. Short stops are grown around their own midpoint, so the moment a stone
 * is level with you stays honest even when its length is not.
 */
const MIN_SPAN = 2.1
/*
  THE LABELS. Each stop's label is a wooden plaque from the sign kit (../signs): ink on parchment in a timber
  frame, a band in the lane's colour with a little picture of what the lane is. It floats beside the TOP of its
  stone and rides it up and along the road.

  It is an UNROTATED plane (+Z reads, +Y up) in a pivot that stands at the stone, and the pivot is a spherical
  billboard (./Billboards): the plaque is parallel to the screen whatever the camera does, so it never reads
  sideways, mirrored or edge-on when the player drags the chase camera round, whatever frame the area sits in.
  The plaque's left edge is on the pivot's right, so it still grows out of the stone to the right when it is
  revealed: the wipe is an along-the-plaque discard in its own shader, and the plaque is not squeezed.

  A plaque is built the first time the car comes within reach of the road, one a tick, nearest the car first
  (or at once, if the car is dropped onto its stone), and painted by the kit's scheduler out of sight: nothing
  of it exists for a visitor who never drives here.

  A plaque speaks only while the car is near its stone and the stone is in the picture (see REVEAL_RADIUS, `canSpeak`):
  being level with a stop down the road is not enough, a car on the far side of the grass is level with all of them.

  Beside its stone is only where a plaque WANTS to be. Where it STANDS is decided on the screen, every frame, by
  `layoutPlaques`: inside the box the page leaves it (below the top bar, whatever the screen's height), apart from
  the other two, and off the three places that must stay readable or visible: the year plate, the car, and the
  column of touch buttons. A short screen (a phone on its side) grows the plaque until its subtitle is 12 px, and a
  camera that is zoomed in never makes it bigger than the screen's default camera does (see DESIGN_SLACK); a screen
  that has room never gives it more than WIDTH_SHARE of its width. It stands no further from its stone than GAP_SHARE
  of the screen's shorter side: where the car, the plate and the others leave it no place that near, it does not
  speak (see HOW FAR A PLAQUE MAY STAND FROM ITS STONE). A plaque that is only wiping away is left where it stood.

  LANE_LIFT is how high above its stone's top the plaque's centre floats, in world metres, by lane. Three lanes
  speak at once and their stones all slide with the car, so their plaques are one lane apart on the screen
  (2 m of road across the lanes is 1.4 m right and 0.9 m down at the chase camera) and a plaque is 0.91 m
  tall: a small step is all that keeps two from touching, and a big one pushes the top plaque off the screen.
*/
const LANE_LIFT: Record<string, number> = { education: 0.95, work: 0.75, projects: 0.55 }
/** A plaque's size in metres: the authored two-line labels are 0.91 m tall, and no name is given more than 4.4 m. */
const PLAQUE_HEIGHT = 0.91
const PLAQUE_MAX_WIDTH = 4.4
/** In the plaque's own (screen) metres: its left edge stands this far right of the stone's axis, clear of the stone's body. */
const PLAQUE_GAP = 0.36
/** Draw order of the plaques, in the transparent queue: after the car's glass and the rest (0), under the prompts (6-8) and the year readout (10). A lane is one more than the one before. */
const PLAQUE_ORDER = 3
/** Canvas resolution for the plaques, in pixels per metre of face. 420 was 3.6x what the chase camera can show of a label at 21 m; 280 is still 2.4x, which the mip chain and a 2x display use. */
const LABEL_DPM = 280
const LABEL_ANISOTROPY = 4
/** What a plaque's colours are multiplied by before the renderer's own tone mapping: paper reads as the Projects boards' paper does. */
const PLAQUE_LIGHT = 0.84
/**
 * The camera distance up to which a plaque keeps its authored size, and how far it may grow past that (21 m at 16:9, 31 m on
 * a phone held upright, 56 m fully zoomed out): the type never drops under about 12 px on a phone.
 */
const PLAQUE_SCALE = { ref: 31, min: 1, max: 1.8 }
/**
 * Where a plaque may stand on the screen, in clip space (-1..1), and how far apart plaques keep. A stone three lanes away from
 * the car is above the top of the picture at the chase camera, and a plaque wider than a phone's half-screen runs off its
 * side: neither can be read cut in half, so a plaque that would leave this box slides back into it, and two that would overlap
 * (a dragged camera brings the lanes level on the screen) stack one under the other. This is the box where the page has no top
 * bar to keep clear of (its `top` is then the margin); with one, the top of the box is the bar's bottom edge (see `Hud`). The
 * year plate, the car, the touch buttons and the speed readout are places no plaque stands on (see `settlePlaques`). Where
 * nothing is wrong, nothing moves.
 */
export interface Safe {
  x: number
  top: number
  bottom: number
  spacing: number
  /** The screen's width over its height: how far a move sideways is, set against one up or down. 1 when not given. */
  aspect?: number
}
export const SAFE: Safe = { x: 0.94, top: 0.8, bottom: 0.9, spacing: 0.02 }
/** How fast a plaque slides to its place, per second. */
const SLIDE_RATE = 10
/**
 * The smallest a plaque's subtitle may be on the screen, in CSS px, whatever the screen: a plaque's size follows the camera's
 * distance, and a phone on its side has the camera as near as 21 m with a screen only 375 px tall, so there the plaque is
 * grown (to at most FIT_MAX times, in its own frame, on top of the billboard's distance factor) until its subtitle is this big.
 * A screen with room never changes (the factor is 1 on a desktop at its default camera, where the subtitle is 20 px); it is about
 * 1.4 on a phone on its side and about 2 on one with the camera fully out, and a plaque is then about 50 px tall.
 */
const MIN_SUB_PX = 12
const FIT_MAX = 2.2
/*
  WHERE A PLAQUE SPEAKS AT ALL. A stop speaks while the car is level with it down the road, which says nothing of how far
  across the grass the car is: from the far side of the world, in a line with the walk, every plaque used to be revealed, and
  the layout (which pulls a plaque into the picture from wherever its stone is) hauled it across the screen and up to the lens:
  a slab 3000 px wide. A plaque is tied to its stone, so it speaks only while the car is within REVEAL_RADIUS metres of the
  stone across the lanes (the lane group is 6 m wide) AND the stone's anchor is in the picture, or within VIEW_MARGIN of it (a
  stone that is only just past the edge: further out, even the nearest place in the box is too far from it, see GAP_SHARE). Both have a HOLD, so the edge between
  speaking and silent is a band the car crosses once, not a flicker; and a stone nearer the lens than NEAR_CUT metres along the
  lens axis has no plaque (it would be the picture). A plaque nearer the lens than NEAR_SHARE of the car's depth is drawn no bigger
  than one at that depth (down to where its subtitle is MIN_SUB_PX): the size it has on the screen is its design size, 1.25 times
  at most, whatever the camera is dragged to and wherever the stone is. A stone on the lanes is never that near on the default camera.

  THE DESIGN SIZE IS THE DEFAULT CAMERA'S, NOT THE CAMERA'S NOW. The car's depth moves with the zoom (a pinch on a phone takes the
  camera from 31 m to 15 m, a wheel on a desktop from 21 m to 15 m), and a size held to "the car's depth" follows it: a plaque
  that fills 55% of a phone at the default camera filled 117% to 173% of it pinched in. So a plaque is also drawn no bigger than
  DESIGN_SLACK times the size it would have, at its own place on the screen, with the camera at its default distance for this screen
  (`defaultDepth`, the View's own formula, which depends on the screen's shape): zoomed in, the stone gets bigger and the
  plaque stays the size it is at the start, so its subtitle is never under what the default camera gives it, and never over.
*/
const REVEAL_RADIUS = 14
const REVEAL_HOLD = 3
const VIEW_MARGIN = 0.05
const VIEW_HOLD = 0.2
const NEAR_CUT = 4
const NEAR_SHARE = 0.8
/** How much bigger than its size with the camera at its default distance a plaque may be drawn (the distance factor is read off the distance to the plaque, not its depth, so the two sizes are not exactly alike at the default camera either). */
const DESIGN_SLACK = 1.05
/** The View's zoom at the start (`View.zoom.baseRatio`): the camera's default distance is the one it has there. */
const DEFAULT_ZOOM = 0.6
/** The depth the design size is made for where there is no car to measure it at (the chase camera's, at its default). */
const REFERENCE_DEPTH = 21
/*
  HOW FAR A PLAQUE MAY STAND FROM ITS STONE, AND HOW WIDE IT MAY BE. A plaque says which stone it belongs to by standing beside it
  (and by its colour); the layout moves it to clear the car, the year plate and the others, and on a screen that is crowded (a
  phone, where the car is half the width and a plaque two thirds of it) it used to move it across the picture: a plaque at the
  bottom for a stone at the top, to be matched by colour alone, up to two screen widths away when the camera was orbited. So the
  layout has a hard limit: the nearest edge of a plaque is never further from its stone's anchor than GAP_SHARE of the canvas's
  shorter side. A candidate place further than that is not a place. Where a plaque has none that is clear (the others, the car and
  the page's buttons take the room near its stone) it does not speak instead of standing on them: it is given up when its best place
  would put more than a small share of it under the car or the year plate (HIDE_SHARE, and HIDE_NEAR more for the stone the car is on, down to
  nothing more for the one furthest from it across the lanes, LANE_SPREAD away; HIDE_KEPT more for one that is speaking already, so the
  arrangement that is showing is not swapped for another that is no better: the shader's hole takes the car and the plate out of a plaque,
  and on a phone on its side there is no other room), and always when it would stand on another plaque or on the page's buttons. A plaque
  that has given way is tried again every frame with the limit at GAP_ENTER of what it is for one that is speaking (one that has not spoken yet has no verdict to flip: it is asked as one that speaks), and no more
  of it may be covered, so the edge between speaking and silent is a band, not a flicker. A car that crosses the lanes at speed can
  leave a plaque with no place for a tenth of a second, while the stones rise and the others change places: a plaque that has stood
  gives way only when it has had none for GIVE_UP_AFTER seconds, and is let back only when it has had one for REVIVE_AFTER (a plaque
  that has not stood yet, which has nothing to lose, is not asked to wait: it does not speak at all).
  WIDTH_SHARE: no plaque is wider than this share of the canvas, unless its subtitle would then be under MIN_SUB_PX: a tablet held
  upright (834 px wide, a 20 px subtitle) used to give plaques up to 62% of its width.

  THE VERDICT HAS TO HOLD. A plaque that is let back and given up again, over and over, with the car parked and the camera still, is
  the worst thing the edge between speaking and silent can do (it stood half wiped under another plaque, for ever, on a phone on its
  side). The causes that were found, and what is done about each:
  - A plaque that was let back stood where it had stood before it was given up, as far as the layout was concerned: the place it had
    just been tried at was not the one `settlePlaques` preferred to keep it at, and a margin on the old one moved its neighbour out
    of reach. A plaque that is let back stands at the place it was tried at (`lastDx`, `lastDy`) from then on.
  - The test for a place to speak at was not the test for a place to go on speaking at: the first was made with a smaller reach, in a
    layout that already had the plaque in it, and moved the plaques that were speaking to make room. Now the plaques that are
    speaking are laid out alone (their layout never depends on a plaque that is only trying), and a plaque that is trying is laid
    out with them as if it spoke (within GAP_ENTER of the reach, at the price of one that is trying, less than one that speaks by
    HIDE_KEPT: the edge between speaking and silent is a band), the plaques that are speaking making room as they would; it has a
    place when there is one, and no plaque that speaks is given up for it or put on the car, the plate or a button.
    Only when it has had a place for REVIVE_AFTER does the layout change: the arrangement it was tried in (with the plaques that
    are due, and no other that is trying) is the arrangement from then on. A plaque that is trying never moves one that speaks.
  - A plaque that speaks is given up only if the layout has no place for it without its history either (`recover`): the place it stood at
    is what the layout prefers to keep it at, and when that place is no longer a good one (a camera that jumped) it was the one thing that
    left it without a place, where a plaque that is trying, with no history, had one.
  - Whatever else is left (a layout that cannot be asked the same question twice and answer alike), a plaque that is given up again
    within LATCH_WINDOW of being let back (5 s of the game's clock, which runs at twice real time: 2.5 s; the cycles that were found had periods of 0.23 s, 0.8 s and 2.4 s), or that has no place in the arrangement it is let back into, stays silent until
    what the layout is asked has changed by more than LATCH_EPS (clip units) in any number: a camera or a car that moves, a stone
    that is still rising, a button that appears. A verdict is not asked twice of the same question.
  SLIDE_MAX_PX: however the layout rearranges the plaques (a plaque the car leaves room for takes its place back, and the others make
  way) none slides against its stone faster than this, in CSS px per second of the game's own time (the ticker's scale doubles the
  clock): an arrangement that changes in one frame, or for three, is crossed over a few, not in a step of a hundred px. A plaque that is
  cut by the canvas (out of it by more than ASTRAY), or that the car has driven onto (STANDS_MIN of it on the car, the plate or a button), is not
  held to it: the limit is for the plaque that is well placed. And a plaque that is let back while it is less than REVIVE_SNAP revealed (a stub, standing
  where it stood when it was given up) is put where it was tried at once, not slid there across the screen: at the speed limit it lay
  across the car for a moment while it appeared.

  THE ARRANGEMENT HAS TO HOLD TOO. Three plaques on a screen with little room are a handful of near-equal arrangements (beside the car or
  over it, which one takes the top), and a lane that changes its stop, a stone that rises, or a car that crosses the lanes (or only shuffles a
  quarter of a metre to and fro) tips a layout that picks the cheapest arrangement afresh every frame from one to another for a few frames and back:
  the plaque that crossed the screen for it was a kick, then a slide across the car with its words under the shader's hole, then (when a way over
  the car is not slid) a plaque that wiped away and in again, in the same place, while it spoke. So the layout is not asked to choose again:
  - A plaque stands where it stood (`settlePlaques`, KEEP FIRST). Highest first, every plaque that stood somewhere last frame is put there again if that is still a
    place; only the plaques that have none (a new one, or one whose place is taken) are put at the nearest clear place among those, and last a plaque that kept its place
    goes to a better one only if that is worth a change of mind and the place is clear of every other plaque where it stands: no plaque is made to move for another's
    sake, and a place that has opened for the one that came first does not take the place of the one that stands in it. "Still a place" is a band, not a hair (LEAN_Y, LEAN_X,
    LEAN_HARD, LEAN_REACH, LEAN_NEAR): the place may lean into the margins that keep a new place clear (the spacing, the car's margin, the page's controls), and the places
    a few thousandths of it are leaned into too, so that a squeeze that is short by 5 thousandths of the screen moves the plaque by that much; a plaque that stands against the
    top of the box stays against it while the stone rises (its place is brought back into the box, not a hair over it).
  - A plaque that is trying finds room among the plaques that speak (`admit`): they stand where the first asking put them (`pin`), and the plaque that is let back takes
    the room that is there. Only a plaque with no room among them is asked about with them free to make way (`displace`), and then only if none of them is sent across the
    car, the year plate or a button, and after REVIVE_AFTER + SETTLE_AFTER of the same answer.
  - SETTLE_FAR, SETTLE_SAME, SETTLE_AFTER (`settle`): a plaque that speaks (and one that has just been let back: it stands where it was tried) is sent far (SETTLE_FAR, on the screen)
    from where it stands only if the layout goes on sending it about there for SETTLE_AFTER; a move of a few px is followed at once, and so is the move of a plaque whose place has
    stopped being one (the car, the plate or a button is on it, it is out of the box or out of reach of its stone). And a plaque that is showing is never sent across the car, the
    plate or a button for a better place, however long the layout goes on sending it: only off one.
  - CROSS_LENGTH, CROSS_AFTER (`crosses`): a plaque the layout sends across the car, the year plate or a button, to the other side of it, does not slide there (it would be under it
    for the time the slide takes): it wipes away where it stands, and wipes in at the new place (`Line.relocating`, RELOCATE_HIDDEN) once the layout has gone on sending it there
    for CROSS_AFTER (CROSS_ON if it is under the car by more than a graze); and if the layout goes back to the place the plaque stands at while it wipes away, it wipes back in
    where it is. Nothing is rearranged on the screen without being hidden or in sight of nothing it can cover.
  - REVIVE_WARY: a plaque that was held silent (given up again soon after it was let back) is let back only after a longer moment of room.
  - `rescue` (RESCUE_MOVE): a plaque is not given up for want of a rearrangement: if keeping leaves a plaque that speaks with no room, and the layout as it was before the plaques kept
    their places (everyone by cost) has room for it while the others only make way a little and none is sent across a place kept off, that arrangement is taken.
  - SETTLING: for the first moments after the car comes within reach (the camera catches up with the car, the stones rise) nothing has been seen standing: the plaques are moved for each
    other and let back at once, and none is held wary or kept from making way.
*/
const GAP_SHARE = 0.26
const GAP_ENTER = 0.8
const LANE_SPREAD = 6
const HIDE_SHARE = 0.06
const HIDE_NEAR = 0.04
const HIDE_KEPT = 0.02
const GIVE_UP_AFTER = 0.3
const REVIVE_AFTER = 0.15
const LATCH_WINDOW = 5
/**
 * A plaque that was held silent (given up again soon after it was let back: see LATCH_WINDOW) has shown a layout that cannot make up its mind, and is let back only after a
 * longer moment of room, REVIVE_WARY (a car that shuffles a quarter of a metre twice a second leaves room for a tenth of a second at a time at a squeeze, and the plaque
 * that is let back for it is given up for the next); it is trusted again after WARY_RESET of speaking.
 */
const REVIVE_WARY = 1
const WARY_RESET = 10
const LATCH_EPS = 0.004
const SLIDE_MAX_PX = 400
const REVIVE_SNAP = 0.35
const SETTLE_FAR = 0.08
const SETTLE_SAME = 0.15
const SETTLE_AFTER = 0.25
const RELOCATE_HIDDEN = 0.1
/** A plaque that is less revealed than this when it is to be put across the car is put there at once, not wiped away and in. */
const RELOCATE_FAINT = 0.5
/** How fast a plaque that is being put somewhere else wipes away (the wipe in is 3 a second, like any): it is not a plaque going, it is a plaque being moved. */
const RELOCATE_RATE = 9
/** ...which it reaches after this many seconds of the wipe. */
const RELOCATE_RAMP = 0.1
const CROSS_LENGTH = 0.12
/** How far, on the screen, a plaque that speaks may be moved to make room for one that has none (see `rescue`), unless that one has had none for RESCUE_AFTER. */
const RESCUE_MOVE = 0.25
const RESCUE_AFTER = GIVE_UP_AFTER / 2
/** For this long (in the layout's clock) after the car comes within reach of the stones, the plaques are still finding their places (the camera is still catching up with the car, and the stones are rising): they are moved for the others, or held silent, as if they had not been seen (see `settling`). */
const SETTLING = 3
/** How long the layout has to go on sending a plaque across the car, the year plate or a button before it is wiped away and in elsewhere (a way that is across for a few frames is a layout that has not made up its mind). */
const CROSS_AFTER = 0.4
/** ...or for this long if the plaque stands on it by more than STANDS_MIN each way (the car on it, not a graze of its margin), or where it stands is out of the box or beyond the reach of its stone (it is waiting at a place that has stopped being one). */
const CROSS_ON = 0.04
/** How many plaques that speak the layout can be asked to find room among (one per lane). */
const PINS = 4
const STANDS_MIN = 0.03
const ASTRAY = 0.012
const WIDTH_SHARE = 0.4
/** How far, in CSS px, a plaque keeps from the page's own controls (from the top bar, and from the buttons and the speed readout), and how often the controls' places are read. */
const BAR_CLEAR_PX = 10
const HUD_CLEAR_PX = 8
const HUD_POLL_MS = 250
/**
 * The car, as a plaque keeps off it: the radius of its footprint, and how far its body stands below and above the point the
 * player is read at (metres), and a margin in clip space. The car is about 2.8 m by 2 m (with its wheels) and turns, so its footprint
 * is a circle: on the screen an ellipse at the camera's elevation, with the body's height added. `wide` is how far the car stands across
 * the screen from the point it is read at, whichever way it turns and the camera is turned: about the radius of the circle its corners and
 * wheels draw (1.63 m, measured off the car's own vertices; the shader's feather reaches a few px past the hole's rectangle, and covers the
 * rest), where `radius`, 1.45, is what the ellipse's height was tuned with: the shader's hole, the car's rectangle, stood 10 to 14 px
 * short of the car's wheels at each side, and a plaque that was wiping away there lay over them (1 to 2% of the car's vertices on a phone).
 */
const CAR_KEEP = { radius: 1.45, wide: 1.60, below: 1.1, above: 0.7, pad: 0.015 }

/**
 * Seven-segment bitmasks, A..G in the order the authored digit meshes carry in
 * their second UV set: A top, B top-right, C bottom-right, D bottom, E
 * bottom-left, F top-left, G middle.
 */
const SEGMENTS = [0b0111111, 0b0000110, 0b1011011, 0b1001111, 0b1100110, 0b1101101, 0b1111101, 0b0000111, 0b1111111, 0b1101111]
/**
 * A lit segment rises out of the plate. The authored rest pose is 0.0293 m
 * inside it, under a rim standing 0.0293 m proud of that, so this is the push
 * that brings a bar up flush and a little over — in the digit's own local
 * units, which its node scales by 0.1434.
 */
const SEGMENT_RISE = 0.42
/** What a lit bar, and the year lane running to the plate, are drawn in: paper white, warm. */
const READOUT = '#fff1c9'
/**
 * The plate lies flat and, from the fixed chase camera, a digit's "up" ran 56 degrees
 * off screen-up: a 20 px-wide parallelogram at the default zoom. It turns about Y to
 * face the lens and grows by this much, which still keeps its box clear of the
 * education rim at every heading (3 cm at the tightest, a quarter of a metre at
 * the default camera).
 */
const PLATE_SCALE = 1.38
/**
 * On a narrow screen there is not room for it. A phone held upright sees only about 6 m of the road across (the plate is 2.8 m at
 * PLATE_SCALE and the car 3 m), and on the lane next to the plate the car and the plate cannot both be on the screen side by
 * side: at full size the plate stood under the car and its digits were painted on the bonnet. So the plate takes the largest
 * size, between a floor and PLATE_SCALE, at which it stands on the screen with CAR_BODY metres of clear ground between its
 * right edge and the car's middle (see `fit`): the full size wherever there is room (a desktop, a phone on its side), 0.7 on a
 * 390x844 phone, and it follows the camera's zoom. It does not depend on where the car is on the road (only by the perspective
 * of the lane, 15% across the whole width of it, which keeps the plate the same size on the screen), so it never swells and
 * shrinks as the car changes lane.
 *
 * The floor is not a scale but a width on the screen, PLATE_MIN_PX css px (a digit about 15 px tall). A scale would have held the
 * plate at the same size in the world while the camera came in on it, and a phone that pinches in is playing the way phones are
 * played: the plate grew on the screen until it filled the car's side, and where no size fitted it went back to PLATE_SCALE and
 * lay across the bonnet. A width on the screen shrinks the plate in the world as the camera comes in, to the same size on the
 * screen, which is as small as it is worth reading.
 */
const PLATE_MIN_PX = 74
/**
 * On a screen narrower than this the floor is the same share of the width it is on this one, not the same number of pixels: a 360 px
 * phone pinched in to a 25 m camera sees only a few metres of road across it, and left of a car that must be CAR_BODY clear of the
 * plate's right edge there is little room: a 74 px plate did not fit, and was away, at three places in the walk where one of 70 px
 * does. Held at 74 px on every screen from this width up.
 */
const PLATE_MIN_WIDTH = 390
/** What the floor is, as a share of the width, where the page has not been measured (no document: the editor's preview). */
const PLATE_MIN_SHARE = 0.19
/**
 * Where the screen has no room for the plate left of the car even at its floor (a phone that has been pinched in sees 3 m across
 * and the car fills it) it is away: shrunk to nothing where it stands, and back as soon as it fits. It is never drawn on the car,
 * and there is nowhere else for it to stand: above the car is where the stones that rise with it, and the labels, are, and a
 * stone in front of the digits read "7025" for 2025. A plate that has gone away needs MODE_HYST metres more room than it left
 * with to come back, so the edge between the two is not a flicker. PLATE_AWAY off keeps it beside the car at its floor, on it
 * (the QA's negative control).
 */
const PLATE_AWAY = true
const MODE_HYST = 0.2
/**
 * How fast the plate shrinks to the size the screen leaves it, and how fast it grows back, per second. It gives way at once (a plate
 * that stays too big stands on the car) and takes its room back slowly: the room is read off where the car is on the screen, and the
 * chase camera lets the car swing about the middle of it while the car accelerates, which made a phone's plate breathe between 0.6
 * and 1.4 within a second. A pinch takes the room away as fast as the fingers move (0.2 of the zoom range a second is an easy one),
 * and a plate that gives way at 6 a second is 0.04 behind it, 7% of its rectangle on the bumper: it gives way at 20 (0.3 of the
 * zoom range a second, a quick pinch, leaves it 0.017 behind).
 */
const PLATE_SHRINK = 20
const PLATE_GROW = 1.5
/**
 * Halvings of the range between the floor and PLATE_SCALE: 8 gives the size to a third of a percent. The size is solved every FIT_EVERY
 * frames, and every frame while the camera is coming in or going out (it moved more than CAMERA_MOVING metres from the car since the
 * last frame: a pinch, or the car picking up speed), when a size that is up to a tenth of a second old is the plate on the bumper.
 */
const FIT_STEPS = 8
const FIT_EVERY = 6
const CAMERA_MOVING = 0.01
/** How fast the plate turns toward the camera, and a bar rises or sinks, per second. */
const PLATE_TURN = 6
const BAR_RATE = 9
/** The year turns over only this far (metres of road) past a boundary, so a jittering car cannot flicker it. */
const YEAR_HYSTERESIS = 0.15
/**
 * Where the plate stands, in metres of road from the car (positive: ahead of it). The chase
 * camera looks along a diagonal, so ground ahead of the car is up and to the RIGHT on the
 * screen and ground behind it is down and to the LEFT, and the plate stands 2 to 6 m in from
 * the car's lane. Level with the car it is under the diagonal that runs through the car's roof
 * and the stone sliding with it 2.5 m up (the units digit read "2021" for 2027); ahead of the car
 * it is where the labels run, up and to the right: a job's name crossed the year.
 * With PLATE_SLOT it stands where nothing else does, LEFT of the car on the screen, as near as
 * the picture allows, with CAR_CLEAR metres between its right edge and the car's middle. Without a
 * camera to measure against (the editor's preview), or with the slot off, it stands PLATE_LEAD ahead.
 */
const PLATE_LEAD = 2.4
const PLATE_SLOT = true
const CAR_CLEAR = 1.9
/**
 * The least ground that may separate the plate's right edge from the car's middle (camera-space metres): the car's body is
 * 1.6 m either side of its middle on the screen at its widest heading, and 1.5 leaves only a wheel's corner at the edge of
 * the plate's frame. CAR_CLEAR is where the plate would like to stand; this is what the size is solved for.
 */
const CAR_BODY = 1.5
/**
 * How much nearer the lens than its middle the car's edge stands: the bumper, a wheel, the roof (the car is 3 m long and the chase
 * camera looks along its diagonal and down on it). A point that stands out to the side on the near part of the car is further out on
 * the picture than the same point at the middle's depth says, by the ratio of the two depths: 3% on a phone's 31 m camera, 6% on a
 * pinched-in 15 m one, where the plate stood against the bumper with its last digit under it (up to 10% of the plate under the car,
 * 5% of the lit pixels on it). See `carEdge`.
 */
const CAR_NEAR = 0.9
/**
 * The most it may stand behind the car, and ahead of it, and how far past the end of the road: a narrow screen needs all three,
 * the last for a car that has driven on past the end of the walk (at 3 m a phone lost the left of the digits). Behind it is 5.5 m so
 * that a car standing west of the plate's lane, where the plate has to stand further back to be left of it, still has the room: at 4 m a
 * car 0.7 m west of the lane drove over the plate on a desktop.
 */
const PLATE_BACK = 5.5
/** The slide never trails the bounds of the screen (see `update`): off, it did, by up to 16 px of the frame on a phone at speed. */
const FOLLOW_CLAMP = true
const PLATE_LEAD_MAX = 7
const PLATE_OVERRUN = 5
/**
 * The plate's home is the first metre of the year lane, and a car that comes into the walk from the plaza drives over it: it
 * arrives from up the road, where the plate stands, and the plate is to end up behind it, left of it on the screen, so the two
 * cross. A plate that waited for the car at its home was under it on lanes 23 to 26 for the last 3 or 4 m of the plaza, with its
 * digits painted on the bonnet (up to 83% of the plate under the car). Nothing that moves along the lane can cross a car on the
 * lane beside it without a moment of overlap, so the plate does not cross it in view: when its home is about to be within
 * DODGE_ENTER metres of the car's middle (camera space, the same measure as CAR_CLEAR) it steps aside, to where the slot puts it
 * behind the car, and it goes home again when the home is DODGE_EXIT metres clear of the car (the gap between the two keeps it
 * from flickering at the edge). A jump of the plate's target of more than HOP metres (that, or the car being put somewhere else)
 * is not a slide across the plaza: the plate shrinks out of sight in 1/POP_OUT s, stands where it is going while it is nothing,
 * and grows back in 1/POP_IN s. DODGE_MAX is how far behind its home it ever stands.
 */
const DODGE_ENTER = 2.6
const DODGE_EXIT = 3.8
/** Of the clearance beyond the car's own body, how much is asked of the height: a plate above the car is clear by less than one beside it. */
const DODGE_ABOVE = 0.6
const DODGE_MAX = 16
const HOP = 2.5
/** A target that moves as fast as a car can (m/s, a boosted car is 22) is a slide however long the frame was, not a hop. */
const HOP_SPEED = 25
const POP_OUT = 8
const POP_IN = 5
/**
 * Where the plate and a label still meet (a phone has no room for the slot), the plate wins: a label fades out of
 * the plate's rectangle on the screen. HOLE is how much of it goes (1: all), PAD how far the rectangle is grown in
 * clip space, FEATHER how softly the label's edge comes back.
 */
const LABEL_HOLE = 1
const HOLE_PAD = 0.015
const HOLE_FEATHER = 0.03

/** `vClip` is the clip-space x, y and w of the pixel: linear in the world, so it interpolates exactly where x/w would not. `vAlong` is 0 at the plaque's left (the stone's) end and 1 at the far end. */
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
`
/**
 * Upstream's wipe: discard everything the reveal front has not reached yet, counted from the stone, over the whole slab (its
 * edges too), so the plaque grows out of the stone with its lettering unsqueezed. Then two holes: uPlate is the year plate's
 * rectangle on the screen (left, bottom, right, top in clip space; left > right when there is none), and uCar the car's. The layout
 * keeps the plaques off both; these are for what it cannot (a plaque that is only wiping away, a screen with no room at all): the
 * year and the car are never covered.
 *
 * The face is flat and self-lit: a plaque that turns with the camera must not get lighter or darker as the camera goes round
 * the sun. It goes through the renderer's tone mapping and output encoding like everything else, so paper is paper.
 */
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
`
/** The plate's housing stays inside this much of the half-viewport sideways, of the upper half, and of the lower half. A phone has no width to spare: 0.95 of it is 10 px from the edge of a 390 px screen. */
const SAFE_X = 0.95
const SAFE_TOP = 0.74
const SAFE_BOTTOM = 0.8
/**
 * The lit bars stand in front of the scene by this many metres along the line of sight (see `buildYear`): whatever drives or
 * floats within it in front of a bar (the car, a stone hanging 2.5 m up, a label) cannot hide the year, and a bar is never seen
 * through anything that is further in front than that. It was a draw with no depth test at all, which also showed the year through
 * the hill or the sign that stood between it and the camera whenever the camera was not the chase camera (the close-up camera
 * of a board, a drag that swings the chase camera round behind a tree). A stone's top is 2.2 m nearer the lens than the plate at
 * the chase camera's elevation and the car's 0.9 m, so 4 holds with room to spare.
 */
const READOUT_ON_TOP = true
const READOUT_LIFT = 4
/** The authored lanes run this far past the walk's far end, and close 0.139 m after that. */
const OPEN_END = 0.146
/** Stops whose ends are closer than this share one socket; sockets are never nearer than SEPARATION. */
const MERGE = 0.35
const SEPARATION = 1.0
/**
 * The authored pieces this controller draws itself. The environment gives every
 * unreserved mesh over 0.6 m a collider of its own before any controller exists, so
 * the plate, the three strips, the year strip and box, the digits and the six
 * authored stones each carry an invisible one, standing where Bruno put them.
 */
const REPLACED = ['Plane.049', 'Plane.018', 'Plane.022', 'Plane.035', 'Plane.048', 'Plane.030']

/** Where the plate stands: left of the car, or away (see PLATE_AWAY). */
export type Place = 'left' | 'away'

/** What the View is read for here: its camera, and the numbers its default distance is made of (see `defaultDepth`). */
interface ViewLike {
  camera?: THREE.PerspectiveCamera
  ratioOverflow?: number
  spherical?: { radius?: { edges?: { min?: number; max?: number }; nonIdealRatioOffset?: number } }
}

interface Line {
  stop: CareerStop
  track: CareerTrack
  /** Where the stone waits, and how far down the road its span runs. */
  origin: THREE.Vector3
  span: number
  stone: THREE.Object3D
  stoneHome: THREE.Vector3
  /** Stands at the stone's top, a spherical billboard (the plaque is its child, in the screen's own axes). Moves with the stone. */
  pivot: THREE.Group
  pivotHome: THREE.Vector3
  billboard: BillboardHandle
  /** The plaque, and the sign that paints it: null until the car first comes near (see THE LABELS). */
  sign: Sign | null
  label: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null
  /** The plaque's width in metres; 0 until it is built. */
  width: number
  /** How much the plaque is grown on a screen too short for its type (see MIN_SUB_PX); 1 for most. */
  fit: number
  /** How far the plaque has slid from its place beside the stone, in the pivot's own metres (see SAFE). */
  shiftX: number
  shiftY: number
  /** Where the layout last sent it, in clip space: what it is sliding towards (and what the next frame prefers to keep it at). NaN: it has no place yet. */
  lastDx: number
  lastDy: number
  /** The sizes the two lines were set at, in canvas pixels, once painted. For the QA harness. */
  type: { head: number; sub: number } | null
  /** False while hidden: the first frame a plaque shows it goes straight to its place instead of sliding there from beside the stone. */
  placed: boolean
  /** True while the stop's plaque may speak: the car is within reach of the stone and the stone is in the picture (see REVEAL_RADIUS), and the layout has a place for it near its stone (`wants` and not `crowded`). */
  near: boolean
  /** True while the stop is the one its lane speaks for and the car is within reach of its stone, whether or not the layout has room for its plaque. */
  wants: boolean
  /** True while the layout has no place for the plaque within reach of its stone (see GAP_SHARE): it does not speak, and is tried again every frame. */
  crowded: boolean
  /** Seconds the layout has had no place for a speaking plaque, or has had one for a plaque that is crowded out, in a row (see GIVE_UP_AFTER). */
  held: number
  /** The layout's clock when the plaque was last let back (see LATCH_WINDOW). */
  revivedAt: number
  /** How long the layout has been sending the plaque somewhere far from where it stands, in seconds, and where (see SETTLE_AFTER); 0 while it has not. */
  pending: number
  pendingDx: number
  pendingDy: number
  /** True while the plaque is wiping away where it stands, to wipe in at the place the layout has for it, across a place kept off (see `crosses`): it is put there once it is hidden (RELOCATE_HIDDEN). */
  relocating: boolean
  /** How long, in seconds, the way to the place the layout has for the plaque has been across a place kept off, in a row (see CROSS_AFTER). */
  crossing: number
  /** How long the plaque has been wiping away to be put elsewhere, in seconds (see RELOCATE_RAMP). */
  wiped: number
  /** True while the plaque is held silent because its verdict did not hold, and what the layout was asked then (see LATCH_EPS); null until the first time. */
  latched: boolean
  /** True from the time the plaque was held silent until it has spoken for WARY_RESET: it is let back after REVIVE_WARY of room instead of REVIVE_AFTER. */
  wary: boolean
  latchSig: Float64Array | null
  hasEnd: boolean
  isIn: boolean
  isUp: boolean
  reveal: number
  elevation: number
  slide: number
  index: number
}

/** Highest on the screen first (by where each wanted to stand, before the box moved it, so that lanes pressed against the top keep their order), in place. A handful of items: an insertion sort, which (unlike Array.prototype.sort) makes no garbage. */
function sortByHeight(rects: Array<{ y1: number }>, n: number): void {
  for (let i = 1; i < n; i++) {
    const item = rects[i]
    const top = item.y1
    let j = i - 1
    while (j >= 0 && rects[j].y1 < top) { rects[j + 1] = rects[j]; j-- }
    rects[j + 1] = item
  }
}

/** One visible plaque's rectangle on the screen this frame, in clip space, and where it has to slide to (see `layoutPlaques`). */
interface Slot {
  line: Line
  x0: number
  y0: number
  x1: number
  y1: number
  dx: number
  dy: number
  /** Where the layout sent it last frame (NaN: it was not laid out), so that an arrangement as good as that one is kept. */
  pdx: number
  pdy: number
  /** Clip-space units per metre of the pivot's own axes, across and up. */
  kx: number
  ky: number
  /** Where its stone's anchor is in clip space, how far from it the plaque may stand and what giving the plaque up costs: see `PlaqueRect`. */
  ax: number
  ay: number
  reach: number
  rank: number
  /** Whether the layout had no place for it this frame. */
  out: boolean
  /** Whether it was not speaking, and was tried again to see if it can (see `Line.crowded`): it is asked about (see `admit`), not laid out with the plaques that speak. */
  trial: boolean
  /** Whether the layout is asked about this plaque that is trying in the asking being made (see `solve`). */
  ask: boolean
  /** Whether a plaque that is trying has a place this frame: the layout, asked as if it spoke, puts it where it can stand (within GAP_ENTER of the reach of its stone), gives up none that speaks and moves none of them far. */
  fits: boolean
  /** This frame's verdict on a plaque that is trying: it has had a place for REVIVE_AFTER, and speaks from the next frame on, in the arrangement it was tried in. */
  revive: boolean
  /** Where the layout sent a plaque that speaks this frame, when `settle` has held it where it stands instead (NaN: it has not). */
  holdFrom: number
  holdFromY: number
}

interface Digit {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  /** How far each bar stands out of the plate, 0..1, and where it is going. */
  lift: Float32Array
  goal: Float32Array
  mask: number
  moving: boolean
}

/** Where a stop stands on the road: the stone's home, and where its slide ends. */
export interface Placed {
  id: string
  head: number
  tail: number
  span: number
  hasEnd: boolean
}

export interface Socket {
  lane: string
  x: number
  z: number
  /** The stops whose stone stands here, and those whose stone comes to rest here. */
  heads: string[]
  tails: string[]
}

export interface LanePlan {
  track: CareerTrack
  x: number
  stops: Placed[]
  sockets: Array<{ z: number; heads: string[]; tails: string[] }>
}

/**
 * The leads (metres the readout stands further down the road) at which one point of it is inside
 * `limit` of the half-screen. `point` holds, in this order: `a`, the point's camera-space
 * coordinate on the axis being limited; `da`, how much that changes for one more metre of lead;
 * `z` and `dz`, the same for the lens axis (the camera looks down -z); `sign`, -1 to keep it right
 * of -limit (left and bottom edges) or +1 to keep it left of +limit; `limit`; and `projection`, the
 * projection matrix's scale for the axis. Where a point lands on screen is linear in the lead once
 * multiplied through by its depth, so every edge gives exactly one limit: returns [lowest, highest]
 * allowed, written into `out`. It takes arrays so that the caller, which runs every frame, never
 * boxes a number or allocates one.
 */
export const BOUND = { A: 0, DA: 1, Z: 2, DZ: 3, SIGN: 4, LIMIT: 5, PROJECTION: 6 } as const
export function leadBound(point: ArrayLike<number>, out: [number, number] = [0, 0]): [number, number] {
  // sign * projection * a / -z <= limit, and -z > 0 in front of the lens.
  const sign = point[BOUND.SIGN], limit = point[BOUND.LIMIT], projection = point[BOUND.PROJECTION]
  const at0 = sign * projection * point[BOUND.A] + limit * point[BOUND.Z]
  const per = sign * projection * point[BOUND.DA] + limit * point[BOUND.DZ]
  if (Math.abs(per) < 1e-9) { out[0] = -Infinity; out[1] = Infinity; return out }
  const lead = -at0 / per
  if (per > 0) { out[0] = -Infinity; out[1] = lead } else { out[0] = lead; out[1] = Infinity }
  return out
}

/**
 * Where the plate stands, in metres of lead, given two ranges. `slot` keeps it left of the car, and is open at one end:
 * "no further along than" or "at least as far along as", by which way the road runs across the picture. `[lowest, highest]`
 * keeps it on the screen. It takes the slot's limit itself, which is the nearest the car it may stand, and then the
 * screen wins: where they disagree (a phone has no room for the slot) the plate stays in view, and if even that is
 * impossible it takes the upper limit, as the plate has always done. With no slot at all it takes `fallback`.
 */
export function pickLead(slot: ArrayLike<number>, lowest: number, highest: number, fallback: number): number {
  let lead = fallback
  if (slot[1] !== Infinity) lead = slot[1]
  else if (slot[0] !== -Infinity) lead = slot[0]
  return Math.min(highest, Math.max(lowest, lead))
}

/** A range with no lead in it. */
const NO_RANGE: readonly number[] = [Infinity, -Infinity]

/**
 * Whether the plate may stand at its home with the car where it is. `lead` is the lead the plate has there (how far down the road
 * the home is from the car); `left`, `right` and `above` are the leads at which the plate is left of the car by the room the slot
 * asks for, right of it, and higher up the picture than it, as `leadBound` writes them. Home is free if it is in any of them: the
 * plate is then clear of the car on the screen, and nothing needs to move. Where it is in none the car and the plate would be one
 * over the other.
 */
export function homeFree(lead: number, left: ArrayLike<number>, right: ArrayLike<number>, above: ArrayLike<number> = NO_RANGE): boolean {
  return (lead >= left[0] && lead <= left[1]) || (lead >= right[0] && lead <= right[1]) || (lead >= above[0] && lead <= above[1])
}
/**
 * The largest size in [min, max] at which `fits` holds, found by bisection: `fits` is true up to some size and false beyond
 * it (a plate gets harder to place as it grows). Returns max where it fits at max, and min where it fits nowhere, so the
 * answer is always a size that can be drawn.
 */
export function fitSize(fits: (size: number) => boolean, min: number, max: number, steps = 8): number {
  if (fits(max)) return max
  if (!(fits(min))) return min
  let low = min, high = max
  for (let i = 0; i < steps; i++) {
    const mid = (low + high) / 2
    if (fits(mid)) low = mid
    else high = mid
  }
  return low
}

/**
 * Whether a stop's plaque may speak (see REVEAL_RADIUS): `lateral` is how far the car is from the stone across the lanes (metres),
 * `ax` and `ay` the stone's anchor in clip space, `depth` its distance from the lens along the lens axis, and `was` whether it
 * could last frame. A plaque that was speaking holds on a little longer than one that was not starts: the edge is a band.
 */
export function plaqueReach(was: boolean, lateral: number, ax: number, ay: number, depth: number): boolean {
  if (!(lateral <= REVEAL_RADIUS + (was ? REVEAL_HOLD : 0))) return false
  if (!(depth > NEAR_CUT + (was ? -1 : 0))) return false
  const edge = 1 + VIEW_MARGIN + (was ? VIEW_HOLD : 0)
  return Math.abs(ax) <= edge && Math.abs(ay) <= edge
}

/**
 * The size a plaque is drawn at, against the one it has beside its stone at the billboard's own size: 1 where the screen has room
 * and the plaque is no nearer the lens than NEAR_SHARE of the car's depth; grown to the size at which its subtitle is MIN_SUB_PX
 * (at most FIT_MAX) where the screen is short; and shrunk in proportion to its nearness inside that depth, but never below what
 * reads. `subPx` is the subtitle's height on the screen at size 1, in CSS px, `depth` the plaque's distance from the lens along the
 * lens axis, and `carDepth` the car's (what the design size is made for; not a number: no cap). `share` is how wide the plaque is at
 * size 1, as a share of the canvas's width: it is made no wider than WIDTH_SHARE of it, as far as its subtitle allows.
 */
export function plaqueFit(subPx: number, depth: number, carDepth: number, share = 0): number {
  const readable = MIN_SUB_PX / subPx
  const floor = carDepth * NEAR_SHARE
  let capped = depth < floor ? Math.max(depth, 0.5) / floor : 1
  // No wider on the screen than WIDTH_SHARE of it (`share` is the plaque's width over the canvas's at size 1; 0: not known), unless the subtitle would then be under MIN_SUB_PX.
  if (share > 0) { const narrow = WIDTH_SHARE / share; if (narrow < capped) capped = narrow }
  const fit = readable > capped ? readable : capped
  return fit > FIT_MAX ? FIT_MAX : fit
}

/** The billboard's distance factor for a plaque `dist` metres from the lens (the one ./Billboards applies: see PLAQUE_SCALE). */
export function plaqueFactor(dist: number): number {
  const k = dist / PLAQUE_SCALE.ref
  return k < PLAQUE_SCALE.min ? PLAQUE_SCALE.min : k > PLAQUE_SCALE.max ? PLAQUE_SCALE.max : k
}

/**
 * How far the chase camera stands from the car at its default zoom (see DEFAULT_ZOOM), in metres: the View's own formula, in which
 * the radius runs from `min` at zoom 1 to `max` at zoom 0, and `overflow` (how much taller than 16:9 the screen is) adds `offset`
 * metres of it per unit to the far end: 21 m on a desktop, 31 m on a phone held upright. A number no one can use is the 21 m of a
 * desktop.
 */
export function defaultDepth(min: number, max: number, offset: number, overflow: number): number {
  const depth = min + (max + overflow * offset - min) * (1 - DEFAULT_ZOOM)
  return Number.isFinite(depth) && depth > 1 ? depth : REFERENCE_DEPTH
}

/**
 * The most a plaque's `fit` may be, from what the screen is: the plaque is drawn no bigger than DESIGN_SLACK times the size it would
 * have, in the same place relative to the car, with the camera at `design` metres from the car (its default distance, see
 * `defaultDepth`) instead of where it is now. `sub` is the subtitle's height in metres at size 1 and `height` the canvas's, in CSS px,
 * `project` the projection's scale of y, `depth` the plaque's distance from the lens along the lens axis and `dist` its distance from
 * the lens, `carDepth` the car's depth now, `share` the plaque's width over the canvas's at size 1 (see `plaqueFit`). A zoom that
 * brings the camera in gives the plaque nothing more to draw: its width on the screen goes with fit x factor / depth, and that is held
 * to the one it has there. Infinity (no cap) for a number that is none.
 */
export function plaqueCap(sub: number, height: number, project: number, depth: number, dist: number, carDepth: number, design: number, share = 0): number {
  const there = Math.max(1, design + depth - carDepth)
  const factorThere = plaqueFactor((dist * there) / depth)
  const fitThere = plaqueFit((sub * factorThere * height * 0.5 * project) / there, there, design, (share * factorThere * depth) / (plaqueFactor(dist) * there))
  const cap = (DESIGN_SLACK * fitThere * factorThere * depth) / (there * plaqueFactor(dist))
  return Number.isFinite(cap) && cap > 0 ? cap : Infinity
}

/**
 * Where the car's outer edge lands across the clip space. `x` is how far out to one side of the screen's middle it stands, in camera
 * space at its middle's `depth` (`side` -1: the left edge, +1: the right edge), `projection` the projection matrix's scale of x.
 * The car's near parts are `near` nearer the lens than its middle and its far parts as much further, and a point out to the side is
 * outermost on the near part, innermost on the far one: the edge is the outermost of them, which is the one that keeps a plate off the car.
 */
export function carEdge(projection: number, x: number, depth: number, near: number, side: number): number {
  return (projection * x) / Math.max(0.1, x * side > 0 ? depth - near : depth + near)
}

/** The width of the plate at its smallest, in CSS px, on a canvas `canvas` px wide: PLATE_MIN_PX, less in proportion on a screen narrower than PLATE_MIN_WIDTH. */
export function plateFloorPx(canvas: number): number {
  return canvas > 0 && canvas < PLATE_MIN_WIDTH ? (PLATE_MIN_PX * canvas) / PLATE_MIN_WIDTH : PLATE_MIN_PX
}

/**
 * The least size the plate is drawn at: the one at which it is `px` css px wide on a canvas `canvas` px wide (see PLATE_MIN_PX).
 * `depth` is how far the plate is from the lens along its axis, `projection` the projection matrix's scale of x, `width` the plate's
 * width in metres at size 1. Never more than `max`: a camera so far out that the plate at its biggest is narrower than `px` draws
 * it at its biggest, and so does an input that gives no number.
 */
export function floorSize(px: number, canvas: number, depth: number, projection: number, width: number, max: number): number {
  const size = ((px / canvas) * 2 * depth) / (projection * width)
  return Number.isFinite(size) && size > 0 ? Math.min(max, size) : max
}

/**
 * The pieces of the page a plaque keeps out from under: the top bar (the box's top comes down to below it), and the column of
 * touch buttons and the speed readout (keep-outs, empty while they are not showing). They are read off the page about four times
 * a second and at once when the window changes size, never per frame. A page without them (the /world2 route's) is simply all screen.
 */
export class Hud {
  /** The canvas's size in CSS px. */
  width = 1
  height = 1
  /** CSS px from the top of the canvas down to the bottom of the top bar; 0 where there is none. */
  top = 0
  readonly touch: KeepOut = { x0: 2, y0: 2, x1: -2, y1: -2, hard: true }
  readonly speed: KeepOut = { x0: 2, y0: 2, x1: -2, y1: -2, hard: true }
  private at = -Infinity
  private seenWidth = -1
  private seenHeight = -1

  measure(): void {
    if (typeof document === 'undefined') return
    const now = performance.now()
    if (now - this.at < HUD_POLL_MS && innerWidth === this.seenWidth && innerHeight === this.seenHeight) return
    this.at = now
    this.seenWidth = innerWidth
    this.seenHeight = innerHeight
    const canvas = document.getElementById('world')?.getBoundingClientRect()
    const left = canvas?.left ?? 0, top = canvas?.top ?? 0
    const width = canvas && canvas.width > 0 ? canvas.width : innerWidth
    const height = canvas && canvas.height > 0 ? canvas.height : innerHeight
    this.width = width
    this.height = height
    const bar = document.getElementById('player-nav')?.getBoundingClientRect()
    this.top = bar && bar.height > 0 ? Math.max(0, bar.bottom - top) : 0
    this.keepOff('touch-controls', this.touch, left, top, width, height)
    this.keepOff('drive-hud', this.speed, left, top, width, height)
  }

  /** The element's rectangle in clip space, with HUD_CLEAR_PX of air round it; empty while it is not showing. */
  private keepOff(id: string, out: KeepOut, left: number, top: number, width: number, height: number): void {
    const box = document.getElementById(id)?.getBoundingClientRect()
    if (box && box.width > 0 && box.height > 0) {
      out.x0 = ((box.left - left - HUD_CLEAR_PX) / width) * 2 - 1
      out.x1 = ((box.right - left + HUD_CLEAR_PX) / width) * 2 - 1
      out.y1 = 1 - ((box.top - top - HUD_CLEAR_PX) / height) * 2
      out.y0 = 1 - ((box.bottom - top + HUD_CLEAR_PX) / height) * 2
    } else {
      out.x0 = 2; out.y0 = 2; out.x1 = -2; out.y1 = -2
    }
  }
}

export class Career {
  readonly lines: Line[] = []
  readonly group = new THREE.Group()
  /** Lane X, in world space, read off the authored empties. Public for QA. */
  readonly lanes: Record<string, number> = {}
  private yearGroup: THREE.Object3D | null = null
  private yearHomeZ = 0
  /** Where the plate's home is in the road's own frame (the one the player is read in). */
  private yearCareerZ = 0
  private yearOffset = 0
  /** The housing's extent about the plate's origin, in the plate's own units: left, right, toward the far end, toward the lens. */
  private plateReach: { left: number; right: number; far: number; near: number } | null = null
  private readonly spot = new THREE.Vector3()
  private readonly step = new THREE.Vector3()
  private lowest = 0
  private highest = 0
  private readonly range: [number, number] = [0, 0]
  private readonly point = new Float64Array(7)
  /** The car in camera space, for the slot. */
  private readonly car = new THREE.Vector3()
  /** The year plate's rectangle on the screen, one object shared by every label's material (see PLAQUE_FRAGMENT). */
  private readonly plateRect = { value: new THREE.Vector4(2, 2, -2, -2) }
  /** The car's rectangle on the screen, the same way (without the margin the layout keeps): the plaques' second hole. */
  private readonly carRect = { value: new THREE.Vector4(2, 2, -2, -2) }
  private housing: THREE.Mesh | null = null
  private housingBox: THREE.Box3 | null = null
  private readonly clip = new THREE.Matrix4()
  private readonly corner = new THREE.Vector4()
  private leading = PLATE_LEAD
  /** The plate's own scale now (1: as authored), the one the screen leaves it (see PLATE_MIN_PX), and the authored scale they multiply. */
  private size = PLATE_SCALE
  private fitted = PLATE_SCALE
  private sized = false
  private sinceFit = 0
  private lastDepth = 0
  private readonly homeScale = new THREE.Vector3(1, 1, 1)
  /** What `prepare` reads off the camera and the car once a frame, and `limits` turns into bounds on the lead. */
  private up = 0
  private deep = 0
  private worldScale = 1
  private carDepth = 0
  /** The camera's default distance from the car, and the `ratioOverflow` of the View it was worked out for (see `designDepth`). */
  private designAt = REFERENCE_DEPTH
  private designFor = NaN
  private projection: ArrayLike<number> | null = null
  /** The slot, as `leadBound` writes it, and the closure `fit` asks "is there room for a plate this size?" with: made once, so a frame allocates nothing. */
  private readonly slot: [number, number] = [-Infinity, Infinity]
  private readonly hasRoom = (size: number): boolean => this.limits(size, this.roomClear)
  /** What `hasRoom` asks: how much clear ground. */
  private roomClear = CAR_BODY
  /** The leads at which the plate is right of the car (see `homeFree`), whether `prepare` found a car to measure against, and how far down the road the plate's home is from the car. */
  private readonly right: [number, number] = [-Infinity, Infinity]
  private readonly above: [number, number] = [-Infinity, Infinity]
  private ready = false
  /** Where the screen has room for the plate (see `fit`), and whether that changed since `moveTo` last looked: a plate that goes away or comes back does not slide there, it hops. */
  private away = false
  private moved = false
  private homeLead = 0
  /** True while the plate has stepped aside for the car (see DODGE_ENTER). */
  private dodging = false
  /** How much of its size the plate has while it hops, and where it is: `hopping` until it is nothing, `lastTarget` to tell a hop from a slide, `offsetSet` once it has stood anywhere. */
  private pop = 1
  private hopping = false
  private lastTarget = 0
  private offsetSet = false
  /** Which stop speaks on each lane this frame; one map for the life of the controller. */
  private readonly speaking = new Map<string, Line>()
  private current = CAREER_FIRST_YEAR
  private digits: Digit[] = []
  /** Road Z at the first month of the walk, and at the last. */
  private near = 0
  private far = 0
  private readonly centre = new THREE.Vector3()
  private reach = 0
  private socketList: Socket[] = []
  private track: { rim: THREE.Mesh; floor: THREE.Mesh } | null = null
  private readout: THREE.Material | null = null
  private faced = false
  private grown = false
  /** Reduced motion: a bar jumps to its place and the plate faces the lens at once. Read live, so the OS setting can change mid-session. */
  private readonly motion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
  private get still(): boolean { return this.motion?.matches === true }
  private readonly aim = new THREE.Vector3()
  private readonly turn = new THREE.Quaternion()
  /** The plaques' kit: made when the first plaque is, so a visitor who never comes here pays for none of it. */
  private kit: { materials: SignMaterials; runtime: SignRuntime } | null = null
  /** How far above a stone's own origin its top stands, read off the authored stone. */
  private stoneTop = 0.9
  /**
   * One plaque material standing in the scene from the start, on a hidden triangle: the startup pass that compiles every
   * shader (hidden ones too) links the plaque's under the loading cover, and not on a frame of the first reveal.
   */
  private warm: THREE.Mesh | null = null
  private disposed = false
  /** True from the first tick the car is within reach until the first tick it is not: the plaques are put away once, then. */
  private inReach = false
  /** One entry per line, for the life of the controller: the plaques' layout allocates nothing. */
  private readonly slots: Slot[] = []
  private readonly shown: Slot[] = []
  /** The layout's own clock, in the seconds it was given (see LATCH_WINDOW), and what the layout was asked this frame, in numbers (see `ask`). */
  private clock = 0
  /** The layout's clock when the car last came within reach of the stones (see SETTLING). */
  private arrivedAt = -Infinity
  private asked = new Float64Array(0)
  /** The plaques one asking of the layout is about (see `solve`), and the answer to the first, kept while the layout is asked about the plaques that are trying. */
  private readonly work: Slot[] = []
  private readonly answer = new Float64Array(64)
  private readonly answerOut = new Uint8Array(32)
  /** What `recover` puts back if asking again without a plaque's history was no better: where each was sent (dx, dy) and what it was told last frame (pdx, pdy), by line. */
  private readonly spare = new Float64Array(128)
  private readonly spareOut = new Uint8Array(32)
  /** The page's controls (see Hud), the box the plaques stand in this frame, and the places they keep off: the year plate, the car, the touch buttons, the speed readout. */
  private readonly hud = new Hud()
  private readonly safe: Safe = { ...SAFE }
  private readonly keepPlate: KeepOut = { x0: 2, y0: 2, x1: -2, y1: -2, margin: LEAN_PLATE }
  private readonly keepCar: KeepOut = { x0: 2, y0: 2, x1: -2, y1: -2, margin: CAR_KEEP.pad }
  /** Stand-ins for the plaques that speak while the layout is asked where a plaque that is trying can stand among them (empty the rest of the time: see `admit`). */
  private readonly pins: KeepOut[] = Array.from({ length: PINS }, () => ({ x0: 2, y0: 2, x1: -2, y1: -2, hard: true, plaque: true }))
  private readonly keepOuts: KeepOut[] = [this.keepPlate, this.keepCar, this.hud.touch, this.hud.speed]
  /** The same places, and the stand-ins for the plaques that speak after them: what the layout is asked with when it is asked where a plaque that is trying can stand among them. */
  private readonly keepPinned: KeepOut[] = [...this.keepOuts, ...this.pins]
  /** The smallest subtitle painted so far, in metres: the one every plaque's size is judged by, so that all nine read alike. */
  private subMin = NOMINAL_SUB
  private readonly where = new THREE.Vector3()

  constructor(private game: World2Game, private references: References, private bin: Bin) {
    this.group.name = 'World2 / career'
    this.measure()
    this.retireColliders()
    this.buildLines()
    this.buildYear()
    if (this.lines.length) {
      for (const line of this.lines) this.centre.add(line.origin)
      this.centre.divideScalar(this.lines.length)
      this.reach = Math.max(...this.lines.map(line => this.centre.distanceTo(line.origin))) + 28
    }
    /*
      Everything in this group is rebuilt from the data on every run. The editor must
      neither index it nor keep a state for it: a saved state is keyed by the node's
      place in this group, so the moment the group's contents change (a stop is added,
      the rim replaces three strips and nine pads) the old states land on the wrong
      nodes and the Edit preview shows the road scattered.
    */
    this.group.traverse(node => { node.userData.proceduralDerived = true })
    const tick = () => this.update()
    game.ticker.events.on('tick', tick, 11)
    bin.add(() => {
      game.ticker.events.off('tick', tick)
      this.disposed = true
      // The plaques are signs: each disposes its own canvas, texture and geometry through the bin; what they share goes here.
      this.kit?.materials.dispose()
      if (this.warm) { this.warm.geometry.dispose(); (this.warm.material as THREE.ShaderMaterial).uniforms.map.value.dispose(); (this.warm.material as THREE.Material).dispose() }
      // The geometry is the clone taken in buildYear; the authored one belongs to the asset.
      for (const digit of this.digits) { digit.material.dispose(); digit.mesh.geometry.dispose() }
      this.readout?.dispose()
      if (this.track) { this.track.rim.geometry.dispose(); this.track.floor.geometry.dispose(); (this.track.floor.material as THREE.Material).dispose() }
    })
    bin.object3D(this.group)
  }

  /**
   * The road, measured off the authored lines rather than assumed: the lane
   * each track runs on, and the span of road the whole walk covers. Upstream's
   * `size` custom property is the length of a stone's run, so the far end of
   * the walk is the furthest `origin.z - size` of the six.
   */
  private measure(): void {
    const authored = this.references.series('refLine')
    const xs: number[] = []
    let near = -Infinity, far = Infinity
    for (const node of authored) {
      const at = node.getWorldPosition(new THREE.Vector3())
      const size = Number(node.userData.size ?? 3) || 3
      xs.push(at.x)
      near = Math.max(near, at.z)
      far = Math.min(far, at.z - size)
    }
    const yearNode = this.references.node('refYear')
    if (yearNode) {
      const home = yearNode.getWorldPosition(new THREE.Vector3())
      this.lanes.year = home.x
      this.yearCareerZ = home.z
    }
    // Three career lanes, in from the year lane. The authored X values are the
    // level's, not ours; only which track rides which is decided here.
    const unique = [...new Set(xs.map(x => Math.round(x * 1000) / 1000))].sort((a, b) => a - b)
    const order = ['education', 'work', 'projects']
    order.forEach((track, index) => { this.lanes[track] = unique[index] ?? unique[unique.length - 1] ?? 27 })
    this.near = Number.isFinite(near) ? near : 6.5
    this.far = Number.isFinite(far) ? far : -10.5
  }

  /** Time to road position, shared by every lane. */
  private at(month: number): number {
    const span = Math.max(1, CAREER_LAST_MONTH - CAREER_FIRST_MONTH)
    const t = (month - CAREER_FIRST_MONTH) / span
    return this.near - t * (this.near - this.far)
  }

  /**
   * Where every stop stands on the road, lane by lane, and the sockets that needs.
   *
   * A socket is the square the stone stands in: one at each stop's head, and one
   * where its slide ends. Stops on a lane overlap in time — a job holds a project
   * and meets the next job — so raw ends would land on top of each other; see
   * `layoutSockets`. The heads never move, so the moment a stone is level with the
   * driver is still the date it stands for.
   */
  private plan(): LanePlan[] {
    const plans: LanePlan[] = []
    for (const track of CAREER_TRACKS) {
      const x = this.lanes[track.id]
      if (x === undefined) continue
      const placed = track.stops.map((stop): Placed => {
        const from = this.at(stop.start)
        const to = this.at(stop.end)
        const span = Math.max(MIN_SPAN, Math.max(0, from - to))
        // Short stops grow around their own midpoint so the moment the stone
        // is level with the driver still lands on the right date.
        const head = (from + to) / 2 + span / 2
        // A stone stays up for good only if nothing on the walk follows it.
        return { id: stop.id, head, tail: head - span, span, hasEnd: stop.end < CAREER_LAST_MONTH }
      })
      const { stops, sockets } = layoutSockets(placed, { merge: MERGE, separation: SEPARATION })
      plans.push({ track, x, stops, sockets })
    }
    return plans
  }

  /**
   * The grey rim and the coloured floor inside it, for the three lanes.
   *
   * Blender draws the rim for Bruno's six stones, the coloured shapes inside it as
   * three emissive strips, and neither matches nine stops that overlap in time. The
   * authored strips are put away; the rim is rebuilt from the sockets above, as ONE
   * mesh in the authored palette, and the floor from the same outline as a second,
   * vertex-coloured one. What the rim leaves open is what the floor fills.
   *
   * Only the year lane's own rim, which is authored exactly right, is kept.
   */
  private buildTrack(plans: LanePlan[]): void {
    const plate = this.references.node('Plane.049')
    const strip = this.references.node('Plane.018')
    for (const name of ['Plane.035', 'Plane.018', 'Plane.022']) this.references.suppress(name)

    const bounds = plate ? new THREE.Box3().setFromObject(plate) : null
    const spec: RimSpec = {
      ...RIM,
      TOP: bounds ? bounds.max.y : RIM.TOP,
      FOOT: bounds ? bounds.min.y : RIM.FOOT,
      FLOOR: strip ? new THREE.Box3().setFromObject(strip).max.y : RIM.FLOOR,
    }
    if (plate instanceof THREE.Mesh) this.keepYearLane(plate, plans)

    const positions: number[] = [], normals: number[] = [], indices: number[] = []
    const floorPositions: number[] = [], floorColours: number[] = [], floorIndices: number[] = []
    const sockets: Socket[] = []
    for (const lane of plans) {
      const built = buildLaneRim({
        x: lane.x,
        sockets: lane.sockets.map(socket => socket.z),
        // A stop that has an end runs from its tail to its head; one that does not runs on to the end of the road.
        channels: lane.stops.map((stop): [number, number] => [stop.hasEnd ? stop.tail : this.far - OPEN_END, stop.head]),
      }, spec)
      const base = positions.length / 3
      for (const value of built.rim.position) positions.push(value)
      for (const value of built.rim.normal) normals.push(value)
      for (const value of built.rim.index) indices.push(base + value)
      const floorBase = floorPositions.length / 3
      for (const value of built.floor.position) floorPositions.push(value)
      for (const value of built.floor.index) floorIndices.push(floorBase + value)
      const colour = new THREE.Color(lane.track.colour)
      for (let i = 0; i < built.floor.position.length / 3; i++) floorColours.push(colour.r, colour.g, colour.b)
      for (const socket of lane.sockets) sockets.push({ lane: lane.track.id, x: lane.x, z: socket.z, heads: socket.heads, tails: socket.tails })
    }
    this.socketList = sockets
    if (!indices.length) return

    // The rim wears the plate's own palette texel: one colour, so one constant UV.
    const texel = plate instanceof THREE.Mesh ? plate.geometry.getAttribute('uv') : null
    const material = plate instanceof THREE.Mesh
      ? (Array.isArray(plate.material) ? plate.material[0] : plate.material)
      : new THREE.MeshStandardMaterial({ color: '#575a5e', roughness: 1 })
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    const uv: number[] = []
    for (let i = 0; i < positions.length / 3; i++) uv.push(texel ? texel.getX(0) : 0, texel ? texel.getY(0) : 0)
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    geometry.setIndex(indices)
    const rim = new THREE.Mesh(geometry, material)
    rim.name = 'career rim'
    rim.castShadow = plate?.castShadow ?? true
    rim.receiveShadow = plate?.receiveShadow ?? true

    const floorGeometry = new THREE.BufferGeometry()
    floorGeometry.setAttribute('position', new THREE.Float32BufferAttribute(floorPositions, 3))
    floorGeometry.setAttribute('color', new THREE.Float32BufferAttribute(floorColours, 3))
    floorGeometry.setIndex(floorIndices)
    // Flat and self-lit: the colour a lane is drawn in, whatever the sun is doing.
    const floor = new THREE.Mesh(floorGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }))
    floor.name = 'career floor'
    this.group.add(rim, floor)
    this.track = { rim, floor }
  }

  /**
   * `Plane.049` holds every lane's rim in one mesh. Three of those lanes are rebuilt;
   * the year lane's is authored exactly right, so the triangles that make it stay.
   */
  private keepYearLane(plate: THREE.Mesh, plans: LanePlan[]): void {
    const year = this.lanes.year
    if (year === undefined) { this.references.suppress('Plane.049'); return }
    // Halfway between the year lane and the first career lane.
    const edge = (year + (plans[0]?.x ?? year + 2)) / 2
    plate.updateWorldMatrix(true, false)
    const geometry = plate.geometry
    const position = geometry.getAttribute('position')
    const index = geometry.index
    const count = index ? index.count : position.count
    const point = new THREE.Vector3()
    const keep: number[] = []
    for (let i = 0; i + 2 < count; i += 3) {
      let inside = true
      for (let k = 0; k < 3; k++) {
        point.fromBufferAttribute(position, index ? index.getX(i + k) : i + k).applyMatrix4(plate.matrixWorld)
        if (point.x >= edge) inside = false
      }
      if (inside) for (let k = 0; k < 3; k++) keep.push(index ? index.getX(i + k) : i + k)
    }
    if (!keep.length) { this.references.suppress('Plane.049'); return }
    geometry.setIndex(keep)
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
  }

  /**
   * Take the invisible bodies of the pieces this controller replaces out of the world.
   * They are keyed by the mesh they were fitted to, so the names are read off the
   * nodes rather than listed, and the year box's collider — built at the plate's home
   * position while the visible plate slides down the road — stops being a ghost.
   */
  private retireColliders(): void {
    const physics = this.game.physics as unknown as { physicals?: Array<{ owner?: unknown }>; remove?: (physical: unknown) => void } | undefined
    if (!physics?.physicals || typeof physics.remove !== 'function') return
    const owners = new Set<string>()
    const collect = (node: THREE.Object3D | null | undefined) => node?.traverse(child => {
      if (child instanceof THREE.Mesh) owners.add(String(child.userData.w2Source ?? child.name))
    })
    for (const name of REPLACED) collect(this.references.node(name))
    for (const stone of this.references.series('stone')) collect(stone)
    for (const child of this.references.node('refYear')?.children ?? []) {
      if (String(child.userData.w2Source ?? child.name).startsWith('digit')) collect(child)
    }
    for (const physical of [...physics.physicals]) {
      if (typeof physical.owner === 'string' && owners.has(physical.owner)) physics.remove(physical)
    }
  }

  private buildLines(): void {
    const plans = this.plan()
    this.buildTrack(plans)
    /*
      The authored stone is one glTF mesh with TWO primitives — a palette body
      and an emissive tip — so three hands it back as a Group of two Meshes,
      not as a Mesh. Taking the first child instead of the whole node clones a
      sixteen-vertex tip and nothing else, which is a marker 20 cm under the
      road. Clone the node.
    */
    const source = this.references.node('stone')
    if (!source) return
    source.updateWorldMatrix(true, true)
    const stoneY = source.getWorldPosition(new THREE.Vector3()).y
    // The authored stones sit under somebody else's career; ours replace them.
    for (const node of this.references.series('refLine')) this.references.environment.suppress(node)

    /*
      The pose a label keeps where there is no camera to turn it (the editor's previews, /world2): the authored one, a plane
      45 degrees round and leaning back 15, which is what the .blend aims at its own camera. The authored label was a plane laid
      flat and turned by this quaternion; the plaque stands up, so it is turned first by the quarter turn the flat plane had.
    */
    const frame = this.references.interactions.careerText[0]
    const fallback = frame ? new THREE.Quaternion(...frame.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)) : null
    // The top of a stone, to hang its label from.
    this.stoneTop = Math.max(0.3, Math.min(2, new THREE.Box3().setFromObject(source).max.y - stoneY))

    let index = 0
    for (const { track, x, stops } of plans) {
      for (const stop of track.stops) {
        const { head, span } = stops.find(placed => placed.id === stop.id)!

        const stone = source.clone()
        // `suppress` hid the authored stones a moment ago, and a clone copies
        // that flag along with everything else.
        stone.traverse(node => { node.visible = true; node.castShadow = true; node.receiveShadow = true })
        const home = new THREE.Vector3(x, stoneY, head)
        stone.position.copy(home)
        stone.quaternion.identity()
        stone.scale.copy(source.getWorldScale(new THREE.Vector3()))
        tintStone(stone, track.colour)
        this.group.add(stone)

        /*
          The label's pivot stands at the stone's top, and it is the billboard: it turns to face the lens whatever the
          camera does, and it grows with the camera's distance. Everything about the plaque is in the pivot's own axes
          (+X is the screen's right, +Y its up), so "to the right of the stone" is true from every side. It is a
          child of this group, whose transform (the area's frame) the billboard reads: the frame can be turned and
          scaled without the label noticing.
        */
        const pivot = new THREE.Group()
        pivot.name = `career label / ${stop.id}`
        const pivotHome = new THREE.Vector3(x, stoneY + this.stoneTop + (LANE_LIFT[track.id] ?? 0.9), head)
        pivot.position.copy(pivotHome)
        if (fallback) pivot.quaternion.copy(fallback)
        pivot.visible = false
        this.group.add(pivot)
        const billboard = Billboards.for(this.game.ticker as never).add(pivot, {
          mode: 'spherical', moves: true, radius: 250,
          scale: { ...PLAQUE_SCALE, compensateParent: true },
        })
        this.bin.add(billboard.remove)
        if (!this.warm) this.warmUp(pivot)

        this.lines.push({
          stop, track, origin: home.clone(), span,
          stone, stoneHome: home.clone(),
          pivot, pivotHome, billboard, sign: null, label: null, width: 0, fit: 1, shiftX: 0, shiftY: 0, lastDx: NaN, lastDy: NaN, type: null, placed: false, near: false, wants: false, crowded: false, held: 0, revivedAt: -Infinity, pending: 0, pendingDx: 0, pendingDy: 0, relocating: false, crossing: 0, wiped: 0, latched: false, wary: false, latchSig: null,
          // A stone stays up for good only if nothing on the walk follows it.
          hasEnd: stop.end < CAREER_LAST_MONTH,
          isIn: false, isUp: false, reveal: 0, elevation: 0, slide: 0, index,
        })
        this.slots.push({ line: this.lines[this.lines.length - 1], x0: 0, y0: 0, x1: 0, y1: 0, dx: 0, dy: 0, pdx: NaN, pdy: NaN, kx: 1, ky: 1, ax: 0, ay: 0, reach: 0, rank: 0, out: false, trial: false, ask: false, fits: false, revive: false, holdFrom: NaN, holdFromY: NaN })
        index++
      }
    }
  }

  /** The plaques' shared kit, made with the first plaque. */
  private plaqueKit(): { materials: SignMaterials; runtime: SignRuntime } {
    if (!this.kit) {
      const materials = signMaterials(this.references.environment.group)
      const runtime = new SignRuntime({ ticker: this.game.ticker as never, camera: () => (this.game.view as { camera?: THREE.Camera } | undefined)?.camera }, this.bin)
      this.kit = { materials, runtime }
    }
    return this.kit
  }

  /** The plaque's own shader: one program for all nine, one set of uniforms each. */
  private plaqueMaterial(map: THREE.Texture, width: number): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, reveal: { value: 0 }, uPlate: this.plateRect, uCar: this.carRect, uInvWidth: { value: 1 / width } },
      vertexShader: PLAQUE_VERTEX, fragmentShader: PLAQUE_FRAGMENT,
      // A label is drawn over the scene (renderOrder, below): the car, the stone it stands beside or a tree between it and the
      // lens must not cover a word of it. In the transparent queue, because the car's glass is drawn there and would otherwise
      // be drawn over the lettering; every pixel it writes is opaque.
      transparent: true, depthTest: false, depthWrite: false,
    })
  }

  /** See `warm`: a hidden triangle in the first pivot that wears the plaque's material. */
  private warmUp(parent: THREE.Object3D): void {
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.needsUpdate = true
    const geometry = new THREE.BufferGeometry()
    // The same attributes as the plaque's slab (the program is keyed by which a geometry has, normals included).
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Array(9).fill(0), 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(6).fill(0), 2))
    const mesh = new THREE.Mesh(geometry, this.plaqueMaterial(texture, 1))
    mesh.name = 'career label / shader warm-up'
    mesh.visible = false
    mesh.frustumCulled = false
    parent.add(mesh)
    this.warm = mesh
  }

  /**
   * The wooden plaque of one stop: a sign from the kit, its slab and its painted face, in the pivot and to the right of
   * the stone. Built the first time it is wanted. `now` paints it before it can be drawn (a car dropped onto the stone);
   * otherwise the kit's scheduler paints it out of sight, a layer a tick, and it is ready long before anyone is level
   * with the stone.
   */
  private buildPlaque(line: Line, now = false): void {
    if (line.sign || this.disposed) return
    const kit = this.plaqueKit()
    const { stop, track } = line
    const width = plaqueWidth(stop)
    // The kit builds the slab and its canvas and calls `face` for the material: this is where the wipe and the plate's hole come in.
    const materials: SignMaterials = {
      wood: kit.materials.wood, owned: false, dispose() {},
      face: map => this.plaqueMaterial(map, width) as unknown as THREE.MeshStandardMaterial,
    }
    const sign = new Sign({
      id: `career-${stop.id}`, variant: 'label', width, height: PLAQUE_HEIGHT, dpm: LABEL_DPM,
      materials, runtime: kit.runtime, bin: this.bin,
      paint: (context, rect, tools) => {
        line.type = paintPlaque(context, rect, tools.fonts.sans, stop, track)
        this.subMin = Math.min(this.subMin, line.type.sub / LABEL_DPM)
      },
    })
    // The kit points the group back at its Sign. That circle makes Object3D.clone() throw, and the Edit preview is cloned.
    delete sign.group.userData.sign
    sign.group.userData.signMount = 'billboard'
    sign.group.position.set(PLAQUE_GAP + width / 2, 0, 0)
    sign.group.traverse(node => { node.userData.proceduralDerived = true })
    this.keepOffTheMap(line.pivot)
    this.keepOffTheMap(sign.group)
    const mesh = sign.face as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
    // One lane over the one before: where two touch, the lower lane is on top, always the same one.
    mesh.renderOrder = PLAQUE_ORDER + (track.id === 'work' ? 1 : track.id === 'projects' ? 2 : 0)
    if (sign.main) sign.main.texture.anisotropy = LABEL_ANISOTROPY
    this.bin.add(() => mesh.material.dispose())
    line.pivot.add(sign.group)
    line.sign = sign
    line.label = mesh
    line.width = width
    if (now) sign.paintNow()
  }

  /**
   * A label has no business in the map's photograph: on MAP_HIDDEN, which the gameplay camera sees and the atlas camera does not.
   * Only where the camera that draws it does see that layer: /world2's does not, and a label put there would never be drawn.
   */
  private keepOffTheMap(node: THREE.Object3D): void {
    const camera = (this.game.view as { camera?: THREE.Camera } | undefined)?.camera
    if (camera?.layers.isEnabled(MAP_HIDDEN_LAYER)) node.traverse(child => { child.layers.set(MAP_HIDDEN_LAYER) })
  }

  /** One plaque a tick, nearest the car first, so that nine are never made in one frame. */
  private buildNext(player: THREE.Vector3): void {
    let next: Line | null = null
    let nearest = Infinity
    for (const line of this.lines) {
      if (line.sign) continue
      const dx = line.origin.x - player.x, dz = line.origin.z - player.z
      const distance = dx * dx + dz * dz
      if (distance < nearest) { nearest = distance; next = line }
    }
    if (next) this.buildPlaque(next)
  }

  /**
   * The authored year plate, driven the authored way.
   *
   * Each digit mesh is seven hexagonal bars in one geometry, and its SECOND UV
   * set says which bar each vertex belongs to: `uv1.x` sits on one of seven
   * texel centres, so `floor(uv1.x * 7)` is the segment index. That index is
   * baked into a plain attribute here rather than read through three's UV
   * plumbing, which only declares `uv1` when a material samples it.
   *
   * A lit bar rises out of the plate and burns; an unlit one is not there. The
   * authored material added its emissive on top of the lighting, unmasked, so a
   * bar that was switched OFF still came out 89% as bright as one switched on and
   * every digit read as 8. A digit is now drawn flat and self-lit, and a uniform
   * per bar says how far it has risen: below a hair it is discarded, so the
   * recess shows through, and a bar that changes rises or sinks by itself while
   * the others stand still. Upstream pushes along Z because its plate stands up;
   * ours lies face-up, so the push is along Y.
   */
  private buildYear(): void {
    const group = this.references.node('refYear')
    if (!group) return
    this.yearGroup = group
    this.yearHomeZ = group.position.z

    // How far the housing reaches about the plate's origin, to keep all of it on screen.
    const housing = this.references.node('Plane.030')
    if (housing instanceof THREE.Mesh) {
      housing.updateMatrix()
      housing.geometry.computeBoundingBox()
      const box = housing.geometry.boundingBox!.clone().applyMatrix4(housing.matrix)
      this.plateReach = { left: Math.max(0, -box.min.x), right: Math.max(0, box.max.x), far: Math.max(0, -box.min.z), near: Math.max(0, box.max.z) }
      this.housing = housing
      this.housingBox = housing.geometry.boundingBox!.clone()
    }

    // The year lane that runs to the plate was drawn lavender by the export, like the digits.
    const lane = this.references.node('Plane.048')
    if (lane instanceof THREE.Mesh) {
      this.readout = new THREE.MeshBasicMaterial({ color: READOUT, toneMapped: false })
      lane.material = this.readout
    }

    const digits = group.children
      .filter(child => String(child.userData.w2Source ?? child.name).startsWith('digit'))
      .filter((child): child is THREE.Mesh => child instanceof THREE.Mesh)
      // Left to right is thousands to units, and +X is the driver's right.
      .sort((a, b) => a.getWorldPosition(new THREE.Vector3()).x - b.getWorldPosition(new THREE.Vector3()).x)

    for (const mesh of digits) {
      const geometry = mesh.geometry.clone()
      const uv1 = geometry.getAttribute('uv1')
      if (!uv1) continue
      const segment = new Float32Array(uv1.count)
      for (let i = 0; i < uv1.count; i++) segment[i] = Math.floor(Math.min(0.999, Math.max(0, uv1.getX(i))) * 7)
      geometry.setAttribute('segment', new THREE.BufferAttribute(segment, 1))
      mesh.geometry = geometry

      const lift = new Float32Array(7)
      /*
        The .blend calls the authored material `emissiveWhiteRadialGradient` and the
        export does not honour it: every emissive in the level — blue, white
        and purple — comes through the glTF with the SAME purple base colour,
        so the readout came up lavender. The authored intent is white, and a
        readout is the one thing on this road that should not be tinted.
      */
      const material = new THREE.MeshBasicMaterial({ color: READOUT, toneMapped: false })
      material.onBeforeCompile = shader => {
        shader.uniforms.uLift = { value: lift }
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
          // READOUT_LIFT: each vertex slides toward the lens along its own line of sight, which changes where it is in depth and not where
          // it is on the screen. Only for a perspective camera: an orthographic one (the map's photograph) would see it move.
          .replace('#include <project_vertex>', READOUT_ON_TOP ? `
            #include <project_vertex>
            if (projectionMatrix[2][3] < -0.5) {
              float ray = length(mvPosition.xyz);
              mvPosition.xyz *= max(ray - ${READOUT_LIFT.toFixed(2)}, 0.5) / ray;
              gl_Position = projectionMatrix * mvPosition;
            }
          ` : '#include <project_vertex>')
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `
            #include <common>
            varying float vLift;
          `)
          .replace('#include <color_fragment>', `
            #include <color_fragment>
            if (vLift < 0.03) discard;
            diffuseColor.rgb *= 0.55 + 0.45 * smoothstep(0.03, 1.0, vLift);
          `)
      }
      mesh.material = material
      if (READOUT_ON_TOP) {
        // Opaque (opacity 1), but in the transparent queue at order 10, after the labels (3 to 5): a label is never drawn over the year.
        // From the start, so that the startup pass compiles the program the first frame will use.
        material.transparent = true
        material.depthWrite = false
        mesh.renderOrder = 10
      }
      // 7 cm bars: no shadow to cast, and the depth pass could not see the lift anyway.
      mesh.castShadow = false
      mesh.receiveShadow = false
      this.digits.push({ mesh, material, lift, goal: new Float32Array(7), mask: 0, moving: false })
    }
    this.writeYear(this.current, true)
  }

  /** Light the bars a year needs. `instant` skips the rise: the first write, and the editor's preview, which never ticks. */
  writeYear(value: number, instant = false): void {
    if (!this.digits.length) return
    const text = String(Math.max(0, value)).padStart(this.digits.length, '0').slice(-this.digits.length)
    this.digits.forEach((digit, index) => {
      digit.mask = SEGMENTS[Number(text[index])] ?? 0
      for (let bar = 0; bar < 7; bar++) {
        digit.goal[bar] = (digit.mask >> bar) & 1
        if (instant) digit.lift[bar] = digit.goal[bar]
      }
      digit.moving = !instant
    })
  }

  /** Only the bars that are changing do any work. */
  private raiseBars(delta: number): void {
    const rate = this.still ? 1 : Math.min(1, delta * BAR_RATE)
    for (const digit of this.digits) {
      if (!digit.moving) continue
      let moving = false
      for (let bar = 0; bar < 7; bar++) {
        const gap = digit.goal[bar] - digit.lift[bar]
        if (gap === 0) continue
        if (Math.abs(gap) < 0.004) digit.lift[bar] = digit.goal[bar]
        else { digit.lift[bar] += gap * rate; moving = true }
      }
      digit.moving = moving
    }
  }

  /**
   * The plate turns about Y until a digit's "up" is the camera's: the camera is
   * fixed at 45 degrees and the plate lies in a frame that is not, so left alone it
   * read as a parallelogram. Damped, so an orbit drag never snaps it. Without a
   * camera (the editor's preview, /world2's old build) it stays as authored.
   */
  private facePlate(delta: number, camera: THREE.Camera | undefined): void {
    const group = this.yearGroup
    if (!group?.parent || !camera) return
    camera.getWorldDirection(this.aim)
    group.parent.getWorldQuaternion(this.turn).invert()
    this.aim.applyQuaternion(this.turn)
    // Looking straight down there is no "up" to give it.
    if (this.aim.x * this.aim.x + this.aim.z * this.aim.z < 1e-4) return
    const target = Math.atan2(-this.aim.x, -this.aim.z)
    if (!Number.isFinite(target)) return
    if (!this.faced || this.still) { group.rotation.y = target; this.faced = true; return }
    const gap = Math.atan2(Math.sin(target - group.rotation.y), Math.cos(target - group.rotation.y))
    if (Math.abs(gap) > 1e-4) group.rotation.y += gap * Math.min(1, delta * PLATE_TURN)
  }

  /**
   * Whether this stop's plaque may speak now (see REVEAL_RADIUS): the car is within reach of the stone across the lanes, and the
   * stone's anchor, where it stands once it is up and level with the car, on this frame's camera, is in the picture or within
   * VIEW_MARGIN of it. With no camera to judge
   * against (the editor's preview) the radius alone decides; for a camera with no size for a moment (a collapsed canvas) the
   * answer is what it was. Nothing here allocates.
   */
  private canSpeak(line: Line, player: THREE.Vector3, camera: THREE.PerspectiveCamera | undefined): boolean {
    const lateral = Math.abs(player.x - line.origin.x)
    if (camera?.isPerspectiveCamera !== true) return lateral <= REVEAL_RADIUS + (line.wants ? REVEAL_HOLD : 0)
    const e = camera.matrixWorldInverse.elements, p = camera.projectionMatrix.elements
    if (!(p[0] > 0 && p[5] > 0) || !Number.isFinite(e[0] + e[12])) return line.wants
    this.group.updateWorldMatrix(true, false)
    // Where the anchor will stand once the stone is up and level with the car (not where it is while it rises or slides), so that the answer is the same all through the stone's rise.
    const along = Math.min(line.origin.z, Math.max(line.origin.z - line.span, player.z))
    const at = this.where.set(line.pivotHome.x, line.pivotHome.y + ELEVATION, along).applyMatrix4(this.group.matrixWorld)
    const depth = -(e[2] * at.x + e[6] * at.y + e[10] * at.z + e[14])
    // Behind the lens there is no anchor to project (and a stone nearer than NEAR_CUT is judged by `plaqueReach`).
    if (!(depth > 0.01)) return false
    const ax = (p[0] * (e[0] * at.x + e[4] * at.y + e[8] * at.z + e[12])) / depth
    const ay = (p[5] * (e[1] * at.x + e[5] * at.y + e[9] * at.z + e[13])) / depth
    return plaqueReach(line.wants, lateral, ax, ay, depth)
  }

  /**
   * Keeps every plaque that is speaking inside the box, apart from the others, and off the year plate, the car and the touch
   * buttons. Everything is read off this frame's camera: a plaque is parallel to the screen, so its rectangle is the pivot's
   * projected point plus the plaque's extent in the pivot's own axes, scaled by the billboard's distance factor (the same one
   * ./Billboards applies a moment later) and by `fit`. Each is first put where it would stand beside its stone, and
   * `settlePlaques` finds where it goes from there; the result is a target for the slide. A plaque that is only wiping away
   * (its lane has moved on to the next stop) is not laid out again: it shrinks where it stood, at the size it has. `design` is the
   * camera's default distance from the car on this screen (see `defaultDepth`): a plaque is never bigger than it is there.
   * The verdicts (a plaque gives way, is let back) are taken after the layout, and must hold: see THE VERDICT HAS TO HOLD.
   */
  private layoutPlaques(camera: THREE.PerspectiveCamera | undefined, delta: number, design: number): void {
    const shown = this.shown
    shown.length = 0
    this.clock += delta
    // A camera with no size for a moment (a collapsed canvas has an aspect of NaN, and the view's own state can stay NaN a while after it) is no camera: what is slid towards would be NaN, and a slide keeps what it was.
    const perspective = camera?.isPerspectiveCamera === true ? camera : null
    const usable = perspective !== null && perspective.projectionMatrix.elements[0] > 0 && perspective.projectionMatrix.elements[5] > 0 && Number.isFinite(perspective.matrixWorldInverse.elements[0] + perspective.matrixWorldInverse.elements[12])
    const e = usable ? perspective.matrixWorldInverse.elements : null
    const p = usable ? perspective.projectionMatrix.elements : null
    if (e) this.group.updateWorldMatrix(true, false)
    const hud = this.hud
    // The depth the design size is made for: the car's, along the lens axis (the camera looks at it). The plaques are no bigger than they are there.
    let carDepth = REFERENCE_DEPTH
    const car = e ? this.game.player?.position : null
    if (e && car) {
      const at = this.where.set(car.x, car.y, car.z).applyMatrix4(this.group.matrixWorld)
      const d = -(e[2] * at.x + e[6] * at.y + e[10] * at.z + e[14])
      if (d > 0.5) carDepth = d
    }
    let measured = false
    // How far a plaque may stand from its stone, in clip units of y: GAP_SHARE of the canvas's shorter side (known once the canvas is measured, below).
    let reach = 0
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]
      const line = slot.line
      slot.dx = slot.dy = 0
      slot.pdx = slot.pdy = NaN
      slot.out = false
      slot.revive = false
      slot.ask = false
      // A plaque the layout has no place for is not showing, but its place is looked for every frame, so it speaks again as soon as there is one.
      const trial = line.wants && line.crowded
      slot.trial = trial
      if (!line.label || (!line.pivot.visible && !trial)) {
        // Put away: back beside the stone at its own size, so the next reveal starts from where the wipe starts.
        line.shiftX = line.shiftY = 0
        line.fit = 1
        if (line.placed) this.stand(line)
        line.placed = false
        line.lastDx = line.lastDy = NaN
        line.pending = 0
        line.relocating = false
        line.crossing = 0
        continue
      }
      if (!e || !p) {
        // With no camera to judge the room by (the editor's preview, a canvas with no size for a moment) there is nothing to be crowded by.
        if (trial) { line.crowded = false; line.latched = false; line.relocating = false }
        continue
      }
      if (!measured) {
        hud.measure()
        measured = true
        reach = (2 * GAP_SHARE * Math.min(hud.width, hud.height)) / Math.max(1, hud.height)
      }
      const at = this.where.copy(line.pivot.position).applyMatrix4(this.group.matrixWorld)
      const cx = e[0] * at.x + e[4] * at.y + e[8] * at.z + e[12]
      const cy = e[1] * at.x + e[5] * at.y + e[9] * at.z + e[13]
      const cz = e[2] * at.x + e[6] * at.y + e[10] * at.z + e[14]
      const depth = -cz
      if (depth < 0.5) {
        // At the lens there is nothing to project: whatever shift it has stays, at the smallest size, so that it is never the picture.
        line.fit = plaqueFit(Infinity, 0, carDepth)
        this.stand(line)
        continue
      }
      const dist = Math.sqrt(cx * cx + cy * cy + cz * cz)
      let k = dist / PLAQUE_SCALE.ref
      k = k < PLAQUE_SCALE.min ? PLAQUE_SCALE.min : k > PLAQUE_SCALE.max ? PLAQUE_SCALE.max : k
      // The smallest subtitle, on this screen, at the billboard's own size: grown just enough to read, and drawn no bigger than at the car's depth (see NEAR_SHARE).
      const subPx = (this.subMin * k * hud.height * 0.5 * p[5]) / depth
      // How wide it is at that size, over the canvas's width: it is made no wider than WIDTH_SHARE of it (as far as its subtitle allows).
      const share = (line.width * p[0] * k) / (2 * depth)
      // ...and no bigger on the screen than it is with the camera at its default distance: a zoom brings the stone nearer, and the plaque does not follow it.
      const fit = Math.min(plaqueFit(subPx, depth, carDepth, share), plaqueCap(this.subMin, hud.height, p[5], depth, dist, carDepth, design, share))
      line.fit = fit
      slot.kx = (p[0] * k) / depth
      slot.ky = (p[5] * k) / depth
      const bx = (p[0] * cx) / depth, by = (p[5] * cy) / depth
      slot.x0 = bx + slot.kx * PLAQUE_GAP
      slot.x1 = slot.x0 + slot.kx * line.width * fit
      slot.y0 = by - (slot.ky * PLAQUE_HEIGHT * fit) / 2
      slot.y1 = by + (slot.ky * PLAQUE_HEIGHT * fit) / 2
      if (line.wants) {
        // Where it was sent last frame (NaN: it has not been, or it is trying).
        if (!trial) { slot.pdx = line.lastDx; slot.pdy = line.lastDy }
        // Its stone's anchor, how far from it it may stand (a plaque that is not showing needs more room to be let back: see GAP_ENTER), and what giving it up costs.
        slot.ax = bx
        slot.ay = by
        const lateral = car ? Math.min(LANE_SPREAD, Math.abs(car.x - line.origin.x)) : 0
        const hide = HIDE_SHARE + HIDE_NEAR * (1 - lateral / LANE_SPREAD)
        const area = (slot.x1 - slot.x0) * (slot.y1 - slot.y0)
        // A plaque that is trying is asked for less than one that speaks has to keep to: it may stand on the car or the plate less, and no further than GAP_ENTER of the reach (the edge between speaking and silent is a band).
        slot.reach = trial ? reach * GAP_ENTER : reach
        slot.rank = plaquePrice(area, (trial ? 0 : HIDE_KEPT) + hide)
        slot.fits = false
        shown.push(slot)
      } else this.stand(line)
    }
    // The car's rectangle for this frame's holes, whoever is showing (a plaque that is only wiping away is drawn too).
    if (measured && e && p) this.clearCar(e, p)
    if (!shown.length) return
    const safe = this.safe
    safe.aspect = hud.width / hud.height
    // The top is the bottom of the page's top bar, a little clear of it, wherever that is (a phone on its side has a bar a sixth of its height); with no bar, the margin.
    safe.top = hud.top > 0 ? Math.max(0.1, Math.min(0.95, 1 - ((hud.top + BAR_CLEAR_PX) / hud.height) * 2)) : SAFE.top
    const plate = this.plateRect.value
    this.keepPlate.x0 = plate.x; this.keepPlate.y0 = plate.y; this.keepPlate.x1 = plate.z; this.keepPlate.y1 = plate.w
    this.ask(shown, safe)
    // A plaque whose verdict did not hold stays silent (it is not in the layout at all) until what the layout is asked is something else.
    let kept = 0
    for (let i = 0; i < shown.length; i++) {
      const slot = shown[i], line = slot.line
      if (line.latched) {
        if (this.changed(line)) line.latched = false
        else { line.held = 0; this.stand(line); continue }
      }
      shown[kept++] = slot
    }
    shown.length = kept
    if (!kept) return
    // The plaques that are speaking are laid out alone: what a plaque that is only trying would do to them is not asked of them (see `admit`).
    this.solve(safe, true)
    this.recover(shown, safe)
    this.rescue(shown, safe)
    this.settle(shown, safe, delta)
    let trying = 0
    for (let i = 0; i < shown.length; i++) if (shown[i].trial) trying++
    if (trying) this.admit(shown, safe, delta)
    const slide = this.still ? 1 : Math.min(1, delta * SLIDE_RATE)
    for (let i = 0; i < shown.length; i++) {
      const slot = shown[i]
      const line = slot.line
      if (slot.revive) {
        // There is a place, it has been there for a moment, and the layout has been asked as if it spoke (see `admit`): it speaks from the next frame on, from that place (one that is not showing, or is a stub of what it was, starts at it; one that is more than REVIVE_SNAP revealed slides to it; it is left where it stands this frame).
        line.crowded = false
        line.relocating = false
        line.held = 0
        line.revivedAt = this.clock
        line.lastDx = slot.dx
        line.lastDy = slot.dy
        line.pending = 0
        if (line.reveal < REVIVE_SNAP) line.placed = false
        this.stand(line)
        continue
      }
      if (slot.trial) {
        if (slot.fits) line.held += delta
        else line.held = 0
        this.stand(line)
        continue
      }
      if (slot.out) {
        line.relocating = false
        // No place near its stone. One that has stood waits a moment (see GIVE_UP_AFTER), where it stands; then it does not speak from the next frame on (a wipe away, where it stands now). One that has not stood yet goes at once.
        if (line.placed) line.held += delta
        else line.held = GIVE_UP_AFTER
        if (line.held >= GIVE_UP_AFTER) {
          // ...and one that is given up again soon after it was let back has a verdict that does not hold: it stays given up until the layout is asked something else.
          if (this.clock - line.revivedAt < LATCH_WINDOW) {
            this.latch(line)
            // ...and let back only after a longer moment of room, if it had been seen (a plaque that is still settling has no verdict to hold: it is let back as it finds its place)
            if (!this.settling()) line.wary = true
          }
          line.crowded = true
          line.held = 0
        } else if (line.placed) this.within(slot, safe, delta)
        this.stand(line)
        continue
      }
      line.held = 0
      if (line.wary && this.clock - line.revivedAt >= WARY_RESET) line.wary = false
      if (line.relocating) {
        // Wiping away where it stood, to be put at the place the layout has for it (kept for it meanwhile): once it is hidden it is there, and wipes in.
        line.lastDx = slot.dx
        line.lastDy = slot.dy
        line.pending = 0
        // ...unless the layout has gone back to the place it stands at, which is still a place: it was a few frames of another arrangement, and the plaque wipes back in where it is.
        if (this.home(slot)) { line.relocating = false; line.crossing = 0; this.stand(line); continue }
        // (it is put there from the next frame on, as it starts to wipe in: a plaque that is wiping away does not move)
        if (line.reveal >= RELOCATE_HIDDEN) { this.stand(line); continue }
        line.relocating = false
        line.crossing = 0
        line.placed = false
        this.stand(line)
        continue
      } else if (line.placed && !this.still && this.crosses(slot, line.shiftX * slot.kx, line.shiftY * slot.ky, slot.dx, slot.dy)) {
        // Its way to the place the layout has for it goes over the car, the year plate or a button: it does not slide there with its words under them, it wipes away where it is and wipes in at the new place (see `crosses`)...
        line.lastDx = slot.dx
        line.lastDy = slot.dy
        line.pending = 0
        // ...once the layout has sent it there for CROSS_AFTER: a way that is across the car for a frame or two is not one (and the plaque stands where it stands).
        line.crossing += delta
        const cx = line.shiftX * slot.kx, cy = line.shiftY * slot.ky
        if (line.crossing >= (this.stands(slot, cx, cy, STANDS_MIN) || this.beyond(slot, cx, cy, this.safe, this.safe.aspect ?? 1) ? CROSS_ON : CROSS_AFTER)) {
          // (a plaque that has hardly wiped in is put at its place at once: its wipe away and in again would be longer than the wipe it has done)
          if (line.reveal < RELOCATE_FAINT) { line.placed = false; line.crossing = 0 } else line.relocating = true
        }
        this.stand(line)
        continue
      }
      line.crossing = 0
      const was = line.placed
      line.placed = true
      line.lastDx = slot.dx
      line.lastDy = slot.dy
      let sx = (slot.dx / slot.kx - line.shiftX) * (was ? slide : 1)
      let sy = (slot.dy / slot.ky - line.shiftY) * (was ? slide : 1)
      if (was && !this.still && !this.astray(slot) && !this.stands(slot, line.shiftX * slot.kx, line.shiftY * slot.ky, STANDS_MIN)) {
        // However the others make way, it slides no faster than SLIDE_MAX_PX against its stone (unless it is where it must not be: see `astray`, `stands`).
        const px = sx * slot.kx * 0.5 * hud.width, py = sy * slot.ky * 0.5 * hud.height
        const length = Math.sqrt(px * px + py * py), most = SLIDE_MAX_PX * delta
        if (length > most) { const shrink = most / length; sx *= shrink; sy *= shrink }
      }
      line.shiftX += sx
      line.shiftY += sy
      this.stand(line)
    }
  }

  /**
   * One asking of the layout: the plaques that speak (with `speakers`; they are laid out alone when no plaque that is trying is marked to be asked about:
   * `ask`) and the plaques that are trying and marked. Without `speakers` the plaques that speak are not asked about, but stand where they are in the
   * layout (`pin`), and a plaque that is trying finds room among them.
   */
  private solve(safe: Safe, speakers: boolean, keeping: boolean = true): void {
    const shown = this.shown, work = this.work
    let n = 0
    for (let i = 0; i < shown.length; i++) {
      const slot = shown[i]
      if (slot.trial ? slot.ask : speakers) work[n++] = slot
    }
    settlePlaques(work, safe, speakers ? this.keepOuts : this.keepPinned, n, keeping)
  }

  /**
   * A plaque that speaks goes somewhere far from where it stands only if the layout goes on sending it there (SETTLE_AFTER). The arrangement of
   * three plaques on a screen with little room is a handful of near-equal ones (the one beside the car or the one over it, which plaque takes
   * the top), and a lane that changes its stop, a stone that rises or a car that crosses the lanes tips the choice from one to another for a
   * few frames and back: a plaque that crossed the screen for it and came back was a kick, or, held to a speed limit, a slide over the car.
   * A move of a few pixels is followed at once; a far one waits, unless where the plaque stands is no place any more (the car, the year plate
   * or a button is on it, it is out of the box or beyond the reach of its stone), when it goes at once.
   */
  private settle(shown: Slot[], safe: Safe, delta: number): void {
    const aspect = safe.aspect ?? 1
    let held = 0
    for (let i = 0; i < shown.length; i++) {
      const slot = shown[i], line = slot.line
      slot.holdFrom = NaN
      if (slot.trial || slot.out || line.relocating || !(line.lastDx === line.lastDx && line.lastDy === line.lastDy)) { line.pending = 0; continue }
      const mx = (slot.dx - line.lastDx) * aspect, my = slot.dy - line.lastDy
      if (mx * mx + my * my <= SETTLE_FAR * SETTLE_FAR || this.stands(slot, line.lastDx, line.lastDy) || this.beyond(slot, line.lastDx, line.lastDy, safe, aspect)) { line.pending = 0; continue }
      // Sent far from where it stands: how long has it been sent about there?
      const ax = (slot.dx - line.pendingDx) * aspect, ay = slot.dy - line.pendingDy
      if (!(line.pending > 0) || ax * ax + ay * ay > SETTLE_SAME * SETTLE_SAME) {
        line.pending = delta
        line.pendingDx = slot.dx
        line.pendingDy = slot.dy
      } else line.pending += delta
      if (line.pending >= SETTLE_AFTER) {
        // ...and it goes (a plaque that is showing does not go across the car, the plate or a button for a better place: its own is still one, and it is held there, however long the layout goes on sending it across)
        if (!line.placed || !this.crosses(slot, line.shiftX * slot.kx, line.shiftY * slot.ky, slot.dx, slot.dy)) { line.pending = 0; continue }
        line.pending = SETTLE_AFTER
      }
      slot.holdFrom = slot.dx
      slot.holdFromY = slot.dy
      slot.dx = line.lastDx
      slot.dy = line.lastDy
      held++
    }
    if (!held) return
    // ...unless where it stands is on another plaque, at the place the layout has for that one (or where that one is held): the layout made that room, and the plaque stays in it.
    for (let i = 0; i < shown.length; i++) {
      const slot = shown[i]
      if (!(slot.holdFrom === slot.holdFrom)) continue
      for (let j = 0; j < shown.length; j++) {
        const other = shown[j]
        if (j === i || other.trial || other.out) continue
        if (Math.min(slot.x1 + slot.dx, other.x1 + other.dx) - Math.max(slot.x0 + slot.dx, other.x0 + other.dx) > ASTRAY && Math.min(slot.y1 + slot.dy, other.y1 + other.dy) - Math.max(slot.y0 + slot.dy, other.y0 + other.dy) > ASTRAY) {
          slot.dx = slot.holdFrom
          slot.dy = slot.holdFromY
          slot.holdFrom = NaN
          slot.line.pending = 0
          break
        }
      }
    }
  }

  /** Whether the slot's plaque, moved by `dx` and `dy`, is out of the box by more than ASTRAY, or further from its stone's anchor than its reach. */
  private beyond(slot: Slot, dx: number, dy: number, safe: Safe, aspect: number): boolean {
    if (slot.x0 + dx < -safe.x - ASTRAY || slot.x1 + dx > safe.x + ASTRAY || slot.y0 + dy < -safe.bottom - ASTRAY || slot.y1 + dy > safe.top + ASTRAY) return true
    if (!(slot.reach > 0)) return false
    const gx = Math.max(slot.x0 + dx - slot.ax, slot.ax - (slot.x1 + dx), 0) * aspect
    const gy = Math.max(slot.y0 + dy - slot.ay, slot.ay - (slot.y1 + dy), 0)
    return gx * gx + gy * gy > slot.reach * slot.reach
  }

  /**
   * A plaque that speaks has no place only if it has none without its history either. What it stood at last frame is what the layout prefers to
   * keep it at, and a camera that jumped (or a margin on a place that was good a moment ago) can make that the one thing that leaves it without
   * one, where a plaque that is trying, with no history, has a place: it is given up, and let back a moment later (the keep must not be harder than
   * the entry). So the layout is asked again with no history for the plaques that have none, and that answer is taken if it has a place for any
   * of them and gives up none that had one.
   */
  private recover(shown: Slot[], safe: Safe): void {
    if (this.slots.length > 32) return
    let any = false
    for (let i = 0; i < shown.length; i++) {
      const slot = shown[i]
      if (!slot.trial && slot.out && slot.pdx === slot.pdx) { any = true; break }
    }
    if (!any) return
    for (let i = 0; i < shown.length; i++) {
      const slot = shown[i], k = slot.line.index
      this.spare[4 * k] = slot.dx
      this.spare[4 * k + 1] = slot.dy
      this.spare[4 * k + 2] = slot.pdx
      this.spare[4 * k + 3] = slot.pdy
      this.spareOut[k] = slot.out ? 1 : 0
      if (!slot.trial && slot.out) { slot.pdx = NaN; slot.pdy = NaN }
    }
    this.solve(safe, true)
    let better = false, worse = false
    for (let i = 0; i < shown.length; i++) {
      const slot = shown[i]
      if (slot.trial) continue
      const was = this.spareOut[slot.line.index] === 1
      if (was && !slot.out) better = true
      else if (!was && slot.out) worse = true
    }
    if (better && !worse) return
    for (let i = 0; i < shown.length; i++) {
      const slot = shown[i], k = slot.line.index
      slot.dx = this.spare[4 * k]
      slot.dy = this.spare[4 * k + 1]
      slot.pdx = this.spare[4 * k + 2]
      slot.pdy = this.spare[4 * k + 3]
      slot.out = this.spareOut[k] === 1
    }
  }

  /**
   * The plaques that kept their places have the room, and a plaque that has none (its own place is gone) is left with none: the arrangement that has room for all of them
   * (the layout as it was before the plaques kept their places: they make way for each other by cost) is asked for, and is taken if it gives up fewer plaques and sends none that speaks
   * across the car, the year plate or a button (`calm`). A plaque is not given up for want of a rearrangement; it is not rearranged for a better place.
   */
  private rescue(shown: Slot[], safe: Safe): void {
    if (this.slots.length > 32) return
    let out = 0, waiting = false
    for (let i = 0; i < shown.length; i++) {
      const slot = shown[i], k = slot.line.index
      this.answer[2 * k] = slot.dx
      this.answer[2 * k + 1] = slot.dy
      this.answerOut[k] = slot.out ? 1 : 0
      if (!slot.trial && slot.out) { out++; if (slot.line.held >= RESCUE_AFTER) waiting = true }
    }
    if (!out) return
    this.solve(safe, true, false)
    let then = 0, most = 0
    const aspect = safe.aspect ?? 1
    for (let i = 0; i < shown.length; i++) {
      const slot = shown[i], k = slot.line.index
      if (slot.trial) continue
      if (slot.out) then++
      else if (this.answerOut[k] === 0 && !this.settling()) { const mx = (slot.dx - this.answer[2 * k]) * aspect, my = slot.dy - this.answer[2 * k + 1]; most = Math.max(most, Math.sqrt(mx * mx + my * my)) }
    }
    // (the plaques that speak make way a little, not across the screen, until the plaque has waited for a place half as long as it is to be given up: then as far as they must)
    if (then < out && (most <= RESCUE_MOVE || waiting) && this.calm(shown)) return
    for (let i = 0; i < shown.length; i++) {
      const slot = shown[i], k = slot.line.index
      slot.dx = this.answer[2 * k]
      slot.dy = this.answer[2 * k + 1]
      slot.out = this.answerOut[k] === 1
    }
  }

  /**
   * Does a plaque that is trying have a place, and is it let back? The plaques that speak stand where the first asking (`solve` with no plaque that
   * is trying) left them, and the layout is asked where a plaque that is trying can stand among them (they are `pin`ned: it is asked about them
   * as it is about the car): it has a place if there is one within GAP_ENTER of the reach of its stone that nothing else stands on, and if it has had one for
   * REVIVE_AFTER it is let back, and the plaques that speak have not moved. That is the way a plaque arrives: it takes the room that is there, and
   * nobody makes way for it. A lane that changes its stop used to send the plaque that was speaking beside it across the screen (and the car, and back)
   * for the few frames it took the new stop to find its place; an arrangement that is in the layout for the first frame of a plaque is the layout that
   * is asked for it in every frame after, and the arrangement the plaque is let into is the one it is asked about.
   * Only a plaque with no room among them is asked about again with the plaques that speak free to make way (`displace`).
   * Until a plaque is due the plaques that speak stand where the first asking put them, whatever the plaque that is trying would have done to them.
   */
  private admit(shown: Slot[], safe: Safe, delta: number): void {
    if (this.slots.length > 32) return
    for (let i = 0; i < shown.length; i++) {
      const slot = shown[i], k = slot.line.index
      this.answer[2 * k] = slot.dx
      this.answer[2 * k + 1] = slot.dy
      this.answerOut[k] = slot.out ? 1 : 0
      slot.ask = slot.trial
      slot.fits = false
    }
    this.pin(shown)
    this.solve(safe, false)
    let due = 0, spare = 0, left = 0
    for (let i = 0; i < shown.length; i++) {
      const slot = shown[i]
      if (!slot.trial) continue
      slot.fits = !slot.out
      slot.revive = slot.fits && slot.line.held + delta >= (slot.line.wary ? REVIVE_WARY : REVIVE_AFTER)
      if (slot.revive) due++
      else if (slot.fits) spare++
      else left++
    }
    if (due && spare) {
      // The others that are trying and not due are in this arrangement: ask again without them (the plaque that is let back stands where it will stand).
      for (let i = 0; i < shown.length; i++) shown[i].ask = shown[i].trial && shown[i].revive
      this.solve(safe, false)
      for (let i = 0; i < shown.length; i++) {
        const slot = shown[i]
        if (!slot.revive || !slot.out) continue
        // A plaque that was due and has no place in the arrangement it was to be let back into: it is a verdict that would not hold.
        slot.revive = false
        slot.fits = false
        this.latch(slot.line)
        due--
      }
    }
    this.unpin()
    if (!due && left) this.displace(shown, safe, delta)
  }

  /**
   * The plaques that speak stand where they are (`pin`) for the plaque that is trying, as they are in the layout from the first frame it is in it; a plaque
   * with no room among them is asked about with them free to make way, as the layout always did. It has a place when there is one and the layout
   * gives up none of them and puts none on a place kept off (`keptAll`), and sends none of them across the car, the plate or a button (`calm`: a plaque that
   * is wiped away and in elsewhere for the sake of a newcomer is a plaque that is lost for a moment, and the arrangement that is better by a hair is as good
   * as the one that is showing); and it is let back only when it has had that place for REVIVE_AFTER and SETTLE_AFTER more, so that an arrangement that
   * is there for a few frames (a stop that is only just changing, a stone that is only just rising) is not one the plaques that speak are moved to and back from.
   */
  private displace(shown: Slot[], safe: Safe, delta: number): void {
    for (let i = 0; i < shown.length; i++) shown[i].ask = shown[i].trial && !shown[i].fits
    this.solve(safe, true, false)
    let kept = this.keptAll(shown) && this.calm(shown)
    // (the moment of the same answer is for plaques that have been seen: where every plaque that speaks is still settling, the others make way at once)
    let seen = false
    for (let i = 0; i < shown.length; i++) if (!shown[i].trial && !shown[i].out && !this.settling()) { seen = true; break }
    let due = 0, spare = 0
    for (let i = 0; i < shown.length; i++) {
      const slot = shown[i]
      if (!slot.ask) continue
      slot.fits = kept && !slot.out
      slot.revive = slot.fits && slot.line.held + delta >= (slot.line.wary ? REVIVE_WARY : REVIVE_AFTER) + (seen ? SETTLE_AFTER : 0)
      if (slot.revive) due++
      else if (!slot.out) spare++
    }
    if (due && spare) {
      for (let i = 0; i < shown.length; i++) shown[i].ask = shown[i].ask && shown[i].revive
      this.solve(safe, true, false)
      kept = this.keptAll(shown) && this.calm(shown)
    }
    let agreed = due > 0
    for (let i = 0; i < shown.length; i++) {
      const slot = shown[i]
      if (slot.revive && (!kept || slot.out)) { agreed = false; this.answerOut[slot.line.index] |= 2 }
    }
    if (agreed) return
    // Put the first asking's answer back: nobody is let back this frame. A plaque that was due and has no place in the arrangement it was to be let back into is held silent; the others are tried again next frame.
    for (let i = 0; i < shown.length; i++) {
      const slot = shown[i], line = slot.line, k = line.index
      slot.dx = this.answer[2 * k]
      slot.dy = this.answer[2 * k + 1]
      slot.out = (this.answerOut[k] & 1) === 1
      if (!slot.revive) continue
      slot.revive = false
      if ((this.answerOut[k] & 2) !== 0) this.latch(line)
    }
  }

  /** Puts a stand-in for each plaque that speaks (and is not given up) where the first asking left it, for the layout to find room round. */
  private pin(shown: Slot[]): void {
    let n = 0
    for (let i = 0; i < shown.length && n < this.pins.length; i++) {
      const slot = shown[i]
      if (slot.trial || slot.out) continue
      const pin = this.pins[n++]
      pin.x0 = slot.x0 + slot.dx
      pin.x1 = slot.x1 + slot.dx
      pin.y0 = slot.y0 + slot.dy
      pin.y1 = slot.y1 + slot.dy
    }
  }

  private unpin(): void {
    for (let i = 0; i < this.pins.length; i++) {
      const pin = this.pins[i]
      pin.x0 = pin.y0 = 2
      pin.x1 = pin.y1 = -2
    }
  }

  /** Whether no plaque that speaks is sent across a place kept off from where it stands (`crosses`) by the layout's answer. */
  private calm(shown: Slot[]): boolean {
    for (let i = 0; i < shown.length; i++) {
      const slot = shown[i], line = slot.line
      // (a plaque that is still settling has not been seen: it is not one whose wipe away and in is a blink)
      if (slot.trial || slot.out || !line.placed || line.relocating || this.settling() || this.answerOut[line.index] !== 0) continue
      if (this.crosses(slot, line.shiftX * slot.kx, line.shiftY * slot.ky, slot.dx, slot.dy)) return false
    }
    return true
  }

  /**
   * Whether the plaques that speak are as the first asking (the answer in `this.answer`) left them, as far as it matters: none that was not given up is
   * given up, and none that stood clear of the places kept off (the car, the year plate, the buttons) is put on one. A plaque that is trying is not to be a
   * reason to give one up, or to stand one on the car or the plate (the plaque it makes room for appears, and the one that was there is cut by the plate's
   * hole); it may move them aside, which is what a layout is for.
   */
  private keptAll(shown: Slot[]): boolean {
    for (let i = 0; i < shown.length; i++) {
      const slot = shown[i]
      if (slot.trial) continue
      const k = slot.line.index
      if (this.answerOut[k] !== 0) continue
      if (slot.out) return false
      if (this.stands(slot, slot.dx, slot.dy) && !this.stands(slot, this.answer[2 * k], this.answer[2 * k + 1])) return false
    }
    return true
  }

  /**
   * Whether the plaque, sliding in a straight line from where it stands now (`cx`, `cy`: its slide so far, in clip units) to where the layout puts
   * it (`tx`, `ty`), would be on a place kept off for more of the way than CROSS_LENGTH: a plaque the layout sends across the car (or the year
   * plate, or a button) to the other side of it would be under it for the time the slide takes, with the shader's hole cutting its words. A plaque
   * that the car has driven onto a little, and the way off it is short, is not that: it goes at once (see SLIDE_MAX_PX).
   */
  private crosses(slot: Slot, cx: number, cy: number, tx: number, ty: number): boolean {
    const keeps = this.keepOuts
    const ddx = tx - cx, ddy = ty - cy
    const length = Math.sqrt(ddx * ddx + ddy * ddy)
    if (length <= CROSS_LENGTH) return false
    for (let i = 0; i < keeps.length; i++) {
      const o = keeps[i]
      // The offsets that put the plaque on it (less a sliver: a plaque that grazes it is not on it).
      const x0 = o.x0 - slot.x1 + ASTRAY, x1 = o.x1 - slot.x0 - ASTRAY, y0 = o.y0 - slot.y1 + ASTRAY, y1 = o.y1 - slot.y0 - ASTRAY
      if (!(o.x0 < o.x1 && o.y0 < o.y1 && x0 < x1 && y0 < y1)) continue
      // The part of the way (0..1) that is inside the box, one slab at a time.
      let near = 0, far = 1
      if (ddx === 0) { if (cx <= x0 || cx >= x1) continue } else {
        let a = (x0 - cx) / ddx, b = (x1 - cx) / ddx
        if (a > b) { const t = a; a = b; b = t }
        if (a > near) near = a
        if (b < far) far = b
      }
      if (ddy === 0) { if (cy <= y0 || cy >= y1) continue } else {
        let a = (y0 - cy) / ddy, b = (y1 - cy) / ddy
        if (a > b) { const t = a; a = b; b = t }
        if (a > near) near = a
        if (b < far) far = b
      }
      if ((far - near) * length > CROSS_LENGTH) return true
    }
    return false
  }

  /** Whether the car came within reach of the stones less than SETTLING ago: the plaques have not been seen standing, and what happens to them is not what a person watched. */
  private settling(): boolean {
    return this.clock - this.arrivedAt < SETTLING
  }

  /** Whether the place the layout has for the plaque is, within a few px, the place it stands at, and that is a place (it is not on a place kept off, and is inside the canvas). */
  private home(slot: Slot): boolean {
    const line = slot.line
    const dx = line.shiftX * slot.kx, dy = line.shiftY * slot.ky
    const mx = (slot.dx - dx) * (this.safe.aspect ?? 1), my = slot.dy - dy
    return mx * mx + my * my <= SETTLE_FAR * SETTLE_FAR && !this.stands(slot, dx, dy) && !this.astray(slot)
  }

  /** Whether the slot's plaque, moved by `dx` and `dy`, stands on one of the places kept off by more than ASTRAY each way (a sliver of the car's margin is not it). */
  private stands(slot: Slot, dx: number, dy: number, margin: number = ASTRAY): boolean {
    const keeps = this.keepOuts
    for (let i = 0; i < keeps.length; i++) {
      const o = keeps[i]
      if (!(o.x0 < o.x1 && o.y0 < o.y1)) continue
      if (Math.min(slot.x1 + dx, o.x1) - Math.max(slot.x0 + dx, o.x0) > margin && Math.min(slot.y1 + dy, o.y1) - Math.max(slot.y0 + dy, o.y0) > margin) return true
    }
    return false
  }

  /**
   * What the layout is asked this frame, in numbers: the rectangle and anchor of every plaque that wants to speak (by its line), the
   * places kept off and the box. A plaque that is held silent is let ask again when this has changed (see `changed`).
   */
  private ask(shown: Slot[], safe: Safe): void {
    const lines = this.slots.length
    const need = lines * 6 + this.keepOuts.length * 4 + 3
    if (this.asked.length !== need) {
      // Once, with the first plaque that wants to speak: every line gets the room to remember what it was asked.
      this.asked = new Float64Array(need)
      for (let i = 0; i < lines; i++) this.slots[i].line.latchSig = new Float64Array(need)
    }
    const a = this.asked
    a.fill(0)
    for (let i = 0; i < shown.length; i++) {
      const slot = shown[i], o = slot.line.index * 6
      a[o] = slot.x0; a[o + 1] = slot.y0; a[o + 2] = slot.x1; a[o + 3] = slot.y1; a[o + 4] = slot.ax; a[o + 5] = slot.ay
    }
    let o = lines * 6
    for (let i = 0; i < this.keepOuts.length; i++) {
      const keep = this.keepOuts[i]
      a[o++] = keep.x0; a[o++] = keep.y0; a[o++] = keep.x1; a[o++] = keep.y1
    }
    a[o++] = safe.top
    a[o++] = safe.x
    a[o] = safe.aspect ?? 1
  }

  /** Holds the plaque silent: until what the layout is asked is not what it is asked now. */
  private latch(line: Line): void {
    line.latched = true
    line.latchSig?.set(this.asked)
  }

  /** Whether any number the layout is asked has moved by more than LATCH_EPS since the plaque was held silent. */
  private changed(line: Line): boolean {
    const then = line.latchSig, now = this.asked
    if (!then || then.length !== now.length) return true
    for (let i = 0; i < now.length; i++) if (Math.abs(now[i] - then[i]) > LATCH_EPS) return true
    return false
  }

  /**
   * A plaque that has no place stands where it stands for a moment (see GIVE_UP_AFTER), but the stone it stands beside goes on moving (a car that drives, a pose that
   * changes): it is kept inside the box, as far as its own size allows, rather than carried out of the canvas.
   */
  private within(slot: Slot, safe: Safe, delta: number): void {
    const line = slot.line
    const dx = line.shiftX * slot.kx, dy = line.shiftY * slot.ky
    const x0 = slot.x0 + dx, x1 = slot.x1 + dx, y0 = slot.y0 + dy, y1 = slot.y1 + dy
    let mx = 0, my = 0
    if (x1 > safe.x) mx = safe.x - x1
    if (x0 + mx < -safe.x) mx = -safe.x - x0
    if (y1 > safe.top) my = safe.top - y1
    if (y0 + my < -safe.bottom) my = -safe.bottom - y0
    if (!(mx === mx && my === my)) return
    // (at the speed limit like everything else that moves a plaque that is there)
    const px = mx * 0.5 * this.hud.width, py = my * 0.5 * this.hud.height
    const length = Math.sqrt(px * px + py * py), most = SLIDE_MAX_PX * delta
    if (length > most) { const shrink = most / length; mx *= shrink; my *= shrink }
    line.shiftX += mx / slot.kx
    line.shiftY += my / slot.ky
  }

  /**
   * Whether the plaque, where it stands now (its slot's place beside the stone, moved by the slide so far), is out of the canvas by more than a few
   * px: cut by it (a scene that moves fast, a pose that changes in a frame). Such a plaque is in a hurry, and is not held to SLIDE_MAX_PX: the limit
   * is for the plaque that is well placed and is moved to make room for another (one that is a little past the box, under the page's top bar,
   * is not cut by anything).
   */
  private astray(slot: Slot): boolean {
    const line = slot.line
    const dx = line.shiftX * slot.kx, dy = line.shiftY * slot.ky
    return slot.x0 + dx < -1 - ASTRAY || slot.x1 + dx > 1 + ASTRAY || slot.y0 + dy < -1 - ASTRAY || slot.y1 + dy > 1 + ASTRAY
  }

  /** The plaque's place in its pivot: its left edge a gap from the stone's axis and its middle level with the pivot, plus how far the layout has slid it, at the size `fit` gives it. */
  private stand(line: Line): void {
    const group = line.sign!.group
    group.position.set(PLAQUE_GAP + (line.width * line.fit) / 2 + line.shiftX, line.shiftY, 0)
    group.scale.setScalar(line.fit)
  }

  /**
   * The car's rectangle on the screen this frame, in clip space: the one place besides the year plate that a plaque is never
   * to stand if there is any other. A circle of CAR_KEEP.radius about the car on the ground is an ellipse at the camera's
   * elevation, and the body's height stands on top of it and below it, so the rectangle is the point the car is read at
   * plus those, scaled by the camera's depth. Nothing here allocates.
   */
  private clearCar(e: ArrayLike<number>, p: ArrayLike<number>): void {
    const out = this.keepCar
    out.x0 = out.y0 = 2
    out.x1 = out.y1 = -2
    this.carRect.value.set(2, 2, -2, -2)
    const car = this.game.player?.position
    if (!car) return
    const at = this.where.set(car.x, car.y, car.z).applyMatrix4(this.group.matrixWorld)
    const cx = e[0] * at.x + e[4] * at.y + e[8] * at.z + e[12]
    const cy = e[1] * at.x + e[5] * at.y + e[9] * at.z + e[13]
    const depth = -(e[2] * at.x + e[6] * at.y + e[10] * at.z + e[14])
    if (depth < 0.5) return
    // Where the world's up axis goes in the camera's frame: its y is the cosine of the elevation, its depth component the sine.
    const sine = Math.abs(e[6]), cosine = Math.abs(e[5])
    const kx = p[0] / depth, ky = p[5] / depth
    const flat = CAR_KEEP.radius * sine
    out.x0 = cx * kx - CAR_KEEP.wide * kx - CAR_KEEP.pad
    out.x1 = cx * kx + CAR_KEEP.wide * kx + CAR_KEEP.pad
    out.y0 = cy * ky - (flat + CAR_KEEP.below * cosine) * ky - CAR_KEEP.pad
    out.y1 = cy * ky + (flat + CAR_KEEP.above * cosine) * ky + CAR_KEEP.pad
    // The hole is the car without the margin: the shader's feather reaches about that far past it.
    this.carRect.value.set(out.x0 + CAR_KEEP.pad, out.y0 + CAR_KEEP.pad, out.x1 - CAR_KEEP.pad, out.y1 - CAR_KEEP.pad)
  }

  private update(): void {
    if (!this.lines.length) return
    const delta = this.game.ticker.delta * this.game.ticker.scale
    const player = this.game.player.position
    // Upstream gates every area on the camera quad; the same idea, by
    // distance. A stone nobody can see does not need to be lerped.
    if (Math.hypot(player.x - this.centre.x, player.z - this.centre.z) > this.reach) {
      // Gone (a drive off the road, a map travel): the plaques are put away, since nothing here will tick to retire them.
      if (this.inReach) { this.inReach = false; for (const line of this.lines) { line.reveal = 0; line.pivot.visible = false; line.placed = false; line.lastDx = line.lastDy = NaN; line.pending = 0; line.near = false; line.wants = false; line.crowded = false; line.held = 0; line.latched = false; line.wary = false; line.relocating = false; line.crossing = 0 } }
      return
    }
    if (!this.inReach) this.arrivedAt = this.clock
    this.inReach = true
    this.buildNext(player)
    // One read of the camera for the whole frame: the view is a proxy, and every read through it costs a little garbage.
    const view = this.game.view as unknown as ViewLike | undefined
    const camera = view?.camera

    /*
      ONE LABEL PER LANE. Every stone on a lane rises and stays up for as long
      as its span runs — that is what draws the shape of the career — but only
      the stop the driver is actually level with SPEAKS. Letting every raised
      stone keep its label printed four of them over each other the moment a
      degree, a job and a project overlapped, which they do for most of this
      road. Three lanes, three heights, at most three labels.
    */
    const speaking = this.speaking
    speaking.clear()
    for (const line of this.lines) {
      const along = line.origin.z - player.z
      if (along <= -PADDING || along >= line.span + PADDING * 2) continue
      const best = speaking.get(line.track.id)
      // Level with two at once — the shorter one is the more specific answer
      // to "what is happening here", so it wins the lane.
      if (!best || line.span < best.span) speaking.set(line.track.id, line)
    }

    for (const line of this.lines) {
      const along = line.origin.z - player.z
      const isIn = along > -PADDING && along < line.span + PADDING * 2
      if (isIn !== line.isIn) {
        line.isIn = isIn
        this.game.audio.play('note', isIn ? 1.2 + line.index * 0.1 : 0.6)
        if (isIn) { this.visited.add(line.stop.id); this.game.interactions?.achievements.mark('career', line.stop.id) }
      }
      if (line.isIn) line.isUp = true
      else if (along > line.span) { if (line.hasEnd) line.isUp = false }
      else line.isUp = false

      // The stop the car is level with speaks only while its stone is within reach and in the picture (see REVEAL_RADIUS).
      const was = line.wants
      line.wants = line === speaking.get(line.track.id) && this.canSpeak(line, player, camera)
      // A plaque that has not spoken yet has to find its place first: it is crowded until `layoutPlaques` has one for it (at once, the first time), so that one with no room never flashes up for a frame.
      if (!line.wants) { line.crowded = false; line.held = 0; line.latched = false; line.wary = false; line.relocating = false; line.crossing = 0 }
      else if (!was) { line.crowded = true; line.held = REVIVE_AFTER; line.latched = false; line.wary = false; line.relocating = false; line.crossing = 0 }
      // ...and only while the layout has a place for it near the stone (`layoutPlaques` decides that every frame, after this one's).
      line.near = line.wants && !line.crowded
      const revealTarget = line.near && !line.relocating ? 1 : 0
      // Level with a stone that has no plaque yet (a teleport, a fast drive): make it now, and paint it before it can be drawn (one that the layout has no room for too: it is tried every frame, and needs its size).
      if (line.wants && !line.sign) this.buildPlaque(line, true)
      // (a plaque that starts to wipe away to be put elsewhere starts as slowly as any wipe, and is at RELOCATE_RATE after RELOCATE_RAMP: one that the layout takes back at once has dipped by a hair)
      line.wiped = line.relocating ? line.wiped + delta : 0
      line.reveal += (revealTarget - line.reveal) * Math.min(1, delta * (line.relocating ? 3 + (RELOCATE_RATE - 3) * Math.min(1, line.wiped / RELOCATE_RAMP) : 3))
      if (line.label) line.label.material.uniforms.reveal.value = line.reveal
      // Below this the shader discards every pixel anyway.
      line.pivot.visible = line.label !== null && line.reveal > 0.01

      const elevationTarget = line.isUp ? ELEVATION : 0
      line.elevation += (elevationTarget - line.elevation) * Math.min(1, delta * 3)

      let slideTarget = line.slide
      if (line.isIn) { if (line.elevation > 1) slideTarget = -Math.max(0, Math.min(along, line.span)) }
      else slideTarget = along > line.span ? -line.span : 0
      line.slide += (slideTarget - line.slide) * Math.min(1, delta * 10)

      line.stone.position.set(line.stoneHome.x, line.stoneHome.y + line.elevation, line.stoneHome.z + line.slide)
      // The label rides the stone: up with it, along with it.
      line.pivot.position.set(line.pivotHome.x, line.pivotHome.y + line.elevation, line.pivotHome.z + line.slide)
    }

    if (this.yearGroup) {
      const walk = Math.max(1, this.near - this.far)
      const along = Math.max(0, Math.min(this.near - player.z, walk))
      /*
        The plate grows and turns only while the road is being driven. The editor's
        preview never ticks, so it keeps the plate as Blender made it — and a world
        saved from the editor does not carry a scale that this file chose.
      */
      if (!this.grown) {
        this.homeScale.copy(this.yearGroup.scale)
        this.grown = true
      }
      /*
        The plate stands where `placePlate` puts it, at the size the screen leaves it and left
        of the car (or ahead of the car with no camera); the YEAR it shows is still the car's.
        It stands behind the start of the road only while it is out of the car's way (see
        DODGE_ENTER), and past the end it may run on a little, so the last metres are not read
        from the plate's far edge.
      */
      this.leading = this.placePlate(delta, player, camera)
      const raw = this.yearCareerZ - player.z + this.leading
      this.dodging = this.stepAside(raw)
      const target = Math.max(this.dodging ? -DODGE_MAX : 0, Math.min(raw, walk + PLATE_OVERRUN))
      // A camera with no size for a moment (a collapsed canvas) must not leave NaN in what is kept from frame to frame.
      if (Number.isFinite(target)) {
        this.moveTo(target, delta)
        // The slide trails the target by what the car travels in a tenth of a second, and trailing is toward the left of the screen: it never stands past the bounds `limits` found.
        const base = this.yearCareerZ - player.z
        if (FOLLOW_CLAMP && this.ready && !this.hopping && (this.dodging || raw >= 0) && Number.isFinite(base + this.lowest + this.highest)) {
          this.yearOffset = Math.max(this.dodging ? -DODGE_MAX : 0, Math.min(this.yearOffset, base + this.highest, walk + PLATE_OVERRUN))
          if (this.yearOffset < base + this.lowest) this.yearOffset = Math.min(base + this.lowest, base + this.highest, walk + PLATE_OVERRUN)
        }
      } else if (!Number.isFinite(this.yearOffset)) this.yearOffset = 0
      // The plate is as big as the screen leaves it, less what a hop has taken (placePlate set the size; a hop may change it).
      const shown = this.pop * this.pop * (3 - 2 * this.pop)
      this.yearGroup.scale.copy(this.homeScale).multiplyScalar(this.size * Math.max(shown, 1e-3))
      // A plate that is away is not drawn at all, rather than drawn a thousandth of its size.
      this.yearGroup.visible = shown > 1e-3
      // The parent chain is a pure translation, so local Z tracks the road's Z.
      this.yearGroup.position.z = this.yearHomeZ - this.yearOffset
      const months = CAREER_LAST_MONTH - CAREER_FIRST_MONTH
      const years = (CAREER_FIRST_MONTH + (along / walk) * months) / 12
      // The year turns over a hair past its boundary, and back a hair before it.
      const margin = (YEAR_HYSTERESIS / walk) * (months / 12)
      if (years >= this.current + 1 + margin || years < this.current - margin) {
        const value = Math.floor(years)
        if (value !== this.current) { this.current = value; this.writeYear(value) }
      }
      this.raiseBars(delta)
      this.facePlate(delta, camera)
      this.clearPlate(camera)
    }
    // After the plate: the plaques keep clear of where it stands this frame.
    this.layoutPlaques(camera, delta, this.designDepth(view))
  }

  /** The camera's default distance from the car on this screen (see `defaultDepth`); worked out again only when the screen's shape changes. */
  private designDepth(view: ViewLike | undefined): number {
    const overflow = view?.ratioOverflow
    if (typeof overflow !== 'number') return REFERENCE_DEPTH
    if (overflow === this.designFor) return this.designAt
    const radius = view?.spherical?.radius
    this.designFor = overflow
    this.designAt = defaultDepth(radius?.edges?.min ?? NaN, radius?.edges?.max ?? NaN, radius?.nonIdealRatioOffset ?? NaN, overflow)
    return this.designAt
  }

  /**
   * How far down the road the plate stands from the car, in metres (negative: behind it), and at what size (`fit`).
   *
   * Every bound is exact: where a point of the housing projects is linear in the lead, so each
   * edge gives one limit. The housing stays inside SAFE_X, SAFE_TOP and SAFE_BOTTOM of the
   * half-screen (a phone held upright sees about 6 m of the road across; the plate stands
   * 2 to 6 m in from its lane). With the slot, its right edge also stays CAR_CLEAR metres left of
   * the car's middle, and it takes that limit itself (`pickLead`), which is the nearest the car it
   * can stand without being under it, its stone or its labels. The size is solved first (`fit`),
   * so that the slot can be met on every screen the plate can be made to fit; where it cannot
   * (not even the floor fits) the plate is away (see PLATE_AWAY) and it does not matter where it stands.
   */
  private placePlate(delta: number, player: THREE.Vector3, camera: THREE.PerspectiveCamera | undefined): number {
    const group = this.yearGroup!
    const ready = this.prepare(player, camera)
    this.ready = ready
    if (ready) {
      // The room changes with the camera, not with the car: ten solves a second are plenty while it stands still, and a solve that bisects boxes its trial sizes.
      const moving = Math.abs(this.carDepth - this.lastDepth) > CAMERA_MOVING
      this.lastDepth = this.carDepth
      if (!this.sized || moving || ++this.sinceFit >= FIT_EVERY) {
        // The size of the canvas is the floor of the plate's size: read off the page four times a second at most, and only when the size is solved (see Hud).
        this.hud.measure()
        this.fitted = this.fit()
        this.sinceFit = 0
      }
      // The first frame goes straight to the size. Less room is given up at once (reduced motion or not); more is taken back slowly.
      if (!this.sized) { this.size = this.fitted; this.sized = true }
      else if (this.fitted < this.size) this.size = this.still ? this.fitted : this.size + (this.fitted - this.size) * Math.min(1, delta * PLATE_SHRINK)
      else this.size += (this.fitted - this.size) * Math.min(1, delta * PLATE_GROW)
    }
    group.scale.copy(this.homeScale).multiplyScalar(this.size)
    if (!ready) return PLATE_LEAD
    this.limits(this.size, CAR_CLEAR)
    this.homeLead = player.z - this.yearCareerZ
    if (!PLATE_SLOT) return Math.max(0, Math.min(this.highest, Math.max(PLATE_LEAD, this.lowest)))
    const lead = pickLead(this.slot, this.lowest, this.highest, PLATE_LEAD)
    return Number.isFinite(lead) ? Math.min(PLATE_LEAD_MAX, Math.max(-PLATE_BACK, lead)) : PLATE_LEAD
  }

  /**
   * Whether the plate has stepped aside for the car: it would stand behind its home (`raw`, metres down the road, is below 0) and
   * its home is, or has been since it last stood there, within reach of the car on the screen (see DODGE_ENTER).
   */
  private stepAside(raw: number): boolean {
    if (!(raw < 0) || !this.ready) return false
    // Only where the screen has room for it behind the car (`fit` found some): a car on the plate's far side (west of its lane) has the plate on its right, where moving it back would put it nearer the car, not further.
    if (this.away) return false
    return this.dodging ? !this.homeClear(DODGE_EXIT) : !this.homeClear(DODGE_ENTER)
  }

  /**
   * True if the plate, standing at its home, would be clear of the car on the screen by `clear` metres (camera space, at the car's
   * depth; CAR_BODY of it is the car): left of it as the slot asks, right of it, or above it, which is where a plate far up the
   * road stands whatever its lane (the car is only in the way where the two overlap).
   */
  private homeClear(clear: number): boolean {
    const right = this.right, above = this.above
    right[0] = above[0] = -Infinity; right[1] = above[1] = Infinity
    if (this.carDepth > 0.1) {
      const reach = this.plateReach!, projection = this.projection!, spot = this.spot, step = this.step
      const scale = this.size * this.homeScale.x * this.worldScale
      const p = this.point
      // The plate's left edge, nearer corner, must stay right of the car's right side: -proj * a / -z <= -proj * (car + clear) / depth.
      p[BOUND.Z] = spot.z - this.deep * reach.near * scale; p[BOUND.DA] = step.x; p[BOUND.DZ] = step.z
      p[BOUND.A] = spot.x - reach.left * scale; p[BOUND.SIGN] = -1; p[BOUND.PROJECTION] = projection[0]
      p[BOUND.LIMIT] = -carEdge(projection[0], this.car.x + clear, this.carDepth, CAR_NEAR, 1)
      leadBound(p, right)
      // Its lower edge, nearer corner, must stay above the car's top (the body's, standing on the circle the car turns in) and the room the clearance leaves.
      p[BOUND.A] = spot.y - this.up * reach.near * scale; p[BOUND.DA] = step.y; p[BOUND.SIGN] = -1; p[BOUND.PROJECTION] = projection[5]
      const top = this.car.y + CAR_KEEP.radius * this.up + CAR_KEEP.above * Math.abs(this.deep) + (clear - CAR_BODY) * DODGE_ABOVE
      p[BOUND.LIMIT] = (-projection[5] * top) / this.carDepth
      leadBound(p, above)
    }
    return homeFree(this.homeLead, this.slot, right, above)
  }

  /**
   * Takes the plate toward `target` (metres of road from its home): a slide, 10 times a second to the metre, or, where the
   * target has jumped (see HOP), a hop. A hop never shows the plate crossing the plaza, or the car: it shrinks out of sight where it
   * stands, is put where it is going while it is nothing, at the size that will fit there, and grows back. Reduced motion puts it
   * there at once.
   */
  private moveTo(target: number, delta: number): void {
    // From one side of the car to the other (or out of the picture and back) is a hop whatever the distance: it must not be seen crossing the car.
    const jumped = this.offsetSet && (this.moved || Math.abs(target - this.lastTarget) > HOP + HOP_SPEED * delta)
    this.moved = false
    this.lastTarget = target
    if (!this.offsetSet || (jumped && this.still)) {
      this.yearOffset = target
      this.offsetSet = true
      this.hopping = false
      this.pop = this.away ? 0 : 1
      if (jumped) this.size = this.fitted
      return
    }
    if (jumped) this.hopping = true
    if (this.hopping) {
      this.pop = Math.max(0, this.pop - delta * POP_OUT)
      if (this.pop > 0) return
      this.yearOffset = target
      this.size = this.fitted
      this.hopping = false
      return
    }
    // Away it shrinks to nothing and waits at its place, so that it is there to grow when the room is.
    this.pop = Math.max(0, Math.min(1, this.pop + delta * (this.away ? -POP_OUT : POP_IN)))
    if (this.away) {
      if (this.pop <= 0) { this.yearOffset = target; this.size = this.fitted }
      return
    }
    this.yearOffset += (target - this.yearOffset) * Math.min(1, delta * 10)
  }

  /**
   * What the bounds on the lead are made of, read once a frame: where the plate (with no lead) and the car are in camera space,
   * how far the plate moves for one more metre of lead, and where the ground's "up the picture" and "away from the lens" go.
   * False where there is nothing to measure against (the editor's preview has no camera) or the camera has no size for a moment
   * (a collapsed canvas has an aspect of NaN, and a projection of NaN would be kept for ever by everything that is damped).
   */
  private prepare(player: THREE.Vector3, camera: THREE.PerspectiveCamera | undefined): boolean {
    const group = this.yearGroup, reach = this.plateReach
    if (!group?.parent || !reach || !camera?.isPerspectiveCamera) return false
    const projection = camera.projectionMatrix.elements
    if (!(projection[0] > 0 && projection[5] > 0)) return false
    const world = group.parent.matrixWorld
    const lens = camera.matrixWorld.elements
    // Where one metre of ground away from the lens goes: up the picture, and along the lens axis.
    let gx = -lens[8], gz = -lens[10]
    // (Math.hypot boxes its result: this runs every frame.)
    const flat = Math.sqrt(gx * gx + gz * gz)
    if (!(flat > 1e-3)) return false
    gx /= flat; gz /= flat
    this.up = gx * lens[4] + gz * lens[6]
    this.deep = gx * lens[8] + gz * lens[10]
    this.projection = projection
    this.worldScale = world.getMaxScaleOnAxis()

    // The plate with no lead, and one metre further down the road, in camera space.
    const z = player.z + (this.yearHomeZ - this.yearCareerZ)
    this.spot.set(group.position.x, group.position.y, z).applyMatrix4(world).applyMatrix4(camera.matrixWorldInverse)
    this.step.set(group.position.x, group.position.y, z - 1).applyMatrix4(world).applyMatrix4(camera.matrixWorldInverse).sub(this.spot)
    // The car, in the plate's frame (the road's x and z are the world's; the group sits at a fixed offset from them).
    this.car.set(player.x + (group.position.x - (this.lanes.year ?? group.position.x)), group.position.y, z).applyMatrix4(world).applyMatrix4(camera.matrixWorldInverse)
    this.carDepth = -this.car.z
    return Number.isFinite(this.spot.x + this.spot.y + this.spot.z + this.step.x + this.step.y + this.step.z + this.car.x + this.carDepth + this.up + this.deep)
  }

  /**
   * The leads at which a plate of this size (its own scale, 1: as authored) stands on the screen and keeps `clear` metres of
   * ground between its right edge and the car's middle: `this.lowest` to `this.highest` for the screen, `this.slot` for the car.
   * True if both can be had at once: the plate can stand where the slot wants it.
   */
  private limits(size: number, clear: number): boolean {
    const reach = this.plateReach!, projection = this.projection!, spot = this.spot, step = this.step
    const up = this.up, deep = this.deep
    const scale = size * this.homeScale.x * this.worldScale
    const p = this.point
    this.lowest = PLATE_SLOT ? -PLATE_BACK : 0
    this.highest = PLATE_LEAD_MAX
    // The two lower corners are the nearer: they are the ones that reach furthest out sideways. Each block sets
    // one point of the housing (its place in camera space, and how it moves per metre of lead) and one edge.
    p[BOUND.Z] = spot.z - deep * reach.near * scale; p[BOUND.DA] = step.x; p[BOUND.DZ] = step.z
    p[BOUND.A] = spot.x - reach.left * scale; p[BOUND.SIGN] = -1; p[BOUND.LIMIT] = SAFE_X; p[BOUND.PROJECTION] = projection[0]
    this.narrow()
    p[BOUND.A] = spot.x + reach.right * scale; p[BOUND.SIGN] = 1
    this.narrow()
    const right = p[BOUND.A]
    p[BOUND.A] = spot.y + up * reach.far * scale; p[BOUND.DA] = step.y; p[BOUND.Z] = spot.z + deep * reach.far * scale
    p[BOUND.SIGN] = 1; p[BOUND.LIMIT] = SAFE_TOP; p[BOUND.PROJECTION] = projection[5]
    this.narrow()
    // Dragging the camera round can turn the road's far end toward the bottom of the picture: the near edge has a bound too.
    p[BOUND.A] = spot.y - up * reach.near * scale; p[BOUND.Z] = spot.z - deep * reach.near * scale
    p[BOUND.SIGN] = -1; p[BOUND.LIMIT] = SAFE_BOTTOM
    this.narrow()
    const slot = this.slot
    slot[0] = -Infinity; slot[1] = Infinity
    if (!PLATE_SLOT) return this.lowest <= this.highest
    if (this.carDepth > 0.1) {
      p[BOUND.Z] = spot.z - deep * reach.near * scale; p[BOUND.DA] = step.x; p[BOUND.DZ] = step.z
      p[BOUND.A] = right; p[BOUND.SIGN] = 1; p[BOUND.PROJECTION] = projection[0]
      p[BOUND.LIMIT] = carEdge(projection[0], this.car.x - clear, this.carDepth, CAR_NEAR, -1)
      leadBound(p, slot)
    }
    // "No further along than" must reach the screen's lowest lead, and "at least as far along as" its highest.
    return this.lowest <= this.highest && slot[1] >= this.lowest && slot[0] <= this.highest
  }

  /** Where `fit` keeps the least the plate is drawn at (see `floorSize`), measured at the car's depth: the plate stands beside it. */
  private least = PLATE_SCALE
  private setFloor(): void {
    const reach = this.plateReach!
    const canvas = this.hud.width > 1 ? this.hud.width : PLATE_MIN_PX / PLATE_MIN_SHARE
    const depth = this.carDepth > 0.1 ? this.carDepth : -this.spot.z
    this.least = floorSize(plateFloorPx(canvas), canvas, depth, this.projection![0], (reach.left + reach.right) * this.homeScale.x * this.worldScale, PLATE_SCALE)
  }

  /**
   * The size the plate is drawn at, and whether it is there at all: the largest that leaves CAR_BODY metres of clear ground beside
   * the car, as small as the floor (see PLATE_MIN_PX); where not even the floor fits it is away (see PLATE_AWAY). Where not even a
   * point could stand clear of the car (the car is on the grass the wrong side of the year lane, and the plate would have to stand
   * further back than PLATE_BACK) no size helps, and that is away too.
   */
  private fit(): number {
    this.setFloor()
    const floor = this.least
    const was = this.away
    // A plate that is away needs more room than it left with, to come back.
    this.roomClear = CAR_BODY + (was ? MODE_HYST : 0)
    const size = fitSize(this.hasRoom, floor, PLATE_SCALE, FIT_STEPS)
    const fits = size > floor || this.hasRoom(floor)
    const away = !fits && PLATE_AWAY
    if (away !== was) { this.away = away; this.moved = true }
    return size
  }

  /**
   * The housing's rectangle on the screen this frame, in clip space, grown by HOLE_PAD: the one place a label may
   * not be. Nothing here allocates; the camera, the plate and the year are all as this frame will draw them.
   */
  private clearPlate(camera: THREE.Camera | undefined): void {
    const group = this.yearGroup, housing = this.housing, box = this.housingBox
    const out = this.plateRect.value
    // An away plate is nothing to keep clear of.
    if (!group?.parent || !housing || !box || !camera || this.pop < 0.02) { out.set(2, 2, -2, -2); return }
    group.updateMatrix()
    this.clip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .multiply(group.parent.matrixWorld).multiply(group.matrix).multiply(housing.matrix)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (let i = 0; i < 8; i++) {
      const corner = this.corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z, 1).applyMatrix4(this.clip)
      // Behind the lens there is no rectangle.
      if (corner.w < 0.01) { out.set(2, 2, -2, -2); return }
      const x = corner.x / corner.w, y = corner.y / corner.w
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    // No size to the screen for a moment (a collapsed canvas): there is no rectangle, and NaN must not reach the labels' shader.
    if (!Number.isFinite(x0 + x1 + y0 + y1)) { out.set(2, 2, -2, -2); return }
    out.set(x0 - HOLE_PAD, y0 - HOLE_PAD, x1 + HOLE_PAD, y1 + HOLE_PAD)
  }

  /** Narrows the lead to what keeps the point in `this.point` inside its edge of the screen. */
  private narrow(): void {
    const range = leadBound(this.point, this.range)
    this.lowest = Math.max(this.lowest, range[0])
    this.highest = Math.min(this.highest, range[1])
  }

  /** The year the plate is showing. Read by the QA harness. */
  get year(): number { return this.current }
  /** How far down the road, past the car, the plate is standing (metres). */
  get plateLead(): number { return this.leading }
  /** The plate's scale as drawn: PLATE_SCALE where the screen has room, less where it has not (see PLATE_MIN_PX). 1 is the plate as authored. */
  get plateSize(): number { return this.size }
  /** Where the plate stands: 'left' of the car, or 'away' (see PLATE_AWAY). Read by the QA harness. */
  get platePlace(): Place { return this.away ? 'away' : 'left' }
  /** The seven-segment mask on each authored digit, thousands first. */
  get digitMasks(): number[] { return this.digits.map(digit => digit.mask) }
  /** Which bars are standing out of the plate right now (A..G), thousands first. */
  get litSegments(): boolean[][] { return this.digits.map(digit => Array.from(digit.lift, value => value > 0.5)) }
  /** Every socket of the three lanes, for the QA harness: the stone's home and where it comes to rest. */
  get sockets(): Socket[] { return this.socketList }
  /** The rim and the coloured floor it frames, once built. */
  get rim(): { rim: THREE.Mesh; floor: THREE.Mesh } | null { return this.track }
  /** Every plaque's height, in metres. */
  get plaqueHeight(): number { return PLAQUE_HEIGHT }
  /** How many plaques exist so far (they are made as the car comes near). Read by the QA harness. */
  get plaques(): number { return this.lines.reduce((n, line) => n + (line.sign ? 1 : 0), 0) }
  /** True if anything here still paints the year onto a canvas instead. */
  get paintedYear(): boolean { return false }
  /** Stages the visitor has walked past, accumulated over the whole session. */
  private readonly visited = new Set<string>()
  get seen(): number { return this.visited.size }
  /** Every stop the walk carries, for the awards and the QA harness. */
  get stops(): number { return CAREER.length }
}

/* ============================================================
   THE RIM
   Pure arrays, no three: the outline of every socket and channel on one
   lane, as walls and a top (the grey) and the floor they leave open (the
   colour). Everything is metres in the career's own frame.
   ============================================================ */

/**
 * Measured off the authored plate. A socket is a 0.783 m ring around a 0.505 m
 * hole; a channel is a 0.340 m rim around a 0.129 m line; a channel that ends in
 * the open is closed by a 0.139 m cap. TOP, FLOOR and FOOT are heights: of the
 * rim's top, of the coloured floor inside it, and of the outer wall's foot.
 */
export const RIM = {
  SOCKET_OUTER: 0.3915, SOCKET_INNER: 0.2525,
  CHANNEL_OUTER: 0.170, CHANNEL_INNER: 0.0645,
  CAP: 0.139,
  TOP: 0.0912, FLOOR: 0.0414, FOOT: 0,
}
export type RimSpec = typeof RIM

export interface LaneRim {
  /** The lane's centre line. */
  x: number
  /** The z of each socket's centre. */
  sockets: number[]
  /** Lines between two z values, normally two sockets' centres. */
  channels: Array<[number, number]>
}

export interface RimGeometry {
  rim: { position: number[]; normal: number[]; index: number[] }
  floor: { position: number[]; index: number[] }
}

type Vec3 = [number, number, number]
const round5 = (value: number): number => Math.round(value * 1e5) / 1e5

/**
 * The outline of the union of a lane's sockets and channels, as z-slabs of constant
 * half-width: `outer(z)` is where the wall stands, `inner(z)` where the opening is.
 * The rim is the ring between them and the floor is the opening, so the hole IS the
 * coloured shape — one profile makes both. Reproduces the authored plate's top face
 * to the millimetre (IoU 1.0 at a 5 mm raster).
 */
export function buildLaneRim(lane: LaneRim, spec: RimSpec = RIM): RimGeometry {
  const { x: xc, sockets, channels } = lane
  const { SOCKET_OUTER, SOCKET_INNER, CHANNEL_OUTER, CHANNEL_INNER, CAP, TOP: T, FLOOR: FL, FOOT: B } = spec
  const outer = (z: number): number => {
    let half = 0
    for (const [low, high] of channels) if (z >= low - CAP && z <= high) half = Math.max(half, CHANNEL_OUTER)
    for (const c of sockets) if (Math.abs(z - c) <= SOCKET_OUTER) half = Math.max(half, SOCKET_OUTER)
    return half
  }
  const inner = (z: number): number => {
    let half = 0
    for (const [low, high] of channels) if (z >= low && z <= high) half = Math.max(half, CHANNEL_INNER)
    for (const c of sockets) if (Math.abs(z - c) <= SOCKET_INNER) half = Math.max(half, SOCKET_INNER)
    return half
  }

  const marks = new Set<number>()
  for (const c of sockets) for (const d of [SOCKET_OUTER, SOCKET_INNER]) { marks.add(round5(c - d)); marks.add(round5(c + d)) }
  for (const [low, high] of channels) { marks.add(round5(low - CAP)); marks.add(round5(low)); marks.add(round5(high)) }
  const breaks = [...marks].sort((a, b) => a - b)
  const slabs: Array<{ z0: number; z1: number; o: number; n: number }> = []
  for (let i = 0; i + 1 < breaks.length; i++) {
    if (breaks[i + 1] - breaks[i] < 1e-6) continue
    const middle = (breaks[i] + breaks[i + 1]) / 2
    const slab = { z0: breaks[i], z1: breaks[i + 1], o: outer(middle), n: inner(middle) }
    const last = slabs[slabs.length - 1]
    // A mark inside a wider shape changes nothing: one slab, not two.
    if (last && last.o === slab.o && last.n === slab.n && last.z1 === slab.z0) last.z1 = slab.z1
    else slabs.push(slab)
  }

  const P: number[] = [], N: number[] = [], I: number[] = [], F: number[] = [], FI: number[] = []
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, normal: Vec3) => {
    const k = P.length / 3
    for (const v of [a, b, c, d]) { P.push(v[0], v[1], v[2]); N.push(normal[0], normal[1], normal[2]) }
    I.push(k, k + 1, k + 2, k, k + 2, k + 3)
  }
  for (const s of slabs) {
    if (s.o <= 0) continue
    const top = (a: number, b: number) => quad([a, T, s.z1], [b, T, s.z1], [b, T, s.z0], [a, T, s.z0], [0, 1, 0])
    if (s.n > 0) { top(xc - s.o, xc - s.n); top(xc + s.n, xc + s.o) } else top(xc - s.o, xc + s.o)
    quad([xc - s.o, B, s.z0], [xc - s.o, B, s.z1], [xc - s.o, T, s.z1], [xc - s.o, T, s.z0], [-1, 0, 0])
    quad([xc + s.o, B, s.z1], [xc + s.o, B, s.z0], [xc + s.o, T, s.z0], [xc + s.o, T, s.z1], [1, 0, 0])
    if (s.n > 0) {
      quad([xc - s.n, FL, s.z1], [xc - s.n, FL, s.z0], [xc - s.n, T, s.z0], [xc - s.n, T, s.z1], [1, 0, 0])
      quad([xc + s.n, FL, s.z0], [xc + s.n, FL, s.z1], [xc + s.n, T, s.z1], [xc + s.n, T, s.z0], [-1, 0, 0])
      const k = F.length / 3
      for (const v of [[xc - s.n, FL, s.z1], [xc + s.n, FL, s.z1], [xc + s.n, FL, s.z0], [xc - s.n, FL, s.z0]]) F.push(v[0], v[1], v[2])
      FI.push(k, k + 1, k + 2, k, k + 2, k + 3)
    }
  }
  // Where the outline steps between two slabs, a wall closes the step.
  const step = (z: number, a: number, b: number, kind: 'outer' | 'inner') => {
    if (a === b) return
    const low = Math.min(a, b), high = Math.max(a, b)
    if (high <= 0) return
    const towardNext = b < a
    const faceZ = kind === 'outer' ? (towardNext ? 1 : -1) : (towardNext ? -1 : 1)
    const y0 = kind === 'outer' ? B : FL
    for (const side of [-1, 1]) {
      const p = xc + side * low, q = xc + side * high
      const left = Math.min(p, q), right = Math.max(p, q)
      if (right - left < 1e-6) continue
      if (faceZ > 0) quad([left, y0, z], [right, y0, z], [right, T, z], [left, T, z], [0, 0, 1])
      else quad([right, y0, z], [left, y0, z], [left, T, z], [right, T, z], [0, 0, -1])
    }
  }
  for (let i = 0; i + 1 < slabs.length; i++) {
    const a = slabs[i], b = slabs[i + 1]
    step(a.z1, a.o, b.o, 'outer')
    step(a.z1, a.n, b.n, 'inner')
  }
  const first = slabs.find(s => s.o > 0)
  const last = [...slabs].reverse().find(s => s.o > 0)
  if (first && last) {
    quad([xc + first.o, B, first.z0], [xc - first.o, B, first.z0], [xc - first.o, T, first.z0], [xc + first.o, T, first.z0], [0, 0, -1])
    quad([xc - last.o, B, last.z1], [xc + last.o, B, last.z1], [xc + last.o, T, last.z1], [xc - last.o, T, last.z1], [0, 0, 1])
  }
  return { rim: { position: P, normal: N, index: I }, floor: { position: F, index: FI } }
}

export interface LaidSocket { z: number; heads: string[]; tails: string[] }

/**
 * The sockets of one lane. Heads never move: a stone stands where its date puts it.
 * A tail within `merge` of a head, or of another stop's tail, shares that socket
 * (one stop ends where the next begins; two end the same month). The rest are
 * pushed down the road until every socket is `separation` clear of the others, so
 * two rings never run into each other and put a wall inside a neighbour's square.
 * A stop with no end has no tail socket and keeps its span.
 */
export function layoutSockets(stops: Placed[], { merge = MERGE, separation = SEPARATION } = {}): { stops: Placed[]; sockets: LaidSocket[] } {
  const laid = stops.map(stop => ({ ...stop }))
  const sockets: LaidSocket[] = []
  const at = (z: number) => sockets.find(socket => Math.abs(socket.z - z) < 1e-6)
  for (const stop of laid) {
    const socket = at(stop.head)
    if (socket) socket.heads.push(stop.id)
    else sockets.push({ z: stop.head, heads: [stop.id], tails: [] })
  }
  // Tails that end together are one tail; take them nearest the start of the road first.
  const ends = laid.filter(stop => stop.hasEnd).sort((a, b) => b.tail - a.tail)
  const clusters: Placed[][] = []
  for (const stop of ends) {
    const cluster = clusters[clusters.length - 1]
    if (cluster && Math.abs(cluster[0].tail - stop.tail) < merge) cluster.push(stop)
    else clusters.push([stop])
  }
  for (const cluster of clusters) {
    let z = cluster[0].tail
    let socket: LaidSocket | undefined
    for (let guard = 0; guard < 32 && !socket; guard++) {
      socket = sockets.find(other => Math.abs(other.z - z) < merge)
      if (socket) break
      const clash = sockets.filter(other => Math.abs(other.z - z) < separation)
      if (!clash.length) break
      z = Math.min(...clash.map(other => other.z)) - separation
    }
    if (!socket) { socket = { z, heads: [], tails: [] }; sockets.push(socket) }
    for (const stop of cluster) {
      stop.tail = socket.z
      stop.span = stop.head - stop.tail
      socket.tails.push(stop.id)
    }
  }
  return { stops: laid, sockets: sockets.sort((a, b) => b.z - a.z) }
}

/**
 * What `settlePlaques` reads and writes: a plaque's rectangle in clip space, and how far it has to move. `pdx` and `pdy` are, if
 * given, how far it was told to move last frame (NaN, or absent: none): the plaque stands there again if that is still a place, whatever the others
 * would like (and a place near that is worth a little more than an equally near one that is not).
 */
export interface PlaqueRect {
  x0: number; y0: number; x1: number; y1: number; dx: number; dy: number; pdx?: number; pdy?: number
  /**
   * Where its stone's anchor is in clip space, and how far from it the plaque's nearest edge may stand, in clip units of y (a unit of
   * x is `safe.aspect` times as far on the screen). With a `reach` above 0 a place further from the anchor than that is not a place.
   */
  ax?: number; ay?: number; reach?: number
  /**
   * What it costs to give this plaque up, in the layout's own currency (see `plaquePrice`). With a `rank` a plaque that has no place left
   * within its reach, or whose best place costs as much as this, is given up: `out` is set and it stands where it is told to by nobody.
   * Without one it is always placed, as far as it must go.
   */
  rank?: number
  out?: boolean
}
/**
 * A place no plaque may stand: the year plate's housing, the car, a column of buttons. `x0 >= x1` (or `y0 >= y1`) means there is none.
 * A `hard` one is the page's own (the buttons, the speed readout), never to be stood on if there is a plaque to give up instead; the plate
 * and the car are not: a plaque may stand a little on them (the shader's hole takes the car and the plate out of it) before it is given up.
 */
export interface KeepOut {
  x0: number; y0: number; x1: number; y1: number; hard?: boolean
  /** A plaque that stands where it is, for the plaques that are asked about to find room beside it (see `admit`): nothing is placed beside it, only over and under it, as plaques are. */
  plaque?: boolean
  /** How much of the rim of the rectangle is margin (the car's rectangle is the car and a margin of CAR_KEEP.pad): a plaque that leans into it (see LEAN_Y) goes that far into it and no further. 0 or absent: none (the year plate is its hole). */
  margin?: number
}

/** Each overlap costs more than the whole screen is wide, so a plaque only ever stands on something when nothing else is left; and a plaque over another costs more than a plaque over a keep-out. */
const PLAQUE_OVER_PLAQUE = 100
const PLAQUE_OVER_KEEP = 5
const AREA_WEIGHT = 1e3
const OVERLAP_EPS = 1e-9
/**
 * Staying put. A plaque that has a place from last frame prefers a place near it (STAY, per unit of distance, on the screen), and
 * a place that is more than SWITCH_AT from it is a change of mind, which costs SWITCH more and must also clear the box's top and
 * bottom by HOLD, and the plaque's wanted place the things it was moved off by HOLD: so a car or a camera that moves a hair
 * across the edge of what fits cannot swap two arrangements every frame (clip units; the screen is 2).
 */
const STAY = 0.3
const SWITCH = 0.3
const SWITCH_AT = 0.06
const HOLD = 0.02
/**
 * Leaning. The place a plaque was put at last frame is still a place while the margins that keep a new place clear of the others and of the car
 * (the spacing between plaques, the car's margin) are leaned into by this much, up and down and across: the edge between a place and no place is a band,
 * not a hair. A stack of three plaques and a car on a phone on its side leaves the one over the car 3 thousandths of the screen short of fitting under
 * the top of the box, and a car that shuffled a quarter of a metre sent that plaque from over the car to under it and back, twice a second.
 */
const LEAN_Y = 0.03
const LEAN_X = 0.02
/** Two plaques may be on each other by this much (a fraction of a pixel on any screen) where the spacing is leaned into: a stack of three that is a thousandth of the screen short of fitting is not rearranged for it. */
const LEAN_OVER = 0.002
/** ...and into the limit of its reach, by this much, and into the page's own controls (which keep BAR_CLEAR_PX and HUD_CLEAR_PX of clear ground round them already) by this much. */
const LEAN_REACH = 0.02
const LEAN_HARD = 0.01
/** ...and into the year plate's own hole (it has no margin) by this much: a plaque that a plate has come to touch is not moved for it, and it is no more than 3 or 4% of a plaque's area under it. */
const LEAN_PLATE = 0
/** ...and so are the places this near to the one it stood at (on the screen): a squeeze that is a few thousandths short moves the plaque by that much, not across the screen. */
const LEAN_NEAR = 0.06

/** How far a plaque's nearest edge stands from its stone's anchor once it is moved by its `dx` and `dy`, on the screen, in clip units of y (`aspect` is the canvas's width over its height): the distance the layout limits with `reach`. */
export function plaqueGap(r: PlaqueRect, aspect: number): number {
  const ax = r.ax ?? 0, ay = r.ay ?? 0
  const gx = Math.max(r.x0 + r.dx - ax, ax - (r.x1 + r.dx), 0) * aspect
  const gy = Math.max(r.y0 + r.dy - ay, ay - (r.y1 + r.dy), 0)
  return Math.sqrt(gx * gx + gy * gy)
}

/** What giving a plaque up is worth to the layout: what standing on a keep-out costs when `share` of the plaque (of its area, `area` in clip units) is under it. */
export function plaquePrice(area: number, share: number): number {
  return PLAQUE_OVER_KEEP + AREA_WEIGHT * area * share
}

const keepAt = (keepOut: KeepOut | readonly KeepOut[], many: boolean, index: number): KeepOut => (many ? (keepOut as readonly KeepOut[])[index] : (keepOut as KeepOut))
const used = (o: KeepOut): boolean => o.x0 < o.x1 && o.y0 < o.y1

/**
 * Scratch for `settlePlaques`, which runs every frame: the order the plaques are being placed in, Heap's counters for trying every
 * order, the best arrangement found, and the cost of one placement (a number returned from a call is boxed; one stored here is not).
 * No more plaques than MOST are settled (there are three lanes).
 */
const MOST = 32
const ORDER = new Int8Array(MOST)
const COUNTER = new Int8Array(MOST)
const BEST = new Float64Array(MOST * 2)
const BEST_OUT = new Uint8Array(MOST)
const COST = new Float64Array(2)
/** The plaques that do not keep the place they stood at (see `settlePlaques`), by index. */
const REST = new Int8Array(MOST)
/** Every order is tried only for this many plaques or fewer: three lanes speak at once. */
const TRY_ALL = 4

/**
 * Places the plaques `order` names, one after the other, each at the nearest clear place left by the keep-outs and the plaques
 * already placed; writes their `dx` and `dy`, and into `COST` the sum of what it cost and how much of that is overlaps. Everything
 * is a local number: one passed to or returned from a call that is not inlined is boxed.
 */
function placeInOrder(rects: PlaqueRect[], n: number, safe: Safe, keepOut: KeepOut | readonly KeepOut[] | null, many: boolean, count: number, from: number, keeping: boolean): void {
  const aspect = safe.aspect ?? 1
  const gap = safe.spacing
  let total = 0, clashes = 0
  // (`from`: the plaques before it in the order are placed already, and stand where they stand; `keeping`: each plaque that has a place from last frame is put there if that is a place, and the others are left for later: `out` marks them)
  for (let step = from; step < n; step++) {
    const r = rects[ORDER[step]]
    r.out = false
    const width = r.x1 - r.x0, height = r.y1 - r.y0
    // Where its stone's anchor is, and how far from it it may stand (no limit if it has none).
    const ax = r.ax ?? 0, ay = r.ay ?? 0, reach = r.reach ?? 0
    const limited = reach > 0 && ax === ax && ay === ay
    const reachSq = reach * reach + OVERLAP_EPS
    const leanReach = reach + LEAN_REACH
    const leanReachSq = leanReach * leanReach + OVERLAP_EPS
    const xMin = -safe.x, xMax = Math.max(xMin, safe.x - width)
    const yMin = -safe.bottom, yMax = Math.max(yMin, safe.top - height)
    // Where it stood last frame, if it did, brought back into the box if its stone has carried it out (a plaque that stands against the top of the box
    // goes on standing against it while the stone rises, rather than being a hair over the limit and so no place at all).
    const prevX0 = r.x0 + (r.pdx ?? NaN), prevY0 = r.y0 + (r.pdy ?? NaN)
    const stays = prevX0 === prevX0 && prevY0 === prevY0
    const prevX = prevX0 < xMin ? xMin : prevX0 > xMax ? xMax : prevX0
    const prevY = prevY0 < yMin ? yMin : prevY0 > yMax ? yMax : prevY0
    if (keeping && !stays) { r.out = true; r.dx = 0; r.dy = 0; continue }
    // Where it wants to be: beside its stone, brought into the box (its left edge, where the words begin, wins over its right).
    let wantX = r.x0, wantY = r.y0
    if (r.x1 > safe.x) wantX += safe.x - r.x1
    if (wantX < -safe.x) wantX = -safe.x
    if (r.y1 > safe.top) wantY += safe.top - r.y1
    if (wantY < -safe.bottom) wantY = -safe.bottom
    // Where its lower left corner could stand: x is where it wants to be, the box's two limits, then each side of each keep-out;
    // y is where it wants to be, the box's limits, then under and over each keep-out and each plaque already placed (under first:
    // of two equally near places a plaque goes down, as the lanes have always stacked).
    // (and, for a plaque that has a place from last frame, that place's own x and y: a plaque that stands somewhere that is still clear is not moved
    // because the plaque it was stacked under has gone, which leaves nothing at its height among the places the others make)
    const nx = 3 + 2 * count + (stays ? 1 : 0), ny = 3 + 2 * count + 2 * step + (stays ? 1 : 0)
    let bestX = wantX, bestY = wantY, best = Infinity, bestClash = 0
    // A plaque that keeps its place is tried at exactly that place; if it is not a place any more (a hair of the plate's or the car's edge is on it), it is tried once more at the places near it (`nudge`):
    // the nearest place beside the one it stood at is where it goes, rather than the cheapest place on the screen, which can be across the car.
    for (let pass = 0; pass < (keeping ? 2 : 1); pass++) {
    const nudge = pass === 1
    best = Infinity
    bestClash = 0
    // First with the margins a change of mind must clear; only if that leaves something overlapped, once more without them.
    for (let attempt = 0; attempt < (stays ? 2 : 1); attempt++) {
      const margins = attempt === 0 && stays
      for (let ix = keeping && !nudge ? nx - 1 : 0; ix < nx; ix++) {
        let x = wantX
        if (ix === 1) x = xMin
        else if (ix === 2) x = xMax
        else if (stays && ix === nx - 1) x = prevX
        else if (ix > 2) {
          const o = keepAt(keepOut!, many, (ix - 3) >> 1)
          if (!used(o) || o.plaque === true) continue
          x = (ix & 1) === 1 ? o.x1 : o.x0 - width
        }
        if (!(x >= xMin - OVERLAP_EPS && x <= xMax + OVERLAP_EPS)) continue
        for (let iy = keeping && !nudge ? ny - 1 : 0; iy < ny; iy++) {
          let y = wantY
          if (iy === 1) y = yMin
          else if (iy === 2) y = yMax
          else if (stays && iy === ny - 1) y = prevY
          else if (iy > 2) {
            const k = (iy - 3) >> 1, over = ((iy - 3) & 1) === 1
            if (k < count) {
              const o = keepAt(keepOut!, many, k)
              if (!used(o)) continue
              y = over ? o.y1 + gap : o.y0 - gap - height
            } else {
              const q = rects[ORDER[k - count]]
              if (q.out) continue
              y = over ? q.y1 + q.dy + gap : q.y0 + q.dy - gap - height
            }
          }
          // How far this is from where it stood, and so whether it is a change of mind.
          let away = 0
          if (stays) {
            const sx = (x - prevX) * aspect, sy = y - prevY
            away = Math.sqrt(sx * sx + sy * sy)
          }
          if (nudge && away > LEAN_NEAR) continue
          const change = margins && away > SWITCH_AT
          const slack = change ? HOLD : 0
          // The place it stood at last frame, and the places within LEAN_NEAR of it, are leaned into the margins and the limit of its reach (see LEAN_Y, LEAN_REACH).
          const leaned = stays && away <= LEAN_NEAR
          if (!(y >= yMin + slack - OVERLAP_EPS && y <= yMax - slack + OVERLAP_EPS)) continue
          // Further from its stone than it may stand is not a place.
          if (limited) {
            let gx = x - ax, gy = y - ay
            if (ax - (x + width) > gx) gx = ax - (x + width)
            if (ay - (y + height) > gy) gy = ay - (y + height)
            if (gx < 0) gx = 0
            if (gy < 0) gy = 0
            gx *= aspect
            if (gx * gx + gy * gy > (leaned ? leanReachSq : reachSq)) continue
          }
          // What standing here costs: the move from where it wanted to be, on the screen, the move from where it stood, and every plaque and keep-out it would overlap.
          const mx = (x - wantX) * aspect, my = y - wantY
          let cost = Math.sqrt(mx * mx + my * my)
          if (stays) cost += STAY * away + (change ? SWITCH : 0)
          // Going back to exactly where it wants to be, off something it was moved off, must clear it by HOLD more.
          const pad = change && mx * mx + my * my < OVERLAP_EPS ? HOLD : 0
          // ...and the place it stood at last frame may lean into the margins (spacing, the car's margin) by LEAN_Y and LEAN_X (the page's own controls, which are hard, a little).
          const spacing = leaned ? Math.max(-LEAN_OVER, gap - LEAN_Y) : gap
          let clash = 0
          for (let j = 0; j < step; j++) {
            const q = rects[ORDER[j]]
            if (q.out) continue
            const across = Math.min(x + width, q.x1 + q.dx + pad) - Math.max(x, q.x0 + q.dx - pad)
            if (across <= OVERLAP_EPS) continue
            const down = Math.min(y + height, q.y1 + q.dy + spacing + pad) - Math.max(y, q.y0 + q.dy - spacing - pad)
            if (down > OVERLAP_EPS) clash += PLAQUE_OVER_PLAQUE + AREA_WEIGHT * across * down
          }
          for (let k = 0; k < count; k++) {
            const o = keepAt(keepOut!, many, k)
            if (!used(o)) continue
            const hard = o.hard === true, rim = o.margin ?? 0
            const mx0 = leaned ? pad - (hard ? LEAN_HARD : Math.min(LEAN_X, rim)) : pad
            const my0 = leaned ? pad + gap - (hard ? LEAN_HARD : Math.min(LEAN_Y, gap + rim)) : pad + gap
            const across = Math.min(x + width, o.x1 + mx0) - Math.max(x, o.x0 - mx0)
            if (across <= OVERLAP_EPS) continue
            const down = Math.min(y + height, o.y1 + my0) - Math.max(y, o.y0 - my0)
            if (down > OVERLAP_EPS) clash += (o.hard === true ? PLAQUE_OVER_PLAQUE : PLAQUE_OVER_KEEP) + AREA_WEIGHT * across * down
          }
          cost += clash
          if (cost < best - OVERLAP_EPS) { best = cost; bestClash = clash; bestX = x; bestY = y }
        }
      }
      if (best < Infinity && bestClash === 0) break
    }
    if (!keeping || (best < Infinity && bestClash === 0)) break
    }
    if (keeping) {
      // The place it stood at is a place only if nothing is on it and it is within reach and the box.
      if (!(best < Infinity && bestClash === 0)) { r.out = true; r.dx = 0; r.dy = 0; continue }
      r.dx = bestX - r.x0
      r.dy = bestY - r.y0
      continue
    }
    // A plaque with a price that has no place within reach of its stone, or none that costs less than giving it up, does not speak.
    const price = r.rank
    if (price !== undefined && !(best < price)) {
      r.out = true
      r.dx = 0
      r.dy = 0
      total += price
      clashes += price
      continue
    }
    r.dx = bestX - r.x0
    r.dy = bestY - r.y0
    total += best
    clashes += bestClash
  }
  COST[0] = total
  COST[1] = clashes
}

/**
 * Where plaques go so that each is inside `safe`, none touches another, and none stands on a keep-out. `rects` hold each
 * plaque's rectangle where it would stand beside its stone (x0..y1, clip space) and get their `dx` and `dy`: the move that puts
 * them right. `keepOut` is one rectangle or a list: the year plate, the car, the touch buttons, the speed readout.
 *
 * A plaque that stood somewhere last frame (`pdx`, `pdy`) stands there again if that is still a place (clear of the keep-outs and of the
 * plaques that keep their places, within reach and the box, leaning a little into the margins: see LEAN_Y); and after the others are placed it goes to a better
 * place only if that is clear of every other plaque where it stands and is worth the change of mind (`STAY`, `SWITCH`). Highest first, each of the others takes
 * the nearest place that is clear: where it wants to stand (beside its stone, brought into the
 * box), or flush against one side of a keep-out, or under or over a plaque already placed (plaques give way to each other only up
 * and down, so the three lanes stay a stack), or against the box's own limits. Near is measured on the screen (`safe.aspect` is
 * its width over its height). Where the screen is so crowded that no clear place is left for one, the plaques are placed again in
 * every other order (a plaque that has no room last may have it first, and the others move along): the arrangement that overlaps
 * least wins. What is still left over is the least that can be done: never a plaque on another while there is room for it, and on
 * a keep-out only if it must (the shader's hole takes the plate out of a label that is left over it). A plaque with a `reach` takes
 * no place further than that from its stone's anchor, and one with a `rank` (a price: see `plaquePrice`) whose best place costs as much,
 * or that has none, is given up (`out`): it does not take part in placing the rest. The orders are tried then too, so that the plaque that
 * is given up is the one that is worth least. Where nothing is wrong, nothing moves.
 *
 * With `keeping` false no plaque keeps its place or looks for a better one: every plaque is placed afresh by the cost (what the layout did before the plaques kept their
 * places; `rescue` asks it when keeping leaves a plaque with no room that a rearrangement would have).
 *
 * Allocates nothing: one function of locals and a few arrays made once. Sorts the array it is given (its first `size` entries, if it is given a size: an array that is
 * refilled every frame is not emptied and grown again, which allocates).
 */
export function settlePlaques<T extends PlaqueRect>(rects: T[], safe: Safe = SAFE, keepOut: KeepOut | readonly KeepOut[] | null = null, size: number = rects.length, keeping: boolean = true): T[] {
  const n = Math.min(size, rects.length, MOST)
  sortByHeight(rects, n)
  const many = Array.isArray(keepOut)
  const count = keepOut === null ? 0 : many ? (keepOut as readonly KeepOut[]).length : 1
  for (let i = 0; i < n; i++) ORDER[i] = i
  // First, every plaque that stood somewhere last frame stands there again if that is still a place (highest first: a place another plaque has taken is not).
  // A plaque that is well placed is not moved because another one has come, or because a better place has opened for the one that came first:
  // those used to send a plaque across the car for a few frames and back.
  if (keeping) placeInOrder(rects, n, safe, keepOut, many, count, 0, true)
  else for (let i = 0; i < n; i++) rects[i].out = true
  let fixed = 0, loose = 0
  for (let i = 0; i < n; i++) {
    if (rects[i].out) REST[loose++] = i
    else ORDER[fixed++] = i
  }
  for (let k = 0; k < loose; k++) ORDER[fixed + k] = REST[k]
  // ...then the others take the nearest clear places among those.
  COST[0] = 0
  COST[1] = 0
  if (loose) placeInOrder(rects, n, safe, keepOut, many, count, fixed, false)
  let best = COST[0]
  if (COST[1] > 0 && loose > 1 && loose <= TRY_ALL) {
    for (let i = 0; i < n; i++) { BEST[2 * i] = rects[i].dx; BEST[2 * i + 1] = rects[i].dy; BEST_OUT[i] = rects[i].out ? 1 : 0 }
    // Heap's algorithm, without recursion: every order of the plaques that are left, once.
    for (let i = 0; i < loose; i++) COUNTER[i] = 0
    let i = 0
    while (i < loose) {
      if (COUNTER[i] < i) {
        const j = fixed + ((i & 1) === 0 ? 0 : COUNTER[i])
        const swap = ORDER[j]
        ORDER[j] = ORDER[fixed + i]
        ORDER[fixed + i] = swap
        placeInOrder(rects, n, safe, keepOut, many, count, fixed, false)
        if (COST[0] < best - OVERLAP_EPS) {
          best = COST[0]
          for (let k = 0; k < n; k++) { BEST[2 * k] = rects[k].dx; BEST[2 * k + 1] = rects[k].dy; BEST_OUT[k] = rects[k].out ? 1 : 0 }
        }
        COUNTER[i]++
        i = 0
      } else {
        COUNTER[i] = 0
        i++
      }
    }
    for (let k = 0; k < n; k++) { rects[k].dx = BEST[2 * k]; rects[k].dy = BEST[2 * k + 1]; rects[k].out = BEST_OUT[k] === 1 }
  }
  // Last, a plaque that kept its place goes to a better one if that is worth the change of mind (it is nearer to where it wants to stand by more than leaving costs),
  // and the place is clear of every other plaque where it stands: no plaque is made to move for it.
  for (let k = 0; k < fixed; k++) {
    const last = n - 1
    const swap = ORDER[k]
    ORDER[k] = ORDER[last]
    ORDER[last] = swap
    const r = rects[swap]
    const dx = r.dx, dy = r.dy
    placeInOrder(rects, n, safe, keepOut, many, count, last, false)
    if (r.out) { r.out = false; r.dx = dx; r.dy = dy }
    ORDER[last] = ORDER[k]
    ORDER[k] = swap
  }
  return rects
}

/* ============================================================
   THE PLAQUE
   One face, painted: a timber frame, a sheet of parchment, a band in
   the lane's colour with a picture of what the lane is, and two lines of
   ink (the name, then what it was), in Geist.
   ============================================================ */

/** Fractions of the canvas height: the frame, the lane band, the gap between things, and the two lines' largest sizes. */
const FRAME = 0.075
const BAND = 0.62
const GAP = 0.1
const HEAD_MAX = 0.42
const HEAD_MIN = 0.2
const SUB_MAX = 0.24
const SUB_MIN = 0.14
/** The slab's bevel (see Sign.buildLabel): the canvas is the front facet, which is the plaque less a bevel each side. */
const BEVEL = Math.min(0.02, PLAQUE_HEIGHT * 0.12)
/** The subtitle's largest size in metres, which is what every one of the nine is set at unless its words do not fit: the smallest painted replaces it (`Career.subMin`). */
const NOMINAL_SUB = SUB_MAX * (PLAQUE_HEIGHT - BEVEL * 2)

let measurer: CanvasRenderingContext2D | null = null

/** How wide the plaque must be to set this stop's two lines at their largest size, in metres. */
export function plaqueWidth(stop: Pick<CareerStop, 'headline' | 'subtitle'>): number {
  measurer ??= document.createElement('canvas').getContext('2d')!
  const fonts = signFonts()
  const h = (PLAQUE_HEIGHT - BEVEL * 2) * LABEL_DPM
  measurer.font = `800 ${h * HEAD_MAX}px ${fonts.sans}`
  const head = measurer.measureText(stop.headline.toUpperCase()).width
  measurer.font = `600 ${h * SUB_MAX}px ${fonts.sans}`
  const sub = measurer.measureText(stop.subtitle).width
  const text = Math.max(head, sub)
  const px = h * (FRAME * 2 + BAND + GAP * 2) + text
  return Math.max(1.9, Math.min(PLAQUE_MAX_WIDTH, px / LABEL_DPM + BEVEL * 2))
}

export function paintPlaque(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }, sans: string, stop: CareerStop, track: CareerTrack): { head: number; sub: number } {
  const { w, h } = rect
  const frame = h * FRAME
  // The timber. Its dark edge is what the slab's bevel and sides show.
  paintWood(ctx, rect, { seed: stop.id, base: TOKENS.woodDark, boards: 1, nails: false })
  ctx.strokeStyle = '#2c2619'; ctx.lineWidth = Math.max(3, h * 0.035)
  ctx.strokeRect(0, 0, w, h)
  const inner = { x: frame, y: frame, w: w - frame * 2, h: h - frame * 2 }
  paintParchment(ctx, inner, { seed: `${stop.id}:paper`, radius: h * 0.045, burn: 0.35, rule: false })

  // The lane's colour, with its picture in ink.
  const band = h * BAND
  ctx.save()
  ctx.beginPath(); ctx.rect(inner.x, inner.y, band, inner.h); ctx.clip()
  ctx.fillStyle = track.colour
  ctx.fillRect(inner.x, inner.y, band, inner.h)
  const sheen = ctx.createLinearGradient(inner.x, 0, inner.x + band, 0)
  sheen.addColorStop(0, 'rgba(255,255,255,0.16)'); sheen.addColorStop(1, 'rgba(0,0,0,0.12)')
  ctx.fillStyle = sheen
  ctx.fillRect(inner.x, inner.y, band, inner.h)
  ctx.restore()
  ctx.fillStyle = 'rgba(26,23,18,0.55)'
  ctx.fillRect(inner.x + band - h * 0.012, inner.y, h * 0.024, inner.h)
  paintMark(ctx, track.id, inner.x + band / 2, inner.y + inner.h / 2, band * 0.56, track.colour)

  // The words.
  const x = inner.x + band + h * GAP
  const room = inner.x + inner.w - h * GAP - x
  const head = fitText(ctx, stop.headline.toUpperCase(), { maxWidth: room, minPx: h * HEAD_MIN, maxPx: h * HEAD_MAX, weight: 800, family: sans, lineHeight: 1 })
  const sub = fitText(ctx, stop.subtitle, { maxWidth: room, minPx: h * SUB_MIN, maxPx: h * SUB_MAX, weight: 600, family: sans, lineHeight: 1.1 })
  const gap = h * 0.05
  const top = inner.y + (inner.h - (head.height + gap + sub.height)) / 2
  ctx.fillStyle = TOKENS.ink
  drawFit(ctx, head, x, top, 'left')
  ctx.fillStyle = TOKENS.ink2
  drawFit(ctx, sub, x, top + head.height + gap, 'left')

  // Four nails through the frame.
  const nail = frame * 0.5
  for (const [nx, ny] of [[nail, nail], [w - nail, nail], [nail, h - nail], [w - nail, h - nail]]) drawNail(ctx, nx, ny, frame * 0.26)
  return { head: head.px, sub: sub.px }
}

/** What a lane is, as a small ink picture: a mortarboard, a briefcase, a cog. `ground` is the band's colour, for the cut-outs. */
function paintMark(ctx: CanvasRenderingContext2D, lane: string, cx: number, cy: number, size: number, ground: string): void {
  const k = size / 2
  ctx.save()
  ctx.fillStyle = TOKENS.ink
  ctx.strokeStyle = TOKENS.ink
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  if (lane === 'education') {
    // The cap under the board, then the board over it, parted by a line of the band's colour; a tassel off one corner.
    ctx.beginPath()
    ctx.moveTo(cx - k * 0.56, cy + k * 0.02); ctx.lineTo(cx, cy + k * 0.3); ctx.lineTo(cx + k * 0.56, cy + k * 0.02)
    ctx.lineTo(cx + k * 0.56, cy + k * 0.46); ctx.quadraticCurveTo(cx, cy + k * 0.84, cx - k * 0.56, cy + k * 0.46)
    ctx.closePath(); ctx.fill()
    ctx.beginPath()
    ctx.moveTo(cx, cy - k * 0.66); ctx.lineTo(cx + k, cy - k * 0.2); ctx.lineTo(cx, cy + k * 0.26); ctx.lineTo(cx - k, cy - k * 0.2)
    ctx.closePath()
    ctx.lineWidth = k * 0.08; ctx.strokeStyle = ground; ctx.stroke(); ctx.fill()
    ctx.lineWidth = k * 0.07; ctx.strokeStyle = TOKENS.ink
    ctx.beginPath(); ctx.moveTo(cx + k * 0.82, cy - k * 0.12); ctx.lineTo(cx + k * 0.82, cy + k * 0.5); ctx.stroke()
    ctx.beginPath(); ctx.arc(cx + k * 0.82, cy + k * 0.58, k * 0.1, 0, Math.PI * 2); ctx.fill()
  } else if (lane === 'work') {
    // A briefcase: handle, body, the strap across it and the clasp.
    ctx.lineWidth = k * 0.15
    ctx.beginPath(); ctx.moveTo(cx - k * 0.3, cy - k * 0.36); ctx.lineTo(cx - k * 0.3, cy - k * 0.68); ctx.lineTo(cx + k * 0.3, cy - k * 0.68); ctx.lineTo(cx + k * 0.3, cy - k * 0.36); ctx.stroke()
    roundRect(ctx, cx - k * 0.94, cy - k * 0.44, k * 1.88, k * 1.32, k * 0.16); ctx.fill()
    ctx.fillStyle = ground
    ctx.fillRect(cx - k * 0.94, cy + k * 0.1, k * 1.88, k * 0.08)
    ctx.fillRect(cx - k * 0.14, cy - k * 0.02, k * 0.28, k * 0.3)
  } else {
    // A cog: eight teeth round a ring with a hole in it.
    for (let i = 0; i < 8; i++) {
      ctx.save()
      ctx.translate(cx, cy); ctx.rotate((i * Math.PI) / 4)
      ctx.fillRect(-k * 0.15, -k * 0.98, k * 0.3, k * 0.5)
      ctx.restore()
    }
    ctx.beginPath(); ctx.arc(cx, cy, k * 0.74, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = ground
    ctx.beginPath(); ctx.arc(cx, cy, k * 0.3, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
}

/**
 * The stone is two materials: a body and an emissive tip. The .blend colours
 * that tip per entry, but the export collapsed blue and white onto the purple
 * material, so the tip is repainted here in the track's own colour.
 */
function tintStone(stone: THREE.Object3D, colour: string): void {
  stone.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    const painted = materials.map(material =>
      /emissive/i.test(material.name ?? '')
        ? new THREE.MeshBasicMaterial({ color: colour, name: material.name })
        : material)
    node.material = painted.length === 1 ? painted[0] : painted
  })
}
