/* ============================================================
   THE CORE — surface shader
   A matte, machined shell with a crisp rim, a travelling seam
   of light and a darkness uniform that inverts the object's
   relationship to the world as the story moves light → dark.
   ============================================================ */

export const coreVertex = /* glsl */ `
  uniform float uTime;
  uniform float uMorph;      // 0..1 : how far the shell has deformed
  uniform float uEnergy;     // 0..1 : scroll velocity energy
  uniform float uShatter;    // 0..1 : dissolve into fragments

  varying vec3 vNormal;
  varying vec3 vViewPos;
  varying vec3 vWorldPos;
  varying vec3 vObjPos;
  varying float vSeam;

  // Simplex-ish cheap 3D noise
  vec3 hash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
             dot(p, vec3(269.5, 183.3, 246.1)),
             dot(p, vec3(113.5, 271.9, 124.6)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }

  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(dot(hash3(i + vec3(0,0,0)), f - vec3(0,0,0)),
                       dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                   mix(dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0)),
                       dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
               mix(mix(dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1)),
                       dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                   mix(dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1)),
                       dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);
  }

  void main() {
    vec3 pos = position;

    // Breathing deformation — always alive, never noisy.
    float n = noise(position * 1.9 + vec3(0.0, uTime * 0.16, 0.0));
    pos += normal * n * (0.012 + uMorph * 0.06 + uEnergy * 0.04);

    // Shatter: push faces outward along their normal, non-uniformly.
    float shard = noise(floor(position * 5.0) * 1.37);
    pos += normal * uShatter * (0.35 + shard * 0.9);

    vObjPos = position;
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vViewPos = -mv.xyz;
    vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;

    // Seam: a narrow index line that travels the length of the body.
    vSeam = position.y * 0.6 + uTime * 0.07;

    gl_Position = projectionMatrix * mv;
  }
`

export const coreFragment = /* glsl */ `
  uniform float uTime;
  uniform float uDarkness;   // 0 = light world, 1 = dark world
  uniform float uEnergy;
  uniform float uShatter;
  uniform vec3  uAccent;
  uniform float uOpacity;

  varying vec3 vNormal;
  varying vec3 vViewPos;
  varying vec3 vWorldPos;
  varying vec3 vObjPos;
  varying float vSeam;

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(vViewPos);

    // Two-light studio: key from upper-right, cool fill from lower-left.
    vec3 keyDir  = normalize(vec3(0.62, 0.78, 0.55));
    vec3 fillDir = normalize(vec3(-0.7, -0.35, 0.4));
    float key  = max(dot(N, keyDir), 0.0);
    float fill = max(dot(N, fillDir), 0.0);

    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.4);

    // Body colour flips with the world: graphite on paper, chalk in the void.
    vec3 lightBody = vec3(0.115, 0.115, 0.125);
    vec3 darkBody  = vec3(0.80, 0.80, 0.82);
    vec3 body = mix(lightBody, darkBody, uDarkness);

    vec3 col = body;
    col += key * mix(vec3(0.30, 0.30, 0.33), vec3(0.22, 0.22, 0.24), uDarkness);
    col += fill * mix(vec3(0.07, 0.08, 0.10), vec3(0.10, 0.11, 0.14), uDarkness);

    // No lathe lines: at this object's on-screen size any repeating
    // band aliases into moiré. The form carries itself.

    // Equatorial aperture: one deliberate groove that gives the
    // silhouette a reading direction.
    float groove = 1.0 - smoothstep(0.004, 0.026, abs(vObjPos.y + 0.06));
    col = mix(col, col * (0.62 + uDarkness * 0.2), groove);
    col += groove * uAccent * (0.06 + uEnergy * 0.35);

    // Shoulders: darken the extreme poles so the form reads as
    // machined rather than inflated.
    float pole = smoothstep(0.42, 0.78, abs(vObjPos.y));
    col *= 1.0 - pole * 0.16 * (1.0 - uDarkness * 0.5);

    // Rim
    vec3 rim = mix(vec3(0.55, 0.55, 0.58), vec3(1.0), uDarkness);
    col += fresnel * rim * (0.55 + uDarkness * 0.5);

    // Travelling index line — one hairline of accent, not a stripe.
    float band = abs(fract(vSeam) - 0.5) * 2.0;
    float seam = 1.0 - smoothstep(0.0, 0.055, band);
    col = mix(col, uAccent, seam * (0.30 + uEnergy * 0.45));

    // Shatter glows at the fracture
    col = mix(col, uAccent, uShatter * 0.35 * fresnel);

    gl_FragColor = vec4(col, uOpacity);
  }
`

export const coreUniforms = () => ({
  uTime: { value: 0 },
  uMorph: { value: 0 },
  uEnergy: { value: 0 },
  uShatter: { value: 0 },
  uDarkness: { value: 0 },
  uAccent: { value: [0.831, 0.286, 0.122] },
  uOpacity: { value: 1 },
})
