import * as THREE from 'three';

/* The world's static nodes stop being recomposed, multiplied and even visited every frame.
 *
 * three's updateMatrixWorld recomposes `matrix` from position / quaternion / scale on every node with matrixAutoUpdate, and a node that did so (or whose parent
 * did) multiplies its whole subtree again: about 15,000 nodes (13,000 of them the editor's world, much of it hidden previews and batched originals) cost 1.6-1.8 ms of
 * every frame on a desktop, several times that on a phone. Two steps take that away:
 *
 *   freeze  matrixAutoUpdate off on every node nothing moves (nor on any ancestor of one that is moved: a live parent would force its whole subtree). 1.5 -> 0.45 ms.
 *   cut     what is left is the walk itself: three recurses into every child of every node even when nothing under it can change (30 ns a node, 13,000 nodes). A frozen
 *           node with something live below it (a "needy" node: the scene, the editor's root, the groups on the way to a car or a crate) gets its own updateMatrixWorld that
 *           visits only the children that lead to something live; a frozen node with nothing live below it is not visited at all. A frame touches what moves. 0.45 -> 0.1 ms.
 *
 * Frozen: the scene, the editor world (`root`) and everything under it, except the nodes code moves (`keep`: physics bodies' nodes, what the animation mixer drives, whatever is
 * flagged animated) with their subtrees; plus the batches drawn instead of the originals. The World2 instances' own groups live under the scene and stay live: their controllers move
 * things by name.
 *
 * Nothing may be left standing still or at the origin because of it:
 *   - a child added to a frozen node (an event on every frozen node) makes the node and its ancestors needy at once, so the child is visited on the very next update;
 *   - audit() compares a slice of the frozen nodes' position / quaternion / scale with their matrix and their number of children with the count taken, every frame (the whole world every
 *     ~1.5 s), and sets a node free the moment it differs (live again, and reachable: its ancestors become needy);
 *   - an update forced on a subtree (`updateMatrixWorld(true)`, the map's photograph, a physics rebuild) or asked for on a frozen node (`matrixWorldNeedsUpdate`) is three's own,
 *     whole, recursion. release() puts everything back. */
const m = new THREE.Matrix4();

/** The updateMatrixWorld of a needy node: the node itself is not recomposed (frozen), only the children that lead to something live are visited. */
function updateNeedy(force) {
  const freezer = this.__freezer, own = Object.getPrototypeOf(this).updateMatrixWorld;
  if (force === true || this.matrixWorldNeedsUpdate || !freezer) return own.call(this, force);
  const stub = freezer.stubs.get(this);
  if (!stub) return own.call(this, force);
  let kids = stub.kids;
  if (kids === null || this.children.length !== stub.count) kids = freezer.kidsOf(this, stub);
  for (let i = 0; i < kids.length; i++) kids[i].updateMatrixWorld(false);
}

