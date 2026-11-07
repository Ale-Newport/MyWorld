/* ============================================================
   CANOPY SHADERS
   The canopy's leaves and stems are the room's own (the same vertex
   shaders, the same painted atlas). Only their light differs: they
   hang in the air in front of the hall, not against its plaster, so
   there is no wall-side cache to read. They take the hall's key and
   its sky directly — and, layer by layer, lose them as the leaves in
   front close over them (`uDark`), as the inside of a hedge does.

   Everything is written PREMULTIPLIED: the canopy is a transparent
   layer over the page, and the multisampled resolve averages covered
   and empty samples alike.

   BY NIGHT (the site's dark theme, render/night.ts) the hedge is lit by
   the moon, and a hedge at night is read by what the moon finds on it,
   not by its colour: a cool glint on whatever of a blade turns towards
   it, its veins and curled margin (the relief of its normal map), a
   thin rim along its outline — and the near layers keep more of it
   than the deep ones (`uNear`), so the gaps between the leaves stay
   dark and the page behind them still recedes. All of it is scaled by
   `uNight`: by day nothing here changes.
   ============================================================ */

import { ROOM_CONFIG } from '../config'

const N = ROOM_CONFIG.night.canopy
const NEAR_LIFT = N.nearLift
const GLINT = N.glint
const RELIEF = N.relief
const RIM = N.rim

const light = /* glsl */ `
  uniform vec3 uKeyDir;
  uniform vec3 uKeyColor;
  uniform vec3 uAmbient;
  uniform float uDark;
  // 0 by day, 1 by night; and this layer's nearness, 0 deep … 1 near.
  uniform float uNight;
  uniform float uNear;
  vec3 canopyLight(vec3 n, float wrap) {
    float ndl = dot(n, uKeyDir);
    float lit = max(ndl, 0.0) + wrap * max(-ndl, 0.0);
    float hemi = 0.78 + 0.22 * n.y;
    return (uAmbient * hemi + uKeyColor * lit) * (1.0 - uDark);
  }
  // By night the near layers keep more of the moon than the deep ones.
  float nearLift() { return 1.0 + uNight * uNear * ${NEAR_LIFT.toFixed(2)}; }
  // The moon's colour on a leaf's sheen: the key (the moon's by night), cooled.
  vec3 moonSheen() { return uKeyColor * vec3(0.86, 0.96, 1.12); }
`

export const canopyLeafFrag = /* glsl */ `
  ${light}
  uniform sampler2D tAlbedo;
  uniform sampler2D tLeafNormal;
  uniform float uAlphaCut;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vNw;
  varying vec3 vWorld;
  varying vec2 vQ;
  varying float vShade;
  varying float vLitter;
  void main() {
    vec4 a = texture2D(tAlbedo, vUv);
    if (a.a < uAlphaCut) discard;
    vec3 N = normalize(vN);
    if (!gl_FrontFacing) N = -N;
    vec3 dp1 = dFdx(vWorld);
    vec3 dp2 = dFdy(vWorld);
    vec2 du1 = dFdx(vQ);
    vec2 du2 = dFdy(vQ);
    vec3 T = normalize(dp1 * du2.y - dp2 * du1.y);
    vec3 B = normalize(cross(N, T));
    vec3 tn = texture2D(tLeafNormal, vUv).xyz * 2.0 - 1.0;
    vec3 n = normalize(T * tn.x + B * tn.y + N * tn.z);
    float occl = (0.8 + 0.2 * smoothstep(0.0, 0.45, vQ.y)) * vShade;
    // The atlas is uploaded premultiplied: a.rgb already carries a.a.
    vec3 col = a.rgb * canopyLight(n, 0.35) * occl;
    vec3 v = normalize(cameraPosition - vWorld);
    vec3 hv = normalize(v + uKeyDir);
    col += uKeyColor * pow(max(dot(n, hv), 0.0), 28.0) * 0.06 * (1.0 - uDark) * a.a;
    if (uNight > 0.0) {
      // The moon on the blade (see BY NIGHT above): a broad glint, the veins
      // and margin where the relief turns from flat, and a rim inside the
      // outline (where a blurred read of the blade's own alpha falls off).
      // The glint is the cuticle's (the moon's own colour); the veins and the
      // rim are the leaf's green, lit.
      float glint = pow(max(dot(n, hv), 0.0), 12.0);
      float relief = clamp((1.0 - tn.z) * 5.0, 0.0, 1.0) * (0.45 + 0.55 * max(dot(n, uKeyDir), 0.0));
      float rim = clamp((a.a - textureLod(tAlbedo, vUv, 1.6).a) * 4.0, 0.0, 1.0);
      vec3 green = a.rgb / max(a.a, 0.004) * 2.2 + 0.08;
      vec3 moon = moonSheen() * (glint * ${GLINT.toFixed(2)} + green * (relief * ${RELIEF.toFixed(2)} + rim * ${RIM.toFixed(2)}));
      col += moon * a.a * occl * (1.0 - uDark) * uNight;
    }
    gl_FragColor = vec4(col * nearLift(), a.a);
  }
`

export const canopyStemFrag = /* glsl */ `
  ${light}
  varying vec3 vN;
  varying vec3 vNw;
  varying float vAcross;
  varying float vMain;
  void main() {
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;
    vec3 col = mix(vec3(0.075, 0.09, 0.03), vec3(0.085, 0.13, 0.04), 1.0 - vMain);
    gl_FragColor = vec4(col * canopyLight(n, 0.15) * nearLift(), 1.0);
  }
`

/** Premultiplied in, premultiplied out — tone-mapped as the room is. */
export const canopyOutFrag = /* glsl */ `
  uniform sampler2D tColor;
  // The frame's level after tone mapping: 1 by day, low by night (render/night.ts).
  uniform vec3 uLevel;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tColor, vUv);
    float a = clamp(c.a, 0.0, 1.0);
    gl_FragColor = vec4(a > 0.0001 ? c.rgb / a : vec3(0.0), 1.0);
    #include <tonemapping_fragment>
    gl_FragColor.rgb *= uLevel;
    #include <colorspace_fragment>
    gl_FragColor = vec4(gl_FragColor.rgb * a, a);
  }
`
