import { MOTION_COMPONENTS } from '@/cms/schema'

/* ============================================================
   THE ANIMATION LIBRARY'S CATALOGUE — admin only

   Names, descriptions, typed parameters, compatibility, how each
   effect behaves on small screens and under reduced motion, and
   what it costs to run. The public site never imports this file:
   it only ships runtime.ts's loaders for the effects a page uses.

   Parameters are data, never code: every value an administrator
   sets is a number, a choice from a list, a colour, a boolean or
   a short string, validated again by the effect when it renders
   (see types.ts). There is no way to run arbitrary script from
   here, by design.
   ============================================================ */

export type ParamType = 'number' | 'select' | 'boolean' | 'color' | 'text'
export interface ParamDef {
  key: string
  label: string
  type: ParamType
  default: unknown
  min?: number
  max?: number
  step?: number
  unit?: string
  options?: { value: string; label: string }[]
  help?: string
  group: 'Content' | 'Motion' | 'Style' | 'Trigger'
}

export type EffectCategory = 'text' | 'data' | 'project-visual' | 'background' | 'shape' | 'particles' | 'scroll' | 'interaction' | 'transition' | 'scene' | 'navigation'
export type Cost = 'low' | 'medium' | 'high'

export interface EffectDef {
  id: string
  name: string
  category: EffectCategory
  description: string
  /** Placeable effects can be added to any section as an Animation element. Inventory entries document effects built into the site. */
  placeable: boolean
  params: ParamDef[]
  /** Where it can go: 'animation' elements, or the built-in place it lives. */
  compatibility: string
  responsive: string
  reducedMotion: string
  cost: Cost
  costNote: string
  /** Built-in effects: where they live and where they are configured. */
  source?: string
  configuredIn?: string
  /** Built-in effects: the inputs that exist in code today, as documentation. */
  inputs?: string[]
  /** Built-in effects: where to see the real thing (a page, optionally a chapter of it). */
  preview?: { path: string; chapter?: string; note?: string }
  /** True for effects added with the library (not part of the original site). */
  added?: boolean
}

/* ---- controls every placed effect shares (EffectSlot) ---- */
export const SHARED_PARAMS: ParamDef[] = [
  { key: 'trigger', label: 'Trigger', type: 'select', default: 'viewport', group: 'Trigger', options: [{ value: 'viewport', label: 'When in view' }, { value: 'hover', label: 'On hover / focus' }, { value: 'click', label: 'On click (toggles)' }, { value: 'time', label: 'Immediately' }, { value: 'always', label: 'Always running' }] },
  { key: 'delay', label: 'Delay', type: 'number', default: 0, min: 0, max: 30, step: 0.1, unit: 's', group: 'Trigger' },
  { key: 'speed', label: 'Speed', type: 'number', default: 1, min: 0.1, max: 4, step: 0.05, unit: '×', group: 'Motion', help: 'Multiplies the effect’s clock.' },
  { key: 'scrollStart', label: 'Scroll start', type: 'number', default: 0, min: 0, max: 1, step: 0.01, group: 'Motion', help: 'Where in the element’s pass through the screen its progress starts.' },
  { key: 'scrollEnd', label: 'Scroll end', type: 'number', default: 1, min: 0, max: 1, step: 0.01, group: 'Motion' },
  { key: 'scrollFollow', label: 'Follow scroll', type: 'number', default: 1, min: 0, max: 1, step: 0.05, group: 'Motion', help: '0 ignores the scroll; 1 follows it fully.' },
  { key: 'accent', label: 'Accent', type: 'color', default: '', group: 'Style' },
  { key: 'ink', label: 'Ink', type: 'color', default: '', group: 'Style' },
  { key: 'surface', label: 'Surface', type: 'color', default: '', group: 'Style' },
]

const MOTION_NOTES: Record<(typeof MOTION_COMPONENTS)[number], string> = {
  ChessMotion: 'A board reading itself: pieces recognised square by square, then a suggested move.',
  StockMotion: 'An order book matching bids and asks into a moving price line.',
  ThreeBodyMotion: 'Three bodies under mutual gravity, drawing their orbits.',
  VpnMotion: 'Packets wrapped, tunnelled across a network and unwrapped.',
  GymMotion: 'A rigged figure repeating an exercise from pose data.',
  FocusMotion: 'A topic turning into a stack of short-video frames.',
  KeyframesMotion: 'Keyframes easing along a timeline.',
  LabyrinthMotion: 'A maze generated and then solved.',
  PrimesMotion: 'A sieve striking out composites to leave the primes.',
  VoxelMotion: 'Voxels assembling into a shape.',
  CardsMotion: 'A hand of cards dealt and played.',
  DotsBoxesMotion: 'Dots and boxes: lines drawn, boxes claimed.',
  TrainingMotion: 'A loss curve falling as a model trains.',
  CatanMotion: 'A hex board laid tile by tile.',
  VideoPlayerMotion: 'A video player scrubbing through chapters.',
  WebsiteMotion: 'A website’s pages laid out and scrolled.',
  LibraryMotion: 'Books shelved and indexed.',
  JobBoardMotion: 'Listings filtered and matched.',
  GenericProjectMotion: 'A neutral construction drawing for projects without a piece of their own.',
}

