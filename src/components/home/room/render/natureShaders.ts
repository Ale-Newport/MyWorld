/* ============================================================
   PLANT SHADERS
   Stems, leaves and their shadows. All of them read the hall's
   light from the lighting cache at their own pixel — the wall a
   few centimetres behind them — so a leaf under the cornice is in
   the cornice's shade and a leaf in the window's light is lit by
   it, without a second lighting model. Each splits that light
   into the key's share (stored in the cache's alpha) and the
   rest, and re-shades the key's share for its own orientation.
   ============================================================ */

const shared = /* glsl */ `
  uniform sampler2D tIrr;
  uniform vec2 uRes;
  uniform vec3 uKeyDir;
  uniform vec3 uKeyColor;

  // Split the cache at this pixel into ambient and key, and return
  // what a surface of normal n (attached to a wall of normal nw)
  // would receive there.
  vec3 plantLight(vec3 n, vec3 nw, float wrap) {
    vec4 E = texture2D(tIrr, gl_FragCoord.xy / uRes);
    vec3 key = uKeyColor * E.a;
    vec3 ambient = max(E.rgb - key, vec3(0.0));
    float wallNdl = max(dot(nw, uKeyDir), 0.15);
    float vis = E.a / wallNdl;
    float ndl = dot(n, uKeyDir);
    float lit = max(ndl, 0.0) + wrap * max(-ndl, 0.0);
    // Sky from above, bounce from below, both softened by the plant
    // standing a little proud of a wall that already took some.
    float hemi = 0.82 + 0.18 * n.y;
    return ambient * hemi + uKeyColor * vis * lit;
  }
`

/* ---- stems -------------------------------------------------- */

export const stemVert = /* glsl */ `
  attribute vec3 aOffset;
  attribute vec3 aNormal;
  attribute vec4 aPrev;   // previous centreline point, its arc fraction
  attribute vec4 aStem;   // start, duration, -, radius
  attribute vec2 aCut;    // arc fraction the reading field lets it reach; when the takeover frees it
  attribute float aS;
  uniform float uGrowth;
  uniform float uTakeover;
  uniform float uShadow;
  uniform vec3 uKeyDirV;
  varying vec3 vN;
  varying vec3 vNw;
  varying float vAcross;
  varying float vMain;
  void main() {
    float g = clamp((uGrowth - aStem.x) / aStem.y, 0.0, 1.0);
    // The portal's takeover lets every stem run on past the copy.
    float freed = clamp((uTakeover - aCut.y) / (max(0.9, aCut.y + 0.05) - aCut.y), 0.0, 1.0);
    float reach = min(g, aCut.x + (1.0 - aCut.x) * freed);
    vec3 c = position;
    float r = aStem.w * (1.0 - 0.5 * aS);
    // Width thickens as the stem ages, as the prototype's did.
    r *= 0.55 + 0.45 * clamp((uGrowth - aStem.x) / 0.35, 0.0, 1.0);
    // Taper to a fine tip just behind the growing end.
    r *= mix(0.22, 1.0, smoothstep(reach, reach - 0.05, aS));
    if (aS > reach) {
      // Beyond the tip: fold onto the tip itself.
      float f = clamp((reach - aPrev.w) / max(aS - aPrev.w, 1e-5), 0.0, 1.0);
      c = mix(aPrev.xyz, position, f);
      r = 0.0;
    }
    if (reach <= 0.0) r = 0.0;
    vec3 p;
    if (uShadow > 0.5) {
      // Contact shade: the tube pressed onto the stone, widened and
      // pushed along the light.
      vec3 onWall = c - aNormal * aStem.w * 1.1;
      vec3 side = aOffset - aNormal * dot(aOffset, aNormal);
      vec3 shift = uKeyDirV - aNormal * dot(uKeyDirV, aNormal);
      p = onWall + side * r * 2.6 - shift * aStem.w * 1.4 + aNormal * 0.0008;
    } else {
      p = c + aOffset * r;
    }
    vN = aOffset;
    vNw = aNormal;
    vAcross = length(aOffset - aNormal * dot(aOffset, aNormal));
    vMain = step(0.004, aStem.w);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`

export const stemFrag = /* glsl */ `
  ${shared}
  varying vec3 vN;
  varying vec3 vNw;
  varying float vAcross;
  varying float vMain;
  void main() {
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;
    // Woody old stems, greener young ones (the prototype's two inks).
    vec3 col = mix(vec3(0.075, 0.09, 0.03), vec3(0.085, 0.13, 0.04), 1.0 - vMain);
    vec3 E = plantLight(n, normalize(vNw), 0.15);
    gl_FragColor = vec4(col * E, 1.0);
  }
`

