import * as THREE from 'three';
import { Screen } from './Screen.js';
import { orientForMesh } from './bindCanvas.js';
const CHECK_RADIUS = 2;
const COUNTDOWN_BEAT = 1;
const STORAGE = 'helloworld-world2-circuit-v1';
/*
  The authored gantry cuts THREE lamp holes in its beam, and
  `refStartingLights` is the plate that sits behind them — so the housing
  already provides the lamp shape and this only has to fill it. Three cells
  across the plate's own U, lit one at a time through the count, all three
  green on GO. Upstream gets the same effect by sliding the plate behind the
  beam; filling it is the same picture without moving authored geometry.
*/
const LIGHTS_VERTEX = `
uniform float minX;
uniform float spanX;
varying float vAcross;
void main() {
  // The plate's own UVs run diagonally, so the lamp cells are taken from
  // geometry instead: where this vertex sits along the plate's width.
  vAcross = (position.x - minX) / spanX;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const LIGHTS_FRAGMENT = `
uniform float lit;
uniform float go;
varying float vAcross;
void main() {
  float cell = floor(clamp(vAcross, 0.0, 0.999) * 3.0);
  float on = go > 0.5 ? 1.0 : step(cell + 0.5, lit);
  vec3 bulb = go > 0.5 ? vec3(0.18, 0.95, 0.48) : vec3(1.0, 0.22, 0.16);
  // Unlit lamps stay dark rather than disappearing: a gantry with three
  // empty holes reads as broken, one with three dim lenses reads as waiting.
  gl_FragColor = vec4(mix(bulb * 0.09, bulb * 1.8, on), 1.0);
}
`;
const GATE_VERTEX = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
/** Upstream's scrolling chevrons: fract(x + y) banding, scrolled in V. */
const GATE_FRAGMENT = `
uniform vec3 color;
uniform float time;
uniform float repeat;
varying vec2 vUv;
void main() {
  vec2 uv = vec2(vUv.x * repeat, vUv.y - time * 0.2) * 2.0;
  float stripes = fract(uv.x + uv.y);
  float band = step(0.5, stripes);
  float fade = 1.0 - abs(vUv.y - 0.5) * 1.2;
  gl_FragColor = vec4(color, (0.25 + band * 0.45) * fade);
}
`;
/** Upstream's own segment-circle test, used unchanged for gate crossings. */
function segmentCrossesCircle(a, b, centre, radius) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const fx = a.x - centre.x, fy = a.y - centre.y;
    const A = dx * dx + dy * dy;
    const B = 2 * (fx * dx + fy * dy);
    const C = fx * fx + fy * fy - radius * radius;
    let discriminant = B * B - 4 * A * C;
    if (discriminant < 0)
        return false;
    discriminant = Math.sqrt(discriminant);
    const t1 = (-B - discriminant) / (2 * A);
    const t2 = (-B + discriminant) / (2 * A);
    return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1);
}
/**
 * MM:SS:MMM, the format on upstream's board.
 *
 * Rounded to whole milliseconds FIRST, then split. Rounding the fractional
 * part on its own can hand back 1000 — 4.9996 s printed as `00:04:1000`.
 */
export function formatLap(seconds) {
    const total = Math.max(0, Math.round(seconds * 1000));
    const minutes = Math.floor(total / 60000);
    const rest = Math.floor((total % 60000) / 1000);
    const millis = total % 1000;
    return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}:${String(millis).padStart(3, '0')}`;
}
export class Circuit {
    game;
    references;
    state = 'pending';
    gates = [];
    group = new THREE.Group();
    records = [];
    elapsed = 0;
    lastTime = null;
    bestBefore = null;
    targetIndex = 0;
    reached = 0;
    lastGate = null;
    running = false;
    countdownLeft = 0;
    countdownBeat = 0;
    /** Seconds the GO flash stays up after the lights turn green. */
    goFor = 0;
    doorTarget;
    doorReached;
    clock;
    board;
    lights;
    lightsMaterial;
    rails;
    railsNode;
    obstacles = [];
    prompt = null;
    podium = [];
    podiumBodies = [];
    fallLatched = false;
    floor;
    clockHome = new THREE.Vector3();
    constructor(game, references, bin) {
        this.game = game;
        this.references = references;
        this.group.name = 'World2 / circuit';
        const data = references.interactions.checkpoints;
        const euler = new THREE.Euler();
        data.forEach((raw, index) => {
            const position = new THREE.Vector3(...raw.position);
            const quaternion = new THREE.Quaternion(...raw.quaternion);
            euler.setFromQuaternion(quaternion, 'YXZ');
            const rotation = euler.y;
            // Upstream builds the gate line from -rotation, then offsets the
            // respawn by (3, 0) rotated by +rotation. Both are reproduced exactly.
            const half = Math.abs(raw.scale[0]) * 0.5;
            const direction = new THREE.Vector2(Math.cos(-rotation), Math.sin(-rotation));
            this.gates.push({
                name: raw.name, index,
                a: new THREE.Vector2(position.x - direction.x * half, position.z - direction.y * half),
                b: new THREE.Vector2(position.x + direction.x * half, position.z + direction.y * half),
                position, rotation,
                respawn: new THREE.Vector3(position.x + Math.sin(rotation) * 3, position.y + 3, position.z + Math.cos(rotation) * 3),
                heading: rotation + Math.PI * 0.5,
            });
        });
        this.floor = Math.min(...this.gates.map(gate => gate.position.y)) - 2.5;
        const gateGeometry = new THREE.PlaneGeometry(1, 1);
        const makeDoor = (color) => {
            const mesh = new THREE.Mesh(gateGeometry, new THREE.ShaderMaterial({
                transparent: true, side: THREE.DoubleSide, depthWrite: false,
                uniforms: { color: { value: new THREE.Color(color) }, time: { value: 0 }, repeat: { value: 6 } },
                vertexShader: GATE_VERTEX, fragmentShader: GATE_FRAGMENT,
            }));
            mesh.visible = false;
            this.group.add(mesh);
            return mesh;
        };
        this.doorTarget = makeDoor('#32ffc1');
        this.doorReached = makeDoor('#cbff62');
        /*
          Upstream's lap clock is a board that rides beside the car. Ours is not:
          at 4.2 m wide, a metre from a chase camera and billboarded, it read as
          the camera zooming in on the car — and it said the same thing the HUD
          already says. The clock lives in the HUD; this board stays parked at
          the authored `refTimer` and shows the last lap.
        */
        const timer = references.transform('refTimer');
        this.clock = new Screen({ width: 512, height: 96, worldWidth: 2.6, emissive: 0.8 });
        if (timer) {
            this.clock.group.position.copy(timer.position);
            this.clockHome.copy(timer.position);
            this.clock.group.quaternion.copy(timer.quaternion);
        }
        this.group.add(this.clock.group);
        /*
          The board is the authored `refLeaderboard` surface itself — a 5 x 5
          plane lying in its own YZ plane. A Screen of our own carried its own
          XY quad, so copying that transform stood the panel on its side and
          pushed it through the 3D sign behind it. Now only the material moves.
        */
        const leaderboard = references.node('refLeaderboard');
        this.board = new Screen({ width: 512, height: 512, worldWidth: 1, emissive: 0.5 });
        if (leaderboard instanceof THREE.Mesh) {
            orientForMesh(this.board.texture, leaderboard, game.player.position);
            leaderboard.material = this.board.mesh.material;
        }
        else {
            this.board.group.position.copy(references.position('refLeaderboard') ?? new THREE.Vector3());
            this.group.add(this.board.group);
        }
        const lights = references.node('refStartingLights');
        this.lights = lights instanceof THREE.Mesh ? lights : null;
        if (this.lights) {
            this.lights.geometry.computeBoundingBox();
            const box = this.lights.geometry.boundingBox;
            this.lightsMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    lit: { value: 0 }, go: { value: 0 },
                    minX: { value: box.min.x }, spanX: { value: Math.max(box.max.x - box.min.x, 1e-4) },
                },
                vertexShader: LIGHTS_VERTEX,
                fragmentShader: LIGHTS_FRAGMENT,
                side: THREE.DoubleSide,
            });
            this.lights.material = this.lightsMaterial;
            /*
              The plate is authored just behind the beam that carries the three lamp
              holes, and our exporter makes every material double-sided — so the
              beam's own back face filled the holes and the lamps never showed.
              Upstream slides this same plate along Z to work its lights; sliding it
              0.12 m toward the drivers seats it in the holes. Nothing else moves.
            */
            this.lights.position.z += 0.12;
        }
        else
            this.lightsMaterial = null;
        /*
          The podium is gone. It stands beside the grid, on the racing line, and
          it is scenery for a ceremony this world does not hold — there is no
          third place to put anyone on. Hidden and unbodied for good, rather than
          toggled: a wall you only hit sometimes is worse than one you never do.
        */
        this.podium = references.series('refPodiumPhysicalFixed').concat(['refPodiumConfettiA', 'refPodiumConfettiB'].map(name => references.node(name)).filter((n) => !!n));
        this.podiumBodies = this.podium.map(node => references.environment.physicals.get(node)).filter((p) => !!p);
        this.setPodium(false);
        this.railsNode = references.node('refRailsPhysicalFixed');
        this.rails = references.physical('refRailsPhysicalFixed');
        /*
          The rails are a race guard for the CAR, not world geometry. The level
          builds them in the `floor` category, whose membership includes the
          `terrain` group — the same group the camera's obstruction ray queries.
          So the moment a race put them up, the camera found a 20 m wall a few
          metres away and pulled itself in from 21 m to 12: the "zoom" that
          appeared at the start of every race and again at every corner.
    
          Moving them to `object` keeps them solid to the chassis and to every
          prop, and takes them out of the camera's query entirely.
        */
        for (const collider of this.rails?.colliders ?? [])
            collider.setCollisionGroups(game.physics.categories.object);
        this.setRails(false);
        for (const node of references.series('refObstaclesPhysicalKinematicPositionBased')) {
            const built = references.environment.collidersFor(node);
            if (!built.colliders.length)
                continue;
            const physical = game.physics.add({
                type: 'kinematicPositionBased', position: built.position, rotation: built.quaternion,
                colliders: built.colliders, category: 'floor', friction: 0.7, restitution: 0.02,
                owner: node.userData.w2Source ?? node.name,
            });
            references.environment.group.attach(node);
            this.obstacles.push({ physical, node, home: built.position.clone(), phase: -this.obstacles.length });
        }
        this.load();
        this.drawBoard();
        this.drawClock();
        const tick = () => this.update();
        game.ticker.events.on('tick', tick, 11);
        bin.add(() => {
            game.ticker.events.off('tick', tick);
            gateGeometry.dispose();
            this.doorTarget.material.dispose();
            this.doorReached.material.dispose();
            this.clock.destroy();
            this.board.destroy();
            this.lightsMaterial?.dispose();
        });
        bin.object3D(this.group);
    }
    attachPrompt(prompt) { this.prompt = prompt; }
    /** Takes the podium out of the world, geometry and collider alike. */
    setPodium(visible) {
        for (const node of this.podium)
            node.visible = visible;
        for (const body of this.podiumBodies)
            body.body.setEnabled(visible);
    }
    setRails(active) {
        this.rails?.body.setEnabled(active);
        // Blender marks the rails hide_render, and upstream never draws them:
        // they are a guard rail you feel, not a wall you look at.
        if (this.railsNode)
            this.railsNode.visible = false;
    }
    load() {
        try {
            const raw = JSON.parse(localStorage.getItem(STORAGE) ?? 'null');
            if (Array.isArray(raw?.records)) {
                this.records = raw.records
                    .filter((r) => !!r && typeof r.time === 'number')
                    .slice(0, 10);
            }
        }
        catch { /* Private mode simply starts with an empty board. */ }
    }
    save() {
        try {
            localStorage.setItem(STORAGE, JSON.stringify({ records: this.records }));
        }
        catch { /* Private mode. */ }
    }
    get best() { return this.records.length ? this.records[0].time : null; }
    clearRecords() { this.records = []; this.save(); this.drawBoard(); }
    drawBoard() {
        this.board.draw(context => {
            const { width } = this.board;
            context.fillStyle = '#231f2b';
            context.fillRect(0, 0, width, width);
            context.fillStyle = '#cbff62';
            context.font = '700 38px ui-sans-serif, system-ui, sans-serif';
            context.textAlign = 'center';
            context.fillText('BEST LAPS', width / 2, 56);
            context.font = '600 26px ui-monospace, SFMono-Regular, monospace';
            context.fillStyle = '#8f8aa0';
            context.fillText('THIS BROWSER · TOP 10', width / 2, 90);
            if (!this.records.length) {
                context.fillStyle = '#6d6880';
                context.font = '600 28px ui-sans-serif, system-ui, sans-serif';
                context.fillText('No laps yet.', width / 2, 250);
                context.fillText('Drive one.', width / 2, 290);
                return;
            }
            context.font = '700 30px ui-monospace, SFMono-Regular, monospace';
            this.records.slice(0, 10).forEach((record, i) => {
                const y = 150 + i * 36;
                context.textAlign = 'left';
                context.fillStyle = i === 0 ? '#32ffc1' : '#f2eee6';
                context.fillText(String(i + 1).padStart(2, '0'), 60, y);
                context.textAlign = 'right';
                context.fillText(formatLap(record.time), width - 60, y);
            });
        });
    }
    drawClock() {
        const label = this.state === 'running' || this.state === 'ending' ? formatLap(this.elapsed) : formatLap(this.lastTime ?? 0);
        this.clock.draw(context => {
            context.fillStyle = '#17141d';
            context.fillRect(0, 0, this.clock.width, this.clock.height);
            context.fillStyle = this.state === 'running' ? '#32ffc1' : '#f2eee6';
            context.font = '700 62px ui-monospace, SFMono-Regular, monospace';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(label, this.clock.width / 2, this.clock.height / 2 + 2);
        });
    }
    /** The trackside prompt, R while racing, and the HUD button all land here. */
    restart() {
        if (this.state === 'starting' || this.state === 'countdown')
            return;
        this.state = 'starting';
        this.prompt?.hide();
        this.setRails(true);
        this.game.interactions.prompts.setSuspended(true);
        this.game.player.setState('locked');
        this.elapsed = 0;
        this.reached = 0;
        this.targetIndex = 0;
        this.lastGate = null;
        this.fallLatched = false;
        this.running = false;
        const start = this.references.transform('refStart');
        if (start) {
            // The authored grid empty's own yaw points across the track, so the
            // heading comes from the geometry that cannot be ambiguous: the line
            // from the grid to the first gate.
            const gate = this.gates[0];
            const heading = Math.atan2(-(gate.position.z - start.position.z), gate.position.x - start.position.x);
            this.game.vehicle.moveTo({ x: start.position.x, y: start.position.y + 1.4, z: start.position.z }, heading);
        }
        this.game.interactions.resetProps();
        this.showDoors();
        this.drawClock();
        this.countdownBeat = 3;
        this.countdownLeft = COUNTDOWN_BEAT;
        // The first lamp lights with the first beat, not a second after it.
        this.setLights(1, false);
        this.game.audio.play('note', 0.7);
        this.state = 'countdown';
        this.publish();
    }
    beginRace() {
        this.state = 'running';
        this.running = true;
        this.elapsed = 0;
        this.goFor = 0.9;
        this.game.audio.play('note', 1.6);
        this.game.player.setState('default');
        this.setLights(3, true);
        this.publish();
    }
    /** `lit` lamps red during the count; `go` turns the whole bar green. */
    setLights(lit, go) {
        if (!this.lightsMaterial)
            return;
        this.lightsMaterial.uniforms.lit.value = lit;
        this.lightsMaterial.uniforms.go.value = go ? 1 : 0;
    }
    showDoors() {
        const target = this.gates[this.targetIndex];
        this.place(this.doorTarget, target);
        this.doorTarget.visible = true;
        if (this.lastGate) {
            this.place(this.doorReached, this.lastGate);
            this.doorReached.visible = true;
        }
        else
            this.doorReached.visible = false;
    }
    place(mesh, gate) {
        const width = gate.a.distanceTo(gate.b);
        mesh.position.set(gate.position.x, gate.position.y + 0.4, gate.position.z);
        mesh.rotation.set(0, -gate.rotation, 0);
        mesh.scale.set(width, 2.6, 1);
        mesh.material.uniforms.repeat.value = width / 2.6;
    }
    /** Puts the car back through the last gate it actually crossed. */
    respawn() {
        if (this.state !== 'running')
            return false;
        const gate = this.lastGate ?? this.gates[0];
        this.game.vehicle.moveTo({ x: gate.respawn.x, y: gate.respawn.y, z: gate.respawn.z }, gate.heading);
        this.game.audio.play('fail');
        return true;
    }
    exit(forced = true) {
        if (this.state === 'pending')
            return;
        this.finish(forced);
    }
    finish(forced) {
        this.state = 'ending';
        this.running = false;
        this.doorTarget.visible = false;
        this.doorReached.visible = false;
        this.setRails(false);
        this.setLights(0, false);
        if (!forced) {
            this.lastTime = this.elapsed;
            this.bestBefore = this.best;
            this.records.push({ time: this.elapsed, at: Date.now() });
            this.records.sort((a, b) => a.time - b.time);
            this.records = this.records.slice(0, 10);
            this.save();
            this.drawBoard();
            this.game.audio.play('achievement');
            this.game.interactions.achievements.unlock('firstRace');
            if (this.elapsed < 60)
                this.game.interactions.achievements.unlock('fastLap');
        }
        this.drawClock();
        this.publish(true);
        this.game.tweens.delay(forced ? 0.4 : 0.8, () => {
            this.state = 'pending';
            this.game.player.setState('default');
            this.game.interactions.prompts.setSuspended(false);
            this.prompt?.show();
            this.publish(true);
        });
    }
    crossTarget() {
        const gate = this.gates[this.targetIndex];
        this.lastGate = gate;
        this.reached++;
        this.game.audio.play('blip', Math.min(2, 1 + (this.reached - 1) * 0.06));
        if (this.reached >= this.gates.length + 1) {
            this.finish(false);
            return;
        }
        this.targetIndex = this.reached % this.gates.length;
        this.showDoors();
        this.publish();
    }
    update() {
        const delta = this.game.ticker.delta * this.game.ticker.scale;
        const elapsedUniform = this.game.ticker.elapsed;
        this.doorTarget.material.uniforms.time.value = elapsedUniform;
        this.doorReached.material.uniforms.time.value = elapsedUniform;
        if (this.state === 'countdown') {
            this.countdownLeft -= delta;
            if (this.countdownLeft <= 0) {
                this.countdownBeat--;
                this.countdownLeft = COUNTDOWN_BEAT;
                if (this.countdownBeat <= 0)
                    this.beginRace();
                else {
                    // 3 → one lamp, 2 → two, 1 → three. All three go green on GO.
                    this.setLights(4 - this.countdownBeat, false);
                    this.game.audio.play('note', 0.7 + (4 - this.countdownBeat) * 0.12);
                }
                this.publish();
            }
            return;
        }
        if (this.state !== 'running')
            return;
        if (this.goFor > 0)
            this.goFor = Math.max(0, this.goFor - delta);
        if (this.running) {
            this.elapsed += delta;
            if (Math.floor(this.elapsed * 4) !== Math.floor((this.elapsed - delta) * 4))
                this.drawClock();
        }
        const player = this.game.player.position;
        const here = new THREE.Vector2(player.x, player.z);
        const target = this.gates[this.targetIndex];
        if (segmentCrossesCircle(target.a, target.b, here, CHECK_RADIUS))
            this.crossTarget();
        if (player.y < this.floor) {
            if (!this.fallLatched) {
                this.fallLatched = true;
                this.respawn();
            }
        }
        else
            this.fallLatched = false;
        // Hazards slide across the track, on the race clock so they freeze between runs.
        for (const obstacle of this.obstacles) {
            const offset = Math.sin(this.elapsed * 1.25 + obstacle.phase) * 5;
            const next = { x: obstacle.home.x, y: obstacle.home.y, z: obstacle.home.z + offset };
            obstacle.physical.body.setNextKinematicTranslation(next);
            obstacle.node.position.set(next.x, next.y, next.z);
        }
        this.publish();
    }
    publish(force = false) {
        this.game.publishGameplay(force);
    }
    /** What the HUD shows for the race, if anything. */
    hud() {
        if (this.state === 'pending')
            return { activity: null, headline: null, timer: null, lines: [] };
        if (this.state === 'countdown') {
            return { activity: 'circuit', headline: String(this.countdownBeat), timer: null, lines: ['Hold the line'] };
        }
        if (this.state === 'running') {
            return {
                activity: 'circuit', headline: this.goFor > 0 ? 'GO' : null, timer: formatLap(this.elapsed),
                lines: [`Gate ${Math.min(this.reached + 1, this.gates.length)} of ${this.gates.length}`, this.best !== null ? `Best ${formatLap(this.best)}` : 'No best yet'],
            };
        }
        const improved = this.lastTime !== null && (this.bestBefore === null || this.lastTime < this.bestBefore);
        return {
            activity: 'circuit',
            headline: this.lastTime === null ? 'RACE ENDED' : improved ? 'NEW BEST' : 'FINISH',
            timer: this.lastTime === null ? null : formatLap(this.lastTime),
            lines: this.best !== null
                ? [`Best ${formatLap(this.best)}`, 'Top ten is on the board by the grid']
                : ['Top ten is on the board by the grid'],
        };
    }
}
