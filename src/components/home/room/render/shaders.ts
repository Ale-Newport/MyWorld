/* ============================================================
   SHADERS
   Written for three's ShaderMaterial (GLSL ES 3.00 underneath;
   `varying`, `texture2D` and `gl_FragColor` are mapped by three).

   The room is lit in two stages because the camera never moves:

   1. LIGHTING CACHE (once per layout). A G-buffer of the bare
      architecture is lit by a hundred-odd shadow-mapped samples —
      a soft clerestory key, an even skylight and the floor's
      bounce — accumulated into one irradiance image. This is the
      expensive, converged, noise-free part: real contact shading
      under every moulding and inside every flute, soft shadows
      from every pilaster.

   2. SURFACES (whenever growth changes). The architecture is
      drawn again, multisampled, with its procedural materials,
      its damp and its moss, reading its light from the cache
      through an edge-aware lookup so silhouettes stay crisp.
   ============================================================ */

/* ---- shared ------------------------------------------------- */

const reconstruct = /* glsl */ `
  uniform mat4 uInvProj;
  uniform mat4 uCamWorld;
  vec3 worldAt(vec2 uv, float depth) {
    vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 view = uInvProj * ndc;
    view /= view.w;
    return (uCamWorld * view).xyz;
  }
`

export const fullscreenVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

/* ---- G-buffer ---------------------------------------------- */

export const gbufferVert = /* glsl */ `
  attribute float aMat;
  varying vec3 vNormal;
  varying float vMat;
  void main() {
    vNormal = normalize(mat3(modelMatrix) * normal);
    vMat = aMat;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`

export const gbufferFrag = /* glsl */ `
  varying vec3 vNormal;
  varying float vMat;
  void main() {
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    gl_FragColor = vec4(n * 0.5 + 0.5, (vMat + 0.5) / 8.0);
  }
`

/* ---- shadow maps ------------------------------------------- */

export const shadowVert = /* glsl */ `
  attribute float aMat;
  uniform float uExcludeFloor;
  uniform float uExcludePlaster;
  void main() {
    // The ceiling never casts: light reaches the hall through a
    // skylight above it. For bounce samples the bouncing surface is
    // the source, not an occluder: the floor for light rising off it,
    // the plaster walls for light coming back off them.
    bool skip = aMat > 2.5 && aMat < 3.5;
    skip = skip || (uExcludeFloor > 0.5 && aMat > 1.5 && aMat < 2.5);
    skip = skip || (uExcludePlaster > 0.5 && (aMat < 0.5 || (aMat > 3.5 && aMat < 4.5)));
    gl_Position = skip ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`

export const shadowFrag = /* glsl */ `
  void main() { gl_FragColor = vec4(1.0); }
`

/* ---- accumulation ------------------------------------------ */