export const stemShadowFrag = /* glsl */ `
  uniform float uStrength;
  varying vec3 vN;
  varying vec3 vNw;
  varying float vAcross;
  varying float vMain;
  void main() {
    // vAcross is 1 at the flanks of the pressed tube, 0 on its crown.
    float a = (1.0 - smoothstep(0.35, 1.0, vAcross)) * uStrength;
    gl_FragColor = vec4(vec3(1.0 - a * 0.55), 1.0);
  }
`

/* ---- leaves -------------------------------------------------- */

const leafCommon = /* glsl */ `
  attribute vec3 iPos;
  attribute vec3 iNormal;
  attribute vec3 iDir;
  attribute vec4 iA;   // size, aspect, sprite, lift
  attribute vec4 iB;   // birth, unfurl, roll, phase
  attribute vec4 iC;   // sway, shade, litter, anchor height
  attribute float iD;  // takeover value that admits the leaf (< 0: always admitted)
  uniform float uGrowth;
  uniform float uTakeover;
  uniform float uTime;
  uniform float uSway;
  uniform float uSwayAmp;

  // Leaf-local frame: x across the blade, y to its tip, z out of it.
  vec3 leafLocal(vec2 q, float g, float age, out vec3 nLocal) {
    float aspect = iA.y * (0.3 + 0.7 * smoothstep(0.0, 1.0, clamp(age * 1.5, 0.0, 1.0)));
    float x = q.x * aspect;
    float y = q.y - 0.04;
    // Cupped across the midrib, the tip curling gently back.
    float cup = 0.2 * (0.55 + 0.45 * g);
    float curl = 0.13;
    float z = cup * q.x * q.x * 4.0 * 0.25 - curl * y * y;
    nLocal = normalize(vec3(-2.0 * cup * q.x / max(aspect, 0.05), 2.0 * curl * y, 1.0));
    return vec3(x, y, z);
  }

  mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
  mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
  mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }

  // World position (and normal) of this vertex of this leaf, or
  // false if the leaf has not been born at this growth value.
  bool placeLeaf(vec2 q, out vec3 world, out vec3 normal, out float h) {
    float age = (uGrowth - iB.x) / iB.y;
    // A leaf the copy held back unfurls when the takeover reaches it.
    if (iD >= 0.0) age = min(age, (uTakeover - iD) / 0.07);
    if (age <= 0.0) return false;
    float g = 1.0 - pow(1.0 - clamp(age, 0.0, 1.0), 3.0);
    float size = iA.x * g;
    if (size < 0.002) return false;
    vec3 nl;
    vec3 p = leafLocal(q, g, age, nl) * size;
    float wind = 0.0;
    float flutter = 0.0;
    if (iC.x > 0.0) {
      wind = (sin(uTime * 0.82 + iB.w) + 0.27 * sin(uTime * 1.7 + iB.w * 2.0)) * 0.7 * uSwayAmp * iC.x * uSway;
      flutter = sin(uTime * 1.13 + iB.w * 3.1) * uSwayAmp * iC.x * uSway;
    }
    // Unfolding leaves start turned a little and lying flatter.
    mat3 R = rotZ(wind + (1.0 - g) * 0.38) * rotX(iA.w * (0.4 + 0.6 * g) + flutter) * rotY(iB.z);
    p = R * p;
    nl = R * nl;
    vec3 Z = normalize(iNormal);
    vec3 Y = normalize(iDir - Z * dot(iDir, Z));
    vec3 X = cross(Y, Z);
    mat3 F = mat3(X, Y, Z);
    vec3 base = iPos + Z * 0.004;
    world = base + F * p;
    normal = normalize(F * nl);
    // Height above the stone itself: the attachment's own lift (its
    // stem's radius; a fallen leaf's few millimetres) plus the blade's.
    h = dot(world - iPos, Z) + iC.w;
    return true;
  }

  vec2 atlasUv(vec2 q) {
    float sprite = iA.z;
    float col = mod(sprite, 8.0);
    float row = floor(sprite / 8.0);
    vec2 cell = vec2(q.x + 0.5, q.y);
    return vec2((col + cell.x) / 8.0, (3.0 - row + cell.y) / 4.0);
  }
`

export const leafVert = /* glsl */ `
  ${leafCommon}
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vNw;
  varying vec3 vWorld;
  varying vec2 vQ;
  varying float vShade;
  varying float vLitter;
  void main() {
    vec2 q = position.xy;
    vec3 w;
    vec3 n;
    float h;
    if (!placeLeaf(q, w, n, h)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vUv = atlasUv(q);
    vN = n;
    vNw = iNormal;
    vWorld = w;
    vQ = q;
    vShade = iC.y;
    vLitter = iC.z;
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  }
`

