export const easing = {
    linear: (t) => t,
    power2In: (t) => t * t,
    power2Out: (t) => 1 - (1 - t) * (1 - t),
    power2InOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    power3Out: (t) => 1 - Math.pow(1 - t, 3),
    power4Out: (t) => 1 - Math.pow(1 - t, 4),
    power4InOut: (t) => (t < 0.5 ? 8 * t ** 4 : 1 - Math.pow(-2 * t + 2, 4) / 2),
    backOut: (t) => {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    },
    elasticOut: (t) => {
        if (t === 0 || t === 1)
            return t;
        const c4 = (2 * Math.PI) / 3;
        return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    },
};
const NOOP = { kill() { }, done: true };
export class Tweens {
    ticker;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous targets
    items = [];
    delayed = [];
    constructor(ticker, bin) {
        this.ticker = ticker;
        const update = () => this.update();
        // Order 20: after gameplay, before rendering.
        this.ticker.events.on('tick', update, 20);
        bin.add(() => {
            this.ticker.events.off('tick', update);
            this.items.length = 0;
            this.delayed.length = 0;
        });
    }
    /**
     * Animates numeric properties of `target`. Values are read at
     * call time, so a tween started mid-flight continues from where
     * the property currently is.
     */
    to(target, to, options = {}) {
        const duration = options.duration ?? 0.5;
        if (options.overwrite)
            this.killOf(target);
        const from = {};
        for (const key of Object.keys(to)) {
            from[key] = target[key];
        }
        if (duration <= 0 && !options.delay) {
            for (const key of Object.keys(to)) {
                ;
                target[key] = to[key];
            }
            options.onUpdate?.(1);
            options.onComplete?.();
            return NOOP;
        }
        const tween = {
            target,
            from,
            to,
            duration,
            delay: options.delay ?? 0,
            elapsed: 0,
            ease: options.ease ?? easing.power2InOut,
            onUpdate: options.onUpdate,
            onComplete: options.onComplete,
            killed: false,
        };
        this.items.push(tween);
        return {
            kill: () => {
                tween.killed = true;
            },
            get done() {
                return tween.killed || tween.elapsed >= tween.delay + tween.duration;
            },
        };
    }
    /** Runs `callback` after `seconds` of world time. */
    delay(seconds, callback) {
        const item = { time: seconds, elapsed: 0, callback, killed: false };
        this.delayed.push(item);
        return {
            kill: () => {
                item.killed = true;
            },
            get done() {
                return item.killed || item.elapsed >= item.time;
            },
        };
    }
    killOf(target) {
        for (const tween of this.items) {
            if (tween.target === target)
                tween.killed = true;
        }
    }
    update() {
        // World time, so bullet time slows tweens along with everything else.
        const dt = this.ticker.delta * this.ticker.scale;
        for (let i = 0; i < this.items.length; i++) {
            const tween = this.items[i];
            if (tween.killed) {
                this.items.splice(i--, 1);
                continue;
            }
            tween.elapsed += dt;
            if (tween.elapsed < tween.delay)
                continue;
            const raw = Math.min(1, (tween.elapsed - tween.delay) / tween.duration);
            const eased = tween.ease(raw);
            for (const key of Object.keys(tween.to)) {
                const from = tween.from[key];
                const to = tween.to[key];
                tween.target[key] = from + (to - from) * eased;
            }
            tween.onUpdate?.(raw);
            if (raw >= 1) {
                this.items.splice(i--, 1);
                tween.onComplete?.();
            }
        }
        for (let i = 0; i < this.delayed.length; i++) {
            const item = this.delayed[i];
            if (item.killed) {
                this.delayed.splice(i--, 1);
                continue;
            }
            item.elapsed += dt;
            if (item.elapsed >= item.time) {
                this.delayed.splice(i--, 1);
                item.callback();
            }
        }
    }
}