export const accumFrag = /* glsl */ `
  uniform sampler2D tNormal;
  uniform sampler2D tDepth;
  uniform sampler2D tShadow;
  uniform mat4 uShadowVP;
  uniform mat4 uShadowView;
  uniform vec3 uLightDir;
  uniform vec3 uLightPos;
  uniform vec3 uLightNormal;
  uniform vec3 uRadiance;
  uniform float uPersp;
  uniform float uNear;
  uniform float uFar;
  uniform float uKey;
  uniform float uTexel;
  uniform float uBias;
  uniform float uJitter;
  uniform float uSeed;
  uniform vec2 uShadowSize;
  varying vec2 vUv;
  ${reconstruct}

  vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
  }

  // Depth of the occluder the light sees in this texel, as a
  // distance in metres along the light's view axis.
  float occluder(vec2 uv) {
    float d = texture2D(tShadow, uv).x;
    if (uPersp > 0.5) return uNear * uFar / (uFar - d * (uFar - uNear));
    return uNear + d * (uFar - uNear);
  }

  void main() {
    float d = texture2D(tDepth, vUv).x;
    if (d >= 1.0) { gl_FragColor = vec4(0.0); return; }
    vec3 n = normalize(texture2D(tNormal, vUv).xyz * 2.0 - 1.0);
    vec3 wp = worldAt(vUv, d);
    // A point light on the window's face, or a direction of sky.
    vec3 L = uLightDir;
    float falloff = 1.0;
    if (uPersp > 0.5) {
      vec3 toL = uLightPos - wp;
      float dist = length(toL);
      L = toL / dist;
      falloff = max(dot(-L, uLightNormal), 0.0) / (dist * dist);
    }
    float ndl = dot(n, L);
    if (ndl <= 0.0 || falloff <= 0.0) { gl_FragColor = vec4(0.0); return; }
    // Normal offset scaled by the grazing angle keeps acne out of
    // shallow light without detaching contact shadows.
    vec3 p = wp + n * uTexel * (1.2 + 2.0 * (1.0 - ndl)) + L * uTexel * 0.6;
    // Each sample looks up its shadow from a slightly different
    // point across the beam, different for every pixel: the
    // discrete copies of a penumbra dissolve into fine noise, and a
    // hundred samples average the noise away.
    vec3 t1 = normalize(cross(L, abs(L.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
    vec3 t2 = cross(L, t1);
    vec2 j = hash22(gl_FragCoord.xy + uSeed * 37.13) * 2.0 - 1.0;
    p += (t1 * j.x + t2 * j.y) * uJitter;
    vec4 sc = uShadowVP * vec4(p, 1.0);
    vec3 s = sc.xyz / sc.w * 0.5 + 0.5;
    float vis = 1.0;
    if (all(greaterThan(s.xy, vec2(0.0))) && all(lessThan(s.xy, vec2(1.0)))) {
      float z = -(uShadowView * vec4(p, 1.0)).z - uBias;
      vec2 st = s.xy * uShadowSize - 0.5;
      vec2 f = fract(st);
      vec2 b = (floor(st) + 0.5) / uShadowSize;
      vec2 o = 1.0 / uShadowSize;
      float a0 = step(z, occluder(b));
      float a1 = step(z, occluder(b + vec2(o.x, 0.0)));
      float a2 = step(z, occluder(b + vec2(0.0, o.y)));
      float a3 = step(z, occluder(b + o));
      vis = mix(mix(a0, a1, f.x), mix(a2, a3, f.x), f.y);
    }
    float e = ndl * vis * falloff;
    gl_FragColor = vec4(uRadiance * e, uKey * e);
  }
`

/* ---- surfaces ---------------------------------------------- */

export const roomVert = /* glsl */ `
  attribute float aMat;
  attribute float aRand;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vMat;
  varying float vRand;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vMat = aMat;
    vRand = aRand;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`

