/* ============================================================
   THE FIELD — the ground the journey travels across.
   A fine measured grid drawn on the page: one material, one
   draw, no second world to switch to.
   ============================================================ */

export const fieldVertex = /* glsl */ `
  uniform float uTime;
  uniform float uAmp;
  varying vec2 vUv;
  varying vec3 vPos;

  void main() {
    vUv = uv;
    vec3 p = position;
    float d = length(p.xy);
    p.z += sin(d * 0.55 - uTime * 0.5) * uAmp * smoothstep(0.0, 30.0, d);
    vPos = p;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

export const fieldFragment = /* glsl */ `
  uniform float uTime;
  uniform float uFade;
  uniform vec3  uAccent;
  uniform float uProgress;
  varying vec2 vUv;
  varying vec3 vPos;

  float grid(vec2 p, float scale, float width) {
    vec2 g = abs(fract(p * scale - 0.5) - 0.5) / fwidth(p * scale);
    float line = min(g.x, g.y);
    return 1.0 - min(line / width, 1.0);
  }

  void main() {
    float d = length(vPos.xy);
    // A short horizon: the ground should suggest a room, not tile
    // the whole frame. Everything past ~26 units is gone.
    float horizon = 1.0 - smoothstep(6.0, 26.0, d);

    float fine  = grid(vPos.xy, 0.5, 1.0);
    float major = grid(vPos.xy, 0.1, 1.3);

    // One value, and a low one: the page is white, so every line in
    // this scene is graphite subtracting from it. The alphas below do
    // the rest of the work — a paler ink at a higher alpha reads as
    // fog, and this has to read as ruling.
    vec3 lineCol = vec3(0.04);
    float a = (fine * 0.022 + major * 0.075) * horizon * uFade;

    // The timeline spine — the path the journey travels. Present, but
    // a hairline, not a highway.
    float spine = 1.0 - smoothstep(0.02, 0.10, abs(vPos.y));
    a += spine * horizon * 0.12 * uFade;

    // The travelled portion carries the accent.
    float travelled = step(vPos.x, mix(-40.0, 40.0, uProgress));
    vec3 col = mix(lineCol, uAccent, spine * travelled * 0.7);

    if (a < 0.0025) discard;
    gl_FragColor = vec4(col, a);
  }
`