const projectVisuals: EffectDef[] = MOTION_COMPONENTS.map((m) => ({
  id: `project.${m}`,
  name: m.replace(/Motion$/, '').replace(/([a-z])([A-Z])/g, '$1 $2'),
  category: 'project-visual',
  description: MOTION_NOTES[m],
  placeable: true,
  params: [],
  compatibility: 'Animation elements; also each project’s card, page and overlay when it has no screenshot.',
  responsive: 'Fills its box; redraws at the box’s pixel size.',
  reducedMotion: 'Draws one composed still frame.',
  cost: 'medium',
  costNote: 'Canvas 2D, paused off screen.',
  source: `src/components/project-visuals/${m}.tsx`,
}))

export const EFFECTS: EffectDef[] = [
  {
    id: 'type.reveal',
    name: 'Text reveal',
    category: 'text',
    description: 'The site’s headline reveal: a line arriving through a mask, by characters or words, scrambled, in perspective or clipped.',
    placeable: true,
    params: [
      { key: 'text', label: 'Text', type: 'text', default: 'Building intelligent systems.', group: 'Content' },
      { key: 'mode', label: 'Behaviour', type: 'select', default: 'mask', group: 'Motion', options: ['mask', 'chars', 'words', 'scramble', 'perspective', 'clip'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })) },
      { key: 'stagger', label: 'Stagger', type: 'number', default: 0.028, min: 0, max: 0.3, step: 0.002, unit: 's', group: 'Motion' },
      { key: 'size', label: 'Size', type: 'number', default: 3.2, min: 1, max: 9, step: 0.1, unit: 'vw', group: 'Style' },
    ],
    compatibility: 'Animation elements.',
    responsive: 'Type scales with the viewport (clamped).',
    reducedMotion: 'The text appears without movement.',
    cost: 'low',
    costNote: 'CSS transforms on split spans.',
    source: 'src/components/typography/Reveal.tsx',
  },
  {
    id: 'data.counter',
    name: 'Count-up',
    category: 'data',
    description: 'A number counting up to its value, with a label — the metric treatment used across the chapters.',
    placeable: true,
    params: [
      { key: 'to', label: 'Value', type: 'number', default: 500000, min: 0, max: 1e12, step: 1, group: 'Content' },
      { key: 'prefix', label: 'Prefix', type: 'text', default: '', group: 'Content' },
      { key: 'suffix', label: 'Suffix', type: 'text', default: '+', group: 'Content' },
      { key: 'label', label: 'Label', type: 'text', default: 'Documents processed', group: 'Content' },
      { key: 'duration', label: 'Duration', type: 'number', default: 1.8, min: 0.2, max: 10, step: 0.1, unit: 's', group: 'Motion' },
    ],
    compatibility: 'Animation elements.',
    responsive: 'Type scales with the viewport (clamped).',
    reducedMotion: 'Shows the final value.',
    cost: 'low',
    costNote: 'One text node updated per frame while counting.',
    source: 'src/components/typography/Counter.tsx',
  },
  ...projectVisuals,
]


/* ---- added with the library: placeable in any section ---- */
const sel = (...v: string[]) => v.map((x) => ({ value: x, label: x[0].toUpperCase() + x.slice(1).replace(/-/g, ' ') }))
const P = (key: string, label: string, type: ParamDef['type'], def: unknown, group: ParamDef['group'], extra: Partial<ParamDef> = {}): ParamDef => ({ key, label, type, default: def, group, ...extra })
const size = P('size', 'Size', 'number', 3, 'Style', { min: 1, max: 9, step: 0.1, unit: 'vw', help: 'Text size, clamped for small and large screens.' })

