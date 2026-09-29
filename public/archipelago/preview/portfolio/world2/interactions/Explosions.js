import * as THREE from 'three';
import { clamp } from '../../world/core/maths.js';
/* ============================================================
   PORTED FROM: sources/Game/Explosions.js + World/Fireballs.js
   folio-2025 — Copyright (c) 2025 Bruno Simon — MIT
   See THIRD_PARTY_NOTICES.md.

   The physical half is upstream's, formula for formula: a
   horizontal direction away from the blast, forced upwards, faded
   linearly from 1 m to the blast radius, scaled by the receiving
   body's own mass so a fence panel and a crate leave at the same
   speed.

   The visual half is rewritten. Upstream's fireball is a TSL node
   material sampling a perlin texture in three planar projections;
   this renderer is WebGL, so the same idea is done with hashed
   value noise in GLSL and no texture at all. Everything is pooled:
   one fireball mesh, one smoke sprite buffer and one debris
   instanced mesh per pool slot, reused for the life of the route.
   ============================================================ */
const FIREBALL_VERTEX = `
varying vec3 vPosition;
varying vec3 vNormal;
varying float vLocalY;
void main() {
  vPosition = position;
  vNormal = normal;
  vLocalY = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/*
  Triplanar value noise. Upstream samples one perlin texture three
  times and blends by |normal|; the same blend is kept, with the
  texture replaced by a hashed lattice so nothing has to be loaded.
*/
const FIREBALL_FRAGMENT = `
uniform float progress;
uniform vec3 colorA;
uniform vec3 colorB;
varying vec3 vPosition;
varying vec3 vNormal;
varying float vLocalY;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float remap(float v, float a, float b) { return clamp((v - a) / (b - a), 0.0, 1.0); }

/* Two octaves, blended by |normal| the way upstream blends its three
   planar perlin samples. One octave leaves a smooth ball; the second is
   what breaks the silhouette into lumps of flame. */
float triplanar(vec3 p, vec3 blending, float frequency, float offset) {
  return noise(p.yz * frequency + offset) * blending.x
       + noise(p.xz * frequency + offset + 0.8) * blending.y
       + noise(p.xy * frequency + offset + 1.6) * blending.z;
}

