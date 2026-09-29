import * as THREE from 'three';
import { Screen } from './Screen.js';
import { orientForMesh } from './bindCanvas.js';
import { projects } from '../../content/projects/index.js';
import { profile } from '../../content/profile.js';
/* ============================================================
   THE SMALLER PLACES

   Ported behaviour from sources/Game/World/Areas/: LandingArea,
   ToiletArea, TimeMachineArea, AltarArea, CookieArea,
   BehindTheSceneArea, LabArea and AchievementsArea.
   folio-2025 — Copyright (c) 2025 Bruno Simon — MIT
   See THIRD_PARTY_NOTICES.md.

   Each of these is a small mechanic hung on objects the .blend
   already placed. Where upstream's version depends on a server
   (the altar's global cataclysm counter, the cookie counter) the
   count is kept per browser instead and the interaction is
   unchanged. Where it points at Bruno's own past (the time
   machine's 2019 site) it points at the equivalent thing here —
   Alejandro's first personal site, which the project data already
   knows the URL of.
   ============================================================ */
const STORAGE = 'helloworld-world2-places-v1';
export class Places {
    game;
    references;
    prompts;
    group = new THREE.Group();
    counts = { offerings: 0, cookies: 0 };
    beam = null;
    altarAt = null;
    altarCooldown = 0;
    altarBoard = null;
    cabin = null;
    moon = null;
    tv = null;
    cookies = [];
    cookieSpawn = null;
    /** Counts presses, not live cookies: the ring must not repeat a bearing. */
    cookiesSpawned = 0;
    cookieBoard = null;
    /** Geometry, material and radius lifted off the authored `refCookie`. */
    cookieMould = null;
    blower = null;
    sceneBoard = null;
    labBoard = null;
    labProjects = projects.filter(p => p.category === 'experiment' || p.source === 'university');
    movedProps = new Set();
    /** The 103-body sweep below is worth doing four times a second, not sixty. */
    sweptAt = -1;
    constructor(game, references, prompts, bin) {
        this.game = game;
        this.references = references;
        this.prompts = prompts;
        this.group.name = 'World2 / places';
        this.load();
        this.setLanding();
        this.setAltar();
        this.setToilet();
        this.setTimeMachine();
        this.setCookie();
        this.setBehindTheScene();
        this.setLab();
        this.setAchievements();
        this.setJukebox();
        const tick = () => this.update();
        game.ticker.events.on('tick', tick, 11);
        bin.add(() => {
            game.ticker.events.off('tick', tick);
            this.beam?.geometry.dispose();
            this.beam?.material.dispose();
            this.altarBoard?.destroy();
            this.cookieBoard?.destroy();
            this.sceneBoard?.screen.destroy();
            this.labBoard?.screen.destroy();
            this.tv?.screen.destroy();
        });
        bin.object3D(this.group);
        /*
          Registered AFTER `bin.object3D`, which is what makes it run BEFORE it:
          the bin unwinds in reverse. Every spawned cookie draws the LEVEL's
          geometry through the LEVEL's material, so they have to leave this group
          before anything walks it disposing what it finds — otherwise tearing the
          route down takes the shared `palette` atlas with it.
        */
        bin.add(() => { for (const cookie of this.cookies)
            this.group.remove(cookie.mesh); });
    }
    load() {
        try {
            const raw = JSON.parse(localStorage.getItem(STORAGE) ?? 'null');
            if (raw && typeof raw === 'object')
                this.counts = { offerings: Number(raw.offerings) || 0, cookies: Number(raw.cookies) || 0 };
        }
        catch { /* Private mode starts at zero. */ }
    }
    save() {
        try {
            localStorage.setItem(STORAGE, JSON.stringify(this.counts));
        }
        catch { /* Private mode. */ }
    }
    /* -------------------------------------------------------- landing -- */
    setLanding() {
        const kiosk = this.references.position('refKioskInteractivePoint');
        if (kiosk)
            this.prompts.create({ label: 'Map', position: kiosk, align: 'right', onInteract: () => this.game.toggleMap() });
        const controls = this.references.position('refControlsInteractivePoint');
        if (controls)
            this.prompts.create({ label: 'Controls', position: controls, align: 'left', onInteract: () => this.game.toggleHelp() });
    }
    /* ---------------------------------------------------------- altar -- */
    /**
     * Upstream's altar is a sacrifice: drive onto it and the world takes the
     * car, a bell tolls, and a global counter goes up. The counter lived on a
     * websocket server that is not part of the public repository, so it is kept
     * per browser here. Everything else — the beam, the trigger, the toll — is
     * the same interaction.
     */
    setAltar() {
        const altar = this.references.position('refAltar');
        if (!altar)
            return;
        this.altarAt = altar;
        const geometry = new THREE.CylinderGeometry(2.5, 2.5, 6, 32, 1, true);
        geometry.translate(0, 3, 0);
        this.beam = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
            transparent: true, side: THREE.DoubleSide, depthWrite: false,
            uniforms: { time: { value: 0 }, tint: { value: new THREE.Color('#ff544d') } },
            vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
            fragmentShader: `
        uniform float time; uniform vec3 tint; varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          vec2 uv = vec2(vUv.x * 6.0 - vUv.y * 2.0, vUv.y - time * 0.2);
          float n = hash(floor(uv * 8.0)) * 0.6 + 0.4;
          n += vUv.y * 3.0;
          if (n > 1.0) discard;
          gl_FragColor = vec4(tint * (1.0 - n * 0.4), (1.0 - vUv.y) * 0.55);
        }`,
        }));
        this.beam.position.copy(altar);
        this.group.add(this.beam);
        const counter = this.references.transform('refCounter');
        if (counter) {
            this.altarBoard = new Screen({ width: 512, height: 256, worldWidth: 2.4, emissive: 0.6 });
            this.altarBoard.group.position.copy(counter.position);
            this.altarBoard.group.quaternion.copy(counter.quaternion);
            this.group.add(this.altarBoard.group);
            this.paintAltar();
        }
    }
    paintAltar() {
        this.altarBoard?.draw(context => {
            context.fillStyle = '#1b1420';
            context.fillRect(0, 0, 512, 256);
            context.textAlign = 'center';
            context.fillStyle = '#ff544d';
            context.font = '700 34px ui-sans-serif, system-ui, sans-serif';
            context.fillText('OFFERINGS', 256, 62);
            context.fillStyle = '#f4f1e8';
            context.font = '700 110px ui-monospace, SFMono-Regular, monospace';
            context.fillText(String(this.counts.offerings).padStart(3, '0'), 256, 172);
            context.fillStyle = '#8f8aa0';
            context.font = '500 24px ui-sans-serif, system-ui, sans-serif';
            context.fillText('this browser', 256, 216);
        });
    }
    /* --------------------------------------------------------- toilet -- */
    setToilet() {
        const physical = this.references.physical('refCabinPhysicalDynamic');
        if (physical)
            this.cabin = { physical, down: false };
        this.moon = this.references.node('refMoon');
    }
    /* ---------------------------------------------------- time machine -- */
    /**
     * Upstream's CRT links to Bruno's 2019 folio and flickers through two
     * screen textures when you ram it. Ours links to the site this portfolio
     * replaced — the URL is in the project data, not typed here.
     */
    setTimeMachine() {
        const point = this.references.position('refInteractivePoint.006');
        const previousSite = projects.find(project => project.id === 'personal-web');
        const screenNode = this.references.node('refScreen');
        const physical = this.references.physical('refTvPhysicalDynamic');
        if (screenNode instanceof THREE.Mesh) {
            const screen = new Screen({ width: 512, height: 384, worldWidth: 1, emissive: 0.9 });
            orientForMesh(screen.texture, screenNode, this.references.position('refInteractivePoint.006') ?? new THREE.Vector3());
            screenNode.material = screen.mesh.material;
            screen.mesh.visible = false;
            this.tv = { physical: physical ?? null, screen, rammed: 0 };
            this.paintTv(previousSite?.year ?? '2024');
        }
        if (point && previousSite?.liveUrl) {
            this.prompts.create({
                label: 'Time machine', position: point, align: 'right',
                onInteract: () => {
                    this.game.audio.play('interact');
                    this.game.interactions?.achievements.unlock('timeMachine');
                    window.open(previousSite.liveUrl, '_blank', 'noopener,noreferrer');
                },
            });
        }
    }
    paintTv(year, noise = false) {
        this.tv?.screen.draw(context => {
            const { width, height } = context.canvas;
            context.fillStyle = '#0d1014';
            context.fillRect(0, 0, width, height);
            if (noise) {
                for (let i = 0; i < 2400; i++) {
                    context.fillStyle = `rgba(255,255,255,${Math.random() * 0.5})`;
                    context.fillRect(Math.random() * width, Math.random() * height, 3, 2);
                }
                return;
            }
            for (let y = 0; y < height; y += 4) {
                context.fillStyle = 'rgba(120,255,190,0.05)';
                context.fillRect(0, y, width, 2);
            }
            context.textAlign = 'center';
            context.fillStyle = '#7cffc0';
            context.font = '700 44px ui-monospace, SFMono-Regular, monospace';
            context.fillText(year, width / 2, 130);
            context.font = '600 26px ui-monospace, SFMono-Regular, monospace';
            context.fillText('THE SITE BEFORE', width / 2, 186);
            context.fillText('THIS ONE', width / 2, 222);
            context.fillStyle = '#3f7a68';
            context.font = '500 20px ui-monospace, SFMono-Regular, monospace';
            context.fillText('press to travel', width / 2, 290);
        });
    }
    /* --------------------------------------------------------- cookie -- */
    setCookie() {
        this.cookieSpawn = this.references.position('refSpawner');
        const point = this.references.position('refInteractivePoint.002');
        const blowerNode = this.references.node('refBlower.001') ?? this.references.node('refBlower');
        if (blowerNode)
            this.blower = { node: blowerNode, base: blowerNode.scale.y };
        this.mouldCookie();
        const label = this.references.transform('refCounterLabel');
        if (label) {
            this.cookieBoard = new Screen({ width: 512, height: 200, worldWidth: 1.6, emissive: 0.6 });
            this.cookieBoard.group.position.copy(label.position);
            this.cookieBoard.group.quaternion.copy(label.quaternion);
            this.group.add(this.cookieBoard.group);
            this.paintCookies();
        }
        if (point && this.cookieSpawn) {
            this.prompts.create({
                label: 'Take a cookie', position: point, align: 'right',
                onInteract: () => this.spawnCookie(),
            });
        }
    }
    /*
      `refCookie` is authored with `preventAutoAdd`, which in this level means
      "I am a template, somebody clones me" — the engine is not supposed to put
      it in the world. Nothing here honoured that, so the template hung in the
      air beside the oven for the whole game, and the cookies this place handed
      out were a plain brown cylinder built in code instead.
  
      So it earns its keep: the template is hidden and its geometry, material
      and size become the mould every spawned cookie is pressed from. Hiding it
      here is enough to keep it out of the scenery merge as well — the batching
      pass runs after the interaction layer and skips anything invisible.
    */
    mouldCookie() {
        const node = this.references.node('refCookie');
        if (!node)
            return;
        // Hide FIRST, unconditionally. If the template ever stops being a plain
        // mesh, the failure should be "the oven hands out nothing" — not "the
        // cookie is back in the air and the removal quietly failed open".
        this.references.environment.suppress(node);
        const mesh = node instanceof THREE.Mesh
            ? node
            : node.children.find(child => child instanceof THREE.Mesh);
        if (!mesh)
            return;
        const geometry = mesh.geometry;
        geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        const scale = mesh.getWorldScale(new THREE.Vector3());
        // A cookie is a disc: the two wide axes give the radius, the short one
        // its thickness. Read them off the authored mesh rather than guessed.
        const size = new THREE.Vector3((box.max.x - box.min.x) * Math.abs(scale.x), (box.max.y - box.min.y) * Math.abs(scale.y), (box.max.z - box.min.z) * Math.abs(scale.z));
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        this.cookieMould = {
            geometry,
            material,
            radius: Math.max(size.x, size.z) * 0.5,
            half: Math.max(0.02, size.y * 0.5),
        };
    }
    spawnCookie() {
        if (!this.cookieSpawn || !this.cookieMould || this.cookies.length > 24)
            return;
        const { geometry, material, radius, half } = this.cookieMould;
        // The geometry and material belong to the level; a clone of the MESH would
        // copy them by reference anyway, so the mesh is new and the buffers shared.
        const mesh = new THREE.Mesh(geometry, material);
        /*
          The authored cookie is 1.29 m across, so the jitter the plain cylinder
          used — a 0.4 m box — dropped every disc inside the last one. They come
          out on a ring just wider than a cookie, stepping round it by the golden
          angle: consecutive presses land 1.30 m apart, which is the full diameter,
          and the sequence never repeats a bearing. The drop stays low so the stack
          settles before the next one arrives.
        */
        const angle = this.cookiesSpawned++ * 2.39996;
        const spread = radius * 1.05;
        const at = this.cookieSpawn.clone().add(new THREE.Vector3(Math.cos(angle) * spread, 0.7, Math.sin(angle) * spread));
        mesh.position.copy(at);
        mesh.castShadow = true;
        this.group.add(mesh);
        // The mesh follows the body every frame, so the spin that stops a stack of
        // cookies looking stamped has to go on the BODY, not on the mesh.
        const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
        const physical = this.game.physics.add({
            type: 'dynamic', position: at, rotation: spin,
            colliders: [{ shape: 'cylinder', parameters: [half, radius], category: 'object' }],
            // Heavy enough to stay where the oven drops it and to be worth nudging
            // with the car: this cookie is more than a metre across.
            mass: 3, friction: 0.8, restitution: 0.2, angularDamping: 0.4, owner: 'cookie',
        });
        this.cookies.push({ physical, mesh, spawned: this.game.ticker.elapsed });
        this.game.audio.play('blip', 1.5);
    }
    paintCookies() {
        this.cookieBoard?.draw(context => {
            context.fillStyle = '#241a12';
            context.fillRect(0, 0, 512, 200);
            context.textAlign = 'center';
            context.fillStyle = '#e8b071';
            context.font = '700 30px ui-sans-serif, system-ui, sans-serif';
            context.fillText('COOKIES TAKEN', 256, 56);
            context.fillStyle = '#f4f1e8';
            context.font = '700 92px ui-monospace, SFMono-Regular, monospace';
            context.fillText(String(this.counts.cookies), 256, 150);
        });
    }
    /* ------------------------------------------------ behind the scene -- */
    setBehindTheScene() {
        const centre = this.references.position('refCenter.001');
        const point = this.references.position('refInteractivePoint.004');
        if (!centre)
            return;
        const screen = new Screen({ width: 1024, height: 768, worldWidth: 3.6, emissive: 0.55 });
        screen.group.position.copy(centre).add(new THREE.Vector3(0, 0.2, 0));
        screen.group.visible = false;
        this.group.add(screen.group);
        this.sceneBoard = { screen, shown: false, home: centre.clone() };
        screen.draw(context => {
            const width = 1024;
            context.fillStyle = '#16131f';
            context.fillRect(0, 0, width, 768);
            context.fillStyle = '#32ffc1';
            context.font = '700 46px ui-sans-serif, system-ui, sans-serif';
            context.fillText('UNDER THE HOOD', 48, 92);
            const lines = [
                ['LEVEL', 'folio-2025.blend by Bruno Simon (MIT), exported to glTF — geometry, colliders, spawns and every reference name are the Blender file’s.'],
                ['RENDER', 'Three.js WebGL. Vegetation is instanced and merged per spatial cell; screens are canvases with anisotropic filtering.'],
                ['PHYSICS', 'Rapier, stepped on a fixed accumulator with render interpolation. The car is a raycast vehicle controller.'],
                ['GAMEPLAY', 'Controllers bind to authored Blender objects by name. No coordinate in the interaction layer was invented.'],
                ['DATA', 'Career, projects and contact all read the same files as the written portfolio, so the drive cannot disagree with the page.'],
            ];
            let y = 168;
            for (const [label, body] of lines) {
                context.fillStyle = '#8f8aa0';
                context.font = '700 26px ui-sans-serif, system-ui, sans-serif';
                context.fillText(label, 48, y);
                context.fillStyle = '#f4f1e8';
                context.font = '500 27px ui-sans-serif, system-ui, sans-serif';
                for (const line of screen.wrap(body, width - 96)) {
                    y += 38;
                    context.fillText(line, 48, y);
                }
                y += 58;
            }
            context.fillStyle = '#8f8aa0';
            context.font = '500 22px ui-sans-serif, system-ui, sans-serif';
            context.fillText(`${profile.name} · World 02`, 48, 740);
        });
        if (point) {
            this.prompts.create({
                label: 'Behind the scenes', position: point, align: 'right',
                onInteract: () => {
                    if (!this.sceneBoard)
                        return;
                    this.sceneBoard.shown = !this.sceneBoard.shown;
                    this.sceneBoard.screen.group.visible = true;
                    this.game.audio.play('interact');
                    this.game.interactions?.achievements.unlock('behindTheScene');
                },
            });
        }
    }
    /* ------------------------------------------------------------ lab -- */
    /**
     * Upstream's lab browses its own experiment list on a second board. Ours
     * browses the portfolio's experiments and university work, on the same
     * authored board (`refTitle.001` / `refImages.001` / `refArrowNext`).
     */
    setLab() {
        const node = this.references.node('refImages.001');
        const point = this.references.position('refInteractivePoint.001');
        if (!(node instanceof THREE.Mesh) || !this.labProjects.length)
            return;
        const screen = new Screen({ width: 1024, height: 512, worldWidth: 1, emissive: 0.6 });
        orientForMesh(screen.texture, node, point ?? new THREE.Vector3());
        node.material = screen.mesh.material;
        screen.mesh.visible = false;
        this.labBoard = { screen, index: 0 };
        this.paintLab();
        if (point) {
            this.prompts.create({
                label: 'Next experiment', position: point, align: 'right',
                onInteract: () => {
                    if (!this.labBoard)
                        return;
                    this.labBoard.index = (this.labBoard.index + 1) % this.labProjects.length;
                    this.paintLab();
                    this.game.audio.play('blip', 1.2);
                    this.game.interactions?.achievements.unlock('lab');
                },
            });
        }
    }
    paintLab() {
        if (!this.labBoard)
            return;
        const project = this.labProjects[this.labBoard.index];
        this.labBoard.screen.draw(context => {
            context.fillStyle = '#12141b';
            context.fillRect(0, 0, 1024, 512);
            context.fillStyle = '#5390ff';
            context.font = '700 30px ui-sans-serif, system-ui, sans-serif';
            context.fillText(`EXPERIMENT ${this.labBoard.index + 1} / ${this.labProjects.length}`, 44, 74);
            context.fillStyle = '#f4f1e8';
            context.font = '700 62px ui-sans-serif, system-ui, sans-serif';
            context.fillText(project.title, 44, 154);
            context.fillStyle = '#8f8aa0';
            context.font = '500 30px ui-sans-serif, system-ui, sans-serif';
            let y = 214;
            for (const line of this.labBoard.screen.wrap(project.shortDescription, 940)) {
                context.fillText(line, 44, y);
                y += 42;
            }
            context.fillStyle = '#32ffc1';
            context.font = '600 28px ui-monospace, SFMono-Regular, monospace';
            context.fillText(project.technologies.slice(0, 5).join(' · '), 44, 400);
            context.fillStyle = '#8f8aa0';
            context.fillText(project.year, 44, 452);
        });
    }
    /* --------------------------------------------------- achievements -- */
    setAchievements() {
        const point = this.references.position('refInteractivePoint.005');
        if (!point)
            return;
        this.prompts.create({
            label: 'Achievements', position: point, align: 'right',
            onInteract: () => { this.game.toggleAchievements(); this.game.audio.play('interact'); },
        });
    }
    /* -------------------------------------------------------- jukebox -- */
    setJukebox() {
        const point = this.references.position('refJukeboxInteractivePoint');
        if (!point)
            return;
        this.prompts.create({
            label: 'Jukebox', position: point, align: 'left',
            onInteract: () => {
                // Eight notes of the island's own synth — no audio file to licence.
                const notes = [1, 1.25, 1.5, 2, 1.5, 1.25, 1.875, 1.5];
                notes.forEach((rate, i) => this.game.tweens.delay(i * 0.16, () => this.game.audio.play('note', rate)));
                this.game.interactions?.achievements.unlock('jukebox');
            },
        });
    }
    /* --------------------------------------------------------- update -- */
    update() {
        const delta = this.game.ticker.delta * this.game.ticker.scale;
        const time = this.game.ticker.elapsed;
        const player = this.game.player.position;
        /** Everything below is cosmetic or local; none of it is worth a frame
         *  from the other side of the island. */
        const near = (at, reach = 30) => !!at && Math.hypot(player.x - at.x, player.z - at.z) < reach;
        if (this.beam && near(this.altarAt, 40))
            this.beam.material.uniforms.time.value = time;
        if (this.blower && near(this.cookieSpawn))
            this.blower.node.scale.y = this.blower.base * (Math.sin(time * 2 + Math.PI) * 0.25 + 0.75);
        // The altar takes the car and counts the offering.
        if (this.altarAt) {
            this.altarCooldown = Math.max(0, this.altarCooldown - delta);
            const flat = Math.hypot(player.x - this.altarAt.x, player.z - this.altarAt.z);
            if (flat < 2.5 && player.y < this.altarAt.y + 5 && this.altarCooldown <= 0) {
                this.altarCooldown = 6;
                this.counts.offerings++;
                this.save();
                this.paintAltar();
                this.game.audio.play('fail');
                this.game.interactions?.explosions.explode(this.altarAt.clone().setY(this.altarAt.y + 0.5), 6, 14);
                this.game.interactions?.achievements.unlock('altar');
                this.game.tweens.delay(1.1, () => this.game.player.respawn());
            }
        }
        // The latrine goes over when you hit it hard enough.
        if (this.cabin && !this.cabin.down && !this.cabin.physical.body.isSleeping()) {
            const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.cabin.physical.current.quaternion);
            if (up.y < 0.55) {
                this.cabin.down = true;
                this.game.audio.impact(14);
                this.game.interactions?.achievements.unlock('toilet');
            }
        }
        if (this.moon && near(this.moon.position, 60)) {
            // Upstream shows the moon only at night; the day cycle here is the
            // renderer's own, so it simply tracks the lighting.
            this.moon.visible = this.game.lighting.phase > 0.75 || this.game.lighting.phase < 0.2;
        }
        // The CRT flickers when it takes a hit.
        if (this.tv) {
            if (this.tv.physical && !this.tv.physical.body.isSleeping() && this.tv.rammed <= 0) {
                this.tv.rammed = 1.4;
                this.paintTv('', true);
                this.game.audio.play('fail');
            }
            else if (this.tv.rammed > 0) {
                this.tv.rammed -= delta;
                if (this.tv.rammed <= 0)
                    this.paintTv(projects.find(p => p.id === 'personal-web')?.year ?? '2024');
            }
        }
        // Cookies are collectible: drive over one and it is yours.
        for (let i = this.cookies.length - 1; i >= 0; i--) {
            const cookie = this.cookies[i];
            const position = cookie.physical.current.position;
            cookie.mesh.position.lerpVectors(cookie.physical.previous.position, position, this.game.ticker.alpha);
            cookie.mesh.quaternion.slerpQuaternions(cookie.physical.previous.quaternion, cookie.physical.current.quaternion, this.game.ticker.alpha);
            // A cookie is reached when the car touches it, and this one is more than
            // a metre across: the old 1.6 m was measured for a 0.28 m cylinder.
            const reached = player.distanceTo(position) < 1.6 + (this.cookieMould?.radius ?? 0);
            if (!reached && time - cookie.spawned < 120)
                continue;
            if (reached) {
                this.counts.cookies++;
                this.save();
                this.paintCookies();
                this.game.audio.play('blip', 1.9);
                this.game.interactions?.achievements.set('cookies', this.counts.cookies);
            }
            this.game.physics.remove(cookie.physical);
            cookie.mesh.removeFromParent();
            // Nothing is disposed here: the geometry and the material are the
            // authored cookie's, shared by every cookie and owned by the level.
            // Disposing them would take the `palette` atlas down with them.
            this.cookies.splice(i, 1);
        }
        // The behind-the-scenes board rises out of the ground and sinks back.
        if (this.sceneBoard && (this.sceneBoard.screen.group.visible || this.sceneBoard.shown)) {
            const target = this.sceneBoard.shown ? this.sceneBoard.home.y + 2.1 : this.sceneBoard.home.y - 1.6;
            const group = this.sceneBoard.screen.group;
            group.position.y += (target - group.position.y) * Math.min(1, delta * 2.5);
            group.lookAt(player.x, group.position.y, player.z);
            if (!this.sceneBoard.shown && Math.abs(group.position.y - target) < 0.05)
                group.visible = false;
        }
        // Anything the player has actually shoved counts toward the award.
        if (this.movedProps.size < 20 && time - this.sweptAt > 0.25) {
            this.sweptAt = time;
            for (const { physical } of this.references.environment.dynamic) {
                if (this.movedProps.has(physical) || physical.body.isSleeping())
                    continue;
                const home = physical.initialState.position;
                const now = physical.body.translation();
                if (Math.hypot(now.x - home.x, now.y - home.y, now.z - home.z) < 0.6)
                    continue;
                this.movedProps.add(physical);
                this.game.interactions?.achievements.mark('bricks', String(physical.owner ?? this.movedProps.size));
            }
        }
    }
    get offerings() { return this.counts.offerings; }
    get cookiesTaken() { return this.counts.cookies; }
}