export class StaticFreeze {
  constructor() {
    this.nodes = []; this.counts = new Uint16Array(0); this.cursor = 0; this.freed = []; this.active = false;
    this.frozen = new Set(); this.stubs = new Map(); this.cut = true; this.promoted = 0;
    this.onAdd = e => this.promote(e.target);
    this.onRemove = e => { const s = this.stubs.get(e.target); if (s) s.kids = null; };
  }
  /** `keep`: the nodes (any iterable) code moves; each stays live with all its descendants. `extra`: more nodes that never move (the batches). `cut`: false keeps three's walk. */
  freeze(scene, root, keep, extra = [], { cut = true } = {}) {
    const live = new Set(); for (const node of keep) node?.traverse(n => live.add(n));
    scene.updateMatrixWorld(true);
    const set = n => { if (n.matrixAutoUpdate) { n.matrixAutoUpdate = false; this.nodes.push(n); } };
    root.traverse(n => { if (!live.has(n)) set(n); });
    for (const n of extra) set(n);
    // Every ancestor of a frozen node that is not itself moved: a live one would force its whole subtree every frame.
    for (let p = root.parent; p; p = p.parent) if (!live.has(p)) set(p);
    this.frozen = new Set(this.nodes);
    this.counts = Uint16Array.from(this.nodes, n => Math.min(65535, n.children.length));
    this.active = true; this.cut = cut;
    if (cut) this.cutWalk(scene);
    return this.nodes.length;
  }
  /** Installs the walk of a needy node on every frozen node that has a node that is not frozen below it, and a listener for new children on every frozen node. */
  cutWalk(scene) {
    const needy = n => {
      if (!this.frozen.has(n)) return true;
      let any = false;
      for (let i = 0, c = n.children; i < c.length; i++) if (needy(c[i])) any = true;
      if (any) this.install(n);
      return any;
    };
    for (const n of this.nodes) n.addEventListener('childadded', this.onAdd);
    needy(scene);
  }
  install(n) {
    if (this.stubs.has(n)) return;
    this.stubs.set(n, { kids: null, count: -1 });
    n.__freezer = this; n.updateMatrixWorld = updateNeedy; n.addEventListener('childremoved', this.onRemove);
  }
  /** The children of a needy node that lead to something live: those not frozen, and those that are needy themselves. */
  kidsOf(n, stub) {
    const frozen = this.frozen, stubs = this.stubs, kids = [];
    for (let i = 0, c = n.children; i < c.length; i++) if (!frozen.has(c[i]) || stubs.has(c[i])) kids.push(c[i]);
    stub.kids = kids; stub.count = n.children.length;
    return kids;
  }
  /** `node` (frozen) has, or may have, something live below it: it and every frozen ancestor become needy, or have their list of kids rebuilt. */
  promote(node) {
    if (!this.cut || !this.active) return;
    for (let p = node; p && this.frozen.has(p); p = p.parent) {
      const stub = this.stubs.get(p);
      if (stub) { stub.kids = null; break; }
      this.install(p); this.promoted++;
    }
  }
  /** Sets a frozen node free: live again, and reachable. */
  free(n) {
    n.matrixAutoUpdate = true; this.frozen.delete(n); this.freed.push(n.name || n.type);
    n.removeEventListener('childadded', this.onAdd);
    if (this.stubs.delete(n)) { delete n.updateMatrixWorld; n.removeEventListener('childremoved', this.onRemove); }
    if (n.parent) this.promote(n.parent);
  }
  /** Frees every frozen node that was moved or that has gained or lost children. `budget` nodes per call. */
  audit(budget = 150) {
    const list = this.nodes;
    if (!list.length) return;
    for (let k = 0; k < budget; k++) {
      const i = this.cursor = (this.cursor + 1) % list.length, n = list[i];
      if (n.matrixAutoUpdate || !this.frozen.has(n) || (!n.parent && n.isMesh)) continue;
      m.compose(n.position, n.quaternion, n.scale); const a = m.elements, b = n.matrix.elements;
      let moved = false;
      for (let j = 0; j < 16; j++) if (Math.abs(a[j] - b[j]) > 1e-7) { moved = true; break; }
      if (moved) { this.free(n); continue; }
      // A child that came by a road the event did not see.
      if (n.children.length !== this.counts[i]) { this.counts[i] = Math.min(65535, n.children.length); this.promote(n); }
    }
  }
  /** For QA: how much of the graph a frame's update walks. */
  stats() { return { frozen: this.frozen.size, stubs: this.stubs.size, freed: this.freed.length, promoted: this.promoted, cut: this.cut }; }
  release() {
    for (const n of this.nodes) { n.matrixAutoUpdate = true; n.removeEventListener('childadded', this.onAdd); }
    for (const n of this.stubs.keys()) { delete n.updateMatrixWorld; delete n.__freezer; n.removeEventListener('childremoved', this.onRemove); }
    this.stubs.clear(); this.frozen.clear(); this.nodes.length = 0; this.cursor = 0; this.active = false;
  }
}
