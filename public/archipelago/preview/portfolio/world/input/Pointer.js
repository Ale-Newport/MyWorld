import { Events } from '../core/Events.js';
export class Pointer {
    element;
    events = new Events();
    current = { x: 0, y: 0 };
    delta = { x: 0, y: 0 };
    upcoming = { x: 0, y: 0 };
    isDown = false;
    upcomingDown = false;
    hasMoved = false;
    mode = 'mouse';
    /** 0 left, 1 middle, 2 right. Mouse only. */
    button = 0;
    /** Total pixels travelled while down — distinguishes a click from a drag. */
    dragDistance = 0;
    touches = [];
    upcomingTouches = [];
    pinch = {
        ratio: 1,
        ratioDelta: 0,
        baseDistance: 0,
        distance: 0,
        distanceDelta: 0,
    };
    constructor(element) {
        this.element = element;
        element.addEventListener('mousemove', this.onMouseMove);
        element.addEventListener('mousedown', this.onMouseDown);
        window.addEventListener('mouseup', this.onMouseUp);
        element.addEventListener('touchmove', this.onTouchMove, { passive: true });
        element.addEventListener('touchstart', this.onTouchStart, { passive: true });
        element.addEventListener('touchend', this.onTouchEnd);
        element.addEventListener('touchcancel', this.onTouchEnd);
        element.addEventListener('contextmenu', this.onContextMenu);
        window.addEventListener('blur', this.onBlur);
    }
    rectOffset() {
        const rect = this.element.getBoundingClientRect();
        return { left: rect.left, top: rect.top };
    }
    onMouseMove = (event) => {
        this.mode = 'mouse';
        const { left, top } = this.rectOffset();
        this.upcoming.x = event.clientX - left;
        this.upcoming.y = event.clientY - top;
    };
    onMouseDown = (event) => {
        event.preventDefault();
        this.mode = 'mouse';
        this.button = event.button;
        this.upcomingDown = true;
        this.dragDistance = 0;
        const { left, top } = this.rectOffset();
        const x = event.clientX - left;
        const y = event.clientY - top;
        this.current.x = x;
        this.current.y = y;
        this.upcoming.x = x;
        this.upcoming.y = y;
    };
    onMouseUp = () => {
        this.upcomingDown = false;
    };
    readTouches(event) {
        const { left, top } = this.rectOffset();
        const out = [];
        for (let i = 0; i < event.touches.length; i++) {
            const t = event.touches[i];
            out.push({ id: t.identifier, x: t.clientX - left, y: t.clientY - top });
        }
        return out;
    }
    average(points) {
        if (points.length === 0)
            return { x: this.current.x, y: this.current.y };
        let x = 0;
        let y = 0;
        for (const p of points) {
            x += p.x;
            y += p.y;
        }
        return { x: x / points.length, y: y / points.length };
    }
    onTouchMove = (event) => {
        this.mode = 'touch';
        this.upcomingTouches = this.readTouches(event);
        const avg = this.average(this.upcomingTouches);
        this.upcoming.x = avg.x;
        this.upcoming.y = avg.y;
    };
    onTouchStart = (event) => {
        this.mode = 'touch';
        this.upcomingDown = true;
        this.dragDistance = 0;
        this.upcomingTouches = this.readTouches(event);
        const avg = this.average(this.upcomingTouches);
        this.current.x = avg.x;
        this.current.y = avg.y;
        this.upcoming.x = avg.x;
        this.upcoming.y = avg.y;
    };
    onTouchEnd = (event) => {
        if (event.cancelable)
            event.preventDefault();
        this.upcomingTouches = this.readTouches(event);
        if (this.upcomingTouches.length <= 1)
            this.upcomingDown = false;
    };
    onContextMenu = (event) => event.preventDefault();
    onBlur = () => {
        this.upcomingDown = false;
        this.upcomingTouches = [];
    };
    /** Folds buffered input into frame state. Called once per frame. */
    update() {
        this.delta.x = this.upcoming.x - this.current.x;
        this.delta.y = this.upcoming.y - this.current.y;
        this.current.x = this.upcoming.x;
        this.current.y = this.upcoming.y;
        if (this.upcomingTouches.length >= 2) {
            let maxDistance = 0;
            for (let i = 0; i < this.upcomingTouches.length; i++) {
                for (let j = i + 1; j < this.upcomingTouches.length; j++) {
                    const dX = this.upcomingTouches[i].x - this.upcomingTouches[j].x;
                    const dY = this.upcomingTouches[i].y - this.upcomingTouches[j].y;
                    const distance = Math.hypot(dX, dY);
                    if (distance > maxDistance)
                        maxDistance = distance;
                }
            }
            this.pinch.distanceDelta = maxDistance - this.pinch.distance;
            this.pinch.distance = maxDistance;
            // A new finger arriving resets the baseline; otherwise adding a
            // third finger reads as an enormous pinch.
            if (this.upcomingTouches.length > this.touches.length) {
                this.pinch.distanceDelta = 0;
                this.pinch.baseDistance = this.pinch.distance;
            }
            const ratio = this.pinch.baseDistance > 0 ? this.pinch.distance / this.pinch.baseDistance : 1;
            if (ratio !== this.pinch.ratio) {
                this.pinch.ratioDelta = ratio - this.pinch.ratio;
                this.pinch.ratio = ratio;
                this.events.trigger('pinch');
            }
        }
        else {
            this.pinch.baseDistance = 0;
            this.pinch.distance = 0;
            this.pinch.distanceDelta = 0;
            this.pinch.ratio = 1;
            this.pinch.ratioDelta = 0;
        }
        this.touches = this.upcomingTouches.slice();
        this.hasMoved = this.delta.x !== 0 || this.delta.y !== 0;
        if (this.isDown && this.hasMoved) {
            this.dragDistance += Math.hypot(this.delta.x, this.delta.y);
        }
        if (this.upcomingDown !== this.isDown) {
            this.isDown = this.upcomingDown;
            this.events.trigger(this.isDown ? 'down' : 'up');
        }
        if (this.hasMoved)
            this.events.trigger('move');
    }
    destroy() {
        this.element.removeEventListener('mousemove', this.onMouseMove);
        this.element.removeEventListener('mousedown', this.onMouseDown);
        window.removeEventListener('mouseup', this.onMouseUp);
        this.element.removeEventListener('touchmove', this.onTouchMove);
        this.element.removeEventListener('touchstart', this.onTouchStart);
        this.element.removeEventListener('touchend', this.onTouchEnd);
        this.element.removeEventListener('touchcancel', this.onTouchEnd);
        this.element.removeEventListener('contextmenu', this.onContextMenu);
        window.removeEventListener('blur', this.onBlur);
        this.events.clear();
    }
}