export const roomFrag = /* glsl */ `
  uniform sampler2D tIrr;
  uniform sampler2D tNormal;
  uniform sampler2D tDepth;
  uniform sampler2D tDetail;
  uniform vec2 uRes;
  uniform vec3 uKeyDir;
  uniform vec3 uKeyColor;
  uniform vec3 uBounce;
  uniform vec3 uSkyTint;
  uniform vec3 uSlab;
  uniform float uGrowth;
  // The portal's push at the very end: the room is taken back over
  // the copy it had kept clear, and the stone goes further over.
  uniform float uTakeover;
  uniform sampler2D tWallField;
  uniform sampler2D tFloorField;
  uniform sampler2D tWeather;
  uniform sampler2D tMossAlbedo;
  uniform sampler2D tMossData;
  uniform sampler2D tRead;
  uniform vec4 uWallRect;
  uniform vec4 uFloorRect;
  uniform float uReadDelay;
  uniform vec3 uSlice;
  uniform vec2 uWallScreen;   // screen v (0 bottom) of the wall at height 0, per metre
  uniform float uSoffitH;
  uniform float uMossTile;
  uniform float uDebugIrr;
  ${reconstruct}

  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vMat;
  varying float vRand;

  // Edge-aware read of the lighting cache: of the nine texels
  // round this pixel, trust the ones that saw this same surface.
  vec4 irradiance(vec3 wp, vec3 n) {
    vec2 px = gl_FragCoord.xy;
    vec4 acc = vec4(0.0);
    float wsum = 0.0;
    float dist = length(wp - cameraPosition);
    float sigma = 0.006 + dist * 0.0016;
    // Almost everywhere the cache's own texel saw this very surface:
    // then four bilinear reads at its corners give the same 3×3 tent
    // the search below would (it smooths the last of the sampling
    // grain) for a fraction of the cost. Only along edges, where the
    // multisampled fragment and the texel can belong to different
    // surfaces, is the neighbourhood searched texel by texel.
    {
      vec2 uv = px / uRes;
      float d = texture2D(tDepth, uv).x;
      vec3 nn = texture2D(tNormal, uv).xyz * 2.0 - 1.0;
      float off = dot(worldAt(uv, d) - wp, n);
      if (d < 1.0 && abs(off) < sigma * 0.25 && dot(normalize(nn), n) > 0.999) {
        vec2 h = 0.5 / uRes;
        return 0.25 * (texture2D(tIrr, uv + vec2(-h.x, -h.y)) + texture2D(tIrr, uv + vec2(h.x, -h.y))
          + texture2D(tIrr, uv + vec2(-h.x, h.y)) + texture2D(tIrr, uv + vec2(h.x, h.y)));
      }
    }
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 uv = (px + vec2(float(i), float(j))) / uRes;
        float d = texture2D(tDepth, uv).x;
        if (d >= 1.0) continue;
        vec3 nn = texture2D(tNormal, uv).xyz * 2.0 - 1.0;
        vec3 q = worldAt(uv, d);
        vec3 dq = q - wp;
        // Distance off this fragment's plane matters, distance along
        // it barely does: lighting is smooth across a surface.
        float off = dot(dq, n);
        float w = exp(-(off * off) / (sigma * sigma)) * pow(max(dot(normalize(nn), n), 0.0), 24.0);
        w *= (i == 0 && j == 0) ? 1.0 : 0.7;
        acc += texture2D(tIrr, uv) * w;
        wsum += w;
      }
    }
    return wsum > 1e-5 ? acc / wsum : texture2D(tIrr, px / uRes);
  }

  // Triplanar-lite: walls are axis aligned, so pick the plane the
  // surface faces and sample the detail field in metres there.
  vec2 planar(vec3 p, vec3 n) {
    vec3 a = abs(n);
    if (a.y > a.x && a.y > a.z) return p.xz;
    if (a.x > a.z) return p.zy;
    return p.xy;
  }

  vec4 detail(vec2 p, float scale) { return texture2D(tDetail, p * scale); }

  void main() {
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 wp = vWorld;
    vec2 q = planar(wp, n);
    int mat = int(vMat + 0.5);

    // Shared fields at physical scales.
    vec4 broad = detail(q, 0.22);      // ~4.5 m tile: mottling
    vec4 mid = detail(q + 7.3, 1.1);   // ~0.9 m: trowel and grain
    vec4 fine = detail(q + 3.1, 6.0);  // ~17 cm: pores

    vec3 albedo;
    float rough = 0.9;
    float bump = 0.0;
    if (mat == 2) {
      // Honed limestone: each slab cut from a slightly different
      // bed, flecked with shell, faintly clouded.
      vec3 bed = mix(vec3(0.83, 0.808, 0.762), vec3(0.88, 0.862, 0.82), vRand);
      bed *= mix(vec3(1.0), vec3(1.012, 1.0, 0.975), fract(vRand * 7.31));
      bed *= 0.97 + 0.06 * (broad.r - 0.5) + 0.05 * (mid.g - 0.5);
      float cloud = smoothstep(0.35, 0.8, detail(q * 0.6 + vRand * 17.0, 0.9).r);
      bed = mix(bed, bed * vec3(0.955, 0.95, 0.94), cloud * 0.5);
      float fleck = detail(q + vRand * 9.0, 2.6).a;
      bed = mix(bed, vec3(0.62, 0.6, 0.56), fleck * 0.35);
      // Joints: a few millimetres of darker bedding between stones,
      // drawn at the shader's resolution because at this distance
      // the real gap in the geometry is thinner than a pixel.
      vec2 cell = (wp.xz - uSlab.yz) / uSlab.x;
      vec2 e = min(fract(cell), 1.0 - fract(cell)) * uSlab.x;
      vec2 fw = fwidth(wp.xz);
      vec2 jl = 1.0 - smoothstep(vec2(0.0023), vec2(0.0023) + fw * 1.2, e);
      float joint = max(jl.x, jl.y);
      vec2 rim = 1.0 - smoothstep(vec2(0.0), vec2(0.03) + fw * 2.0, e);
      bed *= 1.0 - 0.025 * max(rim.x, rim.y);
      albedo = mix(bed, bed * vec3(0.915, 0.905, 0.885), joint);
      rough = 0.42 + 0.12 * mid.b;
      bump = (fine.b - 0.5) * 0.25;
    } else if (mat == 1) {
      // Carved limestone of the orders: warmer, finer, tooled.
      albedo = vec3(0.845, 0.825, 0.785) * (0.975 + 0.04 * (broad.g - 0.5) + 0.03 * (fine.b - 0.5));
      albedo = mix(albedo, albedo * 0.93, detail(q + 2.0, 3.4).a * 0.5);
      rough = 0.78;
      bump = (fine.g - 0.5) * 0.35;
    } else if (mat == 3) {
      albedo = vec3(0.86, 0.85, 0.82) * (0.98 + 0.03 * (broad.r - 0.5));
      rough = 0.95;
    } else {
      // Lime plaster: a broad cloudiness and the trowel's grain.
      albedo = vec3(0.865, 0.85, 0.815) * (0.975 + 0.045 * (broad.r - 0.5) + 0.02 * (mid.g - 0.5));
      rough = 0.92;
      bump = (mid.b - 0.5) * 0.25 + (fine.b - 0.5) * 0.2;
    }

    /* ---- the room taken back ------------------------------- */
    // Copy-aware: the reading field (where text will sit) reads as
    // drier, cleaner stone — moss, damp and cracks all come later
    // there, so they never darken what has to be read.
    // The reading field, softened further for surfaces: five taps
    // across ~2% of the screen.
    vec2 sc = gl_FragCoord.xy / uRes;
    vec2 ro = vec2(0.02 * uRes.y / uRes.x, 0.02);
    vec4 readAll = (texture2D(tRead, sc) * 2.0 + texture2D(tRead, sc + vec2(ro.x, 0.0)) + texture2D(tRead, sc - vec2(ro.x, 0.0))
      + texture2D(tRead, sc + vec2(0.0, ro.y)) + texture2D(tRead, sc - vec2(0.0, ro.y))) / 6.0;
    bool onFloor = mat == 2;
    vec4 F;
    vec2 mossUv;
    if (onFloor) {
      F = texture2D(tFloorField, (wp.xz - uFloorRect.xy) / uFloorRect.zw);
      mossUv = wp.xz / uMossTile;
    } else {
      F = texture2D(tWallField, (wp.xy - uWallRect.xy) / uWallRect.zw);
      mossUv = q / uMossTile;
    }
    float birth = F.r * 2.0 + (mat == 3 ? 9.0 : 0.0);
    // Time-aware: growth arriving at this birth only has to keep clear
    // of the copy still to come at that point of the story. Where the
    // copy sits the stone reads as drier — the delay is broken up by
    // the colonies' own noise, so its edge is never a straight line.
    float reading = birth < uSlice.x ? readAll.r : birth < uSlice.y ? readAll.g : birth < uSlice.z ? readAll.b : readAll.a;
    vec4 md = texture2D(tMossData, mossUv);
    // Varied at the colonies' own scale, never at a tuft's: a fine
    // modulation here would cut the edge into odd crescents.
    float delay = reading * uReadDelay * (0.6 + 0.8 * F.g) * (1.0 - uTakeover);
    birth += delay;
    // Ledges hold water and soil; soffits and overhangs stay dry; a
    // vertical face only greens at its very foot (and in the corners,
    // which the field already favours).
    if (!onFloor) {
      birth += -max(n.y, 0.0) * 0.32 + max(-n.y, 0.0) * 0.7;
      if (n.y < 0.5) birth += smoothstep(0.03, 0.22, wp.y) * 0.35;
    }
    if (onFloor) {
      // Joints first: moss follows the bedding between the stones.
      vec2 cell = (wp.xz - uSlab.yz) / uSlab.x;
      vec2 e = min(fract(cell), 1.0 - fract(cell)) * uSlab.x;
      // Early in the joints (lines of moss that draw the floor's
      // perspective), cushions swelling out of the crossings and the
      // odd hollow later — never a whole stone at once.
      float je = min(e.x, e.y);
      float cross = max(e.x, e.y);
      float cushion = smoothstep(0.55, 0.8, broad.g * 0.6 + mid.r * 0.4);
      birth -= 0.42 * exp(-je / 0.016) + 0.2 * exp(-cross / 0.06);
      birth += (0.5 - 0.35 * cushion) * (1.0 - exp(-je / 0.035));
    }
    float variation = F.g * 0.6 + F.b * 0.25 + fine.r * 0.15;
    float G = uGrowth + 0.45 * uTakeover;
    float t = G - birth;

    // RISING DAMP (walls): a tide mark that climbs from the skirting as
    // the story goes on — darker, faintly green plaster below an edge
    // that wanders with the wall's own noise, a salt line along it.
    if (!onFloor && mat != 3) {
      float tide = 0.1 + G * (0.32 + 0.3 * F.g) + (mid.r - 0.5) * 0.12;
      float below = 1.0 - smoothstep(tide - 0.16, tide + 0.04, wp.y);
      albedo *= mix(vec3(1.0), vec3(0.955, 0.95, 0.92), below * smoothstep(0.0, 0.3, G));
    }

    // Damp first, as in the prototype: a faint stain running ahead of
    // the moss that will follow it.
    float dampB = max(0.025, birth * 0.61 - 0.07);
    float damp = smoothstep(0.0, 1.0, (G - dampB) / 0.45);
    albedo = mix(albedo, albedo * vec3(0.86, 0.85, 0.76), damp * (onFloor ? 0.24 : 0.08));

    // MOSS: a living mat, not a scatter of dots. Where it has arrived
    // the stone is covered by a dark, close substrate with the tufts'
    // own colour on top; its edge is ragged at the scale of a single
    // tuft (the sheet's height and birth offsets break it up), and
    // on the floor a few lone tufts run ahead of it into the joints.
    vec4 ma = texture2D(tMossAlbedo, mossUv);
    float rag = (md.g - 0.5) * 0.09 + (md.r - 0.5) * 0.07 + (fine.g - 0.5) * 0.05;
    float cover = smoothstep(0.0, 0.07, t + rag);
    float dense = smoothstep(0.05, 0.45, t);
    float ahead = onFloor ? smoothstep(0.0, 0.03, t + 0.08 - md.g * 0.12) * ma.a * 0.8 : 0.0;
    vec3 substrate = mix(vec3(0.03, 0.036, 0.013), vec3(0.055, 0.062, 0.022), variation);
    vec3 matCol = mix(vec3(0.05, 0.075, 0.018), vec3(0.12, 0.15, 0.04), variation) * (0.8 + 0.45 * md.r);
    // Relief of the mat: tops of tufts catch the light, the gaps
    // between them fall into shade.
    vec2 dm = vec2(texture2D(tMossData, mossUv + vec2(0.004, 0.0)).r - md.r, texture2D(tMossData, mossUv + vec2(0.0, 0.004)).r - md.r);
    float lit = clamp(0.9 + 0.35 * (md.r - 0.45) + 2.2 * dot(dm, normalize(uKeyDir.xy + vec2(0.0, 0.001))), 0.55, 1.35);
    vec3 mossCol = mix(substrate, matCol, smoothstep(0.15, 0.7, md.r));
    mossCol = mix(mossCol, ma.rgb * lit, ma.a * (0.35 + 0.55 * dense));
    float moss = clamp(max(cover * (0.82 + 0.16 * dense), ahead), 0.0, 1.0);
    albedo = mix(albedo, mossCol, moss);
    rough = mix(rough, 1.0, moss);
    float self = mix(1.0, 0.78 + 0.3 * md.r, moss * (1.0 - ma.a * 0.5));

    // Cracks out of the seams and streaks of damp (wall only).
    if (!onFloor) {
      vec4 wx = texture2D(tWeather, (wp.xy - uWallRect.xy) / uWallRect.zw);
      if (wx.r + wx.b > 0.004) {
        // Cracks and streaks run up from the skirting or down from the
        // architrave. Each pixel of one keeps clear of the copy all the
        // way back to where it started, so a crack grows and recedes in
        // one piece, and is never seen in fragments either side of a
        // line of text.
        float from = wp.y < uSoffitH * 0.5 ? 0.27 : uSoffitH;
        float v0 = uWallScreen.x + uWallScreen.y * from;
        vec4 run = vec4(0.0);
        for (int i = 0; i <= 8; i++) run = max(run, texture2D(tRead, vec2(sc.x, mix(sc.y, v0, float(i) / 8.0))));
        float cb = (1.0 - wx.g) * 2.0;
        float db = (1.0 - wx.a) * 2.0;
        float cr = cb < uSlice.x ? run.r : cb < uSlice.y ? run.g : cb < uSlice.z ? run.b : run.a;
        float dr = db < uSlice.x ? run.r : db < uSlice.y ? run.g : db < uSlice.z ? run.b : run.a;
        float crackB = cb + cr * uReadDelay * 1.4 * (1.0 - uTakeover);
        // Only the line's core: a crack is a hairline, not a groove.
        float crack = smoothstep(0.3, 0.85, wx.r) * smoothstep(crackB, crackB + 0.03, G);
        albedo *= 1.0 - crack * 0.5;
        float dripB = db + dr * uReadDelay * (1.0 - uTakeover);
        float drip = wx.b * smoothstep(dripB, dripB + 0.12, G);
        albedo = mix(albedo, albedo * vec3(0.8, 0.79, 0.66), drip * 0.42);
      }
    }

    vec4 E = irradiance(wp, n);
    vec3 diffuse = albedo * E.rgb * self;
    // Fine relief catches the key light: tiny modulation only.
    diffuse *= 1.0 + bump * 0.18;

    // Soft sheen of the honed floor and the faint lustre of stone.
    vec3 v = normalize(cameraPosition - wp);
    vec3 h = normalize(v + uKeyDir);
    float a = rough * rough;
    float nh = max(dot(n, h), 0.0);
    float dd = a * a / (3.14159 * pow(nh * nh * (a * a - 1.0) + 1.0, 2.0));
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(v, h), 0.0), 5.0);
    vec3 spec = uKeyColor * dd * fres * E.a * 0.25 * (1.0 - moss);
    if (mat == 2) {
      // Blurred reflection of the bright walls in honed stone.
      vec3 r = reflect(-v, n);
      float fv = 0.03 + 0.97 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
      vec3 env = mix(uBounce * 0.8, uSkyTint, smoothstep(-0.05, 0.6, r.y));
      spec += env * fv * 0.35 * (1.0 - rough) * (1.0 - moss);
    }

    gl_FragColor = vec4(diffuse + spec, 1.0);
    if (uDebugIrr > 0.5) gl_FragColor = vec4(E.rgb * 0.5, 1.0);
  }
`

/* ---- output ------------------------------------------------ */

export const outputFrag = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tRead;
  uniform float uDebug;
  uniform float uDither;
  varying vec2 vUv;
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  void main() {
    gl_FragColor = vec4(texture2D(tColor, vUv).rgb, 1.0);
    if (uDebug > 0.5) {
      // Development only: the reading field over the room
      // (red: every chapter still to come; blue: the last chapters).
      vec4 f = texture2D(tRead, vUv);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.1, 0.1), step(0.3, f.r) * 0.3);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.1, 0.2, 1.0), step(0.3, f.a) * 0.35);
    }
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    // Triangular dither: a white wall is one long gradient, and an
    // 8-bit gradient bands without it.
    float n = hash12(gl_FragCoord.xy) + hash12(gl_FragCoord.xy + 17.17) - 1.0;
    gl_FragColor.rgb += n * uDither;
  }
`