void main() {
  vec3 blending = abs(normalize(vNormal));
  blending /= (blending.x + blending.y + blending.z);
  float n = triplanar(vPosition, blending, 5.0, 0.0) * 0.65
          + triplanar(vPosition, blending, 12.0, 3.7) * 0.35;
  n = remap(n, 0.25, 0.8);
  // Ground attenuation, as upstream: the flame does not hang below the
  // blast. Local sphere Y, so it holds as the ball grows to full radius.
  n *= smoothstep(-0.52, -0.18, vLocalY);
  n -= progress;
  if (n < 0.0) discard;
  vec3 emissive = mix(colorB, colorA, clamp(n * 2.2, 0.0, 1.0));
  float core = step(n, 0.06);
  gl_FragColor = vec4(mix(emissive, vec3(0.07, 0.05, 0.05), core), 1.0);
}
`;
const SMOKE_VERTEX = `
attribute float size;
attribute float alpha;
varying float vAlpha;
void main() {
  vAlpha = alpha;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * (300.0 / -view.z);
  gl_Position = projectionMatrix * view;
}
`;
const SMOKE_FRAGMENT = `
uniform vec3 color;
varying float vAlpha;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = dot(p, p);
  if (d > 0.25) discard;
  gl_FragColor = vec4(color, vAlpha * pow(1.0 - d * 4.0, 1.6) * 0.42);
}
`;
const SMOKE_PUFFS = 320;
const DEBRIS_PER_BLAST = 14;
export class Explosions {
    physics;
    ticker;
    view;
    bin;
    chassis;
    onBlast;
    group = new THREE.Group();
    fireballs = [];
    debris = [];
    smoke;
    smokeLife = new Float32Array(SMOKE_PUFFS);
    smokeVelocity = new Float32Array(SMOKE_PUFFS * 3);
    smokeCursor = 0;
    /** Live smoke puffs. The per-slot walk below is skipped when this is 0. */
    smokeAlive = 0;
    flash;
    flashLife = 0;
    sphere = new THREE.SphereGeometry(0.5, 12, 8);
    shard = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    shardMaterial;
    scratch = new THREE.Vector3();
    matrix = new THREE.Matrix4();
    quaternion = new THREE.Quaternion();
    euler = new THREE.Euler();
    one = new THREE.Vector3(1, 1, 1);
    /** Bodies the blast should never shove — the ones a mini-game owns. */
    protectedBodies = new Set();
    constructor(physics, ticker, view, bin, 
    /** The car's own body, so a blast can report that it caught the player. */
    chassis, onBlast) {
        this.physics = physics;
        this.ticker = ticker;
        this.view = view;
        this.bin = bin;
        this.chassis = chassis;
        this.onBlast = onBlast;
        this.group.name = 'World2 / explosions';
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SMOKE_PUFFS * 3), 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(new Float32Array(SMOKE_PUFFS), 1));
        geometry.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(SMOKE_PUFFS), 1));
        this.smoke = new THREE.Points(geometry, new THREE.ShaderMaterial({
            transparent: true, depthWrite: false,
            uniforms: { color: { value: new THREE.Color('#4a4048') } },
            vertexShader: SMOKE_VERTEX, fragmentShader: SMOKE_FRAGMENT,
        }));
        this.smoke.frustumCulled = false;
        this.smoke.visible = false;
        this.group.add(this.smoke);
        this.shardMaterial = new THREE.MeshStandardMaterial({ color: '#7a5230', roughness: 0.9, metalness: 0 });
        this.flash = new THREE.PointLight('#ffb066', 0, 18, 2);
        this.flash.visible = false;
        this.group.add(this.flash);
        const tick = () => this.update();
        ticker.events.on('tick', tick, 12);
        bin.add(() => {
            ticker.events.off('tick', tick);
            this.sphere.dispose();
            this.shard.dispose();
            this.shardMaterial.dispose();
            geometry.dispose();
            this.smoke.material.dispose();
            for (const item of this.fireballs)
                item.mesh.material.dispose();
            for (const item of this.debris)
                item.mesh.dispose();
        });
        bin.object3D(this.group);
    }
    /**
     * Upstream's impulse, unchanged: horizontal away-vector forced to
     * 45° up, faded 1 → 0 between 1 m and `radius`, scaled by mass.
     * Returns true when the vehicle itself caught the edge of it.
     */
    explode(at, radius = 5, strength = 8) {
        const distanceToCamera = this.view.focusPoint.position.distanceTo(at);
        this.view.kick(clamp(1 - (distanceToCamera - 2) / 13, 0, 1));
        this.onBlast(at, strength);
        let vehicleHit = false;
        for (const physical of this.physics.physicals) {
            if (physical.type !== 'dynamic' || !physical.body.isEnabled())
                continue;
            if (this.protectedBodies.has(physical))
                continue;
            const position = physical.body.translation();
            const direction = this.scratch.set(position.x - at.x, 0, position.z - at.z);
            const distance = direction.length();
            const faded = clamp(1 - (distance - 1) / Math.max(radius - 1, 0.001), 0, 1);
            if (faded <= 0)
                continue;
            if (distance < 0.001)
                direction.set(Math.random() - 0.5, 0, Math.random() - 0.5);
            direction.setLength(0.5);
            direction.y = 1;
            direction.normalize().multiplyScalar(faded * strength * physical.body.mass());
            physical.body.applyImpulse(direction, true);
            if (physical === this.chassis)
                vehicleHit = true;
        }
        this.spawnFireball(at, radius);
        this.spawnSmoke(at, radius);
        this.spawnDebris(at);
        this.flash.position.copy(at).y += 0.6;
        this.flash.intensity = 26;
        this.flash.visible = true;
        this.flashLife = 0.22;
        return vehicleHit;
    }
    spawnFireball(at, radius) {
        let item = this.fireballs.find(f => f.life <= 0);
        if (!item) {
            const mesh = new THREE.Mesh(this.sphere, new THREE.ShaderMaterial({
                uniforms: { progress: { value: 0 }, colorA: { value: new THREE.Color('#ff2d0e') }, colorB: { value: new THREE.Color('#ff9d2f') } },
                vertexShader: FIREBALL_VERTEX, fragmentShader: FIREBALL_FRAGMENT,
            }));
            mesh.frustumCulled = false;
            item = { mesh, life: 0, radius };
            this.fireballs.push(item);
            this.group.add(mesh);
        }
        item.radius = radius;
        item.life = 2.25;
        item.mesh.visible = true;
        item.mesh.position.copy(at);
        item.mesh.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, 0);
        item.mesh.scale.setScalar(0.5);
        item.mesh.material.uniforms.progress.value = 0.15;
    }
    spawnSmoke(at, radius) {
        const positions = this.smoke.geometry.getAttribute('position');
        const sizes = this.smoke.geometry.getAttribute('size');
        const alphas = this.smoke.geometry.getAttribute('alpha');
        for (let i = 0; i < 26; i++) {
            const index = this.smokeCursor;
            this.smokeCursor = (this.smokeCursor + 1) % SMOKE_PUFFS;
            const angle = Math.random() * Math.PI * 2;
            const spread = Math.random() * radius * 0.35;
            positions.setXYZ(index, at.x + Math.cos(angle) * spread, at.y + Math.random() * 0.6, at.z + Math.sin(angle) * spread);
            this.smokeVelocity[index * 3] = Math.cos(angle) * (0.6 + Math.random());
            this.smokeVelocity[index * 3 + 1] = 1 + Math.random() * 1.4;
            this.smokeVelocity[index * 3 + 2] = Math.sin(angle) * (0.6 + Math.random());
            sizes.setX(index, 7 + Math.random() * 9);
            alphas.setX(index, 1);
            if (this.smokeLife[index] <= 0)
                this.smokeAlive++;
            this.smoke.visible = true;
            this.smokeLife[index] = 1.4 + Math.random() * 0.8;
        }
        positions.needsUpdate = true;
        sizes.needsUpdate = true;
        alphas.needsUpdate = true;
    }
    spawnDebris(at) {
        let item = this.debris.find(d => d.life <= 0);
        if (!item) {
            const mesh = new THREE.InstancedMesh(this.shard, this.shardMaterial, DEBRIS_PER_BLAST);
            mesh.frustumCulled = false;
            mesh.castShadow = true;
            item = {
                mesh, life: 0,
                velocities: Array.from({ length: DEBRIS_PER_BLAST }, () => new THREE.Vector3()),
                positions: Array.from({ length: DEBRIS_PER_BLAST }, () => new THREE.Vector3()),
                spins: Array.from({ length: DEBRIS_PER_BLAST }, () => new THREE.Vector3()),
                ground: 0,
            };
            this.debris.push(item);
            this.group.add(mesh);
        }
        item.life = 2;
        item.ground = at.y;
        item.mesh.visible = true;
        for (let i = 0; i < DEBRIS_PER_BLAST; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 3 + Math.random() * 5;
            item.positions[i].set(at.x, at.y + 0.3, at.z);
            item.velocities[i].set(Math.cos(angle) * speed * 0.6, 3 + Math.random() * 4, Math.sin(angle) * speed * 0.6);
            item.spins[i].set(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4);
        }
    }
    update() {
        const delta = this.ticker.delta * this.ticker.scale;
        if (delta <= 0)
            return;
        // Nothing burning, nothing to do. This ran 320 smoke slots and every
        // debris pool on a quiet frame, which is most of them.
        if (!this.smokeAlive && this.flashLife <= 0
            && !this.fireballs.some(item => item.life > 0)
            && !this.debris.some(item => item.life > 0))
            return;
        for (const item of this.fireballs) {
            if (item.life <= 0)
                continue;
            item.life -= delta;
            const age = 2.25 - item.life;
            // Upstream: scale 0.5 → radius over 0.6 s on power3.out; dissolve
            // 0.15 → 1 over 2 s starting at 0.25 s.
            const grow = clamp(age / 0.6, 0, 1);
            item.mesh.scale.setScalar(0.5 + (item.radius - 0.5) * (1 - Math.pow(1 - grow, 3)));
            item.mesh.rotation.z = -clamp(age / 2.25, 0, 1);
            item.mesh.material.uniforms.progress.value = 0.02 + 0.98 * clamp((age - 0.2) / 1.6, 0, 1);
            if (item.life <= 0)
                item.mesh.visible = false;
        }
        const positions = this.smoke.geometry.getAttribute('position');
        const alphas = this.smoke.geometry.getAttribute('alpha');
        let smokeDirty = false;
        for (let i = 0; this.smokeAlive > 0 && i < SMOKE_PUFFS; i++) {
            if (this.smokeLife[i] <= 0)
                continue;
            this.smokeLife[i] -= delta;
            if (this.smokeLife[i] <= 0)
                this.smokeAlive--;
            smokeDirty = true;
            const drag = Math.max(0, 1 - delta * 1.6);
            this.smokeVelocity[i * 3] *= drag;
            this.smokeVelocity[i * 3 + 2] *= drag;
            this.smokeVelocity[i * 3 + 1] = this.smokeVelocity[i * 3 + 1] * drag + 0.4 * delta;
            positions.setXYZ(i, positions.getX(i) + this.smokeVelocity[i * 3] * delta, positions.getY(i) + this.smokeVelocity[i * 3 + 1] * delta, positions.getZ(i) + this.smokeVelocity[i * 3 + 2] * delta);
            alphas.setX(i, Math.max(0, this.smokeLife[i] / 2.2));
        }
        if (smokeDirty) {
            positions.needsUpdate = true;
            alphas.needsUpdate = true;
        }
        if (!this.smokeAlive)
            this.smoke.visible = false;
        for (const item of this.debris) {
            if (item.life <= 0)
                continue;
            item.life -= delta;
            for (let i = 0; i < DEBRIS_PER_BLAST; i++) {
                const velocity = item.velocities[i], position = item.positions[i];
                velocity.y -= 18 * delta;
                position.addScaledVector(velocity, delta);
                if (position.y < item.ground + 0.08) {
                    position.y = item.ground + 0.08;
                    velocity.y = Math.abs(velocity.y) * 0.25;
                    velocity.x *= 0.6;
                    velocity.z *= 0.6;
                }
                this.euler.set(item.spins[i].x * (2 - item.life), item.spins[i].y * (2 - item.life), item.spins[i].z * (2 - item.life));
                this.quaternion.setFromEuler(this.euler);
                const fade = clamp(item.life, 0, 1);
                this.matrix.compose(position, this.quaternion, this.scratch.copy(this.one).multiplyScalar(fade));
                item.mesh.setMatrixAt(i, this.matrix);
            }
            item.mesh.instanceMatrix.needsUpdate = true;
            if (item.life <= 0)
                item.mesh.visible = false;
        }
        if (this.flashLife > 0) {
            this.flashLife -= delta;
            this.flash.intensity = Math.max(0, this.flashLife / 0.22) * 26;
            if (this.flashLife <= 0) {
                this.flash.visible = false;
                this.flash.intensity = 0;
            }
        }
    }
    /** Drops every live effect — used on world reset so nothing lingers. */
    clear() {
        for (const item of this.fireballs) {
            item.life = 0;
            item.mesh.visible = false;
        }
        for (const item of this.debris) {
            item.life = 0;
            item.mesh.visible = false;
        }
        this.smokeLife.fill(0);
        this.smokeAlive = 0;
        this.smoke.visible = false;
        const alphas = this.smoke.geometry.getAttribute('alpha');
        for (let i = 0; i < SMOKE_PUFFS; i++)
            alphas.setX(i, 0);
        alphas.needsUpdate = true;
        this.flashLife = 0;
        this.flash.visible = false;
        this.flash.intensity = 0;
    }
}
