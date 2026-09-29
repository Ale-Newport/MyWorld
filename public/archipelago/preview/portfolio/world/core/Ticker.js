import { Events } from './Events.js';
import { clamp, remap } from './maths.js';
/* ============================================================
   PORTED FROM: sources/Game/Ticker.js + sources/Game/Time.js
   folio-2025 — Copyright (c) 2025 Bruno Simon — MIT
   https://github.com/brunosimon/folio-2025
   See THIRD_PARTY_NOTICES.md and ../vendor/LICENSE-folio-2025.md

   Upstream's `scale = 2` is kept exactly: the world runs at
   twice real time, and that is a large part of why the car feels
   quick rather than heavy. Bullet time (scale 0.5) is kept too.

   ONE DELIBERATE CHANGE: upstream steps physics with a variable
   timestep (`world.timestep = delta * scale`). That makes the
   handling drift with frame rate — a 144 Hz machine and a 40 Hz
   machine do not drive the same car. Here the simulation runs on
   a fixed accumulator instead:

       FIXED_DELTA          = 1/60 real seconds
       world.timestep       = FIXED_DELTA * scale   (= 1/30 at scale 2)
       controller.updateVehicle(FIXED_DELTA)        (= 1/60)

   Those are precisely the numbers upstream produces on a 60 Hz
   display, including the deliberate 2:1 asymmetry between the
   world timestep and the vehicle controller's dt. So the feel is
   upstream's feel — it just no longer changes with the monitor.

   Three event channels, in order per rendered frame:
     'frame'  once  — sample inputs, advance wall-clock time
     'fixed'  0..n  — the simulation, orders 1..6 (see below)
     'tick'   once  — cameras, world systems, rendering

   Fixed-channel orders (upstream's game-loop documentation):
     1 Player pre-physics        4 Objects post-physics
     2 Vehicle pre-physics       5 Vehicle post-physics
     3 Physics step              6 Player post-physics / triggers
   ============================================================ */
export const FIXED_DELTA = 1 / 60;
/** Never simulate more than this many substeps in one frame. */
const MAX_SUBSTEPS = 5;
/** Cap on a single frame's contribution, so a background tab does not spiral. */
const MAX_FRAME_DELTA = 0.25;
export class Ticker {
    events = new Events();
    /** Real seconds since start, unscaled. */
    elapsed = 0;
    /** Real seconds of the last rendered frame, clamped. */
    delta = FIXED_DELTA;
    /** Rolling mean of `delta` over 30 frames. */
    deltaAverage = FIXED_DELTA;
    /** Time dilation. 2 is the default; bullet time pulls it to 0.5. */
    scale = 2;
    defaultScale = 2;
    /** The fixed simulation step, scaled. Read by Physics. */
    deltaScaled = FIXED_DELTA * 2;
    /** Scaled seconds since start — the clock world shaders read. */
    elapsedScaled = 0;
    /** 0..1 between the last and next simulation step, for render interpolation. */
    alpha = 0;
    /** Substeps executed in the last frame. Diagnostics. */
    substeps = 0;
    /** Frames-per-second estimate, smoothed. */
    fps = 60;
    accumulator = 0;
    lastDeltas = [];
    started = false;
    startTime = 0;
    waits = [];
    /* ---- bullet time -------------------------------------- */
    bulletTime = {
        active: false,
        endTime: 0,
        scale: 0.5,
        progress: 0,
        inSpeed: 3,
        outSpeed: 0.3,
    };
    /** Slows the world for `duration` seconds. Repeated calls extend it. */
    activateBulletTime(duration = 1.5, now = performance.now()) {
        const end = now + duration * 1000;
        this.bulletTime.endTime = this.bulletTime.active
            ? Math.max(this.bulletTime.endTime, end)
            : end;
        this.bulletTime.active = true;
    }
    /** Runs `callback` after `frames` rendered frames. */
    wait(frames, callback) {
        this.waits.push([frames, callback]);
    }
    /**
     * Advances one rendered frame. `now` is a `performance.now()`
     * millisecond stamp.
     */
    update(now) {
        if (!this.started) {
            this.started = true;
            this.startTime = now;
            this.elapsed = 0;
            this.delta = FIXED_DELTA;
            this.events.trigger('frame');
            this.events.trigger('tick');
            return;
        }
        const seconds = (now - this.startTime) / 1000;
        const rawDelta = seconds - this.elapsed;
        this.delta = Math.min(Math.max(rawDelta, 0), MAX_FRAME_DELTA);
        this.elapsed = seconds;
        // Rolling average, used for the FPS readout and the quality governor.
        this.lastDeltas.unshift(this.delta);
        if (this.lastDeltas.length > 30)
            this.lastDeltas.length = 30;
        let sum = 0;
        for (const d of this.lastDeltas)
            sum += d;
        this.deltaAverage = sum / this.lastDeltas.length;
        this.fps = this.deltaAverage > 0 ? 1 / this.deltaAverage : 60;
        /* ---- time dilation --------------------------------- */
        if (now > this.bulletTime.endTime)
            this.bulletTime.active = false;
        const speed = this.bulletTime.active ? this.bulletTime.inSpeed : this.bulletTime.outSpeed;
        this.bulletTime.progress += (this.bulletTime.active ? 1 : -1) * this.delta * speed;
        this.bulletTime.progress = clamp(this.bulletTime.progress, 0, 1);
        this.scale = remap(this.bulletTime.progress, 0, 1, this.defaultScale, this.bulletTime.scale);
        this.deltaScaled = FIXED_DELTA * this.scale;
        /* ---- frame-level work (inputs) --------------------- */
        this.events.trigger('frame');
        /* ---- fixed simulation steps ------------------------ */
        this.accumulator += this.delta;
        this.substeps = 0;
        while (this.accumulator >= FIXED_DELTA && this.substeps < MAX_SUBSTEPS) {
            this.accumulator -= FIXED_DELTA;
            this.substeps++;
            this.elapsedScaled += this.deltaScaled;
            this.events.trigger('fixed');
        }
        // If we hit the substep ceiling, drop the backlog rather than
        // accumulating a debt we can never pay off.
        if (this.accumulator > FIXED_DELTA)
            this.accumulator = 0;
        this.alpha = this.accumulator / FIXED_DELTA;
        /* ---- frame-rate waits ------------------------------ */
        for (let i = 0; i < this.waits.length; i++) {
            const wait = this.waits[i];
            wait[0]--;
            if (wait[0] <= 0) {
                wait[1]();
                this.waits.splice(i, 1);
                i--;
            }
        }
        /* ---- render-level work ----------------------------- */
        this.events.trigger('tick');
    }
    destroy() {
        this.events.clear();
        this.waits.length = 0;
        this.lastDeltas.length = 0;
    }
}