const LIBRARY: EffectDef[] = [
  { id: 'text.typewriter', name: 'Typewriter', category: 'text', added: true, placeable: true,
    description: 'Types a line out letter by letter behind a blinking caret; can erase and retype in a loop.',
    params: [P('text', 'Text', 'text', 'Designing systems that learn.', 'Content'), P('cps', 'Letters per second', 'number', 18, 'Motion', { min: 2, max: 80, step: 1 }), P('loop', 'Erase and retype', 'boolean', false, 'Motion'), P('hold', 'Hold', 'number', 2.5, 'Motion', { min: 0.2, max: 12, step: 0.1, unit: 's' }), P('caret', 'Caret', 'select', 'bar', 'Style', { options: sel('bar', 'block', 'underscore') }), size],
    compatibility: 'Animation elements.', responsive: 'Wraps within its box; type is fluid.', reducedMotion: 'The whole line, with a still caret.', cost: 'low', costNote: 'One text node per frame while typing.' },
  { id: 'text.split-flap', name: 'Split-flap board', category: 'text', added: true, placeable: true,
    description: 'A departure board: each cell flips through the alphabet until it lands on its letter.',
    params: [P('text', 'Text (A–Z, 0–9, : . - /)', 'text', 'NEXT: LONDON 09:41', 'Content'), P('flipMs', 'Flip', 'number', 70, 'Motion', { min: 30, max: 400, step: 5, unit: 'ms' }), P('stagger', 'Stagger', 'number', 0.04, 'Motion', { min: 0, max: 0.3, step: 0.005, unit: 's' }), P('theme', 'Theme', 'select', 'dark', 'Style', { options: sel('dark', 'light') })],
    compatibility: 'Animation elements.', responsive: 'Cells scale with the box (container units) and wrap.', reducedMotion: 'The final text, no flipping.', cost: 'low', costNote: 'Up to 40 cells re-rendered per frame while flipping, then idle.' },
  { id: 'text.marquee', name: 'Marquee', category: 'text', added: true, placeable: true,
    description: 'An endless ticker of phrases; scrolling the page pushes it faster.',
    params: [P('items', 'Phrases (comma separated)', 'text', 'Machine learning, Product engineering, Computer vision, Retrieval, WebGL', 'Content'), P('pace', 'Base pace', 'number', 60, 'Motion', { min: 5, max: 400, step: 5, unit: 'px/s' }), P('direction', 'Direction', 'select', 'left', 'Motion', { options: sel('left', 'right') }), P('scrollBoost', 'Scroll boost', 'number', 1, 'Motion', { min: 0, max: 6, step: 0.1 }), P('separator', 'Separator', 'select', '✦', 'Style', { options: ['·', '—', '/', '✦'].map((v) => ({ value: v, label: v })) }), size],
    compatibility: 'Animation elements; best full width.', responsive: 'Any width; edges fade out.', reducedMotion: 'The phrases as a still, wrapped line.', cost: 'low', costNote: 'One transform per frame on the compositor.' },
  { id: 'text.highlight', name: 'Highlighter', category: 'text', added: true, placeable: true,
    description: 'A marker sweeps under chosen words — once when triggered, or following the scroll.',
    params: [P('text', 'Text', 'text', 'Ship the boring parts so the interesting ones get the time.', 'Content'), P('words', 'Words to mark (comma separated)', 'text', 'boring, interesting', 'Content'), P('mode', 'Mode', 'select', 'sweep', 'Motion', { options: sel('sweep', 'scroll') }), P('duration', 'Sweep', 'number', 0.8, 'Motion', { min: 0.1, max: 4, step: 0.05, unit: 's' }), P('marker', 'Marker', 'color', '', 'Style'), P('thickness', 'Thickness', 'number', 0.42, 'Style', { min: 0.1, max: 1.2, step: 0.02, unit: 'em' }), { ...size, default: 2.6 }],
    compatibility: 'Animation elements.', responsive: 'Text wraps; marks follow the words.', reducedMotion: 'Words shown already marked.', cost: 'low', costNote: 'CSS background transitions.' },
  { id: 'data.bars', name: 'Bar chart', category: 'data', added: true, placeable: true,
    description: 'A small bar chart from “Label: value” pairs, bars growing in one after another. Values stay readable as text.',
    params: [P('data', 'Data (Label: value; …)', 'text', 'Retrieval: 92; Vision: 81; Product: 88; Systems: 76', 'Content', { help: 'Only enter figures you can stand behind.' }), P('unit', 'Unit', 'text', '%', 'Content'), P('max', 'Scale maximum (0 = largest value)', 'number', 0, 'Content', { min: 0, max: 1e12, step: 1 }), P('showValues', 'Show values', 'boolean', true, 'Content'), P('orientation', 'Orientation', 'select', 'horizontal', 'Style', { options: sel('horizontal', 'vertical') }), P('duration', 'Grow', 'number', 1.1, 'Motion', { min: 0.1, max: 6, step: 0.1, unit: 's' }), P('stagger', 'Stagger', 'number', 0.08, 'Motion', { min: 0, max: 1, step: 0.01, unit: 's' })],
    compatibility: 'Animation elements.', responsive: 'Rows reflow; vertical bars fill the height.', reducedMotion: 'Bars at their values.', cost: 'low', costNote: 'CSS transforms.' },
  { id: 'data.gauge', name: 'Gauge', category: 'data', added: true, placeable: true,
    description: 'A ring that fills to a value while the number counts up with it.',
    params: [P('value', 'Value (0–100)', 'number', 72, 'Content', { min: 0, max: 100, step: 0.1 }), P('label', 'Label', 'text', 'Accuracy', 'Content'), P('suffix', 'Suffix', 'text', '%', 'Content'), P('duration', 'Duration', 'number', 1.6, 'Motion', { min: 0.1, max: 8, step: 0.1, unit: 's' }), P('thickness', 'Thickness', 'number', 10, 'Style', { min: 1, max: 30, step: 0.5 }), P('sweep', 'Sweep', 'number', 270, 'Style', { min: 90, max: 360, step: 5, unit: '°' })],
    compatibility: 'Animation elements.', responsive: 'Square, fits the box’s shorter side.', reducedMotion: 'The final value.', cost: 'low', costNote: 'One SVG attribute per frame while counting.' },
  { id: 'data.sparkline', name: 'Sparkline', category: 'data', added: true, placeable: true,
    description: 'A line chart that draws itself from a list of numbers and marks the latest value.',
    params: [P('values', 'Values (comma separated)', 'text', '3, 5, 4, 8, 6, 9, 12, 10, 14, 13, 17', 'Content'), P('label', 'Label', 'text', 'Weekly active learners', 'Content'), P('smooth', 'Smooth curve', 'boolean', true, 'Style'), P('area', 'Fill under the line', 'boolean', true, 'Style'), P('duration', 'Draw', 'number', 1.8, 'Motion', { min: 0.1, max: 10, step: 0.1, unit: 's' })],
    compatibility: 'Animation elements.', responsive: 'Stretches to the box.', reducedMotion: 'Drawn in full.', cost: 'low', costNote: 'One stroke transition.' },
  { id: 'shape.orbits', name: 'Orbits', category: 'shape', added: true, placeable: true,
    description: 'Bodies on tilted concentric orbits — inner ones faster, as Kepler’s third law has it — passing behind and in front of a centre.',
    params: [P('rings', 'Rings', 'number', 4, 'Content', { min: 1, max: 8, step: 1 }), P('bodies', 'Bodies per ring', 'number', 3, 'Content', { min: 1, max: 12, step: 1 }), P('orbitSpeed', 'Orbit speed', 'number', 1, 'Motion', { min: 0.05, max: 4, step: 0.05 }), P('tilt', 'Tilt', 'number', 62, 'Style', { min: 0, max: 85, step: 1, unit: '°' }), P('trails', 'Trails', 'boolean', true, 'Style')],
    compatibility: 'Animation elements.', responsive: 'Fits the box’s shorter side.', reducedMotion: 'One composed still frame.', cost: 'medium', costNote: 'Canvas 2D, paused off screen.' },
  { id: 'shape.blob', name: 'Living shape', category: 'shape', added: true, placeable: true,
    description: 'An organic shape that breathes on smooth noise and leans towards the pointer.',
    params: [P('points', 'Points', 'number', 8, 'Content', { min: 4, max: 18, step: 1 }), P('wobble', 'Wobble', 'number', 0.22, 'Motion', { min: 0, max: 0.6, step: 0.01 }), P('followPointer', 'Lean towards the pointer', 'boolean', true, 'Motion'), P('fill', 'Fill', 'select', 'accent', 'Style', { options: sel('accent', 'ink', 'outline') })],
    compatibility: 'Animation elements.', responsive: 'Scales with its box.', reducedMotion: 'A still shape.', cost: 'low', costNote: 'One SVG path per frame, paused off screen.' },
  { id: 'shape.line-draw', name: 'Line drawing', category: 'shape', added: true, placeable: true,
    description: 'One stroke drawing itself — a wave, spiral, signature, circuit or ridge — when triggered or with the scroll.',
    params: [P('shape', 'Shape', 'select', 'signature', 'Content', { options: sel('wave', 'spiral', 'signature', 'circuit', 'ridge') }), P('seed', 'Variation', 'number', 3, 'Content', { min: 1, max: 9999, step: 1 }), P('mode', 'Mode', 'select', 'trigger', 'Motion', { options: sel('trigger', 'scroll') }), P('duration', 'Draw', 'number', 2.4, 'Motion', { min: 0.2, max: 12, step: 0.1, unit: 's' }), P('loop', 'Loop', 'boolean', false, 'Motion'), P('strokeWidth', 'Stroke', 'number', 2, 'Style', { min: 0.3, max: 8, step: 0.1 })],
    compatibility: 'Animation elements.', responsive: 'Keeps its proportions inside the box.', reducedMotion: 'Fully drawn.', cost: 'low', costNote: 'One stroke transition.' },
  { id: 'particles.flow-field', name: 'Flow field', category: 'particles', added: true, placeable: true,
    description: 'Particles drifting along a slowly changing noise field, leaving fading trails.',
    params: [P('count', 'Particles', 'number', 900, 'Content', { min: 50, max: 4000, step: 50 }), P('seed', 'Variation', 'number', 11, 'Content', { min: 1, max: 9999, step: 1 }), P('flowSpeed', 'Flow', 'number', 1, 'Motion', { min: 0.1, max: 4, step: 0.05 }), P('scale', 'Field scale', 'number', 2, 'Motion', { min: 0.3, max: 8, step: 0.1 }), P('fade', 'Trail fade', 'number', 0.06, 'Style', { min: 0.005, max: 0.4, step: 0.005 }), P('colorMode', 'Colour', 'select', 'mixed', 'Style', { options: sel('accent', 'ink', 'mixed') })],
    compatibility: 'Animation elements; good as a section background (send it behind with Layer).', responsive: 'Any size; particle count is fixed, so keep it modest on large boxes.', reducedMotion: 'Static streamlines.', cost: 'medium', costNote: 'Canvas 2D; cost grows with the particle count. Paused off screen.' },
  { id: 'particles.constellation', name: 'Constellation', category: 'particles', added: true, placeable: true,
    description: 'Drifting points joined by lines when close; the pointer pulls them in or pushes them away.',
    params: [P('density', 'Density', 'number', 1, 'Content', { min: 0.1, max: 4, step: 0.1 }), P('link', 'Link distance', 'number', 120, 'Style', { min: 30, max: 260, step: 5, unit: 'px' }), P('drift', 'Drift', 'number', 1, 'Motion', { min: 0, max: 4, step: 0.05 }), P('pointer', 'Pointer', 'select', 'attract', 'Motion', { options: sel('attract', 'repel', 'none') })],
    compatibility: 'Animation elements.', responsive: 'Point count follows the box’s area (capped at 420).', reducedMotion: 'A still constellation.', cost: 'medium', costNote: 'Canvas 2D with a spatial grid for neighbours; paused off screen.' },
  { id: 'background.gradient-mesh', name: 'Gradient mesh', category: 'background', added: true, placeable: true,
    description: 'Soft colour fields drifting past one another under a film grain.',
    params: [P('c1', 'Colour 1', 'color', '', 'Style', { help: 'Empty uses the accent.' }), P('c2', 'Colour 2', 'color', '#2f6f5e', 'Style'), P('c3', 'Colour 3', 'color', '#e9c46a', 'Style'), P('blur', 'Softness', 'number', 60, 'Style', { min: 10, max: 160, step: 1, unit: 'px' }), P('grain', 'Grain', 'number', 0.12, 'Style', { min: 0, max: 0.5, step: 0.01 })],
    compatibility: 'Animation elements; behind content as a backdrop.', responsive: 'Drawn at an eighth of the size and scaled up: the same cost at any size.', reducedMotion: 'A still gradient.', cost: 'low', costNote: 'A tiny canvas scaled up with blur.' },
  { id: 'background.dot-ripple', name: 'Dot ripple', category: 'background', added: true, placeable: true,
    description: 'A field of dots that rings like water where the pointer touches it, and now and then on its own.',
    params: [P('spacing', 'Spacing', 'number', 18, 'Style', { min: 6, max: 60, step: 1, unit: 'px' }), P('dotSize', 'Dot size', 'number', 1.4, 'Style', { min: 0.4, max: 5, step: 0.1, unit: 'px' }), P('waveSpeed', 'Wave speed', 'number', 420, 'Motion', { min: 50, max: 1500, step: 10, unit: 'px/s' }), P('decay', 'Decay', 'number', 1.6, 'Motion', { min: 0.3, max: 6, step: 0.1, unit: 's' }), P('auto', 'Automatic ripple every', 'number', 2.5, 'Motion', { min: 0, max: 20, step: 0.5, unit: 's', help: '0 turns it off.' })],
    compatibility: 'Animation elements.', responsive: 'Dot count follows the box’s area.', reducedMotion: 'A still grid.', cost: 'medium', costNote: 'Canvas 2D; one circle per dot per frame, paused off screen.' },
  { id: 'interaction.tilt-card', name: 'Tilt card', category: 'interaction', added: true, placeable: true,
    description: 'A card that tilts towards the pointer with a moving sheen; its title, label and text sit at different depths.',
    params: [P('eyebrow', 'Label', 'text', 'Case study', 'Content'), P('title', 'Title', 'text', 'Retrieval at scale', 'Content'), P('body', 'Text', 'text', 'Hybrid search over half a million documents, answered in under a second.', 'Content'), P('maxTilt', 'Tilt', 'number', 12, 'Motion', { min: 0, max: 30, step: 0.5, unit: '°' }), P('depth', 'Depth', 'number', 24, 'Style', { min: 0, max: 80, step: 1, unit: 'px' }), P('glare', 'Sheen', 'number', 0.35, 'Style', { min: 0, max: 1, step: 0.05 })],
    compatibility: 'Animation elements.', responsive: 'Up to 26rem wide; tilts only with a pointer, lifts on keyboard focus.', reducedMotion: 'A flat card.', cost: 'low', costNote: 'CSS 3D transforms.' },
  { id: 'scroll.parallax-layers', name: 'Parallax ridges', category: 'scroll', added: true, placeable: true,
    description: 'Paper-cut ridgelines that slide past each other at different rates as the page scrolls.',
    params: [P('layers', 'Layers', 'number', 5, 'Content', { min: 2, max: 8, step: 1 }), P('seed', 'Variation', 'number', 9, 'Content', { min: 1, max: 9999, step: 1 }), P('depth', 'Depth', 'number', 0.8, 'Motion', { min: 0, max: 2, step: 0.05 }), P('horizon', 'Horizon', 'number', 0.45, 'Style', { min: 0.2, max: 0.8, step: 0.01 }), P('palette', 'Palette', 'select', 'accent', 'Style', { options: sel('accent', 'ink', 'dusk') })],
    compatibility: 'Animation elements; wide boxes.', responsive: 'Crops to the box from the bottom.', reducedMotion: 'Still layers.', cost: 'low', costNote: 'A few SVG transforms while scrolling.' },
  { id: 'transition.wipe', name: 'Wipe reveal', category: 'transition', added: true, placeable: true,
    description: 'A block of colour sweeps across and away, leaving the words behind — every time it is triggered.',
    params: [P('text', 'Text', 'text', 'Selected work', 'Content'), P('direction', 'Direction', 'select', 'right', 'Motion', { options: sel('right', 'left', 'up', 'down') }), P('duration', 'Duration', 'number', 0.9, 'Motion', { min: 0.2, max: 4, step: 0.05, unit: 's' }), P('wipeColor', 'Wipe colour', 'color', '', 'Style'), { ...size, default: 4, max: 10 }],
    compatibility: 'Animation elements.', responsive: 'Type is fluid.', reducedMotion: 'The words, no wipe.', cost: 'low', costNote: 'Two CSS animations.' },
]

