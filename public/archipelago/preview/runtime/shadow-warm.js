import * as THREE from 'three';

/* The sun's shadow pass: one depth program per kind of caster, built once.
 *
 * three draws every shadow caster with ONE shared MeshDepthMaterial and only re-selects that material's program when something it checks changes between two draws
 * (instanced or not, skinned, vertex alphas, ...): not when the caster's side or map changes, and not with the lights (it keys the program by the lights of
 * the frame all the same). Which program a draw gets is therefore a function of the ORDER of draws and of the lights at the moment of the last switch: the first
 * explosion (a visible point light, instanced debris drawn among the plain casters) linked four new depth shaders on that frame, 100-230 ms measured, and so would
 * the first crate or the first place the car had not been to, with the lights lit.
 *
 * Here every caster gets the depth material of its KIND (kinds: what makes two casters differ for a depth shader: instanced, side, map, the geometry's
 * attributes). Each of those materials is switched to its program the first time it draws and never again, whatever the lights, whatever is drawn between;
 * identical to three's own (the same material, the same side and map, copied on every draw); warmShadowPrograms() draws each kind once under the cover so even that
 * first switch is not on a frame. Casters that need a depth material of their own (alpha test, displacement, clipping) and skinned or morphed ones keep three's. */
const SHADOW_SIDE = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
const ATTRIBUTES = ['position', 'normal', 'color', 'uv', 'uv1', 'uv2', 'uv3', 'tangent'];

const materialInfo = new WeakMap(), geometryInfo = new WeakMap();
/** What of a material a depth shader sees, and whether a plain depth material serves it (no alpha test or alpha map, no displacement, no clipping). */
function materialOf(m) {
  let t = materialInfo.get(m);
  if (t === undefined) {
    const plain = !(m.alphaMap || m.alphaTest > 0 || m.alphaToCoverage || (m.displacementMap && m.displacementScale !== 0) || (m.clipShadows && m.clippingPlanes?.length) || m.visible === false);
    t = { plain, token: (m.shadowSide ?? SHADOW_SIDE[m.side]) + (m.map ? ',map' + m.map.channel : '') };
    materialInfo.set(m, t);
  }
  return t;
}
function geometryOf(g) {
  let t = geometryInfo.get(g);
  if (t === undefined) {
    const a = g.attributes ?? {}, morph = Object.keys(g.morphAttributes ?? {}).length > 0;
    t = { plain: !morph, token: ATTRIBUTES.filter(k => a[k]).join(',') };
    geometryInfo.set(g, t);
  }
  return t;
}
// Memoised per material and geometry as of the first call: a material that gains a map later changes nothing for a plain depth shader (the map only matters with an alpha test), one that
// gains an alpha test later is the caller's business.

/** Everything about a caster that makes its depth program (and its draw) differ from another's, and whether a plain depth material serves it. */
export function casterKind(o) {
  const kind = o.isSkinnedMesh ? 'S' : o.isInstancedMesh ? 'I' + (o.instanceColor ? 'c' : '') : 'M';
  const g = geometryOf(o.geometry), ms = Array.isArray(o.material) ? o.material.map(materialOf) : [materialOf(o.material)];
  return { key: kind + '|' + ms.map(m => m.token).join(';') + '|' + g.token, plain: !o.isSkinnedMesh && g.plain && ms.every(m => m.plain) };
}

const depthMaterials = new Map();
/** The depth material of a kind (created on first use), made the way three makes its own (a default MeshDepthMaterial: the shadow maps are depth textures). */
export function depthMaterialFor(key) {
  let m = depthMaterials.get(key);
  if (!m) {
    m = new THREE.MeshDepthMaterial();
    m.name = 'depth ' + key;
    depthMaterials.set(key, m);
  }
  return m;
}

/** Gives every shadow caster of `scene` the depth material of its kind (a caster that has one is left alone) and returns what it found: `assigned` casters and, per kind, a
 * representative whose ancestors are all visible (a hidden caster itself counts: the explosion's debris; a hidden template above it does not). */
