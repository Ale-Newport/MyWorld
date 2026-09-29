import * as THREE from 'three';
import { Events } from '../core/Events.js';
import { clamp, damp, lerp, smoothstep } from '../core/maths.js';
export class View {
    ticker;
    viewport;
    inputs;
    physics;
    events = new Events();
    camera;
    /** The un-cinematic camera. Used for raycasts and projection. */
    defaultCamera;
    mode = 'default';
    position = new THREE.Vector3();
    idealRatio = 1920 / 1080;
    ratioOverflow = 0;
    focusPoint = {
        trackedPosition: new THREE.Vector3(),
        position: new THREE.Vector3(),
        smoothedPosition: new THREE.Vector3(),
        isTracking: true,
        easing: 1,
        magnet: { active: true, multiplier: 0.25 },
    };
    zoom = {
        baseRatio: 0.6,
        ratio: 0.6,
        smoothedRatio: 0.6,
        speedAmplitude: -0.4,
        speedEdge: { min: 5, max: 40 },
        sensitivity: 0.05,
        toggle: 0,
        toggleLast: -1,
    };
    spherical = {
        phi: Math.PI * 0.27,
        theta: Math.PI * 0.25,
        /** Where drag-to-orbit is heading; `phi`/`theta` chase these. */
        targetPhi: Math.PI * 0.27,
        targetTheta: Math.PI * 0.25,
        basePhi: Math.PI * 0.27,
        baseTheta: Math.PI * 0.25,
        radius: { edges: { min: 15, max: 30 }, current: 21, nonIdealRatioOffset: 9 },
        offset: new THREE.Vector3(),
    };
    roll = {
        value: 0,
        velocity: 0,
        speed: 0,
        damping: 4,
        pullStrength: 100,
        kickStrength: 1,
    };
    cinematic = {
        active: false,
        progress: 0,
        position: new THREE.Vector3(),
        target: new THREE.Vector3(),
        dummy: null,
        nonIdealRatioOffset: 10,
    };
    /** 0..1. Drives the speed-line overlay. Written by Player. */
    speedLineStrength = 0;
    smoothedSpeedLineStrength = 0;
    /** Reduced-motion mode: no roll spring, no shake, gentler zoom. */
    reducedMotion = false;
    /** Camera collision avoidance. */
    obstructionRadius = 1;
    smoothedObstruction = 1;
    orbiting = false;
    panning = false;
    scratch = new THREE.Vector3();
    scratch2 = new THREE.Vector3();
    rayDirection = new THREE.Vector3();
    constructor(ticker, viewport, inputs, physics, bin, lowQuality = false) {
        this.ticker = ticker;
        this.viewport = viewport;
        this.inputs = inputs;
        this.physics = physics;
        if (lowQuality) {
            // A steeper angle sees more of the world at once, which matters
            // more than parallax on a small screen.
            this.spherical.phi = Math.PI * 0.31;
            this.spherical.targetPhi = this.spherical.phi;
            this.spherical.basePhi = this.spherical.phi;
        }
        this.camera = new THREE.PerspectiveCamera(25, this.viewport.ratio, 0.1, 800);
        this.defaultCamera = this.camera.clone();
        this.cinematic.dummy = this.camera.clone();
        this.resize();
        this.spherical.radius.current = lerp(this.spherical.radius.edges.min, this.spherical.radius.edges.max, 1 - this.zoom.smoothedRatio);
        this.spherical.offset.setFromSphericalCoords(this.spherical.radius.current, this.spherical.phi, this.spherical.theta);
        /* ---- input wiring ------------------------------------ */
        const onZoom = (action) => {
            this.zoom.baseRatio -= action.value * this.zoom.sensitivity;
            this.zoom.baseRatio = clamp(this.zoom.baseRatio, 0, 1);
        };
        const onZoomToggle = (action) => {
            if (action.active) {
                this.zoom.toggle -= this.zoom.toggleLast;
                this.zoom.toggleLast = this.zoom.toggle;
            }
            else {
                this.zoom.toggle = 0;
            }
        };
        const onOrbit = (action) => {
            if (this.mode !== 'default')
                return;
            const pointer = this.inputs.pointer;
            if (action.trigger === 'start') {
                // Left mouse orbits; middle/right and two fingers pan.
                this.panning = pointer.mode === 'touch' ? false : pointer.button !== 0;
                this.orbiting = !this.panning;
                return;
            }
            if (action.trigger === 'end') {
                this.orbiting = false;
                this.panning = false;
                return;
            }
            if (!action.active)
                return;
            if (pointer.mode === 'touch') {
                // One finger belongs to the joystick; two orbit and pinch.
                if (pointer.touches.length < 2)
                    return;
                this.orbitBy(pointer.delta.x, pointer.delta.y);
                this.zoom.baseRatio = clamp(this.zoom.baseRatio + pointer.pinch.distanceDelta * 0.005, 0, 1);
                return;
            }
            if (this.panning)
                this.panBy(pointer.delta.x, pointer.delta.y);
            else if (this.orbiting)
                this.orbitBy(pointer.delta.x, pointer.delta.y);
        };
        const onReset = (action) => {
            if (action.active)
                this.resetOrbit();
        };
        const refocus = (action) => {
            // Any driving input snaps the camera back onto the car.
            if (action.name !== 'orbit' && action.name !== 'zoom')
                this.focusPoint.isTracking = true;
        };
        this.inputs.events.on('zoom', onZoom);
        this.inputs.events.on('zoomToggle', onZoomToggle);
        this.inputs.events.on('orbit', onOrbit);
        this.inputs.events.on('cameraReset', onReset);
        this.inputs.events.on('actionStart', refocus);
        const onResize = () => this.resize();
        this.viewport.events.on('change', onResize);
        const update = () => this.update();
        this.ticker.events.on('tick', update, 7);
        bin.add(() => {
            this.inputs.events.off('zoom', onZoom);
            this.inputs.events.off('zoomToggle', onZoomToggle);
            this.inputs.events.off('orbit', onOrbit);
            this.inputs.events.off('cameraReset', onReset);
            this.inputs.events.off('actionStart', refocus);
            this.viewport.events.off('change', onResize);
            this.ticker.events.off('tick', update);
            this.events.clear();
        });
    }
    /* ---- orbit / pan --------------------------------------- */
    orbitBy(deltaX, deltaY) {
        const smallest = Math.min(this.viewport.width, this.viewport.height);
        this.spherical.targetTheta -= (deltaX / smallest) * Math.PI * 1.6;
        // Clamped: below ~7° the camera is inside the ground, and above
        // ~78° it looks straight down and the world stops reading.
        this.spherical.targetPhi = clamp(this.spherical.targetPhi + (deltaY / smallest) * Math.PI * 0.9, Math.PI * 0.04, Math.PI * 0.43);
    }
    panBy(deltaX, deltaY) {
        this.focusPoint.isTracking = false;
        const movement = new THREE.Vector2(deltaX, deltaY);
        movement.rotateAround(new THREE.Vector2(), -this.spherical.theta);
        const smallest = Math.min(this.viewport.width, this.viewport.height);
        movement.multiplyScalar(10 / smallest);
        this.focusPoint.position.x -= movement.x * 2;
        this.focusPoint.position.z -= movement.y * 2;
    }
    resetOrbit() {
        this.spherical.targetTheta = this.spherical.baseTheta;
        this.spherical.targetPhi = this.spherical.basePhi;
        this.focusPoint.isTracking = true;
    }
    /** Snaps the camera onto the car with no interpolation. */
    snapToTarget() {
        this.focusPoint.position.copy(this.focusPoint.trackedPosition);
        this.focusPoint.smoothedPosition.copy(this.focusPoint.trackedPosition);
        this.focusPoint.isTracking = true;
        this.roll.value = 0;
        this.roll.speed = 0;
        this.smoothedObstruction = 1;
        this.obstructionRadius = 1;
        this.update();
    }
    /** A one-off camera shake. `strength` is roughly 0..1. */
    kick(strength = 1) {
        if (this.reducedMotion)
            return;
        this.roll.speed = strength * this.roll.kickStrength * (Math.random() < 0.5 ? -1 : 1);
    }
    /* ---- cinematic ----------------------------------------- */
    startCinematic(position, target) {
        this.cinematic.active = true;
        this.cinematic.position.copy(position);
        this.cinematic.target.copy(target);
        // On a narrow window, pull the cinematic camera back so the
        // subject still fits.
        if (this.ratioOverflow > 0) {
            this.scratch
                .copy(this.cinematic.position)
                .sub(this.cinematic.target)
                .setLength(this.ratioOverflow * this.cinematic.nonIdealRatioOffset);
            this.cinematic.position.add(this.scratch);
        }
        this.mode = 'cinematic';
        this.events.trigger('modeChange', ['cinematic']);
    }
    endCinematic() {
        this.cinematic.active = false;
        this.mode = 'default';
        this.events.trigger('modeChange', ['default']);
    }
    /* ---- lifecycle ----------------------------------------- */
    resize() {
        this.ratioOverflow = Math.max(1, this.idealRatio / this.viewport.ratio) - 1;
        this.camera.aspect = this.viewport.ratio;
        this.camera.updateProjectionMatrix();
        this.defaultCamera.aspect = this.viewport.ratio;
        this.defaultCamera.updateProjectionMatrix();
        if (this.cinematic.dummy) {
            this.cinematic.dummy.aspect = this.viewport.ratio;
            this.cinematic.dummy.updateProjectionMatrix();
        }
    }
    update() {
        const dt = this.ticker.delta;
        /* ---- gamepad right stick pans ---------------------- */
        const right = this.inputs.gamepad.joysticks.right;
        if (this.mode === 'default' && right.active && !this.cinematic.active) {
            this.focusPoint.isTracking = false;
            const movement = new THREE.Vector2(right.safeX, right.safeY);
            movement.rotateAround(new THREE.Vector2(), -this.spherical.theta);
            movement.multiplyScalar(20 * dt);
            this.focusPoint.position.x += movement.x;
            this.focusPoint.position.z += movement.y;
        }
        /* ---- focus point ------------------------------------ */
        if (this.focusPoint.isTracking) {
            this.focusPoint.position.x = this.focusPoint.trackedPosition.x;
            this.focusPoint.position.z = this.focusPoint.trackedPosition.z;
        }
        if (this.focusPoint.magnet.active) {
            // Proportional pull: the further the car has escaped the focus
            // point, the harder it is dragged back. Constant-speed catch-up
            // would either snap at low speed or never catch up at high.
            const dx = this.focusPoint.trackedPosition.x - this.focusPoint.position.x;
            const dz = this.focusPoint.trackedPosition.z - this.focusPoint.position.z;
            const distance = Math.hypot(dx, dz);
            const strength = distance * this.focusPoint.magnet.multiplier;
            this.focusPoint.position.x += strength * dx * dt;
            this.focusPoint.position.z += strength * dz * dt;
        }
        const easing = clamp(dt * 10 * this.focusPoint.easing, 0, 1);
        this.scratch.copy(this.focusPoint.smoothedPosition).lerp(this.focusPoint.position, easing);
        this.scratch2.copy(this.scratch).sub(this.focusPoint.smoothedPosition);
        const focusSpeed = Math.hypot(this.scratch2.x, this.scratch2.z) / (dt || 1 / 60);
        this.focusPoint.smoothedPosition.copy(this.scratch);
        /* ---- zoom ------------------------------------------- */
        if (this.mode === 'default') {
            if (this.zoom.toggle !== 0) {
                this.zoom.baseRatio = clamp(this.zoom.baseRatio + this.zoom.toggle * 0.01, 0, 1);
            }
            // Pull back as the car gets quicker — the reason boosting reads
            // as speed rather than as the world getting smaller.
            const speedRatio = smoothstep(focusSpeed, this.zoom.speedEdge.min, this.zoom.speedEdge.max);
            this.zoom.ratio = this.zoom.baseRatio;
            if (this.focusPoint.isTracking && !this.reducedMotion) {
                this.zoom.ratio += this.zoom.speedAmplitude * speedRatio;
            }
            this.zoom.smoothedRatio = lerp(this.zoom.smoothedRatio, this.zoom.ratio, clamp(dt * 10, 0, 1));
        }
        /* ---- orbit smoothing -------------------------------- */
        this.spherical.theta = damp(this.spherical.theta, this.spherical.targetTheta, 12, dt);
        this.spherical.phi = damp(this.spherical.phi, this.spherical.targetPhi, 12, dt);
        /* ---- radius ----------------------------------------- */
        const radiusMax = this.spherical.radius.edges.max + this.ratioOverflow * this.spherical.radius.nonIdealRatioOffset;
        const wanted = lerp(this.spherical.radius.edges.min, radiusMax, 1 - this.zoom.smoothedRatio);
        /* ---- collision avoidance ---------------------------- */
        this.obstructionRadius = this.probeObstruction(wanted);
        // Snapping in is fine (you never want to be inside a wall); easing
        // back out avoids a pop when the obstacle clears.
        const target = this.obstructionRadius;
        this.smoothedObstruction =
            target < this.smoothedObstruction
                ? target
                : damp(this.smoothedObstruction, target, 5, dt);
        this.spherical.radius.current = Math.min(wanted, this.smoothedObstruction);
        this.spherical.offset.setFromSphericalCoords(this.spherical.radius.current, this.spherical.phi, this.spherical.theta);
        /* ---- place the camera ------------------------------- */
        this.position.copy(this.focusPoint.smoothedPosition).add(this.spherical.offset);
        this.defaultCamera.position.copy(this.position);
        this.defaultCamera.rotation.set(0, 0, 0);
        this.defaultCamera.lookAt(this.focusPoint.smoothedPosition);
        /* ---- roll spring ------------------------------------ */
        if (!this.reducedMotion) {
            const scaled = this.ticker.delta * this.ticker.scale;
            this.roll.velocity = -this.roll.value * this.roll.pullStrength * scaled;
            this.roll.speed += this.roll.velocity;
            this.roll.value += this.roll.speed * scaled;
            this.roll.speed *= 1 - this.roll.damping * scaled;
            this.defaultCamera.rotation.z += this.roll.value;
        }
        /* ---- cinematic blend -------------------------------- */
        const cinematicTarget = this.cinematic.active ? 1 : 0;
        this.cinematic.progress = damp(this.cinematic.progress, cinematicTarget, 3, dt);
        if (this.cinematic.progress > 0.001 && this.cinematic.dummy) {
            this.cinematic.dummy.position.copy(this.cinematic.position);
            this.cinematic.dummy.lookAt(this.cinematic.target);
            this.defaultCamera.position.lerp(this.cinematic.dummy.position, this.cinematic.progress);
            this.defaultCamera.quaternion.slerp(this.cinematic.dummy.quaternion, this.cinematic.progress);
        }
        this.camera.position.copy(this.defaultCamera.position);
        this.camera.quaternion.copy(this.defaultCamera.quaternion);
        this.camera.updateMatrixWorld();
        this.defaultCamera.updateMatrixWorld();
        this.smoothedSpeedLineStrength = damp(this.smoothedSpeedLineStrength, this.reducedMotion ? 0 : this.speedLineStrength, 6, dt);
    }
    /**
     * Casts from just above the focus point out to where the camera
     * wants to be. If anything solid is in the way, the camera stops
     * short of it. Cheap: one ray per frame against the physics
     * broadphase we already maintain.
     */
    probeObstruction(wantedRadius) {
        const focus = this.focusPoint.smoothedPosition;
        this.rayDirection
            .setFromSphericalCoords(1, this.spherical.phi, this.spherical.theta)
            .normalize();
        // Start above the car's roof. From the focus point itself the ray
        // grazes whatever the car is parked against and the camera dives
        // to arm's length for no reason.
        const origin = { x: focus.x, y: focus.y + 2.4, z: focus.z };
        const hit = this.physics.world.castRay(new this.physics.rapier.Ray(origin, this.rayDirection), wantedRadius, true, undefined, this.physics.queryTerrainOnly);
        if (!hit)
            return wantedRadius;
        // A hit inside CLOSE_IGNORE means the car is under or inside
        // something. Pulling the camera to arm's length there is worse
        // than letting the geometry pass through the near plane for a
        // moment, so that case is ignored outright.
        const CLOSE_IGNORE = 7;
        const MINIMUM = 12;
        if (hit.timeOfImpact < CLOSE_IGNORE)
            return wantedRadius;
        // Otherwise stop short of the surface so the near plane never
        // clips it, and never closer than MINIMUM or the car fills the
        // frame and the world stops being legible.
        return Math.max(MINIMUM, hit.timeOfImpact - 1.2);
    }
    /** Projects a world position into 0..1 screen space. */
    project(world, out) {
        this.scratch.copy(world).project(this.camera);
        const visible = this.scratch.z > -1 && this.scratch.z < 1;
        out.set((this.scratch.x * 0.5 + 0.5), (-this.scratch.y * 0.5 + 0.5));
        return visible;
    }
}