/* ---- built into the site: documented, previewable, configured where they live ---- */
const B = (e: Omit<EffectDef, 'placeable' | 'params'> & { params?: ParamDef[] }): EffectDef => ({ placeable: false, params: [], ...e })
const INVENTORY: EffectDef[] = [
  B({ id: 'transition.leaves', name: 'Leaf cover', category: 'transition', description: 'At the foot of the homepage the room’s ivy grows over the page in five depth layers; when it fully and verifiably covers the screen the world loads underneath, then the leaves part.', source: 'src/components/home/room/canopy/ · src/components/home/botanical/garden.ts', configuredIn: 'Settings → Leaf growth and Leaf parting (and here)', inputs: ['Growth: Settings → Leaf growth (gentle · standard · brisk) scales the push a full charge takes', 'Parting: Settings → Leaf parting (slow · standard · quick) sets how long the leaves take to open', '5 layers (34/30/28/20/12 stems) across charge .02–.99; takes the clicks from .35', 'Coverage is verified on two presented frames before anything of the world loads — no setting can skip it'], compatibility: 'The homepage → /world transition only.', responsive: 'Full screen at every aspect ratio; budget 0.6 on the low tier (1 MP).', reducedMotion: 'No leaves: a dark fade in and out.', cost: 'high', costNote: 'WebGL2 while growing, then six 2D canvases while parting.', preview: { path: '/', note: 'Run it from the Page editor → Test transition.' } }),
  B({ id: 'transition.portal', name: 'Portal charge', category: 'transition', description: 'Once the page rests at its foot, wheel and touch input charge the leaves against growing resistance; the page is held back, a hairline fills, and haptics mark milestones.', source: 'src/components/journey/WorldPortal.tsx', configuredIn: 'Settings → World entrance, Leaf growth', inputs: ['CHARGE_PX 1250 × leaf growth (1.35 / 1 / .72)', 'REST_MS 180 before input counts; DECAY_S .9; RELEASE_S .35', 'Resistance 1 − .68·charge²; momentum filter for trackpad flings'], compatibility: 'The foot of the homepage.', responsive: 'Touch input counts 1.6× a wheel pixel.', reducedMotion: 'Disabled: a plain “Enter my world” link instead.', cost: 'low', costNote: 'A few numbers per frame on the shared ticker.', preview: { path: '/', chapter: 'contact' } }),
  B({ id: 'transition.world', name: 'World entry sequence', category: 'transition', description: 'The state machine every way into /world goes through: cover, verify, navigate under the cover, load, wait for the world’s ready signal, part.', source: 'src/components/world/transition.ts', configuredIn: 'Code', inputs: ['HOME → COVERING → COVERED → LOADING_WORLD → WORLD_READY → REVEALING → IN_WORLD (+ ERROR)', 'Links grow the cover over 1.1 s'], compatibility: 'Every link to /world.', responsive: 'Full screen.', reducedMotion: 'A plain dark fade.', cost: 'low', costNote: 'Logic only.' }),
  B({ id: 'transition.world-loader', name: 'World loading screen', category: 'transition', description: 'For direct arrivals at /world: a progress bar that follows the runtime’s real stages, with a quiet note after 25 s and an error panel with retry.', source: 'src/components/world/WorldRoute.tsx', configuredIn: 'Code', compatibility: '/world only.', responsive: 'Full screen.', reducedMotion: 'No transitions.', cost: 'low', costNote: 'CSS.', preview: { path: '/world' } }),
  B({ id: 'transition.sheet.project', name: 'Case-study overlay', category: 'transition', description: 'The project overlay: a blurred scrim fades in under the case study; deep-linkable as #project/<slug>.', source: 'src/components/ui/ProjectOverlay.tsx', configuredIn: 'Code', compatibility: 'Project cards everywhere.', responsive: 'Full screen sheet.', reducedMotion: 'No fade.', cost: 'medium', costNote: 'backdrop-filter while open.' }),
  B({ id: 'scene.prelude', name: 'Prelude', category: 'scene', description: 'The name rises, tightens and fades as the first chapter scrolls; roles rotate every 1.5 s; the thesis passes through.', source: 'src/components/journey/chapters/Prelude.tsx', configuredIn: 'Page editor (text, style, position); code (timing)', compatibility: 'Home · Intro chapter.', responsive: 'Fluid type.', reducedMotion: 'Static layout; all roles listed.', cost: 'low', costNote: 'DOM transforms per frame.', preview: { path: '/', chapter: 'prelude' } }),
  B({ id: 'scene.about', name: 'About', category: 'scene', description: 'The introduction fades through, then four “from → to” markers draw in with growing bars.', source: 'src/components/journey/chapters/About.tsx', configuredIn: 'Page editor; code (timing)', compatibility: 'Home · About.', responsive: 'Reflows to one column.', reducedMotion: 'A ruled table.', cost: 'low', costNote: 'DOM.', preview: { path: '/', chapter: 'about' } }),
  B({ id: 'scene.universe', name: 'Project universe', category: 'scene', description: 'One node per project on a sphere (hero, featured and archive shells), joined by category, spinning with the pointer; hover and click open projects.', source: 'src/experience/scenes/UniverseScene.tsx', configuredIn: 'Projects (which nodes exist); code', compatibility: 'Home · Universe.', responsive: 'Camera adapts to aspect.', reducedMotion: 'Rendered on demand only: effectively still.', cost: 'medium', costNote: 'One instanced mesh, r3f.', preview: { path: '/', chapter: 'universe' } }),
  B({ id: 'scene.toolbox.lattice', name: 'Toolbox lattice', category: 'scene', description: 'Technologies on an inner ring, projects on an outer one, an edge for every piece of evidence; hovering a technology lights its evidence.', source: 'src/experience/scenes/ToolboxScene.tsx', configuredIn: 'Projects → Stack (evidence)', compatibility: 'Home · Toolbox.', responsive: 'Watermark scale.', reducedMotion: 'Effectively still.', cost: 'low', costNote: 'r3f, a few hundred primitives.', preview: { path: '/', chapter: 'toolbox' } }),
  B({ id: 'scene.education', name: 'Education', category: 'scene', description: 'Cards and module rows stagger in; each module’s glyph turns green as it lands.', source: 'src/components/journey/chapters/Education.tsx', configuredIn: 'Page editor; code', compatibility: 'Home · Education.', responsive: 'Reflows.', reducedMotion: 'Static.', cost: 'low', costNote: 'DOM.', preview: { path: '/', chapter: 'education' } }),
  B({ id: 'scene.contact', name: 'Contact', category: 'scene', description: 'The closing question and answer, then the links; the portal’s charge dims and lifts the whole stage.', source: 'src/components/journey/chapters/Contact.tsx', configuredIn: 'Page editor; code', compatibility: 'Home · Contact.', responsive: 'Reflows.', reducedMotion: 'Static.', cost: 'low', costNote: 'DOM.', preview: { path: '/', chapter: 'contact' } }),
  B({ id: 'scene.contact.finale', name: 'Finale field', category: 'scene', description: 'Every entity of the portfolio and a few hundred motes spring onto shells; the pointer is a gravity well; near the end some drift towards the island’s colours.', source: 'src/experience/scenes/ContactScene.tsx', configuredIn: 'Code', compatibility: 'Home · Contact.', responsive: 'Density by performance tier.', reducedMotion: 'Effectively still.', cost: 'medium', costNote: 'CPU springs per body.', preview: { path: '/', chapter: 'contact' } }),
  B({ id: 'scene.pansofia', name: 'Client-work fan', category: 'scene', description: 'A fan of browser panes, one per client site, collapses into a stack and a count, then a horizontal gallery scrubs past.', source: 'src/components/journey/chapters/Pansofia.tsx', configuredIn: 'Projects (client work); code', compatibility: 'Projects · Pansofia.', responsive: 'Rail goes into flow on small screens.', reducedMotion: 'The gallery in flow, no fan.', cost: 'low', costNote: 'DOM transforms.', preview: { path: '/projects', chapter: 'pansofia' } }),
  B({ id: 'scene.teaching', name: 'Teaching', category: 'scene', description: 'A test suite turns from failing to passing as the code is fixed, with three named cursors orbiting it.', source: 'src/components/journey/chapters/Teaching.tsx', configuredIn: 'Code', compatibility: 'Projects · Teaching.', responsive: 'Reflows.', reducedMotion: 'Advances with scroll; cursors hidden.', cost: 'low', costNote: 'DOM.', preview: { path: '/projects', chapter: 'teaching' } }),
  B({ id: 'scene.focus', name: 'Focus layers', category: 'scene', description: 'Ten production layers of a generated learning video stagger in beside the scroll-linked Focus visual.', source: 'src/components/journey/chapters/Focus.tsx', configuredIn: 'Code', compatibility: 'Projects · Focus.', responsive: 'Reflows.', reducedMotion: 'Static.', cost: 'medium', costNote: 'Canvas visual + DOM.', preview: { path: '/projects', chapter: 'focus' } }),
  B({ id: 'scene.gym', name: 'Gym rig', category: 'scene', description: 'Pipeline stages light up while the 19-joint rig solves poses with the scroll.', source: 'src/components/journey/chapters/Gym.tsx', configuredIn: 'Code', compatibility: 'Projects · Gym.', responsive: 'Reflows.', reducedMotion: 'Static.', cost: 'medium', costNote: 'Canvas visual + DOM.', preview: { path: '/projects', chapter: 'gym' } }),
  B({ id: 'scene.metaview.embedding', name: 'Embedding galaxy', category: 'scene', description: 'Tens of thousands of points fold from a sheet into nine clusters; a query travels through and lights its neighbours.', source: 'src/experience/scenes/MetaviewScene.tsx', configuredIn: 'Code', compatibility: 'Projects · Metaview.', responsive: 'Density by tier.', reducedMotion: 'Effectively still.', cost: 'high', costNote: 'Custom GLSL points.', preview: { path: '/projects', chapter: 'metaview' } }),
  B({ id: 'scene.chess.board', name: 'Chess board', category: 'scene', description: 'Squares fly in, pieces rise and the suggested move arcs from e2 to e4.', source: 'src/experience/scenes/ChessScene.tsx', configuredIn: 'Code', compatibility: 'Projects · Chess.', responsive: 'Camera rail.', reducedMotion: 'Effectively still.', cost: 'low', costNote: 'Lit meshes.', preview: { path: '/projects', chapter: 'chess' } }),
  B({ id: 'scene.stock.lanes', name: 'Order lanes', category: 'scene', description: 'Orders travel four lanes into a matching line; scrolling faster speeds the market up.', source: 'src/experience/scenes/StockScene.tsx', configuredIn: 'Code', compatibility: 'Projects · Stock.', responsive: 'Density by tier.', reducedMotion: 'Effectively still.', cost: 'low', costNote: 'Instanced points.', preview: { path: '/projects', chapter: 'stock' } }),
  B({ id: 'bg.room', name: 'Ivy room', category: 'background', description: 'The homepage’s classical hall: ivy, moss, cracks and fallen leaves grow as a function of scroll, kept clear of the text they would cover.', source: 'src/components/home/room/', configuredIn: 'Code (ROOM_CONFIG)', inputs: ['Seed 23118; leaf density 1; growth floor .06', 'Quality tiers: DPR 1.75/1.5/1, MSAA 4/4/0, shadows 2048/1536/1024'], compatibility: 'Homepage background.', responsive: 'Reading field measured from the live layout.', reducedMotion: 'Held at one growth state, no sway.', cost: 'high', costNote: 'WebGL2 with a lighting cache; near zero when idle.', preview: { path: '/', chapter: 'prelude' } }),
  B({ id: 'bg.sprigs', name: 'Margin sprigs', category: 'background', description: 'Line-art ferns, fronds and tendrils draw themselves on in the margins as the projects page scrolls.', source: 'src/components/vegetation/Vegetation.tsx', configuredIn: 'Code', compatibility: '/projects background.', responsive: 'Fewer on narrow screens.', reducedMotion: 'A smaller, fully grown still arrangement.', cost: 'medium', costNote: 'SVG with DOM writes.', preview: { path: '/projects', chapter: 'pansofia' } }),
  B({ id: 'bg.field', name: 'Ground field', category: 'background', description: 'A shader grid with ripples that answer scroll speed, a progress spine and dust motes, behind the first projects chapters.', source: 'src/experience/scenes/FieldScene.tsx', configuredIn: 'Code', compatibility: '/projects.', responsive: 'Density by tier.', reducedMotion: 'Effectively still.', cost: 'medium', costNote: 'Fragment shader.', preview: { path: '/projects', chapter: 'teaching' } }),
  B({ id: 'cursor.magnetic', name: 'Magnetic cursor', category: 'interaction', description: 'A dot and ring that snap towards links and carry short labels.', source: 'src/components/ui/Cursor.tsx', configuredIn: 'data-cursor attributes in code', compatibility: 'Journeys, fine pointers only.', responsive: 'Off on touch screens.', reducedMotion: 'Not rendered.', cost: 'low', costNote: 'Shared ticker.', preview: { path: '/' } }),
  B({ id: 'interaction.site-preview', name: 'Site preview on hover', category: 'interaction', description: 'A client site’s full-page screenshot scrolls to its foot on hover while the phone version peeks up.', source: 'src/components/journey/chapters/Pansofia.tsx', configuredIn: 'Projects (client work screenshots)', compatibility: 'Projects · Pansofia gallery.', responsive: 'Touch: no hover.', reducedMotion: 'No scroll.', cost: 'low', costNote: 'CSS.', preview: { path: '/projects', chapter: 'pansofia' } }),
  B({ id: 'interaction.tech-tile', name: 'Evidence tiles', category: 'interaction', description: 'Hover previews and click pins a technology; the others dim and its evidence appears.', source: 'src/components/tech/TechTile.tsx', configuredIn: 'Projects → Stack', compatibility: 'Home · Toolbox.', responsive: 'Grid reflows.', reducedMotion: 'No lift.', cost: 'low', costNote: 'CSS.', preview: { path: '/', chapter: 'toolbox' } }),
  B({ id: 'scroll.smooth', name: 'Smooth scrolling', category: 'scroll', description: 'Lenis smooths native scrolling and feeds every scroll-driven effect one progress value per frame.', source: 'src/hooks/useLenisScroll.ts', configuredIn: 'Code', inputs: ['duration 1.05, lerp .085, touch ×1.6'], compatibility: 'Journeys.', responsive: 'Touch uses native scrolling.', reducedMotion: 'Native, unsmoothed scrolling.', cost: 'low', costNote: 'One rAF loop.' }),
  B({ id: 'scroll.pin', name: 'Pinned chapters', category: 'scroll', description: 'Each chapter is several screens tall with a sticky stage inside; its length is the section’s “Length (screens)”.', source: 'src/components/journey/Chapter.tsx', configuredIn: 'Page editor → Sections (length, Quick View length)', compatibility: 'Journeys.', responsive: 'svh units.', reducedMotion: 'Unchanged (native scroll).', cost: 'low', costNote: 'CSS sticky.' }),
  B({ id: 'ambient.scroll-hint', name: 'Scroll hint', category: 'background', description: 'A short line sliding and pulsing beside “Scroll to begin”.', source: 'src/components/journey/parts.tsx', configuredIn: 'Code', compatibility: 'Intro chapters.', responsive: '—', reducedMotion: 'Still.', cost: 'low', costNote: 'CSS.', preview: { path: '/', chapter: 'prelude' } }),
  B({ id: 'nav.hud', name: 'HUD progress', category: 'navigation', description: 'The journey’s progress bar and percentage, the sound bars and a scrubber you can drag or step with the arrow keys.', source: 'src/components/navigation/Hud.tsx', configuredIn: 'Code', compatibility: 'Journeys.', responsive: 'Condensed on phones.', reducedMotion: 'No transitions.', cost: 'low', costNote: 'Transforms per frame.', preview: { path: '/' } }),
  B({ id: 'nav.index-sheet', name: 'Index sheet', category: 'navigation', description: 'The chapter index drops in over a blurred scrim; choosing a chapter glides there.', source: 'src/components/navigation/IndexOverlay.tsx', configuredIn: 'Sections (titles, groups, order); Settings → Navigation', compatibility: 'Journeys.', responsive: 'Full screen on phones.', reducedMotion: 'No fade.', cost: 'medium', costNote: 'backdrop-filter while open.', preview: { path: '/' } }),
]

export const CATALOGUE: EffectDef[] = [...EFFECTS, ...LIBRARY, ...INVENTORY]

export const EFFECT_BY_ID: Record<string, EffectDef> = Object.fromEntries(CATALOGUE.map((e) => [e.id, e]))

/* An effect's own parameter must never reuse a shared one's key (it would shadow the frame's control). */
if (process.env.NODE_ENV !== 'production') {
  const shared = new Set(SHARED_PARAMS.map((p) => p.key))
  for (const e of CATALOGUE) for (const p of e.params) if (shared.has(p.key)) console.error(`[library] ${e.id} reuses the shared parameter “${p.key}”`)
}

/** Every parameter an effect accepts, its own first. */
export const paramsOf = (id: string): ParamDef[] => [...(EFFECT_BY_ID[id]?.params ?? []), ...SHARED_PARAMS]

export function defaultParams(id: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const p of EFFECT_BY_ID[id]?.params ?? []) out[p.key] = p.default
  return out
}
