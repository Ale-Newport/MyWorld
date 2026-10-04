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
   ============================================================ */

const light = /* glsl */ `
  uniform vec3 uKeyDir;
  uniform vec3 uKeyColor;
  uniform vec3 uAmbient;
  uniform float uDark;
  vec3 canopyLight(vec3 n, float wrap) {
    float ndl = dot(n, uKeyDir);
    float lit = max(ndl, 0.0) + wrap * max(-ndl, 0.0);
    float hemi = 0.78 + 0.22 * n.y;
    return (uAmbient * hemi + uKeyColor * lit) * (1.0 - uDark);
  }
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
    gl_FragColor = vec4(col, a.a);
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
    gl_FragColor = vec4(col * canopyLight(n, 0.15), 1.0);
  }
`

/** Premultiplied in, premultiplied out — tone-mapped as the room is. */
export const canopyOutFrag = /* glsl */ `
  uniform sampler2D tColor;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tColor, vUv);
    float a = clamp(c.a, 0.0, 1.0);
    gl_FragColor = vec4(a > 0.0001 ? c.rgb / a : vec3(0.0), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor = vec4(gl_FragColor.rgb * a, a);
  }
`