export const leafFrag = /* glsl */ `
  ${shared}
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
    // Tangent frame of the blade from screen derivatives.
    vec3 dp1 = dFdx(vWorld);
    vec3 dp2 = dFdy(vWorld);
    vec2 du1 = dFdx(vQ);
    vec2 du2 = dFdy(vQ);
    vec3 T = normalize(dp1 * du2.y - dp2 * du1.y);
    vec3 B = normalize(cross(N, T));
    vec3 tn = texture2D(tLeafNormal, vUv).xyz * 2.0 - 1.0;
    vec3 n = normalize(T * tn.x + B * tn.y + N * tn.z);
    vec3 albedo = a.rgb;
    if (vLitter > 0.5) {
      // Fallen and dried: the green gone to tan and umber.
      float l = dot(albedo, vec3(0.3, 0.55, 0.15));
      albedo = mix(vec3(0.28, 0.2, 0.09), vec3(0.42, 0.33, 0.17), clamp(l * 6.0, 0.0, 1.0));
    }
    // Darker towards the petiole and in the heart of a cluster.
    float occl = (0.8 + 0.2 * smoothstep(0.0, 0.45, vQ.y)) * vShade;
    vec3 E = plantLight(n, normalize(vNw), 0.3);
    vec3 col = albedo * E * occl;
    // A waxy cuticle: a broad, faint sheen.
    vec3 v = normalize(cameraPosition - vWorld);
    vec3 hv = normalize(v + uKeyDir);
    float spec = pow(max(dot(n, hv), 0.0), 28.0) * 0.06;
    vec4 Ec = texture2D(tIrr, gl_FragCoord.xy / uRes);
    col += uKeyColor * Ec.a * spec * (1.0 - vLitter);
    gl_FragColor = vec4(col, a.a);
  }
`

export const leafShadowVert = /* glsl */ `
  ${leafCommon}
  uniform float uMode;      // 0: cast along the key, 1: contact shade along the normal
  uniform vec3 uKeyDirV;
  varying vec2 vUv;
  varying vec2 vQ;
  varying float vH;
  void main() {
    vec2 q = position.xy;
    vec3 w;
    vec3 n;
    float h;
    if (!placeLeaf(q, w, n, h)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec3 N = normalize(iNormal);
    vec3 dir = uMode < 0.5 ? normalize(uKeyDirV) : N;
    float cosA = max(dot(dir, N), 0.25);
    vec3 s = w - dir * (h / cosA) + N * 0.001;
    // Spread the shade a little with height: a lifted leaf's
    // shadow is larger and softer.
    vec3 c = iPos;
    s = c + (s - c) * (1.0 + h * (uMode < 0.5 ? 1.2 : 3.5));
    vUv = atlasUv(q);
    vQ = q;
    vH = h;
    gl_Position = projectionMatrix * viewMatrix * vec4(s, 1.0);
  }
`

export const leafShadowFrag = /* glsl */ `
  uniform sampler2D tAlbedo;
  uniform sampler2D tIrr;
  uniform vec2 uRes;
  uniform float uMode;
  uniform float uStrength;
  varying vec2 vUv;
  varying vec2 vQ;
  varying float vH;
  void main() {
    // Further from the stone, blurrier and paler. The blur stops while
    // the blade still has its shape (a 96px cell is ~8px at level 3.5);
    // past that the mip turns the whole card grey and the shade would
    // draw the card. The spread in the vertex shader carries the rest.
    float blur = min(uMode < 0.5 ? 1.0 + vH * 70.0 : 2.5 + vH * 90.0, 3.5);
    float a = textureLod(tAlbedo, vUv, blur).a;
    // Whatever blur reaches the card's border fades out before it.
    a *= smoothstep(0.5, 0.4, abs(vQ.x)) * smoothstep(1.0, 0.9, vQ.y) * smoothstep(0.0, 0.05, vQ.y);
    float keyVis = clamp(texture2D(tIrr, gl_FragCoord.xy / uRes).a * 1.4, 0.0, 1.0);
    float fade = uMode < 0.5 ? exp(-vH * 9.0) * keyVis : exp(-vH * 14.0);
    float s = a * fade * uStrength;
    if (s < 0.003) discard;
    gl_FragColor = vec4(vec3(1.0 - s), 1.0);
  }
`

/* ---- the frame -------------------------------------------- */

export const blitFrag = /* glsl */ `
  uniform sampler2D tColor;
  varying vec2 vUv;
  void main() { gl_FragColor = vec4(texture2D(tColor, vUv).rgb, 1.0); }
`

export const depthOnlyVert = /* glsl */ `
  void main() { gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }
`
export const depthOnlyFrag = /* glsl */ `
  void main() { gl_FragColor = vec4(0.0); }
`
