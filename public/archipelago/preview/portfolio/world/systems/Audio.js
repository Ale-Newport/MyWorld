import { clamp, remapClamp } from '../core/maths.js';
export class Audio {
    ticker;
    player;
    vehicle;
    save;
    ctx = null;
    master = null;
    compressor = null;
    engineOsc = [];
    engineGain = null;
    engineFilter = null;
    windSource = null;
    windGain = null;
    windFilter = null;
    tyreSource = null;
    tyreGain = null;
    tyreFilter = null;
    noiseBuffer = null;
    lastOneShot = new Map();
    lastEnvironment = new Map();
    started = false;
    muted;
    volume;
    constructor(ticker, player, vehicle, save, bin) {
        this.ticker = ticker;
        this.player = player;
        this.vehicle = vehicle;
        this.save = save;
        this.muted = save.data.settings.muted;
        this.volume = save.data.settings.volume;
        const update = () => this.update();
        // Order 14, as upstream: after everything that could make a noise.
        this.ticker.events.on('tick', update, 14);
        const onCollision = (force) => this.impact(force);
        this.vehicle.events.on('collision', onCollision);
        const onLand = (airtime) => {
            if (airtime > 0.2)
                this.play('land', clamp(airtime, 0.2, 1.2));
        };
        this.vehicle.events.on('land', onLand);
        const onHorn = () => this.horn();
        this.player.events.on('honk', onHorn);
        const onJump = () => this.play('jump');
        this.player.events.on('jump', onJump);
        bin.add(() => {
            this.ticker.events.off('tick', update);
            this.vehicle.events.off('collision', onCollision);
            this.vehicle.events.off('land', onLand);
            this.player.events.off('honk', onHorn);
            this.player.events.off('jump', onJump);
            this.destroy();
        });
    }
    /* ========================================================
       SET-UP
       Deferred until a user gesture — the browser will not start
       an AudioContext before one, and asking earlier just logs a
       warning and fails.
       ======================================================== */
    resume() {
        if (this.started) {
            void this.ctx?.resume();
            return;
        }
        const Ctor = window.AudioContext ??
            window.webkitAudioContext;
        if (!Ctor)
            return;
        this.started = true;
        const ctx = new Ctor();
        this.ctx = ctx;
        // A compressor across the whole bus: without one, a pile-up of
        // twenty cone impacts clips hard.
        this.compressor = ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -18;
        this.compressor.knee.value = 24;
        this.compressor.ratio.value = 8;
        this.compressor.attack.value = 0.004;
        this.compressor.release.value = 0.2;
        this.master = ctx.createGain();
        this.master.gain.value = this.muted ? 0 : this.volume;
        this.compressor.connect(this.master).connect(ctx.destination);
        this.noiseBuffer = this.makeNoise(ctx, 2.5);
        this.buildEngine(ctx);
        this.buildWind(ctx);
        this.buildTyres(ctx);
    }
    makeNoise(ctx, seconds) {
        const length = Math.floor(ctx.sampleRate * seconds);
        const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        // Brown-ish noise: white noise integrated and leaked. Flat white
        // is too bright for tyres and reads as static rather than grit.
        let last = 0;
        for (let i = 0; i < length; i++) {
            const white = Math.random() * 2 - 1;
            last = (last + 0.02 * white) / 1.02;
            data[i] = last * 3.5;
        }
        return buffer;
    }
    buildEngine(ctx) {
        this.engineFilter = ctx.createBiquadFilter();
        this.engineFilter.type = 'lowpass';
        this.engineFilter.frequency.value = 220;
        this.engineFilter.Q.value = 3;
        this.engineGain = ctx.createGain();
        this.engineGain.gain.value = 0;
        this.engineFilter.connect(this.engineGain).connect(this.compressor);
        // Three sawtooths a few cents apart. The beating between them is
        // what stops it sounding like a test tone.
        for (const detune of [-7, 0, 9]) {
            const osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.value = 46;
            osc.detune.value = detune;
            osc.connect(this.engineFilter);
            osc.start();
            this.engineOsc.push(osc);
        }
        // A sub, so the idle has weight on a laptop speaker.
        const sub = ctx.createOscillator();
        sub.type = 'sine';
        sub.frequency.value = 23;
        sub.connect(this.engineFilter);
        sub.start();
        this.engineOsc.push(sub);
    }
    buildWind(ctx) {
        this.windFilter = ctx.createBiquadFilter();
        this.windFilter.type = 'bandpass';
        this.windFilter.frequency.value = 700;
        this.windFilter.Q.value = 0.7;
        this.windGain = ctx.createGain();
        this.windGain.gain.value = 0;
        this.windFilter.connect(this.windGain).connect(this.compressor);
        this.windSource = ctx.createBufferSource();
        this.windSource.buffer = this.noiseBuffer;
        this.windSource.loop = true;
        this.windSource.connect(this.windFilter);
        this.windSource.start();
    }
    buildTyres(ctx) {
        this.tyreFilter = ctx.createBiquadFilter();
        this.tyreFilter.type = 'lowpass';
        this.tyreFilter.frequency.value = 1400;
        this.tyreFilter.Q.value = 1;
        this.tyreGain = ctx.createGain();
        this.tyreGain.gain.value = 0;
        this.tyreFilter.connect(this.tyreGain).connect(this.compressor);
        this.tyreSource = ctx.createBufferSource();
        this.tyreSource.buffer = this.noiseBuffer;
        this.tyreSource.loop = true;
        this.tyreSource.playbackRate.value = 0.6;
        this.tyreSource.connect(this.tyreFilter);
        this.tyreSource.start();
    }
    /* ========================================================
       SETTINGS
       ======================================================== */
    setMuted(muted) {
        this.muted = muted;
        this.save.data.settings.muted = muted;
        this.save.schedule();
        this.applyMaster();
    }
    setVolume(volume) {
        this.volume = clamp(volume, 0, 1);
        this.save.data.settings.volume = this.volume;
        this.save.schedule();
        this.applyMaster();
    }
    applyMaster() {
        if (!this.master || !this.ctx)
            return;
        const target = this.muted ? 0 : this.volume;
        this.master.gain.cancelScheduledValues(this.ctx.currentTime);
        this.master.gain.setTargetAtTime(Number.isFinite(target) ? target : 0, this.ctx.currentTime, 0.05);
    }
    /* ========================================================
       PER-FRAME
       ======================================================== */
    update() {
        if (!this.ctx || this.muted || this.volume <= 0)
            return;
        const now = this.ctx.currentTime;
        const dt = 0.06;
        // The physics layer can hand us a NaN for a frame — a car teleported
        // twice in one tick, a zero-length velocity normalised. Web Audio
        // throws on a non-finite value and takes the whole frame with it, so
        // nothing reaches an AudioParam without passing through here.
        const ok = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
        const accelerating = Math.abs(this.player.accelerating);
        const boosting = this.player.boosting;
        const speed = this.vehicle.xzSpeed;
        const contact = this.vehicle.wheels.inContactCount / 4;
        /* ---- engine ---------------------------------------- */
        if (this.engineGain && this.engineFilter) {
            const load = clamp(accelerating * (1 + boosting), 0, 2);
            const volume = clamp(0.045 + load * 0.09, 0, 0.2);
            this.engineGain.gain.setTargetAtTime(ok(volume), now, dt);
            // Pitch follows road speed, not throttle, so lifting off does
            // not drop the note to idle while the car is still moving.
            const rpm = remapClamp(speed, 0, 34, 42, 168) * (1 + boosting * 0.22);
            for (const osc of this.engineOsc) {
                const base = osc.type === 'sine' ? rpm * 0.5 : rpm;
                osc.frequency.setTargetAtTime(ok(base, 42), now, dt);
            }
            this.engineFilter.frequency.setTargetAtTime(ok(remapClamp(load, 0, 2, 180, 1500), 180), now, dt);
        }
        /* ---- wind ------------------------------------------ */
        if (this.windGain && this.windFilter) {
            const volume = remapClamp(speed, 4, 40, 0, 0.14);
            this.windGain.gain.setTargetAtTime(ok(volume), now, dt);
            this.windFilter.frequency.setTargetAtTime(ok(remapClamp(speed, 0, 40, 400, 1700), 400), now, dt);
        }
        /* ---- tyres ----------------------------------------- */
        if (this.tyreGain && this.tyreSource) {
            // Rolling grit, plus a much louder component when the car is
            // sliding sideways or braking — that difference is the skid.
            const rolling = remapClamp(speed, 0.4, 24, 0, 0.05) * contact;
            const slip = 1 - Math.abs(this.vehicle.forwardRatio);
            const braking = Math.max(this.player.braking, slip * 0.8);
            const skid = clamp(braking * remapClamp(speed, 2, 20, 0, 1) * contact, 0, 1) * 0.16;
            const volume = rolling + skid;
            // Fast attack, slow release: a skid should arrive instantly and
            // trail off, not fade in.
            const tyre = ok(volume);
            this.tyreGain.gain.setTargetAtTime(tyre, now, tyre > this.lastTyre ? 0.02 : 0.16);
            this.lastTyre = tyre;
            this.tyreSource.playbackRate.setTargetAtTime(ok(remapClamp(speed, 0, 30, 0.5, 1.5), 0.5), now, dt);
        }
    }
    lastTyre = 0;
    /* ========================================================
       ONE-SHOTS
       ======================================================== */
    /** Impacts, scaled by contact force. */
    impact(force) {
        if (!this.ctx || this.muted)
            return;
        if (force < 4)
            return;
        if (!this.allow('note', 0.04))
            return;
        const ctx = this.ctx;
        const now = ctx.currentTime;
        const strength = clamp(force / 90, 0.05, 1);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.06 + strength * 0.28, now + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09 + strength * 0.24);
        gain.connect(this.compressor);
        const source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer;
        source.playbackRate.value = 1.6 - strength * 0.7;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        // Harder hits are lower and longer; light taps are a click.
        filter.frequency.value = 1500 - strength * 900;
        filter.Q.value = 1.4;
        source.connect(filter).connect(gain);
        source.start(now);
        source.stop(now + 0.5);
        // A body thump under the clatter, for the ones you feel.
        if (strength > 0.25) {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(120 - strength * 50, now);
            osc.frequency.exponentialRampToValueAtTime(38, now + 0.22);
            const thump = ctx.createGain();
            thump.gain.setValueAtTime(strength * 0.3, now);
            thump.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
            osc.connect(thump).connect(this.compressor);
            osc.start(now);
            osc.stop(now + 0.32);
        }
    }
    /** A short tone. `rate` shifts the pitch — the checkpoint ladder. */
    blip(rate = 1) {
        this.play('blip', rate);
    }
    /** Quiet environmental voices. Callers supply distance attenuation; the
     * common bus still honours mute/volume and limits overlapping transients. */
    environment(kind, amount = 1) {
        if (!this.ctx || this.muted || amount < .01)
            return;
        const ctx = this.ctx, now = ctx.currentTime, last = this.lastEnvironment.get(kind) ?? -100;
        if (now - last < (kind === 'water' ? 1 : kind === 'bird' ? 3 : .16))
            return;
        this.lastEnvironment.set(kind, now);
        const gain = ctx.createGain(), strength = Math.min(1, amount);
        gain.connect(this.compressor);
        if (kind === 'bird') {
            gain.gain.value = .04 * strength;
            for (let i = 0; i < 3; i++) {
                const osc = ctx.createOscillator(), voice = ctx.createGain(), at = now + i * .15;
                osc.type = 'sine';
                osc.frequency.setValueAtTime(1700 + i * 170, at);
                osc.frequency.exponentialRampToValueAtTime(3300, at + .055);
                osc.frequency.exponentialRampToValueAtTime(2100, at + .1);
                voice.gain.setValueAtTime(.001, at);
                voice.gain.linearRampToValueAtTime(1, at + .015);
                voice.gain.exponentialRampToValueAtTime(.001, at + .12);
                osc.connect(voice).connect(gain);
                osc.start(at);
                osc.stop(at + .13);
                osc.onended = () => { osc.disconnect(); voice.disconnect(); if (i === 2)
                    gain.disconnect(); };
            }
            return;
        }
        const duration = kind === 'water' ? 1.3 : kind === 'explosion' ? .85 : kind === 'leaves' ? .6 : .35;
        const peak = (kind === 'explosion' ? .32 : kind === 'water' ? .026 : kind === 'rolling' ? .026 : .07) * strength;
        gain.gain.setValueAtTime(.0001, now);
        gain.gain.exponentialRampToValueAtTime(Math.max(.0002, peak), now + (kind === 'water' ? .3 : .02));
        gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
        const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter();
        source.buffer = this.noiseBuffer;
        filter.type = kind === 'explosion' || kind === 'rolling' ? 'lowpass' : 'bandpass';
        filter.frequency.value = kind === 'explosion' ? 260 : kind === 'rolling' ? 480 : kind === 'leaves' ? 4200 : 1700;
        filter.Q.value = .55;
        source.playbackRate.value = .75 + Math.random() * .4;
        source.connect(filter).connect(gain);
        source.start(now);
        source.stop(now + duration + .05);
        source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
        if (kind === 'explosion') {
            const osc = ctx.createOscillator();
            osc.frequency.setValueAtTime(75 + Math.random() * 25, now);
            osc.frequency.exponentialRampToValueAtTime(24, now + .6);
            osc.connect(gain);
            osc.start(now);
            osc.stop(now + .7);
            osc.onended = () => osc.disconnect();
        }
    }
    horn() {
        if (!this.ctx || this.muted)
            return;
        if (!this.allow('horn', 0.16))
            return;
        const ctx = this.ctx;
        const now = ctx.currentTime;
        // Two notes a fourth apart, square waves, with a quick swell.
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
        gain.gain.setValueAtTime(0.16, now + 0.26);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
        gain.connect(this.compressor);
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1800;
        filter.connect(gain);
        for (const frequency of [392, 523.25]) {
            const osc = ctx.createOscillator();
            osc.type = 'square';
            osc.frequency.value = frequency;
            osc.connect(filter);
            osc.start(now);
            osc.stop(now + 0.42);
        }
    }
    play(kind, amount = 1) {
        if (!this.ctx || this.muted)
            return;
        if (!this.allow(kind, kind === 'blip' ? 0.05 : 0.1))
            return;
        const ctx = this.ctx;
        const now = ctx.currentTime;
        const gain = ctx.createGain();
        gain.connect(this.compressor);
        switch (kind) {
            case 'blip':
            case 'interact': {
                const osc = ctx.createOscillator();
                osc.type = 'triangle';
                const base = kind === 'interact' ? 880 : 660 * amount;
                osc.frequency.setValueAtTime(base, now);
                osc.frequency.exponentialRampToValueAtTime(base * 1.5, now + 0.06);
                gain.gain.setValueAtTime(0.09, now);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
                osc.connect(gain);
                osc.start(now);
                osc.stop(now + 0.18);
                break;
            }
            case 'achievement': {
                // A rising minor triad. Short, and it does not overstay.
                const notes = [523.25, 659.25, 783.99, 1046.5];
                notes.forEach((frequency, i) => {
                    const osc = ctx.createOscillator();
                    osc.type = 'triangle';
                    osc.frequency.value = frequency;
                    const voice = ctx.createGain();
                    const at = now + i * 0.07;
                    voice.gain.setValueAtTime(0.0001, at);
                    voice.gain.exponentialRampToValueAtTime(0.1, at + 0.015);
                    voice.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);
                    osc.connect(voice).connect(this.compressor);
                    osc.start(at);
                    osc.stop(at + 0.45);
                });
                break;
            }
            case 'note': {
                const osc = ctx.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(1174.66, now);
                osc.frequency.exponentialRampToValueAtTime(1567.98, now + 0.12);
                gain.gain.setValueAtTime(0.07, now);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
                osc.connect(gain);
                osc.start(now);
                osc.stop(now + 0.32);
                break;
            }
            case 'jump': {
                // Air, then a spring. The suspension is doing the work, so
                // the sound should be pneumatic rather than a boing.
                const source = ctx.createBufferSource();
                source.buffer = this.noiseBuffer;
                source.playbackRate.value = 2.2;
                const filter = ctx.createBiquadFilter();
                filter.type = 'highpass';
                filter.frequency.value = 900;
                gain.gain.setValueAtTime(0.14, now);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
                source.connect(filter).connect(gain);
                source.start(now);
                source.stop(now + 0.22);
                break;
            }
            case 'land': {
                const osc = ctx.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(150, now);
                osc.frequency.exponentialRampToValueAtTime(48, now + 0.18);
                gain.gain.setValueAtTime(clamp(amount, 0.1, 1) * 0.26, now);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
                osc.connect(gain);
                osc.start(now);
                osc.stop(now + 0.28);
                break;
            }
            case 'fail': {
                const osc = ctx.createOscillator();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(220, now);
                osc.frequency.exponentialRampToValueAtTime(90, now + 0.3);
                const filter = ctx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.value = 900;
                gain.gain.setValueAtTime(0.1, now);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
                osc.connect(filter).connect(gain);
                osc.start(now);
                osc.stop(now + 0.36);
                break;
            }
        }
    }
    /** Anti-spam. Twenty cones in one frame is one sound, not twenty. */
    allow(kind, minimumGap) {
        const now = this.ticker.elapsed;
        const last = this.lastOneShot.get(kind) ?? -Infinity;
        if (now - last < minimumGap)
            return false;
        this.lastOneShot.set(kind, now);
        return true;
    }
    destroy() {
        for (const osc of this.engineOsc) {
            try {
                osc.stop();
            }
            catch { /* already stopped */ }
            osc.disconnect();
        }
        this.engineOsc.length = 0;
        try {
            this.windSource?.stop();
        }
        catch { /* already stopped */ }
        try {
            this.tyreSource?.stop();
        }
        catch { /* already stopped */ }
        this.windSource?.disconnect();
        this.tyreSource?.disconnect();
        this.engineGain?.disconnect();
        this.engineFilter?.disconnect();
        this.windGain?.disconnect();
        this.windFilter?.disconnect();
        this.tyreGain?.disconnect();
        this.tyreFilter?.disconnect();
        this.master?.disconnect();
        this.compressor?.disconnect();
        void this.ctx?.close();
        this.ctx = null;
        this.started = false;
    }
}