export function assignDepthMaterials(scene) {
  const reps = new Map();
  let assigned = 0;
  const walk = (o, shown) => {
    for (let i = 0, c = o.children; i < c.length; i++) {
      const n = c[i];
      if (n.isMesh && n.castShadow && n.geometry && n.material) {
        const { key, plain } = casterKind(n);
        if (plain) {
          if (n.customDepthMaterial === undefined) { n.customDepthMaterial = depthMaterialFor(key); assigned++; }
          if (shown && !reps.has(key)) reps.set(key, n);
        }
      }
      if (n.children.length) walk(n, shown && n.visible);
    }
  };
  walk(scene, true);
  return { assigned, reps };
}

function proxyOf(kind) {
  const p = kind.isInstancedMesh ? new THREE.InstancedMesh(kind.geometry, kind.material, 1) : new THREE.Mesh(kind.geometry, kind.material);
  if (kind.isInstancedMesh && kind.instanceColor) p.setColorAt(0, new THREE.Color(1, 1, 1));
  p.customDepthMaterial = kind.customDepthMaterial;
  p.castShadow = true;
  p.frustumCulled = false;
  // A long way under the ground, a hundred microns across: nothing of it can reach a pixel.
  p.position.set(0, -20000, 0);
  p.scale.setScalar(1e-4);
  p.visible = false;
  return p;
}

/** Draws every kind of caster once into a shadow map of its own (a scene of proxies that share the real geometry and material and the kind's depth material), so each depth program is
 * linked now. The world's own shadow map, frame counters and canvas are left as they were. `yieldToMain` gives the frame loop its turn between slices of `budget` ms. */
export async function warmShadowPrograms({ renderer, scene, camera, yieldToMain = null, budget = 3.5, reps = null }) {
  reps ??= assignDepthMaterials(scene).reps;
  const kinds = [...reps.values()];
  if (!kinds.length) return { kinds: 0, renders: 0 };
  const mini = new THREE.Scene(), proxies = kinds.map(proxyOf);
  // Three's own shared depth material, for what is created after this (a sign's charm, a pooled effect): drawn once plain and once instanced, so that is linked now too.
  const shared = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  for (const p of [new THREE.Mesh(new THREE.BoxGeometry(), shared), new THREE.InstancedMesh(new THREE.BoxGeometry(), shared, 1)]) {
    p.castShadow = true; p.frustumCulled = false; p.position.set(0, -20000, 0); p.scale.setScalar(1e-4); p.visible = false;
    proxies.push(p);
  }
  const hemisphere = new THREE.HemisphereLight(0xe6f4ed, 0x727955, 0);
  const sun = new THREE.DirectionalLight(0xffe8c5, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(8, 8);
  sun.position.set(3, 10, 3);
  mini.add(hemisphere, sun, sun.target, ...proxies);
  const info = renderer.info, shadowMap = renderer.shadowMap;
  let renders = 0;
  try {
    for (let i = 0; i < proxies.length;) {
      if (yieldToMain) await yieldToMain();
      const t0 = performance.now();
      while (i < proxies.length && (!yieldToMain || performance.now() - t0 < budget)) {
        proxies.forEach((p, k) => { p.visible = k === i; });
        // The world's own state, put back exactly: its counters (the HUD, the frame stamp the shadow rig compares), its pending shadow redraw, nothing cleared.
        const saved = { ...info.render }, autoReset = info.autoReset, autoClear = renderer.autoClear, needs = shadowMap.needsUpdate;
        info.autoReset = false;
        renderer.autoClear = false;
        shadowMap.needsUpdate = true;
        try { renderer.render(mini, camera); renders++; }
        finally { info.autoReset = autoReset; renderer.autoClear = autoClear; shadowMap.needsUpdate = needs; Object.assign(info.render, saved); }
        i++;
      }
    }
  } finally {
    mini.clear();
    sun.shadow.dispose();
    hemisphere.dispose();
    // The proxies' own instance buffers (and the plain ones' box and material); the geometry and materials of the kinds are the world's and stay.
    for (const p of proxies) { if (p.isInstancedMesh) p.dispose(); if (p.material === shared) p.geometry.dispose(); }
    shared.dispose();
  }
  return { kinds: kinds.length, renders };
}
